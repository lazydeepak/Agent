/**
 * Agent-relay codebase — module explanation / info.
 * File: src/adapters/chatgpt/service-warning.ts
 * Purpose: Source module for service-warning.ts.
 */
import type { Page } from "playwright-core";

// Conversation prose and hidden/stale UI must not control readiness.
export async function hasVisibleServiceWarning(page: Page, pattern: RegExp): Promise<boolean> {
  const matches = page.getByText(pattern);
  for (let index = 0; index < await matches.count(); index += 1) {
    const match = matches.nth(index);
    if (!await match.isVisible()) continue;
    const isContent = await match.evaluate((node) => {
      const content = '[data-message-author-role], [contenteditable="true"], textarea, pre, code, script, style';
      return Boolean(node.closest(content) || node.querySelector(content));
    });
    if (!isContent) return true;
  }
  return false;
}
