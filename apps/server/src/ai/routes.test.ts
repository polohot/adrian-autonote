import type { DatabaseSync } from "node:sqlite";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";
import type { AppEnv } from "../auth/routes.ts";
import { openDatabase } from "../db.ts";
import { tempDir } from "../testing.ts";
import { getActiveConnection, keyHint } from "./profiles.ts";

const AZURE = {
  name: "Work: Azure Foundry",
  url: "https://example.services.ai.azure.com/openai/v1/responses",
  model: "my-deployment",
  apiKey: "azure-secret-key-1234",
};

describe("AI profile routes", () => {
  let db: DatabaseSync;
  let app: Hono<AppEnv>;
  let providerCalls: { url: string; headers: Record<string, string> }[];
  let providerReply: { status: number; body: unknown };
  let vault: ReturnType<typeof tempDir>;

  beforeEach(() => {
    db = openDatabase(":memory:");
    providerCalls = [];
    providerReply = { status: 200, body: { output_text: "OK" } };
    const fakeFetch = (async (url: string, init: RequestInit) => {
      providerCalls.push({ url, headers: init.headers as Record<string, string> });
      return new Response(JSON.stringify(providerReply.body), { status: providerReply.status });
    }) as typeof fetch;
    vault = tempDir("vault");
    app = createApp({ db, vaultDir: vault.path, fetch: fakeFetch, loginLimit: 1000 });
  });
  afterEach(() => {
    db.close();
    vault.remove();
  });

  async function signIn(passphrase: string): Promise<Record<string, string>> {
    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passphrase }),
    });
    const cookie = res.headers.getSetCookie()[0]!.split(";")[0]!;
    return { cookie, "content-type": "application/json" };
  }

  const call = (headers: Record<string, string>, method: string, path: string, body?: unknown) =>
    app.request(`/api/ai-profiles${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

  const list = async (headers: Record<string, string>) =>
    ((await (await call(headers, "GET", "")).json()) as { profiles: Record<string, unknown>[] }).profiles;

  it("needs a session", async () => {
    expect((await app.request("/api/ai-profiles")).status).toBe(401);
  });

  it("creates a profile, makes the first one active and never returns the key", async () => {
    const headers = await signIn("org a");
    const res = await call(headers, "POST", "", AZURE);
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain(AZURE.apiKey);
    expect(JSON.parse(text)).toEqual({
      id: expect.any(String),
      name: AZURE.name,
      url: AZURE.url,
      api: "auto",
      model: AZURE.model,
      keyHint: "…1234",
      active: true,
    });

    const second = (await (await call(headers, "POST", "", { ...AZURE, name: "Personal" })).json()) as { active: boolean };
    expect(second.active).toBe(false);
    const listText = await (await call(headers, "GET", "")).text();
    expect(listText).not.toContain(AZURE.apiKey);
    expect((JSON.parse(listText) as { profiles: unknown[] }).profiles).toHaveLength(2);
  });

  it("rejects invalid input with a message for the form", async () => {
    const headers = await signIn("org a");
    const bad = async (body: unknown) => {
      const res = await call(headers, "POST", "", body);
      expect(res.status).toBe(400);
      return ((await res.json()) as { message: string }).message;
    };
    expect(await bad({ ...AZURE, url: "not a url" })).toMatch(/Not a valid URL/);
    expect(await bad({ ...AZURE, name: "  " })).toBe("Name is required");
    expect(await bad({ ...AZURE, model: undefined })).toBe("Model is required");
    expect(await bad({ ...AZURE, api: "graphql" })).toMatch(/API style/);
  });

  it("allows an empty key for local servers", async () => {
    const headers = await signIn("org a");
    const res = await call(headers, "POST", "", { ...AZURE, url: "http://localhost:11434/v1", apiKey: "" });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { keyHint: string }).keyHint).toBe("");
  });

  it("edits a profile and keeps the key when the key field is empty", async () => {
    const headers = await signIn("org a");
    const { id } = (await (await call(headers, "POST", "", AZURE)).json()) as { id: string };

    const renamed = (await (await call(headers, "PATCH", `/${id}`, { name: "Renamed", apiKey: "" })).json()) as Record<string, unknown>;
    expect(renamed).toMatchObject({ name: "Renamed", keyHint: "…1234", url: AZURE.url });
    expect(getActiveConnection(db, (await orgId(headers)))?.apiKey).toBe(AZURE.apiKey);

    const rekeyed = (await (await call(headers, "PATCH", `/${id}`, { apiKey: "new-secret-key-9999" })).json()) as Record<string, unknown>;
    expect(rekeyed).toMatchObject({ name: "Renamed", keyHint: "…9999" });
  });

  it("switches the active profile, and deleting the active one leaves none active", async () => {
    const headers = await signIn("org a");
    const first = (await (await call(headers, "POST", "", AZURE)).json()) as { id: string };
    const second = (await (await call(headers, "POST", "", { ...AZURE, name: "Personal" })).json()) as { id: string };

    expect((await call(headers, "POST", `/${second.id}/activate`)).status).toBe(204);
    expect((await list(headers)).map((p) => [p.id, p.active])).toEqual([
      [first.id, false],
      [second.id, true],
    ]);

    expect((await call(headers, "DELETE", `/${second.id}`)).status).toBe(204);
    expect((await list(headers)).map((p) => [p.id, p.active])).toEqual([[first.id, false]]);
    expect(getActiveConnection(db, await orgId(headers))).toBeNull();
  });

  it("keeps each org's profiles separate", async () => {
    const orgA = await signIn("org a");
    const orgB = await signIn("org b");
    const { id } = (await (await call(orgA, "POST", "", AZURE)).json()) as { id: string };

    expect(await list(orgB)).toEqual([]);
    expect((await call(orgB, "PATCH", `/${id}`, { name: "Stolen" })).status).toBe(404);
    expect((await call(orgB, "POST", `/${id}/activate`)).status).toBe(404);
    expect((await call(orgB, "POST", `/${id}/test`)).status).toBe(404);
    expect((await call(orgB, "DELETE", `/${id}`)).status).toBe(404);
    expect((await list(orgA))[0]).toMatchObject({ name: AZURE.name });
  });

  it("tests a connection with the saved key and reports the reply", async () => {
    const headers = await signIn("org a");
    const { id } = (await (await call(headers, "POST", "", AZURE)).json()) as { id: string };

    const ok = (await (await call(headers, "POST", `/${id}/test`)).json()) as Record<string, unknown>;
    expect(ok).toEqual({ ok: true, reply: "OK", latencyMs: expect.any(Number) });
    expect(providerCalls[0]).toMatchObject({ url: AZURE.url, headers: { "api-key": AZURE.apiKey } });

    providerReply = { status: 401, body: { error: { message: "Access denied due to invalid subscription key." } } };
    const failed = (await (await call(headers, "POST", `/${id}/test`)).json()) as Record<string, unknown>;
    expect(failed).toEqual({ ok: false, error: "401: Access denied due to invalid subscription key." });
  });

  async function orgId(headers: Record<string, string>): Promise<string> {
    const res = await app.request("/api/session", { headers });
    return ((await res.json()) as { org: { id: string } }).org.id;
  }
});

describe("keyHint", () => {
  it("shows the last 4 characters only for long keys", () => {
    expect(keyHint("abcdefghijkl1234")).toBe("…1234");
    expect(keyHint("short")).toBe("set");
    expect(keyHint("")).toBe("");
  });
});
