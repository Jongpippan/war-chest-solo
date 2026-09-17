export const BOARD_RADIUS = 3;
export const DIRECTIONS = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 },
];
export const hexId = (q, r) => `${q},${r}`;
export const parseHex = (id) => {
    const [q, r] = id.split(',').map(Number);
    return { q, r };
};
export function isOnBoard(q, r) {
    const s = -q - r;
    return Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) <= BOARD_RADIUS;
}
export const BOARD_HEXES = (() => {
    const out = [];
    for (let q = -BOARD_RADIUS; q <= BOARD_RADIUS; q += 1) {
        for (let r = -BOARD_RADIUS; r <= BOARD_RADIUS; r += 1) {
            if (isOnBoard(q, r))
                out.push(hexId(q, r));
        }
    }
    return out;
})();
export function neighbors(id) {
    const c = parseHex(id);
    return DIRECTIONS
        .map((d) => hexId(c.q + d.q, c.r + d.r))
        .filter((x) => BOARD_HEXES.includes(x));
}
export function distance(a, b) {
    const A = parseHex(a);
    const B = parseHex(b);
    const dq = A.q - B.q;
    const dr = A.r - B.r;
    const ds = (-A.q - A.r) - (-B.q - B.r);
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
}
export function stepInDirection(start, directionIndex, steps) {
    const c = parseHex(start);
    const d = DIRECTIONS[directionIndex];
    const q = c.q + d.q * steps;
    const r = c.r + d.r * steps;
    return isOnBoard(q, r) ? hexId(q, r) : null;
}
// Two-player layout matched to the physical base-game board.
// The 37 light central hexes are active; the dark outer side clusters are not used in 2-player.
// Coordinates are axial and rendered flat-top in main.ts.
export const HUMAN_STARTS = [hexId(-2, 3), hexId(1, 2)];
export const BOT_STARTS = [hexId(-1, -2), hexId(2, -3)];
export const NEUTRAL_LOCATIONS = [
    hexId(-2, 0),
    hexId(2, 0),
    hexId(1, -1),
    hexId(-1, 1),
    hexId(3, -2),
    hexId(-3, 2),
];
export const ALL_LOCATIONS = [...HUMAN_STARTS, ...BOT_STARTS, ...NEUTRAL_LOCATIONS];
export function initialLocations() {
    const out = {};
    for (const id of ALL_LOCATIONS)
        out[id] = null;
    for (const id of HUMAN_STARTS)
        out[id] = 'human';
    for (const id of BOT_STARTS)
        out[id] = 'bot';
    return out;
}
export function coordinateLabel(id) {
    const { q, r } = parseHex(id);
    return `(${q},${r})`;
}
