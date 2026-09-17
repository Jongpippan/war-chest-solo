from pathlib import Path

p = Path('src/main.ts')
text = p.read_text()
css_p = Path('styles.css')
css = css_p.read_text()

old = """    case 'TACTIC_LIGHT_CAVALRY':\n    case 'TACTIC_ROYAL_GUARD': return unit && dest ? [[unit, 'special:TACTIC', dest]] : [];"""
new = """    case 'TACTIC_LIGHT_CAVALRY': {\n      const intermediate = action.payload.intermediate ? `hex:${action.payload.intermediate}` : null;\n      return unit && intermediate && dest ? [[unit, 'special:TACTIC', intermediate, dest]] : [];\n    }\n    case 'TACTIC_ROYAL_GUARD': return unit && dest ? [[unit, 'special:TACTIC', dest]] : [];"""
if old not in text:
    raise SystemExit('light cavalry interaction path target not found')
text = text.replace(old, new, 1)

old2 = """  boardPath = nextPath;\n  previewHexes = new Set(matches.flatMap((entry) => entry.action.relatedHexes));\n  renderGame();"""
new2 = """  boardPath = nextPath;\n  // Only preview the hexes that are actually clickable on the next step.\n  // Multi-step Tactics used to paint the entire route yellow, which made\n  // non-clickable intermediate/final cells look actionable.\n  previewHexes = new Set(\n    matches\n      .map((entry) => entry.path[nextPath.length])\n      .filter((nextKey): nextKey is string => Boolean(nextKey) && nextKey.startsWith('hex:'))\n      .map((nextKey) => nextKey.slice(4) as HexId),\n  );\n  renderGame();"""
if old2 not in text:
    raise SystemExit('preview hex target not found')
text = text.replace(old2, new2, 1)

# Action chips must render above every hex. When they live inside each hex group,
# a later neighboring polygon can intercept pointer events over the chip.
old3 = """  const ui = boardInteractionState(actions);\n  const hexes = BOARD_HEXES.map((id) => {"""
new3 = """  const ui = boardInteractionState(actions);\n  const actionChips: string[] = [];\n  const hexes = BOARD_HEXES.map((id) => {"""
if old3 not in text:
    raise SystemExit('action chip layer init target not found')
text = text.replace(old3, new3, 1)

text = text.replace("    let badges = '';\n", "", 1)

old4 = """        badges = specials.filter(([key]) => ui.nextKeys.has(key)).map(([key, label, cls]) => {\n          const by = y - 44 + chipIndex * 23;\n          chipIndex += 1;\n          return `<g class=\"board-action-chip ${cls}\" data-board-key=\"${key}\" role=\"button\"><rect x=\"${x + 30}\" y=\"${by - 13}\" width=\"68\" height=\"20\" rx=\"10\"/><text x=\"${x + 64}\" y=\"${by + 1}\" text-anchor=\"middle\">${label}</text></g>`;\n        }).join('');"""
new4 = """        actionChips.push(...specials.filter(([key]) => ui.nextKeys.has(key)).map(([key, label, cls]) => {\n          const by = y - 44 + chipIndex * 23;\n          chipIndex += 1;\n          return `<g class=\"board-action-chip ${cls}\" data-board-key=\"${key}\" role=\"button\"><rect x=\"${x + 30}\" y=\"${by - 13}\" width=\"68\" height=\"20\" rx=\"10\"/><text x=\"${x + 64}\" y=\"${by + 1}\" text-anchor=\"middle\">${label}</text></g>`;\n        }));"""
if old4 not in text:
    raise SystemExit('action chip creation target not found')
text = text.replace(old4, new4, 1)

old5 = """    return `<g class=\"hex-cell ${isLocation ? 'location-hex' : ''} ${controller ? `controlled-${controller}` : ''} ${preview ? 'preview' : ''} ${hexCls}\"${hexAttr}><polygon points=\"${hexPoints(x, y)}\" fill=\"${fill}\" stroke=\"${preview ? '#f4c65d' : '#b59558'}\" stroke-width=\"${preview ? 4 : 1.6}\"/>${locationMark}${unitMark}${badges}</g>`;"""
new5 = """    return `<g class=\"hex-cell ${isLocation ? 'location-hex' : ''} ${controller ? `controlled-${controller}` : ''} ${preview ? 'preview' : ''} ${hexCls}\"${hexAttr}><polygon points=\"${hexPoints(x, y)}\" fill=\"${fill}\" stroke=\"${preview ? '#f4c65d' : '#b59558'}\" stroke-width=\"${preview ? 4 : 1.6}\"/>${locationMark}${unitMark}</g>`;"""
if old5 not in text:
    raise SystemExit('hex return target not found')
text = text.replace(old5, new5, 1)

old6 = """    ${hexes}\n  </svg>`;"""
new6 = """    ${hexes}\n    <g class=\"action-chip-layer\">${actionChips.join('')}</g>\n  </svg>`;"""
if old6 not in text:
    raise SystemExit('action chip overlay target not found')
text = text.replace(old6, new6, 1)

css += """

/* v0.10 battlefield click reliability */
.hex-cell[data-board-key],
.hex-cell[data-board-key] > polygon {
  cursor: pointer !important;
}
.action-chip-layer { pointer-events: none; }
.action-chip-layer .board-action-chip,
.action-chip-layer .board-action-chip * {
  pointer-events: all;
  cursor: pointer !important;
}
"""

p.write_text(text)
css_p.write_text(css)
print('v0.10 Light Cavalry interaction + click layering fix applied')
