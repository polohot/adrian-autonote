import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

const DAY_MS = 24 * 60 * 60 * 1000;
export const SESSION_MS = 90 * DAY_MS;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Returns the token for the cookie; only its hash is stored. */
export function createSession(db: DatabaseSync, orgId: string, now = Date.now()): string {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  const token = randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO sessions (token_hash, org_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
    hashToken(token),
    orgId,
    now,
    now + SESSION_MS,
  );
  return token;
}

/**
 * Looks up a session and slides its expiry to 90 days from now, at most once a day.
 * `renewed` tells the caller to send the cookie again with a fresh lifetime.
 */
export function getSession(
  db: DatabaseSync,
  token: string,
  now = Date.now(),
): { orgId: string; renewed: boolean } | null {
  const tokenHash = hashToken(token);
  const row = db.prepare("SELECT org_id, expires_at FROM sessions WHERE token_hash = ?").get(tokenHash) as
    | { org_id: string; expires_at: number }
    | undefined;
  if (!row) return null;
  if (row.expires_at <= now) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    return null;
  }
  const renewed = row.expires_at - now < SESSION_MS - DAY_MS;
  if (renewed) {
    db.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?").run(now + SESSION_MS, tokenHash);
  }
  return { orgId: row.org_id, renewed };
}

export function deleteSession(db: DatabaseSync, token: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}
