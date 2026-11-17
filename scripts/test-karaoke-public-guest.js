const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
require('./helpers/register-babel-src');
const { REACTION_ASSET_PATHS } = require('./reaction-assets.cjs');
const KaraokeWebHost = require('../src/server/KaraokeWebHost').default;
const {
  createPublicGuestRouter,
} = require('../src/server/KaraokePublicGuestRouter');

async function testPublicGuestRouterRedirect() {
  const headers = {};
  let statusCode = null;
  let location = '';
  const host = { expire() {}, publicGuestOrigin: 'https://ktv.example.test' };
  const router = createPublicGuestRouter(host);
  const response = {
    setHeader(name, value) {
      headers[name] = value;
    },
    writeHead(status, values) {
      statusCode = status;
      location = values.Location;
    },
    end() {},
  };

  await router({ method: 'GET', url: '/room?from=guest' }, response);

  assert.deepEqual(headers, {
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  assert.equal(statusCode, 308);
  assert.equal(location, '/room/');
}

async function testPublicGuestStaticPaths() {
  const delegated = [];
  const host = {
    expire() {},
    publicGuestOrigin: 'https://ktv.example.test',
    roomServer: {
      handleRequest(request, response) {
        delegated.push(request.url);
        response.writeHead(200);
      },
    },
    json(response, status) {
      response.status = status;
    },
  };
  const router = createPublicGuestRouter(host);
  const invoke = async url => {
    const response = {
      status: null,
      setHeader() {},
      writeHead(status) {
        this.status = status;
      },
      end() {},
    };
    await router({ method: 'GET', url }, response);
    return response.status;
  };

  const allowedPath = '/room/js/reactions/mood-mates/src/core/geometry.js';
  assert.equal(await invoke(allowedPath), 200);
  assert.deepEqual(delegated, [allowedPath]);
  for (const blockedPath of [
    '/room/js/reactions/../../index.html',
    '/room/js/reactions/%2e%2e/index.html',
    '/room/js/reactions/mood-mates/LICENSE',
    '/room/js/reactions/mood-mates/README.md',
    '/room/js/reactions/mood-mates/',
  ]) {
    assert.equal(await invoke(blockedPath), 404, blockedPath);
  }
  assert.deepEqual(
    delegated,
    [allowedPath],
    'only allowed JavaScript assets reach the static room server'
  );
}

function requestRawPath(base, requestPath) {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const request = http.get(
      { hostname: url.hostname, port: url.port, path: requestPath },
      response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => (body += chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode, body })
        );
      }
    );
    request.on('error', reject);
  });
}

async function run() {
  await testPublicGuestRouterRedirect();
  await testPublicGuestStaticPaths();
  const origin = 'https://ktv.example.test';
  const lanOrigin = 'http://127.0.0.1';
  const remoteDistPath = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ktv-public-reactions-')
  );
  for (const relativePath of REACTION_ASSET_PATHS) {
    const scriptPath = path.join(
      remoteDistPath,
      'js',
      'reactions',
      ...relativePath.split('/')
    );
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    fs.writeFileSync(scriptPath, `asset:${relativePath}`);
  }
  fs.writeFileSync(path.join(remoteDistPath, 'index.html'), 'remote shell');
  fs.mkdirSync(path.join(remoteDistPath, 'js', 'reactions', 'mood-mates'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(remoteDistPath, 'js', 'reactions', 'mood-mates', 'LICENSE'),
    'must not be exposed'
  );
  fs.mkdirSync(path.join(remoteDistPath, 'js'), { recursive: true });
  fs.writeFileSync(
    path.join(remoteDistPath, 'js', 'index.html'),
    'must not be exposed through traversal'
  );
  const host = new KaraokeWebHost({
    publicOrigin: lanOrigin,
    publicGuestOrigin: origin,
    remoteDistPath,
  });
  const servers = [
    http.createServer((req, res) => host.handle(req, res)),
    http.createServer((req, res) => host.handlePublicGuest(req, res)),
  ];
  const [lan, guest] = await Promise.all(
    servers.map(
      server =>
        new Promise(resolve =>
          server.listen(0, '127.0.0.1', () =>
            resolve(`http://127.0.0.1:${server.address().port}`)
          )
        )
    )
  );
  const post = (base, route, body, token = '', from = origin) =>
    fetch(base + route, {
      method: 'POST',
      headers: {
        Origin: from,
        Authorization: token ? `Bearer ${token}` : '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  const state = (base, token) =>
    fetch(base + '/ktv/api/state', {
      headers: { Authorization: `Bearer ${token}` },
    });
  const joinPath = '/ktv/api/client-session';
  const waitingItems = [];
  const snapshot = {
    session: { sessionId: 'public-guest-test', status: 'active' },
    revision: 1,
    currentItem: null,
    waitingItems,
    historyItems: [],
  };
  host.service.catalog.getTrack = async id => ({
    trackId: String(id),
    name: 'Test track',
    artists: ['Artist'],
    coverUrl: '',
    album: 'Album',
  });
  host.service.catalog.availability = async () => 'playable';
  host.service.managerBridge.enqueue = async (track, requester) => {
    const item = {
      queueItemId: 'test-item',
      trackId: String(track.id),
      trackName: track.name,
      artists: ['Artist'],
      requesterId: requester.id,
      status: 'queued',
    };
    waitingItems.push(item);
    host.owner.snapshot.waitingItems = waitingItems;
    return item;
  };
  host.service.managerBridge.front = async () => assert.fail('Public priority');
  try {
    for (const relativePath of REACTION_ASSET_PATHS) {
      const reactionAsset = await fetch(
        guest + `/room/js/reactions/${relativePath}`
      );
      assert.equal(reactionAsset.status, 200, relativePath);
      assert.equal(await reactionAsset.text(), `asset:${relativePath}`);
    }
    assert.equal(
      (await requestRawPath(guest, '/room/js/reactions/%2e%2e/index.html'))
        .status,
      404,
      'encoded traversal is rejected before the static room handler'
    );
    assert.equal(
      (await requestRawPath(guest, '/room/js/reactions/../index.html')).status,
      404,
      'dot-segment traversal is rejected before the static room handler'
    );
    assert.equal(
      (await fetch(guest + '/room/js/reactions/mood-mates/LICENSE')).status,
      404,
      'non-script source and license files are not exposed'
    );
    const open = () => post(lan, '/ktv/host/open', { snapshot }, '', lanOrigin);
    const opened = await open();
    assert.equal(opened.status, 200);
    const { room, hostToken } = await opened.json();
    const publicLink = new URL(room.publicJoinUrl);
    const pass = new URLSearchParams(publicLink.hash.slice(1)).get('token');
    assert.equal(publicLink.origin, origin);
    assert.match(room.publicQrDataUrl, /^data:image\/png;base64,/);
    assert.equal(
      (
        await (
          await post(lan, '/ktv/host/status', {}, hostToken, lanOrigin)
        ).json()
      ).room.publicJoinUrl,
      room.publicJoinUrl
    );
    assert.equal((await post(guest, joinPath, {})).status, 401);
    assert.equal((await post(guest, joinPath, {}, 'wrong')).status, 401);
    assert.equal(
      (await post(guest, joinPath, {}, pass, lanOrigin)).status,
      403
    );
    assert.equal((await post(lan, joinPath, {}, pass, lanOrigin)).status, 401);
    const { clientToken: lanToken } = await (
      await post(lan, joinPath, {}, '', lanOrigin)
    ).json();
    const joined = await post(guest, joinPath, {}, pass);
    assert.equal(joined.status, 200);
    const { clientToken } = await joined.json();
    assert.equal((await state(lan, clientToken)).status, 401);
    assert.equal((await state(guest, lanToken)).status, 401);
    const headers = { Authorization: `Bearer ${clientToken}` };
    for (const route of [
      '/ktv/host/status',
      '/ktv/local/list',
      '/ktv/display',
      '/ktv/api/local-playlists',
      '/ktv/api/playlists',
      '/ktv/api/track/123/preview',
      '/ktv/local/audio/local-0123456789abcdef',
    ])
      assert.equal((await fetch(guest + route, { headers })).status, 404);
    assert.equal(
      (await post(guest, '/ktv/api/next', {}, clientToken)).status,
      404
    );
    assert.equal(
      (
        await post(
          guest,
          '/ktv/api/requests',
          {
            trackId: 'local-0123456789abcdef',
            requestId: 'request-public-local-0001',
          },
          clientToken
        )
      ).status,
      400
    );
    const requested = await post(
      guest,
      '/ktv/api/requests',
      {
        trackId: '123',
        priority: true,
        requestId: 'request-public-guest-0001',
      },
      clientToken
    );
    assert.equal(requested.status, 201, await requested.text());
    const publicState = await (await state(guest, clientToken)).json();
    const lanState = await (await state(lan, lanToken)).json();
    assert.deepEqual(publicState.waiting, lanState.waiting);
    assert.equal(publicState.waiting.length, 1);
    assert.equal(publicState.client.permissions.priority, false);
    assert.equal(
      (
        await post(
          guest,
          '/ktv/api/reactions',
          { kind: 'applause' },
          clientToken
        )
      ).status,
      200
    );
    await post(lan, '/ktv/host/close', {}, hostToken, lanOrigin);
    assert.equal((await state(guest, clientToken)).status, 410);
    assert.equal((await post(guest, joinPath, {}, pass)).status, 410);
    assert.equal((await open()).status, 200);
    assert.equal((await post(guest, joinPath, {}, pass)).status, 401);
  } finally {
    host.close();
    await Promise.all(
      servers.map(server => new Promise(resolve => server.close(resolve)))
    );
    fs.rmSync(remoteDistPath, { recursive: true, force: true });
  }
}

run().then(
  () => console.log('Public KTV guest access tests passed'),
  error => {
    console.error(error);
    process.exitCode = 1;
  }
);
