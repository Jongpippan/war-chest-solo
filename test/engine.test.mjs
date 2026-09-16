import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, generateActionsForCoin, executeAction, stateSanity, unitsOf } from '../dist/engine.js';
import { hexId } from '../dist/board.js';

const H = ['ARCHER', 'PIKEMAN', 'SCOUT', 'KNIGHT'];
const B = ['CROSSBOWMAN', 'CAVALRY', 'LANCER', 'ROYAL_GUARD'];

function cleanGame() {
  const s = createGame(H, B, 'human');
  s.players.human.hand = [];
  s.players.bot.hand = [];
  s.players.human.discard = [];
  s.players.bot.discard = [];
  s.boardUnits = [];
  s.pending = null;
  s.forcedCoin = null;
  return s;
}

function put(s, unit) {
  const u = { id: unit.id ?? `t${s.boardUnits.length + 1}`, ...unit };
  s.boardUnits.push(u);
  return u;
}

test('initial game has 9 coins in bag+hand and four markers remaining', () => {
  const s = createGame(H, B, 'human');
  for (const id of ['human', 'bot']) {
    assert.equal(s.players[id].bag.length + s.players[id].hand.length, 9);
    assert.equal(s.players[id].markersRemaining, 4);
  }
  assert.deepEqual(stateSanity(s), []);
});

test('Archer can shoot distance 2 through an occupied intervening hex', () => {
  const s = cleanGame();
  const archer = put(s, { owner: 'human', type: 'ARCHER', hex: hexId(0, 0), strength: 1 });
  put(s, { owner: 'human', type: 'SCOUT', hex: hexId(1, 0), strength: 1 });
  const target = put(s, { owner: 'bot', type: 'CAVALRY', hex: hexId(2, 0), strength: 1 });
  s.players.human.hand = ['ARCHER'];
  const actions = generateActionsForCoin(s, 'human', 'ARCHER', 'HAND', 0);
  assert(actions.some((a) => a.kind === 'TACTIC_ARCHER' && a.payload.unitId === archer.id && a.payload.targetUnitId === target.id));
});

test('Crossbowman tactic is blocked by occupied intervening hex', () => {
  const s = cleanGame();
  s.activePlayer = 'bot';
  put(s, { owner: 'bot', type: 'CROSSBOWMAN', hex: hexId(0, 0), strength: 1 });
  put(s, { owner: 'bot', type: 'CAVALRY', hex: hexId(1, 0), strength: 1 });
  const target = put(s, { owner: 'human', type: 'PIKEMAN', hex: hexId(2, 0), strength: 1 });
  s.players.bot.hand = ['CROSSBOWMAN'];
  const actions = generateActionsForCoin(s, 'bot', 'CROSSBOWMAN', 'HAND', 0);
  assert(!actions.some((a) => a.kind === 'TACTIC_CROSSBOWMAN' && a.payload.targetUnitId === target.id));
});

test('Knight cannot be attacked by an unbolstered unit', () => {
  const s = cleanGame();
  put(s, { owner: 'human', type: 'PIKEMAN', hex: hexId(0, 0), strength: 1 });
  const knight = put(s, { owner: 'bot', type: 'KNIGHT', hex: hexId(1, 0), strength: 1 });
  s.players.bot.units.push('KNIGHT');
  s.players.human.hand = ['PIKEMAN'];
  let actions = generateActionsForCoin(s, 'human', 'PIKEMAN', 'HAND', 0);
  assert(!actions.some((a) => a.kind === 'ATTACK' && a.payload.targetUnitId === knight.id));
  unitsOf(s, 'human', 'PIKEMAN')[0].strength = 2;
  actions = generateActionsForCoin(s, 'human', 'PIKEMAN', 'HAND', 0);
  assert(actions.some((a) => a.kind === 'ATTACK' && a.payload.targetUnitId === knight.id));
});

test('Scout can deploy adjacent to a friendly unit', () => {
  const s = cleanGame();
  put(s, { owner: 'human', type: 'PIKEMAN', hex: hexId(0, 0), strength: 1 });
  s.players.human.hand = ['SCOUT'];
  const actions = generateActionsForCoin(s, 'human', 'SCOUT', 'HAND', 0);
  assert(actions.some((a) => a.kind === 'DEPLOY' && a.payload.destination === hexId(1, 0)));
});

test('Pikeman retaliation removes one attacker coin', () => {
  const s = cleanGame();
  const attacker = put(s, { owner: 'human', type: 'SCOUT', hex: hexId(0, 0), strength: 2 });
  const pike = put(s, { owner: 'bot', type: 'PIKEMAN', hex: hexId(1, 0), strength: 1 });
  s.players.bot.units.push('PIKEMAN');
  s.players.human.hand = ['SCOUT'];
  const action = generateActionsForCoin(s, 'human', 'SCOUT', 'HAND', 0).find((a) => a.kind === 'ATTACK' && a.payload.targetUnitId === pike.id);
  assert(action);
  executeAction(s, action);
  assert.equal(attacker.strength, 1);
  assert.equal(s.boardUnits.some((u) => u.id === pike.id), false);
});
