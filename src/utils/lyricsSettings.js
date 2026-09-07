export const LYRIC_FONT_SIZE_MIN = 16;
export const LYRIC_FONT_SIZE_DEFAULT = 28;
export const LYRIC_FONT_SIZE_MAX = 64;

export function normalizeLyricFontSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size)) return LYRIC_FONT_SIZE_DEFAULT;
  return Math.min(LYRIC_FONT_SIZE_MAX, Math.max(LYRIC_FONT_SIZE_MIN, size));
}

export function normalizeLyricOffset(value) {
  const offset = Number(value);
  if (!Number.isFinite(offset)) return 0;
  return Math.min(10, Math.max(-10, Math.round(offset * 10) / 10));
}

