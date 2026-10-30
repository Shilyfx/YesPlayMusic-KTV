export const FOLIA_RENDERER_CONTRACTS = Object.freeze({
  sonnet: Object.freeze({
    kind: 'pixi',
    module: 'components/visualizer/sonnet/createSonnetPixiRuntime',
    tuningProp: 'sonnetTuning',
    defaultTuning: 'DEFAULT_SONNET_TUNING',
    defaultTuningModule: 'types',
  }),
  tempera: Object.freeze({
    kind: 'pixi',
    module: 'components/visualizer/tempera/createTemperaPixiRuntime',
    tuningProp: 'temperaTuning',
    defaultTuning: 'DEFAULT_TEMPERA_TUNING',
    defaultTuningModule: 'types',
  }),
  lumiere: Object.freeze({
    kind: 'pixi',
    module: 'components/visualizer/lumiere/createLumierePixiRuntime',
    tuningProp: 'lumiereTuning',
    defaultTuning: 'DEFAULT_LUMIERE_TUNING',
    defaultTuningModule: 'types',
  }),
  hanabi: Object.freeze({
    kind: 'pixi',
    module: 'components/visualizer/hanabi/createHanabiPixiRuntime',
    tuningProp: null,
    defaultTuning: 'DEFAULT_HANABI_TUNING',
    defaultTuningModule: 'hanabi/types',
  }),
  'folia-classic': Object.freeze({
    kind: 'react',
    module: 'components/visualizer/classic/Visualizer',
    tuningProp: 'classicTuning',
    defaultTuning: 'DEFAULT_CLASSIC_TUNING',
    defaultTuningModule: 'types',
  }),
  cadenza: Object.freeze({
    kind: 'react',
    module: 'components/visualizer/cadenza/VisualizerCadenza',
    tuningProp: 'cadenzaTuning',
    defaultTuning: 'DEFAULT_CADENZA_TUNING',
    defaultTuningModule: 'types',
  }),
  partita: Object.freeze({
    kind: 'react',
    module: 'components/visualizer/partita/VisualizerPartita',
    tuningProp: 'partitaTuning',
    defaultTuning: 'DEFAULT_PARTITA_TUNING',
    defaultTuningModule: 'types',
  }),
  fume: Object.freeze({
    kind: 'react',
    module: 'components/visualizer/fume/VisualizerFume',
    tuningProp: 'fumeTuning',
    defaultTuning: 'DEFAULT_FUME_TUNING',
    defaultTuningModule: 'types',
  }),
  tilt: Object.freeze({
    kind: 'react',
    module: 'components/visualizer/tilt/VisualizerTilt',
    tuningProp: 'tiltTuning',
    defaultTuning: 'DEFAULT_TILT_TUNING',
    defaultTuningModule: 'types',
  }),
  claddagh: Object.freeze({
    kind: 'react',
    module: 'components/visualizer/claddagh/VisualizerCladdagh',
    tuningProp: 'claddaghTuning',
    defaultTuning: 'DEFAULT_CLADDAGH_TUNING',
    defaultTuningModule: 'types',
  }),
  monet: Object.freeze({
    kind: 'react',
    module: 'components/visualizer/monet/VisualizerMonet',
    tuningProp: 'monetTuning',
    defaultTuning: 'DEFAULT_MONET_TUNING',
    defaultTuningModule: 'types',
  }),
  pendolo: Object.freeze({
    kind: 'react',
    module: 'components/visualizer/pendolo/VisualizerPendolo',
    tuningProp: 'pendoloTuning',
    defaultTuning: 'DEFAULT_PENDOLO_TUNING',
    defaultTuningModule: 'types',
  }),
  cappella: Object.freeze({
    kind: 'react',
    module: 'components/visualizer/cappella/VisualizerCappella',
    tuningProp: 'cappellaTuning',
    defaultTuning: 'DEFAULT_CAPPELLA_TUNING',
    defaultTuningModule: 'types',
  }),
  diorama: Object.freeze({
    kind: 'react',
    module: 'components/visualizer/diorama/VisualizerDiorama',
    tuningProp: 'dioramaTuning',
    defaultTuning: 'DEFAULT_DIORAMA_TUNING',
    defaultTuningModule: 'types',
  }),
  still: Object.freeze({
    kind: 'react',
    module: 'components/visualizer/still/VisualizerStill',
    tuningProp: null,
    defaultTuning: null,
    defaultTuningModule: null,
  }),
});

export const FOLIA_BACKGROUND_MODULES = Object.freeze({
  common: null,
  monet: 'components/visualizer/backgrounds/monet/MonetBackgroundLayer',
  nomand: 'components/visualizer/backgrounds/nomand/NomandBackgroundLayer',
  latent: 'components/visualizer/backgrounds/latent/LatentBackground',
  url: 'components/visualizer/backgrounds/url/UrlBackgroundLayer',
  sora: 'components/visualizer/backgrounds/sora/SoraBackground',
});

export const FOLIA_MODE_IDS = Object.freeze(
  Object.keys(FOLIA_RENDERER_CONTRACTS)
);

const MODE_LYRIC_FONT_SCALE_FACTORS = Object.freeze({
  monet: 1.3,
  pendolo: 1.2,
});
const MODE_VISUAL_SCALE_FACTORS = Object.freeze({});
const SHARED_SUBTITLE_OVERLAY_MODES = new Set([
  'classic',
  'folia-classic',
  'cadenza',
  'partita',
  'fume',
  'tilt',
  'claddagh',
  'cappella',
  'diorama',
]);

/** Apply presentation preferences to the user's existing lyric font scale. */
export function resolveModeLyricFontScale(mode, baseScale) {
  const numericScale = Number(baseScale);
  const scale = Number.isFinite(numericScale) ? numericScale : 1;
  return scale * (MODE_LYRIC_FONT_SCALE_FACTORS[mode] || 1);
}

/** Modes with a requested whole-renderer size adjustment. */
export function resolveModeVisualScale(mode) {
  return MODE_VISUAL_SCALE_FACTORS[mode] || 1;
}

/** Apply Cappella's font increase after its renderer's intentional size clamp. */
export function resolveCappellaFontScale(mode) {
  return mode === 'cappella' ? 1.05 : 1;
}

/** These renderers draw lyrics in their own scene and do not need the generic bottom subtitle overlay. */
export function hidesSharedSubtitleOverlay(mode) {
  return SHARED_SUBTITLE_OVERLAY_MODES.has(mode);
}

export const FOLIA_BACKGROUND_MODE_IDS = Object.freeze(
  Object.keys(FOLIA_BACKGROUND_MODULES)
);

const normalizedAssetsCache = new WeakMap();
const namedAssetCache = new WeakMap();
const normalizedAssetListsCache = new WeakMap();

export function supportsRuntimeUpdateMode(mode) {
  return FOLIA_RENDERER_CONTRACTS[mode]?.kind === 'react';
}

export function mergeModeTuning(defaults, tuning) {
  if (
    !tuning ||
    typeof tuning !== 'object' ||
    Array.isArray(tuning) ||
    Object.keys(tuning).length === 0
  ) {
    return defaults;
  }
  return { ...(defaults || {}), ...tuning };
}

export function getOrCompileLumiereProgram({
  cache,
  lines,
  seed,
  duration,
  compileOptions,
  compile,
}) {
  const numericDuration = Number(duration);
  const normalizedDuration =
    Number.isFinite(numericDuration) && numericDuration > 0
      ? numericDuration
      : undefined;
  const options = { ...(compileOptions || {}) };
  delete options.duration;
  if (normalizedDuration !== undefined) options.duration = normalizedDuration;

  const key = JSON.stringify([
    normalizedDuration ?? null,
    Object.keys(options)
      .sort()
      .map(name => [name, options[name]]),
  ]);
  let program = cache.get(key);
  if (!program) {
    if (typeof compile !== 'function')
      throw new Error('LUMIERE_COMPILER_UNAVAILABLE');
    program = compile(lines, seed, options);
    cache.set(key, program);
  }
  return { key, options, program };
}

function namedAsset(asset, fallbackName) {
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)) return asset;

  const name =
    typeof asset.name === 'string' && asset.name.trim()
      ? asset.name
      : fallbackName;
  if (
    name === asset.name &&
    !Object.prototype.hasOwnProperty.call(asset, 'blob')
  ) {
    return asset;
  }

  let byName = namedAssetCache.get(asset);
  if (!byName) {
    byName = new Map();
    namedAssetCache.set(asset, byName);
  }
  if (byName.has(name)) return byName.get(name);

  const sourceProps = { ...asset };
  delete sourceProps.blob;
  const normalized = { ...sourceProps, name };
  byName.set(name, normalized);
  return normalized;
}

function namedAssetList(images, role) {
  if (!Array.isArray(images)) return images;
  let byRole = normalizedAssetListsCache.get(images);
  if (!byRole) {
    byRole = new Map();
    normalizedAssetListsCache.set(images, byRole);
  }
  if (byRole.has(role)) return byRole.get(role);

  const normalized = images.map((image, index) =>
    namedAsset(image, `自定义${role} ${index + 1}`)
  );
  const result = normalized.every((image, index) => image === images[index])
    ? images
    : normalized;
  byRole.set(role, result);
  return result;
}

/**
 * Keep resolver metadata and source prop shapes while supplying source-required names.
 * Blob payloads stay out of renderer props; URLs and dimensions pass through unchanged.
 */
export function normalizeVisualAssets(assets) {
  if (!assets || typeof assets !== 'object' || Array.isArray(assets)) return {};
  if (normalizedAssetsCache.has(assets))
    return normalizedAssetsCache.get(assets);

  const normalized = {
    ...assets,
    backgroundImage: namedAsset(assets.backgroundImage, '自定义背景图片'),
    monetPortraitImage: namedAsset(
      assets.monetPortraitImage,
      'Monet 自定义肖像'
    ),
    temperaLayerImageAssets: namedAssetList(
      assets.temperaLayerImageAssets,
      'Tempera 图层图片'
    ),
    cappellaCustomEmojiImages: namedAssetList(
      assets.cappellaCustomEmojiImages,
      '表情图片'
    ),
    cappellaCustomAvatarImages: namedAssetList(
      assets.cappellaCustomAvatarImages,
      '头像图片'
    ),
  };
  normalizedAssetsCache.set(assets, normalized);
  return normalized;
}

export function resolveBackgroundTuning(mode, defaults, background, image) {
  const tuning = mergeModeTuning(defaults || {}, background?.tuning);
  if (!image) return tuning;

  if (mode === 'monet' && tuning.backgroundSource !== 'uploaded-global') {
    return { ...tuning, backgroundSource: 'uploaded-global' };
  }
  if (mode === 'nomand' && tuning.imageSource !== 'uploaded-global') {
    return { ...tuning, imageSource: 'uploaded-global' };
  }
  return tuning;
}

export function resolveBackgroundRootOpacity(background) {
  if (background?.transparent) return 0;
  const value = Number(background?.opacity ?? 1);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}

export function resolveCommonOverlayOpacity(background) {
  const value = Number(background?.tuning?.opacity ?? 0.75);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.75;
}

export function toSourceBackgroundConfig(background, tuning, image, urls) {
  const mode = background?.mode || 'legacy';
  const config = {
    mode,
    transparent: Boolean(background?.transparent),
  };

  if (image) config.customImage = image;
  if (mode === 'common') {
    config.common = {
      useCoverColorBg: Boolean(tuning.useCoverColorBg),
      opacity: Number(tuning.opacity ?? 0.75),
      disableGeometricBackground: Boolean(tuning.disableGeometricBackground),
      disableVignette: Boolean(tuning.disableVignette),
    };
  } else if (mode === 'url') {
    config.url = {
      items: urls.urlBackgroundList,
      selectedId: urls.urlBackgroundSelectedId,
    };
  } else if (mode !== 'legacy') {
    config[mode] = { tuning };
  }
  return config;
}

export function resolveBackgroundImage(background, assets) {
  const image = assets && assets.backgroundImage;
  if (!image || typeof image.id !== 'string' || typeof image.url !== 'string') {
    return null;
  }
  return background && background.assetId === image.id ? image : null;
}

export function resolveUrlBackgroundProps(tuning) {
  const options = tuning && typeof tuning === 'object' ? tuning : {};
  return {
    urlBackgroundList: Array.isArray(options.items) ? options.items : [],
    urlBackgroundSelectedId:
      typeof options.selectedId === 'string' ? options.selectedId : null,
  };
}
