const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
let built = false;
function shouldAcquireFoliaModels({
  nodeEnv = process.env.NODE_ENV,
  command,
} = {}) {
  return (
    nodeEnv === 'production' &&
    command !== 'serve' &&
    command !== 'electron:serve' &&
    command !== 'serve:electron' &&
    command !== 'lint'
  );
}

function prepareFoliaModelsForBuild({
  root = path.resolve(__dirname, '..'),
  requireModels = true,
  run = execFileSync,
} = {}) {
  if (
    !requireModels ||
    !fs.existsSync(path.join(root, 'src/karaoke/smartBeat/analysis.worker.ts'))
  )
    return false;
  run(process.execPath, [path.join(root, 'scripts/fetch-folia-models.cjs')], {
    cwd: root,
    stdio: 'inherit',
  });
  return true;
}

function buildFoliaPv({ requireModels = true } = {}) {
  const root = path.resolve(__dirname, '..');
  const outdir = path.join(root, 'public/pv');
  // Production builds verify both pinned models before publishing the worker.
  prepareFoliaModelsForBuild({ root, requireModels });
  if (built) return;
  fs.mkdirSync(outdir, { recursive: true });
  for (const file of fs.readdirSync(outdir)) {
    if (/^(?:folia-|chunk-).+\.(?:js(?:\.LEGAL\.txt)?|css)$/.test(file))
      fs.unlinkSync(path.join(outdir, file));
  }
  const result = require('esbuild').buildSync({
    absWorkingDir: root,
    entryPoints: {
      folia: 'src/karaoke/folia/runtime.ts',
      ...(fs.existsSync(
        path.join(root, 'src/karaoke/smartBeat/analysis.worker.ts')
      )
        ? {
            'folia-analysis-worker': 'src/karaoke/smartBeat/analysis.worker.ts',
          }
        : {}),
    },
    outdir,
    entryNames: '[name]-[hash]',
    chunkNames: 'chunk-[hash]',
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    metafile: true,
    legalComments: 'linked',
    assetNames: 'assets/[name]-[hash]',
    publicPath: '/pv',
    loader: {
      '.png': 'file',
      '.jpg': 'file',
      '.jpeg': 'file',
      '.gif': 'file',
      '.webp': 'file',
      '.svg': 'file',
      '.woff': 'file',
      '.woff2': 'file',
    },
    alias: {
      'lucide-react/dynamicIconImports': path.join(
        root,
        'src/karaoke/folia/iconImports.js'
      ),
    },
    define: {
      'import.meta.env.DEV': 'false',
      'import.meta.env.PROD': 'true',
      'process.env.NODE_ENV': '"production"',
    },
    logLevel: 'warning',
  });
  const entry = Object.entries(result.metafile.outputs).find(
    ([, v]) => v.entryPoint === 'src/karaoke/folia/runtime.ts'
  );
  if (!entry) throw new Error('PV_ENTRY_NOT_BUILT');
  const analysisWorker = Object.entries(result.metafile.outputs).find(
    ([, value]) =>
      value.entryPoint === 'src/karaoke/smartBeat/analysis.worker.ts'
  );
  const upstream = JSON.parse(
    fs.readFileSync(path.join(root, 'vendor/folia-pv/UPSTREAM.json'))
  );
  fs.writeFileSync(
    path.join(outdir, 'manifest.json'),
    JSON.stringify({
      entry: path.basename(entry[0]),
      upstream: upstream.revision,
      ...(analysisWorker
        ? { analysisWorker: path.basename(analysisWorker[0]) }
        : {}),
      ...(entry[1].cssBundle ? { css: path.basename(entry[1].cssBundle) } : {}),
      ...(fs.existsSync(path.join(root, 'vendor/folia-complete/UPSTREAM.json'))
        ? {
            completeUpstream: JSON.parse(
              fs.readFileSync(
                path.join(root, 'vendor/folia-complete/UPSTREAM.json')
              )
            ).revision,
          }
        : {}),
    }) + '\n'
  );
  fs.copyFileSync(
    path.join(root, 'vendor/folia-pv/LICENSE'),
    path.join(outdir, 'FOLIA-LICENSE.txt')
  );
  // Explicit source allowlist: no checkout metadata, environment files, router
  // credentials, node_modules, user library or unrelated project documents.
  const sources = [
    'src',
    'vendor/folia-pv',
    'vendor/folia-complete',
    'vendor/folia-analysis',
    'public',
    'scripts/build-folia-pv.cjs',
    'scripts/vendor-folia-pv.cjs',
    'scripts/vendor-folia-complete.cjs',
    'scripts/build-folia-metadata.cjs',
    'scripts/vendor-folia-analysis.cjs',
    'scripts/fetch-folia-models.cjs',
    'scripts/serve-local-ktv.cjs',
    'scripts/local-ktv-build.cjs',
    'scripts/build-local-ktv.cjs',
    'scripts/isolate-remote-assets.js',
    'scripts/build-ktv-server.js',
    'scripts/package-router-update.cjs',
    'package.json',
    'yarn.lock',
    'vue.config.js',
    'babel.config.js',
    'postcss.config.js',
    'LICENSE',
    'README.md',
    'THIRD_PARTY_NOTICES.md',
    'docs/folia-pv-port.md',
    'docker/router',
  ].filter(file => fs.existsSync(path.join(root, file)));
  execFileSync('tar', [
    '--exclude=public/pv',
    '-czf',
    path.join(outdir, 'source.tgz'),
    '-C',
    root,
    ...sources,
  ]);
  built = true;
  console.log(
    `Folia PV: ${
      Object.keys(result.metafile.inputs).length
    } modules, lazy-loaded original runtimes`
  );
}
module.exports = {
  buildFoliaPv,
  prepareFoliaModelsForBuild,
  shouldAcquireFoliaModels,
};
if (require.main === module) buildFoliaPv();
