import { describe, test, expect, afterEach } from "bun:test";
import { redis } from "../../lib/redis";
import {
  createLoginCode,
  consumeLoginCode,
  registerLoginAttempt,
  trackRefreshJti,
  consumeRefreshJti,
  revokeRefreshJti,
} from "./session";
import { cleanupAuthKeysForUser, cleanupLoginAttemptCounter } from "./test-helpers";

// Clearly-fake userId range so these tests never collide with real authorized users.
const TEST_USER = 900000001;

async function cleanupTestKeys() {
  await cleanupAuthKeysForUser(TEST_USER);
  await cleanupLoginAttemptCounter();
  const extra = await redis.keys("auth:refresh:test-jti*");
  if (extra.length > 0) await redis.del(...extra);
}

afterEach(cleanupTestKeys);

describe("auth/session login codes", () => {
  test("issues a code that can be consumed exactly once", async () => {
    const result = await createLoginCode(TEST_USER);
    expect("code" in result).toBe(true);
    const code = (result as { code: string }).code;

    const userId = await consumeLoginCode(code);
    expect(userId).toBe(TEST_USER);

    const second = await consumeLoginCode(code);
    expect(second).toBeNull();
  });

  test("returns null for an unknown code", async () => {
    expect(await consumeLoginCode("000000")).toBeNull();
  });

  test("enforces a cooldown between issuing codes for the same user", async () => {
    const first = await createLoginCode(TEST_USER);
    expect("code" in first).toBe(true);

    const second = await createLoginCode(TEST_USER);
    expect("cooldownSeconds" in second).toBe(true);
    if ("cooldownSeconds" in second) {
      expect(second.cooldownSeconds).toBeGreaterThan(0);
      expect(second.cooldownSeconds).toBeLessThanOrEqual(30);
    }
  });

  test("a newly issued code invalidates the previous one", async () => {
    const first = await createLoginCode(TEST_USER);
    expect("code" in first).toBe(true);
    const oldCode = (first as { code: string }).code;

    // simulate the cooldown having elapsed
    await redis.del(`auth:login_cooldown:${TEST_USER}`);

    const second = await createLoginCode(TEST_USER);
    expect("code" in second).toBe(true);
    const newCode = (second as { code: string }).code;

    expect(await consumeLoginCode(oldCode)).toBeNull();
    expect(await consumeLoginCode(newCode)).toBe(TEST_USER);
  });
});

describe("auth/session refresh jti tracking", () => {
  const jti = `test-jti-${Date.now()}`;

  test("a tracked jti can be consumed exactly once", async () => {
    await trackRefreshJti(jti, TEST_USER);
    expect(await consumeRefreshJti(jti)).toBe(TEST_USER);
    expect(await consumeRefreshJti(jti)).toBeNull();
  });

  test("revoking a jti makes it unusable", async () => {
    const jti2 = `test-jti-revoke-${Date.now()}`;
    await trackRefreshJti(jti2, TEST_USER);
    await revokeRefreshJti(jti2);
    expect(await consumeRefreshJti(jti2)).toBeNull();
  });
});

describe("auth/session login attempt rate limit", () => {
  test("blocks after the per-window attempt limit is exceeded", async () => {
    await cleanupTestKeys(); // ensure a clean rate-limit window before counting
    const results: boolean[] = [];
    for (let i = 0; i < 12; i++) {
      results.push(await registerLoginAttempt());
    }
    // first 10 allowed, rest blocked within the same 60s window
    expect(results.slice(0, 10).every(Boolean)).toBe(true);
    expect(results.slice(10).every((ok) => !ok)).toBe(true);
  });
});
