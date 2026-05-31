import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/db/client";
import { generations, posts } from "@/db/schema";

const QueueRequest = z.object({
  topic: z.string().min(1).max(2000),
  text: z.string().min(1).max(4000),
  hook: z.string().max(500).optional(),
});

// Promote a wave-shot preview into a queued draft. The preview is a writer-only
// draft; it lands as status "draft" so the user reviews/edits in the queue.
export async function POST(request: Request) {
  const user = await requireUser();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = QueueRequest.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { topic, text, hook } = parsed.data;

  const [generation] = await db
    .insert(generations)
    .values({
      userId: user.id,
      topic,
      inputMeta: { mode: "wave-shot", hook: hook ?? null },
      status: "succeeded",
      model: "wave-shot",
      tokensIn: 0,
      tokensOut: 0,
      costUsd: "0",
      completedAt: new Date(),
    })
    .returning();

  if (!generation) {
    return Response.json(
      { error: "failed to create generation row" },
      { status: 500 },
    );
  }

  const [post] = await db
    .insert(posts)
    .values({
      userId: user.id,
      generationId: generation.id,
      parentPostId: null,
      threadPosition: null,
      contentType: "single",
      text,
      status: "draft",
    })
    .returning();

  return Response.json({ ok: true, post });
}
