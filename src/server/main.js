import http from 'http';
import KaraokeWebHost from './KaraokeWebHost';
import { REACTION_UI_REVISION } from '../karaoke/reactions';

const defaultLocalDirs = (process.env.KTV_LOCAL_MUSIC_DIRS || '/music/周杰伦')
  .split(/[,;]/)
  .map(item => item.trim())
  .filter(Boolean);

const host = new KaraokeWebHost({
  publicOrigin: process.env.KTV_PUBLIC_ORIGIN,
  remoteDistPath: process.env.KTV_REMOTE_DIST || '/app/remote',
  requiredUiRevision: REACTION_UI_REVISION,
  localDirectories: defaultLocalDirs,
  localDirsPath:
    process.env.KTV_LOCAL_DIRS_PATH || '/data/karaoke-local-dirs.json',
  localIndexPath:
    process.env.KTV_LOCAL_INDEX_PATH || '/data/karaoke-local-index.json',
  assetDirectory: process.env.KTV_VISUAL_ASSETS_PATH || '/data/visual-assets',
});
const server = http.createServer((req, res) => host.handle(req, res));
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(Number(process.env.PORT || 3100), '0.0.0.0');
const leaseTimer = setInterval(() => host.expire(), 5000);
process.on('SIGTERM', () => {
  clearInterval(leaseTimer);
  host.close();
  server.close(() => process.exit(0));
});
