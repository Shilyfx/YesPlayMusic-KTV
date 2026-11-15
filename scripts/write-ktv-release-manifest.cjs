const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

function gitOutput(args, failureMessage) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
    }).trim();
  } catch (_error) {
    throw new Error(failureMessage);
  }
}

function sha256(relativePath) {
  const artifactPath = path.resolve(dist, relativePath);
  const relativeArtifactPath = path.relative(dist, artifactPath);
  if (
    !relativeArtifactPath ||
    relativeArtifactPath === '..' ||
    relativeArtifactPath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeArtifactPath)
  )
    throw new Error('Release artifact is missing or unsafe');

  try {
    if (!fs.lstatSync(dist).isDirectory())
      throw new Error('Release artifact is missing or unsafe');
    const parentSegments = relativeArtifactPath.split(path.sep).slice(0, -1);
    let parentPath = dist;
    parentSegments.forEach(segment => {
      parentPath = path.join(parentPath, segment);
      if (!fs.lstatSync(parentPath).isDirectory())
        throw new Error('Release artifact is missing or unsafe');
    });
    if (!fs.lstatSync(artifactPath).isFile())
      throw new Error('Release artifact is missing or unsafe');
    return crypto
      .createHash('sha256')
      .update(fs.readFileSync(artifactPath))
      .digest('hex');
  } catch (_error) {
    throw new Error('Release artifact is missing or unsafe');
  }
}

function createManifest() {
  const commit = gitOutput(
    ['rev-parse', 'HEAD'],
    'Unable to determine release commit'
  );
  const workingTreeDirty = Boolean(
    gitOutput(
      ['status', '--porcelain=v1', '--untracked-files=all'],
      'Unable to determine working-tree status'
    )
  );
  const mainScreenSha256 = sha256('index.html');

  return {
    commit,
    builtAt: new Date().toISOString(),
    // Keep the original field for consumers that still read indexSha256.
    indexSha256: mainScreenSha256,
    serverSha256: sha256('ktv-server.cjs'),
    mainScreenSha256,
    remoteIndexSha256: sha256(path.join('remote', 'index.html')),
    workingTreeDirty,
  };
}

function main() {
  const manifest = createManifest();
  try {
    fs.writeFileSync(
      path.join(dist, 'ktv-release.json'),
      JSON.stringify(manifest, null, 2) + '\n'
    );
  } catch (_error) {
    throw new Error('Unable to write release manifest');
  }
  console.log(JSON.stringify(manifest));
}

try {
  main();
} catch (error) {
  console.error(error.message || 'Unable to write release manifest');
  process.exitCode = 1;
}
