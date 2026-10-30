import { SmartBeatUnsupportedError } from './types';

const MAX_DURATION_SECONDS = 600;
const MAX_ENCODED_BYTES = 128 * 1024 * 1024;
const MAX_DECODED_BYTES = 256 * 1024 * 1024;
const MAX_DECODE_PEAK_BYTES = 256 * 1024 * 1024;
const INPUT_RATE = 44100;
const BEAT_RATE = 22050;
const WORST_CASE_PCM_BYTES_PER_SECOND = (INPUT_RATE * 4 + BEAT_RATE * 2) * Float32Array.BYTES_PER_ELEMENT;

export interface DecodedSmartBeatAudio {
    left: Float32Array;
    right: Float32Array;
    mono: Float32Array;
    duration: number;
    uncompressedBytes: number;
}

const offlineContextConstructor = (): typeof OfflineAudioContext | null => {
    if (typeof window === 'undefined') return null;
    return window.OfflineAudioContext
        || (window as Window & { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext
        || null;
};

const toArrayBuffer = (bytes: ArrayBuffer | ArrayBufferView): ArrayBuffer => {
    if (bytes instanceof ArrayBuffer) return bytes;
    if (bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
        return bytes.buffer;
    }
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

const retainedInputBytes = (input: ArrayBuffer | ArrayBufferView): number =>
    input instanceof ArrayBuffer ? input.byteLength : input.buffer.byteLength;

const decodeInputCopyBytes = (input: ArrayBuffer | ArrayBufferView): number => {
    if (input instanceof ArrayBuffer) return 0;
    return input.buffer instanceof ArrayBuffer && input.byteOffset === 0 && input.byteLength === input.buffer.byteLength
        ? 0
        : input.byteLength;
};

/** Estimate application-held decode buffers; browser-internal decodeAudioData allocations are engine-owned. */
export const assertSmartBeatDecodeBudget = (duration: number, input: ArrayBuffer | ArrayBufferView): void => {
    const encodedBytes = input.byteLength;
    if (encodedBytes <= 0 || encodedBytes > MAX_ENCODED_BYTES) {
        throw new SmartBeatUnsupportedError(`Encoded audio must be between 1 byte and ${MAX_ENCODED_BYTES} bytes`);
    }
    if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION_SECONDS) {
        throw new SmartBeatUnsupportedError(`Audio duration must be greater than 0 and at most ${MAX_DURATION_SECONDS} seconds`);
    }
    // During decode: source backing + any view copy + a possible decoder copy + one stereo AudioBuffer.
    const inputPeakBytes = retainedInputBytes(input) + decodeInputCopyBytes(input) + encodedBytes;
    const decodeStagePeakBytes = Math.ceil(duration * INPUT_RATE * 2 * Float32Array.BYTES_PER_ELEMENT) + inputPeakBytes;
    // After decode: stereo AudioBuffer + copied L/R channels + rendered mono AudioBuffer + its transferable copy.
    const retainedCallerBytes = input instanceof ArrayBuffer ? 0 : retainedInputBytes(input);
    const pcmStagePeakBytes = Math.ceil(duration * WORST_CASE_PCM_BYTES_PER_SECOND) + retainedCallerBytes;
    const estimatedPeakBytes = Math.max(decodeStagePeakBytes, pcmStagePeakBytes);
    if (estimatedPeakBytes > MAX_DECODE_PEAK_BYTES) {
        const mib = Math.ceil(estimatedPeakBytes / (1024 * 1024));
        throw new SmartBeatUnsupportedError(`Estimated application-held audio peak memory (${mib} MiB) exceeds the 256 MiB analysis budget`);
    }
};

/** Decode real source bytes off the audible player, keeping stereo HTDemucs and 22.05 kHz mono Beat This! input. */
export const decodeSmartBeatAudio = async (input: ArrayBuffer | ArrayBufferView, expectedDuration: number): Promise<DecodedSmartBeatAudio> => {
    assertSmartBeatDecodeBudget(expectedDuration, input);
    const OfflineContext = offlineContextConstructor();
    if (!OfflineContext) throw new SmartBeatUnsupportedError('OfflineAudioContext is unavailable for analysis decoding');
    const encodedBytes = input.byteLength;
    const callerBackingBytes = retainedInputBytes(input);
    const decoderInputCopyBytes = decodeInputCopyBytes(input);
    const retainedCallerBytes = input instanceof ArrayBuffer ? 0 : callerBackingBytes;
    let decodeBytes = toArrayBuffer(input);
    const decoderInputPeakBytes = callerBackingBytes + decoderInputCopyBytes + encodedBytes;
    input = new ArrayBuffer(0);
    let decoded: AudioBuffer;
    try {
        const decoding = new OfflineContext(2, 1, INPUT_RATE).decodeAudioData(decodeBytes);
        decodeBytes = new ArrayBuffer(0);
        decoded = await decoding;
    } catch (error) {
        throw new Error(`Audio decode failed: ${String(error)}`);
    }
    if (!Number.isFinite(decoded.duration) || decoded.duration <= 0 || decoded.duration > MAX_DURATION_SECONDS) {
        throw new SmartBeatUnsupportedError(`Audio duration must be between 0 and ${MAX_DURATION_SECONDS} seconds`);
    }
    const actualChannelCount = Math.max(1, decoded.numberOfChannels);
    const stereoChannelCount = Math.min(2, actualChannelCount);
    const uncompressedBytes = decoded.length * actualChannelCount * Float32Array.BYTES_PER_ELEMENT;
    const stereoCopyBytes = decoded.length * 2 * Float32Array.BYTES_PER_ELEMENT;
    const monoBytes = Math.ceil(decoded.duration * BEAT_RATE) * Float32Array.BYTES_PER_ELEMENT;
    const decodeStagePeakBytes = uncompressedBytes + decoderInputPeakBytes;
    const pcmStagePeakBytes = uncompressedBytes + stereoCopyBytes + monoBytes * 2 + retainedCallerBytes;
    const actualPeakBytes = Math.max(decodeStagePeakBytes, pcmStagePeakBytes);
    if (uncompressedBytes > MAX_DECODED_BYTES || actualPeakBytes > MAX_DECODE_PEAK_BYTES) {
        const mib = Math.ceil(actualPeakBytes / (1024 * 1024));
        throw new SmartBeatUnsupportedError(`Estimated application-held audio peak memory (${mib} MiB) exceeds the 256 MiB analysis budget`);
    }

    const duration = decoded.duration;
    const left = new Float32Array(decoded.length);
    decoded.copyFromChannel(left, 0);
    const right = stereoChannelCount > 1 ? new Float32Array(decoded.length) : new Float32Array(left);
    if (stereoChannelCount > 1) decoded.copyFromChannel(right, 1);

    const monoLength = Math.ceil(duration * BEAT_RATE);
    const monoContext = new OfflineContext(1, monoLength, BEAT_RATE);
    const source = monoContext.createBufferSource();
    source.buffer = decoded;
    source.connect(monoContext.destination);
    source.start(0);
    const monoBuffer = await monoContext.startRendering();
    const mono = new Float32Array(monoBuffer.getChannelData(0));
    if (!mono.length || mono.length > MAX_DECODED_BYTES / Float32Array.BYTES_PER_ELEMENT) {
        throw new SmartBeatUnsupportedError('Resampled Beat This! input is outside the analysis memory limit');
    }
    return { left, right, mono, duration, uncompressedBytes };
};

/** Resample one finished HTDemucs mono-stem stretch with the same OfflineAudioContext path as Folia. */
export const resampleDrumStem = async (signal: Float32Array): Promise<Float32Array> => {
    const OfflineContext = offlineContextConstructor();
    if (!OfflineContext) throw new Error('OfflineAudioContext is unavailable for drum-stem resampling');
    const length = Math.ceil(signal.length * BEAT_RATE / INPUT_RATE);
    const context = new OfflineContext(1, length, BEAT_RATE);
    const source = context.createBufferSource();
    const input = context.createBuffer(1, signal.length, INPUT_RATE);
    input.copyToChannel(signal, 0);
    source.buffer = input;
    source.connect(context.destination);
    source.start(0);
    return new Float32Array((await context.startRendering()).getChannelData(0));
};

export const SMARTBEAT_AUDIO_LIMITS = Object.freeze({
    durationSeconds: MAX_DURATION_SECONDS,
    encodedBytes: MAX_ENCODED_BYTES,
    decodedBytes: MAX_DECODED_BYTES,
    peakBytes: MAX_DECODE_PEAK_BYTES,
});
