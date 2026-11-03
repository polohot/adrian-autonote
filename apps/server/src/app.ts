import type { DatabaseSync } from "node:sqlite";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import pkg from "../../../package.json";
import { databaseVersions } from "./db.ts";

export interface AppOptions {
  db: DatabaseSync;
  /** Folder with the built web app. Omit to serve the API only. */
  webDir?: string;
}

export function createApp({ db, webDir }: AppOptions): Hono {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ status: "ok", version: pkg.version, ...databaseVersions(db) }));

  if (webDir) {
    app.use("*", serveStatic({ root: webDir }));
  }

  return app;
}
