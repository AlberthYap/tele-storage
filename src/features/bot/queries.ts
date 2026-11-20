import { eq } from "drizzle-orm";
import { db } from "../../shared/db";
import { seenUpdates } from "./schema";

export async function hasSeenUpdate(updateId: number): Promise<boolean> {
  const rows = await db.select().from(seenUpdates).where(eq(seenUpdates.updateId, updateId));
  return rows.length > 0;
}

export async function markUpdateSeen(updateId: number): Promise<void> {
  await db.insert(seenUpdates).values({ updateId }).onConflictDoNothing();
}
