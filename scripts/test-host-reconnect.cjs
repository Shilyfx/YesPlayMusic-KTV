'use strict';
const assert = require('assert');
const http = require('http');
const { createGateway } = require('../src/multiroom/gateway.cjs');
const { createHostConnector } = require('../src/multiroom/hostConnector.cjs');
const listen = (server, port = 0) =>
  new Promise(resolve =>
    server.listen(port, '127.0.0.1', () => resolve(server.address().port))
  );
const close = server => new Promise(resolve => server.close(resolve));
const waitFor = async predicate => {
  const deadline = Date.now() + 12000;
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error('Timed out waiting for reconnect');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
};
function trackedGateway() {
  const gateway = createGateway({
    hostCredentials: { mac: 'desktop-secret-12345' },
    pollTimeoutMs: 200,
  });
  const sockets = new Set();
  gateway.on('connection', s => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  gateway.drop = () => sockets.forEach(s => s.destroy());
  return gateway;
}
function get(url) {
  return new Promise((resolve, reject) =>
    http
      .get(url, res => {
        let data = '';
        res.on('data', chunk => {
          data += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode, data }));
      })
      .on('error', reject)
  );
}
async function run() {
  let gateway = trackedGateway();
  const port = await listen(gateway);
  const host = http.createServer((req, res) => res.end('restored'));
  const localPort = await listen(host);
  const states = [];
  const origin = `http://127.0.0.1:${port}`;
  const connector = createHostConnector({
    gatewayOrigin: origin,
    hostId: 'mac',
    hostSecret: 'desktop-secret-12345',
    localPort,
    onStatus: s => states.push(s),
  });
  try {
    await connector.start();
    gateway.drop();
    await close(gateway);
    await waitFor(() => states.includes('reconnecting'));
    gateway = trackedGateway();
    await listen(gateway, port);
    await waitFor(() => states.filter(s => s === 'connected').length >= 2);
    const response = await get(`${origin}/r/${connector.roomId}/ktv/api/state`);
    assert.equal(response.status, 200);
    assert.equal(response.data, 'restored');
    console.log('PASS: gateway restart reconnects same room');
  } finally {
    await connector.stop();
    gateway.drop();
    await Promise.all([close(gateway), close(host)]);
  }
}
run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
