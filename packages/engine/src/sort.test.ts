import { describe, expect, it } from "vitest";
import type { GenerateRequest, GenerateResult } from "./ai.ts";
import {
  answerInput,
  fileWithAnswer,
  languageName,
  needsReview,
  parseSortReply,
  sortCapture,
  sortInput,
  sortInstructions,
  SortReplyError,
  usageOf,
} from "./sort.ts";

const reply = (text: string, inputTokens = 100, outputTokens = 20): GenerateResult => ({
  text,
  usage: { inputTokens, outputTokens },
});

function scripted(replies: GenerateResult[]) {
  const requests: GenerateRequest[] = [];
  const generate = async (request: GenerateRequest) => {
    requests.push(request);
    const next = replies.shift();
    if (!next) throw new Error("no more scripted replies");
    return next;
  };
  return { generate, requests };
}

const GOOD = JSON.stringify({
  pieces: [
    { title: "Kyoto temples", body: "Visit Kinkaku-ji in spring.", topic: "travel/japan", confidence: 0.92 },
    { title: "## Groceries", body: "Milk, eggs", topic: "Shopping", confidence: 1.7 },
  ],
});

describe("prompt", () => {
  it("lists existing topics and wraps the capture", () => {
    expect(sortInput("hello", ["Travel/Japan", "Work"])).toBe(
      "EXISTING TOPICS:\n- Travel/Japan\n- Work\n\nCAPTURE:\n<<<\nhello\n>>>",
    );
    expect(sortInput("hello", [])).toContain("(none yet)");
  });

  it("asks for new topic names and questions in the user's language", () => {
    expect(sortInstructions("th-TH")).toContain("named in Thai (Thailand)");
    expect(sortInstructions("th-TH")).toContain("a short question for the user in Thai (Thailand)");
    expect(sortInstructions(undefined)).toContain("named in English");
    expect(languageName("not a tag!")).toBe("English");
  });
});

describe("parseSortReply", () => {
  it("reads pieces, reuses existing topics, cleans titles and clamps confidence", () => {
    expect(parseSortReply(GOOD, ["Travel/Japan"])).toEqual([
      { title: "Kyoto temples", body: "Visit Kinkaku-ji in spring.", topic: "Travel/Japan", confidence: 0.92, question: null, choices: [] },
      { title: "Groceries", body: "Milk, eggs", topic: "Shopping", confidence: 1, question: null, choices: [] },
    ]);
  });

  it("reads the AI's question and choices, with the suggested topic first and no duplicates", () => {
    const reply = JSON.stringify({
      pieces: [
        {
          title: "Dentist",
          body: "Dentist Thursday 4pm",
          topic: "Personal/Health",
          confidence: 0.55,
          question: "  Is this for you or your kid?  ",
          choices: ["Family/Kids", "personal/health", "Work", "Extra/Fourth"],
        },
      ],
    });
    expect(parseSortReply(reply, ["Personal/Health"])[0]).toMatchObject({
      topic: "Personal/Health",
      question: "Is this for you or your kid?",
      choices: ["Personal/Health", "Family/Kids", "Work"],
    });
  });

  it("drops choices when there is no question, and offers the suggested topic when choices are missing", () => {
    const noQuestion = JSON.stringify({ pieces: [{ body: "x", topic: "A", confidence: 0.9, question: null, choices: ["B"] }] });
    expect(parseSortReply(noQuestion, [])[0]).toMatchObject({ question: null, choices: [] });
    const noChoices = JSON.stringify({ pieces: [{ body: "x", topic: "A", confidence: 0.5, question: "Which?" }] });
    expect(parseSortReply(noChoices, [])[0]).toMatchObject({ question: "Which?", choices: ["A"] });
  });

  it("sends a piece to review when it has a question or low confidence", () => {
    expect(needsReview({ question: "Which?", confidence: 0.95 })).toBe(true);
    expect(needsReview({ question: null, confidence: 0.59 })).toBe(true);
    expect(needsReview({ question: null, confidence: 0.6 })).toBe(false);
  });

  it("accepts JSON wrapped in a code fence or extra text", () => {
    expect(parseSortReply("Here you go:\n```json\n" + GOOD + "\n```", [])).toHaveLength(2);
  });

  it("fills in a missing title and confidence, and sends empty topics to Inbox", () => {
    const pieces = parseSortReply(JSON.stringify({ pieces: [{ body: "First line\nmore", topic: "" }] }), []);
    expect(pieces).toEqual([{ title: "First line", body: "First line\nmore", topic: "Inbox", confidence: 0, question: null, choices: [] }]);
  });

  it("explains what is wrong", () => {
    expect(() => parseSortReply("no json here", [])).toThrow(SortReplyError);
    expect(() => parseSortReply("{not json}", [])).toThrow(/not valid JSON/);
    expect(() => parseSortReply('{"pieces": []}', [])).toThrow(/non-empty "pieces"/);
    expect(() => parseSortReply('{"pieces": [{"title": "x"}]}', [])).toThrow(/Piece 1 needs a non-empty "body"/);
  });
});

describe("sortCapture", () => {
  it("makes one call and adds up token usage", async () => {
    const { generate, requests } = scripted([reply(GOOD)]);
    const result = await sortCapture("Kyoto... milk", ["Travel/Japan"], generate, { language: "en-US" });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.instructions).toContain("named in American English");
    expect(result.pieces.map((p) => p.topic)).toEqual(["Travel/Japan", "Shopping"]);
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
  });

  it("retries once, quoting the problem, and counts both calls", async () => {
    const { generate, requests } = scripted([reply("Sure! Here are your notes.", 100, 10), reply(GOOD, 120, 30)]);
    const result = await sortCapture("text", [], generate);
    expect(requests).toHaveLength(2);
    expect(requests[1]!.input).toContain("Your previous reply could not be used: The reply contained no JSON object.");
    expect(result.usage).toEqual({ inputTokens: 220, outputTokens: 40 });
  });

  it("gives up after the second unusable reply, keeping the tokens both calls used", async () => {
    const { generate } = scripted([reply("nope", 100, 5), reply("still nope", 110, 6)]);
    const error = await sortCapture("text", [], generate).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(SortReplyError);
    expect((error as Error).message).toMatch(/could not be used twice/);
    expect(usageOf(error)).toEqual({ inputTokens: 210, outputTokens: 11 });
  });

  it("passes provider errors straight through without retrying", async () => {
    let calls = 0;
    const generate = async () => {
      calls++;
      throw new Error("401: Invalid API key");
    };
    await expect(sortCapture("text", [], generate)).rejects.toThrow("401: Invalid API key");
    expect(calls).toBe(1);
  });
});

describe("fileWithAnswer", () => {
  const piece = {
    title: "Dentist",
    body: "Dentist Thursday 4pm",
    question: "Is this for you or your kid?",
    choices: ["Personal/Health", "Family/Kids"],
  };

  it("shows the note, the question, the choices and the answer", () => {
    const input = answerInput(piece, "my son", ["Work"]);
    expect(input).toContain("NOTE TITLE: Dentist");
    expect(input).toContain("YOUR QUESTION: Is this for you or your kid?");
    expect(input).toContain("- Family/Kids");
    expect(input).toContain("USER'S ANSWER:\n<<<\nmy son\n>>>");
  });

  it("returns the topic from the answer, matching choices regardless of case", async () => {
    const { generate, requests } = scripted([reply('{"topic":"family/kids","title":"Son\'s dentist"}', 80, 12)]);
    const result = await fileWithAnswer(piece, "my son", ["Work"], generate, { language: "th-TH" });
    expect(result).toEqual({ topic: "Family/Kids", title: "Son's dentist", usage: { inputTokens: 80, outputTokens: 12 } });
    expect(requests[0]!.instructions).toContain("named in Thai (Thailand)");
  });

  it("keeps the title when the model leaves it out, and retries an unusable reply", async () => {
    const { generate } = scripted([reply("hmm"), reply('{"topic":"Health/Dental"}')]);
    const result = await fileWithAnswer(piece, "it's mine", [], generate);
    expect(result).toMatchObject({ topic: "Health/Dental", title: "Dentist" });
  });

  it("fails when the reply has no topic twice", async () => {
    const { generate } = scripted([reply('{"title":"x"}'), reply('{"topic":""}')]);
    await expect(fileWithAnswer(piece, "?", [], generate)).rejects.toThrow(/could not be used twice/);
  });
});
