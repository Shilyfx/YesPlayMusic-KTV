import { writePreferenceIfChanged } from './preferenceStorage';

export const SMART_BEAT_EFFECTS = Object.freeze({
  'sonnet.lensTear': { mode: 'sonnet', source: 'beats', label: '推镜裂光' },
  'diorama.ripple': { mode: 'diorama', source: 'beats', label: '水镜涟漪' },
  'pendolo.drumhead': { mode: 'pendolo', source: 'drums', label: '仿真鼓面' },
  'tempera.inkFlash': { mode: 'tempera', source: 'drums', label: '墨染奥行' },
  'hanabi.beatBursts': { mode: 'hanabi', source: 'beats', label: '随拍开花' },
  'hanabi.beatPulse': { mode: 'hanabi', source: 'beats', label: '随拍推镜' },
});

export const SMART_BEAT_MODES = Object.freeze(['off', 'on', 'cached']);
const STORAGE_KEY = 'lumasing.ktv.smartbeat.preferences.v1';
const clampStrength = value =>
  Math.round(Math.max(0, Math.min(2, Number(value) || 0)) * 100) / 100;

function normalizeEffect(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    // SmartBeat starts globally off, but choosing "on" should immediately
    // activate the original effects that apply to the selected renderer.
    // A saved/user supplied false remains an explicit opt-out.
    enabled: source.enabled === undefined ? true : source.enabled === true,
    strength:
      source.strength === undefined ? 1 : clampStrength(source.strength),
  };
}

export function normalizeSmartBeatPreferences(value) {
  const source = value && typeof value === 'object' ? value : {};
  const inputEffects =
    source.effects && typeof source.effects === 'object' ? source.effects : {};
  const effects = {};
  for (const id of Object.keys(SMART_BEAT_EFFECTS)) {
    effects[id] = normalizeEffect(inputEffects[id]);
  }
  return {
    mode: SMART_BEAT_MODES.includes(source.mode) ? source.mode : 'off',
    beatStrength:
      source.beatStrength === undefined
        ? 1
        : clampStrength(source.beatStrength),
    downbeatStrength:
      source.downbeatStrength === undefined
        ? 1
        : clampStrength(source.downbeatStrength),
    effects,
  };
}

export function getSmartBeatSourceRequirements(preferences, rendererMode) {
  const settings = normalizeSmartBeatPreferences(preferences);
  const required = { beats: false, drums: false };
  if (settings.mode === 'off') return required;
  for (const [id, effect] of Object.entries(SMART_BEAT_EFFECTS)) {
    if (
      effect.mode === rendererMode &&
      settings.effects[id].enabled &&
      settings.effects[id].strength > 0
    ) {
      required[effect.source] = true;
    }
  }
  return required;
}

export function readSmartBeatPreferences(storage, key = STORAGE_KEY) {
  try {
    const target = storage || localStorage;
    return normalizeSmartBeatPreferences(
      JSON.parse(target.getItem(key) || 'null')
    );
  } catch (_) {
    return normalizeSmartBeatPreferences();
  }
}

export function writeSmartBeatPreferences(
  preferences,
  storage,
  key = STORAGE_KEY
) {
  try {
    const target = storage || localStorage;
    return writePreferenceIfChanged(
      target,
      key,
      JSON.stringify(normalizeSmartBeatPreferences(preferences))
    );
  } catch (_) {
    return false;
  }
}
