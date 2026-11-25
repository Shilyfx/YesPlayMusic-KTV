'use strict';

const assert = require('assert');
const {
  createRemoteApi,
  resolveRemotePathConfig,
  resolveStaticAssetPath,
} = require('./remoteApi.cjs');

async function testMultiRoomApiAndAssetsStayUnderTheirRoomPrefix() {
  for (const roomId of ['room-one', 'room-two']) {
    const paths = resolveRemotePathConfig(`/r/${roomId}/room/`);
    assert.strictEqual(paths.apiRoot, `/r/${roomId}/ktv/api`);
    assert.strictEqual(paths.roomCode, roomId);
    assert.strictEqual(paths.assetPrefix, `/r/${roomId}`);
    assert.strictEqual(paths.isRoomPage, true);
    assert.strictEqual(
      resolveStaticAssetPath(
        '/room/artist-portraits/6452.jpg',
        paths.assetPrefix
      ),
      `/r/${roomId}/room/artist-portraits/6452.jpg`
    );
    assert.strictEqual(
      resolveStaticAssetPath(
        '/room/js/reactions/mood-mates/src/core/engine.js',
        paths.assetPrefix
      ),
      `/r/${roomId}/room/js/reactions/mood-mates/src/core/engine.js`
    );

    let requestedUrl;
    const api = createRemoteApi({
      apiRoot: paths.apiRoot,
      fetchRequest(url) {
        requestedUrl = url;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        });
      },
      getClientToken: () => '',
      getRetryAfterMs: () => null,
    });
    await api('/state');
    assert.strictEqual(requestedUrl, `/r/${roomId}/ktv/api/state`);
  }
}

function testLegacyRoomAndLanPathsKeepTheirExistingRoots() {
  const legacyRoom = resolveRemotePathConfig('/room/');
  assert.strictEqual(legacyRoom.apiRoot, '/ktv/api');
  assert.strictEqual(legacyRoom.roomCode, 'room');
  assert.strictEqual(legacyRoom.assetPrefix, '');
  assert.strictEqual(legacyRoom.isRoomPage, true);
  assert.strictEqual(
    resolveStaticAssetPath(
      '/room/artist-portraits/6452.jpg',
      legacyRoom.assetPrefix
    ),
    '/room/artist-portraits/6452.jpg'
  );
  assert.strictEqual(
    resolveStaticAssetPath(
      '/room/js/reactions/mood-mates/src/core/engine.js',
      legacyRoom.assetPrefix
    ),
    '/room/js/reactions/mood-mates/src/core/engine.js'
  );

  const legacyDynamicRoom = resolveRemotePathConfig('/room/legacy-code/');
  assert.strictEqual(legacyDynamicRoom.apiRoot, '/ktv/api');
  assert.strictEqual(legacyDynamicRoom.roomCode, 'legacy-code');
  assert.strictEqual(legacyDynamicRoom.assetPrefix, '');
  assert.strictEqual(legacyDynamicRoom.isRoomPage, true);

  const lan = resolveRemotePathConfig('/room/');
  assert.strictEqual(lan.apiRoot, '/ktv/api');
  assert.strictEqual(
    resolveStaticAssetPath(
      '/room/artist-portraits/6452.jpg',
      lan.assetPrefix
    ),
    '/room/artist-portraits/6452.jpg'
  );

  const invalidRoom = resolveRemotePathConfig('/r/%2e%2e/room/');
  assert.strictEqual(invalidRoom.apiRoot, '/ktv/api');
  assert.strictEqual(invalidRoom.assetPrefix, '');
}

function testStaticAssetResolutionKeepsExternalAndUnsafePathsUnchanged() {
  const assetPrefix = '/r/room-one';
  assert.strictEqual(
    resolveStaticAssetPath('https://cdn.example.test/portrait.jpg', assetPrefix),
    'https://cdn.example.test/portrait.jpg'
  );
  assert.strictEqual(
    resolveStaticAssetPath('//cdn.example.test/portrait.jpg', assetPrefix),
    '//cdn.example.test/portrait.jpg'
  );
  assert.strictEqual(
    resolveStaticAssetPath('/room/js/../../secret.js', assetPrefix),
    '/room/js/../../secret.js'
  );
  assert.strictEqual(
    resolveStaticAssetPath('/room/js/%2e%2e/secret.js', assetPrefix),
    '/room/js/%2e%2e/secret.js'
  );
}

async function testSuccessKeepsPathHeadersOptionsAndSignal() {
  const signal = { aborted: false };
  const calls = [];
  const body = { results: [{ id: '1' }] };
  const api = createRemoteApi({
    apiRoot: '/ktv/api',
    fetchRequest(url, options) {
      calls.push({ url, options });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(body),
      });
    },
    getClientToken: () => 'client-token',
    getRetryAfterMs: () => null,
  });

  const result = await api('/search?q=song', {
    method: 'POST',
    body: '{"query":"song"}',
    signal,
    headers: { Authorization: 'Custom token', 'X-Test': 'yes' },
  });

  assert.strictEqual(result, body);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, '/ktv/api/search?q=song');
  assert.strictEqual(calls[0].options.method, 'POST');
  assert.strictEqual(calls[0].options.body, '{"query":"song"}');
  assert.strictEqual(calls[0].options.signal, signal);
  assert.deepStrictEqual(calls[0].options.headers, {
    'Content-Type': 'application/json',
    Authorization: 'Custom token',
    'X-Test': 'yes',
  });
}

async function testErrorKeepsCodeStatusAndRetryMetadata() {
  const retryArguments = [];
  const api = createRemoteApi({
    apiRoot: '/ktv/api',
    fetchRequest: () =>
      Promise.resolve({
        ok: false,
        status: 429,
        headers: { get: name => (name === 'Retry-After' ? '3' : null) },
        json: () => Promise.resolve({ error: 'RATE_LIMIT', retryAfterMs: 2400 }),
      }),
    getClientToken: () => '',
    getRetryAfterMs(bodyDelay, headerValue) {
      retryArguments.push([bodyDelay, headerValue]);
      return 2400;
    },
  });

  await assert.rejects(api('/search'), error => {
    assert.strictEqual(error.message, 'RATE_LIMIT');
    assert.strictEqual(error.code, 'RATE_LIMIT');
    assert.strictEqual(error.status, 429);
    assert.strictEqual(error.retryAfterMs, 2400);
    return true;
  });
  assert.deepStrictEqual(retryArguments, [[2400, '3']]);
}

async function testMalformedJsonKeepsFallbackBodyAndNoAuthHeader() {
  let requestOptions;
  const api = createRemoteApi({
    apiRoot: '/ktv/api',
    fetchRequest: (url, options) => {
      assert.strictEqual(url, '/ktv/api/state');
      requestOptions = options;
      return Promise.resolve({
        ok: false,
        status: 503,
        json: () => Promise.reject(new Error('invalid json')),
      });
    },
    getClientToken: () => '',
    getRetryAfterMs: (bodyDelay, headerValue) => {
      assert.strictEqual(bodyDelay, undefined);
      assert.strictEqual(headerValue, undefined);
      return null;
    },
  });

  await assert.rejects(api('/state'), error => {
    assert.strictEqual(error.message, 'REMOTE_UNAVAILABLE');
    assert.strictEqual(error.code, undefined);
    assert.strictEqual(error.status, 503);
    assert.strictEqual(error.retryAfterMs, null);
    return true;
  });
  assert.deepStrictEqual(requestOptions.headers, {});
}

async function run() {
  await testMultiRoomApiAndAssetsStayUnderTheirRoomPrefix();
  testLegacyRoomAndLanPathsKeepTheirExistingRoots();
  testStaticAssetResolutionKeepsExternalAndUnsafePathsUnchanged();
  await testSuccessKeepsPathHeadersOptionsAndSignal();
  await testErrorKeepsCodeStatusAndRetryMetadata();
  await testMalformedJsonKeepsFallbackBodyAndNoAuthHeader();
  console.log('PASS: remote API client');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
