import { describe, expect, it } from "vitest";
import { browserLockKey } from "../src/runtime/adapters.js";
import { makePair } from "./helpers.js";

describe("browserLockKey", () => {
  it("treats a trailing slash on the cdp URL as the same browser lock", () => {
    const withSlash = makePair();
    withSlash.planner.browser = { cdpUrl: "http://127.0.0.1:9222/" };
    const withoutSlash = makePair();
    withoutSlash.planner.browser = { cdpUrl: "http://127.0.0.1:9222" };

    expect(browserLockKey(withSlash)).toBe(browserLockKey(withoutSlash));
    expect(browserLockKey(withSlash)).toBe("cdp:http://127.0.0.1:9222");
  });

  it("keys different cdp endpoints separately", () => {
    const first = makePair();
    first.planner.browser = { cdpUrl: "http://127.0.0.1:9222" };
    const second = makePair();
    second.planner.browser = { cdpUrl: "http://127.0.0.1:9333" };

    expect(browserLockKey(first)).not.toBe(browserLockKey(second));
  });
});