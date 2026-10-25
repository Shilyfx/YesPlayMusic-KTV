const assert = require('assert');
require('./helpers/register-babel-src');
const {
  normalizeStageMode,
  stageModeOptions,
} = require('../src/utils/lyricStageModes');

assert.deepStrictEqual(
  stageModeOptions.map(mode => mode.value),
  ['classic', 'poem', 'depth', 'orbit']
);
for (const { value } of stageModeOptions) {
  assert.strictEqual(normalizeStageMode(value), value);
}
for (const value of [undefined, null, '', 'unknown', {}, '__proto__']) {
  assert.strictEqual(normalizeStageMode(value), 'classic');
}
console.log('Lyric stage mode compatibility tests passed');
