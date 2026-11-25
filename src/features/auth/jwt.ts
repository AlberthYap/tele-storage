import { SignJWT, jwtVerify } from "jose";

export type TokenType = "access" | "refresh";

const secretKey = () => new TextEncoder().encode(process.env.JWT_SECRET!);

export async function signToken(
  userId: number,
  type: TokenType,
  expiresIn: string,
  jti?: string,
): Promise<string> {
  let jwt = new SignJWT({ sub: String(userId), type })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn);
  if (jti) jwt = jwt.setJti(jti);
  return jwt.sign(secretKey());
}

export async function verifyToken(
  token: string,
  expectedType: TokenType,
): Promise<{ userId: number; jti: string | undefined }> {
  const { payload } = await jwtVerify(token, secretKey());
  if (payload.type !== expectedType) throw new Error("unexpected token type");
  return { userId: Number(payload.sub), jti: payload.jti };
}
