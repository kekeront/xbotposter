import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: { CRON_SECRET: "test-secret-token-12345678" },
}));

import { authorizeCronRequest, unauthorized } from "./cron-auth";

function makeRequest(authHeader?: string): Request {
  const headers = new Headers();
  if (authHeader) headers.set("authorization", authHeader);
  return new Request("http://localhost:3000/api/cron/discover", { headers });
}

describe("authorizeCronRequest", () => {
  it("returns true for valid bearer token", () => {
    const req = makeRequest("Bearer test-secret-token-12345678");
    expect(authorizeCronRequest(req)).toBe(true);
  });

  it("returns false for wrong token", () => {
    const req = makeRequest("Bearer wrong-token");
    expect(authorizeCronRequest(req)).toBe(false);
  });

  it("returns false for missing authorization header", () => {
    const req = makeRequest();
    expect(authorizeCronRequest(req)).toBe(false);
  });

  it("returns false for non-bearer auth", () => {
    const req = makeRequest("Basic dXNlcjpwYXNz");
    expect(authorizeCronRequest(req)).toBe(false);
  });

  it("returns false for bearer prefix without space", () => {
    const req = makeRequest("Bearertest-secret-token-12345678");
    expect(authorizeCronRequest(req)).toBe(false);
  });
});

describe("authorizeCronRequest with missing CRON_SECRET", () => {
  it("returns false when CRON_SECRET is undefined", async () => {
    vi.doMock("@/lib/env", () => ({
      env: { CRON_SECRET: undefined },
    }));
    const { authorizeCronRequest: authFn } = await import("./cron-auth");
    const req = makeRequest("Bearer anything");
    expect(authFn(req)).toBe(false);
  });
});

describe("unauthorized", () => {
  it("returns 401 status", () => {
    const res = unauthorized();
    expect(res.status).toBe(401);
  });

  it("returns JSON error body", async () => {
    const res = unauthorized();
    const body = await res.json();
    expect(body).toEqual({ error: "unauthorized" });
  });
});
