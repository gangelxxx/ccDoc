import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import { migrateProjectDb } from "../../db/migrations.js";

export async function createTestDb(): Promise<Client> {
  const db = createClient({ url: ":memory:" });
  await migrateProjectDb(db);
  return db;
}

export async function insertSection(
  db: Client,
  id: string,
  title: string,
  content = '{"type":"doc","content":[]}'
): Promise<void> {
  await db.execute({
    sql: "INSERT INTO sections (id, title, content, type, sort_key) VALUES (?, ?, ?, 'file', 'a0')",
    args: [id, title, content],
  });
}
