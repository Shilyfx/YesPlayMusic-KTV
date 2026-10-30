import { createIndexedDbAnalysisCache, validateCanonicalTimeline, type AnalysisStorage, type CachedAnalysis } from './analysisCache';
import { assertSmartBeatDecodeBudget, decodeSmartBeatAudio, resampleDrumStem, SMARTBEAT_AUDIO_LIMITS } from './audio';
import { SmartBeatUnsupportedError } from './types';
import {
    loadSmartBeatModel,
    sha256Hex,
    SMARTBEAT_MODEL_VERSIONS,
    type SmartBeatModelName,
} from './modelLoader';
import type { CanonicalTimeline, SmartBeatMode, SmartBeatSources, SmartBeatStatus } from './types';

const MAX_GPU_MODEL_BYTES = 512 * 1024 * 1024;
const WORKER_IDLE_MS = 2 * 60 * 1000;

interface SmartBeatWorkerMessage {
    id?: number;
    kind: string;
    jobId?: number;
    bridgeId?: number;
    supported?: boolean;
    model?: SmartBeatModelName;
    gpuBytes?: number;
    loaded?: number;
    total?: number;
    progress?: number;
    phase?: string;
    error?: string;
    beats?: CanonicalTimeline['beats'];
    drums?: CanonicalTimeline['drums'];
    samples?: Float32Array;
    [key: string]: unknown;
}

export interface SmartBeatWorkerLike {
    onmessage: ((event: MessageEvent<any>) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    postMessage(message: unknown, transfer?: Transferable[]): void;
    terminate(): void;
}

interface AudioFetchOptions {
    signal: AbortSignal;
    onProgress: (loaded: number, total: number) => void;
}

export interface SmartBeatAnalyzerOptions {
    onStatus?: (status: SmartBeatStatus) => void;
    onResult?: (timeline: CanonicalTimeline) => void;
    fetchAudio?: (sourceUrl: string, options: AudioFetchOptions) => Promise<ArrayBuffer | ArrayBufferView | Response>;
    createWorker?: (workerUrl?: string) => SmartBeatWorkerLike;
    storage?: AnalysisStorage;
    workerUrl?: string;
}

export interface SmartBeatTrack {
    key: string;
    cacheKey: string;
    sourceUrl: string | null;
    duration: number;
    playing: boolean;
}

export interface SmartBeatAnalyzer {
    updateTrack(track: SmartBeatTrack): void;
    setMode(mode: SmartBeatMode): void;
    ensureSources(sources: SmartBeatSources): Promise<CanonicalTimeline | null>;
    dispose(): void;
}

interface PendingRequest {
    resolve: (message: SmartBeatWorkerMessage) => void;
    reject: (error: Error) => void;
    signal?: AbortSignal;
    abortListener?: () => void;
}

interface ActiveOperation {
    generation: number;
    sourceKey: string;
    jobId: number;
    abort: AbortController;
    promise: Promise<CanonicalTimeline | null>;
}

const abortError = (message = 'SmartBeat analysis cancelled'): Error => {
    if (typeof DOMException !== 'undefined') return new DOMException(message, 'AbortError');
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
};

const isAbort = (error: unknown): boolean =>
    (error as { name?: string } | null)?.name === 'AbortError';

const sourceKey = (sources: SmartBeatSources): string => `${sources.beats ? 1 : 0}${sources.drums ? 1 : 0}`;

const sourceLabel = (sources: SmartBeatSources): SmartBeatStatus['source'] =>
    sources.beats && sources.drums ? 'both' : sources.beats ? 'beat_this' : sources.drums ? 'htdemucs' : undefined;

const cachedParts = (value: CachedAnalysis | CanonicalTimeline): CachedAnalysis => {
    if ('timeline' in value && 'sources' in value) return value as CachedAnalysis;
    const timeline = value as CanonicalTimeline;
    return {
        timeline,
        sources: { beats: timeline.beats !== null, drums: timeline.drums !== null },
    };
};

const readAudioResponse = async (
    result: ArrayBuffer | ArrayBufferView | Response,
    signal: AbortSignal,
    onProgress: (loaded: number, total: number) => void,
): Promise<ArrayBuffer> => {
    if (!(typeof Response !== 'undefined' && result instanceof Response)) {
        const bytes = result instanceof ArrayBuffer
            ? new Uint8Array(result)
            : new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
        if (bytes.byteLength <= 0 || bytes.byteLength > SMARTBEAT_AUDIO_LIMITS.encodedBytes) {
            throw new SmartBeatUnsupportedError(`Encoded audio must be between 1 byte and ${SMARTBEAT_AUDIO_LIMITS.encodedBytes} bytes`);
        }
        onProgress(bytes.byteLength, bytes.byteLength);
        return bytes.slice().buffer;
    }
    if (!result.ok) throw new Error(`Audio source returned HTTP ${result.status}`);
    const declared = Number(result.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > SMARTBEAT_AUDIO_LIMITS.encodedBytes) {
        throw new SmartBeatUnsupportedError(`Encoded audio exceeds the ${SMARTBEAT_AUDIO_LIMITS.encodedBytes}-byte limit`);
    }
    if (!result.body?.getReader) {
        const bytes = new Uint8Array(await result.arrayBuffer());
        if (bytes.byteLength <= 0 || bytes.byteLength > SMARTBEAT_AUDIO_LIMITS.encodedBytes) {
            throw new SmartBeatUnsupportedError(`Encoded audio must be between 1 byte and ${SMARTBEAT_AUDIO_LIMITS.encodedBytes} bytes`);
        }
        onProgress(bytes.byteLength, Number.isFinite(declared) && declared > 0 ? declared : bytes.byteLength);
        return bytes.buffer;
    }
    const reader = result.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    try {
        while (true) {
            if (signal.aborted) throw abortError();
            const { done, value } = await reader.read();
            if (done) break;
            loaded += value.byteLength;
            if (loaded > SMARTBEAT_AUDIO_LIMITS.encodedBytes) {
                await reader.cancel();
                throw new SmartBeatUnsupportedError(`Encoded audio exceeds the ${SMARTBEAT_AUDIO_LIMITS.encodedBytes}-byte limit`);
            }
            chunks.push(value);
            onProgress(loaded, Number.isFinite(declared) && declared > 0 ? declared : 0);
        }
    } finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    if (!bytes.byteLength) throw new Error('Audio source returned an empty file');
    onProgress(bytes.byteLength, Number.isFinite(declared) && declared > 0 ? declared : bytes.byteLength);
    return bytes.buffer;
};

const defaultFetchAudio = async (sourceUrl: string, { signal }: AudioFetchOptions): Promise<Response> => {
    const fetchImpl = globalThis.fetch;
    if (!fetchImpl) throw new Error('Audio fetching is unavailable in this browser');
    return fetchImpl(sourceUrl, { method: 'GET', credentials: 'same-origin', signal });
};

/** Synchronous factory; all model, audio, and worker operations are asynchronous on the returned methods. */
export const createSmartBeatAnalyzer = (options: SmartBeatAnalyzerOptions = {}): SmartBeatAnalyzer => {
    let mode: SmartBeatMode = 'off';
    let track: SmartBeatTrack | null = null;
    let generation = 0;
    let disposed = false;
    let worker: SmartBeatWorkerLike | null = null;
    let workerBroken = false;
    let messageId = 0;
    let jobId = 0;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let active: ActiveOperation | null = null;
    const pending = new Map<number, PendingRequest>();
    const loadedModels = new Set<SmartBeatModelName>();
    const storage = options.storage || createIndexedDbAnalysisCache();

    const emit = (status: SmartBeatStatus): void => {
        try { options.onStatus?.(status); } catch { /* Observer callbacks cannot break playback or analysis. */ }
    };

    const current = (expectedGeneration: number, operation?: ActiveOperation): boolean =>
        !disposed && generation === expectedGeneration && (!operation || active === operation);

    const resetIdleTimer = (): void => {
        if (idleTimer) clearTimeout(idleTimer);
        if (active) {
            idleTimer = null;
            return;
        }
        idleTimer = setTimeout(() => disposeWorker(), WORKER_IDLE_MS);
        (idleTimer as unknown as { unref?: () => void }).unref?.();
    };

    const rejectPending = (error: Error): void => {
        for (const [id, request] of pending) {
            pending.delete(id);
            request.signal?.removeEventListener('abort', request.abortListener as EventListener);
            request.reject(error);
        }
    };

    const disposeWorker = (): void => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = null;
        const oldWorker = worker;
        worker = null;
        loadedModels.clear();
        if (!oldWorker) return;
        const disposeId = ++messageId;
        try {
            oldWorker.postMessage({ id: disposeId, kind: 'dispose' });
        } catch { /* The worker is already unavailable. */ }
        setTimeout(() => oldWorker.terminate(), 250);
        rejectPending(abortError('SmartBeat worker released'));
    };

    const handleWorkerMessage = (event: MessageEvent<SmartBeatWorkerMessage>): void => {
        const message = event.data;
        if (!message || typeof message !== 'object') return;
        if (message.kind === 'device-lost') {
            workerBroken = true;
            loadedModels.clear();
            if (idleTimer) clearTimeout(idleTimer);
            idleTimer = null;
            const oldWorker = worker;
            worker = null;
            rejectPending(new Error(message.message || 'WebGPU device was lost'));
            if (!active) emit({ stage: 'error', trackKey: track?.key, message: message.message || 'WebGPU device was lost' });
            oldWorker?.terminate();
            return;
        }
        if (message.kind === 'progress') {
            const expectedGeneration = active?.generation;
            if (expectedGeneration === undefined || !current(expectedGeneration, active || undefined)) return;
            if (active?.jobId && message.jobId !== active.jobId) return;
            emit({
                stage: 'analysing',
                trackKey: track?.key,
                source: sourceLabel(active ? { beats: active.sourceKey[0] === '1', drums: active.sourceKey[1] === '1' } : { beats: false, drums: false }),
                phase: message.phase,
                ...(Number.isFinite(message.progress) ? { progress: message.progress } : {}),
                ...(Number.isFinite(message.loaded) ? { loaded: message.loaded } : {}),
                ...(Number.isFinite(message.total) ? { total: message.total } : {}),
            });
            return;
        }
        if (message.kind === 'resample-request') {
            const operation = active;
            const liveWorker = worker;
            if (!operation || !liveWorker || operation.abort.signal.aborted || operation.jobId !== message.jobId || !message.samples) {
                try { liveWorker?.postMessage({ kind: 'resample-result', bridgeId: message.bridgeId, jobId: message.jobId, error: 'analysis cancelled' }); } catch { /* Worker already ended. */ }
                return;
            }
            void resampleDrumStem(message.samples).then((samples) => {
                if (operation.abort.signal.aborted || active !== operation) {
                    liveWorker.postMessage({ kind: 'resample-result', bridgeId: message.bridgeId, jobId: message.jobId, error: 'analysis cancelled' });
                    return;
                }
                liveWorker.postMessage(
                    { kind: 'resample-result', bridgeId: message.bridgeId, jobId: message.jobId, samples },
                    [samples.buffer],
                );
            }).catch((error) => {
                try { liveWorker.postMessage({ kind: 'resample-result', bridgeId: message.bridgeId, jobId: message.jobId, error: String(error) }); } catch { /* Worker already ended. */ }
            });
            return;
        }
        if (typeof message.id !== 'number') return;
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        request.signal?.removeEventListener('abort', request.abortListener as EventListener);
        if (message.error && !(message.kind === 'probe-result' && message.supported === false)) {
            request.reject(new Error(message.error));
        }
        else request.resolve(message);
    };

    const ensureWorker = (): SmartBeatWorkerLike => {
        if (worker && !workerBroken) {
            resetIdleTimer();
            return worker;
        }
        if (!options.createWorker && !options.workerUrl) throw new Error('The coordinator did not provide the SmartBeat worker URL');
        if (typeof Worker === 'undefined' && !options.createWorker) throw new Error('Dedicated workers are unavailable');
        const created = options.createWorker
            ? options.createWorker(options.workerUrl)
            : new Worker(options.workerUrl as string, { type: 'module', name: 'folia-analysis' }) as unknown as SmartBeatWorkerLike;
        worker = created;
        workerBroken = false;
        created.onmessage = handleWorkerMessage;
        created.onerror = (event) => {
            workerBroken = true;
            rejectPending(new Error(event.message || 'SmartBeat worker failed'));
            created.terminate();
            if (worker === created) worker = null;
            loadedModels.clear();
        };
        resetIdleTimer();
        return created;
    };

    const requestWorker = (
        kind: string,
        payload: Record<string, unknown> = {},
        transfer: Transferable[] = [],
        signal?: AbortSignal,
    ): Promise<SmartBeatWorkerMessage> => {
        const target = ensureWorker();
        if (signal?.aborted) return Promise.reject(abortError());
        const id = ++messageId;
        const promise = new Promise<SmartBeatWorkerMessage>((resolve, reject) => {
            const request: PendingRequest = { resolve, reject, signal };
            if (signal) {
                request.abortListener = () => {
                    if (!pending.delete(id)) return;
                    reject(abortError());
                };
                signal.addEventListener('abort', request.abortListener, { once: true });
            }
            pending.set(id, request);
            try {
                target.postMessage({ id, kind, ...payload }, transfer);
            } catch (error) {
                pending.delete(id);
                signal?.removeEventListener('abort', request.abortListener as EventListener);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
        resetIdleTimer();
        return promise;
    };

    const abortActive = (message: string): void => {
        const operation = active;
        if (!operation) return;
        active = null;
        operation.abort.abort();
        if (worker && operation.jobId) {
            try { worker.postMessage({ kind: 'cancel', jobId: operation.jobId }); } catch { /* Worker may already be gone. */ }
        }
        emit({ stage: 'cancelled', trackKey: track?.key, message });
        if (worker && !disposed) resetIdleTimer();
    };

    const supportsWebGpu = (): string | null => {
        if (typeof window === 'undefined') {
            return options.createWorker ? null : 'Browser capability cannot be checked outside a browser';
        }
        if (!window.isSecureContext) return 'WebGPU requires a secure context';
        if (!navigator.gpu) return 'WebGPU is unavailable in this browser';
        return null;
    };

    const currentCached = async (cacheKey: string, sources: SmartBeatSources): Promise<CachedAnalysis | null> => {
        try {
            const entry = await storage.get(cacheKey, SMARTBEAT_MODEL_VERSIONS, sources);
            if (!entry) return null;
            const parts = cachedParts(entry);
            if (sources.beats && !parts.sources.beats) return null;
            if (sources.drums && !parts.sources.drums) return null;
            if (!validateCanonicalTimeline(parts.timeline)) return null;
            return parts;
        } catch {
            return null;
        }
    };

    const publishCached = (entry: CachedAnalysis, cacheHit: boolean, key: string): CanonicalTimeline | null => {
        if (!validateCanonicalTimeline(entry.timeline)) return null;
        const timeline = { ...entry.timeline, trackKey: key };
        try { options.onResult?.(timeline); } catch { /* Observer callbacks cannot break analysis. */ }
        emit({ stage: 'cached', trackKey: key, cacheHit, progress: cacheHit ? 1 : undefined,
            message: cacheHit ? 'Loaded the verified local analysis cache.' : 'No complete cached analysis exists for this track.' });
        return cacheHit ? timeline : null;
    };

    const loadModel = async (
        modelName: SmartBeatModelName,
        signal: AbortSignal,
        expectedGeneration: number,
        operation: ActiveOperation,
    ): Promise<void> => {
        if (loadedModels.has(modelName)) return;
        emit({ stage: 'loading-model', trackKey: track?.key, source: modelName, message: `Loading ${modelName} model.` });
        const model = await loadSmartBeatModel(modelName, {
            signal,
            onProgress: (loaded, total) => {
                if (!current(expectedGeneration, operation)) return;
                emit({ stage: 'loading-model', trackKey: track?.key, source: modelName, loaded, total,
                    ...(total > 0 ? { progress: loaded / total } : {}) });
            },
        });
        if (!current(expectedGeneration, operation)) throw abortError();
        const weights = model.weights.slice();
        const result = await requestWorker('load', {
            model: modelName,
            weights,
            manifest: model.manifest,
        }, [weights.buffer], signal);
        if (!current(expectedGeneration, operation)) throw abortError();
        if (typeof result.gpuBytes === 'number' && result.gpuBytes > MAX_GPU_MODEL_BYTES) {
            void requestWorker('unload', { model: modelName }).catch(() => undefined);
            throw new SmartBeatUnsupportedError(`${modelName} requires ${result.gpuBytes} GPU bytes, above the ${MAX_GPU_MODEL_BYTES}-byte model budget`);
        }
        loadedModels.add(modelName);
    };

    const run = async (
        expectedGeneration: number,
        operation: ActiveOperation,
        snapshot: TrackRef,
        sources: SmartBeatSources,
    ): Promise<CanonicalTimeline | null> => {
        const signal = operation.abort.signal;
        try {
            if (mode === 'off' || disposed || signal.aborted) return null;
            const stored = await currentCached(snapshot.cacheKey, sources);
            if (!current(expectedGeneration, operation)) return null;
            if (stored) return publishCached(stored, true, snapshot.key);
            if (mode === 'cached') {
                emit({ stage: 'cached', trackKey: snapshot.key, cacheHit: false,
                    message: 'No complete cached analysis exists for the requested sources.' });
                return null;
            }
            if (!snapshot.sourceUrl) {
                emit({ stage: 'unsupported', trackKey: snapshot.key, source: sourceLabel(sources), message: 'No readable source URL is available for this track.' });
                return null;
            }
            if (snapshot.duration > SMARTBEAT_AUDIO_LIMITS.durationSeconds) {
                emit({ stage: 'unsupported', trackKey: snapshot.key, source: sourceLabel(sources), message: 'Track exceeds the 600 second analysis limit.' });
                return null;
            }
            const supportIssue = supportsWebGpu();
            if (supportIssue) {
                emit({ stage: 'unsupported', trackKey: snapshot.key, source: sourceLabel(sources), message: supportIssue });
                return null;
            }
            const capability = await requestWorker('probe', {}, [], signal);
            if (!current(expectedGeneration, operation)) return null;
            if (!capability.supported) {
                emit({ stage: 'unsupported', trackKey: snapshot.key, source: sourceLabel(sources), message: capability.error || 'The worker could not obtain a WebGPU adapter and device.' });
                return null;
            }

            emit({ stage: 'fetching-audio', trackKey: snapshot.key, source: sourceLabel(sources), progress: 0 });
            const fetchAudio = options.fetchAudio || defaultFetchAudio;
            let audioBytes = await readAudioResponse(
                await fetchAudio(snapshot.sourceUrl, {
                    signal,
                    onProgress: (loaded, total) => {
                        if (!current(expectedGeneration, operation)) return;
                        emit({ stage: 'fetching-audio', trackKey: snapshot.key, source: sourceLabel(sources), loaded, total,
                            ...(total > 0 ? { progress: Math.min(1, loaded / total) } : {}) });
                    },
                }),
                signal,
                (loaded, total) => {
                    if (!current(expectedGeneration, operation)) return;
                    emit({ stage: 'fetching-audio', trackKey: snapshot.key, source: sourceLabel(sources), loaded, total,
                        ...(total > 0 ? { progress: Math.min(1, loaded / total) } : {}) });
                },
            );
            if (!current(expectedGeneration, operation)) return null;
            const audioHash = await sha256Hex(audioBytes);
            if (!current(expectedGeneration, operation)) return null;
            assertSmartBeatDecodeBudget(snapshot.duration, audioBytes);

            if (sources.beats) await loadModel('beat_this', signal, expectedGeneration, operation);
            if (sources.drums) await loadModel('htdemucs', signal, expectedGeneration, operation);
            if (!current(expectedGeneration, operation)) return null;

            emit({ stage: 'analysing', trackKey: snapshot.key, source: sourceLabel(sources), phase: 'decoding' });
            const decodingAudio = decodeSmartBeatAudio(audioBytes, snapshot.duration);
            audioBytes = new ArrayBuffer(0);
            const audio = await decodingAudio;
            if (!current(expectedGeneration, operation)) return null;

            const currentJobId = ++jobId;
            operation.jobId = currentJobId;
            const transfer: Transferable[] = [audio.mono.buffer, audio.left.buffer, audio.right.buffer];
            const reply = await requestWorker('analyse', {
                jobId: currentJobId,
                trackKey: snapshot.key,
                duration: audio.duration,
                sources,
                mono: audio.mono,
                left: audio.left,
                right: audio.right,
            }, transfer, signal);
            if (!current(expectedGeneration, operation)) return null;

            const timeline: CanonicalTimeline = {
                trackKey: snapshot.key,
                audioHash,
                modelVersions: SMARTBEAT_MODEL_VERSIONS,
                duration: audio.duration,
                beats: sources.beats ? reply.beats || null : null,
                drums: sources.drums ? reply.drums || null : null,
            };
            if (!validateCanonicalTimeline(timeline)) throw new Error('Analysis worker returned a malformed canonical timeline');
            await storage.put(snapshot.cacheKey, timeline, sources);
            if (!current(expectedGeneration, operation)) return null;
            try { options.onResult?.(timeline); } catch { /* Observer callbacks cannot break analysis. */ }
            emit({ stage: 'ready', trackKey: snapshot.key, source: sourceLabel(sources), progress: 1 });
            return timeline;
        } catch (error) {
            if (!current(expectedGeneration, operation)) return null;
            if (isAbort(error) || signal.aborted) {
                emit({ stage: 'cancelled', trackKey: snapshot.key, message: 'Analysis was cancelled.' });
                return null;
            }
            const message = String((error as Error)?.message || error);
            if (error instanceof SmartBeatUnsupportedError) {
                emit({ stage: 'unsupported', trackKey: snapshot.key, source: sourceLabel(sources), message });
            } else {
                emit({ stage: 'error', trackKey: snapshot.key, source: sourceLabel(sources), error: message, message });
            }
            return null;
        }
    };

    return {
        updateTrack(next: SmartBeatTrack): void {
            if (disposed) return;
            const changed = !track
                || track.key !== next.key
                || track.cacheKey !== next.cacheKey
                || track.sourceUrl !== next.sourceUrl;
            if (changed) {
                generation += 1;
                abortActive('Track changed; previous analysis was discarded.');
            }
            track = { ...next };
        },

        setMode(nextMode: SmartBeatMode): void {
            if (disposed || mode === nextMode) return;
            mode = nextMode;
            if (nextMode !== 'on') abortActive(`Analysis mode changed to ${nextMode}.`);
        },

        ensureSources(sourcesInput: SmartBeatSources): Promise<CanonicalTimeline | null> {
            if (disposed || mode === 'off' || (!sourcesInput.beats && !sourcesInput.drums)) return Promise.resolve(null);
            if (!track) {
                emit({ stage: 'unsupported', message: 'There is no active track to analyse.' });
                return Promise.resolve(null);
            }
            const sources = { beats: Boolean(sourcesInput.beats), drums: Boolean(sourcesInput.drums) };
            const key = sourceKey(sources);
            if (active && active.generation === generation && active.sourceKey === key) return active.promise;
            if (active) abortActive('A new source request replaced the previous analysis.');
            const expectedGeneration = generation;
            const snapshot = { ...track };
            const operation = {
                generation: expectedGeneration,
                sourceKey: key,
                jobId: 0,
                abort: new AbortController(),
                promise: Promise.resolve(null) as Promise<CanonicalTimeline | null>,
            };
            active = operation;
            operation.promise = run(expectedGeneration, operation, snapshot, sources).finally(() => {
                if (active === operation) active = null;
                if (worker && !disposed) resetIdleTimer();
            });
            return operation.promise;
        },

        dispose(): void {
            if (disposed) return;
            generation += 1;
            abortActive('Analyzer disposed.');
            disposed = true;
            disposeWorker();
        },
    };
};
