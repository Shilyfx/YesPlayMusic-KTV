import { sanitizeLyricDocument } from './lyricDocument';
import { normalizeAppearanceConfig } from './appearanceConfig';
import { sanitizeSmartBeatTimeline } from './smartBeatTimeline';

function createAnalysisTimeoutError() {
  const error = new Error('DISPLAY_ANALYSIS_TIMEOUT');
  error.code = 'DISPLAY_ANALYSIS_TIMEOUT';
  return error;
}

function hasSameValue(previous, next, path = '') {
  if (Object.is(previous, next)) return true;
  if (
    !previous ||
    !next ||
    typeof previous !== 'object' ||
    typeof next !== 'object' ||
    Array.isArray(previous) !== Array.isArray(next)
  )
    return false;

  const previousKeys = Object.keys(previous).filter(
    key => !(path === 'presentation' && key === 'position')
  );
  const nextKeys = Object.keys(next).filter(
    key => !(path === 'presentation' && key === 'position')
  );
  if (previousKeys.length !== nextKeys.length) return false;
  for (const key of nextKeys) {
    if (!Object.prototype.hasOwnProperty.call(previous, key)) return false;
    const nextPath = path ? `${path}.${key}` : key;
    if (!hasSameValue(previous[key], next[key], nextPath)) return false;
  }
  for (const key of previousKeys) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) return false;
  }
  return true;
}

function reuseUnchanged(previous, next, path = '') {
  if (hasSameValue(previous, next, path)) return previous;
  if (
    !previous ||
    !next ||
    typeof previous !== 'object' ||
    typeof next !== 'object' ||
    Array.isArray(previous) !== Array.isArray(next)
  )
    return next;

  const result = Array.isArray(next) ? next.slice() : { ...next };
  for (const key of Object.keys(next)) {
    if (path === 'presentation' && key === 'position') continue;
    if (Object.prototype.hasOwnProperty.call(previous, key)) {
      const nextPath = path ? `${path}.${key}` : key;
      result[key] = reuseUnchanged(previous[key], next[key], nextPath);
    }
  }
  if (
    path === 'presentation' &&
    Object.prototype.hasOwnProperty.call(previous, 'position')
  )
    result.position = previous.position;
  return result;
}

export default function createDisplayPoller({
  request = signal =>
    fetch('/ktv/display', { signal, cache: 'no-store' }).then(response => {
      if (!response.ok) throw new Error('DISPLAY_UNAVAILABLE');
      return response.json();
    }),
  requestLyrics = ({ generation, revision }, signal) =>
    fetch(
      `/ktv/display/lyrics?generation=${encodeURIComponent(
        generation
      )}&revision=${encodeURIComponent(revision)}`,
      { signal, cache: 'no-store' }
    ).then(response => {
      if (!response.ok) throw new Error('DISPLAY_LYRICS_UNAVAILABLE');
      return response.json();
    }),
  requestAppearance = ({ generation, revision }, signal) =>
    fetch(
      `/ktv/display/appearance?generation=${encodeURIComponent(
        generation
      )}&revision=${encodeURIComponent(revision)}`,
      { signal, cache: 'no-store' }
    ).then(response => {
      if (!response.ok) throw new Error('DISPLAY_APPEARANCE_UNAVAILABLE');
      return response.json();
    }),
  requestAnalysis = ({ generation, revision }, signal) =>
    fetch(
      `/ktv/display/analysis?generation=${encodeURIComponent(
        generation
      )}&revision=${encodeURIComponent(revision)}`,
      { signal, cache: 'no-store' }
    ).then(response => {
      if (!response.ok) {
        const error = new Error('DISPLAY_ANALYSIS_UNAVAILABLE');
        error.status = response.status;
        throw error;
      }
      return response.json();
    }),
  onState,
  onClock = () => {},
  onAppearance = () => {},
  onAppearanceError = () => {},
  onSmartBeatError = () => {},
  onError = () => {},
  schedule = setTimeout,
  cancel = clearTimeout,
  now = () => Date.now(),
}) {
  let active = false;
  let generation = 0;
  let timer;
  let inFlight = null;
  let controller;
  let requestTimeout;
  let latestState = null;
  let stableState = null;
  let retryAttempt = 0;
  let lyricKey = null;
  let lyricDocument = null;
  let lyricFlight = null;
  let appearanceKey = null;
  let appearanceValue = null;
  let appearanceFlight = null;
  let smartBeatKey = null;
  let smartBeatLoadedKey = null;
  let smartBeatTimeline = null;
  let smartBeatFlight = null;
  let smartBeatRetryAttempt = 0;
  let smartBeatRetryAt = 0;

  function clearLyrics() {
    lyricFlight?.controller.abort();
    clearTimeout(lyricFlight?.timeout);
    lyricFlight = null;
    lyricKey = null;
    lyricDocument = null;
  }

  function clearAppearance() {
    appearanceFlight?.controller.abort();
    clearTimeout(appearanceFlight?.timeout);
    appearanceFlight = null;
    appearanceKey = null;
    appearanceValue = null;
    onAppearance(null);
  }

  function clearSmartBeat() {
    smartBeatFlight?.controller.abort();
    clearTimeout(smartBeatFlight?.timeout);
    smartBeatFlight = null;
    smartBeatKey = null;
    smartBeatLoadedKey = null;
    smartBeatTimeline = null;
    smartBeatRetryAttempt = 0;
    smartBeatRetryAt = 0;
  }

  function publish() {
    if (latestState)
      onState({
        ...latestState,
        pvLyrics: lyricDocument,
        smartBeatTimeline,
      });
  }

  function receiveState(state, version) {
    const { pvLyricsRevision: revision, pvLyricsItemId: itemId } = state;
    const hasLyrics =
      state.active &&
      Number.isSafeInteger(state.generation) &&
      Number.isSafeInteger(revision) &&
      revision > 0 &&
      typeof itemId === 'string' &&
      itemId.length > 0 &&
      (!state.presentation || state.presentation.itemId === itemId);
    const key = hasLyrics
      ? JSON.stringify([state.generation, revision, itemId])
      : null;
    if (key !== lyricKey) {
      clearLyrics();
      lyricKey = key;
    }
    const appearanceRevision = state.appearanceRevision;
    const hasAppearance =
      state.active &&
      Number.isSafeInteger(state.generation) &&
      state.generation > 0 &&
      Number.isSafeInteger(appearanceRevision) &&
      appearanceRevision > 0;
    const nextAppearanceKey = hasAppearance
      ? JSON.stringify([state.generation, appearanceRevision])
      : null;
    if (nextAppearanceKey !== appearanceKey) {
      clearAppearance();
      appearanceKey = nextAppearanceKey;
    }
    const smartBeatRevision = state.smartBeatRevision;
    const smartBeatTrackKey =
      typeof state.smartBeatTrackKey === 'string'
        ? state.smartBeatTrackKey
        : state.presentation?.smartBeat?.trackKey || '';
    const hasSmartBeat =
      state.active &&
      Number.isSafeInteger(state.generation) &&
      Number.isSafeInteger(smartBeatRevision) &&
      smartBeatRevision > 0 &&
      smartBeatTrackKey.length > 0;
    const nextSmartBeatKey = hasSmartBeat
      ? JSON.stringify([state.generation, smartBeatRevision, smartBeatTrackKey])
      : null;
    if (nextSmartBeatKey !== smartBeatKey) {
      clearSmartBeat();
      smartBeatKey = nextSmartBeatKey;
    }
    const previousStableState = stableState;
    const comparableState = { ...state };
    delete comparableState.serverTime;
    delete comparableState.updatedAt;
    stableState = reuseUnchanged(stableState, comparableState);
    const changed = !previousStableState || stableState !== previousStableState;
    latestState = {
      ...stableState,
      ...(Object.prototype.hasOwnProperty.call(state, 'updatedAt')
        ? { updatedAt: state.updatedAt }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(state, 'serverTime')
        ? { serverTime: state.serverTime }
        : {}),
    };
    onClock({
      serverTime: state.serverTime,
      updatedAt: state.updatedAt,
      position: state.presentation?.position,
    });
    // User callbacks may stop/restart the owner while publishing a state.
    if (!active || version !== generation) return;
    if (changed) publish();
    // User callbacks may stop/restart the owner while publishing a state.
    if (!active || version !== generation) return;

    if (
      nextSmartBeatKey &&
      smartBeatKey === nextSmartBeatKey &&
      smartBeatLoadedKey !== nextSmartBeatKey &&
      (!smartBeatRetryAt || now() >= smartBeatRetryAt) &&
      !smartBeatFlight
    ) {
      const abort = new AbortController();
      const flight = {
        controller: abort,
        timedOut: false,
        timeout: null,
      };
      flight.timeout = setTimeout(() => {
        flight.timedOut = true;
        abort.abort();
      }, 15000);
      smartBeatFlight = flight;
      smartBeatRetryAt = 0;
      const owns = () =>
        active &&
        version === generation &&
        smartBeatKey === nextSmartBeatKey &&
        smartBeatFlight === flight;
      const current = () => owns() && !abort.signal.aborted;
      Promise.resolve()
        .then(() => {
          if (!current()) return null;
          return requestAnalysis(
            { generation: state.generation, revision: smartBeatRevision },
            abort.signal
          );
        })
        .then(value => {
          if (!current()) {
            if (owns() && flight.timedOut) throw createAnalysisTimeoutError();
            return;
          }
          const timeline = value?.timeline
            ? sanitizeSmartBeatTimeline(value.timeline)
            : null;
          if (
            value?.generation !== state.generation ||
            value?.revision !== smartBeatRevision ||
            (timeline && timeline.trackKey !== smartBeatTrackKey)
          )
            throw new Error('STALE_SMART_BEAT_ANALYSIS');
          smartBeatTimeline = timeline ? Object.freeze(timeline) : null;
          smartBeatLoadedKey = nextSmartBeatKey;
          publish();
        })
        .catch(error => {
          if (!owns()) return;
          if (flight.timedOut) error = createAnalysisTimeoutError();
          const status = error?.status;
          const terminalStatus =
            Number.isInteger(status) &&
            status >= 400 &&
            status < 500 &&
            status !== 408 &&
            status !== 429;
          if (terminalStatus) smartBeatLoadedKey = nextSmartBeatKey;
          else {
            smartBeatRetryAttempt += 1;
            smartBeatRetryAt =
              now() + Math.min(1000 * 2 ** (smartBeatRetryAttempt - 1), 30000);
          }
          onSmartBeatError(error);
        })
        .finally(() => {
          clearTimeout(flight.timeout);
          if (smartBeatFlight === flight) smartBeatFlight = null;
        });
    }

    if (
      active &&
      version === generation &&
      nextAppearanceKey &&
      !appearanceValue &&
      !appearanceFlight
    ) {
      const abort = new AbortController();
      const flight = {
        key: nextAppearanceKey,
        controller: abort,
        timeout: setTimeout(() => abort.abort(), 10000),
      };
      appearanceFlight = flight;
      const current = () =>
        active &&
        version === generation &&
        appearanceKey === nextAppearanceKey &&
        appearanceFlight === flight &&
        !abort.signal.aborted;
      Promise.resolve()
        .then(() => {
          if (!current()) return null;
          return requestAppearance(
            { generation: state.generation, revision: appearanceRevision },
            abort.signal
          );
        })
        .then(value => {
          if (!current()) return;
          if (
            value?.generation !== state.generation ||
            value?.revision !== appearanceRevision ||
            !value.config
          )
            throw new Error('STALE_DISPLAY_APPEARANCE');
          appearanceValue = {
            generation: state.generation,
            revision: appearanceRevision,
            config: normalizeAppearanceConfig(value.config),
          };
          onAppearance(appearanceValue);
        })
        .catch(error => {
          if (current()) onAppearanceError(error);
        })
        .finally(() => {
          clearTimeout(flight.timeout);
          if (appearanceFlight === flight) appearanceFlight = null;
        });
    }
    if (!key || lyricDocument || lyricFlight) return;
    const abort = new AbortController();
    const flight = {
      controller: abort,
      timeout: setTimeout(() => abort.abort(), 10000),
    };
    lyricFlight = flight;
    const current = () =>
      active &&
      version === generation &&
      key === lyricKey &&
      lyricFlight === flight &&
      !abort.signal.aborted;
    // This request belongs to the same poller, but does not delay clock polls.
    Promise.resolve()
      .then(() => {
        if (!current()) return null;
        return requestLyrics(
          { generation: state.generation, revision, itemId },
          abort.signal
        );
      })
      .then(value => {
        if (!current()) return;
        if (value?.revision !== revision || value?.itemId !== itemId)
          throw new Error('STALE_PV_LYRICS');
        lyricDocument = Object.freeze({
          ...sanitizeLyricDocument(value),
          revision,
        });
        publish();
      })
      .catch(error => {
        if (current()) onError(error);
      })
      .finally(() => {
        clearTimeout(flight.timeout);
        if (lyricFlight === flight) lyricFlight = null;
      });
  }

  function refresh() {
    if (!active) return Promise.resolve();
    if (inFlight) return inFlight;
    cancel(timer);
    const version = generation;
    const abort = new AbortController();
    controller = abort;
    const timeout = setTimeout(() => abort.abort(), 10000);
    requestTimeout = timeout;
    let pending;
    try {
      pending = Promise.resolve(request(abort.signal));
    } catch (error) {
      pending = Promise.reject(error);
    }
    let nextDelay = 500;
    const operation = (async () => {
      try {
        const state = await pending;
        if (active && version === generation) {
          receiveState(state, version);
          retryAttempt = 0;
        }
      } catch (error) {
        if (active && version === generation) {
          retryAttempt += 1;
          nextDelay = Math.min(1000 * 2 ** (retryAttempt - 1), 8000);
          onError(error);
        }
      } finally {
        clearTimeout(timeout);
        if (inFlight === operation) inFlight = null;
        if (active && version === generation)
          timer = schedule(refresh, nextDelay);
      }
    })();
    inFlight = operation;
    return operation;
  }
  return {
    refresh,
    start() {
      if (active) return;
      active = true;
      generation++;
      refresh();
    },
    stop() {
      active = false;
      generation++;
      cancel(timer);
      controller?.abort();
      clearTimeout(requestTimeout);
      inFlight = null;
      clearLyrics();
      clearAppearance();
      clearSmartBeat();
      latestState = null;
      stableState = null;
      retryAttempt = 0;
    },
  };
}
