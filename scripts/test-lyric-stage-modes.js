const assert = require('assert');
require('./helpers/register-babel-src');
const {
  normalizeStageMode,
  stageModeOptions,
  isPvStageMode,
} = require('../src/utils/lyricStageModes');

assert.deepStrictEqual(
  stageModeOptions.map(mode => mode.value),
  [
    'classic',
    'poem',
    'depth',
    'orbit',
    'sonnet',
    'tempera',
    'lumiere',
    'hanabi',
    'folia-classic',
    'cadenza',
    'partita',
    'fume',
    'tilt',
    'claddagh',
    'monet',
    'pendolo',
    'cappella',
    'diorama',
    'still',
  ]
);
for (const { value } of stageModeOptions) {
  assert.strictEqual(normalizeStageMode(value), value);
}
for (const mode of [
  'sonnet',
  'tempera',
  'lumiere',
  'hanabi',
  'folia-classic',
  'cadenza',
  'partita',
  'fume',
  'tilt',
  'claddagh',
  'monet',
  'pendolo',
  'cappella',
  'diorama',
  'still',
])
  assert.equal(isPvStageMode(mode), true);
for (const mode of ['classic', 'poem', 'depth', 'orbit'])
  assert.equal(isPvStageMode(mode), false);
for (const value of [undefined, null, '', 'unknown', {}, '__proto__']) {
  assert.strictEqual(normalizeStageMode(value), 'classic');
}
console.log('Lyric stage mode compatibility tests passed');
