import { existsSync, readdirSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, type App } from "../app.ts";
import { openDatabase } from "../db.ts";
import { tempDir } from "../testing.ts";
import type { PendingItem } from "./pending.ts";
import type { CaptureView, Piece } from "./store.ts";

type Headers = Record<string, string>;
type Respond = (input: string, instructions: string) => { status: number; text: string };

const SORT_REPLY = JSON.stringify({
  pieces: [
    { title: "Kyoto", body: "Kyoto temples", topic: "Travel/Japan", confidence: 0.95, question: null, choices: [] },
    {
      title: "Dentist",
      body: "Dentist Thursday 4pm",
      topic: "Personal/Health",
      confidence: 0.8,
      question: "Is this for you or your kid?",
      choices: ["Personal/Health", "Family/Kids"],
    },
    { title: "Misc", body: "Something vague", topic: "Inbox", confidence: 0.3, question: null, choices: [] },
  ],
});

describe("Pending", () => {
  let db: DatabaseSync;
  let vault: ReturnType<typeof tempDir>;
  let app: App;
  let respond: Respond;
  let headers: Headers;
  let orgId: string;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    vault = tempDir("vault");
    respond = (_input, instructions) =>
      instructions.includes("using the user's answer")
        ? { status: 200, text: '{"topic":"Family/Kids","title":"Son\'s dentist"}' }
        : { status: 200, text: SORT_REPLY };
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      const { input, instructions } = JSON.parse(init.body as string) as { input: string; instructions: string };
      const { status, text } = respond(input, instructions);
      const body = status === 200 ? { output_text: text, usage: { input_tokens: 50, output_tokens: 10 } } : { error: { message: text } };
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;
    app = createApp({ db, vaultDir: vault.path, fetch: fakeFetch, loginLimit: 1000 });
    ({ headers, orgId } = await signIn("org a"));
    await addConnection(headers);
  });
  afterEach(async () => {
    await app.sorter.idle();
    db.close();
    vault.remove();
  });

  async function signIn(passphrase: string): Promise<{ headers: Headers; orgId: string }> {
    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passphrase }),
    });
    const { org } = (await res.json()) as { org: { id: string } };
    return { headers: { cookie: res.headers.getSetCookie()[0]!.split(";")[0]!, "content-type": "application/json" }, orgId: org.id };
  }

  const call = (h: Headers, method: string, path: string, body?: unknown) =>
    app.request(path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });

  async function addConnection(h: Headers): Promise<string> {
    const res = await call(h, "POST", "/api/ai-profiles", { name: "Fake", url: "https://fake.example/v1", model: "m", apiKey: "key-1234567890" });
    return ((await res.json()) as { id: string }).id;
  }

  async function captureAndSort(text = "kyoto, dentist, misc"): Promise<CaptureView> {
    await call(headers, "POST", "/api/captures", { text });
    await app.sorter.idle();
    return ((await (await call(headers, "GET", "/api/captures")).json()) as { captures: CaptureView[] }).captures[0]!;
  }

  const pending = async (h = headers) => ((await (await call(h, "GET", "/api/pending")).json()) as { items: PendingItem[] }).items;
  const notesOnDisk = () =>
    readdirSync(join(vault.path, orgId), { recursive: true })
      .map(String)
      .filter((f) => f.endsWith(".md") && !f.startsWith("_archive"))
      .sort();

  it("stores confident pieces and holds unsure ones in Pending without writing them", async () => {
    const view = await captureAndSort();
    expect(view).toMatchObject({ status: "filed", pendingCount: 2 });
    expect(view.pieces.map((p) => p.title)).toEqual(["Kyoto"]);
    expect(notesOnDisk()).toEqual(["Travel/Japan/Kyoto.md"]);

    const items = await pending();
    expect(items.map((item) => [item.title, item.question, item.choices])).toEqual([
      ["Dentist", "Is this for you or your kid?", ["Personal/Health", "Family/Kids"]],
      ["Misc", null, ["Inbox"]],
    ]);
    expect(items[0]).toMatchObject({ capturePreview: "kyoto, dentist, misc", body: "Dentist Thursday 4pm", suggestedTopic: "Personal/Health" });
  });

  it("files a piece into the chosen topic", async () => {
    await captureAndSort();
    const [dentist] = await pending();
    const res = await call(headers, "POST", `/api/pending/${dentist!.id}/choose`, { topic: "Family/Kids" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ title: "Dentist", topic: "Family/Kids", newTopic: true });
    expect(notesOnDisk()).toContain("Family/Kids/Dentist.md");
    expect((await pending()).map((item) => item.title)).toEqual(["Misc"]);

    const [view] = ((await (await call(headers, "GET", "/api/captures")).json()) as { captures: CaptureView[] }).captures;
    expect(view).toMatchObject({ pendingCount: 1 });
    expect(view!.pieces.map((p: Piece) => p.title)).toEqual(["Kyoto", "Dentist"]);
  });

  it("cleans a typed topic path like any other", async () => {
    await captureAndSort();
    const [dentist] = await pending();
    const piece = (await (await call(headers, "POST", `/api/pending/${dentist!.id}/choose`, { topic: "../../escape" })).json()) as Piece;
    expect(piece.topic).toBe("escape");
    expect(readdirSync(vault.path)).toEqual([orgId]);
  });

  it("files a piece from an answer in the user's own words, and counts the tokens", async () => {
    const before = await captureAndSort();
    const [dentist] = await pending();
    const res = await call(headers, "POST", `/api/pending/${dentist!.id}/answer`, { answer: "it's for my son" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ title: "Son's dentist", topic: "Family/Kids" });
    expect(notesOnDisk()).toContain("Family/Kids/Son's dentist.md");
    const [after] = ((await (await call(headers, "GET", "/api/captures")).json()) as { captures: CaptureView[] }).captures;
    expect(after!.inputTokens - before.inputTokens).toBe(50);
  });

  it("keeps the piece in Pending when the AI call for an answer fails", async () => {
    await captureAndSort();
    const [dentist] = await pending();
    respond = () => ({ status: 500, text: "Server overloaded" });
    const res = await call(headers, "POST", `/api/pending/${dentist!.id}/answer`, { answer: "mine" });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ message: "500: Server overloaded" });
    expect(await pending()).toHaveLength(2);
  });

  it("needs an AI connection to understand an answer, but not to choose", async () => {
    await captureAndSort();
    const profiles = ((await (await call(headers, "GET", "/api/ai-profiles")).json()) as { profiles: { id: string }[] }).profiles;
    await call(headers, "DELETE", `/api/ai-profiles/${profiles[0]!.id}`);
    const [dentist, misc] = await pending();
    expect((await call(headers, "POST", `/api/pending/${dentist!.id}/answer`, { answer: "mine" })).status).toBe(409);
    expect((await call(headers, "POST", `/api/pending/${misc!.id}/choose`, { topic: "Inbox" })).status).toBe(200);
  });

  it("drops a piece with Don't save, keeping the original", async () => {
    await captureAndSort();
    const [, misc] = await pending();
    expect((await call(headers, "DELETE", `/api/pending/${misc!.id}`)).status).toBe(204);
    expect((await pending()).map((item) => item.title)).toEqual(["Dentist"]);
    expect(existsSync(join(vault.path, orgId, "_archive"))).toBe(true);
  });

  it("files a piece only once when two choices arrive together", async () => {
    await captureAndSort();
    const [dentist] = await pending();
    const results = await Promise.all([
      call(headers, "POST", `/api/pending/${dentist!.id}/choose`, { topic: "Family/Kids" }),
      call(headers, "POST", `/api/pending/${dentist!.id}/choose`, { topic: "Personal/Health" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(notesOnDisk().filter((f) => f.endsWith("Dentist.md"))).toHaveLength(1);
  });

  it("clears Pending when the capture is undone", async () => {
    const view = await captureAndSort();
    await call(headers, "POST", `/api/captures/${view.id}/undo`);
    expect(await pending()).toEqual([]);
    expect(notesOnDisk()).toEqual([]);
  });

  it("rejects empty choices and answers", async () => {
    await captureAndSort();
    const [dentist] = await pending();
    expect((await call(headers, "POST", `/api/pending/${dentist!.id}/choose`, { topic: " " })).status).toBe(400);
    expect((await call(headers, "POST", `/api/pending/${dentist!.id}/answer`, { answer: "" })).status).toBe(400);
  });

  it("keeps each org's Pending separate", async () => {
    await captureAndSort();
    const [dentist] = await pending();
    const other = await signIn("org b");
    expect(await pending(other.headers)).toEqual([]);
    expect((await call(other.headers, "POST", `/api/pending/${dentist!.id}/choose`, { topic: "x" })).status).toBe(404);
    expect((await call(other.headers, "POST", `/api/pending/${dentist!.id}/answer`, { answer: "x" })).status).toBe(404);
    expect((await call(other.headers, "DELETE", `/api/pending/${dentist!.id}`)).status).toBe(404);
  });
});
