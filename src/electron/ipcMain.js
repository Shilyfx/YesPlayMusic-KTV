import { app, dialog, globalShortcut, ipcMain, shell } from 'electron';
import path from 'path';
import { registerGlobalShortcut } from '@/electron/globalShortcut';
import cloneDeep from 'lodash/cloneDeep';
import shortcuts from '@/utils/shortcuts';
import { createMenu } from './menu';
import { isCreateTray, isMac } from '@/utils/platform';
import KaraokeLanLifecycle from './karaoke/KaraokeLanLifecycle';
import {
  KaraokeCatalogService,
  KaraokeRemoteService,
  RemoteApiRouter,
} from './karaoke/KaraokeRemoteApi';
import KaraokeLocalLibrary from './karaoke/KaraokeLocalLibrary';

const clc = require('cli-color');
const log = text => {
  console.log(`${clc.blueBright('[ipcMain.js]')} ${text}`);
};

const exitAsk = (e, win) => {
  e.preventDefault(); //阻止默认行为
  dialog
    .showMessageBox({
      type: 'info',
      title: 'Information',
      cancelId: 2,
      defaultId: 0,
      message: '确定要关闭吗？',
      buttons: ['最小化', '直接退出'],
    })
    .then(result => {
      if (result.response == 0) {
        e.preventDefault(); //阻止默认行为
        win.minimize(); //调用 最小化实例方法
      } else if (result.response == 1) {
        win = null;
        //app.quit();
        app.exit(); //exit()直接关闭客户端，不会执行quit();
      }
    })
    .catch(err => {
      log(err);
    });
};

const exitAskWithoutMac = (e, win) => {
  e.preventDefault(); //阻止默认行为
  dialog
    .showMessageBox({
      type: 'info',
      title: 'Information',
      cancelId: 2,
      defaultId: 0,
      message: '确定要关闭吗？',
      buttons: ['最小化到托盘', '直接退出'],
      checkboxLabel: '记住我的选择',
    })
    .then(result => {
      if (result.checkboxChecked && result.response !== 2) {
        win.webContents.send(
          'rememberCloseAppOption',
          result.response === 0 ? 'minimizeToTray' : 'exit'
        );
      }

      if (result.response === 0) {
        e.preventDefault(); //阻止默认行为
        win.hide(); //调用 最小化实例方法
      } else if (result.response === 1) {
        win = null;
        //app.quit();
        app.exit(); //exit()直接关闭客户端，不会执行quit();
      }
    })
    .catch(err => {
      log(err);
    });
};

const client = require('discord-rich-presence')('818936529484906596');

/**
 * Make data a Buffer.
 *
 * @param {?} data The data to convert.
 * @returns {import("buffer").Buffer} The converted data.
 */
function toBuffer(data) {
  if (data instanceof Buffer) {
    return data;
  } else {
    return Buffer.from(data);
  }
}

/**
 * Get the file base64 data from bilivideo.
 *
 * @param {string} url The URL to fetch.
 * @returns {Promise<string>} The file base64 data.
 */
async function getBiliVideoFile(url) {
  const axios = await import('axios').then(m => m.default);
  const response = await axios.get(url, {
    headers: {
      Referer: 'https://www.bilibili.com/',
      'User-Agent': 'okhttp/3.4.1',
    },
    responseType: 'arraybuffer',
  });

  const buffer = toBuffer(response.data);
  const encodedData = buffer.toString('base64');

  return encodedData;
}

/**
 * Parse the source string (`a, b`) to source list `['a', 'b']`.
 *
 * @param {import("@unblockneteasemusic/rust-napi").Executor} executor
 * @param {string} sourceString The source string.
 * @returns {string[]} The source list.
 */
function parseSourceStringToList(executor, sourceString) {
  const availableSource = executor.list();

  return sourceString
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(s => {
      const isAvailable = availableSource.includes(s);

      if (!isAvailable) {
        log(`This source is not one of the supported source: ${s}`);
      }

      return isAvailable;
    });
}

let unmExecutorPromise;
async function getUnmExecutor() {
  if (!unmExecutorPromise) {
    unmExecutorPromise = import('@unblockneteasemusic/rust-napi')
      .then(module => new module.default.Executor())
      .catch(error => {
        unmExecutorPromise = null;
        throw new Error(`UnblockMusic 不可用：${error.message}`);
      });
  }
  return unmExecutorPromise;
}

export function initIpcMain(
  win,
  store,
  trayEventEmitter,
  karaokeServer,
  runtime = null
) {
  // WIP: Do not enable logging as it has some issues in non-blocking I/O environment.
  // UNM.enableLogging(UNM.LoggingType.ConsoleEnv);
  const karaokeLanLifecycle = new KaraokeLanLifecycle(karaokeServer);
  const karaokeLocalLibrary = new KaraokeLocalLibrary(
    store.get('settings.localKaraokeDirectories', []),
    {
      indexPath: path.join(app.getPath('userData'), 'karaoke-local-index.json'),
    }
  );
  karaokeServer.setLocalLibrary(karaokeLocalLibrary);
  const decorateLocalPlaylists = playlists =>
    playlists.map(playlist => ({
      ...playlist,
      tracks: (playlist.tracks || []).map(track => ({
        ...track,
        coverUrl:
          karaokeServer.getLocalCoverUrl(track.localId || track.trackId) || '',
      })),
    }));
  ipcMain.on('renderer:ready', (_, payload = {}) => {
    if (!runtime) return;
    runtime.renderer = 'ready';
    runtime.rendererReadyAt = new Date().toISOString();
    runtime.stage = 'RENDERER_READY';
    log(`[RENDERER_READY] route=${payload.route || 'unknown'}`);
  });
  ipcMain.handle('app:open-logs', async () => {
    const logPath = app.getPath('logs');
    await shell.openPath(logPath);
    return { ok: true, path: logPath };
  });
  ipcMain.handle('window:state', async () => ({
    maximized: Boolean(win && win.isMaximized()),
  }));
  ipcMain.handle('window:exit-fullscreen', async () => {
    if (win && win.isFullScreen()) win.setFullScreen(false);
    return { ok: true };
  });
  let remoteCommandSequence = 0;
  const pendingRemoteCommands = new Map();
  const remoteCommand = (action, payload = {}) =>
    new Promise((resolve, reject) => {
      const id = `remote-${Date.now()}-${(remoteCommandSequence += 1)}`;
      const timeout = setTimeout(() => {
        pendingRemoteCommands.delete(id);
        reject(new Error('KTV_NOT_ACTIVE'));
      }, 10000);
      pendingRemoteCommands.set(id, { resolve, reject, timeout });
      win.webContents.send('karaoke:remote:command', { id, action, payload });
    });
  const remoteService = new KaraokeRemoteService({
    // Catalog calls cross the existing controlled Main → Renderer bridge so they
    // inherit the desktop app's authenticated request/proxy context. The LAN API
    // only ever receives sanitized track metadata and a playability enum.
    catalog: new KaraokeCatalogService({
      hostCatalogBridge: (action, payload) =>
        remoteCommand('catalog', { action, payload }),
    }),
    getRoom: () => karaokeServer.room,
    managerBridge: {
      snapshot: () => remoteCommand('snapshot'),
      enqueue: (track, requester, expected) =>
        remoteCommand('enqueue', { track, requester, expected }),
      remove: (queueItemId, expected) =>
        remoteCommand('remove', { queueItemId, expected }),
      front: (queueItemId, expected) =>
        remoteCommand('front', { queueItemId, expected }),
      next: expected => remoteCommand('next', { expected }),
    },
  });
  karaokeServer.setRemoteApi(new RemoteApiRouter(remoteService), remoteService);
  const stopStaleRoom = () => karaokeLanLifecycle.stopRoom().catch(() => {});
  win.webContents.on('render-process-gone', stopStaleRoom);
  win.webContents.on('did-start-loading', stopStaleRoom);

  ipcMain.on('karaoke:remote:result', (_, payload) => {
    const pending = pendingRemoteCommands.get(payload && payload.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    pendingRemoteCommands.delete(payload.id);
    if (payload.ok) pending.resolve(payload.result);
    else pending.reject(new Error(payload.error || 'KTV_NOT_ACTIVE'));
  });

  ipcMain.handle('karaoke:lan:set-session-active', async (_, active) => {
    const status = await karaokeLanLifecycle.setSessionActive(active);
    return { ok: true, ...status };
  });

  ipcMain.handle('karaoke:lan:candidates', async () => ({
    ok: true,
    candidates: karaokeServer.getLanAddressCandidates(),
  }));

  ipcMain.handle('karaoke:lan:start', async (_, options) => {
    try {
      const snapshot = await remoteCommand('snapshot');
      return {
        ok: true,
        room: await karaokeLanLifecycle.startRoom(options, snapshot.session),
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('karaoke:lan:stop', async () => {
    await karaokeLanLifecycle.stopRoom();
    return { ok: true };
  });

  ipcMain.handle('karaoke:lan:status', async () => ({
    ok: true,
    ...(await karaokeLanLifecycle.status()),
  }));

  ipcMain.handle('karaoke:lan:refresh-qr', async () => {
    const room = await karaokeServer.describeRoom();
    return { ok: Boolean(room), room };
  });

  ipcMain.handle('karaoke:lan:self-test', async (_, address) => {
    return karaokeServer.selfTestAddress(address);
  });

  ipcMain.handle('karaoke:local:directories', async () => ({
    ok: true,
    directories: karaokeLocalLibrary.listDirectories(),
  }));

  ipcMain.handle('karaoke:local:choose-directories', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: '选择本地 KTV 音乐目录',
      properties: ['openDirectory', 'multiSelections'],
    });
    if (result.canceled) {
      return {
        ok: false,
        canceled: true,
        directories: karaokeLocalLibrary.listDirectories(),
      };
    }
    const directories = karaokeLocalLibrary.addDirectories(result.filePaths);
    store.set('settings.localKaraokeDirectories', directories);
    return { ok: true, directories };
  });

  ipcMain.handle('karaoke:local:remove-directory', async (_, directory) => {
    const directories = karaokeLocalLibrary.removeDirectory(directory);
    store.set('settings.localKaraokeDirectories', directories);
    return { ok: true, directories };
  });

  ipcMain.handle('karaoke:local:list', async () => ({
    ok: true,
    directories: karaokeLocalLibrary.listDirectories(),
    playlists: decorateLocalPlaylists(
      await karaokeLocalLibrary.ensureIndexed()
    ),
  }));

  ipcMain.handle('karaoke:local:scan', async () => {
    const playlists = await karaokeLocalLibrary.scan();
    return {
      ok: true,
      directories: karaokeLocalLibrary.listDirectories(),
      playlists: decorateLocalPlaylists(playlists),
    };
  });

  ipcMain.handle('karaoke:local:resolve', async (_, localId) => {
    const resolved = await karaokeLocalLibrary.resolve(localId);
    if (!resolved) return { ok: false, error: 'LOCAL_TRACK_NOT_FOUND' };
    return {
      ok: true,
      ...resolved,
      audioUrl: karaokeServer.getLocalAudioUrl(localId),
      coverUrl: resolved.coverPath
        ? karaokeServer.getLocalCoverUrl(localId)
        : null,
    };
  });

  ipcMain.handle(
    'unblock-music',
    /**
     *
     * @param {*} _
     * @param {string | null} sourceListString
     * @param {Record<string, any>} ncmTrack
     * @param {UNM.Context} context
     */
    async (_, sourceListString, ncmTrack, context) => {
      // Formt the track input
      // FIXME: Figure out the structure of Track
      const song = {
        id: ncmTrack.id && ncmTrack.id.toString(),
        name: ncmTrack.name,
        duration: ncmTrack.dt,
        album: ncmTrack.al && {
          id: ncmTrack.al.id && ncmTrack.al.id.toString(),
          name: ncmTrack.al.name,
        },
        artists: ncmTrack.ar
          ? ncmTrack.ar.map(({ id, name }) => ({
              id: id && id.toString(),
              name,
            }))
          : [],
      };

      const sourceList =
        typeof sourceListString === 'string'
          ? parseSourceStringToList(await getUnmExecutor(), sourceListString)
          : ['ytdl', 'bilibili', 'pyncm', 'kugou'];
      const unmExecutor = await getUnmExecutor();
      log(`[UNM] using source: ${sourceList.join(', ')}`);
      log(`[UNM] using configuration: ${JSON.stringify(context)}`);

      try {
        // TODO: tell users to install yt-dlp.
        const matchedAudio = await unmExecutor.search(
          sourceList,
          song,
          context
        );
        const retrievedSong = await unmExecutor.retrieve(matchedAudio, context);

        // bilibili's audio file needs some special treatment
        if (retrievedSong.url.includes('bilivideo.com')) {
          retrievedSong.url = await getBiliVideoFile(retrievedSong.url);
        }

        log(`respond with retrieve song…`);
        log(JSON.stringify(matchedAudio));
        return retrievedSong;
      } catch (err) {
        const errorMessage = err instanceof Error ? `${err.message}` : `${err}`;
        log(`UnblockNeteaseMusic failed: ${errorMessage}`);
        return null;
      }
    }
  );

  ipcMain.on('close', e => {
    if (isMac) {
      win.hide();
      exitAsk(e, win);
    } else {
      let closeOpt = store.get('settings.closeAppOption');
      if (closeOpt === 'exit') {
        win = null;
        //app.quit();
        app.exit(); //exit()直接关闭客户端，不会执行quit();
      } else if (closeOpt === 'minimizeToTray') {
        e.preventDefault();
        win.hide();
      } else {
        exitAskWithoutMac(e, win);
      }
    }
  });

  ipcMain.on('minimize', () => {
    win.minimize();
  });

  ipcMain.on('maximizeOrUnmaximize', () => {
    win.isMaximized() ? win.unmaximize() : win.maximize();
  });

  ipcMain.on('settings', (event, options) => {
    store.set('settings', options);
    if (options.enableGlobalShortcut) {
      registerGlobalShortcut(win, store);
    } else {
      log('unregister global shortcut');
      globalShortcut.unregisterAll();
    }
  });

  ipcMain.on('playDiscordPresence', (event, track) => {
    client.updatePresence({
      details: track.name + ' - ' + track.ar.map(ar => ar.name).join(','),
      state: track.al.name,
      endTimestamp: Date.now() + track.dt,
      largeImageKey: track.al.picUrl,
      largeImageText: 'Listening ' + track.name,
      smallImageKey: 'play',
      smallImageText: 'Playing',
      instance: true,
    });
  });

  ipcMain.on('pauseDiscordPresence', (event, track) => {
    client.updatePresence({
      details: track.name + ' - ' + track.ar.map(ar => ar.name).join(','),
      state: track.al.name,
      largeImageKey: track.al.picUrl,
      largeImageText: 'LumaSing',
      smallImageKey: 'pause',
      smallImageText: 'Pause',
      instance: true,
    });
  });

  ipcMain.on('setProxy', (event, config) => {
    const proxyRules = `${config.protocol}://${config.server}:${config.port}`;
    store.set('proxy', proxyRules);
    win.webContents.session.setProxy(
      {
        proxyRules,
      },
      () => {
        log('finished setProxy');
      }
    );
  });

  ipcMain.on('removeProxy', () => {
    log('removeProxy');
    win.webContents.session.setProxy({});
    store.set('proxy', '');
  });

  ipcMain.on('switchGlobalShortcutStatusTemporary', (e, status) => {
    log('switchGlobalShortcutStatusTemporary');
    if (status === 'disable') {
      globalShortcut.unregisterAll();
    } else {
      registerGlobalShortcut(win, store);
    }
  });

  ipcMain.on('updateShortcut', (e, { id, type, shortcut }) => {
    log('updateShortcut');
    let shortcuts = store.get('settings.shortcuts');
    let newShortcut = shortcuts.find(s => s.id === id);
    newShortcut[type] = shortcut;
    store.set('settings.shortcuts', shortcuts);

    createMenu(win, store);
    globalShortcut.unregisterAll();
    registerGlobalShortcut(win, store);
  });

  ipcMain.on('restoreDefaultShortcuts', () => {
    log('restoreDefaultShortcuts');
    store.set('settings.shortcuts', cloneDeep(shortcuts));

    createMenu(win, store);
    globalShortcut.unregisterAll();
    registerGlobalShortcut(win, store);
  });

  if (isCreateTray) {
    ipcMain.on('updateTrayTooltip', (_, title) => {
      trayEventEmitter.emit('updateTooltip', title);
    });
    ipcMain.on('updateTrayPlayState', (_, isPlaying) => {
      trayEventEmitter.emit('updatePlayState', isPlaying);
    });
    ipcMain.on('updateTrayLikeState', (_, isLiked) => {
      trayEventEmitter.emit('updateLikeState', isLiked);
    });
    ipcMain.on('updateTrayIcon', () => {
      trayEventEmitter.emit('updateIcon');
    });
  }
}
