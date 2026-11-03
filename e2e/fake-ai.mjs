// A tiny OpenAI-compatible provider for browser tests. Keys starting with "good-key" are accepted.
// Sorting requests are answered deterministically: one piece per paragraph, topic chosen by keyword.
import { createServer } from "node:http";

const PORT = Number(process.env.FAKE_AI_PORT ?? 3199);

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function topicFor(text) {
  if (/kyoto|tokyo|japan|เกียวโต/i.test(text)) return { topic: "Travel/Japan", confidence: 0.92 };
  if (/milk|eggs|bread|นม/i.test(text)) return { topic: "Shopping", confidence: 0.88 };
  return { topic: "Inbox", confidence: 0.4 };
}

function replyText(instructions, input) {
  if (!instructions.includes("You sort captures")) return "OK";
  const capture = input.split("<<<\n")[1]?.split("\n>>>")[0] ?? "";
  if (capture.includes("BROKEN")) return "Sorry, I cannot help with that.";
  const pieces = capture
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => ({ title: paragraph.split(/[.\n]/)[0].slice(0, 40), body: paragraph, ...topicFor(paragraph) }));
  return JSON.stringify({ pieces });
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data ? JSON.parse(data) : {}));
  });
}

createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true });
  if (req.method !== "POST") return send(res, 404, { error: { message: "Not found" } });

  const key = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  if (!key.startsWith("good-key")) return send(res, 401, { error: { message: "Invalid API key" } });

  const body = await readBody(req);
  if (req.url === "/v1/responses") {
    const text = replyText(body.instructions ?? "", String(body.input ?? ""));
    return send(res, 200, {
      output: [{ type: "message", content: [{ type: "output_text", text }] }],
      usage: { input_tokens: 120, output_tokens: 40 },
    });
  }
  if (req.url === "/v1/chat/completions") {
    const messages = body.messages ?? [];
    const instructions = messages.find((m) => m.role === "system")?.content ?? "";
    const input = messages.findLast((m) => m.role === "user")?.content ?? "";
    return send(res, 200, {
      choices: [{ message: { content: replyText(instructions, input) } }],
      usage: { prompt_tokens: 120, completion_tokens: 40 },
    });
  }
  return send(res, 404, { error: { message: `Unknown path ${req.url}` } });
}).listen(PORT, "127.0.0.1");
