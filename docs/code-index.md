# Agent-Relay Code Index

> Deterministic index of every `src/**/*.ts` module and its exported symbols.
> Generated: 2026-10-09T18:30:43.314Z  
> Regenerate: `npm run index:code`  
> **87 modules · 550 exported symbols**

This file is generated from source text — do not hand-edit. The narrative companion
(the comment pass that added module headers) lives in [`module-index.md`](./module-index.md).

## File map

| Module | Category | Purpose | Symbols |
|---|---|---|---:|
| `src/adapters/chatgpt/index.ts` | adapter-chatgpt | ChatGPT browser adapter exports. | 12 |
| `src/adapters/chatgpt/project-discovery.ts` | adapter-chatgpt | Source module for project-discovery.ts. | 7 |
| `src/adapters/chatgpt/service-warning.ts` | adapter-chatgpt | Source module for service-warning.ts. | 1 |
| `src/adapters/opencode/desktop-state.ts` | adapter-opencode | Source module for desktop-state.ts. | 7 |
| `src/adapters/opencode/event-source.ts` | adapter-opencode | Source module for event-source.ts. | 5 |
| `src/adapters/opencode/http.ts` | adapter-opencode | OpenCode HTTP client — typed request/response DTOs, auth headers, and error mapping for the OpenCode server. | 15 |
| `src/adapters/opencode/index.ts` | adapter-opencode | OpenCode adapter exports (session management, readiness, event source). | 10 |
| `src/application/advisor-provider.ts` | application | Source module for advisor-provider.ts. | 1 |
| `src/application/attention-parser.ts` | application | Source module for attention-parser.ts. | 1 |
| `src/application/attention-service.ts` | application | Source module for attention-service.ts. | 2 |
| `src/application/automation-governor.ts` | application | Source module for automation-governor.ts. | 3 |
| `src/application/bounded-context-assembler.ts` | application | Source module for bounded-context-assembler.ts. | 1 |
| `src/application/control-plane-adapter.ts` | application | Control-plane adapter for worker/planner pairs. | 3 |
| `src/application/desktop-lifecycle.ts` | application | Source module for desktop-lifecycle.ts. | 6 |
| `src/application/desktop-service.ts` | application | Electron desktop service integration. | 11 |
| `src/application/desktop-tool-manager.ts` | application | Desktop tool launcher — spawns/attaches an external Chrome (CDP) and `opencode serve` for the Electron shell. | 7 |
| `src/application/event-log.ts` | application | Source module for event-log.ts. | 3 |
| `src/application/headless-service.ts` | application | Source module for headless-service.ts. | 2 |
| `src/application/local-agent-planner-prompt.ts` | application | Source module for local-agent-planner-prompt.ts. | 2 |
| `src/application/ollama-adapter.ts` | application | Source module for ollama-adapter.ts. | 2 |
| `src/application/pair-config-repository.ts` | application | Source module for pair-config-repository.ts. | 4 |
| `src/application/planner-seeding-service.ts` | application | Source module for planner-seeding-service.ts. | 2 |
| `src/application/project-pair-repository.ts` | application | Project-pair identity / ownership service. | 3 |
| `src/application/project-pair-service.ts` | application | Project-pair identity / ownership service. | 5 |
| `src/application/relay-engine.ts` | application | Source module for relay-engine.ts. | 2 |
| `src/application/universal-planner-prompt.ts` | application | Source module for universal-planner-prompt.ts. | 2 |
| `src/application/worker-attention-protocol.ts` | application | Source module for worker-attention-protocol.ts. | 2 |
| `src/application/worker-progress.ts` | application | Worker progress tracking service. | 2 |
| `src/application/worker-question-service.ts` | application | Source module for worker-question-service.ts. | 1 |
| `src/application/worker-session-service.ts` | application | Worker session management service. | 2 |
| `src/application/worker-transcript-service.ts` | application | Worker transcript / session summary service. | 1 |
| `src/cli-args.ts` | entry | CLI argument parsing schema. | 4 |
| `src/cli.ts` | entry | CLI entrypoint — parses args and starts runtime / service. | 4 |
| `src/contracts/ai-automation.ts` | contracts | Source module for ai-automation.ts. | 2 |
| `src/contracts/ai-proposal.ts` | contracts | Source module for ai-proposal.ts. | 4 |
| `src/contracts/attention.ts` | contracts | Source module for attention.ts. | 7 |
| `src/contracts/control-plane.ts` | contracts | Control-plane adapter for worker/planner pairs. | 28 |
| `src/contracts/desktop.ts` | contracts | Source module for desktop.ts. | 55 |
| `src/contracts/events.ts` | contracts | Source module for events.ts. | 2 |
| `src/contracts/worker-progress.ts` | contracts | Worker progress tracking service. | 10 |
| `src/contracts/worker-question.ts` | contracts | Source module for worker-question.ts. | 1 |
| `src/contracts/worker-transcript.ts` | contracts | Worker transcript / session summary service. | 1 |
| `src/index.ts` | core | Module exports for src. | 0 |
| `src/persistence/archive.ts` | persistence | Source module for archive.ts. | 6 |
| `src/persistence/canonical.ts` | persistence | Canonicalization helpers (URL, identity, hash). | 3 |
| `src/persistence/index.ts` | persistence | Persistence / SQLite store exports. | 14 |
| `src/persistence/store.ts` | persistence | Source module for store.ts. | 5 |
| `src/recovery/browser.ts` | recovery | Source module for browser.ts. | 7 |
| `src/recovery/chatgpt.ts` | recovery | Source module for chatgpt.ts. | 3 |
| `src/recovery/engine.ts` | recovery | Source module for engine.ts. | 3 |
| `src/recovery/index.ts` | recovery | Recovery engine exports. | 24 |
| `src/recovery/opencode.ts` | recovery | Source module for opencode.ts. | 5 |
| `src/recovery/policy.ts` | recovery | Source module for policy.ts. | 4 |
| `src/recovery/reasons.ts` | recovery | Source module for reasons.ts. | 1 |
| `src/recovery/schedule.ts` | recovery | Source module for schedule.ts. | 5 |
| `src/relay/chatgpt-gate.ts` | relay | Source module for chatgpt-gate.ts. | 12 |
| `src/relay/delivery-error.ts` | relay | Source module for delivery-error.ts. | 1 |
| `src/relay/index.ts` | relay | Relay core exports (identity, verification, ledger). | 11 |
| `src/relay/message-classifier.ts` | relay | Source module for message-classifier.ts. | 2 |
| `src/relay/verifier.ts` | relay | Source module for verifier.ts. | 3 |
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
| `src/sessions/chatgpt-url.ts` | core | Source module for chatgpt-url.ts. | 5 |
| `src/sessions/pairs.ts` | core | Source module for pairs.ts. | 5 |
| `src/sessions/project-pairs.ts` | core | Project-pair identity / ownership service. | 3 |
| `src/supervisor/classifier.ts` | supervisor | Source module for classifier.ts. | 7 |
| `src/supervisor/events.ts` | supervisor | Source module for events.ts. | 8 |
| `src/supervisor/index.ts` | supervisor | Supervisor / observation loop exports. | 28 |
| `src/supervisor/observation.ts` | supervisor | Observation / event correlation utilities. | 4 |
| `src/supervisor/policy.ts` | supervisor | Source module for policy.ts. | 4 |
| `src/supervisor/state.ts` | supervisor | Source module for state.ts. | 4 |
| `src/supervisor/supervisor.ts` | supervisor | Source module for supervisor.ts. | 8 |
| `src/types.ts` | core | Source module for types.ts. | 45 |
| `src/util/async.ts` | util | Async primitives (timeout, retry, bounded backoff). | 4 |
| `src/util/canonical.ts` | util | Canonicalization helpers (URL, identity, hash). | 2 |
| `src/util/net.ts` | util | Source module for net.ts. | 4 |
| `src/util/readiness.ts` | util | Readiness checks for worker/planner pairs. | 3 |
| `src/validator/readiness.ts` | validator | Readiness checks for worker/planner pairs. | 4 |
| `src/validator/report.ts` | validator | Source module for report.ts. | 2 |

## Categories

| Category | Modules |
|---|---:|
| entry | 2 |
| contracts | 9 |
| adapter-opencode | 4 |
| adapter-chatgpt | 3 |
| relay | 5 |
| persistence | 4 |
| validator | 2 |
| supervisor | 7 |
| recovery | 8 |
| runtime | 8 |
| application | 24 |
| remote | 1 |
| util | 4 |
| core | 6 |

## Symbol index

Exported symbols per module, with the source line and a trimmed signature.

### entry

#### `src/cli-args.ts`
_CLI argument parsing schema._

- **CliError** `class` L11 — `export class CliError extends Error`
- **ParsedArgs** `interface` L18 — `export interface ParsedArgs`
- **parseArgs** `function` L49 — `export function parseArgs(args: string[]): ParsedArgs`
- **hasChatGPTBrowserConfig** `function` L476 — `export function hasChatGPTBrowserConfig(config?: ChatGPTBrowserConfig): boolean`

#### `src/cli.ts`
_CLI entrypoint — parses args and starts runtime / service._

- **parseArgs** `re-export` L50 (from `./cli-args.js`) — `export { parseArgs } from "./cli-args.js"`
- **(anonymous)** `type` L51 — `export type`
- **runCli** `function` L53 — `export async function runCli(args: string[]): Promise<void>`
- **recoveryOptions** `function` L1060 — `export function recoveryOptions( args: ParsedArgs, pair: SessionPair, launcher: LocalDesktopToolLauncher ): SupervisorRecoveryOptions | und…`

### contracts

#### `src/contracts/ai-automation.ts`
_Source module for ai-automation.ts._

- **AiAutomationMode** `type` L13 — `export type AiAutomationMode = | "off" | "manual" | "auto_propose"`
- **AiAutomationPolicy** `interface` L18 — `export interface AiAutomationPolicy`

#### `src/contracts/ai-proposal.ts`
_Source module for ai-proposal.ts._

- **ProposalDisposition** `type` L15 — `export type ProposalDisposition = | "propose_answer" | "needs_human" | "no_action"`
- **AttentionAdvisorInput** `interface` L20 — `export interface AttentionAdvisorInput`
- **BoundedContext** `interface` L29 — `export interface BoundedContext`
- **AttentionAdvisorResult** `interface` L38 — `export interface AttentionAdvisorResult`

#### `src/contracts/attention.ts`
_Source module for attention.ts._

- **WorkerAttentionKind** `type` L15 — `export type WorkerAttentionKind = "report" | "question" | "blocked" | "completed"`
- **AttentionStatus** `type` L17 — `export type AttentionStatus = "open" | "acknowledged" | "resolved"`
- **WorkerAttentionEnvelope** `interface` L19 — `export interface WorkerAttentionEnvelope`
- **AttentionItem** `interface` L24 — `export interface AttentionItem`
- **ListAttentionPayload** `interface` L39 — `export interface ListAttentionPayload`
- **AcknowledgeAttentionPayload** `interface` L44 — `export interface AcknowledgeAttentionPayload`
- **ResolveAttentionPayload** `interface` L48 — `export interface ResolveAttentionPayload`

#### `src/contracts/control-plane.ts`
_Control-plane adapter for worker/planner pairs._

- **ControlPlaneOperationType** `type` L14 — `export type ControlPlaneOperationType = | "getStatus" | "getTimeline" | "startProject" | "pauseProject" | "listAttention" | "acknowledgeAtt…`
- **ControlPlaneOperation** `interface` L46 — `export interface ControlPlaneOperation`
- **GetStatusPayload** `interface` L51 — `export interface GetStatusPayload`
- **GetTimelinePayload** `interface` L55 — `export interface GetTimelinePayload`
- **StartProjectPayload** `interface` L60 — `export interface StartProjectPayload`
- **PauseProjectPayload** `interface` L64 — `export interface PauseProjectPayload`
- **ListAttentionPayload** `interface` L68 — `export interface ListAttentionPayload`
- **AcknowledgeAttentionPayload** `interface` L73 — `export interface AcknowledgeAttentionPayload`
- **ResolveAttentionPayload** `interface` L77 — `export interface ResolveAttentionPayload`
- **RejectAttentionProposalPayload** `interface` L82 — `export interface RejectAttentionProposalPayload`
- **CreateAttentionProposalPayload** `interface` L86 — `export interface CreateAttentionProposalPayload`
- **ApproveAttentionProposalPayload** `interface` L93 — `export interface ApproveAttentionProposalPayload`
- **ListProposalsPayload** `interface` L101 — `export interface ListProposalsPayload`
- **GetProposalPayload** `interface` L106 — `export interface GetProposalPayload`
- **CreateProjectPairPayload** `interface` L110 — `export interface CreateProjectPairPayload`
- **RemoveProjectPairPayload** `interface` L116 — `export interface RemoveProjectPairPayload`
- **ListProjectPairsPayload** `interface` L120 — `export interface ListProjectPairsPayload`
- **CreatePairPayload** `interface` L124 — `export interface CreatePairPayload`
- **UpdatePairPayload** `interface` L132 — `export interface UpdatePairPayload`
- **RemovePairPayload** `interface` L141 — `export interface RemovePairPayload`
- **ValidatePairPayload** `interface` L145 — `export interface ValidatePairPayload`
- **GetPairPayload** `interface` L149 — `export interface GetPairPayload`
- **DiscoverWorkerSessionsPayload** `interface` L153 — `export interface DiscoverWorkerSessionsPayload`
- **BindWorkerSessionPayload** `interface` L158 — `export interface BindWorkerSessionPayload`
- **UpdateProjectPairPayload** `interface` L163 — `export interface UpdateProjectPairPayload`
- **ArchiveProjectPairPayload** `interface` L169 — `export interface ArchiveProjectPairPayload`
- **ListWorkerModelsPayload** `interface` L173 — `export interface ListWorkerModelsPayload`
- **SetWorkerModelPayload** `interface` L177 — `export interface SetWorkerModelPayload`

#### `src/contracts/desktop.ts`
_Source module for desktop.ts._

- **CheckStatusDto** `type` L16 — `export type CheckStatusDto = "PASS" | "FAIL"`
- **ReadinessCheckDto** `interface` L18 — `export interface ReadinessCheckDto`
- **ValidationResultDto** `interface` L24 — `export interface ValidationResultDto`
- **EventRecordDto** `interface` L31 — `export interface EventRecordDto`
- **RecentEventsFilterDto** `interface` L40 — `export interface RecentEventsFilterDto`
- **DesktopErrorDto** `interface` L45 — `export interface DesktopErrorDto`
- **PeerHealthDto** `interface` L51 — `export interface PeerHealthDto`
- **StatusSummaryDto** `interface` L72 — `export interface StatusSummaryDto`
- **PairIdentityDto** `interface` L81 — `export interface PairIdentityDto`
- **OpenCodeSessionInfoDto** `interface` L101 — `export interface OpenCodeSessionInfoDto`
- **OpenCodeEndpointDto** `interface` L108 — `export interface OpenCodeEndpointDto`
- **OpenCodeEndpointTestDto** `interface` L112 — `export interface OpenCodeEndpointTestDto extends OpenCodeEndpointDto`
- **CreateOpenCodeSessionDto** `interface` L117 — `export interface CreateOpenCodeSessionDto extends OpenCodeEndpointDto`
- **StartOpenCodeServerDto** `interface` L122 — `export interface StartOpenCodeServerDto extends OpenCodeEndpointDto`
- **ToolLaunchResultDto** `interface` L127 — `export interface ToolLaunchResultDto`
- **ToolActionResultDto** `interface` L134 — `export interface ToolActionResultDto`
- **WorkerSessionOpenResultDto** `interface` L139 — `export interface WorkerSessionOpenResultDto`
- **WorkerModelDto** `interface` L146 — `export interface WorkerModelDto`
- **SwitchWorkerModelDto** `interface` L153 — `export interface SwitchWorkerModelDto`
- **WorkerModelSwitchResultDto** `interface` L159 — `export interface WorkerModelSwitchResultDto extends WorkerModelDto`
- **ParsedChatGptUrlDto** `interface` L165 — `export interface ParsedChatGptUrlDto`
- **PlannerEndpointDto** `interface` L171 — `export interface PlannerEndpointDto`
- **EndpointTestResultDto** `interface` L176 — `export interface EndpointTestResultDto`
- **PairStartPriming** `type` L182 — `export type PairStartPriming = "from-worker" | "from-planner" | "from-trigger"`
- **AutomationInfoDto** `interface` L184 — `export interface AutomationInfoDto`
- **PlannerSeedResultDto** `interface` L190 — `export interface PlannerSeedResultDto`
- **LocalAgentFeedResultDto** `interface` L196 — `export interface LocalAgentFeedResultDto`
- **CandidatePairDto** `interface` L203 — `export interface CandidatePairDto`
- **UpdatePairDto** `interface` L218 — `export interface UpdatePairDto`
- **ProjectPairDto** `interface` L230 — `export interface ProjectPairDto`
- **CreateProjectPairDto** `interface` L242 — `export interface CreateProjectPairDto`
- **OpenCodeProjectDto** `interface` L254 — `export interface OpenCodeProjectDto`
- **ChatGptProjectDto** `interface` L260 — `export interface ChatGptProjectDto`
- **ChatGptProjectsDiscoveryInput** `interface` L268 — `export interface ChatGptProjectsDiscoveryInput`
- **ArchivedPairSummaryDto** `interface` L272 — `export interface ArchivedPairSummaryDto`
- **WorkerModelInfo** `interface` L281 — `export interface WorkerModelInfo extends OpenCodeModelInfo`
- **WorkerSessionDesktopAlignmentDto** `interface` L285 — `export interface WorkerSessionDesktopAlignmentDto`
- **ChatGptUrlInputDto** `interface` L293 — `export interface ChatGptUrlInputDto`
- **PairDetail** `type` L298 — `export type PairDetail = PairIdentityDto`
- **OpenCodeSessionInfo** `type` L299 — `export type OpenCodeSessionInfo = OpenCodeSessionInfoDto`
- **OpenCodeEndpointInput** `type` L300 — `export type OpenCodeEndpointInput = OpenCodeEndpointDto`
- **OpenCodeEndpointTestInput** `type` L301 — `export type OpenCodeEndpointTestInput = OpenCodeEndpointTestDto`
- **CreateOpenCodeSessionInput** `type` L302 — `export type CreateOpenCodeSessionInput = CreateOpenCodeSessionDto`
- **ChatGptUrlInput** `type` L303 — `export type ChatGptUrlInput = ChatGptUrlInputDto`
- **ParsedChatGptUrl** `type` L304 — `export type ParsedChatGptUrl = ParsedChatGptUrlDto`
- **PlannerEndpointInput** `type` L305 — `export type PlannerEndpointInput = PlannerEndpointDto`
- **StartOpenCodeServerInput** `type` L306 — `export type StartOpenCodeServerInput = StartOpenCodeServerDto`
- **EndpointTestResult** `type` L307 — `export type EndpointTestResult = EndpointTestResultDto`
- **WorkerSessionDesktopAlignment** `type` L308 — `export type WorkerSessionDesktopAlignment = WorkerSessionDesktopAlignmentDto`
- **AutomationInfo** `type` L309 — `export type AutomationInfo = AutomationInfoDto`
- **PlannerSeedResult** `type` L310 — `export type PlannerSeedResult = PlannerSeedResultDto`
- **LocalAgentFeedResult** `type` L311 — `export type LocalAgentFeedResult = LocalAgentFeedResultDto`
- **CandidatePairInput** `type` L312 — `export type CandidatePairInput = CandidatePairDto`
- **UpdatePairInput** `type` L313 — `export type UpdatePairInput = UpdatePairDto`
- **ValidatedPair** `type` L314 — `export type ValidatedPair = ValidationResultDto`

#### `src/contracts/events.ts`
_Source module for events.ts._

- **EventRecord** `interface` L8 — `export interface EventRecord`
- **EventFilter** `interface` L19 — `export interface EventFilter`

#### `src/contracts/worker-progress.ts`
_Worker progress tracking service._

- **WorkerProgressState** `type` L7 — `export type WorkerProgressState = | "working" | "idle" | "completed" | "failed" | "disconnected" | "reconnecting" | "waiting"`
- **WorkerProgressTodo** `interface` L16 — `export interface WorkerProgressTodo`
- **FileChangeStatus** `type` L24 — `export type FileChangeStatus = "added" | "modified" | "deleted" | "renamed"`
- **WorkerProgressFileChange** `interface` L26 — `export interface WorkerProgressFileChange`
- **WorkerProgressChangeSummary** `interface` L34 — `export interface WorkerProgressChangeSummary`
- **WorkerProgressToolCall** `interface` L41 — `export interface WorkerProgressToolCall`
- **WorkerProgressTimelineEntry** `interface` L52 — `export interface WorkerProgressTimelineEntry`
- **WorkerProgressLive** `interface` L77 — `export interface WorkerProgressLive`
- **WorkerProgressDto** `interface` L94 — `export interface WorkerProgressDto`
- **WorkerProgressSummary** `interface` L108 — `export interface WorkerProgressSummary`

#### `src/contracts/worker-question.ts`
_Source module for worker-question.ts._

- **WorkerQuestion** `interface` L7 — `export interface WorkerQuestion`

#### `src/contracts/worker-transcript.ts`
_Worker transcript / session summary service._

- **WorkerTranscript** `interface` L7 — `export interface WorkerTranscript`

### adapter-opencode

#### `src/adapters/opencode/desktop-state.ts`
_Source module for desktop-state.ts._

- **OpenCodeDesktopSession** `interface` L15 — `export interface OpenCodeDesktopSession`
- **OpenCodeDesktopScanOptions** `interface` L21 — `export interface OpenCodeDesktopScanOptions`
- **OpenCodeDesktopStateError** `class` L26 — `export class OpenCodeDesktopStateError extends Error`
- **discoverOpenCodeServerUrl** `function` L37 — `export async function discoverOpenCodeServerUrl( options: OpenCodeDesktopScanOptions = {} ): Promise<string | undefined>`
- **scanOpenCodeDesktopActiveSession** `function` L57 — `export async function scanOpenCodeDesktopActiveSession( options: OpenCodeDesktopScanOptions = {} ): Promise<OpenCodeDesktopSession>`
- **parseOpenCodeDesktopWindowState** `function` L107 — `export function parseOpenCodeDesktopWindowState(value: unknown): OpenCodeDesktopSession | undefined`
- **openCodeDesktopStateDirectories** `function` L126 — `export function openCodeDesktopStateDirectories( platform: NodeJS.Platform = process.platform, environment: NodeJS.ProcessEnv = process.env…`

#### `src/adapters/opencode/event-source.ts`
_Source module for event-source.ts._

- **OpenCodeSessionEvent** `interface` L10 — `export interface OpenCodeSessionEvent`
- **OpenCodeEventSourceOptions** `interface` L19 — `export interface OpenCodeEventSourceOptions`
- **OpenCodeEventSourceTerminalError** `class` L39 — `export class OpenCodeEventSourceTerminalError extends Error`
- **OpenCodeEventSource** `interface` L49 — `export interface OpenCodeEventSource`
- **HttpOpenCodeEventSource** `class` L57 — `export class HttpOpenCodeEventSource implements OpenCodeEventSource`

#### `src/adapters/opencode/http.ts`
_OpenCode HTTP client — typed request/response DTOs, auth headers, and error mapping for the OpenCode server._

- **OpenCodeLocationRef** `interface` L15 — `export interface OpenCodeLocationRef`
- **OpenCodeSessionInfo** `interface` L20 — `export interface OpenCodeSessionInfo`
- **OpenCodeSessionList** `interface` L48 — `export interface OpenCodeSessionList`
- **OpenCodeMessageInfo** `interface` L56 — `export interface OpenCodeMessageInfo`
- **OpenCodePromptAdmission** `interface` L90 — `export interface OpenCodePromptAdmission`
- **OpenCodePromptResult** `interface` L105 — `export interface OpenCodePromptResult`
- **OpenCodePromptInput** `interface` L109 — `export interface OpenCodePromptInput`
- **OpenCodeDurableEvent** `interface` L119 — `export interface OpenCodeDurableEvent`
- **OpenCodeHistoryResult** `interface` L127 — `export interface OpenCodeHistoryResult`
- **CreateOpenCodeSessionInput** `interface` L132 — `export interface CreateOpenCodeSessionInput`
- **OpenCodeClientOptions** `interface` L138 — `export interface OpenCodeClientOptions extends OpenCodeServerConfig`
- **OpenCodeHttpError** `class` L149 — `export class OpenCodeHttpError extends Error`
- **OpenCodeUnexpectedResponseError** `class` L160 — `export class OpenCodeUnexpectedResponseError extends Error`
- **OpenCodeHttpClient** `class` L192 — `export class OpenCodeHttpClient`
- **OpenCodeWriteUnsupportedError** `class` L926 — `export class OpenCodeWriteUnsupportedError extends Error`

#### `src/adapters/opencode/index.ts`
_OpenCode adapter exports (session management, readiness, event source)._

- **HttpOpenCodeEventSource** `re-export` L32 (from `./event-source.js`) — `export {`
- **OpenCodeEventSource** `re-export` L32 (from `./event-source.js`) — `export {`
- **OpenCodeEventSourceOptions** `re-export` L32 (from `./event-source.js`) — `export {`
- **OpenCodeSessionEvent** `re-export` L32 (from `./event-source.js`) — `export {`
- **OpenCodeAdapter** `interface` L39 — `export interface OpenCodeAdapter`
- **OpenCodeSessionSummary** `interface` L43 — `export interface OpenCodeSessionSummary`
- **OpenCodeSessionManager** `interface` L51 — `export interface OpenCodeSessionManager extends OpenCodeAdapter`
- **FakeOpenCodeAdapter** `class` L73 — `export class FakeOpenCodeAdapter implements OpenCodeAdapter`
- **LiveOpenCodeAdapter** `class` L86 — `export class LiveOpenCodeAdapter implements OpenCodeAdapter, OpenCodeSessionManager`
- **StaticOpenCodeAdapter** `class` L440 — `export class StaticOpenCodeAdapter extends FakeOpenCodeAdapter implements OpenCodeSessionManager`

### adapter-chatgpt

#### `src/adapters/chatgpt/index.ts`
_ChatGPT browser adapter exports._

- **ChatGPTBrowserAdapter** `interface` L25 — `export interface ChatGPTBrowserAdapter`
- **PlannerSessionEvent** `interface` L34 — `export interface PlannerSessionEvent`
- **FakeChatGPTBrowserAdapter** `class` L40 — `export class FakeChatGPTBrowserAdapter implements ChatGPTBrowserAdapter`
- **ChatGPTReadinessSnapshot** `interface` L97 — `export interface ChatGPTReadinessSnapshot`
- **ChatGPTReadinessProbe** `interface` L107 — `export interface ChatGPTReadinessProbe`
- **ChatGPTBrowserDriver** `interface` L111 — `export interface ChatGPTBrowserDriver extends ChatGPTReadinessProbe`
- **LiveChatGPTBrowserOptions** `interface` L122 — `export interface LiveChatGPTBrowserOptions extends ChatGPTBrowserConfig`
- **DEFAULT_CHATGPT_RATE_LIMIT_BACKOFF_MS** `const` L128 — `export const DEFAULT_CHATGPT_RATE_LIMIT_BACKOFF_MS = 5 * 60_000`
- **LiveChatGPTBrowserAdapter** `class` L130 — `export class LiveChatGPTBrowserAdapter implements ChatGPTBrowserAdapter`
- **PlaywrightChatGPTBrowserDriver** `class` L220 — `export class PlaywrightChatGPTBrowserDriver implements ChatGPTBrowserDriver`
- **shouldNavigatePlannerPage** `function` L532 — `export function shouldNavigatePlannerPage(currentUrl: string, conversationId: string): boolean`
- **ChatGPTTemporaryLimitError** `class` L536 — `export class ChatGPTTemporaryLimitError extends Error`

#### `src/adapters/chatgpt/project-discovery.ts`
_Source module for project-discovery.ts._

- **CdpListTarget** `interface` L9 — `export interface CdpListTarget`
- **ChatGptProjectDiscovery** `interface` L15 — `export interface ChatGptProjectDiscovery`
- **ChatGptProjectDiscoveryError** `class` L23 — `export class ChatGptProjectDiscoveryError extends Error`
- **normalizeChatGptProject** `function` L44 — `export function normalizeChatGptProject(input: string):`
- **listCdpTargets** `function` L83 — `export async function listCdpTargets( cdpUrl: string, fetchImpl: typeof fetch = fetch ): Promise<CdpListTarget[]>`
- **groupChatGptProjects** `function` L111 — `export function groupChatGptProjects(targets: CdpListTarget[]): ChatGptProjectDiscovery[]`
- **discoverChatGptProjects** `function` L160 — `export async function discoverChatGptProjects( cdpUrl: string, fetchImpl: typeof fetch = fetch ): Promise<ChatGptProjectDiscovery[]>`

#### `src/adapters/chatgpt/service-warning.ts`
_Source module for service-warning.ts._

- **hasVisibleServiceWarning** `function` L10 — `export async function hasVisibleServiceWarning(page: Page, pattern: RegExp): Promise<boolean>`

### relay

#### `src/relay/chatgpt-gate.ts`
_Source module for chatgpt-gate.ts._

- **DEFAULT_CHATGPT_MIN_SUBMIT_INTERVAL_MS** `const` L7 — `export const DEFAULT_CHATGPT_MIN_SUBMIT_INTERVAL_MS = 30_000`
- **DEFAULT_CHATGPT_BACKOFF_INITIAL_MS** `const` L8 — `export const DEFAULT_CHATGPT_BACKOFF_INITIAL_MS = 30_000`
- **DEFAULT_CHATGPT_BACKOFF_MAX_MS** `const` L9 — `export const DEFAULT_CHATGPT_BACKOFF_MAX_MS = 5 * 60_000`
- **DEFAULT_CHATGPT_BACKOFF_BASE** `const` L10 — `export const DEFAULT_CHATGPT_BACKOFF_BASE = 2`
- **ChatGptSubmissionGateOptions** `interface` L12 — `export interface ChatGptSubmissionGateOptions`
- **ChatGptSubmissionDecision** `interface` L22 — `export interface ChatGptSubmissionDecision`
- **ChatGptSubmissionOutcome** `interface` L31 — `export interface ChatGptSubmissionOutcome`
- **ChatGptSubmissionGate** `class` L55 — `export class ChatGptSubmissionGate`
- **defaultIsRateLimited** `function` L165 — `export function defaultIsRateLimited(error: unknown): boolean`
- **delay** `function` L174 — `export function delay(ms: number, sleep: (m: number) => Promise<void>): Promise<void>`
- **interruptible** `function` L178 — `export async function interruptible(task: Promise<void>, signal?: AbortSignal): Promise<void>`
- **plannerControlMessage** `function` L193 — `export function plannerControlMessage(text: string): "complete" | "blocked" | undefined`

#### `src/relay/delivery-error.ts`
_Source module for delivery-error.ts._

- **SubmissionNotAttemptedError** `class` L13 — `export class SubmissionNotAttemptedError extends Error`

#### `src/relay/index.ts`
_Relay core exports (identity, verification, ledger)._

- ***** `re-export` L10 (from `./chatgpt-gate.js`) — `export * from "./chatgpt-gate.js"`
- **RelayAdapters** `interface` L25 — `export interface RelayAdapters`
- **MAX_RELAY_ATTEMPTS** `const` L37 — `export const MAX_RELAY_ATTEMPTS = 20`
- **RelayOutcome** `type` L39 — `export type RelayOutcome = | "DELIVERED" | "SKIPPED_DUPLICATE" | "AMBIGUOUS" | "FAILED" | "NOOP" | "NOT_READY" | "HELD" | "RATE_LIMITED"`
- **RelayResult** `interface` L49 — `export interface RelayResult`
- **RelayPersistence** `interface` L64 — `export interface RelayPersistence`
- **RelayOptions** `interface` L68 — `export interface RelayOptions`
- **relayWorkerToPlanner** `function` L258 — `export async function relayWorkerToPlanner( pair: SessionPair, adapters: RelayAdapters, options: RelayOptions = {} ): Promise<RelayResult>`
- **relayPlannerToWorker** `function` L278 — `export async function relayPlannerToWorker( pair: SessionPair, adapters: RelayAdapters, options: RelayOptions = {} ): Promise<RelayResult>`
- **extractModelInstruction** `function` L319 — `export function extractModelInstruction(text: string):`
- **formatRelayResult** `function` L329 — `export function formatRelayResult(result: RelayResult): string`

#### `src/relay/message-classifier.ts`
_Source module for message-classifier.ts._

- **classifyWorkerMessage** `function` L26 — `export function classifyWorkerMessage(text: string): WorkerMessageClassification`
- **questionNature** `function` L51 — `export function questionNature(text: string): WorkerQuestionNature | undefined`

#### `src/relay/verifier.ts`
_Source module for verifier.ts._

- **VerifierAdapters** `interface` L12 — `export interface VerifierAdapters`
- **VerificationResult** `interface` L17 — `export interface VerificationResult`
- **RelayVerifier** `class` L27 — `export class RelayVerifier`

### persistence

#### `src/persistence/archive.ts`
_Source module for archive.ts._

- **ArchivedConfigSnapshot** `interface` L17 — `export interface ArchivedConfigSnapshot`
- **ArchivedPairPayload** `interface` L35 — `export interface ArchivedPairPayload`
- **ArchivedPairSummary** `interface` L48 — `export interface ArchivedPairSummary`
- **ArchiveStore** `interface` L57 — `export interface ArchiveStore`
- **ArchiveError** `class` L65 — `export class ArchiveError extends Error`
- **PairArchive** `class` L80 — `export class PairArchive implements ArchiveStore`

#### `src/persistence/canonical.ts`
_Canonicalization helpers (URL, identity, hash)._

- **canonicalizeText** `re-export` L12 (from `../util/canonical.js`) — `export { canonicalizeText, hashText } from "../util/canonical.js"`
- **hashText** `re-export` L12 (from `../util/canonical.js`) — `export { canonicalizeText, hashText } from "../util/canonical.js"`
- **canonicalRelayIdentity** `function` L14 — `export function canonicalRelayIdentity( pairId: string, direction: RelayDirection, message: Pick<RelayableMessage, "id" | "text"> ): Canoni…`

#### `src/persistence/index.ts`
_Persistence / SQLite store exports._

- **RelayStoreError** `re-export` L7 (from `./store.js`) — `export {`
- **SqliteRelayStore** `re-export` L7 (from `./store.js`) — `export {`
- **ensureDbParent** `re-export` L7 (from `./store.js`) — `export {`
- **resolveDbPath** `re-export` L7 (from `./store.js`) — `export {`
- **RelayStore** `re-export` L7 (from `./store.js`) — `export {`
- **canonicalRelayIdentity** `re-export` L14 (from `./canonical.js`) — `export { canonicalRelayIdentity, canonicalizeText, hashText } from "./canonical.js"`
- **canonicalizeText** `re-export` L14 (from `./canonical.js`) — `export { canonicalRelayIdentity, canonicalizeText, hashText } from "./canonical.js"`
- **hashText** `re-export` L14 (from `./canonical.js`) — `export { canonicalRelayIdentity, canonicalizeText, hashText } from "./canonical.js"`
- **ArchiveError** `re-export` L15 (from `./archive.js`) — `export {`
- **PairArchive** `re-export` L15 (from `./archive.js`) — `export {`
- **ArchiveStore** `re-export` L15 (from `./archive.js`) — `export {`
- **ArchivedConfigSnapshot** `re-export` L15 (from `./archive.js`) — `export {`
- **ArchivedPairPayload** `re-export` L15 (from `./archive.js`) — `export {`
- **ArchivedPairSummary** `re-export` L15 (from `./archive.js`) — `export {`

#### `src/persistence/store.ts`
_Source module for store.ts._

- **RelayStore** `interface` L27 — `export interface RelayStore`
- **RelayStoreError** `class` L156 — `export class RelayStoreError extends Error`
- **SqliteRelayStore** `class` L306 — `export class SqliteRelayStore implements RelayStore`
- **resolveDbPath** `function` L1208 — `export function resolveDbPath(configuredPath?: string): string`
- **ensureDbParent** `function` L1215 — `export async function ensureDbParent(dbPath: string): Promise<void>`

### validator

#### `src/validator/readiness.ts`
_Readiness checks for worker/planner pairs._

- **ValidatorAdapters** `interface` L17 — `export interface ValidatorAdapters`
- **validatePair** `function` L22 — `export async function validatePair( pair: SessionPair, adapters: ValidatorAdapters, now: Date = new Date() ): Promise<PairReadinessReport>`
- **fail** `re-export` L78 (from `../util/readiness.js`) — `export { fail, pass } from "../util/readiness.js"`
- **pass** `re-export` L78 (from `../util/readiness.js`) — `export { fail, pass } from "../util/readiness.js"`

#### `src/validator/report.ts`
_Source module for report.ts._

- **formatReadinessReport** `function` L9 — `export function formatReadinessReport(results: PairReadinessReport[]): string`
- **formatPairReadinessReport** `function` L13 — `export function formatPairReadinessReport(result: PairReadinessReport): string`

### supervisor

#### `src/supervisor/classifier.ts`
_Source module for classifier.ts._

- **DEFAULT_STUCK_AFTER_MS** `const` L14 — `export const DEFAULT_STUCK_AFTER_MS = 10 * 60_000`
- **CycleContext** `interface` L16 — `export interface CycleContext`
- **ClassifyOptions** `interface` L31 — `export interface ClassifyOptions`
- **ClassifyInput** `interface` L35 — `export interface ClassifyInput`
- **Classification** `interface` L42 — `export interface Classification`
- **emptyCycleContext** `function` L47 — `export function emptyCycleContext(): CycleContext`
- **classify** `function` L54 — `export function classify(input: ClassifyInput): Classification`

#### `src/supervisor/events.ts`
_Source module for events.ts._

- **RuntimeEventType** `type` L11 — `export type RuntimeEventType = | "RUNTIME_STARTED" | "RUNTIME_STOPPED" | "PAIR_RUNTIME_STARTED" | "PAIR_RUNTIME_STOPPED" | "PAIR_RUNTIME_FA…`
- **SupervisorEventType** `type` L22 — `export type SupervisorEventType = | "WATCH_STARTED" | "WATCH_STOPPED" | "STATE_CHANGED" | "STUCK_DETECTED" | "WORKER_MESSAGE_RELAYED" | "PL…`
- **SupervisorEvent** `interface` L61 — `export interface SupervisorEvent`
- **RuntimeEvent** `interface` L71 — `export interface RuntimeEvent`
- **SupervisorLogger** `interface` L79 — `export interface SupervisorLogger`
- **MemorySupervisorLogger** `class` L84 — `export class MemorySupervisorLogger implements SupervisorLogger`
- **defaultSupervisorLogPath** `const` L96 — `export const defaultSupervisorLogPath = () => resolve("logs", "supervisor.ndjson")`
- **JsonLineSupervisorLogger** `class` L98 — `export class JsonLineSupervisorLogger implements SupervisorLogger`

#### `src/supervisor/index.ts`
_Supervisor / observation loop exports._

- **classify** `re-export` L7 (from `./classifier.js`) — `export {`
- **emptyCycleContext** `re-export` L7 (from `./classifier.js`) — `export {`
- **DEFAULT_STUCK_AFTER_MS** `re-export` L7 (from `./classifier.js`) — `export {`
- **ClassifyInput** `re-export` L7 (from `./classifier.js`) — `export {`
- **ClassifyOptions** `re-export` L7 (from `./classifier.js`) — `export {`
- **Classification** `re-export` L7 (from `./classifier.js`) — `export {`
- **CycleContext** `re-export` L7 (from `./classifier.js`) — `export {`
- **JsonLineSupervisorLogger** `re-export` L16 (from `./events.js`) — `export {`
- **MemorySupervisorLogger** `re-export` L16 (from `./events.js`) — `export {`
- **defaultSupervisorLogPath** `re-export` L16 (from `./events.js`) — `export {`
- **SupervisorEvent** `re-export` L16 (from `./events.js`) — `export {`
- **SupervisorEventType** `re-export` L16 (from `./events.js`) — `export {`
- **SupervisorLogger** `re-export` L16 (from `./events.js`) — `export {`
- **collectObservation** `re-export` L24 (from `./observation.js`) — `export { collectObservation, makeObservationClock } from "./observation.js"`
- **makeObservationClock** `re-export` L24 (from `./observation.js`) — `export { collectObservation, makeObservationClock } from "./observation.js"`
- **decideRelays** `re-export` L25 (from `./policy.js`) — `export { decideRelays, type PolicyInput, type RelayDecisions, type SuperviseMode } from "./policy.js"`
- **PolicyInput** `re-export` L25 (from `./policy.js`) — `export { decideRelays, type PolicyInput, type RelayDecisions, type SuperviseMode } from "./policy.js"`
- **RelayDecisions** `re-export` L25 (from `./policy.js`) — `export { decideRelays, type PolicyInput, type RelayDecisions, type SuperviseMode } from "./policy.js"`
- **SuperviseMode** `re-export` L25 (from `./policy.js`) — `export { decideRelays, type PolicyInput, type RelayDecisions, type SuperviseMode } from "./policy.js"`
- **isBusyState** `re-export` L26 (from `./state.js`) — `export { isBusyState, isSupervisorState, isTerminalFailure, SUPERVISOR_STATES } from "./state.js"`
- **isSupervisorState** `re-export` L26 (from `./state.js`) — `export { isBusyState, isSupervisorState, isTerminalFailure, SUPERVISOR_STATES } from "./state.js"`
- **isTerminalFailure** `re-export` L26 (from `./state.js`) — `export { isBusyState, isSupervisorState, isTerminalFailure, SUPERVISOR_STATES } from "./state.js"`
- **SUPERVISOR_STATES** `re-export` L26 (from `./state.js`) — `export { isBusyState, isSupervisorState, isTerminalFailure, SUPERVISOR_STATES } from "./state.js"`
- **Supervisor** `re-export` L27 (from `./supervisor.js`) — `export {`
- **DEFAULT_POLL_INTERVAL_MS** `re-export` L27 (from `./supervisor.js`) — `export {`
- **buildCycle** `re-export` L27 (from `./supervisor.js`) — `export {`
- **SupervisorDeps** `re-export` L27 (from `./supervisor.js`) — `export {`
- **SupervisorReport** `re-export` L27 (from `./supervisor.js`) — `export {`

#### `src/supervisor/observation.ts`
_Observation / event correlation utilities._

- **makeObservationClock** `function` L16 — `export function makeObservationClock(): () => Date`
- **collectObservation** `function` L20 — `export async function collectObservation( pair: SessionPair, worker: OpenCodeSessionManager, planner: ChatGPTBrowserAdapter, clock: () => D…`
- **observeWorkerSession** `function` L39 — `export async function observeWorkerSession(pair: SessionPair, worker: OpenCodeSessionManager): Promise<WorkerObservation>`
- **observePlannerConversation** `function` L43 — `export async function observePlannerConversation(pair: SessionPair, planner: ChatGPTBrowserAdapter): Promise<PlannerObservation>`

#### `src/supervisor/policy.ts`
_Source module for policy.ts._

- **SuperviseMode** `type` L10 — `export type SuperviseMode = "observe" | "relay"`
- **RelayDecisions** `interface` L12 — `export interface RelayDecisions`
- **PolicyInput** `interface` L17 — `export interface PolicyInput`
- **decideRelays** `function` L26 — `export function decideRelays(input: PolicyInput): RelayDecisions`

#### `src/supervisor/state.ts`
_Source module for state.ts._

- **SUPERVISOR_STATES** `const` L9 — `export const SUPERVISOR_STATES: readonly SupervisorState[] = [ "READY", "WORKING", "WAITING_PLANNER", "WAITING_WORKER", "IDLE", "COMPLETED"…`
- **isBusyState** `function` L23 — `export function isBusyState(state: SupervisorState | undefined): boolean`
- **isTerminalFailure** `function` L27 — `export function isTerminalFailure(state: SupervisorState): boolean`
- **isSupervisorState** `function` L31 — `export function isSupervisorState(value: string): value is SupervisorState`

#### `src/supervisor/supervisor.ts`
_Source module for supervisor.ts._

- **DEFAULT_POLL_INTERVAL_MS** `const` L46 — `export const DEFAULT_POLL_INTERVAL_MS = 5_000`
- **SupervisorRecoveryOptions** `interface` L48 — `export interface SupervisorRecoveryOptions`
- **SupervisorDeps** `interface` L57 — `export interface SupervisorDeps`
- **SupervisorReport** `interface` L75 — `export interface SupervisorReport`
- **Supervisor** `class` L100 — `export class Supervisor`
- **buildCycle** `function` L774 — `export function buildCycle( store: RelayStore, pairId: string, snapshot: ObservationSnapshot, continuity: SupervisorContinuity ): CycleCont…`
- **WorkerRelayStability** `interface` L819 — `export interface WorkerRelayStability`
- **computeWorkerRelayStability** `function` L826 — `export function computeWorkerRelayStability(input: { continuity: SupervisorContinuity; snapshot: ObservationSnapshot; nowIso: string; stabi…`

### recovery

#### `src/recovery/browser.ts`
_Source module for browser.ts._

- **BrowserStatus** `interface` L9 — `export interface BrowserStatus`
- **BrowserManager** `interface` L15 — `export interface BrowserManager`
- **ExternalBrowserManager** `class` L25 — `export class ExternalBrowserManager implements BrowserManager`
- **ManagedBrowserHandle** `interface` L50 — `export interface ManagedBrowserHandle`
- **ManagedBrowserLens** `interface` L54 — `export interface ManagedBrowserLens`
- **ManagedBrowserManager** `class` L58 — `export class ManagedBrowserManager implements BrowserManager`
- **browserManagerFor** `function` L106 — `export function browserManagerFor( config: { cdpUrl?: string; executablePath?: string } | undefined, lens?: ManagedBrowserLens ): BrowserMa…`

#### `src/recovery/chatgpt.ts`
_Source module for chatgpt.ts._

- **ChatGPTRecoveryOutcome** `type` L14 — `export type ChatGPTRecoveryOutcome = |`
- **ChatGPTRecoveryInput** `interface` L18 — `export interface ChatGPTRecoveryInput`
- **recoverChatGPT** `function` L27 — `export async function recoverChatGPT(input: ChatGPTRecoveryInput): Promise<ChatGPTRecoveryOutcome>`

#### `src/recovery/engine.ts`
_Source module for engine.ts._

- **RecoveryEngineDeps** `interface` L25 — `export interface RecoveryEngineDeps`
- **RecoveryRunResult** `interface` L44 — `export interface RecoveryRunResult`
- **RecoveryEngine** `class` L62 — `export class RecoveryEngine`

#### `src/recovery/index.ts`
_Recovery engine exports._

- **browserManagerFor** `re-export` L7 (from `./browser.js`) — `export {`
- **ExternalBrowserManager** `re-export` L7 (from `./browser.js`) — `export {`
- **ManagedBrowserManager** `re-export` L7 (from `./browser.js`) — `export {`
- **BrowserManager** `re-export` L7 (from `./browser.js`) — `export {`
- **BrowserStatus** `re-export` L7 (from `./browser.js`) — `export {`
- **ManagedBrowserHandle** `re-export` L7 (from `./browser.js`) — `export {`
- **ManagedBrowserLens** `re-export` L7 (from `./browser.js`) — `export {`
- **recoverChatGPT** `re-export` L16 (from `./chatgpt.js`) — `export { recoverChatGPT, type ChatGPTRecoveryOutcome } from "./chatgpt.js"`
- **ChatGPTRecoveryOutcome** `re-export` L16 (from `./chatgpt.js`) — `export { recoverChatGPT, type ChatGPTRecoveryOutcome } from "./chatgpt.js"`
- **RecoveryEngine** `re-export` L17 (from `./engine.js`) — `export { RecoveryEngine, type RecoveryRunResult, type RecoveryEngineDeps } from "./engine.js"`
- **RecoveryRunResult** `re-export` L17 (from `./engine.js`) — `export { RecoveryEngine, type RecoveryRunResult, type RecoveryEngineDeps } from "./engine.js"`
- **RecoveryEngineDeps** `re-export` L17 (from `./engine.js`) — `export { RecoveryEngine, type RecoveryRunResult, type RecoveryEngineDeps } from "./engine.js"`
- **recoverOpenCode** `re-export` L18 (from `./opencode.js`) — `export { recoverOpenCode, type OpenCodeRecoveryOutcome } from "./opencode.js"`
- **OpenCodeRecoveryOutcome** `re-export` L18 (from `./opencode.js`) — `export { recoverOpenCode, type OpenCodeRecoveryOutcome } from "./opencode.js"`
- **DEFAULT_RECOVERY_POLICY** `re-export` L19 (from `./policy.js`) — `export { DEFAULT_RECOVERY_POLICY, recoveryActionForState, isRecoveryPolicy, type RecoveryAction } from "./policy.js"`
- **recoveryActionForState** `re-export` L19 (from `./policy.js`) — `export { DEFAULT_RECOVERY_POLICY, recoveryActionForState, isRecoveryPolicy, type RecoveryAction } from "./policy.js"`
- **isRecoveryPolicy** `re-export` L19 (from `./policy.js`) — `export { DEFAULT_RECOVERY_POLICY, recoveryActionForState, isRecoveryPolicy, type RecoveryAction } from "./policy.js"`
- **RecoveryAction** `re-export` L19 (from `./policy.js`) — `export { DEFAULT_RECOVERY_POLICY, recoveryActionForState, isRecoveryPolicy, type RecoveryAction } from "./policy.js"`
- **abortError** `re-export` L20 (from `./schedule.js`) — `export { abortError, DEFAULT_BACKOFF_POLICY, delayForAttempt, interruptibleSleep, type BackoffPolicy } from "./schedule.js"`
- **DEFAULT_BACKOFF_POLICY** `re-export` L20 (from `./schedule.js`) — `export { abortError, DEFAULT_BACKOFF_POLICY, delayForAttempt, interruptibleSleep, type BackoffPolicy } from "./schedule.js"`
- **delayForAttempt** `re-export` L20 (from `./schedule.js`) — `export { abortError, DEFAULT_BACKOFF_POLICY, delayForAttempt, interruptibleSleep, type BackoffPolicy } from "./schedule.js"`
- **interruptibleSleep** `re-export` L20 (from `./schedule.js`) — `export { abortError, DEFAULT_BACKOFF_POLICY, delayForAttempt, interruptibleSleep, type BackoffPolicy } from "./schedule.js"`
- **BackoffPolicy** `re-export` L20 (from `./schedule.js`) — `export { abortError, DEFAULT_BACKOFF_POLICY, delayForAttempt, interruptibleSleep, type BackoffPolicy } from "./schedule.js"`
- **humanReason** `re-export` L21 (from `./reasons.js`) — `export { humanReason } from "./reasons.js"`

#### `src/recovery/opencode.ts`
_Source module for opencode.ts._

- **OpenCodeServerLauncher** `type` L12 — `export type OpenCodeServerLauncher = (repoPath: string, baseUrl: string) => Promise<`
- **OpenCodeRecoveryInput** `interface` L14 — `export interface OpenCodeRecoveryInput`
- **OpenCodeStartOutcome** `interface` L29 — `export interface OpenCodeStartOutcome`
- **OpenCodeRecoveryOutcome** `type` L35 — `export type OpenCodeRecoveryOutcome = |`
- **recoverOpenCode** `function` L39 — `export async function recoverOpenCode( input: OpenCodeRecoveryInput ): Promise<OpenCodeRecoveryOutcome>`

#### `src/recovery/policy.ts`
_Source module for policy.ts._

- **DEFAULT_RECOVERY_POLICY** `const` L9 — `export const DEFAULT_RECOVERY_POLICY: RecoveryPolicy = "safe"`
- **RecoveryAction** `type` L11 — `export type RecoveryAction = | "none" | "reconnect-transport" | "relaunch-browser" | "reopen-conversation" | "reobserve-session" | "verify-…`
- **isRecoveryPolicy** `function` L20 — `export function isRecoveryPolicy(value: unknown): value is RecoveryPolicy`
- **recoveryActionForState** `function` L24 — `export function recoveryActionForState(state: SupervisorState | undefined): RecoveryAction`

#### `src/recovery/reasons.ts`
_Source module for reasons.ts._

- **humanReason** `function` L9 — `export function humanReason(code: RecoveryErrorCode): string`

#### `src/recovery/schedule.ts`
_Source module for schedule.ts._

- **BackoffPolicy** `interface` L7 — `export interface BackoffPolicy`
- **DEFAULT_BACKOFF_POLICY** `const` L12 — `export const DEFAULT_BACKOFF_POLICY: BackoffPolicy =`
- **delayForAttempt** `function` L16 — `export function delayForAttempt(attempt: number, policy: BackoffPolicy = DEFAULT_BACKOFF_POLICY): number`
- **abortError** `function` L23 — `export function abortError(): Error`
- **interruptibleSleep** `function` L27 — `export function interruptibleSleep(milliseconds: number, signal?: AbortSignal): Promise<void>`

### runtime

#### `src/runtime/adapters.ts`
_Adapter registry / factory._

- **RuntimeAdapterOptions** `interface` L20 — `export interface RuntimeAdapterOptions`
- **PairAdapters** `interface` L28 — `export interface PairAdapters`
- **createPairAdapters** `function` L34 — `export function createPairAdapters(pair: SessionPair, options: RuntimeAdapterOptions = {}): PairAdapters`
- **browserLockKey** `function` L56 — `export function browserLockKey(pair: SessionPair): string`

#### `src/runtime/index.ts`
_Pair runtime orchestration exports._

- **RuntimeError** `re-export` L7 (from `./orchestrator.js`) — `export {`
- **RuntimeOrchestrator** `re-export` L7 (from `./orchestrator.js`) — `export {`
- **isHealthyRuntime** `re-export` L7 (from `./orchestrator.js`) — `export {`
- **isFailedRuntime** `re-export` L7 (from `./orchestrator.js`) — `export {`
- **RuntimeOrchestratorOptions** `re-export` L7 (from `./orchestrator.js`) — `export {`
- **RuntimeStatusSummary** `re-export` L7 (from `./orchestrator.js`) — `export {`
- **PairRuntime** `re-export` L15 (from `./pair-runtime.js`) — `export { PairRuntime, type PairRuntimeOptions, type PairRuntimeStatusSet } from "./pair-runtime.js"`
- **PairRuntimeOptions** `re-export` L15 (from `./pair-runtime.js`) — `export { PairRuntime, type PairRuntimeOptions, type PairRuntimeStatusSet } from "./pair-runtime.js"`
- **PairRuntimeStatusSet** `re-export` L15 (from `./pair-runtime.js`) — `export { PairRuntime, type PairRuntimeOptions, type PairRuntimeStatusSet } from "./pair-runtime.js"`
- **PairRegistry** `re-export` L16 (from `./registry.js`) — `export { PairRegistry, RegistryError, validateUnique } from "./registry.js"`
- **RegistryError** `re-export` L16 (from `./registry.js`) — `export { PairRegistry, RegistryError, validateUnique } from "./registry.js"`
- **validateUnique** `re-export` L16 (from `./registry.js`) — `export { PairRegistry, RegistryError, validateUnique } from "./registry.js"`
- **FifoMutex** `re-export` L17 (from `./scheduler.js`) — `export { FifoMutex, LockRegistry, interruptibleSleep, type SleepFn } from "./scheduler.js"`
- **LockRegistry** `re-export` L17 (from `./scheduler.js`) — `export { FifoMutex, LockRegistry, interruptibleSleep, type SleepFn } from "./scheduler.js"`
- **interruptibleSleep** `re-export` L17 (from `./scheduler.js`) — `export { FifoMutex, LockRegistry, interruptibleSleep, type SleepFn } from "./scheduler.js"`
- **SleepFn** `re-export` L17 (from `./scheduler.js`) — `export { FifoMutex, LockRegistry, interruptibleSleep, type SleepFn } from "./scheduler.js"`
- **MultiSinkSupervisorLogger** `re-export` L18 (from `./logging.js`) — `export { MultiSinkSupervisorLogger, defaultPerPairLogRoot } from "./logging.js"`
- **defaultPerPairLogRoot** `re-export` L18 (from `./logging.js`) — `export { MultiSinkSupervisorLogger, defaultPerPairLogRoot } from "./logging.js"`
- **WakeBus** `re-export` L19 (from `./wake-bus.js`) — `export { WakeBus, type WakeSignal, type WakeSubscriber } from "./wake-bus.js"`
- **WakeSignal** `re-export` L19 (from `./wake-bus.js`) — `export { WakeBus, type WakeSignal, type WakeSubscriber } from "./wake-bus.js"`
- **WakeSubscriber** `re-export` L19 (from `./wake-bus.js`) — `export { WakeBus, type WakeSignal, type WakeSubscriber } from "./wake-bus.js"`
- **createPairAdapters** `re-export` L20 (from `./adapters.js`) — `export { createPairAdapters, browserLockKey, type PairAdapters, type RuntimeAdapterOptions } from "./adapters.js"`
- **browserLockKey** `re-export` L20 (from `./adapters.js`) — `export { createPairAdapters, browserLockKey, type PairAdapters, type RuntimeAdapterOptions } from "./adapters.js"`
- **PairAdapters** `re-export` L20 (from `./adapters.js`) — `export { createPairAdapters, browserLockKey, type PairAdapters, type RuntimeAdapterOptions } from "./adapters.js"`
- **RuntimeAdapterOptions** `re-export` L20 (from `./adapters.js`) — `export { createPairAdapters, browserLockKey, type PairAdapters, type RuntimeAdapterOptions } from "./adapters.js"`
- **(anonymous)** `type` L21 — `export type`

#### `src/runtime/logging.ts`
_Source module for logging.ts._

- **defaultPerPairLogRoot** `const` L11 — `export const defaultPerPairLogRoot = () => resolve("logs", "pairs")`
- **MultiSinkSupervisorLogger** `class` L13 — `export class MultiSinkSupervisorLogger implements SupervisorLogger`

#### `src/runtime/orchestrator.ts`
_Source module for orchestrator.ts._

- **RuntimeError** `class` L19 — `export class RuntimeError extends Error`
- **RuntimeOrchestratorOptions** `interface` L26 — `export interface RuntimeOrchestratorOptions`
- **RuntimeStatusSummary** `interface` L44 — `export interface RuntimeStatusSummary`
- **OrchestratorEvent** `type` L53 — `export type OrchestratorEvent = RuntimeEvent | SupervisorEvent`
- **RuntimeOrchestrator** `class` L55 — `export class RuntimeOrchestrator`
- **isHealthyRuntime** `function` L328 — `export function isHealthyRuntime(status: RuntimePairStatus): boolean`
- **isFailedRuntime** `function` L339 — `export function isFailedRuntime(status: RuntimePairStatus): boolean`

#### `src/runtime/pair-runtime.ts`
_Per-pair concurrent runtime supervisor._

- **PairRuntimeOptions** `interface` L29 — `export interface PairRuntimeOptions`
- **PairRuntimeStatusSet** `interface` L51 — `export interface PairRuntimeStatusSet`
- **PairRuntime** `class` L60 — `export class PairRuntime`

#### `src/runtime/registry.ts`
_Source module for registry.ts._

- **RegistryError** `class` L9 — `export class RegistryError extends Error`
- **PairRegistry** `class` L19 — `export class PairRegistry`
- **validateUnique** `function` L62 — `export function validateUnique( pairId: string, sessionId: string, conversationId: string, existing: ReadonlyMap<string, SessionPair> ): vo…`

#### `src/runtime/scheduler.ts`
_Source module for scheduler.ts._

- **FifoMutex** `re-export` L14 (from `../util/async.js`) — `export { FifoMutex, LockRegistry, interruptibleSleep, type SleepFn } from "../util/async.js"`
- **LockRegistry** `re-export` L14 (from `../util/async.js`) — `export { FifoMutex, LockRegistry, interruptibleSleep, type SleepFn } from "../util/async.js"`
- **interruptibleSleep** `re-export` L14 (from `../util/async.js`) — `export { FifoMutex, LockRegistry, interruptibleSleep, type SleepFn } from "../util/async.js"`
- **SleepFn** `re-export` L14 (from `../util/async.js`) — `export { FifoMutex, LockRegistry, interruptibleSleep, type SleepFn } from "../util/async.js"`

#### `src/runtime/wake-bus.ts`
_Source module for wake-bus.ts._

- **WakeSignal** `interface` L7 — `export interface WakeSignal`
- **WakeSubscriber** `type` L16 — `export type WakeSubscriber = (signal: WakeSignal) => void`
- **WakeBus** `class` L18 — `export class WakeBus`

### application

#### `src/application/advisor-provider.ts`
_Source module for advisor-provider.ts._

- **AttentionAdvisorProvider** `interface` L12 — `export interface AttentionAdvisorProvider`

#### `src/application/attention-parser.ts`
_Source module for attention-parser.ts._

- **parseWorkerAttentionEnvelope** `function` L23 — `export function parseWorkerAttentionEnvelope(text: string): WorkerAttentionEnvelope | undefined`

#### `src/application/attention-service.ts`
_Source module for attention-service.ts._

- **AttentionServiceOptions** `interface` L12 — `export interface AttentionServiceOptions`
- **AttentionService** `class` L17 — `export class AttentionService`

#### `src/application/automation-governor.ts`
_Source module for automation-governor.ts._

- **AutomationGovernorOptions** `interface` L12 — `export interface AutomationGovernorOptions`
- **AutomationGovernorState** `interface` L19 — `export interface AutomationGovernorState`
- **AutomationGovernor** `class` L28 — `export class AutomationGovernor`

#### `src/application/bounded-context-assembler.ts`
_Source module for bounded-context-assembler.ts._

- **buildBoundedContext** `function` L10 — `export function buildBoundedContext( service: DesktopApplicationService, pairId: string, attentionKind: "question" | "blocked", attentionId…`

#### `src/application/control-plane-adapter.ts`
_Control-plane adapter for worker/planner pairs._

- **ControlPlaneAdapter** `class` L29 — `export class ControlPlaneAdapter`
- **SafeRemoteEvent** `interface` L377 — `export interface SafeRemoteEvent`
- **ControlPlaneOperationError** `class` L386 — `export class ControlPlaneOperationError extends Error`

#### `src/application/desktop-lifecycle.ts`
_Source module for desktop-lifecycle.ts._

- **DesktopLifecycleState** `type` L51 — `export type DesktopLifecycleState = "initializing" | "ready" | "failed" | "shutting-down" | "stopped"`
- **DesktopBootResult** `type` L53 — `export type DesktopBootResult = |`
- **DesktopLifecycleService** `interface` L58 — `export interface DesktopLifecycleService`
- **DisposableWorkerProgress** `interface` L64 — `export interface DisposableWorkerProgress`
- **DesktopLifecycleHooks** `interface` L68 — `export interface DesktopLifecycleHooks`
- **DesktopLifecycle** `class` L91 — `export class DesktopLifecycle`

#### `src/application/desktop-service.ts`
_Electron desktop service integration._

- **DesktopServiceOptions** `interface` L37 — `export interface DesktopServiceOptions`
- **DesktopEventRecord** `type` L70 — `export type DesktopEventRecord = EventRecord`
- **ProjectLifecycleSummary** `interface` L72 — `export interface ProjectLifecycleSummary extends RuntimeStatusSummary`
- **(anonymous)** `type` L100 — `export type`
- **DesktopApplicationError** `class` L124 — `export class DesktopApplicationError extends Error`
- **toDesktopApplicationError** `function` L136 — `export function toDesktopApplicationError(error: unknown): DesktopApplicationError`
- **RecentEventsFilter** `interface` L161 — `export interface RecentEventsFilter`
- **DesktopApplicationService** `class` L166 — `export class DesktopApplicationService`
- **fingerprintPairs** `function` L1354 — `export function fingerprintPairs(pairs: SessionPair[]): string`
- **ManagedState** `type` L1394 — `export type ManagedState = "RUNNING" | "ARMED" | "FAILED" | "STOPPED"`
- **deriveManagedState** `function` L1396 — `export function deriveManagedState(summary: RuntimeStatusSummary): ManagedState`

#### `src/application/desktop-tool-manager.ts`
_Desktop tool launcher — spawns/attaches an external Chrome (CDP) and `opencode serve` for the Electron shell._

- **ToolLaunchResult** `interface` L14 — `export interface ToolLaunchResult`
- **ToolActionResult** `interface` L23 — `export interface ToolActionResult`
- **OpenCodeToolInput** `interface` L28 — `export interface OpenCodeToolInput`
- **BrowserToolInput** `interface` L33 — `export interface BrowserToolInput`
- **DesktopToolLauncher** `interface` L37 — `export interface DesktopToolLauncher`
- **DesktopToolError** `class` L45 — `export class DesktopToolError extends Error`
- **LocalDesktopToolLauncher** `class` L57 — `export class LocalDesktopToolLauncher implements DesktopToolLauncher`

#### `src/application/event-log.ts`
_Source module for event-log.ts._

- **EventLogOptions** `interface` L9 — `export interface EventLogOptions`
- **RecordEventOptions** `interface` L15 — `export interface RecordEventOptions`
- **EventLog** `class` L35 — `export class EventLog`

#### `src/application/headless-service.ts`
_Source module for headless-service.ts._

- **HeadlessServiceOptions** `interface` L18 — `export interface HeadlessServiceOptions`
- **HeadlessService** `class` L27 — `export class HeadlessService`

#### `src/application/local-agent-planner-prompt.ts`
_Source module for local-agent-planner-prompt.ts._

- **LOCAL_AGENT_PLANNER_PROMPT_VERSION** `const` L7 — `export const LOCAL_AGENT_PLANNER_PROMPT_VERSION = "1"`
- **LOCAL_AGENT_PLANNER_PROMPT** `const` L9 — `export const LOCAL_AGENT_PLANNER_PROMPT = `You are the planning and supervision agent for an autonomous software-development relay. A codin…`

#### `src/application/ollama-adapter.ts`
_Source module for ollama-adapter.ts._

- **OllamaAdvisorOptions** `interface` L10 — `export interface OllamaAdvisorOptions`
- **OllamaAdvisorProvider** `class` L17 — `export class OllamaAdvisorProvider implements AttentionAdvisorProvider`

#### `src/application/pair-config-repository.ts`
_Source module for pair-config-repository.ts._

- **PairConfigErrorCode** `type` L13 — `export type PairConfigErrorCode = | "CONFIG_UNREADABLE" | "CONFIG_INVALID" | "CONFIG_UNWRITABLE" | "PAIR_NOT_FOUND" | "PAIR_ALREADY_EXISTS"…`
- **PairConfigError** `class` L23 — `export class PairConfigError extends Error`
- **PairEdits** `interface` L33 — `export interface PairEdits`
- **PairConfigRepository** `class` L49 — `export class PairConfigRepository`

#### `src/application/planner-seeding-service.ts`
_Source module for planner-seeding-service.ts._

- **PlannerSeedingContext** `interface` L27 — `export interface PlannerSeedingContext`
- **PlannerSeedingService** `class` L44 — `export class PlannerSeedingService`

#### `src/application/project-pair-repository.ts`
_Project-pair identity / ownership service._

- **ProjectPairConfigErrorCode** `type` L13 — `export type ProjectPairConfigErrorCode = | "CONFIG_UNREADABLE" | "CONFIG_INVALID" | "CONFIG_UNWRITABLE" | "PROJECT_PAIR_NOT_FOUND" | "PROJE…`
- **ProjectPairRepositoryError** `class` L21 — `export class ProjectPairRepositoryError extends Error`
- **ProjectPairRepository** `class` L39 — `export class ProjectPairRepository`

#### `src/application/project-pair-service.ts`
_Project-pair identity / ownership service._

- **ProjectPairServiceOptions** `interface` L29 — `export interface ProjectPairServiceOptions`
- **CreateProjectPairInput** `interface` L38 — `export interface CreateProjectPairInput`
- **OpenCodeProjectDiscovery** `interface` L50 — `export interface OpenCodeProjectDiscovery`
- **ProjectPairService** `class` L65 — `export class ProjectPairService`
- **suggestProjectPairId** `function` L271 — `export function suggestProjectPairId(repoPath: string, projectSlug: string): string`

#### `src/application/relay-engine.ts`
_Source module for relay-engine.ts._

- **RelayEngineOptions** `interface` L11 — `export interface RelayEngineOptions`
- **RelayEngine** `class` L28 — `export class RelayEngine`

#### `src/application/universal-planner-prompt.ts`
_Source module for universal-planner-prompt.ts._

- **UNIVERSAL_PLANNER_PROMPT_VERSION** `const` L7 — `export const UNIVERSAL_PLANNER_PROMPT_VERSION = "1"`
- **UNIVERSAL_PLANNER_PROMPT** `const` L9 — `export const UNIVERSAL_PLANNER_PROMPT = `You are the autonomous planning and supervision agent for this software project. An OpenCode worke…`

#### `src/application/worker-attention-protocol.ts`
_Source module for worker-attention-protocol.ts._

- **ATTENTION_PROTOCOL_VERSION** `const` L13 — `export const ATTENTION_PROTOCOL_VERSION = "1"`
- **ATTENTION_PROTOCOL_INSTRUCTION** `const` L15 — `export const ATTENTION_PROTOCOL_INSTRUCTION = ` Agent attention protocol (v${ATTENTION_PROTOCOL_VERSION}): When your response requires plan…`

#### `src/application/worker-progress.ts`
_Worker progress tracking service._

- **WorkerProgressServiceOptions** `interface` L23 — `export interface WorkerProgressServiceOptions`
- **WorkerProgressService** `class` L68 — `export class WorkerProgressService`

#### `src/application/worker-question-service.ts`
_Source module for worker-question-service.ts._

- **WorkerQuestionService** `class` L12 — `export class WorkerQuestionService`

#### `src/application/worker-session-service.ts`
_Worker session management service._

- **WorkerSessionContext** `interface` L34 — `export interface WorkerSessionContext`
- **WorkerSessionService** `class` L68 — `export class WorkerSessionService`

#### `src/application/worker-transcript-service.ts`
_Worker transcript / session summary service._

- **readWorkerTranscript** `function` L14 — `export async function readWorkerTranscript(pair: SessionPair, options: OpenCodeClientOptions = {}): Promise<WorkerTranscript>`

### remote

#### `src/remote/remote-server.ts`
_Optional HTTP control API (service start only)._

- **RemoteTimelineEntry** `interface` L12 — `export interface RemoteTimelineEntry`
- **RemoteServiceOptions** `interface` L23 — `export interface RemoteServiceOptions`
- **RemoteResponse** `type` L44 — `export type RemoteResponse = |`
- **createRemoteServer** `function` L130 — `export function createRemoteServer(options: RemoteServiceOptions):`

### util

#### `src/util/async.ts`
_Async primitives (timeout, retry, bounded backoff)._

- **SleepFn** `type` L12 — `export type SleepFn = (ms: number, signal?: AbortSignal) => Promise<void>`
- **interruptibleSleep** `function` L14 — `export function interruptibleSleep(ms: number, signal?: AbortSignal): Promise<void>`
- **FifoMutex** `class` L41 — `export class FifoMutex`
- **LockRegistry** `class` L59 — `export class LockRegistry`

#### `src/util/canonical.ts`
_Canonicalization helpers (URL, identity, hash)._

- **canonicalizeText** `function` L13 — `export function canonicalizeText(text: string): string`
- **hashText** `function` L22 — `export function hashText(text: string): string`

#### `src/util/net.ts`
_Source module for net.ts._

- **normalizeHostname** `function` L14 — `export function normalizeHostname(hostname: string): string`
- **isLoopbackHostname** `function` L18 — `export function isLoopbackHostname(hostname: string): boolean`
- **isHttpUrl** `function` L23 — `export function isHttpUrl(value: string): boolean`
- **credentialsAllowed** `function` L39 — `export function credentialsAllowed(url: string, allowInsecureAuth?: boolean): boolean`

#### `src/util/readiness.ts`
_Readiness checks for worker/planner pairs._

- **readinessCheck** `function` L13 — `export function readinessCheck(name: string, status: CheckStatus, reason: string): ReadinessCheck`
- **pass** `function` L17 — `export function pass(name: string, reason = "OK"): ReadinessCheck`
- **fail** `function` L21 — `export function fail(name: string, reason: string): ReadinessCheck`

### core

#### `src/index.ts`
_Module exports for src._

- _(no exported symbols)_

#### `src/service-entry.ts`
_Source module for service-entry.ts._

- _(no exported symbols)_

#### `src/sessions/chatgpt-url.ts`
_Source module for chatgpt-url.ts._

- **ChatGptUrlErrorCode** `type` L7 — `export type ChatGptUrlErrorCode = | "INVALID_URL" | "NOT_CHATGPT_HOST" | "MISSING_CONVERSATION_SEGMENT" | "MISSING_CONVERSATION_ID"`
- **ChatGptUrlError** `class` L13 — `export class ChatGptUrlError extends Error`
- **ParsedChatGptConversation** `interface` L23 — `export interface ParsedChatGptConversation`
- **parseChatGptConversationUrl** `function` L40 — `export function parseChatGptConversationUrl(input: string): ParsedChatGptConversation`
- **conversationUrlMatchesId** `function` L88 — `export function conversationUrlMatchesId(input: string, conversationId: string): boolean`

#### `src/sessions/pairs.ts`
_Source module for pairs.ts._

- **ConfigError** `class` L107 — `export class ConfigError extends Error`
- **loadPairsConfig** `function` L117 — `export async function loadPairsConfig(configPath: string): Promise<PairsConfig>`
- **bindOpenCodeSession** `function` L138 — `export async function bindOpenCodeSession( configPath: string, pairId: string, sessionId: string ): Promise<PairsConfig>`
- **parsePairsConfig** `function` L169 — `export function parsePairsConfig(input: unknown): PairsConfig`
- **deriveChatGptConversationId** `function` L186 — `export function deriveChatGptConversationId(conversationUrl: string): string | undefined`

#### `src/sessions/project-pairs.ts`
_Project-pair identity / ownership service._

- **chatGptProjectSlugPattern** `const` L17 — `export const chatGptProjectSlugPattern = /^g-p-[A-Za-z0-9_-]+$/`
- **ProjectPairConfigError** `class` L79 — `export class ProjectPairConfigError extends Error`
- **parseProjectPairsConfig** `function` L89 — `export function parseProjectPairsConfig(input: unknown): ProjectPairsConfig`

#### `src/types.ts`
_Source module for types.ts._

- **WorkerAdapterType** `type` L7 — `export type WorkerAdapterType = "opencode"`
- **PlannerAdapterType** `type` L8 — `export type PlannerAdapterType = "chatgpt-browser"`
- **CheckStatus** `type` L10 — `export type CheckStatus = "PASS" | "FAIL"`
- **ReadinessStatus** `type` L11 — `export type ReadinessStatus = "READY" | "NOT_READY"`
- **ReadinessCheck** `interface` L13 — `export interface ReadinessCheck`
- **ReadinessOverrides** `type` L20 — `export type ReadinessOverrides = Record<string, boolean | string>`
- **OpenCodeServerConfig** `interface` L22 — `export interface OpenCodeServerConfig`
- **ChatGPTBrowserConfig** `interface` L31 — `export interface ChatGPTBrowserConfig`
- **WorkerIdentity** `interface` L39 — `export interface WorkerIdentity`
- **PlannerIdentity** `interface` L47 — `export interface PlannerIdentity`
- **OpenCodeModelRef** `interface` L59 — `export interface OpenCodeModelRef`
- **OpenCodeModelInfo** `interface` L64 — `export interface OpenCodeModelInfo extends OpenCodeModelRef`
- **SessionPair** `interface` L69 — `export interface SessionPair`
- **PairsConfig** `interface` L81 — `export interface PairsConfig`
- **ProjectPair** `interface` L90 — `export interface ProjectPair`
- **ProjectPairsConfig** `interface` L102 — `export interface ProjectPairsConfig`
- **PairReadinessReport** `interface` L106 — `export interface PairReadinessReport`
- **RelayableMessage** `interface` L113 — `export interface RelayableMessage`
- **RelayReceipt** `interface` L121 — `export interface RelayReceipt`
- **WorkerPromptState** `type` L134 — `export type WorkerPromptState = "PERSISTED" | "ADMITTED" | "PROMOTED" | "COMPLETED"`
- **RelayDirection** `type` L136 — `export type RelayDirection = "worker-to-planner" | "planner-to-worker"`
- **DeliveryStatus** `type` L138 — `export type DeliveryStatus = "DISCOVERED" | "DELIVERING" | "DELIVERED" | "FAILED"`
- **WorkerMessageClassification** `type` L141 — `export type WorkerMessageClassification = "report" | "question"`
- **WorkerQuestionNature** `type` L144 — `export type WorkerQuestionNature = "planner_input_required"`
- **CanonicalRelayIdentity** `interface` L146 — `export interface CanonicalRelayIdentity`
- **RelayRecord** `interface` L153 — `export interface RelayRecord`
- **PairRelayState** `interface` L170 — `export interface PairRelayState`
- **SupervisorState** `type` L180 — `export type SupervisorState = | "READY" | "WORKING" | "WAITING_PLANNER" | "WAITING_WORKER" | "IDLE" | "COMPLETED" | "WAITING_INPUT" | "STUC…`
- **WorkerObservation** `interface` L193 — `export interface WorkerObservation`
- **PlannerObservation** `interface` L209 — `export interface PlannerObservation`
- **ObservationSnapshot** `interface` L222 — `export interface ObservationSnapshot`
- **SupervisorContinuity** `interface` L229 — `export interface SupervisorContinuity`
- **RecoveryPolicy** `type` L255 — `export type RecoveryPolicy = "none" | "safe"`
- **RecoveryErrorCode** `type` L257 — `export type RecoveryErrorCode = | "OPENCODE_UNREACHABLE" | "OPENCODE_SESSION_MISSING" | "OPENCODE_REPO_MISMATCH" | "OPENCODE_TIMEOUT" | "CH…`
- **BrowserOwnership** `type` L271 — `export type BrowserOwnership = "external" | "managed"`
- **RecoveryMetadata** `interface` L273 — `export interface RecoveryMetadata`
- **PairRuntimeState** `type` L284 — `export type PairRuntimeState = "STOPPED" | "STARTING" | "RUNNING" | "PAUSED" | "STOPPING" | "ERROR"`
- **PeerHealth** `type` L286 — `export type PeerHealth = "connected" | "degraded" | "failed" | "unknown"`
- **PeerActivity** `type` L289 — `export type PeerActivity = "idle" | "working"`
- **PeerFailureReason** `type` L296 — `export type PeerFailureReason = "transport" | "session"`
- **RuntimePairStatus** `interface` L298 — `export interface RuntimePairStatus`
- **SchedulerMode** `type` L325 — `export type SchedulerMode = "ACTIVE" | "DORMANT_WATCH"`
- **RuntimeMetadata** `interface` L327 — `export interface RuntimeMetadata`
- **RelayCycleStatus** `type` L339 — `export type RelayCycleStatus = | "DISPATCHED" | "WORKER_RESPONDED" | "DELIVERED" | "FAILED"`
- **RelayCycle** `interface` L345 — `export interface RelayCycle`

## External dependencies (by import count)

| Package | Imported by |
|---|---:|
| `node:path` | 21 |
| `node:fs/promises` | 7 |
| `node:fs` | 5 |
| `node:crypto` | 5 |
| `node:os` | 4 |
| `playwright-core` | 2 |
| `node:child_process` | 2 |
| `node:http` | 2 |
| `zod` | 2 |
| `node:https` | 1 |
| `node:buffer` | 1 |
| `node:sqlite` | 1 |
