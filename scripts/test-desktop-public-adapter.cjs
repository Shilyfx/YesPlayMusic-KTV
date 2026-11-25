'use strict';
const assert = require('assert');
const {
  createDesktopPublicAdapter,
} = require('../src/multiroom/desktopPublicAdapter.cjs');

async function run() {
  const roomServer = {
    room: { token: 'lan-secret' },
    sendRemoteAsset: (path, res) => {
      res.status = 200;
      res.body = path;
    },
  };
  let apiCall;
  const remoteApi = {
    handle: (req, res, publicGuest) => {
      apiCall = { authorization: req.headers.authorization, publicGuest };
      if (req.method === 'GET' && req.url.startsWith('/ktv/api/')) {
        const body = req.url.split('?')[0] === '/ktv/api/playlists'
          ? {
              playlists: [
                {
                  id: '123',
                  name: 'Personal',
                  trackCount: 3,
                  coverUrl: 'https://img.example/cover.jpg',
                  creatorName: 'Account owner',
                  userId: 99,
                  token: 'private',
                },
              ],
              offset: 0,
              nextOffset: 1,
              total: 3,
              hasMore: true,
            }
          : req.url.startsWith('/ktv/api/local-playlists')
          ? {
              directories: ['C:\\Users\\alice\\Music'],
              playlists: [
                {
                  id: 'local-playlist-0123456789abcdef',
                  name: 'Music',
                  source: 'local',
                  trackCount: 1,
                  directory: 'C:\\Users\\alice\\Music',
                  tracks: [
                    {
                      trackId: 'local-0123456789abcdef',
                      localId: 'local-0123456789abcdef',
                      name: 'Song',
                      artists: ['Singer'],
                      album: 'Album',
                      duration: 123,
                      playability: 'playable',
                      coverUrl: '/ktv/local/cover/local-0123456789abcdef',
                      audioPath: 'C:\\Users\\alice\\Music\\song.mp3',
                      lyrics: [{ time: 1, content: 'private lyric' }],
                    },
                  ],
                },
              ],
            }
          : { playlists: [], tracks: [] };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
        return;
      }
      res.status = 200;
    },
  };
  let token = 'one-room-only';
  const handle = createDesktopPublicAdapter({
    roomServer,
    remoteApi,
    publicOrigin: 'https://ktv.example',
    getPublicToken: () => token,
  });
  async function request(method, url, headers = {}) {
    const req = { method, url, headers };
    const res = {
      headers: {},
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value;
      },
      writeHead(status) {
        this.status = status;
      },
      end(body) {
        this.body = body;
      },
    };
    await handle(req, res);
    return res;
  }
  assert.equal(
    (await request('GET', '/room/img/singer.webp')).body,
    '/img/singer.webp'
  );
  assert.equal(
    (await request('GET', '/room/artist-portraits/6452.jpg')).body,
    '/artist-portraits/6452.jpg'
  );
  assert.equal(
    (await request('GET', '/room/artist-portraits/6452.png')).status,
    404
  );
  assert.equal((await request('GET', '/room/js/%2e%2e/secret.js')).status, 404);
  assert.equal(
    (await request('GET', '/ktv/local/audio/local-0123456789abcdef')).status,
    404
  );
  assert.equal(
    (await request('GET', '/ktv/api/track/123/preview')).status,
    404
  );
  assert.equal((await request('GET', '/ktv/host/status')).status, 404);
  for (const route of [
    '/ktv/api/recommendations',
    '/ktv/api/toplists',
    '/ktv/api/playlists?offset=0&limit=10',
    '/ktv/api/local-playlists',
    '/ktv/api/recommendations/123/tracks',
    '/ktv/api/toplists/123/tracks',
    '/ktv/api/playlists/123/tracks',
  ]) {
    const response = await request('GET', route, {
      authorization: 'Bearer client-token',
    });
    assert.equal(response.status, 200, route);
    assert.equal(apiCall.publicGuest, true, route);
  }
  const userPlaylists = await request('GET', '/ktv/api/playlists', {
    authorization: 'Bearer client-token',
  });
  assert.deepEqual(JSON.parse(userPlaylists.body), {
    playlists: [
      {
        id: '123',
        name: 'Personal',
        trackCount: 3,
        coverUrl: 'https://img.example/cover.jpg',
      },
    ],
    offset: 0,
    nextOffset: 1,
    total: 3,
    hasMore: true,
  });
  const localCatalog = await request('GET', '/ktv/api/local-playlists', {
    authorization: 'Bearer client-token',
  });
  assert.deepEqual(JSON.parse(localCatalog.body), {
    playlists: [
      {
        id: 'local-playlist-0123456789abcdef',
        name: 'Music',
        source: 'local',
        trackCount: 1,
        tracks: [
          {
            trackId: 'local-0123456789abcdef',
            source: 'local',
            name: 'Song',
            artists: ['Singer'],
            album: 'Album',
            duration: 123,
            playability: 'playable',
          },
        ],
      },
    ],
  });
  assert.equal(apiCall.authorization, 'Bearer client-token');
  assert.equal(
    (
      await request('POST', '/ktv/api/client-session', {
        origin: 'https://evil.example',
        authorization: 'Bearer one-room-only',
      })
    ).status,
    403
  );
  assert.equal(
    (
      await request('POST', '/ktv/api/client-session', {
        origin: 'https://ktv.example',
        authorization: 'Bearer other-room',
      })
    ).status,
    401
  );
  assert.equal(
    (
      await request('POST', '/ktv/api/client-session', {
        origin: 'https://ktv.example',
        authorization: 'Bearer one-room-only',
      })
    ).status,
    200
  );
  assert.deepEqual(apiCall, {
    authorization: 'Bearer lan-secret',
    publicGuest: true,
  });
  token = 'next-room';
  assert.equal(
    (
      await request('POST', '/ktv/api/client-session', {
        origin: 'https://ktv.example',
        authorization: 'Bearer one-room-only',
      })
    ).status,
    401
  );
  roomServer.room = null;
  assert.equal((await request('GET', '/ktv/api/state')).status, 410);
  console.log('PASS: desktop public guest isolation');
}
run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
