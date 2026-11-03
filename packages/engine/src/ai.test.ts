import { describe, expect, it } from "vitest";
import { AiError, generateText, type ModelConnection } from "./ai.ts";

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function fakeFetch(status: number, response: unknown, captured: Captured[] = []): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    captured.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string) as Record<string, unknown>,
    });
    const text = typeof response === "string" ? response : JSON.stringify(response);
    return new Response(text, { status });
  }) as typeof fetch;
}

const failingFetch = (error: unknown): typeof fetch => (async () => Promise.reject(error)) as typeof fetch;

const azure: ModelConnection = {
  url: "https://example.services.ai.azure.com/openai/v1/responses",
  api: "auto",
  apiKey: "secret-key",
  model: "my-deployment",
};

const responsesBody = {
  output: [
    { type: "reasoning", summary: [] },
    { type: "message", content: [{ type: "output_text", text: "Hello " }, { type: "output_text", text: "there" }] },
  ],
  usage: { input_tokens: 12, output_tokens: 3 },
};

describe("generateText", () => {
  it("calls the Responses API and joins the output text", async () => {
    const captured: Captured[] = [];
    const result = await generateText(azure, { instructions: "Be brief.", input: "Hi" }, { fetch: fakeFetch(200, responsesBody, captured) });

    expect(result).toEqual({ text: "Hello there", usage: { inputTokens: 12, outputTokens: 3 } });
    expect(captured[0]!.url).toBe(azure.url);
    expect(captured[0]!.body).toEqual({ model: "my-deployment", input: "Hi", instructions: "Be brief." });
  });

  it("sends Bearer auth everywhere and an api-key header only to Azure", async () => {
    const azureCalls: Captured[] = [];
    await generateText(azure, { input: "Hi" }, { fetch: fakeFetch(200, responsesBody, azureCalls) });
    expect(azureCalls[0]!.headers).toMatchObject({ authorization: "Bearer secret-key", "api-key": "secret-key" });

    const otherCalls: Captured[] = [];
    await generateText({ ...azure, url: "https://openrouter.ai/api/v1" }, { input: "Hi" }, { fetch: fakeFetch(200, responsesBody, otherCalls) });
    expect(otherCalls[0]!.headers.authorization).toBe("Bearer secret-key");
    expect(otherCalls[0]!.headers["api-key"]).toBeUndefined();
  });

  it("sends no auth headers when the key is empty", async () => {
    const captured: Captured[] = [];
    await generateText({ ...azure, url: "http://localhost:11434/v1", apiKey: "" }, { input: "Hi" }, { fetch: fakeFetch(200, responsesBody, captured) });
    expect(captured[0]!.headers.authorization).toBeUndefined();
  });

  it("calls Chat Completions with system and user messages", async () => {
    const captured: Captured[] = [];
    const result = await generateText(
      { ...azure, url: "http://localhost:1234/v1", api: "chat-completions" },
      { instructions: "Be brief.", input: "Hi" },
      { fetch: fakeFetch(200, { choices: [{ message: { content: "OK" } }], usage: { prompt_tokens: 5, completion_tokens: 1 } }, captured) },
    );
    expect(result).toEqual({ text: "OK", usage: { inputTokens: 5, outputTokens: 1 } });
    expect(captured[0]!.url).toBe("http://localhost:1234/v1/chat/completions");
    expect(captured[0]!.body).toEqual({
      model: "my-deployment",
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "Hi" },
      ],
    });
  });

  it("accepts the output_text shortcut some providers return", async () => {
    const result = await generateText(azure, { input: "Hi" }, { fetch: fakeFetch(200, { output_text: "OK" }) });
    expect(result.text).toBe("OK");
  });

  it("reports the provider's error message with the status", async () => {
    const fetch = fakeFetch(401, { error: { code: "401", message: "Access denied due to invalid subscription key." } });
    const error = await generateText(azure, { input: "Hi" }, { fetch }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(AiError);
    expect(error).toMatchObject({ message: "401: Access denied due to invalid subscription key.", status: 401 });
  });

  it("reports plain-text error bodies", async () => {
    await expect(generateText(azure, { input: "Hi" }, { fetch: fakeFetch(502, "Bad gateway") })).rejects.toThrow("502: Bad gateway");
  });

  it("fails clearly when the model returns no text", async () => {
    await expect(generateText(azure, { input: "Hi" }, { fetch: fakeFetch(200, { output: [] }) })).rejects.toThrow(
      "The model returned no text",
    );
  });

  it("explains common network failures", async () => {
    const withCode = (code: string) => Object.assign(new TypeError("fetch failed"), { cause: { code } });
    await expect(generateText(azure, { input: "Hi" }, { fetch: failingFetch(withCode("ENOTFOUND")) })).rejects.toThrow(
      "Server not found",
    );
    await expect(
      generateText(azure, { input: "Hi" }, { fetch: failingFetch(withCode("SELF_SIGNED_CERT_IN_CHAIN")) }),
    ).rejects.toThrow(/NODE_EXTRA_CA_CERTS/);
    const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    await expect(generateText(azure, { input: "Hi" }, { fetch: failingFetch(timeout), timeoutMs: 5000 })).rejects.toThrow(
      "No answer within 5 seconds",
    );
  });
});
