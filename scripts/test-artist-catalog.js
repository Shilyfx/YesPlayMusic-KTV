const assert = require('assert');
const Module = require('module');
require('./helpers/register-babel-src');

let requestHandler = async () => ({ songs: [], more: false });
let requestCalls = [];
const fakeRequest = async config => {
  requestCalls.push(config);
  return requestHandler(config);
};

const stubs = {
  '@/utils/request': { __esModule: true, default: fakeRequest },
  '@/utils/common': { mapTrackPlayableStatus: tracks => tracks },
  '@/utils/auth': { isAccountLoggedIn: () => true },
  '@/api/track': {
    getMP3: async () => ({ data: [] }),
    getTrackDetail: async () => ({ songs: [], privileges: [] }),
  },
  '@/api/others': { search: async () => ({ result: {} }) },
  '@/api/playlist': {
    getPlaylistDetail: async () => ({ playlist: {} }),
    recommendPlaylist: async () => ({ result: [] }),
    toplists: async () => ({ list: [] }),
  },
  '@/utils/playList': { getRecommendPlayList: async () => [] },
};
const originalLoad = Module._load;
Module._load = function loadWithArtistApiStubs(request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(stubs, request))
    return stubs[request];
  return originalLoad.call(this, request, parent, isMain);
};

const { hostCatalog } = require('../src/electron/ipcRenderer');

function song(id, name = `测试歌曲${id}`) {
  return {
    id,
    name,
    ar: [{ id: 7001, name: '测试歌手' }],
    al: { id: 8001, name: '测试专辑', picUrl: 'https://example.com/album.jpg' },
    dt: 180000,
    alia: [],
  };
}

async function testArtistTracksReturnsRequestedPageBeyondFormerLimit() {
  requestCalls = [];
  requestHandler = async config => {
    assert.equal(config.url, '/artist/songs');
    assert.equal(config.params.id, '7002');
    assert.equal(config.params.offset, 900);
    assert.equal(config.params.limit, 100);
    return {
      songs: Array.from({ length: 100 }, (_, i) => song(901 + i)),
      more: true,
      total: 1800,
    };
  };

  const page = await hostCatalog('artistTracks', {
    artistId: '7002',
    offset: 900,
    limit: 100,
  });

  assert.deepEqual(
    page.tracks.map(track => track.id),
    Array.from({ length: 100 }, (_, i) => 901 + i)
  );
  assert.equal(page.offset, 900);
  assert.equal(page.nextOffset, 1000);
  assert.equal(page.hasMore, true);
  assert.equal(page.total, 1800);
  assert.equal(page.requestedCount, 100);
  assert.equal(
    requestCalls.length,
    1,
    'one UI page makes one upstream page request'
  );
  assert.equal(requestCalls[0].params.order, 'hot');
  assert.equal(requestCalls[0].timeout, 3000);
  assert(
    new TextEncoder().encode(JSON.stringify(page)).byteLength <= 512 * 1024,
    'one page should stay below the host exchange budget'
  );
}

async function testArtistTracksPreservesOrderAndReportsDuplicateRows() {
  requestCalls = [];
  requestHandler = async () => ({
    songs: [song(1), song(2), song(1), song(3)],
    more: true,
    total: 12,
  });

  const page = await hostCatalog('artistTracks', {
    artistId: '7003',
    offset: 0,
    limit: 100,
  });

  assert.deepEqual(
    page.tracks.map(track => track.id),
    [1, 2, 3]
  );
  assert.equal(page.requestedCount, 4);
  assert.equal(page.nextOffset, 4);
  assert.equal(page.hasMore, true);
  assert.equal(page.total, 12);
  assert.equal(requestCalls.length, 1);
}

async function testArtistTracksStopsWhenUpstreamHasNoMorePages() {
  requestCalls = [];
  requestHandler = async () => ({
    songs: [song(1), song(2)],
    more: false,
    total: 2,
  });

  const page = await hostCatalog('artistTracks', {
    artistId: '7004',
    offset: 0,
    limit: 100,
  });

  assert.equal(page.tracks.length, 2);
  assert.equal(page.nextOffset, 2);
  assert.equal(page.hasMore, false);
  assert.equal(requestCalls.length, 1);
}

async function testArtistTracksRejectsRepeatedPageAtAnotherOffset() {
  requestCalls = [];
  requestHandler = async config => ({
    songs: Array.from({ length: 100 }, (_, i) => song(5001 + i)),
    more: config.params.offset === 0,
    total: 500,
  });

  await hostCatalog('artistTracks', {
    artistId: '7005',
    offset: 0,
    limit: 100,
  });
  await assert.rejects(
    () =>
      hostCatalog('artistTracks', {
        artistId: '7005',
        offset: 100,
        limit: 100,
      }),
    /ARTIST_PAGINATION_STALLED/
  );
  assert.equal(requestCalls.length, 2);
}

async function testArtistPageByteBudgetReturnsAResumableOffset() {
  requestCalls = [];
  requestHandler = async config => {
    const offset = config.params.offset;
    return {
      songs: Array.from({ length: 100 }, (_, i) =>
        song(offset + i + 1, '歌'.repeat(2500))
      ),
      more: true,
      total: 1400,
    };
  };

  const page = await hostCatalog('artistTracks', {
    artistId: '7001',
    offset: 300,
    limit: 100,
  });
  const bytes = new TextEncoder().encode(JSON.stringify(page)).byteLength;

  assert(page.tracks.length > 0);
  assert(
    page.tracks.length < 100,
    'large metadata should keep each page bounded'
  );
  assert.equal(page.nextOffset, 300 + page.tracks.length);
  assert.equal(page.hasMore, true);
  assert(bytes <= 512 * 1024, `expected <= 512 KiB, got ${bytes}`);
}

async function run() {
  try {
    await testArtistTracksReturnsRequestedPageBeyondFormerLimit();
    await testArtistTracksPreservesOrderAndReportsDuplicateRows();
    await testArtistTracksStopsWhenUpstreamHasNoMorePages();
    await testArtistTracksRejectsRepeatedPageAtAnotherOffset();
    await testArtistPageByteBudgetReturnsAResumableOffset();
  } finally {
    Module._load = originalLoad;
  }
  console.log('Artist catalog bridge tests passed');
}

run().catch(error => {
  Module._load = originalLoad;
  console.error(error);
  process.exitCode = 1;
});
