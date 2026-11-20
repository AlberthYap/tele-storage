// In-memory upload session state. One active session per chat at a time.

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

const sessions = new Map<number, UploadSession>();

export function getSession(chatId: number): UploadSession | undefined {
  return sessions.get(chatId);
}

export function setSession(chatId: number, session: UploadSession): void {
  sessions.set(chatId, session);
}

export function clearSession(chatId: number): void {
  sessions.delete(chatId);
}

export function addFileToSession(chatId: number, file: PendingFile): void {
  const session = sessions.get(chatId);
  if (session) {
    session.files.push(file);
  }
}

export function addSkippedFileToSession(chatId: number, file: PendingFile): void {
  const session = sessions.get(chatId);
  if (session) {
    session.skippedFiles.push(file);
  }
}

// ─── Browse session ───────────────────────────────────────────────────────────

export enum BrowseStep {
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
  userId: number;
  threadId: number | null;
  categoryId: string | null;
  categoryName: string | null;
  tagIds: string[];
  eventDate: string | null;
  results: BrowseFile[];
  currentIndex: number;
  browseMessageId: number | null;
};

const browseSessions = new Map<number, BrowseSession>();

export function getBrowseSession(chatId: number): BrowseSession | undefined {
  return browseSessions.get(chatId);
}

export function setBrowseSession(chatId: number, session: BrowseSession): void {
  browseSessions.set(chatId, session);
}

export function clearBrowseSession(chatId: number): void {
  browseSessions.delete(chatId);
}
