const fs = require('fs');
const path = require('path');
const tokenPath = path.join(require('os').tmpdir(), 'anonymous_token');
fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
fs.closeSync(fs.openSync(tokenPath, 'a'));
const { serveNcmApi } = require('@neteaseapireborn/api/server');
serveNcmApi({ port: Number(process.env.PORT || 3000), checkVersion: false })
  .then(() => require('@neteaseapireborn/api/generateConfig')())
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
