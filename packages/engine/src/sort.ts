import type { GenerateRequest, GenerateResult } from "./ai.ts";
import { resolveTopic } from "./markdown.ts";

export interface SortedPiece {
  title: string;
  body: string;
  topic: string;
  /** 0 to 1. */
  confidence: number;
}

export interface SortResult {
  pieces: SortedPiece[];
  usage: { inputTokens: number; outputTokens: number };
}

export interface SortOptions {
  /** BCP 47 tag such as "th-TH"; new topic names use this language. */
  language?: string;
}

export class SortReplyError extends Error {}

export type Usage = SortResult["usage"];

/** Errors thrown by sortCapture carry the tokens spent before failing, so cost tracking stays complete. */
export function usageOf(err: unknown): Usage | undefined {
  return (err as { usage?: Usage } | null)?.usage;
}

const MAX_PIECES = 20;
export const MAX_TOPICS_IN_PROMPT = 200;

export function languageName(tag: string | undefined): string {
  if (!tag) return "English";
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(tag) ?? "English";
  } catch {
    return "English";
  }
}

export function sortInstructions(language: string | undefined): string {
  return `You sort captures from a personal note-taking inbox into topics.

Split the capture into pieces: one piece per distinct subject. Do not split text that is about one subject.
For each piece:
- "title": a short, specific title in the same language as the piece.
- "body": the piece's text, lightly cleaned up (fix obvious typos and formatting). Keep every fact, keep the original language, keep Markdown.
- "topic": the folder path the note belongs in, with levels separated by "/" (for example "Travel/Japan"). Reuse one of the EXISTING TOPICS whenever one fits. Otherwise create a new path of 1 to 3 levels, broad first, named in ${languageName(language)}.
- "confidence": a number from 0 to 1 for how sure you are about the topic.

Reply with JSON only, no other text, in exactly this shape:
{"pieces":[{"title":"...","body":"...","topic":"...","confidence":0.9}]}`;
}

export function sortInput(text: string, existingTopics: readonly string[]): string {
  const topics = existingTopics.slice(0, MAX_TOPICS_IN_PROMPT);
  const topicList = topics.length > 0 ? topics.map((topic) => `- ${topic}`).join("\n") : "(none yet)";
  return `EXISTING TOPICS:\n${topicList}\n\nCAPTURE:\n<<<\n${text}\n>>>`;
}

/** Parses and validates the model's reply. Throws SortReplyError with a message the model can act on. */
export function parseSortReply(reply: string, existingTopics: readonly string[]): SortedPiece[] {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start === -1 || end <= start) throw new SortReplyError("The reply contained no JSON object.");

  let json: unknown;
  try {
    json = JSON.parse(reply.slice(start, end + 1));
  } catch (err) {
    throw new SortReplyError(`The reply was not valid JSON (${(err as Error).message}).`);
  }

  const pieces = (json as { pieces?: unknown }).pieces;
  if (!Array.isArray(pieces) || pieces.length === 0) {
    throw new SortReplyError('The reply needs a non-empty "pieces" array.');
  }
  if (pieces.length > MAX_PIECES) throw new SortReplyError(`The reply had more than ${MAX_PIECES} pieces.`);

  return pieces.map((piece: unknown, index) => {
    const { title, body, topic, confidence } = (piece ?? {}) as Record<string, unknown>;
    if (typeof body !== "string" || body.trim() === "") {
      throw new SortReplyError(`Piece ${index + 1} needs a non-empty "body" string.`);
    }
    const cleanTitle = typeof title === "string" ? title.replace(/^#+\s*/, "").trim().slice(0, 120) : "";
    return {
      title: cleanTitle || body.trim().split("\n")[0]!.slice(0, 60),
      body: body.trim(),
      topic: resolveTopic(typeof topic === "string" ? topic : "", existingTopics),
      confidence: typeof confidence === "number" && Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
    };
  });
}

/** One AI call per capture; one retry when the reply can't be used. */
export async function sortCapture(
  text: string,
  existingTopics: readonly string[],
  generate: (request: GenerateRequest) => Promise<GenerateResult>,
  { language }: SortOptions = {},
): Promise<SortResult> {
  const instructions = sortInstructions(language);
  const input = sortInput(text, existingTopics);
  const usage = { inputTokens: 0, outputTokens: 0 };
  const call = async (request: GenerateRequest) => {
    const result = await generate(request);
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    return result.text;
  };

  try {
    const first = await call({ instructions, input });
    try {
      return { pieces: parseSortReply(first, existingTopics), usage };
    } catch (err) {
      if (!(err instanceof SortReplyError)) throw err;
      const retryInput = `${input}\n\nYour previous reply could not be used: ${err.message} Reply again with JSON only.`;
      const second = await call({ instructions, input: retryInput });
      try {
        return { pieces: parseSortReply(second, existingTopics), usage };
      } catch (retryErr) {
        if (retryErr instanceof SortReplyError) {
          throw new SortReplyError(`The model's reply could not be used twice: ${retryErr.message}`);
        }
        throw retryErr;
      }
    }
  } catch (err) {
    throw err instanceof Error ? Object.assign(err, { usage }) : err;
  }
}
