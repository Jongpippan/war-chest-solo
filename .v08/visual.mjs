import { chromium } from 'playwright';
import fs from 'node:fs';

fs.mkdirSync('.v08/screens', { recursive: true });
const browser = await chromium.launch({ headless: true });

const sizes = [
  [1440, 900, '1440x900'],
  [1366, 768, '1366x768'],
  [1280, 720, '1280x720'],
];

for (const [width, height, label] of sizes) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.click('#recommendedBtn');
  await page.click('#startBtn');
  await page.waitForTimeout(900);

  const report = await page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height };
    };
    const selectors = ['.game-header', '.left-rail', '.board-stage', '.right-rail', '#boardHost', '.interaction-hud'];
    const boxes = Object.fromEntries(selectors.map((s) => [s, rect(s)]));
    return {
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      boxes,
    };
  });

  if (report.scrollWidth > report.innerWidth + 2 || report.scrollHeight > report.innerHeight + 2) {
    throw new Error(`${label}: document overflow ${report.scrollWidth}x${report.scrollHeight} in ${report.innerWidth}x${report.innerHeight}`);
  }
  for (const [name, box] of Object.entries(report.boxes)) {
    if (!box) throw new Error(`${label}: missing ${name}`);
    if (box.left < -2 || box.top < -2 || box.right > width + 2 || box.bottom > height + 2) {
      throw new Error(`${label}: ${name} clipped ${JSON.stringify(box)}`);
    }
  }
  const board = report.boxes['.board-stage'];
  const left = report.boxes['.left-rail'];
  const right = report.boxes['.right-rail'];
  if (left.right > board.left + 1 || board.right > right.left + 1) throw new Error(`${label}: columns overlap`);

  await page.screenshot({ path: `.v08/screens/game-${label}.png`, fullPage: true });
  await page.close();
}

await browser.close();
console.log('visual verification passed');
