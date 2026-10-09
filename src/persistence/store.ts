import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  CanonicalRelayIdentity,
  DeliveryStatus,
  PairRelayState,
  RecoveryErrorCode,
  RecoveryPolicy,
  RelayCycle,
  RelayCycleStatus,
  RelayDirection,
  RelayRecord,
  RuntimeMetadata,
  SchedulerMode,
  SupervisorContinuity,
  SupervisorState,
  WorkerMessageClassification
} from "../types.js";

export interface RelayStore {
  init(): Promise<void>;
  close(): void;
  findRecord(identity: CanonicalRelayIdentity): RelayRecord | undefined;
  latestRecord(pairId: string, direction: RelayDirection): RelayRecord | undefined;
  listRecords(pairId: string): RelayRecord[];
  createRecord(
    identity: CanonicalRelayIdentity,
    sourceTimestamp?: number,
    classification?: WorkerMessageClassification
  ): RelayRecord;
  updateStatus(
    identity: CanonicalRelayIdentity,
    status: DeliveryStatus,
    fields: { targetId?: string; error?: string; classification?: WorkerMessageClassification }
  ): RelayRecord | undefined;
  recordFailure(identity: CanonicalRelayIdentity, error: string): RelayRecord | undefined;
  recordDelivered(identity: CanonicalRelayIdentity, targetId: string): RelayRecord | undefined;
  touchPairState(state: Partial<PairRelayState> & { pairId: string }): void;
  getPairState(pairId: string): PairRelayState | undefined;
  touchSupervisorState(state: Partial<Omit<SupervisorContinuity, "pairId">> & { pairId: string }): void;
  clearSupervisorRecoveryError(pairId: string): void;
  getSupervisorState(pairId: string): SupervisorContinuity | undefined;
  touchRuntimeState(state: Partial<Omit<RuntimeMetadata, "pairId">> & { pairId: string }): void;
  getRuntimeState(pairId: string): RuntimeMetadata | undefined;
  touchResumeState(state: { pairId: string; resumeAfterRestart: boolean }): void;
  listResumeState(): Array<{ pairId: string; resumeAfterRestart: boolean }>;
  touchSchedulerMode(
    state: {
      pairId: string;
      schedulerMode: SchedulerMode;
      changedAt?: string;
      dormantReason?: string;
    }
  ): void;
  listRuntimeMetadata(): RuntimeMetadata[];
  createCycle(input: {
    pairId: string;
    plannerSourceMessageId: string;
    workerDispatchMessageId: string;
    dispatchedAt?: string;
  }): RelayCycle;
  updateCycle(
    pairId: string,
    plannerSourceMessageId: string,
    fields: Partial<
      Pick<RelayCycle, "workerResponseMessageId" | "workerCompletedAt" | "plannerDeliveryRecordId" | "cycleStatus">
    >
  ): RelayCycle | undefined;
  getCycleByPlannerSource(pairId: string, plannerSourceMessageId: string): RelayCycle | undefined;
  getCycleByWorkerDispatch(pairId: string, workerDispatchMessageId: string): RelayCycle | undefined;
  listCycles(pairId: string): RelayCycle[];
  listAllPairIds(): string[];
  listNondelivered(): RelayRecord[];
  reconcileAmbiguous(identity: CanonicalRelayIdentity, status: "DELIVERED" | "FAILED", targetId?: string): RelayRecord | undefined;
  purgePairData(pairId: string): void;
  // Attention / worker-question persistence
  createAttentionItem(item: {
    pairId: string;
    sourceMessageId: string;
    kind: string;
    blocking: boolean;
    status?: string;
    summary?: string;
    question?: string;
  }): number;
  listAttentionItems(pairId?: string, status?: string): Array<{
    id: number;
    pairId: string;
    sourceMessageId: string;
    kind: string;
    blocking: boolean;
    status: string;
    summary?: string;
    question?: string;
    createdAt: string;
    acknowledgedAt?: string;
    resolvedAt?: string;
    resolvedByMessageId?: string;
  }>;
  getAttentionItemBySource(pairId: string, sourceMessageId: string): { id: number; status: string } | undefined;
  updateAttentionStatus(id: number, status: string, resolvedByMessageId?: string): void;
  // AI proposal persistence
  createProposal(input: {
    proposalId: string;
    pairId: string;
    attentionId?: number;
    provider: string;
    model?: string;
    disposition: string;
    proposedAnswer?: string;
    rationaleSummary?: string;
  }): number;
  listProposals(pairId?: string, status?: string): Array<{
    id: number;
    proposalId: string;
    pairId: string;
    attentionId?: number;
    provider: string;
    model?: string;
    disposition: string;
    proposedAnswer?: string;
    rationaleSummary?: string;
    status: string;
    createdAt: string;
    approvedAt?: string;
    rejectedAt?: string;
    deliveredAt?: string;
    deliveryRecordId?: number;
  }>;
  getProposalById(id: number): {
    proposalId: string;
    pairId: string;
    attentionId?: number;
    provider: string;
    model?: string;
    disposition: string;
    proposedAnswer?: string;
    rationaleSummary?: string;
    status: string;
    createdAt: string;
    approvedAt?: string;
    rejectedAt?: string;
    deliveredAt?: string;
    deliveryRecordId?: number;
  } | undefined;
  updateProposalStatus(id: number, status: string, deliveryRecordId?: number): void;
}

export class RelayStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelayStoreError";
  }
}

const ATTENTION_SCHEMA = `
CREATE TABLE IF NOT EXISTS attention_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pair_id TEXT NOT NULL,
  source_message_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  blocking INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',
  summary TEXT,
  question TEXT,
  created_at TEXT NOT NULL,
  acknowledged_at TEXT,
  resolved_at TEXT,
  resolved_by_message_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_attention_identity
  ON attention_items (pair_id, source_message_id);
CREATE INDEX IF NOT EXISTS idx_attention_pair ON attention_items (pair_id, status);
`;

const PROPOSAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS ai_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id TEXT NOT NULL,
  pair_id TEXT NOT NULL,
  attention_id INTEGER,
  provider TEXT NOT NULL,
  model TEXT,
  disposition TEXT NOT NULL,
  proposed_answer TEXT,
  rationale_summary TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL,
  approved_at TEXT,
  rejected_at TEXT,
  delivered_at TEXT,
  delivery_record_id INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_proposal_identity
  ON ai_proposals (pair_id, attention_id, proposal_id);
CREATE INDEX IF NOT EXISTS idx_proposal_pair ON ai_proposals (pair_id, status);
`;

const SCHEMA_VERSION = 10;

const RECOVERY_SUPERVISOR_COLUMNS = [
  "candidate_worker_message_id TEXT",
  "candidate_worker_message_hash TEXT",
  "candidate_worker_first_seen_at TEXT",
  "recovery_policy TEXT NOT NULL DEFAULT 'safe'",
  "recovery_attempt_count INTEGER NOT NULL DEFAULT 0",
  "last_recovery_attempt_at TEXT",
  "last_recovery_success_at TEXT",
  "last_recovery_error_code TEXT",
  "last_recovery_error TEXT"
] as const;

const BASE_SCHEMA = `
CREATE TABLE IF NOT EXISTS relay_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pair_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  source_message_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  source_timestamp INTEGER,
  target_id TEXT,
  status TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  delivered_at TEXT,
  last_attempt_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_relay_identity
  ON relay_records (pair_id, direction, source_message_id, source_hash);
CREATE INDEX IF NOT EXISTS idx_relay_pair ON relay_records (pair_id, direction);
CREATE TABLE IF NOT EXISTS pair_state (
  pair_id TEXT PRIMARY KEY,
  last_worker_message_id TEXT,
  last_planner_message_id TEXT,
  last_successful_relay_at TEXT,
  last_direction TEXT,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);
`;

const SUPERVISOR_SCHEMA = `
CREATE TABLE IF NOT EXISTS supervisor_state (
  pair_id TEXT PRIMARY KEY,
  last_supervisor_state TEXT,
  state_changed_at TEXT,
  last_observed_at TEXT,
  last_worker_activity_at TEXT,
  last_planner_activity_at TEXT,
  current_cycle_worker_message_id TEXT,
  current_cycle_planner_message_id TEXT,
  last_planner_side_synced_message_id TEXT,
  last_error TEXT,
  paused INTEGER NOT NULL DEFAULT 0
);
`;

const RUNTIME_SCHEMA = `
CREATE TABLE IF NOT EXISTS runtime_state (
  pair_id TEXT PRIMARY KEY,
  runtime_enabled INTEGER NOT NULL DEFAULT 0,
  last_runtime_start_at TEXT,
  last_runtime_stop_at TEXT,
  last_runtime_error TEXT,
  scheduler_mode TEXT,
  scheduler_mode_changed_at TEXT,
  dormant_reason TEXT,
  resume_after_restart INTEGER NOT NULL DEFAULT 0
);
`;

const RELAY_CYCLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS relay_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pair_id TEXT NOT NULL,
  planner_source_message_id TEXT NOT NULL,
  worker_dispatch_message_id TEXT NOT NULL,
  dispatched_at TEXT,
  worker_response_message_id TEXT,
  worker_completed_at TEXT,
  planner_delivery_record_id INTEGER,
  cycle_status TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_relay_cycle_planner_source
  ON relay_cycles (pair_id, planner_source_message_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_relay_cycle_worker_dispatch
  ON relay_cycles (pair_id, worker_dispatch_message_id);
`;

const RUNTIME_SCHEDULER_COLUMNS = [
  "scheduler_mode TEXT",
  "scheduler_mode_changed_at TEXT",
  "dormant_reason TEXT"
] as const;

export class SqliteRelayStore implements RelayStore {
  private readonly db: DatabaseSync;
  private disposed = false;

  constructor(private readonly dbPath: string) {
    try {
      this.db = new DatabaseSync(dbPath);
    } catch (error) {
      throw toActionableStoreError(error);
    }
  }

  async init(): Promise<void> {
    try {
      this.db.exec("PRAGMA journal_mode = WAL;");
      this.db.exec("PRAGMA synchronous = NORMAL;");
      this.db.exec("PRAGMA busy_timeout = 30000;");
      this.db.exec("BEGIN;");
      this.db.exec(BASE_SCHEMA);
      const row = this.db.prepare("SELECT version FROM schema_version").get() as
        | { version: number }
        | undefined;
      const current = row?.version ?? 0;
      if (current > SCHEMA_VERSION) {
        throw new RelayStoreError(
          `Database schema version ${current} is newer than supported version ${SCHEMA_VERSION}. Upgrade this tool.`
        );
      }
      if (current < 2) {
        this.db.exec(SUPERVISOR_SCHEMA);
      }
      if (current < 3) {
        for (const column of RECOVERY_SUPERVISOR_COLUMNS) {
          if (!this.columnExists("supervisor_state", column.split(" ")[0] as string)) {
            this.db.exec(`ALTER TABLE supervisor_state ADD COLUMN ${column}`);
          }
        }
      }
      if (current < 4) {
        this.db.exec(RUNTIME_SCHEMA);
      }
      if (current < 5) {
        this.db.exec(RELAY_CYCLE_SCHEMA);
        for (const column of RUNTIME_SCHEDULER_COLUMNS) {
          if (!this.columnExists("runtime_state", column.split(" ")[0] as string)) {
            this.db.exec(`ALTER TABLE runtime_state ADD COLUMN ${column}`);
          }
        }
      }
      if (current < 6) {
        if (!this.columnExists("runtime_state", "resume_after_restart")) {
          this.db.exec("ALTER TABLE runtime_state ADD COLUMN resume_after_restart INTEGER NOT NULL DEFAULT 0");
        }
      }
      if (current < 7) {
        if (!this.columnExists("relay_records", "classification")) {
          this.db.exec("ALTER TABLE relay_records ADD COLUMN classification TEXT");
        }
        if (!this.columnExists("supervisor_state", "baseline_worker_message_id")) {
          this.db.exec("ALTER TABLE supervisor_state ADD COLUMN baseline_worker_message_id TEXT");
        }
        if (!this.columnExists("supervisor_state", "baseline_worker_message_created_at")) {
          this.db.exec("ALTER TABLE supervisor_state ADD COLUMN baseline_worker_message_created_at INTEGER");
        }
      }
      if (current < 8) {
        if (!this.columnExists("pair_state", "project_pair_id")) {
          this.db.exec("ALTER TABLE pair_state ADD COLUMN project_pair_id TEXT");
        }
        if (!this.columnExists("supervisor_state", "project_pair_id")) {
          this.db.exec("ALTER TABLE supervisor_state ADD COLUMN project_pair_id TEXT");
        }
      }
      if (current < 9) {
        this.db.exec(ATTENTION_SCHEMA);
      }
      if (current < 10) {
        this.db.exec(PROPOSAL_SCHEMA);
      }
      if (row === undefined) {
        this.db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(SCHEMA_VERSION);
      } else if (current < SCHEMA_VERSION) {
        this.db.prepare("UPDATE schema_version SET version = ?").run(SCHEMA_VERSION);
      }
      this.db.exec("COMMIT;");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK;");
      } catch {
        // rollback may fail on a corrupted database; ignore
      }
      throw toActionableStoreError(error);
    }
  }

  close(): void {
    if (this.disposed) {
      return;
    }
    try {
      this.db.close();
    } catch {
      // Database may be in a bad state; ensure disposed flag is set regardless
    }
    this.disposed = true;
  }

  private columnExists(table: string, column: string): boolean {
    if (!/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(column)) {
      throw new RelayStoreError(`Invalid identifier in columnExists: table=${table}, column=${column}`);
    }
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return rows.some((row) => row.name === column);
  }

  private hasSupervisorTable(): boolean {
    const rows = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'supervisor_state'")
      .all();
    return rows.length > 0;
  }

  findRecord(identity: CanonicalRelayIdentity): RelayRecord | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM relay_records WHERE pair_id = ? AND direction = ? AND source_message_id = ? AND source_hash = ?"
      )
      .get(identity.pairId, identity.direction, identity.sourceMessageId, identity.sourceHash);
    return rowToRelayRecord(row);
  }

  latestRecord(pairId: string, direction: RelayDirection): RelayRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM relay_records
         WHERE pair_id = ? AND direction = ?
         ORDER BY id DESC LIMIT 1`
      )
      .get(pairId, direction);
    return rowToRelayRecord(row);
  }

  listRecords(pairId: string): RelayRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM relay_records
         WHERE pair_id = ?
         ORDER BY id ASC`
      )
      .all(pairId);
    return rows.map((row) => rowToRelayRecord(row) as RelayRecord).filter(isDefined);
  }

  createRecord(
    identity: CanonicalRelayIdentity,
    sourceTimestamp?: number,
    classification?: WorkerMessageClassification
  ): RelayRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO relay_records
           (pair_id, direction, source_message_id, source_hash, source_timestamp, status, first_seen_at, classification)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        identity.pairId,
        identity.direction,
        identity.sourceMessageId,
        identity.sourceHash,
        sourceTimestamp ?? null,
        "DISCOVERED",
        now,
        classification ?? null
      );
    const record = this.findRecord(identity);
    if (!record) {
      throw new RelayStoreError("Failed to read back relay record after INSERT.");
    }
    return record;
  }

  updateStatus(
    identity: CanonicalRelayIdentity,
    status: DeliveryStatus,
    fields: { targetId?: string; error?: string; classification?: WorkerMessageClassification }
  ): RelayRecord | undefined {
    const now = new Date().toISOString();
    const existing = this.findRecord(identity);
    if (!existing) {
      return undefined;
    }

    this.db
      .prepare(
        `UPDATE relay_records
         SET
           status = ?,
           attempt_count = attempt_count + 1,
           last_attempt_at = ?,
           delivered_at = CASE WHEN ? = 'DELIVERED' THEN ? ELSE delivered_at END,
           target_id = COALESCE(?, target_id),
           error = ?,
           classification = COALESCE(?, classification)
         WHERE id = ?`
      )
      .run(
        status,
        now,
        status,
        now,
        fields.targetId ?? null,
        fields.error ?? null,
        fields.classification ?? null,
        existing.id
      );

    return this.findRecord(identity);
  }

  recordFailure(identity: CanonicalRelayIdentity, error: string): RelayRecord | undefined {
    return this.updateStatus(identity, "FAILED", { error });
  }

  recordDelivered(identity: CanonicalRelayIdentity, targetId: string): RelayRecord | undefined {
    return this.updateStatus(identity, "DELIVERED", { targetId });
  }

  touchPairState(state: Partial<PairRelayState> & { pairId: string }): void {
    this.db
      .prepare(
        `INSERT INTO pair_state
           (pair_id, last_worker_message_id, last_planner_message_id, last_successful_relay_at, last_direction, last_error, project_pair_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(pair_id) DO UPDATE SET
           last_worker_message_id = COALESCE(excluded.last_worker_message_id, pair_state.last_worker_message_id),
           last_planner_message_id = COALESCE(excluded.last_planner_message_id, pair_state.last_planner_message_id),
           last_successful_relay_at = COALESCE(excluded.last_successful_relay_at, pair_state.last_successful_relay_at),
           last_direction = COALESCE(excluded.last_direction, pair_state.last_direction),
           last_error = COALESCE(excluded.last_error, pair_state.last_error),
           project_pair_id = COALESCE(excluded.project_pair_id, pair_state.project_pair_id)`
      )
      .run(
        state.pairId,
        state.lastWorkerMessageId ?? null,
        state.lastPlannerMessageId ?? null,
        state.lastSuccessfulRelayAt ?? null,
        state.lastDirection ?? null,
        state.lastError ?? null,
        state.projectPairId ?? null
      );
  }

  getPairState(pairId: string): PairRelayState | undefined {
    const row = this.db.prepare("SELECT * FROM pair_state WHERE pair_id = ?").get(pairId) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      return undefined;
    }
    return {
      pairId: String(row.pair_id),
      projectPairId: nullableString(row.project_pair_id) || undefined,
      lastWorkerMessageId: nullableString(row.last_worker_message_id),
      lastPlannerMessageId: nullableString(row.last_planner_message_id),
      lastSuccessfulRelayAt: nullableString(row.last_successful_relay_at),
      lastDirection: nullableDirection(row.last_direction),
      lastError: nullableString(row.last_error)
    };
  }

  listAllPairIds(): string[] {
    const rows = this.db
      .prepare("SELECT DISTINCT pair_id FROM relay_records UNION SELECT pair_id FROM pair_state ORDER BY pair_id")
      .all() as Array<{ pair_id: string }>;
    return rows.map((row) => row.pair_id);
  }

  createProposal(input: {
    proposalId: string;
    pairId: string;
    attentionId?: number;
    provider: string;
    model?: string;
    disposition: string;
    proposedAnswer?: string;
    rationaleSummary?: string;
  }): number {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO ai_proposals (
           proposal_id, pair_id, attention_id, provider, model,
           disposition, proposed_answer, rationale_summary, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.proposalId,
        input.pairId,
        input.attentionId ?? null,
        input.provider,
        input.model ?? null,
        input.disposition,
        input.proposedAnswer ?? null,
        input.rationaleSummary ?? null,
        "PENDING",
        now
      );
    const idRow = this.db.prepare("SELECT last_insert_rowid() as id").get() as { id: number };
    return idRow.id;
  }

  listProposals(pairId?: string, status?: string): Array<{
    id: number;
    proposalId: string;
    pairId: string;
    attentionId?: number;
    provider: string;
    model?: string;
    disposition: string;
    proposedAnswer?: string;
    rationaleSummary?: string;
    status: string;
    createdAt: string;
    approvedAt?: string;
    rejectedAt?: string;
    deliveredAt?: string;
    deliveryRecordId?: number;
  }> {
    const query = pairId && status
      ? "SELECT * FROM ai_proposals WHERE pair_id = ? AND status = ? ORDER BY created_at ASC"
      : pairId
        ? "SELECT * FROM ai_proposals WHERE pair_id = ? ORDER BY created_at ASC"
        : status
          ? "SELECT * FROM ai_proposals WHERE status = ? ORDER BY created_at ASC"
          : "SELECT * FROM ai_proposals ORDER BY created_at ASC";
    const params = pairId && status ? [pairId, status] : pairId ? [pairId] : status ? [status] : [];
    const rows = this.db.prepare(query).all(...params) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: Number(row.id),
      proposalId: String(row.proposal_id),
      pairId: String(row.pair_id),
      attentionId: nullableNumber(row.attention_id) || undefined,
      provider: String(row.provider),
      model: nullableString(row.model) || undefined,
      disposition: String(row.disposition),
      proposedAnswer: nullableString(row.proposed_answer) || undefined,
      rationaleSummary: nullableString(row.rationale_summary) || undefined,
      status: String(row.status),
      createdAt: String(row.created_at),
      approvedAt: nullableString(row.approved_at) || undefined,
      rejectedAt: nullableString(row.rejected_at) || undefined,
      deliveredAt: nullableString(row.delivered_at) || undefined,
      deliveryRecordId: nullableNumber(row.delivery_record_id) || undefined,
    }));
  }

  getProposalById(id: number): {
    proposalId: string;
    pairId: string;
    attentionId?: number;
    provider: string;
    model?: string;
    disposition: string;
    proposedAnswer?: string;
    rationaleSummary?: string;
    status: string;
    createdAt: string;
    approvedAt?: string;
    rejectedAt?: string;
    deliveredAt?: string;
    deliveryRecordId?: number;
  } | undefined {
    const row = this.db.prepare("SELECT * FROM ai_proposals WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      proposalId: String(row.proposal_id),
      pairId: String(row.pair_id),
      attentionId: nullableNumber(row.attention_id) || undefined,
      provider: String(row.provider),
      model: nullableString(row.model) || undefined,
      disposition: String(row.disposition),
      proposedAnswer: nullableString(row.proposed_answer) || undefined,
      rationaleSummary: nullableString(row.rationale_summary) || undefined,
      status: String(row.status),
      createdAt: String(row.created_at),
      approvedAt: nullableString(row.approved_at) || undefined,
      rejectedAt: nullableString(row.rejected_at) || undefined,
      deliveredAt: nullableString(row.delivered_at) || undefined,
      deliveryRecordId: nullableNumber(row.delivery_record_id) || undefined,
    };
  }

  updateProposalStatus(id: number, status: string, deliveryRecordId?: number): void {
    const now = new Date().toISOString();
    if (status === "APPROVED") {
      this.db
        .prepare("UPDATE ai_proposals SET status = ?, approved_at = ? WHERE id = ?")
        .run(status, now, id);
    } else if (status === "REJECTED") {
      this.db
        .prepare("UPDATE ai_proposals SET status = ?, rejected_at = ? WHERE id = ?")
        .run(status, now, id);
    } else if (status === "DELIVERED") {
      this.db
        .prepare("UPDATE ai_proposals SET status = ?, delivered_at = ?, delivery_record_id = ? WHERE id = ?")
        .run(status, now, deliveryRecordId ?? null, id);
    } else {
      this.db.prepare("UPDATE ai_proposals SET status = ? WHERE id = ?").run(status, id);
    }
  }

  purgePairData(pairId: string): void {
    // Removes every persisted row owned by the removed pair. Operator-initiated
    // removal is an explicit, deterministic teardown, so the relay ledger and
    // cycle history are removed with the pair's state rather than left orphaned
    // to resurface the dead pair id in pair listings. Run atomically so a failed
    // purge rolls back and never leaves a half-removed pair behind.
    this.db.exec("BEGIN;");
    try {
      this.db.prepare("DELETE FROM pair_state WHERE pair_id = ?").run(pairId);
      this.db.prepare("DELETE FROM supervisor_state WHERE pair_id = ?").run(pairId);
      this.db.prepare("DELETE FROM runtime_state WHERE pair_id = ?").run(pairId);
      this.db.prepare("DELETE FROM relay_cycles WHERE pair_id = ?").run(pairId);
      this.db.prepare("DELETE FROM relay_records WHERE pair_id = ?").run(pairId);
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  // Attention / worker question persistence
  createAttentionItem(item: {
    pairId: string;
    sourceMessageId: string;
    kind: string;
    blocking: boolean;
    status?: string;
    summary?: string;
    question?: string;
  }): number {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO attention_items
         (pair_id, source_message_id, kind, blocking, status, summary, question, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        item.pairId,
        item.sourceMessageId,
        item.kind,
        item.blocking ? 1 : 0,
        item.status ?? "open",
        item.summary ?? null,
        item.question ?? null,
        now
      );
    const idRow = this.db.prepare("SELECT last_insert_rowid() as id").get() as { id: number };
    return idRow.id;
  }

  listAttentionItems(pairId?: string, status?: string): Array<{
    id: number;
    pairId: string;
    sourceMessageId: string;
    kind: string;
    blocking: boolean;
    status: string;
    summary?: string;
    question?: string;
    createdAt: string;
    acknowledgedAt?: string;
    resolvedAt?: string;
    resolvedByMessageId?: string;
  }> {
    const query = pairId
      ? status
        ? "SELECT * FROM attention_items WHERE pair_id = ? AND status = ? ORDER BY created_at ASC"
        : "SELECT * FROM attention_items WHERE pair_id = ? ORDER BY created_at ASC"
      : status
        ? "SELECT * FROM attention_items WHERE status = ? ORDER BY created_at ASC"
        : "SELECT * FROM attention_items ORDER BY created_at ASC";
    const params = pairId && status ? [pairId, status] : pairId ? [pairId] : status ? [status] : [];
    const rows = this.db.prepare(query).all(...params) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: Number(row.id),
      pairId: String(row.pair_id),
      sourceMessageId: String(row.source_message_id),
      kind: String(row.kind),
      blocking: Number(row.blocking ?? 0) === 1,
      status: String(row.status ?? "open"),
      summary: nullableString(row.summary) || undefined,
      question: nullableString(row.question) || undefined,
      createdAt: String(row.created_at),
      acknowledgedAt: nullableString(row.acknowledged_at) || undefined,
      resolvedAt: nullableString(row.resolved_at) || undefined,
      resolvedByMessageId: nullableString(row.resolved_by_message_id) || undefined,
    }));
  }

  getAttentionItemBySource(pairId: string, sourceMessageId: string): { id: number; status: string } | undefined {
    const row = this.db
      .prepare("SELECT id, status FROM attention_items WHERE pair_id = ? AND source_message_id = ?")
      .get(pairId, sourceMessageId) as { id: number; status: string } | undefined;
    return row ? { id: row.id, status: row.status } : undefined;
  }

  updateAttentionStatus(id: number, status: string, resolvedByMessageId?: string): void {
    if (status === "resolved" && resolvedByMessageId) {
      this.db
        .prepare(
          `UPDATE attention_items SET status = ?, acknowledged_at = CASE WHEN status = 'acknowledged' THEN acknowledged_at ELSE ? END, resolved_at = ?, resolved_by_message_id = ? WHERE id = ?`
        )
        .run(status, new Date().toISOString(), new Date().toISOString(), resolvedByMessageId, id);
    } else if (status === "acknowledged") {
      this.db
        .prepare("UPDATE attention_items SET status = ?, acknowledged_at = ? WHERE id = ?")
        .run(status, new Date().toISOString(), id);
    } else {
      this.db.prepare("UPDATE attention_items SET status = ? WHERE id = ?").run(status, id);
    }
  }

  touchSupervisorState(state: Partial<Omit<SupervisorContinuity, "pairId">> & { pairId: string }): void {
    const existingRow = this.db
      .prepare("SELECT recovery_attempt_count AS count FROM supervisor_state WHERE pair_id = ?")
      .get(state.pairId) as { count: number } | undefined;
    const recoveryAttemptCount = state.recoveryAttemptCount ?? existingRow?.count ?? 0;

    this.db
      .prepare(
        `INSERT INTO supervisor_state (
           pair_id, last_supervisor_state, state_changed_at, last_observed_at,
           last_worker_activity_at, last_planner_activity_at,
           current_cycle_worker_message_id, current_cycle_planner_message_id,
           last_planner_side_synced_message_id, last_error, paused,
           candidate_worker_message_id, candidate_worker_message_hash, candidate_worker_first_seen_at,
           baseline_worker_message_id, baseline_worker_message_created_at,
           recovery_policy, recovery_attempt_count, last_recovery_attempt_at,
           last_recovery_success_at, last_recovery_error_code, last_recovery_error,
           project_pair_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(pair_id) DO UPDATE SET
           last_supervisor_state = COALESCE(excluded.last_supervisor_state, supervisor_state.last_supervisor_state),
           state_changed_at = COALESCE(excluded.state_changed_at, supervisor_state.state_changed_at),
           last_observed_at = COALESCE(excluded.last_observed_at, supervisor_state.last_observed_at),
           last_worker_activity_at = COALESCE(
             excluded.last_worker_activity_at,
             supervisor_state.last_worker_activity_at
           ),
           last_planner_activity_at = COALESCE(
             excluded.last_planner_activity_at,
             supervisor_state.last_planner_activity_at
           ),
           current_cycle_worker_message_id = COALESCE(
             excluded.current_cycle_worker_message_id,
             supervisor_state.current_cycle_worker_message_id
           ),
           current_cycle_planner_message_id = COALESCE(
             excluded.current_cycle_planner_message_id,
             supervisor_state.current_cycle_planner_message_id
           ),
           last_planner_side_synced_message_id = COALESCE(
             excluded.last_planner_side_synced_message_id,
             supervisor_state.last_planner_side_synced_message_id
           ),
           last_error = COALESCE(excluded.last_error, supervisor_state.last_error),
           paused = COALESCE(excluded.paused, supervisor_state.paused),
           candidate_worker_message_id = COALESCE(
             excluded.candidate_worker_message_id,
             supervisor_state.candidate_worker_message_id
           ),
           candidate_worker_message_hash = COALESCE(
             excluded.candidate_worker_message_hash,
             supervisor_state.candidate_worker_message_hash
           ),
           candidate_worker_first_seen_at = COALESCE(
             excluded.candidate_worker_first_seen_at,
             supervisor_state.candidate_worker_first_seen_at
           ),
           baseline_worker_message_id = COALESCE(
             excluded.baseline_worker_message_id,
             supervisor_state.baseline_worker_message_id
           ),
           baseline_worker_message_created_at = COALESCE(
             excluded.baseline_worker_message_created_at,
             supervisor_state.baseline_worker_message_created_at
           ),
           recovery_policy = COALESCE(excluded.recovery_policy, supervisor_state.recovery_policy),
           recovery_attempt_count = COALESCE(excluded.recovery_attempt_count, supervisor_state.recovery_attempt_count),
           last_recovery_attempt_at = COALESCE(
             excluded.last_recovery_attempt_at,
             supervisor_state.last_recovery_attempt_at
           ),
           last_recovery_success_at = COALESCE(
             excluded.last_recovery_success_at,
             supervisor_state.last_recovery_success_at
           ),
           last_recovery_error_code = COALESCE(
             excluded.last_recovery_error_code,
             supervisor_state.last_recovery_error_code
           ),
            last_recovery_error = COALESCE(excluded.last_recovery_error, supervisor_state.last_recovery_error),
            project_pair_id = COALESCE(excluded.project_pair_id, supervisor_state.project_pair_id)`
      )
      .run(
        state.pairId,
        state.lastSupervisorState ?? null,
        state.stateChangedAt ?? null,
        state.lastObservedAt ?? null,
        state.lastWorkerActivityAt ?? null,
        state.lastPlannerActivityAt ?? null,
        state.currentCycleWorkerMessageId ?? null,
        state.currentCyclePlannerMessageId ?? null,
        state.lastPlannerSideSyncedMessageId ?? null,
        state.lastError ?? null,
        state.paused === undefined ? 0 : state.paused ? 1 : 0,
        state.candidateWorkerMessageId ?? null,
        state.candidateWorkerMessageHash ?? null,
        state.candidateWorkerFirstSeenAt ?? null,
        state.baselineWorkerMessageId ?? null,
        state.baselineWorkerMessageCreatedAt ?? null,
        state.recoveryPolicy ?? "safe",
        recoveryAttemptCount,
        state.lastRecoveryAttemptAt ?? null,
        state.lastRecoverySuccessAt ?? null,
        state.lastRecoveryErrorCode ?? null,
        state.lastRecoveryError ?? null,
        (state as { projectPairId?: string }).projectPairId ?? null
      );
  }

  clearSupervisorRecoveryError(pairId: string): void {
    this.db
      .prepare(
        "UPDATE supervisor_state SET last_recovery_error_code = NULL, last_recovery_error = NULL WHERE pair_id = ?"
      )
      .run(pairId);
  }

  getSupervisorState(pairId: string): SupervisorContinuity | undefined {
    const row = this.db
      .prepare("SELECT * FROM supervisor_state WHERE pair_id = ?")
      .get(pairId) as Record<string, unknown> | undefined;
    if (!row) {
      return undefined;
    }
    return {
      pairId: String(row.pair_id),
      lastSupervisorState: nullableSupervisorState(row.last_supervisor_state),
      stateChangedAt: nullableString(row.state_changed_at),
      lastObservedAt: nullableString(row.last_observed_at),
      lastWorkerActivityAt: nullableString(row.last_worker_activity_at),
      lastPlannerActivityAt: nullableString(row.last_planner_activity_at),
      currentCycleWorkerMessageId: nullableString(row.current_cycle_worker_message_id),
      currentCyclePlannerMessageId: nullableString(row.current_cycle_planner_message_id),
      lastPlannerSideSyncedMessageId: nullableString(row.last_planner_side_synced_message_id),
      lastError: nullableString(row.last_error),
      paused: Number(row.paused ?? 0) === 1,
      candidateWorkerMessageId: nullableString(row.candidate_worker_message_id),
      candidateWorkerMessageHash: nullableString(row.candidate_worker_message_hash),
      candidateWorkerFirstSeenAt: nullableString(row.candidate_worker_first_seen_at),
      baselineWorkerMessageId: nullableString(row.baseline_worker_message_id),
      baselineWorkerMessageCreatedAt: nullableNumber(row.baseline_worker_message_created_at),
      recoveryPolicy: nullableRecoveryPolicy(row.recovery_policy),
      recoveryAttemptCount: row.recovery_attempt_count === undefined ? 0 : Number(row.recovery_attempt_count),
      lastRecoveryAttemptAt: nullableString(row.last_recovery_attempt_at),
      lastRecoverySuccessAt: nullableString(row.last_recovery_success_at),
      lastRecoveryErrorCode: nullableRecoveryErrorCode(row.last_recovery_error_code),
      lastRecoveryError: nullableString(row.last_recovery_error),
      projectPairId: nullableString(row.project_pair_id) || undefined
    };
  }

  listNondelivered(): RelayRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM relay_records
         WHERE status = 'DELIVERING' OR status = 'FAILED'
         ORDER BY id ASC`
      )
      .all();
    return rows.map((row) => rowToRelayRecord(row) as RelayRecord).filter(isDefined);
  }

  reconcileAmbiguous(identity: CanonicalRelayIdentity, status: "DELIVERED" | "FAILED", targetId?: string): RelayRecord | undefined {
    const existing = this.findRecord(identity);
    if (!existing || existing.status !== "DELIVERING") {
      return existing;
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE relay_records
         SET
           status = ?,
           delivered_at = CASE WHEN ? = 'DELIVERED' THEN ? ELSE delivered_at END,
           target_id = COALESCE(?, target_id)
         WHERE id = ?`
      )
      .run(status, status, now, targetId ?? null, existing.id);

    return this.findRecord(identity);
  }

  touchRuntimeState(state: Partial<Omit<RuntimeMetadata, "pairId">> & { pairId: string }): void {
    this.db
      .prepare(
        `INSERT INTO runtime_state (
           pair_id, runtime_enabled, last_runtime_start_at, last_runtime_stop_at, last_runtime_error,
           scheduler_mode, scheduler_mode_changed_at, dormant_reason, resume_after_restart
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(pair_id) DO UPDATE SET
           runtime_enabled = COALESCE(excluded.runtime_enabled, runtime_state.runtime_enabled),
           last_runtime_start_at = COALESCE(
             excluded.last_runtime_start_at,
             runtime_state.last_runtime_start_at
           ),
           last_runtime_stop_at = COALESCE(
             excluded.last_runtime_stop_at,
             runtime_state.last_runtime_stop_at
           ),
           last_runtime_error = COALESCE(
             excluded.last_runtime_error,
             runtime_state.last_runtime_error
           ),
           scheduler_mode = COALESCE(excluded.scheduler_mode, runtime_state.scheduler_mode),
           scheduler_mode_changed_at = COALESCE(
             excluded.scheduler_mode_changed_at,
             runtime_state.scheduler_mode_changed_at
           ),
           dormant_reason = COALESCE(excluded.dormant_reason, runtime_state.dormant_reason)`
      )
      .run(
        state.pairId,
        state.runtimeEnabled === undefined ? 0 : state.runtimeEnabled ? 1 : 0,
        state.lastRuntimeStartAt ?? null,
        state.lastRuntimeStopAt ?? null,
        state.lastRuntimeError ?? null,
        state.schedulerMode ?? null,
        state.schedulerModeChangedAt ?? null,
        state.dormantReason ?? null
      );
  }

  touchResumeState(state: { pairId: string; resumeAfterRestart: boolean }): void {
    this.db
      .prepare(
        `INSERT INTO runtime_state (pair_id, resume_after_restart) VALUES (?, ?)
         ON CONFLICT(pair_id) DO UPDATE SET resume_after_restart = excluded.resume_after_restart`
      )
      .run(state.pairId, state.resumeAfterRestart ? 1 : 0);
  }

  listResumeState(): Array<{ pairId: string; resumeAfterRestart: boolean }> {
    const rows = this.db
      .prepare("SELECT pair_id, resume_after_restart FROM runtime_state WHERE resume_after_restart = 1")
      .all() as Array<{ pair_id: string; resume_after_restart: number }>;
    return rows.map((row) => ({ pairId: String(row.pair_id), resumeAfterRestart: Number(row.resume_after_restart) === 1 }));
  }

  touchSchedulerMode(
    state: {
      pairId: string;
      schedulerMode: SchedulerMode;
      changedAt?: string;
      dormantReason?: string;
    }
  ): void {
    const changedAt = state.changedAt ?? new Date().toISOString();
    const assumeActive = state.schedulerMode === "ACTIVE" && state.dormantReason === undefined;
    this.db
      .prepare(
        `INSERT INTO runtime_state (
           pair_id, scheduler_mode, scheduler_mode_changed_at, dormant_reason, runtime_enabled
         ) VALUES (?, ?, ?, ?, 0)
         ON CONFLICT(pair_id) DO UPDATE SET
           scheduler_mode = excluded.scheduler_mode,
           scheduler_mode_changed_at = excluded.scheduler_mode_changed_at,
           dormant_reason = CASE
             WHEN ? = 1 THEN NULL
             ELSE COALESCE(excluded.dormant_reason, runtime_state.dormant_reason)
           END`
      )
      .run(state.pairId, state.schedulerMode, changedAt, state.dormantReason ?? null, assumeActive ? 1 : 0);
  }

  getRuntimeState(pairId: string): RuntimeMetadata | undefined {
    const row = this.db
      .prepare("SELECT * FROM runtime_state WHERE pair_id = ?")
      .get(pairId) as Record<string, unknown> | undefined;
    if (!row) {
      return undefined;
    }
    return {
      pairId: String(row.pair_id),
      runtimeEnabled: Number(row.runtime_enabled ?? 0) === 1,
      lastRuntimeStartAt: nullableString(row.last_runtime_start_at),
      lastRuntimeStopAt: nullableString(row.last_runtime_stop_at),
      lastRuntimeError: nullableString(row.last_runtime_error),
      schedulerMode: nullableSchedulerMode(row.scheduler_mode),
      schedulerModeChangedAt: nullableString(row.scheduler_mode_changed_at),
      dormantReason: nullableString(row.dormant_reason),
      resumeAfterRestart: Number(row.resume_after_restart ?? 0) === 1
    };
  }

  listRuntimeMetadata(): RuntimeMetadata[] {
    const rows = this.db.prepare("SELECT * FROM runtime_state ORDER BY pair_id").all();
    return rows.map((row) => {
      const record = row as Record<string, unknown>;
      return {
        pairId: String(record.pair_id),
        runtimeEnabled: Number(record.runtime_enabled ?? 0) === 1,
        lastRuntimeStartAt: nullableString(record.last_runtime_start_at),
        lastRuntimeStopAt: nullableString(record.last_runtime_stop_at),
        lastRuntimeError: nullableString(record.last_runtime_error),
        schedulerMode: nullableSchedulerMode(record.scheduler_mode),
        schedulerModeChangedAt: nullableString(record.scheduler_mode_changed_at),
        dormantReason: nullableString(record.dormant_reason),
        resumeAfterRestart: Number(record.resume_after_restart ?? 0) === 1
      };
    });
  }

  createCycle(input: {
    pairId: string;
    plannerSourceMessageId: string;
    workerDispatchMessageId: string;
    dispatchedAt?: string;
  }): RelayCycle {
    const now = new Date().toISOString();
    const dispatchedAt = input.dispatchedAt ?? now;
    this.db
      .prepare(
        `INSERT INTO relay_cycles (
           pair_id, planner_source_message_id, worker_dispatch_message_id,
           dispatched_at, cycle_status
         ) VALUES (?, ?, ?, ?, ?)`
      )
      .run(input.pairId, input.plannerSourceMessageId, input.workerDispatchMessageId, dispatchedAt, "DISPATCHED");
    return this.getCycleByPlannerSource(input.pairId, input.plannerSourceMessageId) as RelayCycle;
  }

  updateCycle(
    pairId: string,
    plannerSourceMessageId: string,
    fields: Partial<
      Pick<RelayCycle, "workerResponseMessageId" | "workerCompletedAt" | "plannerDeliveryRecordId" | "cycleStatus">
    >
  ): RelayCycle | undefined {
    const existing = this.getCycleByPlannerSource(pairId, plannerSourceMessageId);
    if (!existing) {
      return undefined;
    }
    this.db
      .prepare(
        `UPDATE relay_cycles SET
           worker_response_message_id = COALESCE(?, worker_response_message_id),
           worker_completed_at = COALESCE(?, worker_completed_at),
           planner_delivery_record_id = COALESCE(?, planner_delivery_record_id),
           cycle_status = COALESCE(?, cycle_status)
         WHERE id = ?`
      )
      .run(
        fields.workerResponseMessageId ?? null,
        fields.workerCompletedAt ?? null,
        fields.plannerDeliveryRecordId ?? null,
        fields.cycleStatus ?? null,
        existing.id
      );
    return this.getCycleByPlannerSource(pairId, plannerSourceMessageId);
  }

  getCycleByPlannerSource(pairId: string, plannerSourceMessageId: string): RelayCycle | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM relay_cycles WHERE pair_id = ? AND planner_source_message_id = ?"
      )
      .get(pairId, plannerSourceMessageId);
    return rowToRelayCycle(row);
  }

  getCycleByWorkerDispatch(pairId: string, workerDispatchMessageId: string): RelayCycle | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM relay_cycles WHERE pair_id = ? AND worker_dispatch_message_id = ?"
      )
      .get(pairId, workerDispatchMessageId);
    return rowToRelayCycle(row);
  }

  listCycles(pairId: string): RelayCycle[] {
    const rows = this.db
      .prepare("SELECT * FROM relay_cycles WHERE pair_id = ? ORDER BY id ASC")
      .all(pairId);
    return rows.map((row) => rowToRelayCycle(row) as RelayCycle).filter(isDefined);
  }
}

export function resolveDbPath(configuredPath?: string): string {
  if (configuredPath) {
    return resolve(configuredPath);
  }
  return resolve(process.env.AGENT_RELAY_DB ?? "data/agent-relay.sqlite");
}

export async function ensureDbParent(dbPath: string): Promise<void> {
  const parent = dirname(dbPath);
  if (parent) {
    await mkdir(parent, { recursive: true });
  }
}

function rowToRelayRecord(row: unknown): RelayRecord | undefined {
  if (!row || typeof row !== "object") {
    return undefined;
  }
  const record = row as Record<string, unknown>;
  return {
    id: Number(record.id),
    pairId: String(record.pair_id),
    direction: record.direction as RelayDirection,
    sourceMessageId: String(record.source_message_id),
    sourceHash: String(record.source_hash),
    sourceTimestamp: nullableNumber(record.source_timestamp),
    targetId: nullableString(record.target_id),
    status: record.status as DeliveryStatus,
    firstSeenAt: String(record.first_seen_at),
    deliveredAt: nullableString(record.delivered_at),
    lastAttemptAt: nullableString(record.last_attempt_at),
    attemptCount: Number(record.attempt_count ?? 0),
    error: nullableString(record.error),
    classification: nullableWorkerMessageClassification(record.classification)
  };
}

function nullableWorkerMessageClassification(
  value: unknown
): WorkerMessageClassification | undefined {
  const stringValue = String(value ?? "");
  return stringValue === "report" || stringValue === "question" ? stringValue : undefined;
}

function nullableString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function nullableDirection(value: unknown): RelayDirection | undefined {
  const stringValue = nullableString(value);
  return stringValue === "worker-to-planner" || stringValue === "planner-to-worker"
    ? stringValue
    : undefined;
}

function nullableSupervisorState(value: unknown): SupervisorState | undefined {
  const stringValue = nullableString(value);
  const states: SupervisorState[] = [
    "READY",
    "WORKING",
    "WAITING_PLANNER",
    "WAITING_WORKER",
    "IDLE",
    "COMPLETED",
    "WAITING_INPUT",
    "STUCK",
    "FAILED",
    "DISCONNECTED",
    "PAUSED"
  ];
  return states.includes(stringValue as SupervisorState) ? (stringValue as SupervisorState) : undefined;
}

function nullableNumber(value: unknown): number | undefined {
  return value === null || value === undefined ? undefined : Number(value);
}

function nullableSchedulerMode(value: unknown): SchedulerMode | undefined {
  const stringValue = String(value ?? "");
  if (stringValue !== "ACTIVE" && stringValue !== "DORMANT_WATCH") {
    return undefined;
  }
  return stringValue as SchedulerMode;
}

function rowToRelayCycle(row: unknown): RelayCycle | undefined {
  if (!row || typeof row !== "object") {
    return undefined;
  }
  const record = row as Record<string, unknown>;
  return {
    id: Number(record.id),
    pairId: String(record.pair_id),
    plannerSourceMessageId: String(record.planner_source_message_id),
    workerDispatchMessageId: String(record.worker_dispatch_message_id),
    dispatchedAt: nullableString(record.dispatched_at),
    workerResponseMessageId: nullableString(record.worker_response_message_id),
    workerCompletedAt: nullableString(record.worker_completed_at),
    plannerDeliveryRecordId: nullableNumber(record.planner_delivery_record_id),
    cycleStatus: nullableCycleStatus(record.cycle_status) ?? "DISPATCHED"
  };
}

function nullableCycleStatus(value: unknown): RelayCycleStatus | undefined {
  const stringValue = String(value ?? "");
  if (
    stringValue !== "DISPATCHED" &&
    stringValue !== "WORKER_RESPONDED" &&
    stringValue !== "DELIVERED" &&
    stringValue !== "FAILED"
  ) {
    return undefined;
  }
  return stringValue as RelayCycleStatus;
}

function nullableRecoveryPolicy(value: unknown): RecoveryPolicy | undefined {
  const stringValue = String(value ?? "");
  return stringValue === "safe" || stringValue === "none" ? stringValue : undefined;
}

function nullableRecoveryErrorCode(value: unknown): RecoveryErrorCode | undefined {
  const stringValue = String(value ?? "");
  if (!stringValue) {
    return undefined;
  }
  return isRecoveryErrorCode(stringValue) ? stringValue : undefined;
}

function isRecoveryErrorCode(value: string): value is RecoveryErrorCode {
  const codes: RecoveryErrorCode[] = [
    "OPENCODE_UNREACHABLE",
    "OPENCODE_SESSION_MISSING",
    "OPENCODE_REPO_MISMATCH",
    "OPENCODE_TIMEOUT",
    "CHATGPT_CDP_UNREACHABLE",
    "CHATGPT_PAGE_CLOSED",
    "CHATGPT_AUTH_REQUIRED",
    "CHATGPT_CONVERSATION_MISMATCH",
    "RELAY_AMBIGUOUS",
    "RELAY_DELIVERY_FAILED",
    "STUCK_UNRESOLVED",
    "RECOVERY_RETRY_EXHAUSTED"
  ];
  return codes.includes(value as RecoveryErrorCode);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function toActionableStoreError(error: unknown): RelayStoreError {
  const message = error instanceof Error ? error.message : String(error);
  if (/malformed|not a database|file is not a database/i.test(message)) {
    return new RelayStoreError(
      `Relay database is invalid or corrupted at the configured path. Re-initialize it with a safe backup, e.g. remove/replace the file, then run the relay again. Detail: ${message}`
    );
  }
  return new RelayStoreError(`Relay database could not be initialized: ${message}`);
}
