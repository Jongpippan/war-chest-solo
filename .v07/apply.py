from pathlib import Path

ROOT = Path('.')
main_path = ROOT / 'src/main.ts'
css_path = ROOT / 'styles.css'
main = main_path.read_text()
css = css_path.read_text()


def replace_between(text: str, start: str, end: str, replacement: str) -> str:
    i = text.index(start)
    j = text.index(end, i)
    return text[:i] + replacement.rstrip() + '\n\n' + text[j:]


def insert_before(text: str, marker: str, addition: str) -> str:
    i = text.index(marker)
    return text[:i] + addition.rstrip() + '\n\n' + text[i:]

# Interaction state
needle = "let utilityPanel: 'analysis' | 'bot' | 'log' | null = null;\n"
if "let boardPath: string[] = [];" not in main:
    main = main.replace(needle, needle + "let boardPath: string[] = [];\n")

# English game-term helpers
helpers = r'''
const GAME_TERM_ALIASES: Record<string, string> = {
  '공격': 'Attack',
  '이동': 'Move',
  '배치': 'Deploy',
  '강화': 'Bolster',
  '전술': 'Tactic',
  '점령': 'Control',
  '영입': 'Recruit',
  '패스': 'Pass',
  '기동': 'Maneuver',
  '주도권': 'Initiative',
  '거점': 'Location',
  '공급': 'Supply',
  '제거': 'Removed',
};

const GAME_TERMS = ['Claim Initiative', 'Initiative', 'Maneuver', 'Deploy', 'Bolster', 'Tactic', 'Attack', 'Move', 'Control', 'Recruit', 'Pass', 'Location', 'Supply', 'Removed'];

function termClass(term: string): string {
  return `term-${term.toLowerCase().replace(/\s+/g, '-')}`;
}

function gameTerm(term: string): string {
  return `<span class="game-term ${termClass(term)}">${esc(term)}</span>`;
}

function formatGameText(text: string): string {
  const aliases = [...Object.entries(GAME_TERM_ALIASES), ...GAME_TERMS.map((term) => [term, term] as [string, string])]
    .sort((a, b) => b[0].length - a[0].length);
  let parts: Array<{ text: string; term?: string }> = [{ text }];
  for (const [from, to] of aliases) {
    const next: Array<{ text: string; term?: string }> = [];
    for (const part of parts) {
      if (part.term || !part.text.includes(from)) {
        next.push(part);
        continue;
      }
      const split = part.text.split(from);
      split.forEach((piece, index) => {
        if (piece) next.push({ text: piece });
        if (index < split.length - 1) next.push({ text: to, term: to });
      });
    }
    parts = next;
  }
  return parts.map((part) => part.term ? gameTerm(part.term) : esc(part.text)).join('');
}
'''
if 'const GAME_TERM_ALIASES' not in main:
    main = insert_before(main, 'function loadDifficulty(): BotDifficulty {', helpers)

# Reset path on new game / undo
main = main.replace("  selectedCoinIndex = 0;\n  previewHexes.clear();\n  undoStack = [];", "  selectedCoinIndex = 0;\n  boardPath = [];\n  previewHexes.clear();\n  undoStack = [];")
main = main.replace("  selectedCoinIndex = 0;\n  previewHexes.clear();\n  saveState();\n  render();\n}\n\nfunction renderGame", "  selectedCoinIndex = 0;\n  boardPath = [];\n  previewHexes.clear();\n  saveState();\n  render();\n}\n\nfunction renderGame")

# Tooltip terminology
main = main.replace('<span class="rule-kind">용도</span>', '<span class="rule-kind">USE</span>')
main = main.replace('<div class="diagram-caption">전술 / 이동 예시</div>', '<div class="diagram-caption">TACTIC / MANEUVER EXAMPLE</div>')
# Existing rule kind titles come from UNIT_CARD_RULES; render them as English by kind.
main = main.replace('${esc(section.title)}', "${section.kind === 'TACTIC' ? 'TACTIC' : section.kind === 'ATTRIBUTE' ? 'ATTRIBUTE' : section.kind === 'RESTRICTION' ? 'RESTRICTION' : 'NOTE'}")

# Resource zones
new_discard = r'''
function renderDiscardZone(id: PlayerId, actions: ActionCandidate[] = []): string {
  if (!state) return '';
  const p = state.players[id];
  const visible = p.discard.slice(-6);
  const coins = visible.map((d) => tableCoin(d.faceUp ? d.coin : null, { faceUp: d.faceUp, className: 'discard-coin' })).join('');
  const up = p.discard.filter((d) => d.faceUp).length;
  const down = p.discard.length - up;
  const pass = id === 'human' ? actions.find((a) => a.kind === 'PASS') : undefined;
  const tag = pass ? 'button' : 'div';
  const attrs = pass ? ' type="button" data-pass-action="1" aria-label="Pass with selected Coin"' : '';
  return `<${tag}${attrs} class="resource-zone discard-zone ${pass ? 'face-down-action actionable' : ''}"><div class="resource-label"><span>DISCARD</span><b>${p.discard.length}</b></div><div class="discard-stack">${coins || '<span class="empty-zone">EMPTY</span>'}${p.discard.length > 6 ? `<span class="more-count">+${p.discard.length - 6}</span>` : ''}</div><div class="discard-legend"><span>UP ${up}</span><span>DOWN ${down}</span></div>${pass ? `<span class="zone-action-tag">${gameTerm('Pass')}</span>` : ''}</${tag}>`;
}
'''
main = replace_between(main, 'function renderDiscardZone(', 'function renderSupplyCard(', new_discard)

new_supply = r'''
function renderSupplyCard(type: UnitType, owner: PlayerId, actions: ActionCandidate[] = []): string {
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
  return `<${tag}${attrs} class="supply-card ${recruit ? 'actionable recruit-action' : ''}" style="--accent:${d.accent}" data-unit-type="${type}" data-owner-label="${owner === 'human' ? 'Your Unit' : 'Bot Unit'}" data-supply="${supply}" data-board="${boardStrength}" data-removed="${removed}">
    <div class="supply-card-head"><span class="supply-icon">${unitIconSvg(type)}</span><span class="supply-name"><strong>${esc(d.name)}</strong><small>${esc(d.ko)}</small></span><b class="supply-total">×${d.coinCount}</b></div>
    <div class="supply-card-foot"><div class="supply-stack" aria-label="Supply ${supply}">${stackCoins || '<span class="supply-empty">0</span>'}</div><div class="supply-stats"><span>SUPPLY <b>${supply}</b></span><span>BOARD <b>${boardStrength}</b></span><span>OUT <b>${removed}</b></span></div></div>
    ${recruit ? `<span class="supply-action-tag">${gameTerm('Recruit')}</span>` : ''}
  </${tag}>`;
}
'''
main = replace_between(main, 'function renderSupplyCard(', 'function renderPlayerPanel(', new_supply)

new_player = r'''
function renderPlayerPanel(id: PlayerId, actions: ActionCandidate[] = []): string {
  if (!state) return '';
  const p = state.players[id];
  const controlled = 6 - p.markersRemaining;
  const initiative = state.initiative === id ? `<span class="initiative-badge">${gameTerm('Initiative')}</span>` : '';
  return `<section class="player-panel tabletop-player ${id}">
    <div class="player-heading tabletop-heading">
      <div><div class="eyebrow">${id === 'human' ? 'YOU' : `BOT · ${difficultyLabel(difficulty).toUpperCase()}`}</div><h2>${id === 'human' ? 'Your Table' : 'Bot Table'} ${initiative}</h2></div>
      <div class="control-score"><strong>${controlled}</strong><span>/ 6 Locations</span></div>
    </div>
    ${renderControlMarkers(id)}
    <div class="resource-table">${renderHandZone(id)}${renderBagZone(id)}${renderDiscardZone(id, actions)}</div>
    <div class="supply-heading"><span>UNIT SUPPLY</span><small>${id === 'human' ? 'Click a highlighted Supply stack to Recruit' : 'Public information'}</small></div>
    <div class="supply-grid">${p.units.map((u) => renderSupplyCard(u, id, actions)).join('')}</div>
  </section>`;
}
'''
main = replace_between(main, 'function renderPlayerPanel(', 'function axialToPixel(', new_player)

interaction_helpers = r'''
type BoardInteractionEntry = { action: ActionCandidate; path: string[] };

function selectedHumanCoin(): Coin | null {
  if (!state) return null;
  if (state.forcedCoin?.player === 'human') return state.forcedCoin.coin;
  return state.players.human.hand[selectedCoinIndex] ?? null;
}

function actionInteractionPaths(action: ActionCandidate): string[][] {
  const unit = action.payload.unitId ? `unit:${action.payload.unitId}` : null;
  const target = action.payload.targetUnitId ? `unit:${action.payload.targetUnitId}` : null;
  const granted = action.payload.grantedUnitId ? `unit:${action.payload.grantedUnitId}` : null;
  const dest = action.payload.destination ? `hex:${action.payload.destination}` : null;
  switch (action.kind) {
    case 'DEPLOY': return dest ? [[dest]] : [];
    case 'BOLSTER': return unit ? [[unit, 'special:BOLSTER']] : [];
    case 'MOVE':
    case 'FREE_MOVE': return unit && dest ? [[unit, dest]] : [];
    case 'ATTACK':
    case 'FREE_ATTACK': return unit && target ? [[unit, target]] : [];
    case 'CONTROL':
    case 'FREE_CONTROL': return unit ? [[unit, 'special:CONTROL']] : [];
    case 'TACTIC_ARCHER':
    case 'TACTIC_CROSSBOWMAN': return unit && target ? [[unit, 'special:TACTIC', target]] : [];
    case 'TACTIC_CAVALRY':
    case 'TACTIC_LANCER': return unit && dest && target ? [[unit, 'special:TACTIC', dest, target]] : [];
    case 'TACTIC_ENSIGN': return unit && granted && dest ? [[unit, 'special:TACTIC', granted, dest]] : [];
    case 'TACTIC_LIGHT_CAVALRY':
    case 'TACTIC_ROYAL_GUARD': return unit && dest ? [[unit, 'special:TACTIC', dest]] : [];
    case 'TACTIC_MARSHALL': return unit && granted && target ? [[unit, 'special:TACTIC', granted, target]] : [];
    case 'TACTIC_FOOTMAN': {
      if (!state) return [];
      return state.boardUnits.filter((u) => u.owner === action.player && u.type === 'FOOTMAN').map((u) => [`unit:${u.id}`, 'special:TACTIC']);
    }
    case 'SKIP_ABILITY': return [['special:SKIP']];
    default: return [];
  }
}

function interactionEntries(actions: ActionCandidate[]): BoardInteractionEntry[] {
  return actions.flatMap((action) => actionInteractionPaths(action).map((path) => ({ action, path })));
}

function isPathPrefix(prefix: string[], path: string[]): boolean {
  return prefix.length <= path.length && prefix.every((key, index) => path[index] === key);
}

function boardInteractionState(actions: ActionCandidate[]): {
  entries: BoardInteractionEntry[];
  active: BoardInteractionEntry[];
  nextKeys: Set<string>;
  selectedKeys: Set<string>;
  kindsByKey: Map<string, Set<string>>;
} {
  const entries = interactionEntries(actions);
  const active = entries.filter((entry) => isPathPrefix(boardPath, entry.path));
  const nextKeys = new Set(active.map((entry) => entry.path[boardPath.length]).filter((key): key is string => Boolean(key)));
  const selectedKeys = new Set(boardPath);
  const kindsByKey = new Map<string, Set<string>>();
  for (const entry of active) {
    const key = entry.path[boardPath.length];
    if (!key) continue;
    if (!kindsByKey.has(key)) kindsByKey.set(key, new Set());
    kindsByKey.get(key)!.add(entry.action.kind);
  }
  return { entries, active, nextKeys, selectedKeys, kindsByKey };
}

function boardTargetClass(key: string, ui: ReturnType<typeof boardInteractionState>): string {
  const kinds = ui.kindsByKey.get(key) ?? new Set<string>();
  const attack = [...kinds].some((kind) => kind.includes('ATTACK') || kind.includes('ARCHER') || kind.includes('CROSSBOWMAN') || kind.includes('LANCER') || kind.includes('CAVALRY') || kind.includes('MARSHALL'));
  const deploy = kinds.has('DEPLOY');
  return `${ui.nextKeys.has(key) ? 'actionable interaction-target' : ''} ${ui.selectedKeys.has(key) ? 'interaction-selected' : ''} ${attack ? 'attack-target' : ''} ${deploy ? 'deploy-target' : ''}`;
}

function executeHumanAction(action: ActionCandidate): void {
  if (!state) return;
  previewHexes.clear();
  try {
    if (action.source === 'HAND') undoStack.push(cloneState(state));
    executeAction(state, action);
    afterResolvedAction(state);
    selectedCoinIndex = 0;
    boardPath = [];
    saveState();
    render();
  } catch (error) {
    console.error(error);
    alert(`Action error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function handleBoardKey(key: string, actions: ActionCandidate[]): void {
  const entries = interactionEntries(actions);
  let nextPath = [...boardPath, key];
  let matches = entries.filter((entry) => isPathPrefix(nextPath, entry.path));
  if (!matches.length) {
    nextPath = [key];
    matches = entries.filter((entry) => isPathPrefix(nextPath, entry.path));
  }
  if (!matches.length) return;
  const complete = matches.find((entry) => entry.path.length === nextPath.length);
  const hasLonger = matches.some((entry) => entry.path.length > nextPath.length);
  if (complete && !hasLonger) {
    executeHumanAction(complete.action);
    return;
  }
  boardPath = nextPath;
  previewHexes = new Set(matches.flatMap((entry) => entry.action.relatedHexes));
  renderGame();
}

function renderInteractionHud(actions: ActionCandidate[]): string {
  if (!state) return '';
  if (state.winner) return `<div class="interaction-hud game-over-hud">GAME OVER</div>`;
  if (state.activePlayer !== 'human') return `<div class="interaction-hud bot-turn-hud"><strong>BOT TURN</strong><span>Public zones remain visible while the bot resolves its Coin.</span></div>`;
  const coin = selectedHumanCoin();
  const info = coin ? infoForCoin(coin) : null;
  const skip = actions.find((a) => a.kind === 'SKIP_ABILITY');
  const stepCopy = boardPath.length
    ? 'Continue on the highlighted Unit or hex. Small badges beside the selected Unit resolve special actions.'
    : 'Choose a Coin, then interact directly with highlighted Units and hexes on the Battlefield.';
  return `<div class="interaction-hud">
    <div class="selected-coin-hud">${coin && info ? `<span class="table-coin front static" style="--coin-accent:${info.accent}" data-unit-type="${coin}"><span class="table-coin-inner">${unitIconSvg(coin)}</span></span><div><small>SELECTED COIN</small><strong>${esc(coinLabel(coin))}</strong></div>` : '<div><small>SELECTED COIN</small><strong>None</strong></div>'}</div>
    <div class="interaction-copy"><strong>Battlefield input</strong><span>${stepCopy}</span><div class="interaction-legend">${gameTerm('Deploy')} · ${gameTerm('Maneuver')} · ${gameTerm('Bolster')} · ${gameTerm('Tactic')} · ${gameTerm('Control')}</div></div>
    <div class="face-down-guide"><small>FACE-DOWN</small><span>Supply → ${gameTerm('Recruit')}</span><span>Initiative marker → ${gameTerm('Claim Initiative')}</span><span>Discard → ${gameTerm('Pass')}</span></div>
    <div class="interaction-hud-actions">${boardPath.length ? '<button type="button" id="cancelBoardPath" class="micro-action">Cancel</button>' : ''}${skip ? '<button type="button" id="skipAbilityBtn" class="micro-action">Skip Ability</button>' : ''}</div>
  </div>`;
}
'''
main = insert_before(main, 'function axialToPixel(', interaction_helpers)

new_board = r'''
function renderBoardSvg(actions: ActionCandidate[] = []): string {
  if (!state) return '';
  const ui = boardInteractionState(actions);
  const hexes = BOARD_HEXES.map((id) => {
    const { x, y } = axialToPixel(id);
    const isLocation = ALL_LOCATIONS.includes(id);
    const controller = state!.locations[id];
    const unit = state!.boardUnits.find((u) => u.hex === id);
    const preview = previewHexes.has(id);
    const hexKey = `hex:${id}`;
    const hexCls = boardTargetClass(hexKey, ui);
    const hexAttr = ui.nextKeys.has(hexKey) ? ` data-board-key="${hexKey}" role="button"` : '';
    const fill = controller === 'human'
      ? '#d5ece9'
      : controller === 'bot'
        ? '#f0d6d2'
        : isLocation
          ? '#ead9a9'
          : '#e9d8b3';
    const locationMark = isLocation
      ? `<g class="location-emblem"><circle cx="${x}" cy="${y}" r="18" fill="rgba(255,250,241,.8)" stroke="${controller === 'human' ? '#2c6f77' : controller === 'bot' ? '#91454e' : '#9c7c3e'}" stroke-width="2.5"/><circle cx="${x}" cy="${y}" r="8.5" fill="${controller === 'human' ? '#2c6f77' : controller === 'bot' ? '#91454e' : '#b0904c'}" opacity=".85"/></g>`
      : '';

    let unitMark = '';
    let badges = '';
    if (unit) {
      const d = UNIT_DEFS[unit.type];
      const ownerFill = unit.owner === 'human' ? '#275e67' : '#853f47';
      const unitKey = `unit:${unit.id}`;
      const unitCls = boardTargetClass(unitKey, ui);
      const unitAttr = ui.nextKeys.has(unitKey) ? ` data-board-key="${unitKey}" role="button"` : '';
      unitMark = `<g class="token unit-token ${unitCls}"${unitAttr} data-unit-type="${unit.type}" data-owner-label="${unit.owner === 'human' ? 'Your Unit' : 'Bot Unit'}" data-stack="${unit.strength}" data-location="${coordinateLabel(id)}">
        <circle cx="${x}" cy="${y + 3}" r="31" fill="rgba(0,0,0,.2)"/>
        <circle cx="${x}" cy="${y}" r="30" fill="${ownerFill}" stroke="#f4e7c3" stroke-width="2.8"/>
        <circle cx="${x}" cy="${y}" r="24.5" fill="${d.accent}" stroke="rgba(255,255,255,.58)" stroke-width="1.7"/>
        ${tokenIconMarkup(unit.type, x, y, 26)}
        ${unit.strength > 1 ? `<g class="stack-badge"><circle cx="${x + 22}" cy="${y - 21}" r="12" fill="#fff5db" stroke="#453722" stroke-width="1.8"/><text x="${x + 22}" y="${y - 17}" text-anchor="middle" class="stack-count">${unit.strength}</text></g>` : ''}
      </g>`;
      if (ui.selectedKeys.has(unitKey)) {
        const specials = [
          ['special:BOLSTER', 'BOLSTER', 'bolster'],
          ['special:TACTIC', 'TACTIC', 'tactic'],
          ['special:CONTROL', 'CONTROL', 'control'],
        ] as const;
        let chipIndex = 0;
        badges = specials.filter(([key]) => ui.nextKeys.has(key)).map(([key, label, cls]) => {
          const by = y - 44 + chipIndex * 23;
          chipIndex += 1;
          return `<g class="board-action-chip ${cls}" data-board-key="${key}" role="button"><rect x="${x + 30}" y="${by - 13}" width="68" height="20" rx="10"/><text x="${x + 64}" y="${by + 1}" text-anchor="middle">${label}</text></g>`;
        }).join('');
      }
    }

    return `<g class="hex-cell ${preview ? 'preview' : ''} ${hexCls}"${hexAttr}><polygon points="${hexPoints(x, y)}" fill="${fill}" stroke="${preview ? '#f4c65d' : '#b59558'}" stroke-width="${preview ? 4 : 1.6}"/>${locationMark}${unitMark}${badges}</g>`;
  }).join('');

  return `<svg class="battlefield" viewBox="0 0 960 680" role="img" aria-label="War Chest battlefield">
    <defs>
      <pattern id="woodGrain" width="24" height="24" patternUnits="userSpaceOnUse">
        <rect width="24" height="24" fill="#6d4f34"/>
        <path d="M0 12h24M0 4h24M0 20h24" stroke="#7d5b3b" stroke-width=".8" opacity=".35"/>
      </pattern>
      <filter id="boardShadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="14" stdDeviation="14" flood-opacity=".22"/></filter>
    </defs>
    <rect x="18" y="18" width="924" height="644" rx="28" fill="url(#woodGrain)" filter="url(#boardShadow)"/>
    <rect x="40" y="40" width="880" height="600" rx="22" fill="#8b6741" opacity=".38"/>
    <rect x="68" y="118" width="824" height="444" rx="18" fill="#efe1bb" opacity=".28"/>
    <polygon points="260,86 700,86 860,240 860,438 700,592 260,592 100,438 100,240" fill="#f3e3b8" stroke="#d2b57a" stroke-width="4"/>
    <polygon points="300,126 660,126 812,250 812,428 660,552 300,552 148,428 148,250" fill="#ecd9ab" stroke="#d4b77b" stroke-width="2.5"/>
    ${inactiveCluster(208, 339)}
    ${inactiveCluster(752, 339)}
    <rect x="430" y="82" width="100" height="42" rx="10" fill="#a8a5a9" opacity=".55"/>
    <rect x="430" y="556" width="100" height="42" rx="10" fill="#a8a5a9" opacity=".55"/>
    ${hexes}
  </svg>`;
}
'''
main = replace_between(main, 'function renderBoardSvg(', 'function renderBoardOnly(', new_board)

new_board_only = r'''
function renderBoardOnly(): void {
  const board = document.querySelector<HTMLDivElement>('#boardHost');
  if (board) {
    const actions = state?.activePlayer === 'human' && !state.winner ? humanCandidates() : [];
    board.innerHTML = renderBoardSvg(actions);
    bindUnitInfoInteractions();
  }
}
'''
main = replace_between(main, 'function renderBoardOnly(', 'function coinButtons(', new_board_only)

# Utility copy with term highlighting
new_analysis = r'''
function renderAnalysis(): string {
  if (!state) return '';
  const hLoc = 6 - state.players.human.markersRemaining;
  const bLoc = 6 - state.players.bot.markersRemaining;
  const hStr = boardStrength('human');
  const bStr = boardStrength('bot');
  const hOut = state.players.human.removed.length;
  const bOut = state.players.bot.removed.length;
  let summary = 'EVEN';
  const delta = (hLoc - bLoc) * 3 + (hStr - bStr) + (bOut - hOut) * .5;
  if (delta >= 3) summary = 'YOU AHEAD';
  else if (delta <= -3) summary = 'BOT AHEAD';
  return `<section class="analysis-panel"><div class="eyebrow">POSITION SNAPSHOT</div><div class="analysis-title"><h3>${summary}</h3><span>BOT : YOU</span></div><div class="metric-grid"><div><span>LOCATIONS</span><b>${bLoc} : ${hLoc}</b></div><div><span>STRENGTH</span><b>${bStr} : ${hStr}</b></div><div><span>REMOVED</span><b>${bOut} : ${hOut}</b></div><div><span>PRESSURE</span><b>${locationThreats('bot')} : ${locationThreats('human')}</b></div></div></section>`;
}
'''
main = replace_between(main, 'function renderAnalysis(', 'function renderBotThought(', new_analysis)

new_bot = r'''
function renderBotThought(): string {
  if (!lastBotThought) return `<section class="bot-thought"><div class="eyebrow">BOT EXPLAIN</div><h3>No decision yet</h3><p>The bot's reason and alternatives appear here after its turn.</p></section>`;
  return `<section class="bot-thought"><div class="eyebrow">BOT EXPLAIN · ROUND ${lastBotThought.round}</div><h3>${formatGameText(lastBotThought.label)}</h3><p>${formatGameText(lastBotThought.reason)}</p><details><summary>Top alternatives</summary><ol>${lastBotThought.alternatives.map((a) => `<li><span>${formatGameText(a.label)}</span><b>${Math.round(a.score)}</b></li>`).join('')}</ol></details></section>`;
}
'''
main = replace_between(main, 'function renderBotThought(', 'function renderLog(', new_bot)

new_log = r'''
function renderLog(): string {
  if (!state) return '';
  const entries = [...state.log].slice(-12).reverse();
  return `<section class="log-panel"><div class="eyebrow">BATTLE LOG</div><h3>Recent actions</h3><ol>${entries.map((x) => `<li>${formatGameText(x)}</li>`).join('')}</ol></section>`;
}
'''
main = replace_between(main, 'function renderLog(', 'function renderStatusBar(', new_log)

new_status = r'''
function renderStatusBar(actions: ActionCandidate[] = []): string {
  if (!state) return '';
  const active = state.activePlayer === 'human' ? 'YOUR TURN' : 'BOT TURN';
  const claim = actions.find((a) => a.kind === 'CLAIM_INITIATIVE');
  const owner = state.initiative === 'human' ? 'YOU' : 'BOT';
  return `<div class="status-bar"><span><b>Round ${state.round}</b></span><span class="turn-pill ${state.activePlayer}">${active}</span><button type="button" id="claimInitiativeToken" class="initiative-token-control ${state.initiative === 'human' ? 'human-owned' : 'bot-owned'} ${claim ? 'actionable' : ''}" ${claim ? '' : 'disabled'}><span class="initiative-medallion">◆</span><span>${gameTerm('Initiative')} <b>${owner}</b></span></button><span class="difficulty-chip">BOT ${difficultyLabel(difficulty)}</span><div class="utility-toolbar"><button type="button" class="utility-toggle ${utilityPanel === 'analysis' ? 'active' : ''}" data-utility="analysis">◎ ANALYSIS</button><button type="button" class="utility-toggle ${utilityPanel === 'bot' ? 'active' : ''}" data-utility="bot">◇ BOT</button><button type="button" class="utility-toggle ${utilityPanel === 'log' ? 'active' : ''}" data-utility="log">≡ LOG</button></div></div>`;
}
'''
main = replace_between(main, 'function renderStatusBar(', 'function renderUtilityDrawer(', new_status)

# Full game layout / event bindings
new_game = r'''
function renderGame(): void {
  if (!state) return;
  const actions = state.activePlayer === 'human' && !state.winner ? humanCandidates() : [];
  const sanity = stateSanity(state);
  app.innerHTML = `<main class="game-shell">
    <header class="topbar compact"><div><div class="eyebrow">LOCAL SOLO · DIRECT TABLE INPUT</div><h1>War Chest Solo</h1></div><div class="topbar-actions"><button id="undoBtn" class="ghost" ${undoStack.length && !botBusy ? '' : 'disabled'}>↶ Undo</button><button id="rulesBtn" class="ghost">Rules</button><button id="restartBtn" class="ghost danger">Restart</button></div></header>
    ${renderStatusBar(actions)}
    ${sanity.length ? `<div class="debug-warning">State warning: ${esc(sanity.join(' / '))}</div>` : ''}
    <section class="workspace-grid direct-table-layout">
      <aside class="left-rail player-rail bot-side">${renderPlayerPanel('bot', actions)}</aside>
      <section class="board-stage"><div class="board-panel"><div class="board-title"><div><div class="eyebrow">BATTLEFIELD</div><h2>Direct Battlefield</h2></div><div class="board-legend"><span><i class="legend-dot bot"></i>BOT</span><span><i class="legend-dot human"></i>YOU</span><span><i class="legend-location"></i>Location</span></div></div>${renderInteractionHud(actions)}<div id="boardHost">${renderBoardSvg(actions)}</div></div></section>
      <aside class="right-rail player-rail human-side">${renderPlayerPanel('human', actions)}</aside>
    </section>
    ${renderUtilityDrawer()}
    <dialog id="rulesDialog" class="rules-dialog"><form method="dialog"><button class="dialog-close">×</button></form><div class="eyebrow">QUICK RULES</div><h2>Core actions</h2><p>Draw up to 3 Coins each Round and alternate spending one Coin at a time.</p><ul><li>${gameTerm('Deploy')} / ${gameTerm('Bolster')}: place the Unit Coin directly on the Battlefield.</li><li>Face-down: ${gameTerm('Claim Initiative')}, ${gameTerm('Recruit')}, ${gameTerm('Pass')}.</li><li>Face-up ${gameTerm('Maneuver')}: ${gameTerm('Move')}, ${gameTerm('Attack')}, ${gameTerm('Control')}, or ${gameTerm('Tactic')}.</li><li>Win immediately after placing all 6 Control Markers.</li></ul></dialog>
    <div id="unitTooltip" class="unit-tooltip" hidden></div>
  </main>`;

  document.querySelector('#restartBtn')?.addEventListener('click', () => { if (confirm('Restart the current game?')) newGameSetup(); });
  document.querySelector('#againBtn')?.addEventListener('click', newGameSetup);
  document.querySelector('#undoBtn')?.addEventListener('click', undoLastHumanTurn);
  document.querySelector('#rulesBtn')?.addEventListener('click', () => document.querySelector<HTMLDialogElement>('#rulesDialog')?.showModal());
  document.querySelectorAll<HTMLButtonElement>('[data-hand-index]').forEach((btn) => btn.addEventListener('click', () => {
    selectedCoinIndex = Number(btn.dataset.handIndex ?? 0);
    boardPath = [];
    previewHexes.clear();
    renderGame();
  }));
  document.querySelectorAll<HTMLElement>('[data-board-key]').forEach((el) => el.addEventListener('click', (evt) => {
    evt.stopPropagation();
    const key = (evt.currentTarget as HTMLElement).dataset.boardKey;
    if (key) handleBoardKey(key, actions);
  }));
  document.querySelectorAll<HTMLElement>('[data-recruit-type]').forEach((el) => el.addEventListener('click', () => {
    const type = el.dataset.recruitType as UnitType;
    const action = actions.find((a) => a.kind === 'RECRUIT' && a.payload.recruitType === type);
    if (action) executeHumanAction(action);
  }));
  document.querySelector<HTMLElement>('[data-pass-action]')?.addEventListener('click', () => {
    const action = actions.find((a) => a.kind === 'PASS');
    if (action) executeHumanAction(action);
  });
  document.querySelector('#claimInitiativeToken')?.addEventListener('click', () => {
    const action = actions.find((a) => a.kind === 'CLAIM_INITIATIVE');
    if (action) executeHumanAction(action);
  });
  document.querySelector('#skipAbilityBtn')?.addEventListener('click', () => {
    const action = actions.find((a) => a.kind === 'SKIP_ABILITY');
    if (action) executeHumanAction(action);
  });
  document.querySelector('#cancelBoardPath')?.addEventListener('click', () => {
    boardPath = [];
    previewHexes.clear();
    renderGame();
  });
  document.querySelectorAll<HTMLButtonElement>('.utility-toggle').forEach((btn) => btn.addEventListener('click', () => {
    const next = btn.dataset.utility as 'analysis' | 'bot' | 'log';
    utilityPanel = utilityPanel === next ? null : next;
    renderGame();
  }));
  document.querySelector('#utilityClose')?.addEventListener('click', () => { utilityPanel = null; renderGame(); });
  bindUnitInfoInteractions();
}
'''
main = replace_between(main, 'function renderGame(', 'function sleep(', new_game)

# Direct-table CSS overrides appended at end.
css += r'''

/* v0.7 direct battlefield interaction */
.game-term {
  display: inline-block;
  font-weight: 900;
  letter-spacing: .015em;
  color: #6b4d86;
}
.term-attack { color: #b7444b; }
.term-move, .term-maneuver { color: #267783; }
.term-deploy { color: #31715a; }
.term-bolster { color: #47763d; }
.term-tactic { color: #79539a; }
.term-control, .term-location { color: #9b7421; }
.term-recruit { color: #3b7468; }
.term-initiative, .term-claim-initiative { color: #a06b12; }
.term-pass { color: #6a6660; }

.direct-table-layout.workspace-grid {
  grid-template-columns: minmax(285px, 330px) minmax(560px, 1fr) minmax(285px, 330px);
  gap: 10px;
}
.direct-table-layout .left-rail,
.direct-table-layout .right-rail {
  display: block;
  min-height: 0;
}
.direct-table-layout .tabletop-player { height: 100%; }
.board-panel {
  grid-template-rows: auto auto minmax(0, 1fr);
}

.interaction-hud {
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  border-radius: 14px;
  padding: 8px 10px;
  background: rgba(248, 237, 211, .12);
  border: 1px solid rgba(244, 224, 180, .16);
  color: #f3e4c4;
}
.selected-coin-hud { display: flex; align-items: center; gap: 8px; min-width: 118px; }
.selected-coin-hud small,
.face-down-guide small { display: block; color: #bfa77f; font-size: 8px; letter-spacing: .1em; font-weight: 900; }
.selected-coin-hud strong { display: block; font-size: 12px; color: #fff4dc; }
.interaction-copy { min-width: 0; display: grid; gap: 2px; }
.interaction-copy > strong { font-size: 11px; color: #fff2d6; }
.interaction-copy > span { font-size: 10px; line-height: 1.35; color: #d9c6a2; }
.interaction-legend { margin-top: 2px; font-size: 10px; }
.face-down-guide { display: grid; gap: 1px; font-size: 9px; color: #d9c6a2; white-space: nowrap; }
.interaction-hud-actions { display: flex; gap: 5px; }
.micro-action {
  border: 1px solid rgba(244,224,180,.2);
  border-radius: 999px;
  padding: 5px 8px;
  background: rgba(31,24,18,.3);
  color: #f7e8c9;
  font-size: 9px;
  font-weight: 800;
}
.bot-turn-hud { grid-template-columns: auto 1fr; }
.bot-turn-hud strong { color: #f3c4c7; }
.bot-turn-hud span { font-size: 10px; color: #d9c6a2; }

.initiative-token-control {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(126,95,58,.18);
  border-radius: 999px;
  padding: 4px 8px 4px 5px;
  background: rgba(255,255,255,.35);
  color: #5c4b35;
  font-size: 10px;
}
.initiative-token-control:disabled { opacity: 1; cursor: default; }
.initiative-token-control.actionable { cursor: pointer; box-shadow: 0 0 0 2px rgba(224,169,57,.28); }
.initiative-token-control.actionable:hover { transform: translateY(-1px); background: #fff4d7; }
.initiative-medallion {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 28%, #f8e6a5, #a46a20 75%);
  border: 2px solid #f5d889;
  color: #5c3913;
  box-shadow: 0 2px 5px rgba(0,0,0,.16);
}
.initiative-token-control.human-owned .initiative-medallion { outline: 2px solid rgba(47,115,122,.45); }
.initiative-token-control.bot-owned .initiative-medallion { outline: 2px solid rgba(149,76,84,.4); }

/* Larger table Coins and Supply piles */
.table-coin { width: 40px; height: 40px; }
.table-coin .unit-icon { width: 21px; height: 21px; }
.table-coin.static { width: 42px; height: 42px; }
.coin-fan { gap: 6px; }
.discard-coin { width: 32px; height: 32px; margin-left: -8px; }
.supply-mini-coin { width: 27px; height: 27px; }
.supply-mini-coin .unit-icon { width: 14px; height: 14px; }
.supply-stack { min-height: 30px; }
.supply-grid { grid-auto-rows: minmax(91px, 1fr); }
.supply-card {
  position: relative;
  font-family: inherit;
  color: inherit;
  text-align: left;
}
button.supply-card { width: 100%; cursor: pointer; }
.supply-card.actionable,
.discard-zone.actionable {
  outline: 2px solid rgba(56,122,102,.34);
  outline-offset: -1px;
}
.supply-card.actionable:hover,
.discard-zone.actionable:hover { background: #fff5df; transform: translateY(-1px); }
.supply-action-tag,
.zone-action-tag {
  position: absolute;
  right: 5px;
  bottom: 4px;
  padding: 2px 5px;
  border-radius: 999px;
  background: rgba(255,255,255,.78);
  font-size: 8px;
}
.discard-zone { position: relative; color: inherit; font: inherit; text-align: left; width: 100%; }
button.discard-zone { cursor: pointer; }

/* BOT and YOU use the same readable component density now. */
.tabletop-player.bot .resource-table,
.tabletop-player.human .resource-table {
  grid-template-columns: minmax(0, 1.25fr) minmax(68px, .68fr);
  grid-template-areas: "hand bag" "discard discard";
  gap: 6px;
}
.tabletop-player.bot .resource-zone,
.tabletop-player.human .resource-zone { padding: 6px 7px; }
.tabletop-player.bot .discard-zone,
.tabletop-player.human .discard-zone { display: grid; grid-template-columns: auto minmax(0,1fr) auto; }
.tabletop-player.bot .discard-zone .resource-label,
.tabletop-player.human .discard-zone .resource-label { display: grid; margin: 0; }
.tabletop-player.bot .discard-legend { display: flex; }
.tabletop-player.bot .table-coin { width: 36px; height: 36px; }
.tabletop-player.bot .coin-back-icon { width: 19px; height: 19px; }
.tabletop-player.bot .supply-grid,
.tabletop-player.human .supply-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: minmax(91px, 1fr); gap: 6px; }
.tabletop-player.bot .supply-card,
.tabletop-player.human .supply-card { padding: 6px; gap: 4px; }
.tabletop-player.bot .supply-card-head,
.tabletop-player.human .supply-card-head { grid-template-columns: 30px minmax(0,1fr) auto; gap: 5px; }
.tabletop-player.bot .supply-icon,
.tabletop-player.human .supply-icon { width: 30px; height: 30px; }
.tabletop-player.bot .supply-name small,
.tabletop-player.bot .supply-total { display: block; }
.tabletop-player.bot .supply-card-foot,
.tabletop-player.human .supply-card-foot { grid-template-columns: 58px minmax(0,1fr); gap: 4px; }
.tabletop-player.bot .supply-stack,
.tabletop-player.human .supply-stack { height: 31px; }
.tabletop-player.bot .supply-mini-coin,
.tabletop-player.human .supply-mini-coin { width: 25px; height: 25px; }
.tabletop-player.bot .supply-mini-coin .unit-icon,
.tabletop-player.human .supply-mini-coin .unit-icon { width: 13px; height: 13px; }
.tabletop-player.bot .supply-stats,
.tabletop-player.human .supply-stats { grid-template-columns: repeat(3, minmax(0,1fr)); }
.tabletop-player.bot .supply-stats span,
.tabletop-player.human .supply-stats span { display: block; font-size: 6.5px; }
.tabletop-player.bot .supply-stats span:not(:first-child) { display: block; }
.tabletop-player.bot .supply-stats b,
.tabletop-player.human .supply-stats b { display: block; margin: 0; font-size: 9px; }

/* Battlefield direct-input affordances */
.hex-cell.actionable > polygon,
.hex-cell.interaction-target > polygon {
  stroke: #f0c55a !important;
  stroke-width: 3.2 !important;
  filter: drop-shadow(0 0 7px rgba(240,197,90,.44));
  cursor: pointer;
}
.hex-cell.deploy-target > polygon { stroke: #6bb89d !important; }
.unit-token.actionable { cursor: pointer; }
.unit-token.actionable > circle:nth-of-type(2) { stroke: #f5cf6c; stroke-width: 4; filter: drop-shadow(0 0 7px rgba(245,207,108,.65)); }
.unit-token.attack-target > circle:nth-of-type(2) { stroke: #d65b60; }
.unit-token.interaction-selected > circle:nth-of-type(2) { stroke: #fff4b5; stroke-width: 4.5; }
.board-action-chip { cursor: pointer; }
.board-action-chip rect { fill: #2f291f; stroke: #f2dfb3; stroke-width: 1.2; }
.board-action-chip text { fill: #fff4d9; font-size: 8.5px; font-weight: 900; pointer-events: none; }
.board-action-chip.tactic rect { fill: #65477c; }
.board-action-chip.bolster rect { fill: #466c3d; }
.board-action-chip.control rect { fill: #8c6a22; }

@media (max-height: 820px) and (min-width: 1180px) {
  .direct-table-layout.workspace-grid { grid-template-columns: minmax(260px, 300px) minmax(520px, 1fr) minmax(260px, 300px); }
  .interaction-hud { padding: 5px 7px; gap: 7px; }
  .interaction-copy > span, .face-down-guide { font-size: 8px; }
  .tabletop-player { padding: 6px; gap: 4px; }
  .table-coin { width: 34px; height: 34px; }
  .tabletop-player.bot .table-coin { width: 32px; height: 32px; }
  .tabletop-player.bot .supply-grid,
  .tabletop-player.human .supply-grid { grid-auto-rows: 74px; gap: 4px; }
  .supply-mini-coin { width: 22px; height: 22px; }
}

@media (max-width: 1280px) and (min-width: 1101px) {
  .direct-table-layout.workspace-grid { grid-template-columns: minmax(238px, 265px) minmax(480px, 1fr) minmax(238px, 265px); gap: 7px; }
  .interaction-hud { grid-template-columns: auto minmax(0, 1fr) auto; }
  .face-down-guide { display: none; }
  .supply-name small { display: none; }
}
'''

main_path.write_text(main)
css_path.write_text(css)
print('v0.7 patch applied')
