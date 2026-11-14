import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyThemePreference,
  normalizeThemePreference,
  readStoredThemePreference,
  resolveTheme,
  storeThemePreference,
  THEME_STORAGE_KEY
} from "../desktop/renderer/theme.js";

afterEach(() => vi.unstubAllGlobals());

describe("desktop theme preference", () => {
  it.each(["system", "light", "dark"] as const)("accepts %s", (preference) => {
    expect(normalizeThemePreference(preference)).toBe(preference);
  });

  it.each([null, undefined, "", "invalid", "DARK", 0, {}])("defaults invalid preference %j to system", (value) => {
    expect(normalizeThemePreference(value)).toBe("system");
  });

  it.each([false, true])("keeps explicit choices independent of OS dark=%s", (prefersDark) => {
    expect(resolveTheme("light", prefersDark)).toBe("light");
    expect(resolveTheme("dark", prefersDark)).toBe("dark");
    expect(resolveTheme("system", prefersDark)).toBe(prefersDark ? "dark" : "light");
  });

  it("resolves system to the OS color scheme (explicit choices never freeze)", () => {
    const root = { dataset: { theme: "" } };
    let matches = true;
    const listeners: Array<() => void> = [];
    vi.stubGlobal("document", { documentElement: root });
    vi.stubGlobal("window", {
      matchMedia: () => ({
        matches,
        addEventListener: (_: string, listener: () => void) => { listeners.push(listener); }
      })
    });

    applyThemePreference("dark");
    expect(root.dataset.theme).toBe("dark");
    applyThemePreference("light");
    expect(root.dataset.theme).toBe("light");

    applyThemePreference("system");
    expect(root.dataset.theme).toBe("dark");

    // OS flips to light: the live media-query listener follows it.
    matches = false;
    for (const fire of listeners) fire();
    expect(root.dataset.theme).toBe("light");

    // An explicit choice ignores OS flips entirely.
    applyThemePreference("dark");
    matches = true;
    for (const fire of listeners) fire();
    expect(root.dataset.theme).toBe("dark");
  });

  it.each(["light", "dark", "system", null, "invalid"])("reads stored preference %s", (value) => {
    const getItem = vi.fn(() => value);
    vi.stubGlobal("localStorage", { getItem });
    expect(readStoredThemePreference()).toBe(normalizeThemePreference(value));
    expect(getItem).toHaveBeenCalledWith(THEME_STORAGE_KEY);
  });

  it("persists explicit choices and removes only its own key for system", () => {
    const values = new Map([["unrelated", "preserve"]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key)
    });
    for (const preference of ["light", "dark"] as const) {
      storeThemePreference(preference);
      expect(readStoredThemePreference()).toBe(preference);
    }
    storeThemePreference("system");
    expect(values.has(THEME_STORAGE_KEY)).toBe(false);
    expect(readStoredThemePreference()).toBe("system");
    expect(values.get("unrelated")).toBe("preserve");
  });

  it("tolerates unavailable storage on reads, writes and removals", () => {
    const unavailable = () => { throw new Error("Storage disabled"); };
    vi.stubGlobal("localStorage", { getItem: unavailable, setItem: unavailable, removeItem: unavailable });
    expect(readStoredThemePreference()).toBe("system");
    for (const preference of ["light", "dark", "system"] as const) {
      expect(() => storeThemePreference(preference)).not.toThrow();
    }
  });
});
