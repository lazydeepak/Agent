import { describe, expect, it } from "vitest";
import { credentialsAllowed, isHttpUrl, isLoopbackHostname } from "../src/util/net.js";

describe("isHttpUrl", () => {
  it("accepts http and https and rejects other schemes", () => {
    expect(isHttpUrl("http://127.0.0.1:4096")).toBe(true);
    expect(isHttpUrl("https://example.com")).toBe(true);
    expect(isHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("data:text/html,x")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
  });
});

describe("isLoopbackHostname", () => {
  it("recognizes loopback spellings only", () => {
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
    expect(isLoopbackHostname("0.0.0.0")).toBe(false);
    expect(isLoopbackHostname("attacker.example")).toBe(false);
  });
});

describe("credentialsAllowed", () => {
  it("allows credentials over https", () => {
    expect(credentialsAllowed("https://opencode.example.com/")).toBe(true);
  });

  it("allows credentials over loopback http", () => {
    expect(credentialsAllowed("http://127.0.0.1:4096/")).toBe(true);
    expect(credentialsAllowed("http://localhost:4096/")).toBe(true);
  });

  it("withholds credentials from remote plain http unless opted in", () => {
    expect(credentialsAllowed("http://attacker.example/")).toBe(false);
    expect(credentialsAllowed("http://attacker.example/", true)).toBe(true);
  });

  it("withholds credentials from unusable urls", () => {
    expect(credentialsAllowed("not a url")).toBe(false);
    expect(credentialsAllowed("file:///etc/passwd")).toBe(false);
  });
});
