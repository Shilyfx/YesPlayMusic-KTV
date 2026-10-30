const assert = require('assert');
const path = require('path');
const Module = require('module');
const buildPolicy = require('./build-folia-pv.cjs');

const root = path.resolve(__dirname, '..');

function loadVueConfig(command, nodeEnv) {
  const configPath = path.join(root, 'vue.config.js');
  const originalArgv = process.argv;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalLoad = Module._load;
  const calls = [];
  process.argv = [
    process.execPath,
    path.join(root, 'node_modules/@vue/cli-service/bin/vue-cli-service.js'),
    command,
  ];
  process.env.NODE_ENV = nodeEnv;
  delete require.cache[configPath];
  Module._load = function load(request, parent, isMain) {
    if (
      request === './scripts/build-folia-pv.cjs' &&
      parent.filename === configPath
    )
      return {
        ...buildPolicy,
        buildFoliaPv: options => calls.push(options),
      };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    require(configPath);
    return calls;
  } finally {
    Module._load = originalLoad;
    process.argv = originalArgv;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    delete require.cache[configPath];
  }
}

assert.equal(
  buildPolicy.shouldAcquireFoliaModels({
    nodeEnv: 'production',
    command: 'build',
  }),
  true,
  'production app builds must acquire both verified analysis models'
);
assert.equal(
  buildPolicy.shouldAcquireFoliaModels({
    nodeEnv: 'production',
    command: 'electron:build',
  }),
  true,
  'production Electron packaging must acquire verified analysis models'
);
assert.equal(
  buildPolicy.shouldAcquireFoliaModels({
    nodeEnv: 'production',
    command: 'serve',
  }),
  false,
  'serve must not require model mirrors even in production mode'
);
assert.equal(
  buildPolicy.shouldAcquireFoliaModels({
    nodeEnv: 'production',
    command: 'electron:serve',
  }),
  false,
  'Electron development serve must not require model mirrors'
);
assert.equal(
  buildPolicy.shouldAcquireFoliaModels({
    nodeEnv: 'production',
    command: 'lint',
  }),
  false,
  'lint must not require model mirrors even in production mode'
);

const acquisitionCalls = [];
buildPolicy.prepareFoliaModelsForBuild({
  root,
  requireModels: false,
  run: (...args) => acquisitionCalls.push(args),
});
assert.equal(
  acquisitionCalls.length,
  0,
  'development policy skips model acquisition'
);
buildPolicy.prepareFoliaModelsForBuild({
  root,
  run: (...args) => acquisitionCalls.push(args),
});
assert.equal(
  acquisitionCalls.length,
  1,
  'the default and direct CLI policy stays strict'
);
assert.equal(
  path.basename(acquisitionCalls[0][1][0]),
  'fetch-folia-models.cjs',
  'strict packaging runs the existing model verifier and publisher'
);

assert.deepEqual(loadVueConfig('serve', 'production'), [
  { requireModels: false },
]);
assert.deepEqual(loadVueConfig('electron:serve', 'production'), [
  { requireModels: false },
]);
assert.deepEqual(loadVueConfig('lint', 'production'), [
  { requireModels: false },
]);
assert.deepEqual(loadVueConfig('build', 'production'), [
  { requireModels: true },
]);
assert.deepEqual(loadVueConfig('electron:build', 'production'), [
  { requireModels: true },
]);

console.log(
  'Folia model acquisition is gated by actual Vue CLI command and build policy'
);
