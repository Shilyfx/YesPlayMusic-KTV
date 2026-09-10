const webpack = require('webpack');
const path = require('path');
const fs = require('fs');
const { isolateRemoteAssets } = require('./scripts/isolate-remote-assets');
function resolve(dir) {
  return path.join(__dirname, dir);
}

class IsolateElectronRemoteAssetsPlugin {
  apply(compiler) {
    compiler.hooks.afterEmit.tap('IsolateElectronRemoteAssetsPlugin', () => {
      isolateRemoteAssets(compiler.options.output.path);
      const desktopIndexPath = path.join(
        compiler.options.output.path,
        'index.html'
      );
      if (fs.existsSync(desktopIndexPath)) {
        const html = fs.readFileSync(desktopIndexPath, 'utf8');
        // Electron loads the desktop shell from the local HTTP server so
        // relative /api requests reach the bundled NetEase proxy. The
        // electron-builder default app:// asset URLs are cross-origin from
        // that page and can leave the boot screen visible forever.
        const httpHtml = html.replace(/app:\/\/\.\//g, '/');
        if (httpHtml !== html) fs.writeFileSync(desktopIndexPath, httpHtml);
      }
      const desktopScriptPaths = [
        ...fs
          .readdirSync(path.join(compiler.options.output.path, 'js'))
          .filter(file => file.endsWith('.js'))
          .map(file => path.join(compiler.options.output.path, 'js', file)),
        ...fs
          .readdirSync(compiler.options.output.path)
          .filter(file =>
            /^(?:service-worker|precache-manifest\.).*\.js$/.test(file)
          )
          .map(file => path.join(compiler.options.output.path, file)),
      ];
      desktopScriptPaths.forEach(scriptPath => {
        const source = fs.readFileSync(scriptPath, 'utf8');
        const httpSource = source.replace(/app:\/\/\.\//g, '/');
        if (httpSource !== source) fs.writeFileSync(scriptPath, httpSource);
      });
    });
  }
}

module.exports = {
  // 生产环境打包不输出 map
  productionSourceMap: false,
  devServer: {
    disableHostCheck: true,
    port: process.env.DEV_SERVER_PORT || 8080,
    proxy: {
      '^/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        pathRewrite: {
          '^/api': '/',
        },
      },
    },
  },
  pwa: {
    name: 'LumaSing',
    iconPaths: {
      favicon32: 'img/icons/favicon-32x32.png',
    },
    themeColor: '#ffffff00',
    manifestOptions: {
      background_color: '#335eea',
    },
    // workboxOptions: {
    //   swSrc: "dev/sw.js",
    // },
  },
  pages: {
    index: {
      entry: 'src/main.js',
      template: 'public/index.html',
      filename: 'index.html',
      title: 'LumaSing',
      // The custom splitChunks rule names the desktop vendor bundle
      // `vendors~index`. Listing Vue CLI's default `chunk-vendors` name here
      // silently omitted the real dependency script from packaged index.html.
      chunks: ['vendors~index', 'index'],
    },
    remote: {
      entry: 'src/remote/main.js',
      template: 'public/remote.html',
      filename: 'remote/index.html',
      title: 'LumaSing KTV Room',
      // Remote is a standalone fetch/DOM client. Do not load the desktop
      // vendor chunk (Vuex, player UI, and Electron renderer dependencies).
      chunks: ['remote'],
    },
  },
  chainWebpack(config) {
    config.module.rules.delete('svg');
    config.module.rule('svg').exclude.add(resolve('src/assets/icons')).end();
    config.module
      .rule('icons')
      .test(/\.svg$/)
      .include.add(resolve('src/assets/icons'))
      .end()
      .use('svg-sprite-loader')
      .loader('svg-sprite-loader')
      .options({
        symbolId: 'icon-[name]',
      })
      .end();
    config.module
      .rule('napi')
      .test(/\.node$/)
      .use('node-loader')
      .loader('node-loader')
      .end();

    config.module
      .rule('webpack4_es_fallback')
      .test(/\.js$/)
      .include.add(/node_modules/)
      .end()
      .use('esbuild-loader')
      .loader('esbuild-loader')
      .options({ target: 'es2015', format: 'cjs' })
      .end();

    // The LAN client is served from a standalone /room/... path. Keep its
    // dependency graph inside the remote entry instead of leaving a
    // chunk-vendors preload that the embedded server does not serve.
    // Desktop pages retain Vue CLI's normal vendor splitting.
    config.optimization.splitChunks({
      chunks: chunk => chunk.name !== 'remote',
    });

    // LimitChunkCountPlugin 可以通过合并块来对块进行后期处理。用以解决 chunk 包太多的问题
    config.plugin('chunkPlugin').use(webpack.optimize.LimitChunkCountPlugin, [
      {
        // The dedicated Remote entry adds its own extracted CSS chunk. Keeping four
        // chunks avoids Webpack 4 attempting an invalid contenthash CSS merge.
        maxChunks: 4,
        minChunkSize: 10_000,
      },
    ]);
  },
  // 添加插件的配置
  pluginOptions: {
    // electron-builder的配置文件
    electronBuilder: {
      nodeIntegration: true,
      externals: ['@unblockneteasemusic/rust-napi'],
      builderOptions: {
        productName: 'LumaSing',
        copyright: 'Copyright © LumaSing',
        // compression: "maximum", // 机器好的可以打开，配置压缩，开启后会让 .AppImage 格式的客户端启动缓慢
        asar: true,
        publish: [
          {
            provider: 'github',
            owner: 'Shilyfx',
            repo: 'YesPlayMusic-KTV',
            vPrefixedTagName: true,
            releaseType: 'draft',
          },
        ],
        directories: {
          output: 'dist_electron',
        },
        mac: {
          target: [
            {
              target: 'dmg',
              arch: process.env.LUMASING_MAC_ARCH
                ? [process.env.LUMASING_MAC_ARCH]
                : ['x64', 'arm64', 'universal'],
            },
          ],
          artifactName: '${productName}-${os}-${version}-${arch}.${ext}',
          category: 'public.app-category.music',
          darkModeSupport: true,
        },
        win: {
          target: [
            {
              target: 'portable',
              arch: ['x64'],
            },
            {
              target: 'nsis',
              arch: ['x64'],
            },
          ],
          publisherName: 'LumaSing',
          icon: 'build/icons/icon.ico',
          publish: ['github'],
        },
        linux: {
          target: [
            {
              target: 'AppImage',
              arch: ['x64'],
            },
            {
              target: 'tar.gz',
              arch: ['x64', 'arm64'],
            },
            {
              target: 'deb',
              arch: ['x64', 'armv7l', 'arm64'],
            },
            {
              target: 'rpm',
              arch: ['x64'],
            },
            {
              target: 'snap',
              arch: ['x64'],
            },
            {
              target: 'pacman',
              arch: ['x64'],
            },
          ],
          category: 'Music',
          icon: './build/icon.icns',
        },
        dmg: {
          icon: 'build/icons/icon.icns',
        },
        nsis: {
          oneClick: true,
          perMachine: true,
          deleteAppDataOnUninstall: true,
        },
      },
      // 主线程的配置文件
      chainWebpackMainProcess: config => {
        config.plugin('define').tap(args => {
          args[0]['IS_ELECTRON'] = true;
          return args;
        });
        config.resolve.alias.set(
          'jsbi',
          path.join(__dirname, 'node_modules/jsbi/dist/jsbi-cjs.js')
        );

        config.module
          .rule('webpack4_es_fallback')
          .test(/\.js$/)
          .include.add(/node_modules/)
          .end()
          .use('esbuild-loader')
          .loader('esbuild-loader')
          .options({ target: 'es2015', format: 'cjs' })
          .end();
      },
      // 渲染线程的配置文件
      chainWebpackRendererProcess: config => {
        // 渲染线程的一些其他配置
        // Chain webpack config for electron renderer process only
        // The following example will set IS_ELECTRON to true in your app
        config.plugin('define').tap(args => {
          args[0]['IS_ELECTRON'] = true;
          return args;
        });
        config
          .plugin('isolateElectronRemoteAssets')
          .use(IsolateElectronRemoteAssetsPlugin);
      },
      // 主入口文件
      // mainProcessFile: 'src/main.js',
      // mainProcessArgs: []
    },
  },
};
