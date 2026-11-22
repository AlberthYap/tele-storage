import { Elysia } from "elysia";
import { botWebhook } from "./features/bot";
import { setMyCommands } from "./lib/telegram";

const BOT_COMMANDS = [
  { command: "help", description: "Lihat semua perintah" },
  { command: "newcategory", description: "Buat kategori baru: /newcategory Nama Kategori" },
  { command: "search", description: "Cari file berdasarkan kata kunci, kategori, tag, atau tanggal" },
  { command: "setfavorite", description: "Cari & tandai file sebagai favorit" },
];

export const app = new Elysia()
  .use(botWebhook)
  .get("/healthz", () => ({ ok: true, ts: Date.now() }));

// Register commands once per cold start (best-effort)
setMyCommands(BOT_COMMANDS).catch(() => {});

// Vercel's Elysia preset requires a default export of the app
export default app;
