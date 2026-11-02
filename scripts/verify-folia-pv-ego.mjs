// Uses the user's ego-browser runtime only. No room or music API is claimed.
export async function verifyFoliaPv(task, base) {
  const assert = (await import('node:assert')).default;
  const page = task.page('p1');
  await page.cdp('Network.setBypassServiceWorker', { bypass: true });
  await page.cdp('Network.setCacheDisabled', { cacheDisabled: true });
  await page.goto(base + '/karaoke');
  await page.waitForSelector('.display-screen', { state: 'visible', timeout: 15000 });
  await page.evaluate(() => {
    window.pvQaErrors = [];
    window.pvQaConsoleError = console.error;
    console.error = (...args) => {
      window.pvQaErrors.push(args.map(value => value?.stack || String(value)).join(' '));
      window.pvQaConsoleError(...args);
    };
    window.pvQaComponent = () => {
      const walk = node => node.$options.name === 'KaraokePvScene'
        ? node : node.$children.map(walk).find(Boolean);
      return walk(document.querySelector('.display-screen').__vue__);
    };
    const view = document.querySelector('.display-screen').__vue__;
    view.poller.stop();
    clearInterval(view.clock);
    const documentLines = Array.from({ length: 64 }, (_, index) => ({
      time: index * 4 + 2,
      content: ['我卖了一个世界 却换来灰烬', '那么多年 自作聪明付出了真心',
        '沿着光的方向 走过漫长的夜', '下一场花火 会照亮你的眼睛'][index % 4],
    }));
    view.connected = true;
    view.state = {
      active: true, generation: 1, updatedAt: 1000, serverTime: 1000,
      hostName: 'PV 验收', nextTrack: { title: '下一首测试', artists: ['测试歌手'] },
      pvLyrics: Object.freeze({ itemId: 'pv-fixture', revision: 1, duration: 262,
        lines: Object.freeze(documentLines) }),
      presentation: { itemId: 'pv-fixture', position: 40, playing: false,
        offset: 0, mode: 'classic', effect: 'gradient', fontSize: 45, theme: 'light',
        lines: documentLines },
    };
    view.receivedAt = view.clockNow = performance.now();
    view.preferences = { ...view.preferences, followStyle: false, followTiming: false,
      mode: 'sonnet', offset: 0, theme: 'light', fontSize: 45 };
  });
  try {
    for (const mode of ['sonnet', 'tempera', 'hanabi']) {
      await page.evaluate(mode => {
        const view = document.querySelector('.display-screen').__vue__;
        view.preferences = { ...view.preferences, mode, theme: 'light' };
      }, mode);
      await page.waitForFunction(
        mode => {
          const scene = document.querySelector('.pv-scene');
          return scene?.dataset.scene === mode && ['ready', 'error'].includes(scene.dataset.pvStatus);
        }, mode, { timeout: 45000 }
      );
      const result = await page.evaluate(() => {
        const scene = document.querySelector('.pv-scene');
        const canvas = scene.querySelector('canvas');
        window.pvQaCanvas = canvas;
        return { status: scene.dataset.pvStatus, canvases: scene.querySelectorAll('canvas').length,
          width: canvas?.width, height: canvas?.height,
          songCaption: Boolean(document.querySelector('.track-caption')),
          errors: window.pvQaErrors };
      });
      console.log('ORIGINAL_ENGINE', mode, JSON.stringify(result));
      assert.equal(result.status, 'ready', result.errors.join('\n'));
      assert.equal(result.canvases, 1);
      assert.ok(result.width > 200 && result.height > 100);
      assert.equal(result.songCaption, false);
      await page.evaluate(() => {
        const view = document.querySelector('.display-screen').__vue__;
        const state = view.state;
        view.state = { ...state, serverTime: state.serverTime + 10,
          updatedAt: state.updatedAt + 10, presentation: { ...state.presentation } };
      });
      await page.waitForFunction(() => document.querySelector('.pv-scene')?.dataset.pvStatus === 'ready');
      assert.ok(await page.evaluate(() => window.pvQaCanvas === document.querySelector('.pv-scene canvas')),
        'clock-only poll must not rebuild the native canvas');
      console.log('PV_SCREENSHOT', mode, await page.screenshot({
        path: `D:/VibeCoding/LumaSing/artifacts/lyric-stages/folia-original-${mode}.png`,
      }));
      await page.evaluate(() => {
        const view = document.querySelector('.display-screen').__vue__;
        view.state.presentation.position = 76;
        view.receivedAt = view.clockNow = performance.now();
        view.preferences = { ...view.preferences, offset: 1.5 };
      });
      await page.waitForFunction(() => Math.abs(window.pvQaComponent().pvClock.get() - 77.5) < 0.01);
      assert.ok(await page.evaluate(() => window.pvQaCanvas === document.querySelector('.pv-scene canvas')),
        'seeking and local timing adjustment must keep the same renderer');
      await page.evaluate(() => {
        const view = document.querySelector('.display-screen').__vue__;
        view.state.presentation.playing = true;
        view.receivedAt = view.clockNow = performance.now();
      });
      await page.waitForFunction(() => window.pvQaComponent().pvClock.get() > 77.6);
      await page.evaluate(() => {
        const view = document.querySelector('.display-screen').__vue__;
        view.state.presentation.playing = false;
        view.preferences = { ...view.preferences, theme: 'dark' };
      });
      await page.waitForFunction(() => document.querySelector('.pv-scene')?.dataset.pvStatus === 'ready');
      assert.equal(await page.evaluate(() => document.querySelector('.pv-scene canvas') !== window.pvQaCanvas), true,
        'theme change rebuilds its resources once');
      assert.equal(await page.evaluate(() => window.pvQaCanvas.isConnected), false);
      assert.equal(await page.evaluate(() => document.querySelectorAll('.pv-scene canvas').length), 1);
    }
    await page.evaluate(async () => {
      const view = document.querySelector('.display-screen').__vue__;
      for (const mode of ['sonnet', 'tempera', 'hanabi', 'sonnet']) {
        view.preferences = { ...view.preferences, mode };
        await view.$nextTick();
      }
    });
    await page.waitForFunction(() => {
      const scene = document.querySelector('.pv-scene');
      return scene?.dataset.scene === 'sonnet' && scene.dataset.pvStatus === 'ready';
    }, undefined, { timeout: 30000 });
    assert.equal(await page.evaluate(() => document.querySelectorAll('.pv-scene canvas').length), 1);
    await page.evaluate(() => {
      const view = document.querySelector('.display-screen').__vue__;
      const lines = view.state.pvLyrics.lines.map((line, index) => ({ ...line,
        content: index === 18 ? '这是一句很长的歌词，仍然跟随原版分镜与时间线。'.repeat(15) : line.content }));
      window.pvQaCanvas = document.querySelector('.pv-scene canvas');
      view.state = { ...view.state,
        pvLyrics: Object.freeze({ itemId: 'pv-next-song', revision: 2, duration: 262, lines }),
        presentation: { ...view.state.presentation, itemId: 'pv-next-song', lines } };
    });
    await page.waitForFunction(() => document.querySelector('.pv-scene')?.dataset.pvStatus === 'ready',
      undefined, { timeout: 30000 });
    assert.equal(await page.evaluate(() => window.pvQaCanvas.isConnected), false);
    assert.match(await page.evaluate(() => document.querySelector('.pv-accessible').textContent), /很长的歌词/);
    await page.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await page.waitForFunction(() => window.pvQaComponent()?.pvMotion.matches &&
      document.querySelector('.pv-scene')?.dataset.pvStatus === 'ready');
    await page.cdp('Emulation.setEmulatedMedia', { features: [] });
    await page.waitForFunction(() => !window.pvQaComponent()?.pvMotion.matches &&
      document.querySelector('.pv-scene')?.dataset.pvStatus === 'ready');
    console.log('PASS: rapid mode cancellation, new-song long lyrics and reduced motion');
    await page.click('text="歌词全屏"', { label: 'inspect PV fullscreen' });
    await page.waitForFunction(() => !!document.fullscreenElement);
    const fullscreen = await page.evaluate(() => {
      const screen = document.querySelector('.display-screen').getBoundingClientRect();
      const scene = document.querySelector('.pv-scene').getBoundingClientRect();
      return { height: scene.height, available: screen.height, scrollWidth: document.querySelector('.pv-scene').scrollWidth,
        width: scene.width };
    });
    assert.ok(fullscreen.height > fullscreen.available * 0.75);
    assert.ok(fullscreen.scrollWidth <= fullscreen.width + 1);
    await page.evaluate(() => document.exitFullscreen());
    await page.waitForFunction(() => !document.fullscreenElement);
    await page.evaluate(() => {
      const view = document.querySelector('.display-screen').__vue__;
      view.preferences = { ...view.preferences, mode: 'poem' };
    });
    await page.waitForSelector('.scene-copy .scene-now', { state: 'visible' });
    assert.equal(await page.evaluate(() => document.querySelector('.pv-scene')), null);
    assert.equal(await page.evaluate(() => window.pvQaCanvas.isConnected), false);
    console.log('PASS: three original Pixi engines, stable polling, pause/seek/local offset, theme, fullscreen and legacy return');
  } finally {
    await page.evaluate(() => {
      if (window.pvQaConsoleError) console.error = window.pvQaConsoleError;
    });
  }
}

export async function verifyFoliaFailure(task) {
  const assert = (await import('node:assert')).default;
  const page = task.page('p1');
  await page.evaluate(() => {
    window.pvQaGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      if (/^webgl/.test(type)) return null;
      return window.pvQaGetContext.call(this, type, ...args);
    };
    const view = document.querySelector('.display-screen').__vue__;
    view.preferences = { ...view.preferences, mode: 'hanabi' };
  });
  try {
    await page.waitForFunction(() => document.querySelector('.pv-scene')?.dataset.pvStatus === 'error',
      undefined, { timeout: 15000 });
    assert.match(await page.evaluate(() => document.querySelector('.pv-fallback').textContent), /很长的歌词/);
  } finally {
    await page.evaluate(() => { HTMLCanvasElement.prototype.getContext = window.pvQaGetContext; });
  }
  await page.click('.pv-fallback button', { label: 'retry available WebGL renderer' });
  await page.waitForFunction(() => document.querySelector('.pv-scene')?.dataset.pvStatus === 'ready',
    undefined, { timeout: 30000 });
  assert.equal(await page.evaluate(() => document.querySelectorAll('.pv-scene canvas').length), 1);
  await page.evaluate(() => {
    const view = document.querySelector('.display-screen').__vue__;
    view.preferences = { ...view.preferences, mode: 'classic' };
  });
  await page.waitForSelector('.scene-now', { state: 'visible' });
  console.log('PASS: missing WebGL shows live lyric fallback and retry recovers');
}

export async function verifyFoliaMaster(task) {
  const assert = (await import('node:assert')).default;
  const page = task.page('p1');
  await page.evaluate(async () => {
    const view = document.querySelector('.display-screen').__vue__;
    window.pvQaView = view;
    window.pvQaSavedMasterMode = view.$store.state.settings.karaokeLyricStageMode;
    // Render the master UI without claiming a room or starting audio.
    view.isMaster = true;
    await view.$nextTick();
    const master = view.$refs.master;
    master.lyricLoadGeneration++;
    clearInterval(master.clock);
    master.lyrics = view.state.pvLyrics.lines;
    master.lyricRequestKeyValue = master.lyricRequestKey;
    master.now = 76;
    master.syncLyricCursor(76, true);
  });
  try {
    for (const mode of ['sonnet', 'tempera', 'hanabi']) {
      await page.evaluate(mode => {
        window.pvQaView.$store.state.settings.karaokeLyricStageMode = mode;
      }, mode);
      await page.waitForFunction(mode => {
        const scene = document.querySelector('.stage .pv-scene');
        return scene?.dataset.scene === mode && scene.dataset.pvStatus === 'ready';
      }, mode, { timeout: 30000 });
      const result = await page.evaluate(() => {
        const master = window.pvQaView.$refs.master;
        return { itemId: master.pvLyricDocument.itemId,
          count: document.querySelectorAll('.stage .pv-scene canvas').length,
          sources: Boolean(document.querySelector('a[href="/pv/source.tgz"]')) };
      });
      assert.equal(result.count, 1);
      assert.equal(result.sources, true);
      console.log('MASTER_PV', mode, JSON.stringify(result));
    }
  } finally {
    await page.evaluate(async () => {
      const view = window.pvQaView;
      view.$refs.master.lyricStageMode = window.pvQaSavedMasterMode || 'classic';
      view.isMaster = false;
      await view.$nextTick();
    });
  }
  console.log('PASS: actual master Vue page supplies full lyrics to all original modes without a room claim');
}

// Requires the local production QA host; refuses to create a production room.
export async function verifyFoliaTransport(task, base) {
  const assert = (await import('node:assert')).default;
  if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('LOCAL_QA_ONLY');
  const page = task.page('p1');
  const before = await fetch(base + '/qa/requests').then(r => r.json());
  let token = '';
  const call = async (action, body) => {
    const response = await fetch(base + '/ktv/host/' + action, {
      method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    assert.ok(response.ok, data.error);
    return data;
  };
  const document = { itemId: 'local-transport-fixture', duration: 262,
    lines: Array.from({ length: 64 }, (_, i) => ({time: i*4+2,content:`第 ${i+1} 句歌词 与光一起抵达远方`})) };
  const presentation = { itemId: document.itemId, position: 40, playing: false,
    offset: 0, mode: 'classic', effect: 'gradient', fontSize: 45, theme: 'light', lines: document.lines };
  try {
    const opened = await call('open', { snapshot: {
      session: { status: 'active', sessionId: 'local-transport-session' }, revision: 1,
      currentItem: {queueItemId:document.itemId,trackName:'Local QA'}, waitingItems: [], historyItems: [],
    }, presentation, pvLyrics: document });
    token = opened.hostToken;
    await page.goto(base + '/karaoke');
    await page.waitForFunction(() => !!document.querySelector('.display-screen')?.__vue__?.state.pvLyrics,
      undefined, {timeout:15000});
    for (const mode of ['sonnet','tempera','hanabi']) {
      await page.evaluate(mode => {
        const view=document.querySelector('.display-screen').__vue__;
        view.preferences={...view.preferences,followStyle:false,mode};
      },mode);
      await page.waitForFunction(mode => document.querySelector('.pv-scene')?.dataset.scene===mode &&
        document.querySelector('.pv-scene')?.dataset.pvStatus==='ready', mode,{timeout:30000});
    }
    await page.evaluate(()=>{window.pvQaCanvas=document.querySelector('.pv-scene canvas')});
    for(let i=0;i<5;i++) {
      await call('exchange',{presentation});
      await page.evaluate(()=>document.querySelector('.display-screen').__vue__.poller.refresh());
    }
    assert.ok(await page.evaluate(()=>window.pvQaCanvas===document.querySelector('.pv-scene canvas')));
    let counts=await fetch(base+'/qa/requests').then(r=>r.json());
    assert.equal((counts['/ktv/display/lyrics']||0)-(before['/ktv/display/lyrics']||0),1);
    const updated={...document,lines:document.lines.map((line,i)=>({...line,content:i===0?'歌词文档已更新':line.content}))};
    await call('exchange',{pvLyrics:updated,presentation});
    await page.evaluate(()=>document.querySelector('.display-screen').__vue__.poller.refresh());
    await page.waitForFunction(()=>document.querySelector('.display-screen')?.__vue__?.state.pvLyrics?.revision===2 &&
      document.querySelector('.pv-scene')?.dataset.pvStatus==='ready',undefined,{timeout:15000});
    counts=await fetch(base+'/qa/requests').then(r=>r.json());
    assert.equal((counts['/ktv/display/lyrics']||0)-(before['/ktv/display/lyrics']||0),2);
    console.log('REAL_TRANSPORT',JSON.stringify({
      clockPolls:(counts['/ktv/display']||0)-(before['/ktv/display']||0),
      fullDocuments:2,revisions:2,canvases:await page.evaluate(()=>document.querySelectorAll('.pv-scene canvas').length)}));
    console.log('PASS: real backend + real display poller + three original engines; one full fetch per revision');
  } finally {
    if(token) await call('close',{});
  }
}
