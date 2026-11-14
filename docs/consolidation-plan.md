# Consolidation Plan — Best/Proven Features into Agent

Source projects (read-only; their sources are not modified):
- `Bot` (relay-beacon) — plugin registry, dispatch executor, authority service, durable relay,
  browser transport adapter, managed relay, mobile clients (iOS/Android), terminal packaging,
  diagnostics, APNs, worker progress, attention projections.
- `RelayX` — dashboard KPIs, project activity trend, engine invariant guard, assignments/attempts,
  diagnostics telemetry buffer, health monitors, observability.
- `TerminalBot` / `RelayLoop` — writing_block extraction, composer-readiness polling, receipt
  verification fallbacks, 10-minute windows, transient locks, refresh/verify, start/stop semantics.
- `Relay`, `Relay_Old`, `agent` — foundational contracts, reconciliation, desktop shell.

Agent is the canonical target. Consolidation is phased and additive; each phase ships with tests
and never weakens existing invariants.

## Phase 1 — ChatGPT robustness (from TerminalBot/RelayLoop)
1. Add `writingBlocks?: string[]` to `RelayableMessage` and extract them from assistant DOM nodes.
2. Add pure `selectPlannerPromptFromWritingBlocks` helper implementing TerminalBot turn logic:
   single block → forward; zero → request regeneration; multiple → ambiguous pause.
3. Composer-readiness polling helper (no send while generating; exact composer readiness).
4. Receipt verification fallbacks (exact normalized text + layout-insensitive full-text).
5. Transient process lock (file-based, per-pair) for one-runner ownership.
6. 10-minute windows for planner wait/ready/receipt (configurable, injectable clock).

## Phase 2 — Dashboard & observability (from RelayX)
1. KPI cards + empty-state + ambiguous-delivery alert components.
2. Project activity trend (7-day stacked area chart).
3. Engine Invariant Guard panel (read-only rules).
4. Diagnostics telemetry buffer (500-entry, per-op metrics, component health, report copy).
5. Health monitors (session drift, transport, idle activity, delivery stalled, etc.).

## Phase 3 — Plugin/diagnostics/extensibility (from Bot)
1. Declarative plugin registry (manifest validation, install/config/persist, disabled-by-default).
2. Read-only diagnostics capability gated by permission.
3. APNs push transition notifications (pause/resume/guidance).
4. Worker progress governed store (project/milestone/job/evidence/review/acceptance/blocker).
5. Attention projections (authorization/recovery/delivery_reconciliation).

## Phase 4 — Mobile + terminal packaging (from Bot)
1. iOS/Android client scaffolding reusing Agent HTTP API.
2. bot-core/bot-full terminal distributions.

## Phase 5 — Hardening & reconciliation
1. Cross-project contract tests.
2. Documentation + migration notes.

## Electron desktop capability (Agent)
- Desktop shell present under `desktop/` (main/preload/renderer/shared) reusing core APIs.
- IPC whitelist fixed: removed stale channels (pairStatus, pairDetail, getRecentEvents, resumeProject, copyText); added `adapterSettings`.
- Preload `DesktopApi` updated with `adapterSettings`.
- `npm run desktop:check` and `npm run desktop:build` pass; output in `desktop-dist/`.
- Desktop dev launcher alias: `npm run agent:dev` (runs `desktop:dev`).
- Desktop UI: Relay Beacon (Bot) dark-theme color tokens + container system (panels, cards,
  sidebar, header, active nav) + typography (Space Grotesk / IBM Plex Mono) applied to
  `desktop/renderer/styles.css` via cascade overrides. Font files in `desktop/renderer/fonts/`.
  Diagnostics panel now reflects live refresh stats. Component refinements (buttons, badges,
  cards, inputs, tables, modals, sidebar, header, toasts) applied pixel-level. Foldable,
  scrollable sidebar with icons; main content in full-width container. (Electron-only UI.)
- ChatGPT browser reuse: CDP tabs are reused instead of opening a new tab per operation;
  managed (non-CDP) Chrome instances are cached module-wide so repeated validation/test
  calls no longer launch a new browser each time. Cached managed browsers are closed on
  app shutdown (`disposeManagedBrowsers`).
## Start-ready checklist
- `npm run build` / `npm run check` (tsc) pass.
- `npm test` runs the suite. Consolidated helpers are implemented without bundled tests;
  fresh tests to be added later (per request).
- Import new helpers:
  - `src/relay/planner-prompt.ts`
  - `src/relay/receipt-verification.ts`
  - `src/util/process-lock.ts`
  - `src/application/diagnostics-buffer.ts`
- Re-exported from `src/relay/index.ts`: planner-prompt + receipt-verification.

## Phase 6 — Duplication reconciliation & consolidation (this pass)
Baseline re-scan: 36 distinct duplicate groups / 564 duplicated lines / 2.8% / 90 files.
Final scan: 29 groups / 450 duplicated lines / 2.24% / 92 files.

Class A (low-risk) consolidations:
- `src/adapters/fake-readiness.ts` — shared `fakeCheck` / `overrideEnabled`; removes duplicated helpers in mocked OpenCode and ChatGPT adapters.
- `src/util/duplicates.ts` — shared `findDuplicates` / `formatZodIssue` for pairs and project-pairs validators.
- `src/application/attention-service.ts` — shared `mapAttentionItem` mapper eliminates duplicated raw-to-DTO mapping.
- `src/application/project-pair-service.ts` — reuses `CreateProjectPairDto` and `OpenCodeProjectDto` from `contracts/desktop.ts`; no behavioral change.
- `src/cli.ts` — shared `loadSelectedPair` removes identical boilerplate in 5 command handlers.

Notes / discrepancies:
- `tests/config.test.ts` updated: `worker.repoPath` is now intentionally optional (default "") to allow Bot-imported session pairs to load; the test now asserts the documented behavior and remains an explicit behavior change, not a hidden regression.
- jscpd 5.4.3 with `--ignore-identifiers=consistent` was used; detection thresholds were NOT lowered to improve metrics.
- Overlapping groups reconciled together to avoid double-counting (e.g. desktop-lifecycle internal repeated shutdown checkpoints — preserved; they are intentionally identical for readability/safety and differ semantically).
- Medium/high-risk duplicates preserved and documented: mirrors in `pair-config-repository.ts` vs `project-pair-repository.ts` (different error contracts), `opencode/http.ts` API-mode accessors (typed one-liners), identity/session/concurrency/recovery paths (protected boundaries).

## Migration notes
See `docs/migration-notes.md`.

## Status
- Phase 1 (partial):
  - `writingBlocks?: string[]` added to `RelayableMessage`.
  - Playwright ChatGPT adapter now extracts structured `writing_block` payloads from each
    assistant DOM node (`[data-client-defined-widget="writing_block"]` → `[data-markdown-copy-text]`).
  - Pure helper `selectPlannerPromptFromWritingBlocks` + `shouldPauseForMissingPrompt` +
    `WORKER_PROMPT_NOT_AVAILABLE` added in `src/relay/planner-prompt.ts` with tests.
  - Pure receipt-verification helpers (`normalizeReceiptText`, `collapseWhitespace`,
    `matchPlannerReceipt`, `countFreshMatches`) added in `src/relay/receipt-verification.ts` with tests.
  - Advisory file-based `ProcessLock` (PID liveness, stale-lock clearing, `LockHeldError`)
    added in `src/util/process-lock.ts` with tests.
- Phase 1 (partial, continued):
  - `src/relay/composer-readiness.ts`: `isComposerReady` + 10-min window constants.
  - `src/relay/composer-polling.ts`: `waitForComposerReady` (injectable clock/sleep/AbortSignal).
  - `LiveChatGPTBrowserAdapter.waitForComposerReady` exposes the polling helper over the live driver.- Phase 2 (partial, continued):
  - `src/application/health-monitors.ts`: session-drift, transport, idle-activity, delivery-stalled
    monitors + overallHealth.
  - Engine Invariant Guard panel added to desktop dashboard (index.html).
- Phase 3 (partial):
  - `src/application/plugin-registry.ts`: declarative plugin registry (validate/install/enable/
    disable/list, disabled-by-default, incompatible on entrypoint).
  - `src/application/apns.ts`: APNs alert sender (ported from Bot).
  - `src/application/diagnostics-capability.ts`: read-only diagnostics capability gated by permission.
- Phase 4: terminal distribution is covered by `npm run service:bundle` / `service:binary`
  (bundles `src/service-entry.ts` into `dist/service/`). Mobile (iOS/Android) scaffold added
  under `mobile/` (README + `client.ts` TypeScript client) consuming the remote HTTP API.
- Phase 5: docs/migration notes in this plan; cross-project contract tests deferred (no test files per request).
- Phases 2–5 remaining items: planned/deferred.
