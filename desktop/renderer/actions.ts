import { errorMessage, toast } from "./dom.js";

/** Optional hook so runAction can drive wizard-specific recovery (manual-command fallback). */
export interface RunActionErrorHook {
  handle(error: unknown): void;
}

let hook: RunActionErrorHook | undefined;

export function setRunActionHook(errorHook: RunActionErrorHook): void {
  hook = errorHook;
}

/**
 * Runs a renderer action and turns failures into a toast, returning undefined on error.
 * The wizard hook is invoked first so a `fallbackCommand` can be surfaced in the setup flow.
 */
export async function runAction<T>(action: () => Promise<T>): Promise<T | undefined> {
  try {
    return await action();
  } catch (error) {
    hook?.handle(error);
    toast(errorMessage(error));
    return undefined;
  }
}
