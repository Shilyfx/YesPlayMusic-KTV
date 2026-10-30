import { stageModeOptions } from './visualCatalog';

const MAX_TRACK_KEY_LENGTH = 160;

function own(source, key) {
  try {
    return Object.prototype.hasOwnProperty.call(source, key);
  } catch (_) {
    return false;
  }
}

function read(source, key) {
  try {
    return source[key];
  } catch (_) {
    return undefined;
  }
}

function modeIds(modeOptions) {
  const values = new Set();
  const options = Array.isArray(modeOptions) ? modeOptions : stageModeOptions;
  options.slice(0, 64).forEach(option => {
    const value = typeof option === 'string' ? option : option && option.value;
    if (
      typeof value === 'string' &&
      /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value)
    )
      values.add(value);
  });
  return values;
}

function normalizePool(value, modeOptions) {
  const allowed = modeIds(modeOptions);
  if (!Array.isArray(value)) return Array.from(allowed);
  const pool = [];
  value.slice(0, 64).forEach(mode => {
    if (allowed.has(mode) && !pool.includes(mode)) pool.push(mode);
  });
  return pool;
}

function normalizeTrackKey(value) {
  if (typeof value !== 'string') return '';
  const source = value.trim();
  let result = '';
  for (const character of source) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) continue;
    if (result.length + character.length > MAX_TRACK_KEY_LENGTH) break;
    result += character;
  }
  return result;
}

export function normalizeRandomStyleSettings(
  value,
  modeOptions = stageModeOptions
) {
  const source =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    enabled: read(source, 'enabled') === true,
    pool: normalizePool(
      own(source, 'pool') ? read(source, 'pool') : undefined,
      modeOptions
    ),
    lastTrackKey: normalizeTrackKey(read(source, 'lastTrackKey')),
  };
}

export function chooseRandomStyle(
  pool,
  currentMode,
  random = Math.random,
  modeOptions = stageModeOptions
) {
  const candidates = normalizePool(pool, modeOptions);
  if (candidates.length > 1 && candidates.includes(currentMode)) {
    candidates.splice(candidates.indexOf(currentMode), 1);
  }
  if (!candidates.length) return null;

  let sample = 0;
  try {
    sample = Number(random());
  } catch (_) {
    sample = 0;
  }
  if (!Number.isFinite(sample)) sample = 0;
  const index = Math.floor(
    Math.min(0.999999999999, Math.max(0, sample)) * candidates.length
  );
  return candidates[index] || candidates[0];
}

export function resolveRandomStyleForTrack(
  settings,
  trackKey,
  currentMode,
  random = Math.random,
  modeOptions = stageModeOptions
) {
  const normalized = normalizeRandomStyleSettings(settings, modeOptions);
  const key = normalizeTrackKey(trackKey);
  if (
    !normalized.enabled ||
    !key ||
    key === normalized.lastTrackKey ||
    !normalized.pool.length
  ) {
    return { mode: currentMode, settings: normalized, changed: false };
  }

  const mode = chooseRandomStyle(
    normalized.pool,
    currentMode,
    random,
    modeOptions
  );
  if (!mode) return { mode: currentMode, settings: normalized, changed: false };
  return {
    mode,
    settings: { ...normalized, lastTrackKey: key },
    changed: true,
  };
}
