const assert = require('assert/strict');
const {
  isPublicGuestStaticPath,
} = require('../src/server/PublicGuestStaticPaths.cjs');

for (const path of [
  '/room/',
  '/room/js/reactions/mood-mates/src/core/geometry.js',
  '/room/artist-portraits/6452.jpg',
  '/room/artist-portraits/14077324.JPG',
])
  assert.equal(isPublicGuestStaticPath('GET', path), true, path);

for (const [method, path] of [
  ['POST', '/room/artist-portraits/6452.jpg'],
  ['GET', '/room/artist-portraits/6452.png'],
  ['GET', '/room/artist-portraits/not-an-id.jpg'],
  ['GET', '/room/artist-portraits/6452/thumb.jpg'],
  ['GET', '/room/artist-portraits/../index.html'],
  ['GET', '/room/artist-portraits/'],
])
  assert.equal(
    isPublicGuestStaticPath(method, path),
    false,
    `${method} ${path}`
  );

console.log('Public guest static path allowlist tests passed');
