import { Elysia, t } from "elysia";
import { login, refresh, logout } from "./service";

export const authRoute = new Elysia({ prefix: "/auth" })
  .post(
    "/login",
    async ({ body, set }) => {
      const result = await login(body.code);
      if (result === "RATE_LIMITED") {
        set.status = 429;
        return { code: "RATE_LIMITED", message: "terlalu banyak percobaan, coba lagi sebentar lagi" };
      }
      if (!result) {
        set.status = 401;
        return { code: "INVALID_CODE", message: "kode login salah atau sudah kadaluarsa" };
      }
      return result;
    },
    { body: t.Object({ code: t.String() }) },
  )

  .post(
    "/refresh",
    async ({ body, set }) => {
      const tokens = await refresh(body.refreshToken);
      if (!tokens) {
        set.status = 401;
        return { code: "INVALID_TOKEN", message: "refresh token tidak valid atau sudah dipakai" };
      }
      return tokens;
    },
    { body: t.Object({ refreshToken: t.String() }) },
  )

  .post(
    "/logout",
    async ({ body }) => {
      await logout(body.refreshToken);
      return { ok: true };
    },
    { body: t.Object({ refreshToken: t.String() }) },
  );
