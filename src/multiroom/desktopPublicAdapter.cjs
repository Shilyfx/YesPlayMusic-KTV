'use strict';

const crypto = require('crypto');
const {
  projectPublicLocalPlaylistResponse,
  projectPublicUserPlaylistResponse,
} = require('./hostConnector.cjs');

function publicCatalogResponse(request, response) {
  const path = request.url.split('?')[0];
  const project =
    path === '/ktv/api/local-playlists'
      ? projectPublicLocalPlaylistResponse
      : path === '/ktv/api/playlists'
      ? projectPublicUserPlaylistResponse
      : null;
  if (request.method !== 'GET' || !project) return response;

  let status = 200;
  let headers = {};
  return {
    setHeader(name, value) {
      headers[name] = value;
    },
    writeHead(code, values = {}) {
      status = code;
      headers = { ...headers, ...values };
      return this;
    },
    end(body) {
      let output = body == null ? Buffer.alloc(0) : Buffer.from(body);
      if (status >= 200 && status < 300) {
        try {
          output = project(output);
        } catch (_) {
          status = 502;
          output = Buffer.from('{"error":"INVALID_PUBLIC_CATALOG_RESPONSE"}');
        }
        headers['Content-Type'] = 'application/json; charset=utf-8';
      }
      Object.keys(headers).forEach(name => {
        if (name.toLowerCase() === 'content-length') delete headers[name];
      });
      headers['Content-Length'] = Buffer.byteLength(output);
      response.writeHead(status, headers);
      return response.end(output);
    },
  };
}

// The gateway forwards only the guest surface to this adapter. It never
// forwards host commands or local audio paths to the desktop application.
function createDesktopPublicAdapter({
  roomServer,
  remoteApi,
  publicOrigin,
  getPublicToken,
  handleReaction,
}) {
  const origin = new URL(publicOrigin).origin;
  function respond(res, status, error) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify({ error }));
  }
  return async function handle(req, res) {
    res.setHeader('Referrer-Policy', 'no-referrer');
    const path = req.url.split('?')[0];
    if (
      !/^\/[a-zA-Z0-9/_\-.]*$/.test(path) ||
      path.split('/').some(part => part === '.' || part === '..')
    )
      return respond(res, 404, 'NOT_FOUND');
    if (
      req.method === 'GET' &&
      (path === '/room/' ||
        /^\/room\/artist-portraits\/\d+\.jpg$/.test(path) ||
        /^\/room\/(?:js|css|img|fonts)\/[\w./-]+\.(?:js|css|woff2?|ttf|svg|png|jpe?g|webp|gif|avif)$/i.test(
          path
        ))
    ) {
      return roomServer.sendRemoteAsset(
        path === '/room/' ? '/index.html' : path.slice(5),
        res
      );
    }
    if (req.method === 'POST' && req.headers.origin !== origin)
      return respond(res, 403, 'FORBIDDEN');
    if (!roomServer.room) return respond(res, 410, 'ROOM_ENDED');
    if (req.method === 'POST' && path === '/ktv/api/client-session') {
      const expected = Buffer.from('Bearer ' + (getPublicToken() || ''));
      const actual = Buffer.from(req.headers.authorization || '');
      if (
        !getPublicToken() ||
        actual.length !== expected.length ||
        !crypto.timingSafeEqual(actual, expected)
      )
        return respond(res, 401, 'INVALID_JOIN_TOKEN');
      req.headers.authorization = 'Bearer ' + roomServer.room.token;
      return remoteApi.handle(req, res, true);
    }
    if (
      req.method === 'POST' &&
      path === '/ktv/api/reactions' &&
      handleReaction
    )
      return handleReaction(req, res, true);
    if (
      (req.method === 'GET' &&
        /^\/ktv\/api\/(?:state|search|artists\/search|artists\/\d{1,20}\/tracks|recommendations|toplists|playlists|local-playlists|(?:recommendations|toplists|playlists)\/\d{1,20}\/tracks)$/.test(
          path
        )) ||
      (req.method === 'POST' && path === '/ktv/api/requests')
    )
      return remoteApi.handle(req, publicCatalogResponse(req, res), true);
    return respond(res, 404, 'NOT_FOUND');
  };
}

module.exports = { createDesktopPublicAdapter };
