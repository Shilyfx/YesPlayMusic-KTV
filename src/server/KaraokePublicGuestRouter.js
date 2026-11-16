import crypto from 'crypto';

export function createPublicGuestRouter(host) {
  return async function handlePublicGuest(request, response) {
    host.expire();
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    const rawPath = request.url.split('?')[0];
    if (
      !host.publicGuestOrigin ||
      !/^\/[a-zA-Z0-9/_\-.]*$/.test(rawPath) ||
      rawPath.split('/').some(part => part === '.' || part === '..')
    ) {
      return host.json(response, 404, { error: 'NOT_FOUND' });
    }
    const { method } = request;
    if (method === 'GET' && rawPath === '/room') {
      response.writeHead(308, { Location: '/room/' });
      return response.end();
    }
    if (
      method === 'GET' &&
      (rawPath === '/room/' ||
        /^\/room\/(?:js|css|img|fonts)\/[\w./-]+\.(?:js|css|woff2?|ttf|svg|png|jpe?g|webp|gif|avif)$/i.test(
          rawPath
        ))
    ) {
      return host.roomServer.handleRequest(request, response);
    }
    if (method === 'POST' && request.headers.origin !== host.publicGuestOrigin)
      return host.json(response, 403, { error: 'FORBIDDEN' });
    if (method === 'POST' && rawPath === '/ktv/api/client-session') {
      const room = host.roomServer.room;
      if (!room) return host.json(response, 410, { error: 'ROOM_ENDED' });
      const supplied = Buffer.from(request.headers.authorization || '');
      const expected = Buffer.from(`Bearer ${room.publicJoinToken}`);
      if (
        !room.publicJoinToken ||
        supplied.length !== expected.length ||
        !crypto.timingSafeEqual(supplied, expected)
      ) {
        return host.json(response, 401, { error: 'INVALID_JOIN_TOKEN' });
      }
      request.headers.authorization = `Bearer ${room.token}`;
      return host.remoteApi.handle(request, response, true);
    }
    if (method === 'POST' && rawPath === '/ktv/api/reactions')
      return host.handle(request, response, true);
    if (
      (method === 'GET' &&
        /^\/ktv\/api\/(?:state|search|artists\/search|artists\/\d{1,20}\/tracks)$/.test(
          rawPath
        )) ||
      (method === 'POST' && rawPath === '/ktv/api/requests')
    )
      return host.remoteApi.handle(request, response, true);
    return host.json(response, 404, { error: 'NOT_FOUND' });
  };
}
