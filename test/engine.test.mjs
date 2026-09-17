import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  generateActionsForCoin,
  executeAction,
  normalizeUnitIds,
  unitAt,
} from '../dist/engine.js';
import { ALL_LOCATIONS, HUMAN_STARTS, BOT_STARTS, NEUTRAL_LOCATIONS, hexId } from '../dist/board.js';

const H = ['SWORDSMAN', 'PIKEMAN', 'CROSSBOWMAN', 'LIGHT_CAVALRY'];
const B = ['ARCHER', 'CAVALRY', 'LANCER', 'SCOUT'];

function emptyState(initiative = 'human') {
  const state = createGame(H, B, initiative);
  state.players.human.hand = [];
  state.players.bot.hand = [];
  state.players.human.bag = [];
  state.players.bot.bag = [];
  state.players.human.discard = [];
  state.players.bot.discard = [];
  state.boardUnits = [];
  return state;
}

test('initial game has 9 coins in bag+hand and four markers remaining', () => {
  const s = createGame(H, B, 'human');
  assert.equal(s.players.human.bag.length + s.players.human.hand.length, 9);
  assert.equal(s.players.bot.bag.length + s.players.bot.hand.length, 9);
  assert.equal(s.players.human.markersRemaining, 4);
  assert.equal(s.players.bot.markersRemaining, 4);
});

test('Archer can shoot distance 2 through an occupied intervening hex', () => {
  const s = emptyState();
  s.players.human.hand = ['ARCHER'];
  s.boardUnits = [
    { id: 'a', owner: 'human', type: 'ARCHER', hex: '0,0', strength: 1 },
    { id: 'mid', owner: 'human', type: 'PIKEMAN', hex: '1,0', strength: 1 },
    { id: 'target', owner: 'bot', type: 'SCOUT', hex: '2,0', strength: 1 },
  ];
  const actions = generateActionsForCoin(s, 'human', 'ARCHER', 'HAND', 0);
  assert(actions.some((a) => a.kind === 'TACTIC_ARCHER' && a.payload.targetUnitId === 'target'));
});

test('Crossbowman tactic is blocked by occupied intervening hex', () => {
  const s = emptyState();
  s.players.human.hand = ['CROSSBOWMAN'];
  s.boardUnits = [
    { id: 'x', owner: 'human', type: 'CROSSBOWMAN', hex: '0,0', strength: 1 },
    { id: 'mid', owner: 'human', type: 'PIKEMAN', hex: '1,0', strength: 1 },
    { id: 'target', owner: 'bot', type: 'SCOUT', hex: '2,0', strength: 1 },
  ];
  const actions = generateActionsForCoin(s, 'human', 'CROSSBOWMAN', 'HAND', 0);
  assert(!actions.some((a) => a.kind === 'TACTIC_CROSSBOWMAN' && a.payload.targetUnitId === 'target'));
});

test('Knight cannot be attacked by an unbolstered unit', () => {
  const s = emptyState();
  s.players.human.hand = ['SWORDSMAN'];
  s.boardUnits = [
    { id: 's', owner: 'human', type: 'SWORDSMAN', hex: '0,0', strength: 1 },
    { id: 'k', owner: 'bot', type: 'KNIGHT', hex: '1,0', strength: 1 },
  ];
  let actions = generateActionsForCoin(s, 'human', 'SWORDSMAN', 'HAND', 0);
  assert(!actions.some((a) => a.kind === 'ATTACK' && a.payload.targetUnitId === 'k'));
  s.boardUnits[0].strength = 2;
  actions = generateActionsForCoin(s, 'human', 'SWORDSMAN', 'HAND', 0);
  assert(actions.some((a) => a.kind === 'ATTACK' && a.payload.targetUnitId === 'k'));
});

test('Scout can deploy adjacent to a friendly unit', () => {
  const s = emptyState();
  s.players.human.hand = ['SCOUT'];
  s.boardUnits = [{ id: 'f', owner: 'human', type: 'PIKEMAN', hex: '0,0', strength: 1 }];
  const actions = generateActionsForCoin(s, 'human', 'SCOUT', 'HAND', 0);
  assert(actions.some((a) => a.kind === 'DEPLOY' && a.payload.destination === '1,0'));
});

test('Pikeman retaliation removes one attacker coin', () => {
  const s = emptyState();
  s.players.human.hand = ['SWORDSMAN'];
  s.boardUnits = [
    { id: 's', owner: 'human', type: 'SWORDSMAN', hex: '0,0', strength: 2 },
    { id: 'p', owner: 'bot', type: 'PIKEMAN', hex: '1,0', strength: 1 },
  ];
  const action = generateActionsForCoin(s, 'human', 'SWORDSMAN', 'HAND', 0).find((a) => a.kind === 'ATTACK' && a.payload.targetUnitId === 'p');
  assert(action);
  executeAction(s, action);
  assert.equal(unitAt(s, '0,0')?.strength, 1);
});

test('standard Deploy targets only empty controlled Locations', () => {
  const s = emptyState();
  s.players.human.hand = ['ARCHER'];
  const deploys = generateActionsForCoin(s, 'human', 'ARCHER', 'HAND', 0).filter((a) => a.kind === 'DEPLOY');
  assert(deploys.length > 0);
  for (const action of deploys) {
    const hex = action.payload.destination;
    assert(hex);
    assert(ALL_LOCATIONS.includes(hex));
    assert.equal(s.locations[hex], 'human');
  }
});

test('2-player physical starting and neutral Locations match the supplied board reference', () => {
  assert.deepEqual(HUMAN_STARTS, [hexId(1, 2), hexId(-2, 3)]);
  assert.deepEqual(BOT_STARTS, [hexId(-1, -2), hexId(2, -3)]);
  assert.deepEqual(new Set(NEUTRAL_LOCATIONS), new Set([
    hexId(1, -1), hexId(-1, 1), hexId(-2, 0),
    hexId(2, 0), hexId(3, -2), hexId(-3, 2),
  ]));
});

test('deploy destinations are controlled locations', () => {
  const state = createGame(['SWORDSMAN','PIKEMAN','CROSSBOWMAN','LIGHT_CAVALRY'], ['ARCHER','CAVALRY','LANCER','SCOUT'], 'human');
  const idx = state.players.human.hand.findIndex((c) => c !== 'ROYAL');
  if (idx < 0) return;
  const coin = state.players.human.hand[idx];
  const actions = generateActionsForCoin(state, 'human', coin, 'HAND', idx).filter((a) => a.kind === 'DEPLOY');
  for (const action of actions) {
    assert.equal(state.locations[action.payload.destination], 'human');
  }
});


test('physical board image coordinates are used for the 2-player Locations', () => {
  assert.deepEqual(new Set(BOT_STARTS), new Set(['-1,-2', '2,-3']));
  assert.deepEqual(new Set(HUMAN_STARTS), new Set(['1,2', '-2,3']));
  assert.deepEqual(new Set(NEUTRAL_LOCATIONS), new Set(['1,-1', '-1,1', '-2,0', '2,0', '3,-2', '-3,2']));
});


test('Bolster is durability only: one Attack removes exactly one defender coin', () => {
  const s = emptyState();
  s.players.human.hand = ['SWORDSMAN'];
  s.boardUnits = [
    { id: 'attacker', owner: 'human', type: 'SWORDSMAN', hex: '0,0', strength: 3 },
    { id: 'target', owner: 'bot', type: 'SCOUT', hex: '1,0', strength: 3 },
  ];
  const action = generateActionsForCoin(s, 'human', 'SWORDSMAN', 'HAND', 0)
    .find((candidate) => candidate.kind === 'ATTACK' && candidate.payload.targetUnitId === 'target');
  assert(action);
  executeAction(s, action);
  assert.equal(unitAt(s, '0,0')?.strength, 3, 'attacker strength does not multiply damage');
  assert.equal(unitAt(s, '1,0')?.strength, 2, 'defender loses one coin, not the whole stack');
  assert.equal(s.players.bot.removed.filter((coin) => coin === 'SCOUT').length, 1);
  assert(s.log.some((line) => line.includes('검병') && line.includes('정찰병') && line.includes('Attack')));
});

test('saved games with duplicate unit IDs are repaired before actions resolve', () => {
  const s = emptyState();
  s.players.human.hand = ['LIGHT_CAVALRY'];
  s.boardUnits = [
    { id: 'u1', owner: 'human', type: 'LIGHT_CAVALRY', hex: '0,0', strength: 2 },
    { id: 'u1', owner: 'bot', type: 'SCOUT', hex: '1,0', strength: 2 },
  ];
  normalizeUnitIds(s);
  assert.equal(new Set(s.boardUnits.map((unit) => unit.id)).size, 2);
  const target = s.boardUnits.find((unit) => unit.owner === 'bot');
  assert(target);
  const action = generateActionsForCoin(s, 'human', 'LIGHT_CAVALRY', 'HAND', 0)
    .find((candidate) => candidate.kind === 'ATTACK' && candidate.payload.targetUnitId === target.id);
  assert(action);
  executeAction(s, action);
  assert.equal(s.boardUnits.find((unit) => unit.owner === 'bot')?.type, 'SCOUT');
  assert.equal(s.boardUnits.find((unit) => unit.owner === 'bot')?.strength, 1);
  assert(s.log.some((line) => line.includes('경기병') && line.includes('정찰병') && line.includes('Attack')));
});
