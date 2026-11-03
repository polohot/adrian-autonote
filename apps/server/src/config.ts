import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  webDir: string;
}

export function readConfig(env: NodeJS.ProcessEnv): Config {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a whole number from 1 to 65535, got "${env.PORT}"`);
  }
  return {
    port,
    // No login yet, so only this machine may connect unless HOST is set explicitly.
    host: env.HOST ?? "127.0.0.1",
    dataDir: resolve(env.AUTONOTE_DATA_DIR ?? "data"),
    webDir: env.AUTONOTE_WEB_DIR
      ? resolve(env.AUTONOTE_WEB_DIR)
      : fileURLToPath(new URL("../../web/dist", import.meta.url)),
  };
}
