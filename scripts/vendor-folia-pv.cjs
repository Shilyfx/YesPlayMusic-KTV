// Copy the runtime dependency closure from a pinned Folia checkout, not its app.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const { execFileSync } = require('child_process');
const root = path.resolve(process.argv[2] || '');
const destination = path.resolve(__dirname, '../vendor/folia-pv');
const entries = ['sonnet', 'tempera', 'hanabi']
  .flatMap(mode => {
    const title = mode[0].toUpperCase() + mode.slice(1);
    return [
      `src/components/visualizer/${mode}/create${title}PixiRuntime.ts`,
      `src/components/visualizer/${mode}/${mode}Program.ts`,
    ];
  })
  .concat(['src/types.ts', 'src/components/visualizer/hanabi/types.ts']);
const result = esbuild.buildSync({
  absWorkingDir: root,
  entryPoints: entries,
  outdir: '__analysis__',
  bundle: true,
  write: false,
  metafile: true,
  packages: 'external',
  platform: 'browser',
  format: 'esm',
  target: 'es2020',
  define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
  logLevel: 'warning',
});
const inputs = Object.keys(result.metafile.inputs);
const packages = new Set();
for (const input of Object.values(result.metafile.inputs))
  for (const entry of input.imports)
    if (entry.external) packages.add(entry.path);
console.log(JSON.stringify({ files: inputs.length, packages: [...packages] }));
if (process.argv.includes('--analyze')) process.exit(0);
for (const relative of inputs) {
  const from = path.resolve(root, relative);
  if (!from.startsWith(root + path.sep)) throw new Error('OUTSIDE_SOURCE');
  const to = path.join(destination, relative);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(destination, 'LICENSE'));
// Keep the narrowly scoped viewport callback reproducible when refreshing the
// pinned source. A changed upstream context must fail instead of dropping it.
execFileSync(
  'git',
  [
    'apply',
    '--directory=vendor/folia-pv',
    path.join(destination, 'LUMASING.patch'),
  ],
  { cwd: path.resolve(__dirname, '..') }
);
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
fs.writeFileSync(
  path.join(destination, 'UPSTREAM.json'),
  JSON.stringify(
    {
      repository: 'https://github.com/chthollyphile/folia-major',
      revision,
      license: 'AGPL-3.0',
      patches: ['LUMASING.patch'],
      files: inputs.sort(),
    },
    null,
    2
  ) + '\n'
);
