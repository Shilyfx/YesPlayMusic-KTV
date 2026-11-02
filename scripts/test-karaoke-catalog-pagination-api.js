const assert = require('assert');
const http = require('http');
require('./helpers/register-babel-src');

const {
  KaraokeCatalogService,
  KaraokeRemoteService,
  RemoteApiRouter,
} = require('../src/electron/karaoke/KaraokeRemoteApi');

function request(port, pathname, token) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method: 'GET',
        path: pathname,
        headers: { Authorization: `Bearer ${token}` },
      },
      response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => (body += chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: JSON.parse(body || '{}'),
          })
        );
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function track(id) {
  return {
    id: String(id),
    name: `歌曲${id}`,
    ar: [{ name: '分页歌手' }],
    al: { name: '分页专辑', picUrl: '' },
    dt: 180000,
  };
}

function makePage(items, offset, limit) {
  const tracks = items.slice(offset, offset + limit);
  return {
    tracks,
    offset,
    nextOffset: offset + tracks.length,
    requestedCount: tracks.length,
    unavailableCount: 0,
    total: items.length,
    hasMore: offset + tracks.length < items.length,
  };
}

async function run() {
  const bridgeCalls = [];
  const allPlaylists = Array.from({ length: 2501 }, (_, index) => ({
    id: String(index + 1),
    name: `歌单${index + 1}`,
    trackCount: 1000,
  }));
  const allTracks = Array.from({ length: 1000 }, (_, index) =>
    track(index + 1)
  );
  const catalogSizeCases = [0, 30, 100, 101, 300, 301, 1000].map(
    (count, index) => {
      const id = String(7100 + index);
      const tracks = Array.from({ length: count }, (_, trackIndex) =>
        track(trackIndex + 1)
      );
      return { id, count, tracks };
    }
  );
  const catalogSizeTracks = new Map(
    catalogSizeCases.map(testCase => [testCase.id, testCase.tracks])
  );
  const catalog = new KaraokeCatalogService({
    hostCatalogBridge: async (action, args = {}) => {
      bridgeCalls.push({ action, args });
      if (action === 'playlists') {
        if (!Object.prototype.hasOwnProperty.call(args, 'offset'))
          return allPlaylists;
        const playlists = allPlaylists.slice(
          args.offset,
          args.offset + args.limit
        );
        return {
          playlists,
          offset: args.offset,
          nextOffset: args.offset + playlists.length,
          total: allPlaylists.length,
          hasMore: args.offset + playlists.length < allPlaylists.length,
        };
      }
      if (action === 'playlistTracks' || action === 'artistTracks') {
        const catalogId = String(args.playlistId || args.artistId || '');
        const catalogTracks = catalogSizeTracks.get(catalogId) || allTracks;
        return Object.prototype.hasOwnProperty.call(args, 'offset')
          ? makePage(catalogTracks, args.offset, args.limit)
          : catalogTracks;
      }
      throw new Error(`Unexpected catalog action: ${action}`);
    },
  });
  const room = {
    code: 'PAGE01',
    token: 'catalog-page-token',
    sessionId: 'catalog-page-session',
    generation: 1,
  };
  const service = new KaraokeRemoteService({
    catalog,
    managerBridge: {},
    getRoom: () => room,
  });
  service.onRoomStart(room);
  const guest = service.bootstrap(room.token, '127.0.0.1');
  const router = new RemoteApiRouter(service);
  const server = http.createServer((request, response) => {
    router.handle(request, response).then(handled => {
      if (!handled) {
        response.writeHead(404);
        response.end();
      }
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const playlistListPage = await request(
      port,
      '/ktv/api/playlists?offset=2400&limit=100',
      guest.clientToken
    );
    assert.equal(playlistListPage.status, 200);
    assert.equal(playlistListPage.body.playlists.length, 100);
    assert.equal(playlistListPage.body.playlists[0].id, '2401');
    assert.equal(playlistListPage.body.offset, 2400);
    assert.equal(playlistListPage.body.nextOffset, 2500);
    assert.equal(playlistListPage.body.total, 2501);
    assert.equal(playlistListPage.body.hasMore, true);

    const playlistPage = await request(
      port,
      '/ktv/api/playlists/9001/tracks?offset=300&limit=100',
      guest.clientToken
    );
    assert.equal(playlistPage.status, 200);
    assert.equal(
      playlistPage.body.tracks.length,
      100,
      JSON.stringify(playlistPage.body)
    );
    assert.equal(playlistPage.body.tracks[0].trackId, '301');
    assert.equal(playlistPage.body.offset, 300);
    assert.equal(playlistPage.body.nextOffset, 400);
    assert.equal(playlistPage.body.total, 1000);
    assert.equal(playlistPage.body.hasMore, true);

    const artistPage = await request(
      port,
      '/ktv/api/artists/7001/tracks?offset=900&limit=100',
      guest.clientToken
    );
    assert.equal(artistPage.status, 200);
    assert.equal(artistPage.body.tracks.length, 100);
    assert.equal(artistPage.body.tracks[0].trackId, '901');
    assert.equal(artistPage.body.offset, 900);
    assert.equal(artistPage.body.nextOffset, 1000);
    assert.equal(artistPage.body.hasMore, false);

    const catalogMatrix = [];
    for (const resource of ['artists', 'playlists']) {
      for (const testCase of catalogSizeCases) {
        service.limiter.clear();
        let offset = 0;
        let hasMore = true;
        const receivedIds = [];
        let pages = 0;
        let maxBytes = 0;
        let maxLatencyMs = 0;
        while (hasMore) {
          const startedAt = Date.now();
          const page = await request(
            port,
            resource === 'artists'
              ? `/ktv/api/artists/${testCase.id}/tracks?offset=${offset}&limit=100`
              : `/ktv/api/playlists/${testCase.id}/tracks?offset=${offset}&limit=100`,
            guest.clientToken
          );
          maxLatencyMs = Math.max(maxLatencyMs, Date.now() - startedAt);
          assert.equal(page.status, 200);
          assert.equal(page.body.offset, offset);
          assert.equal(page.body.total, testCase.count);
          assert.equal(
            page.body.tracks.length,
            Math.min(100, testCase.count - offset)
          );
          receivedIds.push(...page.body.tracks.map(item => item.trackId));
          const bytes = Buffer.byteLength(JSON.stringify(page.body));
          maxBytes = Math.max(maxBytes, bytes);
          assert(bytes <= 512 * 1024, `page payload was ${bytes} bytes`);
          offset = page.body.nextOffset;
          hasMore = page.body.hasMore;
          pages += 1;
          assert(pages <= 10, 'page sequence should stop at the source length');
        }
        assert.deepEqual(
          receivedIds,
          Array.from({ length: testCase.count }, (_, index) =>
            String(index + 1)
          )
        );
        catalogMatrix.push({
          resource,
          count: testCase.count,
          pages,
          maxBytes,
          maxLatencyMs,
        });
      }
    }
    console.log(`Catalog size matrix: ${JSON.stringify(catalogMatrix)}`);

    const legacyPlaylistList = await request(
      port,
      '/ktv/api/playlists',
      guest.clientToken
    );
    assert.equal(legacyPlaylistList.status, 200);
    assert.deepEqual(Object.keys(legacyPlaylistList.body), ['playlists']);
    assert.equal(legacyPlaylistList.body.playlists.length, 2501);

    const legacyPlaylistTracks = await request(
      port,
      '/ktv/api/playlists/9001/tracks',
      guest.clientToken
    );
    assert.equal(legacyPlaylistTracks.status, 200);
    assert.deepEqual(Object.keys(legacyPlaylistTracks.body), ['tracks']);
    assert.equal(legacyPlaylistTracks.body.tracks.length, 1000);

    const legacyPage = await request(
      port,
      '/ktv/api/artists/7001/tracks',
      guest.clientToken
    );
    assert.equal(legacyPage.status, 200);
    assert.deepEqual(Object.keys(legacyPage.body), ['tracks']);
    assert(Array.isArray(legacyPage.body.tracks));

    const invalidPageSize = await request(
      port,
      '/ktv/api/artists/7001/tracks?offset=0&limit=101',
      guest.clientToken
    );
    assert.equal(invalidPageSize.status, 400);
    assert.equal(invalidPageSize.body.error, 'INVALID_PAGINATION');

    const invalidOffset = await request(
      port,
      '/ktv/api/artists/7001/tracks?offset=9007199254740991&limit=100',
      guest.clientToken
    );
    assert.equal(invalidOffset.status, 400);
    assert.equal(invalidOffset.body.error, 'INVALID_PAGINATION');

    const rateLimitKey = `artistTracks:${guest.clientId}`;
    service.limiter.entries.set(rateLimitKey, {
      startedAt: Date.now(),
      count: 20,
    });
    const rateLimited = await request(
      port,
      '/ktv/api/artists/7001/tracks?offset=0&limit=100',
      guest.clientToken
    );
    assert.equal(rateLimited.status, 429);
    assert.equal(rateLimited.body.error, 'RATE_LIMIT');
    assert(Number(rateLimited.body.retryAfterMs) > 0);
    assert(Number(rateLimited.headers['retry-after']) > 0);
    assert(Number(rateLimited.headers['retry-after']) <= 10);

    console.log('KTV catalog pagination API tests passed');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
