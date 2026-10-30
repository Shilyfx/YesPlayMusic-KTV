export const MAX_TEMPERA_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_TEMPERA_IMAGE_TOTAL_BYTES = 32 * 1024 * 1024;

const MAX_TEMPERA_IMAGE_COUNT = 16;
const MAX_CACHE_ENTRIES = 32;
const ASSET_ID_PATTERN = /^[a-f0-9]{64}$/;
const IMAGE_MIME_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

function abortError() {
  const error = new Error('Tempera image loading was aborted');
  error.name = 'AbortError';
  return error;
}

function getBaseUrl(explicitBaseUrl) {
  if (explicitBaseUrl) return explicitBaseUrl;
  if (typeof window !== 'undefined' && window.location?.href)
    return window.location.href;
  if (typeof location !== 'undefined' && location.href) return location.href;
  throw new Error('TEMPERA_ASSET_BASE_URL_UNAVAILABLE');
}

function safeAssetUrl(asset, baseUrl) {
  if (
    !asset ||
    typeof asset !== 'object' ||
    !ASSET_ID_PATTERN.test(asset.id) ||
    typeof asset.url !== 'string' ||
    !asset.url
  ) {
    throw new Error('INVALID_TEMPERA_ASSET');
  }

  let base;
  let url;
  try {
    base = new URL(baseUrl);
    url = new URL(asset.url, base);
  } catch (_) {
    throw new Error('UNSAFE_TEMPERA_ASSET_URL');
  }

  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.origin !== base.origin
  ) {
    throw new Error('UNSAFE_TEMPERA_ASSET_URL');
  }

  if (url.protocol === 'blob:') return url.href;
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.pathname !== `/ktv/display/visual-assets/${asset.id}`
  ) {
    throw new Error('UNSAFE_TEMPERA_ASSET_URL');
  }
  return url.href;
}

function header(response, name) {
  return response.headers?.get?.(name) || '';
}

function normalizedMime(value) {
  return String(value || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
}

function tooLargeError(code) {
  return new Error(code);
}

async function readResponseBlob(response, signal, maxBytes) {
  const contentLength = Number(header(response, 'content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes)
    throw tooLargeError('TEMPERA_IMAGE_TOO_LARGE');

  const mime = normalizedMime(header(response, 'content-type'));
  if (!IMAGE_MIME_TYPES.has(mime))
    throw new Error('TEMPERA_IMAGE_UNSUPPORTED_TYPE');

  if (signal?.aborted) throw abortError();
  const reader = response.body?.getReader?.();
  if (!reader) {
    if (typeof response.blob !== 'function')
      throw new Error('TEMPERA_IMAGE_RESPONSE_INVALID');
    const blob = await response.blob();
    if (signal?.aborted) throw abortError();
    if (!blob || !Number.isFinite(blob.size) || blob.size <= 0)
      throw new Error('TEMPERA_IMAGE_RESPONSE_INVALID');
    if (blob.size > maxBytes) throw tooLargeError('TEMPERA_IMAGE_TOO_LARGE');
    const blobMime = normalizedMime(blob.type || mime);
    if (!IMAGE_MIME_TYPES.has(blobMime))
      throw new Error('TEMPERA_IMAGE_UNSUPPORTED_TYPE');
    return blob.type === blobMime ? blob : new Blob([blob], { type: blobMime });
  }

  const chunks = [];
  let size = 0;
  let done = false;
  const cancelReader = () => reader.cancel().catch(() => undefined);
  signal?.addEventListener('abort', cancelReader, { once: true });
  try {
    while (!done) {
      if (signal?.aborted) throw abortError();
      const result = await reader.read();
      if (result.done) {
        done = true;
        break;
      }
      const chunk = result.value;
      if (!chunk) continue;
      size += chunk.byteLength;
      if (size > maxBytes) {
        await cancelReader();
        throw tooLargeError('TEMPERA_IMAGE_TOO_LARGE');
      }
      chunks.push(chunk);
    }
  } finally {
    signal?.removeEventListener('abort', cancelReader);
    reader.releaseLock?.();
  }

  if (signal?.aborted) throw abortError();
  if (size <= 0) throw new Error('TEMPERA_IMAGE_RESPONSE_INVALID');
  const blob = new Blob(chunks, { type: mime });
  if (blob.size !== size || blob.size > maxBytes)
    throw tooLargeError('TEMPERA_IMAGE_TOO_LARGE');
  return blob;
}

export function createTemperaImageBlobPool(options = {}) {
  const maxFileBytes = options.maxFileBytes || MAX_TEMPERA_IMAGE_BYTES;
  const maxTotalBytes = options.maxTotalBytes || MAX_TEMPERA_IMAGE_TOTAL_BYTES;
  const maxEntries = options.maxEntries || MAX_CACHE_ENTRIES;
  const fetchAsset =
    options.fetch || (typeof fetch === 'function' ? fetch.bind(null) : null);
  const cache = new Map();
  const inflight = new Map();
  let cachedBytes = 0;

  function touch(id) {
    const entry = cache.get(id);
    if (!entry) return null;
    cache.delete(id);
    cache.set(id, entry);
    return entry.blob;
  }

  function remember(id, blob) {
    if (blob.size > maxTotalBytes) return;
    const previous = cache.get(id);
    if (previous) {
      cachedBytes -= previous.size;
      cache.delete(id);
    }
    while (
      cache.size &&
      (cache.size >= maxEntries || cachedBytes + blob.size > maxTotalBytes)
    ) {
      const oldestId = cache.keys().next().value;
      const oldest = cache.get(oldestId);
      cache.delete(oldestId);
      cachedBytes -= oldest.size;
    }
    cache.set(id, { blob, size: blob.size });
    cachedBytes += blob.size;
  }

  function startFlight(id, url) {
    if (!fetchAsset) throw new Error('TEMPERA_IMAGE_FETCH_UNAVAILABLE');
    const controller = new AbortController();
    const flight = {
      controller,
      waiters: 0,
      settled: false,
      promise: null,
    };
    flight.promise = Promise.resolve()
      .then(() => fetchAsset(url, { signal: controller.signal }))
      .then(async response => {
        if (!response?.ok) throw new Error('TEMPERA_IMAGE_FETCH_FAILED');
        const blob = await readResponseBlob(
          response,
          controller.signal,
          maxFileBytes
        );
        if (!controller.signal.aborted) remember(id, blob);
        return blob;
      })
      .finally(() => {
        flight.settled = true;
        if (inflight.get(id) === flight) inflight.delete(id);
      });
    inflight.set(id, flight);
    return flight;
  }

  function joinFlight(flight, signal) {
    if (signal?.aborted) return Promise.reject(abortError());
    flight.waiters++;
    return new Promise((resolve, reject) => {
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        signal?.removeEventListener('abort', onAbort);
        flight.waiters--;
        if (!flight.settled && flight.waiters === 0) flight.controller.abort();
      };
      const onAbort = () => {
        release();
        reject(abortError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      flight.promise.then(
        blob => {
          if (released) return;
          release();
          resolve(blob);
        },
        error => {
          if (released) return;
          release();
          reject(error);
        }
      );
    });
  }

  async function getBlob(asset, url, signal) {
    const cached = touch(asset.id);
    if (cached) return cached;
    let flight = inflight.get(asset.id);
    if (!flight || flight.controller.signal.aborted)
      flight = startFlight(asset.id, url);
    return joinFlight(flight, signal);
  }

  return {
    async load(assets, signal) {
      if (signal?.aborted) throw abortError();
      if (!Array.isArray(assets)) return new Map();
      const baseUrl = getBaseUrl(options.baseUrl);
      const records = new Map();
      for (const asset of assets) {
        const url = safeAssetUrl(asset, baseUrl);
        if (!records.has(asset.id)) records.set(asset.id, { asset, url });
      }
      if (records.size > MAX_TEMPERA_IMAGE_COUNT)
        throw new Error('TOO_MANY_TEMPERA_IMAGES');

      const imageBlobs = new Map();
      let totalBytes = 0;
      for (const [id, record] of records) {
        if (signal?.aborted) throw abortError();
        const blob = await getBlob(record.asset, record.url, signal);
        if (signal?.aborted) throw abortError();
        if (blob.size > maxFileBytes)
          throw tooLargeError('TEMPERA_IMAGE_TOO_LARGE');
        totalBytes += blob.size;
        if (totalBytes > maxTotalBytes)
          throw tooLargeError('TEMPERA_IMAGE_TOTAL_TOO_LARGE');
        imageBlobs.set(id, blob);
      }
      return imageBlobs;
    },
    clear() {
      cache.clear();
      cachedBytes = 0;
    },
    getCacheSize() {
      return { count: cache.size, bytes: cachedBytes };
    },
  };
}
