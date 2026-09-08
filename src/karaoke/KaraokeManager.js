import KaraokeQueue from './KaraokeQueue';
import KaraokeSession from './KaraokeSession';
import { KARAOKE_ITEM_STATUS, KARAOKE_SESSION_STATUS } from './constants';

const hostRequester = { id: 'host', name: '主机' };

export default class KaraokeManager {
  constructor(playerAdapter) {
    this.playerAdapter = playerAdapter;
    this.session = new KaraokeSession();
    this.queue = new KaraokeQueue();
    this.listeners = [];
  }

  get isSessionActive() {
    return this.session.status === KARAOKE_SESSION_STATUS.ACTIVE;
  }

  getSnapshot() {
    const clone = item =>
      item ? { ...item, artists: [...item.artists] } : null;
    return {
      session: this.session.toJSON(),
      currentItem: clone(this.queue.currentItem),
      waitingItems: this.queue.waitingItems.map(clone),
      historyItems: this.queue.historyItems.map(clone),
      queueCount: this.queue.waitingItems.length,
    };
  }

  subscribe(listener) {
    this.listeners.push(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners = this.listeners.filter(item => item !== listener);
    };
  }

  notify() {
    const snapshot = this.getSnapshot();
    this.listeners.forEach(listener => listener(snapshot));
  }

  startSession() {
    if (this.isSessionActive) return this.getSnapshot();
    this.queue = new KaraokeQueue();
    this.session = new KaraokeSession().start();
    this.notify();
    return this.getSnapshot();
  }

  endSession() {
    if (!this.isSessionActive) return this.getSnapshot();
    this.session.end();
    // Phase 2 intentionally keeps no recovery data after local session end.
    this.queue.reset();
    this.notify();
    return this.getSnapshot();
  }

  enqueueTrack(track, requester = hostRequester) {
    if (!this.isSessionActive || !track?.id) return null;
    const item = this.queue.enqueue(track, requester);
    this.notify();
    return item;
  }

  removeQueueItem(queueItemId) {
    if (!this.isSessionActive) return null;
    const item = this.queue.remove(queueItemId);
    if (item) this.notify();
    return item;
  }

  moveQueueItem(queueItemId, targetIndex) {
    if (!this.isSessionActive) return false;
    const moved = this.queue.move(queueItemId, targetIndex);
    if (moved) this.notify();
    return moved;
  }

  clearWaitingQueue() {
    if (!this.isSessionActive) return;
    this.queue.clearWaiting();
    this.notify();
  }

  playQueueItem(queueItemId = null) {
    if (!this.isSessionActive || this.queue.currentItem) return null;
    const item = this.queue.take(queueItemId);
    if (!item) {
      this.notify();
      return null;
    }
    this.notify();
    this.playerAdapter.playTrack(item.trackId);
    return item;
  }

  startQueue() {
    return this.playQueueItem();
  }

  next() {
    if (!this.isSessionActive) return null;
    this.queue.archiveCurrent(KARAOKE_ITEM_STATUS.SKIPPED);
    this.notify();
    return this.startQueue();
  }

  replay() {
    if (!this.isSessionActive || !this.queue.currentItem) return false;
    this.playerAdapter.replay();
    return true;
  }

  playOrPause() {
    if (!this.isSessionActive || !this.queue.currentItem) return false;
    this.playerAdapter.playOrPause();
    return true;
  }
}
