'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.resolve(process.argv[2] || 'C:/Users/Shilyfx/AppData/Local/Temp/lumasing-folia-control-20261028');
const DEST = path.join(ROOT, 'vendor/folia-analysis');
const REVISION = '7a5f975e337e5ba13f55d72b5bc68983bf41c379';
const UPSTREAM_FILES = [
  'LICENSE',
  'shared/modelManifest.json',
  'electron/analysis/packedWeights.cjs',
  'src/services/analysis/beatThis.ts',
  'src/services/analysis/beatThisGpu.ts',
  'src/services/analysis/drumHitStream.ts',
  'src/services/analysis/drumHits.ts',
  'src/services/analysis/drumStem.ts',
  'src/services/analysis/stemRange.ts',
  'src/services/analysis/beatThisWgsl/kernels.ts',
  'src/services/analysis/beatThisWgsl/percussive.ts',
  'src/services/analysis/beatThisWgsl/runtime.ts',
  'src/services/analysis/htdemucsWgsl/kernels.ts',
  'src/services/analysis/htdemucsWgsl/runtime.ts',
  'src/services/automix/signalAnalysis.ts',
  'src/services/automix/uiYield.ts',
  'src/services/analysis/trackAudio.ts',
  'src/services/analysis/trackBytes.ts',
  'src/services/beatFx/beatFxSource.ts',
  'src/workers/beatThisGpu.worker.ts',
];

function read(relativePath) {
  return fs.readFileSync(path.join(SOURCE, relativePath), 'utf8');
}

function section(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`Pinned source no longer contains ${label}`);
  return source.slice(start, end).trimEnd();
}

function save(relativePath, contents) {
  const filePath = path.join(DEST, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

const actualRevision = execFileSync('git', ['-C', SOURCE, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (actualRevision !== REVISION) throw new Error(`Expected Folia source ${REVISION}, found ${actualRevision}`);
execFileSync('git', ['-C', SOURCE, 'diff', '--quiet', '--', ...UPSTREAM_FILES]);
execFileSync('git', ['-C', SOURCE, 'diff', '--cached', '--quiet', '--', ...UPSTREAM_FILES]);

fs.mkdirSync(DEST, { recursive: true });
const fileHashes = [];
for (const relativePath of UPSTREAM_FILES) {
  const from = path.join(SOURCE, relativePath);
  const to = path.join(DEST, 'upstream', relativePath);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  fileHashes.push({
    path: relativePath,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(from)).digest('hex'),
  });
}

// The coordinator's model publisher consumes this exact upstream JSON file.
fs.mkdirSync(path.join(DEST, 'shared'), { recursive: true });
fs.copyFileSync(path.join(SOURCE, 'shared/modelManifest.json'), path.join(DEST, 'shared/modelManifest.json'));
fs.copyFileSync(path.join(SOURCE, 'LICENSE'), path.join(DEST, 'LICENSE'));

const beatThisSource = read('src/services/analysis/beatThis.ts');
const beatThisMath = section(
  beatThisSource,
  '/** Beat This! runs at 22.05kHz mono',
  '/**\n * Whether this build can run the model right now.',
  'Beat This! pure math boundary',
);
save('beatThisMath.ts', [
  '// Adapted from src/services/analysis/beatThis.ts at the pinned revision in UPSTREAM.json.',
  '// Math and constants below are copied verbatim; only imports and the worker yield host are adapted.',
  "import { fft } from './fft';",
  "import { YIELD_BUDGET_MS, yieldToUi } from './yield';",
  "import type { PercussiveEnergyFrames } from './beatThisTypes';",
  '',
  beatThisMath,
  '',
].join('\n'));

const signalSource = read('src/services/automix/signalAnalysis.ts');
const fftSource = section(
  signalSource,
  '/** The bit-reversal permutation per transform size:',
  '/**\n * Spectral flux:',
  'FFT implementation',
);
save('fft.ts', [
  '// Exact FFT closure copied from src/services/automix/signalAnalysis.ts at the pinned revision.',
  fftSource,
  '',
].join('\n'));

save('yield.ts', [
  '// Worker host adaptation of src/services/automix/uiYield.ts at the pinned revision.',
  '// Preserve its measured 8 ms work budget and yield a worker task turn so cancellation can run.',
  'export const YIELD_BUDGET_MS = 8;',
  'export const yieldToUi = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));',
  '',
].join('\n'));

save('beatThisTypes.ts', [
  '// Exact result shape from src/services/analysis/beatThisWgsl/percussive.ts.',
  'export interface PercussiveEnergyFrames { percussive: Float32Array; total: Float32Array }',
  '',
].join('\n'));

const drumSource = read('src/services/analysis/drumHits.ts');
const drumPrelude = section(
  drumSource,
  '/** The rise window around a frame, at 50 fps - the same as beatAccents.ts. */',
  '/** Whether the GPU drum stem can run here:',
  'drum hit constants and rise helpers',
);
const drumFunctions = section(
  drumSource,
  '/** Per frame, the mean of the drum mel\'s bands centred in [fromHz, toHz). */',
  'const isDrumAnalysis =',
  'drum band and coverage functions',
);
save('drumHitMath.ts', [
  '// Pure functions copied verbatim from src/services/analysis/drumHits.ts at the pinned revision.',
  '// Electron capability checks, audio fetching, cache plumbing, and renderer stores are excluded.',
  "import { BEAT_THIS_FPS, BEAT_THIS_SAMPLE_RATE, MEL_BANDS, melBandCentresHz, type MelSpectrogram } from './beatThisMath';",
  "import type { DrumBands } from './drumHitStream';",
  '',
  'export type DrumHitKind = 0 | 1 | 2;',
  'export const DRUM_KICK: DrumHitKind = 0;',
  'export const DRUM_SNARE: DrumHitKind = 1;',
  'export const DRUM_HAT: DrumHitKind = 2;',
  'export interface DrumHits { times: Float64Array; strengths: Float32Array; kinds: Uint8Array }',
  '',
  drumPrelude,
  '',
  drumFunctions,
  '',
  '/* Exact bounded-memory equivalent of the source mix Float32Array followed by energyFrames. */',
  'export const energyFramesStereo = (left: Float32Array, right: Float32Array): Float32Array => {',
  '    if (left.length !== right.length) throw new Error(`stereo energy: ${left.length} left samples, ${right.length} right samples`);',
  '    const out = new Float32Array(Math.ceil(left.length / ENERGY_HOP));',
  '    for (let at = 0; at < left.length; at += 1) {',
  '        const mixed = Math.fround((left[at] + right[at]) / 2);',
  '        out[Math.floor(at / ENERGY_HOP)] += mixed * mixed;',
  '    }',
  '    return out;',
  '};',
  '',
].join('\n').replaceAll('const BEAT_THIS_SAMPLE_RATE', 'const BEAT_THIS_SAMPLE_RATE'));

const streamSource = read('src/services/analysis/drumHitStream.ts')
  .replace("from './beatThis';", "from './beatThisMath';");
save('drumHitStream.ts', [
  '// Adapted from src/services/analysis/drumHitStream.ts at the pinned revision; import path only changed.',
  streamSource,
].join('\n'));

const stemSource = read('src/services/analysis/stemRange.ts');
const stemMath = section(
  stemSource,
  '/** Where each segment starts, for a track of `total` samples:',
  '/** The indices of the segments that reach into [from, to). */',
  'HTDemucs segment start and overlap math',
);
save('stemSegmentMath.ts', [
  '// Exact segment start/window math copied from src/services/analysis/stemRange.ts.',
  '// The default segment size is the pinned HTDemucs WGSL runtime contract.',
  'export const HTDEMUCS_GPU_SEGMENT = 172032;',
  '',
  stemMath,
  '',
].join('\n'));

const originalStem = read('src/services/analysis/drumStem.ts');
let drumStem = originalStem.slice(originalStem.indexOf('export const separateDrumStem = async (')).trimEnd();
if (!drumStem.startsWith('export const separateDrumStem')) throw new Error('Could not locate original drum stem algorithm');
drumStem = drumStem.replace(
  /export const separateDrumStem = async \([\s\S]*?\): Promise<Float32Array \| null> => \{/,
  `export const separateDrumStem = async (
    left: Float32Array,
    right: Float32Array,
    separateSegment: (left: Float32Array, right: Float32Array, index: number, count: number) => Promise<StemChannels | null>,
    onSegment?: (done: number, count: number, drums: Float32Array, final: number) => void | Promise<void>,
    keepGoing: () => boolean = () => true,
): Promise<Float32Array | null> => {
    const progress = startDrumStem(left.length);`,
);
drumStem = drumStem.replace(
  /const stems = await separateStemSegment\([\s\S]*?\);\n        if \(!stems\) return null;\n        const stem = stems\[0\];/,
  `const stem = await separateSegment(inLeft, inRight, index, starts.length);
        if (!stem) return null;`,
);
drumStem = drumStem.replace('onSegment?.(index + 1, starts.length, drums, final);', 'await onSegment?.(index + 1, starts.length, drums, final);');
if (drumStem.includes('separateStemSegment') || drumStem.includes('GpuRunOptions')) throw new Error('Upstream drum stem adaptation left a host dependency');
save('drumStem.ts', [
  '// Adapted from src/services/analysis/drumStem.ts at the pinned revision.',
  '// Segmenting, stereo source, triangular overlap-add, and normalization are the source algorithm.',
  "import { HTDEMUCS_GPU_SEGMENT, stemSegmentStarts as drumStemSegments, stemSegmentWindow as drumStemWindow } from './stemSegmentMath';",
  '',
  'export interface StemChannels { left: Float32Array; right: Float32Array }',
  'export interface DrumStemProgress { drums: Float32Array; weight: Float32Array; next: number; divided: number }',
  'export const startDrumStem = (total: number): DrumStemProgress => ({ drums: new Float32Array(total), weight: new Float32Array(total), next: 0, divided: 0 });',
  '',
  drumStem,
  '',
].join('\n'));

const manifestText = fs.readFileSync(path.join(SOURCE, 'shared/modelManifest.json'), 'utf8');
const manifest = JSON.parse(manifestText);
const adaptedFiles = [
  'beatThisMath.ts', 'fft.ts', 'yield.ts', 'beatThisTypes.ts', 'drumHitMath.ts',
  'drumHitStream.ts', 'stemSegmentMath.ts', 'drumStem.ts',
  'beatThisWgsl/runtime.ts', 'beatThisWgsl/kernels.ts', 'beatThisWgsl/percussive.ts',
  'htdemucsWgsl/runtime.ts', 'htdemucsWgsl/kernels.ts',
];
for (const relativePath of [
  'src/services/analysis/beatThisWgsl/runtime.ts',
  'src/services/analysis/beatThisWgsl/kernels.ts',
  'src/services/analysis/beatThisWgsl/percussive.ts',
  'src/services/analysis/htdemucsWgsl/runtime.ts',
  'src/services/analysis/htdemucsWgsl/kernels.ts',
]) {
  const from = path.join(SOURCE, relativePath);
  const to = path.join(DEST, relativePath.replace(/^src\/services\/analysis\//, ''));
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

const sourceHashByPath = Object.fromEntries(fileHashes.map(file => [file.path, file.sha256]));
save('UPSTREAM.json', `${JSON.stringify({
  repository: 'https://github.com/chthollyphile/folia-major',
  revision: REVISION,
  license: 'AGPL-3.0',
  sourceFiles: fileHashes,
  modelManifestSha256: crypto.createHash('sha256').update(manifestText).digest('hex'),
  models: manifest.models.map(({ name, file, bytes, sha256, license, upstream }) => ({ name, file, bytes, sha256, license, upstream })),
  adaptedFiles,
  adaptations: {
    'beatThisMath.ts': 'Exact pure math extracted from beatThis.ts before its Electron-only runner guard; local FFT and task-yield imports.',
    'drumHitMath.ts': 'Exact rise-picking and drum-coverage functions extracted; Electron/WebAudio/cache host code omitted. Includes a Math.fround-preserving stereo energy reduction equivalent to the source Float32 mix buffer.',
    'drumStem.ts': 'Exact stereo segment and overlap-add algorithm with an injected GPU segment runner and awaited progress callback.',
    'stemSegmentMath.ts': 'Exact segment starts and triangular window with the pinned segment constant.',
    'yield.ts': 'Preserves the upstream 8 ms work budget and yields a worker task turn for cancellation.',
  },
  copiedModelManifest: 'shared/modelManifest.json (byte-for-byte from the pinned source)',
  sourceHashByPath,
}, null, 2)}\n`);

save('NOTICE.md', [
  '# Folia analysis source and model notices',
  '',
  `The vendored analysis source is from [Folia](https://github.com/chthollyphile/folia-major), revision \`${REVISION}\`, and is licensed under AGPL-3.0. The exact upstream files and SHA-256 values are recorded in [UPSTREAM.json](./UPSTREAM.json); unmodified copies are under [upstream/](./upstream/).`,
  '',
  'The Beat This! and HTDemucs packed model files are MIT-licensed and are identified byte-for-byte in [shared/modelManifest.json](./shared/modelManifest.json). Beat This! is attributed there to CPJKU and its upstream repository; HTDemucs is attributed there to Meta Research and the specified model source.',
  '',
  'Adapted pure math and worker-facing wrappers retain their source attribution in the file headers and in `UPSTREAM.json`.',
  '',
].join('\n'));

process.stdout.write(`Vendored ${UPSTREAM_FILES.length} pinned Folia source files and extracted ${adaptedFiles.length} analysis modules at ${REVISION}.\n`);
