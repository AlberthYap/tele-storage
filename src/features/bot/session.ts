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
  eventDate: string | null;
  isFavorite: boolean;
};

export type BrowseSession = {
  step: BrowseStep;
  source: "setfavorite" | "search";
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

export async function getSession(chatId: number): Promise<UploadSession | undefined> {
  const data = await redis.get(`session:upload:${chatId}`);
  return data ? (JSON.parse(data) as UploadSession) : undefined;
}

export async function setSession(chatId: number, session: UploadSession): Promise<void> {
  await redis.set(`session:upload:${chatId}`, JSON.stringify(session), "EX", SESSION_TTL);
}

export async function clearSession(chatId: number): Promise<void> {
  await redis.del(`session:upload:${chatId}`);
}

export async function addFileToSession(chatId: number, file: PendingFile): Promise<void> {
  const session = await getSession(chatId);
  if (session) {
    session.files.push(file);
    await setSession(chatId, session);
  }
}

export async function addSkippedFileToSession(chatId: number, file: PendingFile): Promise<void> {
  const session = await getSession(chatId);
  if (session) {
    session.skippedFiles.push(file);
    await setSession(chatId, session);
  }
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
