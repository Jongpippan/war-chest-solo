from pathlib import Path
import re

root = Path('.')
main_p = root / 'src/main.ts'
board_p = root / 'src/board.ts'
css_p = root / 'styles.css'
test_p = root / 'test/engine.test.mjs'

main = main_p.read_text()
board = board_p.read_text()
css = css_p.read_text()
test = test_p.read_text()

# Exact location pattern traced from the supplied physical board image.
board = re.sub(
    r"export const BOT_STARTS: HexId\[] = \[.*?export const ALL_LOCATIONS = \[\.\.\.HUMAN_STARTS, \.\.\.BOT_STARTS, \.\.\.NEUTRAL_LOCATIONS\];",
    """export const BOT_STARTS: HexId[] = [hexId(-1, -2), hexId(2, -3)];
export const HUMAN_STARTS: HexId[] = [hexId(1, 2), hexId(-2, 3)];
export const NEUTRAL_LOCATIONS: HexId[] = [
  hexId(1, -1),
  hexId(-1, 1),
  hexId(-2, 0),
  hexId(2, 0),
  hexId(3, -2),
  hexId(-3, 2),
];
export const ALL_LOCATIONS = [...HUMAN_STARTS, ...BOT_STARTS, ...NEUTRAL_LOCATIONS];""",
    board,
    count=1,
    flags=re.S,
)

# Replace decorative cross-shaped inactive clusters with the actual five-hex zig-zag wings.
main = re.sub(
    r"function inactiveCluster\(cx: number, cy: number, size = 28\): string \{.*?\n\}\n\n\nfunction renderBoardSvg",
    """function fourPlayerWing(side: 'left' | 'right'): string {
  const ids: HexId[] = side === 'left'
    ? ['-4,1', '-5,2', '-4,2', '-5,3', '-4,3']
    : ['4,-3', '5,-3', '4,-2', '5,-2', '4,-1'];
  return `<g class=\"inactive-cluster four-player-wing ${side}\">${ids.map((id) => {
    const { x, y } = axialToPixel(id);
    return `<polygon points=\"${hexPoints(x, y, 34)}\" fill=\"#a79578\" stroke=\"#8f7c60\" stroke-width=\"1.8\"/>`;
  }).join('')}</g>`;
}


function renderBoardSvg""",
    main,
    count=1,
    flags=re.S,
)
main = main.replace("${inactiveCluster(221, 338, 31)}\n    ${inactiveCluster(739, 338, 31)}", "${fourPlayerWing('left')}\n    ${fourPlayerWing('right')}")

# Supply rows: one Unit per row, with icon/name, visible supply coin stack, stats and action separated.
supply_func = r'''function renderSupplyCard(type: UnitType, owner: PlayerId, actions: ActionCandidate[] = []): string {
  if (!state) return '';
  const d = UNIT_DEFS[type];
  const p = state.players[owner];
  const supply = p.supply[type] ?? 0;
  const boardStrength = state.boardUnits.filter((u) => u.owner === owner && u.type === type).reduce((n, u) => n + u.strength, 0);
  const removed = p.removed.filter((c) => c === type).length;
  const stackCoins = Array.from({ length: Math.min(supply, 5) }, (_, i) => `<span class="supply-mini-coin" style="--i:${i};--coin-accent:${d.accent}">${unitIconSvg(type)}</span>`).join('');
  const recruit = owner === 'human' ? actions.find((a) => a.kind === 'RECRUIT' && a.payload.recruitType === type) : undefined;
  const tag = recruit ? 'button' : 'article';
  const attrs = recruit ? ` type="button" data-recruit-type="${type}" aria-label="Recruit ${esc(d.name)}"` : '';
  return `<${tag}${attrs} class="supply-card supply-row ${recruit ? 'actionable recruit-action' : ''}" style="--accent:${d.accent}" data-unit-type="${type}" data-owner-label="${owner === 'human' ? 'Your Unit' : 'Bot Unit'}" data-supply="${supply}" data-board="${boardStrength}" data-removed="${removed}">
    <div class="supply-identity"><span class="supply-icon">${unitIconSvg(type)}</span><span class="supply-name"><strong>${esc(d.name)}</strong><small>${esc(d.ko)}</small></span></div>
    <div class="supply-stack-wrap"><div class="supply-stack" aria-label="Supply ${supply}">${stackCoins || '<span class="supply-empty">EMPTY</span>'}</div><b class="supply-count">${supply}</b></div>
    <div class="supply-stats"><span><small>BOARD</small><b>${boardStrength}</b></span><span><small>OUT</small><b>${removed}</b></span><span><small>TOTAL</small><b>${d.coinCount}</b></span></div>
    ${recruit ? `<span class="supply-action-tag">${gameTerm('Recruit')}</span>` : ''}
  </${tag}>`;
}'''
main, n = re.subn(r"function renderSupplyCard\(type: UnitType, owner: PlayerId, actions: ActionCandidate\[] = \[]\): string \{.*?\n\}", supply_func, main, count=1, flags=re.S)
if n != 1:
    raise SystemExit('renderSupplyCard patch failed')

# Discard is a readable horizontal strip, not a cramped three-column block.
discard_func = r'''function renderDiscardZone(id: PlayerId, actions: ActionCandidate[] = []): string {
  if (!state) return '';
  const p = state.players[id];
  const visible = p.discard.slice(-6);
  const coins = visible.map((d) => tableCoin(d.faceUp ? d.coin : null, { faceUp: d.faceUp, className: 'discard-coin' })).join('');
  const up = p.discard.filter((d) => d.faceUp).length;
  const down = p.discard.length - up;
  const pass = id === 'human' ? actions.find((a) => a.kind === 'PASS') : undefined;
  const tag = pass ? 'button' : 'div';
  const attrs = pass ? ' type="button" data-pass-action="1" aria-label="Pass with selected Coin"' : '';
  return `<${tag}${attrs} class="resource-zone discard-zone ${pass ? 'face-down-action actionable' : ''}">
    <div class="discard-title"><span>DISCARD</span><b>${p.discard.length}</b></div>
    <div class="discard-stack">${coins || '<span class="empty-zone">EMPTY</span>'}${p.discard.length > 6 ? `<span class="more-count">+${p.discard.length - 6}</span>` : ''}</div>
    <div class="discard-counts"><span>FACE-UP <b>${up}</b></span><span>FACE-DOWN <b>${down}</b></span></div>
    ${pass ? `<span class="zone-action-tag">${gameTerm('Pass')}</span>` : ''}
  </${tag}>`;
}'''
main, n = re.subn(r"function renderDiscardZone\(id: PlayerId, actions: ActionCandidate\[] = \[]\): string \{.*?\n\}", discard_func, main, count=1, flags=re.S)
if n != 1:
    raise SystemExit('renderDiscardZone patch failed')

# Clear concise supply heading.
main = main.replace("<div class=\"supply-heading\"><span>UNIT SUPPLY</span><small>${id === 'human' ? 'Click a highlighted Supply stack to Recruit' : 'Public information'}</small></div>", "<div class=\"supply-heading\"><span>UNIT SUPPLY</span><small>${id === 'human' ? 'Select a highlighted row to Recruit' : 'PUBLIC'}</small></div>")

# Regression tests for image-matched location coordinates.
if "physical board image coordinates" not in test:
    test += r'''

test('physical board image coordinates are used for the 2-player Locations', () => {
  assert.deepEqual(new Set(BOT_STARTS), new Set(['-1,-2', '2,-3']));
  assert.deepEqual(new Set(HUMAN_STARTS), new Set(['1,2', '-2,3']));
  assert.deepEqual(new Set(NEUTRAL_LOCATIONS), new Set(['1,-1', '-1,1', '-2,0', '2,0', '3,-2', '-3,2']));
});
'''

# UI overhaul appended last so it wins over old v0.6-v0.8 overrides.
css += r'''

/* v0.9 physical-board + side-panel legibility pass */
* {
  word-break: keep-all !important;
  overflow-wrap: normal !important;
  hyphens: none !important;
}
p, span, small, strong, b, button, label, summary, li, h1, h2, h3, h4 {
  word-break: keep-all !important;
  overflow-wrap: normal !important;
  hyphens: none !important;
}
button, .game-term, .round-chip, .turn-chip, .difficulty-chip, .rule-kind,
.resource-label, .supply-heading > span, .zone-action-tag, .supply-action-tag {
  white-space: nowrap;
}

/* Use the vertical room instead of squeezing four Units into two columns. */
.tabletop-player {
  overflow-x: hidden !important;
  overflow-y: auto !important;
  scrollbar-width: thin;
  align-content: start !important;
}
.tabletop-player.bot .supply-grid,
.tabletop-player.human .supply-grid,
.supply-grid {
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) !important;
  grid-auto-rows: minmax(64px, auto) !important;
  gap: 6px !important;
  min-height: 0;
  align-content: start;
  overflow: visible !important;
}
.supply-heading {
  min-height: 20px;
  align-items: end;
}
.supply-heading span { font-size: 9px !important; }
.supply-heading small {
  font-size: 8px !important;
  line-height: 1.2;
  text-align: right;
}

.supply-card,
.tabletop-player.bot .supply-card,
.tabletop-player.human .supply-card {
  position: relative;
  min-width: 0;
  min-height: 64px !important;
  width: 100%;
  padding: 7px 8px !important;
  display: grid !important;
  grid-template-columns: minmax(112px, 1.25fr) minmax(68px, .8fr) auto !important;
  grid-template-rows: 1fr !important;
  align-items: center !important;
  gap: 8px !important;
  overflow: visible !important;
  border-radius: 13px !important;
}
.supply-identity {
  min-width: 0;
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}
.supply-icon,
.tabletop-player.bot .supply-icon,
.tabletop-player.human .supply-icon {
  width: 36px !important;
  height: 36px !important;
}
.supply-icon .unit-icon { width: 20px !important; height: 20px !important; }
.supply-name {
  min-width: 0;
  display: block !important;
  line-height: 1.12 !important;
}
.supply-name strong,
.tabletop-player.bot .supply-name strong,
.tabletop-player.human .supply-name strong {
  display: block;
  font-size: 11px !important;
  line-height: 1.15;
  white-space: normal !important;
  overflow: visible !important;
  text-overflow: clip !important;
}
.supply-name small,
.tabletop-player.bot .supply-name small,
.tabletop-player.human .supply-name small {
  display: block !important;
  margin-top: 2px;
  font-size: 8px !important;
  line-height: 1.15;
  white-space: normal !important;
  overflow: visible !important;
  text-overflow: clip !important;
}
.supply-stack-wrap {
  min-width: 68px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 5px;
}
.supply-stack,
.tabletop-player.bot .supply-stack,
.tabletop-player.human .supply-stack {
  position: relative;
  height: 34px !important;
  min-width: 48px;
  overflow: visible;
}
.supply-mini-coin,
.tabletop-player.bot .supply-mini-coin,
.tabletop-player.human .supply-mini-coin {
  --offset: calc(var(--i) * 8px);
  width: 30px !important;
  height: 30px !important;
}
.supply-mini-coin .unit-icon { width: 15px !important; height: 15px !important; }
.supply-count {
  min-width: 18px;
  text-align: right;
  font-size: 13px;
  color: #4d3d2d;
}
.supply-stats,
.tabletop-player.bot .supply-stats,
.tabletop-player.human .supply-stats {
  min-width: 66px;
  display: grid !important;
  grid-template-columns: repeat(3, auto) !important;
  gap: 6px !important;
  justify-content: end;
  align-items: center;
}
.supply-stats span,
.tabletop-player.bot .supply-stats span,
.tabletop-player.human .supply-stats span {
  display: grid !important;
  justify-items: center;
  gap: 1px;
  min-width: 18px;
  font-size: 7px !important;
  line-height: 1;
}
.supply-stats small { font-size: 6.5px; color: #86725a; }
.supply-stats b,
.tabletop-player.bot .supply-stats b,
.tabletop-player.human .supply-stats b {
  display: block !important;
  margin: 0 !important;
  font-size: 10px !important;
}
.supply-action-tag {
  right: 7px !important;
  bottom: -7px !important;
  z-index: 3;
  padding: 3px 7px !important;
  border: 1px solid rgba(85,67,44,.12);
  box-shadow: 0 2px 5px rgba(55,40,24,.12);
  font-size: 8px !important;
}

/* Resource zones gain breathing room; Discard becomes a stable one-line strip. */
.resource-table {
  grid-template-columns: minmax(0, 1.45fr) minmax(76px, .62fr) !important;
  gap: 7px !important;
}
.resource-zone { overflow: visible !important; }
.hand-zone, .bag-zone { min-height: 78px; }
.coin-fan { min-height: 44px; flex-wrap: nowrap; }
.discard-zone,
.tabletop-player.bot .discard-zone,
.tabletop-player.human .discard-zone {
  min-height: 52px;
  padding: 7px 8px !important;
  display: grid !important;
  grid-template-columns: auto minmax(60px, 1fr) auto !important;
  align-items: center;
  gap: 8px !important;
}
.discard-title {
  display: grid;
  gap: 2px;
  color: #6f5b43;
}
.discard-title span { font-size: 8px; letter-spacing: .1em; font-weight: 950; }
.discard-title b { font-size: 13px; }
.discard-stack { min-height: 34px !important; overflow: visible; }
.discard-counts {
  display: grid;
  gap: 3px;
  justify-items: end;
  color: #7a684f;
}
.discard-counts span { font-size: 7.5px; white-space: nowrap; }
.discard-counts b { color: #453727; }
.zone-action-tag {
  right: 7px !important;
  bottom: -7px !important;
  z-index: 3;
  padding: 3px 7px !important;
}

/* Never hide or ellipsize human-readable gameplay text. */
.bot-last-action,
.bot-last-move { overflow: visible !important; }
.bot-last-action > strong,
.bot-last-action > small,
.bot-last-move strong,
.bot-last-move small {
  overflow: visible !important;
  text-overflow: clip !important;
  white-space: normal !important;
  line-height: 1.2;
}
.interaction-copy > span,
.face-down-guide span,
.rule-section p,
.tooltip-title-wrap h4,
.tooltip-title-wrap h4 span {
  white-space: normal !important;
  overflow: visible !important;
  text-overflow: clip !important;
  word-break: keep-all !important;
  overflow-wrap: normal !important;
}

/* Match the supplied physical board: light radius-3 2P field + dark 4P-only zig-zag wings. */
.inactive-cluster polygon {
  fill: #9c8c72 !important;
  stroke: #806f58 !important;
  stroke-width: 2 !important;
  opacity: .92;
}
.four-player-wing { pointer-events: none; }
.battlefield .hex-cell:not(.location-hex) > polygon { fill: #eadbb6; }
.hex-cell.location-hex > polygon {
  fill: #ead9a7 !important;
  stroke: #b7944d !important;
}
.location-emblem.neutral { filter: drop-shadow(0 0 4px rgba(99,132,66,.38)) !important; }

@media (max-height: 820px) and (min-width: 1101px) {
  .tabletop-player { padding: 6px !important; gap: 4px !important; }
  .hand-zone, .bag-zone { min-height: 68px; }
  .tabletop-player.bot .supply-grid,
  .tabletop-player.human .supply-grid,
  .supply-grid { grid-auto-rows: minmax(57px, auto) !important; gap: 5px !important; }
  .supply-card,
  .tabletop-player.bot .supply-card,
  .tabletop-player.human .supply-card { min-height: 57px !important; padding: 5px 6px !important; gap: 6px !important; }
  .supply-identity { grid-template-columns: 31px minmax(0,1fr); gap: 6px; }
  .supply-icon,
  .tabletop-player.bot .supply-icon,
  .tabletop-player.human .supply-icon { width:31px !important; height:31px !important; }
  .supply-mini-coin,
  .tabletop-player.bot .supply-mini-coin,
  .tabletop-player.human .supply-mini-coin { width:25px !important; height:25px !important; }
  .supply-stack { height:29px !important; }
  .discard-zone { min-height: 45px; }
}

@media (max-width: 1320px) and (min-width: 1101px) {
  .direct-table-layout.workspace-grid { grid-template-columns: minmax(255px, 280px) minmax(500px, 1fr) minmax(255px, 280px) !important; }
  .supply-card { grid-template-columns: minmax(100px,1.15fr) minmax(58px,.7fr) auto !important; gap:5px !important; }
  .supply-name small { display:block !important; }
  .supply-heading small { display:block !important; }
  .supply-stats { gap:4px !important; }
}

@media (max-width: 1100px) {
  .supply-grid { grid-template-columns: minmax(0,1fr) !important; }
  .supply-card { min-height:68px !important; }
}
'''

main_p.write_text(main)
board_p.write_text(board)
css_p.write_text(css)
test_p.write_text(test)
print('v0.9 patch applied')
