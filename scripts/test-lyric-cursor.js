const assert = require('assert');

require('./helpers/register-babel-src');

const findLyricIndex = require('../src/utils/lyricCursor').default;

const lines = [0, 1, 2, 5, 9].map(time => ({ time, content: String(time) }));
assert.strictEqual(findLyricIndex(lines, -1), -1);
assert.strictEqual(findLyricIndex(lines, 0.5), 0);
assert.strictEqual(findLyricIndex(lines, 4, 2), 2);
assert.strictEqual(findLyricIndex(lines, 5, 2), 3);
assert.strictEqual(findLyricIndex(lines, 8.5, 3), 3);
assert.strictEqual(findLyricIndex(lines, 2.5, 4), 2);
assert.strictEqual(findLyricIndex(lines, 99, 4), 4);
console.log('KTV lyric cursor tests passed');
