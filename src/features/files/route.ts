import { Elysia, t } from "elysia";
import { verifyAccessToken } from "../auth";
import {
  listFiles,
  getFileDetail,
  resendFile,
  setFavorite,
  removeFile,
  listCategoriesWithCount,
  createCategory,
  updateCategory,
  removeCategory,
  listTagsWithCount,
  createTag,
  updateTag,
  removeTag,
  listRecent,
  listFavorites,
  getStatistics,
} from "./service";
import type { ServiceError, ServiceResult } from "./types";

const auth = (app: Elysia) =>
  app
    .derive(async ({ request }) => {
      const header = request.headers.get("authorization");
      const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
      const userId = token ? await verifyAccessToken(token) : null;
      return { userId };
    })
    .onBeforeHandle(({ userId, set }) => {
      if (!userId) {
        set.status = 401;
        return { code: "UNAUTHORIZED", message: "missing or invalid access token" };
      }
    });

function unwrap<T>(r: ServiceResult<T>, set: { status?: number | string }): T | ServiceError {
  if (r.ok) return r.value;
  set.status =
    r.error.code === "NOT_FOUND" ? 404 : r.error.code === "CONFLICT" ? 409 : r.error.code === "TELEGRAM_ERROR" ? 502 : 500;
  return r.error;
}

export const filesRoute = new Elysia()
  .use(auth)

  // ── Files ────────────────────────────────────────────────────────────────
  .get(
    "/files",
    async ({ query, userId }) => {
      const tagIds = query.tagIds ? query.tagIds.split(",") : undefined;
      return listFiles({
        userId: userId!,
        q: query.q,
        categoryId: query.categoryId,
        tagIds,
        fileType: query.fileType,
        eventDateFrom: query.eventDateFrom,
        eventDateTo: query.eventDateTo,
        uploadDateFrom: query.uploadDateFrom,
        uploadDateTo: query.uploadDateTo,
        limit: Math.min(Number(query.limit ?? 20), 100),
        offset: Number(query.offset ?? 0),
      });
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
        categoryId: t.Optional(t.String()),
        tagIds: t.Optional(t.String()), // comma-separated UUIDs
        fileType: t.Optional(t.String()),
        eventDateFrom: t.Optional(t.String()),
        eventDateTo: t.Optional(t.String()),
        uploadDateFrom: t.Optional(t.String()),
        uploadDateTo: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
    },
  )

  .get(
    "/files/recent",
    async ({ query, userId }) => listRecent(userId!, Math.min(Number(query.limit ?? 20), 100)),
    { query: t.Object({ limit: t.Optional(t.String()) }) },
  )

  .get("/files/favorites", async ({ userId }) => listFavorites(userId!))

  .get("/files/:id", async ({ params, set }) => unwrap(await getFileDetail(params.id), set), {
    params: t.Object({ id: t.String() }),
  })

  .post(
    "/files/:id/resend",
    async ({ params, userId, set }) => unwrap(await resendFile(params.id, userId!), set),
    { params: t.Object({ id: t.String() }) },
  )

  .patch(
    "/files/:id/favorite",
    async ({ params, body, set }) => unwrap(await setFavorite(params.id, body.isFavorite), set),
    { params: t.Object({ id: t.String() }), body: t.Object({ isFavorite: t.Boolean() }) },
  )

  .delete(
    "/files/:id",
    async ({ params, set }) => {
      const r = await removeFile(params.id);
      const value = unwrap(r, set);
      if (!r.ok) return value;
      set.status = 204;
      return null;
    },
    { params: t.Object({ id: t.String() }) },
  )

  // ── Categories ───────────────────────────────────────────────────────────
  .get("/categories", async ({ userId }) => listCategoriesWithCount(userId!))

  .post(
    "/categories",
    async ({ body, userId, set }) => unwrap(await createCategory(userId!, body.name), set),
    { body: t.Object({ name: t.String() }) },
  )

  .patch(
    "/categories/:id",
    async ({ params, body, set }) => unwrap(await updateCategory(params.id, body.name), set),
    { params: t.Object({ id: t.String() }), body: t.Object({ name: t.String() }) },
  )

  .delete(
    "/categories/:id",
    async ({ params, set }) => {
      const r = await removeCategory(params.id);
      const value = unwrap(r, set);
      if (!r.ok) return value;
      set.status = 204;
      return null;
    },
    { params: t.Object({ id: t.String() }) },
  )

  // ── Tags ─────────────────────────────────────────────────────────────────
  .get("/tags", async ({ userId }) => listTagsWithCount(userId!))

  .post(
    "/tags",
    async ({ body, userId, set }) => unwrap(await createTag(userId!, body.name), set),
    { body: t.Object({ name: t.String() }) },
  )

  .patch(
    "/tags/:id",
    async ({ params, body, userId, set }) => unwrap(await updateTag(params.id, userId!, body.name), set),
    { params: t.Object({ id: t.String() }), body: t.Object({ name: t.String() }) },
  )

  .delete(
    "/tags/:id",
    async ({ params, userId, set }) => {
      const r = await removeTag(params.id, userId!);
      const value = unwrap(r, set);
      if (!r.ok) return value;
      set.status = 204;
      return null;
    },
    { params: t.Object({ id: t.String() }) },
  )

  // ── Stats ────────────────────────────────────────────────────────────────
  .get("/stats", async ({ userId }) => getStatistics(userId!));
