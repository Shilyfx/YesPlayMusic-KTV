import crypto from 'crypto';
import path from 'path';
import { promises as fs } from 'fs';

const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.m4a', '.wav', '.ogg']);
const COVER_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const INDEX_VERSION = 1;

const hash = value =>
  crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 16);

const normalizePath = value => {
  if (typeof value !== 'string' || !value.trim()) return null;
  return path.resolve(value.trim());
};

const pathKey = value =>
  process.platform === 'win32' ? String(value).toLowerCase() : String(value);

const isWithin = (directory, filePath) => {
  const relative = path.relative(pathKey(directory), pathKey(filePath));
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
};

function parseLrc(text) {
  if (typeof text !== 'string') return [];
  const lines = [];
  text.split(/\r?\n/).forEach(rawLine => {
    const stamps = [
      ...rawLine.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g),
    ];
    const content = rawLine.replace(/\[[^\]]+\]/g, '').trim();
    if (!content || !stamps.length) return;
    stamps.forEach(match => {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fraction = String(match[3] || '0');
      const milliseconds = Number(fraction.padEnd(3, '0').slice(0, 3));
      const time = minutes * 60 + seconds + milliseconds / 1000;
      if (Number.isFinite(time)) lines.push({ time, content });
    });
  });
  return lines.sort((left, right) => left.time - right.time);
}

function parseFileName(filePath) {
  const baseName = path.basename(filePath, path.extname(filePath)).trim();
  const separator = baseName.match(/^(.+?)\s[-–—]\s(.+)$/);
  if (separator) {
    return { artist: separator[1].trim(), name: separator[2].trim() };
  }
  return { artist: path.basename(path.dirname(filePath)), name: baseName };
}

function findSibling(filePath, extensions, entriesByDirectory) {
  const directory = normalizePath(path.dirname(filePath));
  const entries = entriesByDirectory.get(pathKey(directory));
  if (!entries) return null;
  const stem = path.basename(filePath, path.extname(filePath));
  for (const extension of extensions) {
    const name = `${stem}${extension}`;
    const entry = entries.get(
      process.platform === 'win32' ? name.toLowerCase() : name
    );
    if (entry) return path.join(directory, entry);
  }
  return null;
}

async function safeStat(filePath) {
  if (!filePath) return null;
  try {
    return await fs.stat(filePath);
  } catch (_) {
    return null;
  }
}

export default class KaraokeLocalLibrary {
  constructor(directories = [], { indexPath = null, workerCount = 8 } = {}) {
    this.directories = [];
    this.tracks = new Map();
    this.playlists = [];
    this.index = new Map();
    this.indexPath = indexPath;
    this.workerCount = Math.max(1, Number(workerCount) || 8);
    this.scanPromise = null;
    this.scanGeneration = 0;
    this.indexLoaded = false;
    this.indexReady = this.loadIndex();
    this.setDirectories(directories);
  }

  async loadIndex() {
    if (!this.indexPath) {
      this.indexLoaded = true;
      return;
    }
    try {
      const source = JSON.parse(await fs.readFile(this.indexPath, 'utf8'));
      if (!source || source.version !== INDEX_VERSION || !Array.isArray(source.entries))
        return;
      source.entries.forEach(entry => {
        if (entry && entry.localId && entry.track && entry.track.audioPath)
          this.index.set(String(entry.localId), entry);
      });
      this.rebuildFromIndex();
    } catch (_) {
      // A missing or corrupt index is recovered by the first full scan.
    } finally {
      this.indexLoaded = true;
    }
  }

  setDirectories(directories = []) {
    const next = [];
    const seen = new Set();
    directories
      .map(normalizePath)
      .filter(Boolean)
      .forEach(directory => {
        const key = pathKey(directory);
        if (seen.has(key)) return;
        seen.add(key);
        next.push(directory);
      });
    if (next.some((directory, index) => directory !== this.directories[index]))
      this.scanGeneration += 1;
    this.directories = next;
    this.rebuildFromIndex();
    return this.directories;
  }

  addDirectories(directories = []) {
    return this.setDirectories([...this.directories, ...directories]);
  }

  removeDirectory(directory) {
    const normalized = normalizePath(directory);
    return this.setDirectories(
      this.directories.filter(item => item !== normalized)
    );
  }

  listDirectories() {
    return [...this.directories];
  }

  async ensureIndexed() {
    await this.indexReady;
    if (!this.index.size && this.directories.length) await this.scan();
    return this.toPublicPlaylists();
  }

  scan() {
    if (this.scanPromise) return this.scanPromise;
    this.scanPromise = this.indexReady
      .then(() => this.runScan())
      .finally(() => {
        this.scanPromise = null;
      });
    return this.scanPromise;
  }

  async runScan() {
    let result;
    let generation;
    do {
      generation = this.scanGeneration;
      result = await this.scanGenerationSnapshot(generation);
    } while (generation !== this.scanGeneration);
    return result;
  }

  async scanGenerationSnapshot(generation) {
    const nextIndex = new Map();
    const entriesByDirectory = new Map();
    for (const directory of this.directories) {
      const files = await this.walk(directory, entriesByDirectory);
      const records = await this.mapWithConcurrency(
        files,
        this.workerCount,
        audioPath =>
          this.buildRecord(
            audioPath,
            directory,
            entriesByDirectory,
            this.index.get(`local-${hash(pathKey(audioPath))}`)
          )
      );
      records.filter(Boolean).forEach(record => {
        nextIndex.set(record.localId, record);
      });
    }
    if (generation !== this.scanGeneration) return null;
    this.index = nextIndex;
    this.rebuildFromIndex();
    await this.saveIndex();
    return this.toPublicPlaylists();
  }

  async buildRecord(audioPath, directory, entriesByDirectory, previous) {
    const audioStat = await safeStat(audioPath);
    if (!audioStat) return null;
    const canonicalAudioPath = await this.canonicalPath(audioPath);
    const localId = `local-${hash(canonicalAudioPath)}`;
    const lyricsPath = findSibling(
      audioPath,
      ['.lrc', '.LRC'],
      entriesByDirectory
    );
    const coverPath = findSibling(
      audioPath,
      COVER_EXTENSIONS,
      entriesByDirectory
    );
    const [lyricsStat, coverStat] = await Promise.all([
      safeStat(lyricsPath),
      safeStat(coverPath),
    ]);
    const unchanged =
      previous &&
      previous.localId === localId &&
      previous.audioPath === audioPath &&
      previous.audioMtimeMs === audioStat.mtimeMs &&
      previous.audioSize === audioStat.size &&
      previous.lyricsPath === lyricsPath &&
      previous.lyricsMtimeMs === ((lyricsStat && lyricsStat.mtimeMs) || 0) &&
      previous.coverPath === coverPath &&
      previous.coverMtimeMs === ((coverStat && coverStat.mtimeMs) || 0);
    if (unchanged) return previous;

    const metadata = parseFileName(audioPath);
    let lyrics = [];
    if (lyricsPath) {
      try {
        lyrics = parseLrc(await fs.readFile(lyricsPath, 'utf8'));
      } catch (_) {
        lyrics = [];
      }
    }
    const track = {
      id: localId,
      trackId: localId,
      localId,
      source: 'local',
      name: metadata.name || path.basename(audioPath),
      artists: metadata.artist ? [{ name: metadata.artist }] : [],
      ar: metadata.artist ? [{ name: metadata.artist }] : [],
      album: { name: path.basename(path.dirname(audioPath)), picUrl: '' },
      al: { name: path.basename(path.dirname(audioPath)), picUrl: '' },
      duration: 0,
      dt: 0,
      playability: 'playable',
      lyrics,
      audioPath,
      lyricsPath,
      coverPath,
    };
    return {
      localId,
      directory,
      audioPath,
      audioMtimeMs: audioStat.mtimeMs,
      audioSize: audioStat.size,
      lyricsPath,
      lyricsMtimeMs: (lyricsStat && lyricsStat.mtimeMs) || 0,
      coverPath,
      coverMtimeMs: (coverStat && coverStat.mtimeMs) || 0,
      track,
    };
  }

  async canonicalPath(filePath) {
    try {
      const realPath = await fs.realpath(filePath);
      return pathKey(realPath);
    } catch (_) {
      return pathKey(path.resolve(filePath));
    }
  }

  async mapWithConcurrency(items, concurrency, worker) {
    const results = new Array(items.length);
    let nextIndex = 0;
    await Promise.all(
      Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (nextIndex < items.length) {
          const index = nextIndex++;
          results[index] = await worker(items[index], index);
        }
      })
    );
    return results;
  }

  async saveIndex() {
    if (!this.indexPath) return;
    const source = JSON.stringify({
      version: INDEX_VERSION,
      entries: [...this.index.values()],
    });
    const temporaryPath = `${this.indexPath}.${process.pid}.tmp`;
    try {
      await fs.mkdir(path.dirname(this.indexPath), { recursive: true });
      await fs.writeFile(temporaryPath, source, 'utf8');
      await fs.rename(temporaryPath, this.indexPath);
    } catch (_) {
      try {
        await fs.unlink(temporaryPath);
      } catch (_) {
        // Ignore cleanup errors; the in-memory index remains usable.
      }
    }
  }

  rebuildFromIndex() {
    const activeEntries = [...this.index.values()].filter(entry =>
      this.directories.some(directory =>
        isWithin(
          directory,
          entry.audioPath || (entry.track && entry.track.audioPath) || ''
        )
      )
    );
    this.tracks = new Map(
      activeEntries
        .map(entry => [entry.localId, entry.track])
        .filter(([, track]) => track)
    );
    const byDirectory = new Map();
    activeEntries.forEach(entry => {
      const root = this.directories.find(directory =>
        isWithin(
          directory,
          entry.audioPath || (entry.track && entry.track.audioPath) || ''
        )
      );
      if (!root || !entry.track) return;
      if (!byDirectory.has(root)) byDirectory.set(root, []);
      byDirectory.get(root).push(entry.track);
    });
    this.playlists = [...byDirectory.entries()]
      .map(([directory, tracks]) => ({
        id: `local-playlist-${hash(pathKey(directory))}`,
        name: path.basename(directory) || directory,
        source: 'local',
        directory,
        trackCount: tracks.length,
        tracks: tracks.sort((left, right) =>
          left.audioPath.localeCompare(right.audioPath)
        ),
      }))
      .filter(playlist => playlist.tracks.length);
  }

  async walk(directory, entriesByDirectory = new Map()) {
    const results = [];
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (_) {
      return results;
    }
    const directoryKey = pathKey(normalizePath(directory));
    const siblingEntries = new Map();
    entries.forEach(entry => {
      siblingEntries.set(
        process.platform === 'win32' ? entry.name.toLowerCase() : entry.name,
        entry.name
      );
    });
    entriesByDirectory.set(directoryKey, siblingEntries);
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await this.walk(entryPath, entriesByDirectory)));
      } else if (
        entry.isFile() &&
        AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      ) {
        results.push(entryPath);
      }
    }
    return results.sort((left, right) => left.localeCompare(right));
  }

  getTrack(localId) {
    return this.tracks.get(String(localId)) || null;
  }

  async resolve(localId) {
    const track = this.getTrack(localId);
    if (!track) return null;
    try {
      await fs.access(track.audioPath);
    } catch (_) {
      return null;
    }
    return {
      localId: track.localId,
      audioPath: track.audioPath,
      lyrics: track.lyrics,
      coverPath: track.coverPath,
      name: track.name,
      artists: track.artists,
    };
  }

  toPublicPlaylists() {
    return this.playlists.map(playlist => ({
      id: playlist.id,
      name: playlist.name,
      source: 'local',
      trackCount: playlist.trackCount,
      tracks: playlist.tracks.map(track => ({
        id: track.id,
        trackId: track.trackId,
        localId: track.localId,
        source: 'local',
        name: track.name,
        artists: track.artists,
        ar: track.ar,
        album: track.album,
        al: track.al,
        duration: track.duration,
        dt: track.dt,
        playability: 'playable',
        lyrics: track.lyrics,
      })),
    }));
  }
}

export { parseLrc, parseFileName, normalizePath };
