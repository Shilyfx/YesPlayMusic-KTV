const assert = require('assert');
const {
  clearSearchNotice,
  createSearchScheduler,
  getRetryAfterMs,
} = require('./searchScheduler.cjs');

function createClock() {
  let currentTime = 0;
  let nextId = 0;
  const timers = new Map();

  return {
    now: () => currentTime,
    setTimeout(callback, delay) {
      const id = ++nextId;
      timers.set(id, { at: currentTime + Math.max(0, delay), callback });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    async tick(delay) {
      const end = currentTime + delay;
      while (timers.size > 0) {
        let next = null;
        for (const [id, timer] of timers) {
          if (timer.at <= end && (!next || timer.at < next.timer.at))
            next = { id, timer };
        }
        if (!next) break;
        currentTime = next.timer.at;
        timers.delete(next.id);
        next.timer.callback();
        await flushPromises();
      }
      currentTime = end;
      await flushPromises();
    },
    count: () => timers.size,
  };
}

async function flushPromises() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createController(clock, overrides = {}) {
  return createSearchScheduler({
    debounceMs: 350,
    requestTimeoutMs: 13000,
    now: clock.now,
    setTimeoutFn: clock.setTimeout,
    clearTimeoutFn: clock.clearTimeout,
    ...overrides,
  });
}

async function testCompositionWaitsForFinalTextAndDebouncesOnce() {
  const clock = createClock();
  const calls = [];
  const rendered = [];
  const request = deferred();
  const scheduler = createController(clock, {
    search: query => {
      calls.push(query);
      return request.promise;
    },
    onResults: (query, results) => rendered.push({ query, results }),
  });

  scheduler.schedule('zhong');
  await clock.tick(150);
  scheduler.compositionStart();
  scheduler.schedule('zhongwen');
  await clock.tick(1000);
  assert.deepStrictEqual(
    calls,
    [],
    'composition text must not trigger requests'
  );

  scheduler.compositionEnd('中文');
  scheduler.schedule(' 中文 ');
  await clock.tick(349);
  assert.deepStrictEqual(calls, [], 'final text keeps the normal debounce');
  await clock.tick(1);
  assert.deepStrictEqual(calls, ['中文']);

  request.resolve(['final result']);
  await flushPromises();
  assert.deepStrictEqual(rendered, [
    { query: '中文', results: ['final result'] },
  ]);
  scheduler.stop();
}

async function testSingleFlightRunsOnlyTheLatestPendingQuery() {
  const clock = createClock();
  const calls = [];
  const rendered = [];
  const first = deferred();
  const latest = deferred();
  const scheduler = createController(clock, {
    search: query => {
      calls.push(query);
      return query === 'A' ? first.promise : latest.promise;
    },
    onResults: (query, results) => rendered.push({ query, results }),
  });

  scheduler.schedule('A', { immediate: true });
  await clock.tick(0);
  scheduler.schedule('B', { immediate: true });
  scheduler.schedule('C', { immediate: true });
  await clock.tick(0);
  assert.deepStrictEqual(calls, ['A'], 'only one request may be active');

  first.resolve(['stale']);
  await flushPromises();
  assert.deepStrictEqual(calls, ['A', 'C']);
  assert.deepStrictEqual(rendered, [], 'an obsolete response must not render');

  latest.resolve(['current']);
  await flushPromises();
  assert.deepStrictEqual(rendered, [{ query: 'C', results: ['current'] }]);
  scheduler.stop();
}

async function testFailedRequestReleasesSingleFlightForNextQuery() {
  const clock = createClock();
  const calls = [];
  const errors = [];
  const scheduler = createController(clock, {
    search: query => {
      calls.push(query);
      if (query === 'A') return Promise.reject(new Error('temporary failure'));
      return Promise.resolve(['B result']);
    },
    onError: (query, error) => errors.push({ query, message: error.message }),
  });

  scheduler.schedule('A', { immediate: true });
  await clock.tick(0);
  assert.deepStrictEqual(errors, [
    { query: 'A', message: 'temporary failure' },
  ]);

  scheduler.schedule('B', { immediate: true });
  await clock.tick(0);
  assert.deepStrictEqual(calls, ['A', 'B']);
  scheduler.stop();
}

async function testRateLimitRetriesOnlyTheLatestQueryAfterCooldown() {
  const clock = createClock();
  const calls = [];
  const rateLimits = [];
  const results = [];
  const first = deferred();
  const scheduler = createController(clock, {
    search: query => {
      calls.push(query);
      return calls.length === 1 ? first.promise : Promise.resolve([query]);
    },
    onRateLimit: (query, delay) => rateLimits.push({ query, delay }),
    onResults: (query, value) => results.push({ query, value }),
  });

  scheduler.schedule('old query', { immediate: true });
  await clock.tick(0);
  const error = new Error('rate limited');
  error.status = 429;
  error.retryAfterMs = 500;
  first.reject(error);
  await flushPromises();
  assert.deepStrictEqual(rateLimits, [{ query: 'old query', delay: 500 }]);

  scheduler.schedule('latest query', { immediate: true });
  await clock.tick(0);
  assert.strictEqual(clock.count(), 1, 'only one cooldown timer may be active');
  await clock.tick(499);
  assert.deepStrictEqual(calls, ['old query']);
  await clock.tick(1);
  assert.deepStrictEqual(calls, ['old query', 'latest query']);
  assert.deepStrictEqual(results, [
    { query: 'latest query', value: ['latest query'] },
  ]);
  scheduler.stop();
}

async function testTimedOutRequestReleasesSingleFlight() {
  const clock = createClock();
  const calls = [];
  const errors = [];
  let timedOutSignal;
  const scheduler = createController(clock, {
    requestTimeoutMs: 1000,
    search: (query, { signal }) => {
      calls.push(query);
      if (query === 'stuck') {
        timedOutSignal = signal;
        return new Promise(() => {});
      }
      return Promise.resolve(['recovered']);
    },
    onError: (query, error) => errors.push({ query, code: error.code }),
  });

  scheduler.schedule('stuck', { immediate: true });
  await clock.tick(0);
  await clock.tick(1000);
  assert.strictEqual(timedOutSignal.aborted, true);
  assert.deepStrictEqual(errors, [{ query: 'stuck', code: 'SEARCH_TIMEOUT' }]);

  scheduler.schedule('latest', { immediate: true });
  await clock.tick(0);
  assert.deepStrictEqual(calls, ['stuck', 'latest']);
  scheduler.stop();
}

async function testHiddenPageCancelsRetryUntilVisibleAgain() {
  const clock = createClock();
  const calls = [];
  const first = deferred();
  const scheduler = createController(clock, {
    search: query => {
      calls.push(query);
      return calls.length === 1 ? first.promise : Promise.resolve([query]);
    },
  });

  scheduler.schedule('query', { immediate: true });
  await clock.tick(0);
  const error = new Error('rate limited');
  error.status = 429;
  error.retryAfterMs = 1000;
  first.reject(error);
  await flushPromises();

  scheduler.setHidden(true);
  await clock.tick(1000);
  assert.deepStrictEqual(calls, ['query']);
  assert.strictEqual(
    clock.count(),
    0,
    'hidden page must not retain retry timers'
  );

  scheduler.setHidden(false);
  await clock.tick(0);
  assert.deepStrictEqual(calls, ['query', 'query']);
  scheduler.stop();
}

async function testZeroRetryDelayUsesFallbackToAvoidImmediateRetryLoop() {
  const clock = createClock();
  const calls = [];
  const first = deferred();
  const scheduler = createController(clock, {
    search: query => {
      calls.push(query);
      return calls.length === 1 ? first.promise : Promise.resolve([query]);
    },
  });

  scheduler.schedule('query', { immediate: true });
  await clock.tick(0);
  const error = new Error('rate limited');
  error.status = 429;
  error.retryAfterMs = 0;
  first.reject(error);
  await flushPromises();

  await clock.tick(999);
  assert.deepStrictEqual(calls, ['query']);
  await clock.tick(1);
  assert.deepStrictEqual(calls, ['query', 'query']);
  scheduler.stop();
}

async function testMissingRetryDelayUsesSafeFallback() {
  const clock = createClock();
  const calls = [];
  const delays = [];
  const first = deferred();
  const scheduler = createController(clock, {
    retryFallbackMs: 750,
    search: query => {
      calls.push(query);
      return calls.length === 1 ? first.promise : Promise.resolve([query]);
    },
    onRateLimit: (_query, delay) => delays.push(delay),
  });

  scheduler.schedule('query', { immediate: true });
  await clock.tick(0);
  const error = new Error('rate limited without a retry header');
  error.status = 429;
  error.retryAfterMs = null;
  first.reject(error);
  await flushPromises();

  assert.deepStrictEqual(delays, [750]);
  await clock.tick(749);
  assert.deepStrictEqual(calls, ['query']);
  await clock.tick(1);
  assert.deepStrictEqual(calls, ['query', 'query']);
  scheduler.stop();
}

async function testServerErrorRetriesOnlyOnce() {
  const clock = createClock();
  const calls = [];
  const errors = [];
  const scheduler = createController(clock, {
    serverRetryDelayMs: 1000,
    search: query => {
      calls.push(query);
      const error = new Error('upstream unavailable');
      error.status = 503;
      return Promise.reject(error);
    },
    onError: (query, error) => errors.push({ query, status: error.status }),
  });

  scheduler.schedule('query', { immediate: true });
  await clock.tick(0);
  assert.deepStrictEqual(calls, ['query']);
  assert.deepStrictEqual(errors, []);

  await clock.tick(999);
  assert.deepStrictEqual(calls, ['query']);
  await clock.tick(1);
  assert.deepStrictEqual(calls, ['query', 'query']);
  assert.deepStrictEqual(errors, [{ query: 'query', status: 503 }]);

  await clock.tick(5000);
  assert.deepStrictEqual(calls, ['query', 'query']);
  scheduler.stop();
}

async function testInvalidatedCatalogSearchCannotWriteItsOldResponse() {
  const clock = createClock();
  const results = [];
  const request = deferred();
  const scheduler = createController(clock, {
    search: () => request.promise,
    onResults: (_query, value) => results.push(value),
  });

  scheduler.schedule('old account query', { immediate: true });
  await clock.tick(0);
  scheduler.invalidate();
  request.resolve(['old account result']);
  await flushPromises();

  assert.deepStrictEqual(results, []);
  scheduler.stop();
}

function testRetryAfterParsingPrefersBodyThenHeader() {
  assert.strictEqual(getRetryAfterMs(2400, '1', 0), 2400);
  assert.strictEqual(getRetryAfterMs(null, '2.5', 0), 2500);
  assert.strictEqual(
    getRetryAfterMs(null, 'Thu, 01 Jan 1970 00:00:03 GMT', 1000),
    2000
  );
  assert.strictEqual(getRetryAfterMs(null, null, 0), null);
}

function testSuccessfulSearchClearsOnlyItsOwnErrorNotice() {
  let cleared = 0;
  const clear = () => {
    cleared += 1;
  };
  const searchNotice = {
    dataset: { kind: 'error' },
    textContent: '搜索较频繁，稍后自动更新',
  };
  const otherNotice = {
    dataset: { kind: 'error' },
    textContent: '歌单暂时无法加载，请稍后重试。',
  };

  assert.strictEqual(clearSearchNotice(searchNotice, clear), true);
  assert.strictEqual(clearSearchNotice(otherNotice, clear), false);
  assert.strictEqual(cleared, 1);
}

(async () => {
  await testCompositionWaitsForFinalTextAndDebouncesOnce();
  await testSingleFlightRunsOnlyTheLatestPendingQuery();
  await testFailedRequestReleasesSingleFlightForNextQuery();
  await testRateLimitRetriesOnlyTheLatestQueryAfterCooldown();
  await testTimedOutRequestReleasesSingleFlight();
  await testHiddenPageCancelsRetryUntilVisibleAgain();
  await testZeroRetryDelayUsesFallbackToAvoidImmediateRetryLoop();
  await testMissingRetryDelayUsesSafeFallback();
  await testServerErrorRetriesOnlyOnce();
  await testInvalidatedCatalogSearchCannotWriteItsOldResponse();
  testRetryAfterParsingPrefersBodyThenHeader();
  testSuccessfulSearchClearsOnlyItsOwnErrorNotice();
  console.log(
    'PASS: remote search composition, single-flight, and 429 recovery'
  );
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
