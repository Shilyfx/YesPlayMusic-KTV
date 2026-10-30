const assert = require('assert');
const fs = require('fs');
const path = require('path');
require('./helpers/register-babel-src');
const {
  normalizeVisualConfig,
  normalizeVisualPatch,
} = require('../src/karaoke/visualConfig');
const { stageModeOptions } = require('../src/utils/lyricStageModes');
const {
  normalizeAppearanceConfig,
  backgroundOptionsForMode,
} = require('../src/karaoke/appearanceConfig');
const visualAssetId = 'a'.repeat(64);

const defaults = normalizeVisualConfig();
assert.deepStrictEqual(defaults, {
  version: 1,
  mode: 'classic',
  effect: 'gradient',
  fontSize: 45,
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
  random: {
    enabled: false,
    pool: stageModeOptions.map(mode => mode.value),
    lastTrackKey: '',
  },
  customTheme: null,
});

const nativeLegacyConfig = normalizeVisualConfig({
  mode: 'orbit',
  effect: 'neon',
  fontSize: 60,
  offset: -1.5,
  theme: 'dark',
});
assert.deepStrictEqual(
  {
    mode: nativeLegacyConfig.mode,
    effect: nativeLegacyConfig.effect,
    fontSize: nativeLegacyConfig.fontSize,
    offset: nativeLegacyConfig.offset,
    theme: nativeLegacyConfig.theme,
    background: nativeLegacyConfig.background,
  },
  {
    mode: 'orbit',
    effect: 'neon',
    fontSize: 60,
    offset: -1.5,
    theme: 'dark',
    background: {
      mode: 'legacy',
      tuning: {},
      assetId: null,
      transparent: false,
      opacity: 1,
    },
  },
  'existing native display preferences keep their values and appearance'
);

for (const { value } of stageModeOptions) {
  assert.strictEqual(
    normalizeVisualConfig({ mode: value }).mode,
    value,
    `existing stage mode ${value} remains available`
  );
}
assert.strictEqual(
  normalizeVisualConfig({ mode: 'not-a-renderer' }).mode,
  'classic'
);
assert.strictEqual(
  normalizeVisualConfig({ mode: 'folia-classic' }).mode,
  'folia-classic',
  'Folia classic is a distinct built-in mode beside native classic'
);
assert.strictEqual(
  normalizeVisualConfig(
    { mode: 'folia-classic' },
    {
      modeOptions: [{ value: 'folia-classic' }],
    }
  ).mode,
  'folia-classic',
  'a separately enabled Folia classic ID remains distinct from native classic'
);
assert.strictEqual(
  normalizeVisualConfig({ mode: 'orbit' }, { modeOptions: ['poem'] }).mode,
  'classic',
  'explicit mode options constrain renderer IDs'
);

assert.strictEqual(normalizeVisualConfig({ fontSize: 999 }).fontSize, 64);
assert.strictEqual(normalizeVisualConfig({ fontSize: -5 }).fontSize, 16);
assert.strictEqual(normalizeVisualConfig({ offset: 99 }).offset, 10);
assert.strictEqual(normalizeVisualConfig({ offset: -99 }).offset, -10);
assert.strictEqual(normalizeVisualConfig({ offset: 0.26 }).offset, 0.3);
assert.strictEqual(
  normalizeVisualConfig({ background: { opacity: 2 } }).background.opacity,
  1
);
assert.strictEqual(
  normalizeVisualConfig({ background: { opacity: -2 } }).background.opacity,
  0
);
assert.strictEqual(normalizeVisualConfig({}).fontSize, 45);
assert.strictEqual(normalizeVisualConfig({}).offset, 0);
assert.strictEqual(normalizeVisualConfig({ fontSize: NaN }).fontSize, 45);
assert.strictEqual(normalizeVisualConfig({ offset: NaN }).offset, 0);
assert.strictEqual(
  normalizeVisualConfig({ effect: 'unknown' }).effect,
  'gradient'
);
assert.strictEqual(
  normalizeVisualConfig({ animationIntensity: 'unknown' }).animationIntensity,
  'normal'
);

assert.strictEqual(
  normalizeVisualConfig({ background: { mode: 'nebula' } }).background.mode,
  'legacy'
);
assert.strictEqual(
  normalizeVisualConfig(
    { background: { mode: 'nebula' } },
    { backgroundModes: ['legacy', 'nebula'] }
  ).background.mode,
  'nebula',
  'only explicitly enabled background renderer IDs are accepted'
);

const current = {
  mode: 'poem',
  effect: 'outline',
  fontSize: 36,
  offset: 2.4,
  theme: 'light',
  animationIntensity: 'calm',
  background: {
    mode: 'nebula',
    tuning: { stars: 12, tint: '#abc123' },
    assetId: visualAssetId,
    transparent: true,
    opacity: 0.75,
  },
  tuningByMode: { poem: { lineGap: 1.4 }, orbit: { radius: 120 } },
  customTheme: { accent: '#abc123', text: '#123456' },
};
assert.strictEqual(
  normalizeVisualPatch(current, { offset: -1.5 }).offset,
  -1.5,
  'a patch offset replaces the saved offset instead of adding to it'
);
const currentSnapshot = JSON.stringify(current);
const patched = normalizeVisualPatch(
  current,
  { mode: 'orbit', background: { opacity: 0.4 } },
  { backgroundModes: ['legacy', 'nebula'] }
);
assert.strictEqual(patched.mode, 'orbit');
assert.strictEqual(patched.effect, 'outline');
assert.strictEqual(patched.fontSize, 36);
assert.strictEqual(patched.offset, 2.4);
assert.strictEqual(patched.theme, 'light');
assert.strictEqual(patched.animationIntensity, 'calm');
assert.deepStrictEqual(patched.tuningByMode, {
  poem: { lineGap: 1.4 },
  orbit: { radius: 120 },
});
assert.deepStrictEqual(patched.customTheme, {
  accent: '#abc123',
  text: '#123456',
});
assert.deepStrictEqual(patched.background, {
  mode: 'nebula',
  tuning: { stars: 12, tint: '#abc123' },
  assetId: visualAssetId,
  transparent: true,
  opacity: 0.4,
});
assert.strictEqual(
  JSON.stringify(current),
  currentSnapshot,
  'patching leaves current unchanged'
);

const original = {
  background: { tuning: { palette: ['#fff', 2] } },
  tuningByMode: { orbit: { radius: 42 } },
  customTheme: { background: '#000000' },
};
const originalSnapshot = JSON.stringify(original);
const copied = normalizeVisualConfig(original);
copied.background.tuning.palette.push('changed');
copied.tuningByMode.orbit.radius = 0;
copied.customTheme.background = '#ffffff';
assert.strictEqual(
  JSON.stringify(original),
  originalSnapshot,
  'normalization deep-copies nested data'
);

const unsafeTuning = JSON.parse(
  '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":{"polluted":true},"safe":1}'
);
const unsafeTuningByMode = JSON.parse(
  '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":{"polluted":true},"orbit":{"__proto__":{"polluted":true},"safe":1}}'
);
const malicious = {
  background: {
    tuning: unsafeTuning,
    assetId: 'https://example.test/image.png',
  },
  tuningByMode: unsafeTuningByMode,
};
const safe = normalizeVisualConfig(malicious);
assert.deepStrictEqual(safe.background.tuning, { safe: 1 });
assert.strictEqual(
  safe.background.assetId,
  null,
  'URL strings are not image asset IDs'
);
assert.deepStrictEqual(safe.tuningByMode, { orbit: { safe: 1 } });

const preservedAssetRefs = normalizeAppearanceConfig({
  background: { assetId: visualAssetId },
  tuningByMode: {
    monet: { portraitAssetId: visualAssetId },
    cappella: {
      emojiAssetIds: [visualAssetId, 'b'.repeat(64), 'bad-id'],
      avatarAssetIds: ['c'.repeat(64)],
    },
    tempera: {
      layerImageAssetIds: ['d'.repeat(64), 'e'.repeat(64), 'invalid'],
      layerImages: [
        { id: 'd'.repeat(64), name: '贴图', align: 'free', scale: 0.7 },
      ],
    },
  },
});
assert.equal(preservedAssetRefs.background.assetId, visualAssetId);
assert.equal(
  preservedAssetRefs.tuningByMode.monet.portraitAssetId,
  visualAssetId
);
assert.deepStrictEqual(preservedAssetRefs.tuningByMode.cappella.emojiAssetIds, [
  visualAssetId,
  'b'.repeat(64),
]);
assert.deepStrictEqual(
  preservedAssetRefs.tuningByMode.cappella.avatarAssetIds,
  ['c'.repeat(64)]
);
assert.equal(
  preservedAssetRefs.tuningByMode.tempera.layerImages[0].id,
  'd'.repeat(64)
);
assert.deepStrictEqual(
  preservedAssetRefs.tuningByMode.tempera.layerImageAssetIds,
  ['d'.repeat(64), 'e'.repeat(64)]
);
const boundedTemperaAssets = normalizeVisualConfig({
  tuningByMode: {
    tempera: {
      layerImageAssetIds: Array.from({ length: 20 }, (_, index) =>
        String(index).padStart(64, 'a')
      ),
      layerImages: Array.from({ length: 20 }, (_, index) => ({
        id: String(index).padStart(64, 'b'),
        name: `image-${index}`,
        align: 'free',
      })),
    },
  },
});
assert.strictEqual(
  boundedTemperaAssets.tuningByMode.tempera.layerImageAssetIds.length,
  16
);
assert.strictEqual(
  boundedTemperaAssets.tuningByMode.tempera.layerImages.length,
  16
);
assert.strictEqual(
  {}.polluted,
  undefined,
  'untrusted keys do not poison object prototypes'
);

const bounded = normalizeVisualConfig({
  background: {
    tuning: {
      finite: [null, false, 0, 'text'],
      nonFinite: Infinity,
      callback() {},
      node: new Date(0),
      imageUrl: 'data:image/png;base64,AA==',
      remoteImage: ' https://example.test/image.png ',
      large: 'x'.repeat(50000),
      many: Array.from({ length: 200 }, (_, index) => index),
      keyed: Object.fromEntries(
        Array.from({ length: 100 }, (_, index) => [`k${index}`, index])
      ),
    },
  },
});
assert.deepStrictEqual(bounded.background.tuning.finite, [
  null,
  false,
  0,
  'text',
]);
assert.strictEqual(bounded.background.tuning.nonFinite, undefined);
assert.strictEqual(bounded.background.tuning.callback, undefined);
assert.strictEqual(bounded.background.tuning.node, undefined);
assert.strictEqual(bounded.background.tuning.imageUrl, undefined);
assert.strictEqual(bounded.background.tuning.remoteImage, undefined);
assert.strictEqual(bounded.background.tuning.large, undefined);
assert.ok(bounded.background.tuning.many.length <= 64);
assert.ok(Object.keys(bounded.background.tuning.keyed).length <= 64);
assert.ok(
  Buffer.byteLength(JSON.stringify(bounded.background.tuning), 'utf8') <=
    16 * 1024,
  'normalized tuning snapshots stay within their total-size budget'
);
const combinedSnapshots = normalizeVisualConfig({
  background: { tuning: { image: 'x'.repeat(1500) } },
  tuningByMode: { classic: { image: 'y'.repeat(1500) } },
});
assert.ok(
  Buffer.byteLength(
    JSON.stringify({
      background: combinedSnapshots.background.tuning,
      tuningByMode: combinedSnapshots.tuningByMode,
    }),
    'utf8'
  ) <=
    16 * 1024,
  'the size budget is shared across background and per-mode snapshots'
);

function instrumentedKeyProxy(count) {
  const keys = Array.from({ length: count }, (_, index) => `key${index}`);
  const observations = { ownKeysCalls: 0, descriptorChecks: 0, valueReads: 0 };
  const value = new Proxy(
    {},
    {
      ownKeys() {
        observations.ownKeysCalls += 1;
        // Proxy ownKeys must return its key list; the test does not claim to
        // bound work performed inside that trap or by the JavaScript engine.
        return keys;
      },
      getOwnPropertyDescriptor() {
        observations.descriptorChecks += 1;
        return { configurable: true, enumerable: true };
      },
      get(_target, key) {
        observations.valueReads += 1;
        return key;
      },
    }
  );
  return { value, observations, keyCount: count };
}

const oversizedTuning = instrumentedKeyProxy(2048);
const cappedTuning = normalizeVisualConfig({
  background: { tuning: oversizedTuning.value },
}).background.tuning;
assert.strictEqual(Object.keys(cappedTuning).length, 64);
assert.ok(
  oversizedTuning.observations.descriptorChecks <= 65 * 4,
  'tuning enumeration inspects only the configured limit plus a small overflow allowance'
);
assert.ok(
  oversizedTuning.observations.descriptorChecks < oversizedTuning.keyCount,
  'tuning enumeration does not inspect every supplied key descriptor'
);

const oversizedModeMap = instrumentedKeyProxy(2048);
assert.deepStrictEqual(
  normalizeVisualConfig({ tuningByMode: oversizedModeMap.value }).tuningByMode,
  {}
);
assert.ok(
  oversizedModeMap.observations.descriptorChecks <= 65 * 4,
  'per-mode tuning enumeration stops after its 64-key cap plus overflow detection'
);

const oversizedTheme = instrumentedKeyProxy(2048);
assert.strictEqual(
  normalizeVisualConfig({ customTheme: oversizedTheme.value }).customTheme,
  null
);
assert.ok(
  oversizedTheme.observations.descriptorChecks <= 17 * 3,
  'custom theme overflow is detected after its limit plus one key'
);
assert.strictEqual(
  oversizedTheme.observations.valueReads,
  0,
  'an oversized custom theme is rejected before reading color values'
);

let deep = { leaf: 'kept only within the depth bound' };
for (let index = 0; index < 20; index += 1) deep = { child: deep };
const deepSafe = normalizeVisualConfig({ background: { tuning: deep } });
let cursor = deepSafe.background.tuning;
let depth = 0;
while (cursor && typeof cursor === 'object' && !Array.isArray(cursor)) {
  depth += 1;
  cursor = cursor.child;
}
assert.ok(
  depth <= 7,
  'deep tuning input is truncated at the documented depth bound'
);

const cyclic = { label: 'cycle-safe' };
cyclic.self = cyclic;
assert.doesNotThrow(() =>
  normalizeVisualConfig({ background: { tuning: cyclic } })
);
const cycleSafe = normalizeVisualConfig({ background: { tuning: cyclic } });
assert.doesNotThrow(() => JSON.stringify(cycleSafe));
assert.strictEqual(cycleSafe.background.tuning.label, 'cycle-safe');
assert.strictEqual(cycleSafe.background.tuning.self, undefined);
const throwingValue = {};
Object.defineProperty(throwingValue, 'mode', {
  enumerable: true,
  get() {
    throw new Error('corrupt persisted getter');
  },
});
assert.doesNotThrow(() => normalizeVisualConfig(throwingValue));
assert.doesNotThrow(() => normalizeVisualConfig({ fontSize: Symbol('bad') }));

const badTheme = normalizeVisualConfig({
  customTheme: { background: '#000000', invalid: 'red' },
});
assert.strictEqual(
  badTheme.customTheme,
  null,
  'custom themes reject non-hex colors as a whole'
);
assert.deepStrictEqual(
  normalizeVisualConfig({
    customTheme: { background: '#000000', accent: '#abcd' },
  }).customTheme,
  { background: '#000000', accent: '#abcd' }
);

const mergedModeSettings = normalizeVisualPatch(
  current,
  { background: { tuning: { stars: 20 } }, followStyle: false },
  { backgroundModes: ['legacy', 'nebula'] }
);
assert.deepStrictEqual(mergedModeSettings.background, {
  mode: 'nebula',
  tuning: { stars: 20 },
  assetId: visualAssetId,
  transparent: true,
  opacity: 0.75,
});
assert.strictEqual(mergedModeSettings.followStyle, undefined);

const appearance = normalizeAppearanceConfig({
  mode: 'tilt',
  animationIntensity: 'chaotic',
  background: {
    mode: 'common',
    assetId: 'blob:https://example.test/id',
    tuning: {
      palette: '#ea580c',
      source: 'blob:https://example.test/cover',
      imageData: 'A'.repeat(128),
    },
  },
  tuningByMode: {
    tilt: { rotation: 12, payload: 'data:image/png;base64,AA==' },
  },
});
assert.equal(appearance.mode, 'tilt');
assert.equal(appearance.animationIntensity, 'chaotic');
assert.equal(appearance.background.mode, 'common');
assert.equal(appearance.background.assetId, null);
assert.deepStrictEqual(appearance.background.tuning, { palette: '#ea580c' });
assert.deepStrictEqual(appearance.tuningByMode, { tilt: { rotation: 12 } });
assert.deepStrictEqual(
  backgroundOptionsForMode('tilt').map(option => option.value),
  ['legacy', 'common', 'monet', 'nomand', 'latent', 'url', 'sora']
);
const nonTiltAppearance = normalizeAppearanceConfig({
  mode: 'classic',
  animationIntensity: 'chaotic',
  background: { mode: 'common' },
});
assert.equal(
  nonTiltAppearance.background.mode,
  'common',
  'a hidden background choice remains stored when the stage mode changes'
);
assert.equal(
  nonTiltAppearance.animationIntensity,
  'chaotic',
  'hiding an unsupported intensity control does not reset its stored value'
);
for (const mode of [
  'classic',
  'poem',
  'depth',
  'orbit',
  'sonnet',
  'tempera',
  'hanabi',
])
  assert.deepStrictEqual(
    backgroundOptionsForMode(mode).map(option => option.value),
    ['legacy', 'common', 'monet', 'nomand', 'latent', 'url', 'sora'],
    `${mode} can choose an independent background`
  );
assert.deepStrictEqual(
  backgroundOptionsForMode('still'),
  [],
  'Still hides the background because its original renderer draws none'
);
const boundedAppearance = normalizeAppearanceConfig({
  background: { tuning: { data: 'x'.repeat(16000) } },
  tuningByMode: { tilt: { data: 'y'.repeat(16000) } },
});
assert.ok(
  Buffer.byteLength(JSON.stringify(boundedAppearance), 'utf8') <= 16 * 1024,
  'complete normalized appearance stays within 16 KiB'
);

// Cross the actual appearance cap with valid URLs and refs after optional mode data.
const capInput = {
  mode: 'sonnet',
  background: {
    mode: 'url',
    assetId: 'a'.repeat(64),
    tuning: {
      items: Array.from({ length: 8 }, (_, index) => ({
        id: `url-${index}`,
        url: `https://example.test/${index}?q=${'x'.repeat(1900)}`,
      })),
      selectedId: 'url-7',
    },
  },
  tuningByMode: {
    tilt: {
      optionalText: 'optional!'.repeat(1100),
      breathingFloatMultiplier: 1.4,
    },
    sonnet: { cameraIntensity: 1.4, postProcessEnabled: false },
    monet: { portraitAssetId: 'b'.repeat(64), portraitSource: 'custom' },
    cappella: {
      emojiAssetIds: ['c'.repeat(64)],
      avatarAssetIds: ['d'.repeat(64)],
      emojiPackSource: 'custom',
      avatarSource: 'custom',
    },
    tempera: {
      layerImageAssetIds: ['e'.repeat(64)],
      layerImages: [
        {
          id: 'e'.repeat(64),
          name: '保留贴图',
          align: 'left',
          verticalAlign: 'bottom',
          scale: 0.9,
          opacity: 0.6,
        },
      ],
    },
  },
};
const capBefore = JSON.stringify(capInput);
const capNotices = [];
const capResult = normalizeAppearanceConfig(capInput, {
  onTrim: notice => capNotices.push(notice),
});
assert.ok(Buffer.byteLength(JSON.stringify(capResult), 'utf8') <= 16 * 1024);
assert.strictEqual(
  JSON.stringify(capInput),
  capBefore,
  'cap handling never mutates stored input'
);
assert.deepStrictEqual(
  capResult.tuningByMode.sonnet,
  capInput.tuningByMode.sonnet
);
for (const mode of ['monet', 'cappella', 'tempera'])
  assert.deepStrictEqual(
    capResult.tuningByMode[mode],
    capInput.tuningByMode[mode]
  );
assert.equal(capResult.background.assetId, capInput.background.assetId);
assert.equal(capResult.background.tuning.selectedId, 'url-7');
assert.deepStrictEqual(
  capResult.background.tuning.items.find(item => item.id === 'url-7'),
  capInput.background.tuning.items[7]
);
assert.ok(
  capNotices.length &&
    capNotices[0].removedPaths[0].startsWith('tuningByMode.tilt.'),
  'optional other-mode tuning is trimmed before background URLs'
);
assert.ok(
  capNotices[0].removedPaths.some(key =>
    key.startsWith('background.tuning.items.')
  ),
  'only unselected URL entries are trimmed when still necessary'
);
const essentialInput = {
  mode: 'sonnet',
  tuningByMode: { sonnet: { note: '当前!'.repeat(3000) } },
};
const essentialBefore = JSON.stringify(essentialInput);
assert.throws(
  () => normalizeAppearanceConfig(essentialInput),
  error => error.code === 'APPEARANCE_CONFIG_TOO_LARGE'
);
assert.equal(
  JSON.stringify(essentialInput),
  essentialBefore,
  'an invalid essential configuration is rejected without changing its fields'
);
const largeOptional = {
  ...capInput,
  tuningByMode: {
    ...capInput.tuningByMode,
    monet: {
      optionalA: 'optional!'.repeat(1200),
      optionalB: 'optional!'.repeat(1200),
      optionalC: 'optional!'.repeat(1200),
      ...capInput.tuningByMode.monet,
    },
  },
};
const candidateNotices = [];
const prioritized = normalizeAppearanceConfig(largeOptional, {
  onTrim: notice => candidateNotices.push(notice),
});
assert.equal(
  prioritized.tuningByMode.monet.portraitAssetId,
  'b'.repeat(64),
  'optional data exhausting a candidate budget cannot consume an asset reservation'
);
assert.equal(prioritized.background.tuning.selectedId, 'url-7');
assert.ok(
  candidateNotices[0].removedPaths.some(key =>
    key.startsWith('tuningByMode.monet.optional')
  )
);
const {
  normalizeAppearancePatch,
  writeMasterAppearancePreferences,
  readMasterAppearancePreferences,
} = require('../src/karaoke/appearanceConfig');
const stableConfig = normalizeAppearanceConfig({ mode: 'sonnet' });
const stableBefore = JSON.stringify(stableConfig);
assert.throws(
  () => normalizeAppearancePatch(stableConfig, essentialInput),
  error => error.code === 'APPEARANCE_CONFIG_TOO_LARGE'
);
assert.equal(JSON.stringify(stableConfig), stableBefore);
let storedAppearance = JSON.stringify(essentialInput);
const appearanceStorage = {
  getItem: () => storedAppearance,
  setItem: (_key, value) => {
    storedAppearance = value;
  },
};
assert.equal(
  writeMasterAppearancePreferences(essentialInput, appearanceStorage),
  false
);
assert.equal(
  storedAppearance,
  essentialBefore,
  'a rejected write leaves every stored field untouched'
);
let invalidNotice;
readMasterAppearancePreferences(appearanceStorage, {
  onInvalid: error => {
    invalidNotice = error.code;
  },
});
assert.equal(invalidNotice, 'APPEARANCE_CONFIG_TOO_LARGE');
assert.equal(
  storedAppearance,
  essentialBefore,
  'invalid storage is reported and never overwritten with defaults'
);
const {
  normalizeDisplayPreferences,
} = require('../src/karaoke/displayPreferences');
const boundedFollower = normalizeDisplayPreferences(capInput);
assert.ok(
  Buffer.byteLength(JSON.stringify(boundedFollower), 'utf8') <= 16 * 1024,
  'follower follow flags are included in the complete byte cap'
);
assert.equal(boundedFollower.background.tuning.selectedId, 'url-7');

const readSource = relativePath =>
  fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
const masterView = readSource('src/views/karaoke.vue');
const followerView = readSource('src/views/karaokeWeb.vue');
assert.ok(
  /controlPanelCapabilities\(\)\s*\{\s*return\s*\{[^}]*intensity:\s*supportsAnimationIntensity\(this\.lyricStageMode\)/.test(
    masterView
  ),
  'the master exposes animation intensity only for source-supported modes'
);
assert.ok(
  /controlCapabilities\(\)\s*\{\s*return\s*\{[^}]*intensity:\s*supportsAnimationIntensity\(this\.presentation\.mode\)/.test(
    followerView
  ),
  'the follower exposes animation intensity only for source-supported modes'
);
const { supportsAnimationIntensity } = require('../src/utils/lyricStageModes');
assert.equal(supportsAnimationIntensity('tilt'), false);
assert.equal(supportsAnimationIntensity('still'), false);
assert.equal(supportsAnimationIntensity('sonnet'), true);
assert.ok(
  /\.folia-complete-host \.blur-\\\[1px\\\] \{\s*filter:\s*blur\(1px\);\s*\}/.test(
    readSource('src/karaoke/folia/complete.css')
  ),
  'the one-pixel preview blur utility is scoped to the Folia host'
);

console.log(
  'Karaoke visual config compatibility, patching, validation, and bounds tests passed'
);
