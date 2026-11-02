const assert = require('assert');
require('./helpers/register-babel-src');
const {
  KaraokeRemoteService,
} = require('../src/electron/karaoke/KaraokeRemoteApi');

async function run() {
  const service = new KaraokeRemoteService({
    catalog: {},
    managerBridge: {
      snapshot: async () => ({
        revision: 1,
        currentItem: null,
        waitingItems: [],
        historyItems: [],
      }),
    },
    getRoom: () => ({ code: 'TEST' }),
  });
  const clients = Array.from({ length: 19 }, (_, index) => ({
    clientId: `test-${index}`,
    displayName: `Guest ${index}`,
  }));
  const results = await Promise.all(
    clients.flatMap(client =>
      Array.from({ length: 21 }, () => service.state(client))
    )
  );
  assert.strictEqual(results.length, 399);
  for (let i = 21; i < 40; i++) await service.state(clients[0]);
  await assert.rejects(() => service.state(clients[0]), /RATE_LIMIT/);
  console.log(
    '19 guests plus host state polling capacity and per-client limit passed'
  );
}
run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
