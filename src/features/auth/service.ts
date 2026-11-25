import {
  createLoginCode,
  consumeLoginCode,
  registerLoginAttempt,
  trackRefreshJti,
  consumeRefreshJti,
  revokeRefreshJti,
  type CreateLoginCodeResult,
} from "./session";
import { signToken, verifyToken } from "./jwt";

const ACCESS_TTL = "15m";
const REFRESH_TTL = "30d";

export type TokenPair = { accessToken: string; refreshToken: string };

export async function issueLoginCode(userId: number): Promise<CreateLoginCodeResult> {
  return createLoginCode(userId);
}

async function issueTokenPair(userId: number): Promise<TokenPair> {
  const jti = crypto.randomUUID();
  const [accessToken, refreshToken] = await Promise.all([
    signToken(userId, "access", ACCESS_TTL),
    signToken(userId, "refresh", REFRESH_TTL, jti),
  ]);
  await trackRefreshJti(jti, userId);
  return { accessToken, refreshToken };
}

export async function login(code: string): Promise<TokenPair | "RATE_LIMITED" | null> {
  const allowed = await registerLoginAttempt();
  if (!allowed) return "RATE_LIMITED";
  const userId = await consumeLoginCode(code);
  if (!userId) return null;
  return issueTokenPair(userId);
}

// Rotation: the presented refresh token is consumed (single-use) and a fresh pair is issued.
export async function refresh(refreshToken: string): Promise<TokenPair | null> {
  let payload: { userId: number; jti: string | undefined };
  try {
    payload = await verifyToken(refreshToken, "refresh");
  } catch {
    return null;
  }
  if (!payload.jti) return null;
  const userId = await consumeRefreshJti(payload.jti);
  if (!userId) return null; // already used or revoked
  return issueTokenPair(userId);
}

export async function logout(refreshToken: string): Promise<void> {
  try {
    const { jti } = await verifyToken(refreshToken, "refresh");
    if (jti) await revokeRefreshJti(jti);
  } catch {
    // already invalid/expired — nothing to revoke
  }
}

export async function verifyAccessToken(token: string): Promise<number | null> {
  try {
    const { userId } = await verifyToken(token, "access");
    return userId;
  } catch {
    return null;
  }
}
