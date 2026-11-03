import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readConfig } from "./config.ts";

describe("readConfig", () => {
  it("defaults to localhost only on port 3000", () => {
    const config = readConfig({});
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(3000);
    expect(config.dataDir).toBe(resolve("data"));
    expect(config.webDir).toMatch(/apps\/web\/dist$/);
  });

  it("reads overrides from the environment", () => {
    const config = readConfig({ PORT: "8080", HOST: "0.0.0.0", AUTONOTE_DATA_DIR: "/data", AUTONOTE_WEB_DIR: "/web" });
    expect(config).toEqual({ port: 8080, host: "0.0.0.0", dataDir: "/data", webDir: "/web" });
  });

  it("rejects an invalid port", () => {
    expect(() => readConfig({ PORT: "abc" })).toThrow(/PORT/);
    expect(() => readConfig({ PORT: "70000" })).toThrow(/PORT/);
  });
});
