# Changelog

Журнал решений по проекту nfactz. Каждая запись — одна развилка, описанная по
6-частной структуре: проблема, ход мыслей, рассмотренные варианты, причина
выбора, измеримый результат, следующий шаг.

Это не машинно-сгенерированный лог коммитов — это история «почему мы решили
именно так». Полная история кода — в `git log`.

---

## 2026-05-22 — Скаффолд: Next.js + Drizzle, не supabase-js

**Проблема.** Supabase wizard предлагал `@supabase/supabase-js` + `@supabase/ssr`
из коробки. Это путь по умолчанию: CRUD через PostgREST, RLS, realtime, auth.
Но проект — это не CRUD-приложение, это многоагентный пайплайн с
embedding-similarity-поиском, traces, claim-extraction, сложными JOIN'ами.

**Ход мыслей.** §2 ТЗ явно говорит «We are not looking for simple AI wrappers».
supabase-js с PostgREST подталкивает к примитивному CRUD-стилю; pgvector
similarity search через `.rpc('match_documents')` — это уже не идиоматично.
Хочется типизированный SQL и полный контроль над запросами.

**Рассмотренные варианты.**
1. Чистый `@supabase/supabase-js` — то, что предложил wizard.
2. Drizzle ORM + `postgres.js` поверх той же Supabase Postgres — талкуем напрямую
   по wire, supabase-js остаётся доступным для будущего Storage/Auth.
3. Prisma — другой ORM, тоже работает.

**Причина выбора.** №2. pgvector с `cosineDistance(...)` first-class, типы
выводятся из schema без codegen, миграции лежат в репо под review. Supabase
остаётся managed Postgres'ом + (опционально потом) Storage и Auth.

**Результат.** 7 таблиц с embedding-колонками + HNSW индексами на posts /
sources / viral_posts. Schema = source of truth. Drizzle Studio для дебага.

**Дальше.** RAG-стрипы (past posts retrieval, research sources) будут читать те
же таблицы напрямую через Drizzle — не нужен второй слой абстракции.

---

## 2026-05-22 — Voice anchor — TONE only, не DATA

**Проблема.** Первая версия writer prompt'а звала voice anchor «past output»
и просила «match rhythm, vocab, sentence length». На сиде «Testing my new AI
bot to make my social media life easier» AI выдал: «Testing my new AI bot to
cut social media work from 3 hours/week to 30 minutes: it drafts 6 posts,
picks images, and queues reviews.» — выдуманные «3 hours/week», «6 posts»,
«picks images» (которых бот не делает).

**Ход мыслей.** Модель явно использовала voice anchor не только как стилевой
ориентир, но и как источник вдохновения «о чём писать» — она нашла в моих
LinkedIn-постах конкретные цифры и числа, и решила добавить их в свой ответ.
Anchor = TONE + DATA было ошибкой формулировки.

**Рассмотренные варианты.**
1. Удалить voice anchor совсем, оставить голый system prompt с описанием
   стиля. Потеряем индивидуальность.
2. Ужесточить prompt: разделить anchor на «extract these stylistic features
   ONLY, do NOT borrow topics/numbers/brands».
3. Перейти на структурный fingerprint (sentence stats, language mix, emoji
   rate) и вообще не давать модели сырые тексты.

**Причина выбора.** №2 сейчас, №3 как slice 6. Жёсткое правило в prompt'е
дешевле дописать, а сырые примеры всё равно полезны для нюансов, которые
fingerprint не передаст (commas vs ellipses, choice of "ngl" vs "lowkey",
self-deprecating tone).

**Результат.** После переформулировки на seed `"OpenAI dropped a new tiny
model, it's surprisingly good"` AI вернул `"OpenAI выкатили новый tiny model,
а он внезапно хорош 🤌"` — 56 chars, RU/EN mix как в моих Telegram-постах,
emoji в конце, без выдуманной конкретики. Editor agent ловит «content bleed
from voice anchor» как отдельный чек.

**Дальше.** Slice 6 добавил структурный fingerprint поверх — теперь модели
видят и сырые тексты, и измеримые статы.

---

## 2026-05-22 — Telegram-канал вместо LinkedIn для voice samples

**Проблема.** Первая загрузка voice anchor была из LinkedIn — 9 моих
постов. Модель брала из них специфические темы (KSP, гитара PRS, RE:9
прохождение) и иногда подмешивала в твиты на совершенно другие темы. Плюс
LinkedIn-посты длинные, многие — комментарии к репостам или фото, и в
текстовой выборке потерян контекст.

**Ход мыслей.** Voice = тон, но если сырые примеры сами по себе шумные
(пост со ссылкой на репост без видимого репоста), модель додумывает контекст.
LinkedIn — это вообще другой register: формальный «achievement»-стиль, не
шорт-форм Х. Не та платформа.

**Рассмотренные варианты.**
1. Оставить LinkedIn, добавить больше anti-bleed правил.
2. Переключиться на свой Telegram-канал `t.me/kekerontsky` — там короткий
   shitpost-режим, ближе к X и без image-context dropout.
3. Не использовать раздельные источники, просить пользователя писать новые
   reference-твиты прямо в /voice.

**Причина выбора.** №2. Telegram-канал автора короткий, casual, mixed
RU/EN/KZ, без forward-без-контекста (фильтруем reposts при scrape). 13
постов — баланс между «много примеров» и «не размазать стиль».

**Результат.** Среднее ~48 chars, dominant RU (57%), latin 24%, emoji rate
0.23/post, em-dash 0/post, ends-without-period 100%. Casual markers
автоэкстрактом: ботать×2, чалить, фигню, прочее прочее, провсё, fr,
shoutout. Это и есть структурный fingerprint — числа выше попали в writer
+ editor prompts напрямую.

**Дальше.** Когда пользователь подкопит больше постов на @kekeront, можно
будет перенести anchor на эти; пока Telegram остаётся более информативным
источником.

---

## 2026-05-22 — gpt-5.4-mini для writer + gpt-5-mini для всего остального

**Проблема.** Бюджет — $3 OpenAI кредитов (бесплатный тир). С gpt-5-mini
($0.25/$2.00 за 1M токенов) writer уверенно укладывался в копейки, но
output ощущался тускловатым: faithful, но без taste. Хочется чуть больше
изюма в основном тексте, но не платить premium за инфраструктурные
агенты (editor / evaluator / fact-checker — они классифицируют, не
сочиняют).

**Ход мыслей.** Все 4 LLM-агента бывают вызваны параллельно, ×N variants —
эффективная цена за compose = `(writer + editor + eval + fact) × N`. Если
сделать writer dearer на 3x, но остальные дешёвые — общий мульти-thesis
прогон останется в десятках центов.

**Рассмотренные варианты.**
1. Все 4 агента на gpt-5-mini — самое дешёвое, но writer-output слабее.
2. Все 4 на gpt-5.4-mini — таste выше, но fact-checker / evaluator не
   становятся реально лучше, бюджет жжётся в 3x быстрее.
3. Mix: writer = gpt-5.4-mini, остальные = gpt-5-mini.
4. Бамп до gpt-5.4 / gpt-5.5 для писателя — quality лучше, но цена 10x.

**Причина выбора.** №3. Это sweet spot: writer гонит за taste, editor /
eval / fact-checker — классификаторы, им не нужен flagship-разум. Тиры
вынесены в env (`LLM_WRITER_MODEL`, `LLM_MID_MODEL`, `LLM_CHEAP_MODEL`),
можно бампнуть писателя до 5.4 / 5.5 на финальный demo run одной env-сменой.

**Результат.** Single-variant compose: ~$0.005 ($0.001 writer + $0.001
editor + $0.002 evaluator + $0.001 fact-checker). 3-variant compose: ~$0.013.
Тред с outliner (5 постов, full pipeline): $0.013 / 8186 токенов / eval
95/100. На демо-сценариях бюджет не нагружает.

**Дальше.** Если judges запустят heavy demo, можно проигнорировать
gpt-5.5 ($2.50/$15 предположительно) — оставляем шорт-листом для
финального полировочного прогона.

---

## 2026-05-22 — Multi-thesis: 3 параллельных кандидата + eval ranking

**Проблема.** Один вариант writer'а — это лотерея. Иногда первый ответ
скучный, переcкан, и пользователь тратит API-call просто чтобы пересоздать.
Хочется в один клик увидеть 3 угла и выбрать лучший. Плюс ТЗ §многоагентка
явно намекает на «multi-thesis для одного топика».

**Ход мыслей.** Если запускать N=3 writer'ов параллельно, мы платим
3x, но получаем спрос на eval-rubric — у нас уже есть evaluator (slice 7),
который скорит 0-100 по 6 критериям. Можно автоматически выбирать
winner по `overall` и показывать losers как opt-in варианты.

**Рассмотренные варианты.**
1. N=1 всегда — самый дешёвый, пользователь сам пересоздаёт.
2. N=3 с ручным выбором — пользователь смотрит на 3 варианта и сам
   указывает который ему ближе.
3. N=3 с автовыбором winner'а по eval score — пишем winner в queue
   автоматически, runner-up'ы показываем рядом с кнопкой «use this
   instead».
4. N=5 / N=7 — больше разнообразия, но 5-7x цена.

**Причина выбора.** №3. Защищает пользователя от плохого первого
ответа и одновременно сохраняет агентность («can override»). N=3 это
sweet spot: 3 угла — это уже разнообразие, дальше diminishing returns.

**Результат.** Compose теперь принимает `variants: 1-3`. Все варианты
бегут через `Promise.all`, sort by `eval.overall` desc, winner идёт в
queue с posts, остальные — в `generations.input_meta.allVariants` с
полным текстом. Кнопка «use this instead» на runner-up'е
переключает winner без повторного вызова LLM (тексты уже сохранены).

**Дальше.** Логировать какой именно variant выбран в финальном demo —
полезный сигнал для дальнейшей тюнинга prompts.

---

## 2026-05-22 — Outliner перед writer для тредов

**Проблема.** При `contentType="thread"` writer выдавал 5-7 постов, но
часто терял coherence: пост 3 повторял пост 1, пост 5 заканчивался
тоном «вопрос к аудитории», или beats шли не по логической прогрессии
(open → develop → close).

**Ход мыслей.** Когда я пишу тред руками, я сначала набрасываю beats
карандашом, а потом раскрываю каждый. LLM пытается делать обе работы
одновременно и теряет нить. Разнести на два LLM-call'а — это
маленькая стоимость, заметное качество.

**Рассмотренные варианты.**
1. Оставить single-pass writer, ужесточить prompt («заранее распиши
   план, потом пиши»). Tried — не работает стабильно: модель
   игнорирует мета-инструкции под нагрузкой.
2. Outliner agent сначала, потом writer с outline beats как input.
3. Длинный writer prompt с few-shot примером thread'ов.

**Причина выбора.** №2. Outliner — это $0.0005 (JSON-only), writer
после него видит готовую структуру и пишет один пост per beat —
гораздо больше шансов держать когерентность.

**Результат.** Тест на seed «почему многие AI стартапы умирают на
этапе перехода в прод» — 5-постовый тред:
1. Большинство AI-стартапов гибнут на переходе в прод 😭
2. Исследовательский прототип плохо живёт в стабильной архитектуре
3. Недооценивают данные, инфраструктуру и постоянный фич-пайплайн
4. Исследователи редко умеют SRE, мониторинг и CI
5. Владелец продакшна должен быть инженером, и бюджет на MLOps тоже

Eval 95/100, посты ≤65 chars каждый, нет повторов, есть прогрессия
(observation → root cause → specifics → resolution), emoji только
на открытии — fingerprint-aligned.

**Дальше.** Outline сохраняется в `generations.input_meta.outlineBeats` —
видно в /traces. Дальше можно показать outline в queue UI рядом с
тредом, чтобы пользователь редактировал beats отдельно от writer-pass.

---

## 2026-05-22 — JSON-агенты: maxTokens должен учитывать gpt-5 reasoning tokens

**Проблема.** Evaluator, fact-checker, outliner, editor — все на
gpt-5-mini с `response_format=json_object`. Запустили eval после
slice 7 — все 3 варианта вернули `{ scores: { all zeros }, critique:
"evaluator returned non-JSON output" }`. JSON.parse падал.

**Ход мыслей.** Стек дёрнул выход на 800 токенов (наш `maxTokens`), а
gpt-5 family выделяет reasoning tokens **внутри** того же
`max_completion_tokens` бюджета. Reasoning «съедал» 600+ токенов,
JSON начинал писаться, упирался в лимит, обрывался. JSON.parse
падал с SyntaxError → fallback с нулями.

**Рассмотренные варианты.**
1. Отдельный пост-парс с lenient repair (truncated JSON dragon).
2. Переключиться на не-reasoning модель (gpt-4o-mini) для JSON-агентов.
3. Поднять `maxTokens` сильно — пусть reasoning тратит сколько надо, и
   JSON всё равно влезет.
4. Использовать OpenAI structured outputs strict schema (более новая
   фича) — гарантирует валидный JSON независимо от reasoning.

**Причина выбора.** №3 как быстрый фикс, №4 как следующий слайс. Бамп
800 → 3000 на evaluator / fact-checker / editor и 800 → 2000 на
outliner. Per-call cost вырастает на доли цента (большинство токенов
всё равно не используются), но больше нет fallback-zeros.

**Результат.** После фикса: eval вернул `83/100` на single ("AI
агентов уже везде..."), `95/100` на thread про AI startups, с реальной
критикой ("дословный перевод"), а не fallback-строкой. Critique
выявляет реальные слабости — это значит rubric scoring работает
end-to-end.

**Дальше.** Перейти на OpenAI structured outputs (zodResponseFormat) —
тогда maxTokens можно вернуть на адекватные 800, плюс уберём boilerplate
парсинга в каждом агенте.

---

## 2026-05-22 — Discover loop: вместо сразу-real-agentic-research

**Проблема.** ТЗ упоминает «autonomous research workflows». Полная
реализация — это headless agent, который сам решает что почитать на
HN/arXiv/Substack, делает curl, парсит, синтезирует, выбирает «о чём
писать». 1-2 недели работы. У нас есть один день.

**Ход мыслей.** Можно отделить «discovery» от «autonomy». Discovery —
кто такие интересные авторы и что они сейчас публикуют. Autonomy —
когда система сама дёргает discovery и сама генерит черновики без
участия пользователя.

**Рассмотренные варианты.**
1. Только manual: пользователь сам вводит топик, system пишет.
   Никакой «discovery».
2. Discovery + manual trigger: pre-курированный список 10 голосов,
   ручная кнопка `fetch viral`, take/qrt buttons. Никакой autonomy.
3. Discovery + cron-driven autonomy: тот же fetch + cron-генерация
   каждые 4 часа берёт топ-engagement viral и делает take/QRT
   автоматически.
4. Real research agent с tool calling, browser, parsing arXiv PDFs.

**Причина выбора.** №3 как deliverable, №4 как roadmap. №3 проверяемо
(curl `/api/cron/discover` → captured 54 tweets), демонстрирует
agentic-stack и реально полезно автору (Telegram-канал ↔ X через
auto-takes). №4 — слайс на отдельную сессию.

**Результат.** `src/config/influencers.ts` курированный список из 10
tech-голосов. `/api/discover/fetch` → 54 твита за 18 X API-вызовов /
34s / ~$0.10 PPU. `/api/cron/discover` cron 12h. `/api/cron/generate`
берёт top-engagement viral из последних 48h (с dedup against last 7d
generations) и автономно гонит через take + editor + eval +
fact-check pipeline.

**Дальше.** HN Algolia / arXiv / Substack RSS adapters в `src/adapters/`
— тот же интерфейс, что у X, чтобы можно было mix sources в одном
fetch. Это slice 4d+.

---

## История слайсов

```
0  скаффолд (Next.js 16 + Drizzle + Supabase + shadcn)
1  real generation + voice anchor + compose UI
2a post to X (manual approve + ship)
2b scheduling + cron drain
2c cadence strip в layout
3a editor agent + gpt-5.4-mini writer
3b retry / remove / soft-skip / persist mode
4a discover (viral X parser, 10 tracked voices)
4b take agent на viral posts
4c QRT agent + posting с quote_tweet_id
5  trace viewer UI
6  voice fingerprint extraction
7  eval rubric + multi-thesis ranking
8  fact-checker agent + claims table
9  autonomous /api/cron/generate
10 outliner agent для тредов
11 variant selector UI
12 README + deploy notes
```

Полный лог — `git log --oneline`. Cost-per-pipeline и live evidence — в
`traces/agent-traces.md` (auto-export через `scripts/export-traces.mjs`).
