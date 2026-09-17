from pathlib import Path

p = Path('src/main.ts')
text = p.read_text()

old = """    case 'TACTIC_LIGHT_CAVALRY':\n    case 'TACTIC_ROYAL_GUARD': return unit && dest ? [[unit, 'special:TACTIC', dest]] : [];"""
new = """    case 'TACTIC_LIGHT_CAVALRY': {\n      const intermediate = action.payload.intermediate ? `hex:${action.payload.intermediate}` : null;\n      return unit && intermediate && dest ? [[unit, 'special:TACTIC', intermediate, dest]] : [];\n    }\n    case 'TACTIC_ROYAL_GUARD': return unit && dest ? [[unit, 'special:TACTIC', dest]] : [];"""
if old not in text:
    raise SystemExit('light cavalry interaction path target not found')
text = text.replace(old, new, 1)

old2 = """  boardPath = nextPath;\n  previewHexes = new Set(matches.flatMap((entry) => entry.action.relatedHexes));\n  renderGame();"""
new2 = """  boardPath = nextPath;\n  // Preview only the immediate clickable hex choices for the next interaction step.\n  // Previously every related hex in a multi-step Tactic was painted yellow, so\n  // Light Cavalry showed final destinations before they were actually clickable.\n  previewHexes = new Set(\n    matches\n      .map((entry) => entry.path[nextPath.length])\n      .filter((nextKey): nextKey is string => Boolean(nextKey) && nextKey.startsWith('hex:'))\n      .map((nextKey) => nextKey.slice(4) as HexId),\n  );\n  renderGame();"""
if old2 not in text:
    raise SystemExit('preview hex target not found')
text = text.replace(old2, new2, 1)

p.write_text(text)
print('v0.10 Light Cavalry interaction fix applied')
