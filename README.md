# Telegram File Vault

Personal file management platform built on top of Telegram. Send files to the bot — it records metadata to PostgreSQL. Files never touch the server; Telegram stores them.

## How it works

1. Send a file to the bot
2. Choose category, tags, and optional event date
3. Confirm — bot runs `copyMessage` to the storage channel
4. Metadata saved to Neon (file name, category, tags, event date, storage message reference)
5. Search files anytime via `/search` or `/setfavorite`

## Stack

- **Runtime**: Bun
- **Framework**: Elysia
- **Database**: Neon (PostgreSQL) + Drizzle ORM
- **Sessions**: Redis (ioredis)
- **Deployment**: Vercel

## Getting started

```bash
# Install dependencies
bun install

# Copy env file
cp .env.example .env
# Fill in BOT_TOKEN, DATABASE_URL, STORAGE_CHAT_ID, AUTHORIZED_CHAT_IDS, WEBHOOK_SECRET
# Optional: REDIS_URL (default: redis://localhost:6379), SESSION_TTL_SEC (default: 900)

# Apply database migrations
bun run db:migrate

# Run dev server
bun run dev
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `BOT_TOKEN` | ✓ | Telegram bot token from @BotFather |
| `DATABASE_URL` | ✓ | PostgreSQL connection string (Neon) |
| `STORAGE_CHAT_ID` | ✓ | Telegram channel/group ID used as file storage |
| `AUTHORIZED_CHAT_IDS` | ✓ | Comma-separated chat IDs allowed to use the bot |
| `WEBHOOK_SECRET` | ✓ | Secret token for Telegram webhook validation |
| `REDIS_URL` | — | Redis connection string (default: `redis://localhost:6379`) |
| `SESSION_TTL_SEC` | — | Session TTL in seconds (default: `900`) |
| `PORT` | — | Port for local dev server (default: `3000`) |

## Database

```bash
bun run db:generate   # generate migration files from schema
bun run db:migrate    # apply migrations
bun run db:push       # push schema directly (dev only)
```

## Bot commands

| Command | Description |
|---|---|
| `/help` | Show all commands |
| `/newcategory <name>` | Create a new category |
| `/search` | Search files by keyword, category, tag, or date |
| `/setfavorite` | Find and mark files as favorite |
