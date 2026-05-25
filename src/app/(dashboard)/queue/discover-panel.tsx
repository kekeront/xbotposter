"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ViralPost = {
  id: string;
  author: string | null;
  text: string;
  xUrl: string | null;
  xTweetId: string | null;
  engagement: {
    likes?: number;
    retweets?: number;
    replies?: number;
    impressions?: number;
  } | null;
  capturedAt: string;
};

type TrackedAccount = {
  username: string;
  name: string;
  topic?: string;
  id?: string;
};

function fmtCount(n: number | undefined): string {
  if (!n || n < 0) return "0";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}m`;
}

function relativeAge(d: string): string {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function DiscoverPanel({
  viralPosts,
  trackedAccounts,
  lastFetch,
}: {
  viralPosts: ViralPost[];
  trackedAccounts: TrackedAccount[];
  lastFetch: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editingChannels, setEditingChannels] = useState(false);
  const [channels, setChannels] = useState(trackedAccounts);
  const [newUsername, setNewUsername] = useState("");
  const [fetching, setFetching] = useState(false);
  const [savingChannels, setSavingChannels] = useState(false);

  async function handleFetch() {
    setFetching(true);
    try {
      await fetch("/api/discover/fetch", { method: "POST" });
      router.refresh();
    } finally {
      setFetching(false);
    }
  }

  async function handleSaveChannels() {
    setSavingChannels(true);
    try {
      await fetch("/api/settings/channels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts: channels }),
      });
      setEditingChannels(false);
      router.refresh();
    } finally {
      setSavingChannels(false);
    }
  }

  function addChannel() {
    const username = newUsername.replace(/^@/, "").trim();
    if (!username || channels.some((c) => c.username === username)) return;
    setChannels([...channels, { username, name: username }]);
    setNewUsername("");
  }

  function removeChannel(username: string) {
    setChannels(channels.filter((c) => c.username !== username));
  }

  return (
    <div className="rounded-lg border bg-card">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-4 font-mono text-xs">
          <span className="text-sm font-medium text-foreground">Discover</span>
          <span className="text-muted-foreground">
            {channels.length} channels · {viralPosts.length} viral posts
          </span>
          {lastFetch && (
            <span className="text-muted-foreground">
              fetched {relativeAge(lastFetch)} ago
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">
                  Tracking {channels.length} accounts
                </p>
                <button
                  onClick={() => setEditingChannels(!editingChannels)}
                  className="text-xs text-primary hover:underline"
                >
                  {editingChannels ? "cancel" : "edit"}
                </button>
              </div>
              {!editingChannels && (
                <p className="font-mono text-xs text-muted-foreground">
                  {channels.map((c) => `@${c.username}`).join(" · ")}
                </p>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleFetch}
              disabled={fetching}
              className="font-mono"
            >
              {fetching ? "fetching..." : "fetch viral"}
            </Button>
          </div>

          {editingChannels && (
            <div className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3">
              <div className="flex flex-wrap gap-2">
                {channels.map((c) => (
                  <span
                    key={c.username}
                    className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 font-mono text-xs"
                  >
                    @{c.username}
                    <button
                      onClick={() => removeChannel(c.username)}
                      className="ml-1 text-muted-foreground hover:text-destructive"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="@username"
                  className="h-7 max-w-48 font-mono text-xs"
                  onKeyDown={(e) => e.key === "Enter" && addChannel()}
                />
                <Button size="xs" variant="outline" onClick={addChannel}>
                  add
                </Button>
              </div>
              <Button
                size="sm"
                onClick={handleSaveChannels}
                disabled={savingChannels}
                className="self-start"
              >
                {savingChannels ? "saving..." : "save channels"}
              </Button>
            </div>
          )}

          {viralPosts.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No viral posts captured yet. Click &quot;fetch viral&quot; to pull the latest.
            </p>
          ) : (
            <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
              {viralPosts.map((post) => (
                <ViralRow key={post.id} post={post} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ViralRow({ post }: { post: ViralPost }) {
  const m = post.engagement ?? {};
  const url =
    post.xUrl ??
    (post.xTweetId
      ? `https://x.com/${post.author ?? "i"}/status/${post.xTweetId}`
      : null);

  return (
    <article className="flex flex-col gap-2 rounded-md border bg-muted/10 p-3">
      <header className="flex flex-wrap items-center gap-3 text-xs">
        <span className="font-mono font-semibold">@{post.author ?? "?"}</span>
        <span className="font-mono text-muted-foreground">
          {relativeAge(post.capturedAt)} ago
        </span>
        <span className="font-mono text-muted-foreground">
          ♥ {fmtCount(m.likes)} · 🔁 {fmtCount(m.retweets)} · 👁 {fmtCount(m.impressions)}
        </span>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto font-mono text-muted-foreground underline"
          >
            open →
          </a>
        )}
      </header>
      <p className="text-sm leading-relaxed">
        {post.text.length > 200 ? `${post.text.slice(0, 197)}...` : post.text}
      </p>
      <ViralActions viralPostId={post.id} />
    </article>
  );
}

function ViralActions({ viralPostId }: { viralPostId: string }) {
  const router = useRouter();
  const [running, setRunning] = useState<string | null>(null);

  async function run(action: "take" | "qrt") {
    setRunning(action);
    try {
      const endpoint = action === "take" ? "/api/discover/take" : "/api/discover/qrt";
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viralPostId }),
      });
      router.refresh();
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="flex gap-2">
      <Button
        size="xs"
        variant="ghost"
        onClick={() => run("take")}
        disabled={running !== null}
        className="font-mono text-xs"
      >
        {running === "take" ? "..." : "take"}
      </Button>
      <Button
        size="xs"
        variant="ghost"
        onClick={() => run("qrt")}
        disabled={running !== null}
        className="font-mono text-xs"
      >
        {running === "qrt" ? "..." : "qrt"}
      </Button>
    </div>
  );
}
