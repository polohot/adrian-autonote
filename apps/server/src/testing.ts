import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A fresh temporary folder for one test; call `remove` in afterEach. */
export function tempDir(prefix: string): { path: string; remove: () => void } {
  const path = mkdtempSync(join(tmpdir(), `autonote-${prefix}-`));
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) };
}
