/// <reference types="@webgpu/types" />
import { BeatThisWgsl, type BeatThisWgslManifest } from '../../../vendor/folia-analysis/beatThisWgsl/runtime';
import { HtdemucsWgsl, type HtdemucsWgslManifest } from '../../../vendor/folia-analysis/htdemucsWgsl/runtime';
import {
    aggregateChunks,
    beatsFromLogits,
    melSpectrogram,
    splitForModel,
    type ChunkPrediction,
} from '../../../vendor/folia-analysis/beatThisMath';
import {
    DRUMLESS_COVERAGE,
    drumBandTracks,
    drumCoverage,
    energyFrames,
    energyFramesStereo,
    pickBandHits,
} from '../../../vendor/folia-analysis/drumHitMath';
import { createDrumBandStream } from '../../../vendor/folia-analysis/drumHitStream';
import { separateDrumStem } from '../../../vendor/folia-analysis/drumStem';
import type { CanonicalBeats, CanonicalDrums, SmartBeatSources } from './types';

export const analysisWorkerEntry = 'folia-analysis-worker';

type ModelName = 'beat_this' | 'htdemucs';
type WorkerRequest =
    | { id: number; kind: 'probe' }
    | { id: number; kind: 'load'; model: ModelName; weights: Uint8Array | ArrayBuffer; manifest: BeatThisWgslManifest | HtdemucsWgslManifest }
    | { id: number; kind: 'analyse'; jobId: number; trackKey: string; duration: number; sources: SmartBeatSources; mono: Float32Array; left: Float32Array; right: Float32Array }
    | { id: number; kind: 'unload'; model: ModelName }
    | { id: number; kind: 'dispose' }
    | { kind: 'cancel'; jobId: number }
    | { kind: 'resample-result'; bridgeId: number; jobId: number; samples?: Float32Array; error?: string };

interface PendingResample {
    jobId: number;
    resolve: (samples: Float32Array) => void;
    reject: (error: Error) => void;
}

let device: GPUDevice | null = null;
let adapter: GPUAdapter | null = null;
let beatThis: BeatThisWgsl | null = null;
let htdemucs: HtdemucsWgsl | null = null;
let lost: string | null = null;
let nextBridgeId = 0;
let f16 = false;
const cancelledJobs = new Set<number>();
const pendingResamples = new Map<number, PendingResample>();

const post = (message: Record<string, unknown>, transfer: Transferable[] = []): void => {
    self.postMessage(message, transfer);
};

const openDevice = async (): Promise<GPUDevice> => {
    if (device) return device;
    if (typeof isSecureContext !== 'undefined' && !isSecureContext) throw new Error('WebGPU worker requires a secure context');
    if (!navigator.gpu) throw new Error('navigator.gpu is unavailable in the analysis worker');
    const selected = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!selected) throw new Error('WebGPU returned no adapter');
    adapter = selected;
    f16 = selected.features.has('shader-f16');
    const opened = await selected.requestDevice({ requiredFeatures: f16 ? ['shader-f16'] : [] });
    opened.lost.then((info) => {
        lost = `WebGPU device lost (${info.reason}): ${info.message}`;
        beatThis?.destroy();
        htdemucs?.destroy();
        beatThis = null;
        htdemucs = null;
        device = null;
        post({ kind: 'device-lost', message: lost });
    });
    device = opened;
    return opened;
};

const checkJob = (jobId: number): void => {
    if (cancelledJobs.has(jobId)) throw new DOMException('Analysis cancelled', 'AbortError');
    if (lost) throw new Error(lost);
};

const reportProgress = (jobId: number, phase: string, completed: number, total: number): void => {
    post({
        kind: 'progress',
        jobId,
        phase,
        loaded: completed,
        total,
        ...(total > 0 ? { progress: Math.max(0, Math.min(1, completed / total)) } : {}),
    });
};

const resampleOnMain = (signal: Float32Array, jobId: number): Promise<Float32Array> => {
    const bridgeId = ++nextBridgeId;
    const transferSamples = new Float32Array(signal);
    return new Promise((resolve, reject) => {
        pendingResamples.set(bridgeId, { jobId, resolve, reject });
        post({ kind: 'resample-request', bridgeId, jobId, samples: transferSamples }, [transferSamples.buffer]);
    });
};

const analyse = async (request: Extract<WorkerRequest, { kind: 'analyse' }>): Promise<void> => {
    const { id, jobId, sources } = request;
    try {
        checkJob(jobId);
        let beats: CanonicalBeats | null = null;
        let drums: CanonicalDrums | null = null;

        if (sources.beats) {
            const model = beatThis;
            if (!model) throw new Error('Beat This! model is not loaded');
            const mel = await melSpectrogram(request.mono);
            checkJob(jobId);
            const chunks = splitForModel(mel);
            if (!chunks.length) throw new Error('Beat This! produced no spectrogram frames');
            const predictions: ChunkPrediction[] = [];
            for (let index = 0; index < chunks.length; index += 1) {
                checkJob(jobId);
                const chunk = chunks[index];
                const prediction = await model.run(chunk.data, { slice: 'auto' });
                checkJob(jobId);
                predictions.push({
                    start: chunk.start,
                    frames: chunk.frames,
                    beat: prediction.beat,
                    downbeat: prediction.downbeat,
                });
                reportProgress(jobId, 'beat-this', index + 1, chunks.length);
            }
            const stitched = aggregateChunks(predictions, mel.frames);
            const grid = beatsFromLogits(stitched.beat, stitched.downbeat);
            beats = { source: 'beat_this', times: grid.beats, downbeats: grid.downbeats };
        }

        if (sources.drums) {
            const model = htdemucs;
            if (!model) throw new Error('HTDemucs model is not loaded');
            checkJob(jobId);
            const mixEnergy = energyFramesStereo(request.left, request.right);
            const bandStream = createDrumBandStream(request.left.length, {
                resample: signal => resampleOnMain(signal, jobId),
                mel: melSpectrogram,
                bands: drumBandTracks,
            });
            const stem = await separateDrumStem(
                request.left,
                request.right,
                async (left, right, index, count) => {
                    checkJob(jobId);
                    const separated = await model.run(left, right, { slice: 'auto' });
                    checkJob(jobId);
                    const drumSource = separated.stems[0];
                    if (!drumSource) throw new Error('HTDemucs did not return its drums source');
                    return drumSource;
                },
                async (done, count, drumsSoFar, final) => {
                    checkJob(jobId);
                    await bandStream.advance(drumsSoFar, final, final >= request.left.length);
                    checkJob(jobId);
                    reportProgress(jobId, 'htdemucs-drums', done, count);
                },
                () => !cancelledJobs.has(jobId) && !lost,
            );
            checkJob(jobId);
            if (!stem) throw new Error('HTDemucs drum separation was cancelled');
            const coverage = drumCoverage(energyFrames(stem), mixEnergy);
            if (coverage >= DRUMLESS_COVERAGE) {
                const hits = pickBandHits(bandStream.bands, bandStream.done);
                drums = {
                    source: 'htdemucs',
                    times: Array.from(hits.times),
                    strengths: Array.from(hits.strengths),
                    kinds: Array.from(hits.kinds),
                };
            }
        }

        checkJob(jobId);
        post({ id, kind: 'analysis-result', jobId, duration: request.duration, beats, drums });
    } catch (error) {
        const cancelled = (error as { name?: string } | null)?.name === 'AbortError' || cancelledJobs.has(jobId);
        if (cancelled) post({ id, kind: 'analysis-result', jobId, cancelled: true });
        else post({ id, kind: 'analysis-result', jobId, error: String((error as Error)?.message || error) });
    } finally {
        cancelledJobs.delete(jobId);
        for (const [bridgeId, pending] of pendingResamples) {
            if (pending.jobId === jobId) {
                pendingResamples.delete(bridgeId);
                pending.reject(new DOMException('Analysis finished', 'AbortError'));
            }
        }
    }
};

const dispose = (): void => {
    beatThis?.destroy();
    htdemucs?.destroy();
    beatThis = null;
    htdemucs = null;
    device?.destroy();
    device = null;
    adapter = null;
    lost = null;
    for (const pending of pendingResamples.values()) pending.reject(new DOMException('Analysis worker disposed', 'AbortError'));
    pendingResamples.clear();
    cancelledJobs.clear();
};

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
    const request = event.data;
    if (request.kind === 'cancel') {
        cancelledJobs.add(request.jobId);
        for (const [bridgeId, pending] of pendingResamples) {
            if (pending.jobId === request.jobId) {
                pendingResamples.delete(bridgeId);
                pending.reject(new DOMException('Analysis cancelled', 'AbortError'));
            }
        }
        return;
    }
    if (request.kind === 'resample-result') {
        const pending = pendingResamples.get(request.bridgeId);
        if (!pending || pending.jobId !== request.jobId) return;
        pendingResamples.delete(request.bridgeId);
        if (request.error) pending.reject(new Error(request.error));
        else if (request.samples) pending.resolve(request.samples);
        else pending.reject(new Error('OfflineAudioContext returned no resampled drum stem'));
        return;
    }

    try {
        if (request.kind === 'probe') {
            try {
                await openDevice();
                post({ id: request.id, kind: 'probe-result', supported: true });
            } catch (error) {
                post({ id: request.id, kind: 'probe-result', supported: false, error: String((error as Error)?.message || error) });
            }
            return;
        }
        if (request.kind === 'load') {
            const opened = await openDevice();
            if (lost) throw new Error(lost);
            const weights = request.weights instanceof Uint8Array ? request.weights : new Uint8Array(request.weights);
            if (request.model === 'beat_this') {
                if (!beatThis) {
                    beatThis = await BeatThisWgsl.create(opened, weights, request.manifest as BeatThisWgslManifest, {
                        f16: f16 ? 'storage' : undefined,
                    });
                }
                post({ id: request.id, kind: 'loaded', model: request.model, gpuBytes: beatThis.bytes });
                return;
            }
            if (!htdemucs) {
                // HTDemucs source index 0 is drums; no other source is needed for SmartBeat.
                htdemucs = await HtdemucsWgsl.create(opened, weights, request.manifest as HtdemucsWgslManifest, { sources: [0] });
            }
            post({ id: request.id, kind: 'loaded', model: request.model, gpuBytes: htdemucs.bytes });
            return;
        }
        if (request.kind === 'analyse') {
            void analyse(request);
            return;
        }
        if (request.kind === 'unload') {
            if (request.model === 'beat_this') {
                beatThis?.destroy();
                beatThis = null;
            } else {
                htdemucs?.destroy();
                htdemucs = null;
            }
            post({ id: request.id, kind: 'unloaded', model: request.model });
            return;
        }
        if (request.kind === 'dispose') {
            dispose();
            post({ id: request.id, kind: 'disposed' });
        }
    } catch (error) {
        post({ id: request.id, kind: `${request.kind}-result`, error: String((error as Error)?.message || error) });
    }
};
