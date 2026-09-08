import crypto from 'crypto';
import http from 'http';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import QRCode from 'qrcode';

const ROOM_PORT = 27233;
const roomCode = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const roomToken = () => crypto.randomBytes(32).toString('base64url');

function getLanAddress() {
  const interfaces = os.networkInterfaces();
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal)
        return address.address;
    }
  }
  return null;
}

function contentType(filePath) {
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.png')) return 'image/png';
  return 'text/html; charset=utf-8';
}

export class KaraokeServer {
  constructor({ remoteDistPath, publicDistPath }) {
    this.remoteDistPath = remoteDistPath;
    this.publicDistPath = publicDistPath;
    this.server = null;
    this.room = null;
  }

  async startRoom() {
    if (this.room) return this.describeRoom();
    const lanAddress = getLanAddress();
    if (!lanAddress) throw new Error('未找到可用的局域网 IPv4 地址');

    this.room = { code: roomCode(), token: roomToken(), lanAddress };
    this.server = http.createServer((request, response) =>
      this.handleRequest(request, response)
    );

    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(ROOM_PORT, '0.0.0.0', () => {
        this.server.off('error', reject);
        resolve();
      });
    });
    return this.describeRoom();
  }

  async stopRoom() {
    this.room = null;
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise(resolve => server.close(resolve));
  }

  async describeRoom() {
    if (!this.room) return null;
    const url = `http://${this.room.lanAddress}:${ROOM_PORT}/room/${this.room.code}?token=${this.room.token}`;
    return {
      code: this.room.code,
      url,
      qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 280 }),
    };
  }

  async handleRequest(request, response) {
    const requestUrl = new URL(request.url, 'http://karaoke.local');
    if (request.method !== 'GET') return this.notFound(response);
    if (requestUrl.pathname === '/health') {
      return this.sendJson(response, { active: Boolean(this.room) });
    }

    if (/^\/(?:css|img|js)\//.test(requestUrl.pathname)) {
      return this.sendStaticAsset(
        this.publicDistPath,
        requestUrl.pathname,
        response
      );
    }

    const roomPath = `/room/${this.room?.code}`;
    if (
      !this.room ||
      !requestUrl.pathname.startsWith(roomPath) ||
      requestUrl.searchParams.get('token') !== this.room.token
    ) {
      return this.notFound(response);
    }

    const relativePath =
      requestUrl.pathname.slice(roomPath.length) || '/index.html';
    return this.sendRemoteAsset(relativePath, response);
  }

  async sendRemoteAsset(relativePath, response) {
    return this.sendStaticAsset(this.remoteDistPath, relativePath, response);
  }

  async sendStaticAsset(rootPath, relativePath, response) {
    const safePath = path.normalize(relativePath).replace(/^([/\\])+/, '');
    const filePath = path.resolve(rootPath, safePath);
    if (!filePath.startsWith(path.resolve(rootPath))) {
      return this.notFound(response);
    }
    try {
      const content = await fs.readFile(filePath);
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': contentType(filePath),
      });
      response.end(content);
    } catch (_) {
      this.notFound(response);
    }
  }

  sendJson(response, body) {
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    });
    response.end(JSON.stringify(body));
  }

  notFound(response) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}

export { ROOM_PORT, getLanAddress };
