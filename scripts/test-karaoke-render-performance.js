const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const esbuild = require('esbuild');
const vueCompiler = require('vue-template-compiler');

const root = path.resolve(__dirname, '..');

function loadComponent(relativePath, globals = {}) {
  const filename = path.join(root, relativePath);
  const descriptor = vueCompiler.parseComponent(
    fs.readFileSync(filename, 'utf8')
  );
  const script = descriptor.script.content.replace(/^import\s+.*?;\s*$/gm, '');
  const compiled = esbuild.transformSync(script, {
    loader: 'js',
    format: 'cjs',
    target: 'node16',
  }).code;
  const componentModule = { exports: {} };
  vm.runInNewContext(
    compiled,
    {
      module: componentModule,
      exports: componentModule.exports,
      ...globals,
    },
    { filename }
  );
  return componentModule.exports.default;
}

async function testPausedPvUpdatesOnlyRenderChangedFrames() {
  let currentTime = 0;
  const clock = {
    get: () => currentTime,
    set(position) {
      currentTime = position;
    },
  };
  const counts = { setPaused: 0, renderOnce: 0, updates: [] };
  const runtime = {
    update(patch) {
      counts.updates.push(patch);
      return true;
    },
    setPaused() {
      counts.setPaused++;
    },
    renderOnce() {
      counts.renderOnce++;
    },
    destroy() {},
  };
  const runtimeModule = {
    publishAudioFeatures() {},
    async createStage(options) {
      assert.strictEqual(options.paused, true);
      return runtime;
    },
  };
  const component = loadComponent('src/components/karaoke/KaraokePvScene.vue', {
    createPvClock: () => clock,
    createStageLifecycle: () => ({}),
    createStageTheme: () => ({}),
    loadFoliaRuntime: async () => runtimeModule,
    supportsRuntimeUpdateMode: mode => mode === 'tilt',
    document: { hidden: false },
  });
  const scene = {
    mode: 'tilt',
    clock: null,
    position: 3,
    rawPosition: 3,
    playing: false,
    assets: {},
    audioFeatures: null,
    runtimeUpdatePatch: () => ({}),
    pvLifecycle: { hasPending: () => false },
  };
  Object.assign(scene, component.methods);
  component.created.call(scene);
  scene.updateTime();

  await scene.createRuntime({
    mode: 'tilt',
    signal: new AbortController().signal,
  });
  scene.pvRuntime = runtime;
  assert.strictEqual(counts.setPaused, 1);
  assert.strictEqual(counts.renderOnce, 1);
  assert.strictEqual(counts.updates.length, 1);
  assert.strictEqual(counts.updates[0].paused, true);
  const afterPriming = {
    setPaused: counts.setPaused,
    renderOnce: counts.renderOnce,
  };

  for (let i = 0; i < 4; i++) scene.updateTime();
  assert.strictEqual(
    counts.setPaused,
    1,
    'stable paused updates do not reapply the same pause state'
  );
  assert.strictEqual(
    counts.renderOnce,
    1,
    'the primed frame is not drawn again at the same paused position'
  );
  const afterStableUpdates = {
    setPaused: counts.setPaused,
    renderOnce: counts.renderOnce,
  };

  scene.position = 4.25;
  scene.updateTime();
  assert.strictEqual(
    currentTime,
    4.25,
    'a paused seek updates the scene clock'
  );
  assert.strictEqual(
    counts.renderOnce,
    2,
    'a paused seek draws the newly requested position'
  );
  scene.updateTime();
  assert.strictEqual(counts.renderOnce, 2, 'the same seek is drawn once');
  const afterPausedSeek = {
    setPaused: counts.setPaused,
    renderOnce: counts.renderOnce,
  };

  scene.playing = true;
  scene.updateTime();
  scene.updateTime();
  assert.strictEqual(counts.setPaused, 2, 'resume is applied once');
  assert.strictEqual(
    counts.renderOnce,
    2,
    'playing does not request static draws'
  );
  scene.playing = false;
  scene.updateTime();
  scene.updateTime();
  assert.strictEqual(counts.setPaused, 3, 'pause is applied once');
  assert.strictEqual(
    counts.renderOnce,
    3,
    'pausing draws the current frame once'
  );

  scene.runtimeUpdatePatch = () => ({ theme: 'dark', fontSize: 52 });
  scene.updateAppearance();
  assert.deepStrictEqual(
    counts.updates[counts.updates.length - 1],
    { theme: 'dark', fontSize: 52 },
    'theme and font changes still reach the live renderer'
  );
  return {
    afterPriming,
    afterFourStablePausedUpdates: afterStableUpdates,
    afterPausedSeek: afterPausedSeek,
    finalAfterResumeAndPause: {
      setPaused: counts.setPaused,
      renderOnce: counts.renderOnce,
    },
  };
}

function testBackgroundAppearanceSyncDoesNotReapplyPauseState() {
  const component = loadComponent(
    'src/components/karaoke/newKaraokeBackgroundScene.vue',
    {
      createStageLifecycle: () => ({}),
      createStageTheme: () => ({}),
      loadFoliaRuntime: async () => ({}),
    }
  );
  const counts = { setPaused: 0, updates: [] };
  const runtime = {
    update(options) {
      counts.updates.push(options);
      return true;
    },
    setPaused() {
      counts.setPaused++;
    },
  };
  const scene = {
    lyricMode: 'classic',
    background: { mode: 'common' },
    theme: 'light',
    animationIntensity: 'normal',
    coverUrl: '',
    seed: '',
    assets: {},
    playing: false,
  };
  Object.assign(scene, component.methods);
  component.created.call(scene);
  scene.backgroundLifecycle = { hasPending: () => false };
  scene.backgroundRuntime = runtime;
  scene.backgroundMode = 'common';
  scene.effectiveBackgroundMode = () => 'common';
  scene.isPaused = () => !scene.playing;
  scene.runtimeOptions = () => ({
    background: { mode: 'common', theme: scene.theme },
    staticMode: true,
    paused: scene.isPaused(),
  });
  scene.syncRuntimePaused(runtime, true);

  for (const theme of ['dark', 'light', 'dark', 'light']) {
    scene.theme = theme;
    scene.updateBackground();
  }

  assert.strictEqual(
    counts.setPaused,
    1,
    'appearance sync keeps the paused state'
  );
  assert.strictEqual(
    counts.updates.length,
    4,
    'every background style update is applied'
  );
  assert.ok(
    counts.updates.every(options => options.staticMode),
    'reduced-motion static mode remains enabled during background updates'
  );
  assert.deepStrictEqual(
    counts.updates.map(options => options.background.theme),
    ['dark', 'light', 'dark', 'light'],
    'all selected background appearances reach the renderer'
  );
  scene.playing = true;
  scene.updateBackground();
  scene.playing = false;
  scene.updateBackground();
  assert.strictEqual(
    counts.setPaused,
    1,
    'successful runtime updates also account for pause and resume state'
  );
  assert.deepStrictEqual(
    counts.updates.slice(-2).map(options => options.paused),
    [false, true],
    'background playback state remains part of the runtime updates'
  );
  return { setPaused: counts.setPaused, updates: counts.updates.length };
}

async function run() {
  const counts = {
    pv: await testPausedPvUpdatesOnlyRenderChangedFrames(),
    background: testBackgroundAppearanceSyncDoesNotReapplyPauseState(),
  };
  process.stdout.write(
    `Karaoke render performance counters passed: ${JSON.stringify(counts)}\n`
  );
}

run().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
