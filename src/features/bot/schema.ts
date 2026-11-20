import { pgTable, bigint, timestamp } from "drizzle-orm/pg-core";

export const seenUpdates = pgTable("seen_updates", {
  updateId: bigint("update_id", { mode: "number" }).primaryKey(),
  at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
});
