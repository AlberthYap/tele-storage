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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Retries once on 429 flood wait, then gives up.
async function call<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
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
        if (attempt === 0) {
          // Wait the requested duration then retry once.
          await sleep((json.parameters.retry_after + 1) * 1000);
          continue;
        }
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
  throw new Error(`Bot API ${method} failed after retry`);
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
  messageThreadId?: number,
): Promise<{ message_id: number }> {
  return call("copyMessage", {
    chat_id: toChatId,
    from_chat_id: fromChatId,
    message_id: messageId,
    ...(messageThreadId ? { message_thread_id: messageThreadId } : {}),
  });
}

export async function sendFileMessage(
  chatId: number,
  fileType: string,
  fileId: string,
  caption: string,
  opts?: Omit<MsgOpts, "parse_mode">,
): Promise<{ message_id: number }> {
  const methodMap: Record<string, string> = {
    photo: "sendPhoto",
    video: "sendVideo",
    audio: "sendAudio",
  };
  const fieldMap: Record<string, string> = {
    photo: "photo",
    video: "video",
    audio: "audio",
  };
  const method = methodMap[fileType] ?? "sendDocument";
  const field = fieldMap[fileType] ?? "document";
  return call(method, { chat_id: chatId, [field]: fileId, caption, ...opts });
}

export async function editMessageMedia(
  chatId: number,
  messageId: number,
  fileType: string,
  fileId: string,
  caption: string,
  replyMarkup?: unknown,
): Promise<void> {
  const type = ["photo", "video", "audio"].includes(fileType) ? fileType : "document";
  try {
    await call("editMessageMedia", {
      chat_id: chatId,
      message_id: messageId,
      media: { type, media: fileId, caption },
      reply_markup: replyMarkup,
    });
  } catch {
    // message may have been deleted — safe to ignore
  }
}

export async function deleteMessage(chatId: number, messageId: number): Promise<void> {
  try {
    await call("deleteMessage", { chat_id: chatId, message_id: messageId });
  } catch {
    // message may already be deleted — safe to ignore
  }
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  try {
    await call("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
  } catch {
    // best-effort
  }
}

export async function setMyCommands(
  commands: { command: string; description: string }[],
): Promise<void> {
  await call("setMyCommands", { commands });
}
