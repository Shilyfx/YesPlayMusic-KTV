const { performance } = require('perf_hooks');
require('./helpers/register-babel-src');
const { KaraokeRemoteService } = require('../src/electron/karaoke/KaraokeRemoteApi');

async function measure(devices) {
  const service = new KaraokeRemoteService({
    catalog: {},
    managerBridge: { snapshot: async () => ({ revision: 1, currentItem: null, waitingItems: [], historyItems: [] }) },
    getRoom: () => ({ code: 'TEST' }),
  });
  const clients = Array.from({ length: Math.max(0, devices - 1) }, (_, i) => ({ clientId: `guest-${i}`, displayName: 'test' }));
  const times = [];
  const start = performance.now();
  const results = await Promise.allSettled(clients.flatMap(client => Array.from({ length: 21 }, async () => {
    const t = performance.now();
    await service.state(client);
    times.push(performance.now() - t);
  })));
  times.sort((a, b) => a - b);
  return { devices, guests: clients.length, requests: results.length, failed: results.filter(x => x.status === 'rejected').length, totalMs: performance.now() - start, p95HandlerMs: times.length ? times[Math.ceil(times.length * 0.95) - 1] : null };
}
async function main() {
  for (const n of [1, 5, 10, 20]) console.log(JSON.stringify(await measure(n)));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
