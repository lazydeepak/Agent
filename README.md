# agent-relay

High-reliability bidirectional message transport between autonomous agents.

`agent-relay` is a professional transport layer that pairs **Worker Agents** with **Planner Agents**. It ensures reliable, at-least-once message delivery with deterministic supervision and strong duplicate suppression.

## 🚀 Quick Start

To run this application in your local environment:

1. **Install dependencies**:
   ```sh
   npm install
   ```

2. **Run the Dashboard (Preview)**:
   This launches the web-based control panel:
   ```sh
   npm run dev
   ```

3. **Run the Desktop App (Electron)**:
   If you have Electron installed locally:
   ```sh
   npm run desktop:dev
   ```

4. **Configure your first Agent Pair**:
   Open the dashboard, click **+ Add Project** or **+ Add Session**, and follow the setup wizard to connect your local repository and chat conversation.

## Key Features

- **Automatic Transport**: The supervisor continuously observes configured pairs and automatically relays messages as soon as they are stable.
- **Deterministic Supervision**: Uses a clear state machine (`READY`, `WORKING`, `WAITING`, `FAILED`) based on peer health and message cycles—no AI judgment.
- **Relay Ledger**: Every delivery is recorded in a local SQLite database to prevent duplicates and handle crashes gracefully.
- **Desktop Dashboard**: A modern Electron interface for managing projects, monitoring transport history, and starting/stopping relays.
- **Safe Recovery**: Bounded, deterministic recovery for connectivity failures (reconnects CDP, verifies sessions) without autonomous re-prompting.

## Session pairs

A session pair is the stable configuration that says one worker session is owned by one planner conversation.

The canonical M1 shape is:

```json
{
  "pairId": "kisab-main",
  "enabled": true,
  "worker": {
    "type": "opencode",
    "sessionId": "ses_xxx",
    "repoPath": "/Users/lazydeepak/dev/kisab",
    "server": {
      "baseUrl": "http://127.0.0.1:4096",
      "username": "opencode",
      "passwordEnv": "OPENCODE_SERVER_PASSWORD"
    }
  },
  "planner": {
    "type": "chatgpt-browser",
    "conversationId": "xxx",
    "conversationUrl": "https://chatgpt.com/c/xxx"
  }
}
```

Configuration validation rejects missing required fields, unsupported adapter types, malformed `pairId` values, duplicate pair IDs, duplicate OpenCode session ownership, duplicate ChatGPT conversation ownership, and mismatches between `planner.conversationId` and the ID derived from `planner.conversationUrl`.

`pairId` values must use lowercase letters, numbers, and single hyphens, starting with a letter.

The `worker.server` object is optional. If omitted, live OpenCode commands can use:

- `--opencode-url`
- `--opencode-username`
- `--opencode-password`
- `--opencode-password-env`
- `AGENT_RELAY_OPENCODE_BASE_URL`
- `AGENT_RELAY_OPENCODE_USERNAME`
- `AGENT_RELAY_OPENCODE_PASSWORD`

The `planner.browser` object is optional. Live ChatGPT readiness can use:

- `cdpUrl`
- `executablePath`
- `userDataDir`
- `headless`
- `timeoutMs`
- `--live-chatgpt`
- `--chatgpt-cdp-url`
- `--chatgpt-executable`
- `--chatgpt-profile`
- `--chatgpt-headless`
- `--chatgpt-timeout`

## Project layout

```text
agent-relay/
├── src/
│   ├── sessions/        # pairing + lifecycle
│   ├── validator/       # readiness checks
│   ├── relay/           # message transport
│   ├── supervisor/      # deterministic watcher/state machine
│   ├── recovery/        # bounded, deterministic safe recovery
│   ├── runtime/         # M9 multi-pair orchestration (registry, pair runtime, scheduler)
│   ├── persistence/     # SQLite relay ledger + supervisor continuity
│   ├── contracts/       # DTOs shared between core and the desktop shell
│   ├── remote/          # optional loopback-only HTTP control API (bearer token required)
│   ├── util/            # neutral async, URL, canonicalization, and readiness helpers
│   └── adapters/
│       ├── opencode/
│       └── chatgpt/
├── src/application/     # M10a UI-independent desktop service facade
├── desktop/             # M10a Electron shell
│   ├── main/            # Electron main: ipc-handlers (DI-ed), ipc-input (validators), cli-options
│   ├── renderer/        # views: pair-card, wizard-view, worker-session, progress-view, events,
│   │                    #        dom, state-view, actions, planner (all leaf modules; renderer.ts is wiring)
│   ├── preload/         # typed contextBridge (desktop:* allowlist)
│   └── shared/          # IPC channel names + DTOs incl. the core-owned worker-progress contract
├── config/
├── data/                # SQLite/runtime state, gitignored
├── logs/                # gitignored
├── tests/
├── docs/
├── README.md
└── AGENTS.md
```

## Configuration

Use `config/pairs.example.json` as the checked-in shape reference. Put real session IDs, credentials, browser profiles, runtime state, and logs outside Git.

The default validation path uses deterministic fake adapters so tests can prove schema, selection, and readiness reporting without external services. Add `--live-opencode`, configure `worker.server.baseUrl`, or pass `--opencode-url` to run worker readiness against a live OpenCode server. Add `--live-chatgpt`, configure `planner.browser`, or pass a ChatGPT browser option to run planner readiness against a live browser. Tests and local experiments may set fake readiness overrides on `worker.readiness` or `planner.readiness`.

## Readiness

External status is intentionally only:

- `READY`
- `NOT_READY`

Internally, every mandatory check must pass for the pair to be `READY`.

Readiness checks:

- `worker.serverReachable`
- `worker.sessionExists`
- `worker.repoMatches`
- `worker.acceptsInput`
- `planner.browserReachable`
- `planner.authenticated`
- `planner.conversationReachable`
- `planner.composerAvailable`
- `planner.notGenerating`
- `pair.exclusiveOwnership`
- `pair.stateConsistent`

Each check reports `name`, `status`, `reason`, and whether it is mandatory. Adapter errors are converted into failed readiness checks with explicit reasons.

## Relay

M3 supports one explicit direction:

- OpenCode worker assistant message to ChatGPT planner adapter

M4 adds the reverse direction:

- mocked ChatGPT planner message to OpenCode worker session

M5b makes ChatGPT live behind the same planner adapter when `--live-chatgpt` or browser settings are supplied. Both directions remain one-shot commands. They validate the pair first and do not run any watcher loop. Without live ChatGPT, planner-to-worker still takes an explicit `--message` argument.

## Persistence and duplicate-send protection (M6)

Relay attempts persist to a local SQLite database so a relay action is safe to retry. The default path is `data/agent-relay.sqlite`, overridable with `--db <path>` or `AGENT_RELAY_DB`. The database is local-only and must never be committed; `data/` is already gitignored. It uses the Node built-in `node:sqlite` driver (requires Node >= 22.5).

The storage layer sits behind a UI-independent abstraction under `src/persistence`. Schema is created automatically and idempotently; a corrupted/invalid DB file produces an explicit, actionable error.

Persisted relay message identity includes `pairId`, `direction` (`worker-to-planner` or `planner-to-worker`), `sourceMessageId`, a SHA-256 content `sourceHash`, optional `sourceTimestamp`, `targetId`, delivery `status`, timestamps, `attemptCount`, and `error`. Cycle states are `DISCOVERED`, `DELIVERING`, `DELIVERED`, and `FAILED`. Pair runtime metadata (`lastWorkerMessageId`, `lastPlannerMessageId`, `lastSuccessfulRelayAt`, `lastDirection`, `lastError`) is persisted too.

### Identity policy

A canonical identity is `(pairId, direction, sourceMessageId, sourceHash)`.

- Same `sourceMessageId` + same content → same identity → duplicate, skipped.
- Same `sourceMessageId` but different content → different identity → delivered again (content change detected explicitly).
- Same text but a different stable upstream `sourceMessageId` → different identity → delivered again.
- Pairs and directions are isolated: the same message id in a different pair or direction never collides.

### Duplicate suppression

Before sending, the relay computes the canonical identity and queries the ledger.

- If an identity is already `DELIVERED`, it is not sent again and the CLI reports `SKIPPED_DUPLICATE`.
- If an identity is stuck in `DELIVERING` (an incomplete prior attempt, e.g. a crash after send but before the `DELIVERED` write), the relay reports `AMBIGUOUS` and refuses to resend without `--force`; reconcile externally.
- A failed delivery is recorded as `FAILED`, and a later retry is allowed.

### Crash guarantee

The transport guarantee is **at-least-once** with strong duplicate suppression and crash-aware state. It is not perfectly exactly-once unless the external endpoint supports idempotency. `DELIVERING` is written before the external send and `DELIVERED` after a confirmed send, so an ambiguous `DELIVERING` record is detected on restart and never blindly resent without policy.

### Force resend

`--force` bypasses duplicate suppression for an intentional duplicate delivery. It is obvious in CLI output (`[force] Duplicate suppression bypassed`) and still records a new attempt. `--force` is never the default.

### Persistence is opt-in per command

The `validate` and existing relay paths keep their prior behavior when no persistence is wired. Relay commands receive the persistent store from the CLI automatically.

## Transport Management (M7)

The transport layer continuously observes configured pairs, classifies state deterministically, and relays messages safely through the M6 ledger.

State transitions are decided by a pure classifier assigned per observation:

| State | Meaning |
| --- | --- |
| `READY` | Quiescent, no cycle started |
| `IDLE` | Quiescent, prior relay history but no completed cycle |
| `WORKING` | Active transport or deliberation in progress |
| `WAITING_PLANNER` | Awaiting planner generation |
| `WAITING_WORKER` | Awaiting worker task completion |
| `COMPLETED` | Transport cycle completed |
| `PAUSED` | Relay stopped manually |

Relays only run with `--watch --relay` and only when a message identity has not already been delivered (M6 ledger). A one-shot `supervise` (the default, or `--once` explicitly, which cannot be combined with `--watch`) is read-only.

```sh
# one-shot read-only observation
npm run relay -- supervise local-dev --config config/pairs.local.json --opencode-url http://127.0.0.1:4096

# continuous watch with safe relays
npm run relay -- supervise local-dev --watch --relay --config config/pairs.local.json --opencode-url http://127.0.0.1:4096 --db data/agent-relay.sqlite

# pause / resume / status (persists across restarts)
npm run relay -- supervisor status local-dev --db data/agent-relay.sqlite
npm run relay -- supervisor pause local-dev --db data/agent-relay.sqlite
npm run relay -- supervisor resume local-dev --db data/agent-relay.sqlite
```

Watch defaults to a 5-second poll (`--poll-interval`), and `STUCK` requires 10 minutes without progress (`--stuck-after`). Events append as JSON lines to `logs/supervisor.ndjson`.

### ChatGPT access is event-driven and conservatively rate limited (M5b/M7)

The supervisor polls the **worker** every cycle (a cheap HTTP read), but it only touches the ChatGPT conversation when a write is warranted — never on a fixed schedule while the worker is busy:

- **Event-driven observation**: while the OpenCode worker is gathering/mid-task, `observePlannerConversation` is **not** called; the last observed conversation state is reused. ChatGPT is only re-observed when the worker stops gathering (a fresh report to send) or while awaiting a ChatGPT response. Every `observePlannerConversation`/`observeOnce` reports `plannerObserved` so callers can see when the conversation was actually polled.
- **No per-poll reload**: a live CDP ChatGPT adapter keeps its page open for the lifetime of the adapter and reuses the already-open conversation instead of navigating/reloading it on every poll cycle. Navigation happens once (or when the conversation changes), not every cycle.
- **Submission gate**: worker→planner submissions on the live ChatGPT adapter are gated to a **30-second minimum spacing per pair**. When a submission is attempted too soon, the pending worker report is **held (queued, never dropped)** and retried once the interval passes. This is a second line of defense beyond the existing M6 ledger duplicate suppression.
- **Rate-limit backoff**: a ChatGPT temporary rate-limit response (e.g. "you're making requests too quickly") starts a **bounded exponential backoff** per pair — 30s initial, doubling, capped at 5 minutes — and blocks further submissions without dropping the pending report. A successful submission resets the backoff for that pair straight to the normal 30s spacing.
- The CLI's explicit one-shot `relay`/`send` commands are untouched: they remain explicit user actions and are not throttled.

## Recovery and process/transport resilience (M8)

Recovery is bounded, deterministic, and opt-in. It never uses AI/model judgment, never autonomously re-prompts a stuck agent, and never resumes an interrupted relay on its own.

```sh
# continuous watch with safe recovery enabled (relay piping through the M6 ledger)
npm run relay -- supervise local-dev --watch --relay --recovery safe --recovery-max-attempts 4 \
  --config config/pairs.local.json --opencode-url http://127.0.0.1:4096 --db data/agent-relay.sqlite

# one-shot recovery pass against a pair (read-only observation, no watcher)
npm run relay -- recovery retry local-dev --config config/pairs.local.json --opencode-url http://127.0.0.1:4096

# inspect the recovery history persisted for a pair
npm run relay -- recovery status local-dev --json --db data/agent-relay.sqlite

# browser ownership and manual lifecycle inspection (managed browsers only)
npm run relay -- browser status local-dev --config config/pairs.local.json
npm run relay -- browser stop local-dev --config config/pairs.local.json
```

What `safe` recovery does:

- **OpenCode**: reconnects to the configured session over HTTP with bounded backoff (`1000, 2000, 5000, 10000, 30000` ms), retries re-auth for bearer/device credentials, and re-verifies the configured session and repo. If the configured session no longer exists it reports `OPENCODE_SESSION_MISSING` intervention; it never binds a different session and never re-sends a pending message.
- **ChatGPT browser**: reconnects a dropped CDP transport, reopens a closed conversation, and relaunches a *managed* browser (external browsers are never killed or restarted). A signed-out session reports `CHATGPT_AUTH_REQUIRED` intervention; Agent never logs itself into ChatGPT.

> **Managed-browser audit note**: CLI `browser start|stop` still requires a caller-supplied `ManagedBrowserLens`. The desktop setup wizard separately provides a narrow **Launch automation Chrome** action: it starts a dedicated local Chrome profile with a loopback CDP port, opens ChatGPT for manual sign-in/conversation selection, and owns only that launched process.


- **STUCK**: verify-only. The engine re-observes peer activity and only reports whether progress resumed or `STUCK_UNRESOLVED` intervention is required. No corrective prompt is ever sent.
- **Ambiguous delivery**: a pending `DELIVERING` record from a crash blocks recovery with `RELAY_AMBIGUOUS` until reconciled; nothing is auto-resumed.
- **Stabilization**: before a worker report is relayed, it must be observed unchanged for a stability window (default 2x poll interval), preventing a partially-streamed assistant message from being relayed.
- **Restart continuity**: supervisor restarts do not re-send already-delivered messages in either direction.

Set `--recovery none` (or the `none` policy per pair) to disable recovery entirely. Recovery metadata (`recovery_policy`, `recovery_attempt_count`, last attempt/success/error) persists in the `supervisor_state` table and is exposed by `recovery status`. Recovery runs only under `supervise --watch` or the explicit `recovery retry` command — never as an unsupervised autonomous daemon.

## Multi-pair runtime orchestration (M9)

M9 supervises multiple OpenCode ↔ ChatGPT pairs concurrently inside one runtime, with strict per-pair isolation. Each pair gets its own async supervisor loop, its own continuity, and its own relay ledger correlation. A blocked or failed pair never stalls the others, and no pair can read or write another pair's messages.

```sh
# start every enabled pair and block until SIGINT/SIGTERM
npm run relay -- runtime start --all --relay --config config/pairs.local.json \
  --opencode-url http://127.0.0.1:4096 --db data/agent-relay.sqlite

# start specific pairs only
npm run relay -- runtime start kisab-main susankhya-main --config config/pairs.local.json

# render runtime status (persistence-derived when nothing is running)
npm run relay -- runtime status --all --config config/pairs.local.json --db data/agent-relay.sqlite
npm run relay -- runtime status --json --config config/pairs.local.json --db data/agent-relay.sqlite

# record a stop (runtimeEnabled=false) and exit; restarting requires an explicit runtime start
npm run relay -- runtime stop --all --config config/pairs.local.json --db data/agent-relay.sqlite
```

What the runtime does:

- **Concurrency**: a per-pair async loop runs each supervisor independently. A blocked pair (e.g. a slow or unreachable peer) or a recovery backoff does not delay the healthy pairs, and one pair's failure does not terminate the runtime.
- **Hard isolation**: runtime startup fails immediately if any two configured pairs own the same OpenCode `sessionId` or the same ChatGPT `conversationId` (checked against all configured pairs, enabled or disabled). A shared OpenCode `baseUrl` and shared CDP endpoints are allowed — only session/conversation identity must be unique.
- **Visible worker session**: relays and supervision bind to the pair's persisted, desktop-visible OpenCode session (`worker.sessionId`) over the shared `worker.server.baseUrl`, so the user can open, watch, and review the exact session that is being relayed. The runtime never creates a hidden/competing worker session — `createSession` is only reachable through the explicit README/CLI `sessions create` command or the desktop wizard (both create normal sessions the user can open).
- **Narrow browser lock**: a FIFO mutex keyed by CDP/profile serializes browser navigation across pairs so adapters do not interleave, without serializing unrelated pairs.
- **Failure containment**: per-pair errors are scoped to `{ pairId, errorCode, message, timestamp }`. A failing pair is reported (and, if it fails to start, the pair goes `ERROR`) while the rest keep running; `getStatus()` remains usable even when an individual supervisor/store call throws.
- **Lifecycle**: per-pair `PairRuntimeState` is `STOPPED | STARTING | RUNNING | PAUSED | STOPPING | ERROR`. Status reports both the runtime state and the supervisor state (`READY`/`WORKING`/…).
- **Persistence**: the `runtime_state` table (schema v4) records `runtimeEnabled` and `lastRuntimeStopAt` per pair. Any stop persists `runtimeEnabled: false`. The CLI never auto-boots: a restart requires an explicit `runtime start`. The desktop shell instead restores pairs that were left running when the app last exited (`resumeManagedPairs`, gated by the persisted `runtimeEnabled` flag).
- **Events + logs**: `RUNTIME_STARTED`, `RUNTIME_STOPPED`, `PAIR_RUNTIME_STARTED`, `PAIR_RUNTIME_STOPPED`, `PAIR_RUNTIME_FAILED`, `PAIR_RUNTIME_RECOVERED` — pair events always carry `pairId`. `runtime start` also logs a per-pair JSON-lines file to `logs/pairs/<pairId>.ndjson` (on by default).

Peer health is deterministic (no AI judgment): a worker is `failed` when it is unreachable or its session is missing; a planner is `failed` when unreachable, unauthenticated, or its conversation is unreachable.

## Desktop shell and runtime dashboard (M10a)

M10a adds an optional cross-platform Electron desktop shell with a single-window runtime dashboard. It does **not** duplicate core business logic: the desktop process drives the same `RuntimeOrchestrator`, `SqliteRelayStore`, `validatePair`, and pair-adapter stack the CLI uses, through a UI-independent `DesktopApplicationService` facade in `src/application/desktop-service.ts`.

```sh
# compile the desktop build and open the dashboard
npm run desktop:build
npm run desktop:dev     # = desktop:build + launch Electron

# point the dashboard at a specific config (defaults to the same path the CLI uses)
npm run desktop:dev -- --config config/pairs.local.json --db data/agent-relay.sqlite
```

Cli flags: `--config/-c`, `--db`, `--live-opencode`, `--live-chatgpt`, `--opencode-url`, `--chatgpt-cdp-url`, `--relay` (mirroring the CLI). You can also set `AGENT_RELAY_CONFIG`.

Security and architecture boundaries:

- **Reuse, no duplication**: the renderer never talks to SQLite, OpenCode/CDP, or the filesystem directly. All reads go through a narrow, typed `contextBridge` API exposed over `ipcRenderer.invoke` channels that are explicitly whitelisted in `desktop/shared/ipc-channels.ts`. There is no generic execute/read/write/arbitrary channel.
- **Sandboxed renderer**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. DTOs are plain serializable objects; no class instances cross IPC.
- **Deterministic by default**: with no live flags, `FakeChatGPTBrowserAdapter` + `StaticOpenCodeAdapter` are used exactly as in the CLI, so the dashboard is safe to open without touching live systems.
- **Live ChatGPT/OpenCode through the same explicit endpoints/config as the CLI.** During desktop setup, the wizard can start `opencode serve` in the selected session repository and launch a dedicated automation Chrome profile. Both actions are explicit, loopback-only, use fixed argument arrays without a shell, and stop only processes started by this desktop instance. Existing external endpoints are reused and never terminated.
- **Config + persistence**: the dashboard loads the same `PairsConfig` format and persists to the same SQLite store; sensitive values (passwords, cookies, tokens) are never sent to the renderer.
- **Shutdown**: closing the app stops the Agent runtimes this desktop process started; it never kills an external OpenCode server or external Chrome.

### M10b - Desktop pair setup wizard

M10b adds pair setup to the dashboard so a normal workflow needs only: open app → Add Pair → choose/create an OpenCode session → paste a ChatGPT conversation URL → validate → save → start. Everything reuses the same core APIs as the CLI; the renderer keeps no validation or readiness logic.

- **Setup steps in-app**: pick or create an OpenCode session (with lightweight `Test connection` against the configured endpoint, no port scanning), paste a ChatGPT conversation URL (parsed canonically by `src/sessions/chatgpt-url.ts`, anchored on `/c/<id>` and normalized to `https://chatgpt.com/c/<id>`), review, validate, and save. Add/Edit/Rebind/Remove actions manage pairs; removing a pair never deletes the OpenCode session, ChatGPT conversation, browser profile, or relay history.
- **Deterministic and guarded**: pairs must be stopped before edit/rebind/remove (`PAIR_RUNNING`), `pairId` is immutable, duplicate session/conversation ownership is rejected, and setup enforces explicit URL parsing and connection tests rather than guessing.
- **Config evolution and persistence**: an empty `{"pairs": []}` config is now valid (`src/sessions/pairs.ts`), so fresh setups and removing the final pair stay reloadable. Pair edits go through `src/application/pair-config-repository.ts` with atomic writes to the same shared `PairsConfig` path.
- **Relay-mode seeding**: in relay mode a pair is seeded with a single versioned universal planning kickoff prompt (`desktop:automation:seed-planner` → `seedPlanner`, or `npm run relay -- seed local-agent <pairId>` for the local-agent variant). The seed is one-shot: it is sent before the first worker→planner handoff of a pair with no relay history (`requiresInitialPlannerHandoff`), and is never re-sent or auto-resumed afterwards. Starting a pair that still needs the handoff performs that first seed automatically rather than failing.

Test commands: `npm run check` (core + renderer typechecks), `npm test`, `npm run desktop:build`, `npm run desktop:check`.

## Project pairs (worker project ↔ planner project)

Project pairs are a second, coarser identity layer managed independently from `config/pairs.local.json`: one worker repository paired with one planner (ChatGPT) project, so several session pairs can belong to the same project. They live in `config/projects.local.json` (gitignored; see `config/projects.example.json`) and are validated by `src/sessions/project-pairs.ts` with a stable lowercase-hyphen `projectPairId` and unique worker/planner ownership.

```json
{
  "projectPairs": [
    {
      "projectPairId": "local-dev",
      "worker": { "repoPath": "/absolute/path/to/repo", "projectId": "optional" },
      "planner": { "projectSlug": "g-p-abc123", "projectName": "optional" }
    }
  ]
}
```

Keys are worker/planner-neutral. The legacy `opencode` / `chatgpt` spellings are still accepted on read and normalized to `worker` / `planner`.

## Optional remote control API

`src/remote/remote-server.ts` exposes a small read/status + project start/pause HTTP API for a mobile or remote client. It is **not** started by the CLI, the desktop shell, or any watcher — it is opt-in and must be wired explicitly.

- **Authentication is mandatory**: `createRemoteServer` throws unless `RELAY_REMOTE_TOKEN` (or `options.token`) is set; every request needs `Authorization: Bearer <token>`, compared in constant time, with a per-address limit on failed attempts.
- **Loopback by default**: the bind host defaults to `127.0.0.1` and a non-loopback bind is refused unless `RELAY_REMOTE_PUBLIC=1` (or `allowPublicBind`) is set.
- Endpoints: `GET /health`, `GET /status`, `GET /timeline?pairId=&limit=`, `POST /start-project`, `POST /pause-project`. Bodies are capped at 64 KB, ids are validated, and error responses never reflect internal messages or paths.

## Desktop launchers

`start.sh`, `start.command`, and `start.bat` are convenience launchers: they stop Electron processes belonging to this checkout, source `.env` (so `OPENCODE_SERVER_PASSWORD` reaches the managed `opencode serve`), keep the machine awake while Agent runs, and then run `npm run desktop:relay`. They are optional — `npm run desktop:dev` / `npm run desktop:relay` work directly.

## CLI

Install dependencies:

```sh
npm install
```

Copy `config/pairs.example.json` to a local config file and update it with an existing OpenCode session and ChatGPT conversation:

```sh
cp config/pairs.example.json config/pairs.local.json
npm run relay -- validate local-dev --config config/pairs.local.json
npm run relay -- validate --all --config config/pairs.local.json
```

The command exits with `0` only when every requested pair is `READY`. It exits non-zero when configuration is invalid, the pair is unknown, or any requested pair is `NOT_READY`.

Live OpenCode validation:

```sh
npm run relay -- validate local-dev --config config/pairs.local.json --live-opencode
npm run relay -- validate local-dev --config config/pairs.local.json --opencode-url http://127.0.0.1:4096
npm run relay -- validate local-dev --config config/pairs.local.json --live-chatgpt --chatgpt-profile /path/to/profile
npm run relay -- validate local-dev --config config/pairs.local.json --chatgpt-cdp-url http://127.0.0.1:9222
```

OpenCode session discovery and creation:

```sh
npm run relay -- opencode health --opencode-url http://127.0.0.1:4096
npm run relay -- opencode list --repo /Users/lazydeepak/dev/agent-relay --opencode-url http://127.0.0.1:4096
npm run relay -- opencode status --opencode-url http://127.0.0.1:4096
npm run relay -- opencode create --repo /Users/lazydeepak/dev/agent-relay --title agent-relay-smoke --opencode-url http://127.0.0.1:4096
```

Bind a configured pair to a selected OpenCode session:

```sh
npm run relay -- bind-opencode local-dev ses_xxx --config config/pairs.local.json
```

Relay one message through the configured pair:

```sh
npm run relay -- relay worker-to-planner local-dev --config config/pairs.local.json --opencode-url http://127.0.0.1:4096
npm run relay -- relay planner-to-worker local-dev --message "Implement the next small slice" --config config/pairs.local.json --opencode-url http://127.0.0.1:4096
npm run relay -- relay worker-to-planner local-dev --config config/pairs.local.json --opencode-url http://127.0.0.1:4096 --live-chatgpt --chatgpt-cdp-url http://127.0.0.1:9222
npm run relay -- relay planner-to-worker local-dev --config config/pairs.local.json --opencode-url http://127.0.0.1:4096 --live-chatgpt --chatgpt-cdp-url http://127.0.0.1:9222
```

Relay with duplicate protection and inspection (M6):

```sh
# force an intentional re-delivery (never the default)
npm run relay -- relay worker-to-planner local-dev --force --config config/pairs.local.json --opencode-url http://127.0.0.1:4096

# specify a custom runtime DB path
npm run relay -- relay worker-to-planner local-dev --db data/local.sqlite --config config/pairs.local.json --opencode-url http://127.0.0.1:4096

# initialize / inspect relay state
npm run relay -- state init [--db data/agent-relay.sqlite]
npm run relay -- state inspect [--db data/agent-relay.sqlite]
npm run relay -- state pair <pairId> [--db data/agent-relay.sqlite]
npm run relay -- state messages <pairId> [--json] [--db data/agent-relay.sqlite]
```

`state pair <pairId>` summarizes the last worker-to-planner and planner-to-worker deliveries plus any pending ambiguous attempts. `state messages <pairId>` lists the ledger, with `--json` for structured output. Duplicate-suppressed runs print `SKIPPED_DUPLICATE` and exit `0`; `AMBIGUOUS` and `FAILED` runs exit non-zero.

Recovery and browser lifecycle commands:

```sh
# supervised watch with safe, bounded recovery
npm run relay -- supervise local-dev --watch --relay --recovery safe --recovery-max-attempts 4 --config config/pairs.local.json --opencode-url http://127.0.0.1:4096 --db data/agent-relay.sqlite

# inspect recovery history for a pair
npm run relay -- recovery status local-dev [--json] --db data/agent-relay.sqlite

# run one explicit recovery pass (read-only, no watcher)
npm run relay -- recovery retry local-dev --config config/pairs.local.json --opencode-url http://127.0.0.1:4096 --db data/agent-relay.sqlite

# browser ownership and manual lifecycle (managed browsers only; external browsers report status and refuse start/stop)
npm run relay -- browser status local-dev --config config/pairs.local.json
npm run relay -- browser stop local-dev --config config/pairs.local.json
```

> `browser start` is intentionally not implemented: Agent never launches a managed browser
> from the CLI (the command returns “does not yet launch managed browsers”). The desktop shell’s
> **Launch automation Chrome** action starts a dedicated local Chrome profile with a loopback CDP
> port and then attaches over CDP only.

Worker model management:

```sh
# list models exposed by the worker server for a pair
npm run relay -- model list local-dev --config config/pairs.local.json

# switch the worker session model (pair must be stopped/restarted to take effect)
npm run relay -- model switch local-dev anthropic/claude-3-5-sonnet --config config/pairs.local.json

# pause supervision, switch to a fallback model, then resume
npm run relay -- model fallback local-dev anthropic/claude-3-5-sonnet --config config/pairs.local.json
```

## Checks

```sh
npm run check
npm test
npm audit --audit-level=moderate
git diff --check
```
