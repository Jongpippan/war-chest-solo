import { ALL_UNITS, RECOMMENDED_BOT, RECOMMENDED_HUMAN, UNIT_DEFS } from './data.js';
import { BOARD_HEXES, ALL_LOCATIONS, coordinateLabel, distance, parseHex } from './board.js';
import {
  afterResolvedAction,
  cloneState,
  createGame,
  executeAction,
  generateActionsForCoin,
  generatePendingActions,
  stateSanity,
} from './engine.js';
import { chooseBotDecision, type BotDecision } from './bot.js';
import type { ActionCandidate, BotDifficulty, Coin, GameState, HexId, PlayerId, UnitType } from './types.js';

const STORAGE_KEY = 'war-chest-solo-local-v2';
const SETTINGS_KEY = 'war-chest-solo-settings-v2';
const app = document.querySelector<HTMLDivElement>('#app')!;
if (!app) throw new Error('Missing #app');

type SetupMode = 'SELECT' | 'DRAFT';
type DraftState = { pool: UnitType[]; human: UnitType[]; bot: UnitType[]; step: number };
type BotThought = { round: number; label: string; reason: string; score: number; alternatives: { label: string; score: number }[] };
type UnitInfoKey = UnitType | 'ROYAL';

type TooltipStats = {
  owner?: string;
  stack?: string;
  supply?: string;
  board?: string;
  removed?: string;
  location?: string;
};

const DRAFT_ORDER: PlayerId[] = ['human', 'bot', 'bot', 'human', 'human', 'bot', 'bot', 'human'];

let state: GameState | null = null;
let setupHuman = new Set<UnitType>(RECOMMENDED_HUMAN);
let setupBotOverride: UnitType[] | null = [...RECOMMENDED_BOT];
let setupMode: SetupMode = 'SELECT';
let difficulty: BotDifficulty = loadDifficulty();
let draft: DraftState | null = null;
let selectedCoinIndex = 0;
let previewHexes = new Set<HexId>();
let botBusy = false;
let undoStack: GameState[] = [];
let lastBotThought: BotThought | null = null;
let botThoughtHistory: BotThought[] = [];
let utilityPanel: 'analysis' | 'bot' | 'log' | null = null;
let boardPath: string[] = [];

function esc(value: string): string {
  return value.replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]!));
}


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

function loadDifficulty(): BotDifficulty {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    if (raw.difficulty === 'EASY' || raw.difficulty === 'NORMAL' || raw.difficulty === 'HARD') return raw.difficulty;
  } catch {
    // noop
  }
  return 'NORMAL';
}

function saveSettings(): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ difficulty }));
}

function coinLabel(coin: Coin): string {
  return coin === 'ROYAL' ? 'Royal Coin' : UNIT_DEFS[coin].ko;
}

function infoForCoin(coin: UnitInfoKey): { ko: string; name: string; accent: string; rules: string; coinCount?: number } {
  if (coin === 'ROYAL') {
    return {
      ko: 'Royal Coin',
      name: 'Royal Coin',
      accent: '#d5b15b',
      rules: '기본적으로 Recruit, Initiative, Pass에 사용한다. Royal Guard의 전술 비용으로도 사용된다.',
    };
  }
  const unit = UNIT_DEFS[coin];
  return { ko: unit.ko, name: unit.name, accent: unit.accent, rules: unit.rules, coinCount: unit.coinCount };
}


type RuleKind = 'TACTIC' | 'ATTRIBUTE' | 'RESTRICTION' | 'NOTE';
type RuleSection = { kind: RuleKind; title: string; text: string };

const UNIT_CARD_RULES: Record<UnitType, RuleSection[]> = {
  ARCHER: [
    { kind: 'TACTIC', title: 'Tactic', text: '정확히 2칸 떨어진 적 유닛을 Attack한다. 사이 칸에 유닛이 있어도 된다.' },
    { kind: 'RESTRICTION', title: '제한', text: '궁수는 일반 Attack을 할 수 없고 이 Tactic로만 Attack한다.' },
  ],
  BERSERKER: [
    { kind: 'ATTRIBUTE', title: '속성', text: 'Maneuver 후 자신의 스택에서 코인 1개를 제거하면 즉시 같은 유닛으로 추가 Maneuver 1회를 할 수 있다.' },
    { kind: 'RESTRICTION', title: '제한', text: '스택의 마지막 코인은 이 효과로 제거할 수 없다.' },
  ],
  CAVALRY: [
    { kind: 'TACTIC', title: 'Tactic', text: '1칸 Move한 뒤, 새 위치에서 인접한 적을 Attack한다.' },
  ],
  CROSSBOWMAN: [
    { kind: 'TACTIC', title: 'Tactic', text: '직선으로 정확히 2칸 떨어진 적을 Attack한다. 사이 칸은 비어 있어야 한다.' },
    { kind: 'ATTRIBUTE', title: '일반 Attack', text: '인접한 적에 대한 일반 Attack도 가능하다.' },
  ],
  ENSIGN: [
    { kind: 'TACTIC', title: 'Tactic', text: '기수로부터 2칸 이내의 다른 아군 1개가 일반 Move 1회를 한다.' },
    { kind: 'RESTRICTION', title: '제한', text: 'Move 후에도 그 아군은 기수로부터 2칸 이내에 있어야 한다.' },
  ],
  FOOTMAN: [
    { kind: 'TACTIC', title: 'Tactic', text: '보드 위의 각 보병 유닛이 각각 Maneuver 1회를 한다. 두 보병은 서로 다른 종류의 Maneuver을 해도 된다.' },
    { kind: 'ATTRIBUTE', title: '속성', text: '같은 보병 유닛을 최대 2개까지 동시에 Deploy할 수 있다.' },
  ],
  KNIGHT: [
    { kind: 'ATTRIBUTE', title: '속성', text: 'Bolster된 적 유닛, 즉 스택이 2개 이상인 유닛에게만 Attack받을 수 있다.' },
  ],
  LANCER: [
    { kind: 'TACTIC', title: 'Tactic', text: '직선으로 1~2칸 Move한 뒤 같은 직선 방향의 인접한 적을 Attack한다. Tactic을 쓸 때 합법적인 Attack 대상이 반드시 있어야 한다.' },
    { kind: 'RESTRICTION', title: '제한', text: '창기병은 일반 Attack을 할 수 없다.' },
  ],
  LIGHT_CAVALRY: [
    { kind: 'TACTIC', title: 'Tactic', text: '한 번의 Tactic로 2칸 Move한다.' },
    { kind: 'ATTRIBUTE', title: '일반 Move', text: '평소에는 다른 유닛처럼 일반 1칸 Move도 가능하다.' },
  ],
  MARSHALL: [
    { kind: 'TACTIC', title: 'Tactic', text: '지휘관으로부터 2칸 이내의 아군 1개가 일반 Attack 1회를 한다.' },
    { kind: 'RESTRICTION', title: '제한', text: 'Tactic Attack을 대신 실행시키는 것이 아니므로 궁수나 창기병처럼 일반 Attack을 못 하는 유닛에는 사용할 수 없다.' },
  ],
  MERCENARY: [
    { kind: 'ATTRIBUTE', title: '속성', text: '용병 코인을 Recruit한 직후 보드에 용병이 있다면 그 용병이 무료 Maneuver 1회를 할 수 있다.' },
    { kind: 'NOTE', title: '참고', text: '무료 Maneuver은 Deploy나 Recruit 같은 다른 종류의 행동으로 바꿀 수 없다.' },
  ],
  PIKEMAN: [
    { kind: 'ATTRIBUTE', title: '속성', text: '인접 유닛에게 Attack받으면 Attack자 스택에서도 코인 1개를 동시에 제거한다.' },
    { kind: 'NOTE', title: '참고', text: '이 효과는 Attack과 동시에 발생하며 Attack이 아니다. 따라서 Attack 중인 Knight에도 적용된다.' },
  ],
  ROYAL_GUARD: [
    { kind: 'TACTIC', title: 'Tactic', text: 'Royal Coin을 버리고, 자신이 지배하는 Location에 도착하도록 최대 2칸 Move한다.' },
    { kind: 'ATTRIBUTE', title: '속성', text: 'Attack받을 때 보드 코인 대신 Supply의 근위병 코인 1개를 제거할 수 있다.' },
  ],
  SCOUT: [
    { kind: 'ATTRIBUTE', title: '속성', text: '일반 Deploy 지점뿐 아니라 아군 유닛과 인접한 빈 칸에도 Deploy할 수 있다.' },
  ],
  SWORDSMAN: [
    { kind: 'ATTRIBUTE', title: '속성', text: 'Attack을 해결한 뒤 선택적으로 일반 Move 1회를 할 수 있다.' },
  ],
  WARRIOR_PRIEST: [
    { kind: 'ATTRIBUTE', title: '속성', text: 'Attack 또는 Control 후 Bag에서 코인 1개를 뽑고 그 코인으로 즉시 행동한다.' },
    { kind: 'NOTE', title: '참고', text: '뽑은 코인은 반드시 즉시 사용해야 하며, 다른 행동을 할 수 없어도 Pass로 사용할 수 있다.' },
  ],
};

function diagramHexPoints(cx: number, cy: number, size = 15): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${(cx + size * Math.cos(angle)).toFixed(1)},${(cy + size * Math.sin(angle)).toFixed(1)}`);
  }
  return pts.join(' ');
}

function diagramPoint(col: number, row: number): { x: number; y: number } {
  return { x: 30 + col * 31 + (row % 2 ? 15.5 : 0), y: 25 + row * 27 };
}

function diagramField(): string {
  const cells: string[] = [];
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 7; col += 1) {
      const { x, y } = diagramPoint(col, row);
      cells.push(`<polygon points="${diagramHexPoints(x, y)}" class="diagram-hex"/>`);
    }
  }
  return cells.join('');
}

function diagramMarker(x: number, y: number, kind: 'self' | 'ally' | 'enemy' | 'empty' | 'location', label = ''): string {
  const cls = `diagram-marker ${kind}`;
  const base = kind === 'empty'
    ? `<circle cx="${x}" cy="${y}" r="9" class="${cls}" fill="none"/><circle cx="${x}" cy="${y}" r="2" class="diagram-empty-dot"/>`
    : kind === 'location'
      ? `<polygon points="${diagramHexPoints(x, y, 10)}" class="${cls}"/>`
      : `<circle cx="${x}" cy="${y}" r="9" class="${cls}"/>`;
  return `${base}${label ? `<text x="${x}" y="${y + 3}" text-anchor="middle" class="diagram-label">${esc(label)}</text>` : ''}`;
}

function diagramArrow(x1: number, y1: number, x2: number, y2: number, kind: 'move' | 'attack' | 'effect' = 'move', dashed = false): string {
  return `<path d="M ${x1} ${y1} L ${x2} ${y2}" class="diagram-arrow ${kind}${dashed ? ' dashed' : ''}" marker-end="url(#diagramArrowHead)"/>`;
}

function diagramText(x: number, y: number, text: string, cls = ''): string {
  return `<text x="${x}" y="${y}" class="diagram-note ${cls}">${esc(text)}</text>`;
}

function renderUnitDiagram(type: UnitType): string {
  const P = (c: number, r: number) => diagramPoint(c, r);
  let overlay = '';
  const a = P(1, 2);
  const mid = P(2, 2);
  const target = P(3, 2);
  const upper = P(2, 1);
  const upperRight = P(3, 1);
  const far = P(4, 2);

  switch (type) {
    case 'ARCHER':
      overlay = `${diagramMarker(a.x, a.y, 'self')}${diagramMarker(mid.x, mid.y, 'ally', '•')}${diagramMarker(target.x, target.y, 'enemy')}${diagramArrow(a.x + 9, a.y, target.x - 9, target.y, 'attack', true)}${diagramText(89, 112, '정확히 2칸 · 사이 칸 점유 가능', 'ok')}`;
      break;
    case 'BERSERKER':
      overlay = `${diagramMarker(a.x, a.y, 'self', '3')}${diagramMarker(mid.x, mid.y, 'self', '2')}${diagramMarker(target.x, target.y, 'self', '1')}${diagramArrow(a.x + 9, a.y, mid.x - 9, mid.y, 'move')}${diagramArrow(mid.x + 9, mid.y, target.x - 9, target.y, 'move')}${diagramText(80, 112, '기동마다 스택 −1 · 마지막 코인은 유지')}`;
      break;
    case 'CAVALRY':
      overlay = `${diagramMarker(a.x, a.y, 'self')}${diagramMarker(mid.x, mid.y, 'empty')}${diagramMarker(target.x, target.y, 'enemy')}${diagramArrow(a.x + 9, a.y, mid.x - 9, mid.y, 'move')}${diagramArrow(mid.x + 9, mid.y, target.x - 9, target.y, 'attack')}${diagramText(102, 112, '1칸 이동 → 인접 공격')}`;
      break;
    case 'CROSSBOWMAN':
      overlay = `${diagramMarker(a.x, a.y, 'self')}${diagramMarker(mid.x, mid.y, 'empty')}${diagramMarker(target.x, target.y, 'enemy')}${diagramArrow(a.x + 9, a.y, target.x - 9, target.y, 'attack')}${diagramText(83, 112, '직선 2칸 · 사이 칸은 비어 있어야 함', 'warn')}`;
      break;
    case 'ENSIGN':
      overlay = `${diagramMarker(upper.x, upper.y, 'self', 'E')}${diagramMarker(mid.x, mid.y, 'ally')}${diagramMarker(target.x, target.y, 'empty')}${diagramArrow(mid.x + 9, mid.y, target.x - 9, target.y, 'move')}${diagramText(80, 112, '2칸 이내 아군이 일반 이동 1회')}`;
      break;
    case 'FOOTMAN': {
      const one = P(1, 1), oneDest = P(2, 1), two = P(4, 2), twoDest = P(5, 2);
      overlay = `${diagramMarker(one.x, one.y, 'self', '1')}${diagramMarker(oneDest.x, oneDest.y, 'empty')}${diagramMarker(two.x, two.y, 'self', '2')}${diagramMarker(twoDest.x, twoDest.y, 'empty')}${diagramArrow(one.x + 9, one.y, oneDest.x - 9, oneDest.y, 'move')}${diagramArrow(two.x + 9, two.y, twoDest.x - 9, twoDest.y, 'move')}${diagramText(78, 112, '두 보병이 각각 기동 1회')}`;
      break;
    }
    case 'KNIGHT': {
      const weak = P(1, 2), knight = P(3, 2), strong = P(5, 2);
      overlay = `${diagramMarker(knight.x, knight.y, 'self', 'K')}${diagramMarker(weak.x, weak.y, 'enemy', '1')}${diagramMarker(strong.x, strong.y, 'enemy', '2')}${diagramArrow(weak.x + 9, weak.y, knight.x - 9, knight.y, 'attack')}${diagramArrow(strong.x - 9, strong.y, knight.x + 9, knight.y, 'attack')}${diagramText(45, 112, '×', 'blocked')}${diagramText(198, 112, '✓', 'ok')}`;
      break;
    }
    case 'LANCER': {
      const start = P(0, 2), finish = P(2, 2), foe = P(3, 2);
      overlay = `${diagramMarker(start.x, start.y, 'self')}${diagramMarker(P(1,2).x, P(1,2).y, 'empty')}${diagramMarker(finish.x, finish.y, 'empty')}${diagramMarker(foe.x, foe.y, 'enemy')}${diagramArrow(start.x + 9, start.y, finish.x - 9, finish.y, 'move', true)}${diagramArrow(finish.x + 9, finish.y, foe.x - 9, foe.y, 'attack')}${diagramText(72, 112, '직선 1~2칸 이동 후 반드시 공격')}`;
      break;
    }
    case 'LIGHT_CAVALRY': {
      const start = P(1, 2), finish = P(3, 2);
      overlay = `${diagramMarker(start.x, start.y, 'self')}${diagramMarker(P(2,2).x, P(2,2).y, 'empty')}${diagramMarker(finish.x, finish.y, 'empty')}${diagramArrow(start.x + 9, start.y, finish.x - 9, finish.y, 'move', true)}${diagramText(104, 112, '전술: 2칸 이동')}`;
      break;
    }
    case 'MARSHALL': {
      const marshal = P(1, 1), ally = P(2, 2), foe = P(3, 2);
      overlay = `${diagramMarker(marshal.x, marshal.y, 'self', 'M')}${diagramMarker(ally.x, ally.y, 'ally')}${diagramMarker(foe.x, foe.y, 'enemy')}${diagramArrow(marshal.x + 6, marshal.y + 8, ally.x - 6, ally.y - 8, 'effect', true)}${diagramArrow(ally.x + 9, ally.y, foe.x - 9, foe.y, 'attack')}${diagramText(62, 112, '2칸 내 아군에게 일반 공격 부여')}`;
      break;
    }
    case 'MERCENARY': {
      const recruit = P(0, 1), merc = P(2, 2), dest = P(3, 2);
      overlay = `${diagramMarker(recruit.x, recruit.y, 'location', '+')}${diagramText(9, 18, 'Recruit')}${diagramMarker(merc.x, merc.y, 'self')}${diagramMarker(dest.x, dest.y, 'empty')}${diagramArrow(recruit.x + 12, recruit.y + 5, merc.x - 12, merc.y - 5, 'effect', true)}${diagramArrow(merc.x + 9, merc.y, dest.x - 9, dest.y, 'move')}${diagramText(73, 112, 'Mercenary Recruit → 무료 기동')}`;
      break;
    }
    case 'PIKEMAN': {
      const pike = P(3, 2), foe = P(4, 2);
      overlay = `${diagramMarker(pike.x, pike.y, 'self', 'P')}${diagramMarker(foe.x, foe.y, 'enemy')}${diagramArrow(foe.x - 9, foe.y, pike.x + 9, pike.y, 'attack')}${diagramArrow(pike.x + 9, pike.y - 7, foe.x - 9, foe.y - 7, 'effect', true)}${diagramText(116, 112, '인접 공격자도 동시에 −1')}`;
      break;
    }
    case 'ROYAL_GUARD': {
      const royal = P(0, 1), guard = P(1, 2), loc = P(3, 2);
      overlay = `${diagramMarker(royal.x, royal.y, 'ally', 'R')}${diagramMarker(guard.x, guard.y, 'self')}${diagramMarker(loc.x, loc.y, 'location')}${diagramArrow(royal.x + 10, royal.y + 5, guard.x - 10, guard.y - 5, 'effect', true)}${diagramArrow(guard.x + 9, guard.y, loc.x - 9, loc.y, 'move', true)}${diagramText(75, 112, 'Royal Coin → 내 Location까지 최대 2칸')}`;
      break;
    }
    case 'SCOUT': {
      const ally = P(3, 2), s1 = P(2, 1), s2 = P(3, 1), s3 = P(4, 2), s4 = P(3, 3);
      overlay = `${diagramMarker(ally.x, ally.y, 'ally')}${diagramMarker(s1.x, s1.y, 'empty')}${diagramMarker(s2.x, s2.y, 'empty')}${diagramMarker(s3.x, s3.y, 'empty')}${diagramMarker(s4.x, s4.y, 'empty')}${diagramArrow(ally.x - 5, ally.y - 8, s1.x + 5, s1.y + 8, 'effect', true)}${diagramText(71, 112, '아군과 인접한 빈 칸에 Deploy 가능')}`;
      break;
    }
    case 'SWORDSMAN': {
      const sword = P(2, 2), foe = P(3, 2), dest = P(2, 1);
      overlay = `${diagramMarker(sword.x, sword.y, 'self')}${diagramMarker(foe.x, foe.y, 'enemy')}${diagramMarker(dest.x, dest.y, 'empty')}${diagramArrow(sword.x + 9, sword.y, foe.x - 9, foe.y, 'attack')}${diagramArrow(sword.x, sword.y - 9, dest.x, dest.y + 9, 'move', true)}${diagramText(91, 112, '공격 후 선택적으로 이동')}`;
      break;
    }
    case 'WARRIOR_PRIEST': {
      const priest = P(2, 2), foe = P(3, 2), bonus = P(5, 1);
      overlay = `${diagramMarker(priest.x, priest.y, 'self')}${diagramMarker(foe.x, foe.y, 'enemy')}${diagramArrow(priest.x + 9, priest.y, foe.x - 9, foe.y, 'attack')}${diagramMarker(bonus.x, bonus.y, 'location', '+1')}${diagramArrow(foe.x + 12, foe.y - 5, bonus.x - 12, bonus.y + 5, 'effect', true)}${diagramText(76, 112, 'Attack / Control → 코인 1개 즉시 사용')}`;
      break;
    }
  }

  const accent = UNIT_DEFS[type].accent;
  return `<svg class="unit-card-diagram" viewBox="0 0 250 126" role="img" aria-label="${esc(UNIT_DEFS[type].ko)} 전술 예시">
    <defs>
      <marker id="diagramArrowHead" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7 Z" fill="context-stroke"/></marker>
    </defs>
    <rect x="0.5" y="0.5" width="249" height="125" rx="15" class="diagram-bg"/>
    <g style="--unit-accent:${accent}">${diagramField()}${overlay}</g>
  </svg>`;
}

function ruleSectionsHtml(type: UnitType): string {
  return `<div class="rule-sections">${UNIT_CARD_RULES[type].map((section) => `<div class="rule-section ${section.kind.toLowerCase()}"><span class="rule-kind">${section.kind}</span><p>${formatGameText(section.text)}</p></div>`).join('')}</div>`;
}

function randomSubset<T>(items: T[], count: number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

function saveState(): void {
  if (!state) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadSavedState(): GameState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GameState;
    if (!parsed.players?.human || !parsed.players?.bot || !parsed.locations) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearSave(): void {
  localStorage.removeItem(STORAGE_KEY);
}

function resetSessionUi(): void {
  selectedCoinIndex = 0;
  boardPath = [];
  previewHexes.clear();
  undoStack = [];
  lastBotThought = null;
  botThoughtHistory = [];
}

function startGameWithArmies(human: UnitType[], bot: UnitType[], initiative?: PlayerId): void {
  state = createGame(human, bot, initiative);
  resetSessionUi();
  saveState();
  render();
}

function startGame(): void {
  if (setupHuman.size !== 4) return;
  const human = [...setupHuman];
  const bot = setupBotOverride && setupBotOverride.every((u) => !setupHuman.has(u))
    ? [...setupBotOverride]
    : randomSubset(ALL_UNITS.filter((u) => !setupHuman.has(u)), 4);
  startGameWithArmies(human, bot);
}

function newGameSetup(): void {
  state = null;
  botBusy = false;
  draft = null;
  resetSessionUi();
  clearSave();
  render();
}

function resumeGame(): void {
  const saved = loadSavedState();
  if (!saved) return;
  state = saved;
  resetSessionUi();
  render();
}

function draftUnitWeight(type: UnitType): number {
  const base: Partial<Record<UnitType, number>> = {
    WARRIOR_PRIEST: 95,
    KNIGHT: 92,
    MERCENARY: 89,
    SWORDSMAN: 86,
    PIKEMAN: 84,
    CAVALRY: 83,
    CROSSBOWMAN: 81,
    LIGHT_CAVALRY: 79,
    MARSHALL: 78,
    ARCHER: 76,
    FOOTMAN: 75,
    LANCER: 73,
    ENSIGN: 71,
    SCOUT: 69,
    ROYAL_GUARD: 68,
    BERSERKER: 67,
  };
  return (base[type] ?? 70) + Math.random() * (difficulty === 'EASY' ? 22 : difficulty === 'HARD' ? 3 : 10);
}

function advanceBotDraft(): void {
  if (!draft) return;
  while (draft.step < DRAFT_ORDER.length && DRAFT_ORDER[draft.step] === 'bot') {
    const available = draft.pool.filter((u) => !draft!.human.includes(u) && !draft!.bot.includes(u));
    const pick = [...available].sort((a, b) => draftUnitWeight(b) - draftUnitWeight(a))[0];
    if (!pick) break;
    draft.bot.push(pick);
    draft.step += 1;
  }
}

function beginDraft(): void {
  setupMode = 'DRAFT';
  draft = { pool: randomSubset(ALL_UNITS, 8), human: [], bot: [], step: 0 };
  advanceBotDraft();
  renderSetup();
}

function pickDraft(type: UnitType): void {
  if (!draft || draft.step >= DRAFT_ORDER.length || DRAFT_ORDER[draft.step] !== 'human') return;
  if (!draft.pool.includes(type) || draft.human.includes(type) || draft.bot.includes(type)) return;
  draft.human.push(type);
  draft.step += 1;
  advanceBotDraft();
  renderSetup();
}

function startDraftGame(): void {
  if (!draft || draft.human.length !== 4 || draft.bot.length !== 4) return;
  startGameWithArmies(draft.human, draft.bot, 'bot');
}

function difficultyLabel(d: BotDifficulty): string {
  return d === 'EASY' ? 'Easy' : d === 'HARD' ? 'Hard' : 'Normal';
}

function difficultyDescription(d: BotDifficulty): string {
  if (d === 'EASY') return '좋은 수 주변에서 일부러 흔들립니다. 전술 실수가 섞입니다.';
  if (d === 'HARD') return '즉시 점수 + 행동 후 보드 가치까지 평가합니다.';
  return '점령·공격·전개·덱 순환을 함께 보는 기본 휴리스틱입니다.';
}

function setupDifficultyHtml(): string {
  return `<section class="difficulty-box">
    <div>
      <div class="eyebrow">BOT DIFFICULTY</div>
      <strong>${difficultyLabel(difficulty)}</strong>
      <p>${difficultyDescription(difficulty)}</p>
    </div>
    <div class="segmented">${(['EASY', 'NORMAL', 'HARD'] as BotDifficulty[]).map((d) => `<button class="difficulty-btn ${difficulty === d ? 'active' : ''}" data-difficulty="${d}">${difficultyLabel(d)}</button>`).join('')}</div>
  </section>`;
}

function svgPathAttrs(extra = ''): string {
  return `fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}`;
}

function unitIconPaths(coin: UnitInfoKey): string {
  switch (coin) {
    case 'ROYAL':
      return `<path d="M4.2 18.2h15.6L18.5 9l-3.4 3-3.1-5-3.1 5L5.5 9l-1.3 9.2Z" fill="currentColor" opacity=".16"/><path ${svgPathAttrs()} d="M4.2 18.2h15.6L18.5 9l-3.4 3-3.1-5-3.1 5L5.5 9l-1.3 9.2Z"/><path ${svgPathAttrs()} d="M6.6 20h10.8"/><circle cx="5.4" cy="6" r="1.05" fill="currentColor"/><circle cx="12" cy="4.5" r="1.05" fill="currentColor"/><circle cx="18.6" cy="6" r="1.05" fill="currentColor"/>`;
    case 'ARCHER':
      return `<path ${svgPathAttrs()} d="M15.8 4.5C10 6.8 7.1 11.8 7.1 18.4"/><path ${svgPathAttrs()} d="M15.8 4.5c2.2 3 2.2 10.4 0 13.4"/><path ${svgPathAttrs()} d="M5 11.3h14.1"/><path d="M18.4 8.8 21 11.3l-2.6 2.5" fill="currentColor"/><path ${svgPathAttrs()} d="M7.1 18.4 15.8 4.5" opacity=".65"/>`;
    case 'BERSERKER':
      return `<path ${svgPathAttrs()} d="M8.3 5.2 16.9 18.8"/><path ${svgPathAttrs()} d="M15.7 5.2 7.1 18.8"/><path d="M6.2 3.9 10.4 5.2 7.9 8.3Z" fill="currentColor"/><path d="M17.8 3.9 13.6 5.2l2.5 3.1Z" fill="currentColor"/><path d="M5.1 20.1 9.3 18.8l-2.5-3.1Z" fill="currentColor"/><path d="M18.9 20.1 14.7 18.8l2.5-3.1Z" fill="currentColor"/>`;
    case 'CAVALRY':
      return `<path d="M6.3 18.8c.8-4.3 2.8-6.6 6.2-8.7 2.2-1.3 3.4-2.4 3.8-5.1 2.1.7 3.5 2.1 3.8 4.2-1.1-.3-2.2-.2-3 .2.5 1.5.2 3-.6 4.2-1.5 2.3-4.2 3.4-7.4 3.1l-2.8 2.1Z" fill="currentColor"/><path d="M10.2 8.7 12.4 5l1.2 4.2Z" fill="currentColor"/><circle cx="17.2" cy="8.1" r=".8" fill="#fff8e8"/>`;
    case 'CROSSBOWMAN':
      return `<path ${svgPathAttrs()} d="M4.8 8.5c4.4 2.4 10 2.4 14.4 0"/><path ${svgPathAttrs()} d="M4.8 15.5c4.4-2.4 10-2.4 14.4 0"/><path ${svgPathAttrs()} d="M12 5v14"/><path ${svgPathAttrs()} d="M7.1 12h9.8"/><path d="M12 3.6 9.8 7.2h4.4Z" fill="currentColor"/><path d="M12 20.4 9.8 16.8h4.4Z" fill="currentColor"/>`;
    case 'ENSIGN':
      return `<path ${svgPathAttrs()} d="M7 20V4.2"/><path d="M8.3 5.1h10l-2.6 3.5 2.6 3.5h-10Z" fill="currentColor"/><path ${svgPathAttrs()} d="M5 20h4"/>`;
    case 'FOOTMAN':
      return `<circle cx="9.1" cy="5.7" r="2.2" fill="currentColor"/><path d="M6.8 8.2h4.6l1.2 5.7-1.5 5.6H8l-1.5-5.6Z" fill="currentColor"/><path d="M13.2 8.5h5.3v6.8h-5.3Z" fill="currentColor" opacity=".95"/><path ${svgPathAttrs()} d="M5.3 10.2 3.8 15.8M11.7 10.1l1.7 5.5M8.2 19.4 6.8 22M10.9 19.4l1.5 2.6"/>`;
    case 'KNIGHT':
      return `<circle cx="8.7" cy="5.8" r="2.2" fill="currentColor"/><path d="M6.4 8.3h4.7l1.1 5.6-1.4 5.4H7.2l-1.4-5.4Z" fill="currentColor"/><circle cx="16.9" cy="12.1" r="4.1" fill="currentColor"/><circle cx="16.9" cy="12.1" r="1.35" fill="#fff8e8"/><path ${svgPathAttrs()} d="M8 19.2 6.7 22M10.4 19.2l1.4 2.8"/>`;
    case 'LANCER':
      return `<path d="M5.6 17.8c.5-3.3 2.4-5.4 5.5-7.1 1.9-1.1 3-2.1 3.5-4.2 1.8.5 3.3 1.7 3.8 3.4-.9-.2-1.9-.1-2.7.2.2 1.5-.3 2.9-1.4 4-1.8 1.9-4.2 2.6-6.5 2.1Z" fill="currentColor"/><path ${svgPathAttrs()} d="M4 19.5 20.1 5"/><path d="M19.2 3.8 22 3l-.9 2.8Z" fill="currentColor"/>`;
    case 'LIGHT_CAVALRY':
      return `<path d="M6 18.9c.7-4.2 2.7-6.6 6.1-8.7 2.2-1.3 3.4-2.4 3.8-5.1 2.1.7 3.5 2.1 3.8 4.2-1.1-.3-2.2-.2-3 .2.4 1.2.3 2.5-.2 3.6-1 2.2-3.4 3.6-6.4 3.7l-2.6 2.1Z" fill="currentColor"/><path d="M10 8.8 12.4 4.7l1 4.7Z" fill="currentColor"/><path d="M5.8 15.2 3.5 16.4l2.2.8ZM6.9 18.4 4.4 20l2.7.2Z" fill="currentColor"/><circle cx="16.8" cy="8.1" r=".8" fill="#fff8e8"/>`;
    case 'MARSHALL':
      return `<path d="M7.1 7.6c.7-3.1 2.6-5 5.2-5.6 2.5.7 4.2 2.5 4.8 5.1l-2.3-.8-.8 2.1-1.7-2.3-1.7 2.3-.8-2.1Z" fill="currentColor"/><path d="M7.1 9.1h9.8v8.7l-4.9 3-4.9-3Z" fill="currentColor" opacity=".95"/><circle cx="12" cy="14.1" r="2.1" fill="#fff8e8"/><path ${svgPathAttrs()} d="M18.2 9.3v7.9M18.2 9.3l2.4 2.1"/>`;
    case 'MERCENARY':
      return `<path d="M10.6 3.2h2.8v10.3h-2.8Z" fill="currentColor"/><path d="M7.8 6.2h8.4v2H7.8Z" fill="currentColor"/><path d="M8.7 13.2h6.6v2.4H8.7Z" fill="currentColor"/><path d="M6.8 16.1h10.4v2.6H6.8Z" fill="currentColor"/><path d="M4.9 19.2h14.2v2H4.9Z" fill="currentColor"/><circle cx="12" cy="2.5" r="1.4" fill="currentColor"/>`;
    case 'PIKEMAN':
      return `<circle cx="8.1" cy="6" r="2.2" fill="currentColor"/><path d="M5.9 8.6h4.4l1.1 5.5-1.4 5H6.7l-1.3-5Z" fill="currentColor"/><path ${svgPathAttrs()} d="M3 11.2h18"/><path d="M20.1 9.4 23 11.2l-2.9 1.8Z" fill="currentColor"/><path ${svgPathAttrs()} d="M7.2 19 6 22M9.4 19l1.5 3"/>`;
    case 'ROYAL_GUARD':
      return `<path d="M5 7.2h14v13H5Z" fill="currentColor"/><path d="M4 4.5h4v4H4ZM10 4.5h4v4h-4ZM16 4.5h4v4h-4Z" fill="currentColor"/><path d="M10 14h4v6h-4Z" fill="#fff8e8"/><path d="M7.1 10.1h2.4v2.4H7.1ZM14.5 10.1h2.4v2.4h-2.4Z" fill="#fff8e8"/>`;
    case 'SCOUT':
      return `<path d="M4 14.8c4.1-1.4 6.2-4.1 8-7.8 1.1 2.2 2.9 3.8 6.4 4.7-1.9 3.1-4.4 4.8-7.5 4.9-2.8.1-5.1-.5-6.9-1.8Z" fill="currentColor"/><path d="M13 7.8c1.1-2 2.3-3.2 4.8-3.8-.6 1.5-.7 2.9-.2 4.3Z" fill="currentColor"/><circle cx="15.9" cy="8.6" r=".75" fill="#fff8e8"/><path ${svgPathAttrs()} d="M8.1 17.2 6.2 20.4M11.1 17 10.1 20.5"/>`;
    case 'SWORDSMAN':
      return `<path ${svgPathAttrs()} d="M6 5.2 18 18.8M18 5.2 6 18.8"/><path d="M4.7 3.8 8.2 5.2 6 7.4ZM19.3 3.8 15.8 5.2 18 7.4Z" fill="currentColor"/><path d="M4.7 20.2 8.2 18.8 6 16.6ZM19.3 20.2 15.8 18.8 18 16.6Z" fill="currentColor"/>`;
    case 'WARRIOR_PRIEST':
      return `<g fill="currentColor"><path d="M10.5 3.5 12 1.8l1.5 1.7L12 9Z"/><path d="M20.5 10.5 22.2 12l-1.7 1.5L15 12Z"/><path d="M13.5 20.5 12 22.2l-1.5-1.7L12 15Z"/><path d="M3.5 13.5 1.8 12l1.7-1.5L9 12Z"/><path d="M6.3 5.3 8.6 5l.1 2.3L10.2 10Z"/><path d="M18.7 6.3 19 8.6l-2.3.1L14 10.2Z"/><path d="M17.7 18.7 15.4 19l-.1-2.3L13.8 14Z"/><path d="M5.3 17.7 5 15.4l2.3-.1L10 13.8Z"/><circle cx="12" cy="12" r="2.2"/></g>`;
  }
}

function unitIconSvg(coin: UnitInfoKey, className = 'unit-icon'): string {
  return `<svg viewBox="0 0 24 24" class="${className}" aria-hidden="true">${unitIconPaths(coin)}</svg>`;
}

function tokenIconMarkup(coin: UnitInfoKey, x: number, y: number, size: number, color = '#fff8e8'): string {
  const scale = size / 24;
  return `<g class="token-icon" transform="translate(${(x - size / 2).toFixed(2)} ${(y - size / 2).toFixed(2)}) scale(${scale.toFixed(3)})" style="color:${color}">${unitIconPaths(coin)}</g>`;
}

function tooltipStatsHtml(stats: TooltipStats): string {
  const entries: string[] = [];
  if (stats.owner) entries.push(`<span>${esc(stats.owner)}</span>`);
  if (stats.stack) entries.push(`<span>Stack ${esc(stats.stack)}</span>`);
  if (stats.location) entries.push(`<span>${esc(stats.location)}</span>`);
  if (stats.supply) entries.push(`<span>Supply ${esc(stats.supply)}</span>`);
  if (stats.board) entries.push(`<span>Board ${esc(stats.board)}</span>`);
  if (stats.removed) entries.push(`<span>Out ${esc(stats.removed)}</span>`);
  return entries.length ? `<div class="tooltip-meta">${entries.join('')}</div>` : '';
}

function renderUnitTooltip(coin: UnitInfoKey, stats: TooltipStats = {}): string {
  const info = infoForCoin(coin);
  if (coin === 'ROYAL') {
    return `
      <div class="tooltip-card-header" style="--accent:${info.accent}">
        <div class="tooltip-icon-shell">${unitIconSvg(coin)}</div>
        <div class="tooltip-title-wrap"><div class="eyebrow">SPECIAL COIN</div><h4>${esc(info.ko)}</h4></div>
      </div>
      ${tooltipStatsHtml(stats)}
      <div class="rule-sections"><div class="rule-section note"><span class="rule-kind">USE</span><p>${esc(info.rules)}</p></div></div>
    `;
  }
  const unit = UNIT_DEFS[coin];
  return `
    <article class="unit-card-tooltip" style="--accent:${unit.accent}">
      <div class="tooltip-card-header">
        <div class="tooltip-icon-shell">${unitIconSvg(coin)}</div>
        <div class="tooltip-title-wrap">
          <div class="eyebrow">UNIT CARD</div>
          <h4>${esc(unit.ko)} <span>${esc(unit.name)}</span></h4>
        </div>
        <div class="coin-count">×${unit.coinCount}</div>
      </div>
      ${tooltipStatsHtml(stats)}
      <div class="diagram-caption">TACTIC / MANEUVER EXAMPLE</div>
      ${renderUnitDiagram(coin)}
      ${ruleSectionsHtml(coin)}
    </article>
  `;
}

function positionTooltip(tooltip: HTMLElement, evt: MouseEvent): void {
  const pad = 16;
  const width = tooltip.offsetWidth;
  const height = tooltip.offsetHeight;
  let left = evt.clientX + 18;
  let top = evt.clientY + 18;
  if (left + width + pad > window.innerWidth) left = evt.clientX - width - 18;
  if (top + height + pad > window.innerHeight) top = window.innerHeight - height - pad;
  if (top < pad) top = pad;
  if (left < pad) left = pad;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function bindUnitInfoInteractions(): void {
  const tooltip = document.querySelector<HTMLElement>('#unitTooltip');
  if (!tooltip) return;
  const hide = () => {
    tooltip.classList.remove('visible');
    tooltip.hidden = true;
  };
  document.querySelectorAll('[data-unit-type]').forEach((node) => {
    node.addEventListener('mouseenter', (evt) => {
      const el = evt.currentTarget as HTMLElement;
      const coin = (el.dataset.unitType ?? 'ROYAL') as UnitInfoKey;
      tooltip.innerHTML = renderUnitTooltip(coin, {
        owner: el.dataset.ownerLabel,
        stack: el.dataset.stack,
        supply: el.dataset.supply,
        board: el.dataset.board,
        removed: el.dataset.removed,
        location: el.dataset.location,
      });
      tooltip.hidden = false;
      tooltip.classList.add('visible');
      positionTooltip(tooltip, evt as MouseEvent);
    });
    node.addEventListener('mousemove', (evt) => positionTooltip(tooltip, evt as MouseEvent));
    node.addEventListener('mouseleave', hide);
  });
}

function renderSelectCard(type: UnitType, selected: boolean): string {
  const d = UNIT_DEFS[type];
  return `<button class="unit-pick ${selected ? 'selected' : ''}" data-unit="${type}" style="--accent:${d.accent}" data-unit-type="${type}">
    <span class="pick-icon">${unitIconSvg(type)}</span>
    <span class="pick-copy"><strong>${esc(d.ko)}</strong><span>${esc(d.name)}</span></span>
    <span class="pick-tags"><b>${d.coinCount} 코인</b><small>${selected ? '선택됨' : 'Hover로 설명'}</small></span>
  </button>`;
}

function renderDraftCard(type: UnitType, mine: boolean, theirs: boolean, disabled: boolean): string {
  const d = UNIT_DEFS[type];
  return `<button class="unit-pick draft-pick ${mine ? 'draft-human' : ''} ${theirs ? 'draft-bot' : ''}" data-draft-unit="${type}" style="--accent:${d.accent}" ${disabled ? 'disabled' : ''} data-unit-type="${type}">
    <span class="pick-icon">${unitIconSvg(type)}</span>
    <span class="pick-copy"><strong>${esc(d.ko)}</strong><span>${esc(d.name)}</span></span>
    <span class="pick-tags"><b>${d.coinCount} 코인</b><small>${mine ? '내 선택' : theirs ? '봇 선택' : '선택 가능'}</small></span>
    ${mine ? '<span class="pick-owner human">나</span>' : theirs ? '<span class="pick-owner bot">봇</span>' : ''}
  </button>`;
}

function renderDraftSetup(saved: GameState | null): void {
  if (!draft) beginDraft();
  if (!draft) return;
  const current = draft.step < DRAFT_ORDER.length ? DRAFT_ORDER[draft.step] : null;
  const picked = new Set([...draft.human, ...draft.bot]);
  const cards = draft.pool.map((type) => renderDraftCard(type, draft!.human.includes(type), draft!.bot.includes(type), picked.has(type) || current !== 'human')).join('');
  const complete = draft.step >= DRAFT_ORDER.length;
  app.innerHTML = `<main class="setup-shell">
    <section class="hero-card compact-hero">
      <div class="eyebrow">SNAKE DRAFT · 8 UNITS</div>
      <h1>War Chest Solo</h1>
      <p>8개 유닛에서 <b>1–2–2–2–1</b> 순서로 드래프트합니다. Hover 하면 유닛 규칙이 화면 안쪽 카드로 표시됩니다.</p>
      <div class="setup-actions"><button id="selectModeBtn" class="secondary">직접 선택으로</button>${saved ? '<button id="resumeBtn" class="secondary strong">저장 게임 이어하기</button>' : ''}</div>
    </section>
    ${setupDifficultyHtml()}
    <section class="setup-panel">
      <div class="draft-scoreboard"><div><span>당신</span><strong>${draft.human.map((u) => UNIT_DEFS[u].ko).join(' · ') || '아직 없음'}</strong></div><div class="draft-turn">${complete ? 'Draft Complete' : current === 'human' ? '당신 차례' : '봇 선택 중'}</div><div><span>봇</span><strong>${draft.bot.map((u) => UNIT_DEFS[u].ko).join(' · ') || '아직 없음'}</strong></div></div>
      <div class="unit-picker-grid draft-grid">${cards}</div>
      <div class="setup-footer"><div class="setup-note">봇의 드래프트 성향도 난이도의 영향을 받습니다.</div>${complete ? '<button id="startDraftBtn" class="primary">이 조합으로 시작</button>' : ''}</div>
    </section>
    <div id="unitTooltip" class="unit-tooltip" hidden></div>
  </main>`;

  bindDifficultyButtons();
  document.querySelectorAll<HTMLButtonElement>('[data-draft-unit]').forEach((btn) => btn.addEventListener('click', () => pickDraft(btn.dataset.draftUnit as UnitType)));
  document.querySelector('#selectModeBtn')?.addEventListener('click', () => { setupMode = 'SELECT'; draft = null; renderSetup(); });
  document.querySelector('#startDraftBtn')?.addEventListener('click', startDraftGame);
  document.querySelector('#resumeBtn')?.addEventListener('click', resumeGame);
  bindUnitInfoInteractions();
}

function bindDifficultyButtons(): void {
  document.querySelectorAll<HTMLButtonElement>('.difficulty-btn').forEach((btn) => btn.addEventListener('click', () => {
    difficulty = btn.dataset.difficulty as BotDifficulty;
    saveSettings();
    if (setupMode === 'DRAFT' && draft && draft.step < DRAFT_ORDER.length) advanceBotDraft();
    renderSetup();
  }));
}

function renderSetup(): void {
  const saved = loadSavedState();
  if (setupMode === 'DRAFT') {
    renderDraftSetup(saved);
    return;
  }
  const cards = ALL_UNITS.map((type) => renderSelectCard(type, setupHuman.has(type))).join('');
  app.innerHTML = `<main class="setup-shell">
    <section class="hero-card">
      <div class="eyebrow">LOCAL SOLO · UNOFFICIAL</div>
      <h1>War Chest Solo</h1>
      <p>원작 이미지는 쓰지 않고, 공식 보드 구성을 참고해 다시 디자인한 로컬 1인용 구현입니다. 선택 카드와 전장 토큰 모두 유닛 고유 아이콘 기반으로 표시됩니다.</p>
      <div class="setup-actions"><button id="recommendedBtn" class="secondary">추천 첫 게임</button><button id="randomBtn" class="secondary">무작위 4 vs 4</button><button id="draftBtn" class="secondary strong">8유닛 드래프트</button>${saved ? '<button id="resumeBtn" class="secondary strong">저장 게임 이어하기</button>' : ''}</div>
    </section>
    ${setupDifficultyHtml()}
    <section class="setup-panel">
      <div class="setup-heading"><div><div class="eyebrow">YOUR ARMY</div><h2>유닛 4종 선택</h2></div><div class="selection-count">${setupHuman.size} / 4</div></div>
      <div class="unit-picker-grid">${cards}</div>
      <div class="setup-footer"><div class="setup-note">카드 Hover로 유닛 규칙을 확인할 수 있습니다. 직접 선택 시 봇은 겹치지 않는 4종을 사용합니다.</div><button id="startBtn" class="primary" ${setupHuman.size === 4 ? '' : 'disabled'}>게임 시작</button></div>
    </section>
    <div id="unitTooltip" class="unit-tooltip" hidden></div>
  </main>`;

  bindDifficultyButtons();
  document.querySelectorAll<HTMLButtonElement>('.unit-pick[data-unit]').forEach((btn) => btn.addEventListener('click', () => {
    const type = btn.dataset.unit as UnitType;
    setupBotOverride = null;
    if (setupHuman.has(type)) setupHuman.delete(type);
    else if (setupHuman.size < 4) setupHuman.add(type);
    renderSetup();
  }));
  document.querySelector('#recommendedBtn')?.addEventListener('click', () => { setupHuman = new Set(RECOMMENDED_HUMAN); setupBotOverride = [...RECOMMENDED_BOT]; renderSetup(); });
  document.querySelector('#randomBtn')?.addEventListener('click', () => { const shuffled = randomSubset(ALL_UNITS, 8); setupHuman = new Set(shuffled.slice(0, 4)); setupBotOverride = shuffled.slice(4, 8); renderSetup(); });
  document.querySelector('#draftBtn')?.addEventListener('click', beginDraft);
  document.querySelector('#resumeBtn')?.addEventListener('click', resumeGame);
  document.querySelector('#startBtn')?.addEventListener('click', startGame);
  bindUnitInfoInteractions();
}

function playerName(id: PlayerId): string {
  return id === 'human' ? 'YOU' : 'BOT';
}

function coinBackSvg(): string {
  return `<svg viewBox="0 0 24 24" class="coin-back-icon" aria-hidden="true">
    <circle cx="12" cy="12" r="8.3" fill="none" stroke="currentColor" stroke-width="1.8"/>
    <path d="M9 11V8.9a3 3 0 0 1 6 0V11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <rect x="7.8" y="10.5" width="8.4" height="6.6" rx="1.8" fill="currentColor" opacity=".22"/>
    <path d="M12 13v2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`;
}

function tableCoin(coin: Coin | null, options: { faceUp?: boolean; className?: string; index?: number; owner?: PlayerId } = {}): string {
  const faceUp = options.faceUp ?? true;
  const cls = options.className ?? '';
  const interactive = options.owner === 'human' && options.index !== undefined;
  const tag = interactive ? 'button' : 'span';
  const attrs = interactive ? ` type="button" data-hand-index="${options.index}"` : '';
  if (!faceUp || !coin) {
    return `<${tag}${attrs} class="table-coin back ${cls}" aria-label="뒷면 코인"><span class="table-coin-inner">${coinBackSvg()}</span></${tag}>`;
  }
  const info = infoForCoin(coin);
  const unitAttr = ` data-unit-type="${coin}"`;
  return `<${tag}${attrs}${unitAttr} class="table-coin front ${cls}" style="--coin-accent:${info.accent}" aria-label="${esc(coinLabel(coin))}"><span class="table-coin-inner">${unitIconSvg(coin)}</span></${tag}>`;
}

function renderControlMarkers(id: PlayerId): string {
  if (!state) return '';
  const controlled = 6 - state.players[id].markersRemaining;
  return `<div class="marker-track" aria-label="${playerName(id)} control markers">${Array.from({ length: 6 }, (_, i) => `<span class="control-marker ${i < controlled ? 'placed' : 'available'} ${id}">${i < controlled ? '◆' : ''}</span>`).join('')}</div>`;
}

function renderHandZone(id: PlayerId): string {
  if (!state) return '';
  const p = state.players[id];
  const coins = p.hand.map((coin, index) => id === 'human'
    ? tableCoin(coin, { owner: 'human', index, className: index === selectedCoinIndex ? 'selected' : '' })
    : tableCoin(null, { faceUp: false }));
  return `<div class="resource-zone hand-zone"><div class="resource-label"><span>HAND</span><b>${p.hand.length}</b></div><div class="coin-fan">${coins.join('') || '<span class="empty-zone">EMPTY</span>'}</div></div>`;
}

function renderBagZone(id: PlayerId): string {
  if (!state) return '';
  const count = state.players[id].bag.length;
  return `<div class="resource-zone bag-zone"><div class="resource-label"><span>BAG</span><b>${count}</b></div><div class="bag-visual" aria-label="Bag ${count} coins"><svg viewBox="0 0 44 50" aria-hidden="true"><path d="M12 9c5 3 15 3 20 0l-3.2 7.2C36 21 39 29 37.2 37.5 35.6 45 29 47 22 47S8.4 45 6.8 37.5C5 29 8 21 15.2 16.2L12 9Z"/><path d="M13 8c4.5-3 13.5-3 18 0"/></svg><span class="bag-count">${count}</span><span class="peeking-coin one">${coinBackSvg()}</span><span class="peeking-coin two">${coinBackSvg()}</span></div></div>`;
}


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
  if (state.activePlayer !== 'human') return `<div class="interaction-hud bot-turn-hud"><strong>BOT TURN</strong><span>Watch <b>BOT LAST MOVE</b> in the header when the action resolves.</span></div>`;
  const coin = selectedHumanCoin();
  const info = coin ? infoForCoin(coin) : null;
  const skip = actions.find((a) => a.kind === 'SKIP_ABILITY');
  const stepCopy = boardPath.length
    ? 'Continue by choosing the highlighted Unit or hex.'
    : 'Select a Coin, then use highlighted Units, Locations and hexes directly.';
  return `<div class="interaction-hud compact-hud">
    <div class="selected-coin-hud">${coin && info ? `<span class="table-coin front static" style="--coin-accent:${info.accent}" data-unit-type="${coin}"><span class="table-coin-inner">${unitIconSvg(coin)}</span></span><div><small>SELECTED COIN</small><strong>${esc(coinLabel(coin))}</strong></div>` : '<div><small>SELECTED COIN</small><strong>NONE</strong></div>'}</div>
    <div class="interaction-copy"><strong>Battlefield input</strong><span>${stepCopy}</span><div class="interaction-legend">${gameTerm('Deploy')} · ${gameTerm('Maneuver')} · ${gameTerm('Bolster')} · ${gameTerm('Tactic')} · ${gameTerm('Control')}</div></div>
    <div class="face-down-guide"><span>Supply → ${gameTerm('Recruit')}</span><span>Initiative → ${gameTerm('Claim Initiative')}</span><span>Discard → ${gameTerm('Pass')}</span></div>
    <div class="interaction-hud-actions">${boardPath.length ? '<button type="button" id="cancelBoardPath" class="micro-action">Cancel</button>' : ''}${skip ? '<button type="button" id="skipAbilityBtn" class="micro-action">Skip Ability</button>' : ''}</div>
  </div>`;
}

function axialToPixel(id: HexId): { x: number; y: number } {
  const { q, r } = parseHex(id);
  const size = 39;
  return {
    x: 480 + size * 1.5 * q,
    y: 338 + size * Math.sqrt(3) * (r + q / 2),
  };
}

function hexPoints(cx: number, cy: number, size = 34): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 180) * (60 * i);
    pts.push(`${(cx + size * Math.cos(angle)).toFixed(2)},${(cy + size * Math.sin(angle)).toFixed(2)}`);
  }
  return pts.join(' ');
}

function inactiveCluster(cx: number, cy: number, size = 28): string {
  const offsets = [
    [0, 0], [0, -1], [0, 1], [-1, 0], [1, 0],
  ];
  const pts = offsets.map(([q, r]) => {
    const x = cx + size * 1.5 * q;
    const y = cy + size * Math.sqrt(3) * (r + q / 2);
    return `<polygon points="${hexPoints(x, y, size - 2)}" fill="rgba(215,114,95,.55)" stroke="rgba(144,77,63,.45)" stroke-width="1.5"/>`;
  }).join('');
  return `<g class="inactive-cluster">${pts}</g>`;
}


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
    const locationColor = controller === 'human' ? '#277c80' : controller === 'bot' ? '#a34c58' : '#b68a2a';
    const locationTone = controller === 'human' ? '#236f78' : controller === 'bot' ? '#9d434f' : '#86a55f';
    const locationMark = isLocation
      ? `<g class="location-emblem ${controller ? 'controlled' : 'neutral'} ${controller ?? ''}">
          <circle cx="${x}" cy="${y}" r="25" fill="rgba(255,252,239,.92)" stroke="${locationTone}" stroke-width="4.5"/>
          <circle cx="${x}" cy="${y}" r="18" fill="${locationTone}" opacity="${controller ? '.22' : '.13'}"/>
          <path d="M ${x-10} ${y} C ${x-6} ${y-9}, ${x+6} ${y-9}, ${x+10} ${y} C ${x+6} ${y+9}, ${x-6} ${y+9}, ${x-10} ${y} Z" fill="none" stroke="${locationTone}" stroke-width="2.4"/>
          ${controller ? `<circle cx="${x}" cy="${y}" r="6.5" fill="${locationTone}"/><circle cx="${x}" cy="${y}" r="2.2" fill="#fff8e8"/>` : ''}
        </g>`
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
        <circle cx="${x}" cy="${y + 3}" r="34" fill="rgba(0,0,0,.2)"/>
        <circle cx="${x}" cy="${y}" r="33" fill="${ownerFill}" stroke="#f4e7c3" stroke-width="2.8"/>
        <circle cx="${x}" cy="${y}" r="27" fill="${d.accent}" stroke="rgba(255,255,255,.58)" stroke-width="1.7"/>
        ${tokenIconMarkup(unit.type, x, y, 29)}
        ${unit.strength > 1 ? `<g class="stack-badge"><circle cx="${x + 24}" cy="${y - 23}" r="12.5" fill="#fff5db" stroke="#453722" stroke-width="1.8"/><text x="${x + 24}" y="${y - 19}" text-anchor="middle" class="stack-count">${unit.strength}</text></g>` : ''}
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

    return `<g class="hex-cell ${isLocation ? 'location-hex' : ''} ${controller ? `controlled-${controller}` : ''} ${preview ? 'preview' : ''} ${hexCls}"${hexAttr}><polygon points="${hexPoints(x, y)}" fill="${fill}" stroke="${preview ? '#f4c65d' : '#b59558'}" stroke-width="${preview ? 4 : 1.6}"/>${locationMark}${unitMark}${badges}</g>`;
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
    ${inactiveCluster(221, 338, 31)}
    ${inactiveCluster(739, 338, 31)}
    <rect x="435" y="70" width="90" height="28" rx="8" fill="#a8a5a9" opacity=".42"/>
    <rect x="435" y="578" width="90" height="28" rx="8" fill="#a8a5a9" opacity=".42"/>
    ${hexes}
  </svg>`;
}


function renderBoardOnly(): void {
  const board = document.querySelector<HTMLDivElement>('#boardHost');
  if (board) {
    const actions = state?.activePlayer === 'human' && !state.winner ? humanCandidates() : [];
    board.innerHTML = renderBoardSvg(actions);
    bindUnitInfoInteractions();
  }
}

function coinButtons(): string {
  if (!state) return '';
  if (state.forcedCoin?.player === 'human') {
    const c = state.forcedCoin.coin;
    const info = infoForCoin(c);
    return `<div class="forced-coin" data-unit-type="${c}">
      <span class="forced-icon" style="--accent:${info.accent}">${unitIconSvg(c)}</span>
      <div><span>전투 사제 추가 코인</span><strong>${esc(coinLabel(c))}</strong><small>지금 즉시 사용해야 합니다.</small></div>
    </div>`;
  }
  return state.players.human.hand.map((coin, index) => {
    const info = infoForCoin(coin);
    return `<button class="coin-button ${index === selectedCoinIndex ? 'selected' : ''}" data-coin-index="${index}" data-unit-type="${coin}" style="--accent:${info.accent}"><span class="coin-face">${unitIconSvg(coin)}</span><span>${esc(coinLabel(coin))}</span></button>`;
  }).join('');
}

function humanCandidates(): ActionCandidate[] {
  if (!state || state.activePlayer !== 'human' || state.winner) return [];
  if (state.pending) return generatePendingActions(state);
  if (state.forcedCoin?.player === 'human') return generateActionsForCoin(state, 'human', state.forcedCoin.coin, 'FORCED');
  const hand = state.players.human.hand;
  if (!hand.length) return [];
  selectedCoinIndex = Math.max(0, Math.min(selectedCoinIndex, hand.length - 1));
  return generateActionsForCoin(state, 'human', hand[selectedCoinIndex], 'HAND', selectedCoinIndex);
}

function renderActionPanel(actions: ActionCandidate[] = []): string {
  if (!state) return '';
  if (state.winner) {
    const win = state.winner === 'human';
    return `<div class="result-card ${win ? 'win' : 'lose'}"><div class="eyebrow">GAME OVER</div><h2>${win ? '승리!' : '패배'}</h2><p>${win ? 'Control Marker 6개를 모두 배치했습니다.' : '봇이 먼저 6개 Location을 장악했습니다.'}</p><button id="againBtn" class="primary">새 게임</button></div>`;
  }
  if (state.activePlayer === 'bot') {
    return `<div class="thinking-card"><div class="bot-pulse"></div><div><strong>${difficultyLabel(difficulty)} 봇이 계산 중...</strong><p>오른쪽 플레이어 영역의 공개 정보는 계속 확인할 수 있습니다.</p></div></div>`;
  }
  const grouped = new Map<string, ActionCandidate[]>();
  for (const action of actions) {
    if (!grouped.has(action.group)) grouped.set(action.group, []);
    grouped.get(action.group)!.push(action);
  }
  const groupsHtml = [...grouped.entries()].map(([group, items]) => `
    <details class="action-group" open>
      <summary>${esc(group)} <span>${items.length}</span></summary>
      <div class="action-buttons">${items.map((a) => `<button class="action-btn" data-action-id="${a.id}">${esc(a.label)}</button>`).join('')}</div>
    </details>`).join('');
  const selected = state.forcedCoin?.player === 'human'
    ? state.forcedCoin.coin
    : state.players.human.hand[selectedCoinIndex];
  const selectedInfo = selected ? infoForCoin(selected) : null;
  const context = state.pending
    ? '특수 능력의 후속 행동을 선택하세요.'
    : state.forcedCoin
      ? '전투 사제가 뽑은 코인을 즉시 사용하세요.'
      : '왼쪽 HAND의 동전을 선택하면 가능한 행동만 표시됩니다.';
  return `<div class="action-header"><div class="eyebrow">YOUR TURN · ROUND ${state.round}</div><h2>행동 선택</h2><p>${esc(context)}</p></div>${selected && selectedInfo ? `<div class="selected-action-coin" style="--coin-accent:${selectedInfo.accent}" data-unit-type="${selected}"><span class="table-coin front static"><span class="table-coin-inner">${unitIconSvg(selected)}</span></span><div><small>선택한 코인</small><strong>${esc(coinLabel(selected))}</strong></div></div>` : ''}<div class="action-scroll">${groupsHtml || '<p class="muted">가능한 행동이 없습니다.</p>'}</div>`;
}


function boardStrength(id: PlayerId): number {
  return state?.boardUnits.filter((u) => u.owner === id).reduce((n, u) => n + u.strength, 0) ?? 0;
}

function locationThreats(id: PlayerId): number {
  if (!state) return 0;
  const foe: PlayerId = id === 'human' ? 'bot' : 'human';
  return ALL_LOCATIONS.filter((h) => state!.locations[h] !== id && state!.boardUnits.some((u) => u.owner === id && distance(u.hex, h) <= 1) && !state!.boardUnits.some((u) => u.owner === foe && u.hex === h)).length;
}


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


function renderBotThought(): string {
  if (!lastBotThought) return `<section class="bot-thought"><div class="eyebrow">BOT EXPLAIN</div><h3>No decision yet</h3><p>The bot's reason and alternatives appear here after its turn.</p></section>`;
  return `<section class="bot-thought"><div class="eyebrow">BOT EXPLAIN · ROUND ${lastBotThought.round}</div><h3>${formatGameText(lastBotThought.label)}</h3><p>${formatGameText(lastBotThought.reason)}</p><details><summary>Top alternatives</summary><ol>${lastBotThought.alternatives.map((a) => `<li><span>${formatGameText(a.label)}</span><b>${Math.round(a.score)}</b></li>`).join('')}</ol></details></section>`;
}


function renderLog(): string {
  if (!state) return '';
  const entries = [...state.log].slice(-12).reverse();
  return `<section class="log-panel"><div class="eyebrow">BATTLE LOG</div><h3>Recent actions</h3><ol>${entries.map((x) => `<li>${formatGameText(x)}</li>`).join('')}</ol></section>`;
}


function renderHeaderControls(actions: ActionCandidate[] = []): string {
  if (!state) return '';
  const active = state.activePlayer === 'human' ? 'YOUR TURN' : 'BOT TURN';
  const claim = actions.find((a) => a.kind === 'CLAIM_INITIATIVE');
  const owner = state.initiative === 'human' ? 'YOU' : 'BOT';
  return `<div class="header-game-meta"><span class="round-chip">ROUND <b>${state.round}</b></span><span class="turn-chip ${state.activePlayer}">${active}</span><button type="button" id="claimInitiativeToken" class="initiative-token-control ${state.initiative === 'human' ? 'human-owned' : 'bot-owned'} ${claim ? 'actionable' : ''}" ${claim ? '' : 'disabled'}><span class="initiative-medallion">◆</span><span>${gameTerm('Initiative')} <b>${owner}</b></span></button><span class="difficulty-chip">BOT ${difficultyLabel(difficulty)}</span></div><div class="utility-toolbar"><button type="button" class="utility-toggle ${utilityPanel === 'analysis' ? 'active' : ''}" data-utility="analysis">◎ ANALYSIS</button><button type="button" class="utility-toggle ${utilityPanel === 'bot' ? 'active' : ''}" data-utility="bot">◇ BOT</button><button type="button" class="utility-toggle ${utilityPanel === 'log' ? 'active' : ''}" data-utility="log">≡ LOG</button></div>`;
}

function renderBotLastAction(): string {
  if (!lastBotThought) return '<div class="bot-last-action idle"><span>BOT LAST ACTION</span><strong>Waiting for the bot to act</strong></div>';
  return `<div class="bot-last-action"><span>BOT LAST ACTION · ROUND ${lastBotThought.round}</span><strong>${formatGameText(lastBotThought.label)}</strong><small>${formatGameText(lastBotThought.reason)}</small></div>`;
}

function renderGameHeader(): string {
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

function renderUtilityDrawer(): string {
  if (!utilityPanel) return '';
  const content = utilityPanel === 'analysis' ? renderAnalysis() : utilityPanel === 'bot' ? renderBotThought() : renderLog();
  return `<aside class="utility-drawer"><button type="button" class="utility-close" id="utilityClose" aria-label="닫기">×</button>${content}</aside>`;
}


function undoLastHumanTurn(): void {
  if (botBusy || undoStack.length === 0) return;
  const previous = undoStack.pop();
  if (!previous) return;
  state = cloneState(previous);
  lastBotThought = null;
  botThoughtHistory.pop();
  selectedCoinIndex = 0;
  boardPath = [];
  previewHexes.clear();
  saveState();
  render();
}


function renderGame(): void {
  if (!state) return;
  const actions = state.activePlayer === 'human' && !state.winner ? humanCandidates() : [];
  const sanity = stateSanity(state);
  app.innerHTML = `<main class="game-shell">
    <header class="topbar compact integrated-header"><div class="brand-lockup"><div class="eyebrow">LOCAL SOLO · DIRECT TABLE INPUT</div><h1>War Chest Solo</h1></div><div class="header-center">${renderHeaderControls(actions)}${renderBotLastAction()}</div><div class="topbar-actions"><button id="undoBtn" class="ghost" ${undoStack.length && !botBusy ? '' : 'disabled'}>↶ Undo</button><button id="rulesBtn" class="ghost">Rules</button><button id="restartBtn" class="ghost danger">Restart</button></div></header>
    ${sanity.length ? `<div class="debug-warning">State warning: ${esc(sanity.join(' / '))}</div>` : ''}
    <section class="workspace-grid direct-table-layout">
      <aside class="left-rail player-rail bot-side">${renderPlayerPanel('bot', actions)}</aside>
      <section class="board-stage"><div class="board-panel"><div class="board-title"><div><div class="eyebrow">BATTLEFIELD</div><h2>2-Player Battlefield</h2></div><div class="board-legend"><span><i class="legend-dot bot"></i>BOT</span><span><i class="legend-dot human"></i>YOU</span><span><i class="legend-location"></i>LOCATION</span></div></div><div id="boardHost">${renderBoardSvg(actions)}</div>${renderInteractionHud(actions)}</div></section>
      <aside class="right-rail player-rail human-side">${renderPlayerPanel('human', actions)}</aside>
    </section>
    ${renderUtilityDrawer()}
    <dialog id="rulesDialog" class="rules-dialog"><form method="dialog"><button class="dialog-close">×</button></form><div class="eyebrow">QUICK RULES</div><h2>Core actions</h2><p>Draw up to 3 Coins each Round and alternate spending one Coin at a time.</p><ul><li>${gameTerm('Deploy')} / ${gameTerm('Bolster')}: place the Unit Coin on an empty controlled Location (Scout is the adjacency exception).</li><li>Face-down: ${gameTerm('Claim Initiative')}, ${gameTerm('Recruit')}, ${gameTerm('Pass')}.</li><li>Face-up ${gameTerm('Maneuver')}: ${gameTerm('Move')}, ${gameTerm('Attack')}, ${gameTerm('Control')}, or ${gameTerm('Tactic')}.</li><li>Win immediately after placing all 6 Control Markers.</li></ul></dialog>
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rememberBotDecision(decision: BotDecision): void {
  if (!state) return;
  const thought: BotThought = { round: state.round, label: decision.action.label, reason: decision.reason, score: decision.score, alternatives: decision.alternatives };
  lastBotThought = thought;
  botThoughtHistory.push(thought);
  if (botThoughtHistory.length > 30) botThoughtHistory.shift();
}

async function runBot(): Promise<void> {
  if (!state || botBusy || state.activePlayer !== 'bot' || state.winner) return;
  botBusy = true;
  try {
    let guard = 0;
    while (state && state.activePlayer === 'bot' && !state.winner && guard < 30) {
      guard += 1;
      await sleep(difficulty === 'HARD' ? 520 : difficulty === 'EASY' ? 260 : 400);
      const decision = chooseBotDecision(state, difficulty);
      if (!decision) {
        afterResolvedAction(state);
        break;
      }
      rememberBotDecision(decision);
      executeAction(state, decision.action);
      afterResolvedAction(state);
      saveState();
      renderGame();
    }
  } catch (error) {
    console.error(error);
    alert(`봇 처리 중 오류: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    botBusy = false;
    render();
  }
}

function render(): void {
  if (!state) renderSetup();
  else {
    renderGame();
    if (state.activePlayer === 'bot' && !state.winner) void runBot();
  }
}

render();
