const assert = require('assert');

require('./helpers/register-babel-src');

const createCatalogPrefetchScheduler =
  require('../src/remote/catalogPrefetchScheduler').default;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitUntil(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail(message || 'condition did not become true');
}

async function testBackgroundDirectoriesRunOneAtATime() {
  const scheduler = createCatalogPrefetchScheduler();
  const first = deferred();
  const second = deferred();
  const started = [];
  let active = 0;
  let maxActive = 0;
  const run = (name, gate) => {
    started.push(name);
    active += 1;
    maxActive = Math.max(maxActive, active);
    return gate.promise.finally(() => {
      active -= 1;
    });
  };

  scheduler.enqueue([
    { key: 'first', run: () => run('first', first) },
    { key: 'second', run: () => run('second', second) },
  ]);
  await waitUntil(() => started.length === 1, 'first directory did not start');
  assert.deepStrictEqual(started, ['first']);

  first.resolve();
  await waitUntil(() => started.length === 2, 'second directory did not start');
  assert.strictEqual(maxActive, 1, 'background directories must not overlap');
  second.resolve();
  await waitUntil(() => active === 0, 'second directory did not finish');
}

async function testHiddenQueuePausesAndResumes() {
  let hidden = true;
  const started = [];
  const scheduler = createCatalogPrefetchScheduler({
    isHidden: () => hidden,
  });
  scheduler.enqueue([
    { key: 'first', run: () => started.push('first') },
    { key: 'second', run: () => started.push('second') },
  ]);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepStrictEqual(started, [], 'hidden pages must not start prefetches');

  hidden = false;
  scheduler.resume();
  await waitUntil(() => started.length === 2, 'prefetch queue did not resume');
  assert.deepStrictEqual(started, ['first', 'second']);
}

async function testStoppedSchedulerDiscardsQueuedDirectories() {
  let hidden = true;
  const started = [];
  const scheduler = createCatalogPrefetchScheduler({
    isHidden: () => hidden,
  });
  scheduler.enqueue([{ key: 'queued', run: () => started.push('queued') }]);
  await new Promise(resolve => setTimeout(resolve, 20));
  scheduler.stop();
  hidden = false;
  scheduler.resume();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepStrictEqual(
    started,
    [],
    'a stopped room must release queued work'
  );
}

async function testFailureDoesNotStopFollowingDirectories() {
  const scheduler = createCatalogPrefetchScheduler();
  const started = [];
  scheduler.enqueue([
    {
      key: 'failure',
      run: () => {
        started.push('failure');
        return Promise.reject(new Error('catalog unavailable'));
      },
    },
    {
      key: 'after-failure',
      run: () => started.push('after-failure'),
    },
  ]);
  await waitUntil(
    () => started.length === 2,
    'a failed directory prevented the next prefetch'
  );
  assert.deepStrictEqual(started, ['failure', 'after-failure']);
}

async function testUserActionPromotesQueuedModuleAheadOfBackgroundWork() {
  const scheduler = createCatalogPrefetchScheduler();
  const background = deferred();
  const userAction = deferred();
  const started = [];
  scheduler.enqueue([
    {
      key: 'active',
      run: () => {
        started.push('active');
        return background.promise;
      },
    },
    { key: 'user-module', run: () => started.push('background-user-module') },
    { key: 'later', run: () => started.push('later') },
  ]);
  await waitUntil(() => started.length === 1, 'background task did not start');

  const userPromise = scheduler.runPriority('user-module', () => {
    started.push('user-action');
    return userAction.promise;
  });
  assert.strictEqual(userPromise, userAction.promise);
  assert.deepStrictEqual(started, ['active', 'user-action']);

  background.resolve();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepStrictEqual(
    started,
    ['active', 'user-action'],
    'queued work must wait while a user action is loading'
  );

  userAction.resolve();
  await waitUntil(
    () => started.includes('later'),
    'background queue did not continue'
  );
  assert.deepStrictEqual(started, ['active', 'user-action', 'later']);
}

async function testEnteringActiveModuleReusesItsExistingPromise() {
  const scheduler = createCatalogPrefetchScheduler();
  const request = deferred();
  let requests = 0;
  let loaderCalls = 0;
  let loadPromise;
  const loadModule = () => {
    loaderCalls += 1;
    if (loadPromise) return loadPromise;
    requests += 1;
    loadPromise = request.promise;
    return loadPromise;
  };

  scheduler.enqueue([
    { key: 'current-module', run: loadModule },
    { key: 'later', run: () => {} },
  ]);
  await waitUntil(() => requests === 1, 'module prefetch did not start');
  const userPromise = scheduler.runPriority('current-module', loadModule);
  assert.strictEqual(userPromise, loadPromise);
  assert.strictEqual(requests, 1, 'entering the module must reuse its request');
  assert.strictEqual(
    loaderCalls,
    2,
    'the existing loader promise should be reused'
  );

  request.resolve();
  await userPromise;
}

Promise.all([
  testBackgroundDirectoriesRunOneAtATime(),
  testHiddenQueuePausesAndResumes(),
  testStoppedSchedulerDiscardsQueuedDirectories(),
  testFailureDoesNotStopFollowingDirectories(),
  testUserActionPromotesQueuedModuleAheadOfBackgroundWork(),
  testEnteringActiveModuleReusesItsExistingPromise(),
])
  .then(() => console.log('Karaoke catalog prefetch scheduler tests passed'))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
