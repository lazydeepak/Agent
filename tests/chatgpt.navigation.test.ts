import { describe, expect, it } from "vitest";
import { gotoPlannerPage, isTransientGotoAbort } from "../src/adapters/chatgpt/index.js";
import type { Page } from "playwright-core";

function fakePage(goto: (url: string) => Promise<void>): Page {
  const calls: string[] = [];
  const page = {
    goto: async (url: string) => {
      calls.push(url);
      return goto(url);
    },
    waitForTimeout: async () => undefined
  } as unknown as Page;
  void calls;
  return page;
}

describe("isTransientGotoAbort", () => {
  it("matches the ERR_ABORTED navigation error only", () => {
    expect(isTransientGotoAbort(new Error('page.goto: net::ERR_ABORTED at "https://chatgpt.com/c/x"'))).toBe(true);
    expect(isTransientGotoAbort(new Error("net::ERR_CONNECTION_REFUSED"))).toBe(false);
    expect(isTransientGotoAbort(new TypeError("page.goto: navigation exploded"))).toBe(false);
    expect(isTransientGotoAbort("net::ERR_ABORTED")).toBe(false);
  });
});

describe("gotoPlannerPage", () => {
  it("retries once on a transient abort then succeeds", async () => {
    let calls = 0;
    const page = fakePage(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("page.goto: net::ERR_ABORTED at https://chatgpt.com/c/x");
      }
    });
    await expect(gotoPlannerPage(page, "https://chatgpt.com/c/x", 1000)).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });

  it("does not retry non-transient navigation errors", async () => {
    let calls = 0;
    const page = fakePage(async () => {
      calls += 1;
      throw new Error("page.goto: net::ERR_CONNECTION_REFUSED");
    });
    await expect(gotoPlannerPage(page, "https://chatgpt.com/c/x", 1000)).rejects.toThrow("ERR_CONNECTION_REFUSED");
    expect(calls).toBe(1);
  });

  it("gives up after the bounded retry", async () => {
    let calls = 0;
    const page = fakePage(async () => {
      calls += 1;
      throw new Error("page.goto: net::ERR_ABORTED at https://chatgpt.com/c/x");
    });
    await expect(gotoPlannerPage(page, "https://chatgpt.com/c/x", 1000)).rejects.toThrow("ERR_ABORTED");
    expect(calls).toBe(2);
  });
});
