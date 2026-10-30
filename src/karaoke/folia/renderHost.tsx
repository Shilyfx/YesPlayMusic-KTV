import React, { Component, useLayoutEffect, useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { motionValue, type MotionValue } from 'framer-motion';
import type {
  AudioBands,
  Line,
  Theme,
} from '../../../vendor/folia-complete/src/types';
import {
  hidesSharedSubtitleOverlay,
  mergeModeTuning,
  normalizeVisualAssets,
  resolveCappellaFontScale,
  resolveModeLyricFontScale,
  resolveModeVisualScale,
} from './rendererContracts';
import { routeReactStageError } from './stageErrors';
import { createStageI18n, StageI18nProvider } from './adapters/i18n';
import { createHostIntersectionHandler } from './adapters/hostIntersection.cjs';
import { createIdempotentPausedUpdater } from './stageLifecycle';
import { getStableFoliaAudioSignals } from './smartBeatRender';
import './complete.css';

export interface ReactStageOptions {
  mode: string;
  renderer: React.ComponentType<any>;
  tuningProp: string | null;
  defaultTuning: object;
  host: HTMLElement;
  document: {
    itemId?: string;
    duration?: number;
    title?: string;
    songTitle?: string;
    artist?: string;
    songArtist?: string;
    album?: string;
    songAlbum?: string;
    lines?: Array<{ time?: number; content?: string; [key: string]: unknown }>;
    [key: string]: unknown;
  };
  /** Folia Line[] already produced by LumaSing's toFoliaLines(). */
  lines: Line[];
  clock: { get(): number };
  theme: Theme;
  fontSize: number;
  animationIntensity: 'calm' | 'normal' | 'chaotic';
  tuningByMode: Record<string, object | undefined>;
  coverUrl: string;
  assets?: {
    backgroundImage?: {
      id: string;
      url: string;
      [key: string]: unknown;
    } | null;
    monetPortraitImage?: {
      id: string;
      url: string;
      [key: string]: unknown;
    } | null;
    temperaLayerImageAssets?: Array<{
      id: string;
      name?: string;
      url: string;
      [key: string]: unknown;
    }>;
    cappellaCustomEmojiImages?: Array<{
      id: string;
      name: string;
      url: string;
    }>;
    cappellaCustomAvatarImages?: Array<{
      id: string;
      name: string;
      url: string;
    }>;
  };
  metadata?: {
    title?: string | null;
    artist?: string | null;
    album?: string | null;
  };
  isDaylight: boolean;
  paused: boolean;
  smartBeatEnabled: boolean;
  onFrame?: (active?: boolean) => void;
  staticMode: boolean;
  signal: AbortSignal;
  onRuntimeError?: (error: unknown) => void;
}

type StagePatch = Partial<
  Omit<
    ReactStageOptions,
    'host' | 'signal' | 'clock' | 'renderer' | 'defaultTuning' | 'tuningProp'
  >
> & { hostPaused?: boolean };
type StageState = Omit<ReactStageOptions, 'host' | 'signal' | 'clock'> & {
  hostPaused: boolean;
};
type InspectLayout = {
  width: number;
  height: number;
  currentTime: number;
  currentLineIndex: number;
};

const activeHosts = new WeakSet<HTMLElement>();

const abortedError = () =>
  new DOMException('PV creation cancelled', 'AbortError');

const activeIndexAt = (lines: Line[], time: number): number => {
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (lines[middle].startTime <= time) low = middle + 1;
    else high = middle;
  }

  const index = low - 1;
  const line = lines[index];
  return line && time <= line.endTime ? index : -1;
};

const mergeState = (state: StageState, patch: StagePatch): StageState => ({
  ...state,
  ...patch,
  tuningByMode: patch.tuningByMode
    ? { ...state.tuningByMode, ...patch.tuningByMode }
    : state.tuningByMode,
  assets: patch.assets ? { ...state.assets, ...patch.assets } : state.assets,
});

interface StageRootProps {
  initial: StageState;
  time: MotionValue<number>;
  audioPower: MotionValue<number>;
  audioBands: AudioBands;
  i18n: Awaited<ReturnType<typeof createStageI18n>>;
  onCommit(): void;
  onStateChange(setter: (patch: StagePatch) => void): void;
}

class StageErrorBoundary extends Component<
  {
    onError(error: unknown): void;
    children: React.ReactNode;
  },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const StageRoot: React.FC<StageRootProps> = ({
  initial,
  time,
  audioPower,
  audioBands,
  i18n,
  onCommit,
  onStateChange,
}) => {
  const [state, setState] = useState(initial);
  useLayoutEffect(() => {
    onStateChange(patch => setState(previous => mergeState(previous, patch)));
    onCommit();
  }, [onCommit, onStateChange]);

  const Renderer = state.renderer;
  const lineIndex = activeIndexAt(state.lines, time.get());
  const theme = useMemo(
    () =>
      state.theme.animationIntensity === state.animationIntensity
        ? state.theme
        : { ...state.theme, animationIntensity: state.animationIntensity },
    [state.theme, state.animationIntensity]
  );
  const tuning = useMemo(
    () =>
      mergeModeTuning(state.defaultTuning, state.tuningByMode?.[state.mode]),
    [state.defaultTuning, state.mode, state.tuningByMode?.[state.mode]]
  );
  const assets = useMemo(
    () => normalizeVisualAssets(state.assets),
    [state.assets]
  );
  const baseLyricsFontScale = Math.max(
    0.36,
    Math.min(1.43, state.fontSize / 45)
  );
  const lyricsFontScale = resolveModeLyricFontScale(
    state.mode,
    baseLyricsFontScale
  );
  const visualScale = resolveModeVisualScale(state.mode);
  const seed = String(state.document.itemId || 'lumasing-pv');
  const metadata = state.metadata || {};
  const rendererProps = useMemo(() => {
    const props: Record<string, unknown> = {
      currentTime: time,
      currentLineIndex: lineIndex,
      lines: state.lines,
      duration: state.document.duration,
      theme,
      subtitleTheme: theme,
      isDaylight: state.isDaylight,
      audioPower,
      audioBands,
      showText: true,
      songTitle:
        metadata.title ??
        state.document.songTitle ??
        state.document.title ??
        null,
      songArtist:
        metadata.artist ??
        state.document.songArtist ??
        state.document.artist ??
        null,
      songAlbum:
        metadata.album ??
        state.document.songAlbum ??
        state.document.album ??
        null,
      coverUrl: state.coverUrl || null,
      seed,
      staticMode: state.staticMode,
      backgroundStaticMode: state.staticMode,
      background: { mode: 'legacy' },
      lyricsFontScale,
      subtitleFontScale: lyricsFontScale,
      cappellaFontScale: resolveCappellaFontScale(state.mode),
      paused: state.paused || state.hostPaused,
      smartBeatEnabled: state.smartBeatEnabled,
      isPlayerChromeHidden: true,
      hideTranslationSubtitle: hidesSharedSubtitleOverlay(state.mode),
      showSubtitleTranslation: true,
      monetPortraitImage: assets.monetPortraitImage || null,
      temperaLayerImageAssets: assets.temperaLayerImageAssets || [],
      cappellaCustomEmojiImages: assets.cappellaCustomEmojiImages || [],
      cappellaCustomAvatarImages: assets.cappellaCustomAvatarImages || [],
    };
    if (state.tuningProp) props[state.tuningProp] = tuning;
    return props;
  }, [
    time,
    lineIndex,
    state.lines,
    state.document,
    theme,
    state.isDaylight,
    audioPower,
    audioBands,
    metadata,
    state.coverUrl,
    assets,
    seed,
    state.mode,
    state.staticMode,
    state.paused,
    state.hostPaused,
    state.smartBeatEnabled,
    lyricsFontScale,
    state.tuningProp,
    tuning,
  ]);

  return (
    <StageI18nProvider i18n={i18n}>
      <div className='folia-complete-stage'>
        <div className='folia-complete-lyric-layer'>
          {visualScale === 1 ? (
            <Renderer {...rendererProps} />
          ) : (
            <div
              className='folia-complete-renderer-scale'
              style={{ transform: `scale(${visualScale})` }}
            >
              <Renderer {...rendererProps} />
            </div>
          )}
        </div>
      </div>
    </StageI18nProvider>
  );
};

/** Mount one original Folia lyric renderer in a bounded, disposable React root. */
export async function createReactStage(options: ReactStageOptions) {
  if (options.signal.aborted) throw abortedError();
  if (activeHosts.has(options.host))
    throw new Error('A Folia stage already owns this host');

  const i18n = await createStageI18n();
  if (options.signal.aborted) throw abortedError();

  const initial: StageState = {
    ...options,
    hostPaused: true,
  };
  const time = motionValue(Math.max(0, Number(options.clock.get()) || 0));
  const { audioPower, audioBands } = getStableFoliaAudioSignals(options.mode);
  const host = options.host;
  const hadHostClass = host.classList.contains('folia-complete-host');
  host.classList.add('folia-complete-host');
  activeHosts.add(host);

  let root: Root | null = null;
  let stageState = initial;
  let setStageState: ((patch: StagePatch) => void) | null = null;
  let rafId: number | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let intersectionObserver: IntersectionObserver | null = null;
  let intersectsViewport = typeof IntersectionObserver === 'undefined';
  let width = 0;
  let height = 0;
  let lastLineIndex = activeIndexAt(initial.lines, time.get());
  let destroyed = false;
  let readySettled = false;
  let readyCommitted = false;
  let resolveReady!: () => void;
  let rejectReady!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = () => {
      if (readySettled) return;
      readySettled = true;
      readyCommitted = true;
      resolve();
    };
    rejectReady = error => {
      if (readySettled) return;
      readySettled = true;
      reject(error);
    };
  });
  const reportError = (error: unknown) =>
    routeReactStageError({
      error,
      ready: readyCommitted,
      destroyed,
      onReadyError: rejectReady,
      onRuntimeError: options.onRuntimeError,
    });

  const isHostVisible = () => {
    if (
      destroyed ||
      document.visibilityState === 'hidden' ||
      !intersectsViewport
    )
      return false;
    if (
      !host.isConnected ||
      width <= 0 ||
      height <= 0 ||
      host.getClientRects().length === 0
    )
      return false;
    const rect = host.getBoundingClientRect();
    return (
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth
    );
  };

  const sampleClock = () => {
    if (destroyed) return;
    const currentTime = Math.max(0, Number(options.clock.get()) || 0);
    time.set(currentTime);
    options.onFrame?.(true);
    const lineIndex = activeIndexAt(stageState.lines, currentTime);
    if (lineIndex !== lastLineIndex) {
      lastLineIndex = lineIndex;
      setStageState?.({ lines: stageState.lines });
    }
  };

  const stopFrames = () => {
    if (rafId === null) return;
    cancelAnimationFrame(rafId);
    rafId = null;
  };

  const frame = () => {
    rafId = null;
    if (!isHostVisible() || stageState.paused) return;
    sampleClock();
    rafId = requestAnimationFrame(frame);
  };

  const syncFrames = () => {
    const visible = isHostVisible();
    if (stageState.hostPaused !== !visible) {
      stageState = { ...stageState, hostPaused: !visible };
      setStageState?.({ hostPaused: !visible });
    }
    if (visible && !stageState.paused) {
      if (rafId === null) rafId = requestAnimationFrame(frame);
    } else {
      stopFrames();
      options.onFrame?.(false);
    }
  };

  const applyPatch = (patch: StagePatch) => {
    if (destroyed) return false;
    stageState = mergeState(stageState, patch);
    setStageState?.(patch);
    syncFrames();
    return true;
  };

  const onVisibilityChange = () => syncFrames();
  const onResize = () => {
    const rect = host.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    syncFrames();
  };
  const onAbort = () => destroy();

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    stopFrames();
    resizeObserver?.disconnect();
    intersectionObserver?.disconnect();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('resize', onResize);
    options.signal.removeEventListener('abort', onAbort);
    if (!readySettled) resolveReady();
    root?.unmount();
    root = null;
    setStageState = null;
    if (!hadHostClass) host.classList.remove('folia-complete-host');
    activeHosts.delete(host);
  }

  const setPaused = createIdempotentPausedUpdater(
    () => stageState.paused,
    patch => applyPatch(patch)
  );
  const renderOnce = () => {
    if (destroyed) return;
    sampleClock();
    syncFrames();
  };

  options.signal.addEventListener('abort', onAbort, { once: true });
  if (options.signal.aborted) onAbort();
  if (destroyed) throw abortedError();

  try {
    const rect = host.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(onResize);
      resizeObserver.observe(host);
    }
    if (typeof IntersectionObserver !== 'undefined') {
      intersectionObserver = new IntersectionObserver(
        createHostIntersectionHandler(host, isIntersecting => {
          intersectsViewport = isIntersecting;
          syncFrames();
        })
      );
      intersectionObserver.observe(host);
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('resize', onResize);

    root = createRoot(host, {
      onUncaughtError(error) {
        reportError(error);
      },
    });
    root.render(
      <StageErrorBoundary onError={reportError}>
        <StageRoot
          initial={initial}
          time={time}
          audioPower={audioPower}
          audioBands={audioBands}
          i18n={i18n}
          onCommit={resolveReady}
          onStateChange={setter => {
            setStageState = setter;
          }}
        />
      </StageErrorBoundary>
    );
    await ready;
    if (destroyed) throw abortedError();
    renderOnce();
    syncFrames();
  } catch (error) {
    destroy();
    throw error;
  }

  return {
    update: applyPatch,
    setPaused,
    renderOnce,
    destroy,
    inspectLayout: (): InspectLayout => ({
      width,
      height,
      currentTime: time.get(),
      currentLineIndex: activeIndexAt(stageState.lines, time.get()),
    }),
  };
}
