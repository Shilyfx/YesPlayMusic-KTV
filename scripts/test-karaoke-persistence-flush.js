const assert = require('assert');

require('./helpers/register-babel-src');

const saveToLocalStorage = require('../src/store/plugins/localStorage').default;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  const originalWindow = Object.getOwnPropertyDescriptor(global, 'window');
  const originalStorage = Object.getOwnPropertyDescriptor(
    global,
    'localStorage'
  );
  const storage = new Map();
  const writes = [];
  global.localStorage = {
    getItem: key => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => {
      writes.push(key);
      storage.set(key, value);
    },
  };

  try {
    const listeners = new Map();
    global.window = {
      addEventListener: (event, listener) => {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event).push(listener);
      },
    };
    const subscribers = [];
    let settingsSerializations = 0;
    let dataSerializations = 0;
    const state = {
      settings: {
        theme: 'dark',
        toJSON() {
          settingsSerializations += 1;
          return { theme: this.theme };
        },
      },
      data: {
        value: 1,
        toJSON() {
          dataSerializations += 1;
          return { value: this.value };
        },
      },
    };
    saveToLocalStorage({
      state,
      subscribe: listener => subscribers.push(listener),
    });
    const publish = type =>
      subscribers.forEach(listener => listener({ type }, state));
    const dispatch = event =>
      (listeners.get(event) || []).forEach(listener => listener());

    assert.ok(listeners.has('pagehide'));
    assert.ok(listeners.has('beforeunload'));
    publish('updateSettings');
    dispatch('beforeunload');
    assert.deepStrictEqual(writes, ['settings']);
    assert.strictEqual(settingsSerializations, 1);
    dispatch('pagehide');
    await wait(300);
    assert.deepStrictEqual(
      writes,
      ['settings'],
      'lifecycle flush should clear its timer and avoid duplicate writes'
    );

    state.settings.theme = 'light';
    state.data.value = 2;
    publish('updateSettings');
    publish('updateData');
    dispatch('pagehide');
    dispatch('beforeunload');
    assert.deepStrictEqual(writes, ['settings', 'settings', 'data']);
    assert.strictEqual(settingsSerializations, 2);
    assert.strictEqual(dataSerializations, 1);
    assert.deepStrictEqual(JSON.parse(storage.get('settings')), {
      theme: 'light',
    });
    assert.deepStrictEqual(JSON.parse(storage.get('data')), { value: 2 });
    await wait(300);
    assert.deepStrictEqual(
      writes,
      ['settings', 'settings', 'data'],
      'flushing on both exit events should serialize each pending value once'
    );

    delete global.window;
    const noWindowSubscribers = [];
    const noWindowState = { settings: {}, data: { value: 3 } };
    saveToLocalStorage({
      state: noWindowState,
      subscribe: listener => noWindowSubscribers.push(listener),
    });
    noWindowSubscribers.forEach(listener =>
      listener({ type: 'updateData' }, noWindowState)
    );
    await wait(300);
    assert.deepStrictEqual(writes, ['settings', 'settings', 'data', 'data']);
    assert.deepStrictEqual(JSON.parse(storage.get('data')), { value: 3 });
    console.log('KTV persistence flush tests passed');
  } finally {
    if (originalWindow) {
      Object.defineProperty(global, 'window', originalWindow);
    } else {
      delete global.window;
    }
    if (originalStorage) {
      Object.defineProperty(global, 'localStorage', originalStorage);
    } else {
      delete global.localStorage;
    }
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
