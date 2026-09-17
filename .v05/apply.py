from pathlib import Path
import re

root = Path('.')
main_path = root / 'src/main.ts'
data_path = root / 'src/data.ts'

main = main_path.read_text()

rules = r'''const UNIT_CARD_RULES: Record<UnitType, RuleSection[]> = {
  ARCHER: [
    { kind: 'TACTIC', title: '전술', text: '정확히 2칸 떨어진 적 유닛을 공격한다. 사이 칸에 유닛이 있어도 된다.' },
    { kind: 'RESTRICTION', title: '제한', text: '궁수는 일반 공격을 할 수 없고 이 전술로만 공격한다.' },
  ],
  BERSERKER: [
    { kind: 'ATTRIBUTE', title: '속성', text: '기동 후 자신의 스택에서 코인 1개를 제거하면 즉시 같은 유닛으로 추가 기동 1회를 할 수 있다.' },
    { kind: 'RESTRICTION', title: '제한', text: '스택의 마지막 코인은 이 효과로 제거할 수 없다.' },
  ],
  CAVALRY: [
    { kind: 'TACTIC', title: '전술', text: '1칸 이동한 뒤, 새 위치에서 인접한 적을 공격한다.' },
  ],
  CROSSBOWMAN: [
    { kind: 'TACTIC', title: '전술', text: '직선으로 정확히 2칸 떨어진 적을 공격한다. 사이 칸은 비어 있어야 한다.' },
    { kind: 'ATTRIBUTE', title: '일반 공격', text: '인접한 적에 대한 일반 공격도 가능하다.' },
  ],
  ENSIGN: [
    { kind: 'TACTIC', title: '전술', text: '기수로부터 2칸 이내의 다른 아군 1개가 일반 이동 1회를 한다.' },
    { kind: 'RESTRICTION', title: '제한', text: '이동 후에도 그 아군은 기수로부터 2칸 이내에 있어야 한다.' },
  ],
  FOOTMAN: [
    { kind: 'TACTIC', title: '전술', text: '보드 위의 각 보병 유닛이 각각 기동 1회를 한다. 두 보병은 서로 다른 종류의 기동을 해도 된다.' },
    { kind: 'ATTRIBUTE', title: '속성', text: '같은 보병 유닛을 최대 2개까지 동시에 배치할 수 있다.' },
  ],
  KNIGHT: [
    { kind: 'ATTRIBUTE', title: '속성', text: '강화된 적 유닛, 즉 스택이 2개 이상인 유닛에게만 공격받을 수 있다.' },
  ],
  LANCER: [
    { kind: 'TACTIC', title: '전술', text: '직선으로 1~2칸 이동한 뒤 같은 직선 방향의 인접한 적을 공격한다. 전술을 쓸 때 합법적인 공격 대상이 반드시 있어야 한다.' },
    { kind: 'RESTRICTION', title: '제한', text: '창기병은 일반 공격을 할 수 없다.' },
  ],
  LIGHT_CAVALRY: [
    { kind: 'TACTIC', title: '전술', text: '한 번의 전술로 2칸 이동한다.' },
    { kind: 'ATTRIBUTE', title: '일반 이동', text: '평소에는 다른 유닛처럼 일반 1칸 이동도 가능하다.' },
  ],
  MARSHALL: [
    { kind: 'TACTIC', title: '전술', text: '지휘관으로부터 2칸 이내의 아군 1개가 일반 공격 1회를 한다.' },
    { kind: 'RESTRICTION', title: '제한', text: '전술 공격을 대신 실행시키는 것이 아니므로 궁수나 창기병처럼 일반 공격을 못 하는 유닛에는 사용할 수 없다.' },
  ],
  MERCENARY: [
    { kind: 'ATTRIBUTE', title: '속성', text: '용병 코인을 Recruit한 직후 보드에 용병이 있다면 그 용병이 무료 기동 1회를 할 수 있다.' },
    { kind: 'NOTE', title: '참고', text: '무료 기동은 Deploy나 Recruit 같은 다른 종류의 행동으로 바꿀 수 없다.' },
  ],
  PIKEMAN: [
    { kind: 'ATTRIBUTE', title: '속성', text: '인접 유닛에게 공격받으면 공격자 스택에서도 코인 1개를 동시에 제거한다.' },
    { kind: 'NOTE', title: '참고', text: '이 효과는 공격과 동시에 발생하며 공격이 아니다. 따라서 공격 중인 Knight에도 적용된다.' },
  ],
  ROYAL_GUARD: [
    { kind: 'TACTIC', title: '전술', text: 'Royal Coin을 버리고, 자신이 지배하는 Location에 도착하도록 최대 2칸 이동한다.' },
    { kind: 'ATTRIBUTE', title: '속성', text: '공격받을 때 보드 코인 대신 Supply의 근위병 코인 1개를 제거할 수 있다.' },
  ],
  SCOUT: [
    { kind: 'ATTRIBUTE', title: '속성', text: '일반 배치 지점뿐 아니라 아군 유닛과 인접한 빈 칸에도 배치할 수 있다.' },
  ],
  SWORDSMAN: [
    { kind: 'ATTRIBUTE', title: '속성', text: '공격을 해결한 뒤 선택적으로 일반 이동 1회를 할 수 있다.' },
  ],
  WARRIOR_PRIEST: [
    { kind: 'ATTRIBUTE', title: '속성', text: 'Attack 또는 Control 후 Bag에서 코인 1개를 뽑고 그 코인으로 즉시 행동한다.' },
    { kind: 'NOTE', title: '참고', text: '뽑은 코인은 반드시 즉시 사용해야 하며, 다른 행동을 할 수 없어도 Pass로 사용할 수 있다.' },
  ],
};'''

main, n = re.subn(
    r"const UNIT_CARD_RULES: Record<UnitType, RuleSection\[]> = \{.*?\n\};(?=\n\nfunction diagramHexPoints)",
    rules,
    main,
    count=1,
    flags=re.S,
)
assert n == 1, 'UNIT_CARD_RULES block not found'

icons = r'''function unitIconPaths(coin: UnitInfoKey): string {
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
}'''

main, n = re.subn(
    r"function unitIconPaths\(coin: UnitInfoKey\): string \{.*?\n\}(?=\n\nfunction unitIconSvg)",
    icons,
    main,
    count=1,
    flags=re.S,
)
assert n == 1, 'unitIconPaths block not found'

diagram = r'''function renderUnitDiagram(type: UnitType): string {
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
}'''

main, n = re.subn(
    r"function renderUnitDiagram\(type: UnitType\): string \{.*?\n\}(?=\n\nfunction ruleSectionsHtml)",
    diagram,
    main,
    count=1,
    flags=re.S,
)
assert n == 1, 'renderUnitDiagram block not found'

main_path.write_text(main)

data = data_path.read_text()
replacements = {
    "일반 공격 불가. 전술: 정확히 2칸 떨어진 적을 공격한다. 중간 칸에 유닛이 있어도 된다.": "전술: 정확히 2칸 떨어진 적을 공격한다. 사이 칸은 점유되어 있어도 된다. 제한: 일반 공격 불가.",
    "기동 후 자신의 스택에서 코인 1개를 제거하면 즉시 다시 기동할 수 있다. 마지막 코인은 제거할 수 없다.": "속성: 기동 후 스택 코인 1개를 제거해 같은 유닛으로 기동 1회를 추가한다. 마지막 코인은 제거할 수 없다.",
    "전술: 직선으로 정확히 2칸 떨어진 적을 공격한다. 중간 칸은 비어 있어야 한다. 일반 근접 공격도 가능하다.": "전술: 직선으로 정확히 2칸 떨어진 적을 공격한다. 사이 칸은 비어 있어야 한다. 일반 공격도 가능하다.",
    "전술: 2칸 이내의 아군 1개가 일반 이동 1회를 한다. 이동 후에도 기수로부터 2칸 이내여야 한다.": "전술: 2칸 이내의 다른 아군 1개가 일반 이동 1회를 한다. 이동 후에도 기수로부터 2칸 이내여야 한다.",
    "같은 보병 유닛을 최대 2개 배치할 수 있다. 전술: 보드의 각 보병이 각각 기동 1회를 한다.": "속성: 보드에 최대 2개의 보병 유닛을 둘 수 있다. 전술: 배치된 각 보병 유닛이 각각 기동 행동 1회를 한다.",
    "강화된(스택 2+) 유닛에게만 공격받을 수 있다.": "속성: 강화된 적 유닛(스택 2+)에게만 공격받을 수 있다.",
    "일반 공격 불가. 전술: 직선으로 1~2칸 이동하고 같은 직선 방향으로 인접한 적을 공격한다.": "전술: 직선으로 1~2칸 이동한 뒤 같은 직선 방향의 인접한 적을 공격한다. 제한: 일반 공격 불가.",
    "전술: 2칸 이동한다. 일반 1칸 이동도 가능하다.": "전술: 2칸 이동한다. 일반 이동 1칸도 가능하다.",
    "전술: 2칸 이내의 아군 1개가 가능한 경우 일반 공격 1회를 한다.": "전술: 2칸 이내의 아군 1개가 일반 공격 1회를 한다. 전술 공격을 대신 시킬 수는 없다.",
    "용병 코인을 영입한 뒤, 용병이 보드에 있다면 그 용병으로 무료 기동 1회를 할 수 있다.": "속성: Mercenary 코인을 Recruit 했을 때, 보드에 Mercenary가 있으면 그 유닛이 무료 기동 1회를 한다.",
    "인접 유닛에게 공격받으면 공격자 스택에서도 코인 1개를 동시에 제거한다.": "속성: 인접 유닛에게 공격받으면 공격자 스택에서도 코인 1개를 동시에 제거한다.",
    "전술: Royal Coin을 버리고 최대 2칸 이동해 자신이 지배하는 Location에 도착한다. 공격받을 때 보드 코인 대신 Supply의 근위병 코인을 제거할 수 있다.": "전술: Royal Coin을 버리고 자신이 지배하는 Location에 도달하도록 최대 2칸 이동한다. 속성: 공격받을 때 Supply의 근위병 코인을 대신 제거할 수 있다.",
    "일반 배치 지점 외에도 아군 유닛과 인접한 빈 칸에 배치할 수 있다.": "속성: 일반 배치 지점 외에도 아군 유닛과 인접한 빈 칸에 배치할 수 있다.",
    "공격한 뒤 선택적으로 일반 이동 1회를 할 수 있다.": "속성: 공격한 뒤 선택적으로 일반 이동 1회를 할 수 있다.",
    "공격 또는 점령 후 Bag에서 코인 1개를 뽑아 즉시 그 코인으로 행동한다.": "속성: Attack 또는 Control 후 Bag에서 코인 1개를 뽑아 즉시 사용한다.",
}
for old, new in replacements.items():
    data = data.replace(old, new)
data_path.write_text(data)
