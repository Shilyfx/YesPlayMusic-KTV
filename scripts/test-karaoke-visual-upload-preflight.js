const assert = require('assert');
require('./helpers/register-babel-src');
const {
  normalizeAppearanceConfig,
  appendVisualAsset,
  createVisualAssetUploadQueue,
} = require('../src/karaoke/appearanceConfig');
const id = index => index.toString(16).padStart(64, 'a');
const file = index => ({
  name: `image-${index}.png`,
  size: 8,
  type: 'image/png',
});
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture(role, count = 0) {
  let config = normalizeAppearanceConfig({ mode: 'sonnet' });
  for (let index = 0; index < count; index++)
    config = appendVisualAsset(config, role, id(index), `saved-${index}`);
  let generation = 1;
  const persisted = [];
  const notices = [];
  let upload = async () => ({ id: id(100 + persisted.length) });
  const queue = createVisualAssetUploadQueue({
    getConfig: () => config,
    getGeneration: () => generation,
    upload: async (image, purpose) => {
      persisted.push({ image, purpose });
      return upload(image, purpose);
    },
    commit: next => {
      config = next;
    },
    notify: message => notices.push(message),
  });
  return {
    queue,
    persisted,
    notices,
    get config() {
      return config;
    },
    setConfig(value) {
      queue.assertFits(value);
      config = value;
    },
    setUpload(fn) {
      upload = fn;
    },
    advance() {
      generation++;
    },
  };
}
(async () => {
  for (const role of ['emoji', 'avatar', 'tempera']) {
    const state = fixture(role, 15);
    const pending = deferred();
    state.setUpload(() => pending.promise);
    const first = state.queue.run({ role, files: [file(1), file(2), file(3)] });
    const concurrent = state.queue.run({ role, files: [file(4), file(5)] });
    await flush();
    assert.equal(
      state.persisted.length,
      1,
      `${role}: reserve only the one remaining slot before concurrent batches await`
    );
    assert.deepEqual(await concurrent, []);
    pending.resolve({ id: id(200) });
    assert.deepEqual(await first, [true]);
    await state.queue.run({ role, files: [file(6)] });
    assert.equal(
      state.persisted.length,
      1,
      `${role}: no persistence once full`
    );
    assert.ok(state.notices.length);
  }
  const concurrent = fixture('emoji', 14);
  const gate = deferred();
  concurrent.setUpload(async () => {
    if (concurrent.persisted.length === 1) return gate.promise;
    return { id: id(201) };
  });
  const first = concurrent.queue.run({ role: 'emoji', files: [file(1)] });
  const second = concurrent.queue.run({
    role: 'emoji',
    files: [file(2), file(3)],
  });
  await flush();
  assert.equal(
    concurrent.persisted.length,
    1,
    'upload persistence is serialized across events'
  );
  gate.resolve({ id: id(200) });
  await Promise.all([first, second]);
  assert.equal(
    concurrent.persisted.length,
    2,
    'two available slots are shared across overlapping events'
  );
  assert.equal(
    concurrent.config.tuningByMode.cappella.emojiAssetIds.length,
    16
  );

  const dedup = fixture('emoji', 15);
  const sharedAssets = new Map([[id(0), 'legitimate shared image']]);
  dedup.setUpload(async () => ({ id: id(0) }));
  await dedup.queue.run({ role: 'emoji', files: [file(1)] });
  assert.equal(dedup.config.tuningByMode.cappella.emojiAssetIds.length, 15);
  assert.equal(
    sharedAssets.get(id(0)),
    'legitimate shared image',
    'deduplicated assets are never deleted'
  );

  const stale = fixture('avatar');
  const cancelled = stale.queue.run({
    role: 'avatar',
    files: [file(1), file(2)],
  });
  stale.advance();
  await cancelled;
  assert.equal(
    stale.persisted.length,
    0,
    'stale generations are rejected before persistence starts'
  );
  const active = fixture('avatar');
  const activeGate = deferred();
  active.setUpload(() => activeGate.promise);
  const activeBatch = active.queue.run({
    role: 'avatar',
    files: [file(1), file(2)],
  });
  await flush();
  active.advance();
  activeGate.resolve({ id: id(400) });
  await activeBatch;
  assert.equal(
    active.persisted.length,
    1,
    'generation changes prevent remaining queued persistence'
  );
  assert.equal(
    active.config.tuningByMode.cappella,
    undefined,
    'stale completions never overwrite settings'
  );

  const retry = fixture('emoji', 15);
  retry.setUpload(async () => {
    throw new Error('upload failed');
  });
  await retry.queue.run({ role: 'emoji', files: [file(1)] });
  retry.setUpload(async () => ({ id: id(300) }));
  await retry.queue.run({ role: 'emoji', files: [file(2)] });
  assert.equal(
    retry.config.tuningByMode.cappella.emojiAssetIds.length,
    16,
    'failure releases its reserved slot'
  );

  const capacity = fixture('emoji', 15);
  const capacityGate = deferred();
  capacity.setUpload(() => capacityGate.promise);
  const inFlight = capacity.queue.run({ role: 'emoji', files: [file(1)] });
  await flush();
  const externallyFull = appendVisualAsset(
    capacity.config,
    'emoji',
    id(500),
    'other'
  );
  assert.throws(
    () => capacity.setConfig(externallyFull),
    /16/,
    'settings changes cannot consume a reserved slot'
  );
  capacityGate.resolve({ id: id(600) });
  await inFlight;

  const baseline = normalizeAppearanceConfig({
    mode: 'sonnet',
    tuningByMode: { sonnet: { note: '!' } },
  });
  baseline.tuningByMode.sonnet.note = '!'.repeat(
    16 * 1024 - Buffer.byteLength(JSON.stringify(baseline), 'utf8') - 63
  );
  const full = normalizeAppearanceConfig(baseline);
  let persisted = 0;
  const byteQueue = createVisualAssetUploadQueue({
    getConfig: () => full,
    getGeneration: () => 1,
    upload: async () => {
      persisted++;
      return { id: id(700) };
    },
    commit: () => {},
    notify: () => {},
  });
  await byteQueue.run({ role: 'portrait', files: [file(1)] });
  assert.equal(
    persisted,
    0,
    'essential byte capacity is checked before image persistence'
  );
  const invalidFiles = fixture('emoji');
  await invalidFiles.queue.run({
    role: 'emoji',
    files: [
      { ...file(1), size: 5 * 1024 * 1024 },
      { ...file(2), type: 'image/svg+xml' },
    ],
  });
  assert.equal(
    invalidFiles.persisted.length,
    0,
    'invalid files are rejected before invoking either storage backend'
  );
  const byteReservations = fixture('emoji');
  const reserveBase = normalizeAppearanceConfig({
    mode: 'sonnet',
    tuningByMode: { sonnet: { note: '!' } },
  });
  const overhead = Buffer.byteLength(JSON.stringify(reserveBase), 'utf8') - 1;
  reserveBase.tuningByMode.sonnet.note = '!'.repeat(16 * 1024 - overhead - 220);
  byteReservations.setConfig(reserveBase);
  const byteGate = deferred();
  byteReservations.setUpload(() => byteGate.promise);
  const reservedBytes = byteReservations.queue.run({
    role: 'emoji',
    files: [file(1)],
  });
  const excessBytes = byteReservations.queue.run({
    role: 'avatar',
    files: [file(2)],
  });
  await flush();
  assert.equal(byteReservations.persisted.length, 1);
  assert.deepEqual(
    await excessBytes,
    [],
    'overlapping roles share reserved byte capacity as well as role slots'
  );
  byteGate.resolve({ id: id(800) });
  await reservedBytes;
  const disposed = fixture('tempera');
  const disposedBatch = disposed.queue.run({
    role: 'tempera',
    files: [file(1)],
  });
  disposed.queue.dispose();
  await disposedBatch;
  assert.equal(disposed.persisted.length, 0);
  console.log(
    'Visual upload batch capacity, reservations, generations, dedupe, and byte preflight tests passed'
  );
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
