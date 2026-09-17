from pathlib import Path
import re

main = Path('src/main.ts')
css = Path('styles.css')
text = main.read_text()

# Light Cavalry is a single Tactic selection in the UI: choose the final legal
# destination directly. The engine candidate still carries the actual
# intermediate hex used for rules resolution/reference.
old = """    case 'TACTIC_LIGHT_CAVALRY': {\n      const intermediate = action.payload.intermediate ? `hex:${action.payload.intermediate}` : null;\n      return unit && intermediate && dest ? [[unit, 'special:TACTIC', intermediate, dest]] : [];\n    }"""
new = """    case 'TACTIC_LIGHT_CAVALRY': return unit && dest ? [[unit, 'special:TACTIC', dest]] : [];"""
if old not in text:
    raise SystemExit('Light Cavalry path block not found')
text = text.replace(old, new, 1)

# Do not classify every kind containing CAVALRY as an attack target: that made
# Light Cavalry move destinations look like attack targets.
pattern = re.compile(r"function boardTargetClass\(key: string, ui: ReturnType<typeof boardInteractionState>\): string \{.*?\n\}", re.S)
replacement = """function boardTargetClass(key: string, ui: ReturnType<typeof boardInteractionState>): string {
  const kinds = ui.kindsByKey.get(key) ?? new Set<string>();
  const attackKinds = new Set(['ATTACK', 'FREE_ATTACK', 'TACTIC_ARCHER', 'TACTIC_CROSSBOWMAN', 'TACTIC_MARSHALL']);
  const attack = [...kinds].some((kind) => attackKinds.has(kind) || ((kind === 'TACTIC_CAVALRY' || kind === 'TACTIC_LANCER') && key.startsWith('unit:')));
  const deploy = kinds.has('DEPLOY');
  const move = key.startsWith('hex:') && [...kinds].some((kind) => kind === 'MOVE' || kind === 'FREE_MOVE' || kind === 'TACTIC_LIGHT_CAVALRY' || kind === 'TACTIC_CAVALRY' || kind === 'TACTIC_LANCER' || kind === 'TACTIC_ENSIGN' || kind === 'TACTIC_ROYAL_GUARD');
  return `${ui.nextKeys.has(key) ? 'actionable interaction-target' : ''} ${ui.selectedKeys.has(key) ? 'interaction-selected' : ''} ${attack ? 'attack-target' : ''} ${deploy ? 'deploy-target' : ''} ${move ? 'move-target' : ''}`;
}"""
text, n = pattern.subn(replacement, text, count=1)
if n != 1:
    raise SystemExit('boardTargetClass replacement failed')

# Contextual unit actions belong to a fixed tray below the board instead of
# being drawn over neighboring hexes/units. This removes the visual ambiguity
# where an enemy unit looked like it owned Bolster/Tactic buttons.
marker = "function renderInteractionHud(actions: ActionCandidate[]): string {"
helper = """function renderContextBoardActions(actions: ActionCandidate[]): string {
  if (!state || boardPath.length !== 1 || !boardPath[0].startsWith('unit:')) return '';
  const unitId = boardPath[0].slice(5);
  const unit = state.boardUnits.find((candidate) => candidate.id === unitId);
  if (!unit || unit.owner !== 'human') return '';
  const ui = boardInteractionState(actions);
  const choices = [
    ['special:BOLSTER', 'Bolster', 'bolster'],
    ['special:TACTIC', 'Tactic', 'tactic'],
    ['special:CONTROL', 'Control', 'control'],
  ] as const;
  const available = choices.filter(([key]) => ui.nextKeys.has(key));
  if (!available.length) return '';
  return `<div class=\"context-board-actions\"><span class=\"context-unit-label\">${esc(UNIT_DEFS[unit.type].name)} ACTIONS</span>${available.map(([key, label, cls]) => `<button type=\"button\" class=\"context-board-action ${cls}\" data-board-key=\"${key}\">${gameTerm(label)}</button>`).join('')}</div>`;
}

"""
if marker not in text:
    raise SystemExit('renderInteractionHud marker not found')
text = text.replace(marker, helper + marker, 1)

old_hud = """    <div class=\"interaction-copy\"><strong>Battlefield input</strong><span>${stepCopy}</span><div class=\"interaction-legend\">${gameTerm('Deploy')} · ${gameTerm('Maneuver')} · ${gameTerm('Bolster')} · ${gameTerm('Tactic')} · ${gameTerm('Control')}</div></div>"""
new_hud = """    <div class=\"interaction-copy\"><strong>Battlefield input</strong><span>${stepCopy}</span><div class=\"interaction-legend\">${gameTerm('Deploy')} · ${gameTerm('Maneuver')} · ${gameTerm('Bolster')} · ${gameTerm('Tactic')} · ${gameTerm('Control')}</div>${renderContextBoardActions(actions)}</div>"""
if old_hud not in text:
    raise SystemExit('interaction HUD block not found')
text = text.replace(old_hud, new_hud, 1)

# Rebuild the board layers so hex polygons can never cover Unit stack badges.
# Controlled Location outlines are intentionally drawn AFTER Units, around the
# full hex edge, so control remains visible with a large Coin on top.
pattern = re.compile(r"function renderBoardSvg\(actions: ActionCandidate\[] = \[]\): string \{.*?\n\}\n\n\nfunction renderBoardOnly", re.S)
new_board = r'''function renderBoardSvg(actions: ActionCandidate[] = []): string {
  if (!state) return '';
  const ui = boardInteractionState(actions);
  const unitLayer: string[] = [];
  const locationOverlayLayer: string[] = [];
  const stackBadgeLayer: string[] = [];

  const hexes = BOARD_HEXES.map((id) => {
    const { x, y } = axialToPixel(id);
    const isLocation = ALL_LOCATIONS.includes(id);
    const controller = state!.locations[id];
    const unit = state!.boardUnits.find((candidate) => candidate.hex === id);
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
    const locationTone = controller === 'human' ? '#237b83' : controller === 'bot' ? '#ad4d58' : '#7f9f56';
    const locationMark = isLocation
      ? `<g class="location-emblem ${controller ? 'controlled' : 'neutral'} ${controller ?? ''}">
          <circle cx="${x}" cy="${y}" r="24" fill="rgba(255,252,239,.92)" stroke="${locationTone}" stroke-width="3.5"/>
          <circle cx="${x}" cy="${y}" r="17" fill="${locationTone}" opacity="${controller ? '.22' : '.13'}"/>
          <path d="M ${x-10} ${y} C ${x-6} ${y-9}, ${x+6} ${y-9}, ${x+10} ${y} C ${x+6} ${y+9}, ${x-6} ${y+9}, ${x-10} ${y} Z" fill="none" stroke="${locationTone}" stroke-width="2.2"/>
          ${controller ? `<circle cx="${x}" cy="${y}" r="6" fill="${locationTone}"/><circle cx="${x}" cy="${y}" r="2" fill="#fff8e8"/>` : ''}
        </g>`
      : '';

    if (isLocation) {
      locationOverlayLayer.push(`<polygon class="location-control-outline ${controller ? `controlled-${controller}` : 'neutral'}" data-location-overlay="${id}" points="${hexPoints(x, y, 33.2)}" fill="none" stroke="${locationTone}" stroke-width="${controller ? 6.2 : 3.6}" stroke-linejoin="round" opacity="${controller ? '.96' : '.78'}" pointer-events="none"/>`);
    }

    if (unit) {
      const d = UNIT_DEFS[unit.type];
      const ownerFill = unit.owner === 'human' ? '#275e67' : '#853f47';
      const unitKey = `unit:${unit.id}`;
      const unitCls = boardTargetClass(unitKey, ui);
      const unitAttr = ui.nextKeys.has(unitKey) ? ` data-board-key="${unitKey}" role="button"` : '';
      unitLayer.push(`<g class="token unit-token ${unitCls}"${unitAttr} data-unit-type="${unit.type}" data-owner-label="${unit.owner === 'human' ? 'Your Unit' : 'Bot Unit'}" data-stack="${unit.strength}" data-location="${coordinateLabel(id)}">
        <circle cx="${x}" cy="${y + 3}" r="34" fill="rgba(0,0,0,.2)"/>
        <circle cx="${x}" cy="${y}" r="33" fill="${ownerFill}" stroke="#f4e7c3" stroke-width="2.8"/>
        <circle cx="${x}" cy="${y}" r="27" fill="${d.accent}" stroke="rgba(255,255,255,.58)" stroke-width="1.7"/>
        ${tokenIconMarkup(unit.type, x, y, 29)}
      </g>`);
      if (unit.strength > 1) {
        stackBadgeLayer.push(`<g class="stack-badge" data-stack-badge="${unit.id}" pointer-events="none"><circle cx="${x + 23}" cy="${y - 22}" r="12.5" fill="#fff5db" stroke="#453722" stroke-width="1.8"/><text x="${x + 23}" y="${y - 18}" text-anchor="middle" class="stack-count">${unit.strength}</text></g>`);
      }
    }

    return `<g class="hex-cell ${isLocation ? 'location-hex' : ''} ${controller ? `controlled-${controller}` : ''} ${preview ? 'preview' : ''} ${hexCls}"${hexAttr}><polygon points="${hexPoints(x, y)}" fill="${fill}" stroke="${preview ? '#f4c65d' : '#b59558'}" stroke-width="${preview ? 4 : 1.6}"/>${locationMark}</g>`;
  }).join('');

  return `<svg class="battlefield" viewBox="54 58 852 560" role="img" aria-label="War Chest battlefield">
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
    ${fourPlayerWing('left')}
    ${fourPlayerWing('right')}
    <rect x="435" y="70" width="90" height="28" rx="8" fill="#a8a5a9" opacity=".42"/>
    <rect x="435" y="578" width="90" height="28" rx="8" fill="#a8a5a9" opacity=".42"/>
    <g class="hex-layer">${hexes}</g>
    <g class="unit-layer">${unitLayer.join('')}</g>
    <g class="location-overlay-layer">${locationOverlayLayer.join('')}</g>
    <g class="stack-badge-layer">${stackBadgeLayer.join('')}</g>
  </svg>`;
}


function renderBoardOnly'''
text, n = pattern.subn(new_board, text, count=1)
if n != 1:
    raise SystemExit('renderBoardSvg replacement failed')

main.write_text(text)

css_text = css.read_text()
css_text += r'''

/* v0.11 interaction clarity + board layering */
.context-board-actions {
  margin-top: 5px;
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}
.context-unit-label {
  margin-right: 2px;
  font-size: 8px;
  font-weight: 950;
  letter-spacing: .08em;
  color: #cdb88f;
  white-space: nowrap;
}
.context-board-action {
  border: 1px solid rgba(255,244,217,.3);
  border-radius: 999px;
  padding: 4px 8px;
  background: #322b21;
  font-size: 9px;
  font-weight: 900;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 2px 5px rgba(0,0,0,.16);
}
.context-board-action.bolster { background: #365d33; }
.context-board-action.tactic { background: #5c3f73; }
.context-board-action.control { background: #7b5b1d; }
.context-board-action:hover { filter: brightness(1.14); transform: translateY(-1px); }
.context-board-action .game-term { color: #fff7df !important; }

/* Unit actions are no longer painted over neighboring Units. */
.action-chip-layer, .board-action-chip { display: none !important; }

/* Movement destinations, including Light Cavalry Tactic destinations. */
.hex-cell.move-target > polygon {
  stroke: #f1ca58 !important;
  stroke-width: 4 !important;
  filter: drop-shadow(0 0 8px rgba(241,202,88,.58));
  cursor: pointer !important;
}

/* Rendering order is now: board -> Units -> Location outline -> stack badge. */
.unit-layer { pointer-events: none; }
.unit-layer .unit-token[data-board-key] { pointer-events: all; }
.location-overlay-layer,
.stack-badge-layer { pointer-events: none; }
.location-control-outline.controlled-human {
  filter: drop-shadow(0 0 5px rgba(35,123,131,.68));
}
.location-control-outline.controlled-bot {
  filter: drop-shadow(0 0 5px rgba(173,77,88,.62));
}
.location-control-outline.neutral {
  filter: drop-shadow(0 0 4px rgba(127,159,86,.46));
}
.stack-badge-layer .stack-badge circle {
  filter: drop-shadow(0 2px 3px rgba(0,0,0,.32));
}
.stack-badge-layer .stack-count {
  fill: #302619;
  font-size: 12px;
  font-weight: 950;
}
'''
css.write_text(css_text)
print('v0.11 interaction and board layering patch applied')
