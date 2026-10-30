const assert = require('assert');
require('./helpers/register-babel-src');
const { loadEmotionBall, loadMoodMates } = require('../src/karaoke/moodMates');
const originalWindow = global.window;
const originalDocument = global.document;
const loaded = [];
let failOnce = true;
global.window = {};
global.document = {
  createElement: () => ({ remove() {} }),
  head: {
    appendChild(script) {
      loaded.push(script.src);
      setImmediate(() => {
        if (failOnce && script.src.endsWith('core/geometry.js')) {
          failOnce = false;
          script.onerror();
          return;
        }
        if (script.src.endsWith('emotion-ball/js/engine.js'))
          window.EmotionBall = { create() {} };
        if (script.src.endsWith('characters/twinkle.js'))
          window.MoodMates = {
            create() {},
            characters: { get: id => ['nimbo', 'twinkle'].includes(id) },
          };
        script.onload();
      });
    },
  },
};
(async () => {
  try {
    const initial = await Promise.allSettled([
      loadEmotionBall(),
      loadMoodMates(),
      loadMoodMates(),
    ]);
    assert.equal(initial[0].status, 'fulfilled');
    assert.equal(initial[1].status, 'rejected');
    assert.equal(initial[2].status, 'rejected');
    assert.equal(
      loaded.length,
      5,
      'same-library requests share one failing load'
    );
    assert.ok(loaded[3].endsWith('emotion-ball/js/engine.js'));
    assert.ok(
      loaded[4].endsWith('core/geometry.js'),
      'second seed loader waits for the first engine'
    );
    const [one, two] = await Promise.all([loadMoodMates(), loadMoodMates()]);
    assert.strictEqual(one, two);
    assert.equal(
      loaded.length,
      13,
      'retry is single-flight and loads all eight original scripts'
    );
    await Promise.all([loadEmotionBall(), loadMoodMates()]);
    assert.equal(loaded.length, 13, 'ready libraries do not reload');
    console.log(
      'Reaction loaders: seed isolation, single-flight, retry and cache passed'
    );
  } finally {
    global.window = originalWindow;
    global.document = originalDocument;
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
