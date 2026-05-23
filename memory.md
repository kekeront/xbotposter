# nfactz — context snapshot for next session

Compressed project state. Read this first when picking up the project.

## What it is

Agentic X (Twitter) content engine for personal branding. Built as a real
tool for `@kekeront`, doubles as the Higgsfield Agentic AI Engineer
assignment submission.

Multi-agent pipeline with 8 distinct agents (outliner → writer → editor →
[evaluator ‖ fact-checker], plus topic-guard, take, qrt, poster). Voice
fingerprinted from the user's Telegram channel `t.me/kekerontsky` (TONE
only — never borrow topics/specifics from anchor). Russian-first output.
Hard $2/day spend cap. Topic guard blocks politics/tragedy/conspiracy
fail-closed.

## Status (2026-05-23)

- **17 slices done, all committed locally** (last: `884b33f slice 17:
  local cron runner + live auto-refresh on dashboards`)
- **15+ commits ahead of origin** — `git push origin main` is blocked by
  user's hook, has to be done manually
- **NOT deployed yet** — `git push` then Vercel deploy is the final
  delivery step
- **Localhost autonomous works** via `npm run cron:local` in a second
  terminal alongside `npm run dev` (requires `CRON_SECRET` in `.env.local`)

## Known issues at this snapshot

- User reported "automation on localhost doesn't work" — root cause was
  `CRON_SECRET` empty in `.env.local`. Fix: `echo "CRON_SECRET=$(openssl
  rand -hex 32)" >> .env.local`, then restart dev server.
- Telegram bot is set up (token + chat_id added, test message confirmed
  delivered) but webhook isn't registered yet — requires deploy first
  (need a public URL for `setWebhook`).
- One Epstein/paulg take draft was generated in slice 4 testing, caught
  by manual review, then skipped via `scripts/skip-unsafe.mjs`. Slice 13
  topic-guard prevents this from happening again.

## Where to look for context

| | |
|---|---|
| README.md | Full architecture, agents, API, cost model, deploy notes |
| CHANGELOG.md | Decision journal (6-part format: Problem / Reasoning / Alts / Why / Result / Next) — 15+ entries covering every major fork |
| traces/agent-traces.md | Auto-exported live agent events (87+ at last export) |
| ~/.claude/projects/-home-altairzhambyl-projects-nfactz/memory/ | 6 memory files Claude auto-loads next session |

## Cost optimization stack already applied

1. Pre-resolved user IDs in `INFLUENCERS` config (-50% reads per run)
2. `userTimeline max_results: 5` (-50% more)
3. `since_id` per author — only pay for new tweets (-90% steady state)
4. `MAX_DAILY_USD=2` cap with 429 lockout on `/api/cron/*`
5. URL warning in manual compose ($0.20 fee detection)
6. Dynamic X cost in billing tracker (actual `tweetsFetched` from traces)
7. OpenAI cached-input pricing for gpt-5.4-mini ($0.075/1M)

Result: ~$6-10/month autonomous burn instead of ~$45/month baseline.

## What's left for delivery

1. `git push origin main` (user manual — hook blocks Claude)
2. Vercel deploy — env vars from `.env.local`, framework Next.js
3. After deploy: `curl <vercel>/api/cron/discover` once with Bearer to
   seed the pipeline
4. Register Telegram webhook one-time:
   ```
   curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=$NEXT_PUBLIC_APP_URL/api/telegram/webhook?secret=$TELEGRAM_WEBHOOK_SECRET"
   ```
5. Submit: production URL · `github.com/kekeront/xbotposter` ·
   `traces/agent-traces.md`

## What I'd build next if asked

- `slice 18`: Owned-reads optimization — try `/users/me/timelines/reverse_chronological` for tracked accounts (potentially 5-10× cheaper at $0.001/resource)
- `slice 19`: HN Algolia / arXiv / Substack adapters (non-X sources)
- `slice 20`: Daily Telegram digest of yesterday's autonomous activity
- `slice 21`: OpenAI Structured Outputs (zod schema) — replace JSON-mode
  parsing, can drop `maxTokens` back from 3000 to ~800 (saving input cost)
