import "dotenv/config";
import { app } from "../src/app";
import { setMyCommands } from "../src/lib/telegram";

const BOT_COMMANDS = [
  { command: "help", description: "Lihat semua perintah" },
  { command: "newcategory", description: "Buat kategori baru: /newcategory Nama Kategori" },
  { command: "search", description: "Cari file berdasarkan kata kunci, kategori, tag, atau tanggal" },
  { command: "setfavorite", description: "Cari & tandai file sebagai favorit" },
];

// Register commands once per cold start (best-effort)
setMyCommands(BOT_COMMANDS).catch(() => {});

export default async function handler(req: Request): Promise<Response> {
  return app.handle(req);
}
