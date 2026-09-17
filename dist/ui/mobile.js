"use strict";
const MOBILE_QUERY = '(max-width: 760px), (hover: none) and (pointer: coarse)';
const STORAGE_KEY = 'war-chest-solo-local-v2';
const GENERATED_ATTR = 'data-responsive-ui-generated';
const LAST_BOT_ACTION_KEY = 'war-chest-solo-last-bot-action-v1';
let tooltipVisibleAtPointerDown = false;
let syncQueued = false;
function isMobileUi() {
    return window.matchMedia(MOBILE_QUERY).matches;
}
function visibleUnitTooltip() {
    return document.querySelector('#unitTooltip.visible:not([hidden])');
}
function closeUnitTooltip() {
    const tooltip = visibleUnitTooltip();
    if (!tooltip)
        return;
    tooltip.classList.remove('visible');
    tooltip.hidden = true;
}
function isGameplayActionTarget(target) {
    return target instanceof Element && Boolean(target.closest('[data-board-key]'));
}
function onMouseEnterCapture(event) {
    if (!isMobileUi())
        return;
    const target = event.target;
    if (!(target instanceof Element))
        return;
    if (!target.closest('.unit-token[data-board-key]'))
        return;
    event.stopImmediatePropagation();
    closeUnitTooltip();
}
function onPointerDownCapture(event) {
    if (!isMobileUi())
        return;
    tooltipVisibleAtPointerDown = Boolean(visibleUnitTooltip());
    if (isGameplayActionTarget(event.target) && tooltipVisibleAtPointerDown)
        closeUnitTooltip();
}
function onClickCapture(event) {
    if (!isMobileUi())
        return;
    if (isGameplayActionTarget(event.target)) {
        tooltipVisibleAtPointerDown = false;
        closeUnitTooltip();
        return;
    }
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
function removeBotLastAction() {
    document.querySelector('.mobile-bot-last-action')?.remove();
}
function localizeBoardActionChips() {
    document.querySelectorAll('.unit-action-popover .board-action-chip').forEach((chip) => {
        const label = chip.querySelector('text');
        if (!label)
            return;
        if (chip.classList.contains('bolster'))
            label.textContent = '증원';
        else if (chip.classList.contains('tactic'))
            label.textContent = '전술';
        else if (chip.classList.contains('control'))
            label.textContent = '점령';
    });
}
function syncResponsiveUi() {
    syncQueued = false;
    captureBotActionToast();
    localizeBoardActionChips();
    if (isMobileUi())
        syncBotLastAction();
    else
        removeBotLastAction();
}
function queueSync() {
    if (syncQueued)
        return;
    syncQueued = true;
    requestAnimationFrame(syncResponsiveUi);
}
function startResponsiveUi() {
    document.addEventListener('mouseenter', onMouseEnterCapture, true);
    document.addEventListener('pointerdown', onPointerDownCapture, true);
    document.addEventListener('click', onClickCapture, true);
    const observer = new MutationObserver(queueSync);
    observer.observe(document.body, { childList: true, subtree: true });
    window.matchMedia(MOBILE_QUERY).addEventListener('change', queueSync);
    window.addEventListener('storage', queueSync);
    queueSync();
}
startResponsiveUi();
