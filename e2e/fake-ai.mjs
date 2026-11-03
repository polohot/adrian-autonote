// A tiny OpenAI-compatible provider for browser tests. Keys starting with "good-key" are accepted.
import { createServer } from "node:http";

const PORT = Number(process.env.FAKE_AI_PORT ?? 3199);

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true });
  if (req.method !== "POST") return send(res, 404, { error: { message: "Not found" } });

  const key = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  if (!key.startsWith("good-key")) return send(res, 401, { error: { message: "Invalid API key" } });

  if (req.url === "/v1/responses") {
    return send(res, 200, {
      output: [{ type: "message", content: [{ type: "output_text", text: "OK" }] }],
      usage: { input_tokens: 8, output_tokens: 1 },
    });
  }
  if (req.url === "/v1/chat/completions") {
    return send(res, 200, { choices: [{ message: { content: "OK" } }], usage: { prompt_tokens: 8, completion_tokens: 1 } });
  }
  return send(res, 404, { error: { message: `Unknown path ${req.url}` } });
}).listen(PORT, "127.0.0.1");
