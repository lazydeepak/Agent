/**
 * Agent-relay codebase — module explanation / info.
 * File: src/application/worker-transcript-service.ts
 * Purpose: Worker transcript / session summary service.
 */
import { resolve } from "node:path";
import { LiveOpenCodeAdapter } from "../adapters/opencode/index.js";
import { OpenCodeHttpClient, type OpenCodeClientOptions } from "../adapters/opencode/http.js";
import type { SessionPair } from "../types.js";
import type { WorkerTranscript } from "../contracts/worker-transcript.js";

/** Read the same API as the relay, never the server's potentially stale legacy UI. */
export async function readWorkerTranscript(pair: SessionPair, options: OpenCodeClientOptions = {}): Promise<WorkerTranscript> {
  const config = { ...options, ...pair.worker.server, allowInsecureAuth: true };
  const client = new OpenCodeHttpClient(config);
  const session = await client.getSession(pair.worker.sessionId);
  const directory = session.directory ?? session.location?.directory;
  if (session.id !== pair.worker.sessionId || !directory || resolve(directory) !== resolve(pair.worker.repoPath)) {
    throw new Error("Worker session/repository mismatch; transcript refused.");
  }
  const [messages, observation] = await Promise.all([
    client.listSessionMessages(pair.worker.sessionId),
    new LiveOpenCodeAdapter(config).observeWorkerSession(pair.worker)
  ]);
  return {
    sessionId: session.id, repoPath: directory, title: session.title ?? session.id,
    model: session.model ? `${session.model.providerID}/${session.model.id}` : "Unknown",
    checkedAt: new Date().toISOString(), running: observation.running === true,
    waitingForInput: observation.waitingForInput === true,
    messages: messages.map(message => ({
      id: message.id ?? message.info?.id ?? "unknown",
      role: message.role ?? message.info?.role ?? message.type ?? "unknown",
      createdAt: message.time?.created ?? message.info?.time?.created ?? 0,
      text: visibleText(message.text ?? message.content ?? message.parts).slice(0, 64000)
    })).sort((a, b) => a.createdAt - b.createdAt).slice(-40)
  };
}

function visibleText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(visibleText).filter(Boolean).join("\n");
  if (!value || typeof value !== "object") return "";
  const part = value as Record<string, unknown>;
  if (part.type === "text" && typeof part.text === "string") return part.text;
  if (part.type === "tool") {
    const state = part.state as { status?: string } | undefined;
    return `[Tool: ${String(part.name ?? part.tool ?? "unknown")} — ${state?.status ?? "unknown"}]`;
  }
  return ""; // Never expose hidden reasoning or raw tool payloads.
}
