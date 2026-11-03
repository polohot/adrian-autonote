import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, type App } from "../app.ts";
import { openDatabase } from "../db.ts";
import { tempDir } from "../testing.ts";
import type { CaptureView } from "./store.ts";

type Headers = Record<string, string>;
type Respond = (input: string, instructions: string) => { status: number; text: string };

const pieces = (...items: { title: string; body: string; topic: string; confidence?: number }[]) =>
  JSON.stringify({ pieces: items.map((item) => ({ confidence: 0.9, ...item })) });

describe("capture and sorting routes", () => {
  let db: DatabaseSync;
  let vault: ReturnType<typeof tempDir>;
  let app: App;
  let respond: Respond;
  let providerCalls: number;

  beforeEach(() => {
    db = openDatabase(":memory:");
    vault = tempDir("vault");
    providerCalls = 0;
    respond = () => ({ status: 200, text: pieces({ title: "Note", body: "Body", topic: "Inbox" }) });
    app = makeApp();
  });
  afterEach(async () => {
    await app.sorter.idle();
    db.close();
    vault.remove();
  });

  function makeApp(): App {
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      providerCalls++;
      const { input, instructions } = JSON.parse(init.body as string) as { input: string; instructions: string };
      const { status, text } = respond(input, instructions);
      const body = status === 200 ? { output_text: text, usage: { input_tokens: 50, output_tokens: 10 } } : { error: { message: text } };
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;
    return createApp({ db, vaultDir: vault.path, fetch: fakeFetch, loginLimit: 1000, now: () => Date.UTC(2026, 10, 3, 8, 40) });
  }

  async function signIn(passphrase: string): Promise<{ headers: Headers; orgId: string }> {
    const res = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passphrase }),
    });
    const { org } = (await res.json()) as { org: { id: string } };
    return { headers: { cookie: res.headers.getSetCookie()[0]!.split(";")[0]!, "content-type": "application/json" }, orgId: org.id };
  }

  const call = (headers: Headers, method: string, path: string, body?: unknown) =>
    app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

  async function addConnection(headers: Headers): Promise<void> {
    const res = await call(headers, "POST", "/api/ai-profiles", {
      name: "Fake",
      url: "https://fake.example/v1",
      model: "m",
      apiKey: "key-1234567890",
    });
    expect(res.status).toBe(201);
  }

  async function capture(headers: Headers, text: string, language = "en-US"): Promise<CaptureView> {
    const res = await call(headers, "POST", "/api/captures", { text, language });
    expect(res.status).toBe(201);
    return (await res.json()) as CaptureView;
  }

  async function feed(headers: Headers): Promise<{ hasConnection: boolean; captures: CaptureView[] }> {
    await app.sorter.idle();
    return (await (await call(headers, "GET", "/api/captures")).json()) as { hasConnection: boolean; captures: CaptureView[] };
  }

  const vaultFile = (orgId: string, path: string) => join(vault.path, orgId, path);
  const archiveFiles = (orgId: string) => readdirSync(join(vault.path, orgId, "_archive/2026/11"));

  it("needs a session", async () => {
    expect((await app.request("/api/captures")).status).toBe(401);
  });

  it("keeps the original and waits when there is no AI connection, then sorts once one is added", async () => {
    const { headers, orgId } = await signIn("org a");
    const saved = await capture(headers, "Kyoto temples in spring");
    expect(saved).toMatchObject({ status: "waiting", preview: "Kyoto temples in spring", pieces: [] });

    const waiting = await feed(headers);
    expect(waiting.hasConnection).toBe(false);
    expect(waiting.captures[0]!.status).toBe("waiting");
    expect(providerCalls).toBe(0);

    const [archiveName] = archiveFiles(orgId);
    expect(archiveName).toMatch(/^2026-11-03 \d{4} [0-9a-f]{8}\.md$/);
    expect(readFileSync(join(vault.path, orgId, "_archive/2026/11", archiveName!), "utf8")).toContain("Kyoto temples in spring");

    respond = () => ({ status: 200, text: pieces({ title: "Kyoto temples", body: "Visit in spring.", topic: "Travel/Japan" }) });
    await addConnection(headers);
    const sorted = await feed(headers);
    expect(sorted.hasConnection).toBe(true);
    expect(sorted.captures[0]).toMatchObject({
      status: "filed",
      inputTokens: 50,
      outputTokens: 10,
      pieces: [{ title: "Kyoto temples", topic: "Travel/Japan", newTopic: true, confidence: 0.9 }],
    });
  });

  it("splits a capture into notes in topic folders, with frontmatter and a link to the original", async () => {
    const { headers, orgId } = await signIn("org a");
    await addConnection(headers);
    respond = (input) => {
      expect(input).toContain("EXISTING TOPICS:\n(none yet)");
      return {
        status: 200,
        text: pieces(
          { title: "Kyoto temples", body: "Kinkaku-ji in spring.", topic: "Travel/Japan" },
          { title: "Groceries", body: "Milk and eggs", topic: "Shopping", confidence: 0.85 },
        ),
      };
    };
    await capture(headers, "Kyoto: Kinkaku-ji in spring\n\nbuy milk and eggs");
    const [view] = (await feed(headers)).captures;
    expect(view!.pieces.map((p) => [p.title, p.topic, p.newTopic, p.confidence])).toEqual([
      ["Kyoto temples", "Travel/Japan", true, 0.9],
      ["Groceries", "Shopping", true, 0.85],
    ]);

    const markdown = readFileSync(vaultFile(orgId, "Travel/Japan/Kyoto temples.md"), "utf8");
    const archiveLink = `_archive/2026/11/${archiveFiles(orgId)[0]!.replace(/\.md$/, "")}`;
    expect(markdown).toContain('title: "Kyoto temples"');
    expect(markdown).toContain('topic: "Travel/Japan"');
    expect(markdown).toContain(`source: "[[${archiveLink}]]"`);
    expect(markdown).toMatch(/---\n\nKinkaku-ji in spring\.\n$/);

    const note = (await (await call(headers, "GET", `/api/notes/${view!.pieces[0]!.noteId}`)).json()) as Record<string, string>;
    expect(note).toMatchObject({ title: "Kyoto temples", topic: "Travel/Japan", markdown });
  });

  it("reuses existing topics (ignoring case) and never overwrites a note with the same title", async () => {
    const { headers, orgId } = await signIn("org a");
    await addConnection(headers);
    respond = () => ({ status: 200, text: pieces({ title: "Kyoto", body: "First", topic: "Travel/Japan" }) });
    await capture(headers, "first");
    await feed(headers);

    respond = (input) => {
      expect(input).toContain("EXISTING TOPICS:\n- Travel/Japan");
      return { status: 200, text: pieces({ title: "Kyoto", body: "Second", topic: "travel/JAPAN" }) };
    };
    await capture(headers, "second");
    const [latest] = (await feed(headers)).captures;
    expect(latest!.pieces[0]).toMatchObject({ topic: "Travel/Japan", newTopic: false });
    expect(readFileSync(vaultFile(orgId, "Travel/Japan/Kyoto.md"), "utf8")).toContain("First");
    expect(readFileSync(vaultFile(orgId, "Travel/Japan/Kyoto 2.md"), "utf8")).toContain("Second");
  });

  it("keeps every file inside the vault even when the model suggests an escaping path", async () => {
    const { headers, orgId } = await signIn("org a");
    await addConnection(headers);
    respond = () => ({ status: 200, text: pieces({ title: "../../evil", body: "x", topic: "../../../escape" }) });
    await capture(headers, "x");
    const [view] = (await feed(headers)).captures;
    expect(view!.pieces[0]!.topic).toBe("escape");
    expect(existsSync(vaultFile(orgId, "escape/evil.md"))).toBe(true);
    expect(readdirSync(vault.path)).toEqual([orgId]);
  });

  it("undo removes the notes and the empty folders it created, but keeps the original and shared topics", async () => {
    const { headers, orgId } = await signIn("org a");
    await addConnection(headers);
    respond = () => ({ status: 200, text: pieces({ title: "Milk", body: "Milk", topic: "Shopping" }) });
    await capture(headers, "milk");
    await feed(headers);

    respond = () => ({
      status: 200,
      text: pieces({ title: "Kyoto", body: "Kyoto", topic: "Travel/Japan" }, { title: "Eggs", body: "Eggs", topic: "Shopping" }),
    });
    const second = await capture(headers, "kyoto and eggs");
    await feed(headers);
    expect(existsSync(vaultFile(orgId, "Travel/Japan/Kyoto.md"))).toBe(true);

    const res = await call(headers, "POST", `/api/captures/${second.id}/undo`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "undone", pieces: [] });
    expect(existsSync(vaultFile(orgId, "Travel"))).toBe(false);
    expect(existsSync(vaultFile(orgId, "Shopping/Eggs.md"))).toBe(false);
    expect(existsSync(vaultFile(orgId, "Shopping/Milk.md"))).toBe(true);
    expect(archiveFiles(orgId)).toHaveLength(2);

    respond = (input) => {
      expect(input).toContain("- Shopping");
      expect(input).not.toContain("Travel/Japan");
      return { status: 200, text: pieces({ title: "Later", body: "Later", topic: "Shopping" }) };
    };
    await capture(headers, "later");
    await feed(headers);

    expect((await call(headers, "POST", `/api/captures/${second.id}/undo`)).status).toBe(409);
  });

  it("shows the provider's error and sorts on retry", async () => {
    const { headers } = await signIn("org a");
    await addConnection(headers);
    respond = () => ({ status: 401, text: "Invalid API key" });
    const saved = await capture(headers, "note");
    expect((await feed(headers)).captures[0]).toMatchObject({ status: "failed", error: "401: Invalid API key" });

    respond = () => ({ status: 200, text: pieces({ title: "Note", body: "note", topic: "Inbox" }) });
    expect((await call(headers, "POST", `/api/captures/${saved.id}/retry`)).status).toBe(200);
    expect((await feed(headers)).captures[0]!.status).toBe("filed");
    expect((await call(headers, "POST", `/api/captures/${saved.id}/retry`)).status).toBe(409);
  });

  it("fails after two unusable replies and records tokens from both calls", async () => {
    const { headers } = await signIn("org a");
    await addConnection(headers);
    respond = () => ({ status: 200, text: "Sorry, I can't do that." });
    await capture(headers, "note");
    const [view] = (await feed(headers)).captures;
    expect(view).toMatchObject({ status: "failed", inputTokens: 100, outputTokens: 20 });
    expect(view!.error).toMatch(/could not be used twice/);
    expect(providerCalls).toBe(2);
  });

  it("asks for new topic names in the browser's language and ignores invalid language tags", async () => {
    const { headers } = await signIn("org a");
    await addConnection(headers);
    const seen: string[] = [];
    respond = (_input, instructions) => {
      seen.push(instructions);
      return { status: 200, text: pieces({ title: "สวัสดี", body: "สวัสดี", topic: "ทั่วไป" }) };
    };
    await capture(headers, "สวัสดี", "th-TH");
    await capture(headers, "hello", "<script>");
    await feed(headers);
    expect(seen[0]).toContain("named in Thai (Thailand)");
    expect(seen[1]).toContain("named in English");
  });

  it("rejects empty and oversized captures", async () => {
    const { headers } = await signIn("org a");
    expect((await call(headers, "POST", "/api/captures", { text: "   " })).status).toBe(400);
    expect((await call(headers, "POST", "/api/captures", { text: "x".repeat(100_001) })).status).toBe(400);
  });

  it("keeps each org's captures and notes separate", async () => {
    const orgA = await signIn("org a");
    const orgB = await signIn("org b");
    await addConnection(orgA.headers);
    const saved = await capture(orgA.headers, "private");
    const [view] = (await feed(orgA.headers)).captures;

    expect((await feed(orgB.headers)).captures).toEqual([]);
    expect((await call(orgB.headers, "POST", `/api/captures/${saved.id}/undo`)).status).toBe(404);
    expect((await call(orgB.headers, "POST", `/api/captures/${saved.id}/retry`)).status).toBe(404);
    expect((await call(orgB.headers, "GET", `/api/notes/${view!.pieces[0]!.noteId}`)).status).toBe(404);
  });

  it("picks up captures that were mid-sort when the server stopped", async () => {
    const { headers } = await signIn("org a");
    await addConnection(headers);
    respond = () => ({ status: 200, text: pieces({ title: "Note", body: "note", topic: "Inbox" }) });
    const saved = await capture(headers, "note");
    await app.sorter.idle();
    db.prepare("UPDATE captures SET status = 'sorting' WHERE id = ?").run(saved.id);
    db.prepare("DELETE FROM notes").run();

    app = makeApp();
    app.sorter.resumeUnfinished();
    expect((await feed(headers)).captures[0]!.status).toBe("filed");
  });
});
