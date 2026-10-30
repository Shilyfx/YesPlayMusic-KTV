const fs = require('fs');
const path = require('path');

const BUILD_IDENTITY_FILENAME = '.lumasing-build.json';
const LOCAL_KTV_BUILD_COMMAND = 'npm run build:local-ktv';

function createLocalKtvEnvironment(environment = {}) {
  return {
    ...environment,
    VUE_APP_DOCKER_KTV: 'true',
    VUE_APP_NETEASE_API_URL: '/api',
  };
}

function createBuildIdentity(environment = {}) {
  const dockerKtv = environment.VUE_APP_DOCKER_KTV === 'true';
  const apiBaseUrl = environment.VUE_APP_NETEASE_API_URL || '';
  const isDockerKtvBuild = dockerKtv && apiBaseUrl === '/api';
  return {
    schemaVersion: 1,
    variant: isDockerKtvBuild ? 'docker-ktv' : 'standard',
    dockerKtv,
    apiBaseUrl,
    webKtvDisplayOnly: dockerKtv,
  };
}

function createBuildIdentityPlugin(environment = {}) {
  return {
    apply(compiler) {
      const identityPath = path.join(
        compiler.options.output.path,
        BUILD_IDENTITY_FILENAME
      );
      const clearPreviousIdentity = () => {
        try {
          fs.unlinkSync(identityPath);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      };

      compiler.hooks.beforeRun.tap(
        'LumaSingBuildIdentityPlugin',
        clearPreviousIdentity
      );
      compiler.hooks.watchRun.tap(
        'LumaSingBuildIdentityPlugin',
        clearPreviousIdentity
      );
      compiler.hooks.done.tap('LumaSingBuildIdentityPlugin', stats => {
        if (stats.hasErrors()) return;
        fs.mkdirSync(path.dirname(identityPath), { recursive: true });
        fs.writeFileSync(
          identityPath,
          `${JSON.stringify(createBuildIdentity(environment), null, 2)}\n`,
          'utf8'
        );
      });
    },
  };
}

function validateLocalKtvArtifact(distPath) {
  const requiredFiles = [
    path.join(distPath, 'index.html'),
    path.join(distPath, 'remote', 'index.html'),
  ];
  if (requiredFiles.some(filePath => !fs.existsSync(filePath)))
    throw new Error(
      `Local KTV production files are missing. Run ${LOCAL_KTV_BUILD_COMMAND}.`
    );

  const identityPath = path.join(distPath, BUILD_IDENTITY_FILENAME);
  let identity;
  try {
    identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
  } catch (_) {
    throw new Error(
      `Local KTV build identity is missing or invalid. Run ${LOCAL_KTV_BUILD_COMMAND}.`
    );
  }

  if (
    identity.schemaVersion !== 1 ||
    identity.variant !== 'docker-ktv' ||
    identity.dockerKtv !== true ||
    identity.apiBaseUrl !== '/api' ||
    identity.webKtvDisplayOnly !== true
  ) {
    throw new Error(
      `Refusing local KTV preview: dist is not a Docker KTV build. ` +
        `Build it with ${LOCAL_KTV_BUILD_COMMAND}.`
    );
  }
  return identity;
}

module.exports = {
  BUILD_IDENTITY_FILENAME,
  createBuildIdentity,
  createBuildIdentityPlugin,
  createLocalKtvEnvironment,
  validateLocalKtvArtifact,
};
