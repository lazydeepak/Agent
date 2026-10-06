import type { Page } from "playwright-core";
import { describe, expect, it } from "vitest";
import { hasVisibleServiceWarning } from "../src/adapters/chatgpt/service-warning.js";

type Match = { visible: boolean; ancestor?: string; descendant?: string };
function pageWith(matches: Match[]): Page {
  return {
    getByText: () => ({
      count: async () => matches.length,
      nth: (index: number) => ({
        isVisible: async () => matches[index].visible,
        evaluate: async (predicate: (node: unknown) => boolean) => predicate({
          closest: (selector: string) => matches[index].ancestor && selector.includes(matches[index].ancestor!) ? {} : null,
          querySelector: (selector: string) => matches[index].descendant && selector.includes(matches[index].descendant!) ? {} : null
        })
      })
    })
  } as unknown as Page;
}

describe("ChatGPT service warnings", () => {
  it("ignores hidden warnings left in the page", async () => {
    expect(await hasVisibleServiceWarning(pageWith([{ visible: false }]), /rate limit/)).toBe(false);
  });

  for (const ancestor of ['[data-message-author-role]', '[contenteditable="true"]', 'textarea', 'pre', 'code']) {
    it(`ignores warning phrases inside ${ancestor}`, async () => {
      expect(await hasVisibleServiceWarning(pageWith([{ visible: true, ancestor }]), /rate limit/)).toBe(false);
    });
  }

  it("ignores a matching container that wraps conversation text", async () => {
    expect(await hasVisibleServiceWarning(pageWith([{ visible: true, descendant: '[data-message-author-role]' }]), /rate limit/)).toBe(false);
  });

  it("still detects a real visible warning after hidden or conversational matches", async () => {
    expect(await hasVisibleServiceWarning(pageWith([
      { visible: false }, { visible: true, ancestor: '[data-message-author-role]' }, { visible: true }
    ]), /rate limit/)).toBe(true);
  });
});
