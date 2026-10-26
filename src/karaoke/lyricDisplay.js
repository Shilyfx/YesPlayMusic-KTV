import { normalizeStageMode } from '../utils/lyricStageModes';
import findLyricIndex from '../utils/lyricCursor';

export function buildLyricWindow(lyrics, position, offset) {
  const index = findLyricIndex(lyrics, position + offset);
  const start = Math.max(0, index - 1);
  return lyrics.slice(start, start + 16).map(line => ({
    time: Number(line.time),
    content: String(line.content || '').slice(0, 2000),
  }));
}

const text = (value, max) =>
  typeof value === 'string' ? value.slice(0, max) : '';
export function sanitizePresentation(value) {
  if (!value || !Array.isArray(value.lines) || value.lines.length > 32)
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
  };
}

export function projectPresentation(presentation, elapsed = 0) {
  const lines = presentation?.lines || [];
  const progress =
    (presentation?.position || 0) +
    (presentation?.offset || 0) +
    (presentation?.playing ? Math.max(0, Math.min(3, elapsed)) : 0);
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
