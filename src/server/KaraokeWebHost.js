import crypto from 'crypto';
import path from 'path';
import { promises as fs } from 'fs';
import QRCode from 'qrcode';
import { sanitizePresentation } from '../karaoke/lyricDisplay';
import { sanitizeLyricDocument } from '../karaoke/lyricDocument';
import { normalizeAppearanceConfig } from '../karaoke/appearanceConfig';
import { sanitizeSmartBeatTimeline } from '../karaoke/smartBeatTimeline';
import {
  reactionChoices,
  upstreamReactions,
  reactionCharacters,
  normalizeReactionText,
  isValidReactionEffect,
} from '../karaoke/reactions';
import { createReactionScheduler } from '../karaoke/reactionScheduler';
import KaraokeVisualAssetStore, {
  detectVisualAssetMime,
  MAX_VISUAL_ASSET_BYTES,
} from './KaraokeVisualAssetStore';
import KaraokeLocalLibrary from '../electron/karaoke/KaraokeLocalLibrary';
import { KaraokeServer } from '../electron/karaoke/KaraokeServer';
import {
  KaraokeCatalogService,
  KaraokeRemoteService,
  RemoteApiRouter,
} from '../electron/karaoke/KaraokeRemoteApi';

const secret = () => crypto.randomBytes(32).toString('hex');

export default class KaraokeWebHost {
  constructor({
    publicOrigin,
    remoteDistPath = '',
    now = Date.now,
    requiredUiRevision = '',
    localLibrary = null,
    localDirectories = [],
    localDirsPath = null,
    localIndexPath = null,
    assetDirectory = null,
  } = {}) {
    this.publicOrigin = new URL(publicOrigin).origin;
    this.now = now;
    this.requiredUiRevision = requiredUiRevision;
    this.localDirsPath = localDirsPath;
    this.owner = null;
    this.sequence = 0;
    this.generation = 0;
    this.pending = new Map();
    this.visualAssetStore = new KaraokeVisualAssetStore({
      directory: assetDirectory || '',
    });
    this.visualAssetUploads = 0;
    this.visualAssetReads = 0;
    this.reactionScheduler = createReactionScheduler({ now: this.now });
    this.reactions = [];
    this.reactionEpoch = '';
    this.activeReactionSongItem = '';
    this.startedReactionItem = '';
    this.reactionKnownItems = null;
    this.reactionPlayback = null;
    this.localLibrary =
      localLibrary ||
      new KaraokeLocalLibrary(localDirectories, {
        indexPath: localIndexPath,
      });
    this.localDirsReady = this.loadLocalDirectories(localDirectories);
    this.roomServer = new KaraokeServer({
      remoteDistPath,
      localLibrary: this.localLibrary,
    });
    this.service = new KaraokeRemoteService({
      catalog: new KaraokeCatalogService({
        hostCatalogBridge: async (action, payload) => {
          if (action === 'localPlaylists' && this.localLibrary) {
            return this.getLocalPlaylists();
          }
          return this.command('catalog', { action, payload });
        },
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

  async loadLocalDirectories(fallbackDirectories = []) {
    if (!this.localDirsPath || !this.localLibrary) return;
    try {
      const parsed = JSON.parse(await fs.readFile(this.localDirsPath, 'utf8'));
      if (Array.isArray(parsed) && parsed.length) {
        this.localLibrary.setDirectories(parsed);
        return;
      }
    } catch (_) {
      // Use fallbackDirectories on first boot and persist them.
    }
    if (fallbackDirectories.length) {
      this.localLibrary.setDirectories(fallbackDirectories);
      await this.saveLocalDirectories();
    }
  }

  async saveLocalDirectories() {
    if (!this.localDirsPath || !this.localLibrary) return;
    try {
      await fs.mkdir(path.dirname(this.localDirsPath), { recursive: true });
      await fs.writeFile(
        this.localDirsPath,
        JSON.stringify(this.localLibrary.listDirectories(), null, 2),
        'utf8'
      );
    } catch (_) {
      // Ignore write failures; in-memory directories remain active.
    }
  }

  getLocalAudioUrl(localId) {
    if (!this.localLibrary || !localId) return '';
    return `/ktv/local/audio/${encodeURIComponent(String(localId))}`;
  }

  getLocalCoverUrl(localId) {
    if (!this.localLibrary || !localId) return '';
    return `/ktv/local/cover/${encodeURIComponent(String(localId))}`;
  }

  decorateLocalPlaylists(playlists = []) {
    return playlists.map(playlist => ({
      ...playlist,
      tracks: (playlist.tracks || []).map(track => {
        const id = track.localId || track.trackId || track.id;
        const resolvedTrack = this.localLibrary?.getTrack?.(id);
        const hasCover = Boolean(resolvedTrack?.coverPath);
        const coverUrl = hasCover ? this.getLocalCoverUrl(id) : '';
        return {
          ...track,
          coverUrl,
          album: {
            ...(track.album || {}),
            picUrl: coverUrl || track.album?.picUrl || '',
          },
          al: {
            ...(track.al || {}),
            picUrl: coverUrl || track.al?.picUrl || '',
          },
        };
      }),
    }));
  }

  async getLocalPlaylists() {
    if (!this.localLibrary) return [];
    await this.localDirsReady;
    const playlists = await this.localLibrary.ensureIndexed();
    return this.decorateLocalPlaylists(playlists);
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
    this.reactionScheduler.reset();
    this.reactions = [];
    this.activeReactionSongItem = '';
    this.startedReactionItem = '';
    this.reactionKnownItems = null;
    this.reactionPlayback = null;
    this.reactionEpoch = '';
  }

  addReaction(kind, effect = 'bounce', detail = {}) {
    if (detail.senderId) {
      const result = this.reactionScheduler.scheduleUser({
        kind,
        effect,
        ...detail,
      });
      this.reactions = this.reactionScheduler.recentPublic();
      return result;
    }
    this.reactionScheduler.scheduleAutomatic(kind, effect, detail);
    this.reactions = this.reactionScheduler.recentPublic();
    return { ok: true };
  }

  updateAutomaticReactions(snapshot, presentation) {
    const itemId = snapshot.currentItem?.queueItemId || '';
    if (this.activeReactionSongItem && itemId !== this.activeReactionSongItem) {
      this.reactionScheduler.cancelSongReactions(
        this.activeReactionSongItem,
        'TRACK_CHANGED'
      );
      this.reactions = this.reactionScheduler.recentPublic();
    }
    this.activeReactionSongItem = itemId;
    const currentIds = new Set(
      [itemId, ...snapshot.waitingItems.map(item => item?.queueItemId)].filter(
        Boolean
      )
    );
    if (this.reactionKnownItems) {
      for (const id of currentIds) {
        if (!this.reactionKnownItems.has(id)) {
          const item = [snapshot.currentItem, ...snapshot.waitingItems].find(
            value => value?.queueItemId === id
          );
          this.addReaction('requested', 'bounce', {
            itemId: id,
            customText: `${item?.trackName || '歌曲'}点歌成功`,
          });
        }
      }
    }
    this.reactionKnownItems = currentIds;
    if (this.startedReactionItem && itemId !== this.startedReactionItem) {
      const previous = snapshot.historyItems.find(
        item => item?.queueItemId === this.startedReactionItem
      );
      if (previous?.status === 'played')
        this.addReaction('finished', 'burst', {
          itemId: this.startedReactionItem,
        });
      if (previous?.status === 'skipped')
        this.addReaction('skipped', 'spin', {
          itemId: this.startedReactionItem,
        });
      this.startedReactionItem = '';
    }
    if (itemId && presentation?.itemId === itemId) {
      if (
        this.reactionPlayback?.itemId === itemId &&
        this.reactionPlayback.playing !== presentation.playing
      )
        this.addReaction(
          presentation.playing ? 'resumed' : 'paused',
          'bounce',
          { itemId }
        );
      this.reactionPlayback = { itemId, playing: presentation.playing };
    } else this.reactionPlayback = null;
    if (
      itemId &&
      itemId !== this.startedReactionItem &&
      presentation?.itemId === itemId &&
      presentation.playing
    ) {
      this.startedReactionItem = itemId;
      this.addReaction('started', 'bounce', { itemId });
    }
  }

  recentReactions() {
    this.reactions = this.reactionScheduler.recentPublic();
    return this.reactions;
  }

  guestJoinUrl() {
    const room = this.roomServer.room;
    return room
      ? `${this.publicOrigin}/room/${room.code}/#token=${room.token}`
      : '';
  }

  nextDisplayTrack() {
    const item = this.owner?.snapshot?.waitingItems?.[0];
    if (!item) return null;
    return {
      title: String(item.trackName || '未知歌曲').slice(0, 160),
      artists: Array.isArray(item.artists)
        ? item.artists.slice(0, 5).map(artist => String(artist).slice(0, 80))
        : [],
    };
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

  preparePvLyrics(body, snapshot, presentation) {
    const owner = this.owner;
    const itemId = snapshot.currentItem?.queueItemId || '';
    let document = owner?.pvLyrics || null;
    let fingerprint = owner?.pvLyricsFingerprint || '';
    let sequence = owner?.pvLyricsSequence || 0;
    if (
      document &&
      (document.itemId !== itemId ||
        (presentation && presentation.itemId !== document.itemId))
    ) {
      document = null;
      fingerprint = '';
    }
    if (Object.prototype.hasOwnProperty.call(body, 'pvLyrics')) {
      if (body.pvLyrics === null) {
        document = null;
        fingerprint = '';
      } else {
        const sanitized = sanitizeLyricDocument(body.pvLyrics);
        if (
          sanitized.itemId !== itemId ||
          (presentation && sanitized.itemId !== presentation.itemId)
        )
          throw new Error('INVALID_PV_LYRICS_ITEM');
        // A lost host reply can repeat an upload. Keep its revision and object.
        const nextFingerprint = JSON.stringify(sanitized);
        if (nextFingerprint !== fingerprint) {
          document = Object.freeze({ ...sanitized, revision: ++sequence });
          fingerprint = nextFingerprint;
        }
      }
    }
    return {
      pvLyrics: document,
      pvLyricsFingerprint: fingerprint,
      pvLyricsSequence: sequence,
    };
  }

  prepareAppearance(value, presentation, previous = null) {
    const source = value ||
      previous?.appearance || {
        mode: presentation?.mode,
        effect: presentation?.effect,
        fontSize: presentation?.fontSize,
        offset: presentation?.offset,
        theme: presentation?.theme,
      };
    const appearance = normalizeAppearanceConfig(source);
    const fingerprint = JSON.stringify(appearance);
    const previousFingerprint = previous?.appearanceFingerprint || '';
    const appearanceRevision =
      fingerprint === previousFingerprint
        ? previous.appearanceRevision
        : (previous?.appearanceRevision || 0) + 1;
    return {
      appearance,
      appearanceFingerprint: fingerprint,
      appearanceRevision,
    };
  }

  prepareSmartBeatTimeline(value, presentation, previous = null) {
    const previousTrackKey = previous?.presentation?.smartBeat?.trackKey || '';
    const nextTrackKey = presentation?.smartBeat?.trackKey || '';
    if (value !== undefined) {
      if (
        !value ||
        !Number.isSafeInteger(value.revision) ||
        value.revision < 0 ||
        !Object.prototype.hasOwnProperty.call(value, 'timeline')
      )
        throw new Error('INVALID_SMART_BEAT_REVISION');
      const revision = value.revision;
      const timeline = value.timeline
        ? sanitizeSmartBeatTimeline(value.timeline)
        : null;
      const expectedRevision = presentation?.smartBeat?.analysisRevision ?? 0;
      if (
        revision !== expectedRevision ||
        (previous && revision < (previous.smartBeatRevision || 0))
      )
        throw new Error('INVALID_SMART_BEAT_REVISION');
      if (
        timeline &&
        (!nextTrackKey ||
          timeline.trackKey !== nextTrackKey ||
          (presentation.itemId &&
            !timeline.trackKey.startsWith(`${presentation.itemId}:`)))
      )
        throw new Error('INVALID_SMART_BEAT_TRACK');
      return { smartBeatRevision: revision, smartBeatTimeline: timeline };
    }
    if (previousTrackKey !== nextTrackKey) {
      return {
        smartBeatRevision:
          presentation?.smartBeat?.analysisRevision ??
          (previous?.smartBeatRevision || 0) + 1,
        smartBeatTimeline: null,
      };
    }
    return {
      smartBeatRevision: previous?.smartBeatRevision || 0,
      smartBeatTimeline: previous?.smartBeatTimeline || null,
    };
  }

  async describe() {
    const room = this.roomServer.room;
    if (!room) return null;
    const url = this.guestJoinUrl();
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
      if (size > 1024 * 1024) throw new Error('BODY_TOO_LARGE');
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

  async readVisualAssetBody(request) {
    const declaredLength = Number(request.headers['content-length']);
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_VISUAL_ASSET_BYTES
    ) {
      request.pause();
      throw new Error('ASSET_TOO_LARGE');
    }

    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      let settled = false;
      const fail = error => {
        if (settled) return;
        settled = true;
        chunks.length = 0;
        request.pause();
        reject(error);
      };
      request.on('data', chunk => {
        if (settled) return;
        if (size + chunk.length > MAX_VISUAL_ASSET_BYTES) {
          fail(new Error('ASSET_TOO_LARGE'));
          return;
        }
        size += chunk.length;
        chunks.push(chunk);
      });
      request.on('end', () => {
        if (settled) return;
        settled = true;
        resolve(Buffer.concat(chunks, size));
      });
      request.on('error', error => fail(error));
      request.on('aborted', () => fail(new Error('UPLOAD_ABORTED')));
    });
  }

  async handleVisualAssetUpload(request, response, token) {
    const rejectBeforeRead = (status, body) => {
      const result = this.json(response, status, body);
      if (!request.complete) request.resume();
      return result;
    };
    const mimeHeader = String(request.headers['content-type'] || '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase();
    if (
      !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(
        mimeHeader
      )
    )
      return rejectBeforeRead(415, { error: 'UNSUPPORTED_IMAGE_TYPE' });

    const role = request.headers['x-ktv-visual-asset-role'];
    if (
      role !== undefined &&
      (typeof role !== 'string' || !/^[a-z][a-z0-9_-]{0,47}$/i.test(role))
    )
      return rejectBeforeRead(400, { error: 'INVALID_ASSET_ROLE' });
    if (this.visualAssetUploads >= 2)
      return rejectBeforeRead(429, { error: 'ASSET_UPLOAD_BUSY' });

    const generation = this.generation;
    this.visualAssetUploads++;
    try {
      const bytes = await this.readVisualAssetBody(request);
      const detectedMime = detectVisualAssetMime(bytes);
      if (!detectedMime || detectedMime !== mimeHeader)
        return this.json(response, 415, { error: 'INVALID_IMAGE' });

      this.expire();
      if (
        !this.owner ||
        this.owner.token !== token ||
        this.generation !== generation
      )
        return this.json(response, 401, { error: 'INVALID_HOST_TOKEN' });

      const asset = await this.visualAssetStore.put(bytes);
      this.expire();
      if (
        !this.owner ||
        this.owner.token !== token ||
        this.generation !== generation
      )
        return this.json(response, 401, { error: 'INVALID_HOST_TOKEN' });
      this.owner.lastSeen = this.now();
      return this.json(response, 200, {
        id: asset.id,
        url: asset.url,
        mime: asset.mime,
      });
    } catch (error) {
      if (response.destroyed || response.writableEnded) return;
      const code = error.code || error.message;
      const status =
        code === 'ASSET_TOO_LARGE' || code === 'ASSET_STORE_FULL'
          ? 413
          : code === 'INVALID_IMAGE'
          ? 415
          : code === 'UPLOAD_ABORTED'
          ? 400
          : 500;
      if (code === 'ASSET_TOO_LARGE' && !request.complete)
        response.setHeader('Connection', 'close');
      this.json(response, status, { error: code || 'ASSET_UPLOAD_FAILED' });
    } finally {
      this.visualAssetUploads = Math.max(0, this.visualAssetUploads - 1);
    }
  }

  async handleVisualAssetRead(request, response, id) {
    if (request.method !== 'GET')
      return this.json(response, 405, { error: 'READ_ONLY' });
    if (this.visualAssetReads >= 8)
      return this.json(response, 503, { error: 'ASSET_READ_BUSY' });
    this.visualAssetReads++;
    try {
      const asset = await this.visualAssetStore.get(id);
      if (!asset) return this.json(response, 404, { error: 'NOT_FOUND' });
      response.writeHead(200, {
        'Content-Type': asset.mime,
        'Content-Length': asset.bytes.length,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(asset.bytes);
    } catch (_) {
      if (!response.destroyed && !response.writableEnded)
        this.json(response, 500, { error: 'ASSET_READ_FAILED' });
    } finally {
      this.visualAssetReads = Math.max(0, this.visualAssetReads - 1);
    }
  }

  async handleLocalRoute(request, response, route) {
    if (!this.localLibrary) {
      return this.json(response, 404, { error: 'LOCAL_LIBRARY_UNAVAILABLE' });
    }
    await this.localDirsReady;

    const audioMatch = route.match(
      /^\/ktv\/local\/audio\/(local-[a-f0-9]{16})$/i
    );
    if (audioMatch) {
      if (request.method !== 'GET')
        return this.json(response, 405, { error: 'METHOD_NOT_ALLOWED' });
      await this.localLibrary.ensureIndexed();
      const resolved = await this.localLibrary.resolve(audioMatch[1]);
      if (!resolved || !resolved.audioPath)
        return this.roomServer.notFound(response);
      return this.roomServer.sendLocalAudio(
        resolved.audioPath,
        request,
        response
      );
    }

    const coverMatch = route.match(
      /^\/ktv\/local\/cover\/(local-[a-f0-9]{16})$/i
    );
    if (coverMatch) {
      if (request.method !== 'GET')
        return this.json(response, 405, { error: 'METHOD_NOT_ALLOWED' });
      await this.localLibrary.ensureIndexed();
      const resolved = await this.localLibrary.resolve(coverMatch[1]);
      if (!resolved || !resolved.coverPath)
        return this.roomServer.notFound(response);
      return this.roomServer.sendLocalCover(resolved.coverPath, response);
    }

    const resolveMatch = route.match(
      /^\/ktv\/local\/resolve\/(local-[a-f0-9]{16})$/i
    );
    if (resolveMatch) {
      if (request.method !== 'GET')
        return this.json(response, 405, { error: 'METHOD_NOT_ALLOWED' });
      await this.localLibrary.ensureIndexed();
      const localId = resolveMatch[1];
      const resolved = await this.localLibrary.resolve(localId);
      if (!resolved)
        return this.json(response, 404, {
          ok: false,
          error: 'LOCAL_TRACK_NOT_FOUND',
        });
      return this.json(response, 200, {
        ok: true,
        localId: resolved.localId,
        name: resolved.name,
        artists: resolved.artists,
        lyrics: resolved.lyrics || [],
        audioPath: resolved.audioPath,
        audioUrl: this.getLocalAudioUrl(localId),
        coverUrl: resolved.coverPath ? this.getLocalCoverUrl(localId) : '',
      });
    }

    if (route === '/ktv/local/list') {
      if (request.method !== 'GET')
        return this.json(response, 405, { error: 'METHOD_NOT_ALLOWED' });
      const playlists = await this.getLocalPlaylists();
      return this.json(response, 200, {
        ok: true,
        directories: this.localLibrary.listDirectories(),
        playlists,
      });
    }

    if (route === '/ktv/local/scan') {
      if (request.method !== 'POST')
        return this.json(response, 405, { error: 'METHOD_NOT_ALLOWED' });
      const playlists = this.decorateLocalPlaylists(
        await this.localLibrary.scan()
      );
      return this.json(response, 200, {
        ok: true,
        directories: this.localLibrary.listDirectories(),
        playlists,
      });
    }

    if (route === '/ktv/local/add-directory') {
      if (request.method !== 'POST')
        return this.json(response, 405, { error: 'METHOD_NOT_ALLOWED' });
      try {
        const body = await this.readBody(request);
        const dir = String(body.directory || '').trim();
        if (!dir)
          return this.json(response, 400, {
            ok: false,
            error: '请输入有效的音乐目录路径',
          });
        try {
          const stat = await fs.stat(dir);
          if (!stat.isDirectory()) {
            return this.json(response, 400, {
              ok: false,
              error: `路径不是有效目录：${dir}`,
            });
          }
        } catch (_) {
          return this.json(response, 400, {
            ok: false,
            error: `服务器目录不存在或不可访问：${dir}`,
          });
        }
        this.localLibrary.addDirectories([dir]);
        await this.saveLocalDirectories();
        const playlists = this.decorateLocalPlaylists(
          await this.localLibrary.scan()
        );
        return this.json(response, 200, {
          ok: true,
          directories: this.localLibrary.listDirectories(),
          playlists,
        });
      } catch (error) {
        return this.json(response, 400, { ok: false, error: error.message });
      }
    }

    if (route === '/ktv/local/remove-directory') {
      if (request.method !== 'POST')
        return this.json(response, 405, { error: 'METHOD_NOT_ALLOWED' });
      try {
        const body = await this.readBody(request);
        const dir = String(body.directory || '').trim();
        this.localLibrary.removeDirectory(dir);
        await this.saveLocalDirectories();
        const playlists = this.decorateLocalPlaylists(
          await this.localLibrary.scan()
        );
        return this.json(response, 200, {
          ok: true,
          directories: this.localLibrary.listDirectories(),
          playlists,
        });
      } catch (error) {
        return this.json(response, 400, { ok: false, error: error.message });
      }
    }

    return this.json(response, 404, { error: 'NOT_FOUND' });
  }

  async handle(request, response) {
    this.expire();
    const url = new URL(request.url, this.publicOrigin);
    const route = url.pathname;
    if (route.startsWith('/ktv/display/visual-assets/')) {
      if (request.method !== 'GET')
        return this.json(response, 405, { error: 'READ_ONLY' });
      const match = route.match(
        /^\/ktv\/display\/visual-assets\/([a-f0-9]{64})$/
      );
      if (!match) return this.json(response, 404, { error: 'NOT_FOUND' });
      return this.handleVisualAssetRead(request, response, match[1]);
    }
    if (route === '/ktv/health')
      return this.json(response, 200, {
        ok: true,
        active: Boolean(this.owner),
        ...(this.requiredUiRevision
          ? { uiRevision: this.requiredUiRevision }
          : {}),
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
              smartBeatRevision: owner.smartBeatRevision || 0,
              smartBeatTrackKey: owner.presentation?.smartBeat?.trackKey || '',
              appearanceRevision: owner.appearanceRevision,
              pvLyricsRevision: owner.pvLyrics?.revision ?? null,
              pvLyricsItemId: owner.pvLyrics?.itemId ?? null,
              joinUrl: this.guestJoinUrl(),
              nextTrack: this.nextDisplayTrack(),
              reactions: this.recentReactions(),
              reactionEpoch: this.reactionEpoch,
              ...(owner.uiRevision ? { hostUiRevision: owner.uiRevision } : {}),
            }
          : { active: false }
      );
    }
    if (route === '/ktv/display/appearance') {
      if (request.method !== 'GET')
        return this.json(response, 405, { error: 'READ_ONLY' });
      const owner = this.owner;
      if (
        !owner ||
        url.searchParams.get('generation') !== String(this.generation) ||
        url.searchParams.get('revision') !== String(owner.appearanceRevision)
      )
        return this.json(response, 409, { error: 'STALE_DISPLAY_APPEARANCE' });
      return this.json(response, 200, {
        generation: this.generation,
        revision: owner.appearanceRevision,
        config: owner.appearance,
      });
    }
    if (route === '/ktv/display/analysis') {
      if (request.method !== 'GET')
        return this.json(response, 405, { error: 'READ_ONLY' });
      const owner = this.owner;
      if (
        !owner ||
        url.searchParams.get('generation') !== String(this.generation) ||
        url.searchParams.get('revision') !== String(owner.smartBeatRevision)
      )
        return this.json(response, 409, { error: 'STALE_SMART_BEAT_ANALYSIS' });
      return this.json(response, 200, {
        generation: this.generation,
        revision: owner.smartBeatRevision,
        timeline: owner.smartBeatTimeline,
      });
    }
    // Same public, read-only capability as /ktv/display; never accept host writes.
    if (route === '/ktv/display/lyrics') {
      if (request.method !== 'GET')
        return this.json(response, 405, { error: 'READ_ONLY' });
      const document = this.owner?.pvLyrics;
      if (
        !document ||
        url.searchParams.get('generation') !== String(this.generation) ||
        url.searchParams.get('revision') !== String(document.revision)
      )
        return this.json(response, 409, { error: 'STALE_PV_LYRICS' });
      return this.json(response, 200, document);
    }
    if (route === '/ktv/api/reactions') {
      if (request.method !== 'POST')
        return this.json(response, 405, { error: 'METHOD_NOT_ALLOWED' });
      if (request.headers.origin !== this.publicOrigin)
        return this.json(response, 403, { error: 'FORBIDDEN' });
      if (!/^application\/json/.test(request.headers['content-type'] || ''))
        return this.json(response, 415, { error: 'JSON_REQUIRED' });
      const token = (request.headers.authorization || '').replace(
        /^Bearer /,
        ''
      );
      let client;
      try {
        client = this.service.client(token);
      } catch (_) {
        return this.json(response, 401, { error: 'INVALID_CLIENT_TOKEN' });
      }
      try {
        const body = await this.readBody(request);
        this.expire();
        this.service.client(token);
        if (
          body.kind === 'emotion'
            ? !upstreamReactions.some(item => item.emotion === body.emotionId)
            : !reactionChoices.some(item => item.kind === body.kind)
        )
          return this.json(response, 400, { error: 'INVALID_REACTION' });
        if (
          body.character !== undefined &&
          !reactionCharacters.some(item => item.id === body.character)
        )
          return this.json(response, 400, { error: 'INVALID_CHARACTER' });
        if (body.effect && !isValidReactionEffect(body.effect))
          return this.json(response, 400, { error: 'INVALID_EFFECT' });
        const customText = normalizeReactionText(body.customText);
        if (
          !this.service.limiter.check(`reaction:${client.clientId}`, 8) ||
          !this.service.limiter.check('reaction:room', 40)
        )
          return this.json(response, 429, { error: 'RATE_LIMIT' });
        const scheduled = this.addReaction(body.kind, body.effect || 'bounce', {
          ...body,
          customText,
          senderId: client.clientId,
          itemId: this.owner?.snapshot?.currentItem?.queueItemId || '',
        });
        if (!scheduled.ok)
          return this.json(response, 429, {
            error: scheduled.code || 'REACTION_QUEUE_FULL',
            status: 'busy',
            queuePosition: scheduled.queuePosition,
          });
        return this.json(response, 200, {
          ok: true,
          status: scheduled.status,
          queuePosition: scheduled.queuePosition,
          eventId: scheduled.event.id,
          startAt: scheduled.event.startAt,
          endsAt: scheduled.event.endsAt,
        });
      } catch (error) {
        return this.json(
          response,
          error.message === 'BODY_TOO_LARGE' ? 413 : 400,
          { error: error.message }
        );
      }
    }
    if (route.startsWith('/ktv/local/')) {
      return this.handleLocalRoute(request, response, route);
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
    if (route === '/ktv/host/visual-assets') {
      const token = (request.headers.authorization || '').replace(
        /^Bearer /,
        ''
      );
      if (!this.owner || token !== this.owner.token) {
        const result = this.json(response, 401, {
          error: 'INVALID_HOST_TOKEN',
        });
        if (!request.complete) request.resume();
        return result;
      }
      return this.handleVisualAssetUpload(request, response, token);
    }
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
        if (
          Object.prototype.hasOwnProperty.call(body, 'catalogEpoch') &&
          (!Number.isSafeInteger(body.catalogEpoch) || body.catalogEpoch < 0)
        )
          return this.json(response, 409, { error: 'INVALID_CATALOG_EPOCH' });
        if (
          this.requiredUiRevision &&
          body.uiRevision !== this.requiredUiRevision
        )
          return this.json(response, 409, {
            error: '主屏界面已更新，请刷新页面后重新指定主电脑',
          });
        this.validateSnapshot(body.snapshot);
        const presentation = body.presentation
          ? sanitizePresentation(body.presentation)
          : null;
        const lyrics = this.preparePvLyrics(body, body.snapshot, presentation);
        const appearance = this.prepareAppearance(
          body.appearance,
          presentation
        );
        const smartBeat = this.prepareSmartBeatTimeline(
          body.smartBeatTimeline,
          presentation
        );
        this.owner = {
          uiRevision: body.uiRevision || '',
          token: secret(),
          snapshot: body.snapshot,
          lastSeen: this.now(),
          name:
            typeof body.hostName === 'string'
              ? body.hostName.trim().slice(0, 40) || '主电脑'
              : '主电脑',
          presentation,
          presentedAt: presentation ? this.now() : 0,
          ...lyrics,
          ...appearance,
          ...smartBeat,
          ...(Object.prototype.hasOwnProperty.call(body, 'catalogEpoch')
            ? { catalogEpoch: body.catalogEpoch }
            : {}),
        };
        this.roomServer.room = {
          code: crypto.randomBytes(3).toString('hex').toUpperCase(),
          name: 'LumaSing KTV',
          token: secret(),
          generation: ++this.generation,
          sessionId: body.snapshot.session.sessionId,
          ...(Number.isSafeInteger(this.owner.catalogEpoch)
            ? { catalogEpoch: this.owner.catalogEpoch }
            : {}),
        };
        this.service.onRoomStart(this.roomServer.room);
        this.reactionEpoch = crypto.randomBytes(12).toString('hex');
        this.updateAutomaticReactions(body.snapshot, presentation);
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
        if (Object.prototype.hasOwnProperty.call(body, 'catalogEpoch')) {
          const epoch = body.catalogEpoch;
          if (!Number.isSafeInteger(epoch) || epoch < 0)
            return this.json(response, 409, {
              error: 'INVALID_CATALOG_EPOCH',
            });
          if (
            Number.isSafeInteger(this.owner.catalogEpoch) &&
            epoch < this.owner.catalogEpoch
          )
            return this.json(response, 409, {
              error: 'STALE_CATALOG_EPOCH',
            });
          if (this.owner.catalogEpoch !== epoch) {
            this.service.catalog.resetRoomCatalog?.();
            for (const [id, entry] of this.pending) {
              if (entry.command.action !== 'catalog') continue;
              clearTimeout(entry.timer);
              this.pending.delete(id);
              entry.reject(new Error('CATALOG_EPOCH_CHANGED'));
            }
            this.owner.catalogEpoch = epoch;
            if (this.roomServer.room) this.roomServer.room.catalogEpoch = epoch;
          }
        }
        if (body.snapshot) this.validateSnapshot(body.snapshot);
        const presentation = body.presentation
          ? sanitizePresentation(body.presentation)
          : null;
        const lyrics = this.preparePvLyrics(
          body,
          body.snapshot || this.owner.snapshot,
          presentation
        );
        const appearance = this.prepareAppearance(
          Object.prototype.hasOwnProperty.call(body, 'appearance')
            ? body.appearance
            : undefined,
          presentation,
          this.owner
        );
        const smartBeat = this.prepareSmartBeatTimeline(
          Object.prototype.hasOwnProperty.call(body, 'smartBeatTimeline')
            ? body.smartBeatTimeline
            : undefined,
          presentation || this.owner.presentation,
          this.owner
        );
        Object.assign(this.owner, lyrics, appearance);
        Object.assign(this.owner, smartBeat);
        this.owner.lastSeen = this.now();
        if (presentation) {
          this.owner.presentation = presentation;
          this.owner.presentedAt = this.now();
        }
        if (body.snapshot) this.owner.snapshot = body.snapshot;
        this.updateAutomaticReactions(
          this.owner.snapshot,
          this.owner.presentation
        );
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
          reactions: this.recentReactions(),
          reactionEpoch: this.reactionEpoch,
          serverTime: this.now(),
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
