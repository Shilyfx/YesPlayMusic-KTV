// Adapted from src/services/analysis/drumStem.ts at the pinned revision.
// Segmenting, stereo source, triangular overlap-add, and normalization are the source algorithm.
import { HTDEMUCS_GPU_SEGMENT, stemSegmentStarts as drumStemSegments, stemSegmentWindow as drumStemWindow } from './stemSegmentMath';

export interface StemChannels { left: Float32Array; right: Float32Array }
export interface DrumStemProgress { drums: Float32Array; weight: Float32Array; next: number; divided: number }
export const startDrumStem = (total: number): DrumStemProgress => ({ drums: new Float32Array(total), weight: new Float32Array(total), next: 0, divided: 0 });

export const separateDrumStem = async (
    left: Float32Array,
    right: Float32Array,
    separateSegment: (left: Float32Array, right: Float32Array, index: number, count: number) => Promise<StemChannels | null>,
    onSegment?: (done: number, count: number, drums: Float32Array, final: number) => void | Promise<void>,
    keepGoing: () => boolean = () => true,
): Promise<Float32Array | null> => {
    const progress = startDrumStem(left.length);
    const segment = HTDEMUCS_GPU_SEGMENT;
    const total = left.length;
    const win = drumStemWindow(segment);
    const starts = drumStemSegments(total, segment);
    const { drums, weight } = progress;
    const inLeft = new Float32Array(segment);
    const inRight = new Float32Array(segment);
    for (let index = progress.next; index < starts.length; index += 1) {
        const start = starts[index];
        if (!keepGoing()) return null;
        const n = Math.min(segment, total - start);
        // The last segment runs past the end of the track: zeros, as the reference pads it.
        inLeft.fill(0);
        inRight.fill(0);
        inLeft.set(left.subarray(start, start + n));
        inRight.set(right.subarray(start, start + n));
        // On screen (时计), one unit of the scheduler's; a track left meanwhile is dropped there too.
        const stem = await separateSegment(inLeft, inRight, index, starts.length);
        if (!stem) return null;
        for (let i = 0; i < n; i += 1) {
            drums[start + i] += ((stem.left[i] + stem.right[i]) / 2) * win[i];
            weight[start + i] += win[i];
        }
        // Up to where the next segment starts, nothing more will be added.
        const final = index + 1 < starts.length ? starts[index + 1] : total;
        for (let i = progress.divided; i < final; i += 1) drums[i] /= Math.max(weight[i], 1e-8);
        progress.divided = final;
        progress.next = index + 1;
        await onSegment?.(index + 1, starts.length, drums, final);
    }
    return drums;
};
