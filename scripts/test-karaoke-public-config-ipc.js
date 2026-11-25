const assert = require('assert');
const Module = require('module');
const os = require('os');
require('./helpers/register-babel-src');

const handlers = new Map();
const electron = {
  app: { getPath: () => os.tmpdir() },
  dialog: {},
  globalShortcut: { unregisterAll() {} },
  ipcMain: {
    handle(name, callback) {
      handlers.set(name, callback);
    },
    on() {},
  },
  shell: {},
};
const originalLoad = Module._load;
Module._load = function loadWithElectronMocks(request, parent, isMain) {
  if (request === 'electron') return electron;
  if (request === 'discord-rich-presence')
    return () => ({ updatePresence() {} });
  if (request === '@/electron/globalShortcut')
    return { registerGlobalShortcut() {} };
  if (request === './menu') return { createMenu() {} };
  return originalLoad.call(this, request, parent, isMain);
};

let initIpcMain;
try {
  ({ initIpcMain } = require('../src/electron/ipcMain'));
} finally {
  Module._load = originalLoad;
}

const persisted = new Map([
  [
    'settings.karaokePublicRoom',
    {
      gatewayOrigin: 'https://ktv.-shilyfx.icu/',
      hostId: 'desktop-host',
      hostSecret: 'kept-secret',
    },
  ],
]);
const storeWrites = [];
const store = {
  get(key, fallback) {
    return persisted.has(key) ? persisted.get(key) : fallback;
  },
  set(key, value) {
    storeWrites.push({ key, value });
    persisted.set(key, value);
  },
};
const karaokeServer = {
  room: { code: 'LIVE' },
  state: 'active',
  setPublicConfig(config) {
    this.config = config;
  },
  getPublicConfigState() {
    return {
      gatewayOrigin: this.config.gatewayOrigin,
      hostId: this.config.hostId,
      hasHostSecret: Boolean(this.config.hostSecret),
    };
  },
  setPublicStatusListener() {},
  setLocalLibrary() {},
  setRemoteApi() {},
};
const win = {
  webContents: {
    on() {},
  },
};

initIpcMain(win, store, { on() {} }, karaokeServer);

const savedConfig = persisted.get('settings.karaokePublicRoom');
assert.equal(savedConfig.gatewayOrigin, 'https://ktv.shilyfx.icu');
assert.equal(savedConfig.hostSecret, 'kept-secret');
assert.ok(
  storeWrites.some(write => write.value.gatewayOrigin === 'https://ktv.shilyfx.icu'),
  'legacy gateway address is persisted in its corrected form'
);

async function run() {
  const setConfig = handlers.get('karaoke:public:config:set');
  const result = await setConfig(null, {
    gatewayOrigin: 'https://custom.example',
    hostId: 'next-host',
    clearHostSecret: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.config.gatewayOrigin, 'https://custom.example');
  assert.equal(persisted.get('settings.karaokePublicRoom').hostSecret, '');

  karaokeServer.state = 'starting';
  const duringStart = await setConfig(null, {
    gatewayOrigin: 'https://another.example',
    hostId: 'another-host',
  });
  assert.deepEqual(duringStart, { ok: false, error: 'PUBLIC_ROOM_ACTIVE' });

  process.stdout.write('Karaoke public config IPC tests passed\n');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
