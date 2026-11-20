import {
  pgTable,
  uuid,
  text,
  bigint,
  boolean,
  date,
  timestamp,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: bigint("user_id", { mode: "number" }).notNull(),
    name: text("name").notNull(),
    threadId: bigint("thread_id", { mode: "number" }), // linked Telegram forum topic; null for private-chat categories
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("categories_user_name_uidx").on(t.userId, t.name),
    index("categories_user_thread_idx").on(t.userId, t.threadId),
  ],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: bigint("user_id", { mode: "number" }).notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("tags_user_name_uidx").on(t.userId, t.name)],
);

export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: bigint("user_id", { mode: "number" }).notNull(),
    fileName: text("file_name").notNull(),
    fileType: text("file_type"),
    mimeType: text("mime_type"),
    fileSize: bigint("file_size", { mode: "number" }).notNull().default(0),
    fileId: text("file_id").notNull(),
    fileUniqueId: text("file_unique_id").notNull(),
    storageChatId: text("storage_chat_id"),
    storageMessageId: bigint("storage_message_id", { mode: "number" }),
    originalChatId: text("original_chat_id"),
    originalMessageId: bigint("original_message_id", { mode: "number" }),
    categoryId: uuid("category_id").references(() => categories.id),
    caption: text("caption"),
    eventDate: date("event_date"),
    isFavorite: boolean("is_favorite").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("files_user_id_idx").on(t.userId),
    index("files_category_id_idx").on(t.categoryId),
    uniqueIndex("files_file_unique_id_uidx").on(t.fileUniqueId),
  ],
);

export const fileTags = pgTable(
  "file_tags",
  {
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.fileId, t.tagId] }), index("file_tags_tag_id_idx").on(t.tagId)],
);
