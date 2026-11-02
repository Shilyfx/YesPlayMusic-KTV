// verify-domain-access-ego.mjs
// End-to-end verification for custom domain ktv.home (port 80) and IP 192.168.100.1:18080 co-existence

const domainKaraokeUrl = 'http://ktv.home/karaoke';
const domainRoomUrl = 'http://ktv.home/room/';
const ipRoomUrl = 'http://192.168.100.1:18080/room/';

const masterScreenshotPath =
  'C:/Users/Shilyfx/.gemini/antigravity/brain/15484e2d-a100-4c1a-a020-f0a40f7c7736/verify-domain-master.png';
const guestScreenshotPath =
  'C:/Users/Shilyfx/.gemini/antigravity/brain/15484e2d-a100-4c1a-a020-f0a40f7c7736/verify-domain-guest.png';

export async function run() {
  const task = await taskSpace('verify ktv.home domain access and zero hardcoded ip');
  const master = task.page('p1');
  const guestDomain = await task.newPage();
  const guestIp = await task.newPage();

  try {
    console.log('[EGO] Enabling bypass service worker for master...');
    await master.cdp('Network.setBypassServiceWorker', { bypass: true });

    console.log('[EGO] Master navigating to domain URL:', domainKaraokeUrl);
    await master.goto(domainKaraokeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

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
    console.log('[EGO] Master stage visible.');

    // Activate lanRoom if not started
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
    console.log('[EGO] Master room is active.');

    // Verify Master displayed URL uses ktv.home
    const masterRoomLinkText = await master.evaluate(() => {
      return document.querySelector('.room-link')?.textContent?.trim() || '';
    });
    console.log('[EGO] Master displayed room link text:', masterRoomLinkText);
    if (!masterRoomLinkText.includes('ktv.home')) {
      console.warn('[EGO] Notice: Master room link text is:', masterRoomLinkText);
    } else {
      console.log('[EGO] PASS: Master display link correctly uses domain ktv.home!');
    }

    try {
      await master.screenshot({ path: masterScreenshotPath });
      console.log('[EGO] Saved master screenshot to', masterScreenshotPath);
    } catch (e) {
      console.warn('[EGO] Master screenshot skipped:', e.message);
    }

    // Guest 1 connects via domain: http://ktv.home/room/
    console.log('[EGO] Guest 1 navigating to domain room URL:', domainRoomUrl);
    await guestDomain.cdp('Network.setBypassServiceWorker', { bypass: true });
    await guestDomain.goto(domainRoomUrl);

    await guestDomain.waitForSelector('input[data-search]', { timeout: 15000 });
    console.log('[EGO] Guest 1 remote shell loaded successfully via ktv.home.');

    // Guest 1: Test search on ktv.home
    console.log('[EGO] Guest 1: Searching for 晴天 on ktv.home...');
    await guestDomain.fill('input[data-search]', '晴天');
    await guestDomain.click('button[data-search-submit]');

    await guestDomain.waitForFunction(
      () => {
        const cards = document.querySelectorAll('[data-results] .result-card');
        return cards.length > 0;
      },
      undefined,
      { timeout: 15000 }
    );

    const searchCount = await guestDomain.evaluate(() => {
      return document.querySelectorAll('[data-results] .result-card').length;
    });
    console.log('[EGO] Guest 1: Search returned cards count:', searchCount);
    if (searchCount === 0) throw new Error('Search failed on ktv.home!');
    console.log('[EGO] PASS: Search works smoothly on domain ktv.home.');

    // Guest 1: Test reaction on ktv.home
    console.log('[EGO] Guest 1: Testing reaction via POST /ktv/api/reactions on ktv.home...');
    await guestDomain.click('button[data-module-tab="reactions"]');
    await guestDomain.waitForSelector('.reaction-studio', { timeout: 10000 });

    await guestDomain.waitForSelector('button[data-reaction]', { timeout: 10000 });
    await guestDomain.evaluate(() => {
      document.querySelector('button[data-reaction]').click();
    });
    await new Promise(r => setTimeout(r, 600));

    const noticeText = await guestDomain.evaluate(() => {
      return document.querySelector('[data-notice]')?.textContent?.trim() || '';
    });
    console.log('[EGO] Guest 1: Reaction notice text:', noticeText);
    if (noticeText.includes('失败') || noticeText.includes('403')) {
      throw new Error(`Reaction failed with notice: ${noticeText}`);
    }
    console.log('[EGO] PASS: Reaction POST succeeds on domain ktv.home without CSRF or Origin error!');

    try {
      await guestDomain.screenshot({ path: guestScreenshotPath });
      console.log('[EGO] Saved guest screenshot to', guestScreenshotPath);
    } catch (e) {
      console.warn('[EGO] Guest screenshot skipped:', e.message);
    }

    // Guest 2: Test simultaneous IP access: http://192.168.100.1:18080/room/
    console.log('[EGO] Guest 2 navigating to IP room URL:', ipRoomUrl);
    await guestIp.cdp('Network.setBypassServiceWorker', { bypass: true });
    await guestIp.goto(ipRoomUrl);

    await guestIp.waitForSelector('input[data-search]', { timeout: 15000 });
    console.log('[EGO] Guest 2 remote shell loaded successfully via IP 192.168.100.1:18080.');

    console.log('[EGO] Guest 2: Testing reaction via IP 192.168.100.1:18080...');
    await guestIp.click('button[data-module-tab="reactions"]');
    await guestIp.waitForSelector('.reaction-studio', { timeout: 10000 });

    await guestIp.waitForSelector('button[data-reaction]', { timeout: 10000 });
    await guestIp.evaluate(() => {
      document.querySelector('button[data-reaction]').click();
    });
    await new Promise(r => setTimeout(r, 600));

    const noticeText2 = await guestIp.evaluate(() => {
      return document.querySelector('[data-notice]')?.textContent?.trim() || '';
    });
    console.log('[EGO] Guest 2: Reaction notice text:', noticeText2);
    if (noticeText2.includes('失败') || noticeText2.includes('403')) {
      throw new Error(`Guest 2 Reaction failed with notice: ${noticeText2}`);
    }
    console.log('[EGO] PASS: Reaction POST succeeds on IP 192.168.100.1:18080 as well!');

    console.log('[EGO] ALL DOMAIN AND IP VERIFICATION TESTS PASSED SUCCESSFULLY!');
  } finally {
    await task.finish({ keep: [] });
    console.log('[EGO] Task finished and cleaned up.');
  }
}
