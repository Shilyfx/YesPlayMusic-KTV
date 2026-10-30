const assert = require('assert');
const http = require('http');
require('./helpers/register-babel-src');

const KaraokeWebHost = require('../src/server/KaraokeWebHost').default;
const { REACTION_UI_REVISION } = require('../src/karaoke/reactions');
const {
  canSafelyTapMediaElement,
  extractAudioFeatures,
  extractLyricCadenceFeatures,
  createMusicReactionController,
  createPlayerMusicAnalyzer,
  sanitizeMusicReaction,
} = require('../src/karaoke/musicReactionAnalyzer');
const { createReactionScheduler } = require('../src/karaoke/reactionScheduler');
const { sanitizePresentation } = require('../src/karaoke/lyricDisplay');

// 1. Gate A: Audio source safety & WeakMap single-tap verification
{
  assert.equal(
    canSafelyTapMediaElement({ src: 'blob:http://router.test/123' }).safe,
    true
  );
  assert.equal(
    canSafelyTapMediaElement({ src: 'data:audio/wav;base64,AAAA' }).safe,
    true
  );
  assert.equal(
    canSafelyTapMediaElement({ src: 'file:///C:/music/song.flac' }).safe,
    true
  );
  assert.equal(
    canSafelyTapMediaElement(
      { src: 'http://router.test/media/song.mp3' },
      { origin: 'http://router.test' }
    ).safe,
    true
  );
  const crossOrigin = canSafelyTapMediaElement(
    { src: 'https://m7.music.126.net/20261027/song.mp3' },
    { origin: 'http://router.test' }
  );
  assert.equal(crossOrigin.safe, false);
  assert.equal(crossOrigin.reason, 'CROSS_ORIGIN_WITHOUT_CORS');

  const customSink = canSafelyTapMediaElement(
    { src: 'blob:http://router.test/123' },
    { outputDevice: 'usb-audio-dac' }
  );
  assert.equal(customSink.safe, false);
  assert.equal(customSink.reason, 'CUSTOM_OUTPUT_DEVICE');
}

// 2. Audio feature extraction
{
  const silentTd = new Float32Array(256);
  const silentFreq = new Uint8Array(128);
  const silent = extractAudioFeatures(silentTd, silentFreq, 0, 0);
  assert.equal(silent.rms, 0);
  assert.equal(silent.lowEnergy, 0);
  assert.equal(silent.transient, 0);

  const activeTd = new Float32Array(256).fill(0.25);
  const activeFreq = new Uint8Array(128);
  for (let i = 1; i < 12; i++) activeFreq[i] = 200;
  for (let i = 12; i < 64; i++) activeFreq[i] = 100;
  const loud = extractAudioFeatures(activeTd, activeFreq, 0.1, 0.05);
  assert.ok(loud.rms > 0.24 && loud.rms < 0.26);
  assert.ok(loud.lowEnergy > 0.75);
  assert.ok(loud.transient > 0.3);
}

// 3. Music reaction controller: calibration, hysteresis, hold, cooldown, mute vs pause, seek & track reset
{
  let clock = 1000;
  const controller = createMusicReactionController({
    now: () => clock,
    sensitivity: 'standard',
  });

  // Idle state when no track
  let snap = controller.update({ hasTrack: false });
  assert.equal(snap.state, 'idle');
  assert.equal(snap.emotion, '02');

  // Start song 1: calibration window (0..6500ms) stays in listening ('16')
  for (let step = 0; step < 65; step++) {
    clock += 100;
    snap = controller.update({
      itemId: 'item-1',
      trackId: 'track-1',
      playing: true,
      position: step * 0.1,
      analyzed: true,
      rms: 0.1,
      lowEnergy: 0.2,
      transient: 0.02,
    });
    if (step < 64) {
      assert.equal(snap.state, 'listening');
      assert.equal(snap.emotion, '16');
      assert.equal(snap.calibrating, true);
    }
  }
  assert.equal(snap.calibrating, false);

  // Brief 300ms spike must NOT switch mood (observation window is 1500ms)
  for (let step = 0; step < 3; step++) {
    clock += 100;
    snap = controller.update({
      itemId: 'item-1',
      trackId: 'track-1',
      playing: true,
      position: 6.5 + step * 0.1,
      analyzed: true,
      rms: 0.28,
      lowEnergy: 0.5,
      transient: 0.18,
    });
  }
  assert.equal(
    snap.state,
    'listening',
    'brief energy spike must not trigger face change'
  );
  assert.ok(snap.beatSeq >= 1, 'local beat nod responds within 100-200ms');

  // Sustained excited energy for 1600ms -> transitions to excited ('13') or peak ('33')
  for (let step = 0; step < 20; step++) {
    clock += 100;
    snap = controller.update({
      itemId: 'item-1',
      trackId: 'track-1',
      playing: true,
      position: 7.0 + step * 0.1,
      analyzed: true,
      rms: 0.15,
      lowEnergy: 0.28,
      transient: 0.03,
    });
  }
  assert.equal(snap.state, 'excited');
  assert.equal(snap.emotion, '13');

  // Minimum hold period (4500ms): dropping energy after 1000ms must keep 'excited'
  for (let step = 0; step < 18; step++) {
    clock += 100;
    snap = controller.update({
      itemId: 'item-1',
      trackId: 'track-1',
      playing: true,
      position: 9.0 + step * 0.1,
      analyzed: true,
      rms: 0.05,
      lowEnergy: 0.08,
      transient: 0,
    });
  }
  assert.equal(
    snap.state,
    'excited',
    'mood must hold for at least 4.5s despite early drop'
  );

  // Advance past 4500ms hold -> transitions to cooldown ('19')
  for (let step = 0; step < 32; step++) {
    clock += 100;
    snap = controller.update({
      itemId: 'item-1',
      trackId: 'track-1',
      playing: true,
      position: 10.8 + step * 0.1,
      analyzed: true,
      rms: 0.06,
      lowEnergy: 0.08,
      transient: 0,
    });
  }
  assert.equal(snap.state, 'cooldown');
  assert.equal(snap.emotion, '19');

  // Sustained peak energy -> enters 'peak' ('33') and fires burstSeq once
  for (let step = 0; step < 50; step++) {
    clock += 100;
    snap = controller.update({
      itemId: 'item-1',
      trackId: 'track-1',
      playing: true,
      position: 14.0 + step * 0.1,
      analyzed: true,
      rms: 0.25,
      lowEnergy: 0.45,
      transient: 0.05,
    });
  }
  assert.equal(snap.state, 'excited');
  for (let step = 0; step < 50; step++) {
    clock += 100;
    snap = controller.update({
      itemId: 'item-1',
      trackId: 'track-1',
      playing: true,
      position: 19.0 + step * 0.1,
      analyzed: true,
      rms: 0.3,
      lowEnergy: 0.5,
      transient: 0.05,
    });
  }
  assert.equal(snap.state, 'peak');
  assert.equal(snap.emotion, '33');
  assert.equal(snap.burstSeq, 1);

  // Mute while still playing -> must NOT become 'paused' ('06'), returns to 'listening' ('16')
  for (let step = 0; step < 50; step++) {
    clock += 100;
    snap = controller.update({
      itemId: 'item-1',
      trackId: 'track-1',
      playing: true,
      muted: true,
      volume: 0,
      position: 24.0 + step * 0.1,
      analyzed: true,
      rms: 0,
      lowEnergy: 0,
    });
  }
  assert.notEqual(snap.state, 'paused', 'mute is not pause');
  assert.equal(snap.state, 'listening');
  assert.equal(snap.emotion, '16');

  // Actual pause -> immediately becomes 'paused' ('06')
  clock += 100;
  snap = controller.update({
    itemId: 'item-1',
    trackId: 'track-1',
    playing: false,
    position: 29.1,
    analyzed: true,
  });
  assert.equal(snap.state, 'paused');
  assert.equal(snap.emotion, '06');

  // Normal song finished (after 15s burst cooldown) -> 'finished' ('33')
  clock += 16000;
  snap = controller.markFinished({
    itemId: 'item-1',
    trackId: 'track-1',
    timestamp: clock,
  });
  assert.equal(snap.state, 'finished');
  assert.equal(snap.emotion, '33');
  assert.equal(snap.burstSeq, 2);

  // Track change -> resets calibration and enters 'listening'
  clock += 100;
  snap = controller.update({
    itemId: 'item-2',
    trackId: 'track-2',
    playing: true,
    position: 0,
    analyzed: true,
    rms: 0.12,
    lowEnergy: 0.2,
  });
  assert.equal(snap.state, 'listening');
  assert.equal(snap.calibrating, true);
}

// 4. Deterministic unit test for ReactionScheduler: fairness, anti-starvation, queue full, track switch
{
  let now = 50000;
  const scheduler = createReactionScheduler({ now: () => now });

  // User A sends reaction -> active immediately
  const rA1 = scheduler.scheduleUser({
    senderId: 'user-a',
    itemId: 'song-1',
    kind: 'love',
    effect: 'zoom',
    customText: '第一条应援',
  });
  assert.equal(rA1.ok, true);
  assert.equal(rA1.status, 'playing');
  assert.equal(rA1.queuePosition, 0);
  assert.equal(rA1.event.startAt, 50000);
  assert.equal(rA1.event.endsAt, 54200);
  assert.equal(rA1.event.senderId, undefined, 'senderId must be stripped');

  // User B sends reaction at 50500 -> queued #1
  now = 50500;
  const rB1 = scheduler.scheduleUser({
    senderId: 'user-b',
    itemId: 'song-1',
    kind: 'cheer',
    customText: 'B的应援',
  });
  assert.equal(rB1.ok, true);
  assert.equal(rB1.status, 'queued');
  assert.equal(rB1.queuePosition, 1);
  assert.equal(rB1.event.startAt, 54200);
  assert.equal(rB1.event.endsAt, 58400);

  // User B sends again at 50800 while still queued -> replaces B's queued slot in-place without adding slot #2
  now = 50800;
  const rB2 = scheduler.scheduleUser({
    senderId: 'user-b',
    itemId: 'song-1',
    kind: 'wow',
    customText: 'B更新后的应援',
  });
  assert.equal(rB2.ok, true);
  assert.equal(rB2.status, 'queued');
  assert.equal(rB2.queuePosition, 1);
  assert.equal(rB2.event.replacesId, rB1.event.id);
  assert.equal(rB2.event.startAt, 54200);

  // User A replaces active reaction at 51000 while B is waiting -> 1st extension allowed
  now = 51000;
  const rA2 = scheduler.scheduleUser({
    senderId: 'user-a',
    itemId: 'song-1',
    kind: 'applause',
  });
  assert.equal(rA2.ok, true);
  assert.equal(rA2.status, 'replaced');
  assert.equal(rA2.event.endsAt, 55200);

  // User A replaces AGAIN at 52000 while B is still waiting -> anti-starvation cap prevents extending endsAt beyond 55200
  now = 52000;
  const rA3 = scheduler.scheduleUser({
    senderId: 'user-a',
    itemId: 'song-1',
    kind: 'encore',
  });
  assert.equal(rA3.ok, true);
  assert.equal(rA3.status, 'replaced');
  assert.equal(
    rA3.event.endsAt,
    55200,
    'second consecutive replacement while others wait must not delay queue further'
  );

  // User C sends reaction at 52100 -> queued #2
  now = 52100;
  const rC1 = scheduler.scheduleUser({
    senderId: 'user-c',
    itemId: 'song-1',
    kind: 'duet',
  });
  assert.equal(rC1.ok, true);
  assert.equal(rC1.status, 'queued');
  assert.equal(rC1.queuePosition, 2);

  // User D sends reaction at 52200 -> queue full (1 active + 2 queued), returns busy
  now = 52200;
  const rD1 = scheduler.scheduleUser({
    senderId: 'user-d',
    itemId: 'song-1',
    kind: 'love',
  });
  assert.equal(rD1.ok, false);
  assert.equal(rD1.code, 'REACTION_QUEUE_FULL');
  assert.equal(rD1.status, 'busy');

  // Song switches from 'song-1' to 'song-2' at 52500 -> cancels active & queued reactions for 'song-1'
  now = 52500;
  scheduler.cancelSongReactions('song-1', 'TRACK_CHANGED');
  const afterCancel = scheduler.recentPublic(now);
  assert.ok(
    afterCancel.every(
      item => item.status === 'cancelled' || item.status === 'replaced'
    ),
    'all active and queued reactions for previous song must be cancelled on track change'
  );

  // User D can now immediately take the stage on 'song-2'
  const rD2 = scheduler.scheduleUser({
    senderId: 'user-d',
    itemId: 'song-2',
    kind: 'love',
    customText: '新歌应援',
  });
  assert.equal(rD2.ok, true);
  assert.equal(rD2.status, 'playing');
  assert.equal(rD2.queuePosition, 0);
}

// 5. Presentation sanitization & end-to-end KaraokeWebHost HTTP test
(async () => {
  let now = 100000;
  const origin = 'http://router.test';
  const host = new KaraokeWebHost({
    publicOrigin: origin,
    now: () => now,
    requiredUiRevision: REACTION_UI_REVISION,
  });
  const server = http.createServer((req, res) => host.handle(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body, token = '') => {
    const response = await fetch(base + path, {
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

  try {
    const snapshot = {
      session: { sessionId: 's1', status: 'active' },
      revision: 1,
      currentItem: { queueItemId: 'song-1' },
      waitingItems: [],
      historyItems: [],
    };
    const presentation = {
      itemId: 'song-1',
      title: '测试歌曲',
      artists: '测试歌手',
      position: 12.5,
      playing: true,
      lines: [{ time: 10, content: '第一句歌词' }],
      musicReaction: {
        state: 'excited',
        emotion: '13',
        label: '副歌蓄力中，准备起飞',
        intensity: 0.78,
        beatSeq: 4,
        burstSeq: 1,
        analyzed: true,
        itemId: 'song-1',
        trackPosition: 12.5,
        secretToken: 'must-not-leak',
      },
    };
    const sanitized = sanitizePresentation(presentation);
    assert.deepStrictEqual(sanitized.musicReaction, {
      state: 'excited',
      emotion: '13',
      label: '副歌蓄力中，准备起飞',
      intensity: 0.78,
      beatSeq: 4,
      burstSeq: 1,
      analyzed: true,
      itemId: 'song-1',
      trackPosition: 12.5,
    });
    assert.equal(sanitized.musicReaction.secretToken, undefined);
    assert.equal(sanitizeMusicReaction(null), null);

    const opened = await post('/ktv/host/open', {
      snapshot,
      presentation,
      uiRevision: REACTION_UI_REVISION,
    });
    assert.equal(opened.status, 200);
    const hostToken = opened.body.hostToken;
    const joinToken = new URL(opened.body.room.joinUrl).hash.slice(7);

    const c1 = (await post('/ktv/api/client-session', {}, joinToken)).body
      .clientToken;
    const c2 = (await post('/ktv/api/client-session', {}, joinToken)).body
      .clientToken;
    const c3 = (await post('/ktv/api/client-session', {}, joinToken)).body
      .clientToken;
    const c4 = (await post('/ktv/api/client-session', {}, joinToken)).body
      .clientToken;

    const send1 = await post(
      '/ktv/api/reactions',
      { kind: 'love', customText: '一楼应援' },
      c1
    );
    assert.equal(send1.status, 200);
    assert.equal(send1.body.status, 'playing');
    assert.equal(send1.body.queuePosition, 0);

    const send2 = await post(
      '/ktv/api/reactions',
      { kind: 'cheer', customText: '二楼排队' },
      c2
    );
    assert.equal(send2.status, 200);
    assert.equal(send2.body.status, 'queued');
    assert.equal(send2.body.queuePosition, 1);

    const send3 = await post(
      '/ktv/api/reactions',
      { kind: 'wow', customText: '三楼排队' },
      c3
    );
    assert.equal(send3.status, 200);
    assert.equal(send3.body.status, 'queued');
    assert.equal(send3.body.queuePosition, 2);

    const send4 = await post(
      '/ktv/api/reactions',
      { kind: 'duet', customText: '四楼繁忙' },
      c4
    );
    assert.equal(send4.status, 429);
    assert.equal(send4.body.error, 'REACTION_QUEUE_FULL');
    assert.equal(send4.body.status, 'busy');

    const display = await fetch(base + '/ktv/display').then(r => r.json());
    assert.equal(display.presentation.musicReaction.state, 'excited');
    assert.equal(display.presentation.musicReaction.emotion, '13');
    assert.ok(
      !JSON.stringify(display).includes('must-not-leak'),
      'sanitized musicReaction must not leak extra fields'
    );

    // Switch song to song-2 -> cancels queued reactions from song-1, allowing c4 to send immediately
    now += 500;
    await post(
      '/ktv/host/exchange',
      {
        snapshot: {
          ...snapshot,
          revision: 2,
          currentItem: { queueItemId: 'song-2' },
          historyItems: [{ queueItemId: 'song-1', status: 'skipped' }],
        },
        presentation: { ...presentation, itemId: 'song-2' },
      },
      hostToken
    );

    const send4AfterSwitch = await post(
      '/ktv/api/reactions',
      { kind: 'duet', customText: '新歌首发' },
      c4
    );
    assert.equal(send4AfterSwitch.status, 200);
    assert.equal(send4AfterSwitch.body.status, 'playing');
    assert.equal(send4AfterSwitch.body.queuePosition, 0);

    // Verify createPlayerMusicAnalyzer lifecycle and cross-origin lyric cadence fallback
    let latestState = null;
    let simPosition = 1.0;
    const sampleLyrics = [
      { time: 6.0, content: '第一句轻柔开场' },
      { time: 10.5, content: '第二句慢慢叙事' },
      { time: 15.0, content: '第三句情绪铺垫' },
      { time: 20.0, content: '副歌高能第一句全场一起唱起来吧' },
      { time: 21.8, content: '副歌高能第二句气氛彻底点燃了' },
      { time: 23.5, content: '副歌高能第三句每一拍都跟着摇摆' },
      { time: 25.2, content: '副歌高能第四句继续把歌声推向顶点' },
      { time: 27.0, content: '副歌高能第五句全场欢呼不停歇' },
      { time: 28.8, content: '副歌高能第六句让节奏一直跳动' },
      { time: 45.0, content: '尾奏余韵缓缓收尾' },
    ];
    const crossOriginNode = {
      src: 'https://m7.music.126.net/20261027/online-song.mp3',
    };
    const cadenceFeaturesIntro = extractLyricCadenceFeatures(
      sampleLyrics,
      2.0,
      -1,
      -1
    );
    const cadenceFeaturesChorus = extractLyricCadenceFeatures(
      sampleLyrics,
      23.6,
      4,
      10
    );
    assert.ok(
      cadenceFeaturesChorus.rms > cadenceFeaturesIntro.rms * 2,
      'dense chorus lyrics must produce significantly higher cadence energy than intro'
    );

    const analyzer = createPlayerMusicAnalyzer({
      getPlayer: () => ({
        playing: true,
        volume: 0.8,
        currentTrack: { id: 101 },
        seek: () => simPosition,
        _howler: { _sounds: [{ _node: crossOriginNode }] },
      }),
      getCurrentItem: () => ({ queueItemId: 'song-2', trackId: 101 }),
      getLyrics: () => sampleLyrics,
      onUpdate: state => {
        latestState = state;
      },
      now: () => now,
      schedule: () => 1,
      cancel: () => {},
    });
    analyzer.start();
    assert.equal(latestState.itemId, 'song-2');
    assert.equal(latestState.state, 'listening');
    assert.equal(latestState.analyzed, true);
    for (let step = 0; step < 70; step++) {
      now += 100;
      simPosition = 1.0 + step * 0.1;
      analyzer.tick();
    }
    assert.equal(latestState.calibrating, false);
    for (let step = 0; step < 60; step++) {
      now += 100;
      simPosition = 20.0 + step * 0.12;
      analyzer.tick();
    }
    assert.ok(
      ['excited', 'peak'].includes(latestState.state),
      `cross-origin track should reach excited/peak during chorus, got ${latestState.state}`
    );
    const firstChorusLabel = latestState.label;
    for (let step = 0; step < 60; step++) {
      now += 100;
      simPosition += 0.05;
      analyzer.tick();
    }
    assert.notEqual(
      latestState.label,
      firstChorusLabel,
      'sustained mood state should rotate diverse accompaniment dialogue'
    );
    assert.ok(
      latestState.beatSeq >= 2,
      'cross-origin track should emit beat nods'
    );
    assert.equal(analyzer.setSensitivity('lively'), 'lively');
    analyzer.dispose();

    console.log(
      'Music reaction linkage, Gate A safety, hysteresis, and multi-user scheduler tests passed'
    );
  } finally {
    host.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
