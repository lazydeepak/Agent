import { isValidError } from "./state.js";

/** Minimal DOM helpers shared by the renderer views. */

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  return node;
}

/** Escapes text for interpolation into the few `innerHTML` templates used for dense lists. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/`/g, "&#96;");
}

export interface CardBadgeOpts {
  cssClass: string;
  text: string;
}
export function buildCard(config: {
  wrapperClass: string;
  datasetKey: string;
  datasetValue: string;
  expanded: boolean;
  header: {
    wrapperClass: string;
    id: string;
    titleClass: string;
    titleChildren: HTMLElement[];
    badges: CardBadgeOpts[];
    toggleLabel?: string;
    toggleAriaLabel?: string;
    onToggle?: () => void;
  };
  body?: HTMLElement[];
}): HTMLElement {
  const card = el("div", config.wrapperClass);
  card.dataset[config.datasetKey] = config.datasetValue;
  card.classList.toggle("expanded", config.expanded);

  const header = el("div", config.header.wrapperClass);

  const title = el("div", config.header.titleClass);
  for (const child of config.header.titleChildren) {
    title.appendChild(child);
  }
  header.appendChild(title);

  const badges = el("div", "pair-status-badges");
  for (const badge of config.header.badges) {
    const span = el("span", `badge ${badge.cssClass}`);
    span.textContent = badge.text;
    badges.appendChild(span);
  }
  header.appendChild(badges);

  if (config.header.onToggle) {
    const toggle = actionButton(
      config.expanded ? "Collapse" : (config.header.toggleLabel ?? "Details"),
      "btn-ghost btn-icon",
      true,
      config.header.onToggle
    );
    const toggleTitle = config.expanded
      ? `Collapse details for ${config.header.id}`
      : `Expand details for ${config.header.id}`;
    toggle.title = toggleTitle;
    toggle.setAttribute("aria-expanded", String(config.expanded));
    header.appendChild(toggle);
  }

  card.appendChild(header);

  if (config.body) {
    for (const child of config.body) {
      card.appendChild(child);
    }
  }

  return card;
}
export function buildIdentityBlock(rows: Array<{ label: string; value: string }>): HTMLElement {
  const block = el("div", "pair-identity");
  for (const row of rows) {
    block.appendChild(identityRow(row.label, row.value));
  }
  return block;
}
export function buildDangerZone(buttons: Array<{ label: string; enabled: boolean; cssClass?: string; onClick: () => void }>): HTMLElement {
  const danger = el("div", "pair-danger");
  for (const btn of buttons) {
    danger.appendChild(actionButton(btn.label, `btn-sm ${btn.cssClass ?? "btn-danger"}`, btn.enabled, btn.onClick));
  }
  return danger;
}
export function buildExpandableToggle(
  id: string,
  expanded: boolean,
  expandedSet: Set<string>,
  rerender: () => void
): () => void {
  return () => {
    if (expandedSet.has(id)) {
      expandedSet.delete(id);
    } else {
      expandedSet.add(id);
    }
    rerender();
  };
}
export function toast(message: string, kind: "error" | "ok" = "error", dismissible: boolean = false): void {
  const element = document.getElementById("toast");
  if (!element) {
    return;
  }
  element.textContent = message;
  element.className = `toast toast-${kind}`;
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "×";
  closeBtn.className = "toast-close";
  closeBtn.title = "Dismiss";
  closeBtn.addEventListener("click", () => {
    element.classList.add("hidden");
    window.clearTimeout((element as HTMLElement & { _timer?: number })._timer);
  });
  if (dismissible) {
    element.appendChild(closeBtn);
  }
  window.clearTimeout((element as HTMLElement & { _timer?: number })._timer);
  (element as HTMLElement & { _timer?: number })._timer = window.setTimeout(() => {
    element.classList.add("hidden");
  }, 5000);
}
export function identityRow(label: string, value: string): HTMLElement {
  const row = el("div", "identity-row");
  const labelEl = el("span", "label");
  labelEl.textContent = label;
  const valueEl = el("span", "value");
  valueEl.textContent = value;
  row.appendChild(labelEl);
  row.appendChild(valueEl);
  return row;
}
export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
export function actionButton(label: string, className: string, enabled: boolean, onClick: () => void): HTMLButtonElement {
  const button = el("button", `btn ${className}`);
  button.textContent = label;
  button.disabled = !enabled;
  button.addEventListener("click", () => {
    onClick();
  });
  return button;
}
export function errorMessage(error: unknown): string {
  if (isValidError(error)) {
    const details = (error as { details?: Record<string, unknown> }).details;
    const fallback = typeof details?.fallbackCommand === "string" ? ` Run: ${details.fallbackCommand}` : "";
    return `${error.code}: ${error.message}${fallback}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
