import { search } from '@/api/others';
import { getMP3, getTrackDetail } from '@/api/track';
import { getPlaylistDetail, recommendPlaylist, toplists } from '@/api/playlist';
import { getRecommendPlayList } from '@/utils/playList';
import { getArtist } from '@/api/artist';
import { userPlaylist } from '@/api/user';
import { isAccountLoggedIn } from '@/utils/auth';
import createUserPlaylistCache from './userPlaylistCache';

export function assertExpectedKaraokeSession(manager, expected) {
  const session = manager.getSnapshot().session;
  if (
    !expected ||
    session.status !== 'active' ||
    session.sessionId !== expected.sessionId
  ) {
    throw new Error('ROOM_ENDED');
  }
}

function safeCatalogTrack(track) {
  return {
    id: track.id,
    name: track.name,
    ar: (track.ar || track.artists || []).map(artist => ({
      name: artist.name,
    })),
    al: {
      name: track.al?.name || track.album?.name || '',
      picUrl: track.al?.picUrl || track.album?.picUrl || '',
    },
    dt: track.dt || track.duration || 0,
    alia: track.alia || track.aliases || [],
  };
}

function safePlaylist(playlist) {
  return {
    id: String(playlist.id),
    name: playlist.name || '未命名歌单',
    trackCount: Number(playlist.trackCount || 0),
    coverUrl: playlist.coverImgUrl || playlist.picUrl || '',
    creatorName: playlist.creator?.nickname || '',
  };
}

function safeArtist(artist) {
  return {
    id: String(artist.id),
    name: artist.name || '未知歌手',
    coverUrl: artist.picUrl || artist.img1v1Url || artist.avatar || '',
    albumCount: Number(artist.albumSize || artist.albumCount || 0),
    mvCount: Number(artist.mvSize || artist.mvCount || 0),
  };
}

const userPlaylistCache = createUserPlaylistCache();
const HOST_CATALOG_PAGE_SIZE = 100;
const HOST_CATALOG_PAGE_MAX_BYTES = 512 * 1024;
const HOST_CATALOG_PAGE_TTL = 45 * 1000;
const MAX_HOST_CATALOG_PAGE_CACHE_ENTRIES = 256;
const MAX_USER_PLAYLIST_ALLOWLIST_IDS =
  HOST_CATALOG_PAGE_SIZE * MAX_HOST_CATALOG_PAGE_CACHE_ENTRIES;
const hostCatalogPageCache = new Map();
const userPlaylistAllowlistById = new Map();
const artistCatalogPageSignatures = new Map();

function hasCatalogPageRequest(payload = {}) {
  return (
    Object.prototype.hasOwnProperty.call(payload, 'offset') ||
    Object.prototype.hasOwnProperty.call(payload, 'limit')
  );
}

function catalogPageOptions(payload = {}) {
  const offset = Number(payload.offset ?? 0);
  const limit = Number(payload.limit ?? HOST_CATALOG_PAGE_SIZE);
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > HOST_CATALOG_PAGE_SIZE ||
    offset + limit > Number.MAX_SAFE_INTEGER
  ) {
    throw new Error('INVALID_PAGINATION');
  }
  return { offset, limit };
}

function trimHostCatalogPageCache() {
  while (hostCatalogPageCache.size > MAX_HOST_CATALOG_PAGE_CACHE_ENTRIES)
    hostCatalogPageCache.delete(hostCatalogPageCache.keys().next().value);
}

function cachedHostCatalogPage(key, fetchPage) {
  const cached = hostCatalogPageCache.get(key);
  if (cached?.promise) return cached.promise;
  if (cached && cached.expiresAt > Date.now()) {
    hostCatalogPageCache.delete(key);
    hostCatalogPageCache.set(key, cached);
    return Promise.resolve(cached.value);
  }
  if (cached) hostCatalogPageCache.delete(key);

  const entry = { promise: null, expiresAt: 0 };
  const request = Promise.resolve().then(fetchPage);
  entry.promise = request;
  hostCatalogPageCache.set(key, entry);
  return request.then(
    value => {
      if (hostCatalogPageCache.get(key) === entry) {
        hostCatalogPageCache.set(key, {
          value,
          expiresAt: Date.now() + HOST_CATALOG_PAGE_TTL,
        });
        trimHostCatalogPageCache();
      }
      return value;
    },
    error => {
      if (hostCatalogPageCache.get(key) === entry)
        hostCatalogPageCache.delete(key);
      throw error;
    }
  );
}

function clearUserPlaylistPageCache(userId) {
  const userPrefix = `${String(userId)}:userPlaylists:`;
  const trackPrefix = `${String(userId)}:playlist:`;
  for (const key of hostCatalogPageCache.keys()) {
    if (key.startsWith(userPrefix) || key.startsWith(trackPrefix))
      hostCatalogPageCache.delete(key);
  }
  userPlaylistAllowlistById.delete(String(userId));
}

function rememberUserPlaylistIds(userId, playlists, offset) {
  const key = String(userId);
  let entry = userPlaylistAllowlistById.get(key);
  if (!entry) {
    entry = { ids: new Map(), pageSignatures: new Map() };
    userPlaylistAllowlistById.set(key, entry);
  }
  const expiresAt = Date.now() + HOST_CATALOG_PAGE_TTL;
  (playlists || []).forEach(playlist => {
    const id = String(playlist?.id || '');
    if (!/^\d{1,20}$/.test(id)) return;
    if (!entry.ids.has(id) && entry.ids.size >= MAX_USER_PLAYLIST_ALLOWLIST_IDS)
      entry.ids.delete(entry.ids.values().next().value);
    entry.ids.delete(id);
    entry.ids.set(id, { offset, expiresAt });
  });
  if (Number.isSafeInteger(offset)) {
    const signature = (playlists || [])
      .map(playlist => String(playlist?.id || ''))
      .join(',');
    entry.pageSignatures.set(offset, { signature, expiresAt });
    while (entry.pageSignatures.size > MAX_HOST_CATALOG_PAGE_CACHE_ENTRIES)
      entry.pageSignatures.delete(entry.pageSignatures.keys().next().value);
  }
  return entry;
}

function getUserPlaylistIdRecord(userId, playlistId) {
  const key = String(userId);
  const entry = userPlaylistAllowlistById.get(key);
  return entry?.ids.get(String(playlistId)) || null;
}

function userPlaylistIdIsAllowed(userId, playlistId) {
  const record = getUserPlaylistIdRecord(userId, playlistId);
  return Boolean(record && record.expiresAt > Date.now());
}

function pageSignatureSeenAtAnotherOffset(userId, offset, page) {
  const entry = userPlaylistAllowlistById.get(String(userId));
  if (!entry) return false;
  const now = Date.now();
  const signature = page.map(playlist => String(playlist?.id || '')).join(',');
  for (const [knownOffset, record] of entry.pageSignatures) {
    if (record.expiresAt <= now) {
      entry.pageSignatures.delete(knownOffset);
      continue;
    }
    if (knownOffset !== offset && record.signature === signature) return true;
  }
  return false;
}

function assertArtistCatalogPageProgress(userId, artistId, page) {
  const key = `${String(userId)}:${String(artistId)}`;
  let signatures = artistCatalogPageSignatures.get(key);
  if (!signatures) {
    signatures = new Map();
    artistCatalogPageSignatures.set(key, signatures);
  }
  const now = Date.now();
  const signature = [
    page.requestedCount,
    page.unavailableCount,
    page.tracks.map(track => String(track.id)).join(','),
  ].join(':');
  for (const [offset, record] of signatures) {
    if (record.expiresAt <= now) {
      signatures.delete(offset);
      continue;
    }
    if (offset !== page.offset && record.signature === signature)
      throw new Error('ARTIST_PAGINATION_STALLED');
  }
  signatures.delete(page.offset);
  signatures.set(page.offset, {
    signature,
    expiresAt: now + HOST_CATALOG_PAGE_TTL,
  });
  while (signatures.size > MAX_HOST_CATALOG_PAGE_CACHE_ENTRIES)
    signatures.delete(signatures.keys().next().value);
  if (artistCatalogPageSignatures.size > MAX_HOST_CATALOG_PAGE_CACHE_ENTRIES)
    artistCatalogPageSignatures.delete(
      artistCatalogPageSignatures.keys().next().value
    );
}

const FEATURED_ARTIST_FALLBACKS = [
  { id: '6452', name: '周杰伦', coverUrl: '', albumCount: 38, mvCount: 0 },
  { id: '3684', name: '林俊杰', coverUrl: '', albumCount: 42, mvCount: 0 },
  { id: '7763', name: '邓紫棋', coverUrl: '', albumCount: 35, mvCount: 0 },
  { id: '2116', name: '陈奕迅', coverUrl: '', albumCount: 96, mvCount: 0 },
  { id: '5781', name: '薛之谦', coverUrl: '', albumCount: 28, mvCount: 0 },
  { id: '6066', name: '杨宗纬', coverUrl: '', albumCount: 18, mvCount: 0 },
];

async function resolvePlaylistCatalogPage(playlistId, { offset, limit }) {
  const detail = await getPlaylistDetail(playlistId, false);
  const trackIds = (detail?.playlist?.trackIds || []).map(track =>
    String(track && typeof track === 'object' ? track.id : track)
  );
  const initialTracks = Array.isArray(detail?.playlist?.tracks)
    ? detail.playlist.tracks
    : [];
  const sourceIds = trackIds.length
    ? trackIds
    : initialTracks.map(track => String(track?.id || ''));
  const requestedIds = sourceIds.slice(offset, offset + limit);
  const detailIds = requestedIds.filter(trackId => /^\d{1,20}$/.test(trackId));
  const data = detailIds.length
    ? await getTrackDetail(detailIds.join(','))
    : { songs: [] };
  const tracksById = new Map(
    (data?.songs || [])
      .filter(track => track?.id != null)
      .map(track => [String(track.id), track])
  );
  const tracks = [];
  let consumed = 0;
  let unavailableCount = 0;
  let serializedBytes = 2;
  const encoder = new TextEncoder();

  for (let index = 0; index < requestedIds.length; index += 1) {
    const trackId = requestedIds[index];
    const sourceTrack = /^\d{1,20}$/.test(trackId)
      ? tracksById.get(trackId)
      : null;
    if (!sourceTrack) {
      unavailableCount += 1;
      consumed = index + 1;
      continue;
    }
    const track = safeCatalogTrack(sourceTrack);
    const trackBytes = encoder.encode(JSON.stringify(track)).byteLength;
    const nextBytes = serializedBytes + trackBytes + (tracks.length ? 1 : 0);
    if (nextBytes > HOST_CATALOG_PAGE_MAX_BYTES) {
      if (!tracks.length) throw new Error('CATALOG_TRACK_TOO_LARGE');
      break;
    }
    tracks.push(track);
    serializedBytes = nextBytes;
    consumed = index + 1;
  }

  const total = sourceIds.length;
  const nextOffset = offset + consumed;
  return {
    tracks,
    offset,
    nextOffset,
    requestedCount: consumed,
    unavailableCount,
    total,
    hasMore: nextOffset < total,
  };
}

async function resolvePlaylistCatalogTracks(playlistId, limit = 100) {
  const page = await resolvePlaylistCatalogPage(playlistId, {
    offset: 0,
    limit: Math.min(limit, HOST_CATALOG_PAGE_SIZE),
  });
  return page.tracks;
}

async function getUserPlaylistAllowlist(store, { force = false } = {}) {
  if (!isAccountLoggedIn()) throw new Error('HOST_NOT_LOGGED_IN');
  const uid = store?.state?.data?.user?.userId;
  if (!uid) throw new Error('HOST_NOT_LOGGED_IN');
  const playlists = await userPlaylistCache({
    userId: uid,
    force,
    fetchPlaylists: async () => {
      const playlists = [];
      const seenIDs = new Set();
      const pageSignatures = new Set();
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const data = await userPlaylist({
          uid,
          limit: HOST_CATALOG_PAGE_SIZE,
          offset,
          timestamp: Date.now(),
        });
        if (String(store?.state?.data?.user?.userId || '') !== String(uid))
          throw new Error('CATALOG_IDENTITY_CHANGED');
        const page = Array.isArray(data?.playlist) ? data.playlist : [];
        const signature = page
          .map(playlist => String(playlist?.id || ''))
          .join(',');
        if (page.length && pageSignatures.has(signature))
          throw new Error('PLAYLIST_PAGINATION_STALLED');
        if (page.length) pageSignatures.add(signature);

        page.forEach(playlist => {
          const id = String(playlist?.id || '');
          if (!/^\d{1,20}$/.test(id) || seenIDs.has(id)) return;
          seenIDs.add(id);
          playlists.push(safePlaylist(playlist));
        });

        offset += page.length;
        hasMore =
          data?.more === true ||
          (data?.more !== false && page.length === HOST_CATALOG_PAGE_SIZE);
        if (hasMore && !page.length)
          throw new Error('PLAYLIST_PAGINATION_STALLED');
      }

      return playlists;
    },
  });
  if (String(store?.state?.data?.user?.userId || '') !== String(uid))
    throw new Error('CATALOG_IDENTITY_CHANGED');
  rememberUserPlaylistIds(uid, playlists);
  return playlists;
}

async function getUserPlaylistCatalogPage(store, { offset, limit }) {
  if (!isAccountLoggedIn()) throw new Error('HOST_NOT_LOGGED_IN');
  const uid = store?.state?.data?.user?.userId;
  if (!uid) throw new Error('HOST_NOT_LOGGED_IN');

  const page = await cachedHostCatalogPage(
    `${String(uid)}:userPlaylists:${offset}:${limit}`,
    async () => {
      const data = await userPlaylist({
        uid,
        limit,
        offset,
        timestamp: Date.now(),
      });
      if (String(store?.state?.data?.user?.userId || '') !== String(uid))
        throw new Error('CATALOG_IDENTITY_CHANGED');

      const source = Array.isArray(data?.playlist) ? data.playlist : [];
      const page = source
        .filter(playlist => /^\d{1,20}$/.test(String(playlist?.id || '')))
        .map(safePlaylist);
      const hasMore =
        data?.more === true ||
        (data?.more !== false && source.length === limit);
      if (hasMore && source.length === 0)
        throw new Error('PLAYLIST_PAGINATION_STALLED');

      if (
        offset > 0 &&
        page.length &&
        pageSignatureSeenAtAnotherOffset(uid, offset, page)
      )
        throw new Error('PLAYLIST_PAGINATION_STALLED');

      const total = Number.isSafeInteger(data?.count)
        ? data.count
        : Number.isSafeInteger(data?.total)
        ? data.total
        : undefined;
      return {
        playlists: page,
        offset,
        nextOffset: offset + source.length,
        ...(total === undefined ? {} : { total }),
        hasMore,
      };
    }
  );
  if (String(store?.state?.data?.user?.userId || '') !== String(uid))
    throw new Error('CATALOG_IDENTITY_CHANGED');
  rememberUserPlaylistIds(uid, page.playlists, offset);
  return page;
}

async function ensureUserPlaylistAllowed(store, playlistId) {
  const userId = store?.state?.data?.user?.userId;
  if (userPlaylistIdIsAllowed(userId, playlistId)) return true;
  const previousRecord = getUserPlaylistIdRecord(userId, playlistId);
  if (!previousRecord || !Number.isSafeInteger(previousRecord.offset))
    return false;
  const page = await getUserPlaylistCatalogPage(store, {
    offset: previousRecord.offset,
    limit: HOST_CATALOG_PAGE_SIZE,
  });
  const stillAllowed = page.playlists.some(
    playlist => String(playlist.id) === String(playlistId)
  );
  if (!stillAllowed) {
    userPlaylistAllowlistById
      .get(String(userId))
      ?.ids.delete(String(playlistId));
  }
  return stillAllowed;
}

function resolveArtistCatalogPage(artistId, pageOptions) {
  return getArtist(artistId, pageOptions).then(data => {
    const songs = Array.isArray(data?.songs) ? data.songs : [];
    if (data?.more === true && songs.length === 0)
      throw new Error('ARTIST_PAGINATION_STALLED');

    const tracks = [];
    const seenIDs = new Set();
    const encoder = new TextEncoder();
    let serializedBytes = 2;
    let consumed = 0;
    let unavailableCount = 0;

    for (let index = 0; index < songs.length; index += 1) {
      const song = songs[index];
      if (song?.id == null) {
        unavailableCount += 1;
        consumed = index + 1;
        continue;
      }
      const id = String(song.id);
      if (seenIDs.has(id)) {
        consumed = index + 1;
        continue;
      }
      const track = safeCatalogTrack(song);
      const trackBytes = encoder.encode(JSON.stringify(track)).byteLength;
      const nextBytes = serializedBytes + trackBytes + (tracks.length ? 1 : 0);
      if (nextBytes > HOST_CATALOG_PAGE_MAX_BYTES) {
        if (!tracks.length) throw new Error('CATALOG_TRACK_TOO_LARGE');
        break;
      }
      tracks.push(track);
      seenIDs.add(id);
      serializedBytes = nextBytes;
      consumed = index + 1;
    }

    const nextOffset = pageOptions.offset + consumed;
    const total =
      Number.isSafeInteger(data?.total) && data.total >= 0
        ? data.total
        : undefined;
    const hasMore =
      nextOffset < pageOptions.offset + songs.length ||
      (total !== undefined
        ? nextOffset < total
        : typeof data?.more === 'boolean'
        ? data.more
        : songs.length >= pageOptions.limit);

    return {
      tracks,
      offset: pageOptions.offset,
      nextOffset,
      requestedCount: consumed,
      unavailableCount,
      ...(total === undefined ? {} : { total }),
      hasMore,
    };
  });
}

// 上游（网易云）对搜索有频率风控，返回 405「操作频繁」。拼音逐字输入会密集
// 触发该风控，因此在主屏侧对上游搜索做：相同词合并/短缓存、最小间隔、
// 风控后冷却，并把风控显式映射为 UPSTREAM_RATE_LIMIT，而不是笼统的 502。
const UPSTREAM_SEARCH_MIN_INTERVAL_MS = 600;
const UPSTREAM_SEARCH_COOLDOWN_MS = 6000;
const UPSTREAM_SEARCH_CACHE_TTL_MS = 20000;
const UPSTREAM_SEARCH_CACHE_MAX = 64;
const upstreamSearchCache = new Map();
const upstreamSearchInFlight = new Map();
let upstreamSearchTail = Promise.resolve();
let upstreamSearchLastAt = 0;
let upstreamSearchCooldownUntil = 0;

function upstreamRateLimitError(retryAfterMs) {
  const wait = Math.max(1000, Math.ceil(retryAfterMs));
  // 桥接层只传递 error.message，因此把等待时间编码进消息。
  const exception = new Error(`UPSTREAM_RATE_LIMIT:${wait}`);
  exception.retryAfterMs = wait;
  return exception;
}

function isUpstreamBusy(error) {
  const status = error?.response?.status ?? error?.status;
  const code = error?.response?.data?.code ?? error?.code;
  return status === 405 || code === 405 || code === -460;
}

async function doUpstreamSearch(key, query) {
  try {
    const data = await search({ keywords: query, limit: 15, type: 1 });
    const songs = (data.result?.songs || data.result?.song?.songs || [])
      .slice(0, 15)
      .map(safeCatalogTrack);
    upstreamSearchCache.set(key, {
      songs,
      expiresAt: Date.now() + UPSTREAM_SEARCH_CACHE_TTL_MS,
    });
    while (upstreamSearchCache.size > UPSTREAM_SEARCH_CACHE_MAX)
      upstreamSearchCache.delete(upstreamSearchCache.keys().next().value);
    return songs;
  } catch (error) {
    if (isUpstreamBusy(error)) {
      upstreamSearchCooldownUntil = Date.now() + UPSTREAM_SEARCH_COOLDOWN_MS;
      throw upstreamRateLimitError(UPSTREAM_SEARCH_COOLDOWN_MS);
    }
    throw error;
  }
}

async function guardedUpstreamSearch(query) {
  const key = query.trim().toLowerCase();
  const cached = upstreamSearchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.songs;
  if (upstreamSearchInFlight.has(key)) return upstreamSearchInFlight.get(key);

  const run = (async () => {
    // 严格串行：上一个上游搜索结束并间隔满 MIN_INTERVAL 后才发下一个。
    const previous = upstreamSearchTail;
    let release;
    upstreamSearchTail = new Promise(resolve => (release = resolve));
    await previous;
    try {
      const cooldownLeft = upstreamSearchCooldownUntil - Date.now();
      if (cooldownLeft > 0) throw upstreamRateLimitError(cooldownLeft);
      const gap =
        upstreamSearchLastAt + UPSTREAM_SEARCH_MIN_INTERVAL_MS - Date.now();
      if (gap > 0) await new Promise(resolve => setTimeout(resolve, gap));
      return await doUpstreamSearch(key, query);
    } finally {
      upstreamSearchLastAt = Date.now();
      release();
    }
  })();
  upstreamSearchInFlight.set(key, run);
  const cleanup = () => {
    if (upstreamSearchInFlight.get(key) === run)
      upstreamSearchInFlight.delete(key);
  };
  run.then(cleanup, cleanup);
  return run;
}

export async function hostCatalog(action, payload = {}, store = null) {
  if (action === 'search') {
    return guardedUpstreamSearch(String(payload.query || ''));
  }
  if (action === 'artistSearch') {
    const keywords = String(payload.query || '').trim();
    let artists = [];
    try {
      const data = await search({
        keywords,
        limit: 12,
        type: 100,
      });
      artists = data?.result?.artists || data?.result?.artist?.artists || [];
    } catch (_) {
      artists = [];
    }
    const mapped = artists.slice(0, 12).map(safeArtist);
    if (mapped.length) return mapped;
    const lower = keywords.toLowerCase();
    return FEATURED_ARTIST_FALLBACKS.filter(
      item =>
        item.name.toLowerCase().includes(lower) ||
        lower.includes(item.name.toLowerCase())
    );
  }
  if (action === 'artistTracks') {
    const artistId = String(payload.artistId || '');
    if (!/^\d{1,20}$/.test(artistId)) throw new Error('ARTIST_NOT_FOUND');
    const pageOptions = catalogPageOptions(payload);
    const userId = String(store?.state?.data?.user?.userId || 'anonymous');
    const page = await cachedHostCatalogPage(
      `${userId}:artist:${artistId}:${pageOptions.offset}:${pageOptions.limit}`,
      () => resolveArtistCatalogPage(artistId, pageOptions)
    );
    if (userId !== String(store?.state?.data?.user?.userId || 'anonymous'))
      throw new Error('CATALOG_IDENTITY_CHANGED');
    assertArtistCatalogPageProgress(userId, artistId, page);
    return hasCatalogPageRequest(payload) ? page : page.tracks;
  }
  if (action === 'recommendations') {
    let playlists;
    try {
      const fallback = await recommendPlaylist({ limit: 10 });
      playlists = fallback?.result || [];
      if (!playlists.length) {
        playlists = await getRecommendPlayList(10, false);
      }
    } catch (_) {
      try {
        playlists = await getRecommendPlayList(10, false);
      } catch (__) {
        const chartFallback = await toplists();
        playlists = chartFallback?.list || [];
      }
    }
    return (playlists || []).slice(0, 10).map(safePlaylist);
  }
  if (action === 'recommendationTracks') {
    const playlistId = String(payload.playlistId || '');
    if (!/^\d{1,20}$/.test(playlistId)) throw new Error('PLAYLIST_NOT_FOUND');
    return resolvePlaylistCatalogTracks(playlistId, 50);
  }
  if (action === 'toplists') {
    const data = await toplists();
    return (data?.list || []).slice(0, 10).map(safePlaylist);
  }
  if (action === 'toplistTracks') {
    const playlistId = String(payload.playlistId || '');
    if (!/^\d{1,20}$/.test(playlistId)) throw new Error('PLAYLIST_NOT_FOUND');
    return resolvePlaylistCatalogTracks(playlistId, 50);
  }
  if (action === 'trackDetail') {
    const data = await getTrackDetail(String(payload.trackId));
    const track = data?.songs?.[0];
    if (!track) throw new Error('TRACK_NOT_FOUND');
    return safeCatalogTrack(track);
  }
  if (action === 'playlists') {
    const userId = store?.state?.data?.user?.userId;
    if (payload.force) clearUserPlaylistPageCache(userId);
    if (hasCatalogPageRequest(payload)) {
      const pageOptions = catalogPageOptions(payload);
      return getUserPlaylistCatalogPage(store, pageOptions);
    }
    const playlists = await getUserPlaylistAllowlist(store, {
      force: Boolean(payload.force),
    });
    return playlists;
  }
  if (action === 'playlistTracks') {
    const playlistId = String(payload.playlistId || '');
    if (!/^\d{1,20}$/.test(playlistId)) throw new Error('PLAYLIST_NOT_FOUND');
    const pageOptions = catalogPageOptions(payload);
    const allowed = hasCatalogPageRequest(payload)
      ? await ensureUserPlaylistAllowed(store, playlistId)
      : (await getUserPlaylistAllowlist(store)).some(
          playlist => String(playlist.id) === playlistId
        );
    if (!allowed) throw new Error('PLAYLIST_NOT_FOUND');
    const userId = String(store?.state?.data?.user?.userId || '');
    const page = await cachedHostCatalogPage(
      `${userId}:playlist:${playlistId}:${pageOptions.offset}:${pageOptions.limit}`,
      () => resolvePlaylistCatalogPage(playlistId, pageOptions)
    );
    if (userId !== String(store?.state?.data?.user?.userId || ''))
      throw new Error('CATALOG_IDENTITY_CHANGED');
    return hasCatalogPageRequest(payload) ? page : page.tracks;
  }
  if (action === 'availability') {
    const data = await getMP3(String(payload.trackId));
    const source = data?.data?.[0];
    if (!source?.url) return 'unavailable';
    return source.freeTrialInfo ? 'trial-only' : 'playable';
  }
  if (action === 'preview') {
    const trackId = String(payload.trackId || '');
    if (!/^\d{1,20}$/.test(trackId)) throw new Error('TRACK_NOT_FOUND');
    const data = await getMP3(trackId);
    const source = data?.data?.[0];
    if (!source?.url || !/^https?:\/\//i.test(source.url))
      throw new Error('TRACK_NOT_PLAYABLE');
    return source.url.replace(/^http:/, 'https:');
  }
  if (action === 'localPlaylists') {
    if (process.env.IS_ELECTRON === true && window.require) {
      const localElectron = window.require('electron');
      const result = await localElectron.ipcRenderer.invoke(
        'karaoke:local:list'
      );
      return result?.playlists || [];
    }
    const response = await fetch('/ktv/local/list');
    if (!response.ok) return [];
    const data = await response.json().catch(() => ({}));
    return data?.playlists || [];
  }
  throw new Error('KTV_NOT_ACTIVE');
}

export async function executeKaraokeCommand(command, store) {
  const manager = store.$karaokeManager;
  if (!manager) throw new Error('KTV_NOT_ACTIVE');
  const payload = command.payload || {};
  if (command.action === 'snapshot') return manager.getSnapshot();
  if (command.action === 'catalog')
    return hostCatalog(payload.action, payload.payload, store);
  assertExpectedKaraokeSession(manager, payload.expected);
  switch (command.action) {
    case 'enqueue': {
      const item = manager.enqueueTrack(payload.track, payload.requester);
      if (item && !manager.queue.currentItem && !manager.transitionPromise)
        manager.startQueue();
      return item;
    }
    case 'remove':
      return manager.removeQueueItem(payload.queueItemId);
    case 'front':
      return manager.moveQueueItemToFront(payload.queueItemId);
    case 'next':
      return manager.next();
    default:
      throw new Error('KTV_NOT_ACTIVE');
  }
}

export function ipcRenderer(vueInstance) {
  const self = vueInstance;
  const store = self.$store;
  const getPlayer = () => store?.state?.player;
  // 添加专有的类名
  document.body.setAttribute('data-electron', 'yes');
  document.body.setAttribute(
    'data-electron-os',
    window.require('os').platform()
  );
  // ipc message channel
  const electron = window.require('electron');
  const ipcRenderer = electron.ipcRenderer;

  ipcRenderer.on('karaoke:remote:command', async (_, command) => {
    try {
      const result = await executeKaraokeCommand(command, store);
      ipcRenderer.send('karaoke:remote:result', {
        id: command.id,
        ok: true,
        result,
      });
    } catch (error) {
      ipcRenderer.send('karaoke:remote:result', {
        id: command.id,
        ok: false,
        error: error.message,
      });
    }
  });

  // listens to the main process 'changeRouteTo' event and changes the route from
  // inside this Vue instance, according to what path the main process requires.
  // responds to Menu click() events at the main process and changes the route accordingly.

  ipcRenderer.on('changeRouteTo', (event, path) => {
    self.$router.push(path);
    if (store.state.showLyrics) {
      store.commit('toggleLyrics');
    }
  });

  ipcRenderer.on('search', () => {
    // 触发数据响应
    self.$refs.navbar.$refs.searchInput.focus();
    self.$refs.navbar.inputFocus = true;
  });

  ipcRenderer.on('play', () => {
    const player = getPlayer();
    const manager = store.$karaokeManager;
    if (manager?.isSessionActive) manager.playOrPause();
    else player?.playOrPause();
  });

  ipcRenderer.on('next', () => {
    const player = getPlayer();
    const manager = store.$karaokeManager;
    if (manager?.isSessionActive) {
      manager.next();
    } else if (player?.isPersonalFM) {
      player.playNextFMTrack();
    } else if (player) {
      player.playNextTrack();
    }
  });

  ipcRenderer.on('previous', () => {
    const player = getPlayer();
    if (!store.$karaokeManager?.isSessionActive) player?.playPrevTrack();
  });

  ipcRenderer.on('increaseVolume', () => {
    const player = getPlayer();
    if (!player) return;
    if (player.volume + 0.1 >= 1) {
      return (player.volume = 1);
    }
    player.volume += 0.1;
  });

  ipcRenderer.on('decreaseVolume', () => {
    const player = getPlayer();
    if (!player) return;
    if (player.volume - 0.1 <= 0) {
      return (player.volume = 0);
    }
    player.volume -= 0.1;
  });

  ipcRenderer.on('like', () => {
    const player = getPlayer();
    if (player?.currentTrack?.id) {
      store.dispatch('likeATrack', player.currentTrack.id);
    }
  });

  ipcRenderer.on('repeat', () => {
    getPlayer()?.switchRepeatMode();
  });

  ipcRenderer.on('shuffle', () => {
    getPlayer()?.switchShuffle();
  });

  ipcRenderer.on('routerGo', (event, where) => {
    self.$refs.navbar.go(where);
  });

  ipcRenderer.on('nextUp', () => {
    self.$refs.player.goToNextTracksPage();
  });

  ipcRenderer.on('rememberCloseAppOption', (event, value) => {
    store.commit('updateSettings', {
      key: 'closeAppOption',
      value,
    });
  });

  ipcRenderer.on('setPosition', (event, position) => {
    getPlayer()?._howler?.seek(position);
  });
}
