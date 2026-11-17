'use strict';

function createRemoteCapabilities({ publicGuest = false } = {}) {
  const isPublicGuest = Boolean(publicGuest);

  return Object.freeze({
    isPublicGuest,
    canLoadLocalPlaylists: !isPublicGuest,
    canPrefetchCatalog: !isPublicGuest,
  });
}

module.exports = { createRemoteCapabilities };
