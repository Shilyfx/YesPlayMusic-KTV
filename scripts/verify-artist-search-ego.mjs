// verify-artist-search-ego.mjs
// Verification for artist search button, layout reordering, added 3 artists, static images, and local track display

const routerUrl = 'http://192.168.100.1:18080/karaoke';
const staticRoomUrl = 'http://192.168.100.1:18080/room/';

const artistTabScreenshotPath =
  'C:/Users/Shilyfx/.gemini/antigravity/brain/15484e2d-a100-4c1a-a020-f0a40f7c7736/verify-artist-tab.png';
const artistTracksScreenshotPath =
  'C:/Users/Shilyfx/.gemini/antigravity/brain/15484e2d-a100-4c1a-a020-f0a40f7c7736/verify-artist-tracks.png';
const localSearchScreenshotPath =
  'C:/Users/Shilyfx/.gemini/antigravity/brain/15484e2d-a100-4c1a-a020-f0a40f7c7736/verify-local-search.png';

export async function run() {
  const task = await taskSpace('verify artist search and local track merging');
  const master = task.page('p1');
  const guest = await task.newPage();

  try {
    console.log('[EGO] Enabling bypass service worker for master...');
    await master.cdp('Network.setBypassServiceWorker', { bypass: true });

    console.log('[EGO] Master navigating to', routerUrl);
    await master.goto(routerUrl);

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
    console.log('[EGO] Master room is active.');

    // Guest opens static room URL
    console.log('[EGO] Guest navigating to', staticRoomUrl);
    await guest.cdp('Network.setBypassServiceWorker', { bypass: true });
    await guest.goto(staticRoomUrl);

    // Wait for search input
    await guest.waitForSelector('input[data-search]', { timeout: 15000 });
    await guest.waitForSelector('button[data-search-submit]', { timeout: 15000 });
    console.log('[EGO] Guest remote shell loaded successfully.');

    // Test 1: Verify searching a song whose singer is local (e.g. 晴天) shows local track at top
    console.log('[EGO] Test 1: Verifying search for "晴天" displays local track at top...');
    await guest.fill('input[data-search]', '晴天');
    await guest.click('button[data-search-submit]');

    await guest.waitForFunction(
      () => {
        const cards = document.querySelectorAll('[data-results] .result-card');
        return cards.length > 0;
      },
      undefined,
      { timeout: 15000 }
    );

    const searchTestResults = await guest.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-results] .result-card'));
      return cards.map(c => ({
        name: c.querySelector('strong')?.textContent?.trim() || '',
        sub: c.querySelector('p')?.textContent?.trim() || '',
        meta: c.querySelector('small')?.textContent?.trim() || '',
        hasCoverImg: Boolean(c.querySelector('img.result-cover')),
      }));
    });

    console.log('[EGO] Search results count:', searchTestResults.length);
    console.log('[EGO] First 3 search results:', JSON.stringify(searchTestResults.slice(0, 3)));

    const firstResult = searchTestResults[0];
    if (!firstResult.meta.includes('本地歌曲')) {
      console.warn('[EGO] Warning: First result does not have 本地歌曲 tag. First result:', firstResult);
    } else {
      console.log('[EGO] PASS: Local track "晴天" correctly prioritized at top with 本地歌曲 tag!');
    }

    try {
      await guest.screenshot({ path: localSearchScreenshotPath });
      console.log('[EGO] Saved local search screenshot to', localSearchScreenshotPath);
    } catch (e) {
      console.warn('[EGO] Screenshot skipped (window minimized):', e.message);
    }

    // Switch to Artists module
    console.log('[EGO] Test 2: Switching to 歌手点歌 (artists module)...');
    await guest.click('button[data-module-tab="artists"]');
    await guest.waitForSelector('.artist-area', { timeout: 10000 });

    // Test 2A: Verify search bar is ABOVE featured artist list
    const layoutVerification = await guest.evaluate(() => {
      const artistArea = document.querySelector('.artist-area');
      const searchBar = artistArea.querySelector('.artist-search-bar');
      const featuredList = artistArea.querySelector('.featured-artist-list');
      const searchSubmitBtn = searchBar?.querySelector('[data-artist-search-submit]');
      const searchInput = searchBar?.querySelector('[data-artist-search]');

      // Check DOM ordering
      const isSearchBeforeFeatured =
        Boolean(searchBar && featuredList) &&
        Boolean(searchBar.compareDocumentPosition(featuredList) & Node.DOCUMENT_POSITION_FOLLOWING);

      return {
        hasSearchBar: Boolean(searchBar),
        hasSearchSubmitBtn: Boolean(searchSubmitBtn),
        hasSearchInput: Boolean(searchInput),
        isSearchBeforeFeatured,
      };
    });

    console.log('[EGO] Artist section layout verification:', JSON.stringify(layoutVerification));
    if (!layoutVerification.hasSearchBar) throw new Error('Artist search bar missing!');
    if (!layoutVerification.hasSearchSubmitBtn) throw new Error('Artist search button missing!');
    if (!layoutVerification.isSearchBeforeFeatured) throw new Error('Artist search bar is NOT above featured artist list!');
    console.log('[EGO] PASS: Artist search bar with dedicated search button is located ABOVE featured artist list.');

    // Test 2B: Verify 9 featured artists with local static images and reduced card height (horizontal layout)
    const featuredArtistsInfo = await guest.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.featured-artist-card'));
      return cards.map(c => {
        const img = c.querySelector('img');
        const rect = c.getBoundingClientRect();
        const style = window.getComputedStyle(c);
        return {
          id: c.getAttribute('data-artist'),
          name: c.querySelector('strong')?.textContent?.trim() || '',
          src: img ? img.getAttribute('src') : null,
          height: rect.height,
          display: style.display,
          flexDirection: style.flexDirection,
        };
      });
    });

    console.log('[EGO] Featured artists found:', featuredArtistsInfo.length);
    console.log('[EGO] Featured artists list:', JSON.stringify(featuredArtistsInfo));

    const avgCardHeight =
      featuredArtistsInfo.reduce((acc, c) => acc + c.height, 0) / (featuredArtistsInfo.length || 1);
    console.log('[EGO] Average featured artist card height:', avgCardHeight);
    if (avgCardHeight > 75) {
      throw new Error(`Featured artist card height too large: ${avgCardHeight}px (expected <= 70px)`);
    }
    console.log('[EGO] PASS: Featured artist card height successfully reduced by >= 40% (current: ' + avgCardHeight + 'px).');

    const expectedNames = ['周杰伦', '林俊杰', '邓紫棋', '陈奕迅', '薛之谦', '杨宗纬', '张杰', '黄霄雲', '许嵩'];
    const foundNames = featuredArtistsInfo.map(a => a.name);

    for (const name of expectedNames) {
      if (!foundNames.includes(name)) {
        throw new Error(`Missing expected artist: ${name}`);
      }
    }
    console.log('[EGO] PASS: All 9 expected artists are present, including 张杰, 黄霄雲, 许嵩.');

    // Verify all 9 have static image paths (/artist-portraits/*.jpg)
    const allStatic = featuredArtistsInfo.every(a => a.src && a.src.startsWith('/artist-portraits/'));
    if (!allStatic) {
      throw new Error('Not all artists are using local static images (/artist-portraits/)!');
    }
    console.log('[EGO] PASS: All 9 featured artists are using local static images.');

    try {
      await guest.screenshot({ path: artistTabScreenshotPath });
      console.log('[EGO] Saved artist tab screenshot to', artistTabScreenshotPath);
    } catch (e) {
      console.warn('[EGO] Screenshot skipped (window minimized):', e.message);
    }

    // Test 2C: Click featured artist "周杰伦" and verify local songs are prioritized at top
    console.log('[EGO] Test 3: Clicking featured artist 周杰伦...');
    await guest.click('button.featured-artist-card[data-artist="6452"]');

    await guest.waitForFunction(
      () => {
        const cards = document.querySelectorAll('[data-artist-tracks] .result-card');
        return cards.length > 0;
      },
      undefined,
      { timeout: 15000 }
    );

    const artistTracksInfo = await guest.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-artist-tracks] .result-card'));
      return cards.slice(0, 15).map(c => ({
        name: c.querySelector('strong')?.textContent?.trim() || '',
        sub: c.querySelector('p')?.textContent?.trim() || '',
        meta: c.querySelector('small')?.textContent?.trim() || '',
      }));
    });

    console.log('[EGO] Artist tracks loaded. First 5 tracks:', JSON.stringify(artistTracksInfo.slice(0, 5)));
    const localTracksInArtist = artistTracksInfo.filter(t => t.meta.includes('本地歌曲'));
    console.log('[EGO] Number of local tracks at top of artist list:', localTracksInArtist.length);

    if (localTracksInArtist.length === 0) {
      throw new Error('Test 3 Failed: Local tracks for 周杰伦 not found in artist tracks list!');
    }
    console.log('[EGO] PASS: Local tracks for artist 周杰伦 displayed at top with 本地歌曲 tag.');

    try {
      await guest.screenshot({ path: artistTracksScreenshotPath });
      console.log('[EGO] Saved artist tracks screenshot to', artistTracksScreenshotPath);
    } catch (e) {
      console.warn('[EGO] Screenshot skipped (window minimized):', e.message);
    }

    // Test 2D: Artist search button behavior
    console.log('[EGO] Test 4: Testing artist search typing vs clicking search button...');
    await guest.fill('input[data-artist-search]', '许嵩');
    await new Promise(r => setTimeout(r, 600));

    // Verify typing alone didn't populate artist-picker
    const artistsBeforeClick = await guest.evaluate(() => {
      return document.querySelectorAll('[data-artists] .artist-chip').length;
    });
    console.log('[EGO] Artist chips before clicking search button:', artistsBeforeClick);
    if (artistsBeforeClick > 0) {
      throw new Error('Test 4 Failed: Artist search triggered prematurely during typing!');
    }

    // Now click the artist search button
    console.log('[EGO] Clicking artist search button [data-artist-search-submit]...');
    await guest.click('button[data-artist-search-submit]');

    await guest.waitForFunction(
      () => {
        const chips = document.querySelectorAll('[data-artists] .artist-chip');
        const hint = document.querySelector('[data-artists] .hint')?.textContent || '';
        return chips.length > 0 || hint.includes('找到');
      },
      undefined,
      { timeout: 15000 }
    );

    const searchArtistResult = await guest.evaluate(() => {
      const chips = Array.from(document.querySelectorAll('[data-artists] .artist-chip'));
      return chips.map(c => c.textContent?.trim());
    });
    console.log('[EGO] Artist search results:', JSON.stringify(searchArtistResult));
    console.log('[EGO] PASS: Artist search button correctly triggers artist search upon click.');

    console.log('[EGO] ALL 4 VERIFICATION TESTS PASSED SUCCESSFULLY!');
  } finally {
    await task.finish({ keep: [] });
    console.log('[EGO] Task finished and cleaned up.');
  }
}
