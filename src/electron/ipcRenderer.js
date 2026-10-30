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

const FEATURED_ARTIST_FALLBACKS = [
  { id: '6452', name: '周杰伦', coverUrl: '', albumCount: 38, mvCount: 0 },
  { id: '3684', name: '林俊杰', coverUrl: '', albumCount: 42, mvCount: 0 },
  { id: '7763', name: '邓紫棋', coverUrl: '', albumCount: 35, mvCount: 0 },
  { id: '2116', name: '陈奕迅', coverUrl: '', albumCount: 96, mvCount: 0 },
  { id: '5781', name: '薛之谦', coverUrl: '', albumCount: 28, mvCount: 0 },
  { id: '6066', name: '杨宗纬', coverUrl: '', albumCount: 18, mvCount: 0 },
];

async function resolvePlaylistCatalogTracks(playlistId, limit = 100) {
  const detail = await getPlaylistDetail(playlistId, false);
  const trackIds = (detail?.playlist?.trackIds || [])
    .map(track => String(track.id || track))
    .filter(trackId => /^\d{1,20}$/.test(trackId));
  const initialTracks = Array.isArray(detail?.playlist?.tracks)
    ? detail.playlist.tracks
    : [];
  const targetCount = Math.min(trackIds.length || initialTracks.length, limit);
  let tracks = initialTracks;
  const hasCompleteInitial =
    initialTracks.length >= targetCount &&
    initialTracks
      .slice(0, targetCount)
      .every(
        track =>
          track?.id && track?.name && Array.isArray(track.ar || track.artists)
      );
  if (!hasCompleteInitial && trackIds.length) {
    const data = await getTrackDetail(trackIds.slice(0, limit).join(','));
    tracks = data?.songs || initialTracks;
  }
  const tracksById = new Map(
    tracks.filter(track => track?.id).map(track => [String(track.id), track])
  );
  const orderedTracks = (
    trackIds.length ? trackIds : tracks.map(track => String(track.id))
  )
    .map(trackId => tracksById.get(trackId))
    .filter(Boolean)
    .slice(0, limit);
  return orderedTracks.map(safeCatalogTrack);
}

async function getUserPlaylistAllowlist(store, { force = false } = {}) {
  if (!isAccountLoggedIn()) throw new Error('HOST_NOT_LOGGED_IN');
  const uid = store?.state?.data?.user?.userId;
  if (!uid) throw new Error('HOST_NOT_LOGGED_IN');
  return userPlaylistCache({
    userId: uid,
    force,
    fetchPlaylists: async () => {
      const preloaded = store?.state?.liked?.playlists;
      if (!force && Array.isArray(preloaded) && preloaded.length > 0) {
        return preloaded.map(safePlaylist);
      }
      const data = await userPlaylist({
        uid,
        limit: 2000,
        timestamp: Date.now(),
      });
      return (data?.playlist || []).map(safePlaylist);
    },
  });
}

export async function hostCatalog(action, payload = {}, store = null) {
  if (action === 'search') {
    const data = await search({
      keywords: String(payload.query || ''),
      limit: 15,
      type: 1,
    });
    const songs = data.result?.songs || data.result?.song?.songs || [];
    return songs.slice(0, 15).map(safeCatalogTrack);
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
    const data = await getArtist(artistId);
    return (data?.hotSongs || []).slice(0, 30).map(safeCatalogTrack);
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
    return getUserPlaylistAllowlist(store, { force: Boolean(payload.force) });
  }
  if (action === 'playlistTracks') {
    const playlistId = String(payload.playlistId || '');
    if (!/^\d{1,20}$/.test(playlistId)) throw new Error('PLAYLIST_NOT_FOUND');
    const playlists = await getUserPlaylistAllowlist(store);
    const allowed = playlists.some(
      playlist => String(playlist.id) === playlistId
    );
    if (!allowed) throw new Error('PLAYLIST_NOT_FOUND');
    return resolvePlaylistCatalogTracks(playlistId, 100);
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
