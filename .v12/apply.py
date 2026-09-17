from pathlib import Path
import re

root = Path('.')
engine = root / 'src/engine.ts'
main = root / 'src/main.ts'
css = root / 'styles.css'
test = root / 'test/engine.test.mjs'

# ---------- engine: unique unit IDs + one-coin damage/log correctness ----------
e = engine.read_text()
anchor = "let unitSequence = 1;\nlet actionSequence = 1;\n"
insert = """let unitSequence = 1;
let actionSequence = 1;

export function normalizeUnitIds(state: GameState): void {
  const seen = new Set<string>();
  let next = 1;
  for (const unit of state.boardUnits) {
    const match = /^u(\\d+)$/.exec(unit.id);
    if (match) next = Math.max(next, Number(match[1]) + 1);
  }
  for (const unit of state.boardUnits) {
    if (!unit.id || seen.has(unit.id)) {
      let replacement = `u${next++}`;
      while (seen.has(replacement)) replacement = `u${next++}`;
      unit.id = replacement;
    }
    seen.add(unit.id);
  }
  unitSequence = Math.max(unitSequence, next);
}

function nextUnitId(state: GameState): string {
  let id = `u${unitSequence++}`;
  while (state.boardUnits.some((unit) => unit.id === id)) id = `u${unitSequence++}`;
  return id;
}
"""
if anchor not in e:
    raise SystemExit('engine sequence anchor missing')
e = e.replace(anchor, insert, 1)

e = e.replace("state.boardUnits.push({ id: `u${unitSequence++}`, owner: playerId, type, hex: destination, strength: 1 });",
              "state.boardUnits.push({ id: nextUnitId(state), owner: playerId, type, hex: destination, strength: 1 });", 1)

old_remove = """function removeBoardCoin(state: GameState, unit: BoardUnit): void {
  unit.strength -= 1;
  state.players[unit.owner].removed.push(unit.type);
  if (unit.strength <= 0) {
    state.boardUnits = state.boardUnits.filter((u) => u.id !== unit.id);
    addLog(state, `${UNIT_DEFS[unit.type].ko} 유닛이 제거되었습니다.`);
  }
}
"""
new_remove = """function removeBoardCoin(state: GameState, unit: BoardUnit): void {
  // Every Attack removes exactly one coin. Bolster increases durability, not damage.
  unit.strength -= 1;
  state.players[unit.owner].removed.push(unit.type);
  if (unit.strength <= 0) {
    state.boardUnits = state.boardUnits.filter((u) => u.id !== unit.id);
    addLog(state, `${unit.owner === 'human' ? '당신' : '봇'}의 ${UNIT_DEFS[unit.type].ko} 유닛이 Removed되었습니다.`);
  }
}
"""
if old_remove not in e:
    raise SystemExit('removeBoardCoin anchor missing')
e = e.replace(old_remove, new_remove, 1)

old_attack = """function applyAttack(state: GameState, attacker: BoardUnit, target: BoardUnit, adjacentAttack: boolean): void {
  const attackerName = UNIT_DEFS[attacker.type].ko;
  const targetName = UNIT_DEFS[target.type].ko;
  addLog(state, `${attacker.owner === 'human' ? '당신' : '봇'}의 ${attackerName}이(가) ${targetName}을(를) 공격했습니다.`);

  if (royalGuardAbsorbsFromSupply(state, target)) {
    const p = state.players[target.owner];
    p.supply.ROYAL_GUARD = (p.supply.ROYAL_GUARD ?? 0) - 1;
    p.removed.push('ROYAL_GUARD');
    addLog(state, `근위병이 Supply 코인으로 공격을 흡수했습니다.`);
  } else {
    removeBoardCoin(state, target);
  }

  if (target.type === 'PIKEMAN' && adjacentAttack) {
    const liveAttacker = getUnit(state, attacker.id);
    if (liveAttacker) {
      addLog(state, `장창병의 반격으로 ${attackerName}도 코인 1개를 잃습니다.`);
      removeBoardCoin(state, liveAttacker);
    }
  }
}
"""
new_attack = """function applyAttack(state: GameState, attacker: BoardUnit, target: BoardUnit, adjacentAttack: boolean): void {
  // Capture identities before any coin removal. A destroyed target no longer exists on board afterwards.
  const attackerName = UNIT_DEFS[attacker.type].ko;
  const targetName = UNIT_DEFS[target.type].ko;
  const targetType = target.type;

  if (royalGuardAbsorbsFromSupply(state, target)) {
    const p = state.players[target.owner];
    p.supply.ROYAL_GUARD = (p.supply.ROYAL_GUARD ?? 0) - 1;
    p.removed.push('ROYAL_GUARD');
    addLog(state, `근위병이 Supply 코인으로 Attack을 흡수했습니다.`);
  } else {
    removeBoardCoin(state, target);
  }

  if (targetType === 'PIKEMAN' && adjacentAttack) {
    const liveAttacker = getUnit(state, attacker.id);
    if (liveAttacker) {
      addLog(state, `장창병의 반격으로 ${attackerName}도 코인 1개를 잃습니다.`);
      removeBoardCoin(state, liveAttacker);
    }
  }

  // Added last so the reverse-chronological UI presents the Attack before its damage/removal detail.
  addLog(state, `${attacker.owner === 'human' ? '당신' : '봇'}의 ${attackerName}이(가) ${targetName}을(를) Attack했습니다.`);
}
"""
if old_attack not in e:
    raise SystemExit('applyAttack anchor missing')
e = e.replace(old_attack, new_attack, 1)
engine.write_text(e)

# ---------- main: saved-game migration, per-action playback, in-board action chips ----------
m = main.read_text()
m = m.replace("  generatePendingActions,\n  stateSanity,", "  generatePendingActions,\n  normalizeUnitIds,\n  stateSanity,", 1)

var_anchor = "let utilityPanel: 'analysis' | 'bot' | 'log' | null = null;\nlet boardPath: string[] = [];\n"
var_insert = """let utilityPanel: 'analysis' | 'bot' | 'log' | null = null;
let boardPath: string[] = [];

type ActionAnimation = {
  player: PlayerId;
  kind: ActionCandidate['kind'];
  label: string;
  unitId?: string;
  unitType?: UnitType;
  fromHex?: HexId;
  toHex?: HexId;
  targetHex?: HexId;
  targetType?: UnitType;
};
let actionAnimation: ActionAnimation | null = null;
let actionAnimating = false;
"""
if var_anchor not in m:
    raise SystemExit('main vars anchor missing')
m = m.replace(var_anchor, var_insert, 1)

load_old = """    const parsed = JSON.parse(raw) as GameState;
    if (!parsed.players?.human || !parsed.players?.bot || !parsed.locations) return null;
    return parsed;
"""
load_new = """    const parsed = JSON.parse(raw) as GameState;
    if (!parsed.players?.human || !parsed.players?.bot || !parsed.locations) return null;
    // Older saved games could reuse u1/u2 after a page reload because the in-memory sequence reset.
    // Repair those IDs before any new Action is generated, then persist the migrated save.
    normalizeUnitIds(parsed);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    return parsed;
"""
if load_old not in m:
    raise SystemExit('loadSavedState anchor missing')
m = m.replace(load_old, load_new, 1)

# Human candidates are disabled during playback so another action cannot be queued into a half-resolved animation.
m = m.replace("if (!state || state.activePlayer !== 'human' || state.winner) return [];",
              "if (!state || actionAnimating || state.activePlayer !== 'human' || state.winner) return [];", 1)

exec_pattern = re.compile(r"function executeHumanAction\(action: ActionCandidate\): void \{.*?\n\}\n\nfunction handleBoardKey", re.S)
exec_repl = """function describeActionAnimation(before: GameState, action: ActionCandidate): ActionAnimation {
  const actingId = (action.kind === 'TACTIC_ENSIGN' || action.kind === 'TACTIC_MARSHALL')
    ? action.payload.grantedUnitId
    : action.payload.unitId;
  const actor = actingId ? before.boardUnits.find((unit) => unit.id === actingId) : undefined;
  const target = action.payload.targetUnitId ? before.boardUnits.find((unit) => unit.id === action.payload.targetUnitId) : undefined;
  return {
    player: action.player,
    kind: action.kind,
    label: action.label,
    unitId: actor?.id,
    unitType: actor?.type ?? action.payload.unitType,
    fromHex: actor?.hex,
    toHex: action.payload.destination,
    targetHex: target?.hex,
    targetType: target?.type,
  };
}

async function executeHumanAction(action: ActionCandidate): Promise<void> {
  if (!state || actionAnimating) return;
  previewHexes.clear();
  const before = cloneState(state);
  try {
    if (action.source === 'HAND') undoStack.push(before);
    actionAnimation = describeActionAnimation(before, action);
    actionAnimating = true;
    executeAction(state, action);
    selectedCoinIndex = 0;
    boardPath = [];
    saveState();
    renderGame();
    await sleep(960);
    actionAnimation = null;
    actionAnimating = false;
    afterResolvedAction(state);
    saveState();
    render();
  } catch (error) {
    actionAnimation = null;
    actionAnimating = false;
    console.error(error);
    alert(`Action error: ${error instanceof Error ? error.message : String(error)}`);
    render();
  }
}

function handleBoardKey"""
m, count = exec_pattern.subn(exec_repl, m, count=1)
if count != 1:
    raise SystemExit('executeHumanAction block patch failed')

# Make board-key completion explicitly fire async action.
m = m.replace("    executeHumanAction(complete.action);\n    return;", "    void executeHumanAction(complete.action);\n    return;", 1)

# Remove the below-board duplicate action controls; chips return to the selected Unit itself.
m = m.replace("<div class=\"interaction-legend\">${gameTerm('Deploy')} · ${gameTerm('Maneuver')} · ${gameTerm('Bolster')} · ${gameTerm('Tactic')} · ${gameTerm('Control')}</div>${renderContextBoardActions(actions)}",
              "<div class=\"interaction-legend\">${gameTerm('Deploy')} · ${gameTerm('Maneuver')} · ${gameTerm('Bolster')} · ${gameTerm('Tactic')} · ${gameTerm('Control')}</div>", 1)
m = m.replace("if (state.activePlayer !== 'human') return `<div class=\"interaction-hud bot-turn-hud\"><strong>BOT TURN</strong><span>Watch <b>BOT LAST MOVE</b> in the header when the action resolves.</span></div>`;",
              "if (state.activePlayer !== 'human') return `<div class=\"interaction-hud bot-turn-hud\"><strong>BOT TURN</strong><span>${actionAnimating ? 'Resolving the highlighted action…' : 'The bot is choosing an action…'}</span></div>`;", 1)

# Add animation rendering helpers immediately after hexPoints.
hex_anchor = """function fourPlayerWing(side: 'left' | 'right'): string {
"""
anim_helpers = r'''function renderActionPlaybackSvg(): string {
  if (!actionAnimation) return '';
  const a = actionAnimation;
  const ownerColor = a.player === 'human' ? '#2f7f87' : '#a14e59';
  const pieces: string[] = [];
  if (a.fromHex && a.toHex && a.fromHex !== a.toHex) {
    const from = axialToPixel(a.fromHex);
    const to = axialToPixel(a.toHex);
    pieces.push(`<path class="action-motion-path" d="M ${from.x} ${from.y} L ${to.x} ${to.y}"/>`);
    if (a.unitType) {
      pieces.push(`<g class="action-moving-token" style="color:${UNIT_DEFS[a.unitType].accent}" transform="translate(${from.x} ${from.y})">
        <circle cx="0" cy="0" r="32" fill="${ownerColor}" stroke="#fff1c9" stroke-width="3"/>
        <circle cx="0" cy="0" r="26" fill="${UNIT_DEFS[a.unitType].accent}" stroke="rgba(255,255,255,.6)" stroke-width="1.5"/>
        <g transform="translate(-15 -15) scale(1.25)">${unitIconPaths(a.unitType)}</g>
        <animateTransform attributeName="transform" type="translate" from="${from.x} ${from.y}" to="${to.x} ${to.y}" dur="0.9s" fill="freeze"/>
      </g>`);
    }
  }
  if (a.targetHex) {
    const target = axialToPixel(a.targetHex);
    pieces.push(`<circle class="action-target-pulse" cx="${target.x}" cy="${target.y}" r="39"/>`);
    if (a.fromHex) {
      const from = axialToPixel(a.fromHex);
      pieces.push(`<path class="action-strike" d="M ${from.x} ${from.y} L ${target.x} ${target.y}"/>`);
    }
  }
  if (!a.targetHex && a.toHex && (!a.fromHex || a.fromHex === a.toHex)) {
    const point = axialToPixel(a.toHex);
    pieces.push(`<circle class="action-target-pulse ${a.kind === 'BOLSTER' ? 'bolster' : ''}" cx="${point.x}" cy="${point.y}" r="39"/>`);
  }
  if (a.kind === 'BOLSTER' && a.fromHex) {
    const point = axialToPixel(a.fromHex);
    pieces.push(`<text class="action-plus-one" x="${point.x + 30}" y="${point.y - 31}">+1</text>`);
  }
  return pieces.length ? `<g class="action-animation-layer" pointer-events="none">${pieces.join('')}</g>` : '';
}

function renderActionPlaybackToast(): string {
  if (!actionAnimation) return '';
  return `<div class="action-playback-toast ${actionAnimation.player}"><span>${actionAnimation.player === 'human' ? 'YOU' : 'BOT'}</span><strong>${formatGameText(actionAnimation.label)}</strong></div>`;
}

function fourPlayerWing(side: 'left' | 'right'): string {
'''
if hex_anchor not in m:
    raise SystemExit('fourPlayerWing anchor missing')
m = m.replace(hex_anchor, anim_helpers, 1)

# Board gets an action-chip layer attached to selected own Unit.
m = m.replace("  const stackBadgeLayer: string[] = [];\n", "  const stackBadgeLayer: string[] = [];\n  const actionChipLayer: string[] = [];\n", 1)

unit_push_anchor = """      if (unit.strength > 1) {
        stackBadgeLayer.push(`<g class=\"stack-badge\" data-stack-badge=\"${unit.id}\" pointer-events=\"none\"><circle cx=\"${x + 23}\" cy=\"${y - 22}\" r=\"12.5\" fill=\"#fff5db\" stroke=\"#453722\" stroke-width=\"1.8\"/><text x=\"${x + 23}\" y=\"${y - 18}\" text-anchor=\"middle\" class=\"stack-count\">${unit.strength}</text></g>`);
      }
"""
unit_push_repl = unit_push_anchor + """      if (unit.owner === 'human' && ui.selectedKeys.has(unitKey)) {
        const choices = [
          ['special:BOLSTER', 'BOLSTER', 'bolster'],
          ['special:TACTIC', 'TACTIC', 'tactic'],
          ['special:CONTROL', 'CONTROL', 'control'],
        ] as const;
        const available = choices.filter(([key]) => ui.nextKeys.has(key));
        if (available.length) {
          const width = 62;
          const gap = 5;
          const total = available.length * width + (available.length - 1) * gap;
          const startX = x - total / 2;
          const chipY = y - 58;
          actionChipLayer.push(`<g class=\"unit-action-popover\" data-action-for=\"${unit.id}\"><line x1=\"${x}\" y1=\"${y - 33}\" x2=\"${x}\" y2=\"${chipY + 19}\"/>${available.map(([key, label, cls], index) => `<g class=\"board-action-chip ${cls}\" data-board-key=\"${key}\" role=\"button\"><rect x=\"${startX + index * (width + gap)}\" y=\"${chipY}\" width=\"${width}\" height=\"22\" rx=\"11\"/><text x=\"${startX + index * (width + gap) + width / 2}\" y=\"${chipY + 14.5}\" text-anchor=\"middle\">${label}</text></g>`).join('')}</g>`);
        }
      }
"""
if unit_push_anchor not in m:
    raise SystemExit('unit strength anchor missing')
m = m.replace(unit_push_anchor, unit_push_repl, 1)

m = m.replace("    <g class=\"stack-badge-layer\">${stackBadgeLayer.join('')}</g>\n  </svg>`;",
              "    <g class=\"stack-badge-layer\">${stackBadgeLayer.join('')}</g>\n    <g class=\"action-chip-layer\">${actionChipLayer.join('')}</g>\n    ${renderActionPlaybackSvg()}\n  </svg>`;", 1)

# Hide the destination token while its ghost is visibly travelling there.
m = m.replace("unitLayer.push(`<g class=\"token unit-token ${unitCls}\"${unitAttr}",
              "unitLayer.push(`<g class=\"token unit-token ${unitCls} ${actionAnimating && actionAnimation?.unitId === unit.id && actionAnimation.fromHex && actionAnimation.toHex && actionAnimation.fromHex !== actionAnimation.toHex ? 'animation-hidden' : ''}\"${unitAttr}", 1)

# Header: remove the persistent BOT LAST ACTION emphasis. Bot Explain remains available via toolbar.
m = m.replace("${renderHeaderControls(actions)}${renderBotLastAction()}", "${renderHeaderControls(actions)}", 1)

# Add the transient action toast to the board itself.
m = m.replace("<div id=\"boardHost\">${renderBoardSvg(actions)}</div>${renderInteractionHud(actions)}",
              "<div id=\"boardHost\">${renderBoardSvg(actions)}</div>${renderActionPlaybackToast()}${renderInteractionHud(actions)}", 1)

# All direct action triggers call the async playback path safely.
m = m.replace("if (action) executeHumanAction(action);", "if (action) void executeHumanAction(action);")

# Bot execution: each action gets the same ~1 second visual playback before turn/state advances.
bot_old = """      rememberBotDecision(decision);
      executeAction(state, decision.action);
      afterResolvedAction(state);
      saveState();
      renderGame();
"""
bot_new = """      rememberBotDecision(decision);
      const before = cloneState(state);
      actionAnimation = describeActionAnimation(before, decision.action);
      actionAnimating = true;
      executeAction(state, decision.action);
      saveState();
      renderGame();
      await sleep(960);
      actionAnimation = null;
      actionAnimating = false;
      afterResolvedAction(state);
      saveState();
      renderGame();
"""
if bot_old not in m:
    raise SystemExit('bot execution anchor missing')
m = m.replace(bot_old, bot_new, 1)

# Ensure animation flags clear at game/session resets and error finalization.
m = m.replace("  botThoughtHistory = [];\n}", "  botThoughtHistory = [];\n  actionAnimation = null;\n  actionAnimating = false;\n}", 1)
m = m.replace("  } finally {\n    botBusy = false;\n    render();\n  }",
              "  } finally {\n    actionAnimation = null;\n    actionAnimating = false;\n    botBusy = false;\n    render();\n  }", 1)
main.write_text(m)

# ---------- CSS: on-unit chips, playback animation, mobile board-first layout ----------
c = css.read_text()
c += r'''

/* v0.12 combat playback + selected-unit actions + mobile table layout */
.board-panel { position: relative; }
.unit-token.animation-hidden { opacity: 0; }
.action-chip-layer { pointer-events: none; }
.unit-action-popover { pointer-events: none; filter: drop-shadow(0 4px 8px rgba(39,27,17,.24)); }
.unit-action-popover > line { stroke: rgba(255,247,222,.82); stroke-width: 2; stroke-linecap: round; pointer-events: none; }
.unit-action-popover .board-action-chip,
.unit-action-popover .board-action-chip * { pointer-events: all; cursor: pointer !important; }
.unit-action-popover .board-action-chip rect { stroke-width: 1.5; }
.unit-action-popover .board-action-chip text { font-size: 8px; letter-spacing: .03em; }

.action-animation-layer { pointer-events: none; }
.action-motion-path {
  fill: none;
  stroke: rgba(255,246,211,.65);
  stroke-width: 5;
  stroke-linecap: round;
  stroke-dasharray: 9 9;
  animation: actionTrail .9s linear both;
}
.action-moving-token { filter: drop-shadow(0 8px 8px rgba(0,0,0,.28)); }
.action-target-pulse {
  fill: none;
  stroke: #d55a60;
  stroke-width: 6;
  transform-box: fill-box;
  transform-origin: center;
  animation: targetPulse .9s ease-out both;
}
.action-target-pulse.bolster { stroke: #659150; }
.action-strike {
  fill: none;
  stroke: #d95b60;
  stroke-width: 7;
  stroke-linecap: round;
  stroke-dasharray: 1 220;
  animation: strikeDraw .72s ease-out both;
}
.action-plus-one {
  fill: #fff2b8;
  stroke: #4b3920;
  stroke-width: 2px;
  paint-order: stroke;
  font-size: 19px;
  font-weight: 950;
  animation: plusPop .9s ease-out both;
}
.action-playback-toast {
  position: absolute;
  left: 50%;
  top: 12px;
  z-index: 30;
  transform: translateX(-50%);
  min-width: min(420px, 70%);
  max-width: 78%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(34,27,20,.9);
  border: 1px solid rgba(255,237,194,.34);
  color: #fff2d7;
  box-shadow: 0 10px 24px rgba(0,0,0,.25);
  pointer-events: none;
  animation: actionToast .96s ease both;
}
.action-playback-toast > span {
  flex: 0 0 auto;
  padding: 3px 7px;
  border-radius: 999px;
  font-size: 9px;
  font-weight: 950;
  letter-spacing: .08em;
  background: rgba(47,127,135,.28);
}
.action-playback-toast.bot > span { background: rgba(161,78,89,.32); }
.action-playback-toast strong { min-width: 0; font-size: 11px; line-height: 1.25; }

.header-center { grid-template-columns: minmax(0, 1fr) !important; }

@keyframes actionTrail { from { opacity: 0; stroke-dashoffset: 40; } 20% { opacity: 1; } to { opacity: .15; stroke-dashoffset: 0; } }
@keyframes targetPulse { 0% { opacity: 0; transform: scale(.55); } 28% { opacity: 1; } 100% { opacity: 0; transform: scale(1.45); } }
@keyframes strikeDraw { 0% { stroke-dasharray: 1 220; opacity: 0; } 20% { opacity: 1; } 70% { stroke-dasharray: 220 1; } 100% { stroke-dasharray: 220 1; opacity: 0; } }
@keyframes plusPop { 0% { opacity: 0; transform: translateY(8px) scale(.6); } 35% { opacity: 1; transform: translateY(-2px) scale(1.15); } 100% { opacity: 0; transform: translateY(-18px) scale(1); } }
@keyframes actionToast { 0% { opacity: 0; transform: translate(-50%, -7px); } 16%, 78% { opacity: 1; transform: translate(-50%, 0); } 100% { opacity: 0; transform: translate(-50%, -3px); } }

@media (prefers-reduced-motion: reduce) {
  .action-motion-path, .action-target-pulse, .action-strike, .action-plus-one, .action-playback-toast { animation-duration: .01ms !important; }
}

@media (max-width: 760px) {
  html, body, #app { min-height: 100%; height: auto; }
  body:has(.game-shell) { overflow-x: hidden !important; overflow-y: auto !important; }
  .game-shell {
    height: auto !important;
    min-height: 100dvh;
    padding: 6px !important;
    display: block !important;
  }
  .integrated-header {
    position: relative;
    display: grid !important;
    grid-template-columns: 1fr auto !important;
    gap: 5px !important;
    margin-bottom: 6px;
  }
  .brand-lockup { display: none; }
  .header-center { min-width: 0; }
  .header-game-meta { overflow-x: auto; scrollbar-width: none; }
  .header-game-meta::-webkit-scrollbar { display: none; }
  .utility-toolbar { display: none; }
  .topbar-actions { justify-content: end; }
  .topbar-actions .ghost { padding: 5px 6px !important; font-size: 8px !important; }

  .direct-table-layout.workspace-grid {
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important;
    grid-template-areas:
      "board board"
      "bot human" !important;
    gap: 6px !important;
    align-items: start;
  }
  .board-stage { grid-area: board; min-width: 0; }
  .bot-side { grid-area: bot; min-width: 0; }
  .human-side { grid-area: human; min-width: 0; }
  .board-panel { height: auto !important; min-height: 0 !important; padding: 5px !important; border-radius: 14px !important; }
  .board-title { display: none !important; }
  #boardHost { min-height: 0 !important; height: auto !important; }
  .battlefield { display: block; width: 100%; height: auto !important; max-height: none !important; }
  .interaction-hud.compact-hud { margin-top: 4px; grid-template-columns: 1fr auto !important; min-height: 0 !important; }
  .selected-coin-hud { min-width: 0; }
  .selected-coin-hud .table-coin { width: 31px; height: 31px; }
  .interaction-copy > span, .interaction-legend, .face-down-guide { display: none !important; }
  .action-playback-toast { top: 7px; min-width: 72%; max-width: 92%; padding: 6px 8px; }

  .player-rail, .tabletop-player { min-width: 0 !important; width: 100% !important; }
  .tabletop-player {
    height: auto !important;
    overflow: visible !important;
    padding: 6px !important;
    border-radius: 14px !important;
  }
  .tabletop-heading { gap: 3px !important; }
  .tabletop-heading h2 { font-size: 13px !important; line-height: 1.05; }
  .tabletop-heading .eyebrow { font-size: 7px !important; }
  .initiative-badge { padding: 2px 4px; font-size: 7px; }
  .control-score strong { font-size: 15px !important; }
  .control-score span { font-size: 7px !important; }
  .marker-track { gap: 2px !important; }
  .control-marker { width: 16px !important; height: 16px !important; font-size: 7px !important; }

  .resource-table,
  .tabletop-player.bot .resource-table,
  .tabletop-player.human .resource-table {
    display: grid !important;
    grid-template-columns: 1fr !important;
    grid-template-areas: "hand" "bag" "discard" !important;
    gap: 4px !important;
  }
  .resource-zone { min-height: 0 !important; padding: 5px !important; }
  .resource-label, .discard-title span { font-size: 7px !important; }
  .coin-fan { min-height: 31px !important; gap: 2px !important; }
  .table-coin, .tabletop-player.bot .table-coin { width: 29px !important; height: 29px !important; }
  .table-coin .unit-icon, .coin-back-icon { width: 15px !important; height: 15px !important; }
  .bag-zone { display: grid; grid-template-columns: auto 1fr; align-items: center; }
  .bag-visual { height: 34px !important; }
  .bag-visual > svg { width: 34px !important; height: 34px !important; }
  .peeking-coin { display: none !important; }
  .discard-zone { grid-template-columns: auto minmax(0,1fr) !important; }
  .discard-counts { display: none !important; }

  .supply-heading { margin-top: 2px !important; }
  .supply-heading small { display: none !important; }
  .supply-grid { gap: 4px !important; }
  .supply-card,
  .tabletop-player.bot .supply-card,
  .tabletop-player.human .supply-card {
    min-height: 48px !important;
    grid-template-columns: minmax(0, 1fr) auto !important;
    gap: 3px !important;
    padding: 5px !important;
  }
  .supply-identity { grid-template-columns: 28px minmax(0,1fr) !important; gap: 5px !important; }
  .supply-icon { width: 28px !important; height: 28px !important; }
  .supply-name strong { font-size: 8.5px !important; white-space: normal !important; }
  .supply-name small { font-size: 6.5px !important; white-space: normal !important; }
  .supply-stack-wrap { min-width: 44px !important; }
  .supply-stack { min-width: 30px !important; height: 27px !important; }
  .supply-mini-coin { width: 23px !important; height: 23px !important; --offset: calc(var(--i) * 5px) !important; }
  .supply-count { font-size: 10px !important; }
  .supply-stats { display: none !important; }
  .supply-action-tag { bottom: -5px !important; font-size: 6.5px !important; }
  .unit-action-popover .board-action-chip text { font-size: 7px; }
}
'''
css.write_text(c)

# ---------- unit regression tests ----------
t = test.read_text()
t = t.replace("  executeAction,\n  unitAt,", "  executeAction,\n  normalizeUnitIds,\n  unitAt,", 1)
t += r'''

test('Bolster is durability only: one Attack removes exactly one defender coin', () => {
  const s = emptyState();
  s.players.human.hand = ['SWORDSMAN'];
  s.boardUnits = [
    { id: 'attacker', owner: 'human', type: 'SWORDSMAN', hex: '0,0', strength: 3 },
    { id: 'target', owner: 'bot', type: 'SCOUT', hex: '1,0', strength: 3 },
  ];
  const action = generateActionsForCoin(s, 'human', 'SWORDSMAN', 'HAND', 0)
    .find((candidate) => candidate.kind === 'ATTACK' && candidate.payload.targetUnitId === 'target');
  assert(action);
  executeAction(s, action);
  assert.equal(unitAt(s, '0,0')?.strength, 3, 'attacker strength does not multiply damage');
  assert.equal(unitAt(s, '1,0')?.strength, 2, 'defender loses one coin, not the whole stack');
  assert.equal(s.players.bot.removed.filter((coin) => coin === 'SCOUT').length, 1);
  assert(s.log.some((line) => line.includes('검병') && line.includes('정찰병') && line.includes('Attack')));
});

test('saved games with duplicate unit IDs are repaired before actions resolve', () => {
  const s = emptyState();
  s.players.human.hand = ['LIGHT_CAVALRY'];
  s.boardUnits = [
    { id: 'u1', owner: 'human', type: 'LIGHT_CAVALRY', hex: '0,0', strength: 2 },
    { id: 'u1', owner: 'bot', type: 'SCOUT', hex: '1,0', strength: 2 },
  ];
  normalizeUnitIds(s);
  assert.equal(new Set(s.boardUnits.map((unit) => unit.id)).size, 2);
  const target = s.boardUnits.find((unit) => unit.owner === 'bot');
  assert(target);
  const action = generateActionsForCoin(s, 'human', 'LIGHT_CAVALRY', 'HAND', 0)
    .find((candidate) => candidate.kind === 'ATTACK' && candidate.payload.targetUnitId === target.id);
  assert(action);
  executeAction(s, action);
  assert.equal(s.boardUnits.find((unit) => unit.owner === 'bot')?.type, 'SCOUT');
  assert.equal(s.boardUnits.find((unit) => unit.owner === 'bot')?.strength, 1);
  assert(s.log.some((line) => line.includes('경기병') && line.includes('정찰병') && line.includes('Attack')));
});
'''
test.write_text(t)

print('v0.12 patch applied')
