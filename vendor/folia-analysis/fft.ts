// Exact FFT closure copied from src/services/automix/signalAnalysis.ts at the pinned revision.
/** The bit-reversal permutation per transform size: the same few sizes, thousands of frames each. */
const bitReversal = new Map<number, Int32Array>();

const bitReversalOf = (n: number): Int32Array => {
    let table = bitReversal.get(n);
    if (table) return table;
    table = new Int32Array(n);
    for (let i = 1, j = 0; i < n; i += 1) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        table[i] = j;
    }
    bitReversal.set(n, table);
    return table;
};

export const fft = (real: Float64Array, imag: Float64Array) => {
    const n = real.length;
    // The permutation from a table, and swaps through a temporary rather than array destructuring;
    // the butterflies below are untouched, so every output is bit for bit what it was.
    const reversed = bitReversalOf(n);
    for (let i = 1; i < n; i += 1) {
        const j = reversed[i];
        if (i < j) {
            let swap = real[i];
            real[i] = real[j];
            real[j] = swap;
            swap = imag[i];
            imag[i] = imag[j];
            imag[j] = swap;
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const angle = (-2 * Math.PI) / len;
        const wReal = Math.cos(angle);
        const wImag = Math.sin(angle);
        for (let i = 0; i < n; i += len) {
            let curReal = 1;
            let curImag = 0;
            for (let k = 0; k < len / 2; k += 1) {
                const aReal = real[i + k];
                const aImag = imag[i + k];
                const bReal = real[i + k + len / 2] * curReal - imag[i + k + len / 2] * curImag;
                const bImag = real[i + k + len / 2] * curImag + imag[i + k + len / 2] * curReal;
                real[i + k] = aReal + bReal;
                imag[i + k] = aImag + bImag;
                real[i + k + len / 2] = aReal - bReal;
                imag[i + k + len / 2] = aImag - bImag;
                const nextReal = curReal * wReal - curImag * wImag;
                curImag = curReal * wImag + curImag * wReal;
                curReal = nextReal;
            }
        }
    }
};
