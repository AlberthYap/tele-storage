import { redis } from "../../lib/redis";

// login_code/refresh jti keys don't embed the userId in the key name (only in the value),
// so cleanup has to check values rather than just pattern-matching key names.
export async function cleanupAuthKeysForUser(userId: number): Promise<void> {
  const codeKeys = await redis.keys("auth:login_code:*");
  const refreshKeys = await redis.keys("auth:refresh:*");
  const valueMatched: string[] = [];
  for (const key of [...codeKeys, ...refreshKeys]) {
    const val = await redis.get(key);
    if (val === String(userId)) valueMatched.push(key);
  }
  const direct = await redis.keys(`auth:*${userId}*`); // login_code_by_user, cooldown
  const all = [...new Set([...valueMatched, ...direct])];
  if (all.length > 0) await redis.del(...all);
}

export async function cleanupLoginAttemptCounter(): Promise<void> {
  const keys = await redis.keys("auth:login_attempts:*");
  if (keys.length > 0) await redis.del(...keys);
}
