const SEARCH_ERROR_NOTICES = new Set([
  '搜索较频繁，稍后自动更新',
  '搜索响应超时，请稍后重试。',
  '搜索暂时不可用，请稍后重试。',
]);

function getRetryAfterMs(bodyDelay, headerValue, now = Date.now()) {
  if (bodyDelay !== null && bodyDelay !== undefined && bodyDelay !== '') {
    const parsedBodyDelay = Number(bodyDelay);
    if (Number.isFinite(parsedBodyDelay) && parsedBodyDelay >= 0)
      return parsedBodyDelay;
  }

  if (headerValue === null || headerValue === undefined) return null;
  const header = String(headerValue).trim();
  if (!header) return null;

  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const retryAt = Date.parse(header);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - now) : null;
}

function clearSearchNotice(notice, clear) {
  if (
    !notice ||
    !notice.dataset ||
    notice.dataset.kind !== 'error' ||
    !SEARCH_ERROR_NOTICES.has(notice.textContent)
  )
    return false;

  clear();
  return true;
}

function createSearchScheduler({
  search,
  onSearching = () => {},
  onResults = () => {},
  onError = () => {},
  onRateLimit = () => {},
  onClear = () => {},
  debounceMs = 350,
  requestTimeoutMs = 13000,
  retryFallbackMs = 1000,
  serverRetryDelayMs = 1000,
  now = Date.now,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  if (typeof search !== 'function')
    throw new TypeError('search must be a function');

  let latestQuery = '';
  let generation = 0;
  let contextGeneration = 0;
  let composing = false;
  let hidden = false;
  let stopped = false;
  let cooldownUntil = 0;
  let debounceTimer = null;
  let retryTimer = null;
  let pending = null;
  let inFlight = null;

  const clearTimer = name => {
    if (name === 'debounce' && debounceTimer !== null) {
      clearTimeoutFn(debounceTimer);
      debounceTimer = null;
    }
    if (name === 'retry' && retryTimer !== null) {
      clearTimeoutFn(retryTimer);
      retryTimer = null;
    }
  };

  const isCurrent = request =>
    !stopped &&
    !composing &&
    !hidden &&
    request.generation === generation &&
    request.contextGeneration === contextGeneration &&
    request.query === latestQuery;

  const pump = () => {
    if (
      stopped ||
      composing ||
      hidden ||
      inFlight ||
      retryTimer !== null ||
      !pending
    )
      return;

    const wait = cooldownUntil - now();
    if (wait > 0) {
      if (retryTimer === null) {
        retryTimer = setTimeoutFn(() => {
          retryTimer = null;
          pump();
        }, wait);
      }
      return;
    }

    const request = pending;
    pending = null;
    if (!isCurrent(request)) return;

    const controller = new AbortController();
    const activeRequest = {
      ...request,
      controller,
      timeout: null,
      settled: false,
    };
    inFlight = activeRequest;
    onSearching(request.query);

    const finish = (error, result) => {
      if (inFlight !== activeRequest || activeRequest.settled) return;
      activeRequest.settled = true;
      if (activeRequest.timeout !== null) clearTimeoutFn(activeRequest.timeout);
      inFlight = null;

      if (!error) {
        if (isCurrent(request)) onResults(request.query, result);
        pump();
        return;
      }

      const limited = error.status === 429 || error.code === 'RATE_LIMIT';
      if (limited) {
        const rawDelay = error.retryAfterMs;
        const suppliedDelay =
          rawDelay === null || rawDelay === undefined || rawDelay === ''
            ? NaN
            : Number(rawDelay);
        const delay =
          Number.isFinite(suppliedDelay) && suppliedDelay > 0
            ? suppliedDelay
            : retryFallbackMs;
        cooldownUntil = Math.max(cooldownUntil, now() + delay);

        if (
          request.contextGeneration === contextGeneration &&
          !stopped &&
          !composing &&
          !hidden &&
          latestQuery
        ) {
          onRateLimit(latestQuery, delay);
          if (isCurrent(request)) pending = request;
        }
      } else if (
        error.status >= 500 &&
        error.status < 600 &&
        isCurrent(request) &&
        (request.retryCount || 0) < 1
      ) {
        pending = { ...request, retryCount: (request.retryCount || 0) + 1 };
        retryTimer = setTimeoutFn(() => {
          retryTimer = null;
          pump();
        }, serverRetryDelayMs);
      } else if (isCurrent(request)) {
        onError(request.query, error);
      }
      pump();
    };

    if (requestTimeoutMs > 0) {
      activeRequest.timeout = setTimeoutFn(() => {
        const error = new Error('Remote search timed out');
        error.code = 'SEARCH_TIMEOUT';
        controller.abort();
        finish(error);
      }, requestTimeoutMs);
    }

    let result;
    try {
      result = search(request.query, { signal: controller.signal });
    } catch (error) {
      result = Promise.reject(error);
    }
    Promise.resolve(result).then(
      value => finish(null, value),
      error => finish(error)
    );
  };

  const schedule = (query, { immediate = false, force = false } = {}) => {
    if (stopped) return;
    const clean = String(query == null ? '' : query).trim();

    if (composing) {
      if (clean !== latestQuery) {
        latestQuery = clean;
        generation += 1;
      }
      clearTimer('debounce');
      clearTimer('retry');
      pending = null;
      return;
    }

    if (!force && clean === latestQuery) return;
    latestQuery = clean;
    generation += 1;
    clearTimer('debounce');
    clearTimer('retry');
    pending = null;

    if (!clean) {
      onClear();
      return;
    }

    const request = { query: clean, generation, contextGeneration };
    const enqueue = () => {
      debounceTimer = null;
      if (!isCurrent(request)) return;
      pending = request;
      pump();
    };

    if (immediate) enqueue();
    else debounceTimer = setTimeoutFn(enqueue, debounceMs);
  };

  const compositionStart = () => {
    if (stopped || composing) return;
    composing = true;
    generation += 1;
    clearTimer('debounce');
    clearTimer('retry');
    pending = null;
  };

  const compositionEnd = query => {
    if (stopped) return;
    composing = false;
    schedule(query, { force: true });
  };

  const invalidate = () => {
    if (stopped) return;
    generation += 1;
    contextGeneration += 1;
    clearTimer('debounce');
    clearTimer('retry');
    pending = null;
  };

  const setHidden = value => {
    const nextHidden = Boolean(value);
    if (stopped || hidden === nextHidden) return;
    hidden = nextHidden;
    if (hidden) {
      clearTimer('debounce');
      clearTimer('retry');
      pending = null;
    } else if (latestQuery && !composing) {
      schedule(latestQuery, { immediate: true, force: true });
    }
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    generation += 1;
    clearTimer('debounce');
    clearTimer('retry');
    pending = null;
    if (inFlight) {
      const activeRequest = inFlight;
      inFlight = null;
      activeRequest.settled = true;
      if (activeRequest.timeout !== null) clearTimeoutFn(activeRequest.timeout);
      activeRequest.controller.abort();
    }
  };

  return {
    schedule,
    compositionStart,
    compositionEnd,
    invalidate,
    setHidden,
    stop,
  };
}

module.exports = {
  clearSearchNotice,
  createSearchScheduler,
  getRetryAfterMs,
};
