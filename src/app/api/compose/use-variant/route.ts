import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import {
  type ContentType,
  generations,
  posts,
  type Post,
} from "@/db/schema";
import { writeTrace } from "@/lib/trace";

const UseVariantRequest = z.object({
  generationId: z.string().uuid(),
  variantIndex: z.number().int().min(0).max(2),
});

type AllVariant = {
  index: number;
  overall?: number;
  scores?: Record<string, number>;
  critique?: string;
  texts: string[];
};

type GenInputMeta = {
  contentType?: ContentType;
  mode?: string;
  variants?: number;
  allVariants?: AllVariant[];
  winnerVariantIndex?: number;
};

async function insertPostChain(
  generationId: string,
  contentType: ContentType,
  texts: string[],
): Promise<Post[]> {
  const out: Post[] = [];
  let parentId: string | null = null;
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    if (!text) continue;
    const inserted: Post[] = await db
      .insert(posts)
      .values({
        generationId,
        parentPostId: parentId,
        threadPosition: contentType === "thread" ? i + 1 : null,
        contentType,
        text,
        status: "draft",
      })
      .returning();
    const row = inserted[0];
    if (!row) continue;
    out.push(row);
    if (i === 0 && contentType === "thread") parentId = row.id;
  }
  return out;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = UseVariantRequest.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { generationId, variantIndex } = parsed.data;

  const genRows = await db
    .select()
    .from(generations)
    .where(eq(generations.id, generationId))
    .limit(1);
  const gen = genRows[0];
  if (!gen) {
    return Response.json({ error: "generation not found" }, { status: 404 });
  }

  const meta = (gen.inputMeta ?? {}) as GenInputMeta;
  const variantsList = meta.allVariants ?? [];
  const target = variantsList.find((v) => v.index === variantIndex);
  if (!target) {
    return Response.json(
      { error: `variant ${variantIndex} not found in generation` },
      { status: 404 },
    );
  }

  const contentType: ContentType = meta.contentType ?? "single";

  // Find existing roots for this generation that are still actionable (draft / approved).
  // Mark them as skipped, so the new variant becomes the active draft.
  const existingRoots = await db
    .select()
    .from(posts)
    .where(
      and(
        eq(posts.generationId, generationId),
        isNull(posts.parentPostId),
      ),
    );

  const replaceable = existingRoots.filter(
    (p) => p.status === "draft" || p.status === "approved",
  );

  if (replaceable.length > 0) {
    await db
      .update(posts)
      .set({ status: "skipped", updatedAt: new Date() })
      .where(
        inArray(
          posts.id,
          replaceable.map((p) => p.id),
        ),
      );
  }

  const created = await insertPostChain(generationId, contentType, target.texts);

  await db
    .update(generations)
    .set({
      inputMeta: { ...meta, winnerVariantIndex: variantIndex },
    })
    .where(eq(generations.id, generationId));

  await writeTrace({
    generationId,
    agent: "compose",
    eventType: "variant_switched",
    payload: {
      newWinnerIndex: variantIndex,
      replacedPostIds: replaceable.map((p) => p.id),
      newPostIds: created.map((p) => p.id),
    },
  });

  return Response.json({
    ok: true,
    replacedPostIds: replaceable.map((p) => p.id),
    posts: created,
    variantIndex,
  });
}
