import http from 'http';
import KaraokeWebHost from './KaraokeWebHost';

const host = new KaraokeWebHost({
  publicOrigin: process.env.KTV_PUBLIC_ORIGIN,
  remoteDistPath: process.env.KTV_REMOTE_DIST || '/app/remote',
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
