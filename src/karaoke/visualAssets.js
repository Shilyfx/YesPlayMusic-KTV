const MAX_LOCAL_ASSET_BYTES = 4 * 1024 * 1024;
const MAX_LOCAL_ASSET_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_LOCAL_ASSETS = 32;
const MAX_TEMPERA_LAYER_IMAGES = 16;
const DB_NAME = 'lumasing.ktv.visual-assets.v1';
const DB_STORE = 'assets';
const ASSET_ID_PATTERN = /^[a-f0-9]{64}$/;
const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const SHA256_ROUNDS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

let lastReferenceKey = null;
let lastResolvedReferences = null;
const localObjectUrls = new Map();
const pendingLocalObjectUrls = new Map();
let localObjectUrlGeneration = 0;
const indexedDbStorages = new WeakMap();
let localUploadSequence = 0;

function localUploadCurrent(options) {
  try {
    return (
      !options.signal?.aborted && (!options.isCurrent || options.isCurrent())
    );
  } catch (_) {
    return false;
  }
}

function cancelledLocalUpload() {
  const error = new Error('LOCAL_ASSET_UPLOAD_ABORTED');
  error.name = 'AbortError';
  return error;
}

function assertLocalUploadCurrent(options) {
  if (!localUploadCurrent(options)) throw cancelledLocalUpload();
}

function globalValue(name) {
  if (typeof window !== 'undefined') return window[name];
  if (typeof global !== 'undefined') return global[name];
  return undefined;
}

export function isVisualAssetId(value) {
  return typeof value === 'string' && ASSET_ID_PATTERN.test(value);
}

function imageMime(bytes) {
  if (!(bytes instanceof Uint8Array)) return '';
  if (
    bytes.length >= 8 &&
    bytes[0] === 137 &&
    bytes[1] === 80 &&
    bytes[2] === 78 &&
    bytes[3] === 71 &&
    bytes[4] === 13 &&
    bytes[5] === 10 &&
    bytes[6] === 26 &&
    bytes[7] === 10
  )
    return 'image/png';
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return 'image/jpeg';
  if (
    bytes.length >= 6 &&
    (String.fromCharCode(...bytes.subarray(0, 6)) === 'GIF87a' ||
      String.fromCharCode(...bytes.subarray(0, 6)) === 'GIF89a')
  )
    return 'image/gif';
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
  )
    return 'image/webp';
  return '';
}

async function hashBytes(bytes, cryptoApi) {
  if (!cryptoApi?.subtle?.digest) return sha256Hex(bytes);
  const digest = await cryptoApi.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

function sha256Hex(bytes) {
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  const rotateRight = (value, amount) =>
    (value >>> amount) | (value << (32 - amount));

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index++)
      words[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index++) {
      const previous15 = words[index - 15];
      const previous2 = words[index - 2];
      const sigma0 =
        rotateRight(previous15, 7) ^
        rotateRight(previous15, 18) ^
        (previous15 >>> 3);
      const sigma1 =
        rotateRight(previous2, 17) ^
        rotateRight(previous2, 19) ^
        (previous2 >>> 10);
      words[index] =
        (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index++) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const first =
        (h + sum1 + choose + SHA256_ROUNDS[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const second = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + first) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (first + second) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }
  return Array.from(state, word => word.toString(16).padStart(8, '0')).join('');
}

function validIds(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  const seen = new Set();
  for (const item of value) {
    if (!isVisualAssetId(item) || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
    if (result.length >= MAX_LOCAL_ASSETS) break;
  }
  return result;
}

function sanitizeAssetName(value) {
  return value
    .split('')
    .filter(character => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('')
    .trim()
    .slice(0, 80);
}

function normalizeTemperaImages(tempera) {
  const existingImages = Array.isArray(tempera.layerImages)
    ? tempera.layerImages
    : [];
  const configuredIds = Array.isArray(tempera.layerImageAssetIds)
    ? tempera.layerImageAssetIds
    : existingImages.map(image => image?.id);
  const configuredNames = Array.isArray(tempera.layerImageNames)
    ? tempera.layerImageNames
    : [];
  return validIds(configuredIds)
    .slice(0, MAX_TEMPERA_LAYER_IMAGES)
    .map((id, index) => {
      const existing = existingImages.find(image => image?.id === id);
      const configuredIndex = configuredIds.indexOf(id);
      const candidateName = existing?.name || configuredNames[configuredIndex];
      const name =
        typeof candidateName === 'string'
          ? sanitizeAssetName(candidateName)
          : '';
      return { id, name: name || `Image ${index + 1}` };
    });
}

function referencesFromConfig(config = {}) {
  config = config || {};
  const backgroundId = config.background?.assetId;
  const monetId = config.tuningByMode?.monet?.portraitAssetId;
  const cappella = config.tuningByMode?.cappella || {};
  const tempera = config.tuningByMode?.tempera || {};
  return {
    backgroundId: isVisualAssetId(backgroundId) ? backgroundId : null,
    monetId: isVisualAssetId(monetId) ? monetId : null,
    emojiIds: validIds(cappella.emojiAssetIds),
    avatarIds: validIds(cappella.avatarAssetIds),
    temperaImages: normalizeTemperaImages(tempera),
  };
}

function makeReference(id) {
  return id
    ? Object.freeze({ id, url: `/ktv/display/visual-assets/${id}` })
    : null;
}

export function resolveVisualAssets(config) {
  const references = referencesFromConfig(config);
  const key = JSON.stringify(references);
  if (key === lastReferenceKey) return lastResolvedReferences;
  const result = Object.freeze({
    backgroundImage: makeReference(references.backgroundId),
    monetPortraitImage: makeReference(references.monetId),
    cappellaCustomEmojiImages: Object.freeze(
      references.emojiIds.map(makeReference)
    ),
    cappellaCustomAvatarImages: Object.freeze(
      references.avatarIds.map(makeReference)
    ),
    temperaLayerImageAssets: Object.freeze(
      references.temperaImages.map(({ id, name }) =>
        Object.freeze({ id, name, url: `/ktv/display/visual-assets/${id}` })
      )
    ),
  });
  lastReferenceKey = key;
  lastResolvedReferences = result;
  return result;
}

function openAssetDatabase(indexedDB) {
  if (!indexedDB || typeof indexedDB.open !== 'function')
    return Promise.reject(new Error('LOCAL_ASSET_STORAGE_UNAVAILABLE'));
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, 1);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DB_STORE))
        database.createObjectStore(DB_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error('LOCAL_ASSET_STORAGE_FAILED'));
  });
}

function createIndexedDbStorage(indexedDB) {
  let databasePromise;
  const database = () => {
    if (!databasePromise) databasePromise = openAssetDatabase(indexedDB);
    return databasePromise;
  };
  const settleUpload = async (id, owner, retain) => {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(DB_STORE, 'readwrite');
      const store = transaction.objectStore(DB_STORE);
      const request = store.get(id);
      let changed = false;
      request.onsuccess = () => {
        const record = request.result;
        const pins = record?._localUploadPins;
        // Ordinary/pre-existing records have no pending ownership marker.
        if (!Array.isArray(pins) || !pins.includes(owner)) return;
        changed = true;
        if (retain) {
          const retained = { ...record };
          delete retained._localUploadPins;
          store.put(retained);
        } else {
          const remaining = pins.filter(pin => pin !== owner);
          if (remaining.length)
            store.put({ ...record, _localUploadPins: remaining });
          else store.delete(id);
        }
      };
      transaction.oncomplete = () => resolve(changed);
      transaction.onerror = transaction.onabort = () =>
        reject(transaction.error || new Error('LOCAL_ASSET_STORAGE_FAILED'));
    });
  };
  return {
    settleUpload,
    async addBounded(record, upload = {}) {
      const db = await database();
      assertLocalUploadCurrent(upload);
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(DB_STORE, 'readwrite');
        const store = transaction.objectStore(DB_STORE);
        const cursorRequest = store.openCursor();
        let result = null;
        let failure = null;
        let count = 0;
        let totalBytes = 0;
        const removeAbortListener = () =>
          upload.signal?.removeEventListener('abort', cancel);
        const cancel = () => {
          failure = cancelledLocalUpload();
          try {
            transaction.abort();
          } catch (_) {
            // A finishing transaction is checked again in oncomplete and discarded by pin.
          }
        };
        cursorRequest.onsuccess = () => {
          if (!localUploadCurrent(upload)) {
            cancel();
            return;
          }
          const cursor = cursorRequest.result;
          if (!cursor) {
            if (
              count >= MAX_LOCAL_ASSETS ||
              totalBytes + record.size > MAX_LOCAL_ASSET_TOTAL_BYTES
            ) {
              failure = new Error('LOCAL_ASSET_STORE_FULL');
              transaction.abort();
              return;
            }
            result = upload.owner
              ? { ...record, _localUploadPins: [upload.owner] }
              : record;
            store.put(result);
            return;
          }
          if (cursor.primaryKey === record.id) {
            result = cursor.value;
            if (Array.isArray(result._localUploadPins)) {
              if (upload.owner) {
                if (result._localUploadPins.length >= 64) {
                  failure = new Error('LOCAL_ASSET_UPLOADS_FULL');
                  transaction.abort();
                  return;
                }
                result = {
                  ...result,
                  _localUploadPins: [...result._localUploadPins, upload.owner],
                };
              } else {
                result = { ...result };
                delete result._localUploadPins;
              }
              store.put(result);
            }
            return;
          }
          const storedSize = Number(cursor.value?.size);
          if (
            !Number.isInteger(storedSize) ||
            storedSize <= 0 ||
            storedSize > MAX_LOCAL_ASSET_BYTES ||
            cursor.value?.blob?.size !== storedSize
          ) {
            failure = new Error('LOCAL_ASSET_STORE_CORRUPT');
            transaction.abort();
            return;
          }
          count++;
          totalBytes += storedSize;
          if (
            count > MAX_LOCAL_ASSETS ||
            totalBytes > MAX_LOCAL_ASSET_TOTAL_BYTES
          ) {
            failure = new Error('LOCAL_ASSET_STORE_FULL');
            transaction.abort();
            return;
          }
          cursor.continue();
        };
        cursorRequest.onerror = () => {
          failure =
            failure ||
            cursorRequest.error ||
            new Error('LOCAL_ASSET_STORAGE_FAILED');
          try {
            transaction.abort();
          } catch (_) {
            /* Already aborted. */
          }
        };
        transaction.oncomplete = () => {
          removeAbortListener();
          if (failure || !localUploadCurrent(upload)) {
            settleUpload(record.id, upload.owner, false).then(
              () => reject(cancelledLocalUpload()),
              reject
            );
          } else resolve(result);
        };
        transaction.onerror = transaction.onabort = () => {
          removeAbortListener();
          reject(
            failure ||
              transaction.error ||
              new Error('LOCAL_ASSET_STORAGE_FAILED')
          );
        };
        upload.signal?.addEventListener('abort', cancel, { once: true });
        if (!localUploadCurrent(upload)) cancel();
      });
    },
    async get(id) {
      const db = await database();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(DB_STORE, 'readwrite');
        const store = transaction.objectStore(DB_STORE);
        const request = store.get(id);
        let result = null;
        request.onsuccess = () => {
          result = request.result || null;
          // A resolver is an independent consumer: its record must survive upload cancellation.
          if (Array.isArray(result?._localUploadPins)) {
            result = { ...result };
            delete result._localUploadPins;
            store.put(result);
          }
        };
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = transaction.onabort = () =>
          reject(transaction.error || new Error('LOCAL_ASSET_STORAGE_FAILED'));
      });
    },
  };
}

function getStorage(options) {
  if (options.storage) return options.storage;
  const indexedDB = options.indexedDB || globalValue('indexedDB');
  if (!indexedDB || typeof indexedDB !== 'object') return null;
  if (!indexedDbStorages.has(indexedDB))
    indexedDbStorages.set(indexedDB, createIndexedDbStorage(indexedDB));
  return indexedDbStorages.get(indexedDB);
}

export async function uploadLocalVisualAsset(file, role, options = {}) {
  assertLocalUploadCurrent(options);
  if (!file || !Number.isInteger(file.size) || file.size <= 0)
    throw new Error('INVALID_IMAGE');
  if (file.size > MAX_LOCAL_ASSET_BYTES)
    throw new Error('LOCAL_ASSET_TOO_LARGE');
  if (
    role !== undefined &&
    role !== null &&
    (typeof role !== 'string' || !/^[a-z][a-z0-9_-]{0,47}$/i.test(role))
  )
    throw new Error('INVALID_ASSET_ROLE');
  if (typeof file.arrayBuffer !== 'function') throw new Error('INVALID_IMAGE');

  const bytes = new Uint8Array(await file.arrayBuffer());
  assertLocalUploadCurrent(options);
  if (
    bytes.length === 0 ||
    bytes.length !== file.size ||
    bytes.length > MAX_LOCAL_ASSET_BYTES
  )
    throw new Error('LOCAL_ASSET_TOO_LARGE');
  const mime = imageMime(bytes);
  if (!mime || (file.type && String(file.type).toLowerCase() !== mime))
    throw new Error('INVALID_IMAGE');
  const cryptoApi = options.crypto || globalValue('crypto');
  const id = await hashBytes(bytes, cryptoApi);
  assertLocalUploadCurrent(options);
  const BlobType = options.Blob || globalValue('Blob');
  if (!BlobType) throw new Error('LOCAL_ASSET_STORAGE_UNAVAILABLE');
  const record = {
    id,
    mime,
    size: bytes.length,
    blob: new BlobType([bytes], { type: mime }),
  };
  const storage = getStorage(options);
  if (!storage?.addBounded) throw new Error('LOCAL_ASSET_STORAGE_UNAVAILABLE');
  const managed = Boolean(
    options.deferRetain || options.signal || options.isCurrent
  );
  if (managed && !storage.settleUpload)
    throw new Error('LOCAL_ASSET_STORAGE_UNAVAILABLE');
  const owner = managed
    ? `${Date.now().toString(36)}-${++localUploadSequence}-${Math.random()
        .toString(36)
        .slice(2)}`
    : null;
  const saved = await storage.addBounded(record, { ...options, owner });
  const result = { id: saved.id, mime: saved.mime, size: saved.size };
  if (!managed) return result;
  let state = 'pending';
  let settlement;
  const removeAbortListener = () =>
    options.signal?.removeEventListener('abort', onAbort);
  const discard = () => {
    if (state !== 'pending') return settlement || Promise.resolve(false);
    state = 'discarded';
    removeAbortListener();
    settlement = storage.settleUpload(saved.id, owner, false);
    return settlement;
  };
  const retainOwnedRecord = () => {
    state = 'retained';
    removeAbortListener();
    settlement = Promise.resolve()
      .then(() => storage.settleUpload(saved.id, owner, true))
      .catch(cause => {
        // The published reference still owns this pin if acknowledgement fails.
        const error = new Error('图片素材保留确认失败，请重试');
        error.code = 'LOCAL_ASSET_RETAIN_FAILED';
        error.cause = cause;
        throw error;
      });
    return settlement;
  };
  const retain = () => {
    if (state === 'retained') return settlement;
    if (state !== 'pending') return Promise.reject(cancelledLocalUpload());
    if (!localUploadCurrent(options))
      return discard().then(() => {
        throw cancelledLocalUpload();
      });
    return retainOwnedRecord();
  };
  const commitReference = async commit => {
    if (state !== 'pending') throw cancelledLocalUpload();
    if (!localUploadCurrent(options)) {
      await discard();
      throw cancelledLocalUpload();
    }
    // Keep cancellation from removing bytes while a synchronous watcher publishes their ID.
    state = 'committing';
    removeAbortListener();
    try {
      if (commit() === false) throw new Error('图片配置保存失败');
    } catch (error) {
      state = 'pending';
      await discard();
      throw error;
    }
    return retainOwnedRecord();
  };
  const onAbort = () => {
    discard().catch(() => {});
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (!localUploadCurrent(options)) {
    await discard();
    throw cancelledLocalUpload();
  }
  if (!options.deferRetain) {
    await retain();
    return result;
  }
  return { ...result, retain, discard, commitReference };
}

export async function resolveLocalVisualAsset(id, options = {}) {
  if (!isVisualAssetId(id)) return null;
  const cached = localObjectUrls.get(id);
  if (cached)
    return createLocalAssetLease(id, cached, localObjectUrlGeneration);
  const pending = pendingLocalObjectUrls.get(id);
  if (pending) {
    const entry = await pending.promise;
    if (!isCurrentLocalObjectUrl(id, entry, pending.generation)) return null;
    return createLocalAssetLease(id, entry, pending.generation);
  }

  const storage = getStorage(options);
  if (!storage?.get) throw new Error('LOCAL_ASSET_STORAGE_UNAVAILABLE');
  const generation = localObjectUrlGeneration;
  const current = () =>
    generation === localObjectUrlGeneration &&
    pendingLocalObjectUrls.get(id) === pendingResolution;
  const pendingResolution = { generation, promise: null };
  pendingResolution.promise = Promise.resolve().then(async () => {
    try {
      const record = await storage.get(id);
      if (!current()) return null;
      if (
        !record ||
        record.id !== id ||
        !IMAGE_MIMES.includes(record.mime) ||
        !Number.isInteger(record.size) ||
        record.size <= 0 ||
        record.size > MAX_LOCAL_ASSET_BYTES ||
        !record.blob ||
        record.blob.size !== record.size
      )
        return null;
      const bytes = new Uint8Array(await record.blob.arrayBuffer());
      if (!current()) return null;
      const cryptoApi = options.crypto || globalValue('crypto');
      if (
        bytes.length !== record.size ||
        imageMime(bytes) !== record.mime ||
        (await hashBytes(bytes, cryptoApi)) !== id ||
        !current()
      )
        return null;
      const urlApi = options.urlApi || globalValue('URL');
      if (
        !urlApi ||
        typeof urlApi.createObjectURL !== 'function' ||
        typeof urlApi.revokeObjectURL !== 'function'
      )
        throw new Error('LOCAL_ASSET_URL_UNAVAILABLE');
      const entry = {
        url: urlApi.createObjectURL(record.blob),
        mime: record.mime,
        leases: 0,
        revoked: false,
        urlApi,
      };
      localObjectUrls.set(id, entry);
      return entry;
    } finally {
      if (pendingLocalObjectUrls.get(id) === pendingResolution)
        pendingLocalObjectUrls.delete(id);
    }
  });
  pendingLocalObjectUrls.set(id, pendingResolution);
  const entry = await pendingResolution.promise;
  if (!isCurrentLocalObjectUrl(id, entry, generation)) return null;
  return createLocalAssetLease(id, entry, generation);
}

function isCurrentLocalObjectUrl(id, entry, generation) {
  return Boolean(
    entry &&
      !entry.revoked &&
      generation === localObjectUrlGeneration &&
      localObjectUrls.get(id) === entry
  );
}

function createLocalAssetLease(id, entry, generation) {
  if (!isCurrentLocalObjectUrl(id, entry, generation)) return null;
  entry.leases++;
  let released = false;
  return {
    id,
    url: entry.url,
    mime: entry.mime,
    release() {
      if (released) return;
      released = true;
      releaseLocalVisualAssetEntry(id, entry);
    },
  };
}

export function releaseLocalVisualAsset(id) {
  const entry = localObjectUrls.get(id);
  if (!entry) return;
  releaseLocalVisualAssetEntry(id, entry);
}

function releaseLocalVisualAssetEntry(id, entry) {
  if (entry.revoked) return;
  entry.leases = Math.max(0, entry.leases - 1);
  if (entry.leases > 0) return;
  entry.revoked = true;
  entry.urlApi.revokeObjectURL(entry.url);
  if (localObjectUrls.get(id) === entry) localObjectUrls.delete(id);
}

export function clearLocalVisualAssetUrls() {
  localObjectUrlGeneration++;
  pendingLocalObjectUrls.clear();
  for (const [id, entry] of localObjectUrls) {
    if (entry.revoked) continue;
    entry.revoked = true;
    entry.urlApi.revokeObjectURL(entry.url);
    if (localObjectUrls.get(id) === entry) localObjectUrls.delete(id);
  }
}

export async function resolveLocalVisualAssets(config, options = {}) {
  const references = referencesFromConfig(config);
  const ids = [
    references.backgroundId,
    references.monetId,
    ...references.emojiIds,
    ...references.avatarIds,
    ...references.temperaImages.map(image => image.id),
  ].filter(Boolean);
  const leases = new Map();
  try {
    for (const id of ids) {
      if (!leases.has(id))
        leases.set(id, await resolveLocalVisualAsset(id, options));
    }
  } catch (error) {
    leases.forEach(lease => lease?.release());
    throw error;
  }
  const image = id => (id ? leases.get(id) : null);
  let released = false;
  return {
    backgroundImage: image(references.backgroundId),
    monetPortraitImage: image(references.monetId),
    cappellaCustomEmojiImages: references.emojiIds.map(image).filter(Boolean),
    cappellaCustomAvatarImages: references.avatarIds.map(image).filter(Boolean),
    temperaLayerImageAssets: references.temperaImages
      .map(({ id, name }) => {
        const lease = image(id);
        return lease ? { id, name, url: lease.url } : null;
      })
      .filter(Boolean),
    release() {
      if (released) return;
      released = true;
      leases.forEach(lease => lease?.release());
    },
  };
}

export default {
  isVisualAssetId,
  resolveVisualAssets,
  uploadLocalVisualAsset,
  resolveLocalVisualAsset,
  resolveLocalVisualAssets,
  releaseLocalVisualAsset,
  clearLocalVisualAssetUrls,
};
