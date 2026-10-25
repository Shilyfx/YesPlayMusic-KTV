// Isolated browser visual/layout regression. Fixture lyrics never reach a server.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require(process.env.LUMASING_PLAYWRIGHT_MODULE ||
  'playwright');

(async () => {
  let server;
  let browser;
  const output = path.resolve('artifacts/lyric-stages');
  fs.mkdirSync(output, { recursive: true });
  try {
    let base = process.env.LUMASING_WEB_URL;
    if (!base) {
      const root = path.resolve('dist');
      server = http.createServer((req, res) => {
        const requested = path.resolve(
          root,
          '.' + new URL(req.url, 'http://test').pathname
        );
        if (!requested.startsWith(root + path.sep)) {
          res.writeHead(403).end();
          return;
        }
        const file =
          fs.existsSync(requested) && fs.statSync(requested).isFile()
            ? requested
            : path.join(root, 'index.html');
        const types = {
          '.js': 'application/javascript',
          '.css': 'text/css',
          '.html': 'text/html',
        };
        res.setHeader(
          'Content-Type',
          types[path.extname(file)] || 'application/octet-stream'
        );
        fs.createReadStream(file).pipe(res);
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      base = 'http://127.0.0.1:' + server.address().port;
    }
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.LUMASING_CHROME_PATH,
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    await page.route('**/api/**', route =>
      route.fulfill({
        json: {
          code: 200,
          data: [],
          result: { songs: [] },
          account: null,
          profile: null,
        },
      })
    );
    await page.goto(base + '/karaoke', { waitUntil: 'domcontentloaded' });
    const selector = page.getByLabel('歌词舞台展示方式', { exact: true });
    await selector.waitFor({ timeout: 20000 });
    assert.equal(await selector.inputValue(), 'classic');
    assert.equal(await page.locator('.stage-lines').count(), 1);
    await page.evaluate(() => {
      const view = document.querySelector('.karaoke-surface').__vue__;
      clearInterval(view.clock);
      view.lyricLoadGeneration++;
      // Hide the unconfigured-room popover in this visual-only fixture.
      view.lanRoom = { name: '视觉测试（隔离夹具）' };
      view.showRoomCode = false;
      view.lyrics = Array.from({ length: 10000 }, (_, i) => ({
        time: i * 3,
        content: [
          '远处的灯火，落在静静的海面',
          '让每一句歌，成为此刻的风景',
          '我们沿着光，慢慢走向明天',
          '星河在你的声音里舒展',
        ][i % 4],
      }));
      view.activeLyricIndex = 5000;
      view.player._playing = true;
    });
    for (const mode of ['poem', 'depth', 'orbit']) {
      const lyricRequestsBefore = requests.filter(url =>
        /\/lyric[?\/]/.test(url)
      ).length;
      await selector.selectOption(mode);
      await page.locator(`[data-scene="${mode}"]`).waitFor();
      assert.equal(
        await page.locator('.scene-copy p').count(),
        4,
        'DOM bounded with 10,000 lyrics'
      );
      assert.equal(await page.locator('.stage-lines').count(), 0);
      assert.notEqual(
        await page
          .locator('.scene-now')
          .evaluate(el => getComputedStyle(el).animationName),
        'none',
        'playing scene has a finite entrance animation'
      );
      await page.evaluate(() => {
        document.querySelector(
          '.karaoke-surface'
        ).__vue__.activeLyricIndex = 5001;
      });
      await page.waitForFunction(() =>
        document.querySelector('.scene-now').textContent.includes('让每一句歌')
      );
      await page.evaluate(() => {
        document.querySelector(
          '.karaoke-surface'
        ).__vue__.activeLyricIndex = 5000;
      });
      await page.waitForFunction(
        () =>
          JSON.parse(localStorage.getItem('settings')).karaokeLyricStageMode ===
          document.querySelector('.lyric-scene').dataset.scene
      );
      assert.equal(
        requests.filter(url => /\/lyric[?\/]/.test(url)).length,
        lyricRequestsBefore,
        'changing presentation must not reload lyrics'
      );
      await page.locator('.stage').screenshot({
        path: path.join(output, mode + '-desktop.png'),
        animations: 'disabled',
      });
      await page.setViewportSize({ width: 390, height: 844 });
      const box = await page.locator('.scene-now').boundingBox();
      const stage = await page.locator('.stage').boundingBox();
      assert.ok(
        box.width > 120 &&
          box.x >= stage.x &&
          box.x + box.width <= stage.x + stage.width + 1,
        mode + ': active lyric must fit narrow stage'
      );
      for (const size of [16, 64]) {
        await page.evaluate(value => {
          document
            .querySelector('.karaoke-surface')
            .__vue__.$store.commit('changeLyricFontSize', value);
        }, size);
        assert.equal(
          await page
            .locator('.scene-now')
            .evaluate(el => parseFloat(getComputedStyle(el).fontSize)),
          size
        );
      }
      await page.evaluate(() => {
        document
          .querySelector('.karaoke-surface')
          .__vue__.$store.commit('changeLyricFontSize', 45);
      });
      const effectControl = page.getByLabel('自定义歌词字体效果', {
        exact: true,
      });
      for (const effect of ['neon', 'outline', 'solid', 'gradient']) {
        await effectControl.selectOption(effect);
        assert.equal(
          await page.locator('.lyric-scene').getAttribute('data-effect'),
          effect
        );
        const style = await page.locator('.scene-now').evaluate(el => {
          const css = getComputedStyle(el);
          return {
            shadow: css.textShadow,
            stroke: css.webkitTextStrokeWidth,
            background: css.backgroundImage,
          };
        });
        if (effect === 'neon') assert.notEqual(style.shadow, 'none');
        if (effect === 'outline') assert.equal(style.stroke, '1.5px');
        if (effect === 'gradient')
          assert.match(style.background, /linear-gradient/);
      }
      const control = await page.locator('.karaoke-controls').boundingBox();
      assert.ok(
        control.y >= stage.y + stage.height - 1,
        'controls must not cover lyric stage'
      );
      await page.locator('.stage').screenshot({
        path: path.join(output, mode + '-mobile.png'),
        animations: 'disabled',
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.getByRole('button', { name: '歌词全屏', exact: true }).click();
      await page.waitForFunction(() => !!document.fullscreenElement);
      await page.setViewportSize({ width: 844, height: 390 });
      await page.locator('.lyric-scene[data-fullscreen="true"]').waitFor();
      await page.evaluate(() => {
        const view = document.querySelector('.karaoke-surface').__vue__;
        view.lyrics[5000].content =
          '很长的歌词也应该可以完整阅读，不被横屏全屏的容器裁切。'.repeat(5);
        view.$forceUpdate();
      });
      await page
        .locator('.scene-later')
        .evaluate(el => el.scrollIntoView({ block: 'nearest' }));
      const last = await page.locator('.scene-later').boundingBox();
      const scene = await page.locator('.lyric-scene').boundingBox();
      assert.ok(
        scene.y >= 0 && scene.y + scene.height <= 391,
        'fullscreen scene fits short viewport'
      );
      assert.ok(
        last.y >= scene.y - 1 &&
          last.y + last.height <= scene.y + scene.height + 1,
        'final line remains scroll-accessible'
      );
      assert.equal(
        await page.locator('.stage-footer').isVisible(),
        false,
        'fullscreen must hide footer'
      );
      await page
        .locator('.scene-past')
        .evaluate(el => el.scrollIntoView({ block: 'start' }));
      const first = await page.locator('.scene-past').boundingBox();
      const sceneAfterScroll = await page.locator('.lyric-scene').boundingBox();
      assert.ok(
        first.y >= sceneAfterScroll.y - 1 &&
          first.y + first.height <=
            sceneAfterScroll.y + sceneAfterScroll.height + 1,
        mode +
          ': first line remains scroll-accessible ' +
          JSON.stringify({ first, sceneAfterScroll })
      );
      await page
        .locator('.scene-later')
        .evaluate(el => el.scrollIntoView({ block: 'end' }));
      await page.evaluate(() => {
        const view = document.querySelector('.karaoke-surface').__vue__;
        view.lyrics[5001].content = '新的当前句必须重新进入可视范围';
        view.activeLyricIndex = 5001;
      });
      await page.waitForFunction(
        () => {
          const root = document
            .querySelector('.lyric-scene')
            .getBoundingClientRect();
          const active = document
            .querySelector('.scene-now')
            .getBoundingClientRect();
          return active.top >= root.top - 1 && active.top < root.bottom;
        },
        undefined,
        { timeout: 3000 }
      );
      await page.locator('.stage').screenshot({
        path: path.join(output, mode + '-landscape.png'),
        animations: 'disabled',
      });
      await page.evaluate(() => {
        document.querySelector(
          '.karaoke-surface'
        ).__vue__.lyrics[5000].content = '远处的灯火，落在静静的海面';
        document.querySelector(
          '.karaoke-surface'
        ).__vue__.lyrics[5001].content = '让每一句歌，成为此刻的风景';
        document.querySelector(
          '.karaoke-surface'
        ).__vue__.activeLyricIndex = 5000;
        return document.exitFullscreen();
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    await selector.waitFor();
    assert.equal(
      await selector.inputValue(),
      'orbit',
      'saved mode survives reload'
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => {
      document.querySelector('.karaoke-surface').__vue__.player._playing = true;
    });
    assert.equal(
      await page
        .locator('.scene-now')
        .evaluate(el => getComputedStyle(el).animationName),
      'none'
    );
    await selector.selectOption('classic');
    assert.equal(
      await page.locator('.stage-lines').count(),
      1,
      'original mode remains available'
    );
    assert.deepEqual(errors, []);
    console.log(
      'Lyric stages: 3 modes × desktop/mobile, 10,000-line bounded DOM, persistence, reduced motion, classic fallback passed'
    );
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
