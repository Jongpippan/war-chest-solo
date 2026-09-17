import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.WAR_CHEST_TEST_URL ?? 'http://127.0.0.1:4173/';
const browser = await chromium.launch({ headless: true });

async function injectSyntheticActions(page) {
  await page.evaluate(() => {
    const board = document.querySelector('.battlefield');
    if (!board) throw new Error('Battlefield missing');
    const ns = 'http://www.w3.org/2000/svg';
    const popover = document.createElementNS(ns, 'g');
    popover.classList.add('unit-action-popover');
    popover.dataset.actionFor = 'synthetic-unit';
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
        document.documentElement.dataset.contextProxyHit = key;
      });
      popover.append(source);
    }
    board.append(popover);
  });
}

try {
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  await mobileContext.addInitScript(() => {
    Math.random = () => 0.1;
  });

  const page = await mobileContext.newPage();
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

  await page.locator('#startBtn').click();
  await page.waitForSelector('.integrated-header');
  await page.waitForSelector('.mobile-bot-last-action');
  assert.equal(await page.locator('[data-utility="log"]').isVisible(), true, 'Log button must be visible on mobile');
  assert.equal(await page.locator('.utility-toolbar').isVisible(), true, 'utility toolbar must be visible on mobile');
  assert.equal(await page.locator('.mobile-bot-last-action').isVisible(), true, 'last bot action panel must be visible on mobile');

  await injectSyntheticActions(page);
  await page.waitForSelector('.context-unit-actions');
  const labels = await page.locator('.context-unit-action').allTextContents();
  assert.deepEqual(labels, ['증원', '전술', '점령'], 'shared action bar must expose the selected Unit actions on mobile');
  await page.locator('.context-unit-action.tactic').click();
  assert.equal(await page.locator('html').getAttribute('data-context-proxy-hit'), 'special:TACTIC', 'mobile action must forward to the original board action');

  await page.evaluate(() => {
    const toast = document.createElement('div');
    toast.className = 'action-playback-toast bot';
    toast.innerHTML = '<strong>테스트 봇 전술 행동</strong>';
    document.body.append(toast);
  });
  await page.waitForFunction(() => document.querySelector('.mobile-bot-last-action strong')?.textContent === '테스트 봇 전술 행동');
  await mobileContext.close();

  // Desktop regression: the same selected-Unit actions must be surfaced even
  // though the mobile-only header helpers are not active.
  const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await desktopContext.addInitScript(() => {
    Math.random = () => 0.1;
  });
  const desktopPage = await desktopContext.newPage();
  await desktopPage.goto(baseUrl, { waitUntil: 'networkidle' });
  await desktopPage.locator('#startBtn').click();
  await desktopPage.waitForSelector('.battlefield');
  await injectSyntheticActions(desktopPage);
  await desktopPage.waitForSelector('.context-unit-actions');
  assert.equal(await desktopPage.locator('.context-unit-actions').isVisible(), true, 'selected Unit action bar must be visible on desktop');
  await desktopPage.locator('.context-unit-action.bolster').click();
  assert.equal(await desktopPage.locator('html').getAttribute('data-context-proxy-hit'), 'special:BOLSTER', 'desktop action must forward to the original board action');
  assert.equal(await desktopPage.locator('.mobile-bot-last-action').count(), 0, 'mobile-only bot summary must stay off desktop');
  await desktopContext.close();

  console.log('responsive UI regression checks passed');
} finally {
  await browser.close();
}
