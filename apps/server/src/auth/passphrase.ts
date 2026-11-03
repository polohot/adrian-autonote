import { randomBytes, scrypt } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 32;
const SALT_KEY = "passphrase_salt";

/** Makes the same words typed on different devices match. Case still matters. */
export function normalizePassphrase(input: string): string {
  return input.normalize("NFC").trim();
}

/**
 * The passphrase identifies the org, so the hash must be the same every time:
 * one random salt for the whole server, created on first use.
 */
export function getServerSalt(db: DatabaseSync): Buffer {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(SALT_KEY) as { value: string } | undefined;
  if (row) return Buffer.from(row.value, "base64");
  const salt = randomBytes(16);
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING").run(SALT_KEY, salt.toString("base64"));
  const stored = db.prepare("SELECT value FROM meta WHERE key = ?").get(SALT_KEY) as { value: string };
  return Buffer.from(stored.value, "base64");
}

/** Expects an already normalized passphrase. */
export function hashPassphrase(passphrase: string, salt: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    scrypt(passphrase, salt, KEY_LENGTH, SCRYPT_PARAMS, (err, key) => (err ? reject(err) : resolve(key.toString("hex"))));
  });
}
