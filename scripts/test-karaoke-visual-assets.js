const assert = require('assert');
const http = require('http');
const os = require('os');
const path = require('path');
const { promises: fs } = require('fs');
require('./helpers/register-babel-src');
const KaraokeWebHost = require('../src/server/KaraokeWebHost').default;

const ORIGIN = 'http://127.0.0.1';
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);

async function withHost(run) {
  const host = new KaraokeWebHost({ publicOrigin: ORIGIN });
  host.owner = { token: 'visual-asset-host-token', lastSeen: Date.now() };
  host.generation = 7;
  const server = http.createServer((request, response) =>
    host.handle(request, response)
  );
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await run({
      host,
      base: `http://127.0.0.1:${address.port}`,
      upload: (base, bytes = PNG, options = {}) =>
        fetch(`${base}/ktv/host/visual-assets`, {
          method: 'POST',
          headers: {
            Origin: ORIGIN,
            Authorization: 'Bearer visual-asset-host-token',
            'Content-Type': 'image/png',
            ...options.headers,
          },
          body: bytes,
        }),
    });
  } finally {
    host.close();
    await new Promise(resolve => server.close(resolve));
  }
}

async function testAuthenticatedBinaryUploadAndImmutableRead() {
  await withHost(async ({ base, upload }) => {
    const uploaded = await upload(base);
    assert.equal(uploaded.status, 200, 'valid PNG upload succeeds');
    const asset = await uploaded.json();
    assert.match(asset.id, /^[a-f0-9]{64}$/);
    assert.equal(
      asset.id,
      require('crypto').createHash('sha256').update(PNG).digest('hex')
    );
    assert.equal(asset.url, `/ktv/display/visual-assets/${asset.id}`);
    assert.equal(asset.mime, 'image/png');

    const fetched = await fetch(`${base}${asset.url}`);
    assert.equal(fetched.status, 200);
    assert.equal(fetched.headers.get('content-type'), 'image/png');
    assert.equal(fetched.headers.get('x-content-type-options'), 'nosniff');
    assert.match(fetched.headers.get('cache-control'), /immutable/);
    assert.deepEqual(Buffer.from(await fetched.arrayBuffer()), PNG);
  });
}

async function testUploadAuthenticationAndImageSignatures() {
  await withHost(async ({ base, upload }) => {
    const unauthenticated = await fetch(`${base}/ktv/host/visual-assets`, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'image/png' },
      body: PNG,
    });
    assert.equal(unauthenticated.status, 401);

    const wrongOrigin = await fetch(`${base}/ktv/host/visual-assets`, {
      method: 'POST',
      headers: {
        Origin: 'http://attacker.invalid',
        Authorization: 'Bearer visual-asset-host-token',
        'Content-Type': 'image/png',
      },
      body: PNG,
    });
    assert.equal(wrongOrigin.status, 403);

    const badMagic = await upload(base, Buffer.from('not an image'));
    assert.equal(badMagic.status, 415);
    const mismatchedType = await upload(base, PNG, {
      headers: { 'Content-Type': 'image/jpeg' },
    });
    assert.equal(mismatchedType.status, 415);

    const images = [
      ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01])],
      ['image/webp', Buffer.from('RIFF\x04\x00\x00\x00WEBPVP8 ')],
      ['image/gif', Buffer.from('GIF89a\x01\x00\x01\x00')],
    ];
    for (const [mime, bytes] of images) {
      const response = await upload(base, bytes, {
        headers: { 'Content-Type': mime },
      });
      assert.equal(response.status, 200, `${mime} signature is accepted`);
      assert.equal((await response.json()).mime, mime);
    }
    const tempera = await upload(base, PNG, {
      headers: { 'X-KTV-Visual-Asset-Role': 'tempera' },
    });
    assert.equal(
      tempera.status,
      200,
      'Tempera role uses the shared image path'
    );
  });
}

async function testUploadAndStoreBoundsAndDeduplication() {
  await withHost(async ({ base, host, upload }) => {
    const tooLarge = await upload(
      base,
      Buffer.concat([PNG, Buffer.alloc(4 * 1024 * 1024)])
    );
    assert.equal(tooLarge.status, 413, 'oversize body is rejected');
    assert.equal(host.visualAssetStore.size, 0, 'oversize body is not stored');

    const chunkedTooLarge = await new Promise((resolve, reject) => {
      const target = new URL(`${base}/ktv/host/visual-assets`);
      const request = http.request(
        {
          hostname: target.hostname,
          port: target.port,
          path: target.pathname,
          method: 'POST',
          headers: {
            Origin: ORIGIN,
            Authorization: 'Bearer visual-asset-host-token',
            'Content-Type': 'image/png',
          },
        },
        response => {
          response.resume();
          response.on('end', () => resolve(response.statusCode));
        }
      );
      request.on('error', reject);
      request.write(PNG);
      request.end(Buffer.alloc(4 * 1024 * 1024));
    });
    assert.equal(chunkedTooLarge, 413, 'chunked oversize upload is rejected');
    assert.equal(
      host.visualAssetStore.size,
      0,
      'chunked oversize is not stored'
    );

    const first = await upload(base);
    const firstAsset = await first.json();
    for (let index = 0; index < 32; index++) {
      const duplicate = await upload(base);
      assert.equal((await duplicate.json()).id, firstAsset.id);
    }
    assert.equal(host.visualAssetStore.size, 1, 'same content is stored once');
    assert.equal(host.visualAssetStore.totalBytes, PNG.length);

    for (let index = 1; index < 32; index++) {
      const distinct = Buffer.concat([PNG, Buffer.from([index])]);
      const response = await upload(base, distinct);
      assert.equal(response.status, 200);
    }
    assert.equal(host.visualAssetStore.size, 32);
    const full = await upload(base, Buffer.concat([PNG, Buffer.from([33])]));
    assert.equal(full.status, 413, 'asset count cap is enforced');
  });
}

async function testOwnerResetDuringUploadDoesNotStoreOrLeakRoomState() {
  await withHost(async ({ base, host, upload }) => {
    const target = new URL(`${base}/ktv/host/visual-assets`);
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Authorization: 'Bearer visual-asset-host-token',
        'Content-Type': 'image/png',
        'Content-Length': PNG.length,
      },
    });
    const responsePromise = new Promise((resolve, reject) => {
      request.on('response', response => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      });
      request.on('error', reject);
    });
    request.write(PNG.subarray(0, 8));
    await new Promise(resolve => setTimeout(resolve, 20));
    host.close();
    host.owner = { token: 'replacement-host-token', lastSeen: Date.now() };
    host.generation++;
    request.end(PNG.subarray(8));
    assert.equal(await responsePromise, 401);
    assert.equal(
      host.visualAssetStore.size,
      0,
      'stale upload never enters the store'
    );

    const replacementDisplay = await fetch(`${base}/ktv/display`).then(r =>
      r.json()
    );
    assert.equal(replacementDisplay.active, true);
    assert.equal(Object.hasOwn(replacementDisplay, 'visualAssets'), false);
    assert.equal(
      (
        await upload(base, PNG, {
          headers: {
            Authorization: 'Bearer replacement-host-token',
          },
        })
      ).status,
      200
    );
  });
}

async function testConcurrentUploadSlotsAreBounded() {
  await withHost(async ({ base, host, upload }) => {
    const begin = () => {
      const target = new URL(`${base}/ktv/host/visual-assets`);
      const request = http.request({
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: 'POST',
        headers: {
          Origin: ORIGIN,
          Authorization: 'Bearer visual-asset-host-token',
          'Content-Type': 'image/png',
          'Content-Length': PNG.length,
        },
      });
      const response = new Promise((resolve, reject) => {
        request.on('response', result => {
          result.resume();
          result.on('end', () => resolve(result.statusCode));
        });
        request.on('error', reject);
      });
      request.write(PNG.subarray(0, 8));
      return { request, response };
    };
    const first = begin();
    const second = begin();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(host.visualAssetUploads, 2);
    assert.equal((await upload(base)).status, 429);
    first.request.end(PNG.subarray(8));
    second.request.end(PNG.subarray(8));
    assert.deepEqual(
      await Promise.all([first.response, second.response]),
      [200, 200]
    );
    assert.equal(host.visualAssetUploads, 0);
  });
}

async function testTotalStoreByteLimit() {
  await withHost(async ({ base, host, upload }) => {
    const maxBytes = 4 * 1024 * 1024;
    for (let index = 0; index < 8; index++) {
      const bytes = Buffer.alloc(maxBytes, index + 1);
      PNG.copy(bytes, 0);
      bytes[8] = index;
      const response = await upload(base, bytes);
      assert.equal(response.status, 200, 'each 4 MiB image fits the total cap');
    }
    assert.equal(host.visualAssetStore.totalBytes, 32 * 1024 * 1024);
    const over = await upload(base, Buffer.concat([PNG, Buffer.from([9])]));
    assert.equal(over.status, 413, 'aggregate storage cap is enforced');
  });
}

async function testPersistentAssetsSurviveHostRestart() {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'lumasing-visual-assets-')
  );
  const firstHost = new KaraokeWebHost({
    publicOrigin: ORIGIN,
    assetDirectory: directory,
  });
  firstHost.owner = { token: 'visual-asset-host-token', lastSeen: Date.now() };
  firstHost.generation = 7;
  const firstServer = http.createServer((request, response) =>
    firstHost.handle(request, response)
  );
  await new Promise(resolve => firstServer.listen(0, '127.0.0.1', resolve));
  const firstBase = `http://127.0.0.1:${firstServer.address().port}`;
  let asset;
  try {
    const response = await fetch(`${firstBase}/ktv/host/visual-assets`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        Authorization: 'Bearer visual-asset-host-token',
        'Content-Type': 'image/png',
      },
      body: PNG,
    });
    assert.equal(response.status, 200);
    asset = await response.json();
  } finally {
    firstHost.close();
    await new Promise(resolve => firstServer.close(resolve));
  }

  const nextHost = new KaraokeWebHost({
    publicOrigin: ORIGIN,
    assetDirectory: directory,
  });
  const nextServer = http.createServer((request, response) =>
    nextHost.handle(request, response)
  );
  await new Promise(resolve => nextServer.listen(0, '127.0.0.1', resolve));
  try {
    const restored = await fetch(
      `http://127.0.0.1:${nextServer.address().port}${asset.url}`
    );
    assert.equal(restored.status, 200);
    assert.deepEqual(Buffer.from(await restored.arrayBuffer()), PNG);
  } finally {
    nextHost.close();
    await new Promise(resolve => nextServer.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function testAssetReadIsPublicImmutableAndReadOnly() {
  return withHost(async ({ base, upload }) => {
    const uploaded = await upload(base);
    const asset = await uploaded.json();
    assert.equal(
      (await fetch(`${base}${asset.url}`, { method: 'POST' })).status,
      405
    );
    assert.equal(
      (await fetch(`${base}/ktv/display/visual-assets/${'0'.repeat(64)}`))
        .status,
      404
    );
  });
}

async function testBridgeUploadsWithCurrentHostAndAbortsOnDispose() {
  const createWebRoomBridge = require('../src/karaoke/webRoomBridge').default;
  const file = {
    size: PNG.length,
    type: 'image/png',
    name: 'background.png',
    arrayBuffer: async () =>
      PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength),
  };
  const requests = [];
  const asset = {
    id: 'a'.repeat(64),
    url: `/ktv/display/visual-assets/${'a'.repeat(64)}`,
    mime: 'image/png',
  };
  const bridge = createWebRoomBridge({
    manager: {
      getSnapshot: () => ({
        revision: 1,
        session: { sessionId: 'visual-assets-test' },
        currentItem: null,
        waitingItems: [],
        historyItems: [],
      }),
    },
    origin: ORIGIN,
    execute: async () => {},
    schedule: () => 1,
    cancel: () => {},
    request: async (action, body, token, options) => {
      requests.push({ action, body, token, options });
      if (action === 'open')
        return { hostToken: 'current-host-token', room: {} };
      if (action === 'visual-assets') return asset;
      return {};
    },
  });
  await bridge.invoke('karaoke:lan:start');
  assert.equal(typeof bridge.uploadVisualAsset, 'function');
  const namedAsset = { ...asset, name: 'background.png' };
  assert.deepEqual(
    await bridge.uploadVisualAsset(file, 'background'),
    namedAsset
  );
  const upload = requests.find(item => item.action === 'visual-assets');
  assert.strictEqual(
    upload.body,
    file,
    'binary File/Blob is passed without JSON encoding'
  );
  assert.equal(upload.token, 'current-host-token');
  assert.equal(upload.options.method, 'POST');
  assert.equal(upload.options.headers['Content-Type'], 'image/png');
  assert.equal(upload.options.headers['X-KTV-Visual-Asset-Role'], 'background');
  assert.deepEqual(await bridge.uploadVisualAsset(file, 'tempera'), namedAsset);
  const temperaRequest = requests
    .filter(item => item.action === 'visual-assets')
    .pop();
  assert.equal(
    temperaRequest.options.headers['X-KTV-Visual-Asset-Role'],
    'tempera'
  );
  const requestCount = requests.length;
  await assert.rejects(
    bridge.uploadVisualAsset(
      { ...file, size: 4 * 1024 * 1024 + 1 },
      'background'
    ),
    /ASSET_TOO_LARGE/
  );
  assert.equal(
    requests.length,
    requestCount,
    'oversize files fail before request'
  );
  await bridge.dispose();

  let signal;
  const abortingBridge = createWebRoomBridge({
    manager: {
      getSnapshot: () => ({
        revision: 1,
        session: { sessionId: 'visual-assets-abort-test' },
        currentItem: null,
        waitingItems: [],
        historyItems: [],
      }),
    },
    origin: ORIGIN,
    execute: async () => {},
    schedule: () => 1,
    cancel: () => {},
    request: async (action, _body, _token, options) => {
      if (action === 'open') return { hostToken: 'abort-host-token', room: {} };
      if (action !== 'visual-assets') return {};
      signal = options.signal;
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), {
          once: true,
        });
      });
    },
  });
  await abortingBridge.invoke('karaoke:lan:start');
  const pendingUpload = abortingBridge.uploadVisualAsset(file, 'background');
  await new Promise(resolve => setImmediate(resolve));
  await abortingBridge.dispose();
  await assert.rejects(pendingUpload, /ROOM_ENDED/);
  assert.equal(signal.aborted, true, 'dispose aborts pending asset upload');
}

async function testVisualAssetResolversAndLocalStorage() {
  let visualAssets;
  try {
    visualAssets = require('../src/karaoke/visualAssets');
  } catch (_) {
    assert.fail('visualAssets module should expose the asset resolver');
  }
  assert.equal(typeof visualAssets.resolveVisualAssets, 'function');
  const a = 'a'.repeat(64);
  const b = 'b'.repeat(64);
  const c = 'c'.repeat(64);
  const d = 'd'.repeat(64);
  const e = 'e'.repeat(64);
  const f = 'f'.repeat(64);
  const config = {
    background: { assetId: a },
    tuningByMode: {
      monet: { portraitAssetId: b },
      cappella: {
        emojiAssetIds: [c, 'invalid', c],
        avatarAssetIds: [d],
      },
      tempera: {
        layerImageAssetIds: [e, 'bad', e, f],
        layerImages: [
          { id: e, name: 'Paper texture' },
          { id: f, name: 'Blue ink' },
        ],
      },
    },
  };
  const resolved = visualAssets.resolveVisualAssets(config);
  assert.deepEqual(resolved.backgroundImage, {
    id: a,
    url: `/ktv/display/visual-assets/${a}`,
  });
  assert.deepEqual(resolved.monetPortraitImage, {
    id: b,
    url: `/ktv/display/visual-assets/${b}`,
  });
  assert.deepEqual(resolved.cappellaCustomEmojiImages, [
    { id: c, url: `/ktv/display/visual-assets/${c}` },
  ]);
  assert.deepEqual(resolved.cappellaCustomAvatarImages, [
    { id: d, url: `/ktv/display/visual-assets/${d}` },
  ]);
  assert.deepEqual(resolved.temperaLayerImageAssets, [
    { id: e, name: 'Paper texture', url: `/ktv/display/visual-assets/${e}` },
    { id: f, name: 'Blue ink', url: `/ktv/display/visual-assets/${f}` },
  ]);
  assert.strictEqual(
    visualAssets.resolveVisualAssets(JSON.parse(JSON.stringify(config))),
    resolved,
    'equal references reuse one memoized result'
  );
  assert.equal(
    visualAssets.resolveVisualAssets({
      background: { assetId: 'data:image/png' },
    }).backgroundImage,
    null,
    'invalid ids never become URLs'
  );

  const records = new Map();
  const storage = {
    async addBounded(record) {
      const existing = records.get(record.id);
      if (existing) return existing;
      if (
        records.size >= 32 ||
        [...records.values()].reduce((n, item) => n + item.size, 0) +
          record.size >
          32 * 1024 * 1024
      )
        throw new Error('LOCAL_ASSET_STORE_FULL');
      records.set(record.id, record);
      return record;
    },
    async get(id) {
      return records.get(id) || null;
    },
  };
  const local = await visualAssets.uploadLocalVisualAsset(
    {
      name: 'local.png',
      type: 'image/png',
      size: PNG.length,
      arrayBuffer: async () =>
        PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength),
    },
    'background',
    { storage, crypto: require('crypto').webcrypto }
  );
  assert.equal(
    local.id,
    require('crypto').createHash('sha256').update(PNG).digest('hex')
  );
  const fallbackBytes = Buffer.concat([PNG, Buffer.from([44])]);
  const fallbackLocal = await visualAssets.uploadLocalVisualAsset(
    {
      type: 'image/png',
      size: fallbackBytes.length,
      arrayBuffer: async () =>
        fallbackBytes.buffer.slice(
          fallbackBytes.byteOffset,
          fallbackBytes.byteOffset + fallbackBytes.byteLength
        ),
    },
    'tempera',
    { storage, crypto: {} }
  );
  assert.equal(
    fallbackLocal.id,
    require('crypto').createHash('sha256').update(fallbackBytes).digest('hex'),
    'local SHA-256 works when the page lacks Web Crypto subtle support'
  );
  let localTemperaUrl = '';
  const localResolved = await visualAssets.resolveLocalVisualAssets(
    { tuningByMode: { tempera: { layerImageAssetIds: [fallbackLocal.id] } } },
    {
      storage,
      crypto: require('crypto').webcrypto,
      urlApi: {
        createObjectURL: () => 'blob:test/tempera',
        revokeObjectURL: url => {
          localTemperaUrl = url;
        },
      },
    }
  );
  assert.deepEqual(localResolved.temperaLayerImageAssets, [
    { id: fallbackLocal.id, name: 'Image 1', url: 'blob:test/tempera' },
  ]);
  localResolved.release();
  assert.equal(
    localTemperaUrl,
    'blob:test/tempera',
    'Tempera blob URL is cleaned up'
  );
  let revoked = '';
  const lease = await visualAssets.resolveLocalVisualAsset(local.id, {
    storage,
    crypto: require('crypto').webcrypto,
    urlApi: {
      createObjectURL: blob => `blob:test/${blob.size}`,
      revokeObjectURL: url => {
        revoked = url;
      },
    },
  });
  assert.equal(lease.url, `blob:test/${PNG.length}`);
  lease.release();
  assert.equal(revoked, lease.url, 'released local blob URLs are revoked');
  let readOversizeFile = false;
  await assert.rejects(
    visualAssets.uploadLocalVisualAsset(
      {
        type: 'image/png',
        size: 4 * 1024 * 1024 + 1,
        arrayBuffer: async () => {
          readOversizeFile = true;
          return new ArrayBuffer(0);
        },
      },
      'background',
      { storage, crypto: require('crypto').webcrypto }
    ),
    /LOCAL_ASSET_TOO_LARGE/
  );
  assert.equal(
    readOversizeFile,
    false,
    'local size limit precedes file allocation'
  );
}

async function testConcurrentLocalAssetResolutionAndClear() {
  const visualAssets = require('../src/karaoke/visualAssets');
  const crypto = require('crypto');
  const id = crypto.createHash('sha256').update(PNG).digest('hex');
  const record = {
    id,
    mime: 'image/png',
    size: PNG.length,
    blob: new Blob([PNG], { type: 'image/png' }),
  };
  const deferred = () => {
    let resolve;
    const promise = new Promise(done => {
      resolve = done;
    });
    return { promise, resolve };
  };

  for (const releaseOrder of [
    [0, 1],
    [1, 0],
  ]) {
    visualAssets.clearLocalVisualAssetUrls();
    const readStarted = deferred();
    const finishRead = deferred();
    let readCount = 0;
    let createCount = 0;
    const revoked = [];
    const options = {
      storage: {
        async get() {
          readCount++;
          readStarted.resolve();
          await finishRead.promise;
          return record;
        },
      },
      crypto: crypto.webcrypto,
      urlApi: {
        createObjectURL: () => `blob:shared/${++createCount}`,
        revokeObjectURL: url => revoked.push(url),
      },
    };
    const pendingLeases = [
      visualAssets.resolveLocalVisualAsset(id, options),
      visualAssets.resolveLocalVisualAsset(id, options),
    ];
    await readStarted.promise;
    finishRead.resolve();
    const leases = await Promise.all(pendingLeases);

    assert.equal(readCount, 1, 'concurrent resolves share the pending read');
    assert.equal(createCount, 1, 'concurrent resolves create one Blob URL');
    assert.equal(leases[0].url, leases[1].url);
    for (const index of releaseOrder) {
      leases[index].release();
      if (index === releaseOrder[0])
        assert.deepEqual(
          revoked,
          [],
          'first release keeps the shared URL alive'
        );
    }
    assert.deepEqual(revoked, [leases[0].url]);
  }

  visualAssets.clearLocalVisualAssetUrls();
  const pendingReadStarted = deferred();
  const finishPendingRead = deferred();
  let pendingCreateCount = 0;
  const pendingResolve = visualAssets.resolveLocalVisualAsset(id, {
    storage: {
      async get() {
        pendingReadStarted.resolve();
        await finishPendingRead.promise;
        return record;
      },
    },
    crypto: crypto.webcrypto,
    urlApi: {
      createObjectURL: () => {
        pendingCreateCount++;
        return 'blob:cleared-pending';
      },
      revokeObjectURL: () => {},
    },
  });
  await pendingReadStarted.promise;
  visualAssets.clearLocalVisualAssetUrls();

  let replacementRevoked = '';
  const replacement = await visualAssets.resolveLocalVisualAsset(id, {
    storage: { get: async () => record },
    crypto: crypto.webcrypto,
    urlApi: {
      createObjectURL: () => 'blob:replacement',
      revokeObjectURL: url => {
        replacementRevoked = url;
      },
    },
  });
  finishPendingRead.resolve();
  assert.equal(await pendingResolve, null, 'clear cancels pending resolution');
  assert.equal(pendingCreateCount, 0, 'cleared pending work creates no URL');
  assert.equal(
    replacementRevoked,
    '',
    'pending cleanup leaves the new entry intact'
  );
  replacement.release();
  assert.equal(replacementRevoked, replacement.url);

  const oldLease = await visualAssets.resolveLocalVisualAsset(id, {
    storage: { get: async () => record },
    crypto: crypto.webcrypto,
    urlApi: {
      createObjectURL: () => 'blob:old-entry',
      revokeObjectURL: () => {},
    },
  });
  visualAssets.clearLocalVisualAssetUrls();
  let newEntryRevoked = '';
  const newLease = await visualAssets.resolveLocalVisualAsset(id, {
    storage: { get: async () => record },
    crypto: crypto.webcrypto,
    urlApi: {
      createObjectURL: () => 'blob:new-entry',
      revokeObjectURL: url => {
        newEntryRevoked = url;
      },
    },
  });
  oldLease.release();
  assert.equal(
    newEntryRevoked,
    '',
    'old lease cannot revoke a replacement entry'
  );
  newLease.release();
  assert.equal(newEntryRevoked, newLease.url);
}

async function testClearAfterEntryInstallBeforeCallerResume() {
  const visualAssets = require('../src/karaoke/visualAssets');
  const crypto = require('crypto');
  const id = crypto.createHash('sha256').update(PNG).digest('hex');
  const record = {
    id,
    mime: 'image/png',
    size: PNG.length,
    blob: new Blob([PNG], { type: 'image/png' }),
  };
  const revoked = [];
  let clearRan = false;
  visualAssets.clearLocalVisualAssetUrls();
  const options = {
    storage: { get: async () => record },
    crypto: crypto.webcrypto,
    urlApi: {
      createObjectURL: () => {
        queueMicrotask(() => {
          clearRan = true;
          visualAssets.clearLocalVisualAssetUrls();
        });
        return 'blob:cleared-before-resume';
      },
      revokeObjectURL: url => revoked.push(url),
    },
  };
  const callers = [
    visualAssets.resolveLocalVisualAsset(id, options),
    visualAssets.resolveLocalVisualAsset(id, options),
  ];
  const leases = await Promise.all(callers);

  assert.equal(clearRan, true, 'clear runs after URL creation is queued');
  assert.deepEqual(revoked, ['blob:cleared-before-resume']);
  assert.deepEqual(
    leases,
    [null, null],
    'creator and joining callers do not receive revoked leases'
  );
}

async function testIndexedDbUploadCancellationAndRetention() {
  const { IDBFactory, IDBObjectStore } = require(process.env
    .KTV_TEST_INDEXEDDB_MODULE || 'fake-indexeddb');
  const visual = require('../src/karaoke/visualAssets');
  const {
    createVisualAssetUploadQueue,
    normalizeAppearanceConfig,
  } = require('../src/karaoke/appearanceConfig');
  const image = () =>
    Object.assign(new Blob([PNG], { type: 'image/png' }), {
      name: 'local.png',
    });
  const fixture = async () => {
    const indexedDB = new IDBFactory();
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('lumasing.ktv.visual-assets.v1', 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore('assets', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return {
      options: { indexedDB, crypto: {} },
      rows: () =>
        new Promise((resolve, reject) => {
          const transaction = db.transaction('assets', 'readonly');
          const request = transaction.objectStore('assets').getAll();
          transaction.oncomplete = () => resolve(request.result);
          transaction.onabort = transaction.onerror = () =>
            reject(transaction.error);
        }),
    };
  };

  for (const role of ['emoji', 'background']) {
    for (const timing of [
      'before-commit',
      'after-commit',
      'before-queue-resume',
    ]) {
      const state = await fixture();
      let follow = false;
      let config = normalizeAppearanceConfig({});
      let settingsCommits = 0;
      let hooked = false;
      let aborted = 0;
      let completed = 0;
      const queue = createVisualAssetUploadQueue({
        getConfig: () => config,
        getGeneration: () => (follow ? null : 1),
        upload: (file, purpose, options) =>
          visual.uploadLocalVisualAsset(file, purpose, {
            ...state.options,
            ...options,
          }),
        commit: next => {
          config = next;
          settingsCommits++;
        },
      });
      const toggleFollow = () => {
        follow = true;
        queue.invalidate();
      };
      const originalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (record, ...args) {
        const request = originalPut.call(this, record, ...args);
        if (Array.isArray(record._localUploadPins) && !hooked) {
          hooked = true;
          this.transaction.addEventListener('abort', () => aborted++);
          this.transaction.addEventListener('complete', () => completed++);
          if (timing === 'before-commit')
            request.addEventListener('success', toggleFollow);
          else
            this.transaction.addEventListener('complete', () => {
              if (timing === 'after-commit') toggleFollow();
              else queueMicrotask(toggleFollow);
            });
        }
        return request;
      };
      try {
        assert.deepEqual(
          await queue.run({ role, files: [image(), image()] }),
          role === 'background' ? [false] : [false, false]
        );
        assert.equal(
          hooked,
          true,
          `${role}/${timing}: exercised the real IDB put path`
        );
        assert.equal(settingsCommits, 0);
        assert.deepEqual(
          await state.rows(),
          [],
          `${role}/${timing}: cancellation leaves no persisted orphan`
        );
        if (timing === 'before-commit')
          assert.equal(aborted, 1, 'abort rolls back the transaction');
        else
          assert.equal(
            completed,
            1,
            'cleanup also covers a transaction that already committed'
          );
      } finally {
        IDBObjectStore.prototype.put = originalPut;
        queue.dispose();
      }
    }
  }

  const old = await fixture();
  const legacy = await visual.uploadLocalVisualAsset(
    image(),
    'avatar',
    old.options
  );
  assert.deepEqual(
    Object.keys(legacy).sort(),
    ['id', 'mime', 'size'],
    'legacy API retains its return shape and automatic retention'
  );
  const cancel = new AbortController();
  const duplicate = await visual.uploadLocalVisualAsset(image(), 'emoji', {
    ...old.options,
    signal: cancel.signal,
    deferRetain: true,
  });
  cancel.abort();
  await duplicate.discard();
  assert.equal(
    (await old.rows()).length,
    1,
    'cancelled deduplication never deletes a pre-existing record'
  );

  const shared = await fixture();
  const first = await visual.uploadLocalVisualAsset(image(), 'emoji', {
    ...shared.options,
    deferRetain: true,
  });
  const second = await visual.uploadLocalVisualAsset(image(), 'avatar', {
    ...shared.options,
    deferRetain: true,
  });
  await first.discard();
  assert.equal(
    (await shared.rows()).length,
    1,
    'another pending owner pins shared content'
  );
  await second.retain();
  await first.discard();
  await second.discard();
  assert.equal(
    (await shared.rows()).length,
    1,
    'retained shared content survives late/repeated discard'
  );
  assert.equal((await shared.rows())[0]._localUploadPins, undefined);

  const discarded = await fixture();
  const a = await visual.uploadLocalVisualAsset(image(), 'emoji', {
    ...discarded.options,
    deferRetain: true,
  });
  const b = await visual.uploadLocalVisualAsset(image(), 'avatar', {
    ...discarded.options,
    deferRetain: true,
  });
  await Promise.all([a.discard(), b.discard()]);
  assert.deepEqual(
    await discarded.rows(),
    [],
    'last unretained owner removes only its pending record'
  );

  const finishing = await fixture();
  const signal = new AbortController();
  const accepted = await visual.uploadLocalVisualAsset(image(), 'tempera', {
    ...finishing.options,
    signal: signal.signal,
    deferRetain: true,
  });
  const retaining = accepted.retain();
  signal.abort();
  await retaining;
  assert.equal(
    (await finishing.rows()).length,
    1,
    'cancellation after acceptance cannot undo a finishing retain'
  );

  const leased = await fixture();
  const pending = await visual.uploadLocalVisualAsset(image(), 'tempera', {
    ...leased.options,
    deferRetain: true,
  });
  visual.clearLocalVisualAssetUrls();
  const revoked = [];
  const lease = await visual.resolveLocalVisualAsset(pending.id, {
    ...leased.options,
    urlApi: {
      createObjectURL: () => 'blob:pinned-consumer',
      revokeObjectURL: url => revoked.push(url),
    },
  });
  await pending.discard();
  assert.equal(
    (await leased.rows()).length,
    1,
    'an independent resolver retains a pending image it consumes'
  );
  assert.deepEqual(revoked, []);
  lease.release();
  assert.deepEqual(
    revoked,
    ['blob:pinned-consumer'],
    'existing URL lease cleanup remains independent'
  );

  for (const failRetention of [false, true]) {
    const committed = await fixture();
    let config = normalizeAppearanceConfig({});
    let follow = false;
    const notices = [];
    let failed = false;
    const originalPut = IDBObjectStore.prototype.put;
    if (failRetention) {
      IDBObjectStore.prototype.put = function (record, ...args) {
        const request = originalPut.call(this, record, ...args);
        if (!Array.isArray(record._localUploadPins) && !failed) {
          failed = true;
          request.addEventListener('success', () => this.transaction.abort());
        }
        return request;
      };
    }
    const queue = createVisualAssetUploadQueue({
      getConfig: () => config,
      getGeneration: () => (follow ? null : 1),
      upload: (file, role, options) =>
        visual.uploadLocalVisualAsset(file, role, {
          ...committed.options,
          ...options,
        }),
      commit: next => {
        config = next;
        follow = true;
        queue.invalidate(); // A synchronous watcher invalidates while commit publishes settings.
        return true;
      },
      notify: message => notices.push(message),
    });
    try {
      assert.deepEqual(await queue.run({ role: 'avatar', files: [image()] }), [
        !failRetention,
      ]);
      const rows = await committed.rows();
      assert.equal(
        rows.length,
        1,
        'commit-triggered invalidation cannot remove the published image'
      );
      assert.equal(
        config.tuningByMode.cappella.avatarAssetIds[0],
        rows[0].id,
        'saved settings always reference a present IDB record'
      );
      if (failRetention) {
        assert.equal(
          failed,
          true,
          'the actual IDB retain transaction was aborted'
        );
        assert.ok(
          notices.length,
          'retain failure is reported rather than treated as success'
        );
        assert.ok(
          rows[0]._localUploadPins.length,
          'failed acknowledgement keeps its ownership pin'
        );
      } else {
        assert.equal(
          rows[0]._localUploadPins,
          undefined,
          'successful acknowledgement finalizes retention'
        );
      }
    } finally {
      IDBObjectStore.prototype.put = originalPut;
      queue.dispose();
    }
  }

  const rejected = await fixture();
  const failedCommitQueue = createVisualAssetUploadQueue({
    getConfig: () => normalizeAppearanceConfig({}),
    getGeneration: () => 1,
    upload: (file, role, options) =>
      visual.uploadLocalVisualAsset(file, role, {
        ...rejected.options,
        ...options,
      }),
    commit: () => false,
  });
  assert.deepEqual(
    await failedCommitQueue.run({ role: 'avatar', files: [image()] }),
    [false]
  );
  assert.deepEqual(
    await rejected.rows(),
    [],
    'rejected settings commit discards its newly created IDB record'
  );
  console.log(
    'IndexedDB abort, finishing-commit discard, retention, dedupe, and shared lease tests passed'
  );
}

async function main() {
  await testAuthenticatedBinaryUploadAndImmutableRead();
  await testUploadAuthenticationAndImageSignatures();
  await testUploadAndStoreBoundsAndDeduplication();
  await testOwnerResetDuringUploadDoesNotStoreOrLeakRoomState();
  await testConcurrentUploadSlotsAreBounded();
  await testTotalStoreByteLimit();
  await testPersistentAssetsSurviveHostRestart();
  await testAssetReadIsPublicImmutableAndReadOnly();
  await testBridgeUploadsWithCurrentHostAndAbortsOnDispose();
  await testVisualAssetResolversAndLocalStorage();
  await testConcurrentLocalAssetResolutionAndClear();
  await testClearAfterEntryInstallBeforeCallerResume();
  await testIndexedDbUploadCancellationAndRetention();
}

main()
  .then(() => console.log('KTV visual asset tests passed'))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
