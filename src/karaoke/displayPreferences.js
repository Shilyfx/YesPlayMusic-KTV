import { normalizeStageMode } from '../utils/lyricStageModes';
import {
  normalizeLyricFontSize,
  normalizeLyricOffset,
} from '../utils/lyricsSettings';

const KEY = 'lumasing.ktv.display.preferences.v1';
export function normalizeDisplayPreferences(value) {
  const source =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    version: 1,
    followStyle: source.followStyle !== false,
    followTiming: source.followTiming !== false,
    mode: normalizeStageMode(source.mode),
    effect: ['gradient', 'neon', 'outline', 'solid'].includes(source.effect)
      ? source.effect
      : 'gradient',
    fontSize: normalizeLyricFontSize(
      source.fontSize === undefined ? 45 : source.fontSize
    ),
    offset: normalizeLyricOffset(source.offset),
  };
}
export function effectiveDisplayPresentation(presentation, preferences) {
  const local = normalizeDisplayPreferences(preferences);
  return {
    ...presentation,
    ...(!local.followStyle
      ? { mode: local.mode, effect: local.effect, fontSize: local.fontSize }
      : {}),
    ...(!local.followTiming ? { offset: local.offset } : {}),
  };
}
export function readDisplayPreferences(storage) {
  try {
    return normalizeDisplayPreferences(
      JSON.parse((storage || localStorage).getItem(KEY))
    );
  } catch (_) {
    return normalizeDisplayPreferences();
  }
}
export function writeDisplayPreferences(preferences, storage) {
  try {
    (storage || localStorage).setItem(
      KEY,
      JSON.stringify(normalizeDisplayPreferences(preferences))
    );
    return true;
  } catch (_) {
    return false;
  }
}
