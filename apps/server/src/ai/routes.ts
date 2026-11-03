import type { DatabaseSync } from "node:sqlite";
import { generateText } from "@autonote/engine";
import { Hono } from "hono";
import type { AppEnv } from "../auth/routes.ts";
import {
  activateProfile,
  createProfile,
  deleteProfile,
  getConnection,
  InvalidProfileError,
  listProfiles,
  updateProfile,
  validateProfileInput,
  type ProfileInput,
} from "./profiles.ts";

export interface AiRouteOptions {
  db: DatabaseSync;
  now: () => number;
  fetch: typeof fetch;
}

const TEST_PROMPT = "Reply with the single word OK.";

export function aiProfileRoutes({ db, now, fetch }: AiRouteOptions): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const notFound = { error: "not_found" } as const;

  async function readInput(c: { req: { json: () => Promise<unknown> } }, partial: boolean) {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") throw new InvalidProfileError("Send the profile as JSON");
    return validateProfileInput(body as Record<string, unknown>, partial);
  }

  routes.onError((err, c) => {
    if (err instanceof InvalidProfileError) return c.json({ error: "invalid_profile", message: err.message }, 400);
    throw err;
  });

  routes.get("/", (c) => c.json({ profiles: listProfiles(db, c.get("orgId")) }));

  routes.post("/", async (c) => {
    const input = (await readInput(c, false)) as ProfileInput;
    return c.json(createProfile(db, c.get("orgId"), input, now()), 201);
  });

  routes.patch("/:id", async (c) => {
    const patch = await readInput(c, true);
    const profile = updateProfile(db, c.get("orgId"), c.req.param("id"), patch, now());
    return profile ? c.json(profile) : c.json(notFound, 404);
  });

  routes.delete("/:id", (c) =>
    deleteProfile(db, c.get("orgId"), c.req.param("id")) ? c.body(null, 204) : c.json(notFound, 404),
  );

  routes.post("/:id/activate", (c) =>
    activateProfile(db, c.get("orgId"), c.req.param("id")) ? c.body(null, 204) : c.json(notFound, 404),
  );

  routes.post("/:id/test", async (c) => {
    const connection = getConnection(db, c.get("orgId"), c.req.param("id"));
    if (!connection) return c.json(notFound, 404);
    const started = performance.now();
    try {
      const result = await generateText(connection, { input: TEST_PROMPT }, { fetch, timeoutMs: 30_000 });
      return c.json({ ok: true, reply: result.text.trim().slice(0, 200), latencyMs: Math.round(performance.now() - started) });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  return routes;
}
