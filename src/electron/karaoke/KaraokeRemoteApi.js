import {
  CLIENT_TTL,
  RateLimiter,
  RemoteClientSessionStore,
} from './KaraokeRemoteSessionState.js';

export { RemoteApiRouter } from './KaraokeRemoteApiRouter.js';

export { RemoteClientSessionStore };

const ENQUEUE_REQUEST_TTL = CLIENT_TTL;
const MAX_ENQUEUE_REQUESTS = 8192;
export { KaraokeCatalogService } from './KaraokeCatalogService.js';

export class KaraokeRemoteService {
  constructor({ catalog, managerBridge, getRoom }) {
    this.catalog = catalog;
    this.managerBridge = managerBridge;
    this.getRoom = getRoom;
    this.sessions = new RemoteClientSessionStore();
    this.limiter = new RateLimiter();
    this.enqueueRequests = new Map();
  }

  onRoomStart(room) {
    this.sessions.start(room);
    this.limiter.clear();
    this.enqueueRequests.clear();
    if (typeof this.catalog.resetRoomCatalog === 'function')
      this.catalog.resetRoomCatalog();
  }

  onRoomStop() {
    this.sessions.stop();
    this.limiter.clear();
    this.enqueueRequests.clear();
    if (typeof this.catalog.resetRoomCatalog === 'function')
      this.catalog.resetRoomCatalog();
  }

  ensureActive() {
    if (!this.getRoom()) throw new Error('ROOM_ENDED');
  }

  bootstrap(joinToken, remoteAddress = '', publicGuest = false) {
    this.ensureActive();
    this.sessions.purgeExpired();
    if (
      !this.limiter.check(`bootstrap:${remoteAddress}`, publicGuest ? 40 : 10)
    )
      throw new Error('RATE_LIMIT');
    if (!this.limiter.check('bootstrap:room', 40))
      throw new Error('RATE_LIMIT');
    if (this.sessions.clients.size >= 32) throw new Error('ROOM_FULL');
    const session = this.sessions.create(joinToken);
    session.publicGuest = publicGuest;
    return {
      clientId: session.clientId,
      clientToken: session.clientToken,
      displayName: session.displayName,
    };
  }

  client(tokenValue, publicGuest = false) {
    this.ensureActive();
    const session = this.sessions.authorize(tokenValue);
    if (Boolean(session.publicGuest) !== publicGuest)
      throw new Error('INVALID_CLIENT_TOKEN');
    return session;
  }

  async state(client) {
    if (!this.limiter.check(`state:${client.clientId}`, 40))
      throw new Error('RATE_LIMIT');
    // 19 guests alongside the master polling every 500 ms need about 380
    // requests per 10-second window, leaving room for immediate refreshes.
    if (!this.limiter.check('state:room', 480)) throw new Error('RATE_LIMIT');
    const room = this.getRoom();
    const snapshot = await this.managerBridge.snapshot();
    return {
      ...(Number.isSafeInteger(room && room.catalogEpoch)
        ? { catalogEpoch: room.catalogEpoch }
        : {}),
      revision: snapshot.revision == null ? 0 : snapshot.revision,
      room: {
        active: true,
        code: room.code,
        name: room.name || 'LumaSing KTV',
      },
      current: this.sanitizeItem(snapshot.currentItem),
      waiting: snapshot.waitingItems.map(item => this.sanitizeItem(item)),
      // Played and mid-song skipped songs are exposed as history ("已播放").
      // Failed and unplayed removed queue entries are excluded.
      history: (snapshot.historyItems || [])
        .filter(
          item =>
            item && (item.status === 'played' || item.status === 'skipped')
        )
        .slice(0, 50)
        .map(item => this.sanitizeItem(item)),
      client: {
        clientId: client.clientId,
        displayName: client.displayName,
        permissions: { priority: true },
      },
    };
  }

  sanitizeItem(item) {
    if (!item) return null;
    const safe = {
      queueItemId: item.queueItemId,
      trackId: String(item.trackId),
      name: item.trackName,
      artists: item.artists,
      album: item.albumName,
      coverUrl: item.coverUrl || '',
      requesterName: item.requesterName,
      requesterId: item.requesterId,
      requesterType: item.requesterType || 'host',
      priorityRequested: Boolean(item.priorityRequested),
      status: item.status,
    };
    if (item.source === 'local' || String(item.trackId).startsWith('local-')) {
      safe.source = 'local';
      safe.localId = String(item.localId || item.trackId);
    }
    return safe;
  }

  async search(client, query) {
    const clientKey = `search:${client.clientId}`;
    if (!this.limiter.check(clientKey, 10))
      throw rateLimitError(this.limiter.retryAfterMs(clientKey));
    if (!this.limiter.check('search:room', 80))
      throw rateLimitError(this.limiter.retryAfterMs('search:room'));
    return this.withAvailability(await this.catalog.search(query));
  }

  async playlists(client, options = {}) {
    const clientKey = `playlists:${client.clientId}`;
    if (!this.limiter.check(clientKey, 12))
      throw rateLimitError(this.limiter.retryAfterMs(clientKey));
    if (!this.limiter.check('playlists:room', 48))
      throw rateLimitError(this.limiter.retryAfterMs('playlists:room'));
    return this.catalog.playlists(options);
  }

  async localPlaylists(client) {
    if (!this.limiter.check(`localPlaylists:${client.clientId}`, 12))
      throw new Error('RATE_LIMIT');
    if (!this.limiter.check('localPlaylists:room', 48))
      throw new Error('RATE_LIMIT');
    return this.catalog.localPlaylists();
  }

  async recommendations(client) {
    if (!this.limiter.check(`recommendations:${client.clientId}`, 12))
      throw new Error('RATE_LIMIT');
    if (!this.limiter.check('recommendations:room', 48))
      throw new Error('RATE_LIMIT');
    return this.catalog.recommendations();
  }

  async toplists(client) {
    if (!this.limiter.check(`toplists:${client.clientId}`, 12))
      throw new Error('RATE_LIMIT');
    if (!this.limiter.check('toplists:room', 48)) throw new Error('RATE_LIMIT');
    return this.catalog.toplists();
  }

  async withAvailability(tracks) {
    const source = Array.isArray(tracks) ? tracks : [];
    return source.map(track => ({
      ...track,
      playability:
        track.source === 'local'
          ? 'playable'
          : this.catalog.peekAvailability(track.trackId),
    }));
  }

  async recommendationTracks(client, playlistId) {
    if (!this.limiter.check(`recommendationTracks:${client.clientId}`, 20))
      throw new Error('RATE_LIMIT');
    if (!this.limiter.check('recommendationTracks:room', 120))
      throw new Error('RATE_LIMIT');
    return this.withAvailability(
      await this.catalog.recommendationTracks(playlistId)
    );
  }

  async toplistTracks(client, playlistId) {
    if (!this.limiter.check(`toplistTracks:${client.clientId}`, 20))
      throw new Error('RATE_LIMIT');
    if (!this.limiter.check('toplistTracks:room', 120))
      throw new Error('RATE_LIMIT');
    return this.withAvailability(await this.catalog.toplistTracks(playlistId));
  }

  async artistSearch(client, query) {
    if (!this.limiter.check(`artistSearch:${client.clientId}`, 30))
      throw new Error('RATE_LIMIT');
    if (!this.limiter.check('artistSearch:room', 120))
      throw new Error('RATE_LIMIT');
    return this.catalog.artistSearch(query);
  }

  async artistTracks(client, artistId) {
    const clientKey = `artistTracks:${client.clientId}`;
    if (!this.limiter.check(clientKey, 20))
      throw rateLimitError(this.limiter.retryAfterMs(clientKey));
    if (!this.limiter.check('artistTracks:room', 120))
      throw rateLimitError(this.limiter.retryAfterMs('artistTracks:room'));
    if (!/^\d{1,20}$/.test(String(artistId)))
      throw new Error('ARTIST_NOT_FOUND');
    return this.withAvailability(await this.catalog.artistTracks(artistId));
  }

  async artistTracksPage(client, artistId, pageOptions) {
    const clientKey = `artistTracks:${client.clientId}`;
    if (!this.limiter.check(clientKey, 20))
      throw rateLimitError(this.limiter.retryAfterMs(clientKey));
    if (!this.limiter.check('artistTracks:room', 120))
      throw rateLimitError(this.limiter.retryAfterMs('artistTracks:room'));
    if (!/^\d{1,20}$/.test(String(artistId)))
      throw new Error('ARTIST_NOT_FOUND');
    const page = await this.catalog.artistTracksPage(artistId, pageOptions);
    return { ...page, tracks: await this.withAvailability(page.tracks) };
  }

  async playlistTracks(client, playlistId, pageOptions = null) {
    const clientKey = `playlistTracks:${client.clientId}`;
    if (!this.limiter.check(clientKey, 20))
      throw rateLimitError(this.limiter.retryAfterMs(clientKey));
    if (!this.limiter.check('playlistTracks:room', 120))
      throw rateLimitError(this.limiter.retryAfterMs('playlistTracks:room'));
    if (!/^\d{1,20}$/.test(String(playlistId)))
      throw new Error('PLAYLIST_NOT_FOUND');
    const tracks = await this.catalog.playlistTracks(playlistId, pageOptions);
    return Array.isArray(tracks)
      ? await this.withAvailability(tracks)
      : { ...tracks, tracks: await this.withAvailability(tracks.tracks) };
  }

  async availability(client, trackId) {
    if (!this.limiter.check(`availability:${client.clientId}`, 20))
      throw new Error('RATE_LIMIT');
    if (!this.limiter.check('availability:room', 120))
      throw new Error('RATE_LIMIT');
    return this.catalog.availability(trackId);
  }

  async preview(client, trackId) {
    if (!this.limiter.check(`preview:${client.clientId}`, 20))
      throw new Error('RATE_LIMIT');
    if (!this.limiter.check('preview:room', 120)) throw new Error('RATE_LIMIT');
    if (!/^\d{1,20}$/.test(String(trackId))) throw new Error('TRACK_NOT_FOUND');
    return this.catalog.preview(trackId);
  }

  purgeEnqueueRequests(now = Date.now()) {
    for (const [key, entry] of this.enqueueRequests) {
      if (entry.expiresAt <= now) this.enqueueRequests.delete(key);
    }
  }

  async enqueue(client, trackId, priority, requestId) {
    if (requestId === undefined)
      return this.enqueueTrack(client, trackId, priority);
    if (
      typeof requestId !== 'string' ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(requestId)
    )
      throw new Error('INVALID_REQUEST_ID');

    const key = JSON.stringify([client.sessionId, client.clientId, requestId]);
    const fingerprint = JSON.stringify({
      trackId: String(trackId),
      priority: priority === true,
    });
    const now = Date.now();
    this.purgeEnqueueRequests(now);
    const existing = this.enqueueRequests.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw new Error('IDEMPOTENCY_KEY_REUSED');
      existing.expiresAt = now + ENQUEUE_REQUEST_TTL;
      this.enqueueRequests.delete(key);
      this.enqueueRequests.set(key, existing);
      return existing.promise;
    }
    if (this.enqueueRequests.size >= MAX_ENQUEUE_REQUESTS)
      throw new Error('IDEMPOTENCY_CAPACITY');

    const entry = {
      fingerprint,
      expiresAt: now + ENQUEUE_REQUEST_TTL,
      promise: null,
    };
    entry.promise = Promise.resolve()
      .then(() =>
        this.enqueueTrack(client, trackId, priority, () => {
          entry.mutationStarted = true;
        })
      )
      .catch(exception => {
        // Keep outcomes once the host enqueue command has started. Its reply
        // can be lost after the queue changed, so retrying must never enqueue
        // a second item. Failures before that point may safely be attempted
        // again with the same key.
        if (!entry.mutationStarted && this.enqueueRequests.get(key) === entry)
          this.enqueueRequests.delete(key);
        throw exception;
      });
    this.enqueueRequests.set(key, entry);
    return entry.promise;
  }

  async enqueueTrack(client, trackId, priority, onMutationStart = () => {}) {
    if (!this.limiter.check(`mutation:${client.clientId}`, 20))
      throw new Error('RATE_LIMIT');
    if (!this.limiter.check('mutation:room', 120))
      throw new Error('RATE_LIMIT');
    const [track, availability] = await Promise.all([
      this.catalog.getTrack(trackId),
      this.catalog.availability(trackId, { fresh: true }),
    ]);
    this.client(client.clientToken, Boolean(client.publicGuest));
    if (availability !== 'playable') throw new Error('TRACK_NOT_PLAYABLE');
    this.client(client.clientToken, Boolean(client.publicGuest));
    const expected = {
      sessionId: client.sessionId,
      generation: client.generation,
    };
    onMutationStart();
    const item = await this.managerBridge.enqueue(
      {
        id: track.trackId,
        name: track.name,
        ar: track.artists.map(name => ({ name })),
        al: { name: track.album, picUrl: track.coverUrl },
        dt: track.duration,
        source: track.source,
        localId: track.localId,
        lyrics: track.lyrics,
      },
      {
        id: client.clientId,
        name: client.displayName,
        type: 'remote',
        priorityRequested: Boolean(priority),
      },
      expected
    );
    if (!item) throw new Error('KTV_NOT_ACTIVE');
    if (priority) {
      this.client(client.clientToken, Boolean(client.publicGuest));
      await this.managerBridge.front(item.queueItemId, expected);
    }
    return this.sanitizeItem(item);
  }

  async ownWaitingItem(client, queueItemId) {
    const snapshot = await this.managerBridge.snapshot();
    const item = snapshot.waitingItems.find(
      entry => entry.queueItemId === queueItemId
    );
    if (!item) throw new Error('WAITING_ITEM_NOT_FOUND');
    if (item.requesterId !== client.clientId) throw new Error('FORBIDDEN');
    return item;
  }

  async remove(client, queueItemId) {
    if (!this.limiter.check(`mutation:${client.clientId}`, 20))
      throw new Error('RATE_LIMIT');
    if (!this.limiter.check('mutation:room', 120))
      throw new Error('RATE_LIMIT');
    await this.ownWaitingItem(client, queueItemId);
    this.client(client.clientToken, Boolean(client.publicGuest));
    const item = await this.managerBridge.remove(queueItemId, {
      sessionId: client.sessionId,
      generation: client.generation,
    });
    if (!item) throw new Error('WAITING_ITEM_NOT_FOUND');
    return this.sanitizeItem(item);
  }

  async front(client, queueItemId) {
    if (!this.limiter.check(`mutation:${client.clientId}`, 20))
      throw new Error('RATE_LIMIT');
    if (!this.limiter.check('mutation:room', 120))
      throw new Error('RATE_LIMIT');
    await this.ownWaitingItem(client, queueItemId);
    this.client(client.clientToken, Boolean(client.publicGuest));
    const snapshot = await this.managerBridge.snapshot();
    if (
      snapshot.waitingItems[0] &&
      snapshot.waitingItems[0].queueItemId === queueItemId
    )
      return;
    if (
      !(await this.managerBridge.front(queueItemId, {
        sessionId: client.sessionId,
        generation: client.generation,
      }))
    )
      throw new Error('WAITING_ITEM_NOT_FOUND');
  }

  async next(client) {
    if (!this.limiter.check(`mutation:${client.clientId}`, 20))
      throw new Error('RATE_LIMIT');
    if (!this.limiter.check('mutation:room', 120))
      throw new Error('RATE_LIMIT');
    this.client(client.clientToken, Boolean(client.publicGuest));
    const item = await this.managerBridge.next({
      sessionId: client.sessionId,
      generation: client.generation,
    });
    return item ? this.sanitizeItem(item) : null;
  }
}

function rateLimitError(retryAfterMs) {
  const exception = new Error('RATE_LIMIT');
  exception.retryAfterMs = retryAfterMs;
  return exception;
}
