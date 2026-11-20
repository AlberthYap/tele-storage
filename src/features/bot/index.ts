import { Elysia, t } from "elysia";
import { hasSeenUpdate, markUpdateSeen } from "./queries";
import { handleFile, handleCallbackQuery, handleText, isAuthorized } from "./service";
import { logger } from "../../lib/logger";

export const botWebhook = new Elysia().post(
  "/bot/webhook",
  async ({ request, body, set }) => {
    const secret = request.headers.get("x-telegram-bot-api-secret-token");
    if (secret !== process.env.WEBHOOK_SECRET) {
      set.status = 401;
      return { ok: false };
    }

    const update = body;

    try {
      // idempotency guard: skip already-processed updates
      const updateId: number | undefined = update.update_id;
      if (typeof updateId === "number") {
        if (await hasSeenUpdate(updateId)) return { ok: true };
        await markUpdateSeen(updateId);
      }

      // inline keyboard callback
      if (update.callback_query) {
        const cb = update.callback_query;
        const chatId: number = cb.message?.chat?.id;
        const userId: number = cb.from?.id ?? chatId;
        if (!isAuthorized(chatId)) return { ok: true };
        const cbThreadId: number | null = cb.message?.message_thread_id ?? null;
        await handleCallbackQuery(chatId, userId, cb.data ?? "", cb.message?.message_id ?? 0, cbThreadId);
        return { ok: true };
      }

      const msg = update.message;
      if (!msg) return { ok: true };

      const chatId: number = msg.chat?.id;
      if (!isAuthorized(chatId)) return { ok: true };

      const userId: number = msg.from?.id ?? chatId;
      const isGroup = msg.chat?.type === "group" || msg.chat?.type === "supergroup";

      if (msg.document || msg.photo || msg.video || msg.audio) {
        await handleFile(chatId, userId, msg, isGroup);
        return { ok: true };
      }

      if (msg.text) {
        const threadId: number | null = msg.message_thread_id ?? null;
        await handleText(chatId, userId, msg.text, threadId);
        return { ok: true };
      }

      return { ok: true };
    } catch (err) {
      logger.error({ err }, "webhook unhandled error");
      return { ok: true }; // always 200 so Telegram doesn't keep retrying
    }
  },
  { body: t.Any() },
);
