import crypto from 'crypto';
import path from 'path';
import { promises as fs } from 'fs';

const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.m4a', '.wav', '.ogg']);
const COVER_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

const hash = value =>
  crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 16);

const normalizePath = value => {
  if (typeof value !== 'string' || !value.trim()) return null;
  return path.resolve(value.trim());
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

async function findSibling(filePath, extensions) {
  const directory = path.dirname(filePath);
  const stem = path.basename(filePath, path.extname(filePath));
  for (const extension of extensions) {
    const candidate = path.join(directory, `${stem}${extension}`);
    try {
      await fs.access(candidate);
      return candidate;
    } catch (_) {
      // Try the next supported extension.
    }
  }
  return null;
}

export default class KaraokeLocalLibrary {
  constructor(directories = []) {
    this.directories = [];
    this.tracks = new Map();
    this.playlists = [];
    this.setDirectories(directories);
  }

  setDirectories(directories = []) {
    this.directories = [
      ...new Set(directories.map(normalizePath).filter(Boolean)),
    ];
    return this.directories;
  }

  addDirectories(directories = []) {
    return this.setDirectories([...this.directories, ...directories]);
  }

  removeDirectory(directory) {
    const normalized = normalizePath(directory);
    this.directories = this.directories.filter(item => item !== normalized);
    return this.directories;
  }

  listDirectories() {
    return [...this.directories];
  }

  async scan() {
    const tracks = [];
    const nextTracks = new Map();
    const nextPlaylists = [];
    for (const directory of this.directories) {
      const files = await this.walk(directory);
      const playlistTracks = [];
      for (const audioPath of files) {
        const localId = `local-${hash(audioPath.toLowerCase())}`;
        const metadata = parseFileName(audioPath);
        const lyricsPath = await findSibling(audioPath, ['.lrc', '.LRC']);
        const coverPath = await findSibling(audioPath, COVER_EXTENSIONS);
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
        nextTracks.set(localId, track);
        playlistTracks.push(track);
        tracks.push(track);
      }
      if (playlistTracks.length) {
        const playlistId = `local-playlist-${hash(directory.toLowerCase())}`;
        nextPlaylists.push({
          id: playlistId,
          name: path.basename(directory) || directory,
          source: 'local',
          directory,
          trackCount: playlistTracks.length,
          tracks: playlistTracks,
        });
      }
    }
    this.tracks = nextTracks;
    this.playlists = nextPlaylists;
    return this.toPublicPlaylists();
  }

  async walk(directory) {
    const results = [];
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (_) {
      return results;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await this.walk(entryPath)));
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

export { parseLrc, parseFileName };
