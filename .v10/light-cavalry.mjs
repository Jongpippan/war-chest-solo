import { chromium } from 'playwright';

const state = {
  round: 1,
  activePlayer: 'human',
  initiative: 'human',
  initiativeChangedThisRound: false,
  players: {
    human: {
      id: 'human',
      units: ['LIGHT_CAVALRY', 'SWORDSMAN', 'PIKEMAN', 'CROSSBOWMAN'],
      bag: [],
      hand: ['LIGHT_CAVALRY'],
      discard: [],
      supply: { LIGHT_CAVALRY: 3, SWORDSMAN: 5, PIKEMAN: 4, CROSSBOWMAN: 5 },
      removed: [],
      markersRemaining: 4,
    },
    bot: {
      id: 'bot',
      units: ['ARCHER', 'CAVALRY', 'LANCER', 'SCOUT'],
      bag: [],
      hand: [],
      discard: [],
      supply: { ARCHER: 4, CAVALRY: 4, LANCER: 4, SCOUT: 5 },
      removed: [],
      markersRemaining: 4,
    },
  },
  boardUnits: [
    { id: 'lc', owner: 'human', type: 'LIGHT_CAVALRY', hex: '0,0', strength: 1 },
  ],
  locations: {
    '-1,-2': 'bot', '2,-3': 'bot', '1,2': 'human', '-2,3': 'human',
    '1,-1': null, '-1,1': null, '-2,0': null, '2,0': null, '3,-2': null, '-3,2': null,
  },
  winner: null,
  pending: null,
  forcedCoin: null,
  log: [],
  seedLabel: 'light-cavalry-regression',
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
await page.addInitScript((saved) => {
  localStorage.setItem('war-chest-solo-local-v2', JSON.stringify(saved));
}, state);
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.click('#resumeBtn');

const unit = page.locator('[data-board-key="unit:lc"]');
if (await unit.count() !== 1) throw new Error('Light Cavalry unit is not an actionable board target');
await unit.click();

const tactic = page.locator('[data-board-key="special:TACTIC"]');
if (await tactic.count() !== 1) throw new Error('Light Cavalry Tactic chip did not appear');
await tactic.click();

const firstSteps = page.locator('.hex-cell[data-board-key^="hex:"]');
const firstCount = await firstSteps.count();
if (firstCount < 1) throw new Error('No clickable first-step hexes after selecting Light Cavalry Tactic');
for (let i = 0; i < firstCount; i += 1) {
  const cursor = await firstSteps.nth(i).evaluate((el) => getComputedStyle(el.querySelector('polygon') ?? el).cursor);
  if (cursor !== 'pointer') throw new Error(`First-step hex ${i} is highlighted but cursor is ${cursor}`);
}
const firstKey = await firstSteps.first().getAttribute('data-board-key');
await firstSteps.first().click();

const secondSteps = page.locator('.hex-cell[data-board-key^="hex:"]');
const secondCount = await secondSteps.count();
if (secondCount < 1) throw new Error('No clickable second-step destinations after choosing the first Light Cavalry step');
for (let i = 0; i < secondCount; i += 1) {
  const cursor = await secondSteps.nth(i).evaluate((el) => getComputedStyle(el.querySelector('polygon') ?? el).cursor);
  if (cursor !== 'pointer') throw new Error(`Second-step hex ${i} is highlighted but cursor is ${cursor}`);
}
const destinationKey = await secondSteps.first().getAttribute('data-board-key');
await secondSteps.first().click();
await page.waitForTimeout(50);

const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('war-chest-solo-local-v2') || 'null'));
const moved = saved?.boardUnits?.find((u) => u.id === 'lc');
const destination = destinationKey?.replace('hex:', '');
if (!moved || moved.hex !== destination) {
  throw new Error(`Light Cavalry did not move to clicked destination: expected ${destination}, got ${moved?.hex}`);
}
if (firstKey === destinationKey) throw new Error('Light Cavalry Tactic did not resolve as a two-step path');

console.log(JSON.stringify({ firstCount, secondCount, firstKey, destinationKey, movedTo: moved.hex }));
await browser.close();
