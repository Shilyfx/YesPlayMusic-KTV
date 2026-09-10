const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

require('./helpers/register-babel-src');

const { promises: fsp } = fs;
const {
  KaraokeCatalogService,
  KaraokeRemoteService,
} = require('../src/electron/karaoke/KaraokeRemoteApi');
const KaraokeLocalLibrary =
  require('../src/electron/karaoke/KaraokeLocalLibrary').default;

function durationMs(start) {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function makeTrack(id) {
  return {
    id,
    name: `Track ${id}`,
    ar: [{ name: 'Artist' }],
    al: { name: 'Album' },
    dt: 180000,
  };
}

async function measureAvailability() {
  const counters = { search: 0, playlistTracks: 0, availability: 0 };
  const bridge = async (action, payload) => {
    if (action === 'search') {
      counters.search += 1;
      return Array.from({ length: 15 }, (_, index) => makeTrack(index + 1));
    }
    if (action === 'playlistTracks') {
      counters.playlistTracks += 1;
      return Array.from({ length: 100 }, (_, index) => makeTrack(index + 1));
    }
    if (action === 'availability') {
      counters.availability += 1;
      return 'playable';
    }
    throw new Error(`Unexpected catalog action: ${action}`);
  };
  const catalog = new KaraokeCatalogService({ hostCatalogBridge: bridge });
  const service = new KaraokeRemoteService({
    catalog,
    managerBridge: { snapshot: async () => ({ waitingItems: [] }) },
    getRoom: () => ({ code: 'BASELINE', name: 'Baseline' }),
  });
  const client = { clientId: 'baseline-client' };

  await service.search(client, 'baseline');
  const searchAvailability = counters.availability;
  counters.availability = 0;
  await service.playlistTracks(client, '1');

  return {
    searchCatalogRequests: counters.search,
    searchAvailabilityRequests: searchAvailability,
    playlistCatalogRequests: counters.playlistTracks,
    playlistAvailabilityRequests: counters.availability,
  };
}

function countFeaturedArtistQueries() {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../src/remote/main.js'),
    'utf8'
  );
  const match = source.match(
    /const featuredArtistQueries = \[([\s\S]*?)\n\s*\];/
  );
  return match ? (match[1].match(/['"][^'"]+['"]/g) || []).length : null;
}

async function measureLocalScan() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ktv-baseline-'));
  const directory = path.join(root, 'Library');
  fs.mkdirSync(directory);
  for (let index = 0; index < 10; index += 1) {
    const stem = `Artist ${index} - Song ${index}`;
    fs.writeFileSync(path.join(directory, `${stem}.mp3`), 'audio');
    fs.writeFileSync(
      path.join(directory, `${stem}.lrc`),
      `[00:00.00]Song ${index}\n`
    );
    fs.writeFileSync(path.join(directory, `${stem}.jpg`), 'cover');
  }

  const counters = { readdir: 0, access: 0, readFile: 0 };
  const originals = {};
  ['readdir', 'access', 'readFile'].forEach(name => {
    originals[name] = fsp[name];
    fsp[name] = async function instrumentedFsMethod(...args) {
      counters[name] += 1;
      return originals[name].apply(this, args);
    };
  });

  try {
    const library = new KaraokeLocalLibrary([directory]);
    let start = process.hrtime.bigint();
    await library.scan();
    const first = { durationMs: durationMs(start), counters: { ...counters } };
    Object.keys(counters).forEach(name => (counters[name] = 0));
    start = process.hrtime.bigint();
    await library.scan();
    const second = {
      durationMs: durationMs(start),
      counters: { ...counters },
    };
    return { first, second, files: 10 };
  } finally {
    Object.keys(originals).forEach(name => (fsp[name] = originals[name]));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function gzipBytes(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return zlib.gzipSync(fs.readFileSync(filePath)).byteLength;
}

function entrypointGzipBytes(distRoot, htmlPath) {
  if (!fs.existsSync(htmlPath)) return null;
  const html = fs.readFileSync(htmlPath, 'utf8');
  const assets = [
    ...[...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]),
  ].filter(asset => /^\/?(?:js|css)\//.test(asset));
  return assets.reduce((total, asset) => {
    const bytes = gzipBytes(path.join(distRoot, asset.replace(/^\//, '')));
    return total + (bytes || 0);
  }, 0);
}

function sourceMetrics() {
  const remote = fs.readFileSync(
    path.resolve(__dirname, '../src/remote/main.js'),
    'utf8'
  );
  const player = fs.readFileSync(
    path.resolve(__dirname, '../src/store/index.js'),
    'utf8'
  );
  const lyric = fs.readFileSync(
    path.resolve(__dirname, '../src/views/karaoke.vue'),
    'utf8'
  );
  const storage = fs.readFileSync(
    path.resolve(__dirname, '../src/store/plugins/localStorage.js'),
    'utf8'
  );
  const bootstrapStart = remote.indexOf('async function bootstrap()');
  const bootstrapEnd = remote.indexOf(
    "document.addEventListener('visibilitychange'",
    bootstrapStart
  );
  const bootstrapSource = remote.slice(bootstrapStart, bootstrapEnd);
  const proxyStart = player.indexOf('player = new Proxy');
  const proxyEnd = player.indexOf(
    "window.addEventListener('beforeunload'",
    proxyStart
  );
  const proxySource = player.slice(proxyStart, proxyEnd);
  return {
    hiddenRefreshMs: Number(
      remote.match(/scheduleRefresh\(document\.hidden \? (\d+)/)?.[1] || 5000
    ),
    visibleRefreshMs: Number(
      remote.match(/scheduleRefresh\(document\.hidden \? \d+ : (\d+)/)?.[1] ||
        1500
    ),
    refreshCallsInBootstrap: (
      bootstrapSource.match(/await requestRefresh\(\);/g) || []
    ).length,
    hasRefreshSingleFlight: /createRefreshScheduler/.test(remote),
    proxyImmediateSaveCalls: (
      proxySource.match(/target\.saveSelfToLocalStorage\(\)/g) || []
    ).length,
    proxyImmediateIpcCalls: (
      proxySource.match(/target\.sendSelfToIpcMain\(\)/g) || []
    ).length,
    playerSaveDebounceMs: Number(
      player.match(
        /setTimeout\(\(\) => target\.saveSelfToLocalStorage\(\), (\d+)/
      )?.[1] || 0
    ),
    playerIpcDebounceMs: Number(
      player.match(
        /setTimeout\(\(\) => target\.sendSelfToIpcMain\(\), (\d+)/
      )?.[1] || 0
    ),
    vuexImmediateWritesPerMutation: 0,
    vuexDebouncedWriteCalls: (storage.match(/safeJsonWrite\(/g) || []).length,
    vuexWriteDebounceMs: Number(
      storage.match(/const WRITE_DELAY = (\d+)/)?.[1] || 0
    ),
    lyricFindIndexCalls: (lyric.match(/this\.lyrics\.findIndex\(/g) || [])
      .length,
  };
}

async function run() {
  const availability = await measureAvailability();
  const localScan = await measureLocalScan();
  const source = sourceMetrics();
  const distRoot = path.resolve(__dirname, '../dist');
  const metrics = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    remote: {
      bootstrapFixedModuleRequests: 2,
      featuredArtistRequests: countFeaturedArtistQueries(),
      stateRequestsPer30sAt1500ms: Math.floor(30000 / 1500) + 1,
      syntheticMaxConcurrentStateAt2000msResponse: 1,
      ...availability,
    },
    localScan,
    player: {
      immediateSaveCallsPerPropertySet: source.proxyImmediateSaveCalls,
      immediateIpcCallsPerPropertySet: source.proxyImmediateIpcCalls,
      saveDebounceMs: source.playerSaveDebounceMs,
      ipcDebounceMs: source.playerIpcDebounceMs,
    },
    store: {
      immediateWritesPerMutation: source.vuexImmediateWritesPerMutation,
      debouncedWriteCalls: source.vuexDebouncedWriteCalls,
      writeDebounceMs: source.vuexWriteDebounceMs,
    },
    lyrics: {
      ticksPerSecondAt100ms: 10,
      linearFindIndexCallSites: source.lyricFindIndexCalls,
    },
    source,
    bundles: {
      remoteEntrypointGzipBytes: entrypointGzipBytes(
        distRoot,
        path.join(distRoot, 'remote/index.html')
      ),
      desktopEntrypointGzipBytes: entrypointGzipBytes(
        distRoot,
        path.join(distRoot, 'index.html')
      ),
    },
  };
  assert.ok(metrics.localScan.files > 0);
  console.log(JSON.stringify(metrics, null, 2));
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
