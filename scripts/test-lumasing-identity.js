const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = relativePath =>
  fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

const config = read('vue.config.js');
const background = read('src/background.js');
const remote = read('src/remote/main.js');
const readme = read('README.md');
const player = read('src/utils/Player.js');
const legacyDatabase = read('src/utils/db.js');

assert.match(config, /productName: 'LumaSing'/);
assert.match(config, /owner: 'Shilyfx'/);
assert.match(config, /repo: 'YesPlayMusic-KTV'/);
assert.match(background, /title: 'LumaSing'/);
assert.match(
  background,
  /https:\/\/github\.com\/Shilyfx\/YesPlayMusic-KTV\/releases/
);
assert.match(remote, /LUMASING · LAN KTV/);
assert.match(readme, /<h2[^>]*>LumaSing<\/h2>/);

// These identifiers are intentionally retained for existing user data and
// renderer integrations while the visible product name changes.
assert.match(player, /window\.yesplaymusic\.player/);
assert.match(legacyDatabase, /new Dexie\('yesplaymusic'\)/);

console.log('LumaSing identity compatibility tests passed');
