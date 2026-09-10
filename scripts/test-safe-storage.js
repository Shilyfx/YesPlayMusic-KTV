const assert = require('assert');
const babel = require('@babel/core');
const path = require('path');

const target = path.join(__dirname, '..', 'src', 'utils', 'safeStorage.js');
const source = babel.transformFileSync(target, {
  presets: ['@vue/cli-plugin-babel/preset'],
  plugins: ['@babel/plugin-transform-modules-commonjs'],
}).code;
const moduleRecord = { exports: {} };
new Function('require', 'module', 'exports', source)(
  require,
  moduleRecord,
  moduleRecord.exports
);
const { safeJsonRead, safeJsonWrite, isSettings } = moduleRecord.exports;

const values = new Map();
global.localStorage = {
  getItem(key) {
    return values.has(key) ? values.get(key) : null;
  },
  setItem(key, value) {
    values.set(key, String(value));
  },
};

assert.equal(safeJsonWrite('settings', { lang: 'zh-CN' }), true);
assert.deepEqual(safeJsonRead('settings', {}, isSettings), { lang: 'zh-CN' });
values.set('settings', '{malformed');
assert.deepEqual(safeJsonRead('settings', { lang: 'en' }, isSettings), {
  lang: 'en',
});
assert.equal(values.get('yesplaymusic.invalid.settings'), '{malformed');
values.set('settings', JSON.stringify(['wrong-shape']));
assert.deepEqual(safeJsonRead('settings', { lang: 'en' }, isSettings), {
  lang: 'en',
});
console.log('safe storage validation tests passed');
