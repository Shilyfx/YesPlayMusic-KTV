'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  resolveRemotePathConfig,
  resolveStaticAssetPath,
} = require('./remoteApi.cjs');
const {
  isPublicGuestStaticPath,
} = require('../../src/server/PublicGuestStaticPaths.cjs');

const remoteEntry = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');

assert.strictEqual(
  /const reactionsEnabled =\s*process\.env\.VUE_APP_DOCKER_KTV === 'true'\s*\|\|\s*process\.env\.IS_ELECTRON === true;/.test(
    remoteEntry
  ),
  true,
  'reaction UI should be enabled for Docker and Electron builds'
);
assert.strictEqual(
  /if \(reactionsEnabled\)\s*\{\s*firstPanel\?\.insertAdjacentHTML\(\s*'afterend',\s*reactionController\.studioMarkup\(\)\s*\);/.test(
    remoteEntry
  ),
  true,
  'the reaction studio DOM should be guarded by the shared platform flag'
);
assert.strictEqual(
  /if \(reactionsEnabled\)\s*\{\s*app\s*\.querySelector\('\.module-tabs'\)\s*\?\.insertAdjacentHTML\(\s*'beforeend',\s*reactionController\.tabMarkup\(\)\s*\);/.test(
    remoteEntry
  ),
  true,
  'the reaction tab should use the same platform guard'
);
assert.strictEqual(
  /if \(reactionsEnabled\)\s*reactionController\.bind\(\);/.test(remoteEntry),
  true,
  'reaction event handlers should only bind where the UI is available'
);

const artistCoverResolverMatch = remoteEntry.match(
  /function resolveArtistCoverUrl\(coverUrl\) \{[\s\S]*?^\}/m
);
assert.strictEqual(
  Boolean(artistCoverResolverMatch),
  true,
  'artist portraits should use the room static asset route'
);
assert.strictEqual(
  (remoteEntry.match(/resolveArtistCoverUrl\(artist\.coverUrl\)/g) || [])
    .length,
  2,
  'both artist result lists should use the room-aware portrait URL'
);
assert.strictEqual(
  fs.existsSync(
    path.join(__dirname, '../../public/artist-portraits/6452.jpg')
  ),
  true,
  'the portrait URL should resolve to the real 6452.jpg asset'
);

for (const [context, pathname, expectedUrl] of [
  ['legacy public room', '/room/', '/room/artist-portraits/6452.jpg'],
  [
    'multi-room public page',
    '/r/room-one/room/',
    '/r/room-one/room/artist-portraits/6452.jpg',
  ],
  ['LAN room page', '/room/', '/room/artist-portraits/6452.jpg'],
]) {
  const resolveArtistCoverUrl = vm.runInNewContext(
    `(${artistCoverResolverMatch[0]})`,
    {
      remotePathConfig: resolveRemotePathConfig(pathname),
      resolveStaticAssetPath,
    }
  );
  assert.strictEqual(
    resolveArtistCoverUrl('/artist-portraits/6452.jpg'),
    expectedUrl,
    `${context} should use the static portrait URL ${expectedUrl}`
  );
  const upstreamPath = expectedUrl.replace(/^\/r\/[^/]+/, '');
  assert.strictEqual(
    isPublicGuestStaticPath('GET', upstreamPath),
    true,
    `${context} portrait should match the public static path allowlist`
  );
}

console.log('PASS: remote entry routes portraits and enables platform UI');
