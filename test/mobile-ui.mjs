import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.WAR_CHEST_TEST_URL ?? 'http://127.0.0.1:4173/';
const browser = await chromium.launch({ headless: true });

async function seedLightCavalryGame(page) {
  await page.evaluate(async () => {
    const { createGame } = await import('./dist/engine.js');
    const state = createGame(
      ['LIGHT_CAVALRY', 'ARCHER', 'FOOTMAN', 'PIKEMAN'],
      ['CAVALRY', 'KNIGHT', 'SCOUT', 'SWORDSMAN'],
      'human',
    );

    state.activePlayer = 'human';
    state.initiative = 'human';
    state.players.human.hand = ['LIGHT_CAVALRY'];
    state.players.human.bag = [];
    state.players.human.discard = [];
    state.boardUnits = [
      { id: 'u-test-light', owner: 'human', type: 'LIGHT_CAVALRY', hex: '0,0', strength: 1 },
    ];
    state.log.push('봇 테스트 행동: 대기');
    localStorage.setItem('war-chest-solo-local-v2', JSON.stringify(state));
  });

  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#resumeBtn').click();
  await page.waitForSelector('.battlefield');
}

async function assertRealUnitActions(page, viewportName) {
  const unit = page.locator('.unit-token[data-unit-type="LIGHT_CAVALRY"][data-board-key]').first();
  await unit.click();

  // main.ts still creates the SVG action data, while the responsive layer turns
  // it into real HTML buttons anchored directly above the selected battlefield Unit.
  await page.waitForSelector('.unit-action-popover', { state: 'attached' });
  await page.waitForSelector('.board-unit-action-overlay', { state: 'attached' });
  await page.waitForSelector('.board-unit-action-button', { state: 'visible' });

  const labels = await page.locator('.board-unit-action-button').allTextContents();
  assert.ok(labels.includes('증원'), `${viewportName}: Bolster must appear above the selected Unit`);
  assert.ok(labels.includes('전술'), `${viewportName}: Tactic must appear above Light Cavalry`);
  assert.equal(await page.locator('.board-unit-action-button.bolster').isVisible(), true, `${viewportName}: battlefield Bolster button must be visible`);
  assert.equal(await page.locator('.context-unit-actions').count(), 0, `${viewportName}: duplicated HUD action bar must not be rendered`);

  const position = await page.locator('.board-unit-action-overlay').evaluate((overlay) => ({
    y: Number(overlay.getAttribute('y')),
    unitY: Number(document.querySelector('.unit-token[data-unit-type="LIGHT_CAVALRY"] circle')?.getAttribute('cy')),
  }));
  assert.ok(position.y < position.unitY, `${viewportName}: action buttons must be positioned above the Unit token`);

  await page.locator('.board-unit-action-button.bolster').click();
  await page.waitForTimeout(1050);

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('war-chest-solo-local-v2') || 'null'));
  const light = saved?.boardUnits?.find((candidate) => candidate.id === 'u-test-light');
  assert.equal(light?.strength, 2, `${viewportName}: battlefield Bolster button must execute the real game action`);
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

  await seedLightCavalryGame(page);
  await page.waitForSelector('.mobile-bot-last-action');
  assert.equal(await page.locator('[data-utility="log"]').isVisible(), true, 'Log button must be visible on mobile');
  assert.equal(await page.locator('.utility-toolbar').isVisible(), true, 'utility toolbar must be visible on mobile');
  assert.equal(await page.locator('.mobile-bot-last-action').isVisible(), true, 'last bot action panel must be visible on mobile');
  await assertRealUnitActions(page, 'mobile');
  await mobileContext.close();

  const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await desktopContext.addInitScript(() => {
    Math.random = () => 0.1;
  });
  const desktopPage = await desktopContext.newPage();
  await desktopPage.goto(baseUrl, { waitUntil: 'networkidle' });
  await seedLightCavalryGame(desktopPage);
  await assertRealUnitActions(desktopPage, 'desktop');
  assert.equal(await desktopPage.locator('.mobile-bot-last-action').count(), 0, 'mobile-only bot summary must stay off desktop');
  await desktopContext.close();

  console.log('responsive real-game UI regression checks passed');
} finally {
  await browser.close();
}
