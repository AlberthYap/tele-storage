import {
  insertFile,
  attachTags,
  searchFiles,
  getFileById,
  getTagsForFile,
  getCategoriesByUser,
  getTagsByUser,
  insertCategory,
  insertTag,
  renameCategory,
  deleteCategory,
  renameTag,
  deleteTag,
  updateFileStorageRef,
  toggleFavorite,
  deleteFile,
  getCategoryById,
  getCategoryByThreadId,
  getTagByName,
  countFilesByCategory,
  getRecentFiles,
  getFavoriteFiles,
  getCategoryWithCount,
  getTagWithCount,
  getStats,
} from "./queries";
import { copyMessage } from "../../lib/telegram";
import type { ServiceResult, FileInfo, FileDetail } from "./types";

// ─── Upload ───────────────────────────────────────────────────────────────────

export async function ingestFile(args: {
  userId: number;
  fileName: string;
  fileType: string | null;
  mimeType: string | null;
  fileSize: number;
  fileId: string;
  fileUniqueId: string;
  storageChatId: string;
  storageMessageId: number;
  originalChatId: string;
  originalMessageId: number;
  categoryId: string;
  tagIds: string[];
  caption: string | null;
  eventDate: string | null;
}): Promise<string | null> {
  const { tagIds, ...fileArgs } = args;
  const id = await insertFile(fileArgs);
  if (id) await attachTags(id, tagIds);
  return id; // null = duplicate; file was already ingested
}

// ─── Search ───────────────────────────────────────────────────────────────────

export async function listFiles(args: {
  userId: number;
  q?: string;
  categoryId?: string;
  tagIds?: string[];
  eventDateFrom?: string;
  eventDateTo?: string;
  uploadDateFrom?: string;
  uploadDateTo?: string;
  fileType?: string;
  limit: number;
  offset: number;
}): Promise<{ items: FileInfo[] }> {
  const rows = await searchFiles(args);
  return { items: rows.map(toFileInfo) };
}

export async function listRecent(userId: number, limit = 20): Promise<{ items: FileInfo[] }> {
  const rows = await getRecentFiles(userId, limit);
  return { items: rows.map(toFileInfo) };
}

export async function listFavorites(userId: number): Promise<{ items: FileInfo[] }> {
  const rows = await getFavoriteFiles(userId);
  return { items: rows.map(toFileInfo) };
}

export async function getStatistics(userId: number) {
  return getStats(userId);
}

export async function getFileDetail(id: string): Promise<ServiceResult<FileDetail>> {
  const row = await getFileById(id);
  if (!row) return { ok: false, error: { code: "NOT_FOUND", message: "file tidak ditemukan" } };
  const fileTags = await getTagsForFile(id);
  return { ok: true, value: { ...toFileInfo(row), tags: fileTags } };
}

// ─── Resend ───────────────────────────────────────────────────────────────────

export async function resendFile(
  id: string,
  toChatId: number,
): Promise<ServiceResult<{ messageId: number }>> {
  const row = await getFileById(id);
  if (!row) return { ok: false, error: { code: "NOT_FOUND", message: "file tidak ditemukan" } };
  if (!row.storageChatId || !row.storageMessageId) {
    return { ok: false, error: { code: "NOT_FOUND", message: "storage ref belum ada" } };
  }

  try {
    const sent = await copyMessage(toChatId, Number(row.storageChatId), row.storageMessageId);
    return { ok: true, value: { messageId: sent.message_id } };
  } catch (e) {
    return { ok: false, error: { code: "TELEGRAM_ERROR", message: (e as Error).message } };
  }
}

// ─── Favorite ─────────────────────────────────────────────────────────────────

export async function setFavorite(id: string, isFavorite: boolean): Promise<ServiceResult<true>> {
  const row = await getFileById(id);
  if (!row) return { ok: false, error: { code: "NOT_FOUND", message: "file tidak ditemukan" } };
  await toggleFavorite(id, isFavorite);
  return { ok: true, value: true };
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function removeFile(id: string): Promise<ServiceResult<true>> {
  const count = await deleteFile(id);
  if (count === 0)
    return { ok: false, error: { code: "NOT_FOUND", message: "file tidak ditemukan" } };
  return { ok: true, value: true };
}

// ─── Categories ───────────────────────────────────────────────────────────────

export async function listCategories(userId: number) {
  return getCategoriesByUser(userId);
}

export async function createCategory(
  userId: number,
  name: string,
  threadId?: number,
): Promise<ServiceResult<{ id: string }>> {
  try {
    const id = await insertCategory(userId, name.trim(), threadId);
    return { ok: true, value: { id } };
  } catch {
    return { ok: false, error: { code: "CONFLICT", message: "kategori sudah ada" } };
  }
}

export async function getOrCreateTagByName(
  userId: number,
  name: string,
): Promise<{ id: string; name: string }> {
  const slug = name.toLowerCase().replace(/\s+/g, "-");
  const existing = await getTagByName(userId, slug);
  if (existing) return { id: existing.id, name: existing.name };
  const id = await insertTag(userId, slug);
  return { id, name: slug };
}

export async function getOrCreateCategoryByThread(
  userId: number,
  threadId: number,
  topicName: string,
): Promise<{ id: string; name: string }> {
  const existing = await getCategoryByThreadId(userId, threadId);
  if (existing) return { id: existing.id, name: existing.name };
  const id = await insertCategory(userId, topicName, threadId);
  return { id, name: topicName };
}

export async function updateCategory(id: string, name: string): Promise<ServiceResult<true>> {
  const row = await getCategoryById(id);
  if (!row) return { ok: false, error: { code: "NOT_FOUND", message: "category tidak ditemukan" } };
  try {
    await renameCategory(id, name.trim());
    return { ok: true, value: true };
  } catch {
    return { ok: false, error: { code: "CONFLICT", message: "nama kategori sudah dipakai" } };
  }
}

export async function removeCategory(id: string): Promise<ServiceResult<true>> {
  const row = await getCategoryById(id);
  if (!row) return { ok: false, error: { code: "NOT_FOUND", message: "category tidak ditemukan" } };
  const fileCount = await countFilesByCategory(id);
  if (fileCount > 0) {
    return {
      ok: false,
      error: { code: "CONFLICT", message: `kategori masih dipakai oleh ${fileCount} file` },
    };
  }
  await deleteCategory(id);
  return { ok: true, value: true };
}

export async function listCategoriesWithCount(userId: number) {
  return getCategoryWithCount(userId);
}

// ─── Tags ─────────────────────────────────────────────────────────────────────

export async function listTags(userId: number) {
  return getTagsByUser(userId);
}

export async function createTag(
  userId: number,
  name: string,
): Promise<ServiceResult<{ id: string }>> {
  try {
    const id = await insertTag(userId, name.trim().toLowerCase());
    return { ok: true, value: { id } };
  } catch {
    return { ok: false, error: { code: "CONFLICT", message: "tag sudah ada" } };
  }
}

export async function listTagsWithCount(userId: number) {
  return getTagWithCount(userId);
}

export async function updateTag(
  id: string,
  userId: number,
  name: string,
): Promise<ServiceResult<true>> {
  const rows = await getTagsByUser(userId);
  if (!rows.find((t) => t.id === id)) {
    return { ok: false, error: { code: "NOT_FOUND", message: "tag tidak ditemukan" } };
  }
  try {
    await renameTag(id, name.trim().toLowerCase());
    return { ok: true, value: true };
  } catch {
    return { ok: false, error: { code: "CONFLICT", message: "nama tag sudah dipakai" } };
  }
}

export async function removeTag(id: string, userId: number): Promise<ServiceResult<true>> {
  const rows = await getTagsByUser(userId);
  if (!rows.find((t) => t.id === id)) {
    return { ok: false, error: { code: "NOT_FOUND", message: "tag tidak ditemukan" } };
  }
  await deleteTag(id);
  return { ok: true, value: true };
}

export { updateCategoryThreadId } from "./queries";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toFileInfo(row: Awaited<ReturnType<typeof getFileById>> & {}): FileInfo {
  return {
    id: row!.id,
    fileName: row!.fileName,
    fileType: row!.fileType,
    mimeType: row!.mimeType,
    fileSize: row!.fileSize,
    categoryId: row!.categoryId,
    caption: row!.caption,
    eventDate: row!.eventDate,
    isFavorite: row!.isFavorite,
    createdAt: row!.createdAt,
  };
}

export { updateFileStorageRef };
