/**
 * Agent codebase — module explanation / info.
 * File: src/util/duplicates.ts
 * Purpose: Shared duplicate-detection helpers for the pairs and project-pairs config
 * validators. Extracted so both validators enforce identical ownership rules without
 * duplicating logic.
 */

import type { z } from "zod";

export function findDuplicates<T>(items: T[], keyForItem: (item: T) => string): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const item of items) {
    const key = keyForItem(item);
    if (seen.has(key)) {
      duplicates.add(key);
    }
    seen.add(key);
  }

  return [...duplicates];
}

export function formatZodIssue(issue: z.ZodIssue): string {
  const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  return `${path}${issue.message}`;
}
