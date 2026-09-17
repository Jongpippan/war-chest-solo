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

  await page.waitForSelector('.unit-action-popover');
  await page.waitForSelector('.context-unit-actions');

  const labels = await page.locator('.context-unit-action').allTextContents();
  assert.ok(labels.includes('증원'), `${viewportName}: Bolster must be surfaced for a deployed matching Unit`);
  assert.ok(labels.includes('전술'), `${viewportName}: Tactic must be surfaced for Light Cavalry`);
  assert.equal(await page.locator('.context-unit-actions').isVisible(), true, `${viewportName}: selected Unit action bar must be visible`);

  // Use the real generated action, not a synthetic SVG fixture. This catches the
  // original regression where the board path existed but the contextual actions
  // were effectively unavailable to the player.
  await page.locator('.context-unit-action.bolster').click();
  await page.waitForTimeout(1050);

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('war-chest-solo-local-v2') || 'null'));
  const light = saved?.boardUnits?.find((candidate) => candidate.id === 'u-test-light');
  assert.equal(light?.strength, 2, `${viewportName}: Bolster button must execute the real game action`);
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
