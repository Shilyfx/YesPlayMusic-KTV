const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const output = process.argv[2];
if (!output) throw new Error('Specify an output .tgz path');
const dist = path.join(root, 'dist');
// Enumerate root entries: tar exclude patterns can also exclude remote/index.html.
const entries = fs
  .readdirSync(dist)
  .filter(name => !['index.html', 'ktv-server.cjs'].includes(name));
execFileSync('tar', ['-czf', path.resolve(output), '-C', dist, ...entries]);
const listed = execFileSync('tar', ['-tzf', path.resolve(output)], {
  encoding: 'utf8',
}).split(/\r?\n/);
if (!listed.includes('remote/index.html'))
  throw new Error('Archive is missing the Remote entrypoint');
const html = fs.readFileSync(path.join(dist, 'remote/index.html'), 'utf8');
const script = html.match(/<script[^>]+src="([^"]+)"/);
if (!script || !listed.includes(`remote/${script[1]}`))
  throw new Error('Archive is missing the Remote script');
console.log(
  `Router update archive verified: Remote entrypoint and ${script[1]}`
);
