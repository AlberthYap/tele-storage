import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: [
    "./src/features/files/schema.ts",
    "./src/features/bot/schema.ts",
  ],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
