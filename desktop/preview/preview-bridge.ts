import type {
  ArchivedPairSummaryDto,
  AutomationInfoDto,
  CandidatePairDto,
  ChatGptProjectDto,
  CreateOpenCodeSessionDto,
  CreateProjectPairDto,
  EndpointTestResultDto,
  EventRecordDto,
  LocalAgentFeedResultDto,
  OpenCodeEndpointDto,
  OpenCodeEndpointTestDto,
  OpenCodeProjectDto,
  OpenCodeSessionInfoDto,
  PairIdentityDto,
  PairStartPriming,
  ParsedChatGptUrlDto,
  PeerHealthDto,
  PlannerEndpointDto,
  PlannerSeedResultDto,
  ProjectPairDto,
  RecentEventsFilterDto,
  StartOpenCodeServerDto,
  StatusSummaryDto,
  SwitchWorkerModelDto,
  ToolActionResultDto,
  ToolLaunchResultDto,
  UpdatePairDto,
  ValidationResultDto,
  WorkerModelDto,
  WorkerModelSwitchResultDto,
  WorkerSessionOpenResultDto
} from "../shared/dto.js";
import type { WorkerProgressDto } from "../shared/worker-progress.js";
import type { WorkerQuestion } from "../../src/contracts/worker-question.js";
import type { WorkerTranscript } from "../../src/contracts/worker-transcript.js";

/**
 * Preview-only bridge mock that exposes `window.desktop` for browser preview environments
 * where native Electron IPC cannot run.
 *
 * This file is strictly separated under `desktop/preview/` and does NOT modify
 * core engine logic or production Electron files.
 */

interface PreviewStore {
  configPath: string;
  pairs: PairIdentityDto[];
  projectPairs: ProjectPairDto[];
  statuses: Map<string, PeerHealthDto>;
  validations: Map<string, ValidationResultDto>;
  archivedPairs: ArchivedPairSummaryDto[];
  events: EventRecordDto[];
  automation: AutomationInfoDto;
  models: WorkerModelDto[];
  activeProgress: Map<string, WorkerProgressDto>;
  listeners: {
    events: Set<(event: EventRecordDto) => void>;
    statusRefresh: Set<(payload: { reason?: string }) => void>;
    workerProgress: Set<(pairId: string) => void>;
  };
}

const initialPairs: PairIdentityDto[] = [
  {
    pairId: "new-session-2026-09-14t15-40-42-638z",
    enabled: true,
    localAgentMode: false,
    projectPairId: "local-dev",
    worker: {
      type: "opencode",
      sessionId: "ses_f5f713da5ffe04Lox7J7QAR0B2",
      repoPath: "/Users/lazydeepak/dev/OdareHub",
      server: {
        baseUrl: "http://127.0.0.1:4096/"
      }
    },
    planner: {
      type: "chatgpt-browser",
      conversationId: "6aa7e789-7618-83ee-a8fc-99df3d0d7147",
      conversationUrl: "https://chatgpt.com/c/6aa7e789-7618-83ee-a8fc-99df3d0d7147",
      browser: {
        cdpUrl: "http://127.0.0.1:9222/"
      }
    }
  }
];

const initialProjectPairs: ProjectPairDto[] = [
  {
    projectPairId: "local-dev",
    worker: {
      repoPath: "/Users/lazydeepak/dev/OdareHub",
      projectId: "proj-odare-hub"
    },
    planner: {
      projectSlug: "g-p-6aa7e7897618-agent-relay",
      projectName: "OdareHub Planner"
    }
  }
];

const initialStatuses = new Map<string, PeerHealthDto>([
  [
    "new-session-2026-09-14t15-40-42-638z",
    {
      pairId: "new-session-2026-09-14t15-40-42-638z",
      runtimeState: "HEALTHY",
      hasRelayHistory: true,
      supervisorState: "SUPERVISING",
      worker: "HEALTHY",
      planner: "HEALTHY",
      workerActivity: "idle",
      plannerActivity: "idle",
      recovering: false,
      workerObserved: true,
      plannerObserved: true,
      lastObservedAt: new Date().toISOString(),
      paused: false,
      enabled: true,
      schedulerMode: "ACTIVE"
    }
  ]
]);

const initialValidations = new Map<string, ValidationResultDto>([
  [
    "new-session-2026-09-14t15-40-42-638z",
    {
      pairId: "new-session-2026-09-14t15-40-42-638z",
      status: "READY",
      validatedAt: new Date().toISOString(),
      checks: [
        {
          name: "worker.endpoint",
          status: "PASS",
          reason: "OpenCode server reachable at http://127.0.0.1:4096/"
        },
        {
          name: "worker.session",
          status: "PASS",
          reason: "Session ses_f5f713da5ffe04Lox7J7QAR0B2 active in /Users/lazydeepak/dev/OdareHub"
        },
        {
          name: "planner.browser",
          status: "PASS",
          reason: "CDP loopback endpoint reachable at http://127.0.0.1:9222/"
        },
        {
          name: "planner.conversation",
          status: "PASS",
          reason: "ChatGPT conversation 6aa7e789-7618-83ee-a8fc-99df3d0d7147 loaded"
        }
      ]
    }
  ]
]);

const initialArchivedPairs: ArchivedPairSummaryDto[] = [
  {
    ref: "archive-2026-09-10-01",
    pairId: "odare-hub-init",
    archivedAt: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString(),
    recordCount: 42,
    cycleCount: 14,
    hasState: true
  }
];

const initialEvents: EventRecordDto[] = [
  {
    time: new Date(Date.now() - 120000).toISOString(),
    type: "STATE_CHANGED",
    pairId: "new-session-2026-09-14t15-40-42-638z",
    details: { state: "HEALTHY", previousState: "STARTING" }
  },
  {
    time: new Date(Date.now() - 95000).toISOString(),
    type: "DELIVERY_COMPLETED",
    pairId: "new-session-2026-09-14t15-40-42-638z",
    details: { cycle: 14, messagesCount: 2, bytes: 1420 }
  },
  {
    time: new Date(Date.now() - 45000).toISOString(),
    type: "VALIDATION_PASSED",
    pairId: "new-session-2026-09-14t15-40-42-638z",
    reason: "All 4 readiness checks passed"
  }
];

const initialModels: WorkerModelDto[] = [
  { providerId: "anthropic", modelId: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet", current: true },
  { providerId: "anthropic", modelId: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet", current: false },
  { providerId: "openai", modelId: "gpt-4o", name: "GPT-4o", current: false }
];

function createInitialWorkerProgress(pairId: string, sessionId: string, repoPath: string): WorkerProgressDto {
  return {
    pairId,
    sessionId,
    sessionTitle: "OdareHub Feature Relay",
    repoPath,
    fetchedAt: new Date().toISOString(),
    stale: false,
    live: {
      state: "working",
      currentTask: "Verifying Electron desktop layout and component rendering",
      currentTool: "read_file",
      currentFile: "desktop/renderer/renderer.ts",
      startedAt: new Date(Date.now() - 32000).toISOString(),
      elapsedMs: 32000,
      latestResponse: "Electron desktop components initialized. Wires: pair cards, archive, wizard, and events log.",
      connectionStatus: "connected",
      sseConnected: true,
      lastEventAt: new Date().toISOString()
    },
    plan: [
      {
        id: "task-1",
        content: "Locate Electron renderer entry points and CSS assets",
        status: "completed",
        updatedAt: new Date(Date.now() - 30000).toISOString()
      },
      {
        id: "task-2",
        content: "Implement browser-compatible preload bridge mock for window.desktop",
        status: "completed",
        updatedAt: new Date(Date.now() - 15000).toISOString()
      },
      {
        id: "task-3",
        content: "Render native desktop layout with interactive pair controls and modal views",
        status: "in_progress",
        updatedAt: new Date().toISOString()
      }
    ],
    changes: {
      totalAdditions: 384,
      totalDeletions: 18,
      sessionStartedAt: new Date(Date.now() - 3600000).toISOString(),
      files: [
        {
          path: "desktop/renderer/renderer.ts",
          status: "modified",
          additions: 120,
          deletions: 12
        },
        {
          path: "desktop/renderer/styles.css",
          status: "modified",
          additions: 64,
          deletions: 6
        },
        {
          path: "desktop/preview/preview-bridge.ts",
          status: "added",
          additions: 200,
          deletions: 0
        }
      ]
    },
    history: [
      {
        id: "hist-1",
        type: "user_message",
        timestamp: new Date(Date.now() - 60000).toISOString(),
        summary: "Render the existing Electron desktop renderer instead."
      },
      {
        id: "hist-2",
        type: "tool_call",
        toolName: "read_file",
        timestamp: new Date(Date.now() - 45000).toISOString(),
        summary: "Inspected desktop/renderer/index.html and preload interfaces"
      },
      {
        id: "hist-3",
        type: "assistant_response",
        timestamp: new Date(Date.now() - 20000).toISOString(),
        summary: "Assembled browser preview adapter implementing complete DesktopApi surface"
      }
    ],
    currentCycleId: 14
  };
}

const store: PreviewStore = {
  configPath: "config/pairs.local.json",
  pairs: [...initialPairs],
  projectPairs: [...initialProjectPairs],
  statuses: new Map(initialStatuses),
  validations: new Map(initialValidations),
  archivedPairs: [...initialArchivedPairs],
  events: [...initialEvents],
  automation: {
    mode: "relay",
    universalPrompt: "Relay instructions v4.2",
    universalPromptVersion: "4.2"
  },
  models: [...initialModels],
  activeProgress: new Map([
    ["new-session-2026-09-14t15-40-42-638z", createInitialWorkerProgress(
      "new-session-2026-09-14t15-40-42-638z",
      "ses_f5f713da5ffe04Lox7J7QAR0B2",
      "/Users/lazydeepak/dev/OdareHub"
    )]
  ]),
  listeners: {
    events: new Set(),
    statusRefresh: new Set(),
    workerProgress: new Set()
  }
};

function emitEvent(event: EventRecordDto): void {
  store.events.unshift(event);
  if (store.events.length > 200) {
    store.events.pop();
  }
  for (const listener of store.listeners.events) {
    try {
      listener(event);
    } catch (e) {
      console.warn("Event listener error:", e);
    }
  }
}

function emitStatusRefresh(reason?: string): void {
  for (const listener of store.listeners.statusRefresh) {
    try {
      listener({ reason });
    } catch (e) {
      console.warn("Status refresh listener error:", e);
    }
  }
}

function emitWorkerProgress(pairId: string): void {
  for (const listener of store.listeners.workerProgress) {
    try {
      listener(pairId);
    } catch (e) {
      console.warn("Worker progress listener error:", e);
    }
  }
}

function computeStatusSummary(): StatusSummaryDto {
  const allStatuses = Array.from(store.statuses.values());
  let running = 0;
  let healthy = 0;
  let degraded = 0;
  let failed = 0;

  for (const s of allStatuses) {
    if (s.runtimeState === "HEALTHY" || s.runtimeState === "ACTIVE") {
      running++;
      healthy++;
    } else if (s.runtimeState === "DEGRADED" || s.recovering) {
      running++;
      degraded++;
    } else if (s.runtimeState === "FAILED") {
      failed++;
    }
  }

  return {
    enabled: store.pairs.filter((p) => p.enabled).length,
    running,
    healthy,
    degraded,
    failed,
    pairs: allStatuses
  };
}

export function createPreviewDesktopApi(): Window["desktop"] {
  return {
    configPath: store.configPath,

    async listPairs(): Promise<PairIdentityDto[]> {
      return [...store.pairs];
    },

    async getStatus(): Promise<StatusSummaryDto> {
      return computeStatusSummary();
    },

    async getTimeline(pairId?: string, limit = 50) {
      return store.events
        .filter((e) => !pairId || e.pairId === pairId)
        .slice(0, limit)
        .map((e) => ({
          time: e.time,
          pairId: e.pairId,
          projectPairId: e.projectPairId,
          type: e.type,
          state: (e.details?.state as string) ?? undefined,
          previousState: (e.details?.previousState as string) ?? undefined,
          reason: e.reason,
          details: e.details
        }));
    },

    async getPairStatus(pairId: string): Promise<PeerHealthDto> {
      const found = store.statuses.get(pairId);
      if (found) return { ...found };
      return {
        pairId,
        runtimeState: "STOPPED",
        hasRelayHistory: false,
        worker: "unknown",
        planner: "unknown",
        recovering: false,
        workerObserved: false,
        plannerObserved: false,
        paused: false,
        enabled: true
      };
    },

    async getPairDetail(pairId: string): Promise<PairIdentityDto | undefined> {
      const pair = store.pairs.find((p) => p.pairId === pairId);
      return pair ? JSON.parse(JSON.stringify(pair)) : undefined;
    },

    async pausePair(pairId: string): Promise<StatusSummaryDto> {
      const status = store.statuses.get(pairId);
      if (status) {
        status.paused = true;
        status.runtimeState = "PAUSED";
      }
      emitEvent({
        time: new Date().toISOString(),
        type: "STATE_CHANGED",
        pairId,
        details: { state: "PAUSED" }
      });
      emitStatusRefresh("pair_paused");
      return computeStatusSummary();
    },

    async resumePair(pairId: string): Promise<StatusSummaryDto> {
      const status = store.statuses.get(pairId);
      if (status) {
        status.paused = false;
        status.runtimeState = "HEALTHY";
      }
      emitEvent({
        time: new Date().toISOString(),
        type: "STATE_CHANGED",
        pairId,
        details: { state: "HEALTHY" }
      });
      emitStatusRefresh("pair_resumed");
      return computeStatusSummary();
    },

    async startPair(pairId: string, priming?: PairStartPriming): Promise<StatusSummaryDto> {
      const status = store.statuses.get(pairId);
      if (status) {
        status.runtimeState = "HEALTHY";
        status.paused = false;
        status.workerActivity = "working";
      }
      emitEvent({
        time: new Date().toISOString(),
        type: "STATE_CHANGED",
        pairId,
        details: { state: "HEALTHY", priming }
      });
      emitStatusRefresh("pair_started");
      return computeStatusSummary();
    },

    async stopPair(pairId: string): Promise<StatusSummaryDto> {
      const status = store.statuses.get(pairId);
      if (status) {
        status.runtimeState = "STOPPED";
        status.workerActivity = "idle";
        status.plannerActivity = "idle";
      }
      emitEvent({
        time: new Date().toISOString(),
        type: "STATE_CHANGED",
        pairId,
        details: { state: "STOPPED" }
      });
      emitStatusRefresh("pair_stopped");
      return computeStatusSummary();
    },

    async startAll(): Promise<StatusSummaryDto> {
      for (const [pairId, status] of store.statuses.entries()) {
        status.runtimeState = "HEALTHY";
        status.paused = false;
        emitEvent({
          time: new Date().toISOString(),
          type: "STATE_CHANGED",
          pairId,
          details: { state: "HEALTHY" }
        });
      }
      emitStatusRefresh("start_all");
      return computeStatusSummary();
    },

    async stopAll(): Promise<StatusSummaryDto> {
      for (const [pairId, status] of store.statuses.entries()) {
        status.runtimeState = "STOPPED";
        status.workerActivity = "idle";
        status.plannerActivity = "idle";
        emitEvent({
          time: new Date().toISOString(),
          type: "STATE_CHANGED",
          pairId,
          details: { state: "STOPPED" }
        });
      }
      emitStatusRefresh("stop_all");
      return computeStatusSummary();
    },

    async validatePair(pairId: string): Promise<ValidationResultDto> {
      const result: ValidationResultDto = {
        pairId,
        status: "READY",
        validatedAt: new Date().toISOString(),
        checks: [
          { name: "worker.endpoint", status: "PASS", reason: "OpenCode HTTP server verified" },
          { name: "worker.session", status: "PASS", reason: "Worker workspace session bound" },
          { name: "planner.browser", status: "PASS", reason: "CDP browser target connected" },
          { name: "planner.conversation", status: "PASS", reason: "ChatGPT conversation thread responsive" }
        ]
      };
      store.validations.set(pairId, result);
      emitEvent({
        time: new Date().toISOString(),
        type: "VALIDATION_PASSED",
        pairId,
        reason: "All readiness checks passed"
      });
      return result;
    },

    async getValidation(pairId: string): Promise<ValidationResultDto | undefined> {
      return store.validations.get(pairId);
    },

    async getRecentEvents(filter?: RecentEventsFilterDto): Promise<EventRecordDto[]> {
      const limit = filter?.limit ?? 100;
      let events = [...store.events];
      if (filter?.pairId) {
        events = events.filter((e) => e.pairId === filter.pairId);
      }
      return events.slice(0, limit);
    },

    async getAutomationInfo(): Promise<AutomationInfoDto> {
      return { ...store.automation };
    },

    async seedPlanner(pairId: string): Promise<PlannerSeedResultDto> {
      const sentAt = new Date().toISOString();
      emitEvent({
        time: sentAt,
        type: "PLANNER_SEEDED",
        pairId,
        details: { promptVersion: store.automation.universalPromptVersion }
      });
      return { pairId, promptVersion: store.automation.universalPromptVersion, sentAt };
    },

    async feedLocalAgent(pairId: string): Promise<LocalAgentFeedResultDto> {
      const sentAt = new Date().toISOString();
      return {
        pairId,
        promptVersion: store.automation.universalPromptVersion,
        sentAt,
        localAgentMode: true
      };
    },

    async listOpenCodeSessions(_pairId: string): Promise<unknown[]> {
      return [
        { id: "ses_f5f713da5ffe04Lox7J7QAR0B2", title: "Active OdareHub Session", repoPath: "/Users/lazydeepak/dev/OdareHub" }
      ];
    },

    async listWorkerQuestions(_pairId: string): Promise<WorkerQuestion[]> {
      return [];
    },

    async getWorkerTranscript(pairId: string): Promise<WorkerTranscript> {
      const pair = store.pairs.find((p) => p.pairId === pairId);
      return {
        sessionId: pair?.worker.sessionId ?? "ses_preview",
        title: `Transcript for ${pairId}`,
        repoPath: pair?.worker.repoPath ?? "/dev/project",
        model: "claude-3-7-sonnet",
        running: false,
        waitingForInput: false,
        checkedAt: new Date().toISOString(),
        messages: [
          {
            id: "msg-101",
            role: "user",
            createdAt: Date.now() - 180000,
            text: "Review the system architecture and ensure desktop renderer renders seamlessly."
          },
          {
            id: "msg-102",
            role: "assistant",
            createdAt: Date.now() - 120000,
            text: "Analyzed the Electron desktop structure: the renderer entry point is desktop/renderer/index.html with styles.css and renderer.ts. All desktop modules are aligned."
          }
        ]
      };
    },

    async answerWorkerQuestion(_pairId: string, _input: { requestId: string; answers: string[][] }): Promise<{ answered: boolean }> {
      return { answered: true };
    },

    async getOpenCodeEndpoint(): Promise<string> {
      return "http://127.0.0.1:4096/";
    },

    async getChatGptEndpoint(): Promise<string> {
      return "http://127.0.0.1:9222/";
    },

    async discoverWorkerSessions(_input?: OpenCodeEndpointDto): Promise<OpenCodeSessionInfoDto[]> {
      return [
        {
          sessionId: "ses_f5f713da5ffe04Lox7J7QAR0B2",
          title: "Active OdareHub Session",
          repoPath: "/Users/lazydeepak/dev/OdareHub",
          updatedAt: Date.now() - 3600000
        },
        {
          sessionId: "ses_dev_session_relay",
          title: "agent-relay development",
          repoPath: "/Users/lazydeepak/dev/agent-relay",
          updatedAt: Date.now() - 86400000
        }
      ];
    },

    async scanDesktopWorkerSession(): Promise<OpenCodeSessionInfoDto> {
      return {
        sessionId: "ses_f5f713da5ffe04Lox7J7QAR0B2",
        title: "Active OdareHub Session",
        repoPath: "/Users/lazydeepak/dev/OdareHub",
        updatedAt: Date.now()
      };
    },

    async alignWorkerSessionWithOpenCodeDesktop(pairId: string) {
      return {
        ok: true,
        boundSessionId: "ses_f5f713da5ffe04Lox7J7QAR0B2",
        desktopSessionId: "ses_f5f713da5ffe04Lox7J7QAR0B2",
        rebound: false,
        message: `Aligned pair ${pairId} with active desktop session.`
      };
    },

    async startWorkerServer(input: StartOpenCodeServerDto): Promise<ToolLaunchResultDto> {
      return {
        ok: true,
        message: `OpenCode server running for ${input.repoPath}`,
        endpoint: input.baseUrl ?? "http://127.0.0.1:4096/",
        alreadyRunning: true
      };
    },

    async updateOpenCode(): Promise<ToolActionResultDto> {
      return { ok: true, message: "OpenCode is up to date." };
    },

    async createWorkerSession(input: CreateOpenCodeSessionDto): Promise<OpenCodeSessionInfoDto> {
      const newSession: OpenCodeSessionInfoDto = {
        sessionId: "ses_" + Math.random().toString(36).slice(2, 10),
        title: input.title ?? "New Session",
        repoPath: input.repoPath,
        updatedAt: Date.now()
      };
      return newSession;
    },

    async testWorkerEndpoint(input?: OpenCodeEndpointTestDto): Promise<EndpointTestResultDto> {
      return {
        ok: true,
        message: `Reachable at ${input?.baseUrl ?? "http://127.0.0.1:4096/"}`,
        checks: [{ name: "http", status: "PASS", reason: "200 OK" }]
      };
    },

    async parsePlannerUrl(input: { url: string }): Promise<ParsedChatGptUrlDto> {
      const match = input.url.match(/chatgpt\.com\/(?:g\/[^/]+\/)?c\/([a-zA-Z0-9-]+)/);
      const conversationId = match ? match[1] : "conv-" + Math.random().toString(36).slice(2, 8);
      return {
        conversationId,
        conversationUrl: input.url,
        project: "OdareHub Planner"
      };
    },

    async testPlannerEndpoint(input?: PlannerEndpointDto): Promise<EndpointTestResultDto> {
      return {
        ok: true,
        message: `CDP reachable at ${input?.cdpUrl ?? "http://127.0.0.1:9222/"}`,
        checks: [{ name: "cdp", status: "PASS", reason: "Target discovered" }]
      };
    },

    async startPlannerBrowser(_input?: PlannerEndpointDto): Promise<ToolLaunchResultDto> {
      return {
        ok: true,
        message: "Automation browser running on CDP port 9222",
        endpoint: "http://127.0.0.1:9222/",
        alreadyRunning: true
      };
    },

    async validateCandidate(input: CandidatePairDto): Promise<ValidationResultDto> {
      return {
        pairId: input.pairId,
        status: "READY",
        validatedAt: new Date().toISOString(),
        checks: [
          { name: "worker.repo", status: "PASS", reason: "Valid directory path" },
          { name: "planner.url", status: "PASS", reason: "Valid conversation target" }
        ]
      };
    },

    async createPair(input: CandidatePairDto): Promise<PairIdentityDto> {
      const newPair: PairIdentityDto = {
        pairId: input.pairId,
        enabled: true,
        localAgentMode: false,
        projectPairId: input.projectPairId,
        worker: {
          type: "opencode",
          sessionId: input.worker.sessionId,
          repoPath: input.worker.repoPath,
          server: input.worker.server
        },
        planner: {
          type: "chatgpt-browser",
          conversationId: input.planner.conversationId,
          conversationUrl: input.planner.conversationUrl,
          browser: input.planner.browser
        }
      };
      store.pairs.push(newPair);
      store.statuses.set(newPair.pairId, {
        pairId: newPair.pairId,
        runtimeState: "HEALTHY",
        hasRelayHistory: false,
        supervisorState: "SUPERVISING",
        worker: "HEALTHY",
        planner: "HEALTHY",
        recovering: false,
        workerObserved: true,
        plannerObserved: true,
        lastObservedAt: new Date().toISOString(),
        paused: false,
        enabled: true,
        schedulerMode: "ACTIVE"
      });
      emitEvent({
        time: new Date().toISOString(),
        type: "PAIR_ADDED",
        pairId: newPair.pairId,
        details: { repoPath: newPair.worker.repoPath }
      });
      emitStatusRefresh("pair_added");
      return newPair;
    },

    async updatePair(pairId: string, input: UpdatePairDto): Promise<PairIdentityDto> {
      const pair = store.pairs.find((p) => p.pairId === pairId);
      if (!pair) {
        throw new Error(`Pair "${pairId}" not found`);
      }
      if (typeof input.enabled === "boolean") pair.enabled = input.enabled;
      if (typeof input.localAgentMode === "boolean") pair.localAgentMode = input.localAgentMode;
      if (input.projectPairId) pair.projectPairId = input.projectPairId;
      if (input.worker?.sessionId) pair.worker.sessionId = input.worker.sessionId;
      if (input.worker?.repoPath) pair.worker.repoPath = input.worker.repoPath;
      if (input.planner?.conversationId) pair.planner.conversationId = input.planner.conversationId;
      if (input.planner?.conversationUrl) pair.planner.conversationUrl = input.planner.conversationUrl;

      emitStatusRefresh("pair_updated");
      return JSON.parse(JSON.stringify(pair));
    },

    async removePair(pairId: string): Promise<{ pairId: string }> {
      const index = store.pairs.findIndex((p) => p.pairId === pairId);
      if (index !== -1) {
        store.pairs.splice(index, 1);
      }
      store.statuses.delete(pairId);
      store.validations.delete(pairId);
      store.archivedPairs.unshift({
        ref: "archive-" + Date.now(),
        pairId,
        archivedAt: new Date().toISOString(),
        recordCount: 12,
        cycleCount: 4,
        hasState: false
      });
      emitEvent({
        time: new Date().toISOString(),
        type: "PAIR_REMOVED",
        pairId
      });
      emitStatusRefresh("pair_removed");
      return { pairId };
    },

    async rebindWorker(pairId: string, sessionId: string): Promise<PairIdentityDto> {
      const pair = store.pairs.find((p) => p.pairId === pairId);
      if (!pair) throw new Error(`Pair "${pairId}" not found`);
      pair.worker.sessionId = sessionId;
      emitEvent({
        time: new Date().toISOString(),
        type: "WORKER_REBOUND",
        pairId,
        details: { sessionId }
      });
      emitStatusRefresh("rebind_worker");
      return JSON.parse(JSON.stringify(pair));
    },

    async suggestWorkerSessionTitle(pairId: string): Promise<string> {
      return `Relay Session ${pairId} (${new Date().toLocaleDateString()})`;
    },

    async createWorkerSessionForPair(pairId: string, input?: { title?: string }): Promise<PairIdentityDto> {
      const pair = store.pairs.find((p) => p.pairId === pairId);
      if (!pair) throw new Error(`Pair "${pairId}" not found`);
      pair.worker.sessionId = "ses_" + Math.random().toString(36).slice(2, 10);
      emitEvent({
        time: new Date().toISOString(),
        type: "WORKER_SESSION_CREATED",
        pairId,
        details: { title: input?.title }
      });
      emitStatusRefresh("worker_session_created");
      return JSON.parse(JSON.stringify(pair));
    },

    async openWorkerSession(pairId: string): Promise<WorkerSessionOpenResultDto> {
      const pair = store.pairs.find((p) => p.pairId === pairId);
      return {
        sessionId: pair?.worker.sessionId ?? "ses_default",
        selected: true,
        foregrounded: true,
        fallback: false
      };
    },

    async listWorkerModels(_pairId: string): Promise<WorkerModelDto[]> {
      return [...store.models];
    },

    async switchWorkerModel(pairId: string, input: SwitchWorkerModelDto): Promise<WorkerModelSwitchResultDto> {
      for (const m of store.models) {
        m.current = m.providerId === input.providerId && m.modelId === input.modelId;
      }
      const switchedAt = new Date().toISOString();
      const current = store.models.find((m) => m.current) ?? store.models[0];
      emitEvent({
        time: switchedAt,
        type: "WORKER_MODEL_SWITCHED",
        pairId,
        details: { model: current.name }
      });
      return {
        pairId,
        sessionId: store.pairs.find((p) => p.pairId === pairId)?.worker.sessionId ?? "",
        switchedAt,
        providerId: current.providerId,
        modelId: current.modelId,
        name: current.name,
        current: true
      };
    },

    async resumeWithFallbackModel(pairId: string, _input: Pick<SwitchWorkerModelDto, "providerId" | "modelId">): Promise<StatusSummaryDto> {
      return computeStatusSummary();
    },

    async getWorkerProgress(pairId: string, _forceRefresh?: boolean): Promise<WorkerProgressDto> {
      let progress = store.activeProgress.get(pairId);
      if (!progress) {
        const pair = store.pairs.find((p) => p.pairId === pairId);
        progress = createInitialWorkerProgress(pairId, pair?.worker.sessionId ?? "ses_unknown", pair?.worker.repoPath ?? "");
        store.activeProgress.set(pairId, progress);
      }
      return progress;
    },

    async startProject(projectPairId: string): Promise<StatusSummaryDto> {
      const pairs = store.pairs.filter((p) => p.projectPairId === projectPairId);
      for (const pair of pairs) {
        const status = store.statuses.get(pair.pairId);
        if (status) {
          status.runtimeState = "HEALTHY";
          status.paused = false;
        }
      }
      emitStatusRefresh("project_started");
      return computeStatusSummary();
    },

    async resumeProject(projectPairId: string): Promise<StatusSummaryDto> {
      const pairs = store.pairs.filter((p) => p.projectPairId === projectPairId);
      for (const pair of pairs) {
        const status = store.statuses.get(pair.pairId);
        if (status) {
          status.paused = false;
          status.runtimeState = "HEALTHY";
        }
      }
      emitStatusRefresh("project_resumed");
      return computeStatusSummary();
    },

    async pauseProject(projectPairId: string): Promise<StatusSummaryDto> {
      const pairs = store.pairs.filter((p) => p.projectPairId === projectPairId);
      for (const pair of pairs) {
        const status = store.statuses.get(pair.pairId);
        if (status) {
          status.paused = true;
          status.runtimeState = "PAUSED";
        }
      }
      emitStatusRefresh("project_paused");
      return computeStatusSummary();
    },

    async listProjectPairs(): Promise<ProjectPairDto[]> {
      return [...store.projectPairs];
    },

    async createProjectPair(input: CreateProjectPairDto): Promise<ProjectPairDto> {
      const newProject: ProjectPairDto = {
        projectPairId: input.projectPairId || "project-" + Date.now(),
        worker: { repoPath: input.worker.repoPath, projectId: input.worker.projectId },
        planner: { projectSlug: input.planner.projectSlug, projectName: input.planner.projectName }
      };
      store.projectPairs.push(newProject);
      emitEvent({
        time: new Date().toISOString(),
        type: "PROJECT_PAIR_ADDED",
        projectPairId: newProject.projectPairId
      });
      return newProject;
    },

    async removeProjectPair(projectPairId: string): Promise<{ projectPairId: string }> {
      const index = store.projectPairs.findIndex((p) => p.projectPairId === projectPairId);
      if (index !== -1) {
        store.projectPairs.splice(index, 1);
      }
      emitEvent({
        time: new Date().toISOString(),
        type: "PROJECT_PAIR_REMOVED",
        projectPairId
      });
      return { projectPairId };
    },

    async discoverOpenCodeProjects(): Promise<OpenCodeProjectDto[]> {
      return [
        { repoPath: "/Users/lazydeepak/dev/OdareHub", name: "OdareHub", sessionCount: 2 },
        { repoPath: "/Users/lazydeepak/dev/agent-relay", name: "agent-relay", sessionCount: 1 }
      ];
    },

    async discoverChatGptProjects(): Promise<ChatGptProjectDto[]> {
      return [
        {
          projectSlug: "g-p-6aa7e7897618-agent-relay",
          projectName: "OdareHub Planner",
          conversationIds: ["6aa7e789-7618-83ee-a8fc-99df3d0d7147"],
          conversationTitles: {
            "6aa7e789-7618-83ee-a8fc-99df3d0d7147": "Main Development Thread"
          },
          openTabCount: 1
        }
      ];
    },

    async listArchive(): Promise<ArchivedPairSummaryDto[]> {
      return [...store.archivedPairs];
    },

    async deleteArchive(ref: string): Promise<{ ref: string }> {
      const index = store.archivedPairs.findIndex((a) => a.ref === ref);
      if (index !== -1) {
        store.archivedPairs.splice(index, 1);
      }
      return { ref };
    },

    async copyText(text: string): Promise<{ copied: boolean }> {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          return { copied: true };
        }
      } catch {
        // Fallback below
      }
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      return { copied: true };
    },

    onEvent(listener: (event: EventRecordDto) => void): () => void {
      store.listeners.events.add(listener);
      return () => {
        store.listeners.events.delete(listener);
      };
    },

    onStatusRefresh(listener: (payload: { reason?: string }) => void): () => void {
      store.listeners.statusRefresh.add(listener);
      return () => {
        store.listeners.statusRefresh.delete(listener);
      };
    },

    onWorkerProgressUpdate(listener: (pairId: string) => void): () => void {
      store.listeners.workerProgress.add(listener);
      return () => {
        store.listeners.workerProgress.delete(listener);
      };
    }
  };
}

// Auto-register on window.desktop immediately when preview bridge loads
if (typeof window !== "undefined") {
  (window as unknown as { desktop: ReturnType<typeof createPreviewDesktopApi> }).desktop = createPreviewDesktopApi();
}
