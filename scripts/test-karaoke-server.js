const assert = require('assert');
const http = require('http');
const path = require('path');
const babel = require('@babel/core');

const originalJsLoader = require.extensions['.js'];
require.extensions['.js'] = function transpileKaraokeServer(module, filename) {
  if (
    !filename.includes(`${path.sep}src${path.sep}electron${path.sep}karaoke`)
  ) {
    return originalJsLoader(module, filename);
  }
  const result = babel.transformFileSync(filename, {
    presets: ['@vue/cli-plugin-babel/preset'],
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  });
  module._compile(result.code, filename);
};

const { KaraokeServer } = require('../src/electron/karaoke/KaraokeServer');

function request(pathname) {
  return new Promise((resolve, reject) => {
    const request = http.get(`http://127.0.0.1:27233${pathname}`, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
  });
}

async function run() {
  const server = new KaraokeServer({
    remoteDistPath: path.resolve(__dirname, '..', 'dist', 'remote'),
    publicDistPath: path.resolve(__dirname, '..', 'dist'),
  });
  const room = await server.startRoom();
  const roomUrl = new URL(room.url);

  assert.equal(await request('/health'), 200);
  assert.equal(await request(`${roomUrl.pathname}${roomUrl.search}`), 200);
  assert.equal(await request(roomUrl.pathname), 404);
  assert.equal(await request('/room/not-a-room?token=invalid'), 404);

  await server.stopRoom();
  console.log('KTV LAN server tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
