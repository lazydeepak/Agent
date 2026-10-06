import type { CanonicalRelayIdentity, RelayDirection, RelayableMessage } from "../types.js";
import { hashText } from "../util/canonical.js";

// Canonical text helpers live in `src/util/canonical.ts` so lower layers can use them without
// depending on persistence; re-exported here for existing callers.
export { canonicalizeText, hashText } from "../util/canonical.js";

export function canonicalRelayIdentity(
  pairId: string,
  direction: RelayDirection,
  message: Pick<RelayableMessage, "id" | "text">
): CanonicalRelayIdentity {
  return {
    pairId,
    direction,
    sourceMessageId: message.id,
    sourceHash: hashText(message.text)
  };
}
