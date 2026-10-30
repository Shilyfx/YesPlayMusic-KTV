// Geometry below is copied from the mode/background `glyph` entries at
// chthollyphile/folia-major 7a5f975e337e5ba13f55d72b5bc68983bf41c379.
const frame = {
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.6,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
};

const path = (d, attrs = {}) => ({ tag: 'path', attrs: { d, ...attrs } });
const rect = (attrs = {}) => ({ tag: 'rect', attrs });
const circle = (attrs = {}) => ({ tag: 'circle', attrs });
const ellipse = (attrs = {}) => ({ tag: 'ellipse', attrs });

const FULLSCREEN_CHANGE_EVENTS = [
  'fullscreenchange',
  'webkitfullscreenchange',
  'mozfullscreenchange',
  'MSFullscreenChange',
];

const genericGlyph = [
  path('M4 7.5h16'),
  path('M4 12h11', { opacity: 0.55 }),
  path('M4 16.5h14', { opacity: 0.55 }),
];

const modeGlyphs = {
  // Existing LumaSing modes use local shapes; Folia's `classic` is `folia-classic`.
  classic: [path('M3 12h18'), path('M3 12h8', { opacity: 0.55 })],
  poem: [
    path('M5 6.5h14'),
    path('M8 10.5h8', { opacity: 0.55 }),
    path('M6 14.5h12'),
    path('M9 18h6', { opacity: 0.55 }),
  ],
  depth: [
    rect({ x: 3.5, y: 12, width: 5, height: 5, rx: 1, opacity: 0.45 }),
    rect({ x: 9.5, y: 6, width: 6.5, height: 6.5, rx: 1 }),
    rect({ x: 17, y: 13.5, width: 4, height: 4, rx: 1, opacity: 0.45 }),
  ],
  orbit: [
    ellipse({ cx: 12, cy: 12, rx: 9, ry: 4.5, transform: 'rotate(-18 12 12)' }),
    circle({ cx: 18, cy: 9, r: 1.5, fill: 'currentColor', stroke: 'none' }),
  ],
  sonnet: [
    path('M4 7V4.5h2.5M17.5 4.5H20V7M20 17v2.5h-2.5M6.5 19.5H4V17'),
    path('M8.5 12h7', { opacity: 0.6 }),
  ],
  tempera: [
    rect({ x: 4, y: 4, width: 16, height: 6.5, rx: 1 }),
    rect({ x: 4, y: 13.5, width: 16, height: 6.5, rx: 1, opacity: 0.45 }),
    path('M4 12h16', { opacity: 0.7 }),
  ],
  lumiere: [
    path('M10 3.5 6 15M14 3.5 18 15', { opacity: 0.5 }),
    path('M6 19h12'),
  ],
  hanabi: [
    path('M12 21v-8', { opacity: 0.5 }),
    path(
      'M12 9V4M12 9l3.5-3.5M12 9l-3.5-3.5M12 9h5M12 9H7M12 9l3.5 3.5M12 9l-3.5 3.5'
    ),
  ],
  'folia-classic': [path('M3 12h18', { opacity: 0.35 }), path('M3 12h8')],
  cadenza: [
    circle({ cx: 9.5, cy: 12.5, r: 3.5 }),
    path('M4 6.5h3.5', { opacity: 0.45 }),
    path('M16 8h4', { opacity: 0.45 }),
    path('M15 17h4.5', { opacity: 0.45 }),
  ],
  partita: [
    path('M4 7h7'),
    path('M8.5 12h7', { opacity: 0.7 }),
    path('M13 17h7', { opacity: 0.45 }),
  ],
  fume: [
    path('M6 7.5h9', { opacity: 0.3 }),
    path('M1 12h22'),
    path('M9 16.5h9', { opacity: 0.3 }),
  ],
  tilt: [path('M4 9h16'), path('M5 16.5l14-3', { opacity: 0.55 })],
  claddagh: [
    ellipse({ cx: 12, cy: 12, rx: 9, ry: 4.5, transform: 'rotate(-18 12 12)' }),
    circle({ cx: 18, cy: 9, r: 1.5, fill: 'currentColor', stroke: 'none' }),
  ],
  monet: [
    path('M3 9.5h7'),
    path('M3 13.5h5', { opacity: 0.55 }),
    rect({ x: 14, y: 5, width: 7, height: 14, rx: 1.5, opacity: 0.55 }),
  ],
  pendolo: [
    circle({ cx: 8, cy: 12, r: 5 }),
    circle({ cx: 8, cy: 12, r: 1.4, fill: 'currentColor', stroke: 'none' }),
    path('M16 10h5', { opacity: 0.55 }),
    path('M16 14h4', { opacity: 0.55 }),
  ],
  cappella: [
    rect({ x: 3, y: 5, width: 12, height: 6, rx: 3 }),
    rect({ x: 9, y: 13.5, width: 12, height: 6, rx: 3, opacity: 0.5 }),
  ],
  diorama: [
    rect({ x: 3.5, y: 12, width: 5, height: 5, rx: 1, opacity: 0.45 }),
    rect({ x: 9.5, y: 6, width: 6.5, height: 6.5, rx: 1 }),
    rect({ x: 17, y: 13.5, width: 4, height: 4, rx: 1, opacity: 0.45 }),
  ],
  still: [
    path('M5 7.5h14', { opacity: 0.35 }),
    path('M3 12h18'),
    path('M6 16.5h12', { opacity: 0.35 }),
  ],
};

const backgroundGlyphs = {
  legacy: [
    rect({ x: 3.5, y: 4.5, width: 17, height: 15, rx: 2 }),
    path('M4 16c4-5 7-5 10 0s5 3 6-1', { opacity: 0.55 }),
  ],
  common: [
    path('M4 17l5-8 5 8z'),
    circle({ cx: 17.5, cy: 8.5, r: 3, opacity: 0.55 }),
  ],
  monet: [
    rect({ x: 3.5, y: 4.5, width: 17, height: 15, rx: 2 }),
    path('M20.5 8.5L8 19.5', { opacity: 0.55 }),
  ],
  nomand: [
    rect({ x: 4, y: 4, width: 6.5, height: 6.5, rx: 0.8 }),
    rect({ x: 13.5, y: 4, width: 6.5, height: 6.5, rx: 0.8, opacity: 0.45 }),
    rect({ x: 4, y: 13.5, width: 6.5, height: 6.5, rx: 0.8, opacity: 0.45 }),
    rect({ x: 13.5, y: 13.5, width: 6.5, height: 6.5, rx: 0.8 }),
  ],
  latent: [
    path('M4.5 7.5h.01M9 7.5h.01M13.5 7.5h.01M18 7.5h.01', {
      'stroke-width': 2.2,
      opacity: 0.55,
    }),
    path('M3 15c3-3.5 6-3.5 9 0s6 3.5 9 0'),
  ],
  url: [
    rect({ x: 3.5, y: 5, width: 17, height: 14, rx: 2 }),
    path('M3.5 9.5h17', { opacity: 0.55 }),
  ],
  sora: [
    path('M12 5.5l1.2 2.9 2.9 1.2-2.9 1.2L12 13.7l-1.2-2.9-2.9-1.2 2.9-1.2z'),
    path('M5.5 16.5h.01M18 15.5h.01M7 7h.01', {
      'stroke-width': 2.2,
      opacity: 0.5,
    }),
  ],
};

const foliaModeIds = new Set([
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
]);

export const VISUAL_PREVIEW_DOCUMENT = Object.freeze({
  itemId: 'lumasing-visual-preview',
  duration: 12,
  songTitle: '夜风沿着海岸',
  songArtist: 'LumaSing 视觉预览',
  lines: Object.freeze([
    Object.freeze({ time: 0, content: '夜风沿着海岸' }),
    Object.freeze({ time: 2.4, content: '把远方的灯火吹成星海' }),
    Object.freeze({ time: 5.4, content: '我们在微光里缓缓靠近' }),
    Object.freeze({ time: 8.4, content: '听见潮汐写下新的对白' }),
  ]),
});

export function getPreviewLyricState(position) {
  const lines = VISUAL_PREVIEW_DOCUMENT.lines;
  const duration = VISUAL_PREVIEW_DOCUMENT.duration;
  const time = (((Number(position) || 0) % duration) + duration) % duration;
  let index = 0;
  for (let candidate = 1; candidate < lines.length; candidate += 1) {
    if (lines[candidate].time > time) break;
    index = candidate;
  }
  return {
    index,
    before: lines[(index - 1 + lines.length) % lines.length].content,
    active: lines[index].content,
    after: lines[(index + 1) % lines.length].content,
    afterSecond: lines[(index + 2) % lines.length].content,
  };
}

export function getVisualThumbnailShapes(kind, value) {
  const source = kind === 'background' ? backgroundGlyphs : modeGlyphs;
  const shapes = source[value];
  return (shapes || genericGlyph).map(shape => ({
    tag: shape.tag,
    attrs: { ...frame, ...shape.attrs },
  }));
}

export function createFullscreenPreviewMount(element, documentRef = document) {
  const originalParent = element.parentNode;
  const originalNextSibling = element.nextSibling;
  let destroyed = false;

  function syncMountTarget() {
    if (destroyed) return;
    const target =
      documentRef.fullscreenElement ||
      documentRef.webkitFullscreenElement ||
      documentRef.mozFullScreenElement ||
      documentRef.msFullscreenElement ||
      documentRef.body;
    if (target && element.parentNode !== target) target.appendChild(element);
  }

  FULLSCREEN_CHANGE_EVENTS.forEach(eventName =>
    documentRef.addEventListener(eventName, syncMountTarget)
  );
  syncMountTarget();

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      FULLSCREEN_CHANGE_EVENTS.forEach(eventName =>
        documentRef.removeEventListener(eventName, syncMountTarget)
      );
      if (originalParent && originalParent.isConnected) {
        const nextSibling =
          originalNextSibling?.parentNode === originalParent
            ? originalNextSibling
            : null;
        originalParent.insertBefore(element, nextSibling);
      } else if (element.parentNode) {
        element.parentNode.removeChild(element);
      }
    },
  };
}

export function isFoliaPreviewMode(mode) {
  return foliaModeIds.has(mode);
}

export function buildVisualPreviewRuntimeOptions({
  kind,
  value,
  host,
  signal,
  clock,
  theme,
  isDaylight,
}) {
  const common = {
    host,
    signal,
    clock,
    theme,
    isDaylight: Boolean(isDaylight),
    paused: false,
    staticMode: false,
    preview: true,
    fontSize: 28,
    animationIntensity: 'normal',
    document: VISUAL_PREVIEW_DOCUMENT,
    metadata: {
      title: VISUAL_PREVIEW_DOCUMENT.songTitle,
      artist: VISUAL_PREVIEW_DOCUMENT.songArtist,
      album: null,
    },
    coverUrl: '',
    assets: {},
    smartBeatEnabled: false,
    smartBeat: {
      mode: 'off',
      trackKey: '',
      settings: {
        mode: 'off',
        beatStrength: 0,
        downbeatStrength: 0,
        effects: {},
      },
      timeline: null,
      playing: false,
    },
    rawAudioClock: () => 0,
    smartBeatPlaying: () => false,
  };

  if (kind === 'background') {
    return {
      ...common,
      lyricMode: 'folia-classic',
      background: {
        mode: value,
        tuning: value === 'url' ? { items: [], selectedId: null } : {},
        assetId: null,
        transparent: false,
        opacity: 1,
      },
      seed: VISUAL_PREVIEW_DOCUMENT.itemId,
    };
  }
  return { ...common, mode: value };
}

export function createPreviewDemoClock({
  duration = VISUAL_PREVIEW_DOCUMENT.duration,
  intervalMs = 120,
  now = () => performance.now(),
  onTick = () => {},
  setTimer = setInterval,
  cancelTimer = clearInterval,
} = {}) {
  let timer = null;
  let startedAt = 0;

  function stop() {
    if (timer !== null) {
      cancelTimer(timer);
      timer = null;
    }
    onTick(0);
  }

  return {
    start() {
      if (timer !== null) return;
      startedAt = now();
      onTick(0);
      timer = setTimer(() => {
        onTick(((now() - startedAt) / 1000) % duration);
      }, intervalMs);
    },
    stop,
    destroy: stop,
  };
}

export function createVisualPreviewController({
  createRuntime,
  onState = () => {},
  delayMs = 180,
  setTimer = setTimeout,
  cancelScheduledTimer = clearTimeout,
}) {
  let generation = 0;
  let currentKey = null;
  let timer = null;
  let activeRuntime = null;
  let pendingCreation = null;
  let pendingAbort = null;
  let destroyed = false;

  const notify = (status, request = null, error = null) => {
    onState({ status, request, error });
  };

  const destroyRuntime = runtime => {
    try {
      runtime?.destroy?.();
    } catch (_) {
      // A preview cleanup error must not keep another picker preview alive.
    }
  };

  const clearPendingTimer = () => {
    if (timer === null) return;
    cancelScheduledTimer(timer);
    timer = null;
  };

  const stopActiveRuntime = () => {
    const runtime = activeRuntime;
    activeRuntime = null;
    destroyRuntime(runtime);
  };

  function hide() {
    generation += 1;
    currentKey = null;
    clearPendingTimer();
    pendingAbort?.abort();
    pendingAbort = null;
    stopActiveRuntime();
    notify('idle');
  }

  async function start(request, requestedGeneration) {
    if (pendingCreation) {
      try {
        await pendingCreation;
      } catch (_) {
        // A cancelled renderer is expected to reject while it releases resources.
      }
    }
    if (destroyed || requestedGeneration !== generation || !currentKey) return;

    const abortController = new AbortController();
    pendingAbort = abortController;
    notify('loading', request);

    const creation = Promise.resolve().then(() =>
      createRuntime(request, { signal: abortController.signal })
    );
    pendingCreation = creation;
    try {
      const runtime = await creation;
      if (
        destroyed ||
        requestedGeneration !== generation ||
        abortController.signal.aborted
      ) {
        destroyRuntime(runtime);
        return;
      }
      activeRuntime = runtime;
      notify('ready', request);
    } catch (error) {
      if (
        requestedGeneration === generation &&
        !abortController.signal.aborted &&
        error?.name !== 'AbortError'
      ) {
        notify('error', request, error);
      }
    } finally {
      if (pendingCreation === creation) pendingCreation = null;
      if (pendingAbort === abortController) pendingAbort = null;
    }
  }

  function show(request) {
    if (
      destroyed ||
      !request ||
      request.visible !== true ||
      !request.kind ||
      !request.value
    ) {
      hide();
      return;
    }

    const key =
      request.key || `${request.kind}:${request.value}:${request.theme || ''}`;
    if (
      currentKey === key &&
      (timer !== null || pendingCreation || activeRuntime)
    )
      return;

    generation += 1;
    const requestedGeneration = generation;
    currentKey = key;
    clearPendingTimer();
    pendingAbort?.abort();
    pendingAbort = null;
    stopActiveRuntime();
    notify('waiting', request);
    timer = setTimer(() => {
      timer = null;
      start(request, requestedGeneration);
    }, Math.max(0, delayMs));
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    hide();
  }

  return { show, hide, destroy };
}
