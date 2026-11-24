import { redis } from "../../lib/redis";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PendingFile = {
  fileId: string;
  fileUniqueId: string;
  fileName: string;
  fileType: string;
  mimeType: string | null;
  fileSize: number;
  originalChatId: string;
  originalMessageId: number;
  caption: string | null;
};

export enum UploadStep {
  AwaitingCategory = "awaiting_category",
  AwaitingTags = "awaiting_tags",
  AwaitingEventDate = "awaiting_event_date",
  AwaitingConfirm = "awaiting_confirm",
}

export type UploadSession = {
  step: UploadStep;
  files: PendingFile[];
  skippedFiles: PendingFile[]; // duplicates skipped during this session; shown in post-save summary
  userId: number;
  threadId: number | null; // Telegram forum topic ID; ensures replies go to the correct thread
  categoryId: string | null;
  categoryName: string | null;
  tagIds: string[];
  eventDate: string | null; // ISO date string "YYYY-MM-DD"
  keyboardMessageId: number | null; // tracks the active keyboard message for in-place edits
};

export enum BrowseStep {
  AwaitingQuery = "browse_query", // used by /search — /setfavorite skips this step
  AwaitingCategory = "browse_category",
  AwaitingTags = "browse_tags",
  AwaitingEventDate = "browse_event_date",
  Browsing = "browsing",
}

export type BrowseFile = {
  id: string;
  fileName: string;
  fileType: string;
  fileId: string;
  caption: string | null;
  eventDate: string | null;
  uploadedAt: string; // ISO timestamp
  isFavorite: boolean;
};

export type BrowseSession = {
  step: BrowseStep;
  source: "setfavorite" | "search" | "recent";
  userId: number;
  threadId: number | null;
  q: string | null; // free-text search query; null = show all (used by /setfavorite)
  categoryId: string | null;
  categoryName: string | null;
  tagIds: string[];
  eventDate: string | null;
  results: BrowseFile[];
  currentIndex: number;
  selectedIds: string[]; // file ids selected for bulk download (search mode only)
  filterMessageId: number | null; // tracks the active filter keyboard for in-place edits
  browseMessageId: number | null;
};

// ─── Upload session ───────────────────────────────────────────────────────────

const SESSION_TTL = Number(process.env.SESSION_TTL_SEC ?? 15 * 60);

const K = {
  meta: (id: number) => `session:upload:${id}`,
  files: (id: number) => `session:upload:files:${id}`,
  skipped: (id: number) => `session:upload:skipped:${id}`,
};

export async function getSession(chatId: number): Promise<UploadSession | undefined> {
  const [data, files, skipped] = await Promise.all([
    redis.get(K.meta(chatId)),
    redis.lrange(K.files(chatId), 0, -1),
    redis.lrange(K.skipped(chatId), 0, -1),
  ]);
  if (!data) return undefined;
  const base = JSON.parse(data) as Omit<UploadSession, "files" | "skippedFiles">;
  return {
    ...base,
    files: files.map((f) => JSON.parse(f) as PendingFile),
    skippedFiles: skipped.map((f) => JSON.parse(f) as PendingFile),
  };
}

export async function setSession(chatId: number, session: UploadSession): Promise<void> {
  const { files, skippedFiles, ...base } = session;
  const p = redis.pipeline();
  p.set(K.meta(chatId), JSON.stringify(base), "EX", SESSION_TTL);
  p.del(K.files(chatId));
  if (files.length > 0) {
    p.rpush(K.files(chatId), ...files.map((f) => JSON.stringify(f)));
    p.expire(K.files(chatId), SESSION_TTL);
  }
  p.del(K.skipped(chatId));
  if (skippedFiles.length > 0) {
    p.rpush(K.skipped(chatId), ...skippedFiles.map((f) => JSON.stringify(f)));
    p.expire(K.skipped(chatId), SESSION_TTL);
  }
  await p.exec();
}

// Creates session only if meta key does not exist (NX).
// Returns true if created, false if a session already existed (concurrent creation race).
// When false, the first file is still appended via RPUSH so it is never lost.
// Creates session only if meta key does not exist (NX).
// Returns the session to use for keyboard updates:
// - the new session if created successfully
// - the existing session (from Redis) if another invocation won the race, with the file already appended
export async function initSession(chatId: number, session: UploadSession): Promise<{ created: boolean; session: UploadSession }> {
  const { files, skippedFiles, ...base } = session;
  const created = await redis.set(K.meta(chatId), JSON.stringify(base), "EX", SESSION_TTL, "NX");
  if (files.length > 0) {
    await redis.rpush(K.files(chatId), ...files.map((f) => JSON.stringify(f)));
    await redis.expire(K.files(chatId), SESSION_TTL);
  }
  if (!created) {
    // Lost the race — read the actual session so the caller can update the keyboard correctly.
    const existing = await getSession(chatId);
    return { created: false, session: existing ?? session };
  }
  return { created: true, session };
}

export async function clearSession(chatId: number): Promise<void> {
  await redis.del(K.meta(chatId), K.files(chatId), K.skipped(chatId));
}

// RPUSH is atomic — safe under concurrent serverless invocations
export async function addFileToSession(chatId: number, file: PendingFile): Promise<number> {
  const count = await redis.rpush(K.files(chatId), JSON.stringify(file));
  await redis.expire(K.files(chatId), SESSION_TTL);
  return count;
}

export async function addSkippedFileToSession(chatId: number, file: PendingFile): Promise<void> {
  await redis.rpush(K.skipped(chatId), JSON.stringify(file));
  await redis.expire(K.skipped(chatId), SESSION_TTL);
}

// ─── Manage session ───────────────────────────────────────────────────────────

export type ManageAction = "rename_category" | "delete_category" | "rename_tag" | "delete_tag";

export type ManageSession = {
  action: ManageAction;
  userId: number;
  threadId: number | null;
  selectedId: string | null;
  selectedName: string | null;
  page: number;
  listMessageId: number | null;
};

export async function getManageSession(chatId: number): Promise<ManageSession | undefined> {
  const data = await redis.get(`session:manage:${chatId}`);
  return data ? (JSON.parse(data) as ManageSession) : undefined;
}

export async function setManageSession(chatId: number, session: ManageSession): Promise<void> {
  await redis.set(`session:manage:${chatId}`, JSON.stringify(session), "EX", SESSION_TTL);
}

export async function clearManageSession(chatId: number): Promise<void> {
  await redis.del(`session:manage:${chatId}`);
}

// ─── Browse session ───────────────────────────────────────────────────────────

export async function getBrowseSession(chatId: number): Promise<BrowseSession | undefined> {
  const data = await redis.get(`session:browse:${chatId}`);
  return data ? (JSON.parse(data) as BrowseSession) : undefined;
}

export async function setBrowseSession(chatId: number, session: BrowseSession): Promise<void> {
  await redis.set(`session:browse:${chatId}`, JSON.stringify(session), "EX", SESSION_TTL);
}

export async function clearBrowseSession(chatId: number): Promise<void> {
  await redis.del(`session:browse:${chatId}`);
}
