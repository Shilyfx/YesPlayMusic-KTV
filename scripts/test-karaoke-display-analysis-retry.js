const assert = require('assert');
require('./helpers/register-babel-src');
const createDisplayPoller = require('../src/karaoke/displayPoller').default;

const flush = () => new Promise(resolve => setImmediate(resolve));
const validTimeline = trackKey => ({
  trackKey,
  audioHash: 'a'.repeat(64),
  modelVersions: {
    beat_this: 'b'.repeat(64),
    htdemucs: 'c'.repeat(64),
  },
  duration: 10,
  beats: { source: 'beat_this', times: [1, 2], downbeats: [1] },
  drums: null,
});

async function testTransientFailureRetriesTheSameKeyWithBackoff() {
  let now = 5000;
  let state = {
    active: true,
    generation: 1,
    smartBeatRevision: 4,
    smartBeatTrackKey: 'room-a:track-a',
  };
  const requests = [];
  const errors = [];
  const updates = [];
  let scheduled = 0;
  const poller = createDisplayPoller({
    request: async () => ({ ...state }),
    requestAnalysis: (key, signal) =>
      new Promise((resolve, reject) =>
        requests.push({ key, signal, resolve, reject })
      ),
    onState: value => updates.push(value),
    onSmartBeatError: error => errors.push(error),
    schedule: () => ++scheduled,
    cancel: () => {},
    now: () => now,
  });

  poller.start();
  await flush();
  assert.equal(requests.length, 1);
  const unavailable = Object.assign(new Error('temporary server failure'), {
    status: 503,
  });
  requests[0].reject(unavailable);
  await flush();
  await flush();
  assert.strictEqual(errors[0], unavailable);
  assert.equal(
    scheduled,
    1,
    'analysis retry waits for the existing display heartbeat instead of owning a new timer'
  );

  now = 5999;
  await poller.refresh();
  await flush();
  assert.equal(requests.length, 1, 'retry waits for the backoff deadline');
  now = 6000;
  await poller.refresh();
  await flush();
  assert.equal(requests.length, 2, 'the same generation and revision retry');
  await poller.refresh();
  await flush();
  assert.equal(requests.length, 2, 'same-key retries remain single flight');

  requests[1].resolve({
    generation: 1,
    revision: 4,
    timeline: validTimeline('room-a:track-a'),
  });
  await flush();
  await poller.refresh();
  assert.equal(requests.length, 2, 'successful retry is cached for this key');
  assert.equal(
    updates[updates.length - 1].smartBeatTimeline.trackKey,
    'room-a:track-a',
    'the recovered timeline is published to the follower'
  );

  state = { ...state, smartBeatRevision: 5 };
  await poller.refresh();
  await flush();
  assert.equal(requests.length, 3);
  state = {
    ...state,
    generation: 2,
    smartBeatRevision: 1,
    smartBeatTrackKey: 'room-b:track-b',
  };
  await poller.refresh();
  await flush();
  assert.equal(
    requests.length,
    4,
    'a new generation starts without old backoff'
  );
  assert.equal(requests[2].signal.aborted, true);
  const updateCount = updates.length;
  requests[2].resolve({
    generation: 1,
    revision: 5,
    timeline: validTimeline('room-a:track-a'),
  });
  await flush();
  assert.equal(
    updates.length,
    updateCount,
    'late completion is ignored after a generation change'
  );
  requests[3].resolve({
    generation: 2,
    revision: 1,
    timeline: validTimeline('room-b:track-b'),
  });
  await flush();
  assert.equal(
    updates[updates.length - 1].smartBeatTimeline.trackKey,
    'room-b:track-b'
  );
  poller.stop();
}

async function testTimeoutRetriesBut404IsTerminal() {
  let now = 0;
  let state = {
    active: true,
    generation: 3,
    smartBeatRevision: 2,
    smartBeatTrackKey: 'room-c:track-c',
  };
  const timeoutRequests = [];
  const timeoutErrors = [];
  const timeoutUpdates = [];
  const originalSetTimeout = global.setTimeout;
  let analysisTimeout;
  global.setTimeout = (callback, delay, ...args) => {
    if (delay === 15000) {
      analysisTimeout = () => callback(...args);
      return 424242;
    }
    return originalSetTimeout(callback, delay, ...args);
  };
  const timedOut = createDisplayPoller({
    request: async () => ({ ...state }),
    requestAnalysis: (key, signal) =>
      new Promise((resolve, reject) => {
        timeoutRequests.push({ key, signal, resolve, reject });
      }),
    onState: value => timeoutUpdates.push(value),
    onSmartBeatError: error => timeoutErrors.push(error),
    schedule: () => 1,
    cancel: () => {},
    now: () => now,
  });
  try {
    timedOut.start();
    await flush();
    assert.equal(timeoutRequests.length, 1);
    assert.ok(analysisTimeout, 'analysis request owns its bounded timeout');
    analysisTimeout();
    timeoutRequests[0].resolve({
      generation: 3,
      revision: 2,
      timeline: validTimeline('room-c:track-c'),
    });
    await flush();
    await flush();
    assert.equal(timeoutRequests[0].signal.aborted, true);
    assert.equal(timeoutErrors[0]?.code, 'DISPLAY_ANALYSIS_TIMEOUT');
    assert.equal(
      timeoutUpdates[timeoutUpdates.length - 1].smartBeatTimeline,
      null,
      'a transport that resolves after timeout cannot publish its late timeline'
    );
    await timedOut.refresh();
    await flush();
    assert.equal(timeoutRequests.length, 1, 'timeout is subject to backoff');
    now = 1000;
    await timedOut.refresh();
    await flush();
    assert.equal(
      timeoutRequests.length,
      2,
      'timeout retries on a later heartbeat'
    );
  } finally {
    timedOut.stop();
    global.setTimeout = originalSetTimeout;
  }

  const notFoundRequests = [];
  const notFoundErrors = [];
  const originalFetch = global.fetch;
  global.fetch = async url => {
    notFoundRequests.push(url);
    return { ok: false, status: 404 };
  };
  const terminal = createDisplayPoller({
    request: async () => ({ ...state }),
    onState: () => {},
    onSmartBeatError: error => notFoundErrors.push(error),
    schedule: () => 1,
    cancel: () => {},
    now: () => now,
  });
  try {
    terminal.start();
    await flush();
    await flush();
    await terminal.refresh();
    await flush();
    assert.equal(notFoundErrors[0]?.status, 404);
    assert.match(
      notFoundRequests[0],
      /\/ktv\/display\/analysis\?generation=3&revision=2/
    );
    assert.equal(
      notFoundRequests.length,
      1,
      '404 is terminal for the current analysis revision'
    );
  } finally {
    terminal.stop();
    global.fetch = originalFetch;
  }
}

async function testBackoffDelayIsCapped() {
  let now = 0;
  const requests = [];
  const poller = createDisplayPoller({
    request: async () => ({
      active: true,
      generation: 9,
      smartBeatRevision: 1,
      smartBeatTrackKey: 'room-cap:track-cap',
    }),
    requestAnalysis: (key, signal) =>
      new Promise((resolve, reject) => requests.push({ signal, reject })),
    onState: () => {},
    onSmartBeatError: () => {},
    schedule: () => 1,
    cancel: () => {},
    now: () => now,
  });
  poller.start();
  await flush();
  const expectedDelays = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
  for (let index = 0; index < expectedDelays.length; index += 1) {
    requests[index].reject(
      Object.assign(new Error('temporary network failure'), { status: 503 })
    );
    await flush();
    await flush();
    now += expectedDelays[index] - 1;
    await poller.refresh();
    await flush();
    assert.equal(
      requests.length,
      index + 1,
      `attempt ${index + 2} waits through its backoff interval`
    );
    now += 1;
    await poller.refresh();
    await flush();
    assert.equal(requests.length, index + 2);
  }
  poller.stop();
}

(async () => {
  await testTransientFailureRetriesTheSameKeyWithBackoff();
  await testTimeoutRetriesBut404IsTerminal();
  await testBackoffDelayIsCapped();
  console.log(
    'Follower SmartBeat retry, timeout, terminal status, and generation checks passed'
  );
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
