# Daftar File Panduan

Kerjakan urut. Setiap file punya **prasyarat** di bagian atas — jangan loncat.

**Baca dulu sebelum M0:** [00-FOLDERING.md](00-FOLDERING.md) — struktur
folder feature-based + aturan "file ini taruh di mana".

## Urutan eksekusi

| # | File | Apa yang dibangun | Prasyarat |
|---|---|---|---|
| 00 | [00-M0-hello-world.md](00-M0-hello-world.md) | Elysia hidup di localhost:3000, balas JSON | Bun terinstall |
| 01 | [01-M1-storage-interface.md](01-M1-storage-interface.md) | Storage interface + LocalDiskStorage + CLI | M0 |
| 02 | [02-M1.5-teleproto-hello.md](02-M1.5-teleproto-hello.md) | Login teleproto, kirim 1 pesan ke channel | M1 + akun Telegram + 4 nilai |
| 03 | [03-M2-storage-telegram.md](03-M2-storage-telegram.md) | TelegramStorage adapter, swap BACKEND=telegram | M1.5 |
| 04 | [04-M3-database.md](04-M3-database.md) | SQLite + Drizzle, ganti sidecar dengan DB | M2 |
| 05 | [05-M4-http-api.md](05-M4-http-api.md) | REST API + HMAC presigned links | M3 |
| 06 | [07-M6-bot.md](07-M6-bot.md) | **Bot Telegram** — kendali + terima file kecil | M4 |
| 07 | [06-M5-frontend.md](06-M5-frontend.md) | SvelteKit UI (web) — setelah bot stabil | M6 |
| 08 | [08-M6.5-hardening.md](08-M6.5-hardening.md) | Queue + flood-wait + orphan cleanup | M4+ (frontend & bot tidak wajib) |
| 09 | [09-M7-polish.md](09-M7-polish.md) | README + LICENSE + tests + deploy | Semua di atas |

## Catatan urutan

- **M0–M4** adalah fondasi backend. Tidak butuh bot, tidak butuh web —
  CLI + `curl` sudah cukup. Kerjakan berurutan.
- **M6 (bot) naik** duluan sebelum M5 (web), supaya Anda lihat
  program Anda "hidup" di Telegram lebih cepat.
- **M5 (web) turun** setelah M6, supaya Anda sudah yakin backend
  stabil sebelum bikin UI.
- **M6.5 (hardening)** bisa kapan saja setelah M4 — fleksibel.
- **M7 (polish)** selalu terakhir.

## File konteks

- [PRD.md](PRD.md) — apa dan kenapa Kanal dibuat
- [00-FOLDERING.md](00-FOLDERING.md) — struktur folder feature-based
- `SETUP.md` — file lama, sudah usang, abaikan (tidak ada di folder ini)
