'use strict';
const assert = require('assert');
const http = require('http');
const { createGateway } = require('../src/multiroom/gateway.cjs');
const {
  createHostConnector,
  allowed,
} = require('../src/multiroom/hostConnector.cjs');
const listen = server =>
  new Promise(resolve =>
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  );
const close = server => new Promise(resolve => server.close(resolve));
function get(url) {
  return new Promise((resolve, reject) =>
    http
      .get(url, res => {
        let body = '';
        res.on('data', chunk => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
      })
      .on('error', reject)
  );
}
async function run() {
  assert(allowed('GET', '/room/artist-portraits/6452.jpg'));
  assert(!allowed('GET', '/room/artist-portraits/secret.txt'));
  assert(!allowed('GET', '/room/js/../secret.js'));
  assert(!allowed('GET', '//evil.example/room/'));
  assert(!allowed('GET', '/ktv/local/audio/local-0123456789abcdef'));
  for (const route of [
    '/ktv/api/recommendations',
    '/ktv/api/toplists',
    '/ktv/api/playlists?offset=0&limit=10',
    '/ktv/api/local-playlists',
    '/ktv/api/recommendations/123/tracks',
    '/ktv/api/toplists/123/tracks',
    '/ktv/api/playlists/123/tracks',
  ]) assert(allowed('GET', route), route);
  assert(!allowed('GET', '/ktv/api/track/123/preview'));
  assert(!allowed('GET', '/ktv/api/local-playlists/scan'));
  assert(!allowed('POST', '/ktv/host/next'));
  const first = http.createServer((req, res) => {
    if (req.url.startsWith('/ktv/api/search')) {
      res.writeHead(429, { 'Retry-After': '17' });
      res.end('limited');
      return;
    }
    if (req.url.startsWith('/ktv/api/local-playlists')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          directories: ['C:\\Users\\alice\\Music'],
          playlists: [
            {
              id: 'local-playlist-0123456789abcdef',
              name: 'Music',
              directory: 'C:\\Users\\alice\\Music',
              trackCount: 1,
              tracks: [
                {
                  trackId: 'local-0123456789abcdef',
                  localId: 'local-0123456789abcdef',
                  name: 'Song',
                  audioPath: 'C:\\Users\\alice\\Music\\song.mp3',
                  lyrics: [{ time: 1, content: 'private lyric' }],
                  coverUrl: '/ktv/local/cover/local-0123456789abcdef',
                },
              ],
            },
          ],
        })
      );
      return;
    }
    if (req.url.startsWith('/ktv/api/playlists')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          playlists: [
            {
              id: '123',
              name: 'Personal',
              trackCount: 3,
              creatorName: 'Private account name',
              accountToken: 'must-not-cross',
            },
          ],
        })
      );
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('first ' + req.url);
  });
  const second = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('second ' + req.url);
  });
  const gateway = createGateway({
    hostCredentials: {
      first: 'first-secret-at-least-16',
      second: 'second-secret-at-least-16',
    },
    pollTimeoutMs: 1000,
  });
  const [p1, p2, pg] = await Promise.all([
    listen(first),
    listen(second),
    listen(gateway),
  ]);
  const base = `http://127.0.0.1:${pg}`;
  const a = createHostConnector({
    gatewayOrigin: base,
    hostId: 'first',
    hostSecret: 'first-secret-at-least-16',
    localPort: p1,
  });
  const b = createHostConnector({
    gatewayOrigin: base,
    hostId: 'second',
    hostSecret: 'second-secret-at-least-16',
    localPort: p2,
  });
  try {
    await Promise.all([a.start(), b.start()]);
    const results = await Promise.all([
      get(`${base}/r/${a.roomId}/ktv/api/state`),
      get(`${base}/r/${b.roomId}/ktv/api/state`),
    ]);
    assert.deepEqual(
      results.map(x => x.body),
      ['first /ktv/api/state', 'second /ktv/api/state']
    );
    const localCatalog = await get(
      `${base}/r/${a.roomId}/ktv/api/local-playlists`
    );
    assert.equal(localCatalog.status, 200);
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
              artists: [],
              album: '',
              duration: 0,
              playability: 'playable',
            },
          ],
        },
      ],
    });
    const userPlaylists = await get(
      `${base}/r/${a.roomId}/ktv/api/playlists?limit=10`
    );
    assert.deepEqual(JSON.parse(userPlaylists.body), {
      playlists: [
        {
          id: '123',
          name: 'Personal',
          trackCount: 3,
          coverUrl: '',
        },
      ],
    });
    const limited = await get(`${base}/r/${a.roomId}/ktv/api/search?q=test`);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers['retry-after'], '17');
    assert.equal(
      (await get(`${base}/r/${a.roomId}/ktv/local/list`)).status,
      404
    );
    await a.stop();
    assert.equal(
      (await get(`${base}/r/${a.roomId}/ktv/api/state`)).status,
      410
    );
    assert.equal(
      (await get(`${base}/r/${b.roomId}/ktv/api/state`)).body,
      'second /ktv/api/state'
    );
    console.log('PASS: isolated host connections and revoked room');
  } finally {
    await Promise.all([a.stop(), b.stop()]);
    await Promise.all([close(first), close(second), close(gateway)]);
  }
}
run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
