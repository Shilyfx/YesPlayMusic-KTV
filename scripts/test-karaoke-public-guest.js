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

  const allowedPaths = [
    '/room/js/reactions/mood-mates/src/core/geometry.js',
    '/room/artist-portraits/6452.jpg',
  ];
  for (const allowedPath of allowedPaths)
    assert.equal(await invoke(allowedPath), 200, allowedPath);
  assert.deepEqual(delegated, allowedPaths);
  for (const blockedPath of [
    '/room/js/reactions/../../index.html',
    '/room/js/reactions/%2e%2e/index.html',
    '/room/js/reactions/mood-mates/LICENSE',
    '/room/js/reactions/mood-mates/README.md',
    '/room/js/reactions/mood-mates/',
    '/room/artist-portraits/6452.png',
    '/room/artist-portraits/../index.html',
  ]) {
    assert.equal(await invoke(blockedPath), 404, blockedPath);
  }
  assert.deepEqual(
    delegated,
    allowedPaths,
    'only allowed assets reach the static room server'
  );
}

async function testPublicGuestCatalogRoutesAndLocalProjection() {
  const host = {
    expire() {},
    publicGuestOrigin: 'https://ktv.example.test',
    roomServer: { room: { token: 'host-token' } },
    json(response, status, body) {
      response.writeHead(status);
      response.end(JSON.stringify(body));
    },
    remoteApi: {
      handle(request, response, publicGuest) {
        assert.equal(publicGuest, true);
        assert.equal(request.headers.authorization, 'Bearer guest-token');
        response.writeHead(200, { 'Content-Type': 'application/json' });
        const payload = request.url.split('?')[0] === '/ktv/api/playlists'
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
          : {
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
                    controlToken: 'host-secret',
                  },
                ],
              },
            ],
          };
        response.end(JSON.stringify(payload));
      },
    },
  };
  const router = createPublicGuestRouter(host);
  async function invoke(method, url) {
    const response = {
      headers: {},
      setHeader(name, value) {
        this.headers[name] = value;
      },
      writeHead(status, headers = {}) {
        this.status = status;
        Object.assign(this.headers, headers);
      },
      end(body) {
        this.body = body;
      },
    };
    await router(
      {
        method,
        url,
        headers: {
          authorization: 'Bearer guest-token',
          origin: 'https://ktv.example.test',
        },
      },
      response
    );
    return response;
  }

  const catalog = await invoke('GET', '/ktv/api/local-playlists');
  assert.equal(catalog.status, 200);
  assert.deepEqual(JSON.parse(catalog.body), {
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
  const userPlaylists = await invoke('GET', '/ktv/api/playlists');
  assert.equal(userPlaylists.status, 200);
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
  for (const [method, url] of [
    ['GET', '/ktv/local/list'],
    ['GET', '/ktv/local/resolve/local-0123456789abcdef'],
    ['GET', '/ktv/local/audio/local-0123456789abcdef'],
    ['GET', '/ktv/api/track/local-0123456789abcdef/preview'],
    ['POST', '/ktv/api/playlists'],
  ])
    assert.equal((await invoke(method, url)).status, 404, `${method} ${url}`);
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
  await testPublicGuestCatalogRoutesAndLocalProjection();
  const origin = 'https://ktv.example.test';
  const lanOrigin = 'http://127.0.0.1';
  const remoteDistPath = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ktv-public-reactions-')
  );
  const portraitBytes = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'artist-portraits', '6452.jpg')
  );
  fs.mkdirSync(path.join(remoteDistPath, 'artist-portraits'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(remoteDistPath, 'artist-portraits', '6452.jpg'),
    portraitBytes
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
  const mutate = (base, method, route, token, from = origin) =>
    fetch(base + route, {
      method,
      headers: {
        Origin: from,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      ...(method === 'POST' ? { body: '{}' } : {}),
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
  let previewUrl = 'http://m701.music.126.net/test-preview.mp3';
  host.service.catalog.availability = async () => 'playable';
  host.service.catalog.hostCatalogBridge = async action => {
    if (action === 'preview') return previewUrl;
    if (action === 'recommendations')
      return [{ id: '123', name: 'Recommended', trackCount: 1 }];
    if (action === 'toplists')
      return [{ id: '123', name: 'Top list', trackCount: 1 }];
    if (action === 'playlists')
      return [
        {
          id: '123',
          name: 'Personal list',
          trackCount: 1,
          coverUrl: 'https://img.example/cover.jpg',
          creatorName: 'Private account name',
          accountToken: 'must-not-cross',
        },
      ];
    if (action === 'localPlaylists')
      return [
        {
          id: 'local-playlist-0123456789abcdef',
          name: 'Local list',
          source: 'local',
          trackCount: 1,
          directory: 'C:\\Users\\alice\\Music',
          tracks: [
            {
              id: 'local-0123456789abcdef',
              trackId: 'local-0123456789abcdef',
              localId: 'local-0123456789abcdef',
              source: 'local',
              name: 'Local song',
              artists: [{ name: 'Singer' }],
              album: {
                name: 'Album',
                picUrl: '/ktv/local/cover/local-0123456789abcdef',
              },
              audioPath: 'C:\\Users\\alice\\Music\\song.mp3',
              lyrics: [{ time: 1, content: 'private lyric' }],
            },
          ],
        },
      ];
    if (
      ['recommendationTracks', 'toplistTracks', 'playlistTracks'].includes(
        action
      )
    )
      return [
        {
          id: '321',
          name: 'Catalog song',
          ar: [{ name: 'Singer' }],
          al: { name: 'Album', picUrl: 'https://img.example/album.jpg' },
        },
      ];
    throw new Error('UNEXPECTED_CATALOG_ACTION');
  };
  let queueSequence = 0;
  host.service.managerBridge.enqueue = async (track, requester) => {
    const item = {
      queueItemId: `test-item-${++queueSequence}`,
      trackId: String(track.id),
      trackName: track.name,
      artists: ['Artist'],
      requesterId: requester.id,
      requesterName: requester.name,
      requesterType: requester.type,
      priorityRequested: Boolean(requester.priorityRequested),
      status: 'queued',
    };
    waitingItems.push(item);
    host.owner.snapshot.waitingItems = waitingItems;
    return item;
  };
  host.service.managerBridge.remove = async queueItemId => {
    const index = waitingItems.findIndex(item => item.queueItemId === queueItemId);
    return index < 0 ? null : waitingItems.splice(index, 1)[0];
  };
  host.service.managerBridge.front = async queueItemId => {
    const index = waitingItems.findIndex(item => item.queueItemId === queueItemId);
    if (index < 0) return false;
    waitingItems.unshift(waitingItems.splice(index, 1)[0]);
    return true;
  };
  host.service.managerBridge.next = async () => waitingItems.shift() || null;
  try {
    const portraitPath = '/room/artist-portraits/6452.jpg';
    for (const base of [lan, guest]) {
      const portrait = await fetch(base + portraitPath);
      assert.equal(portrait.status, 200, `${base}${portraitPath}`);
      assert.match(portrait.headers.get('content-type'), /^image\/jpeg/);
      assert.deepEqual(Buffer.from(await portrait.arrayBuffer()), portraitBytes);
    }
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
    const secondJoined = await post(guest, joinPath, {}, pass);
    assert.equal(secondJoined.status, 200);
    const { clientToken: secondClientToken } = await secondJoined.json();
    assert.equal((await state(lan, clientToken)).status, 401);
    assert.equal((await state(guest, lanToken)).status, 401);
    const headers = { Authorization: `Bearer ${clientToken}` };
    for (const route of [
      '/ktv/host/status',
      '/ktv/local/list',
      '/ktv/display',
      '/ktv/local/audio/local-0123456789abcdef',
    ])
      assert.equal((await fetch(guest + route, { headers })).status, 404);
    for (const route of [
      '/ktv/api/recommendations',
      '/ktv/api/toplists',
      '/ktv/api/playlists',
      '/ktv/api/local-playlists',
      '/ktv/api/recommendations/123/tracks',
      '/ktv/api/toplists/123/tracks',
      '/ktv/api/playlists/123/tracks',
    ]) {
      const response = await fetch(guest + route, { headers });
      assert.equal(response.status, 200, route);
      const data = await response.json();
      assert.ok(Array.isArray(data.playlists || data.tracks), route);
      assert.doesNotMatch(JSON.stringify(data), /audioPath|lyrics|accountToken|Private account name|C:\\\\Users/);
    }
    const unauthenticatedPreview = await fetch(
      guest + '/ktv/api/track/123/preview'
    );
    assert.equal(unauthenticatedPreview.status, 401);
    const preview = await fetch(guest + '/ktv/api/track/123/preview', {
      headers,
    });
    assert.equal(preview.status, 200);
    assert.equal((await preview.json()).url, 'https://m701.music.126.net/test-preview.mp3');
    previewUrl = 'https://audio.attacker.example/test.mp3';
    const rejectedPreview = await fetch(
      guest + '/ktv/api/track/123/preview',
      { headers }
    );
    assert.equal(rejectedPreview.status, 409);
    assert.doesNotMatch(await rejectedPreview.text(), /attacker\.example/);
    previewUrl = 'file:///C:/Users/alice/Music/private.mp3';
    const rejectedLocalPreview = await fetch(
      guest + '/ktv/api/track/123/preview',
      { headers }
    );
    assert.equal(rejectedLocalPreview.status, 409);
    assert.doesNotMatch(await rejectedLocalPreview.text(), /C:\/Users/);
    const unknownLocalRequest = await post(
      guest,
      '/ktv/api/requests',
      {
        trackId: 'local-ffffffffffffffff',
        requestId: 'request-public-unknown-local-0001',
      },
      clientToken
    );
    assert.equal(unknownLocalRequest.status, 400);
    const secondRequested = await post(
      guest,
      '/ktv/api/requests',
      {
        trackId: '123',
        requestId: 'request-public-guest-b-0001',
      },
      secondClientToken
    );
    assert.equal(secondRequested.status, 201, await secondRequested.clone().text());
    const secondRequestedBody = await secondRequested.json();
    const requested = await post(
      guest,
      '/ktv/api/requests',
      {
        trackId: '123',
        priority: true,
        requestId: 'request-public-guest-a-0001',
      },
      clientToken
    );
    assert.equal(requested.status, 201, await requested.clone().text());
    const requestedBody = await requested.json();
    assert.equal(requestedBody.item.priorityRequested, true);
    const publicState = await (await state(guest, clientToken)).json();
    const lanState = await (await state(lan, lanToken)).json();
    assert.deepEqual(publicState.waiting, lanState.waiting);
    assert.equal(publicState.waiting.length, 2);
    assert.equal(publicState.waiting[0].queueItemId, requestedBody.item.queueItemId);
    assert.equal(publicState.client.permissions.priority, true);
    const wrongOriginDelete = await mutate(
      guest,
      'DELETE',
      `/ktv/api/requests/${requestedBody.item.queueItemId}`,
      clientToken,
      'https://attacker.example'
    );
    assert.equal(wrongOriginDelete.status, 403);
    const deleteAnotherGuestsItem = await mutate(
      guest,
      'DELETE',
      `/ktv/api/requests/${requestedBody.item.queueItemId}`,
      secondClientToken
    );
    assert.equal(deleteAnotherGuestsItem.status, 403);
    const frontAnotherGuestsItem = await mutate(
      guest,
      'POST',
      `/ktv/api/requests/${requestedBody.item.queueItemId}/front`,
      secondClientToken
    );
    assert.equal(frontAnotherGuestsItem.status, 403);
    const deletedOwnItem = await mutate(
      guest,
      'DELETE',
      `/ktv/api/requests/${requestedBody.item.queueItemId}`,
      clientToken
    );
    assert.equal(deletedOwnItem.status, 200);
    const localRequested = await post(
      guest,
      '/ktv/api/requests',
      {
        trackId: 'local-0123456789abcdef',
        requestId: 'request-public-local-0001',
      },
      clientToken
    );
    assert.equal(localRequested.status, 201, await localRequested.clone().text());
    const localRequestBody = await localRequested.json();
    assert.equal(localRequestBody.item.source, 'local');
    const frontOwnItem = await mutate(
      guest,
      'POST',
      `/ktv/api/requests/${localRequestBody.item.queueItemId}/front`,
      clientToken
    );
    assert.equal(frontOwnItem.status, 200);
    assert.equal(
      (await (await state(guest, clientToken)).json()).waiting[0].queueItemId,
      localRequestBody.item.queueItemId
    );
    const noOriginNext = await mutate(
      guest,
      'POST',
      '/ktv/api/next',
      clientToken,
      ''
    );
    assert.equal(noOriginNext.status, 403);
    const nextItem = await mutate(guest, 'POST', '/ktv/api/next', clientToken);
    assert.equal(nextItem.status, 200);
    assert.equal((await nextItem.json()).item.queueItemId, localRequestBody.item.queueItemId);
    const localQueue = await (await state(guest, clientToken)).json();
    assert.equal(localQueue.waiting.length, 1);
    assert.doesNotMatch(
      JSON.stringify(localQueue),
      /audioPath|audioUrl|lyrics|C:\\\\Users/
    );
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
