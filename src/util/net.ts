/**
 * Transport-neutral URL helpers. Kept in `src/util` so adapters can use them without importing
 * from a higher layer.
 */

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);

export function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(normalizeHostname(hostname));
}

/** True when `value` parses as an http(s) URL. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Decides whether Basic credentials may be sent to `url`.
 *
 * Credentials are withheld from plain-HTTP non-loopback endpoints unless the caller opts in, so a
 * caller-supplied endpoint cannot harvest a configured password. Callers that build a client from
 * persisted (operator-authored) configuration opt in explicitly.
 */
export function credentialsAllowed(url: string, allowInsecureAuth?: boolean): boolean {
  if (allowInsecureAuth === true) return true;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") return true;
    return parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname);
  } catch {
    return false;
  }
}
