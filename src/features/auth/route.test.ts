import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { app } from "../../app";
import { issueLoginCode } from "./service";
import { cleanupAuthKeysForUser, cleanupLoginAttemptCounter } from "./test-helpers";

// Clearly-fake userId so these tests never collide with real authorized users.
const TEST_USER = 900000004;

function req(path: string, body: unknown) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function getCode(): Promise<string> {
  const result = await issueLoginCode(TEST_USER);
  if (!("code" in result)) throw new Error("expected a code, got cooldown");
  return result.code;
}

beforeEach(cleanupLoginAttemptCounter);
afterEach(() => cleanupAuthKeysForUser(TEST_USER));

describe("POST /auth/login", () => {
  test("401s on an invalid code", async () => {
    const res = await req("/auth/login", { code: "000000" });
    expect(res.status).toBe(401);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("INVALID_CODE");
  });

  test("200s with a token pair on a valid code, and the code becomes unusable", async () => {
    const code = await getCode();
    const res = await req("/auth/login", { code });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { accessToken: string; refreshToken: string };
    expect(typeof json.accessToken).toBe("string");
    expect(typeof json.refreshToken).toBe("string");

    const second = await req("/auth/login", { code });
    expect(second.status).toBe(401);
  });

  test("429s after exceeding the attempt rate limit", async () => {
    let last: Response | undefined;
    for (let i = 0; i < 11; i++) {
      last = await req("/auth/login", { code: "000000" });
    }
    expect(last!.status).toBe(429);
    const json = (await last!.json()) as { code: string };
    expect(json.code).toBe("RATE_LIMITED");
  });
});

describe("POST /auth/refresh", () => {
  test("rotates the token pair and invalidates the old refresh token", async () => {
    const code = await getCode();
    const loginRes = await req("/auth/login", { code });
    const { refreshToken } = (await loginRes.json()) as { refreshToken: string };

    const refreshRes = await req("/auth/refresh", { refreshToken });
    expect(refreshRes.status).toBe(200);
    const refreshed = (await refreshRes.json()) as { accessToken: string; refreshToken: string };
    expect(refreshed.refreshToken).not.toBe(refreshToken);

    const reuse = await req("/auth/refresh", { refreshToken });
    expect(reuse.status).toBe(401);
  });

  test("401s on a garbage refresh token", async () => {
    const res = await req("/auth/refresh", { refreshToken: "not-a-real-token" });
    expect(res.status).toBe(401);
  });
});

describe("POST /auth/logout", () => {
  test("revokes the refresh token so a later refresh fails", async () => {
    const code = await getCode();
    const loginRes = await req("/auth/login", { code });
    const { refreshToken } = (await loginRes.json()) as { refreshToken: string };

    const logoutRes = await req("/auth/logout", { refreshToken });
    expect(logoutRes.status).toBe(200);

    const refreshRes = await req("/auth/refresh", { refreshToken });
    expect(refreshRes.status).toBe(401);
  });
});
