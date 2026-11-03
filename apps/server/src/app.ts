import type { DatabaseSync } from "node:sqlite";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import pkg from "../../../package.json";
import { aiProfileRoutes } from "./ai/routes.ts";
import { requireSession, sameOriginOnly, sessionRoutes, socketAddress, type AppEnv } from "./auth/routes.ts";
import { pendingRoutes } from "./captures/pending-routes.ts";
import { captureRoutes, noteRoutes } from "./captures/routes.ts";
import { Sorter } from "./captures/sorter.ts";
import { databaseVersions } from "./db.ts";
import { Vault } from "./vault.ts";

export interface AppOptions {
  db: DatabaseSync;
  /** Folder holding one Markdown vault per org. */
  vaultDir: string;
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

export type App = Hono<AppEnv> & { sorter: Sorter };

/** Routes added to the returned app under /api/ require a session. */
export function createApp({
  db,
  vaultDir,
  webDir,
  clientIp = socketAddress,
  now = Date.now,
  loginLimit = 10,
  fetch = globalThis.fetch,
}: AppOptions): App {
  const app = new Hono<AppEnv>();
  const auth = { db, clientIp, now, loginLimit };
  const vault = new Vault(vaultDir);
  const sorter = new Sorter({ db, vault, fetch, now });

  app.get("/api/health", (c) => c.json({ status: "ok", version: pkg.version, ...databaseVersions(db) }));
  app.use("/api/*", sameOriginOnly());
  app.route("/api/session", sessionRoutes(auth));
  app.use("/api/*", requireSession(auth));
  app.route("/api/ai-profiles", aiProfileRoutes({ db, now, fetch, onConnectionChanged: (orgId) => sorter.resumeWaiting(orgId) }));
  app.route("/api/captures", captureRoutes({ db, vault, sorter, now }));
  app.route("/api/notes", noteRoutes({ db, vault }));
  app.route("/api/pending", pendingRoutes({ db, sorter, fetch }));

  if (webDir) {
    app.use("*", serveStatic({ root: webDir }));
  }

  return Object.assign(app, { sorter });
}
