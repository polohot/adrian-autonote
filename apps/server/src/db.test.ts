import { afterEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { databaseVersions, openDatabase } from "./db.ts";

const vector = (values: number[]) => new Uint8Array(new Float32Array(values).buffer);

describe("openDatabase", () => {
  let db: DatabaseSync;
  afterEach(() => db.close());

  it("loads sqlite-vec and reports versions", () => {
    db = openDatabase(":memory:");
    const versions = databaseVersions(db);
    expect(versions.sqlite).toMatch(/^3\.\d+\.\d+$/);
    expect(versions.sqliteVec).toMatch(/^v\d+\.\d+\.\d+/);
  });

  it("finds the nearest vector", () => {
    db = openDatabase(":memory:");
    db.exec("CREATE VIRTUAL TABLE v USING vec0(embedding float[3])");
    const insert = db.prepare("INSERT INTO v(rowid, embedding) VALUES (?, ?)");
    insert.run(1n, vector([1, 0, 0]));
    insert.run(2n, vector([0, 1, 0]));
    const nearest = db
      .prepare("SELECT rowid FROM v WHERE embedding MATCH ? ORDER BY distance LIMIT 1")
      .get(vector([0.1, 0.9, 0])) as { rowid: number };
    expect(nearest.rowid).toBe(2);
  });

  it("supports full-text search", () => {
    db = openDatabase(":memory:");
    db.exec("CREATE VIRTUAL TABLE f USING fts5(body)");
    db.prepare("INSERT INTO f(body) VALUES (?)").run("trip to chiang mai");
    const row = db.prepare("SELECT count(*) AS n FROM f WHERE f MATCH 'chiang'").get() as { n: number };
    expect(row.n).toBe(1);
  });
});
