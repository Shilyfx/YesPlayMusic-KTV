import crypto from 'crypto';

export const CLIENT_TTL = 5 * 60 * 60 * 1000;
export const RATE_LIMIT_WINDOW_MS = 10 * 1000;

// Keep client tokens compatible with the Node.js runtime bundled by Electron
// 13, where Buffer.toString('base64url') is not available.
const toBase64Url = value =>
  value
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
const token = () => toBase64Url(crypto.randomBytes(32));
const clientId = () => `guest-${crypto.randomBytes(6).toString('hex')}`;

export class RemoteClientSessionStore {
  constructor() {
    this.room = null;
    this.clients = new Map();
  }

  start(room) {
    this.room = {
      code: room.code,
      sessionId: room.sessionId,
      generation: room.generation,
      joinToken: room.token,
    };
    this.clients.clear();
  }

  stop() {
    this.room = null;
    this.clients.clear();
  }

  create(joinToken) {
    this.purgeExpired();
    if (!this.room) {
      throw new Error('ROOM_ENDED');
    }
    if (joinToken) {
      const received = Buffer.from(joinToken);
      const expected = Buffer.from(this.room.joinToken || '');
      if (
        expected.length > 0 &&
        (received.length !== expected.length ||
          !crypto.timingSafeEqual(received, expected))
      ) {
        throw new Error('INVALID_JOIN_TOKEN');
      }
    }
    const id = clientId();
    const session = {
      clientId: id,
      clientToken: token(),
      displayName: `麦霸${String(this.clients.size + 1).padStart(2, '0')}`,
      createdAt: Date.now(),
      roomCode: this.room.code,
      sessionId: this.room.sessionId,
      generation: this.room.generation,
    };
    this.clients.set(session.clientToken, session);
    return session;
  }

  authorize(value) {
    const session = this.clients.get(value);
    if (
      !session ||
      !this.room ||
      Date.now() - session.createdAt > CLIENT_TTL ||
      session.roomCode !== this.room.code ||
      session.sessionId !== this.room.sessionId ||
      session.generation !== this.room.generation
    ) {
      if (session && Date.now() - session.createdAt > CLIENT_TTL)
        this.clients.delete(value);
      throw new Error('INVALID_CLIENT_TOKEN');
    }
    return session;
  }

  purgeExpired() {
    const now = Date.now();
    for (const [key, session] of this.clients) {
      if (now - session.createdAt > CLIENT_TTL) this.clients.delete(key);
    }
  }
}

export class RateLimiter {
  constructor() {
    this.entries = new Map();
  }

  check(key, limit) {
    const now = Date.now();
    const entry = this.entries.get(key) || { startedAt: now, count: 0 };
    if (now - entry.startedAt >= RATE_LIMIT_WINDOW_MS) {
      entry.startedAt = now;
      entry.count = 0;
    }
    entry.count += 1;
    this.entries.set(key, entry);
    return entry.count <= limit;
  }

  retryAfterMs(key) {
    const entry = this.entries.get(key);
    if (!entry) return RATE_LIMIT_WINDOW_MS;
    return Math.max(1, entry.startedAt + RATE_LIMIT_WINDOW_MS - Date.now());
  }

  clear() {
    this.entries.clear();
  }
}
