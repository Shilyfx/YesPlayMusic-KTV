'use strict';

const assert = require('assert');
const { createRemoteCapabilities } = require('./remoteCapabilities.cjs');

function testLanCapabilitiesAllowLocalPlaylistsAndCatalogPrefetch() {
  assert.deepStrictEqual(createRemoteCapabilities({ publicGuest: false }), {
    isPublicGuest: false,
    canLoadLocalPlaylists: true,
    canPrefetchCatalog: true,
  });
}

function testPublicGuestCanLoadLocalPlaylistsWithoutCatalogPrefetch() {
  assert.deepStrictEqual(createRemoteCapabilities({ publicGuest: true }), {
    isPublicGuest: true,
    canLoadLocalPlaylists: true,
    canPrefetchCatalog: false,
  });
}

testLanCapabilitiesAllowLocalPlaylistsAndCatalogPrefetch();
testPublicGuestCanLoadLocalPlaylistsWithoutCatalogPrefetch();
console.log('PASS: remote client capabilities');
