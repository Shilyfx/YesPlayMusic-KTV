const fs = require('fs');
const path = require('path');

function isolateRemoteAssets(distPath) {
  const remotePath = path.join(distPath, 'remote');
  const indexPath = path.join(remotePath, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  const assets = [];
  html.replace(
    /(?:app:\/\/\.|)\/(js|css)\/([^"']+)/g,
    (_, directory, asset) => {
      assets.push({ directory, asset });
      return _;
    }
  );
  assets.forEach(({ directory, asset }) => {
    const source = path.join(distPath, directory, asset);
    const targetDirectory = path.join(remotePath, directory);
    fs.mkdirSync(targetDirectory, { recursive: true });
    fs.copyFileSync(source, path.join(targetDirectory, asset));
  });
  html = html
    .replace(/(?:app:\/\/\.|)\/(js|css)\//g, '$1/')
    .replace(
      /<link rel="(?:icon|manifest|apple-touch-icon|mask-icon)"[^>]*>\s*/g,
      ''
    )
    .replace(
      /<meta name="(?:theme-color|apple-mobile-web-app-[^"]+|msapplication-[^"]+)"[^>]*>\s*/g,
      ''
    );
  fs.writeFileSync(indexPath, html);
}

if (require.main === module) {
  isolateRemoteAssets(path.resolve(__dirname, '..', process.argv[2] || 'dist'));
  console.log('Remote assets isolated under remote/');
}

module.exports = { isolateRemoteAssets };
