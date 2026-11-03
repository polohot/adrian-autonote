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
