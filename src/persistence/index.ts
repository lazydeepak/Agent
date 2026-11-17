/**
 * Agent-relay codebase — module explanation / info.
 * File: src/persistence/index.ts
 * Purpose: Persistence / SQLite store exports.
 */
export {
  EXPECTED_SCHEMA_VERSION,
  RelayStoreError,
  SqliteRelayStore,
  ensureDbParent,
  resolveDbPath,
  type RelayStore,
  type PermissionGrantRow
} from "./store.js";
export { canonicalRelayIdentity, canonicalizeText, hashText } from "./canonical.js";
export {
  ArchiveError,
  PairArchive,
  type ArchiveStore,
  type ArchivedConfigSnapshot,
  type ArchivedPairPayload,
  type ArchivedPairSummary
} from "./archive.js";