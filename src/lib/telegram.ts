// ─── Types ────────────────────────────────────────────────────────────────────

type MsgOpts = {
  parse_mode?: string;
  reply_markup?: unknown;
  message_thread_id?: number;
};

// ─── Internal ─────────────────────────────────────────────────────────────────

function BOT_TOKEN() {
  return process.env.BOT_TOKEN!;
}

async function call<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = (await res.json()) as {
    ok: boolean;
    result?: T;
    description?: string;
    parameters?: { retry_after?: number };
  };

  if (!json.ok) {
    if (res.status === 429 && json.parameters?.retry_after) {
      const err = new Error(
        `rate limited: retry after ${json.parameters.retry_after}s`,
      ) as Error & { retryAfterSec?: number };
      err.retryAfterSec = json.parameters.retry_after;
      throw err;
    }
    throw new Error(`Bot API ${method} failed: ${json.description ?? "unknown error"}`);
  }

  return json.result as T;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export async function getMe() {
  return call<{ id: number; username: string }>("getMe", {});
}

export async function sendMessage(
  chatId: number,
  text: string,
  opts?: MsgOpts,
): Promise<{ message_id: number }> {
  return call("sendMessage", { chat_id: chatId, text, ...opts });
}

export async function editMessageText(
  chatId: number,
  messageId: number,
  text: string,
  opts?: Omit<MsgOpts, "message_thread_id">,
): Promise<void> {
  try {
    await call("editMessageText", { chat_id: chatId, message_id: messageId, text, ...opts });
  } catch {
    // message may have been deleted or content is unchanged — safe to ignore
  }
}

export async function createForumTopic(
  chatId: number,
  name: string,
): Promise<{ message_thread_id: number; name: string }> {
  return call("createForumTopic", { chat_id: chatId, name });
}

export async function copyMessage(
  toChatId: number,
  fromChatId: number,
  messageId: number,
): Promise<{ message_id: number }> {
  return call("copyMessage", {
    chat_id: toChatId,
    from_chat_id: fromChatId,
    message_id: messageId,
  });
}
