const fs = require('fs');
const path = require('path');

const distPath = path.resolve(__dirname, '..', 'dist');
const remotePath = path.join(distPath, 'remote');
const indexPath = path.join(remotePath, 'index.html');

function copyAsset(match, directory) {
  const source = path.join(distPath, directory, match);
  const targetDirectory = path.join(remotePath, directory);
  fs.mkdirSync(targetDirectory, { recursive: true });
  fs.copyFileSync(source, path.join(targetDirectory, match));
}

function run() {
  let html = fs.readFileSync(indexPath, 'utf8');
  const assets = [];
  html.replace(/\/(?:js|css)\/([^"']+)/g, (_, asset) => {
    assets.push(asset);
    return _;
  });
  assets.forEach(asset => {
    const directory = asset.endsWith('.css') ? 'css' : 'js';
    copyAsset(asset, directory);
  });
  html = html
    .replace(/\/(js|css)\//g, '$1/')
    .replace(
      /<link rel="(?:icon|manifest|apple-touch-icon|mask-icon)"[^>]*>\s*/g,
      ''
    )
    .replace(
      /<meta name="(?:theme-color|apple-mobile-web-app-[^"]+|msapplication-[^"]+)"[^>]*>\s*/g,
      ''
    );
  fs.writeFileSync(indexPath, html);
  console.log('Remote assets isolated under dist/remote');
}

run();
