'use strict';

function resolveRemotePathConfig(pathname) {
  const pagePath = typeof pathname === 'string' ? pathname : '';
  const multiRoomMatch = /^\/r\/([^/]+)\/room(?:\/|$)/.exec(pagePath);
  let roomId = '';
  if (multiRoomMatch) {
    try {
      roomId = decodeURIComponent(multiRoomMatch[1]);
    } catch (_) {
      roomId = '';
    }
    if (!roomId || roomId === '.' || roomId === '..' || /[\\/]/.test(roomId))
      roomId = '';
  }
  const assetPrefix = roomId ? `/r/${encodeURIComponent(roomId)}` : '';
  const legacyRoomPage = /^\/room(?:\/|$)/.test(pagePath);
  const pathSegments = pagePath.split('/').filter(Boolean);

  return {
    apiRoot: assetPrefix ? `${assetPrefix}/ktv/api` : '/ktv/api',
    roomCode: roomId || pathSegments[pathSegments.length - 1],
    assetPrefix,
    isRoomPage: Boolean(assetPrefix) || legacyRoomPage,
  };
}

function hasSafeStaticPath(assetPath) {
  const pathname = assetPath.split(/[?#]/, 1)[0];
  return pathname.split('/').every(segment => {
    let decodedSegment;
    try {
      decodedSegment = decodeURIComponent(segment);
    } catch (_) {
      return false;
    }
    return (
      decodedSegment !== '.' &&
      decodedSegment !== '..' &&
      !/[\\/]/.test(decodedSegment)
    );
  });
}

function resolveStaticAssetPath(assetPath, assetPrefix = '') {
  if (
    !assetPrefix ||
    typeof assetPath !== 'string' ||
    !assetPath.startsWith('/') ||
    assetPath.startsWith('//') ||
    !hasSafeStaticPath(assetPath)
  ) {
    return assetPath;
  }
  return `${assetPrefix}${assetPath}`;
}

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

module.exports = {
  createRemoteApi,
  resolveRemotePathConfig,
  resolveStaticAssetPath,
};
