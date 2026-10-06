import type { RelayStore } from "../persistence/index.js";
import { DesktopApplicationError } from "./desktop-service.js";

/**
 * Explicit desktop initialization lifecycle.
 *
 * The Electron startup path previously caught `service.init()` failures and
 * then continued with `service.getStore()!`. The non-null assertion does not
 * protect runtime behavior: when store initialization failed, worker progress
 * construction, IPC registration, event subscriptions, runtime resume, and
 * window creation proceeded with partially initialized services.
 *
 * This module is the single decision point for desktop startup. It is
 * platform-neutral (no Electron import) so unit tests can prove the ordering
 * without launching a real window. The Electron entry point
 * (`desktop/main/index.ts`) is a thin adapter over this lifecycle.
 *
 * Ordering (each step is a shutdown checkpoint):
 *  1. `service.init()` — any throw here is a fatal store failure. Pair
 *     configuration errors are recoverable by design: DesktopApplicationService
 *     swallows config load failures and stays usable with an empty pair list.
 *  2. `requireStore()` — defensive fatal if the store is still undefined.
 *  3. `createWorkerProgress(store)` — fatal on throw; proves construction only
 *     happens with a valid store.
 *  4. `registerOperationalHandlers()` — IPC handlers, event subscriptions,
 *     tray/power/app listeners. Only reached after 1-3 succeed, so a fatal
 *     store failure provably registers nothing operational.
 *  5. `createWindow()` — fatal on throw; cleanup unregisters step 4 so no
 *     partial service remains active.
 *  6. `resumeManagedPairs()` — best-effort; failures never fail the boot.
 *
 * Shutdown may be requested at any time, including while `service.init()` is
 * still pending. A synchronous `shutdownRequested` flag is checked after every
 * await so construction can never race with teardown. Cleanup (dispose worker
 * progress, unregister handlers, shut down the service) runs exactly once and
 * `shutdown()` is safe to call repeatedly. Fatal errors are reported exactly
 * once via `reportFatalError`.
 *
 * All filesystem paths use `node:path` resolution at the call sites and all
 * user-facing errors go through `reportFatalError` (wired to
 * `dialog.showErrorBox` in Electron), so behavior is identical on macOS,
 * Windows, and Linux.
 */

export type DesktopLifecycleState = "initializing" | "ready" | "failed" | "shutting-down" | "stopped";

export type DesktopBootResult =
  | { status: "ready" }
  | { status: "failed"; error: DesktopApplicationError }
  | { status: "aborted" };

export interface DesktopLifecycleService {
  init(): Promise<void>;
  getStore(): RelayStore | undefined;
  shutdown(): Promise<void>;
}

export interface DisposableWorkerProgress {
  dispose(): void;
}

export interface DesktopLifecycleHooks {
  createWorkerProgress: (store: RelayStore) => DisposableWorkerProgress;
  registerOperationalHandlers: () => void;
  unregisterOperationalHandlers: () => void;
  createWindow: () => Promise<void>;
  resumeManagedPairs: () => Promise<void>;
  reportFatalError: (error: DesktopApplicationError) => void;
}

function isValidStore(store: RelayStore | undefined): store is RelayStore {
  return Boolean(store) && typeof (store as RelayStore).listCycles === "function";
}

function toFatalError(error: unknown, fallbackCode: string, fallbackMessage: string): DesktopApplicationError {
  if (error instanceof DesktopApplicationError) {
    return error;
  }
  if (error instanceof Error) {
    return new DesktopApplicationError(fallbackCode, `${fallbackMessage}: ${error.message}`);
  }
  return new DesktopApplicationError(fallbackCode, `${fallbackMessage}: ${String(error)}`);
}

export class DesktopLifecycle {
  private state: DesktopLifecycleState = "initializing";
  private shutdownRequested = false;
  private bootPromise: Promise<DesktopBootResult> | undefined;
  private bootSettled = false;
  private cleanupDone = false;
  private cleanupCount = 0;
  private errorReported = false;
  private errorReportCount = 0;
  private workerProgress: DisposableWorkerProgress | undefined;
  private handlersRegistered = false;

  constructor(
    private readonly service: DesktopLifecycleService,
    private readonly hooks: DesktopLifecycleHooks
  ) {}

  getState(): DesktopLifecycleState {
    return this.state;
  }

  getCleanupCount(): number {
    return this.cleanupCount;
  }

  getErrorReportCount(): number {
    return this.errorReportCount;
  }

  isOperational(): boolean {
    return this.state === "ready";
  }

  /** Idempotent shutdown entry point. Safe during boot and safe to repeat. */
  async shutdown(): Promise<void> {
    this.shutdownRequested = true;
    if (this.state === "stopped" || this.state === "shutting-down") {
      return;
    }
    if (this.bootPromise && !this.bootSettled) {
      try {
        await this.bootPromise;
      } catch {
        // Boot never rejects; belt-and-braces for custom hook failures.
      }
      await this.finishShutdown();
      return;
    }
    this.state = "shutting-down";
    await this.cleanupOnce();
    this.state = "stopped";
  }

  async boot(): Promise<DesktopBootResult> {
    if (this.bootPromise) {
      return this.bootPromise;
    }
    this.state = "initializing";
    this.bootPromise = this.runBoot();
    const result = await this.bootPromise;
    this.bootSettled = true;
    if (this.shutdownRequested && result.status !== "aborted") {
      await this.finishShutdown();
      return { status: "aborted" };
    }
    return result;
  }

  private async finishShutdown(): Promise<void> {
    if (this.state === "stopped") {
      return;
    }
    this.state = "shutting-down";
    await this.cleanupOnce();
    this.state = "stopped";
  }

  private reportOnce(error: DesktopApplicationError): void {
    if (this.errorReported) {
      return;
    }
    this.errorReported = true;
    this.errorReportCount += 1;
    try {
      this.hooks.reportFatalError(error);
    } catch {
      // Error reporting must never throw or retry; the lifecycle still fails closed.
    }
  }

  private async cleanupOnce(): Promise<void> {
    if (this.cleanupDone) {
      return;
    }
    this.cleanupDone = true;
    this.cleanupCount += 1;
    if (this.handlersRegistered) {
      try {
        this.hooks.unregisterOperationalHandlers();
      } catch {
        // Unregister is best-effort; cleanup still proceeds.
      } finally {
        this.handlersRegistered = false;
      }
    }
    if (this.workerProgress) {
      try {
        this.workerProgress.dispose();
      } catch {
        // Dispose is best-effort; service shutdown still proceeds.
      } finally {
        this.workerProgress = undefined;
      }
    }
    try {
      await this.service.shutdown();
    } catch {
      // Shutdown is best-effort; the lifecycle still reaches a terminal state.
    }
  }

  private fail(error: DesktopApplicationError): DesktopBootResult {
    this.reportOnce(error);
    return { status: "failed", error };
  }

  private async runBoot(): Promise<DesktopBootResult> {
    if (this.shutdownRequested) {
      await this.cleanupOnce();
      this.state = "stopped";
      return { status: "aborted" };
    }

    try {
      await this.service.init();
    } catch (error) {
      const fatal = toFatalError(
        error,
        "STORE_INIT_FAILED",
        "Agent Relay could not open its local database. Close other instances, check disk permissions for the database directory, then relaunch"
      );
      await this.cleanupOnce();
      this.state = "failed";
      return this.fail(fatal);
    }

    if (this.shutdownRequested) {
      await this.cleanupOnce();
      this.state = "stopped";
      return { status: "aborted" };
    }

    const store = this.service.getStore();
    if (!isValidStore(store)) {
      const fatal = new DesktopApplicationError(
        "STORE_UNAVAILABLE",
        "Agent Relay could not open its local database. Close other instances, check disk permissions for the database directory, then relaunch."
      );
      await this.cleanupOnce();
      this.state = "failed";
      return this.fail(fatal);
    }

    if (this.shutdownRequested) {
      await this.cleanupOnce();
      this.state = "stopped";
      return { status: "aborted" };
    }

    try {
      this.workerProgress = this.hooks.createWorkerProgress(store);
    } catch (error) {
      const fatal = toFatalError(
        error,
        "WORKER_PROGRESS_INIT_FAILED",
        "Agent Relay could not start worker progress tracking. Relaunch the app"
      );
      await this.cleanupOnce();
      this.state = "failed";
      return this.fail(fatal);
    }

    if (this.shutdownRequested) {
      await this.cleanupOnce();
      this.state = "stopped";
      return { status: "aborted" };
    }

    try {
      this.hooks.registerOperationalHandlers();
      this.handlersRegistered = true;
    } catch (error) {
      const fatal = toFatalError(
        error,
        "IPC_REGISTRATION_FAILED",
        "Agent Relay could not register its dashboard handlers. Relaunch the app"
      );
      await this.cleanupOnce();
      this.state = "failed";
      return this.fail(fatal);
    }

    if (this.shutdownRequested) {
      await this.cleanupOnce();
      this.state = "stopped";
      return { status: "aborted" };
    }

    try {
      await this.hooks.createWindow();
    } catch (error) {
      const fatal = toFatalError(
        error,
        "WINDOW_CREATION_FAILED",
        "Agent Relay could not open its dashboard window. Relaunch the app"
      );
      await this.cleanupOnce();
      this.state = "failed";
      return this.fail(fatal);
    }

    if (this.shutdownRequested) {
      await this.cleanupOnce();
      this.state = "stopped";
      return { status: "aborted" };
    }

    try {
      await this.hooks.resumeManagedPairs();
    } catch {
      // Resume is best-effort; failures surface through the event feed.
    }

    if (this.shutdownRequested) {
      await this.cleanupOnce();
      this.state = "stopped";
      return { status: "aborted" };
    }

    this.state = "ready";
    return { status: "ready" };
  }
}
