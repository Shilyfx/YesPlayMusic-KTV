import crypto from 'crypto';
import http from 'http';

const CLIENT_TTL = 5 * 60 * 60 * 1000;
const CACHE_TTL = 5 * 60 * 1000;

const token = () => crypto.randomBytes(32).toString('base64url');
const clientId = () => `guest-${crypto.randomBytes(6).toString('hex')}`;

function json(response, status, body) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
  return true;
}

function error(response, status, message) {
  return json(response, status, { error: message });
}

function readJson(request, maxBytes = 4096) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let tooLarge = false;
    request.on('data', chunk => {
      if (tooLarge) return;
      raw += chunk;
      if (Buffer.byteLength(raw) > maxBytes) {
        tooLarge = true;
        raw = '';
        reject(new Error('BODY_TOO_LARGE'));
      }
    });
    request.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        reject(new Error('INVALID_JSON'));
      }
    });
    request.on('error', reject);
  });
}

function bearer(request) {
  const value = request.headers.authorization || '';
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

function requestNetease(pathname) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      { hostname: '127.0.0.1', port: 10754, path: pathname, timeout: 10000 },
      response => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', chunk => (raw += chunk));
        response.on('end', () => {
          if (response.statusCode !== 200) return reject(new Error('UPSTREAM'));
          try {
            resolve(JSON.parse(raw));
          } catch (_) {
            reject(new Error('UPSTREAM'));
          }
        });
      }
    );
    request.on('timeout', () => request.destroy(new Error('UPSTREAM')));
    request.on('error', () => reject(new Error('UPSTREAM')));
  });
}

function versionLabel(track) {
  const text = [
    track.name,
    ...(track.aliases || track.alia || []),
    (track.album && track.album.name) || (track.al && track.al.name) || '',
  ]
    .join(' ')
    .toLowerCase();
  if (/live/.test(text)) return 'Live';
  if (/remix|rework/.test(text)) return 'Remix';
  if (/acoustic|unplugged/.test(text)) return 'Acoustic';
  if (/伴奏|instrumental|inst\b/.test(text)) return '伴奏';
  if (/cover|翻唱/.test(text)) return 'Cover';
  return '其他版本';
}

function sanitizeTrack(track) {
  return {
    trackId: String(track.id),
    name: track.name || '未知歌曲',
    artists: (track.artists || track.ar || []).map(item => item.name),
    album:
      (track.album && track.album.name) || (track.al && track.al.name) || '',
    coverUrl:
      (track.album && track.album.picUrl) ||
      (track.al && track.al.picUrl) ||
      '',
    duration: track.duration || track.dt || 0,
    aliases: track.aliases || track.alia || [],
    versionLabel: versionLabel(track),
  };
}

export class KaraokeCatalogService {
  constructor({ upstream = requestNetease, hostCatalogBridge = null } = {}) {
    this.upstream = upstream;
    this.hostCatalogBridge = hostCatalogBridge;
    this.trackCache = new Map();
    this.availabilityCache = new Map();
  }

  async search(query) {
    if (this.hostCatalogBridge) {
      const songs = await this.hostCatalogBridge('search', { query });
      return songs.map(song => {
        const track = sanitizeTrack(song);
        this.trackCache.set(track.trackId, {
          value: track,
          expiresAt: Date.now() + CACHE_TTL,
        });
        return track;
      });
    }
    const data = await this.upstream(
      `/search?keywords=${encodeURIComponent(query)}&limit=15&type=1`
    );
    const songs = (data.result && data.result.songs) || [];
    return songs.map(song => {
      const track = sanitizeTrack(song);
      this.trackCache.set(track.trackId, {
        value: track,
        expiresAt: Date.now() + CACHE_TTL,
      });
      return track;
    });
  }

  async getTrack(trackId) {
    const cached = this.trackCache.get(String(trackId));
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const data = this.hostCatalogBridge
      ? await this.hostCatalogBridge('trackDetail', {
          trackId: String(trackId),
        })
      : await this.upstream(`/song/detail?ids=${encodeURIComponent(trackId)}`);
    const song = this.hostCatalogBridge ? data : data.songs && data.songs[0];
    if (!song) throw new Error('TRACK_NOT_FOUND');
    const track = sanitizeTrack(song);
    this.trackCache.set(track.trackId, {
      value: track,
      expiresAt: Date.now() + CACHE_TTL,
    });
    return track;
  }

  async availability(trackId, { fresh = false } = {}) {
    const key = String(trackId);
    const cached = this.availabilityCache.get(key);
    if (!fresh && cached && cached.expiresAt > Date.now()) return cached.value;
    try {
      if (this.hostCatalogBridge) {
        const value = await this.hostCatalogBridge('availability', {
          trackId: key,
        });
        if (!['playable', 'trial-only', 'unavailable', 'error'].includes(value))
          throw new Error('UPSTREAM');
        this.availabilityCache.set(key, {
          value,
          expiresAt: Date.now() + CACHE_TTL,
        });
        return value;
      }
      const data = await this.upstream(
        `/song/url?id=${encodeURIComponent(key)}`
      );
      const source = data.data && data.data[0];
      const value =
        !source || !source.url
          ? 'unavailable'
          : source.freeTrialInfo
          ? 'trial-only'
          : 'playable';
      this.availabilityCache.set(key, {
        value,
        expiresAt: Date.now() + CACHE_TTL,
      });
      return value;
    } catch (_) {
      return 'error';
    }
  }
}

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
    const received = Buffer.from(joinToken || '');
    const expected = this.room && Buffer.from(this.room.joinToken);
    if (
      !this.room ||
      received.length !== expected.length ||
      !crypto.timingSafeEqual(received, expected)
    ) {
      throw new Error('INVALID_JOIN_TOKEN');
    }
    const id = clientId();
    const session = {
      clientId: id,
      clientToken: token(),
      displayName: `客人 ${this.clients.size + 1}`.padStart(5, '0'),
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

class RateLimiter {
  constructor() {
    this.entries = new Map();
  }

  check(key, limit) {
    const now = Date.now();
    const entry = this.entries.get(key) || { startedAt: now, count: 0 };
    if (now - entry.startedAt > 10000) {
      entry.startedAt = now;
      entry.count = 0;
    }
    entry.count += 1;
    this.entries.set(key, entry);
    return entry.count <= limit;
  }

  clear() {
    this.entries.clear();
  }
}

export class KaraokeRemoteService {
  constructor({ catalog, managerBridge, getRoom }) {
    this.catalog = catalog;
    this.managerBridge = managerBridge;
    this.getRoom = getRoom;
    this.sessions = new RemoteClientSessionStore();
    this.limiter = new RateLimiter();
  }

  onRoomStart(room) {
    this.sessions.start(room);
    this.limiter.clear();
  }

  onRoomStop() {
    this.sessions.stop();
    this.limiter.clear();
  }

  ensureActive() {
    if (!this.getRoom()) throw new Error('ROOM_ENDED');
  }

  bootstrap(joinToken, remoteAddress = '') {
    this.ensureActive();
    this.sessions.purgeExpired();
    if (!this.limiter.check(`bootstrap:${remoteAddress}`, 10))
      throw new Error('RATE_LIMIT');
    if (!this.limiter.check('bootstrap:room', 40))
      throw new Error('RATE_LIMIT');
    if (this.sessions.clients.size >= 32) throw new Error('ROOM_FULL');
    const session = this.sessions.create(joinToken);
    return {
      clientId: session.clientId,
      clientToken: session.clientToken,
      displayName: session.displayName,
    };
  }

  client(tokenValue) {
    this.ensureActive();
    return this.sessions.authorize(tokenValue);
  }

  async state(client) {
    if (!this.limiter.check(`state:${client.clientId}`, 40))
      throw new Error('RATE_LIMIT');
    if (!this.limiter.check('state:room', 240)) throw new Error('RATE_LIMIT');
    const snapshot = await this.managerBridge.snapshot();
    return {
      room: { active: true, code: this.getRoom().code },
      current: this.sanitizeItem(snapshot.currentItem),
      waiting: snapshot.waitingItems.map(item => this.sanitizeItem(item)),
      client: {
        clientId: client.clientId,
        displayName: client.displayName,
        permissions: { priority: true },
      },
    };
  }

  sanitizeItem(item) {
    if (!item) return null;
    return {
      queueItemId: item.queueItemId,
      trackId: String(item.trackId),
      name: item.trackName,
      artists: item.artists,
      album: item.albumName,
      requesterName: item.requesterName,
      requesterId: item.requesterId,
      requesterType: item.requesterType || 'host',
      priorityRequested: Boolean(item.priorityRequested),
      status: item.status,
    };
  }

  async search(client, query) {
    if (!this.limiter.check(`search:${client.clientId}`, 10))
      throw new Error('RATE_LIMIT');
    if (!this.limiter.check('search:room', 80)) throw new Error('RATE_LIMIT');
    const tracks = await this.catalog.search(query);
    const results = new Array(tracks.length);
    let nextIndex = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, tracks.length) }, async () => {
        while (nextIndex < tracks.length) {
          const index = nextIndex++;
          const track = tracks[index];
          results[index] = {
            ...track,
            playability: await this.catalog.availability(track.trackId),
          };
        }
      })
    );
    return results;
  }

  async availability(client, trackId) {
    if (!this.limiter.check(`search:${client.clientId}`, 10))
      throw new Error('RATE_LIMIT');
    if (!this.limiter.check('search:room', 80)) throw new Error('RATE_LIMIT');
    return this.catalog.availability(trackId);
  }

  async enqueue(client, trackId, priority) {
    if (!this.limiter.check(`mutation:${client.clientId}`, 20))
      throw new Error('RATE_LIMIT');
    if (!this.limiter.check('mutation:room', 120))
      throw new Error('RATE_LIMIT');
    const track = await this.catalog.getTrack(trackId);
    this.client(client.clientToken);
    const availability = await this.catalog.availability(trackId, {
      fresh: true,
    });
    this.client(client.clientToken);
    if (availability !== 'playable') throw new Error('TRACK_NOT_PLAYABLE');
    this.client(client.clientToken);
    const expected = {
      sessionId: client.sessionId,
      generation: client.generation,
    };
    const item = await this.managerBridge.enqueue(
      {
        id: track.trackId,
        name: track.name,
        ar: track.artists.map(name => ({ name })),
        al: { name: track.album, picUrl: track.coverUrl },
        dt: track.duration,
      },
      {
        id: client.clientId,
        name: client.displayName,
        type: 'remote',
        priorityRequested: Boolean(priority),
      },
      expected
    );
    if (!item) throw new Error('KTV_NOT_ACTIVE');
    if (priority) {
      this.client(client.clientToken);
      await this.managerBridge.front(item.queueItemId, expected);
    }
    return this.sanitizeItem(item);
  }

  async ownWaitingItem(client, queueItemId) {
    const snapshot = await this.managerBridge.snapshot();
    const item = snapshot.waitingItems.find(
      entry => entry.queueItemId === queueItemId
    );
    if (!item) throw new Error('WAITING_ITEM_NOT_FOUND');
    if (item.requesterId !== client.clientId) throw new Error('FORBIDDEN');
    return item;
  }

  async remove(client, queueItemId) {
    if (!this.limiter.check(`mutation:${client.clientId}`, 20))
      throw new Error('RATE_LIMIT');
    if (!this.limiter.check('mutation:room', 120))
      throw new Error('RATE_LIMIT');
    await this.ownWaitingItem(client, queueItemId);
    this.client(client.clientToken);
    const item = await this.managerBridge.remove(queueItemId, {
      sessionId: client.sessionId,
      generation: client.generation,
    });
    if (!item) throw new Error('WAITING_ITEM_NOT_FOUND');
    return this.sanitizeItem(item);
  }

  async front(client, queueItemId) {
    if (!this.limiter.check(`mutation:${client.clientId}`, 20))
      throw new Error('RATE_LIMIT');
    if (!this.limiter.check('mutation:room', 120))
      throw new Error('RATE_LIMIT');
    await this.ownWaitingItem(client, queueItemId);
    this.client(client.clientToken);
    const snapshot = await this.managerBridge.snapshot();
    if (
      snapshot.waitingItems[0] &&
      snapshot.waitingItems[0].queueItemId === queueItemId
    )
      return;
    if (
      !(await this.managerBridge.front(queueItemId, {
        sessionId: client.sessionId,
        generation: client.generation,
      }))
    )
      throw new Error('WAITING_ITEM_NOT_FOUND');
  }
}

export class RemoteApiRouter {
  constructor(service) {
    this.service = service;
  }

  async handle(request, response) {
    const url = new URL(request.url, 'http://karaoke.local');
    if (!url.pathname.startsWith('/ktv/api/')) return false;
    try {
      if (
        url.pathname === '/ktv/api/client-session' &&
        request.method === 'POST'
      ) {
        return json(
          response,
          200,
          this.service.bootstrap(
            bearer(request),
            request.socket.remoteAddress || ''
          )
        );
      }
      const client = this.service.client(bearer(request));
      if (url.pathname === '/ktv/api/state' && request.method === 'GET') {
        return json(response, 200, await this.service.state(client));
      }
      if (url.pathname === '/ktv/api/search' && request.method === 'GET') {
        const query = (url.searchParams.get('q') || '').trim();
        if (!query || query.length > 80)
          return error(response, 400, 'INVALID_QUERY');
        return json(response, 200, {
          results: await this.service.search(client, query),
        });
      }
      const availability = url.pathname.match(
        /^\/ktv\/api\/track\/(\d{1,20})\/availability$/
      );
      if (availability && request.method === 'GET') {
        return json(response, 200, {
          playability: await this.service.availability(client, availability[1]),
        });
      }
      if (url.pathname === '/ktv/api/requests' && request.method === 'POST') {
        if (!/^application\/json/.test(request.headers['content-type'] || ''))
          return error(response, 415, 'JSON_REQUIRED');
        const body = await readJson(request);
        if (!/^\d{1,20}$/.test(String(body.trackId || '')))
          return error(response, 400, 'INVALID_TRACK');
        return json(response, 201, {
          item: await this.service.enqueue(
            client,
            body.trackId,
            body.priority === true
          ),
        });
      }
      const item = url.pathname.match(
        /^\/ktv\/api\/requests\/([\w-]{1,160})(?:\/front)?$/
      );
      if (
        item &&
        request.method === 'DELETE' &&
        !url.pathname.endsWith('/front')
      ) {
        return json(response, 200, {
          item: await this.service.remove(client, item[1]),
        });
      }
      if (
        item &&
        request.method === 'POST' &&
        url.pathname.endsWith('/front')
      ) {
        await this.service.front(client, item[1]);
        return json(response, 200, { ok: true });
      }
      return error(response, 404, 'NOT_FOUND');
    } catch (exception) {
      const messages = {
        INVALID_JOIN_TOKEN: [401, 'INVALID_JOIN_TOKEN'],
        INVALID_CLIENT_TOKEN: [401, 'INVALID_CLIENT_TOKEN'],
        ROOM_ENDED: [410, 'ROOM_ENDED'],
        FORBIDDEN: [403, 'FORBIDDEN'],
        RATE_LIMIT: [429, 'RATE_LIMIT'],
        ROOM_FULL: [429, 'ROOM_FULL'],
        TRACK_NOT_PLAYABLE: [409, 'TRACK_NOT_PLAYABLE'],
        TRACK_NOT_FOUND: [404, 'TRACK_NOT_FOUND'],
        KTV_NOT_ACTIVE: [409, 'KTV_NOT_ACTIVE'],
        WAITING_ITEM_NOT_FOUND: [404, 'WAITING_ITEM_NOT_FOUND'],
        BODY_TOO_LARGE: [413, 'BODY_TOO_LARGE'],
        INVALID_JSON: [400, 'INVALID_JSON'],
      };
      const [status, message] = messages[exception.message] || [
        502,
        'REMOTE_UNAVAILABLE',
      ];
      return error(response, status, message);
    }
  }
}
