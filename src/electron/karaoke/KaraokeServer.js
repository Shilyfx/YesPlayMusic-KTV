import crypto from 'crypto';
import http from 'http';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import QRCode from 'qrcode';

const ROOM_PORT = 27233;
const roomCode = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const roomToken = () => crypto.randomBytes(32).toString('base64url');

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
      /tailscale|vmware|virtual|wireguard|docker|loopback|nodebabylink/i.test(
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
  return 'text/html; charset=utf-8';
}

export class KaraokeServer {
  constructor({
    remoteDistPath,
    port = ROOM_PORT,
    networkInterfaces = () => os.networkInterfaces(),
    remoteApi = null,
    remoteService = null,
  }) {
    this.remoteDistPath = remoteDistPath;
    this.port = port;
    this.networkInterfaces = networkInterfaces;
    this.remoteApi = remoteApi;
    this.remoteService = remoteService;
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

  async startRoom({ lanAddress, sessionId } = {}) {
    if (this.room) return this.describeRoom();
    if (this.startPromise) return this.startPromise;
    if (!sessionId) throw new Error('缺少有效的 KTV Session');
    this.startPromise = this._startRoom({ lanAddress, sessionId });
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async _startRoom({ lanAddress, sessionId }) {
    const generation = (this.generation += 1);
    const candidates = getLanAddressCandidates(this.networkInterfaces());
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
        server.listen(this.port, '0.0.0.0', () => {
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
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise(resolve => server.close(resolve));
  }

  async describeRoom() {
    if (!this.room) return null;
    const url = `http://${this.room.lanAddress}:${this.port}/room/${this.room.code}/#token=${this.room.token}`;
    return {
      code: this.room.code,
      url,
      candidates: this.room.candidates,
      selectedAddress: this.room.lanAddress,
      qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 280 }),
    };
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

  async sendStaticAsset(rootPath, relativePath, response) {
    const safePath = path.normalize(relativePath).replace(/^([/\\])+/, '');
    const filePath = path.resolve(rootPath, safePath);
    const relative = path.relative(path.resolve(rootPath), filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return this.notFound(response);
    }
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

  securityHeaders(type) {
    return {
      'Cache-Control': 'no-store',
      'Content-Type': type,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy':
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
    };
  }
}

export { ROOM_PORT, getLanAddress, getLanAddressCandidates, selectLanAddress };
