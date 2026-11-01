// verify-artist-search-ego.mjs
// End-to-end verification for artist search, hiding featured artists upon search,
// artist tracks pagination ("加载更多"), and playlist tracks pagination ("加载更多").

const routerUrl = 'http://192.168.100.1:18080/karaoke';
const staticRoomUrl = 'http://192.168.100.1:18080/room/';

const artistTabScreenshotPath =
  'C:/Users/Shilyfx/.gemini/antigravity/brain/15484e2d-a100-4c1a-a020-f0a40f7c7736/verify-artist-tab.png';
const artistTracksScreenshotPath =
  'C:/Users/Shilyfx/.gemini/antigravity/brain/15484e2d-a100-4c1a-a020-f0a40f7c7736/verify-artist-tracks.png';
const localSearchScreenshotPath =
  'C:/Users/Shilyfx/.gemini/antigravity/brain/15484e2d-a100-4c1a-a020-f0a40f7c7736/verify-local-search.png';

export async function run() {
  const task = await taskSpace('verify artist search and pagination fixes');
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

    await guest.waitForSelector('input[data-search]', { timeout: 15000 });
    await guest.waitForSelector('button[data-search-submit]', {
      timeout: 15000,
    });
    console.log('[EGO] Guest remote shell loaded successfully.');

    // Switch to Artists module
    console.log('[EGO] Test 1: Switching to 歌手点歌 (artists module)...');
    await guest.click('button[data-module-tab="artists"]');
    await guest.waitForSelector('.artist-area', { timeout: 10000 });

    // Verify featured artists are visible initially
    const initialFeaturedState = await guest.evaluate(() => {
      const container = document.querySelector('[data-featured-artists]');
      const style = container ? window.getComputedStyle(container) : null;
      return {
        hidden: container?.hidden ?? null,
        display: style?.display ?? null,
        cardCount: document.querySelectorAll('.featured-artist-card').length,
      };
    });
    console.log(
      '[EGO] Initial featured artists state:',
      JSON.stringify(initialFeaturedState)
    );
    if (
      initialFeaturedState.hidden !== false ||
      initialFeaturedState.display === 'none' ||
      initialFeaturedState.cardCount !== 9
    ) {
      throw new Error('Initial featured artists should be visible with 9 cards!');
    }

    // Test 2: Click featured artist "周杰伦" and verify > 30 tracks + "加载更多" button works!
    console.log(
      '[EGO] Test 2: Clicking featured artist 周杰伦 to verify pagination and 加载更多...'
    );
    await guest.click('button.featured-artist-card[data-artist="6452"]');

    await guest.waitForFunction(
      () => {
        const cards = document.querySelectorAll(
          '[data-artist-tracks] .artist-track-card'
        );
        const btn = document.querySelector('[data-artist-track-more]');
        return cards.length > 50 && btn && !btn.disabled;
      },
      undefined,
      { timeout: 15000 }
    );

    const artistPage1State = await guest.evaluate(() => {
      const cards = document.querySelectorAll(
        '[data-artist-tracks] .artist-track-card'
      );
      const status =
        document
          .querySelector('[data-artist-track-status]')
          ?.textContent?.trim() || '';
      const btn = document.querySelector('[data-artist-track-more]');
      const btnStyle = btn ? window.getComputedStyle(btn) : null;
      return {
        cardCount: cards.length,
        status,
        moreBtnHidden: btn?.hidden ?? true,
        moreBtnDisplay: btnStyle?.display ?? 'none',
        moreBtnText: btn?.textContent?.trim() || '',
      };
    });
    console.log(
      '[EGO] Artist Page 1 state:',
      JSON.stringify(artistPage1State)
    );
    if (artistPage1State.cardCount <= 30) {
      throw new Error(
        `Expected > 30 artist tracks on page 1, got ${artistPage1State.cardCount}`
      );
    }
    if (
      artistPage1State.moreBtnHidden ||
      artistPage1State.moreBtnDisplay === 'none'
    ) {
      throw new Error('Artist tracks 加载更多 button is hidden!');
    }
    console.log(
      '[EGO] PASS: Artist tracks page 1 loaded ' +
        artistPage1State.cardCount +
        ' tracks and 加载更多 button is visible (' +
        artistPage1State.status +
        ').'
    );

    try {
      await guest.screenshot({ path: artistTracksScreenshotPath });
      console.log(
        '[EGO] Saved artist tracks screenshot to',
        artistTracksScreenshotPath
      );
    } catch (e) {
      console.warn('[EGO] Screenshot skipped:', e.message);
    }

    // Click "加载更多" on artist tracks
    console.log('[EGO] Clicking [data-artist-track-more] to load page 2...');
    await guest.click('button[data-artist-track-more]');

    await guest.waitForFunction(
      prevCount => {
        const cards = document.querySelectorAll(
          '[data-artist-tracks] .artist-track-card'
        );
        const btn = document.querySelector('[data-artist-track-more]');
        return cards.length > prevCount && btn && !btn.disabled;
      },
      artistPage1State.cardCount,
      { timeout: 15000 }
    );

    const artistPage2State = await guest.evaluate(() => {
      const cards = document.querySelectorAll(
        '[data-artist-tracks] .artist-track-card'
      );
      const status =
        document
          .querySelector('[data-artist-track-status]')
          ?.textContent?.trim() || '';
      return {
        cardCount: cards.length,
        status,
      };
    });
    console.log(
      '[EGO] Artist Page 2 state:',
      JSON.stringify(artistPage2State)
    );
    console.log(
      '[EGO] PASS: Artist tracks 加载更多 loaded page 2 successfully (' +
        artistPage1State.cardCount +
        ' -> ' +
        artistPage2State.cardCount +
        ' tracks)!'
    );

    // Test 3: Search for artist "汪苏泷", verify featured artists are HIDDEN after search succeeds
    console.log(
      '[EGO] Test 3: Searching for artist "汪苏泷" and verifying default featured artists are hidden...'
    );
    await guest.fill('input[data-artist-search]', '汪苏泷');
    await guest.click('button[data-artist-search-submit]');

    await guest.waitForFunction(
      () => {
        const chips = document.querySelectorAll('[data-artists] .artist-chip');
        return chips.length > 0;
      },
      undefined,
      { timeout: 15000 }
    );

    const afterSearchFeaturedState = await guest.evaluate(() => {
      const container = document.querySelector('[data-featured-artists]');
      const style = container ? window.getComputedStyle(container) : null;
      const chips = document.querySelectorAll('[data-artists] .artist-chip');
      return {
        featuredHiddenAttr: container?.hidden ?? null,
        featuredDisplay: style?.display ?? null,
        searchResultCount: chips.length,
        firstResultId: chips[0]?.getAttribute('data-artist') || '',
        firstResultText: chips[0]?.textContent?.trim() || '',
      };
    });
    console.log(
      '[EGO] State after searching 汪苏泷:',
      JSON.stringify(afterSearchFeaturedState)
    );

    if (
      !afterSearchFeaturedState.featuredHiddenAttr ||
      afterSearchFeaturedState.featuredDisplay !== 'none'
    ) {
      throw new Error(
        'Featured artists were NOT hidden after artist search succeeded!'
      );
    }
    console.log(
      '[EGO] PASS: Default featured artists are hidden (display: none) when search results are displayed!'
    );

    try {
      await guest.screenshot({ path: artistTabScreenshotPath });
      console.log(
        '[EGO] Saved artist search screenshot to',
        artistTabScreenshotPath
      );
    } catch (e) {
      console.warn('[EGO] Screenshot skipped:', e.message);
    }

    // Click the first searched artist ("汪苏泷") and verify its tracks + "加载更多" button
    console.log('[EGO] Clicking searched artist 汪苏泷...');
    await guest.click(
      `button.artist-chip[data-artist="${afterSearchFeaturedState.firstResultId}"]`
    );

    await guest.waitForFunction(
      () => {
        const cards = document.querySelectorAll(
          '[data-artist-tracks] .artist-track-card'
        );
        const btn = document.querySelector('[data-artist-track-more]');
        return cards.length > 30 && btn && !btn.disabled;
      },
      undefined,
      { timeout: 15000 }
    );

    const searchedArtistTracksState = await guest.evaluate(() => {
      const cards = document.querySelectorAll(
        '[data-artist-tracks] .artist-track-card'
      );
      const status =
        document
          .querySelector('[data-artist-track-status]')
          ?.textContent?.trim() || '';
      const btn = document.querySelector('[data-artist-track-more]');
      return {
        cardCount: cards.length,
        status,
        moreBtnHidden: btn?.hidden ?? true,
      };
    });
    console.log(
      '[EGO] Searched artist 汪苏泷 tracks state:',
      JSON.stringify(searchedArtistTracksState)
    );
    if (searchedArtistTracksState.moreBtnHidden) {
      throw new Error('Searched artist 汪苏泷 加载更多 button is hidden!');
    }
    console.log(
      '[EGO] PASS: Searched artist 汪苏泷 shows ' +
        searchedArtistTracksState.cardCount +
        ' tracks and visible 加载更多 button!'
    );

    // Clear artist search input and verify featured artists reappear
    console.log(
      '[EGO] Clearing artist search input to verify featured artists reappear...'
    );
    await guest.fill('input[data-artist-search]', '');
    const restoredFeaturedState = await guest.evaluate(() => {
      const container = document.querySelector('[data-featured-artists]');
      const style = container ? window.getComputedStyle(container) : null;
      return {
        featuredHiddenAttr: container?.hidden ?? null,
        featuredDisplay: style?.display ?? null,
      };
    });
    console.log(
      '[EGO] Restored featured artists state:',
      JSON.stringify(restoredFeaturedState)
    );
    if (
      restoredFeaturedState.featuredHiddenAttr !== false ||
      restoredFeaturedState.featuredDisplay === 'none'
    ) {
      throw new Error(
        'Featured artists did not reappear after clearing search input!'
      );
    }
    console.log(
      '[EGO] PASS: Default featured artists automatically reappear when search input is cleared!'
    );

    // Test 4: Verify Playlist pagination ("加载更多") in host bridge using a multi-page playlist (id: 2257870572, 666 tracks)
    console.log(
      '[EGO] Test 4: Verifying playlist tracks pagination (加载更多) across page 1 and page 2...'
    );
    const playlistPaginationTest = await guest.evaluate(async () => {
      // Inject playlist 2257870572 into the playlist select and trigger change
      const select = document.querySelector('[data-playlist]');
      if (!select) return { error: 'no select' };
      const opt = document.createElement('option');
      opt.value = '2257870572';
      opt.textContent = '测试大歌单 · 666 首';
      select.appendChild(opt);
      select.value = '2257870572';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    });
    console.log(
      '[EGO] Triggered playlist selection:',
      JSON.stringify(playlistPaginationTest)
    );

    // Switch to playlists tab
    await guest.click('button[data-module-tab="playlists"]');

    await guest.waitForFunction(
      () => {
        const cards = document.querySelectorAll(
          '[data-playlist-tracks] .playlist-track-card'
        );
        const btn = document.querySelector('[data-playlist-track-more]');
        return cards.length === 100 && btn && !btn.disabled && !btn.hidden;
      },
      undefined,
      { timeout: 15000 }
    );

    const playlistPage1State = await guest.evaluate(() => {
      const cards = document.querySelectorAll(
        '[data-playlist-tracks] .playlist-track-card'
      );
      const status =
        document
          .querySelector('[data-playlist-track-status]')
          ?.textContent?.trim() || '';
      const btn = document.querySelector('[data-playlist-track-more]');
      return {
        cardCount: cards.length,
        status,
        moreBtnHidden: btn?.hidden ?? true,
      };
    });
    console.log(
      '[EGO] Playlist Page 1 state:',
      JSON.stringify(playlistPage1State)
    );

    console.log('[EGO] Clicking [data-playlist-track-more] to load page 2...');
    await guest.evaluate(() => {
      document.querySelector('button[data-playlist-track-more]')?.click();
    });

    await guest.waitForFunction(
      () => {
        const cards = document.querySelectorAll(
          '[data-playlist-tracks] .playlist-track-card'
        );
        const btn = document.querySelector('[data-playlist-track-more]');
        return cards.length > 100 && btn && !btn.disabled;
      },
      undefined,
      { timeout: 15000 }
    );

    const playlistPage2State = await guest.evaluate(() => {
      const cards = document.querySelectorAll(
        '[data-playlist-tracks] .playlist-track-card'
      );
      const status =
        document
          .querySelector('[data-playlist-track-status]')
          ?.textContent?.trim() || '';
      const btn = document.querySelector('[data-playlist-track-more]');
      return {
        cardCount: cards.length,
        status,
        moreBtnHidden: btn?.hidden ?? true,
      };
    });
    console.log(
      '[EGO] Playlist Page 2 state:',
      JSON.stringify(playlistPage2State)
    );
    if (playlistPage2State.cardCount !== 200) {
      throw new Error(
        `Expected 200 playlist tracks after clicking 加载更多, got ${playlistPage2State.cardCount}`
      );
    }
    console.log(
      '[EGO] PASS: Playlist 加载更多 loaded page 2 (100 -> 200 tracks, status: ' +
        playlistPage2State.status +
        ')!'
    );

    try {
      await guest.screenshot({ path: localSearchScreenshotPath });
      console.log(
        '[EGO] Saved playlist pagination screenshot to',
        localSearchScreenshotPath
      );
    } catch (e) {
      console.warn('[EGO] Screenshot skipped:', e.message);
    }

    console.log('[EGO] ALL VERIFICATION TESTS PASSED SUCCESSFULLY!');
  } finally {
    await task.finish({ keep: [] });
    console.log('[EGO] Task finished and cleaned up.');
  }
}
