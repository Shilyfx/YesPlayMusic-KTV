'use strict';

const ROOM_STATIC_ASSET_PATH =
  /^\/room\/(?:(?:js|css|img|fonts)\/[\w./-]+\.(?:js|css|woff2?|ttf|svg|png|jpe?g|webp|gif|avif)|artist-portraits\/\d{1,20}\.jpg)$/i;

function isPublicGuestStaticPath(method, rawPath) {
  return (
    method === 'GET' &&
    (rawPath === '/room/' || ROOM_STATIC_ASSET_PATH.test(rawPath))
  );
}

module.exports = { isPublicGuestStaticPath };
