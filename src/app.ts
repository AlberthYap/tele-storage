import { Elysia } from "elysia";
import { botWebhook } from "./features/bot";

export const app = new Elysia()
  .use(botWebhook)
  .get("/healthz", () => ({ ok: true, ts: Date.now() }));
