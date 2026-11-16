const assert = require('assert');
require('./helpers/register-babel-src');

const {
  appendCatalogItems,
  catalogPageProgress,
  createCatalogPageState,
} = require('../src/remote/catalogPagination');

const firstPageState = createCatalogPageState();
assert.deepStrictEqual(firstPageState, {
  nextOffset: 0,
  hasMore: false,
  total: null,
  requestedCount: 0,
  unavailableCount: 0,
  loading: false,
  error: null,
  retryAfterMs: 0,
});
const secondPageState = createCatalogPageState();
firstPageState.loading = true;
assert.equal(
  secondPageState.loading,
  false,
  'catalog pages receive independent initial state'
);

const merged = appendCatalogItems(
  [
    { trackId: '1', name: '第一首' },
    { trackId: '2', name: '第二首' },
  ],
  [
    { trackId: '2', name: '重复歌曲' },
    { trackId: '3', name: '第三首' },
  ]
);
assert.deepStrictEqual(
  merged.map(track => track.trackId),
  ['1', '2', '3'],
  'appending a page preserves existing order and suppresses repeated rows'
);

const progress = catalogPageProgress(
  {
    tracks: Array.from({ length: 99 }, (_, index) => ({ trackId: index + 1 })),
    offset: 100,
    nextOffset: 200,
    requestedCount: 100,
    unavailableCount: 1,
    total: 305,
    hasMore: true,
  },
  100,
  100
);
assert.deepStrictEqual(progress, {
  nextOffset: 200,
  requestedCount: 100,
  unavailableCount: 1,
  total: 305,
  hasMore: true,
});

const finalPage = catalogPageProgress(
  { tracks: [{ trackId: '301' }], nextOffset: 301, total: 301, hasMore: false },
  300,
  100
);
assert.equal(finalPage.nextOffset, 301);
assert.equal(finalPage.hasMore, false);

console.log('KTV catalog pagination UI state tests passed');
