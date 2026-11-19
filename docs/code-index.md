# Agent-Relay Code Index

> Deterministic index of every `src/**/*.ts` module and its exported symbols.
> Generated: 2026-11-19T15:07:58.065Z  
> Regenerate: `npm run index:code`  
> **95 modules · 627 exported symbols**

This file is generated from source text — do not hand-edit. The narrative companion
(the comment pass that added module headers) lives in [`module-index.md`](./module-index.md).

## File map

| Module | Category | Purpose | Symbols |
|---|---|---|---:|
| `src/adapters/chatgpt/index.ts` | adapter-chatgpt | ChatGPT browser adapter exports. | 15 |
| `src/adapters/chatgpt/project-discovery.ts` | adapter-chatgpt | Source module for project-discovery.ts. | 7 |
| `src/adapters/chatgpt/service-warning.ts` | adapter-chatgpt | Source module for service-warning.ts. | 1 |
| `src/adapters/fake-readiness.ts` | adapters | Shared deterministic fake-adapter readiness helpers used by the mocked | 2 |
| `src/adapters/opencode/desktop-state.ts` | adapter-opencode | Source module for desktop-state.ts. | 7 |
| `src/adapters/opencode/event-source.ts` | adapter-opencode | Source module for event-source.ts. | 5 |
| `src/adapters/opencode/http.ts` | adapter-opencode | OpenCode HTTP client — typed request/response DTOs, auth headers, and error mapping for the OpenCode server. | 15 |
| `src/adapters/opencode/index.ts` | adapter-opencode | OpenCode adapter exports (session management, readiness, event source). | 10 |
| `src/application/approved-models.ts` | application | Restrict worker model switching to the operator-approved allow list in | 3 |
| `src/application/attention-service.ts` | application | Source module for attention-service.ts. | 2 |
| `src/application/config-file-store.ts` | application | Shared machinery for the pair-config and project-pair-config file repositories. | 4 |
| `src/application/continuation-briefing.ts` | application | v1.1 §7.5 — decide whether a Resume may use direct continuation | 8 |
| `src/application/control-plane-adapter.ts` | application | Control-plane adapter for worker/planner pairs. | 3 |
| `src/application/desktop-lifecycle.ts` | application | Source module for desktop-lifecycle.ts. | 6 |
| `src/application/desktop-service.ts` | application | Electron desktop service integration. | 11 |
| `src/application/desktop-tool-manager.ts` | application | Desktop tool launcher — spawns/attaches an external Chrome (CDP) and `opencode serve` for the Electron shell. | 7 |
| `src/application/event-log.ts` | application | Source module for event-log.ts. | 3 |
| `src/application/headless-service.ts` | application | Source module for headless-service.ts. | 2 |
| `src/application/health-monitors.ts` | application | Deterministic health-monitor definitions (session drift, transport, idle activity, delivery stalled, overall health). Consolidated from RelayX. | 9 |
| `src/application/local-agent-planner-prompt.ts` | application | Source module for local-agent-planner-prompt.ts. | 2 |
| `src/application/opencode-desktop.ts` | application | Rule 5 step 5 — OpenCode Desktop process control for approved recovery. | 3 |
| `src/application/pair-config-repository.ts` | application | Source module for pair-config-repository.ts. | 4 |
| `src/application/permission-service.ts` | application | v1.1 §11.5 — least-privilege, project/pair-scoped permission grants with | 5 |
| `src/application/planner-seeding-service.ts` | application | Source module for planner-seeding-service.ts. | 2 |
| `src/application/project-pair-repository.ts` | application | Project-pair identity / ownership service. | 3 |
| `src/application/project-pair-service.ts` | application | Project-pair identity / ownership service. | 5 |
| `src/application/relay-engine.ts` | application | Source module for relay-engine.ts. | 2 |
| `src/application/settings-repository.ts` | application | Tiny operator settings store (config/settings.local.json). | 2 |
| `src/application/universal-planner-prompt.ts` | application | Source module for universal-planner-prompt.ts. | 2 |
| `src/application/worker-progress.ts` | application | Worker progress tracking service. | 2 |
| `src/application/worker-question-service.ts` | application | Source module for worker-question-service.ts. | 1 |
| `src/application/worker-session-service.ts` | application | Worker session management service. | 2 |
| `src/application/worker-transcript-service.ts` | application | Worker transcript / session summary service. | 1 |
| `src/cli-args.ts` | entry | CLI argument parsing schema. | 4 |
| `src/cli.ts` | entry | CLI entrypoint — parses args and starts runtime / service. | 4 |
| `src/contracts/attention.ts` | contracts | Source module for attention.ts. | 7 |
| `src/contracts/control-plane.ts` | contracts | Control-plane adapter for worker/planner pairs. | 28 |
| `src/contracts/desktop.ts` | contracts | Source module for desktop.ts. | 67 |
| `src/contracts/events.ts` | contracts | Shared event contract across core, supervisor, recovery and the desktop shell. | 7 |
| `src/contracts/worker-progress.ts` | contracts | Worker progress tracking service. | 10 |
| `src/contracts/worker-question.ts` | contracts | Source module for worker-question.ts. | 1 |
| `src/contracts/worker-transcript.ts` | contracts | Worker transcript / session summary service. | 1 |
| `src/index.ts` | core | Module exports for src. | 0 |
| `src/persistence/archive.ts` | persistence | Source module for archive.ts. | 6 |
| `src/persistence/canonical.ts` | persistence | Canonicalization helpers (URL, identity, hash). | 3 |
| `src/persistence/index.ts` | persistence | Persistence / SQLite store exports. | 16 |
| `src/persistence/store.ts` | persistence | Source module for store.ts. | 9 |
| `src/recovery/browser.ts` | recovery | Source module for browser.ts. | 7 |
| `src/recovery/chatgpt.ts` | recovery | Source module for chatgpt.ts. | 3 |
| `src/recovery/engine.ts` | recovery | Source module for engine.ts. | 6 |
| `src/recovery/index.ts` | recovery | Recovery engine exports. | 24 |
| `src/recovery/opencode.ts` | recovery | Source module for opencode.ts. | 5 |
| `src/recovery/policy.ts` | recovery | Source module for policy.ts. | 4 |
| `src/recovery/reasons.ts` | recovery | Source module for reasons.ts. | 1 |
| `src/recovery/schedule.ts` | recovery | Source module for schedule.ts. | 5 |
| `src/relay/chatgpt-gate.ts` | relay | Source module for chatgpt-gate.ts. | 11 |
| `src/relay/index.ts` | relay | Relay core exports (identity, verification, ledger). | 11 |
| `src/relay/message-classifier.ts` | relay | Source module for message-classifier.ts. | 2 |
| `src/relay/planner-prompt.ts` | relay | Deterministic selection of the worker prompt from a planner (ChatGPT) assistant message's structured writing_blocks. Consolidated from TerminalBot/RelayLoop. | 5 |
| `src/relay/receipt-verification.ts` | relay | Deterministic receipt verification helpers (exact normalized + layout-insensitive fallback, baseline exclusion). Consolidated from TerminalBot/RelayLoop. | 6 |
| `src/relay/verifier.ts` | relay | Deterministic delivery verification (Rule 12). | 6 |
| `src/remote/remote-server.ts` | remote | Optional HTTP control API (service start only). | 4 |
| `src/runtime/adapters.ts` | runtime | Adapter registry / factory. | 4 |
| `src/runtime/index.ts` | runtime | Pair runtime orchestration exports. | 26 |
| `src/runtime/logging.ts` | runtime | Source module for logging.ts. | 2 |
| `src/runtime/orchestrator.ts` | runtime | Source module for orchestrator.ts. | 7 |
| `src/runtime/pair-runtime.ts` | runtime | Per-pair concurrent runtime supervisor. | 3 |
| `src/runtime/registry.ts` | runtime | Source module for registry.ts. | 3 |
| `src/runtime/scheduler.ts` | runtime | Source module for scheduler.ts. | 4 |
| `src/runtime/wake-bus.ts` | runtime | Source module for wake-bus.ts. | 3 |
| `src/service-entry.ts` | core | Source module for service-entry.ts. | 0 |
| `src/sessions/pairs.ts` | core | Source module for pairs.ts. | 5 |
| `src/sessions/project-pairs.ts` | core | Project-pair identity / ownership service. | 3 |
| `src/supervisor/classifier.ts` | supervisor | Source module for classifier.ts. | 7 |
| `src/supervisor/events.ts` | supervisor | Supervisor-side event logger implementations. The event type definitions | 3 |
| `src/supervisor/index.ts` | supervisor | Supervisor / observation loop exports. | 26 |
| `src/supervisor/observation.ts` | supervisor | Observation / event correlation utilities. | 4 |
| `src/supervisor/policy.ts` | supervisor | Source module for policy.ts. | 4 |
| `src/supervisor/state.ts` | supervisor | Source module for state.ts. | 4 |
| `src/supervisor/supervisor.ts` | supervisor | Source module for supervisor.ts. | 8 |
| `src/types.ts` | core | Source module for types.ts. | 49 |
| `src/util/async.ts` | util | Async primitives (timeout, retry, bounded backoff). | 4 |
| `src/util/attention-parser.ts` | util | Source module for attention-parser.ts. | 1 |
| `src/util/canonical.ts` | util | Canonicalization helpers (URL, identity, hash). | 2 |
| `src/util/chatgpt-url.ts` | util | Source module for chatgpt-url.ts. | 5 |
| `src/util/composer-polling.ts` | util | Polling helper that waits for the ChatGPT composer to become ready before sending; injectable clock/sleep/AbortSignal. Consolidated from TerminalBot/RelayLoop. | 2 |
| `src/util/composer-readiness.ts` | util | Pure composer-readiness check: not generating, latest message is assistant, exactly one editable composer, draft matches expected payload. Consolidated from TerminalBot/RelayLoop. | 7 |
| `src/util/delivery-error.ts` | util | Source module for delivery-error.ts. | 1 |
| `src/util/duplicates.ts` | util | Shared duplicate-detection helpers for the pairs and project-pairs config | 2 |
| `src/util/net.ts` | util | Source module for net.ts. | 4 |
| `src/util/planner-control.ts` | util | Recognises the planner's terminal control messages (RELAY_COMPLETE / RELAY_BLOCKED). | 1 |
| `src/util/readiness.ts` | util | Readiness checks for worker/planner pairs. | 3 |
| `src/util/watermark.ts` | util | Embeds a compact, human-visible watermark on every relay message so | 5 |
| `src/validator/readiness.ts` | validator | Readiness checks for worker/planner pairs. | 4 |
| `src/validator/report.ts` | validator | Source module for report.ts. | 2 |

## Categories

| Category | Modules |
|---|---:|
| entry | 2 |
| contracts | 7 |
| adapters | 1 |
| adapter-opencode | 4 |
| adapter-chatgpt | 3 |
| relay | 6 |
| persistence | 4 |
| validator | 2 |
| supervisor | 7 |
| recovery | 8 |
| runtime | 8 |
| application | 25 |
| remote | 1 |
| util | 12 |
| core | 5 |

## Symbol index

Exported symbols per module, with the source line and a trimmed signature.

### entry

#### `src/cli-args.ts`
_CLI argument parsing schema._

- **CliError** `class` L10 — `export class CliError extends Error`
- **ParsedArgs** `interface` L17 — `export interface ParsedArgs`
- **parseArgs** `function` L48 — `export function parseArgs(args: string[]): ParsedArgs`
- **hasChatGPTBrowserConfig** `function` L475 — `export function hasChatGPTBrowserConfig(config?: ChatGPTBrowserConfig): boolean`

#### `src/cli.ts`
_CLI entrypoint — parses args and starts runtime / service._

- **parseArgs** `re-export` L49 (from `./cli-args.js`) — `export { parseArgs } from "./cli-args.js"`
- **(anonymous)** `type` L50 — `export type`
- **runCli** `function` L52 — `export async function runCli(args: string[]): Promise<void>`
- **recoveryOptions** `function` L1048 — `export function recoveryOptions( args: ParsedArgs, pair: SessionPair, launcher: LocalDesktopToolLauncher ): SupervisorRecoveryOptions | und…`

### contracts

#### `src/contracts/attention.ts`
_Source module for attention.ts._

- **WorkerAttentionKind** `type` L14 — `export type WorkerAttentionKind = "report" | "question" | "blocked" | "completed"`
- **AttentionStatus** `type` L16 — `export type AttentionStatus = "open" | "acknowledged" | "resolved"`
- **WorkerAttentionEnvelope** `interface` L18 — `export interface WorkerAttentionEnvelope`
- **AttentionItem** `interface` L23 — `export interface AttentionItem`
- **ListAttentionPayload** `interface` L38 — `export interface ListAttentionPayload`
- **AcknowledgeAttentionPayload** `interface` L43 — `export interface AcknowledgeAttentionPayload`
- **ResolveAttentionPayload** `interface` L47 — `export interface ResolveAttentionPayload`

#### `src/contracts/control-plane.ts`
_Control-plane adapter for worker/planner pairs._

- **ControlPlaneOperationType** `type` L13 — `export type ControlPlaneOperationType = | "getStatus" | "getTimeline" | "startProject" | "pauseProject" | "listAttention" | "acknowledgeAtt…`
- **ControlPlaneOperation** `interface` L45 — `export interface ControlPlaneOperation`
- **GetStatusPayload** `interface` L50 — `export interface GetStatusPayload`
- **GetTimelinePayload** `interface` L54 — `export interface GetTimelinePayload`
- **StartProjectPayload** `interface` L59 — `export interface StartProjectPayload`
- **PauseProjectPayload** `interface` L63 — `export interface PauseProjectPayload`
- **ListAttentionPayload** `interface` L67 — `export interface ListAttentionPayload`
- **AcknowledgeAttentionPayload** `interface` L72 — `export interface AcknowledgeAttentionPayload`
- **ResolveAttentionPayload** `interface` L76 — `export interface ResolveAttentionPayload`
- **RejectAttentionProposalPayload** `interface` L81 — `export interface RejectAttentionProposalPayload`
- **CreateAttentionProposalPayload** `interface` L85 — `export interface CreateAttentionProposalPayload`
- **ApproveAttentionProposalPayload** `interface` L92 — `export interface ApproveAttentionProposalPayload`
- **ListProposalsPayload** `interface` L100 — `export interface ListProposalsPayload`
- **GetProposalPayload** `interface` L105 — `export interface GetProposalPayload`
- **CreateProjectPairPayload** `interface` L109 — `export interface CreateProjectPairPayload`
- **RemoveProjectPairPayload** `interface` L115 — `export interface RemoveProjectPairPayload`
- **ListProjectPairsPayload** `interface` L119 — `export interface ListProjectPairsPayload`
- **CreatePairPayload** `interface` L123 — `export interface CreatePairPayload`
- **UpdatePairPayload** `interface` L131 — `export interface UpdatePairPayload`
- **RemovePairPayload** `interface` L140 — `export interface RemovePairPayload`
- **ValidatePairPayload** `interface` L144 — `export interface ValidatePairPayload`
- **GetPairPayload** `interface` L148 — `export interface GetPairPayload`
- **DiscoverWorkerSessionsPayload** `interface` L152 — `export interface DiscoverWorkerSessionsPayload`
- **BindWorkerSessionPayload** `interface` L157 — `export interface BindWorkerSessionPayload`
- **UpdateProjectPairPayload** `interface` L162 — `export interface UpdateProjectPairPayload`
- **ArchiveProjectPairPayload** `interface` L168 — `export interface ArchiveProjectPairPayload`
- **ListWorkerModelsPayload** `interface` L172 — `export interface ListWorkerModelsPayload`
- **SetWorkerModelPayload** `interface` L176 — `export interface SetWorkerModelPayload`

#### `src/contracts/desktop.ts`
_Source module for desktop.ts._

- **CheckStatusDto** `type` L15 — `export type CheckStatusDto = "PASS" | "FAIL"`
- **ReadinessCheckDto** `interface` L17 — `export interface ReadinessCheckDto`
- **ValidationResultDto** `interface` L23 — `export interface ValidationResultDto`
- **EventRecordDto** `interface` L30 — `export interface EventRecordDto`
- **RecentEventsFilterDto** `interface` L39 — `export interface RecentEventsFilterDto`
- **DesktopErrorDto** `interface` L44 — `export interface DesktopErrorDto`
- **PeerHealthDto** `interface` L50 — `export interface PeerHealthDto`
- **StatusSummaryDto** `interface` L89 — `export interface StatusSummaryDto`
- **PairIdentityDto** `interface` L98 — `export interface PairIdentityDto`
- **OpenCodeSessionInfoDto** `interface` L120 — `export interface OpenCodeSessionInfoDto`
- **OpenCodeEndpointDto** `interface` L127 — `export interface OpenCodeEndpointDto`
- **OpenCodeEndpointTestDto** `interface` L131 — `export interface OpenCodeEndpointTestDto extends OpenCodeEndpointDto`
- **CreateOpenCodeSessionDto** `interface` L136 — `export interface CreateOpenCodeSessionDto extends OpenCodeEndpointDto`
- **StartOpenCodeServerDto** `interface` L141 — `export interface StartOpenCodeServerDto extends OpenCodeEndpointDto`
- **ToolLaunchResultDto** `interface` L146 — `export interface ToolLaunchResultDto`
- **ToolActionResultDto** `interface` L153 — `export interface ToolActionResultDto`
- **WorkerSessionOpenResultDto** `interface` L158 — `export interface WorkerSessionOpenResultDto`
- **WorkerModelDto** `interface` L165 — `export interface WorkerModelDto`
- **SwitchWorkerModelDto** `interface` L172 — `export interface SwitchWorkerModelDto`
- **WorkerModelSwitchResultDto** `interface` L178 — `export interface WorkerModelSwitchResultDto extends WorkerModelDto`
- **ParsedChatGptUrlDto** `interface` L184 — `export interface ParsedChatGptUrlDto`
- **PlannerEndpointDto** `interface` L190 — `export interface PlannerEndpointDto`
- **EndpointTestResultDto** `interface` L195 — `export interface EndpointTestResultDto`
- **PairStartPriming** `type` L201 — `export type PairStartPriming = "from-worker" | "from-planner" | "from-trigger" | "resume"`
- **AutomationInfoDto** `interface` L203 — `export interface AutomationInfoDto`
- **PlannerSeedResultDto** `interface` L209 — `export interface PlannerSeedResultDto`
- **LocalAgentFeedResultDto** `interface` L219 — `export interface LocalAgentFeedResultDto`
- **CandidatePairDto** `interface` L226 — `export interface CandidatePairDto`
- **SettingsDto** `interface` L244 — `export interface SettingsDto`
- **SyncedProjectDto** `interface` L253 — `export interface SyncedProjectDto`
- **AutoResumeStateDto** `interface` L262 — `export interface AutoResumeStateDto`
- **UpdatePairDto** `interface` L267 — `export interface UpdatePairDto`
- **ProjectPairDto** `interface` L280 — `export interface ProjectPairDto`
- **CreateProjectPairDto** `interface` L294 — `export interface CreateProjectPairDto`
- **OpenCodeProjectDto** `interface` L308 — `export interface OpenCodeProjectDto`
- **ChatGptProjectDto** `interface` L314 — `export interface ChatGptProjectDto`
- **ChatGptProjectsDiscoveryInput** `interface` L322 — `export interface ChatGptProjectsDiscoveryInput`
- **ArchivedPairSummaryDto** `interface` L326 — `export interface ArchivedPairSummaryDto`
- **WorkerModelInfo** `interface` L335 — `export interface WorkerModelInfo extends OpenCodeModelInfo`
- **WorkerSessionDesktopAlignmentDto** `interface` L339 — `export interface WorkerSessionDesktopAlignmentDto`
- **ChatGptUrlInputDto** `interface` L347 — `export interface ChatGptUrlInputDto`
- **PairDetail** `type` L352 — `export type PairDetail = PairIdentityDto`
- **OpenCodeSessionInfo** `type` L353 — `export type OpenCodeSessionInfo = OpenCodeSessionInfoDto`
- **OpenCodeEndpointInput** `type` L354 — `export type OpenCodeEndpointInput = OpenCodeEndpointDto`
- **OpenCodeEndpointTestInput** `type` L355 — `export type OpenCodeEndpointTestInput = OpenCodeEndpointTestDto`
- **CreateOpenCodeSessionInput** `type` L356 — `export type CreateOpenCodeSessionInput = CreateOpenCodeSessionDto`
- **ChatGptUrlInput** `type` L357 — `export type ChatGptUrlInput = ChatGptUrlInputDto`
- **ParsedChatGptUrl** `type` L358 — `export type ParsedChatGptUrl = ParsedChatGptUrlDto`
- **PlannerEndpointInput** `type` L359 — `export type PlannerEndpointInput = PlannerEndpointDto`
- **StartOpenCodeServerInput** `type` L360 — `export type StartOpenCodeServerInput = StartOpenCodeServerDto`
- **EndpointTestResult** `type` L361 — `export type EndpointTestResult = EndpointTestResultDto`
- **WorkerSessionDesktopAlignment** `type` L362 — `export type WorkerSessionDesktopAlignment = WorkerSessionDesktopAlignmentDto`
- **AutomationInfo** `type` L363 — `export type AutomationInfo = AutomationInfoDto`
- **PlannerSeedResult** `type` L364 — `export type PlannerSeedResult = PlannerSeedResultDto`
- **LocalAgentFeedResult** `type` L365 — `export type LocalAgentFeedResult = LocalAgentFeedResultDto`
- **CandidatePairInput** `type` L366 — `export type CandidatePairInput = CandidatePairDto`
- **UpdatePairInput** `type` L367 — `export type UpdatePairInput = UpdatePairDto`
- **ValidatedPair** `type` L368 — `export type ValidatedPair = ValidationResultDto`
- **DiagnosticsSnapshotDto** `interface` L371 — `export interface DiagnosticsSnapshotDto`
- **DatabaseSettingsInfoDto** `interface` L390 — `export interface DatabaseSettingsInfoDto`
- **DatabaseBackupEntryDto** `interface` L402 — `export interface DatabaseBackupEntryDto`
- **DatabaseRestoreResultDto** `interface` L408 — `export interface DatabaseRestoreResultDto`
- **PermissionGrantAction** `type` L413 — `export type PermissionGrantAction = "model-switch-outside-approved" | "shared-service-restart"`
- **PermissionGrantMode** `type` L414 — `export type PermissionGrantMode = "one-time" | "permanent"`
- **PermissionGrantScopeType** `type` L416 — `export type PermissionGrantScopeType = "project" | "pair" | "global"`
- **PermissionGrantDto** `interface` L418 — `export interface PermissionGrantDto`
- **PermissionGrantInputDto** `interface` L431 — `export interface PermissionGrantInputDto`

#### `src/contracts/events.ts`
_Shared event contract across core, supervisor, recovery and the desktop shell._

- **EventRecord** `interface` L10 — `export interface EventRecord`
- **EventFilter** `interface` L21 — `export interface EventFilter`
- **RuntimeEventType** `type` L26 — `export type RuntimeEventType = | "RUNTIME_STARTED" | "RUNTIME_STOPPED" | "PAIR_RUNTIME_STARTED" | "PAIR_RUNTIME_STOPPED" | "PAIR_RUNTIME_FA…`
- **SupervisorEventType** `type` L37 — `export type SupervisorEventType = | "WATCH_STARTED" | "WATCH_STOPPED" | "STATE_CHANGED" | "STUCK_DETECTED" | "WORKER_MESSAGE_RELAYED" | "PL…`
- **SupervisorEvent** `interface` L82 — `export interface SupervisorEvent`
- **RuntimeEvent** `interface` L92 — `export interface RuntimeEvent`
- **SupervisorLogger** `interface` L100 — `export interface SupervisorLogger`

#### `src/contracts/worker-progress.ts`
_Worker progress tracking service._

- **WorkerProgressState** `type` L6 — `export type WorkerProgressState = | "working" | "idle" | "completed" | "failed" | "disconnected" | "reconnecting" | "waiting"`
- **WorkerProgressTodo** `interface` L15 — `export interface WorkerProgressTodo`
- **FileChangeStatus** `type` L23 — `export type FileChangeStatus = "added" | "modified" | "deleted" | "renamed"`
- **WorkerProgressFileChange** `interface` L25 — `export interface WorkerProgressFileChange`
- **WorkerProgressChangeSummary** `interface` L33 — `export interface WorkerProgressChangeSummary`
- **WorkerProgressToolCall** `interface` L40 — `export interface WorkerProgressToolCall`
- **WorkerProgressTimelineEntry** `interface` L51 — `export interface WorkerProgressTimelineEntry`
- **WorkerProgressLive** `interface` L76 — `export interface WorkerProgressLive`
- **WorkerProgressDto** `interface` L93 — `export interface WorkerProgressDto`
- **WorkerProgressSummary** `interface` L107 — `export interface WorkerProgressSummary`

#### `src/contracts/worker-question.ts`
_Source module for worker-question.ts._

- **WorkerQuestion** `interface` L6 — `export interface WorkerQuestion`

#### `src/contracts/worker-transcript.ts`
_Worker transcript / session summary service._

- **WorkerTranscript** `interface` L6 — `export interface WorkerTranscript`

### adapters

#### `src/adapters/fake-readiness.ts`
_Shared deterministic fake-adapter readiness helpers used by the mocked_

- **fakeCheck** `function` L12 — `export function fakeCheck( name: string, overrides: Record<string, boolean | string>, successReason: string ): ReadinessCheck`
- **overrideEnabled** `function` L26 — `export function overrideEnabled(overrides: Record<string, boolean | string>, name: string): boolean`

### adapter-opencode

#### `src/adapters/opencode/desktop-state.ts`
_Source module for desktop-state.ts._

- **OpenCodeDesktopSession** `interface` L14 — `export interface OpenCodeDesktopSession`
- **OpenCodeDesktopScanOptions** `interface` L20 — `export interface OpenCodeDesktopScanOptions`
- **OpenCodeDesktopStateError** `class` L25 — `export class OpenCodeDesktopStateError extends Error`
- **discoverOpenCodeServerUrl** `function` L36 — `export async function discoverOpenCodeServerUrl( options: OpenCodeDesktopScanOptions = {} ): Promise<string | undefined>`
- **scanOpenCodeDesktopActiveSession** `function` L56 — `export async function scanOpenCodeDesktopActiveSession( options: OpenCodeDesktopScanOptions = {} ): Promise<OpenCodeDesktopSession>`
- **parseOpenCodeDesktopWindowState** `function` L106 — `export function parseOpenCodeDesktopWindowState(value: unknown): OpenCodeDesktopSession | undefined`
- **openCodeDesktopStateDirectories** `function` L125 — `export function openCodeDesktopStateDirectories( platform: NodeJS.Platform = process.platform, environment: NodeJS.ProcessEnv = process.env…`

#### `src/adapters/opencode/event-source.ts`
_Source module for event-source.ts._

- **OpenCodeSessionEvent** `interface` L9 — `export interface OpenCodeSessionEvent`
- **OpenCodeEventSourceOptions** `interface` L18 — `export interface OpenCodeEventSourceOptions`
- **OpenCodeEventSourceTerminalError** `class` L38 — `export class OpenCodeEventSourceTerminalError extends Error`
- **OpenCodeEventSource** `interface` L48 — `export interface OpenCodeEventSource`
- **HttpOpenCodeEventSource** `class` L56 — `export class HttpOpenCodeEventSource implements OpenCodeEventSource`

#### `src/adapters/opencode/http.ts`
_OpenCode HTTP client — typed request/response DTOs, auth headers, and error mapping for the OpenCode server._

- **OpenCodeLocationRef** `interface` L14 — `export interface OpenCodeLocationRef`
- **OpenCodeSessionInfo** `interface` L19 — `export interface OpenCodeSessionInfo`
- **OpenCodeSessionList** `interface` L47 — `export interface OpenCodeSessionList`
- **OpenCodeMessageInfo** `interface` L55 — `export interface OpenCodeMessageInfo`
- **OpenCodePromptAdmission** `interface` L89 — `export interface OpenCodePromptAdmission`
- **OpenCodePromptResult** `interface` L104 — `export interface OpenCodePromptResult`
- **OpenCodePromptInput** `interface` L108 — `export interface OpenCodePromptInput`
- **OpenCodeDurableEvent** `interface` L118 — `export interface OpenCodeDurableEvent`
- **OpenCodeHistoryResult** `interface` L126 — `export interface OpenCodeHistoryResult`
- **CreateOpenCodeSessionInput** `interface` L131 — `export interface CreateOpenCodeSessionInput`
- **OpenCodeClientOptions** `interface` L137 — `export interface OpenCodeClientOptions extends OpenCodeServerConfig`
- **OpenCodeHttpError** `class` L148 — `export class OpenCodeHttpError extends Error`
- **OpenCodeUnexpectedResponseError** `class` L159 — `export class OpenCodeUnexpectedResponseError extends Error`
- **OpenCodeHttpClient** `class` L191 — `export class OpenCodeHttpClient`
- **OpenCodeWriteUnsupportedError** `class` L916 — `export class OpenCodeWriteUnsupportedError extends Error`

#### `src/adapters/opencode/index.ts`
_OpenCode adapter exports (session management, readiness, event source)._

- **HttpOpenCodeEventSource** `re-export` L33 (from `./event-source.js`) — `export {`
- **OpenCodeEventSource** `re-export` L33 (from `./event-source.js`) — `export {`
- **OpenCodeEventSourceOptions** `re-export` L33 (from `./event-source.js`) — `export {`
- **OpenCodeSessionEvent** `re-export` L33 (from `./event-source.js`) — `export {`
- **OpenCodeAdapter** `interface` L41 — `export interface OpenCodeAdapter`
- **OpenCodeSessionSummary** `interface` L47 — `export interface OpenCodeSessionSummary`
- **OpenCodeSessionManager** `interface` L55 — `export interface OpenCodeSessionManager extends OpenCodeAdapter`
- **FakeOpenCodeAdapter** `class` L82 — `export class FakeOpenCodeAdapter implements OpenCodeAdapter`
- **LiveOpenCodeAdapter** `class` L95 — `export class LiveOpenCodeAdapter implements OpenCodeAdapter, OpenCodeSessionManager`
- **StaticOpenCodeAdapter** `class` L472 — `export class StaticOpenCodeAdapter extends FakeOpenCodeAdapter implements OpenCodeSessionManager`

### adapter-chatgpt

#### `src/adapters/chatgpt/index.ts`
_ChatGPT browser adapter exports._

- **ChatGPTBrowserAdapter** `interface` L30 — `export interface ChatGPTBrowserAdapter`
- **PlannerSessionEvent** `interface` L46 — `export interface PlannerSessionEvent`
- **FakeChatGPTBrowserAdapter** `class` L52 — `export class FakeChatGPTBrowserAdapter implements ChatGPTBrowserAdapter`
- **ChatGPTReadinessSnapshot** `interface` L114 — `export interface ChatGPTReadinessSnapshot`
- **ChatGPTReadinessProbe** `interface` L124 — `export interface ChatGPTReadinessProbe`
- **ChatGPTBrowserDriver** `interface` L128 — `export interface ChatGPTBrowserDriver extends ChatGPTReadinessProbe`
- **LiveChatGPTBrowserOptions** `interface` L144 — `export interface LiveChatGPTBrowserOptions extends ChatGPTBrowserConfig`
- **DEFAULT_CHATGPT_RATE_LIMIT_BACKOFF_MS** `const` L150 — `export const DEFAULT_CHATGPT_RATE_LIMIT_BACKOFF_MS = 5 * 60_000`
- **LiveChatGPTBrowserAdapter** `class` L152 — `export class LiveChatGPTBrowserAdapter implements ChatGPTBrowserAdapter`
- **disposeManagedBrowsers** `function` L277 — `export async function disposeManagedBrowsers(): Promise<void>`
- **PlaywrightChatGPTBrowserDriver** `class` L288 — `export class PlaywrightChatGPTBrowserDriver implements ChatGPTBrowserDriver`
- **gotoPlannerPage** `function` L633 — `export async function gotoPlannerPage(page: Page, url: string, timeoutMs: number): Promise<void>`
- **isTransientGotoAbort** `function` L649 — `export function isTransientGotoAbort(error: unknown): boolean`
- **shouldNavigatePlannerPage** `function` L653 — `export function shouldNavigatePlannerPage(currentUrl: string, conversationId: string): boolean`
- **ChatGPTTemporaryLimitError** `class` L661 — `export class ChatGPTTemporaryLimitError extends Error`

#### `src/adapters/chatgpt/project-discovery.ts`
_Source module for project-discovery.ts._

- **CdpListTarget** `interface` L8 — `export interface CdpListTarget`
- **ChatGptProjectDiscovery** `interface` L14 — `export interface ChatGptProjectDiscovery`
- **ChatGptProjectDiscoveryError** `class` L22 — `export class ChatGptProjectDiscoveryError extends Error`
- **normalizeChatGptProject** `function` L42 — `export function normalizeChatGptProject(input: string):`
- **listCdpTargets** `function` L92 — `export async function listCdpTargets( cdpUrl: string, fetchImpl: typeof fetch = fetch ): Promise<CdpListTarget[]>`
- **groupChatGptProjects** `function` L120 — `export function groupChatGptProjects(targets: CdpListTarget[]): ChatGptProjectDiscovery[]`
- **discoverChatGptProjects** `function` L169 — `export async function discoverChatGptProjects( cdpUrl: string, fetchImpl: typeof fetch = fetch ): Promise<ChatGptProjectDiscovery[]>`

#### `src/adapters/chatgpt/service-warning.ts`
_Source module for service-warning.ts._

- **hasVisibleServiceWarning** `function` L9 — `export async function hasVisibleServiceWarning(page: Page, pattern: RegExp): Promise<boolean>`

### relay

#### `src/relay/chatgpt-gate.ts`
_Source module for chatgpt-gate.ts._

- **DEFAULT_CHATGPT_MIN_SUBMIT_INTERVAL_MS** `const` L6 — `export const DEFAULT_CHATGPT_MIN_SUBMIT_INTERVAL_MS = 30_000`
- **DEFAULT_CHATGPT_BACKOFF_INITIAL_MS** `const` L7 — `export const DEFAULT_CHATGPT_BACKOFF_INITIAL_MS = 30_000`
- **DEFAULT_CHATGPT_BACKOFF_MAX_MS** `const` L8 — `export const DEFAULT_CHATGPT_BACKOFF_MAX_MS = 5 * 60_000`
- **DEFAULT_CHATGPT_BACKOFF_BASE** `const` L9 — `export const DEFAULT_CHATGPT_BACKOFF_BASE = 2`
- **ChatGptSubmissionGateOptions** `interface` L11 — `export interface ChatGptSubmissionGateOptions`
- **ChatGptSubmissionDecision** `interface` L21 — `export interface ChatGptSubmissionDecision`
- **ChatGptSubmissionOutcome** `interface` L30 — `export interface ChatGptSubmissionOutcome`
- **ChatGptSubmissionGate** `class` L54 — `export class ChatGptSubmissionGate`
- **defaultIsRateLimited** `function` L164 — `export function defaultIsRateLimited(error: unknown): boolean`
- **delay** `function` L173 — `export function delay(ms: number, sleep: (m: number) => Promise<void>): Promise<void>`
- **interruptible** `function` L177 — `export async function interruptible(task: Promise<void>, signal?: AbortSignal): Promise<void>`

#### `src/relay/index.ts`
_Relay core exports (identity, verification, ledger)._

- ***** `re-export` L9 (from `./chatgpt-gate.js`) — `export * from "./chatgpt-gate.js"`
- **RelayAdapters** `interface` L30 — `export interface RelayAdapters`
- **MAX_RELAY_ATTEMPTS** `const` L42 — `export const MAX_RELAY_ATTEMPTS = 20`
- **RelayOutcome** `type` L44 — `export type RelayOutcome = | "DELIVERED" | "SKIPPED_DUPLICATE" | "AMBIGUOUS" | "FAILED" | "NOOP" | "NOT_READY" | "HELD" | "RATE_LIMITED"`
- **RelayResult** `interface` L54 — `export interface RelayResult`
- **RelayPersistence** `interface` L69 — `export interface RelayPersistence`
- **RelayOptions** `interface` L73 — `export interface RelayOptions`
- **relayWorkerToPlanner** `function` L334 — `export async function relayWorkerToPlanner( pair: SessionPair, adapters: RelayAdapters, options: RelayOptions = {} ): Promise<RelayResult>`
- **relayPlannerToWorker** `function` L354 — `export async function relayPlannerToWorker( pair: SessionPair, adapters: RelayAdapters, options: RelayOptions = {} ): Promise<RelayResult>`
- **extractModelInstruction** `function` L520 — `export function extractModelInstruction(text: string):`
- **formatRelayResult** `function` L530 — `export function formatRelayResult(result: RelayResult): string`

#### `src/relay/message-classifier.ts`
_Source module for message-classifier.ts._

- **classifyWorkerMessage** `function` L25 — `export function classifyWorkerMessage(text: string): WorkerMessageClassification`
- **questionNature** `function` L50 — `export function questionNature(text: string): WorkerQuestionNature | undefined`

#### `src/relay/planner-prompt.ts`
_Deterministic selection of the worker prompt from a planner (ChatGPT) assistant message's structured writing_blocks. Consolidated from TerminalBot/RelayLoop._

- **PlannerPromptSelectionStatus** `type` L7 — `export type PlannerPromptSelectionStatus = "ready" | "missing" | "ambiguous"`
- **PlannerPromptSelection** `interface` L9 — `export interface PlannerPromptSelection`
- **selectPlannerPromptFromWritingBlocks** `function` L26 — `export function selectPlannerPromptFromWritingBlocks(blocks: readonly string[] | undefined | null): PlannerPromptSelection`
- **shouldPauseForMissingPrompt** `function` L60 — `export function shouldPauseForMissingPrompt( previousStatus: PlannerPromptSelectionStatus | undefined, currentStatus: PlannerPromptSelectio…`
- **WORKER_PROMPT_NOT_AVAILABLE** `const` L70 — `export const WORKER_PROMPT_NOT_AVAILABLE = "Worker prompt not available"`

#### `src/relay/receipt-verification.ts`
_Deterministic receipt verification helpers (exact normalized + layout-insensitive fallback, baseline exclusion). Consolidated from TerminalBot/RelayLoop._

- **RELAY_VERIFY_RETRY_MS** `re-export` L8 (from `./verifier.js`) — `export { RELAY_VERIFY_RETRY_MS } from "./verifier.js"`
- **normalizeReceiptText** `function` L10 — `export function normalizeReceiptText(text: string): string`
- **collapseWhitespace** `function` L14 — `export function collapseWhitespace(text: string): string`
- **ReceiptMatchResult** `interface` L18 — `export interface ReceiptMatchResult`
- **matchPlannerReceipt** `function` L31 — `export function matchPlannerReceipt( candidates: Array<{ id: string; text: string }>, expected: string, baselineIds: ReadonlySet<string> = …`
- **countFreshMatches** `function` L57 — `export function countFreshMatches( candidates: Array<{ id: string; text: string }>, expected: string, baselineIds: ReadonlySet<string> = ne…`

#### `src/relay/verifier.ts`
_Deterministic delivery verification (Rule 12)._

- **VerifierAdapters** `interface` L21 — `export interface VerifierAdapters`
- **VerificationResult** `interface` L26 — `export interface VerificationResult`
- **RELAY_VERIFY_RETRY_MS** `const` L33 — `export const RELAY_VERIFY_RETRY_MS = 2 * 60 * 1000`
- **RELAY_VERIFY_MAX_ATTEMPTS** `const` L36 — `export const RELAY_VERIFY_MAX_ATTEMPTS = 3`
- **sourceHashOfObserved** `re-export` L43 — `export { sourceHashOfObserved }`
- **RelayVerifier** `class` L49 — `export class RelayVerifier`

### persistence

#### `src/persistence/archive.ts`
_Source module for archive.ts._

- **ArchivedConfigSnapshot** `interface` L16 — `export interface ArchivedConfigSnapshot`
- **ArchivedPairPayload** `interface` L34 — `export interface ArchivedPairPayload`
- **ArchivedPairSummary** `interface` L47 — `export interface ArchivedPairSummary`
- **ArchiveStore** `interface` L56 — `export interface ArchiveStore`
- **ArchiveError** `class` L64 — `export class ArchiveError extends Error`
- **PairArchive** `class` L79 — `export class PairArchive implements ArchiveStore`

#### `src/persistence/canonical.ts`
_Canonicalization helpers (URL, identity, hash)._

- **canonicalizeText** `re-export` L11 (from `../util/canonical.js`) — `export { canonicalizeText, hashText } from "../util/canonical.js"`
- **hashText** `re-export` L11 (from `../util/canonical.js`) — `export { canonicalizeText, hashText } from "../util/canonical.js"`
- **canonicalRelayIdentity** `function` L13 — `export function canonicalRelayIdentity( pairId: string, direction: RelayDirection, message: Pick<RelayableMessage, "id" | "text"> ): Canoni…`

#### `src/persistence/index.ts`
_Persistence / SQLite store exports._

- **EXPECTED_SCHEMA_VERSION** `re-export` L6 (from `./store.js`) — `export {`
- **RelayStoreError** `re-export` L6 (from `./store.js`) — `export {`
- **SqliteRelayStore** `re-export` L6 (from `./store.js`) — `export {`
- **ensureDbParent** `re-export` L6 (from `./store.js`) — `export {`
- **resolveDbPath** `re-export` L6 (from `./store.js`) — `export {`
- **RelayStore** `re-export` L6 (from `./store.js`) — `export {`
- **PermissionGrantRow** `re-export` L6 (from `./store.js`) — `export {`
- **canonicalRelayIdentity** `re-export` L15 (from `./canonical.js`) — `export { canonicalRelayIdentity, canonicalizeText, hashText } from "./canonical.js"`
- **canonicalizeText** `re-export` L15 (from `./canonical.js`) — `export { canonicalRelayIdentity, canonicalizeText, hashText } from "./canonical.js"`
- **hashText** `re-export` L15 (from `./canonical.js`) — `export { canonicalRelayIdentity, canonicalizeText, hashText } from "./canonical.js"`
- **ArchiveError** `re-export` L16 (from `./archive.js`) — `export {`
- **PairArchive** `re-export` L16 (from `./archive.js`) — `export {`
- **ArchiveStore** `re-export` L16 (from `./archive.js`) — `export {`
- **ArchivedConfigSnapshot** `re-export` L16 (from `./archive.js`) — `export {`
- **ArchivedPairPayload** `re-export` L16 (from `./archive.js`) — `export {`
- **ArchivedPairSummary** `re-export` L16 (from `./archive.js`) — `export {`

#### `src/persistence/store.ts`
_Source module for store.ts._

- **StoreDiagnosticsSnapshot** `interface` L29 — `export interface StoreDiagnosticsSnapshot`
- **PermissionGrantAction** `type` L40 — `export type PermissionGrantAction = "model-switch-outside-approved" | "shared-service-restart"`
- **PermissionGrantRow** `interface` L42 — `export interface PermissionGrantRow`
- **RelayStore** `interface` L78 — `export interface RelayStore`
- **RelayStoreError** `class` L261 — `export class RelayStoreError extends Error`
- **EXPECTED_SCHEMA_VERSION** `const` L330 — `export const EXPECTED_SCHEMA_VERSION = 19`
- **SqliteRelayStore** `class` L499 — `export class SqliteRelayStore implements RelayStore`
- **resolveDbPath** `function` L1911 — `export function resolveDbPath(configuredPath?: string): string`
- **ensureDbParent** `function` L1918 — `export async function ensureDbParent(dbPath: string): Promise<void>`

### validator

#### `src/validator/readiness.ts`
_Readiness checks for worker/planner pairs._

- **ValidatorAdapters** `interface` L16 — `export interface ValidatorAdapters`
- **validatePair** `function` L21 — `export async function validatePair( pair: SessionPair, adapters: ValidatorAdapters, now: Date = new Date() ): Promise<PairReadinessReport>`
- **fail** `re-export` L77 (from `../util/readiness.js`) — `export { fail, pass } from "../util/readiness.js"`
- **pass** `re-export` L77 (from `../util/readiness.js`) — `export { fail, pass } from "../util/readiness.js"`

#### `src/validator/report.ts`
_Source module for report.ts._

- **formatReadinessReport** `function` L8 — `export function formatReadinessReport(results: PairReadinessReport[]): string`
- **formatPairReadinessReport** `function` L12 — `export function formatPairReadinessReport(result: PairReadinessReport): string`

### supervisor

#### `src/supervisor/classifier.ts`
_Source module for classifier.ts._

- **DEFAULT_STUCK_AFTER_MS** `const` L13 — `export const DEFAULT_STUCK_AFTER_MS = 60 * 60_000`
- **CycleContext** `interface` L15 — `export interface CycleContext`
- **ClassifyOptions** `interface` L32 — `export interface ClassifyOptions`
- **ClassifyInput** `interface` L36 — `export interface ClassifyInput`
- **Classification** `interface` L43 — `export interface Classification`
- **emptyCycleContext** `function` L48 — `export function emptyCycleContext(): CycleContext`
- **classify** `function` L55 — `export function classify(input: ClassifyInput): Classification`

#### `src/supervisor/events.ts`
_Supervisor-side event logger implementations. The event type definitions_

- **MemorySupervisorLogger** `class` L12 — `export class MemorySupervisorLogger implements SupervisorLogger`
- **defaultSupervisorLogPath** `const` L24 — `export const defaultSupervisorLogPath = () => resolve("logs", "supervisor.ndjson")`
- **JsonLineSupervisorLogger** `class` L26 — `export class JsonLineSupervisorLogger implements SupervisorLogger`

#### `src/supervisor/index.ts`
_Supervisor / observation loop exports._

- **classify** `re-export` L6 (from `./classifier.js`) — `export {`
- **emptyCycleContext** `re-export` L6 (from `./classifier.js`) — `export {`
- **DEFAULT_STUCK_AFTER_MS** `re-export` L6 (from `./classifier.js`) — `export {`
- **ClassifyInput** `re-export` L6 (from `./classifier.js`) — `export {`
- **ClassifyOptions** `re-export` L6 (from `./classifier.js`) — `export {`
- **Classification** `re-export` L6 (from `./classifier.js`) — `export {`
- **CycleContext** `re-export` L6 (from `./classifier.js`) — `export {`
- **JsonLineSupervisorLogger** `re-export` L15 (from `./events.js`) — `export {`
- **MemorySupervisorLogger** `re-export` L15 (from `./events.js`) — `export {`
- **defaultSupervisorLogPath** `re-export` L15 (from `./events.js`) — `export {`
- **(anonymous)** `type` L20 — `export type`
- **collectObservation** `re-export` L21 (from `./observation.js`) — `export { collectObservation, makeObservationClock } from "./observation.js"`
- **makeObservationClock** `re-export` L21 (from `./observation.js`) — `export { collectObservation, makeObservationClock } from "./observation.js"`
- **decideRelays** `re-export` L22 (from `./policy.js`) — `export { decideRelays, type PolicyInput, type RelayDecisions, type SuperviseMode } from "./policy.js"`
- **PolicyInput** `re-export` L22 (from `./policy.js`) — `export { decideRelays, type PolicyInput, type RelayDecisions, type SuperviseMode } from "./policy.js"`
- **RelayDecisions** `re-export` L22 (from `./policy.js`) — `export { decideRelays, type PolicyInput, type RelayDecisions, type SuperviseMode } from "./policy.js"`
- **SuperviseMode** `re-export` L22 (from `./policy.js`) — `export { decideRelays, type PolicyInput, type RelayDecisions, type SuperviseMode } from "./policy.js"`
- **isBusyState** `re-export` L23 (from `./state.js`) — `export { isBusyState, isSupervisorState, isTerminalFailure, SUPERVISOR_STATES } from "./state.js"`
- **isSupervisorState** `re-export` L23 (from `./state.js`) — `export { isBusyState, isSupervisorState, isTerminalFailure, SUPERVISOR_STATES } from "./state.js"`
- **isTerminalFailure** `re-export` L23 (from `./state.js`) — `export { isBusyState, isSupervisorState, isTerminalFailure, SUPERVISOR_STATES } from "./state.js"`
- **SUPERVISOR_STATES** `re-export` L23 (from `./state.js`) — `export { isBusyState, isSupervisorState, isTerminalFailure, SUPERVISOR_STATES } from "./state.js"`
- **Supervisor** `re-export` L24 (from `./supervisor.js`) — `export {`
- **DEFAULT_POLL_INTERVAL_MS** `re-export` L24 (from `./supervisor.js`) — `export {`
- **buildCycle** `re-export` L24 (from `./supervisor.js`) — `export {`
- **SupervisorDeps** `re-export` L24 (from `./supervisor.js`) — `export {`
- **SupervisorReport** `re-export` L24 (from `./supervisor.js`) — `export {`

#### `src/supervisor/observation.ts`
_Observation / event correlation utilities._

- **makeObservationClock** `function` L15 — `export function makeObservationClock(): () => Date`
- **collectObservation** `function` L19 — `export async function collectObservation( pair: SessionPair, worker: OpenCodeSessionManager, planner: ChatGPTBrowserAdapter, clock: () => D…`
- **observeWorkerSession** `function` L38 — `export async function observeWorkerSession(pair: SessionPair, worker: OpenCodeSessionManager): Promise<WorkerObservation>`
- **observePlannerConversation** `function` L42 — `export async function observePlannerConversation(pair: SessionPair, planner: ChatGPTBrowserAdapter): Promise<PlannerObservation>`

#### `src/supervisor/policy.ts`
_Source module for policy.ts._

- **SuperviseMode** `type` L9 — `export type SuperviseMode = "observe" | "relay"`
- **RelayDecisions** `interface` L11 — `export interface RelayDecisions`
- **PolicyInput** `interface` L16 — `export interface PolicyInput`
- **decideRelays** `function` L25 — `export function decideRelays(input: PolicyInput): RelayDecisions`

#### `src/supervisor/state.ts`
_Source module for state.ts._

- **SUPERVISOR_STATES** `const` L8 — `export const SUPERVISOR_STATES: readonly SupervisorState[] = [ "READY", "WORKING", "WAITING_PLANNER", "WAITING_WORKER", "IDLE", "COMPLETED"…`
- **isBusyState** `function` L22 — `export function isBusyState(state: SupervisorState | undefined): boolean`
- **isTerminalFailure** `function` L26 — `export function isTerminalFailure(state: SupervisorState): boolean`
- **isSupervisorState** `function` L30 — `export function isSupervisorState(value: string): value is SupervisorState`

#### `src/supervisor/supervisor.ts`
_Source module for supervisor.ts._

- **DEFAULT_POLL_INTERVAL_MS** `const` L45 — `export const DEFAULT_POLL_INTERVAL_MS = 5_000`
- **SupervisorRecoveryOptions** `interface` L47 — `export interface SupervisorRecoveryOptions`
- **SupervisorDeps** `interface` L68 — `export interface SupervisorDeps`
- **SupervisorReport** `interface` L86 — `export interface SupervisorReport`
- **Supervisor** `class` L111 — `export class Supervisor`
- **buildCycle** `function` L849 — `export function buildCycle( store: RelayStore, pairId: string, snapshot: ObservationSnapshot, continuity: SupervisorContinuity ): CycleCont…`
- **WorkerRelayStability** `interface` L896 — `export interface WorkerRelayStability`
- **computeWorkerRelayStability** `function` L903 — `export function computeWorkerRelayStability(input: { continuity: SupervisorContinuity; snapshot: ObservationSnapshot; nowIso: string; stabi…`

### recovery

#### `src/recovery/browser.ts`
_Source module for browser.ts._

- **BrowserStatus** `interface` L8 — `export interface BrowserStatus`
- **BrowserManager** `interface` L14 — `export interface BrowserManager`
- **ExternalBrowserManager** `class` L24 — `export class ExternalBrowserManager implements BrowserManager`
- **ManagedBrowserHandle** `interface` L49 — `export interface ManagedBrowserHandle`
- **ManagedBrowserLens** `interface` L53 — `export interface ManagedBrowserLens`
- **ManagedBrowserManager** `class` L57 — `export class ManagedBrowserManager implements BrowserManager`
- **browserManagerFor** `function` L105 — `export function browserManagerFor( config: { cdpUrl?: string; executablePath?: string } | undefined, lens?: ManagedBrowserLens ): BrowserMa…`

#### `src/recovery/chatgpt.ts`
_Source module for chatgpt.ts._

- **ChatGPTRecoveryOutcome** `type` L13 — `export type ChatGPTRecoveryOutcome = |`
- **ChatGPTRecoveryInput** `interface` L17 — `export interface ChatGPTRecoveryInput`
- **recoverChatGPT** `function` L26 — `export async function recoverChatGPT(input: ChatGPTRecoveryInput): Promise<ChatGPTRecoveryOutcome>`

#### `src/recovery/engine.ts`
_Source module for engine.ts._

- **RecoveryEngineDeps** `interface` L24 — `export interface RecoveryEngineDeps`
- **RecoveryRunResult** `interface` L55 — `export interface RecoveryRunResult`
- **RECOVERY_CORRECTIVE_BUDGET** `const` L74 — `export const RECOVERY_CORRECTIVE_BUDGET = 3`
- **RECOVERY_DURATION_LIMIT_MS** `const` L76 — `export const RECOVERY_DURATION_LIMIT_MS = 10 * 60_000`
- **RECOVERY_SIGNATURE_WINDOW_MS** `const` L78 — `export const RECOVERY_SIGNATURE_WINDOW_MS = RECOVERY_DURATION_LIMIT_MS`
- **RecoveryEngine** `class` L80 — `export class RecoveryEngine`

#### `src/recovery/index.ts`
_Recovery engine exports._

- **browserManagerFor** `re-export` L6 (from `./browser.js`) — `export {`
- **ExternalBrowserManager** `re-export` L6 (from `./browser.js`) — `export {`
- **ManagedBrowserManager** `re-export` L6 (from `./browser.js`) — `export {`
- **BrowserManager** `re-export` L6 (from `./browser.js`) — `export {`
- **BrowserStatus** `re-export` L6 (from `./browser.js`) — `export {`
- **ManagedBrowserHandle** `re-export` L6 (from `./browser.js`) — `export {`
- **ManagedBrowserLens** `re-export` L6 (from `./browser.js`) — `export {`
- **recoverChatGPT** `re-export` L15 (from `./chatgpt.js`) — `export { recoverChatGPT, type ChatGPTRecoveryOutcome } from "./chatgpt.js"`
- **ChatGPTRecoveryOutcome** `re-export` L15 (from `./chatgpt.js`) — `export { recoverChatGPT, type ChatGPTRecoveryOutcome } from "./chatgpt.js"`
- **RecoveryEngine** `re-export` L16 (from `./engine.js`) — `export { RecoveryEngine, type RecoveryRunResult, type RecoveryEngineDeps } from "./engine.js"`
- **RecoveryRunResult** `re-export` L16 (from `./engine.js`) — `export { RecoveryEngine, type RecoveryRunResult, type RecoveryEngineDeps } from "./engine.js"`
- **RecoveryEngineDeps** `re-export` L16 (from `./engine.js`) — `export { RecoveryEngine, type RecoveryRunResult, type RecoveryEngineDeps } from "./engine.js"`
- **recoverOpenCode** `re-export` L17 (from `./opencode.js`) — `export { recoverOpenCode, type OpenCodeRecoveryOutcome } from "./opencode.js"`
- **OpenCodeRecoveryOutcome** `re-export` L17 (from `./opencode.js`) — `export { recoverOpenCode, type OpenCodeRecoveryOutcome } from "./opencode.js"`
- **DEFAULT_RECOVERY_POLICY** `re-export` L18 (from `./policy.js`) — `export { DEFAULT_RECOVERY_POLICY, recoveryActionForState, isRecoveryPolicy, type RecoveryAction } from "./policy.js"`
- **recoveryActionForState** `re-export` L18 (from `./policy.js`) — `export { DEFAULT_RECOVERY_POLICY, recoveryActionForState, isRecoveryPolicy, type RecoveryAction } from "./policy.js"`
- **isRecoveryPolicy** `re-export` L18 (from `./policy.js`) — `export { DEFAULT_RECOVERY_POLICY, recoveryActionForState, isRecoveryPolicy, type RecoveryAction } from "./policy.js"`
- **RecoveryAction** `re-export` L18 (from `./policy.js`) — `export { DEFAULT_RECOVERY_POLICY, recoveryActionForState, isRecoveryPolicy, type RecoveryAction } from "./policy.js"`
- **abortError** `re-export` L19 (from `./schedule.js`) — `export { abortError, DEFAULT_BACKOFF_POLICY, delayForAttempt, interruptibleSleep, type BackoffPolicy } from "./schedule.js"`
- **DEFAULT_BACKOFF_POLICY** `re-export` L19 (from `./schedule.js`) — `export { abortError, DEFAULT_BACKOFF_POLICY, delayForAttempt, interruptibleSleep, type BackoffPolicy } from "./schedule.js"`
- **delayForAttempt** `re-export` L19 (from `./schedule.js`) — `export { abortError, DEFAULT_BACKOFF_POLICY, delayForAttempt, interruptibleSleep, type BackoffPolicy } from "./schedule.js"`
- **interruptibleSleep** `re-export` L19 (from `./schedule.js`) — `export { abortError, DEFAULT_BACKOFF_POLICY, delayForAttempt, interruptibleSleep, type BackoffPolicy } from "./schedule.js"`
- **BackoffPolicy** `re-export` L19 (from `./schedule.js`) — `export { abortError, DEFAULT_BACKOFF_POLICY, delayForAttempt, interruptibleSleep, type BackoffPolicy } from "./schedule.js"`
- **humanReason** `re-export` L20 (from `./reasons.js`) — `export { humanReason } from "./reasons.js"`

#### `src/recovery/opencode.ts`
_Source module for opencode.ts._

- **OpenCodeServerLauncher** `type` L11 — `export type OpenCodeServerLauncher = (repoPath: string, baseUrl: string) => Promise<`
- **OpenCodeRecoveryInput** `interface` L13 — `export interface OpenCodeRecoveryInput`
- **OpenCodeStartOutcome** `interface` L55 — `export interface OpenCodeStartOutcome`
- **OpenCodeRecoveryOutcome** `type` L61 — `export type OpenCodeRecoveryOutcome = |`
- **recoverOpenCode** `function` L65 — `export async function recoverOpenCode( input: OpenCodeRecoveryInput ): Promise<OpenCodeRecoveryOutcome>`

#### `src/recovery/policy.ts`
_Source module for policy.ts._

- **DEFAULT_RECOVERY_POLICY** `const` L8 — `export const DEFAULT_RECOVERY_POLICY: RecoveryPolicy = "safe"`
- **RecoveryAction** `type` L10 — `export type RecoveryAction = | "none" | "reconnect-transport" | "relaunch-browser" | "reopen-conversation" | "reobserve-session" | "verify-…`
- **isRecoveryPolicy** `function` L19 — `export function isRecoveryPolicy(value: unknown): value is RecoveryPolicy`
- **recoveryActionForState** `function` L23 — `export function recoveryActionForState(state: SupervisorState | undefined): RecoveryAction`

#### `src/recovery/reasons.ts`
_Source module for reasons.ts._

- **humanReason** `function` L8 — `export function humanReason(code: RecoveryErrorCode): string`

#### `src/recovery/schedule.ts`
_Source module for schedule.ts._

- **BackoffPolicy** `interface` L6 — `export interface BackoffPolicy`
- **DEFAULT_BACKOFF_POLICY** `const` L11 — `export const DEFAULT_BACKOFF_POLICY: BackoffPolicy =`
- **delayForAttempt** `function` L15 — `export function delayForAttempt(attempt: number, policy: BackoffPolicy = DEFAULT_BACKOFF_POLICY): number`
- **abortError** `function` L22 — `export function abortError(): Error`
- **interruptibleSleep** `function` L26 — `export function interruptibleSleep(milliseconds: number, signal?: AbortSignal): Promise<void>`

### runtime

#### `src/runtime/adapters.ts`
_Adapter registry / factory._

- **RuntimeAdapterOptions** `interface` L19 — `export interface RuntimeAdapterOptions`
- **PairAdapters** `interface` L27 — `export interface PairAdapters`
- **createPairAdapters** `function` L33 — `export function createPairAdapters(pair: SessionPair, options: RuntimeAdapterOptions = {}): PairAdapters`
- **browserLockKey** `function` L55 — `export function browserLockKey(pair: SessionPair): string`

#### `src/runtime/index.ts`
_Pair runtime orchestration exports._

- **RuntimeError** `re-export` L6 (from `./orchestrator.js`) — `export {`
- **RuntimeOrchestrator** `re-export` L6 (from `./orchestrator.js`) — `export {`
- **isHealthyRuntime** `re-export` L6 (from `./orchestrator.js`) — `export {`
- **isFailedRuntime** `re-export` L6 (from `./orchestrator.js`) — `export {`
- **RuntimeOrchestratorOptions** `re-export` L6 (from `./orchestrator.js`) — `export {`
- **RuntimeStatusSummary** `re-export` L6 (from `./orchestrator.js`) — `export {`
- **PairRuntime** `re-export` L14 (from `./pair-runtime.js`) — `export { PairRuntime, type PairRuntimeOptions, type PairRuntimeStatusSet } from "./pair-runtime.js"`
- **PairRuntimeOptions** `re-export` L14 (from `./pair-runtime.js`) — `export { PairRuntime, type PairRuntimeOptions, type PairRuntimeStatusSet } from "./pair-runtime.js"`
- **PairRuntimeStatusSet** `re-export` L14 (from `./pair-runtime.js`) — `export { PairRuntime, type PairRuntimeOptions, type PairRuntimeStatusSet } from "./pair-runtime.js"`
- **PairRegistry** `re-export` L15 (from `./registry.js`) — `export { PairRegistry, RegistryError, validateUnique } from "./registry.js"`
- **RegistryError** `re-export` L15 (from `./registry.js`) — `export { PairRegistry, RegistryError, validateUnique } from "./registry.js"`
- **validateUnique** `re-export` L15 (from `./registry.js`) — `export { PairRegistry, RegistryError, validateUnique } from "./registry.js"`
- **FifoMutex** `re-export` L16 (from `./scheduler.js`) — `export { FifoMutex, LockRegistry, interruptibleSleep, type SleepFn } from "./scheduler.js"`
- **LockRegistry** `re-export` L16 (from `./scheduler.js`) — `export { FifoMutex, LockRegistry, interruptibleSleep, type SleepFn } from "./scheduler.js"`
- **interruptibleSleep** `re-export` L16 (from `./scheduler.js`) — `export { FifoMutex, LockRegistry, interruptibleSleep, type SleepFn } from "./scheduler.js"`
- **SleepFn** `re-export` L16 (from `./scheduler.js`) — `export { FifoMutex, LockRegistry, interruptibleSleep, type SleepFn } from "./scheduler.js"`
- **MultiSinkSupervisorLogger** `re-export` L17 (from `./logging.js`) — `export { MultiSinkSupervisorLogger, defaultPerPairLogRoot } from "./logging.js"`
- **defaultPerPairLogRoot** `re-export` L17 (from `./logging.js`) — `export { MultiSinkSupervisorLogger, defaultPerPairLogRoot } from "./logging.js"`
- **WakeBus** `re-export` L18 (from `./wake-bus.js`) — `export { WakeBus, type WakeSignal, type WakeSubscriber } from "./wake-bus.js"`
- **WakeSignal** `re-export` L18 (from `./wake-bus.js`) — `export { WakeBus, type WakeSignal, type WakeSubscriber } from "./wake-bus.js"`
- **WakeSubscriber** `re-export` L18 (from `./wake-bus.js`) — `export { WakeBus, type WakeSignal, type WakeSubscriber } from "./wake-bus.js"`
- **createPairAdapters** `re-export` L19 (from `./adapters.js`) — `export { createPairAdapters, browserLockKey, type PairAdapters, type RuntimeAdapterOptions } from "./adapters.js"`
- **browserLockKey** `re-export` L19 (from `./adapters.js`) — `export { createPairAdapters, browserLockKey, type PairAdapters, type RuntimeAdapterOptions } from "./adapters.js"`
- **PairAdapters** `re-export` L19 (from `./adapters.js`) — `export { createPairAdapters, browserLockKey, type PairAdapters, type RuntimeAdapterOptions } from "./adapters.js"`
- **RuntimeAdapterOptions** `re-export` L19 (from `./adapters.js`) — `export { createPairAdapters, browserLockKey, type PairAdapters, type RuntimeAdapterOptions } from "./adapters.js"`
- **(anonymous)** `type` L20 — `export type`

#### `src/runtime/logging.ts`
_Source module for logging.ts._

- **defaultPerPairLogRoot** `const` L10 — `export const defaultPerPairLogRoot = () => resolve("logs", "pairs")`
- **MultiSinkSupervisorLogger** `class` L12 — `export class MultiSinkSupervisorLogger implements SupervisorLogger`

#### `src/runtime/orchestrator.ts`
_Source module for orchestrator.ts._

- **RuntimeError** `class` L18 — `export class RuntimeError extends Error`
- **RuntimeOrchestratorOptions** `interface` L25 — `export interface RuntimeOrchestratorOptions`
- **RuntimeStatusSummary** `interface` L43 — `export interface RuntimeStatusSummary`
- **OrchestratorEvent** `type` L52 — `export type OrchestratorEvent = RuntimeEvent | SupervisorEvent`
- **RuntimeOrchestrator** `class` L54 — `export class RuntimeOrchestrator`
- **isHealthyRuntime** `function` L337 — `export function isHealthyRuntime(status: RuntimePairStatus): boolean`
- **isFailedRuntime** `function` L348 — `export function isFailedRuntime(status: RuntimePairStatus): boolean`

#### `src/runtime/pair-runtime.ts`
_Per-pair concurrent runtime supervisor._

- **PairRuntimeOptions** `interface` L29 — `export interface PairRuntimeOptions`
- **PairRuntimeStatusSet** `interface` L51 — `export interface PairRuntimeStatusSet`
- **PairRuntime** `class` L60 — `export class PairRuntime`

#### `src/runtime/registry.ts`
_Source module for registry.ts._

- **RegistryError** `class` L8 — `export class RegistryError extends Error`
- **PairRegistry** `class` L18 — `export class PairRegistry`
- **validateUnique** `function` L61 — `export function validateUnique( pairId: string, sessionId: string, conversationId: string, existing: ReadonlyMap<string, SessionPair> ): vo…`

#### `src/runtime/scheduler.ts`
_Source module for scheduler.ts._

- **FifoMutex** `re-export` L13 (from `../util/async.js`) — `export { FifoMutex, LockRegistry, interruptibleSleep, type SleepFn } from "../util/async.js"`
- **LockRegistry** `re-export` L13 (from `../util/async.js`) — `export { FifoMutex, LockRegistry, interruptibleSleep, type SleepFn } from "../util/async.js"`
- **interruptibleSleep** `re-export` L13 (from `../util/async.js`) — `export { FifoMutex, LockRegistry, interruptibleSleep, type SleepFn } from "../util/async.js"`
- **SleepFn** `re-export` L13 (from `../util/async.js`) — `export { FifoMutex, LockRegistry, interruptibleSleep, type SleepFn } from "../util/async.js"`

#### `src/runtime/wake-bus.ts`
_Source module for wake-bus.ts._

- **WakeSignal** `interface` L6 — `export interface WakeSignal`
- **WakeSubscriber** `type` L15 — `export type WakeSubscriber = (signal: WakeSignal) => void`
- **WakeBus** `class` L17 — `export class WakeBus`

### application

#### `src/application/approved-models.ts`
_Restrict worker model switching to the operator-approved allow list in_

- **ApprovedModelEntry** `interface` L11 — `export interface ApprovedModelEntry`
- **loadApprovedModels** `function` L18 — `export function loadApprovedModels(): ApprovedModelEntry[]`
- **isModelApproved** `function` L29 — `export function isModelApproved(providerId: string, modelId: string): boolean`

#### `src/application/attention-service.ts`
_Source module for attention-service.ts._

- **AttentionServiceOptions** `interface` L11 — `export interface AttentionServiceOptions`
- **AttentionService** `class` L46 — `export class AttentionService`

#### `src/application/config-file-store.ts`
_Shared machinery for the pair-config and project-pair-config file repositories._

- **isNodeError** `function` L12 — `export function isNodeError(error: unknown): error is NodeJS.ErrnoException`
- **messageOf** `function` L16 — `export function messageOf(error: unknown): string`
- **MutationQueue** `class` L24 — `export class MutationQueue`
- **atomicWriteJson** `function` L41 — `export async function atomicWriteJson(configPath: string, value: unknown, tempPrefix: string): Promise<void>`

#### `src/application/continuation-briefing.ts`
_v1.1 §7.5 — decide whether a Resume may use direct continuation_

- **ResumeEvidence** `interface` L15 — `export interface ResumeEvidence`
- **ResumeConsistency** `type` L34 — `export type ResumeConsistency = "proven" | "unproven"`
- **ResumeDecision** `interface` L36 — `export interface ResumeDecision`
- **RESUME_DIRECT_VERSION** `const` L47 — `export const RESUME_DIRECT_VERSION = "resume-direct-1"`
- **RESUME_BRIEFING_VERSION** `const` L48 — `export const RESUME_BRIEFING_VERSION = "resume-briefing-1"`
- **collectResumeEvidence** `function` L50 — `export function collectResumeEvidence(store: RelayStore, pairId: string): ResumeEvidence`
- **classifyResumeConsistency** `function` L87 — `export function classifyResumeConsistency(evidence: ResumeEvidence):`
- **buildResumeDecision** `function` L132 — `export function buildResumeDecision(evidence: ResumeEvidence): ResumeDecision`

#### `src/application/control-plane-adapter.ts`
_Control-plane adapter for worker/planner pairs._

- **ControlPlaneAdapter** `class` L28 — `export class ControlPlaneAdapter`
- **SafeRemoteEvent** `interface` L376 — `export interface SafeRemoteEvent`
- **ControlPlaneOperationError** `class` L385 — `export class ControlPlaneOperationError extends Error`

#### `src/application/desktop-lifecycle.ts`
_Source module for desktop-lifecycle.ts._

- **DesktopLifecycleState** `type` L50 — `export type DesktopLifecycleState = "initializing" | "ready" | "failed" | "shutting-down" | "stopped"`
- **DesktopBootResult** `type` L52 — `export type DesktopBootResult = |`
- **DesktopLifecycleService** `interface` L57 — `export interface DesktopLifecycleService`
- **DisposableWorkerProgress** `interface` L63 — `export interface DisposableWorkerProgress`
- **DesktopLifecycleHooks** `interface` L67 — `export interface DesktopLifecycleHooks`
- **DesktopLifecycle** `class` L90 — `export class DesktopLifecycle`

#### `src/application/desktop-service.ts`
_Electron desktop service integration._

- **DesktopServiceOptions** `interface` L44 — `export interface DesktopServiceOptions`
- **DesktopEventRecord** `type` L82 — `export type DesktopEventRecord = EventRecord`
- **ProjectLifecycleSummary** `interface` L84 — `export interface ProjectLifecycleSummary extends RuntimeStatusSummary`
- **(anonymous)** `type` L112 — `export type`
- **DesktopApplicationError** `class` L136 — `export class DesktopApplicationError extends Error`
- **toDesktopApplicationError** `function` L148 — `export function toDesktopApplicationError(error: unknown): DesktopApplicationError`
- **RecentEventsFilter** `interface` L173 — `export interface RecentEventsFilter`
- **DesktopApplicationService** `class` L180 — `export class DesktopApplicationService`
- **fingerprintPairs** `function` L2046 — `export function fingerprintPairs(pairs: SessionPair[]): string`
- **ManagedState** `type` L2086 — `export type ManagedState = "RUNNING" | "ARMED" | "FAILED" | "STOPPED"`
- **deriveManagedState** `function` L2088 — `export function deriveManagedState(summary: RuntimeStatusSummary): ManagedState`

#### `src/application/desktop-tool-manager.ts`
_Desktop tool launcher — spawns/attaches an external Chrome (CDP) and `opencode serve` for the Electron shell._

- **ToolLaunchResult** `interface` L13 — `export interface ToolLaunchResult`
- **ToolActionResult** `interface` L22 — `export interface ToolActionResult`
- **OpenCodeToolInput** `interface` L27 — `export interface OpenCodeToolInput`
- **BrowserToolInput** `interface` L32 — `export interface BrowserToolInput`
- **DesktopToolLauncher** `interface` L36 — `export interface DesktopToolLauncher`
- **DesktopToolError** `class` L44 — `export class DesktopToolError extends Error`
- **LocalDesktopToolLauncher** `class` L56 — `export class LocalDesktopToolLauncher implements DesktopToolLauncher`

#### `src/application/event-log.ts`
_Source module for event-log.ts._

- **EventLogOptions** `interface` L8 — `export interface EventLogOptions`
- **RecordEventOptions** `interface` L14 — `export interface RecordEventOptions`
- **EventLog** `class` L34 — `export class EventLog`

#### `src/application/headless-service.ts`
_Source module for headless-service.ts._

- **HeadlessServiceOptions** `interface` L17 — `export interface HeadlessServiceOptions`
- **HeadlessService** `class` L26 — `export class HeadlessService`

#### `src/application/health-monitors.ts`
_Deterministic health-monitor definitions (session drift, transport, idle activity, delivery stalled, overall health). Consolidated from RelayX._

- **HealthStatus** `type` L7 — `export type HealthStatus = "healthy" | "warning" | "critical"`
- **HealthSignal** `interface` L9 — `export interface HealthSignal`
- **HealthIncident** `interface` L15 — `export interface HealthIncident`
- **HealthMonitorResult** `interface` L23 — `export interface HealthMonitorResult`
- **evaluateSessionDrift** `function` L29 — `export function evaluateSessionDrift(activeSessions: number, configuredSessions: number): HealthMonitorResult`
- **evaluateTransportHealth** `function` L37 — `export function evaluateTransportHealth(reachable: boolean, authOk: boolean): HealthMonitorResult`
- **evaluateIdleActivity** `function` L43 — `export function evaluateIdleActivity(lastActivityMs: number | undefined, idleThresholdMs: number, now: number = Date.now()): HealthMonitorR…`
- **evaluateDeliveryStalled** `function` L51 — `export function evaluateDeliveryStalled(pendingCount: number, oldestPendingAgeMs: number, stallThresholdMs: number): HealthMonitorResult`
- **overallHealth** `function` L57 — `export function overallHealth(results: HealthMonitorResult[]): HealthStatus`

#### `src/application/local-agent-planner-prompt.ts`
_Source module for local-agent-planner-prompt.ts._

- **LOCAL_AGENT_PLANNER_PROMPT_VERSION** `const` L6 — `export const LOCAL_AGENT_PLANNER_PROMPT_VERSION = "1"`
- **LOCAL_AGENT_PLANNER_PROMPT** `const` L8 — `export const LOCAL_AGENT_PLANNER_PROMPT = `You are the planning and supervision agent for an autonomous software-development relay. A codin…`

#### `src/application/opencode-desktop.ts`
_Rule 5 step 5 — OpenCode Desktop process control for approved recovery._

- **ExecFileFn** `type` L12 — `export type ExecFileFn = (file: string, args: string[]) => Promise<unknown>`
- **OpenCodeDesktopControl** `interface` L21 — `export interface OpenCodeDesktopControl`
- **createOpenCodeDesktopControl** `function` L26 — `export function createOpenCodeDesktopControl(exec: ExecFileFn = defaultExec): OpenCodeDesktopControl`

#### `src/application/pair-config-repository.ts`
_Source module for pair-config-repository.ts._

- **PairConfigErrorCode** `type` L12 — `export type PairConfigErrorCode = | "CONFIG_UNREADABLE" | "CONFIG_INVALID" | "CONFIG_UNWRITABLE" | "PAIR_NOT_FOUND" | "PAIR_ALREADY_EXISTS"…`
- **PairConfigError** `class` L22 — `export class PairConfigError extends Error`
- **PairEdits** `interface` L32 — `export interface PairEdits`
- **PairConfigRepository** `class` L51 — `export class PairConfigRepository`

#### `src/application/permission-service.ts`
_v1.1 §11.5 — least-privilege, project/pair-scoped permission grants with_

- **GLOBAL_SCOPE_REF** `const` L20 — `export const GLOBAL_SCOPE_REF = "shared-opencode"`
- **GlobalAuthorization** `interface` L23 — `export interface GlobalAuthorization`
- **PermissionServiceContext** `interface` L28 — `export interface PermissionServiceContext`
- **scopeKeysForPair** `function` L43 — `export function scopeKeysForPair(pair: SessionPair): Array<`
- **PermissionService** `class` L58 — `export class PermissionService`

#### `src/application/planner-seeding-service.ts`
_Source module for planner-seeding-service.ts._

- **PlannerSeedingContext** `interface` L30 — `export interface PlannerSeedingContext`
- **PlannerSeedingService** `class` L47 — `export class PlannerSeedingService`

#### `src/application/project-pair-repository.ts`
_Project-pair identity / ownership service._

- **ProjectPairConfigErrorCode** `type` L11 — `export type ProjectPairConfigErrorCode = | "CONFIG_UNREADABLE" | "CONFIG_INVALID" | "CONFIG_UNWRITABLE" | "PROJECT_PAIR_NOT_FOUND" | "PROJE…`
- **ProjectPairRepositoryError** `class` L19 — `export class ProjectPairRepositoryError extends Error`
- **ProjectPairRepository** `class` L37 — `export class ProjectPairRepository`

#### `src/application/project-pair-service.ts`
_Project-pair identity / ownership service._

- **ProjectPairServiceOptions** `interface` L30 — `export interface ProjectPairServiceOptions`
- **CreateProjectPairInput** `type` L39 — `export type CreateProjectPairInput = CreateProjectPairDto`
- **OpenCodeProjectDiscovery** `type` L40 — `export type OpenCodeProjectDiscovery = OpenCodeProjectDto`
- **ProjectPairService** `class` L51 — `export class ProjectPairService`
- **suggestProjectPairId** `function` L272 — `export function suggestProjectPairId(repoPath: string, projectSlug: string): string`

#### `src/application/relay-engine.ts`
_Source module for relay-engine.ts._

- **RelayEngineOptions** `interface` L10 — `export interface RelayEngineOptions`
- **RelayEngine** `class` L27 — `export class RelayEngine`

#### `src/application/settings-repository.ts`
_Tiny operator settings store (config/settings.local.json)._

- **readSettings** `function` L18 — `export function readSettings(): SettingsDto`
- **writeSettings** `function` L38 — `export function writeSettings(input: SettingsDto): SettingsDto`

#### `src/application/universal-planner-prompt.ts`
_Source module for universal-planner-prompt.ts._

- **UNIVERSAL_PLANNER_PROMPT_VERSION** `const` L6 — `export const UNIVERSAL_PLANNER_PROMPT_VERSION = "2"`
- **UNIVERSAL_PLANNER_PROMPT** `const` L8 — `export const UNIVERSAL_PLANNER_PROMPT = `You are the autonomous planning and supervision agent for this software project. An OpenCode worke…`

#### `src/application/worker-progress.ts`
_Worker progress tracking service._

- **WorkerProgressServiceOptions** `interface` L22 — `export interface WorkerProgressServiceOptions`
- **WorkerProgressService** `class` L67 — `export class WorkerProgressService`

#### `src/application/worker-question-service.ts`
_Source module for worker-question-service.ts._

- **WorkerQuestionService** `class` L11 — `export class WorkerQuestionService`

#### `src/application/worker-session-service.ts`
_Worker session management service._

- **WorkerSessionContext** `interface` L35 — `export interface WorkerSessionContext`
- **WorkerSessionService** `class` L71 — `export class WorkerSessionService`

#### `src/application/worker-transcript-service.ts`
_Worker transcript / session summary service._

- **readWorkerTranscript** `function` L13 — `export async function readWorkerTranscript(pair: SessionPair, options: OpenCodeClientOptions = {}): Promise<WorkerTranscript>`

### remote

#### `src/remote/remote-server.ts`
_Optional HTTP control API (service start only)._

- **RemoteTimelineEntry** `interface` L11 — `export interface RemoteTimelineEntry`
- **RemoteServiceOptions** `interface` L22 — `export interface RemoteServiceOptions`
- **RemoteResponse** `type` L43 — `export type RemoteResponse = |`
- **createRemoteServer** `function` L129 — `export function createRemoteServer(options: RemoteServiceOptions):`

### util

#### `src/util/async.ts`
_Async primitives (timeout, retry, bounded backoff)._

- **SleepFn** `type` L11 — `export type SleepFn = (ms: number, signal?: AbortSignal) => Promise<void>`
- **interruptibleSleep** `function` L13 — `export function interruptibleSleep(ms: number, signal?: AbortSignal): Promise<void>`
- **FifoMutex** `class` L40 — `export class FifoMutex`
- **LockRegistry** `class` L58 — `export class LockRegistry`

#### `src/util/attention-parser.ts`
_Source module for attention-parser.ts._

- **parseWorkerAttentionEnvelope** `function` L22 — `export function parseWorkerAttentionEnvelope(text: string): WorkerAttentionEnvelope | undefined`

#### `src/util/canonical.ts`
_Canonicalization helpers (URL, identity, hash)._

- **canonicalizeText** `function` L12 — `export function canonicalizeText(text: string): string`
- **hashText** `function` L21 — `export function hashText(text: string): string`

#### `src/util/chatgpt-url.ts`
_Source module for chatgpt-url.ts._

- **ChatGptUrlErrorCode** `type` L6 — `export type ChatGptUrlErrorCode = | "INVALID_URL" | "NOT_CHATGPT_HOST" | "MISSING_CONVERSATION_SEGMENT" | "MISSING_CONVERSATION_ID"`
- **ChatGptUrlError** `class` L12 — `export class ChatGptUrlError extends Error`
- **ParsedChatGptConversation** `interface` L22 — `export interface ParsedChatGptConversation`
- **parseChatGptConversationUrl** `function` L39 — `export function parseChatGptConversationUrl(input: string): ParsedChatGptConversation`
- **conversationUrlMatchesId** `function` L90 — `export function conversationUrlMatchesId(input: string, conversationId: string): boolean`

#### `src/util/composer-polling.ts`
_Polling helper that waits for the ChatGPT composer to become ready before sending; injectable clock/sleep/AbortSignal. Consolidated from TerminalBot/RelayLoop._

- **ComposerPollingOptions** `interface` L9 — `export interface ComposerPollingOptions`
- **waitForComposerReady** `function` L17 — `export async function waitForComposerReady( snapshot: () => Promise<ComposerSnapshot>, options: ComposerPollingOptions ): Promise<`

#### `src/util/composer-readiness.ts`
_Pure composer-readiness check: not generating, latest message is assistant, exactly one editable composer, draft matches expected payload. Consolidated from TerminalBot/RelayLoop._

- **ComposerSnapshot** `interface` L7 — `export interface ComposerSnapshot`
- **ComposerReadinessResult** `interface` L17 — `export interface ComposerReadinessResult`
- **isComposerReady** `function` L22 — `export function isComposerReady(snapshot: ComposerSnapshot): ComposerReadinessResult`
- **PLANNER_WAIT_TIMEOUT_MS** `const` L39 — `export const PLANNER_WAIT_TIMEOUT_MS = 10 * 60 * 1000`
- **PLANNER_READY_TIMEOUT_MS** `const` L40 — `export const PLANNER_READY_TIMEOUT_MS = 10 * 60 * 1000`
- **RECEIPT_TIMEOUT_MS** `const` L41 — `export const RECEIPT_TIMEOUT_MS = 10 * 60 * 1000`
- **RECEIPT_POLL_INTERVAL_MS** `const` L42 — `export const RECEIPT_POLL_INTERVAL_MS = 5 * 1000`

#### `src/util/delivery-error.ts`
_Source module for delivery-error.ts._

- **SubmissionNotAttemptedError** `class` L12 — `export class SubmissionNotAttemptedError extends Error`

#### `src/util/duplicates.ts`
_Shared duplicate-detection helpers for the pairs and project-pairs config_

- **findDuplicates** `function` L11 — `export function findDuplicates<T>(items: T[], keyForItem: (item: T) => string): string[]`
- **formatZodIssue** `function` L26 — `export function formatZodIssue(issue: z.ZodIssue): string`

#### `src/util/net.ts`
_Source module for net.ts._

- **normalizeHostname** `function` L13 — `export function normalizeHostname(hostname: string): string`
- **isLoopbackHostname** `function` L17 — `export function isLoopbackHostname(hostname: string): boolean`
- **isHttpUrl** `function` L22 — `export function isHttpUrl(value: string): boolean`
- **credentialsAllowed** `function` L38 — `export function credentialsAllowed(url: string, allowInsecureAuth?: boolean): boolean`

#### `src/util/planner-control.ts`
_Recognises the planner's terminal control messages (RELAY_COMPLETE / RELAY_BLOCKED)._

- **plannerControlMessage** `function` L10 — `export function plannerControlMessage(text: string): "complete" | "blocked" | undefined`

#### `src/util/readiness.ts`
_Readiness checks for worker/planner pairs._

- **readinessCheck** `function` L12 — `export function readinessCheck(name: string, status: CheckStatus, reason: string): ReadinessCheck`
- **pass** `function` L16 — `export function pass(name: string, reason = "OK"): ReadinessCheck`
- **fail** `function` L20 — `export function fail(name: string, reason: string): ReadinessCheck`

#### `src/util/watermark.ts`
_Embeds a compact, human-visible watermark on every relay message so_

- **RelayWatermark** `interface` L11 — `export interface RelayWatermark`
- **makeWatermark** `function` L16 — `export function makeWatermark(): RelayWatermark`
- **renderWatermark** `function` L20 — `export function renderWatermark(watermark: RelayWatermark): string`
- **stripWatermark** `function` L26 — `export function stripWatermark(text: string): string`
- **withWatermark** `function` L30 — `export function withWatermark(text: string): string`

### core

#### `src/index.ts`
_Module exports for src._

- _(no exported symbols)_

#### `src/service-entry.ts`
_Source module for service-entry.ts._

- _(no exported symbols)_

#### `src/sessions/pairs.ts`
_Source module for pairs.ts._

- **ConfigError** `class` L108 — `export class ConfigError extends Error`
- **loadPairsConfig** `function` L118 — `export async function loadPairsConfig(configPath: string): Promise<PairsConfig>`
- **bindOpenCodeSession** `function` L139 — `export async function bindOpenCodeSession( configPath: string, pairId: string, sessionId: string ): Promise<PairsConfig>`
- **parsePairsConfig** `function` L170 — `export function parsePairsConfig(input: unknown): PairsConfig`
- **deriveChatGptConversationId** `function` L187 — `export function deriveChatGptConversationId(conversationUrl: string): string | undefined`

#### `src/sessions/project-pairs.ts`
_Project-pair identity / ownership service._

- **chatGptProjectSlugPattern** `const` L17 — `export const chatGptProjectSlugPattern = /^g-p-[A-Za-z0-9_-]+$/`
- **ProjectPairConfigError** `class` L86 — `export class ProjectPairConfigError extends Error`
- **parseProjectPairsConfig** `function` L96 — `export function parseProjectPairsConfig(input: unknown): ProjectPairsConfig`

#### `src/types.ts`
_Source module for types.ts._

- **WorkerAdapterType** `type` L6 — `export type WorkerAdapterType = "opencode"`
- **PlannerAdapterType** `type` L7 — `export type PlannerAdapterType = "chatgpt-browser"`
- **CheckStatus** `type` L9 — `export type CheckStatus = "PASS" | "FAIL"`
- **ReadinessStatus** `type` L10 — `export type ReadinessStatus = "READY" | "NOT_READY"`
- **ReadinessCheck** `interface` L12 — `export interface ReadinessCheck`
- **ReadinessOverrides** `type` L19 — `export type ReadinessOverrides = Record<string, boolean | string>`
- **OpenCodeServerConfig** `interface` L21 — `export interface OpenCodeServerConfig`
- **ChatGPTBrowserConfig** `interface` L30 — `export interface ChatGPTBrowserConfig`
- **WorkerIdentity** `interface` L38 — `export interface WorkerIdentity`
- **PlannerIdentity** `interface` L46 — `export interface PlannerIdentity`
- **OpenCodeModelRef** `interface` L58 — `export interface OpenCodeModelRef`
- **OpenCodeModelInfo** `interface` L63 — `export interface OpenCodeModelInfo extends OpenCodeModelRef`
- **SessionPair** `interface` L68 — `export interface SessionPair`
- **PairsConfig** `interface` L87 — `export interface PairsConfig`
- **ProjectPair** `interface` L96 — `export interface ProjectPair`
- **ProjectPairsConfig** `interface` L111 — `export interface ProjectPairsConfig`
- **PairReadinessReport** `interface` L115 — `export interface PairReadinessReport`
- **RelayableMessage** `interface` L122 — `export interface RelayableMessage`
- **RelayReceipt** `interface` L137 — `export interface RelayReceipt`
- **WorkerPromptState** `type` L150 — `export type WorkerPromptState = "PERSISTED" | "ADMITTED" | "PROMOTED" | "COMPLETED"`
- **RelayDirection** `type` L152 — `export type RelayDirection = "worker-to-planner" | "planner-to-worker"`
- **DeliveryStatus** `type` L154 — `export type DeliveryStatus = "DISCOVERED" | "DELIVERING" | "DELIVERED" | "FAILED"`
- **WorkerMessageClassification** `type` L157 — `export type WorkerMessageClassification = "report" | "question"`
- **WorkerQuestionNature** `type` L160 — `export type WorkerQuestionNature = "planner_input_required"`
- **CanonicalRelayIdentity** `interface` L162 — `export interface CanonicalRelayIdentity`
- **RelayRecord** `interface` L169 — `export interface RelayRecord`
- **StartupOperationStatus** `type` L194 — `export type StartupOperationStatus = "pending" | "stabilized" | "hold" | "aborted"`
- **StartupOperation** `interface` L196 — `export interface StartupOperation`
- **PairRelayState** `interface` L212 — `export interface PairRelayState`
- **SupervisorState** `type` L226 — `export type SupervisorState = | "READY" | "WORKING" | "WAITING_PLANNER" | "WAITING_WORKER" | "IDLE" | "COMPLETED" | "WAITING_INPUT" | "STUC…`
- **WorkerObservation** `interface` L239 — `export interface WorkerObservation`
- **PlannerObservation** `interface` L255 — `export interface PlannerObservation`
- **ObservationSnapshot** `interface` L268 — `export interface ObservationSnapshot`
- **SupervisorContinuity** `interface` L275 — `export interface SupervisorContinuity`
- **IncidentDisposition** `type` L314 — `export type IncidentDisposition = | "resolved" | "held" | "awaiting_operator" | "authorized_abandonment" | "terminated_verified" | "termina…`
- **RecoveryPolicy** `type` L323 — `export type RecoveryPolicy = "none" | "safe"`
- **RecoveryErrorCode** `type` L325 — `export type RecoveryErrorCode = | "OPENCODE_UNREACHABLE" | "OPENCODE_SESSION_MISSING" | "OPENCODE_REPO_MISMATCH" | "OPENCODE_TIMEOUT" | "CH…`
- **BrowserOwnership** `type` L340 — `export type BrowserOwnership = "external" | "managed"`
- **RecoveryMetadata** `interface` L342 — `export interface RecoveryMetadata`
- **PairRuntimeState** `type` L353 — `export type PairRuntimeState = "STOPPED" | "STARTING" | "RUNNING" | "PAUSED" | "STOPPING" | "ERROR"`
- **PeerHealth** `type` L355 — `export type PeerHealth = "connected" | "degraded" | "failed" | "unknown"`
- **PeerActivity** `type` L358 — `export type PeerActivity = "idle" | "working"`
- **PeerFailureReason** `type` L365 — `export type PeerFailureReason = "transport" | "session"`
- **RuntimePairStatus** `interface` L367 — `export interface RuntimePairStatus`
- **SchedulerMode** `type` L394 — `export type SchedulerMode = "ACTIVE" | "DORMANT_WATCH"`
- **RuntimeMetadata** `interface` L396 — `export interface RuntimeMetadata`
- **SyncedProject** `interface` L412 — `export interface SyncedProject`
- **RelayCycleStatus** `type` L421 — `export type RelayCycleStatus = | "DISPATCHED" | "WORKER_RESPONDED" | "DELIVERED" | "FAILED"`
- **RelayCycle** `interface` L427 — `export interface RelayCycle`

## External dependencies (by import count)

| Package | Imported by |
|---|---:|
| `node:path` | 23 |
| `node:fs/promises` | 8 |
| `node:fs` | 7 |
| `node:crypto` | 6 |
| `node:os` | 4 |
| `zod` | 3 |
| `playwright-core` | 2 |
| `node:child_process` | 2 |
| `node:http` | 2 |
| `node:https` | 1 |
| `node:buffer` | 1 |
| `node:process` | 1 |
| `node:sqlite` | 1 |
