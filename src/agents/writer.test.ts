import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CompletionOptions, CompletionResult } from "@/lib/llm";

const mockComplete =
  vi.fn<(opts: CompletionOptions) => Promise<CompletionResult>>();

vi.mock("@/lib/llm", () => ({
  complete: (opts: CompletionOptions) => mockComplete(opts),
}));

import { draft } from "./writer";

const BASE_RESULT: CompletionResult = {
  text: "",
  model: "gpt-5.4-mini",
  tokensIn: 1500,
  tokensOut: 100,
  cachedTokensIn: 0,
  costUsd: 0.001,
};

function firstCompleteOptions(): CompletionOptions {
  const call = mockComplete.mock.calls[0];
  if (!call) throw new Error("complete was not called");
  return call[0];
}

describe("writer draft()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns single tweet for single content type", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: "маленькие модели закрывают разрыв 🔥",
    });

    const result = await draft({ topic: "small models closing gap" });
    expect(result.texts).toHaveLength(1);
    expect(result.texts[0]).toBe("маленькие модели закрывают разрыв 🔥");
    expect(result.model).toBe("gpt-5.4-mini");
    expect(result.costUsd).toBe(0.001);
  });

  it("splits thread posts on --- separator", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: "первый пост\n---\nвторой пост\n---\nтретий пост",
    });

    const result = await draft({
      topic: "thread about AI",
      contentType: "thread",
    });
    expect(result.texts).toHaveLength(3);
    expect(result.texts[0]).toBe("первый пост");
    expect(result.texts[1]).toBe("второй пост");
    expect(result.texts[2]).toBe("третий пост");
  });

  it("filters empty segments from thread split", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: "пост один\n---\n\n---\nпост два",
    });

    const result = await draft({
      topic: "thread",
      contentType: "thread",
    });
    expect(result.texts).toHaveLength(2);
  });

  it("returns single text for essay mode (no splitting)", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: "Длинный эссе текст. Несколько абзацев.\n\nВторой абзац с деталями.",
    });

    const result = await draft({
      topic: "essay about LLMs",
      contentType: "essay",
    });
    expect(result.texts).toHaveLength(1);
    expect(result.texts[0]).toContain("Длинный эссе");
  });

  it("passes outline beats for threads", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: "beat 1 text\n---\nbeat 2 text",
    });

    await draft({
      topic: "AI training costs",
      contentType: "thread",
      outlineBeats: ["intro hook", "main argument", "conclusion"],
    });

    const callArgs = firstCompleteOptions();
    const messages = callArgs.messages;
    const userMsg = messages?.find((m) => m.content.includes("Follow this outline"));
    expect(userMsg).toBeDefined();
    expect(userMsg?.content).toContain("1. intro hook");
    expect(userMsg?.content).toContain("2. main argument");
    expect(userMsg?.content).toContain("3. conclusion");
  });

  it("includes memory block in messages when provided", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: "tweet text",
    });

    await draft({
      topic: "AI tools",
      memoryBlock: "Last tweet was about Cursor vs Copilot",
    });

    const callArgs = firstCompleteOptions();
    const messages = callArgs.messages;
    const memMsg = messages?.find((m) => m.content.includes("MEMORY"));
    expect(memMsg).toBeDefined();
    expect(memMsg?.content).toContain("Cursor vs Copilot");
  });

  it("includes research block in messages when provided", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: "tweet text",
    });

    await draft({
      topic: "new GPT model",
      researchBlock: "GPT-5 was released on May 2026 with 10T parameters",
    });

    const callArgs = firstCompleteOptions();
    const messages = callArgs.messages;
    const resMsg = messages?.find((m) => m.content.includes("RESEARCH"));
    expect(resMsg).toBeDefined();
  });

  it("includes voice anchor with tone-only instructions", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: "tweet text",
    });

    await draft({
      topic: "dev tools",
      referenceTweets: ["пора ботать", "чалить код"],
    });

    const callArgs = firstCompleteOptions();
    const messages = callArgs.messages;
    const voiceMsg = messages?.find(
      (m) => m.content.includes("VOICE ANCHOR") && m.content.includes("[1]"),
    );
    expect(voiceMsg).toBeDefined();
    expect(voiceMsg?.content).toContain("TONE REFERENCE ONLY");
    expect(voiceMsg?.content).toContain("[1] пора ботать");
    expect(voiceMsg?.content).toContain("[2] чалить код");
  });

  it("limits reference tweets to 20", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: "tweet",
    });

    const refs = Array.from({ length: 30 }, (_, i) => `ref tweet ${i}`);
    await draft({ topic: "test", referenceTweets: refs });

    const callArgs = firstCompleteOptions();
    const messages = callArgs.messages;
    const voiceMsg = messages?.find(
      (m) => m.content.includes("VOICE ANCHOR") && m.content.includes("[1]"),
    );
    expect(voiceMsg).toBeDefined();
    expect(voiceMsg?.content).toContain("[20]");
    expect(voiceMsg?.content).not.toContain("[21]");
  });

  it("uses higher maxTokens for essay mode", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: "essay content",
    });

    await draft({ topic: "long form", contentType: "essay" });

    const callArgs = firstCompleteOptions();
    expect(callArgs?.maxTokens).toBe(3000);
  });

  it("uses standard maxTokens for single mode", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: "short tweet",
    });

    await draft({ topic: "quick thought" });

    const callArgs = firstCompleteOptions();
    expect(callArgs?.maxTokens).toBe(1500);
  });

  it("trims whitespace from output", async () => {
    mockComplete.mockResolvedValue({
      ...BASE_RESULT,
      text: "  tweet with spaces  \n",
    });

    const result = await draft({ topic: "test" });
    expect(result.texts[0]).toBe("tweet with spaces");
  });

  it("system prompt contains ENGLISH directive when language is 'english'", async () => {
    mockComplete.mockResolvedValue({ ...BASE_RESULT, text: "tweet" });

    await draft({ topic: "test", preferences: { language: "english" } });

    const callArgs = firstCompleteOptions();
    const systemMsg = callArgs.messages?.find((m) => m.role === "system" && m.content.includes("OUTPUT LANGUAGE: ENGLISH"));
    expect(systemMsg).toBeDefined();
  });

  it("system prompt does NOT contain 'NEVER write a pure-English tweet' when language is 'english'", async () => {
    mockComplete.mockResolvedValue({ ...BASE_RESULT, text: "tweet" });

    await draft({ topic: "test", preferences: { language: "english" } });

    const callArgs = firstCompleteOptions();
    const systemMsg = callArgs.messages?.find((m) => m.role === "system");
    expect(systemMsg?.content).not.toContain("NEVER write a pure-English tweet");
  });

  it("system prompt contains RUSSIAN directive by default (no language preference)", async () => {
    mockComplete.mockResolvedValue({ ...BASE_RESULT, text: "tweet" });

    await draft({ topic: "test" });

    const callArgs = firstCompleteOptions();
    const systemMsg = callArgs.messages?.find((m) => m.role === "system" && m.content.includes("OUTPUT LANGUAGE: RUSSIAN"));
    expect(systemMsg).toBeDefined();
  });

  it("system prompt contains RUSSIAN directive when language is 'russian'", async () => {
    mockComplete.mockResolvedValue({ ...BASE_RESULT, text: "tweet" });

    await draft({ topic: "test", preferences: { language: "russian" } });

    const callArgs = firstCompleteOptions();
    const systemMsg = callArgs.messages?.find((m) => m.role === "system" && m.content.includes("OUTPUT LANGUAGE: RUSSIAN"));
    expect(systemMsg).toBeDefined();
  });

  it("system prompt contains MIXED RU/EN directive when language is 'mixed-ru-en'", async () => {
    mockComplete.mockResolvedValue({ ...BASE_RESULT, text: "tweet" });

    await draft({ topic: "test", preferences: { language: "mixed-ru-en" } });

    const callArgs = firstCompleteOptions();
    const systemMsg = callArgs.messages?.find((m) => m.role === "system" && m.content.includes("OUTPUT LANGUAGE: MIXED RU/EN"));
    expect(systemMsg).toBeDefined();
  });

  it("language preference is NOT duplicated as soft preference in user-preferences block", async () => {
    mockComplete.mockResolvedValue({ ...BASE_RESULT, text: "tweet" });

    await draft({ topic: "test", preferences: { language: "english", tone: "casual" } });

    const callArgs = firstCompleteOptions();
    const prefMsg = callArgs.messages?.find((m) => m.content.includes("USER PREFERENCES"));
    // Language should not appear in the preferences block; it is baked into the system prompt.
    expect(prefMsg?.content).not.toContain("OUTPUT LANGUAGE");
    // But tone should still appear.
    expect(prefMsg?.content).toContain("TONE: casual");
  });
});
