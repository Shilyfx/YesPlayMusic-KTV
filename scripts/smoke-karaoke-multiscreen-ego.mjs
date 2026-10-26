// Import from an ego-browser round. Use a vacant test deployment: this creates
// and ends its own room. Never use against an occupied room without permission.
export async function smokeMultiScreen(task, base) {
  const assert = (await import('node:assert')).default;
  const pages = await task.pages();
  const master = task.page('p1');
  const viewers = [];
  for (const label of ['p2', 'p3']) {
    viewers.push(
      pages.some(page => page.label === label)
        ? task.page(label)
        : await task.newPage()
    );
  }
  const read = () =>
    fetch(base + '/ktv/display').then(response => response.json());
  assert.equal((await read()).active, false, 'test requires vacant room');
  for (const page of [master, ...viewers]) {
    await page.cdp('Network.setBypassServiceWorker', { bypass: true });
    await page.goto(base + '/karaoke');
    await page.waitForSelector('input[placeholder="例如：客厅主电脑"]', {
      state: 'visible',
      timeout: 15000,
    });
  }
  await master.fill('input[placeholder="例如：客厅主电脑"]', '多屏验收主电脑');
  await master.click('text="将本机设为主电脑"', {
    label: 'designate master computer',
  });
  await master.waitForSelector('.room-link', {
    state: 'visible',
    timeout: 15000,
  });
  let previousSettings;
  try {
    previousSettings = await master.evaluate(() => {
      const v = document.querySelector('.karaoke-desktop').__vue__;
      const saved = { volume: v.player.volume, mode: v.lyricStageMode };
      v.player.volume = 0;
      return saved;
    });
    const joinUrl = await master.evaluate(() =>
      document.querySelector('.room-link').textContent.trim()
    );
    const session = await fetch(base + '/ktv/api/client-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + new URL(joinUrl).hash.slice(7),
      },
      body: '{}',
    }).then(response => response.json());
    const guest = async (route, body = {}) =>
      fetch(base + '/ktv/api/' + route, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + session.clientToken,
        },
        body: JSON.stringify(body),
      });
    assert.equal((await guest('requests', { trackId: '5257138' })).status, 201);
    await master.waitForFunction(
      () =>
        document
          .querySelector('.karaoke-desktop')
          .__vue__.player._howler?.playing() === true,
      undefined,
      { timeout: 25000 }
    );
    for (const page of viewers) {
      await page.waitForSelector('.display-stage', {
        state: 'visible',
        timeout: 15000,
      });
      await page.waitForFunction(
        () =>
          !!document.querySelector('.display-screen').__vue__.presentation
            .itemId,
        undefined,
        { timeout: 15000 }
      );
      const data = await page.evaluate(() => {
        const v = document.querySelector('.display-screen').__vue__;
        return {
          title: v.presentation.title,
          session: v.$store.state.karaoke.session.status,
          audioPlaying: !!v.$store.state.player._howler?.playing(),
          localPlaying: v.$store.state.player.playing,
          readOnly: v.$store.state.webKtvDisplayOnly,
          qr: !!document.querySelector('.room-qr-wrap'),
          lyricRequests: performance
            .getEntriesByType('resource')
            .filter(entry => new URL(entry.name).pathname.includes('/lyric'))
            .length,
        };
      });
      assert.ok(data.title);
      assert.equal(data.session, 'idle');
      assert.equal(data.audioPlaying, false);
      assert.equal(data.localPlaying, false);
      assert.equal(data.readOnly, true);
      assert.equal(data.qr, false);
      assert.equal(
        data.lyricRequests,
        0,
        'viewers must not fetch lyrics separately'
      );
    }
    for (const mode of ['classic', 'poem', 'depth', 'orbit']) {
      await master.evaluate(value => {
        document.querySelector('.karaoke-desktop').__vue__.lyricStageMode =
          value;
      }, mode);
      for (const page of viewers)
        await page.waitForFunction(
          value =>
            document.querySelector('.display-screen').__vue__.presentation
              .mode === value,
          mode,
          { timeout: 10000 }
        );
    }
    await master.evaluate(() =>
      document.querySelector('.karaoke-desktop').__vue__.player.pause()
    );
    await master.waitForFunction(
      () => !document.querySelector('.karaoke-desktop').__vue__.player.playing,
      undefined,
      { timeout: 10000 }
    );
    for (const page of viewers)
      await page.waitForFunction(
        () =>
          !document.querySelector('.display-screen').__vue__.presentation
            .playing,
        undefined,
        { timeout: 10000 }
      );
    await master.evaluate(() =>
      document.querySelector('.karaoke-desktop').__vue__.player.seek(60)
    );
    for (const page of viewers)
      await page.waitForFunction(
        () => {
          const position =
            document.querySelector('.display-screen').__vue__.presentation
              .position;
          return position >= 59.5 && position <= 60.5;
        },
        undefined,
        { timeout: 10000 }
      );
    await master.evaluate(() =>
      document.querySelector('.karaoke-desktop').__vue__.player.play()
    );
    for (const page of viewers)
      await page.waitForFunction(
        () =>
          document.querySelector('.display-screen').__vue__.presentation
            .playing,
        undefined,
        { timeout: 10000 }
      );
    assert.equal((await guest('next')).status, 200);
    for (const page of viewers)
      await page.waitForFunction(
        () =>
          !document.querySelector('.display-screen').__vue__.presentation
            .itemId,
        undefined,
        { timeout: 10000 }
      );
    console.log(
      'PASS: explicit master + 2 silent displays, Guest first auto-start/next, 4 modes, pause/seek/resume, zero viewer lyric requests'
    );
  } finally {
    await master.evaluate(saved => {
      const v = document.querySelector('.karaoke-desktop')?.__vue__;
      if (!v) return;
      if (saved) {
        v.player.volume = saved.volume;
        v.lyricStageMode = saved.mode;
      }
      return v.$parent.releaseMaster();
    }, previousSettings);
  }
  for (const page of viewers)
    await page.waitForSelector('.master-choice', {
      state: 'visible',
      timeout: 10000,
    });
  assert.equal((await read()).active, false);
  await viewers[1].fill(
    'input[placeholder="例如：客厅主电脑"]',
    '第二台主电脑'
  );
  await viewers[1].click('text="将本机设为主电脑"', {
    label: 'designate replacement master',
  });
  await viewers[1].waitForSelector('.room-link', {
    state: 'visible',
    timeout: 10000,
  });
  assert.equal((await read()).hostName, '第二台主电脑');
  await viewers[1].evaluate(() =>
    document.querySelector('.karaoke-desktop').__vue__.$parent.releaseMaster()
  );
  assert.equal((await read()).active, false);
  console.log(
    'PASS: explicit release and manual master reassignment; no automatic takeover'
  );
}
