const MOBILE_QUERY = '(max-width: 760px), (hover: none) and (pointer: coarse)';
const STORAGE_KEY = 'war-chest-solo-local-v2';
const GENERATED_ATTR = 'data-responsive-ui-generated';
const LAST_BOT_ACTION_KEY = 'war-chest-solo-last-bot-action-v1';

type StoredGameState = {
  log?: string[];
};

let tooltipVisibleAtPointerDown = false;
let syncQueued = false;

function isMobileUi(): boolean {
  return window.matchMedia(MOBILE_QUERY).matches;
}

function visibleUnitTooltip(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#unitTooltip.visible:not([hidden])');
}

function closeUnitTooltip(): void {
  const tooltip = visibleUnitTooltip();
  if (!tooltip) return;
  tooltip.classList.remove('visible');
  tooltip.hidden = true;
}

function isGameplayActionTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('[data-board-key]'));
}

function onMouseEnterCapture(event: MouseEvent): void {
  if (!isMobileUi()) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (!target.closest('.unit-token[data-board-key]')) return;

  // Touch browsers and Playwright may synthesize mouseenter immediately before a
  // tap. Actionable battlefield Units use tap for gameplay, so do not let the
  // full-screen Unit tooltip cover the selected Unit and its action buttons.
  event.stopImmediatePropagation();
  closeUnitTooltip();
}

function onPointerDownCapture(event: PointerEvent): void {
  if (!isMobileUi()) return;
  tooltipVisibleAtPointerDown = Boolean(visibleUnitTooltip());

  // Setup cards intentionally consume the next tap when their Unit tooltip is open,
  // but battlefield taps must always reach the board interaction handler.
  if (isGameplayActionTarget(event.target) && tooltipVisibleAtPointerDown) closeUnitTooltip();
}

function onClickCapture(event: MouseEvent): void {
  if (!isMobileUi()) return;

  if (isGameplayActionTarget(event.target)) {
    tooltipVisibleAtPointerDown = false;
    closeUnitTooltip();
    return;
  }

  const shouldDismissTooltip = tooltipVisibleAtPointerDown && Boolean(visibleUnitTooltip());
  tooltipVisibleAtPointerDown = false;
  if (!shouldDismissTooltip) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  closeUnitTooltip();
}

function readStoredState(): StoredGameState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredGameState;
  } catch {
    return null;
  }
}

function captureBotActionToast(): void {
  const text = document.querySelector<HTMLElement>('.action-playback-toast.bot strong')?.textContent?.trim();
  if (!text) return;
  if (sessionStorage.getItem(LAST_BOT_ACTION_KEY) !== text) sessionStorage.setItem(LAST_BOT_ACTION_KEY, text);
}

function findLastBotAction(): string {
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

function syncBotLastAction(): void {
  const header = document.querySelector<HTMLElement>('.integrated-header');
  if (!header) return;

  let panel = header.querySelector<HTMLElement>('.mobile-bot-last-action');
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'mobile-bot-last-action';
    panel.setAttribute(GENERATED_ATTR, 'true');
    panel.innerHTML = '<span>BOT LAST ACTION</span><strong></strong>';
    const actions = header.querySelector('.topbar-actions');
    header.insertBefore(panel, actions ?? null);
  }

  const text = panel.querySelector<HTMLElement>('strong');
  if (text) {
    const next = findLastBotAction();
    if (text.textContent !== next) text.textContent = next;
  }
}

function removeBotLastAction(): void {
  document.querySelector<HTMLElement>('.mobile-bot-last-action')?.remove();
}

function localizeBoardActionChips(): void {
  document.querySelectorAll<SVGGElement>('.unit-action-popover .board-action-chip').forEach((chip) => {
    const label = chip.querySelector<SVGTextElement>('text');
    if (!label) return;
    if (chip.classList.contains('bolster')) label.textContent = '증원';
    else if (chip.classList.contains('tactic')) label.textContent = '전술';
    else if (chip.classList.contains('control')) label.textContent = '점령';
  });
}

function syncResponsiveUi(): void {
  syncQueued = false;
  captureBotActionToast();
  localizeBoardActionChips();

  if (isMobileUi()) syncBotLastAction();
  else removeBotLastAction();
}

function queueSync(): void {
  if (syncQueued) return;
  syncQueued = true;
  requestAnimationFrame(syncResponsiveUi);
}

function startResponsiveUi(): void {
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
