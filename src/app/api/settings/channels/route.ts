import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { profiles } from "@/db/schema";
import { requireUser } from "@/lib/auth";

const ChannelsRequest = z.object({
  accounts: z.array(
    z.object({
      username: z.string().min(1).max(50),
      name: z.string().max(100),
      topic: z.string().max(50).optional(),
      id: z.string().max(30).optional(),
    }),
  ).max(50),
});

export async function PUT(request: Request) {
  const user = await requireUser();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = ChannelsRequest.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  await db
    .update(profiles)
    .set({
      trackedAccounts: parsed.data.accounts,
      updatedAt: new Date(),
    })
    .where(eq(profiles.id, user.id));

  return Response.json({ ok: true, count: parsed.data.accounts.length });
}
