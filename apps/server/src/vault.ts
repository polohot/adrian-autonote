import { mkdir, open, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

/** Each org's Markdown files live in <root>/<org id>/, an Obsidian-compatible vault. */
export class Vault {
  constructor(readonly root: string) {}

  orgDir(orgId: string): string {
    return join(this.root, orgId);
  }

  /** Absolute path for a vault-relative path; refuses anything outside the org's folder. */
  path(orgId: string, relativePath: string): string {
    const base = this.orgDir(orgId);
    const full = resolve(base, relativePath);
    if (!full.startsWith(base + sep)) throw new Error(`Path leaves the vault: ${relativePath}`);
    return full;
  }

  async write(orgId: string, relativePath: string, content: string): Promise<void> {
    const full = this.path(orgId, relativePath);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }

  /**
   * Writes a new file in `folder` without overwriting anything: tries fileName(1), fileName(2), …
   * Returns the vault-relative path that was used.
   */
  async writeNew(orgId: string, folder: string, fileName: (attempt: number) => string, content: string): Promise<string> {
    await mkdir(dirname(this.path(orgId, join(folder, fileName(1)))), { recursive: true });
    for (let attempt = 1; attempt <= 1000; attempt++) {
      const relativePath = join(folder, fileName(attempt)).split(sep).join("/");
      const full = this.path(orgId, relativePath);
      try {
        const handle = await open(full, "wx");
        await handle.writeFile(content, "utf8");
        await handle.close();
        return relativePath;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
    }
    throw new Error(`No free file name in ${folder}`);
  }

  read(orgId: string, relativePath: string): Promise<string> {
    return readFile(this.path(orgId, relativePath), "utf8");
  }

  /** Deletes a file, then any folders above it that are now empty (up to the vault root). */
  async remove(orgId: string, relativePath: string): Promise<void> {
    const base = this.orgDir(orgId);
    const full = this.path(orgId, relativePath);
    try {
      await unlink(full);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    for (let dir = dirname(full); relative(base, dir) !== "" && dir.startsWith(base + sep); dir = dirname(dir)) {
      try {
        await rmdir(dir);
      } catch {
        break; // not empty, or already gone
      }
    }
  }
}
