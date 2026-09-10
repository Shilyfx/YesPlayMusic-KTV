const assert = require('assert');
const fs = require('fs');
const path = require('path');

const remoteRoot = path.join(__dirname, '..', 'dist', 'remote');
const indexPath = path.join(remoteRoot, 'index.html');
assert.ok(fs.existsSync(indexPath), 'build dist/remote/index.html first');

const html = fs.readFileSync(indexPath, 'utf8');
assert.doesNotMatch(html, /chunk-(?:vendors|common)/);
assert.doesNotMatch(html, /(?:app:\/\/\.|)\/(?:js|css)\//);

const assets = [...html.matchAll(/(?:href|src)="(css|js)\/([^"]+)"/g)];
assert.ok(assets.length > 0, 'Remote HTML should reference its entry assets');
assets.forEach(([, directory, asset]) => {
  assert.ok(
    fs.existsSync(path.join(remoteRoot, directory, asset)),
    `missing Remote asset: ${directory}/${asset}`
  );
});

const remoteScripts = assets
  .filter(([, directory]) => directory === 'js')
  .map(([, directory, asset]) =>
    fs.readFileSync(path.join(remoteRoot, directory, asset), 'utf8')
  )
  .join('\n');
assert.doesNotMatch(
  remoteScripts,
  /chunk-vendors/,
  'Remote entry must not wait for a desktop-only vendor chunk'
);

console.log(`Remote bundle asset tests passed (${assets.length} assets)`);
