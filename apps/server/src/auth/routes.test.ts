import type { DatabaseSync } from "node:sqlite";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";
import { openDatabase } from "../db.ts";
import { SESSION_COOKIE, type AppEnv } from "./routes.ts";

const DAY = 24 * 60 * 60 * 1000;

describe("passphrase login routes", () => {
  let db: DatabaseSync;
  let app: Hono<AppEnv>;
  let ip: string;
  let time: number;

  beforeEach(() => {
    db = openDatabase(":memory:");
    ip = "100.64.0.1";
    time = Date.UTC(2026, 10, 3);
    app = createApp({ db, clientIp: () => ip, now: () => time });
    app.get("/api/whoami", (c) => c.json({ orgId: c.get("orgId") }));
  });
  afterEach(() => db.close());

  const signIn = (passphrase: unknown, headers: Record<string, string> = {}, url = "/api/session") =>
    app.request(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ passphrase }),
    });

  const sessionCookie = (res: Response) => {
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    if (!cookie) throw new Error("no session cookie in response");
    return cookie;
  };
  const cookieHeader = (res: Response) => ({ cookie: sessionCookie(res).split(";")[0]! });

  it("creates a new org for an unused passphrase", async () => {
    const res = await signIn("blue whale moon");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { org: { id: string; createdAt: number }; created: boolean };
    expect(body.created).toBe(true);
    expect(body.org).toEqual({ id: expect.any(String), createdAt: time });
  });

  it("opens the same org with the same passphrase", async () => {
    const first = (await (await signIn("blue whale moon")).json()) as { org: { id: string } };
    const second = (await (await signIn("blue whale moon")).json()) as { org: { id: string }; created: boolean };
    expect(second).toEqual({ org: first.org, created: false });
  });

  it("matches passphrases after Unicode and whitespace normalization", async () => {
    const first = (await (await signIn("cafe\u0301 ")).json()) as { org: { id: string } };
    const second = (await (await signIn(" caf\u00e9")).json()) as { org: { id: string }; created: boolean };
    expect(second.org.id).toBe(first.org.id);
    expect(second.created).toBe(false);
  });

  it("gives a different passphrase a different org", async () => {
    const a = (await (await signIn("one")).json()) as { org: { id: string } };
    const b = (await (await signIn("One")).json()) as { org: { id: string } };
    expect(b.org.id).not.toBe(a.org.id);
  });

  it("accepts a one-character passphrase", async () => {
    expect((await signIn("x")).status).toBe(200);
  });

  it("rejects an empty, missing or oversized passphrase", async () => {
    expect((await signIn("   ")).status).toBe(400);
    expect((await signIn(42)).status).toBe(400);
    expect((await signIn("x".repeat(10_001))).status).toBe(400);
    const notJson = await app.request("/api/session", { method: "POST", body: "passphrase=x" });
    expect(notJson.status).toBe(400);
  });

  it("sets a secure session cookie", async () => {
    const cookie = sessionCookie(await signIn("cookie test"));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Max-Age=7776000/);
    expect(cookie).not.toMatch(/Secure/);
    const httpsCookie = sessionCookie(await signIn("cookie test", {}, "https://autonote.example/api/session"));
    expect(httpsCookie).toMatch(/Secure/);
  });

  it("reports the signed-in org and protects other API routes", async () => {
    expect((await app.request("/api/session")).status).toBe(401);
    expect((await app.request("/api/whoami")).status).toBe(401);

    const login = await signIn("protected");
    const { org } = (await login.clone().json()) as { org: { id: string } };
    const headers = cookieHeader(login);

    const session = await app.request("/api/session", { headers });
    expect(await session.json()).toEqual({ org: { id: org.id, createdAt: time } });
    expect(await (await app.request("/api/whoami", { headers })).json()).toEqual({ orgId: org.id });
  });

  it("keeps the health check public", async () => {
    expect((await app.request("/api/health")).status).toBe(200);
  });

  it("signs out only the current session", async () => {
    const phone = cookieHeader(await signIn("shared"));
    const laptop = cookieHeader(await signIn("shared"));

    const out = await app.request("/api/session", { method: "DELETE", headers: phone });
    expect(out.status).toBe(204);
    expect(out.headers.getSetCookie().join()).toMatch(new RegExp(`${SESSION_COOKIE}=;.*Max-Age=0`));

    expect((await app.request("/api/whoami", { headers: phone })).status).toBe(401);
    expect((await app.request("/api/whoami", { headers: laptop })).status).toBe(200);
  });

  it("ends the session after 90 days without use, and renews the cookie when used", async () => {
    const headers = cookieHeader(await signIn("long lived"));

    time += 2 * DAY;
    const renewed = await app.request("/api/whoami", { headers });
    expect(renewed.status).toBe(200);
    expect(sessionCookie(renewed)).toMatch(/Max-Age=7776000/);

    time += 90 * DAY;
    expect((await app.request("/api/whoami", { headers })).status).toBe(401);
  });

  it("limits login attempts to 10 per IP per 10 minutes", async () => {
    for (let i = 0; i < 10; i++) expect((await signIn(`guess ${i}`)).status).toBe(200);

    const blocked = await signIn("guess 10");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("600");
    expect(await blocked.json()).toEqual({ error: "too_many_attempts", retryAfterSeconds: 600 });

    ip = "100.64.0.2";
    expect((await signIn("other device")).status).toBe(200);

    ip = "100.64.0.1";
    time += 10 * 60 * 1000;
    expect((await signIn("after the wait")).status).toBe(200);
  });

  it("rejects login and sign-out requests from other websites", async () => {
    expect((await signIn("evil", { origin: "https://evil.example" })).status).toBe(403);
    expect((await signIn("evil", { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await app.request("/api/session", { method: "DELETE", headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect((await signIn("same site", { origin: "http://localhost" })).status).toBe(200);
  });
});
