/**
 * Runtime scheduling primitives.
 *
 * The generic async helpers (`interruptibleSleep`, `FifoMutex`, `LockRegistry`) live in
 * `src/util/async.ts`; this module re-exports them so existing runtime imports keep working.
 */

export { FifoMutex, LockRegistry, interruptibleSleep, type SleepFn } from "../util/async.js";
