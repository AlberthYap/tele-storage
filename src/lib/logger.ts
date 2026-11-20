import pino from "pino";
import { createWriteStream, statSync, renameSync, mkdirSync } from "fs";
import { dirname } from "path";

const LOG_FILE = process.env.LOG_FILE ?? "logs/app.log";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_FILES = 5;

mkdirSync(dirname(LOG_FILE), { recursive: true });

function rotateIfNeeded() {
  try {
    if (statSync(LOG_FILE).size < MAX_BYTES) return;
    for (let i = MAX_FILES - 1; i >= 1; i--) {
      try {
        renameSync(`${LOG_FILE}.${i}`, `${LOG_FILE}.${i + 1}`);
      } catch {}
    }
    try {
      renameSync(LOG_FILE, `${LOG_FILE}.1`);
    } catch {}
  } catch {}
}

rotateIfNeeded();
const fileStream = createWriteStream(LOG_FILE, { flags: "a" });

function jakartaTime() {
  return `,"time":"${new Date().toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })}"`;
}

export const logger = pino(
  {
    timestamp: jakartaTime,
    formatters: { level: (label) => ({ level: label }) },
    serializers: { err: pino.stdSerializers.err },
  },
  pino.multistream([{ stream: process.stdout }, { stream: fileStream }]),
);
