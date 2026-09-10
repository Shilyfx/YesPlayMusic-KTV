const os = require('os');
const fs = require('fs');
const path = require('path');

// Extracted from NeteasyCloudMusicAPI/generateConfig.js. The API package reads
// this file while its request module is being evaluated, so it must exist
// before the package is required (especially on macOS where /var/folders/T is
// recreated between launches).
function ensureAnonymousToken(tmpDirectory = os.tmpdir()) {
  const tokenPath = path.resolve(tmpDirectory, 'anonymous_token');
  try {
    fs.mkdirSync(tmpDirectory, { recursive: true });
    fs.writeFileSync(tokenPath, '', { encoding: 'utf-8', flag: 'wx' });
  } catch (error) {
    // Another process may have created the token between the existence check
    // and write. Preserve the existing token instead of truncating it.
    if (error.code !== 'EEXIST') throw error;
  }
  return tokenPath;
}

module.exports = { ensureAnonymousToken };
