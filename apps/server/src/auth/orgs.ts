import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getServerSalt, hashPassphrase, normalizePassphrase } from "./passphrase.ts";

export interface Org {
  id: string;
  createdAt: number;
}

export class EmptyPassphraseError extends Error {
  constructor() {
    super("Passphrase must not be empty");
  }
}

/** Returns the org that uses this passphrase, creating it if no org does. */
export async function findOrCreateOrg(
  db: DatabaseSync,
  passphrase: string,
  now = Date.now(),
): Promise<{ org: Org; created: boolean }> {
  const normalized = normalizePassphrase(passphrase);
  if (normalized === "") throw new EmptyPassphraseError();
  const hash = await hashPassphrase(normalized, getServerSalt(db));

  const newId = randomUUID();
  db.prepare("INSERT INTO orgs (id, passphrase_hash, created_at) VALUES (?, ?, ?) ON CONFLICT (passphrase_hash) DO NOTHING").run(
    newId,
    hash,
    now,
  );
  const row = db.prepare("SELECT id, created_at FROM orgs WHERE passphrase_hash = ?").get(hash) as {
    id: string;
    created_at: number;
  };
  return { org: { id: row.id, createdAt: row.created_at }, created: row.id === newId };
}

export function getOrg(db: DatabaseSync, id: string): Org | null {
  const row = db.prepare("SELECT id, created_at FROM orgs WHERE id = ?").get(id) as
    | { id: string; created_at: number }
    | undefined;
  return row ? { id: row.id, createdAt: row.created_at } : null;
}
