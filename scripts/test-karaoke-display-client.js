const assert = require('assert');
require('./helpers/register-babel-src');
const {
  projectPresentation,
  buildLyricWindow,
} = require('../src/karaoke/lyricDisplay');
const createWebRoomBridge = require('../src/karaoke/webRoomBridge').default;
const createDisplayPoller = require('../src/karaoke/displayPoller').default;
const flush = () => new Promise(resolve => setImmediate(resolve));

(async () => {
  const longLyrics = Array.from({ length: 2000 }, (_, index) => ({
    time: index * 3,
    content: String(index),
  }));
  assert.equal(
    buildLyricWindow(longLyrics, 3000, 0)[0].content,
    '999',
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
  console.log(
    'Display projection/host piggyback/single-flight/cancellation tests passed'
  );
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
