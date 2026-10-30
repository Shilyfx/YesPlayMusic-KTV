import React, { Component, useLayoutEffect, useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  normalizeVisualAssets,
  resolveBackgroundRootOpacity,
  resolveBackgroundImage,
  resolveBackgroundTuning,
  resolveUrlBackgroundProps,
  toSourceBackgroundConfig,
} from './rendererContracts';
import { routeReactStageError } from './stageErrors';
import { createHostIntersectionHandler } from './adapters/hostIntersection.cjs';
import { getStableFoliaAudioSignals } from './smartBeatRender';
import './complete.css';

export interface ReactBackgroundStageOptions {
  mode: string;
  renderer: React.ComponentType<any>;
  host: HTMLElement;
  background: {
    mode: string;
    tuning?: Record<string, any>;
    assetId?: string | null;
    transparent?: boolean;
    opacity?: number;
  };
  defaultTuning?: object;
  theme: any;
  isDaylight: boolean;
  coverUrl?: string;
  seed: string;
  /** Same host-owned clock passed to the lyric renderer; backgrounds never poll it. */
  clock: { get(): number };
  paused: boolean;
  staticMode: boolean;
  assets?: {
    backgroundImage?: {
      id: string;
      url: string;
      [key: string]: unknown;
    } | null;
  };
  signal: AbortSignal;
  onRuntimeError?: (error: unknown) => void;
}

type BackgroundPatch = Partial<
  Omit<
    ReactBackgroundStageOptions,
    'host' | 'signal' | 'renderer' | 'mode' | 'clock'
  >
> & { hostPaused?: boolean };
type BackgroundState = Omit<ReactBackgroundStageOptions, 'host' | 'signal'> & {
  hostPaused: boolean;
};

const activeHosts = new WeakSet<HTMLElement>();
const abortError = () =>
  new DOMException('Background creation cancelled', 'AbortError');
const { audioPower, audioBands } = getStableFoliaAudioSignals('complete');

class BackgroundErrorBoundary extends Component<
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

const BackgroundRoot: React.FC<{
  initial: BackgroundState;
  onCommit(): void;
  onStateChange(setter: (patch: BackgroundPatch) => void): void;
}> = ({ initial, onCommit, onStateChange }) => {
  const [state, setState] = useState(initial);
  useLayoutEffect(() => {
    onStateChange(patch => setState(previous => ({ ...previous, ...patch })));
    onCommit();
  }, [onCommit, onStateChange]);

  const Renderer = state.renderer;
  const assets = useMemo(
    () => normalizeVisualAssets(state.assets),
    [state.assets]
  );
  const image = resolveBackgroundImage(state.background, assets);
  const tuning = useMemo(
    () =>
      resolveBackgroundTuning(
        state.mode,
        state.defaultTuning,
        state.background,
        image
      ),
    [state.mode, state.defaultTuning, state.background, image]
  );
  const urls = resolveUrlBackgroundProps(tuning);
  const config = useMemo(
    () => toSourceBackgroundConfig(state.background, tuning, image, urls),
    [
      state.background,
      tuning,
      image,
      urls.urlBackgroundList,
      urls.urlBackgroundSelectedId,
    ]
  );
  const hidden = state.paused || state.hostPaused;
  const props: Record<string, unknown> = {
    theme: state.theme,
    isDaylight: state.isDaylight,
    coverUrl: state.coverUrl || null,
    seed: state.seed,
    clock: state.clock,
    paused: hidden || (state.mode === 'sora' && state.staticMode),
    staticMode: state.staticMode,
    audioPower,
    audioBands,
    tuning,
    tuningOverride: tuning,
    monetBackgroundImage: image,
    config,
    ...urls,
  };
  if (state.mode === 'common') props.background = state.background;
  if (state.mode === 'monet') props.reduceMotion = hidden || state.staticMode;
  const opacity = resolveBackgroundRootOpacity(state.background);
  const soraBlank = state.mode === 'sora' && Boolean(tuning.blank);

  return (
    <div
      className='folia-complete-background-root'
      data-stage-paused={hidden ? 'true' : 'false'}
      aria-hidden='true'
      style={{ opacity }}
    >
      {soraBlank ? (
        <div
          className='folia-complete-sora-blank'
          style={{ backgroundColor: state.isDaylight ? '#ffffff' : '#000000' }}
        />
      ) : (
        <Renderer {...props} />
      )}
    </div>
  );
};

/** Mount one original Folia background without adding a playback or audio clock. */
export async function createReactBackgroundStage(
  options: ReactBackgroundStageOptions
) {
  if (options.signal.aborted) throw abortError();
  if (activeHosts.has(options.host))
    throw new Error('A Folia background already owns this host');

  const initial: BackgroundState = { ...options, hostPaused: true };
  const host = options.host;
  const hadHostClass = host.classList.contains('folia-complete-host');
  host.classList.add('folia-complete-host');
  activeHosts.add(host);

  let root: Root | null = null;
  let stageState = initial;
  let setStageState: ((patch: BackgroundPatch) => void) | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let intersectionObserver: IntersectionObserver | null = null;
  let intersectsViewport = typeof IntersectionObserver === 'undefined';
  let width = 0;
  let height = 0;
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

  const syncVisibility = () => {
    const visible = isHostVisible();
    const hostPaused = !visible;
    if (stageState.hostPaused === hostPaused) return;
    stageState = { ...stageState, hostPaused };
    setStageState?.({ hostPaused });
  };

  const applyPatch = (patch: BackgroundPatch) => {
    if (destroyed) return false;
    stageState = { ...stageState, ...patch };
    setStageState?.(patch);
    syncVisibility();
    return true;
  };

  const onVisibilityChange = () => syncVisibility();
  const onResize = () => {
    const rect = host.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    syncVisibility();
  };
  const onAbort = () => destroy();

  function destroy() {
    if (destroyed) return;
    destroyed = true;
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

  options.signal.addEventListener('abort', onAbort, { once: true });
  if (options.signal.aborted) onAbort();
  if (destroyed) throw abortError();

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
          syncVisibility();
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
      <BackgroundErrorBoundary onError={reportError}>
        <BackgroundRoot
          initial={initial}
          onCommit={resolveReady}
          onStateChange={setter => {
            setStageState = setter;
          }}
        />
      </BackgroundErrorBoundary>
    );
    await ready;
    if (destroyed) throw abortError();
    syncVisibility();
  } catch (error) {
    destroy();
    throw error;
  }

  return {
    update: applyPatch,
    setPaused: (paused: boolean) => applyPatch({ paused }),
    renderOnce: () => undefined,
    destroy,
  };
}
