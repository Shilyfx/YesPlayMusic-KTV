export default function createDisplayPoller({
  request = signal =>
    fetch('/ktv/display', { signal, cache: 'no-store' }).then(response => {
      if (!response.ok) throw new Error('DISPLAY_UNAVAILABLE');
      return response.json();
    }),
  onState,
  onError = () => {},
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  let active = false;
  let generation = 0;
  let timer;
  let inFlight = null;
  let controller;
  let requestTimeout;
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
    const operation = (async () => {
      try {
        const state = await pending;
        if (active && version === generation) onState(state);
      } catch (error) {
        if (active && version === generation) onError(error);
      } finally {
        clearTimeout(timeout);
        if (inFlight === operation) inFlight = null;
        if (active && version === generation) timer = schedule(refresh, 1000);
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
    },
  };
}
