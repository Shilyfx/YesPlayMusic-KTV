export function createIdempotentPausedUpdater(getPaused, applyPatch) {
  return paused => {
    if (getPaused() === paused) return false;
    return applyPatch({ paused });
  };
}

export function createStageLifecycle(options) {
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const retiring = new Set();
  let generation = 0;
  let active = null;
  let pending = null;
  let disposed = false;

  function cleanup(stage) {
    if (stage.timer !== null) {
      clearTimer(stage.timer);
      stage.timer = null;
    }
    retiring.delete(stage);
    if (stage.runtime && !stage.runtimeDestroyed) {
      stage.runtimeDestroyed = true;
      try {
        stage.runtime.destroy();
      } catch (_) {
        // Continue removing the layer even if a renderer has already lost its context.
      }
    }
    if (!stage.layerRemoved) {
      stage.layerRemoved = true;
      try {
        options.removeLayer(stage.layer);
      } catch (_) {
        // Cleanup must continue across sibling layers if one DOM node is already detached.
      }
    }
  }

  function reportRuntimeError(stage, error) {
    if (disposed || stage.controller.signal.aborted) return false;
    if (active === stage) {
      active = null;
      cleanup(stage);
      options.onRuntimeError?.(error, stage);
      return true;
    }
    if (pending === stage) stage.runtimeError = error;
    return false;
  }

  function settleRetiring() {
    if (active) options.settle?.(active);
    for (const stage of Array.from(retiring)) cleanup(stage);
  }

  function abortPending() {
    if (!pending) return;
    const stage = pending;
    pending = null;
    stage.controller.abort();
    cleanup(stage);
  }

  function cancelPending() {
    if (disposed || !pending) return false;
    generation++;
    abortPending();
    return true;
  }

  function clear() {
    if (disposed) return;
    generation++;
    abortPending();
    if (active) {
      const stage = active;
      active = null;
      cleanup(stage);
    }
    for (const stage of Array.from(retiring)) cleanup(stage);
  }

  async function replace(runtimeOptions, transition = {}) {
    if (disposed) return false;
    const request = ++generation;
    abortPending();
    const stage = {
      layer: options.createLayer(),
      runtime: null,
      controller: new AbortController(),
      runtimeError: null,
      timer: null,
      layerRemoved: false,
      runtimeDestroyed: false,
    };
    pending = stage;

    try {
      stage.runtime = await options.createRuntime({
        ...runtimeOptions,
        host: stage.layer,
        signal: stage.controller.signal,
        onRuntimeError: error => reportRuntimeError(stage, error),
      });
      if (stage.runtimeError) throw stage.runtimeError;

      if (
        disposed ||
        request !== generation ||
        stage.controller.signal.aborted
      ) {
        cleanup(stage);
        return false;
      }

      settleRetiring();
      const previous = active;
      const duration = Math.max(0, transition.transitionMs || 0);
      options.activate(stage, previous, duration);
      active = stage;
      pending = null;

      if (previous && duration > 0) {
        retiring.add(previous);
        previous.timer = setTimer(() => cleanup(previous), duration);
      } else if (previous) cleanup(previous);
      return true;
    } catch (error) {
      cleanup(stage);
      if (pending === stage) pending = null;
      if (disposed || request !== generation || stage.controller.signal.aborted)
        return false;
      throw error;
    }
  }

  function destroy() {
    if (disposed) return;
    clear();
    disposed = true;
  }

  return {
    replace,
    cancelPending,
    clear,
    destroy,
    hasPending: () => pending !== null,
  };
}
