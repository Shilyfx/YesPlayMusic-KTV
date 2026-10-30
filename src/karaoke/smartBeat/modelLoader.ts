import sourceManifest from '../../../vendor/folia-analysis/shared/modelManifest.json';

export type SmartBeatModelName = 'beat_this' | 'htdemucs';
export interface SmartBeatModelSpec {
    name: SmartBeatModelName;
    file: string;
    bytes: number;
    sha256: string;
    license: string;
    upstream: string;
}

interface SourceManifest {
    models: Array<SmartBeatModelSpec & { enables?: string; note?: string }>;
}

const parsedSourceManifest = sourceManifest as SourceManifest;
const modelByName = new Map(parsedSourceManifest.models.map(model => [model.name, model]));

export const SMARTBEAT_MODELS: Record<SmartBeatModelName, SmartBeatModelSpec> = {
    beat_this: requiredModel('beat_this'),
    htdemucs: requiredModel('htdemucs'),
};

function requiredModel(name: SmartBeatModelName): SmartBeatModelSpec {
    const found = modelByName.get(name);
    if (!found) throw new Error(`The pinned Folia manifest does not contain ${name}`);
    return found;
}

export const SMARTBEAT_MODEL_VERSIONS = Object.freeze({
    beat_this: SMARTBEAT_MODELS.beat_this.sha256,
    htdemucs: SMARTBEAT_MODELS.htdemucs.sha256,
});

const MAGIC = 'FOLIABTW';
const TRAILER_BYTES = MAGIC.length + 8;
const MODEL_CACHE_NAME = 'lumasing-folia-smartbeat-models-v1';

export interface PackedModelManifest {
    bytes: number;
    tensors: Record<string, { byte_offset: number; shape: number[]; dtype: 'f32' | 'f16' }>;
    [key: string]: unknown;
}

export interface VerifiedPackedModel {
    name: SmartBeatModelName;
    spec: SmartBeatModelSpec;
    weights: Uint8Array;
    manifest: PackedModelManifest;
    manifestOffset: number;
}

interface ModelLoadSubscriber {
    onProgress?: (loaded: number, total: number) => void;
}

interface ModelLoadFlight {
    controller: AbortController;
    subscribers: Set<ModelLoadSubscriber>;
    promise: Promise<VerifiedPackedModel>;
}

const MODEL_LOADS = new Map<SmartBeatModelName, ModelLoadFlight>();

const asBytes = (input: ArrayBuffer | ArrayBufferView): Uint8Array => {
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
};

export const sha256Hex = async (input: ArrayBuffer | ArrayBufferView): Promise<string> => {
    if (!globalThis.crypto?.subtle) throw new Error('SHA-256 is unavailable in this context');
    const digest = await globalThis.crypto.subtle.digest('SHA-256', asBytes(input));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
};

/** Parse only the upstream packed format: tensors, JSON, FOLIABTW, uint64 little-endian offset. */
export const unpackPackedWeights = (input: ArrayBuffer | ArrayBufferView): Omit<VerifiedPackedModel, 'name' | 'spec'> => {
    const bytes = asBytes(input);
    if (bytes.byteLength < TRAILER_BYTES) throw new Error('Packed model is shorter than its FOLIABTW trailer');
    const magicStart = bytes.byteLength - TRAILER_BYTES;
    for (let index = 0; index < MAGIC.length; index += 1) {
        if (bytes[magicStart + index] !== MAGIC.charCodeAt(index)) throw new Error('Packed model has no FOLIABTW trailer');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset + bytes.byteLength - 8, 8);
    const rawOffset = view.getBigUint64(0, true);
    if (rawOffset > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Packed model manifest offset is not safely representable');
    const manifestOffset = Number(rawOffset);
    if (!(manifestOffset > 0 && manifestOffset < magicStart)) throw new Error(`Packed model manifest offset ${manifestOffset} is outside the file`);

    let manifest: PackedModelManifest;
    try {
        const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(manifestOffset, magicStart));
        manifest = JSON.parse(json) as PackedModelManifest;
    } catch (error) {
        throw new Error(`Packed model manifest JSON is invalid: ${String(error)}`);
    }
    if (!manifest || typeof manifest !== 'object' || !manifest.tensors || typeof manifest.tensors !== 'object') {
        throw new Error('Packed model manifest has no tensor map');
    }
    if (!Number.isSafeInteger(manifest.bytes) || manifest.bytes !== manifestOffset) {
        throw new Error(`Packed model tensor length ${manifestOffset} does not match manifest bytes ${manifest.bytes}`);
    }
    return { weights: bytes.subarray(0, manifestOffset), manifest, manifestOffset };
};

/** Verify the pinned byte count and SHA-256 before parsing any manifest data. */
export const verifyPackedModel = async (
    name: SmartBeatModelName,
    input: ArrayBuffer | ArrayBufferView,
): Promise<VerifiedPackedModel> => {
    const spec = SMARTBEAT_MODELS[name];
    if (!spec) throw new Error(`Unknown SmartBeat model: ${String(name)}`);
    const bytes = asBytes(input);
    if (bytes.byteLength !== spec.bytes) throw new Error(`${spec.file} length mismatch: expected ${spec.bytes}, got ${bytes.byteLength}`);
    const actualHash = await sha256Hex(bytes);
    if (actualHash !== spec.sha256) throw new Error(`${spec.file} SHA-256 mismatch: expected ${spec.sha256}, got ${actualHash}`);
    return { name, spec, ...unpackPackedWeights(bytes) };
};

interface LoadModelOptions {
    signal?: AbortSignal;
    baseUrl?: string;
    cacheStorage?: CacheStorage | null;
    fetchImpl?: typeof fetch;
    onProgress?: (loaded: number, total: number) => void;
}

const cacheUrl = (url: string): string =>
    typeof location === 'undefined' ? url : new URL(url, location.href).toString();

async function readResponse(response: Response, totalExpected: number, options: LoadModelOptions): Promise<Uint8Array> {
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > totalExpected) throw new Error(`Model response exceeds its pinned ${totalExpected}-byte size`);
    if (!response.body?.getReader) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > totalExpected) throw new Error(`Model response exceeds its pinned ${totalExpected}-byte size`);
        options.onProgress?.(bytes.byteLength, totalExpected);
        return bytes;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
        while (true) {
            if (options.signal?.aborted) throw new DOMException('Model request cancelled', 'AbortError');
            const { done, value } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > totalExpected) {
                await reader.cancel();
                throw new Error(`Model response exceeds its pinned ${totalExpected}-byte size`);
            }
            chunks.push(value);
            options.onProgress?.(length, totalExpected);
        }
    } finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
}

async function fetchAndVerify(name: SmartBeatModelName, options: LoadModelOptions): Promise<VerifiedPackedModel> {
    const spec = SMARTBEAT_MODELS[name];
    const baseUrl = (options.baseUrl || '/pv/models').replace(/\/$/, '');
    const url = cacheUrl(`${baseUrl}/${encodeURIComponent(spec.file)}`);
    const cacheStorage = options.cacheStorage === undefined ? globalThis.caches : options.cacheStorage;
    let cache: Cache | null = null;
    if (cacheStorage) {
        try {
            cache = await cacheStorage.open(MODEL_CACHE_NAME);
            const cached = await cache.match(url);
            if (cached) {
                try {
                    const bytes = new Uint8Array(await cached.arrayBuffer());
                    return await verifyPackedModel(name, bytes);
                } catch {
                    await cache.delete(url);
                }
            }
        } catch {
            cache = null;
        }
    }

    const fetchImpl = options.fetchImpl || globalThis.fetch;
    if (!fetchImpl) throw new Error('Model fetching is unavailable in this browser');
    const response = await fetchImpl(url, {
        method: 'GET',
        credentials: 'same-origin',
        signal: options.signal,
    });
    if (!response.ok) throw new Error(`Model request for ${spec.file} returned HTTP ${response.status}`);
    const bytes = await readResponse(response, spec.bytes, options);
    const verified = await verifyPackedModel(name, bytes);
    if (cache) {
        try {
            await cache.put(url, new Response(bytes.slice(), {
                headers: { 'content-type': 'application/octet-stream', 'x-folia-model-sha256': spec.sha256 },
            }));
        } catch {
            // Verified bytes remain usable if the browser declines persistent CacheStorage space.
        }
    }
    return verified;
}

const modelAbortError = (): Error => {
    if (typeof DOMException !== 'undefined') return new DOMException('Model request cancelled', 'AbortError');
    const error = new Error('Model request cancelled');
    error.name = 'AbortError';
    return error;
};

const startModelLoad = (name: SmartBeatModelName, options: LoadModelOptions): ModelLoadFlight => {
    let resolveFlight!: (model: VerifiedPackedModel) => void;
    let rejectFlight!: (error: Error) => void;
    const flight: ModelLoadFlight = {
        controller: new AbortController(),
        subscribers: new Set(),
        promise: new Promise((resolve, reject) => {
            resolveFlight = resolve;
            rejectFlight = reject;
        }),
    };
    MODEL_LOADS.set(name, flight);

    const flightOptions: LoadModelOptions = {
        ...options,
        signal: flight.controller.signal,
        onProgress: (loaded, total) => {
            for (const subscriber of flight.subscribers) {
                try { subscriber.onProgress?.(loaded, total); } catch { /* Progress observers cannot break the shared fetch. */ }
            }
        },
    };
    void fetchAndVerify(name, flightOptions).then(
        model => {
            if (MODEL_LOADS.get(name) === flight) MODEL_LOADS.delete(name);
            resolveFlight(model);
        },
        error => {
            if (MODEL_LOADS.get(name) === flight) MODEL_LOADS.delete(name);
            rejectFlight(error instanceof Error ? error : new Error(String(error)));
        },
    );
    return flight;
};

const subscribeToModelLoad = (
    name: SmartBeatModelName,
    flight: ModelLoadFlight,
    options: LoadModelOptions,
): Promise<VerifiedPackedModel> => new Promise((resolve, reject) => {
    const subscriber: ModelLoadSubscriber = { onProgress: options.onProgress };
    const signal = options.signal;
    flight.subscribers.add(subscriber);
    let settled = false;

    const detach = (abandoned: boolean): boolean => {
        if (settled) return false;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        flight.subscribers.delete(subscriber);
        if (abandoned && flight.subscribers.size === 0 && MODEL_LOADS.get(name) === flight) {
            // Remove before aborting: a new track can start a fresh flight before this fetch settles.
            MODEL_LOADS.delete(name);
            flight.controller.abort();
        }
        return true;
    };

    const onAbort = (): void => {
        if (detach(true)) reject(modelAbortError());
    };
    if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) {
            onAbort();
            return;
        }
    }

    flight.promise.then(
        model => { if (detach(false)) resolve(model); },
        error => { if (detach(false)) reject(error); },
    );
});

/** Share a model fetch among live callers; one caller's abort only releases its own wait. */
export const loadSmartBeatModel = (name: SmartBeatModelName, options: LoadModelOptions = {}): Promise<VerifiedPackedModel> => {
    if (options.signal?.aborted) return Promise.reject(modelAbortError());
    const flight = MODEL_LOADS.get(name) || startModelLoad(name, options);
    return subscribeToModelLoad(name, flight, options);
};
