export type ApiKind = "responses" | "chat-completions";

export interface ResolvedEndpoint {
  url: string;
  api: ApiKind;
}

const API_PATHS: Record<ApiKind, string> = {
  responses: "/responses",
  "chat-completions": "/chat/completions",
};

const AZURE_HOST = /\.(openai\.azure\.com|services\.ai\.azure\.com|cognitiveservices\.azure\.com)$/i;

/**
 * Turns what the user typed into the Settings URL field into the exact API URL.
 * Accepts a full endpoint (".../responses", ".../chat/completions") or a base URL
 * (".../openai/v1", ".../v1"). A bare Azure resource URL gets "/openai/v1" added.
 */
export function resolveEndpoint(input: string, preferredApi: ApiKind = "responses"): ResolvedEndpoint {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new Error(`Not a valid URL: "${input}"`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`URL must start with https:// or http://, got "${parsed.protocol}"`);
  }

  const path = parsed.pathname.replace(/\/+$/, "");

  for (const [api, apiPath] of Object.entries(API_PATHS) as [ApiKind, string][]) {
    if (path.endsWith(apiPath)) {
      parsed.pathname = path;
      return { url: parsed.toString(), api };
    }
  }

  const basePath = path === "" && AZURE_HOST.test(parsed.hostname) ? "/openai/v1" : path;
  parsed.pathname = basePath + API_PATHS[preferredApi];
  return { url: parsed.toString(), api: preferredApi };
}
