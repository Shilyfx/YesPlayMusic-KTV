const assert = require('assert');
const fs = require('fs');
const path = require('path');
const postcss = require('postcss');
const { REACTION_ASSET_PATHS } = require('./reaction-assets.cjs');
const { ARTIST_PORTRAIT_PATHS } = require('./artist-portrait-assets.cjs');

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

const remoteStyles = assets
  .filter(([, directory]) => directory === 'css')
  .map(([, directory, asset]) =>
    fs.readFileSync(path.join(remoteRoot, directory, asset), 'utf8')
  )
  .join('\n');
const hiddenPublicGuestRules = [];
postcss.parse(remoteStyles).walkRules(rule => {
  if (!rule.selector.includes('.public-guest')) return;
  const hidesContent = rule.nodes.some(
    node => node.type === 'decl' && node.prop === 'display' && node.value === 'none'
  );
  if (hidesContent) hiddenPublicGuestRules.push(rule.selector);
});
assert.deepEqual(
  hiddenPublicGuestRules,
  [],
  'the generated public guest page keeps LAN remote controls visible'
);

for (const feature of [
  'data-module-tab="recommendations"',
  'data-module-tab="local-playlists"',
  'data-module-tab="playlists"',
  'data-next-track',
  'data-preview',
  'data-priority',
  'data-front',
  'data-remove',
  '互动应援站',
]) {
  assert.ok(
    remoteScripts.includes(feature),
    `the generated remote entry includes ${feature}`
  );
}

const reactionRoot = path.join(remoteRoot, 'js', 'reactions');
const reactionFiles = [];
function collectReactionFiles(directory, prefix = '') {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collectReactionFiles(absolute, relative);
    else reactionFiles.push(relative);
  }
}
assert.ok(
  fs.existsSync(reactionRoot),
  'reaction scripts are included in dist/remote'
);
collectReactionFiles(reactionRoot);
assert.deepEqual(
  reactionFiles.sort(),
  REACTION_ASSET_PATHS.slice().sort(),
  'the remote artifact contains all and only allowlisted reaction scripts'
);

const portraitRoot = path.join(remoteRoot, 'artist-portraits');
assert.ok(
  fs.existsSync(portraitRoot),
  'static featured artist portraits are included in dist/remote'
);
assert.deepEqual(
  fs.readdirSync(portraitRoot).sort(),
  ARTIST_PORTRAIT_PATHS.slice().sort(),
  'the remote artifact contains exactly the featured artist portraits'
);
console.log(`Remote bundle asset tests passed (${assets.length} assets)`);
