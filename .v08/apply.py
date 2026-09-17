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

# --- Exact 2-player logical board: radius-3 central field, 10 locations in symmetric rows.
board = re.sub(
    r"// Two-player layout matched to the physical base-game board\..*?export const ALL_LOCATIONS = \[\.\.\.HUMAN_STARTS, \.\.\.BOT_STARTS, \.\.\.NEUTRAL_LOCATIONS\];",
    """// Two-player base-game layout. The playable area is the 37 light central hexes.\n// The five darker hexes on each far side are four-player-only and are not part of BOARD_HEXES.\n// Axial coordinates are oriented with BOT at the top and HUMAN at the bottom, matching the official 2-player setup diagram.\nexport const BOT_STARTS: HexId[] = [hexId(0, -2), hexId(2, -2)];\nexport const HUMAN_STARTS: HexId[] = [hexId(-2, 2), hexId(0, 2)];\nexport const NEUTRAL_LOCATIONS: HexId[] = [\n  hexId(-1, -1),\n  hexId(1, -1),\n  hexId(3, -1),\n  hexId(-3, 1),\n  hexId(-1, 1),\n  hexId(1, 1),\n];\nexport const ALL_LOCATIONS = [...HUMAN_STARTS, ...BOT_STARTS, ...NEUTRAL_LOCATIONS];""",
    board,
    flags=re.S,
)

# Five dark side hexes, not seven.
main = main.replace(
"""  const offsets = [
    [0, 0], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1],
  ];""",
"""  const offsets = [
    [0, 0], [0, -1], [0, 1], [-1, 0], [1, 0],
  ];"""
)

# Make location spaces unmistakable and increase board token readability.
main = re.sub(
    r"const locationMark = isLocation\n      \? `.*?`\n      : '';",
    """const locationTone = controller === 'human' ? '#236f78' : controller === 'bot' ? '#9d434f' : '#86a55f';
    const locationMark = isLocation
      ? `<g class=\"location-emblem ${controller ? 'controlled' : 'neutral'} ${controller ?? ''}\">
          <circle cx=\"${x}\" cy=\"${y}\" r=\"25\" fill=\"rgba(255,252,239,.92)\" stroke=\"${locationTone}\" stroke-width=\"4.5\"/>
          <circle cx=\"${x}\" cy=\"${y}\" r=\"18\" fill=\"${locationTone}\" opacity=\"${controller ? '.22' : '.13'}\"/>
          <path d=\"M ${x-10} ${y} C ${x-6} ${y-9}, ${x+6} ${y-9}, ${x+10} ${y} C ${x+6} ${y+9}, ${x-6} ${y+9}, ${x-10} ${y} Z\" fill=\"none\" stroke=\"${locationTone}\" stroke-width=\"2.4\"/>
          ${controller ? `<circle cx=\"${x}\" cy=\"${y}\" r=\"6.5\" fill=\"${locationTone}\"/><circle cx=\"${x}\" cy=\"${y}\" r=\"2.2\" fill=\"#fff8e8\"/>` : ''}
        </g>`
      : '';""",
    main,
    count=1,
    flags=re.S,
)
main = main.replace('r="31" fill="rgba(0,0,0,.2)"', 'r="34" fill="rgba(0,0,0,.2)"')
main = main.replace('r="30" fill="${ownerFill}"', 'r="33" fill="${ownerFill}"')
main = main.replace('r="24.5" fill="${d.accent}"', 'r="27" fill="${d.accent}"')
main = main.replace('tokenIconMarkup(unit.type, x, y, 26)', 'tokenIconMarkup(unit.type, x, y, 29)')
main = main.replace('cx="${x + 22}" cy="${y - 21}" r="12"', 'cx="${x + 24}" cy="${y - 23}" r="12.5"')
main = main.replace('x="${x + 22}" y="${y - 17}"', 'x="${x + 24}" y="${y - 19}"')

# Human-readable English mechanics in Unit Card copy, while retaining Korean explanatory grammar.
term_replacements = {
    "전술": "Tactic", "공격": "Attack", "이동": "Move", "기동": "Maneuver",
    "배치": "Deploy", "강화": "Bolster", "점령": "Control", "영입": "Recruit",
    "주도권": "Initiative", "패스": "Pass", "거점": "Location",
}
card_match = re.search(r"const UNIT_CARD_RULES: Record<UnitType, RuleSection\[]> = \{.*?\n\};", main, re.S)
if card_match:
    block = card_match.group(0)
    for ko, en in term_replacements.items():
        block = block.replace(ko, en)
    main = main[:card_match.start()] + block + main[card_match.end():]
main = main.replace('<div class="diagram-caption">전술 / 이동 예시</div>', '<div class="diagram-caption">TACTIC / MOVEMENT EXAMPLE</div>')
main = main.replace("<span class=\"rule-kind\">${section.kind}</span><p>${formatGameText(section.text)}</p>", "<span class=\"rule-kind\">${section.kind}</span><p>${formatGameText(section.text)}</p>")

# Clear English table labels.
main = main.replace("id === 'human' ? 'YOUR TABLE' : `BOT · ${difficultyLabel(difficulty).toUpperCase()}`", "id === 'human' ? 'YOUR TABLE' : `BOT TABLE · ${difficultyLabel(difficulty).toUpperCase()}`")
main = main.replace('<span>/ 6 거점</span>', '<span>/ 6 LOCATIONS</span>')
main = main.replace('<small>카드 Hover로 능력 확인</small>', '<small>Hover a card for Unit rules</small>')
main = main.replace("<span>공급 <b>${supply}</b></span><span>보드 <b>${boardStrength}</b></span><span>제거 <b>${removed}</b></span>", "<span>SUPPLY <b>${supply}</b></span><span>BOARD <b>${boardStrength}</b></span><span>OUT <b>${removed}</b></span>")
main = main.replace("'<span class=\"empty-zone\">비어 있음</span>'", "'<span class=\"empty-zone\">EMPTY</span>'")

# Compact battlefield helper shown below the board, not above it.
main = re.sub(
    r"function renderInteractionHud\(actions: ActionCandidate\[]\): string \{.*?\n\}\n\nfunction axialToPixel",
    """function renderInteractionHud(actions: ActionCandidate[]): string {
  if (!state) return '';
  if (state.winner) return `<div class=\"interaction-hud game-over-hud\">GAME OVER</div>`;
  if (state.activePlayer !== 'human') return `<div class=\"interaction-hud bot-turn-hud\"><strong>BOT TURN</strong><span>Watch <b>BOT LAST MOVE</b> in the header when the action resolves.</span></div>`;
  const coin = selectedHumanCoin();
  const info = coin ? infoForCoin(coin) : null;
  const skip = actions.find((a) => a.kind === 'SKIP_ABILITY');
  const stepCopy = boardPath.length
    ? 'Continue by choosing the highlighted Unit or hex.'
    : 'Select a Coin, then use highlighted Units, Locations and hexes directly.';
  return `<div class=\"interaction-hud compact-hud\">
    <div class=\"selected-coin-hud\">${coin && info ? `<span class=\"table-coin front static\" style=\"--coin-accent:${info.accent}\" data-unit-type=\"${coin}\"><span class=\"table-coin-inner\">${unitIconSvg(coin)}</span></span><div><small>SELECTED COIN</small><strong>${esc(coinLabel(coin))}</strong></div>` : '<div><small>SELECTED COIN</small><strong>NONE</strong></div>'}</div>
    <div class=\"interaction-copy\"><strong>Battlefield input</strong><span>${stepCopy}</span><div class=\"interaction-legend\">${gameTerm('Deploy')} · ${gameTerm('Maneuver')} · ${gameTerm('Bolster')} · ${gameTerm('Tactic')} · ${gameTerm('Control')}</div></div>
    <div class=\"face-down-guide\"><span>Supply → ${gameTerm('Recruit')}</span><span>Initiative → ${gameTerm('Claim Initiative')}</span><span>Discard → ${gameTerm('Pass')}</span></div>
    <div class=\"interaction-hud-actions\">${boardPath.length ? '<button type=\"button\" id=\"cancelBoardPath\" class=\"micro-action\">Cancel</button>' : ''}${skip ? '<button type=\"button\" id=\"skipAbilityBtn\" class=\"micro-action\">Skip Ability</button>' : ''}</div>
  </div>`;
}

function axialToPixel""",
    main,
    count=1,
    flags=re.S,
)

# Header carries Round / Turn / Initiative / difficulty / utility toggles and latest bot action.
insert_before = "function renderUtilityDrawer(): string {"
if insert_before in main and "function renderGameHeader" not in main:
    helper = r'''function renderGameHeader(): string {
  if (!state) return '';
  const active = state.activePlayer === 'human' ? 'YOUR TURN' : 'BOT TURN';
  const initiative = state.initiative === 'human' ? 'YOU' : 'BOT';
  const last = lastBotThought
    ? `<div class="bot-last-move"><span>BOT LAST MOVE</span><strong>${formatGameText(lastBotThought.label)}</strong><small>${formatGameText(lastBotThought.reason)}</small></div>`
    : `<div class="bot-last-move muted"><span>BOT LAST MOVE</span><strong>Waiting for first move</strong></div>`;
  return `<header class="topbar compact game-header">
    <div class="brand-block"><div class="eyebrow">WAR CHEST · SOLO</div><h1>War Chest Solo</h1></div>
    <div class="header-state"><span><b>ROUND ${state.round}</b></span><span class="turn-pill ${state.activePlayer}">${active}</span><button type="button" class="initiative-button ${state.initiative === 'human' ? 'owned' : ''}" id="initiativeAction"><small>INITIATIVE</small><b>${initiative}</b></button><span class="difficulty-chip">BOT ${difficultyLabel(difficulty).toUpperCase()}</span></div>
    ${last}
    <div class="header-tools"><div class="utility-toolbar"><button type="button" class="utility-toggle ${utilityPanel === 'analysis' ? 'active' : ''}" data-utility="analysis">Analysis</button><button type="button" class="utility-toggle ${utilityPanel === 'bot' ? 'active' : ''}" data-utility="bot">Bot</button><button type="button" class="utility-toggle ${utilityPanel === 'log' ? 'active' : ''}" data-utility="log">Log</button></div><button id="undoBtn" class="ghost" ${undoStack.length && !botBusy ? '' : 'disabled'}>↶ Undo</button><button id="rulesBtn" class="ghost">Rules</button><button id="restartBtn" class="ghost danger">Restart</button></div>
  </header>`;
}

'''
    main = main.replace(insert_before, helper + insert_before)

# Replace whole game renderer: no status bar, BOT left / board center / YOU right, input below map.
main = re.sub(
    r"function renderGame\(\): void \{.*?\n\}\n\n\nfunction sleep",
    r'''function renderGame(): void {
  if (!state) return;
  const actions = state.activePlayer === 'human' && !state.winner ? humanCandidates() : [];
  const sanity = stateSanity(state);
  app.innerHTML = `<main class="game-shell">
    ${renderGameHeader()}
    ${sanity.length ? `<div class="debug-warning">STATE CHECK: ${esc(sanity.join(' / '))}</div>` : ''}
    <section class="workspace-grid">
      <aside class="left-rail player-rail">${renderPlayerPanel('bot')}</aside>
      <section class="board-stage"><div class="board-panel"><div id="boardHost">${renderBoardSvg(actions)}</div>${renderInteractionHud(actions)}</div></section>
      <aside class="right-rail player-rail">${renderPlayerPanel('human')}</aside>
    </section>
    ${renderUtilityDrawer()}
    <dialog id="rulesDialog" class="rules-dialog"><form method="dialog"><button class="dialog-close">×</button></form><div class="eyebrow">QUICK RULES</div><h2>War Chest</h2><ul><li><b>Deploy:</b> place the selected Unit Coin on an empty <b>Location you control</b>. Scout is the exception.</li><li><b>Bolster:</b> add the matching Coin to that Unit stack.</li><li><b>Face-down:</b> Claim Initiative, Recruit, or Pass.</li><li><b>Face-up:</b> Maneuver — Move, Attack, Control, or Tactic.</li><li><b>Win:</b> place all 6 Control Markers on Locations.</li></ul></dialog>
    <div id="unitTooltip" class="unit-tooltip" hidden></div>
  </main>`;

  document.querySelector('#restartBtn')?.addEventListener('click', () => { if (confirm('Restart this game?')) newGameSetup(); });
  document.querySelector('#againBtn')?.addEventListener('click', newGameSetup);
  document.querySelector('#undoBtn')?.addEventListener('click', undoLastHumanTurn);
  document.querySelector('#rulesBtn')?.addEventListener('click', () => document.querySelector<HTMLDialogElement>('#rulesDialog')?.showModal());
  document.querySelectorAll<HTMLButtonElement>('[data-hand-index]').forEach((btn) => btn.addEventListener('click', () => { selectedCoinIndex = Number(btn.dataset.handIndex ?? 0); boardPath = []; previewHexes.clear(); renderGame(); }));
  document.querySelectorAll<HTMLButtonElement>('.utility-toggle').forEach((btn) => btn.addEventListener('click', () => {
    const next = btn.dataset.utility as 'analysis' | 'bot' | 'log';
    utilityPanel = utilityPanel === next ? null : next;
    renderGame();
  }));
  document.querySelector('#utilityClose')?.addEventListener('click', () => { utilityPanel = null; renderGame(); });
  document.querySelector('#cancelBoardPath')?.addEventListener('click', () => { boardPath = []; previewHexes.clear(); renderGame(); });

  const actionMap = new Map(actions.map((a) => [a.id, a]));
  document.querySelectorAll<HTMLElement>('[data-board-key]').forEach((el) => el.addEventListener('click', (evt) => {
    evt.stopPropagation();
    handleBoardKey(el.dataset.boardKey ?? '', actions);
  }));
  document.querySelectorAll<HTMLElement>('[data-recruit-type]').forEach((el) => el.addEventListener('click', () => {
    const action = actions.find((a) => a.kind === 'RECRUIT' && a.payload.recruitType === el.dataset.recruitType);
    if (action) executeHumanAction(action);
  }));
  document.querySelector('#initiativeAction')?.addEventListener('click', () => {
    const action = actions.find((a) => a.kind === 'CLAIM_INITIATIVE');
    if (action) executeHumanAction(action);
  });
  document.querySelector('[data-pass-zone]')?.addEventListener('click', () => {
    const action = actions.find((a) => a.kind === 'PASS');
    if (action) executeHumanAction(action);
  });
  document.querySelector('#skipAbilityBtn')?.addEventListener('click', () => {
    const action = actions.find((a) => a.kind === 'SKIP_ABILITY');
    if (action) executeHumanAction(action);
  });
  bindUnitInfoInteractions();
}


function sleep''',
    main,
    count=1,
    flags=re.S,
)

# Supply and discard act as face-down action targets when legal.
main = main.replace('return `<article class="supply-card"', 'return `<article class="supply-card ${owner === \'human\' && state?.activePlayer === \'human\' && state?.players.human.supply[type] ? \'face-down-target\' : \'\'}" data-recruit-type="${owner === \'human\' ? type : \'\'}"')
main = main.replace('<div class="resource-zone discard-zone">', '<div class="resource-zone discard-zone" ${id === \'human\' ? \'data-pass-zone="true"\' : \'\'}>')

# Official deploy rule regression test.
if "deploy destinations are controlled locations" not in test:
    test += r'''

test('deploy destinations are controlled locations', () => {
  const state = createGame(['SWORDSMAN','PIKEMAN','CROSSBOWMAN','LIGHT_CAVALRY'], ['ARCHER','CAVALRY','LANCER','SCOUT'], 'human');
  const idx = state.players.human.hand.findIndex((c) => c !== 'ROYAL');
  if (idx < 0) return;
  const coin = state.players.human.hand[idx];
  const actions = generateActionsForCoin(state, 'human', coin, 'HAND', idx).filter((a) => a.kind === 'DEPLOY');
  for (const action of actions) {
    assert.equal(state.locations[action.payload.destination], 'human');
  }
});
'''

# Pretendard + dense, unclipped game table + legible mechanics.
if "/* v0.8 official board + visual polish */" not in css:
    css = "@import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css');\n" + css + r'''

/* v0.8 official board + visual polish */
:root { --ui-font: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
html, body, button, input, select, textarea { font-family: var(--ui-font); }
body { font-family: var(--ui-font); }
.game-shell { grid-template-rows: auto minmax(0,1fr); padding: 6px 8px 8px; gap: 6px; }
.game-header {
  display: grid;
  grid-template-columns: auto minmax(310px,.8fr) minmax(260px,1.05fr) auto;
  gap: 10px;
  min-height: 54px;
  padding: 6px 10px;
  border-radius: 14px;
  background: rgba(247,238,219,.96);
  box-shadow: 0 5px 18px rgba(28,20,13,.12);
}
.brand-block h1 { font-size: 21px !important; white-space: nowrap; }
.header-state { display:flex; align-items:center; gap:5px; min-width:0; flex-wrap:wrap; }
.header-state > span, .initiative-button { min-height:30px; border-radius:999px; padding:5px 9px; border:1px solid rgba(91,67,39,.14); background:rgba(255,255,255,.55); color:#493b2a; font-size:10px; font-weight:800; }
.initiative-button { display:flex; align-items:center; gap:5px; cursor:pointer; }
.initiative-button small { font-size:8px; letter-spacing:.08em; }
.initiative-button.owned { border-color:#c89c43; box-shadow:0 0 0 2px rgba(220,177,78,.16); }
.bot-last-move { min-width:0; display:grid; grid-template-columns:auto minmax(0,1fr); gap:2px 7px; align-content:center; padding:5px 9px; border-left:3px solid var(--bot); background:rgba(151,67,78,.07); border-radius:8px; }
.bot-last-move > span { grid-row:1 / 3; align-self:center; font-size:8px; letter-spacing:.1em; font-weight:900; color:#8d4650; }
.bot-last-move strong { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; font-size:11px; color:#3d3026; }
.bot-last-move small { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; font-size:9px; color:#756452; }
.header-tools { display:flex; align-items:center; justify-content:flex-end; gap:5px; flex-wrap:wrap; }
.header-tools .ghost { padding:6px 8px; font-size:10px; }
.utility-toolbar { margin-left:0; }
.workspace-grid { grid-template-columns:minmax(230px,270px) minmax(560px,1fr) minmax(230px,270px); gap:7px; min-height:0; }
.left-rail, .right-rail { min-height:0; }
.board-stage, .board-panel { min-height:0; height:100%; }
.board-panel { padding:0; border-radius:14px; overflow:hidden; display:flex; flex-direction:column; }
#boardHost { flex:1 1 auto; min-height:0; display:flex; align-items:stretch; justify-content:center; overflow:hidden; }
.battlefield { width:100%; height:100%; min-height:0; display:block; }
.interaction-hud.compact-hud { flex:0 0 auto; min-height:66px; margin:0; border-radius:0; padding:6px 9px; grid-template-columns:auto minmax(0,1fr) auto auto; gap:8px; border-top:1px solid rgba(101,76,45,.18); background:rgba(247,238,219,.98); }
.interaction-hud .interaction-copy strong { font-size:11px; }
.interaction-hud .interaction-copy > span, .face-down-guide span { font-size:9px; line-height:1.25; }
.face-down-guide { min-width:190px; gap:2px; }
.tabletop-player { padding:7px; gap:5px; }
.tabletop-heading h2 { font-size:15px; }
.resource-label span, .supply-heading span { font-size:8px; }
.supply-grid { grid-auto-rows:minmax(60px,1fr); gap:4px; }
.supply-card { min-height:0; overflow:hidden; }
.supply-name strong { font-size:10px; }
.supply-name small { font-size:7px; }
.table-coin { width:34px; height:34px; }
.supply-mini-coin { width:22px; height:22px; }
.face-down-target { cursor:pointer; }
.face-down-target:hover { outline:2px solid #7153a3; outline-offset:-2px; box-shadow:0 0 0 4px rgba(113,83,163,.12); }
.discard-zone[data-pass-zone='true'] { cursor:pointer; }
.discard-zone[data-pass-zone='true']:hover { box-shadow:inset 0 0 0 2px #8b6a4f; }
.location-emblem { filter:drop-shadow(0 2px 2px rgba(54,42,26,.18)); }
.location-emblem.controlled { filter:drop-shadow(0 0 5px rgba(255,255,255,.8)) drop-shadow(0 2px 2px rgba(54,42,26,.18)); }
.hex-cell.actionable > polygon { cursor:pointer; }
.unit-token.actionable { cursor:pointer; }
.game-term { font-weight:900; padding:0 2px; border-radius:4px; }
.term-attack { color:#b63e48; background:rgba(182,62,72,.08); }
.term-move, .term-maneuver { color:#247887; background:rgba(36,120,135,.08); }
.term-deploy, .term-bolster { color:#6b7d2f; background:rgba(107,125,47,.09); }
.term-tactic { color:#7a50a0; background:rgba(122,80,160,.08); }
.term-control, .term-location { color:#9a7424; background:rgba(154,116,36,.1); }
.term-recruit { color:#9d5e22; background:rgba(157,94,34,.09); }
.term-initiative, .term-claim-initiative { color:#35549b; background:rgba(53,84,155,.08); }
.term-pass { color:#66584c; background:rgba(102,88,76,.08); }
.rule-section p { font-size:12px; line-height:1.42; overflow-wrap:anywhere; }
.rule-kind { min-width:62px; }
.diagram-caption { letter-spacing:.06em; }
.debug-warning { position:absolute; z-index:50; top:62px; left:50%; transform:translateX(-50%); }
@media (max-height: 760px) and (min-width: 1180px) {
  .game-shell { padding:4px 6px 6px; gap:4px; }
  .game-header { min-height:48px; padding:4px 8px; }
  .brand-block .eyebrow { display:none; }
  .brand-block h1 { font-size:18px !important; }
  .bot-last-move small { display:none; }
  .interaction-hud.compact-hud { min-height:58px; padding:4px 7px; }
  .tabletop-player { padding:5px; gap:4px; }
  .supply-grid { grid-auto-rows:56px; }
  .table-coin { width:30px; height:30px; }
}
@media (max-width: 1320px) and (min-width: 1101px) {
  .game-header { grid-template-columns:auto minmax(270px,.8fr) minmax(180px,.9fr) auto; gap:6px; }
  .workspace-grid { grid-template-columns:minmax(205px,235px) minmax(520px,1fr) minmax(205px,235px); gap:5px; }
  .bot-last-move small { display:none; }
  .header-tools .ghost { padding:5px 6px; }
}
'''

main_p.write_text(main)
board_p.write_text(board)
css_p.write_text(css)
test_p.write_text(test)
print('v0.8 patch applied')
