import { normalizeStageMode } from '../utils/lyricStageModes';
import findLyricIndex from '../utils/lyricCursor';

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
