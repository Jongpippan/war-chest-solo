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
  assert.ok(labels.includes('Bolster'), `${viewportName}: Bolster must appear above the selected Unit`);
  assert.ok(labels.includes('Tactic'), `${viewportName}: Tactic must appear above Light Cavalry`);
  assert.equal(await page.locator('.board-unit-action-button.bolster').isVisible(), true, `${viewportName}: battlefield Bolster button must be visible`);
  assert.equal(await page.locator('.context-unit-actions').count(), 0, `${viewportName}: duplicated HUD action bar must not be rendered`);

  // Selected Unit is a toggle: click it again to collapse the action controls,
  // then select it once more before exercising Bolster.
  const selectedUnit = page.locator('.unit-token.interaction-selected[data-board-key]').first();
  assert.equal(await selectedUnit.count(), 1, `${viewportName}: selected Unit must remain clickable for toggle-off`);
  const moveTargetsBeforeToggle = await page.locator('.hex-cell.move-target[data-board-key^="hex:"]').count();
  assert.ok(moveTargetsBeforeToggle > 0, `${viewportName}: selected Unit must expose normal Move targets`);

  await selectedUnit.click();
  await page.waitForFunction(() => !document.querySelector('.board-unit-action-overlay'));
  assert.equal(await page.locator('.board-unit-action-overlay').count(), 0, `${viewportName}: second Unit click must hide only the special-action buttons`);
  assert.equal(await page.locator('.unit-token.interaction-selected[data-unit-type="LIGHT_CAVALRY"]').count(), 1, `${viewportName}: toggling chips must keep the Unit selected`);
  assert.equal(await page.locator('.hex-cell.move-target[data-board-key^="hex:"]').count(), moveTargetsBeforeToggle, `${viewportName}: Move targets must remain available while chips are hidden`);

  await selectedUnit.click();
  await page.waitForSelector('.board-unit-action-overlay', { state: 'attached' });

  const position = await page.locator('.board-unit-action-overlay').evaluate((overlay) => ({
    y: Number(overlay.getAttribute('y')),
    height: Number(overlay.getAttribute('height')),
    unitY: Number(document.querySelector('.unit-token[data-unit-type="LIGHT_CAVALRY"] circle')?.getAttribute('cy')),
  }));
  assert.ok(position.y < position.unitY && position.y + position.height > position.unitY - 24, `${viewportName}: action buttons must overlap the selected Unit token`);

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


async function seedBerserkerGame(page) {
  await page.evaluate(async () => {
    const { createGame } = await import('./dist/engine.js');
    const { UNIT_DEFS } = await import('./dist/data.js');
    const state = createGame(
      ['BERSERKER', 'WARRIOR_PRIEST', 'PIKEMAN', 'LIGHT_CAVALRY'],
      ['CAVALRY', 'KNIGHT', 'SCOUT', 'SWORDSMAN'],
      'human',
    );
    state.activePlayer = 'human';
    state.initiative = 'human';
    state.players.human.hand = ['BERSERKER'];
    state.players.human.bag = ['ROYAL'];
    state.players.human.discard = [];
    state.players.human.removed = [];
    state.players.bot.hand = [];
    state.players.bot.bag = ['ROYAL'];
    state.players.bot.discard = [];
    state.players.bot.removed = [];

    for (const type of state.players.human.units) state.players.human.supply[type] = UNIT_DEFS[type].coinCount;
    state.players.human.supply.BERSERKER = UNIT_DEFS.BERSERKER.coinCount - 3;
    for (const type of state.players.bot.units) state.players.bot.supply[type] = UNIT_DEFS[type].coinCount;

    state.boardUnits = [
      { id: 'u-test-berserker', owner: 'human', type: 'BERSERKER', hex: '0,0', strength: 2 },
    ];
    localStorage.setItem('war-chest-solo-local-v2', JSON.stringify(state));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#resumeBtn').click();
  await page.waitForSelector('.battlefield');
  assert.equal(await page.locator('.debug-warning').count(), 0, 'Berserker browser seed must satisfy engine sanity checks');
}

async function assertBerserkerFollowUpIsImmediate(page, viewportName) {
  await seedBerserkerGame(page);
  const unit = page.locator('.unit-token[data-unit-type="BERSERKER"][data-board-key]').first();
  await unit.click();
  const firstMove = page.locator('.hex-cell.move-target[data-board-key^="hex:"]').first();
  assert.equal(await firstMove.isVisible(), true, `${viewportName}: Berserker must have an initial Move target`);
  await firstMove.click();

  await page.waitForFunction(() => {
    const saved = JSON.parse(localStorage.getItem('war-chest-solo-local-v2') || 'null');
    return saved?.pending?.kind === 'BERSERKER_EXTRA';
  });
  await page.waitForFunction(() => document.querySelectorAll('.hex-cell.move-target[data-board-key^="hex:"]').length > 0);

  assert.equal(await page.locator('.unit-token.interaction-selected[data-unit-type="BERSERKER"]').count(), 1, `${viewportName}: Berserker must stay selected for its extra Maneuver`);
  assert.ok(await page.locator('.hex-cell.move-target[data-board-key^="hex:"]').count() > 0, `${viewportName}: extra Move targets must appear without reselecting Berserker`);
  assert.equal(await page.locator('#skipAbilityBtn').isVisible(), true, `${viewportName}: Berserker extra Maneuver must expose Skip Ability`);
}

async function seedForcedWarriorPriestDraw(page) {
  await page.evaluate(async () => {
    const { createGame } = await import('./dist/engine.js');
    const { UNIT_DEFS } = await import('./dist/data.js');
    const state = createGame(
      ['WARRIOR_PRIEST', 'PIKEMAN', 'CROSSBOWMAN', 'LIGHT_CAVALRY'],
      ['CAVALRY', 'KNIGHT', 'SCOUT', 'SWORDSMAN'],
      'human',
    );
    state.activePlayer = 'human';
    state.initiative = 'human';
    state.players.human.hand = [];
    state.players.human.bag = ['ROYAL'];
    state.players.human.discard = [];
    state.players.human.removed = [];
    state.players.bot.hand = [];
    state.players.bot.bag = ['ROYAL'];
    state.players.bot.discard = [];
    state.players.bot.removed = [];

    for (const type of state.players.human.units) state.players.human.supply[type] = UNIT_DEFS[type].coinCount;
    state.players.human.supply.PIKEMAN = UNIT_DEFS.PIKEMAN.coinCount - 1;
    for (const type of state.players.bot.units) state.players.bot.supply[type] = UNIT_DEFS[type].coinCount;

    state.boardUnits = [];
    state.forcedCoin = { player: 'human', coin: 'PIKEMAN', source: 'WARRIOR_PRIEST' };
    localStorage.setItem('war-chest-solo-local-v2', JSON.stringify(state));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#resumeBtn').click();
  await page.waitForSelector('.battlefield');
  assert.equal(await page.locator('.debug-warning').count(), 0, 'Warrior Priest browser seed must satisfy engine sanity checks');
}

async function assertWarriorPriestDrawVisible(page, viewportName) {
  await seedForcedWarriorPriestDraw(page);
  const slot = page.locator('.forced-draw-slot');
  assert.equal(await slot.isVisible(), true, `${viewportName}: Warrior Priest forced Coin must be visible in Hand`);
  assert.match(await slot.textContent(), /WARRIOR PRIEST/);
  assert.match(await slot.textContent(), /USE NOW/);
  assert.equal(await slot.locator('[data-unit-type="PIKEMAN"]').count(), 1, `${viewportName}: forced drawn Coin must show its actual Unit face`);
  assert.equal(await page.locator('.selected-coin-hud [data-unit-type="PIKEMAN"]').count(), 1, `${viewportName}: forced Coin must also drive battlefield input`);
}


async function seedRoyalGuardGame(page) {
  await page.evaluate(async () => {
    const { createGame } = await import('./dist/engine.js');
    const { UNIT_DEFS } = await import('./dist/data.js');
    const state = createGame(
      ['ROYAL_GUARD', 'ARCHER', 'FOOTMAN', 'PIKEMAN'],
      ['CAVALRY', 'KNIGHT', 'SCOUT', 'SWORDSMAN'],
      'human',
    );
    state.activePlayer = 'human';
    state.initiative = 'human';
    state.players.human.hand = ['ROYAL'];
    state.players.human.bag = [];
    state.players.human.discard = [];
    state.players.human.removed = [];
    state.players.bot.hand = [];
    state.players.bot.bag = ['ROYAL'];
    state.players.bot.discard = [];
    state.players.bot.removed = [];

    for (const type of state.players.human.units) state.players.human.supply[type] = UNIT_DEFS[type].coinCount;
    state.players.human.supply.ROYAL_GUARD = UNIT_DEFS.ROYAL_GUARD.coinCount - 1;
    for (const type of state.players.bot.units) state.players.bot.supply[type] = UNIT_DEFS[type].coinCount;

    state.boardUnits = [
      { id: 'u-test-royal-guard', owner: 'human', type: 'ROYAL_GUARD', hex: '0,2', strength: 1 },
    ];
    localStorage.setItem('war-chest-solo-local-v2', JSON.stringify(state));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#resumeBtn').click();
  await page.waitForSelector('.battlefield');
  assert.equal(await page.locator('.debug-warning').count(), 0, 'Royal Guard browser seed must satisfy engine sanity checks');
}

async function assertRoyalGuardTacticSelectable(page, viewportName) {
  await seedRoyalGuardGame(page);

  const royalCoin = page.locator('.hand-zone [data-hand-index][data-unit-type="ROYAL"]').first();
  assert.equal(await royalCoin.isVisible(), true, `${viewportName}: Royal Coin must be selectable from Hand`);
  await royalCoin.click();

  const guard = page.locator('.unit-token[data-unit-type="ROYAL_GUARD"][data-board-key]').first();
  assert.equal(await guard.isVisible(), true, `${viewportName}: Royal Guard must be selectable while Royal Coin is selected`);
  await guard.click();

  await page.waitForSelector('.board-unit-action-button.tactic', { state: 'visible' });
  await page.locator('.board-unit-action-button.tactic').click();

  const target = page.locator('.hex-cell.move-target[data-board-key="hex:1,2"]').first();
  assert.equal(await target.isVisible(), true, `${viewportName}: controlled Location within two spaces must be selectable for Royal Guard Tactic`);
  await target.click();

  await page.waitForFunction(() => {
    const saved = JSON.parse(localStorage.getItem('war-chest-solo-local-v2') || 'null');
    return saved?.boardUnits?.find((unit) => unit.id === 'u-test-royal-guard')?.hex === '1,2';
  });

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('war-chest-solo-local-v2') || 'null'));
  assert.equal(saved.players.human.hand.length, 0, `${viewportName}: Royal Guard Tactic must consume the Royal Coin`);
  assert.equal(saved.players.human.discard.filter((entry) => entry.coin === 'ROYAL' && entry.faceUp).length, 1, `${viewportName}: Royal Coin must be discarded face-up for the Tactic`);
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
  await assertBerserkerFollowUpIsImmediate(page, 'mobile');
  await assertWarriorPriestDrawVisible(page, 'mobile');
  await assertRoyalGuardTacticSelectable(page, 'mobile');
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
  await assertBerserkerFollowUpIsImmediate(desktopPage, 'desktop');
  await assertWarriorPriestDrawVisible(desktopPage, 'desktop');
  await assertRoyalGuardTacticSelectable(desktopPage, 'desktop');
  assert.equal(await desktopPage.locator('.mobile-bot-last-action').count(), 0, 'mobile-only bot summary must stay off desktop');
  await desktopContext.close();

  console.log('responsive atomic-action UI regression checks passed');
} finally {
  await browser.close();
}
