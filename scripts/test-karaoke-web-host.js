const assert = require('assert');
const http = require('http');
require('./helpers/register-babel-src');
const KaraokeWebHost = require('../src/server/KaraokeWebHost').default;
const { sanitizeCoverReference } = require('../src/karaoke/lyricDisplay');

async function testLyricDocuments(host, base, call, token, snapshot) {
  const readState = () => fetch(base + '/ktv/display').then(r => r.json());
  const path = state =>
    `/ktv/display/lyrics?generation=${state.generation}&revision=${state.pvLyricsRevision}`;
  const document = {
    itemId: 'song-a',
    duration: 30,
    lines: [
      { time: 0, content: '一' },
      { time: 20, content: '尾声' },
    ],
  };
  const song = {
    ...snapshot,
    revision: 3,
    currentItem: { queueItemId: 'song-a' },
  };
  assert.equal(
    (
      await call(
        '/ktv/host/exchange',
        { snapshot: song, pvLyrics: document },
        token
      )
    ).status,
    200
  );
  const first = await readState();
  assert.ok(first.pvLyricsRevision > 0);
  assert.equal(first.pvLyricsItemId, 'song-a');
  assert.ok(
    !Object.prototype.hasOwnProperty.call(first, 'pvLyrics'),
    'heartbeat never contains full lyrics'
  );
  const res = await fetch(base + path(first));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), {
    ...document,
    revision: first.pvLyricsRevision,
  });
  assert.ok(Object.isFrozen(host.owner.pvLyrics));
  assert.ok(Object.isFrozen(host.owner.pvLyrics.lines[0]));
  const held = host.owner.pvLyrics;
  await call('/ktv/host/exchange', {}, token);
  await call('/ktv/host/exchange', { pvLyrics: document }, token);
  assert.strictEqual(
    host.owner.pvLyrics,
    held,
    'identical retry preserves stored document and revision'
  );
  assert.equal((await readState()).pvLyricsRevision, first.pvLyricsRevision);
  assert.equal(
    (await fetch(base + path(first), { method: 'POST' })).status,
    405
  );
  assert.equal((await fetch(base + '/ktv/display/lyrics')).status, 409);
  assert.equal((await fetch(base + path(first) + '0')).status, 409);
  assert.equal(
    (
      await fetch(
        base +
          path(first).replace(
            `generation=${first.generation}`,
            'generation=999999'
          )
      )
    ).status,
    409
  );
  for (const bad of [
    { ...document, itemId: 'wrong' },
    { ...document, itemId: 'x'.repeat(161) },
    { ...document, duration: -1 },
    { ...document, duration: '30' },
    { ...document, duration: 86401 },
    { ...document, lines: [{ time: -1, content: 'bad' }] },
    { ...document, lines: [{ time: 31, content: 'bad' }] },
    {
      ...document,
      lines: [
        { time: 2, content: 'b' },
        { time: 1, content: 'a' },
      ],
    },
    { ...document, lines: [{ time: 0, content: 42 }] },
    { ...document, lines: [{ time: 0, content: 'x'.repeat(4097) }] },
    {
      ...document,
      lines: Array.from({ length: 10001 }, () => ({ time: 0, content: '' })),
    },
    {
      ...document,
      lines: Array.from({ length: 100 }, () => ({
        time: 0,
        content: '字'.repeat(3000),
      })),
    },
  ]) {
    assert.equal(
      (await call('/ktv/host/exchange', { pvLyrics: bad }, token)).status,
      409
    );
    assert.strictEqual(host.owner.pvLyrics, held, 'invalid upload is atomic');
  }
  assert.equal(
    (
      await call(
        '/ktv/host/exchange',
        {
          pvLyrics: {
            ...document,
            lines: [{ time: 0, content: 'x'.repeat(1024 * 1024) }],
          },
        },
        token
      )
    ).status,
    413
  );
  const updated = { ...document, lines: [{ time: 1, content: 'changed' }] };
  await call('/ktv/host/exchange', { pvLyrics: updated }, token);
  const changed = await readState();
  assert.ok(changed.pvLyricsRevision > first.pvLyricsRevision);
  assert.equal((await fetch(base + path(first))).status, 409);
  assert.equal(
    (
      await call(
        '/ktv/host/exchange',
        {
          snapshot: {
            ...song,
            session: { ...song.session, sessionId: 'old-session' },
          },
          pvLyrics: null,
        },
        token
      )
    ).status,
    409
  );
  assert.equal(
    (await fetch(base + path(changed))).status,
    200,
    'stale session cannot clear current lyrics'
  );
  await call('/ktv/host/exchange', { pvLyrics: null }, token);
  assert.equal((await fetch(base + path(changed))).status, 409);
  await call('/ktv/host/exchange', { pvLyrics: updated }, token);
  assert.ok(
    (await readState()).pvLyricsRevision > changed.pvLyricsRevision,
    'clear/reload never reuses a revision'
  );
  const switched = {
    ...song,
    revision: 4,
    currentItem: { queueItemId: 'song-b' },
  };
  await call('/ktv/host/exchange', { snapshot: switched }, token);
  const empty = await readState();
  assert.equal(empty.pvLyricsItemId, null);
  assert.equal(empty.pvLyricsRevision, null);
  assert.equal((await fetch(base + path(changed))).status, 409);
  assert.equal(
    (await call('/ktv/host/exchange', { pvLyrics: document }, token)).status,
    409
  );
  await call(
    '/ktv/host/exchange',
    { pvLyrics: { ...document, itemId: 'song-b' } },
    token
  );
  const beforeClose = await readState();
  await call('/ktv/host/close', {}, token);
  assert.equal((await fetch(base + path(beforeClose))).status, 409);
  const reopened = await call('/ktv/host/open', {
    snapshot: song,
    pvLyrics: document,
  });
  assert.equal(reopened.status, 200);
  assert.equal(
    (await fetch(base + path(first))).status,
    409,
    'revision reuse in new room is generation protected'
  );
  const openState = await readState();
  assert.equal((await fetch(base + path(openState))).status, 200);
  assert.ok(
    !JSON.stringify(
      await fetch(base + path(openState)).then(r => r.json())
    ).includes(reopened.body.hostToken)
  );
  await call('/ktv/host/close', {}, reopened.body.hostToken);
  const invalidOpen = await call('/ktv/host/open', {
    snapshot: song,
    pvLyrics: { ...document, duration: null },
  });
  assert.equal(invalidOpen.status, 409);
  assert.equal(
    host.owner,
    null,
    'invalid initial document cannot leave a half-open room'
  );
}

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
    waitingItems: [{ trackName: '下一首测试', artists: ['测试歌手'] }],
    historyItems: [],
  };
  const presentation = {
    itemId: 'cover-item',
    title: '封面引用测试',
    artists: '测试歌手',
    coverUrl: 'https://cdn.example.test/cover.jpg?param=640y640',
    position: 0,
    playing: true,
    lines: [{ time: 0, content: '歌词' }],
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
    const appearance = {
      version: 1,
      mode: 'tilt',
      effect: 'gradient',
      fontSize: 45,
      offset: 0,
      theme: 'dark',
      animationIntensity: 'chaotic',
      background: {
        mode: 'common',
        tuning: { drift: 0.25, coverUrl: 'blob:https://example.test/cover' },
        assetId: 'blob:https://example.test/asset',
        transparent: false,
        opacity: 1,
      },
      tuningByMode: { tilt: { rotation: 8, imageData: 'A'.repeat(128) } },
      customTheme: null,
    };
    const opened = await call('/ktv/host/open', {
      snapshot,
      appearance,
      presentation,
    });
    assert.equal(opened.status, 200);
    const { hostToken, room } = opened.body;
    assert.ok(room.qrDataUrl.startsWith('data:image/png;base64,'));
    assert.ok(room.url.startsWith(origin + '/room/'));
    const display = await fetch(base + '/ktv/display').then(response =>
      response.json()
    );
    assert.equal(display.presentation.coverUrl, presentation.coverUrl);
    assert.equal(
      sanitizeCoverReference('/ktv/local/cover/local-0123456789abcdef'),
      '/ktv/local/cover/local-0123456789abcdef',
      'same-host local cover references remain usable'
    );
    assert.equal(
      sanitizeCoverReference(`https://cdn.example.test/${'x'.repeat(2048)}`),
      '',
      'oversized cover references are dropped instead of entering transport'
    );
    for (const unsafeCover of [
      'data:image/png;base64,AAAA',
      'blob:https://example.test/cover',
      'javascript:alert(1)',
      'file:///tmp/cover.png',
    ]) {
      assert.equal(
        sanitizeCoverReference(unsafeCover),
        '',
        `${unsafeCover.split(':')[0]} cover references are rejected`
      );
    }
    assert.equal(display.appearanceRevision, 1);
    assert.ok(
      !Object.prototype.hasOwnProperty.call(display, 'appearance'),
      'frequent display state exposes only the appearance revision'
    );
    const appearancePath = state =>
      `/ktv/display/appearance?generation=${state.generation}&revision=${state.appearanceRevision}`;
    const appearanceUrl = appearancePath(display);
    const appearanceResponse = await fetch(base + appearanceUrl);
    assert.equal(appearanceResponse.status, 200);
    assert.equal(appearanceResponse.headers.get('cache-control'), 'no-store');
    const fetchedAppearance = await appearanceResponse.json();
    assert.equal(fetchedAppearance.generation, display.generation);
    assert.equal(fetchedAppearance.revision, display.appearanceRevision);
    assert.equal(fetchedAppearance.config.background.mode, 'common');
    assert.equal(fetchedAppearance.config.background.assetId, null);
    assert.deepEqual(fetchedAppearance.config.background.tuning, {
      drift: 0.25,
    });
    assert.deepEqual(fetchedAppearance.config.tuningByMode, {
      tilt: { rotation: 8 },
    });
    const unchangedAppearance = await call(
      '/ktv/host/exchange',
      { appearance },
      hostToken
    );
    assert.equal(unchangedAppearance.status, 200);
    const unchangedDisplay = await fetch(base + '/ktv/display').then(response =>
      response.json()
    );
    assert.equal(
      unchangedDisplay.appearanceRevision,
      display.appearanceRevision
    );
    const backgroundOnly = {
      ...appearance,
      background: { ...appearance.background, opacity: 0.5 },
    };
    assert.equal(
      (
        await call(
          '/ktv/host/exchange',
          { appearance: backgroundOnly },
          hostToken
        )
      ).status,
      200
    );
    const changedAppearanceState = await fetch(base + '/ktv/display').then(
      response => response.json()
    );
    assert.ok(
      changedAppearanceState.appearanceRevision > display.appearanceRevision,
      'background-only change advances the independent appearance revision'
    );
    assert.deepEqual(changedAppearanceState.presentation, display.presentation);
    assert.equal((await fetch(base + appearanceUrl)).status, 409);
    assert.equal(
      (
        await fetch(base + appearancePath(changedAppearanceState), {
          method: 'POST',
        })
      ).status,
      405,
      'appearance retrieval is read-only'
    );
    const nextPresentation = {
      ...presentation,
      itemId: 'next-cover-item',
      coverUrl: '/ktv/local/cover/local-0123456789abcdef',
    };
    assert.equal(
      (
        await call(
          '/ktv/host/exchange',
          { presentation: nextPresentation },
          hostToken
        )
      ).status,
      200
    );
    const nextDisplay = await fetch(base + '/ktv/display').then(response =>
      response.json()
    );
    assert.equal(nextDisplay.presentation.itemId, 'next-cover-item');
    assert.equal(
      nextDisplay.presentation.coverUrl,
      nextPresentation.coverUrl,
      'the current presentation transports its local cover reference'
    );
    const coverlessPresentation = {
      ...nextPresentation,
      itemId: 'coverless-item',
      coverUrl: 'blob:https://example.test/stale-cover',
    };
    assert.equal(
      (
        await call(
          '/ktv/host/exchange',
          { presentation: coverlessPresentation },
          hostToken
        )
      ).status,
      200
    );
    const coverlessDisplay = await fetch(base + '/ktv/display').then(response =>
      response.json()
    );
    assert.equal(coverlessDisplay.presentation.itemId, 'coverless-item');
    assert.equal(
      coverlessDisplay.presentation.coverUrl,
      '',
      'a new track with an unsafe or absent cover cannot retain the prior track cover'
    );
    const oversizedPresentation = {
      ...presentation,
      itemId: 'oversized-cover-item',
      coverUrl: `https://cdn.example.test/${'x'.repeat(2048)}`,
    };
    assert.equal(
      (
        await call(
          '/ktv/host/exchange',
          { presentation: oversizedPresentation },
          hostToken
        )
      ).status,
      200
    );
    const oversizedDisplay = await fetch(base + '/ktv/display').then(response =>
      response.json()
    );
    assert.equal(oversizedDisplay.presentation.coverUrl, '');
    assert.equal(display.joinUrl, room.joinUrl);
    assert.ok(display.joinUrl.includes(`/room/${room.code}/#token=`));
    assert.deepEqual(display.nextTrack, {
      title: '下一首测试',
      artists: ['测试歌手'],
    });
    assert.ok(!JSON.stringify(display).includes(hostToken));
    assert.equal((await call('/ktv/host/open', { snapshot })).status, 409);
    const joinToken = new URL(display.joinUrl).hash.slice(7);
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
    const updatedQueue = {
      ...snapshot,
      revision: 2,
      waitingItems: [{ trackName: '实时下一首', artists: ['歌手二'] }],
    };
    assert.equal(
      (await call('/ktv/host/exchange', { snapshot: updatedQueue }, hostToken))
        .status,
      200
    );
    const refreshedDisplay = await fetch(base + '/ktv/display').then(response =>
      response.json()
    );
    assert.deepEqual(refreshedDisplay.nextTrack, {
      title: '实时下一首',
      artists: ['歌手二'],
    });
    assert.equal(refreshedDisplay.joinUrl, room.joinUrl);
    for (let index = 0; index < 3; index++) {
      const status = await call('/ktv/host/status', {}, hostToken);
      assert.equal(status.body.room.joinUrl, room.joinUrl);
      assert.equal(status.body.room.qrDataUrl, room.qrDataUrl);
    }
    assert.equal(
      (await call('/ktv/api/client-session', {}, joinToken)).status,
      200,
      'the original invitation still admits new devices after queue changes'
    );
    const state = await fetch(base + '/ktv/api/state', {
      headers: { Authorization: `Bearer ${guest.body.clientToken}` },
    });
    assert.equal((await state.json()).revision, 2);
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
    const endedDisplay = await fetch(base + '/ktv/display').then(response =>
      response.json()
    );
    assert.deepEqual(endedDisplay, { active: false });
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
    const replacementDisplay = await fetch(base + '/ktv/display').then(
      response => response.json()
    );
    assert.notEqual(replacementDisplay.generation, display.generation);
    assert.equal(
      (await fetch(base + appearancePath(display))).status,
      409,
      'room generation prevents an old appearance revision from resolving'
    );
    assert.notEqual(replacement.body.room.joinUrl, room.joinUrl);
    assert.equal(
      (await call('/ktv/api/client-session', {}, joinToken)).status,
      401,
      'an ended room invitation cannot enter the next room'
    );
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
    await testLyricDocuments(
      host,
      base,
      call,
      newHost.body.hostToken,
      snapshot
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
