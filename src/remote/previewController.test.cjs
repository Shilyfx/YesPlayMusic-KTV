'use strict';

const assert = require('assert');

let previewModule;
try {
  previewModule = require('./previewController.cjs');
} catch (error) {
  if (error.code === 'MODULE_NOT_FOUND')
    assert.fail('remote preview controller module should be available');
  throw error;
}

const { createPreviewController, previewPlayerMarkup } = previewModule;

function createElement({ paused = true, hidden = false, dataset = {} } = {}) {
  const listeners = {};
  const attributes = {};
  const classes = new Set();
  return {
    paused,
    hidden,
    dataset,
    attributes,
    classList: {
      add(name) {
        classes.add(name);
      },
      remove(name) {
        classes.delete(name);
      },
      toggle(name, force) {
        const enabled = force === undefined ? !classes.has(name) : force;
        if (enabled) classes.add(name);
        else classes.delete(name);
        return enabled;
      },
      contains(name) {
        return classes.has(name);
      },
    },
    addEventListener(name, callback) {
      (listeners[name] || (listeners[name] = [])).push(callback);
    },
    emit(name) {
      (listeners[name] || []).forEach(callback => callback());
    },
    setAttribute(name, value) {
      attributes[name] = String(value);
    },
    removeAttribute(name) {
      delete attributes[name];
      if (name === 'src') this.src = '';
    },
    loadCount: 0,
    load() {
      this.loadCount += 1;
    },
    play() {
      this.paused = false;
      this.emit('play');
      return Promise.resolve();
    },
    pause() {
      this.paused = true;
      this.emit('pause');
    },
  };
}

function createHarness({ api } = {}) {
  const audio = createElement({ paused: true });
  const player = createElement({ hidden: true });
  const title = createElement();
  const toggle = createElement();
  const previewButtons = [
    createElement({ dataset: { preview: 'track-1' } }),
    createElement({ dataset: { preview: 'track-2' } }),
  ];
  const selectors = {
    '[data-preview-audio]': audio,
    '[data-preview-float]': player,
    '[data-preview-title]': title,
    '[data-preview-toggle]': toggle,
  };
  const app = {
    querySelector(selector) {
      return selectors[selector] || null;
    },
    querySelectorAll(selector) {
      return selector === '[data-preview]' ? previewButtons : [];
    },
  };
  const notices = [];
  const requests = [];
  const controller = createPreviewController({
    app,
    api:
      api ||
      (path => {
        requests.push(path);
        return Promise.resolve({ url: `https://preview.test${path}.mp3` });
      }),
    findTrack: id => ({ id, name: `Title ${id}` }),
    escape: value =>
      String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;'),
    setNotice: (message, kind) => notices.push({ message, kind }),
  });
  controller.bind();
  return {
    audio,
    player,
    title,
    toggle,
    previewButtons,
    notices,
    requests,
    controller,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function testPreviewMarkupKeepsExistingPlayerSelectorsAndControls() {
  assert.match(
    previewPlayerMarkup,
    /class="preview-float" data-preview-float hidden/
  );
  assert.match(previewPlayerMarkup, /data-preview-toggle="true"/);
  assert.match(previewPlayerMarkup, /data-preview-stop="true"/);
  assert.match(previewPlayerMarkup, /data-preview-audio preload="none"/);
}

async function testPreviewLoadsTrackAndUpdatesFloatingAndCardControls() {
  const harness = createHarness();
  await harness.controller.previewTrack('track-1');

  assert.deepStrictEqual(harness.requests, ['/track/track-1/preview']);
  assert.strictEqual(
    harness.audio.src,
    'https://preview.test/track/track-1/preview.mp3'
  );
  assert.strictEqual(harness.title.textContent, 'Title track-1');
  assert.strictEqual(harness.player.hidden, false);
  assert.strictEqual(harness.audio.paused, false);
  assert.strictEqual(harness.toggle.textContent, 'Ⅱ');
  assert.strictEqual(harness.toggle.attributes['aria-label'], '暂停试听');
  assert.strictEqual(harness.previewButtons[0].textContent, '暂停试听');
  assert.strictEqual(
    harness.previewButtons[0].attributes['aria-pressed'],
    'true'
  );
  assert.strictEqual(
    harness.previewButtons[0].classList.contains('active'),
    true
  );
  assert.strictEqual(harness.previewButtons[1].textContent, '试听');
  assert.deepStrictEqual(harness.notices[harness.notices.length - 1], {
    message: '正在试听，可使用播放器控制音量。',
    kind: 'success',
  });
}

async function testCurrentPreviewCanPauseResumeAndStop() {
  const harness = createHarness();
  await harness.controller.previewTrack('track-1');

  await harness.controller.previewTrack('track-1');
  assert.strictEqual(harness.audio.paused, true);
  assert.strictEqual(
    harness.previewButtons[0].attributes['aria-pressed'],
    'true'
  );
  assert.strictEqual(harness.toggle.textContent, '▶');

  harness.controller.togglePlayback();
  assert.strictEqual(harness.audio.paused, false);
  assert.strictEqual(harness.toggle.textContent, 'Ⅱ');

  harness.controller.stopPreview();
  assert.strictEqual(harness.audio.paused, true);
  assert.strictEqual(harness.audio.src, '');
  assert.strictEqual(harness.player.hidden, true);
  assert.strictEqual(harness.previewButtons[0].textContent, '试听');
  assert.strictEqual(
    harness.previewButtons[0].attributes['aria-pressed'],
    'false'
  );
}

async function testLatePreviewResponseCannotReplaceNewerSelection() {
  const first = deferred();
  const second = deferred();
  const harness = createHarness({
    api: path => {
      harnessRequests.push(path);
      return path.includes('track-1') ? first.promise : second.promise;
    },
  });
  const harnessRequests = [];

  const firstPreview = harness.controller.previewTrack('track-1');
  const secondPreview = harness.controller.previewTrack('track-2');
  second.resolve({ url: 'https://preview.test/track-2.mp3' });
  await secondPreview;
  first.resolve({ url: 'https://preview.test/track-1.mp3' });
  await firstPreview;

  assert.deepStrictEqual(harnessRequests, [
    '/track/track-1/preview',
    '/track/track-2/preview',
  ]);
  assert.strictEqual(harness.audio.src, 'https://preview.test/track-2.mp3');
  assert.strictEqual(harness.title.textContent, 'Title track-2');
  assert.strictEqual(
    harness.previewButtons[0].attributes['aria-pressed'],
    'false'
  );
  assert.strictEqual(
    harness.previewButtons[1].attributes['aria-pressed'],
    'true'
  );
}

async function testPreviewFailureShowsExistingNoticeAndClearsSelection() {
  const failure = new Error('not playable');
  failure.code = 'TRACK_NOT_PLAYABLE';
  const harness = createHarness({ api: () => Promise.reject(failure) });

  await harness.controller.previewTrack('track-1');

  assert.strictEqual(harness.player.hidden, true);
  assert.strictEqual(harness.previewButtons[0].textContent, '试听');
  assert.deepStrictEqual(harness.notices[harness.notices.length - 1], {
    message: '这首歌暂时没有可用试听音源。',
    kind: 'error',
  });
}

async function testEndedAudioHidesPlayerAndClearsActiveButtons() {
  const harness = createHarness();
  await harness.controller.previewTrack('track-1');

  harness.audio.paused = true;
  harness.audio.emit('ended');

  assert.strictEqual(harness.player.hidden, true);
  assert.strictEqual(harness.previewButtons[0].textContent, '试听');
  assert.strictEqual(
    harness.previewButtons[0].attributes['aria-pressed'],
    'false'
  );
  assert.strictEqual(harness.toggle.textContent, '▶');
}

(async () => {
  await testPreviewMarkupKeepsExistingPlayerSelectorsAndControls();
  await testPreviewLoadsTrackAndUpdatesFloatingAndCardControls();
  await testCurrentPreviewCanPauseResumeAndStop();
  await testLatePreviewResponseCannotReplaceNewerSelection();
  await testPreviewFailureShowsExistingNoticeAndClearsSelection();
  await testEndedAudioHidesPlayerAndClearsActiveButtons();
  console.log('PASS: remote preview controller and UI behavior');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
