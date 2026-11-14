# Migration Notes — Consolidation into Agent

This document records how features from sibling projects (`Bot`, `RelayX`, `TerminalBot`,
`RelayLoop`) were consolidated into `Agent` without modifying their sources.

## Principles
- Sibling project sources are read-only; nothing was edited in `/Users/lazydeepak/dev/{Bot,RelayX,TerminalBot,RelayLoop,...}`.
- Consolidation is additive: new modules live under `src/` and `desktop/`; existing
  invariants (deterministic state classification, no AI judgment, no autonomous re-prompt)
  are preserved.
- Consolidated helpers are pure where possible, so they are unit-testable without a
  browser/runtime. Fresh tests are to be added later.

## Module mapping
| Sibling source | Agent module |
|---|---|
| TerminalBot/RelayLoop writing_block extraction | `src/adapters/chatgpt/index.ts`, `src/relay/planner-prompt.ts` |
| TerminalBot/RelayLoop receipt verification | `src/relay/receipt-verification.ts` |
| TerminalBot/RelayLoop process lock | `src/util/process-lock.ts` |
| TerminalBot/RelayLoop composer readiness + 10-min windows | `src/relay/composer-readiness.ts`, `src/relay/composer-polling.ts` |
| RelayX diagnostics telemetry buffer | `src/application/diagnostics-buffer.ts` |
| RelayX health monitors | `src/application/health-monitors.ts` |
| RelayX engine invariant guard (UI) | `desktop/renderer/index.html` panel |
| Bot plugin registry | `src/application/plugin-registry.ts` |
| Bot APNs sender | `src/application/apns.ts` |
| Bot read-only diagnostics capability | `src/application/diagnostics-capability.ts` |
| Bot Relay Beacon theme | `desktop/renderer/styles.css` (cascade overrides) |

## Desktop
- `npm run agent` (alias) launches the desktop shell.
- ChatGPT browser tabs are reused; managed Chrome is cached and closed on shutdown.
- IPC whitelist updated; `adapterSettings` channel added.

## Deferred
- Native mobile clients (iOS/Android): consume the remote HTTP API (`agent service start`).
- Terminal packaging binaries: covered by `npm run service:bundle` / `service:binary`.
- UI: Electron desktop only (with cascade overrides). No external UI framework dependency.
- Cross-project contract tests: to be added later (no test files added per request).
