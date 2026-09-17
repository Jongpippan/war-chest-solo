from pathlib import Path
import re

ROOT = Path('.')
main_p = ROOT / 'src/main.ts'
board_p = ROOT / 'src/board.ts'
css_p = ROOT / 'styles.css'
test_p = ROOT / 'test/engine.test.mjs'

main = main_p.read_text()
board = board_p.read_text()
css = css_p.read_text()
test = test_p.read_text()

# --- Exact 2-player board orientation / locations ---
board_old = """// Symmetric 2-player layout on the 37-hex central battlefield.\n// It mirrors the physical board's structure: two starting locations per side + six neutral locations.\nexport const HUMAN_STARTS: HexId[] = [hexId(0, 3), hexId(-2, 3)];\nexport const BOT_STARTS: HexId[] = [hexId(0, -3), hexId(2, -3)];\nexport const NEUTRAL_LOCATIONS: HexId[] = [\n  hexId(-2, 0),\n  hexId(2, 0),\n  hexId(0, -1),\n  hexId(0, 1),\n  hexId(2, -1),\n  hexId(-2, 1),\n];\n"""
board_new = """// Two-player layout matched to the physical base-game board.\n// The 37 light central hexes are active; the dark outer side clusters are not used in 2-player.\n// Coordinates are axial and rendered flat-top in main.ts.\nexport const HUMAN_STARTS: HexId[] = [hexId(-2, 3), hexId(1, 2)];\nexport const BOT_STARTS: HexId[] = [hexId(-1, -2), hexId(2, -3)];\nexport const NEUTRAL_LOCATIONS: HexId[] = [\n  hexId(-2, 0),\n  hexId(2, 0),\n  hexId(1, -1),\n  hexId(-1, 1),\n  hexId(3, -2),\n  hexId(-3, 2),\n];\n"""
if board_old not in board:
    raise SystemExit('board layout block not found')
board = board.replace(board_old, board_new)

# --- Unit card terminology: English rule labels + highlighted game terms ---
old = """function ruleSectionsHtml(type: UnitType): string {\n  return `<div class=\"rule-sections\">${UNIT_CARD_RULES[type].map((section) => `<div class=\"rule-section ${section.kind.toLowerCase()}\"><span class=\"rule-kind\">${section.title}</span><p>${esc(section.text)}</p></div>`).join('')}</div>`;\n}\n"""
new = """function ruleSectionsHtml(type: UnitType): string {\n  return `<div class=\"rule-sections\">${UNIT_CARD_RULES[type].map((section) => `<div class=\"rule-section ${section.kind.toLowerCase()}\"><span class=\"rule-kind\">${section.kind}</span><p>${formatGameText(section.text)}</p></div>`).join('')}</div>`;\n}\n"""
if old not in main:
    raise SystemExit('ruleSectionsHtml block not found')
main = main.replace(old, new)

# English public table labels and terms.
repls = {
    "return id === 'human' ? '당신' : '봇';": "return id === 'human' ? 'YOU' : 'BOT';",
    "'<span class=\"empty-zone\">비어 있음</span>'": "'<span class=\"empty-zone\">EMPTY</span>'",
    "<span>앞 ${up}</span><span>뒤 ${down}</span>": "<span>UP ${up}</span><span>DOWN ${down}</span>",
    "<span>공급 <b>${supply}</b></span><span>보드 <b>${boardStrength}</b></span><span>제거 <b>${removed}</b></span>": "<span>SUPPLY <b>${supply}</b></span><span>BOARD <b>${boardStrength}</b></span><span>REMOVED <b>${removed}</b></span>",
    "<span>/ 6 거점</span>": "<span>/ 6 LOCATIONS</span>",
    "<small>카드 Hover로 능력 확인</small>": "<small>Hover for unit rules</small>",
}
for a,b in repls.items():
    main = main.replace(a,b)

# Flat-top physical board orientation.
main, count = re.subn(
    r"function axialToPixel\(id: HexId\): \{ x: number; y: number \} \{.*?\n\}\n\nfunction hexPoints\(cx: number, cy: number, size = 31\): string \{.*?\n\}\n",
    """function axialToPixel(id: HexId): { x: number; y: number } {\n  const { q, r } = parseHex(id);\n  const size = 39;\n  return {\n    x: 480 + size * 1.5 * q,\n    y: 338 + size * Math.sqrt(3) * (r + q / 2),\n  };\n}\n\nfunction hexPoints(cx: number, cy: number, size = 34): string {\n  const pts: string[] = [];\n  for (let i = 0; i < 6; i += 1) {\n    const angle = (Math.PI / 180) * (60 * i);\n    pts.push(`${(cx + size * Math.cos(angle)).toFixed(2)},${(cy + size * Math.sin(angle)).toFixed(2)}`);\n  }\n  return pts.join(' ');\n}\n""",
    main,
    count=1,
    flags=re.S,
)
if count != 1:
    raise SystemExit('axial/hex renderer block not found')

# Make excluded side areas flat-top too and visually attached to the physical field.
main = main.replace(
    "const x = cx + size * Math.sqrt(3) * (q + r / 2);\n    const y = cy + size * 1.5 * r;",
    "const x = cx + size * 1.5 * q;\n    const y = cy + size * Math.sqrt(3) * (r + q / 2);",
)
main = main.replace("${inactiveCluster(208, 339)}", "${inactiveCluster(221, 338, 31)}")
main = main.replace("${inactiveCluster(752, 339)}", "${inactiveCluster(739, 338, 31)}")

# Stronger Location rendering and class.
loc_old = """const locationMark = isLocation\n      ? `<g class=\"location-emblem\"><circle cx=\"${x}\" cy=\"${y}\" r=\"18\" fill=\"rgba(255,250,241,.8)\" stroke=\"${controller === 'human' ? '#2c6f77' : controller === 'bot' ? '#91454e' : '#9c7c3e'}\" stroke-width=\"2.5\"/><circle cx=\"${x}\" cy=\"${y}\" r=\"8.5\" fill=\"${controller === 'human' ? '#2c6f77' : controller === 'bot' ? '#91454e' : '#b0904c'}\" opacity=\".85\"/></g>`\n      : '';"""
loc_new = """const locationColor = controller === 'human' ? '#277c80' : controller === 'bot' ? '#a34c58' : '#b68a2a';\n    const locationMark = isLocation\n      ? `<g class=\"location-emblem ${controller ?? 'neutral'}\"><polygon points=\"${hexPoints(x, y, 27)}\" fill=\"rgba(255,250,232,.72)\" stroke=\"${locationColor}\" stroke-width=\"3.6\"/><circle cx=\"${x}\" cy=\"${y}\" r=\"14\" fill=\"rgba(255,248,219,.95)\" stroke=\"${locationColor}\" stroke-width=\"2.6\"/><path d=\"M ${x - 8} ${y} C ${x - 4} ${y - 8}, ${x + 4} ${y - 8}, ${x + 8} ${y} C ${x + 4} ${y + 8}, ${x - 4} ${y + 8}, ${x - 8} ${y} Z\" fill=\"none\" stroke=\"${locationColor}\" stroke-width=\"2\"/><circle cx=\"${x}\" cy=\"${y}\" r=\"3.2\" fill=\"${locationColor}\"/></g>`\n      : '';"""
if loc_old not in main:
    raise SystemExit('locationMark block not found')
main = main.replace(loc_old, loc_new)
main = main.replace(
    "return `<g class=\"hex-cell ${preview ? 'preview' : ''} ${hexCls}\"${hexAttr}><polygon",
    "return `<g class=\"hex-cell ${isLocation ? 'location-hex' : ''} ${controller ? `controlled-${controller}` : ''} ${preview ? 'preview' : ''} ${hexCls}\"${hexAttr}><polygon",
)

# Crop SVG board art vertically and remove large decorative top/bottom dead space.
main = main.replace('viewBox="0 0 960 680" role="img" aria-label="War Chest battlefield"', 'viewBox="54 58 852 560" role="img" aria-label="War Chest battlefield"')
main = main.replace('<rect x="430" y="82" width="100" height="42" rx="10" fill="#a8a5a9" opacity=".55"/>', '<rect x="435" y="70" width="90" height="28" rx="8" fill="#a8a5a9" opacity=".42"/>')
main = main.replace('<rect x="430" y="556" width="100" height="42" rx="10" fill="#a8a5a9" opacity=".55"/>', '<rect x="435" y="578" width="90" height="28" rx="8" fill="#a8a5a9" opacity=".42"/>')

# Replace status bar with header-integrated controls.
status_pattern = r"function renderStatusBar\(actions: ActionCandidate\[\] = \[\]\): string \{.*?\n\}\n\nfunction renderUtilityDrawer"
status_repl = """function renderHeaderControls(actions: ActionCandidate[] = []): string {\n  if (!state) return '';\n  const active = state.activePlayer === 'human' ? 'YOUR TURN' : 'BOT TURN';\n  const claim = actions.find((a) => a.kind === 'CLAIM_INITIATIVE');\n  const owner = state.initiative === 'human' ? 'YOU' : 'BOT';\n  return `<div class=\"header-game-meta\"><span class=\"round-chip\">ROUND <b>${state.round}</b></span><span class=\"turn-chip ${state.activePlayer}\">${active}</span><button type=\"button\" id=\"claimInitiativeToken\" class=\"initiative-token-control ${state.initiative === 'human' ? 'human-owned' : 'bot-owned'} ${claim ? 'actionable' : ''}\" ${claim ? '' : 'disabled'}><span class=\"initiative-medallion\">◆</span><span>${gameTerm('Initiative')} <b>${owner}</b></span></button><span class=\"difficulty-chip\">BOT ${difficultyLabel(difficulty)}</span></div><div class=\"utility-toolbar\"><button type=\"button\" class=\"utility-toggle ${utilityPanel === 'analysis' ? 'active' : ''}\" data-utility=\"analysis\">◎ ANALYSIS</button><button type=\"button\" class=\"utility-toggle ${utilityPanel === 'bot' ? 'active' : ''}\" data-utility=\"bot\">◇ BOT</button><button type=\"button\" class=\"utility-toggle ${utilityPanel === 'log' ? 'active' : ''}\" data-utility=\"log\">≡ LOG</button></div>`;\n}\n\nfunction renderBotLastAction(): string {\n  if (!lastBotThought) return '<div class=\"bot-last-action idle\"><span>BOT LAST ACTION</span><strong>Waiting for the bot to act</strong></div>';\n  return `<div class=\"bot-last-action\"><span>BOT LAST ACTION · ROUND ${lastBotThought.round}</span><strong>${formatGameText(lastBotThought.label)}</strong><small>${formatGameText(lastBotThought.reason)}</small></div>`;\n}\n\nfunction renderUtilityDrawer"""
main, count = re.subn(status_pattern, status_repl, main, count=1, flags=re.S)
if count != 1:
    raise SystemExit('renderStatusBar block not found')

# Recompose the game shell: one header, board first, interaction HUD below it.
old_markup = """app.innerHTML = `<main class=\"game-shell\">\n    <header class=\"topbar compact\"><div><div class=\"eyebrow\">LOCAL SOLO · DIRECT TABLE INPUT</div><h1>War Chest Solo</h1></div><div class=\"topbar-actions\"><button id=\"undoBtn\" class=\"ghost\" ${undoStack.length && !botBusy ? '' : 'disabled'}>↶ Undo</button><button id=\"rulesBtn\" class=\"ghost\">Rules</button><button id=\"restartBtn\" class=\"ghost danger\">Restart</button></div></header>\n    ${renderStatusBar(actions)}\n    ${sanity.length ? `<div class=\"debug-warning\">State warning: ${esc(sanity.join(' / '))}</div>` : ''}\n    <section class=\"workspace-grid direct-table-layout\">\n      <aside class=\"left-rail player-rail bot-side\">${renderPlayerPanel('bot', actions)}</aside>\n      <section class=\"board-stage\"><div class=\"board-panel\"><div class=\"board-title\"><div><div class=\"eyebrow\">BATTLEFIELD</div><h2>Direct Battlefield</h2></div><div class=\"board-legend\"><span><i class=\"legend-dot bot\"></i>BOT</span><span><i class=\"legend-dot human\"></i>YOU</span><span><i class=\"legend-location\"></i>Location</span></div></div>${renderInteractionHud(actions)}<div id=\"boardHost\">${renderBoardSvg(actions)}</div></div></section>\n      <aside class=\"right-rail player-rail human-side\">${renderPlayerPanel('human', actions)}</aside>\n    </section>\n    ${renderUtilityDrawer()}\n"""
new_markup = """app.innerHTML = `<main class=\"game-shell\">\n    <header class=\"topbar compact integrated-header\"><div class=\"brand-lockup\"><div class=\"eyebrow\">LOCAL SOLO · DIRECT TABLE INPUT</div><h1>War Chest Solo</h1></div><div class=\"header-center\">${renderHeaderControls(actions)}${renderBotLastAction()}</div><div class=\"topbar-actions\"><button id=\"undoBtn\" class=\"ghost\" ${undoStack.length && !botBusy ? '' : 'disabled'}>↶ Undo</button><button id=\"rulesBtn\" class=\"ghost\">Rules</button><button id=\"restartBtn\" class=\"ghost danger\">Restart</button></div></header>\n    ${sanity.length ? `<div class=\"debug-warning\">State warning: ${esc(sanity.join(' / '))}</div>` : ''}\n    <section class=\"workspace-grid direct-table-layout\">\n      <aside class=\"left-rail player-rail bot-side\">${renderPlayerPanel('bot', actions)}</aside>\n      <section class=\"board-stage\"><div class=\"board-panel\"><div class=\"board-title\"><div><div class=\"eyebrow\">BATTLEFIELD</div><h2>2-Player Battlefield</h2></div><div class=\"board-legend\"><span><i class=\"legend-dot bot\"></i>BOT</span><span><i class=\"legend-dot human\"></i>YOU</span><span><i class=\"legend-location\"></i>LOCATION</span></div></div><div id=\"boardHost\">${renderBoardSvg(actions)}</div>${renderInteractionHud(actions)}</div></section>\n      <aside class=\"right-rail player-rail human-side\">${renderPlayerPanel('human', actions)}</aside>\n    </section>\n    ${renderUtilityDrawer()}\n"""
if old_markup not in main:
    raise SystemExit('renderGame markup block not found')
main = main.replace(old_markup, new_markup)

# Translate the quick rules deploy wording more precisely.
main = main.replace('place the Unit Coin directly on the Battlefield.', 'place the Unit Coin on an empty controlled Location (Scout is the adjacency exception).')

# Regression tests: standard Deploy must be controlled Location only; exact physical locations.
if "standard Deploy targets only empty controlled Locations" not in test:
    test = test.replace("import { hexId } from '../dist/board.js';", "import { hexId, ALL_LOCATIONS, HUMAN_STARTS, BOT_STARTS, NEUTRAL_LOCATIONS } from '../dist/board.js';")
    test += """\n\ntest('standard Deploy targets only empty controlled Locations', () => {\n  const s = cleanGame();\n  s.players.human.hand = ['ARCHER'];\n  const deploys = generateActionsForCoin(s, 'human', 'ARCHER', 'HAND', 0).filter((a) => a.kind === 'DEPLOY');\n  assert(deploys.length > 0);\n  for (const action of deploys) {\n    const hex = action.payload.destination;\n    assert(hex);\n    assert(ALL_LOCATIONS.includes(hex));\n    assert.equal(s.locations[hex], 'human');\n  }\n});\n\ntest('2-player physical starting and neutral Locations match the base board', () => {\n  assert.deepEqual(HUMAN_STARTS, [hexId(-2, 3), hexId(1, 2)]);\n  assert.deepEqual(BOT_STARTS, [hexId(-1, -2), hexId(2, -3)]);\n  assert.deepEqual(new Set(NEUTRAL_LOCATIONS), new Set([hexId(-2, 0), hexId(2, 0), hexId(1, -1), hexId(-1, 1), hexId(3, -2), hexId(-3, 2)]));\n});\n"""

# Pretendard + v0.8 visual system / viewport fixes.
if not css.startswith('@import url("https://cdn.jsdelivr.net/gh/orioncactus/pretendard'):
    css = '@import url("https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css");\n' + css

css += r'''

/* v0.8 board-accuracy + one-screen UX pass */
:root { --font-ui: "Pretendard", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
html, body, button, input, select, textarea { font-family: var(--font-ui) !important; }
body:has(.game-shell) { overflow: hidden; }
.game-shell {
  height: 100dvh;
  max-width: 1800px;
  padding: 6px 10px 8px;
  gap: 6px;
  grid-template-rows: auto minmax(0, 1fr);
}
.integrated-header {
  min-height: 58px;
  display: grid;
  grid-template-columns: minmax(170px, .72fr) minmax(520px, 2.1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 5px 8px;
}
.brand-lockup { min-width: 0; }
.brand-lockup h1 { margin: 1px 0 0; font-size: clamp(20px, 1.7vw, 27px); line-height: 1; white-space: nowrap; }
.brand-lockup .eyebrow { font-size: 8px; }
.header-center { min-width: 0; display: grid; grid-template-columns: auto minmax(180px, 1fr); gap: 8px; align-items: center; }
.header-game-meta { min-width: 0; display: flex; align-items: center; gap: 5px; flex-wrap: nowrap; }
.header-game-meta > span, .round-chip, .turn-chip { white-space: nowrap; }
.round-chip, .turn-chip, .difficulty-chip {
  border-radius: 999px;
  padding: 5px 8px;
  background: rgba(255,255,255,.46);
  border: 1px solid rgba(101,77,48,.14);
  color: #5f4b34;
  font-size: 9px;
  font-weight: 850;
}
.turn-chip.human { background: rgba(47,115,122,.13); color: #275f66; }
.turn-chip.bot { background: rgba(149,76,84,.12); color: #8d4650; }
.integrated-header .initiative-token-control { padding: 3px 7px 3px 4px; }
.integrated-header .initiative-medallion { width: 22px; height: 22px; }
.integrated-header .utility-toolbar { margin-left: 0; }
.integrated-header .utility-toggle { padding: 4px 6px; font-size: 8px; }
.integrated-header .topbar-actions { justify-content: flex-end; gap: 5px; }
.integrated-header .topbar-actions .ghost { padding: 6px 8px; font-size: 10px; }

.bot-last-action {
  min-width: 0;
  border-radius: 10px;
  padding: 5px 8px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  grid-template-areas: "tag action" "tag reason";
  column-gap: 8px;
  background: linear-gradient(90deg, rgba(149,76,84,.12), rgba(255,255,255,.36));
  border: 1px solid rgba(149,76,84,.18);
  overflow: hidden;
}
.bot-last-action > span { grid-area: tag; align-self: center; color: #8d4650; font-size: 7.5px; font-weight: 950; letter-spacing: .06em; white-space: nowrap; }
.bot-last-action > strong { grid-area: action; min-width: 0; color: #44352a; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bot-last-action > small { grid-area: reason; min-width: 0; color: #796856; font-size: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bot-last-action.idle { opacity: .58; }

.status-bar { display: none !important; }
.direct-table-layout.workspace-grid {
  min-height: 0;
  height: 100%;
  grid-template-columns: minmax(245px, 292px) minmax(560px, 1fr) minmax(245px, 292px);
  gap: 7px;
}
.board-stage, .board-panel, #boardHost { min-height: 0; }
.board-panel {
  height: 100%;
  padding: 5px 6px 6px;
  gap: 3px;
  grid-template-rows: auto minmax(0, 1fr) auto;
}
.board-title { min-height: 28px; }
.board-title h2 { margin: 0; font-size: 14px; line-height: 1; }
.board-title .eyebrow { font-size: 7px; }
.board-legend { font-size: 8px; gap: 6px; }
#boardHost {
  width: 100%;
  height: 100%;
  overflow: hidden;
  display: grid;
  place-items: center;
}
.battlefield {
  display: block;
  width: 100%;
  height: 100%;
  max-height: none;
  object-fit: contain;
}
.interaction-hud {
  margin-top: 1px;
  padding: 5px 7px;
  gap: 7px;
  border-radius: 10px;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
}
.selected-coin-hud { min-width: 102px; }
.selected-coin-hud .table-coin.static { width: 34px; height: 34px; }
.interaction-copy > strong { font-size: 10px; }
.interaction-copy > span, .face-down-guide { font-size: 8px; line-height: 1.25; }
.interaction-legend { font-size: 8px; white-space: normal; }
.micro-action { padding: 4px 7px; font-size: 8px; }

/* Locations should read before Units. */
.hex-cell.location-hex > polygon {
  fill: #f2dfa2 !important;
  stroke: #b1872c !important;
  stroke-width: 3 !important;
  filter: drop-shadow(0 0 3px rgba(164,122,31,.25));
}
.hex-cell.location-hex.controlled-human > polygon { fill: #b8dfdc !important; stroke: #277c80 !important; }
.hex-cell.location-hex.controlled-bot > polygon { fill: #ecc6c9 !important; stroke: #a34c58 !important; }
.location-emblem { pointer-events: none; }
.location-emblem polygon { filter: drop-shadow(0 1px 2px rgba(69,49,24,.15)); }
.legend-location { box-shadow: inset 0 0 0 3px #b1872c; background: #f2dfa2; }

/* Keep dense side panels legible instead of clipping text. */
.tabletop-player { padding: 7px; gap: 4px; }
.tabletop-heading h2 { font-size: 15px; }
.control-score strong { font-size: 16px; }
.control-score span { font-size: 7px; }
.resource-zone { padding: 5px 6px !important; }
.resource-label span { font-size: 7px; }
.supply-heading span { font-size: 7.5px; }
.supply-heading small { font-size: 7px; }
.tabletop-player.bot .supply-grid,
.tabletop-player.human .supply-grid { grid-auto-rows: minmax(74px, 1fr); gap: 4px; }
.supply-card { overflow: visible; }
.supply-name strong { font-size: 9px; }
.supply-name small { font-size: 6.8px; }
.supply-stats span { font-size: 6px !important; white-space: nowrap; }
.supply-stats b { font-size: 8px !important; }

/* Unit cards: English rule labels, colored English game terminology. */
.rule-kind { min-width: 68px; font-size: 8px; letter-spacing: .055em; }
.rule-section { grid-template-columns: 72px minmax(0,1fr); gap: 8px; }
.rule-section p { font-family: var(--font-ui); font-size: 11px; line-height: 1.45; word-break: keep-all; }
.rule-section .game-term { font-weight: 900; }
.tooltip-title-wrap h4, .tooltip-meta, .diagram-caption { font-family: var(--font-ui); }

.utility-drawer { top: 68px; max-height: calc(100% - 80px); }

@media (max-height: 820px) and (min-width: 1101px) {
  .game-shell { padding-top: 4px; gap: 4px; }
  .integrated-header { min-height: 50px; padding: 3px 6px; }
  .brand-lockup h1 { font-size: 20px; }
  .bot-last-action > small { display: none; }
  .bot-last-action { grid-template-areas: "tag action"; }
  .board-title { min-height: 23px; }
  .board-panel { padding: 3px 4px 4px; gap: 2px; }
  .interaction-hud { padding: 3px 5px; }
  .interaction-copy > span { display: none; }
  .tabletop-player { padding: 5px; gap: 3px; }
  .tabletop-player.bot .supply-grid,
  .tabletop-player.human .supply-grid { grid-auto-rows: 66px; }
  .table-coin { width: 32px; height: 32px; }
  .table-coin .unit-icon { width: 17px; height: 17px; }
}

@media (max-width: 1320px) and (min-width: 1101px) {
  .integrated-header { grid-template-columns: 155px minmax(0, 1fr) auto; gap: 7px; }
  .header-center { grid-template-columns: auto minmax(130px, 1fr); gap: 5px; }
  .round-chip, .turn-chip, .difficulty-chip { padding: 4px 6px; font-size: 8px; }
  .integrated-header .utility-toggle { font-size: 7px; padding: 3px 5px; }
  .bot-last-action > small { display: none; }
  .bot-last-action { grid-template-areas: "tag action"; }
  .direct-table-layout.workspace-grid { grid-template-columns: minmax(222px, 252px) minmax(500px, 1fr) minmax(222px, 252px); gap: 5px; }
  .face-down-guide { display: none; }
  .supply-name small, .supply-heading small { display: none; }
}

@media (max-width: 1100px) {
  body:has(.game-shell) { overflow: auto; }
  .game-shell { height: auto; min-height: 100dvh; overflow: visible; }
  .integrated-header { grid-template-columns: 1fr; }
  .header-center { grid-template-columns: 1fr; }
  .direct-table-layout.workspace-grid { grid-template-columns: 1fr; height: auto; }
  .board-panel { min-height: 620px; }
}
'''

main_p.write_text(main)
board_p.write_text(board)
css_p.write_text(css)
test_p.write_text(test)
print('v0.8 patch applied')
