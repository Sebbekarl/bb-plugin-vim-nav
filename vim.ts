// Vimium-style keyboard navigation for the bb app shell.
//
// One capture-phase keydown listener runs a small normal mode: whenever focus
// is not in a text field, terminal, or browser tab, the keys below scroll,
// open link hints, or replay bb's own keyboard shortcuts (so bb keeps owning
// thread order, history, and the palettes). Esc in a text field leaves it.

interface Mapping {
  keys: string;
  description: string;
  group: string;
  run: () => void;
}

interface Shortcut {
  key: string;
  code: string;
  mod?: boolean;
  control?: boolean;
  shift?: boolean;
}

const IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const SCROLL_STEP = 60;
const HINT_CHARS = "sadfjklewcmpgh";
const COMPOSER_FOCUS_GUARD_MS = 1000;

// bb's default bindings for the commands we replay. bb matches the keydown's
// key and modifiers and accepts synthetic events, so a rebinding in
// Settings → Keyboard means updating the matching entry here.
const BB_SHORTCUTS = {
  threadNext: { key: "]", code: "BracketRight", mod: true, shift: true },
  threadPrevious: { key: "[", code: "BracketLeft", mod: true, shift: true },
  historyBack: { key: "[", code: "BracketLeft", mod: true },
  historyForward: { key: "]", code: "BracketRight", mod: true },
  threadSearch: { key: "k", code: "KeyK", mod: true },
  threadNew: { key: "o", code: "KeyO", mod: true, shift: true },
  palette: { key: "p", code: "KeyP", mod: true, shift: true },
  quickOpen: { key: "p", code: "KeyP", mod: true },
  composerFocus: { key: "c", code: "KeyC", mod: true, shift: true },
} satisfies Record<string, Shortcut>;

const SHIFTED_KEYS: Record<string, string> = { "[": "{", "]": "}", "\\": "|" };

const MODAL_SELECTOR = [
  `[aria-modal="true"]:not([inert]):not([inert] *):not([data-state="closed"])`,
  `[role="dialog"][data-state="open"]:not([inert]):not([inert] *)`,
].join(", ");
const POPUP_FOCUS_SELECTOR =
  '[role="menu"], [role="menubar"], [role="listbox"], [role="tree"], [role="grid"]';
const COMPOSER_SELECTOR = "[data-promptbox-shell], [data-composer-box]";
const THREAD_ROW_SELECTOR = "[data-sidebar-thread-shortcut-target]";
const TIMELINE_SELECTOR = "[data-page-scroll-viewport]";
const CLICKABLE_SELECTOR = [
  "a[href]",
  "button",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "summary",
  "[role=button]",
  "[role=link]",
  "[role=tab]",
  "[role=menuitem]",
  "[role=menuitemcheckbox]",
  "[role=menuitemradio]",
  "[role=option]",
  "[role=checkbox]",
  "[role=radio]",
  "[role=switch]",
  "[role=treeitem]",
  "[role=combobox]",
  "[contenteditable]:not([contenteditable=false])",
  "[tabindex]:not([tabindex='-1'])",
  "[onclick]",
].join(", ");
const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

const STYLE = `
.bb-vim-nav-hints { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; }
.bb-vim-nav-hint {
  position: absolute; padding: 0 3px; border-radius: 3px;
  font: 700 11px/15px ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase;
  color: #1c1917; background: #fde047; border: 1px solid #a16207;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.35); white-space: nowrap;
}
.bb-vim-nav-hint[hidden] { display: none; }
.bb-vim-nav-hint .bb-vim-nav-typed { color: #a16207; }
.bb-vim-nav-hud {
  position: fixed; right: 12px; bottom: 12px; z-index: 2147483647; pointer-events: none;
  padding: 2px 8px; border-radius: 4px; font: 600 12px/18px ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--popover-foreground, #e7e5e4); background: var(--popover, #1c1917);
  border: 1px solid var(--border, #44403c); box-shadow: 0 2px 8px rgb(0 0 0 / 0.3);
}
.bb-vim-nav-help-backdrop {
  position: fixed; inset: 0; z-index: 2147483646; display: flex; align-items: center; justify-content: center;
  background: rgb(0 0 0 / 0.45);
}
.bb-vim-nav-help {
  max-height: 85vh; overflow: auto; padding: 16px 20px; border-radius: 10px; min-width: 420px;
  color: var(--popover-foreground, #e7e5e4); background: var(--popover, #1c1917);
  border: 1px solid var(--border, #44403c); box-shadow: 0 10px 40px rgb(0 0 0 / 0.4);
  font: 13px/1.5 var(--font-sans, system-ui, sans-serif);
}
.bb-vim-nav-help h2 { margin: 0 0 8px; font-size: 15px; font-weight: 600; }
.bb-vim-nav-help h3 {
  margin: 12px 0 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--muted-foreground, #a8a29e);
}
.bb-vim-nav-help table { border-collapse: collapse; width: 100%; }
.bb-vim-nav-help td { padding: 2px 0; vertical-align: top; }
.bb-vim-nav-help td:first-child { width: 110px; padding-right: 12px; }
.bb-vim-nav-help kbd {
  display: inline-block; min-width: 18px; padding: 0 5px; margin-right: 3px; border-radius: 4px; text-align: center;
  font: 600 12px/18px ui-monospace, SFMono-Regular, Menlo, monospace;
  background: var(--muted, #292524); border: 1px solid var(--border, #44403c);
}
.bb-vim-nav-help .bb-vim-nav-footer { margin-top: 12px; color: var(--muted-foreground, #a8a29e); font-size: 12px; }
`;

interface Hint {
  element: HTMLElement;
  label: string;
  node: HTMLElement;
}

export function mountVimNav(signal: AbortSignal): () => void {
  let pending = "";
  let hints: Hint[] | null = null;
  let typedHint = "";
  let hintOverlay: HTMLElement | null = null;
  let repositionFrame = 0;
  let helpOverlay: HTMLElement | null = null;
  let hud: HTMLElement | null = null;
  let lastClicked: Element | null = null;
  let composerGuardUntil = 0;
  let replaying = false;

  const style = document.createElement("style");
  style.dataset.bbVimNav = "";
  style.textContent = STYLE;
  document.head.append(style);

  // ---- bb shortcut replay -------------------------------------------------

  function press(shortcut: Shortcut) {
    const target = deepActiveElement() ?? document.body;
    const control = shortcut.control === true || (shortcut.mod === true && !IS_MAC);
    const meta = shortcut.mod === true && IS_MAC;
    const shift = shortcut.shift === true;
    const key = shift ? (SHIFTED_KEYS[shortcut.key] ?? shortcut.key.toUpperCase()) : shortcut.key;
    replaying = true;
    try {
      for (const type of ["keydown", "keyup"]) {
        target.dispatchEvent(
          new KeyboardEvent(type, {
            key,
            code: shortcut.code,
            ctrlKey: control,
            metaKey: meta,
            shiftKey: shift,
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        );
      }
    } finally {
      replaying = false;
    }
  }

  // Thread and history moves land on a new page whose composer may grab
  // focus; keep normal mode so the next J/K still navigates.
  function navigate(shortcut: Shortcut) {
    lastClicked = null;
    press(shortcut);
    composerGuardUntil = performance.now() + COMPOSER_FOCUS_GUARD_MS;
  }

  // ---- scrolling ----------------------------------------------------------

  function scrollTarget(axis: "x" | "y"): Element | null {
    const modal = topModal();
    const within = (el: Element | null) => el !== null && el.isConnected && (!modal || modal.contains(el));
    for (const start of [lastClicked, deepActiveElement()]) {
      if (!start || !within(start) || start === document.body) continue;
      const found = scrollableAncestor(start, axis);
      if (found && within(found)) return found;
    }
    const root: ParentNode = modal ?? document;
    return (
      largest(root.querySelectorAll(TIMELINE_SELECTOR), (el) => isScrollable(el, axis)) ??
      largest(root.querySelectorAll("*"), (el) => isScrollable(el, axis))
    );
  }

  function scroll(axis: "x" | "y", amount: (el: Element) => number, smooth: boolean) {
    const el = scrollTarget(axis);
    if (!el) return;
    const delta = amount(el);
    // bb's chat keeps itself pinned to the newest message unless it sees user
    // input; a wheel event marks this scroll as one.
    el.dispatchEvent(
      new WheelEvent("wheel", {
        deltaX: axis === "x" ? delta : 0,
        deltaY: axis === "y" ? delta : 0,
        bubbles: true,
        cancelable: false,
      }),
    );
    el.scrollBy({
      left: axis === "x" ? delta : 0,
      top: axis === "y" ? delta : 0,
      behavior: smooth ? "smooth" : "instant",
    });
  }

  const scrollToEdge = (end: boolean) =>
    scroll("y", (el) => (end ? el.scrollHeight : -el.scrollHeight), false);

  // ---- link hints ---------------------------------------------------------

  function showHints() {
    const targets = collectHintTargets();
    if (targets.length === 0) return;
    const labels = hintLabels(targets.length);
    hintOverlay = document.createElement("div");
    hintOverlay.className = "bb-vim-nav-hints";
    hints = targets.map((element, index) => {
      const node = document.createElement("span");
      node.className = "bb-vim-nav-hint";
      node.textContent = labels[index];
      hintOverlay!.append(node);
      return { element, label: labels[index], node };
    });
    typedHint = "";
    positionHints();
    document.body.append(hintOverlay);
    window.addEventListener("scroll", scheduleHintReposition, { capture: true, passive: true, signal });
    window.addEventListener("resize", scheduleHintReposition, { passive: true, signal });
  }

  function positionHints() {
    if (!hints) return;
    for (const hint of hints) {
      const rect = visibleRect(hint.element);
      hint.node.style.visibility = rect ? "" : "hidden";
      if (!rect) continue;
      hint.node.style.left = `${Math.max(0, rect.left - 4)}px`;
      hint.node.style.top = `${Math.max(0, rect.top - 2)}px`;
    }
  }

  function scheduleHintReposition() {
    if (repositionFrame) return;
    repositionFrame = requestAnimationFrame(() => {
      repositionFrame = 0;
      positionHints();
    });
  }

  function hideHints() {
    hints = null;
    typedHint = "";
    hintOverlay?.remove();
    hintOverlay = null;
    if (repositionFrame) cancelAnimationFrame(repositionFrame);
    repositionFrame = 0;
    window.removeEventListener("scroll", scheduleHintReposition, { capture: true });
    window.removeEventListener("resize", scheduleHintReposition);
  }

  function handleHintKey(event: KeyboardEvent) {
    if (!hints || ["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(event.key)) return;
    if (event.key === "Backspace") {
      typedHint = typedHint.slice(0, -1);
    } else {
      const char = event.key.toLowerCase();
      if (event.key === "Escape" || !HINT_CHARS.includes(char)) {
        hideHints();
        return;
      }
      if (!hints.some((hint) => hint.label.startsWith(typedHint + char))) return;
      typedHint += char;
    }
    const exact = hints.find((hint) => hint.label === typedHint);
    if (exact) {
      hideHints();
      activate(exact.element);
      return;
    }
    for (const hint of hints) {
      const matches = hint.label.startsWith(typedHint);
      hint.node.hidden = !matches;
      if (!matches) continue;
      hint.node.replaceChildren();
      const typed = document.createElement("span");
      typed.className = "bb-vim-nav-typed";
      typed.textContent = typedHint;
      hint.node.append(typed, hint.label.slice(typedHint.length));
    }
  }

  function activate(element: HTMLElement) {
    if (isTextEntry(element)) {
      composerGuardUntil = 0;
      element.focus();
      return;
    }
    simulateClick(element);
    lastClicked = element.closest(THREAD_ROW_SELECTOR) ? null : element;
    if (element.closest(THREAD_ROW_SELECTOR)) {
      composerGuardUntil = performance.now() + COMPOSER_FOCUS_GUARD_MS;
    }
  }

  // ---- help and pending-key display ---------------------------------------

  function toggleHelp() {
    if (helpOverlay) {
      closeHelp();
      return;
    }
    const backdrop = document.createElement("div");
    backdrop.className = "bb-vim-nav-help-backdrop";
    backdrop.addEventListener("pointerdown", (event) => {
      if (event.target === backdrop) closeHelp();
    });
    const panel = document.createElement("div");
    panel.className = "bb-vim-nav-help";
    const title = document.createElement("h2");
    title.textContent = "Vim Nav";
    panel.append(title);
    const groups = new Map<string, Mapping[]>();
    for (const mapping of MAPPINGS) {
      if (!groups.has(mapping.group)) groups.set(mapping.group, []);
      groups.get(mapping.group)!.push(mapping);
    }
    for (const [group, mappings] of groups) {
      const heading = document.createElement("h3");
      heading.textContent = group;
      const table = document.createElement("table");
      const merged = new Map<string, string[]>();
      for (const mapping of mappings) {
        merged.set(mapping.description, [...(merged.get(mapping.description) ?? []), mapping.keys]);
      }
      for (const [description, keys] of merged) table.append(helpRow(keys, description));
      panel.append(heading, table);
    }
    const typing = document.createElement("h3");
    typing.textContent = "While typing";
    const typingTable = document.createElement("table");
    typingTable.append(helpRow(["Esc"], "Leave the text field and return to normal mode"));
    const footer = document.createElement("div");
    footer.className = "bb-vim-nav-footer";
    footer.textContent = "Keys are ignored while a text field, terminal, or browser tab has focus.";
    panel.append(typing, typingTable, footer);
    backdrop.append(panel);
    document.body.append(backdrop);
    helpOverlay = backdrop;
  }

  function closeHelp() {
    helpOverlay?.remove();
    helpOverlay = null;
  }

  function setPending(keys: string) {
    pending = keys;
    if (!keys) {
      hud?.remove();
      hud = null;
      return;
    }
    if (!hud) {
      hud = document.createElement("div");
      hud.className = "bb-vim-nav-hud";
      document.body.append(hud);
    }
    hud.textContent = keys;
  }

  // ---- keymap -------------------------------------------------------------

  const halfPage = (el: Element) => Math.max(SCROLL_STEP, el.clientHeight / 2);
  const MAPPINGS: Mapping[] = [
    { keys: "j", group: "Scrolling", description: "Scroll down", run: () => scroll("y", () => SCROLL_STEP, false) },
    { keys: "k", group: "Scrolling", description: "Scroll up", run: () => scroll("y", () => -SCROLL_STEP, false) },
    { keys: "h", group: "Scrolling", description: "Scroll left", run: () => scroll("x", () => -SCROLL_STEP, false) },
    { keys: "l", group: "Scrolling", description: "Scroll right", run: () => scroll("x", () => SCROLL_STEP, false) },
    { keys: "d", group: "Scrolling", description: "Scroll half a page down", run: () => scroll("y", halfPage, true) },
    { keys: "u", group: "Scrolling", description: "Scroll half a page up", run: () => scroll("y", (el) => -halfPage(el), true) },
    { keys: "gg", group: "Scrolling", description: "Scroll to the top", run: () => scrollToEdge(false) },
    { keys: "G", group: "Scrolling", description: "Scroll to the bottom", run: () => scrollToEdge(true) },
    { keys: "f", group: "Clicking", description: "Show link hints, then type a label to click it", run: showHints },
    {
      keys: "i",
      group: "Clicking",
      description: "Focus the composer",
      run: () => {
        composerGuardUntil = 0;
        press(BB_SHORTCUTS.composerFocus);
      },
    },
    { keys: "J", group: "Threads and history", description: "Next thread in the sidebar", run: () => navigate(BB_SHORTCUTS.threadNext) },
    { keys: "gt", group: "Threads and history", description: "Next thread in the sidebar", run: () => navigate(BB_SHORTCUTS.threadNext) },
    { keys: "K", group: "Threads and history", description: "Previous thread in the sidebar", run: () => navigate(BB_SHORTCUTS.threadPrevious) },
    { keys: "gT", group: "Threads and history", description: "Previous thread in the sidebar", run: () => navigate(BB_SHORTCUTS.threadPrevious) },
    { keys: "H", group: "Threads and history", description: "Go back", run: () => navigate(BB_SHORTCUTS.historyBack) },
    { keys: "L", group: "Threads and history", description: "Go forward", run: () => navigate(BB_SHORTCUTS.historyForward) },
    { keys: "o", group: "bb", description: "Search threads", run: () => press(BB_SHORTCUTS.threadSearch) },
    { keys: "T", group: "bb", description: "Search threads", run: () => press(BB_SHORTCUTS.threadSearch) },
    { keys: "t", group: "bb", description: "New thread", run: () => press(BB_SHORTCUTS.threadNew) },
    { keys: "gf", group: "bb", description: "Open a file", run: () => press(BB_SHORTCUTS.quickOpen) },
    { keys: ":", group: "bb", description: "Command palette", run: () => press(BB_SHORTCUTS.palette) },
    { keys: "?", group: "bb", description: "Show this help", run: toggleHelp },
  ];
  const byKeys = new Map(MAPPINGS.map((mapping) => [mapping.keys, mapping]));
  const isPrefix = (keys: string) => MAPPINGS.some((mapping) => mapping.keys.length > keys.length && mapping.keys.startsWith(keys));

  // ---- event wiring -------------------------------------------------------

  function consume(event: KeyboardEvent) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (replaying || event.isComposing || event.key === "Process") return;
    if (hints) {
      consume(event);
      handleHintKey(event);
      return;
    }
    if (helpOverlay && (event.key === "Escape" || event.key === "?")) {
      consume(event);
      closeHelp();
      return;
    }
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
      setPending("");
      return;
    }
    const active = deepActiveElement();
    if (isTypingContext(active) || isTypingContext(event.target)) {
      setPending("");
      return;
    }
    if (event.key === "Escape" && pending) {
      consume(event);
      setPending("");
      return;
    }
    if (event.key.length !== 1) return;
    let keys = pending + event.key;
    if (!byKeys.has(keys) && !isPrefix(keys)) keys = event.key;
    const mapping = byKeys.get(keys);
    if (mapping) {
      consume(event);
      setPending("");
      closeHelp();
      mapping.run();
    } else if (isPrefix(keys)) {
      consume(event);
      setPending(keys);
    } else {
      setPending("");
    }
  }

  // Esc that nothing in bb handled (menus, mentions, dialogs come first)
  // leaves the focused text field, like Vimium's exit from insert mode.
  function onEscape(event: KeyboardEvent) {
    if (replaying || event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
    const active = deepActiveElement();
    if (!(active instanceof HTMLElement) || !isTextEntry(active)) return;
    if (inside(active, "[data-app-terminal], [data-app-browser]") || topModal()) return;
    active.blur();
  }

  function onPointerDown(event: PointerEvent) {
    if (hints) hideHints();
    composerGuardUntil = 0;
    const target = event.target instanceof Element ? event.target : null;
    lastClicked = target && !target.closest(THREAD_ROW_SELECTOR) ? target : null;
  }

  function onFocusIn(event: FocusEvent) {
    if (performance.now() > composerGuardUntil) return;
    const target = event.target;
    if (target instanceof HTMLElement && isTextEntry(target) && inside(target, COMPOSER_SELECTOR) && !topModal()) {
      target.blur();
    }
  }

  window.addEventListener("keydown", onKeyDown, { capture: true, signal });
  window.addEventListener("keydown", onEscape, { signal });
  window.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true, signal });
  window.addEventListener("focusin", onFocusIn, { capture: true, signal });

  return () => {
    hideHints();
    closeHelp();
    setPending("");
    style.remove();
  };
}

// ---- DOM helpers ------------------------------------------------------------

function deepActiveElement(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

function inside(node: EventTarget | null, selector: string): boolean {
  return node instanceof Element && node.closest(selector) !== null;
}

function topModal(): Element | null {
  const modals = document.querySelectorAll(MODAL_SELECTOR);
  return modals.length > 0 ? modals[modals.length - 1] : null;
}

function isTextEntry(el: Element): boolean {
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(el.type);
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return el instanceof HTMLElement && el.isContentEditable;
}

/** Focus where letters belong to something else: text, terminals, browser tabs, menus. */
function isTypingContext(node: EventTarget | null): boolean {
  if (!(node instanceof Element)) return false;
  return (
    isTextEntry(node) ||
    inside(node, "[data-app-terminal], [data-app-browser]") ||
    inside(node, POPUP_FOCUS_SELECTOR)
  );
}

function isScrollable(el: Element, axis: "x" | "y"): boolean {
  const room = axis === "y" ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
  if (room < 2) return false;
  if (el === document.scrollingElement) return true;
  const overflow = axis === "y" ? getComputedStyle(el).overflowY : getComputedStyle(el).overflowX;
  return overflow === "auto" || overflow === "scroll" || overflow === "overlay";
}

function scrollableAncestor(start: Element, axis: "x" | "y"): Element | null {
  for (let el: Element | null = start; el; el = el.parentElement) {
    if (isScrollable(el, axis) && isShown(el)) return el;
  }
  return null;
}

function largest(elements: Iterable<Element>, accept: (el: Element) => boolean): Element | null {
  let best: Element | null = null;
  let bestArea = 0;
  for (const el of elements) {
    if (!accept(el) || !isShown(el)) continue;
    const rect = el.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > bestArea) {
      best = el;
      bestArea = area;
    }
  }
  return best;
}

function isShown(el: Element): boolean {
  if (typeof el.checkVisibility === "function" && !el.checkVisibility({ visibilityProperty: true })) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/** The element's first box that is on screen, clipped to the viewport. */
function visibleRect(el: Element): DOMRect | null {
  for (const rect of el.getClientRects()) {
    const left = Math.max(rect.left, 0);
    const top = Math.max(rect.top, 0);
    const right = Math.min(rect.right, window.innerWidth);
    const bottom = Math.min(rect.bottom, window.innerHeight);
    if (right - left >= 3 && bottom - top >= 3) return new DOMRect(left, top, right - left, bottom - top);
  }
  return null;
}

function collectHintTargets(): HTMLElement[] {
  const root: ParentNode = topModal() ?? document;
  const viewportArea = window.innerWidth * window.innerHeight;
  const rects = new Map<HTMLElement, DOMRect>();
  for (const el of root.querySelectorAll<HTMLElement>(CLICKABLE_SELECTOR)) {
    if (el.matches(":disabled, [aria-disabled='true'], [inert] *, [aria-hidden='true'] *")) continue;
    if (el.closest(".bb-vim-nav-hints, .bb-vim-nav-help-backdrop")) continue;
    if (typeof el.checkVisibility === "function" && !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
    const rect = visibleRect(el);
    if (!rect) continue;
    // Focusable scroll regions match [tabindex] but are not click targets.
    if (area(rect) > viewportArea * 0.3 && !el.matches("a[href], button, [role=button], [role=link]")) continue;
    if (!isTopmostAt(el, rect)) continue;
    rects.set(el, rect);
  }
  // A clickable wrapper around a clickable that fills most of it (a thread
  // row around its link) gets one hint, on the inner, more specific element.
  const wrappers = new Set<HTMLElement>();
  for (const [el, rect] of rects) {
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      const parentRect = rects.get(parent);
      if (parentRect && area(rect) >= area(parentRect) * 0.7) wrappers.add(parent);
    }
  }
  return [...rects.keys()].filter((el) => !wrappers.has(el));
}

function area(rect: DOMRect): number {
  return rect.width * rect.height;
}

function isTopmostAt(el: Element, rect: DOMRect): boolean {
  const points: Array<[number, number]> = [
    [rect.left + rect.width / 2, rect.top + rect.height / 2],
    [rect.left + 2, rect.top + 2],
  ];
  for (const [x, y] of points) {
    const hit = document.elementFromPoint(x, y);
    if (hit && (hit === el || el.contains(hit))) return true;
  }
  return false;
}

/** Vimium's prefix-free label set: no label is the start of another. */
function hintLabels(count: number): string[] {
  const labels = [""];
  let offset = 0;
  while (labels.length - offset < count || labels.length === 1) {
    const base = labels[offset++];
    for (const char of HINT_CHARS) labels.push(char + base);
  }
  return labels
    .slice(offset, offset + count)
    .sort()
    .map((label) => [...label].reverse().join(""));
}

function simulateClick(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  const position = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    button: 0,
  };
  const pointer = { ...position, pointerId: 1, pointerType: "mouse", isPrimary: true };
  el.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, buttons: 1 }));
  el.dispatchEvent(new MouseEvent("mousedown", { ...position, buttons: 1 }));
  el.focus({ preventScroll: true });
  el.dispatchEvent(new PointerEvent("pointerup", pointer));
  el.dispatchEvent(new MouseEvent("mouseup", position));
  el.dispatchEvent(new MouseEvent("click", position));
}

function helpRow(keys: string[], description: string): HTMLTableRowElement {
  const row = document.createElement("tr");
  const keyCell = document.createElement("td");
  for (const key of keys) {
    const kbd = document.createElement("kbd");
    kbd.textContent = key;
    keyCell.append(kbd);
  }
  const descriptionCell = document.createElement("td");
  descriptionCell.textContent = description;
  row.append(keyCell, descriptionCell);
  return row;
}
