import { chromium } from 'playwright';
import fs from 'node:fs';

const state = {
  round: 2,
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
      units: ['SCOUT', 'ARCHER', 'CAVALRY', 'LANCER'],
      bag: [],
      hand: [],
      discard: [],
      supply: { SCOUT: 4, ARCHER: 4, CAVALRY: 4, LANCER: 4 },
      removed: [],
      markersRemaining: 4,
    },
  },
  boardUnits: [
    { id: 'lc', owner: 'human', type: 'LIGHT_CAVALRY', hex: '1,2', strength: 2 },
    { id: 'scout', owner: 'bot', type: 'SCOUT', hex: '2,0', strength: 1 },
  ],
  locations: {
    '-1,-2': 'bot', '2,-3': 'bot', '1,2': 'human', '-2,3': 'human',
    '1,-1': null, '-1,1': null, '-2,0': null, '2,0': null, '3,-2': null, '-3,2': null,
  },
  winner: null,
  pending: null,
  forcedCoin: null,
  log: ['Regression setup'],
  seedLabel: 'v0.11-regression',
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
await page.addInitScript((saved) => {
  localStorage.setItem('war-chest-solo-local-v2', JSON.stringify(saved));
}, state);
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.click('#resumeBtn');

const lc = page.locator('[data-board-key="unit:lc"]');
if (await lc.count() !== 1) throw new Error('Human Light Cavalry is not selectable');
await lc.click();

if (await page.locator('.board-action-chip').count() !== 0) {
  throw new Error('Legacy on-board action chips are still rendered over neighboring Units');
}
const bolster = page.locator('.context-board-action[data-board-key="special:BOLSTER"]');
const tactic = page.locator('.context-board-action[data-board-key="special:TACTIC"]');
if (await bolster.count() !== 1 || await tactic.count() !== 1) {
  throw new Error('Selected Light Cavalry does not expose exactly one Bolster and one Tactic control in the context tray');
}
if (await page.locator('[data-board-key="unit:scout"]').count() !== 0) {
  throw new Error('Non-adjacent enemy Scout incorrectly became an actionable Unit for the selected Light Cavalry Coin');
}

const layers = await page.locator('.battlefield').evaluate((svg) => {
  const children = [...svg.children];
  const idx = (selector) => children.findIndex((el) => el.matches?.(selector));
  return {
    unit: idx('.unit-layer'),
    location: idx('.location-overlay-layer'),
    stack: idx('.stack-badge-layer'),
  };
});
if (!(layers.unit >= 0 && layers.location > layers.unit && layers.stack > layers.location)) {
  throw new Error(`Wrong SVG layer order: ${JSON.stringify(layers)}`);
}
const locationOverlay = page.locator('[data-location-overlay="1,2"]');
if (await locationOverlay.count() !== 1) throw new Error('Controlled Location outline missing under occupied Light Cavalry');
const overlayStroke = Number(await locationOverlay.getAttribute('stroke-width'));
if (!(overlayStroke >= 6)) throw new Error(`Controlled Location outline too weak: ${overlayStroke}`);
const stackBadge = page.locator('[data-stack-badge="lc"]');
if (await stackBadge.count() !== 1) throw new Error('Bolstered stack badge is missing');
const badgeBox = await stackBadge.boundingBox();
if (!badgeBox || badgeBox.width < 10 || badgeBox.height < 10) throw new Error('Bolstered stack badge is not visibly rendered');

fs.mkdirSync('.v11/screens', { recursive: true });
await page.screenshot({ path: '.v11/screens/selected-light-cavalry.png', fullPage: true });

await tactic.click();
const destinations = page.locator('.hex-cell.move-target[data-board-key^="hex:"]');
const destinationCount = await destinations.count();
if (destinationCount < 1) throw new Error('Light Cavalry Tactic shows no final clickable destinations');
for (let i = 0; i < destinationCount; i += 1) {
  const target = destinations.nth(i);
  const cursor = await target.evaluate((el) => getComputedStyle(el.querySelector('polygon') ?? el).cursor);
  if (cursor !== 'pointer') throw new Error(`Light Cavalry destination ${i} has cursor ${cursor}`);
}
await page.screenshot({ path: '.v11/screens/light-cavalry-destinations.png', fullPage: true });

const destinationKey = await destinations.first().getAttribute('data-board-key');
await destinations.first().click();
await page.waitForTimeout(80);
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('war-chest-solo-local-v2') || 'null'));
const moved = saved?.boardUnits?.find((u) => u.id === 'lc');
const expected = destinationKey?.replace('hex:', '');
if (!moved || moved.hex !== expected) {
  throw new Error(`Light Cavalry Tactic failed: expected ${expected}, got ${moved?.hex}`);
}

console.log(JSON.stringify({ destinationCount, movedTo: moved.hex, layers, overlayStroke }));
await browser.close();
