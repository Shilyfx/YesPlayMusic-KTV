const assert = require('assert');
const http = require('http');
require('./helpers/register-babel-src');
const KaraokeWebHost = require('../src/server/KaraokeWebHost').default;

(async () => {
  let now = 1000;
  const origin = 'http://192.168.100.1:18080';
  const host = new KaraokeWebHost({ publicOrigin: origin, now: () => now });
  const server = http.createServer((req, res) => host.handle(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const snapshot = {
    session: { sessionId: 'test-session', status: 'active' },
    revision: 1,
    currentItem: null,
    waitingItems: [],
    historyItems: [],
  };
  const call = async (path, body, token = '', requestOrigin = origin) => {
    const res = await fetch(base + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: requestOrigin,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    assert.equal(
      (await call('/ktv/host/open', { snapshot }, '', 'https://evil.test'))
        .status,
      403
    );
    const opened = await call('/ktv/host/open', { snapshot });
    assert.equal(opened.status, 200);
    const { hostToken, room } = opened.body;
    assert.ok(room.qrDataUrl.startsWith('data:image/png;base64,'));
    assert.ok(room.url.startsWith(origin + '/room/'));
    assert.equal((await call('/ktv/host/open', { snapshot })).status, 409);
    const joinToken = new URL(room.url).hash.slice(7);
    const guest = await call('/ktv/api/client-session', {}, joinToken);
    assert.equal(guest.status, 200);
    assert.ok(!JSON.stringify(guest.body).includes(hostToken));
    assert.equal(
      (await call('/ktv/host/exchange', {}, guest.body.clientToken)).status,
      401
    );
    const pending = host.command('next', {
      expected: { sessionId: 'test-session' },
    });
    const first = await call('/ktv/host/exchange', {}, hostToken);
    assert.equal(first.body.commands.length, 1);
    const retry = await call('/ktv/host/exchange', {}, hostToken);
    assert.equal(retry.body.commands[0].id, first.body.commands[0].id);
    const ack = await call(
      '/ktv/host/exchange',
      {
        results: [
          {
            id: first.body.commands[0].id,
            ok: true,
            result: 'next-ok',
          },
        ],
        snapshot,
      },
      hostToken
    );
    assert.equal(await pending, 'next-ok');
    assert.equal(ack.body.commands.length, 0);
    const state = await fetch(base + '/ktv/api/state', {
      headers: { Authorization: `Bearer ${guest.body.clientToken}` },
    });
    assert.equal((await state.json()).revision, 1);
    assert.equal(
      (
        await call(
          '/ktv/host/exchange',
          {
            snapshot: {
              ...snapshot,
              session: { ...snapshot.session, sessionId: 'wrong' },
            },
          },
          hostToken
        )
      ).status,
      409
    );
    now += 90001;
    assert.equal((await call('/ktv/host/exchange', {}, hostToken)).status, 401);
    assert.equal(host.roomServer.room, null);
    assert.equal(
      (
        await fetch(base + '/ktv/api/state', {
          headers: { Authorization: `Bearer ${guest.body.clientToken}` },
        })
      ).status,
      410
    );
    const replacement = await call('/ktv/host/open', { snapshot });
    assert.equal(replacement.status, 200);
    const orphan = host.command('snapshot').catch(e => e.message);
    assert.equal(
      (await call('/ktv/host/close', {}, replacement.body.hostToken)).status,
      200
    );
    assert.equal(await orphan, 'ROOM_ENDED');
    const competing = await Promise.all([
      call('/ktv/host/open', { snapshot }),
      call('/ktv/host/open', { snapshot }),
    ]);
    assert.deepEqual(
      competing.map(r => r.status).sort(),
      [200, 409],
      'simultaneous browser hosts must not replace each other'
    );
    const winner = competing.find(r => r.status === 200).body;
    const lateClose = http.request(base + '/ktv/host/close', {
      method: 'POST',
      headers: {
        Origin: origin,
        Authorization: `Bearer ${winner.hostToken}`,
        'Content-Type': 'application/json',
        'Content-Length': 2,
      },
    });
    const lateResponse = new Promise(resolve =>
      lateClose.on('response', res => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      })
    );
    lateClose.write('{');
    await new Promise(resolve => setTimeout(resolve, 20));
    await call('/ktv/host/close', {}, winner.hostToken);
    const newHost = await call('/ktv/host/open', { snapshot });
    lateClose.end('}');
    assert.equal(
      await lateResponse,
      401,
      'late body must revalidate ownership'
    );
    assert.equal(
      (await call('/ktv/host/status', {}, newHost.body.hostToken)).status,
      200
    );
    console.log('KTV web host HTTP/token/QR/mailbox/expiry tests passed');
  } finally {
    host.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
