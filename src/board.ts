import type { Coord, HexId, PlayerId } from './types.js';

export const BOARD_RADIUS = 3;
export const DIRECTIONS: Coord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export const hexId = (q: number, r: number): HexId => `${q},${r}`;
export const parseHex = (id: HexId): Coord => {
  const [q, r] = id.split(',').map(Number);
  return { q, r };
};

export function isOnBoard(q: number, r: number): boolean {
  const s = -q - r;
  return Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) <= BOARD_RADIUS;
}

export const BOARD_HEXES: HexId[] = (() => {
  const out: HexId[] = [];
  for (let q = -BOARD_RADIUS; q <= BOARD_RADIUS; q += 1) {
    for (let r = -BOARD_RADIUS; r <= BOARD_RADIUS; r += 1) {
      if (isOnBoard(q, r)) out.push(hexId(q, r));
    }
  }
  return out;
})();

export function neighbors(id: HexId): HexId[] {
  const c = parseHex(id);
  return DIRECTIONS
    .map((d) => hexId(c.q + d.q, c.r + d.r))
    .filter((x) => BOARD_HEXES.includes(x));
}

export function distance(a: HexId, b: HexId): number {
  const A = parseHex(a);
  const B = parseHex(b);
  const dq = A.q - B.q;
  const dr = A.r - B.r;
  const ds = (-A.q - A.r) - (-B.q - B.r);
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
}

export function stepInDirection(start: HexId, directionIndex: number, steps: number): HexId | null {
  const c = parseHex(start);
  const d = DIRECTIONS[directionIndex];
  const q = c.q + d.q * steps;
  const r = c.r + d.r * steps;
  return isOnBoard(q, r) ? hexId(q, r) : null;
}

// Symmetric 2-player layout on the 37-hex central battlefield.
// It mirrors the physical board's structure: two starting locations per side + six neutral locations.
export const HUMAN_STARTS: HexId[] = [hexId(0, 3), hexId(-2, 3)];
export const BOT_STARTS: HexId[] = [hexId(0, -3), hexId(2, -3)];
export const NEUTRAL_LOCATIONS: HexId[] = [
  hexId(-2, 0),
  hexId(2, 0),
  hexId(0, -1),
  hexId(0, 1),
  hexId(2, -1),
  hexId(-2, 1),
];
export const ALL_LOCATIONS = [...HUMAN_STARTS, ...BOT_STARTS, ...NEUTRAL_LOCATIONS];

export function initialLocations(): Record<HexId, PlayerId | null> {
  const out: Record<HexId, PlayerId | null> = {};
  for (const id of ALL_LOCATIONS) out[id] = null;
  for (const id of HUMAN_STARTS) out[id] = 'human';
  for (const id of BOT_STARTS) out[id] = 'bot';
  return out;
}

export function coordinateLabel(id: HexId): string {
  const { q, r } = parseHex(id);
  return `(${q},${r})`;
}
