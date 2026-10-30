#!/usr/bin/env node
'use strict';

// Focused CPU-side SmartBeat checks. The fake worker below tests only the host contract; it does
// not run either neural model and is not evidence of GPU inference.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const fs = require('node:fs/promises');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const modelCacheDir = process.env.FOLIA_MODEL_CACHE
  ? path.resolve(root, process.env.FOLIA_MODEL_CACHE)
  : path.join(root, 'public/pv/models');

async function loadBundled(entryPoint, platform = 'node') {
  const result = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    format: 'cjs',
    platform,
    target: platform === 'browser' ? 'es2020' : 'node20',
    metafile: true,
    write: false,
  });
  const module = { exports: {} };
  const localRequire = createRequire(entryPoint);
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(
    localRequire,
    module,
    module.exports,
  );
  return { exports: module.exports, metafile: result.metafile };
}

async function check(name, run) {
  await run();
  process.stdout.write(`PASS ${name}\n`);
}

class FakeWorker {
  constructor(probeSupported = true) {
    this.onmessage = null;
    this.onerror = null;
    this.terminated = false;
    this.requests = [];
    this.probeSupported = probeSupported;
  }

  postMessage(message) {
    this.requests.push(message);
    const answer = message.kind === 'probe'
      ? { kind: 'probe-result', id: message.id, supported: this.probeSupported, error: this.probeSupported ? undefined : 'adapter unavailable' }
      : { kind: 'ack', id: message.id, ok: true };
    queueMicrotask(() => this.onmessage?.({ data: answer }));
  }

  terminate() {
    this.terminated = true;
  }
}

async function main() {
  const math = await loadBundled(path.join(root, 'vendor/folia-analysis/beatThisMath.ts'));
  const drumMath = await loadBundled(path.join(root, 'vendor/folia-analysis/drumHitMath.ts'));
  const stemMath = await loadBundled(path.join(root, 'vendor/folia-analysis/stemSegmentMath.ts'));
  const drumStem = await loadBundled(path.join(root, 'vendor/folia-analysis/drumStem.ts'));
  const audio = await loadBundled(path.join(root, 'src/karaoke/smartBeat/audio.ts'));
  const modelLoader = await loadBundled(path.join(root, 'src/karaoke/smartBeat/modelLoader.ts'));
  const { createSmartBeatAnalyzer } = (await loadBundled(path.join(root, 'src/karaoke/smartBeat/controller.ts'))).exports;

  await check('Beat This! centered 22.05 kHz log-mel math is preserved', async () => {
    const { melSpectrogram, BEAT_THIS_SAMPLE_RATE, BEAT_THIS_FPS } = math.exports;
    const mel = await melSpectrogram(new Float32Array(BEAT_THIS_SAMPLE_RATE));
    assert.equal(BEAT_THIS_FPS, 50);
    assert.equal(mel.frames, 51);
    assert.equal(mel.data.length, mel.frames * 128);
    assert.ok(mel.data.every(value => Math.abs(value - Math.log1p(1000e-10)) < 1e-12));
  });

  await check('Beat This! chunk stitching and downbeat snapping match upstream', async () => {
    const { beatsFromLogits, splitForModel, aggregateChunks } = math.exports;
    const beats = new Float32Array(48);
    const downbeats = new Float32Array(48);
    beats[10] = 2;
    beats[22] = 1.5;
    downbeats[11] = 1;
    const grid = beatsFromLogits(beats, downbeats);
    assert.deepEqual(grid.beats, [0.2, 0.44]);
    assert.deepEqual(grid.downbeats, [0.2]);

    const chunks = splitForModel({ frames: 20, data: new Float32Array(20 * 128) });
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].start, -6);
    assert.equal(chunks[0].frames, 32);
    const stitched = aggregateChunks(chunks.map(chunk => ({
      start: chunk.start,
      frames: chunk.frames,
      beat: new Float32Array(chunk.frames).fill(0.25),
      downbeat: new Float32Array(chunk.frames).fill(-0.5),
    })), 20);
    assert.deepEqual(Array.from(stitched.beat), Array(20).fill(0.25));
    assert.deepEqual(Array.from(stitched.downbeat), Array(20).fill(-0.5));
  });

  await check('HTDemucs overlap window, source hit picker, and coverage math match upstream', async () => {
    const starts = stemMath.exports.stemSegmentStarts(20, 8);
    assert.deepEqual(starts, [0, 6, 12, 18]);
    assert.deepEqual(Array.from(stemMath.exports.stemSegmentWindow(8)), [0, 1, 1, 1, 1, 1, 1, 0]);

    const bands = [new Float32Array(50), new Float32Array(50), new Float32Array(50)];
    bands[0][20] = 1;
    const hits = drumMath.exports.pickBandHits(bands, 50);
    assert.deepEqual(Array.from(hits.times), [0.36]);
    assert.deepEqual(Array.from(hits.strengths), [1]);
    assert.deepEqual(Array.from(hits.kinds), [0]);
    assert.equal(drumMath.exports.drumCoverage(new Float32Array(50).fill(1), new Float32Array(50).fill(1)), 1);
    assert.equal(drumMath.exports.drumCoverage(new Float32Array(50), new Float32Array(50)), 0);
    const left = Float32Array.from([0.1, 0.7, -0.2, 0.45, -0.8]);
    const right = Float32Array.from([-0.4, 0.3, 0.6, -0.25, 0.2]);
    const mono = new Float32Array(left.length);
    for (let index = 0; index < mono.length; index += 1) mono[index] = (left[index] + right[index]) / 2;
    assert.deepEqual(
      Array.from(drumMath.exports.energyFramesStereo(left, right)),
      Array.from(drumMath.exports.energyFrames(mono)),
    );

    const merged = await drumStem.exports.separateDrumStem(
      left,
      right,
      async (segmentLeft, segmentRight) => ({ left: segmentLeft.slice(), right: segmentRight.slice() }),
    );
    assert.equal(merged.length, left.length);
    for (let index = 1; index < mono.length; index += 1) {
      assert.ok(Math.abs(merged[index] - mono[index]) < 1e-6, `overlap-add sample ${index}`);
    }
  });

  await check('both pinned model binaries pass exact length, SHA-256, and packed-manifest parsing', async () => {
    const upstreamManifest = await fs.readFile(path.join(root, 'vendor/folia-analysis/upstream/shared/modelManifest.json'));
    const copiedManifest = await fs.readFile(path.join(root, 'vendor/folia-analysis/shared/modelManifest.json'));
    assert.deepEqual(copiedManifest, upstreamManifest);
    for (const modelName of ['beat_this', 'htdemucs']) {
      const model = modelLoader.exports.SMARTBEAT_MODELS[modelName];
      assert.ok(model, `missing model definition: ${modelName}`);
      const bytes = await fs.readFile(path.join(modelCacheDir, model.file));
      assert.equal(bytes.byteLength, model.bytes);
      const parsed = await modelLoader.exports.verifyPackedModel(modelName, bytes);
      assert.equal(parsed.manifest.bytes, parsed.weights.byteLength);
      assert.equal(parsed.manifestOffset, parsed.weights.byteLength);
    }
    const model = modelLoader.exports.SMARTBEAT_MODELS.beat_this;
    await assert.rejects(
      modelLoader.exports.verifyPackedModel('beat_this', Buffer.alloc(model.bytes - 1)),
      /length/i,
    );
    const valid = await fs.readFile(path.join(modelCacheDir, model.file));
    const corrupted = Uint8Array.from(valid);
    corrupted[0] ^= 1;
    await assert.rejects(modelLoader.exports.verifyPackedModel('beat_this', corrupted), /SHA-256/i);
  });

  await check('a cancelled model waiter cannot poison the next track request', async () => {
    const fixturePath = path.join(modelCacheDir, modelLoader.exports.SMARTBEAT_MODELS.beat_this.file);
    const fixture = await fs.readFile(fixturePath);
    let releaseFirstFetch;
    let firstFetches = 0;
    let secondFetches = 0;
    const firstAbort = new AbortController();
    const firstRequest = modelLoader.exports.loadSmartBeatModel('beat_this', {
      signal: firstAbort.signal,
      cacheStorage: null,
      fetchImpl: () => {
        firstFetches += 1;
        return new Promise(resolve => { releaseFirstFetch = () => resolve(new Response(fixture)); });
      },
    }).then(value => ({ value }), error => ({ error }));
    assert.equal(firstFetches, 1);

    firstAbort.abort();
    const secondRequest = modelLoader.exports.loadSmartBeatModel('beat_this', {
      cacheStorage: null,
      fetchImpl: async () => {
        secondFetches += 1;
        return new Response(fixture);
      },
    }).then(value => ({ value }), error => ({ error }));
    releaseFirstFetch();

    const [first, second] = await Promise.all([firstRequest, secondRequest]);
    assert.equal(first.error?.name, 'AbortError');
    assert.equal(firstFetches, 1);
    assert.equal(secondFetches, 1);
    assert.equal(second.value?.spec.bytes, 41102271);
    assert.equal(second.value?.weights.byteLength, second.value?.manifestOffset);
  });

  await check('cancelling one model waiter leaves a shared fetch alive for its other waiter', async () => {
    const fixture = await fs.readFile(path.join(modelCacheDir, modelLoader.exports.SMARTBEAT_MODELS.beat_this.file));
    let releaseFetch;
    let fetches = 0;
    const firstAbort = new AbortController();
    const fetchImpl = () => {
      fetches += 1;
      return new Promise(resolve => { releaseFetch = () => resolve(new Response(fixture)); });
    };
    const firstRequest = modelLoader.exports.loadSmartBeatModel('beat_this', {
      signal: firstAbort.signal,
      cacheStorage: null,
      fetchImpl,
    }).then(value => ({ value }), error => ({ error }));
    const secondRequest = modelLoader.exports.loadSmartBeatModel('beat_this', {
      cacheStorage: null,
      fetchImpl: async () => { throw new Error('a live shared request should not start a second fetch'); },
    }).then(value => ({ value }), error => ({ error }));
    firstAbort.abort();
    releaseFetch();

    const [first, second] = await Promise.all([firstRequest, secondRequest]);
    assert.equal(fetches, 1);
    assert.equal(first.error?.name, 'AbortError');
    assert.equal(second.value?.spec.bytes, 41102271);
  });

  await check('cached mode serves a real stored timeline without fetching audio or creating a worker', async () => {
    const timeline = {
      trackKey: 'cached-track',
      audioHash: 'a'.repeat(64),
      modelVersions: {
        beat_this: modelLoader.exports.SMARTBEAT_MODELS.beat_this.sha256,
        htdemucs: modelLoader.exports.SMARTBEAT_MODELS.htdemucs.sha256,
      },
      duration: 12,
      beats: { source: 'beat_this', times: [0.5], downbeats: [0.5] },
      drums: null,
    };
    const results = [];
    const statuses = [];
    let fetches = 0;
    let workers = 0;
    const analyzer = createSmartBeatAnalyzer({
      onStatus: status => statuses.push(status),
      onResult: result => results.push(result),
      fetchAudio: async () => { fetches += 1; throw new Error('cached mode must not fetch'); },
      createWorker: () => { workers += 1; throw new Error('cached mode must not create a worker'); },
      storage: {
        async get() { return timeline; },
        async put() {},
      },
    });
    analyzer.updateTrack({ key: 'cached-track', cacheKey: 'cached-key', sourceUrl: '/audio.ogg', duration: 12, playing: true });
    analyzer.setMode('cached');
    await analyzer.ensureSources({ beats: true, drums: false });
    assert.equal(fetches, 0);
    assert.equal(workers, 0);
    assert.equal(results[0].trackKey, 'cached-track');
    assert.equal(statuses.at(-1).stage, 'cached');
    assert.equal(statuses.at(-1).cacheHit, true);
    analyzer.dispose();
  });

  await check('cache miss in cached mode stays honest and never starts work', async () => {
    const statuses = [];
    let fetches = 0;
    let workers = 0;
    const analyzer = createSmartBeatAnalyzer({
      onStatus: status => statuses.push(status),
      fetchAudio: async () => { fetches += 1; throw new Error('must not fetch'); },
      createWorker: () => { workers += 1; throw new Error('must not create worker'); },
      storage: { async get() { return null; }, async put() {} },
    });
    analyzer.updateTrack({ key: 'miss', cacheKey: 'miss-key', sourceUrl: '/audio.ogg', duration: 12, playing: true });
    analyzer.setMode('cached');
    await analyzer.ensureSources({ beats: true, drums: true });
    assert.equal(fetches, 0);
    assert.equal(workers, 0);
    assert.equal(statuses.at(-1).stage, 'cached');
    assert.equal(statuses.at(-1).cacheHit, false);
    analyzer.dispose();
  });

  await check('worker adapter failure is reported before audio or model downloads', async () => {
    const statuses = [];
    const worker = new FakeWorker(false);
    let audioFetches = 0;
    const analyzer = createSmartBeatAnalyzer({
      onStatus: status => statuses.push(status),
      fetchAudio: async () => { audioFetches += 1; return new Uint8Array([1]).buffer; },
      createWorker: () => worker,
      storage: { async get() { return null; }, async put() {} },
    });
    analyzer.updateTrack({ key: 'unsupported', cacheKey: 'unsupported-key', sourceUrl: '/audio.ogg', duration: 8, playing: true });
    analyzer.setMode('on');
    await analyzer.ensureSources({ beats: true, drums: false });
    assert.equal(audioFetches, 0);
    assert.equal(worker.requests.filter(request => request.kind === 'load').length, 0);
    assert.equal(statuses.at(-1).stage, 'unsupported');
    assert.match(statuses.at(-1).message, /adapter unavailable/);
    analyzer.dispose();
  });

  await check('missing OfflineAudioContext is classified as unsupported audio capability', async () => {
    await assert.rejects(
      audio.exports.decodeSmartBeatAudio(new Uint8Array([1]), 1),
      error => error.name === 'SmartBeatUnsupportedError' && /OfflineAudioContext/.test(error.message),
    );
  });

  await check('controller rejects excessive peak decode memory before loading a model', async () => {
    const statuses = [];
    const worker = new FakeWorker(true);
    const analyzer = createSmartBeatAnalyzer({
      onStatus: status => statuses.push(status),
      fetchAudio: async () => new Uint8Array([1]).buffer,
      createWorker: () => worker,
      storage: { async get() { return null; }, async put() {} },
    });
    analyzer.updateTrack({ key: 'long-track', cacheKey: 'long-track', sourceUrl: '/long.ogg', duration: 600, playing: true });
    analyzer.setMode('on');
    await analyzer.ensureSources({ beats: true, drums: false });
    assert.equal(statuses.at(-1).stage, 'unsupported');
    assert.match(statuses.at(-1).message, /peak memory/i);
    assert.deepEqual(worker.requests.map(request => request.kind), ['probe']);
    analyzer.dispose();
  });

  await check('600-second decode is rejected by its peak-memory budget before allocating an AudioBuffer', async () => {
    const previousWindow = globalThis.window;
    let contextsCreated = 0;
    globalThis.window = {
      OfflineAudioContext: class {
        constructor() { contextsCreated += 1; }
        decodeAudioData() { throw new Error('decode should not start above the peak-memory budget'); }
      },
    };
    try {
      assert.doesNotThrow(() => audio.exports.assertSmartBeatDecodeBudget(304, new ArrayBuffer(1)));
      await assert.rejects(
        audio.exports.decodeSmartBeatAudio(new ArrayBuffer(1), 305),
        error => error.name === 'SmartBeatUnsupportedError' && /peak.*memory/i.test(error.message),
      );
      await assert.rejects(
        audio.exports.decodeSmartBeatAudio(new Uint8Array([1]), 600),
        error => error.name === 'SmartBeatUnsupportedError' && /peak.*memory/i.test(error.message),
      );
      const retainedBacking = new ArrayBuffer(4 * 1024 * 1024);
      await assert.rejects(
        audio.exports.decodeSmartBeatAudio(new Uint8Array(retainedBacking, 0, 1024 * 1024), 300),
        error => error.name === 'SmartBeatUnsupportedError' && /peak.*memory/i.test(error.message),
      );
      assert.equal(contextsCreated, 0);
    } finally {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
  });

  await check('a decoded six-channel 170-second buffer is rejected before stereo or mono outputs are allocated', async () => {
    const previousWindow = globalThis.window;
    const NativeFloat32Array = globalThis.Float32Array;
    const decodedLength = 170 * 44100;
    let contextsCreated = 0;
    let decodeCalls = 0;
    let channelCopies = 0;
    let monoSourcesCreated = 0;
    let outputArrayAllocations = 0;
    const decoded = {
      duration: 170,
      length: decodedLength,
      numberOfChannels: 6,
      copyFromChannel() { channelCopies += 1; },
    };
    globalThis.Float32Array = new Proxy(NativeFloat32Array, {
      construct(target, args, newTarget) {
        if (args[0] === decodedLength || args[0] === 170 * 22050) {
          outputArrayAllocations += 1;
          throw new Error('stereo or mono output allocation started before the post-decode budget check');
        }
        return Reflect.construct(target, args, newTarget);
      },
    });
    globalThis.window = {
      OfflineAudioContext: class {
        constructor() { contextsCreated += 1; this.destination = {}; }
        decodeAudioData() { decodeCalls += 1; return Promise.resolve(decoded); }
        createBufferSource() { monoSourcesCreated += 1; return { connect() {}, start() {} }; }
        startRendering() { return Promise.resolve({ getChannelData: () => new NativeFloat32Array(170 * 22050) }); }
      },
    };
    try {
      assert.doesNotThrow(() => audio.exports.assertSmartBeatDecodeBudget(170, new ArrayBuffer(1)));
      await assert.rejects(
        audio.exports.decodeSmartBeatAudio(new ArrayBuffer(1), 170),
        error => error.name === 'SmartBeatUnsupportedError' && /peak.*memory/i.test(error.message),
      );
      assert.equal(contextsCreated, 1);
      assert.equal(decodeCalls, 1);
      assert.equal(channelCopies, 0);
      assert.equal(monoSourcesCreated, 0);
      assert.equal(outputArrayAllocations, 0);
    } finally {
      globalThis.Float32Array = NativeFloat32Array;
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
  });

  await check('a short six-channel decode copies only the first two channels for stereo inference', async () => {
    const previousWindow = globalThis.window;
    const requestedChannels = [];
    const decoded = {
      duration: 1,
      length: 44100,
      numberOfChannels: 6,
      copyFromChannel(target, channel) {
        requestedChannels.push(channel);
        target.fill(channel + 0.25);
      },
    };
    globalThis.window = {
      OfflineAudioContext: class {
        constructor(_channels, length) { this.length = length; this.destination = {}; }
        decodeAudioData() { return Promise.resolve(decoded); }
        createBufferSource() { return { connect() {}, start() {} }; }
        startRendering() { return Promise.resolve({ getChannelData: () => new Float32Array(this.length) }); }
      },
    };
    try {
      const result = await audio.exports.decodeSmartBeatAudio(new ArrayBuffer(1), 1);
      assert.deepEqual(requestedChannels, [0, 1]);
      assert.equal(result.left[0], 0.25);
      assert.equal(result.right[0], 1.25);
      assert.equal(result.uncompressedBytes, 44100 * 6 * Float32Array.BYTES_PER_ELEMENT);
    } finally {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
  });

  await check('track generation changes discard late audio reads', async () => {
    let resolveAudio;
    let fetches = 0;
    let workers = 0;
    let fakeWorker;
    const results = [];
    const analyzer = createSmartBeatAnalyzer({
      onResult: result => results.push(result),
      fetchAudio: () => {
        fetches += 1;
        return new Promise(resolve => { resolveAudio = resolve; });
      },
      createWorker: () => { workers += 1; fakeWorker = new FakeWorker(); return fakeWorker; },
      storage: { async get() { return null; }, async put() {} },
    });
    analyzer.updateTrack({ key: 'old', cacheKey: 'old-key', sourceUrl: '/old.ogg', duration: 12, playing: true });
    analyzer.setMode('on');
    const pending = analyzer.ensureSources({ beats: true, drums: false });
    assert.strictEqual(analyzer.ensureSources({ beats: true, drums: false }), pending);
    for (let turn = 0; turn < 20 && !resolveAudio; turn += 1) await new Promise(resolve => setImmediate(resolve));
    assert.equal(fetches, 1);
    analyzer.updateTrack({ key: 'new', cacheKey: 'new-key', sourceUrl: null, duration: 12, playing: true });
    resolveAudio(new Uint8Array([1, 2, 3]).buffer);
    await pending;
    assert.equal(workers, 1);
    assert.deepEqual(fakeWorker.requests.map(request => request.kind), ['probe']);
    assert.equal(results.length, 0);
    analyzer.dispose();
  });

  await check('worker bundle is isolated from Electron, app stores, and UI modules', async () => {
    const workerBuild = await esbuild.build({
      entryPoints: [path.join(root, 'src/karaoke/smartBeat/analysis.worker.ts')],
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'es2020',
      metafile: true,
      write: false,
    });
    const { metafile } = workerBuild;
    const inputs = Object.keys(metafile.inputs).join('\n').toLowerCase();
    assert.ok(inputs.includes('beatthiswgsl'));
    assert.ok(inputs.includes('htdemucswgsl'));
    assert.ok(!inputs.includes('electron/'));
    assert.ok(!inputs.includes('/stores/'));
    assert.ok(!inputs.includes('components/'));
  });
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
