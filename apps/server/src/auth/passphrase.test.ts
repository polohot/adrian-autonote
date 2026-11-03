import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db.ts";
import { getServerSalt, hashPassphrase, normalizePassphrase } from "./passphrase.ts";

describe("normalizePassphrase", () => {
  it("treats composed and decomposed Unicode as the same text", () => {
    expect(normalizePassphrase("cafe\u0301")).toBe(normalizePassphrase("caf\u00e9"));
  });

  it("removes surrounding whitespace but keeps inner spaces", () => {
    expect(normalizePassphrase("  correct horse battery staple \n")).toBe("correct horse battery staple");
  });

  it("keeps case", () => {
    expect(normalizePassphrase("Tiger")).not.toBe(normalizePassphrase("tiger"));
  });

  it("keeps Thai text intact", () => {
    expect(normalizePassphrase(" สวัสดีครับ ")).toBe("สวัสดีครับ");
  });
});

describe("hashPassphrase and getServerSalt", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = openDatabase(":memory:");
  });
  afterEach(() => db.close());

  it("creates the server salt once and then reuses it", () => {
    const first = getServerSalt(db);
    expect(first).toHaveLength(16);
    expect(getServerSalt(db).equals(first)).toBe(true);
  });

  it("gives the same hash for the same passphrase and salt", async () => {
    const salt = getServerSalt(db);
    const a = await hashPassphrase("one two three", salt);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashPassphrase("one two three", salt)).toBe(a);
    expect(await hashPassphrase("one two four", salt)).not.toBe(a);
  });

  it("gives a different hash with a different salt", async () => {
    const other = openDatabase(":memory:");
    try {
      expect(await hashPassphrase("same", getServerSalt(db))).not.toBe(await hashPassphrase("same", getServerSalt(other)));
    } finally {
      other.close();
    }
  });
});
