import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { POST_STATUS, posts } from "@/db/schema";
import { requireUser } from "@/lib/auth";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const user = await requireUser();
  const { id } = await params;
  const post = await db.query.posts.findFirst({
    where: and(eq(posts.id, id), eq(posts.userId, user.id)),
  });
  if (!post) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(post);
}

const PatchRequest = z.object({
  text: z.string().min(1).optional(),
  status: z.enum(POST_STATUS).optional(),
  scheduledFor: z.string().datetime().optional(),
});

export async function PATCH(request: Request, { params }: RouteContext) {
  const user = await requireUser();
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = PatchRequest.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const update: Partial<typeof posts.$inferInsert> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (parsed.data.text !== undefined) update.text = parsed.data.text;
  if (parsed.data.status !== undefined) update.status = parsed.data.status;
  if (parsed.data.scheduledFor !== undefined) {
    update.scheduledFor = new Date(parsed.data.scheduledFor);
  }

  const [updated] = await db
    .update(posts)
    .set(update)
    .where(and(eq(posts.id, id), eq(posts.userId, user.id)))
    .returning();

  if (!updated) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(updated);
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const user = await requireUser();
  const { id } = await params;
  const deleted = await db
    .delete(posts)
    .where(and(eq(posts.id, id), eq(posts.userId, user.id)))
    .returning({ id: posts.id });

  if (deleted.length === 0) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  return Response.json({ ok: true, id: deleted[0]?.id });
}
