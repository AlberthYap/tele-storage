type InlineButton = { text: string; callback_data: string };

export const CB = {
  CAT_NEW: "cat:new",
  TAG_NEW: "tag:new",
  TAG_DONE: "tag:done",
  DATE_PICK: "date:pick",
  DATE_SKIP: "date:skip",
  CONFIRM_SAVE: "confirm:save",
  CONFIRM_EDIT: "confirm:edit",
  CONFIRM_CANCEL: "confirm:cancel",
  CAT_PREFIX: "cat:",
  TAG_PREFIX: "tag:",
  DATE_PREFIX: "date:",
  CONFIRM_PREFIX: "confirm:",
  FAV_PREFIX: "fav:",
  // Browse flow (separate prefixes to avoid conflict with upload flow)
  BCAT_PREFIX: "bcat:",
  BCAT_SKIP: "bcat:skip",
  BQUERY_SKIP: "bquery:skip",
  BTAG_PREFIX: "btag:",
  BTAG_SKIP: "btag:skip",
  BTAG_DONE: "btag:done",
  BDATE_SKIP: "bdate:skip",
  BDATE_PICK: "bdate:pick",
  BROWSE_PREV: "browse:prev",
  BROWSE_NEXT: "browse:next",
  BROWSE_FAV: "browse:fav",
  BROWSE_SELECT: "browse:select",
  BROWSE_DOWNLOAD_SELECTED: "browse:dl_selected",
  BROWSE_CLOSE: "browse:close",
} as const;

export function categoryKeyboard(categories: { id: string; name: string }[]): {
  inline_keyboard: InlineButton[][];
} {
  const buttons = categories.map((c) => [{ text: c.name, callback_data: `cat:${c.id}` }]);
  buttons.push([{ text: "➕ Buat kategori baru", callback_data: CB.CAT_NEW }]);
  return { inline_keyboard: buttons };
}

export function tagsKeyboard(
  allTags: { id: string; name: string }[],
  selectedIds: string[],
): { inline_keyboard: InlineButton[][] } {
  const buttons = allTags.map((t) => {
    const selected = selectedIds.includes(t.id);
    return [{ text: `${selected ? "✅" : "☐"} #${t.name}`, callback_data: `tag:${t.id}` }];
  });
  buttons.push([{ text: "➕ Tambah tag baru", callback_data: CB.TAG_NEW }]);
  if (selectedIds.length > 0) {
    buttons.push([{ text: "✅ Konfirmasi tag", callback_data: CB.TAG_DONE }]);
  }
  return { inline_keyboard: buttons };
}

export function eventDateKeyboard(): { inline_keyboard: InlineButton[][] } {
  return {
    inline_keyboard: [
      [{ text: "📅 Pilih tanggal", callback_data: CB.DATE_PICK }],
      [{ text: "⏭ Lewati", callback_data: CB.DATE_SKIP }],
    ],
  };
}

export function browseCategoryKeyboard(
  categories: { id: string; name: string }[],
  opts?: { showSkipAll?: boolean },
): { inline_keyboard: InlineButton[][] } {
  const buttons = categories.map((c) => [{ text: c.name, callback_data: `${CB.BCAT_PREFIX}${c.id}` }]);
  if (opts?.showSkipAll) {
    buttons.push([{ text: "🔍 Semua kategori", callback_data: CB.BCAT_SKIP }]);
  }
  return { inline_keyboard: buttons };
}

export function browseTagsKeyboard(
  allTags: { id: string; name: string }[],
  selectedIds: string[],
): { inline_keyboard: InlineButton[][] } {
  const buttons = allTags.map((t) => {
    const selected = selectedIds.includes(t.id);
    return [{ text: `${selected ? "✅" : "☐"} #${t.name}`, callback_data: `${CB.BTAG_PREFIX}${t.id}` }];
  });
  buttons.push([
    { text: "✅ Konfirmasi", callback_data: CB.BTAG_DONE },
    { text: "⏭ Lewati", callback_data: CB.BTAG_SKIP },
  ]);
  return { inline_keyboard: buttons };
}

export function browseNavKeyboard(
  index: number,
  total: number,
  opts:
    | { mode: "setfavorite"; isFavorite: boolean }
    | { mode: "search"; isSelected: boolean; selectedCount: number },
): { inline_keyboard: InlineButton[][] } {
  if (opts.mode === "setfavorite") {
    return {
      inline_keyboard: [
        [
          { text: index > 0 ? "◀" : "·", callback_data: index > 0 ? CB.BROWSE_PREV : "noop" },
          { text: `${index + 1} / ${total}`, callback_data: "noop" },
          { text: index < total - 1 ? "▶" : "·", callback_data: index < total - 1 ? CB.BROWSE_NEXT : "noop" },
        ],
        [{ text: opts.isFavorite ? "★ Hapus Favorit" : "☆ Jadikan Favorit", callback_data: CB.BROWSE_FAV }],
        [{ text: "✕ Tutup", callback_data: CB.BROWSE_CLOSE }],
      ],
    };
  }

  // search mode: select + optional bulk download
  const bottomRow: InlineButton[] = opts.selectedCount > 0
    ? [
        { text: `⬇ Download (${opts.selectedCount})`, callback_data: CB.BROWSE_DOWNLOAD_SELECTED },
        { text: "✕ Tutup", callback_data: CB.BROWSE_CLOSE },
      ]
    : [{ text: "✕ Tutup", callback_data: CB.BROWSE_CLOSE }];

  return {
    inline_keyboard: [
      [
        { text: index > 0 ? "◀" : "·", callback_data: index > 0 ? CB.BROWSE_PREV : "noop" },
        { text: `${index + 1} / ${total}`, callback_data: "noop" },
        { text: index < total - 1 ? "▶" : "·", callback_data: index < total - 1 ? CB.BROWSE_NEXT : "noop" },
      ],
      [{ text: opts.isSelected ? "☑ Dipilih" : "☐ Pilih", callback_data: CB.BROWSE_SELECT }],
      bottomRow,
    ],
  };
}

export function favoriteKeyboard(
  files: { id: string; fileName: string; isFavorite: boolean }[],
): { inline_keyboard: InlineButton[][] } {
  return {
    inline_keyboard: files.map((f) => [
      {
        text: `${f.isFavorite ? "★" : "☆"} ${f.fileName}`,
        callback_data: `${CB.FAV_PREFIX}${f.id}`,
      },
    ]),
  };
}

export function confirmKeyboard(): { inline_keyboard: InlineButton[][] } {
  return {
    inline_keyboard: [
      [{ text: "✅ Simpan", callback_data: CB.CONFIRM_SAVE }],
      [{ text: "✏️ Edit metadata", callback_data: CB.CONFIRM_EDIT }],
      [{ text: "❌ Batal", callback_data: CB.CONFIRM_CANCEL }],
    ],
  };
}
