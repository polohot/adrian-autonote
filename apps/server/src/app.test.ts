import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import pkg from "../../../package.json";
import { createApp } from "./app.ts";
import { openDatabase } from "./db.ts";

describe("createApp", () => {
  let db: DatabaseSync;
  let webDir: string;

  beforeEach(() => {
    db = openDatabase(":memory:");
    webDir = mkdtempSync(join(tmpdir(), "autonote-web-"));
    writeFileSync(join(webDir, "index.html"), "<h1>AutoNote test page</h1>");
  });

  afterEach(() => {
    db.close();
    rmSync(webDir, { recursive: true, force: true });
  });

  it("reports health with database versions", async () => {
    const res = await createApp({ db }).request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      version: pkg.version,
      sqlite: expect.stringMatching(/^3\./),
      sqliteVec: expect.stringMatching(/^v/),
    });
  });

  it("serves the web app from webDir", async () => {
    const res = await createApp({ db, webDir }).request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("AutoNote test page");
  });

  it("returns 404 for unknown pages", async () => {
    const res = await createApp({ db, webDir }).request("/nope.html");
    expect(res.status).toBe(404);
  });

  it("requires a session for unknown API paths, so it does not reveal which exist", async () => {
    const res = await createApp({ db, webDir }).request("/api/nope");
    expect(res.status).toBe(401);
  });
});
