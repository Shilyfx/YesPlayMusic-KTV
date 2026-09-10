import crypto from 'crypto';
import http from 'http';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { createReadStream } from 'fs';
import QRCode from 'qrcode';

const ROOM_PORT = 27233;
const DEFAULT_ROOM_NAME = 'Shilyfx的KTV';
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
  }) {
    this.remoteDistPath = remoteDistPath;
    this.port = port;
    this.networkInterfaces = networkInterfaces;
    this.listen = listen;
    this.remoteApi = remoteApi;
    this.remoteService = remoteService;
    this.localLibrary = localLibrary;
    this.server = null;
    this.room = null;
    this.state = 'idle';
    this.startPromise = null;
    this.generation = 0;
  }

  setRemoteApi(remoteApi, remoteService) {
    this.remoteApi = remoteApi;
    this.remoteService = remoteService;
  }

  setLocalLibrary(localLibrary) {
    this.localLibrary = localLibrary;
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
      return this.describeRoom();
    } catch (error) {
      this.room = null;
      this.server = null;
      this.state = 'idle';
      server.close();
      throw error;
    }
  }

  async stopRoom() {
    this.generation += 1;
    if (this.remoteService) this.remoteService.onRoomStop();
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
    const url = `http://${this.room.lanAddress}:${this.port}/room/${this.room.code}/#token=${this.room.token}`;
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
      url,
      joinUrl: url,
      candidates: this.room.candidates,
      selectedAddress: this.room.lanAddress,
      qrDataUrl,
      qrError,
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

  async handleRequest(request, response) {
    // `URL` normalizes encoded dot segments before we can compare them to the
    // room prefix. Remote assets never need encoded separators or dot segments,
    // so reject those raw forms before URL parsing.
    const rawPath = request.url.split(/[?#]/)[0];
    if (/%2e|%2f|%5c|\\/i.test(rawPath)) return this.notFound(response);
    const requestUrl = new URL(request.url, 'http://karaoke.local');
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

    const roomPath = `/room/${this.room && this.room.code}`;
    if (
      !this.room ||
      (requestUrl.pathname !== roomPath &&
        !requestUrl.pathname.startsWith(`${roomPath}/`))
    ) {
      return this.notFound(response);
    }

    const requestedPath = requestUrl.pathname.slice(roomPath.length);
    const relativePath = requestedPath === '/' ? '/index.html' : requestedPath;
    return this.sendRemoteAsset(relativePath, response);
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

  sendJson(response, body) {
    response.writeHead(
      200,
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

export { ROOM_PORT, getLanAddress, getLanAddressCandidates, selectLanAddress };
