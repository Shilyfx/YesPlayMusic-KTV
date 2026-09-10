import { search } from '@/api/others';
import { getMP3, getTrackDetail } from '@/api/track';

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

async function hostCatalog(action, payload = {}) {
  if (action === 'search') {
    const data = await search({
      keywords: String(payload.query || ''),
      limit: 15,
      type: 1,
    });
    const songs = data.result?.songs || data.result?.song?.songs || [];
    return songs.slice(0, 15).map(safeCatalogTrack);
  }
  if (action === 'trackDetail') {
    const data = await getTrackDetail(String(payload.trackId));
    const track = data?.songs?.[0];
    if (!track) throw new Error('TRACK_NOT_FOUND');
    return safeCatalogTrack(track);
  }
  if (action === 'availability') {
    const data = await getMP3(String(payload.trackId));
    const source = data?.data?.[0];
    if (!source?.url) return 'unavailable';
    return source.freeTrialInfo ? 'trial-only' : 'playable';
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
          break;
        case 'remove':
          assertExpectedKaraokeSession(manager, command.payload.expected);
          result = manager.removeQueueItem(command.payload.queueItemId);
          break;
        case 'front':
          assertExpectedKaraokeSession(manager, command.payload.expected);
          result = manager.moveQueueItemToFront(command.payload.queueItemId);
          break;
        case 'catalog':
          result = await hostCatalog(
            command.payload.action,
            command.payload.payload
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
