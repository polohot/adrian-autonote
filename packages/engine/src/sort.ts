import type { GenerateRequest, GenerateResult } from "./ai.ts";
import { resolveTopic } from "./markdown.ts";

export interface SortedPiece {
  title: string;
  body: string;
  topic: string;
  /** 0 to 1. */
  confidence: number;
  /** The AI's question for the user when it is unsure, otherwise null. */
  question: string | null;
  /** Topic paths the user can pick from, the suggested topic first. Empty when there is no question. */
  choices: string[];
}

export type Usage = { inputTokens: number; outputTokens: number };

export interface SortResult {
  pieces: SortedPiece[];
  usage: Usage;
}

export interface SortOptions {
  /** BCP 47 tag such as "th-TH"; new topic names and questions use this language. */
  language?: string;
}

export type Generate = (request: GenerateRequest) => Promise<GenerateResult>;

export class SortReplyError extends Error {}

/** Errors thrown by the engine's AI calls carry the tokens spent before failing, so cost tracking stays complete. */
export function usageOf(err: unknown): Usage | undefined {
  return (err as { usage?: Usage } | null)?.usage;
}

const MAX_PIECES = 20;
const MAX_CHOICES = 3;
export const MAX_TOPICS_IN_PROMPT = 200;
/** Below this confidence a piece waits for the user even without a question. */
export const UNSURE_BELOW = 0.6;

export const needsReview = (piece: Pick<SortedPiece, "question" | "confidence">) =>
  piece.question !== null || piece.confidence < UNSURE_BELOW;

export function languageName(tag: string | undefined): string {
  if (!tag) return "English";
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(tag) ?? "English";
  } catch {
    return "English";
  }
}

export function sortInstructions(language: string | undefined): string {
  const lang = languageName(language);
  return `You sort captures from a personal note-taking inbox into topics.

Split the capture into pieces: one piece per distinct subject. Do not split text that is about one subject.
For each piece:
- "title": a short, specific title in the same language as the piece.
- "body": the piece's text, lightly cleaned up (fix obvious typos and formatting). Keep every fact, keep the original language, keep Markdown.
- "topic": the folder path the note belongs in, with levels separated by "/" (for example "Travel/Japan"). Reuse one of the EXISTING TOPICS whenever one fits. Otherwise create a new path of 1 to 3 levels, broad first, named in ${lang}.
- "confidence": a number from 0 to 1 for how sure you are about the topic.
- "question": if your confidence is below 0.7, or the right topic depends on something only the user knows (for example whether it is work or personal), a short question for the user in ${lang}. Otherwise null.
- "choices": when you ask a question, 2 or 3 topic paths the user can pick from, your best guess first. Otherwise [].

Reply with JSON only, no other text, in exactly this shape:
{"pieces":[{"title":"...","body":"...","topic":"...","confidence":0.9,"question":null,"choices":[]}]}`;
}

const topicList = (topics: readonly string[]) =>
  topics.length > 0 ? topics.slice(0, MAX_TOPICS_IN_PROMPT).map((topic) => `- ${topic}`).join("\n") : "(none yet)";

export function sortInput(text: string, existingTopics: readonly string[]): string {
  return `EXISTING TOPICS:\n${topicList(existingTopics)}\n\nCAPTURE:\n<<<\n${text}\n>>>`;
}

function parseJsonObject(reply: string): Record<string, unknown> {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start === -1 || end <= start) throw new SortReplyError("The reply contained no JSON object.");
  try {
    return JSON.parse(reply.slice(start, end + 1)) as Record<string, unknown>;
  } catch (err) {
    throw new SortReplyError(`The reply was not valid JSON (${(err as Error).message}).`);
  }
}

function cleanQuestion(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, 300) : null;
}

function cleanChoices(topic: string, question: string | null, value: unknown, existingTopics: readonly string[]): string[] {
  if (question === null) return [];
  const raw = Array.isArray(value) ? value.filter((choice): choice is string => typeof choice === "string") : [];
  const resolved = [topic, ...raw.map((choice) => resolveTopic(choice, existingTopics))];
  return [...new Map(resolved.map((choice) => [choice.toLocaleLowerCase(), choice])).values()].slice(0, MAX_CHOICES);
}

/** Parses and validates the model's reply. Throws SortReplyError with a message the model can act on. */
export function parseSortReply(reply: string, existingTopics: readonly string[]): SortedPiece[] {
  const pieces = parseJsonObject(reply).pieces;
  if (!Array.isArray(pieces) || pieces.length === 0) {
    throw new SortReplyError('The reply needs a non-empty "pieces" array.');
  }
  if (pieces.length > MAX_PIECES) throw new SortReplyError(`The reply had more than ${MAX_PIECES} pieces.`);

  return pieces.map((piece: unknown, index) => {
    const { title, body, topic, confidence, question, choices } = (piece ?? {}) as Record<string, unknown>;
    if (typeof body !== "string" || body.trim() === "") {
      throw new SortReplyError(`Piece ${index + 1} needs a non-empty "body" string.`);
    }
    const cleanTitle = typeof title === "string" ? title.replace(/^#+\s*/, "").trim().slice(0, 120) : "";
    const resolvedTopic = resolveTopic(typeof topic === "string" ? topic : "", existingTopics);
    const cleanedQuestion = cleanQuestion(question);
    return {
      title: cleanTitle || body.trim().split("\n")[0]!.slice(0, 60),
      body: body.trim(),
      topic: resolvedTopic,
      confidence: typeof confidence === "number" && Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
      question: cleanedQuestion,
      choices: cleanChoices(resolvedTopic, cleanedQuestion, choices, existingTopics),
    };
  });
}

/** Calls the model, parses its reply, and asks once more (quoting the problem) when the reply can't be used. */
async function callForJson<T>(generate: Generate, instructions: string, input: string, parse: (reply: string) => T): Promise<{ value: T; usage: Usage }> {
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const call = async (request: GenerateRequest) => {
    const result = await generate(request);
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;
    return result.text;
  };

  try {
    const first = await call({ instructions, input });
    try {
      return { value: parse(first), usage };
    } catch (err) {
      if (!(err instanceof SortReplyError)) throw err;
      const retryInput = `${input}\n\nYour previous reply could not be used: ${err.message} Reply again with JSON only.`;
      const second = await call({ instructions, input: retryInput });
      try {
        return { value: parse(second), usage };
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

/** One AI call per capture; one retry when the reply can't be used. */
export async function sortCapture(
  text: string,
  existingTopics: readonly string[],
  generate: Generate,
  { language }: SortOptions = {},
): Promise<SortResult> {
  const { value, usage } = await callForJson(generate, sortInstructions(language), sortInput(text, existingTopics), (reply) =>
    parseSortReply(reply, existingTopics),
  );
  return { pieces: value, usage };
}

export interface PendingPieceInput {
  title: string;
  body: string;
  question: string | null;
  choices: readonly string[];
}

export function answerInstructions(language: string | undefined): string {
  return `You file one note into a topic, using the user's answer to your question about it.

Reply with JSON only, no other text, in exactly this shape:
{"topic":"...","title":"..."}

- "topic": the folder path, levels separated by "/". Use one of the CHOICES or EXISTING TOPICS when it fits the answer. Otherwise create a new path of 1 to 3 levels, broad first, named in ${languageName(language)}.
- "title": keep the current title unless the answer changes what the note is about.`;
}

export function answerInput(piece: PendingPieceInput, answer: string, existingTopics: readonly string[]): string {
  return `EXISTING TOPICS:\n${topicList(existingTopics)}

NOTE TITLE: ${piece.title}
NOTE:
<<<
${piece.body}
>>>

YOUR QUESTION: ${piece.question ?? "Where should this note go?"}
CHOICES:
${piece.choices.map((choice) => `- ${choice}`).join("\n") || "(none)"}

USER'S ANSWER:
<<<
${answer}
>>>`;
}

export function parseAnswerReply(reply: string, piece: PendingPieceInput, existingTopics: readonly string[]): { topic: string; title: string } {
  const { topic, title } = parseJsonObject(reply);
  if (typeof topic !== "string" || topic.trim() === "") throw new SortReplyError('The reply needs a non-empty "topic" string.');
  const known = [...piece.choices, ...existingTopics];
  const cleanTitle = typeof title === "string" ? title.replace(/^#+\s*/, "").trim().slice(0, 120) : "";
  return { topic: resolveTopic(topic, known), title: cleanTitle || piece.title };
}

/** Picks the topic for a Pending piece from the user's own-words answer. One AI call, one retry. */
export async function fileWithAnswer(
  piece: PendingPieceInput,
  answer: string,
  existingTopics: readonly string[],
  generate: Generate,
  { language }: SortOptions = {},
): Promise<{ topic: string; title: string; usage: Usage }> {
  const { value, usage } = await callForJson(generate, answerInstructions(language), answerInput(piece, answer, existingTopics), (reply) =>
    parseAnswerReply(reply, piece, existingTopics),
  );
  return { ...value, usage };
}
