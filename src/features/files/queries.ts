import { eq, desc, sql, and, inArray, gte, lte, isNotNull } from "drizzle-orm";
import { db } from "../../shared/db";
import { files, categories, tags, fileTags } from "./schema";

export type FileRow = typeof files.$inferSelect;
export type CategoryRow = typeof categories.$inferSelect;
export type TagRow = typeof tags.$inferSelect;

// ─── Categories ───────────────────────────────────────────────────────────────

export async function getCategoriesByUser(userId: number): Promise<CategoryRow[]> {
  return db.select().from(categories).where(eq(categories.userId, userId));
}

export async function insertCategory(
  userId: number,
  name: string,
  threadId?: number,
): Promise<string> {
  const rows = await db
    .insert(categories)
    .values({ userId, name, threadId })
    .returning({ id: categories.id });
  return rows[0]!.id;
}

export async function getCategoryByThreadId(
  userId: number,
  threadId: number,
): Promise<CategoryRow | undefined> {
  const rows = await db
    .select()
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.threadId, threadId)));
  return rows[0];
}

export async function getCategoryById(id: string): Promise<CategoryRow | undefined> {
  const rows = await db.select().from(categories).where(eq(categories.id, id));
  return rows[0];
}

export async function renameCategory(id: string, name: string): Promise<void> {
  await db.update(categories).set({ name }).where(eq(categories.id, id));
}

export async function updateCategoryThreadId(id: string, threadId: number): Promise<void> {
  await db.update(categories).set({ threadId }).where(eq(categories.id, id));
}

export async function countFilesByCategory(categoryId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(files)
    .where(eq(files.categoryId, categoryId));
  return rows[0]?.count ?? 0;
}

export async function deleteCategory(id: string): Promise<void> {
  await db.delete(categories).where(eq(categories.id, id));
}

// ─── Tags ─────────────────────────────────────────────────────────────────────

export async function getTagsByUser(userId: number): Promise<TagRow[]> {
  return db.select().from(tags).where(eq(tags.userId, userId));
}

export async function insertTag(userId: number, name: string): Promise<string> {
  const rows = await db.insert(tags).values({ userId, name }).returning({ id: tags.id });
  return rows[0]!.id;
}

export async function getTagById(id: string): Promise<TagRow | undefined> {
  const rows = await db.select().from(tags).where(eq(tags.id, id));
  return rows[0];
}

export async function getTagByName(userId: number, name: string): Promise<TagRow | undefined> {
  const rows = await db
    .select()
    .from(tags)
    .where(and(eq(tags.userId, userId), eq(tags.name, name)));
  return rows[0];
}

export async function renameTag(id: string, name: string): Promise<void> {
  await db.update(tags).set({ name }).where(eq(tags.id, id));
}

export async function countFilesByTag(tagId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(fileTags)
    .where(eq(fileTags.tagId, tagId));
  return rows[0]?.count ?? 0;
}

export async function deleteTag(id: string): Promise<void> {
  await db.delete(tags).where(eq(tags.id, id));
}

// ─── Files ────────────────────────────────────────────────────────────────────

export async function insertFile(args: {
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
  caption: string | null;
  eventDate: string | null;
}): Promise<string | null> {
  const rows = await db
    .insert(files)
    .values(args)
    .onConflictDoNothing({ target: files.fileUniqueId })
    .returning({ id: files.id });
  return rows[0]?.id ?? null; // null means file already exists (ON CONFLICT DO NOTHING)
}

export async function attachTags(fileId: string, tagIds: string[]): Promise<void> {
  if (tagIds.length === 0) return;
  await db.insert(fileTags).values(tagIds.map((tagId) => ({ fileId, tagId })));
}

export async function searchFiles(args: {
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
}): Promise<FileRow[]> {
  const conditions = [eq(files.userId, args.userId)];

  if (args.categoryId) conditions.push(eq(files.categoryId, args.categoryId));
  if (args.fileType) conditions.push(eq(files.fileType, args.fileType));
  if (args.eventDateFrom) conditions.push(gte(files.eventDate, args.eventDateFrom));
  if (args.eventDateTo) conditions.push(lte(files.eventDate, args.eventDateTo));
  if (args.uploadDateFrom) conditions.push(gte(files.createdAt, new Date(args.uploadDateFrom)));
  if (args.uploadDateTo) conditions.push(lte(files.createdAt, new Date(args.uploadDateTo)));

  if (args.q && args.q.trim()) {
    conditions.push(
      sql`to_tsvector('simple', ${files.fileName} || ' ' || coalesce(${files.caption}, ''))
          @@ websearch_to_tsquery('simple', ${args.q.trim()})`,
    );
  }

  let query = db
    .select()
    .from(files)
    .where(and(...conditions));

  if (args.tagIds && args.tagIds.length > 0) {
    // only return files that have ALL requested tags (not just any)
    const fileIdsWithTags = db
      .select({ fileId: fileTags.fileId })
      .from(fileTags)
      .where(inArray(fileTags.tagId, args.tagIds))
      .groupBy(fileTags.fileId)
      .having(sql`count(distinct ${fileTags.tagId}) = ${args.tagIds.length}`);

    conditions.push(inArray(files.id, fileIdsWithTags));
    query = db
      .select()
      .from(files)
      .where(and(...conditions));
  }

  return query.orderBy(desc(files.createdAt)).limit(args.limit).offset(args.offset);
}

export async function getFileById(id: string): Promise<FileRow | undefined> {
  const rows = await db.select().from(files).where(eq(files.id, id));
  return rows[0];
}

export async function getFileByUniqueId(fileUniqueId: string): Promise<FileRow | undefined> {
  const rows = await db.select().from(files).where(eq(files.fileUniqueId, fileUniqueId));
  return rows[0];
}

export async function getTagsForFile(fileId: string): Promise<TagRow[]> {
  return db
    .select({ id: tags.id, userId: tags.userId, name: tags.name, createdAt: tags.createdAt })
    .from(fileTags)
    .innerJoin(tags, eq(fileTags.tagId, tags.id))
    .where(eq(fileTags.fileId, fileId));
}

export async function updateFileStorageRef(
  id: string,
  storageChatId: string,
  storageMessageId: number,
): Promise<void> {
  await db
    .update(files)
    .set({ storageChatId, storageMessageId, updatedAt: new Date() })
    .where(eq(files.id, id));
}

export async function toggleFavorite(id: string, isFavorite: boolean): Promise<void> {
  await db.update(files).set({ isFavorite, updatedAt: new Date() }).where(eq(files.id, id));
}

export async function deleteFile(id: string): Promise<number> {
  const rows = await db.delete(files).where(eq(files.id, id)).returning({ id: files.id });
  return rows.length;
}

export async function getRecentFiles(userId: number, limit = 20): Promise<FileRow[]> {
  return db.select().from(files).where(eq(files.userId, userId)).orderBy(desc(files.createdAt)).limit(limit);
}

export async function getStats(userId: number): Promise<{
  totalFiles: number;
  totalCategories: number;
  totalTags: number;
  byFileType: { fileType: string; count: number }[];
  last7Days: number;
  last30Days: number;
}> {
  const now = new Date();
  const d7 = new Date(now); d7.setDate(d7.getDate() - 7);
  const d30 = new Date(now); d30.setDate(d30.getDate() - 30);

  const [[totalFilesRow], [totalCatsRow], [totalTagsRow], byType, [last7Row], [last30Row]] =
    await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(files).where(eq(files.userId, userId)),
      db.select({ count: sql<number>`count(*)::int` }).from(categories).where(eq(categories.userId, userId)),
      db.select({ count: sql<number>`count(*)::int` }).from(tags).where(eq(tags.userId, userId)),
      db.select({ fileType: files.fileType, count: sql<number>`count(*)::int` })
        .from(files).where(eq(files.userId, userId)).groupBy(files.fileType),
      db.select({ count: sql<number>`count(*)::int` }).from(files)
        .where(and(eq(files.userId, userId), gte(files.createdAt, d7))),
      db.select({ count: sql<number>`count(*)::int` }).from(files)
        .where(and(eq(files.userId, userId), gte(files.createdAt, d30))),
    ]);

  return {
    totalFiles: totalFilesRow?.count ?? 0,
    totalCategories: totalCatsRow?.count ?? 0,
    totalTags: totalTagsRow?.count ?? 0,
    byFileType: [...byType]
      .sort((a, b) => b.count - a.count)
      .map((r) => ({ fileType: r.fileType ?? "lainnya", count: r.count })),
    last7Days: last7Row?.count ?? 0,
    last30Days: last30Row?.count ?? 0,
  };
}
