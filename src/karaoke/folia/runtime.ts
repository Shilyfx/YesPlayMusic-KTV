import { createElement } from 'react';
import { toFoliaLines } from './timing';
import { fitSonnetLyrics, sonnetLyricsBounds } from './sonnetViewport';
import { loadLucideIcons } from '../../../vendor/folia-pv/src/services/lucideIconResolver';
import {
  FOLIA_BACKGROUND_MODULES,
  FOLIA_RENDERER_CONTRACTS,
  getOrCompileLumiereProgram,
  mergeModeTuning,
} from './rendererContracts';
import { createTemperaImageBlobPool } from './temperaImageBlobs';
import {
  createSmartBeatRenderBridge,
  getStableFoliaAudioSignals,
  publishSmartBeatAudioFeatures,
} from './smartBeatRender';

const temperaImageBlobPool = createTemperaImageBlobPool();

type RuntimeOptions = any;
type RuntimeInstance = {
  update?: (patch: any) => boolean | void;
  setSmartBeatEnabled?: (enabled: boolean) => void;
  setPaused?: (paused: boolean) => void;
  renderOnce?: () => void;
  destroy: () => void;
  inspectLayout?: () => any;
};

const prepared = new WeakMap<
  object,
  { lines: any[]; programs: Map<string, any> }
>();
const abortError = (message = 'PV creation cancelled') =>
  new DOMException(message, 'AbortError');
const emptyRuntime = (): RuntimeInstance => ({
  update: () => true,
  setPaused: () => undefined,
  renderOnce: () => undefined,
  destroy: () => undefined,
});

/** Lazy analysis boundary: model/audio/worker modules load only after opt-in. */
export async function createSmartBeatAnalyzer(options: any = {}) {
  const controller = await import('../smartBeat/controller');
  if (typeof controller.createSmartBeatAnalyzer !== 'function')
    throw new Error('SMART_BEAT_FACTORY_UNAVAILABLE');
  return controller.createSmartBeatAnalyzer(options);
}

/** Feed raw WebAudio samples into the original, stable Folia MotionValues. */
export function publishAudioFeatures(value: any) {
  return publishSmartBeatAudioFeatures(value);
}

function smartBeatFrame(bridge: any, options: RuntimeOptions) {
  let lastFrameAt = -Infinity;
  return (active = true) => {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    if (now - lastFrameAt < 4) return;
    lastFrameAt = now;
    let rawPosition = 0;
    let playing = false;
    try {
      rawPosition = Number(options.rawAudioClock?.()) || 0;
      playing = active && Boolean(options.smartBeatPlaying?.());
    } catch (_) {
      // A clock read failure pauses and decays the original beat envelopes.
    }
    bridge.frame({ rawPosition, playing });
  };
}

function wrapPixiClock(clock: any, onFrame: () => void) {
  if (!clock || typeof clock !== 'object') return clock;
  return new Proxy(clock, {
    get(target, property) {
      if (property === 'get')
        return () => {
          onFrame();
          return target.get();
        };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function attachSmartBeatBridge(runtime: RuntimeInstance, bridge: any) {
  let destroyed = false;
  return {
    update(patch: any = {}) {
      if (destroyed) return false;
      let handled = false;
      if (Object.prototype.hasOwnProperty.call(patch, 'smartBeat')) {
        bridge.update(patch.smartBeat || {});
        const enabled = bridge.getSmartBeatEnabled();
        if (typeof (runtime as any).setSmartBeatEnabled === 'function')
          (runtime as any).setSmartBeatEnabled(enabled);
        const rest = { ...patch };
        delete rest.smartBeat;
        const result = runtime.update?.({ ...rest, smartBeatEnabled: enabled });
        return result === false && Object.keys(rest).length > 0 ? false : true;
      }
      if (runtime.update) {
        const result = runtime.update(patch);
        handled = result !== false;
      }
      return handled;
    },
    setPaused(paused: boolean) {
      if (destroyed) return;
      runtime.setPaused?.(paused);
    },
    renderOnce() {
      if (!destroyed) runtime.renderOnce?.();
    },
    inspectLayout: () => runtime.inspectLayout?.(),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      try {
        runtime.destroy();
      } finally {
        bridge.dispose();
      }
    },
  };
}

function getPrepared(document: any) {
  let cached = prepared.get(document);
  if (!cached) {
    cached = { lines: toFoliaLines(document), programs: new Map() };
    prepared.set(document, cached);
  }
  return cached;
}

async function loadReactRenderer(mode: string) {
  switch (mode) {
    case 'folia-classic':
      return (
        await import(
          '../../../vendor/folia-complete/src/components/visualizer/classic/Visualizer'
        )
      ).default;
    case 'cadenza':
      return (
        await import(
          '../../../vendor/folia-complete/src/components/visualizer/cadenza/VisualizerCadenza'
        )
      ).default;
    case 'partita':
      return (
        await import(
          '../../../vendor/folia-complete/src/components/visualizer/partita/VisualizerPartita'
        )
      ).default;
    case 'fume':
      return (
        await import(
          '../../../vendor/folia-complete/src/components/visualizer/fume/VisualizerFume'
        )
      ).default;
    case 'tilt':
      return (
        await import(
          '../../../vendor/folia-complete/src/components/visualizer/tilt/VisualizerTilt'
        )
      ).default;
    case 'claddagh':
      return (
        await import(
          '../../../vendor/folia-complete/src/components/visualizer/claddagh/VisualizerCladdagh'
        )
      ).default;
    case 'monet':
      return (
        await import(
          '../../../vendor/folia-complete/src/components/visualizer/monet/VisualizerMonet'
        )
      ).default;
    case 'pendolo':
      return (
        await import(
          '../../../vendor/folia-complete/src/components/visualizer/pendolo/VisualizerPendolo'
        )
      ).default;
    case 'cappella':
      return (
        await import(
          '../../../vendor/folia-complete/src/components/visualizer/cappella/VisualizerCappella'
        )
      ).default;
    case 'diorama':
      return (
        await import(
          '../../../vendor/folia-complete/src/components/visualizer/diorama/VisualizerDiorama'
        )
      ).default;
    case 'still':
      return (
        await import(
          '../../../vendor/folia-complete/src/components/visualizer/still/VisualizerStill'
        )
      ).default;
    default:
      throw new Error('UNKNOWN_FOLIA_RENDERER');
  }
}

async function loadDefaultTuning(mode: string) {
  const contract = FOLIA_RENDERER_CONTRACTS[mode];
  if (!contract?.defaultTuning) return {};
  if (contract.defaultTuningModule === 'hanabi/types') {
    const defaults = await import(
      '../../../vendor/folia-pv/src/components/visualizer/hanabi/types'
    );
    return defaults.DEFAULT_HANABI_TUNING;
  }
  if (mode === 'sonnet' || mode === 'tempera') {
    const defaults = await import('../../../vendor/folia-pv/src/types');
    return defaults[contract.defaultTuning] || {};
  }
  const defaults = await import('../../../vendor/folia-complete/src/types');
  return defaults[contract.defaultTuning] || {};
}

function modeTuning(options: RuntimeOptions, mode: string, defaults: any) {
  return mergeModeTuning(defaults, options.tuningByMode?.[mode]);
}

async function createReactRendererStage(
  options: RuntimeOptions,
  cached: { lines: any[] }
) {
  const contract = FOLIA_RENDERER_CONTRACTS[options.mode];
  const [renderer, defaultTuning, { createReactStage }] = await Promise.all([
    loadReactRenderer(options.mode),
    loadDefaultTuning(options.mode),
    import('./renderHost'),
  ]);
  if (options.signal.aborted) throw abortError();
  await loadLucideIcons(options.theme.lyricsIcons);
  if (options.signal.aborted) throw abortError();

  const previewAwareRenderer = options.preview
    ? (props: any) => createElement(renderer, { ...props, isPreviewMode: true })
    : renderer;

  return createReactStage({
    mode: options.mode,
    renderer: previewAwareRenderer,
    tuningProp: contract.tuningProp,
    defaultTuning,
    host: options.host,
    document: options.document,
    lines: cached.lines,
    clock: options.clock,
    theme: options.theme,
    fontSize: options.fontSize,
    animationIntensity: options.animationIntensity || 'normal',
    tuningByMode: options.tuningByMode || {},
    coverUrl: options.coverUrl || '',
    assets: options.assets,
    metadata: options.metadata,
    isDaylight:
      options.isDaylight ?? options.theme.backgroundColor === '#f5f5f4',
    paused: options.paused,
    smartBeatEnabled: Boolean(options.smartBeatEnabled),
    onFrame: options.onSmartBeatFrame,
    staticMode: options.staticMode,
    signal: options.signal,
    onRuntimeError: options.onRuntimeError,
  });
}

async function createLumiereStage(
  options: RuntimeOptions,
  cached: { lines: any[]; programs: Map<string, any> }
) {
  const [
    { LumierePixiRuntime },
    { compileLumiereProgram },
    { resolveLumiereCompileOptions },
    defaultTuning,
  ] = await Promise.all([
    import(
      '../../../vendor/folia-complete/src/components/visualizer/lumiere/createLumierePixiRuntime'
    ),
    import(
      '../../../vendor/folia-complete/src/components/visualizer/lumiere/lumiereProgram'
    ),
    import(
      '../../../vendor/folia-complete/src/components/visualizer/lumiere/lumiereRuntimeTuning'
    ),
    loadDefaultTuning('lumiere'),
  ]);
  if (options.signal.aborted) throw abortError();

  const tuning = modeTuning(options, 'lumiere', defaultTuning);
  const seed = options.document.itemId || 'lumasing-pv';
  const compileProgram = (
    lines: any[],
    programSeed: any,
    compileOptions: any
  ) => compileLumiereProgram(lines, programSeed, {}, compileOptions);
  const getProgram = (nextTuning: any) =>
    getOrCompileLumiereProgram({
      cache: cached.programs,
      lines: cached.lines,
      seed,
      duration: options.document.duration,
      compileOptions: resolveLumiereCompileOptions({
        seamlessTransitions: nextTuning.seamlessTransitions,
      }),
      compile: compileProgram,
    });
  let programRequest = getProgram(tuning);
  const program = programRequest.program;

  const { audioPower, audioBands } = getStableFoliaAudioSignals('lumiere');
  const metadata = options.metadata || {
    title: options.document.songTitle || options.document.title || null,
    artist: options.document.songArtist || options.document.artist || null,
    album: options.document.songAlbum || options.document.album || null,
  };
  let runtime: any = null;
  try {
    runtime = await LumierePixiRuntime.create({
      host: options.host,
      song: {
        seed,
        program,
        theme: options.theme,
      },
      tuning,
      currentTime: options.clock,
      audioPower,
      audioBands,
      staticMode: options.staticMode,
      showText: true,
      paused: options.paused,
      metadata,
      signal: options.signal,
    });
    if (options.signal.aborted) throw abortError();
    runtime.setSongMetadata(metadata);
    runtime.setTuning(tuning);
    runtime.setShowText(true);
    runtime.setStaticMode(options.staticMode);
    runtime.setAudioSources(audioPower, audioBands);
    runtime.setPaused(options.paused);
  } catch (error) {
    runtime?.destroy();
    throw error;
  }

  return {
    update: (patch: any) => {
      let handled = false;
      if (
        patch &&
        Object.prototype.hasOwnProperty.call(patch, 'tuningByMode')
      ) {
        const nextTuning = modeTuning(
          { ...options, ...patch },
          'lumiere',
          defaultTuning
        );
        const nextProgramRequest = getProgram(nextTuning);
        if (nextProgramRequest.key !== programRequest.key) {
          if (typeof runtime.swapSong !== 'function') return false;
          try {
            runtime.setTuning(nextTuning);
            const swap = runtime.swapSong(
              {
                seed,
                program: nextProgramRequest.program,
                theme: options.theme,
              },
              options.signal
            );
            if (swap && typeof swap.catch === 'function') {
              swap.catch((error: any) => {
                if (error?.name !== 'AbortError')
                  options.onRuntimeError?.(error);
              });
            }
            programRequest = nextProgramRequest;
          } catch (_) {
            return false;
          }
        } else {
          runtime.setTuning(nextTuning);
        }
        handled = true;
      }
      if (patch && Object.prototype.hasOwnProperty.call(patch, 'metadata')) {
        runtime.setSongMetadata(patch.metadata || {});
        handled = true;
      }
      if (patch && Object.prototype.hasOwnProperty.call(patch, 'staticMode')) {
        runtime.setStaticMode(Boolean(patch.staticMode));
        handled = true;
      }
      return handled;
    },
    setPaused: (paused: boolean) => runtime.setPaused(paused),
    renderOnce: () => runtime.renderOnce(),
    destroy: () => runtime.destroy(),
  };
}

export async function createStage(
  options: RuntimeOptions
): Promise<RuntimeInstance> {
  const mode = options.mode;
  const signal = options.signal;
  if (signal?.aborted) throw abortError();
  if (
    !mode ||
    (!FOLIA_RENDERER_CONTRACTS[mode] &&
      !['sonnet', 'tempera', 'hanabi'].includes(mode))
  )
    throw new Error('UNKNOWN_PV_MODE');

  const smartBeat = options.smartBeat || {};
  const bridge = createSmartBeatRenderBridge({
    ...smartBeat,
    preview: options.preview === true,
    mode,
    trackKey: smartBeat.trackKey || '',
    settings: smartBeat.settings,
    timeline: smartBeat.timeline || null,
  });
  const onSmartBeatFrame = smartBeatFrame(bridge, options);
  const enabled = bridge.getSmartBeatEnabled();
  const reactRenderer = FOLIA_RENDERER_CONTRACTS[mode]?.kind === 'react';
  const runtimeOptions = {
    ...options,
    smartBeatEnabled: enabled,
    getSmartBeatDrumHits: bridge.getSmartBeatDrumHits,
    onSmartBeatFrame,
    ...(!reactRenderer
      ? { clock: wrapPixiClock(options.clock, onSmartBeatFrame) }
      : {}),
  };
  try {
    const runtime = await createStageRuntime(runtimeOptions);
    return attachSmartBeatBridge(runtime, bridge);
  } catch (error) {
    bridge.dispose();
    throw error;
  }
}

async function createStageRuntime(
  options: RuntimeOptions
): Promise<RuntimeInstance> {
  const { mode, signal } = options;
  if (signal?.aborted) throw abortError();
  if (
    !mode ||
    (!FOLIA_RENDERER_CONTRACTS[mode] &&
      !['sonnet', 'tempera', 'hanabi'].includes(mode))
  ) {
    throw new Error('UNKNOWN_PV_MODE');
  }
  const cached = getPrepared(options.document);

  if (FOLIA_RENDERER_CONTRACTS[mode]?.kind === 'react') {
    return createReactRendererStage(options, cached);
  }
  if (mode === 'lumiere') return createLumiereStage(options, cached);

  const seed = options.document.itemId || 'lumasing-pv';
  const common = {
    host: options.host,
    currentTime: options.clock,
    theme: options.theme,
    paused: options.paused,
    staticMode: options.staticMode,
    signal,
    lyricsFontScale: Math.max(0.36, Math.min(1.43, options.fontSize / 45)),
  };
  await loadLucideIcons(options.theme.lyricsIcons);
  if (signal?.aborted) throw abortError();

  const metadata = options.metadata || {
    title: options.document.songTitle || options.document.title || null,
    artist: options.document.songArtist || options.document.artist || null,
    album: options.document.songAlbum || options.document.album || null,
  };

  let runtime: any;
  let program: any;
  let defaultTuning: any;
  let activeShot: any;
  let viewport: { width: number; height: number } | null = null;
  let currentTuning: any;

  if (mode === 'sonnet') {
    const [{ SonnetPixiRuntime }, { compileSonnetProgram }, defaults] =
      await Promise.all([
        import(
          '../../../vendor/folia-pv/src/components/visualizer/sonnet/createSonnetPixiRuntime'
        ),
        import(
          '../../../vendor/folia-pv/src/components/visualizer/sonnet/sonnetProgram'
        ),
        import('../../../vendor/folia-pv/src/types'),
      ]);
    defaultTuning = defaults.DEFAULT_SONNET_TUNING;
    currentTuning = modeTuning(options, mode, defaultTuning);
    program =
      cached.programs.get(mode) || compileSonnetProgram(cached.lines, seed);
    runtime = await SonnetPixiRuntime.create({
      ...common,
      program,
      songSeed: seed,
      tuning: currentTuning,
      smartBeatEnabled: Boolean(options.smartBeatEnabled),
      audioPower: getStableFoliaAudioSignals('sonnet').audioPower,
      audioBands: getStableFoliaAudioSignals('sonnet').audioBands,
      transparentBackground: true,
      songTitle: metadata.title,
      songArtist: metadata.artist,
      songAlbum: metadata.album,
      afterShotUpdate: (shot: any, width: number, height: number) => {
        activeShot = shot;
        viewport = { width, height };
        fitSonnetLyrics(shot, width, height);
      },
    });
  } else if (mode === 'tempera') {
    const [{ TemperaPixiRuntime }, { compileTemperaProgram }, defaults] =
      await Promise.all([
        import(
          '../../../vendor/folia-pv/src/components/visualizer/tempera/createTemperaPixiRuntime'
        ),
        import(
          '../../../vendor/folia-pv/src/components/visualizer/tempera/temperaProgram'
        ),
        import('../../../vendor/folia-pv/src/types'),
      ]);
    defaultTuning = defaults.DEFAULT_TEMPERA_TUNING;
    currentTuning = modeTuning(options, mode, defaultTuning);
    program =
      cached.programs.get(mode) || compileTemperaProgram(cached.lines, seed);
    const imageBlobs = await temperaImageBlobPool.load(
      options.assets?.temperaLayerImageAssets,
      signal
    );
    try {
      if (signal?.aborted) throw abortError();
      runtime = await TemperaPixiRuntime.create({
        ...common,
        program,
        songSeed: seed,
        tuning: currentTuning,
        coverColors: [],
        imageBlobs,
        songTitle: metadata.title,
        songArtist: metadata.artist,
        songAlbum: metadata.album,
        rawAudioClock: options.rawAudioClock,
        getSmartBeatDrumHits: options.getSmartBeatDrumHits,
      });
    } finally {
      imageBlobs.clear();
    }
  } else {
    const [{ HanabiPixiRuntime }, { compileHanabiProgram }, defaults] =
      await Promise.all([
        import(
          '../../../vendor/folia-pv/src/components/visualizer/hanabi/createHanabiPixiRuntime'
        ),
        import(
          '../../../vendor/folia-pv/src/components/visualizer/hanabi/hanabiProgram'
        ),
        import(
          '../../../vendor/folia-pv/src/components/visualizer/hanabi/types'
        ),
      ]);
    defaultTuning = defaults.DEFAULT_HANABI_TUNING;
    currentTuning = modeTuning(options, mode, defaultTuning);
    program =
      cached.programs.get(mode) ||
      compileHanabiProgram(cached.lines, seed, {
        duration: options.document.duration,
      });
    runtime = await HanabiPixiRuntime.create({
      ...common,
      song: { seed, program, theme: options.theme },
      tuning: currentTuning,
      showText: true,
      metadata,
    });
  }

  cached.programs.set(mode, program);
  if (signal?.aborted) {
    runtime.destroy();
    throw abortError();
  }

  return {
    update: (patch: any) => {
      let handled = false;
      if (
        !patch ||
        !Object.prototype.hasOwnProperty.call(patch, 'tuningByMode') ||
        typeof runtime.setTuning !== 'function'
      ) {
        if (
          patch &&
          Object.prototype.hasOwnProperty.call(patch, 'metadata') &&
          typeof runtime.setSongMetadata === 'function'
        ) {
          runtime.setSongMetadata(patch.metadata || {});
          handled = true;
        }
        return handled;
      }
      currentTuning = modeTuning({ ...options, ...patch }, mode, defaultTuning);
      runtime.setTuning(currentTuning);
      handled = true;
      if (
        Object.prototype.hasOwnProperty.call(patch, 'metadata') &&
        typeof runtime.setSongMetadata === 'function'
      ) {
        runtime.setSongMetadata(patch.metadata || {});
      }
      return handled;
    },
    inspectLayout: () =>
      activeShot && { ...viewport, bounds: sonnetLyricsBounds(activeShot) },
    ...(typeof runtime.setSmartBeatEnabled === 'function'
      ? {
          setSmartBeatEnabled: (enabled: boolean) =>
            runtime.setSmartBeatEnabled(enabled),
        }
      : {}),
    setPaused: (paused: boolean) => runtime.setPaused(paused),
    renderOnce: () => runtime.renderOnce(),
    destroy: () => runtime.destroy(),
  };
}

async function loadBackgroundRenderer(mode: string) {
  switch (mode) {
    case 'monet':
      return (
        await import(
          '../../../vendor/folia-complete/src/components/visualizer/backgrounds/monet/MonetBackgroundLayer'
        )
      ).default;
    case 'nomand':
      return (
        await import(
          '../../../vendor/folia-complete/src/components/visualizer/backgrounds/nomand/NomandBackgroundLayer'
        )
      ).default;
    case 'latent':
      return (
        await import(
          '../../../vendor/folia-complete/src/components/visualizer/backgrounds/latent/LatentBackground'
        )
      ).default;
    case 'url':
      return (
        await import(
          '../../../vendor/folia-complete/src/components/visualizer/backgrounds/url/UrlBackgroundLayer'
        )
      ).default;
    case 'sora':
      return (
        await import(
          '../../../vendor/folia-complete/src/components/visualizer/backgrounds/sora/SoraBackground'
        )
      ).default;
    default:
      throw new Error('UNKNOWN_FOLIA_BACKGROUND');
  }
}

export async function createBackgroundStage(
  options: RuntimeOptions
): Promise<RuntimeInstance> {
  const background = options.background || { mode: 'legacy' };
  const mode = background.mode || 'legacy';
  if (mode === 'legacy' || options.lyricMode === 'still') return emptyRuntime();
  if (!Object.prototype.hasOwnProperty.call(FOLIA_BACKGROUND_MODULES, mode)) {
    throw new Error('UNKNOWN_FOLIA_BACKGROUND');
  }
  if (options.signal?.aborted)
    throw abortError('Background creation cancelled');

  const rendererPromise =
    mode === 'common'
      ? import('./adapters/CommonBackground').then(module => module.default)
      : loadBackgroundRenderer(mode);
  const defaultsPromise = ['monet', 'nomand', 'latent', 'sora'].includes(mode)
    ? import('../../../vendor/folia-complete/src/types').then(types => {
        const defaultName = {
          monet: 'DEFAULT_MONET_BACKGROUND_TUNING',
          nomand: 'DEFAULT_NOMAND_BACKGROUND_TUNING',
          latent: 'DEFAULT_LATENT_BACKGROUND_TUNING',
          sora: 'DEFAULT_SORA_BACKGROUND_TUNING',
        }[mode];
        return types[defaultName] || {};
      })
    : Promise.resolve({});
  const [{ createReactBackgroundStage }, renderer, defaultTuning] =
    await Promise.all([
      import('./backgroundHost'),
      rendererPromise,
      defaultsPromise,
    ]);
  if (options.signal?.aborted)
    throw abortError('Background creation cancelled');

  return createReactBackgroundStage({
    mode,
    renderer,
    host: options.host,
    background,
    defaultTuning,
    theme: options.theme,
    isDaylight: Boolean(options.isDaylight),
    coverUrl: options.coverUrl || '',
    seed: String(options.seed || options.document?.itemId || 'lumasing-pv'),
    clock: options.clock,
    paused: options.paused,
    staticMode: options.staticMode,
    assets: options.assets,
    signal: options.signal,
    onRuntimeError: options.onRuntimeError,
  });
}
