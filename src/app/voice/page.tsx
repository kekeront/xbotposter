import { eq } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { db } from "@/db/client";
import { fingerprints } from "@/db/schema";
import { VoiceForm } from "./voice-form";

export const dynamic = "force-dynamic";

type FingerprintProfile = {
  referenceTweets?: string[];
};

async function loadDefault(): Promise<{
  ok: boolean;
  referenceTweets: string[];
  updatedAt: string | null;
  error?: string;
}> {
  try {
    const rows = await db
      .select()
      .from(fingerprints)
      .where(eq(fingerprints.name, "default"))
      .limit(1);
    const row = rows[0];
    if (!row) return { ok: true, referenceTweets: [], updatedAt: null };
    const profile = row.profile as FingerprintProfile;
    return {
      ok: true,
      referenceTweets: profile.referenceTweets ?? [],
      updatedAt: row.updatedAt.toISOString(),
    };
  } catch (e) {
    return {
      ok: false,
      referenceTweets: [],
      updatedAt: null,
      error: e instanceof Error ? e.message : "unknown error",
    };
  }
}

export default async function VoicePage() {
  const data = await loadDefault();

  return (
    <div className="flex flex-col gap-6 p-8">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Voice</h1>
          <p className="text-sm text-muted-foreground">
            Reference tweets used as few-shot examples for every draft.
            Real style fingerprinting lands in slice 6.
          </p>
        </div>
        <Badge variant="outline" className="font-mono">
          slice 1
        </Badge>
      </header>

      {!data.ok ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6">
          <p className="text-sm font-semibold text-destructive">
            Couldn&apos;t load voice data.
          </p>
          <pre className="mt-2 max-w-2xl overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
            {data.error}
          </pre>
        </div>
      ) : (
        <VoiceForm
          initialTweets={data.referenceTweets}
          initialUpdatedAt={data.updatedAt}
        />
      )}
    </div>
  );
}
