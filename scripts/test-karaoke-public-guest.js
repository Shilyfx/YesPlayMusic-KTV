const assert = require('assert/strict');
const http = require('http');
require('./helpers/register-babel-src');
const KaraokeWebHost = require('../src/server/KaraokeWebHost').default;

async function run() {
  const origin = 'https://ktv.example.test';
  const lanOrigin = 'http://127.0.0.1';
  const host = new KaraokeWebHost({
    publicOrigin: lanOrigin,
    publicGuestOrigin: origin,
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
  }
}

run().then(
  () => console.log('Public KTV guest access tests passed'),
  error => {
    console.error(error);
    process.exitCode = 1;
  }
);
