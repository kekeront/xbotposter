import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  loadDiscoveryFeed,
  type DiscoveryKind,
} from "@/lib/discovery-feed";

const VALID_KINDS = [
  "x",
  "hn",
  "arxiv",
  "substack",
  "manual",
  "pdf",
  "image",
] as const satisfies ReadonlyArray<DiscoveryKind>;

const FeedQuerySchema = z.object({
  kinds: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return undefined;
      const parsed = v
        .split(",")
        .map((k) => k.trim())
        .filter((k): k is DiscoveryKind =>
          (VALID_KINDS as ReadonlyArray<string>).includes(k),
        );
      return parsed.length > 0 ? parsed : undefined;
    }),
  q: z.string().max(200).optional(),
  sort: z.enum(["recency", "engagement"]).optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return 30;
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n > 0 && n <= 100 ? n : 30;
    }),
  offset: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return 0;
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    }),
});

export async function GET(request: NextRequest) {
  const user = await requireUser();

  const raw = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = FeedQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid query params", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { kinds, q, sort, limit, offset } = parsed.data;

  const result = await loadDiscoveryFeed(user.id, {
    kinds,
    query: q,
    sort,
    limit,
    offset,
  });

  // Serialize Date objects to ISO strings for JSON transport.
  return Response.json({
    items: result.items.map((item) => ({
      ...item,
      capturedAt: item.capturedAt.toISOString(),
    })),
    total: result.total,
  });
}
