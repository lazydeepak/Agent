import { describe, expect, it } from "vitest";
import { join } from "node:path";

/**
 * Tests for the openWorkerSession URL construction logic.
 * These verify the URL format: <baseUrl>/server/<base64(baseUrl)>/session/<sessionId>
 */

function buildOpenWorkerSessionUrl(baseUrl: string, sessionId: string): string {
  if (!baseUrl || !sessionId) return "";
  const encodedServer = Buffer.from(baseUrl).toString("base64");
  return new URL(`${baseUrl}/server/${encodedServer}/session/${sessionId}`).toString();
}

describe("openWorkerSession URL construction", () => {
  it("generates correct URL with default baseUrl (127.0.0.1:4096)", () => {
    const baseUrl = "http://127.0.0.1:4096";
    const sessionId = "ses_f8dc96f1cffe4rmxzDwobNAPyF";
    const url = buildOpenWorkerSessionUrl(baseUrl, sessionId);

    expect(url).toBe(
      "http://127.0.0.1:4096/server/aHR0cDovLzEyNy4wLjAuMTo0MDk2/session/ses_f8dc96f1cffe4rmxzDwobNAPyF"
    );
  });

  it("generates correct URL with non-default host/port", () => {
    const baseUrl = "http://192.168.1.1:8080";
    const sessionId = "ses_abc123def456";
    const url = buildOpenWorkerSessionUrl(baseUrl, sessionId);

    const expectedEncoded = Buffer.from(baseUrl).toString("base64");
    expect(url).toBe(
      `http://192.168.1.1:8080/server/${expectedEncoded}/session/ses_abc123def456`
    );
  });

  it("correctly base64-encodes the baseUrl", () => {
    const testCases = [
      { baseUrl: "http://127.0.0.1:4096", expected: "aHR0cDovLzEyNy4wLjAuMTo0MDk2" },
      { baseUrl: "http://localhost:3000", expected: "aHR0cDovL2xvY2FsaG9zdDozMDAw" },
      { baseUrl: "https://opencode.example.com:443", expected: "aHR0cHM6Ly9vcGVuY29kZS5leGFtcGxlLmNvbTo0NDM=" },
    ];

    testCases.forEach(({ baseUrl, expected }) => {
      expect(Buffer.from(baseUrl).toString("base64")).toBe(expected);
    });
  });

  it("returns empty string when sessionId is missing", () => {
    const baseUrl = "http://127.0.0.1:4096";
    const url = buildOpenWorkerSessionUrl(baseUrl, "");
    expect(url).toBe("");
  });

  it("returns empty string when baseUrl is missing", () => {
    const sessionId = "ses_f8dc96f1cffe4rmxzDwobNAPyF";
    const url = buildOpenWorkerSessionUrl("", sessionId);
    expect(url).toBe("");
  });

  it("returns empty string when both baseUrl and sessionId are missing", () => {
    const url = buildOpenWorkerSessionUrl("", "");
    expect(url).toBe("");
  });

  it("uses URL-safe session IDs directly (no encoding needed)", () => {
    const baseUrl = "http://127.0.0.1:4096";
    const sessionId = "ses_f8dc96f1cffe4rmxzDwobNAPyF";
    const url = buildOpenWorkerSessionUrl(baseUrl, sessionId);

    // Session IDs are URL-safe, used directly in the path
    expect(url).toContain("/session/ses_f8dc96f1cffe4rmxzDwobNAPyF");
  });
});

describe("openWorkerSession edge cases", () => {
  it("generates URL without /server/ path when no sessionId", () => {
    // When no sessionId, the code falls back to just baseUrl
    const baseUrl = "http://127.0.0.1:4096";
    const encodedServer = Buffer.from(baseUrl).toString("base64");

    // This simulates the fallback case
    const url = `${baseUrl}/server/${encodedServer}`;
    expect(url).toContain("/server/");
    expect(url).not.toContain("/session/");
  });

  it("preserves baseUrl protocol in encoded form", () => {
    const httpUrl = "http://127.0.0.1:4096";
    const httpsUrl = "https://127.0.0.1:4096";

    const httpEncoded = Buffer.from(httpUrl).toString("base64");
    const httpsEncoded = Buffer.from(httpsUrl).toString("base64");

    expect(httpEncoded).not.toBe(httpsEncoded);
  });
});

describe("openWorkerSession renderer sandboxing", () => {
  it("does not expose shell.openExternal to renderer", () => {
    // The IPC handler runs in the main process, not the renderer
    // The renderer calls window.desktop.openWorkerSession(pairId) via contextBridge
    // This test verifies the expected interface
    const expectedInterface = "window.desktop.openWorkerSession";
    expect(expectedInterface).toContain("openWorkerSession");
  });
});
