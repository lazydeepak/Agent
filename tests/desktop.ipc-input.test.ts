import { describe, expect, it } from "vitest";
import {
  asAbsolutePath,
  asHttpUrl,
  asLoopbackUrl,
  asNonEmptyString,
  asPairId,
  asProjectPairId,
  castBrowserNested,
  castCandidatePair,
  castEndpointNested,
  castRecentEventsFilter,
  castStartPriming,
  castUpdatePair,
  castUrlInput,
  castWorkerModel,
  castWorkerSessionTitle,
  castCdpUrl,
  castCreateProjectPair,
  castCreateWorkerSession,
  castOpenCodeEndpoint,
  castPlannerEndpoint,
  castStartWorkerServer
} from "../desktop/main/ipc-input.js";

function errorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code ?? "UNKNOWN";
  }
  return "NO_ERROR";
}

describe("ipc input validation: urls", () => {
  it("accepts http and https endpoints", () => {
    expect(asHttpUrl("http://127.0.0.1:4096", "baseUrl")).toBe("http://127.0.0.1:4096/");
    expect(asHttpUrl("https://opencode.example.com", "baseUrl")).toBe("https://opencode.example.com/");
  });

  it("rejects non-http schemes so they cannot reach openExternal or receive credentials", () => {
    for (const value of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,x", "smb://host/share"]) {
      expect(errorCode(() => asHttpUrl(value, "baseUrl"))).toBe("INVALID_URL");
    }
  });

  it("restricts automation endpoints to loopback", () => {
    expect(asLoopbackUrl("http://127.0.0.1:9222", "cdpUrl")).toBe("http://127.0.0.1:9222/");
    expect(asLoopbackUrl("http://localhost:9222", "cdpUrl")).toBe("http://localhost:9222/");
    expect(errorCode(() => asLoopbackUrl("http://attacker.example:9222", "cdpUrl"))).toBe("INVALID_URL");
    expect(errorCode(() => asLoopbackUrl("http://0.0.0.0:9222", "cdpUrl"))).toBe("INVALID_URL");
  });
});

describe("ipc input validation: paths", () => {
  it("requires absolute paths", () => {
    expect(asAbsolutePath("/tmp/repo", "repoPath")).toBe("/tmp/repo");
    expect(errorCode(() => asAbsolutePath("relative/path", "repoPath"))).toBe("INVALID_PATH");
    expect(errorCode(() => asAbsolutePath("  ", "repoPath"))).toBe("INVALID_PATH");
  });
});

describe("ipc input validation: renderer payloads", () => {
  it("validates the worker endpoint inside nested payloads", () => {
    expect(castOpenCodeEndpoint({ baseUrl: "http://127.0.0.1:4096" }).baseUrl).toBe("http://127.0.0.1:4096/");
    expect(errorCode(() => castOpenCodeEndpoint({ baseUrl: "file:///etc" }))).toBe("INVALID_URL");
  });

  it("validates the cdp url", () => {
    expect(castCdpUrl({ cdpUrl: " http://127.0.0.1:9222 " })).toBe("http://127.0.0.1:9222/");
    expect(errorCode(() => castCdpUrl({ cdpUrl: "http://evil.example:9222" }))).toBe("INVALID_URL");
  });

  it("validates planner endpoints", () => {
    expect(castPlannerEndpoint({ cdpUrl: "http://127.0.0.1:9222", conversationUrl: "https://chatgpt.com/c/abc" })).toEqual({
      cdpUrl: "http://127.0.0.1:9222/",
      conversationUrl: "https://chatgpt.com/c/abc"
    });
    expect(errorCode(() => castPlannerEndpoint({ cdpUrl: "http://10.0.0.5:9222" }))).toBe("INVALID_URL");
  });

  it("validates session creation and server start inputs", () => {
    expect(castCreateWorkerSession({ baseUrl: "http://127.0.0.1:4096", repoPath: "/tmp/repo" }).repoPath).toBe("/tmp/repo");
    expect(errorCode(() => castCreateWorkerSession({ repoPath: "relative" }))).toBe("INVALID_PATH");
    expect(castStartWorkerServer({ repoPath: "/tmp/repo", sessionId: "s1" }).sessionId).toBe("s1");
    expect(castStartWorkerServer({ repoPath: "/tmp/repo" }).sessionId).toBeUndefined();
    expect(castStartWorkerServer({ repoPath: "/tmp/repo", sessionId: "" }).sessionId).toBeUndefined();
    expect(errorCode(() => castStartWorkerServer({}))).toBe("INVALID_INPUT");
    expect(errorCode(() => castStartWorkerServer({ repoPath: "relative" }))).toBe("INVALID_PATH");
  });

  it("validates project pair input with neutral worker/planner keys", () => {
    const parsed = castCreateProjectPair({
      projectPairId: "local-dev",
      worker: { repoPath: "/tmp/repo" },
      planner: { projectSlug: "g-p-abc123" }
    });
    expect(parsed).toEqual({
      projectPairId: "local-dev",
      worker: { repoPath: "/tmp/repo" },
      planner: { projectSlug: "g-p-abc123" }
    });
    expect(errorCode(() => castCreateProjectPair({ worker: { repoPath: "relative" }, planner: { projectSlug: "g-p-a" } }))).toBe(
      "INVALID_PATH"
    );
  });
});

describe("ipc input validation: pair & selection values", () => {
  it("accepts pair and project pair ids and non-empty strings", () => {
    expect(asPairId("local-dev")).toBe("local-dev");
    expect(asProjectPairId("proj-a")).toBe("proj-a");
    expect(errorCode(() => asPairId(""))).toBe("INVALID_PAIR_ID");
    expect(errorCode(() => asProjectPairId(42))).toBe("INVALID_PROJECT_PAIR_ID");
    expect(asNonEmptyString("  ", "field")).toBe("  ");
    expect(errorCode(() => asNonEmptyString("", "field"))).toBe("INVALID_INPUT");
  });

  it("validates worker model and session-title inputs", () => {
    expect(castWorkerModel({ providerId: "ollama", modelId: "small", notifyPlanner: true })).toEqual({
      providerId: "ollama",
      modelId: "small",
      notifyPlanner: true
    });
    expect(errorCode(() => castWorkerModel({ providerId: "" }))).toBe("INVALID_INPUT");
    expect(castWorkerSessionTitle({ title: " my title " })).toBe("my title");
    expect(castWorkerSessionTitle(undefined)).toBeUndefined();
    expect(errorCode(() => castWorkerSessionTitle({}))).toBe("INVALID_WORKER_SESSION_TITLE");
    expect(errorCode(() => castWorkerSessionTitle({ title: "  " }))).toBe("INVALID_WORKER_SESSION_TITLE");
  });

  it("accepts the neutral start-priming enumerations only", () => {
    expect(castStartPriming("from-worker")).toBe("from-worker");
    expect(castStartPriming("from-planner")).toBe("from-planner");
    expect(castStartPriming("from-trigger")).toBe("from-trigger");
    expect(castStartPriming(undefined)).toBeUndefined();
    expect(errorCode(() => castStartPriming("from-chatgpt"))).toBe("INVALID_START_PRIMING");
    expect(errorCode(() => castStartPriming("from-opencode"))).toBe("INVALID_START_PRIMING");
  });

  it("normalizes nested worker/planner endpoint and browser fields in big payloads", () => {
    expect(castEndpointNested({ baseUrl: "http://127.0.0.1:4096" })).toEqual({ baseUrl: "http://127.0.0.1:4096/" });
    expect(castBrowserNested({ cdpUrl: "http://127.0.0.1:9222" })).toEqual({ cdpUrl: "http://127.0.0.1:9222/" });
    expect(errorCode(() => castBrowserNested({ cdpUrl: "http://30.0.0.1:9222" }))).toBe("INVALID_URL");
    expect(castRecentEventsFilter({ pairId: "local-dev", limit: 10 })).toEqual({ pairId: "local-dev", limit: 10 });
    expect(castRecentEventsFilter(undefined)).toBeUndefined();
  });

  it("rejects a candidate pair with a malformed worker URL", () => {
    expect(errorCode(() => castCandidatePair({
      pairId: "local-dev",
      worker: { sessionId: "s", repoPath: "/tmp", server: { baseUrl: "file:///etc" } },
      planner: { conversationId: "c", conversationUrl: "https://chatgpt.com/c/c" }
    }))).toBe("INVALID_URL");
  });

  it("validates update-pair nested endpoint changes", () => {
    expect(castUpdatePair({ enabled: true, worker: { server: { baseUrl: "http://127.0.0.1:4096" } } })).toEqual({
      enabled: true,
      worker: { server: { baseUrl: "http://127.0.0.1:4096/" } }
    });
    expect(errorCode(() => castUpdatePair({ worker: { server: { baseUrl: "file:///etc" } } }))).toBe("INVALID_URL");
  });

  it("parse-url input requires a url string", () => {
    expect(castUrlInput({ url: "https://chatgpt.com/c/abc" }).url).toBe("https://chatgpt.com/c/abc");
    expect(errorCode(() => castUrlInput({}))).toBe("INVALID_INPUT");
  });
});
