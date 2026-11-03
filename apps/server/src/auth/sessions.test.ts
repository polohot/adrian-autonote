import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db.ts";
import { createSession, deleteSession, getSession, SESSION_MS } from "./sessions.ts";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 3);

describe("sessions", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = openDatabase(":memory:");
    db.prepare("INSERT INTO orgs (id, passphrase_hash, created_at) VALUES ('org-1', 'h', ?)").run(T0);
  });
  afterEach(() => db.close());

  it("finds a new session and stores only a hash of the token", () => {
    const token = createSession(db, "org-1", T0);
    expect(getSession(db, token, T0)).toEqual({ orgId: "org-1", renewed: false });
    const stored = db.prepare("SELECT token_hash FROM sessions").all() as { token_hash: string }[];
    expect(stored).toHaveLength(1);
    expect(stored[0]!.token_hash).not.toContain(token);
  });

  it("returns null for an unknown token", () => {
    expect(getSession(db, "nope", T0)).toBeNull();
  });

  it("expires after 90 days without use and removes the row", () => {
    const token = createSession(db, "org-1", T0);
    expect(getSession(db, token, T0 + SESSION_MS)).toBeNull();
    expect(db.prepare("SELECT count(*) AS n FROM sessions").get()).toEqual({ n: 0 });
  });

  it("slides the expiry when used more than a day later", () => {
    const token = createSession(db, "org-1", T0);
    expect(getSession(db, token, T0 + 2 * DAY)?.renewed).toBe(true);
    expect(getSession(db, token, T0 + 2 * DAY + 60_000)?.renewed).toBe(false);
    expect(getSession(db, token, T0 + 2 * DAY + SESSION_MS - 1)).toEqual({ orgId: "org-1", renewed: true });
  });

  it("deletes a session on sign-out", () => {
    const token = createSession(db, "org-1", T0);
    deleteSession(db, token);
    expect(getSession(db, token, T0)).toBeNull();
  });

  it("cleans up expired sessions when a new one is created", () => {
    createSession(db, "org-1", T0);
    createSession(db, "org-1", T0 + SESSION_MS + 1);
    expect(db.prepare("SELECT count(*) AS n FROM sessions").get()).toEqual({ n: 1 });
  });
});
