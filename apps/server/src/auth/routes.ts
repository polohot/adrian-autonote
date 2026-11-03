import type { DatabaseSync } from "node:sqlite";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { EmptyPassphraseError, findOrCreateOrg, getOrg } from "./orgs.ts";
import { RateLimiter } from "./rate-limit.ts";
import { createSession, deleteSession, getSession, SESSION_MS } from "./sessions.ts";

export const SESSION_COOKIE = "autonote_session";
export const MAX_PASSPHRASE_LENGTH = 10_000;

export type AppEnv = { Variables: { orgId: string } };

export interface AuthOptions {
  db: DatabaseSync;
  clientIp: (c: Context) => string;
  now: () => number;
  /** Login attempts allowed per client IP per 10 minutes. */
  loginLimit: number;
}

export function socketAddress(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

function isHttps(c: Context): boolean {
  return new URL(c.req.url).protocol === "https:" || c.req.header("x-forwarded-proto") === "https";
}

function sendSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: isHttps(c),
    path: "/",
    maxAge: SESSION_MS / 1000,
  });
}

/** Returns the signed-in org ID, re-sending the cookie when the session was extended. */
function currentOrgId(c: Context, { db, now }: AuthOptions): string | null {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const session = getSession(db, token, now());
  if (!session) return null;
  if (session.renewed) sendSessionCookie(c, token);
  return session.orgId;
}

/** Rejects state-changing requests sent by other websites. */
export function sameOriginOnly(): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD" || c.req.method === "OPTIONS") return next();
    const forbidden = () => c.json({ error: "cross_origin" }, 403);
    if (c.req.header("sec-fetch-site") === "cross-site") return forbidden();
    const origin = c.req.header("origin");
    if (origin) {
      let originHost: string;
      try {
        originHost = new URL(origin).host;
      } catch {
        return forbidden();
      }
      const allowedHosts = [new URL(c.req.url).host, c.req.header("x-forwarded-host")];
      if (!allowedHosts.includes(originHost)) return forbidden();
    }
    return next();
  };
}

export function requireSession(options: AuthOptions): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const orgId = currentOrgId(c, options);
    if (!orgId) return c.json({ error: "not_signed_in" }, 401);
    c.set("orgId", orgId);
    await next();
  };
}

export function sessionRoutes(options: AuthOptions): Hono<AppEnv> {
  const { db, clientIp, now, loginLimit } = options;
  const limiter = new RateLimiter(loginLimit, 10 * 60 * 1000);
  const routes = new Hono<AppEnv>();

  routes.post("/", bodyLimit({ maxSize: 4 * MAX_PASSPHRASE_LENGTH + 1024 }), async (c) => {
    const limit = limiter.hit(clientIp(c), now());
    if (!limit.allowed) {
      const retryAfterSeconds = Math.ceil(limit.retryAfterMs / 1000);
      c.header("Retry-After", String(retryAfterSeconds));
      return c.json({ error: "too_many_attempts", retryAfterSeconds }, 429);
    }

    const body: unknown = await c.req.json().catch(() => null);
    const passphrase = (body as { passphrase?: unknown } | null)?.passphrase;
    if (typeof passphrase !== "string" || passphrase.length > MAX_PASSPHRASE_LENGTH) {
      return c.json({ error: "passphrase_required" }, 400);
    }

    let result;
    try {
      result = await findOrCreateOrg(db, passphrase, now());
    } catch (err) {
      if (err instanceof EmptyPassphraseError) return c.json({ error: "passphrase_required" }, 400);
      throw err;
    }
    sendSessionCookie(c, createSession(db, result.org.id, now()));
    return c.json(result);
  });

  routes.get("/", (c) => {
    const orgId = currentOrgId(c, options);
    const org = orgId ? getOrg(db, orgId) : null;
    if (!org) return c.json({ error: "not_signed_in" }, 401);
    return c.json({ org });
  });

  routes.delete("/", (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) deleteSession(db, token);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.body(null, 204);
  });

  return routes;
}
