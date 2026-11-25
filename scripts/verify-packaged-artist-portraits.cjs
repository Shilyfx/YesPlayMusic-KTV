'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const asar = require('asar');

const appPath = process.argv[2];
assert.ok(
  appPath,
  'usage: node verify-packaged-artist-portraits.cjs <mounted-app>'
);

const archivePath = path.join(appPath, 'Contents', 'Resources', 'app.asar');
assert.ok(
  fs.statSync(archivePath).isFile(),
  `Missing packaged archive: ${archivePath}`
);

const sourceRoot = path.resolve(__dirname, '..', 'public', 'artist-portraits');
const sourceEntries = fs.readdirSync(sourceRoot, { withFileTypes: true });
assert.strictEqual(
  sourceEntries.length,
  9,
  'public/artist-portraits must contain exactly nine static portraits'
);
assert.ok(
  sourceEntries.every(entry => entry.isFile() && entry.name.endsWith('.jpg')),
  'public/artist-portraits must contain only regular .jpg files'
);

const sourceNames = sourceEntries.map(entry => entry.name).sort();
const packageEntries = asar
  .listPackage(archivePath)
  .map(entry => entry.replace(/\\/g, '/'))
  .filter(entry => entry.startsWith('/remote/artist-portraits/'))
  .map(entry => entry.slice(1))
  .sort();
const expectedPackageEntries = sourceNames
  .map(name => `remote/artist-portraits/${name}`)
  .sort();

assert.deepStrictEqual(
  packageEntries,
  expectedPackageEntries,
  'app.asar must contain exactly the nine public artist portraits under remote/'
);

sourceNames.forEach(name => {
  const source = fs.readFileSync(path.join(sourceRoot, name));
  const packaged = asar.extractFile(
    archivePath,
    path.join('remote', 'artist-portraits', name)
  );
  assert.ok(
    source.equals(packaged),
    `Packaged artist portrait differs from public source: ${name}`
  );
});

console.log(
  `Verified all nine remote/artist-portraits files in ${archivePath} against public/artist-portraits`
);
