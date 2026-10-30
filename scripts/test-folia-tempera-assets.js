const assert = require('assert');
const Module = require('module');
const path = require('path');
const esbuild = require('esbuild');

const filename = path.resolve('src/karaoke/folia/temperaImageBlobs.js');
const compiled = esbuild.buildSync({
  entryPoints: [filename],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  target: 'node16',
}).outputFiles[0].text;
const loaded = new Module(filename, module);
loaded.paths = module.paths;
loaded._compile(compiled, filename);

const {
  createTemperaImageBlobPool,
  MAX_TEMPERA_IMAGE_BYTES,
  MAX_TEMPERA_IMAGE_TOTAL_BYTES,
} = loaded.exports;
const id = 'a'.repeat(64);
const asset = { id, name: 'Portrait', url: `/ktv/display/visual-assets/${id}` };
const baseUrl = 'https://ktv.example/room';

function imageResponse(blob, contentLength = String(blob.size)) {
  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        if (name.toLowerCase() === 'content-length') return contentLength;
        if (name.toLowerCase() === 'content-type') return blob.type;
        return null;
      },
    },
    body: null,
    blob: async () => blob,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function run() {
  assert.equal(MAX_TEMPERA_IMAGE_BYTES, 4 * 1024 * 1024);
  assert.equal(MAX_TEMPERA_IMAGE_TOTAL_BYTES, 32 * 1024 * 1024);

  let fetchCount = 0;
  const fetchGate = deferred();
  const pool = createTemperaImageBlobPool({
    baseUrl,
    fetch: () => {
      fetchCount++;
      return fetchGate.promise;
    },
  });
  const first = pool.load([asset]);
  const second = pool.load([asset]);
  await Promise.resolve();
  fetchGate.resolve(imageResponse(new Blob(['png'], { type: 'image/png' })));
  const [firstMap, secondMap] = await Promise.all([first, second]);
  assert.equal(fetchCount, 1, 'same asset hash shares an in-flight fetch');
  assert.strictEqual(firstMap.get(id), secondMap.get(id));
  await pool.load([asset]);
  assert.equal(fetchCount, 1, 'completed asset blobs are reused from cache');

  let unsafeFetches = 0;
  const safePool = createTemperaImageBlobPool({
    baseUrl,
    fetch: async () => {
      unsafeFetches++;
      return imageResponse(new Blob(['png'], { type: 'image/png' }));
    },
  });
  await assert.rejects(
    safePool.load([{ ...asset, url: `https://attacker.example/${id}` }]),
    /UNSAFE_TEMPERA_ASSET_URL/
  );
  assert.equal(unsafeFetches, 0, 'unsafe URLs are rejected before fetch');

  const smallPool = createTemperaImageBlobPool({
    baseUrl,
    maxFileBytes: 4,
    maxTotalBytes: 6,
    fetch: async () =>
      imageResponse(new Blob(['12345'], { type: 'image/png' }), '1'),
  });
  await assert.rejects(
    smallPool.load([asset]),
    /TEMPERA_IMAGE_TOO_LARGE/,
    'the actual Blob size wins over a smaller Content-Length header'
  );

  let requestedSignal;
  const abortPool = createTemperaImageBlobPool({
    baseUrl,
    fetch: (_url, options) => {
      requestedSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    },
  });
  const controller = new AbortController();
  const canceled = abortPool.load([asset], controller.signal);
  await Promise.resolve();
  controller.abort();
  await assert.rejects(canceled, error => error.name === 'AbortError');
  assert.equal(
    requestedSignal.aborted,
    true,
    'last canceled waiter aborts fetch'
  );

  const totalPool = createTemperaImageBlobPool({
    baseUrl,
    maxFileBytes: 4,
    maxTotalBytes: 6,
    fetch: async () => imageResponse(new Blob(['1234'], { type: 'image/png' })),
  });
  const secondAsset = {
    id: 'b'.repeat(64),
    name: 'Second',
    url: `/ktv/display/visual-assets/${'b'.repeat(64)}`,
  };
  await assert.rejects(
    totalPool.load([asset, secondAsset]),
    /TEMPERA_IMAGE_TOTAL_TOO_LARGE/
  );

  console.log(
    'Folia Tempera asset URL, bounds, cache, and abort checks passed'
  );
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
