const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { createRequire } = require('module');
const babel = require('@babel/core');
require('./helpers/register-babel-src');
const filename = path.resolve('src/views/karaokeWeb.vue');
const script = fs
  .readFileSync(filename, 'utf8')
  .match(/<script>([\s\S]*?)<\/script>/)[1];
const code = babel.transformSync(script, {
  filename,
  presets: ['@vue/cli-plugin-babel/preset'],
  plugins: ['@babel/plugin-transform-modules-commonjs'],
}).code;
const moduleObject = { exports: {} };
const localRequire = createRequire(filename);
vm.runInNewContext(code, {
  module: moduleObject,
  exports: moduleObject.exports,
  require: name =>
    name.endsWith('.vue')
      ? {}
      : name === 'howler'
      ? { Howler: { mute() {} } }
      : localRequire(name),
  clearInterval,
  setInterval,
  clearTimeout,
  setTimeout,
  document: { hidden: false, removeEventListener() {} },
  window: { removeEventListener() {} },
});
const component = moduleObject.exports.default;
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  let stopped = 0;
  const instance = {
    ...component.methods,
    $route: { name: 'home' },
    $nextTick: async () => {},
    $refs: {},
    $store: {
      dispatch() {},
      state: {
        player: { pause() {}, _initMediaSession() {} },
        webKtvDisplayOnly: false,
      },
      $karaokeManager: {
        endSession() {
          stopped++;
        },
      },
      $initializePlayerOnce() {},
    },
    poller: { stop() {} },
    visibilityHandler() {},
  };
  // Vue binds data() to the instance, including the injected store. Keep that
  // contract when testing the unavailable-storage notification path in Node.
  Object.assign(instance, component.data.call(instance));
  instance.poller = { stop() {} };
  instance.visibilityHandler = () => {};
  return { instance, stops: () => stopped };
}
(async () => {
  const first = fixture();
  first.instance.isMaster = true;
  component.beforeDestroy.call(first.instance);
  assert.equal(
    first.stops(),
    1,
    'leaving master route must synchronously stop audio/session before releasing owner'
  );
  const next = fixture();
  let releaseCandidates;
  let opens = 0;
  next.instance.$refs.master = {
    enableBrowserAudio() {},
    loadLanCandidates: () =>
      new Promise(resolve => {
        releaseCandidates = resolve;
      }),
    startLanRoom: async () => {
      opens++;
      return { ok: true };
    },
    webRoomBridge: { dispose: async () => {} },
  };
  const pending = next.instance.chooseMaster();
  await flush();
  component.beforeDestroy.call(next.instance);
  releaseCandidates();
  await pending;
  assert.equal(
    opens,
    0,
    'destroyed selection must not open an orphan host after candidate await'
  );
  console.log(
    'Docker master route-exit and pending-claim teardown tests passed'
  );
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
