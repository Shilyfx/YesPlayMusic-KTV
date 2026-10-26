// Compiled UI fixture only. Does not claim/stop rooms, play audio, or modify
// master data. Saves/restores only this feature's dedicated localStorage key.
export async function verifyDisplayPreferences(task, base) {
  const assert = (await import('node:assert')).default;
  const page = task.page('p1');
  await page.cdp('Network.setBypassServiceWorker', { bypass: true });
  await page.goto(base + '/karaoke');
  await page.waitForSelector('.display-screen', {
    state: 'visible',
    timeout: 15000,
  });
  const saved = await page.evaluate(() => ({
    raw: localStorage.getItem('lumasing.ktv.display.preferences.v1'),
    preferences: JSON.parse(
      JSON.stringify(
        document.querySelector('.display-screen').__vue__.preferences
      )
    ),
  }));
  async function seed(target) {
    await target.evaluate(() => {
      const view = document.querySelector('.display-screen').__vue__;
      view.poller.stop();
      clearInterval(view.clock);
      view.state = {
        active: true,
        hostName: '独立设置验收',
        updatedAt: 1000,
        serverTime: 1000,
        presentation: {
          itemId: 'preferences-fixture',
          position: 100,
          playing: false,
          offset: 2,
          mode: 'orbit',
          effect: 'neon',
          fontSize: 60,
          theme: 'light',
          lines: Array.from({ length: 128 }, (_, i) => ({
            time: 85 + i / 4,
            content: '时间 ' + (85 + i / 4),
          })),
        },
      };
      view.receivedAt = view.clockNow = performance.now();
      view.connected = true;
    });
  }
  const data = target =>
    target.evaluate(() => {
      const v = document.querySelector('.display-screen').__vue__;
      return {
        mode: v.presentation.mode,
        effect: v.presentation.effect,
        fontSize: v.presentation.fontSize,
        offset: v.presentation.offset,
        lyric: v.stage.active,
        raw: v.state.presentation.mode + ':' + v.state.presentation.offset,
        settings: JSON.stringify(v.$store.state.settings),
        playing: v.$store.state.player.playing,
      };
    });
  try {
    await seed(page);
    await page.evaluate(() => {
      const v = document.querySelector('.display-screen').__vue__;
      v.preferences = {
        version: 1,
        followStyle: true,
        followTiming: true,
        mode: 'classic',
        effect: 'gradient',
        fontSize: 45,
        offset: 0,
      };
    });
    const before = await data(page);
    assert.equal(before.offset, 2);
    assert.equal(before.mode, 'orbit');
    await page.click('text="本屏歌词设置"', {
      label: 'open local lyric settings',
    });
    console.log(await page.snapshot());
    await page.click('loc=role:checkbox[name="跟随主屏样式"]', {
      label: 'customize local display style',
    });
    await page.selectOption('[aria-label="本屏舞台样式"]', 'poem');
    await page.selectOption('[aria-label="本屏歌词字效"]', 'outline');
    await page.fill('[aria-label="本屏歌词字号"]', '32');
    await page.press('[aria-label="本屏歌词字号"]', 'Tab');
    assert.equal(
      (await data(page)).offset,
      2,
      'style override must not change timing follow'
    );
    await page.click('loc=role:checkbox[name="跟随主屏提前 / 延后"]', {
      label: 'customize local lyric timing',
    });
    await page.fill('[aria-label="本屏歌词偏移"]', '-1.5');
    await page.press('[aria-label="本屏歌词偏移"]', 'Tab');
    let custom = await data(page);
    assert.equal(custom.mode, 'poem');
    assert.equal(custom.effect, 'outline');
    assert.equal(custom.fontSize, 32);
    assert.equal(custom.offset, -1.5);
    assert.equal(custom.lyric, '时间 98.5');
    assert.equal(custom.raw, before.raw);
    assert.equal(custom.settings, before.settings);
    assert.equal(custom.playing, false);
    await page.reload();
    await page.waitForSelector('.display-screen', { state: 'visible' });
    await seed(page);
    custom = await data(page);
    assert.equal(custom.mode, 'poem');
    assert.equal(custom.offset, -1.5);
    const second = await task.newPage();
    await second.goto(base + '/karaoke');
    await second.waitForSelector('.display-screen', { state: 'visible' });
    await seed(second);
    await second.evaluate(() =>
      document.querySelector('.display-screen').__vue__.restoreFollow()
    );
    assert.equal((await data(second)).offset, 2);
    assert.equal(
      (await data(page)).offset,
      -1.5,
      'another display must not replace the current display settings'
    );
    await page.click('text="本屏歌词设置"', {
      label: 'reopen local lyric settings',
    });
    await page.evaluate(() => {
      const v = document.querySelector('.display-screen').__vue__;
      v.state.presentation = {
        ...v.state.presentation,
        mode: 'depth',
        offset: 3,
        fontSize: 55,
      };
    });
    assert.equal((await data(page)).mode, 'poem');
    assert.equal((await data(page)).offset, -1.5);
    await page.click('text="全部恢复跟随主屏"', {
      label: 'restore following master settings',
    });
    assert.equal((await data(page)).mode, 'depth');
    assert.equal((await data(page)).offset, 3);
    assert.equal((await data(page)).fontSize, 55);
    await page.click('text="歌词全屏"', {
      label: 'verify settings inside fullscreen',
    });
    await page.waitForFunction(() => !!document.fullscreenElement);
    await page.cdp('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: false,
    });
    assert.equal(
      await page.evaluate(() => {
        const el = document.querySelector('.display-screen');
        return el.scrollWidth <= el.clientWidth + 1;
      }),
      true,
      'narrow fullscreen has no horizontal overflow'
    );
    console.log(
      await page.screenshot({
        path: 'D:/VibeCoding/LumaSing/artifacts/lyric-stages/display-preferences-mobile.png',
      })
    );
    await page.evaluate(() => document.exitFullscreen());
    await page.cdp('Emulation.clearDeviceMetricsOverride');
    console.log(
      'PASS: independent stage/effect/font/absolute timing, default+restore follow, persistence, isolation and narrow fullscreen'
    );
  } finally {
    await page.evaluate(value => {
      const key = 'lumasing.ktv.display.preferences.v1';
      if (value.raw === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value.raw);
      const view = document.querySelector('.display-screen')?.__vue__;
      if (view) view.preferences = value.preferences;
    }, saved);
  }
}
