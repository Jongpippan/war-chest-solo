from pathlib import Path

css_p = Path('styles.css')
css = css_p.read_text()

extra = r'''

/* v0.8.1 final visual-validation polish */
.status-bar { display: none !important; }
.board-title { display: none !important; }
.board-panel {
  padding: 0 !important;
  gap: 0 !important;
  grid-template-rows: minmax(0, 1fr) auto !important;
}
#boardHost {
  min-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
}
.battlefield {
  display: block;
  width: 100% !important;
  height: 100% !important;
  min-height: 0 !important;
  margin: 0 !important;
}
.integrated-header {
  min-height: 56px !important;
  grid-template-columns: minmax(150px,.62fr) minmax(0,2.5fr) auto !important;
  gap: 8px !important;
  padding: 5px 8px !important;
  border-radius: 13px;
  color: #3d3023;
  background: linear-gradient(180deg, rgba(248,240,223,.99), rgba(230,215,185,.99));
  border: 1px solid rgba(204,172,113,.45);
  box-shadow: 0 5px 18px rgba(24,17,11,.16), inset 0 1px rgba(255,255,255,.6);
}
.integrated-header .brand-lockup { min-width: 0; }
.integrated-header .brand-lockup .eyebrow { color: #8b765b; font-size: 8px; }
.integrated-header .brand-lockup h1 {
  margin: 1px 0 0 !important;
  color: #34291e !important;
  text-shadow: none !important;
  font-size: 20px !important;
  line-height: 1 !important;
  white-space: nowrap;
}
.header-center { min-width: 0; }
.header-game-meta { min-width: 0; flex-wrap: nowrap !important; }
.round-chip, .turn-chip, .difficulty-chip {
  white-space: nowrap;
  font-size: 9px !important;
  font-weight: 850;
}
.integrated-header .topbar-actions { flex-wrap: nowrap !important; }
.bot-last-action {
  min-width: 0;
  padding: 6px 9px !important;
  border: 1px solid rgba(149,76,84,.22) !important;
  border-left: 4px solid var(--bot) !important;
  background: linear-gradient(90deg, rgba(149,76,84,.12), rgba(255,255,255,.44)) !important;
  box-shadow: inset 0 1px rgba(255,255,255,.55);
}
.bot-last-action > span {
  color: #963f4c !important;
  font-weight: 950 !important;
  letter-spacing: .1em;
}
.bot-last-action > strong {
  color: #33271f !important;
  font-size: 11px !important;
  font-weight: 900 !important;
}
.bot-last-action > small {
  color: #715e4c !important;
  font-size: 9px !important;
  line-height: 1.25;
}
.interaction-hud.compact-hud {
  border-radius: 0 !important;
  border: 0 !important;
  border-top: 1px solid rgba(101,76,45,.2) !important;
  box-shadow: none !important;
}
.location-emblem.neutral { filter: drop-shadow(0 0 4px rgba(111,145,74,.42)) !important; }
.location-emblem.controlled.human { filter: drop-shadow(0 0 5px rgba(47,115,122,.62)) !important; }
.location-emblem.controlled.bot { filter: drop-shadow(0 0 5px rgba(149,76,84,.62)) !important; }
.unit-tooltip, .unit-tooltip * { font-family: var(--ui-font) !important; }
.rule-section p .game-term { font-size: inherit; }

@media (max-height: 820px) and (min-width: 1101px) {
  .integrated-header { min-height: 48px !important; padding: 3px 6px !important; }
  .integrated-header .brand-lockup .eyebrow { display:none; }
  .integrated-header .brand-lockup h1 { font-size: 18px !important; }
  .bot-last-action { padding: 4px 7px !important; }
  .bot-last-action > small { display:none !important; }
  .interaction-hud.compact-hud { min-height: 54px !important; padding: 4px 7px !important; }
}
@media (max-width: 1320px) and (min-width: 1101px) {
  .integrated-header { grid-template-columns: 138px minmax(0,1fr) auto !important; }
  .integrated-header .brand-lockup h1 { font-size: 17px !important; }
  .header-center { grid-template-columns: auto minmax(120px,1fr) !important; gap: 4px !important; }
  .bot-last-action > small { display:none !important; }
  .integrated-header .topbar-actions .ghost { padding: 5px 6px !important; font-size: 9px !important; }
}
'''

if '/* v0.8.1 final visual-validation polish */' not in css:
    css += extra
css_p.write_text(css)
print('v0.8.1 polish applied')
