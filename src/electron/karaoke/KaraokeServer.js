import crypto from 'crypto';
import http from 'http';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { createReadStream } from 'fs';
import QRCode from 'qrcode';
import { createDesktopPublicAdapter } from '../../multiroom/desktopPublicAdapter.cjs';
import { createHostConnector } from '../../multiroom/hostConnector.cjs';
import {
  isValidReactionEffect,
  normalizeReactionText,
  reactionCharacters,
  reactionChoices,
  upstreamReactions,
} from '@/karaoke/reactions';
import { createReactionScheduler } from '@/karaoke/reactionScheduler';

const ROOM_PORT = 27233;
const DEFAULT_ROOM_NAME = 'LumaSing KTV';
const MAX_REACTION_BODY_BYTES = 4096;
const REACTION_RATE_LIMIT_PER_CLIENT = 8;
const REACTION_RATE_LIMIT_PER_ROOM = 40;
const roomCode = () => crypto.randomBytes(3).toString('hex').toUpperCase();
// Electron 13 ships with a Node.js version that does not support the
// `base64url` Buffer encoding. Keep the token URL-safe without relying on
// that newer encoding name so QR generation also works in packaged builds.
const toBase64Url = value =>
  value
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
const roomToken = () => toBase64Url(crypto.randomBytes(32));
const reactionEpoch = () => crypto.randomBytes(12).toString('hex');

function hasAsciiControlCharacters(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function normalizePublicRoomConfig(config = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config))
    throw new Error('INVALID_PUBLIC_CONFIG');
  const gatewayValue = config.gatewayOrigin;
  const hostIdValue = config.hostId;
  const hostSecretValue = config.hostSecret;
  if (
    (gatewayValue !== undefined && typeof gatewayValue !== 'string') ||
    (hostIdValue !== undefined && typeof hostIdValue !== 'string') ||
    (hostSecretValue !== undefined && typeof hostSecretValue !== 'string')
  )
    throw new Error('INVALID_PUBLIC_CONFIG');

  const gatewayText = (gatewayValue || '').trim();
  const hostId = (hostIdValue || '').trim();
  const hostSecret = hostSecretValue || '';
  let gatewayOrigin = '';
  if (gatewayText) {
    let gateway;
    try {
      gateway = new URL(gatewayText);
    } catch (_) {
      throw new Error('INVALID_PUBLIC_CONFIG');
    }
    const localHost = ['localhost', '127.0.0.1'].includes(gateway.hostname);
    if (
      (gateway.protocol !== 'https:' &&
        !(gateway.protocol === 'http:' && localHost)) ||
      gateway.username ||
      gateway.password ||
      gateway.pathname !== '/' ||
      gateway.search ||
      gateway.hash
    )
      throw new Error('INVALID_PUBLIC_CONFIG');
    gatewayOrigin = gateway.origin;
  }
  if (hostId.length > 256 || hasAsciiControlCharacters(hostId))
    throw new Error('INVALID_PUBLIC_CONFIG');
  if (
    hostSecret.length > 4096 ||
    hasAsciiControlCharacters(hostSecret) ||
    (hostSecret && !hostSecret.trim())
  )
    throw new Error('INVALID_PUBLIC_CONFIG');
  return { gatewayOrigin, hostId, hostSecret };
}

function bearerToken(request) {
  const authorization = request.headers.authorization || '';
  return authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';
}

function readJsonBody(request, maxBytes = MAX_REACTION_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let byteLength = 0;
    let tooLarge = false;
    request.on('data', chunk => {
      if (tooLarge) return;
      byteLength += chunk.length;
      if (byteLength > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) return reject(new Error('BODY_TOO_LARGE'));
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (_) {
        reject(new Error('INVALID_JSON'));
      }
    });
    request.on('error', reject);
  });
}

function isPrivateIpv4(address) {
  return (
    address.startsWith('10.') ||
    address.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(address)
  );
}

function getLanAddressCandidates(interfaces = os.networkInterfaces()) {
  const candidates = [];
  for (const [interfaceName, addresses] of Object.entries(interfaces)) {
    const virtualInterface =
      /tailscale|vmware|virtual|wireguard|docker|loopback|nodebabylink|awdl|llw|utun|bridge|vmenet|vmnet/i.test(
        interfaceName
      );
    for (const address of addresses || []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      const privateAddress = isPrivateIpv4(address.address);
      candidates.push({
        interfaceName,
        address: address.address,
        isPrivate: privateAddress,
        priority:
          (privateAddress ? 100 : 0) -
          (virtualInterface ? 80 : 0) -
          (address.address.startsWith('169.254.') ? 100 : 0),
      });
    }
  }
  return candidates.sort((left, right) => right.priority - left.priority);
}

function selectLanAddress(interfaces) {
  const first = getLanAddressCandidates(interfaces)[0];
  return (first && first.address) || null;
}

function getLanAddress() {
  return selectLanAddress(os.networkInterfaces());
}

function contentType(filePath) {
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg'))
    return 'image/jpeg';
  if (filePath.endsWith('.webp')) return 'image/webp';
  if (filePath.endsWith('.mp3')) return 'audio/mpeg';
  if (filePath.endsWith('.flac')) return 'audio/flac';
  if (filePath.endsWith('.m4a')) return 'audio/mp4';
  if (filePath.endsWith('.wav')) return 'audio/wav';
  if (filePath.endsWith('.ogg')) return 'audio/ogg';
  return 'text/html; charset=utf-8';
}

function isImmutableAsset(relativePath) {
  const fileName = path.posix.basename(
    String(relativePath).replace(/\\/g, '/')
  );
  return /(?:^|[.-])[a-f0-9]{8,}(?:[.-]|$)/i.test(fileName);
}

export class KaraokeServer {
  constructor({
    remoteDistPath,
    port = ROOM_PORT,
    networkInterfaces = () => os.networkInterfaces(),
    listen = (server, port, host, callback) =>
      server.listen(port, host, callback),
    remoteApi = null,
    remoteService = null,
    localLibrary = null,
    hostConnectorFactory = createHostConnector,
    publicAdapterFactory = createDesktopPublicAdapter,
  }) {
    this.remoteDistPath = remoteDistPath;
    this.port = port;
    this.networkInterfaces = networkInterfaces;
    this.listen = listen;
    this.remoteApi = remoteApi;
    this.remoteService = remoteService;
    this.localLibrary = localLibrary;
    this.hostConnectorFactory = hostConnectorFactory;
    this.publicAdapterFactory = publicAdapterFactory;
    this.server = null;
    this.room = null;
    this.state = 'idle';
    this.startPromise = null;
    this.generation = 0;
    this.reactionScheduler = createReactionScheduler();
    this.reactionGeneration = '';
    this.publicConfig = { gatewayOrigin: '', hostId: '', hostSecret: '' };
    this.publicStatus = 'disabled';
    this.publicError = '';
    this.publicQrError = '';
    this.publicToken = '';
    this.publicJoinUrl = '';
    this.publicQrDataUrl = null;
    this.publicConnector = null;
    this.publicAdapterServer = null;
    this.publicStatusListener = null;
  }

  setRemoteApi(remoteApi, remoteService) {
    this.remoteApi = remoteApi;
    this.remoteService = remoteService;
  }

  setLocalLibrary(localLibrary) {
    this.localLibrary = localLibrary;
  }

  setPublicConfig(config) {
    if (this.room || this.state === 'starting')
      throw new Error('PUBLIC_ROOM_ACTIVE');
    this.publicConfig = normalizePublicRoomConfig(config);
    this.publicStatus = 'disabled';
    this.publicError = '';
    this.publicQrError = '';
  }

  getPublicConfigState() {
    return {
      gatewayOrigin: this.publicConfig.gatewayOrigin,
      hostId: this.publicConfig.hostId,
      hasHostSecret: Boolean(this.publicConfig.hostSecret),
    };
  }

  setPublicStatusListener(listener) {
    this.publicStatusListener =
      typeof listener === 'function' ? listener : null;
  }

  updatePublicStatus(status) {
    this.publicStatus = status;
    if (this.publicStatusListener) {
      try {
        this.publicStatusListener(status);
      } catch (_) {
        // Status notifications are presentation-only.
      }
    }
  }

  getLanAddressCandidates() {
    return getLanAddressCandidates(this.networkInterfaces());
  }

  getLocalAudioUrl(localId) {
    if (!this.room || !this.localLibrary) return null;
    const encodedId = encodeURIComponent(String(localId));
    const token = encodeURIComponent(this.room.token);
    return `http://127.0.0.1:${this.port}/ktv/local/audio/${encodedId}?token=${token}`;
  }

  getLocalCoverUrl(localId) {
    if (!this.room || !this.localLibrary) return null;
    const encodedId = encodeURIComponent(String(localId));
    const token = encodeURIComponent(this.room.token);
    return `http://${this.room.lanAddress}:${this.port}/ktv/local/cover/${encodedId}?token=${token}`;
  }

  async startRoom({ lanAddress, sessionId, roomName } = {}) {
    if (this.room) return this.describeRoom();
    if (this.startPromise) return this.startPromise;
    if (!sessionId) throw new Error('缺少有效的 KTV Session');
    this.startPromise = this._startRoom({ lanAddress, sessionId, roomName });
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async _startRoom({ lanAddress, sessionId, roomName }) {
    const generation = (this.generation += 1);
    const candidates = this.getLanAddressCandidates();
    const firstCandidate = candidates[0];
    const selectedAddress =
      lanAddress || (firstCandidate && firstCandidate.address);
    if (
      !selectedAddress ||
      !candidates.some(item => item.address === selectedAddress)
    ) {
      throw new Error('未找到可用的局域网 IPv4 地址');
    }

    const room = {
      code: roomCode(),
      name: roomName || DEFAULT_ROOM_NAME,
      token: roomToken(),
      lanAddress: selectedAddress,
      candidates,
      sessionId,
      generation,
    };
    const server = http.createServer((request, response) =>
      this.handleRequest(request, response)
    );
    this.state = 'starting';
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        this.listen(server, this.port, '0.0.0.0', () => {
          server.off('error', reject);
          resolve();
        });
      });
      this.room = room;
      this.server = server;
      if (generation !== this.generation) {
        await new Promise(resolve => server.close(resolve));
        this.room = null;
        this.server = null;
        this.state = 'idle';
        throw new Error('KTV 房间已取消');
      }
      this.state = 'active';
      if (this.remoteService) this.remoteService.onRoomStart(room);
      this.reactionScheduler.reset();
      this.reactionGeneration = reactionEpoch();
      await this.startPublicRoom(room, generation);
      if (this.room !== room || this.generation !== generation)
        throw new Error('KTV 房间已取消');
      return this.describeRoom();
    } catch (error) {
      this.room = null;
      this.server = null;
      this.state = 'idle';
      server.close();
      throw error;
    }
  }

  async closePublicAdapter(server) {
    if (!server || !server.listening) return;
    await new Promise(resolve => server.close(() => resolve()));
  }

  async startPublicRoom(room, generation) {
    const { gatewayOrigin, hostId, hostSecret } = this.publicConfig;
    if (!gatewayOrigin || !hostId || !hostSecret) {
      this.publicToken = '';
      this.publicJoinUrl = '';
      this.publicQrDataUrl = null;
      this.publicError = '';
      this.updatePublicStatus('disabled');
      return;
    }

    this.publicError = '';
    this.publicQrError = '';
    this.publicToken = roomToken();
    this.publicJoinUrl = '';
    this.publicQrDataUrl = null;
    this.updatePublicStatus('starting');

    let adapterServer = null;
    let connector = null;
    try {
      const handler = this.publicAdapterFactory({
        roomServer: this,
        remoteApi: this.remoteApi,
        publicOrigin: gatewayOrigin,
        getPublicToken: () =>
          this.room === room && this.generation === generation
            ? this.publicToken
            : '',
        handleReaction: (request, response, publicGuest = false) =>
          this.handleReactionRequest(request, response, publicGuest),
      });
      adapterServer = http.createServer((request, response) => {
        Promise.resolve(handler(request, response)).catch(() => {
          if (response.headersSent) return response.destroy();
          response.writeHead(502, {
            'Cache-Control': 'no-store',
            'Content-Type': 'application/json; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
          });
          response.end(JSON.stringify({ error: 'PUBLIC_ROOM_UNAVAILABLE' }));
        });
      });
      adapterServer.on('error', () => {
        if (this.room !== room || this.generation !== generation) return;
        this.publicToken = '';
        this.publicJoinUrl = '';
        this.publicQrDataUrl = null;
        this.publicError = '公网服务异常，局域网房间仍可使用';
        const activeConnector = this.publicConnector;
        this.publicConnector = null;
        if (activeConnector)
          Promise.resolve(activeConnector.stop()).catch(() => {});
        this.closePublicAdapter(adapterServer).catch(() => {});
        this.updatePublicStatus('error');
      });
      this.publicAdapterServer = adapterServer;
      await new Promise((resolve, reject) => {
        const onError = error => reject(error);
        adapterServer.once('error', onError);
        this.listen(adapterServer, 0, '127.0.0.1', () => {
          adapterServer.off('error', onError);
          resolve();
        });
      });

      if (this.room !== room || this.generation !== generation) {
        await this.closePublicAdapter(adapterServer);
        if (this.publicAdapterServer === adapterServer)
          this.publicAdapterServer = null;
        this.publicToken = '';
        return;
      }
      const address = adapterServer.address();
      if (!address || typeof address === 'string' || !address.port)
        throw new Error('PUBLIC_ADAPTER_LISTEN_FAILED');

      connector = this.hostConnectorFactory({
        gatewayOrigin,
        hostId,
        hostSecret,
        localPort: address.port,
        onStatus: status => {
          if (
            this.room === room &&
            this.generation === generation &&
            this.publicConnector === connector &&
            ['connected', 'reconnecting', 'stopped'].includes(status)
          )
            this.updatePublicStatus(status);
        },
      });
      this.publicConnector = connector;
      await connector.start();
      if (this.room !== room || this.generation !== generation) {
        if (this.publicConnector === connector) this.publicConnector = null;
        await connector.stop();
        await this.closePublicAdapter(adapterServer);
        if (this.publicAdapterServer === adapterServer)
          this.publicAdapterServer = null;
        this.publicToken = '';
        return;
      }
      if (!/^[a-f0-9]{32,64}$/.test(connector.roomId || ''))
        throw new Error('INVALID_PUBLIC_ROOM_ID');

      this.publicJoinUrl = `${gatewayOrigin}/r/${
        connector.roomId
      }/room/#public=1&token=${encodeURIComponent(this.publicToken)}`;
      try {
        this.publicQrDataUrl = await QRCode.toDataURL(this.publicJoinUrl, {
          margin: 3,
          width: 520,
        });
      } catch (_) {
        this.publicQrError = '公网二维码生成失败，可复制链接加入';
      }
      if (!['connected', 'reconnecting'].includes(this.publicStatus))
        this.updatePublicStatus('connected');
    } catch (_) {
      this.publicToken = '';
      this.publicJoinUrl = '';
      this.publicQrDataUrl = null;
      this.publicQrError = '';
      this.publicError = '公网连接失败，局域网房间仍可使用';
      if (this.publicConnector === connector) this.publicConnector = null;
      if (connector) {
        try {
          await connector.stop();
        } catch (_) {
          // Public cleanup must not affect the LAN room.
        }
      }
      if (this.publicAdapterServer === adapterServer)
        this.publicAdapterServer = null;
      await this.closePublicAdapter(adapterServer);
      if (this.room === room && this.generation === generation)
        this.updatePublicStatus('error');
    }
  }

  async stopPublicRoom() {
    this.publicToken = '';
    this.publicJoinUrl = '';
    this.publicQrDataUrl = null;
    this.publicQrError = '';
    this.publicError = '';
    const connector = this.publicConnector;
    const adapterServer = this.publicAdapterServer;
    this.publicConnector = null;
    this.publicAdapterServer = null;
    this.updatePublicStatus('disabled');
    if (connector) {
      try {
        await connector.stop();
      } catch (_) {
        // The LAN room can still be closed if the gateway is unreachable.
      }
    }
    await this.closePublicAdapter(adapterServer);
  }

  async stopRoom() {
    this.generation += 1;
    await this.stopPublicRoom();
    if (this.remoteService) this.remoteService.onRoomStop();
    this.reactionScheduler.reset();
    this.reactionGeneration = '';
    this.room = null;
    this.state = 'idle';
    const pendingStart = this.startPromise;
    if (this.server) {
      const server = this.server;
      this.server = null;
      await new Promise(resolve => server.close(resolve));
    }
    if (pendingStart) {
      try {
        await pendingStart;
      } catch (_) {
        // Cancellation is the expected completion of a pending startup.
      }
    }
    this.room = null;
    this.server = null;
    this.state = 'idle';
  }

  async describeRoom() {
    if (!this.room) return null;
    const url = `http://${this.room.lanAddress}:${this.port}/room/`;
    let qrDataUrl = null;
    let qrError = null;
    try {
      // QR rendering is presentation-only. A renderer failure must not tear
      // down an already listening room; the plain URL remains usable.
      qrDataUrl = await QRCode.toDataURL(url, { margin: 3, width: 520 });
    } catch (error) {
      qrError = '二维码生成失败，可复制下方链接加入';
      console.warn('[karaoke] QR generation failed', error);
    }
    return {
      code: this.room.code,
      name: this.room.name,
      token: this.room.token,
      url,
      joinUrl: url,
      candidates: this.room.candidates,
      selectedAddress: this.room.lanAddress,
      qrDataUrl,
      qrError,
      publicJoinUrl: this.publicJoinUrl || null,
      publicQrDataUrl: this.publicQrDataUrl,
      publicStatus: this.publicStatus,
      publicError: this.publicError || null,
      publicQrError: this.publicQrError || null,
    };
  }

  async selfTestAddress(address) {
    address = address || (this.room && this.room.lanAddress);
    if (!address || !this.room) {
      return { ok: false, error: '局域网房间尚未启动' };
    }
    return new Promise(resolve => {
      const request = http.get(
        {
          hostname: address,
          port: this.port,
          path: '/health',
          timeout: 2000,
        },
        response => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', chunk => {
            body += chunk;
          });
          response.on('end', () => {
            try {
              const parsed = JSON.parse(body);
              resolve({
                ok: response.statusCode === 200 && parsed.active === true,
                statusCode: response.statusCode,
              });
            } catch (_) {
              resolve({ ok: false, error: '健康检查返回内容无效' });
            }
          });
        }
      );
      request.on('timeout', () => request.destroy(new Error('请求超时')));
      request.on('error', error =>
        resolve({ ok: false, error: `网卡地址不可访问：${error.message}` })
      );
    });
  }

  getReactionState() {
    return {
      events: this.room ? this.reactionScheduler.recentPublic() : [],
      generation: this.room ? this.reactionGeneration : '',
      serverTime: Date.now(),
    };
  }

  async handleReactionRequest(request, response, publicGuest = false) {
    if (request.method !== 'POST')
      return this.sendJson(response, { error: 'METHOD_NOT_ALLOWED' }, 405);
    if (!this.room)
      return this.sendJson(response, { error: 'ROOM_ENDED' }, 410);
    if (!this.remoteService || !this.remoteService.managerBridge)
      return this.sendJson(response, { error: 'REMOTE_UNAVAILABLE' }, 503);

    const room = this.room;
    const token = bearerToken(request);
    let client;
    try {
      client = this.remoteService.client(token, publicGuest);
    } catch (_) {
      return this.sendJson(response, { error: 'INVALID_CLIENT_TOKEN' }, 401);
    }

    if (
      !/^application\/json(?:\s*;|$)/i.test(
        request.headers['content-type'] || ''
      )
    )
      return this.sendJson(response, { error: 'JSON_REQUIRED' }, 415);

    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      const status = error.message === 'BODY_TOO_LARGE' ? 413 : 400;
      return this.sendJson(response, { error: error.message }, status);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};

    const validKind =
      body.kind === 'emotion'
        ? upstreamReactions.some(item => item.emotion === body.emotionId)
        : reactionChoices.some(item => item.kind === body.kind);
    if (!validKind)
      return this.sendJson(response, { error: 'INVALID_REACTION' }, 400);
    if (
      body.character !== undefined &&
      !reactionCharacters.some(item => item.id === body.character)
    )
      return this.sendJson(response, { error: 'INVALID_CHARACTER' }, 400);
    if (body.effect && !isValidReactionEffect(body.effect))
      return this.sendJson(response, { error: 'INVALID_EFFECT' }, 400);

    let customText;
    try {
      customText = normalizeReactionText(body.customText);
    } catch (error) {
      return this.sendJson(response, { error: error.message }, 400);
    }

    const clientRateKey = `reaction:${client.clientId}`;
    if (
      !this.remoteService.limiter.check(
        clientRateKey,
        REACTION_RATE_LIMIT_PER_CLIENT
      ) ||
      !this.remoteService.limiter.check(
        'reaction:room',
        REACTION_RATE_LIMIT_PER_ROOM
      )
    )
      return this.sendJson(response, { error: 'RATE_LIMIT' }, 429);

    try {
      const snapshot = await this.remoteService.managerBridge.snapshot();
      if (this.room !== room)
        return this.sendJson(response, { error: 'ROOM_ENDED' }, 410);
      client = this.remoteService.client(token, publicGuest);
      const scheduled = this.reactionScheduler.scheduleUser({
        senderId: client.clientId,
        itemId: snapshot.currentItem?.queueItemId || '',
        kind: body.kind,
        effect: body.effect || 'bounce',
        character: body.character,
        emotionId: body.kind === 'emotion' ? body.emotionId : undefined,
        customText,
      });
      if (!scheduled.ok)
        return this.sendJson(
          response,
          {
            error: scheduled.code || 'REACTION_QUEUE_FULL',
            status: 'busy',
            queuePosition: scheduled.queuePosition,
          },
          429
        );
      return this.sendJson(response, {
        ok: true,
        status: scheduled.status,
        queuePosition: scheduled.queuePosition,
        eventId: scheduled.event.id,
        startAt: scheduled.event.startAt,
        endsAt: scheduled.event.endsAt,
      });
    } catch (_) {
      return this.sendJson(response, { error: 'REMOTE_UNAVAILABLE' }, 502);
    }
  }

  async handleRequest(request, response) {
    // `URL` normalizes encoded dot segments before we can compare them to the
    // room prefix. Remote assets never need encoded separators or dot segments,
    // so reject those raw forms before URL parsing.
    const rawPath = request.url.split(/[?#]/)[0];
    if (/%2e|%2f|%5c|\\/i.test(rawPath)) return this.notFound(response);
    const requestUrl = new URL(request.url, 'http://karaoke.local');
    if (requestUrl.pathname === '/ktv/api/reactions')
      return this.handleReactionRequest(request, response);
    if (this.remoteApi && (await this.remoteApi.handle(request, response)))
      return;
    if (request.method !== 'GET') return this.notFound(response);
    if (requestUrl.pathname === '/health') {
      return this.sendJson(response, { active: Boolean(this.room) });
    }

    const localAudio = requestUrl.pathname.match(
      /^\/ktv\/local\/audio\/(local-[a-f0-9]{16})$/i
    );
    if (localAudio) {
      if (
        !this.room ||
        requestUrl.searchParams.get('token') !== this.room.token ||
        !this.localLibrary
      )
        return this.notFound(response);
      const resolved = await this.localLibrary.resolve(localAudio[1]);
      if (!resolved) return this.notFound(response);
      return this.sendLocalAudio(resolved.audioPath, request, response);
    }

    const localCover = requestUrl.pathname.match(
      /^\/ktv\/local\/cover\/(local-[a-f0-9]{16})$/i
    );
    if (localCover) {
      if (
        !this.room ||
        requestUrl.searchParams.get('token') !== this.room.token ||
        !this.localLibrary
      )
        return this.notFound(response);
      const resolved = await this.localLibrary.resolve(localCover[1]);
      if (!resolved || !resolved.coverPath) return this.notFound(response);
      return this.sendLocalCover(resolved.coverPath, response);
    }

    // Support pure static room URL: /room or /room/
    if (requestUrl.pathname === '/room' || requestUrl.pathname === '/room/') {
      return this.sendRemoteAsset('/index.html', response);
    }

    // Support static assets under /room/... (e.g. /room/js/..., /room/css/...)
    // Also backward compatible with legacy dynamic room path: /room/<code/...
    const legacyRoomPrefix = this.room ? `/room/${this.room.code}` : null;
    let relativePath = null;
    if (
      legacyRoomPrefix &&
      (requestUrl.pathname === legacyRoomPrefix ||
        requestUrl.pathname === `${legacyRoomPrefix}/`)
    ) {
      relativePath = '/index.html';
    } else if (
      legacyRoomPrefix &&
      requestUrl.pathname.startsWith(`${legacyRoomPrefix}/`)
    ) {
      relativePath = requestUrl.pathname.slice(legacyRoomPrefix.length);
    } else if (requestUrl.pathname.startsWith('/room/')) {
      relativePath = requestUrl.pathname.slice('/room'.length);
    }

    if (relativePath) {
      if (relativePath === '/' || relativePath === '')
        relativePath = '/index.html';
      return this.sendRemoteAsset(relativePath, response);
    }

    return this.notFound(response);
  }

  async sendRemoteAsset(relativePath, response) {
    return this.sendStaticAsset(this.remoteDistPath, relativePath, response);
  }

  async sendLocalAudio(filePath, request, response) {
    try {
      const stat = await fs.stat(filePath);
      const total = stat.size;
      const range = request.headers.range;
      let start = 0;
      let end = total - 1;
      let status = 200;
      if (range) {
        const match = range.match(/bytes=(\d*)-(\d*)/);
        if (match) {
          if (match[1]) start = Number(match[1]);
          if (match[2]) end = Number(match[2]);
          if (!match[1] && match[2])
            start = Math.max(0, total - Number(match[2]));
          end = Math.min(end, total - 1);
          if (start <= end && start < total) status = 206;
        }
      }
      if (status === 200) {
        start = 0;
        end = total - 1;
      }
      const headers = {
        ...this.securityHeaders(contentType(filePath)),
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
      };
      if (status === 206)
        headers['Content-Range'] = `bytes ${start}-${end}/${total}`;
      response.writeHead(status, headers);
      createReadStream(filePath, { start, end })
        .on('error', () => response.destroy())
        .pipe(response);
    } catch (_) {
      this.notFound(response);
    }
  }

  async sendLocalCover(filePath, response) {
    try {
      const content = await fs.readFile(filePath);
      response.writeHead(200, {
        ...this.securityHeaders(contentType(filePath)),
      });
      response.end(content);
    } catch (_) {
      this.notFound(response);
    }
  }

  resolveStaticPath(rootPath, relativePath) {
    const safePath = path.normalize(relativePath).replace(/^([/\\])+/, '');
    const filePath = path.resolve(rootPath, safePath);
    const relative = path.relative(path.resolve(rootPath), filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return null;
    }
    return filePath;
  }

  async sendStaticAsset(rootPath, relativePath, response) {
    const filePath = this.resolveStaticPath(rootPath, relativePath);
    if (!filePath) return this.notFound(response);
    try {
      const content = await fs.readFile(filePath);
      response.writeHead(200, {
        ...this.securityHeaders(contentType(filePath), {
          immutable: isImmutableAsset(relativePath),
        }),
      });
      response.end(content);
    } catch (_) {
      this.notFound(response);
    }
  }

  sendJson(response, body, statusCode = 200) {
    response.writeHead(
      statusCode,
      this.securityHeaders('application/json; charset=utf-8')
    );
    response.end(JSON.stringify(body));
  }

  notFound(response) {
    response.writeHead(404, this.securityHeaders('text/plain; charset=utf-8'));
    response.end('Not found');
  }

  securityHeaders(type, { immutable = false } = {}) {
    return {
      'Cache-Control': immutable
        ? 'public, max-age=31536000, immutable'
        : 'no-store',
      'Content-Type': type,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy':
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' http: https: blob: data:; img-src 'self' data: http: https:; base-uri 'none'; frame-ancestors 'none'",
    };
  }
}

export {
  ROOM_PORT,
  getLanAddress,
  getLanAddressCandidates,
  normalizePublicRoomConfig,
  selectLanAddress,
};
