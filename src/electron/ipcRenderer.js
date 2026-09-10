import { search } from '@/api/others';
import { getMP3, getTrackDetail } from '@/api/track';
import { getPlaylistDetail, recommendPlaylist, toplists } from '@/api/playlist';
import { getRecommendPlayList } from '@/utils/playList';
import { getArtist } from '@/api/artist';
import { userPlaylist } from '@/api/user';
import { isAccountLoggedIn } from '@/utils/auth';

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

async function hostCatalog(action, payload = {}, store = null) {
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
    const data = await search({
      keywords: String(payload.query || ''),
      limit: 12,
      type: 100,
    });
    const artists = data.result?.artists || data.result?.artist?.artists || [];
    return artists.slice(0, 12).map(safeArtist);
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
      playlists = await getRecommendPlayList(10, false);
    } catch (_) {
      const fallback = await recommendPlaylist({ limit: 10 });
      playlists = fallback?.result || [];
    }
    return (playlists || []).slice(0, 10).map(safePlaylist);
  }
  if (action === 'recommendationTracks') {
    const playlistId = String(payload.playlistId || '');
    if (!/^\d{1,20}$/.test(playlistId)) throw new Error('PLAYLIST_NOT_FOUND');
    const detail = await getPlaylistDetail(playlistId, true);
    const trackIds = (detail?.playlist?.trackIds || [])
      .map(track => String(track.id || track))
      .filter(trackId => /^\d{1,20}$/.test(trackId));
    const initialTracks = detail?.playlist?.tracks || [];
    let tracks = initialTracks;
    if (trackIds.length) {
      const data = await getTrackDetail(trackIds.slice(0, 100).join(','));
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
      .slice(0, 100);
    return orderedTracks.map(safeCatalogTrack);
  }
  if (action === 'toplists') {
    const data = await toplists();
    return (data?.list || []).slice(0, 20).map(safePlaylist);
  }
  if (action === 'toplistTracks') {
    const playlistId = String(payload.playlistId || '');
    if (!/^\d{1,20}$/.test(playlistId)) throw new Error('PLAYLIST_NOT_FOUND');
    const detail = await getPlaylistDetail(playlistId, true);
    const trackIds = (detail?.playlist?.trackIds || [])
      .map(track => String(track.id || track))
      .filter(trackId => /^\d{1,20}$/.test(trackId));
    const initialTracks = detail?.playlist?.tracks || [];
    let tracks = initialTracks;
    if (trackIds.length) {
      const data = await getTrackDetail(trackIds.slice(0, 100).join(','));
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
      .slice(0, 100);
    return orderedTracks.map(safeCatalogTrack);
  }
  if (action === 'trackDetail') {
    const data = await getTrackDetail(String(payload.trackId));
    const track = data?.songs?.[0];
    if (!track) throw new Error('TRACK_NOT_FOUND');
    return safeCatalogTrack(track);
  }
  if (action === 'playlists') {
    if (!isAccountLoggedIn()) throw new Error('HOST_NOT_LOGGED_IN');
    const uid = store?.state?.data?.user?.userId;
    if (!uid) throw new Error('HOST_NOT_LOGGED_IN');
    const data = await userPlaylist({
      uid,
      limit: 2000,
      timestamp: Date.now(),
    });
    return (data?.playlist || []).map(safePlaylist);
  }
  if (action === 'playlistTracks') {
    if (!isAccountLoggedIn()) throw new Error('HOST_NOT_LOGGED_IN');
    const playlistId = String(payload.playlistId || '');
    if (!/^\d{1,20}$/.test(playlistId)) throw new Error('PLAYLIST_NOT_FOUND');
    const uid = store?.state?.data?.user?.userId;
    if (!uid) throw new Error('HOST_NOT_LOGGED_IN');
    const playlists = await userPlaylist({
      uid,
      limit: 2000,
      timestamp: Date.now(),
    });
    const allowed = (playlists?.playlist || []).some(
      playlist => String(playlist.id) === playlistId
    );
    if (!allowed) throw new Error('PLAYLIST_NOT_FOUND');
    const detail = await getPlaylistDetail(playlistId, true);
    const trackIds = (detail?.playlist?.trackIds || [])
      .map(track => String(track.id || track))
      .filter(trackId => /^\d{1,20}$/.test(trackId));
    const initialTracks = detail?.playlist?.tracks || [];
    let tracks = initialTracks;
    if (trackIds.length) {
      const data = await getTrackDetail(trackIds.slice(0, 100).join(','));
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
      .slice(0, 100);
    return orderedTracks.map(safeCatalogTrack);
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
    if (process.env.IS_ELECTRON !== true || !window.require) return [];
    const localElectron = window.require('electron');
    const result = await localElectron.ipcRenderer.invoke('karaoke:local:scan');
    return result?.playlists || [];
  }
  throw new Error('KTV_NOT_ACTIVE');
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
    const manager = store.$karaokeManager;
    try {
      if (!manager) throw new Error('KTV_NOT_ACTIVE');
      let result;
      switch (command.action) {
        case 'snapshot':
          result = manager.getSnapshot();
          break;
        case 'enqueue':
          assertExpectedKaraokeSession(manager, command.payload.expected);
          result = manager.enqueueTrack(
            command.payload.track,
            command.payload.requester
          );
          if (
            result &&
            !manager.queue.currentItem &&
            !manager.transitionPromise
          )
            manager.startQueue();
          break;
        case 'remove':
          assertExpectedKaraokeSession(manager, command.payload.expected);
          result = manager.removeQueueItem(command.payload.queueItemId);
          break;
        case 'front':
          assertExpectedKaraokeSession(manager, command.payload.expected);
          result = manager.moveQueueItemToFront(command.payload.queueItemId);
          break;
        case 'next':
          assertExpectedKaraokeSession(manager, command.payload.expected);
          result = await manager.next();
          break;
        case 'catalog':
          result = await hostCatalog(
            command.payload.action,
            command.payload.payload,
            store
          );
          break;
        default:
          throw new Error('KTV_NOT_ACTIVE');
      }
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
