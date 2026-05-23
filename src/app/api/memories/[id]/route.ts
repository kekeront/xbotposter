import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { memories } from "@/db/schema";

type RouteContext = { params: Promise<{ id: string }> };

// Soft retire — sets superseded_at without a replacement row. The active
// filter `WHERE superseded_at IS NULL` will exclude this memory. The
// superseded_by column is left NULL on purpose: there is no "successor"
// for a manual retire, only for automatic replacement by recordMemory.
export async function PATCH(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const [updated] = await db
    .update(memories)
    .set({ supersededAt: new Date() })
    .where(and(eq(memories.id, id), isNull(memories.supersededAt)))
    .returning({ id: memories.id, supersededAt: memories.supersededAt });

  if (!updated) {
    return Response.json(
      { error: "not found or already retired" },
      { status: 404 },
    );
  }
  return Response.json({ ok: true, id: updated.id, supersededAt: updated.supersededAt });
}

// Hard delete — drops the row entirely. Use sparingly.
export async function DELETE(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const deleted = await db
    .delete(memories)
    .where(eq(memories.id, id))
    .returning({ id: memories.id });
  if (deleted.length === 0)
    return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ ok: true, id });
}
