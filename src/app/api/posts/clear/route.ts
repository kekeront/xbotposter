import { and, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { posts, type PostStatus } from "@/db/schema";

// Bulk-delete root posts (and cascading thread children via FK).
// Hardened against foot-guns:
//   - Only "draft", "skipped", "failed" allowed.
//   - "approved", "scheduled", "posted" CANNOT be cleared via this endpoint.
const CLEAR_ALLOWED: PostStatus[] = ["draft", "skipped", "failed"];

const ClearRequest = z.object({
  statuses: z.array(z.enum(CLEAR_ALLOWED as [PostStatus, ...PostStatus[]])).min(1),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = ClearRequest.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { statuses } = parsed.data;

  const deleted = await db
    .delete(posts)
    .where(and(isNull(posts.parentPostId), inArray(posts.status, statuses)))
    .returning({ id: posts.id, status: posts.status });

  return Response.json({
    ok: true,
    deletedCount: deleted.length,
    statuses,
  });
}
