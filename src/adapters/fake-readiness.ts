/**
 * Agent codebase — module explanation / info.
 * File: src/adapters/fake-readiness.ts
 * Purpose: Shared deterministic fake-adapter readiness helpers used by the mocked
 * OpenCode and ChatGPT adapters. Extracted so tests and dev runs can rely on
 * identical override semantics without duplicating the implementation.
 */

import type { ReadinessCheck } from "../types.js";
import { fail, pass } from "../util/readiness.js";

export function fakeCheck(
  name: string,
  overrides: Record<string, boolean | string>,
  successReason: string
): ReadinessCheck {
  const override = overrides[name];

  if (override === undefined || override === true) {
    return pass(name, successReason);
  }

  return fail(name, typeof override === "string" ? override : `${name} failed in fake adapter.`);
}

export function overrideEnabled(overrides: Record<string, boolean | string>, name: string): boolean {
  const override = overrides[name];
  return override === undefined || override === true;
}
