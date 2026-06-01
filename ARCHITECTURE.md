# nfactz — Architecture

An **agentic X (Twitter) content engine**: it discovers what's trending, drafts
posts in your voice through a multi-agent LLM pipeline, fact-checks and scores
them, and ships on a schedule — with a human gate and a hard cost cap.

This is not an "AI wrapper." It's a pipeline of specialized agents over a
typed Postgres+pgvector store, with streaming progress, cost accounting, and
optional full autonomy.

---

## 1. System context

```
                          ┌───────────────────────────────────────────┐
                          │                BROWSER                     │
                          │   /queue · /traces · /settings (Next App)  │
                          └───────────────┬───────────────────────────┘
                                          │ HTTPS (SSE for live pipelines)
                                          ▼
        ┌──────────────────────────────────────────────────────────────────┐
        │                 Next.js 16 (App Router, Turbopack)                 │
        │  proxy.ts (Supabase auth gate) → route handlers + server comps     │
        │                                                                    │
        │   API routes ── lib (llm/cost/sse/...) ── agents (writer/...)      │
        └───────┬───────────────┬───────────────┬───────────────┬───────────┘
                │               │               │               │
                ▼               ▼               ▼               ▼
        ┌─────────────┐  ┌─────────────┐  ┌───────────┐  ┌─────────────┐
        │  Supabase   │  │   OpenAI    │  │  X API    │  │  Telegram   │
        │  Postgres   │  │  gpt-5 fam  │  │ (v2 OAuth │  │  Bot API    │
        │  + pgvector │  │  + embed    │  │  2.0 PKCE)│  │ (notify)    │
        │  (Drizzle)  │  │             │  │           │  │             │
        └─────────────┘  └─────────────┘  └───────────┘  └─────────────┘
                ▲
                │  Vercel Cron (discover · generate · post · wave)
                └──────────────────────────────────────────────────
```

- **Auth**: Supabase Auth (cookie sessions). `src/proxy.ts` is the middleware —
  everything except `/auth`, `/api/cron/*`, `/api/telegram/webhook` requires a
  session. Cron routes authorize with a `CRON_SECRET` bearer token.
- **DB**: Supabase Postgres talked to directly via **Drizzle ORM** + `postgres.js`
  (typed SQL, migrations in repo). `pgvector` + HNSW indexes for similarity.
- **Cron**: `vercel.json` schedules; `scripts/local-cron.mjs` simulates them in dev.

---

## 2. Layers

```
  app/(dashboard)/queue        UI: ComposePanel · DiscoverPanel · AutomationPanel · PostRow
  app/api/**                   Route handlers (compose, discover, wave, cron, settings, ...)
        │
  src/agents/*                 LLM agents (one responsibility each)
        │
  src/lib/*                    llm · sse · discovery-feed · wave · voice-load · fingerprint
                               source-persist · spend-cap · billing · trace · memory-bridge
                               automation · cron-auth · poster · x · telegram · env
        │
  src/db/{schema,client}       Drizzle schema (source of truth) + migrations
```

**`src/lib/llm.ts`** is the AI seam: `complete()` (chat), `embed()`, `costFor()`
(per-model pricing), and tiering via env (`LLM_CHEAP/MID/WRITER_MODEL`).

---

## 3. The generation pipeline (core agentic flow)

One seed becomes a scored, fact-checked draft. The shape is shared across
compose / bulk / discover-take / discover-qrt / cron-generate (each route adapts
inputs + entry auth; the agent sequence is the same).

```
   seed (user idea │ viral post │ source item)
        │
        ▼  (discovery/cron paths only)
   ┌──────────────┐   blocked → STOP (no spend)
   │ topic-guard  │── gpt-5-nano, fail-closed brand-safety gate
   └──────┬───────┘
          │ safe
          ▼  context, gathered in parallel
   ┌───────────────────────────────────────────────┐
   │  searcher (web_search, capped)   memory recall  │  → researchBlock
   │  + recent uploaded sources (PDF/image parsed)   │    (RAG / grounding)
   └──────┬──────────────────────────────────────────┘
          │
          ▼  threads only
   ┌──────────────┐
   │  outliner    │── beats[]
   └──────┬───────┘
          ▼
   ┌──────────────┐   ×N variants (Promise.all)
   │  writer      │── gpt-5.4-mini (the only "premium" step)
   └──────┬───────┘
          ▼
   ┌──────────────┐   scores 6 axes → overall  ─┐
   │  evaluator   │── gpt-5-mini                 │  winner = max(overall)
   └──────┬───────┘                              │  (multi-variant: edit + fact
          ▼                                      │   run on the WINNER only)
   ┌──────────────┐                              │
   │  editor      │── revise + issues            │
   └──────┬───────┘                              │
          ▼                                      │
   ┌──────────────┐   claims[] · inventedCount  ─┘
   │ fact-checker │── (surfaced in UI as a fabrication warning)
   └──────┬───────┘
          ▼
   persist: generations + posts (+ claims) ── trace every agent call (tokens, cost)
          ▼
   QUEUE ── human approve ──► cron/post ──► X
```

- **Streaming**: compose / take / qrt return **SSE** (`src/lib/sse.ts`) emitting
  `progress {step}` per stage and a final `result`. The UI renders a live
  `search→writer→editor→eval→fact-check` indicator.
- **Cost**: every agent returns `{model, tokensIn, tokensOut, costUsd}`; totals
  land on the `generations` row and in `traces`. `costFor()` prices each call;
  unknown models log a warning so the spend cap can't silently under-count.

### 3.1 Agent catalogue

Each agent in `src/agents/*` has one responsibility and a fixed I/O shape. Tiers
resolve via env (`LLM_CHEAP/MID/WRITER_MODEL`): cheap=`gpt-5-nano`,
mid=`gpt-5-mini`, writer=`gpt-5.4-mini`.

```
 agent          tier    input (key args)                    output                         runs in
 ───────────    ─────   ─────────────────────────────────   ────────────────────────────   ─────────────────────
 topic-guard    cheap   text, author                        {safe, category, reason}       discover/take,qrt,cron  (pre-spend gate)
 searcher       mid+ws  topic                               researchBlock, sources[]       all generation paths
 outliner       mid     topic, voice                        beats[]                        compose/bulk (threads)
 angles         mid     topic, voice, count                 angles[] (distinct seeds)      compose/bulk
 viral-topics   mid     feed items, fingerprint, count      topics[] {topic,hook,rationale} wave shot
 writer         writer  topic, voice, memory, research,     texts[]                        compose/bulk
                        beats, preferences
 take           writer  viral text+author, voice, research  texts[] (reaction)             discover/take, cron
 qrt            writer  viral text+author, voice            text (one-line quote)          discover/qrt
 editor         mid     drafts, voice                       revised texts[] + issuesFound  after writer
 evaluator      mid     draft, voice                        scores{6 axes}+overall+critique ranks variants
 fact-checker   mid     draft, researchBlock                claims[] + inventedCount       on the winner
```

- **evaluator** scores six axes — `insightDensity`, `voiceMatch`, `antiSlop`,
  `charFit`, `language`, `faithfulness` — and an `overall`. Insight + voice are
  the differentiators (surfaced emphasized in the UI); the rest are hygiene.
- **fact-checker** treats `researchBlock` as ground truth → RAG-sourced facts
  read as "supported", which is how grounding reduces false "invented" flags.
- JSON agents (`json_object`) need a generous `max_completion_tokens` — gpt-5
  reasoning tokens share that budget, and a low ceiling returns empty output.

### 3.2 Orchestration — five entry points

The agent *sequence* is shared; each route adapts the seed, entry auth, and
transport. (There is currently no single `runPipeline` module — the sequence is
re-implemented per route; consolidating it is a tracked Phase-2 refactor.)

```
 route                         seed              auth          variants  transport   extras
 ───────────────────────────   ───────────────   ───────────   ────────  ─────────   ──────────────────────────
 /api/compose                  user idea         session       1–3       SSE         outliner (threads)
 /api/compose/bulk             user idea         session       N angles  SSE         angles fan-out, per-angle
                                                                                       spend re-check (sequential)
 /api/discover/take            viral post        session       1         SSE         topic-guard first
 /api/discover/qrt             viral post        session       1         SSE         topic-guard first; quote_tweet_id
 /api/cron/generate            top viral / src   CRON_SECRET    1         JSON        topic-guard walk; Telegram notify
 /api/cron/wave  (+ wave/shot) recommended topic CRON_SECRET/   N         JSON/JSON   viral-topics; writer-only preview;
                                                 session                              gated by waveAutonomous
```

### 3.3 Variant fan-out & winner selection

```
 variants = 1                         variants > 1  (compose)
 ────────────                         ──────────────────────────────────────
 writer                               writer ×N            (parallel)
   → editor                             → evaluator ×N     (score RAW drafts)
   → evaluator ∥ fact-checker           → winner = max(overall)
                                        → editor   (winner only)   ← deferral:
                                        → fact-checker (winner)       don't pay to
                                                                      edit/fact losers
```

The deferral is a deliberate cost trade: losing variants stop after scoring.
(Trade-off: in the multi-variant path the winner is chosen on the *raw* draft;
re-scoring the edited winner is noted for Phase-2.)

### 3.4 Context assembly (RAG / grounding)

```
 researchBlock  =  searcher(web_search, capped)        ← external fresh facts
                +  recallMemoryBlock(topic)            ← past turns (vector + FTS, RRF)
                +  buildSourceContextBlock(uploaded)   ← recent PDF/image/manual sources
   → injected into the writer as labeled system messages
   → reused by fact-checker as ground truth
```

Memory recall and search run in parallel with voice load and are fail-open
(timeout → empty block; generation never blocks on them).

#### 3.4.1 Retrieval internals — hybrid (cosine + FTS + RRF)

`recall()` (`src/memory/recall.ts`) is the working RAG retriever over the memory
store. It is **hybrid retrieval with rank-fusion reranking** — not a neural
cross-encoder:

```
 query
  ├─ embed(query)  → text-embedding-3-small (1536-d)   (fail-open: facts still render)
  │
  ├─ A) VECTOR ranking   1 - (embedding <=> q::vector)  AS cosine     ← score
  │                      ORDER BY embedding <=> q::vector             ← HNSW vector_cosine_ops
  │                      LIMIT 30
  │
  ├─ B) LEXICAL ranking  ts_rank_cd(tsv, plainto_tsquery('simple', query))   ← Postgres FTS
  │                      LIMIT 30
  │
  └─ FUSE(A, B)  Reciprocal Rank Fusion:  score = Σ 1/(k + rank),  k = 60
                 (Cormack-Buettcher-Clarke 2009)
        → candidates sorted by RRF
        → facts re-ranked by their RRF (query-aware)
        → facts-first assembly under maxTokens (default 400); convo fills the rest
```

- **Cosine similarity** via pgvector `<=>` (cosine distance) against an HNSW
  index built with `vector_cosine_ops`; stored score is `1 - distance`.
- **Reranking is RRF rank fusion**, not a learned reranker — it merges the vector
  and lexical rankings so neither modality dominates, with `k=60` damping the
  contribution of low ranks.
- **Budgeted, fail-open**: facts packed first, conversation snippets fill the
  remaining token budget; an embed failure still yields the facts block.

**Discovery RAG (planned, not yet wired).** `sources` and `viral_posts` carry the
same `embedding vector(1536)` + HNSW columns, but they are **not populated or
queried today** — discovered items reach generation via the searcher and the
summary digest, not vector retrieval. Embed-on-ingest plus a `<=>` retriever
(reusing this cosine + RRF pattern) is the tracked step to make discovery a true
RAG source.

### 3.5 Streaming & progress

Interactive routes return **SSE** via `src/lib/sse.ts`:

```
 event: progress   data: { step: "search|writer|editor|eval|factcheck|saving", detail }
 event: result     data: { generation, editor, eval, factCheck, sources, variants, posts }
 event: error      data: { message }
```

The client renders a live step indicator; blocked (topic-guard) and pre-stream
errors come back as plain JSON before the stream opens.

### 3.6 Cost accounting & gating

```
 topic-guard (fail-closed) ── blocked → STOP, zero LLM spend
 checkSpendCap(MAX_DAILY_USD) ── cron → 429 when the day's total is exceeded
 every agent → costFor(model, tokensIn, tokensOut[, cached]) → generations.costUsd + traces
 searcher web_search ── low context + low reasoning + max_tool_calls; per-call fee added to costUsd
```

### 3.7 Autonomous vs interactive

- **Interactive** (session, SSE): user drives compose / take / qrt / wave-shot;
  output lands as a draft for human approval. Wave-shot previews are writer-only
  until promoted.
- **Autonomous** (Vercel cron, `CRON_SECRET`): `generate` picks a guard-passed
  viral post and runs the full pipeline; `wave` (gated by `profiles.waveAutonomous`,
  default off) recommends + drafts and — when the toggle is on — marks posts
  `approved` so `cron/post` ships them to X unattended. `discover` ingests.

---

## 4. Discovery — two engines

Discovery feeds generation. Ingested items live in `sources` + `viral_posts`;
`loadDiscoveryFeed()` merges them into one feed.

```
  INGEST (cron/discover · /api/discover/fetch · /api/upload)
   ├─ X influencers ─────────────► viral_posts
   ├─ Hacker News / arXiv / Substack ─► sources  (type: hn|arxiv|substack)
   └─ PDF/image upload → OpenAI vision/file parse → sources (type: pdf|image)
                              │
                              ▼
         loadDiscoveryFeed(userId, {kinds,query,sort,limit})  → merged feed
                              │
        ┌─────────────────────┴───────────────────────┐
        ▼  (1) FEED view                                ▼  (2) SUMMARY view
   item cards with                              "what's happening in the bubble"
   take / qrt actions                           — one cheap LLM digest of the wave
   (stream the pipeline)                        (Feed ↔ Summary toggle)
```

**Viral Wave Shot** (second automation method) sits on top of discovery:

```
  runWaveShot(userId):
     loadDiscoveryFeed (top engagement)
        → viral-topics agent: recommend N distinct topics {topic,hook,rationale}
        → writer-only PREVIEW per topic (cheap; full pipeline deferred)
     ──► on-demand:  Automation panel button → previews → "queue this" (draft)
     ──► autonomous: GET /api/cron/wave (daily), gated by profiles.waveAutonomous
                     ON ⇒ generate + mark "approved" ⇒ post cron ships to X
```

---

## 5. Automation & cost control

```
  vercel.json crons → /api/cron/{discover,generate,post,wave}
        │  each: authorizeCronRequest(CRON_SECRET) → checkSpendCap() → run
        ▼
  spend-cap.ts  ── MAX_DAILY_USD ceiling; cron returns 429 when exceeded
  billing.ts    ── aggregates generations.costUsd + traces.costUsd (OpenAI + X)
        ▲
        └── Automation panel: live spend bar, per-job status/trigger,
            "full-auto" toggle for the wave (default OFF; ON = unattended posting)
```

Cost engineering baked in:
- **Web search capped** — `searcher` uses `web_search` with `low` context +
  `low` reasoning + a `max_tool_calls` ceiling, and bills the per-call fee into
  `costUsd` (a ~$0.50 call → ~$0.015).
- **Variant deferral** — with `variants > 1`, only the evaluator-picked winner
  is edited + fact-checked; losers stop after scoring.
- **Tiering** — `gpt-5-nano` (classify), `gpt-5-mini` (edit/score), `gpt-5.4-mini`
  (write). Reasoning models need a generous `max_completion_tokens` or they spend
  the whole budget on hidden reasoning and return empty output.

---

## 6. Data model (Drizzle / Postgres)

```
  profiles ─┐ (id = supabase auth user; trackedAccounts, waveAutonomous)
            ├── social_connections   (X OAuth2 / Telegram tokens per user)
            ├── generations          (one run: topic, model, tokens, costUsd, inputMeta)
            │      └── posts         (draft→approved→scheduled→posted; thread chains)
            │             └── claims (fact-check claims ↔ source)
            ├── sources              (hn|arxiv|substack|web|manual|pdf|image; embedding)
            ├── viral_posts          (captured X posts; engagement; embedding)
            ├── fingerprints         (voice stats)
            ├── traces               (every agent event: payload, tokens, costUsd)
            └── mem_*                 (agentic memory: turns, documents, embeddings)
```

`embedding vector(1536)` columns + HNSW indexes exist on `sources` /
`viral_posts` / memory docs for similarity retrieval (RAG).

---

## 7. Directory map

```
  src/
   ├─ app/
   │   ├─ (dashboard)/queue/   ComposePanel, DiscoverPanel, AutomationPanel, PostRow
   │   ├─ api/                 compose, compose/bulk, discover/{feed,take,qrt,summary,fetch},
   │   │                       wave/{shot,queue}, cron/{discover,generate,post,wave},
   │   │                       settings/{automation,channels}, upload, voice, posts/[id], ...
   │   └─ auth/                login, signup, callbacks
   ├─ agents/                  searcher, outliner, writer, editor, evaluator, fact-checker,
   │                           topic-guard, take, qrt, angles, viral-topics
   ├─ lib/                     llm, sse, discovery-feed, wave, voice-load, fingerprint,
   │                           source-persist, spend-cap, billing, trace, memory-bridge,
   │                           automation, cron-auth, poster, x, telegram, env
   ├─ memory/                  extract, store, recall (agentic memory)
   ├─ db/                      schema.ts (source of truth), client.ts, migrations/
   └─ config/                  influencers.ts
```

---

## 8. Key decisions (see CHANGELOG.md for the full reasoning)

- Drizzle + direct Postgres over `supabase-js` — typed SQL, pgvector first-class.
- Voice anchor is **tone only, not data** — plus a structured fingerprint.
- Multi-agent pipeline with **evaluator-ranked variants** and a **fail-closed
  topic guard** before any spend.
- **Cost discipline as a feature**: capped web search, variant deferral, tiered
  models, a hard daily spend cap, and full per-agent cost tracing.
