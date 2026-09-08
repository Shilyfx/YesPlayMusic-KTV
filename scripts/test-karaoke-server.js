const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
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

const interfaces = () => ({
  WiFi: [{ family: 'IPv4', internal: false, address: '192.168.8.20' }],
  Docker: [{ family: 'IPv4', internal: false, address: '172.17.0.1' }],
});

function request(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}${pathname}`, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => (body += chunk));
      response.on('end', () =>
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body,
        })
      );
    });
    req.on('error', reject);
  });
}

function getAvailablePort() {
  return new Promise(resolve => {
    const probe = http.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const value = probe.address().port;
      probe.close(() => resolve(value));
    });
  });
}

async function run() {
  const remoteDistPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ktv-remote-'));
  const remoteAssetRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ktv-remote-assets-')
  );
  fs.mkdirSync(path.join(remoteDistPath, 'js'));
  fs.mkdirSync(path.join(remoteAssetRoot, 'css'));
  fs.writeFileSync(
    path.join(remoteDistPath, 'index.html'),
    '<link href="app://./css/fallback.css"><main>room</main>'
  );
  fs.writeFileSync(
    path.join(remoteDistPath, 'js', 'remote.js'),
    'window.room=true;'
  );
  fs.writeFileSync(path.join(remoteAssetRoot, 'css', 'fallback.css'), 'body{}');
  const serverPort = await getAvailablePort();
  const server = new KaraokeServer({
    remoteDistPath,
    port: serverPort,
    networkInterfaces: interfaces,
    remoteAssetRoot,
  });
  const room = await server.startRoom({ sessionId: 'session-test' });
  const roomUrl = new URL(room.url);

  const health = await request(serverPort, '/health');
  assert.equal(health.status, 200);
  const page = await request(serverPort, roomUrl.pathname);
  assert.equal(page.status, 200);
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
  assert.equal(page.headers['referrer-policy'], 'no-referrer');
  assert.match(page.headers['content-security-policy'], /default-src 'none'/);
  assert.equal(page.body.includes('app://'), false);
  assert.equal(
    (await request(serverPort, `${roomUrl.pathname}css/fallback.css`)).status,
    200
  );
  assert.equal(
    (await request(serverPort, `${roomUrl.pathname}js/remote.js`)).status,
    200
  );
  assert.equal((await request(serverPort, '/room/not-a-room')).status, 404);
  assert.equal((await request(serverPort, '/api')).status, 404);
  assert.equal((await request(serverPort, '/player')).status, 404);
  assert.equal((await request(serverPort, '/js/app.js')).status, 404);
  const traversalResponse = {
    writeHead(status) {
      this.status = status;
    },
    end() {},
  };
  await server.sendStaticAsset(
    remoteDistPath,
    '../index.html',
    traversalResponse
  );
  assert.equal(traversalResponse.status, 404);

  await server.stopRoom();
  await assert.rejects(() => request(serverPort, roomUrl.pathname));
  assert.equal(await server.describeRoom(), null);

  const restarted = await server.startRoom({ sessionId: 'session-test-2' });
  assert.notEqual(restarted.url, room.url);
  assert.equal((await request(serverPort, roomUrl.pathname)).status, 404);
  assert.equal(
    (await request(serverPort, new URL(restarted.url).pathname)).status,
    200
  );
  await server.stopRoom();

  const busyPort = await getAvailablePort();
  const blocker = http.createServer();
  await new Promise(resolve => blocker.listen(busyPort, '0.0.0.0', resolve));
  const busyServer = new KaraokeServer({
    remoteDistPath,
    port: busyPort,
    networkInterfaces: interfaces,
  });
  await assert.rejects(
    () => busyServer.startRoom({ sessionId: 'busy' }),
    /EADDRINUSE/
  );
  assert.equal(await busyServer.describeRoom(), null);
  assert.equal(busyServer.server, null);
  await new Promise(resolve => blocker.close(resolve));
  const afterRetry = await busyServer.startRoom({ sessionId: 'retry' });
  assert.ok(afterRetry.url);
  await busyServer.stopRoom();

  const racePort = await getAvailablePort();
  const raceServer = new KaraokeServer({
    remoteDistPath,
    port: racePort,
    networkInterfaces: interfaces,
  });
  const firstStart = raceServer.startRoom({ sessionId: 'race' });
  const secondStart = raceServer.startRoom({ sessionId: 'race' });
  const [firstRoom, secondRoom] = await Promise.all([firstStart, secondStart]);
  assert.equal(firstRoom.url, secondRoom.url);
  await raceServer.stopRoom();
  assert.equal(raceServer.state, 'idle');
  assert.equal(raceServer.room, null);
  assert.equal(raceServer.server, null);

  const bundledRoot = path.join(__dirname, '..', 'dist_electron', 'bundled');
  const bundledRemote = path.join(bundledRoot, 'remote');
  if (fs.existsSync(path.join(bundledRemote, 'index.html'))) {
    const bundledPort = await getAvailablePort();
    const bundledServer = new KaraokeServer({
      remoteDistPath: bundledRemote,
      remoteAssetRoot: bundledRoot,
      port: bundledPort,
      networkInterfaces: interfaces,
    });
    const bundledRoom = await bundledServer.startRoom({
      sessionId: 'bundled-assets',
    });
    const bundledPath = new URL(bundledRoom.url).pathname;
    const bundledIndex = await request(bundledPort, bundledPath);
    assert.equal(bundledIndex.status, 200);
    assert.equal(bundledIndex.body.includes('app://'), false);
    const asset = bundledIndex.body.match(/(?:href|src)="(css|js)\/([^\"]+)"/);
    assert.ok(asset);
    assert.equal(
      (await request(bundledPort, `${bundledPath}${asset[1]}/${asset[2]}`))
        .status,
      200
    );
    await bundledServer.stopRoom();
  }
  fs.rmSync(remoteDistPath, { recursive: true, force: true });
  fs.rmSync(remoteAssetRoot, { recursive: true, force: true });
  console.log('KTV LAN server tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
