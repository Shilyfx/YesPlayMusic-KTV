export const SMART_BEAT_TIMELINE_MAX_BYTES = 256 * 1024;
export const SMART_BEAT_TIMELINE_MAX_EVENTS = 12000;
export const SMART_BEAT_TIMELINE_MAX_DURATION_SECONDS = 600;
const SHA256 = /^[a-f0-9]{64}$/i;

function fail(reason) {
  throw new Error(`INVALID_SMART_BEAT_TIMELINE:${reason}`);
}

function boundedKey(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 320;
}

function validateTimes(value, duration) {
  if (!Array.isArray(value) || value.length > SMART_BEAT_TIMELINE_MAX_EVENTS)
    fail('times');
  let previous = -Infinity;
  const result = value.map(time => {
    if (
      !Number.isFinite(time) ||
      time < 0 ||
      time > duration ||
      time < previous
    )
      fail('sorted-time');
    previous = time;
    return time;
  });
  return result;
}

function normalizeBeats(value, duration) {
  if (value == null) return null;
  if (!value || value.source !== 'beat_this') fail('beat-source');
  const times = validateTimes(value.times, duration);
  const downbeats = validateTimes(value.downbeats, duration);
  const beatTimes = new Set(times);
  if (downbeats.some(time => !beatTimes.has(time))) fail('downbeat-grid');
  return { source: 'beat_this', times, downbeats };
}

function normalizeDrums(value, duration) {
  if (value == null) return null;
  if (!value || value.source !== 'htdemucs') fail('drum-source');
  const times = validateTimes(value.times, duration);
  if (
    !Array.isArray(value.strengths) ||
    !Array.isArray(value.kinds) ||
    value.strengths.length !== times.length ||
    value.kinds.length !== times.length
  )
    fail('drum-arrays');
  const strengths = value.strengths.map(strength => {
    if (!Number.isFinite(strength) || strength < 0 || strength > 1)
      fail('drum-strength');
    return strength;
  });
  const kinds = value.kinds.map(kind => {
    if (![0, 1, 2].includes(kind)) fail('drum-kind');
    return kind;
  });
  return { source: 'htdemucs', times, strengths, kinds };
}

export function sanitizeSmartBeatTimeline(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('shape');
  if (!boundedKey(value.trackKey)) fail('track-key');
  if (!SHA256.test(value.audioHash || '')) fail('audio-hash');
  const versions = value.modelVersions;
  if (
    !versions ||
    !SHA256.test(versions.beat_this || '') ||
    !SHA256.test(versions.htdemucs || '')
  )
    fail('model-versions');
  if (
    !Number.isFinite(value.duration) ||
    value.duration < 0 ||
    value.duration > SMART_BEAT_TIMELINE_MAX_DURATION_SECONDS
  )
    fail('duration');
  const timeline = {
    trackKey: value.trackKey,
    audioHash: value.audioHash.toLowerCase(),
    modelVersions: {
      beat_this: versions.beat_this.toLowerCase(),
      htdemucs: versions.htdemucs.toLowerCase(),
    },
    duration: value.duration,
    beats: normalizeBeats(value.beats, value.duration),
    drums: normalizeDrums(value.drums, value.duration),
  };
  const count =
    (timeline.beats?.times.length || 0) +
    (timeline.beats?.downbeats.length || 0) +
    (timeline.drums?.times.length || 0);
  if (count > SMART_BEAT_TIMELINE_MAX_EVENTS) fail('event-count');
  const bytes = new TextEncoder().encode(JSON.stringify(timeline)).byteLength;
  if (bytes > SMART_BEAT_TIMELINE_MAX_BYTES) fail('byte-size');
  return timeline;
}
