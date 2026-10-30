const assert = require('assert');
require('./helpers/register-babel-src');
const createWebRoomBridge = require('../src/karaoke/webRoomBridge').default;
const { sanitizeLyricDocument } = require('../src/karaoke/lyricDocument');
const { sanitizePresentation } = require('../src/karaoke/lyricDisplay');
const { REACTION_UI_REVISION } = require('../src/karaoke/reactions');
const {
  normalizeAppearanceConfig,
} = require('../src/karaoke/appearanceConfig');
const flush = () => new Promise(resolve => setImmediate(resolve));
const baseSnapshot = {
  revision: 1,
  session: { sessionId: 's', status: 'active' },
  currentItem: null,
  waitingItems: [],
  historyItems: [],
};

async function testAppearanceSnapshotUpload() {
  let appearance = normalizeAppearanceConfig({
    version: 1,
    mode: 'tilt',
    effect: 'gradient',
    fontSize: 45,
    offset: 0,
    theme: 'dark',
    animationIntensity: 'normal',
    background: {
      mode: 'legacy',
      tuning: {},
      assetId: null,
      transparent: false,
      opacity: 1,
    },
    tuningByMode: { tilt: { drift: 0.2 } },
    customTheme: null,
  });
  const presentation = { itemId: 'a', position: 1, playing: true };
  const calls = [];
  const bridge = createWebRoomBridge({
    manager: { getSnapshot: () => baseSnapshot },
    origin: 'http://router',
    getAppearance: () => appearance,
    getPresentation: () => presentation,
    execute: async () => {},
    request: async (action, body) => {
      calls.push({ action, body: JSON.parse(JSON.stringify(body)) });
      return action === 'open' ? { hostToken: 'host', room: {} } : {};
    },
    schedule: () => 1,
    cancel: () => {},
  });
  try {
    await bridge.invoke('karaoke:lan:start');
    assert.deepEqual(calls[0].body.appearance, appearance);
    await bridge.exchange();
    assert.ok(
      !Object.prototype.hasOwnProperty.call(calls[1].body, 'appearance'),
      'unchanged appearance is omitted from ordinary exchanges'
    );
    appearance = normalizeAppearanceConfig({
      ...appearance,
      background: { ...appearance.background, mode: 'common', opacity: 0.6 },
    });
    await bridge.exchange();
    assert.deepEqual(calls[2].body.appearance, appearance);
    assert.deepEqual(
      calls[2].body.presentation,
      presentation,
      'background-only changes do not mutate the rolling lyric presentation'
    );
    await bridge.exchange();
    assert.ok(
      !Object.prototype.hasOwnProperty.call(calls[3].body, 'appearance')
    );
  } finally {
    await bridge.dispose();
  }
}

async function testLyricDocumentTransport() {
  let state = { ...baseSnapshot, currentItem: { queueItemId: 'a' } };
  let scans = 0;
  let lyrics = {
    itemId: 'a',
    duration: 10,
    get lines() {
      scans++;
      return [{ time: 0, content: 'full song' }];
    },
  };
  const sent = [];
  let fail = false;
  const bridge = createWebRoomBridge({
    manager: { getSnapshot: () => state },
    origin: 'http://router',
    execute: async () => {},
    getPvLyrics: () => lyrics,
    schedule: () => 1,
    cancel: () => {},
    request: async (action, body) => {
      // Model the real transport, including serialization costs.
      sent.push({ action, body: JSON.parse(JSON.stringify(body)) });
      if (fail) {
        fail = false;
        throw new Error('lost lyrics reply');
      }
      return action === 'open'
        ? { hostToken: 'h', room: {} }
        : { commands: [] };
    },
  });
  await bridge.invoke('karaoke:lan:start');
  assert.equal(sent[0].body.uiRevision, REACTION_UI_REVISION);
  assert.equal(sent[0].body.pvLyrics.itemId, 'a');
  const initialScans = scans;
  await bridge.exchange();
  await bridge.exchange();
  assert.equal(
    scans,
    initialScans,
    'stable documents are never scanned on heartbeat'
  );
  assert.ok(!Object.prototype.hasOwnProperty.call(sent[1].body, 'pvLyrics'));
  lyrics = {
    itemId: 'a',
    duration: 10,
    lines: [{ time: 2, content: 'updated' }],
  };
  fail = true;
  await assert.rejects(bridge.exchange(), /lost lyrics reply/);
  await bridge.exchange();
  assert.deepEqual(sent[3].body.pvLyrics, sent[4].body.pvLyrics);
  await bridge.exchange();
  assert.ok(!Object.prototype.hasOwnProperty.call(sent[5].body, 'pvLyrics'));
  state = { ...state, revision: 2, currentItem: { queueItemId: 'b' } };
  await bridge.exchange();
  assert.equal(
    sent[6].body.pvLyrics,
    null,
    'late old-song callback cannot republish lyrics'
  );
  lyrics = { itemId: 'b', duration: 0, lines: [] };
  await bridge.exchange();
  assert.equal(sent[7].body.pvLyrics.itemId, 'b');
  await bridge.dispose();
  await bridge.invoke('karaoke:lan:start');
  assert.equal(
    sent[sent.length - 1].body.pvLyrics.itemId,
    'b',
    'new room sends document again'
  );
  await bridge.dispose();
}

async function testInvalidOptionalLyrics() {
  for (const kind of ['malformed', 'oversized', 'getter', 'callback']) {
    let scans = 0;
    let broken = true;
    let revision = 1;
    const invalid = {
      itemId: 'a',
      duration: 30,
      get lines() {
        scans++;
        if (kind === 'getter') throw new Error('local lyrics unavailable');
        return kind === 'oversized'
          ? Array.from({ length: 100 }, () => ({
              time: 0,
              content: '字'.repeat(3000),
            }))
          : [{ time: -1, content: 'invalid' }];
      },
    };
    const valid = {
      itemId: 'a',
      duration: 30,
      lines: [{ time: 0, content: 'recovered lyrics' }],
    };
    const presentation = {
      itemId: 'a',
      position: 1,
      playing: true,
      lines: [{ time: 0, content: 'classic presentation' }],
    };
    const sent = [];
    const executed = [];
    const command = { id: `guest-${kind}`, action: 'next' };
    const bridge = createWebRoomBridge({
      manager: {
        getSnapshot: () => ({
          ...baseSnapshot,
          revision,
          currentItem: { queueItemId: 'a' },
          waitingItems: [{ queueItemId: 'b' }],
        }),
      },
      origin: 'http://router',
      getPresentation: () => presentation,
      getPvLyrics: () => {
        if (broken && kind === 'callback') throw new Error('callback failed');
        return broken ? invalid : valid;
      },
      execute: async value => {
        executed.push(value);
        return 'guest command completed';
      },
      request: async (action, body) => {
        sent.push({ action, body: JSON.parse(JSON.stringify(body)) });
        return action === 'open'
          ? { hostToken: 'host', room: {} }
          : { commands: action === 'exchange' ? [command] : [] };
      },
      schedule: () => 1,
      cancel: () => {},
    });
    try {
      await bridge.invoke('karaoke:lan:start');
      assert.strictEqual(
        sent[0].body.pvLyrics,
        null,
        `${kind}: room still opens`
      );
      const initialScans = scans;
      await bridge.exchange();
      await flush();
      revision++;
      await bridge.exchange();
      assert.deepEqual(
        executed,
        [command],
        `${kind}: Guest command executes once`
      );
      const heartbeat = sent[sent.length - 1].body;
      assert.deepEqual(heartbeat.presentation, presentation);
      assert.equal(heartbeat.snapshot.revision, revision);
      assert.equal(heartbeat.snapshot.waitingItems[0].queueItemId, 'b');
      assert.ok(
        heartbeat.results.some(
          result => result.ok && result.result === 'guest command completed'
        )
      );
      assert.ok(!Object.prototype.hasOwnProperty.call(heartbeat, 'pvLyrics'));
      assert.equal(
        scans,
        initialScans,
        `${kind}: rejected source is not rescanned`
      );

      broken = false;
      await bridge.exchange();
      assert.deepEqual(
        sent[sent.length - 1].body.pvLyrics,
        valid,
        `${kind}: new valid document recovers`
      );
      await bridge.exchange();
      assert.ok(
        !Object.prototype.hasOwnProperty.call(
          sent[sent.length - 1].body,
          'pvLyrics'
        )
      );

      broken = true;
      await bridge.exchange();
      assert.strictEqual(
        sent[sent.length - 1].body.pvLyrics,
        null,
        `${kind}: failure clears the previous document`
      );
      const failedScans = scans;
      await bridge.exchange();
      assert.equal(scans, failedScans);
      broken = false;
      await bridge.exchange();
      assert.deepEqual(sent[sent.length - 1].body.pvLyrics, valid);
    } finally {
      await bridge.dispose();
    }
  }
}

async function testCombinedLyricPayloadBudget() {
  const maxBytes = 1024 * 1024;
  const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
  for (const oversizedOpen of [true, false]) {
    let scans = 0;
    let presentationReads = 0;
    const fullDocument = sanitizeLyricDocument({
      itemId: 'a',
      duration: 600,
      lines: Array.from({ length: 120 }, (_, time) => ({
        time,
        content: '歌'.repeat(2000),
      })),
    });
    const largeSource = {
      ...fullDocument,
      get lines() {
        scans++;
        return fullDocument.lines;
      },
    };
    const rolling = sanitizePresentation({
      itemId: 'a',
      position: 10,
      playing: true,
      lines: fullDocument.lines.slice(0, 32).map(line => ({
        ...line,
        content: '句'.repeat(1900),
      })),
    });
    const presentation = {
      ...rolling,
      get lines() {
        presentationReads++;
        return rolling.lines;
      },
    };
    let source = oversizedOpen
      ? largeSource
      : { itemId: 'a', duration: 600, lines: [] };
    let state = {
      ...baseSnapshot,
      currentItem: { queueItemId: 'a' },
      waitingItems: Array.from({ length: 200 }, (_, index) => ({
        queueItemId: `queued-${index}`,
        trackName: '排'.repeat(300),
      })),
    };
    assert.ok(
      bytes(fullDocument) < 768 * 1024,
      'full document is individually valid'
    );
    assert.ok(
      bytes(rolling) < 192 * 1024,
      'rolling presentation is individually valid'
    );
    assert.ok(
      bytes({
        snapshot: state,
        presentation: rolling,
        pvLyrics: fullDocument,
      }) > maxBytes
    );
    const sent = [];
    let executed = 0;
    const command = { id: 'budget-guest-command', action: 'next' };
    const bridge = createWebRoomBridge({
      manager: { getSnapshot: () => state },
      origin: 'http://router',
      getPvLyrics: () => source,
      getPresentation: () => presentation,
      execute: async () => {
        executed++;
        return 'guest-ok';
      },
      schedule: () => 1,
      cancel: () => {},
      request: async (action, body) => {
        const json = JSON.stringify(body);
        assert.ok(
          Buffer.byteLength(json, 'utf8') <= maxBytes,
          `${action}: request exceeds host body cap`
        );
        sent.push({ action, body: JSON.parse(json) });
        return action === 'open'
          ? { hostToken: 'budget-host', room: {} }
          : { commands: action === 'exchange' ? [command] : [] };
      },
    });
    try {
      await bridge.invoke('karaoke:lan:start');
      if (oversizedOpen) assert.strictEqual(sent[0].body.pvLyrics, null);
      assert.deepEqual(sent[0].body.snapshot, state);
      assert.deepEqual(sent[0].body.presentation, rolling);
      await bridge.exchange();
      await flush();
      source = largeSource;
      state = { ...state, revision: state.revision + 1 };
      await bridge.exchange();
      const deferred = sent[sent.length - 1].body;
      assert.strictEqual(
        deferred.pvLyrics,
        null,
        'oversized exchange defers only optional lyrics'
      );
      assert.deepEqual(deferred.snapshot, state);
      assert.deepEqual(deferred.presentation, rolling);
      assert.deepEqual(deferred.results, [
        { id: command.id, ok: true, result: 'guest-ok' },
      ]);
      assert.equal(executed, 1);
      assert.equal(
        scans,
        1,
        'the same source is sanitized once, including budget retries'
      );
      await bridge.exchange();
      const recovered = sent[sent.length - 1].body;
      assert.ok(!Object.prototype.hasOwnProperty.call(recovered, 'snapshot'));
      assert.deepEqual(
        recovered.pvLyrics,
        fullDocument,
        'same document retries when snapshot is omitted'
      );
      const previousReads = presentationReads;
      await bridge.exchange();
      assert.ok(
        !Object.prototype.hasOwnProperty.call(
          sent[sent.length - 1].body,
          'pvLyrics'
        )
      );
      assert.equal(scans, 1);
      assert.equal(
        presentationReads - previousReads,
        1,
        'normal heartbeat only serializes for transport, without a budget scan'
      );
    } finally {
      await bridge.dispose();
    }
  }
}

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
    testAppearanceSnapshotUpload(),
    testLyricDocumentTransport(),
    testInvalidOptionalLyrics(),
    testCombinedLyricPayloadBudget(),
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
