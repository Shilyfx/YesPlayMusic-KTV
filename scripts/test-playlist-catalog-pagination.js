const assert = require('assert');
const Module = require('module');
require('./helpers/register-babel-src');

let playlistPageHandler;
let playlistDetailHandler;
let trackDetailHandler;
const playlistCalls = [];
const detailCalls = [];
const stubs = {
  '@/api/others': { search: async () => ({ result: {} }) },
  '@/api/track': {
    getMP3: async () => ({ data: [] }),
    getTrackDetail: async (...args) => {
      detailCalls.push(args);
      return trackDetailHandler(...args);
    },
  },
  '@/api/playlist': {
    getPlaylistDetail: async (...args) => playlistDetailHandler(...args),
    recommendPlaylist: async () => ({ result: [] }),
    toplists: async () => ({ list: [] }),
  },
  '@/api/user': {
    userPlaylist: async params => {
      playlistCalls.push(params);
      return playlistPageHandler(params);
    },
  },
  '@/api/artist': { getArtist: async () => ({ songs: [] }) },
  '@/utils/common': { mapTrackPlayableStatus: tracks => tracks },
  '@/utils/auth': { isAccountLoggedIn: () => true },
  '@/utils/playList': { getRecommendPlayList: async () => [] },
};
const originalLoad = Module._load;
Module._load = function loadWithCatalogStubs(request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(stubs, request))
    return stubs[request];
  return originalLoad.call(this, request, parent, isMain);
};

const { hostCatalog } = require('../src/electron/ipcRenderer');

const userId = 'catalog-completeness-user';
const store = {
  state: {
    data: { user: { userId } },
    liked: {
      playlists: Array.from({ length: 2000 }, (_, index) => ({
        id: index + 1,
      })),
    },
  },
};
const allPlaylists = Array.from({ length: 2501 }, (_, index) => ({
  id: String(index + 1),
  name: `歌单${index + 1}`,
  trackCount: 305,
}));
const sourceTrackIds = Array.from({ length: 305 }, (_, index) => ({
  id: index + 1,
}));

function song(id) {
  return {
    id,
    name: `歌曲${id}`,
    ar: [{ name: '分页歌手' }],
    al: { name: '分页专辑', picUrl: '' },
    dt: 180000,
    alia: [],
  };
}

async function testPlaylistListDoesNotTrustTruncatedPreload() {
  playlistCalls.length = 0;
  playlistPageHandler = ({ offset, limit }) => ({
    playlist: allPlaylists.slice(offset, offset + limit),
    more: offset + limit < allPlaylists.length,
    count: allPlaylists.length,
  });

  const page = await hostCatalog(
    'playlists',
    { offset: 2400, limit: 100 },
    store
  );

  assert.equal(page.playlists.length, 100);
  assert.equal(page.playlists[0].id, '2401');
  assert.equal(page.playlists[99].id, '2500');
  assert.equal(page.offset, 2400);
  assert.equal(page.nextOffset, 2500);
  assert.equal(page.total, 2501);
  assert.equal(page.hasMore, true);
  assert.equal(playlistCalls.length, 1);
  assert.deepEqual(
    playlistCalls.map(call => call.offset),
    [2400]
  );
  assert(playlistCalls.every(call => call.limit === 100));
}

async function testPlaylistListLoadsOnlyTheRequestedPage() {
  const pageCalls = [];
  playlistPageHandler = params => {
    pageCalls.push(params);
    return {
      playlist: allPlaylists.slice(params.offset, params.offset + params.limit),
      more: params.offset + params.limit < allPlaylists.length,
      count: allPlaylists.length,
    };
  };
  const page = await hostCatalog(
    'playlists',
    { offset: 0, limit: 100 },
    { state: { data: { user: { userId: 'catalog-first-page-user' } } } }
  );

  assert.equal(page.playlists.length, 100);
  assert.equal(page.total, 2501);
  assert.equal(page.hasMore, true);
  assert.equal(
    pageCalls.length,
    1,
    'a first-page request makes one upstream call'
  );
  assert.equal(pageCalls[0].offset, 0);
}

async function testPlaylistListCanPageThroughTheEntireCatalog() {
  const pageCalls = [];
  playlistPageHandler = params => {
    pageCalls.push(params);
    return {
      playlist: allPlaylists.slice(params.offset, params.offset + params.limit),
      more: params.offset + params.limit < allPlaylists.length,
      count: allPlaylists.length,
    };
  };
  const pageStore = {
    state: { data: { user: { userId: 'catalog-all-pages-user' } } },
  };
  const received = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const page = await hostCatalog(
      'playlists',
      { offset, limit: 100 },
      pageStore
    );
    received.push(...page.playlists.map(playlist => playlist.id));
    offset = page.nextOffset;
    hasMore = page.hasMore;
  }

  assert.deepEqual(
    received,
    allPlaylists.map(playlist => playlist.id)
  );
  assert.equal(pageCalls.length, 26);
  assert.deepEqual(
    pageCalls.map(call => call.offset),
    Array.from({ length: 26 }, (_, index) => index * 100)
  );
}

async function testPlaylistTracksFetchOnlyTheRequestedIdsInPlaylistOrder() {
  detailCalls.length = 0;
  playlistDetailHandler = async id => {
    assert.equal(String(id), '2401');
    return { playlist: { trackIds: sourceTrackIds, tracks: [] } };
  };
  trackDetailHandler = async ids => ({
    songs: ids
      .split(',')
      .map(Number)
      .filter(id => id !== 105)
      .reverse()
      .map(song),
  });

  const page = await hostCatalog(
    'playlistTracks',
    { playlistId: '2401', offset: 100, limit: 100 },
    store
  );

  assert.equal(detailCalls.length, 1);
  assert.equal(
    detailCalls[0][0],
    '101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,123,124,125,126,127,128,129,130,131,132,133,134,135,136,137,138,139,140,141,142,143,144,145,146,147,148,149,150,151,152,153,154,155,156,157,158,159,160,161,162,163,164,165,166,167,168,169,170,171,172,173,174,175,176,177,178,179,180,181,182,183,184,185,186,187,188,189,190,191,192,193,194,195,196,197,198,199,200'
  );
  assert.equal(page.tracks.length, 99);
  assert.deepEqual(
    page.tracks.slice(0, 5).map(track => track.id),
    [101, 102, 103, 104, 106]
  );
  assert.equal(page.offset, 100);
  assert.equal(page.nextOffset, 200);
  assert.equal(page.requestedCount, 100);
  assert.equal(page.unavailableCount, 1);
  assert.equal(page.total, 305);
  assert.equal(page.hasMore, true);
}

async function testUnauthorizedPlaylistPageIsRejected() {
  let detailCallsBefore = detailCalls.length;
  const playlistCallsBefore = playlistCalls.length;
  await assert.rejects(
    () =>
      hostCatalog(
        'playlistTracks',
        {
          playlistId: '9002',
          offset: 0,
          limit: 100,
        },
        store
      ),
    /PLAYLIST_NOT_FOUND/
  );
  assert.equal(detailCalls.length, detailCallsBefore);
  assert.equal(
    playlistCalls.length,
    playlistCallsBefore,
    'an unknown playlist ID does not trigger a catalog scan'
  );
}

async function testExpiredPlaylistAuthorizationRevalidatesItsSourcePage() {
  const originalNow = Date.now;
  let now = 100000;
  Date.now = () => now;
  const pageStore = {
    state: { data: { user: { userId: 'catalog-expired-allowlist-user' } } },
  };
  const calls = [];
  playlistPageHandler = params => {
    calls.push(params);
    return {
      playlist: allPlaylists.slice(params.offset, params.offset + params.limit),
      more: params.offset + params.limit < allPlaylists.length,
      count: allPlaylists.length,
    };
  };
  playlistDetailHandler = async () => ({
    playlist: { trackIds: [], tracks: [] },
  });
  try {
    const firstPage = await hostCatalog(
      'playlists',
      { offset: 0, limit: 100 },
      pageStore
    );
    assert.equal(firstPage.playlists[0].id, '1');
    now += 46000;

    const tracks = await hostCatalog(
      'playlistTracks',
      { playlistId: '1', offset: 0, limit: 100 },
      pageStore
    );

    assert.deepEqual(tracks.tracks, []);
    assert.deepEqual(
      calls.map(call => call.offset),
      [0, 0],
      'expired authorization rechecks only the page that contained the ID'
    );
  } finally {
    Date.now = originalNow;
  }
}

async function testRepeatedPlaylistPageAtAnotherOffsetIsRejected() {
  const pageStore = {
    state: { data: { user: { userId: 'catalog-repeated-page-user' } } },
  };
  playlistPageHandler = params => ({
    playlist: allPlaylists.slice(0, params.limit),
    more: params.offset === 0,
    count: allPlaylists.length,
  });
  await hostCatalog('playlists', { offset: 0, limit: 100 }, pageStore);
  await assert.rejects(
    () => hostCatalog('playlists', { offset: 100, limit: 100 }, pageStore),
    /PLAYLIST_PAGINATION_STALLED/
  );
}

async function testLegacyPlaylistTrackRequestKeepsFullAllowlistBehavior() {
  const pageStore = {
    state: { data: { user: { userId: 'catalog-legacy-allowlist-user' } } },
  };
  const calls = [];
  playlistPageHandler = params => {
    calls.push(params);
    return {
      playlist: allPlaylists.slice(params.offset, params.offset + params.limit),
      more: params.offset + params.limit < allPlaylists.length,
      count: allPlaylists.length,
    };
  };
  playlistDetailHandler = async () => ({
    playlist: { trackIds: [], tracks: [] },
  });

  const tracks = await hostCatalog(
    'playlistTracks',
    { playlistId: '2501' },
    pageStore
  );

  assert.deepEqual(tracks, []);
  assert.equal(calls.length, 26);
  assert.equal(calls[calls.length - 1].offset, 2500);
}

async function testAccountSwitchDiscardsAnInFlightPlaylistPage() {
  let started;
  const requestStarted = new Promise(resolve => {
    started = resolve;
  });
  let finishRequest;
  const response = new Promise(resolve => {
    finishRequest = resolve;
  });
  const changingStore = {
    state: { data: { user: { userId: 'catalog-switch-before' } } },
  };
  playlistPageHandler = async () => {
    started();
    return response;
  };

  const pageRequest = hostCatalog(
    'playlists',
    { offset: 0, limit: 100 },
    changingStore
  );
  await requestStarted;
  changingStore.state.data.user.userId = 'catalog-switch-after';
  finishRequest({
    playlist: [{ id: '9001', name: '旧账号歌单' }],
    more: false,
  });

  await assert.rejects(pageRequest, /CATALOG_IDENTITY_CHANGED/);
}

async function run() {
  try {
    await testPlaylistListDoesNotTrustTruncatedPreload();
    await testPlaylistListLoadsOnlyTheRequestedPage();
    await testPlaylistListCanPageThroughTheEntireCatalog();
    await testPlaylistTracksFetchOnlyTheRequestedIdsInPlaylistOrder();
    await testUnauthorizedPlaylistPageIsRejected();
    await testExpiredPlaylistAuthorizationRevalidatesItsSourcePage();
    await testRepeatedPlaylistPageAtAnotherOffsetIsRejected();
    await testLegacyPlaylistTrackRequestKeepsFullAllowlistBehavior();
    await testAccountSwitchDiscardsAnInFlightPlaylistPage();
  } finally {
    Module._load = originalLoad;
  }
  console.log('Playlist catalog pagination tests passed');
}

run().catch(error => {
  Module._load = originalLoad;
  console.error(error);
  process.exitCode = 1;
});
