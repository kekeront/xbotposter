import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CompletionOptions, CompletionResult } from "@/lib/llm";

const mockComplete =
  vi.fn<(opts: CompletionOptions) => Promise<CompletionResult>>();

vi.mock("@/lib/llm", () => ({
  complete: (opts: CompletionOptions) => mockComplete(opts),
}));

import { evaluate, type EvalInput } from "./evaluator";

const BASE_RESULT: CompletionResult = {
  text: "",
  model: "gpt-5-mini",
  tokensIn: 900,
  tokensOut: 200,
  cachedTokensIn: 0,
  costUsd: 0.002,
};

const VALID_EVAL_RESPONSE = {
  scores: {
    insightDensity: 85,
    voiceMatch: 90,
    antiSlop: 95,
    charFit: 80,
    language: 88,
    faithfulness: 92,
  },
  overall: 88,
  critique: "Хороший драфт, стиль попадает",
};

const BASE_INPUT: EvalInput = {
  seed: "small models closing the gap",
  draft: ["маленькие модели закрывают разрыв на узких задачах"],
};

function firstCompleteOptions(): CompletionOptions {
  const call = mockComplete.mock.calls[0];
  if (!call) throw new Error("complete was not called");
  return call[0];
}

describe("evaluate()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("parses valid JSON evaluation correctly", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: JSON.stringify(VALID_EVAL_RESPONSE),
    });

    const result = await evaluate(BASE_INPUT);
    expect(result.scores.insightDensity).toBe(85);
    expect(result.scores.voiceMatch).toBe(90);
    expect(result.scores.antiSlop).toBe(95);
    expect(result.scores.charFit).toBe(80);
    expect(result.scores.language).toBe(88);
    expect(result.scores.faithfulness).toBe(92);
    expect(result.overall).toBe(88);
    expect(result.critique).toBe("Хороший драфт, стиль попадает");
    expect(result.model).toBe("gpt-5-mini");
  });

  it("clamps scores to 0-100 range", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: JSON.stringify({
        scores: {
          insightDensity: 150,
          voiceMatch: -20,
          antiSlop: 100,
          charFit: 0,
          language: 200,
          faithfulness: -50,
        },
        overall: 120,
        critique: "clamped",
      }),
    });

    const result = await evaluate(BASE_INPUT);
    expect(result.scores.insightDensity).toBe(100);
    expect(result.scores.voiceMatch).toBe(0);
    expect(result.scores.antiSlop).toBe(100);
    expect(result.scores.charFit).toBe(0);
    expect(result.scores.language).toBe(100);
    expect(result.scores.faithfulness).toBe(0);
    expect(result.overall).toBe(100);
  });

  it("returns zeroed scores on non-JSON response", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: "this is not json at all",
    });

    const result = await evaluate(BASE_INPUT);
    expect(result.scores.insightDensity).toBe(0);
    expect(result.overall).toBe(0);
    expect(result.critique).toBe("evaluator returned non-JSON output");
  });

  it("handles missing scores object", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: JSON.stringify({ overall: 50, critique: "ok" }),
    });

    const result = await evaluate(BASE_INPUT);
    expect(result.scores.insightDensity).toBe(0);
    expect(result.scores.voiceMatch).toBe(0);
  });

  it("computes overall as average when LLM overall is missing", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: JSON.stringify({
        scores: {
          insightDensity: 60,
          voiceMatch: 60,
          antiSlop: 60,
          charFit: 60,
          language: 60,
          faithfulness: 60,
        },
        critique: "consistent",
      }),
    });

    const result = await evaluate(BASE_INPUT);
    expect(result.overall).toBe(60);
  });

  it("handles string scores via clampScore", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: JSON.stringify({
        scores: {
          insightDensity: "85",
          voiceMatch: "not-a-number",
          antiSlop: null,
          charFit: undefined,
          language: 90,
          faithfulness: 75,
        },
        overall: 70,
        critique: "mixed types",
      }),
    });

    const result = await evaluate(BASE_INPUT);
    expect(result.scores.insightDensity).toBe(85);
    expect(result.scores.voiceMatch).toBe(0); // NaN -> 0
    expect(result.scores.antiSlop).toBe(0);    // null -> 0
    expect(result.scores.language).toBe(90);
    expect(result.scores.faithfulness).toBe(75);
  });

  it("includes fingerprint and reference tweets in messages", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: JSON.stringify(VALID_EVAL_RESPONSE),
    });

    await evaluate({
      ...BASE_INPUT,
      fingerprintBlock: "EXTRACTED FINGERPRINT (from 5 posts)",
      referenceTweets: ["пост номер один", "пост номер два"],
    });

    const callArgs = firstCompleteOptions();
    const messages = callArgs.messages;
    const fpMsg = messages?.find((m) =>
      m.content.includes("EXTRACTED FINGERPRINT"),
    );
    const voiceMsg = messages?.find((m) => m.content.includes("VOICE ANCHOR"));
    expect(fpMsg).toBeDefined();
    expect(voiceMsg).toBeDefined();
  });

  it("handles thread evaluation", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: JSON.stringify(VALID_EVAL_RESPONSE),
    });

    await evaluate({
      seed: "thread about AI",
      draft: ["post 1", "post 2", "post 3"],
      contentType: "thread",
    });

    const callArgs = firstCompleteOptions();
    const messages = callArgs.messages;
    const userMsg = messages?.find((m) => m.content.includes("thread, 3 posts"));
    expect(userMsg).toBeDefined();
  });

  it("system prompt scores language against ENGLISH when language is 'english'", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: JSON.stringify(VALID_EVAL_RESPONSE),
    });

    await evaluate({ ...BASE_INPUT, language: "english" });

    const callArgs = firstCompleteOptions();
    const systemMsg = callArgs.messages?.find((m) => m.role === "system");
    expect(systemMsg?.content).toContain("Chosen output language: ENGLISH");
    expect(systemMsg?.content).not.toContain("Russian-friendly seed got a pure-English answer, score low");
  });

  it("system prompt scores language against RUSSIAN by default", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: JSON.stringify(VALID_EVAL_RESPONSE),
    });

    await evaluate(BASE_INPUT);

    const callArgs = firstCompleteOptions();
    const systemMsg = callArgs.messages?.find((m) => m.role === "system");
    expect(systemMsg?.content).toContain("Chosen output language: RUSSIAN");
  });
});
