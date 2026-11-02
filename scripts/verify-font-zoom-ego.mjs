// verify-font-zoom-ego.mjs
// E2E verification of reaction font enlargement (+20% -> 37.44px) and 8-char wrapping rule

const routerUrl = 'http://192.168.100.1:18080/karaoke';
const screenshotPath =
  'C:/Users/Shilyfx/.gemini/antigravity/brain/dfee5c98-be24-403c-9d3b-4bf285c2cc05/reaction-font-zoom-8char.png';

export async function run() {
  const task = await taskSpace('verify font zoom and 8-char wrap');
  const master = task.page('p1');
  const guest = await task.newPage();

  try {
    console.log('[EGO] Enabling bypass service worker for master...');
    await master.cdp('Network.setBypassServiceWorker', { bypass: true });

    console.log('[EGO] Master navigating to', routerUrl);
    await master.goto(routerUrl);

    // Designate master if needed
    await master.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('button')).some(b =>
          b.textContent.includes('将本机设为主电脑')
        ) || !!document.querySelector('.stage'),
      undefined,
      { timeout: 15000 }
    );

    const hasMasterBtn = await master.evaluate(() => {
      return Array.from(document.querySelectorAll('button')).some(b =>
        b.textContent.includes('将本机设为主电脑')
      );
    });

    if (hasMasterBtn) {
      console.log('[EGO] Clicking 将本机设为主电脑...');
      await master.click('text="将本机设为主电脑"', { label: '设为主电脑' });
    }

    await master.waitForSelector('.stage', { timeout: 15000 });
    console.log('[EGO] Stage visible.');

    // Activate lanRoom if not active
    await master.evaluate(async () => {
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

    // Guest opens static room URL to join
    console.log('[EGO] Guest joining room via static URL...');
    await guest.cdp('Network.setBypassServiceWorker', { bypass: true });
    await guest.goto('http://192.168.100.1:18080/room/');

    await guest.waitForSelector('.module-nav, .nav-tab, header, .content', {
      timeout: 15000,
    });
    console.log('[EGO] Guest connected.');

    // Helper to send reaction from guest
    async function sendGuestReaction(text) {
      return guest.evaluate(async (msg) => {
        const sessionKey = Object.keys(sessionStorage).find(k =>
          k.startsWith('yesplaymusic-ktv:')
        );
        const stored = sessionKey ? sessionStorage.getItem(sessionKey) : null;
        const session = JSON.parse(stored);
        const res = await fetch('/ktv/api/reactions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + session.clientToken,
          },
          body: JSON.stringify({
            kind: 'cheer',
            effect: 'bounce',
            customText: msg,
            text: msg,
          }),
        });
        return { ok: res.ok, status: res.status };
      }, text);
    }

    // TEST 1: Send reaction with <= 8 chars: '一二三四五六七八' (8 characters)
    console.log('[EGO] Sending 8-character reaction: 一二三四五六七八');
    const res8 = await sendGuestReaction('一二三四五六七八');
    console.log('[EGO] Reaction 8 sent:', res8);

    await master.waitForSelector('.reaction-shot.ready .reaction-motion span', {
      timeout: 10000,
    });

    const info8 = await master.evaluate(() => {
      const span = document.querySelector('.reaction-shot.ready .reaction-motion span');
      const cs = window.getComputedStyle(span);
      const range = document.createRange();
      const node = span.firstChild;
      const rects = [];
      for (let i = 0; i < node.length; i++) {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        rects.push(range.getBoundingClientRect());
      }
      const lines = [];
      rects.forEach(r => {
        if (!lines.some(l => Math.abs(l.top - r.top) < 5)) {
          lines.push(r);
        }
      });
      return {
        text: span.textContent.trim(),
        chars: span.textContent.trim().length,
        fontSize: cs.fontSize,
        width: cs.width,
        maxWidth: cs.maxWidth,
        offsetWidth: span.offsetWidth,
        offsetHeight: span.offsetHeight,
        lines: lines.length,
      };
    });

    console.log('[EGO] 8-char reaction measurement on master:', JSON.stringify(info8, null, 2));

    if (info8.fontSize !== '37.44px') {
      throw new Error(`Font size expected 37.44px, got ${info8.fontSize}`);
    }
    if (info8.lines !== 1) {
      throw new Error(`8-char text expected 1 line without wrapping, got ${info8.lines}`);
    }
    console.log('[EGO] PASS: 8 characters fits on 1 line without wrapping, fontSize is 37.44px (+20%)!');

    // Wait for first reaction to finish
    await new Promise(r => setTimeout(r, 4500));

    // TEST 2: Send reaction with > 8 chars: '纯静态链接点歌成功' (9 characters)
    console.log('[EGO] Sending 9-character reaction: 纯静态链接点歌成功');
    const res9 = await sendGuestReaction('纯静态链接点歌成功');
    console.log('[EGO] Reaction 9 sent:', res9);

    await master.waitForSelector('.reaction-shot.ready .reaction-motion span', {
      timeout: 10000,
    });

    const info9 = await master.evaluate(() => {
      const span = document.querySelector('.reaction-shot.ready .reaction-motion span');
      const cs = window.getComputedStyle(span);
      const range = document.createRange();
      const node = span.firstChild;
      const rects = [];
      for (let i = 0; i < node.length; i++) {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        rects.push(range.getBoundingClientRect());
      }
      const lines = [];
      rects.forEach(r => {
        if (!lines.some(l => Math.abs(l.top - r.top) < 5)) {
          lines.push(r);
        }
      });
      return {
        text: span.textContent.trim(),
        chars: span.textContent.trim().length,
        fontSize: cs.fontSize,
        offsetWidth: span.offsetWidth,
        offsetHeight: span.offsetHeight,
        lines: lines.length,
      };
    });

    console.log('[EGO] 9-char reaction measurement on master:', JSON.stringify(info9, null, 2));

    if (info9.lines !== 2) {
      throw new Error(`9-char text expected to wrap to 2 lines, got ${info9.lines}`);
    }
    console.log('[EGO] PASS: 9 characters successfully wrapped to 2 lines!');

    // Save screenshot of the wrapped 9-character reaction
    await master.screenshot({ path: screenshotPath });
    console.log('[EGO] Master screenshot saved to', screenshotPath);

    // Release master
    await master.evaluate(() => {
      const v = document.querySelector('.karaoke-desktop')?.__vue__;
      if (v && v.$parent && typeof v.$parent.releaseMaster === 'function') {
        v.$parent.releaseMaster();
      }
    });

    console.log('[EGO] All font zoom and 8-char wrapping tests passed!');
    return { info8, info9 };
  } finally {
    console.log('[EGO] Finishing task space...');
    await task.finish({ keep: [] });
    console.log('[EGO] Task space cleaned up.');
  }
}

await run();
