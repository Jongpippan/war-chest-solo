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

function esc(value: string): string {
  return value.replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]!));
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
    { kind: 'TACTIC', title: '전술', text: '정확히 2칸 떨어진 적 유닛을 공격한다. 중간 칸에는 유닛이 있어도 된다.' },
    { kind: 'RESTRICTION', title: '제한', text: '궁수는 일반 공격을 할 수 없고 이 전술로만 공격한다.' },
  ],
  BERSERKER: [
    { kind: 'ATTRIBUTE', title: '속성', text: '기동 후 자신의 스택에서 코인 1개를 제거하면 즉시 추가 기동 1회를 할 수 있다.' },
    { kind: 'RESTRICTION', title: '제한', text: '스택의 마지막 코인은 이 효과로 제거할 수 없다.' },
  ],
  CAVALRY: [
    { kind: 'TACTIC', title: '전술', text: '1칸 이동한 뒤, 새 위치에서 인접한 적을 공격한다.' },
  ],
  CROSSBOWMAN: [
    { kind: 'TACTIC', title: '전술', text: '직선으로 정확히 2칸 떨어진 적을 공격한다. 중간 칸은 비어 있어야 한다.' },
    { kind: 'ATTRIBUTE', title: '일반 공격', text: '인접한 적에 대한 일반 공격도 가능하다.' },
  ],
  ENSIGN: [
    { kind: 'TACTIC', title: '전술', text: '기수로부터 2칸 이내의 아군 1개가 일반 이동 1회를 한다.' },
    { kind: 'RESTRICTION', title: '제한', text: '이동 후에도 그 아군은 기수로부터 2칸 이내에 있어야 한다.' },
  ],
  FOOTMAN: [
    { kind: 'TACTIC', title: '전술', text: '보드 위의 각 보병이 각각 기동 1회를 한다.' },
    { kind: 'ATTRIBUTE', title: '속성', text: '같은 보병 유닛을 최대 2개까지 동시에 배치할 수 있다.' },
  ],
  KNIGHT: [
    { kind: 'ATTRIBUTE', title: '속성', text: '강화된 유닛, 즉 스택이 2개 이상인 유닛에게만 공격받을 수 있다.' },
  ],
  LANCER: [
    { kind: 'TACTIC', title: '전술', text: '직선으로 1~2칸 이동한 뒤 같은 직선 방향의 인접한 적을 공격한다.' },
    { kind: 'RESTRICTION', title: '제한', text: '창기병은 일반 공격을 할 수 없다.' },
  ],
  LIGHT_CAVALRY: [
    { kind: 'TACTIC', title: '전술', text: '한 번의 전술로 2칸 이동한다.' },
    { kind: 'ATTRIBUTE', title: '일반 이동', text: '평소에는 다른 유닛처럼 일반 1칸 이동도 가능하다.' },
  ],
  MARSHALL: [
    { kind: 'TACTIC', title: '전술', text: '지휘관으로부터 2칸 이내의 아군 1개가 가능한 경우 일반 공격 1회를 한다.' },
  ],
  MERCENARY: [
    { kind: 'ATTRIBUTE', title: '속성', text: '용병 코인을 영입한 직후 보드에 용병이 있다면 무료 기동 1회를 할 수 있다.' },
  ],
  PIKEMAN: [
    { kind: 'ATTRIBUTE', title: '속성', text: '인접 유닛에게 공격받으면 공격자 스택에서도 코인 1개를 동시에 제거한다.' },
  ],
  ROYAL_GUARD: [
    { kind: 'TACTIC', title: '전술', text: 'Royal Coin을 사용해 최대 2칸 이동하고 자신이 지배하는 Location에 도착한다.' },
    { kind: 'ATTRIBUTE', title: '속성', text: '공격받을 때 보드 코인 대신 Supply의 근위병 코인 1개를 제거할 수 있다.' },
  ],
  SCOUT: [
    { kind: 'ATTRIBUTE', title: '속성', text: '일반 배치 지점뿐 아니라 아군 유닛과 인접한 빈 칸에도 배치할 수 있다.' },
  ],
  SWORDSMAN: [
    { kind: 'ATTRIBUTE', title: '속성', text: '공격을 해결한 뒤 선택적으로 일반 이동 1회를 할 수 있다.' },
  ],
  WARRIOR_PRIEST: [
    { kind: 'ATTRIBUTE', title: '속성', text: '공격 또는 점령 후 Bag에서 코인 1개를 뽑고 그 코인으로 즉시 행동한다.' },
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
  const p = diagramPoint;
  const P = (c: number, r: number) => p(c, r);
  let overlay = '';
  const a = P(1, 2), b = P(2, 1), c = P(3, 0), d = P(3, 2), e = P(4, 1), f = P(5, 2);

  switch (type) {
    case 'ARCHER':
      overlay = `${diagramMarker(a.x, a.y, 'self')}${diagramMarker(b.x, b.y, 'ally', '•')}${diagramMarker(c.x, c.y, 'enemy')}${diagramArrow(a.x + 7, a.y - 6, c.x - 7, c.y + 6, 'attack', true)}${diagramText(143, 112, '중간 칸 점유 가능', 'ok')}`;
      break;
    case 'BERSERKER':
      overlay = `${diagramMarker(a.x, a.y, 'self', '3')}${diagramMarker(d.x, d.y, 'self', '2')}${diagramMarker(f.x, f.y, 'self', '1')}${diagramArrow(a.x + 10, a.y, d.x - 10, d.y, 'move')}${diagramArrow(d.x + 10, d.y, f.x - 10, f.y, 'move')}${diagramText(92, 110, '−1 coin')}${diagramText(185, 110, '−1 coin')}`;
      break;
    case 'CAVALRY':
      overlay = `${diagramMarker(a.x, a.y, 'self')}${diagramMarker(d.x, d.y, 'empty')}${diagramMarker(e.x, e.y, 'enemy')}${diagramArrow(a.x + 10, a.y, d.x - 10, d.y, 'move')}${diagramArrow(d.x + 8, d.y - 6, e.x - 8, e.y + 6, 'attack')}${diagramText(123, 112, '이동 → 공격')}`;
      break;
    case 'CROSSBOWMAN':
      overlay = `${diagramMarker(a.x, a.y, 'self')}${diagramMarker(d.x, d.y, 'empty')}${diagramMarker(f.x, f.y, 'enemy')}${diagramArrow(a.x + 10, a.y, f.x - 10, f.y, 'attack')}${diagramText(116, 112, '중간 칸은 비어 있어야 함', 'warn')}`;
      break;
    case 'ENSIGN':
      overlay = `${diagramMarker(c.x, c.y, 'self', 'E')}${diagramMarker(d.x, d.y, 'ally')}${diagramMarker(e.x, e.y, 'empty')}${diagramArrow(d.x + 8, d.y - 5, e.x - 8, e.y + 5, 'move')}${diagramText(128, 112, '2칸 범위 안에서 아군 이동')}`;
      break;
    case 'FOOTMAN': {
      const g = P(1, 1), h = P(4, 2), g2 = P(2, 1), h2 = P(5, 2);
      overlay = `${diagramMarker(g.x, g.y, 'self', '1')}${diagramMarker(h.x, h.y, 'self', '2')}${diagramMarker(g2.x, g2.y, 'empty')}${diagramMarker(h2.x, h2.y, 'empty')}${diagramArrow(g.x + 9, g.y, g2.x - 9, g2.y, 'move')}${diagramArrow(h.x + 9, h.y, h2.x - 9, h2.y, 'move')}${diagramText(127, 112, '두 보병이 각각 기동')}`;
      break;
    }
    case 'KNIGHT':
      overlay = `${diagramMarker(d.x, d.y, 'self', 'K')}${diagramMarker(a.x, a.y, 'enemy', '1')}${diagramMarker(e.x, e.y, 'enemy', '2')}${diagramArrow(a.x + 9, a.y, d.x - 9, d.y, 'attack')}${diagramArrow(e.x - 9, e.y + 4, d.x + 9, d.y - 4, 'attack')}${diagramText(36, 111, '×', 'blocked')}${diagramText(186, 111, '✓', 'ok')}`;
      break;
    case 'LANCER':
      overlay = `${diagramMarker(P(0,2).x, P(0,2).y, 'self')}${diagramMarker(a.x, a.y, 'empty')}${diagramMarker(d.x, d.y, 'empty')}${diagramMarker(f.x, f.y, 'enemy')}${diagramArrow(P(0,2).x + 9, P(0,2).y, d.x - 9, d.y, 'move')}${diagramArrow(d.x + 9, d.y, f.x - 9, f.y, 'attack')}${diagramText(108, 112, '직선 이동 후 같은 방향 공격')}`;
      break;
    case 'LIGHT_CAVALRY':
      overlay = `${diagramMarker(a.x, a.y, 'self')}${diagramMarker(d.x, d.y, 'empty')}${diagramMarker(f.x, f.y, 'empty')}${diagramArrow(a.x + 9, a.y, d.x - 9, d.y, 'move')}${diagramArrow(d.x + 9, d.y, f.x - 9, f.y, 'move')}${diagramText(129, 112, '2칸 이동')}`;
      break;
    case 'MARSHALL':
      overlay = `${diagramMarker(c.x, c.y, 'self', 'M')}${diagramMarker(d.x, d.y, 'ally')}${diagramMarker(e.x, e.y, 'enemy')}${diagramArrow(d.x + 9, d.y - 4, e.x - 9, e.y + 4, 'attack')}${diagramText(126, 112, '2칸 내 아군에게 일반 공격 부여')}`;
      break;
    case 'MERCENARY':
      overlay = `${diagramMarker(P(0,1).x, P(0,1).y, 'location', '+')}${diagramText(18, 18, 'Recruit')}${diagramMarker(d.x, d.y, 'self')}${diagramMarker(e.x, e.y, 'empty')}${diagramArrow(P(0,1).x + 12, P(0,1).y, d.x - 12, d.y, 'effect', true)}${diagramArrow(d.x + 9, d.y - 4, e.x - 9, e.y + 4, 'move')}${diagramText(126, 112, '영입 직후 무료 기동')}`;
      break;
    case 'PIKEMAN':
      overlay = `${diagramMarker(d.x, d.y, 'self', 'P')}${diagramMarker(e.x, e.y, 'enemy')}${diagramArrow(e.x - 9, e.y + 4, d.x + 9, d.y - 4, 'attack')}${diagramArrow(d.x + 9, d.y - 8, e.x - 9, e.y - 2, 'effect', true)}${diagramText(138, 112, '공격자도 −1')}`;
      break;
    case 'ROYAL_GUARD':
      overlay = `${diagramMarker(P(0,1).x, P(0,1).y, 'location', '♛')}${diagramMarker(a.x, a.y, 'self')}${diagramMarker(f.x, f.y, 'location')}${diagramArrow(P(0,1).x + 11, P(0,1).y + 6, a.x - 11, a.y - 6, 'effect', true)}${diagramArrow(a.x + 9, a.y, f.x - 9, f.y, 'move')}${diagramText(128, 112, 'Royal Coin → 내 Location')}`;
      break;
    case 'SCOUT':
      overlay = `${diagramMarker(d.x, d.y, 'ally')}${diagramMarker(e.x, e.y, 'self', '+')}${diagramArrow(d.x + 9, d.y - 4, e.x - 9, e.y + 4, 'effect', true)}${diagramText(120, 112, '아군 인접 빈 칸에 배치')}`;
      break;
    case 'SWORDSMAN':
      overlay = `${diagramMarker(d.x, d.y, 'self')}${diagramMarker(e.x, e.y, 'enemy')}${diagramMarker(c.x, c.y, 'empty')}${diagramArrow(d.x + 9, d.y - 4, e.x - 9, e.y + 4, 'attack')}${diagramArrow(d.x - 3, d.y - 9, c.x + 3, c.y + 9, 'move', true)}${diagramText(123, 112, '공격 후 선택 이동')}`;
      break;
    case 'WARRIOR_PRIEST':
      overlay = `${diagramMarker(a.x, a.y, 'self')}${diagramMarker(d.x, d.y, 'enemy')}${diagramArrow(a.x + 9, a.y, d.x - 9, d.y, 'attack')}${diagramMarker(f.x, f.y, 'location', '+')}${diagramArrow(d.x + 12, d.y - 3, f.x - 12, f.y + 3, 'effect', true)}${diagramText(129, 112, '공격/점령 → 코인 1개 즉시 사용')}`;
      break;
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
  return `<div class="rule-sections">${UNIT_CARD_RULES[type].map((section) => `<div class="rule-section ${section.kind.toLowerCase()}"><span class="rule-kind">${section.title}</span><p>${esc(section.text)}</p></div>`).join('')}</div>`;
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
      return `<path ${svgPathAttrs()} d="M4 17h16l-1.3-7-3.2 3-3.5-5-3.5 5-3.2-3L4 17Z"/><path ${svgPathAttrs()} d="M6 19h12"/><circle cx="5" cy="6" r="1.1" fill="currentColor"/><circle cx="12" cy="4.5" r="1.1" fill="currentColor"/><circle cx="19" cy="6" r="1.1" fill="currentColor"/>`;
    case 'ARCHER':
      return `<path ${svgPathAttrs()} d="M16.5 4.5c-5 2.2-8.3 6-9 10.8"/><path ${svgPathAttrs()} d="M7.5 15.3c1.3-1.6 3.8-2.6 7.3-2.6"/><path ${svgPathAttrs()} d="M5 12h13.2"/><path ${svgPathAttrs()} d="M17.6 9.5 20 12l-2.4 2.5"/>`;
    case 'BERSERKER':
      return `<path ${svgPathAttrs()} d="M6 19 18 7"/><path ${svgPathAttrs()} d="M13 5h5v5"/><path ${svgPathAttrs()} d="M5 14.5 9.5 19H5z" fill="currentColor" stroke="none"/>`;
    case 'CAVALRY':
      return `<path ${svgPathAttrs()} d="M8 18c0-3.2 2.5-4.8 4.5-6.4 1.8-1.3 3.3-2.2 3.3-4.4 1.2.2 2.7 1.1 3.2 2.4"/><path ${svgPathAttrs()} d="M9 8.2 13 6l3 2"/><path ${svgPathAttrs()} d="M11.2 14.8h5.3"/>`;
    case 'CROSSBOWMAN':
      return `<path ${svgPathAttrs()} d="M4.8 15.5c2.6-3.6 7.4-5.4 14.4-5.4"/><path ${svgPathAttrs()} d="M7 8.2v7.6"/><path ${svgPathAttrs()} d="M10.2 12h9.4"/><path ${svgPathAttrs()} d="M18.2 10.2 20.5 12l-2.3 1.8"/>`;
    case 'ENSIGN':
      return `<path ${svgPathAttrs()} d="M7 20V4.5"/><path ${svgPathAttrs()} d="M8.3 5.2h9l-2.2 3.3 2.2 3.3h-9Z" fill="currentColor" stroke="none"/><path ${svgPathAttrs()} d="M5 20h4"/>`;
    case 'FOOTMAN':
      return `<path ${svgPathAttrs()} d="M12 4.5 18 7v5.8c0 3.4-2.4 5.8-6 6.7-3.6-.9-6-3.3-6-6.7V7Z"/><path ${svgPathAttrs()} d="M9.3 11.5h5.4"/><path ${svgPathAttrs()} d="M12 8.8v5.4"/>`;
    case 'KNIGHT':
      return `<path ${svgPathAttrs()} d="M9 18.5h8"/><path ${svgPathAttrs()} d="M8.4 18.5c.3-5.5 2.2-9.4 6.5-12.2 1.8.5 3.7 1.8 4.1 4.3-2.5.5-4.3 1.2-5.8 2.5"/><path ${svgPathAttrs()} d="M13.2 8.8h3.2"/>`;
    case 'LANCER':
      return `<path ${svgPathAttrs()} d="M5 18.8 17 6.8"/><path ${svgPathAttrs()} d="M15.8 5.8 20 4l-1.8 4.2"/><path ${svgPathAttrs()} d="M4.7 19.3 8.7 15.3"/>`;
    case 'LIGHT_CAVALRY':
      return `<path ${svgPathAttrs()} d="M7.7 18c0-2.8 2.4-4.5 4.7-6.1 1.7-1.2 3-2.1 3.1-4.2 1.3.2 2.8 1.1 3.6 2.7"/><path ${svgPathAttrs()} d="M7 9.5c1.8-1.6 3.5-2.4 5.2-2.8"/><path ${svgPathAttrs()} d="M14 8c1 .1 2.2.6 3.5 1.8"/><path ${svgPathAttrs()} d="M12 6.2 14.6 3.8"/>`;
    case 'MARSHALL':
      return `<path ${svgPathAttrs()} d="M12 4.5 13.8 9l4.7.4-3.6 3 1.1 4.6-4-2.4-4 2.4 1.1-4.6-3.6-3 4.7-.4Z"/><path ${svgPathAttrs()} d="M18.2 18.2 21 21"/>`;
    case 'MERCENARY':
      return `<path ${svgPathAttrs()} d="M7 7 17 17"/><path ${svgPathAttrs()} d="M17 7 7 17"/><path ${svgPathAttrs()} d="M8.7 5.2H5.5v3.2"/><path ${svgPathAttrs()} d="M18.5 5.2h-3.2v3.2"/>`;
    case 'PIKEMAN':
      return `<path ${svgPathAttrs()} d="M4.5 19.5 18 6"/><path ${svgPathAttrs()} d="M16.6 4.7 20 4l-.7 3.4"/><path ${svgPathAttrs()} d="M7.8 15.8 10.7 18.7"/>`;
    case 'ROYAL_GUARD':
      return `<path ${svgPathAttrs()} d="M12 5.2 18 7.8v5.3c0 3.3-2.3 5.7-6 6.6-3.7-.9-6-3.3-6-6.6V7.8Z"/><path ${svgPathAttrs()} d="M8 7.4 10 9.1 12 6.7 14 9.1 16 7.4"/><path ${svgPathAttrs()} d="M9.2 12.5h5.6"/>`;
    case 'SCOUT':
      return `<path ${svgPathAttrs()} d="M3.8 12s3-4.8 8.2-4.8S20.2 12 20.2 12 17.2 16.8 12 16.8 3.8 12 3.8 12Z"/><circle cx="12" cy="12" r="2.3" fill="currentColor" stroke="none"/>`;
    case 'SWORDSMAN':
      return `<path ${svgPathAttrs()} d="M12 4.2v11.6"/><path ${svgPathAttrs()} d="M9.2 7 12 4.2 14.8 7"/><path ${svgPathAttrs()} d="M8.5 10.2h7"/><path ${svgPathAttrs()} d="M10.1 15.8h3.8"/><path ${svgPathAttrs()} d="M9.4 19.3h5.2"/>`;
    case 'WARRIOR_PRIEST':
      return `<circle cx="12" cy="12" r="3.1" ${svgPathAttrs()}/><path ${svgPathAttrs()} d="M12 4.2v3"/><path ${svgPathAttrs()} d="M12 16.8v3"/><path ${svgPathAttrs()} d="M4.2 12h3"/><path ${svgPathAttrs()} d="M16.8 12h3"/><path ${svgPathAttrs()} d="M6.5 6.5 8.8 8.8"/><path ${svgPathAttrs()} d="M15.2 15.2 17.5 17.5"/><path ${svgPathAttrs()} d="M17.5 6.5 15.2 8.8"/><path ${svgPathAttrs()} d="M8.8 15.2 6.5 17.5"/>`;
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
      <div class="rule-sections"><div class="rule-section note"><span class="rule-kind">용도</span><p>${esc(info.rules)}</p></div></div>
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
      <div class="diagram-caption">전술 / 이동 예시</div>
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
  return id === 'human' ? '당신' : '봇';
}

function unitCardMini(type: UnitType, owner: PlayerId): string {
  if (!state) return '';
  const d = UNIT_DEFS[type];
  const p = state.players[owner];
  const supply = p.supply[type] ?? 0;
  const boardStrength = state.boardUnits.filter((u) => u.owner === owner && u.type === type).reduce((n, u) => n + u.strength, 0);
  const removed = p.removed.filter((c) => c === type).length;
  return `<article class="mini-card" style="--accent:${d.accent}" data-unit-type="${type}" data-owner-label="${owner === 'human' ? '내 유닛' : '봇 유닛'}" data-supply="${supply}" data-board="${boardStrength}" data-removed="${removed}">
    <div class="mini-icon">${unitIconSvg(type)}</div>
    <div class="mini-copy"><strong>${esc(d.ko)}</strong><span>${esc(d.name)}</span></div>
    <div class="mini-stats"><span>S ${supply}</span><span>B ${boardStrength}</span><span>O ${removed}</span></div>
  </article>`;
}

function bagSummary(id: PlayerId): string {
  if (!state) return '';
  const p = state.players[id];
  if (id === 'bot') return `${p.bag.length}개`;
  const counts = new Map<string, number>();
  for (const coin of p.bag) counts.set(coin, (counts.get(coin) ?? 0) + 1);
  const detail = [...counts.entries()].map(([coin, count]) => `${coin === 'ROYAL' ? 'Royal' : UNIT_DEFS[coin as UnitType].ko}×${count}`).join(', ');
  return `${p.bag.length}개${detail ? ` · ${detail}` : ''}`;
}

function discardSummary(id: PlayerId): string {
  if (!state) return '';
  const p = state.players[id];
  const up = p.discard.filter((d) => d.faceUp).map((d) => coinLabel(d.coin));
  if (id === 'human') {
    const down = p.discard.filter((d) => !d.faceUp).map((d) => coinLabel(d.coin));
    return `앞면 ${up.length}${up.length ? ` (${up.join(', ')})` : ''} · 뒷면 ${down.length}${down.length ? ` (${down.join(', ')})` : ''}`;
  }
  return `앞면 ${up.length}${up.length ? ` (${up.join(', ')})` : ''} · 뒷면 ${p.discard.filter((d) => !d.faceUp).length}`;
}

function renderPlayerPanel(id: PlayerId): string {
  if (!state) return '';
  const p = state.players[id];
  const controlled = 6 - p.markersRemaining;
  const initiative = state.initiative === id ? '<span class="initiative-badge">Initiative</span>' : '';
  const hand = id === 'human' ? (p.hand.map((c) => coinLabel(c)).join(', ') || '없음') : `${p.hand.length}개 비공개`;
  return `<section class="player-panel ${id}">
    <div class="player-heading">
      <div>
        <div class="eyebrow">${id === 'human' ? 'PLAYER' : `BOT · ${difficultyLabel(difficulty).toUpperCase()}`}</div>
        <h2>${playerName(id)} ${initiative}</h2>
      </div>
      <div class="control-score"><strong>${controlled}</strong><span>/ 6</span></div>
    </div>
    <div class="resource-strip compact"><span><b>Hand</b>${esc(hand)}</span><span><b>Bag</b>${esc(bagSummary(id))}</span><span><b>Discard</b>${esc(discardSummary(id))}</span></div>
    <div class="mini-card-row compact-grid">${p.units.map((u) => unitCardMini(u, id)).join('')}</div>
  </section>`;
}

function axialToPixel(id: HexId): { x: number; y: number } {
  const { q, r } = parseHex(id);
  const size = 36;
  return {
    x: 480 + size * Math.sqrt(3) * (q + r / 2),
    y: 338 + size * 1.5 * r,
  };
}

function hexPoints(cx: number, cy: number, size = 31): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${(cx + size * Math.cos(angle)).toFixed(2)},${(cy + size * Math.sin(angle)).toFixed(2)}`);
  }
  return pts.join(' ');
}

function inactiveCluster(cx: number, cy: number, size = 28): string {
  const offsets = [
    [0, 0], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1],
  ];
  const pts = offsets.map(([q, r]) => {
    const x = cx + size * Math.sqrt(3) * (q + r / 2);
    const y = cy + size * 1.5 * r;
    return `<polygon points="${hexPoints(x, y, size - 2)}" fill="rgba(215,114,95,.55)" stroke="rgba(144,77,63,.45)" stroke-width="1.5"/>`;
  }).join('');
  return `<g class="inactive-cluster">${pts}</g>`;
}

function renderBoardSvg(): string {
  if (!state) return '';
  const hexes = BOARD_HEXES.map((id) => {
    const { x, y } = axialToPixel(id);
    const isLocation = ALL_LOCATIONS.includes(id);
    const controller = state!.locations[id];
    const unit = state!.boardUnits.find((u) => u.hex === id);
    const preview = previewHexes.has(id);
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
    if (unit) {
      const d = UNIT_DEFS[unit.type];
      const ownerFill = unit.owner === 'human' ? '#275e67' : '#853f47';
      unitMark = `<g class="token unit-token" data-unit-type="${unit.type}" data-owner-label="${unit.owner === 'human' ? '내 유닛' : '봇 유닛'}" data-stack="${unit.strength}" data-location="${coordinateLabel(id)}">
        <circle cx="${x}" cy="${y + 3}" r="27" fill="rgba(0,0,0,.18)"/>
        <circle cx="${x}" cy="${y}" r="27" fill="${ownerFill}" stroke="#f4e7c3" stroke-width="2.5"/>
        <circle cx="${x}" cy="${y}" r="21.5" fill="${d.accent}" stroke="rgba(255,255,255,.55)" stroke-width="1.5"/>
        ${tokenIconMarkup(unit.type, x, y, 22)}
        ${unit.strength > 1 ? `<g class="stack-badge"><circle cx="${x + 20}" cy="${y - 18}" r="11.5" fill="#fff5db" stroke="#453722" stroke-width="1.8"/><text x="${x + 20}" y="${y - 14}" text-anchor="middle" class="stack-count">${unit.strength}</text></g>` : ''}
      </g>`;
    }

    return `<g class="hex-cell ${preview ? 'preview' : ''}"><polygon points="${hexPoints(x, y)}" fill="${fill}" stroke="${preview ? '#f4c65d' : '#b59558'}" stroke-width="${preview ? 4 : 1.6}"/>${locationMark}${unitMark}</g>`;
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

function renderBoardOnly(): void {
  const board = document.querySelector<HTMLDivElement>('#boardHost');
  if (board) {
    board.innerHTML = renderBoardSvg();
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
    return `<div class="thinking-card"><div class="bot-pulse"></div><div><strong>${difficultyLabel(difficulty)} 봇이 계산 중...</strong><p>${difficulty === 'HARD' ? '후보 수를 가상 적용해 후속 보드까지 비교합니다.' : '현재 합법 행동 중 최선의 수를 고르는 중입니다.'}</p></div></div>`;
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
  const context = state.pending
    ? '특수 능력의 후속 행동을 선택하세요.'
    : state.forcedCoin
      ? '전투 사제가 뽑은 코인을 즉시 사용하세요.'
      : '손의 코인을 고르면 가능한 수만 표시됩니다. 버튼 Hover 시 관련 칸이 강조됩니다.';
  return `<div class="action-header"><div class="eyebrow">YOUR TURN · ROUND ${state.round}</div><h2>행동 선택</h2><p>${esc(context)}</p></div>${!state.pending ? `<div class="hand-row">${coinButtons()}</div>` : '<div class="ability-banner">특수 능력 해결 중</div>'}<div class="action-scroll">${groupsHtml || '<p class="muted">가능한 행동이 없습니다.</p>'}</div>`;
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
  let summary = '균형';
  const delta = (hLoc - bLoc) * 3 + (hStr - bStr) + (bOut - hOut) * .5;
  if (delta >= 3) summary = '당신 우세';
  else if (delta <= -3) summary = '봇 우세';
  return `<section class="analysis-panel"><div class="eyebrow">POSITION SNAPSHOT</div><div class="analysis-title"><h3>${summary}</h3><span>간이 비교</span></div><div class="metric-grid"><div><span>거점</span><b>${hLoc} : ${bLoc}</b></div><div><span>전력</span><b>${hStr} : ${bStr}</b></div><div><span>제거</span><b>${hOut} : ${bOut}</b></div><div><span>압박</span><b>${locationThreats('human')} : ${locationThreats('bot')}</b></div></div><p>왼쪽이 당신, 오른쪽이 봇입니다. Hover로 유닛 설명, 버튼 Hover로 경로를 확인하세요.</p></section>`;
}

function renderBotThought(): string {
  if (!lastBotThought) return `<section class="bot-thought"><div class="eyebrow">BOT EXPLAIN</div><h3>아직 수 설명이 없습니다</h3><p>봇이 수를 두면 선택 이유와 대안이 여기에 표시됩니다.</p></section>`;
  return `<section class="bot-thought"><div class="eyebrow">BOT EXPLAIN · ROUND ${lastBotThought.round}</div><h3>${esc(lastBotThought.label)}</h3><p>${esc(lastBotThought.reason)}</p><details><summary>상위 후보 비교</summary><ol>${lastBotThought.alternatives.map((a) => `<li><span>${esc(a.label)}</span><b>${Math.round(a.score)}</b></li>`).join('')}</ol></details></section>`;
}

function renderLog(): string {
  if (!state) return '';
  const entries = [...state.log].slice(-12).reverse();
  return `<section class="log-panel"><div class="eyebrow">BATTLE LOG</div><h3>최근 행동</h3><ol>${entries.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></section>`;
}

function renderStatusBar(): string {
  if (!state) return '';
  const active = state.activePlayer === 'human' ? '당신 차례' : '봇 차례';
  const initiative = state.initiative === 'human' ? '당신' : '봇';
  return `<div class="status-bar"><span><b>Round ${state.round}</b></span><span class="turn-pill ${state.activePlayer}">${active}</span><span>Initiative <b>${initiative}</b></span><span class="difficulty-chip">BOT ${difficultyLabel(difficulty)}</span></div>`;
}

function undoLastHumanTurn(): void {
  if (botBusy || undoStack.length === 0) return;
  const previous = undoStack.pop();
  if (!previous) return;
  state = cloneState(previous);
  lastBotThought = null;
  botThoughtHistory.pop();
  selectedCoinIndex = 0;
  previewHexes.clear();
  saveState();
  render();
}

function renderGame(): void {
  if (!state) return;
  const actions = state.activePlayer === 'human' && !state.winner ? humanCandidates() : [];
  const sanity = stateSanity(state);
  app.innerHTML = `<main class="game-shell">
    <header class="topbar compact"><div><div class="eyebrow">LOCAL SOLO · REDESIGNED</div><h1>War Chest Solo</h1></div><div class="topbar-actions"><button id="undoBtn" class="ghost" ${undoStack.length && !botBusy ? '' : 'disabled'}>↶ Undo</button><button id="rulesBtn" class="ghost">룰 메모</button><button id="restartBtn" class="ghost danger">처음부터</button></div></header>
    ${renderStatusBar()}
    ${sanity.length ? `<div class="debug-warning">상태 검사 경고: ${esc(sanity.join(' / '))}</div>` : ''}
    <section class="workspace-grid">
      <aside class="left-rail">
        ${renderPlayerPanel('bot')}
        ${renderPlayerPanel('human')}
        ${renderAnalysis()}
      </aside>
      <section class="board-stage">
        <div class="board-panel">
          <div class="board-title"><div><div class="eyebrow">BATTLEFIELD</div><h2>2인전 보드 레이아웃</h2></div><div class="board-legend"><span><i class="legend-dot human"></i>당신</span><span><i class="legend-dot bot"></i>봇</span><span><i class="legend-location"></i>Location</span></div></div>
          <div id="boardHost">${renderBoardSvg()}</div>
          <div class="board-footnote">공식 보드 실루엣을 참고해 재구성했습니다. 중앙 전장과 측면 2인 미사용 구역을 시각적으로 분리했습니다.</div>
        </div>
      </section>
      <aside class="right-rail">
        <section class="action-panel">${renderActionPanel(actions)}</section>
        ${renderBotThought()}
        ${renderLog()}
      </aside>
    </section>
    <dialog id="rulesDialog" class="rules-dialog"><form method="dialog"><button class="dialog-close">×</button></form><div class="eyebrow">QUICK RULES</div><h2>빠른 룰 메모</h2><p>한 라운드에 각자 코인 3개를 뽑고 Initiative 보유자부터 번갈아 1개씩 사용합니다.</p><ul><li><b>배치/강화:</b> 유닛 코인을 보드에 직접 놓습니다.</li><li><b>뒷면:</b> Initiative, Recruit, Pass.</li><li><b>앞면:</b> Move, Attack, Control, Tactic.</li><li><b>승리:</b> Control Marker 6개를 모두 보드에 놓으면 즉시 승리합니다.</li><li><b>공격:</b> 맞은 스택에서 코인 1개를 게임에서 제거합니다.</li></ul><p class="muted">Undo는 직전 당신의 주 행동 직전으로 돌아가며, 그 뒤 봇 응수까지 함께 취소합니다.</p></dialog>
    <div id="unitTooltip" class="unit-tooltip" hidden></div>
  </main>`;

  document.querySelector('#restartBtn')?.addEventListener('click', () => { if (confirm('현재 게임을 버리고 새로 시작할까요?')) newGameSetup(); });
  document.querySelector('#againBtn')?.addEventListener('click', newGameSetup);
  document.querySelector('#undoBtn')?.addEventListener('click', undoLastHumanTurn);
  document.querySelector('#rulesBtn')?.addEventListener('click', () => document.querySelector<HTMLDialogElement>('#rulesDialog')?.showModal());
  document.querySelectorAll<HTMLButtonElement>('.coin-button').forEach((btn) => btn.addEventListener('click', () => { selectedCoinIndex = Number(btn.dataset.coinIndex ?? 0); previewHexes.clear(); renderGame(); }));

  const actionMap = new Map(actions.map((a) => [a.id, a]));
  document.querySelectorAll<HTMLButtonElement>('.action-btn').forEach((btn) => {
    const action = actionMap.get(btn.dataset.actionId ?? '');
    if (!action) return;
    btn.addEventListener('mouseenter', () => { previewHexes = new Set(action.relatedHexes); renderBoardOnly(); });
    btn.addEventListener('mouseleave', () => { previewHexes.clear(); renderBoardOnly(); });
    btn.addEventListener('click', () => {
      if (!state) return;
      previewHexes.clear();
      try {
        if (action.source === 'HAND') undoStack.push(cloneState(state));
        executeAction(state, action);
        afterResolvedAction(state);
        selectedCoinIndex = 0;
        saveState();
        render();
      } catch (error) {
        console.error(error);
        alert(`행동 처리 중 오류: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  });

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
