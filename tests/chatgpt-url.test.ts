import { describe, expect, it } from "vitest";
import {
  ChatGptUrlError,
  conversationUrlMatchesId,
  parseChatGptConversationUrl
} from "../src/sessions/chatgpt-url.js";

describe("parseChatGptConversationUrl", () => {
  it("accepts a standard conversation URL", () => {
    const parsed = parseChatGptConversationUrl("https://chatgpt.com/c/abc-123");
    expect(parsed.conversationId).toBe("abc-123");
    expect(parsed.conversationUrl).toBe("https://chatgpt.com/c/abc-123");
    expect(parsed.project).toBeUndefined();
  });

  it("accepts a project-scoped conversation URL", () => {
    const parsed = parseChatGptConversationUrl("https://chatgpt.com/g/p-xyz/c/abc-123");
    expect(parsed.conversationId).toBe("abc-123");
    expect(parsed.project).toBe("p-xyz");
  });

  it("accepts www and arbitrary path prefixes before /c/", () => {
    expect(parseChatGptConversationUrl("https://www.chatgpt.com/c/abc-123").conversationId).toBe("abc-123");
    expect(parseChatGptConversationUrl("https://chatgpt.com/foo/bar/c/abc-123").conversationId).toBe("abc-123");
  });

  it("tolerates query strings and hash fragments", () => {
    const parsed = parseChatGptConversationUrl("https://chatgpt.com/c/abc-123?model=gpt-4o&x=1#thread");
    expect(parsed.conversationId).toBe("abc-123");
    expect(parsed.conversationUrl).toBe("https://chatgpt.com/c/abc-123");
  });

  it("rejects a malformed URL", () => {
    expect(() => parseChatGptConversationUrl("not a url")).toThrow(ChatGptUrlError);
    expect(() => parseChatGptConversationUrl("::://broken")).toThrow(ChatGptUrlError);
  });

  it("rejects a URL missing the /c/ conversation segment", () => {
    expect(() => parseChatGptConversationUrl("https://chatgpt.com/")).toThrowError(
      expect.objectContaining({ code: "MISSING_CONVERSATION_SEGMENT" })
    );
    expect(() => parseChatGptConversationUrl("https://chatgpt.com/g/p-xyz")).toThrowError(
      expect.objectContaining({ code: "MISSING_CONVERSATION_SEGMENT" })
    );
  });

  it("rejects a URL with an empty conversation id after /c/", () => {
    expect(() => parseChatGptConversationUrl("https://chatgpt.com/c/")).toThrowError(
      expect.objectContaining({ code: "MISSING_CONVERSATION_ID" })
    );
  });

  it("rejects a non-ChatGPT host", () => {
    expect(() => parseChatGptConversationUrl("https://example.com/c/abc-123")).toThrowError(
      expect.objectContaining({ code: "NOT_CHATGPT_HOST" })
    );
  });

  it("rejects an empty or blank input", () => {
    expect(() => parseChatGptConversationUrl("")).toThrowError(expect.objectContaining({ code: "INVALID_URL" }));
    expect(() => parseChatGptConversationUrl("   ")).toThrowError(expect.objectContaining({ code: "INVALID_URL" }));
  });
});

describe("conversationUrlMatchesId", () => {
  it("returns true when the URL derives the given id", () => {
    expect(conversationUrlMatchesId("https://chatgpt.com/c/abc-123", "abc-123")).toBe(true);
    expect(conversationUrlMatchesId("https://chatgpt.com/g/p/c/abc-123", "abc-123")).toBe(true);
  });

  it("returns false on a mismatch", () => {
    expect(conversationUrlMatchesId("https://chatgpt.com/c/abc-123", "other")).toBe(false);
  });

  it("returns false when the URL is invalid", () => {
    expect(conversationUrlMatchesId("not a url", "abc-123")).toBe(false);
  });
});
