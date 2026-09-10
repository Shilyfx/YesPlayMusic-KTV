const assert = require('assert');
const fs = require('fs');
const path = require('path');

const bundleRoot = path.join(__dirname, '..', 'dist_electron', 'bundled');
const indexPath = path.join(bundleRoot, 'index.html');
assert.ok(fs.existsSync(indexPath), 'build the Electron bundle first');

const html = fs.readFileSync(indexPath, 'utf8');
const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(
  match => match[1]
);

const vendorIndex = scripts.findIndex(source => source.includes('vendors~index'));
const entryIndex = scripts.findIndex(source => /\/js\/index\.[^/]+\.js$/.test(source));
assert.ok(vendorIndex >= 0, 'desktop HTML must load vendors~index');
assert.ok(entryIndex >= 0, 'desktop HTML must load the index entry');
assert.ok(vendorIndex < entryIndex, 'desktop vendor script must load before index');
assert.doesNotMatch(html, /app:\/\/\.\//, 'desktop HTML must use HTTP assets');

scripts.forEach(source => {
  const scriptPath = path.join(bundleRoot, source.replace(/^\//, ''));
  assert.ok(fs.existsSync(scriptPath), `missing desktop script: ${source}`);
  assert.doesNotMatch(
    fs.readFileSync(scriptPath, 'utf8'),
    /app:\/\/\.\//,
    `desktop script must use HTTP public paths: ${source}`
  );
});

console.log(`Electron desktop bundle tests passed (${scripts.length} scripts)`);
