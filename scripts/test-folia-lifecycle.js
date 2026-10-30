const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const vm = require('vm');
const esbuild = require('esbuild');
const vueCompiler = require('vue-template-compiler');

const filename = path.resolve('src/karaoke/folia/stageLifecycle.js');
const compiled = esbuild.buildSync({
  entryPoints: [filename],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  target: 'node16',
}).outputFiles[0].text;
const loaded = new Module(filename, module);
loaded.paths = module.paths;
loaded._compile(compiled, filename);
const { createStageLifecycle, createIdempotentPausedUpdater } = loaded.exports;
const errorReporterPath = path.resolve('src/karaoke/folia/stageErrors.js');
const errorReporterBundle = esbuild.buildSync({
  entryPoints: [errorReporterPath],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  target: 'node16',
}).outputFiles[0].text;
const errorReporterModule = new Module(errorReporterPath, module);
errorReporterModule.paths = module.paths;
errorReporterModule._compile(errorReporterBundle, errorReporterPath);
const { routeReactStageError } = errorReporterModule.exports;

function loadKaraokePvScene({ loadFoliaRuntime, globals = {} } = {}) {
  const componentPath = path.resolve(
    'src/components/karaoke/KaraokePvScene.vue'
  );
  const descriptor = vueCompiler.parseComponent(
    fs.readFileSync(componentPath, 'utf8')
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
      loadFoliaRuntime,
      createStageLifecycle,
      createPvClock: () => ({ set() {} }),
      supportsRuntimeUpdateMode: mode =>
        ['tilt', 'cadenza', 'folia-classic'].includes(mode),
      createStageTheme: () => ({
        backgroundColor: '#000000',
        primaryColor: '#ffffff',
        accentColor: '#7655ff',
        secondaryColor: '#45359a',
      }),
      ...globals,
    },
    { filename: componentPath }
  );
  return componentModule.exports.default;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function run() {
  testIdempotentPausedUpdaterSkipsRedundantPatches();
  let nextId = 0;
  const created = [];
  const activated = [];
  const removed = [];
  const timers = new Map();
  let nextTimer = 0;
  const lifecycle = createStageLifecycle({
    createLayer() {
      const layer = { id: ++nextId };
      created.push(layer);
      return layer;
    },
    createRuntime(options) {
      const result = deferred();
      result.options = options;
      result.layer = options.host;
      created[created.length - 1].creation = result;
      return result.promise;
    },
    activate(next, previous, duration) {
      activated.push({
        next: next.layer.id,
        previous: previous?.layer.id,
        duration,
      });
    },
    settle() {},
    removeLayer(layer) {
      removed.push(layer.id);
    },
    setTimer(callback, delay) {
      const id = ++nextTimer;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
  });

  const firstBuild = lifecycle.replace(
    { mode: 'sonnet' },
    { transitionMs: 600 }
  );
  const first = created[0].creation;
  const firstRuntime = {
    destroyed: 0,
    destroy() {
      this.destroyed++;
    },
  };
  first.resolve(firstRuntime);
  assert.equal(await firstBuild, true, 'first completed stage becomes active');

  const secondBuild = lifecycle.replace(
    { mode: 'tempera' },
    { transitionMs: 600 }
  );
  const second = created[1].creation;
  assert.equal(
    activated.length,
    1,
    'the active stage stays visible until its replacement is ready'
  );
  assert.equal(
    firstRuntime.destroyed,
    0,
    'starting a build does not destroy the active runtime'
  );

  const thirdBuild = lifecycle.replace(
    { mode: 'hanabi' },
    { transitionMs: 600 }
  );
  const third = created[2].creation;
  assert.equal(
    second.options.signal.aborted,
    true,
    'a newer build aborts only the pending candidate'
  );
  assert.equal(
    firstRuntime.destroyed,
    0,
    'aborting a pending candidate keeps the active runtime'
  );

  const thirdRuntime = {
    destroyed: 0,
    destroy() {
      this.destroyed++;
    },
  };
  third.resolve(thirdRuntime);
  assert.equal(
    await thirdBuild,
    true,
    'the newest completed candidate becomes active'
  );
  assert.deepEqual(activated[1], { next: 3, previous: 1, duration: 600 });
  assert.equal(
    firstRuntime.destroyed,
    0,
    'the previous frame remains during its crossfade'
  );

  const staleRuntime = {
    destroyed: 0,
    destroy() {
      this.destroyed++;
    },
  };
  second.resolve(staleRuntime);
  assert.equal(
    await secondBuild,
    false,
    'a stale candidate never takes ownership'
  );
  assert.equal(staleRuntime.destroyed, 1, 'late stale runtimes are destroyed');
  assert.ok(removed.includes(2), 'the stale candidate layer is removed');
  assert.equal(thirdRuntime.destroyed, 0, 'the newest runtime remains active');

  const failedBuild = lifecycle.replace({ mode: 'tilt' }, { transitionMs: 0 });
  const failed = created[3].creation;
  failed.reject(new Error('expected candidate failure'));
  await assert.rejects(failedBuild, /expected candidate failure/);
  assert.equal(
    thirdRuntime.destroyed,
    0,
    'candidate failure leaves the valid active runtime intact'
  );
  assert.ok(removed.includes(4), 'a failed candidate layer is removed');

  const unmountBuild = lifecycle.replace({ mode: 'tilt' }, { transitionMs: 0 });
  const unmount = created[4].creation;
  lifecycle.destroy();
  assert.equal(
    unmount.options.signal.aborted,
    true,
    'unmount aborts a pending candidate'
  );
  assert.ok(
    removed.includes(5),
    'unmount removes the pending layer immediately'
  );
  const lateRuntime = {
    destroyed: 0,
    destroy() {
      this.destroyed++;
    },
  };
  unmount.resolve(lateRuntime);
  assert.equal(
    await unmountBuild,
    false,
    'a candidate resolving after unmount is rejected'
  );
  assert.equal(
    lateRuntime.destroyed,
    1,
    'a runtime resolving after unmount is destroyed'
  );

  lifecycle.destroy();
  assert.equal(
    thirdRuntime.destroyed,
    1,
    'destroy is idempotent for the active runtime'
  );
  assert.ok(removed.includes(3), 'destroy removes the active layer');
  assert.equal(timers.size, 0, 'destroy cancels pending transition cleanup');
  assert.equal(firstRuntime.destroyed, 1, 'retiring layers are also destroyed');
  assert.ok(removed.includes(1), 'destroy removes any layer still crossfading');

  await testVueRuntimePrimingFailureDestroysRuntime();
  await testVueActivationFailureKeepsPreviousLayerVisible();
  await testCancelPendingKeepsActiveBackground();
  await testActiveRuntimeErrorOnlyAffectsCurrentGeneration();
  await testReactErrorsRouteAfterReadinessAndReachSceneRecovery();
  testBackgroundAssetsDoNotRebuildLegacyLyricRuntimes();
  console.log('Folia stage lifecycle generation and cleanup tests passed');
}

function testIdempotentPausedUpdaterSkipsRedundantPatches() {
  assert.equal(typeof createIdempotentPausedUpdater, 'function');

  let paused = false;
  const patches = [];
  const setPaused = createIdempotentPausedUpdater(
    () => paused,
    patch => {
      patches.push(patch);
      paused = patch.paused;
      return true;
    }
  );

  assert.equal(setPaused(false), false);
  assert.equal(setPaused(false), false);
  assert.equal(patches.length, 0, 'repeating the current pause state does not patch React state');
  assert.equal(setPaused(true), true);
  assert.equal(setPaused(true), false);
  assert.equal(setPaused(false), true);
  assert.deepEqual(patches, [{ paused: true }, { paused: false }]);
}

async function testActiveRuntimeErrorOnlyAffectsCurrentGeneration() {
  const layers = [];
  const errors = [];
  const runtimes = [];
  const removed = [];
  const lifecycle = createStageLifecycle({
    createLayer() {
      const layer = { id: layers.length + 1 };
      layers.push(layer);
      return layer;
    },
    createRuntime(options) {
      const runtime = {
        destroyed: 0,
        reportError: options.onRuntimeError,
        destroy() {
          this.destroyed++;
        },
      };
      runtimes.push(runtime);
      return Promise.resolve(runtime);
    },
    activate() {},
    removeLayer(layer) {
      removed.push(layer.id);
    },
    onRuntimeError(error, stage) {
      errors.push({ error, layer: stage.layer.id });
    },
  });

  await lifecycle.replace({ mode: 'cadenza' }, { transitionMs: 0 });
  const oldError = runtimes[0].reportError;
  await lifecycle.replace({ mode: 'partita' }, { transitionMs: 0 });
  const activeRuntime = runtimes[1];

  oldError(new Error('stale renderer error'));
  assert.equal(
    activeRuntime.destroyed,
    0,
    'an error from an obsolete generation cannot destroy the active stage'
  );
  assert.equal(errors.length, 0, 'stale errors are not reported to the scene');

  const failure = new Error('active renderer error');
  activeRuntime.reportError(failure);
  assert.equal(
    activeRuntime.destroyed,
    1,
    'the failed active runtime is cleaned'
  );
  assert.ok(removed.includes(2), 'the failed active layer is removed');
  assert.deepEqual(errors, [{ error: failure, layer: 2 }]);
  activeRuntime.reportError(new Error('duplicate callback'));
  assert.equal(errors.length, 1, 'the same failed generation reports once');
  lifecycle.destroy();
}

async function testReactErrorsRouteAfterReadinessAndReachSceneRecovery() {
  const initialErrors = [];
  const runtimeErrors = [];
  const failure = new Error('React renderer failed');
  assert.equal(
    routeReactStageError({
      error: failure,
      ready: false,
      destroyed: false,
      onReadyError: error => initialErrors.push(error),
      onRuntimeError: error => runtimeErrors.push(error),
    }),
    true
  );
  assert.deepEqual(initialErrors, [failure]);
  assert.equal(runtimeErrors.length, 0);

  assert.equal(
    routeReactStageError({
      error: failure,
      ready: true,
      destroyed: false,
      onReadyError: error => initialErrors.push(error),
      onRuntimeError: error => runtimeErrors.push(error),
    }),
    true
  );
  assert.deepEqual(runtimeErrors, [failure]);
  assert.equal(
    routeReactStageError({
      error: failure,
      ready: true,
      destroyed: true,
      onRuntimeError: error => runtimeErrors.push(error),
    }),
    false,
    'destroyed stages ignore delayed React errors'
  );

  const component = loadKaraokePvScene({
    globals: { console: { error() {} } },
  });
  const scene = { pvDisposed: false, pvRuntime: {}, status: 'ready' };
  component.methods.handleRuntimeError.call(scene, failure);
  assert.equal(scene.pvRuntime, null);
  assert.equal(scene.status, 'error', 'the PV scene exposes its retry state');
  component.methods.handleRuntimeError.call(
    { pvDisposed: true, pvRuntime: {}, status: 'ready' },
    failure
  );

  const layers = [];
  const removed = [];
  const canvasHost = {
    appendChild(layer) {
      layer.parentNode = this;
      layers.push(layer);
    },
    removeChild(layer) {
      removed.push(layer);
      layer.parentNode = null;
    },
  };
  const documentStub = {
    hidden: false,
    createElement() {
      return { style: {} };
    },
    addEventListener() {},
    removeEventListener() {},
  };
  const motion = {
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  };
  const runtimeComponent = loadKaraokePvScene({
    globals: {
      document: documentStub,
      window: { matchMedia: () => motion },
      console: { error() {} },
    },
  });
  let reportRuntimeError;
  let destroyCount = 0;
  const runtime = {
    setPaused() {},
    renderOnce() {},
    destroy() {
      destroyCount++;
    },
  };
  const instance = {
    pvDisposed: false,
    pvRuntime: null,
    status: 'waiting',
    $refs: { canvasHost },
    isPaused: () => true,
    queueBuild() {},
    handleRuntimeError: runtimeComponent.methods.handleRuntimeError,
    async createRuntime(options) {
      reportRuntimeError = options.onRuntimeError;
      return runtime;
    },
  };
  runtimeComponent.mounted.call(instance);
  assert.equal(
    await instance.pvLifecycle.replace({ mode: 'folia-classic' }),
    true,
    'the React runtime becomes the current PV stage before late errors'
  );
  reportRuntimeError(failure);
  assert.equal(instance.status, 'error');
  assert.equal(instance.pvRuntime, null);
  assert.equal(destroyCount, 1, 'the current React runtime is destroyed');
  assert.ok(removed.includes(layers[0]), 'the failed React layer is removed');
  runtimeComponent.beforeDestroy.call(instance);
}

function testBackgroundAssetsDoNotRebuildLegacyLyricRuntimes() {
  const component = loadKaraokePvScene();
  assert.equal(
    component.watch.background,
    undefined,
    'background-only changes belong to the independent background stage'
  );
  assert.equal(component.watch.assets.handler, 'updateAssets');

  let legacyUpdates = 0;
  component.methods.updateAssets.call({
    mode: 'sonnet',
    updateAppearance() {
      legacyUpdates++;
    },
  });
  assert.equal(
    legacyUpdates,
    0,
    'background image changes must not rebuild a Pixi lyric runtime'
  );

  let reactUpdates = 0;
  component.methods.updateAssets.call({
    mode: 'cadenza',
    updateAppearance() {
      reactUpdates++;
    },
  });
  assert.equal(
    reactUpdates,
    1,
    'React lyric renderers receive updated resolved portrait and Cappella assets in place'
  );

  let temperaRebuilds = 0;
  const previousTemperaAssets = [
    { id: 'old', url: '/ktv/display/visual-assets/old' },
  ];
  const nextTemperaAssets = [
    { id: 'new', url: '/ktv/display/visual-assets/new' },
  ];
  const temperaScene = {
    mode: 'tempera',
    assets: { temperaLayerImageAssets: nextTemperaAssets },
    pvTemperaAssetsKey: JSON.stringify(
      previousTemperaAssets.map(({ id, url }) => [id, url])
    ),
    temperaAssetsKey: component.methods.temperaAssetsKey,
    queueBuild() {
      temperaRebuilds++;
    },
  };
  component.methods.updateAssets.call(temperaScene);
  assert.equal(
    temperaRebuilds,
    1,
    'a changed Tempera image manifest rebuilds its blob-only Pixi runtime'
  );
  component.methods.updateAssets.call(temperaScene);
  assert.equal(
    temperaRebuilds,
    1,
    'unrelated asset changes do not rebuild Tempera when its manifest is stable'
  );
}

async function testCancelPendingKeepsActiveBackground() {
  const created = [];
  const removed = [];
  const lifecycle = createStageLifecycle({
    createLayer() {
      const layer = { id: created.length + 1 };
      created.push(layer);
      return layer;
    },
    createRuntime(options) {
      const result = deferred();
      result.options = options;
      created[created.length - 1].creation = result;
      return result.promise;
    },
    activate() {},
    removeLayer(layer) {
      removed.push(layer.id);
    },
  });

  const activeBuild = lifecycle.replace(
    { mode: 'common' },
    { transitionMs: 0 }
  );
  const activeCreation = created[0].creation;
  const activeRuntime = {
    destroyed: 0,
    destroy() {
      this.destroyed++;
    },
  };
  activeCreation.resolve(activeRuntime);
  assert.equal(await activeBuild, true);

  const candidateBuild = lifecycle.replace(
    { mode: 'monet' },
    { transitionMs: 600 }
  );
  const candidate = created[1].creation;
  assert.equal(lifecycle.cancelPending(), true);
  assert.equal(candidate.options.signal.aborted, true);
  assert.equal(
    activeRuntime.destroyed,
    0,
    'canceling a background candidate preserves the visible layer'
  );
  assert.ok(
    removed.includes(2),
    'the canceled candidate layer is removed immediately'
  );
  const lateRuntime = {
    destroyed: 0,
    destroy() {
      this.destroyed++;
    },
  };
  candidate.resolve(lateRuntime);
  assert.equal(await candidateBuild, false);
  assert.equal(lateRuntime.destroyed, 1);
  assert.equal(activeRuntime.destroyed, 0);
  lifecycle.destroy();
  assert.equal(activeRuntime.destroyed, 1);
}

async function testVueRuntimePrimingFailureDestroysRuntime() {
  for (const failingMethod of ['update', 'setPaused', 'renderOnce']) {
    const failure = new Error(`renderer ${failingMethod} failed`);
    let destroyCount = 0;
    const runtime = {
      update() {
        if (failingMethod === 'update') throw failure;
      },
      setPaused() {
        if (failingMethod === 'setPaused') throw failure;
      },
      renderOnce() {
        if (failingMethod === 'renderOnce') throw failure;
      },
      destroy() {
        destroyCount++;
      },
    };
    const component = loadKaraokePvScene({
      loadFoliaRuntime: async () => ({
        createStage: async () => runtime,
      }),
    });
    const instance = {
      runtimeUpdatePatch: () => ({}),
      isPaused: () => false,
    };

    await assert.rejects(
      component.methods.createRuntime.call(instance, {
        mode: 'tilt',
        signal: new AbortController().signal,
      }),
      error => error === failure
    );
    assert.equal(
      destroyCount,
      1,
      `post-create ${failingMethod} failure destroys the runtime exactly once`
    );
  }
}

async function testVueActivationFailureKeepsPreviousLayerVisible() {
  let nextRuntime = null;
  const layers = [];
  const removed = [];
  const canvasHost = {
    appendChild(layer) {
      layer.parentNode = this;
      layers.push(layer);
    },
    removeChild(layer) {
      removed.push(layer);
      layer.parentNode = null;
    },
  };
  const documentStub = {
    hidden: false,
    createElement() {
      return { style: {} };
    },
    addEventListener() {},
    removeEventListener() {},
  };
  const motion = {
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  };
  const component = loadKaraokePvScene({
    globals: {
      document: documentStub,
      window: { matchMedia: () => motion },
    },
  });
  const instance = {
    $refs: { canvasHost },
    pvRuntime: null,
    status: 'waiting',
    isPaused: () => true,
    createRuntime: async () => nextRuntime,
    queueBuild() {},
  };
  component.mounted.call(instance);

  let activeDestroyed = 0;
  const activeRuntime = {
    setPaused() {},
    renderOnce() {},
    destroy() {
      activeDestroyed++;
    },
  };
  nextRuntime = activeRuntime;
  assert.equal(
    await instance.pvLifecycle.replace({ mode: 'sonnet' }, { transitionMs: 0 }),
    true,
    'the initial Vue-mounted layer activates'
  );
  const activeLayer = layers[0];
  assert.equal(activeLayer.style.opacity, '1');

  let candidateDestroyed = 0;
  const failure = new Error('candidate pause failed');
  nextRuntime = {
    setPaused() {
      throw failure;
    },
    renderOnce() {},
    destroy() {
      candidateDestroyed++;
    },
  };
  await assert.rejects(
    instance.pvLifecycle.replace({ mode: 'tilt' }, { transitionMs: 600 }),
    error => error === failure
  );

  assert.equal(
    activeLayer.style.opacity,
    '1',
    'activation failure keeps the old frame visible'
  );
  assert.strictEqual(
    instance.pvRuntime,
    activeRuntime,
    'the old renderer remains selected'
  );
  assert.equal(
    activeDestroyed,
    0,
    'activation failure does not destroy the old renderer'
  );
  assert.equal(
    candidateDestroyed,
    1,
    'lifecycle destroys the failed candidate exactly once'
  );
  assert.ok(
    removed.includes(layers[1]),
    'lifecycle removes the failed candidate layer'
  );
  instance.pvLifecycle.destroy();
  assert.equal(
    activeDestroyed,
    1,
    'teardown later destroys the preserved renderer'
  );
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
