import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.WAR_CHEST_TEST_URL ?? 'http://127.0.0.1:4173/';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

// Keep the opening turn deterministic so the bot cannot replace the DOM while
// the mobile interaction assertions are running.
await context.addInitScript(() => {
  Math.random = () => 0.1;
});

const page = await context.newPage();

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector('.unit-pick[data-unit]');

  // Regression: an already-open Unit card must consume the next tap instead of
  // allowing the underlying card/button to receive it.
  const firstUnit = page.locator('.unit-pick[data-unit]').first();
  const secondUnit = page.locator('.unit-pick[data-unit]').nth(1);
  await firstUnit.dispatchEvent('mouseenter');
  await page.waitForFunction(() => {
    const tooltip = document.querySelector('#unitTooltip');
    return Boolean(tooltip && !tooltip.hidden && tooltip.classList.contains('visible'));
  });

  const selectedBeforeDismiss = await page.locator('.unit-pick.selected').count();
  const secondSelectedBefore = await secondUnit.evaluate((element) => element.classList.contains('selected'));
  await secondUnit.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true });
  await secondUnit.dispatchEvent('click');

  assert.equal(await page.locator('.unit-pick.selected').count(), selectedBeforeDismiss, 'tooltip dismissal must not change army selection');
  assert.equal(await secondUnit.evaluate((element) => element.classList.contains('selected')), secondSelectedBefore, 'underlying Unit card must not receive the dismiss tap');
  assert.equal(await page.locator('#unitTooltip').evaluate((element) => element.hidden), true, 'dismiss tap must close the Unit tooltip');

  // Enter the actual game UI and verify the utilities that used to disappear on
  // mobile are present and visible.
  await page.locator('#startBtn').click();
  await page.waitForSelector('.integrated-header');
  await page.waitForSelector('.mobile-bot-last-action');
  assert.equal(await page.locator('[data-utility="log"]').isVisible(), true, 'Log button must be visible on mobile');
  assert.equal(await page.locator('.utility-toolbar').isVisible(), true, 'utility toolbar must be visible on mobile');
  assert.equal(await page.locator('.mobile-bot-last-action').isVisible(), true, 'last bot action panel must be visible on mobile');

  // Regression: hidden SVG action data is surfaced as touch-sized HTML actions.
  // This synthetic popover isolates the mobile adapter from game-state setup and
  // verifies Bolster/Tactic/Control mapping plus click forwarding.
  await page.evaluate(() => {
    const board = document.querySelector('.battlefield');
    if (!board) throw new Error('Battlefield missing');
    const ns = 'http://www.w3.org/2000/svg';
    const popover = document.createElementNS(ns, 'g');
    popover.classList.add('unit-action-popover');
    for (const [key, cls, label] of [
      ['special:BOLSTER', 'bolster', 'BOLSTER'],
      ['special:TACTIC', 'tactic', 'TACTIC'],
      ['special:CONTROL', 'control', 'CONTROL'],
    ]) {
      const source = document.createElementNS(ns, 'g');
      source.classList.add('board-action-chip', cls);
      source.dataset.boardKey = key;
      source.textContent = label;
      source.addEventListener('click', () => {
        document.documentElement.dataset.mobileProxyHit = key;
      });
      popover.append(source);
    }
    board.append(popover);
  });

  await page.waitForSelector('.mobile-unit-actions');
  const labels = await page.locator('.mobile-unit-action').allTextContents();
  assert.deepEqual(labels, ['증원', '전술', '점령'], 'mobile action bar must expose the selected Unit actions');
  await page.locator('.mobile-unit-action.tactic').click();
  assert.equal(await page.locator('html').getAttribute('data-mobile-proxy-hit'), 'special:TACTIC', 'mobile action must forward to the original board action');

  // The exact bot action is captured from playback when available and reflected
  // in the persistent mobile summary.
  await page.evaluate(() => {
    const toast = document.createElement('div');
    toast.className = 'action-playback-toast bot';
    toast.innerHTML = '<strong>테스트 봇 전술 행동</strong>';
    document.body.append(toast);
  });
  await page.waitForFunction(() => document.querySelector('.mobile-bot-last-action strong')?.textContent === '테스트 봇 전술 행동');

  console.log('mobile UI regression checks passed');
} finally {
  await browser.close();
}
