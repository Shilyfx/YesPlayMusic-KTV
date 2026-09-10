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
  Ethernet: [{ family: 'IPv4', internal: false, address: '10.46.8.202' }],
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
  const desktopDistPath = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ktv-desktop-assets-')
  );
  fs.mkdirSync(path.join(remoteDistPath, 'js'));
  fs.mkdirSync(path.join(remoteDistPath, 'css'));
  fs.mkdirSync(path.join(desktopDistPath, 'js'));
  fs.mkdirSync(path.join(desktopDistPath, 'css'));
  fs.writeFileSync(
    path.join(remoteDistPath, 'index.html'),
    '<link href="css/remote.css"><main>room</main>'
  );
  fs.writeFileSync(
    path.join(remoteDistPath, 'js', 'remote.js'),
    'window.room=true;'
  );
  fs.writeFileSync(path.join(remoteDistPath, 'css', 'remote.css'), 'body{}');
  fs.writeFileSync(
    path.join(desktopDistPath, 'js', 'desktop.js'),
    'window.desktop=true;'
  );
  fs.writeFileSync(path.join(desktopDistPath, 'css', 'desktop.css'), 'body{}');
  const serverPort = await getAvailablePort();
  const server = new KaraokeServer({
    remoteDistPath,
    port: serverPort,
    networkInterfaces: interfaces,
  });
  const candidates = server.getLanAddressCandidates();
  assert.deepEqual(
    candidates.map(candidate => candidate.address),
    ['10.46.8.202', '192.168.8.20', '172.17.0.1']
  );
  const room = await server.startRoom({
    sessionId: 'session-test',
    lanAddress: '192.168.8.20',
  });
  assert.equal(room.name, 'Shilyfx的KTV');
  const roomUrl = new URL(room.url);
  assert.equal(roomUrl.hostname, '192.168.8.20');
  const roomToken = roomUrl.hash.slice('#token='.length);
  assert.match(roomToken, /^[A-Za-z0-9_-]{40,}$/);
  const localAudioPath = path.join(remoteDistPath, 'local-test.mp3');
  const localCoverPath = path.join(remoteDistPath, 'local-test.jpg');
  fs.writeFileSync(localAudioPath, 'local-audio');
  fs.writeFileSync(localCoverPath, 'local-cover');
  server.setLocalLibrary({
    resolve: async localId =>
      localId === 'local-0123456789abcdef'
        ? { audioPath: localAudioPath, coverPath: localCoverPath }
        : null,
  });
  const localAudio = await request(
    serverPort,
    `/ktv/local/audio/local-0123456789abcdef?token=${encodeURIComponent(
      roomToken
    )}`
  );
  assert.equal(localAudio.status, 200);
  assert.equal(localAudio.body, 'local-audio');
  const localCover = await request(
    serverPort,
    `/ktv/local/cover/local-0123456789abcdef?token=${encodeURIComponent(
      roomToken
    )}`
  );
  assert.equal(localCover.status, 200);
  assert.equal(localCover.headers['content-type'], 'image/jpeg');
  assert.equal(localCover.body, 'local-cover');
  assert.equal(
    (
      await request(
        serverPort,
        '/ktv/local/audio/local-0123456789abcdef?token=invalid'
      )
    ).status,
    404
  );
  assert.equal(
    (
      await request(
        serverPort,
        `/ktv/local/cover/local-0123456789abcdef?token=invalid`
      )
    ).status,
    404
  );

  const health = await request(serverPort, '/health');
  assert.equal(health.status, 200);
  const page = await request(serverPort, roomUrl.pathname);
  assert.equal(page.status, 200);
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
  assert.equal(page.headers['referrer-policy'], 'no-referrer');
  assert.match(page.headers['content-security-policy'], /default-src 'none'/);
  assert.equal(
    (await request(serverPort, `${roomUrl.pathname}css/remote.css`)).status,
    200
  );
  assert.equal(
    (await request(serverPort, `${roomUrl.pathname}js/remote.js`)).status,
    200
  );
  assert.equal(
    (await request(serverPort, `${roomUrl.pathname}js/desktop.js`)).status,
    404
  );
  assert.equal(
    (await request(serverPort, `${roomUrl.pathname}css/desktop.css`)).status,
    404
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

  const delayedPort = await getAvailablePort();
  const delayedServer = new KaraokeServer({
    remoteDistPath,
    port: delayedPort,
    networkInterfaces: interfaces,
    listen: (httpServer, port, host, callback) =>
      setTimeout(() => httpServer.listen(port, host, callback), 20),
  });
  const pendingStart = delayedServer.startRoom({ sessionId: 'delayed' });
  await delayedServer.stopRoom();
  await assert.rejects(() => pendingStart, /已取消/);
  assert.equal(delayedServer.state, 'idle');
  assert.equal(delayedServer.room, null);
  assert.equal(delayedServer.server, null);
  const immediateRestart = await delayedServer.startRoom({
    sessionId: 'immediate-restart',
  });
  assert.ok(immediateRestart.url);
  await delayedServer.stopRoom();

  const bundledRoot = path.join(__dirname, '..', 'dist_electron', 'bundled');
  const bundledRemote = path.join(bundledRoot, 'remote');
  if (fs.existsSync(path.join(bundledRemote, 'index.html'))) {
    const bundledPort = await getAvailablePort();
    const bundledServer = new KaraokeServer({
      remoteDistPath: bundledRemote,
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
    const asset = bundledIndex.body.match(/(?:href|src)="(css|js)\/([^"]+)"/);
    assert.ok(asset);
    assert.equal(
      (await request(bundledPort, `${bundledPath}${asset[1]}/${asset[2]}`))
        .status,
      200
    );
    const desktopJs = fs
      .readdirSync(path.join(bundledRoot, 'js'))
      .find(name => name.startsWith('index.'));
    assert.ok(desktopJs);
    assert.equal(
      (await request(bundledPort, `${bundledPath}js/${desktopJs}`)).status,
      404
    );
    const desktopCss = fs
      .readdirSync(path.join(bundledRoot, 'css'))
      .find(name => name.startsWith('index.'));
    assert.ok(desktopCss);
    assert.equal(
      (await request(bundledPort, `${bundledPath}css/${desktopCss}`)).status,
      404
    );
    await bundledServer.stopRoom();
  }
  fs.rmSync(remoteDistPath, { recursive: true, force: true });
  fs.rmSync(desktopDistPath, { recursive: true, force: true });
  console.log('KTV LAN server tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
