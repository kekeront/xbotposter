import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: {
    LLM_CHEAP_MODEL: "gpt-5-nano",
    LLM_MID_MODEL: "gpt-5-mini",
    LLM_WRITER_MODEL: "gpt-5.4-mini",
    EMBEDDING_MODEL: "text-embedding-3-small",
    OPENAI_API_KEY: "sk-test",
  },
  requireEnv: (key: string) => `mock-${key}`,
}));

import { costFor } from "./llm";

describe("costFor", () => {
  it("calculates gpt-5-nano cost correctly", () => {
    // 1000 input tokens, 100 output tokens, no cache
    // input: 1000 * 0.05 / 1M = 0.00005
    // output: 100 * 0.4 / 1M = 0.00004
    const cost = costFor("gpt-5-nano", 1000, 100);
    expect(cost).toBeCloseTo(0.00009, 6);
  });

  it("calculates gpt-5-mini cost correctly", () => {
    // 1000 input, 500 output
    // input: 1000 * 0.25 / 1M = 0.00025
    // output: 500 * 2.0 / 1M = 0.001
    const cost = costFor("gpt-5-mini", 1000, 500);
    expect(cost).toBeCloseTo(0.00125, 6);
  });

  it("calculates gpt-5.4-mini cost correctly", () => {
    // 2000 input, 300 output
    // input: 2000 * 0.75 / 1M = 0.0015
    // output: 300 * 4.5 / 1M = 0.00135
    const cost = costFor("gpt-5.4-mini", 2000, 300);
    expect(cost).toBeCloseTo(0.00285, 6);
  });

  it("applies cached token discount", () => {
    // 1000 total input, 600 cached, 400 uncached
    // uncached: 400 * 0.75 / 1M = 0.0003
    // cached: 600 * 0.075 / 1M = 0.000045
    // output: 200 * 4.5 / 1M = 0.0009
    const cost = costFor("gpt-5.4-mini", 1000, 200, 600);
    expect(cost).toBeCloseTo(0.001245, 6);
  });

  it("handles fully cached input", () => {
    // 1000 input tokens, all 1000 cached
    // uncached: 0
    // cached: 1000 * 0.005 / 1M = 0.000005
    // output: 50 * 0.4 / 1M = 0.00002
    const cost = costFor("gpt-5-nano", 1000, 50, 1000);
    expect(cost).toBeCloseTo(0.000025, 6);
  });

  it("returns 0 for unknown model", () => {
    const cost = costFor("unknown-model-xyz", 10000, 5000);
    expect(cost).toBe(0);
  });

  it("returns 0 for zero tokens", () => {
    const cost = costFor("gpt-5-nano", 0, 0);
    expect(cost).toBe(0);
  });

  it("clamps uncached to non-negative when cachedTokensIn > tokensIn", () => {
    // Edge case: cached > total (shouldn't happen but defensive)
    const cost = costFor("gpt-5-nano", 100, 50, 200);
    // uncached = max(0, 100 - 200) = 0
    // cached = 200 * 0.005 / 1M = 0.000001
    // output = 50 * 0.4 / 1M = 0.00002
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeCloseTo(0.000021, 6);
  });

  it("calculates embedding model cost (output = 0)", () => {
    // text-embedding-3-small: 0.02 per 1M input, 0 output
    const cost = costFor("text-embedding-3-small", 500, 0);
    expect(cost).toBeCloseTo(0.00001, 6);
  });

  it("calculates gpt-5.4 (full) cost", () => {
    // input: 1000 * 2.5 / 1M = 0.0025
    // output: 100 * 15.0 / 1M = 0.0015
    const cost = costFor("gpt-5.4", 1000, 100);
    expect(cost).toBeCloseTo(0.004, 6);
  });

  it("calculates gpt-4o cost", () => {
    // input: 1000 * 2.5 / 1M = 0.0025
    // output: 100 * 10.0 / 1M = 0.001
    const cost = costFor("gpt-4o", 1000, 100);
    expect(cost).toBeCloseTo(0.0035, 6);
  });

  it("uses full input rate when no cachedInput pricing exists", () => {
    // gpt-4o has no cachedInput rate
    // 1000 input, 800 cached, 200 uncached
    // uncached: 200 * 2.5 / 1M = 0.0005
    // cached: 800 * 2.5 / 1M = 0.002 (falls back to full input rate)
    // output: 50 * 10.0 / 1M = 0.0005
    const cost = costFor("gpt-4o", 1000, 50, 800);
    expect(cost).toBeCloseTo(0.003, 6);
  });
});
