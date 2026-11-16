const assert = require('assert');
require('./helpers/register-babel-src');

const KaraokeManager = require('../src/karaoke/KaraokeManager').default;
const {
  createKaraokeQueueRecovery,
  KARAOKE_QUEUE_RECOVERY_KEY,
  KARAOKE_QUEUE_RECOVERY_MAX_AGE_MS,
} = require('../src/karaoke/KaraokeQueueRecovery');
const { createKaraokeRuntime } = require('../src/karaoke/runtime');

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

class FakePlayerAdapter {
  constructor() {
    this.calls = [];
  }

  playTrack(track) {
    this.calls.push(['play', track.trackId]);
    return Promise.resolve({ success: true });
  }

  stop() {
    this.calls.push(['stop']);
  }

  replay() {
    this.calls.push(['replay']);
  }

  playOrPause() {
    this.calls.push(['toggle']);
  }

  onEnded() {
    return () => {};
  }

  onError() {
    return () => {};
  }

  setCommandHandlers() {}
}

const now = Date.now();
const session = {
  sessionId: 'local-ktv-restore-test',
  status: 'active',
  createdAt: new Date(now - 60_000).toISOString(),
  startedAt: new Date(now - 60_000).toISOString(),
  endedAt: null,
};
const waitingItem = (id, trackId = id) => ({
  queueItemId: id,
  trackId,
  trackName: `Track ${trackId}`,
  artists: ['Artist'],
  albumName: 'Album',
  coverUrl: '',
  durationMs: 180_000,
  requesterId: 'host',
  requesterName: '主机',
  requesterType: 'host',
  priorityRequested: false,
  requestedAt: new Date(now).toISOString(),
  status: 'queued',
});

async function run() {
  const backingStorage = new MemoryStorage();
  const recovery = createKaraokeQueueRecovery(backingStorage);
  recovery.save(session, [waitingItem('waiting-1')], now);
  const restored = recovery.load(now + 1);
  assert.strictEqual(restored.session.sessionId, session.sessionId);
  assert.strictEqual(restored.waitingItems[0].queueItemId, 'waiting-1');

  const managerAdapter = new FakePlayerAdapter();
  const manager = new KaraokeManager(managerAdapter, {
    recoveryStorage: recovery,
  });
  assert.strictEqual(manager.isSessionActive, true);
  assert.strictEqual(manager.session.sessionId, session.sessionId);
  assert.strictEqual(manager.queue.currentItem, null);
  assert.deepStrictEqual(
    manager.queue.waitingItems.map(item => item.queueItemId),
    ['waiting-1']
  );
  assert.deepStrictEqual(managerAdapter.calls, []);
  manager.endSession();
  assert.strictEqual(manager.isSessionActive, false);
  assert.strictEqual(manager.queue.waitingItems.length, 0);
  assert.strictEqual(backingStorage.getItem(KARAOKE_QUEUE_RECOVERY_KEY), null);

  const pageHideStorage = new MemoryStorage();
  const pageHideRecovery = createKaraokeQueueRecovery(pageHideStorage);
  const pageHideAdapter = new FakePlayerAdapter();
  let resolvePageHidePlayback;
  pageHideAdapter.playTrack = track => {
    pageHideAdapter.calls.push(['play', track.trackId]);
    return new Promise(resolve => {
      resolvePageHidePlayback = resolve;
    });
  };
  pageHideAdapter.stop = () => {
    pageHideAdapter.calls.push(['stop']);
    resolvePageHidePlayback?.({ success: false });
  };
  const pageHideManager = new KaraokeManager(pageHideAdapter, {
    recoveryStorage: pageHideRecovery,
  });
  pageHideManager.startSession();
  pageHideManager.enqueueTrack({ id: 61, name: 'Interrupted' });
  pageHideManager.enqueueTrack({ id: 62, name: 'Still waiting' });
  const pendingPlayback = pageHideManager.startQueue();
  pageHideManager.preserveRecoveryForPageHide();
  pageHideManager.endSession();
  await pendingPlayback;
  assert.strictEqual(pageHideManager.queue.currentItem, null);
  assert.deepStrictEqual(
    pageHideAdapter.calls.filter(call => call[0] === 'play'),
    [['play', 61]]
  );
  assert.deepStrictEqual(
    pageHideRecovery.load().waitingItems.map(item => item.trackId),
    [62]
  );

  const queueStorage = new MemoryStorage();
  const queueRecovery = createKaraokeQueueRecovery(queueStorage);
  const queueAdapter = new FakePlayerAdapter();
  const queueManager = new KaraokeManager(queueAdapter, {
    recoveryStorage: queueRecovery,
  });
  queueManager.startSession();
  queueManager.enqueueTrack({ id: 51, name: 'Current', ar: [] });
  queueManager.enqueueTrack({ id: 52, name: 'Waiting', ar: [] });
  await queueManager.startQueue();
  const afterReload = new KaraokeManager(new FakePlayerAdapter(), {
    recoveryStorage: queueRecovery,
  });
  assert.strictEqual(afterReload.queue.currentItem, null);
  assert.deepStrictEqual(
    afterReload.queue.waitingItems.map(item => item.trackId),
    [52]
  );

  const corruptStorage = new MemoryStorage();
  const corruptRecovery = createKaraokeQueueRecovery(corruptStorage);
  corruptRecovery.save(session, [waitingItem('bad-item')], now);
  const corruptPayload = JSON.parse(
    corruptStorage.getItem(KARAOKE_QUEUE_RECOVERY_KEY)
  );
  corruptPayload.waitingItems[0].trackId = {};
  corruptStorage.setItem(
    KARAOKE_QUEUE_RECOVERY_KEY,
    JSON.stringify(corruptPayload)
  );
  assert.strictEqual(corruptRecovery.load(now + 1), null);
  assert.strictEqual(corruptStorage.getItem(KARAOKE_QUEUE_RECOVERY_KEY), null);

  const expiredStorage = new MemoryStorage();
  const expiredRecovery = createKaraokeQueueRecovery(expiredStorage);
  expiredRecovery.save(session, [waitingItem('expired-item')], now);
  assert.strictEqual(
    expiredRecovery.load(now + KARAOKE_QUEUE_RECOVERY_MAX_AGE_MS + 1),
    null
  );
  assert.strictEqual(expiredStorage.getItem(KARAOKE_QUEUE_RECOVERY_KEY), null);

  const runtimeStorage = new MemoryStorage();
  const listeners = {};
  const previousWindow = global.window;
  global.window = {
    sessionStorage: runtimeStorage,
    addEventListener(name, listener) {
      listeners[name] = listener;
    },
  };
  try {
    const player = {
      setKaraokeCommandHandlers() {},
      stopKaraokePlayback() {},
      onPlaybackEnded() {
        return () => {};
      },
      onPlaybackError() {
        return () => {};
      },
    };
    const runtimeManager = createKaraokeRuntime(player, {
      commit() {},
    });
    runtimeManager.startSession();
    runtimeManager.enqueueTrack({ id: 77, name: 'Preserve on pagehide' });
    listeners.pagehide();
    runtimeManager.endSession();
    assert.notStrictEqual(
      runtimeStorage.getItem(KARAOKE_QUEUE_RECOVERY_KEY),
      null
    );
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }

  console.log('KTV manager queue recovery tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
