import { normalizeStageMode } from '../utils/lyricStageModes';
import {
  normalizeLyricFontSize,
  normalizeLyricOffset,
} from '../utils/lyricsSettings';
import {
  normalizeAppearanceConfig,
  normalizeAppearancePreferences,
} from './appearanceConfig';
import { writePreferenceIfChanged } from './preferenceStorage';

const KEY = 'lumasing.ktv.display.preferences.v1';
export function normalizeDisplayPreferences(value, options = {}) {
  const source =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  // Reserve room for the follower's three local follow flags in the stored config.
  const appearance = normalizeAppearancePreferences(source, {
    ...options,
    maxBytes: 16 * 1024 - 128,
  });
  return {
    version: 1,
    followStyle: source.followStyle !== false,
    followTiming: source.followTiming !== false,
    followBackground: source.followBackground !== false,
    mode: normalizeStageMode(source.mode),
    effect: ['gradient', 'neon', 'outline', 'solid'].includes(source.effect)
      ? source.effect
      : 'gradient',
    fontSize: normalizeLyricFontSize(
      source.fontSize === undefined ? 45 : source.fontSize
    ),
    offset: normalizeLyricOffset(source.offset),
    theme: ['auto', 'light', 'dark'].includes(source.theme)
      ? source.theme
      : 'auto',
    animationIntensity: appearance.animationIntensity,
    background: appearance.background,
    tuningByMode: appearance.tuningByMode,
    random: appearance.random,
    customTheme: appearance.customTheme,
  };
}
export function effectiveDisplayPresentation(
  presentation,
  preferences,
  appearance = null
) {
  const local = normalizeDisplayPreferences(preferences);
  const result = {
    ...presentation,
    ...(!local.followStyle
      ? {
          mode: local.mode,
          effect: local.effect,
          fontSize: local.fontSize,
          ...(appearance
            ? {
                animationIntensity: local.animationIntensity,
                tuningByMode: local.tuningByMode,
                random: local.random,
              }
            : {}),
        }
      : {}),
    ...(!local.followTiming ? { offset: local.offset } : {}),
    ...(local.theme !== 'auto'
      ? { theme: local.theme, customTheme: local.customTheme }
      : {}),
  };
  if (appearance) {
    const master = normalizeAppearanceConfig(appearance);
    if (local.followStyle) {
      result.animationIntensity = master.animationIntensity;
      result.tuningByMode = master.tuningByMode;
      result.random = master.random;
    }
    if (local.theme === 'auto') result.customTheme = master.customTheme;
    result.background = local.followBackground
      ? master.background
      : local.background;
  } else if (!local.followBackground) {
    result.background = local.background;
  }
  return result;
}
export function readDisplayPreferences(storage, options = {}) {
  try {
    return normalizeDisplayPreferences(
      JSON.parse((storage || localStorage).getItem(KEY)),
      options
    );
  } catch (error) {
    if (options.onInvalid) options.onInvalid(error);
    return normalizeDisplayPreferences();
  }
}
export function writeDisplayPreferences(preferences, storage) {
  try {
    return writePreferenceIfChanged(
      storage || localStorage,
      KEY,
      JSON.stringify(normalizeDisplayPreferences(preferences))
    );
  } catch (_) {
    return false;
  }
}
