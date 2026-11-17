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

function testPublicGuestCapabilitiesDisableLocalPlaylistsAndCatalogPrefetch() {
  assert.deepStrictEqual(createRemoteCapabilities({ publicGuest: true }), {
    isPublicGuest: true,
    canLoadLocalPlaylists: false,
    canPrefetchCatalog: false,
  });
}

testLanCapabilitiesAllowLocalPlaylistsAndCatalogPrefetch();
testPublicGuestCapabilitiesDisableLocalPlaylistsAndCatalogPrefetch();
console.log('PASS: remote client capabilities');
