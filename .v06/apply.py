from pathlib import Path
import re

root=Path('.')
main=root/'src/main.ts'
css=root/'styles.css'
s=main.read_text()

def read(name): return (root/'.v06'/name).read_text()

if "let utilityPanel:" not in s:
    s=s.replace("let botThoughtHistory: BotThought[] = [];","let botThoughtHistory: BotThought[] = [];\nlet utilityPanel: 'analysis' | 'bot' | 'log' | null = null;",1)

s,n=re.subn(r"function unitCardMini\(.*?\n\}\n\nfunction axialToPixel",read('player_block.txt')+'\n\nfunction axialToPixel',s,count=1,flags=re.S)
if n!=1: raise SystemExit('player block replace failed')
s,n=re.subn(r"function renderActionPanel\(actions: ActionCandidate\[] = \[]\): string \{.*?\n\}\n\nfunction boardStrength",read('action_block.txt')+'\n\nfunction boardStrength',s,count=1,flags=re.S)
if n!=1: raise SystemExit('action block replace failed')
s,n=re.subn(r"function renderStatusBar\(\): string \{.*?\n\}\n\nfunction undoLastHumanTurn",read('status_block.txt')+'\n\nfunction undoLastHumanTurn',s,count=1,flags=re.S)
if n!=1: raise SystemExit('status block replace failed')
s,n=re.subn(r"function renderGame\(\): void \{.*?\n\}\n\nfunction sleep",read('game_block.txt')+'\n\nfunction sleep',s,count=1,flags=re.S)
if n!=1: raise SystemExit('game block replace failed')
main.write_text(s)

c=css.read_text()
if '/* v0.6 tabletop gameplay layout */' not in c:
    css.write_text(c+'\n\n'+read('styles1.css')+read('styles2.css'))
