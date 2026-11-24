import { redis } from "../../lib/redis";

const LOGIN_CODE_TTL = 5 * 60; // 5 minutes
const LOGIN_COOLDOWN = 30; // seconds between new codes, per user
const REFRESH_TTL = 30 * 24 * 60 * 60; // 30 days
const LOGIN_ATTEMPT_WINDOW = 60; // seconds
const LOGIN_ATTEMPT_MAX = 10; // attempts allowed per window

const K = {
  loginCode: (code: string) => `auth:login_code:${code}`,
  loginCodeByUser: (userId: number) => `auth:login_code_by_user:${userId}`,
  loginCooldown: (userId: number) => `auth:login_cooldown:${userId}`,
  loginAttempts: (bucket: number) => `auth:login_attempts:${bucket}`,
  refreshJti: (jti: string) => `auth:refresh:${jti}`,
};

function genCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export type CreateLoginCodeResult = { code: string } | { cooldownSeconds: number };

// One-time 6-digit code, typed into the web login form.
// Rate-limited per user (one new code per LOGIN_COOLDOWN seconds) so spamming /login can't
// flood the chat with Telegram messages, and issuing a new code invalidates the previous one
// so at most one code is ever valid at a time.
export async function createLoginCode(userId: number): Promise<CreateLoginCodeResult> {
  const cooldownKey = K.loginCooldown(userId);
  const remaining = await redis.ttl(cooldownKey);
  if (remaining > 0) return { cooldownSeconds: remaining };

  const prevCode = await redis.get(K.loginCodeByUser(userId));
  if (prevCode) await redis.del(K.loginCode(prevCode));

  for (let i = 0; i < 5; i++) {
    const code = genCode();
    const ok = await redis.set(K.loginCode(code), String(userId), "EX", LOGIN_CODE_TTL, "NX");
    if (ok) {
      await redis.set(K.loginCodeByUser(userId), code, "EX", LOGIN_CODE_TTL);
      await redis.set(cooldownKey, "1", "EX", LOGIN_COOLDOWN);
      return { code };
    }
  }
  throw new Error("failed to generate a unique login code");
}

// Fixed-window rate limit on POST /auth/login attempts, independent of the per-user cooldown
// above — this guards against brute-forcing the 6-digit code itself via direct HTTP requests.
// Global (not per-IP): the system is single-tenant, so a flood of guesses from any source matters.
export async function registerLoginAttempt(): Promise<boolean> {
  const bucket = Math.floor(Date.now() / 1000 / LOGIN_ATTEMPT_WINDOW);
  const key = K.loginAttempts(bucket);
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, LOGIN_ATTEMPT_WINDOW);
  return count <= LOGIN_ATTEMPT_MAX;
}

// Reads + deletes atomically-enough for single-user traffic: code is single-use.
export async function consumeLoginCode(code: string): Promise<number | null> {
  const key = K.loginCode(code);
  const userId = await redis.get(key);
  if (!userId) return null;
  await redis.del(key, K.loginCodeByUser(Number(userId)));
  return Number(userId);
}

// Tracks issued refresh tokens by jti so they can be revoked/rotated server-side.
export async function trackRefreshJti(jti: string, userId: number): Promise<void> {
  await redis.set(K.refreshJti(jti), String(userId), "EX", REFRESH_TTL);
}

// Consumes (deletes) a refresh jti — used for rotation: a refresh token is single-use.
export async function consumeRefreshJti(jti: string): Promise<number | null> {
  const key = K.refreshJti(jti);
  const userId = await redis.get(key);
  if (!userId) return null;
  await redis.del(key);
  return Number(userId);
}

export async function revokeRefreshJti(jti: string): Promise<void> {
  await redis.del(K.refreshJti(jti));
}
