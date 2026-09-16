import { ALL_LOCATIONS, distance } from './board.js';
import { UNIT_DEFS } from './data.js';
import {
  cloneState,
  executeAction,
  generateAllMainActions,
  generatePendingActions,
  getUnit,
  unitsOf,
} from './engine.js';
import type { ActionCandidate, BotDifficulty, GameState, HexId, PlayerId } from './types.js';

export type BotDecision = {
  action: ActionCandidate;
  reason: string;
  score: number;
  alternatives: { label: string; score: number }[];
};

function strategicLocationDistance(state: GameState, player: PlayerId, hex: HexId): number {
  const targets = ALL_LOCATIONS.filter((h) => state.locations[h] !== player);
  if (!targets.length) return 0;
  return Math.min(...targets.map((h) => distance(hex, h)));
}

function targetValue(state: GameState, targetId?: string): number {
  const target = targetId ? getUnit(state, targetId) : undefined;
  if (!target) return 0;
  let v = target.strength === 1 ? 250 : 110;
  if (Object.prototype.hasOwnProperty.call(state.locations, target.hex)) v += 70;
  if (target.type === 'WARRIOR_PRIEST' || target.type === 'KNIGHT') v += 25;
  return v;
}

function moveValue(state: GameState, unitId?: string, destination?: string): number {
  const unit = unitId ? getUnit(state, unitId) : undefined;
  if (!unit || !destination) return 0;
  const before = strategicLocationDistance(state, unit.owner, unit.hex);
  const after = strategicLocationDistance(state, unit.owner, destination);
  let score = (before - after) * 38;
  if (Object.prototype.hasOwnProperty.call(state.locations, destination) && state.locations[destination] !== unit.owner) score += 75;
  const enemyAdj = state.boardUnits.filter((u) => u.owner !== unit.owner && distance(destination, u.hex) === 1).length;
  score += enemyAdj * 12;
  return score;
}

export function scoreAction(state: GameState, action: ActionCandidate, randomize = true): number {
  let score = randomize ? Math.random() * 8 : 0;
  const p = action.player;
  const payload = action.payload;

  switch (action.kind) {
    case 'PASS': score -= 35; break;
    case 'CLAIM_INITIATIVE': score += 48; break;
    case 'RECRUIT': {
      score += 58;
      const type = payload.recruitType!;
      const deployed = unitsOf(state, p, type).length > 0;
      if (deployed) score += 18;
      if (type === 'MERCENARY' && deployed) score += 65;
      break;
    }
    case 'DEPLOY': {
      score += 120;
      if (payload.destination && Object.prototype.hasOwnProperty.call(state.locations, payload.destination) && state.locations[payload.destination] !== p) score += 40;
      score += 25 - strategicLocationDistance(state, p, payload.destination!) * 5;
      break;
    }
    case 'BOLSTER': {
      score += 80;
      const unit = getUnit(state, payload.unitId!);
      if (unit?.type === 'KNIGHT') score += 55;
      if (unit && state.boardUnits.some((u) => u.owner !== p && distance(unit.hex, u.hex) <= 2)) score += 40;
      break;
    }
    case 'MOVE':
    case 'FREE_MOVE':
    case 'TACTIC_LIGHT_CAVALRY':
    case 'TACTIC_ROYAL_GUARD':
      score += 55 + moveValue(state, payload.unitId, payload.destination);
      break;
    case 'CONTROL':
    case 'FREE_CONTROL': {
      const unit = getUnit(state, payload.unitId!);
      if (!unit) break;
      const owner = state.locations[unit.hex];
      score += owner && owner !== p ? 980 : 660;
      if (state.players[p].markersRemaining === 1) score += 10000;
      break;
    }
    case 'ATTACK':
    case 'FREE_ATTACK':
    case 'TACTIC_ARCHER':
    case 'TACTIC_CROSSBOWMAN':
      score += 180 + targetValue(state, payload.targetUnitId);
      break;
    case 'TACTIC_CAVALRY':
    case 'TACTIC_LANCER':
      score += 220 + targetValue(state, payload.targetUnitId) + moveValue(state, payload.unitId, payload.destination);
      break;
    case 'TACTIC_ENSIGN':
      score += 65 + moveValue(state, payload.grantedUnitId, payload.destination);
      break;
    case 'TACTIC_MARSHALL':
      score += 190 + targetValue(state, payload.targetUnitId);
      break;
    case 'TACTIC_FOOTMAN':
      score += 110 + unitsOf(state, p, 'FOOTMAN').length * 45;
      break;
    case 'SKIP_ABILITY':
      score -= 10;
      break;
  }

  const target = payload.targetUnitId ? getUnit(state, payload.targetUnitId) : undefined;
  if (target && Object.prototype.hasOwnProperty.call(state.locations, target.hex)) score += 35;
  return score;
}

function positionScore(state: GameState, player: PlayerId): number {
  const foe: PlayerId = player === 'human' ? 'bot' : 'human';
  const myLocations = 6 - state.players[player].markersRemaining;
  const foeLocations = 6 - state.players[foe].markersRemaining;
  const myStrength = state.boardUnits.filter((u) => u.owner === player).reduce((n, u) => n + u.strength, 0);
  const foeStrength = state.boardUnits.filter((u) => u.owner === foe).reduce((n, u) => n + u.strength, 0);
  const centerPressure = state.boardUnits
    .filter((u) => u.owner === player)
    .reduce((n, u) => n + Math.max(0, 3 - strategicLocationDistance(state, player, u.hex)), 0);
  let score = (myLocations - foeLocations) * 240 + (myStrength - foeStrength) * 32 + centerPressure * 8;
  if (state.winner === player) score += 100000;
  if (state.winner === foe) score -= 100000;
  return score;
}

function hardScore(state: GameState, action: ActionCandidate): number {
  let score = scoreAction(state, action, false);
  try {
    const before = positionScore(state, action.player);
    const simulated = cloneState(state);
    const copy = structuredClone(action);
    executeAction(simulated, copy);
    score += (positionScore(simulated, action.player) - before) * 1.35;

    // Hard bot values immediate threats to a location and avoids hanging lone units.
    const moved = copy.payload.destination ? simulated.boardUnits.find((u) => u.owner === action.player && u.hex === copy.payload.destination) : undefined;
    if (moved && moved.strength === 1) {
      const threats = simulated.boardUnits.filter((u) => u.owner !== action.player && distance(u.hex, moved.hex) === 1).length;
      score -= threats * 24;
    }
  } catch {
    score -= 5000;
  }
  return score;
}

function explainAction(state: GameState, action: ActionCandidate): string {
  const p = action.payload;
  switch (action.kind) {
    case 'CONTROL':
    case 'FREE_CONTROL': {
      const unit = p.unitId ? getUnit(state, p.unitId) : undefined;
      const owner = unit ? state.locations[unit.hex] : null;
      return owner === 'human' ? '당신이 가진 거점을 빼앗으면 점수 격차를 크게 벌릴 수 있어서 선택했습니다.' : '비어 있는 거점을 확보해 승리 조건에 가까워지기 위해 선택했습니다.';
    }
    case 'ATTACK':
    case 'FREE_ATTACK':
    case 'TACTIC_ARCHER':
    case 'TACTIC_CROSSBOWMAN':
    case 'TACTIC_CAVALRY':
    case 'TACTIC_LANCER':
    case 'TACTIC_MARSHALL': {
      const target = p.targetUnitId ? getUnit(state, p.targetUnitId) : undefined;
      if (target?.strength === 1) return '한 번의 공격으로 유닛을 제거할 수 있어 교환 가치가 높습니다.';
      if (target && Object.prototype.hasOwnProperty.call(state.locations, target.hex)) return '거점 위의 적을 약화시키면 다음 점령 싸움이 유리해집니다.';
      return '현재 가능한 공격 중 적 전력을 가장 효율적으로 줄일 수 있는 수입니다.';
    }
    case 'DEPLOY': return '전장에 새 유닛을 투입해 행동 선택지와 거점 압박을 늘립니다.';
    case 'BOLSTER': return '전선의 유닛을 강화해 제거 위험을 낮추고 공격 조건을 개선합니다.';
    case 'RECRUIT': return `${p.recruitType ? UNIT_DEFS[p.recruitType].ko : '유닛'} 코인을 덱 순환에 추가해 이후 행동 빈도를 높입니다.`;
    case 'CLAIM_INITIATIVE': return '다음 라운드 선공권이 현재 보드 싸움에서 가치가 있다고 판단했습니다.';
    case 'MOVE':
    case 'FREE_MOVE':
    case 'TACTIC_LIGHT_CAVALRY':
    case 'TACTIC_ROYAL_GUARD':
    case 'TACTIC_ENSIGN': return '점령 가능한 Location과 교전 지점에 더 가까워지는 이동입니다.';
    case 'TACTIC_FOOTMAN': return '보병 여러 기를 한 코인으로 움직여 행동 효율을 높입니다.';
    case 'PASS': return '현재 코인을 다른 행동에 쓰는 가치가 낮아 덱 순환을 위해 넘겼습니다.';
    case 'SKIP_ABILITY': return '특수 후속 행동을 계속하면 오히려 위치나 전력이 나빠질 수 있어 종료했습니다.';
    default: return '현재 보드와 코인 상황에서 가장 높은 평가를 받은 행동입니다.';
  }
}

export function chooseBotDecision(state: GameState, difficulty: BotDifficulty = 'NORMAL'): BotDecision | null {
  const actions = state.pending ? generatePendingActions(state) : generateAllMainActions(state, 'bot');
  if (!actions.length) return null;

  const scored = actions.map((action) => {
    let score: number;
    if (difficulty === 'HARD') score = hardScore(state, action);
    else score = scoreAction(state, action, difficulty === 'EASY');
    return { action, score };
  }).sort((a, b) => b.score - a.score);

  let chosen = scored[0];
  if (difficulty === 'EASY') {
    // Easy deliberately samples among reasonable moves, which creates visible tactical mistakes.
    const pool = scored.slice(0, Math.min(6, scored.length));
    const weights = pool.map((_, i) => Math.max(1, 6 - i));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    for (let i = 0; i < pool.length; i += 1) {
      roll -= weights[i];
      if (roll <= 0) { chosen = pool[i]; break; }
    }
  }

  chosen.action.score = chosen.score;
  return {
    action: chosen.action,
    reason: explainAction(state, chosen.action),
    score: chosen.score,
    alternatives: scored.slice(0, 3).map((x) => ({ label: x.action.label, score: x.score })),
  };
}

export function chooseBotAction(state: GameState): ActionCandidate | null {
  return chooseBotDecision(state, 'NORMAL')?.action ?? null;
}
