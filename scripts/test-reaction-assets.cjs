const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isolateRemoteAssets } = require('./isolate-remote-assets');
const { REACTION_ASSET_PATHS } = require('./reaction-assets.cjs');

const expectedPaths = [
  'emotion-ball/js/rings.js',
  'emotion-ball/js/emotions.js',
  'emotion-ball/js/ball.js',
  'emotion-ball/js/engine.js',
  'mood-mates/src/core/geometry.js',
  'mood-mates/src/core/render.js',
  'mood-mates/src/core/features.js',
  'mood-mates/src/core/fx.js',
  'mood-mates/src/data/emotions.js',
  'mood-mates/src/core/engine.js',
  'mood-mates/src/characters/nimbo.js',
  'mood-mates/src/characters/twinkle.js',
];
assert.deepEqual(REACTION_ASSET_PATHS, expectedPaths);

const fixtureRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), 'lumasing-reaction-assets-')
);
const distRoot = path.join(fixtureRoot, 'dist');
const remoteRoot = path.join(distRoot, 'remote');
const sourceRoot = path.resolve(__dirname, '..');
const sourceAssets = path.join(sourceRoot, 'public', 'reactions');
const remoteAssets = path.join(remoteRoot, 'js', 'reactions');
try {
  fs.mkdirSync(remoteRoot, { recursive: true });
  for (const relativePath of REACTION_ASSET_PATHS) {
    const source = path.join(sourceAssets, relativePath);
    assert.ok(
      fs.statSync(source).isFile(),
      `source asset exists: ${relativePath}`
    );
  }
  const remoteEntry = path.join(distRoot, 'js', 'remote.js');
  fs.mkdirSync(path.dirname(remoteEntry), { recursive: true });
  fs.writeFileSync(remoteEntry, 'window.remote = true;');
  fs.writeFileSync(
    path.join(remoteRoot, 'index.html'),
    '<script src="/js/remote.js"></script>'
  );
  fs.mkdirSync(remoteAssets, { recursive: true });
  fs.writeFileSync(path.join(remoteAssets, 'stale.js'), 'stale build file');

  isolateRemoteAssets(distRoot, sourceRoot);

  const copiedPaths = [];
  function collect(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = path.posix.join(prefix, entry.name);
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(absolute, relative);
      else copiedPaths.push(relative);
    }
  }
  collect(remoteAssets);
  assert.deepEqual(copiedPaths.sort(), expectedPaths.slice().sort());
  for (const relativePath of expectedPaths) {
    assert.deepEqual(
      fs.readFileSync(path.join(remoteAssets, relativePath)),
      fs.readFileSync(path.join(sourceAssets, relativePath)),
      `copied source content: ${relativePath}`
    );
  }
  assert.equal(
    fs.existsSync(path.join(remoteAssets, 'mood-mates', 'LICENSE')),
    false,
    'the remote artifact omits source licenses and other unlisted files'
  );
  assert.equal(
    fs.readFileSync(path.join(remoteRoot, 'index.html'), 'utf8'),
    '<script src="js/remote.js"></script>'
  );
  assert.equal(
    fs.readFileSync(path.join(remoteRoot, 'js', 'remote.js'), 'utf8'),
    'window.remote = true;'
  );
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log('Reaction asset copy allowlist tests passed');
