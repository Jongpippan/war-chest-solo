import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';

fs.mkdirSync('.v12/screens', { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });

const locations = {
  '1,2': 'human', '-2,3': 'human', '-1,-2': 'bot', '2,-3': 'bot',
  '1,-1': null, '-1,1': null, '-2,0': null, '2,0': null, '3,-2': null, '-3,2': null,
};
const saved = {
  round: 1,
  activePlayer: 'human',
  initiative: 'human',
  initiativeChangedThisRound: false,
  players: {
    human: {
      id: 'human',
      units: ['SWORDSMAN', 'PIKEMAN', 'CROSSBOWMAN', 'LIGHT_CAVALRY'],
      bag: [], hand: ['LIGHT_CAVALRY'], discard: [],
      supply: { SWORDSMAN: 3, PIKEMAN: 2, CROSSBOWMAN: 3, LIGHT_CAVALRY: 3 },
      removed: [], markersRemaining: 4,
    },
    bot: {
      id: 'bot',
      units: ['ARCHER', 'CAVALRY', 'LANCER', 'SCOUT'],
      bag: [], hand: [], discard: [],
      supply: { ARCHER: 2, CAVALRY: 2, LANCER: 2, SCOUT: 3 },
      removed: [], markersRemaining: 4,
    },
  },
  // Deliberately duplicate IDs to verify migration of old saves.
  boardUnits: [
    { id: 'u1', owner: 'human', type: 'LIGHT_CAVALRY', hex: '0,0', strength: 2 },
    { id: 'u1', owner: 'bot', type: 'SCOUT', hex: '1,0', strength: 2 },
  ],
  locations,
  winner: null,
  pending: null,
  forcedCoin: null,
  log: ['fixture'],
  seedLabel: 'v0.12-browser-regression',
};
await page.evaluate((state) => localStorage.setItem('war-chest-solo-local-v2', JSON.stringify(state)), saved);
await page.reload({ waitUntil: 'networkidle' });
await page.locator('#resumeBtn').click();
await page.waitForSelector('.battlefield');

// Old duplicate IDs must be repaired on load.
let stored = await page.evaluate(() => JSON.parse(localStorage.getItem('war-chest-solo-local-v2')));
assert.equal(new Set(stored.boardUnits.map((unit) => unit.id)).size, 2, 'duplicate saved unit IDs were not repaired');

// Selected-unit actions are anchored over the selected Unit again.
const humanUnit = page.locator('.unit-token[data-owner-label="Your Unit"]');
await humanUnit.click();
const popover = page.locator('.unit-action-popover');
await popover.waitFor({ state: 'visible' });
const popoverText = await popover.textContent();
assert.match(popoverText ?? '', /BOLSTER/);
assert.match(popoverText ?? '', /TACTIC/);
await page.screenshot({ path: '.v12/screens/desktop-selected-unit-actions.png', fullPage: true });

// Attack the strengthened Scout. It must lose exactly one coin and the ~1s playback must be visible.
const botUnit = page.locator('.unit-token[data-owner-label="Bot Unit"]');
await botUnit.click();
await page.locator('.action-playback-toast').waitFor({ state: 'visible' });
assert.match((await page.locator('.action-playback-toast').textContent()) ?? '', /BOT|YOU/);
await page.waitForTimeout(420);
assert.equal(await page.locator('.action-playback-toast').count(), 1, 'action playback vanished too early');
await page.screenshot({ path: '.v12/screens/desktop-attack-playback.png', fullPage: true });
await page.waitForTimeout(700);
assert.equal(await page.locator('.action-playback-toast').count(), 0, 'action playback did not clear after about one second');

stored = await page.evaluate(() => JSON.parse(localStorage.getItem('war-chest-solo-local-v2')));
const scout = stored.boardUnits.find((unit) => unit.owner === 'bot' && unit.type === 'SCOUT');
assert(scout, 'Scout should survive one hit while Strength 2');
assert.equal(scout.strength, 1, 'one Attack must remove exactly one coin from a bolstered defender');
assert.equal(stored.boardUnits.find((unit) => unit.owner === 'human')?.strength, 2, 'attacker Strength must not multiply damage');
assert(stored.log.some((line) => line.includes('경기병') && line.includes('정찰병') && line.includes('Attack')), 'Attack log must use the actual target type');
assert(!stored.log.some((line) => line.includes('경기병이(가) 경기병')), 'Attack log must not self-label the target');

// Persistent BOT LAST ACTION emphasis should be gone from the header.
assert.equal(await page.locator('.bot-last-action').count(), 0);

// Mobile: Battlefield first, then BOT/YOU side-by-side below it.
await page.setViewportSize({ width: 390, height: 844 });
await page.reload({ waitUntil: 'networkidle' });
await page.locator('#resumeBtn').click();
await page.waitForSelector('.battlefield');
const layout = await page.evaluate(() => {
  const board = document.querySelector('.board-stage').getBoundingClientRect();
  const bot = document.querySelector('.bot-side').getBoundingClientRect();
  const human = document.querySelector('.human-side').getBoundingClientRect();
  return {
    boardTop: board.top, boardBottom: board.bottom,
    botTop: bot.top, botLeft: bot.left, botRight: bot.right,
    humanTop: human.top, humanLeft: human.left, humanRight: human.right,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  };
});
assert(layout.boardTop < layout.botTop && layout.boardBottom <= layout.botTop + 12, 'Battlefield must be above mobile player tables');
assert(Math.abs(layout.botTop - layout.humanTop) < 12, 'BOT and YOU tables must share the same mobile row');
assert(layout.botRight <= layout.humanLeft + 8, 'BOT and YOU tables must be side-by-side');
assert(layout.scrollWidth <= layout.innerWidth + 2, 'mobile layout must not horizontally overflow');
await page.screenshot({ path: '.v12/screens/mobile-board-first.png', fullPage: true });

await browser.close();
console.log('v0.12 browser regression passed');
