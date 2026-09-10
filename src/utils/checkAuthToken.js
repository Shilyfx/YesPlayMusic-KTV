import os from 'os';
import fs from 'fs';
import path from 'path';

// Extracted from NeteasyCloudMusicAPI/generateConfig.js. The API package reads
// this file while its request module is being evaluated, so it must exist
// before the package is required (especially on macOS where /var/folders/T is
// recreated between launches).
export function ensureAnonymousToken() {
  const tokenPath = path.resolve(os.tmpdir(), 'anonymous_token');
  try {
    if (!fs.existsSync(tokenPath)) fs.writeFileSync(tokenPath, '', 'utf-8');
  } catch (error) {
    // Keep startup resilient when the OS temp directory is briefly unavailable;
    // the API will report its own error instead of crashing the main process.
    console.warn('[NetEase API] anonymous token unavailable:', error.message);
  }
  return tokenPath;
}

ensureAnonymousToken();
