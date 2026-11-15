const assert = require('assert');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const fixtureRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), 'lumasing-release-manifest-')
);

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: fixtureRoot,
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true,
    ...options,
  });
}

function runNode(script, args = []) {
  return run(process.execPath, [script, ...args]);
}

function captureFailure(command, args) {
  try {
    run(command, args);
    return { failed: false, output: '' };
  } catch (error) {
    return {
      failed: true,
      output: `${error.stdout || ''}\n${error.stderr || ''}`,
    };
  }
}

function write(relativePath, contents) {
  const target = path.join(fixtureRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return target;
}

function sha256(contents) {
  return crypto.createHash('sha256').update(contents).digest('hex');
}

function makeFixture() {
  const scripts = path.join(fixtureRoot, 'scripts');
  fs.mkdirSync(scripts, { recursive: true });
  for (const name of [
    'write-ktv-release-manifest.cjs',
    'package-router-update.cjs',
  ]) {
    fs.copyFileSync(
      path.join(repoRoot, 'scripts', name),
      path.join(scripts, name)
    );
  }

  write('.gitignore', 'dist/\n');
  write('dist/index.html', '<main>main screen fixture</main>\n');
  write('dist/ktv-server.cjs', 'module.exports = "server fixture";\n');
  write('dist/app/main.js', 'window.mainApp = true;\n');
  write('dist/assets/site.css', 'body { margin: 0; }\n');
  write('dist/.env.production', 'dist-secret-value\n');
  write(
    'dist/remote/index.html',
    [
      '<!doctype html>',
      '<html><head>',
      '<link rel="stylesheet" href="css/app.123.css">',
      '<link rel="preload" as="style" href="css/vendor.456.css">',
      '</head><body>',
      '<script defer src="js/app.123.js?v=1"></script>',
      '<script src="js/vendor.456.js"></script>',
      '</body></html>',
      '',
    ].join('\n')
  );
  write('dist/remote/css/app.123.css', 'body { color: black; }\n');
  write('dist/remote/css/vendor.456.css', 'html { display: block; }\n');
  write('dist/remote/js/app.123.js', 'window.remoteApp = true;\n');
  write('dist/remote/js/vendor.456.js', 'window.remoteVendor = true;\n');

  run('git', ['init', '-q']);
  run('git', ['config', 'core.autocrlf', 'false']);
  run('git', ['config', 'user.name', 'Release Manifest Test']);
  run('git', ['config', 'user.email', 'release-manifest@example.invalid']);
  run('git', ['add', '.gitignore', 'scripts']);
  run('git', ['commit', '-qm', 'fixture baseline']);
}

function testManifestPreservesFieldsAndReportsDirtyStateWithoutPaths() {
  const mainHtml = '<main>main screen fixture</main>\n';
  const remoteHtml = fs.readFileSync(
    path.join(fixtureRoot, 'dist/remote/index.html'),
    'utf8'
  );
  const serverSource = 'module.exports = "server fixture";\n';

  runNode(path.join(fixtureRoot, 'scripts/write-ktv-release-manifest.cjs'));
  const manifestPath = path.join(fixtureRoot, 'dist/ktv-release.json');
  const cleanManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(cleanManifest.indexSha256, sha256(mainHtml));
  assert.equal(cleanManifest.mainScreenSha256, sha256(mainHtml));
  assert.equal(cleanManifest.remoteIndexSha256, sha256(remoteHtml));
  assert.equal(cleanManifest.serverSha256, sha256(serverSource));
  assert.equal(cleanManifest.workingTreeDirty, false);
  assert.equal(typeof cleanManifest.commit, 'string');
  assert.equal(typeof cleanManifest.builtAt, 'string');

  const secretPath = 'router-secrets/private-key.env';
  write(secretPath, 'fixture-secret-value\n');
  runNode(path.join(fixtureRoot, 'scripts/write-ktv-release-manifest.cjs'));
  const dirtyManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const serialized = JSON.stringify(dirtyManifest);
  assert.equal(dirtyManifest.workingTreeDirty, true);
  assert.ok(!serialized.includes('router-secrets'));
  assert.ok(!serialized.includes('private-key.env'));
  assert.ok(!serialized.includes('fixture-secret-value'));

  fs.appendFileSync(path.join(fixtureRoot, '.gitignore'), '# tracked edit\n');
  runNode(path.join(fixtureRoot, 'scripts/write-ktv-release-manifest.cjs'));
  assert.equal(
    JSON.parse(fs.readFileSync(manifestPath, 'utf8')).workingTreeDirty,
    true
  );
}

function testDefaultRouterArchivePreservesLegacyDistPayloadAndRemoteAssets() {
  const archive = path.join(fixtureRoot, 'router-update.tgz');
  const output = runNode(
    path.join(fixtureRoot, 'scripts/package-router-update.cjs'),
    [archive]
  );
  const entries = run('tar', ['-tzf', archive]).split(/\r?\n/).filter(Boolean);

  for (const expected of [
    'app/main.js',
    'assets/site.css',
    '.env.production',
    'remote/index.html',
    'remote/js/app.123.js',
    'remote/js/vendor.456.js',
    'remote/css/app.123.css',
    'remote/css/vendor.456.css',
  ])
    assert.ok(
      entries.includes(expected),
      `default archive should include ${expected}`
    );

  assert.ok(!entries.includes('index.html'));
  assert.ok(!entries.includes('ktv-server.cjs'));
  assert.ok(!output.includes(fixtureRoot));
  assert.match(output, /2 scripts, 2 stylesheets/i);
}

function testRemoteOnlyModeContainsOnlyValidatedRemoteFiles() {
  const archive = path.join(fixtureRoot, 'remote-only.tgz');
  const output = runNode(
    path.join(fixtureRoot, 'scripts/package-router-update.cjs'),
    ['--remote-only', archive]
  );
  const entries = run('tar', ['-tzf', archive]).split(/\r?\n/).filter(Boolean);

  for (const expected of [
    'remote/index.html',
    'remote/js/app.123.js',
    'remote/js/vendor.456.js',
    'remote/css/app.123.css',
    'remote/css/vendor.456.css',
  ])
    assert.ok(
      entries.includes(expected),
      `remote-only archive should include ${expected}`
    );

  for (const entry of entries) {
    const normalized = entry.replace(/\/+$/, '');
    assert.ok(!normalized.startsWith('/'));
    assert.ok(!/^[A-Za-z]:/.test(normalized));
    assert.ok(!normalized.includes('\\'));
    assert.ok(!normalized.split('/').includes('..'));
    assert.ok(normalized === 'remote' || normalized.startsWith('remote/'));
  }
  assert.ok(!entries.includes('app/main.js'));
  assert.ok(!entries.includes('.env.production'));
  assert.ok(!output.includes(fixtureRoot));
  assert.match(output, /2 scripts, 2 stylesheets/i);
}

function testRouterRejectsUnsafeOrMissingRemoteAssetsWithoutCreatingArchive() {
  const script = path.join(fixtureRoot, 'scripts/package-router-update.cjs');
  const indexPath = path.join(fixtureRoot, 'dist/remote/index.html');
  const originalHtml = fs.readFileSync(indexPath, 'utf8');
  const unsafeArchive = path.join(fixtureRoot, 'unsafe.tgz');
  const unsafeHtml = originalHtml.replace(
    'js/app.123.js?v=1',
    '%2e%2e/.env.production'
  );
  fs.writeFileSync(indexPath, unsafeHtml);
  const unsafeResult = captureFailure(process.execPath, [
    script,
    unsafeArchive,
  ]);
  assert.equal(unsafeResult.failed, true);
  assert.match(unsafeResult.output, /unsafe Remote asset path/i);
  assert.ok(!unsafeResult.output.includes('.env.production'));
  assert.ok(!unsafeResult.output.includes(fixtureRoot));
  assert.equal(fs.existsSync(unsafeArchive), false);

  const unsafeRemoteOnlyResult = captureFailure(process.execPath, [
    script,
    '--remote-only',
    unsafeArchive,
  ]);
  assert.equal(unsafeRemoteOnlyResult.failed, true);
  assert.match(unsafeRemoteOnlyResult.output, /unsafe Remote asset path/i);
  assert.ok(!unsafeRemoteOnlyResult.output.includes(fixtureRoot));
  assert.equal(fs.existsSync(unsafeArchive), false);

  fs.writeFileSync(indexPath, originalHtml);
  fs.unlinkSync(path.join(fixtureRoot, 'dist/remote/css/vendor.456.css'));
  const missingArchive = path.join(fixtureRoot, 'missing.tgz');
  const missingResult = captureFailure(process.execPath, [
    script,
    missingArchive,
  ]);
  assert.equal(missingResult.failed, true);
  assert.match(missingResult.output, /Remote asset is missing/i);
  assert.ok(!missingResult.output.includes(fixtureRoot));
  assert.equal(fs.existsSync(missingArchive), false);

  write('dist/remote/css/vendor.456.css', 'html { display: block; }\n');
  write('dist/remote/.env.production', 'remote-secret-value\n');
  const privateArchive = path.join(fixtureRoot, 'private.tgz');
  const privateResult = captureFailure(process.execPath, [
    script,
    privateArchive,
  ]);
  assert.equal(privateResult.failed, true);
  assert.match(privateResult.output, /private or non-release file/i);
  assert.ok(!privateResult.output.includes('remote-secret-value'));
  assert.ok(!privateResult.output.includes(fixtureRoot));
  assert.equal(fs.existsSync(privateArchive), false);

  fs.unlinkSync(path.join(fixtureRoot, 'dist/remote/.env.production'));
  const insideDistArchive = path.join(fixtureRoot, 'dist/inside.tgz');
  const insideDistResult = captureFailure(process.execPath, [
    script,
    insideDistArchive,
  ]);
  assert.equal(insideDistResult.failed, true);
  assert.match(insideDistResult.output, /outside dist/i);
  assert.ok(!insideDistResult.output.includes(fixtureRoot));
  assert.equal(fs.existsSync(insideDistArchive), false);
}

try {
  makeFixture();
  testManifestPreservesFieldsAndReportsDirtyStateWithoutPaths();
  testDefaultRouterArchivePreservesLegacyDistPayloadAndRemoteAssets();
  testRemoteOnlyModeContainsOnlyValidatedRemoteFiles();
  testRouterRejectsUnsafeOrMissingRemoteAssetsWithoutCreatingArchive();
  console.log('KTV release manifest and router archive tests passed');
} finally {
  if (fs.rmSync) fs.rmSync(fixtureRoot, { recursive: true, force: true });
  else fs.rmdirSync(fixtureRoot, { recursive: true });
}
