import { describe, test, expect, afterEach } from "bun:test";
import { db } from "../../shared/db";
import { files, categories, tags } from "./schema";
import { eq } from "drizzle-orm";
import { insertFile, getCategoryById, getTagById } from "./queries";
import {
  createCategory,
  updateCategory,
  removeCategory,
  createTag,
  updateTag,
  removeTag,
} from "./service";

// Clearly-fake userId so these tests never touch real catalog data.
const TEST_USER = 900000003;

afterEach(async () => {
  await db.delete(files).where(eq(files.userId, TEST_USER));
  await db.delete(categories).where(eq(categories.userId, TEST_USER));
  await db.delete(tags).where(eq(tags.userId, TEST_USER));
});

describe("files/service categories", () => {
  test("createCategory succeeds, then rejects a duplicate name as CONFLICT", async () => {
    const first = await createCategory(TEST_USER, "Test Category A");
    expect(first.ok).toBe(true);

    const dup = await createCategory(TEST_USER, "Test Category A");
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe("CONFLICT");
  });

  test("updateCategory renames successfully when the new name is free", async () => {
    const cat = await createCategory(TEST_USER, "Test Cat Rename OK Before");
    expect(cat.ok).toBe(true);
    if (!cat.ok) return;

    const result = await updateCategory(cat.value.id, "Test Cat Rename OK After");
    expect(result.ok).toBe(true);

    const row = await getCategoryById(cat.value.id);
    expect(row?.name).toBe("Test Cat Rename OK After");
  });

  test("updateCategory rejects renaming to a name already in use", async () => {
    const a = await createCategory(TEST_USER, "Test Cat Rename A");
    const b = await createCategory(TEST_USER, "Test Cat Rename B");
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    const result = await updateCategory(b.value.id, "Test Cat Rename A");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CONFLICT");
  });

  test("removeCategory is blocked with CONFLICT while files reference it, then succeeds once empty", async () => {
    const cat = await createCategory(TEST_USER, "Test Cat Delete");
    expect(cat.ok).toBe(true);
    if (!cat.ok) return;

    const fileId = await insertFile({
      userId: TEST_USER,
      fileName: "dummy.txt",
      fileType: "document",
      mimeType: "text/plain",
      fileSize: 1,
      fileId: "dummy-fid",
      fileUniqueId: `dummy-fuid-${Date.now()}`,
      storageChatId: "-100",
      storageMessageId: 1,
      originalChatId: String(TEST_USER),
      originalMessageId: 1,
      categoryId: cat.value.id,
      caption: null,
      eventDate: null,
    });
    expect(fileId).not.toBeNull();

    const blocked = await removeCategory(cat.value.id);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe("CONFLICT");

    await db.delete(files).where(eq(files.id, fileId!));

    const ok = await removeCategory(cat.value.id);
    expect(ok.ok).toBe(true);
  });

  test("removeCategory returns NOT_FOUND for an unknown id", async () => {
    const result = await removeCategory("00000000-0000-0000-0000-000000000000");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });
});

describe("files/service tags", () => {
  test("createTag succeeds, then rejects a duplicate name as CONFLICT", async () => {
    const first = await createTag(TEST_USER, "testtag-a");
    expect(first.ok).toBe(true);

    const dup = await createTag(TEST_USER, "testtag-a");
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe("CONFLICT");
  });

  test("updateTag renames successfully when the new name is free", async () => {
    const tag = await createTag(TEST_USER, "testtag-rename-ok-before");
    expect(tag.ok).toBe(true);
    if (!tag.ok) return;

    const result = await updateTag(tag.value.id, TEST_USER, "testtag-rename-ok-after");
    expect(result.ok).toBe(true);

    const row = await getTagById(tag.value.id);
    expect(row?.name).toBe("testtag-rename-ok-after");
  });

  test("updateTag rejects renaming to a name already in use", async () => {
    const a = await createTag(TEST_USER, "testtag-rename-a");
    const b = await createTag(TEST_USER, "testtag-rename-b");
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    const result = await updateTag(b.value.id, TEST_USER, "testtag-rename-a");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CONFLICT");
  });

  test("removeTag succeeds for an existing tag", async () => {
    const tag = await createTag(TEST_USER, "testtag-delete");
    expect(tag.ok).toBe(true);
    if (!tag.ok) return;

    const result = await removeTag(tag.value.id, TEST_USER);
    expect(result.ok).toBe(true);
  });

  test("removeTag returns NOT_FOUND for a tag belonging to another user", async () => {
    const tag = await createTag(TEST_USER, "testtag-wronguser");
    expect(tag.ok).toBe(true);
    if (!tag.ok) return;

    const result = await removeTag(tag.value.id, TEST_USER + 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });
});
