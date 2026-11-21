import "dotenv/config";
import { app } from "./app";
import { setMyCommands } from "./lib/telegram";

const BOT_COMMANDS = [
  { command: "help", description: "Lihat semua perintah" },
  { command: "newcategory", description: "Buat kategori baru: /newcategory Nama Kategori" },
  { command: "search", description: "Cari file berdasarkan kata kunci, kategori, tag, atau tanggal" },
  { command: "setfavorite", description: "Cari & tandai file sebagai favorit" },
];

app.listen(Number(process.env.PORT ?? 3000));
console.log(`ready on http://localhost:${app.server?.port}`);

setMyCommands(BOT_COMMANDS).catch((err) =>
  console.error("setMyCommands failed:", err),
);
