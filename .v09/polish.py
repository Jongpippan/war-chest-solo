from pathlib import Path
p = Path('styles.css')
css = p.read_text()
css += r'''

/* v0.9.1 verified no-word-clipping correction */
.supply-card,
.tabletop-player.bot .supply-card,
.tabletop-player.human .supply-card {
  grid-template-columns: minmax(130px, 1.5fr) minmax(52px, .58fr) auto !important;
  gap: 5px !important;
}
.supply-identity {
  grid-template-columns: 34px minmax(88px, 1fr) !important;
  gap: 7px !important;
}
.supply-icon,
.tabletop-player.bot .supply-icon,
.tabletop-player.human .supply-icon {
  width: 34px !important;
  height: 34px !important;
}
.supply-name strong {
  font-size: 10.5px !important;
  white-space: nowrap !important;
}
.supply-name small { white-space: nowrap !important; }
.supply-stack-wrap { min-width: 52px !important; gap: 3px !important; }
.supply-stack { min-width: 38px !important; }
.supply-count { min-width: 14px !important; font-size: 12px !important; }
.supply-stats { min-width: 48px !important; gap: 3px !important; }
.supply-stats span { min-width: 14px !important; }
.supply-stats small { font-size: 6px !important; }
.supply-stats b { font-size: 9px !important; }

@media (max-width: 1320px) and (min-width: 1101px) {
  .direct-table-layout.workspace-grid {
    grid-template-columns: 280px minmax(500px,1fr) 280px !important;
    gap: 5px !important;
  }
  .supply-card,
  .tabletop-player.bot .supply-card,
  .tabletop-player.human .supply-card {
    grid-template-columns: minmax(126px,1.45fr) minmax(48px,.55fr) auto !important;
    padding-left: 6px !important;
    padding-right: 6px !important;
  }
  .supply-identity { grid-template-columns: 32px minmax(86px,1fr) !important; gap:6px !important; }
  .supply-icon,
  .tabletop-player.bot .supply-icon,
  .tabletop-player.human .supply-icon { width:32px !important; height:32px !important; }
}
'''
p.write_text(css)
print('v0.9.1 polish applied')
