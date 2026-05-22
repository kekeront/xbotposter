import { z } from "zod";
import { db } from "@/db/client";
import { generations, posts } from "@/db/schema";

const ComposeRequest = z.object({
  topic: z.string().min(1).max(500),
  contentType: z.enum(["single", "thread"]).default("single"),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = ComposeRequest.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { topic, contentType } = parsed.data;

  // Slice 0: prove the DB write path. Real generation lands in slice 1.
  const [generation] = await db
    .insert(generations)
    .values({
      topic,
      inputMeta: { contentType, slice: 0 },
      status: "succeeded",
    })
    .returning();

  if (!generation) {
    return Response.json({ error: "insert failed" }, { status: 500 });
  }

  const [post] = await db
    .insert(posts)
    .values({
      generationId: generation.id,
      contentType,
      text: `[slice 0 placeholder] Draft for: ${topic}`,
      status: "draft",
    })
    .returning();

  return Response.json({ generation, post }, { status: 201 });
}
