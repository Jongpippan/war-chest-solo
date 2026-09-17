import { chromium } from 'playwright';
import fs from 'node:fs';

const viewports = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
];

fs.mkdirSync('.v08/screens', { recursive: true });
const browser = await chromium.launch({ headless: true });
let failed = false;

for (const vp of viewports) {
  const page = await browser.newPage({ viewport: vp });
  await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
  await page.click('#recommendedBtn');
  await page.click('#startBtn');
  await page.waitForTimeout(1700);

  const audit = await page.evaluate(() => {
    const rect = (sel) => document.querySelector(sel)?.getBoundingClientRect();
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    const overflow = [...document.querySelectorAll('.supply-name, .resource-label, .header-game-meta, .bot-last-action, .interaction-hud')]
      .filter(visible)
      .filter((el) => el.scrollWidth > el.clientWidth + 3 || el.scrollHeight > el.clientHeight + 3)
      .map((el) => ({ cls: el.className, sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight }));
    const board = rect('#boardHost');
    const left = rect('.bot-side');
    const right = rect('.human-side');
    return {
      bodyOverflowX: document.documentElement.scrollWidth - innerWidth,
      bodyOverflowY: document.documentElement.scrollHeight - innerHeight,
      boardBottom: board?.bottom ?? 99999,
      boardTop: board?.top ?? -1,
      leftBottom: left?.bottom ?? 99999,
      rightBottom: right?.bottom ?? 99999,
      overflow,
    };
  });

  const problems = [];
  if (audit.bodyOverflowX > 2) problems.push(`horizontal overflow ${audit.bodyOverflowX}px`);
  if (audit.bodyOverflowY > 2) problems.push(`vertical overflow ${audit.bodyOverflowY}px`);
  if (audit.boardBottom > vp.height + 1) problems.push(`board clipped at ${audit.boardBottom.toFixed(1)}px`);
  if (audit.leftBottom > vp.height + 1) problems.push(`bot table clipped at ${audit.leftBottom.toFixed(1)}px`);
  if (audit.rightBottom > vp.height + 1) problems.push(`human table clipped at ${audit.rightBottom.toFixed(1)}px`);
  if (audit.overflow.length) problems.push(`content overflow: ${JSON.stringify(audit.overflow)}`);

  console.log(`${vp.width}x${vp.height}`, JSON.stringify(audit));
  await page.screenshot({ path: `.v08/screens/game-${vp.width}x${vp.height}.png`, fullPage: true });
  if (problems.length) {
    failed = true;
    console.error(`VISUAL FAIL ${vp.width}x${vp.height}: ${problems.join(' | ')}`);
  }
  await page.close();
}

await browser.close();
if (failed) process.exit(1);
console.log('visual verification passed');
