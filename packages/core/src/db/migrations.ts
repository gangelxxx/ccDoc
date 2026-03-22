import type { Client } from "@libsql/client";

const APP_MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS projects (
        token TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        added_at DATETIME NOT NULL DEFAULT (datetime('now')),
        updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS _meta (
        schema_version INTEGER NOT NULL
      );

      INSERT INTO _meta (schema_version) VALUES (1);
    `,
  },
];

const PROJECT_MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS sections (
        id TEXT PRIMARY KEY,
        parent_id TEXT,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '{"type":"doc","content":[]}',
        type TEXT NOT NULL DEFAULT 'page',
        sort_key TEXT NOT NULL DEFAULT 'a0',
        icon TEXT,
        deleted_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT (datetime('now')),
        updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (parent_id) REFERENCES sections(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sections_parent ON sections(parent_id);
      CREATE INDEX IF NOT EXISTS idx_sections_deleted ON sections(deleted_at);

      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL DEFAULT '#3B82F6'
      );

      CREATE TABLE IF NOT EXISTS section_tags (
        section_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        PRIMARY KEY (section_id, tag_id),
        FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS export_hashes (
        file_path TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        exported_at DATETIME NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS _meta (
        schema_version INTEGER NOT NULL
      );

      INSERT INTO _meta (schema_version) VALUES (1);
    `,
  },
  {
    version: 2,
    sql: `
      UPDATE sections SET type = 'folder' WHERE type = 'group';
      UPDATE sections SET type = 'file' WHERE type = 'page';
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE IF NOT EXISTS sections_text (
        section_id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT ''
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS sections_fts USING fts5(
        title,
        body,
        content='sections_text',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );

      CREATE TRIGGER IF NOT EXISTS sections_text_ai AFTER INSERT ON sections_text BEGIN
        INSERT INTO sections_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
      END;

      CREATE TRIGGER IF NOT EXISTS sections_text_ad AFTER DELETE ON sections_text BEGIN
        INSERT INTO sections_fts(sections_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
      END;

      CREATE TRIGGER IF NOT EXISTS sections_text_au AFTER UPDATE ON sections_text BEGIN
        INSERT INTO sections_fts(sections_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
        INSERT INTO sections_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
      END;
    `,
  },
  {
    version: 4,
    sql: `
      -- Drop old triggers
      DROP TRIGGER IF EXISTS sections_text_ai;
      DROP TRIGGER IF EXISTS sections_text_ad;
      DROP TRIGGER IF EXISTS sections_text_au;

      -- Drop old FTS table
      DROP TABLE IF EXISTS sections_fts;

      -- Extend sections_text with breadcrumbs and tags
      ALTER TABLE sections_text ADD COLUMN breadcrumbs TEXT NOT NULL DEFAULT '';
      ALTER TABLE sections_text ADD COLUMN tags TEXT NOT NULL DEFAULT '';

      -- Recreate FTS with 4 columns
      CREATE VIRTUAL TABLE sections_fts USING fts5(
        title,
        tags,
        breadcrumbs,
        body,
        content='sections_text',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );

      -- New triggers syncing all 4 columns
      CREATE TRIGGER sections_text_ai AFTER INSERT ON sections_text BEGIN
        INSERT INTO sections_fts(rowid, title, tags, breadcrumbs, body)
        VALUES (new.rowid, new.title, new.tags, new.breadcrumbs, new.body);
      END;

      CREATE TRIGGER sections_text_ad AFTER DELETE ON sections_text BEGIN
        INSERT INTO sections_fts(sections_fts, rowid, title, tags, breadcrumbs, body)
        VALUES ('delete', old.rowid, old.title, old.tags, old.breadcrumbs, old.body);
      END;

      CREATE TRIGGER sections_text_au AFTER UPDATE ON sections_text BEGIN
        INSERT INTO sections_fts(sections_fts, rowid, title, tags, breadcrumbs, body)
        VALUES ('delete', old.rowid, old.title, old.tags, old.breadcrumbs, old.body);
        INSERT INTO sections_fts(rowid, title, tags, breadcrumbs, body)
        VALUES (new.rowid, new.title, new.tags, new.breadcrumbs, new.body);
      END;

      -- Project passport table
      CREATE TABLE IF NOT EXISTS project_passport (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME NOT NULL DEFAULT (datetime('now'))
      );

      -- Embeddings placeholder (for future use)
      CREATE TABLE IF NOT EXISTS section_embeddings (
        section_id TEXT PRIMARY KEY,
        embedding BLOB,
        text_hash TEXT,
        updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE
      );
    `,
  },
  {
    version: 5,
    sql: `
      ALTER TABLE sections ADD COLUMN summary TEXT DEFAULT NULL;
    `,
  },
  {
    version: 6,
    sql: `
      UPDATE sections SET type = 'drawing' WHERE type = 'excalidraw';
    `,
  },
];

async function getSchemaVersion(db: Client): Promise<number> {
  try {
    const result = await db.execute("SELECT schema_version FROM _meta LIMIT 1");
    if (result.rows.length > 0) {
      return result.rows[0].schema_version as number;
    }
  } catch {
    // Expected for fresh databases — _meta table doesn't exist yet
  }
  return 0;
}

async function runMigrations(db: Client, migrations: typeof APP_MIGRATIONS): Promise<void> {
  const current = await getSchemaVersion(db);
  for (const migration of migrations) {
    if (migration.version > current) {
      // Wrap migration + version update in a single transaction
      const wrappedSql = `BEGIN;\n${migration.sql}\nUPDATE _meta SET schema_version = ${migration.version};\nCOMMIT;`;
      try {
        await db.executeMultiple(wrappedSql);
      } catch (err) {
        // Attempt rollback in case of partial transaction
        try { await db.executeMultiple("ROLLBACK;"); } catch { /* already rolled back */ }
        throw err;
      }
    }
  }
}

export async function migrateAppDb(db: Client): Promise<void> {
  await runMigrations(db, APP_MIGRATIONS);
}

export async function migrateProjectDb(db: Client): Promise<void> {
  await runMigrations(db, PROJECT_MIGRATIONS);
}
