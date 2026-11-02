// verify-static-room-ego.mjs
// E2E test verifying pure static room link via ego-browser

const routerUrl = 'http://192.168.100.1:18080/karaoke';
const staticRoomUrl = 'http://192.168.100.1:18080/room/';
const masterScreenshotPath =
  'C:/Users/Shilyfx/.gemini/antigravity/brain/dfee5c98-be24-403c-9d3b-4bf285c2cc05/master-static-link.png';
const guestScreenshotPath =
  'C:/Users/Shilyfx/.gemini/antigravity/brain/dfee5c98-be24-403c-9d3b-4bf285c2cc05/guest-static-entry.png';

export async function run() {
  const task = await taskSpace('verify pure static room link');
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

    // Activate lanRoom
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

    await master.waitForSelector('.room-link', { timeout: 15000 });
    const displayedLink = await master.evaluate(() => {
      return document.querySelector('.room-link')?.textContent?.trim();
    });

    console.log('[EGO] Displayed room link on master screen:', displayedLink);

    // Verify displayed link is pure static (no random code or hash token)
    if (!displayedLink.endsWith('/room/')) {
      throw new Error(`Room link is not pure static: ${displayedLink}`);
    }
    console.log('[EGO] PASS: Master screen shows pure static room link!');

    await master.screenshot({ path: masterScreenshotPath });
    console.log('[EGO] Master screenshot saved to', masterScreenshotPath);

    // Guest opens pure static URL directly with NO hash token
    console.log('[EGO] Guest opening pure static URL:', staticRoomUrl);
    await guest.cdp('Network.setBypassServiceWorker', { bypass: true });
    await guest.goto(staticRoomUrl);

    // Wait for remote UI to bootstrap and render modules
    await guest.waitForSelector('.module-nav, .nav-tab, header, .content', {
      timeout: 15000,
    });
    console.log('[EGO] Guest remote control successfully rendered!');

    // Check guest session state
    const guestState = await guest.evaluate(() => {
      const sessionKey = Object.keys(sessionStorage).find(k =>
        k.startsWith('yesplaymusic-ktv:')
      );
      const stored = sessionKey ? sessionStorage.getItem(sessionKey) : null;
      let session = null;
      try {
        session = JSON.parse(stored);
      } catch (_) {}
      return {
        sessionKey,
        hasSession: Boolean(session?.clientToken),
        displayName: session?.displayName,
        clientId: session?.clientId,
        hasEndedEl: Boolean(document.querySelector('.ended')),
      };
    });

    console.log('[EGO] Guest session state:', JSON.stringify(guestState, null, 2));

    if (!guestState.hasSession) {
      throw new Error('Guest failed to establish session from pure static URL');
    }
    if (guestState.hasEndedEl) {
      throw new Error('Guest showed ended screen erroneously');
    }

    console.log('[EGO] PASS: Guest successfully established session from pure static link!');

    // Test reaction sending from guest to master via pure static session
    const reactionSent = await guest.evaluate(async () => {
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
          text: '纯静态链接点歌成功',
        }),
      });
      return { ok: res.ok, status: res.status };
    });

    console.log('[EGO] Reaction from guest sent result:', reactionSent);
    if (!reactionSent.ok) {
      throw new Error(`Reaction send failed with status ${reactionSent.status}`);
    }

    // Verify reaction arrives on master screen
    await master.waitForSelector('.reaction-shot.ready', { timeout: 10000 });
    console.log('[EGO] PASS: Reaction triggered from guest successfully displayed on master!');

    await guest.screenshot({ path: guestScreenshotPath });
    console.log('[EGO] Guest screenshot saved to', guestScreenshotPath);

    // Release master to restore initial state
    await master.evaluate(() => {
      const v = document.querySelector('.karaoke-desktop')?.__vue__;
      if (v && v.$parent && typeof v.$parent.releaseMaster === 'function') {
        v.$parent.releaseMaster();
      }
    });

    console.log('[EGO] All pure static room link verifications passed!');
    return {
      displayedLink,
      guestState,
      reactionSent,
    };
  } finally {
    console.log('[EGO] Finishing task space...');
    await task.finish({ keep: [] });
    console.log('[EGO] Task space cleaned up.');
  }
}

await run();
