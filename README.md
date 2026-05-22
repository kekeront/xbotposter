# nfactz

An agentic X (Twitter) content engine. You give it your voice and an idea; it
runs a multi-agent pipeline (outline → write → edit → fact-check → evaluate) to
produce a draft that sounds like you, ships to X on your approval, and lives in
a queue you actually want to manage. Bonus: it watches viral posts from tracked
tech voices and writes takes + quote retweets in your style.

Built for personal branding first — the same code that wins the assignment is
the tool the author uses to post on @kekeront.

## What it does

```
                       ┌──────────────────────────────────────┐
   IDEA / TOPIC ──→    │  outline (threads) → writer →        │  → DRAFT
   (you)               │  editor → [evaluator || fact-check]  │     (in queue)
                       │  × N variants ranked by eval score   │
                       └──────────────────────────────────────┘
                                       │
                                       ▼
                              ┌────────────────┐
   VIRAL X CONTENT  ────────→ │  take / QRT    │  → DRAFT
   (tracked voices)           │  agents        │     (in queue, attributed)
                              └────────────────┘
                                       │
                                       ▼
   YOU REVIEW IN /queue ──→  approve · schedule · skip · remove · retry
                                       │
                                       ▼
                              ┌────────────────┐
                              │  poster        │ → X (with quote_tweet_id
                              │  (cron + UI)   │   for QRTs, threaded via
                              └────────────────┘   in_reply_to_tweet_id)
```

## Quick start

### 1. Supabase project

1. Create a project at <https://supabase.com>.
2. Enable the `vector` extension (Database → Extensions → `vector` → enable).
3. Project Settings → Database → Connection string. Copy:
   - **Transaction pooler** (`:6543`) → `DATABASE_URL` (runtime)
   - **Direct** (`:5432`) → `DATABASE_DIRECT_URL` (migrations only)

### 2. X developer app

1. Create an app at <https://developer.x.com>.
2. App permissions: **Read and write**.
3. Type of App: **Web App / Automated App or Bot** (Confidential client).
4. App info: any valid `https://` URL for Callback and Website.
5. **After enabling Read+Write**, regenerate OAuth 1.0 Consumer Keys AND Access
   Token (existing tokens carry old scope).
6. Fund Pay-Per-Use credits in Billing → Credits ($5 = ~150-500 tweets).

### 3. Env

Copy `.env.example` to `.env.local` and fill:

```env
DATABASE_URL=...                           # pooler :6543
DATABASE_DIRECT_URL=...                    # direct :5432
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...

OPENAI_API_KEY=sk-proj-...
# LLM_WRITER_MODEL=gpt-5.4-mini            # default; bump to gpt-5.4 for polish
# LLM_MID_MODEL=gpt-5-mini                 # editor / evaluator / fact-checker / outliner
# LLM_CHEAP_MODEL=gpt-5-nano               # reserved for future slop/extraction tasks
# EMBEDDING_MODEL=text-embedding-3-small

X_CONSUMER_KEY=...
X_CONSUMER_SECRET=...
X_ACCESS_TOKEN=...                         # regenerate after enabling Read+Write
X_ACCESS_TOKEN_SECRET=...

CRON_SECRET=...                            # `openssl rand -hex 32`
```

### 4. Install + migrate + run

```bash
npm install
npm run db:migrate
npm run dev      # http://localhost:3000
```

### 5. First flows

```bash
# Save voice anchors first — paste 10-30 reference posts at /voice.
# Then either compose manually or seed an AI draft:
curl -X POST http://localhost:3000/api/compose \
  -H "Content-Type: application/json" \
  -d '{"topic":"small models closing the gap on narrow tasks","variants":3}'

# Discover viral posts (costs ~$0.10-0.20 on X PPU):
curl -X POST http://localhost:3000/api/discover/fetch

# Trigger autonomous take on top viral (locally simulates Vercel Cron):
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/generate
```

## Multi-agent system

| Agent | Where | What |
|---|---|---|
| **outliner** | `src/agents/outliner.ts` | For threads only. Produces 3-7 numbered beats before the writer runs. |
| **writer** | `src/agents/writer.ts` | Drafts the post(s). RU-default, voice-anchored, anti-slop, anti-hallucination prompt. Threads follow the outline. |
| **editor** | `src/agents/editor.ts` | Reviews + revises in one JSON pass: strips invented specifics, em-dashes, threadbait, slop phrases (RU + EN). |
| **fact-checker** | `src/agents/fact-checker.ts` | Extracts factual claims, labels `supported` / `invented` / `uncertain`. Saved to `claims` table. |
| **evaluator** | `src/agents/evaluator.ts` | Scores draft 0-100 on 6 criteria (insight density, voice match, anti-slop, char fit, language, faithfulness) + overall + critique. |
| **take** | `src/agents/take.ts` | Generates YOUR reaction to a viral post (not a paraphrase). |
| **qrt** | `src/agents/qrt.ts` | Short commentary line for a quote retweet (30-140 chars typical). |
| **poster** | `src/lib/poster.ts` | Sends to X via twitter-api-v2. Threads chain via `in_reply_to_tweet_id`; QRTs use `quote_tweet_id`. |

Pipeline composition (in `/api/compose`):
- Single: writer → editor → [evaluator ‖ fact-checker]
- Thread: outliner → writer → editor → [evaluator ‖ fact-checker]
- Multi-thesis (`variants: 1-3`): run pipeline N times in parallel, rank by eval.overall, winner becomes the draft. Runner-ups visible in UI, switchable.

## Voice fingerprinting (slice 6)

`src/lib/fingerprint.ts` derives structural features from raw reference posts
without an LLM call:

- sample count, avg chars / words, sentence-length median + p90
- language mix (cyrillic %, latin %, kazakh markers, dominant language)
- emoji rate per post, em-dash rate, drawn-out vowel count
- trailing-period rate, question / exclamation / ellipsis rates
- hit list of casual markers (ботать, чалить, фигню, ngl, fr, …)

Result is rendered on `/voice` and fed into every agent's prompt as a
`fingerprintBlock` system message alongside the raw samples — so the model gets
both stylistic structure AND examples.

## Routes

### Pages

| Path | What |
|---|---|
| `/queue` | Drafts list with filters (active / draft / posted / failed / skipped / all). Each row: skip / schedule / post / remove + source attribution (take on @x / QRT @x). |
| `/compose` | AI / Manual toggle, single / thread, 1-3 variants. Result card shows eval breakdown + variant list with "use this" switcher. |
| `/voice` | Reference posts editor + extracted fingerprint card. |
| `/discover` | Viral posts list from tracked accounts. Fetch button, take / QRT buttons per row. Shows "last fetch X ago · next at HH:MM UTC". |
| `/traces` | 300 most recent agent events grouped by generation, agent filter, color coding. |
| `/schedule` · `/history` | Reserved (placeholders). |

### API endpoints

| Endpoint | Method | What |
|---|---|---|
| `/api/compose` | POST | `{ topic, contentType, mode, variants }` → outline / writer / editor / eval / fact-check pipeline → save draft. |
| `/api/compose/use-variant` | POST | `{ generationId, variantIndex }` → skip current winner posts, insert chosen variant as new draft. |
| `/api/posts/[id]` | GET / PATCH / DELETE | Read · update (status, text, scheduledFor) · hard delete. |
| `/api/posts/[id]/post` | POST | Ship single or thread root via `lib/poster.shipPostById`. Honors `quote_tweet_id` for QRTs. |
| `/api/discover/fetch` | POST | Resolve tracked influencer usernames, pull top recent tweets, upsert into `viral_posts`. Wrapped in 8s timeout per X call. |
| `/api/discover/take` | POST | `{ viralPostId, userAngle?, contentType? }` → take agent → editor → save draft. |
| `/api/discover/qrt` | POST | `{ viralPostId, userAngle? }` → qrt agent → editor → save draft with `quote_tweet_id`. |
| `/api/voice` | GET / POST | Load / save reference posts. POST re-extracts fingerprint. |
| `/api/cron/discover` | GET (Bearer) | Cron-driven discover. Vercel Cron `0 */12 * * *`. |
| `/api/cron/post` | GET (Bearer) | Drains up to 5 approved posts whose `scheduled_for <= now()`. Vercel Cron `*/15 * * * *`. |
| `/api/cron/generate` | GET (Bearer) | Picks top-engagement viral from last 48h (dedup against last 7d generations), runs take + editor + eval + fact-check, saves draft. Vercel Cron `0 */4 * * *`. |

## Database schema

Tables (`src/db/schema.ts`, pgvector enabled):

- **generations** — every AI run. Status, model, tokens, cost, `input_meta` JSON.
- **posts** — drafts and shipped tweets. `parent_post_id` chains threads. `quote_tweet_id` for QRTs. `scheduled_for` for delayed ship. `embedding vector(1536)` for future RAG.
- **sources** — research sources (HN / arXiv / etc — schema only, adapters pending).
- **viral_posts** — captured tweets from `INFLUENCERS` list. `embedding vector(1536)`.
- **claims** — fact-checked claims linked to posts. `verified` boolean, verdict notes.
- **fingerprints** — per-name profile JSON `{ referenceTweets, fingerprint }`.
- **traces** — every agent event with timestamps, tokens, cost, payload JSON.

HNSW indexes on the three embedding columns.

## Cost model

Per generation:

| Component | Cost (gpt-5.4-mini writer, gpt-5-mini others) |
|---|---|
| Outliner (threads only) | ~$0.0005 |
| Writer | ~$0.001 |
| Editor | ~$0.001 |
| Evaluator | ~$0.001 |
| Fact-checker | ~$0.001 |
| **Per variant total** | **~$0.004** |
| 3 variants | ~$0.012 |

Per X API:

- Read (userByUsername / userTimeline): ~$0.001-0.005 each
- Discover fetch (10 influencers × 2 calls): ~$0.10-0.20
- Tweet post: ~$0.01-0.04

Daily auto-run at default cron (discover 12h, generate 4h, post 15m):
~$0.20-0.50/day on X PPU + ~$0.10-0.30/day on OpenAI.

## Deploy to Vercel

```bash
# 1. Push to GitHub.
# 2. Import on vercel.com — Framework Preset: Next.js.
# 3. Add all env vars from .env.local in Project Settings → Environment Variables.
# 4. Deploy.
```

The cron schedule in `vercel.json` activates automatically on production.
Required: project is on a paid Vercel plan for unlimited cron, or stay on Hobby
(daily cron limit is fine for our 4h/12h/15m mix on small accounts).

Local dev does NOT run Vercel Cron. To simulate locally, either curl the
endpoints manually with the Bearer header or add a system crontab entry.

## Scripts

| Command | What |
|---|---|
| `npm run dev` | Dev server on `:3000` |
| `npm run build` | Production build |
| `npm run start` | Serve built app |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | Generate Drizzle migration from schema diff |
| `npm run db:migrate` | Apply migrations |
| `npm run db:studio` | Open Drizzle Studio (DB GUI) |
| `npx tsx scripts/x-test.mjs` | Verify X API credentials + Pay-Per-Use access |

## Layout

```
src/
├── agents/
│   ├── writer.ts            single + thread drafting, outline-aware
│   ├── editor.ts            JSON critique + revise pass
│   ├── evaluator.ts         6-criterion rubric scorer
│   ├── fact-checker.ts      claim extraction + verdict
│   ├── outliner.ts          thread beats (3-7)
│   ├── take.ts              opinion piece from viral post
│   └── qrt.ts               short QRT commentary
├── app/
│   ├── api/
│   │   ├── compose/         + use-variant subroute
│   │   ├── discover/        fetch + take + qrt
│   │   ├── posts/[id]/      CRUD + post subroute
│   │   ├── voice/           load + save references
│   │   └── cron/            generate, post, discover
│   ├── queue/               filters, schedule, retry, remove
│   ├── compose/             AI/manual + variants + eval breakdown + variant switcher
│   ├── voice/               raw refs + fingerprint card
│   ├── discover/            viral list + fetch button + take/qrt
│   └── traces/              grouped event timeline
├── components/
│   ├── shell/               nav, cadence strip, coming-soon
│   └── ui/                  shadcn primitives
├── config/
│   └── influencers.ts       curated tech voices list
├── db/
│   ├── client.ts            postgres.js + Drizzle, prepare:false for Supavisor
│   ├── schema.ts            7 tables, embedding columns, HNSW indexes
│   └── migrations/          drizzle-kit generated SQL
└── lib/
    ├── env.ts               zod-validated, server-only, empty-string → undefined
    ├── llm.ts               OpenAI tier abstraction + USD cost calc
    ├── x.ts                 twitter-api-v2 wrapper (post + read + QRT)
    ├── poster.ts            shared shipPostById for manual + cron paths
    ├── discover.ts          shared runDiscoverFetch for manual + cron paths
    ├── voice-load.ts        loads default fingerprint + reference posts
    ├── fingerprint.ts       structural fingerprint extractor (no LLM)
    ├── trace.ts             best-effort trace event writer
    └── cron-auth.ts         Bearer header check
```

## Roadmap (all done)

| Slice | What | Commit |
|---|---|---|
| 0 | Scaffold (Next.js 16 + Drizzle + Supabase + shadcn) | `d7e3eb6` |
| 1 | Real generation + voice anchor + compose UI | `c5914bf` |
| 2a | Post to X (manual approve + ship) | `2b8f090` |
| 2b | Scheduling + cron drain (5/tick) | `01cc65f` |
| 2c | Cadence strip in layout | `01cc65f` |
| 3a | Editor agent + gpt-5.4-mini writer | `cb39a08` |
| 3b | Retry / remove / soft-skip / persist mode | `d24d829` |
| 4a | Discover (viral X parser, 10 tracked voices) | `f686383` |
| 4a-loop | Cron + last/next indicator in UI | `fb2e81a` |
| 4b | Take agent + button | `4332749` |
| 4c | QRT agent + posting via `quote_tweet_id` | `4332749` |
| 5 | Trace viewer UI | `f6c3623` |
| 6 | Voice fingerprint extraction | `566456f` |
| 7 | Eval rubric + multi-thesis ranking | `4b51edb` |
| 8 | Fact-checker agent + claims table population | this commit |
| 9 | Autonomous `/api/cron/generate` (top viral → take draft) | this commit |
| 10 | Outliner agent for threads | this commit |
| 11 | Variant selector UI ("use this instead") | this commit |
| 12 | README + deploy notes | this commit |

Anti-slop, RU-first output, and tone-only voice anchor enforcement are
extracted from the Telegram channel `t.me/kekerontsky` and baked into the
writer + editor prompts.
