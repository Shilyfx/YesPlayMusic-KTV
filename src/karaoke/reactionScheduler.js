export const REACTION_DISPLAY_DURATION_MS = 4200;
export const REACTION_RETENTION_MS = 8000;
export const REACTION_MAX_WAIT_MS = 9000;
export const REACTION_MAX_QUEUE = 2;

export function stripPrivateReactionFields(item) {
  if (!item || typeof item !== 'object') return item;
  const copy = { ...item };
  delete copy.senderId;
  delete copy.extensionsUsed;
  return copy;
}

export function createReactionScheduler({
  now = () => Date.now(),
  displayDurationMs = REACTION_DISPLAY_DURATION_MS,
  retentionMs = REACTION_RETENTION_MS,
  maxWaitMs = REACTION_MAX_WAIT_MS,
  maxQueue = REACTION_MAX_QUEUE,
  maxHistory = 24,
} = {}) {
  let sequence = 0;
  let items = [];

  function advance(timestamp = now()) {
    items = items.filter(item => item.expiresAt > timestamp);

    const activeUser = items.find(
      item =>
        !item.automatic && item.status === 'active' && item.endsAt <= timestamp
    );
    if (activeUser) {
      activeUser.status = 'completed';
    }

    for (const item of items) {
      if (item.automatic) {
        if (item.endsAt <= timestamp && item.status === 'active') {
          item.status = 'completed';
        }
        continue;
      }
      if (item.status === 'queued') {
        if (
          item.latestStartAt &&
          timestamp > item.latestStartAt &&
          item.startAt > item.latestStartAt
        ) {
          item.status = 'expired';
          item.endsAt = timestamp;
          item.expiresAt = Math.min(item.expiresAt, timestamp + 1000);
        }
      }
    }

    let currentActive = items.find(
      item =>
        !item.automatic &&
        item.status === 'active' &&
        item.startAt <= timestamp &&
        item.endsAt > timestamp
    );

    const queuedList = items.filter(
      item => !item.automatic && item.status === 'queued'
    );

    if (!currentActive && queuedList.length > 0) {
      const next = queuedList.shift();
      if (next.startAt <= timestamp) {
        next.status = 'active';
        if (next.endsAt <= timestamp) {
          next.startAt = timestamp;
          next.endsAt = timestamp + displayDurationMs;
          next.expiresAt = Math.max(next.expiresAt, next.endsAt);
        }
        currentActive = next;
      }
    }

    let cursor = currentActive ? currentActive.endsAt : timestamp;
    for (const queued of queuedList) {
      if (queued.status !== 'queued') continue;
      queued.startAt = Math.max(timestamp, cursor);
      queued.endsAt = queued.startAt + displayDurationMs;
      queued.expiresAt = Math.max(queued.expiresAt, queued.endsAt + 400);
      cursor = queued.endsAt;
    }
  }

  function appendRecord(record) {
    items.push(record);
    if (items.length > maxHistory) {
      items.splice(0, items.length - maxHistory);
    }
    return record;
  }

  return {
    get items() {
      return items;
    },
    set items(next) {
      items = Array.isArray(next) ? next : [];
    },
    get sequence() {
      return sequence;
    },
    reset() {
      items = [];
    },
    scheduleAutomatic(kind, effect = 'bounce', detail = {}) {
      const timestamp = now();
      advance(timestamp);
      const record = {
        id: ++sequence,
        kind,
        effect,
        automatic: true,
        status: 'active',
        ...(detail.character ? { character: detail.character } : {}),
        ...(detail.itemId ? { itemId: detail.itemId } : {}),
        ...(detail.customText
          ? { customText: String(detail.customText).slice(0, 160) }
          : {}),
        createdAt: timestamp,
        startAt: timestamp,
        endsAt: timestamp + displayDurationMs,
        expiresAt: timestamp + retentionMs,
      };
      return stripPrivateReactionFields(appendRecord(record));
    },
    scheduleUser({
      senderId = '',
      itemId = '',
      kind,
      effect = 'bounce',
      character,
      emotionId,
      customText,
    }) {
      const timestamp = now();
      advance(timestamp);

      const senderKey = String(senderId || 'anonymous');
      const currentActive = items.find(
        item =>
          !item.automatic && item.status === 'active' && item.endsAt > timestamp
      );
      const queuedList = items.filter(
        item => !item.automatic && item.status === 'queued'
      );

      // Case 1: Same sender is currently active on stage
      if (currentActive && currentActive.senderId === senderKey) {
        const othersWaiting = queuedList.some(
          item => item.senderId !== senderKey
        );
        const prevExtensions = Number(currentActive.extensionsUsed || 0);
        const canExtend = !othersWaiting || prevExtensions < 1;
        const nextEndsAt = canExtend
          ? timestamp + displayDurationMs
          : Math.max(timestamp + 1200, currentActive.endsAt);

        const nextId = ++sequence;
        currentActive.status = 'replaced';
        currentActive.supersededBy = nextId;
        currentActive.endsAt = timestamp;

        const replacement = appendRecord({
          id: nextId,
          kind,
          effect,
          ...(character ? { character } : {}),
          ...(kind === 'emotion' ? { emotionId } : {}),
          ...(customText ? { customText } : {}),
          ...(itemId ? { itemId } : {}),
          senderId: senderKey,
          status: 'active',
          replacesId: currentActive.id,
          extensionsUsed: othersWaiting ? prevExtensions + 1 : 0,
          createdAt: timestamp,
          startAt: timestamp,
          endsAt: nextEndsAt,
          latestStartAt: timestamp + maxWaitMs,
          expiresAt: Math.max(timestamp + retentionMs, nextEndsAt + 400),
        });

        advance(timestamp);
        return {
          ok: true,
          status: 'replaced',
          queuePosition: 0,
          event: stripPrivateReactionFields(replacement),
        };
      }

      // Case 2: Same sender is already waiting in the queue
      const existingQueued = queuedList.find(
        item => item.senderId === senderKey
      );
      if (existingQueued) {
        const nextId = ++sequence;
        const slotStart = existingQueued.startAt;
        const slotEnd = existingQueued.endsAt;
        existingQueued.status = 'replaced';
        existingQueued.supersededBy = nextId;
        existingQueued.endsAt = timestamp;

        const replacement = appendRecord({
          id: nextId,
          kind,
          effect,
          ...(character ? { character } : {}),
          ...(kind === 'emotion' ? { emotionId } : {}),
          ...(customText ? { customText } : {}),
          ...(itemId ? { itemId } : {}),
          senderId: senderKey,
          status: 'queued',
          replacesId: existingQueued.id,
          extensionsUsed: 0,
          createdAt: timestamp,
          startAt: slotStart,
          endsAt: slotEnd,
          latestStartAt: timestamp + maxWaitMs,
          expiresAt: Math.max(timestamp + retentionMs, slotEnd + 400),
        });

        const updatedQueue = items.filter(
          item => !item.automatic && item.status === 'queued'
        );
        const queuePosition =
          updatedQueue.findIndex(item => item.id === replacement.id) + 1;
        return {
          ok: true,
          status: 'queued',
          queuePosition: Math.max(1, queuePosition),
          event: stripPrivateReactionFields(replacement),
        };
      }

      // Case 3: No user reaction is currently active
      if (!currentActive) {
        const nextEndsAt = timestamp + displayDurationMs;
        const record = appendRecord({
          id: ++sequence,
          kind,
          effect,
          ...(character ? { character } : {}),
          ...(kind === 'emotion' ? { emotionId } : {}),
          ...(customText ? { customText } : {}),
          ...(itemId ? { itemId } : {}),
          senderId: senderKey,
          status: 'active',
          extensionsUsed: 0,
          createdAt: timestamp,
          startAt: timestamp,
          endsAt: nextEndsAt,
          latestStartAt: timestamp + maxWaitMs,
          expiresAt: Math.max(timestamp + retentionMs, nextEndsAt),
        });
        return {
          ok: true,
          status: 'playing',
          queuePosition: 0,
          event: stripPrivateReactionFields(record),
        };
      }

      // Case 4: Another sender is active; check queue capacity
      if (queuedList.length >= maxQueue) {
        return {
          ok: false,
          code: 'REACTION_QUEUE_FULL',
          status: 'busy',
          queuePosition: queuedList.length,
        };
      }

      const lastEndsAt =
        queuedList.length > 0
          ? queuedList[queuedList.length - 1].endsAt
          : currentActive.endsAt;
      const startAt = Math.max(timestamp, lastEndsAt);
      const latestStartAt = timestamp + maxWaitMs;
      if (startAt > latestStartAt) {
        return {
          ok: false,
          code: 'REACTION_QUEUE_FULL',
          status: 'busy',
          queuePosition: queuedList.length,
        };
      }
      const endsAt = startAt + displayDurationMs;
      const record = appendRecord({
        id: ++sequence,
        kind,
        effect,
        ...(character ? { character } : {}),
        ...(kind === 'emotion' ? { emotionId } : {}),
        ...(customText ? { customText } : {}),
        ...(itemId ? { itemId } : {}),
        senderId: senderKey,
        status: 'queued',
        extensionsUsed: 0,
        createdAt: timestamp,
        startAt,
        endsAt,
        latestStartAt,
        expiresAt: Math.max(timestamp + retentionMs, endsAt + 400),
      });

      return {
        ok: true,
        status: 'queued',
        queuePosition: queuedList.length + 1,
        event: stripPrivateReactionFields(record),
      };
    },
    cancelSongReactions(previousItemId, reason = 'TRACK_CHANGED') {
      if (!previousItemId) return;
      const timestamp = now();
      for (const item of items) {
        if (item.automatic || item.itemId !== previousItemId) continue;
        if (item.status === 'queued' || item.status === 'active') {
          item.status = 'cancelled';
          item.cancelReason = reason;
          item.endsAt = timestamp;
        }
      }
      advance(timestamp);
    },
    recentPublic(timestamp = now()) {
      advance(timestamp);
      return items.map(stripPrivateReactionFields);
    },
  };
}
