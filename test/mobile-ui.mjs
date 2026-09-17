import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.WAR_CHEST_TEST_URL ?? 'http://127.0.0.1:4173/';
const browser = await chromium.launch({ headless: true });

async function seedLightCavalryGame(page) {
  await page.evaluate(async () => {
    const { createGame } = await import('./dist/engine.js');
    const { UNIT_DEFS } = await import('./dist/data.js');
    const state = createGame(
      ['LIGHT_CAVALRY', 'ARCHER', 'FOOTMAN', 'PIKEMAN'],
      ['CAVALRY', 'KNIGHT', 'SCOUT', 'SWORDSMAN'],
      'human',
    );

    state.activePlayer = 'human';
    state.initiative = 'human';
    state.players.human.hand = ['LIGHT_CAVALRY'];
    state.players.human.bag = ['ROYAL'];
    state.players.human.discard = [];
    state.players.human.removed = [];
    state.players.bot.hand = [];
    state.players.bot.bag = ['ROYAL'];
    state.players.bot.discard = [];
    state.players.bot.removed = [];

    for (const type of state.players.human.units) {
      state.players.human.supply[type] = UNIT_DEFS[type].coinCount;
    }
    state.players.human.supply.LIGHT_CAVALRY = UNIT_DEFS.LIGHT_CAVALRY.coinCount - 2;
    for (const type of state.players.bot.units) {
      state.players.bot.supply[type] = UNIT_DEFS[type].coinCount;
    }

    state.boardUnits = [
      { id: 'u-test-light', owner: 'human', type: 'LIGHT_CAVALRY', hex: '0,0', strength: 1 },
    ];
    state.log.push('봇 테스트 행동: 대기');
    localStorage.setItem('war-chest-solo-local-v2', JSON.stringify(state));
  });

  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#resumeBtn').click();
  await page.waitForSelector('.battlefield');
  assert.equal(await page.locator('.debug-warning').count(), 0, 'seeded browser state must satisfy engine sanity checks');
}

async function selectLightCavalry(page) {
  const unit = page.locator('.unit-token[data-unit-type="LIGHT_CAVALRY"][data-board-key]').first();
  await unit.click();
  await page.waitForSelector('.unit-action-popover', { state: 'attached' });
  await page.waitForSelector('.board-unit-action-overlay', { state: 'attached' });
  await page.waitForSelector('.board-unit-action-button', { state: 'visible' });
}

async function assertBolsterIsAtomic(page, viewportName) {
  await selectLightCavalry(page);

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

  // Deliberately emit two click attempts against the same visible control. The
  // interaction layer must consume the first one immediately and make the
  // stale overlay inert before a second click-like event can dispatch another action.
  await page.locator('.board-unit-action-button.bolster').evaluate((button) => {
    button.click();
    button.click();
  });

  await page.waitForFunction(() => {
    const saved = JSON.parse(localStorage.getItem('war-chest-solo-local-v2') || 'null');
    return saved?.boardUnits?.find((candidate) => candidate.id === 'u-test-light')?.strength === 2;
  });

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('war-chest-solo-local-v2') || 'null'));
  const light = saved?.boardUnits?.find((candidate) => candidate.id === 'u-test-light');
  assert.equal(light?.strength, 2, `${viewportName}: Bolster must add exactly one coin even under duplicate click attempts`);
  assert.equal(light?.hex, '0,0', `${viewportName}: Bolster must never move the Unit`);
  assert.equal(saved?.players?.human?.hand?.length, 0, `${viewportName}: Bolster must consume exactly the selected hand coin`);
  assert.equal(saved?.log?.filter((line) => line.includes('경기병') && line.includes('이동했습니다')).length ?? 0, 0, `${viewportName}: Bolster must not emit a Move result`);
}

async function assertMoveIsAtomic(page, viewportName) {
  await seedLightCavalryGame(page);
  await selectLightCavalry(page);

  const moveTarget = page.locator('.hex-cell.move-target[data-board-key^="hex:"]').first();
  assert.equal(await moveTarget.isVisible(), true, `${viewportName}: a normal Move destination must be visible after selecting the Unit`);
  const destinationKey = await moveTarget.getAttribute('data-board-key');
  assert.ok(destinationKey?.startsWith('hex:'), `${viewportName}: Move target must carry a battlefield hex key`);
  const destination = destinationKey.slice(4);
  await moveTarget.click();

  await page.waitForFunction((expected) => {
    const saved = JSON.parse(localStorage.getItem('war-chest-solo-local-v2') || 'null');
    return saved?.boardUnits?.find((candidate) => candidate.id === 'u-test-light')?.hex === expected;
  }, destination);

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('war-chest-solo-local-v2') || 'null'));
  const light = saved?.boardUnits?.find((candidate) => candidate.id === 'u-test-light');
  assert.equal(light?.hex, destination, `${viewportName}: Move must end on the selected destination only`);
  assert.equal(light?.strength, 1, `${viewportName}: Move must never Bolster the Unit`);
  assert.equal(saved?.players?.human?.hand?.length, 0, `${viewportName}: Move must consume exactly the selected hand coin`);
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
  await assertBolsterIsAtomic(page, 'mobile');
  await assertMoveIsAtomic(page, 'mobile');
  await mobileContext.close();

  const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await desktopContext.addInitScript(() => {
    Math.random = () => 0.1;
  });
  const desktopPage = await desktopContext.newPage();
  await desktopPage.goto(baseUrl, { waitUntil: 'networkidle' });
  await seedLightCavalryGame(desktopPage);
  await assertBolsterIsAtomic(desktopPage, 'desktop');
  await assertMoveIsAtomic(desktopPage, 'desktop');
  assert.equal(await desktopPage.locator('.mobile-bot-last-action').count(), 0, 'mobile-only bot summary must stay off desktop');
  await desktopContext.close();

  console.log('responsive atomic-action UI regression checks passed');
} finally {
  await browser.close();
}
