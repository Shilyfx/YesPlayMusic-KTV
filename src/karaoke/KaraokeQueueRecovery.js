const RECOVERY_VERSION = 1;
const MAX_QUEUE_ITEMS = 500;
const MAX_FUTURE_SKEW_MS = 60 * 1000;
export const KARAOKE_QUEUE_RECOVERY_KEY = 'yesplaymusic-ktv-queue-recovery';
export const KARAOKE_QUEUE_RECOVERY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isText(value, allowEmpty = true) {
  return (
    typeof value === 'string' &&
    (allowEmpty || Boolean(value.trim())) &&
    value.length <= 4096
  );
}

function isValidDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function normalizeSession(value, now) {
  if (
    !isRecord(value) ||
    value.status !== 'active' ||
    !isText(value.sessionId, false) ||
    !isValidDate(value.createdAt) ||
    !isValidDate(value.startedAt) ||
    value.endedAt !== null
  )
    return null;

  if (Date.parse(value.startedAt) > now + MAX_FUTURE_SKEW_MS) return null;

  return {
    sessionId: value.sessionId,
    status: value.status,
    createdAt: value.createdAt,
    startedAt: value.startedAt,
    endedAt: null,
  };
}

function normalizeWaitingItem(value) {
  if (
    !isRecord(value) ||
    !isText(value.queueItemId, false) ||
    !(
      (typeof value.trackId === 'string' && value.trackId.trim()) ||
      (typeof value.trackId === 'number' && Number.isFinite(value.trackId))
    ) ||
    !isText(value.trackName) ||
    !Array.isArray(value.artists) ||
    !value.artists.every(artist => isText(artist)) ||
    !isText(value.albumName) ||
    !isText(value.coverUrl) ||
    !Number.isFinite(value.durationMs) ||
    value.durationMs < 0 ||
    !isText(value.requesterId, false) ||
    !isText(value.requesterName) ||
    !isText(value.requesterType, false) ||
    typeof value.priorityRequested !== 'boolean' ||
    !isValidDate(value.requestedAt) ||
    value.status !== 'queued'
  )
    return null;

  const item = {
    queueItemId: value.queueItemId,
    trackId: value.trackId,
    trackName: value.trackName,
    artists: value.artists.slice(),
    albumName: value.albumName,
    coverUrl: value.coverUrl,
    durationMs: value.durationMs,
    requesterId: value.requesterId,
    requesterName: value.requesterName,
    requesterType: value.requesterType,
    priorityRequested: value.priorityRequested,
    requestedAt: value.requestedAt,
    status: 'queued',
  };

  if (value.source !== undefined) {
    if (
      value.source !== 'local' ||
      !isText(value.localId, false) ||
      !Array.isArray(value.lyrics) ||
      !value.lyrics.every(isRecord)
    )
      return null;
    item.source = 'local';
    item.localId = value.localId;
    item.lyrics = value.lyrics.map(line => ({ ...line }));
  } else if (value.localId !== undefined || value.lyrics !== undefined) {
    return null;
  }

  return item;
}

function normalizeSnapshot(value, now) {
  if (
    !isRecord(value) ||
    value.version !== RECOVERY_VERSION ||
    !Number.isFinite(value.savedAt) ||
    value.savedAt > now + MAX_FUTURE_SKEW_MS ||
    now - value.savedAt > KARAOKE_QUEUE_RECOVERY_MAX_AGE_MS ||
    !Array.isArray(value.waitingItems) ||
    value.waitingItems.length > MAX_QUEUE_ITEMS
  )
    return null;

  const session = normalizeSession(value.session, now);
  if (!session) return null;

  const waitingItems = value.waitingItems.map(normalizeWaitingItem);
  if (waitingItems.some(item => !item)) return null;
  const ids = new Set(waitingItems.map(item => item.queueItemId));
  if (ids.size !== waitingItems.length) return null;

  return { session, waitingItems, savedAt: value.savedAt };
}

export function createKaraokeQueueRecovery(storage) {
  return {
    load(now = Date.now()) {
      if (!storage || typeof storage.getItem !== 'function') return null;
      let raw;
      try {
        raw = storage.getItem(KARAOKE_QUEUE_RECOVERY_KEY);
      } catch (_) {
        return null;
      }
      if (!raw) return null;

      let snapshot;
      try {
        snapshot = JSON.parse(raw);
      } catch (_) {
        this.clear();
        return null;
      }

      const normalized = normalizeSnapshot(snapshot, now);
      if (!normalized) this.clear();
      return normalized;
    },

    save(session, waitingItems, now = Date.now()) {
      if (!storage || typeof storage.setItem !== 'function') return false;
      const snapshot = normalizeSnapshot(
        {
          version: RECOVERY_VERSION,
          savedAt: now,
          session,
          waitingItems,
        },
        now
      );
      if (!snapshot) return false;
      try {
        storage.setItem(
          KARAOKE_QUEUE_RECOVERY_KEY,
          JSON.stringify({ version: RECOVERY_VERSION, ...snapshot })
        );
        return true;
      } catch (_) {
        return false;
      }
    },

    clear() {
      if (!storage || typeof storage.removeItem !== 'function') return;
      try {
        storage.removeItem(KARAOKE_QUEUE_RECOVERY_KEY);
      } catch (_) {
        // Recovery is best effort and must not interrupt KTV playback.
      }
    },
  };
}
