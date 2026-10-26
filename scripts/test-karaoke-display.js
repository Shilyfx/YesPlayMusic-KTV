const assert = require('assert');
const http = require('http');
require('./helpers/register-babel-src');
const KaraokeWebHost = require('../src/server/KaraokeWebHost').default;

(async () => {
  let now = 10000;
  const origin = 'http://router';
  const host = new KaraokeWebHost({ publicOrigin: origin, now: () => now });
  const server = http.createServer((req, res) => host.handle(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const read = async () => {
    const response = await fetch(base + '/ktv/display');
    assert.equal(response.status, 200);
    return response.json();
  };
  const post = async (action, body, token = '') => {
    const response = await fetch(base + '/ktv/host/' + action, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const snapshot = {
    session: { sessionId: 's', status: 'active' },
    revision: 1,
    currentItem: null,
    waitingItems: [],
    historyItems: [],
  };
  const presentation = {
    itemId: 'item1',
    title: '测试歌曲',
    artists: '测试歌手',
    position: 20,
    playing: true,
    offset: 0,
    mode: 'orbit',
    effect: 'solid',
    theme: 'dark',
    fontSize: 45,
    lines: [
      { time: 19, content: '上句' },
      { time: 21, content: '下一句' },
    ],
    hostToken: 'must-not-leak',
    audioUrl: 'must-not-leak',
  };
  try {
    assert.equal((await read()).active, false);
    const opened = await post('open', {
      snapshot,
      hostName: '客厅主电脑',
      presentation,
    });
    assert.equal(opened.status, 200);
    const token = opened.body.hostToken;
    const display = await read();
    assert.equal(display.active, true);
    assert.equal(display.hostName, '客厅主电脑');
    assert.equal(display.presentation.title, '测试歌曲');
    assert.equal(display.updatedAt, now);
    assert.ok(!JSON.stringify(display).includes(token));
    assert.ok(!JSON.stringify(display).includes('must-not-leak'));
    assert.equal((await post('open', { snapshot })).status, 409);
    assert.equal(
      (await post('exchange', { presentation }, 'viewer')).status,
      401
    );
    now += 6000;
    assert.equal((await read()).stale, true);
    const updated = await post(
      'exchange',
      { presentation: { ...presentation, position: 5, playing: false } },
      token
    );
    assert.equal(updated.status, 200);
    assert.equal((await read()).presentation.position, 5);
    assert.equal((await read()).presentation.playing, false);
    assert.equal((await read()).stale, false);
    const denseLines = Array.from({ length: 300 }, (_, i) => ({
      time: i / 10,
      content: String(i),
    }));
    assert.equal(
      (
        await post(
          'exchange',
          { presentation: { ...presentation, lines: denseLines } },
          token
        )
      ).status,
      200
    );
    assert.equal(
      (await read()).presentation.lines.length,
      300,
      'dense time context is not truncated to 128 cues'
    );
    const invalid = await post(
      'exchange',
      {
        presentation: {
          ...presentation,
          lines: Array(4097).fill({ time: 0, content: 'x' }),
        },
      },
      token
    );
    assert.equal(invalid.status, 409);
    now += 90001;
    assert.equal(
      (await read()).active,
      false,
      'viewer reads must not extend host lease'
    );
    assert.equal(host.owner, null);
    console.log(
      'Docker read-only display endpoint/ownership/sanitization/lease tests passed'
    );
  } finally {
    host.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
