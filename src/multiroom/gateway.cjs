'use strict';

/*
 * MULTIROOM GATEWAY PROTOCOL (Node 16+, HTTP long-poll reverse forwarding)
 * This HTTP server must sit behind trusted HTTPS termination on a private
 * listener; never expose host or guest credentials over public cleartext HTTP.
 *
 * Host credentials are preconfigured per hostId in hostCredentials. A host
 * registers POST /_gateway/register with its own Bearer secret and JSON
 * {hostId, roomId}, where roomId is 32-64 random lowercase hex characters.
 * The gateway replies 201 {roomId, sessionToken, expiresAt}; sessionToken is
 * a new, room-scoped 64-hex secret and is never sent to guests.
 *
 * The host long-polls GET /_gateway/host/poll with Bearer sessionToken. It
 * receives 200 {requestId, method, path, headers, bodyBase64}, or 204 when no
 * request arrives before pollTimeoutMs. `path` is the original local path
 * and query, without /r/<roomId>; guest authorization/cookie header values
 * are forwarded verbatim. The host executes only this gateway-authorized
 * local request, then POSTs /_gateway/host/result/<requestId> with the same
 * session bearer and JSON {status, headers, bodyBase64}; success is 204.
 * POST /_gateway/host/unregister with that bearer returns 204 and revokes the
 * room. Expiration removes the room and all its pending requests.
 *
 * Guests use /r/<roomId>/<allowed-local-path>. GET static assets are limited
 * to /room/; nested /room/{js,css,img,fonts}/ files with known extensions;
 * and /room/artist-portraits/<1-20 digits>.jpg. KTV GETs are limited to the
 * queue, search, artist, and safe catalog read APIs; the only KTV POSTs are
 * /client-session, /requests, and /reactions. Local playlist responses are
 * projected to metadata at this public boundary. The gateway never opens an
 * outbound socket or accepts a destination host from a guest.
 */

const crypto = require('crypto');
const http = require('http');
const {
  projectPublicLocalPlaylistResponse,
  projectPublicUserPlaylistResponse,
} = require('./hostConnector.cjs');

const DEFAULTS = {
  maxRooms: 128,
  maxPendingGlobal: 512,
  maxPendingPerRoom: 128,
  maxRequestBodyBytes: 1024 * 1024,
  maxResponseBodyBytes: 2 * 1024 * 1024,
  maxControlBodyBytes: 64 * 1024,
  requestTimeoutMs: 15000,
  pollTimeoutMs: 20000,
  roomTtlMs: 90000,
  sweepIntervalMs: 5000,
};

const SAFE_RESPONSE_HEADERS = new Set([
  'cache-control',
  'content-language',
  'content-type',
  'etag',
  'last-modified',
  'retry-after',
]);
const FORWARDED_GUEST_HEADERS = [
  'accept',
  'accept-language',
  'authorization',
  'content-type',
  'origin',
];

class GatewayError extends Error {
  constructor(statusCode, code) {
    super(code);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function digest(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new TypeError(`${name} must be a positive integer`);
  return value;
}

function timingSafeEqual(left, right) {
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function jsonResponse(response, statusCode, value) {
  if (response.writableEnded || response.destroyed) return;
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-length': body.length,
    'content-type': 'application/json; charset=utf-8',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

function emptyResponse(response, statusCode) {
  if (response.writableEnded || response.destroyed) return;
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-length': 0,
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  });
  response.end();
}

function fail(response, statusCode, code) {
  jsonResponse(response, statusCode, { error: code });
}

function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const contentLength = request.headers['content-length'];
    if (contentLength !== undefined) {
      if (!/^\d+$/.test(contentLength)) {
        reject(new GatewayError(400, 'INVALID_CONTENT_LENGTH'));
        request.resume();
        return;
      }
      if (Number(contentLength) > limit) {
        reject(new GatewayError(413, 'BODY_TOO_LARGE'));
        request.resume();
        return;
      }
    }

    const chunks = [];
    let total = 0;
    let tooLarge = false;
    request.on('data', chunk => {
      total += chunk.length;
      if (total > limit) {
        tooLarge = true;
        chunks.length = 0;
      } else if (!tooLarge) {
        chunks.push(chunk);
      }
    });
    request.on('error', reject);
    request.on('end', () => {
      if (tooLarge) reject(new GatewayError(413, 'BODY_TOO_LARGE'));
      else resolve(Buffer.concat(chunks, total));
    });
  });
}

async function readJson(request, limit) {
  const body = await readBody(request, limit);
  if (body.length === 0) throw new GatewayError(400, 'JSON_REQUIRED');
  try {
    const value = JSON.parse(body.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('object required');
    return value;
  } catch (_) {
    throw new GatewayError(400, 'INVALID_JSON');
  }
}

function parseTarget(target) {
  if (
    typeof target !== 'string' ||
    target.length > 8192 ||
    target[0] !== '/' ||
    target.indexOf('#') !== -1 ||
    target.indexOf('\\') !== -1 ||
    /[\u0000-\u0020\u007f]/.test(target)
  )
    return null;

  const queryAt = target.indexOf('?');
  const pathname = queryAt === -1 ? target : target.slice(0, queryAt);
  const query = queryAt === -1 ? '' : target.slice(queryAt);
  if (!/^\/[A-Za-z0-9/_\-.]*$/.test(pathname)) return null;
  if (pathname.includes('//')) return null;
  const segments = pathname.split('/');
  if (segments.some(segment => segment === '.' || segment === '..'))
    return null;
  return { pathname, pathAndQuery: pathname + query };
}

function isStaticRoomPath(pathname) {
  return (
    pathname === '/room/' ||
    /^\/room\/(?:js|css|img|fonts)\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:js|css|woff2?|ttf|svg|png|jpe?g|webp|gif|avif)$/i.test(
      pathname
    ) ||
    /^\/room\/artist-portraits\/\d{1,20}\.jpg$/i.test(pathname)
  );
}

function allowedGuestMethod(method, pathname) {
  if (
    method === 'GET' &&
    (isStaticRoomPath(pathname) ||
      pathname === '/ktv/api/state' ||
      pathname === '/ktv/api/search' ||
      pathname === '/ktv/api/artists/search' ||
      /^\/ktv\/api\/artists\/\d{1,20}\/tracks$/.test(pathname) ||
      /^\/ktv\/api\/(?:recommendations|toplists|playlists|local-playlists|(?:recommendations|toplists|playlists)\/\d{1,20}\/tracks)$/.test(
        pathname
      ))
  )
    return true;

  return (
    method === 'POST' &&
    (pathname === '/ktv/api/client-session' ||
      pathname === '/ktv/api/requests' ||
      pathname === '/ktv/api/reactions')
  );
}

function safeResponseHeaders(headers) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers))
    throw new GatewayError(400, 'INVALID_RESPONSE_HEADERS');
  const result = {};
  for (const name of Object.keys(headers)) {
    const normalized = name.toLowerCase();
    const value = headers[name];
    if (!SAFE_RESPONSE_HEADERS.has(normalized)) continue;
    if (
      typeof value !== 'string' ||
      value.length > 4096 ||
      /[\r\n\u0000]/.test(value)
    )
      throw new GatewayError(400, 'INVALID_RESPONSE_HEADERS');
    result[normalized] = value;
  }
  return result;
}

function decodeBase64(value, maximumBytes) {
  if (
    typeof value !== 'string' ||
    value.length > Math.ceil(maximumBytes / 3) * 4 + 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value
    )
  )
    throw new GatewayError(400, 'INVALID_BASE64');
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length > maximumBytes || decoded.toString('base64') !== value)
    throw new GatewayError(413, 'RESPONSE_TOO_LARGE');
  return decoded;
}

function createGateway(options) {
  const config = Object.assign({}, DEFAULTS, options || {});
  const hostCredentials = config.hostCredentials;
  if (
    !hostCredentials ||
    typeof hostCredentials !== 'object' ||
    Array.isArray(hostCredentials)
  )
    throw new TypeError(
      'hostCredentials must map hostId to its private credential'
    );

  for (const key of Object.keys(DEFAULTS))
    config[key] = positiveInteger(config[key], key);
  const hostCredentialDigests = new Map();
  for (const hostId of Object.keys(hostCredentials)) {
    const credential = hostCredentials[hostId];
    if (
      !/^[A-Za-z0-9_-]{1,64}$/.test(hostId) ||
      typeof credential !== 'string' ||
      credential.length < 16
    )
      throw new TypeError(
        'each host requires a valid hostId and at least 16 credential characters'
      );
    hostCredentialDigests.set(hostId, digest(credential));
  }

  const rooms = new Map();
  const sessionIndex = new Map();
  const pending = new Map();

  function touch(room) {
    room.lastSeenAt = Date.now();
  }

  function releasePending(entry) {
    if (!pending.has(entry.requestId)) return false;
    pending.delete(entry.requestId);
    clearTimeout(entry.timeout);
    if (entry.closeHandler)
      entry.response.removeListener('close', entry.closeHandler);
    const room = rooms.get(entry.roomId);
    if (room) room.pendingCount = Math.max(0, room.pendingCount - 1);
    return true;
  }

  function settlePending(entry, statusCode, body) {
    if (!pending.has(entry.requestId)) return;
    releasePending(entry);
    if (entry.response.writableEnded || entry.response.destroyed) return;
    if (statusCode === 504) fail(entry.response, 504, 'HOST_RESPONSE_TIMEOUT');
    else if (statusCode === 410) fail(entry.response, 410, 'ROOM_UNAVAILABLE');
    else {
      const headers = safeResponseHeaders(body.headers);
      let responseStatus = body.status;
      let responseBody = decodeBase64(
        body.bodyBase64,
        config.maxResponseBodyBytes
      );
      if (responseStatus >= 200 && responseStatus < 300) {
        const pathname = entry.payload.path.split('?')[0];
        const project =
          pathname === '/ktv/api/local-playlists'
            ? projectPublicLocalPlaylistResponse
            : pathname === '/ktv/api/playlists'
            ? projectPublicUserPlaylistResponse
            : null;
        if (project) {
          try {
            responseBody = project(responseBody);
          } catch (_) {
            responseStatus = 502;
            responseBody = Buffer.from(
              '{"error":"INVALID_PUBLIC_CATALOG_RESPONSE"}'
            );
          }
          headers['content-type'] = 'application/json; charset=utf-8';
        }
      }
      headers['cache-control'] = 'no-store';
      headers['referrer-policy'] = 'no-referrer';
      headers['x-content-type-options'] = 'nosniff';
      if (responseStatus === 204 || responseStatus === 304) {
        delete headers['content-length'];
        delete headers['content-type'];
      } else {
        if (!headers['content-type'])
          headers['content-type'] = 'application/octet-stream';
        headers['content-length'] = responseBody.length;
      }
      entry.response.writeHead(responseStatus, headers);
      entry.response.end(
        responseStatus === 204 || responseStatus === 304
          ? undefined
          : responseBody
      );
    }
  }

  function expireRoom(room) {
    if (!rooms.has(room.roomId)) return;
    rooms.delete(room.roomId);
    sessionIndex.delete(room.sessionDigest);
    if (room.pollTimer) clearTimeout(room.pollTimer);
    if (room.pollResponse) {
      if (room.pollCloseHandler)
        room.pollResponse.removeListener('close', room.pollCloseHandler);
      emptyResponse(room.pollResponse, 410);
      room.pollResponse = null;
      room.pollCloseHandler = null;
    }
    for (const entry of Array.from(pending.values())) {
      if (entry.roomId === room.roomId) settlePending(entry, 410);
    }
  }

  function expireStaleRooms() {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (now - room.lastSeenAt >= config.roomTtlMs) expireRoom(room);
    }
  }

  function roomForSession(request) {
    const authorization = request.headers.authorization;
    const match =
      typeof authorization === 'string' &&
      authorization.match(/^Bearer ([A-Fa-f0-9]{64})$/);
    if (!match) return null;
    const key = digest(match[1]).toString('hex');
    const roomId = sessionIndex.get(key);
    if (!roomId) return null;
    const room = rooms.get(roomId);
    if (
      !room ||
      !timingSafeEqual(digest(match[1]), Buffer.from(room.sessionDigest, 'hex'))
    )
      return null;
    return room;
  }

  function hostAuthorized(hostId, authorization) {
    const expected = hostCredentialDigests.get(hostId);
    const match =
      typeof authorization === 'string' && authorization.match(/^Bearer (.+)$/);
    if (!expected || !match || match[1].length > 4096) return false;
    return timingSafeEqual(digest(match[1]), expected);
  }

  function dispatch(room) {
    if (!room.pollResponse || room.queue.length === 0) return;
    const response = room.pollResponse;
    if (room.pollCloseHandler)
      response.removeListener('close', room.pollCloseHandler);
    room.pollResponse = null;
    room.pollCloseHandler = null;
    clearTimeout(room.pollTimer);
    room.pollTimer = null;
    while (room.queue.length) {
      const requestId = room.queue.shift();
      const entry = pending.get(requestId);
      if (!entry) continue;
      entry.state = 'delivered';
      touch(room);
      jsonResponse(response, 200, entry.payload);
      return;
    }
    emptyResponse(response, 204);
  }

  async function handleRegister(request, response) {
    const body = await readJson(request, config.maxControlBodyBytes);
    const keys = Object.keys(body).sort();
    if (
      keys.length !== 2 ||
      keys[0] !== 'hostId' ||
      keys[1] !== 'roomId' ||
      typeof body.hostId !== 'string' ||
      typeof body.roomId !== 'string' ||
      !/^[a-f0-9]{32,64}$/.test(body.roomId)
    )
      throw new GatewayError(400, 'INVALID_REGISTRATION');
    if (!hostAuthorized(body.hostId, request.headers.authorization))
      throw new GatewayError(401, 'UNAUTHORIZED_HOST');
    expireStaleRooms();
    if (rooms.has(body.roomId)) throw new GatewayError(409, 'ROOM_ID_IN_USE');
    if (rooms.size >= config.maxRooms)
      throw new GatewayError(503, 'ROOM_LIMIT_REACHED');

    const sessionToken = randomHex(32);
    const sessionDigest = digest(sessionToken).toString('hex');
    const room = {
      roomId: body.roomId,
      hostId: body.hostId,
      sessionDigest,
      lastSeenAt: Date.now(),
      queue: [],
      pendingCount: 0,
      pollResponse: null,
      pollCloseHandler: null,
      pollTimer: null,
    };
    rooms.set(room.roomId, room);
    sessionIndex.set(sessionDigest, room.roomId);
    jsonResponse(response, 201, {
      roomId: room.roomId,
      sessionToken,
      expiresAt: room.lastSeenAt + config.roomTtlMs,
    });
  }

  async function handlePoll(request, response) {
    const room = roomForSession(request);
    if (!room) throw new GatewayError(401, 'UNAUTHORIZED_SESSION');
    touch(room);
    if (room.pollResponse) throw new GatewayError(409, 'POLL_ALREADY_ACTIVE');
    if (room.queue.length) {
      room.pollResponse = response;
      dispatch(room);
      return;
    }
    room.pollResponse = response;
    room.pollCloseHandler = () => {
      if (room.pollResponse !== response) return;
      room.pollResponse = null;
      room.pollCloseHandler = null;
      clearTimeout(room.pollTimer);
      room.pollTimer = null;
    };
    response.once('close', room.pollCloseHandler);
    room.pollTimer = setTimeout(() => {
      response.removeListener('close', room.pollCloseHandler);
      room.pollResponse = null;
      room.pollCloseHandler = null;
      room.pollTimer = null;
      emptyResponse(response, 204);
    }, Math.min(config.pollTimeoutMs, config.roomTtlMs));
  }

  async function handleResult(request, response, requestId) {
    const room = roomForSession(request);
    if (!room) throw new GatewayError(401, 'UNAUTHORIZED_SESSION');
    const entry = pending.get(requestId);
    if (!entry || entry.roomId !== room.roomId || entry.state !== 'delivered')
      throw new GatewayError(404, 'REQUEST_NOT_FOUND');
    const body = await readJson(
      request,
      Math.ceil(config.maxResponseBodyBytes / 3) * 4 +
        config.maxControlBodyBytes
    );
    if (pending.get(requestId) !== entry || rooms.get(room.roomId) !== room)
      throw new GatewayError(404, 'REQUEST_NOT_FOUND');
    const keys = Object.keys(body).sort();
    if (
      keys.some(key => !['bodyBase64', 'headers', 'status'].includes(key)) ||
      !body.headers ||
      typeof body.headers !== 'object' ||
      Array.isArray(body.headers) ||
      !Number.isInteger(body.status) ||
      body.status < 200 ||
      body.status > 599 ||
      typeof body.bodyBase64 !== 'string'
    )
      throw new GatewayError(400, 'INVALID_RESPONSE');
    safeResponseHeaders(body.headers);
    const responseBody = decodeBase64(
      body.bodyBase64,
      config.maxResponseBodyBytes
    );
    if ((body.status === 204 || body.status === 304) && responseBody.length)
      throw new GatewayError(400, 'BODY_NOT_ALLOWED_FOR_STATUS');
    touch(room);
    settlePending(entry, body.status, body);
    emptyResponse(response, 204);
  }

  async function handleUnregister(request, response) {
    const room = roomForSession(request);
    if (!room) throw new GatewayError(401, 'UNAUTHORIZED_SESSION');
    const body = await readBody(request, config.maxControlBodyBytes);
    if (body.length !== 0) throw new GatewayError(400, 'EMPTY_BODY_REQUIRED');
    expireRoom(room);
    emptyResponse(response, 204);
  }

  async function handleGuest(request, response, parsedTarget) {
    const match = parsedTarget.pathname.match(/^\/r\/([a-f0-9]{32,64})(\/.*)$/);
    if (!match) throw new GatewayError(404, 'NOT_FOUND');
    const roomId = match[1];
    const room = rooms.get(roomId);
    if (!room) throw new GatewayError(410, 'ROOM_UNAVAILABLE');
    const localTarget = parseTarget(
      match[2] + parsedTarget.pathAndQuery.slice(parsedTarget.pathname.length)
    );
    if (!localTarget) throw new GatewayError(400, 'INVALID_PATH');

    if (!allowedGuestMethod(request.method, localTarget.pathname)) {
      const pathIsAllowlisted =
        isStaticRoomPath(localTarget.pathname) ||
        /^\/ktv\/api\/(?:state|search|artists\/search|artists\/\d{1,20}\/tracks|client-session|requests|reactions|recommendations|toplists|playlists|local-playlists|(?:recommendations|toplists|playlists)\/\d{1,20}\/tracks)$/.test(
          localTarget.pathname
        );
      throw new GatewayError(
        pathIsAllowlisted ? 405 : 404,
        pathIsAllowlisted ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND'
      );
    }

    const body = await readBody(request, config.maxRequestBodyBytes);
    expireStaleRooms();
    if (!rooms.has(roomId)) throw new GatewayError(410, 'ROOM_UNAVAILABLE');
    if (
      room.pendingCount >= config.maxPendingPerRoom ||
      pending.size >= config.maxPendingGlobal
    )
      throw new GatewayError(503, 'GATEWAY_BUSY');

    const requestId = randomHex(16);
    const headers = {};
    for (const name of FORWARDED_GUEST_HEADERS) {
      const value = request.headers[name];
      if (typeof value === 'string') headers[name] = value;
    }
    const entry = {
      requestId,
      roomId,
      response,
      state: 'queued',
      payload: {
        requestId,
        method: request.method,
        path: localTarget.pathAndQuery,
        headers,
        bodyBase64: body.toString('base64'),
      },
      timeout: setTimeout(
        () => settlePending(entry, 504),
        config.requestTimeoutMs
      ),
    };
    entry.closeHandler = () => releasePending(entry);
    response.once('close', entry.closeHandler);
    pending.set(requestId, entry);
    room.pendingCount += 1;
    room.queue.push(requestId);
    dispatch(room);
  }

  async function route(request, response) {
    expireStaleRooms();
    const parsedTarget = parseTarget(request.url);
    if (!parsedTarget) throw new GatewayError(400, 'INVALID_PATH');

    if (
      parsedTarget.pathname === '/_gateway/register' &&
      request.method === 'POST'
    )
      return handleRegister(request, response);
    if (
      parsedTarget.pathname === '/_gateway/host/poll' &&
      request.method === 'GET'
    )
      return handlePoll(request, response);
    if (
      parsedTarget.pathname === '/_gateway/host/unregister' &&
      request.method === 'POST'
    )
      return handleUnregister(request, response);
    const resultMatch = parsedTarget.pathname.match(
      /^\/_gateway\/host\/result\/([a-f0-9]{32})$/
    );
    if (resultMatch && request.method === 'POST')
      return handleResult(request, response, resultMatch[1]);
    if (parsedTarget.pathname.startsWith('/_gateway/'))
      throw new GatewayError(404, 'NOT_FOUND');
    return handleGuest(request, response, parsedTarget);
  }

  const server = http.createServer((request, response) => {
    Promise.resolve(route(request, response)).catch(error => {
      if (response.writableEnded || response.destroyed) return;
      if (error instanceof GatewayError)
        fail(response, error.statusCode, error.code);
      else fail(response, 500, 'GATEWAY_ERROR');
    });
  });
  const sweepTimer = setInterval(expireStaleRooms, config.sweepIntervalMs);
  if (typeof sweepTimer.unref === 'function') sweepTimer.unref();
  server.on('close', () => {
    clearInterval(sweepTimer);
    for (const room of Array.from(rooms.values())) expireRoom(room);
  });
  server.gatewayLimits = Object.freeze({
    maxRooms: config.maxRooms,
    maxPendingGlobal: config.maxPendingGlobal,
    maxPendingPerRoom: config.maxPendingPerRoom,
    maxRequestBodyBytes: config.maxRequestBodyBytes,
    maxResponseBodyBytes: config.maxResponseBodyBytes,
    requestTimeoutMs: config.requestTimeoutMs,
    pollTimeoutMs: config.pollTimeoutMs,
    roomTtlMs: config.roomTtlMs,
  });
  return server;
}

module.exports = { createGateway };
