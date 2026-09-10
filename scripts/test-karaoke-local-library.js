const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

require('./helpers/register-babel-src');

const KaraokeLocalLibrary =
  require('../src/electron/karaoke/KaraokeLocalLibrary').default;

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ktv-local-library-'));
  const directory = path.join(root, 'Library');
  const indexPath = path.join(root, 'index.json');
  fs.mkdirSync(directory);
  for (let index = 0; index < 12; index += 1) {
    const stem = `Artist ${index} - Song ${index}`;
    fs.writeFileSync(path.join(directory, `${stem}.mp3`), `audio-${index}`);
    fs.writeFileSync(
      path.join(directory, `${stem}.lrc`),
      `[00:00.00]Song ${index}\n`
    );
    fs.writeFileSync(path.join(directory, `${stem}.jpg`), 'cover');
  }

  const counters = { readdir: 0, stat: 0, access: 0, readFile: 0 };
  const originals = {};
  ['readdir', 'stat', 'access', 'readFile'].forEach(name => {
    originals[name] = fs.promises[name];
    fs.promises[name] = async function instrumented(...args) {
      counters[name] += 1;
      return originals[name].apply(this, args);
    };
  });

  try {
    const library = new KaraokeLocalLibrary([directory], { indexPath });
    await library.indexReady;
    Object.keys(counters).forEach(name => (counters[name] = 0));
    const first = library.scan();
    assert.strictEqual(
      first,
      library.scan(),
      'scan calls should share scanPromise'
    );
    const firstPlaylists = await first;
    assert.strictEqual(firstPlaylists[0].tracks.length, 12);
    assert.strictEqual(counters.readFile, 12);
    assert.ok(fs.existsSync(indexPath), 'scan should persist the index');

    Object.keys(counters).forEach(name => (counters[name] = 0));
    const second = await library.scan();
    assert.strictEqual(second[0].tracks.length, 12);
    assert.strictEqual(
      counters.readFile,
      0,
      'unchanged LRC files should be reused'
    );
    assert.strictEqual(
      counters.access,
      0,
      'scan should not probe every sibling with access'
    );

    const changedLyrics = path.join(directory, 'Artist 0 - Song 0.lrc');
    fs.writeFileSync(changedLyrics, '[00:00.00]Changed\n');
    Object.keys(counters).forEach(name => (counters[name] = 0));
    await library.scan();
    assert.strictEqual(
      counters.readFile,
      1,
      'changed LRC should be reparsed once'
    );

    const restored = new KaraokeLocalLibrary([directory], { indexPath });
    const restoredPlaylists = await restored.ensureIndexed();
    assert.strictEqual(restoredPlaylists[0].tracks.length, 12);
    assert.strictEqual(
      restoredPlaylists[0].tracks[0].lyrics[0].content,
      'Changed'
    );
    console.log('KTV local library incremental tests passed');
  } finally {
    Object.keys(originals).forEach(
      name => (fs.promises[name] = originals[name])
    );
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
