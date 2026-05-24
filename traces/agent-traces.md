# Agent traces

Latest agent events from the live nfactz database, exported by `scripts/export-traces.mjs`. Each generation is one user-triggered or cron-triggered run through the multi-agent pipeline.

**Pipeline (current):** searcher → outliner (threads) → writer → editor → [evaluator ‖ fact-checker]. Sources persisted to `sources` table; claims linked via `source_id`.

**Discovery adapters:** X influencers + HN top stories + arXiv CS.AI/CL/LG + Substack feeds → `sources` table.

Re-export with `npx tsx scripts/export-traces.mjs` to capture the latest events.

---

## Expected trace shape (current pipeline)

A compose or take run now produces these events in order:

| # | Agent | Event | Notes |
|---|---|---|---|
| 1 | `compose` / `cron-generate` | `start` | — |
| 2 | `memory` | `recall` | hybrid FTS+vector retrieval |
| 3 | `searcher` | `complete` | web_search_preview; sources persisted |
| 4 | `outliner` | `complete` | threads only |
| 5 | `writer` | `start` / `complete` | per variant |
| 6 | `editor` | `complete_with_changes` / `complete_no_changes` | per variant |
| 7 | `evaluator` | `complete` | parallel with fact-checker |
| 8 | `fact-checker` | `complete` / `complete_with_invented` | claims linked to sources |
| 9 | `compose` / `cron-generate` | `complete` | total cost includes searcher |

Discover runs produce an additional `adapters_complete` event with HN/arXiv/Substack results.

---

## qrt on @gdb: the model alone is no longer the product

- mode: `qrt` · status: `succeeded` · total cost: $0.00195

| Time | Agent | Event | Model | Tokens | Cost |
|---|---|---|---|---|---|
| 15:21:53 | `searcher` | `complete` | gpt-5-mini | 420/85 | $0.00027 |
| 15:21:53 | `qrt` | `start` | — | — | — |
| 15:21:56 | `qrt` | `complete` | gpt-5.4-mini | 760/16 | $0.00064 |
| 15:22:03 | `editor` | `complete_with_changes` | gpt-5-mini | 1207/502 | $0.00131 |
| 15:22:05 | `evaluator` | `complete` | gpt-5-mini | 850/780 | $0.00178 |
| 15:22:05 | `fact-checker` | `complete` | gpt-5-mini | 310/200 | $0.00048 |

## take on @paulg: The fact that Trump made so sure to silence Marjorie Taylor Greene and Thomas Massie…

> **Note:** this take predates the topic-guard (slice 13). Political content is now blocked before generation.

- mode: `take` · status: `succeeded` · total cost: $0.00212

| Time | Agent | Event | Model | Tokens | Cost |
|---|---|---|---|---|---|
| 15:20:29 | `take` | `start` | — | — | — |
| 15:20:31 | `take` | `complete` | gpt-5.4-mini | 859/34 | $0.00080 |
| 15:20:39 | `editor` | `complete_no_changes` | gpt-5-mini | 1251/506 | $0.00133 |

## почему многие AI стартапы умирают на этапе перехода в прод

- mode: `ai` · status: `succeeded` · total cost: $0.01349

| Time | Agent | Event | Model | Tokens | Cost |
|---|---|---|---|---|---|
| 15:15:59 | `compose` | `start` | — | — | — |
| 15:16:05 | `searcher` | `complete` | gpt-5-mini | 380/95 | $0.00029 |
| 15:16:27 | `outliner` | `complete` | gpt-5-mini | 609/1842 | $0.00384 |
| 15:16:27 | `writer` | `start` | — | — | — |
| 15:16:29 | `writer` | `complete` | gpt-5.4-mini | 1847/93 | $0.00180 |
| 15:16:51 | `editor` | `complete_no_changes` | gpt-5-mini | 1295/1465 | $0.00325 |
| 15:17:09 | `evaluator` | `complete` | gpt-5-mini | 954/807 | $0.00185 |
| 15:17:09 | `fact-checker` | `complete_with_invented` | gpt-5-mini | 406/1319 | $0.00274 |
| 15:17:11 | `compose` | `complete` | — | — | — |

**Outline beats:**

- Большинство AI-стартапов гибнут при переходе в прод 😭
- Исследовательский прототип плохо переносится в стабильную архитектуру
- Недооценены данные инфраструктура и постоянный пайплайн для фич
- Команда исследователей редко умеет строить SRE мониторинг и CI
- Сделайте владельцем продакшна инженера и выделите бюджет на MLOps

**Winner eval:** overall 95/100 · critique: Чётко и по делу; можно добавить один конкретный пример или короткий совет для продакшна.

## AI agents everywhere but production-ready ones are still rare

- mode: `ai` · status: `succeeded` · total cost: $0.00526

| Time | Agent | Event | Model | Tokens | Cost |
|---|---|---|---|---|---|
| 15:13:23 | `compose` | `start` | — | — | — |
| 15:13:23 | `writer` | `start` | — | — | — |
| 15:13:31 | `writer` | `complete` | gpt-5.4-mini | 1729/17 | $0.00137 |
| 15:13:40 | `editor` | `complete_no_changes` | gpt-5-mini | 1202/613 | $0.00153 |
| 15:13:51 | `evaluator` | `complete` | gpt-5-mini | 857/744 | $0.00170 |
| 15:13:51 | `fact-checker` | `complete` | gpt-5-mini | 309/289 | $0.00065 |
| 15:13:52 | `compose` | `complete` | — | — | — |

**Winner eval:** overall 83/100 · critique: Коротко и точнo, но это почти дословный перевод — можно добавить более конкретную наблюдение.

## AI agents everywhere but production-ready ones are still rare

- mode: `ai` · status: `succeeded` · total cost: $0.01925

| Time | Agent | Event | Model | Tokens | Cost |
|---|---|---|---|---|---|
| 15:10:23 | `compose` | `start` | — | — | — |
| 15:10:23 | `writer` | `start` | — | — | — |
| 15:10:23 | `writer` | `start` | — | — | — |
| 15:10:23 | `writer` | `start` | — | — | — |
| 15:10:30 | `writer` | `complete` | gpt-5.4-mini | 1729/14 | $0.00136 |
| 15:10:30 | `writer` | `complete` | gpt-5.4-mini | 1729/16 | $0.00137 |
| 15:10:37 | `writer` | `complete` | gpt-5.4-mini | 1729/15 | $0.00136 |
| 15:10:42 | `editor` | `complete_with_changes` | gpt-5-mini | 1199/892 | $0.00208 |
| 15:10:44 | `editor` | `complete_with_changes` | gpt-5-mini | 1201/954 | $0.00221 |
| 15:10:53 | `evaluator` | `complete` | gpt-5-mini | 857/800 | $0.00181 |
| 15:10:53 | `fact-checker` | `complete` | gpt-5-mini | 309/413 | $0.00090 |
| 15:10:54 | `editor` | `complete_with_changes` | gpt-5-mini | 1200/1272 | $0.00284 |
| 15:10:55 | `evaluator` | `complete` | gpt-5-mini | 855/800 | $0.00181 |
| 15:10:56 | `fact-checker` | `complete` | gpt-5-mini | 307/347 | $0.00077 |
| 15:11:05 | `evaluator` | `complete` | gpt-5-mini | 859/800 | $0.00181 |
| 15:11:05 | `fact-checker` | `complete` | gpt-5-mini | 311/413 | $0.00090 |
| 15:11:06 | `compose` | `complete` | — | — | — |

**Winner eval:** overall 0/100 · critique: evaluator returned non-JSON output

## AI agents everywhere now but production-ready ones are still rare

- mode: `ai` · status: `failed` · total cost: $0.01695

| Time | Agent | Event | Model | Tokens | Cost |
|---|---|---|---|---|---|
| 14:59:18 | `compose` | `start` | — | — | — |
| 14:59:18 | `writer` | `start` | — | — | — |
| 14:59:18 | `writer` | `start` | — | — | — |
| 14:59:18 | `writer` | `start` | — | — | — |
| 14:59:21 | `writer` | `complete` | gpt-5.4-mini | 1730/16 | $0.00137 |
| 14:59:21 | `writer` | `complete` | gpt-5.4-mini | 1730/17 | $0.00137 |
| 14:59:21 | `writer` | `complete` | gpt-5.4-mini | 1730/15 | $0.00136 |
| 14:59:29 | `editor` | `complete_no_changes` | gpt-5-mini | 1203/608 | $0.00152 |
| 14:59:30 | `editor` | `complete_no_changes` | gpt-5-mini | 1202/549 | $0.00140 |
| 14:59:33 | `editor` | `complete_with_changes` | gpt-5-mini | 1201/850 | $0.00200 |
| 14:59:44 | `evaluator` | `complete` | gpt-5-mini | 858/800 | $0.00181 |
| 14:59:44 | `evaluator` | `complete` | gpt-5-mini | 857/800 | $0.00181 |
| 14:59:44 | `fact-checker` | `complete` | gpt-5-mini | 310/481 | $0.00104 |
| 14:59:44 | `fact-checker` | `complete` | gpt-5-mini | 309/418 | $0.00091 |
| 14:59:48 | `evaluator` | `complete` | gpt-5-mini | 859/800 | $0.00181 |
| 14:59:49 | `fact-checker` | `complete` | gpt-5-mini | 311/224 | $0.00053 |
| 14:59:50 | `compose` | `error` | — | — | — |

**Winner eval:** overall 0/100 · critique: evaluator returned non-JSON output

## OpenAI dropped a new tiny model, it's surprisingly good

- mode: `ai` · status: `succeeded` · total cost: $0.00283

| Time | Agent | Event | Model | Tokens | Cost |
|---|---|---|---|---|---|
| 13:57:29 | `compose` | `start` | — | — | — |
| 13:57:30 | `writer` | `start` | — | — | — |
| 13:57:33 | `writer` | `complete` | gpt-5.4-mini | 1508/20 | $0.00122 |
| 13:57:33 | `editor` | `start` | — | — | — |
| 13:57:42 | `editor` | `complete_no_changes` | gpt-5-mini | 984/680 | $0.00161 |
| 13:57:43 | `compose` | `complete` | — | — | — |

## Testing my new AI bot to make my social media life easier. Hope it works :)

- mode: `ai` · status: `succeeded` · total cost: $0.00208

| Time | Agent | Event | Model | Tokens | Cost |
|---|---|---|---|---|---|
| 12:33:27 | `compose` | `start` | — | — | — |
| 12:33:28 | `writer` | `start` | — | — | — |
| 12:33:31 | `writer` | `complete` | gpt-5.4-mini | 1151/23 | $0.00097 |
| 12:33:31 | `editor` | `start` | — | — | — |
| 12:33:38 | `editor` | `complete_no_changes` | gpt-5-mini | 1051/427 | $0.00112 |
| 12:33:39 | `compose` | `complete` | — | — | — |

## Testing my new AI bot to make my social media life easier. Hope it works :)

- mode: `manual` · status: `succeeded` · total cost: $0.00000

| Time | Agent | Event | Model | Tokens | Cost |
|---|---|---|---|---|---|
| 12:25:23 | `compose` | `start` | — | — | — |
| 12:25:24 | `compose` | `complete` | — | — | — |
| 12:25:43 | `poster` | `start` | — | — | — |
| 12:25:47 | `poster` | `complete` | — | — | — |

## Testing my new AI bot to make my social media life easier. Hope it works :)

- mode: `manual` · status: `succeeded` · total cost: $0.00000

| Time | Agent | Event | Model | Tokens | Cost |
|---|---|---|---|---|---|
| 12:13:41 | `compose` | `start` | — | — | — |
| 12:13:42 | `compose` | `complete` | — | — | — |
| 12:14:48 | `poster` | `start` | — | — | — |
| 12:14:49 | `poster` | `error` | — | — | — |

## Testing my new AI bot to make my social media life easier. Hope it works :)

- mode: `?` · status: `succeeded` · total cost: $0.00177

| Time | Agent | Event | Model | Tokens | Cost |
|---|---|---|---|---|---|
| 12:04:17 | `compose` | `start` | — | — | — |
| 12:04:18 | `writer` | `start` | — | — | — |
| 12:04:32 | `writer` | `complete` | gpt-5-mini | 398/833 | $0.00177 |
| 12:04:33 | `compose` | `complete` | — | — | — |

## Testing my new AI bot to make my social media life easier. Hope it works :)

- mode: `?` · status: `failed` · total cost: $0.00000

| Time | Agent | Event | Model | Tokens | Cost |
|---|---|---|---|---|---|
| 12:03:36 | `compose` | `start` | — | — | — |
| 12:03:37 | `writer` | `start` | — | — | — |
| 12:03:40 | `compose` | `error` | — | — | — |

## Testing my new system to automate my social media life, hope it works

- mode: `?` · status: `failed` · total cost: $0.00000

| Time | Agent | Event | Model | Tokens | Cost |
|---|---|---|---|---|---|
| 11:59:11 | `compose` | `start` | — | — | — |
| 11:59:12 | `writer` | `start` | — | — | — |
| 11:59:14 | `compose` | `error` | — | — | — |

## Standalone events (cron / system)

| Time | Agent | Event | Payload |
|---|---|---|---|
| 15:19:10 | `discover` | `adapters_complete` | {"hn":{"fetched":12,"ingested":12},"arxiv":{"fetched":10,"ingested":10},"substack":[{"publication":"simonwillison","fetched":5,"ingested":5},...]} |
| 15:19:04 | `discover` | `complete_with_errors` | {"errors":["@karpathy: userByUsername(@karpathy) timed out after 8000ms"],"sourc |
| 15:18:30 | `discover` | `start` | {"source":"cron","influencers":10} |