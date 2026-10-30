const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const esbuild = require('esbuild');
require('./helpers/register-babel-src');

const {
  normalizeSmartBeatPreferences,
  getSmartBeatSourceRequirements,
  readSmartBeatPreferences,
  writeSmartBeatPreferences,
} = require('../src/karaoke/smartBeatPreferences');
const {
  sanitizeSmartBeatTimeline,
} = require('../src/karaoke/smartBeatTimeline');
const {
  createPlayerMusicAnalyzer,
} = require('../src/karaoke/musicReactionAnalyzer');
const createWebRoomBridge = require('../src/karaoke/webRoomBridge').default;
const createDisplayPoller = require('../src/karaoke/displayPoller').default;
const KaraokeWebHost = require('../src/server/KaraokeWebHost').default;
const { sanitizePresentation } = require('../src/karaoke/lyricDisplay');

function loadSmartBeatRender() {
  const filename = path.resolve('src/karaoke/folia/smartBeatRender.ts');
  const compiled = esbuild.buildSync({
    entryPoints: [filename],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    target: 'node16',
    define: { 'import.meta.env.DEV': 'false' },
  }).outputFiles[0].text;
  const loaded = new Module(filename, module);
  loaded.paths = module.paths;
  loaded._compile(compiled, filename);
  return loaded.exports;
}

function loadTemperaRuntimeConsumer() {
  const compiled = esbuild.buildSync({
    stdin: {
      contents: `
        import { createSmartBeatRenderBridge } from './src/karaoke/folia/smartBeatRender';
        import { TemperaPixiRuntime } from './vendor/folia-pv/src/components/visualizer/tempera/createTemperaPixiRuntime';
        import { flashEnvelope } from './vendor/folia-pv/src/components/visualizer/tempera/temperaInkFlash';
        export { createSmartBeatRenderBridge, TemperaPixiRuntime, flashEnvelope };
      `,
      resolveDir: process.cwd(),
      sourcefile: path.resolve('scripts/smartbeat-tempera-consumer-harness.ts'),
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    target: 'node16',
    packages: 'external',
    define: { 'import.meta.env.DEV': 'false' },
  }).outputFiles[0].text;
  const filename = path.resolve(
    'scripts/smartbeat-tempera-consumer-harness.js'
  );
  const loaded = new Module(filename, module);
  loaded.paths = module.paths;
  loaded._compile(compiled, filename);
  return loaded.exports;
}

const hashes = {
  beat_this: 'b'.repeat(64),
  htdemucs: 'd'.repeat(64),
};
const timeline = {
  trackKey: 'queue-7:track-42',
  audioHash: 'a'.repeat(64),
  modelVersions: hashes,
  duration: 4,
  beats: {
    source: 'beat_this',
    times: [0.5, 1.5, 2.5],
    downbeats: [0.5],
  },
  drums: {
    source: 'htdemucs',
    times: [0.75, 1.25],
    strengths: [0.8, 0.6],
    kinds: [0, 1],
  },
};

function makeBus() {
  return {
    calls: [],
    beginBeatFxTrack(...args) {
      this.calls.push(['begin', ...args]);
    },
    setBeatFxEvents(...args) {
      this.calls.push(['events', ...args]);
    },
    setBeatFxLiveEffects(...args) {
      this.calls.push(['effects', ...args]);
    },
    setBeatFxIntensities(...args) {
      this.calls.push(['intensities', ...args]);
    },
    tickBeatFx(...args) {
      this.calls.push(['tick', ...args]);
    },
    stopBeatFx(...args) {
      this.calls.push(['stop', ...args]);
    },
  };
}

function testPreferenceBoundsAndSources() {
  const defaults = normalizeSmartBeatPreferences();
  assert.equal(defaults.mode, 'off');
  assert.ok(
    Object.values(defaults.effects).every(effect => effect.enabled),
    'turning SmartBeat on should activate each applicable original effect by default'
  );
  assert.equal(
    normalizeSmartBeatPreferences({
      mode: 'on',
      effects: { 'sonnet.lensTear': { enabled: false } },
    }).effects['sonnet.lensTear'].enabled,
    false,
    'an explicit per-effect opt-out must persist'
  );
  const preferences = normalizeSmartBeatPreferences({
    mode: 'cached',
    beatStrength: 9,
    downbeatStrength: -3,
    effects: {
      'sonnet.lensTear': { enabled: true, strength: 1.4 },
      'pendolo.gearBeats': { enabled: true, strength: 2 },
      'latent.pulse': { enabled: true, strength: 2 },
    },
  });
  assert.equal(preferences.mode, 'cached');
  assert.equal(preferences.beatStrength, 2);
  assert.equal(preferences.downbeatStrength, 0);
  assert.equal(preferences.effects['sonnet.lensTear'].strength, 1.4);
  assert.equal(preferences.effects['pendolo.gearBeats'], undefined);
  assert.equal(preferences.effects['latent.pulse'], undefined);
  assert.deepEqual(getSmartBeatSourceRequirements(preferences, 'sonnet'), {
    beats: true,
    drums: false,
  });
  assert.deepEqual(getSmartBeatSourceRequirements(preferences, 'tempera'), {
    beats: false,
    drums: true,
  });

  const values = new Map();
  const storage = {
    getItem(key) {
      return values.get(key) || null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
  assert.equal(writeSmartBeatPreferences(preferences, storage), true);
  const persisted = [...values.keys()][0];
  assert.match(persisted, /smartbeat/i);
  assert.deepEqual(readSmartBeatPreferences(storage), preferences);
}

function testCanonicalTimelineBounds() {
  assert.deepEqual(sanitizeSmartBeatTimeline(timeline), timeline);
  assert.throws(
    () =>
      sanitizeSmartBeatTimeline({
        ...timeline,
        beats: { source: 'htdemucs', times: [0.5], downbeats: [] },
      }),
    /timeline|source/i
  );
  assert.throws(
    () =>
      sanitizeSmartBeatTimeline({
        ...timeline,
        beats: {
          source: 'beat_this',
          times: [1.5, 0.5],
          downbeats: [],
        },
      }),
    /timeline|sorted|time/i
  );
  assert.throws(
    () => sanitizeSmartBeatTimeline({ ...timeline, duration: 601 }),
    /timeline|duration/i
  );
}

function testPresentationAndHostTimelineContract() {
  const presentation = sanitizePresentation({
    itemId: 'queue-7',
    position: 1,
    playing: true,
    lines: [],
    smartBeat: {
      settings: {
        mode: 'on',
        effects: { 'sonnet.lensTear': { enabled: false, strength: 9 } },
      },
      status: 'unsupported',
      detail: 'WebGPU is unavailable in this browser\u0001\n',
      trackKey: timeline.trackKey,
      analysisRevision: 4,
    },
    audioFeatures: {
      available: false,
      power: 1,
      bass: 1,
      lowMid: 1,
      mid: 1,
      vocal: 1,
      treble: 1,
    },
  });
  assert.equal(presentation.smartBeat.status, 'unsupported');
  assert.equal(
    presentation.smartBeat.detail,
    'WebGPU is unavailable in this browser'
  );
  assert.equal(presentation.smartBeat.settings.mode, 'on');
  assert.equal(
    presentation.smartBeat.settings.effects['sonnet.lensTear'].enabled,
    false
  );
  assert.equal(
    presentation.smartBeat.settings.effects['sonnet.lensTear'].strength,
    2
  );
  assert.deepEqual(presentation.audioFeatures, {
    available: false,
    power: 0,
    bass: 0,
    lowMid: 0,
    mid: 0,
    vocal: 0,
    treble: 0,
  });

  const host = Object.create(KaraokeWebHost.prototype);
  const stored = host.prepareSmartBeatTimeline(
    { revision: 4, timeline },
    {
      ...presentation,
      smartBeat: { ...presentation.smartBeat, trackKey: timeline.trackKey },
    },
    { smartBeatRevision: 3 }
  );
  assert.equal(stored.smartBeatRevision, 4);
  assert.deepEqual(stored.smartBeatTimeline, timeline);
  assert.throws(
    () =>
      host.prepareSmartBeatTimeline({ revision: 5, timeline }, presentation, {
        smartBeatRevision: 4,
      }),
    /SMART_BEAT_REVISION/
  );
  assert.deepEqual(
    host.prepareSmartBeatTimeline(
      undefined,
      {
        ...presentation,
        smartBeat: {
          ...presentation.smartBeat,
          trackKey: 'queue-new:track-new',
        },
      },
      {
        presentation: presentation,
        smartBeatRevision: 4,
        smartBeatTimeline: timeline,
      }
    ),
    { smartBeatRevision: 4, smartBeatTimeline: null }
  );
}

function testDualBusProjectionUsesRawClock() {
  const { createSmartBeatRenderBridge } = loadSmartBeatRender();
  const preferences = normalizeSmartBeatPreferences({
    mode: 'on',
    beatStrength: 1.25,
    downbeatStrength: 1.75,
    effects: {
      'hanabi.beatBursts': { enabled: true, strength: 1.5 },
      'hanabi.beatPulse': { enabled: true, strength: 0.8 },
    },
  });
  const pv = makeBus();
  const complete = makeBus();
  const drumHits = [];
  const bridge = createSmartBeatRenderBridge({
    mode: 'hanabi',
    trackKey: timeline.trackKey,
    settings: preferences,
    timeline,
    buses: {
      pv,
      complete,
      publishPendoloDrumHits: (...args) => drumHits.push(args),
    },
  });
  const pvEvents = pv.calls.find(call => call[0] === 'events');
  const completeEvents = complete.calls.find(call => call[0] === 'events');
  assert.equal(pvEvents[1], timeline.trackKey);
  assert.equal(completeEvents[1], timeline.trackKey);
  assert.equal(pvEvents[3], 'beat_this');
  assert.equal(completeEvents[3], 'beat_this');
  assert.deepEqual(
    pvEvents[2].map(event => event.t),
    timeline.beats.times
  );
  assert.equal(pvEvents[2][0].kind, 'downbeat');
  assert.equal(
    pv.calls.find(call => call[0] === 'effects')[1]['hanabi.beatBursts'],
    1.5
  );
  assert.equal(
    complete.calls.find(call => call[0] === 'intensities')[1],
    preferences.beatStrength
  );

  bridge.frame({ rawPosition: 3.25, lyricPosition: 9.75, playing: true });
  const pvTick = pv.calls.find(call => call[0] === 'tick')[1];
  const completeTick = complete.calls.find(call => call[0] === 'tick')[1];
  assert.equal(pvTick.currentTime, 3.25);
  assert.equal(completeTick.currentTime, 3.25);
  assert.equal(pvTick.paused, false);
  assert.equal(
    drumHits.filter(call => call[1] !== null).length,
    0,
    'Hanabi must not publish drum hits as its beat-grid source'
  );

  bridge.update({ mode: 'tempera' });
  const temperaEffects = pv.calls
    .filter(call => call[0] === 'effects')
    .at(-1)[1];
  assert.equal(temperaEffects['hanabi.beatBursts'], 0);
  bridge.dispose();
}

function testStaleTimelineCannotDriveDifferentTrack() {
  const { createSmartBeatRenderBridge } = loadSmartBeatRender();
  const settings = normalizeSmartBeatPreferences({
    mode: 'on',
    effects: {
      'hanabi.beatBursts': { enabled: true, strength: 1 },
    },
  });
  const pv = makeBus();
  const complete = makeBus();
  const bridge = createSmartBeatRenderBridge({
    mode: 'hanabi',
    trackKey: 'queue-new:track-new',
    settings,
    timeline,
    buses: { pv, complete, publishPendoloDrumHits() {} },
  });
  const effects = pv.calls.find(call => call[0] === 'effects')[1];
  const events = pv.calls.find(call => call[0] === 'events')[2];
  assert.equal(effects['hanabi.beatBursts'], 0);
  assert.deepEqual(events, []);
  bridge.dispose();
}

function testOverlappingBridgeOwnership() {
  const { createSmartBeatRenderBridge } = loadSmartBeatRender();
  const pv = makeBus();
  const complete = makeBus();
  const drumWrites = [];
  const buses = {
    pv,
    complete,
    publishPendoloDrumHits: (...args) => drumWrites.push(args),
  };
  const older = createSmartBeatRenderBridge({
    mode: 'hanabi',
    trackKey: timeline.trackKey,
    settings: {
      mode: 'on',
      effects: { 'hanabi.beatBursts': { enabled: true, strength: 1 } },
    },
    timeline,
    buses,
  });
  const current = createSmartBeatRenderBridge({
    mode: 'tempera',
    trackKey: timeline.trackKey,
    settings: {
      mode: 'on',
      effects: { 'tempera.inkFlash': { enabled: true, strength: 1.25 } },
    },
    timeline,
    buses,
  });
  const pvCallsAfterCurrentCreate = pv.calls.length;
  const completeCallsAfterCurrentCreate = complete.calls.length;
  const drumWritesAfterCurrentCreate = drumWrites.length;

  older.update({
    settings: {
      mode: 'on',
      effects: { 'hanabi.beatBursts': { enabled: true, strength: 2 } },
    },
  });
  older.frame({ rawPosition: 3, playing: true });
  older.dispose();

  assert.equal(
    pv.calls.length,
    pvCallsAfterCurrentCreate,
    'disposing a superseded stage must not stop or reset the PV beat bus'
  );
  assert.equal(
    complete.calls.length,
    completeCallsAfterCurrentCreate,
    'disposing a superseded stage must not stop or reset the complete beat bus'
  );
  assert.equal(
    drumWrites.length,
    drumWritesAfterCurrentCreate,
    'disposing a superseded stage must not clear the current drum timeline'
  );

  current.frame({ rawPosition: 1.1, playing: true });
  assert.ok(pv.calls.some(call => call[0] === 'tick'));
  current.dispose();
  assert.ok(pv.calls.some(call => call[0] === 'stop'));
}

function testPreviewBridgeNeverTouchesSharedBuses() {
  const { createSmartBeatRenderBridge } = loadSmartBeatRender();
  const pv = makeBus();
  const complete = makeBus();
  const drumWrites = [];
  const buses = {
    pv,
    complete,
    publishPendoloDrumHits: (...args) => drumWrites.push(args),
  };
  const active = createSmartBeatRenderBridge({
    mode: 'hanabi',
    trackKey: timeline.trackKey,
    settings: {
      mode: 'on',
      effects: { 'hanabi.beatBursts': { enabled: true, strength: 1 } },
    },
    timeline,
    buses,
  });
  const pvCallsBeforePreview = pv.calls.length;
  const completeCallsBeforePreview = complete.calls.length;
  const drumWritesBeforePreview = drumWrites.length;
  const bridge = createSmartBeatRenderBridge({
    preview: true,
    mode: 'tempera',
    trackKey: timeline.trackKey,
    settings: {
      mode: 'on',
      effects: { 'tempera.inkFlash': { enabled: true, strength: 1 } },
    },
    timeline,
    buses,
  });

  assert.equal(bridge.getSmartBeatEnabled(), false);
  assert.deepEqual(bridge.getSmartBeatDrumHits(timeline.trackKey), null);
  bridge.update({ mode: 'sonnet', settings: { mode: 'on' }, timeline });
  bridge.frame({ rawPosition: 2, playing: true });
  bridge.dispose();

  assert.equal(pv.calls.length, pvCallsBeforePreview);
  assert.equal(complete.calls.length, completeCallsBeforePreview);
  assert.equal(drumWrites.length, drumWritesBeforePreview);
  active.frame({ rawPosition: 1.5, playing: true });
  assert.ok(pv.calls.some(call => call[0] === 'tick'));
  active.dispose();

  const runtimeSource = fs.readFileSync(
    path.resolve('src/karaoke/folia/runtime.ts'),
    'utf8'
  );
  assert.ok(runtimeSource.includes('preview: options.preview === true'));
  assert.ok(
    runtimeSource.includes(
      'createElement(renderer, { ...props, isPreviewMode: true })'
    ),
    'preview mode must reach original React renderers that support it'
  );
  assert.match(
    runtimeSource,
    /setSmartBeatEnabled:\s*\(enabled: boolean\)\s*=>\s*runtime\.setSmartBeatEnabled\(enabled\)/,
    'the PV adapter must expose Sonnet’s live SmartBeat setter'
  );
  const sonnetSource = fs.readFileSync(
    path.resolve(
      'vendor/folia-pv/src/components/visualizer/sonnet/createSonnetPixiRuntime.ts'
    ),
    'utf8'
  );
  assert.match(sonnetSource, /setSmartBeatEnabled\(enabled: boolean\)/);
}

function testTemperaInkFlashReachesOriginalRenderer() {
  const { createSmartBeatRenderBridge, TemperaPixiRuntime, flashEnvelope } =
    loadTemperaRuntimeConsumer();
  const bridge = createSmartBeatRenderBridge({
    mode: 'tempera',
    trackKey: timeline.trackKey,
    settings: {
      mode: 'on',
      effects: { 'tempera.inkFlash': { enabled: true, strength: 1.4 } },
    },
    timeline,
  });
  bridge.frame({ rawPosition: 0.9, playing: true });

  const frames = [];
  const runtime = Object.create(TemperaPixiRuntime.prototype);
  Object.assign(runtime, {
    inkFlashSupported: true,
    options: {
      staticMode: false,
      getSmartBeatDrumHits: bridge.getSmartBeatDrumHits,
      theme: { accentColor: '#123456' },
    },
    sceneCache: { get: () => ({ palette: { accent: '#abcdef' } }) },
    inkFlash: { update: frame => frames.push(frame) },
  });
  runtime.updateInkFlash(0.2, 960, 540, 3);

  assert.equal(
    frames.length,
    1,
    'the live Tempera frame must reach its ink renderer'
  );
  assert.equal(frames[0].strength, 1.4);
  assert.equal(frames[0].time, 0.9, 'the ink uses the heard raw-audio clock');
  assert.deepEqual(Array.from(frames[0].hits.times), timeline.drums.times);
  assert.deepEqual(Array.from(frames[0].hits.kinds), timeline.drums.kinds);
  assert.equal(frames[0].inkColor, '#abcdef');
  assert.equal(flashEnvelope(0.1), 1);
  assert.ok(flashEnvelope(0.5) > 0 && flashEnvelope(0.5) < 0.1);

  const source = fs.readFileSync(
    path.resolve(
      'vendor/folia-pv/src/components/visualizer/tempera/createTemperaPixiRuntime.ts'
    ),
    'utf8'
  );
  assert.ok(
    source.includes(
      'this.updateInkFlash(time, width, height, paragraphIndex);'
    ),
    'the production render loop must invoke the tested ink consumer'
  );
  assert.ok(source.includes('runtime.inkFlash.container'));
  assert.ok(source.includes('this.options.getSmartBeatDrumHits?.(heard.key)'));
  const hostRuntime = fs.readFileSync(
    path.resolve('src/karaoke/folia/runtime.ts'),
    'utf8'
  );
  assert.ok(
    hostRuntime.includes('getSmartBeatDrumHits: bridge.getSmartBeatDrumHits'),
    'the live bridge must provide canonical hits to the original Tempera runtime'
  );
  assert.ok(
    hostRuntime.includes('getSmartBeatDrumHits: options.getSmartBeatDrumHits'),
    'the host runtime must forward the canonical hit provider to Tempera'
  );
  assert.ok(
    hostRuntime.includes('rawAudioClock: options.rawAudioClock'),
    'the host runtime must forward the canonical raw media clock to Tempera'
  );
  assert.ok(source.includes('this.options.rawAudioClock?.()'));
  bridge.dispose();
}

function testPausedTemperaInkFlashUsesRawAudioClock() {
  const { createSmartBeatRenderBridge, TemperaPixiRuntime, flashEnvelope } =
    loadTemperaRuntimeConsumer();
  let rawPosition = 1.3;
  const lyricOffset = 2;
  const bridge = createSmartBeatRenderBridge({
    mode: 'tempera',
    trackKey: timeline.trackKey,
    settings: {
      mode: 'on',
      effects: { 'tempera.inkFlash': { enabled: true, strength: 1 } },
    },
    timeline,
  });
  bridge.frame({ rawPosition, playing: false });

  const frames = [];
  const runtime = Object.create(TemperaPixiRuntime.prototype);
  Object.assign(runtime, {
    inkFlashSupported: true,
    options: {
      paused: false,
      staticMode: false,
      rawAudioClock: () => rawPosition,
      getSmartBeatDrumHits: bridge.getSmartBeatDrumHits,
      theme: { accentColor: '#123456' },
    },
    app: { stop() {} },
    sceneCache: { get: () => ({ palette: { accent: '#abcdef' } }) },
    inkFlash: { update: frame => frames.push(frame) },
    renderOnce() {
      this.updateInkFlash(rawPosition + lyricOffset, 960, 540, 3);
    },
  });

  runtime.setPaused(true);
  assert.equal(frames.length, 1, 'pausing must draw the final ink frame');
  assert.equal(runtime.options.paused, true);
  assert.equal(
    frames[0].time,
    1.3,
    'the paused final frame must use raw audio time, not lyric-offset time'
  );
  assert.equal(flashEnvelope(frames[0].time - 1.25), 1);

  rawPosition = 1.5;
  bridge.frame({ rawPosition, playing: false });
  runtime.renderOnce();
  assert.equal(
    frames[1].time,
    1.5,
    'a seek while paused must use the updated raw audio clock'
  );
  bridge.dispose();
}

function testRawAudioPublishesToBothStableFoliaSignalStores() {
  const { getStableFoliaAudioSignals, publishSmartBeatAudioFeatures } =
    loadSmartBeatRender();
  const completeSignals = getStableFoliaAudioSignals('complete');
  const commonSignals = getStableFoliaAudioSignals('common');
  const pixiSignals = getStableFoliaAudioSignals('sonnet');
  const temperaSignals = getStableFoliaAudioSignals('tempera');

  assert.equal(completeSignals.audioPower, commonSignals.audioPower);
  assert.equal(completeSignals.audioBands, commonSignals.audioBands);
  assert.equal(pixiSignals.audioPower, temperaSignals.audioPower);
  assert.equal(pixiSignals.audioBands, temperaSignals.audioBands);
  assert.ok(completeSignals.audioBands.spectrum);
  assert.ok(pixiSignals.audioBands.spectrum);

  const published = publishSmartBeatAudioFeatures({
    available: true,
    power: 0.25,
    bass: 0.1,
    lowMid: 0.2,
    mid: 0.3,
    vocal: 0.4,
    treble: 0.5,
  });
  assert.equal(published.power, 0.25, 'the raw feature bus stays normalized');
  for (const signals of [completeSignals, pixiSignals]) {
    assert.equal(signals.audioPower.get(), 0.25 * 255);
    assert.equal(signals.audioBands.bass.get(), 0.1 * 255);
    assert.equal(signals.audioBands.lowMid.get(), 0.2 * 255);
    assert.equal(signals.audioBands.mid.get(), 0.3 * 255);
    assert.equal(signals.audioBands.vocal.get(), 0.4 * 255);
    assert.equal(signals.audioBands.treble.get(), 0.5 * 255);
  }
}

function testRawAudioFeatureTapIsSeparateFromLyricFallback() {
  const previousWindow = global.window;
  const observed = [];
  const node = { src: 'http://router.test/song.mp3' };
  const context = {
    state: 'running',
    sampleRate: 48000,
    destination: {},
    createMediaElementSource() {
      return { connect() {} };
    },
    createAnalyser() {
      return {
        fftSize: 256,
        getFloatTimeDomainData(buffer) {
          buffer.fill(0.2);
        },
        getByteFrequencyData(buffer) {
          buffer.fill(0);
          buffer[1] = 220;
          buffer[4] = 160;
          buffer[20] = 100;
        },
        connect() {},
      };
    },
  };
  global.window = {
    location: { origin: 'http://router.test' },
    AudioContext: function AudioContext() {
      return context;
    },
  };
  let player = {
    playing: true,
    volume: 0.8,
    progress: 0,
    currentTrack: { id: 42 },
    seek: () => 2.5,
    _howler: { _sounds: [{ _node: node }] },
  };
  const analyzer = createPlayerMusicAnalyzer({
    getPlayer: () => player,
    getCurrentItem: () => ({ queueItemId: 'queue-7', trackId: 42 }),
    onAudioFeatures: features => observed.push(features),
    schedule: () => 1,
    cancel: () => {},
  });
  try {
    analyzer.tick();
    const raw = observed.at(-1);
    assert.equal(raw.available, true);
    for (const key of ['power', 'bass', 'lowMid', 'mid', 'vocal', 'treble']) {
      assert.ok(Number.isFinite(raw[key]), `${key} must be finite`);
      assert.ok(raw[key] >= 0 && raw[key] <= 1, `${key} must be bounded`);
    }
    assert.ok(raw.power > 0);

    player = { ...player, volume: 0 };
    analyzer.tick();
    assert.equal(observed.at(-1).available, false);
    assert.deepEqual(
      Object.fromEntries(
        ['power', 'bass', 'lowMid', 'mid', 'vocal', 'treble'].map(key => [
          key,
          observed.at(-1)[key],
        ])
      ),
      { power: 0, bass: 0, lowMid: 0, mid: 0, vocal: 0, treble: 0 }
    );

    player = { ...player, volume: 0.8, playing: false };
    analyzer.tick();
    assert.equal(observed.at(-1).available, false);
    assert.equal(observed.at(-1).power, 0);

    player = {
      ...player,
      playing: true,
      _howler: { _sounds: [{ _node: { ...node, ended: true } }] },
    };
    analyzer.tick();
    assert.equal(observed.at(-1).available, false);
    assert.equal(observed.at(-1).power, 0);
  } finally {
    analyzer.dispose();
    global.window = previousWindow;
  }
}

async function testTimelineTransportIsRevisionedAndBounded() {
  const calls = [];
  let smartBeat = { revision: 1, timeline };
  const bridge = createWebRoomBridge({
    origin: 'http://router.test',
    manager: {
      getSnapshot: () => ({
        revision: 1,
        session: { sessionId: 'session-1' },
        currentItem: { queueItemId: 'queue-7' },
        waitingItems: [],
        historyItems: [],
      }),
    },
    execute: async () => ({ ok: true }),
    request: async (action, body) => {
      calls.push({ action, body });
      if (action === 'open') return { hostToken: 'host-token', room: {} };
      return { reactions: [], commands: [] };
    },
    getPresentation: () => ({
      itemId: 'queue-7',
      position: 1,
      playing: true,
      lines: [],
      smartBeat: {
        settings: normalizeSmartBeatPreferences({ mode: 'on' }),
        status: 'ready',
        trackKey: timeline.trackKey,
        analysisRevision: smartBeat.revision,
      },
    }),
    getSmartBeatState: () => smartBeat,
  });
  try {
    await bridge.invoke('karaoke:lan:start');
    assert.deepEqual(calls[0].body.smartBeatTimeline, smartBeat);
    assert.equal(calls[0].body.presentation.smartBeat.timeline, undefined);
    await bridge.exchange();
    assert.equal(
      Object.prototype.hasOwnProperty.call(calls[1].body, 'smartBeatTimeline'),
      false,
      'unchanged timeline revision is omitted from ordinary exchanges'
    );
    smartBeat = { revision: 2, timeline: null };
    await bridge.exchange();
    assert.deepEqual(calls[2].body.smartBeatTimeline, smartBeat);
  } finally {
    await bridge.dispose();
  }
}

async function testFollowerAnalysisSingleflightAndStaleGeneration() {
  const flush = () => new Promise(resolve => setImmediate(resolve));
  let state = {
    active: true,
    generation: 7,
    smartBeatRevision: 1,
    smartBeatTrackKey: timeline.trackKey,
    presentation: {
      itemId: 'queue-7',
      smartBeat: { trackKey: timeline.trackKey },
    },
  };
  const requests = [];
  const updates = [];
  const poller = createDisplayPoller({
    request: async () => ({ ...state }),
    requestAnalysis: (key, signal) =>
      new Promise((resolve, reject) =>
        requests.push({ key, signal, resolve, reject })
      ),
    onState: value => updates.push(value),
    onError: error => {
      throw error;
    },
    schedule: () => 1,
    cancel: () => {},
  });
  poller.start();
  await flush();
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].key, { generation: 7, revision: 1 });

  state = {
    ...state,
    generation: 8,
    smartBeatRevision: 2,
    smartBeatTrackKey: 'queue-8:track-99',
    presentation: {
      itemId: 'queue-8',
      smartBeat: { trackKey: 'queue-8:track-99' },
    },
  };
  await poller.refresh();
  await flush();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].signal.aborted, true);
  requests[0].resolve({ generation: 7, revision: 1, timeline });
  requests[1].resolve({
    generation: 8,
    revision: 2,
    timeline: { ...timeline, trackKey: 'queue-8:track-99' },
  });
  await flush();
  await flush();
  assert.equal(
    updates[updates.length - 1].smartBeatTimeline.trackKey,
    'queue-8:track-99'
  );
  await poller.refresh();
  await flush();
  assert.equal(requests.length, 2, 'cached revision is not fetched twice');
  poller.stop();
}

async function run() {
  testPreferenceBoundsAndSources();
  testCanonicalTimelineBounds();
  testPresentationAndHostTimelineContract();
  testDualBusProjectionUsesRawClock();
  testStaleTimelineCannotDriveDifferentTrack();
  testOverlappingBridgeOwnership();
  testPreviewBridgeNeverTouchesSharedBuses();
  testTemperaInkFlashReachesOriginalRenderer();
  testPausedTemperaInkFlashUsesRawAudioClock();
  testRawAudioPublishesToBothStableFoliaSignalStores();
  testRawAudioFeatureTapIsSeparateFromLyricFallback();
  await testTimelineTransportIsRevisionedAndBounded();
  await testFollowerAnalysisSingleflightAndStaleGeneration();
  console.log(
    'SmartBeat integration, bus ownership, preview isolation, Tempera consumer, clock, and raw audio checks passed'
  );
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
