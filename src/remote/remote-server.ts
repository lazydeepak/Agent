/**
 * Agent-relay codebase — module explanation / info.
 * File: src/remote/remote-server.ts
 * Purpose: Optional HTTP control API (service start only).
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { RuntimeStatusSummary } from "../runtime/index.js";
import type { ControlPlaneAdapter, SafeRemoteEvent } from "../application/control-plane-adapter.js";

export interface RemoteTimelineEntry {
  time: string;
  pairId?: string;
  projectPairId?: string;
  type: string;
  state?: string;
  previousState?: string;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface RemoteServiceOptions {
  host?: string;
  port?: number;
  token?: string;
  /**
   * Opt in to binding a non-loopback address. Non-loopback binds expose the control plane to the
   * network and are refused unless this flag (or `RELAY_REMOTE_PUBLIC=1`) is set explicitly.
   */
  allowPublicBind?: boolean;
  /** Overridable for tests. */
  clock?: () => number;
  adapter: ControlPlaneAdapter | {
    getStatus(): RuntimeStatusSummary | Promise<RuntimeStatusSummary>;
    getTimeline(pairId?: string, limit?: number): RemoteTimelineEntry[] | Promise<RemoteTimelineEntry[]>;
    startProject(projectPairId: string): Promise<RuntimeStatusSummary | unknown>;
    pauseProject(projectPairId: string): Promise<RuntimeStatusSummary | unknown>;
    subscribeEvents?(listener: (event: SafeRemoteEvent) => void): () => void;
    dispatch?(op: { type: string; payload?: unknown }): Promise<unknown>;
  };
}

export type RemoteResponse =
  | {
      ok: true;
      data?: unknown;
    }
  | {
      ok: false;
      error: { code: string; message: string };
    };

const MAX_BODY_BYTES = 64 * 1024;
const MAX_TIMELINE_LIMIT = 200;
const DEFAULT_TIMELINE_LIMIT = 50;
const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const MAX_ID_LENGTH = 64;
const AUTH_FAILURE_WINDOW_MS = 5 * 60 * 1000;
const AUTH_FAILURE_LIMIT = 10;

function sendResponse(res: ServerResponse, status: number, payload: RemoteResponse): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(JSON.stringify(payload));
}

function deny(res: ServerResponse, status: number, code: string, message: string): void {
  sendResponse(res, status, { ok: false, error: { code, message } });
}

/** Constant-time token comparison: hash both sides so length is never leaked by timing. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}

function isValidId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH && ID_PATTERN.test(value);
}

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_TIMELINE_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_TIMELINE_LIMIT;
  return Math.min(parsed, MAX_TIMELINE_LIMIT);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) return undefined;
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * Known, safe-to-surface application error codes. Anything else is reported as a generic
 * failure so internal messages and paths are never reflected to the caller.
 */
function applicationErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z][A-Z0-9_]{2,39}$/.test(code)) return code;
  }
  return "APPLICATION_ERROR";
}

export function createRemoteServer(options: RemoteServiceOptions): {
  server: ReturnType<typeof createServer>;
  close: () => Promise<void>;
} {
  const host = options.host ?? process.env.RELAY_REMOTE_HOST ?? "127.0.0.1";
  const port = options.port ?? Number(process.env.RELAY_REMOTE_PORT ?? 8181);
  const token = options.token ?? process.env.RELAY_REMOTE_TOKEN ?? "";
  if (!token) {
    throw new Error(
      "RELAY_REMOTE_TOKEN is required: refusing to start the remote API without an explicit bearer token."
    );
  }
  const allowPublicBind =
    options.allowPublicBind ?? (process.env.RELAY_REMOTE_PUBLIC === "1" || process.env.RELAY_REMOTE_PUBLIC === "true");
  if (!isLoopbackHost(host) && !allowPublicBind) {
    throw new Error(
      `Refusing to bind the remote API to "${host}": set RELAY_REMOTE_PUBLIC=1 (or allowPublicBind) to expose it beyond loopback.`
    );
  }
  const clock = options.clock ?? (() => Date.now());
  const adapterObj = options.adapter as { getStatus?: () => unknown; getTimeline?: (pairId?: string, limit?: number) => unknown; startProject?: (id: string) => unknown; pauseProject?: (id: string) => unknown; subscribeEvents?: (listener: (event: SafeRemoteEvent) => void) => () => void; dispatch?: (op: { type: string; payload?: unknown }) => Promise<unknown> };
  const authFailures = new Map<string, number[]>();
  const eventSubscriptions = new Map<string, () => void>();

  const server = createServer(async (req, res) => {
    const clientKey = req.socket.remoteAddress ?? "unknown";
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const authHeader = req.headers.authorization ?? "";
      const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      if (!tokenMatches(provided, token)) {
        const now = clock();
        const recent = (authFailures.get(clientKey) ?? []).filter((at) => now - at < AUTH_FAILURE_WINDOW_MS);
        recent.push(now);
        authFailures.set(clientKey, recent);
        if (recent.length > AUTH_FAILURE_LIMIT) {
          deny(res, 429, "TOO_MANY_AUTH_FAILURES", "Too many failed authentication attempts.");
          return;
        }
        deny(res, 401, "AUTH_REQUIRED", "Valid token required.");
        return;
      }
      authFailures.delete(clientKey);

      const method = req.method ?? "GET";
      const path = url.pathname;

      if (path === "/health" || path === "/status") {
        if (method !== "GET") {
          deny(res, 405, "METHOD_NOT_ALLOWED", "Use GET.");
          return;
        }
        try {
          const summary = (await Promise.resolve(adapterObj.getStatus?.())) ?? { pairs: [] };
          sendResponse(res, 200, {
            ok: true,
            data: path === "/health" ? { status: "ready" } : summary
          });
        } catch {
          deny(res, 500, "STATUS_FAILED", "Status retrieval failed.");
        }
        return;
      }

      if (path === "/timeline") {
        if (method !== "GET") {
          deny(res, 405, "METHOD_NOT_ALLOWED", "Use GET.");
          return;
        }
        const rawPairId = url.searchParams.get("pairId");
        const pairId = rawPairId !== null && isValidId(rawPairId) ? rawPairId : undefined;
        const limit = parseLimit(url.searchParams.get("limit"));
        try {
          const result = (await Promise.resolve(adapterObj.getTimeline?.(pairId, limit))) ?? [];
          sendResponse(res, 200, { ok: true, data: result });
        } catch {
          deny(res, 500, "TIMELINE_FAILED", "Timeline retrieval failed.");
        }
        return;
      }

      const projectAction = path === "/start-project" ? "startProject" : path === "/pause-project" ? "pauseProject" : undefined;
      if (projectAction) {
        if (method !== "POST") {
          deny(res, 405, "METHOD_NOT_ALLOWED", "Use POST.");
          return;
        }
        const body = await readJsonBody(req);
        if (!body) {
          deny(res, 400, "INVALID_BODY", "Request body must be a JSON object of at most 64 KB.");
          return;
        }
        if (!isValidId(body.projectPairId)) {
          deny(res, 400, "INVALID_PROJECT_PAIR_ID", "A valid projectPairId is required.");
          return;
        }
        try {
          const actionMethod = adapterObj[projectAction === "startProject" ? "startProject" : "pauseProject"];
          if (!actionMethod) {
            throw new Error("Unknown project action.");
          }
          const result = await Promise.resolve(actionMethod(body.projectPairId));
          sendResponse(res, 200, { ok: true, data: result ?? { aggregate: "success" } });
        } catch (error) {
          deny(res, 500, applicationErrorCode(error), "The request could not be completed.");
        }
        return;
      }

      if (path === "/events") {
        if (method !== "GET") {
          deny(res, 405, "METHOD_NOT_ALLOWED", "Use GET.");
          return;
        }
        const subscribeFn = adapterObj.subscribeEvents;
        if (!subscribeFn) {
          deny(res, 501, "NOT_IMPLEMENTED", "Event streaming is not available for this adapter.");
          return;
        }
        try {
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            "connection": "keep-alive",
            "x-content-type-options": "nosniff",
          });
          const subscriptionId = `evt-sub-${clientKey}-${Date.now()}`;
          const unsubscribe = subscribeFn((event: SafeRemoteEvent) => {
            try {
              res.write(`id: ${event.id}\n`);
              res.write(`event: control\n`);
              res.write(`data: ${JSON.stringify(event)}\n\n`);
            } catch {
              // Client disconnected; ignore write errors
            }
          });
          eventSubscriptions.set(subscriptionId, unsubscribe);

          // Keepalive heartbeat every 30 seconds
          const heartbeatInterval = setInterval(() => {
            try {
              res.write(`: heartbeat\n\n`);
            } catch {
              // Client disconnected
            }
          }, 30000);

          req.on("close", () => {
            clearInterval(heartbeatInterval);
            const unsub = eventSubscriptions.get(subscriptionId);
            if (unsub) {
              try { unsub(); } catch { /* best-effort */ }
              eventSubscriptions.delete(subscriptionId);
            }
          });
        } catch (error) {
          if (!res.headersSent) {
            deny(res, 500, applicationErrorCode(error), "The request could not be completed.");
          }
        }
        return;
      }

      if (path === "/attention") {
        if (method === "GET") {
          try {
            const result = await Promise.resolve(adapterObj.getStatus?.());
            const adapterLike = adapterObj as { subscribeEvents?: (listener: (event: SafeRemoteEvent) => void) => () => void };
            sendResponse(res, 200, { ok: true, data: { status: "attention-ready", adapterHasEvents: !!adapterLike.subscribeEvents } });
          } catch {
            deny(res, 500, "ATTENTION_STATUS_FAILED", "Attention status retrieval failed.");
          }
          return;
        }
        deny(res, 404, "NOT_FOUND", "Unknown endpoint.");
        return;
      }

      if (path === "/dispatch" && method === "POST") {
        const body = await readJsonBody(req);
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          deny(res, 400, "INVALID_BODY", "Request body must be a JSON object of at most 64 KB.");
          return;
        }
        try {
          const result = await Promise.resolve(adapterObj.dispatch?.({ type: String((body as Record<string, unknown>).type ?? ""), payload: (body as Record<string, unknown>).payload }));
          sendResponse(res, 200, { ok: true, data: result ?? undefined });
        } catch (error) {
          deny(res, 500, applicationErrorCode(error), "Dispatch failed.");
        }
        return;
      }

      if (path === "/attention/proposals" && method === "GET") {
        try {
          const urlObj = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
          const rawPairId = urlObj.searchParams.get("pairId");
          const rawStatus = urlObj.searchParams.get("status");
          const payload = { pairId: rawPairId || undefined, status: rawStatus || undefined };
          const result = await Promise.resolve(adapterObj.dispatch?.({ type: "listAttentionProposals", payload }));
          sendResponse(res, 200, { ok: true, data: result ?? [] });
        } catch {
          deny(res, 500, "ATTENTION_PROPOSALS_LIST_FAILED", "Proposal list retrieval failed.");
        }
        return;
      }

      if (path === "/attention/proposal" && method === "POST") {
        const body = await readJsonBody(req);
        if (!body || typeof body !== "object") {
          deny(res, 400, "INVALID_BODY", "Request body must be a JSON object.");
          return;
        }
        try {
          const result = await Promise.resolve(adapterObj.dispatch?.({ type: "createAttentionProposal", payload: body }));
          sendResponse(res, 200, { ok: true, data: result ?? { status: "PENDING" } });
        } catch (error) {
          deny(res, 500, applicationErrorCode(error), "Proposal creation failed.");
        }
        return;
      }

      if (path === "/attention/proposal/approve" && method === "POST") {
        const body = await readJsonBody(req);
        if (!body || typeof body !== "object" || !(body as Record<string, unknown>).proposalId) {
          deny(res, 400, "INVALID_BODY", "Proposal approval requires proposalId.");
          return;
        }
        try {
          const result = await Promise.resolve(adapterObj.dispatch?.({ type: "approveAttentionProposal", payload: { proposalId: String((body as Record<string, unknown>).proposalId) } }));
          sendResponse(res, 200, { ok: true, data: result ?? { status: "APPROVED" } });
        } catch (error) {
          deny(res, 500, applicationErrorCode(error), "Proposal approval failed.");
        }
        return;
      }

      if (path === "/attention/proposal/reject" && method === "POST") {
        const body = await readJsonBody(req);
        if (!body || typeof body !== "object" || !(body as Record<string, unknown>).proposalId) {
          deny(res, 400, "INVALID_BODY", "Proposal rejection requires proposalId.");
          return;
        }
        try {
          const result = await Promise.resolve(adapterObj.dispatch?.({ type: "rejectAttentionProposal", payload: { proposalId: String((body as Record<string, unknown>).proposalId) } }));
          sendResponse(res, 200, { ok: true, data: result ?? { status: "REJECTED" } });
        } catch (error) {
          deny(res, 500, applicationErrorCode(error), "Proposal rejection failed.");
        }
        return;
      }

      deny(res, 404, "NOT_FOUND", "Unknown endpoint.");
    } catch {
      deny(res, 500, "INTERNAL", "The request could not be completed.");
    }
  });

  return {
    server,
    close: () =>
      new Promise<void>((resolve) => {
        authFailures.clear();
        for (const unsub of eventSubscriptions.values()) {
          try { unsub(); } catch { /* best-effort */ }
        }
        eventSubscriptions.clear();
        server.close(() => resolve());
      })
  };
}
