const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const esbuild = require('esbuild');

const filename = path.resolve('src/karaoke/folia/rendererContracts.js');
const compiled = esbuild.buildSync({
  entryPoints: [filename],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  target: 'node16',
}).outputFiles[0].text;
const loaded = new Module(filename, module);
loaded.paths = module.paths;
loaded._compile(compiled, filename);

const {
  FOLIA_RENDERER_CONTRACTS,
  FOLIA_BACKGROUND_MODULES,
  mergeModeTuning,
  normalizeVisualAssets,
  resolveBackgroundRootOpacity,
  resolveCommonOverlayOpacity,
  resolveBackgroundImage,
  resolveBackgroundTuning,
  resolveUrlBackgroundProps,
  getOrCompileLumiereProgram,
  supportsRuntimeUpdateMode,
  toSourceBackgroundConfig,
  resolveModeLyricFontScale,
  resolveModeVisualScale,
  resolveCappellaFontScale,
  hidesSharedSubtitleOverlay,
} = loaded.exports;

assert.equal(typeof resolveModeLyricFontScale, 'function');
assert.equal(typeof resolveModeVisualScale, 'function');
assert.equal(typeof resolveCappellaFontScale, 'function');
assert.equal(typeof hidesSharedSubtitleOverlay, 'function');

assert.equal(resolveModeLyricFontScale('monet', 1), 1.3);
assert.equal(resolveModeLyricFontScale('monet', 0.8), 1.04);
assert.equal(resolveModeLyricFontScale('pendolo', 1), 1.2);
assert.equal(resolveModeLyricFontScale('cappella', 1), 1);
assert.equal(resolveCappellaFontScale('cappella'), 1.05);
assert.equal(resolveModeVisualScale('cappella'), 1);
assert.ok(
  Math.abs(
    resolveCappellaFontScale('cappella') * resolveModeVisualScale('cappella') -
      1.05
  ) < 1e-9
);
assert.equal(resolveModeLyricFontScale('fume', 1), 1);
assert.equal(resolveModeVisualScale('monet'), 1);
assert.equal(hidesSharedSubtitleOverlay('fume'), true);
assert.equal(hidesSharedSubtitleOverlay('cappella'), true);
assert.equal(hidesSharedSubtitleOverlay('partita'), true);
assert.equal(hidesSharedSubtitleOverlay('claddagh'), true);
assert.equal(hidesSharedSubtitleOverlay('diorama'), true);
assert.equal(hidesSharedSubtitleOverlay('classic'), true);
assert.equal(hidesSharedSubtitleOverlay('folia-classic'), true);
assert.equal(hidesSharedSubtitleOverlay('cadenza'), true);
assert.equal(hidesSharedSubtitleOverlay('tilt'), true);
assert.equal(hidesSharedSubtitleOverlay('sonnet'), false);
assert.equal(hidesSharedSubtitleOverlay('tempera'), false);
assert.equal(hidesSharedSubtitleOverlay('lumiere'), false);
assert.equal(hidesSharedSubtitleOverlay('hanabi'), false);
assert.equal(hidesSharedSubtitleOverlay('monet'), false);
assert.equal(hidesSharedSubtitleOverlay('pendolo'), false);
assert.equal(hidesSharedSubtitleOverlay('still'), false);

const expectedModes = [
  'sonnet',
  'tempera',
  'lumiere',
  'hanabi',
  'folia-classic',
  'cadenza',
  'partita',
  'fume',
  'tilt',
  'claddagh',
  'monet',
  'pendolo',
  'cappella',
  'diorama',
  'still',
];

assert.deepStrictEqual(Object.keys(FOLIA_RENDERER_CONTRACTS), expectedModes);
assert.equal(
  FOLIA_RENDERER_CONTRACTS['folia-classic'].module,
  'components/visualizer/classic/Visualizer',
  'Folia classic uses an isolated renderer id and its named leaf module'
);
assert.equal(
  FOLIA_RENDERER_CONTRACTS.lumiere.module,
  'components/visualizer/lumiere/createLumierePixiRuntime',
  'Lumiere mounts its original Pixi runtime class'
);
assert.equal(
  FOLIA_RENDERER_CONTRACTS.hanabi.defaultTuningModule,
  'hanabi/types'
);
assert.equal(FOLIA_RENDERER_CONTRACTS.fume.tuningProp, 'fumeTuning');
assert.equal(FOLIA_RENDERER_CONTRACTS.cappella.tuningProp, 'cappellaTuning');
assert.equal(FOLIA_RENDERER_CONTRACTS.still.tuningProp, null);
assert.equal(supportsRuntimeUpdateMode('cadenza'), true);
assert.equal(supportsRuntimeUpdateMode('lumiere'), false);
assert.deepStrictEqual(Object.keys(FOLIA_BACKGROUND_MODULES), [
  'common',
  'monet',
  'nomand',
  'latent',
  'url',
  'sora',
]);

const defaults = Object.freeze({ speed: 1, nested: { keep: true } });
const tuning = mergeModeTuning(defaults, { speed: 2, extra: false });
assert.deepStrictEqual(tuning, {
  speed: 2,
  nested: { keep: true },
  extra: false,
});
assert.notStrictEqual(
  tuning,
  defaults,
  'partial overrides must not mutate original defaults'
);
assert.deepStrictEqual(defaults, { speed: 1, nested: { keep: true } });
assert.strictEqual(mergeModeTuning(defaults, null), defaults);

const visualConfigFilename = path.resolve('src/karaoke/visualConfig.js');
const visualConfigBundle = esbuild.buildSync({
  entryPoints: [visualConfigFilename],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  target: 'node16',
}).outputFiles[0].text;
const visualConfigModule = new Module(visualConfigFilename, module);
visualConfigModule.paths = module.paths;
visualConfigModule._compile(visualConfigBundle, visualConfigFilename);
const { normalizeVisualConfig } = visualConfigModule.exports;
const normalizedCommon = normalizeVisualConfig(
  {
    background: {
      mode: 'common',
      tuning: { useCoverColorBg: true, opacity: 0.35 },
    },
  },
  { backgroundModes: ['legacy', 'common'] }
);
assert.equal(normalizedCommon.background.opacity, 1);
assert.equal(normalizedCommon.background.tuning.opacity, 0.35);
assert.equal(
  resolveBackgroundRootOpacity(normalizedCommon.background),
  1,
  'the background host applies the general opacity once'
);
assert.equal(
  resolveCommonOverlayOpacity(normalizedCommon.background),
  0.35,
  'Common keeps its original tuning opacity despite the normalized top-level default'
);
const composedCommon = normalizeVisualConfig(
  {
    background: {
      mode: 'common',
      tuning: { useCoverColorBg: true, opacity: 0.35 },
      opacity: 0.5,
    },
  },
  { backgroundModes: ['legacy', 'common'] }
).background;
assert.equal(resolveBackgroundRootOpacity(composedCommon), 0.5);
assert.equal(resolveCommonOverlayOpacity(composedCommon), 0.35);
assert.equal(
  resolveBackgroundRootOpacity({ ...composedCommon, transparent: true }),
  0,
  'transparent mode suppresses the general background opacity'
);

const lumiereProgramFilename = path.resolve(
  'vendor/folia-complete/src/components/visualizer/lumiere/lumiereProgram.ts'
);
const lumiereProgramBundle = esbuild.buildSync({
  entryPoints: [lumiereProgramFilename],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  target: 'node16',
}).outputFiles[0].text;
const lumiereProgramModule = new Module(lumiereProgramFilename, module);
lumiereProgramModule.paths = module.paths;
lumiereProgramModule._compile(lumiereProgramBundle, lumiereProgramFilename);
const { compileLumiereProgram } = lumiereProgramModule.exports;
const lumiereCache = new Map();
const compileLumiere = (lines, seed, options) =>
  compileLumiereProgram(lines, seed, {}, options);
const firstLumiere = getOrCompileLumiereProgram({
  cache: lumiereCache,
  lines: [],
  seed: 'duration-check',
  duration: 73,
  compileOptions: { seamless: false },
  compile: compileLumiere,
});
assert.equal(
  firstLumiere.program.duration,
  73,
  'the original song duration reaches the Lumiere compiler'
);
assert.strictEqual(
  getOrCompileLumiereProgram({
    cache: lumiereCache,
    lines: [],
    seed: 'duration-check',
    duration: 73,
    compileOptions: { seamless: false },
    compile: compileLumiere,
  }).program,
  firstLumiere.program,
  'identical compile inputs reuse the program cache'
);
const longerLumiere = getOrCompileLumiereProgram({
  cache: lumiereCache,
  lines: [],
  seed: 'duration-check',
  duration: 74,
  compileOptions: { seamless: false },
  compile: compileLumiere,
});
assert.equal(longerLumiere.program.duration, 74);
assert.notStrictEqual(
  longerLumiere.program,
  firstLumiere.program,
  'a duration change recompiles Lumiere'
);
const separateLumiere = getOrCompileLumiereProgram({
  cache: lumiereCache,
  lines: [],
  seed: 'duration-check',
  duration: 73,
  compileOptions: { seamless: true },
  compile: compileLumiere,
});
assert.notStrictEqual(
  separateLumiere.program,
  firstLumiere.program,
  'a compile-only seamless transition change gets a different program'
);

const image = { id: 'asset-1', url: 'https://example.test/image.jpg' };
assert.strictEqual(
  resolveBackgroundImage({ assetId: 'asset-1' }, { backgroundImage: image }),
  image
);
assert.strictEqual(
  resolveBackgroundImage({ assetId: 'other' }, { backgroundImage: image }),
  null,
  'an unrelated asset must not be supplied to the selected background'
);
const richImage = {
  id: 'asset-with-metadata',
  name: 'Concert photo',
  url: '/pv/assets/concert-photo.webp',
  width: 1920,
  height: 1080,
};
assert.strictEqual(
  resolveBackgroundImage(
    { assetId: richImage.id },
    { backgroundImage: richImage }
  ),
  richImage,
  'resolved image metadata must pass through without a lossy copy'
);
const resolverAssets = {
  backgroundImage: {
    id: 'selected-background',
    url: '/pv/assets/background.webp',
    width: 2048,
    height: 1152,
    blob: Buffer.from('must not reach renderer props'),
  },
  monetPortraitImage: { id: 'portrait-1', url: '/pv/assets/portrait.png' },
  temperaLayerImageAssets: [
    {
      id: 'tempera-layer-1',
      url: '/pv/assets/tempera-layer.png',
      width: 720,
      height: 960,
      blob: Buffer.from('must not reach renderer props'),
    },
  ],
  cappellaCustomEmojiImages: [
    { id: 'emoji-1', url: '/pv/assets/emoji.png', width: 64, height: 64 },
  ],
  cappellaCustomAvatarImages: [
    { id: 'avatar-1', url: '/pv/assets/avatar.png' },
  ],
};
const projectedAssets = normalizeVisualAssets(resolverAssets);
assert.strictEqual(normalizeVisualAssets(resolverAssets), projectedAssets);
assert.equal(projectedAssets.backgroundImage.name, '自定义背景图片');
assert.equal(projectedAssets.backgroundImage.width, 2048);
assert.equal(projectedAssets.backgroundImage.height, 1152);
assert.ok(
  !Object.prototype.hasOwnProperty.call(projectedAssets.backgroundImage, 'blob')
);
assert.equal(projectedAssets.monetPortraitImage.name, 'Monet 自定义肖像');
assert.equal(
  projectedAssets.temperaLayerImageAssets[0].name,
  '自定义Tempera 图层图片 1'
);
assert.equal(projectedAssets.temperaLayerImageAssets[0].width, 720);
assert.equal(projectedAssets.temperaLayerImageAssets[0].height, 960);
assert.ok(
  !Object.prototype.hasOwnProperty.call(
    projectedAssets.temperaLayerImageAssets[0],
    'blob'
  )
);
assert.equal(
  projectedAssets.cappellaCustomEmojiImages[0].name,
  '自定义表情图片 1'
);
assert.equal(projectedAssets.cappellaCustomEmojiImages[0].width, 64);
assert.equal(
  projectedAssets.cappellaCustomAvatarImages[0].name,
  '自定义头像图片 1'
);
assert.strictEqual(
  resolveBackgroundImage({ assetId: 'selected-background' }, projectedAssets),
  projectedAssets.backgroundImage,
  'the selected source image keeps its resolved id, URL, name, and dimensions'
);
const monetBackgroundTuning = resolveBackgroundTuning(
  'monet',
  { backgroundSource: 'cover-derived', blur: 6 },
  { assetId: 'selected-background' },
  projectedAssets.backgroundImage
);
assert.equal(monetBackgroundTuning.backgroundSource, 'uploaded-global');
assert.equal(monetBackgroundTuning.blur, 6);
const nomandBackgroundTuning = resolveBackgroundTuning(
  'nomand',
  { imageSource: 'cover-derived' },
  { assetId: 'selected-background' },
  projectedAssets.backgroundImage
);
assert.equal(nomandBackgroundTuning.imageSource, 'uploaded-global');
assert.deepStrictEqual(
  toSourceBackgroundConfig(
    { mode: 'monet', assetId: 'selected-background', transparent: true },
    monetBackgroundTuning,
    projectedAssets.backgroundImage,
    resolveUrlBackgroundProps({})
  ),
  {
    mode: 'monet',
    transparent: true,
    customImage: projectedAssets.backgroundImage,
    monet: { tuning: monetBackgroundTuning },
  },
  'background host passes the original Folia configuration prop shape'
);
assert.deepStrictEqual(
  resolveUrlBackgroundProps({
    items: [{ id: 'embed-1', url: 'https://example.test/embed' }],
    selectedId: 'embed-1',
  }),
  {
    urlBackgroundList: [{ id: 'embed-1', url: 'https://example.test/embed' }],
    urlBackgroundSelectedId: 'embed-1',
  }
);

const runtimeSource = fs.readFileSync(
  path.resolve('src/karaoke/folia/runtime.ts'),
  'utf8'
);
const renderHostSource = fs.readFileSync(
  path.resolve('src/karaoke/folia/renderHost.tsx'),
  'utf8'
);
const subtitleOverlaySource = fs.readFileSync(
  path.resolve(
    'vendor/folia-complete/src/components/visualizer/VisualizerSubtitleOverlay.tsx'
  ),
  'utf8'
);
const nativeLyricOverlayRenderers = [
  ['folia-classic', 'classic/Visualizer.tsx', '<GlowWord'],
  ['cadenza', 'cadenza/VisualizerCadenza.tsx', 'textCanvasRef'],
  ['partita', 'partita/VisualizerPartita.tsx', '<PartitaChunk'],
  ['fume', 'fume/VisualizerFume.tsx', 'buildArticleLayout'],
  ['tilt', 'tilt/VisualizerTilt.tsx', '<TiltLine'],
  ['claddagh', 'claddagh/VisualizerCladdagh.tsx', '<RingLine'],
  ['cappella', 'cappella/VisualizerCappella.tsx', '<CappellaMessageRow'],
  ['diorama', 'diorama/VisualizerDiorama.tsx', '<DioramaScene'],
];
for (const [
  mode,
  sourcePath,
  nativeLyricsMarker,
] of nativeLyricOverlayRenderers) {
  const source = fs.readFileSync(
    path.resolve(
      `vendor/folia-complete/src/components/visualizer/${sourcePath}`
    ),
    'utf8'
  );
  assert.ok(
    hidesSharedSubtitleOverlay(mode) &&
      source.includes('VisualizerSubtitleOverlay') &&
      source.includes('hideTranslationSubtitle={hideTranslationSubtitle}') &&
      source.includes(nativeLyricsMarker),
    `${mode} keeps its native lyrics and suppresses its shared bottom subtitle`
  );
}
const completeCss = fs.readFileSync(
  path.resolve('src/karaoke/folia/complete.css'),
  'utf8'
);
const fumeSource = fs.readFileSync(
  path.resolve(
    'vendor/folia-complete/src/components/visualizer/fume/VisualizerFume.tsx'
  ),
  'utf8'
);
const cappellaBubbleSource = fs.readFileSync(
  path.resolve(
    'vendor/folia-complete/src/components/visualizer/cappella/CappellaBubbleParts.tsx'
  ),
  'utf8'
);
const cappellaBubblePath = path.resolve(
  'vendor/folia-complete/src/components/visualizer/cappella/CappellaBubbleParts.tsx'
);
const cappellaBubbleBundle = esbuild.buildSync({
  entryPoints: [cappellaBubblePath],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  target: 'node16',
  external: ['react', 'framer-motion'],
  loader: { '.png': 'dataurl' },
}).outputFiles[0].text;
const cappellaBubbleModule = new Module(cappellaBubblePath, module);
cappellaBubbleModule.paths = module.paths;
cappellaBubbleModule._compile(cappellaBubbleBundle, cappellaBubblePath);
const { CappellaBubbleGlow } = cappellaBubbleModule.exports;
const cappellaRowSource = fs.readFileSync(
  path.resolve(
    'vendor/folia-complete/src/components/visualizer/cappella/CappellaMessageRow.tsx'
  ),
  'utf8'
);
const cappellaRowPath = path.resolve(
  'vendor/folia-complete/src/components/visualizer/cappella/CappellaMessageRow.tsx'
);
const cappellaRowBundle = esbuild.buildSync({
  entryPoints: [cappellaRowPath],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  target: 'node16',
  external: ['react', 'framer-motion'],
  loader: { '.png': 'dataurl' },
}).outputFiles[0].text;
const cappellaRowModule = new Module(cappellaRowPath, module);
cappellaRowModule.paths = module.paths;
cappellaRowModule._compile(cappellaRowBundle, cappellaRowPath);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { motionValue } = require('framer-motion');
const emojiMotionConfig = {
  rowEnterY: 14,
  rowEnterScale: 0.99,
  rowEnterDuration: 0.28,
  rowExitY: -10,
  rowExitScale: 0.98,
  rowExitDuration: 0.22,
  avatarSpring: { stiffness: 280, damping: 30, mass: 0.78 },
  activeScale: 1.07,
  passedScale: 0.96,
  passedOpacity: 0.88,
  activeFontMultiplier: 1.22,
  inactiveFontMultiplier: 0.96,
  activePaddingX: 18,
  activePaddingY: 14,
  inactivePaddingX: 16,
  inactivePaddingY: 12,
  activeMinHeight: 58,
  inactiveMinHeight: 44,
  glowOpacity: 0.26,
  glowDuration: 2.2,
  glowRightAlpha: 0.26,
  glowLeftAlpha: 0.14,
  activeShadowAlpha: 0.24,
  emoActiveSize: 132,
  emoInactiveSize: 96,
  emoEnterScale: 0.74,
  emoSizeTransitionDuration: 0.22,
};
const emojiMarkup = renderToStaticMarkup(
  React.createElement(cappellaRowModule.exports.CappellaMessageRow, {
    message: {
      id: 'emo-1',
      kind: 'emo',
      line: { startTime: 0, endTime: 1, fullText: 'hello' },
      lineIndex: 0,
      side: 'left',
      avatarIndex: 0,
      emoImageUrl: 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=',
      activationStartTime: 0,
      activationEndTime: 2,
    },
    currentTime: motionValue(0.5),
    currentLineIndex: 0,
    theme: {
      name: 'Test',
      backgroundColor: '#111111',
      primaryColor: '#222222',
      accentColor: '#333333',
      secondaryColor: '#444444',
      fontStyle: 'sans',
      animationIntensity: 'normal',
    },
    cappellaTuning: { avatarSource: 'color', emojiPackSource: 'builtin' },
    baseFontSize: 18,
    maxTextWidth: 320,
    metricsCache: { current: new Map() },
    intensityConfig: { motion: emojiMotionConfig },
    customAvatarImages: [],
  })
);
assert.ok(
  !emojiMarkup.includes('cappella-emo-wiggle'),
  'Cappella emoji render without a persistent rotation animation'
);
const cappellaGlowConfig = {
  glowOpacity: 0.4,
  glowDuration: 1.8,
  glowRightAlpha: 0.34,
  glowLeftAlpha: 0.18,
};
const inactiveGlowElement = CappellaBubbleGlow({
  isActive: false,
  isRight: false,
  motionConfig: cappellaGlowConfig,
});
const activeGlowElement = CappellaBubbleGlow({
  isActive: true,
  isRight: false,
  motionConfig: cappellaGlowConfig,
});
const nextTickGlowElement = CappellaBubbleGlow({
  isActive: true,
  isRight: false,
  motionConfig: cappellaGlowConfig,
});
assert.ok(
  inactiveGlowElement,
  'Cappella keeps the animated glow element mounted while its bubble is inactive'
);
assert.strictEqual(
  inactiveGlowElement.type,
  activeGlowElement.type,
  'activating a Cappella bubble does not replace the glow element type'
);
assert.equal(inactiveGlowElement.key, activeGlowElement.key);
assert.equal(inactiveGlowElement.props.style.opacity, 0);
assert.equal(
  activeGlowElement.props.style.opacity,
  cappellaGlowConfig.glowOpacity
);
assert.equal(
  inactiveGlowElement.props.style.animation,
  undefined,
  'inactive Cappella bubbles do not run a persistent sweep'
);
assert.equal(
  activeGlowElement.props.style.animation,
  undefined,
  'active Cappella bubbles use a static highlight instead of continuous luminance modulation'
);
assert.equal(
  activeGlowElement.props.style.background,
  nextTickGlowElement.props.style.background,
  'repeated active renders keep the same static highlight'
);
assert.equal(
  activeGlowElement.props.style.transition,
  'opacity 180ms ease-out'
);
assert.match(
  activeGlowElement.props.style.background,
  /radial-gradient\(/,
  'the active bubble highlight is a soft static radial wash'
);
const cappellaRendererSource = fs.readFileSync(
  path.resolve(
    'vendor/folia-complete/src/components/visualizer/cappella/VisualizerCappella.tsx'
  ),
  'utf8'
);
const vendorScriptSource = fs.readFileSync(
  path.resolve('scripts/vendor-folia-complete.cjs'),
  'utf8'
);
const upstreamMetadata = JSON.parse(
  fs.readFileSync(path.resolve('vendor/folia-complete/UPSTREAM.json'), 'utf8')
);
assert.ok(
  /\.folia-complete-host\s+\.cappella-message-column\s*\{[^}]*width:\s*80%;[^}]*max-width:\s*none;/s.test(
    completeCss
  ),
  'Cappella centers its content in an 80% host-width column with equal 10% side margins'
);
assert.equal(
  upstreamMetadata.css?.sha256,
  crypto.createHash('sha256').update(completeCss).digest('hex'),
  'the complete host stylesheet hash stays recorded in the vendor provenance'
);
const commonBackgroundSource = fs.readFileSync(
  path.resolve('src/karaoke/folia/adapters/CommonBackground.tsx'),
  'utf8'
);
const backgroundHostSource = fs.readFileSync(
  path.resolve('src/karaoke/folia/backgroundHost.tsx'),
  'utf8'
);
assert.ok(
  commonBackgroundSource.includes('resolveCommonOverlayOpacity(background)') &&
    !commonBackgroundSource.includes('style={{ opacity }}') &&
    backgroundHostSource.includes(
      'resolveBackgroundRootOpacity(state.background)'
    ),
  'the parent applies general opacity once while Common applies its source tuning opacity to the cover overlay'
);
for (const mode of expectedModes) {
  assert.ok(runtimeSource.includes(`'${mode}'`), `runtime must route ${mode}`);
}
assert.ok(
  runtimeSource.includes('export async function createBackgroundStage')
);
assert.ok(
  runtimeSource.includes('getOrCompileLumiereProgram(') &&
    runtimeSource.includes('runtime.swapSong('),
  'Lumiere compile inputs and compile-key changes use the program cache and actual swap API'
);
assert.ok(
  runtimeSource.includes('temperaImageBlobPool.load(') &&
    runtimeSource.includes('imageBlobs,'),
  'Tempera resolved URLs are loaded to bounded blobs before the old create API'
);
for (const mode of Object.keys(FOLIA_BACKGROUND_MODULES)) {
  if (mode === 'common') continue;
  assert.ok(
    runtimeSource.includes(FOLIA_BACKGROUND_MODULES[mode]),
    `${mode} background must load its original leaf module lazily`
  );
}
for (const forbidden of [
  'components/visualizer/classic/entry',
  'panelTab',
  'stores/visualizer',
]) {
  assert.ok(
    !runtimeSource.includes(forbidden),
    `runtime must not import ${forbidden}`
  );
}
const lyricScene = fs.readFileSync(
  path.resolve('src/components/karaoke/KaraokeLyricScene.vue'),
  'utf8'
);
assert.ok(
  lyricScene.indexOf('<KaraokeBackgroundScene') <
    lyricScene.indexOf('v-if="isPvMode"'),
  'the background component must stay mounted outside lyric renderer conditionals'
);
assert.ok(lyricScene.includes(':clock="stageClock"'));

assert.ok(
  renderHostSource.includes('resolveModeLyricFontScale(') &&
    renderHostSource.includes('hidesSharedSubtitleOverlay(state.mode)') &&
    renderHostSource.includes(
      'cappellaFontScale: resolveCappellaFontScale(state.mode)'
    ) &&
    renderHostSource.includes('folia-complete-renderer-scale'),
  'the React host applies mode presentation factors without replacing its shared clock or renderer'
);
const stageUpdateStart = renderHostSource.indexOf(
  'const applyPatch = (patch: StagePatch) => {'
);
const stageUpdateEnd = renderHostSource.indexOf(
  'const onVisibilityChange =',
  stageUpdateStart
);
const stageUpdateSource = renderHostSource.slice(
  stageUpdateStart,
  stageUpdateEnd
);
assert.ok(
  renderHostSource.includes('const Renderer = state.renderer') &&
    runtimeSource.includes('const previewAwareRenderer = options.preview') &&
    (renderHostSource.match(/root = createRoot\(host/g) || []).length === 1 &&
    (renderHostSource.match(/root\.render\(/g) || []).length === 1 &&
    stageUpdateSource.includes('setStageState?.(patch)') &&
    !/createRoot|root\.render|root\?\.unmount/.test(stageUpdateSource),
  'repeat runtime patches preserve the mounted renderer type and root; they update StageRoot state in place'
);
assert.ok(
  cappellaRendererSource.includes('key={message.id}') &&
    cappellaRendererSource.includes('<CappellaMessageRow') &&
    cappellaRowSource.includes('React.forwardRef') &&
    cappellaRowSource.includes(
      '<CappellaBubbleGlow isActive={isActiveMessage}'
    ) &&
    cappellaBubbleSource.includes('key={`${index}-${character}`}'),
  'Cappella rows and character spans retain stable React keys and component types across renderer updates'
);
assert.ok(
  subtitleOverlaySource.includes('if (!showText || hideTranslationSubtitle)') &&
    subtitleOverlaySource.includes('shouldRenderOverlay: false') &&
    renderHostSource.includes('showText: true'),
  'mode-level suppression hides only the shared overlay and keeps native renderer lyrics enabled'
);
assert.ok(
  renderHostSource.includes('showText: true'),
  'hiding the duplicate shared preview leaves the original mode lyrics enabled'
);
assert.ok(
  fumeSource.includes('const nextWidth = entry.contentRect.width;') &&
    fumeSource.includes('const nextHeight = entry.contentRect.height;') &&
    renderHostSource.includes('const rect = host.getBoundingClientRect();') &&
    renderHostSource.includes('resizeObserver.observe(host)'),
  'Fume and its host measure their actual bounded elements instead of window dimensions'
);
assert.ok(
  fumeSource.includes('className="absolute left-1/2 top-0 -translate-x-1/2"') &&
    completeCss.includes('.folia-complete-host .-translate-x-1\\/2') &&
    /\.folia-complete-host\s+\.-translate-x-1\\\/2\s*\{\s*translate:\s*-50%\s+0;/.test(
      completeCss
    ),
  'Fume stays centered using the independent translate property while Motion owns transform'
);
assert.ok(
  /\.folia-complete-host\s+\[style\*=['"]cappella-char-fade['"]\]\s*\{[^}]*animation-fill-mode:\s*both;/s.test(
    completeCss
  ) &&
    cappellaBubbleSource.includes('key={`${index}-${character}`}') &&
    cappellaBubbleSource.includes("animationName: 'cappella-char-fade'"),
  'Cappella keeps stable character keys and limits fill mode to the per-character fade spans'
);
assert.ok(
  /\.folia-complete-host\s+\.folia-complete-renderer-scale\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*transform-origin:\s*center;/s.test(
    completeCss
  ),
  'Cappella visual scaling stays centered inside the measured host bounds'
);
assert.ok(
  cappellaRendererSource.includes('cappellaFontScale?: number') &&
    cappellaRendererSource.includes('cappellaFontScale = 1') &&
    cappellaRendererSource.includes(
      '18 * lyricsFontScale)) * cappellaFontScale'
    ) &&
    cappellaRendererSource.includes(
      'const maxPanelWidth = Math.max(viewportSize.width * 0.8, 1);'
    ) &&
    cappellaRendererSource.includes('cappella-message-column') &&
    vendorScriptSource.includes('host-cappella-post-clamp-font-scale') &&
    vendorScriptSource.includes('host-cappella-80vw-column') &&
    vendorScriptSource.includes('host-cappella-panel-width') &&
    vendorScriptSource.includes('host-cappella-font-scale-prop-type') &&
    vendorScriptSource.includes('host-cappella-font-scale-prop') &&
    !vendorScriptSource.includes('cappella-host-font-scale-prop-type') &&
    vendorScriptSource.includes(
      "normalized === 'src/components/visualizer/cappella/VisualizerCappella.tsx'"
    ) &&
    vendorScriptSource.includes(
      'source = transformCappellaFontScale(source);'
    ) &&
    upstreamMetadata.g3.sourceFiles.some(
      file =>
        file.vendorPath ===
          'src/components/visualizer/cappella/VisualizerCappella.tsx' &&
        file.transforms?.includes('host-cappella-font-scale-prop-type') &&
        file.transforms?.includes('host-cappella-font-scale-prop') &&
        file.transforms?.includes('host-cappella-viewport-state') &&
        file.transforms?.includes('host-cappella-viewport-observer') &&
        file.transforms?.includes('host-cappella-shell-ref') &&
        file.transforms?.includes('host-cappella-post-clamp-font-scale') &&
        file.transforms?.includes('host-cappella-remove-glow-pan-keyframes') &&
        file.transforms?.includes('host-cappella-remove-emoji-wiggle-keyframes') &&
        file.vendorSha256 ===
          crypto
            .createHash('sha256')
            .update(cappellaRendererSource)
            .digest('hex')
    ),
  'Cappella applies the extra font factor after its internal clamp and records the source patch'
);
assert.ok(
  vendorScriptSource.includes('function transformCappellaBubbleGlow(source)') &&
    vendorScriptSource.includes(
      "paths.delete('src/components/visualizer/cappella/CappellaBubbleParts.tsx')"
    ) &&
    vendorScriptSource.includes('host-cappella-static-glow-comment') &&
    vendorScriptSource.includes('host-cappella-persistent-glow-layer') &&
    vendorScriptSource.includes('host-cappella-glow-opacity-transition') &&
    vendorScriptSource.includes('host-cappella-static-glow-width') &&
    vendorScriptSource.includes('host-cappella-static-glow-background') &&
    vendorScriptSource.includes('host-cappella-remove-continuous-glow-animation') &&
    upstreamMetadata.g3.sourceFiles.some(
      file =>
        file.vendorPath ===
          'src/components/visualizer/cappella/CappellaBubbleParts.tsx' &&
        file.transforms?.includes('host-cappella-static-glow-comment') &&
        file.transforms?.includes('host-cappella-persistent-glow-layer') &&
        file.transforms?.includes('host-cappella-glow-opacity-transition') &&
        file.transforms?.includes('host-cappella-static-glow-width') &&
        file.transforms?.includes('host-cappella-static-glow-background') &&
        file.transforms?.includes('host-cappella-remove-continuous-glow-animation') &&
        file.vendorSha256 ===
          crypto.createHash('sha256').update(cappellaBubbleSource).digest('hex')
    ),
  'the static soft Cappella bubble highlight is reproducibly copied and its transformed source hash is recorded'
);
assert.ok(
  vendorScriptSource.includes('function transformCappellaEmojiMotion(source)') &&
    vendorScriptSource.includes('source = transformCappellaEmojiMotion(source);') &&
    vendorScriptSource.includes('host-cappella-remove-persistent-emoji-wiggle') &&
    !cappellaRendererSource.includes('cappella-emo-wiggle') &&
    !cappellaRendererSource.includes('cappella-bubble-glow-pan') &&
    upstreamMetadata.g3.sourceFiles.some(
      file =>
        file.vendorPath ===
          'src/components/visualizer/cappella/CappellaMessageRow.tsx' &&
        file.transforms?.includes('host-cappella-remove-persistent-emoji-wiggle') &&
        file.vendorSha256 ===
          crypto.createHash('sha256').update(cappellaRowSource).digest('hex')
    ) &&
    !cappellaRendererSource.includes('cappella-emo-wiggle'),
  'Cappella emoji have no persistent wiggle and the row transform is provenance tracked'
);

const requiredMonetUtilities = [
  'z-[5]',
  'top-1/2',
  '-translate-y-1/2',
  '-inset-y-14',
  '-z-10',
  'min-w-0',
  'max-w-full',
  'min-h-0',
  'flex-1',
  'px-5',
  'mb-3',
  'space-y-1.5',
  'h-14',
  'mb-6',
  'space-y-1',
  'line-clamp-2',
  'font-semibold',
  'leading-[1.06]',
  'text-sm',
  'uppercase',
  'mt-auto',
  'pt-4',
  'py-2',
  'backdrop-blur-md',
  'h-2.5',
  'w-2.5',
  'text-xs',
  'hidden',
  'border-2',
  'border-dashed',
  'rounded-[2.5rem]',
  '-top-10',
  'p-2',
  '-top-3',
  'right-8',
  'w-3',
  'shadow-md',
  'transition-transform',
  'rounded-[2rem]',
  'transition-[box-shadow,background-color]',
  'p-1.5',
  'rounded-[2.15rem]',
  'backdrop-blur-sm',
  'transition-[box-shadow,background-color,border-color]',
  'rounded-[1.85rem]',
  'bottom-0',
];
const escapeCssClass = value => value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
const compactCss = completeCss.replace(/\s+/g, ' ');
for (const utility of requiredMonetUtilities) {
  assert.ok(
    compactCss.includes(`.folia-complete-host .${escapeCssClass(utility)}`),
    `Monet source utility ${utility} must be defined inside the Folia host`
  );
}

console.log('Folia renderer and background contracts passed');
