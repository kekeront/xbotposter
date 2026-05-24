import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BillingSnapshot, SpendBucket } from "./billing";

const { mockEnv, mockLoadBilling } = vi.hoisted(() => ({
  mockEnv: { MAX_DAILY_USD: 2.0 },
  mockLoadBilling: vi.fn<() => Promise<BillingSnapshot | null>>(),
}));

vi.mock("@/lib/env", () => ({
  env: mockEnv,
}));

vi.mock("./billing", () => ({
  loadBilling: (...args: unknown[]) => mockLoadBilling(...args as []),
}));

import { checkSpendCap, spendCapResponse } from "./spend-cap";

function makeBucket(totalUsd: number): SpendBucket {
  return {
    openaiUsd: totalUsd * 0.8,
    xUsd: totalUsd * 0.2,
    totalUsd,
    breakdown: {
      generationCount: 5,
      standaloneTraceCount: 2,
      postedTweetCount: 1,
      discoverRunCount: 1,
      discoverResourcesTotal: 10,
    },
  };
}

function makeSnapshot(todayTotal: number): BillingSnapshot {
  return {
    today: makeBucket(todayTotal),
    last7d: makeBucket(todayTotal * 3),
    thisMonth: makeBucket(todayTotal * 10),
    allTime: makeBucket(todayTotal * 30),
  };
}

describe("checkSpendCap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.MAX_DAILY_USD = 2.0;
  });

  it("allows when spend is below cap", async () => {
    mockLoadBilling.mockResolvedValue(makeSnapshot(0.5));
    const verdict = await checkSpendCap();
    expect(verdict.allow).toBe(true);
    expect(verdict.todayUsd).toBe(0.5);
    expect(verdict.capUsd).toBe(2.0);
  });

  it("blocks when spend equals cap", async () => {
    mockLoadBilling.mockResolvedValue(makeSnapshot(2.0));
    const verdict = await checkSpendCap();
    expect(verdict.allow).toBe(false);
    if (!verdict.allow) {
      expect(verdict.reason).toContain("daily spend cap hit");
    }
  });

  it("blocks when spend exceeds cap", async () => {
    mockLoadBilling.mockResolvedValue(makeSnapshot(5.0));
    const verdict = await checkSpendCap();
    expect(verdict.allow).toBe(false);
  });

  it("allows on billing failure (fail-open)", async () => {
    mockLoadBilling.mockResolvedValue(null);
    const verdict = await checkSpendCap();
    expect(verdict.allow).toBe(true);
    expect(verdict.todayUsd).toBe(0);
  });

  it("respects custom MAX_DAILY_USD", async () => {
    mockEnv.MAX_DAILY_USD = 0.1;
    mockLoadBilling.mockResolvedValue(makeSnapshot(0.15));
    const verdict = await checkSpendCap();
    expect(verdict.allow).toBe(false);
  });
});

describe("spendCapResponse", () => {
  it("returns 429 with structured body", async () => {
    const res = spendCapResponse({
      allow: false,
      reason: "daily spend cap hit ($2.100 / $2.00)",
      todayUsd: 2.1,
      capUsd: 2.0,
    });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.skipped).toContain("spend cap");
    expect(body.todayUsd).toBe(2.1);
    expect(body.capUsd).toBe(2.0);
  });

  it("throws when called with allow=true verdict", () => {
    expect(() =>
      spendCapResponse({ allow: true, todayUsd: 0.5, capUsd: 2.0 }),
    ).toThrow("spendCapResponse called with allow=true");
  });
});
