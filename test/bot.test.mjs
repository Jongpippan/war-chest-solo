import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, stateSanity } from '../dist/engine.js';
import { chooseBotDecision } from '../dist/bot.js';

const H = ['SWORDSMAN', 'PIKEMAN', 'CROSSBOWMAN', 'LIGHT_CAVALRY'];
const B = ['ARCHER', 'CAVALRY', 'LANCER', 'SCOUT'];

for (const difficulty of ['EASY', 'NORMAL', 'HARD']) {
  test(`${difficulty} bot returns a legal explained decision without corrupting state`, () => {
    const s = createGame(H, B, 'bot');
    const before = JSON.stringify(s);
    const decision = chooseBotDecision(s, difficulty);
    assert(decision);
    assert.equal(decision.action.player, 'bot');
    assert.ok(decision.reason.length > 10);
    assert.ok(decision.alternatives.length >= 1);
    assert.equal(JSON.stringify(s), before);
    assert.deepEqual(stateSanity(s), []);
  });
}


test('HARD bot advances instead of reflexively Bolstering a safe rear Unit', () => {
  const s = createGame(H, H, 'bot');
  s.activePlayer = 'bot';
  s.players.bot.hand = ['SWORDSMAN'];
  s.players.bot.bag = [];
  s.players.bot.discard = [];
  s.boardUnits = [
    { id: 'bot-sword-safe', owner: 'bot', type: 'SWORDSMAN', hex: '-1,-2', strength: 1 },
  ];

  const decision = chooseBotDecision(s, 'HARD');
  assert(decision);
  assert.notEqual(decision.action.kind, 'BOLSTER', 'Hard should not Bolster a safe rear Unit when it can make positional progress');
});

test('HARD bot increasingly discounts repeated Bolsters', () => {
  const s = createGame(H, H, 'bot');
  s.activePlayer = 'bot';
  s.players.bot.hand = ['SWORDSMAN'];
  s.players.bot.bag = [];
  s.players.bot.discard = [];
  s.boardUnits = [
    { id: 'bot-sword-stack', owner: 'bot', type: 'SWORDSMAN', hex: '-1,-2', strength: 2 },
  ];
  s.log.push('봇의 검병이(가) 강화되어 스택 2이 되었습니다.');
  s.log.push('봇의 검병이(가) 강화되어 스택 3이 되었습니다.');

  const decision = chooseBotDecision(s, 'HARD');
  assert(decision);
  assert.notEqual(decision.action.kind, 'BOLSTER', 'Hard should not keep stacking an already Bolstered safe Unit');
});
