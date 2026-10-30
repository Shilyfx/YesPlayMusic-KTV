// Local production preview: the same room backend and music API used by Docker.
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const proxy = require('express-http-proxy');
require('./helpers/register-babel-src');
const KaraokeWebHost = require('../src/server/KaraokeWebHost').default;
const { REACTION_UI_REVISION } = require('../src/karaoke/reactions');
const { validateLocalKtvArtifact } = require('./local-ktv-build.cjs');

function assertLocalKtvPreviewBuild(root) {
  return validateLocalKtvArtifact(path.join(root, 'dist'));
}

async function start() {
  const root = path.resolve(__dirname, '..');
  const dist = path.join(root, 'dist');
  assertLocalKtvPreviewBuild(root);
  const port = Number(process.env.LUMASING_LOCAL_PORT || 18081);
  const origin = process.env.KTV_PUBLIC_ORIGIN || `http://localhost:${port}`;
  const musicPort = Number(process.env.LUMASING_LOCAL_API_PORT || 18082);
  const data = path.join(root, '.local-ktv');
  fs.mkdirSync(data, { recursive: true });
  const dirs = (process.env.KTV_LOCAL_MUSIC_DIRS || '')
    .split(';')
    .map(value => value.trim())
    .filter(Boolean);
  const host = new KaraokeWebHost({
    publicOrigin: origin,
    remoteDistPath: path.join(dist, 'remote'),
    requiredUiRevision: REACTION_UI_REVISION,
    localDirectories: dirs,
    localDirsPath: path.join(data, 'directories.json'),
    localIndexPath: path.join(data, 'index.json'),
    assetDirectory: path.join(data, 'visual-assets'),
  });
  const musicApi = require('@neteaseapireborn/api');
  const api = await musicApi.serveNcmApi({
    port: musicPort,
    host: '127.0.0.1',
    checkVersion: false,
  });
  const app = express();
  app.use('/api', proxy(`http://127.0.0.1:${musicPort}`, { timeout: 20000 }));
  app.use((req, res, next) => {
    if (req.url.startsWith('/ktv/') || req.url.startsWith('/room/'))
      Promise.resolve(host.handle(req, res)).catch(next);
    else next();
  });
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  const server = http.createServer(app);
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  const expire = setInterval(() => host.expire(), 5000);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    clearInterval(expire);
    host.close();
    api.server.close();
    server.close();
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  server.on('error', error => {
    console.error(error);
    stop();
    process.exitCode = 1;
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`LumaSing local service: ${origin}/karaoke`);
  });
}

if (require.main === module) {
  start().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { assertLocalKtvPreviewBuild, start };
