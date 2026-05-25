import { z } from "zod";
import { db } from "@/db/client";
import { sources } from "@/db/schema";
import { requireUser } from "@/lib/auth";

const UploadRequest = z.object({
  title: z.string().min(1).max(500),
  content: z.string().min(1).max(50_000),
  url: z.string().url().optional(),
  type: z.enum(["manual", "web"]).default("manual"),
});

export async function POST(request: Request) {
  const user = await requireUser();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = UploadRequest.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { title, content, url, type } = parsed.data;
  const externalId = url ?? `manual-${Date.now()}`;

  const [row] = await db
    .insert(sources)
    .values({
      userId: user.id,
      type,
      externalId,
      url: url ?? null,
      title,
      content,
    })
    .onConflictDoUpdate({
      target: [sources.type, sources.externalId],
      set: { title, content },
    })
    .returning();

  return Response.json(
    { source: row },
    { status: 201 },
  );
}

export async function GET() {
  const user = await requireUser();
  const { eq } = await import("drizzle-orm");
  const rows = await db
    .select({
      id: sources.id,
      type: sources.type,
      title: sources.title,
      url: sources.url,
      ingestedAt: sources.ingestedAt,
    })
    .from(sources)
    .where(eq(sources.userId, user.id))
    .orderBy(sources.ingestedAt)
    .limit(50);

  return Response.json({ sources: rows });
}
