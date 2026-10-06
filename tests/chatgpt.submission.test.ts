import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Page } from "playwright-core";
import { PlaywrightChatGPTBrowserDriver } from "../src/adapters/chatgpt/index.js";
import { SubmissionNotAttemptedError } from "../src/relay/delivery-error.js";
import { makePair } from "./helpers.js";

afterEach(() => vi.unstubAllGlobals());

describe("ChatGPT submission acceptance", () => {
  for (const outcome of ["accepted", "formatted", "optimistic-only", "wrong-text", "disconnect"] as const) {
    it(`handles ${outcome} without assuming a click proves delivery`, async () => {
      const driver = new PlaywrightChatGPTBrowserDriver({});
      let clicks = 0;
      const locator = {
        first() { return this; }, count: async () => 1,
        isVisible: async () => true, isEnabled: async () => true,
        click: async () => { clicks++; if (outcome === "disconnect" && clicks === 2) throw new Error("disconnected"); },
        fill: async () => {}, press: async () => {}
      };
      const page = {
        locator: () => locator, waitForTimeout: async () => {},
        waitForFunction: async (predicate: string, arg: unknown) => {
          vi.stubGlobal("document", { querySelectorAll: (selector: string) => {
            if (selector.includes('"user"')) return [{ textContent: "old" }, { textContent: "Done Show more", querySelector: () => ({ textContent: outcome === "wrong-text" ? "other" : "Done" }) }];
            if (selector === "button") return outcome === "accepted" || outcome === "formatted" || outcome === "wrong-text"
              ? [{ dataset: { testid: "stop-button" }, getClientRects: () => [1] }] : [];
            return [{}];
          } });
          expect(typeof predicate).toBe("string");
          if (!runInNewContext(predicate, { document })(arg)) throw new Error("acceptance timeout");
        }
      };
      vi.spyOn(driver as unknown as { withPage: (identity: unknown, action: (page: Page) => Promise<void>) => Promise<void> }, "withPage")
        .mockImplementation(async (_, action) => action(page as unknown as Page));
      const result = driver.sendMessage(makePair().planner, { id: "report", source: "worker", role: "assistant", text: outcome === "formatted" ? "`Done`" : "Done" });
      if (outcome === "accepted" || outcome === "formatted") await expect(result).resolves.toBeUndefined();
      else {
        const error = await result.catch(error => error);
        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(SubmissionNotAttemptedError);
      }
    });
  }
  it("keeps a rate limit before page submission retryable", async () => {
    const driver = new PlaywrightChatGPTBrowserDriver({});
    vi.spyOn(driver as unknown as { withPage: () => Promise<void> }, "withPage")
      .mockRejectedValue(new Error("temporary rate limit"));
    await expect(driver.sendMessage(makePair().planner, { id: "report", source: "worker", role: "assistant", text: "Done" }))
      .rejects.toBeInstanceOf(SubmissionNotAttemptedError);
  });
  it("accepts via sent.startsWith(bubble) when the bubble is a prefix of the sent text", async () => {
    const driver = new PlaywrightChatGPTBrowserDriver({});
    const locator = {
      first() { return this; }, count: async () => 1,
      isVisible: async () => true, isEnabled: async () => true,
      click: async () => {}, fill: async () => {}, press: async () => {}
    };
    const page = {
      locator: () => locator, waitForTimeout: async () => {},
      waitForFunction: async (predicate: string, arg: unknown) => {
        vi.stubGlobal("document", { querySelectorAll: (selector: string) => {
          if (selector.includes('"user"')) return [{ textContent: "old" }, { textContent: "Do Show more", querySelector: () => ({ textContent: "Do" }) }];
          if (selector === "button") return [{ dataset: { testid: "stop-button" }, getClientRects: () => [1] }];
          return [{}];
        } });
        expect(typeof predicate).toBe("string");
        if (!runInNewContext(predicate, { document })(arg)) throw new Error("acceptance timeout");
      }
    };
    vi.spyOn(driver as unknown as { withPage: (identity: unknown, action: (page: Page) => Promise<void>) => Promise<void> }, "withPage")
      .mockImplementation(async (_, action) => action(page as unknown as Page));
    await expect(
      driver.sendMessage(makePair().planner, { id: "report", source: "worker", role: "assistant", text: "Do the refactoring" })
    ).resolves.toBeUndefined();
  });
});
