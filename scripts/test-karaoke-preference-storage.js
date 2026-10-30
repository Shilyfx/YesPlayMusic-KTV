const assert = require('assert');
require('./helpers/register-babel-src');

const {
  writeMasterAppearancePreferences,
} = require('../src/karaoke/appearanceConfig');
const {
  writeDisplayPreferences,
} = require('../src/karaoke/displayPreferences');
const {
  writeSmartBeatPreferences,
} = require('../src/karaoke/smartBeatPreferences');

const writers = [
  {
    name: 'master appearance',
    key: 'lumasing.ktv.appearance.master.v1',
    write: writeMasterAppearancePreferences,
    initial: { animationIntensity: 'calm' },
    changed: { animationIntensity: 'chaotic' },
    changedField: 'animationIntensity',
    changedValue: 'chaotic',
  },
  {
    name: 'display',
    key: 'lumasing.ktv.display.preferences.v1',
    write: writeDisplayPreferences,
    initial: { mode: 'orbit', effect: 'neon', offset: 1 },
    changed: { mode: 'orbit', effect: 'neon', offset: 2 },
    changedField: 'offset',
    changedValue: 2,
  },
  {
    name: 'SmartBeat',
    key: 'lumasing.ktv.smartbeat.preferences.v1',
    write: writeSmartBeatPreferences,
    initial: { mode: 'on', beatStrength: 0.6 },
    changed: { mode: 'on', beatStrength: 0.8 },
    changedField: 'beatStrength',
    changedValue: 0.8,
  },
];

function createStorage() {
  const values = new Map();
  const setCalls = [];
  return {
    values,
    setCalls,
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      setCalls.push({ key, value });
      values.set(key, value);
    },
  };
}

for (const writer of writers) {
  const storage = createStorage();
  for (let index = 0; index < 10; index++)
    assert.strictEqual(writer.write(writer.initial, storage), true);
  assert.strictEqual(
    storage.setCalls.length,
    1,
    `${writer.name}: ten identical writes should persist once`
  );

  assert.strictEqual(writer.write(writer.changed, storage), true);
  assert.strictEqual(
    storage.setCalls.length,
    2,
    `${writer.name}: a changed value should persist immediately`
  );
  assert.strictEqual(storage.setCalls[1].key, writer.key);
  assert.strictEqual(
    JSON.parse(storage.values.get(writer.key))[writer.changedField],
    writer.changedValue
  );

  storage.values.set(writer.key, '{"external":"newer tab value"}');
  assert.strictEqual(writer.write(writer.changed, storage), true);
  assert.strictEqual(
    storage.setCalls.length,
    3,
    `${writer.name}: an external overwrite should be repaired`
  );
  assert.strictEqual(
    storage.values.get(writer.key),
    storage.setCalls[1].value,
    `${writer.name}: the current normalized value should repair external storage`
  );

  let fallbackWrites = 0;
  assert.strictEqual(
    writer.write(writer.initial, {
      setItem() {
        fallbackWrites++;
      },
    }),
    true,
    `${writer.name}: storage without getItem should retain write behavior`
  );
  assert.strictEqual(fallbackWrites, 1);

  let throwingReadWrites = 0;
  assert.strictEqual(
    writer.write(writer.initial, {
      getItem() {
        throw new Error('read denied');
      },
      setItem() {
        throwingReadWrites++;
      },
    }),
    true,
    `${writer.name}: a failed read should still attempt the write`
  );
  assert.strictEqual(throwingReadWrites, 1);

  let quotaAttempts = 0;
  const quotaStorage = {
    value: null,
    getItem() {
      return this.value;
    },
    setItem(_key, value) {
      quotaAttempts++;
      if (quotaAttempts === 1) throw new Error('quota exceeded');
      this.value = value;
    },
  };
  assert.strictEqual(writer.write(writer.initial, quotaStorage), false);
  assert.strictEqual(writer.write(writer.initial, quotaStorage), true);
  assert.strictEqual(writer.write(writer.initial, quotaStorage), true);
  assert.strictEqual(
    quotaAttempts,
    2,
    `${writer.name}: failed writes retry and successful values dedupe`
  );
}

const sharedStorage = createStorage();
for (const writer of writers)
  assert.strictEqual(writer.write(writer.initial, sharedStorage), true);
assert.deepStrictEqual(
  sharedStorage.setCalls.map(call => call.key).sort(),
  writers.map(writer => writer.key).sort(),
  'independent preference keys should each persist once in one storage object'
);
for (const writer of writers)
  assert.strictEqual(writer.write(writer.initial, sharedStorage), true);
assert.strictEqual(sharedStorage.setCalls.length, writers.length);

const separateStorage = createStorage();
assert.strictEqual(writers[0].write(writers[0].initial, separateStorage), true);
assert.strictEqual(
  separateStorage.setCalls.length,
  1,
  'a different storage object must not inherit another object’s dedupe state'
);

const oversizedAppearance = {
  mode: 'sonnet',
  tuningByMode: { sonnet: { note: '当前!'.repeat(3000) } },
};
const priorAppearance = '{"previous":"valid stored value"}';
const protectedStorage = createStorage();
protectedStorage.values.set(writers[0].key, priorAppearance);
assert.strictEqual(
  writers[0].write(oversizedAppearance, protectedStorage),
  false
);
assert.strictEqual(protectedStorage.setCalls.length, 0);
assert.strictEqual(
  protectedStorage.values.get(writers[0].key),
  priorAppearance,
  'oversized appearance preferences must not replace stored data'
);

console.log(
  'Karaoke preference storage dedupe, repair, fallbacks, retries, and isolation tests passed'
);
