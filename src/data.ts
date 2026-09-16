import type { UnitDefinition, UnitType } from './types.js';

export const UNIT_DEFS: Record<UnitType, UnitDefinition> = {
  ARCHER: {
    type: 'ARCHER', name: 'Archer', ko: '궁수', short: 'AR', coinCount: 4, accent: '#4c9d8b',
    rules: '일반 공격 불가. 전술: 정확히 2칸 떨어진 적을 공격한다. 중간 칸에 유닛이 있어도 된다.'
  },
  BERSERKER: {
    type: 'BERSERKER', name: 'Berserker', ko: '광전사', short: 'BE', coinCount: 5, accent: '#557c4a',
    rules: '기동 후 자신의 스택에서 코인 1개를 제거하면 즉시 다시 기동할 수 있다. 마지막 코인은 제거할 수 없다.'
  },
  CAVALRY: {
    type: 'CAVALRY', name: 'Cavalry', ko: '기병', short: 'CA', coinCount: 4, accent: '#b66d2d',
    rules: '전술: 1칸 이동한 뒤 인접한 적을 공격한다.'
  },
  CROSSBOWMAN: {
    type: 'CROSSBOWMAN', name: 'Crossbowman', ko: '석궁병', short: 'CB', coinCount: 5, accent: '#905265',
    rules: '전술: 직선으로 정확히 2칸 떨어진 적을 공격한다. 중간 칸은 비어 있어야 한다. 일반 근접 공격도 가능하다.'
  },
  ENSIGN: {
    type: 'ENSIGN', name: 'Ensign', ko: '기수', short: 'EN', coinCount: 5, accent: '#879b3f',
    rules: '전술: 2칸 이내의 아군 1개가 일반 이동 1회를 한다. 이동 후에도 기수로부터 2칸 이내여야 한다.'
  },
  FOOTMAN: {
    type: 'FOOTMAN', name: 'Footman', ko: '보병', short: 'FO', coinCount: 5, accent: '#198b8d',
    rules: '같은 보병 유닛을 최대 2개 배치할 수 있다. 전술: 보드의 각 보병이 각각 기동 1회를 한다.'
  },
  KNIGHT: {
    type: 'KNIGHT', name: 'Knight', ko: '기사', short: 'KN', coinCount: 4, accent: '#2390bd',
    rules: '강화된(스택 2+) 유닛에게만 공격받을 수 있다.'
  },
  LANCER: {
    type: 'LANCER', name: 'Lancer', ko: '창기병', short: 'LA', coinCount: 4, accent: '#cb4e3a',
    rules: '일반 공격 불가. 전술: 직선으로 1~2칸 이동하고 같은 직선 방향으로 인접한 적을 공격한다.'
  },
  LIGHT_CAVALRY: {
    type: 'LIGHT_CAVALRY', name: 'Light Cavalry', ko: '경기병', short: 'LC', coinCount: 5, accent: '#829c48',
    rules: '전술: 2칸 이동한다. 일반 1칸 이동도 가능하다.'
  },
  MARSHALL: {
    type: 'MARSHALL', name: 'Marshall', ko: '지휘관', short: 'MA', coinCount: 5, accent: '#9e5535',
    rules: '전술: 2칸 이내의 아군 1개가 가능한 경우 일반 공격 1회를 한다.'
  },
  MERCENARY: {
    type: 'MERCENARY', name: 'Mercenary', ko: '용병', short: 'ME', coinCount: 5, accent: '#8b3235',
    rules: '용병 코인을 영입한 뒤, 용병이 보드에 있다면 그 용병으로 무료 기동 1회를 할 수 있다.'
  },
  PIKEMAN: {
    type: 'PIKEMAN', name: 'Pikeman', ko: '장창병', short: 'PI', coinCount: 4, accent: '#c49a23',
    rules: '인접 유닛에게 공격받으면 공격자 스택에서도 코인 1개를 동시에 제거한다.'
  },
  ROYAL_GUARD: {
    type: 'ROYAL_GUARD', name: 'Royal Guard', ko: '근위병', short: 'RG', coinCount: 5, accent: '#c35e68',
    rules: '전술: Royal Coin을 버리고 최대 2칸 이동해 자신이 지배하는 Location에 도착한다. 공격받을 때 보드 코인 대신 Supply의 근위병 코인을 제거할 수 있다.'
  },
  SCOUT: {
    type: 'SCOUT', name: 'Scout', ko: '정찰병', short: 'SC', coinCount: 5, accent: '#2c7fb8',
    rules: '일반 배치 지점 외에도 아군 유닛과 인접한 빈 칸에 배치할 수 있다.'
  },
  SWORDSMAN: {
    type: 'SWORDSMAN', name: 'Swordsman', ko: '검병', short: 'SW', coinCount: 5, accent: '#375c91',
    rules: '공격한 뒤 선택적으로 일반 이동 1회를 할 수 있다.'
  },
  WARRIOR_PRIEST: {
    type: 'WARRIOR_PRIEST', name: 'Warrior Priest', ko: '전투 사제', short: 'WP', coinCount: 4, accent: '#71536f',
    rules: '공격 또는 점령 후 Bag에서 코인 1개를 뽑아 즉시 그 코인으로 행동한다.'
  },
};

export const ALL_UNITS = Object.keys(UNIT_DEFS) as UnitType[];

export const RECOMMENDED_HUMAN: UnitType[] = ['SWORDSMAN', 'PIKEMAN', 'CROSSBOWMAN', 'LIGHT_CAVALRY'];
export const RECOMMENDED_BOT: UnitType[] = ['ARCHER', 'CAVALRY', 'LANCER', 'SCOUT'];
