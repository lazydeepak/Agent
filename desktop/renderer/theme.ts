export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "agent.theme";

export function normalizeThemePreference(value: unknown): ThemePreference {
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }
  return "system";
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === "light") {
    return "light";
  }
  if (preference === "dark") {
    return "dark";
  }
  return prefersDark ? "dark" : "light";
}

let currentPreference: ThemePreference = "system";
let systemListenerAttached = false;

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return true;
  }
}

function applyResolvedTheme(): void {
  document.documentElement.dataset.theme = resolveTheme(currentPreference, systemPrefersDark());
}

/**
 * Apply a theme preference. "system" resolves to light or dark from the OS
 * via prefers-color-scheme and keeps following OS changes until the
 * preference is changed again.
 */
export function applyThemePreference(preference: ThemePreference): void {
  currentPreference = preference;
  applyResolvedTheme();
  if (!systemListenerAttached) {
    try {
      const query = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = (): void => {
        if (currentPreference === "system") {
          applyResolvedTheme();
        }
      };
      if (typeof query.addEventListener === "function") {
        query.addEventListener("change", onChange);
      } else if (typeof query.addListener === "function") {
        query.addListener(onChange);
      }
      systemListenerAttached = true;
    } catch {
      // matchMedia unavailable — system preference resolves once at apply time.
    }
  }
}

export function readStoredThemePreference(): ThemePreference {
  try {
    return normalizeThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function storeThemePreference(preference: ThemePreference): void {
  try {
    if (preference === "system") {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, preference);
    }
  } catch {
    // Storage may be unavailable; theme still applies for this session.
  }
}
