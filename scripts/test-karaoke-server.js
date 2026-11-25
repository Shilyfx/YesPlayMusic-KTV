const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
require('./helpers/register-babel-src');

const {
  KaraokeServer,
  normalizePublicRoomConfig,
} = require('../src/electron/karaoke/KaraokeServer');
const {
  KaraokeRemoteService,
  RemoteApiRouter,
} = require('../src/electron/karaoke/KaraokeRemoteApi');

const interfaces = () => ({
  Ethernet: [{ family: 'IPv4', internal: false, address: '10.46.8.202' }],
  WiFi: [{ family: 'IPv4', internal: false, address: '192.168.8.20' }],
  Docker: [{ family: 'IPv4', internal: false, address: '172.17.0.1' }],
});

const macInterfaces = () => ({
  en0: [{ family: 'IPv4', internal: false, address: '192.168.1.20' }],
  awdl0: [{ family: 'IPv4', internal: false, address: '169.254.10.20' }],
  utun4: [{ family: 'IPv4', internal: false, address: '10.8.0.2' }],
});

function request(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `http://127.0.0.1:${port}${pathname}`,
      {
        method: options.method || 'GET',
        headers: options.headers || {},
      },
      response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => (body += chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body,
          })
        );
      }
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function getAvailablePort() {
  return new Promise(resolve => {
    const probe = http.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const value = probe.address().port;
      probe.close(() => resolve(value));
    });
  });
}

async function run() {
  assert.deepEqual(
    normalizePublicRoomConfig({
      gatewayOrigin: 'https://gateway.example/',
      hostId: 'desktop host',
      hostSecret: 'secret-value',
    }),
    {
      gatewayOrigin: 'https://gateway.example',
      hostId: 'desktop host',
      hostSecret: 'secret-value',
    }
  );
  assert.throws(
    () =>
      normalizePublicRoomConfig({
        gatewayOrigin: 'http://gateway.example',
        hostId: 'desktop-host',
        hostSecret: 'secret-value',
      }),
    /INVALID_PUBLIC_CONFIG/
  );

  const remoteDistPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ktv-remote-'));
  const desktopDistPath = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ktv-desktop-assets-')
  );
  fs.mkdirSync(path.join(remoteDistPath, 'js'));
  fs.mkdirSync(path.join(remoteDistPath, 'css'));
  fs.mkdirSync(path.join(desktopDistPath, 'js'));
  fs.mkdirSync(path.join(desktopDistPath, 'css'));
  fs.writeFileSync(
    path.join(remoteDistPath, 'index.html'),
    '<link href="css/remote.css"><main>room</main>'
  );
  fs.writeFileSync(
    path.join(remoteDistPath, 'js', 'remote.js'),
    'window.room=true;'
  );
  fs.writeFileSync(
    path.join(remoteDistPath, 'js', 'remote.1234abcd.js'),
    'window.roomHashed=true;'
  );
  fs.writeFileSync(path.join(remoteDistPath, 'css', 'remote.css'), 'body{}');
  fs.mkdirSync(path.join(remoteDistPath, 'artist-portraits'));
  fs.writeFileSync(
    path.join(remoteDistPath, 'artist-portraits', '6452.jpg'),
    'portrait-bytes'
  );
  const roleAssetPath = path.join(
    remoteDistPath,
    'js',
    'reactions',
    'mood-mates',
    'src',
    'core',
    'geometry.js'
  );
  fs.mkdirSync(path.dirname(roleAssetPath), { recursive: true });
  fs.writeFileSync(roleAssetPath, 'window.reactionAsset = true;');
  fs.writeFileSync(
    path.join(desktopDistPath, 'js', 'desktop.js'),
    'window.desktop=true;'
  );
  fs.writeFileSync(path.join(desktopDistPath, 'css', 'desktop.css'), 'body{}');
  const serverPort = await getAvailablePort();
  const server = new KaraokeServer({
    remoteDistPath,
    port: serverPort,
    networkInterfaces: interfaces,
  });
  const remoteService = new KaraokeRemoteService({
    catalog: {},
    managerBridge: {
      snapshot: async () => ({
        currentItem: { queueItemId: 'song-current' },
      }),
    },
    getRoom: () => server.room,
  });
  server.setRemoteApi(new RemoteApiRouter(remoteService), remoteService);
  const macCandidates = new KaraokeServer({
    remoteDistPath,
    networkInterfaces: macInterfaces,
  }).getLanAddressCandidates();
  assert.deepEqual(
    macCandidates.map(candidate => candidate.address),
    ['192.168.1.20', '10.8.0.2', '169.254.10.20']
  );
  const candidates = server.getLanAddressCandidates();
  assert.deepEqual(
    candidates.map(candidate => candidate.address),
    ['10.46.8.202', '192.168.8.20', '172.17.0.1']
  );
  const room = await server.startRoom({
    sessionId: 'session-test',
    lanAddress: '192.168.8.20',
  });
  assert.equal(room.name, 'LumaSing KTV');
  const roomUrl = new URL(room.url);
  assert.equal(roomUrl.hostname, '192.168.8.20');
  assert.equal(roomUrl.pathname, '/room/');
  const artistPortrait = await request(
    serverPort,
    '/room/artist-portraits/6452.jpg'
  );
  assert.equal(artistPortrait.status, 200);
  assert.match(artistPortrait.headers['content-type'], /^image\/jpeg/);
  assert.equal(artistPortrait.body, 'portrait-bytes');
  assert.equal(
    (await request(serverPort, '/artist-portraits/6452.jpg')).status,
    404
  );
  const roomToken = server.room.token;
  assert.match(roomToken, /^[A-Za-z0-9_-]{40,}$/);
  const bootstrap = await request(serverPort, '/ktv/api/client-session', {
    method: 'POST',
    headers: { authorization: `Bearer ${roomToken}` },
  });
  assert.equal(bootstrap.status, 200);
  const clientToken = JSON.parse(bootstrap.body).clientToken;
  assert.ok(clientToken);
  const reactionBody = JSON.stringify({
    kind: 'applause',
    effect: 'bounce',
    character: 'ball',
    customText: '唱得真棒',
  });
  const reactionHeaders = {
    authorization: `Bearer ${clientToken}`,
    'content-type': 'application/json',
  };
  const unauthenticatedReaction = await request(
    serverPort,
    '/ktv/api/reactions',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: reactionBody,
    }
  );
  assert.equal(unauthenticatedReaction.status, 401);
  const oversizedReaction = await request(serverPort, '/ktv/api/reactions', {
    method: 'POST',
    headers: reactionHeaders,
    body: JSON.stringify({ customText: 'x'.repeat(5000) }),
  });
  assert.equal(oversizedReaction.status, 413);
  const invalidReaction = await request(serverPort, '/ktv/api/reactions', {
    method: 'POST',
    headers: reactionHeaders,
    body: JSON.stringify({ kind: 'not-a-reaction' }),
  });
  assert.equal(invalidReaction.status, 400);
  const acceptedReaction = await request(serverPort, '/ktv/api/reactions', {
    method: 'POST',
    headers: reactionHeaders,
    body: reactionBody,
  });
  assert.equal(acceptedReaction.status, 200);
  assert.equal(JSON.parse(acceptedReaction.body).status, 'playing');
  const reactionState = server.getReactionState();
  assert.equal(reactionState.events.length, 1);
  assert.equal(reactionState.events[0].kind, 'applause');
  assert.equal(reactionState.events[0].itemId, 'song-current');
  assert.equal(reactionState.events[0].customText, '唱得真棒');
  assert.equal(
    Object.prototype.hasOwnProperty.call(reactionState.events[0], 'senderId'),
    false
  );
  assert.match(reactionState.generation, /^[a-f0-9]{24}$/);
  assert.ok(reactionState.serverTime > 0);
  for (let count = 1; count < 8; count += 1) {
    const allowed = await request(serverPort, '/ktv/api/reactions', {
      method: 'POST',
      headers: reactionHeaders,
      body: reactionBody,
    });
    assert.equal(allowed.status, 200);
  }
  const rateLimitedReaction = await request(serverPort, '/ktv/api/reactions', {
    method: 'POST',
    headers: reactionHeaders,
    body: reactionBody,
  });
  assert.equal(rateLimitedReaction.status, 429);
  const localAudioPath = path.join(remoteDistPath, 'local-test.mp3');
  const localCoverPath = path.join(remoteDistPath, 'local-test.jpg');
  fs.writeFileSync(localAudioPath, 'local-audio');
  fs.writeFileSync(localCoverPath, 'local-cover');
  server.setLocalLibrary({
    resolve: async localId =>
      localId === 'local-0123456789abcdef'
        ? { audioPath: localAudioPath, coverPath: localCoverPath }
        : null,
  });
  const localAudio = await request(
    serverPort,
    `/ktv/local/audio/local-0123456789abcdef?token=${encodeURIComponent(
      roomToken
    )}`
  );
  assert.equal(localAudio.status, 200);
  assert.equal(localAudio.body, 'local-audio');
  const localCover = await request(
    serverPort,
    `/ktv/local/cover/local-0123456789abcdef?token=${encodeURIComponent(
      roomToken
    )}`
  );
  assert.equal(localCover.status, 200);
  assert.equal(localCover.headers['content-type'], 'image/jpeg');
  assert.equal(localCover.body, 'local-cover');
  assert.equal(
    (
      await request(
        serverPort,
        '/ktv/local/audio/local-0123456789abcdef?token=invalid'
      )
    ).status,
    404
  );
  assert.equal(
    (
      await request(
        serverPort,
        `/ktv/local/cover/local-0123456789abcdef?token=invalid`
      )
    ).status,
    404
  );

  const health = await request(serverPort, '/health');
  assert.equal(health.status, 200);
  const page = await request(serverPort, roomUrl.pathname);
  assert.equal(page.status, 200);
  assert.equal(page.headers['cache-control'], 'no-store');
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
  assert.equal(page.headers['referrer-policy'], 'no-referrer');
  assert.match(page.headers['content-security-policy'], /default-src 'none'/);
  assert.equal(
    (await request(serverPort, `${roomUrl.pathname}css/remote.css`)).status,
    200
  );
  assert.equal(
    (await request(serverPort, `${roomUrl.pathname}js/remote.js`)).status,
    200
  );
  assert.equal(
    (
      await request(
        serverPort,
        `${roomUrl.pathname}js/reactions/mood-mates/src/core/geometry.js`
      )
    ).body,
    'window.reactionAsset = true;'
  );
  assert.equal(
    (await request(serverPort, `${roomUrl.pathname}js/remote.js`)).headers[
      'cache-control'
    ],
    'no-store'
  );
  const hashedRemote = await request(
    serverPort,
    `${roomUrl.pathname}js/remote.1234abcd.js`
  );
  assert.equal(hashedRemote.status, 200);
  assert.equal(
    hashedRemote.headers['cache-control'],
    'public, max-age=31536000, immutable'
  );
  assert.equal(
    (await request(serverPort, `${roomUrl.pathname}js/desktop.js`)).status,
    404
  );
  assert.equal(
    (await request(serverPort, `${roomUrl.pathname}css/desktop.css`)).status,
    404
  );
  assert.equal((await request(serverPort, '/room/not-a-room')).status, 404);
  assert.equal((await request(serverPort, '/api')).status, 404);
  assert.equal((await request(serverPort, '/player')).status, 404);
  assert.equal((await request(serverPort, '/js/app.js')).status, 404);
  const traversalResponse = {
    writeHead(status) {
      this.status = status;
    },
    end() {},
  };
  await server.sendStaticAsset(
    remoteDistPath,
    '../index.html',
    traversalResponse
  );
  assert.equal(traversalResponse.status, 404);

  await server.stopRoom();
  await assert.rejects(() => request(serverPort, roomUrl.pathname));
  assert.equal(await server.describeRoom(), null);
  assert.deepEqual(server.getReactionState().events, []);
  const restartedRoom = await server.startRoom({
    sessionId: 'session-restarted',
  });
  assert.notEqual(
    server.getReactionState().generation,
    reactionState.generation
  );
  const staleReaction = await request(serverPort, '/ktv/api/reactions', {
    method: 'POST',
    headers: reactionHeaders,
    body: reactionBody,
  });
  assert.equal(staleReaction.status, 401);
  assert.ok(restartedRoom.url);
  await server.stopRoom();

  const restarted = await server.startRoom({
    sessionId: 'session-test-2',
    lanAddress: '192.168.8.20',
  });
  assert.equal(restarted.url, room.url);
  assert.equal((await request(serverPort, '/room/')).status, 200);
  assert.equal((await request(serverPort, '/room')).status, 200);
  await server.stopRoom();

  const busyPort = await getAvailablePort();
  const blocker = http.createServer();
  await new Promise(resolve => blocker.listen(busyPort, '0.0.0.0', resolve));
  const busyServer = new KaraokeServer({
    remoteDistPath,
    port: busyPort,
    networkInterfaces: interfaces,
  });
  await assert.rejects(
    () => busyServer.startRoom({ sessionId: 'busy' }),
    /EADDRINUSE/
  );
  assert.equal(await busyServer.describeRoom(), null);
  assert.equal(busyServer.server, null);
  await new Promise(resolve => blocker.close(resolve));
  const afterRetry = await busyServer.startRoom({ sessionId: 'retry' });
  assert.ok(afterRetry.url);
  await busyServer.stopRoom();

  const racePort = await getAvailablePort();
  const raceServer = new KaraokeServer({
    remoteDistPath,
    port: racePort,
    networkInterfaces: interfaces,
  });
  const firstStart = raceServer.startRoom({ sessionId: 'race' });
  const secondStart = raceServer.startRoom({ sessionId: 'race' });
  const [firstRoom, secondRoom] = await Promise.all([firstStart, secondStart]);
  assert.equal(firstRoom.url, secondRoom.url);
  await raceServer.stopRoom();
  assert.equal(raceServer.state, 'idle');
  assert.equal(raceServer.room, null);
  assert.equal(raceServer.server, null);

  const delayedPort = await getAvailablePort();
  const delayedServer = new KaraokeServer({
    remoteDistPath,
    port: delayedPort,
    networkInterfaces: interfaces,
    listen: (httpServer, port, host, callback) =>
      setTimeout(() => httpServer.listen(port, host, callback), 20),
  });
  const pendingStart = delayedServer.startRoom({ sessionId: 'delayed' });
  await delayedServer.stopRoom();
  await assert.rejects(() => pendingStart, /已取消/);
  assert.equal(delayedServer.state, 'idle');
  assert.equal(delayedServer.room, null);
  assert.equal(delayedServer.server, null);
  const immediateRestart = await delayedServer.startRoom({
    sessionId: 'immediate-restart',
  });
  assert.ok(immediateRestart.url);
  await delayedServer.stopRoom();

  const connectorStarts = [];
  const connectorStops = [];
  const publicStatusEvents = [];
  const publicServer = new KaraokeServer({
    remoteDistPath,
    port: await getAvailablePort(),
    networkInterfaces: interfaces,
    hostConnectorFactory: options => {
      connectorStarts.push(options);
      const connector = {
        roomId: `${connectorStarts.length}`.padStart(32, '0'),
        start: async () => options.onStatus('connected'),
        stop: async () => connectorStops.push(connector.roomId),
      };
      return connector;
    },
  });
  const publicService = new KaraokeRemoteService({
    catalog: {},
    managerBridge: {
      snapshot: async () => ({
        currentItem: { queueItemId: 'public-song' },
      }),
    },
    getRoom: () => publicServer.room,
  });
  publicServer.setRemoteApi(new RemoteApiRouter(publicService), publicService);
  publicServer.setPublicConfig({
    gatewayOrigin: 'https://gateway.example',
    hostId: 'desktop-host',
    hostSecret: 'must-not-be-exposed',
  });
  publicServer.setPublicStatusListener(status => publicStatusEvents.push(status));
  const publicRoom = await publicServer.startRoom({
    sessionId: 'public-session',
  });
  const publicAddress = publicServer.publicAdapterServer.address();
  assert.equal(publicAddress.address, '127.0.0.1');
  assert.ok(publicAddress.port > 0);
  assert.equal(connectorStarts[0].localPort, publicAddress.port);
  assert.equal(connectorStarts[0].gatewayOrigin, 'https://gateway.example');
  assert.equal(publicRoom.publicStatus, 'connected');
  assert.deepEqual(publicServer.getPublicConfigState(), {
    gatewayOrigin: 'https://gateway.example',
    hostId: 'desktop-host',
    hasHostSecret: true,
  });
  assert.throws(() => publicServer.setPublicConfig({}), /PUBLIC_ROOM_ACTIVE/);
  connectorStarts[0].onStatus('reconnecting');
  assert.equal(publicServer.publicStatus, 'reconnecting');
  assert.equal(publicStatusEvents[publicStatusEvents.length - 1], 'reconnecting');
  connectorStarts[0].onStatus('connected');
  const publicJoinUrl = new URL(publicRoom.publicJoinUrl);
  assert.equal(publicJoinUrl.pathname, '/r/00000000000000000000000000000001/room/');
  assert.match(publicRoom.publicQrDataUrl, /^data:image\/png;base64,/);
  assert.equal(JSON.stringify(publicRoom).includes('must-not-be-exposed'), false);
  const publicToken = new URLSearchParams(publicJoinUrl.hash.slice(1)).get('token');
  assert.ok(publicToken);
  const publicOriginHeaders = { origin: 'https://gateway.example' };
  const wrongOriginBootstrap = await request(
    publicAddress.port,
    '/ktv/api/client-session',
    {
      method: 'POST',
      headers: {
        origin: 'https://attacker.example',
        authorization: `Bearer ${publicToken}`,
      },
    }
  );
  assert.equal(wrongOriginBootstrap.status, 403);
  const publicBootstrap = await request(publicAddress.port, '/ktv/api/client-session', {
    method: 'POST',
    headers: {
      ...publicOriginHeaders,
      authorization: `Bearer ${publicToken}`,
    },
  });
  assert.equal(publicBootstrap.status, 200);
  const publicClientToken = JSON.parse(publicBootstrap.body).clientToken;
  const publicReaction = await request(publicAddress.port, '/ktv/api/reactions', {
    method: 'POST',
    headers: {
      ...publicOriginHeaders,
      authorization: `Bearer ${publicClientToken}`,
      'content-type': 'application/json',
    },
    body: reactionBody,
  });
  assert.equal(publicReaction.status, 200);
  for (let count = 1; count < 8; count += 1) {
    const allowedReaction = await request(
      publicAddress.port,
      '/ktv/api/reactions',
      {
        method: 'POST',
        headers: {
          ...publicOriginHeaders,
          authorization: `Bearer ${publicClientToken}`,
          'content-type': 'application/json',
        },
        body: reactionBody,
      }
    );
    assert.equal(allowedReaction.status, 200);
  }
  const limitedPublicReaction = await request(
    publicAddress.port,
    '/ktv/api/reactions',
    {
      method: 'POST',
      headers: {
        ...publicOriginHeaders,
        authorization: `Bearer ${publicClientToken}`,
        'content-type': 'application/json',
      },
      body: reactionBody,
    }
  );
  assert.equal(limitedPublicReaction.status, 429);
  await publicServer.stopRoom();
  assert.equal(publicServer.publicToken, '');
  assert.equal(publicServer.publicAdapterServer, null);
  assert.equal(connectorStops.length, 1);
  const restartedPublicRoom = await publicServer.startRoom({
    sessionId: 'public-session-restarted',
  });
  const restartedPublicAddress = publicServer.publicAdapterServer.address();
  const restartedPublicToken = new URLSearchParams(
    new URL(restartedPublicRoom.publicJoinUrl).hash.slice(1)
  ).get('token');
  assert.notEqual(restartedPublicToken, publicToken);
  const oldPublicTokenResponse = await request(
    restartedPublicAddress.port,
    '/ktv/api/client-session',
    {
      method: 'POST',
      headers: {
        ...publicOriginHeaders,
        authorization: `Bearer ${publicToken}`,
      },
    }
  );
  assert.equal(oldPublicTokenResponse.status, 401);
  await publicServer.stopRoom();

  const failingPublicServer = new KaraokeServer({
    remoteDistPath,
    port: await getAvailablePort(),
    networkInterfaces: interfaces,
    hostConnectorFactory: () => ({
      roomId: 'f'.repeat(32),
      start: async () => {
        throw new Error('credential details must not escape');
      },
      stop: async () => {},
    }),
  });
  failingPublicServer.setRemoteApi(new RemoteApiRouter(publicService), publicService);
  failingPublicServer.setPublicConfig({
    gatewayOrigin: 'https://gateway.example',
    hostId: 'desktop-host',
    hostSecret: 'another-secret',
  });
  const lanAfterPublicFailure = await failingPublicServer.startRoom({
    sessionId: 'lan-survives-public-failure',
  });
  assert.ok(lanAfterPublicFailure.url);
  assert.equal(lanAfterPublicFailure.publicStatus, 'error');
  assert.equal(lanAfterPublicFailure.publicJoinUrl, null);
  assert.equal(lanAfterPublicFailure.publicError.includes('another-secret'), false);
  assert.equal(failingPublicServer.publicAdapterServer, null);
  assert.equal((await request(failingPublicServer.port, '/health')).status, 200);
  await failingPublicServer.stopRoom();

  const bundledRoot = path.join(__dirname, '..', 'dist_electron', 'bundled');
  const bundledRemote = path.join(bundledRoot, 'remote');
  if (fs.existsSync(path.join(bundledRemote, 'index.html'))) {
    const bundledPort = await getAvailablePort();
    const bundledServer = new KaraokeServer({
      remoteDistPath: bundledRemote,
      port: bundledPort,
      networkInterfaces: interfaces,
    });
    const bundledRoom = await bundledServer.startRoom({
      sessionId: 'bundled-assets',
    });
    const bundledPath = new URL(bundledRoom.url).pathname;
    const bundledIndex = await request(bundledPort, bundledPath);
    assert.equal(bundledIndex.status, 200);
    assert.equal(bundledIndex.body.includes('app://'), false);
    const asset = bundledIndex.body.match(/(?:href|src)="(css|js)\/([^"]+)"/);
    assert.ok(asset);
    assert.equal(
      (await request(bundledPort, `${bundledPath}${asset[1]}/${asset[2]}`))
        .status,
      200
    );
    const desktopJs = fs
      .readdirSync(path.join(bundledRoot, 'js'))
      .find(name => name.startsWith('index.'));
    assert.ok(desktopJs);
    assert.equal(
      (await request(bundledPort, `${bundledPath}js/${desktopJs}`)).status,
      404
    );
    const desktopCss = fs
      .readdirSync(path.join(bundledRoot, 'css'))
      .find(name => name.startsWith('index.'));
    assert.ok(desktopCss);
    assert.equal(
      (await request(bundledPort, `${bundledPath}css/${desktopCss}`)).status,
      404
    );
    await bundledServer.stopRoom();
  }
  fs.rmSync(remoteDistPath, { recursive: true, force: true });
  fs.rmSync(desktopDistPath, { recursive: true, force: true });
  console.log('KTV LAN server tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
