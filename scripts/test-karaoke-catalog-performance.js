const assert = require('assert');

require('./helpers/register-babel-src');

const {
  KaraokeCatalogService,
  KaraokeRemoteService,
} = require('../src/electron/karaoke/KaraokeRemoteApi');
const createUserPlaylistCache =
  require('../src/electron/userPlaylistCache').default;

async function testCatalogSingleFlight() {
  let availabilityCalls = 0;
  let trackDetailCalls = 0;
  let recommendationsCalls = 0;
  let recommendationTracksCalls = 0;
  let artistSearchCalls = 0;
  let searchCalls = 0;
  let localCalls = 0;
  const bridge = async action => {
    if (action === 'localPlaylists') {
      localCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return [{ id: 'local-library', name: '本地歌单', tracks: [] }];
    }
    if (action === 'search') {
      searchCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return [{ id: 22, name: '搜索歌曲', ar: [], al: {}, dt: 1 }];
    }
    if (action === 'availability') {
      availabilityCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return 'playable';
    }
    if (action === 'trackDetail') {
      trackDetailCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return { id: 1, name: 'Track', ar: [], al: {}, dt: 1 };
    }
    if (action === 'recommendations') {
      recommendationsCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return [{ id: '9002', name: '推荐歌单', trackCount: 1 }];
    }
    if (action === 'recommendationTracks') {
      recommendationTracksCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return [
        { id: 10, name: '推荐曲目', ar: [{ name: '歌手' }], al: {}, dt: 1 },
      ];
    }
    if (action === 'artistSearch') {
      artistSearchCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return [{ id: '6452', name: '周杰伦' }];
    }
    throw new Error(`Unexpected action: ${action}`);
  };
  const catalog = new KaraokeCatalogService({ hostCatalogBridge: bridge });
  await Promise.all([
    catalog.availability('1'),
    catalog.availability('1'),
    catalog.availability('1', { fresh: true }),
  ]);
  await Promise.all([catalog.getTrack('1'), catalog.getTrack('1')]);
  await Promise.all([catalog.recommendations(), catalog.recommendations()]);
  await Promise.all([
    catalog.recommendationTracks('9002'),
    catalog.recommendationTracks('9002'),
  ]);
  await Promise.all([
    catalog.artistSearch('周杰伦'),
    catalog.artistSearch('周杰伦'),
  ]);
  const searches = await Promise.all(
    Array.from({ length: 16 }, (_, index) =>
      catalog.search(index % 2 ? '同一首歌' : ' 同一首歌 ')
    )
  );
  searches.forEach(result => assert.deepStrictEqual(result, searches[0]));
  assert.strictEqual(searchCalls, 1);
  await catalog.search('同一首歌');
  assert.strictEqual(searchCalls, 1);
  const localResults = await Promise.all(
    Array.from({ length: 19 }, () => catalog.localPlaylists())
  );
  localResults.forEach(result =>
    assert.deepStrictEqual(result, localResults[0])
  );
  assert.strictEqual(localCalls, 1);
  await catalog.localPlaylists();
  assert.strictEqual(localCalls, 2);
  // Track returned from recommendationTracks should already populate trackCache
  const cachedTrack = await catalog.getTrack('10');
  assert.strictEqual(cachedTrack.name, '推荐曲目');
  assert.strictEqual(availabilityCalls, 1);
  assert.strictEqual(trackDetailCalls, 1);
  assert.strictEqual(recommendationsCalls, 1);
  assert.strictEqual(recommendationTracksCalls, 1);
  assert.strictEqual(artistSearchCalls, 1);
  assert.strictEqual(catalog.peekAvailability('1'), 'playable');
}

async function testPlaylistAllowlistSingleFlight() {
  const cache = createUserPlaylistCache();
  let calls = 0;
  const fetchPlaylists = async () => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 5));
    return [{ id: '9001' }];
  };
  const [first, second] = await Promise.all([
    cache({ userId: '42', fetchPlaylists }),
    cache({ userId: '42', fetchPlaylists }),
  ]);
  assert.deepStrictEqual(first, second);
  assert.strictEqual(calls, 1);
  await cache({ userId: '42', fetchPlaylists });
  assert.strictEqual(calls, 1);
  await cache({ userId: '42', fetchPlaylists, force: true });
  assert.strictEqual(calls, 2);
  let finishOld;
  const old = cache({
    userId: 'old',
    fetchPlaylists: () =>
      new Promise(resolve => {
        finishOld = resolve;
      }),
  });
  const current = await cache({
    userId: 'new',
    fetchPlaylists: async () => [{ id: 'new' }],
  });
  finishOld([{ id: 'old' }]);
  await old;
  assert.deepStrictEqual(
    await cache({
      userId: 'new',
      fetchPlaylists: async () => {
        throw new Error('unexpected fetch');
      },
    }),
    current
  );
}

async function testForcedRefreshDoesNotRestoreOldCache() {
  const catalog = new KaraokeCatalogService({
    hostCatalogBridge: async () => [],
  });
  let finishOld;
  const oldRequest = catalog.cachedCatalog(
    'race',
    () =>
      new Promise(resolve => {
        finishOld = resolve;
      })
  );
  const freshRequest = catalog.cachedCatalog('race', async () => 'new', {
    force: true,
  });
  assert.strictEqual(await freshRequest, 'new');
  finishOld('old');
  assert.strictEqual(await oldRequest, 'old');
  assert.strictEqual(
    await catalog.cachedCatalog('race', async () => 'unexpected'),
    'new'
  );
}

async function testRoomChangeInvalidatesAccountCatalog() {
  let currentAccount = 'first';
  let finishOld;
  const catalog = new KaraokeCatalogService({
    hostCatalogBridge: async () => [{ id: currentAccount }],
  });
  const service = new KaraokeRemoteService({
    catalog,
    managerBridge: {},
    getRoom: () => null,
  });
  assert.strictEqual((await catalog.playlists())[0].id, 'first');
  service.onRoomStart({ code: 'FIRST', sessionId: 'first-session' });
  assert.strictEqual(
    catalog.catalogCache.has('playlists'),
    false,
    'starting a new room clears account catalog data left by an earlier room'
  );
  const old = catalog.cachedCatalog(
    'playlistTracks:old',
    () =>
      new Promise(resolve => {
        finishOld = resolve;
      })
  );
  service.onRoomStop();
  currentAccount = 'second';
  assert.strictEqual((await catalog.playlists())[0].id, 'second');
  finishOld('old account');
  await old;
  assert.strictEqual(
    await catalog.cachedCatalog(
      'playlistTracks:old',
      async () => 'new account'
    ),
    'new account'
  );
}

async function testIdentityInvalidationGuardsLateAccountResults() {
  let account = 'A';
  let finishSearchA;
  let finishDetailA;
  let finishAvailabilityA;
  let finishPlaylistsA;
  let finishRecommendationsA;
  let finishToplistsA;
  let searchCalls = 0;
  const catalog = new KaraokeCatalogService({
    hostCatalogBridge: async (action, args) => {
      if (action === 'localPlaylists')
        return [
          {
            id: 'local-library',
            tracks: [
              {
                id: 'local-retained',
                localId: 'local-retained',
                source: 'local',
                name: '本地保留',
                ar: [],
                al: {},
                dt: 1,
              },
            ],
          },
        ];
      if (action === 'search') {
        searchCalls += 1;
        return account === 'A'
          ? new Promise(resolve => {
              finishSearchA = resolve;
            })
          : [{ id: 'shared-track', name: 'B 搜索结果', ar: [], al: {}, dt: 1 }];
      }
      if (action === 'trackDetail')
        return account === 'A'
          ? new Promise(resolve => {
              finishDetailA = resolve;
            })
          : { id: args.trackId, name: 'B 详情', ar: [], al: {}, dt: 1 };
      if (action === 'availability')
        return account === 'A'
          ? new Promise(resolve => {
              finishAvailabilityA = resolve;
            })
          : 'playable';
      if (action === 'playlists')
        return account === 'A'
          ? new Promise(resolve => {
              finishPlaylistsA = resolve;
            })
          : [{ id: 'playlist-B' }];
      if (action === 'recommendations')
        return account === 'A'
          ? new Promise(resolve => {
              finishRecommendationsA = resolve;
            })
          : [{ id: 'recommendation-B' }];
      if (action === 'toplists')
        return account === 'A'
          ? new Promise(resolve => {
              finishToplistsA = resolve;
            })
          : [{ id: 'toplist-B' }];
      throw new Error(`Unexpected action: ${action}`);
    },
  });
  await catalog.localPlaylists();
  const oldRequests = [
    catalog.search('same query'),
    catalog.getTrack('detail-track'),
    catalog.availability('same-availability'),
    catalog.playlists(),
    catalog.recommendations(),
    catalog.toplists(),
  ];
  catalog.resetRoomCatalog();
  account = 'B';
  await Promise.all([
    catalog.search('same query'),
    catalog.getTrack('detail-track'),
    catalog.availability('same-availability'),
    catalog.playlists(),
    catalog.recommendations(),
    catalog.toplists(),
  ]);
  finishSearchA([
    { id: 'shared-track', name: 'A 旧搜索结果', ar: [], al: {}, dt: 1 },
  ]);
  finishDetailA({
    id: 'detail-track',
    name: 'A 旧详情',
    ar: [],
    al: {},
    dt: 1,
  });
  finishAvailabilityA('unavailable');
  finishPlaylistsA([{ id: 'playlist-A' }]);
  finishRecommendationsA([{ id: 'recommendation-A' }]);
  finishToplistsA([{ id: 'toplist-A' }]);
  await Promise.all(oldRequests);

  assert.strictEqual(
    (await catalog.search('same query'))[0].name,
    'B 搜索结果'
  );
  assert.strictEqual(searchCalls, 2);
  assert.strictEqual(
    catalog.catalogCache.get('search:same query').value[0].name,
    'B 搜索结果'
  );
  assert.strictEqual(
    catalog.trackCache.get('shared-track').value.name,
    'B 搜索结果'
  );
  assert.strictEqual((await catalog.getTrack('detail-track')).name, 'B 详情');
  assert.strictEqual(catalog.peekAvailability('same-availability'), 'playable');
  assert.strictEqual((await catalog.playlists())[0].id, 'playlist-B');
  assert.deepStrictEqual(
    [...catalog.recommendationPlaylistIds],
    ['recommendation-B']
  );
  assert.deepStrictEqual([...catalog.toplistIds], ['toplist-B']);
  assert.strictEqual(
    (await catalog.getTrack('local-retained')).name,
    '本地保留'
  );
  assert.strictEqual(catalog.localTrackCache.has('local-retained'), true);
}

async function testCatalogCachesStayBoundedAndCleanExpiredEntries() {
  let availabilityCalls = 0;
  let trackDetailCalls = 0;
  const catalog = new KaraokeCatalogService({
    hostCatalogBridge: async (action, args) => {
      if (action === 'availability') {
        availabilityCalls += 1;
        return 'playable';
      }
      if (action === 'trackDetail') {
        trackDetailCalls += 1;
        return { id: args.trackId, name: 'Track', ar: [], al: {}, dt: 1 };
      }
      throw new Error(`Unexpected action: ${action}`);
    },
  });

  let catalogFetches = 0;
  for (let index = 0; index < 140; index += 1) {
    await catalog.cachedCatalog(`capacity:${index}`, async () => {
      catalogFetches += 1;
      return index;
    });
  }
  let finishPendingCatalog;
  const pendingCatalog = catalog.cachedCatalog(
    'capacity:in-flight',
    () =>
      new Promise(resolve => {
        finishPendingCatalog = resolve;
      })
  );
  catalog.cacheTracks(
    Array.from({ length: 4200 }, (_, index) => ({
      id: `capacity-track-${index}`,
      name: 'Track',
      ar: [],
      al: {},
      dt: 1,
    }))
  );
  for (let index = 0; index < 4200; index += 1)
    await catalog.availability(`capacity-availability-${index}`);

  assert(catalog.catalogCache.size <= 128);
  assert(catalog.trackCache.size <= 4096);
  assert(catalog.availabilityCache.size <= 4096);
  assert.strictEqual(
    await catalog.cachedCatalog('capacity:0', async () => {
      catalogFetches += 1;
      return 'reloaded';
    }),
    'reloaded'
  );
  assert.strictEqual(catalogFetches, 141);
  finishPendingCatalog('completed');
  assert.strictEqual(await pendingCatalog, 'completed');
  await catalog.getTrack('capacity-track-0');
  assert.strictEqual(trackDetailCalls, 1);
  await catalog.availability('capacity-availability-0');
  assert.strictEqual(availabilityCalls, 4201);

  const expiredAt = Date.now() - 1;
  catalog.catalogCache.set('expired-catalog', {
    value: 'stale',
    expiresAt: expiredAt,
  });
  catalog.catalogCache.set('expired-catalog-sibling', {
    value: 'stale',
    expiresAt: expiredAt,
  });
  catalog.trackCache.set('expired-track', {
    value: { trackId: 'expired-track' },
    expiresAt: expiredAt,
  });
  catalog.trackCache.set('expired-track-sibling', {
    value: { trackId: 'expired-track-sibling' },
    expiresAt: expiredAt,
  });
  catalog.availabilityCache.set('expired-availability', {
    value: 'playable',
    expiresAt: expiredAt,
  });
  catalog.availabilityCache.set('expired-availability-sibling', {
    value: 'playable',
    expiresAt: expiredAt,
  });
  assert.strictEqual(
    await catalog.cachedCatalog('expired-catalog', async () => 'fresh'),
    'fresh'
  );
  await catalog.getTrack('expired-track');
  await catalog.availability('expired-availability');
  assert.strictEqual(
    catalog.catalogCache.has('expired-catalog-sibling'),
    false
  );
  assert.strictEqual(catalog.trackCache.has('expired-track-sibling'), false);
  assert.strictEqual(
    catalog.availabilityCache.has('expired-availability-sibling'),
    false
  );
}

async function testAvailabilityErrorsAreNotCached() {
  let calls = 0;
  const catalog = new KaraokeCatalogService({
    hostCatalogBridge: async action => {
      assert.strictEqual(action, 'availability');
      calls += 1;
      return calls === 1 ? 'error' : 'playable';
    },
  });

  assert.strictEqual(await catalog.availability('retry-after-error'), 'error');
  assert.strictEqual(catalog.availabilityCache.has('retry-after-error'), false);
  assert.strictEqual(
    await catalog.availability('retry-after-error'),
    'playable'
  );
  assert.strictEqual(calls, 2);
}

async function testLocalTrackCacheRetainsIncrementalTracks() {
  let sourceTracks = Array.from({ length: 4200 }, (_, index) => ({
    id: `local-${index}`,
    localId: `local-${index}`,
    source: 'local',
    name: `Local ${index}`,
    ar: [],
    al: {},
    dt: 1,
  }));
  const catalog = new KaraokeCatalogService({
    hostCatalogBridge: async action => {
      assert.strictEqual(action, 'localPlaylists');
      return [{ id: 'local-library', name: 'Local', tracks: sourceTracks }];
    },
  });

  await catalog.localPlaylists();
  assert(catalog.trackCache.size <= 4096);
  const retainedLocalTrack = await catalog.getTrack('local-0');
  assert.strictEqual(retainedLocalTrack.source, 'local');
  sourceTracks = sourceTracks.concat({
    id: 'local-4200',
    localId: 'local-4200',
    source: 'local',
    name: 'Local added',
    ar: [],
    al: {},
    dt: 1,
  });
  await catalog.localPlaylists();
  const addedTrack = await catalog.getTrack('local-4200');
  assert.strictEqual(addedTrack.name, 'Local added');
  assert.strictEqual(addedTrack.source, 'local');
}

async function testSearchCacheExpiresAndDoesNotCacheFailures() {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    const calls = new Map();
    const catalog = new KaraokeCatalogService({
      hostCatalogBridge: async (action, { query }) => {
        assert.strictEqual(action, 'search');
        const count = (calls.get(query) || 0) + 1;
        calls.set(query, count);
        if (query === 'failed' && count === 1)
          throw new Error('EXPECTED_SEARCH_FAILURE');
        return [
          {
            id: `${query}-${count}`,
            name: `${query}-${count}`,
            ar: [],
            al: {},
            dt: 1,
          },
        ];
      },
    });

    const first = await catalog.search(' expires ');
    assert.strictEqual(first[0].name, 'expires-1');
    assert.strictEqual((await catalog.search('expires'))[0].name, 'expires-1');
    assert.strictEqual(calls.get('expires'), 1);
    assert.strictEqual(
      catalog.catalogCache.get('search:expires').expiresAt - now,
      15000
    );

    now += 15000;
    assert.strictEqual((await catalog.search('expires'))[0].name, 'expires-2');
    assert.strictEqual(calls.get('expires'), 2);

    await assert.rejects(
      () => catalog.search('failed'),
      /EXPECTED_SEARCH_FAILURE/
    );
    assert.strictEqual((await catalog.search('failed'))[0].name, 'failed-2');
    assert.strictEqual((await catalog.search('failed'))[0].name, 'failed-2');
    assert.strictEqual(calls.get('failed'), 2);
  } finally {
    Date.now = originalNow;
  }
}

Promise.all([
  testCatalogSingleFlight(),
  testPlaylistAllowlistSingleFlight(),
  testForcedRefreshDoesNotRestoreOldCache(),
  testRoomChangeInvalidatesAccountCatalog(),
  testIdentityInvalidationGuardsLateAccountResults(),
  testCatalogCachesStayBoundedAndCleanExpiredEntries(),
  testAvailabilityErrorsAreNotCached(),
  testLocalTrackCacheRetainsIncrementalTracks(),
])
  .then(testSearchCacheExpiresAndDoesNotCacheFailures)
  .then(() => console.log('KTV catalog dedupe tests passed'))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
