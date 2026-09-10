const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const babel = require('@babel/core');

const originalJsLoader = require.extensions['.js'];
require.extensions['.js'] = function transpileKaraokeRemote(module, filename) {
  if (
    !filename.includes(`${path.sep}src${path.sep}electron${path.sep}karaoke`)
  ) {
    return originalJsLoader(module, filename);
  }
  const result = babel.transformFileSync(filename, {
    presets: ['@vue/cli-plugin-babel/preset'],
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  });
  module._compile(result.code, filename);
};

const { KaraokeServer } = require('../src/electron/karaoke/KaraokeServer');
const {
  KaraokeCatalogService,
  KaraokeRemoteService,
  RemoteApiRouter,
} = require('../src/electron/karaoke/KaraokeRemoteApi');

function getAvailablePort() {
  return new Promise(resolve => {
    const probe = http.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

function request(port, method, pathname, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const raw = body ? JSON.stringify(body) : '';
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method,
        path: pathname,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(raw),
              }
            : {}),
        },
      },
      response => {
        let value = '';
        response.on('data', chunk => (value += chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            body: JSON.parse(value || '{}'),
          })
        );
      }
    );
    req.on('error', reject);
    req.end(raw);
  });
}

async function run() {
  const waitingItems = [];
  let sequence = 0;
  let activeSession = { status: 'active', sessionId: 'session-test' };
  const assertExpectedSession = expected => {
    if (
      !expected ||
      activeSession.status !== 'active' ||
      activeSession.sessionId !== expected.sessionId
    ) {
      throw new Error('ROOM_ENDED');
    }
  };
  const bridge = {
    snapshot: async () => ({
      session: { ...activeSession },
      currentItem: null,
      waitingItems: [...waitingItems],
    }),
    enqueue: async (track, requester, expected) => {
      assertExpectedSession(expected);
      const item = {
        queueItemId: `item-${(sequence += 1)}`,
        trackId: track.id,
        trackName: track.name,
        artists: track.ar.map(artist => artist.name),
        albumName: track.al.name,
        requesterId: requester.id,
        requesterName: requester.name,
        requesterType: requester.type,
        priorityRequested: requester.priorityRequested,
        status: 'queued',
      };
      waitingItems.push(item);
      return item;
    },
    remove: async (queueItemId, expected) => {
      assertExpectedSession(expected);
      const index = waitingItems.findIndex(
        item => item.queueItemId === queueItemId
      );
      return index < 0 ? null : waitingItems.splice(index, 1)[0];
    },
    front: async (queueItemId, expected) => {
      assertExpectedSession(expected);
      const index = waitingItems.findIndex(
        item => item.queueItemId === queueItemId
      );
      if (index < 0) return false;
      waitingItems.unshift(waitingItems.splice(index, 1)[0]);
      return true;
    },
  };
  const bridgeCalls = [];
  const hostCatalogBridge = async (action, payload) => {
    bridgeCalls.push(action);
    if (action === 'search')
      return [
        {
          id: 101,
          name: '测试歌 Live',
          ar: [{ name: '歌手' }],
          al: { name: '专辑' },
          dt: 180000,
        },
      ];
    if (action === 'trackDetail')
      return {
        id: Number(payload.trackId),
        name: '测试歌 Live',
        ar: [{ name: '歌手' }],
        al: { name: '专辑' },
        dt: 180000,
      };
    if (action === 'playlists')
      return [
        {
          id: 9001,
          name: '我的 KTV 歌单',
          trackCount: 2,
          coverImgUrl: 'https://example.com/cover.jpg',
        },
      ];
    if (action === 'playlistTracks')
      return [
        {
          id: 101,
          name: '测试歌 Live',
          ar: [{ name: '歌手' }],
          al: { name: '专辑' },
          dt: 180000,
        },
      ];
    if (action === 'availability') return 'playable';
    throw new Error('UNEXPECTED_CATALOG_ACTION');
  };
  const remoteDistPath = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ktv-remote-api-')
  );
  fs.writeFileSync(
    path.join(remoteDistPath, 'index.html'),
    '<main>remote</main>'
  );
  const port = await getAvailablePort();
  let server;
  const service = new KaraokeRemoteService({
    catalog: new KaraokeCatalogService({ hostCatalogBridge }),
    managerBridge: bridge,
    getRoom: () => server.room,
  });
  server = new KaraokeServer({
    remoteDistPath,
    port,
    networkInterfaces: () => ({
      WiFi: [{ family: 'IPv4', internal: false, address: '192.168.1.20' }],
    }),
    remoteApi: new RemoteApiRouter(service),
    remoteService: service,
  });
  const room = await server.startRoom({ sessionId: 'session-test' });
  const bad = await request(port, 'POST', '/ktv/api/client-session', {
    token: 'bad',
  });
  assert.equal(bad.status, 401);
  const guestA = await request(port, 'POST', '/ktv/api/client-session', {
    token: new URL(room.url).hash.slice(7),
  });
  const guestB = await request(port, 'POST', '/ktv/api/client-session', {
    token: new URL(room.url).hash.slice(7),
  });
  assert.equal(guestA.status, 200);
  assert.match(guestA.body.clientToken, /^[A-Za-z0-9_-]{40,}$/);
  assert.notEqual(guestA.body.clientToken, guestB.body.clientToken);
  const results = await request(
    port,
    'GET',
    '/ktv/api/search?q=%E6%B5%8B%E8%AF%95',
    { token: guestA.body.clientToken }
  );
  assert.equal(results.status, 200);
  assert.equal(results.body.results[0].versionLabel, 'Live');
  assert.equal(results.body.results[0].playability, 'playable');
  assert.ok(bridgeCalls.includes('search'));
  assert.ok(bridgeCalls.includes('availability'));
  const playlistResponse = await request(port, 'GET', '/ktv/api/playlists', {
    token: guestA.body.clientToken,
  });
  assert.equal(playlistResponse.status, 200);
  assert.equal(playlistResponse.body.playlists[0].id, '9001');
  const playlistTracks = await request(
    port,
    'GET',
    '/ktv/api/playlists/9001/tracks',
    { token: guestA.body.clientToken }
  );
  assert.equal(playlistTracks.status, 200);
  assert.equal(playlistTracks.body.tracks[0].trackId, '101');
  assert.equal(playlistTracks.body.tracks[0].playability, 'playable');
  assert.ok(bridgeCalls.includes('playlists'));
  assert.ok(bridgeCalls.includes('playlistTracks'));
  service.sessions.clients.clear();
  for (let index = 0; index < 32; index += 1) {
    service.sessions.clients.set(`expired-${index}`, {
      createdAt: Date.now() - 6 * 60 * 60 * 1000,
    });
  }
  const afterExpiry = service.bootstrap(
    new URL(room.url).hash.slice(7),
    'expired'
  );
  assert.ok(afterExpiry.clientToken);
  assert.equal(service.sessions.clients.size, 1);
  service.sessions.clients.clear();
  service.sessions.clients.set(guestA.body.clientToken, {
    ...service.sessions.room,
    clientId: guestA.body.clientId,
    clientToken: guestA.body.clientToken,
    displayName: guestA.body.displayName,
    createdAt: Date.now(),
    roomCode: service.sessions.room.code,
  });
  service.sessions.clients.set(guestB.body.clientToken, {
    ...service.sessions.room,
    clientId: guestB.body.clientId,
    clientToken: guestB.body.clientToken,
    displayName: guestB.body.displayName,
    createdAt: Date.now(),
    roomCode: service.sessions.room.code,
  });
  const aRequest = await request(port, 'POST', '/ktv/api/requests', {
    token: guestA.body.clientToken,
    body: { trackId: '101' },
  });
  const bRequest = await request(port, 'POST', '/ktv/api/requests', {
    token: guestB.body.clientToken,
    body: { trackId: '101', priority: true },
  });
  assert.equal(aRequest.status, 201);
  assert.equal(bRequest.status, 201);
  assert.equal(waitingItems[0].requesterId, guestB.body.clientId);
  const forbidden = await request(
    port,
    'DELETE',
    `/ktv/api/requests/${bRequest.body.item.queueItemId}`,
    { token: guestA.body.clientToken }
  );
  assert.equal(forbidden.status, 403);
  const state = await request(port, 'GET', '/ktv/api/state', {
    token: guestA.body.clientToken,
  });
  assert.equal(state.status, 200);
  assert.equal(state.body.waiting.length, 2);
  assert.equal(JSON.stringify(state.body).includes('joinToken'), false);
  assert.equal(JSON.stringify(state.body).includes('clientToken'), false);
  const removed = await request(
    port,
    'DELETE',
    `/ktv/api/requests/${aRequest.body.item.queueItemId}`,
    { token: guestA.body.clientToken }
  );
  assert.equal(removed.status, 200);
  const alreadyFront = await request(
    port,
    'POST',
    `/ktv/api/requests/${bRequest.body.item.queueItemId}/front`,
    { token: guestB.body.clientToken }
  );
  assert.equal(alreadyFront.status, 200);

  const clientA = service.client(guestA.body.clientToken);
  const waitForMutation = method =>
    new Promise(resolve => {
      bridge[method] = (...args) => {
        const expected = args.at(-1);
        resolve(() => assertExpectedSession(expected));
        return new Promise((_, reject) => {
          bridge[`release${method}`] = () => {
            try {
              assertExpectedSession(expected);
              reject(new Error('EXPECTED_MUTATION_WOULD_HAVE_RUN'));
            } catch (error) {
              reject(error);
            }
          };
        });
      };
    });
  const enqueueReady = waitForMutation('enqueue');
  const staleEnqueue = service.enqueue(clientA, '101', false);
  await enqueueReady;
  activeSession = { status: 'active', sessionId: 'session-new' };
  bridge.releaseenqueue();
  await assert.rejects(() => staleEnqueue, /ROOM_ENDED/);
  assert.equal(
    waitingItems.some(item => item.requesterId === clientA.clientId),
    false
  );

  activeSession = { status: 'active', sessionId: 'session-test' };
  const ownItem = {
    queueItemId: 'stale-own',
    requesterId: clientA.clientId,
    requesterName: clientA.displayName,
    requesterType: 'remote',
    trackId: '101',
    trackName: 'stale',
    artists: [],
    albumName: '',
    status: 'queued',
  };
  waitingItems.push(ownItem);
  const removeReady = waitForMutation('remove');
  const staleRemove = service.remove(clientA, ownItem.queueItemId);
  await removeReady;
  activeSession = { status: 'active', sessionId: 'session-new' };
  bridge.releaseremove();
  await assert.rejects(() => staleRemove, /ROOM_ENDED/);
  assert.ok(waitingItems.includes(ownItem));

  activeSession = { status: 'active', sessionId: 'session-test' };
  const frontReady = waitForMutation('front');
  const staleFront = service.front(clientA, ownItem.queueItemId);
  await frontReady;
  activeSession = { status: 'active', sessionId: 'session-new' };
  bridge.releasefront();
  await assert.rejects(() => staleFront, /ROOM_ENDED/);
  assert.ok(waitingItems.includes(ownItem));
  const staleToken = guestA.body.clientToken;
  await server.stopRoom();
  assert.throws(() => service.client(staleToken), /ROOM_ENDED/);
  const restarted = await server.startRoom({ sessionId: 'session-restarted' });
  const oldJoin = await request(port, 'POST', '/ktv/api/client-session', {
    token: new URL(room.url).hash.slice(7),
  });
  assert.equal(oldJoin.status, 401);
  assert.notEqual(restarted.url, room.url);
  await server.stopRoom();
  fs.rmSync(remoteDistPath, { recursive: true, force: true });
  console.log('KTV remote API integration tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
