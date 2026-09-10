const assert = require('assert');

require('./helpers/register-babel-src');

const createRefreshScheduler =
  require('../src/remote/refreshScheduler').default;

async function testSingleFlightAndQueuedRefresh() {
  let active = 0;
  let maxActive = 0;
  let runs = 0;
  let release;
  const firstRun = new Promise(resolve => {
    release = resolve;
  });
  const scheduler = createRefreshScheduler(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    runs += 1;
    if (runs === 1) await firstRun;
    active -= 1;
  });

  const first = scheduler();
  const second = scheduler();
  assert.strictEqual(
    first,
    second,
    'concurrent refreshes should share a promise'
  );
  release();
  await first;
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(maxActive, 1, 'refreshes must never overlap');
  assert.strictEqual(
    runs,
    2,
    'a queued refresh should run once after the first'
  );
}

async function testStoppedScheduler() {
  let allowed = true;
  let runs = 0;
  const scheduler = createRefreshScheduler(
    async () => {
      runs += 1;
    },
    () => allowed
  );
  allowed = false;
  await scheduler();
  assert.strictEqual(runs, 0, 'ended rooms should not start another refresh');
}

Promise.all([testSingleFlightAndQueuedRefresh(), testStoppedScheduler()])
  .then(() => console.log('KTV remote polling tests passed'))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
