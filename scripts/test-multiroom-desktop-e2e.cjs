'use strict';
const assert = require('assert');
const http = require('http');
const { createGateway } = require('../src/multiroom/gateway.cjs');
const { createHostConnector } = require('../src/multiroom/hostConnector.cjs');
const {
  createDesktopPublicAdapter,
} = require('../src/multiroom/desktopPublicAdapter.cjs');
const listen = s =>
  new Promise(resolve =>
    s.listen(0, '127.0.0.1', () => resolve(s.address().port))
  );
const close = s => new Promise(resolve => s.close(resolve));
function req(url, options = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(url, options, res => {
      const chunks = [];
      res.on('data', x => chunks.push(x));
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString(),
        })
      );
    });
    r.on('error', reject);
    r.end(options.body || undefined);
  });
}
async function run() {
  const gateway = createGateway({
    hostCredentials: {
      mac: 'mac-secret-12345678',
      docker: 'docker-secret-123456',
    },
    pollTimeoutMs: 1000,
  });
  const gp = await listen(gateway);
  const origin = `http://127.0.0.1:${gp}`;
  const received = [];
  function makeRoom(name) {
    const local = {
      room: { token: name + '-lan' },
      sendRemoteAsset: (path, res) => {
        res.writeHead(200, { 'content-type': 'image/jpeg' });
        res.end(name + ':' + path);
      },
    };
    const api = {
      handle: (request, response, publicGuest) => {
        received.push([
          name,
          request.url,
          request.headers.authorization,
          publicGuest,
        ]);
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ room: name }));
      },
    };
    return http.createServer(
      createDesktopPublicAdapter({
        roomServer: local,
        remoteApi: api,
        publicOrigin: origin,
        getPublicToken: () => name + '-guest',
      })
    );
  }
  const mac = makeRoom('mac');
  const docker = makeRoom('docker');
  const [mp, dp] = await Promise.all([listen(mac), listen(docker)]);
  const a = createHostConnector({
    gatewayOrigin: origin,
    hostId: 'mac',
    hostSecret: 'mac-secret-12345678',
    localPort: mp,
  });
  const b = createHostConnector({
    gatewayOrigin: origin,
    hostId: 'docker',
    hostSecret: 'docker-secret-123456',
    localPort: dp,
  });
  try {
    await Promise.all([a.start(), b.start()]);
    const pathA = `${origin}/r/${a.roomId}`;
    const pathB = `${origin}/r/${b.roomId}`;
    const wrong = await req(pathB + '/ktv/api/client-session', {
      method: 'POST',
      headers: { origin, authorization: 'Bearer mac-guest' },
    });
    assert.equal(wrong.status, 401);
    const correct = await req(pathA + '/ktv/api/client-session', {
      method: 'POST',
      headers: { origin, authorization: 'Bearer mac-guest' },
    });
    assert.equal(correct.status, 200);
    assert.deepEqual(received.pop(), [
      'mac',
      '/ktv/api/client-session',
      'Bearer mac-lan',
      true,
    ]);
    const avatar = await req(pathB + '/room/artist-portraits/6452.jpg');
    assert.equal(avatar.status, 200);
    assert.equal(avatar.body, 'docker:/artist-portraits/6452.jpg');
    await a.stop();
    assert.equal((await req(pathA + '/ktv/api/state')).status, 410);
    console.log(
      'PASS: public guest tokens, two rooms, portrait, room shutdown'
    );
  } finally {
    await Promise.all([a.stop(), b.stop()]);
    await Promise.all([close(mac), close(docker), close(gateway)]);
  }
}
run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
