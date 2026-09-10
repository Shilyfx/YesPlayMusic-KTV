const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureAnonymousToken } = require('../src/utils/checkAuthToken.js');

const testDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'lumasing-anonymous-token-')
);
const tokenPath = path.join(testDirectory, 'anonymous_token');

try {
  assert.strictEqual(ensureAnonymousToken(testDirectory), tokenPath);
  assert.ok(fs.existsSync(tokenPath), 'fresh launch must create the token');
  assert.strictEqual(fs.readFileSync(tokenPath, 'utf8'), '');

  fs.writeFileSync(tokenPath, 'existing-token', 'utf8');
  ensureAnonymousToken(testDirectory);
  assert.strictEqual(
    fs.readFileSync(tokenPath, 'utf8'),
    'existing-token',
    'startup must not truncate an existing token'
  );
} finally {
  if (fs.existsSync(tokenPath)) fs.unlinkSync(tokenPath);
  fs.rmdirSync(testDirectory);
}

console.log('Anonymous token cold-start tests passed');
