import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseProjectPairsConfig, ProjectPairConfigError } from "../src/sessions/project-pairs.js";
import { ProjectPairRepository } from "../src/application/project-pair-repository.js";
import {
  ProjectPairService,
  suggestProjectPairId
} from "../src/application/project-pair-service.js";
import { DesktopApplicationError } from "../src/application/desktop-service.js";
import {
  discoverChatGptProjects,
  groupChatGptProjects,
  normalizeChatGptProject
} from "../src/adapters/chatgpt/project-discovery.js";

const SUSANKHYA_SLUG = "g-p-deadbeefcafef00ddeadbeefcafef00d";
const SUSANKHYA_URL = `https://chatgpt.com/g/${SUSANKHYA_SLUG}/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`;
const AGENT_RELAY_SLUG = "g-p-0123456789abcdef0123456789abcdef";

function validPair(overrides: Record<string, unknown> = {}) {
  return {
    projectPairId: "susankhya-os",
    worker: { repoPath: "/Users/x/Susankhya" },
    planner: { projectSlug: SUSANKHYA_SLUG },
    ...overrides
  };
}

describe("project pairs config schema", () => {
  it("accepts a valid project pairs config", () => {
    expect(parseProjectPairsConfig({ projectPairs: [validPair()] })).toEqual({
      projectPairs: [validPair()]
    });
  });

  it("accepts an empty project pairs config", () => {
    expect(parseProjectPairsConfig({ projectPairs: [] })).toEqual({ projectPairs: [] });
  });

  it("rejects an invalid projectPairId", () => {
    expect(() => parseProjectPairsConfig({ projectPairs: [validPair({ projectPairId: "Susankhya" })] }))
      .toThrowError(ProjectPairConfigError);
  });

  it("rejects a relative repoPath", () => {
    expect(() =>
      parseProjectPairsConfig({ projectPairs: [validPair({ worker: { repoPath: "dev/Susankhya" } })] })
    ).toThrowError(/absolute/);
  });

  it("rejects a malformed ChatGPT project slug", () => {
    expect(() =>
      parseProjectPairsConfig({ projectPairs: [validPair({ planner: { projectSlug: "not-a-project" } })] })
    ).toThrowError(/projectSlug/);
  });

  it("accepts a UUID-style ChatGPT project slug with embedded hyphens", () => {
    const slug = "g-p-6a9285a5-0528-83ee-ac88-d7af13e977dd";
    expect(parseProjectPairsConfig({ projectPairs: [validPair({ planner: { projectSlug: slug } })] })).toEqual({
      projectPairs: [validPair({ planner: { projectSlug: slug } })]
    });
  });

  it("rejects duplicate projectPairIds", () => {
    expect(() => parseProjectPairsConfig({ projectPairs: [validPair(), validPair()] }))
      .toThrowError(/Duplicate projectPairId/);
  });

  it("rejects the same OpenCode repo in two project pairs", () => {
    expect(() =>
      parseProjectPairsConfig({
        projectPairs: [validPair(), validPair({ projectPairId: "other", planner: { projectSlug: AGENT_RELAY_SLUG } })]
      })
    ).toThrowError(/Duplicate worker project ownership/);
  });

  it("rejects the same ChatGPT project in two project pairs", () => {
    expect(() =>
      parseProjectPairsConfig({
        projectPairs: [validPair(), validPair({ projectPairId: "other", worker: { repoPath: "/Users/x/Other" } })]
      })
    ).toThrowError(/Duplicate planner project ownership/);
  });
});

describe("normalizeChatGptProject", () => {
  it("accepts a bare slug", () => {
    expect(normalizeChatGptProject(SUSANKHYA_SLUG)).toEqual({ slug: SUSANKHYA_SLUG });
  });

  it("splits the display-name suffix from the slug", () => {
    expect(normalizeChatGptProject(`${SUSANKHYA_SLUG}-demo-project`)).toEqual({
      slug: SUSANKHYA_SLUG,
      name: "demo project"
    });
  });

  it("accepts a full project conversation URL", () => {
    expect(normalizeChatGptProject(SUSANKHYA_URL)).toEqual({ slug: SUSANKHYA_SLUG });
  });

  it("keeps a UUID-style hyphenated slug intact instead of splitting a display name", () => {
    const uuidSlug = "g-p-6a9285a5-0528-83ee-ac88-d7af13e977dd";
    expect(normalizeChatGptProject(uuidSlug)).toEqual({ slug: uuidSlug });
    expect(normalizeChatGptProject(`https://chatgpt.com/g/${uuidSlug}/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`)).toEqual({
      slug: uuidSlug
    });
  });

  it("splits a display-name suffix after a UUID-style slug", () => {
    const uuidSlug = "g-p-6a9285a5-0528-83ee-ac88-d7af13e977dd";
    expect(normalizeChatGptProject(`${uuidSlug}-demo-project`)).toEqual({
      slug: uuidSlug,
      name: "demo project"
    });
  });

  it("rejects a plain conversation URL without a project segment", () => {
    expect(() => normalizeChatGptProject("https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"))
      .toThrowError(/without a \/g\/<project> segment/);
  });

  it("rejects garbage", () => {
    expect(() => normalizeChatGptProject("hello")).toThrowError(/Could not read a ChatGPT project/);
    expect(() => normalizeChatGptProject("  ")).toThrowError(/required/);
  });
});

describe("groupChatGptProjects", () => {
  it("groups open conversation pages by project slug and skips the rest", () => {
    const grouped = groupChatGptProjects([
      { type: "page", title: "Demo - Relay Sessions", url: `https://chatgpt.com/g/${AGENT_RELAY_SLUG}/c/aaa` },
      { type: "page", title: "Demo Project - Test session", url: SUSANKHYA_URL },
      { type: "page", title: "Same convo, suffixed URL", url: `https://chatgpt.com/g/${SUSANKHYA_SLUG}-demo-project/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee` },
      { type: "page", title: "Plain conversation", url: "https://chatgpt.com/c/plain-conversation" },
      { type: "page", title: "Elsewhere", url: "https://github.com/login" },
      { type: "service_worker", title: "bg", url: SUSANKHYA_URL }
    ]);
    expect(grouped).toHaveLength(2);
    const susankhya = grouped.find((entry) => entry.projectSlug === SUSANKHYA_SLUG);
    expect(susankhya).toMatchObject({
      projectName: "demo project",
      conversationIds: ["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"],
      conversationTitles: { "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee": "Demo Project - Test session" },
      openTabCount: 2
    });
    const relay = grouped.find((entry) => entry.projectSlug === AGENT_RELAY_SLUG);
    expect(relay).toMatchObject({
      conversationIds: ["aaa"],
      conversationTitles: { aaa: "Demo - Relay Sessions" },
      openTabCount: 1
    });
  });

  it("queries the CDP target list read-only", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (input: unknown) => {
      seen.push(String(input));
      return jsonResponse([{ type: "page", title: "t", url: SUSANKHYA_URL }]);
    }) as typeof fetch;
    const result = await discoverChatGptProjects("http://127.0.0.1:9222", fetchImpl);
    expect(seen).toEqual(["http://127.0.0.1:9222/json/list"]);
    expect(result).toHaveLength(1);
    expect(result[0]?.projectSlug).toBe(SUSANKHYA_SLUG);
  });

  it("wraps browser failures", async () => {
    const failing = (async () => {
      throw new Error("connection refused");
    }) as typeof fetch;
    await expect(discoverChatGptProjects("http://127.0.0.1:9222", failing)).rejects.toThrow(/Could not reach/);
  });
});

describe("suggestProjectPairId", () => {
  it("derives a valid id from repo basename and slug tail", () => {
    expect(suggestProjectPairId("/Users/x/Susankhya", SUSANKHYA_SLUG)).toBe("susankhya-fef00d");
  });

  it("sanitizes unusual basenames", () => {
    expect(suggestProjectPairId("/Users/x/My Cool Repo!", AGENT_RELAY_SLUG)).toBe("my-cool-repo-abcdef");
  });
});

describe("ProjectPairRepository", () => {
  async function tempPath(): Promise<{ path: string; cleanup: () => Promise<void> }> {
    const directory = await mkdtemp(join(tmpdir(), "agent-relay-project-pairs-"));
    return { path: join(directory, "projects.json"), cleanup: () => rm(directory, { force: true, recursive: true }) };
  }

  it("loads an empty config when the file is missing", async () => {
    const { path, cleanup } = await tempPath();
    try {
      await expect(new ProjectPairRepository(path).load()).resolves.toEqual({ projectPairs: [] });
    } finally {
      await cleanup();
    }
  });

  it("adds and loads project pairs", async () => {
    const { path, cleanup } = await tempPath();
    try {
      const repo = new ProjectPairRepository(path);
      await repo.addProjectPair(validPair());
      await expect(repo.load()).resolves.toEqual({ projectPairs: [validPair()] });
    } finally {
      await cleanup();
    }
  });

  it("rejects duplicate ids and duplicate ownership", async () => {
    const { path, cleanup } = await tempPath();
    try {
      const repo = new ProjectPairRepository(path);
      await repo.addProjectPair(validPair());
      await expect(repo.addProjectPair(validPair())).rejects.toMatchObject({ code: "PROJECT_PAIR_ALREADY_EXISTS" });
      await expect(
        repo.addProjectPair(validPair({ projectPairId: "other", planner: { projectSlug: AGENT_RELAY_SLUG } }))
      ).rejects.toMatchObject({ code: "DUPLICATE_OWNERSHIP" });
    } finally {
      await cleanup();
    }
  });

  it("removes project pairs and reports unknown ids", async () => {
    const { path, cleanup } = await tempPath();
    try {
      const repo = new ProjectPairRepository(path);
      await repo.addProjectPair(validPair());
      await expect(repo.removeProjectPair("missing")).rejects.toMatchObject({ code: "PROJECT_PAIR_NOT_FOUND" });
      await repo.removeProjectPair("susankhya-os");
      await expect(repo.load()).resolves.toEqual({ projectPairs: [] });
    } finally {
      await cleanup();
    }
  });

  it("rejects an invalid config file", async () => {
    const { path, cleanup } = await tempPath();
    try {
      await writeFile(path, JSON.stringify({ projectPairs: [{ nope: true }] }), "utf8");
      await expect(new ProjectPairRepository(path).load()).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    } finally {
      await cleanup();
    }
  });
});

describe("ProjectPairService", () => {
  async function tempPath(): Promise<{ path: string; cleanup: () => Promise<void> }> {
    const directory = await mkdtemp(join(tmpdir(), "agent-relay-project-pair-svc-"));
    return { path: join(directory, "projects.json"), cleanup: () => rm(directory, { force: true, recursive: true }) };
  }

  function opencodeFetch(sessions: Array<{ id: string; title?: string; directory?: string }>) {
    return (async (input: unknown, init?: { method?: string }) => {
      const url = new URL(String(input));
      if (url.pathname === "/doc") {
        return jsonResponse({ paths: { "/api/health": {}, "/api/session": {} } });
      }
      if ((init?.method ?? "GET") === "GET" && url.pathname === "/api/session") {
        return jsonResponse({
          data: sessions.map((session) => ({
            id: session.id,
            title: session.title,
            location: { directory: session.directory }
          }))
        });
      }
      return jsonResponse({}, 404);
    }) as typeof fetch;
  }

  it("creates, lists, and removes project pairs", async () => {
    const { path, cleanup } = await tempPath();
    try {
      const service = new ProjectPairService({ configPath: path });
      await expect(service.listProjectPairs()).resolves.toEqual([]);
      const created = await service.createProjectPair({
        projectPairId: "susankhya-os",
        worker: { repoPath: "/Users/x/Susankhya" },
        planner: { projectSlug: SUSANKHYA_SLUG }
      });
      expect(created).toEqual(validPair());
      await expect(service.listProjectPairs()).resolves.toEqual([validPair()]);
      await expect(service.removeProjectPair("susankhya-os")).resolves.toEqual({ projectPairId: "susankhya-os" });
      await expect(service.listProjectPairs()).resolves.toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it("suggests an id and normalizes a full ChatGPT project URL", async () => {
    const { path, cleanup } = await tempPath();
    try {
      const service = new ProjectPairService({ configPath: path });
      const created = await service.createProjectPair({
        worker: { repoPath: "/Users/x/Susankhya" },
        planner: { projectSlug: SUSANKHYA_URL }
      });
      expect(created.projectPairId).toBe("susankhya-fef00d");
      expect(created.planner.projectSlug).toBe(SUSANKHYA_SLUG);
    } finally {
      await cleanup();
    }
  });

  it("rejects relative repos and duplicate ownership with application errors", async () => {
    const { path, cleanup } = await tempPath();
    try {
      const service = new ProjectPairService({ configPath: path });
      await expect(
        service.createProjectPair({ worker: { repoPath: "dev/x" }, planner: { projectSlug: SUSANKHYA_SLUG } })
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      await service.createProjectPair({
        projectPairId: "susankhya-os",
        worker: { repoPath: "/Users/x/Susankhya" },
        planner: { projectSlug: SUSANKHYA_SLUG }
      });
      const duplicate = service.createProjectPair({
        projectPairId: "other",
        worker: { repoPath: "/Users/x/Susankhya" },
        planner: { projectSlug: AGENT_RELAY_SLUG }
      });
      await expect(duplicate).rejects.toBeInstanceOf(DesktopApplicationError);
      await expect(duplicate).rejects.toMatchObject({ code: "DUPLICATE_OWNERSHIP" });
      await expect(service.removeProjectPair("missing")).rejects.toMatchObject({ code: "PROJECT_PAIR_NOT_FOUND" });
    } finally {
      await cleanup();
    }
  });

  it("discovers OpenCode projects grouped by repository", async () => {
    const { path, cleanup } = await tempPath();
    try {
      const service = new ProjectPairService({
        configPath: path,
        opencodeFetch: opencodeFetch([
          { id: "s1", title: "one", directory: "/Users/x/Susankhya" },
          { id: "s2", title: "two", directory: "/Users/x/Susankhya" },
          { id: "s3", title: "three", directory: "/Users/x/Other" }
        ])
      });
      await expect(service.discoverOpenCodeProjects()).resolves.toEqual([
        { repoPath: "/Users/x/Susankhya", name: "Susankhya", sessionCount: 2 },
        { repoPath: "/Users/x/Other", name: "Other", sessionCount: 1 }
      ]);
    } finally {
      await cleanup();
    }
  });

  it("wraps OpenCode discovery failures", async () => {
    const { path, cleanup } = await tempPath();
    try {
      const failing = (async () => {
        throw new Error("down");
      }) as typeof fetch;
      const service = new ProjectPairService({ configPath: path, opencodeFetch: failing });
      await expect(service.discoverOpenCodeProjects()).rejects.toMatchObject({ code: "OPENCODE_UNAVAILABLE" });
    } finally {
      await cleanup();
    }
  });

  it("discovers ChatGPT projects through the injected browser fetch", async () => {
    const { path, cleanup } = await tempPath();
    try {
      const chatgptFetch = (async () =>
        jsonResponse([{ type: "page", title: "t", url: SUSANKHYA_URL }])) as typeof fetch;
      const service = new ProjectPairService({ configPath: path, chatgptFetch });
      const projects = await service.discoverChatGptProjects("http://127.0.0.1:9222");
      expect(projects).toHaveLength(1);
      expect(projects[0]).toMatchObject({ projectSlug: SUSANKHYA_SLUG, openTabCount: 1 });
    } finally {
      await cleanup();
    }
  });

  it("scans the active desktop session through the injected scan", async () => {
    const { path, cleanup } = await tempPath();
    try {
      const service = new ProjectPairService({
        configPath: path,
        openCodeDesktopScan: async () => ({ sessionId: "ses_1", repoPath: "/Users/x/Susankhya" })
      });
      await expect(service.scanActiveOpenCodeProject()).resolves.toMatchObject({
        sessionId: "ses_1",
        repoPath: "/Users/x/Susankhya"
      });
      const missing = new ProjectPairService({
        configPath: path,
        openCodeDesktopScan: async () => ({ sessionId: "ses_1" })
      });
      await expect(missing.scanActiveOpenCodeProject()).rejects.toMatchObject({
        code: "OPENCODE_DESKTOP_SESSION_NOT_FOUND"
      });
    } finally {
      await cleanup();
    }
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
