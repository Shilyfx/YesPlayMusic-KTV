const assert = require('assert');
require('./helpers/register-babel-src');

const KaraokeLanLifecycle =
  require('../src/electron/karaoke/KaraokeLanLifecycle').default;

async function run() {
  const calls = [];
  const room = { code: 'ABC123' };
  const server = {
    startRoom: async () => {
      calls.push('start');
      return room;
    },
    stopRoom: async () => calls.push('stop'),
    describeRoom: async () => room,
  };
  const lifecycle = new KaraokeLanLifecycle(server);
  await assert.rejects(() => lifecycle.startRoom(), /先开始本机 KTV/);
  await lifecycle.setSessionActive(true);
  assert.deepEqual(
    await lifecycle.startRoom(
      {},
      { status: 'active', sessionId: 'session-test' }
    ),
    room
  );
  await lifecycle.setSessionActive(false);
  assert.deepEqual(calls, ['start', 'stop']);
  assert.equal((await lifecycle.status()).sessionActive, false);
  console.log('KTV LAN lifecycle tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
