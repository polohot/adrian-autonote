import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { readConfig } from "./config.ts";
import { openDatabase } from "./db.ts";

const config = readConfig(process.env);
mkdirSync(config.dataDir, { recursive: true });
const db = openDatabase(join(config.dataDir, "autonote.db"));
const app = createApp({ db, vaultDir: join(config.dataDir, "vaults"), webDir: config.webDir, loginLimit: config.loginLimit });
app.sorter.resumeUnfinished();

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`AutoNote is running at http://${config.host}:${info.port}`);
});

function shutdown(): void {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
