import { ALL_UNITS, UNIT_DEFS } from './data.js';
import { ALL_LOCATIONS, BOARD_HEXES, HUMAN_STARTS, BOT_STARTS, coordinateLabel, distance, initialLocations, neighbors, stepInDirection, } from './board.js';
let unitSequence = 1;
let actionSequence = 1;
export const otherPlayer = (id) => (id === 'human' ? 'bot' : 'human');
export function shuffle(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}
function makePlayer(id, units) {
    const supply = {};
    const bag = ['ROYAL'];
    for (const type of units) {
        bag.push(type, type);
        supply[type] = UNIT_DEFS[type].coinCount - 2;
    }
    return {
        id,
        units: [...units],
        bag: shuffle(bag),
        hand: [],
        discard: [],
        supply,
        removed: [],
        markersRemaining: 4,
    };
}
export function createGame(humanUnits, botUnits, initiative) {
    if (humanUnits.length !== 4 || botUnits.length !== 4)
        throw new Error('Each player must have exactly four unit types.');
    if (new Set(humanUnits).size !== 4 || new Set(botUnits).size !== 4)
        throw new Error('Unit types must be unique per player.');
    const starter = initiative ?? (Math.random() < 0.5 ? 'human' : 'bot');
    const state = {
        round: 1,
        activePlayer: starter,
        initiative: starter,
        initiativeChangedThisRound: false,
        players: {
            human: makePlayer('human', humanUnits),
            bot: makePlayer('bot', botUnits),
        },
        boardUnits: [],
        locations: initialLocations(),
        winner: null,
        pending: null,
        forcedCoin: null,
        log: [],
        seedLabel: new Date().toISOString(),
    };
    addLog(state, `게임 시작. ${starter === 'human' ? '당신' : '봇'}이 Initiative를 가집니다.`);
    drawRoundHands(state);
    return state;
}
export function cloneState(state) {
    return structuredClone(state);
}
export function addLog(state, text) {
    state.log.push(text);
    if (state.log.length > 100)
        state.log.splice(0, state.log.length - 100);
}
export function getUnit(state, unitId) {
    return state.boardUnits.find((u) => u.id === unitId);
}
export function unitAt(state, hex) {
    return state.boardUnits.find((u) => u.hex === hex);
}
export function unitsOf(state, player, type) {
    return state.boardUnits.filter((u) => u.owner === player && (!type || u.type === type));
}
export function isEmpty(state, hex) {
    return !unitAt(state, hex);
}
export function drawOne(state, playerId) {
    const player = state.players[playerId];
    if (player.bag.length === 0 && player.discard.length > 0) {
        player.bag = shuffle(player.discard.map((d) => d.coin));
        player.discard = [];
        addLog(state, `${playerId === 'human' ? '당신' : '봇'}의 discard를 Bag에 다시 섞었습니다.`);
    }
    if (player.bag.length === 0)
        return null;
    return player.bag.pop() ?? null;
}
export function drawRoundHands(state) {
    for (const id of ['human', 'bot']) {
        const p = state.players[id];
        while (p.hand.length < 3) {
            const coin = drawOne(state, id);
            if (!coin)
                break;
            p.hand.push(coin);
        }
    }
    addLog(state, `Round ${state.round}: 각자 최대 3개의 코인을 뽑았습니다.`);
}
function discardCoin(state, playerId, coin, faceUp) {
    state.players[playerId].discard.push({ coin, faceUp });
}
function consumeCandidateCoin(state, candidate, destination) {
    if (candidate.source === 'FREE')
        return null;
    let coin;
    if (candidate.source === 'FORCED') {
        if (!state.forcedCoin || state.forcedCoin.player !== candidate.player)
            throw new Error('No forced coin available.');
        coin = state.forcedCoin.coin;
        state.forcedCoin = null;
    }
    else {
        if (candidate.coinIndex === undefined)
            throw new Error('Missing hand coin index.');
        coin = state.players[candidate.player].hand[candidate.coinIndex];
        if (coin === undefined)
            throw new Error('Hand coin no longer exists.');
        state.players[candidate.player].hand.splice(candidate.coinIndex, 1);
    }
    if (destination === 'DISCARD_UP')
        discardCoin(state, candidate.player, coin, true);
    if (destination === 'DISCARD_DOWN')
        discardCoin(state, candidate.player, coin, false);
    return coin;
}
function candidate(player, source, kind, label, group, payload, relatedHexes = [], coin, coinIndex) {
    return {
        id: `a${actionSequence++}`,
        player,
        source,
        coin,
        coinIndex,
        kind,
        label,
        group,
        payload,
        relatedHexes,
    };
}
function deployedLimit(type) {
    return type === 'FOOTMAN' ? 2 : 1;
}
function normalMoveDestinations(state, unit) {
    return neighbors(unit.hex).filter((h) => isEmpty(state, h));
}
function normalAttackTargets(state, attacker) {
    if (attacker.type === 'ARCHER' || attacker.type === 'LANCER')
        return [];
    return state.boardUnits.filter((target) => {
        if (target.owner === attacker.owner)
            return false;
        if (distance(attacker.hex, target.hex) !== 1)
            return false;
        if (target.type === 'KNIGHT' && attacker.strength < 2)
            return false;
        return true;
    });
}
function canAttackAfterMoving(attacker, target, attackerHex) {
    if (target.owner === attacker.owner)
        return false;
    if (distance(attackerHex, target.hex) !== 1)
        return false;
    if (target.type === 'KNIGHT' && attacker.strength < 2)
        return false;
    return true;
}
function deployHexes(state, playerId, type) {
    const ownedLocations = ALL_LOCATIONS.filter((h) => state.locations[h] === playerId && isEmpty(state, h));
    if (type !== 'SCOUT')
        return ownedLocations;
    const scoutExtras = new Set();
    for (const friendly of unitsOf(state, playerId)) {
        for (const h of neighbors(friendly.hex))
            if (isEmpty(state, h))
                scoutExtras.add(h);
    }
    return [...new Set([...ownedLocations, ...scoutExtras])];
}
function makeBaseCandidates(state, playerId, coin, source, coinIndex) {
    const out = [];
    if (!state.initiativeChangedThisRound && state.initiative !== playerId) {
        out.push(candidate(playerId, source, 'CLAIM_INITIATIVE', 'Initiative 가져오기', '뒷면 행동', {}, [], coin, coinIndex));
    }
    for (const type of state.players[playerId].units) {
        if ((state.players[playerId].supply[type] ?? 0) > 0) {
            out.push(candidate(playerId, source, 'RECRUIT', `${UNIT_DEFS[type].ko} 영입`, '뒷면 행동', { recruitType: type }, [], coin, coinIndex));
        }
    }
    out.push(candidate(playerId, source, 'PASS', '패스', '뒷면 행동', {}, [], coin, coinIndex));
    return out;
}
function tacticCandidates(state, playerId, type, source, coin, coinIndex) {
    const out = [];
    const matching = unitsOf(state, playerId, type);
    if (type === 'ARCHER') {
        for (const archer of matching) {
            for (const target of state.boardUnits.filter((u) => u.owner !== playerId && distance(archer.hex, u.hex) === 2)) {
                if (target.type === 'KNIGHT' && archer.strength < 2)
                    continue;
                out.push(candidate(playerId, source, 'TACTIC_ARCHER', `궁수 사격 → ${UNIT_DEFS[target.type].ko} ${coordinateLabel(target.hex)}`, '전술', { unitId: archer.id, targetUnitId: target.id }, [archer.hex, target.hex], coin, coinIndex));
            }
        }
    }
    if (type === 'CAVALRY') {
        for (const cav of matching) {
            for (const dest of normalMoveDestinations(state, cav)) {
                for (const target of state.boardUnits.filter((u) => canAttackAfterMoving(cav, u, dest))) {
                    out.push(candidate(playerId, source, 'TACTIC_CAVALRY', `기병 ${coordinateLabel(dest)}로 이동 → ${UNIT_DEFS[target.type].ko} 공격`, '전술', { unitId: cav.id, destination: dest, targetUnitId: target.id }, [cav.hex, dest, target.hex], coin, coinIndex));
                }
            }
        }
    }
    if (type === 'CROSSBOWMAN') {
        for (const crossbow of matching) {
            for (let dir = 0; dir < 6; dir += 1) {
                const mid = stepInDirection(crossbow.hex, dir, 1);
                const targetHex = stepInDirection(crossbow.hex, dir, 2);
                if (!mid || !targetHex || !isEmpty(state, mid))
                    continue;
                const target = unitAt(state, targetHex);
                if (!target || target.owner === playerId)
                    continue;
                if (target.type === 'KNIGHT' && crossbow.strength < 2)
                    continue;
                out.push(candidate(playerId, source, 'TACTIC_CROSSBOWMAN', `석궁 사격 → ${UNIT_DEFS[target.type].ko} ${coordinateLabel(target.hex)}`, '전술', { unitId: crossbow.id, targetUnitId: target.id, intermediate: mid }, [crossbow.hex, mid, target.hex], coin, coinIndex));
            }
        }
    }
    if (type === 'ENSIGN') {
        for (const ensign of matching) {
            for (const friendly of unitsOf(state, playerId).filter((u) => distance(ensign.hex, u.hex) <= 2)) {
                for (const dest of normalMoveDestinations(state, friendly).filter((h) => distance(ensign.hex, h) <= 2)) {
                    out.push(candidate(playerId, source, 'TACTIC_ENSIGN', `${UNIT_DEFS[friendly.type].ko} 이동 → ${coordinateLabel(dest)}`, '전술', { unitId: ensign.id, grantedUnitId: friendly.id, destination: dest }, [ensign.hex, friendly.hex, dest], coin, coinIndex));
                }
            }
        }
    }
    if (type === 'FOOTMAN' && matching.length > 0) {
        out.push(candidate(playerId, source, 'TACTIC_FOOTMAN', `보병 ${matching.length}개 각각 기동`, '전술', {}, matching.map((u) => u.hex), coin, coinIndex));
    }
    if (type === 'LANCER') {
        for (const lancer of matching) {
            for (let dir = 0; dir < 6; dir += 1) {
                const move1 = stepInDirection(lancer.hex, dir, 1);
                if (!move1 || !isEmpty(state, move1))
                    continue;
                const targetAfter1Hex = stepInDirection(lancer.hex, dir, 2);
                if (targetAfter1Hex) {
                    const target = unitAt(state, targetAfter1Hex);
                    if (target && canAttackAfterMoving(lancer, target, move1)) {
                        out.push(candidate(playerId, source, 'TACTIC_LANCER', `창기병 1칸 돌진 → ${UNIT_DEFS[target.type].ko} 공격`, '전술', { unitId: lancer.id, destination: move1, targetUnitId: target.id }, [lancer.hex, move1, target.hex], coin, coinIndex));
                    }
                }
                const move2 = stepInDirection(lancer.hex, dir, 2);
                if (!move2 || !isEmpty(state, move2))
                    continue;
                const targetAfter2Hex = stepInDirection(lancer.hex, dir, 3);
                if (!targetAfter2Hex)
                    continue;
                const target2 = unitAt(state, targetAfter2Hex);
                if (target2 && canAttackAfterMoving(lancer, target2, move2)) {
                    out.push(candidate(playerId, source, 'TACTIC_LANCER', `창기병 2칸 돌진 → ${UNIT_DEFS[target2.type].ko} 공격`, '전술', { unitId: lancer.id, destination: move2, intermediate: move1, targetUnitId: target2.id }, [lancer.hex, move1, move2, target2.hex], coin, coinIndex));
                }
            }
        }
    }
    if (type === 'LIGHT_CAVALRY') {
        for (const light of matching) {
            const seen = new Set();
            for (const mid of normalMoveDestinations(state, light)) {
                for (const dest of neighbors(mid)) {
                    if (dest === light.hex || !isEmpty(state, dest) || seen.has(dest))
                        continue;
                    seen.add(dest);
                    out.push(candidate(playerId, source, 'TACTIC_LIGHT_CAVALRY', `경기병 2칸 이동 → ${coordinateLabel(dest)}`, '전술', { unitId: light.id, destination: dest, intermediate: mid }, [light.hex, mid, dest], coin, coinIndex));
                }
            }
        }
    }
    if (type === 'MARSHALL') {
        for (const marshall of matching) {
            for (const friendly of unitsOf(state, playerId).filter((u) => distance(marshall.hex, u.hex) <= 2)) {
                for (const target of normalAttackTargets(state, friendly)) {
                    out.push(candidate(playerId, source, 'TACTIC_MARSHALL', `${UNIT_DEFS[friendly.type].ko}에게 공격 명령 → ${UNIT_DEFS[target.type].ko}`, '전술', { unitId: marshall.id, grantedUnitId: friendly.id, targetUnitId: target.id }, [marshall.hex, friendly.hex, target.hex], coin, coinIndex));
                }
            }
        }
    }
    return out;
}
function royalGuardTacticCandidates(state, playerId, source, coinIndex) {
    const out = [];
    for (const guard of unitsOf(state, playerId, 'ROYAL_GUARD')) {
        const seen = new Set();
        for (const one of normalMoveDestinations(state, guard)) {
            if (state.locations[one] === playerId && !seen.has(one)) {
                seen.add(one);
                out.push(candidate(playerId, source, 'TACTIC_ROYAL_GUARD', `근위병 이동 → 지배 Location ${coordinateLabel(one)}`, 'Royal Guard 전술', { unitId: guard.id, destination: one }, [guard.hex, one], 'ROYAL', coinIndex));
            }
            for (const two of neighbors(one)) {
                if (two === guard.hex || !isEmpty(state, two) || seen.has(two))
                    continue;
                if (state.locations[two] !== playerId)
                    continue;
                seen.add(two);
                out.push(candidate(playerId, source, 'TACTIC_ROYAL_GUARD', `근위병 2칸 이동 → 지배 Location ${coordinateLabel(two)}`, 'Royal Guard 전술', { unitId: guard.id, destination: two, intermediate: one }, [guard.hex, one, two], 'ROYAL', coinIndex));
            }
        }
    }
    return out;
}
export function generateActionsForCoin(state, playerId, coin, source, coinIndex) {
    if (state.winner || state.pending)
        return [];
    if (state.activePlayer !== playerId)
        return [];
    const out = makeBaseCandidates(state, playerId, coin, source, coinIndex);
    if (coin === 'ROYAL') {
        out.push(...royalGuardTacticCandidates(state, playerId, source, coinIndex));
        return out;
    }
    const type = coin;
    const deployed = unitsOf(state, playerId, type);
    if (deployed.length < deployedLimit(type)) {
        for (const hex of deployHexes(state, playerId, type)) {
            out.push(candidate(playerId, source, 'DEPLOY', `${UNIT_DEFS[type].ko} 배치 → ${coordinateLabel(hex)}`, '배치/강화', { unitType: type, destination: hex }, [hex], coin, coinIndex));
        }
    }
    for (const unit of deployed) {
        out.push(candidate(playerId, source, 'BOLSTER', `${UNIT_DEFS[type].ko} 강화 (${unit.strength}→${unit.strength + 1})`, '배치/강화', { unitId: unit.id }, [unit.hex], coin, coinIndex));
        for (const dest of normalMoveDestinations(state, unit)) {
            out.push(candidate(playerId, source, 'MOVE', `${UNIT_DEFS[type].ko} 이동 → ${coordinateLabel(dest)}`, '기동', { unitId: unit.id, destination: dest }, [unit.hex, dest], coin, coinIndex));
        }
        for (const target of normalAttackTargets(state, unit)) {
            out.push(candidate(playerId, source, 'ATTACK', `${UNIT_DEFS[type].ko} 공격 → ${UNIT_DEFS[target.type].ko} ${coordinateLabel(target.hex)}`, '기동', { unitId: unit.id, targetUnitId: target.id }, [unit.hex, target.hex], coin, coinIndex));
        }
        if (Object.prototype.hasOwnProperty.call(state.locations, unit.hex) && state.locations[unit.hex] !== playerId) {
            out.push(candidate(playerId, source, 'CONTROL', `${UNIT_DEFS[type].ko}로 Location 점령 ${coordinateLabel(unit.hex)}`, '기동', { unitId: unit.id }, [unit.hex], coin, coinIndex));
        }
    }
    out.push(...tacticCandidates(state, playerId, type, source, coin, coinIndex));
    return out;
}
export function generateAllMainActions(state, playerId) {
    if (state.forcedCoin && state.forcedCoin.player === playerId) {
        return generateActionsForCoin(state, playerId, state.forcedCoin.coin, 'FORCED');
    }
    return state.players[playerId].hand.flatMap((coin, index) => generateActionsForCoin(state, playerId, coin, 'HAND', index));
}
function freeManeuverCandidates(state, playerId, unit, includeSkip, labelPrefix) {
    const out = [];
    for (const dest of normalMoveDestinations(state, unit)) {
        out.push(candidate(playerId, 'FREE', 'FREE_MOVE', `${labelPrefix}: 이동 → ${coordinateLabel(dest)}`, '특수 능력', { unitId: unit.id, destination: dest }, [unit.hex, dest]));
    }
    for (const target of normalAttackTargets(state, unit)) {
        out.push(candidate(playerId, 'FREE', 'FREE_ATTACK', `${labelPrefix}: 공격 → ${UNIT_DEFS[target.type].ko}`, '특수 능력', { unitId: unit.id, targetUnitId: target.id }, [unit.hex, target.hex]));
    }
    if (Object.prototype.hasOwnProperty.call(state.locations, unit.hex) && state.locations[unit.hex] !== playerId) {
        out.push(candidate(playerId, 'FREE', 'FREE_CONTROL', `${labelPrefix}: Location 점령`, '특수 능력', { unitId: unit.id }, [unit.hex]));
    }
    if (includeSkip)
        out.push(candidate(playerId, 'FREE', 'SKIP_ABILITY', `${labelPrefix}: 사용하지 않음`, '특수 능력', { unitId: unit.id }, [unit.hex]));
    return out;
}
export function generatePendingActions(state) {
    const pending = state.pending;
    if (!pending || state.winner)
        return [];
    const unit = pending.kind === 'FOOTMAN_QUEUE'
        ? getUnit(state, pending.unitIds[pending.index] ?? '')
        : getUnit(state, pending.unitId);
    if (pending.kind === 'SWORDSMAN_MOVE') {
        if (!unit)
            return [candidate(pending.player, 'FREE', 'SKIP_ABILITY', '검병 후속 이동 건너뛰기', '특수 능력', {})];
        const out = normalMoveDestinations(state, unit).map((dest) => candidate(pending.player, 'FREE', 'FREE_MOVE', `검병 후속 이동 → ${coordinateLabel(dest)}`, '특수 능력', { unitId: unit.id, destination: dest }, [unit.hex, dest]));
        out.push(candidate(pending.player, 'FREE', 'SKIP_ABILITY', '검병 후속 이동 안 함', '특수 능력', { unitId: unit.id }, [unit.hex]));
        return out;
    }
    if (pending.kind === 'BERSERKER_EXTRA') {
        if (!unit || unit.strength <= 1)
            return [candidate(pending.player, 'FREE', 'SKIP_ABILITY', '광전사 연속 기동 종료', '특수 능력', {})];
        return freeManeuverCandidates(state, pending.player, unit, true, '코인 1개 제거 후 광전사 연속 기동');
    }
    if (pending.kind === 'MERCENARY_EXTRA') {
        if (!unit)
            return [candidate(pending.player, 'FREE', 'SKIP_ABILITY', '용병 무료 기동 건너뛰기', '특수 능력', {})];
        return freeManeuverCandidates(state, pending.player, unit, true, '용병 무료 기동');
    }
    if (pending.kind === 'FOOTMAN_QUEUE') {
        if (!unit)
            return [candidate(pending.player, 'FREE', 'SKIP_ABILITY', '이 보병은 더 이상 보드에 없음', '특수 능력', {})];
        // Recursive Footman tactic is intentionally not offered: the granted maneuver resolves as move/attack/control.
        return freeManeuverCandidates(state, pending.player, unit, true, `보병 ${pending.index + 1}/${pending.unitIds.length}`);
    }
    return [];
}
function removeBoardCoin(state, unit) {
    unit.strength -= 1;
    state.players[unit.owner].removed.push(unit.type);
    if (unit.strength <= 0) {
        state.boardUnits = state.boardUnits.filter((u) => u.id !== unit.id);
        addLog(state, `${UNIT_DEFS[unit.type].ko} 유닛이 제거되었습니다.`);
    }
}
function royalGuardAbsorbsFromSupply(state, target) {
    if (target.type !== 'ROYAL_GUARD')
        return false;
    const supply = state.players[target.owner].supply.ROYAL_GUARD ?? 0;
    if (supply <= 0)
        return false;
    if (target.owner === 'bot')
        return true;
    if (typeof window !== 'undefined') {
        return window.confirm('근위병이 공격받았습니다. 보드의 근위병 코인 대신 Supply의 근위병 코인 1개를 제거할까요?');
    }
    return true;
}
function applyAttack(state, attacker, target, adjacentAttack) {
    const attackerName = UNIT_DEFS[attacker.type].ko;
    const targetName = UNIT_DEFS[target.type].ko;
    addLog(state, `${attacker.owner === 'human' ? '당신' : '봇'}의 ${attackerName}이(가) ${targetName}을(를) 공격했습니다.`);
    if (royalGuardAbsorbsFromSupply(state, target)) {
        const p = state.players[target.owner];
        p.supply.ROYAL_GUARD = (p.supply.ROYAL_GUARD ?? 0) - 1;
        p.removed.push('ROYAL_GUARD');
        addLog(state, `근위병이 Supply 코인으로 공격을 흡수했습니다.`);
    }
    else {
        removeBoardCoin(state, target);
    }
    if (target.type === 'PIKEMAN' && adjacentAttack) {
        const liveAttacker = getUnit(state, attacker.id);
        if (liveAttacker) {
            addLog(state, `장창병의 반격으로 ${attackerName}도 코인 1개를 잃습니다.`);
            removeBoardCoin(state, liveAttacker);
        }
    }
}
function setPostManeuverTrigger(state, playerId, unitId, maneuver) {
    const unit = getUnit(state, unitId);
    const type = unit?.type;
    // Warrior Priest triggers from the completed action even if Pikeman retaliation destroyed it.
    const originalType = unit?.type;
    if (maneuver === 'ATTACK') {
        const attackerType = originalType;
        if (attackerType === 'SWORDSMAN' && unit) {
            state.pending = { kind: 'SWORDSMAN_MOVE', player: playerId, unitId };
            return;
        }
    }
    if (type === 'BERSERKER' && unit && unit.strength > 1) {
        state.pending = { kind: 'BERSERKER_EXTRA', player: playerId, unitId };
        return;
    }
    if ((maneuver === 'ATTACK' || maneuver === 'CONTROL') && type === 'WARRIOR_PRIEST') {
        const drawn = drawOne(state, playerId);
        if (drawn) {
            state.forcedCoin = { player: playerId, coin: drawn, source: 'WARRIOR_PRIEST' };
            addLog(state, `전투 사제가 추가 코인 1개를 뽑았습니다. 즉시 사용해야 합니다.`);
        }
    }
}
function setPostManeuverTriggerWithType(state, playerId, unitId, unitTypeBefore, maneuver) {
    const unit = getUnit(state, unitId);
    if (maneuver === 'ATTACK' && unitTypeBefore === 'SWORDSMAN' && unit) {
        state.pending = { kind: 'SWORDSMAN_MOVE', player: playerId, unitId };
        return;
    }
    if (unitTypeBefore === 'BERSERKER' && unit && unit.strength > 1) {
        state.pending = { kind: 'BERSERKER_EXTRA', player: playerId, unitId };
        return;
    }
    if ((maneuver === 'ATTACK' || maneuver === 'CONTROL') && unitTypeBefore === 'WARRIOR_PRIEST') {
        const drawn = drawOne(state, playerId);
        if (drawn) {
            state.forcedCoin = { player: playerId, coin: drawn, source: 'WARRIOR_PRIEST' };
            addLog(state, `전투 사제가 추가 코인 1개를 뽑았습니다. 즉시 사용해야 합니다.`);
        }
    }
}
function applyControl(state, playerId, unit) {
    const current = state.locations[unit.hex];
    if (current === undefined || current === playerId)
        throw new Error('Illegal control action.');
    if (current && current !== playerId) {
        state.players[current].markersRemaining += 1;
        addLog(state, `${current === 'human' ? '당신' : '봇'}의 Control Marker가 반환되었습니다.`);
    }
    state.locations[unit.hex] = playerId;
    state.players[playerId].markersRemaining -= 1;
    addLog(state, `${playerId === 'human' ? '당신' : '봇'}이 Location ${coordinateLabel(unit.hex)}을(를) 점령했습니다.`);
    if (state.players[playerId].markersRemaining <= 0) {
        state.winner = playerId;
        addLog(state, `${playerId === 'human' ? '당신' : '봇'}이 Control Marker 6개를 모두 배치해 승리했습니다.`);
    }
}
function moveUnit(state, unit, destination) {
    if (!isEmpty(state, destination))
        throw new Error('Destination occupied.');
    unit.hex = destination;
}
function resolveRecruit(state, playerId, recruitType) {
    const player = state.players[playerId];
    if ((player.supply[recruitType] ?? 0) <= 0)
        throw new Error('No supply coin.');
    player.supply[recruitType] = (player.supply[recruitType] ?? 0) - 1;
    player.discard.push({ coin: recruitType, faceUp: true });
    addLog(state, `${playerId === 'human' ? '당신' : '봇'}이 ${UNIT_DEFS[recruitType].ko} 코인을 영입했습니다.`);
    if (recruitType === 'MERCENARY') {
        const merc = unitsOf(state, playerId, 'MERCENARY')[0];
        if (merc)
            state.pending = { kind: 'MERCENARY_EXTRA', player: playerId, unitId: merc.id };
    }
}
function ensureUnit(state, id) {
    if (!id)
        throw new Error('Missing unit id.');
    const unit = getUnit(state, id);
    if (!unit)
        throw new Error('Unit no longer exists.');
    return unit;
}
function advanceFootmanPending(state) {
    if (!state.pending || state.pending.kind !== 'FOOTMAN_QUEUE')
        return;
    const nextIndex = state.pending.index + 1;
    if (nextIndex >= state.pending.unitIds.length)
        state.pending = null;
    else
        state.pending = { ...state.pending, index: nextIndex };
}
export function executeAction(state, action) {
    if (state.winner)
        return;
    if (action.player !== state.activePlayer)
        throw new Error('Not active player.');
    const playerId = action.player;
    const pName = playerId === 'human' ? '당신' : '봇';
    const pendingBefore = state.pending ? structuredClone(state.pending) : null;
    if (action.kind === 'SKIP_ABILITY') {
        if (pendingBefore?.kind === 'FOOTMAN_QUEUE')
            advanceFootmanPending(state);
        else
            state.pending = null;
        addLog(state, `${pName}이(가) 특수 후속 행동을 사용하지 않았습니다.`);
        return;
    }
    // Pending free actions consume their pending context first so a new trigger can replace it.
    if (action.source === 'FREE') {
        if (pendingBefore?.kind === 'BERSERKER_EXTRA') {
            const berserker = ensureUnit(state, pendingBefore.unitId);
            if (berserker.strength <= 1)
                throw new Error('Cannot remove final Berserker coin.');
            removeBoardCoin(state, berserker);
            addLog(state, `광전사가 스택 코인 1개를 제거해 연속 기동합니다.`);
            state.pending = null;
        }
        else if (pendingBefore?.kind === 'FOOTMAN_QUEUE') {
            state.pending = null;
        }
        else {
            state.pending = null;
        }
    }
    switch (action.kind) {
        case 'PASS': {
            consumeCandidateCoin(state, action, 'DISCARD_DOWN');
            addLog(state, `${pName}이(가) 코인 1개를 뒷면으로 버리고 패스했습니다.`);
            break;
        }
        case 'CLAIM_INITIATIVE': {
            consumeCandidateCoin(state, action, 'DISCARD_DOWN');
            state.initiative = playerId;
            state.initiativeChangedThisRound = true;
            addLog(state, `${pName}이(가) Initiative를 가져왔습니다. 다음 라운드에 먼저 행동합니다.`);
            break;
        }
        case 'RECRUIT': {
            consumeCandidateCoin(state, action, 'DISCARD_DOWN');
            resolveRecruit(state, playerId, action.payload.recruitType);
            break;
        }
        case 'DEPLOY': {
            consumeCandidateCoin(state, action, 'BOARD');
            const type = action.payload.unitType;
            const destination = action.payload.destination;
            state.boardUnits.push({ id: `u${unitSequence++}`, owner: playerId, type, hex: destination, strength: 1 });
            addLog(state, `${pName}이(가) ${UNIT_DEFS[type].ko}을(를) ${coordinateLabel(destination)}에 배치했습니다.`);
            break;
        }
        case 'BOLSTER': {
            consumeCandidateCoin(state, action, 'BOARD');
            const unit = ensureUnit(state, action.payload.unitId);
            unit.strength += 1;
            addLog(state, `${pName}의 ${UNIT_DEFS[unit.type].ko}이(가) 강화되어 스택 ${unit.strength}이 되었습니다.`);
            break;
        }
        case 'MOVE':
        case 'FREE_MOVE': {
            if (action.kind === 'MOVE')
                consumeCandidateCoin(state, action, 'DISCARD_UP');
            const unit = ensureUnit(state, action.payload.unitId);
            const unitType = unit.type;
            const from = unit.hex;
            moveUnit(state, unit, action.payload.destination);
            addLog(state, `${pName}의 ${UNIT_DEFS[unit.type].ko}이(가) ${coordinateLabel(from)} → ${coordinateLabel(unit.hex)}로 이동했습니다.`);
            setPostManeuverTriggerWithType(state, playerId, unit.id, unitType, 'MOVE');
            break;
        }
        case 'ATTACK':
        case 'FREE_ATTACK': {
            if (action.kind === 'ATTACK')
                consumeCandidateCoin(state, action, 'DISCARD_UP');
            const attacker = ensureUnit(state, action.payload.unitId);
            const attackerType = attacker.type;
            const target = ensureUnit(state, action.payload.targetUnitId);
            applyAttack(state, attacker, target, true);
            setPostManeuverTriggerWithType(state, playerId, attacker.id, attackerType, 'ATTACK');
            break;
        }
        case 'CONTROL':
        case 'FREE_CONTROL': {
            if (action.kind === 'CONTROL')
                consumeCandidateCoin(state, action, 'DISCARD_UP');
            const unit = ensureUnit(state, action.payload.unitId);
            const unitType = unit.type;
            applyControl(state, playerId, unit);
            if (!state.winner)
                setPostManeuverTriggerWithType(state, playerId, unit.id, unitType, 'CONTROL');
            break;
        }
        case 'TACTIC_ARCHER': {
            consumeCandidateCoin(state, action, 'DISCARD_UP');
            const attacker = ensureUnit(state, action.payload.unitId);
            const target = ensureUnit(state, action.payload.targetUnitId);
            applyAttack(state, attacker, target, false);
            break;
        }
        case 'TACTIC_CROSSBOWMAN': {
            consumeCandidateCoin(state, action, 'DISCARD_UP');
            const attacker = ensureUnit(state, action.payload.unitId);
            const target = ensureUnit(state, action.payload.targetUnitId);
            applyAttack(state, attacker, target, false);
            break;
        }
        case 'TACTIC_CAVALRY': {
            consumeCandidateCoin(state, action, 'DISCARD_UP');
            const attacker = ensureUnit(state, action.payload.unitId);
            moveUnit(state, attacker, action.payload.destination);
            addLog(state, `${pName}의 기병이 이동 후 공격합니다.`);
            const target = ensureUnit(state, action.payload.targetUnitId);
            applyAttack(state, attacker, target, true);
            break;
        }
        case 'TACTIC_ENSIGN': {
            consumeCandidateCoin(state, action, 'DISCARD_UP');
            const granted = ensureUnit(state, action.payload.grantedUnitId);
            const grantedType = granted.type;
            moveUnit(state, granted, action.payload.destination);
            addLog(state, `기수가 ${UNIT_DEFS[granted.type].ko}에게 일반 이동을 부여했습니다.`);
            setPostManeuverTriggerWithType(state, playerId, granted.id, grantedType, 'MOVE');
            break;
        }
        case 'TACTIC_FOOTMAN': {
            consumeCandidateCoin(state, action, 'DISCARD_UP');
            const ids = unitsOf(state, playerId, 'FOOTMAN').map((u) => u.id);
            state.pending = ids.length ? { kind: 'FOOTMAN_QUEUE', player: playerId, unitIds: ids, index: 0 } : null;
            addLog(state, `보병 전술: 각 보병이 한 번씩 기동합니다.`);
            break;
        }
        case 'TACTIC_LANCER': {
            consumeCandidateCoin(state, action, 'DISCARD_UP');
            const attacker = ensureUnit(state, action.payload.unitId);
            moveUnit(state, attacker, action.payload.destination);
            addLog(state, `${pName}의 창기병이 돌진합니다.`);
            const target = ensureUnit(state, action.payload.targetUnitId);
            applyAttack(state, attacker, target, true);
            break;
        }
        case 'TACTIC_LIGHT_CAVALRY': {
            consumeCandidateCoin(state, action, 'DISCARD_UP');
            const unit = ensureUnit(state, action.payload.unitId);
            moveUnit(state, unit, action.payload.destination);
            addLog(state, `${pName}의 경기병이 2칸 이동했습니다.`);
            break;
        }
        case 'TACTIC_MARSHALL': {
            consumeCandidateCoin(state, action, 'DISCARD_UP');
            const attacker = ensureUnit(state, action.payload.grantedUnitId);
            const attackerType = attacker.type;
            const target = ensureUnit(state, action.payload.targetUnitId);
            addLog(state, `지휘관이 ${UNIT_DEFS[attacker.type].ko}에게 일반 공격을 명령했습니다.`);
            applyAttack(state, attacker, target, true);
            setPostManeuverTriggerWithType(state, playerId, attacker.id, attackerType, 'ATTACK');
            break;
        }
        case 'TACTIC_ROYAL_GUARD': {
            consumeCandidateCoin(state, action, 'DISCARD_UP');
            const guard = ensureUnit(state, action.payload.unitId);
            moveUnit(state, guard, action.payload.destination);
            addLog(state, `${pName}이(가) Royal Coin으로 근위병을 지배 Location으로 이동했습니다.`);
            break;
        }
        default:
            throw new Error(`Unsupported action: ${action.kind}`);
    }
    // If a Footman free maneuver did not create a new trigger, advance to the next Footman.
    if (action.source === 'FREE' && pendingBefore?.kind === 'FOOTMAN_QUEUE' && !state.pending && !state.forcedCoin) {
        const nextIndex = pendingBefore.index + 1;
        if (nextIndex < pendingBefore.unitIds.length) {
            state.pending = { ...pendingBefore, index: nextIndex };
        }
    }
}
export function afterResolvedAction(state) {
    if (state.winner || state.pending || state.forcedCoin)
        return;
    const current = state.activePlayer;
    const other = otherPlayer(current);
    const currentHas = state.players[current].hand.length > 0;
    const otherHas = state.players[other].hand.length > 0;
    if (otherHas) {
        state.activePlayer = other;
        return;
    }
    if (currentHas)
        return;
    if (!currentHas && !otherHas) {
        state.round += 1;
        state.initiativeChangedThisRound = false;
        state.activePlayer = state.initiative;
        drawRoundHands(state);
    }
}
export function isMainActionPhase(state) {
    return !state.pending && !state.winner;
}
export function actionCountForPlayer(state, playerId) {
    if (state.pending)
        return state.pending.player === playerId ? generatePendingActions(state).length : 0;
    return generateAllMainActions(state, playerId).length;
}
export function totalKnownCoins(player, type) {
    let count = player.bag.filter((c) => c === type).length + player.hand.filter((c) => c === type).length;
    count += player.discard.filter((d) => d.coin === type).length;
    return count;
}
export function stateSanity(state) {
    const issues = [];
    for (const unit of state.boardUnits) {
        if (!BOARD_HEXES.includes(unit.hex))
            issues.push(`Unit ${unit.id} off board`);
        if (unit.strength <= 0)
            issues.push(`Unit ${unit.id} has nonpositive strength`);
    }
    const occupied = new Set();
    for (const unit of state.boardUnits) {
        if (occupied.has(unit.hex))
            issues.push(`Two units occupy ${unit.hex}`);
        occupied.add(unit.hex);
    }
    for (const id of ['human', 'bot']) {
        const p = state.players[id];
        if (p.markersRemaining < 0 || p.markersRemaining > 6)
            issues.push(`${id} marker count invalid`);
        for (const unit of p.units) {
            const forced = state.forcedCoin?.player === id && state.forcedCoin.coin === unit ? 1 : 0;
            const total = (p.supply[unit] ?? 0)
                + p.bag.filter((c) => c === unit).length
                + p.hand.filter((c) => c === unit).length
                + p.discard.filter((d) => d.coin === unit).length
                + p.removed.filter((c) => c === unit).length
                + unitsOf(state, id, unit).reduce((sum, u) => sum + u.strength, 0)
                + forced;
            if (total !== UNIT_DEFS[unit].coinCount)
                issues.push(`${id} ${unit} coin conservation: ${total}/${UNIT_DEFS[unit].coinCount}`);
        }
    }
    return issues;
}
export function availableUnitTypes() {
    return [...ALL_UNITS];
}
export function startingHexes(player) {
    return player === 'human' ? HUMAN_STARTS : BOT_STARTS;
}
