const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const esbuild = require('esbuild');

const helperPath = path.resolve('src/karaoke/visualPreview.js');
assert.ok(
  fs.existsSync(helperPath),
  'the visual preview lifecycle and thumbnail helper must be implemented'
);

const bundle = esbuild.buildSync({
  entryPoints: [helperPath],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  target: 'node16',
}).outputFiles[0].text;
const loaded = new Module(helperPath, module);
loaded.paths = module.paths;
loaded._compile(bundle, helperPath);
const {
  buildVisualPreviewRuntimeOptions,
  createPreviewDemoClock,
  createFullscreenPreviewMount,
  createVisualPreviewController,
  getPreviewLyricState,
  getVisualThumbnailShapes,
  isFoliaPreviewMode,
} = loaded.exports;

function deferred() {
  let resolve;
  const promise = new Promise(yes => {
    resolve = yes;
  });
  return { promise, resolve };
}

function makeScheduler() {
  let nextId = 0;
  const timers = new Map();
  return {
    timers,
    setTimer(callback, delay) {
      const id = ++nextId;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    runNext() {
      const entry = timers.entries().next().value;
      assert.ok(entry, 'a delayed preview should have a scheduled activation');
      const [id, timer] = entry;
      timers.delete(id);
      timer.callback();
      return timer;
    },
  };
}

function makeDomNode(name) {
  return {
    name,
    children: [],
    parentNode: null,
    isConnected: true,
    get nextSibling() {
      if (!this.parentNode) return null;
      const index = this.parentNode.children.indexOf(this);
      return this.parentNode.children[index + 1] || null;
    },
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      this.children.push(child);
      child.parentNode = this;
      return child;
    },
    insertBefore(child, reference) {
      if (child.parentNode) child.parentNode.removeChild(child);
      const index = reference ? this.children.indexOf(reference) : -1;
      if (index < 0) this.children.push(child);
      else this.children.splice(index, 0, child);
      child.parentNode = this;
      return child;
    },
    removeChild(child) {
      const index = this.children.indexOf(child);
      assert.notEqual(index, -1, `${child.name} must belong to ${name}`);
      this.children.splice(index, 1);
      child.parentNode = null;
      return child;
    },
  };
}

function makeFullscreenDocument() {
  const listeners = new Map();
  return {
    body: makeDomNode('body'),
    fullscreenElement: null,
    webkitFullscreenElement: null,
    mozFullScreenElement: null,
    msFullscreenElement: null,
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
    },
    removeEventListener(name, callback) {
      listeners.get(name)?.delete(callback);
    },
    dispatch(name) {
      for (const callback of listeners.get(name) || []) callback();
    },
    get listenerCount() {
      return [...listeners.values()].reduce(
        (count, set) => count + set.size,
        0
      );
    },
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function run() {
  assert.equal(
    typeof createFullscreenPreviewMount,
    'function',
    'the preview must follow the active fullscreen layer and remove its listeners'
  );
  const fullscreenDocument = makeFullscreenDocument();
  const originalParent = makeDomNode('original-parent');
  const previewElement = makeDomNode('preview');
  const sibling = makeDomNode('sibling');
  originalParent.appendChild(previewElement);
  originalParent.appendChild(sibling);
  const fullscreenMount = createFullscreenPreviewMount(
    previewElement,
    fullscreenDocument
  );
  assert.strictEqual(previewElement.parentNode, fullscreenDocument.body);

  const nativeFullscreen = makeDomNode('native-fullscreen');
  fullscreenDocument.fullscreenElement = nativeFullscreen;
  fullscreenDocument.dispatch('fullscreenchange');
  assert.strictEqual(
    previewElement.parentNode,
    nativeFullscreen,
    'the preview must be a child of the native fullscreen top-layer element'
  );
  const webkitFullscreen = makeDomNode('webkit-fullscreen');
  fullscreenDocument.fullscreenElement = null;
  fullscreenDocument.webkitFullscreenElement = webkitFullscreen;
  fullscreenDocument.dispatch('webkitfullscreenchange');
  assert.strictEqual(previewElement.parentNode, webkitFullscreen);
  fullscreenDocument.webkitFullscreenElement = null;
  fullscreenDocument.dispatch('webkitfullscreenchange');
  assert.strictEqual(previewElement.parentNode, fullscreenDocument.body);

  fullscreenMount.destroy();
  assert.strictEqual(previewElement.parentNode, originalParent);
  assert.strictEqual(fullscreenDocument.listenerCount, 0);
  fullscreenDocument.fullscreenElement = makeDomNode('late-fullscreen');
  fullscreenDocument.dispatch('fullscreenchange');
  assert.strictEqual(
    previewElement.parentNode,
    originalParent,
    'fullscreen events after destruction must not reparent the preview'
  );

  const initiallyFullscreenDocument = makeFullscreenDocument();
  const initiallyFullscreenTarget = makeDomNode('initial-fullscreen');
  const initialParent = makeDomNode('initial-parent');
  const initialPreview = makeDomNode('initial-preview');
  initiallyFullscreenDocument.fullscreenElement = initiallyFullscreenTarget;
  initialParent.appendChild(initialPreview);
  const initialMount = createFullscreenPreviewMount(
    initialPreview,
    initiallyFullscreenDocument
  );
  assert.strictEqual(
    initialPreview.parentNode,
    initiallyFullscreenTarget,
    'a preview created during fullscreen must mount directly into that layer'
  );
  initialMount.destroy();
  assert.strictEqual(initialPreview.parentNode, initialParent);
  assert.strictEqual(initiallyFullscreenDocument.listenerCount, 0);

  const tilt = getVisualThumbnailShapes('mode', 'tilt');
  assert.deepStrictEqual(
    tilt.map(shape => [shape.tag, shape.attrs.d, shape.attrs.opacity || 1]),
    [
      ['path', 'M4 9h16', 1],
      ['path', 'M5 16.5l14-3', 0.55],
    ],
    'Folia mode thumbnails preserve the glyph from the pinned mode entry'
  );
  assert.equal(
    getVisualThumbnailShapes('background', 'common')[0].attrs.d,
    'M4 17l5-8 5 8z',
    'background thumbnails preserve the pinned background entry glyph'
  );
  assert.notEqual(
    getVisualThumbnailShapes('mode', 'poem')[0].attrs.d,
    getVisualThumbnailShapes('mode', 'depth')[0].attrs.d,
    'existing LumaSing modes receive distinct thumbnails too'
  );
  assert.strictEqual(isFoliaPreviewMode('folia-classic'), true);
  assert.strictEqual(isFoliaPreviewMode('classic'), false);
  assert.equal(getPreviewLyricState(0).active, '夜风沿着海岸');
  assert.equal(getPreviewLyricState(2.4).active, '把远方的灯火吹成星海');
  assert.equal(getPreviewLyricState(9.1).active, '听见潮汐写下新的对白');
  assert.equal(
    getPreviewLyricState(12).active,
    '夜风沿着海岸',
    'the demo lyric fixture cycles without inventing word timing'
  );

  let demoNow = 0;
  let demoPosition = -1;
  let demoTimerActive = false;
  let demoTick = null;
  const demoClock = createPreviewDemoClock({
    now: () => demoNow,
    onTick: position => {
      demoPosition = position;
    },
    setTimer(callback, delay) {
      assert.equal(delay, 120);
      demoTimerActive = true;
      demoTick = callback;
      return 1;
    },
    cancelTimer() {
      demoTimerActive = false;
      demoTick = null;
    },
  });
  demoClock.start();
  demoClock.start();
  assert.equal(demoTimerActive, true, 'the demo clock should be active');
  demoNow = 2450;
  demoTick();
  assert.equal(demoPosition, 2.45);
  demoClock.stop();
  assert.equal(demoTimerActive, false, 'stopping clears the demo timer');
  assert.equal(demoPosition, 0, 'stopping resets the fixture clock');

  const host = {};
  const signal = new AbortController().signal;
  const clock = { get: () => 2.5 };
  const commonOptions = buildVisualPreviewRuntimeOptions({
    kind: 'mode',
    value: 'tilt',
    host,
    signal,
    clock,
    theme: { primaryColor: '#fff' },
    isDaylight: false,
  });
  assert.strictEqual(commonOptions.host, host);
  assert.strictEqual(commonOptions.signal, signal);
  assert.strictEqual(commonOptions.clock, clock);
  assert.strictEqual(commonOptions.preview, true);
  assert.strictEqual(commonOptions.smartBeatEnabled, false);
  assert.equal(commonOptions.smartBeat.mode, 'off');
  assert.equal(commonOptions.smartBeat.trackKey, '');
  assert.strictEqual(commonOptions.smartBeat.timeline, null);
  assert.equal(commonOptions.smartBeat.settings.mode, 'off');
  assert.deepStrictEqual(commonOptions.smartBeat.settings.effects, {});
  assert.deepStrictEqual(commonOptions.assets, {});
  assert.equal(commonOptions.coverUrl, '');
  assert.strictEqual(commonOptions.smartBeatPlaying(), false);
  assert.strictEqual(commonOptions.rawAudioClock(), 0);
  assert.equal(commonOptions.document.itemId, 'lumasing-visual-preview');

  const urlBackgroundOptions = buildVisualPreviewRuntimeOptions({
    kind: 'background',
    value: 'url',
    host,
    signal,
    clock,
    theme: { primaryColor: '#fff' },
    isDaylight: false,
  });
  assert.deepStrictEqual(urlBackgroundOptions.background.tuning.items, []);
  assert.equal(urlBackgroundOptions.background.mode, 'url');
  assert.strictEqual(urlBackgroundOptions.preview, true);

  const scheduler = makeScheduler();
  const creations = [];
  const destroyed = [];
  const callbacks = [];
  const controller = createVisualPreviewController({
    delayMs: 180,
    setTimer: scheduler.setTimer,
    cancelScheduledTimer: scheduler.clearTimer,
    createRuntime(request, { signal: creationSignal }) {
      const result = deferred();
      creations.push({ request, signal: creationSignal, result });
      return result.promise;
    },
    onState(state) {
      callbacks.push(state.status);
    },
  });

  controller.show({ kind: 'mode', value: 'tilt', visible: true });
  assert.equal(
    creations.length,
    0,
    'runtime creation waits for the hover delay'
  );
  assert.equal(scheduler.runNext().delay, 180);
  await flush();
  assert.equal(creations.length, 1);

  controller.show({ kind: 'background', value: 'common', visible: true });
  assert.equal(
    creations[0].signal.aborted,
    true,
    'changing the hovered option aborts the previous preview creation'
  );
  scheduler.runNext();
  await flush();
  assert.equal(
    creations.length,
    1,
    'a second renderer waits until an aborted asynchronous creation settles'
  );

  creations[0].result.resolve({ destroy: () => destroyed.push('stale-mode') });
  await flush();
  assert.deepStrictEqual(destroyed, ['stale-mode']);
  assert.equal(creations.length, 2);
  creations[1].result.resolve({ destroy: () => destroyed.push('background') });
  await flush();
  assert.ok(callbacks.includes('ready'));

  controller.hide();
  assert.deepStrictEqual(
    destroyed,
    ['stale-mode', 'background'],
    'hiding the picker destroys the one active preview runtime immediately'
  );
  assert.equal(scheduler.timers.size, 0, 'hiding leaves no activation timer');

  controller.show({ kind: 'mode', value: 'sonnet', visible: true });
  controller.hide();
  assert.equal(scheduler.timers.size, 0);
  scheduler.runNext = () => {
    throw new Error('a hidden preview must not leave a pending timer');
  };
  assert.equal(
    creations.length,
    2,
    'hiding before activation starts no runtime'
  );
  controller.destroy();

  process.stdout.write('Karaoke visual preview lifecycle checks passed\n');
}

run().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
