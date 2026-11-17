'use strict';

const assert = require('assert');
const { createPlaybackQueueRenderer } = require('./playbackQueueRenderer.cjs');

function createElement() {
  return { textContent: '', innerHTML: '' };
}

function createHarness(initialState, initialClient) {
  const selectors = {
    '[data-room-name]': createElement(),
    '[data-now-playing]': createElement(),
    '[data-queue-count]': createElement(),
    '[data-queue-list]': createElement(),
  };
  const queried = [];
  const app = {
    querySelector(selector) {
      queried.push(selector);
      return selectors[selector] || null;
    },
  };
  let state = initialState;
  let client = initialClient;
  const renderer = createPlaybackQueueRenderer({
    app,
    getState: () => state,
    getClient: () => client,
    escape: value =>
      String(value).replace(
        /[&<>"']/g,
        character =>
          ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;',
          }[character])
      ),
  });
  return {
    app,
    queried,
    selectors,
    renderer,
    setState(nextState) {
      state = nextState;
    },
  };
}

function testNowPlayingMarkupAndRoomTitleKeepExistingSelectorsAndActions() {
  const harness = createHarness(
    {
      room: { name: '客厅' },
      current: {
        queueItemId: 'queue-1',
        trackId: 'track-1',
        status: 'playing',
        requesterId: 'client-1',
        name: '<晴天>',
        artists: ['周杰伦', 'Jay'],
        coverUrl: 'cover&art.jpg',
        requesterName: '小明',
      },
    },
    { clientId: 'client-1' }
  );

  harness.renderer.renderNowPlaying();

  assert.deepStrictEqual(harness.queried, [
    '[data-room-name]',
    '[data-now-playing]',
  ]);
  assert.strictEqual(harness.selectors['[data-room-name]'].textContent, '客厅');
  assert.match(
    harness.selectors['[data-now-playing]'].innerHTML,
    /class="record cover-art" src="cover&amp;art\.jpg"/
  );
  assert.match(
    harness.selectors['[data-now-playing]'].innerHTML,
    /<h2>&lt;晴天&gt;<\/h2><p>周杰伦 \/ Jay<\/p>/
  );
  assert.match(
    harness.selectors['[data-now-playing]'].innerHTML,
    /由 小明 点播/
  );
  assert.match(
    harness.selectors['[data-now-playing]'].innerHTML,
    /class="next-track-button" data-next-track="true">切歌/
  );

  const firstMarkup = harness.selectors['[data-now-playing]'].innerHTML;
  harness.setState({
    room: { name: '客厅 KTV' },
    current: {
      queueItemId: 'queue-1',
      trackId: 'track-1',
      status: 'playing',
      requesterId: 'client-1',
      name: '<晴天>',
      artists: ['周杰伦', 'Jay'],
      coverUrl: 'cover&art.jpg',
      requesterName: '小明',
    },
  });
  harness.renderer.renderNowPlaying();

  assert.strictEqual(
    harness.selectors['[data-room-name]'].textContent,
    '客厅 KTV'
  );
  assert.strictEqual(
    harness.selectors['[data-now-playing]'].innerHTML,
    firstMarkup
  );
}

function testNowPlayingAndQueueEmptyStatesKeepExistingMarkup() {
  const harness = createHarness({ room: {}, current: null, waiting: [] }, null);

  harness.renderer.renderNowPlaying();
  harness.renderer.renderQueue();

  assert.match(
    harness.selectors['[data-now-playing]'].innerHTML,
    /<p class="section-label">正在演唱<\/p><div class="empty">等待主机选择歌曲<\/div>/
  );
  assert.strictEqual(
    harness.selectors['[data-queue-count]'].textContent,
    '0 首'
  );
  assert.strictEqual(
    harness.selectors['[data-queue-list]'].innerHTML,
    '<div class="empty">还没有待唱歌曲</div>'
  );
}

function testQueueMarkupPreservesPriorityAndOnlyShowsOwnRequestActions() {
  const harness = createHarness(
    {
      waiting: [
        {
          queueItemId: 'own-1',
          requesterId: 'client-1',
          status: 'queued',
          priorityRequested: true,
          name: '自选歌',
          artists: ['歌手甲'],
          requesterName: '我',
        },
        {
          queueItemId: 'other-1',
          requesterId: 'client-2',
          status: 'queued',
          priorityRequested: false,
          name: '别人的歌',
          artists: ['歌手乙'],
          requesterName: '来宾',
        },
      ],
    },
    { clientId: 'client-1' }
  );

  harness.renderer.renderQueue();

  assert.deepStrictEqual(harness.queried, [
    '[data-queue-count]',
    '[data-queue-list]',
  ]);
  assert.strictEqual(
    harness.selectors['[data-queue-count]'].textContent,
    '2 首'
  );
  const markup = harness.selectors['[data-queue-list]'].innerHTML;
  assert.match(markup, /<article class="queue-item priority">/);
  assert.match(markup, /<span class="queue-index">1<\/span>/);
  assert.match(markup, /<span class="tag">优先<\/span>/);
  assert.match(markup, /data-front="own-1">置顶/);
  assert.match(markup, /data-remove="own-1">取消/);
  assert.match(markup, /<article class="queue-item ">/);
  assert.match(markup, /<span class="queue-index">2<\/span>/);
  assert.strictEqual((markup.match(/data-front=/g) || []).length, 1);
  assert.strictEqual((markup.match(/data-remove=/g) || []).length, 1);
}

function testQueueKeepsUndefinedClientIdComparisonWhenClientIsMissing() {
  const harness = createHarness(
    {
      waiting: [
        {
          queueItemId: 'anonymous-1',
          status: 'queued',
          name: '未标记请求者的歌曲',
          artists: [],
        },
      ],
    },
    null
  );

  harness.renderer.renderQueue();

  assert.match(
    harness.selectors['[data-queue-list]'].innerHTML,
    /data-front="anonymous-1">置顶/
  );
}

testNowPlayingMarkupAndRoomTitleKeepExistingSelectorsAndActions();
testNowPlayingAndQueueEmptyStatesKeepExistingMarkup();
testQueueMarkupPreservesPriorityAndOnlyShowsOwnRequestActions();
testQueueKeepsUndefinedClientIdComparisonWhenClientIsMissing();
console.log('PASS: remote playback and queue renderer');
