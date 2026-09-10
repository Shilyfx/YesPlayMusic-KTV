const Module = require('module');
const path = require('path');
const babel = require('@babel/core');

const root = path.resolve(__dirname, '../..');
const srcRoot = path.join(root, 'src');
const originalResolve = Module._resolveFilename;
const originalJsLoader = require.extensions['.js'];

if (!Module._lumaSingAliasResolver) {
  Module._resolveFilename = function resolveLumaSingAlias(
    request,
    parent,
    isMain,
    options
  ) {
    if (request.startsWith('@/')) {
      return originalResolve(
        path.join(srcRoot, request.slice(2)),
        parent,
        isMain,
        options
      );
    }
    return originalResolve(request, parent, isMain, options);
  };
  Module._lumaSingAliasResolver = true;
}

function isSourceFile(filename) {
  const relative = path.relative(srcRoot, filename);
  return (
    relative &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !filename.includes(`${path.sep}node_modules${path.sep}`)
  );
}

if (!require.extensions['.js']._lumaSingBabelLoader) {
  const transpileSrc = function transpileSrc(module, filename) {
    if (!isSourceFile(filename)) return originalJsLoader(module, filename);
    const result = babel.transformFileSync(filename, {
      presets: ['@vue/cli-plugin-babel/preset'],
      plugins: ['@babel/plugin-transform-modules-commonjs'],
    });
    module._compile(result.code, filename);
  };
  transpileSrc._lumaSingBabelLoader = true;
  require.extensions['.js'] = transpileSrc;
}

module.exports = { root, srcRoot };
