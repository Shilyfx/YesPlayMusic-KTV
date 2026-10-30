let pending;
function loadStyles(file) {
  if (!file) return Promise.resolve();
  if (!/^folia-[A-Z0-9]+\.css$/.test(file))
    return Promise.reject(new Error('INVALID_PV_STYLESHEET'));
  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `/pv/${file}`;
    const finish = error => {
      clearTimeout(timer);
      link.onload = link.onerror = null;
      if (error) {
        link.remove();
        reject(error);
      } else resolve();
    };
    const timer = setTimeout(
      () => finish(new Error('PV_STYLESHEET_TIMEOUT')),
      10000
    );
    link.onload = () => finish();
    link.onerror = () => finish(new Error('PV_STYLESHEET_UNAVAILABLE'));
    document.head.appendChild(link);
  });
}
export function loadFoliaRuntime() {
  if (!pending) {
    pending = fetch('/pv/manifest.json', { cache: 'no-cache' })
      .then(response => {
        if (!response.ok) throw new Error('PV_ASSETS_UNAVAILABLE');
        return response.json();
      })
      .then(manifest => {
        if (!/^folia-[A-Z0-9]+\.js$/.test(manifest.entry))
          throw new Error('INVALID_PV_MANIFEST');
        const url = new URL(`/pv/${manifest.entry}`, window.location.origin)
          .href;
        return loadStyles(manifest.css)
          .then(() => import(/* webpackIgnore: true */ url))
          .then(module => {
            if (typeof module.createSmartBeatAnalyzer !== 'function')
              return module;
            const workerUrl =
              typeof manifest.analysisWorker === 'string' &&
              /^folia-analysis-worker-[A-Z0-9]+\.js$/.test(
                manifest.analysisWorker
              )
                ? new URL(
                    `/pv/${manifest.analysisWorker}`,
                    window.location.origin
                  ).href
                : null;
            return {
              ...module,
              createSmartBeatAnalyzer(options) {
                if (!workerUrl) throw new Error('ANALYSIS_WORKER_UNAVAILABLE');
                return module.createSmartBeatAnalyzer({
                  ...options,
                  workerUrl,
                });
              },
            };
          });
      })
      .catch(error => {
        pending = null;
        throw error;
      });
  }
  return pending;
}
