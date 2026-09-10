const assert = require('assert');
require('./helpers/register-babel-src');

const KaraokeManager = require('../src/karaoke/KaraokeManager').default;

class FakePlayerAdapter {
  constructor() {
    this.playResults = [];
    this.calls = [];
  }

  playTrack(trackId) {
    this.calls.push(['play', trackId]);
    return Promise.resolve(this.playResults.shift() || { success: true });
  }

  replay() {
    this.calls.push(['replay']);
  }

  playOrPause() {
    this.calls.push(['toggle']);
  }

  stop() {
    this.calls.push(['stop']);
  }

  onEnded(listener) {
    this.ended = listener;
    return () => {};
  }

  onError(listener) {
    this.error = listener;
    return () => {};
  }

  setCommandHandlers(handlers) {
    this.handlers = handlers;
  }
}

const track = id => ({ id, name: `Track ${id}`, ar: [{ name: 'Artist' }] });

async function run() {
  const adapter = new FakePlayerAdapter();
  const manager = new KaraokeManager(adapter);
  assert.equal(adapter.handlers.isSessionActive(), false);
  manager.startSession();
  assert.equal(adapter.handlers.isSessionActive(), true);
  const first = manager.enqueueTrack(track(1));
  const duplicate = manager.enqueueTrack(track(1));
  const third = manager.enqueueTrack(track(3));
  assert.notStrictEqual(first.queueItemId, duplicate.queueItemId);
  assert.strictEqual(manager.moveQueueItemToFront(third.queueItemId), true);
  assert.strictEqual(
    manager.queue.waitingItems[0].queueItemId,
    third.queueItemId
  );
  assert.strictEqual(
    manager.removeQueueItem(duplicate.queueItemId).queueItemId,
    duplicate.queueItemId
  );

  await manager.startQueue();
  assert.strictEqual(manager.queue.currentItem.status, 'playing');
  assert.strictEqual(manager.replay(), true);
  assert.deepStrictEqual(adapter.calls.at(-1), ['replay']);

  await manager.handleTrackEnded();
  assert.strictEqual(manager.queue.currentItem.trackId, 1);
  await manager.next();
  assert.strictEqual(manager.queue.currentItem, null);
  assert.strictEqual(adapter.calls.at(-1)[0], 'stop');

  manager.enqueueTrack(track(4));
  adapter.playResults.push({ success: false });
  await manager.startQueue();
  assert.strictEqual(manager.queue.currentItem, null);
  assert.strictEqual(manager.queue.historyItems[0].status, 'failed');
  assert.strictEqual(
    adapter.calls.filter(call => call[0] === 'play').length,
    3
  );

  manager.enqueueTrack(track(5));
  const transition = manager.startQueue();
  assert.strictEqual(await manager.startQueue(), null);
  await transition;
  await manager.next();
  assert.strictEqual(manager.queue.currentItem, null);
  assert.strictEqual(adapter.calls.at(-1)[0], 'stop');

  manager.endSession();
  assert.equal(adapter.handlers.isSessionActive(), false);
  assert.strictEqual(manager.session.status, 'ended');
  assert.strictEqual(manager.queue.waitingItems.length, 0);

  const pendingAdapter = new FakePlayerAdapter();
  let resolvePending;
  pendingAdapter.playTrack = trackId => {
    pendingAdapter.calls.push(['play', trackId]);
    return new Promise(resolve => (resolvePending = resolve));
  };
  const pendingManager = new KaraokeManager(pendingAdapter);
  pendingManager.startSession();
  pendingManager.enqueueTrack(track(99));
  const loading = pendingManager.startQueue();
  pendingManager.endSession();
  resolvePending({ success: true });
  await loading;
  assert.strictEqual(pendingManager.session.status, 'ended');
  assert.strictEqual(pendingManager.queue.currentItem, null);

  const semanticAdapter = new FakePlayerAdapter();
  const semanticManager = new KaraokeManager(semanticAdapter);
  semanticManager.startSession();
  const guestFirst = semanticManager.enqueueTrack(track(11), {
    id: 'guest-1',
    name: '游客 1',
    type: 'guest',
  });
  await semanticManager.startQueue();
  assert.strictEqual(semanticManager.queue.currentItem.trackId, 11);
  assert.strictEqual(guestFirst.requesterType, 'guest');
  semanticManager.enqueueTrack(track(12), {
    id: 'guest-2',
    name: '游客 2',
    type: 'guest',
  });
  await semanticManager.next();
  assert.strictEqual(semanticManager.queue.currentItem.trackId, 12);
  assert.strictEqual(semanticManager.queue.historyItems[0].trackId, 11);
  assert.strictEqual(semanticManager.queue.historyItems[0].status, 'skipped');
  console.log('KTV domain transition tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
