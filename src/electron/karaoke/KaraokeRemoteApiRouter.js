import { RATE_LIMIT_WINDOW_MS } from './KaraokeRemoteSessionState.js';

export const DEFAULT_CATALOG_PAGE_SIZE = 100;
const MAX_CATALOG_PAGE_SIZE = 100;

function json(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
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

function parseCatalogPageRequest(url) {
  const hasOffset = url.searchParams.has('offset');
  const hasLimit = url.searchParams.has('limit');
  if (!hasOffset && !hasLimit)
    return { valid: true, paginated: false, options: null };

  const parseInteger = (value, fallback) => {
    if (value == null) return fallback;
    if (!/^\d+$/.test(value)) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : null;
  };
  const offset = parseInteger(url.searchParams.get('offset'), 0);
  const limit = parseInteger(
    url.searchParams.get('limit'),
    DEFAULT_CATALOG_PAGE_SIZE
  );
  if (
    offset == null ||
    limit == null ||
    limit < 1 ||
    limit > MAX_CATALOG_PAGE_SIZE ||
    offset + limit > Number.MAX_SAFE_INTEGER
  ) {
    return { valid: false, paginated: true, options: null };
  }
  return { valid: true, paginated: true, options: { offset, limit } };
}

export class RemoteApiRouter {
  constructor(service) {
    this.service = service;
  }

  async handle(request, response, publicGuest = false) {
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
            publicGuest ? 'public' : request.socket.remoteAddress || '',
            publicGuest
          )
        );
      }
      const client = this.service.client(bearer(request), publicGuest);
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
      if (url.pathname === '/ktv/api/playlists' && request.method === 'GET') {
        const pageRequest = parseCatalogPageRequest(url);
        if (!pageRequest.valid)
          return error(response, 400, 'INVALID_PAGINATION');
        const result = await this.service.playlists(client, {
          force: url.searchParams.get('force') === '1',
          ...(pageRequest.options || {}),
        });
        if (!pageRequest.paginated)
          return json(response, 200, {
            playlists: Array.isArray(result) ? result : result.playlists || [],
          });
        if (Array.isArray(result)) {
          const page = result.slice(
            pageRequest.options.offset,
            pageRequest.options.offset + pageRequest.options.limit
          );
          return json(response, 200, {
            playlists: page,
            offset: pageRequest.options.offset,
            nextOffset: pageRequest.options.offset + page.length,
            total: result.length,
            hasMore: pageRequest.options.offset + page.length < result.length,
          });
        }
        return json(response, 200, result);
      }
      if (
        url.pathname === '/ktv/api/local-playlists' &&
        request.method === 'GET'
      ) {
        return json(response, 200, {
          playlists: await this.service.localPlaylists(client),
        });
      }
      if (
        url.pathname === '/ktv/api/recommendations' &&
        request.method === 'GET'
      ) {
        return json(response, 200, {
          playlists: await this.service.recommendations(client),
        });
      }
      if (url.pathname === '/ktv/api/toplists' && request.method === 'GET') {
        return json(response, 200, {
          playlists: await this.service.toplists(client),
        });
      }
      const recommendationTracks = url.pathname.match(
        /^\/ktv\/api\/recommendations\/(\d{1,20})\/tracks$/
      );
      if (recommendationTracks && request.method === 'GET') {
        return json(response, 200, {
          tracks: await this.service.recommendationTracks(
            client,
            recommendationTracks[1]
          ),
        });
      }
      const toplistTracks = url.pathname.match(
        /^\/ktv\/api\/toplists\/(\d{1,20})\/tracks$/
      );
      if (toplistTracks && request.method === 'GET') {
        return json(response, 200, {
          tracks: await this.service.toplistTracks(client, toplistTracks[1]),
        });
      }
      if (
        url.pathname === '/ktv/api/artists/search' &&
        request.method === 'GET'
      ) {
        const query = (url.searchParams.get('q') || '').trim();
        if (!query || query.length > 80)
          return error(response, 400, 'INVALID_QUERY');
        return json(response, 200, {
          artists: await this.service.artistSearch(client, query),
        });
      }
      const artistTracks = url.pathname.match(
        /^\/ktv\/api\/artists\/(\d{1,20})\/tracks$/
      );
      if (artistTracks && request.method === 'GET') {
        const pageRequest = parseCatalogPageRequest(url);
        if (!pageRequest.valid)
          return error(response, 400, 'INVALID_PAGINATION');
        if (!pageRequest.paginated)
          return json(response, 200, {
            tracks: await this.service.artistTracks(client, artistTracks[1]),
          });
        return json(
          response,
          200,
          await this.service.artistTracksPage(
            client,
            artistTracks[1],
            pageRequest.options
          )
        );
      }
      const playlistTracks = url.pathname.match(
        /^\/ktv\/api\/playlists\/(\d{1,20})\/tracks$/
      );
      if (playlistTracks && request.method === 'GET') {
        const pageRequest = parseCatalogPageRequest(url);
        if (!pageRequest.valid)
          return error(response, 400, 'INVALID_PAGINATION');
        if (!pageRequest.paginated)
          return json(response, 200, {
            tracks: await this.service.playlistTracks(
              client,
              playlistTracks[1]
            ),
          });
        const page = await this.service.playlistTracks(
          client,
          playlistTracks[1],
          pageRequest.options
        );
        return json(
          response,
          200,
          Array.isArray(page) ? { tracks: page } : page
        );
      }
      const availability = url.pathname.match(
        /^\/ktv\/api\/track\/((?:\d{1,20}|local-[a-f0-9]{16}))\/availability$/i
      );
      if (availability && request.method === 'GET') {
        return json(response, 200, {
          playability: await this.service.availability(client, availability[1]),
        });
      }
      const preview = url.pathname.match(
        /^\/ktv\/api\/track\/(\d{1,20})\/preview$/
      );
      if (preview && request.method === 'GET') {
        return json(response, 200, {
          url: await this.service.preview(client, preview[1]),
        });
      }
      if (url.pathname === '/ktv/api/requests' && request.method === 'POST') {
        if (!/^application\/json/.test(request.headers['content-type'] || ''))
          return error(response, 415, 'JSON_REQUIRED');
        const body = await readJson(request);
        if (
          body.requestId !== undefined &&
          (typeof body.requestId !== 'string' ||
            !/^[A-Za-z0-9_-]{16,128}$/.test(body.requestId))
        )
          return error(response, 400, 'INVALID_REQUEST_ID');
        const trackId = String(body.trackId || '');
        if (publicGuest && !/^\d{1,20}$/.test(trackId)) {
          if (!/^local-[a-f0-9]{16}$/.test(trackId))
            return error(response, 400, 'INVALID_TRACK');
          const localPlaylists = await this.service.localPlaylists(client);
          const indexedTrack = localPlaylists.some(playlist =>
            (playlist.tracks || []).some(
              track => String(track.trackId || track.id || '') === trackId
            )
          );
          if (!indexedTrack) return error(response, 400, 'INVALID_TRACK');
        }
        if (
          !/^(?:\d{1,20}|local-[a-f0-9]{16})$/i.test(String(body.trackId || ''))
        )
          return error(response, 400, 'INVALID_TRACK');
        return json(response, 201, {
          item: await this.service.enqueue(
            client,
            body.trackId,
            !publicGuest && body.priority === true,
            body.requestId
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
      if (url.pathname === '/ktv/api/next' && request.method === 'POST') {
        return json(response, 200, {
          item: await this.service.next(client),
        });
      }
      return error(response, 404, 'NOT_FOUND');
    } catch (exception) {
      const messages = {
        INVALID_JOIN_TOKEN: [401, 'INVALID_JOIN_TOKEN'],
        INVALID_CLIENT_TOKEN: [401, 'INVALID_CLIENT_TOKEN'],
        ROOM_ENDED: [410, 'ROOM_ENDED'],
        FORBIDDEN: [403, 'FORBIDDEN'],
        RATE_LIMIT: [429, 'RATE_LIMIT'],
        IDEMPOTENCY_CAPACITY: [429, 'IDEMPOTENCY_CAPACITY'],
        ROOM_FULL: [429, 'ROOM_FULL'],
        TRACK_NOT_PLAYABLE: [409, 'TRACK_NOT_PLAYABLE'],
        IDEMPOTENCY_KEY_REUSED: [409, 'IDEMPOTENCY_KEY_REUSED'],
        INVALID_REQUEST_ID: [400, 'INVALID_REQUEST_ID'],
        TRACK_NOT_FOUND: [404, 'TRACK_NOT_FOUND'],
        KTV_NOT_ACTIVE: [409, 'KTV_NOT_ACTIVE'],
        HOST_NOT_LOGGED_IN: [409, 'HOST_NOT_LOGGED_IN'],
        PLAYLIST_NOT_FOUND: [404, 'PLAYLIST_NOT_FOUND'],
        ARTIST_NOT_FOUND: [404, 'ARTIST_NOT_FOUND'],
        WAITING_ITEM_NOT_FOUND: [404, 'WAITING_ITEM_NOT_FOUND'],
        BODY_TOO_LARGE: [413, 'BODY_TOO_LARGE'],
        INVALID_JSON: [400, 'INVALID_JSON'],
        INVALID_PAGINATION: [400, 'INVALID_PAGINATION'],
      };
      // 上游（网易云）风控经主屏桥接后只剩消息文本，这里还原为 429 + 等待时间，
      // 让点歌端走“稍后自动更新”的退避路径，而不是笼统的 502。
      const upstreamLimit = /^UPSTREAM_RATE_LIMIT(?::(\d+))?$/.exec(
        exception.message || ''
      );
      if (upstreamLimit) {
        exception.message = 'RATE_LIMIT';
        exception.retryAfterMs = Number(upstreamLimit[1]) || 6000;
      }
      const [status, message] = messages[exception.message] || [
        502,
        'REMOTE_UNAVAILABLE',
      ];
      if (
        status === 429 &&
        message === 'RATE_LIMIT' &&
        Number.isSafeInteger(exception.retryAfterMs) &&
        exception.retryAfterMs > 0
      ) {
        const retryAfterMs = Math.min(
          RATE_LIMIT_WINDOW_MS,
          exception.retryAfterMs
        );
        return json(
          response,
          status,
          { error: message, retryAfterMs },
          { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) }
        );
      }
      return error(response, status, message);
    }
  }
}
