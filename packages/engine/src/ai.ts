import { isAzureHost, resolveEndpoint, type ApiKind } from "./endpoint.ts";

/** "auto" uses the API in a full endpoint URL, and the Responses API for a base URL. */
export type ApiStyle = ApiKind | "auto";

export interface ModelConnection {
  url: string;
  api: ApiStyle;
  /** May be empty for local servers such as Ollama or LM Studio. */
  apiKey: string;
  model: string;
}

export interface GenerateRequest {
  instructions?: string;
  input: string;
}

export interface GenerateResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface GenerateOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export async function generateText(
  connection: ModelConnection,
  request: GenerateRequest,
  { fetch: doFetch = fetch, timeoutMs = 60_000 }: GenerateOptions = {},
): Promise<GenerateResult> {
  const endpoint = resolveEndpoint(connection.url, connection.api === "auto" ? "responses" : connection.api);

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (connection.apiKey) {
    headers.authorization = `Bearer ${connection.apiKey}`;
    if (isAzureHost(new URL(endpoint.url).hostname)) headers["api-key"] = connection.apiKey;
  }

  const body =
    endpoint.api === "responses"
      ? { model: connection.model, input: request.input, ...(request.instructions && { instructions: request.instructions }) }
      : {
          model: connection.model,
          messages: [
            ...(request.instructions ? [{ role: "system", content: request.instructions }] : []),
            { role: "user", content: request.input },
          ],
        };

  let res: Response;
  try {
    res = await doFetch(endpoint.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new AiError(networkErrorMessage(err, timeoutMs));
  }

  const raw = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    // Some errors come back as plain text or HTML.
  }

  if (!res.ok) {
    const detail = providerMessage(json) ?? (raw.trim().slice(0, 200) || res.statusText);
    throw new AiError(`${res.status}: ${detail}`, res.status);
  }
  return endpoint.api === "responses" ? parseResponses(json) : parseChatCompletion(json);
}

function networkErrorMessage(err: unknown, timeoutMs: number): string {
  if (err instanceof Error && err.name === "TimeoutError") return `No answer within ${timeoutMs / 1000} seconds`;
  const code = (err as { cause?: { code?: string } }).cause?.code;
  switch (code) {
    case "ENOTFOUND":
      return "Server not found: check the URL";
    case "ECONNREFUSED":
      return "Connection refused: is the server running?";
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "UNABLE_TO_GET_ISSUER_CERT_LOCALLY":
      return "TLS certificate not trusted. On a company network, set NODE_EXTRA_CA_CERTS to the company root certificate";
    default:
      return `Could not connect: ${code ?? (err instanceof Error ? err.message : String(err))}`;
  }
}

function providerMessage(json: unknown): string | undefined {
  const error = (json as { error?: unknown } | null)?.error;
  if (typeof error === "string") return error;
  const message = (error as { message?: unknown } | undefined)?.message;
  return typeof message === "string" ? message : undefined;
}

interface ResponsesBody {
  output_text?: string;
  output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

function parseResponses(json: unknown): GenerateResult {
  const body = (json ?? {}) as ResponsesBody;
  const text =
    typeof body.output_text === "string"
      ? body.output_text
      : (body.output ?? [])
          .filter((item) => item.type === "message")
          .flatMap((item) => item.content ?? [])
          .filter((part) => part.type === "output_text" && typeof part.text === "string")
          .map((part) => part.text)
          .join("");
  if (!text) throw new AiError("The model returned no text");
  return { text, usage: { inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 } };
}

interface ChatCompletionBody {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function parseChatCompletion(json: unknown): GenerateResult {
  const body = (json ?? {}) as ChatCompletionBody;
  const text = body.choices?.[0]?.message?.content;
  if (!text) throw new AiError("The model returned no text");
  return { text, usage: { inputTokens: body.usage?.prompt_tokens ?? 0, outputTokens: body.usage?.completion_tokens ?? 0 } };
}
