const assert = require('assert');

require('./helpers/register-babel-src');

const saveToLocalStorage = require('../src/store/plugins/localStorage').default;

const storage = new Map();
global.localStorage = {
  getItem: key => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, value),
};

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  const subscribers = [];
  const state = { settings: { theme: 'dark' }, data: { user: { id: 1 } } };
  saveToLocalStorage({
    state,
    subscribe: listener => subscribers.push(listener),
  });
  const publish = type =>
    subscribers.forEach(listener => listener({ type }, state));

  publish('replaceKaraokeState');
  await wait(300);
  assert.strictEqual(
    storage.size,
    0,
    'KTV state changes must not write settings/data'
  );

  state.settings.theme = 'light';
  publish('updateSettings');
  publish('updateSettings');
  await wait(300);
  assert.strictEqual(storage.size, 1);
  assert.strictEqual(JSON.parse(storage.get('settings')).theme, 'light');

  state.data.user.id = 2;
  publish('updateData');
  await wait(300);
  assert.strictEqual(storage.size, 2);
  assert.strictEqual(JSON.parse(storage.get('data')).user.id, 2);
  console.log('Store persistence batching tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
