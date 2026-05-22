# nfactz

Agentic X content engine — admin panel and backend.

## Slice 0 — what's here

The stack skeleton: Next.js 16, Drizzle on Supabase Postgres + pgvector, OpenAI
SDK, X API client, observability traces, shadcn UI shell. No real generation
yet — that's slice 1.

## Setup

### 1. Supabase

1. Create a Supabase project at <https://supabase.com>.
2. Enable the `vector` extension: Dashboard → Database → Extensions → toggle on
   `vector` (or run `CREATE EXTENSION IF NOT EXISTS vector;` in the SQL editor).
3. Project Settings → Database → Connection string. Copy two URLs:
   - **Transaction pooler** (port `6543`) → `DATABASE_URL` (runtime app)
   - **Direct connection** (port `5432`) → `DATABASE_DIRECT_URL` (migrations only)

### 2. Env

Copy `.env.example` to `.env.local` and fill in values. Secrets stay out of
git (`.env*` is gitignored).

### 3. Install + migrate

```bash
npm install
npm run db:migrate    # applies src/db/migrations/* to DATABASE_DIRECT_URL
npm run dev           # http://localhost:3000
```

### 4. Smoke test

```bash
# Create a placeholder draft (proves DB write path)
curl -X POST http://localhost:3000/api/compose \
  -H "Content-Type: application/json" \
  -d '{"topic": "hello world"}'

# Then refresh http://localhost:3000/queue — the row should appear.
```

## Stack

- **Frontend + API**: Next.js 16 (App Router), React 19, Tailwind 4, shadcn/ui
- **DB**: Supabase Postgres + pgvector, accessed via Drizzle ORM + postgres.js
- **LLM**: OpenAI (`gpt-5-nano` / `gpt-5-mini` / `gpt-5-mini` for writer; swap
  to `gpt-5.4-mini` or `gpt-5.4` for demo polish via `LLM_WRITER_MODEL`)
- **Embeddings**: `text-embedding-3-small`
- **X posting**: `twitter-api-v2`, user-context OAuth 1.0a
- **Scheduling**: Vercel Cron (see `vercel.json`)
- **Validation**: Zod everywhere user input crosses a boundary

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on `:3000` |
| `npm run build` | Production build |
| `npm run start` | Run the built app |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | Generate a Drizzle migration from schema diff |
| `npm run db:migrate` | Apply pending migrations to `DATABASE_DIRECT_URL` |
| `npm run db:studio` | Open Drizzle Studio (DB GUI) |

## Layout

```
src/
├── app/
│   ├── (admin pages: queue, compose, voice, discover, schedule, history, traces)
│   └── api/
│       ├── compose/route.ts            POST: create a draft
│       ├── posts/[id]/route.ts         GET / PATCH / DELETE
│       └── cron/
│           ├── generate/route.ts       Vercel Cron — autonomous draft
│           └── post/route.ts           Vercel Cron — drain to X
├── components/
│   ├── shell/                          Nav + layout primitives
│   └── ui/                             shadcn primitives
├── db/
│   ├── client.ts                       postgres.js + Drizzle
│   ├── schema.ts                       All tables; embedding columns + HNSW
│   └── migrations/                     drizzle-kit generated SQL
├── lib/
│   ├── env.ts                          Zod-validated env (server-only)
│   ├── llm.ts                          OpenAI tier abstraction + cost
│   ├── x.ts                            twitter-api-v2 wrapper
│   ├── trace.ts                        Trace event writer
│   ├── cron-auth.ts                    Vercel Cron auth header check
│   └── utils.ts                        shadcn `cn()`
└── agents/
    └── writer.ts                       Stub for slice 1
```

## Roadmap

| Slice | What ships |
|---|---|
| **0** *(here)* | Stack skeleton, schema, stubs, admin shell |
| 1 | `/api/compose` actually drafts via OpenAI |
| 2 | Approve → post to X end-to-end |
| 3 | Vercel Cron fires autonomous drafts |
| 4 | HN/arXiv/Substack research adapters |
| 5 | Trace viewer UI (live agent events) |
| 6+ | Voice fingerprinting, fact-checking, eval gate, multi-agent loop |
