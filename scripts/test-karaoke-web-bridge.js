const assert = require('assert');
require('./helpers/register-babel-src');
const createWebRoomBridge = require('../src/karaoke/webRoomBridge').default;
const flush = () => new Promise(resolve => setImmediate(resolve));
const baseSnapshot = {
  revision: 1,
  session: { sessionId: 's', status: 'active' },
  currentItem: null,
  waitingItems: [],
  historyItems: [],
};

async function testPendingOpenCleanup() {
  let resolveOpen;
  let closes = 0;
  let polls = 0;
  const bridge = createWebRoomBridge({
    manager: { getSnapshot: () => baseSnapshot },
    origin: 'http://router',
    execute: async () => {},
    schedule: () => {
      polls++;
      return 1;
    },
    cancel: () => {},
    request: async route => {
      if (route === 'open')
        return new Promise(resolve => {
          resolveOpen = resolve;
        });
      if (route === 'close') {
        closes++;
        return {};
      }
      return { commands: [] };
    },
  });
  const pending = bridge.invoke('karaoke:lan:start');
  await flush();
  await bridge.dispose();
  resolveOpen({ hostToken: 'late', room: {} });
  await assert.rejects(pending, /ROOM_ENDED/);
  assert.equal(closes, 1);
  assert.equal(polls, 0, 'disposed view must not start a hidden host');
}

async function testSlowWorkAndExpiry() {
  let release;
  let revision = 1;
  let nextCalls = 0;
  let calls = 0;
  const bodies = [];
  const bridge = createWebRoomBridge({
    manager: { getSnapshot: () => ({ ...baseSnapshot, revision }) },
    origin: 'http://router',
    schedule: () => 1,
    cancel: () => {},
    execute: async command => {
      if (command.action === 'catalog')
        return new Promise(resolve => {
          release = resolve;
        });
      nextCalls++;
    },
    request: async (route, body) => {
      if (route === 'open') return { hostToken: 'host', room: {} };
      if (route === 'close') return {};
      bodies.push(body);
      calls++;
      return {
        commands:
          calls === 1
            ? [
                {
                  id: 'slow',
                  action: 'catalog',
                  expiresAt: Date.now() + 12000,
                },
                { id: 'expired', action: 'next', expiresAt: Date.now() - 1 },
              ]
            : [
                {
                  id: 'slow',
                  action: 'catalog',
                  expiresAt: Date.now() + 12000,
                },
              ],
      };
    },
  });
  await bridge.invoke('karaoke:lan:start');
  await Promise.race([
    bridge.exchange(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('slow catalog blocked heartbeat')), 100)
    ),
  ]);
  await flush();
  revision++;
  await bridge.exchange();
  assert.equal(bodies[1].snapshot.revision, 2);
  assert.equal(nextCalls, 0, 'expired next must never skip a song');
  assert.ok(bodies[1].results.some(r => r.id === 'expired' && !r.ok));
  release('catalog-ok');
  await flush();
  await bridge.exchange();
  assert.ok(
    bodies[2].results.some(r => r.id === 'slow' && r.result === 'catalog-ok')
  );
  await bridge.dispose();
}

async function testRestartCommandIdCollision() {
  let loop;
  let fail = false;
  let executed = 0;
  const bridge = createWebRoomBridge({
    manager: { getSnapshot: () => baseSnapshot },
    origin: 'http://router',
    schedule: callback => {
      loop = callback;
      return 1;
    },
    cancel: () => {},
    execute: async () => {
      executed++;
      return 'done';
    },
    request: async route => {
      if (route === 'open') return { hostToken: 'host', room: {} };
      if (route === 'close') return {};
      if (fail) {
        const e = new Error('lost owner');
        e.status = 401;
        throw e;
      }
      return { commands: [{ id: 'web-1', action: 'next' }] };
    },
  });
  await bridge.invoke('karaoke:lan:start');
  await bridge.exchange();
  await flush();
  fail = true;
  await loop();
  fail = false;
  await bridge.invoke('karaoke:lan:start');
  await bridge.exchange();
  await flush();
  assert.equal(
    executed,
    2,
    'new server command ID must not reuse a previous host result'
  );
  await bridge.dispose();
}

async function testExpiredCommand() {
  let calls = 0;
  const bridge = createWebRoomBridge({
    manager: { getSnapshot: () => baseSnapshot },
    origin: 'http://router',
    schedule: () => 1,
    cancel: () => {},
    execute: async () => {
      calls++;
    },
    request: async route =>
      route === 'open'
        ? { hostToken: 'host', room: {} }
        : {
            commands: [
              { id: 'expired', action: 'next', expiresAt: Date.now() - 1 },
            ],
          },
  });
  await bridge.invoke('karaoke:lan:start');
  await bridge.exchange();
  await flush();
  await bridge.dispose();
  assert.equal(calls, 0, 'expired next must not execute');
}

(async () => {
  let executed = 0;
  let revision = 1;
  let failOnce = true;
  const exchanges = [];
  const command = { id: 'one', action: 'next', payload: {} };
  const bridge = createWebRoomBridge({
    manager: {
      getSnapshot: () => ({
        revision,
        session: { sessionId: 's', status: 'active' },
        currentItem: null,
        waitingItems: [],
        historyItems: [],
      }),
    },
    execute: async () => {
      executed++;
      return 'done';
    },
    origin: 'http://router:18080',
    request: async (route, body) => {
      if (route === 'open')
        return { hostToken: 'host-secret', room: { code: 'ROOM' } };
      if (route === 'close') return { ok: true };
      exchanges.push(body);
      if (body.results?.length && failOnce) {
        failOnce = false;
        throw new Error('lost reply');
      }
      return { commands: [command] };
    },
    schedule: () => 1,
    cancel: () => {},
  });
  assert.equal(
    (await bridge.invoke('karaoke:lan:candidates')).candidates[0].address,
    'router'
  );
  await bridge.invoke('karaoke:lan:start');
  await bridge.exchange();
  await flush();
  await assert.rejects(bridge.exchange(), /lost reply/);
  await bridge.exchange();
  assert.equal(executed, 1, 'retried commands must not skip twice');
  assert.equal(exchanges[1].results[0].result, 'done');
  assert.equal(
    exchanges[2].results[0].result,
    'done',
    'lost acknowledgments are resent'
  );
  revision++;
  await bridge.exchange();
  assert.equal(exchanges[3].snapshot.revision, 2);
  await bridge.dispose();
  const regressions = await Promise.allSettled([
    testPendingOpenCleanup(),
    testSlowWorkAndExpiry(),
    testRestartCommandIdCollision(),
    testExpiredCommand(),
  ]);
  regressions.forEach((result, i) => {
    if (result.status === 'rejected')
      console.error(`regression ${i + 1}: ${result.reason.message}`);
  });
  assert.ok(regressions.every(result => result.status === 'fulfilled'));
  console.log(
    'KTV browser bridge dedupe/retry/revision/lifecycle tests passed'
  );
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
