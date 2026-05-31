import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/db/client";
import { profiles } from "@/db/schema";

export async function GET() {
  const user = await requireUser();
  const [row] = await db
    .select({ waveAutonomous: profiles.waveAutonomous })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);
  return Response.json({ waveAutonomous: row?.waveAutonomous ?? false });
}

const PutRequest = z.object({ waveAutonomous: z.boolean() });

export async function PUT(request: Request) {
  const user = await requireUser();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = PutRequest.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }
  await db
    .update(profiles)
    .set({ waveAutonomous: parsed.data.waveAutonomous, updatedAt: new Date() })
    .where(eq(profiles.id, user.id));
  return Response.json({ ok: true, waveAutonomous: parsed.data.waveAutonomous });
}
