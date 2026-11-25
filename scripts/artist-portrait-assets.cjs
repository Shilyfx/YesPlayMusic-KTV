'use strict';

const fs = require('fs');
const path = require('path');

const ARTIST_PORTRAIT_PATHS = Object.freeze([
  '14077324.jpg',
  '2116.jpg',
  '3684.jpg',
  '5771.jpg',
  '5781.jpg',
  '6066.jpg',
  '6452.jpg',
  '6472.jpg',
  '7763.jpg',
]);

function removePath(targetPath) {
  if (!fs.existsSync(targetPath)) return;
  const stat = fs.lstatSync(targetPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fs.unlinkSync(targetPath);
    return;
  }
  fs.readdirSync(targetPath).forEach(name =>
    removePath(path.join(targetPath, name))
  );
  fs.rmdirSync(targetPath);
}

function copyArtistPortraitAssets(
  remoteRoot,
  projectRoot = path.resolve(__dirname, '..')
) {
  const absoluteRemoteRoot = path.resolve(remoteRoot);
  const portraitRoot = path.join(absoluteRemoteRoot, 'artist-portraits');
  removePath(portraitRoot);
  fs.mkdirSync(portraitRoot, { recursive: true });

  const sourceRoot = path.join(
    path.resolve(projectRoot),
    'public',
    'artist-portraits'
  );
  ARTIST_PORTRAIT_PATHS.forEach(fileName => {
    const sourcePath = path.join(sourceRoot, fileName);
    if (!fs.lstatSync(sourcePath).isFile())
      throw new Error(`Artist portrait is not a regular file: ${fileName}`);
    fs.copyFileSync(sourcePath, path.join(portraitRoot, fileName));
  });
}

module.exports = { ARTIST_PORTRAIT_PATHS, copyArtistPortraitAssets };
