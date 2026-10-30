// Exact segment start/window math copied from src/services/analysis/stemRange.ts.
// The default segment size is the pinned HTDemucs WGSL runtime contract.
export const HTDEMUCS_GPU_SEGMENT = 172032;

/** Where each segment starts, for a track of `total` samples: a step of three quarters of a segment. */
export const stemSegmentStarts = (total: number, segment = HTDEMUCS_GPU_SEGMENT): number[] => {
    const stride = segment - Math.floor(segment / 4);
    const count = Math.max(1, Math.ceil(total / stride));
    const starts: number[] = [];
    for (let c = 0; c < count; c += 1) {
        const start = c * stride;
        if (start >= total && c > 0) break;
        starts.push(start);
    }
    return starts;
};

/** The triangular overlap-add window of htdemucs.cjs `buildWindow`, for one segment. */
export const stemSegmentWindow = (segment: number): Float32Array => {
    const overlap = Math.floor(segment / 4);
    const win = new Float32Array(segment).fill(1);
    for (let i = 0; i < overlap; i += 1) {
        const ramp = i / (overlap - 1);
        win[i] = ramp;
        win[segment - 1 - i] = ramp;
    }
    return win;
};
