import {
  LYRIC_FONT_SIZE_DEFAULT,
  normalizeLyricFontSize,
  normalizeLyricOffset,
} from '../utils/lyricsSettings';
import { stageModeOptions } from '../utils/lyricStageModes';
import {
  cloneVisualValue,
  getVisualBackgroundMetadata,
  getVisualModeMetadata,
} from './visualCatalog';
import { normalizeRandomStyleSettings } from './randomStylePool';

const EFFECTS = ['gradient', 'neon', 'outline', 'solid'];
const THEMES = ['auto', 'light', 'dark'];
const ANIMATION_INTENSITIES = ['calm', 'normal', 'chaotic'];
const CONFIG_FIELDS = [
  'version',
  'mode',
  'effect',
  'fontSize',
  'offset',
  'theme',
  'animationIntensity',
  'background',
  'tuningByMode',
  'random',
  'customTheme',
];
const BACKGROUND_FIELDS = [
  'mode',
  'tuning',
  'assetId',
  'transparent',
  'opacity',
];
const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];
const MODE_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const THEME_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/;
const HEX_COLOR_PATTERN = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i;
const VISUAL_ASSET_ID_PATTERN = /^[a-f0-9]{64}$/;
const URL_VALUE_PATTERN =
  /^(?:(?:https?|file|ftp):\/\/|(?:data|blob|javascript):)/i;

// These limits keep persisted tuning data small, JSON-like, and safe to clone.
const MAX_TUNING_DEPTH = 6;
const MAX_KEYS_PER_OBJECT = 64;
const MAX_ITEMS_PER_ARRAY = 64;
const MAX_SNAPSHOT_SIZE = 16 * 1024;
const MAX_SNAPSHOT_VALUES = 2048;
const MAX_CUSTOM_THEME_KEYS = 16;
const MAX_BACKGROUND_URLS = 8;
const MAX_BACKGROUND_URL_LENGTH = 2048;
const MAX_VISUAL_ASSET_REFS = 16;

const INVALID = {};

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object') return false;
  try {
    if (Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch (_) {
    return false;
  }
}

function readOwn(value, key) {
  try {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return undefined;
    return value[key];
  } catch (_) {
    return undefined;
  }
}

function hasOwn(value, key) {
  try {
    return Object.prototype.hasOwnProperty.call(value, key);
  } catch (_) {
    return false;
  }
}

function safeKeys(value, limit) {
  const keys = [];
  try {
    for (const key in value) {
      if (!hasOwn(value, key)) break;
      keys.push(key);
      if (keys.length > limit) break;
    }
  } catch (_) {
    // Keep the bounded prefix if an exotic object throws during enumeration.
  }
  return keys;
}

function optionList(value, fallback) {
  try {
    if (Array.isArray(value)) return value;
  } catch (_) {
    // A malformed option list falls back to the built-in list.
  }
  return fallback;
}

function optionId(entry) {
  if (typeof entry === 'string') return entry;
  if (isPlainRecord(entry)) return readOwn(entry, 'value');
  return undefined;
}

function collectIds(list, include) {
  const ids = new Set(include);
  const entries = optionList(list, []);
  let length = 0;
  try {
    length = Math.min(entries.length, 256);
  } catch (_) {
    return ids;
  }
  for (let index = 0; index < length; index += 1) {
    let entry;
    try {
      entry = entries[index];
    } catch (_) {
      continue;
    }
    const id = optionId(entry);
    if (typeof id === 'string' && MODE_ID_PATTERN.test(id)) ids.add(id);
  }
  return ids;
}

function supportedModes(options) {
  const configured = readOwn(options, 'modeOptions');
  const entries = Array.isArray(configured) ? configured : stageModeOptions;
  return collectIds(entries, ['classic']);
}

function supportedBackgroundModes(options) {
  const configured = readOwn(options, 'backgroundModes');
  return collectIds(optionList(configured, ['legacy']), ['legacy']);
}

function normalizedFontSize(value) {
  const candidate = value === undefined ? LYRIC_FONT_SIZE_DEFAULT : value;
  try {
    return normalizeLyricFontSize(candidate);
  } catch (_) {
    return LYRIC_FONT_SIZE_DEFAULT;
  }
}

function normalizedOffset(value) {
  try {
    return normalizeLyricOffset(value);
  } catch (_) {
    return 0;
  }
}

function normalizedOpacity(value) {
  if (value === undefined) return 1;
  try {
    const opacity = Number(value);
    if (!Number.isFinite(opacity)) return 1;
    return Math.min(1, Math.max(0, opacity));
  } catch (_) {
    return 1;
  }
}

function normalizedAssetId(value) {
  return typeof value === 'string' && VISUAL_ASSET_ID_PATTERN.test(value)
    ? value
    : null;
}

function normalizedAssetIdList(value) {
  if (!Array.isArray(value)) return [];
  const refs = [];
  value.slice(0, MAX_VISUAL_ASSET_REFS).forEach(candidate => {
    const assetId = normalizedAssetId(candidate);
    if (assetId && !refs.includes(assetId)) refs.push(assetId);
  });
  return refs;
}

function normalizedBackgroundUrl(value) {
  if (typeof value !== 'string') return '';
  const candidate = value.trim();
  if (
    !candidate ||
    candidate.length > MAX_BACKGROUND_URL_LENGTH ||
    Array.from(candidate).some(character => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  ) {
    return '';
  }
  try {
    const url = new URL(candidate);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return '';
    const normalized = url.href;
    return normalized.length <= MAX_BACKGROUND_URL_LENGTH ? normalized : '';
  } catch (_) {
    return '';
  }
}

function normalizedBackgroundUrlItems(value, budget) {
  if (!Array.isArray(value)) return [];
  const result = [];
  const length = Math.min(value.length, MAX_BACKGROUND_URLS);
  for (let index = 0; index < length; index += 1) {
    const entry = value[index];
    if (!isPlainRecord(entry)) continue;
    const url = normalizedBackgroundUrl(readOwn(entry, 'url'));
    if (!url) continue;
    const rawId = readOwn(entry, 'id');
    const id =
      typeof rawId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(rawId)
        ? rawId
        : `url-${index + 1}`;
    if (result.some(item => item.id === id)) continue;
    const encoded = JSON.stringify({ id, url });
    const cost = encoded.length + (result.length ? 1 : 0);
    if (!consume(budget, cost)) break;
    result.push({ id, url });
  }
  return result;
}

function backgroundTuningWithoutUrls(value) {
  if (!isPlainRecord(value)) return {};
  const result = {};
  safeKeys(value, MAX_KEYS_PER_OBJECT).forEach(key => {
    if (key === 'items' || FORBIDDEN_KEYS.includes(key)) return;
    result[key] = readOwn(value, key);
  });
  return result;
}

function escapedStringCost(value) {
  if (value.length > MAX_SNAPSHOT_SIZE) return MAX_SNAPSHOT_SIZE + 1;
  // Each UTF-16 code unit costs at most six bytes when JSON escaped.
  return 2 + value.length * 6;
}

function consume(budget, amount) {
  if (!Number.isFinite(amount) || amount > budget.remaining) {
    if (budget.strict) {
      const error = new Error('当前样式参数过大，请先减少参数后再保存');
      error.code = 'APPEARANCE_CONFIG_TOO_LARGE';
      throw error;
    }
    return false;
  }
  budget.remaining -= amount;
  return true;
}

function snapshotValue(value, depth, budget, ancestors) {
  if (budget.valuesRemaining <= 0) {
    if (budget.strict) consume(budget, Infinity);
    return INVALID;
  }
  budget.valuesRemaining -= 1;
  if (value === null || typeof value === 'boolean') {
    return consume(budget, value === null ? 4 : value ? 4 : 5)
      ? value
      : INVALID;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return INVALID;
    const cost = String(value).length;
    return consume(budget, cost) ? value : INVALID;
  }
  if (typeof value === 'string') {
    if (URL_VALUE_PATTERN.test(value.trim())) return INVALID;
    if (value.length > MAX_SNAPSHOT_SIZE) {
      if (budget.strict) consume(budget, Infinity);
      return INVALID;
    }
    return consume(budget, escapedStringCost(value)) ? value : INVALID;
  }
  if (typeof value !== 'object' || depth > MAX_TUNING_DEPTH) {
    return INVALID;
  }

  let isArray = false;
  try {
    isArray = Array.isArray(value);
  } catch (_) {
    return INVALID;
  }
  if (!isArray && !isPlainRecord(value)) return INVALID;
  if (ancestors.has(value) || !consume(budget, 2)) return INVALID;
  ancestors.add(value);

  try {
    if (isArray) {
      const result = [];
      let length = 0;
      try {
        length = Math.min(value.length, MAX_ITEMS_PER_ARRAY);
      } catch (_) {
        return INVALID;
      }
      for (let index = 0; index < length; index += 1) {
        let child;
        try {
          child = value[index];
        } catch (_) {
          continue;
        }
        const separatorCost = result.length ? 1 : 0;
        if (!consume(budget, separatorCost)) break;
        const clean = snapshotValue(child, depth + 1, budget, ancestors);
        if (clean === INVALID) {
          budget.remaining += separatorCost;
          continue;
        }
        result.push(clean);
      }
      return result;
    }

    const result = {};
    const keys = safeKeys(value, MAX_KEYS_PER_OBJECT);
    const length = Math.min(keys.length, MAX_KEYS_PER_OBJECT);
    for (let index = 0; index < length; index += 1) {
      const key = keys[index];
      if (FORBIDDEN_KEYS.includes(key)) continue;
      const headerCost = escapedStringCost(key) + 2;
      if (!consume(budget, headerCost)) continue;
      const child = readOwn(value, key);
      const clean = snapshotValue(child, depth + 1, budget, ancestors);
      if (clean === INVALID) {
        budget.remaining += headerCost;
        continue;
      }
      result[key] = clean;
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function normalizedSnapshot(value, budget) {
  if (!isPlainRecord(value)) return {};
  const clean = snapshotValue(value, 0, budget, new WeakSet());
  return clean === INVALID || !isPlainRecord(clean) ? {} : clean;
}

function normalizedAppearanceSnapshot(
  value,
  budget,
  required,
  options,
  prefix
) {
  const result = {};
  const keys = safeKeys(value, MAX_KEYS_PER_OBJECT).slice(
    0,
    MAX_KEYS_PER_OBJECT
  );
  keys.sort(
    (left, right) => Number(required.has(right)) - Number(required.has(left))
  );
  for (const key of keys) {
    if (FORBIDDEN_KEYS.includes(key)) continue;
    const trial = { ...budget };
    try {
      const clean = normalizedSnapshot({ [key]: readOwn(value, key) }, trial);
      if (hasOwn(clean, key)) {
        result[key] = clean[key];
        Object.assign(budget, trial);
      }
    } catch (error) {
      if (error.code !== 'APPEARANCE_CONFIG_TOO_LARGE' || required.has(key))
        throw error;
      if (options.onCandidateTrim) options.onCandidateTrim(`${prefix}.${key}`);
    }
  }
  return result;
}

function normalizedTuningByMode(value, budget, options = {}) {
  if (!isPlainRecord(value)) return {};
  if (budget.strict) budget = appearanceCandidateBudget();
  if (budget.valuesRemaining <= 0 || !consume(budget, 2)) return {};
  budget.valuesRemaining -= 1;
  const result = {};
  const keys = safeKeys(value, MAX_KEYS_PER_OBJECT);
  const length = Math.min(keys.length, MAX_KEYS_PER_OBJECT);
  for (let index = 0; index < length; index += 1) {
    const key = keys[index];
    if (FORBIDDEN_KEYS.includes(key) || !MODE_ID_PATTERN.test(key)) continue;
    const snapshot = readOwn(value, key);
    if (!isPlainRecord(snapshot)) continue;
    const headerCost = escapedStringCost(key) + 2;
    if (!consume(budget, headerCost)) continue;
    const source = {};
    safeKeys(snapshot, MAX_KEYS_PER_OBJECT).forEach(field => {
      if (FORBIDDEN_KEYS.includes(field)) return;
      const candidate = readOwn(snapshot, field);
      if (
        (key === 'monet' && field === 'portraitAssetId') ||
        (key === 'cappella' &&
          (field === 'emojiAssetIds' || field === 'avatarAssetIds')) ||
        (key === 'tempera' && field === 'layerImageAssetIds')
      ) {
        const refs =
          field === 'portraitAssetId'
            ? normalizedAssetId(candidate)
            : normalizedAssetIdList(candidate);
        if (refs === null) return;
        source[field] = refs;
        return;
      }
      if (
        key === 'tempera' &&
        (field === 'layerImages' || field === 'layerImageNames')
      ) {
        source[field] = Array.isArray(candidate)
          ? candidate.slice(0, MAX_VISUAL_ASSET_REFS)
          : [];
        return;
      }
      source[field] = candidate;
    });
    const protectedFields = {
      monet: ['portraitAssetId', 'portraitSource'],
      cappella: [
        'emojiAssetIds',
        'avatarAssetIds',
        'emojiPackSource',
        'avatarSource',
      ],
      tempera: ['layerImageAssetIds', 'layerImages', 'layerImageNames'],
    };
    const clean = budget.strict
      ? normalizedAppearanceSnapshot(
          source,
          appearanceCandidateBudget(),
          new Set(
            key === options.selectedMode
              ? Object.keys(source)
              : protectedFields[key] || []
          ),
          options,
          `tuningByMode.${key}`
        )
      : normalizedSnapshot(source, budget);
    result[key] = clean;
  }
  return result;
}

function valuesEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (left === undefined || right === undefined) return false;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch (_) {
    return false;
  }
}

function sparseDifference(defaultValue, value) {
  if (isPlainRecord(defaultValue) && isPlainRecord(value)) {
    const result = {};
    const keys = new Set([...Object.keys(defaultValue), ...Object.keys(value)]);
    keys.forEach(key => {
      const next = sparseDifference(defaultValue[key], value[key]);
      if (next !== undefined) result[key] = next;
    });
    return Object.keys(result).length ? result : undefined;
  }
  return valuesEqual(defaultValue, value) ? undefined : cloneVisualValue(value);
}

export function sparseVisualTuning(scope, id, value) {
  const metadata =
    scope === 'background'
      ? getVisualBackgroundMetadata(id)
      : getVisualModeMetadata(id);
  if (!metadata || !isPlainRecord(value)) return {};
  return sparseDifference(metadata.tuningDefaults, value) || {};
}

function normalizedCustomTheme(value) {
  if (!isPlainRecord(value)) return null;
  const keys = safeKeys(value, MAX_CUSTOM_THEME_KEYS);
  if (!keys.length || keys.length > MAX_CUSTOM_THEME_KEYS) return null;
  const result = {};
  for (const key of keys) {
    if (
      FORBIDDEN_KEYS.includes(key) ||
      !THEME_KEY_PATTERN.test(key) ||
      key.length > 32
    ) {
      return null;
    }
    const color = readOwn(value, key);
    if (typeof color !== 'string' || !HEX_COLOR_PATTERN.test(color))
      return null;
    result[key] = color;
  }
  return result;
}

function normalizedBackground(value, options, budget) {
  const source = isPlainRecord(value) ? value : {};
  const backgroundModes = supportedBackgroundModes(options);
  const requestedMode = readOwn(source, 'mode');
  const requestedTuning = readOwn(source, 'tuning');
  const requestedTransparent = readOwn(source, 'transparent');
  const mode =
    typeof requestedMode === 'string' && backgroundModes.has(requestedMode)
      ? requestedMode
      : 'legacy';
  const candidate =
    mode === 'url'
      ? backgroundTuningWithoutUrls(requestedTuning)
      : requestedTuning;
  const tuning =
    budget.strict && isPlainRecord(candidate)
      ? normalizedAppearanceSnapshot(
          candidate,
          budget,
          new Set(
            Object.keys(getVisualBackgroundMetadata(mode)?.tuningDefaults || {})
          ),
          options,
          'background.tuning'
        )
      : normalizedSnapshot(candidate, budget);
  if (mode === 'url') {
    tuning.items = normalizedBackgroundUrlItems(
      readOwn(requestedTuning, 'items'),
      budget.strict ? appearanceCandidateBudget() : budget
    );
    const requestedSelectedId = readOwn(requestedTuning, 'selectedId');
    tuning.selectedId = tuning.items.some(
      item => item.id === requestedSelectedId
    )
      ? requestedSelectedId
      : null;
  }
  return {
    mode,
    tuning,
    assetId: normalizedAssetId(readOwn(source, 'assetId')),
    transparent:
      typeof requestedTransparent === 'boolean' ? requestedTransparent : false,
    opacity: normalizedOpacity(readOwn(source, 'opacity')),
  };
}

function defaultConfig() {
  return {
    version: 1,
    mode: 'classic',
    effect: 'gradient',
    fontSize: LYRIC_FONT_SIZE_DEFAULT,
    offset: 0,
    theme: 'auto',
    animationIntensity: 'normal',
    background: {
      mode: 'legacy',
      tuning: {},
      assetId: null,
      transparent: false,
      opacity: 1,
    },
    tuningByMode: {},
    random: normalizeRandomStyleSettings(),
    customTheme: null,
  };
}

function appearanceCandidateBudget() {
  // Each bounded mode is validated independently before appearance-level trimming.
  return {
    remaining: 128 * 1024,
    valuesRemaining: MAX_SNAPSHOT_VALUES,
    strict: true,
  };
}

export function normalizeVisualConfig(value, options = {}) {
  try {
    const source = isPlainRecord(value) ? value : {};
    const configOptions = isPlainRecord(options) ? options : {};
    const modes = supportedModes(configOptions);
    const requestedMode = readOwn(source, 'mode');
    const requestedEffect = readOwn(source, 'effect');
    const requestedTheme = readOwn(source, 'theme');
    const requestedIntensity = readOwn(source, 'animationIntensity');
    const normalizedMode =
      typeof requestedMode === 'string' && modes.has(requestedMode)
        ? requestedMode
        : 'classic';
    const budget = configOptions.preserveAppearanceCandidates
      ? appearanceCandidateBudget()
      : {
          // Leave room for the enclosing config keys and empty fallbacks.
          remaining: MAX_SNAPSHOT_SIZE - 256,
          valuesRemaining: MAX_SNAPSHOT_VALUES,
        };
    return {
      version: 1,
      mode: normalizedMode,
      effect: EFFECTS.includes(requestedEffect) ? requestedEffect : 'gradient',
      fontSize: normalizedFontSize(readOwn(source, 'fontSize')),
      offset: normalizedOffset(readOwn(source, 'offset')),
      theme: THEMES.includes(requestedTheme) ? requestedTheme : 'auto',
      animationIntensity: ANIMATION_INTENSITIES.includes(requestedIntensity)
        ? requestedIntensity
        : 'normal',
      background: normalizedBackground(
        readOwn(source, 'background'),
        configOptions,
        budget
      ),
      tuningByMode: normalizedTuningByMode(
        readOwn(source, 'tuningByMode'),
        budget,
        { ...configOptions, selectedMode: normalizedMode }
      ),
      random: normalizeRandomStyleSettings(
        readOwn(source, 'random'),
        options.modeOptions
      ),
      customTheme: normalizedCustomTheme(readOwn(source, 'customTheme')),
    };
  } catch (error) {
    if (
      options &&
      options.preserveAppearanceCandidates &&
      error.code === 'APPEARANCE_CONFIG_TOO_LARGE'
    )
      throw error;
    return defaultConfig();
  }
}

export function normalizeVisualPatch(current, patch, options = {}) {
  const base = normalizeVisualConfig(current, options);
  try {
    if (!isPlainRecord(patch)) return base;
    const candidate = { ...base };
    for (const field of CONFIG_FIELDS) {
      if (field === 'background' || !hasOwn(patch, field)) continue;
      candidate[field] = readOwn(patch, field);
    }

    if (hasOwn(patch, 'background')) {
      const backgroundPatch = readOwn(patch, 'background');
      if (isPlainRecord(backgroundPatch)) {
        const mergedBackground = { ...base.background };
        for (const field of BACKGROUND_FIELDS) {
          if (hasOwn(backgroundPatch, field)) {
            mergedBackground[field] = readOwn(backgroundPatch, field);
          }
        }
        candidate.background = mergedBackground;
      } else {
        candidate.background = backgroundPatch;
      }
    }

    if (hasOwn(patch, 'random')) {
      const randomPatch = readOwn(patch, 'random');
      candidate.random = isPlainRecord(randomPatch)
        ? { ...base.random, ...randomPatch }
        : randomPatch;
    }

    return normalizeVisualConfig(candidate, options);
  } catch (error) {
    if (
      options &&
      options.preserveAppearanceCandidates &&
      error.code === 'APPEARANCE_CONFIG_TOO_LARGE'
    )
      throw error;
    return base;
  }
}
