import type { Client } from "@libsql/client";

export interface SemanticCacheRow {
  id: string;
  kind: string;
  embedding: Float32Array;
  text_hash: string;
  metadata: string;
  content: string;
}

const UPSERT_BATCH_SIZE = 50;
const DELETE_BATCH_SIZE = 100;

export class SemanticCacheRepo {
  constructor(private db: Client) {}

  async getAll(): Promise<SemanticCacheRow[]> {
    const result = await this.db.execute(
      "SELECT id, kind, embedding, text_hash, metadata, content FROM semantic_chunks"
    );
    return result.rows.map((row) => ({
      id: row.id as string,
      kind: row.kind as string,
      embedding: bufferToFloat32(row.embedding as ArrayBuffer),
      text_hash: row.text_hash as string,
      metadata: (row.metadata as string) ?? "{}",
      content: (row.content as string) ?? "",
    }));
  }

  async upsertBatch(
    rows: Array<{
      id: string;
      kind: string;
      embedding: Float32Array;
      textHash: string;
      metadata: string;
      content: string;
    }>
  ): Promise<void> {
    for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
      const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
      const statements = batch.map((row) => ({
        sql: `INSERT INTO semantic_chunks (id, kind, embedding, text_hash, metadata, content, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
              ON CONFLICT(id) DO UPDATE SET
                kind = excluded.kind,
                embedding = excluded.embedding,
                text_hash = excluded.text_hash,
                metadata = excluded.metadata,
                content = excluded.content,
                updated_at = excluded.updated_at`,
        args: [
          row.id,
          row.kind,
          Buffer.from(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength),
          row.textHash,
          row.metadata,
          row.content,
        ],
      }));
      await this.db.batch(statements);
    }
  }

  async deleteBatch(ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i += DELETE_BATCH_SIZE) {
      const batch = ids.slice(i, i + DELETE_BATCH_SIZE);
      const placeholders = batch.map(() => "?").join(", ");
      await this.db.execute({
        sql: `DELETE FROM semantic_chunks WHERE id IN (${placeholders})`,
        args: batch,
      });
    }
  }

  async deleteAll(): Promise<void> {
    await this.db.execute("DELETE FROM semantic_chunks");
  }

  async count(): Promise<number> {
    const result = await this.db.execute("SELECT COUNT(*) as n FROM semantic_chunks");
    return (result.rows[0]?.n as number) ?? 0;
  }
}

function bufferToFloat32(buf: ArrayBuffer | Buffer): Float32Array {
  if (Buffer.isBuffer(buf)) {
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  }
  return new Float32Array(buf);
}
