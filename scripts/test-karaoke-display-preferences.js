const assert = require('assert');
require('./helpers/register-babel-src');
const {
  normalizeDisplayPreferences,
  effectiveDisplayPresentation,
  readDisplayPreferences,
  writeDisplayPreferences,
} = require('../src/karaoke/displayPreferences');
const {
  buildLyricWindow,
  buildLyricContext,
  projectPresentation,
  sanitizePresentation,
} = require('../src/karaoke/lyricDisplay');
const primary = {
  itemId: 'song',
  position: 100,
  offset: 2,
  mode: 'orbit',
  effect: 'neon',
  fontSize: 60,
  lines: [],
};
const saved = JSON.stringify(primary);
const defaults = normalizeDisplayPreferences();
assert.deepEqual(defaults.random, {
  enabled: false,
  pool: require('../src/utils/lyricStageModes').stageModeOptions.map(
    mode => mode.value
  ),
  lastTrackKey: '',
});
assert.deepEqual(effectiveDisplayPresentation(primary, defaults), primary);
const migratedV1 = normalizeDisplayPreferences({
  version: 1,
  followStyle: false,
  followTiming: false,
  mode: 'poem',
  effect: 'outline',
  fontSize: 32,
  offset: -2.3,
  theme: 'dark',
});
assert.equal(migratedV1.followStyle, false);
assert.equal(migratedV1.followTiming, false);
assert.equal(migratedV1.followBackground, true);
assert.equal(migratedV1.mode, 'poem');
assert.equal(migratedV1.offset, -2.3);
assert.equal(migratedV1.background.mode, 'legacy');
assert.deepEqual(migratedV1.tuningByMode, {});
assert.equal(
  effectiveDisplayPresentation({ ...primary, offset: 4 }, migratedV1).offset,
  -2.3,
  'v1 absolute offset remains unchanged during migration'
);
const masterAppearance = {
  mode: 'tilt',
  animationIntensity: 'chaotic',
  background: { mode: 'common', tuning: { drift: 0.4 } },
  tuningByMode: { tilt: { tilt: 12 } },
  random: { enabled: true, pool: ['sonnet', 'tilt'], lastTrackKey: 'queue:1' },
};
const localBackground = normalizeDisplayPreferences({
  followStyle: true,
  followBackground: false,
  background: { mode: 'legacy' },
});
const localBackgroundResult = effectiveDisplayPresentation(
  primary,
  localBackground,
  masterAppearance
);
assert.equal(localBackgroundResult.mode, 'orbit');
assert.equal(localBackgroundResult.background.mode, 'legacy');
assert.equal(localBackgroundResult.animationIntensity, 'chaotic');
assert.deepEqual(
  localBackgroundResult.random,
  masterAppearance.random,
  'the active chosen mode stays on the presentation while random remains a preference'
);
const localTuning = normalizeDisplayPreferences({
  followStyle: false,
  followBackground: true,
  mode: 'poem',
  tuningByMode: { poem: { lineGap: 1.4 } },
});
const localTuningResult = effectiveDisplayPresentation(
  primary,
  localTuning,
  masterAppearance
);
assert.equal(localTuningResult.mode, 'poem');
assert.equal(localTuningResult.background.mode, 'common');
assert.deepEqual(localTuningResult.tuningByMode, {
  poem: { lineGap: 1.4 },
});
assert.equal(defaults.theme, 'auto');
assert.equal(
  effectiveDisplayPresentation({ ...primary, theme: 'dark' }, defaults).theme,
  'dark',
  'auto display theme follows the primary screen'
);
assert.equal(
  effectiveDisplayPresentation(primary, { ...defaults, theme: 'dark' }).theme,
  'dark',
  'a local dark theme overrides only the display screen'
);
assert.equal(
  effectiveDisplayPresentation(primary, { ...defaults, theme: 'light' }).theme,
  'light'
);
assert.equal(normalizeDisplayPreferences({ theme: 'invalid' }).theme, 'auto');
const custom = normalizeDisplayPreferences({
  followStyle: false,
  followTiming: false,
  mode: 'poem',
  effect: 'outline',
  fontSize: 32,
  offset: -1.5,
});
const effective = effectiveDisplayPresentation(primary, custom);
assert.equal(
  effective.offset,
  -1.5,
  'custom time replaces, not adds to, master offset'
);
assert.equal(effective.mode, 'poem');
assert.equal(effective.effect, 'outline');
assert.equal(effective.fontSize, 32);
assert.equal(
  JSON.stringify(primary),
  saved,
  'local preferences cannot mutate master data'
);
assert.equal(
  effectiveDisplayPresentation(primary, { ...custom, followTiming: true })
    .offset,
  2
);
assert.equal(
  effectiveDisplayPresentation(primary, { ...custom, followStyle: true }).mode,
  'orbit'
);
assert.equal(
  effectiveDisplayPresentation({ ...primary, offset: 4 }, custom).offset,
  -1.5
);
assert.equal(
  normalizeDisplayPreferences({
    fontSize: 999,
    offset: -999,
    mode: 'invalid',
    effect: 'invalid',
  }).fontSize,
  64
);
assert.equal(normalizeDisplayPreferences({ offset: -999 }).offset, -10);
const values = new Map();
const storage = {
  getItem: key => values.get(key) || null,
  setItem: (key, value) => values.set(key, value),
};
assert.equal(writeDisplayPreferences(custom, storage), true);
assert.deepEqual(readDisplayPreferences(storage), custom);
assert.deepEqual(
  readDisplayPreferences({ getItem: () => '{broken' }),
  defaults
);
assert.equal(
  writeDisplayPreferences(custom, {
    setItem() {
      throw new Error('denied');
    },
  }),
  false
);
const lines = Array.from({ length: 1000 }, (_, i) => ({
  time: i / 4,
  content: String(i),
}));
const window = buildLyricWindow(lines, 100, 10);
assert.ok(window.length <= 4096);
assert.equal(
  projectPresentation(
    { ...primary, lines: window, offset: -10, playing: false },
    0
  ).active,
  '360'
);
assert.equal(
  projectPresentation(
    { ...primary, lines: window, offset: 10, playing: false },
    0
  ).active,
  '440'
);
assert.ok(
  sanitizePresentation({ ...primary, lines: window }).lines.length > 32
);
const dense = Array.from({ length: 3000 }, (_, i) => ({
  time: i / 10,
  content: String(i),
}));
for (const masterOffset of [0, 10, -10]) {
  const context = buildLyricWindow(dense, 100, masterOffset);
  for (const [offset, want] of [
    [-10, '900'],
    [0, '1000'],
    [10, '1100'],
  ]) {
    assert.equal(
      projectPresentation(
        { ...primary, position: 100, playing: false, offset, lines: context },
        0
      ).active,
      want,
      `dense lyrics: master ${masterOffset}, follower ${offset}`
    );
  }
}
const advancing = buildLyricContext(dense, 100, 0);
assert.equal(
  projectPresentation(
    { ...primary, ...advancing, playing: true, offset: 10 },
    3
  ).active,
  '1130',
  'context includes the bounded playback extrapolation beyond local +10s offset'
);
const seeking = buildLyricContext(dense, 30, 10);
assert.equal(
  projectPresentation(
    { ...primary, ...seeking, position: 30, playing: false, offset: -10 },
    0
  ).active,
  '200'
);
const pathological = Array.from({ length: 30000 }, (_, i) => ({
  time: i / 1000,
  content: String(i),
}));
const clipped = buildLyricContext(pathological, 10, 0);
assert.ok(clipped.lines.length <= 4096);
assert.ok(
  Buffer.byteLength(JSON.stringify(clipped.lines), 'utf8') <= 192 * 1024 + 2
);
assert.equal(
  projectPresentation(
    { ...primary, ...clipped, position: 10, playing: false, offset: 0 },
    0
  ).active,
  '10000'
);
assert.equal(
  projectPresentation(
    { ...primary, ...clipped, position: 10, playing: false, offset: -10 },
    0
  ).state,
  'unavailable',
  'out-of-budget context must report unavailable, never silently show a wrong lyric'
);
console.log(
  'Display local preferences/storage/isolation/absolute timing/context tests passed'
);
