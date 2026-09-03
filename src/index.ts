import { Elysia } from "elysia";

const app = new Elysia()
.get("/", () => "Hello Elysia")
.get("/healthz", () => ({ok: true, ts:Date.now()}))
.listen(3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
