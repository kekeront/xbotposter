# nfactz

An agentic X (Twitter) content engine. You give it your voice and an idea; it
runs a multi-agent pipeline (outline → write → edit → fact-check → evaluate) to
produce a draft that sounds like you, ships to X on your approval, and lives in
a queue you actually want to manage. Bonus: it watches viral posts from tracked
tech voices and writes takes + quote retweets in your style.

Multi-user SaaS: each user connects their own X account, manages their own
voice profile, and sees only their own queue.

**Live:** [xbotposter.vercel.app](https://xbotposter.vercel.app) · [github.com/kekeront/xbotposter](https://github.com/kekeront/xbotposter)

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
4. Authentication → URL Configuration → set Site URL and redirect URLs to your
   app domain (e.g. `http://localhost:3000` for local dev).

### 2. X developer app (per-user OAuth 2.0)

1. Create an app at <https://developer.x.com>.
2. App permissions: **Read and write**.
3. Type of App: **Web App / Automated App or Bot** (Confidential client).
4. OAuth 2.0 settings:
   - Add callback URL: `https://your-domain.com/api/auth/x/callback`
     (and `http://localhost:3000/api/auth/x/callback` for local dev)
5. Fund Pay-Per-Use credits in Billing → Credits ($5 = ~150-500 tweets).

Users connect their own X account from `/settings/connections` after signing up.
No shared bot credentials — each user posts as themselves.

### 3. Env

Copy `.env.example` to `.env.local` and fill:

```env
DATABASE_URL=...                           # pooler :6543
DATABASE_DIRECT_URL=...                    # direct :5432
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...              # server-only, never expose to client

OPENAI_API_KEY=sk-proj-...
# LLM_WRITER_MODEL=gpt-5.4-mini            # default; bump to gpt-5.4 for polish
# LLM_MID_MODEL=gpt-5-mini                 # editor / evaluator / fact-checker / outliner
# LLM_CHEAP_MODEL=gpt-5-nano               # topic-guard and cheap classification

X_CLIENT_ID=...                            # OAuth 2.0 client ID
X_CLIENT_SECRET=...                        # OAuth 2.0 client secret

CRON_SECRET=...                            # `openssl rand -hex 32`
# MAX_DAILY_USD=2.00                        # hard cap on cron spend per day

# Optional Telegram notifications
# TELEGRAM_BOT_TOKEN=...
# TELEGRAM_CHAT_ID=...
```

### 4. Install + migrate + run

```bash
npm install
npm run db:migrate
npm run dev      # http://localhost:3000
```

### 5. First flows

1. Sign up at `/signup` with email + password (or use magic link).
2. Go to `/settings/connections` and connect your X account via OAuth.
3. Go to `/settings/voice` and paste 10-30 reference posts to establish voice.
4. Compose a draft from `/queue` (Compose section) or trigger via API:

```bash
# Seed a draft (requires auth cookie — easier to use the UI):
curl -X POST http://localhost:3000/api/compose \
  -H "Content-Type: application/json" \
  -H "Cookie: <your-session-cookie>" \
  -d '{"topic":"small models closing the gap on narrow tasks","variants":3}'

# Trigger discover (cron-only endpoint):
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/discover
```

## Auth and multi-tenancy

- **Sign-up / login**: email + password or magic link via Supabase Auth.
  Cookie-based sessions via `@supabase/ssr`. Next.js middleware enforces auth
  on all app routes.
- **Password reset**: forgot-password flow at `/forgot-password` sends a magic
  link; `/update-password` handles the token redirect.
- **X connection**: per-user OAuth 2.0 PKCE flow. Tokens stored in
  `social_connections` table, auto-refreshed on expiry.
- **Telegram connection**: Telegram Login Widget flow, verified server-side,
  stored per user.
- **Data isolation**: every table (`generations`, `posts`, `sources`,
  `viral_posts`, `fingerprints`, `traces`) has a `userId` column. All queries
  are scoped to the authenticated user. Cron jobs operate across all users.

## Multi-agent system

| Agent | Where | What |
|---|---|---|
| **topic-guard** | `src/agents/topic-guard.ts` | Fail-closed safety gate. Classifies the source viral post. Blocks politics / tragedy / conspiracy / crypto-calls. Runs BEFORE any expensive generation. |
| **outliner** | `src/agents/outliner.ts` | For threads only. Produces 3-7 numbered beats before the writer runs. |
| **writer** | `src/agents/writer.ts` | Drafts the post(s). RU-default, voice-anchored, anti-slop, anti-hallucination prompt. Threads follow the outline. |
| **editor** | `src/agents/editor.ts` | Reviews + revises in one JSON pass: strips invented specifics, em-dashes, threadbait, slop phrases (RU + EN). |
| **fact-checker** | `src/agents/fact-checker.ts` | Extracts factual claims, labels `supported` / `invented` / `uncertain`. Saved to `claims` table. |
| **evaluator** | `src/agents/evaluator.ts` | Scores draft 0-100 on 6 criteria (insight density, voice match, anti-slop, char fit, language, faithfulness) + overall + critique. |
| **take** | `src/agents/take.ts` | Generates YOUR reaction to a viral post (not a paraphrase). |
| **qrt** | `src/agents/qrt.ts` | Short commentary line for a quote retweet (30-140 chars typical). |
| **searcher** | `src/agents/searcher.ts` | Web search via OpenAI responses API. Returns research brief + source URLs. Sources persisted to DB. |
| **poster** | `src/lib/poster.ts` | Sends to X via twitter-api-v2. Threads chain via `in_reply_to_tweet_id`; QRTs use `quote_tweet_id`. Uses the user's own OAuth tokens from `social_connections`. |

Pipeline composition:
- `/api/compose` (manual seed): **searcher** → outliner (threads only) → writer → editor → [evaluator ‖ fact-checker] · sources persisted, claims linked
- `/api/discover/take` / `/qrt`: **topic-guard** → **searcher** → writer → editor → [evaluator ‖ fact-checker] · sources persisted, claims linked
- `/api/cron/generate` (autonomous): tries top viral first (topic-guard filtered); falls back to HN/arXiv/Substack sources if no safe viral candidates → **searcher** → take or writer + editor + [eval ‖ fact-check] · sources persisted, claims linked
- `/api/cron/discover`: X influencer fetch + HN top stories + arXiv CS.AI/CL/LG + Substack feeds → `sources` table
- Multi-thesis (`variants: 1-3`): run pipeline N times in parallel, rank by eval.overall, winner becomes the draft. Runner-ups visible in UI, switchable.

## Voice fingerprinting

`src/lib/fingerprint.ts` derives structural features from raw reference posts
without an LLM call:

- sample count, avg chars / words, sentence-length median + p90
- language mix (cyrillic %, latin %, kazakh markers, dominant language)
- emoji rate per post, em-dash rate, drawn-out vowel count
- trailing-period rate, question / exclamation / ellipsis rates
- hit list of casual markers (ботать, чалить, фигню, ngl, fr, …)

Result is rendered on `/settings/voice` and fed into every agent's prompt as a
`fingerprintBlock` system message alongside the raw samples — so the model gets
both stylistic structure AND examples.

## Routes

### Pages

| Path | What |
|---|---|
| `/queue` | Main working view. Contains: Compose (collapsible), Discover with editable influencer channels (collapsible), Automation status + cron triggers (collapsible), post list with filters (active / draft / scheduled / posted / failed / skipped / all). |
| `/traces` | 300 most recent agent events grouped by generation, agent filter, color coding. |
| `/settings` | Hub page linking to sub-settings. |
| `/settings/connections` | Connect / disconnect X account (OAuth 2.0) and Telegram. |
| `/settings/voice` | Reference posts editor + extracted fingerprint card. |
| `/login` · `/signup` | Auth pages. |
| `/forgot-password` · `/update-password` | Password reset flow. |

### API endpoints

| Endpoint | Method | What |
|---|---|---|
| `/api/compose` | POST | `{ topic, contentType (single/thread/essay), mode, variants }` → searcher → outline (threads) / writer / editor / eval / fact-check pipeline → save draft. Auth required. |
| `/api/compose/use-variant` | POST | `{ generationId, variantIndex }` → skip current winner posts, insert chosen variant as new draft. Auth required. |
| `/api/posts/[id]` | GET / PATCH / DELETE | Read · update (status, text, scheduledFor) · hard delete. Scoped to authenticated user. |
| `/api/posts/[id]/post` | POST | Ship single or thread root via `lib/poster.shipPostById`. Uses caller's X tokens. |
| `/api/discover/fetch` | POST | Resolve tracked influencer usernames (or user's custom list), pull top recent tweets, upsert into `viral_posts`. Wrapped in 8s timeout per X call. |
| `/api/discover/take` | POST | `{ viralPostId, userAngle?, contentType? }` → take agent → editor → save draft. Auth required. |
| `/api/discover/qrt` | POST | `{ viralPostId, userAngle? }` → qrt agent → editor → save draft with `quote_tweet_id`. Auth required. |
| `/api/upload` | GET / POST | GET: list sources. POST: `{ title, content, url?, type? }` → ingest text/document as a source for compose context. |
| `/api/voice` | GET / POST | Load / save reference posts. POST re-extracts fingerprint. Scoped to authenticated user. |
| `/api/auth/x/connect` | GET | Initiates X OAuth 2.0 PKCE flow. Redirects to X authorization page. |
| `/api/auth/x/callback` | GET | Handles X OAuth callback. Exchanges code for tokens, stores in `social_connections`. |
| `/api/settings/connections` | GET | Returns the authenticated user's connected X and Telegram accounts. |
| `/api/settings/tracked-accounts` | GET / POST | Load / save user's custom influencer list (falls back to default INFLUENCERS config). |
| `/api/cron/discover` | GET (Bearer) | Cron-driven discover (X + HN + arXiv + Substack). Vercel Cron `0 7 * * *` (daily 7am UTC). |
| `/api/cron/post` | GET (Bearer) | Drains up to 5 approved posts whose `scheduled_for <= now()`. Vercel Cron `0 9 * * *` (daily 9am UTC). |
| `/api/cron/generate` | GET (Bearer) | Picks top-engagement viral from last 48h (dedup against last 7d), runs searcher + take + editor + eval + fact-check, saves draft. Vercel Cron `0 8 * * *` (daily 8am UTC). |

## Database schema

Tables (`src/db/schema.ts`, pgvector enabled):

- **profiles** — one row per Supabase auth user. Stores `trackedAccounts` (custom influencer list, nullable — falls back to config default).
- **social_connections** — per-user X OAuth tokens (access + refresh + expiry) and Telegram chat_id. One row per provider per user.
- **generations** — every AI run. Status, model, tokens, cost, `input_meta` JSON. `userId` scoped.
- **posts** — drafts and shipped tweets. `parent_post_id` chains threads. `quote_tweet_id` for QRTs. `scheduled_for` for delayed ship. `embedding vector(1536)` for future RAG. `userId` scoped.
- **sources** — research sources (web search results, HN top stories, arXiv papers, Substack posts). Persisted on searcher runs and adapter fetches, linked to claims via `source_id`. `userId` scoped.
- **viral_posts** — captured tweets from tracked accounts. `embedding vector(1536)`. `userId` scoped.
- **claims** — fact-checked claims linked to posts. `verified` boolean, verdict notes, `source_id` FK to backing source. `userId` scoped.
- **fingerprints** — per-user profile JSON `{ referenceTweets, fingerprint }`. `userId` scoped.
- **traces** — every agent event with timestamps, tokens, cost, payload JSON. `userId` scoped.

HNSW indexes on the three embedding columns.

## Cost model

### OpenAI per generation

| Component | gpt-5.4-mini writer · gpt-5-mini others |
|---|---|
| Topic-guard (discover-driven only) | ~$0.00003 (gpt-5-nano) |
| Outliner (threads only) | ~$0.0005 |
| Writer | ~$0.001 |
| Editor | ~$0.001 |
| Evaluator | ~$0.001 |
| Fact-checker | ~$0.001 |
| **Per variant total** | **~$0.004-0.005** |
| 3 variants | ~$0.012-0.015 |

### X PPU per call

X bills **per resource returned**, not per request. Rates from X docs (2026-05):

| Operation | Cost |
|---|---|
| Read (per Tweet / User returned) | $0.005-0.010 |
| Owned Read (your own data: posts, bookmarks) | $0.001 |
| Write — tweet without URL | $0.015 |
| **Write — tweet WITH URL** ⚠️ | **$0.200** (13×) |

### Discover fetch cost (optimized)

| Configuration | Per run |
|---|---|
| Baseline (10 inf × 10 tweets, resolve usernames each time) | $0.55-1.10 |
| + Pre-resolved user IDs in `INFLUENCERS` config | $0.50-1.00 |
| + `max_results: 5` instead of 10 | $0.13-0.25 |
| + `since_id` per author (only fetch new tweets) | **$0.00-0.10 steady state** |

Steady-state monthly estimate (10 influencers, daily cron, normal activity,
3 posts/day shipped):

| Component | Per day | Per month |
|---|---|---|
| Discover (since_id, steady state) | $0.06-0.20 | $1.80-6.00 |
| Cron-generate (OpenAI only — viral already in DB) | $0.03 | $0.90 |
| Manual compose (~5 drafts) | $0.05 | $1.50 |
| Posted tweets (3/day × $0.015) | $0.05 | $1.50 |
| Topic-guard (~10/day × $0.00003) | <$0.01 | <$0.01 |
| **Total** | **~$0.20-0.35** | **~$6-10** |

With $5 X PPU + $3 OpenAI ≈ 30 days of fully autonomous operation.

### Billing visibility

- **Cadence strip** in the layout shows today / 7d / month totals with
  color thresholds (green < 10¢/day, amber, red > $1/day). Tooltip
  breaks out OpenAI vs X.
- `/api/billing` GET returns the JSON snapshot for external monitoring.
- `MAX_DAILY_USD` env (default `$2.00`) hard-caps cron auto-spend per day.
  Manual UI actions are never gated.

## Deploy to Vercel

```bash
# 1. Push to GitHub.
# 2. Import on vercel.com — Framework Preset: Next.js.
# 3. Add all env vars from .env.local in Project Settings → Environment Variables.
# 4. Deploy.
```

The cron schedule in `vercel.json` activates automatically on production.
Required: project is on a paid Vercel plan for unlimited cron, or stay on Hobby
(daily cron limit is fine for our once-daily schedule on small accounts).

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
| `npm run cron:local` | Long-running local cron simulator (discover 12h / generate 4h / post 15m). Use in a second terminal while `npm run dev` runs. |
| `npm run cron:once` | Same as cron:local but fires every job once immediately, then continues on schedule. |
| `npx tsx scripts/x-test.mjs` | Verify X API credentials + Pay-Per-Use access |
| `npx tsx scripts/tg-chat-id.mjs` | Resolve your Telegram chat_id after messaging the bot |
| `npx tsx scripts/tg-test.mjs` | Send a test notification to verify TELEGRAM_* env vars |
| `npx tsx scripts/export-traces.mjs` | Dump latest 200 trace events to `traces/agent-traces.{json,md}` |

## Local autonomous mode

```bash
# terminal 1
npm run dev

# terminal 2
npm run cron:local   # fires discover/generate/post on real schedules
# or
npm run cron:once    # plus an immediate first run of each
```

While both are running, the system is fully autonomous:

- `cron/discover` pulls fresh viral content from tracked influencers (with
  `since_id` so you only pay for new tweets)
- `cron/generate` picks the top safe candidate through `topic-guard`, runs the
  take + editor + eval + fact-check pipeline, saves a draft, and pushes a
  notification to Telegram (if configured)
- `cron/post` drains approved + scheduled posts to X using each user's own
  OAuth tokens

Track live activity in two places, both auto-refreshing:

- Automation section in `/queue` — per-cron status, last run, daily spend cap
  progress, manual trigger buttons
- `/traces` — grouped agent event log with per-event tokens + cost

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
│   │   ├── auth/x/          connect + callback (OAuth 2.0 PKCE)
│   │   ├── compose/         + use-variant subroute
│   │   ├── discover/        fetch + take + qrt
│   │   ├── posts/[id]/      CRUD + post subroute
│   │   ├── settings/        connections + tracked-accounts
│   │   ├── voice/           load + save references
│   │   └── cron/            generate, post, discover
│   ├── (auth)/
│   │   ├── login/
│   │   ├── signup/
│   │   ├── forgot-password/
│   │   └── update-password/
│   ├── queue/               compose + discover + automation + post list
│   ├── settings/
│   │   ├── connections/     X + Telegram connect/disconnect
│   │   └── voice/           reference posts + fingerprint
│   └── traces/              grouped event timeline
├── components/
│   ├── shell/               nav (3 items), cadence strip
│   └── ui/                  shadcn primitives
├── config/
│   └── influencers.ts       default tech voices list (user-overridable)
├── db/
│   ├── client.ts            postgres.js + Drizzle, prepare:false for Supavisor
│   ├── schema.ts            9 tables, embedding columns, HNSW indexes
│   └── migrations/          drizzle-kit generated SQL
└── lib/
    ├── env.ts               zod-validated, server-only, empty-string → undefined
    ├── llm.ts               OpenAI tier abstraction + USD cost calc
    ├── x.ts                 twitter-api-v2 wrapper (post + read + QRT)
    ├── poster.ts            shared shipPostById — uses per-user OAuth tokens
    ├── discover.ts          shared runDiscoverFetch for manual + cron paths
    ├── voice-load.ts        loads user fingerprint + reference posts
    ├── fingerprint.ts       structural fingerprint extractor (no LLM)
    ├── trace.ts             best-effort trace event writer
    ├── cron-auth.ts         Bearer header check
    ├── spend-cap.ts         MAX_DAILY_USD hard cap for cron endpoints
    ├── source-persist.ts    persists searcher sources → sources table
    └── adapters/
        ├── hn.ts            Hacker News top stories → sources
        ├── arxiv.ts         arXiv CS.AI/CL/LG → sources
        └── substack.ts      Substack feed → sources
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
| 8 | Fact-checker agent + claims table population | — |
| 9 | Autonomous `/api/cron/generate` (top viral → take draft) | — |
| 10 | Outliner agent for threads | — |
| 11 | Variant selector UI ("use this instead") | — |
| 12 | README + deploy notes | — |
| 13 | Topic guard — fail-closed safety gate | `193680c` |
| 14 | Billing tracker + cadence pills + X cost optimizations | `109041a` |
| 15 | `since_id` per author — only pay for new tweets | — |
| 16 | Supabase Auth (email/password + magic link) + middleware | — |
| 17 | Multi-tenant schema — userId on all tables | — |
| 18 | X OAuth 2.0 PKCE — per-user X connection | — |
| 19 | Telegram connection per user | — |
| 20 | Settings hub (/settings/connections + /settings/voice) | — |
| 21 | UX consolidation — 9 nav items → 3 (Queue / Traces / Settings) | — |
| 22 | Editable influencer channels per user | — |
| 23 | Forgot password / update password flow | — |
| 24 | Security hardening (user-scoped resets, open redirect fix, auth on all routes) | — |
