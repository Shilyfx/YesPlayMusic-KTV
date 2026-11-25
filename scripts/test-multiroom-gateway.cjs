'use strict';

const assert = require('assert');
const http = require('http');
const { createGateway } = require('../src/multiroom/gateway.cjs');

const HOSTS = { alpha: 'alpha-secret-001-extra', beta: 'beta-secret-002-extra' };

function request(port, method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(body);
    const requestHeaders = Object.assign({}, headers || {});
    if (payload && !requestHeaders['content-type'])
      requestHeaders['content-type'] = 'application/json';
    if (payload) requestHeaders['content-length'] = payload.length;
    const req = http.request(
      { hostname: '127.0.0.1', port, method, path, headers: requestHeaders },
      response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          const rawBody = Buffer.concat(chunks);
          let json = null;
          try {
            json = rawBody.length ? JSON.parse(rawBody.toString('utf8')) : null;
          } catch (_) {}
          resolve({ status: response.statusCode, headers: response.headers, body: rawBody, json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function withGateway(options, run) {
  const server = createGateway(
    Object.assign(
      {
        hostCredentials: HOSTS,
        roomTtlMs: 10000,
        pollTimeoutMs: 80,
        requestTimeoutMs: 1000,
      },
      options || {}
    )
  );
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  try {
    await run(port);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function bearer(token) {
  return { authorization: `Bearer ${token}` };
}

async function register(port, hostId, roomId) {
  return request(
    port,
    'POST',
    '/_gateway/register',
    bearer(HOSTS[hostId]),
    JSON.stringify({ hostId, roomId })
  );
}

async function nextHostRequest(port, sessionToken) {
  const response = await request(
    port,
    'GET',
    '/_gateway/host/poll',
    bearer(sessionToken)
  );
  return response;
}

async function completeHostRequest(port, sessionToken, requestId, value) {
  return request(
    port,
    'POST',
    `/_gateway/host/result/${requestId}`,
    bearer(sessionToken),
    JSON.stringify(value)
  );
}

async function testTwoRoomsKeepRequestsAndTokensIsolated() {
  await withGateway({}, async port => {
    const firstRoomId = '1'.repeat(32);
    const secondRoomId = '2'.repeat(32);
    const first = await register(port, 'alpha', firstRoomId);
    const second = await register(port, 'beta', secondRoomId);
    assert.strictEqual(first.status, 201);
    assert.strictEqual(second.status, 201);
    assert.notStrictEqual(first.json.sessionToken, second.json.sessionToken);

    const firstGuest = request(
      port,
      'GET',
      `/r/${firstRoomId}/ktv/api/state?view=queue`,
      { authorization: 'Bearer guest-token-A' }
    );
    const secondGuest = request(
      port,
      'GET',
      `/r/${secondRoomId}/ktv/api/state?view=queue`,
      { authorization: 'Bearer guest-token-B' }
    );
    const firstDelivered = await nextHostRequest(port, first.json.sessionToken);
    const secondDelivered = await nextHostRequest(port, second.json.sessionToken);
    assert.strictEqual(firstDelivered.status, 200);
    assert.strictEqual(secondDelivered.status, 200);
    assert.strictEqual(firstDelivered.json.path, '/ktv/api/state?view=queue');
    assert.strictEqual(firstDelivered.json.headers.authorization, 'Bearer guest-token-A');
    assert.strictEqual(secondDelivered.json.headers.authorization, 'Bearer guest-token-B');
    assert.notStrictEqual(firstDelivered.json.requestId, secondDelivered.json.requestId);

    const crossRoomResult = await completeHostRequest(
      port,
      second.json.sessionToken,
      firstDelivered.json.requestId,
      { status: 200, headers: { 'content-type': 'application/json' }, bodyBase64: 'e30=' }
    );
    assert.strictEqual(crossRoomResult.status, 404);

    const firstResult = await completeHostRequest(
      port,
      first.json.sessionToken,
      firstDelivered.json.requestId,
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
        bodyBase64: Buffer.from('{"room":"alpha"}').toString('base64'),
      }
    );
    const secondResult = await completeHostRequest(
      port,
      second.json.sessionToken,
      secondDelivered.json.requestId,
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
        bodyBase64: Buffer.from('{"room":"beta"}').toString('base64'),
      }
    );
    assert.strictEqual(firstResult.status, 204);
    assert.strictEqual(secondResult.status, 204);
    assert.deepStrictEqual((await firstGuest).json, { room: 'alpha' });
    assert.deepStrictEqual((await secondGuest).json, { room: 'beta' });
  });
}

async function testRejectsUnauthorizedHostsAndSessions() {
  await withGateway({}, async port => {
    const denied = await request(
      port,
      'POST',
      '/_gateway/register',
      bearer('not-a-host-secret'),
      JSON.stringify({ hostId: 'alpha', roomId: '3'.repeat(32) })
    );
    assert.strictEqual(denied.status, 401);

    const room = await register(port, 'alpha', '4'.repeat(32));
    assert.strictEqual(room.status, 201);
    const badPoll = await nextHostRequest(port, 'wrong-session-token');
    assert.strictEqual(badPoll.status, 401);
  });
}

async function testExpiredRoomIsReleasedAndCanBeRegisteredAgain() {
  await withGateway({ roomTtlMs: 70, sweepIntervalMs: 10 }, async port => {
    const roomId = '5'.repeat(32);
    const first = await register(port, 'alpha', roomId);
    assert.strictEqual(first.status, 201);
    await new Promise(resolve => setTimeout(resolve, 120));

    const expiredGuest = await request(
      port,
      'GET',
      `/r/${roomId}/ktv/api/state`,
      {}
    );
    assert.strictEqual(expiredGuest.status, 410);
    const second = await register(port, 'alpha', roomId);
    assert.strictEqual(second.status, 201);
    assert.notStrictEqual(first.json.sessionToken, second.json.sessionToken);
  });
}

async function testAllowedGuestRoutesPreserveMethodHeadersAndBody() {
  await withGateway({}, async port => {
    const roomId = '8'.repeat(32);
    const room = await register(port, 'alpha', roomId);
    assert.strictEqual(room.status, 201);
    const cases = [
      {
        method: 'GET',
        path: '/ktv/api/search?keyword=tea',
        body: '',
        responseStatus: 429,
      },
      { method: 'GET', path: '/ktv/api/artists/search?keyword=tea', body: '' },
      { method: 'GET', path: '/ktv/api/artists/123/tracks?limit=10', body: '' },
      { method: 'GET', path: '/ktv/api/recommendations', body: '' },
      { method: 'GET', path: '/ktv/api/toplists', body: '' },
      {
        method: 'GET',
        path: '/ktv/api/playlists?offset=0&limit=10',
        body: '',
        responseBody:
          '{"playlists":[{"id":"123","name":"Personal","trackCount":3,"coverUrl":"https://img.example/cover.jpg","creatorName":"Alice","userId":99,"secret":"hidden"}],"offset":0,"nextOffset":1,"total":3,"hasMore":true,"directories":["C:\\\\Users"]}',
        expectedResponseBody:
          '{"playlists":[{"id":"123","name":"Personal","trackCount":3,"coverUrl":"https://img.example/cover.jpg"}],"offset":0,"nextOffset":1,"total":3,"hasMore":true}',
      },
      {
        method: 'GET',
        path: '/ktv/api/local-playlists',
        body: '',
        responseBody: '{"playlists":[]}',
      },
      { method: 'GET', path: '/ktv/api/recommendations/123/tracks', body: '' },
      { method: 'GET', path: '/ktv/api/toplists/123/tracks', body: '' },
      { method: 'GET', path: '/ktv/api/playlists/123/tracks', body: '' },
      {
        method: 'GET',
        path: '/room/js/reactions/mood-mates/src/core/engine.js',
        body: '',
      },
      { method: 'GET', path: '/room/artist-portraits/6452.jpg', body: '' },
      { method: 'POST', path: '/ktv/api/client-session', body: '{"join":"opaque-A"}' },
      { method: 'POST', path: '/ktv/api/requests', body: '{"trackId":"123"}' },
      {
        method: 'POST',
        path: '/ktv/api/reactions',
        body: '{"reaction":"clap"}',
        responseStatus: 204,
      },
    ];

    for (const item of cases) {
      const guestPromise = request(
        port,
        item.method,
        `/r/${roomId}${item.path}`,
        {
          authorization: 'Bearer guest-token-verbatim',
        },
        item.body || undefined
      );
      const delivered = await nextHostRequest(port, room.json.sessionToken);
      assert.strictEqual(delivered.status, 200);
      assert.strictEqual(delivered.json.method, item.method);
      assert.strictEqual(delivered.json.path, item.path);
      assert.strictEqual(delivered.json.headers.authorization, 'Bearer guest-token-verbatim');
      assert.strictEqual(Buffer.from(delivered.json.bodyBase64, 'base64').toString(), item.body);

      const completed = await completeHostRequest(
        port,
        room.json.sessionToken,
        delivered.json.requestId,
        {
          status: item.responseStatus || 200,
          headers: {
            'content-type': 'text/plain',
            'retry-after': '17',
            'set-cookie': 'session=must-not-cross',
            location: 'http://127.0.0.1/private',
          },
          bodyBase64:
            item.responseStatus === 204
              ? ''
              : Buffer.from(item.responseBody || 'ok').toString('base64'),
        }
      );
      assert.strictEqual(completed.status, 204);
      const guestResponse = await guestPromise;
      assert.strictEqual(guestResponse.status, item.responseStatus || 200);
      assert.strictEqual(
        guestResponse.body.toString(),
        item.responseStatus === 204
          ? ''
          : item.expectedResponseBody || item.responseBody || 'ok'
      );
      if (item.expectedResponseBody) {
        assert.match(guestResponse.headers['content-type'], /^application\/json/);
      }
      assert.strictEqual(guestResponse.headers['retry-after'], '17');
      assert.strictEqual(guestResponse.headers['set-cookie'], undefined);
      assert.strictEqual(guestResponse.headers.location, undefined);
    }
  });
}

async function testLocalPlaylistResponseRemovesPathsAudioAndLyrics() {
  await withGateway({}, async port => {
    const roomId = 'b'.repeat(32);
    const room = await register(port, 'alpha', roomId);
    assert.strictEqual(room.status, 201);
    const body = {
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
              lyricsPath: 'C:\\Users\\alice\\Music\\song.lrc',
              lyrics: [{ time: 1, content: 'private lyric' }],
              audioUrl: '/ktv/local/audio/local-0123456789abcdef',
            },
          ],
        },
      ],
    };
    const guestPromise = request(
      port,
      'GET',
      `/r/${roomId}/ktv/api/local-playlists`,
      { authorization: 'Bearer guest-token' }
    );
    const delivered = await nextHostRequest(port, room.json.sessionToken);
    const completed = await completeHostRequest(
      port,
      room.json.sessionToken,
      delivered.json.requestId,
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
        bodyBase64: Buffer.from(JSON.stringify(body)).toString('base64'),
      }
    );
    assert.strictEqual(completed.status, 204);
    const guest = await guestPromise;
    assert.strictEqual(guest.status, 200);
    assert.deepStrictEqual(guest.json, {
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
  });
}

async function testUnregisterRevokesSessionAndFailsPendingGuestRequests() {
  await withGateway({}, async port => {
    const roomId = '9'.repeat(32);
    const room = await register(port, 'alpha', roomId);
    assert.strictEqual(room.status, 201);
    const guestPromise = request(port, 'GET', `/r/${roomId}/ktv/api/state`, {});
    const delivered = await nextHostRequest(port, room.json.sessionToken);
    assert.strictEqual(delivered.status, 200);

    const unregistered = await request(
      port,
      'POST',
      '/_gateway/host/unregister',
      bearer(room.json.sessionToken)
    );
    assert.strictEqual(unregistered.status, 204);
    assert.strictEqual((await guestPromise).status, 410);
    assert.strictEqual((await nextHostRequest(port, room.json.sessionToken)).status, 401);
    assert.strictEqual((await register(port, 'alpha', roomId)).status, 201);
  });
}

async function testRoomAndPendingConcurrencyCaps() {
  await withGateway({ maxRooms: 1, maxPendingPerRoom: 1, maxPendingGlobal: 1 }, async port => {
    const roomId = 'a'.repeat(32);
    const room = await register(port, 'alpha', roomId);
    assert.strictEqual(room.status, 201);
    assert.strictEqual((await register(port, 'beta', 'b'.repeat(32))).status, 503);

    const firstGuest = request(port, 'GET', `/r/${roomId}/ktv/api/state`, {});
    const delivered = await nextHostRequest(port, room.json.sessionToken);
    assert.strictEqual(delivered.status, 200);
    const full = await request(port, 'GET', `/r/${roomId}/ktv/api/search`, {});
    assert.strictEqual(full.status, 503);
    const completed = await completeHostRequest(
      port,
      room.json.sessionToken,
      delivered.json.requestId,
      { status: 200, headers: {}, bodyBase64: '' }
    );
    assert.strictEqual(completed.status, 204);
    assert.strictEqual((await firstGuest).status, 200);

    const ended = await request(
      port,
      'POST',
      '/_gateway/host/unregister',
      bearer(room.json.sessionToken)
    );
    assert.strictEqual(ended.status, 204);
    assert.strictEqual((await register(port, 'beta', 'b'.repeat(32))).status, 201);
  });
}

async function testDefaultPerRoomPendingLimitSupportsCatalogStartupBurst() {
  await withGateway({ requestTimeoutMs: 20000, roomTtlMs: 30000 }, async port => {
    const roomId = 'c'.repeat(32);
    const room = await register(port, 'alpha', roomId);
    assert.strictEqual(room.status, 201);
    const guests = [];
    for (let index = 0; index < 128; index += 1) {
      guests.push(
        request(port, 'GET', `/r/${roomId}/ktv/api/playlists?offset=${index}`, {})
      );
      const delivered = await nextHostRequest(port, room.json.sessionToken);
      assert.strictEqual(delivered.status, 200, `pending request ${index + 1}`);
    }

    const overLimit = await request(
      port,
      'GET',
      `/r/${roomId}/ktv/api/recommendations`,
      {}
    );
    assert.strictEqual(overLimit.status, 503);
    await request(
      port,
      'POST',
      '/_gateway/host/unregister',
      bearer(room.json.sessionToken)
    );
    const settled = await Promise.all(guests);
    assert.ok(settled.every(response => response.status === 410));
  });
}

async function testRejectsDangerousPathsMethodsAndOversizedBodies() {
  await withGateway({ maxRequestBodyBytes: 128 }, async port => {
    const roomId = '6'.repeat(32);
    const room = await register(port, 'alpha', roomId);
    assert.strictEqual(room.status, 201);

    const dangerousPaths = [
      `/r/${roomId}/room/%2e%2e/%2e%2e/etc/passwd`,
      `/r/${roomId}/http://169.254.169.254/latest/meta-data`,
      `/r/${roomId}/room/js/../../../../secret.js`,
      `/r/${roomId}/room/artist-portraits/not-numeric.jpg`,
      `/r/${roomId}/ktv/local/list`,
      `/r/${roomId}/ktv/local/resolve/local-0123456789abcdef`,
      `/r/${roomId}/ktv/local/audio/local-0123456789abcdef`,
      `/r/${roomId}/ktv/api/track/123/preview`,
      `/r/${roomId}/ktv/host/status`,
    ];
    for (const path of dangerousPaths) {
      const response = await request(port, 'GET', path, {});
      assert.ok(response.status === 400 || response.status === 404, `${path}: ${response.status}`);
    }

    const unsupported = await request(port, 'PUT', `/r/${roomId}/ktv/api/state`, {});
    assert.strictEqual(unsupported.status, 405);
    const disallowedApi = await request(port, 'GET', `/r/${roomId}/ktv/api/admin`, {});
    assert.strictEqual(disallowedApi.status, 404);
    const oversized = await request(
      port,
      'POST',
      `/r/${roomId}/ktv/api/requests`,
      { origin: 'https://guest.example' },
      JSON.stringify({ request: 'x'.repeat(256) })
    );
    assert.strictEqual(oversized.status, 413);

    const emptyPoll = await nextHostRequest(port, room.json.sessionToken);
    assert.strictEqual(emptyPoll.status, 204);
  });
}

async function testGuestRequestTimesOutWhenHostDoesNotPoll() {
  await withGateway({ requestTimeoutMs: 60 }, async port => {
    const roomId = '7'.repeat(32);
    const room = await register(port, 'alpha', roomId);
    assert.strictEqual(room.status, 201);
    const guest = await request(port, 'GET', `/r/${roomId}/ktv/api/state`, {});
    assert.strictEqual(guest.status, 504);
  });
}

async function main() {
  const tests = [
    testTwoRoomsKeepRequestsAndTokensIsolated,
    testRejectsUnauthorizedHostsAndSessions,
    testExpiredRoomIsReleasedAndCanBeRegisteredAgain,
    testAllowedGuestRoutesPreserveMethodHeadersAndBody,
    testLocalPlaylistResponseRemovesPathsAudioAndLyrics,
    testUnregisterRevokesSessionAndFailsPendingGuestRequests,
    testRoomAndPendingConcurrencyCaps,
    testDefaultPerRoomPendingLimitSupportsCatalogStartupBurst,
    testRejectsDangerousPathsMethodsAndOversizedBodies,
    testGuestRequestTimesOutWhenHostDoesNotPoll,
  ];
  for (const test of tests) {
    await test();
    process.stdout.write(`PASS ${test.name}\n`);
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
