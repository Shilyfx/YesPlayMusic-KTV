export default function createRefreshScheduler(run, shouldRun = () => true) {
  let refreshPromise = null;
  let queuedRefresh = false;

  const request = () => {
    if (!shouldRun()) return Promise.resolve();
    if (refreshPromise) {
      queuedRefresh = true;
      return refreshPromise;
    }

    refreshPromise = Promise.resolve()
      .then(async () => {
        let firstError = null;
        let queuedBeforeFirstRun = queuedRefresh;
        do {
          queuedRefresh = false;
          try {
            await run();
          } catch (error) {
            if (!firstError) firstError = error;
          }
          if (queuedBeforeFirstRun) queuedRefresh = true;
          queuedBeforeFirstRun = false;
        } while (queuedRefresh && shouldRun());
        if (firstError) throw firstError;
      })
      .finally(() => {
        refreshPromise = null;
        if (queuedRefresh && shouldRun()) {
          queuedRefresh = false;
          request().catch(() => {});
        } else {
          queuedRefresh = false;
        }
      });
    return refreshPromise;
  };

  request.isPending = () => Boolean(refreshPromise);
  return request;
}
