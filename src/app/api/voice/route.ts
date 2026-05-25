import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { fingerprints } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { extractFingerprint, type Fingerprint } from "@/lib/fingerprint";

const DEFAULT_NAME = "default";

const SaveRequest = z.object({
  referenceTweets: z.array(z.string().min(1).max(2000)).max(200),
});

type FingerprintProfile = {
  referenceTweets?: string[];
  fingerprint?: Fingerprint;
};

export async function GET() {
  const user = await requireUser();
  const rows = await db
    .select()
    .from(fingerprints)
    .where(and(eq(fingerprints.name, DEFAULT_NAME), eq(fingerprints.userId, user.id)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return Response.json({
      referenceTweets: [],
      fingerprint: null,
      updatedAt: null,
    });
  }
  const profile = row.profile as FingerprintProfile;
  return Response.json({
    referenceTweets: profile.referenceTweets ?? [],
    fingerprint: profile.fingerprint ?? null,
    updatedAt: row.updatedAt,
  });
}

export async function POST(request: Request) {
  const user = await requireUser();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = SaveRequest.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const referenceTweets = parsed.data.referenceTweets
    .map((t) => t.trim())
    .filter(Boolean);

  const fingerprint = extractFingerprint(referenceTweets);
  const profile: FingerprintProfile = { referenceTweets, fingerprint };

  const existing = await db
    .select()
    .from(fingerprints)
    .where(and(eq(fingerprints.name, DEFAULT_NAME), eq(fingerprints.userId, user.id)))
    .limit(1);

  if (existing[0]) {
    const [updated] = await db
      .update(fingerprints)
      .set({
        profile,
        sampleCount: referenceTweets.length,
        updatedAt: new Date(),
      })
      .where(eq(fingerprints.id, existing[0].id))
      .returning();
    return Response.json({ ...updated, fingerprint });
  }

  const [created] = await db
    .insert(fingerprints)
    .values({
      userId: user.id,
      name: DEFAULT_NAME,
      profile,
      sampleCount: referenceTweets.length,
    })
    .returning();
  return Response.json({ ...created, fingerprint }, { status: 201 });
}
