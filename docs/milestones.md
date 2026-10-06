# Milestones

## M1 - Pair validation

Pair one existing OpenCode session with one existing ChatGPT conversation, validate both peers, and display `READY` / `NOT_READY`.

Functional slice now covered:

- Canonical session-pair schema with `pairId`, `enabled`, `worker`, and `planner`
- Explicit configuration errors for missing fields, unsupported adapters, malformed IDs, duplicate pair ownership, and ChatGPT URL/ID mismatches
- Adapter contracts for `OpenCodeAdapter` and `ChatGPTBrowserAdapter`
- Deterministic fake adapters for M1 readiness validation
- Structured readiness checks with concise CLI output
- `npm run relay -- validate <pairId|--all> [--config <path>]`

Out of scope:

- Message relay
- Prompt sending in either direction
- Watchers
- Supervisor state machine
- AI/model judgment
- Browser automation
- Crash recovery
- Multiple simultaneous pairs
- Desktop dashboard

## M2 - Live OpenCode session management

Make the worker peer real while ChatGPT stays deterministic and mocked.

Functional slice now covered:

- HTTP client for existing OpenCode servers
- OpenCode server health checks
- Session discovery with optional repo filtering
- Disposable session creation for a requested repo
- Pair binding by updating the configured worker session ID
- Live worker readiness using server health, session lookup, repo matching, and active-session status
- CLI commands that call UI-independent adapter/session services

Out of scope:

- ChatGPT browser automation
- Prompt sending
- Agent-to-planner or planner-to-agent relay
- Watchers
- Supervisor state machine
- SQLite/persistence
- Electron UI

## M3 - OpenCode to ChatGPT relay

Relay the worker's latest assistant message to the planner adapter while ChatGPT remains deterministic and mocked.

Functional slice now covered:

- Relayable message model and delivery receipt model
- OpenCode latest-assistant-message extraction from current v2 and installed legacy message endpoints
- One-shot `relay worker-to-planner <pairId>` command
- Readiness gate before relay attempts
- Deterministic fake ChatGPT delivery receipt

Out of scope:

- Live ChatGPT browser prompt sending
- ChatGPT to OpenCode relay
- Watchers
- Supervisor state machine
- Duplicate-send persistence
- SQLite/persistence
- Electron UI

## M4 - ChatGPT to OpenCode relay

Relay an explicit mocked planner message into an OpenCode worker session.

Functional slice now covered:

- Planner-origin relayable messages
- Fake ChatGPT latest planner message source
- Live OpenCode message send using text `parts`
- One-shot `relay planner-to-worker <pairId> --message <text>` command
- Readiness gate before OpenCode prompt submission

Out of scope:

- Reading real ChatGPT messages from a browser
- Automatic prompt selection
- Watchers
- Supervisor state machine
- Duplicate-send persistence
- SQLite/persistence
- Electron UI

## M5a - Live ChatGPT readiness

Make the planner readiness checks real without sending messages to ChatGPT.

Functional slice now covered:

- Optional ChatGPT browser configuration
- Playwright-based browser readiness probe loaded only for live ChatGPT checks
- Connect to an existing Chrome/Chromium CDP endpoint
- Launch a configured Chrome/Chromium executable with a dedicated profile
- Live checks for browser reachability, authentication, conversation reachability, composer availability, and generation state
- `validate ... --live-chatgpt` and ChatGPT browser CLI options

Out of scope:

- Reading real ChatGPT planner messages
- Sending worker messages into ChatGPT
- Browser lifecycle management UI
- Watchers
- Supervisor state machine
- Duplicate-send persistence
- SQLite/persistence
- Electron UI

## M5b - Live ChatGPT message read/send

Use the live ChatGPT browser adapter as an explicit one-shot planner endpoint.

Functional slice now covered:

- Browser-driver boundary behind the UI-independent ChatGPT planner adapter
- Latest planner-message extraction from the live ChatGPT conversation DOM
- Worker-message submission into the live ChatGPT composer
- Live ChatGPT delivery receipts using the same relay core as the fake adapter
- Opt-in live ChatGPT relay through `--live-chatgpt` or configured browser settings
- Mocked ChatGPT relay remains the default for deterministic local tests

Out of scope:

- Duplicate-send protection
- Message persistence
- Conversation diffing/history sync
- Watchers
- Supervisor state machine
- Browser lifecycle management UI
- SQLite/persistence
- Electron UI

## M6 - Persistence and duplicate-send protection

Make a relay action safe to retry using persistent local state.

Functional slice now covered:

- Local SQLite runtime database at `data/agent-relay.sqlite` using the Node built-in `node:sqlite` driver
- Configurable DB path via `--db` or `AGENT_RELAY_DB`
- Automatic idempotent schema initialization with a schema version guard and actionable errors for a corrupted/invalid DB
- Persisted relay message identity: `pairId`, `direction`, `sourceMessageId`, `sourceHash`, `sourceTimestamp`, `targetId`, `status`, timestamps, `attemptCount`, and `error`
- Durable relay cycle ledger states: `DISCOVERED`, `DELIVERING`, `DELIVERED`, `FAILED`
- Duplicate suppression: an already-`DELIVERED` message identity returns `SKIPPED_DUPLICATE` and is not resent
- Crash-aware handling: an incomplete `DELIVERING` prior attempt returns `AMBIGUOUS` and is never blindly resent
- `--force` override to intentionally bypass duplicate suppression and record a new attempt
- Canonical content hashing (normalized line endings/whitespace, SHA-256, no timestamps in the hash)
- Persistent pair runtime metadata (`pairId`, last message IDs, last successful relay time, last direction, last error)
- Thin CLI inspection: `state init`, `state inspect`, `state pair`, `state messages [--json]`
- Adapter-neutral persistence layer (OpenCode/ChatGPT implementation details stay in adapters)

Out of scope:

- Autonomous watcher/supervisor loop (M7)
- Automatic retry loops
- Crash recovery daemon
- Persisting chat messages/cookies/credentials/secrets
- Migrating canonical pair config into SQLite
- Electron UI

Exact guarantee: at-least-once transport with strong duplicate suppression and crash-aware state. Sending is not exactly-once unless the external endpoint is idempotent.

## M7 - Supervisor / watcher state machine

Continuously observe one configured session pair, classify its state deterministically, optionally relay messages safely through the M6 ledger, persist continuity, and log JSON-line events.

Functional slice now covered:

- Deterministic state classifier with 11 states: `READY`, `WORKING`, `WAITING_PLANNER`, `WAITING_WORKER`, `IDLE`, `COMPLETED`, `WAITING_INPUT` (reserved, never emitted), `STUCK`, `FAILED`, `DISCONNECTED`, `PAUSED`
- Pure `classify()` decision tree with explicit precedence and a `--stuck-after` progress threshold; no AI/model judgment anywhere
- Adapter observation contract: `observeWorkerSession` on OpenCode adapters and `observePlannerConversation` on ChatGPT adapters, implemented for live, static, and fake adapters
- Read-only one-shot `supervise <pairId>` and a continuous `--watch` loop with configurable `--poll-interval`
- Opt-in safe relay orchestration via `--watch --relay`: only relays a message identity once through the M6 ledger; delivered reports/instructions are never re-sent
- Continuity persisted per pair in the new `supervisor_state` table (last state, activity timestamps, current relay cycle ids, `paused`) via an automatic v1-to-v2 schema migration
- Pause/resume controls that survive restart: `supervisor pause|resume|status <pairId>`
- JSON-line event log to `logs/supervisor.ndjson` (state changes, relay outcomes, watch start/stop, observation errors)

Out of scope:

- Automatic recovery or rescue actions (M8)
- AI/model judgment anywhere in readiness or state decisions
- Automatic retry loops
- Multiple simultaneous pairs (M9)
- Desktop dashboard (M10)

## M8 - Safe recovery and process/transport resilience

Survive browser/OpenCode connectivity failures, process restarts, and interrupted supervision without duplicates or unsafe corrective actions. Recovery actions are bounded, deterministic, opt-in per command, and never autonomously re-prompt a stuck agent.

Functional slice now covered:

- Recovery policy category with `safe` and `none`; `safe` reconnects peers, `none` disables recovery. Default remains deterministic and mocked
- Deterministic state classification of recoverable failures (`DISCONNECTED`/`FAILED` transport or auth problems) vs. unresolved `STUCK` states
- No AI/model judgment: every recovery decision is a pure function of observed state and connectivity; there is no autonomous "continue working" re-prompt
- OpenCode recovery: reconnect to the configured session, `OPENCODE_SESSION_MISSING` intervention when the configured session no longer exists (never rebind to another session), bearer/device-credential re-auth, backoff retries with bounded cap
- ChatGPT recovery: browser CDP transport reconnect, conversation reopen, managed-browser relaunch (external browsers are never killed/restarted), and explicit auth intervention (`CHATGPT_AUTH_REQUIRED`); Agent Relay never logs itself into ChatGPT
- `STUCK` is always verify-only: the engine re-observes peer activity and reports `STUCK_UNRESOLVED` intervention if nothing progressed; no corrective prompt is ever sent
- Ambiguous interrupted relays (`DELIVERING` in the ledger) block recovery with `RELAY_AMBIGUOUS`; nothing is auto-resumed or re-sent
- Bounded deterministic backoff `[1000, 2000, 5000, 10000, 30000]` with a default max attempt cap; injectable clock, sleep, and `AbortSignal` so attempts never overlap
- Recovery metadata persisted in `supervisor_state` (schema v3): `recovery_policy`, `recovery_attempt_count`, `last_recovery_attempt_at`, `last_recovery_success_at`, `last_recovery_error_code`, `last_recovery_error`
- Supervision relay stabilization: a candidate worker report is only relayed after it has been observed unchanged for a `stabilityMs` window (default 2x poll), preventing a partially-streamed message from being relayed
- Restart continuity: on supervisor restart, previously-delivered messages are not re-sent in either direction
- CLI: `supervise --recovery none|safe --recovery-max-attempts <n>`, `recovery status|retry <pairId>`, and `browser status|start|stop <pairId>` (managed browsers only; external browsers report status and refuse start/stop)
- Recovery events appended to the JSON-line supervisor log (`RECOVERY_STARTED`, `RECOVERY_RETRY`, `RECOVERY_SUCCEEDED`, `RECOVERY_FAILED`, `RECOVERY_EXHAUSTED`, `SESSION_RECONNECTED`, `BROWSER_RELAUNCHED`, `PEER_DISCONNECTED`, `INTERVENTION_REQUIRED`, `AMBIGUOUS_DELIVERY_BLOCKED`)

Out of scope:

- Automatic recovery daemon loops or unsupervised rescue actions (recovery is opt-in per command)
- Autonomous re-prompting or corrective action toward a stuck agent (verify-only until M9 needs more)
- Desktop dashboard (M10)

## M9 - Multi-pair runtime orchestration

Supervise multiple OpenCode ↔ ChatGPT pairs concurrently inside one runtime with strict per-pair isolation. Each pair keeps its own supervisor loop, continuity, and relay ledger correlation; no pair leaks messages or state to another.

Functional slice now covered:

- `RuntimeOrchestrator` holding a `PairRegistry` of `PairRuntime`s, each running its own async supervisor loop
- `PairRuntimeState = STOPPED | STARTING | RUNNING | PAUSED | STOPPING | ERROR`; status reports both runtime and supervisor state
- Per-pair async loops so a blocked pair or recovery backoff never stalls healthy pairs, and a pair failure never terminates the runtime
- Hard startup isolation: duplicate OpenCode `sessionId` or ChatGPT `conversationId` across configured pairs is rejected at registry creation; shared OpenCode `baseUrl` and shared CDP endpoints are allowed
- Narrow FIFO browser lock (`FifoMutex` + `LockRegistry`) keyed by CDP/profile to serialize navigation across adapters without serializing unrelated pairs
- Pair-scoped failure containment `{ pairId, errorCode, message, timestamp }`; per-pair errors must not break `getStatus()` or other pairs (defensive try/catch around per-pair supervisor/runtime state reads)
- Runtime persistence in the `runtime_state` table (`SCHEMA_VERSION = 4`): per-pair `runtimeEnabled` and `lastRuntimeStopAt`; any stop persists `runtimeEnabled: false`; no auto-boot, restarts require explicit `runtime start`
- CLI: `runtime start --all|<pairIds...> [--relay] [--poll-interval] [--stuck-after] [--recovery]`, `runtime status [--all|<pairIds...>] [--json]`, `runtime stop --all|<pairIds...>`; `runtime start` blocks until SIGINT/SIGTERM; errors go to stderr with exit code 1
- Runtime events: `RUNTIME_STARTED`, `RUNTIME_STOPPED`, `PAIR_RUNTIME_STARTED`, `PAIR_RUNTIME_STOPPED`, `PAIR_RUNTIME_FAILED`, `PAIR_RUNTIME_RECOVERED`; pair events always carry `pairId`
- Per-pair JSON-lines log to `logs/pairs/<pairId>.ndjson` via `MultiSinkSupervisorLogger` (on by default; `perPairLogs:false` injectable to avoid file writes in tests)
- Worker/planner-neutral architecture preserved; isolation verified by tests (relay correlates strictly per pair, peer-failure isolation, duplicate-identity rejection, no leaked loop activity after shutdown)

Out of scope:

- Desktop dashboard (M10)
- Sonoma/dashboard watchers or autonomous recovery daemons beyond `runtime start` supervision
- AI/model judgment anywhere in readiness, state, or isolation decisions

## M10a - Electron desktop shell and runtime dashboard

Optional cross-platform Electron desktop shell with a single-window runtime dashboard that reuses core runtime, persistence, validation, and adapter APIs over a narrow, whitelisted IPC bridge. No business logic is duplicated in the renderer.

Functional slice now covered:

- `DesktopApplicationService` facade in `src/application/desktop-service.ts` (UI-independent; drives the same `RuntimeOrchestrator`, `SqliteRelayStore`, `validatePair`, and `createPairAdapters` stack the CLI uses)
- Desktop command: `npm run desktop:build` (compile `src/**` + `desktop/**` to `desktop-dist/` via `tsconfig.desktop.json`, bundle the sandboxed CommonJS preload and browser renderer with esbuild, copy static assets) and `npm run desktop:dev` (build + launch Electron)
- Narrow IPC contract in `desktop/shared/ipc-channels.ts`: an explicit `ALLOWED_INVOKE_CHANNELS` whitelist of `desktop:*` invoke channels enforced by the preload; a receive-only `desktop:event` channel for core→renderer events
- Renderer sandbox: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; plain serializable DTOs only (`desktop/shared/dto.ts`); no generic execute/read/write/arbitrary channel; sensitive values never cross to the renderer
- Dashboard pairs view (start/stop/pause/resume/validate per pair, Start All / Stop All / Refresh), events list (core event bridge + periodic reconciliation fallback), and a config-path header; "No session pairs configured" empty state for a missing config
- Deterministic by default: with no live flags the same `FakeChatGPTBrowserAdapter` + `StaticOpenCodeAdapter` are used, so the dashboard never touches live systems unintentionally; live ChatGPT/OpenCode only via the explicit live flags/config
- Reuses the same `PairsConfig` path and the same SQLite store; closing the app stops runtimes started by this process but never kills an external OpenCode server or external Chrome
- Tests: `tests/desktop.service.test.ts` (facade list/validate/start/stop/pause/resume/startAll/stopAll/events/shutdown/error surface), `tests/desktop.ipc.test.ts` (whitelist + DTO discriminators + no arbitrary channels), `tests/desktop.renderer.test.ts` (pair-card model, button rules, READY/NOT_READY, disconnected/failure, event ordering/capping/filtering)

Out of scope (deferred to M10b):

- Packaging/installers per platform, tray integration, auto-update
- A product-managed browser launcher (added later as a desktop setup usability extension)
- Cross-pair trends / historical analytics dashboards
- Live ChatGPT read/send surfacing beyond the CLI one-shot commands

## M10b - Desktop pair setup wizard

Follow-on desktop milestone that lets a user create, edit, rebind, and remove session pairs entirely from the dashboard, so normal setup requires only: open app → Add Pair → choose/create an OpenCode session → paste a ChatGPT conversation URL → validate → save → start. It reuses the same core APIs as the CLI and never duplicates validation or readiness logic in the renderer.

- Canonical ChatGPT conversation URL parser in `src/sessions/chatgpt-url.ts` (returns typed `ChatGptUrlError` codes). The stable semantic anchor is the `/c/<conversation-id>` segment: both `https://chatgpt.com/c/<id>` and project-scoped `https://chatgpt.com/g/<project>/c/<id>` routes parse, query/hash fragments are ignored, and the canonical conversation URL is normalized to `https://chatgpt.com/c/<id>`.
- Configuration schema evolution: an empty `{"pairs": []}` config is now a valid configuration (`src/sessions/pairs.ts` allows an empty canonical pair array). This is a desktop-lifecycle-driven change shared by desktop and CLI: a fresh desktop setup starts with zero pairs and removing the final pair leaves a reloadable config.
- `PairConfigRepository` in `src/application/pair-config-repository.ts` (load/addPair/updatePair/removePair) over the shared config path: preserves the exact `PairsConfig` format and unrelated pairs, validates before every write (via the canonical `parsePairsConfig` + unique ownership), treats `pairId` as immutable on edit, rejects duplicate `pairId`/OpenCode session/ChatGPT conversation ownership with actionable typed errors, and writes atomically via a same-directory temp file + rename for cross-platform safety.
- `DesktopApplicationService` wizard operations (UI-independent, in `src/application/desktop-service.ts`): `discoverOpenCodeSessions`/`createOpenCodeSession`/`testOpenCodeEndpoint`, read-only detection of the active OpenCode Desktop tab, `parseChatGptUrl`/`testPlannerEndpoint`, `validateCandidatePair`, `createPair`/`updatePair`/`removePair`/`rebindWorker`. Pairs must be stopped before editing, rebinding, or removing (`PAIR_RUNNING` guard); the detected session is shown and selected in the wizard before save; removing a pair never deletes the OpenCode session, ChatGPT conversation, browser profile, or relay history.
- New explicit IPC channels in `desktop/shared/ipc-channels.ts` (`desktop:pairs:create`/`update`/`remove`/`rebindWorker`, `desktop:pairs:validate-candidate`, `desktop:worker:sessions`/`create`/`test`/`endpoint`, `desktop:planner:parse-url`/`test`/`endpoint`), enforced by the preload whitelist, with typed serializable DTOs; no arbitrary file/command execution.
- Wizard UI in the renderer (Add Pair button, per-pair Edit / Rebind Worker / Remove actions, a modal wizard with Back/Next/Cancel that retains entered values on navigation, deterministic step gating, automatic active-session detection from a running OpenCode Desktop app with a manual retry button, explicit server discovery/selection, conversation URL parsing, connection tests, candidate validation, and save). The OpenCode Desktop scan runs in the main process and reads only persisted tab metadata—never the sidecar password, session database, or renderer filesystem. A later usability extension adds explicit **Start OpenCode server**, **Update OpenCode command**, and **Launch automation Chrome** actions before their respective connection tests; launch actions are loopback-only typed IPC operations, avoid shell execution, use a dedicated browser profile, verify the selected session rather than only the listening port, and clean up only child processes launched by Agent Relay.
- Tests: `tests/chatgpt-url.test.ts` (canonical parser), `tests/pair-config-repository.test.ts` (load/add/update/remove, atomic save, ownership + immutability, empty-config lifecycle), `tests/desktop.setup.test.ts` (service wizard ops incl. running-pair guard and remove-last-pair), `tests/desktop.wizard.test.ts` (renderer wizard state machine: step gating, candidate building, value retention on navigation), extended `tests/desktop.ipc.test.ts` (new whitelisted channels) and `tests/config.test.ts` (zero-pair canonical config).

Out of scope for M10b (deferred): packaging/installers, auto-update, tray/background service, editing an active pair's identity while running, and automatic replacement-session or conversation guessing.

## Later milestones

- M10c+: packaging/installers, tray/background service, auto-update, richer analytics, and any remaining desktop conveniences, scoped separately.
