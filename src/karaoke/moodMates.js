// Both original engines consume EMOTION_SEED during initialization.
// Serialize complete library loads so their different seed formats cannot race.
const definitions = {
  ball: {
    global: 'EmotionBall',
    base: '/reactions/emotion-ball/js/',
    paths: ['rings.js', 'emotions.js', 'ball.js', 'engine.js'],
  },
  mates: {
    global: 'MoodMates',
    base: '/reactions/mood-mates/src/',
    paths: [
      'core/geometry.js',
      'core/render.js',
      'core/features.js',
      'core/fx.js',
      'data/emotions.js',
      'core/engine.js',
      'characters/nimbo.js',
      'characters/twinkle.js',
    ],
  },
};
const pending = new Map();
let serial = Promise.resolve();
function ready(key) {
  const library = window[definitions[key].global];
  return library?.create &&
    (key === 'ball' ||
      (library.characters?.get?.('nimbo') &&
        library.characters?.get?.('twinkle')))
    ? library
    : null;
}
function loadLibrary(key) {
  if (ready(key)) return Promise.resolve(ready(key));
  if (!pending.has(key)) {
    const definition = definitions[key];
    const operation = serial.then(() => {
      if (ready(key)) return ready(key);
      return definition.paths
        .reduce(
          (previous, path) =>
            previous.then(
              () =>
                new Promise((resolve, reject) => {
                  const script = document.createElement('script');
                  script.src = definition.base + path;
                  script.onload = resolve;
                  script.onerror = () => {
                    script.remove();
                    reject(new Error('角色加载失败'));
                  };
                  document.head.appendChild(script);
                })
            ),
          Promise.resolve()
        )
        .then(() => {
          if (!ready(key)) throw new Error('角色引擎初始化失败');
          return ready(key);
        });
    });
    serial = operation.catch(() => {});
    pending.set(
      key,
      operation.catch(error => {
        pending.delete(key);
        throw error;
      })
    );
  }
  return pending.get(key);
}
export function loadEmotionBall() {
  return loadLibrary('ball');
}
export function loadMoodMates() {
  return loadLibrary('mates');
}
