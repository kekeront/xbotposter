import { vi } from "vitest";

// Mock "server-only" — it's a Next.js build-time guard that throws at import
// time in non-Next environments. Every lib/ and agents/ file imports it.
vi.mock("server-only", () => ({}));

// Mock DB client so tests never touch a real database
vi.mock("@/db/client", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));
