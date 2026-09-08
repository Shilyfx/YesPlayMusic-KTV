import store from '@/store';

const player = store.state.player;

export function ipcRenderer(vueInstance) {
  const self = vueInstance;
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
          result = manager.enqueueTrack(
            command.payload.track,
            command.payload.requester
          );
          break;
        case 'remove':
          result = manager.removeQueueItem(command.payload.queueItemId);
          break;
        case 'front':
          result = manager.moveQueueItemToFront(command.payload.queueItemId);
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
    const manager = store.$karaokeManager;
    if (manager?.ownsPlayback) manager.playOrPause();
    else player.playOrPause();
  });

  ipcRenderer.on('next', () => {
    const manager = store.$karaokeManager;
    if (manager?.ownsPlayback) {
      manager.next();
    } else if (player.isPersonalFM) {
      player.playNextFMTrack();
    } else {
      player.playNextTrack();
    }
  });

  ipcRenderer.on('previous', () => {
    if (!store.$karaokeManager?.ownsPlayback) player.playPrevTrack();
  });

  ipcRenderer.on('increaseVolume', () => {
    if (player.volume + 0.1 >= 1) {
      return (player.volume = 1);
    }
    player.volume += 0.1;
  });

  ipcRenderer.on('decreaseVolume', () => {
    if (player.volume - 0.1 <= 0) {
      return (player.volume = 0);
    }
    player.volume -= 0.1;
  });

  ipcRenderer.on('like', () => {
    store.dispatch('likeATrack', player.currentTrack.id);
  });

  ipcRenderer.on('repeat', () => {
    player.switchRepeatMode();
  });

  ipcRenderer.on('shuffle', () => {
    player.switchShuffle();
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
    player._howler.seek(position);
  });
}
