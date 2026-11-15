const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const remoteRoot = path.join(dist, 'remote');

function fail(message) {
  throw new Error(message);
}

function hasControlCharacters(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function isWithin(parent, target) {
  const relative = path.relative(parent, target);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function parseAttributes(tag) {
  const attributes = {};
  const body = tag.replace(/^<[a-z][^\s/>]*/i, '').replace(/\/?>$/, '');
  const pattern =
    /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = pattern.exec(body))) {
    attributes[match[1].toLowerCase()] =
      match[2] !== undefined
        ? match[2]
        : match[3] !== undefined
        ? match[3]
        : match[4] !== undefined
        ? match[4]
        : '';
  }
  return attributes;
}

function localAssetPath(reference) {
  const rawPath = String(reference).split(/[?#]/, 1)[0];
  if (
    !rawPath ||
    rawPath.startsWith('/') ||
    rawPath.startsWith('\\') ||
    /^[a-z][a-z\d+.-]*:/i.test(rawPath) ||
    rawPath.includes('\\') ||
    rawPath.includes('\0')
  )
    fail('Unsafe Remote asset path');

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch (_error) {
    fail('Unsafe Remote asset path');
  }
  if (
    decodedPath.startsWith('/') ||
    decodedPath.startsWith('\\') ||
    decodedPath.includes('\\') ||
    decodedPath.includes('\0')
  )
    fail('Unsafe Remote asset path');

  const segments = decodedPath.split('/');
  while (segments[0] === '.') segments.shift();
  if (
    !segments.length ||
    segments.some(
      segment =>
        !segment ||
        segment === '.' ||
        segment === '..' ||
        segment.includes(':') ||
        segment.includes('?') ||
        segment.includes('#')
    )
  )
    fail('Unsafe Remote asset path');

  const absolutePath = path.resolve(remoteRoot, ...segments);
  if (!isWithin(remoteRoot, absolutePath) || absolutePath === remoteRoot)
    fail('Unsafe Remote asset path');
  return {
    absolutePath,
    archivePath: `remote/${segments.join('/')}`,
  };
}

function assertSafeRemoteTree(directory) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (_error) {
    fail('Remote files are unavailable');
  }

  for (const entry of entries) {
    const name = entry.name;
    if (
      !name ||
      name.startsWith('.') ||
      name.includes('/') ||
      name.includes('\\') ||
      name.includes(':') ||
      name.includes('?') ||
      name.includes('#') ||
      hasControlCharacters(name) ||
      /\.(?:pem|key|p12|pfx|crt|cer|der|jks|map)$/i.test(name) ||
      /(?:^|[._-])(?:credentials?|secrets?)(?:[._-]|$)/i.test(name)
    )
      fail('Remote contains a private or non-release file');

    const entryPath = path.join(directory, name);
    let stat;
    try {
      stat = fs.lstatSync(entryPath);
    } catch (_error) {
      fail('Remote files are unavailable');
    }
    if (stat.isSymbolicLink()) fail('Remote contains an unsafe file path');
    if (stat.isDirectory()) {
      assertSafeRemoteTree(entryPath);
    } else if (!stat.isFile()) {
      fail('Remote contains an unsafe file path');
    }
  }
}

function readRemoteAssets(html) {
  const scripts = [];
  const stylesheets = [];
  const scriptTags = html.match(/<script\b[^>]*>/gi) || [];
  const linkTags = html.match(/<link\b[^>]*>/gi) || [];

  for (const tag of scriptTags) {
    const attributes = parseAttributes(tag);
    if (Object.prototype.hasOwnProperty.call(attributes, 'src'))
      scripts.push(localAssetPath(attributes.src));
  }

  for (const tag of linkTags) {
    const attributes = parseAttributes(tag);
    const rel = (attributes.rel || '').toLowerCase().split(/\s+/);
    if (
      Object.prototype.hasOwnProperty.call(attributes, 'href') &&
      (rel.includes('stylesheet') ||
        (attributes.as || '').toLowerCase() === 'style')
    )
      stylesheets.push(localAssetPath(attributes.href));
  }

  if (!scripts.length || !stylesheets.length)
    fail('Remote HTML must reference scripts and stylesheets');

  return {
    scripts: [
      ...new Map(scripts.map(asset => [asset.archivePath, asset])).values(),
    ],
    stylesheets: [
      ...new Map(stylesheets.map(asset => [asset.archivePath, asset])).values(),
    ],
  };
}

function assertAssetsExist(assets) {
  for (const asset of [...assets.scripts, ...assets.stylesheets]) {
    let stat;
    try {
      stat = fs.lstatSync(asset.absolutePath);
    } catch (_error) {
      fail('Remote asset is missing');
    }
    if (!stat.isFile() || stat.isSymbolicLink())
      fail('Remote asset is missing');
  }
}

function archiveEntries(archivePath) {
  try {
    return execFileSync('tar', ['-tzf', archivePath], {
      encoding: 'utf8',
    })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch (_error) {
    fail('Unable to inspect router archive');
  }
}

function assertSafeArchive(entries, remoteOnly) {
  const normalized = [];
  for (const entry of entries) {
    const name = entry.replace(/\/+$/, '');
    const segments = name.split('/');
    if (
      !name ||
      name.startsWith('/') ||
      name.includes('\\') ||
      /^[a-z]:/i.test(name) ||
      (remoteOnly && segments[0] !== 'remote') ||
      segments.some(
        segment =>
          !segment ||
          segment === '.' ||
          segment === '..' ||
          hasControlCharacters(segment)
      )
    )
      fail('Router archive contains an unsafe path');
    if (
      segments[0] === 'remote' &&
      segments.some(
        segment =>
          segment.includes(':') ||
          segment.includes('?') ||
          segment.includes('#')
      )
    )
      fail('Router archive contains an unsafe path');
    normalized.push(name);
  }
  return new Set(normalized);
}

function packageRouterUpdate(output, options = {}) {
  const remoteOnly = options.remoteOnly === true;
  const outputPath = path.resolve(output);
  if (isWithin(dist, outputPath)) fail('Archive output must be outside dist');

  try {
    if (!fs.lstatSync(dist).isDirectory()) fail('Remote files are unavailable');
    if (!fs.lstatSync(remoteRoot).isDirectory())
      fail('Remote files are unavailable');
  } catch (_error) {
    fail('Remote files are unavailable');
  }
  assertSafeRemoteTree(remoteRoot);

  let html;
  try {
    html = fs.readFileSync(path.join(remoteRoot, 'index.html'), 'utf8');
  } catch (_error) {
    fail('Remote entrypoint is unavailable');
  }
  const assets = readRemoteAssets(html);
  assertAssetsExist(assets);

  const entries = remoteOnly
    ? ['remote']
    : fs
        .readdirSync(dist)
        .filter(name => !['index.html', 'ktv-server.cjs'].includes(name));
  try {
    execFileSync('tar', ['-czf', outputPath, '-C', dist, ...entries]);
  } catch (_error) {
    fail('Unable to create router archive');
  }

  const archived = assertSafeArchive(archiveEntries(outputPath), remoteOnly);
  if (!archived.has('remote/index.html'))
    fail('Remote entrypoint is missing from archive');
  for (const asset of [...assets.scripts, ...assets.stylesheets])
    if (!archived.has(asset.archivePath))
      fail('Remote asset is missing from archive');

  return {
    scripts: assets.scripts.length,
    stylesheets: assets.stylesheets.length,
  };
}

function main() {
  const args = process.argv.slice(2);
  const remoteOnly = args.includes('--remote-only');
  const outputArgs = args.filter(argument => argument !== '--remote-only');
  const output = outputArgs[0];
  if (!output) {
    console.error('Specify an output .tgz path');
    process.exitCode = 1;
    return;
  }
  if (outputArgs.length !== 1) {
    console.error('Specify a single output .tgz path');
    process.exitCode = 1;
    return;
  }

  try {
    const result = packageRouterUpdate(output, { remoteOnly });
    console.log(
      `Router update archive verified: ${result.scripts} scripts, ${
        result.stylesheets
      } stylesheets${remoteOnly ? ' (Remote only)' : ''}`
    );
  } catch (error) {
    console.error(error.message || 'Unable to package router update');
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { packageRouterUpdate };
