/**
 * Agent-relay codebase — module explanation / info.
 * File: src/application/worker-attention-protocol.ts
 * Purpose: Source module for worker-attention-protocol.ts.
 */
/** Explicit bounded worker-attention protocol.
 *
 * A worker assistant message must declare its attention kind through a
 * bounded machine-readable envelope embedded in the message text when
 * it requires planner or human attention.
 */
export const ATTENTION_PROTOCOL_VERSION = "1";

export const ATTENTION_PROTOCOL_INSTRUCTION = `
Agent attention protocol (v${ATTENTION_PROTOCOL_VERSION}):
When your response requires planner input, is blocked, or is complete,
include a bounded attention envelope at the end of your message using exactly this format:

<agent-relay>{"kind":"question","blocking":true}</agent-relay>

Allowed kind values: "report", "question", "blocked", "completed".
blocking must be true (requires planner/human input) or false (informational only).
If no envelope is present, the message is treated as an ordinary report.
Never emit malformed envelopes; if parsing fails, the response falls back safely to a report.
`;
