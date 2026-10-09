/**
 * Agent-relay codebase — module explanation / info.
 * File: src/application/attention-service.ts
 * Purpose: Source module for attention-service.ts.
 */
import type { DesktopApplicationService } from "./desktop-service.js";
import type { RelayStore } from "../persistence/index.js";
import { parseWorkerAttentionEnvelope } from "./attention-parser.js";
import type { AttentionItem, AttentionStatus } from "../contracts/attention.js";

export interface AttentionServiceOptions {
  service: DesktopApplicationService;
  store: RelayStore;
}

export class AttentionService {
  constructor(private readonly options: AttentionServiceOptions) {}

  getService(): DesktopApplicationService {
    return this.options.service;
  }

  async observeWorkerResponse(pairId: string, sourceMessageId: string, text: string): Promise<AttentionItem | undefined> {
    const envelope = parseWorkerAttentionEnvelope(text);
    if (!envelope) {
      // Unmarked message - ordinary report; no attention item created.
      return undefined;
    }

    // Avoid duplicate open items for the same source message
    const existing = this.options.store.getAttentionItemBySource(pairId, sourceMessageId);
    if (existing && existing.status !== "resolved") {
      return this.fetchById(existing.id);
    }

    const id = this.options.store.createAttentionItem({
      pairId,
      sourceMessageId,
      kind: envelope.kind,
      blocking: envelope.blocking,
      status: envelope.blocking ? "open" : "open",
      summary: text.length > 200 ? text.slice(0, 200) + "..." : text,
      question: envelope.kind === "question" || envelope.kind === "blocked" ? text : undefined,
    });
    return this.fetchById(id);
  }

  listAttention(pairId?: string, status?: AttentionStatus): AttentionItem[] {
    const raw = this.options.store.listAttentionItems(pairId, status ?? undefined);
    return raw.map((r) => ({
      id: String(r.id),
      pairId: r.pairId,
      kind: r.kind as AttentionItem["kind"],
      createdAt: r.createdAt,
      blocking: r.blocking,
      status: r.status as AttentionStatus,
      summary: r.summary,
      sourceMessageId: r.sourceMessageId,
      question: r.question,
      acknowledgedAt: r.acknowledgedAt,
      resolvedAt: r.resolvedAt,
      resolvedByMessageId: r.resolvedByMessageId,
    }));
  }

  acknowledge(id: number): AttentionItem | undefined {
    this.options.store.updateAttentionStatus(id, "acknowledged");
    return this.fetchNumeric(id);
  }

  resolve(id: number, plannerSourceMessageId?: string): AttentionItem | undefined {
    this.options.store.updateAttentionStatus(id, "resolved", plannerSourceMessageId);
    return this.fetchNumeric(id);
  }

  private fetchNumeric(id: number): AttentionItem | undefined {
    const items = this.options.store.listAttentionItems();
    const item = items.find((i) => i.id === id);
    if (!item) return undefined;
    return {
      id: String(item.id),
      pairId: item.pairId,
      kind: item.kind as AttentionItem["kind"],
      createdAt: item.createdAt,
      blocking: item.blocking,
      status: item.status as AttentionStatus,
      summary: item.summary,
      sourceMessageId: item.sourceMessageId,
      question: item.question,
      acknowledgedAt: item.acknowledgedAt,
      resolvedAt: item.resolvedAt,
      resolvedByMessageId: item.resolvedByMessageId,
    };
  }

  private fetchById(id: number): AttentionItem | undefined {
    return this.fetchNumeric(id);
  }
}
