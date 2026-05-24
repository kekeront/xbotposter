import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CompletionOptions, CompletionResult } from "@/lib/llm";

const mockComplete =
  vi.fn<(opts: CompletionOptions) => Promise<CompletionResult>>();

vi.mock("@/lib/llm", () => ({
  complete: (opts: CompletionOptions) => mockComplete(opts),
}));

import { review } from "./editor";

const BASE_RESULT: CompletionResult = {
  text: "",
  model: "gpt-5-mini",
  tokensIn: 1200,
  tokensOut: 300,
  cachedTokensIn: 0,
  costUsd: 0.002,
};

function firstCompleteOptions(): CompletionOptions {
  const call = mockComplete.mock.calls[0];
  if (!call) throw new Error("complete was not called");
  return call[0];
}

describe("editor review()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns no-op for empty drafts array", async () => {
    const result = await review({
      topic: "test",
      drafts: [],
      contentType: "single",
    });
    expect(result.texts).toEqual([]);
    expect(result.issuesFound).toEqual([]);
    expect(result.changed).toBe(false);
    expect(result.model).toBe("skip");
    expect(result.costUsd).toBe(0);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("returns unchanged draft when no issues found", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: JSON.stringify({
        issues: [],
        revised: ["оригинальный текст"],
      }),
    });

    const result = await review({
      topic: "test",
      drafts: ["оригинальный текст"],
      contentType: "single",
    });
    expect(result.texts).toEqual(["оригинальный текст"]);
    expect(result.issuesFound).toEqual([]);
    expect(result.changed).toBe(false);
  });

  it("returns revised text with issues", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: JSON.stringify({
        issues: ["too long", "slop phrase detected"],
        revised: ["исправленный текст"],
      }),
    });

    const result = await review({
      topic: "test",
      drafts: ["длинный оригинальный текст со слопом"],
      contentType: "single",
    });
    expect(result.texts).toEqual(["исправленный текст"]);
    expect(result.issuesFound).toHaveLength(2);
    expect(result.issuesFound).toContain("too long");
    expect(result.changed).toBe(true);
  });

  it("falls back to original when revised length mismatches", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: JSON.stringify({
        issues: ["length mismatch in response"],
        revised: ["only one post"],
      }),
    });

    const original = ["пост 1", "пост 2", "пост 3"];
    const result = await review({
      topic: "thread",
      drafts: original,
      contentType: "thread",
    });
    expect(result.texts).toEqual(original);
  });

  it("handles non-JSON response gracefully", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: "sorry I cannot help with that",
    });

    const original = ["оригинал"];
    const result = await review({
      topic: "test",
      drafts: original,
      contentType: "single",
    });
    expect(result.texts).toEqual(original);
    expect(result.issuesFound).toEqual(["editor returned non-JSON output"]);
    expect(result.changed).toBe(false);
  });

  it("preserves thread structure in revised output", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: JSON.stringify({
        issues: ["fixed slop in post 2"],
        revised: ["пост 1", "исправленный пост 2", "пост 3"],
      }),
    });

    const result = await review({
      topic: "thread topic",
      drafts: ["пост 1", "слоповый пост 2", "пост 3"],
      contentType: "thread",
    });
    expect(result.texts).toHaveLength(3);
    expect(result.texts[1]).toBe("исправленный пост 2");
    expect(result.changed).toBe(true);
  });

  it("trims whitespace from revised texts", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: JSON.stringify({
        issues: [],
        revised: ["  trimmed text  "],
      }),
    });

    const result = await review({
      topic: "test",
      drafts: ["  trimmed text  "],
      contentType: "single",
    });
    expect(result.texts[0]).toBe("trimmed text");
  });

  it("defaults issues to empty array when missing", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: JSON.stringify({
        revised: ["text"],
      }),
    });

    const result = await review({
      topic: "test",
      drafts: ["text"],
      contentType: "single",
    });
    expect(result.issuesFound).toEqual([]);
  });

  it("includes voice anchor in messages", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: JSON.stringify({ issues: [], revised: ["ok"] }),
    });

    await review({
      topic: "test",
      drafts: ["draft"],
      contentType: "single",
      referenceTweets: ["пора ботать", "чалить код"],
    });

    const callArgs = firstCompleteOptions();
    const messages = callArgs.messages;
    const voiceMsg = messages?.find(
      (m) => m.content.includes("VOICE ANCHOR") && m.content.includes("[1]"),
    );
    expect(voiceMsg).toBeDefined();
    expect(voiceMsg?.content).toContain("TONE REFERENCE ONLY");
  });

  it("includes fingerprint block in messages", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: JSON.stringify({ issues: [], revised: ["ok"] }),
    });

    await review({
      topic: "test",
      drafts: ["draft"],
      contentType: "single",
      fingerprintBlock: "EXTRACTED FINGERPRINT (from 10 posts)",
    });

    const callArgs = firstCompleteOptions();
    const messages = callArgs.messages;
    const fpMsg = messages?.find((m) =>
      m.content.includes("EXTRACTED FINGERPRINT"),
    );
    expect(fpMsg).toBeDefined();
  });

  it("falls back to original when revised contains empty strings after trim", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: JSON.stringify({
        issues: ["emptied post"],
        revised: ["   ", "real text"],
      }),
    });

    const original = ["original 1", "original 2"];
    const result = await review({
      topic: "test",
      drafts: original,
      contentType: "thread",
    });
    // After filter(Boolean) on trimmed, length won't match -> fallback
    expect(result.texts).toEqual(original);
  });
});
