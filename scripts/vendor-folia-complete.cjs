// Add the pinned Folia G3 renderer/background closure without refreshing G2 patches.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { execFileSync } = require('child_process');
const esbuild = require('esbuild');

const REPOSITORY = 'https://github.com/chthollyphile/folia-major';
const REVISION = '7a5f975e337e5ba13f55d72b5bc68983bf41c379';
const DEFAULT_SOURCE = path.join(os.tmpdir(), 'lumasing-folia-control-20261028');
const REPO_ROOT = path.resolve(__dirname, '..');
const DEST_ROOT = path.join(REPO_ROOT, 'vendor', 'folia-complete');
const META_PATH = path.join(DEST_ROOT, 'UPSTREAM.json');
const SOURCE_SUBDIR = 'src/';
const SUPPORT_SOURCE_FILES = [
  {
    sourcePath: 'src/i18n/locales/zh-CN.ts',
    purpose: 'Pinned Simplified Chinese locale data for reproducible host i18n.',
  },
];

const RENDERERS = [
  ['classic', 'src/components/visualizer/classic/Visualizer.tsx'],
  ['cadenza', 'src/components/visualizer/cadenza/VisualizerCadenza.tsx'],
  ['partita', 'src/components/visualizer/partita/VisualizerPartita.tsx'],
  ['fume', 'src/components/visualizer/fume/VisualizerFume.tsx'],
  ['claddagh', 'src/components/visualizer/claddagh/VisualizerCladdagh.tsx'],
  ['monet', 'src/components/visualizer/monet/VisualizerMonet.tsx'],
  ['pendolo', 'src/components/visualizer/pendolo/VisualizerPendolo.tsx'],
  ['cappella', 'src/components/visualizer/cappella/VisualizerCappella.tsx'],
  ['diorama', 'src/components/visualizer/diorama/VisualizerDiorama.tsx'],
  ['still', 'src/components/visualizer/still/VisualizerStill.tsx'],
  ['lumiere', 'src/components/visualizer/lumiere/createLumierePixiRuntime.ts'],
];
const BACKGROUNDS = [
  ['monet', 'src/components/visualizer/backgrounds/monet/MonetBackgroundLayer.tsx'],
  ['nomand', 'src/components/visualizer/backgrounds/nomand/NomandBackgroundLayer.tsx'],
  ['latent', 'src/components/visualizer/backgrounds/latent/LatentBackground.tsx'],
  ['url', 'src/components/visualizer/backgrounds/url/UrlBackgroundLayer.tsx'],
  ['sora', 'src/components/visualizer/backgrounds/sora/SoraBackground.tsx'],
];
const TUNINGS = [
  ...['classic', 'cadenza', 'partita', 'fume', 'claddagh', 'monet', 'pendolo', 'cappella', 'diorama', 'lumiere']
    .map(mode => [`tuning-${mode}`, `src/components/visualizer/${mode}/tuning.ts`]),
  ...['monet', 'nomand', 'latent', 'sora']
    .map(mode => [`tuning-background-${mode}`, `src/components/visualizer/backgrounds/${mode}/tuning.ts`]),
  ['background-url-settings', 'src/components/visualizer/backgrounds/url/settings.ts'],
];
const CONTRACTS = [
  ['visualizer-contract', 'src/components/visualizer/definition.ts'],
  ['background-contract', 'src/components/visualizer/backgrounds/definition.ts'],
  ['tuning-contract', 'src/components/visualizer/tuningDefinition.ts'],
];
const ENTRIES = [
  ...RENDERERS,
  ...BACKGROUNDS.map(([name, file]) => [`background-layer-${name}`, file]),
  ...TUNINGS,
  ...CONTRACTS,
];
const BACKGROUND_ENTRY_NAMES = new Set(BACKGROUNDS.map(([name]) => `background-layer-${name}`));
const TUNING_OR_CONTRACT_ENTRY_NAMES = new Set([...TUNINGS, ...CONTRACTS].map(([name]) => name));
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const MODE_WITH_HOST_PERCENT_HEIGHT = new Set([
  'src/components/visualizer/classic/Visualizer.tsx',
  'src/components/visualizer/cadenza/VisualizerCadenza.tsx',
  'src/components/visualizer/partita/VisualizerPartita.tsx',
  'src/components/visualizer/diorama/VisualizerDiorama.tsx',
]);
const PENDOLO_DRUM_HITS_BRIDGE = `export type DrumHitKind = 0 | 1 | 2;
export const DRUM_KICK: DrumHitKind = 0;
export const DRUM_SNARE: DrumHitKind = 1;
export const DRUM_HAT: DrumHitKind = 2;
export interface DrumHits {
  times: Float64Array;
  strengths: Float32Array;
  kinds: Uint8Array;
  until?: number;
}

let activeTrackKey: string | null = null;
let activeHits: DrumHits | null = null;

/** G4 publishes real keyed drum events here; absent data leaves the source effect at rest. */
export const publishPendoloDrumHits = (trackKey: string, hits: DrumHits | null): void => {
  activeTrackKey = hits ? trackKey : null;
  activeHits = hits;
};

export const clearPendoloDrumHits = (): void => {
  activeTrackKey = null;
  activeHits = null;
};

export const getDrumHits = (trackKey: string | null): DrumHits | null =>
  trackKey !== null && trackKey === activeTrackKey ? activeHits : null;
`;
const DIORAMA_LINE_PREDICATES = `export const INTERLUDE_FULL_TEXT = '......';
export const isInterludeLine = (line: { fullText: string }): boolean => line.fullText === INTERLUDE_FULL_TEXT;
`;
const GENERATED_G3_FILES = [
  {
    vendorPath: 'src/services/beatFx/pendoloDrumHits.ts',
    contents: PENDOLO_DRUM_HITS_BRIDGE,
    purpose: 'Host publish seam for keyed Pendolo drum hits; keeps analysis/drumHits out of G3 closure.',
  },
  {
    vendorPath: 'src/components/visualizer/diorama/linePredicates.ts',
    contents: DIORAMA_LINE_PREDICATES,
    purpose: 'Exact pure isInterludeLine predicate extracted from parserCore without importing lyric parsers.',
  },
];

function posix(value) {
  return value.split(path.sep).join('/');
}

function inside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function getRevision(sourceRoot) {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: sourceRoot,
    encoding: 'utf8',
  }).trim();
}

function normalizeRelative(value) {
  return posix(value).replace(/^\.\//, '');
}

function resolveFile(base, specifier) {
  const unresolved = path.resolve(base, specifier);
  const candidates = [unresolved];
  for (const extension of ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.css', '.json']) {
    candidates.push(`${unresolved}${extension}`);
  }
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch (_) {}
  }
  return unresolved;
}

function replaceOnce(source, pattern, replacement, label) {
  const countPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  const matches = [...source.matchAll(countPattern)];
  if (matches.length !== 1) {
    throw new Error(`SOURCE_PATCH_MISMATCH:${label}:${matches.length}`);
  }
  return source.replace(pattern, replacement);
}

function sortedImages(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function replaceGlobWithManifest(source, sourceRoot, relativeFile, folderName, variablePrefix) {
  const directory = path.join(sourceRoot, path.dirname(relativeFile), folderName);
  const names = sortedImages(directory);
  if (!names.length) throw new Error(`EMPTY_ASSET_MANIFEST:${relativeFile}`);
  const imports = names.map((name, index) => `import ${variablePrefix}${index} from './${folderName}/${name}';`).join('\n');
  const objectEntries = names.map((name, index) => `    ${JSON.stringify(`./${folderName}/${name}`)}: { default: ${variablePrefix}${index} },`).join('\n');
  const generated = `${imports}\n\nconst ${folderName === 'emo' ? 'emoModules' : 'avatarModules'} = {\n${objectEntries}\n} as const;`;
  const pattern = folderName === 'emo'
    ? /const emoModules = import\.meta\.glob[\s\S]*?\);/
    : /const avatarModules = import\.meta\.glob[\s\S]*?\);/;
  return replaceOnce(source, pattern, generated, `${relativeFile}:explicit-${folderName}-manifest`);
}

function transformCappellaTuning(source) {
  source = replaceOnce(source, /^import i18n from .*;\r?\n/m, '', 'cappella-tuning-i18n-import');
  source = replaceOnce(source, /^import \{ setStatusMessage \} from .*;\r?\n/m, '', 'cappella-tuning-status-import');
  source = replaceOnce(source, /^import \{ useVisualizerAssetStore \} from .*;\r?\n/m, '', 'cappella-tuning-assets-import');
  source = replaceOnce(source, /^import \{ cappellaPackActions, type CappellaPackActions \} from .*;\r?\n/m, '', 'cappella-tuning-pack-import');
  source = replaceOnce(source, /,\s*CappellaPackActions \{\}/, ' {}', 'cappella-tuning-module-actions');
  source = replaceOnce(
    source,
    /const asksForMissingEmojiPack = \(patch: Partial<CappellaTuning>\) => \([\s\S]*?\n\);/,
    'const asksForMissingEmojiPack = (_patch: Partial<CappellaTuning>) => false;',
    'cappella-tuning-host-owned-assets',
  );
  source = replaceOnce(source, /        onChange: \(patch\) => \{[\s\S]*?\n        \},\r?\n/, '', 'cappella-tuning-status-action');
  source = replaceOnce(source, /^        actions: cappellaPackActions,\r?\n/m, '', 'cappella-tuning-store-actions');
  return source;
}

function transformMonetTuning(source) {
  source = replaceOnce(source, /^import \{ monetPortraitActions, type MonetPortraitActions \} from .*;\r?\n/m, '', 'monet-tuning-upload-import');
  source = replaceOnce(source, /,\s*MonetPortraitActions \{\}/, ' {}', 'monet-tuning-module-actions');
  source = replaceOnce(source, /^        actions: monetPortraitActions,\r?\n/m, '', 'monet-tuning-store-actions');
  return source;
}

function transformMonetBackgroundTuning(source) {
  source = replaceOnce(source, /^import \{ monetBackgroundImageActions, type MonetBackgroundImageActions \} from .*;\r?\n/m, '', 'monet-background-tuning-upload-import');
  source = replaceOnce(source, /,\s*MonetBackgroundImageActions \{\}/, ' {}', 'monet-background-tuning-module-actions');
  source = replaceOnce(source, /^        actions: monetBackgroundImageActions,\r?\n/m, '', 'monet-background-tuning-store-actions');
  return source;
}

function transformMonetBackgroundLayer(source) {
  source = replaceOnce(source, /^import \{ useReducedMotionFor \} from .*;\r?\n/m, '', 'monet-background-motion-store-import');
  source = replaceOnce(source, /    staticMode\?: boolean;\r?\n\}/, '    staticMode?: boolean;\n    reduceMotion?: boolean;\n}', 'monet-background-host-motion-prop');
  source = replaceOnce(source, /    staticMode = false,\r?\n\}\) => \{/, '    staticMode = false,\n    reduceMotion = false,\n}) => {', 'monet-background-host-motion-default');
  source = replaceOnce(source, /const reduceBackgroundMotion = useReducedMotionFor\('monetBackground'\);/, 'const reduceBackgroundMotion = reduceMotion;', 'monet-background-host-motion-read');
  return source;
}

function transformCappellaFontScale(source) {
  source = replaceOnce(
    source,
    /type VisualizerCappellaProps = VisualizerSharedProps;/,
    'type VisualizerCappellaProps = VisualizerSharedProps & {\n    cappellaFontScale?: number;\n};',
    'host-cappella-font-scale-prop-type',
  );
  source = replaceOnce(
    source,
    /^[\t ]{8}lyricsFontScale = 1,\r?\n/m,
    '        lyricsFontScale = 1,\n        cappellaFontScale = 1,\n',
    'host-cappella-font-scale-prop',
  );
  source = replaceOnce(
    source,
    /const baseFontSize = Math\.max\(15, Math\.min\(26, 18 \* lyricsFontScale\)\);/,
    'const baseFontSize = Math.max(15, Math.min(26, 18 * lyricsFontScale)) * cappellaFontScale;',
    'host-cappella-post-clamp-font-scale',
  );
  source = replaceOnce(
    source,
    /const maxPanelWidth = Math\.min\(Math\.max\(viewportSize\.width - 32, 1\), 896\);/,
    'const maxPanelWidth = Math.max(viewportSize.width * 0.8, 1);',
    'host-cappella-panel-width',
  );
  source = replaceOnce(
    source,
    /<div className="relative z-10 flex h-full w-full items-start justify-center overflow-visible px-4 pb-36 pt-12 sm:px-8 sm:pb-40 sm:pt-16 lg:px-14 lg:pt-20">/,
    '<div className="relative z-10 flex h-full w-full items-start justify-center overflow-visible pb-36 pt-12 sm:pb-40 sm:pt-16 lg:pt-20">',
    'host-cappella-remove-side-padding',
  );
  source = replaceOnce(
    source,
    /<div className="relative flex w-full max-w-4xl flex-col justify-start gap-3 overflow-visible">/,
    '<div className="cappella-message-column relative flex flex-col justify-start gap-3 overflow-visible">',
    'host-cappella-80vw-column',
  );
  source = replaceOnce(
    source,
    /                @keyframes cappella-bubble-glow-pan \{\r?\n                    from \{ transform: translateX\(0\); \}\r?\n                    to \{ transform: translateX\(-50%\); \}\r?\n                \}\r?\n/,
    '',
    'host-cappella-remove-glow-pan-keyframes',
  );
  source = replaceOnce(
    source,
    /                @keyframes cappella-emo-wiggle \{\r?\n                    0%, 100% \{ transform: rotate\(-1\.6deg\); \}\r?\n                    50% \{ transform: rotate\(1\.6deg\); \}\r?\n                \}\r?\n/,
    '',
    'host-cappella-remove-emoji-wiggle-keyframes',
  );
  return source;
}

function transformCappellaEmojiMotion(source) {
  return replaceOnce(
    source,
    /                                        animation: 'cappella-emo-wiggle 1\.9s ease-in-out infinite',\r?\n                                        willChange: 'transform',\r?\n/,
    '',
    'host-cappella-remove-persistent-emoji-wiggle',
  );
}

function transformCappellaBubbleGlow(source) {
  source = replaceOnce(
    source,
    /\/\/ Duplicate one broad sweep in each half so translateX\(0\) and translateX\(-50%\) match exactly\./,
    '// Keep the active bubble highlight soft and static; do not animate its luminance.',
    'host-cappella-static-glow-comment',
  );
  source = replaceOnce(
    source,
    /    if \(!isActive\) \{\r?\n        return null;\r?\n    \}\r?\n\r?\n/,
    '',
    'host-cappella-persistent-glow-layer',
  );
  source = replaceOnce(
    source,
    /opacity: motionConfig\.glowOpacity,/,
    "opacity: isActive ? motionConfig.glowOpacity : 0,\n                transition: 'opacity 180ms ease-out',",
    'host-cappella-glow-opacity-transition',
  );
  source = replaceOnce(
    source,
    /width: '200%',/,
    "width: '100%',",
    'host-cappella-static-glow-width',
  );
  source = replaceOnce(
    source,
    /background: `linear-gradient\(105deg, transparent 0%, \$\{glowColor\} 23%, transparent 34%, transparent 50%, transparent 50%, \$\{glowColor\} 73%, transparent 84%, transparent 100%\)`,/,
    'background: `radial-gradient(ellipse at 35% 45%, ${glowColor} 0%, transparent 72%)`,',
    'host-cappella-static-glow-background',
  );
  source = replaceOnce(
    source,
    /                animation: `cappella-bubble-glow-pan \$\{motionConfig\.glowDuration\}s linear infinite`,\r?\n                willChange: 'transform',/,
    '',
    'host-cappella-remove-continuous-glow-animation',
  );
  return source;
}

function transformViewportSource(source, relativeFile) {
  if (relativeFile === 'src/components/visualizer/classic/Visualizer.tsx') {
    source = replaceOnce(source, /import React, \{([^}]+)\} from 'react';/, (whole, list) => {
      const names = list.split(',').map(value => value.trim());
      if (!names.includes('useRef')) names.push('useRef');
      return `import React, { ${names.join(', ')} } from 'react';`;
    }, 'classic-react-useRef');
    source = replaceOnce(
      source,
      /    const \[viewportWidth, setViewportWidth\] = useState\(\(\) => \(\s*typeof window === 'undefined' \? 1200 : window\.innerWidth\s*\)\);\s*\n\s*useEffect\(\(\) => \{\s*const handleResize = \(\) => \{\s*setViewportWidth\(window\.innerWidth\);\s*\};\s*window\.addEventListener\('resize', handleResize\);\s*return \(\) => window\.removeEventListener\('resize', handleResize\);\s*\}, \[\]\);/,
      `    const shellRef = useRef<HTMLDivElement | null>(null);\n    const [viewportWidth, setViewportWidth] = useState(1200);\n\n    useEffect(() => {\n        const element = shellRef.current;\n        if (!element) return;\n        const updateWidth = () => {\n            const width = Math.round(element.clientWidth);\n            if (width > 0) setViewportWidth(width);\n        };\n        updateWidth();\n        const observer = new ResizeObserver(updateWidth);\n        observer.observe(element);\n        return () => observer.disconnect();\n    }, []);`,
      'classic-host-width',
    );
    source = replaceOnce(source, /        <VisualizerShell\r?\n            theme=\{theme\}/, '        <VisualizerShell\n            ref={shellRef}\n            theme={theme}', 'classic-shell-ref');
  }

  if (relativeFile === 'src/components/visualizer/partita/VisualizerPartita.tsx') {
    source = replaceOnce(
      source,
      /    const \[windowHeight, setWindowHeight\] = useState\(800\);\s*\n\s*const resolvedPartitaTuning/,
      '    const shellRef = useRef<HTMLDivElement | null>(null);\n    const [windowHeight, setWindowHeight] = useState(800);\n    const resolvedPartitaTuning',
      'partita-shell-ref-state',
    );
    source = replaceOnce(
      source,
      /    useEffect\(\(\) => \{\s*setWindowHeight\(window\.innerHeight\);\s*const handleResize = \(\) => setWindowHeight\(window\.innerHeight\);\s*window\.addEventListener\('resize', handleResize\);\s*return \(\) => window\.removeEventListener\('resize', handleResize\);\s*\}, \[\]\);/,
      `    useEffect(() => {\n        const element = shellRef.current;\n        if (!element) return;\n        const updateHeight = () => {\n            const height = Math.round(element.clientHeight);\n            if (height > 0) setWindowHeight(height);\n        };\n        updateHeight();\n        const observer = new ResizeObserver(updateHeight);\n        observer.observe(element);\n        return () => observer.disconnect();\n    }, []);`,
      'partita-host-height',
    );
    source = replaceOnce(source, /        <VisualizerShell\r?\n            theme=\{theme\}/, '        <VisualizerShell\n            ref={shellRef}\n            theme={theme}', 'partita-shell-ref');
  }

  if (relativeFile === 'src/components/visualizer/pendolo/VisualizerPendolo.tsx') {
    source = replaceOnce(source, /^import \{ useVisualizerSettingsStore \} from .*;\r?\n/m, '', 'pendolo-settings-store-import');
    source = replaceOnce(source, /^import \{ smartBeatActive \} from .*;\r?\n/m, '', 'pendolo-smartbeat-store-import');
    source = replaceOnce(
      source,
      /const VisualizerPendolo: React\.FC<VisualizerSharedProps> = \(props\) => \{/,
      'type VisualizerPendoloProps = VisualizerSharedProps & { smartBeatEnabled?: boolean; };\nconst VisualizerPendolo: React.FC<VisualizerPendoloProps> = (props) => {',
      'pendolo-host-smartbeat-prop-type',
    );
    source = replaceOnce(
      source,
      /width: typeof window !== 'undefined' \? window\.innerWidth : 1920,\s*\n\s*height: typeof window !== 'undefined' \? window\.innerHeight : 1080,/,
      'width: 1,\n        height: 1,',
      'pendolo-host-viewport-initial',
    );
    source = replaceOnce(
      source,
      /const smartBeatEnabled = useVisualizerSettingsStore\(state => smartBeatActive\(state\.smartBeat\)\);/,
      'const smartBeatEnabled = props.smartBeatEnabled ?? false;',
      'pendolo-host-smartbeat-read',
    );
  }

  if (relativeFile === 'src/components/visualizer/cappella/VisualizerCappella.tsx') {
    source = replaceOnce(
      source,
      /    const \[viewportSize, setViewportSize\] = useState\(\(\) => \(\s*typeof window === 'undefined'\s*\? \{ width: 1280, height: 900 \}\s*: \{ width: window\.innerWidth, height: window\.innerHeight \}\s*\)\);/,
      '    const shellRef = useRef<HTMLDivElement | null>(null);\n    const [viewportSize, setViewportSize] = useState({ width: 1280, height: 900 });',
      'host-cappella-viewport-state',
    );
    source = replaceOnce(
      source,
      /    useEffect\(\(\) => \{\s*const handleResize = \(\) => \{\s*setViewportSize\(\{\s*width: window\.innerWidth,\s*height: window\.innerHeight,\s*\}\);\s*\};\s*window\.addEventListener\('resize', handleResize\);\s*return \(\) => window\.removeEventListener\('resize', handleResize\);\s*\}, \[\]\);/,
      `    useEffect(() => {\n        const element = shellRef.current;\n        if (!element) return;\n        const updateSize = () => {\n            const width = Math.round(element.clientWidth);\n            const height = Math.round(element.clientHeight);\n            if (width > 0 && height > 0) {\n                setViewportSize(previous => (\n                    previous.width === width && previous.height === height\n                        ? previous\n                        : { width, height }\n                ));\n            }\n        };\n        updateSize();\n        const observer = new ResizeObserver(updateSize);\n        observer.observe(element);\n        return () => observer.disconnect();\n    }, []);`,
      'host-cappella-viewport-observer',
    );
    source = replaceOnce(source, /        <VisualizerShell\r?\n            theme=\{theme\}/, '        <VisualizerShell\n            ref={shellRef}\n            theme={theme}', 'host-cappella-shell-ref');
  }

  if (MODE_WITH_HOST_PERCENT_HEIGHT.has(relativeFile)) {
    source = replaceOnce(source, /h-\[70vh\]/g, 'h-[70%]', `${relativeFile}:host-height-class`);
  }
  return source;
}

function transformSource(relativeFile, sourceRoot, contents) {
  const normalized = normalizeRelative(relativeFile);
  if (IMAGE_EXTENSIONS.has(path.extname(normalized).toLowerCase())) return contents;
  let source = contents.toString('utf8');
  if (normalized === 'src/components/visualizer/classic/Visualizer.tsx') {
    source = replaceOnce(source, /fontSize=\{mainFontSize\}/, 'fontSize={`min(${mainFontSize}, ${Math.max(10, viewportWidth * 0.58 / Math.max(1, Array.from(activeLine.fullText).length))}px)`}', 'host-classic-long-line-fit');
  }
  if (normalized === 'src/components/visualizer/cappella/emoImages.ts') {
    source = replaceGlobWithManifest(source, sourceRoot, normalized, 'emo', 'builtinEmoAsset');
  } else if (normalized === 'src/components/visualizer/cappella/avatarImages.ts') {
    source = replaceGlobWithManifest(source, sourceRoot, normalized, 'avatar', 'builtinAvatarAsset');
  } else if (normalized === 'src/components/visualizer/cappella/tuning.ts') {
    source = transformCappellaTuning(source);
  } else if (normalized === 'src/components/visualizer/monet/tuning.ts') {
    source = transformMonetTuning(source);
  } else if (normalized === 'src/components/visualizer/backgrounds/monet/tuning.ts') {
    source = transformMonetBackgroundTuning(source);
  } else if (normalized === 'src/components/visualizer/backgrounds/monet/MonetBackgroundLayer.tsx') {
    source = transformMonetBackgroundLayer(source);
  } else if (normalized === 'src/components/visualizer/cappella/VisualizerCappella.tsx') {
    source = transformCappellaFontScale(source);
  } else if (normalized === 'src/components/visualizer/cappella/CappellaBubbleParts.tsx') {
    source = transformCappellaBubbleGlow(source);
  } else if (normalized === 'src/components/visualizer/cappella/CappellaMessageRow.tsx') {
    source = transformCappellaEmojiMotion(source);
  } else if (normalized === 'src/components/visualizer/pendolo/usePendoloBeatFx.ts') {
    source = replaceOnce(
      source,
      /^import \{ DRUM_HAT, DRUM_KICK, DRUM_SNARE, getDrumHits, type DrumHits \} from '\.\.\/\.\.\/\.\.\/services\/analysis\/drumHits';\r?\n/m,
      "import { DRUM_HAT, DRUM_KICK, DRUM_SNARE, getDrumHits, type DrumHits } from '../../../services/beatFx/pendoloDrumHits';\n",
      'pendolo-host-drum-hit-publisher',
    );
  } else if (normalized === 'src/components/visualizer/diorama/VisualizerDiorama.tsx') {
    source = replaceOnce(
      source,
      /^import \{ isInterludeLine \} from '\.\.\/\.\.\/\.\.\/utils\/lyrics\/parserCore';\r?\n/m,
      "import { isInterludeLine } from './linePredicates';\n",
      'diorama-pure-interlude-predicate',
    );
  }
  source = transformViewportSource(source, normalized);
  return source;
}

function readProtectedPaths() {
  const meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
  const paths = new Set(['src/types.ts']);
  for (const seam of meta.hostSeams || []) paths.add(normalizeRelative(seam.vendorPath));
  for (const file of meta.sourceFiles || []) {
    if (file.vendorSha256 && file.sourceSha256 && file.vendorSha256 !== file.sourceSha256) {
      paths.add(normalizeRelative(file.vendorPath));
    }
  }
  // These Cappella host transforms are reproducible from the pinned source checkout.
  paths.delete('src/components/visualizer/cappella/CappellaMessageRow.tsx');
  paths.delete('src/components/visualizer/cappella/CappellaBubbleParts.tsx');
  paths.delete('src/components/visualizer/cappella/VisualizerCappella.tsx');
  return { meta, paths };
}

function makePlugin(sourceRoot, protectedPaths) {
  return {
    name: 'folia-complete-safe-source',
    setup(build) {
      build.onResolve({ filter: /^\.\.?\// }, args => {
        if (
          args.path === './linePredicates'
          && normalizeRelative(path.relative(sourceRoot, args.importer)) === 'src/components/visualizer/diorama/VisualizerDiorama.tsx'
        ) {
          return { path: path.join(DEST_ROOT, 'src/components/visualizer/diorama/linePredicates.ts') };
        }
        if (
          args.path === '../../../services/beatFx/pendoloDrumHits'
          && normalizeRelative(path.relative(sourceRoot, args.importer)) === 'src/components/visualizer/pendolo/usePendoloBeatFx.ts'
        ) {
          return { path: path.join(DEST_ROOT, 'src/services/beatFx/pendoloDrumHits.ts') };
        }
        const candidate = resolveFile(args.resolveDir, args.path);
        if (!fs.existsSync(candidate)) return null;
        if (inside(DEST_ROOT, candidate)) return { path: candidate };
        if (inside(sourceRoot, candidate)) {
          const relative = normalizeRelative(path.relative(sourceRoot, candidate));
          if (protectedPaths.has(relative)) {
            const protectedTarget = path.join(DEST_ROOT, ...relative.split('/'));
            if (!fs.existsSync(protectedTarget)) throw new Error(`MISSING_PROTECTED_G2_FILE:${relative}`);
            return { path: protectedTarget };
          }
          return { path: candidate };
        }
        return { path: candidate };
      });
      build.onResolve({ filter: /^@\// }, args => ({ errors: [{ text: `FOLIA_APP_ALIAS_NOT_ALLOWED:${args.path}` }] }));
      build.onResolve({ filter: /^virtual:/ }, args => ({ errors: [{ text: `FOLIA_VIRTUAL_IMPORT_NOT_ALLOWED:${args.path}:importer:${args.importer}` }] }));
      build.onLoad({ filter: /\.(?:tsx?|jsx?)$/ }, args => {
        const generatedFile = GENERATED_G3_FILES.find(file => (
          path.resolve(args.path) === path.join(DEST_ROOT, ...file.vendorPath.split('/'))
        ));
        if (generatedFile) {
          return { contents: generatedFile.contents, loader: 'ts', resolveDir: path.dirname(args.path) };
        }
        if (!inside(sourceRoot, args.path)) return null;
        const relative = normalizeRelative(path.relative(sourceRoot, args.path));
        const raw = fs.readFileSync(args.path);
        const transformed = transformSource(relative, sourceRoot, raw);
        if (/^\s*import\s+[^;]*from\s+['"][^'"]*i18n\/config['"]/m.test(transformed)) {
          throw new Error(`FOLIA_APP_I18N_IMPORT_SURVIVED:${relative}`);
        }
        return {
          contents: transformed,
          loader: path.extname(args.path) === '.tsx' ? 'tsx' : path.extname(args.path) === '.jsx' ? 'jsx' : path.extname(args.path) === '.ts' ? 'ts' : 'js',
          resolveDir: path.dirname(args.path),
        };
      });
      build.onLoad({ filter: /\.css$/ }, args => {
        if (!inside(sourceRoot, args.path)) return null;
        throw new Error(`UNSCOPED_G3_CSS_IMPORT:${normalizeRelative(path.relative(sourceRoot, args.path))}`);
      });
    },
  };
}

function packageName(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0];
}

function isPackageSpecifier(specifier) {
  return !specifier.startsWith('.')
    && !specifier.startsWith('<')
    && !specifier.startsWith('virtual:')
    && !specifier.startsWith('node:')
    && !path.isAbsolute(specifier)
    && !specifier.startsWith('file:');
}

async function analyze(sourceRoot, protectedPaths) {
  const entryNames = ENTRIES.map(([name]) => name);
  if (new Set(entryNames).size !== entryNames.length) {
    throw new Error(`DUPLICATE_G3_ENTRY_NAMES:${entryNames.join(',')}`);
  }
  const entryPoints = Object.fromEntries(ENTRIES.map(([name, file]) => [name, file]));
  const result = await esbuild.build({
    absWorkingDir: sourceRoot,
    entryPoints,
    outdir: path.join(require('os').tmpdir(), 'folia-complete-g3-closure'),
    bundle: true,
    write: false,
    metafile: true,
    packages: 'external',
    platform: 'browser',
    format: 'esm',
    target: 'es2020',
    minify: false,
    loader: {
      '.png': 'file', '.jpg': 'file', '.jpeg': 'file', '.gif': 'file', '.webp': 'file', '.svg': 'file',
    },
    assetNames: 'assets/[name]-[hash]',
    alias: {
      'lucide-react/dynamicIconImports': path.join(REPO_ROOT, 'src', 'karaoke', 'folia', 'iconImports.js'),
    },
    define: {
      'import.meta.env.DEV': 'false',
      'import.meta.env.PROD': 'true',
      'process.env.NODE_ENV': '"production"',
    },
    plugins: [makePlugin(sourceRoot, protectedPaths)],
    logLevel: 'silent',
  });

  const inputs = Object.entries(result.metafile.inputs);
  const externalPackages = new Set();
  const sourceFiles = new Set();
  const copiedCss = [];
  for (const [input, details] of inputs) {
    const absolute = path.isAbsolute(input) ? input : path.resolve(sourceRoot, input);
    if (inside(sourceRoot, absolute)) sourceFiles.add(normalizeRelative(path.relative(sourceRoot, absolute)));
    if (inside(sourceRoot, absolute) && path.extname(absolute).toLowerCase() === '.css') {
      copiedCss.push(normalizeRelative(path.relative(sourceRoot, absolute)));
    }
    for (const imported of details.imports || []) {
      if (imported.external && isPackageSpecifier(imported.path)) {
        externalPackages.add(packageName(imported.path));
      }
    }
  }

  const forbiddenInputs = [...sourceFiles].filter(file => (
    /(?:^|\/)stores\/(?!motionSignals\.ts$)/.test(file)
    || /(?:^|\/)services\/analysis\//.test(file)
    || /(?:^|\/)VisualizerRenderer\./.test(file)
    || /(?:^|\/)visualizer\/registry\./.test(file)
    || /(?:^|\/)backgrounds\/registry\./.test(file)
    || /(?:^|\/)VisualizerShell\./.test(file)
    || /(?:^|\/)VisualizerSubtitleOverlay\./.test(file)
  ));
  if (forbiddenInputs.length) throw new Error(`FORBIDDEN_SOURCE_CLOSURE:${forbiddenInputs.join(',')}`);
  if (copiedCss.length) throw new Error(`UNSCOPED_G3_CSS_INPUTS:${copiedCss.join(',')}`);

  const existingPackages = require(path.join(REPO_ROOT, 'package.json'));
  const declared = new Set([
    ...Object.keys(existingPackages.dependencies || {}),
    ...Object.keys(existingPackages.devDependencies || {}),
  ]);
  const external = [...externalPackages].sort();
  return {
    entryPoints: ENTRIES.map(([name, file]) => ({
      name,
      path: file,
      group: BACKGROUND_ENTRY_NAMES.has(name)
        ? 'background'
        : TUNING_OR_CONTRACT_ENTRY_NAMES.has(name) ? 'tuning-or-contract' : 'renderer',
    })),
    sourceFiles: [...sourceFiles].sort(),
    externalPackages: external,
    missingPackages: external.filter(name => !declared.has(name)),
    cssFiles: copiedCss,
    inputs: result.metafile.inputs,
  };
}

function inputToSource(sourceRoot, input) {
  const absolute = path.isAbsolute(input) ? input : path.resolve(sourceRoot, input);
  if (!inside(sourceRoot, absolute)) return null;
  return {
    absolute,
    relative: normalizeRelative(path.relative(sourceRoot, absolute)),
  };
}

function updateProvenance(sourceRoot, revision, analysis, protectedPaths, oldMeta, doCopy) {
  const records = [];
  const inputPaths = Object.keys(analysis.inputs).sort();
  for (const input of inputPaths) {
    const source = inputToSource(sourceRoot, input);
    if (!source || protectedPaths.has(source.relative)) continue;
    const sourceBytes = fs.readFileSync(source.absolute);
    const transformed = transformSource(source.relative, sourceRoot, sourceBytes);
    const target = path.join(DEST_ROOT, ...source.relative.split('/'));
    const targetHashBefore = fs.existsSync(target) ? sha256(fs.readFileSync(target)) : null;
    const previousRecord = oldMeta.g3?.sourceFiles?.find(file => file.vendorPath === source.relative);
    if (targetHashBefore && previousRecord && targetHashBefore !== previousRecord.vendorSha256) {
      throw new Error(`LOCAL_G3_EDIT_WOULD_BE_OVERWRITTEN:${source.relative}`);
    }
    if (targetHashBefore && !previousRecord && targetHashBefore !== sha256(transformed)) {
      throw new Error(`UNTRACKED_VENDOR_COLLISION:${source.relative}`);
    }
    if (doCopy) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (targetHashBefore !== sha256(transformed)) fs.writeFileSync(target, transformed);
    }
    records.push({
      sourcePath: source.relative,
      vendorPath: source.relative,
      sourceSha256: sha256(sourceBytes),
      vendorSha256: sha256(transformed),
      ...(sha256(sourceBytes) !== sha256(transformed) ? { transforms: transformLabels(source.relative) } : {}),
    });
  }

  const generatedFiles = [];
  for (const generated of GENERATED_G3_FILES) {
    const target = path.join(DEST_ROOT, ...generated.vendorPath.split('/'));
    const bytes = Buffer.from(generated.contents, 'utf8');
    const hash = sha256(bytes);
    const previous = oldMeta.g3?.generatedFiles?.find(file => file.vendorPath === generated.vendorPath);
    const before = fs.existsSync(target) ? sha256(fs.readFileSync(target)) : null;
    if (before && previous && before !== previous.sha256) {
      throw new Error(`LOCAL_G3_GENERATED_FILE_WOULD_BE_OVERWRITTEN:${generated.vendorPath}`);
    }
    if (before && !previous && before !== hash) {
      throw new Error(`UNTRACKED_VENDOR_GENERATED_COLLISION:${generated.vendorPath}`);
    }
    if (doCopy) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (before !== hash) fs.writeFileSync(target, bytes);
    }
    generatedFiles.push({ vendorPath: generated.vendorPath, sha256: hash, purpose: generated.purpose });
  }

  const supportFiles = [];
  for (const support of SUPPORT_SOURCE_FILES) {
    const sourceAbsolute = path.join(sourceRoot, ...support.sourcePath.split('/'));
    if (!fs.existsSync(sourceAbsolute)) throw new Error(`MISSING_SUPPORT_SOURCE:${support.sourcePath}`);
    const sourceBytes = fs.readFileSync(sourceAbsolute);
    const target = path.join(DEST_ROOT, ...support.sourcePath.split('/'));
    const before = fs.existsSync(target) ? sha256(fs.readFileSync(target)) : null;
    const sourceHash = sha256(sourceBytes);
    const previous = oldMeta.g3?.supportFiles?.find(file => file.vendorPath === support.sourcePath);
    if (before && previous && before !== previous.vendorSha256) {
      throw new Error(`LOCAL_G3_SUPPORT_FILE_WOULD_BE_OVERWRITTEN:${support.sourcePath}`);
    }
    if (before && !previous && before !== sourceHash) {
      throw new Error(`UNTRACKED_VENDOR_SUPPORT_COLLISION:${support.sourcePath}`);
    }
    if (doCopy) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (before !== sourceHash) fs.writeFileSync(target, sourceBytes);
    }
    supportFiles.push({
      sourcePath: support.sourcePath,
      vendorPath: support.sourcePath,
      sourceSha256: sourceHash,
      vendorSha256: sourceHash,
      purpose: support.purpose,
    });
  }

  const licenseSource = path.join(sourceRoot, 'LICENSE');
  const licenseTarget = path.join(DEST_ROOT, 'LICENSE');
  const licenseBytes = fs.readFileSync(licenseSource);
  if (doCopy && !fs.existsSync(licenseTarget)) fs.writeFileSync(licenseTarget, licenseBytes);
  if (doCopy) {
    const hostCssPath = path.join(REPO_ROOT, 'src', 'karaoke', 'folia', 'complete.css');
    const hostCssBytes = fs.readFileSync(hostCssPath);
    oldMeta.css = {
      ...oldMeta.css,
      source: 'src/karaoke/folia/complete.css',
      sha256: sha256(hostCssBytes),
    };
    oldMeta.g3 = {
      revision,
      sourceCheckout: sourceRoot,
      entryPoints: analysis.entryPoints,
      sourceFiles: records,
      generatedFiles,
      supportFiles,
      externalPackages: analysis.externalPackages,
      missingPackages: analysis.missingPackages,
      cssFiles: analysis.cssFiles,
      license: { path: 'LICENSE', sha256: sha256(licenseBytes) },
    };
    fs.writeFileSync(META_PATH, `${JSON.stringify(oldMeta, null, 2)}\n`);
  }
  return records;
}

function transformLabels(relative) {
  const labels = [];
  if (relative.endsWith('/cappella/emoImages.ts')) labels.push('vite-glob-to-static-image-imports');
  if (relative.endsWith('/cappella/avatarImages.ts')) labels.push('vite-glob-to-static-image-imports');
  if (relative.endsWith('/cappella/tuning.ts')) labels.push('strip-app-asset-store-actions');
  if (relative.endsWith('/monet/tuning.ts')) labels.push('strip-app-portrait-store-actions');
  if (relative.endsWith('/backgrounds/monet/tuning.ts')) labels.push('strip-app-background-image-actions');
  if (relative.endsWith('/backgrounds/monet/MonetBackgroundLayer.tsx')) labels.push('host-reduced-motion-prop');
  if (relative.includes('/classic/Visualizer.tsx')) labels.push('host-shell-resize-observer', 'host-relative-70-percent-height');
  if (relative.includes('/partita/VisualizerPartita.tsx')) labels.push('host-shell-resize-observer', 'host-relative-70-percent-height');
  if (relative.includes('/cappella/VisualizerCappella.tsx')) labels.push(
    'host-cappella-viewport-state',
    'host-cappella-viewport-observer',
    'host-cappella-shell-ref',
    'host-cappella-font-scale-prop-type',
    'host-cappella-font-scale-prop',
    'host-cappella-post-clamp-font-scale',
    'host-cappella-panel-width',
    'host-cappella-remove-side-padding',
    'host-cappella-80vw-column',
    'host-cappella-remove-glow-pan-keyframes',
    'host-cappella-remove-emoji-wiggle-keyframes',
  );
  if (relative.endsWith('/cappella/CappellaMessageRow.tsx')) labels.push(
    'host-cappella-remove-persistent-emoji-wiggle',
  );
  if (relative.endsWith('/cappella/CappellaBubbleParts.tsx')) labels.push(
    'host-cappella-static-glow-comment',
    'host-cappella-persistent-glow-layer',
    'host-cappella-glow-opacity-transition',
    'host-cappella-static-glow-width',
    'host-cappella-static-glow-background',
    'host-cappella-remove-continuous-glow-animation',
  );
  if (relative.includes('/pendolo/VisualizerPendolo.tsx')) labels.push('host-smartbeat-prop', 'bounded-initial-host-size');
  if (relative.includes('/pendolo/usePendoloBeatFx.ts')) labels.push('host-published-drum-hit-bridge');
  if (relative.includes('/diorama/VisualizerDiorama.tsx')) labels.push('pure-interlude-predicate-extraction');
  if (relative.includes('/cadenza/VisualizerCadenza.tsx') || relative.includes('/diorama/VisualizerDiorama.tsx')) labels.push('host-relative-70-percent-height');
  return labels;
}

async function main() {
  const args = process.argv.slice(2);
  const sourceArg = args.find(value => !value.startsWith('--'));
  const sourceRoot = path.resolve(sourceArg || process.env.FOLIA_SOURCE || DEFAULT_SOURCE);
  const analyzeOnly = args.includes('--analyze');
  if (!fs.existsSync(META_PATH)) throw new Error(`MISSING_UPSTREAM_PROVENANCE:${META_PATH}`);
  if (!fs.existsSync(path.join(sourceRoot, '.git'))) throw new Error(`NOT_A_GIT_CHECKOUT:${sourceRoot}`);
  const revision = getRevision(sourceRoot);
  if (revision !== REVISION) throw new Error(`UPSTREAM_REVISION_MISMATCH:${revision}:expected:${REVISION}`);
  const { meta, paths: protectedPaths } = readProtectedPaths();
  const analysis = await analyze(sourceRoot, protectedPaths);
  console.log(JSON.stringify({
    revision,
    rendererCount: RENDERERS.length,
    backgroundCount: BACKGROUNDS.length,
    sourceClosureCount: analysis.sourceFiles.length,
    generatedHostFileCount: GENERATED_G3_FILES.length,
    externalPackages: analysis.externalPackages,
    missingPackages: analysis.missingPackages,
    cssFiles: analysis.cssFiles,
  }, null, 2));
  if (analyzeOnly) return;
  const records = updateProvenance(sourceRoot, revision, analysis, protectedPaths, meta, true);
  console.log(`Copied ${records.length} closure source files and ${meta.g3.supportFiles.length} support files; preserved ${protectedPaths.size} protected G2/type files.`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
