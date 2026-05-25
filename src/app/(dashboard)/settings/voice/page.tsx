import { eq } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { db } from "@/db/client";
import { fingerprints } from "@/db/schema";
import { extractFingerprint, type Fingerprint } from "@/lib/fingerprint";
import { VoiceForm } from "./voice-form";

export const dynamic = "force-dynamic";

type FingerprintProfile = {
  referenceTweets?: string[];
  fingerprint?: Fingerprint;
};

async function loadDefault(): Promise<{
  ok: boolean;
  referenceTweets: string[];
  fingerprint: Fingerprint | null;
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
    if (!row) {
      return {
        ok: true,
        referenceTweets: [],
        fingerprint: null,
        updatedAt: null,
      };
    }
    const profile = row.profile as FingerprintProfile;
    const refs = profile.referenceTweets ?? [];
    // Derive fingerprint on the fly if the stored one is missing (older rows).
    const fp = profile.fingerprint ?? (refs.length > 0 ? extractFingerprint(refs) : null);
    return {
      ok: true,
      referenceTweets: refs,
      fingerprint: fp,
      updatedAt: row.updatedAt.toISOString(),
    };
  } catch (e) {
    return {
      ok: false,
      referenceTweets: [],
      fingerprint: null,
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
            Reference tweets + extracted style fingerprint. Both used as
            steering signal in writer + editor.
          </p>
        </div>
        <Badge variant="outline" className="font-mono">
          slice 6
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
        <>
          {data.fingerprint && data.fingerprint.sampleCount > 0 ? (
            <FingerprintCard fingerprint={data.fingerprint} />
          ) : null}
          <VoiceForm
            initialTweets={data.referenceTweets}
            initialUpdatedAt={data.updatedAt}
          />
        </>
      )}
    </div>
  );
}

function FingerprintCard({ fingerprint }: { fingerprint: Fingerprint }) {
  const fp = fingerprint;
  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <header className="flex items-center gap-3">
        <h2 className="text-sm font-medium">Extracted fingerprint</h2>
        <Badge variant="outline" className="font-mono text-xs">
          {fp.sampleCount} samples
        </Badge>
      </header>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-xs md:grid-cols-3">
        <Stat label="avg length" value={`${fp.avgChars} chars · ${fp.avgWords} words`} />
        <Stat
          label="sentence (median / p90)"
          value={`${fp.sentenceLengthP50}w / ${fp.sentenceLengthP90}w`}
        />
        <Stat
          label="language"
          value={`${fp.languageMix.dominantLanguage} (cyr ${fp.languageMix.cyrillicPct}% / lat ${fp.languageMix.latinPct}%)`}
        />
        <Stat
          label="emoji rate"
          value={`${fp.emojiRatePerPost}/post`}
        />
        <Stat
          label="em-dash rate"
          value={`${fp.emDashRatePerPost}/post`}
        />
        <Stat label="ends w/o period" value={`${fp.endsWithoutPeriodPct}%`} />
        <Stat
          label="question / excl / ellipsis"
          value={`${fp.questionRate}% / ${fp.exclamationRate}% / ${fp.ellipsisRate}%`}
        />
        {fp.languageMix.kazakhMarkerCount > 0 ? (
          <Stat
            label="kazakh markers"
            value={`${fp.languageMix.kazakhMarkerCount} chars`}
          />
        ) : null}
        {fp.drawnOutVowelCount > 0 ? (
          <Stat
            label="drawn-out vowels"
            value={`${fp.drawnOutVowelCount}`}
          />
        ) : null}
      </dl>

      {fp.topCasualMarkers.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-xs">
          <span className="text-muted-foreground">casual markers:</span>
          {fp.topCasualMarkers.map((m) => (
            <Badge
              key={m.marker}
              variant="outline"
              className="font-mono"
            >
              {m.marker} · {m.count}
            </Badge>
          ))}
        </div>
      ) : null}

      <p className="font-mono text-xs text-muted-foreground">
        Re-extracted automatically on every save. Writer + editor receive this
        block as steering context alongside the raw samples.
      </p>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
