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
    this.transitionPromise = null;
    this.transitionId = 0;
    this.playerAdapter.onEnded(() => this.handleTrackEnded());
    this.playerAdapter.onError(() => this.handlePlaybackError());
    this.playerAdapter.setCommandHandlers({
      next: () => this.next(),
      toggle: () => this.playOrPause(),
    });
  }

  get isSessionActive() {
    return this.session.status === KARAOKE_SESSION_STATUS.ACTIVE;
  }

  get ownsPlayback() {
    return this.isSessionActive && Boolean(this.queue.currentItem);
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
    this.transitionId += 1;
    this.playerAdapter.stop();
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

  moveQueueItemToFront(queueItemId) {
    if (!this.isSessionActive) return false;
    const moved = this.queue.moveToFront(queueItemId);
    if (moved) this.notify();
    return moved;
  }

  clearWaitingQueue() {
    if (!this.isSessionActive) return;
    this.queue.clearWaiting();
    this.notify();
  }

  async playQueueItem(queueItemId = null) {
    if (
      !this.isSessionActive ||
      this.queue.currentItem ||
      this.transitionPromise
    )
      return null;
    const item = this.queue.take(queueItemId);
    if (!item) {
      this.notify();
      return null;
    }
    this.notify();
    const transitionId = (this.transitionId += 1);
    const sessionId = this.session.sessionId;
    const loadingItemId = item.queueItemId;
    this.transitionPromise = Promise.resolve(
      this.playerAdapter.playTrack(item.trackId)
    );
    try {
      const result = await this.transitionPromise;
      if (
        transitionId !== this.transitionId ||
        !this.isSessionActive ||
        this.session.sessionId !== sessionId ||
        this.queue.currentItem?.queueItemId !== loadingItemId
      )
        return null;
      if (!result?.success) throw new Error('KTV track could not be played');
      this.queue.markCurrentPlaying();
      this.notify();
      return this.queue.currentItem;
    } catch (_) {
      this.queue.archiveCurrent(KARAOKE_ITEM_STATUS.FAILED);
      this.notify();
      return null;
    } finally {
      this.transitionPromise = null;
    }
  }

  startQueue() {
    return this.playQueueItem();
  }

  async next() {
    if (!this.isSessionActive) return null;
    if (this.transitionPromise) return this.transitionPromise;
    if (this.queue.currentItem) {
      this.queue.archiveCurrent(KARAOKE_ITEM_STATUS.SKIPPED);
      this.notify();
    }
    if (!this.queue.waitingItems.length) {
      this.playerAdapter.stop();
      return null;
    }
    return this.startQueue();
  }

  async handleTrackEnded() {
    if (!this.ownsPlayback || this.transitionPromise) return null;
    this.queue.archiveCurrent(KARAOKE_ITEM_STATUS.PLAYED);
    this.notify();
    return this.startQueue();
  }

  handlePlaybackError() {
    if (!this.ownsPlayback) return;
    this.queue.archiveCurrent(KARAOKE_ITEM_STATUS.FAILED);
    this.playerAdapter.stop();
    this.notify();
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
