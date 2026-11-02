// Browser verification for the Docker follower layout. Uses only a local
// compiled page and a synthetic presentation; it never claims a room.
export async function verifyDisplayLayout(task, base) {
  const assert = (await import('node:assert')).default;
  const page = task.page('p1');
  await page.cdp('Network.setBypassServiceWorker', { bypass: true });
  await page.goto(base + '/karaoke');
  await page.waitForSelector('.display-screen', {
    state: 'visible',
    timeout: 15000,
  });
  await page.evaluate(joinUrl => {
    const view = document.querySelector('.display-screen').__vue__;
    view.poller.stop();
    clearInterval(view.clock);
    view.connected = true;
    view.state = {
      active: true,
      hostName: '副屏布局验收',
      joinUrl,
      nextTrack: { title: '下一首测试', artists: ['测试歌手'] },
      updatedAt: 1000,
      serverTime: 1000,
      presentation: {
        itemId: 'layout-fixture',
        title: '测试歌曲',
        artists: '测试歌手',
        position: 10,
        playing: false,
        offset: 0,
        mode: 'classic',
        effect: 'gradient',
        fontSize: 45,
        theme: 'light',
        lines: Array.from({ length: 32 }, (_, i) => ({
          time: i,
          content: '测试歌词 ' + i,
        })),
      },
    };
    view.receivedAt = view.clockNow = performance.now();
  }, `${base}/room/TEST/#token=fixture-token`);
  await page.waitForFunction(
    () =>
      document.querySelector('.display-stage .scene-now')?.textContent.trim() ===
      '测试歌词 10',
    undefined,
    { timeout: 5000 }
  );

  const statusAlignment = await page.evaluate(() => {
    const screen = document.querySelector('.display-screen');
    const title = screen.querySelector('.display-status strong');
    const songCaption = screen.querySelector('.track-caption');
    const next = screen.querySelector('.next-track');
    if (!title) return { text: null };
    const titleBox = title.getBoundingClientRect();
    return {
      text: title.textContent.trim(),
      hasSongCaption: Boolean(songCaption),
      next: next?.textContent.replace(/\s+/g, ' ').trim() || null,
      titleCenter: titleBox.left + titleBox.width / 2,
      screenCenter:
        screen.getBoundingClientRect().left + screen.clientWidth / 2,
    };
  });
  assert.equal(statusAlignment.text, '副屏歌词');
  assert.ok(
    Math.abs(statusAlignment.titleCenter - statusAlignment.screenCenter) < 1
  );
  assert.equal(statusAlignment.hasSongCaption, false);
  assert.ok(
    await page.evaluate(
      () =>
        document.querySelector('.display-stage .scene-now')?.textContent.trim() ===
        '测试歌词 10'
    )
  );
  assert.match(statusAlignment.next || '', /下一首测试/);

  const saved = await page.evaluate(() => ({
    raw: localStorage.getItem('lumasing.ktv.display.preferences.v1'),
    preferences: JSON.parse(
      JSON.stringify(
        document.querySelector('.display-screen').__vue__.preferences
      )
    ),
  }));
  let popup;
  try {
    const actionLabels = await page.evaluate(() =>
      [...document.querySelectorAll('.screen-actions button')].map(button =>
        button.textContent.trim()
      )
    );
    assert.ok(actionLabels.includes('点歌'));
    assert.ok(actionLabels.includes('歌词设置'));
    assert.ok(!actionLabels.includes('本屏歌词设置'));
    assert.ok(
      await page.evaluate(
        () =>
          document.querySelector('.screen-actions .karaoke-theme-switcher') !==
          null
      )
    );
    const toolbarLayout = await page.evaluate(() => {
      const header = document.querySelector('.display-header');
      const actions = header.querySelector('.screen-actions');
      const theme = actions.querySelector('.karaoke-theme-switcher');
      const song = [...actions.querySelectorAll('button')].find(
        button => button.textContent.trim() === '点歌'
      );
      const themeBox = theme.getBoundingClientRect();
      const songBox = song.getBoundingClientRect();
      return {
        themeBeforeSong: Boolean(
          theme.compareDocumentPosition(song) &
            Node.DOCUMENT_POSITION_FOLLOWING
        ),
        themeDirection: getComputedStyle(theme).flexDirection,
        headerHeight: header.getBoundingClientRect().height,
        themeRight: themeBox.right,
        songLeft: songBox.left,
        centerDifference: Math.abs(
          themeBox.top + themeBox.height / 2 - songBox.top - songBox.height / 2
        ),
      };
    });
    console.log('TOOLBAR_LAYOUT:', JSON.stringify(toolbarLayout));
    assert.ok(
      toolbarLayout.themeBeforeSong,
      'theme controls should appear before song request'
    );
    assert.equal(toolbarLayout.themeDirection, 'row');
    assert.ok(toolbarLayout.headerHeight <= 48);
    assert.ok(toolbarLayout.themeRight <= toolbarLayout.songLeft);
    assert.ok(toolbarLayout.centerDifference < 2);
    await page.cdp('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 812,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: 375,
      screenHeight: 812,
    });
    const mobileToolbar = await page.evaluate(() => {
      const screen = document.querySelector('.display-screen');
      const header = screen.querySelector('.display-header');
      const back = header.querySelector(':scope > button');
      const actions = header.querySelector('.screen-actions');
      const screenBox = screen.getBoundingClientRect();
      const backBox = back.getBoundingClientRect();
      const actionsBox = actions.getBoundingClientRect();
      return {
        innerWidth,
        headerWidth: header.clientWidth,
        headerScrollWidth: header.scrollWidth,
        backBottom: backBox.bottom,
        actionsTop: actionsBox.top,
        actionsLeft: actionsBox.left,
        actionsRight: actionsBox.right,
        screenLeft: screenBox.left,
        screenRight: screenBox.right,
      };
    });
    await page.cdp('Emulation.clearDeviceMetricsOverride', {});
    await page.waitForFunction(() => innerWidth > 700);
    console.log('MOBILE_TOOLBAR_LAYOUT:', JSON.stringify(mobileToolbar));
    assert.ok(mobileToolbar.innerWidth <= 400);
    assert.ok(mobileToolbar.headerScrollWidth <= mobileToolbar.headerWidth + 1);
    assert.ok(mobileToolbar.actionsTop >= mobileToolbar.backBottom);
    assert.ok(mobileToolbar.actionsLeft >= mobileToolbar.screenLeft);
    assert.ok(mobileToolbar.actionsRight <= mobileToolbar.screenRight);

    await page.click('loc=role:button[name="深色"]', {
      label: 'set follower dark theme',
    });
    await page.waitForFunction(
      () => document.querySelector('.display-screen').dataset.ktvTheme === 'dark'
    );
    assert.equal(
      await page.evaluate(
        () => document.querySelector('.display-screen').dataset.ktvTheme
      ),
      'dark'
    );
    assert.equal(
      await page.evaluate(
        () =>
          document.querySelector('.display-screen').__vue__.preferences.theme
      ),
      'dark'
    );
    await page.click('loc=role:button[name="浅色"]', {
      label: 'set follower light theme',
    });
    await page.waitForFunction(
      () => document.querySelector('.display-screen').dataset.ktvTheme === 'light'
    );
    const popupPromise = page.waitForEvent('popup');
    await page.click('text="点歌"', { label: 'open song request page' });
    popup = await popupPromise;
    const popupUrl = await popup.url();
    assert.match(popupUrl, /\/room\/TEST\/#token=fixture-token$/);
    console.log('SONG_REQUEST_POPUP:', popupUrl);

    await page.click('text="歌词设置"', {
      label: 'open display preferences',
    });
    await page.waitForSelector('.display-screen.settings-open', {
      state: 'visible',
    });
    const layout = await page.evaluate(() => {
      const screen = document.querySelector('.display-screen');
      const stage = screen.querySelector('.display-stage');
      const panel = screen.querySelector('.display-preferences');
      const groups = [...panel.querySelectorAll('fieldset')].map(node =>
        node.getBoundingClientRect()
      );
      const stageBox = stage.getBoundingClientRect();
      const panelBox = panel.getBoundingClientRect();
      const header = screen.querySelector('.display-header');
      const headerParts = [...header.children].map(node =>
        node.getBoundingClientRect()
      );
      const actions = screen.querySelector('.screen-actions');
      return {
        columns: getComputedStyle(screen).gridTemplateColumns,
        stageRight: stageBox.right,
        panelLeft: panelBox.left,
        panelWidth: panelBox.width,
        viewportWidth: innerWidth,
        firstGroupTop: groups[0].top,
        secondGroupTop: groups[1].top,
        footerCount: screen.querySelectorAll('footer').length,
        actionDirection: getComputedStyle(actions).flexDirection,
        actionWrap: getComputedStyle(actions).flexWrap,
        headerCenterDifference:
          Math.max(...headerParts.map(box => box.top + box.height / 2)) -
          Math.min(...headerParts.map(box => box.top + box.height / 2)),
        settings: [...panel.querySelectorAll('button')].map(button =>
          button.getAttribute('aria-label')
        ),
      };
    });
    assert.match(layout.columns, /[\d.]+px\s+[\d.]+px/);
    assert.ok(layout.panelLeft >= layout.stageRight - 1);
    assert.ok(layout.panelWidth < layout.viewportWidth * 0.45);
    assert.ok(layout.panelWidth <= 323);
    assert.ok(layout.secondGroupTop > layout.firstGroupTop);
    assert.equal(layout.actionDirection, 'row');
    assert.equal(layout.actionWrap, 'nowrap');
    assert.ok(layout.headerCenterDifference < 2);
    assert.equal(layout.footerCount, 0);
    assert.ok(layout.settings.includes('歌词延迟 0.1 秒'));
    assert.ok(layout.settings.includes('歌词提前 0.1 秒'));
    assert.ok(layout.settings.includes('歌词同步归零'));
    console.log(
      'SETTINGS_LAYOUT:',
      JSON.stringify({
        panelWidth: layout.panelWidth,
        actionDirection: layout.actionDirection,
        headerCenterDifference: layout.headerCenterDifference,
      })
    );
    console.log(
      'SETTINGS_SCREENSHOT:',
      await page.screenshot({
        path: 'D:/VibeCoding/LumaSing/artifacts/lyric-stages/follower-header-settings.png',
      })
    );

    await page.click('loc=role:checkbox[name="跟随主屏提前 / 延后"]', {
      label: 'enable custom lyric timing',
    });
    await page.click('loc=role:button[name="歌词提前 0.1 秒"]', {
      label: 'advance follower lyrics',
    });
    assert.equal(
      await page.evaluate(
        () =>
          document.querySelector('.display-screen').__vue__.preferences.offset
      ),
      0.1
    );

    await page.click('text="歌词设置"', {
      label: 'close preferences panel',
    });
    await page.waitForSelector('.display-screen.settings-open', {
      state: 'hidden',
    });
    await page.click('text="歌词全屏"', { label: 'enter lyric fullscreen' });
    await page.waitForFunction(() => !!document.fullscreenElement);
    await page.waitForFunction(
      () =>
        document.querySelector('.display-screen')?.__vue__
          ?.fullscreenStageShift > 0,
      undefined,
      { timeout: 5000 }
    );
    const fullscreenGap = await page.evaluate(() => {
      const screen = document.querySelector('.display-screen');
      const copy = screen.querySelector('.scene-copy');
      const gap =
        screen.getBoundingClientRect().bottom -
        copy.getBoundingClientRect().bottom;
      const shift = screen.__vue__.fullscreenStageShift;
      const baselineGap = gap + shift;
      return { gap, shift, baselineGap, reducedRatio: gap / baselineGap };
    });
    assert.ok(Math.abs(fullscreenGap.reducedRatio - 0.7) < 0.02);
    console.log('FULLSCREEN_GAP:', JSON.stringify(fullscreenGap));
    const headerTop = await page.evaluate(
      () =>
        document.querySelector('.display-header').getBoundingClientRect().top
    );
    assert.ok(headerTop >= 15 && headerTop <= 36);
    await page.hover('.display-stage', { label: 'move away from controls' });
    await page.waitForSelector(
      '.display-screen.is-fullscreen.controls-idle .display-header',
      { state: 'visible', timeout: 10000 }
    );
    await page.waitForFunction(
      () =>
        Number(
          getComputedStyle(
            document.querySelector('.display-screen .display-header')
          ).opacity
        ) < 0.05,
      undefined,
      { timeout: 2000 }
    );
    await page.hover('.display-screen .display-header', {
      label: 'reveal fullscreen controls',
    });
    await page.waitForFunction(
      () =>
        Number(
          getComputedStyle(
            document.querySelector('.display-screen .display-header')
          ).opacity
        ) > 0.95,
      undefined,
      { timeout: 2000 }
    );
    await page.evaluate(() => document.exitFullscreen());
    await page.waitForFunction(() => !document.fullscreenElement);
    await page.click('text="歌词设置"', {
      label: 'reopen preferences panel',
    });
    await page.waitForFunction(
      () => !document.querySelector('.display-screen')?.__vue__?.showSettings,
      undefined,
      { timeout: 12000 }
    );
    console.log(
      'PASS: hidden follower song metadata, visible lyrics, next-song indicator, song-request popup, local theme switcher, centered follower label, fullscreen gap and control fade'
    );
  } finally {
    if (popup) await popup.close();
    await page.evaluate(value => {
      const key = 'lumasing.ktv.display.preferences.v1';
      if (value.raw === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value.raw);
      const view = document.querySelector('.display-screen')?.__vue__;
      if (view) view.preferences = value.preferences;
    }, saved);
  }
}
