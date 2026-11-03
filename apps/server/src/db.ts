import { DatabaseSync } from "node:sqlite";
import { getLoadablePath } from "sqlite-vec";

/** Schema changes in order. Never edit a shipped migration; append a new one. */
const MIGRATIONS: string[] = [
  `CREATE TABLE meta (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   ) STRICT;
   CREATE TABLE orgs (
     id TEXT PRIMARY KEY,
     passphrase_hash TEXT NOT NULL UNIQUE,
     created_at INTEGER NOT NULL
   ) STRICT;
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL
   ) STRICT;
   CREATE INDEX sessions_org_id ON sessions(org_id);`,

  `CREATE TABLE ai_profiles (
     id TEXT PRIMARY KEY,
     org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     url TEXT NOT NULL,
     api TEXT NOT NULL CHECK (api IN ('auto', 'responses', 'chat-completions')),
     model TEXT NOT NULL,
     api_key TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   ) STRICT;
   CREATE INDEX ai_profiles_org_id ON ai_profiles(org_id);
   CREATE TABLE org_settings (
     org_id TEXT PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
     active_ai_profile_id TEXT REFERENCES ai_profiles(id) ON DELETE SET NULL
   ) STRICT;`,

  `CREATE TABLE captures (
     id TEXT PRIMARY KEY,
     org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
     text TEXT NOT NULL,
     language TEXT,
     status TEXT NOT NULL CHECK (status IN ('queued', 'sorting', 'filed', 'failed', 'waiting', 'undone')),
     error TEXT,
     archive_path TEXT NOT NULL,
     input_tokens INTEGER NOT NULL DEFAULT 0,
     output_tokens INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   ) STRICT;
   CREATE INDEX captures_org_created ON captures(org_id, created_at);
   CREATE TABLE topics (
     id TEXT PRIMARY KEY,
     org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
     path TEXT NOT NULL COLLATE NOCASE,
     created_by_capture_id TEXT REFERENCES captures(id) ON DELETE SET NULL,
     created_at INTEGER NOT NULL,
     last_used_at INTEGER NOT NULL,
     UNIQUE (org_id, path)
   ) STRICT;
   CREATE TABLE notes (
     id TEXT PRIMARY KEY,
     org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
     capture_id TEXT REFERENCES captures(id) ON DELETE SET NULL,
     topic_id TEXT NOT NULL REFERENCES topics(id),
     title TEXT NOT NULL,
     file_path TEXT NOT NULL,
     confidence REAL NOT NULL,
     created_at INTEGER NOT NULL,
     UNIQUE (org_id, file_path)
   ) STRICT;
   CREATE INDEX notes_capture ON notes(capture_id);`,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/** Opens (or creates) the database with sqlite-vec loaded and the schema up to date. Use ":memory:" in tests. */
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { allowExtension: true });
  db.loadExtension(getLoadablePath());
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  const { user_version: current } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[version]!);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

export function databaseVersions(db: DatabaseSync): { sqlite: string; sqliteVec: string } {
  const row = db.prepare("SELECT sqlite_version() AS sqlite, vec_version() AS sqliteVec").get() as {
    sqlite: string;
    sqliteVec: string;
  };
  return { sqlite: row.sqlite, sqliteVec: row.sqliteVec };
}
