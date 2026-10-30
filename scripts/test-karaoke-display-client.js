const assert = require('assert');
require('./helpers/register-babel-src');
const {
  projectPresentation,
  buildLyricWindow,
} = require('../src/karaoke/lyricDisplay');
const createWebRoomBridge = require('../src/karaoke/webRoomBridge').default;
const createDisplayPoller = require('../src/karaoke/displayPoller').default;
const flush = () => new Promise(resolve => setImmediate(resolve));

async function testLyricFetchOwner() {
  let state = {
    active: true,
    generation: 1,
    pvLyricsRevision: 1,
    pvLyricsItemId: 'a',
    presentation: { itemId: 'a' },
  };
  const updates = [];
  const requests = [];
  let failures = 0;
  const poller = createDisplayPoller({
    request: async () => ({ ...state }),
    requestLyrics: (key, signal) =>
      new Promise((resolve, reject) =>
        requests.push({ key, signal, resolve, reject })
      ),
    onState: value => updates.push(value),
    onError: () => failures++,
    schedule: () => 1,
    cancel: () => {},
  });
  const document = (itemId, revision) => ({
    itemId,
    revision,
    duration: 10,
    lines: [{ time: 0, content: itemId }],
  });
  poller.start();
  await flush();
  assert.equal(requests.length, 1);
  await poller.refresh();
  await poller.refresh();
  assert.equal(
    requests.length,
    1,
    'slow lyric fetch remains single flight across state polls'
  );
  requests[0].resolve(document('a', 1));
  await flush();
  const held = updates[updates.length - 1].pvLyrics;
  assert.equal(held.itemId, 'a');
  await poller.refresh();
  assert.strictEqual(
    updates[updates.length - 1].pvLyrics,
    held,
    'heartbeat preserves exact document reference'
  );
  assert.equal(requests.length, 1);
  state = { ...state, pvLyricsRevision: 2 };
  await poller.refresh();
  assert.equal(updates[updates.length - 1].pvLyrics, null);
  requests[1].reject(new Error('temporary lyrics failure'));
  await flush();
  assert.equal(failures, 1);
  await poller.refresh();
  assert.equal(
    requests.length,
    3,
    'next state heartbeat retries failed revision'
  );
  state = {
    ...state,
    pvLyricsRevision: 3,
    pvLyricsItemId: 'b',
    presentation: { itemId: 'b' },
  };
  await poller.refresh();
  assert.ok(requests[2].signal.aborted);
  const count = updates.length;
  requests[2].resolve(document('a', 2));
  await flush();
  assert.equal(updates.length, count, 'old song completion cannot publish');
  requests[3].resolve(document('b', 3));
  await flush();
  assert.equal(updates[updates.length - 1].pvLyrics.itemId, 'b');
  state = {
    ...state,
    generation: 2,
    pvLyricsRevision: 1,
    pvLyricsItemId: 'a',
    presentation: { itemId: 'a' },
  };
  await poller.refresh();
  assert.equal(
    updates[updates.length - 1].pvLyrics,
    null,
    'new room cannot retain previous document'
  );
  assert.equal(requests[4].key.generation, 2);
  poller.stop();
  assert.ok(requests[4].signal.aborted);
  const stoppedCount = updates.length;
  requests[4].resolve(document('a', 1));
  await flush();
  assert.equal(
    updates.length,
    stoppedCount,
    'stopped viewer ignores late lyric response'
  );
  poller.start();
  await flush();
  assert.equal(
    requests.length,
    6,
    'restarting fetches again even for same server revision'
  );
  state = { active: false };
  await poller.refresh();
  assert.ok(requests[5].signal.aborted);
  const inactiveCount = updates.length;
  requests[5].resolve(document('a', 1));
  await flush();
  assert.equal(updates.length, inactiveCount);
  assert.equal(updates[updates.length - 1].pvLyrics, null);
  poller.stop();

  // The same revision/item can exist in another room. A transport ignoring
  // AbortSignal must still be unable to attach the previous room's document.
  state = {
    active: true,
    generation: 10,
    pvLyricsRevision: 1,
    pvLyricsItemId: 'a',
  };
  poller.start();
  await flush();
  const oldRoom = requests[requests.length - 1];
  state = { ...state, generation: 11 };
  await poller.refresh();
  const newRoom = requests[requests.length - 1];
  assert.ok(oldRoom.signal.aborted);
  const roomCount = updates.length;
  oldRoom.resolve(document('a', 1));
  await flush();
  assert.equal(updates.length, roomCount);
  newRoom.resolve(document('a', 99));
  await flush();
  assert.equal(
    updates[updates.length - 1].pvLyrics,
    null,
    'wrong response revision is rejected'
  );
  const beforeRetry = requests.length;
  await poller.refresh();
  assert.equal(requests.length, beforeRetry + 1);
  requests[requests.length - 1].resolve(document('a', 1));
  await flush();
  assert.equal(updates[updates.length - 1].pvLyrics.revision, 1);
  poller.stop();
}

async function testAppearanceFetchOwner() {
  let state = {
    active: true,
    generation: 1,
    appearanceRevision: 1,
    presentation: { itemId: 'a' },
  };
  const appearanceRequests = [];
  const appearances = [];
  const states = [];
  const poller = createDisplayPoller({
    request: async () => ({ ...state }),
    requestAppearance: (identity, signal) =>
      new Promise((resolve, reject) =>
        appearanceRequests.push({ identity, signal, resolve, reject })
      ),
    onState: value => states.push(value),
    onAppearance: value => {
      if (value) appearances.push(value);
    },
    onError: error => {
      throw error;
    },
    schedule: () => 1,
    cancel: () => {},
  });
  const config = (mode, drift = 0) => ({
    mode: 'tilt',
    background: { mode, tuning: { drift } },
  });
  poller.start();
  await flush();
  assert.equal(appearanceRequests.length, 1);
  assert.deepEqual(appearanceRequests[0].identity, {
    generation: 1,
    revision: 1,
  });
  assert.ok(
    states.every(
      value => !Object.prototype.hasOwnProperty.call(value, 'appearance')
    ),
    'frequent display state only carries the appearance revision metadata'
  );
  await poller.refresh();
  await poller.refresh();
  assert.equal(
    appearanceRequests.length,
    1,
    'same appearance revision shares one in-flight fetch'
  );
  appearanceRequests[0].resolve({
    generation: 1,
    revision: 1,
    config: config('legacy'),
  });
  await flush();
  await poller.refresh();
  assert.equal(
    appearanceRequests.length,
    1,
    'same revision uses cached config'
  );

  state = { ...state, appearanceRevision: 2 };
  await poller.refresh();
  assert.equal(appearanceRequests.length, 2);
  appearanceRequests[1].resolve({
    generation: 1,
    revision: 2,
    config: config('common', 0.4),
  });
  await flush();
  assert.equal(appearances[1].config.background.mode, 'common');

  state = { ...state, generation: 2, appearanceRevision: 1 };
  await poller.refresh();
  assert.equal(appearanceRequests.length, 3);
  state = { ...state, generation: 3, appearanceRevision: 1 };
  await poller.refresh();
  assert.ok(appearanceRequests[2].signal.aborted);
  assert.equal(appearanceRequests.length, 4);
  appearanceRequests[2].resolve({
    generation: 2,
    revision: 1,
    config: config('common', 9),
  });
  appearanceRequests[3].resolve({
    generation: 3,
    revision: 1,
    config: config('legacy', 0.8),
  });
  await flush();
  assert.deepEqual(
    appearances.map(value => value.generation),
    [1, 1, 3],
    'late response from a reset room cannot replace the current appearance'
  );
  state = { ...state, appearanceRevision: 2 };
  await poller.refresh();
  assert.equal(appearanceRequests.length, 5);
  poller.stop();
  assert.ok(appearanceRequests[4].signal.aborted);
  const appliedCount = appearances.length;
  appearanceRequests[4].resolve({
    generation: 3,
    revision: 2,
    config: config('common', 0.9),
  });
  await flush();
  assert.equal(
    appearances.length,
    appliedCount,
    'a stopped display cannot apply a late appearance response'
  );
  poller.start();
  await flush();
  assert.equal(appearanceRequests.length, 6);
  appearanceRequests[5].resolve({
    generation: 3,
    revision: 2,
    config: config('common', 0.9),
  });
  await flush();
  assert.equal(appearances.length, appliedCount + 1);
  state = { active: false };
  await poller.refresh();
  assert.equal(appearances[appearances.length - 1].revision, 2);
  poller.stop();
}

async function testDisplayRetryBackoff() {
  let fail = true;
  let errors = 0;
  const scheduled = [];
  const poller = createDisplayPoller({
    request: () => {
      if (fail) throw new Error('temporary network failure');
      return { active: false };
    },
    onState: () => {},
    onError: () => errors++,
    schedule: (fn, delay) => {
      scheduled.push({ fn, delay });
      return scheduled.length;
    },
    cancel: () => {},
  });

  poller.start();
  await flush();
  for (let index = 0; index < 4; index += 1) {
    scheduled[index].fn();
    await flush();
  }
  fail = false;
  scheduled[4].fn();
  await flush();

  console.log(
    `Display retry delays: ${JSON.stringify(scheduled.map(item => item.delay))}`
  );
  assert.deepEqual(
    scheduled.map(item => item.delay),
    [1000, 2000, 4000, 8000, 8000, 500],
    'failed status polling backs off to a cap and returns to 500ms after recovery'
  );
  assert.equal(errors, 5);
  poller.stop();
}

(async () => {
  const longLyrics = Array.from({ length: 2000 }, (_, index) => ({
    time: index * 3,
    content: String(index),
  }));
  assert.equal(
    buildLyricWindow(longLyrics, 3000, 0)[0].content,
    '994',
    'hidden master window follows audio clock, not stale UI cursor'
  );
  assert.equal(buildLyricWindow(longLyrics, 3000, 0).length, 16);
  const presentation = {
    itemId: 'a',
    position: 1,
    playing: true,
    lines: [
      { time: 0, content: '一' },
      { time: 2, content: '二' },
      { time: 4, content: '三' },
      { time: 8, content: '四' },
    ],
  };
  assert.equal(projectPresentation(presentation, 1.1).active, '二');
  const predicted = projectPresentation(
    { ...presentation, position: 3.8 },
    0.3
  );
  const refreshed = projectPresentation(
    { ...presentation, position: 4.2, lines: presentation.lines.slice(1) },
    0
  );
  assert.equal(predicted.active, '三');
  assert.equal(refreshed.active, '三');
  assert.equal(
    predicted.cueKey,
    refreshed.cueKey,
    'rebasing a synchronized lyric window must not recreate the same active line or restart its animation'
  );
  assert.notEqual(
    refreshed.cueKey,
    projectPresentation({ ...presentation, itemId: 'other', position: 4.2 }, 0)
      .cueKey
  );
  assert.notEqual(
    refreshed.cueKey,
    projectPresentation({ ...presentation, position: 8.2 }, 0).cueKey,
    'real cue changes must retain entrance animation'
  );
  assert.equal(
    projectPresentation({ ...presentation, playing: false }, 10).active,
    '一'
  );
  assert.equal(
    projectPresentation(presentation, 100).active,
    '三',
    'extrapolation bounded at 3 seconds'
  );
  assert.equal(
    projectPresentation({ ...presentation, position: 0 }, 0).active,
    '一',
    'seek is not forced monotonic'
  );
  const bodies = [];
  const bridge = createWebRoomBridge({
    manager: {
      getSnapshot: () => ({
        revision: 1,
        currentItem: null,
        waitingItems: [],
        historyItems: [],
      }),
    },
    execute: async () => {},
    origin: 'http://router',
    hostName: '客厅',
    getPresentation: () => presentation,
    schedule: () => 1,
    cancel: () => {},
    request: async (action, body) => {
      bodies.push({ action, body });
      return action === 'open'
        ? { hostToken: 'h', room: {} }
        : { commands: [] };
    },
  });
  await bridge.invoke('karaoke:lan:start');
  assert.equal(bodies[0].body.hostName, '客厅');
  assert.deepEqual(bodies[0].body.presentation, presentation);
  await bridge.exchange();
  assert.deepEqual(bodies[1].body.presentation, presentation);
  await bridge.dispose();
  let resolveRequest;
  let calls = 0;
  let updates = 0;
  const scheduled = [];
  const poller = createDisplayPoller({
    request: () => {
      calls++;
      return new Promise(resolve => {
        resolveRequest = resolve;
      });
    },
    onState: () => updates++,
    schedule: fn => {
      scheduled.push(fn);
      return scheduled.length;
    },
    cancel: () => {},
  });
  poller.start();
  poller.start();
  poller.refresh();
  assert.equal(calls, 1, 'one request owner and single flight');
  resolveRequest({ active: true });
  await flush();
  assert.equal(updates, 1);
  assert.equal(scheduled.length, 1);
  scheduled[0]();
  assert.equal(calls, 2);
  poller.stop();
  resolveRequest({ active: true });
  await flush();
  assert.equal(updates, 1, 'closed viewer ignores late responses');
  assert.equal(
    scheduled.length,
    1,
    'closed viewer does not schedule another poll'
  );
  let failures = 0;
  const retryTimers = [];
  const failing = createDisplayPoller({
    request: () => {
      throw new Error('synchronous failure');
    },
    onState: () => {},
    onError: () => failures++,
    schedule: fn => {
      retryTimers.push(fn);
      return 1;
    },
    cancel: () => {},
  });
  failing.start();
  await flush();
  assert.equal(
    retryTimers.length,
    1,
    'synchronous failures must still schedule recovery'
  );
  retryTimers[0]();
  await flush();
  assert.equal(failures, 2);
  failing.stop();
  await testLyricFetchOwner();
  await testAppearanceFetchOwner();
  await testDisplayRetryBackoff();
  console.log(
    'Display projection/host piggyback/single-flight/cancellation tests passed'
  );
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
