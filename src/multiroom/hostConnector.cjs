'use strict';

const crypto = require('crypto');
const http = require('http');
const https = require('https');

const MAX_BODY = 2 * 1024 * 1024;
function allowed(method, raw) {
  if (
    typeof raw !== 'string' ||
    !raw.startsWith('/') ||
    raw.startsWith('//') ||
    /%2e|%2f|%5c|\\/i.test(raw) ||
    raw
      .split('?')[0]
      .split('/')
      .some(part => part === '.' || part === '..')
  )
    return false;
  const parsed = new URL(raw, 'http://localhost');
  const pathname = parsed.pathname;
  if (method === 'GET')
    return (
      pathname === '/room/' ||
      /^\/room\/artist-portraits\/\d+\.jpg$/.test(pathname) ||
      /^\/room\/(?:js|css|img|fonts)\/[\w./-]+\.(?:js|css|woff2?|ttf|svg|png|jpe?g|webp|gif|avif)$/i.test(
        pathname
      ) ||
      /^\/ktv\/api\/track\/\d{1,20}\/preview$/.test(pathname) ||
      /^\/ktv\/api\/(?:state|search|artists\/search|artists\/\d{1,20}\/tracks)$/.test(
        pathname
      ) ||
      /^\/ktv\/api\/(?:recommendations|toplists|playlists|local-playlists|(?:recommendations|toplists|playlists)\/\d{1,20}\/tracks)$/.test(
        pathname
      )
    );
  if (method === 'DELETE')
    return /^\/ktv\/api\/requests\/[\w-]{1,160}$/.test(pathname);
  return (
    method === 'POST' &&
    (/^\/ktv\/api\/(?:client-session|requests|next|reactions)$/.test(
      pathname
    ) ||
      /^\/ktv\/api\/requests\/[\w-]{1,160}\/front$/.test(pathname))
  );
}

function projectPublicPreviewResponse(body) {
  const data = JSON.parse(Buffer.from(body).toString('utf8'));
  const url = new URL(data.url);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    !/(^|\.)music\.126\.net$/i.test(url.hostname)
  )
    throw new Error('TRACK_NOT_PLAYABLE');
  url.protocol = 'https:';
  return Buffer.from(JSON.stringify({ url: url.toString() }));
}

function projectPublicLocalPlaylistResponse(body) {
  let value;
  try {
    value = JSON.parse(Buffer.from(body).toString('utf8'));
  } catch (_) {
    throw new Error('INVALID_PUBLIC_CATALOG_RESPONSE');
  }
  const playlists = Array.isArray(value && value.playlists)
    ? value.playlists
    : [];
  const safePlaylists = playlists
    .filter(
      playlist =>
        playlist &&
        /^local-playlist-[a-f0-9]{16}$/i.test(String(playlist.id || ''))
    )
    .map(playlist => {
      const tracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];
      const safeTracks = tracks
        .filter(
          track =>
            track &&
            /^local-[a-f0-9]{16}$/i.test(
              String(track.trackId || track.id || '')
            )
        )
        .map(track => ({
          trackId: String(track.trackId || track.id),
          source: 'local',
          name: typeof track.name === 'string' ? track.name.slice(0, 300) : '',
          artists: (Array.isArray(track.artists) ? track.artists : [])
            .map(artist =>
              typeof artist === 'string' ? artist : artist && artist.name
            )
            .filter(artist => typeof artist === 'string')
            .slice(0, 20)
            .map(artist => artist.slice(0, 200)),
          album:
            typeof track.album === 'string'
              ? track.album.slice(0, 300)
              : track.album && typeof track.album.name === 'string'
              ? track.album.name.slice(0, 300)
              : '',
          duration:
            Number.isFinite(track.duration) && track.duration >= 0
              ? track.duration
              : 0,
          playability: 'playable',
        }));
      return {
        id: String(playlist.id),
        name:
          typeof playlist.name === 'string'
            ? playlist.name.slice(0, 300)
            : '本地歌单',
        source: 'local',
        trackCount:
          Number.isSafeInteger(playlist.trackCount) && playlist.trackCount >= 0
            ? playlist.trackCount
            : safeTracks.length,
        tracks: safeTracks,
      };
    });
  return Buffer.from(JSON.stringify({ playlists: safePlaylists }));
}

function projectPublicUserPlaylistResponse(body) {
  let value;
  try {
    value = JSON.parse(Buffer.from(body).toString('utf8'));
  } catch (_) {
    throw new Error('INVALID_PUBLIC_CATALOG_RESPONSE');
  }
  const playlists = Array.isArray(value && value.playlists)
    ? value.playlists
    : [];
  const safePlaylists = playlists
    .filter(
      playlist => playlist && /^\d{1,20}$/.test(String(playlist.id || ''))
    )
    .map(playlist => {
      let coverUrl = '';
      if (
        typeof playlist.coverUrl === 'string' &&
        playlist.coverUrl.length <= 2048
      ) {
        try {
          const cover = new URL(playlist.coverUrl);
          const host = cover.hostname.toLowerCase();
          const ipv4 = host.split('.').map(Number);
          const privateAddress =
            ipv4.length === 4 &&
            ipv4.every(
              part => Number.isInteger(part) && part >= 0 && part <= 255
            ) &&
            (ipv4[0] === 10 ||
              ipv4[0] === 127 ||
              ipv4[0] === 0 ||
              (ipv4[0] === 169 && ipv4[1] === 254) ||
              (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31) ||
              (ipv4[0] === 192 && ipv4[1] === 168));
          if (
            cover.protocol === 'https:' &&
            !cover.username &&
            !cover.password &&
            !privateAddress &&
            host.includes('.') &&
            !host.endsWith('.local') &&
            !host.endsWith('.localhost') &&
            host !== 'localhost'
          )
            coverUrl = cover.toString();
        } catch (_) {}
      }
      return {
        id: String(playlist.id),
        name:
          typeof playlist.name === 'string'
            ? playlist.name.slice(0, 300)
            : '未命名歌单',
        trackCount:
          Number.isSafeInteger(playlist.trackCount) && playlist.trackCount >= 0
            ? playlist.trackCount
            : 0,
        coverUrl,
      };
    });
  const result = { playlists: safePlaylists };
  for (const key of ['offset', 'nextOffset', 'total'])
    if (Number.isSafeInteger(value[key]) && value[key] >= 0)
      result[key] = value[key];
  if (typeof value.hasMore === 'boolean') result.hasMore = value.hasMore;
  return Buffer.from(JSON.stringify(result));
}

function request(
  url,
  { method = 'GET', headers = {}, body = null, timeout = 25000 } = {}
) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(url, { method, headers, timeout }, res => {
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_BODY * 2) {
          req.destroy(new Error('RESPONSE_TOO_LARGE'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        })
      );
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('TIMEOUT')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function createHostConnector({
  gatewayOrigin,
  hostId,
  hostSecret,
  localPort,
  roomId = crypto.randomBytes(16).toString('hex'),
  onStatus = () => {},
}) {
  const base = new URL(gatewayOrigin);
  if (
    (base.protocol !== 'https:' &&
      !(
        base.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '::1'].includes(base.hostname)
      )) ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash
  )
    throw new Error('INVALID_GATEWAY_ORIGIN');
  if (
    !hostId ||
    !hostSecret ||
    !Number.isInteger(localPort) ||
    localPort < 1 ||
    localPort > 65535 ||
    !/^[a-f0-9]{32,64}$/.test(roomId)
  )
    throw new Error('INVALID_HOST_CONFIG');
  let active = false;
  let session = '';
  let delayTimer;
  let resumeDelay;
  let connectionStatus = '';
  function status(value) {
    if (connectionStatus !== value) {
      connectionStatus = value;
      onStatus(value);
    }
  }
  const call = (path, method, token, body, timeout) =>
    request(new URL(path, base), {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? Buffer.from(JSON.stringify(body)) : null,
      timeout,
    });
  async function register() {
    const result = await call(
      '/_gateway/register',
      'POST',
      hostSecret,
      { hostId, roomId },
      10000
    );
    if (result.status !== 201)
      throw new Error('REGISTER_FAILED_' + result.status);
    const data = JSON.parse(result.body.toString('utf8'));
    if (data.roomId !== roomId || !/^[a-f0-9]{64}$/.test(data.sessionToken))
      throw new Error('INVALID_GATEWAY_RESPONSE');
    session = data.sessionToken;
    if (!active) {
      try {
        await call('/_gateway/host/unregister', 'POST', session, null, 3000);
      } catch (_) {}
      session = '';
      return;
    }
    status('connected');
  }
  async function forward(job, jobSession) {
    if (
      !job ||
      !/^[a-f0-9]{32}$/.test(job.requestId) ||
      !allowed(job.method, job.path) ||
      typeof job.bodyBase64 !== 'string' ||
      job.bodyBase64.length > Math.ceil(MAX_BODY / 3) * 4
    )
      throw new Error('INVALID_REQUEST');
    const body = Buffer.from(job.bodyBase64, 'base64');
    const headers = {};
    for (const name of [
      'accept',
      'accept-language',
      'authorization',
      'content-type',
      'origin',
    ])
      if (
        job.headers &&
        typeof job.headers[name] === 'string' &&
        !/[\r\n]/.test(job.headers[name])
      )
        headers[name] = job.headers[name];
    const target = new URL(job.path, `http://127.0.0.1:${localPort}`);
    const response = await request(target, {
      method: job.method,
      headers,
      body: body.length ? body : null,
      timeout: 12000,
    });
    if (response.body.length > MAX_BODY) throw new Error('RESPONSE_TOO_LARGE');
    const safeHeaders = {};
    for (const name of [
      'content-type',
      'cache-control',
      'content-language',
      'etag',
      'last-modified',
      'retry-after',
    ])
      if (typeof response.headers[name] === 'string')
        safeHeaders[name] = response.headers[name];
    if (active && session === jobSession)
      await call(
        '/_gateway/host/result/' + job.requestId,
        'POST',
        jobSession,
        {
          status: response.status,
          headers: safeHeaders,
          bodyBase64: response.body.toString('base64'),
        },
        10000
      );
  }
  async function run() {
    while (active) {
      try {
        if (!session) await register();
        const response = await call(
          '/_gateway/host/poll',
          'GET',
          session,
          null,
          25000
        );
        if (response.status === 401) {
          session = '';
          continue;
        }
        if (response.status === 200 || response.status === 204)
          status('connected');
        if (response.status === 200) {
          const job = JSON.parse(response.body.toString('utf8'));
          // Handle independently so a slow search does not block the next poll.
          const jobSession = session;
          forward(job, jobSession).catch(() => {
            if (
              active &&
              session === jobSession &&
              job &&
              /^[a-f0-9]{32}$/.test(job.requestId)
            ) {
              call(
                '/_gateway/host/result/' + job.requestId,
                'POST',
                jobSession,
                {
                  status: 502,
                  headers: { 'content-type': 'application/json' },
                  bodyBase64: Buffer.from(
                    '{"error":"HOST_UNAVAILABLE"}'
                  ).toString('base64'),
                },
                10000
              ).catch(() => {});
            }
          });
        } else if (response.status !== 204)
          throw new Error('POLL_FAILED_' + response.status);
      } catch (_) {
        if (!active) break;
        status('reconnecting');
        await new Promise(resolve => {
          resumeDelay = resolve;
          delayTimer = setTimeout(resolve, 1500);
        });
        delayTimer = null;
        resumeDelay = null;
      }
    }
  }
  return {
    roomId,
    async start() {
      if (active) return;
      active = true;
      try {
        await register();
      } catch (error) {
        active = false;
        throw error;
      }
      if (active) run();
    },
    async stop() {
      active = false;
      if (delayTimer) {
        clearTimeout(delayTimer);
        resumeDelay();
      }
      if (session) {
        try {
          await call('/_gateway/host/unregister', 'POST', session, null, 3000);
        } catch (_) {}
      }
      session = '';
      status('stopped');
    },
  };
}

module.exports = {
  createHostConnector,
  allowed,
  projectPublicLocalPlaylistResponse,
  projectPublicUserPlaylistResponse,
  projectPublicPreviewResponse,
};
