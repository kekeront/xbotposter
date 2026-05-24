"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

type ContentType = "single" | "thread";
type Mode = "ai" | "manual" | "bulk";

type EvalScores = {
  insightDensity: number;
  voiceMatch: number;
  antiSlop: number;
  charFit: number;
  language: number;
  faithfulness: number;
};

type VariantSummary = {
  index: number;
  texts: string[];
  overall: number;
  scores: EvalScores;
  critique: string;
  isWinner: boolean;
};

type ComposeResult = {
  generation: {
    id: string;
    status: "succeeded";
    model: string;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
  };
  eval?: {
    scores: EvalScores;
    overall: number;
    critique: string;
  };
  variants?: VariantSummary[];
  posts: Array<{
    id: string;
    text: string;
    threadPosition: number | null;
  }>;
};

type BulkAngleResult = {
  angleIndex: number;
  hook: string;
  generationId: string;
  texts: string[];
  overall: number;
  scores: Record<string, number>;
  critique: string;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  model: string;
  posts: Array<{
    id: string;
    text: string;
    threadPosition: number | null;
  }>;
};

type BulkResult = {
  totalAngles: number;
  completedAngles: number;
  totalCostUsd: number;
  results: BulkAngleResult[];
};

const X_SOFT_LIMIT = 280;

const STEP_LABELS: Record<string, string> = {
  search: "researching topic",
  angles: "generating angles",
  memory: "recalling memory",
  outline: "planning thread",
  writer: "writing draft",
  editor: "editing",
  eval: "scoring + fact-checking",
  saving: "saving to queue",
};

const CLIENT_TIMEOUT_MS = 120_000;
const BULK_CLIENT_TIMEOUT_MS = 300_000;

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2 py-1 ${
        active
          ? "bg-foreground text-background"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}

const MODE_STORAGE_KEY = "nfactz.compose.mode";

function readStoredMode(): Mode {
  if (typeof window === "undefined") return "ai";
  const v = window.localStorage.getItem(MODE_STORAGE_KEY);
  if (v === "manual" || v === "bulk") return v;
  return "ai";
}

function useElapsed(running: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(0);

  useEffect(() => {
    if (!running) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setElapsed(0);
      return;
    }
    startRef.current = Date.now();
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [running]);

  return elapsed;
}

function fmtElapsed(s: number): string {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
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
          const payload = JSON.parse(line.slice(6));
          handlers[eventType]?.(payload);
          eventType = null;
        }
      }
    }
  }

  return pump();
}

export function ComposeForm() {
  const [topic, setTopic] = useState("");
  const [contentType, setContentType] = useState<ContentType>("single");
  const [mode, setMode] = useState<Mode>("ai");
  const [variants, setVariants] = useState<1 | 2 | 3>(1);
  const [angleCount, setAngleCount] = useState<2 | 3 | 4 | 5 | 6>(3);
  const [status, setStatus] = useState<
    "idle" | "generating" | "done" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ComposeResult | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [bulkAngles, setBulkAngles] = useState<
    Array<{ angle: string; hook: string }> | null
  >(null);
  const [bulkProgress, setBulkProgress] = useState<BulkAngleResult[]>([]);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [stepDetail, setStepDetail] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);

  const elapsed = useElapsed(status === "generating");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(readStoredMode());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  }, [mode]);

  const isManual = mode === "manual";
  const isBulk = mode === "bulk";
  const trimmed = topic.trim();
  const charCount = trimmed.length;
  const overSoftLimit =
    isManual && contentType === "single" && charCount > X_SOFT_LIMIT;
  const hasUrl = isManual && /\bhttps?:\/\/\S+/i.test(topic);

  function abort() {
    cancelledRef.current = true;
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("error");
    setError("cancelled");
    setCurrentStep(null);
    setStepDetail(null);
  }

  async function submit() {
    if (!trimmed) return;
    setStatus("generating");
    setError(null);
    setResult(null);
    setBulkResult(null);
    setBulkAngles(null);
    setBulkProgress([]);
    setCurrentStep(null);
    setStepDetail(null);
    cancelledRef.current = false;

    if (isBulk) {
      await submitBulk();
    } else {
      await submitSingle();
    }
  }

  async function submitSingle() {
    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

    try {
      const res = await fetch("/api/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          contentType,
          mode,
          variants: isManual ? 1 : variants,
        }),
        signal: controller.signal,
      });

      if (
        !res.ok ||
        !res.headers.get("content-type")?.includes("text/event-stream")
      ) {
        const data = await res.json();
        if (!res.ok) {
          const err = data as { error: string; message?: string };
          throw new Error(err.message ?? err.error ?? `HTTP ${res.status}`);
        }
        setResult(data as ComposeResult);
        setStatus("done");
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("no response body");

      await consumeSSE(
        reader,
        {
          progress: (p) => {
            setCurrentStep(p.step as string);
            setStepDetail((p.detail as string) ?? null);
          },
          result: (p) => {
            setResult(p as unknown as ComposeResult);
            setStatus("done");
            setCurrentStep(null);
            setStepDetail(null);
          },
          error: (p) => {
            throw new Error(
              (p.message as string) ?? "generation failed",
            );
          },
        },
        controller.signal,
      );
    } catch (e) {
      if (cancelledRef.current) {
        // abort() already set the error
      } else if (controller.signal.aborted) {
        setError("timed out — try fewer variants or a shorter topic");
      } else {
        setError(e instanceof Error ? e.message : "unknown error");
      }
      setStatus("error");
      setCurrentStep(null);
      setStepDetail(null);
    } finally {
      clearTimeout(timeout);
      abortRef.current = null;
    }
  }

  async function submitBulk() {
    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = setTimeout(
      () => controller.abort(),
      BULK_CLIENT_TIMEOUT_MS,
    );

    try {
      const res = await fetch("/api/compose/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, contentType, angles: angleCount }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json();
        const err = data as { error: string; message?: string };
        throw new Error(err.message ?? err.error ?? `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("no response body");

      await consumeSSE(
        reader,
        {
          progress: (p) => {
            setCurrentStep(p.step as string);
            setStepDetail((p.detail as string) ?? null);
          },
          angles_ready: (p) => {
            setBulkAngles(
              p.angles as Array<{ angle: string; hook: string }>,
            );
          },
          angle_done: (p) => {
            setBulkProgress((prev) => [
              ...prev,
              p as unknown as BulkAngleResult,
            ]);
          },
          angle_error: (p) => {
            setBulkProgress((prev) => [
              ...prev,
              {
                angleIndex: p.angleIndex as number,
                hook: p.hook as string,
                generationId: "",
                texts: [],
                overall: 0,
                scores: {},
                critique: (p.message as string) ?? "failed",
                costUsd: 0,
                tokensIn: 0,
                tokensOut: 0,
                model: "",
                posts: [],
              },
            ]);
          },
          spend_cap: (p) => {
            setError(
              `spend cap hit after ${p.completedAngles}/${p.totalAngles} angles — ${p.message}`,
            );
          },
          result: (p) => {
            setBulkResult(p as unknown as BulkResult);
            setStatus("done");
            setCurrentStep(null);
            setStepDetail(null);
          },
          error: (p) => {
            throw new Error(
              (p.message as string) ?? "bulk generation failed",
            );
          },
        },
        controller.signal,
      );
    } catch (e) {
      if (cancelledRef.current) {
        // abort() already set the error
      } else if (controller.signal.aborted) {
        setError("timed out — try fewer angles");
      } else {
        setError(e instanceof Error ? e.message : "unknown error");
      }
      setStatus("error");
      setCurrentStep(null);
      setStepDetail(null);
    } finally {
      clearTimeout(timeout);
      abortRef.current = null;
    }
  }

  const label = isManual
    ? "Tweet text"
    : isBulk
      ? "Topic (one idea, multiple angles)"
      : "Idea / topic";
  const placeholder = isManual
    ? contentType === "thread"
      ? `Type the exact tweets, separated by --- on its own line.\n\nExample:\n\nfirst tweet here\n---\nsecond tweet\n---\nthird tweet`
      : `Type the exact tweet you want to ship.\n\nExample: just shipped a thing. small win, but a win.`
    : `Paste a thought, a link, a rough idea. Anything.\n\nExample: small models are getting weirdly close to frontier on narrow tasks. write a take.`;

  const buttonLabel = (() => {
    if (status === "generating") {
      if (isBulk) return `generating ${angleCount} angles...`;
      if (isManual) return "queueing...";
      return variants > 1 ? `drafting ${variants}x...` : "drafting...";
    }
    if (isBulk) return `bulk ${angleCount}`;
    if (isManual) return "queue";
    return variants > 1 ? `draft ${variants}` : "draft";
  })();

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <label
              htmlFor="topic"
              className="text-sm font-medium text-muted-foreground"
            >
              {label}
            </label>
            <div className="ml-auto flex flex-wrap items-center gap-2 font-mono text-xs">
              <ToggleButton
                active={mode === "ai"}
                onClick={() => setMode("ai")}
              >
                ai draft
              </ToggleButton>
              <ToggleButton
                active={mode === "bulk"}
                onClick={() => setMode("bulk")}
              >
                bulk
              </ToggleButton>
              <ToggleButton
                active={mode === "manual"}
                onClick={() => setMode("manual")}
              >
                manual
              </ToggleButton>
              <span className="text-muted-foreground/40">·</span>
              <ToggleButton
                active={contentType === "single"}
                onClick={() => setContentType("single")}
              >
                single
              </ToggleButton>
              <ToggleButton
                active={contentType === "thread"}
                onClick={() => setContentType("thread")}
              >
                thread
              </ToggleButton>
              {mode === "ai" ? (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <span className="text-muted-foreground">variants:</span>
                  {([1, 2, 3] as const).map((n) => (
                    <ToggleButton
                      key={n}
                      active={variants === n}
                      onClick={() => setVariants(n)}
                    >
                      {n}
                    </ToggleButton>
                  ))}
                </>
              ) : null}
              {isBulk ? (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <span className="text-muted-foreground">angles:</span>
                  {([2, 3, 4, 5, 6] as const).map((n) => (
                    <ToggleButton
                      key={n}
                      active={angleCount === n}
                      onClick={() => setAngleCount(n)}
                    >
                      {n}
                    </ToggleButton>
                  ))}
                </>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Textarea
            id="topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={isManual ? 8 : 6}
            placeholder={placeholder}
            disabled={status === "generating"}
          />
          {hasUrl ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 font-mono text-xs text-amber-900 dark:text-amber-200">
              This tweet contains a URL. X charges{" "}
              <span className="font-semibold">$0.20</span> per tweet with a
              link vs $0.015 without — a{" "}
              <span className="font-semibold">13x</span> difference. Strip
              the link if you can post it as a reply or QRT instead.
            </div>
          ) : null}

          {status === "generating" ? (
            <ProgressBar
              step={currentStep}
              detail={stepDetail}
              elapsed={elapsed}
              onCancel={abort}
              completedAngles={isBulk ? bulkProgress.length : undefined}
              totalAngles={isBulk ? angleCount : undefined}
            />
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {isManual ? (
                <span>
                  Manual mode — text is queued as-is. No AI rewrite, no OpenAI
                  call.
                </span>
              ) : isBulk ? (
                <span>
                  Bulk mode — generates {angleCount} different angles, each
                  through writer → editor → evaluator. Runs sequentially,
                  spend-capped per angle.
                </span>
              ) : (
                <span>
                  Writer → editor → evaluator.{" "}
                  {variants > 1
                    ? `${variants} variants, top score wins.`
                    : "1 variant."}{" "}
                  Voice from{" "}
                  <Link href="/voice" className="underline">
                    Voice
                  </Link>
                  .
                </span>
              )}
            </p>
            <div className="flex items-center gap-3">
              {isManual ? (
                <span
                  className={`font-mono text-xs ${
                    overSoftLimit
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }`}
                >
                  {charCount}
                  {contentType === "single" ? `/${X_SOFT_LIMIT}` : ""}
                </span>
              ) : null}
              {status === "error" && error ? (
                <span className="max-w-xs truncate font-mono text-xs text-destructive">
                  {error}
                </span>
              ) : null}
              <Button
                onClick={submit}
                disabled={status === "generating" || !trimmed}
                className="font-mono"
                data-compose-submit="true"
              >
                {buttonLabel}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {result ? (
        <ResultCard result={result} onUpdate={(r) => setResult(r)} />
      ) : null}

      {(bulkProgress.length > 0 || bulkResult) ? (
        <BulkResultsCard
          angles={bulkAngles}
          progress={bulkProgress}
          result={bulkResult}
        />
      ) : null}
    </div>
  );
}

function ProgressBar({
  step,
  detail,
  elapsed,
  onCancel,
  completedAngles,
  totalAngles,
}: {
  step: string | null;
  detail: string | null;
  elapsed: number;
  onCancel: () => void;
  completedAngles?: number;
  totalAngles?: number;
}) {
  const stepLabel = step ? (STEP_LABELS[step] ?? step) : "starting";
  return (
    <div className="flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2">
      <div className="h-2 w-2 animate-pulse rounded-full bg-foreground/60" />
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="font-mono text-xs">
          {stepLabel}
          {detail ? (
            <span className="ml-1 text-muted-foreground">({detail})</span>
          ) : null}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {fmtElapsed(elapsed)} elapsed
          {completedAngles != null && totalAngles != null ? (
            <span>
              {" · "}
              {completedAngles}/{totalAngles} angles done
            </span>
          ) : null}
        </span>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="rounded px-2 py-0.5 font-mono text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        cancel
      </button>
    </div>
  );
}

function BulkResultsCard({
  angles,
  progress,
  result,
}: {
  angles: Array<{ angle: string; hook: string }> | null;
  progress: BulkAngleResult[];
  result: BulkResult | null;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">
            Bulk — {progress.length} angle{progress.length !== 1 ? "s" : ""}
          </span>
          {result ? (
            <span className="font-mono text-xs text-muted-foreground">
              {result.completedAngles}/{result.totalAngles} completed · $
              {result.totalCostUsd.toFixed(5)}
            </span>
          ) : null}
          <Link
            href="/queue"
            className="ml-auto font-mono text-xs underline text-muted-foreground"
          >
            view in queue →
          </Link>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {angles?.map((a, i) => {
          const done = progress.find((p) => p.angleIndex === i);
          const failed = done && done.texts.length === 0;
          return (
            <div
              key={i}
              className={`flex flex-col gap-2 rounded-lg border p-4 ${
                failed
                  ? "border-destructive/40 bg-destructive/5"
                  : done
                    ? "border-border"
                    : "border-dashed opacity-50"
              }`}
            >
              <div className="flex flex-wrap items-baseline gap-2 font-mono text-xs">
                <span className="font-semibold">#{i + 1}</span>
                <span className="text-muted-foreground">{a.hook}</span>
                {done && !failed ? (
                  <Badge
                    variant="outline"
                    className={`ml-auto font-mono ${scoreColor(done.overall)}`}
                  >
                    eval {done.overall}
                  </Badge>
                ) : null}
                {failed ? (
                  <span className="ml-auto text-destructive">
                    {done.critique}
                  </span>
                ) : null}
                {!done ? (
                  <span className="ml-auto text-muted-foreground">
                    pending
                  </span>
                ) : null}
              </div>
              {done && !failed ? (
                <div className="flex flex-col gap-1">
                  {done.texts.map((t, ti) => (
                    <p
                      key={ti}
                      className="whitespace-pre-wrap text-sm leading-relaxed"
                    >
                      {done.texts.length > 1
                        ? `${ti + 1}/${done.texts.length} · `
                        : ""}
                      {t}
                    </p>
                  ))}
                  <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                    <span>
                      {done.texts.reduce((s, t) => s + t.length, 0)} chars
                    </span>
                    <span>·</span>
                    <span>${done.costUsd.toFixed(5)}</span>
                    <span>·</span>
                    <span>{done.tokensIn + done.tokensOut} tokens</span>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function scoreColor(n: number): string {
  if (n >= 80) return "text-emerald-700 dark:text-emerald-400";
  if (n >= 60) return "text-amber-700 dark:text-amber-400";
  return "text-destructive";
}

function RegenerateButton() {
  return (
    <button
      type="button"
      onClick={() => {
        const btn = document.querySelector<HTMLButtonElement>(
          'button[data-compose-submit="true"]',
        );
        btn?.click();
      }}
      className="rounded-md border bg-background px-2 py-1 font-mono text-xs hover:bg-accent"
      title="Re-roll: same topic, fresh draft"
    >
      regenerate
    </button>
  );
}

function ResultCard({
  result,
  onUpdate,
}: {
  result: ComposeResult;
  onUpdate: (r: ComposeResult) => void;
}) {
  const isManual = result.generation.model === "manual";
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">
            {isManual ? "Queued" : "Draft"}
          </span>
          <Badge variant="outline" className="font-mono text-xs">
            {result.generation.model}
          </Badge>
          {!isManual ? (
            <span className="font-mono text-xs text-muted-foreground">
              {result.generation.tokensIn + result.generation.tokensOut} tokens
              {" · "}${result.generation.costUsd.toFixed(5)}
            </span>
          ) : null}
          {result.eval ? (
            <Badge
              variant="outline"
              className={`font-mono text-xs ${scoreColor(result.eval.overall)}`}
            >
              eval {result.eval.overall}
            </Badge>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <RegenerateButton />
            <Link
              href="/queue"
              className="font-mono text-xs underline text-muted-foreground"
            >
              view in queue →
            </Link>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {result.posts.map((post, i) => (
          <div
            key={post.id}
            className="rounded-lg border bg-card p-4 text-sm leading-relaxed"
          >
            {post.threadPosition !== null ? (
              <div className="mb-2 font-mono text-xs text-muted-foreground">
                {post.threadPosition}/{result.posts.length}
              </div>
            ) : null}
            <p className="whitespace-pre-wrap">{post.text}</p>
            <div className="mt-2 flex items-center gap-2 font-mono text-xs text-muted-foreground">
              <span>{post.text.length} chars</span>
              {i === 0 ? <span>·</span> : null}
              {i === 0 ? <span>status: draft</span> : null}
            </div>
          </div>
        ))}

        {result.eval ? <EvalBreakdown evaluation={result.eval} /> : null}

        {result.variants && result.variants.length > 1 ? (
          <VariantsList
            variants={result.variants}
            generationId={result.generation.id}
            onSwitched={(newWinnerIndex, newPosts) => {
              if (!result.variants) return;
              const updatedVariants = result.variants.map((v) => ({
                ...v,
                isWinner: v.index === newWinnerIndex,
              }));
              const newWinner = updatedVariants.find(
                (v) => v.index === newWinnerIndex,
              );
              onUpdate({
                ...result,
                variants: updatedVariants,
                posts: newPosts,
                eval: newWinner
                  ? {
                      scores: newWinner.scores,
                      overall: newWinner.overall,
                      critique: newWinner.critique,
                    }
                  : result.eval,
              });
            }}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function EvalBreakdown({
  evaluation,
}: {
  evaluation: { scores: EvalScores; overall: number; critique: string };
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-baseline gap-3 text-xs font-mono">
        <span className="font-semibold">eval breakdown</span>
        <ScorePill label="insight" v={evaluation.scores.insightDensity} />
        <ScorePill label="voice" v={evaluation.scores.voiceMatch} />
        <ScorePill label="anti-slop" v={evaluation.scores.antiSlop} />
        <ScorePill label="length" v={evaluation.scores.charFit} />
        <ScorePill label="lang" v={evaluation.scores.language} />
        <ScorePill label="faithful" v={evaluation.scores.faithfulness} />
      </div>
      {evaluation.critique ? (
        <p className="text-xs text-muted-foreground italic">
          {evaluation.critique}
        </p>
      ) : null}
    </div>
  );
}

function ScorePill({ label, v }: { label: string; v: number }) {
  return (
    <span>
      <span className="text-muted-foreground">{label}:</span>{" "}
      <span className={`font-semibold ${scoreColor(v)}`}>{v}</span>
    </span>
  );
}

function VariantsList({
  variants,
  generationId,
  onSwitched,
}: {
  variants: VariantSummary[];
  generationId: string;
  onSwitched: (
    newWinnerIndex: number,
    newPosts: Array<{
      id: string;
      text: string;
      threadPosition: number | null;
    }>,
  ) => void;
}) {
  const router = useRouter();
  const [switchingIndex, setSwitchingIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pickVariant(index: number) {
    setSwitchingIndex(index);
    setError(null);
    try {
      const res = await fetch("/api/compose/use-variant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generationId, variantIndex: index }),
      });
      const data: {
        ok?: boolean;
        posts?: Array<{
          id: string;
          text: string;
          threadPosition: number | null;
        }>;
        error?: string;
        message?: string;
      } = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      }
      onSwitched(index, data.posts ?? []);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknown");
    } finally {
      setSwitchingIndex(null);
    }
  }

  return (
    <details className="rounded-lg border">
      <summary className="cursor-pointer list-none px-3 py-2 font-mono text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
        ▸ all {variants.length} variants ranked
      </summary>
      <div className="flex flex-col gap-2 border-t p-3">
        {error ? (
          <p className="font-mono text-xs text-destructive">{error}</p>
        ) : null}
        {variants.map((v) => (
          <div
            key={v.index}
            className={`flex flex-col gap-1 rounded-md border p-2 ${
              v.isWinner ? "border-emerald-500/40 bg-emerald-500/5" : ""
            }`}
          >
            <div className="flex flex-wrap items-baseline gap-2 font-mono text-xs">
              <span className="font-semibold">#{v.index + 1}</span>
              <Badge
                variant="outline"
                className={`font-mono ${scoreColor(v.overall)}`}
              >
                {v.overall}
              </Badge>
              {v.isWinner ? (
                <span className="text-emerald-600 dark:text-emerald-500">
                  ← winner
                </span>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto font-mono"
                  onClick={() => pickVariant(v.index)}
                  disabled={switchingIndex !== null}
                >
                  {switchingIndex === v.index ? "switching..." : "use this"}
                </Button>
              )}
            </div>
            {v.texts.map((t, i) => (
              <p
                key={i}
                className="whitespace-pre-wrap text-xs text-muted-foreground"
              >
                {v.texts.length > 1 ? `${i + 1}/${v.texts.length} · ` : ""}
                {t}
              </p>
            ))}
            {v.critique ? (
              <p className="text-xs italic text-muted-foreground/80">
                {v.critique}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </details>
  );
}
