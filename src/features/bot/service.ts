import {
  ingestFile,
  updateFileStorageRef,
  listCategories,
  listTags,
  createCategory,
  createTag,
  getOrCreateCategoryByThread,
  getOrCreateTagByName,
  updateCategoryThreadId,
  getFileByUniqueId,
  toggleFavorite,
  searchFiles,
  getCategoryById,
  renameCategory,
  deleteCategory,
  countFilesByCategory,
  renameTag,
  deleteTag,
  countFilesByTag,
  getRecentFiles,
  getStats,
} from "../files";
import { issueLoginCode } from "../auth";
import {
  getSession,
  setSession,
  initSession,
  clearSession,
  addFileToSession,
  addSkippedFileToSession,
  getBrowseSession,
  setBrowseSession,
  clearBrowseSession,
  getManageSession,
  setManageSession,
  clearManageSession,
  UploadStep,
  BrowseStep,
  type PendingFile,
  type UploadSession,
  type BrowseSession,
  type BrowseFile,
  type ManageSession,
} from "./session";
import {
  categoryKeyboard,
  tagsKeyboard,
  eventDateKeyboard,
  confirmKeyboard,
  favoriteKeyboard,
  browseCategoryKeyboard,
  browseTagsKeyboard,
  browseNavKeyboard,
  manageListKeyboard,
  manageConfirmDeleteKeyboard,
  CB,
} from "./keyboards";
import {
  sendMessage,
  editMessageText,
  copyMessage,
  createForumTopic,
  sendFileMessage,
  editMessageMedia,
  deleteMessage,
  answerCallbackQuery,
} from "../../lib/telegram";
import { redis } from "../../lib/redis";
import { runPaced } from "../../lib/paced";
import { logger } from "../../lib/logger";

// ─── Config ───────────────────────────────────────────────────────────────────

const STORAGE_CHAT_ID = () => Number(process.env.STORAGE_CHAT_ID!);

export const isAuthorized = (chatId: number): boolean =>
  (process.env.AUTHORIZED_CHAT_IDS ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter(Boolean)
    .includes(chatId);

// Groups use chatId as the user namespace so all members share the same categories/files.
const getDbUserId = (chatId: number, fromId: number, isGroup: boolean): number =>
  isGroup ? chatId : fromId;

// Tracks files from the most-recent save per chat so the favorite keyboard can be edited in-place.
type SavedFileEntry = { id: string; fileName: string; isFavorite: boolean };
type PostSaveState = { messageId: number; files: SavedFileEntry[] };
const postSaveStates = new Map<number, PostSaveState>();

// ─── Telegram media types ─────────────────────────────────────────────────────

type TgDocument = {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
};

type TgPhotoSize = { file_id: string; file_unique_id: string; file_size?: number };

// ─── parseFile ────────────────────────────────────────────────────────────────

function parseFile(msg: Record<string, unknown>, chatId: number): PendingFile | null {
  const base = {
    originalChatId: String(chatId),
    originalMessageId: msg.message_id as number,
    caption: (msg.caption as string) ?? null,
  };

  if (msg.document) {
    const doc = msg.document as TgDocument;
    return {
      ...base,
      fileId: doc.file_id,
      fileUniqueId: doc.file_unique_id,
      fileName: doc.file_name ?? `file-${Date.now()}`,
      fileType: "document",
      mimeType: doc.mime_type ?? null,
      fileSize: doc.file_size ?? 0,
    };
  }

  if (msg.photo) {
    const sizes = msg.photo as TgPhotoSize[];
    const best = sizes[sizes.length - 1]!; // Telegram sends multiple sizes; last = highest resolution
    return {
      ...base,
      fileId: best.file_id,
      fileUniqueId: best.file_unique_id,
      fileName: `photo-${Date.now()}.jpg`,
      fileType: "photo",
      mimeType: "image/jpeg",
      fileSize: best.file_size ?? 0,
    };
  }

  if (msg.video) {
    const vid = msg.video as TgDocument;
    return {
      ...base,
      fileId: vid.file_id,
      fileUniqueId: vid.file_unique_id,
      fileName: vid.file_name ?? `video-${Date.now()}.mp4`,
      fileType: "video",
      mimeType: vid.mime_type ?? "video/mp4",
      fileSize: vid.file_size ?? 0,
    };
  }

  if (msg.audio) {
    const aud = msg.audio as TgDocument;
    return {
      ...base,
      fileId: aud.file_id,
      fileUniqueId: aud.file_unique_id,
      fileName: aud.file_name ?? `audio-${Date.now()}.mp3`,
      fileType: "audio",
      mimeType: aud.mime_type ?? "audio/mpeg",
      fileSize: aud.file_size ?? 0,
    };
  }

  return null;
}

// ─── handleFile ───────────────────────────────────────────────────────────────

export async function handleFile(
  chatId: number,
  userId: number,
  msg: Record<string, unknown>,
  isGroup: boolean,
) {
  const file = parseFile(msg, chatId);
  if (!file) return;

  const threadId = (msg.message_thread_id as number | undefined) ?? null;
  const dbUserId = getDbUserId(chatId, userId, isGroup);
  const tOpts = threadId ? { message_thread_id: threadId } : {};
  const [duplicate, existing] = await Promise.all([
    getFileByUniqueId(file.fileUniqueId),
    getSession(chatId),
  ]);

  if (existing) {
    if (duplicate) {
      // Track silently — shown in post-save summary to avoid flooding chat during batch upload.
      await addSkippedFileToSession(chatId, file);
      return;
    }
    const fileCount = await addFileToSession(chatId, file);
    await updateSessionKeyboard(chatId, existing, fileCount);
    return;
  }

  if (duplicate) {
    await sendMessage(chatId, `⚠️ *${file.fileName}* sudah pernah disimpan, dilewati.`, {
      parse_mode: "Markdown",
      ...tOpts,
    });
    return;
  }

  // group with topic: auto-assign category + tag from topic name, skip straight to event date
  if (threadId) {
    const topicName = (msg.reply_to_message as Record<string, unknown> | undefined)
      ?.forum_topic_created as Record<string, string> | undefined;
    const categoryName = topicName?.name ?? `Topic #${threadId}`;
    const [category, tag] = await Promise.all([
      getOrCreateCategoryByThread(dbUserId, threadId, categoryName),
      getOrCreateTagByName(dbUserId, categoryName),
    ]);
    const kbMsg = await sendMessage(
      chatId,
      `📦 *${file.fileName}*\n_Kirim file lagi untuk batch._\n\n📅 Event date (opsional):`,
      { parse_mode: "Markdown", reply_markup: eventDateKeyboard(), ...tOpts },
    );
    const { created: topicCreated, session: topicSession } = await initSession(chatId, {
      step: UploadStep.AwaitingEventDate,
      files: [file],
      skippedFiles: [],
      userId: dbUserId,
      threadId,
      categoryId: category.id,
      categoryName: category.name,
      tagIds: [tag.id],
      eventDate: null,
      keyboardMessageId: kbMsg.message_id,
    });
    if (!topicCreated) await updateSessionKeyboard(chatId, topicSession, topicSession.files.length);
    return;
  }

  // private chat: standard flow — user picks category manually
  const userCategories = await listCategories(dbUserId);
  const kbMsg = await sendMessage(
    chatId,
    `📦 *${file.fileName}*\n_Kirim file lagi untuk batch._\n\nPilih kategori:`,
    { parse_mode: "Markdown", reply_markup: categoryKeyboard(userCategories) },
  );
  const { created, session: activeSession } = await initSession(chatId, {
    step: UploadStep.AwaitingCategory,
    files: [file],
    skippedFiles: [],
    userId: dbUserId,
    threadId: null,
    categoryId: null,
    categoryName: null,
    tagIds: [],
    eventDate: null,
    keyboardMessageId: kbMsg.message_id,
  });
  if (!created) await updateSessionKeyboard(chatId, activeSession, activeSession.files.length);
}

// Edits the existing keyboard message in-place instead of sending a new one,
// so batch uploads don't flood the chat with one message per file.
async function updateSessionKeyboard(chatId: number, session: UploadSession, count?: number) {
  if (!session.keyboardMessageId) return;
  const fileCount = count ?? session.files.length;

  if (session.step === UploadStep.AwaitingCategory) {
    const userCategories = await listCategories(session.userId);
    await editMessageText(
      chatId,
      session.keyboardMessageId,
      `📦 *${fileCount} file* — kirim lagi untuk batch, atau pilih kategori:`,
      { parse_mode: "Markdown", reply_markup: categoryKeyboard(userCategories) },
    );
  } else if (session.step === UploadStep.AwaitingTags) {
    const userTags = await listTags(session.userId);
    await editMessageText(
      chatId,
      session.keyboardMessageId,
      `📦 *${fileCount} file* — 🏷 Pilih tag (bisa lebih dari 1):`,
      { parse_mode: "Markdown", reply_markup: tagsKeyboard(userTags, session.tagIds) },
    );
  } else if (session.step === UploadStep.AwaitingEventDate) {
    await editMessageText(
      chatId,
      session.keyboardMessageId,
      `📦 *${fileCount} file* — 📅 Event date (opsional):`,
      { parse_mode: "Markdown", reply_markup: eventDateKeyboard() },
    );
  }
}

// ─── handleCallbackQuery ──────────────────────────────────────────────────────

export async function handleCallbackQuery(
  chatId: number,
  userId: number,
  data: string,
  messageId: number,
  threadId: number | null = null,
  callbackQueryId?: string,
) {
  void messageId;

  // Manage flow (rename/delete category & tag)
  if (
    data.startsWith(CB.MGT_CAT_PREFIX) ||
    data.startsWith(CB.MGT_TAG_PREFIX) ||
    data.startsWith(CB.MGT_PAGE_PREFIX) ||
    data === CB.MGT_CONFIRM_DELETE ||
    data === CB.MGT_CANCEL
  ) return handleManageCallback(chatId, data);

  // Browse flow uses its own session — must be routed before the upload session guard.
  if (data.startsWith(CB.FAV_PREFIX)) return handleFavoriteToggle(chatId, data);
  if (data === CB.BQUERY_SKIP) return handleBrowseQuerySkip(chatId, threadId);
  if (data.startsWith(CB.BCAT_PREFIX)) return handleBrowseCategoryStep(chatId, data, threadId);
  if (data.startsWith(CB.BTAG_PREFIX) || data === CB.BTAG_SKIP || data === CB.BTAG_DONE) return handleBrowseTagStep(chatId, data, threadId);
  if (data === CB.BDATE_SKIP || data === CB.BDATE_PICK) return handleBrowseDateStep(chatId, data, threadId);
  if (data === CB.BROWSE_SELECT || data === CB.BROWSE_DOWNLOAD_SELECTED || data.startsWith("browse:")) return handleBrowseNav(chatId, data, threadId);

  // Upload flow — requires an active upload session.
  const session = await getSession(chatId);
  if (!session) {
    await sendMessage(chatId, "Session expired. Kirim file lagi.");
    return;
  }

  if (data.startsWith(CB.CAT_PREFIX)) return handleCategoryStep(chatId, session, data);
  if (data.startsWith(CB.TAG_PREFIX)) return handleTagStep(chatId, session, data);
  if (data.startsWith(CB.DATE_PREFIX)) return handleDateStep(chatId, session, data);
  if (data.startsWith(CB.CONFIRM_PREFIX)) return handleConfirmStep(chatId, userId, session, data, callbackQueryId);
}

async function handleCategoryStep(chatId: number, session: UploadSession, data: string) {
  if (session.step !== UploadStep.AwaitingCategory) return;
  const tOpts = session.threadId ? { message_thread_id: session.threadId } : {};

  if (data === CB.CAT_NEW) {
    await sendMessage(chatId, "Ketik nama kategori baru:", tOpts);
    return;
  }

  const categoryId = data.slice(CB.CAT_PREFIX.length);
  const allCategories = await listCategories(session.userId);
  session.categoryId = categoryId;
  session.categoryName = allCategories.find((c) => c.id === categoryId)?.name ?? categoryId;
  session.step = UploadStep.AwaitingTags;

  const userTags = await listTags(session.userId);
  const kbMsg = await sendMessage(chatId, `🏷 Pilih tag (bisa lebih dari 1):`, {
    reply_markup: tagsKeyboard(userTags, []),
    ...tOpts,
  });
  session.keyboardMessageId = kbMsg.message_id;
  await setSession(chatId, session);
}

async function handleTagStep(chatId: number, session: UploadSession, data: string) {
  if (session.step !== UploadStep.AwaitingTags) return;
  const tOpts = session.threadId ? { message_thread_id: session.threadId } : {};

  if (data === CB.TAG_NEW) {
    await sendMessage(chatId, "Ketik nama tag baru:", tOpts);
    return;
  }

  if (data === CB.TAG_DONE) {
    if (session.tagIds.length === 0) {
      await sendMessage(chatId, "⚠️ Minimal pilih satu tag dulu.", tOpts);
      return;
    }
    session.step = UploadStep.AwaitingEventDate;
    const kbMsg = await sendMessage(chatId, "📅 Event date (opsional):", {
      reply_markup: eventDateKeyboard(),
      ...tOpts,
    });
    session.keyboardMessageId = kbMsg.message_id;
    await setSession(chatId, session);
    return;
  }

  // toggle tag selection; edit keyboard in-place to avoid flooding chat
  const tagId = data.slice(CB.TAG_PREFIX.length);
  const idx = session.tagIds.indexOf(tagId);
  if (idx >= 0) session.tagIds.splice(idx, 1);
  else session.tagIds.push(tagId);
  await setSession(chatId, session);

  const userTags = await listTags(session.userId);
  if (session.keyboardMessageId) {
    await editMessageText(
      chatId,
      session.keyboardMessageId,
      `🏷 Tag dipilih: ${session.tagIds.length}`,
      { reply_markup: tagsKeyboard(userTags, session.tagIds) },
    );
  } else {
    const kbMsg = await sendMessage(chatId, `🏷 Tag dipilih: ${session.tagIds.length}`, {
      reply_markup: tagsKeyboard(userTags, session.tagIds),
      ...tOpts,
    });
    session.keyboardMessageId = kbMsg.message_id;
    await setSession(chatId, session);
  }
}

async function handleDateStep(chatId: number, session: UploadSession, data: string) {
  if (session.step !== UploadStep.AwaitingEventDate) return;
  const tOpts = session.threadId ? { message_thread_id: session.threadId } : {};

  if (data === CB.DATE_PICK) {
    await sendMessage(chatId, "Ketik tanggal (format: YYYY-MM-DD, contoh: 2026-11-19):", tOpts);
    return;
  }

  // CB.DATE_SKIP
  session.eventDate = null;
  session.step = UploadStep.AwaitingConfirm;
  session.keyboardMessageId = null;
  await setSession(chatId, session);
  await showSummary(chatId, session);
}

async function handleConfirmStep(
  chatId: number,
  userId: number,
  session: UploadSession,
  data: string,
  callbackQueryId?: string,
) {
  if (session.step !== UploadStep.AwaitingConfirm) return;
  const tOpts = session.threadId ? { message_thread_id: session.threadId } : {};

  if (data === CB.CONFIRM_CANCEL) {
    if (session.keyboardMessageId) {
      await editMessageText(chatId, session.keyboardMessageId, "❌ Upload dibatalkan.", {});
    }
    await clearSession(chatId);
    return;
  }

  if (data === CB.CONFIRM_EDIT) {
    if (session.keyboardMessageId) {
      await editMessageText(chatId, session.keyboardMessageId, "✏️ Mengedit metadata...", {});
    }
    session.step = UploadStep.AwaitingCategory;
    session.categoryId = null;
    session.categoryName = null;
    session.tagIds = [];
    session.eventDate = null;
    session.keyboardMessageId = null;
    const userCategories = await listCategories(userId);
    const kbMsg = await sendMessage(chatId, "Pilih kategori:", {
      reply_markup: categoryKeyboard(userCategories),
      ...tOpts,
    });
    session.keyboardMessageId = kbMsg.message_id;
    await setSession(chatId, session);
    return;
  }

  if (data === CB.CONFIRM_SAVE) {
    const lockKey = `lock:save:${chatId}`;
    const acquired = await redis.set(lockKey, "1", "EX", 300, "NX");
    if (!acquired) {
      if (callbackQueryId) await answerCallbackQuery(callbackQueryId, "⏳ Sedang diproses, mohon tunggu...");
      return;
    }
    if (callbackQueryId) await answerCallbackQuery(callbackQueryId, "⏳ Menyimpan file, mohon tunggu...");
    try {
      await saveAll(chatId, session);
    } finally {
      await redis.del(lockKey);
    }
  }
}

// ─── handleText ───────────────────────────────────────────────────────────────

export async function handleText(chatId: number, userId: number, text: string, threadId: number | null = null) {
  const [session, browseSession] = await Promise.all([
    getSession(chatId),
    getBrowseSession(chatId),
  ]);
  // threadId from the message takes priority; fall back to active session's thread
  const resolvedThreadId = threadId ?? session?.threadId ?? null;
  const tOpts = resolvedThreadId ? { message_thread_id: resolvedThreadId } : {};

  if (session?.step === UploadStep.AwaitingCategory) {
    const result = await createCategory(session.userId, text);
    if (!result.ok) {
      await sendMessage(chatId, `❌ ${result.error.message}`, tOpts);
      return;
    }
    // Best-effort: create forum topic in storage group, errors are logged but don't block upload.
    await tryCreateForumTopic(result.value.id, text);
    session.categoryId = result.value.id;
    session.categoryName = text;
    session.step = UploadStep.AwaitingTags;
    const userTags = await listTags(session.userId);
    const kbMsg = await sendMessage(chatId, `✅ Kategori "${text}" dibuat.\n\n🏷 Pilih tag:`, {
      reply_markup: tagsKeyboard(userTags, []),
      ...tOpts,
    });
    session.keyboardMessageId = kbMsg.message_id;
    await setSession(chatId, session);
    return;
  }

  if (session?.step === UploadStep.AwaitingTags) {
    const result = await createTag(session.userId, text);
    if (result.ok) {
      session.tagIds.push(result.value.id);
      const userTags = await listTags(session.userId);
      if (session.keyboardMessageId) {
        await editMessageText(
          chatId,
          session.keyboardMessageId,
          `🏷 Tag dipilih: ${session.tagIds.length}`,
          { reply_markup: tagsKeyboard(userTags, session.tagIds) },
        );
      } else {
        const kbMsg = await sendMessage(chatId, `🏷 Tag dipilih: ${session.tagIds.length}`, {
          reply_markup: tagsKeyboard(userTags, session.tagIds),
          ...tOpts,
        });
        session.keyboardMessageId = kbMsg.message_id;
      }
      await setSession(chatId, session);
    }
    return;
  }

  if (session?.step === UploadStep.AwaitingEventDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      await sendMessage(chatId, "⚠️ Format salah. Gunakan YYYY-MM-DD, contoh: 2026-11-19", tOpts);
      return;
    }
    session.eventDate = text;
    session.step = UploadStep.AwaitingConfirm;
    await setSession(chatId, session);
    await showSummary(chatId, session);
    return;
  }

  // Search flow: user typed the search query
  if (browseSession?.step === BrowseStep.AwaitingQuery) {
    const bOpts = browseSession.threadId ? { message_thread_id: browseSession.threadId } : {};
    browseSession.q = text.trim();
    browseSession.step = BrowseStep.AwaitingCategory;
    await setBrowseSession(chatId, browseSession);
    const categories = await listCategories(browseSession.userId);
    await sendMessage(chatId, "📁 Filter kategori (opsional):", {
      reply_markup: browseCategoryKeyboard(categories, { showSkipAll: true }),
      ...bOpts,
    });
    return;
  }

  // Browse flow: user typed a date after clicking "📅 Pilih tanggal"
  if (browseSession?.step === BrowseStep.AwaitingEventDate) {
    const bOpts = browseSession.threadId ? { message_thread_id: browseSession.threadId } : {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      await sendMessage(chatId, "⚠️ Format salah. Gunakan YYYY-MM-DD, contoh: 2026-11-20", bOpts);
      return;
    }
    browseSession.eventDate = text;
    await setBrowseSession(chatId, browseSession);
    await showBrowseResults(chatId, browseSession, bOpts);
    return;
  }

  if (text === "/cancel") {
    const [uploadSession, browseSession_] = await Promise.all([
      getSession(chatId),
      getBrowseSession(chatId),
    ]);
    if (!uploadSession && !browseSession_) {
      await sendMessage(chatId, "Tidak ada sesi aktif.", tOpts);
      return;
    }
    if (uploadSession?.keyboardMessageId) {
      await editMessageText(chatId, uploadSession.keyboardMessageId, "❌ Upload dibatalkan.", {});
    }
    await Promise.all([clearSession(chatId), clearBrowseSession(chatId), redis.del(`lock:save:${chatId}`)]);
    await sendMessage(chatId, "✅ Sesi dibatalkan.", tOpts);
    return;
  }

  if (text === "/renamecategory") {
    await startManageFlow(chatId, userId, "rename_category", threadId);
    return;
  }

  if (text === "/deletecategory") {
    await startManageFlow(chatId, userId, "delete_category", threadId);
    return;
  }

  if (text === "/renametag") {
    await startManageFlow(chatId, userId, "rename_tag", threadId);
    return;
  }

  if (text === "/deletetag") {
    await startManageFlow(chatId, userId, "delete_tag", threadId);
    return;
  }

  // Manage flow: awaiting new name after item was selected
  const manageSession = await getManageSession(chatId);
  if (manageSession?.selectedId && (manageSession.action === "rename_category" || manageSession.action === "rename_tag")) {
    await handleManageRenameInput(chatId, manageSession, text, tOpts);
    return;
  }

  if (text.startsWith("/newcategory ")) {
    await handleNewCategory(chatId, userId, text, tOpts);
    return;
  }

  if (text === "/setfavorite") {
    await startBrowseFlow(chatId, userId, resolvedThreadId);
    return;
  }

  if (text === "/recent") {
    await startRecentFlow(chatId, userId, resolvedThreadId);
    return;
  }

  if (text === "/stats") {
    const dbUserId = getDbUserId(chatId, userId, threadId !== null);
    await handleStats(chatId, dbUserId, tOpts);
    return;
  }

  if (text === "/login") {
    const dbUserId = getDbUserId(chatId, userId, threadId !== null);
    const result = await issueLoginCode(dbUserId);
    if ("cooldownSeconds" in result) {
      await sendMessage(chatId, `⏳ Tunggu ${result.cooldownSeconds} detik lagi sebelum minta kode baru.`, tOpts);
      return;
    }
    await sendMessage(
      chatId,
      `🔑 Kode login dashboard: \`${result.code}\`\n\nMasukkan kode ini di halaman login. Berlaku 5 menit, cuma bisa dipakai sekali.`,
      { parse_mode: "Markdown", ...tOpts },
    );
    return;
  }

  if (text === "/search" || text.startsWith("/search ")) {
    await startSearchFlow(chatId, userId, resolvedThreadId);
    return;
  }

  if (text === "/start" || text === "/help") {
    await sendMessage(
      chatId,
      [
        "📦 *Telegram File Vault*",
        "",
        "Kirim file (dokumen, foto, video, audio) untuk mulai menyimpan.",
        "",
        "*Perintah:*",
        "/newcategory `Nama` — buat kategori baru (+ forum topic otomatis di group)",
        "/search — cari file berdasarkan kata kunci, kategori, tag, atau tanggal",
        "/setfavorite — cari file & tandai sebagai favorit",
        "/recent — lihat 20 upload terbaru",
        "/stats — lihat statistik penyimpanan",
        "/login — dapat kode login buat dashboard web",
        "/renamecategory — ubah nama kategori",
        "/deletecategory — hapus kategori",
        "/renametag — ubah nama tag",
        "/deletetag — hapus tag",
        "/cancel — batalkan sesi upload atau browse yang sedang aktif",
        "/help — tampilkan pesan ini",
        "",
        "*Tips:*",
        "• Kirim beberapa file sekaligus sebelum pilih kategori untuk batch upload",
        "• Di group, file yang dikirim ke topic tertentu otomatis masuk kategori yang sesuai",
        "• Duplikat dilewati otomatis dan dilaporkan di akhir",
      ].join("\n"),
      { parse_mode: "Markdown", ...tOpts },
    );
  }
}

// Creates a forum topic in the storage group and links it to the category.
// Returns the threadId on success, null if STORAGE_CHAT_ID is not set or topic creation fails.
async function tryCreateForumTopic(categoryId: string, name: string): Promise<number | null> {
  const groupId = STORAGE_CHAT_ID();
  if (!groupId) return null;
  try {
    const topic = await createForumTopic(groupId, name);
    await updateCategoryThreadId(categoryId, topic.message_thread_id);
    return topic.message_thread_id;
  } catch (err) {
    logger.error({ err }, "createForumTopic error");
    return null;
  }
}

async function handleNewCategory(
  chatId: number,
  userId: number,
  text: string,
  tOpts: Record<string, unknown>,
) {
  const name = text.slice("/newcategory ".length).trim();
  if (!name) {
    await sendMessage(chatId, "Format: /newcategory Nama Kategori", tOpts);
    return;
  }

  const dbUserId = isAuthorized(chatId) ? chatId : userId;
  const result = await createCategory(dbUserId, name);
  if (!result.ok) {
    await sendMessage(chatId, `❌ ${result.error.message}`, tOpts);
    return;
  }

  const threadId = await tryCreateForumTopic(result.value.id, name);
  if (threadId) {
    await sendMessage(STORAGE_CHAT_ID(), `✅ Kategori & topic "${name}" dibuat.`, {
      message_thread_id: threadId,
    });
  } else if (STORAGE_CHAT_ID()) {
    await sendMessage(
      chatId,
      `✅ Kategori "${name}" dibuat, tapi gagal buat topic (bot harus admin dengan Manage Topics).`,
      tOpts,
    );
  } else {
    await sendMessage(chatId, `✅ Kategori "${name}" dibuat.`, tOpts);
  }
}

async function handleStats(chatId: number, userId: number, tOpts: Record<string, unknown>) {
  const stats = await getStats(userId);
  const typeLines = stats.byFileType.map((t) => `• ${t.fileType}: ${t.count}`).join("\n");

  const text = [
    "📊 *Statistik*",
    "",
    `📦 Total file: ${stats.totalFiles}`,
    `📁 Kategori: ${stats.totalCategories}`,
    `🏷 Tag: ${stats.totalTags}`,
    "",
    "*By tipe:*",
    typeLines || "—",
    "",
    "*Upload terakhir:*",
    `• 7 hari: ${stats.last7Days}`,
    `• 30 hari: ${stats.last30Days}`,
  ].join("\n");

  await sendMessage(chatId, text, { parse_mode: "Markdown", ...tOpts });
}

function progressBar(done: number, total: number): string {
  const BAR_LEN = 10;
  const filled = Math.round((done / total) * BAR_LEN);
  const bar = "█".repeat(filled) + "░".repeat(BAR_LEN - filled);
  return `⏳ Menyimpan... [${bar}] ${done} / ${total}`;
}

// ─── saveAll ──────────────────────────────────────────────────────────────────

async function saveAll(chatId: number, session: UploadSession) {
  if (!session.categoryId) return;
  const categoryId = session.categoryId;
  const tOpts_ = session.threadId ? { message_thread_id: session.threadId } : {};
  const total = session.files.length;
  const progressMsg = await sendMessage(chatId, progressBar(0, total), tOpts_);
  const progressMsgId = progressMsg.message_id;

  const storageChatId = STORAGE_CHAT_ID();

  // Look up the category's forum topic threadId so files land in the right topic in storage group.
  const category = await getCategoryById(categoryId);
  const storageThreadId = category?.threadId ?? null;

  // Paced + per-file error isolation: one flood-wait or failure doesn't abort the whole batch.
  const { succeeded, failed } = await runPaced(
    session.files,
    async (file) => {
      // If the file was sent directly to the storage group, reuse the original message reference.
      // Otherwise copy it over so the DB always points to a stable message in the storage group.
      const alreadyInStorage = Number(file.originalChatId) === storageChatId;
      let refChatId = file.originalChatId;
      let refMessageId = file.originalMessageId;

      if (!alreadyInStorage) {
        const copied = await copyMessage(
          storageChatId,
          Number(file.originalChatId),
          file.originalMessageId,
          storageThreadId ?? undefined,
        );
        refChatId = String(storageChatId);
        refMessageId = copied.message_id;
      }

      const id = await ingestFile({
        userId: session.userId,
        fileName: file.fileName,
        fileType: file.fileType,
        mimeType: file.mimeType,
        fileSize: file.fileSize,
        fileId: file.fileId,
        fileUniqueId: file.fileUniqueId,
        storageChatId: refChatId,
        storageMessageId: refMessageId,
        originalChatId: file.originalChatId,
        originalMessageId: file.originalMessageId,
        categoryId,
        tagIds: session.tagIds,
        caption: file.caption,
        eventDate: session.eventDate,
      });
      if (!id) return null; // duplicate — nothing to save, not a failure
      await updateFileStorageRef(id, refChatId, refMessageId);
      const entry: SavedFileEntry = { id, fileName: file.fileName, isFavorite: false };
      return entry;
    },
    {
      onProgress: async (done) => {
        // Update progress every 5 files to avoid Telegram rate limits on edits.
        if (done % 5 === 0 || done === total) {
          await editMessageText(chatId, progressMsgId, progressBar(done, total));
        }
      },
    },
  );

  for (const f of failed) logger.error({ err: f.error }, "saveAll file error");
  const savedFiles = succeeded.map((s) => s.result).filter((r): r is SavedFileEntry => r !== null);
  const failedCount = failed.length;

  const tOpts = session.threadId ? { message_thread_id: session.threadId } : {};
  await editMessageText(chatId, progressMsgId, `✅ ${savedFiles.length} / ${total} file tersimpan.`);
  // Remove confirm buttons so user cannot click Simpan again after save completes.
  if (session.keyboardMessageId) {
    await editMessageText(chatId, session.keyboardMessageId, `📋 *Ringkasan Upload* — tersimpan ✅`, {
      parse_mode: "Markdown",
    });
  }
  // Clear session before sending so a file arriving while we await sendMessage starts fresh.
  await clearSession(chatId);

  await sendMessage(
    chatId,
    failedCount === 0
      ? `✅ ${savedFiles.length} file berhasil disimpan!`
      : `✅ ${savedFiles.length} berhasil, ❌ ${failedCount} gagal.`,
    tOpts,
  );

  if (session.skippedFiles.length > 0) {
    const names = session.skippedFiles.map((f) => `• ${f.fileName}`).join("\n");
    await sendMessage(
      chatId,
      `⚠️ ${session.skippedFiles.length} file dilewati (sudah tersimpan):\n${names}`,
      tOpts,
    );
  }

  if (savedFiles.length > 0 && savedFiles.length <= 5) {
    const kbMsg = await sendMessage(chatId, "⭐ Tandai sebagai favorit:", {
      reply_markup: favoriteKeyboard(savedFiles),
      ...tOpts,
    });
    postSaveStates.set(chatId, { messageId: kbMsg.message_id, files: savedFiles });
  }
}

// ─── Manage flow (rename / delete category & tag) ────────────────────────────

async function startManageFlow(chatId: number, userId: number, action: ManageSession["action"], threadId: number | null) {
  const tOpts = threadId ? { message_thread_id: threadId } : {};
  const isCategory = action.includes("category");
  const isRename = action.includes("rename");
  const items = isCategory ? await listCategories(userId) : await listTags(userId);
  if (items.length === 0) {
    await sendMessage(chatId, `Belum ada ${isCategory ? "kategori" : "tag"}.`, tOpts);
    return;
  }
  const prefix = isCategory ? CB.MGT_CAT_PREFIX : CB.MGT_TAG_PREFIX;
  const label = isRename
    ? `Pilih ${isCategory ? "kategori" : "tag"} yang ingin diubah namanya:`
    : `Pilih ${isCategory ? "kategori" : "tag"} yang ingin dihapus:`;
  const msg = await sendMessage(chatId, label, {
    reply_markup: manageListKeyboard(items, prefix, 0),
    ...tOpts,
  });
  await setManageSession(chatId, {
    action,
    userId,
    threadId,
    selectedId: null,
    selectedName: null,
    page: 0,
    listMessageId: msg.message_id,
  });
}

async function handleManageCallback(chatId: number, data: string) {
  const session = await getManageSession(chatId);
  if (!session) return;
  const tOpts = session.threadId ? { message_thread_id: session.threadId } : {};
  const isCategory = session.action.includes("category");

  if (data === CB.MGT_CANCEL) {
    if (session.listMessageId) await editMessageText(chatId, session.listMessageId, "✕ Dibatalkan.", {});
    await clearManageSession(chatId);
    return;
  }

  if (data.startsWith(CB.MGT_PAGE_PREFIX)) {
    const page = Number(data.slice(CB.MGT_PAGE_PREFIX.length));
    const items = isCategory ? await listCategories(session.userId) : await listTags(session.userId);
    const prefix = isCategory ? CB.MGT_CAT_PREFIX : CB.MGT_TAG_PREFIX;
    const isRename = session.action.includes("rename");
    const label = isRename
      ? `Pilih ${isCategory ? "kategori" : "tag"} yang ingin diubah namanya:`
      : `Pilih ${isCategory ? "kategori" : "tag"} yang ingin dihapus:`;
    if (session.listMessageId) {
      await editMessageText(chatId, session.listMessageId, label, { reply_markup: manageListKeyboard(items, prefix, page) });
    }
    session.page = page;
    await setManageSession(chatId, session);
    return;
  }

  // Item selected
  const prefix = isCategory ? CB.MGT_CAT_PREFIX : CB.MGT_TAG_PREFIX;
  if (data.startsWith(prefix)) {
    const id = data.slice(prefix.length);
    const items = isCategory ? await listCategories(session.userId) : await listTags(session.userId);
    const item = items.find((i) => i.id === id);
    if (!item) return;
    session.selectedId = id;
    session.selectedName = item.name;
    await setManageSession(chatId, session);

    if (session.action.includes("rename")) {
      if (session.listMessageId) await editMessageText(chatId, session.listMessageId, `✏️ "${item.name}" dipilih. Ketik nama baru:`, {});
    } else {
      // Count affected files before showing confirm dialog
      const fileCount = isCategory
        ? await countFilesByCategory(id)
        : await countFilesByTag(id);

      if (isCategory && fileCount > 0) {
        // Category can't be deleted while files reference it — block upfront
        if (session.listMessageId) {
          await editMessageText(
            chatId,
            session.listMessageId,
            `❌ Kategori *"${item.name}"* tidak bisa dihapus — masih dipakai oleh ${fileCount} file.`,
            { parse_mode: "Markdown" },
          );
        }
        await clearManageSession(chatId);
        return;
      }

      const countNote = fileCount > 0 ? `\n_(asosiasi tag akan dihapus dari ${fileCount} file)_` : "";
      if (session.listMessageId) {
        await editMessageText(
          chatId,
          session.listMessageId,
          `Hapus ${isCategory ? "kategori" : "tag"} *"${item.name}"*?${countNote}`,
          { parse_mode: "Markdown", reply_markup: manageConfirmDeleteKeyboard(item.name) },
        );
      }
    }
    return;
  }

  if (data === CB.MGT_CONFIRM_DELETE && session.selectedId) {
    try {
      if (isCategory) await deleteCategory(session.selectedId);
      else await deleteTag(session.selectedId);
      if (session.listMessageId) await editMessageText(chatId, session.listMessageId, `✅ "${session.selectedName}" berhasil dihapus.`, {});
    } catch {
      if (session.listMessageId) await editMessageText(chatId, session.listMessageId, `❌ Tidak bisa dihapus — masih ada file yang menggunakan ${isCategory ? "kategori" : "tag"} ini.`, {});
    }
    await clearManageSession(chatId);
  }
}

async function handleManageRenameInput(chatId: number, session: ManageSession, text: string, tOpts: Record<string, unknown>) {
  const isCategory = session.action.includes("category");
  const newName = text.trim();
  if (!newName) {
    await sendMessage(chatId, "Nama tidak boleh kosong.", tOpts);
    return;
  }
  try {
    if (isCategory) await renameCategory(session.selectedId!, newName);
    else await renameTag(session.selectedId!, newName);
    if (session.listMessageId) {
      await editMessageText(chatId, session.listMessageId, `✅ "${session.selectedName}" diubah menjadi "${newName}".`, {});
    }
  } catch {
    await sendMessage(chatId, `❌ Nama "${newName}" sudah dipakai.`, tOpts);
  }
  await clearManageSession(chatId);
}

async function handleFavoriteToggle(chatId: number, data: string) {
  const state = postSaveStates.get(chatId);
  if (!state) return;

  const fileId = data.slice(CB.FAV_PREFIX.length);
  const entry = state.files.find((f) => f.id === fileId);
  if (!entry) return;

  entry.isFavorite = !entry.isFavorite;
  await toggleFavorite(fileId, entry.isFavorite);
  await editMessageText(chatId, state.messageId, "⭐ Tandai sebagai favorit:", {
    reply_markup: favoriteKeyboard(state.files),
  });
}

// ─── Browse flow ──────────────────────────────────────────────────────────────

async function startBrowseFlow(chatId: number, userId: number, threadId: number | null) {
  const tOpts = threadId ? { message_thread_id: threadId } : {};
  const dbUserId = getDbUserId(chatId, userId, threadId !== null);
  const categories = await listCategories(dbUserId);

  if (categories.length === 0) {
    await sendMessage(chatId, "Belum ada kategori. Upload file dulu.", tOpts);
    return;
  }

  await sendMessage(chatId, "🔍 Pilih kategori:", {
    reply_markup: browseCategoryKeyboard(categories),
    ...tOpts,
  });
  await setBrowseSession(chatId, {
    step: BrowseStep.AwaitingCategory,
    source: "setfavorite",
    userId: dbUserId,
    threadId,
    q: null,
    categoryId: null,
    categoryName: null,
    tagIds: [],
    eventDate: null,
    results: [],
    currentIndex: 0,
    selectedIds: [],
    filterMessageId: null,
    browseMessageId: null,
  });
}

async function handleBrowseQuerySkip(chatId: number, cbThreadId: number | null = null) {
  const session = await getBrowseSession(chatId);
  if (!session || session.step !== BrowseStep.AwaitingQuery) return;
  const tid = session.threadId ?? cbThreadId;
  const tOpts = tid ? { message_thread_id: tid } : {};
  session.q = null;
  session.step = BrowseStep.AwaitingCategory;
  await setBrowseSession(chatId, session);
  const categories = await listCategories(session.userId);
  await sendMessage(chatId, "📁 Filter kategori (opsional):", {
    reply_markup: browseCategoryKeyboard(categories, { showSkipAll: true }),
    ...tOpts,
  });
}

async function startSearchFlow(chatId: number, userId: number, threadId: number | null) {
  const tOpts = threadId ? { message_thread_id: threadId } : {};
  const dbUserId = getDbUserId(chatId, userId, threadId !== null);
  await setBrowseSession(chatId, {
    step: BrowseStep.AwaitingQuery,
    source: "search",
    userId: dbUserId,
    threadId,
    q: null,
    categoryId: null,
    categoryName: null,
    tagIds: [],
    eventDate: null,
    results: [],
    currentIndex: 0,
    selectedIds: [],
    filterMessageId: null,
    browseMessageId: null,
  });
  await sendMessage(chatId, "🔍 Ketik kata kunci (opsional):", {
    reply_markup: { inline_keyboard: [[{ text: "⏭ Lewati", callback_data: CB.BQUERY_SKIP }]] },
    ...tOpts,
  });
}

async function handleBrowseCategoryStep(chatId: number, data: string, cbThreadId: number | null = null) {
  const session = await getBrowseSession(chatId);
  if (!session || session.step !== BrowseStep.AwaitingCategory) return;
  const tid = session.threadId ?? cbThreadId;
  const tOpts = tid ? { message_thread_id: tid } : {};

  if (data === CB.BCAT_SKIP) {
    // /search only: skip category filter, search across all categories
    session.categoryId = null;
    session.categoryName = null;
  } else {
    const categoryId = data.slice(CB.BCAT_PREFIX.length);
    const allCategories = await listCategories(session.userId);
    const category = allCategories.find((c) => c.id === categoryId);
    session.categoryId = categoryId;
    session.categoryName = category?.name ?? categoryId;
  }

  session.step = BrowseStep.AwaitingTags;
  await setBrowseSession(chatId, session);

  const userTags = await listTags(session.userId);
  const header = session.categoryName ? `📁 ${session.categoryName}\n\n` : "";
  const tagMsg = await sendMessage(chatId, `${header}🏷 Filter tag (opsional):`, {
    reply_markup: browseTagsKeyboard(userTags, []),
    ...tOpts,
  });
  session.filterMessageId = tagMsg.message_id;
  await setBrowseSession(chatId, session);
}

async function handleBrowseTagStep(chatId: number, data: string, cbThreadId: number | null = null) {
  const session = await getBrowseSession(chatId);
  if (!session || session.step !== BrowseStep.AwaitingTags) return;
  const tid = session.threadId ?? cbThreadId;
  const tOpts = tid ? { message_thread_id: tid } : {};

  if (data === CB.BTAG_SKIP || data === CB.BTAG_DONE) {
    session.step = BrowseStep.AwaitingEventDate;
    await setBrowseSession(chatId, session);
    await sendMessage(chatId, "📅 Filter event date (opsional):", {
      reply_markup: { inline_keyboard: [
        [{ text: "📅 Pilih tanggal", callback_data: CB.BDATE_PICK }],
        [{ text: "⏭ Lewati", callback_data: CB.BDATE_SKIP }],
      ]},
      ...tOpts,
    });
    return;
  }

  const tagId = data.slice(CB.BTAG_PREFIX.length);
  const idx = session.tagIds.indexOf(tagId);
  if (idx >= 0) session.tagIds.splice(idx, 1);
  else session.tagIds.push(tagId);
  await setBrowseSession(chatId, session);

  const userTags = await listTags(session.userId);
  const header = session.categoryName ? `📁 ${session.categoryName}\n\n` : "";
  const text = `${header}🏷 Filter tag (opsional):`;
  const keyboard = browseTagsKeyboard(userTags, session.tagIds);
  if (session.filterMessageId) {
    await editMessageText(chatId, session.filterMessageId, text, { reply_markup: keyboard });
  } else {
    const msg = await sendMessage(chatId, text, { reply_markup: keyboard, ...tOpts });
    session.filterMessageId = msg.message_id;
    await setBrowseSession(chatId, session);
  }
}

async function handleBrowseDateStep(chatId: number, data: string, cbThreadId: number | null = null) {
  const session = await getBrowseSession(chatId);
  if (!session || session.step !== BrowseStep.AwaitingEventDate) return;
  const tid = session.threadId ?? cbThreadId;
  const tOpts = tid ? { message_thread_id: tid } : {};

  if (data === CB.BDATE_PICK) {
    await sendMessage(chatId, "Ketik tanggal filter (YYYY-MM-DD):", tOpts);
    return;
  }

  // BDATE_SKIP — fetch and show results
  await showBrowseResults(chatId, session, tOpts);
}

async function showBrowseResults(
  chatId: number,
  session: BrowseSession,
  tOpts: Record<string, unknown>,
) {
  if (!session.categoryId && !session.q) {
    await sendMessage(chatId, "⚠️ Masukkan kata kunci atau pilih kategori dulu.", tOpts);
    return;
  }

  const rows = await searchFiles({
    userId: session.userId,
    q: session.q ?? undefined,
    categoryId: session.categoryId ?? undefined,
    tagIds: session.tagIds.length > 0 ? session.tagIds : undefined,
    eventDateFrom: session.eventDate ?? undefined,
    eventDateTo: session.eventDate ?? undefined,
    limit: 20,
    offset: 0,
  });

  if (rows.length === 0) {
    await sendMessage(chatId, "Tidak ada file yang cocok dengan filter.", tOpts);
    await clearBrowseSession(chatId);
    return;
  }

  const results: BrowseFile[] = rows.map((r) => ({
    id: r.id,
    fileName: r.fileName,
    fileType: r.fileType ?? "document",
    fileId: r.fileId,
    caption: r.caption,
    eventDate: r.eventDate,
    uploadedAt: r.createdAt.toISOString(),
    isFavorite: r.isFavorite,
  }));

  await displayBrowseResults(chatId, session, results, tOpts);
}

// Sets up browsing state and sends the first result with nav keyboard.
// Shared by /search, /setfavorite, and /recent — each only differs in how `results` is fetched.
async function displayBrowseResults(
  chatId: number,
  session: BrowseSession,
  results: BrowseFile[],
  tOpts: Record<string, unknown>,
) {
  session.results = results;
  session.currentIndex = 0;
  session.step = BrowseStep.Browsing;
  await setBrowseSession(chatId, session);

  const first = results[0]!;
  const caption = buildBrowseCaption(first, session.categoryName, 0, results.length);
  const navOpts = session.source === "setfavorite"
    ? { mode: "setfavorite" as const, isFavorite: first.isFavorite }
    : { mode: "search" as const, isSelected: false, selectedCount: 0 };
  const keyboard = browseNavKeyboard(0, results.length, navOpts);
  const msg = await sendFileMessage(chatId, first.fileType, first.fileId, caption, {
    reply_markup: keyboard,
    ...tOpts,
  });
  session.browseMessageId = msg.message_id;
  await setBrowseSession(chatId, session);
}

async function startRecentFlow(chatId: number, userId: number, threadId: number | null) {
  const tOpts = threadId ? { message_thread_id: threadId } : {};
  const dbUserId = getDbUserId(chatId, userId, threadId !== null);
  const rows = await getRecentFiles(dbUserId, 20);

  if (rows.length === 0) {
    await sendMessage(chatId, "Belum ada file tersimpan.", tOpts);
    return;
  }

  const results: BrowseFile[] = rows.map((r) => ({
    id: r.id,
    fileName: r.fileName,
    fileType: r.fileType ?? "document",
    fileId: r.fileId,
    caption: r.caption,
    eventDate: r.eventDate,
    uploadedAt: r.createdAt.toISOString(),
    isFavorite: r.isFavorite,
  }));

  const session: BrowseSession = {
    step: BrowseStep.AwaitingQuery,
    source: "recent",
    userId: dbUserId,
    threadId,
    q: null,
    categoryId: null,
    categoryName: null,
    tagIds: [],
    eventDate: null,
    results: [],
    currentIndex: 0,
    selectedIds: [],
    filterMessageId: null,
    browseMessageId: null,
  };

  await displayBrowseResults(chatId, session, results, tOpts);
}

async function handleBrowseNav(chatId: number, data: string, cbThreadId: number | null = null) {
  const session = await getBrowseSession(chatId);
  if (!session || session.step !== BrowseStep.Browsing || !session.browseMessageId) return;
  const tid = session.threadId ?? cbThreadId;
  const tOpts = tid ? { message_thread_id: tid } : {};

  if (data === CB.BROWSE_CLOSE) {
    await deleteMessage(chatId, session.browseMessageId);
    await clearBrowseSession(chatId);
    return;
  }

  if (data === CB.BROWSE_FAV && session.source === "setfavorite") {
    const file = session.results[session.currentIndex];
    if (!file) return;
    file.isFavorite = !file.isFavorite;
    await toggleFavorite(file.id, file.isFavorite);
    await editMessageMedia(
      chatId,
      session.browseMessageId,
      file.fileType,
      file.fileId,
      buildBrowseCaption(file, session.categoryName, session.currentIndex, session.results.length),
      browseNavKeyboard(session.currentIndex, session.results.length, { mode: "setfavorite", isFavorite: file.isFavorite }),
    );
    await setBrowseSession(chatId, session);
    return;
  }

  if (data === CB.BROWSE_SELECT && session.source !== "setfavorite") {
    const file = session.results[session.currentIndex];
    if (!file) return;
    const idx = session.selectedIds.indexOf(file.id);
    if (idx >= 0) session.selectedIds.splice(idx, 1);
    else session.selectedIds.push(file.id);
    await setBrowseSession(chatId, session);
    await editMessageMedia(
      chatId,
      session.browseMessageId,
      file.fileType,
      file.fileId,
      buildBrowseCaption(file, session.categoryName, session.currentIndex, session.results.length),
      browseNavKeyboard(session.currentIndex, session.results.length, {
        mode: "search",
        isSelected: session.selectedIds.includes(file.id),
        selectedCount: session.selectedIds.length,
      }),
    );
    return;
  }

  if (data === CB.BROWSE_DOWNLOAD_SELECTED && session.source !== "setfavorite") {
    const toSend = session.results.filter((f) => session.selectedIds.includes(f.id));
    const { failed } = await runPaced(toSend, (file) =>
      sendFileMessage(chatId, file.fileType, file.fileId, file.fileName, tOpts),
    );
    for (const f of failed) logger.error({ err: f.error }, "bulk download send error");
    session.selectedIds = [];
    await setBrowseSession(chatId, session);
    if (failed.length > 0) {
      await sendMessage(chatId, `⚠️ ${failed.length} / ${toSend.length} file gagal dikirim.`, tOpts);
    }
    return;
  }

  let newIndex = session.currentIndex;
  if (data === CB.BROWSE_PREV && newIndex > 0) newIndex--;
  if (data === CB.BROWSE_NEXT && newIndex < session.results.length - 1) newIndex++;
  if (newIndex === session.currentIndex) return;

  session.currentIndex = newIndex;
  await setBrowseSession(chatId, session);

  const file = session.results[newIndex]!;
  const caption = buildBrowseCaption(file, session.categoryName, newIndex, session.results.length);
  const navOpts = session.source === "setfavorite"
    ? { mode: "setfavorite" as const, isFavorite: file.isFavorite }
    : { mode: "search" as const, isSelected: session.selectedIds.includes(file.id), selectedCount: session.selectedIds.length };
  await editMessageMedia(
    chatId,
    session.browseMessageId,
    file.fileType,
    file.fileId,
    caption,
    browseNavKeyboard(newIndex, session.results.length, navOpts),
  );

  void tOpts;
}

function buildBrowseCaption(
  file: BrowseFile,
  categoryName: string | null,
  index: number,
  total: number,
): string {
  const lines = [`📄 ${file.fileName}`, `📁 ${categoryName ?? "-"}`];
  if (file.caption) lines.push(`📝 ${file.caption}`);
  if (file.eventDate) lines.push(`📅 Event: ${file.eventDate}`);
  lines.push(`🕘 Upload: ${file.uploadedAt.split("T")[0]}`);
  if (total > 1) lines.push(`\n${index + 1} dari ${total} file`);
  return lines.join("\n");
}

// ─── showSummary ──────────────────────────────────────────────────────────────

async function showSummary(chatId: number, session: UploadSession) {
  const tOpts = session.threadId ? { message_thread_id: session.threadId } : {};
  const fileList = session.files.map((f, i) => `${i + 1}. ${f.fileName}`).join("\n");
  const text = [
    `📋 *Ringkasan Upload*`,
    ``,
    `*File (${session.files.length}):*`,
    fileList,
    ``,
    `📁 Kategori: ${session.categoryName ?? "-"}`,
    `🏷 Tags: ${session.tagIds.length} dipilih`,
    `📅 Event date: ${session.eventDate ?? "-"}`,
    ``,
    `Simpan sekarang?`,
  ].join("\n");
  const msg = await sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: confirmKeyboard(),
    ...tOpts,
  });
  session.keyboardMessageId = msg.message_id;
  await setSession(chatId, session);
}
