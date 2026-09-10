import clc from 'cli-color';
const { ensureAnonymousToken } = require('@/utils/checkAuthToken');

export async function startNeteaseMusicApi() {
  // Let user know that the service is starting
  console.log(`${clc.redBright('[NetEase API]')} initiating NCM API`);

  // The request module reads anonymous_token at require time. Create it
  // before loading the bundled API so a fresh macOS temp directory cannot
  // abort the Electron main process during startup.
  ensureAnonymousToken();
  const server = require('@neteaseapireborn/api/server');

  // Load the NCM API.
  await server.serveNcmApi({
    port: 10754,
    moduleDefs: require('../ncmModDef'),
  });
  return true;
}
