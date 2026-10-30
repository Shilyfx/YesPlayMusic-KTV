const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

require('./helpers/register-babel-src');

const root = path.resolve(__dirname, '..');
const packageConfig = require('../package.json');
const buildPolicy = require('./local-ktv-build.cjs');
const localKtvBuilder = require('./build-local-ktv.cjs');
const { assertLocalKtvPreviewBuild } = require('./serve-local-ktv.cjs');

assert.equal(
  packageConfig.scripts['build:local-ktv'],
  'node scripts/build-local-ktv.cjs',
  'the explicit local KTV build command is registered'
);

assert.deepEqual(
  buildPolicy.createLocalKtvEnvironment({
    VUE_APP_DOCKER_KTV: 'false',
    VUE_APP_NETEASE_API_URL: 'https://wrong.example/api',
  }),
  {
    VUE_APP_DOCKER_KTV: 'true',
    VUE_APP_NETEASE_API_URL: '/api',
  },
  'local KTV builds override inherited renderer-worker build flags'
);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumasing-local-ktv-'));
const dist = path.join(tempRoot, 'dist');
fs.mkdirSync(path.join(dist, 'remote'), { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), '<main>app</main>');
fs.writeFileSync(
  path.join(dist, 'remote', 'index.html'),
  '<main>remote</main>'
);
const launcherRoot = path.join(tempRoot, 'launcher');
const launcherDist = path.join(launcherRoot, 'dist');
fs.mkdirSync(path.join(launcherDist, 'remote'), { recursive: true });
fs.writeFileSync(path.join(launcherDist, 'index.html'), '<main>app</main>');
fs.writeFileSync(
  path.join(launcherDist, 'remote', 'index.html'),
  '<main>remote</main>'
);
const buildInvocations = [];
assert.equal(
  localKtvBuilder.main({
    environment: {
      VUE_APP_DOCKER_KTV: 'false',
      VUE_APP_NETEASE_API_URL: 'https://wrong.example/api',
    },
    projectRoot: launcherRoot,
    execute(command, args, environment) {
      buildInvocations.push({ command, args, environment });
      if (args[0].endsWith('vue-cli-service.js'))
        fs.writeFileSync(
          path.join(launcherDist, buildPolicy.BUILD_IDENTITY_FILENAME),
          JSON.stringify(buildPolicy.createBuildIdentity(environment))
        );
      return 0;
    },
  }),
  0,
  'the explicit build command validates the generated local artifact'
);
assert.equal(
  buildInvocations.length,
  2,
  'build then remote asset isolation run'
);
assert.equal(buildInvocations[0].args[1], 'build');
assert.equal(buildInvocations[0].environment.VUE_APP_DOCKER_KTV, 'true');
assert.equal(buildInvocations[0].environment.VUE_APP_NETEASE_API_URL, '/api');
assert.equal(
  path.basename(buildInvocations[1].args[0]),
  'isolate-remote-assets.js'
);

function hook() {
  return {
    tap(_name, callback) {
      this.callback = callback;
    },
  };
}

function runBuildPlugin(environment, hasErrors = false) {
  const compiler = {
    options: { output: { path: dist } },
    hooks: { beforeRun: hook(), watchRun: hook(), done: hook() },
  };
  buildPolicy.createBuildIdentityPlugin(environment).apply(compiler);
  compiler.hooks.beforeRun.callback();
  compiler.hooks.done.callback({ hasErrors: () => hasErrors });
}

const markerPath = path.join(dist, buildPolicy.BUILD_IDENTITY_FILENAME);
fs.writeFileSync(markerPath, '{"variant":"old-local-build"}');
runBuildPlugin(buildPolicy.createLocalKtvEnvironment({}));
assert.deepEqual(
  JSON.parse(fs.readFileSync(markerPath, 'utf8')),
  buildPolicy.createBuildIdentity(buildPolicy.createLocalKtvEnvironment({})),
  'successful builds replace the marker with the actual build environment'
);
assert.deepEqual(
  buildPolicy.validateLocalKtvArtifact(dist),
  buildPolicy.createBuildIdentity(buildPolicy.createLocalKtvEnvironment({})),
  'the local preview accepts the intended KTV artifact'
);
assert.deepEqual(
  assertLocalKtvPreviewBuild(tempRoot),
  buildPolicy.createBuildIdentity(buildPolicy.createLocalKtvEnvironment({})),
  'the local server startup guard accepts the verified artifact'
);

runBuildPlugin({
  VUE_APP_DOCKER_KTV: 'false',
  VUE_APP_NETEASE_API_URL: '/api',
});
assert.throws(
  () => buildPolicy.validateLocalKtvArtifact(dist),
  /not a Docker KTV build/i,
  'a later unflagged renderer build invalidates the local KTV preview artifact'
);
assert.throws(
  () => assertLocalKtvPreviewBuild(tempRoot),
  /not a Docker KTV build/i,
  'the actual local server startup guard rejects an overwritten artifact'
);

runBuildPlugin(buildPolicy.createLocalKtvEnvironment({}), true);
assert.equal(
  fs.existsSync(markerPath),
  false,
  'failed builds cannot leave a stale success marker'
);
assert.throws(
  () => buildPolicy.validateLocalKtvArtifact(dist),
  /build identity is missing/i,
  'the local preview rejects artifacts without a successful build marker'
);

function loadVueConfig(command) {
  const configPath = path.join(root, 'vue.config.js');
  const originalArgv = process.argv;
  const originalLoad = Module._load;
  const originalFlags = {
    NODE_ENV: process.env.NODE_ENV,
    VUE_APP_DOCKER_KTV: process.env.VUE_APP_DOCKER_KTV,
    VUE_APP_NETEASE_API_URL: process.env.VUE_APP_NETEASE_API_URL,
  };
  process.argv = [
    process.execPath,
    path.join(root, 'node_modules/@vue/cli-service/bin/vue-cli-service.js'),
    command,
  ];
  process.env.NODE_ENV = 'production';
  process.env.VUE_APP_DOCKER_KTV = 'true';
  process.env.VUE_APP_NETEASE_API_URL = '/api';
  delete require.cache[configPath];
  Module._load = function load(request, parent, isMain) {
    if (
      request === './scripts/build-folia-pv.cjs' &&
      parent.filename === configPath
    )
      return {
        buildFoliaPv() {},
        shouldAcquireFoliaModels() {
          return false;
        },
      };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(configPath);
  } finally {
    Module._load = originalLoad;
    process.argv = originalArgv;
    Object.entries(originalFlags).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    delete require.cache[configPath];
  }
}

assert.equal(
  loadVueConfig('build').configureWebpack.plugins.length,
  1,
  'Vue production builds install the artifact identity plugin'
);
assert.equal(
  loadVueConfig('electron:build').configureWebpack.plugins.length,
  1,
  'Electron production builds also invalidate prior output identities'
);
const servePlugins = loadVueConfig('serve').configureWebpack.plugins;
assert.equal(
  servePlugins ? servePlugins.length : 0,
  0,
  'development serve does not write a production artifact identity'
);

if (fs.rmSync) fs.rmSync(tempRoot, { recursive: true, force: true });
else fs.rmdirSync(tempRoot, { recursive: true });
console.log('Local KTV build identity tests passed');
