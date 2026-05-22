import { desc, sql } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { INFLUENCERS } from "@/config/influencers";
import { db } from "@/db/client";
import { viralPosts, type ViralPost } from "@/db/schema";
import { FetchButton } from "./fetch-button";

export const dynamic = "force-dynamic";

type EngagementMetrics = {
  likes?: number;
  retweets?: number;
  replies?: number;
  quotes?: number;
  bookmarks?: number;
  impressions?: number;
};

type Loaded =
  | { ok: true; rows: ViralPost[] }
  | { ok: false; error: string };

async function loadViral(): Promise<Loaded> {
  try {
    const rows = await db
      .select()
      .from(viralPosts)
      .orderBy(
        desc(
          sql<number>`coalesce((${viralPosts.engagement} ->> 'likes')::int, 0)`,
        ),
        desc(viralPosts.capturedAt),
      )
      .limit(50);
    return { ok: true, rows };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "unknown DB error",
    };
  }
}

function fmtCount(n: number | undefined): string {
  if (!n || n < 0) return "0";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}m`;
}

function relativeAge(d: Date | string): string {
  const ts = typeof d === "string" ? new Date(d).getTime() : d.getTime();
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default async function DiscoverPage() {
  const result = await loadViral();

  return (
    <div className="flex flex-col gap-6 p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Discover</h1>
          <p className="text-sm text-muted-foreground">
            Viral tweets from tracked tech voices. Generate takes or quote
            retweets from them.
          </p>
        </div>
        <Badge variant="outline" className="font-mono">
          slice 4a
        </Badge>
      </header>

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">
            Tracking {INFLUENCERS.length} accounts
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            {INFLUENCERS.map((i) => `@${i.username}`).join(" · ")}
          </p>
        </div>
        <FetchButton trackedCount={INFLUENCERS.length} />
      </section>

      {!result.ok ? (
        <DbErrorState message={result.error} />
      ) : result.rows.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-3">
          {result.rows.map((row) => (
            <ViralRow key={row.id} post={row} />
          ))}
        </div>
      )}
    </div>
  );
}

function ViralRow({ post }: { post: ViralPost }) {
  const m = (post.engagement ?? {}) as EngagementMetrics;
  const url =
    post.xUrl ??
    (post.xTweetId
      ? `https://x.com/${post.author ?? "i"}/status/${post.xTweetId}`
      : null);

  return (
    <article className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <header className="flex flex-wrap items-center gap-3 text-xs">
        <span className="font-mono font-semibold">@{post.author ?? "?"}</span>
        <span className="font-mono text-muted-foreground">
          captured {relativeAge(post.capturedAt)} ago
        </span>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto font-mono text-muted-foreground underline"
          >
            open on x →
          </a>
        ) : null}
      </header>

      <p className="whitespace-pre-wrap text-sm leading-relaxed">{post.text}</p>

      <footer className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <span className="font-mono text-muted-foreground">
          ♥ {fmtCount(m.likes)} · 🔁 {fmtCount(m.retweets)} · 💬{" "}
          {fmtCount(m.replies)} · 👁 {fmtCount(m.impressions)}
        </span>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="font-mono"
            disabled
            title="lands in slice 4b"
          >
            take
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="font-mono"
            disabled
            title="lands in slice 4c"
          >
            QRT
          </Button>
        </div>
      </footer>
    </article>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8">
      <p className="text-sm font-medium">No viral posts captured yet.</p>
      <p className="text-sm text-muted-foreground">
        Click <span className="font-mono">fetch viral</span> above to pull the
        latest from tracked accounts.
      </p>
    </div>
  );
}

function DbErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-6">
      <p className="text-sm font-semibold text-destructive">
        Couldn&apos;t reach the database.
      </p>
      <pre className="max-w-2xl overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
        {message}
      </pre>
    </div>
  );
}
