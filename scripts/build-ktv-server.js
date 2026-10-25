const path = require('path');
require('esbuild').buildSync({
  entryPoints: [path.resolve(__dirname, '../src/server/main.js')],
  outfile: path.resolve(__dirname, '../dist/ktv-server.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  external: ['qrcode'],
});
console.log('Docker KTV server bundled');
