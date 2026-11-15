const assert = require('assert');
const {
  createRequestId,
  createRequestSubmission,
} = require('../src/remote/requestSubmission.cjs');

async function run() {
  const generated = createRequestId({
    getRandomValues(bytes) {
      bytes.fill(7);
      return bytes;
    },
  });
  assert.match(
    generated,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    'request IDs use the browser-compatible UUID format'
  );

  let nextId = 0;
  let releaseRequest;
  let calls = 0;
  const concurrent = createRequestSubmission({
    createId: () => `request-concurrent-${++nextId}`,
    send: () => {
      calls += 1;
      return new Promise(resolve => {
        releaseRequest = () => resolve({ item: { queueItemId: 'queued-1' } });
      });
    },
  });
  const first = concurrent.submit('101', false);
  const duplicate = await concurrent.submit('101', true);
  assert.equal(duplicate.status, 'pending');
  assert.equal(calls, 1, 'rapid duplicate clicks share one active submission');
  releaseRequest();
  assert.equal((await first).status, 'confirmed');

  let queued = 0;
  const sent = [];
  const timedOut = createRequestSubmission({
    timeoutMs: 5,
    createId: () => `request-timeout-${++nextId}`,
    send: (payload, signal) => {
      sent.push(payload);
      if (
        !sent.some(
          item => item.requestId === payload.requestId && item !== payload
        )
      ) {
        queued += 1;
        return new Promise((_, reject) => {
          signal.addEventListener(
            'abort',
            () =>
              reject(
                Object.assign(new Error('timed out'), { name: 'AbortError' })
              ),
            { once: true }
          );
        });
      }
      return Promise.resolve({ item: { queueItemId: 'queued-timeout' } });
    },
  });
  const retried = await timedOut.submit('102', false);
  assert.equal(retried.status, 'confirmed');
  assert.equal(
    queued,
    1,
    'timeout retry is safe for an already-enqueued request'
  );
  assert.equal(sent.length, 2);
  assert.equal(
    sent[0].requestId,
    sent[1].requestId,
    'automatic timeout retry reuses the same idempotency key'
  );

  const unknownAttempts = [];
  let recovered = false;
  let uncertainNow = 0;
  const uncertain = createRequestSubmission({
    timeoutMs: 1,
    now: () => uncertainNow,
    duplicateWindowMs: 800,
    createId: () => `request-uncertain-${++nextId}`,
    send: payload => {
      unknownAttempts.push(payload);
      if (recovered)
        return Promise.resolve({ item: { queueItemId: 'queued-3' } });
      return Promise.reject(new TypeError('network unavailable'));
    },
  });
  const unknown = await uncertain.submit('103', true);
  assert.equal(unknown.status, 'unknown');
  assert.equal(uncertain.getState('103').status, 'unknown');
  const sameIntent = await uncertain.submit('103', false);
  assert.equal(sameIntent.status, 'unknown');
  assert.equal(
    unknownAttempts[0].requestId,
    unknownAttempts[2].requestId,
    'manual retry after an unknown outcome preserves the original request ID'
  );
  assert.equal(unknownAttempts[0].priority, true);
  assert.equal(
    unknownAttempts[2].priority,
    true,
    'retry preserves the original action when another button is tapped'
  );
  recovered = true;
  assert.equal((await uncertain.submit('103', false)).status, 'confirmed');
  assert.equal(uncertain.getState('103').status, 'cooldown');
  uncertainNow += 801;
  assert.equal(uncertain.getState('103'), null);

  const confirmedIds = [];
  let confirmedNow = 0;
  const confirmed = createRequestSubmission({
    now: () => confirmedNow,
    duplicateWindowMs: 700,
    createId: () => `request-repeat-${++nextId}`,
    send: payload => {
      confirmedIds.push(payload.requestId);
      return Promise.resolve({
        item: { queueItemId: `queued-${confirmedIds.length}` },
      });
    },
  });
  await confirmed.submit('104', false);
  assert.equal((await confirmed.submit('104', true)).status, 'duplicate');
  confirmedNow += 701;
  await confirmed.submit('104', false);
  assert.notEqual(
    confirmedIds[0],
    confirmedIds[1],
    'a confirmed song can be requested again with a fresh ID'
  );

  let failedCalls = 0;
  const definiteFailure = createRequestSubmission({
    createId: () => `request-failed-${++nextId}`,
    send: () => {
      failedCalls += 1;
      throw Object.assign(new Error('TRACK_NOT_PLAYABLE'), { status: 409 });
    },
  });
  await assert.rejects(() => definiteFailure.submit('105', false));
  assert.equal(failedCalls, 1, 'definite API failures are not retried');
  assert.equal(definiteFailure.getState('105'), null);

  const malformedReceipt = createRequestSubmission({
    createId: () => 'request-malformed-0001',
    send: async () => ({}),
  });
  assert.equal((await malformedReceipt.submit('106', false)).status, 'unknown');
  assert.equal(malformedReceipt.getState('106').status, 'unknown');

  console.log('KTV request submission concurrency/retry tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
