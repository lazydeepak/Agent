import { runAction } from "./actions.js";
import { toast } from "./dom.js";
import { state } from "./view-state.js";
import { dispatchRerender } from "./worker-session.js";

export async function launchPlannerForPair(pairId: string, cdpUrl?: string): Promise<void> {
  const result = await runAction(() => window.desktop.startPlannerBrowser({ ...(cdpUrl ? { cdpUrl } : {}) }));
  if (result) {
    toast(`${pairId}: ${result.message}`, "ok");
    dispatchRerender();
  }
}
