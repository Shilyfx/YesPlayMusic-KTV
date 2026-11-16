const assert = require('assert');
const {
  buildSearchRequest,
  findLocalTracks,
  getSearchRenderState,
  getSearchResults,
  mergeSearchResults,
  normalizeSearchText,
} = require('./searchLogic.cjs');

function testSearchTextNormalizationKeepsExistingMatchingRules() {
  assert.strictEqual(normalizeSearchText('  Jay  Chou '), 'jaychou');
  assert.deepStrictEqual(
    findLocalTracks(' jay chou ', [
      {
        tracks: [
          { id: '1', name: '晴天', artists: ['Jay Chou'] },
          { id: '2', name: 'Jay Chou Live', ar: [{ name: 'Other' }] },
          { id: '3', name: '无关歌曲', album: 'Jay Chou Collection' },
        ],
      },
    ]).map(track => track.id),
    ['1', '2', '3']
  );
  assert.deepStrictEqual(
    findLocalTracks('周 杰伦', [
      { tracks: [{ id: '4', name: '晴天', artists: ['周杰伦'] }] },
    ]).map(track => track.id),
    ['4']
  );
}

function testLocalTrackSearchDeduplicatesIdsAndMarksLocalSource() {
  const matching = { id: 7, name: 'Hello World', source: 'remote' };
  const results = findLocalTracks('hello', [
    {
      tracks: [
        matching,
        { trackId: '7', name: 'Hello Again' },
        { name: 'Hello Missing ID' },
      ],
    },
    { tracks: [{ trackId: 8, name: 'Hello There' }] },
  ]);

  assert.deepStrictEqual(results, [
    { id: 7, name: 'Hello World', source: 'local' },
    { trackId: 8, name: 'Hello There', source: 'local' },
  ]);
  assert.strictEqual(matching.source, 'remote');
  assert.deepStrictEqual(findLocalTracks('   ', [{ tracks: [matching] }]), []);
}

function testMergingKeepsLocalMatchesFirstAndDropsDuplicateOrMissingIds() {
  assert.deepStrictEqual(
    mergeSearchResults(
      [
        { id: '1', name: 'Local', source: 'local' },
        { trackId: 2, name: 'Local two' },
      ],
      [
        { trackId: 1, name: 'Remote duplicate' },
        { id: '3', name: 'Remote' },
        { name: 'Remote without id' },
      ]
    ),
    [
      { id: '1', name: 'Local', source: 'local' },
      { trackId: 2, name: 'Local two', source: 'local' },
      { id: '3', name: 'Remote' },
    ]
  );
}

function testRemoteSearchRequestPreservesEncodedQueryAndAbortSignal() {
  const signal = { aborted: false };
  assert.deepStrictEqual(buildSearchRequest('周 杰伦 / live', signal), {
    path: '/search?q=%E5%91%A8%20%E6%9D%B0%E4%BC%A6%20%2F%20live',
    options: { signal },
  });
}

function testRemoteSearchResponseReturnsResultsWithoutChangingShape() {
  const results = [{ id: '1', name: 'Song' }];
  assert.strictEqual(getSearchResults({ results }), results);
  assert.strictEqual(getSearchResults({}), undefined);
}

function testSearchRenderStateDistinguishesLoadingEmptyAndResults() {
  assert.deepStrictEqual(getSearchRenderState('song', [], true), {
    state: 'searching',
    message: '正在搜索…',
  });
  assert.deepStrictEqual(getSearchRenderState('song', []), {
    state: 'empty',
    message: '没有找到可展示的歌曲。',
  });
  assert.deepStrictEqual(getSearchRenderState('  ', []), {
    state: 'empty',
    message: '输入关键词后点击搜索或按回车点歌。',
  });

  const results = [{ id: '1' }];
  assert.deepStrictEqual(getSearchRenderState('song', results), {
    state: 'results',
    results,
  });
}

testSearchTextNormalizationKeepsExistingMatchingRules();
testLocalTrackSearchDeduplicatesIdsAndMarksLocalSource();
testMergingKeepsLocalMatchesFirstAndDropsDuplicateOrMissingIds();
testRemoteSearchRequestPreservesEncodedQueryAndAbortSignal();
testRemoteSearchResponseReturnsResultsWithoutChangingShape();
testSearchRenderStateDistinguishesLoadingEmptyAndResults();
console.log('PASS: remote search pure logic');
