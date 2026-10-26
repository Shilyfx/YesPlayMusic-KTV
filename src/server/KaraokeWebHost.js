import crypto from 'crypto';
import QRCode from 'qrcode';
import { sanitizePresentation } from '../karaoke/lyricDisplay';
import { KaraokeServer } from '../electron/karaoke/KaraokeServer';
import {
  KaraokeCatalogService,
  KaraokeRemoteService,
  RemoteApiRouter,
} from '../electron/karaoke/KaraokeRemoteApi';

const secret = () => crypto.randomBytes(32).toString('hex');

export default class KaraokeWebHost {
  constructor({ publicOrigin, remoteDistPath = '', now = Date.now } = {}) {
    this.publicOrigin = new URL(publicOrigin).origin;
    this.now = now;
    this.owner = null;
    this.sequence = 0;
    this.generation = 0;
    this.pending = new Map();
    this.roomServer = new KaraokeServer({ remoteDistPath });
    this.service = new KaraokeRemoteService({
      catalog: new KaraokeCatalogService({
        hostCatalogBridge: (action, payload) =>
          this.command('catalog', { action, payload }),
      }),
      getRoom: () => {
        this.expire();
        return this.roomServer.room;
      },
      managerBridge: {
        snapshot: async () => {
          this.expire();
          if (!this.owner) throw new Error('ROOM_ENDED');
          return this.owner.snapshot;
        },
        enqueue: (track, requester, expected) =>
          this.command('enqueue', { track, requester, expected }),
        remove: (queueItemId, expected) =>
          this.command('remove', { queueItemId, expected }),
        front: (queueItemId, expected) =>
          this.command('front', { queueItemId, expected }),
        next: expected => this.command('next', { expected }),
      },
    });
    this.roomServer.setRemoteApi(
      new RemoteApiRouter(this.service),
      this.service
    );
  }

  expire() {
    if (this.owner && this.now() - this.owner.lastSeen > 90000) this.close();
  }

  close() {
    this.owner = null;
    this.roomServer.room = null;
    this.service.onRoomStop();
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('ROOM_ENDED'));
    }
    this.pending.clear();
  }

  command(action, payload = {}) {
    this.expire();
    if (!this.owner) return Promise.reject(new Error('ROOM_ENDED'));
    if (this.pending.size >= 64) return Promise.reject(new Error('RATE_LIMIT'));
    const id = `web-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('KTV_NOT_ACTIVE'));
      }, 12000);
      this.pending.set(id, {
        command: { id, action, payload, expiresAt: this.now() + 12000 },
        resolve,
        reject,
        timer,
      });
    });
  }

  validateSnapshot(snapshot) {
    if (
      !snapshot ||
      snapshot.session?.status !== 'active' ||
      typeof snapshot.session.sessionId !== 'string' ||
      !Array.isArray(snapshot.waitingItems) ||
      !Array.isArray(snapshot.historyItems) ||
      !Number.isSafeInteger(snapshot.revision)
    )
      throw new Error('INVALID_SNAPSHOT');
    if (
      this.owner &&
      snapshot.session.sessionId !== this.owner.snapshot.session.sessionId
    )
      throw new Error('STALE_SESSION');
  }

  async describe() {
    const room = this.roomServer.room;
    if (!room) return null;
    const url = `${this.publicOrigin}/room/${room.code}/#token=${room.token}`;
    return {
      code: room.code,
      name: room.name,
      url,
      joinUrl: url,
      qrDataUrl: await QRCode.toDataURL(url, { margin: 3, width: 520 }),
      selectedAddress: new URL(this.publicOrigin).hostname,
      candidates: [
        {
          address: new URL(this.publicOrigin).hostname,
          interfaceName: 'Docker 服务',
        },
      ],
    };
  }

  async readBody(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 256 * 1024) throw new Error('BODY_TOO_LARGE');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString() || '{}');
  }

  json(response, status, body) {
    response.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify(body));
  }

  async handle(request, response) {
    this.expire();
    const route = new URL(request.url, this.publicOrigin).pathname;
    if (route === '/ktv/health')
      return this.json(response, 200, {
        ok: true,
        active: Boolean(this.owner),
      });
    if (route === '/ktv/display') {
      if (request.method !== 'GET')
        return this.json(response, 405, { error: 'READ_ONLY' });
      const owner = this.owner;
      return this.json(
        response,
        200,
        owner
          ? {
              active: true,
              generation: this.generation,
              hostName: owner.name,
              stale:
                !owner.presentation || this.now() - owner.presentedAt > 5000,
              updatedAt: owner.presentedAt,
              serverTime: this.now(),
              presentation: owner.presentation,
            }
          : { active: false }
      );
    }
    if (!route.startsWith('/ktv/host/')) {
      try {
        return await this.roomServer.handleRequest(request, response);
      } catch (_) {
        return this.json(response, 502, { error: 'REMOTE_UNAVAILABLE' });
      }
    }
    if (
      request.method !== 'POST' ||
      request.headers.origin !== this.publicOrigin
    )
      return this.json(response, 403, { error: 'FORBIDDEN' });
    try {
      if (!/^application\/json/.test(request.headers['content-type'] || ''))
        return this.json(response, 415, { error: 'JSON_REQUIRED' });
      // Authenticate before reading potentially large host request bodies.
      const token = (request.headers.authorization || '').replace(
        /^Bearer /,
        ''
      );
      if (
        route !== '/ktv/host/open' &&
        (!this.owner || token !== this.owner.token)
      )
        return this.json(response, 401, { error: 'INVALID_HOST_TOKEN' });
      if (route === '/ktv/host/open' && this.owner)
        return this.json(response, 409, {
          error: '已有主机房间，请在原主机结束 KTV；失联后最多等待 90 秒',
        });
      const body = await this.readBody(request);
      // Another request may close/replace the owner while a body is arriving.
      this.expire();
      if (
        route !== '/ktv/host/open' &&
        (!this.owner || token !== this.owner.token)
      )
        return this.json(response, 401, { error: 'INVALID_HOST_TOKEN' });
      if (route === '/ktv/host/open') {
        if (this.owner) return this.json(response, 409, { error: 'HOST_BUSY' });
        this.validateSnapshot(body.snapshot);
        const presentation = body.presentation
          ? sanitizePresentation(body.presentation)
          : null;
        this.owner = {
          token: secret(),
          snapshot: body.snapshot,
          lastSeen: this.now(),
          name:
            typeof body.hostName === 'string'
              ? body.hostName.trim().slice(0, 40) || '主电脑'
              : '主电脑',
          presentation,
          presentedAt: presentation ? this.now() : 0,
        };
        this.roomServer.room = {
          code: crypto.randomBytes(3).toString('hex').toUpperCase(),
          name: 'LumaSing KTV',
          token: secret(),
          generation: ++this.generation,
          sessionId: body.snapshot.session.sessionId,
        };
        this.service.onRoomStart(this.roomServer.room);
        return this.json(response, 200, {
          hostToken: this.owner.token,
          room: await this.describe(),
        });
      }
      if (route === '/ktv/host/close') {
        this.close();
        return this.json(response, 200, { ok: true });
      }
      if (route === '/ktv/host/status')
        return this.json(response, 200, {
          ok: true,
          room: await this.describe(),
        });
      if (route === '/ktv/host/exchange') {
        if (body.snapshot) this.validateSnapshot(body.snapshot);
        const presentation = body.presentation
          ? sanitizePresentation(body.presentation)
          : null;
        this.owner.lastSeen = this.now();
        if (presentation) {
          this.owner.presentation = presentation;
          this.owner.presentedAt = this.now();
        }
        if (body.snapshot) this.owner.snapshot = body.snapshot;
        for (const result of (Array.isArray(body.results)
          ? body.results
          : []
        ).slice(0, 64)) {
          const entry = this.pending.get(result.id);
          if (!entry) continue;
          clearTimeout(entry.timer);
          this.pending.delete(result.id);
          if (result.ok) entry.resolve(result.result);
          else entry.reject(new Error(result.error || 'KTV_NOT_ACTIVE'));
        }
        return this.json(response, 200, {
          commands: [...this.pending.values()].map(entry => entry.command),
        });
      }
      return this.json(response, 404, { error: 'NOT_FOUND' });
    } catch (error) {
      return this.json(
        response,
        error.message === 'BODY_TOO_LARGE' ? 413 : 409,
        { error: error.message }
      );
    }
  }
}
