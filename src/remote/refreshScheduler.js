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
      .then(run)
      .finally(() => {
        refreshPromise = null;
        if (!queuedRefresh || !shouldRun()) {
          queuedRefresh = false;
          return;
        }
        queuedRefresh = false;
        request().catch(() => {});
      });
    return refreshPromise;
  };

  request.isPending = () => Boolean(refreshPromise);
  return request;
}
