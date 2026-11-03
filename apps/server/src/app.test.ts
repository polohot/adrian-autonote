import { writeFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import pkg from "../../../package.json";
import { createApp } from "./app.ts";
import { openDatabase } from "./db.ts";
import { tempDir } from "./testing.ts";

describe("createApp", () => {
  let db: DatabaseSync;
  let web: ReturnType<typeof tempDir>;
  let vault: ReturnType<typeof tempDir>;
  const app = (withWeb = true) => createApp({ db, vaultDir: vault.path, webDir: withWeb ? web.path : undefined });

  beforeEach(() => {
    db = openDatabase(":memory:");
    web = tempDir("web");
    vault = tempDir("vault");
    writeFileSync(join(web.path, "index.html"), "<h1>AutoNote test page</h1>");
  });

  afterEach(() => {
    db.close();
    web.remove();
    vault.remove();
  });

  it("reports health with database versions", async () => {
    const res = await app(false).request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      version: pkg.version,
      sqlite: expect.stringMatching(/^3\./),
      sqliteVec: expect.stringMatching(/^v/),
    });
  });

  it("serves the web app from webDir", async () => {
    const res = await app().request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("AutoNote test page");
  });

  it("returns 404 for unknown pages", async () => {
    const res = await app().request("/nope.html");
    expect(res.status).toBe(404);
  });

  it("requires a session for unknown API paths, so it does not reveal which exist", async () => {
    const res = await app().request("/api/nope");
    expect(res.status).toBe(401);
  });
});
