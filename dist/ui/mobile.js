"use strict";
const MOBILE_QUERY = '(max-width: 760px), (hover: none) and (pointer: coarse)';
const STORAGE_KEY = 'war-chest-solo-local-v2';
const GENERATED_ATTR = 'data-mobile-ui-generated';
const LAST_BOT_ACTION_KEY = 'war-chest-solo-last-bot-action-v1';
let tooltipVisibleAtPointerDown = false;
let syncQueued = false;
function isMobileUi() {
    return window.matchMedia(MOBILE_QUERY).matches;
}
function visibleUnitTooltip() {
    const tooltip = document.querySelector('#unitTooltip.visible:not([hidden])');
    return tooltip ?? null;
}
function closeUnitTooltip() {
    const tooltip = visibleUnitTooltip();
    if (!tooltip)
        return;
    tooltip.classList.remove('visible');
    tooltip.hidden = true;
}
function onPointerDownCapture() {
    if (!isMobileUi())
        return;
    tooltipVisibleAtPointerDown = Boolean(visibleUnitTooltip());
}
function onClickCapture(event) {
    if (!isMobileUi())
        return;
    const shouldDismissTooltip = tooltipVisibleAtPointerDown && Boolean(visibleUnitTooltip());
    tooltipVisibleAtPointerDown = false;
    if (!shouldDismissTooltip)
        return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    closeUnitTooltip();
}
function readStoredState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw)
            return null;
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
function captureBotActionToast() {
    const text = document.querySelector('.action-playback-toast.bot strong')?.textContent?.trim();
    if (!text)
        return;
    if (sessionStorage.getItem(LAST_BOT_ACTION_KEY) !== text)
        sessionStorage.setItem(LAST_BOT_ACTION_KEY, text);
}
function findLastBotAction() {
    const logs = readStoredState()?.log;
    const fallback = Array.isArray(logs)
        ? [...logs].reverse().find((entry) => typeof entry === 'string' && entry.trim().startsWith('봇'))
        : undefined;
    if (!fallback) {
        sessionStorage.removeItem(LAST_BOT_ACTION_KEY);
        return '아직 봇의 행동이 없습니다.';
    }
    return sessionStorage.getItem(LAST_BOT_ACTION_KEY) ?? fallback;
}
function syncBotLastAction() {
    const header = document.querySelector('.integrated-header');
    if (!header)
        return;
    let panel = header.querySelector('.mobile-bot-last-action');
    if (!panel) {
        panel = document.createElement('div');
        panel.className = 'mobile-bot-last-action';
        panel.setAttribute(GENERATED_ATTR, 'true');
        panel.innerHTML = '<span>BOT LAST ACTION</span><strong></strong>';
        const actions = header.querySelector('.topbar-actions');
        header.insertBefore(panel, actions ?? null);
    }
    const text = panel.querySelector('strong');
    if (text) {
        const next = findLastBotAction();
        if (text.textContent !== next)
            text.textContent = next;
    }
}
function actionLabel(source) {
    if (source.classList.contains('bolster'))
        return '증원';
    if (source.classList.contains('tactic'))
        return '전술';
    if (source.classList.contains('control'))
        return '점령';
    return source.textContent?.trim() || '행동';
}
function syncUnitActionBar() {
    const hud = document.querySelector('.interaction-hud');
    const popover = document.querySelector('.unit-action-popover');
    const existing = document.querySelector('.mobile-unit-actions');
    if (!hud || !popover) {
        existing?.remove();
        return;
    }
    const sources = Array.from(popover.querySelectorAll('.board-action-chip[data-board-key]'));
    if (!sources.length) {
        existing?.remove();
        return;
    }
    const signature = sources.map((source) => source.dataset.boardKey ?? '').join('|');
    if (existing?.dataset.signature === signature && existing.parentElement === hud)
        return;
    existing?.remove();
    const bar = document.createElement('div');
    bar.className = 'mobile-unit-actions';
    bar.setAttribute(GENERATED_ATTR, 'true');
    bar.dataset.signature = signature;
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', '선택한 유닛 행동');
    const label = document.createElement('span');
    label.className = 'mobile-unit-actions-label';
    label.textContent = '선택 유닛';
    bar.append(label);
    for (const source of sources) {
        const key = source.dataset.boardKey;
        if (!key)
            continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `mobile-unit-action ${source.classList.contains('bolster') ? 'bolster' : source.classList.contains('tactic') ? 'tactic' : source.classList.contains('control') ? 'control' : ''}`;
        button.dataset.proxyBoardKey = key;
        button.textContent = actionLabel(source);
        bar.append(button);
    }
    hud.append(bar);
}
function removeGeneratedUi() {
    document.querySelectorAll(`[${GENERATED_ATTR}="true"]`).forEach((node) => node.remove());
}
function syncMobileUi() {
    syncQueued = false;
    if (!isMobileUi()) {
        removeGeneratedUi();
        return;
    }
    captureBotActionToast();
    syncBotLastAction();
    syncUnitActionBar();
}
function queueSync() {
    if (syncQueued)
        return;
    syncQueued = true;
    requestAnimationFrame(syncMobileUi);
}
function onGeneratedActionClick(event) {
    const target = event.target;
    const button = target?.closest('[data-proxy-board-key]');
    if (!button || !isMobileUi())
        return;
    const key = button.dataset.proxyBoardKey;
    if (!key)
        return;
    const source = Array.from(document.querySelectorAll('[data-board-key]'))
        .find((candidate) => candidate.dataset.boardKey === key && candidate.closest('.unit-action-popover'));
    source?.click();
}
function startMobileUi() {
    document.addEventListener('pointerdown', onPointerDownCapture, true);
    document.addEventListener('click', onClickCapture, true);
    document.addEventListener('click', onGeneratedActionClick);
    const observer = new MutationObserver(queueSync);
    observer.observe(document.body, { childList: true, subtree: true });
    window.matchMedia(MOBILE_QUERY).addEventListener('change', queueSync);
    window.addEventListener('storage', queueSync);
    queueSync();
}
startMobileUi();
