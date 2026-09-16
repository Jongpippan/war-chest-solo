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
