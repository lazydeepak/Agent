export type ChatGptUrlErrorCode =
  | "INVALID_URL"
  | "NOT_CHATGPT_HOST"
  | "MISSING_CONVERSATION_SEGMENT"
  | "MISSING_CONVERSATION_ID";

export class ChatGptUrlError extends Error {
  readonly code: ChatGptUrlErrorCode;

  constructor(code: ChatGptUrlErrorCode, message: string) {
    super(message);
    this.name = "ChatGptUrlError";
    this.code = code;
  }
}

export interface ParsedChatGptConversation {
  conversationId: string;
  conversationUrl: string;
  project?: string;
}

const CHATGPT_HOST_SUFFIX = "chatgpt.com";

/**
 * Canonical ChatGPT conversation URL parser.
 *
 * The stable semantic anchor is the `/c/<conversation-id>` path segment. Standard
 * conversation URLs (`https://chatgpt.com/c/<id>`) and project-scoped routes
 * (`https://chatgpt.com/g/<project>/c/<id>`) are both accepted, regardless of any
 * path prefix that appears before `/c/`. Query strings and hash fragments do not
 * affect parsing.
 */
export function parseChatGptConversationUrl(input: string): ParsedChatGptConversation {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new ChatGptUrlError("INVALID_URL", "A ChatGPT conversation URL is required.");
  }

  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new ChatGptUrlError("INVALID_URL", "The value is not a valid URL.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ChatGptUrlError("INVALID_URL", "The URL must use http or https.");
  }

  const host = url.hostname.toLowerCase();
  if (host !== CHATGPT_HOST_SUFFIX && !host.endsWith(`.${CHATGPT_HOST_SUFFIX}`)) {
    throw new ChatGptUrlError("NOT_CHATGPT_HOST", `The URL host "${url.hostname}" is not a ChatGPT conversation host.`);
  }

  const segments = url.pathname.split("/").filter(Boolean);
  const conversationMarkerIndex = segments.indexOf("c");
  if (conversationMarkerIndex < 0) {
    throw new ChatGptUrlError(
      "MISSING_CONVERSATION_SEGMENT",
      "The URL does not contain a /c/<conversation-id> conversation segment."
    );
  }

  const conversationId = segments[conversationMarkerIndex + 1];
  if (!conversationId || conversationId.length === 0) {
    throw new ChatGptUrlError("MISSING_CONVERSATION_ID", "The URL is missing a conversation id after /c/.");
  }

  let project: string | undefined;
  if (conversationMarkerIndex >= 2 && segments[conversationMarkerIndex - 2] === "g") {
    project = segments[conversationMarkerIndex - 1];
  }

  return {
    conversationId,
    conversationUrl: `https://chatgpt.com/c/${conversationId}`,
    ...(project ? { project } : {})
  };
}

/** Returns true when the URL parses to exactly the given conversation id. */
export function conversationUrlMatchesId(input: string, conversationId: string): boolean {
  try {
    return parseChatGptConversationUrl(input).conversationId === conversationId;
  } catch {
    return false;
  }
}
