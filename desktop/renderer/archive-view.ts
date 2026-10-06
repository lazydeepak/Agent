import type { ArchivedPairSummaryDto } from "../shared/dto.js";
import { actionButton, el, toast } from "./dom.js";
import { runAction } from "./actions.js";
import { state } from "./view-state.js";

const ARCHIVE_SUMMARY_ID = "archive-summary";
const ARCHIVE_LIST_ID = "archive-list";
const ARCHIVE_REFRESH_ID = "archive-refresh";

let refreshHooks: { refreshPairs: () => Promise<void> } | undefined;

export function setArchiveViewHooks(hooks: { refreshPairs: () => Promise<void> }): void {
  refreshHooks = hooks;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export async function refreshArchive(): Promise<void> {
  const items = await runAction(() => window.desktop.listArchive());
  if (!items) {
    return;
  }
  state.archivedPairs = items;
  renderArchive();
}

function renderArchive(): void {
  const list = document.getElementById(ARCHIVE_LIST_ID);
  const summary = document.getElementById(ARCHIVE_SUMMARY_ID);
  if (!list || !summary) {
    return;
  }
  summary.textContent =
    state.archivedPairs.length === 0
      ? "Nothing archived yet."
      : `${state.archivedPairs.length} archived pair${state.archivedPairs.length === 1 ? "" : "s"}`;
  const navArchiveCount = document.getElementById("nav-archive-count");
  if (navArchiveCount) navArchiveCount.textContent = String(state.archivedPairs.length);

  const fragment = document.createDocumentFragment();
  for (const item of state.archivedPairs) {
    fragment.appendChild(renderArchiveRow(item));
  }
  list.replaceChildren(fragment);
}

function renderArchiveRow(item: ArchivedPairSummaryDto): HTMLElement {
  const row = el("div", "archive-row");
  const identity = el("div", "archive-row-identity");

  const idLine = el("div", "archive-row-id");
  const idSpan = el("span", "pair-id");
  idSpan.textContent = item.pairId;
  idLine.appendChild(idSpan);
  identity.appendChild(idLine);

  const meta = el("div", "archive-row-meta");
  meta.textContent = [
    `Archived ${formatTimestamp(item.archivedAt)}`,
    `${item.recordCount} relay record${item.recordCount === 1 ? "" : "s"}`,
    `${item.cycleCount} cycle${item.cycleCount === 1 ? "" : "s"}`,
    item.hasState ? "has state" : "no state"
  ].join(" · ");
  identity.appendChild(meta);

  row.appendChild(identity);
  row.appendChild(
    actionButton("Delete", "btn-sm btn-danger", true, () => {
      if (
        !window.confirm(
          `Permanently delete the archived data for "${item.pairId}"?\n\nThis removes the archive file ${item.ref} from data/archive/.`
        )
      ) {
        return;
      }
      void deleteArchived(item.ref);
    })
  );
  return row;
}

async function deleteArchived(ref: string): Promise<void> {
  const result = await runAction(() => window.desktop.deleteArchive(ref));
  if (result) {
    toast(`Deleted archive ${result.ref}.`, "ok");
    await refreshHooks?.refreshPairs();
    await refreshArchive();
  }
}

export function wireArchiveView(refreshPairs: () => Promise<void>): void {
  setArchiveViewHooks({ refreshPairs });
  const refreshButton = document.getElementById(ARCHIVE_REFRESH_ID);
  refreshButton?.addEventListener("click", () => {
    void refreshArchive();
  });
}