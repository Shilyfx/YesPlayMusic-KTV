const assert = require('assert');

require('./helpers/register-babel-src');

const {
  KaraokeCatalogService,
} = require('../src/electron/karaoke/KaraokeRemoteApi');
const createUserPlaylistCache =
  require('../src/electron/userPlaylistCache').default;

async function testCatalogSingleFlight() {
  let availabilityCalls = 0;
  let trackDetailCalls = 0;
  const bridge = async action => {
    if (action === 'availability') {
      availabilityCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return 'playable';
    }
    if (action === 'trackDetail') {
      trackDetailCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return { id: 1, name: 'Track', ar: [], al: {}, dt: 1 };
    }
    throw new Error(`Unexpected action: ${action}`);
  };
  const catalog = new KaraokeCatalogService({ hostCatalogBridge: bridge });
  await Promise.all([
    catalog.availability('1'),
    catalog.availability('1'),
    catalog.availability('1', { fresh: true }),
  ]);
  await Promise.all([catalog.getTrack('1'), catalog.getTrack('1')]);
  assert.strictEqual(availabilityCalls, 1);
  assert.strictEqual(trackDetailCalls, 1);
  assert.strictEqual(catalog.peekAvailability('1'), 'playable');
}

async function testPlaylistAllowlistSingleFlight() {
  const cache = createUserPlaylistCache();
  let calls = 0;
  const fetchPlaylists = async () => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 5));
    return [{ id: '9001' }];
  };
  const [first, second] = await Promise.all([
    cache({ userId: '42', fetchPlaylists }),
    cache({ userId: '42', fetchPlaylists }),
  ]);
  assert.deepStrictEqual(first, second);
  assert.strictEqual(calls, 1);
  await cache({ userId: '42', fetchPlaylists });
  assert.strictEqual(calls, 1);
  await cache({ userId: '42', fetchPlaylists, force: true });
  assert.strictEqual(calls, 2);
}

Promise.all([testCatalogSingleFlight(), testPlaylistAllowlistSingleFlight()])
  .then(() => console.log('KTV catalog dedupe tests passed'))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
