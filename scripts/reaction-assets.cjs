'use strict';

const fs = require('fs');
const path = require('path');

const REACTION_ASSET_PATHS = Object.freeze([
  'emotion-ball/js/rings.js',
  'emotion-ball/js/emotions.js',
  'emotion-ball/js/ball.js',
  'emotion-ball/js/engine.js',
  'mood-mates/src/core/geometry.js',
  'mood-mates/src/core/render.js',
  'mood-mates/src/core/features.js',
  'mood-mates/src/core/fx.js',
  'mood-mates/src/data/emotions.js',
  'mood-mates/src/core/engine.js',
  'mood-mates/src/characters/nimbo.js',
  'mood-mates/src/characters/twinkle.js',
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

function copyReactionAssets(
  remoteRoot,
  projectRoot = path.resolve(__dirname, '..')
) {
  const absoluteRemoteRoot = path.resolve(remoteRoot);
  const jsRoot = path.join(absoluteRemoteRoot, 'js');
  fs.mkdirSync(jsRoot, { recursive: true });
  if (
    !fs.lstatSync(jsRoot).isDirectory() ||
    fs.lstatSync(jsRoot).isSymbolicLink()
  )
    throw new Error('Remote JavaScript asset path must be a directory');

  const reactionRoot = path.join(jsRoot, 'reactions');
  removePath(reactionRoot);
  const sourceRoot = path.join(
    path.resolve(projectRoot),
    'public',
    'reactions'
  );

  REACTION_ASSET_PATHS.forEach(relativePath => {
    const sourcePath = path.join(sourceRoot, ...relativePath.split('/'));
    if (!fs.lstatSync(sourcePath).isFile())
      throw new Error(`Reaction asset is not a regular file: ${relativePath}`);
    const destinationPath = path.join(reactionRoot, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
  });
}

module.exports = { REACTION_ASSET_PATHS, copyReactionAssets };
