'use strict';

const assert = require('assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const selfsigned = require('selfsigned');
const { createGateway } = require('../src/multiroom/gateway.cjs');
const { createHostConnector } = require('../src/multiroom/hostConnector.cjs');

const ROOT = path.resolve(__dirname, '..');
const DOCKER_IMAGE = process.env.KTV_TEST_DOCKER_NODE_IMAGE || 'node:22-alpine';
const HOST_IDS = { web: 'real-web-host', desktop: 'real-electron-host' };
const HOST_SECRETS = {
  [HOST_IDS.web]: 'real-web-host-secret-for-integration',
  [HOST_IDS.desktop]: 'real-electron-host-secret-for-integration',
};
const TRACK_IDS = { web: '723001', desktop: '723002' };
const PORTRAIT_PATH = '/room/artist-portraits/6452.jpg';
const WAIT_MS = 30000;

function docker(args, { allowFailure = false } = {}) {
  const result = spawnSync(process.env.KTV_TEST_DOCKER_BINARY || 'docker', args, {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) {
    if (allowFailure) return { status: 127, stdout: '', stderr: result.error.message };
    throw new Error(
      `Docker is required for the real KaraokeWebHost container: ${result.error.message}`
    );
  }
  if (result.status !== 0 && !allowFailure) {
    throw new Error(
      `docker ${args[0]} failed (${result.status}): ${(result.stderr || result.stdout).trim()}`
    );
  }
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function listen(server, port = 0, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const onError = error => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve(server.address());
    });
  });
}

function closeServer(server) {
  if (!server || !server.listening) return Promise.resolve();
  return new Promise(resolve => {
    server.close(() => resolve());
    if (typeof server.closeAllConnections === 'function')
      server.closeAllConnections();
  });
}

function httpRequest(target, { method = 'GET', headers = {}, body } = {}) {
  const url = target instanceof URL ? target : new URL(target);
  const transport = url.protocol === 'https:' ? https : http;
  const payload = body === undefined ? null : Buffer.from(body);
  const options = {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || undefined,
    method,
    path: `${url.pathname}${url.search}`,
    headers: { ...headers },
    timeout: 10000,
  };
  if (payload) {
    if (!options.headers['content-type'])
      options.headers['content-type'] = 'application/json';
    options.headers['content-length'] = payload.length;
  }
  // The local TLS bridge is self-signed and exists only for this test run.
  if (url.hostname === 'host.docker.internal') {
    options.lookup = (_hostname, _lookupOptions, callback) =>
      callback(null, '127.0.0.1', 4);
  }
  return new Promise((resolve, reject) => {
    const req = transport.request(options, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const raw = Buffer.concat(chunks);
        let json = null;
        try {
          json = raw.length ? JSON.parse(raw.toString('utf8')) : null;
        } catch (_) {}
        resolve({ status: response.statusCode, headers: response.headers, body: raw, json });
      });
      response.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error(`Request timed out: ${url}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function jsonRequest(target, method, value, headers = {}) {
  return httpRequest(target, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(value),
  });
}

function bearer(token) {
  return { authorization: `Bearer ${token}` };
}

async function waitFor(description, action, accept, timeoutMs = WAIT_MS) {
  const until = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < until) {
    try {
      const value = await action();
      if (accept(value)) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(
    `Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ''}`
  );
}

function makeTrack(trackId) {
  return {
    trackId: String(trackId),
    name: `Integration track ${trackId}`,
    artists: ['Multiroom Test Artist'],
    album: 'Integration Fixture',
    coverUrl: '',
    duration: 183000,
    source: 'netease',
  };
}

function makeQueueItem(trackId, requester) {
  return {
    queueItemId: `multiroom-${trackId}`,
    trackId: String(trackId),
    trackName: `Integration track ${trackId}`,
    artists: ['Multiroom Test Artist'],
    albumName: 'Integration Fixture',
    coverUrl: '',
    requesterName: requester.name,
    requesterId: requester.id,
    requesterType: 'remote',
    priorityRequested: false,
    status: 'waiting',
  };
}

function makeMemoryManagerBridge(hostName, calls) {
  const waitingItems = [];
  return {
    snapshot: async () => ({
      revision: waitingItems.length + 1,
      currentItem: null,
      waitingItems: waitingItems.slice(),
      historyItems: [],
    }),
    enqueue: async (track, requester) => {
      calls.push({ host: hostName, trackId: String(track.id) });
      const item = makeQueueItem(track.id, requester);
      waitingItems.push(item);
      return item;
    },
    remove: async queueItemId => {
      const index = waitingItems.findIndex(item => item.queueItemId === queueItemId);
      if (index < 0) return null;
      return waitingItems.splice(index, 1)[0];
    },
    front: async () => true,
    next: async () => null,
  };
}

function dockerHostBootstrap() {
  return `
    require('/workspace/scripts/helpers/register-babel-src');
    const http = require('http');
    const KaraokeWebHost = require('/workspace/src/server/KaraokeWebHost.js').default;
    const gatewayOrigin = process.env.KTV_MULTIROOM_GATEWAY_ORIGIN;
    const host = new KaraokeWebHost({
      publicOrigin: gatewayOrigin,
      publicGuestOrigin: gatewayOrigin,
      gatewayOrigin,
      gatewayHostId: process.env.KTV_MULTIROOM_HOST_ID,
      gatewayHostSecret: process.env.KTV_MULTIROOM_HOST_SECRET,
      remoteDistPath: '/workspace/public',
    });
    host.service.catalog.getTrack = async id => ({
      trackId: String(id), name: 'Integration track ' + id,
      artists: ['Multiroom Test Artist'], album: 'Integration Fixture',
      coverUrl: '', duration: 183000, source: 'netease'
    });
    host.service.catalog.availability = async () => 'playable';
    const api = http.createServer((req, res) => {
      Promise.resolve(host.handle(req, res)).catch(error => {
        if (!res.headersSent) { res.writeHead(500); res.end(String(error)); }
        else res.destroy(error);
      });
    });
    const guests = http.createServer((req, res) => {
      Promise.resolve(host.handlePublicGuest(req, res)).catch(error => {
        if (!res.headersSent) { res.writeHead(500); res.end(String(error)); }
        else res.destroy(error);
      });
    });
    api.listen(3100, '0.0.0.0');
    guests.listen(3101, '0.0.0.0');
    const leaseTimer = setInterval(() => host.expire(), 1000);
    leaseTimer.unref();
    let stopping = false;
    async function stop() {
      if (stopping) return;
      stopping = true;
      clearInterval(leaseTimer);
      await host.close();
      await Promise.all([new Promise(r => api.close(r)), new Promise(r => guests.close(r))]);
      process.exit(0);
    }
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    process.on('uncaughtException', error => { console.error(error); process.exit(1); });
  `;
}

function findNodeModules() {
  const candidates = [
    ...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean),
    'D:/VibeCoding/LumaSing/node_modules',
  ];
  const found = candidates.map(item => path.resolve(item)).find(item =>
    fs.existsSync(path.join(item, '@babel', 'core'))
  );
  if (!found)
    throw new Error(
      'Cannot find @babel/core. Set NODE_PATH to the permitted read-only dependency folder.'
    );
  return found;
}

async function startDockerHost(gatewayOrigin) {
  const containerName = `lumasing-real-hosts-${process.pid}`;
  const nodeModules = findNodeModules();
  const args = [
    'run', '--detach', '--rm', '--name', containerName,
    '--add-host', 'host.docker.internal:host-gateway',
    '--publish', '127.0.0.1::3100',
    '--env', `NODE_PATH=/node_modules`,
    '--env', `KTV_MULTIROOM_GATEWAY_ORIGIN=${gatewayOrigin}`,
    '--env', `KTV_MULTIROOM_HOST_ID=${HOST_IDS.web}`,
    '--env', `KTV_MULTIROOM_HOST_SECRET=${HOST_SECRETS[HOST_IDS.web]}`,
    '--env', 'NODE_TLS_REJECT_UNAUTHORIZED=0',
    '--mount', `type=bind,source=${ROOT},target=/workspace,readonly`,
    '--mount', `type=bind,source=${nodeModules},target=/node_modules,readonly`,
    DOCKER_IMAGE,
    'node', '-e', dockerHostBootstrap(),
  ];
  const started = docker(args);
  const containerId = started.stdout.trim();
  try {
    const binding = await waitFor(
      'Docker host port publication',
      () => docker(['port', containerId, '3100/tcp']).stdout.trim(),
      value => /:\d+$/.test(value)
    );
    const port = Number(binding.slice(binding.lastIndexOf(':') + 1));
    const base = `http://127.0.0.1:${port}`;
    await waitFor(
      'KaraokeWebHost Docker health endpoint',
      () => httpRequest(`${base}/ktv/health`),
      result => result.status === 200 && result.json?.ok === true
    );
    return { containerId, base };
  } catch (error) {
    const logs = docker(['logs', containerId], { allowFailure: true });
    throw new Error(
      `${error.message}${logs.stdout || logs.stderr ? `\nDocker host output:\n${logs.stdout}${logs.stderr}` : ''}`
    );
  }
}

async function createGatewayAndTlsBridge() {
  const gateway = createGateway({
    hostCredentials: HOST_SECRETS,
    roomTtlMs: 60000,
    pollTimeoutMs: 1000,
    requestTimeoutMs: 12000,
  });
  await listen(gateway, 0, '127.0.0.1');
  const gatewayPort = gateway.address().port;
  const certificate = selfsigned.generate(
    [{ name: 'commonName', value: 'host.docker.internal' }],
    { days: 1, keySize: 2048, algorithm: 'sha256' }
  );
  const tlsBridge = https.createServer(
    { key: certificate.private, cert: certificate.cert },
    (request, response) => {
      const upstream = http.request(
        {
          hostname: '127.0.0.1',
          port: gatewayPort,
          method: request.method,
          path: request.url,
          headers: request.headers,
        },
        upstreamResponse => {
          response.writeHead(upstreamResponse.statusCode, upstreamResponse.headers);
          upstreamResponse.pipe(response);
        }
      );
      upstream.on('error', error => {
        if (!response.headersSent) response.writeHead(502);
        response.end(error.message);
      });
      request.pipe(upstream);
    }
  );
  await listen(tlsBridge, 0, '0.0.0.0');
  const port = tlsBridge.address().port;
  return {
    gateway,
    tlsBridge,
    dockerOrigin: `https://host.docker.internal:${port}`,
    desktopOrigin: `https://127.0.0.1:${port}`,
  };
}

function makeDesktopHost(origin, managerCalls = []) {
  require('./helpers/register-babel-src');
  const { KaraokeServer } = require('../src/electron/karaoke/KaraokeServer');
  const { KaraokeRemoteService, RemoteApiRouter } = require('../src/electron/karaoke/KaraokeRemoteApi');
  const catalog = {
    getTrack: async id => makeTrack(id),
    availability: async () => 'playable',
    resetRoomCatalog() {},
  };
  let server;
  const managerBridge = makeMemoryManagerBridge('desktop', managerCalls);
  const remoteService = new KaraokeRemoteService({
    catalog,
    managerBridge,
    getRoom: () => server && server.room,
  });
  server = new KaraokeServer({
    remoteDistPath: path.join(ROOT, 'public'),
    port: 0,
    listen: (httpServer, port, _host, callback) =>
      httpServer.listen(port, '127.0.0.1', callback),
    networkInterfaces: () => ({
      integration: [
        { address: '192.168.1.88', family: 'IPv4', internal: false },
      ],
    }),
    remoteService,
  });
  server.setRemoteApi(new RemoteApiRouter(remoteService), remoteService);
  server.setPublicConfig({
    gatewayOrigin: origin,
    hostId: HOST_IDS.desktop,
    hostSecret: HOST_SECRETS[HOST_IDS.desktop],
  });
  return { server, managerCalls };
}

async function openDockerRoom(host) {
  const opened = await jsonRequest(`${host.base}/ktv/host/open`, 'POST', {
    hostName: 'Docker integration host',
    snapshot: {
      session: { sessionId: 'docker-integration-session', status: 'active' },
      revision: 1,
      currentItem: null,
      waitingItems: [],
      historyItems: [],
    },
  });
  assert.equal(opened.status, 200, `Docker host open failed: ${opened.body}`);
  assert.ok(opened.json.hostToken);
  return opened.json;
}

function parsePublicLink(link) {
  const url = new URL(link);
  const roomMatch = url.pathname.match(/^\/r\/([a-f0-9]{32,64})\/room\/$/);
  const token = new URLSearchParams(url.hash.slice(1)).get('token');
  assert.ok(roomMatch, `Unexpected public room link: ${link}`);
  assert.match(token || '', /^[A-Za-z0-9_-]{32,128}$/);
  return {
    origin: url.origin,
    roomId: roomMatch[1],
    token,
    path: `/r/${roomMatch[1]}`,
  };
}

async function createGuestSession(room, joinToken) {
  return waitFor(
    `guest session for room ${room.roomId}`,
    () => jsonRequest(`${room.origin}${room.path}/ktv/api/client-session`, 'POST', {}, {
      origin: room.origin,
      ...bearer(joinToken),
    }),
    result => result.status === 200
  ).then(result => {
    assert.match(result.json.clientToken, /^[A-Za-z0-9_-]{32,128}$/);
    return result.json;
  });
}

async function runDockerEnqueue(host, hostToken, expectedTrackId) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const polled = await jsonRequest(`${host.base}/ktv/host/exchange`, 'POST', {}, bearer(hostToken));
    assert.equal(polled.status, 200, `Docker manager exchange failed: ${polled.body}`);
    const command = (polled.json.commands || []).find(
      item => item.action === 'enqueue' && String(item.payload?.track?.id) === expectedTrackId
    );
    if (!command) {
      await new Promise(resolve => setTimeout(resolve, 100));
      continue;
    }
    const result = await jsonRequest(`${host.base}/ktv/host/exchange`, 'POST', {
      results: [{
        id: command.id,
        ok: true,
        result: makeQueueItem(expectedTrackId, command.payload.requester),
      }],
    }, bearer(hostToken));
    assert.equal(result.status, 200);
    return command;
  }
  throw new Error(`Docker KaraokeWebHost managerBridge did not enqueue ${expectedTrackId}`);
}

function startHttpHandler(handler) {
  const server = http.createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch(error => {
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        response.end(error.stack || String(error));
      } else {
        response.destroy(error);
      }
    });
  });
  return server;
}

async function runLocalProcess() {
  require('./helpers/register-babel-src');
  const KaraokeWebHost = require('../src/server/KaraokeWebHost').default;
  const { KaraokeServer } = require('../src/electron/karaoke/KaraokeServer');
  const { KaraokeRemoteService, RemoteApiRouter } = require('../src/electron/karaoke/KaraokeRemoteApi');

  const gateway = createGateway({
    hostCredentials: HOST_SECRETS,
    roomTtlMs: 60000,
    pollTimeoutMs: 1000,
    requestTimeoutMs: 12000,
  });
  const gatewayAddress = await listen(gateway);
  const origin = `http://127.0.0.1:${gatewayAddress.port}`;
  const webCalls = [];
  const desktopCalls = [];
  let webHost;
  let webApiServer;
  let webGuestServer;
  let desktopServer;

  try {
    let webGuestPort = 0;
    webHost = new KaraokeWebHost({
      publicOrigin: origin,
      publicGuestOrigin: origin,
      gatewayOrigin: origin,
      gatewayHostId: HOST_IDS.web,
      gatewayHostSecret: HOST_SECRETS[HOST_IDS.web],
      remoteDistPath: path.join(ROOT, 'public'),
      hostConnectorFactory: options =>
        createHostConnector({ ...options, localPort: webGuestPort }),
    });
    webHost.service.managerBridge = makeMemoryManagerBridge('web', webCalls);
    webHost.service.catalog.getTrack = async id => makeTrack(id);
    webHost.service.catalog.availability = async () => 'playable';

    webApiServer = startHttpHandler((request, response) =>
      webHost.handle(request, response)
    );
    webGuestServer = startHttpHandler((request, response) =>
      webHost.handlePublicGuest(request, response)
    );
    const [webApiAddress, webGuestAddress] = await Promise.all([
      listen(webApiServer),
      listen(webGuestServer),
    ]);
    webGuestPort = webGuestAddress.port;
    assert.equal(gateway.address().address, '127.0.0.1');
    assert.equal(webApiAddress.address, '127.0.0.1');
    assert.equal(webGuestAddress.address, '127.0.0.1');
    const webControl = `http://127.0.0.1:${webApiAddress.port}`;

    const desktopHost = makeDesktopHost(origin, desktopCalls);
    desktopServer = desktopHost.server;
    const [webRoomData, desktopRoomData] = await Promise.all([
      jsonRequest(`${webControl}/ktv/host/open`, 'POST', {
        hostName: 'Local-process web host',
        snapshot: {
          session: { sessionId: 'local-web-session', status: 'active' },
          revision: 1,
          currentItem: null,
          waitingItems: [],
          historyItems: [],
        },
      }),
      desktopServer.startRoom({ sessionId: 'local-electron-session' }),
    ]);
    assert.equal(webRoomData.status, 200, `Local KaraokeWebHost open failed: ${webRoomData.body}`);
    assert.ok(webRoomData.json.hostToken);
    assert.equal(desktopServer.server.address().address, '127.0.0.1');
    assert.equal(desktopServer.publicAdapterServer.address().address, '127.0.0.1');

    const webRoom = parsePublicLink(webRoomData.json.room.publicJoinUrl);
    const desktopRoom = parsePublicLink(desktopRoomData.publicJoinUrl);
    assert.notEqual(webRoom.roomId, desktopRoom.roomId, 'Gateway room IDs must be unique');
    assert.notEqual(webRoom.token, desktopRoom.token, 'Public join tokens must be unique');

    const [webGuest, desktopGuest] = await Promise.all([
      createGuestSession(webRoom, webRoom.token),
      createGuestSession(desktopRoom, desktopRoom.token),
    ]);
    assert.notEqual(webGuest.clientToken, desktopGuest.clientToken);

    const wrongJoin = await jsonRequest(
      `${desktopRoom.origin}${desktopRoom.path}/ktv/api/client-session`,
      'POST', {}, { origin: desktopRoom.origin, ...bearer(webRoom.token) }
    );
    assert.equal(wrongJoin.status, 401, 'A public join token must not enter the other room');
    const wrongClient = await httpRequest(
      `${webRoom.origin}${webRoom.path}/ktv/api/state`,
      { headers: { origin: webRoom.origin, ...bearer(desktopGuest.clientToken) } }
    );
    assert.equal(wrongClient.status, 401, 'A client token must remain scoped to its room');

    const expectedPortrait = fs.readFileSync(
      path.join(ROOT, 'public', 'artist-portraits', '6452.jpg')
    );
    for (const room of [webRoom, desktopRoom]) {
      const response = await httpRequest(`${room.origin}${room.path}${PORTRAIT_PATH}`);
      assert.equal(response.status, 200, `Portrait was not served for ${room.roomId}`);
      assert.match(response.headers['content-type'] || '', /^image\/jpeg/i);
      assert.deepEqual(response.body, expectedPortrait, 'Portrait bytes changed through the local gateway');
    }

    const [webReply, desktopReply] = await Promise.all([
      jsonRequest(
        `${webRoom.origin}${webRoom.path}/ktv/api/requests`,
        'POST',
        { trackId: TRACK_IDS.web, requestId: 'local-web-request-0001' },
        { origin: webRoom.origin, ...bearer(webGuest.clientToken) }
      ),
      jsonRequest(
        `${desktopRoom.origin}${desktopRoom.path}/ktv/api/requests`,
        'POST',
        { trackId: TRACK_IDS.desktop, requestId: 'local-desktop-request-001' },
        { origin: desktopRoom.origin, ...bearer(desktopGuest.clientToken) }
      ),
    ]);
    assert.equal(webReply.status, 201, `Local KaraokeWebHost request failed: ${webReply.body}`);
    assert.equal(desktopReply.status, 201, `Local KaraokeServer request failed: ${desktopReply.body}`);
    assert.deepEqual(webCalls, [{ host: 'web', trackId: TRACK_IDS.web }]);
    assert.deepEqual(desktopCalls, [{ host: 'desktop', trackId: TRACK_IDS.desktop }]);
    assert.equal(webReply.json.item.trackId, TRACK_IDS.web);
    assert.equal(desktopReply.json.item.trackId, TRACK_IDS.desktop);

    const closed = await jsonRequest(
      `${webControl}/ktv/host/close`, 'POST', {}, bearer(webRoomData.json.hostToken)
    );
    assert.equal(closed.status, 200, 'Local KaraokeWebHost room did not close cleanly');
    const oldWebLink = await httpRequest(
      `${webRoom.origin}${webRoom.path}/ktv/api/state`,
      { headers: { origin: webRoom.origin, ...bearer(webGuest.clientToken) } }
    );
    assert.equal(oldWebLink.status, 410, 'Closed room link must be revoked');
    const liveDesktopLink = await httpRequest(
      `${desktopRoom.origin}${desktopRoom.path}/ktv/api/state`,
      { headers: { origin: desktopRoom.origin, ...bearer(desktopGuest.clientToken) } }
    );
    assert.equal(liveDesktopLink.status, 200, 'Closing one room affected the other room');

    process.stdout.write('PASS local-process gateway, real connectors, and concurrent host rooms\n');
    process.stdout.write('PASS isolated public links, join tokens, client tokens, and managerBridge calls\n');
    process.stdout.write('PASS artist portrait bytes survived both gateway paths\n');
    process.stdout.write('PASS closed room link revoked while the other room stayed live\n');
    process.stdout.write('NOTE KaraokeWebHost ran as a local process; this is not Docker validation.\n');
  } finally {
    if (desktopServer) await desktopServer.stopRoom().catch(() => {});
    if (webHost) await webHost.close().catch(() => {});
    await Promise.all([closeServer(webGuestServer), closeServer(webApiServer)]);
    await closeServer(gateway);
  }
}

async function run() {
  docker(['version', '--format', '{{.Server.Version}}']);
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const { gateway, tlsBridge, dockerOrigin, desktopOrigin } = await createGatewayAndTlsBridge();
  let containerId = '';
  let desktop;
  try {
    const dockerHost = await startDockerHost(dockerOrigin);
    containerId = dockerHost.containerId;
    const desktopHost = makeDesktopHost(desktopOrigin);
    desktop = desktopHost.server;

    const [dockerRoomData, desktopRoomData] = await Promise.all([
      openDockerRoom(dockerHost),
      desktop.startRoom({ sessionId: 'electron-integration-session' }),
    ]);
    const webLink = dockerRoomData.room.publicJoinUrl;
    const desktopLink = desktopRoomData.publicJoinUrl;
    assert.ok(webLink, 'Docker KaraokeWebHost did not return a public guest link');
    assert.ok(desktopLink, 'Electron KaraokeServer did not return a public guest link');

    const webRoom = parsePublicLink(webLink);
    const desktopRoom = parsePublicLink(desktopLink);
    assert.notEqual(webRoom.roomId, desktopRoom.roomId, 'Gateway room IDs must be unique');
    assert.notEqual(webRoom.token, desktopRoom.token, 'Public guest tokens must be unique');

    const [webGuest, desktopGuest] = await Promise.all([
      createGuestSession(webRoom, webRoom.token),
      createGuestSession(desktopRoom, desktopRoom.token),
    ]);
    assert.notEqual(webGuest.clientToken, desktopGuest.clientToken);

    const wrongJoin = await jsonRequest(
      `${desktopRoom.origin}${desktopRoom.path}/ktv/api/client-session`,
      'POST', {}, { origin: desktopRoom.origin, ...bearer(webRoom.token) }
    );
    assert.equal(wrongJoin.status, 401, 'A public join token must not enter the other room');
    const wrongClient = await httpRequest(
      `${desktopRoom.origin}${desktopRoom.path}/ktv/api/state`,
      { headers: { origin: desktopRoom.origin, ...bearer(webGuest.clientToken) } }
    );
    assert.equal(wrongClient.status, 401, 'A client token must remain scoped to its room');

    const assetPath = path.join(ROOT, 'public', 'artist-portraits', '6452.jpg');
    const expectedPortrait = fs.readFileSync(assetPath);
    for (const room of [webRoom, desktopRoom]) {
      const response = await httpRequest(`${room.origin}${room.path}${PORTRAIT_PATH}`);
      assert.equal(response.status, 200, `Portrait was not served for ${room.roomId}`);
      assert.match(response.headers['content-type'] || '', /^image\/jpeg/i);
      assert.deepEqual(response.body, expectedPortrait, 'Portrait bytes changed in transit through the gateway');
    }

    const webRequest = jsonRequest(
      `${webRoom.origin}${webRoom.path}/ktv/api/requests`,
      'POST',
      { trackId: TRACK_IDS.web, requestId: 'docker-integration-request-001' },
      { origin: webRoom.origin, ...bearer(webGuest.clientToken) }
    );
    const desktopRequest = jsonRequest(
      `${desktopRoom.origin}${desktopRoom.path}/ktv/api/requests`,
      'POST',
      { trackId: TRACK_IDS.desktop, requestId: 'electron-integration-request-002' },
      { origin: desktopRoom.origin, ...bearer(desktopGuest.clientToken) }
    );
    const dockerCommandPromise = runDockerEnqueue(
      dockerHost,
      dockerRoomData.hostToken,
      TRACK_IDS.web
    );
    const desktopReply = await desktopRequest;
    assert.equal(desktopReply.status, 201, `Electron point request failed: ${desktopReply.body}`);
    assert.deepEqual(desktopHost.managerCalls, [
      { host: 'desktop', trackId: TRACK_IDS.desktop },
    ]);
    const dockerCommand = await dockerCommandPromise;
    assert.equal(String(dockerCommand.payload.track.id), TRACK_IDS.web);
    const webReply = await webRequest;
    assert.equal(webReply.status, 201, `Docker point request failed: ${webReply.body}`);
    assert.equal(webReply.json.item.trackId, TRACK_IDS.web);
    assert.equal(desktopReply.json.item.trackId, TRACK_IDS.desktop);
    assert.equal(desktopHost.managerCalls.some(call => call.trackId === TRACK_IDS.web), false);

    const closed = await jsonRequest(
      `${dockerHost.base}/ktv/host/close`, 'POST', {}, bearer(dockerRoomData.hostToken)
    );
    assert.equal(closed.status, 200, 'Docker room did not close cleanly');
    const oldWebLink = await httpRequest(
      `${webRoom.origin}${webRoom.path}/ktv/api/state`,
      { headers: { origin: webRoom.origin, ...bearer(webGuest.clientToken) } }
    );
    assert.equal(oldWebLink.status, 410, 'Closed room link must be revoked');
    const liveDesktopLink = await httpRequest(
      `${desktopRoom.origin}${desktopRoom.path}/ktv/api/state`,
      { headers: { origin: desktopRoom.origin, ...bearer(desktopGuest.clientToken) } }
    );
    assert.equal(liveDesktopLink.status, 200, 'Closing the Docker room affected the Electron room');

    process.stdout.write('PASS local gateway and HTTPS bridge\n');
    process.stdout.write('PASS concurrent Docker KaraokeWebHost and Electron KaraokeServer rooms\n');
    process.stdout.write('PASS independent public links, join tokens, and client tokens\n');
    process.stdout.write('PASS point requests reached only their own managerBridge\n');
    process.stdout.write('PASS artist portrait bytes survived both gateway paths\n');
    process.stdout.write('PASS closed room link revoked while the other room stayed live\n');
  } finally {
    if (desktop) await desktop.stopRoom().catch(() => {});
    if (containerId) docker(['rm', '--force', containerId], { allowFailure: true });
    await closeServer(tlsBridge);
    await closeServer(gateway);
  }
}

const localProcessMode = process.argv.includes('--local-process');
const selectedRun = localProcessMode ? runLocalProcess : run;
selectedRun().catch(error => {
  const mode = localProcessMode ? 'local-process' : 'Docker';
  process.stderr.write(`FAIL ${mode} multiroom real-host integration: ${error.stack || error}\n`);
  process.exitCode = 1;
});
