import { ALL_UNITS, RECOMMENDED_BOT, RECOMMENDED_HUMAN, UNIT_DEFS } from './data.js';
import { BOARD_HEXES, ALL_LOCATIONS, coordinateLabel, distance, parseHex } from './board.js';
import { afterResolvedAction, cloneState, createGame, executeAction, generateActionsForCoin, generatePendingActions, stateSanity, } from './engine.js';
import { chooseBotDecision } from './bot.js';
const STORAGE_KEY = 'war-chest-solo-local-v2';
const SETTINGS_KEY = 'war-chest-solo-settings-v2';
const app = document.querySelector('#app');
if (!app)
    throw new Error('Missing #app');
const DRAFT_ORDER = ['human', 'bot', 'bot', 'human', 'human', 'bot', 'bot', 'human'];
let state = null;
let setupHuman = new Set(RECOMMENDED_HUMAN);
let setupBotOverride = [...RECOMMENDED_BOT];
let setupMode = 'SELECT';
let difficulty = loadDifficulty();
let draft = null;
let selectedCoinIndex = 0;
let previewHexes = new Set();
let botBusy = false;
let undoStack = [];
let lastBotThought = null;
let botThoughtHistory = [];
function esc(value) {
    return value.replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}
function loadDifficulty() {
    try {
        const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
        if (raw.difficulty === 'EASY' || raw.difficulty === 'NORMAL' || raw.difficulty === 'HARD')
            return raw.difficulty;
    }
    catch { /* noop */ }
    return 'NORMAL';
}
function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ difficulty }));
}
function coinLabel(coin) {
    return coin === 'ROYAL' ? 'Royal Coin' : UNIT_DEFS[coin].ko;
}
function randomSubset(items, count) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, count);
}
function saveState() {
    if (!state)
        return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function loadSavedState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw)
            return null;
        const parsed = JSON.parse(raw);
        if (!parsed.players?.human || !parsed.players?.bot || !parsed.locations)
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
function clearSave() { localStorage.removeItem(STORAGE_KEY); }
function resetSessionUi() {
    selectedCoinIndex = 0;
    previewHexes.clear();
    undoStack = [];
    lastBotThought = null;
    botThoughtHistory = [];
}
function startGameWithArmies(human, bot, initiative) {
    state = createGame(human, bot, initiative);
    resetSessionUi();
    saveState();
    render();
}
function startGame() {
    if (setupHuman.size !== 4)
        return;
    const human = [...setupHuman];
    const bot = setupBotOverride && setupBotOverride.every((u) => !setupHuman.has(u))
        ? [...setupBotOverride]
        : randomSubset(ALL_UNITS.filter((u) => !setupHuman.has(u)), 4);
    startGameWithArmies(human, bot);
}
function newGameSetup() {
    state = null;
    botBusy = false;
    draft = null;
    resetSessionUi();
    clearSave();
    render();
}
function resumeGame() {
    const saved = loadSavedState();
    if (!saved)
        return;
    state = saved;
    resetSessionUi();
    render();
}
function draftUnitWeight(type) {
    const base = {
        WARRIOR_PRIEST: 95, KNIGHT: 92, MERCENARY: 89, SWORDSMAN: 86, PIKEMAN: 84,
        CAVALRY: 83, CROSSBOWMAN: 81, LIGHT_CAVALRY: 79, MARSHALL: 78, ARCHER: 76,
        FOOTMAN: 75, LANCER: 73, ENSIGN: 71, SCOUT: 69, ROYAL_GUARD: 68, BERSERKER: 67,
    };
    return (base[type] ?? 70) + Math.random() * (difficulty === 'EASY' ? 22 : difficulty === 'HARD' ? 3 : 10);
}
function advanceBotDraft() {
    if (!draft)
        return;
    while (draft.step < DRAFT_ORDER.length && DRAFT_ORDER[draft.step] === 'bot') {
        const available = draft.pool.filter((u) => !draft.human.includes(u) && !draft.bot.includes(u));
        const pick = [...available].sort((a, b) => draftUnitWeight(b) - draftUnitWeight(a))[0];
        if (!pick)
            break;
        draft.bot.push(pick);
        draft.step += 1;
    }
}
function beginDraft() {
    setupMode = 'DRAFT';
    draft = { pool: randomSubset(ALL_UNITS, 8), human: [], bot: [], step: 0 };
    advanceBotDraft();
    renderSetup();
}
function pickDraft(type) {
    if (!draft || draft.step >= DRAFT_ORDER.length || DRAFT_ORDER[draft.step] !== 'human')
        return;
    if (!draft.pool.includes(type) || draft.human.includes(type) || draft.bot.includes(type))
        return;
    draft.human.push(type);
    draft.step += 1;
    advanceBotDraft();
    renderSetup();
}
function startDraftGame() {
    if (!draft || draft.human.length !== 4 || draft.bot.length !== 4)
        return;
    // Official snake draft: the second drafter (bot here) receives initial initiative.
    startGameWithArmies(draft.human, draft.bot, 'bot');
}
function difficultyLabel(d) {
    return d === 'EASY' ? 'Easy' : d === 'HARD' ? 'Hard' : 'Normal';
}
function difficultyDescription(d) {
    if (d === 'EASY')
        return '좋은 수 주변에서 일부러 흔들립니다. 전술 실수가 나옵니다.';
    if (d === 'HARD')
        return '즉시 점수 + 행동 후 보드 평가를 함께 사용합니다.';
    return '점령·공격·배치·덱 순환 휴리스틱의 최선수를 둡니다.';
}
function setupDifficultyHtml() {
    return `<div class="difficulty-box">
    <div><div class="eyebrow">BOT DIFFICULTY</div><strong>${difficultyLabel(difficulty)}</strong><p>${difficultyDescription(difficulty)}</p></div>
    <div class="segmented">${['EASY', 'NORMAL', 'HARD'].map((d) => `<button class="difficulty-btn ${difficulty === d ? 'active' : ''}" data-difficulty="${d}">${difficultyLabel(d)}</button>`).join('')}</div>
  </div>`;
}
function renderDraftSetup(saved) {
    if (!draft)
        beginDraft();
    if (!draft)
        return;
    const current = draft.step < DRAFT_ORDER.length ? DRAFT_ORDER[draft.step] : null;
    const picked = new Set([...draft.human, ...draft.bot]);
    const cards = draft.pool.map((type) => {
        const d = UNIT_DEFS[type];
        const mine = draft.human.includes(type);
        const theirs = draft.bot.includes(type);
        const disabled = picked.has(type) || current !== 'human';
        return `<button class="unit-pick draft-pick ${mine ? 'draft-human' : ''} ${theirs ? 'draft-bot' : ''}" data-draft-unit="${type}" style="--accent:${d.accent}" ${disabled ? 'disabled' : ''}>
      <span class="unit-pick-top"><span class="unit-dot"></span><strong>${esc(d.ko)}</strong><span>${d.coinCount}코인</span></span>
      <span class="unit-eng">${esc(d.name)}</span><span class="unit-rule">${esc(d.rules)}</span>
      ${mine ? '<span class="pick-owner human">내 선택</span>' : theirs ? '<span class="pick-owner bot">봇 선택</span>' : ''}
    </button>`;
    }).join('');
    const complete = draft.step >= DRAFT_ORDER.length;
    app.innerHTML = `<main class="setup-shell">
    <section class="hero-card compact-hero"><div class="eyebrow">SNAKE DRAFT · 8 UNITS</div><h1>War Chest Solo</h1>
      <p>8개 유닛 풀에서 <b>1–2–2–2–1</b> 순서로 나눠 갖습니다. 당신이 첫 선택, 봇이 두 번째 선택자라 초기 Initiative는 봇입니다.</p>
      <div class="setup-actions"><button id="selectModeBtn" class="secondary">직접 선택으로</button>${saved ? '<button id="resumeBtn" class="secondary strong">저장 게임 이어하기</button>' : ''}</div>
    </section>
    ${setupDifficultyHtml()}
    <section class="setup-panel">
      <div class="draft-scoreboard"><div><span>당신</span><strong>${draft.human.map((u) => UNIT_DEFS[u].ko).join(' · ') || '아직 없음'}</strong></div><div class="draft-turn">${complete ? 'Draft Complete' : current === 'human' ? '당신이 1개 고르세요' : '봇 선택 중'}</div><div><span>봇</span><strong>${draft.bot.map((u) => UNIT_DEFS[u].ko).join(' · ') || '아직 없음'}</strong></div></div>
      <div class="unit-picker-grid draft-grid">${cards}</div>
      <div class="setup-footer"><div class="setup-note">봇의 드래프트 성향도 선택한 난이도의 영향을 받습니다.</div>${complete ? '<button id="startDraftBtn" class="primary">이 조합으로 시작</button>' : ''}</div>
    </section>
  </main>`;
    bindDifficultyButtons();
    document.querySelectorAll('[data-draft-unit]').forEach((btn) => btn.addEventListener('click', () => pickDraft(btn.dataset.draftUnit)));
    document.querySelector('#selectModeBtn')?.addEventListener('click', () => { setupMode = 'SELECT'; draft = null; renderSetup(); });
    document.querySelector('#startDraftBtn')?.addEventListener('click', startDraftGame);
    document.querySelector('#resumeBtn')?.addEventListener('click', resumeGame);
}
function bindDifficultyButtons() {
    document.querySelectorAll('.difficulty-btn').forEach((btn) => btn.addEventListener('click', () => {
        difficulty = btn.dataset.difficulty;
        saveSettings();
        if (setupMode === 'DRAFT' && draft && draft.step < DRAFT_ORDER.length)
            advanceBotDraft();
        renderSetup();
    }));
}
function renderSetup() {
    const saved = loadSavedState();
    if (setupMode === 'DRAFT') {
        renderDraftSetup(saved);
        return;
    }
    const cards = ALL_UNITS.map((type) => {
        const d = UNIT_DEFS[type];
        const selected = setupHuman.has(type);
        return `<button class="unit-pick ${selected ? 'selected' : ''}" data-unit="${type}" style="--accent:${d.accent}">
      <span class="unit-pick-top"><span class="unit-dot"></span><strong>${esc(d.ko)}</strong><span>${d.coinCount}코인</span></span>
      <span class="unit-eng">${esc(d.name)}</span><span class="unit-rule">${esc(d.rules)}</span>
    </button>`;
    }).join('');
    app.innerHTML = `<main class="setup-shell">
    <section class="hero-card"><div class="eyebrow">LOCAL SOLO · UNOFFICIAL</div><h1>War Chest Solo</h1>
      <p>기본판 16종 유닛을 텍스트/도형으로 재구성한 로컬 1인용 구현입니다. 서버·로그인·원작 이미지 없이 브라우저에서만 동작합니다.</p>
      <div class="setup-actions"><button id="recommendedBtn" class="secondary">추천 첫 게임</button><button id="randomBtn" class="secondary">무작위 4 vs 4</button><button id="draftBtn" class="secondary strong">8유닛 드래프트</button>${saved ? '<button id="resumeBtn" class="secondary strong">저장 게임 이어하기</button>' : ''}</div>
    </section>
    ${setupDifficultyHtml()}
    <section class="setup-panel"><div class="setup-heading"><div><div class="eyebrow">YOUR ARMY</div><h2>유닛 4종 선택</h2></div><div class="selection-count">${setupHuman.size} / 4</div></div>
      <div class="unit-picker-grid">${cards}</div>
      <div class="setup-footer"><div class="setup-note">직접 선택 시 봇은 겹치지 않는 4종을 사용합니다. 드래프트를 선택하면 공식 snake 순서로 8종을 나눠 갖습니다.</div><button id="startBtn" class="primary" ${setupHuman.size === 4 ? '' : 'disabled'}>게임 시작</button></div>
    </section>
  </main>`;
    bindDifficultyButtons();
    document.querySelectorAll('.unit-pick').forEach((btn) => btn.addEventListener('click', () => {
        const type = btn.dataset.unit;
        setupBotOverride = null;
        if (setupHuman.has(type))
            setupHuman.delete(type);
        else if (setupHuman.size < 4)
            setupHuman.add(type);
        renderSetup();
    }));
    document.querySelector('#recommendedBtn')?.addEventListener('click', () => { setupHuman = new Set(RECOMMENDED_HUMAN); setupBotOverride = [...RECOMMENDED_BOT]; renderSetup(); });
    document.querySelector('#randomBtn')?.addEventListener('click', () => { const shuffled = randomSubset(ALL_UNITS, 8); setupHuman = new Set(shuffled.slice(0, 4)); setupBotOverride = shuffled.slice(4, 8); renderSetup(); });
    document.querySelector('#draftBtn')?.addEventListener('click', beginDraft);
    document.querySelector('#resumeBtn')?.addEventListener('click', resumeGame);
    document.querySelector('#startBtn')?.addEventListener('click', startGame);
}
function playerName(id) { return id === 'human' ? '당신' : '봇'; }
function unitCardMini(type, owner) {
    if (!state)
        return '';
    const d = UNIT_DEFS[type];
    const p = state.players[owner];
    const supply = p.supply[type] ?? 0;
    const boardStrength = state.boardUnits.filter((u) => u.owner === owner && u.type === type).reduce((n, u) => n + u.strength, 0);
    const removed = p.removed.filter((c) => c === type).length;
    return `<article class="mini-card" style="--accent:${d.accent}"><div class="mini-title"><span class="unit-dot"></span><strong>${esc(d.ko)}</strong><span class="mini-eng">${esc(d.name)}</span></div><div class="mini-stats"><span>Supply ${supply}</span><span>Board ${boardStrength}</span><span>Out ${removed}</span></div><div class="mini-rule">${esc(d.rules)}</div></article>`;
}
function bagSummary(id) {
    if (!state)
        return '';
    const p = state.players[id];
    if (id === 'bot')
        return `${p.bag.length}개`;
    const counts = new Map();
    for (const coin of p.bag)
        counts.set(coin, (counts.get(coin) ?? 0) + 1);
    const detail = [...counts.entries()].map(([coin, count]) => `${coin === 'ROYAL' ? 'Royal' : UNIT_DEFS[coin].ko}×${count}`).join(', ');
    return `${p.bag.length}개${detail ? ` · ${detail}` : ''}`;
}
function discardSummary(id) {
    if (!state)
        return '';
    const p = state.players[id];
    const up = p.discard.filter((d) => d.faceUp).map((d) => coinLabel(d.coin));
    if (id === 'human') {
        const down = p.discard.filter((d) => !d.faceUp).map((d) => coinLabel(d.coin));
        return `앞면 ${up.length}${up.length ? ` (${up.join(', ')})` : ''} · 뒷면 ${down.length}${down.length ? ` (${down.join(', ')})` : ''}`;
    }
    return `앞면 ${up.length}${up.length ? ` (${up.join(', ')})` : ''} · 뒷면 ${p.discard.filter((d) => !d.faceUp).length}`;
}
function renderPlayerPanel(id) {
    if (!state)
        return '';
    const p = state.players[id];
    const controlled = 6 - p.markersRemaining;
    const initiative = state.initiative === id ? '<span class="initiative-badge">Initiative</span>' : '';
    const hand = id === 'human' ? p.hand.map((c) => coinLabel(c)).join(', ') || '없음' : `${p.hand.length}개 (비공개)`;
    return `<section class="player-panel ${id}"><div class="player-heading"><div><div class="eyebrow">${id === 'human' ? 'PLAYER' : `BOT · ${difficultyLabel(difficulty).toUpperCase()}`}</div><h2>${playerName(id)} ${initiative}</h2></div><div class="control-score"><strong>${controlled}</strong><span>/ 6 Locations</span></div></div>
    <div class="resource-strip"><span><b>Hand</b> ${esc(hand)}</span><span><b>Bag</b> ${esc(bagSummary(id))}</span><span><b>Discard</b> ${esc(discardSummary(id))}</span></div><div class="mini-card-row">${p.units.map((u) => unitCardMini(u, id)).join('')}</div></section>`;
}
function axialToPixel(id) {
    const { q, r } = parseHex(id);
    const size = 43;
    return { x: 360 + size * Math.sqrt(3) * (q + r / 2), y: 285 + size * 1.5 * r };
}
function hexPoints(cx, cy, size = 40) {
    const pts = [];
    for (let i = 0; i < 6; i += 1) {
        const angle = (Math.PI / 180) * (60 * i - 30);
        pts.push(`${cx + size * Math.cos(angle)},${cy + size * Math.sin(angle)}`);
    }
    return pts.join(' ');
}
function renderBoardSvg() {
    if (!state)
        return '';
    const hexes = BOARD_HEXES.map((id) => {
        const { x, y } = axialToPixel(id);
        const isLocation = ALL_LOCATIONS.includes(id);
        const controller = state.locations[id];
        const unit = state.boardUnits.find((u) => u.hex === id);
        const preview = previewHexes.has(id);
        let fill = '#d7c398';
        if (isLocation)
            fill = controller === 'human' ? '#8fbab4' : controller === 'bot' ? '#c48e88' : '#cbb77e';
        const locationMark = isLocation ? `<circle cx="${x}" cy="${y}" r="24" fill="rgba(255,248,224,.22)" stroke="${controller === 'human' ? '#173f46' : controller === 'bot' ? '#602e34' : '#6b5a32'}" stroke-width="3" stroke-dasharray="5 4"/><path d="M ${x - 8} ${y + 9} L ${x - 8} ${y - 10} L ${x + 9} ${y - 5} L ${x - 8} ${y} Z" fill="${controller === 'human' ? '#174f59' : controller === 'bot' ? '#7c353c' : '#7b693d'}" opacity=".85"/>` : '';
        let unitMark = '';
        if (unit) {
            const d = UNIT_DEFS[unit.type];
            const ownerFill = unit.owner === 'human' ? '#123f48' : '#6f3037';
            unitMark = `<g class="token"><circle cx="${x}" cy="${y}" r="29" fill="#2d251a" opacity=".22" transform="translate(0 3)"/><circle cx="${x}" cy="${y}" r="27" fill="${ownerFill}" stroke="#e1c681" stroke-width="3"/><circle cx="${x}" cy="${y}" r="22" fill="none" stroke="${d.accent}" stroke-width="3"/><text x="${x}" y="${y + 5}" text-anchor="middle" class="unit-short">${d.short}</text>${unit.strength > 1 ? `<circle cx="${x + 22}" cy="${y - 21}" r="12" fill="#f0e3bd" stroke="#463a27" stroke-width="2"/><text x="${x + 22}" y="${y - 17}" text-anchor="middle" class="stack-count">${unit.strength}</text>` : ''}<title>${playerName(unit.owner)} ${d.ko} · stack ${unit.strength} · ${coordinateLabel(id)}</title></g>`;
        }
        return `<g class="hex-cell ${preview ? 'preview' : ''}"><polygon points="${hexPoints(x, y)}" fill="${fill}" stroke="${preview ? '#f4c75b' : '#6f5e3d'}" stroke-width="${preview ? 5 : 2}"/>${locationMark}${unitMark}<text x="${x}" y="${y + 35}" text-anchor="middle" class="coord-text">${esc(coordinateLabel(id))}</text></g>`;
    }).join('');
    return `<svg class="battlefield" viewBox="0 0 720 570" role="img" aria-label="War Chest battlefield"><defs><pattern id="felt" width="18" height="18" patternUnits="userSpaceOnUse"><rect width="18" height="18" fill="#30463d"/><circle cx="4" cy="5" r="1" fill="#40594e" opacity=".5"/><circle cx="14" cy="12" r="1" fill="#21372f" opacity=".5"/></pattern><filter id="boardShadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-opacity=".28"/></filter></defs><rect x="16" y="16" width="688" height="538" rx="42" fill="#5f432b" filter="url(#boardShadow)"/><rect x="29" y="29" width="662" height="512" rx="34" fill="url(#felt)"/>${hexes}</svg>`;
}
function renderBoardOnly() { const board = document.querySelector('#boardHost'); if (board)
    board.innerHTML = renderBoardSvg(); }
function coinButtons() {
    if (!state)
        return '';
    if (state.forcedCoin?.player === 'human') {
        const c = state.forcedCoin.coin;
        return `<div class="forced-coin"><span>전투 사제 추가 코인</span><strong>${esc(coinLabel(c))}</strong><small>지금 즉시 사용해야 합니다.</small></div>`;
    }
    return state.players.human.hand.map((coin, index) => `<button class="coin-button ${index === selectedCoinIndex ? 'selected' : ''}" data-coin-index="${index}"><span class="coin-face">${coin === 'ROYAL' ? '♛' : UNIT_DEFS[coin].short}</span><span>${esc(coinLabel(coin))}</span></button>`).join('');
}
function humanCandidates() {
    if (!state || state.activePlayer !== 'human' || state.winner)
        return [];
    if (state.pending)
        return generatePendingActions(state);
    if (state.forcedCoin?.player === 'human')
        return generateActionsForCoin(state, 'human', state.forcedCoin.coin, 'FORCED');
    const hand = state.players.human.hand;
    if (!hand.length)
        return [];
    selectedCoinIndex = Math.max(0, Math.min(selectedCoinIndex, hand.length - 1));
    return generateActionsForCoin(state, 'human', hand[selectedCoinIndex], 'HAND', selectedCoinIndex);
}
function renderActionPanel(actions = []) {
    if (!state)
        return '';
    if (state.winner) {
        const win = state.winner === 'human';
        return `<div class="result-card ${win ? 'win' : 'lose'}"><div class="eyebrow">GAME OVER</div><h2>${win ? '승리!' : '패배'}</h2><p>${win ? 'Control Marker 6개를 모두 배치했습니다.' : '봇이 먼저 6개 Location을 장악했습니다.'}</p><button id="againBtn" class="primary">새 게임</button></div>`;
    }
    if (state.activePlayer === 'bot')
        return `<div class="thinking-card"><div class="bot-pulse"></div><div><strong>${difficultyLabel(difficulty)} 봇이 계산 중...</strong><p>${difficulty === 'HARD' ? '후보 행동을 가상 적용해 보드 가치까지 비교합니다.' : '현재 합법 행동을 평가하고 있습니다.'}</p></div></div>`;
    const grouped = new Map();
    for (const action of actions) {
        if (!grouped.has(action.group))
            grouped.set(action.group, []);
        grouped.get(action.group).push(action);
    }
    const groupsHtml = [...grouped.entries()].map(([group, items]) => `<details class="action-group" open><summary>${esc(group)} <span>${items.length}</span></summary><div class="action-buttons">${items.map((a) => `<button class="action-btn" data-action-id="${a.id}">${esc(a.label)}</button>`).join('')}</div></details>`).join('');
    const context = state.pending ? '특수 능력의 후속 행동을 선택하세요.' : state.forcedCoin ? '전투 사제가 뽑은 코인을 즉시 사용하세요.' : '손의 코인을 고르면 가능한 수만 표시됩니다. 버튼에 마우스를 올리면 보드에서 경로가 강조됩니다.';
    return `<div class="action-header"><div class="eyebrow">YOUR TURN · ROUND ${state.round}</div><h2>행동 선택</h2><p>${esc(context)}</p></div>${!state.pending ? `<div class="hand-row">${coinButtons()}</div>` : '<div class="ability-banner">특수 능력 해결 중</div>'}<div class="action-scroll">${groupsHtml || '<p class="muted">가능한 행동이 없습니다.</p>'}</div>`;
}
function boardStrength(id) { return state?.boardUnits.filter((u) => u.owner === id).reduce((n, u) => n + u.strength, 0) ?? 0; }
function locationThreats(id) {
    if (!state)
        return 0;
    const foe = id === 'human' ? 'bot' : 'human';
    return ALL_LOCATIONS.filter((h) => state.locations[h] !== id && state.boardUnits.some((u) => u.owner === id && distance(u.hex, h) <= 1) && !state.boardUnits.some((u) => u.owner === foe && u.hex === h)).length;
}
function renderAnalysis() {
    if (!state)
        return '';
    const hLoc = 6 - state.players.human.markersRemaining;
    const bLoc = 6 - state.players.bot.markersRemaining;
    const hStr = boardStrength('human');
    const bStr = boardStrength('bot');
    const hOut = state.players.human.removed.length;
    const bOut = state.players.bot.removed.length;
    let summary = '균형';
    const delta = (hLoc - bLoc) * 3 + (hStr - bStr) + (bOut - hOut) * .5;
    if (delta >= 3)
        summary = '당신 우세';
    else if (delta <= -3)
        summary = '봇 우세';
    return `<section class="analysis-panel"><div class="eyebrow">POSITION ANALYSIS</div><div class="analysis-title"><h3>${summary}</h3><span>간이 지표</span></div><div class="metric-grid"><div><span>거점</span><b>${hLoc} : ${bLoc}</b></div><div><span>보드 전력</span><b>${hStr} : ${bStr}</b></div><div><span>제거 코인</span><b>${hOut} : ${bOut}</b></div><div><span>점령 압박</span><b>${locationThreats('human')} : ${locationThreats('bot')}</b></div></div><p>왼쪽이 당신, 오른쪽이 봇. 평가는 승률 예측이 아니라 현재 보드의 단순 비교입니다.</p></section>`;
}
function renderBotThought() {
    if (!lastBotThought)
        return `<section class="bot-thought"><div class="eyebrow">BOT EXPLAIN</div><h3>아직 공개할 수가 없습니다</h3><p>봇이 한 수 두면 선택 이유와 상위 후보가 여기에 표시됩니다.</p></section>`;
    return `<section class="bot-thought"><div class="eyebrow">BOT EXPLAIN · ROUND ${lastBotThought.round}</div><h3>${esc(lastBotThought.label)}</h3><p>${esc(lastBotThought.reason)}</p><details><summary>비교한 상위 후보</summary><ol>${lastBotThought.alternatives.map((a) => `<li><span>${esc(a.label)}</span><b>${Math.round(a.score)}</b></li>`).join('')}</ol></details></section>`;
}
function renderLog() {
    if (!state)
        return '';
    const entries = [...state.log].slice(-20).reverse();
    return `<section class="log-panel"><div class="eyebrow">BATTLE LOG</div><h3>최근 행동</h3><ol>${entries.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></section>`;
}
function renderStatusBar() {
    if (!state)
        return '';
    const active = state.activePlayer === 'human' ? '당신 차례' : '봇 차례';
    const initiative = state.initiative === 'human' ? '당신' : '봇';
    return `<div class="status-bar"><span><b>Round ${state.round}</b></span><span class="turn-pill ${state.activePlayer}">${active}</span><span>다음 Initiative: <b>${initiative}</b></span><span class="difficulty-chip">BOT ${difficultyLabel(difficulty)}</span></div>`;
}
function undoLastHumanTurn() {
    if (botBusy || undoStack.length === 0)
        return;
    const previous = undoStack.pop();
    if (!previous)
        return;
    state = cloneState(previous);
    lastBotThought = null;
    botThoughtHistory.pop();
    selectedCoinIndex = 0;
    previewHexes.clear();
    saveState();
    render();
}
function renderGame() {
    if (!state)
        return;
    const actions = state.activePlayer === 'human' && !state.winner ? humanCandidates() : [];
    const sanity = stateSanity(state);
    app.innerHTML = `<main class="game-shell"><header class="topbar"><div><div class="eyebrow">UNOFFICIAL LOCAL SOLO</div><h1>War Chest Solo</h1></div><div class="topbar-actions"><button id="undoBtn" class="ghost" ${undoStack.length && !botBusy ? '' : 'disabled'}>↶ Undo</button><button id="rulesBtn" class="ghost">룰 메모</button><button id="restartBtn" class="ghost danger">처음부터</button></div></header>
    ${renderStatusBar()}${sanity.length ? `<div class="debug-warning">상태 검사 경고: ${esc(sanity.join(' / '))}</div>` : ''}${renderPlayerPanel('bot')}
    <section class="main-grid"><div class="board-panel"><div id="boardHost">${renderBoardSvg()}</div><div class="board-legend"><span><i class="legend-dot human"></i>당신</span><span><i class="legend-dot bot"></i>봇</span><span><i class="legend-location"></i>Location</span><span class="legend-hint">노란 외곽선 = 선택 행동 관련 칸</span></div></div><aside class="action-panel">${renderActionPanel(actions)}</aside><div class="intel-rail">${renderBotThought()}${renderAnalysis()}${renderLog()}</div></section>
    ${renderPlayerPanel('human')}<footer class="footnote">개인 학습용 비공식 구현. 원작 아트/카드 이미지는 포함하지 않습니다.</footer></main>
    <dialog id="rulesDialog" class="rules-dialog"><form method="dialog"><button class="dialog-close">×</button></form><div class="eyebrow">QUICK RULES</div><h2>빠른 룰 메모</h2><p>한 라운드에 각자 코인 3개를 뽑고 Initiative 보유자부터 번갈아 1개씩 사용합니다.</p><ul><li><b>배치/강화:</b> 유닛 코인을 보드에 직접 놓습니다.</li><li><b>뒷면:</b> Initiative, Recruit, Pass.</li><li><b>앞면:</b> Move, Attack, Control, Tactic.</li><li><b>승리:</b> Control Marker 6개를 모두 보드에 놓으면 즉시 승리합니다.</li><li><b>공격:</b> 맞은 스택에서 코인 1개를 게임에서 제거합니다.</li></ul><p class="muted">Undo는 직전 당신의 주 행동 직전으로 돌아가며, 그 뒤 봇이 둔 응수까지 함께 취소합니다.</p></dialog>`;
    document.querySelector('#restartBtn')?.addEventListener('click', () => { if (confirm('현재 게임을 버리고 새로 시작할까요?'))
        newGameSetup(); });
    document.querySelector('#againBtn')?.addEventListener('click', newGameSetup);
    document.querySelector('#undoBtn')?.addEventListener('click', undoLastHumanTurn);
    document.querySelector('#rulesBtn')?.addEventListener('click', () => document.querySelector('#rulesDialog')?.showModal());
    document.querySelectorAll('.coin-button').forEach((btn) => btn.addEventListener('click', () => { selectedCoinIndex = Number(btn.dataset.coinIndex ?? 0); previewHexes.clear(); renderGame(); }));
    const actionMap = new Map(actions.map((a) => [a.id, a]));
    document.querySelectorAll('.action-btn').forEach((btn) => {
        const action = actionMap.get(btn.dataset.actionId ?? '');
        if (!action)
            return;
        btn.addEventListener('mouseenter', () => { previewHexes = new Set(action.relatedHexes); renderBoardOnly(); });
        btn.addEventListener('mouseleave', () => { previewHexes.clear(); renderBoardOnly(); });
        btn.addEventListener('click', () => {
            if (!state)
                return;
            previewHexes.clear();
            try {
                if (action.source === 'HAND')
                    undoStack.push(cloneState(state));
                executeAction(state, action);
                afterResolvedAction(state);
                selectedCoinIndex = 0;
                saveState();
                render();
            }
            catch (error) {
                console.error(error);
                alert(`행동 처리 중 오류: ${error instanceof Error ? error.message : String(error)}`);
            }
        });
    });
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function rememberBotDecision(decision) {
    if (!state)
        return;
    const thought = { round: state.round, label: decision.action.label, reason: decision.reason, score: decision.score, alternatives: decision.alternatives };
    lastBotThought = thought;
    botThoughtHistory.push(thought);
    if (botThoughtHistory.length > 30)
        botThoughtHistory.shift();
}
async function runBot() {
    if (!state || botBusy || state.activePlayer !== 'bot' || state.winner)
        return;
    botBusy = true;
    try {
        let guard = 0;
        while (state && state.activePlayer === 'bot' && !state.winner && guard < 30) {
            guard += 1;
            await sleep(difficulty === 'HARD' ? 520 : difficulty === 'EASY' ? 260 : 400);
            const decision = chooseBotDecision(state, difficulty);
            if (!decision) {
                afterResolvedAction(state);
                break;
            }
            rememberBotDecision(decision);
            executeAction(state, decision.action);
            afterResolvedAction(state);
            saveState();
            renderGame();
        }
    }
    catch (error) {
        console.error(error);
        alert(`봇 처리 중 오류: ${error instanceof Error ? error.message : String(error)}`);
    }
    finally {
        botBusy = false;
        render();
    }
}
function render() {
    if (!state)
        renderSetup();
    else {
        renderGame();
        if (state.activePlayer === 'bot' && !state.winner)
            void runBot();
    }
}
render();
