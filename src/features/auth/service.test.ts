import { describe, test, expect, beforeAll, beforeEach, afterEach } from "bun:test";
import { issueLoginCode, login, refresh, logout, verifyAccessToken } from "./service";
import { cleanupAuthKeysForUser, cleanupLoginAttemptCounter } from "./test-helpers";

const TEST_USER = 900000002;

beforeAll(() => {
  process.env.JWT_SECRET ??= "test-secret-for-auth-service-tests";
});

// login() shares a global (non-per-user) rate-limit counter with session.test.ts's own test of
// that limiter — clear it so this file's logins aren't flaky depending on run order/timing.
beforeEach(cleanupLoginAttemptCounter);

afterEach(() => cleanupAuthKeysForUser(TEST_USER));

async function getCode(): Promise<string> {
  const result = await issueLoginCode(TEST_USER);
  if (!("code" in result)) throw new Error("expected a code, got cooldown");
  return result.code;
}

describe("auth/service login → refresh → logout", () => {
  test("login with a valid code issues a usable token pair", async () => {
    const code = await getCode();
    const tokens = await login(code);
    expect(tokens).not.toBeNull();
    expect(tokens).not.toBe("RATE_LIMITED");
    if (tokens && tokens !== "RATE_LIMITED") {
      const userId = await verifyAccessToken(tokens.accessToken);
      expect(userId).toBe(TEST_USER);
    }
  });

  test("login with an invalid code returns null", async () => {
    const result = await login("999999");
    expect(result).toBeNull();
  });

  test("refresh rotates tokens and invalidates the old refresh token", async () => {
    const code = await getCode();
    const first = await login(code);
    if (!first || first === "RATE_LIMITED") throw new Error("login failed");

    const second = await refresh(first.refreshToken);
    expect(second).not.toBeNull();

    // old refresh token is single-use — reusing it must fail
    const reuse = await refresh(first.refreshToken);
    expect(reuse).toBeNull();
  });

  test("logout revokes the refresh token so it can no longer be refreshed", async () => {
    const code = await getCode();
    const tokens = await login(code);
    if (!tokens || tokens === "RATE_LIMITED") throw new Error("login failed");

    await logout(tokens.refreshToken);
    expect(await refresh(tokens.refreshToken)).toBeNull();
  });

  test("verifyAccessToken rejects a refresh token presented as an access token", async () => {
    const code = await getCode();
    const tokens = await login(code);
    if (!tokens || tokens === "RATE_LIMITED") throw new Error("login failed");

    expect(await verifyAccessToken(tokens.refreshToken)).toBeNull();
  });

  test("verifyAccessToken rejects garbage input", async () => {
    expect(await verifyAccessToken("not-a-real-token")).toBeNull();
  });
});
