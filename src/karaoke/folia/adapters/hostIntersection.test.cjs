const assert = require('assert');

let createHostIntersectionHandler;
try {
  ({ createHostIntersectionHandler } = require('./hostIntersection.cjs'));
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

assert.strictEqual(
  typeof createHostIntersectionHandler,
  'function',
  'the stage must retain IntersectionObserver entries in its host callback'
);

const host = {};
let intersecting = true;
let updates = 0;
const callback = createHostIntersectionHandler(host, value => {
  intersecting = value;
  updates += 1;
});

callback([{ target: {}, isIntersecting: false }]);
assert.strictEqual(intersecting, true, 'entries for other targets must be ignored');
assert.strictEqual(updates, 0);

callback([{ target: host, isIntersecting: false }]);
assert.strictEqual(intersecting, false, 'an offscreen host must suspend its RAF');

callback([{ target: host, isIntersecting: true }]);
assert.strictEqual(intersecting, true, 'a visible host must resume its RAF');
assert.strictEqual(updates, 2);

console.log('PASS: IntersectionObserver callback suspends and resumes the host visibility state');
