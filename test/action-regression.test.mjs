import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, executeAction, generateActionsForCoin } from '../dist/engine.js';

function cleanState(humanUnits, botUnits = ['ARCHER', 'CAVALRY', 'LANCER', 'SCOUT']) {
  const state = createGame(humanUnits, botUnits, 'human');
  for (const player of ['human', 'bot']) {
    state.players[player].hand = [];
    state.players[player].bag = [];
    state.players[player].discard = [];
  }
  state.boardUnits = [];
  state.activePlayer = 'human';
  state.initiative = 'human';
  return state;
}

test('resolving Bolster invalidates sibling Move candidates from the same UI snapshot', () => {
  const state = cleanState(['LIGHT_CAVALRY', 'PIKEMAN', 'CROSSBOWMAN', 'SWORDSMAN']);
  state.players.human.hand = ['LIGHT_CAVALRY', 'LIGHT_CAVALRY'];
  state.boardUnits = [{ id: 'light', owner: 'human', type: 'LIGHT_CAVALRY', hex: '0,0', strength: 1 }];

  const actions = generateActionsForCoin(state, 'human', 'LIGHT_CAVALRY', 'HAND', 0);
  const bolster = actions.find((action) => action.kind === 'BOLSTER' && action.payload.unitId === 'light');
  const move = actions.find((action) => action.kind === 'MOVE' && action.payload.unitId === 'light');
  assert(bolster);
  assert(move);

  executeAction(state, bolster);
  assert.equal(state.boardUnits[0].strength, 2);
  assert.equal(state.boardUnits[0].hex, '0,0');
  assert.throws(() => executeAction(state, move), /stale/i);
  assert.equal(state.boardUnits[0].strength, 2);
  assert.equal(state.boardUnits[0].hex, '0,0');
  assert.deepEqual(state.players.human.hand, ['LIGHT_CAVALRY']);
});

test('the same resolved candidate cannot execute twice', () => {
  const state = cleanState(['LIGHT_CAVALRY', 'PIKEMAN', 'CROSSBOWMAN', 'SWORDSMAN']);
  state.players.human.hand = ['LIGHT_CAVALRY', 'LIGHT_CAVALRY'];
  state.boardUnits = [{ id: 'light', owner: 'human', type: 'LIGHT_CAVALRY', hex: '0,0', strength: 1 }];

  const bolster = generateActionsForCoin(state, 'human', 'LIGHT_CAVALRY', 'HAND', 0)
    .find((action) => action.kind === 'BOLSTER' && action.payload.unitId === 'light');
  assert(bolster);
  executeAction(state, bolster);
  assert.throws(() => executeAction(state, bolster), /stale/i);
  assert.equal(state.boardUnits[0].strength, 2);
  assert.deepEqual(state.players.human.hand, ['LIGHT_CAVALRY']);
});

test('Ensign Tactic cannot grant a Move to the Ensign itself', () => {
  const state = cleanState(['ENSIGN', 'BERSERKER', 'FOOTMAN', 'KNIGHT']);
  state.players.human.hand = ['ENSIGN'];
  state.boardUnits = [{ id: 'ensign', owner: 'human', type: 'ENSIGN', hex: '0,0', strength: 1 }];

  const actions = generateActionsForCoin(state, 'human', 'ENSIGN', 'HAND', 0);
  assert.equal(actions.some((action) => action.kind === 'TACTIC_ENSIGN' && action.payload.grantedUnitId === 'ensign'), false);
});

test('Ensign-granted normal Move triggers Berserker follow-up ability', () => {
  const state = cleanState(['ENSIGN', 'BERSERKER', 'FOOTMAN', 'KNIGHT']);
  state.players.human.hand = ['ENSIGN'];
  state.boardUnits = [
    { id: 'ensign', owner: 'human', type: 'ENSIGN', hex: '0,0', strength: 1 },
    { id: 'berserker', owner: 'human', type: 'BERSERKER', hex: '1,0', strength: 2 },
  ];

  const action = generateActionsForCoin(state, 'human', 'ENSIGN', 'HAND', 0)
    .find((candidate) => candidate.kind === 'TACTIC_ENSIGN' && candidate.payload.grantedUnitId === 'berserker');
  assert(action);
  executeAction(state, action);
  assert.equal(state.pending?.kind, 'BERSERKER_EXTRA');
  assert.equal(state.pending?.unitId, 'berserker');
});
