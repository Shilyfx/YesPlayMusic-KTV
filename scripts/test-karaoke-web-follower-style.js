const assert = require('assert');
const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');
const { parseComponent } = require('vue-template-compiler');

require('./helpers/register-babel-src');

const root = path.resolve(__dirname, '..');
const preferences = require('../src/karaoke/displayPreferences');

function loadKaraokeWebOptions() {
  const filename = path.join(root, 'src/views/karaokeWeb.vue');
  const descriptor = parseComponent(fs.readFileSync(filename, 'utf8'));
  const compiled = babel.transformSync(descriptor.script.content, {
    filename,
    presets: ['@vue/cli-plugin-babel/preset'],
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  }).code;
  const module = { exports: {} };
  const componentRequire = request => {
    if (request === '@/karaoke/displayPreferences') return preferences;
    if (
      request.startsWith('@babel/runtime/') ||
      request.includes('@babel/runtime/helpers/')
    )
      return require('@babel/runtime/helpers/interopRequireDefault');
    return {};
  };

  new Function('require', 'module', 'exports', compiled)(
    componentRequire,
    module,
    module.exports
  );
  return module.exports.default;
}

function testFollowerStyleChangesApplyWhenStorageIsUnavailable() {
  const storageDescriptor = Object.getOwnPropertyDescriptor(
    global,
    'localStorage'
  );
  Object.defineProperty(global, 'localStorage', {
    configurable: true,
    value: {
      setItem() {
        throw new Error('storage unavailable');
      },
    },
  });

  try {
    const options = loadKaraokeWebOptions();
    const messages = [];
    const context = {
      preferences: preferences.normalizeDisplayPreferences({
        followStyle: true,
      }),
      presentation: { theme: 'light' },
      state: {
        presentation: { mode: 'orbit', effect: 'neon', fontSize: 60 },
      },
      remoteAppearance: null,
      preferenceMessage: '',
      visualAssetUploads: null,
      settingsCloseTimer: null,
      $store: { dispatch: (...args) => messages.push(args) },
      updatePreference(key, value) {
        return options.methods.updatePreference.call(this, key, value);
      },
    };

    options.methods.handleControlFollow.call(context, {
      key: 'style',
      value: false,
    });
    assert.strictEqual(
      context.preferences.followStyle,
      false,
      'turning off follow style updates the active local preference'
    );
    assert.strictEqual(
      options.computed.controlFollows.call(context).style,
      false,
      'the follower controls unlock after follow style is disabled'
    );

    options.methods.handleControlChange.call(context, {
      key: 'mode',
      value: 'poem',
    });
    assert.strictEqual(
      options.computed.presentation.call(context).mode,
      'poem',
      'the follower renders its normalized local lyric style'
    );
    assert.match(context.preferenceMessage, /本次设置仍然生效/);
    assert.strictEqual(messages.length, 0);
  } finally {
    if (storageDescriptor)
      Object.defineProperty(global, 'localStorage', storageDescriptor);
    else delete global.localStorage;
  }
}

function testFullscreenStageAndControlPlacementContracts() {
  const readStyle = relativePath => {
    const filename = path.join(root, relativePath);
    return parseComponent(fs.readFileSync(filename, 'utf8')).styles[0].content;
  };
  const mainView = fs.readFileSync(
    path.join(root, 'src/views/karaoke.vue'),
    'utf8'
  );
  const mainStyle = readStyle('src/views/karaoke.vue');
  const followerStyle = readStyle('src/views/karaokeWeb.vue');
  const toggleStyle = readStyle(
    'src/components/karaoke/KaraokeControlToggle.vue'
  );

  assert.match(
    mainStyle,
    /\.stage:fullscreen,\s*\.stage:-webkit-full-screen[\s\S]*?padding:\s*0;/,
    'the master fullscreen stage must have no inset padding'
  );
  assert.match(
    followerStyle,
    /\.is-fullscreen \.display-stage\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*padding:\s*0;/,
    'the follower fullscreen stage must cover its viewport'
  );
  assert.match(
    followerStyle,
    /\.next-track\s*\{[^}]*bottom:\s*16px;/,
    'the follower next-song card shares the settings control baseline'
  );
  assert.match(
    followerStyle,
    /\.display-screen ::v-deep \.ktv-control-toggle\s*\{[^}]*bottom:\s*16px;/,
    'the follower settings toggle uses the same desktop baseline'
  );
  assert.match(
    followerStyle,
    /\.next-track\s*\{[^}]*bottom:\s*calc\(12px \+ env\(safe-area-inset-bottom, 0px\)\);/,
    'the follower next-song card respects the mobile safe area'
  );
  assert.match(
    followerStyle,
    /\.display-screen ::v-deep \.ktv-control-toggle\s*\{[^}]*bottom:\s*calc\(12px \+ env\(safe-area-inset-bottom, 0px\)\);/,
    'the follower settings toggle shares the mobile safe-area baseline'
  );
  assert.match(
    mainView,
    /<footer[^>]*class="karaoke-controls[\s\S]*?<KaraokeControlToggle[\s\S]*?class="karaoke-control-toggle--bar"[\s\S]*?<\/footer>/,
    'the master settings toggle is docked inside the bottom control bar'
  );
  assert.match(
    toggleStyle,
    /\.ktv-control-toggle\.karaoke-control-toggle--bar\s*\{[^}]*position:\s*absolute;[^}]*right:\s*16px;[^}]*top:\s*0;[^}]*bottom:\s*0;[^}]*margin:\s*auto 0;/,
    'the master settings toggle is inset from the control bar edges'
  );
}

testFollowerStyleChangesApplyWhenStorageIsUnavailable();
testFullscreenStageAndControlPlacementContracts();
console.log(
  'Karaoke web follower style and fullscreen layout regressions passed'
);
