import { KARAOKE_ITEM_STATUS } from './constants';

let queueSequence = 0;

function toQueueItem(track, requester) {
  queueSequence += 1;
  return {
    queueItemId: `ktv-item-${Date.now()}-${queueSequence}`,
    trackId: track.id,
    trackName: track.name || '未知歌曲',
    artists: (track.ar || track.artists || []).map(artist => artist.name),
    albumName: track.al?.name || track.album?.name || '',
    coverUrl: track.al?.picUrl || track.album?.picUrl || '',
    durationMs: track.dt || track.duration || 0,
    requesterId: requester.id,
    requesterName: requester.name,
    requesterType: requester.type || 'host',
    priorityRequested: Boolean(requester.priorityRequested),
    requestedAt: new Date().toISOString(),
    status: KARAOKE_ITEM_STATUS.QUEUED,
  };
}

export default class KaraokeQueue {
  constructor() {
    this.currentItem = null;
    this.waitingItems = [];
    this.historyItems = [];
  }

  enqueue(track, requester) {
    const item = toQueueItem(track, requester);
    this.waitingItems.push(item);
    return item;
  }

  take(queueItemId = null) {
    const index = queueItemId
      ? this.waitingItems.findIndex(item => item.queueItemId === queueItemId)
      : 0;
    if (index < 0 || !this.waitingItems.length) return null;
    const [item] = this.waitingItems.splice(index, 1);
    item.status = KARAOKE_ITEM_STATUS.LOADING;
    this.currentItem = item;
    return item;
  }

  archiveCurrent(status) {
    if (!this.currentItem) return null;
    this.currentItem.status = status;
    this.historyItems.unshift(this.currentItem);
    const item = this.currentItem;
    this.currentItem = null;
    return item;
  }

  remove(queueItemId) {
    const index = this.waitingItems.findIndex(
      item => item.queueItemId === queueItemId
    );
    if (index < 0) return null;
    const [item] = this.waitingItems.splice(index, 1);
    item.status = KARAOKE_ITEM_STATUS.REMOVED;
    this.historyItems.unshift(item);
    return item;
  }

  move(queueItemId, targetIndex) {
    const index = this.waitingItems.findIndex(
      item => item.queueItemId === queueItemId
    );
    if (index < 0) return false;
    const target = Math.min(
      this.waitingItems.length - 1,
      Math.max(0, targetIndex)
    );
    if (index === target) return false;
    const [item] = this.waitingItems.splice(index, 1);
    this.waitingItems.splice(target, 0, item);
    return true;
  }

  moveToFront(queueItemId) {
    return this.move(queueItemId, 0);
  }

  markCurrentPlaying() {
    if (!this.currentItem) return null;
    this.currentItem.status = KARAOKE_ITEM_STATUS.PLAYING;
    return this.currentItem;
  }

  clearWaiting() {
    this.waitingItems.forEach(item => {
      item.status = KARAOKE_ITEM_STATUS.REMOVED;
      this.historyItems.unshift(item);
    });
    this.waitingItems = [];
  }

  reset() {
    this.currentItem = null;
    this.waitingItems = [];
    this.historyItems = [];
  }
}
