const http = require('http');
const assert = require('assert');

if (process.argv[2] === 'serve') {
  http.createServer((req, res) => {
    res.setHeader('Set-Cookie', Array.from({ length: 8 }, (_, i) =>
      `test${i}=${'a'.repeat(3000)}; Path=/; HttpOnly`));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ code: 803, fixture: true }));
  }).listen(3000, '0.0.0.0');
} else {
  const request = http.get('http://web/api/qr-header-test', {
    maxHeaderSize: 128 * 1024,
    timeout: 10000,
  }, res => {
    let body = '';
    res.on('data', part => { body += part; });
    res.on('end', () => {
      assert.strictEqual(res.statusCode, 200, 'large login headers must not become nginx 502');
      assert.strictEqual(JSON.parse(body).code, 803);
      assert.strictEqual(res.headers['set-cookie'].length, 8);
      console.log('PASS: login response and eight 3KB cookie headers forwarded intact');
    });
  });
  request.on('timeout', () => request.destroy(new Error('proxy test timed out')));
  request.on('error', error => { console.error(error.message); process.exitCode = 1; });
}
