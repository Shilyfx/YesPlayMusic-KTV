const assert = require('assert');
const http = require('http');
require('./helpers/register-babel-src');
const Host = require('../src/server/KaraokeWebHost').default;
const {
  reactionChoices,
  automaticReactions,
  upstreamReactions,
  reactionCharacters,
  reactionEffects,
  REACTION_EFFECT_IDS,
  isValidReactionEffect,
  ktvReactionChoices,
  normalizeReactionText,
  REACTION_UI_REVISION,
} = require('../src/karaoke/reactions');
const fs = require('fs');
const vm = require('vm');
const emotionContext = { window: {} };
vm.runInNewContext(
  fs.readFileSync(
    require('path').join(
      __dirname,
      '../public/reactions/emotion-ball/js/emotions.js'
    ),
    'utf8'
  ),
  emotionContext
);
assert.equal(upstreamReactions.length, 32);
assert.equal(ktvReactionChoices.length, 32);
assert.equal(reactionEffects.length, 13);
assert.equal(REACTION_EFFECT_IDS.length, 13);
for (const eff of reactionEffects) {
  assert.ok(isValidReactionEffect(eff.id), `Invalid effect id ${eff.id}`);
}
assert.equal(isValidReactionEffect('invalid'), false);
assert.equal(normalizeReactionText('  一起\n唱歌  '), '一起 唱歌');
assert.equal(Array.from(normalizeReactionText('🙂'.repeat(40))).length, 40);
assert.throws(
  () => normalizeReactionText('🙂'.repeat(41)),
  /INVALID_REACTION_TEXT/
);
assert.deepStrictEqual(
  upstreamReactions.map(item => item.emotion),
  Array.from(emotionContext.window.EMOTION_SEED, item => item.id)
);
for (const reaction of [
  ...reactionChoices,
  ...Object.values(automaticReactions),
])
  assert.ok(
    emotionContext.window.EMOTION_SEED.some(
      item => item.id === reaction.emotion
    ),
    `Missing upstream emotion ${reaction.emotion}`
  );

(async () => {
  let now = Date.now();
  const realDateNow = Date.now;
  Date.now = () => now;
  const origin = 'http://router.test';
  const host = new Host({
    publicOrigin: origin,
    now: () => now,
    requiredUiRevision: REACTION_UI_REVISION,
  });
  const server = http.createServer((req, res) => host.handle(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const snapshot = {
    session: { sessionId: 's', status: 'active' },
    revision: 1,
    currentItem: null,
    waitingItems: [],
    historyItems: [],
  };
  const post = async (path, body, token = '', requestOrigin = origin) => {
    const response = await fetch(base + path, {
      method: 'POST',
      headers: {
        Origin: requestOrigin,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    const outdated = await post('/ktv/host/open', { snapshot });
    assert.equal(outdated.status, 409);
    assert.match(outdated.body.error, /刷新/);
    assert.equal(host.owner, null);
    const opened = await post('/ktv/host/open', {
      snapshot,
      uiRevision: REACTION_UI_REVISION,
    });
    const hostToken = opened.body.hostToken;
    const join = new URL(opened.body.room.joinUrl).hash.slice(7);
    const client = (await post('/ktv/api/client-session', {}, join)).body
      .clientToken;
    const second = (await post('/ktv/api/client-session', {}, join)).body
      .clientToken;
    assert.equal(
      (await post('/ktv/api/reactions', { kind: 'love' })).status,
      401
    );
    assert.equal(
      (
        await post(
          '/ktv/api/reactions',
          { kind: 'love' },
          client,
          'http://evil.test'
        )
      ).status,
      403
    );
    assert.equal(
      (await post('/ktv/api/reactions', { kind: 'arbitrary' }, client)).status,
      400
    );
    assert.equal(
      (
        await post(
          '/ktv/api/reactions',
          { kind: 'love', effect: 'invalid' },
          client
        )
      ).status,
      400
    );
    assert.equal(
      (
        await post(
          '/ktv/api/reactions',
          { kind: 'love', effect: 'zoom' },
          client
        )
      ).status,
      200
    );
    assert.equal(
      (await post('/ktv/api/reactions', { kind: 'cheer' }, second)).status,
      200
    );
    const display = await fetch(base + '/ktv/display').then(r => r.json());
    assert.match(display.reactionEpoch, /^[a-f0-9]{24}$/);
    assert.equal(display.hostUiRevision, REACTION_UI_REVISION);
    assert.equal(display.reactions[0].effect, 'zoom');
    const exchange = await post('/ktv/host/exchange', {}, hostToken);
    assert.deepStrictEqual(
      display.reactions.map(x => x.kind),
      ['love', 'cheer']
    );
    assert.deepStrictEqual(exchange.body.reactions, display.reactions);
    assert.ok(!JSON.stringify(display.reactions).includes(client));
    const started = {
      ...snapshot,
      revision: 2,
      currentItem: { queueItemId: 'one' },
    };
    const presentation = {
      itemId: 'one',
      position: 0,
      playing: true,
      lines: [],
    };
    await post(
      '/ktv/host/exchange',
      { snapshot: started, presentation },
      hostToken
    );
    await post('/ktv/host/exchange', { presentation }, hostToken);
    assert.deepStrictEqual(
      host.reactions.map(x => x.kind),
      ['love', 'cheer', 'requested', 'started']
    );
    await post(
      '/ktv/host/exchange',
      { presentation: { ...presentation, playing: false } },
      hostToken
    );
    assert.equal(host.reactions.filter(x => x.kind === 'paused').length, 1);
    await post('/ktv/host/exchange', { presentation }, hostToken);
    assert.equal(
      host.reactions.filter(x => x.kind === 'started').length,
      1,
      'resume is not a new song'
    );
    assert.equal(host.reactions.filter(x => x.kind === 'resumed').length, 1);
    const finished = {
      ...snapshot,
      revision: 3,
      historyItems: [{ queueItemId: 'one', status: 'played' }],
    };
    await post('/ktv/host/exchange', { snapshot: finished }, hostToken);
    assert.equal(host.reactions.filter(x => x.kind === 'finished').length, 1);
    const next = {
      ...snapshot,
      revision: 4,
      currentItem: { queueItemId: 'two' },
      historyItems: finished.historyItems,
    };
    await post(
      '/ktv/host/exchange',
      { snapshot: next, presentation: { ...presentation, itemId: 'two' } },
      hostToken
    );
    await post(
      '/ktv/host/exchange',
      {
        snapshot: {
          ...snapshot,
          revision: 5,
          historyItems: [
            ...finished.historyItems,
            { queueItemId: 'two', status: 'skipped' },
          ],
        },
      },
      hostToken
    );
    assert.equal(
      host.reactions.filter(x => x.kind === 'finished').length,
      1,
      'skip does not claim a completed song'
    );
    assert.equal(host.reactions.filter(x => x.kind === 'skipped').length, 1);
    await post(
      '/ktv/host/exchange',
      {
        snapshot: {
          ...snapshot,
          revision: 6,
          waitingItems: [{ queueItemId: 'three' }],
        },
      },
      hostToken
    );
    await post(
      '/ktv/host/exchange',
      {
        snapshot: {
          ...snapshot,
          revision: 6,
          waitingItems: [{ queueItemId: 'three' }],
        },
      },
      hostToken
    );
    assert.equal(host.reactions.filter(x => x.kind === 'requested').length, 3);
    now += 9000;
    assert.deepStrictEqual(
      (await fetch(base + '/ktv/display').then(r => r.json())).reactions,
      []
    );
    for (let i = 0; i < 7; i++)
      assert.equal(
        (await post('/ktv/api/reactions', { kind: 'applause' }, client)).status,
        200
      );
    assert.equal(
      (await post('/ktv/api/reactions', { kind: 'applause' }, client)).status,
      429
    );
    const extraClient = (await post('/ktv/api/client-session', {}, join)).body
      .clientToken;
    for (const reaction of reactionChoices) {
      assert.equal(
        (
          await post(
            '/ktv/api/reactions',
            { kind: reaction.kind, effect: 'fade' },
            extraClient
          )
        ).status,
        200
      );
      assert.equal(
        host.reactions[host.reactions.length - 1].kind,
        reaction.kind
      );
    }
    assert.equal(
      (
        await post(
          '/ktv/api/reactions',
          { kind: 'emotion', emotionId: '99' },
          extraClient
        )
      ).status,
      400
    );
    assert.equal(
      (
        await post(
          '/ktv/api/reactions',
          { kind: 'emotion', emotionId: '10', character: 'unknown' },
          extraClient
        )
      ).status,
      400
    );
    for (const character of reactionCharacters) {
      for (const customText of [
        '好'.repeat(41),
        { text: 'bad' },
        'bad\u0000text',
      ]) {
        assert.equal(
          (
            await post(
              '/ktv/api/reactions',
              { kind: 'emotion', emotionId: '10', customText },
              extraClient
            )
          ).status,
          400
        );
      }
      for (let offset = 0; offset < upstreamReactions.length; offset += 8) {
        now += 11000;
        await post('/ktv/host/exchange', {}, hostToken);
        const sender = (await post('/ktv/api/client-session', {}, join)).body
          .clientToken;
        for (const [idx, reaction] of upstreamReactions
          .slice(offset, offset + 8)
          .entries()) {
          const testedEffect =
            REACTION_EFFECT_IDS[(offset + idx) % REACTION_EFFECT_IDS.length];
          assert.equal(
            (
              await post(
                '/ktv/api/reactions',
                {
                  kind: 'emotion',
                  emotionId: reaction.emotion,
                  character: character.id,
                  effect: testedEffect,
                  customText: '  今晚一起唱 <b>加油</b>  ',
                },
                sender
              )
            ).status,
            200
          );
          const event = host.reactions[host.reactions.length - 1];
          assert.equal(event.emotionId, reaction.emotion);
          assert.equal(event.character, character.id);
          assert.equal(event.effect, testedEffect);
          assert.equal(event.customText, '今晚一起唱 <b>加油</b>');
        }
      }
    }
    await post('/ktv/host/close', {}, hostToken);
    assert.equal(
      (await post('/ktv/api/reactions', { kind: 'love' }, client)).status,
      401
    );
    assert.equal(host.reactions.length, 0);
    const reopened = await post('/ktv/host/open', {
      snapshot,
      uiRevision: REACTION_UI_REVISION,
    });
    const newRoom = await fetch(base + '/ktv/display').then(r => r.json());
    assert.notEqual(
      newRoom.reactionEpoch,
      display.reactionEpoch,
      'new rooms cannot reuse a saved display cursor'
    );
    assert.equal(
      (await post('/ktv/api/reactions', { kind: 'love' }, client)).status,
      401,
      'old guest token cannot affect a new room'
    );
    await post('/ktv/host/close', {}, reopened.body.hostToken);
    console.log(
      'Docker reactions: auth, origin, rate, two clients, fan-out, start/end/skip and expiry passed'
    );
  } finally {
    Date.now = realDateNow;
    host.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
