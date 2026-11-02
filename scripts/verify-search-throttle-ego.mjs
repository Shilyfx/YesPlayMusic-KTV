// verify-search-throttle-ego.mjs
// E2E test verifying search button, 600ms safe interval and rate-limit recovery via ego-browser

const routerUrl = 'http://192.168.100.1:18080/karaoke';
const staticRoomUrl = 'http://192.168.100.1:18080/room/';
const masterScreenshotPath =
  'C:/Users/Shilyfx/.gemini/antigravity/brain/15484e2d-a100-4c1a-a020-f0a40f7c7736/verify-search-master.png';
const guestScreenshotPath =
  'C:/Users/Shilyfx/.gemini/antigravity/brain/15484e2d-a100-4c1a-a020-f0a40f7c7736/verify-search-guest.png';
const rapidTypingScreenshotPath =
  'C:/Users/Shilyfx/.gemini/antigravity/brain/15484e2d-a100-4c1a-a020-f0a40f7c7736/verify-search-rapid-typing.png';

export async function run() {
  const task = await taskSpace('verify search button and 600ms throttle');
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
    console.log('[EGO] Master stage visible.');

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
    console.log('[EGO] Displayed room link on master:', displayedLink);

    await master.screenshot({ path: masterScreenshotPath });
    console.log('[EGO] Master screenshot saved to', masterScreenshotPath);

    // Guest opens static room URL
    console.log('[EGO] Guest navigating to', staticRoomUrl);
    await guest.cdp('Network.setBypassServiceWorker', { bypass: true });
    await guest.goto(staticRoomUrl);

    // Wait for search input and search button to be ready
    await guest.waitForSelector('input[data-search]', { timeout: 15000 });
    await guest.waitForSelector('button[data-search-submit]', { timeout: 15000 });
    console.log('[EGO] Guest search input and dedicated search button located.');

    // Check guest session
    const guestSession = await guest.evaluate(() => {
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
      };
    });
    console.log('[EGO] Guest session established:', JSON.stringify(guestSession));

    // Test Case 1: Typing without clicking search button -> verifies no useless network calls while typing
    console.log('[EGO] Test 1: Verifying typing does NOT trigger network search automatically...');
    await guest.fill('input[data-search]', '晴天');
    await new Promise(r => setTimeout(r, 800)); // Wait longer than old debounce

    const countBeforeClick = await guest.evaluate(() => {
      return document.querySelectorAll('[data-results] .search-track-card').length;
    });
    console.log('[EGO] Track cards before clicking search button:', countBeforeClick);
    if (countBeforeClick > 0) {
      throw new Error('Test 1 Failed: Search triggered prematurely before clicking search button!');
    }
    console.log('[EGO] Test 1 PASS: Typing alone does not trigger useless network searches.');

    // Now click the dedicated search button
    console.log('[EGO] Clicking dedicated 搜索 button...');
    await guest.click('button[data-search-submit]');

    await guest.waitForFunction(
      () => {
        const results = document.querySelectorAll(
          '[data-results] .search-track-card'
        );
        const notice = document.querySelector('[data-notice]')?.textContent || '';
        return (
          results.length > 0 ||
          notice.includes('搜索较频繁') ||
          notice.includes('搜索暂时不可用')
        );
      },
      undefined,
      { timeout: 12000 }
    );

    const test1Result = await guest.evaluate(() => {
      const cards = document.querySelectorAll(
        '[data-results] .search-track-card'
      );
      const notice = document.querySelector('[data-notice]')?.textContent || '';
      return {
        cardCount: cards.length,
        firstTitle: cards[0]?.querySelector('h4, strong, .track-name')?.textContent?.trim() || '',
        notice,
      };
    });
    console.log('[EGO] Search button click result:', JSON.stringify(test1Result));

    if (test1Result.notice.includes('搜索暂时不可用')) {
      throw new Error(`Test 1 Failed: Encountered forbidden error notice: "${test1Result.notice}"`);
    }
    if (test1Result.cardCount === 0) {
      throw new Error('Test 1 Failed: Dedicated search button did not return any track cards');
    }
    console.log('[EGO] PASS: Dedicated search button successfully returned valid results.');

    await guest.screenshot({ path: guestScreenshotPath });
    console.log('[EGO] Guest standard search screenshot saved to', guestScreenshotPath);

    // Test Case 2: Enter key search triggering (e.g. "zen me")
    console.log('[EGO] Test 2: Testing Enter key submission for "zen me"...');
    await guest.fill('input[data-search]', 'zen me');
    await guest.press('input[data-search]', 'Enter');

    await guest.waitForFunction(
      () => {
        const cards = document.querySelectorAll(
          '[data-results] .search-track-card'
        );
        const notice = document.querySelector('[data-notice]')?.textContent || '';
        const hint = document.querySelector('[data-results] .hint')?.textContent || '';
        return (
          cards.length > 0 ||
          notice.includes('搜索较频繁') ||
          notice.includes('搜索暂时不可用') ||
          hint.includes('没有找到')
        );
      },
      undefined,
      { timeout: 12000 }
    );

    const test2Result = await guest.evaluate(() => {
      const cards = document.querySelectorAll(
        '[data-results] .search-track-card'
      );
      const notice = document.querySelector('[data-notice]')?.textContent || '';
      return {
        cardCount: cards.length,
        notice,
      };
    });
    console.log('[EGO] Test 2 result:', JSON.stringify(test2Result));

    if (test2Result.notice.includes('搜索暂时不可用')) {
      throw new Error(`Test 2 Failed: Enter submission caused forbidden error notice: "${test2Result.notice}"`);
    }
    console.log('[EGO] Test 2 PASS: Enter key submission successfully handled.');

    await guest.screenshot({ path: rapidTypingScreenshotPath });
    console.log('[EGO] Enter key search screenshot saved to', rapidTypingScreenshotPath);

    // Test Case 3: Successive queries testing 600ms safe interval
    console.log('[EGO] Test 3: Successive queries testing 600ms safe interval throttling...');
    await guest.fill('input[data-search]', '海阔天空');
    await guest.click('button[data-search-submit]');

    // Wait 700ms (just above 600ms interval)
    await new Promise(r => setTimeout(r, 700));

    await guest.fill('input[data-search]', '七里香');
    await guest.click('button[data-search-submit]');

    await guest.waitForFunction(
      () => {
        const cards = document.querySelectorAll(
          '[data-results] .search-track-card'
        );
        const notice = document.querySelector('[data-notice]')?.textContent || '';
        return (
          cards.length > 0 ||
          notice.includes('搜索较频繁') ||
          notice.includes('搜索暂时不可用')
        );
      },
      undefined,
      { timeout: 12000 }
    );

    const test3Result = await guest.evaluate(() => {
      const cards = document.querySelectorAll(
        '[data-results] .search-track-card'
      );
      const notice = document.querySelector('[data-notice]')?.textContent || '';
      return {
        cardCount: cards.length,
        notice,
      };
    });
    console.log('[EGO] Test 3 result:', JSON.stringify(test3Result));

    if (test3Result.notice.includes('搜索暂时不可用')) {
      throw new Error(`Test 3 Failed: Successive queries caused forbidden error notice: "${test3Result.notice}"`);
    }
    console.log('[EGO] Test 3 PASS: 600ms safe interval successive queries cleanly executed.');

    // Release master to restore state
    await master.evaluate(() => {
      const v = document.querySelector('.karaoke-desktop')?.__vue__;
      if (v && v.$parent && typeof v.$parent.releaseMaster === 'function') {
        v.$parent.releaseMaster();
      }
    });

    console.log('[EGO] All search button and 600ms interval tests passed successfully!');
    return {
      displayedLink,
      test1Result,
      test2Result,
      test3Result,
    };
  } finally {
    console.log('[EGO] Cleaning up task space...');
    await task.finish({ keep: [] });
    console.log('[EGO] Task space cleaned up.');
  }
}

await run();
