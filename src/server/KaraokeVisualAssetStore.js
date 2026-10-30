import crypto from 'crypto';
import path from 'path';
import { createReadStream, promises as fs } from 'fs';

export const MAX_VISUAL_ASSET_BYTES = 4 * 1024 * 1024;
export const MAX_VISUAL_ASSET_TOTAL_BYTES = 32 * 1024 * 1024;
export const MAX_VISUAL_ASSETS = 32;

const ASSET_ID_PATTERN = /^[a-f0-9]{64}$/;

export function detectVisualAssetMime(bytes) {
  if (!Buffer.isBuffer(bytes)) return '';
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
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
    (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' ||
      bytes.subarray(0, 6).toString('ascii') === 'GIF89a')
  )
    return 'image/gif';
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'image/webp';
  return '';
}

function assetError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function readBoundedFile(filename, maxBytes) {
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of createReadStream(filename, {
      highWaterMark: 64 * 1024,
    })) {
      if (size + chunk.length > maxBytes) return null;
      size += chunk.length;
      chunks.push(chunk);
    }
  } catch (_) {
    return null;
  }
  return Buffer.concat(chunks, size);
}

export default class KaraokeVisualAssetStore {
  constructor({ directory = '' } = {}) {
    this.directory = directory ? path.resolve(directory) : '';
    this.assets = new Map();
    this.totalBytes = 0;
    this.pending = new Map();
    this.loadError = null;
    this.ready = this.load().catch(error => {
      this.loadError = error;
    });
  }

  get size() {
    return this.assets.size;
  }

  async load() {
    if (!this.directory) return;
    await fs.mkdir(this.directory, { recursive: true });
    const files = await fs.readdir(this.directory, { withFileTypes: true });
    for (const file of files) {
      if (
        !file.isFile() ||
        !ASSET_ID_PATTERN.test(file.name) ||
        this.assets.size >= MAX_VISUAL_ASSETS
      )
        continue;
      let stat;
      try {
        stat = await fs.stat(path.join(this.directory, file.name));
      } catch (_) {
        continue;
      }
      if (
        !stat.isFile() ||
        stat.size <= 0 ||
        stat.size > MAX_VISUAL_ASSET_BYTES ||
        this.totalBytes + stat.size > MAX_VISUAL_ASSET_TOTAL_BYTES
      )
        continue;
      const bytes = await readBoundedFile(
        path.join(this.directory, file.name),
        MAX_VISUAL_ASSET_BYTES
      );
      const mime = detectVisualAssetMime(bytes);
      if (
        !bytes ||
        !mime ||
        crypto.createHash('sha256').update(bytes).digest('hex') !== file.name
      )
        continue;
      this.assets.set(file.name, {
        id: file.name,
        mime,
        size: bytes.length,
        bytes: null,
        ready: true,
      });
      this.totalBytes += bytes.length;
    }
  }

  async put(bytes) {
    await this.ready;
    if (this.loadError) throw this.loadError;
    if (!Buffer.isBuffer(bytes) || bytes.length === 0)
      throw assetError('INVALID_IMAGE');
    if (bytes.length > MAX_VISUAL_ASSET_BYTES)
      throw assetError('ASSET_TOO_LARGE');
    const mime = detectVisualAssetMime(bytes);
    if (!mime) throw assetError('INVALID_IMAGE');
    const id = crypto.createHash('sha256').update(bytes).digest('hex');
    const existing = this.assets.get(id);
    if (existing?.ready) return this.describe(existing);
    if (this.pending.has(id)) return this.pending.get(id);

    const operation = this.putNew(id, mime, bytes);
    this.pending.set(id, operation);
    try {
      return await operation;
    } finally {
      if (this.pending.get(id) === operation) this.pending.delete(id);
    }
  }

  async putNew(id, mime, bytes) {
    if (
      this.assets.size >= MAX_VISUAL_ASSETS ||
      this.totalBytes + bytes.length > MAX_VISUAL_ASSET_TOTAL_BYTES
    )
      throw assetError('ASSET_STORE_FULL');

    const entry = {
      id,
      mime,
      size: bytes.length,
      bytes: this.directory ? null : bytes,
      ready: false,
    };
    this.assets.set(id, entry);
    this.totalBytes += bytes.length;
    try {
      if (this.directory) {
        const destination = path.join(this.directory, id);
        const temporary = path.join(
          this.directory,
          `.${id}.${crypto.randomBytes(8).toString('hex')}.tmp`
        );
        try {
          await fs.writeFile(temporary, bytes, { flag: 'wx' });
          await fs.rename(temporary, destination);
        } catch (error) {
          await fs.unlink(temporary).catch(() => {});
          throw error;
        }
      }
      entry.ready = true;
      return this.describe(entry);
    } catch (error) {
      this.assets.delete(id);
      this.totalBytes -= entry.size;
      throw error;
    }
  }

  describe(entry) {
    return {
      id: entry.id,
      url: `/ktv/display/visual-assets/${entry.id}`,
      mime: entry.mime,
      size: entry.size,
    };
  }

  async get(id) {
    if (!ASSET_ID_PATTERN.test(String(id || ''))) return null;
    await this.ready;
    if (this.loadError) throw this.loadError;
    const entry = this.assets.get(id);
    if (!entry?.ready) return null;
    if (entry.bytes) return { ...this.describe(entry), bytes: entry.bytes };
    const bytes = await readBoundedFile(
      path.join(this.directory, id),
      MAX_VISUAL_ASSET_BYTES
    );
    if (
      !bytes ||
      bytes.length !== entry.size ||
      detectVisualAssetMime(bytes) !== entry.mime ||
      crypto.createHash('sha256').update(bytes).digest('hex') !== id
    )
      return null;
    return { ...this.describe(entry), bytes };
  }
}
