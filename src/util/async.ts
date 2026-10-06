/**
 * Async primitives shared by every layer. These live in `src/util` so adapters and the supervisor
 * never have to import from `src/runtime` (which sits above them).
 */

export type SleepFn = (ms: number, signal?: AbortSignal) => Promise<void>;

export function interruptibleSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) {
      onAbort();
    } else {
      signal?.addEventListener("abort", onAbort, { once: true });
    }
  });
}

export class FifoMutex {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(task: () => Promise<T> | T): Promise<T> {
    const previous = this.tail;
    const result = previous.then(async () => task());
    this.tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  isIdle(): Promise<void> {
    return this.tail;
  }
}

export class LockRegistry {
  private readonly locks = new Map<string, FifoMutex>();

  lockFor(key: string): FifoMutex {
    let lock = this.locks.get(key);
    if (!lock) {
      lock = new FifoMutex();
      this.locks.set(key, lock);
    }
    return lock;
  }
}
