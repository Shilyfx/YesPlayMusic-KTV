import { Writable } from 'stream';
import assert from 'assert/strict';
import { RemoteApiRouter } from '../src/electron/karaoke/KaraokeRemoteApi.js';

// 验证：主屏侧上游风控（UPSTREAM_RATE_LIMIT:毫秒）经路由后变为
// 429 + RATE_LIMIT + Retry-After，而不是笼统的 502 REMOTE_UNAVAILABLE。
function fakeResponse() {
  const response = new Writable({
    write(chunk, _enc, cb) {
      response.body += chunk.toString();
      cb();
    },
  });
  response.body = '';
  response.writeHead = (status, headers) => {
    response.status = status;
    response.headers = headers || {};
  };
  return response;
}

async function run(message) {
  const service = {
    client: () => ({ clientId: 'c1' }),
    search: async () => {
      throw new Error(message);
    },
  };
  const router = new RemoteApiRouter(service);
  const response = fakeResponse();
  const request = {
    method: 'GET',
    url: '/ktv/api/search?q=test',
    headers: { host: 'x', authorization: 'Bearer t' },
    socket: { remoteAddress: '127.0.0.1' },
  };
  await router.handle(request, response, new URL('http://x' + request.url));
  return response;
}

(async () => {
  const limited = await run('UPSTREAM_RATE_LIMIT:6000');
  assert.equal(limited.status, 429);
  assert.equal(JSON.parse(limited.body).error, 'RATE_LIMIT');
  assert.equal(JSON.parse(limited.body).retryAfterMs, 6000);
  assert.equal(limited.headers['Retry-After'], '6');

  const other = await run('SOMETHING_ELSE');
  assert.equal(other.status, 502);
  console.log('PASS: upstream search rate limit maps to 429 with Retry-After');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
