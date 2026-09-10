const STORAGE_BACKUP_PREFIX = 'yesplaymusic.invalid.';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function safeJsonRead(key, fallback, validator = () => true) {
  let raw;
  try {
    raw = localStorage.getItem(key);
  } catch (error) {
    console.warn(`[storage] unable to read ${key}: ${error.message}`);
    return fallback;
  }
  if (raw === null || raw === '') return fallback;
  try {
    const value = JSON.parse(raw);
    if (!validator(value)) throw new Error('invalid shape');
    return value;
  } catch (error) {
    try {
      localStorage.setItem(`${STORAGE_BACKUP_PREFIX}${key}`, raw);
    } catch (_) {
      // Storage may be unavailable; the fallback is still safe to use.
    }
    console.warn(`[storage] ignored invalid ${key}: ${error.message}`);
    return fallback;
  }
}

export function safeJsonWrite(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn(`[storage] unable to write ${key}: ${error.message}`);
    return false;
  }
}

export const isSettings = value => isPlainObject(value);
export const isData = value => isPlainObject(value);
export const isPlayer = value => isPlainObject(value);
export const isLastfm = value => isPlainObject(value);
