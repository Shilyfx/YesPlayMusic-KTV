'use strict';

const fs = require('fs');
const { createGateway } = require('./gateway.cjs');

function start(env = process.env) {
  const credentialFile = env.LUMASING_GATEWAY_CREDENTIALS_FILE;
  if (!credentialFile)
    throw new Error('LUMASING_GATEWAY_CREDENTIALS_FILE is required');
  const stat = fs.statSync(credentialFile);
  if (!stat.isFile() || (process.platform !== 'win32' && stat.mode & 0o077))
    throw new Error('Credential file must be private (0600)');
  const credentials = JSON.parse(fs.readFileSync(credentialFile, 'utf8'));
  const server = createGateway({ hostCredentials: credentials });
  const port = Number(env.LUMASING_GATEWAY_PORT || 13102);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid gateway port');
  server.listen(port, '127.0.0.1', () =>
    console.log('LumaSing multi-room gateway listening on loopback')
  );
  const shutdown = () => server.close(() => process.exit(0));
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return server;
}

if (require.main === module) {
  try {
    start();
  } catch (error) {
    console.error('Gateway startup failed:', error.message);
    process.exitCode = 1;
  }
}
module.exports = { start };
