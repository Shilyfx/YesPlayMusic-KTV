const path = require('path');
const { spawnSync } = require('child_process');
const {
  createLocalKtvEnvironment,
  validateLocalKtvArtifact,
} = require('./local-ktv-build.cjs');

const root = path.resolve(__dirname, '..');

function run(command, args, environment) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: environment,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  return result.status === null ? 1 : result.status;
}

function main({
  environment: inheritedEnvironment,
  execute,
  projectRoot,
} = {}) {
  const buildRoot = projectRoot || root;
  const runCommand = execute || run;
  const environment = createLocalKtvEnvironment(
    inheritedEnvironment || process.env
  );
  const vueCli = require.resolve('@vue/cli-service/bin/vue-cli-service.js');
  const buildStatus = runCommand(
    process.execPath,
    [vueCli, 'build'],
    environment
  );
  if (buildStatus !== 0) return buildStatus;

  const isolateScript = path.join(__dirname, 'isolate-remote-assets.js');
  const isolateStatus = runCommand(
    process.execPath,
    [isolateScript],
    environment
  );
  if (isolateStatus !== 0) return isolateStatus;

  validateLocalKtvArtifact(path.join(buildRoot, 'dist'));
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { main };
