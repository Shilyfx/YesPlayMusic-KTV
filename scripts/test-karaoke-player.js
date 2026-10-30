const assert = require('assert');
const path = require('path');
const { root } = require('./helpers/register-babel-src');

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

const Player = require('../src/utils/Player').default;
const { TRANSIENT_PLAYER_KEYS } = require('../src/utils/Player');
const { updatePlayer } = require('../src/utils/updateApp');
const howler = require('howler');
const {
  createPlayerMusicAnalyzer,
} = require('../src/karaoke/musicReactionAnalyzer');

async function run() {
  global.document = { title: '' };
  const muted = Object.create(Player.prototype);
  let fadeListener;
  let pauses = 0;
  muted._volume = 0;
  muted._playing = true;
  muted._saveCurrentTrackTime = () => {};
  muted._setPlaying = value => {
    muted._playing = value;
  };
  muted._pauseDiscordPresence = () => {};
  muted._howler = {
    once(event, listener) {
      if (event === 'fade') fadeListener = listener;
    },
    fade() {
      if (fadeListener) fadeListener();
    },
    pause() {
      pauses++;
    },
  };
  muted.pause();
  assert.equal(
    pauses,
    1,
    'muted pause must handle a synchronous no-op fade completion'
  );
  assert.equal(muted.playing, false);
  assert.ok(TRANSIENT_PLAYER_KEYS.includes('_playbackOwner'));
  assert.ok(TRANSIENT_PLAYER_KEYS.includes('_karaokePlaybackPending'));

  const playOrder = [];
  const playListenerPlayer = Object.create(Player.prototype);
  playListenerPlayer._volume = 0.6;
  playListenerPlayer._currentTrack = {
    name: 'listener order',
    ar: [{ name: 'test artist' }],
    al: {},
  };
  playListenerPlayer._setPlaying = value => playOrder.push(`playing:${value}`);
  playListenerPlayer._playDiscordPresence = () => {};
  playListenerPlayer.seek = () => 0;
  playListenerPlayer._howler = {
    playing: () => false,
    once(event, listener) {
      assert.equal(event, 'play');
      playOrder.push('listener');
      this.playListener = listener;
    },
    play() {
      assert.equal(typeof this.playListener, 'function');
      playOrder.push('play');
      this.playListener();
    },
    fade() {},
  };
  playListenerPlayer.play();
  assert.deepEqual(playOrder.slice(0, 2), ['listener', 'play']);
  assert.ok(playOrder.includes('playing:true'));

  let resolveSource;
  const player = Object.create(Player.prototype);
  player._karaokePlaybackGeneration = 0;
  player._karaokePlaybackPending = false;
  player._playbackOwner = null;
  let stopCalls = 0;
  let unloadCalls = 0;
  const originalUnload = howler.Howler.unload;
  howler.Howler.unload = () => {
    unloadCalls++;
  };
  player._howler = { stop: () => stopCalls++ };
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
  assert.equal(
    stopCalls,
    2,
    'KTV start and cancellation stop the current Howl'
  );
  assert.equal(unloadCalls, 0, 'KTV cancellation does not unload every Howl');
  resolveSource('https://audio.example/pending.mp3');
  assert.deepEqual(await pending, { success: false, cancelled: true });
  assert.equal(player._playbackOwner, null);
  assert.equal(player._karaokePlaybackPending, false);
  howler.Howler.unload = originalUnload;

  const previousWindow = global.window;
  const previousHowl = howler.Howl;
  const previousMute = howler.Howler.mute;
  const previousPool = howler.Howler._html5AudioPool;
  const localNode = {
    src: 'http://router.test/ktv/local/audio/track-7',
    paused: false,
  };
  const reusableNode = { src: 'https://audio.example/untouched.mp3' };
  let sourceCreations = 0;
  let audioFeatures = null;
  global.window = {
    location: { origin: 'http://router.test' },
    AudioContext: class {
      constructor() {
        this.state = 'running';
        this.destination = {};
      }
      createMediaElementSource() {
        sourceCreations++;
        return { connect() {} };
      }
      createAnalyser() {
        return {
          fftSize: 256,
          connect() {},
          getFloatTimeDomainData(buffer) {
            buffer[0] = 0.75;
          },
          getByteFrequencyData(buffer) {
            buffer[2] = 200;
          },
        };
      }
    },
  };
  howler.Howl = class {
    on() {
      return this;
    }
    once() {
      return this;
    }
    playing() {
      return false;
    }
    play() {}
    fade() {}
  };
  let unmuteCalls = 0;
  howler.Howler.mute = () => {
    unmuteCalls++;
  };
  howler.Howler.unload = () => {};
  howler.Howler._html5AudioPool = [localNode, reusableNode];

  try {
    const analyzer = createPlayerMusicAnalyzer({
      getPlayer: () => ({
        playing: true,
        volume: 1,
        currentTrack: { id: 7 },
        _howler: { _sounds: [{ _node: localNode }] },
      }),
      getCurrentItem: () => ({ trackId: 7 }),
      onAudioFeatures: features => {
        audioFeatures = features;
      },
      schedule: () => 1,
      cancel: () => {},
    });
    analyzer.tick();
    assert.equal(
      sourceCreations,
      1,
      'local playback node was actually analyzed'
    );
    assert.equal(audioFeatures.available, true);

    const onlinePlayer = Object.create(Player.prototype);
    onlinePlayer._playbackOwner = 'karaoke';
    onlinePlayer._currentTrack = { id: 8, name: 'online' };
    onlinePlayer.setOutputDevice = () => {};
    onlinePlayer._playAudioSource('https://audio.example/online.mp3', false);

    assert.deepEqual(
      howler.Howler._html5AudioPool,
      [reusableNode],
      'analyzed local media elements are excluded before an online source reuses the pool'
    );
    assert.equal(
      unmuteCalls,
      0,
      'starting a source does not force global unmute'
    );
    analyzer.dispose();
  } finally {
    howler.Howl = previousHowl;
    howler.Howler.unload = originalUnload;
    howler.Howler.mute = previousMute;
    howler.Howler._html5AudioPool = previousPool;
    global.window = previousWindow;
  }

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
