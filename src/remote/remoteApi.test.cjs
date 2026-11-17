'use strict';

const assert = require('assert');
const { createRemoteApi } = require('./remoteApi.cjs');

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
  await testSuccessKeepsPathHeadersOptionsAndSignal();
  await testErrorKeepsCodeStatusAndRetryMetadata();
  await testMalformedJsonKeepsFallbackBodyAndNoAuthHeader();
  console.log('PASS: remote API client');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
