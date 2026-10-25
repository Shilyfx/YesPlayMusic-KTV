// Live acceptance test; requires the deployed router and a Playwright runtime.
const assert = require('assert');
const { chromium } = require(process.env.LUMASING_PLAYWRIGHT_MODULE ||
  'playwright');

(async () => {
  const base = process.env.LUMASING_WEB_URL || 'http://192.168.100.1:18080';
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.LUMASING_CHROME_PATH,
    args: ['--mute-audio'],
  });
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const errors = [];
  host.on('pageerror', e => errors.push(e.message));
  guest.on('pageerror', e => errors.push(e.message));
  try {
    await host.goto(base + '/karaoke', { waitUntil: 'domcontentloaded' });
    const generate = host.getByRole('button', {
      name: '生成房间二维码',
      exact: true,
    });
    await generate.waitFor({ timeout: 20000 });
    assert.equal(
      await generate.isEnabled(),
      true,
      'Docker room address must be selectable'
    );
    await generate.click();
    await host.locator('.room-qr-wrap img').waitFor({ timeout: 20000 });
    const joinUrl = (await host.locator('.room-link').innerText()).trim();
    assert.ok(joinUrl.startsWith(base + '/room/'));
    await guest.goto(joinUrl, { waitUntil: 'domcontentloaded' });
    await guest.locator('[data-search]').waitFor({ timeout: 15000 });
    await guest.locator('[data-search]').fill('Jay Chou');
    await guest
      .locator('[data-results] [data-request]')
      .first()
      .waitFor({ timeout: 20000 });
    const selectedId = await guest
      .locator('[data-results] [data-request]')
      .first()
      .getAttribute('data-request');
    await guest.locator('[data-results] [data-request]').first().click();
    await host.waitForFunction(
      id => {
        const view = document.querySelector('.karaoke-surface').__vue__;
        return String(view.$store.state.karaoke.currentItem?.trackId) === id;
      },
      selectedId,
      { timeout: 25000 }
    );
    await guest.locator('[data-next-track]').waitFor({ timeout: 10000 });
    await host.waitForFunction(
      () => {
        const view = document.querySelector('.karaoke-surface').__vue__;
        return view.$store.state.player._howler?.playing() === true;
      },
      undefined,
      { timeout: 20000 }
    );
    const nextResponse = guest.waitForResponse(
      response => new URL(response.url()).pathname === '/ktv/api/next'
    );
    await guest.locator('[data-next-track]').click();
    assert.equal(
      (await nextResponse).status(),
      200,
      'Guest next must complete before host closes'
    );
    await host.waitForFunction(
      () =>
        !document.querySelector('.karaoke-surface').__vue__.$store.state.karaoke
          .currentItem,
      undefined,
      { timeout: 20000 }
    );
    assert.deepEqual(
      errors,
      [],
      'host and guest must not throw browser runtime errors'
    );
    await host.getByRole('button', { name: '结束 KTV', exact: true }).click();
    await host
      .getByRole('button', { name: '开始本机 KTV', exact: true })
      .click();
    await generate.waitFor({ timeout: 5000 });
    await generate.click();
    await host.locator('.room-qr-wrap img').waitFor({ timeout: 10000 });
    assert.notEqual(
      (await host.locator('.room-link').innerText()).trim(),
      joinUrl,
      'restarted session must display a fresh room link'
    );
    console.log(
      'PASS browser: room QR, mobile guest join, authenticated catalog search, first enqueue auto-start, Guest next'
    );
  } finally {
    // pagehide closes this test's room, never an existing user's browser room.
    await host.goto('about:blank').catch(() => {});
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
