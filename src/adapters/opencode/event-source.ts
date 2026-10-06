import { interruptibleSleep } from "../../util/async.js";
import { credentialsAllowed } from "../../util/net.js";

export interface OpenCodeSessionEvent {
  sessionId: string;
  type: string;
  id?: string;
  seq?: number;
  messageId?: string;
  observedAt: string;
}

export interface OpenCodeEventSourceOptions {
  baseUrl: string;
  username?: string;
  password?: string;
  passwordEnv?: string;
  fetch?: typeof fetch;
  reconnectDelayMs?: number;
  now?: () => Date;
  /** See `OpenCodeClientOptions.allowInsecureAuth`. */
  allowInsecureAuth?: boolean;
}

export interface OpenCodeEventSource {
  subscribe(
    sessionId: string,
    signal: AbortSignal,
    options?: { afterSeq?: number }
  ): AsyncIterable<OpenCodeSessionEvent>;
}

export class HttpOpenCodeEventSource implements OpenCodeEventSource {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly reconnectDelayMs: number;
  private readonly now: () => Date;
  private readonly authHeader?: string;

  constructor(options: OpenCodeEventSourceOptions) {
    this.baseUrl = options.baseUrl.endsWith("/") ? options.baseUrl.slice(0, -1) : options.baseUrl;
    this.fetchImpl = options.fetch ?? fetch;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1000;
    this.now = options.now ?? (() => new Date());
    const password =
      options.password ??
      (options.passwordEnv ? process.env[options.passwordEnv] : undefined) ??
      process.env.AGENT_RELAY_OPENCODE_PASSWORD ??
      process.env.OPENCODE_SERVER_PASSWORD;
    const username = options.username ?? process.env.AGENT_RELAY_OPENCODE_USERNAME;
    if ((Boolean(username) || Boolean(password)) && credentialsAllowed(this.baseUrl, options.allowInsecureAuth)) {
      this.authHeader = `Basic ${Buffer.from(`${username ?? "opencode"}:${password ?? ""}`).toString("base64")}`;
    }
  }

  async *subscribe(
    sessionId: string,
    signal: AbortSignal,
    options?: { afterSeq?: number }
  ): AsyncIterable<OpenCodeSessionEvent> {
    let lastSeq = validSequence(options?.afterSeq);

    while (!signal.aborted) {
      const url = this.buildUrl(sessionId, lastSeq);

      try {
        const response = await this.fetchImpl(url, {
          headers: {
            accept: "text/event-stream",
            ...(this.authHeader ? { authorization: this.authHeader } : {})
          },
          signal
        });

        if (!response.ok) {
          throw new Error(`OpenCode event source returned HTTP ${response.status}`);
        }

        if (!response.body) {
          throw new Error("OpenCode event source response has no body");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (!signal.aborted) {
            const { value, done } = await reader.read();
            if (done) {
              buffer += decoder.decode();
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const events = this.parseSseBuffer(buffer);
            buffer = events.remaining;

            for (const event of events.parsed) {
              const normalized = this.normalizeEvent(sessionId, event);
              if (normalized) {
                if (normalized.seq !== undefined) {
                  if (lastSeq !== undefined && normalized.seq <= lastSeq) {
                    continue;
                  }
                  lastSeq = normalized.seq;
                }
                yield normalized;
              }
            }
          }
        } finally {
          try {
            await reader.cancel();
          } catch {
            // ignore cancel errors
          }
        }
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        if (signal.aborted) {
          return;
        }
        // Stream ended or error occurred; will reconnect below
      }

      if (signal.aborted) {
        return;
      }

      try {
        await interruptibleSleep(this.reconnectDelayMs, signal);
      } catch {
        return;
      }
    }
  }

  private buildUrl(sessionId: string, afterSeq?: number): string {
    const encoded = encodeURIComponent(sessionId);
    const path = `/api/session/${encoded}/event`;
    if (afterSeq !== undefined) {
      return `${this.baseUrl}${path}?after=${afterSeq}`;
    }
    return `${this.baseUrl}${path}`;
  }

  private parseSseBuffer(buffer: string): { parsed: SseEvent[]; remaining: string } {
    const parsed: SseEvent[] = [];
    let remaining = buffer;

    while (true) {
      const boundary = /\r?\n\r?\n/.exec(remaining);
      if (!boundary || boundary.index === undefined) {
        break;
      }

      const eventBlock = remaining.slice(0, boundary.index);
      remaining = remaining.slice(boundary.index + boundary[0].length);

      const event = this.parseSseEvent(eventBlock);
      if (event) {
        parsed.push(event);
      }
    }

    return { parsed, remaining };
  }

  private parseSseEvent(block: string): SseEvent | null {
    const lines = block.split(/\r?\n/);
    const dataLines: string[] = [];
    let eventType = "message";
    let eventId: string | undefined;

    for (const line of lines) {
      if (line.startsWith(":")) {
        continue; // comment/heartbeat
      }

      if (line.startsWith("data:")) {
        dataLines.push(stripOptionalSpace(line.slice(5)));
      } else if (line.startsWith("event:")) {
        eventType = stripOptionalSpace(line.slice(6)).trim() || "message";
      } else if (line.startsWith("id:")) {
        eventId = stripOptionalSpace(line.slice(3)).trim() || undefined;
      }
    }

    if (dataLines.length === 0) {
      return null;
    }

    return { data: dataLines.join("\n"), eventType, eventId };
  }

  private normalizeEvent(sessionId: string, sse: SseEvent): OpenCodeSessionEvent | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(sse.data);
    } catch {
      return null; // malformed JSON, skip
    }

    const payload = recordOf(parsed);
    if (!payload) {
      return null;
    }

    const type = nonEmptyString(payload.type) ?? sse.eventType;
    const id = nonEmptyString(payload.id) ?? sse.eventId;
    const durable = recordOf(payload.durable);
    const seq = validSequence(payload.seq) ?? validSequence(durable?.seq);
    const messageId = this.extractMessageId(payload);

    return {
      sessionId,
      type,
      id,
      seq,
      messageId,
      observedAt: this.now().toISOString()
    };
  }

  private extractMessageId(payload: Record<string, unknown>): string | undefined {
    const data = recordOf(payload.data);
    const message = recordOf(data?.message);
    const part = recordOf(data?.part);
    const candidates = [
      payload.messageId,
      payload.messageID,
      data?.messageId,
      data?.messageID,
      message?.id,
      message?.messageId,
      message?.messageID,
      part?.messageId,
      part?.messageID
    ];
    for (const candidate of candidates) {
      const value = nonEmptyString(candidate);
      if (value) {
        return value;
      }
    }
    return undefined;
  }
}

interface SseEvent {
  data: string;
  eventType: string;
  eventId?: string;
}

function stripOptionalSpace(value: string): string {
  return value.startsWith(" ") ? value.slice(1) : value;
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function validSequence(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
}
