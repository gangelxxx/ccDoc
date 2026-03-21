import type { Client } from "@libsql/client";

export interface EmbeddingRow {
  section_id: string;
  embedding: Float32Array;
  text_hash: string;
}

export class EmbeddingRepo {
  constructor(private db: Client) {}

  async upsert(sectionId: string, embedding: Float32Array, textHash: string): Promise<void> {
    const buffer = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
    await this.db.execute({
      sql: `INSERT INTO section_embeddings (section_id, embedding, text_hash, updated_at)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(section_id) DO UPDATE SET
              embedding = excluded.embedding,
              text_hash = excluded.text_hash,
              updated_at = excluded.updated_at`,
      args: [sectionId, buffer, textHash],
    });
  }

  async getTextHash(sectionId: string): Promise<string | null> {
    const result = await this.db.execute({
      sql: "SELECT text_hash FROM section_embeddings WHERE section_id = ?",
      args: [sectionId],
    });
    return (result.rows[0]?.text_hash as string) ?? null;
  }

  async getAll(): Promise<EmbeddingRow[]> {
    const result = await this.db.execute(
      `SELECT se.section_id, se.embedding, se.text_hash
       FROM section_embeddings se
       JOIN sections s ON s.id = se.section_id
       WHERE s.deleted_at IS NULL AND se.embedding IS NOT NULL`
    );
    return result.rows.map((row) => ({
      section_id: row.section_id as string,
      embedding: bufferToFloat32(row.embedding as ArrayBuffer),
      text_hash: row.text_hash as string,
    }));
  }

  async delete(sectionId: string): Promise<void> {
    await this.db.execute({
      sql: "DELETE FROM section_embeddings WHERE section_id = ?",
      args: [sectionId],
    });
  }

  async deleteAll(): Promise<void> {
    await this.db.execute("DELETE FROM section_embeddings");
  }

  async count(): Promise<number> {
    const result = await this.db.execute(
      "SELECT COUNT(*) as n FROM section_embeddings WHERE embedding IS NOT NULL"
    );
    return (result.rows[0]?.n as number) ?? 0;
  }
}

function bufferToFloat32(buf: ArrayBuffer | Buffer): Float32Array {
  if (Buffer.isBuffer(buf)) {
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  }
  return new Float32Array(buf);
}
