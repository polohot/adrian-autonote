import type { DatabaseSync } from "node:sqlite";
import { fileWithAnswer, generateText, usageOf } from "@autonote/engine";
import { Hono } from "hono";
import { getActiveConnection } from "../ai/profiles.ts";
import type { AppEnv } from "../auth/routes.ts";
import { claimPending, deletePending, getPending, listPending, restorePending } from "./pending.ts";
import type { Sorter } from "./sorter.ts";
import { addUsage, getCapture, getPieceView, topicPaths } from "./store.ts";

export const MAX_ANSWER_LENGTH = 2000;

export interface PendingRouteOptions {
  db: DatabaseSync;
  sorter: Sorter;
  fetch: typeof fetch;
}

export function pendingRoutes({ db, sorter, fetch }: PendingRouteOptions): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const notFound = { error: "not_found" } as const;

  /** Files a pending piece; null when another request already did. */
  async function file(orgId: string, pendingId: string, topic: string, title?: string) {
    const item = claimPending(db, orgId, pendingId);
    if (!item) return null;
    const capture = getCapture(db, item.captureId)!;
    try {
      const noteId = await sorter.filePiece(capture, { title: title ?? item.title, body: item.body, topic, confidence: 1 });
      return getPieceView(db, noteId)!;
    } catch (err) {
      restorePending(db, orgId, item);
      throw err;
    }
  }
  const alreadyHandled = { error: "already_handled", message: "This piece was already filed or dropped." } as const;

  routes.get("/", (c) => c.json({ items: listPending(db, c.get("orgId")) }));

  routes.post("/:id/choose", async (c) => {
    const orgId = c.get("orgId");
    if (!getPending(db, orgId, c.req.param("id"))) return c.json(notFound, 404);
    const body = (await c.req.json().catch(() => null)) as { topic?: unknown } | null;
    const topic = typeof body?.topic === "string" ? body.topic.trim() : "";
    if (topic === "") return c.json({ error: "topic_required", message: "Pick a topic." }, 400);
    const piece = await file(orgId, c.req.param("id"), topic);
    return piece ? c.json(piece) : c.json(alreadyHandled, 409);
  });

  routes.post("/:id/answer", async (c) => {
    const orgId = c.get("orgId");
    const item = getPending(db, orgId, c.req.param("id"));
    if (!item) return c.json(notFound, 404);
    const body = (await c.req.json().catch(() => null)) as { answer?: unknown } | null;
    const answer = typeof body?.answer === "string" ? body.answer.trim() : "";
    if (answer === "") return c.json({ error: "answer_required", message: "Type an answer." }, 400);
    if (answer.length > MAX_ANSWER_LENGTH) {
      return c.json({ error: "too_long", message: `Answers can be up to ${MAX_ANSWER_LENGTH} characters.` }, 400);
    }
    const connection = getActiveConnection(db, orgId);
    if (!connection) return c.json({ error: "no_connection", message: "Add an AI connection in Settings first." }, 409);

    const capture = getCapture(db, item.captureId)!;
    let result;
    try {
      result = await fileWithAnswer(item, answer, topicPaths(db, orgId), (request) => generateText(connection, request, { fetch }), {
        language: capture.language ?? undefined,
      });
    } catch (err) {
      const usage = usageOf(err);
      if (usage) addUsage(db, capture.id, usage);
      return c.json({ error: "ai_failed", message: err instanceof Error ? err.message : String(err) }, 502);
    }
    addUsage(db, capture.id, result.usage);
    const piece = await file(orgId, item.id, result.topic, result.title);
    return piece ? c.json(piece) : c.json(alreadyHandled, 409);
  });

  routes.delete("/:id", (c) => {
    const item = getPending(db, c.get("orgId"), c.req.param("id"));
    if (!item) return c.json(notFound, 404);
    deletePending(db, item.id);
    return c.body(null, 204);
  });

  return routes;
}
