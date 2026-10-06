import type {
  AutomationInfoDto,
  ArchivedPairSummaryDto,
  ChatGptProjectDto,
  EventRecordDto,
  OpenCodeProjectDto,
  PairIdentityDto,
  PeerHealthDto,
  ProjectPairDto,
  ValidationResultDto,
  StatusSummaryDto,
  WorkerModelDto
} from "../shared/dto.js";
import type { WorkerProgressDto } from "../shared/worker-progress.js";

/** Per-project session snapshot used by the project pair cards. */
export interface ProjectPairSnapshot {
  openCodeSessions: import("../shared/dto.js").OpenCodeSessionInfoDto[];
  chatgpt?: import("../shared/dto.js").ChatGptProjectDto;
}

export interface ViewState {
  pairs: PairIdentityDto[];
  projectPairs: ProjectPairDto[];
  projectPairSnapshots: Map<string, ProjectPairSnapshot>;
  archivedPairs: ArchivedPairSummaryDto[];
  sessionProject: Map<string, string | undefined>;
  statuses: Map<string, PeerHealthDto>;
  validations: Map<string, ValidationResultDto>;
  events: EventRecordDto[];
  automation?: AutomationInfoDto;
  workerProgress: Map<string, WorkerProgressDto>;
  workerModels: Map<string, WorkerModelDto[]>;
  activeProgressPair: string | undefined;
}

export const state: ViewState = {
  pairs: [],
  projectPairs: [],
  projectPairSnapshots: new Map(),
  archivedPairs: [],
  sessionProject: new Map(),
  statuses: new Map(),
  validations: new Map(),
  events: [],
  workerProgress: new Map(),
  workerModels: new Map(),
  activeProgressPair: undefined
};

/** Discovered worker/planner projects shared by discovery views. */
let discoveredOpenCodeProjects: OpenCodeProjectDto[] = [];
let discoveredChatGptProjects: ChatGptProjectDto[] = [];
export function setDiscoveredOpenCodeProjects(value: OpenCodeProjectDto[]): void { discoveredOpenCodeProjects = value; }
export function setDiscoveredChatGptProjects(value: ChatGptProjectDto[]): void { discoveredChatGptProjects = value; }
export const getDiscoveredOpenCodeProjects = (): OpenCodeProjectDto[] => discoveredOpenCodeProjects;
export const getDiscoveredChatGptProjects = (): ChatGptProjectDto[] => discoveredChatGptProjects;

/** Derives session→project assignments into `state` after pairs or projects change. */
export function refreshProjectAssignments(): void {
  const assigned = new Map<string, string | undefined>();
  const knownProjectIds = new Set<string>(
    (state.projectPairs ?? []).map((pair) => pair.projectPairId).filter(Boolean) as string[]
  );
  for (const pair of state.pairs) {
    if (pair.projectPairId && knownProjectIds.has(pair.projectPairId)) {
      assigned.set(pair.pairId, pair.projectPairId);
    } else {
      const repoBased = pair.projectPairId
        ? undefined
        : (state.projectPairs ?? []).find(
            (candidate) => candidate.worker.repoPath === pair.worker.repoPath
          )?.projectPairId;
      assigned.set(pair.pairId, repoBased);
    }
  }
  state.sessionProject = assigned;
}

/** Replaces the per-pair status map from a status summary. */
export function setStatuses(summary: StatusSummaryDto): void {
  const map = new Map<string, PeerHealthDto>();
  for (const pair of summary.pairs) {
    map.set(pair.pairId, pair);
  }
  state.statuses = map;
}

/** Re-enables/disables the "Start all" button based on relay seeding state. */
export function updateStartAllButton(): void {
  const startAll = document.getElementById("start-all") as HTMLButtonElement | null;
  if (!startAll) {
    return;
  }
  const enabledPairs = state.pairs.filter((pair) => pair.enabled);
  const hasUnseededPair =
    state.automation?.mode === "relay" &&
    enabledPairs.some(
      (pair) => pair.planner.automation?.promptVersion !== state.automation?.universalPromptVersion
    );
  startAll.disabled = enabledPairs.length === 0 || hasUnseededPair;
  startAll.title = hasUnseededPair
    ? `Send universal kickoff prompt v${state.automation?.universalPromptVersion} to every enabled session first.`
    : "Start all enabled sessions";
}


/** Expanded project cards set shared by pair/project views. */
export const expandedProjectPairs = new Set<string>();
