import crypto from 'crypto';
import { isPublicGuestStaticPath } from './PublicGuestStaticPaths.cjs';
import {
  projectPublicLocalPlaylistResponse,
  projectPublicUserPlaylistResponse,
  projectPublicPreviewResponse,
} from '../multiroom/hostConnector.cjs';

function publicCatalogResponse(request, response) {
  const path = request.url.split('?')[0];
  const project =
    path === '/ktv/api/local-playlists'
      ? projectPublicLocalPlaylistResponse
      : path === '/ktv/api/playlists'
      ? projectPublicUserPlaylistResponse
      : /^\/ktv\/api\/track\/\d{1,20}\/preview$/.test(path)
      ? projectPublicPreviewResponse
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
          status = project === projectPublicPreviewResponse ? 409 : 502;
          output = Buffer.from(
            project === projectPublicPreviewResponse
              ? '{"error":"TRACK_NOT_PLAYABLE"}'
              : '{"error":"INVALID_PUBLIC_CATALOG_RESPONSE"}'
          );
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
    if (isPublicGuestStaticPath(method, rawPath)) {
      return host.roomServer.handleRequest(request, response);
    }
    if (
      (method === 'POST' || method === 'DELETE') &&
      request.headers.origin !== host.publicGuestOrigin
    )
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
        /^\/ktv\/api\/track\/\d{1,20}\/preview$/.test(rawPath)) ||
      (method === 'GET' &&
        /^\/ktv\/api\/(?:state|search|artists\/search|artists\/\d{1,20}\/tracks|recommendations|toplists|playlists|local-playlists|(?:recommendations|toplists|playlists)\/\d{1,20}\/tracks)$/.test(
          rawPath
        )) ||
      (method === 'POST' &&
        (rawPath === '/ktv/api/requests' ||
          rawPath === '/ktv/api/next' ||
          /^\/ktv\/api\/requests\/[\w-]{1,160}\/front$/.test(rawPath))) ||
      (method === 'DELETE' &&
        /^\/ktv\/api\/requests\/[\w-]{1,160}$/.test(rawPath))
    )
      return host.remoteApi.handle(
        request,
        publicCatalogResponse(request, response),
        true
      );
    return host.json(response, 404, { error: 'NOT_FOUND' });
  };
}
