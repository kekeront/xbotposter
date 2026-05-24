import { and, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { posts } from "@/db/schema";
import type { PostStatus } from "@/db/schema";

const RESETTABLE: PostStatus[] = ["draft", "approved", "scheduled", "failed"];

export async function POST() {
  const deleted = await db
    .delete(posts)
    .where(and(isNull(posts.parentPostId), inArray(posts.status, RESETTABLE)))
    .returning({ id: posts.id });

  return Response.json({ ok: true, deleted: deleted.length });
}
