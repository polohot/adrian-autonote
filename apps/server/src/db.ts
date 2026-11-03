import { DatabaseSync } from "node:sqlite";
import { getLoadablePath } from "sqlite-vec";

/** Opens (or creates) the database with the sqlite-vec extension loaded. Use ":memory:" in tests. */
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { allowExtension: true });
  db.loadExtension(getLoadablePath());
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  return db;
}

export function databaseVersions(db: DatabaseSync): { sqlite: string; sqliteVec: string } {
  const row = db.prepare("SELECT sqlite_version() AS sqlite, vec_version() AS sqliteVec").get() as {
    sqlite: string;
    sqliteVec: string;
  };
  return { sqlite: row.sqlite, sqliteVec: row.sqliteVec };
}
