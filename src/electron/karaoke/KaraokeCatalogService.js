import http from 'http';
import { DEFAULT_CATALOG_PAGE_SIZE } from './KaraokeRemoteApiRouter.js';

const CACHE_TTL = 5 * 60 * 1000;
const SEARCH_CACHE_TTL = 15 * 1000;
// Retain 128 catalog result sets and 4096 individual tracks/availability
// results. 4096 covers over 200 pages of 20 tracks while bounding each map.
const MAX_CATALOG_CACHE_ENTRIES = 128;
const MAX_TRACK_CACHE_ENTRIES = 4096;
const MAX_AVAILABILITY_CACHE_ENTRIES = 4096;
const CACHE_EXPIRY_SWEEP_INTERVAL = 30 * 1000;
const cacheSweepTimes = new WeakMap();

function hasCatalogPageOptions(options) {
  return (
    options &&
    (Object.prototype.hasOwnProperty.call(options, 'offset') ||
      Object.prototype.hasOwnProperty.call(options, 'limit'))
  );
}

function catalogPageFallback(source, offset, limit, mapTracks) {
  if (source && !Array.isArray(source) && Array.isArray(source.tracks)) {
    const tracks = mapTracks(source.tracks);
    return {
      ...source,
      tracks,
      offset: Number.isSafeInteger(source.offset) ? source.offset : offset,
      nextOffset: Number.isSafeInteger(source.nextOffset)
        ? source.nextOffset
        : offset + tracks.length,
      requestedCount: Number.isSafeInteger(source.requestedCount)
        ? source.requestedCount
        : tracks.length,
      unavailableCount: Number.isSafeInteger(source.unavailableCount)
        ? source.unavailableCount
        : 0,
      hasMore:
        typeof source.hasMore === 'boolean'
          ? source.hasMore
          : tracks.length >= limit,
    };
  }
  const tracks = mapTracks(Array.isArray(source) ? source : []);
  return {
    tracks,
    offset,
    nextOffset: offset + tracks.length,
    requestedCount: tracks.length,
    unavailableCount: 0,
    hasMore: tracks.length >= limit,
  };
}

function pruneExpiredCache(cache, now, force = false) {
  const lastSweep = cacheSweepTimes.get(cache);
  if (
    !force &&
    lastSweep != null &&
    now - lastSweep < CACHE_EXPIRY_SWEEP_INTERVAL
  )
    return;
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  cacheSweepTimes.set(cache, now);
}

function readCacheEntry(cache, key, now = Date.now()) {
  const entry = cache.get(key);
  const expired = entry && entry.expiresAt <= now;
  if (expired) cache.delete(key);
  pruneExpiredCache(cache, now, Boolean(expired));
  const current = cache.get(key);
  if (!current) return null;
  // Map insertion order supplies a small LRU policy for capacity eviction.
  cache.delete(key);
  cache.set(key, current);
  return current;
}

function writeCacheEntry(cache, key, value, ttl, maxEntries, now = Date.now()) {
  pruneExpiredCache(cache, now);
  cache.delete(key);
  cache.set(key, { value, expiresAt: now + ttl });
  while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
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
  const safe = {
    trackId: String(track.id),
    name: track.name || '未知歌曲',
    artists: (track.artists || track.ar || []).map(item => item.name),
    album:
      (track.album && track.album.name) || (track.al && track.al.name) || '',
    coverUrl:
      track.coverUrl ||
      (track.album && track.album.picUrl) ||
      (track.al && track.al.picUrl) ||
      '',
    duration: track.duration || track.dt || 0,
    aliases: track.aliases || track.alia || [],
    versionLabel: versionLabel(track),
  };
  if (track.source === 'local' || track.localId) {
    safe.source = 'local';
    safe.localId = String(track.localId || track.id);
    safe.playability = 'playable';
  }
  return safe;
}

export class KaraokeCatalogService {
  constructor({ upstream = requestNetease, hostCatalogBridge = null } = {}) {
    this.upstream = upstream;
    this.hostCatalogBridge = hostCatalogBridge;
    this.trackCache = new Map();
    this.localTrackCache = new Map();
    this.availabilityCache = new Map();
    this.catalogCache = new Map();
    this.catalogPromises = new Map();
    this.catalogGeneration = 0;
    this.trackDetailPromises = new Map();
    this.availabilityPromises = new Map();
    this.recommendationPlaylistIds = new Set();
    this.toplistIds = new Set();
  }

  resetRoomCatalog() {
    this.catalogGeneration++;
    this.catalogCache.clear();
    for (const key of this.catalogPromises.keys()) {
      if (key !== 'localPlaylists:inflight') this.catalogPromises.delete(key);
    }
    this.trackDetailPromises.clear();
    this.availabilityCache.clear();
    this.availabilityPromises.clear();
    for (const key of this.trackCache.keys()) {
      if (!this.localTrackCache.has(key)) this.trackCache.delete(key);
    }
    this.recommendationPlaylistIds.clear();
    this.toplistIds.clear();
  }

  cacheTracks(tracks, generation = this.catalogGeneration) {
    const source = Array.isArray(tracks) ? tracks : [];
    const now = Date.now();
    return source.map(item => {
      const track = item && item.trackId ? item : sanitizeTrack(item);
      if (generation === this.catalogGeneration)
        writeCacheEntry(
          this.trackCache,
          track.trackId,
          track,
          CACHE_TTL,
          MAX_TRACK_CACHE_ENTRIES,
          now
        );
      return track;
    });
  }

  async cachedCatalog(key, fetcher, { force = false, ttl = CACHE_TTL } = {}) {
    const cached = readCacheEntry(this.catalogCache, key);
    if (!force) {
      if (cached) return cached.value;
    }
    const pending = this.catalogPromises.get(key);
    if (pending && !force) return pending;
    const generation = this.catalogGeneration;
    const request = (async () => {
      const value = await fetcher(generation);
      if (
        generation === this.catalogGeneration &&
        this.catalogPromises.get(key) === request
      ) {
        writeCacheEntry(
          this.catalogCache,
          key,
          value,
          ttl,
          MAX_CATALOG_CACHE_ENTRIES
        );
      }
      return value;
    })();
    this.catalogPromises.set(key, request);
    return request.finally(() => {
      if (this.catalogPromises.get(key) === request)
        this.catalogPromises.delete(key);
    });
  }

  async search(query) {
    const clean = String(query || '').trim();
    const key = `search:${clean}`;
    return this.cachedCatalog(
      key,
      async generation => {
        if (this.hostCatalogBridge) {
          const songs = await this.hostCatalogBridge('search', {
            query: clean,
          });
          return this.cacheTracks(songs, generation);
        }
        const data = await this.upstream(
          `/search?keywords=${encodeURIComponent(clean)}&limit=15&type=1`
        );
        return this.cacheTracks(
          (data.result && data.result.songs) || [],
          generation
        );
      },
      { ttl: SEARCH_CACHE_TTL }
    );
  }

  async artistSearch(query) {
    if (!this.hostCatalogBridge) throw new Error('HOST_NOT_LOGGED_IN');
    const clean = String(query || '').trim();
    return this.cachedCatalog(`artistSearch:${clean}`, async () => {
      const artists = await this.hostCatalogBridge('artistSearch', {
        query: clean,
      });
      return Array.isArray(artists) ? artists : [];
    });
  }

  async artistTracks(artistId) {
    if (!this.hostCatalogBridge) throw new Error('HOST_NOT_LOGGED_IN');
    const id = String(artistId);
    const generation = this.catalogGeneration;
    const tracks = await this.hostCatalogBridge('artistTracks', {
      artistId: id,
    });
    return this.cacheTracks(tracks, generation);
  }

  async artistTracksPage(artistId, { offset, limit }) {
    if (!this.hostCatalogBridge) throw new Error('HOST_NOT_LOGGED_IN');
    const id = String(artistId);
    const generation = this.catalogGeneration;
    const source = await this.hostCatalogBridge('artistTracks', {
      artistId: id,
      offset,
      limit,
    });
    return catalogPageFallback(source, offset, limit, tracks =>
      this.cacheTracks(tracks, generation)
    );
  }

  async getTrack(trackId) {
    const key = String(trackId);
    const local = this.localTrackCache.get(key);
    if (local) return local;
    const cached = readCacheEntry(this.trackCache, key);
    if (cached) return cached.value;
    const pending = this.trackDetailPromises.get(key);
    if (pending) return pending;
    const generation = this.catalogGeneration;
    const request = (async () => {
      const data = this.hostCatalogBridge
        ? await this.hostCatalogBridge('trackDetail', { trackId: key })
        : await this.upstream(`/song/detail?ids=${encodeURIComponent(key)}`);
      const song = this.hostCatalogBridge ? data : data.songs && data.songs[0];
      if (!song) throw new Error('TRACK_NOT_FOUND');
      const track = sanitizeTrack(song);
      if (generation === this.catalogGeneration)
        writeCacheEntry(
          this.trackCache,
          track.trackId,
          track,
          CACHE_TTL,
          MAX_TRACK_CACHE_ENTRIES
        );
      return track;
    })();
    this.trackDetailPromises.set(key, request);
    return request.finally(() => {
      if (this.trackDetailPromises.get(key) === request)
        this.trackDetailPromises.delete(key);
    });
  }

  async playlists({ force = false, offset, limit } = {}) {
    if (!this.hostCatalogBridge) throw new Error('HOST_NOT_LOGGED_IN');
    if (Number.isSafeInteger(offset) || Number.isSafeInteger(limit)) {
      const pageOffset = Number.isSafeInteger(offset) ? offset : 0;
      const pageLimit = Number.isSafeInteger(limit)
        ? limit
        : DEFAULT_CATALOG_PAGE_SIZE;
      const source = await this.hostCatalogBridge('playlists', {
        force,
        offset: pageOffset,
        limit: pageLimit,
      });
      if (source && !Array.isArray(source) && Array.isArray(source.playlists)) {
        return {
          ...source,
          playlists: source.playlists,
          offset: Number.isSafeInteger(source.offset)
            ? source.offset
            : pageOffset,
          nextOffset: Number.isSafeInteger(source.nextOffset)
            ? source.nextOffset
            : pageOffset + source.playlists.length,
          total: Number.isSafeInteger(source.total) ? source.total : undefined,
          hasMore:
            typeof source.hasMore === 'boolean'
              ? source.hasMore
              : source.playlists.length >= pageLimit,
        };
      }
      const playlists = Array.isArray(source) ? source : [];
      const page = playlists.slice(pageOffset, pageOffset + pageLimit);
      return {
        playlists: page,
        offset: pageOffset,
        nextOffset: pageOffset + page.length,
        total: playlists.length,
        hasMore: pageOffset + page.length < playlists.length,
      };
    }
    if (force) {
      for (const key of this.catalogCache.keys()) {
        if (key.startsWith('playlistTracks:')) this.catalogCache.delete(key);
      }
    }
    return this.cachedCatalog(
      'playlists',
      async () => {
        const playlists = await this.hostCatalogBridge('playlists', { force });
        return Array.isArray(playlists) ? playlists : [];
      },
      { force, ttl: 60 * 1000 }
    );
  }

  async localPlaylists() {
    if (!this.hostCatalogBridge) return [];
    const key = 'localPlaylists:inflight';
    const pending = this.catalogPromises.get(key);
    if (pending) return pending;
    const request = this.loadLocalPlaylists();
    this.catalogPromises.set(key, request);
    try {
      return await request;
    } finally {
      if (this.catalogPromises.get(key) === request)
        this.catalogPromises.delete(key);
    }
  }

  async loadLocalPlaylists() {
    const source = await this.hostCatalogBridge('localPlaylists');
    const playlists = Array.isArray(source) ? source : [];
    this.localTrackCache.clear();
    playlists.forEach(playlist => {
      (playlist.tracks || []).forEach(track => {
        const safe = sanitizeTrack(track);
        this.localTrackCache.set(safe.trackId, {
          ...safe,
          lyrics: Array.isArray(track.lyrics) ? track.lyrics : [],
        });
        writeCacheEntry(
          this.trackCache,
          safe.trackId,
          safe,
          CACHE_TTL,
          MAX_TRACK_CACHE_ENTRIES
        );
      });
    });
    return playlists.map(playlist => ({
      id: String(playlist.id),
      name: playlist.name || '本地歌单',
      source: 'local',
      trackCount: Number(
        playlist.trackCount || (playlist.tracks && playlist.tracks.length) || 0
      ),
      tracks: (playlist.tracks || []).map(sanitizeTrack),
    }));
  }

  async recommendations() {
    if (!this.hostCatalogBridge) throw new Error('HOST_NOT_LOGGED_IN');
    return this.cachedCatalog('recommendations', async generation => {
      const playlists = await this.hostCatalogBridge('recommendations');
      const safePlaylists = Array.isArray(playlists) ? playlists : [];
      if (generation === this.catalogGeneration)
        this.recommendationPlaylistIds = new Set(
          safePlaylists.map(playlist => String(playlist.id))
        );
      return safePlaylists;
    });
  }

  async toplists() {
    if (!this.hostCatalogBridge) throw new Error('HOST_NOT_LOGGED_IN');
    return this.cachedCatalog('toplists', async generation => {
      const source = await this.hostCatalogBridge('toplists');
      const playlists = Array.isArray(source) ? source : [];
      if (generation === this.catalogGeneration)
        this.toplistIds = new Set(
          playlists.map(playlist => String(playlist.id))
        );
      return playlists;
    });
  }

  async toplistTracks(playlistId) {
    if (!this.hostCatalogBridge) throw new Error('HOST_NOT_LOGGED_IN');
    const id = String(playlistId);
    if (!/^\d{1,20}$/.test(id) || !this.toplistIds.has(id))
      throw new Error('PLAYLIST_NOT_FOUND');
    return this.cachedCatalog(`toplistTracks:${id}`, async generation => {
      const source = await this.hostCatalogBridge('toplistTracks', {
        playlistId: id,
      });
      return this.cacheTracks(source, generation);
    });
  }

  async recommendationTracks(playlistId) {
    if (!this.hostCatalogBridge) throw new Error('HOST_NOT_LOGGED_IN');
    const id = String(playlistId);
    if (!/^\d{1,20}$/.test(id) || !this.recommendationPlaylistIds.has(id))
      throw new Error('PLAYLIST_NOT_FOUND');
    return this.cachedCatalog(
      `recommendationTracks:${id}`,
      async generation => {
        const source = await this.hostCatalogBridge('recommendationTracks', {
          playlistId: id,
        });
        return this.cacheTracks(source, generation);
      }
    );
  }

  async playlistTracks(playlistId, options = null) {
    if (!this.hostCatalogBridge) throw new Error('HOST_NOT_LOGGED_IN');
    const id = String(playlistId);
    const generation = this.catalogGeneration;
    const pageRequested = hasCatalogPageOptions(options);
    const source = await this.hostCatalogBridge('playlistTracks', {
      playlistId: id,
      ...(pageRequested ? options : {}),
    });
    if (!pageRequested) return this.cacheTracks(source, generation);
    return catalogPageFallback(
      source,
      options.offset || 0,
      options.limit || 100,
      tracks => this.cacheTracks(tracks, generation)
    );
  }

  async availability(trackId, { fresh = false } = {}) {
    const key = String(trackId);
    if (key.startsWith('local-') && this.localTrackCache.has(key)) {
      writeCacheEntry(
        this.availabilityCache,
        key,
        'playable',
        CACHE_TTL,
        MAX_AVAILABILITY_CACHE_ENTRIES
      );
      return 'playable';
    }
    const pending = this.availabilityPromises.get(key);
    if (pending) return pending;
    const cached = readCacheEntry(this.availabilityCache, key);
    if (!fresh && cached) return cached.value;
    const generation = this.catalogGeneration;
    const request = (async () => {
      try {
        if (this.hostCatalogBridge) {
          const value = await this.hostCatalogBridge('availability', {
            trackId: key,
          });
          if (
            !['playable', 'trial-only', 'unavailable', 'error'].includes(value)
          )
            throw new Error('UPSTREAM');
          if (value !== 'error' && generation === this.catalogGeneration)
            writeCacheEntry(
              this.availabilityCache,
              key,
              value,
              CACHE_TTL,
              MAX_AVAILABILITY_CACHE_ENTRIES
            );
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
        if (generation === this.catalogGeneration)
          writeCacheEntry(
            this.availabilityCache,
            key,
            value,
            CACHE_TTL,
            MAX_AVAILABILITY_CACHE_ENTRIES
          );
        return value;
      } catch (_) {
        return 'error';
      }
    })();
    this.availabilityPromises.set(key, request);
    return request.finally(() => {
      if (this.availabilityPromises.get(key) === request)
        this.availabilityPromises.delete(key);
    });
  }

  peekAvailability(trackId) {
    const key = String(trackId);
    if (key.startsWith('local-') && this.localTrackCache.has(key))
      return 'playable';
    const cached = readCacheEntry(this.availabilityCache, key);
    if (cached) return cached.value;
    return 'unknown';
  }

  async preview(trackId) {
    if (!this.hostCatalogBridge) throw new Error('HOST_NOT_LOGGED_IN');
    const url = await this.hostCatalogBridge('preview', {
      trackId: String(trackId),
    });
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url))
      throw new Error('TRACK_NOT_PLAYABLE');
    return url;
  }
}

