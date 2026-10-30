const assert = require('assert');

require('./helpers/register-babel-src');

const createDisplayPoller = require('../src/karaoke/displayPoller').default;
const flush = () => new Promise(resolve => setImmediate(resolve));

async function testClockOnlyPollsDoNotRepublishDisplayState() {
  const states = [];
  const clockSamples = [];
  const scheduled = [];
  let poll = 0;
  let template = {
    active: true,
    generation: 7,
    hostName: '客厅',
    stale: false,
    updatedAt: 1000,
    serverTime: 1010,
    presentation: {
      itemId: 'song-a',
      title: '测试歌曲',
      playing: true,
      position: 12,
      mode: 'folia',
      effect: 'gradient',
      coverUrl: 'https://example.test/cover-a.jpg',
      theme: 'dark',
      fontSize: 45,
      background: { mode: 'common', tuning: { drift: 0.2 } },
      tuningByMode: { folia: { density: 0.7 } },
    },
    smartBeatRevision: 0,
    smartBeatTrackKey: '',
    appearanceRevision: 0,
    pvLyricsRevision: null,
    pvLyricsItemId: null,
    joinUrl: 'https://example.test/join',
    reactions: [{ id: 'r1', kind: 'love', createdAt: 1000 }],
    reactionEpoch: 'epoch-a',
    nextTrack: { name: '下一首', artists: ['歌手'] },
  };
  const snapshot = () => {
    poll += 1;
    return JSON.parse(
      JSON.stringify({
        ...template,
        updatedAt: 1000 + poll * 200,
        serverTime: 1010 + poll * 200,
        presentation: { ...template.presentation, position: 12 + poll / 5 },
      })
    );
  };
  const poller = createDisplayPoller({
    request: async () => snapshot(),
    requestLyrics: async () => null,
    requestAppearance: async () => null,
    requestAnalysis: async () => null,
    onState: value => states.push(value),
    onClock: value => clockSamples.push(value),
    onError: error => {
      throw error;
    },
    schedule: (fn, delay) => {
      scheduled.push({ fn, delay });
      return scheduled.length;
    },
    cancel: () => {},
  });

  poller.start();
  await flush();
  for (let index = 1; index < 12; index += 1) await poller.refresh();

  const before = {
    polls: poll,
    statePublishes: states.length,
    clockSamples: clockSamples.length,
    firstPresentation: states[0]?.presentation,
  };
  console.log(`Display poll counters: ${JSON.stringify(before)}`);
  assert.equal(
    states.length,
    1,
    'clock-only responses must not publish replacement display states'
  );
  assert.equal(
    clockSamples.length,
    12,
    'every healthy response corrects the clock'
  );
  assert.equal(clockSamples[11].serverTime, 3410);
  assert.equal(clockSamples[11].updatedAt, 3400);
  assert.equal(clockSamples[11].position, 14.4);

  template = {
    ...template,
    reactions: [
      { id: 'r1', kind: 'love', createdAt: 1000 },
      { id: 'r2', kind: 'cheer', createdAt: 3300 },
    ],
  };
  await poller.refresh();
  assert.equal(states.length, 2, 'new interaction events publish immediately');
  assert.strictEqual(
    states[1].presentation,
    before.firstPresentation,
    'unchanged presentation keeps its reference when interactions change'
  );

  template = {
    ...template,
    presentation: {
      ...template.presentation,
      coverUrl: 'https://example.test/cover-b.jpg',
      background: { mode: 'common', tuning: { drift: 0.8 } },
    },
  };
  await poller.refresh();
  assert.equal(states.length, 3, 'cover and visual-style changes publish');
  assert.equal(
    states[2].presentation.coverUrl,
    'https://example.test/cover-b.jpg'
  );
  assert.equal(states[2].presentation.background.tuning.drift, 0.8);

  template = { ...template, stale: true };
  await poller.refresh();
  assert.equal(states.length, 4, 'connection status changes publish');
  assert.equal(states[3].stale, true);
  poller.stop();
}

testClockOnlyPollsDoNotRepublishDisplayState().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
