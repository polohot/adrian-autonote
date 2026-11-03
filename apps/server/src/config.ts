import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  webDir: string;
  /** Login attempts allowed per client IP per 10 minutes. */
  loginLimit: number;
}

function wholeNumber(name: string, value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}, got "${value}"`);
  }
  return parsed;
}

export function readConfig(env: NodeJS.ProcessEnv): Config {
  return {
    port: wholeNumber("PORT", env.PORT, 3000, 1, 65535),
    loginLimit: wholeNumber("AUTONOTE_LOGIN_LIMIT", env.AUTONOTE_LOGIN_LIMIT, 10, 1, 1_000_000),
    // Only this machine may connect unless HOST is set explicitly.
    host: env.HOST ?? "127.0.0.1",
    dataDir: resolve(env.AUTONOTE_DATA_DIR ?? "data"),
    webDir: env.AUTONOTE_WEB_DIR
      ? resolve(env.AUTONOTE_WEB_DIR)
      : fileURLToPath(new URL("../../web/dist", import.meta.url)),
  };
}
