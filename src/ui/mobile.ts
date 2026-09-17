const MOBILE_QUERY = '(max-width: 760px), (hover: none) and (pointer: coarse)';
const STORAGE_KEY = 'war-chest-solo-local-v2';
const GENERATED_ATTR = 'data-responsive-ui-generated';
const LAST_BOT_ACTION_KEY = 'war-chest-solo-last-bot-action-v1';
const SVG_NS = 'http://www.w3.org/2000/svg';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';

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

function onMouseEnterCapture(event: MouseEvent): void {
  if (!isMobileUi()) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (!target.closest('.unit-token[data-board-key]')) return;

  // Touch browsers may synthesize mouseenter immediately before a tap. The
  // battlefield tap must select the Unit rather than open the large info card.
  event.stopImmediatePropagation();
  closeUnitTooltip();
}

function onPointerDownCapture(event: PointerEvent): void {
  if (!isMobileUi()) return;
  tooltipVisibleAtPointerDown = Boolean(visibleUnitTooltip());

  // Setup cards consume the next tap while their info card is open, but a tap
  // on a battlefield interaction must always reach the game input handler.
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

function sourceActionChips(): SVGGElement[] {
  const popover = document.querySelector<SVGGElement>('.unit-action-popover');
  if (!popover) return [];
  return Array.from(popover.querySelectorAll<SVGGElement>('.board-action-chip[data-board-key]'));
}

function actionLabel(source: Element): string {
  if (source.classList.contains('bolster')) return '증원';
  if (source.classList.contains('tactic')) return '전술';
  if (source.classList.contains('control')) return '점령';
  return source.textContent?.trim() || '행동';
}

function actionClass(source: Element): string {
  if (source.classList.contains('bolster')) return 'bolster';
  if (source.classList.contains('tactic')) return 'tactic';
  if (source.classList.contains('control')) return 'control';
  return '';
}

function syncBoardUnitActionOverlay(): void {
  const svg = document.querySelector<SVGSVGElement>('.battlefield');
  if (!svg) return;

  const sourcePopover = svg.querySelector<SVGGElement>('.unit-action-popover');
  const sources = sourceActionChips();
  const existing = svg.querySelector<SVGForeignObjectElement>('.board-unit-action-overlay');

  if (!sourcePopover || !sources.length) {
    existing?.remove();
    return;
  }

  const unitId = sourcePopover.dataset.actionFor;
  if (!unitId) {
    existing?.remove();
    return;
  }

  // Once a Unit is selected, main.ts rerenders it without data-board-key because
  // the next legal inputs are the special actions. interaction-selected is the
  // stable marker for the token that the action buttons belong to.
  const unit = svg.querySelector<SVGGElement>('.unit-token.interaction-selected')
    ?? svg.querySelector<SVGGElement>(`.unit-token[data-board-key="unit:${unitId}"]`);
  const center = unit?.querySelector<SVGCircleElement>('circle');
  if (!center) {
    existing?.remove();
    return;
  }

  const cx = Number(center.getAttribute('cx'));
  const cy = Number(center.getAttribute('cy'));
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
    existing?.remove();
    return;
  }

  const mobile = isMobileUi();
  const buttonWidth = mobile ? 112 : 76;
  const gap = mobile ? 10 : 7;
  const height = mobile ? 72 : 44;
  const totalWidth = sources.length * buttonWidth + Math.max(0, sources.length - 1) * gap;
  const viewLeft = 54;
  const viewRight = 906;
  const viewTop = 58;
  const x = Math.max(viewLeft + 4, Math.min(cx - totalWidth / 2, viewRight - totalWidth - 4));
  const y = Math.max(viewTop + 4, cy - 33 - height - 10);
  const signature = `${unitId}:${mobile ? 'm' : 'd'}:${sources.map((source) => source.dataset.boardKey ?? '').join('|')}:${x}:${y}`;

  if (existing?.dataset.signature === signature) return;
  existing?.remove();

  const foreignObject = document.createElementNS(SVG_NS, 'foreignObject') as SVGForeignObjectElement;
  foreignObject.classList.add('board-unit-action-overlay');
  foreignObject.setAttribute(GENERATED_ATTR, 'true');
  foreignObject.dataset.signature = signature;
  foreignObject.dataset.actionFor = unitId;
  foreignObject.setAttribute('x', String(x));
  foreignObject.setAttribute('y', String(y));
  foreignObject.setAttribute('width', String(totalWidth));
  foreignObject.setAttribute('height', String(height));
  foreignObject.setAttribute('overflow', 'visible');

  const row = document.createElementNS(XHTML_NS, 'div') as HTMLDivElement;
  row.className = 'board-unit-action-buttons';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', '선택한 유닛 행동');

  for (const source of sources) {
    const key = source.dataset.boardKey;
    if (!key) continue;
    const button = document.createElementNS(XHTML_NS, 'button') as HTMLButtonElement;
    const cls = actionClass(source);
    button.type = 'button';
    button.className = `board-unit-action-button ${cls}`.trim();
    button.dataset.proxyBoardKey = key;
    button.textContent = actionLabel(source);
    row.append(button);
  }

  foreignObject.append(row);
  svg.append(foreignObject);
}

function syncResponsiveUi(): void {
  syncQueued = false;
  captureBotActionToast();
  syncBoardUnitActionOverlay();

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

  // A touch device can emit more than one click-like event around a DOM
  // replacement. Mark the visible action as consumed before forwarding it so
  // Bolster/Tactic/Control can never be dispatched twice from the same overlay.
  if (button.dataset.actionFired === 'true' || button.disabled) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  button.dataset.actionFired = 'true';
  document.querySelectorAll<HTMLButtonElement>('.board-unit-action-button').forEach((candidate) => {
    candidate.disabled = true;
    candidate.setAttribute('aria-disabled', 'true');
  });

  const key = button.dataset.proxyBoardKey;
  if (!key) return;
  const source = sourceActionChips().find((candidate) => candidate.dataset.boardKey === key);
  if (!source) return;

  event.preventDefault();
  event.stopPropagation();
  source.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
}

function startResponsiveUi(): void {
  document.addEventListener('mouseenter', onMouseEnterCapture, true);
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
