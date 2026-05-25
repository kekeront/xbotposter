# nfactz

nfactz is a private dashboard for drafting, reviewing, scheduling, and posting
X content. It combines a Next.js UI, Supabase Auth/Postgres, OpenAI-backed
writing agents, X API integration, cron automation, and trace logs.

This README describes what is present in this repository. It intentionally
avoids public deployment links, exact pricing promises, and roadmap claims that
are not backed by the code.

## Stack

- Next.js 16.2 App Router and React 19
- Supabase Auth and Supabase Postgres
- Drizzle ORM and SQL migrations
- OpenAI SDK for generation, search, embeddings, and cost accounting
- `twitter-api-v2` for X reads and posts
- Tailwind CSS 4 with local UI components
- Vitest for tests

## Current Features

- Supabase email/password auth, magic-link login, password reset, and protected
  dashboard routes.
- Queue UI at `/queue` for composing, reviewing, scheduling, skipping,
  deleting, and posting drafts.
- AI compose flow for single posts, threads, and essays.
- Manual compose flow for saving exact text into the queue.
- Bulk compose flow that generates multiple angles for a topic.
- Variant generation for AI compose: 1-3 candidates are scored and the best one
  is inserted into the queue; saved alternatives can be switched in later.
- Voice profile page at `/settings/voice`; pasted reference posts are converted
  into a structural fingerprint and passed to writer/editor agents.
- Discover panel for fetching configured X accounts and creating takes or quote
  retweets from captured posts.
- Automation panel for cron status, spend-cap visibility, and local trigger
  buttons.
- Trace page at `/traces` for recent agent events, models, tokens, costs, and
  payload previews.
- Optional Telegram notifications and inline approve/skip callbacks.
- Optional memory layer behind `MEMORY_ENABLED`.

## Agent Pipeline

The main AI compose route is `POST /api/compose`.

In AI mode it:

1. Checks the spend cap.
2. Creates a `generations` row.
3. Loads the default voice profile.
4. Recalls memory when enabled.
5. Runs web search and adds recently uploaded sources.
6. Runs the outliner for threads.
7. Runs writer variants.
8. Runs editor, evaluator, and fact-checker agents.
9. Stores the winning post or thread in `posts`.
10. Stores claims, sources, costs, and trace events where available.

Manual mode skips the agents and inserts the provided text directly. For manual
threads, split posts with a line containing `---`.

## Local Setup

```bash
npm install
cp .env.example .env.local
# edit .env.local
npm run db:migrate
npm run dev
```

Then open <http://localhost:3000>. `/` redirects to `/queue`.

The migrations create the `vector` and `pgcrypto` extensions. On managed
Supabase projects, enable `vector` manually first if your database role cannot
create extensions.

## Environment

`src/lib/env.ts` is the canonical list of environment variables. Blank optional
values are treated as unset.

Required for the app shell:

- `DATABASE_URL` - pooled Supabase Postgres connection for runtime.
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Required for migrations:

- `DATABASE_DIRECT_URL` - direct Supabase Postgres connection.

Required for AI features:

- `OPENAI_API_KEY`
- Optional model overrides: `LLM_CHEAP_MODEL`, `LLM_MID_MODEL`,
  `LLM_WRITER_MODEL`, `EMBEDDING_MODEL`

Required for per-user X OAuth:

- `X_OAUTH2_CLIENT_ID`
- `X_OAUTH2_CLIENT_SECRET`
- `NEXT_PUBLIC_APP_URL` - used to build the callback URL.

The X OAuth callback is:

```text
<NEXT_PUBLIC_APP_URL>/api/auth/x/callback
```

The requested X OAuth scopes are:

```text
tweet.read tweet.write users.read offline.access
```

Required for system-level X operations and fallback posting:

- `X_CONSUMER_KEY`
- `X_CONSUMER_SECRET`
- `X_ACCESS_TOKEN`
- `X_ACCESS_TOKEN_SECRET`

Required for cron endpoints:

- `CRON_SECRET`
- Optional `MAX_DAILY_USD`, defaulting to `2`

Optional Telegram integration:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_WEBHOOK_SECRET`
- `NEXT_PUBLIC_TELEGRAM_BOT_NAME`

Optional memory integration:

- `MEMORY_ENABLED=true`
- `MEMORY_RECALL_MAX_TOKENS`
- `MEMORY_RECALL_TIMEOUT_MS`
- `MEMORY_RECORD_TIMEOUT_MS`

## X Integration Notes

There are two X auth paths in the codebase:

- Per-user OAuth 2.0 PKCE is used by `/settings/connections` and by UI posting
  when a connected account exists.
- Legacy OAuth 1.0a system credentials are used as a fallback and by current
  discovery/cron flows.

Current discovery fetches accounts from `src/config/influencers.ts`. The queue UI
can save custom channel lists to `profiles.tracked_accounts`, but
`runDiscoverFetch` does not yet read those saved lists.

## Cron Jobs

Configured in `vercel.json`:

| Endpoint | Schedule | Purpose |
| --- | --- | --- |
| `/api/cron/discover` | `0 7 * * *` | Fetch X posts plus HN, arXiv, and Substack sources. |
| `/api/cron/generate` | `0 8 * * *` | Generate one autonomous draft from recent viral posts or sources. |
| `/api/cron/post` | `0 9 * * *` | Post up to 5 approved drafts whose `scheduled_for` is due. |

All cron endpoints require:

```http
Authorization: Bearer <CRON_SECRET>
```

For local cron testing:

```bash
npm run cron:once
npm run cron:local
```

## Routes

Pages:

| Path | Purpose |
| --- | --- |
| `/queue` | Main queue, compose, discover, and automation view. |
| `/traces` | Recent agent and cron event log. |
| `/settings` | Settings hub. |
| `/settings/connections` | Connect or disconnect X and Telegram. |
| `/settings/voice` | Edit reference posts and view the extracted fingerprint. |
| `/auth/login` | Login with password or magic link. |
| `/auth/signup` | Create an account. |
| `/auth/forgot-password` | Send a password reset link. |
| `/auth/update-password` | Set a new password after reset. |

Core API routes:

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/compose` | `POST` | Manual or AI compose. |
| `/api/compose/bulk` | `POST` | Generate several angle-based drafts. |
| `/api/compose/use-variant` | `POST` | Replace active draft with a saved variant. |
| `/api/posts/[id]` | `GET/PATCH/DELETE` | Read, update, or delete a post. |
| `/api/posts/[id]/post` | `POST` | Publish a post or thread root to X. |
| `/api/discover/fetch` | `POST` | Fetch recent posts from configured X accounts. |
| `/api/discover/take` | `POST` | Create a reaction draft from a captured X post. |
| `/api/discover/qrt` | `POST` | Create a quote-retweet draft from a captured X post. |
| `/api/voice` | `GET/POST` | Load or save reference posts and fingerprint data. |
| `/api/upload` | `GET/POST` | List or add manual/web sources for compose context. |
| `/api/settings/channels` | `PUT` | Save a user's tracked account list. |
| `/api/billing` | `GET` | Return estimated spend buckets. |
| `/api/automation/trigger` | `POST` | Authenticated server-side trigger for cron endpoints. |
| `/api/queue/reset` | `POST` | Delete active queue roots for the current user. |

Auth and integration routes:

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/auth/x/authorize` | `GET` | Start X OAuth 2.0 PKCE. |
| `/api/auth/x/callback` | `GET` | Store X OAuth tokens. |
| `/api/auth/telegram/verify` | `POST` | Verify Telegram Login Widget data. |
| `/api/telegram/webhook` | `POST` | Handle Telegram approve/skip callbacks. |

## Database

The Drizzle schema is in `src/db/schema.ts`. Main tables:

- `profiles`
- `social_connections`
- `generations`
- `posts`
- `sources`
- `viral_posts`
- `claims`
- `fingerprints`
- `traces`

The optional memory layer adds `mem_*` tables in
`src/db/migrations/0002_memory.sql`.

## Scripts

```bash
npm run dev              # Next dev server
npm run build            # production build
npm run start            # start production build
npm run lint             # ESLint
npm run typecheck        # TypeScript check
npm run test             # Vitest
npm run test:watch       # Vitest watch mode
npm run test:coverage    # Vitest coverage
npm run db:generate      # generate Drizzle migration
npm run db:migrate       # apply migrations
npm run db:push          # push schema directly
npm run db:studio        # Drizzle Studio
npm run cron:once        # run local cron loop once
npm run cron:local       # run local cron loop continuously
```

Additional one-off scripts live in `scripts/` for checking DB connectivity,
testing X/Telegram credentials, exporting traces, and resolving influencer IDs.

## Known Gaps

- There are no Supabase RLS policies in this repository. Most dashboard/API
  queries are scoped in application code with `userId`.
- Some cron-created rows are not user-scoped yet, while normal UI flows are.
- The discover channel editor persists custom accounts, but the fetcher still
  uses `src/config/influencers.ts`.
- The README does not assert that the default model names are available to every
  OpenAI account; override them through env vars if needed.
