import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { migrateAppDb } from "../../db/migrations.js";

export async function createTestAppDb(): Promise<Client> {
  const db = createClient({ url: ":memory:" });
  await migrateAppDb(db);
  return db;
}
