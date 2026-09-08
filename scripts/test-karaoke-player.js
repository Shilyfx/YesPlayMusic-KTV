const assert = require('assert');
const Module = require('module');
const path = require('path');
const babel = require('@babel/core');

const root = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function resolveAlias(
  request,
  parent,
  isMain,
  options
) {
  if (request.startsWith('@/'))
    return originalResolve(
      path.join(root, 'src', request.slice(2)),
      parent,
      isMain,
      options
    );
  return originalResolve(request, parent, isMain, options);
};

function stub(relativePath, exports) {
  const filename = require.resolve(path.join(root, 'src', relativePath));
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

const store = {
  state: { settings: {}, liked: { songs: [] } },
  commit() {},
  dispatch() {},
};
stub('api/album.js', { getAlbum: async () => ({}) });
stub('api/artist.js', { getArtist: async () => ({}) });
stub('api/lastfm.js', { trackScrobble() {}, trackUpdateNowPlaying() {} });
stub('api/others.js', {
  fmTrash: async () => ({}),
  personalFM: async () => ({}),
});
stub('api/playlist.js', {
  getPlaylistDetail: async () => ({}),
  intelligencePlaylist: async () => ({}),
});
stub('api/track.js', { getLyric: async () => ({}), getMP3: async () => ({}) });
stub('store/index.js', store);
stub('utils/auth.js', { isAccountLoggedIn: () => false });
stub('utils/db.js', {
  cacheTrackSource() {},
  getTrackSource: async () => null,
});
stub('utils/platform.js', { isCreateMpris: false, isCreateTray: false });
stub('utils/base64.js', { decode: () => Buffer.alloc(0) });
stub('store/initLocalStorage.js', { settings: { shortcuts: [] } });

const originalJsLoader = require.extensions['.js'];
require.extensions['.js'] = function transpilePlayer(module, filename) {
  if (
    ![
      path.join(root, 'src', 'utils', 'Player.js'),
      path.join(root, 'src', 'utils', 'updateApp.js'),
    ].includes(filename)
  )
    return originalJsLoader(module, filename);
  const result = babel.transformFileSync(filename, {
    presets: ['@vue/cli-plugin-babel/preset'],
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  });
  module._compile(result.code, filename);
};

const Player = require('../src/utils/Player').default;
const { TRANSIENT_PLAYER_KEYS } = require('../src/utils/Player');
const { updatePlayer } = require('../src/utils/updateApp');

async function run() {
  assert.ok(TRANSIENT_PLAYER_KEYS.includes('_playbackOwner'));
  assert.ok(TRANSIENT_PLAYER_KEYS.includes('_karaokePlaybackPending'));
  let resolveSource;
  const player = Object.create(Player.prototype);
  player._karaokePlaybackGeneration = 0;
  player._karaokePlaybackPending = false;
  player._playbackOwner = null;
  player._howler = { stop() {} };
  player._setPlaying = () => {};
  player._getKaraokeTrackDetail = async () => ({
    songs: [{ id: 9, name: 'pending', ar: [], al: {} }],
  });
  player._getAudioSource = () =>
    new Promise(resolve => {
      resolveSource = resolve;
    });
  player._updateMediaSessionMetaData = () => {
    throw new Error('stale playback committed metadata');
  };
  player._playAudioSource = () => {
    throw new Error('stale playback committed audio');
  };

  const pending = player.playTrackByID(9, { owner: 'karaoke' });
  await Promise.resolve();
  assert.equal(player.stopKaraokePlayback(), true);
  resolveSource('https://audio.example/pending.mp3');
  assert.deepEqual(await pending, { success: false, cancelled: true });
  assert.equal(player._playbackOwner, null);
  assert.equal(player._karaokePlaybackPending, false);

  const values = new Map();
  global.localStorage = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
  localStorage.setItem(
    'player',
    JSON.stringify({
      _volume: 0.6,
      _playbackOwner: 'karaoke',
      _playbackEndedListeners: [null],
      _playbackErrorListeners: [null],
      _karaokeCommandHandlers: {},
      _karaokePlaybackGeneration: 4,
      _karaokePlaybackPending: true,
    })
  );
  updatePlayer();
  const migrated = JSON.parse(localStorage.getItem('player'));
  assert.equal(migrated._volume, 0.6);
  TRANSIENT_PLAYER_KEYS.filter(key => key !== '_playing').forEach(key => {
    assert.equal(migrated[key], undefined);
  });

  const mediaHandlers = {};
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    value: {
      mediaSession: {
        setActionHandler: (action, handler) =>
          (mediaHandlers[action] = handler),
      },
    },
  });
  const commandPlayer = Object.create(Player.prototype);
  let normalCalls = 0;
  let karaokeCalls = 0;
  commandPlayer._karaokeCommandHandlers = {
    isSessionActive: () => true,
    toggle: () => (karaokeCalls += 1),
    next: () => (karaokeCalls += 1),
  };
  commandPlayer.play = () => (normalCalls += 1);
  commandPlayer.pause = () => (normalCalls += 1);
  commandPlayer.playPrevTrack = () => (normalCalls += 1);
  commandPlayer._playNextTrack = () => (normalCalls += 1);
  commandPlayer._initMediaSession();
  mediaHandlers.play();
  mediaHandlers.pause();
  mediaHandlers.nexttrack();
  mediaHandlers.previoustrack();
  mediaHandlers.stop();
  assert.equal(karaokeCalls, 4);
  assert.equal(normalCalls, 0);
  console.log('KTV Player persistence and cancellation tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
