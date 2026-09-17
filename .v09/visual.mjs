import { chromium } from 'playwright';
import fs from 'node:fs';

fs.mkdirSync('.v09/screens', { recursive: true });
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
  await page.waitForSelector('.game-shell');
  await page.waitForTimeout(1200);

  const report = await page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height };
    };
    const boxes = Object.fromEntries(['.integrated-header','.left-rail','.board-stage','.right-rail','#boardHost','.interaction-hud'].map((s) => [s, rect(s)]));
    const panels = [...document.querySelectorAll('.tabletop-player')].map((el) => ({ clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth }));
    const supplyRows = [...document.querySelectorAll('.supply-card')].map((el) => {
      const r = el.getBoundingClientRect();
      return { width:r.width, height:r.height, scrollWidth:el.scrollWidth, scrollHeight:el.scrollHeight };
    });
    const clippedText = [...document.querySelectorAll('.supply-name strong,.supply-name small,.supply-heading small,.discard-counts span,.bot-last-action strong,.bot-last-action small,.interaction-copy span,.rule-section p')]
      .filter((el) => el.clientWidth > 0 && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1))
      .map((el) => ({ text: el.textContent?.trim().slice(0,80), cls: el.className, sw:el.scrollWidth,cw:el.clientWidth,sh:el.scrollHeight,ch:el.clientHeight }));
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      boxes,
      panels,
      supplyRows,
      supplyColumns: getComputedStyle(document.querySelector('.supply-grid')).gridTemplateColumns,
      wingHexes: document.querySelectorAll('.four-player-wing polygon').length,
      locations: document.querySelectorAll('.location-hex').length,
      clippedText,
      font: getComputedStyle(document.body).fontFamily,
    };
  });

  console.log(label, JSON.stringify(report));
  if (report.scrollWidth > width + 2 || report.scrollHeight > height + 2) throw new Error(`${label}: document overflow`);
  for (const [name, box] of Object.entries(report.boxes)) {
    if (!box) throw new Error(`${label}: missing ${name}`);
    if (box.left < -2 || box.top < -2 || box.right > width + 2 || box.bottom > height + 2) throw new Error(`${label}: clipped ${name}`);
  }
  if (report.panels.some((p) => p.scrollHeight > p.clientHeight + 2 || p.scrollWidth > p.clientWidth + 2)) throw new Error(`${label}: side panel content overflow`);
  if (report.supplyRows.some((r) => r.scrollWidth > r.width + 2 || r.scrollHeight > r.height + 2)) throw new Error(`${label}: supply row overflow`);
  if (report.supplyColumns.trim().split(/\s+/).length !== 1) throw new Error(`${label}: Supply must be one column`);
  if (report.wingHexes !== 10) throw new Error(`${label}: expected 10 four-player-only wing hexes, got ${report.wingHexes}`);
  if (report.locations !== 10) throw new Error(`${label}: expected 10 two-player locations, got ${report.locations}`);
  if (report.clippedText.length) throw new Error(`${label}: clipped text ${JSON.stringify(report.clippedText)}`);
  if (!report.font.toLowerCase().includes('pretendard')) throw new Error(`${label}: Pretendard not applied: ${report.font}`);

  await page.screenshot({ path: `.v09/screens/game-${label}.png`, fullPage: true });
  await page.close();
}

await browser.close();
console.log('v0.9 visual verification passed');
