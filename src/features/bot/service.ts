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
} from "../files";
import {
  getSession,
  setSession,
  clearSession,
  addFileToSession,
  addSkippedFileToSession,
  getBrowseSession,
  setBrowseSession,
  clearBrowseSession,
  UploadStep,
  BrowseStep,
  type PendingFile,
  type UploadSession,
  type BrowseSession,
  type BrowseFile,
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
} from "../../lib/telegram";
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
  const duplicate = await getFileByUniqueId(file.fileUniqueId);
  const existing = getSession(chatId);

  if (existing) {
    if (duplicate) {
      // Track silently — shown in post-save summary to avoid flooding chat during batch upload.
      addSkippedFileToSession(chatId, file);
      return;
    }
    addFileToSession(chatId, file);
    await updateSessionKeyboard(chatId, existing);
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
    setSession(chatId, {
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
    return;
  }

  // private chat: standard flow — user picks category manually
  const userCategories = await listCategories(dbUserId);
  const kbMsg = await sendMessage(
    chatId,
    `📦 *${file.fileName}*\n_Kirim file lagi untuk batch._\n\nPilih kategori:`,
    { parse_mode: "Markdown", reply_markup: categoryKeyboard(userCategories) },
  );
  setSession(chatId, {
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
}

// Edits the existing keyboard message in-place instead of sending a new one,
// so batch uploads don't flood the chat with one message per file.
async function updateSessionKeyboard(chatId: number, session: UploadSession) {
  if (!session.keyboardMessageId) return;
  const count = session.files.length;

  if (session.step === UploadStep.AwaitingCategory) {
    const userCategories = await listCategories(session.userId);
    await editMessageText(
      chatId,
      session.keyboardMessageId,
      `📦 *${count} file* — kirim lagi untuk batch, atau pilih kategori:`,
      { parse_mode: "Markdown", reply_markup: categoryKeyboard(userCategories) },
    );
  } else if (session.step === UploadStep.AwaitingTags) {
    const userTags = await listTags(session.userId);
    await editMessageText(
      chatId,
      session.keyboardMessageId,
      `📦 *${count} file* — 🏷 Pilih tag (bisa lebih dari 1):`,
      { parse_mode: "Markdown", reply_markup: tagsKeyboard(userTags, session.tagIds) },
    );
  } else if (session.step === UploadStep.AwaitingEventDate) {
    await editMessageText(
      chatId,
      session.keyboardMessageId,
      `📦 *${count} file* — 📅 Event date (opsional):`,
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
) {
  void messageId;

  // Browse flow uses its own session — must be routed before the upload session guard.
  if (data.startsWith(CB.FAV_PREFIX)) return handleFavoriteToggle(chatId, data);
  if (data.startsWith(CB.BCAT_PREFIX)) return handleBrowseCategoryStep(chatId, data);
  if (data.startsWith(CB.BTAG_PREFIX) || data === CB.BTAG_SKIP || data === CB.BTAG_DONE) return handleBrowseTagStep(chatId, data);
  if (data === CB.BDATE_SKIP || data === CB.BDATE_PICK) return handleBrowseDateStep(chatId, data);
  if (data.startsWith("browse:")) return handleBrowseNav(chatId, data);

  // Upload flow — requires an active upload session.
  const session = getSession(chatId);
  if (!session) {
    await sendMessage(chatId, "Session expired. Kirim file lagi.");
    return;
  }

  if (data.startsWith(CB.CAT_PREFIX)) return handleCategoryStep(chatId, session, data);
  if (data.startsWith(CB.TAG_PREFIX)) return handleTagStep(chatId, session, data);
  if (data.startsWith(CB.DATE_PREFIX)) return handleDateStep(chatId, session, data);
  if (data.startsWith(CB.CONFIRM_PREFIX)) return handleConfirmStep(chatId, userId, session, data);
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
  setSession(chatId, session);
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
    setSession(chatId, session);
    return;
  }

  // toggle tag selection; edit keyboard in-place to avoid flooding chat
  const tagId = data.slice(CB.TAG_PREFIX.length);
  const idx = session.tagIds.indexOf(tagId);
  if (idx >= 0) session.tagIds.splice(idx, 1);
  else session.tagIds.push(tagId);
  setSession(chatId, session);

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
    setSession(chatId, session);
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
  setSession(chatId, session);
  await showSummary(chatId, session);
}

async function handleConfirmStep(
  chatId: number,
  userId: number,
  session: UploadSession,
  data: string,
) {
  if (session.step !== UploadStep.AwaitingConfirm) return;
  const tOpts = session.threadId ? { message_thread_id: session.threadId } : {};

  if (data === CB.CONFIRM_CANCEL) {
    clearSession(chatId);
    await sendMessage(chatId, "❌ Upload dibatalkan.", tOpts);
    return;
  }

  if (data === CB.CONFIRM_EDIT) {
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
    setSession(chatId, session);
    return;
  }

  if (data === CB.CONFIRM_SAVE) {
    await saveAll(chatId, session);
  }
}

// ─── handleText ───────────────────────────────────────────────────────────────

export async function handleText(chatId: number, userId: number, text: string) {
  const session = getSession(chatId);
  const browseSession = getBrowseSession(chatId);
  const tOpts = session?.threadId ? { message_thread_id: session.threadId } : {};

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
    setSession(chatId, session);
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
      setSession(chatId, session);
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
    setSession(chatId, session);
    await showSummary(chatId, session);
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
    setBrowseSession(chatId, browseSession);
    await showBrowseResults(chatId, browseSession, bOpts);
    return;
  }

  if (text.startsWith("/newcategory ")) {
    await handleNewCategory(chatId, userId, text, tOpts);
    return;
  }

  if (text === "/setfavorite") {
    await startBrowseFlow(chatId, userId, session?.threadId ?? null);
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
        "/setfavorite — cari file & tandai sebagai favorit",
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

// ─── saveAll ──────────────────────────────────────────────────────────────────

async function saveAll(chatId: number, session: UploadSession) {
  if (!session.categoryId) return;

  const storageChatId = STORAGE_CHAT_ID();
  const savedFiles: SavedFileEntry[] = [];
  let failed = 0;

  for (const file of session.files) {
    try {
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
        categoryId: session.categoryId,
        tagIds: session.tagIds,
        caption: file.caption,
        eventDate: session.eventDate,
      });
      if (id) {
        await updateFileStorageRef(id, refChatId, refMessageId);
        savedFiles.push({ id, fileName: file.fileName, isFavorite: false });
      }
    } catch (err) {
      logger.error({ err }, "saveAll file error");
      failed++;
    }
  }

  const tOpts = session.threadId ? { message_thread_id: session.threadId } : {};
  // Clear session before sending so a file arriving while we await sendMessage starts fresh.
  clearSession(chatId);

  await sendMessage(
    chatId,
    failed === 0
      ? `✅ ${savedFiles.length} file berhasil disimpan!`
      : `✅ ${savedFiles.length} berhasil, ❌ ${failed} gagal.`,
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

  if (savedFiles.length > 0) {
    const kbMsg = await sendMessage(chatId, "⭐ Tandai sebagai favorit:", {
      reply_markup: favoriteKeyboard(savedFiles),
      ...tOpts,
    });
    postSaveStates.set(chatId, { messageId: kbMsg.message_id, files: savedFiles });
  }
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
  setBrowseSession(chatId, {
    step: BrowseStep.AwaitingCategory,
    userId: dbUserId,
    threadId,
    categoryId: null,
    categoryName: null,
    tagIds: [],
    eventDate: null,
    results: [],
    currentIndex: 0,
    browseMessageId: null,
  });
}

async function handleBrowseCategoryStep(chatId: number, data: string) {
  const session = getBrowseSession(chatId);
  if (!session || session.step !== BrowseStep.AwaitingCategory) return;
  const tOpts = session.threadId ? { message_thread_id: session.threadId } : {};

  const categoryId = data.slice(CB.BCAT_PREFIX.length);
  const allCategories = await listCategories(session.userId);
  const category = allCategories.find((c) => c.id === categoryId);

  session.categoryId = categoryId;
  session.categoryName = category?.name ?? categoryId;
  session.step = BrowseStep.AwaitingTags;
  setBrowseSession(chatId, session);

  const userTags = await listTags(session.userId);
  await sendMessage(chatId, `📁 ${session.categoryName}\n\n🏷 Filter tag (opsional):`, {
    reply_markup: browseTagsKeyboard(userTags, []),
    ...tOpts,
  });
}

async function handleBrowseTagStep(chatId: number, data: string) {
  const session = getBrowseSession(chatId);
  if (!session || session.step !== BrowseStep.AwaitingTags) return;
  const tOpts = session.threadId ? { message_thread_id: session.threadId } : {};

  if (data === CB.BTAG_SKIP || data === CB.BTAG_DONE) {
    session.step = BrowseStep.AwaitingEventDate;
    setBrowseSession(chatId, session);
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
  setBrowseSession(chatId, session);

  const userTags = await listTags(session.userId);
  await sendMessage(chatId, `📁 ${session.categoryName}\n\n🏷 Filter tag (opsional):`, {
    reply_markup: browseTagsKeyboard(userTags, session.tagIds),
    ...tOpts,
  });
}

async function handleBrowseDateStep(chatId: number, data: string) {
  const session = getBrowseSession(chatId);
  if (!session || session.step !== BrowseStep.AwaitingEventDate) return;
  const tOpts = session.threadId ? { message_thread_id: session.threadId } : {};

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
  if (!session.categoryId) return;

  const rows = await searchFiles({
    userId: session.userId,
    categoryId: session.categoryId,
    tagIds: session.tagIds.length > 0 ? session.tagIds : undefined,
    eventDateFrom: session.eventDate ?? undefined,
    eventDateTo: session.eventDate ?? undefined,
    limit: 20,
    offset: 0,
  });

  if (rows.length === 0) {
    await sendMessage(chatId, "Tidak ada file yang cocok dengan filter.", tOpts);
    clearBrowseSession(chatId);
    return;
  }

  const results: BrowseFile[] = rows.map((r) => ({
    id: r.id,
    fileName: r.fileName,
    fileType: r.fileType ?? "document",
    fileId: r.fileId,
    eventDate: r.eventDate,
    isFavorite: r.isFavorite,
  }));

  session.results = results;
  session.currentIndex = 0;
  session.step = BrowseStep.Browsing;
  setBrowseSession(chatId, session);

  const first = results[0]!;
  const caption = buildBrowseCaption(first, session.categoryName, 0, results.length);
  const keyboard = browseNavKeyboard(0, results.length, first.isFavorite);
  const msg = await sendFileMessage(chatId, first.fileType, first.fileId, caption, {
    reply_markup: keyboard,
    ...tOpts,
  });
  session.browseMessageId = msg.message_id;
  setBrowseSession(chatId, session);
}

async function handleBrowseNav(chatId: number, data: string) {
  const session = getBrowseSession(chatId);
  if (!session || session.step !== BrowseStep.Browsing || !session.browseMessageId) return;
  const tOpts = session.threadId ? { message_thread_id: session.threadId } : {};

  if (data === CB.BROWSE_CLOSE) {
    await deleteMessage(chatId, session.browseMessageId);
    clearBrowseSession(chatId);
    return;
  }

  if (data === CB.BROWSE_FAV) {
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
      browseNavKeyboard(session.currentIndex, session.results.length, file.isFavorite),
    );
    setBrowseSession(chatId, session);
    return;
  }

  let newIndex = session.currentIndex;
  if (data === CB.BROWSE_PREV && newIndex > 0) newIndex--;
  if (data === CB.BROWSE_NEXT && newIndex < session.results.length - 1) newIndex++;
  if (newIndex === session.currentIndex) return;

  session.currentIndex = newIndex;
  setBrowseSession(chatId, session);

  const file = session.results[newIndex]!;
  const caption = buildBrowseCaption(file, session.categoryName, newIndex, session.results.length);
  await editMessageMedia(
    chatId,
    session.browseMessageId,
    file.fileType,
    file.fileId,
    caption,
    browseNavKeyboard(newIndex, session.results.length, file.isFavorite),
  );

  void tOpts; // thread context is on the original message, not needed for edits
}

function buildBrowseCaption(
  file: BrowseFile,
  categoryName: string | null,
  index: number,
  total: number,
): string {
  const lines = [`📄 ${file.fileName}`, `📁 ${categoryName ?? "-"}`];
  if (file.eventDate) lines.push(`📅 ${file.eventDate}`);
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
  await sendMessage(chatId, text, {
    parse_mode: "Markdown",
    reply_markup: confirmKeyboard(),
    ...tOpts,
  });
}
