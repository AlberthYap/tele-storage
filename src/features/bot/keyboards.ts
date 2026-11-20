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

export function confirmKeyboard(): { inline_keyboard: InlineButton[][] } {
  return {
    inline_keyboard: [
      [{ text: "✅ Simpan", callback_data: CB.CONFIRM_SAVE }],
      [{ text: "✏️ Edit metadata", callback_data: CB.CONFIRM_EDIT }],
      [{ text: "❌ Batal", callback_data: CB.CONFIRM_CANCEL }],
    ],
  };
}
