const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const sha256 = name =>
  crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(dist, name)))
    .digest('hex');
const manifest = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
  builtAt: new Date().toISOString(),
  indexSha256: sha256('index.html'),
  serverSha256: sha256('ktv-server.cjs'),
};
fs.writeFileSync(
  path.join(dist, 'ktv-release.json'),
  JSON.stringify(manifest, null, 2) + '\n'
);
console.log(JSON.stringify(manifest));
