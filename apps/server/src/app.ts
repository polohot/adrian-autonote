import type { DatabaseSync } from "node:sqlite";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import pkg from "../../../package.json";
import { aiProfileRoutes } from "./ai/routes.ts";
import { requireSession, sameOriginOnly, sessionRoutes, socketAddress, type AppEnv } from "./auth/routes.ts";
import { databaseVersions } from "./db.ts";

export interface AppOptions {
  db: DatabaseSync;
  /** Folder with the built web app. Omit to serve the API only. */
  webDir?: string;
  /** Key for login rate limiting. Defaults to the connection's IP address. */
  clientIp?: (c: Context) => string;
  now?: () => number;
  /** Login attempts allowed per client IP per 10 minutes. */
  loginLimit?: number;
  /** Used for calls to AI providers; replaced in tests. */
  fetch?: typeof fetch;
}

/** Routes added to the returned app under /api/ require a session. */
export function createApp({
  db,
  webDir,
  clientIp = socketAddress,
  now = Date.now,
  loginLimit = 10,
  fetch = globalThis.fetch,
}: AppOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = { db, clientIp, now, loginLimit };

  app.get("/api/health", (c) => c.json({ status: "ok", version: pkg.version, ...databaseVersions(db) }));
  app.use("/api/*", sameOriginOnly());
  app.route("/api/session", sessionRoutes(auth));
  app.use("/api/*", requireSession(auth));
  app.route("/api/ai-profiles", aiProfileRoutes({ db, now, fetch }));

  if (webDir) {
    app.use("*", serveStatic({ root: webDir }));
  }

  return app;
}
