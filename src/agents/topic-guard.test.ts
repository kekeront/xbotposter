import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CompletionOptions, CompletionResult } from "@/lib/llm";

const mockComplete =
  vi.fn<(opts: CompletionOptions) => Promise<CompletionResult>>();

vi.mock("@/lib/llm", () => ({
  complete: (opts: CompletionOptions) => mockComplete(opts),
}));

import { check } from "./topic-guard";

const BASE_RESULT: CompletionResult = {
  text: "",
  model: "gpt-5-nano",
  tokensIn: 100,
  tokensOut: 50,
  cachedTokensIn: 0,
  costUsd: 0.00003,
};

function firstCompleteOptions(): CompletionOptions {
  const call = mockComplete.mock.calls[0];
  if (!call) throw new Error("complete was not called");
  return call[0];
}

describe("topic-guard check()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns safe=true for AI/tech topics", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: JSON.stringify({
        safe: true,
        category: "ai-research",
        reason: "tweet about LLM benchmarks",
      }),
    });

    const result = await check({ text: "GPT-5 benchmarks are impressive" });
    expect(result.safe).toBe(true);
    expect(result.category).toBe("ai-research");
    expect(result.model).toBe("gpt-5-nano");
    expect(result.costUsd).toBe(0.00003);
  });

  it("returns safe=false for political topics", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: JSON.stringify({
        safe: false,
        category: "politics",
        reason: "mentions political figures and government action",
      }),
    });

    const result = await check({
      text: "Trump's new executive order on AI regulation",
      author: "paulg",
    });
    expect(result.safe).toBe(false);
    expect(result.category).toBe("politics");
  });

  it("defaults to safe=false on non-JSON response", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: "I can't determine the safety of this tweet.",
    });

    const result = await check({ text: "ambiguous content" });
    expect(result.safe).toBe(false);
    expect(result.category).toBe("parse-error");
    expect(result.reason).toContain("non-JSON");
  });

  it("defaults to safe=false when safe field is not boolean true", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: JSON.stringify({ safe: "yes", category: "tech", reason: "ok" }),
    });

    const result = await check({ text: "tech stuff" });
    expect(result.safe).toBe(false);
  });

  it("handles missing category field gracefully", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: JSON.stringify({ safe: true, reason: "looks fine" }),
    });

    const result = await check({ text: "new framework dropped" });
    expect(result.safe).toBe(true);
    expect(result.category).toBe("unknown");
  });

  it("handles missing reason field gracefully", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: JSON.stringify({ safe: true, category: "startup" }),
    });

    const result = await check({ text: "shipped v2 today" });
    expect(result.reason).toBe("");
  });

  it("passes author to the user message", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: JSON.stringify({
        safe: true,
        category: "ai-research",
        reason: "tech tweet",
      }),
    });

    await check({ text: "new paper from DeepMind", author: "karpathy" });
    const callArgs = firstCompleteOptions();
    const messages = callArgs.messages;
    const userMsg = messages?.find((m) => m.content.includes("@karpathy"));
    expect(userMsg).toBeDefined();
  });

  it("uses '?' for missing author", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: JSON.stringify({
        safe: true,
        category: "startup",
        reason: "ok",
      }),
    });

    await check({ text: "some tweet" });
    const callArgs = firstCompleteOptions();
    const messages = callArgs.messages;
    const userMsg = messages?.find((m) => m.content.includes("@?"));
    expect(userMsg).toBeDefined();
  });
});
