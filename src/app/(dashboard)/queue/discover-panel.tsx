"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ─── Types ────────────────────────────────────────────────────────────────────

type DiscoveryKind =
  | "x"
  | "hn"
  | "arxiv"
  | "substack"
  | "manual"
  | "pdf"
  | "image";

type DiscoveryItem = {
  id: string;
  kind: DiscoveryKind;
  title: string | null;
  text: string;
  url: string | null;
  author: string | null;
  score: number;
  capturedAt: string;
  source: "viral" | "source";
  refId: string;
};

type TrackedAccount = {
  username: string;
  name: string;
  topic?: string;
  id?: string;
};

type FeedResponse = {
  items: DiscoveryItem[];
  total: number;
};

type PipelineStep =
  | "search"
  | "writer"
  | "editor"
  | "eval"
  | "factcheck"
  | "saving";

type PipelineState = {
  itemId: string;
  action: "take" | "qrt";
  step: PipelineStep | null;
  detail: string | null;
  error: string | null;
  done: boolean;
  blocked: boolean;
  blockedReason: string | null;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

const ALL_KINDS: DiscoveryKind[] = [
  "x",
  "hn",
  "arxiv",
  "substack",
  "manual",
  "pdf",
  "image",
];

const KIND_LABELS: Record<DiscoveryKind, string> = {
  x: "X",
  hn: "HN",
  arxiv: "arXiv",
  substack: "Substack",
  manual: "manual",
  pdf: "PDF",
  image: "image",
};

const PIPELINE_STEPS: PipelineStep[] = [
  "search",
  "writer",
  "editor",
  "eval",
  "factcheck",
  "saving",
];

const STEP_LABELS: Record<PipelineStep, string> = {
  search: "research",
  writer: "writer",
  editor: "editor",
  eval: "eval",
  factcheck: "fact-check",
  saving: "saving",
};

const UPLOAD_ACCEPT = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
].join(",");

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function buildFeedUrl(params: {
  kinds: DiscoveryKind[];
  query: string;
  sort: "recency" | "engagement";
  offset: number;
  limit: number;
}): string {
  const sp = new URLSearchParams();
  if (params.kinds.length > 0 && params.kinds.length < ALL_KINDS.length) {
    sp.set("kinds", params.kinds.join(","));
  }
  if (params.query.trim()) sp.set("q", params.query.trim());
  if (params.sort !== "recency") sp.set("sort", params.sort);
  sp.set("limit", String(params.limit));
  sp.set("offset", String(params.offset));
  return `/api/discover/feed?${sp.toString()}`;
}

function consumeSSE(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  handlers: Record<string, (payload: Record<string, unknown>) => void>,
  signal: AbortSignal,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  let eventType: string | null = null;

  async function pump(): Promise<void> {
    while (true) {
      if (signal.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith("data: ") && eventType) {
          const payload = JSON.parse(line.slice(6)) as Record<string, unknown>;
          handlers[eventType]?.(payload);
          eventType = null;
        }
      }
    }
  }

  return pump();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KindBadge({ kind }: { kind: DiscoveryKind }) {
  const colorMap: Record<DiscoveryKind, string> = {
    x: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
    hn: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
    arxiv: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
    substack: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    manual: "bg-muted text-muted-foreground",
    pdf: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    image: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  };
  return (
    <span
      className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${colorMap[kind]}`}
    >
      {KIND_LABELS[kind]}
    </span>
  );
}

function PipelineIndicator({ state }: { state: PipelineState }) {
  if (state.blocked) {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
        blocked: {state.blockedReason ?? "topic guard rejected"}
      </div>
    );
  }
  if (state.error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 font-mono text-xs text-destructive">
        {state.error}
      </div>
    );
  }
  if (state.done) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 font-mono text-xs text-emerald-700 dark:text-emerald-400">
        <span>done — draft added to queue</span>
      </div>
    );
  }

  const currentIndex = state.step
    ? PIPELINE_STEPS.indexOf(state.step)
    : -1;

  return (
    <div className="flex flex-col gap-1.5 rounded-md border bg-muted/30 px-3 py-2">
      <div className="flex items-center gap-1.5 overflow-x-auto">
        {PIPELINE_STEPS.map((s, i) => {
          const isActive = s === state.step;
          const isDone = currentIndex > i;
          return (
            <span
              key={s}
              className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                isActive
                  ? "bg-foreground text-background"
                  : isDone
                    ? "bg-muted text-foreground/50"
                    : "text-muted-foreground/40"
              }`}
            >
              {STEP_LABELS[s]}
            </span>
          );
        })}
      </div>
      {state.detail ? (
        <span className="font-mono text-[10px] text-muted-foreground">
          {state.detail}
        </span>
      ) : null}
    </div>
  );
}

function DiscoveryItemRow({
  item,
  expandedByDefault,
}: {
  item: DiscoveryItem;
  expandedByDefault?: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(expandedByDefault ?? false);
  const [pipeline, setPipeline] = useState<PipelineState | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Abort any in-flight pipeline stream if the row unmounts (e.g. navigation).
  useEffect(() => () => abortRef.current?.abort(), []);

  const isXKind = item.kind === "x" && item.source === "viral";

  async function runAction(action: "take" | "qrt") {
    if (pipeline && !pipeline.done && !pipeline.error && !pipeline.blocked)
      return;

    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 120_000);

    setPipeline({
      itemId: item.id,
      action,
      step: null,
      detail: null,
      error: null,
      done: false,
      blocked: false,
      blockedReason: null,
    });

    try {
      const endpoint =
        action === "take" ? "/api/discover/take" : "/api/discover/qrt";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viralPostId: item.refId }),
        signal: controller.signal,
      });

      // The route may return a plain JSON response (blocked or early error)
      // before streaming starts, or a text/event-stream.
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("text/event-stream")) {
        const data = (await res.json()) as {
          error?: string;
          blocked?: boolean;
          reason?: string;
        };
        if (data.blocked) {
          setPipeline((prev) =>
            prev
              ? {
                  ...prev,
                  blocked: true,
                  blockedReason: data.reason ?? null,
                }
              : prev,
          );
          return;
        }
        if (!res.ok) {
          setPipeline((prev) =>
            prev
              ? {
                  ...prev,
                  error: data.error ?? `HTTP ${res.status}`,
                }
              : prev,
          );
          return;
        }
        // unexpected json success — treat as done
        setPipeline((prev) =>
          prev ? { ...prev, done: true } : prev,
        );
        router.refresh();
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setPipeline((prev) =>
          prev ? { ...prev, error: "no response body" } : prev,
        );
        return;
      }

      await consumeSSE(
        reader,
        {
          progress: (p) => {
            setPipeline((prev) =>
              prev
                ? {
                    ...prev,
                    step: (p.step as PipelineStep) ?? prev.step,
                    detail: (p.detail as string) ?? null,
                  }
                : prev,
            );
          },
          result: () => {
            setPipeline((prev) =>
              prev ? { ...prev, done: true, step: null, detail: null } : prev,
            );
            router.refresh();
          },
          error: (p) => {
            setPipeline((prev) =>
              prev
                ? {
                    ...prev,
                    error: (p.message as string) ?? "pipeline failed",
                    step: null,
                    detail: null,
                  }
                : prev,
            );
          },
        },
        controller.signal,
      );

      // consumeSSE can resolve cleanly (not throw) when the abort fires after
      // streaming has begun — surface the timeout instead of a frozen spinner.
      if (controller.signal.aborted) {
        setPipeline((prev) => (prev ? { ...prev, error: "timed out" } : prev));
      }
    } catch (e) {
      if (controller.signal.aborted) {
        setPipeline((prev) =>
          prev ? { ...prev, error: "timed out" } : prev,
        );
      } else {
        setPipeline((prev) =>
          prev
            ? {
                ...prev,
                error: e instanceof Error ? e.message : "unknown error",
              }
            : prev,
        );
      }
    } finally {
      clearTimeout(timeout);
      abortRef.current = null;
    }
  }

  const isRunning =
    pipeline !== null &&
    !pipeline.done &&
    !pipeline.error &&
    !pipeline.blocked;

  const MAX_PREVIEW = 200;

  return (
    <article className="flex flex-col gap-2 rounded-md border bg-muted/10 p-3">
      <header className="flex flex-wrap items-center gap-2 text-xs">
        <KindBadge kind={item.kind} />
        {item.author ? (
          <span className="font-mono font-semibold">@{item.author}</span>
        ) : null}
        {item.title ? (
          <span className="min-w-0 flex-1 truncate font-medium text-foreground">
            {item.title}
          </span>
        ) : null}
        <span className="font-mono text-muted-foreground">
          {relativeAge(item.capturedAt)} ago
        </span>
        {item.score > 0 ? (
          <span className="font-mono text-muted-foreground">
            ♥ {fmtCount(item.score)}
          </span>
        ) : null}
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto font-mono text-muted-foreground underline"
          >
            open →
          </a>
        ) : null}
      </header>

      <div>
        <p className="text-sm leading-relaxed">
          {expanded || item.text.length <= MAX_PREVIEW
            ? item.text
            : `${item.text.slice(0, MAX_PREVIEW)}…`}
        </p>
        {item.text.length > MAX_PREVIEW ? (
          <button
            onClick={() => setExpanded((x) => !x)}
            className="mt-1 font-mono text-[10px] text-muted-foreground underline hover:text-foreground"
          >
            {expanded ? "collapse" : "expand"}
          </button>
        ) : null}
      </div>

      {isXKind ? (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Button
              size="xs"
              variant="ghost"
              onClick={() => runAction("take")}
              disabled={isRunning}
              className="font-mono text-xs"
            >
              {isRunning && pipeline?.action === "take" ? "..." : "take"}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => runAction("qrt")}
              disabled={isRunning}
              className="font-mono text-xs"
            >
              {isRunning && pipeline?.action === "qrt" ? "..." : "qrt"}
            </Button>
          </div>
          {pipeline ? <PipelineIndicator state={pipeline} /> : null}
        </div>
      ) : null}
    </article>
  );
}

// ─── Upload Control ───────────────────────────────────────────────────────────

type UploadStatus =
  | { kind: "idle" }
  | { kind: "uploading"; filename: string }
  | { kind: "success"; filename: string; parsedKind: string; costUsd: number }
  | { kind: "error"; message: string };

function UploadControl({ onSuccess }: { onSuccess: () => void }) {
  const [status, setStatus] = useState<UploadStatus>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  async function uploadFile(file: File) {
    setStatus({ kind: "uploading", filename: file.name });
    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: fd,
      });

      const data = (await res.json()) as {
        error?: string;
        parse?: { kind: string; costUsd: number };
      };

      if (!res.ok) {
        setStatus({
          kind: "error",
          message: data.error ?? `Upload failed (HTTP ${res.status})`,
        });
        return;
      }

      setStatus({
        kind: "success",
        filename: file.name,
        parsedKind: data.parse?.kind ?? "unknown",
        costUsd: data.parse?.costUsd ?? 0,
      });
      onSuccess();
    } catch (e) {
      setStatus({
        kind: "error",
        message: e instanceof Error ? e.message : "upload failed",
      });
    }
  }

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (file) uploadFile(file);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragging(true);
  }

  function handleDragLeave() {
    setDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  const isUploading = status.kind === "uploading";

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={dropRef}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed px-4 py-3 text-xs transition-colors ${
          dragging
            ? "border-foreground/40 bg-muted/40"
            : "border-border hover:border-foreground/30 hover:bg-muted/20"
        }`}
        onClick={() => !isUploading && inputRef.current?.click()}
      >
        <span className="text-muted-foreground">
          {isUploading
            ? `parsing ${(status as { kind: "uploading"; filename: string }).filename}…`
            : "drop PDF or image here, or click to browse"}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground/60">
          PDF · PNG · JPG · WebP · GIF · max 10 MB
        </span>
        <input
          ref={inputRef}
          type="file"
          accept={UPLOAD_ACCEPT}
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
          disabled={isUploading}
        />
      </div>

      {status.kind === "success" ? (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 font-mono text-xs text-emerald-700 dark:text-emerald-400">
          <span>
            {status.filename} parsed as {status.parsedKind} · $
            {status.costUsd.toFixed(5)}
          </span>
          <button
            onClick={() => setStatus({ kind: "idle" })}
            className="ml-auto text-muted-foreground hover:text-foreground"
          >
            ×
          </button>
        </div>
      ) : status.kind === "error" ? (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 font-mono text-xs text-destructive">
          <span>{status.message}</span>
          <button
            onClick={() => setStatus({ kind: "idle" })}
            className="ml-auto text-muted-foreground hover:text-foreground"
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function DiscoverPanel({
  initialItems,
  initialTotal,
  trackedAccounts: initialTrackedAccounts,
  lastFetch,
}: {
  initialItems: DiscoveryItem[];
  initialTotal: number;
  trackedAccounts: TrackedAccount[];
  lastFetch: string | null;
}) {
  const router = useRouter();

  // ── Panel open/close ──────────────────────────────────────────────────────
  const [open, setOpen] = useState(false);

  // ── Feed state ────────────────────────────────────────────────────────────
  const [items, setItems] = useState<DiscoveryItem[]>(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [offset, setOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);

  // ── Filter / sort state ───────────────────────────────────────────────────
  const [kindFilter, setKindFilter] = useState<DiscoveryKind[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recency" | "engagement">("recency");

  // ── Fetch-fetch state (manual refresh) ────────────────────────────────────
  const [fetching, setFetching] = useState(false);

  // ── Channel editor state ──────────────────────────────────────────────────
  const [editingChannels, setEditingChannels] = useState(false);
  const [channels, setChannels] = useState<TrackedAccount[]>(
    initialTrackedAccounts,
  );
  const [newUsername, setNewUsername] = useState("");
  const [savingChannels, setSavingChannels] = useState(false);
  const [channelsLoaded, setChannelsLoaded] = useState(false);

  // Prefill channels from API when the editor opens.
  useEffect(() => {
    if (!editingChannels || channelsLoaded) return;

    fetch("/api/settings/channels")
      .then((res) => res.json() as Promise<{ accounts: TrackedAccount[] }>)
      .then((data) => {
        setChannels(data.accounts ?? []);
        setChannelsLoaded(true);
      })
      .catch(() => {
        // Keep the prop-initialised value on error.
        setChannelsLoaded(true);
      });
  }, [editingChannels, channelsLoaded]);

  // ── Feed fetch ────────────────────────────────────────────────────────────
  const loadFeed = useCallback(
    async (newOffset: number, replace: boolean) => {
      setFeedError(null);
      if (replace) {
        setItems([]);
        setTotal(0);
      }
      try {
        const url = buildFeedUrl({
          kinds: kindFilter,
          query,
          sort,
          offset: newOffset,
          limit: PAGE_SIZE,
        });
        const res = await fetch(url);
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          setFeedError(data.error ?? `HTTP ${res.status}`);
          return;
        }
        const data = (await res.json()) as FeedResponse;
        if (replace) {
          setItems(data.items);
        } else {
          setItems((prev) => [...prev, ...data.items]);
        }
        setTotal(data.total);
        setOffset(newOffset);
      } catch (e) {
        setFeedError(
          e instanceof Error ? e.message : "failed to load feed",
        );
      }
    },
    [kindFilter, query, sort],
  );

  // Re-query when filters/sort change (but only once the panel is open to
  // avoid unnecessary network requests on mount).
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadFeed(0, true);
  }, [kindFilter, sort, open, loadFeed]);

  // Debounce the query field.
  const queryDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleQueryChange(v: string) {
    setQuery(v);
    if (queryDebounceRef.current) clearTimeout(queryDebounceRef.current);
    queryDebounceRef.current = setTimeout(() => {
      if (open) loadFeed(0, true);
    }, 350);
  }

  async function loadMore() {
    setLoadingMore(true);
    try {
      await loadFeed(offset + PAGE_SIZE, false);
    } finally {
      setLoadingMore(false);
    }
  }

  // ── Manual fetch-viral ────────────────────────────────────────────────────
  async function handleFetch() {
    setFetching(true);
    setFeedError(null);
    try {
      const res = await fetch("/api/discover/fetch", { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setFeedError(data.error ?? `fetch failed (HTTP ${res.status})`);
        return;
      }
      await loadFeed(0, true);
      router.refresh();
    } catch (e) {
      setFeedError(e instanceof Error ? e.message : "fetch failed");
    } finally {
      setFetching(false);
    }
  }

  // ── Channel actions ───────────────────────────────────────────────────────
  async function handleSaveChannels() {
    setSavingChannels(true);
    setFeedError(null);
    try {
      const res = await fetch("/api/settings/channels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts: channels }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setFeedError(data.error ?? `save failed (HTTP ${res.status})`);
        return;
      }
      setEditingChannels(false);
      router.refresh();
    } catch (e) {
      setFeedError(e instanceof Error ? e.message : "save failed");
    } finally {
      setSavingChannels(false);
    }
  }

  function addChannel() {
    const username = newUsername.replace(/^@/, "").trim();
    if (!username || channels.some((c) => c.username === username)) return;
    setChannels((prev) => [...prev, { username, name: username }]);
    setNewUsername("");
  }

  function removeChannel(username: string) {
    setChannels((prev) => prev.filter((c) => c.username !== username));
  }

  // ── Kind filter toggle ────────────────────────────────────────────────────
  function toggleKind(k: DiscoveryKind) {
    setKindFilter((prev) =>
      prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k],
    );
  }

  // ── Upload success handler ────────────────────────────────────────────────
  function handleUploadSuccess() {
    loadFeed(0, true);
  }

  const hasMore = items.length < total;

  return (
    <div className="rounded-lg border bg-card">
      {/* Header / toggle */}
      <button
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next && items.length === 0 && initialItems.length === 0) {
            loadFeed(0, true);
          }
        }}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-4 font-mono text-xs">
          <span className="text-sm font-medium text-foreground">Discover</span>
          <span className="text-muted-foreground">
            {channels.length} channels · {total} items
          </span>
          {lastFetch ? (
            <span className="text-muted-foreground">
              fetched {relativeAge(lastFetch)} ago
            </span>
          ) : null}
        </div>
        <span className="text-xs text-muted-foreground">{open ? "▲" : "▼"}</span>
      </button>

      {open ? (
        <div className="flex flex-col gap-4 border-t px-4 py-3">
          {/* Channel editor + fetch button */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">
                  Tracking {channels.length} accounts
                </p>
                <button
                  onClick={() => setEditingChannels((x) => !x)}
                  className="text-xs text-primary hover:underline"
                >
                  {editingChannels ? "cancel" : "edit"}
                </button>
              </div>
              {!editingChannels ? (
                <p className="font-mono text-xs text-muted-foreground">
                  {channels.map((c) => `@${c.username}`).join(" · ")}
                </p>
              ) : null}
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

          {editingChannels ? (
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
          ) : null}

          {/* Upload control */}
          <UploadControl onSuccess={handleUploadSuccess} />

          {/* Filters: kind chips + sort + search */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10px] text-muted-foreground">
                filter:
              </span>
              {ALL_KINDS.map((k) => {
                const active =
                  kindFilter.length === 0 || kindFilter.includes(k);
                const pinned = kindFilter.includes(k);
                return (
                  <button
                    key={k}
                    onClick={() => toggleKind(k)}
                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                      pinned
                        ? "bg-foreground text-background"
                        : kindFilter.length === 0
                          ? "bg-muted text-muted-foreground hover:bg-muted/70"
                          : "bg-muted/40 text-muted-foreground/50 hover:bg-muted/70"
                    }`}
                    title={active ? `hide ${k}` : `show only ${k}`}
                  >
                    {KIND_LABELS[k]}
                  </button>
                );
              })}
              {kindFilter.length > 0 ? (
                <button
                  onClick={() => setKindFilter([])}
                  className="font-mono text-[10px] text-muted-foreground underline hover:text-foreground"
                >
                  clear
                </button>
              ) : null}
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                sort:
              </span>
              {(["recency", "engagement"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSort(s)}
                  className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                    sort === s
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground hover:bg-muted/70"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <Input
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="search feed..."
              className="h-7 font-mono text-xs"
            />
          </div>

          {/* Feed content */}
          {feedError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 font-mono text-xs text-destructive">
              {feedError}
            </div>
          ) : items.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {kindFilter.length > 0 || query.trim()
                ? "No items match the current filters."
                : "No items yet. Click “fetch viral” or upload a PDF/image."}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {items.map((item) => (
                <DiscoveryItemRow key={`${item.source}-${item.id}`} item={item} />
              ))}

              {hasMore ? (
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="rounded-md border bg-muted/20 py-2 font-mono text-xs text-muted-foreground hover:bg-muted/40 disabled:opacity-50"
                >
                  {loadingMore
                    ? "loading..."
                    : `load more (${total - items.length} remaining)`}
                </button>
              ) : (
                <p className="text-center font-mono text-[10px] text-muted-foreground/50">
                  {total} item{total !== 1 ? "s" : ""} total
                </p>
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
