import { normalizeStageMode } from '../utils/lyricStageModes';
import findLyricIndex from '../utils/lyricCursor';
import { sanitizeMusicReaction } from './musicReactionAnalyzer';
import { normalizeSmartBeatPreferences } from './smartBeatPreferences';

const SMART_BEAT_STATUSES = new Set([
  'unsupported',
  'loading-model',
  'fetching-audio',
  'analysing',
  'ready',
  'cached',
  'error',
  'cancelled',
  'waiting',
  'idle',
]);

function replaceAsciiControlCharacters(value) {
  let result = '';
  for (const character of value) {
    result += character.charCodeAt(0) <= 0x1f ? ' ' : character;
  }
  return result;
}

function sanitizeSmartBeatPresentation(value) {
  if (!value || typeof value !== 'object') return undefined;
  const state = SMART_BEAT_STATUSES.has(value.status) ? value.status : 'idle';
  const trackKey =
    typeof value.trackKey === 'string' ? value.trackKey.slice(0, 320) : '';
  const detail =
    typeof value.detail === 'string'
      ? replaceAsciiControlCharacters(value.detail).trim().slice(0, 180)
      : '';
  return {
    settings: normalizeSmartBeatPreferences(value.settings),
    status: state,
    trackKey,
    analysisRevision: Number.isSafeInteger(value.analysisRevision)
      ? Math.max(0, value.analysisRevision)
      : 0,
    ...(Number.isFinite(value.progress)
      ? { progress: Math.max(0, Math.min(1, value.progress)) }
      : {}),
    ...(typeof value.cacheHit === 'boolean'
      ? { cacheHit: value.cacheHit }
      : {}),
    ...(detail ? { detail } : {}),
  };
}

function sanitizeRawAudioFeatures(value) {
  if (!value || typeof value !== 'object') return undefined;
  const available = value.available === true;
  const clamp = key =>
    available && Number.isFinite(value[key])
      ? Math.max(0, Math.min(1, value[key]))
      : 0;
  return {
    available,
    power: clamp('power'),
    bass: clamp('bass'),
    lowMid: clamp('lowMid'),
    mid: clamp('mid'),
    vocal: clamp('vocal'),
    treble: clamp('treble'),
  };
}

export function buildLyricWindow(lyrics, position, offset) {
  return buildLyricContext(lyrics, position, offset).lines;
}

export function buildLyricContext(lyrics, position, offset) {
  if (!lyrics.length) return { lines: [], contextFrom: 0, contextUntil: null };
  const reach = Math.max(10, Math.abs(Number(offset) || 0)) + 3;
  const wantedStart = Math.max(0, findLyricIndex(lyrics, position - reach) - 1);
  const wantedEnd = Math.min(
    lyrics.length,
    Math.max(wantedStart + 16, findLyricIndex(lyrics, position + reach) + 4)
  );
  const anchor = Math.max(
    wantedStart,
    Math.min(wantedEnd - 1, findLyricIndex(lyrics, position))
  );
  const encoder = new TextEncoder();
  const cache = new Map();
  const entry = index => {
    if (!cache.has(index)) {
      const line = {
        time: Number(lyrics[index].time),
        content: String(lyrics[index].content || '').slice(0, 2000),
      };
      cache.set(index, {
        line,
        bytes: encoder.encode(JSON.stringify(line)).length + 1,
      });
    }
    return cache.get(index);
  };
  let start = anchor,
    end = anchor + 1,
    bytes = entry(anchor).bytes;
  let changed = true;
  // Cover the requested time span. Pathological files remain byte/count bounded;
  // explicit valid bounds prevent showing the wrong cue if context is clipped.
  while (changed && end - start < 4096) {
    changed = false;
    if (start > wantedStart && bytes + entry(start - 1).bytes <= 192 * 1024) {
      bytes += entry(--start).bytes;
      changed = true;
    }
    if (
      end < wantedEnd &&
      end - start < 4096 &&
      bytes + entry(end).bytes <= 192 * 1024
    ) {
      bytes += entry(end++).bytes;
      changed = true;
    }
  }
  return {
    lines: Array.from({ length: end - start }, (_, i) => entry(start + i).line),
    contextFrom: start > 0 ? Number(lyrics[start].time) : 0,
    contextUntil: end < lyrics.length ? Number(lyrics[end].time) : null,
  };
}

const text = (value, max) =>
  typeof value === 'string' ? value.slice(0, max) : '';
const MAX_COVER_REFERENCE_LENGTH = 2048;
const LOCAL_COVER_REFERENCE = /^\/ktv\/local\/cover\/(local-[a-f0-9]{16})$/i;

export function sanitizeCoverReference(value) {
  if (typeof value !== 'string') return '';
  const candidate = value.trim();
  const hasControlCharacter = Array.from(candidate).some(character => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (
    !candidate ||
    candidate.length > MAX_COVER_REFERENCE_LENGTH ||
    hasControlCharacter
  )
    return '';
  if (LOCAL_COVER_REFERENCE.test(candidate)) return candidate;
  try {
    const url = new URL(candidate);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return '';
    const normalized = url.href;
    return normalized.length <= MAX_COVER_REFERENCE_LENGTH ? normalized : '';
  } catch (_) {
    return '';
  }
}

export function sanitizePresentation(value) {
  if (!value || !Array.isArray(value.lines) || value.lines.length > 4096)
    throw new Error('INVALID_PRESENTATION');
  if (
    !Number.isFinite(value.position) ||
    value.position < 0 ||
    value.position > 86400
  )
    throw new Error('INVALID_PRESENTATION');
  let previous = -Infinity;
  const lines = value.lines.map(line => {
    if (!Number.isFinite(line?.time) || line.time < previous || line.time < 0)
      throw new Error('INVALID_PRESENTATION');
    previous = line.time;
    return { time: line.time, content: text(line.content, 2000) };
  });
  return {
    itemId: text(value.itemId, 160),
    title: text(value.title, 300),
    artists: text(value.artists, 300),
    coverUrl: sanitizeCoverReference(value.coverUrl),
    position: value.position,
    playing: value.playing === true,
    offset: Number.isFinite(value.offset)
      ? Math.max(-30, Math.min(30, value.offset))
      : 0,
    fontSize: Number.isFinite(value.fontSize)
      ? Math.max(16, Math.min(64, value.fontSize))
      : 45,
    mode: normalizeStageMode(value.mode),
    effect: ['gradient', 'solid', 'outline', 'neon'].includes(value.effect)
      ? value.effect
      : 'gradient',
    theme: value.theme === 'dark' ? 'dark' : 'light',
    lines,
    contextFrom: Number.isFinite(value.contextFrom)
      ? Math.max(0, value.contextFrom)
      : 0,
    contextUntil: Number.isFinite(value.contextUntil)
      ? value.contextUntil
      : null,
    ...(value.musicReaction && sanitizeMusicReaction(value.musicReaction)
      ? { musicReaction: sanitizeMusicReaction(value.musicReaction) }
      : {}),
    ...(value.smartBeat
      ? { smartBeat: sanitizeSmartBeatPresentation(value.smartBeat) }
      : {}),
    ...(value.audioFeatures
      ? { audioFeatures: sanitizeRawAudioFeatures(value.audioFeatures) }
      : {}),
  };
}

export function projectPresentation(presentation, elapsed = 0) {
  const lines = presentation?.lines || [];
  const progress =
    (presentation?.position || 0) +
    (presentation?.offset || 0) +
    (presentation?.playing ? Math.max(0, Math.min(3, elapsed)) : 0);
  if (
    (presentation?.contextFrom > 0 && progress < presentation.contextFrom) ||
    (Number.isFinite(presentation?.contextUntil) &&
      progress >= presentation.contextUntil)
  ) {
    return {
      state: 'unavailable',
      before: '♪',
      active: '当前同步范围不足，请减小本屏偏移',
      after: '等待主屏更新歌词',
      afterSecond: '♪',
      translation: '',
      cueKey: JSON.stringify([
        presentation?.itemId || '',
        'context-unavailable',
      ]),
    };
  }
  let index = -1;
  while (index + 1 < lines.length && lines[index + 1].time <= progress) index++;
  const activeLine = lines[index];
  // The rolling window changes local indexes after each host update. Identify
  // a cue by song/time/text, never by that temporary index, to retain its DOM
  // node and avoid restarting the entrance animation on the same lyric.
  const cueKey = JSON.stringify(
    activeLine
      ? [presentation?.itemId || '', activeLine.time, activeLine.content]
      : [presentation?.itemId || '', lines.length ? 'before-first' : 'waiting']
  );
  return {
    state: lines.length ? (index < 0 ? 'before-first' : 'active') : 'waiting',
    before: lines[index - 1]?.content || '♪',
    active: lines.length
      ? index < 0
        ? '等待第一句歌词'
        : lines[index].content
      : '等待歌词加载',
    after: lines[index + 1]?.content || '♪',
    afterSecond: lines[index + 2]?.content || '♪',
    translation: '',
    cueKey,
  };
}
