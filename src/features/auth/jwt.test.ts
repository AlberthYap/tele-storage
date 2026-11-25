import { describe, test, expect, beforeAll } from "bun:test";
import { signToken, verifyToken } from "./jwt";

beforeAll(() => {
  process.env.JWT_SECRET ??= "test-secret-for-jwt-unit-tests";
});

describe("auth/jwt", () => {
  test("signs and verifies an access token round-trip", async () => {
    const token = await signToken(42, "access", "15m");
    const { userId, jti } = await verifyToken(token, "access");
    expect(userId).toBe(42);
    expect(jti).toBeUndefined();
  });

  test("signs and verifies a refresh token with jti", async () => {
    const token = await signToken(42, "refresh", "30d", "some-jti");
    const { userId, jti } = await verifyToken(token, "refresh");
    expect(userId).toBe(42);
    expect(jti).toBe("some-jti");
  });

  test("rejects a token verified against the wrong type", async () => {
    const token = await signToken(42, "access", "15m");
    await expect(verifyToken(token, "refresh")).rejects.toThrow();
  });

  test("rejects an expired token", async () => {
    const token = await signToken(42, "access", "-1s"); // already expired
    await expect(verifyToken(token, "access")).rejects.toThrow();
  });

  test("rejects a tampered token", async () => {
    const token = await signToken(42, "access", "15m");
    // Corrupt the middle of the signature segment — flipping the trailing base64url
    // character can occasionally leave the decoded bytes unchanged (boundary bit padding),
    // which would make this test flaky.
    const [header, payload, signature] = token.split(".");
    const mid = Math.floor(signature!.length / 2);
    const ch = signature![mid];
    const replacement = ch === "A" ? "B" : "A";
    const tamperedSignature = signature!.slice(0, mid) + replacement + signature!.slice(mid + 1);
    const tampered = `${header}.${payload}.${tamperedSignature}`;
    await expect(verifyToken(tampered, "access")).rejects.toThrow();
  });
});
