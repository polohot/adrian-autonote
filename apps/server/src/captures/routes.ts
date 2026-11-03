import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { renderArchive } from "@autonote/engine";
import { Hono } from "hono";
import { getActiveConnection } from "../ai/profiles.ts";
import type { AppEnv } from "../auth/routes.ts";
import type { Vault } from "../vault.ts";
import type { Sorter } from "./sorter.ts";
import { getCaptureView, getNote, getOrgCapture, insertCapture, listCaptureViews, setStatus } from "./store.ts";

export const MAX_CAPTURE_LENGTH = 100_000;
const LANGUAGE_TAG = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8}){0,3}$/;

export interface CaptureRouteOptions {
  db: DatabaseSync;
  vault: Vault;
  sorter: Sorter;
  now: () => number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `_archive/2026/11/2026-11-03 1540 ab12cd34.md`, in the server's local time. */
export function archivePathFor(id: string, at: number): string {
  const d = new Date(at);
  const [year, month, day] = [d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate())];
  return `_archive/${year}/${month}/${year}-${month}-${day} ${pad(d.getHours())}${pad(d.getMinutes())} ${id.slice(0, 8)}.md`;
}

export function captureRoutes({ db, vault, sorter, now }: CaptureRouteOptions): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const view = (orgId: string, id: string) => getCaptureView(db, orgId, id)!;

  routes.get("/", (c) => {
    const orgId = c.get("orgId");
    return c.json({ hasConnection: getActiveConnection(db, orgId) !== null, captures: listCaptureViews(db, orgId) });
  });

  routes.post("/", async (c) => {
    const orgId = c.get("orgId");
    const body = (await c.req.json().catch(() => null)) as { text?: unknown; language?: unknown } | null;
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (text === "") return c.json({ error: "text_required", message: "Type something to save." }, 400);
    if (text.length > MAX_CAPTURE_LENGTH) {
      return c.json({ error: "too_long", message: `Captures can be up to ${MAX_CAPTURE_LENGTH.toLocaleString("en")} characters.` }, 400);
    }
    const language = typeof body?.language === "string" && LANGUAGE_TAG.test(body.language) ? body.language : null;

    const id = randomUUID();
    const at = now();
    const archivePath = archivePathFor(id, at);
    await vault.write(orgId, archivePath, renderArchive({ id, captured: new Date(at).toISOString(), text }));
    insertCapture(db, { id, orgId, text, language, archivePath }, at);
    sorter.enqueue(id);
    return c.json(view(orgId, id), 201);
  });

  routes.post("/:id/undo", async (c) => {
    const orgId = c.get("orgId");
    const capture = getOrgCapture(db, orgId, c.req.param("id"));
    if (!capture) return c.json({ error: "not_found" }, 404);
    if (capture.status !== "filed") return c.json({ error: "not_filed", message: "Only sorted captures can be undone." }, 409);
    await sorter.undo(capture);
    return c.json(view(orgId, capture.id));
  });

  routes.post("/:id/retry", (c) => {
    const orgId = c.get("orgId");
    const capture = getOrgCapture(db, orgId, c.req.param("id"));
    if (!capture) return c.json({ error: "not_found" }, 404);
    if (capture.status !== "failed" && capture.status !== "waiting") {
      return c.json({ error: "not_retryable", message: "Only failed or waiting captures can be retried." }, 409);
    }
    setStatus(db, capture.id, "queued", now());
    sorter.enqueue(capture.id);
    return c.json(view(orgId, capture.id));
  });

  return routes;
}

export function noteRoutes({ db, vault }: Pick<CaptureRouteOptions, "db" | "vault">): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get("/:id", async (c) => {
    const orgId = c.get("orgId");
    const note = getNote(db, orgId, c.req.param("id"));
    if (!note) return c.json({ error: "not_found" }, 404);
    const markdown = await vault.read(orgId, note.filePath);
    return c.json({ id: note.id, title: note.title, topic: note.topic, markdown });
  });
  return routes;
}
