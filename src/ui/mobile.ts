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
  return target instanceof Element && Boolean(target.closest('[data-board-key], [data-proxy-board-key]'));
}

function onPointerDownCapture(event: PointerEvent): void {
  if (!isMobileUi()) return;
  tooltipVisibleAtPointerDown = Boolean(visibleUnitTooltip());

  // Setup cards intentionally consume the next tap when their Unit tooltip is open,
  // but battlefield taps must always reach the board interaction handler. Otherwise
  // a synthetic hover/touch tooltip can swallow the Unit tap before Bolster/Tactic
  // choices are rendered.
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

function actionLabel(source: Element): string {
  if (source.classList.contains('bolster')) return '증원';
  if (source.classList.contains('tactic')) return '전술';
  if (source.classList.contains('control')) return '점령';
  return source.textContent?.trim() || '행동';
}

function selectedActionSources(): SVGGElement[] {
  const popover = document.querySelector<SVGGElement>('.unit-action-popover');
  if (!popover) return [];
  return Array.from(popover.querySelectorAll<SVGGElement>('.board-action-chip[data-board-key]'));
}

function syncUnitActionBar(): void {
  const hud = document.querySelector<HTMLElement>('.interaction-hud');
  const existing = document.querySelector<HTMLElement>('.context-unit-actions');
  const sources = selectedActionSources();

  if (!hud || !sources.length) {
    existing?.remove();
    return;
  }

  const popover = sources[0].closest<SVGGElement>('.unit-action-popover');
  const unitId = popover?.dataset.actionFor ?? '';
  const signature = `${unitId}:${sources.map((source) => source.dataset.boardKey ?? '').join('|')}`;
  if (existing?.dataset.signature === signature && existing.parentElement === hud) return;
  existing?.remove();

  const bar = document.createElement('div');
  bar.className = 'context-unit-actions';
  bar.setAttribute(GENERATED_ATTR, 'true');
  bar.dataset.signature = signature;
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', '선택한 유닛 행동');

  const label = document.createElement('span');
  label.className = 'context-unit-actions-label';
  label.textContent = '선택 유닛';
  bar.append(label);

  for (const source of sources) {
    const key = source.dataset.boardKey;
    if (!key) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `context-unit-action ${source.classList.contains('bolster') ? 'bolster' : source.classList.contains('tactic') ? 'tactic' : source.classList.contains('control') ? 'control' : ''}`;
    button.dataset.proxyBoardKey = key;
    button.textContent = actionLabel(source);
    bar.append(button);
  }

  hud.append(bar);
}

function syncResponsiveUi(): void {
  syncQueued = false;
  captureBotActionToast();
  syncUnitActionBar();

  if (isMobileUi()) syncBotLastAction();
  else removeBotLastAction();
}

function queueSync(): void {
  if (syncQueued) return;
  syncQueued = true;
  requestAnimationFrame(syncResponsiveUi);
}

function onGeneratedActionClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  const button = target?.closest<HTMLButtonElement>('[data-proxy-board-key]');
  if (!button) return;

  const key = button.dataset.proxyBoardKey;
  if (!key) return;
  const source = selectedActionSources().find((candidate) => candidate.dataset.boardKey === key);
  if (!source) return;

  event.preventDefault();
  source.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
}

function startResponsiveUi(): void {
  document.addEventListener('pointerdown', onPointerDownCapture, true);
  document.addEventListener('click', onClickCapture, true);
  document.addEventListener('click', onGeneratedActionClick);

  const observer = new MutationObserver(queueSync);
  observer.observe(document.body, { childList: true, subtree: true });

  window.matchMedia(MOBILE_QUERY).addEventListener('change', queueSync);
  window.addEventListener('storage', queueSync);
  queueSync();
}

startResponsiveUi();
