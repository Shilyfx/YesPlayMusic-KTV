// verify-reaction-zoom-ego.mjs
// E2E test verifying reaction zoom 20% and font size 30% via ego-browser

const routerUrl = 'http://192.168.100.1:18080/karaoke';
const screenshotPath =
  'C:/Users/Shilyfx/.gemini/antigravity/brain/dfee5c98-be24-403c-9d3b-4bf285c2cc05/reaction-zoom-verify.png';

export async function run() {
  const task = await taskSpace('verify reaction zoom and font size');
  const page = task.page('p1');

  try {
    console.log('[EGO] Enabling bypass service worker...');
    await page.cdp('Network.setBypassServiceWorker', { bypass: true });

    console.log('[EGO] Navigating to', routerUrl);
    await page.goto(routerUrl);

    // Wait for either master button or stage
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('button')).some(b =>
          b.textContent.includes('将本机设为主电脑')
        ) || !!document.querySelector('.stage'),
      undefined,
      { timeout: 15000 }
    );

    const hasMasterBtn = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button')).some(b =>
        b.textContent.includes('将本机设为主电脑')
      );
    });

    if (hasMasterBtn) {
      console.log('[EGO] Clicking 将本机设为主电脑...');
      await page.click('text="将本机设为主电脑"', { label: '设为主电脑' });
    }

    console.log('[EGO] Waiting for stage...');
    await page.waitForSelector('.stage', { timeout: 15000 });
    console.log('[EGO] Stage visible.');

    // Activate lanRoom if not active
    await page.evaluate(async () => {
      const desktop = document.querySelector('.karaoke-desktop')?.__vue__;
      if (!desktop) return;
      if (!desktop.lanRoom) {
        if (!desktop.selectedLanAddress && desktop.lanCandidates?.length) {
          desktop.selectedLanAddress = desktop.lanCandidates[0].address;
        }
        try {
          await desktop.startLanRoom();
        } catch (e) {
          console.warn('startLanRoom err:', e);
        }
      }
    });

    console.log('[EGO] Waiting for .reaction-layer...');
    await page.waitForSelector('.reaction-layer', { timeout: 15000 });
    console.log('[EGO] .reaction-layer is mounted!');

    // Get room joinUrl for client session
    const joinUrl = await page.evaluate(() => {
      const desktop = document.querySelector('.karaoke-desktop')?.__vue__;
      return desktop?.lanRoom?.joinUrl || '';
    });
    console.log('[EGO] Room joinUrl:', joinUrl);

    // Send real reaction via API
    const roomHash = new URL(joinUrl).hash.slice(7);
    console.log('[EGO] Requesting client session for room hash...');
    const sessionRes = await page.evaluate(async hash => {
      const res = await fetch('/ktv/api/client-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + hash,
        },
        body: '{}',
      });
      return res.json();
    }, roomHash);

    const clientToken = sessionRes.clientToken;
    console.log('[EGO] Got clientToken, sending reaction via /ktv/api/reactions...');

    const postReactionRes = await page.evaluate(async token => {
      const res = await fetch('/ktv/api/reactions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
        body: JSON.stringify({
          kind: 'cheer',
          effect: 'bounce',
          text: '放大20%字体放大30%',
        }),
      });
      return { status: res.status, ok: res.ok };
    }, clientToken);

    console.log('[EGO] Post reaction result:', postReactionRes);

    // Wait for the active reaction shot to render
    console.log('[EGO] Waiting for .reaction-shot.ready...');
    await page.waitForSelector('.reaction-shot.ready', { timeout: 10000 });
    console.log('[EGO] Shot ready element rendered on stage!');

    // Wait 900ms for zoom-in animation to finish entering and settle on scale(1.2)
    await page.evaluate(
      () => new Promise(resolve => setTimeout(resolve, 900))
    );

    const computed = await page.evaluate(() => {
      const renderEl = document.querySelector('.reaction-render');
      const spanEl = document.querySelector('.reaction-motion span');
      const motionEl = document.querySelector('.reaction-motion');
      if (!renderEl || !spanEl || !motionEl) return null;

      const rStyle = window.getComputedStyle(renderEl);
      const sStyle = window.getComputedStyle(spanEl);
      const mStyle = window.getComputedStyle(motionEl);

      return {
        renderTransform: rStyle.transform,
        renderTransformOrigin: rStyle.transformOrigin,
        renderAnimationName: rStyle.animationName,
        spanFontSize: sStyle.fontSize,
        spanFontWeight: sStyle.fontWeight,
        motionGap: mStyle.gap,
        motionWidth: mStyle.width,
        spanText: spanEl.textContent,
      };
    });

    console.log('[EGO] Computed styles:');
    console.log(JSON.stringify(computed, null, 2));

    await page.screenshot({ path: screenshotPath });
    console.log('[EGO] Screenshot saved to', screenshotPath);

    // Release master to restore initial vacant state
    await page.evaluate(() => {
      const v = document.querySelector('.karaoke-desktop')?.__vue__;
      if (v && v.$parent && typeof v.$parent.releaseMaster === 'function') {
        v.$parent.releaseMaster();
      }
    });

    return computed;
  } finally {
    console.log('[EGO] Finishing task space...');
    await task.finish({ keep: [] });
    console.log('[EGO] Task space cleaned up.');
  }
}

await run();
