import { ALL_UNITS } from '../dist/data.js';
import { createGame, generateAllMainActions, generatePendingActions, executeAction, afterResolvedAction, stateSanity } from '../dist/engine.js';
import { scoreAction } from '../dist/bot.js';

function sample(items, n) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

function choose(state) {
  const id = state.activePlayer;
  const actions = state.pending ? generatePendingActions(state) : generateAllMainActions(state, id);
  if (!actions.length) return null;
  return actions.map((a) => [scoreAction(state, a), a]).sort((a, b) => b[0] - a[0])[0][1];
}

const GAME_COUNT = 100;
let completed = 0;
let unresolved = 0;
let totalActions = 0;

for (let game = 0; game < GAME_COUNT; game++) {
  const picks = sample(ALL_UNITS, 8);
  const s = createGame(picks.slice(0, 4), picks.slice(4), Math.random() < .5 ? 'human' : 'bot');
  let steps = 0;

  while (!s.winner && steps < 800) {
    steps++;
    const a = choose(s);
    if (!a) {
      afterResolvedAction(s);
      continue;
    }
    executeAction(s, a);
    afterResolvedAction(s);
    const issues = stateSanity(s);
    if (issues.length) {
      throw new Error(`game ${game + 1} step ${steps} action ${a.kind}: ${issues.join('; ')}`);
    }
  }

  totalActions += steps;
  if (s.winner) completed++;
  else unresolved++;
}

console.log(`simulation passed: ${GAME_COUNT} games, ${completed} completed, ${unresolved} unresolved at cap, ${totalActions} actions checked`);
