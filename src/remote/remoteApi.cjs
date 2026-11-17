'use strict';

function createRemoteApi({
  apiRoot,
  fetchRequest,
  getClientToken,
  getRetryAfterMs,
}) {
  return function api(path, options = {}) {
    return fetchRequest(`${apiRoot}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(getClientToken()
          ? { Authorization: `Bearer ${getClientToken()}` }
          : {}),
        ...options.headers,
      },
    }).then(async response => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(body.error || 'REMOTE_UNAVAILABLE');
        error.code = body.error;
        error.status = response.status;
        error.retryAfterMs = getRetryAfterMs(
          body.retryAfterMs,
          response.headers === null || response.headers === undefined
            ? undefined
            : response.headers.get('Retry-After')
        );
        throw error;
      }
      return body;
    });
  };
}

module.exports = { createRemoteApi };
