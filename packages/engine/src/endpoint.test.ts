import { describe, expect, it } from "vitest";
import { resolveEndpoint } from "./endpoint.ts";

describe("resolveEndpoint", () => {
  it("keeps a full Responses endpoint as-is", () => {
    expect(resolveEndpoint("https://example.services.ai.azure.com/openai/v1/responses")).toEqual({
      url: "https://example.services.ai.azure.com/openai/v1/responses",
      api: "responses",
    });
  });

  it("keeps a full Chat Completions endpoint and detects its API", () => {
    expect(resolveEndpoint("http://localhost:11434/v1/chat/completions")).toEqual({
      url: "http://localhost:11434/v1/chat/completions",
      api: "chat-completions",
    });
  });

  it("appends the preferred API to a base URL, with or without a trailing slash", () => {
    const expected = { url: "https://example.openai.azure.com/openai/v1/responses", api: "responses" };
    expect(resolveEndpoint("https://example.openai.azure.com/openai/v1/")).toEqual(expected);
    expect(resolveEndpoint("https://example.openai.azure.com/openai/v1")).toEqual(expected);
  });

  it("uses Chat Completions for a base URL when asked", () => {
    expect(resolveEndpoint("https://openrouter.ai/api/v1", "chat-completions")).toEqual({
      url: "https://openrouter.ai/api/v1/chat/completions",
      api: "chat-completions",
    });
  });

  it("adds /openai/v1 to a bare Azure resource URL", () => {
    expect(resolveEndpoint("https://example.services.ai.azure.com/").url).toBe(
      "https://example.services.ai.azure.com/openai/v1/responses",
    );
  });

  it("does not guess a path for a bare non-Azure URL", () => {
    expect(resolveEndpoint("http://localhost:1234").url).toBe("http://localhost:1234/responses");
  });

  it("trims surrounding whitespace and trailing slashes on full endpoints", () => {
    expect(resolveEndpoint("  https://example.openai.azure.com/openai/v1/responses/  ").url).toBe(
      "https://example.openai.azure.com/openai/v1/responses",
    );
  });

  it("keeps query parameters such as api-version", () => {
    expect(
      resolveEndpoint("https://example.openai.azure.com/openai/deployments/x/chat/completions?api-version=2024-10-21"),
    ).toEqual({
      url: "https://example.openai.azure.com/openai/deployments/x/chat/completions?api-version=2024-10-21",
      api: "chat-completions",
    });
  });

  it("rejects text that is not a URL", () => {
    expect(() => resolveEndpoint("not a url")).toThrow(/Not a valid URL/);
  });

  it("rejects non-HTTP schemes", () => {
    expect(() => resolveEndpoint("ftp://example.com/v1")).toThrow(/https:\/\/ or http:\/\//);
  });
});
