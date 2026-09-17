from pathlib import Path
p = Path('styles.css')
text = p.read_text()
text += '\n/* v0.11 pointer correction: Units keep hover/tooltips while only action targets are clickable. */\n.unit-layer { pointer-events: auto !important; }\n'
p.write_text(text)
print('v0.11 pointer correction applied')
