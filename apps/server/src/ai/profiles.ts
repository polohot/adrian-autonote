import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { resolveEndpoint, type ApiStyle, type ModelConnection } from "@autonote/engine";

/** What the browser sees: never the key itself. */
export interface AiProfile {
  id: string;
  name: string;
  url: string;
  api: ApiStyle;
  model: string;
  keyHint: string;
  active: boolean;
}

export interface ProfileInput {
  name: string;
  url: string;
  api: ApiStyle;
  model: string;
  apiKey: string;
}

interface ProfileRow {
  id: string;
  name: string;
  url: string;
  api: ApiStyle;
  model: string;
  api_key: string;
  active: number;
}

export class InvalidProfileError extends Error {}

const API_STYLES: readonly string[] = ["auto", "responses", "chat-completions"];

/** Last 4 characters, but only when the key is long enough that this gives nothing away. */
export const keyHint = (key: string) => (key.length >= 12 ? `…${key.slice(-4)}` : key ? "set" : "");

function toProfile(row: ProfileRow): AiProfile {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    api: row.api,
    model: row.model,
    keyHint: keyHint(row.api_key),
    active: row.active === 1,
  };
}

/** Checks and trims user input; throws InvalidProfileError with a message for the form. */
export function validateProfileInput(input: Partial<Record<keyof ProfileInput, unknown>>, partial: boolean): Partial<ProfileInput> {
  const result: Partial<ProfileInput> = {};
  const text = (field: keyof ProfileInput, label: string, max: number, required: boolean) => {
    const value = input[field];
    if (value === undefined && partial) return undefined;
    if (typeof value !== "string") {
      if (required) throw new InvalidProfileError(`${label} is required`);
      return undefined;
    }
    const trimmed = value.trim();
    if (required && trimmed === "") throw new InvalidProfileError(`${label} is required`);
    if (trimmed.length > max) throw new InvalidProfileError(`${label} is too long (max ${max} characters)`);
    return trimmed;
  };

  const name = text("name", "Name", 100, true);
  if (name !== undefined) result.name = name;

  const url = text("url", "URL", 2000, true);
  if (url !== undefined) {
    try {
      resolveEndpoint(url);
    } catch (err) {
      throw new InvalidProfileError((err as Error).message);
    }
    result.url = url;
  }

  if (input.api !== undefined || !partial) {
    const api = input.api ?? "auto";
    if (typeof api !== "string" || !API_STYLES.includes(api)) {
      throw new InvalidProfileError("API style must be auto, responses or chat-completions");
    }
    result.api = api as ApiStyle;
  }

  const model = text("model", "Model", 200, true);
  if (model !== undefined) result.model = model;

  // An empty key is allowed (local servers); when editing, empty means "keep the current key".
  const apiKey = text("apiKey", "API key", 10_000, false);
  if (apiKey) result.apiKey = apiKey;
  else if (!partial) result.apiKey = "";

  return result;
}

const SELECT_PROFILES = `
  SELECT p.id, p.name, p.url, p.api, p.model, p.api_key,
         (p.id IS s.active_ai_profile_id) AS active
  FROM ai_profiles p
  LEFT JOIN org_settings s ON s.org_id = p.org_id
  WHERE p.org_id = ?`;

export function listProfiles(db: DatabaseSync, orgId: string): AiProfile[] {
  const rows = db.prepare(`${SELECT_PROFILES} ORDER BY p.created_at, p.id`).all(orgId) as unknown as ProfileRow[];
  return rows.map(toProfile);
}

export function getProfile(db: DatabaseSync, orgId: string, id: string): AiProfile | null {
  const row = db.prepare(`${SELECT_PROFILES} AND p.id = ?`).get(orgId, id) as ProfileRow | undefined;
  return row ? toProfile(row) : null;
}

/** The first profile an org adds becomes its active one. */
export function createProfile(db: DatabaseSync, orgId: string, input: ProfileInput, now = Date.now()): AiProfile {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO ai_profiles (id, org_id, name, url, api, model, api_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, orgId, input.name, input.url, input.api, input.model, input.apiKey, now, now);
  db.prepare(
    `INSERT INTO org_settings (org_id, active_ai_profile_id) VALUES (?, ?)
     ON CONFLICT (org_id) DO UPDATE SET active_ai_profile_id = COALESCE(active_ai_profile_id, excluded.active_ai_profile_id)`,
  ).run(orgId, id);
  return getProfile(db, orgId, id)!;
}

export function updateProfile(
  db: DatabaseSync,
  orgId: string,
  id: string,
  patch: Partial<ProfileInput>,
  now = Date.now(),
): AiProfile | null {
  const columns: Record<keyof ProfileInput, string> = {
    name: "name",
    url: "url",
    api: "api",
    model: "model",
    apiKey: "api_key",
  };
  const entries = (Object.keys(patch) as (keyof ProfileInput)[]).filter((key) => patch[key] !== undefined);
  const assignments = entries.map((key) => `${columns[key]} = ?`).join(", ");
  const values = entries.map((key) => patch[key]!);
  const { changes } = db
    .prepare(`UPDATE ai_profiles SET ${assignments ? `${assignments}, ` : ""}updated_at = ? WHERE id = ? AND org_id = ?`)
    .run(...values, now, id, orgId);
  return changes ? getProfile(db, orgId, id) : null;
}

export function deleteProfile(db: DatabaseSync, orgId: string, id: string): boolean {
  return db.prepare("DELETE FROM ai_profiles WHERE id = ? AND org_id = ?").run(id, orgId).changes > 0;
}

export function activateProfile(db: DatabaseSync, orgId: string, id: string): boolean {
  if (!getProfile(db, orgId, id)) return false;
  db.prepare(
    `INSERT INTO org_settings (org_id, active_ai_profile_id) VALUES (?, ?)
     ON CONFLICT (org_id) DO UPDATE SET active_ai_profile_id = excluded.active_ai_profile_id`,
  ).run(orgId, id);
  return true;
}

/** Server-only: includes the key. */
export function getConnection(db: DatabaseSync, orgId: string, id: string): ModelConnection | null {
  const row = db.prepare("SELECT url, api, model, api_key FROM ai_profiles WHERE id = ? AND org_id = ?").get(id, orgId) as
    | { url: string; api: ApiStyle; model: string; api_key: string }
    | undefined;
  return row ? { url: row.url, api: row.api, model: row.model, apiKey: row.api_key } : null;
}

export function getActiveConnection(db: DatabaseSync, orgId: string): ModelConnection | null {
  const row = db.prepare("SELECT active_ai_profile_id AS id FROM org_settings WHERE org_id = ?").get(orgId) as
    | { id: string | null }
    | undefined;
  return row?.id ? getConnection(db, orgId, row.id) : null;
}
