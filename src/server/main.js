import http from 'http';
import KaraokeWebHost from './KaraokeWebHost';
import { REACTION_UI_REVISION } from '../karaoke/reactions';

const defaultLocalDirs = (process.env.KTV_LOCAL_MUSIC_DIRS || '/music/周杰伦')
  .split(/[,;]/)
  .map(item => item.trim())
  .filter(Boolean);

const multiroomGatewayOrigin = process.env.KTV_MULTIROOM_GATEWAY_ORIGIN || '';
const multiroomHostId = process.env.KTV_MULTIROOM_HOST_ID || '';
const multiroomHostSecret = process.env.KTV_MULTIROOM_HOST_SECRET || '';

const host = new KaraokeWebHost({
  publicOrigin: process.env.KTV_PUBLIC_ORIGIN || '',
  publicGuestOrigin: process.env.KTV_PUBLIC_GUEST_ORIGIN || '',
  gatewayOrigin: multiroomGatewayOrigin,
  gatewayHostId: multiroomHostId,
  gatewayHostSecret: multiroomHostSecret,
  allowedHosts: (process.env.KTV_ALLOWED_HOSTS || '')
    .split(/[,;]/)
    .map(item => item.trim())
    .filter(Boolean),
  remoteDistPath: process.env.KTV_REMOTE_DIST || '/app/remote',
  altOrigins: (process.env.KTV_ALT_ORIGINS || '')
    .split(/[,;]/)
    .map(item => item.trim())
    .filter(Boolean),
  requiredUiRevision: REACTION_UI_REVISION,
  localDirectories: defaultLocalDirs,
  localDirsPath:
    process.env.KTV_LOCAL_DIRS_PATH || '/data/karaoke-local-dirs.json',
  localIndexPath:
    process.env.KTV_LOCAL_INDEX_PATH || '/data/karaoke-local-index.json',
  assetDirectory: process.env.KTV_VISUAL_ASSETS_PATH || '/data/visual-assets',
});
const publicGuestOrigins = new Set(
  [
    host.publicGuestOrigin,
    host.gatewayHostConfig ? host.gatewayOrigin : '',
  ].filter(Boolean)
);
const server = http.createServer((req, res) => host.handle(req, res));
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(Number(process.env.PORT || 3100), '0.0.0.0');
const publicGuestServer = host.publicGuestOrigin
  ? http.createServer(async (request, response) => {
      const origin = request.headers.origin;
      if (origin && publicGuestOrigins.has(origin))
        request.headers.origin = host.publicGuestOrigin;
      try {
        await host.handlePublicGuest(request, response);
      } catch (_) {
        if (response.headersSent) response.destroy();
        else host.json(response, 502, { error: 'REMOTE_UNAVAILABLE' });
      }
    })
  : null;
if (publicGuestServer) {
  publicGuestServer.requestTimeout = 15000;
  publicGuestServer.headersTimeout = 10000;
  publicGuestServer.listen(3101, '0.0.0.0');
}
const leaseTimer = setInterval(() => host.expire(), 5000);
let shuttingDown = false;
const closeServer = serverToClose =>
  new Promise(resolve => {
    if (!serverToClose || !serverToClose.listening) return resolve();
    serverToClose.close(resolve);
  });
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(leaseTimer);
  await host.close();
  await Promise.all([closeServer(publicGuestServer), closeServer(server)]);
  process.exit(0);
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
