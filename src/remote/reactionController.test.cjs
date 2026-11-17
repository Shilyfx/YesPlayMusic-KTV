'use strict';

const assert = require('assert');
const { createReactionController } = require('./reactionController.cjs');

function createElement({
  dataset = {},
  attributes = [],
  value = '',
  hidden = false,
} = {}) {
  const listeners = {};
  const attributeValues = {};
  const classes = new Set();
  attributes.forEach(name => {
    attributeValues[name] = '';
  });
  return {
    dataset,
    value,
    hidden,
    disabled: false,
    isConnected: true,
    textContent: '',
    innerHTML: '',
    attributes: attributeValues,
    classList: {
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
    emit(name, event = {}) {
      (listeners[name] || []).forEach(callback =>
        callback({ target: this, ...event })
      );
    },
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attributeValues, name);
    },
    setAttribute(name, value) {
      attributeValues[name] = String(value);
    },
    focus() {
      this.focused = true;
    },
  };
}

function createHarness({
  clientToken = 'client-token',
  apiResult,
  apiError,
} = {}) {
  const characters = [
    createElement({
      dataset: { characterChoice: 'ball' },
      attributes: ['data-character-choice'],
    }),
    createElement({
      dataset: { characterChoice: 'cloud' },
      attributes: ['data-character-choice'],
    }),
  ];
  const effects = [
    createElement({
      dataset: { effectChoice: 'bounce' },
      attributes: ['data-effect-choice'],
    }),
    createElement({
      dataset: { effectChoice: 'float' },
      attributes: ['data-effect-choice'],
    }),
  ];
  const reactionButton = createElement({
    dataset: { reaction: 'emotion', emotionId: '10' },
  });
  const customEditor = createElement({ hidden: true });
  const customInput = createElement();
  const customCount = createElement();
  const customButton = createElement({ attributes: ['data-custom-reaction'] });
  const moreEffects = createElement({ hidden: true });
  const feedback = createElement();
  const reactionGrid = createElement();
  const previews = [
    createElement({ dataset: { reactionPreview: '10' } }),
    createElement({
      dataset: { reactionPreview: '10', previewCharacter: 'cloud' },
    }),
  ];
  const selectors = {
    '[data-reaction-custom-editor]': customEditor,
    '[data-reaction-custom-text]': customInput,
    '[data-reaction-text-count]': customCount,
    '[data-custom-reaction]': customButton,
    '[data-more-reaction-effects]': moreEffects,
    '[data-reaction-feedback]': feedback,
    '.reaction-grid': reactionGrid,
  };
  const appListeners = {};
  const app = {
    querySelector(selector) {
      return selectors[selector] || null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-character-choice]') return characters;
      if (selector === '[data-effect-choice]') return effects;
      if (selector === '[data-reaction-preview]') return previews;
      return [];
    },
    addEventListener(name, callback) {
      (appListeners[name] || (appListeners[name] = [])).push(callback);
    },
    click(button) {
      (appListeners.click || []).forEach(callback =>
        callback({ target: { closest: () => button } })
      );
    },
  };
  const requests = [];
  const notices = [];
  const timers = [];
  const previewsCreated = [];
  const createPreviewLibrary = character => ({
    create(node, options) {
      previewsCreated.push({ character, options });
      node.innerHTML = `<svg data-character="${character}"></svg>`;
      return { destroy() {} };
    },
  });
  const controller = createReactionController({
    app,
    api(path, options) {
      requests.push({ path, options });
      if (apiError) return Promise.reject(apiError);
      return Promise.resolve(
        apiResult || { status: 'queued', queuePosition: 2 }
      );
    },
    getClientToken: () => clientToken,
    setNotice: (message, kind) => notices.push({ message, kind }),
    escape: value =>
      String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;'),
    normalizeReactionText: value => String(value || '').trim(),
    resolveReaction: () => ({ label: '开心' }),
    ktvReactionChoices: [
      { kind: 'emotion', emotion: '10', label: '开心', caption: '送上开心' },
    ],
    reactionCharacters: [
      { id: 'ball', label: '球球' },
      { id: 'cloud', label: '云宝' },
    ],
    reactionEffects: [
      { id: 'bounce', label: '弹跳', caption: '轻快', sketch: 'bounce' },
      { id: 'float', label: '漂浮', caption: '温柔', sketch: 'float' },
    ],
    loadEmotionBall: () => Promise.resolve(createPreviewLibrary('ball')),
    loadMoodMates: () => Promise.resolve(createPreviewLibrary('cloud')),
    random: () => 0,
    setTimeout: callback => timers.push(callback),
  });
  return {
    app,
    characters,
    effects,
    reactionButton,
    customEditor,
    customInput,
    customCount,
    customButton,
    moreEffects,
    feedback,
    previews,
    requests,
    notices,
    timers,
    previewsCreated,
    controller,
  };
}

async function testMarkupKeepsReactionStudioControlsAndModuleTab() {
  const { controller } = createHarness();
  const markup = controller.studioMarkup();

  assert.match(markup, /class="reaction-studio glass" aria-label="互动应援"/);
  assert.match(markup, /data-character-choice="ball"/);
  assert.match(markup, /data-effect-choice="bounce"/);
  assert.match(markup, /data-custom-reaction/);
  assert.match(markup, /data-reaction="emotion" data-emotion-id="10"/);
  assert.match(markup, /data-reaction-feedback/);
  assert.match(controller.tabMarkup(), /data-module-tab="reactions">互动应援/);
}

async function testSelectionCustomTextAndReactionRequestKeepExistingBehavior() {
  const harness = createHarness();
  harness.controller.bind();

  harness.app.click(harness.characters[1]);
  harness.app.click(harness.effects[1]);
  harness.app.click(harness.customButton);
  assert.strictEqual(harness.customEditor.hidden, false);
  assert.strictEqual(harness.customInput.focused, true);
  harness.customInput.value = '  今晚一起唱  ';
  harness.customInput.emit('input');
  assert.strictEqual(harness.customCount.textContent, '9 / 40');
  assert.strictEqual(harness.customButton.textContent, '自定义内容 · 使用中');

  harness.app.click(harness.reactionButton);
  await harness.requests[0].options.body;
  await Promise.resolve();

  assert.strictEqual(harness.requests[0].path, '/reactions');
  assert.strictEqual(harness.requests[0].options.method, 'POST');
  assert.deepStrictEqual(JSON.parse(harness.requests[0].options.body), {
    kind: 'emotion',
    effect: 'float',
    character: 'cloud',
    emotionId: '10',
    customText: '今晚一起唱',
  });
  assert.deepStrictEqual(harness.notices[harness.notices.length - 1], {
    message: '已加入排队（第 2 位），即将登场',
    kind: 'success',
  });
  assert.strictEqual(
    harness.feedback.textContent,
    '排队中「今晚一起唱」· 第 2 位等待登场'
  );
  assert.strictEqual(harness.reactionButton.disabled, true);
  harness.timers[0]();
  assert.strictEqual(harness.reactionButton.disabled, false);
}

async function testReactionErrorsKeepExistingNoticesAndRequireRoomToken() {
  const limited = createHarness({ apiError: { code: 'RATE_LIMIT' } });
  limited.controller.bind();
  limited.app.click(limited.reactionButton);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepStrictEqual(limited.notices[limited.notices.length - 1], {
    message: '发送太快，请稍后再试',
    kind: 'error',
  });

  const disconnected = createHarness({ clientToken: '' });
  disconnected.controller.bind();
  disconnected.app.click(disconnected.reactionButton);
  assert.strictEqual(disconnected.requests.length, 0);
  assert.deepStrictEqual(disconnected.notices[0], {
    message: '正在连接房间，请稍后再试',
    kind: 'error',
  });
}

async function testPreviewsUseSelectedCharacterAndPerNodeCharacterOverrides() {
  const harness = createHarness();
  harness.controller.bind();
  await harness.controller.loadPreviews();

  assert.deepStrictEqual(
    harness.previewsCreated.map(({ character, options }) => [
      character,
      options.emotion,
      options.autostart,
      options.idle,
      options.lite,
    ]),
    [
      ['ball', '10', false, false, true],
      ['cloud', '10', false, false, true],
    ]
  );
  assert.deepStrictEqual(
    harness.previews.map(node => node.dataset.rendered),
    ['ball:10', 'cloud:10']
  );
}

async function run() {
  await testMarkupKeepsReactionStudioControlsAndModuleTab();
  await testSelectionCustomTextAndReactionRequestKeepExistingBehavior();
  await testReactionErrorsKeepExistingNoticesAndRequireRoomToken();
  await testPreviewsUseSelectedCharacterAndPerNodeCharacterOverrides();
  console.log('PASS: remote reaction controller');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
