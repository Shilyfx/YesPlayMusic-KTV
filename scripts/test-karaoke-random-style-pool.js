const assert = require('assert');
const fs = require('fs');
const path = require('path');
require('./helpers/register-babel-src');

const modulePath = path.resolve(__dirname, '../src/karaoke/randomStylePool.js');
assert.ok(fs.existsSync(modulePath), 'the random style pool module exists');
const {
  chooseRandomStyle,
  normalizeRandomStyleSettings,
  resolveRandomStyleForTrack,
} = require(modulePath);

const modes = require('../src/utils/lyricStageModes').stageModeOptions;
const normalized = normalizeRandomStyleSettings({
  enabled: true,
  pool: ['sonnet', 'sonnet', 'still', 'random', '__proto__'],
  lastTrackKey: '  queue:one\n',
});
assert.deepStrictEqual(normalized, {
  enabled: true,
  pool: ['sonnet', 'still'],
  lastTrackKey: 'queue:one',
});
assert.deepStrictEqual(
  normalizeRandomStyleSettings({ enabled: true, pool: [] }).pool,
  [],
  'an explicitly empty pool stays empty so the user can disable every choice'
);
assert.strictEqual(
  chooseRandomStyle(['sonnet', 'tempera'], 'tempera', () => 0),
  'sonnet',
  'random selection avoids repeating the current mode when another choice exists'
);
assert.strictEqual(
  chooseRandomStyle(['tempera'], 'tempera', () => 0),
  'tempera',
  'a single-item pool remains selectable'
);

const firstSong = resolveRandomStyleForTrack(
  normalized,
  'queue:two',
  'sonnet',
  () => 0
);
assert.strictEqual(firstSong.mode, 'still');
assert.strictEqual(firstSong.settings.lastTrackKey, 'queue:two');
const repeatedPoll = resolveRandomStyleForTrack(
  firstSong.settings,
  'queue:two',
  firstSong.mode,
  () => 0.99
);
assert.strictEqual(repeatedPoll.mode, firstSong.mode);
assert.strictEqual(repeatedPoll.changed, false);
assert.strictEqual(
  resolveRandomStyleForTrack(
    { ...normalized, enabled: false },
    'queue:three',
    'sonnet',
    () => 0
  ).changed,
  false,
  'disabled random selection leaves the actual mode alone'
);

console.log('Karaoke random style pool tests passed');
