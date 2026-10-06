import { basename, isAbsolute, resolve } from "node:path";
import { LiveOpenCodeAdapter } from "../adapters/opencode/index.js";
import {
  ChatGptProjectDiscoveryError,
  discoverChatGptProjects as discoverChatGptProjectsFromBrowser,
  normalizeChatGptProject,
  type ChatGptProjectDiscovery
} from "../adapters/chatgpt/project-discovery.js";
import {
  OpenCodeDesktopStateError,
  discoverOpenCodeServerUrl,
  scanOpenCodeDesktopActiveSession,
  type OpenCodeDesktopSession
} from "../adapters/opencode/desktop-state.js";
import {
  ProjectPairRepository,
  ProjectPairRepositoryError
} from "./project-pair-repository.js";
import { ProjectPairConfigError } from "../sessions/project-pairs.js";
import { DesktopApplicationError } from "./desktop-service.js";
import type { ProjectPair } from "../types.js";

export interface ProjectPairServiceOptions {
  configPath: string;
  opencodeBaseUrl?: string;
  chatgptCdpUrl?: string;
  opencodeFetch?: typeof fetch;
  chatgptFetch?: typeof fetch;
  openCodeDesktopScan?: () => Promise<OpenCodeDesktopSession>;
}

export interface CreateProjectPairInput {
  projectPairId?: string;
  worker: {
    repoPath: string;
    projectId?: string;
  };
  planner: {
    projectSlug: string;
    projectName?: string;
  };
}

export interface OpenCodeProjectDiscovery {
  repoPath: string;
  name: string;
  sessionCount: number;
}

const DEFAULT_OPENCODE_BASE_URL = "http://127.0.0.1:4096";
const DEFAULT_CHATGTP_CDP_URL = "http://127.0.0.1:9222";

/**
 * Standalone project-pair service. Owns the project pairs config file and the
 * read-only discovery calls for both sides. Deliberately independent of
 * DesktopApplicationService: project pairing never touches pairs, relay,
 * supervision, or recovery state.
 */
export class ProjectPairService {
  private readonly repo: ProjectPairRepository;

  constructor(private readonly options: ProjectPairServiceOptions) {
    this.repo = new ProjectPairRepository(options.configPath);
  }

  get configPath(): string {
    return this.options.configPath;
  }

  async listProjectPairs(): Promise<ProjectPair[]> {
    try {
      return (await this.repo.load()).projectPairs;
    } catch (error) {
      throw toProjectPairError(error);
    }
  }

  async createProjectPair(input: CreateProjectPairInput): Promise<ProjectPair> {
    const repoPath = input.worker?.repoPath?.trim() ?? "";
    if (!repoPath) {
      throw new DesktopApplicationError("INVALID_INPUT", "A non-empty OpenCode repoPath is required.");
    }
    if (!isAbsolute(repoPath)) {
      throw new DesktopApplicationError(
        "INVALID_INPUT",
        `OpenCode repoPath must be an absolute path, got "${repoPath}".`
      );
    }
    const slugInput = input.planner?.projectSlug?.trim() ?? "";
    if (!slugInput) {
      throw new DesktopApplicationError("INVALID_INPUT", "A non-empty ChatGPT project slug or URL is required.");
    }
    let normalized: { slug: string; name?: string };
    try {
      normalized = normalizeChatGptProject(slugInput);
    } catch (error) {
      throw new DesktopApplicationError("INVALID_CHATGPT_PROJECT", messageOf(error));
    }
    const explicitName = input.planner?.projectName?.trim();
    const projectPairId = input.projectPairId?.trim() || suggestProjectPairId(repoPath, normalized.slug);
    const pair: ProjectPair = {
      projectPairId,
      worker: {
        repoPath: resolve(repoPath),
        ...(input.worker?.projectId?.trim() ? { projectId: input.worker.projectId.trim() } : {})
      },
      planner: {
        projectSlug: normalized.slug,
        ...(explicitName ? { projectName: explicitName } : normalized.name ? { projectName: normalized.name } : {})
      }
    };
    try {
      await this.repo.addProjectPair(pair);
      return pair;
    } catch (error) {
      throw toProjectPairError(error);
    }
  }

  async updateProjectPair(
    projectPairId: string,
    input: {
      worker?: { repoPath?: string; projectId?: string };
      planner?: { projectSlug?: string; projectName?: string };
    }
  ): Promise<ProjectPair> {
    try {
      const edits: {
        worker?: { repoPath?: string; projectId?: string };
        planner?: { projectSlug?: string; projectName?: string };
      } = {};
      if (input.worker) {
        edits.worker = {};
        const repoPath = input.worker.repoPath?.trim();
        if (repoPath !== undefined) {
          if (!isAbsolute(repoPath)) {
            throw new DesktopApplicationError(
              "INVALID_INPUT",
              `OpenCode repoPath must be an absolute path, got "${repoPath}".`
            );
          }
          edits.worker.repoPath = resolve(repoPath);
        }
        if (input.worker.projectId?.trim()) {
          edits.worker.projectId = input.worker.projectId.trim();
        }
      }
      if (input.planner) {
        edits.planner = {};
        const slugInput = input.planner.projectSlug?.trim();
        if (slugInput !== undefined) {
          let normalized: { slug: string; name?: string };
          try {
            normalized = normalizeChatGptProject(slugInput);
          } catch (error) {
            throw new DesktopApplicationError("INVALID_CHATGPT_PROJECT", messageOf(error));
          }
          edits.planner.projectSlug = normalized.slug;
          const explicitName = input.planner.projectName?.trim();
          if (explicitName || normalized.name) {
            edits.planner.projectName = explicitName || normalized.name;
          }
        } else if (input.planner.projectName?.trim()) {
          edits.planner.projectName = input.planner.projectName.trim();
        }
      }
      const result = await this.repo.updateProjectPair(projectPairId, edits);
      const updated = result.projectPairs.find((pair) => pair.projectPairId === projectPairId);
      if (!updated) {
        throw new DesktopApplicationError(
          "PROJECT_PAIR_NOT_FOUND",
          `Project pair "${projectPairId}" does not exist.`
        );
      }
      return updated;
    } catch (error) {
      throw toProjectPairError(error);
    }
  }

  async removeProjectPair(projectPairId: string): Promise<{ projectPairId: string }> {
    try {
      await this.repo.removeProjectPair(projectPairId);
      return { projectPairId };
    } catch (error) {
      throw toProjectPairError(error);
    }
  }

  /** Read-only: groups every OpenCode session by its project directory. */
  async discoverOpenCodeProjects(): Promise<OpenCodeProjectDiscovery[]> {
    const discoveredUrl = await discoverOpenCodeServerUrl();
    const worker = new LiveOpenCodeAdapter({
      baseUrl: discoveredUrl ?? this.opencodeBaseUrl(),
      fetch: this.options.opencodeFetch
    });
    let sessions: Array<{ repoPath?: string }>;
    try {
      sessions = await worker.listSessions();
    } catch (error) {
      throw new DesktopApplicationError(
        "OPENCODE_UNAVAILABLE",
        `Could not list OpenCode sessions: ${messageOf(error)}`
      );
    }
    const byRepo = new Map<string, number>();
    for (const session of sessions) {
      if (!session.repoPath) continue;
      byRepo.set(session.repoPath, (byRepo.get(session.repoPath) ?? 0) + 1);
    }
    return [...byRepo.entries()]
      .map(([repoPath, sessionCount]) => ({
        repoPath,
        name: basename(repoPath) || repoPath,
        sessionCount
      }))
      .sort((left, right) => right.sessionCount - left.sessionCount);
  }

  /** Read-only: groups the automation browser's open ChatGPT tabs by project slug. */
  async discoverChatGptProjects(cdpUrl?: string): Promise<ChatGptProjectDiscovery[]> {
    try {
      return await discoverChatGptProjectsFromBrowser(
        cdpUrl ?? this.options.chatgptCdpUrl ?? DEFAULT_CHATGTP_CDP_URL,
        this.options.chatgptFetch
      );
    } catch (error) {
      if (error instanceof DesktopApplicationError) throw error;
      throw new DesktopApplicationError("CHATGPT_PROJECT_DISCOVERY_FAILED", messageOf(error));
    }
  }

  /** Read-only: returns the active OpenCode Desktop session for the "use active" shortcut. */
  async scanActiveOpenCodeProject(): Promise<OpenCodeDesktopSession> {
    try {
      const found = await (this.options.openCodeDesktopScan ?? scanOpenCodeDesktopActiveSession)();
      if (!found.repoPath) {
        throw new DesktopApplicationError(
          "OPENCODE_DESKTOP_SESSION_NOT_FOUND",
          "The active OpenCode Desktop session has no project directory. Open a session inside a project folder, then scan again."
        );
      }
      return found;
    } catch (error) {
      if (error instanceof DesktopApplicationError) throw error;
      if (error instanceof OpenCodeDesktopStateError) {
        throw new DesktopApplicationError(error.code, error.message);
      }
      throw new DesktopApplicationError(
        "OPENCODE_DESKTOP_SESSION_NOT_FOUND",
        `Could not detect the active OpenCode Desktop session: ${messageOf(error)}`
      );
    }
  }

  private opencodeBaseUrl(): string {
    return (
      this.options.opencodeBaseUrl ??
      process.env.AGENT_RELAY_OPENCODE_BASE_URL ??
      DEFAULT_OPENCODE_BASE_URL
    );
  }
}

export function suggestProjectPairId(repoPath: string, projectSlug: string): string {
  const base =
    basename(repoPath)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project";
  const tail = projectSlug.replace(/^g-p-/, "").replace(/[^a-z0-9]/gi, "").toLowerCase().slice(-6) || "chat";
  return `${base}-${tail}`;
}

function toProjectPairError(error: unknown): DesktopApplicationError {
  if (error instanceof DesktopApplicationError) return error;
  if (error instanceof ProjectPairRepositoryError || error instanceof ProjectPairConfigError) {
    const code =
      error instanceof ProjectPairRepositoryError ? error.code : "CONFIG_INVALID";
    return new DesktopApplicationError(code, error.message);
  }
  if (error instanceof ChatGptProjectDiscoveryError) {
    return new DesktopApplicationError("CHATGPT_PROJECT_DISCOVERY_FAILED", error.message);
  }
  return new DesktopApplicationError("APPLICATION_ERROR", messageOf(error));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
