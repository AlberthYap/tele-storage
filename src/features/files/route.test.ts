import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app";
import { db } from "../../shared/db";
import { files, categories, tags } from "./schema";
import { insertFile } from "./queries";
import { issueLoginCode, login } from "../auth/service";
import { cleanupAuthKeysForUser } from "../auth/test-helpers";

// Clearly-fake userId so these tests never touch real catalog data.
const TEST_USER = 900000005;

// Issuing a login code is rate-limited per user (see auth/session.ts), so this file logs in
// once and reuses the access token across tests instead of calling getAccessToken() per test.
let accessToken: string;

beforeAll(async () => {
  const codeResult = await issueLoginCode(TEST_USER);
  if (!("code" in codeResult)) throw new Error("expected a code, got cooldown");
  const tokens = await login(codeResult.code);
  if (!tokens || tokens === "RATE_LIMITED") throw new Error("login failed");
  accessToken = tokens.accessToken;
});

afterAll(() => cleanupAuthKeysForUser(TEST_USER));

function authedReq(method: string, path: string, token: string, body?: unknown) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );
}

afterEach(async () => {
  await db.delete(files).where(eq(files.userId, TEST_USER));
  await db.delete(categories).where(eq(categories.userId, TEST_USER));
  await db.delete(tags).where(eq(tags.userId, TEST_USER));
});

describe("files HTTP routes — auth guard", () => {
  test("401s without a token", async () => {
    const res = await app.handle(new Request("http://localhost/files"));
    expect(res.status).toBe(401);
  });

  test("401s with a garbage token", async () => {
    const res = await authedReq("GET", "/files", "garbage-token");
    expect(res.status).toBe(401);
  });
});

describe("categories HTTP routes", () => {
  test("create, list, rename, delete round-trip through real HTTP", async () => {
    const token = accessToken;

    const create = await authedReq("POST", "/categories", token, { name: "HTTP Test Cat" });
    expect(create.status).toBe(200);
    const { id } = (await create.json()) as { id: string };

    const dup = await authedReq("POST", "/categories", token, { name: "HTTP Test Cat" });
    expect(dup.status).toBe(409);

    const list = await authedReq("GET", "/categories", token);
    const items = (await list.json()) as { id: string; name: string; fileCount: number }[];
    const found = items.find((c) => c.id === id);
    expect(found).toBeDefined();
    expect(found?.fileCount).toBe(0);

    const rename = await authedReq("PATCH", `/categories/${id}`, token, {
      name: "HTTP Test Cat Renamed",
    });
    expect(rename.status).toBe(200);

    const del = await authedReq("DELETE", `/categories/${id}`, token);
    expect(del.status).toBe(204);
  });

  test("blocks delete with 409 while a file references the category", async () => {
    const token = accessToken;
    const create = await authedReq("POST", "/categories", token, { name: "HTTP Test Cat Blocked" });
    const { id } = (await create.json()) as { id: string };

    await insertFile({
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
      categoryId: id,
      caption: null,
      eventDate: null,
    });

    const del = await authedReq("DELETE", `/categories/${id}`, token);
    expect(del.status).toBe(409);
  });
});

describe("stats HTTP route", () => {
  test("returns the expected shape", async () => {
    const token = accessToken;
    const res = await authedReq("GET", "/stats", token);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      totalFiles: number;
      totalCategories: number;
      totalTags: number;
    };
    expect(typeof json.totalFiles).toBe("number");
    expect(typeof json.totalCategories).toBe("number");
    expect(typeof json.totalTags).toBe("number");
  });
});

describe("CORS", () => {
  test("allows the configured origin and rejects others on preflight", async () => {
    const allowedOrigin = (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(",")[0]!.trim();

    const allowed = await app.handle(
      new Request("http://localhost/stats", {
        method: "OPTIONS",
        headers: { Origin: allowedOrigin, "Access-Control-Request-Method": "GET" },
      }),
    );
    expect(allowed.headers.get("access-control-allow-origin")).toBe(allowedOrigin);

    const disallowed = await app.handle(
      new Request("http://localhost/stats", {
        method: "OPTIONS",
        headers: { Origin: "http://evil.example.com", "Access-Control-Request-Method": "GET" },
      }),
    );
    expect(disallowed.headers.get("access-control-allow-origin")).toBeNull();
  });
});
