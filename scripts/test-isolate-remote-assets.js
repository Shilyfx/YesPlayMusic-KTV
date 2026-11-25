const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isolateRemoteAssets } = require('./isolate-remote-assets');

const projectRoot = path.resolve(__dirname, '..');
const portraitFiles = [
  '14077324.jpg',
  '2116.jpg',
  '3684.jpg',
  '5771.jpg',
  '5781.jpg',
  '6066.jpg',
  '6452.jpg',
  '6472.jpg',
  '7763.jpg',
];

function run() {
  const distPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ktv-remote-assets-'));
  try {
    fs.mkdirSync(path.join(distPath, 'remote'), { recursive: true });
    fs.mkdirSync(path.join(distPath, 'js'), { recursive: true });
    fs.mkdirSync(path.join(distPath, 'css'), { recursive: true });
    fs.mkdirSync(path.join(distPath, 'remote', 'artist-portraits'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(distPath, 'remote', 'artist-portraits', 'stale.jpg'),
      'stale asset from an earlier build'
    );
    fs.writeFileSync(
      path.join(distPath, 'remote', 'index.html'),
      '<link href="/css/remote.css"><script src="/js/remote.js"></script>'
    );
    fs.writeFileSync(path.join(distPath, 'css', 'remote.css'), 'body{}');
    fs.writeFileSync(path.join(distPath, 'js', 'remote.js'), 'window.room=true;');

    isolateRemoteAssets(distPath, projectRoot);

    for (const fileName of portraitFiles) {
      const sourcePath = path.join(
        projectRoot,
        'public',
        'artist-portraits',
        fileName
      );
      const remotePath = path.join(
        distPath,
        'remote',
        'artist-portraits',
        fileName
      );
      assert.deepEqual(
        fs.readFileSync(remotePath),
        fs.readFileSync(sourcePath),
        `${fileName} is copied unchanged into the isolated room bundle`
      );
    }
    assert.deepEqual(
      fs.readdirSync(path.join(distPath, 'remote', 'artist-portraits')).sort(),
      portraitFiles.slice().sort(),
      'the isolated bundle contains only the shipped featured portraits'
    );
  } finally {
    fs.rmSync(distPath, { recursive: true, force: true });
  }
}

run();
console.log('Remote static artist portrait packaging tests passed');
