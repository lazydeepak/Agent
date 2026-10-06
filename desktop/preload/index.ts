import { contextBridge, ipcRenderer } from "electron";
import { ALLOWED_INVOKE_CHANNELS, EVENT_CHANNEL, IPC_CHANNELS, STATUS_REFRESH_CHANNEL, WORKER_PROGRESS_CHANNEL } from "../shared/ipc-channels.js";
import type {
  CandidatePairDto,
  ArchivedPairSummaryDto,
  AutomationInfoDto,
  ChatGptProjectDto,
  ChatGptProjectsDiscoveryInput,
  CreateOpenCodeSessionDto,
  CreateProjectPairDto,
  DesktopErrorDto,
  EndpointTestResultDto,
  EventRecordDto,
  OpenCodeEndpointDto,
  OpenCodeEndpointTestDto,
  OpenCodeProjectDto,
  OpenCodeSessionInfoDto,
  PairIdentityDto,
  PairStartPriming,
  ParsedChatGptUrlDto,
  PlannerEndpointDto,
  PlannerSeedResultDto,
  LocalAgentFeedResultDto,
  ProjectPairDto,
  RecentEventsFilterDto,
  StartOpenCodeServerDto,
  StatusSummaryDto,
  WorkerSessionOpenResultDto,
  ToolLaunchResultDto,
  ToolActionResultDto,
  UpdatePairDto,
  ValidationResultDto,
  WorkerModelDto,
  WorkerModelSwitchResultDto,
  SwitchWorkerModelDto
} from "../shared/dto.js";
import type { WorkerProgressDto } from "../shared/worker-progress.js";

interface RpcEnvelope<T> {
  ok: true;
  data: T;
}

interface RpcErrorEnvelope {
  ok: false;
  error: DesktopErrorDto;
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (!ALLOWED_INVOKE_CHANNELS.includes(channel)) {
    throw Object.assign(new Error(`IPC channel "${channel}" is not allowed.`), { code: "FORBIDDEN_CHANNEL" });
  }
  const result = (await ipcRenderer.invoke(channel, ...args)) as RpcEnvelope<T> | RpcErrorEnvelope;
  if (result && typeof result === "object" && "ok" in result) {
    if (result.ok) {
      return (result as RpcEnvelope<T>).data;
    }
    const error = (result as RpcErrorEnvelope).error;
    throw Object.assign(new Error(error.message), { code: error.code, details: error.details });
  }
  return result as T;
}

export interface DesktopApi {
  configPath: string;
  listPairs(): Promise<PairIdentityDto[]>;
  getStatus(): Promise<StatusSummaryDto>;
  getTimeline(pairId?: string, limit?: number): Promise<Array<{ time: string; pairId?: string; projectPairId?: string; type: string; state?: string; previousState?: string; reason?: string; details?: Record<string, unknown> }>>;
  getPairStatus(pairId: string): Promise<unknown>;
  getPairDetail(pairId: string): Promise<PairIdentityDto | undefined>;
  pausePair(pairId: string): Promise<StatusSummaryDto>;
  resumePair(pairId: string): Promise<StatusSummaryDto>;
  startPair(pairId: string, priming?: PairStartPriming): Promise<StatusSummaryDto>;
  stopPair(pairId: string): Promise<StatusSummaryDto>;
  startAll(): Promise<StatusSummaryDto>;
  stopAll(): Promise<StatusSummaryDto>;
  validatePair(pairId: string): Promise<ValidationResultDto>;
  getValidation(pairId: string): Promise<ValidationResultDto | undefined>;
  getRecentEvents(filter?: RecentEventsFilterDto): Promise<EventRecordDto[]>;
  getAutomationInfo(): Promise<AutomationInfoDto>;
  seedPlanner(pairId: string): Promise<PlannerSeedResultDto>;
  feedLocalAgent(pairId: string): Promise<LocalAgentFeedResultDto>;
  listOpenCodeSessions(pairId: string): Promise<unknown[]>;
  listWorkerQuestions(pairId: string): Promise<import("../../src/contracts/worker-question.js").WorkerQuestion[]>;
  getWorkerTranscript(pairId: string): Promise<import("../../src/contracts/worker-transcript.js").WorkerTranscript>;
  answerWorkerQuestion(pairId: string, input: { requestId: string; answers: string[][] }): Promise<{ answered: boolean }>;
  getOpenCodeEndpoint(): Promise<string>;
  getChatGptEndpoint(): Promise<string>;
  discoverWorkerSessions(input?: OpenCodeEndpointDto): Promise<OpenCodeSessionInfoDto[]>;
  scanDesktopWorkerSession(): Promise<OpenCodeSessionInfoDto>;
  alignWorkerSessionWithOpenCodeDesktop(pairId: string): Promise<{
    ok: boolean;
    boundSessionId: string;
    desktopSessionId: string;
    rebound: boolean;
    message: string;
  }>;
  startWorkerServer(input: StartOpenCodeServerDto): Promise<ToolLaunchResultDto>;
  updateOpenCode(): Promise<ToolActionResultDto>;
  createWorkerSession(input: CreateOpenCodeSessionDto): Promise<OpenCodeSessionInfoDto>;
  testWorkerEndpoint(input?: OpenCodeEndpointTestDto): Promise<EndpointTestResultDto>;
  parsePlannerUrl(input: { url: string }): Promise<ParsedChatGptUrlDto>;
  testPlannerEndpoint(input?: PlannerEndpointDto): Promise<EndpointTestResultDto>;
  startPlannerBrowser(input?: PlannerEndpointDto): Promise<ToolLaunchResultDto>;
  validateCandidate(input: CandidatePairDto): Promise<ValidationResultDto>;
  createPair(input: CandidatePairDto): Promise<PairIdentityDto>;
  updatePair(pairId: string, input: UpdatePairDto): Promise<PairIdentityDto>;
  removePair(pairId: string): Promise<{ pairId: string }>;
  rebindWorker(pairId: string, sessionId: string): Promise<PairIdentityDto>;
  suggestWorkerSessionTitle(pairId: string): Promise<string>;
  createWorkerSessionForPair(pairId: string, input?: { title?: string }): Promise<PairIdentityDto>;
  openWorkerSession(pairId: string): Promise<WorkerSessionOpenResultDto>;
  listWorkerModels(pairId: string): Promise<WorkerModelDto[]>;
  switchWorkerModel(pairId: string, input: SwitchWorkerModelDto): Promise<WorkerModelSwitchResultDto>;
  resumeWithFallbackModel(pairId: string, input: Pick<SwitchWorkerModelDto, "providerId" | "modelId">): Promise<StatusSummaryDto>;
  getWorkerProgress(pairId: string, forceRefresh?: boolean): Promise<WorkerProgressDto>;
  startProject(projectPairId: string): Promise<StatusSummaryDto>;
  resumeProject(projectPairId: string): Promise<StatusSummaryDto>;
  pauseProject(projectPairId: string): Promise<StatusSummaryDto>;
  listProjectPairs(): Promise<ProjectPairDto[]>;
  createProjectPair(input: CreateProjectPairDto): Promise<ProjectPairDto>;
  removeProjectPair(projectPairId: string): Promise<{ projectPairId: string }>;
  discoverOpenCodeProjects(): Promise<OpenCodeProjectDto[]>;
  discoverChatGptProjects(input?: ChatGptProjectsDiscoveryInput): Promise<ChatGptProjectDto[]>;
  listArchive(): Promise<ArchivedPairSummaryDto[]>;
  deleteArchive(ref: string): Promise<{ ref: string }>;
  copyText(text: string): Promise<{ copied: boolean }>;
  onEvent(listener: (event: EventRecordDto) => void): () => void;
  onStatusRefresh(listener: (payload: { reason?: string }) => void): () => void;
  onWorkerProgressUpdate(listener: (pairId: string) => void): () => void;
}

const api: DesktopApi = {
  configPath: process.env.AGENT_RELAY_CONFIG ?? "",
  listPairs: () => invoke(IPC_CHANNELS.listPairs),
  getStatus: () => invoke(IPC_CHANNELS.status),
  getPairStatus: (pairId) => invoke(IPC_CHANNELS.pairStatus, pairId),
  getPairDetail: (pairId) => invoke(IPC_CHANNELS.pairDetail, pairId),
  pausePair: (pairId) => invoke(IPC_CHANNELS.pausePair, pairId),
  resumePair: (pairId) => invoke(IPC_CHANNELS.resumePair, pairId),
  startPair: (pairId, priming) => invoke(IPC_CHANNELS.startPair, pairId, priming),
  stopPair: (pairId) => invoke(IPC_CHANNELS.stopPair, pairId),
  startAll: () => invoke(IPC_CHANNELS.startAll),
  stopAll: () => invoke(IPC_CHANNELS.stopAll),
  validatePair: (pairId) => invoke(IPC_CHANNELS.validatePair, pairId),
  getValidation: (pairId) => invoke(IPC_CHANNELS.getValidation, pairId),
  getRecentEvents: (filter) => invoke(IPC_CHANNELS.getRecentEvents, filter),
  getAutomationInfo: () => invoke(IPC_CHANNELS.getAutomationInfo),
  seedPlanner: (pairId) => invoke(IPC_CHANNELS.seedPlanner, pairId),
  feedLocalAgent: (pairId) => invoke(IPC_CHANNELS.feedLocalAgent, pairId),
  listOpenCodeSessions: (pairId) => invoke(IPC_CHANNELS.listOpenCodeSessions, pairId),
  listWorkerQuestions: (pairId) => invoke(IPC_CHANNELS.listWorkerQuestions, pairId),
  getWorkerTranscript: (pairId) => invoke(IPC_CHANNELS.getWorkerTranscript, pairId),
  answerWorkerQuestion: (pairId, input) => invoke(IPC_CHANNELS.answerWorkerQuestion, pairId, input),
  getOpenCodeEndpoint: () => invoke(IPC_CHANNELS.getOpenCodeEndpoint),
  getChatGptEndpoint: () => invoke(IPC_CHANNELS.getChatGptEndpoint),
  discoverWorkerSessions: (input) => invoke(IPC_CHANNELS.discoverWorkerSessions, input),
  scanDesktopWorkerSession: () => invoke(IPC_CHANNELS.scanDesktopWorkerSession),
  alignWorkerSessionWithOpenCodeDesktop: (pairId) =>
    invoke(IPC_CHANNELS.alignWorkerSessionWithOpenCodeDesktop, pairId),
  startWorkerServer: (input) => invoke(IPC_CHANNELS.startWorkerServer, input),
  updateOpenCode: () => invoke(IPC_CHANNELS.updateOpenCode),
  createWorkerSession: (input) => invoke(IPC_CHANNELS.createWorkerSession, input),
  testWorkerEndpoint: (input) => invoke(IPC_CHANNELS.testWorkerEndpoint, input),
  parsePlannerUrl: (input) => invoke(IPC_CHANNELS.parsePlannerUrl, input),
  testPlannerEndpoint: (input) => invoke(IPC_CHANNELS.testPlannerEndpoint, input),
  startPlannerBrowser: (input) => invoke(IPC_CHANNELS.startPlannerBrowser, input),
  validateCandidate: (input) => invoke(IPC_CHANNELS.validateCandidate, input),
  createPair: (input) => invoke(IPC_CHANNELS.createPair, input),
  updatePair: (pairId, input) => invoke(IPC_CHANNELS.updatePair, pairId, input),
  removePair: (pairId) => invoke(IPC_CHANNELS.removePair, pairId),
  rebindWorker: (pairId, sessionId) => invoke(IPC_CHANNELS.rebindWorker, pairId, sessionId),
  suggestWorkerSessionTitle: (pairId) => invoke(IPC_CHANNELS.suggestWorkerSessionTitle, pairId),
  createWorkerSessionForPair: (pairId, input) => invoke(IPC_CHANNELS.createWorkerSessionForPair, pairId, input),
  openWorkerSession: (pairId) => invoke(IPC_CHANNELS.openWorkerSession, pairId),
  listWorkerModels: (pairId) => invoke(IPC_CHANNELS.listWorkerModels, pairId),
  switchWorkerModel: (pairId, input) => invoke(IPC_CHANNELS.switchWorkerModel, pairId, input),
  resumeWithFallbackModel: (pairId, input) => invoke(IPC_CHANNELS.resumeWithFallbackModel, pairId, input),
  getWorkerProgress: (pairId, forceRefresh) => invoke(IPC_CHANNELS.getWorkerProgress, pairId, forceRefresh),
  getTimeline: (pairId?: string, limit?: number) => invoke(IPC_CHANNELS.getTimeline, { pairId, limit }),
  startProject: (projectPairId: string) => invoke(IPC_CHANNELS.startProject, projectPairId),
  resumeProject: (projectPairId: string) => invoke(IPC_CHANNELS.resumeProject, projectPairId),
  pauseProject: (projectPairId: string) => invoke(IPC_CHANNELS.pauseProject, projectPairId),
  listProjectPairs: () => invoke(IPC_CHANNELS.listProjectPairs),
  createProjectPair: (input) => invoke(IPC_CHANNELS.createProjectPair, input),
  removeProjectPair: (projectPairId) => invoke(IPC_CHANNELS.removeProjectPair, projectPairId),
  discoverOpenCodeProjects: () => invoke(IPC_CHANNELS.discoverOpenCodeProjects),
  discoverChatGptProjects: (input) => invoke(IPC_CHANNELS.discoverChatGptProjects, input),
  listArchive: () => invoke(IPC_CHANNELS.listArchive),
  deleteArchive: (ref) => invoke(IPC_CHANNELS.deleteArchive, ref),
  copyText: (text) => invoke(IPC_CHANNELS.copyText, text),
  onEvent: (listener) => {
    const handler = (_event: unknown, payload: EventRecordDto) => listener(payload);
    ipcRenderer.on(EVENT_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(EVENT_CHANNEL, handler);
    };
  },
  onStatusRefresh: (listener) => {
    const handler = (_event: unknown, payload: { reason?: string }) => listener(payload);
    ipcRenderer.on(STATUS_REFRESH_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(STATUS_REFRESH_CHANNEL, handler);
    };
  },
  onWorkerProgressUpdate: (listener) => {
    const handler = (_event: unknown, payload: { pairId: string }) => listener(payload.pairId);
    ipcRenderer.on(WORKER_PROGRESS_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(WORKER_PROGRESS_CHANNEL, handler);
    };
  }
};

contextBridge.exposeInMainWorld("desktop", api);
