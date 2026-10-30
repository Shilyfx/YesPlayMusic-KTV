const assert = require('assert');
require('./helpers/register-babel-src');

const invalidateRemoteCatalogState =
  require('../src/remote/catalogEpoch').default;

const generations = {
  search: 4,
  playlists: 2,
  playlistTracks: 8,
  recommendations: 3,
  recommendationTracks: 7,
  toplists: 1,
  toplistTracks: 5,
};
const localPlaylists = [{ id: 'local-list' }];
const localTracks = [{ id: 'local-track' }];
const roomState = { current: { trackId: 'playing' } };
const interactions = [{ id: 'reaction' }];
const current = {
  catalogEpoch: 11,
  generations,
  localPlaylists,
  localTracks,
  roomState,
  interactions,
};

const invalidated = invalidateRemoteCatalogState(current, 12);
assert.equal(invalidated.catalogEpoch, 12);
assert.deepStrictEqual(invalidated.generations, {
  search: 5,
  playlists: 3,
  playlistTracks: 9,
  recommendations: 4,
  recommendationTracks: 8,
  toplists: 2,
  toplistTracks: 6,
});
for (const key of [
  'searchResults',
  'playlists',
  'playlistTracks',
  'recommendations',
  'recommendationTracks',
  'toplists',
  'toplistTracks',
])
  assert.deepStrictEqual(invalidated[key], [], `${key} is cleared`);
for (const key of [
  'playlistsLoaded',
  'recommendationsLoaded',
  'toplistsLoaded',
])
  assert.strictEqual(invalidated[key], false, `${key} is invalidated`);
assert.strictEqual(invalidated.selectedPlaylistId, '');
assert.strictEqual(invalidated.selectedRecommendationId, '');
assert.strictEqual(invalidated.selectedToplistId, '');
assert.strictEqual(invalidated.chartView, 'lists');
for (const key of [
  'localPlaylists',
  'localTracks',
  'roomState',
  'interactions',
])
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(invalidated, key),
    false
  );
assert.strictEqual(current.localPlaylists, localPlaylists);
assert.strictEqual(current.localTracks, localTracks);
assert.strictEqual(current.roomState, roomState);
assert.strictEqual(current.interactions, interactions);
assert.deepStrictEqual(generations, {
  search: 4,
  playlists: 2,
  playlistTracks: 8,
  recommendations: 3,
  recommendationTracks: 7,
  toplists: 1,
  toplistTracks: 5,
});
assert.strictEqual(invalidateRemoteCatalogState(current, 11), null);
assert.strictEqual(invalidateRemoteCatalogState(current, 10), null);
assert.strictEqual(invalidateRemoteCatalogState(current, undefined), null);
assert.strictEqual(invalidateRemoteCatalogState(current, '12'), null);
assert.strictEqual(invalidateRemoteCatalogState(current, -1), null);
assert.strictEqual(
  invalidateRemoteCatalogState({ generations }, 0).catalogEpoch,
  0
);

console.log('KTV remote catalog epoch invalidation tests passed');
