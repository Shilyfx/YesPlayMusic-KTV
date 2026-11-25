'use strict';

const assert = require('assert/strict');
require('./helpers/register-babel-src');
const KaraokeWebHost = require('../src/server/KaraokeWebHost').default;

function room(publicJoinToken) {
  return {
    code: 'ABC123',
    name: 'LumaSing KTV',
    token: 'room-token',
    publicJoinToken,
    generation: 1,
  };
}

async function call(host, pathname, body, hostToken = '') {
  const requestBody = Buffer.from(JSON.stringify(body));
  const request = {
    method: 'POST',
    url: pathname,
    headers: {
      origin: 'http://ktv.home',
      host: 'ktv.home',
      'content-type': 'application/json',
      ...(hostToken ? { authorization: `Bearer ${hostToken}` } : {}),
    },
    async *[Symbol.asyncIterator]() {
      yield requestBody;
    },
  };
  const response = {
    status: 0,
    body: null,
    writeHead(status) { this.status = status; },
    end(rawBody) { this.body = rawBody ? JSON.parse(rawBody) : null; },
  };
  await host.handle(request, response);
  return response;
}

async function testGatewayRoomsUseDedicatedPortAndUniqueLinks() {
  const configurations = [];
  const started = [];
  const stopped = [];
  const roomIds = ['a'.repeat(32), 'b'.repeat(32)];
  const host = new KaraokeWebHost({
    publicOrigin: 'http://ktv.home',
    publicGuestOrigin: 'https://legacy.example.test',
    gatewayOrigin: 'https://gateway.example.test',
    gatewayHostId: 'router-host',
    gatewayHostSecret: 'host-secret',
    hostConnectorFactory: options => {
      configurations.push(options);
      const roomId = roomIds[configurations.length - 1];
      return {
        roomId,
        async start() { started.push(roomId); },
        async stop() { stopped.push(roomId); },
      };
    },
  });

  const joinTokens = [];
  try {
    for (let index = 0; index < 2; index += 1) {
      const opened = await call(host, '/ktv/host/open', {
        snapshot: {
          session: { sessionId: `session-${index}`, status: 'active' },
          revision: 1,
          currentItem: null,
          waitingItems: [],
          historyItems: [],
        },
      });
      assert.equal(opened.status, 200);
      const { room: described, hostToken } = opened.body;
      const joinToken = new URLSearchParams(
        described.publicJoinUrl.split('#')[1]
      ).get('token');
      assert.match(joinToken || '', /^[a-f0-9]{64}$/);
      joinTokens.push(joinToken);
      assert.equal(
        described.publicJoinUrl,
        `https://gateway.example.test/r/${roomIds[index]}/room/#public=1&token=${joinToken}`
      );
      assert.equal(configurations[index].localPort, 3101);
      assert.equal(configurations[index].hostId, 'router-host');
      assert.equal(configurations[index].hostSecret, 'host-secret');
      const closed = await call(host, '/ktv/host/close', {}, hostToken);
      assert.equal(closed.status, 200);
    }
    assert.notEqual(joinTokens[0], joinTokens[1]);
    assert.deepEqual(started, roomIds);
    assert.deepEqual(stopped, roomIds);
  } finally {
    await host.close();
  }
}

async function testLegacySingleRoomLinkRemainsUnchanged() {
  const host = new KaraokeWebHost({
    publicOrigin: 'http://ktv.home',
    publicGuestOrigin: 'https://legacy.example.test',
  });
  host.roomServer.room = room('legacy-token');
  try {
    const described = await host.describe({ headers: { host: 'ktv.home' } });
    assert.equal(
      described.publicJoinUrl,
      'https://legacy.example.test/room/#public=1&token=legacy-token'
    );
  } finally {
    await host.close();
  }
}

async function testUnavailableGatewayDoesNotRejectRoomLifecycle() {
  let stopCount = 0;
  const host = new KaraokeWebHost({
    publicOrigin: 'http://ktv.home',
    publicGuestOrigin: 'https://gateway.example.test',
    gatewayOrigin: 'https://gateway.example.test',
    gatewayHostId: 'router-host',
    gatewayHostSecret: 'host-secret',
    hostConnectorFactory: () => ({
      roomId: 'c'.repeat(32),
      async start() { throw new Error('GATEWAY_UNAVAILABLE'); },
      async stop() { stopCount += 1; },
    }),
  });
  try {
    const opened = await call(host, '/ktv/host/open', {
      snapshot: {
        session: { sessionId: 'offline-gateway', status: 'active' },
        revision: 1,
        currentItem: null,
        waitingItems: [],
        historyItems: [],
      },
    });
    assert.equal(opened.status, 200);
    const { room: described } = opened.body;
    const joinToken = new URLSearchParams(
      described.publicJoinUrl.split('#')[1]
    ).get('token');
    assert.match(joinToken || '', /^[a-f0-9]{64}$/);
    assert.equal(
      described.publicJoinUrl,
      `https://gateway.example.test/r/${'c'.repeat(32)}/room/#public=1&token=${joinToken}`
    );
    assert.ok(host.gatewayConnectorRetryTimer);
  } finally {
    await host.close();
  }
  assert.equal(stopCount, 1);
}

async function testRoomCloseWaitsForGatewayRegistrationBeforeRevoking() {
  let finishRegistration;
  const lifecycle = [];
  const host = new KaraokeWebHost({
    gatewayOrigin: 'https://gateway.example.test',
    gatewayHostId: 'router-host',
    gatewayHostSecret: 'host-secret',
    hostConnectorFactory: () => ({
      roomId: 'd'.repeat(32),
      start() {
        lifecycle.push('start');
        return new Promise(resolve => { finishRegistration = resolve; });
      },
      async stop() { lifecycle.push('stop'); },
    }),
  });
  host.roomServer.room = room('join-token');
  const starting = host.startGatewayConnector();
  const closing = host.close();
  assert.deepEqual(lifecycle, ['start']);
  finishRegistration();
  await Promise.all([starting, closing]);
  assert.deepEqual(lifecycle, ['start', 'stop']);
}

Promise.resolve()
  .then(testGatewayRoomsUseDedicatedPortAndUniqueLinks)
  .then(testLegacySingleRoomLinkRemainsUnchanged)
  .then(testUnavailableGatewayDoesNotRejectRoomLifecycle)
  .then(testRoomCloseWaitsForGatewayRegistrationBeforeRevoking)
  .then(() =>
    process.stdout.write('PASS multiroom host lifecycle, links, and local port\n')
  )
  .catch(error => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
