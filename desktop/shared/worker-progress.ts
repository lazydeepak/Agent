/**
 * Renderer-facing re-export of the worker progress contract.
 *
 * The types are owned by core (`src/contracts/worker-progress.ts`) so that `src/application` never
 * imports from `desktop/`. Only types are re-exported here: the renderer bundle must never carry
 * core implementation.
 */

export type {
  WorkerProgressState,
  WorkerProgressTodo,
  FileChangeStatus,
  WorkerProgressFileChange,
  WorkerProgressChangeSummary,
  WorkerProgressToolCall,
  WorkerProgressTimelineEntry,
  WorkerProgressLive,
  WorkerProgressDto,
  WorkerProgressSummary
} from "../../src/contracts/worker-progress.js";
