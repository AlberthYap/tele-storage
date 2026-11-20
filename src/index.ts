import "dotenv/config";
import { Elysia } from "elysia";
import { botWebhook } from "./features/bot";

const app = new Elysia()
  .use(botWebhook)
  .get("/healthz", () => ({ ok: true, ts: Date.now() }))
  .listen(Number(process.env.PORT ?? 3000));

console.log(`ready on http://localhost:${app.server?.port}`);
