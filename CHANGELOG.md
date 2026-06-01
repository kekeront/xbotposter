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

## 2026-05-22 — Topic guard: fail-closed gate (slice 13)

**Проблема.** Live тест: discover вытащил viral пост от @paulg про
Эпштейновские файлы. Take agent сгенерил гладкий RU комментарий («Если
это и правда так, то самое опасное тут не "что в файлах", а кто первым
решит ботать версию под себя 😬»). Драфт сел в queue в одном клике от
production timeline'а @kekeront. Approval gate спас, но autonomous
mode без guard'а бы зашипил.

**Ход мыслей.** Personal brand в tech/AI не может позволить commentary
про политику/конспирологию/трагедии — даже умное. Topic — это
бинарная классификация перед любой генерацией. И эта классификация
должна быть fail-closed: parse error → unsafe.

**Рассмотренные варианты.**
1. Чёрный список авторов (выкинуть paulg из INFLUENCERS). Потеряем
   его tech-takes, плюс другие авторы тоже иногда уходят в политику.
2. Whitelist топиков в writer/take/qrt промпте. Модель часто игнорит
   «only if topic is AI/SWE/startup».
3. Отдельный classifier agent (`topic-guard`) на gpt-5-nano перед
   генерацией. Дешёвый ($0.00003), быстрый, fail-closed.
4. RLHF-стиль fine-tune собственного фильтра. 1+ неделя работы.

**Причина выбора.** №3. Чистая separation: writer пишет, guard
фильтрует. Категории явные: ALLOW (AI/SWE/startup/science) и BLOCK
(politics by name, geopolitics, conspiracy-adjacent incl Epstein,
tragedies, religion, identity, crypto calls, ambiguous).

**Результат.** `src/agents/topic-guard.ts` гонит JSON через gpt-5-nano,
вшит в /api/discover/take, /qrt, /cron/generate. В take/qrt: при
blocked возвращаем 200 OK с {blocked: true, category, reason} —
ничего не пишется в generations, не тратим OpenAI tokens. В
cron-generate: walk top viral list, берём первого кто прошёл guard.
UI показывает «🛡 blocked by topic guard: politics — ...» вместо
draft. Trace events topic-guard.safe / .blocked с категорией и
причиной.

**Дальше.** Watchlist для категорий, где guard «sometimes wrong» —
например, finance/markets edge case. Может быть UI override «I know
better, run anyway» для тех редких случаев когда юзер сам уверен.

---

## 2026-05-22 — Billing visibility + X cost optimizations (slice 14)

**Проблема.** Cost discipline была невидимой. Юзер не понимает где
утекает $5 X PPU кредит. Каждый discover run жрал $0.55-1.10
(подтверждено: 10 userByUsername + 10 userTimeline×10 = 110
resources × $0.005-0.010). При 12h schedule = $1.10-2.20/день, на $5
хватит на 2-4 дня. Это unacceptable для long-term autonomy.

**Ход мыслей.** Два независимых ходда: (1) сделать spend visible
прямо в layout, чтобы юзер видел burn rate в реальном времени, (2)
вычистить очевидные waste'ы в discover pipeline.

**Рассмотренные варианты для opt'а.**
1. Reduce INFLUENCERS list — но юзер хочет breadth.
2. Reduce cron schedule с 12h до 24h — теряем актуальность.
3. Cache user IDs в config — `userByUsername` возвращает один и тот
   же ID для karpathy всегда, мы платим за бесполезный лукап.
4. `max_results: 10 → 5` — меньше resources per call.
5. `since_id` per author — самое мощное, отдельный слайс 15.

**Причина выбора.** Сделали 3 + 4 в этом слайсе (5 в следующем). 3 +
4 вместе = $0.55-1.10 → $0.13-0.25 per run. Это уже -75%. UI billing
через `loadBilling()` в layout cadence strip с цветовой шкалой
(green <10¢/день, amber, red >$1/день).

**Результат.** Pricing table из X docs (per-resource read $0.005-0.010,
write tweet $0.015, write tweet с URL $0.20 (13×!)). Cost-per-run
шёл с ~$0.77 (average) до ~$0.19. Cadence strip показывает today /
7d / month real-time, tooltip с разбивкой OpenAI vs X est. PD review
дал side-effect фиксы: removed dev-only «slice X» labels из nav,
схему picker default «tomorrow 9am», compose result regenerate
button, fetch confirm уточнил cost estimate.

**Дальше.** Slice 15 — since_id (самая мощная оптимизация). После
этого — owned reads через own timeline (потенциально 5-10× дешевле,
если эндпойнт работает для followed accounts).

---

## 2026-05-22 — since_id + spend cap + URL warning (slice 15)

**Проблема.** Даже после slice 14 дискавер тянул одни и те же 5
твитов с каждого инфлюенсера каждый раз. Steady-state cost оставался
постоянным ($0.13-0.25 per run), хотя реально новых твитов могло
быть 0-2 per author. Платим за дубликаты.

**Ход мыслей.** X API поддерживает `since_id` — вернёт только твиты
с ID больше указанного. Если в `viral_posts` уже сохранены max ID
per author, передаём как since_id, X возвращает только инкремент.
Cost становится proportional to actual new content. Параллельно:
juser нужен hard spend cap (cron auto burn до $$$ без oversight) и
URL warning для manual compose (один пост с URL = $0.20 = 13× normal).

**Рассмотренные варианты для cap'а.**
1. Soft warning при превышении — easy to ignore.
2. Hard 429 на cron endpoints при превышении daily threshold — manual
   actions остаются (юзер opt-in).
3. Hard cap на ВСЁ — слишком жёстко, юзер может специально дожать
   demo.

**Причина выбора.** №2. Cron автоматический, юзер не видит каждое
срабатывание — там лимит обязателен. Manual UI — юзер видит cadence
strip с цветом и сам решает.

**Результат.** `since_id` в lib/x.ts + lib/discover.ts:
`loadLatestSeenByAuthor()` запрашивает MAX(xTweetId::numeric) per
author из viral_posts; в каждый userTimeline call передаём sinceId.
Steady-state cost: $0.00-0.10 per run (было $0.13-0.25). При тихих
инфлюенсерах — near zero. `MAX_DAILY_USD` env (default $2.00) +
`src/lib/spend-cap.ts` `checkSpendCap()` встроен в /api/cron/discover,
/cron/generate, /cron/post. При превышении: 429 + JSON
{skipped, todayUsd, capUsd}. Manual UI не gated.

Billing tracker заменил статичную оценку `discoverRunCount × $0.25`
на динамическую `discoverResourcesTotal × $0.0075` — извлекает
`payload->>'tweetsFetched'` из traces. Cadence strip tooltip
теперь показывает реальное число fetched tweets, не только runs.

URL detection в manual compose: regex `\bhttps?:\/\/\S+` в реальном
времени, если поймали — амбер warning «X charges $0.20 per tweet
with a link vs $0.015 without — a 13× difference».

Pricing table: добавил `cachedInput` для gpt-5.4-mini ($0.075) и
gpt-5.4 ($0.25). Prompt caching уже работал в SDK, но мы не
учитывали скидку для writer-tier моделей — теперь costFor() даёт
точные числа.

**Дальше.** Owned reads (если X разрешит для followed accounts через
home timeline). Daily spend digest в Telegram/Slack (cap на $2 → push
если >50% к концу дня). Streaming filtered subscription как
альтернатива polling — сильно дешевле если X включит для PPU.

---

## 2026-05-25 — Supabase Auth: email/password + magic link (slice 16)

**Проблема.** Приложение было single-user: все данные принадлежали одному
«скрытому» пользователю, X-токены лежали в env как глобальные credentials.
Для SaaS-модели (и для демо с несколькими аккаунтами) нужна нормальная auth.

**Ход мыслей.** Supabase Auth уже в проекте как managed сервис — не нужен
отдельный JWT-стек. `@supabase/ssr` даёт cookie-based sessions без клиентского
хранилища. Next.js middleware (`proxy.ts` / `middleware.ts`) перехватывает все
app-роуты и редиректит на `/login` при отсутствии сессии.

**Рассмотренные варианты.**
1. NextAuth.js — хорошо для OAuth провайдеров, но избыточен когда Supabase Auth
   уже поднят. Дублирование session-логики.
2. Custom JWT в edge middleware — полный контроль, но нужно хранить и
   ротировать ключи самостоятельно.
3. Supabase Auth + `@supabase/ssr` — нативная интеграция, cookie-сессии,
   встроенные magic links, reset-flow из коробки.

**Причина выбора.** №3. Supabase уже в деплое; `@supabase/ssr` даёт
`createServerClient` / `createBrowserClient` с единой точкой истины. Middleware
автообновляет сессию на каждом запросе (refresh tokens прозрачны).

**Результат.** `/login`, `/signup`, `/forgot-password`, `/update-password`.
Все API-роуты возвращают 401 без сессии. Magic-link + email/password
параллельно поддерживаются через одну форму.

**Дальше.** Добавить OAuth провайдеры (GitHub, Google) — Supabase Auth
поддерживает из коробки, нужно только включить в Dashboard.

---

## 2026-05-25 — Multi-tenant schema: userId на всех таблицах (slice 17)

**Проблема.** 7 существующих таблиц (`generations`, `posts`, `sources`,
`viral_posts`, `fingerprints`, `traces`, `claims`) не имели `userId`. Первый
второй пользователь увидел бы чужие черновики и трейсы.

**Ход мыслей.** Самый простой вариант изоляции — `userId` FK на каждой таблице
+ фильтр `.where(eq(table.userId, session.userId))` в каждом query. Альтернатива
— Supabase RLS — требует перекладывать всю логику запросов из Drizzle в
Postgres-политики, что ломает типизацию.

**Рассмотренные варианты.**
1. Supabase Row-Level Security — изоляция на уровне БД, нельзя случайно
   забыть. Но тогда Drizzle-клиент должен передавать JWT на каждый запрос, и
   мы теряем service-role queries для cron-jobs.
2. `userId` колонка + фильтр в каждом query через Drizzle — явный, типизированный,
   cron-jobs используют service role и могут делать cross-user queries законно.
3. Отдельные схемы/БД per user — явный overkill при текущем масштабе.

**Причина выбора.** №2. Drizzle-фильтр виден в коде рядом с запросом,
type-safe, не требует отдельного JWT-прохода. Cron-job видит всех
пользователей — это intended behavior (один воркер дренирует scheduled posts
всех юзеров).

**Результат.** Drizzle-миграция добавила `userId text NOT NULL` на все 7 таблиц.
Новые таблицы: `profiles` (trackedAccounts per user), `social_connections`
(X/Telegram токены per user). Все query-функции получили `userId` параметр.

**Дальше.** Рассмотреть RLS как второй слой защиты поверх app-level фильтра —
defence in depth для публичных экзамплеров.

---

## 2026-05-25 — X OAuth 2.0 PKCE: per-user X connection (slice 18)

**Проблема.** Раньше X-credentials лежали в env (`X_ACCESS_TOKEN`,
`X_ACCESS_TOKEN_SECRET`) — один аккаунт, OAuth 1.0a. При multi-tenant модели
нужно, чтобы каждый пользователь постил как сам себя.

**Ход мыслей.** X поддерживает OAuth 2.0 + PKCE для confidential clients.
Access token и refresh token хранятся per-user в `social_connections`. Poster
загружает токены пользователя перед каждым шипом, рефрешит если expired.

**Рассмотренные варианты.**
1. Оставить OAuth 1.0a с shared credentials — не масштабируется, юзер постит
   от имени бота, а не своего аккаунта.
2. OAuth 2.0 PKCE без хранения refresh token — юзер реконнектится каждые
   2 часа. Плохой UX.
3. OAuth 2.0 PKCE + refresh token в БД + auto-refresh в poster — seamless UX,
   стандартная практика.

**Причина выбора.** №3. PKCE обязателен для confidential web clients согласно
X Developer docs (2025+). Refresh token живёт 6 месяцев; poster.ts рефрешит
при 401.

**Результат.** `/api/auth/x/connect` → PKCE challenge → X authorization page →
`/api/auth/x/callback` → upsert в `social_connections`. `/settings/connections`
показывает статус, кнопка disconnect. Cron-post и manual post используют токены
из `social_connections` конкретного пользователя.

**Дальше.** Webhook от X при revoke токена — сейчас ловим только при следующем
шипе. Можно добавить уведомление в Telegram при disconnect.

---

## 2026-05-25 — UX consolidation: 9 nav items → 3 (slice 21)

**Проблема.** Navigation содержала 9 пунктов: Queue, Compose, Discover, Voice,
Automation, Schedule, History, Traces + Settings. Пользователю нужно было
переключаться между несколькими страницами для одного рабочего цикла
(compose → discover → queue). «Schedule» и «History» были заглушками.

**Ход мыслей.** Реальный workflow пользователя — это три режима: (1) работа с
очередью (включая composing и discovering), (2) просмотр агентных событий,
(3) конфигурация. Всё остальное — subview одного из трёх.

**Рассмотренные варианты.**
1. Оставить 9 items, убрать заглушки — чище, но всё ещё много переключений.
2. Свернуть в 5: Queue, Compose, Discover, Traces, Settings.
3. Свернуть в 3: Queue (все рабочие инструменты) / Traces / Settings.

**Причина выбора.** №3. Queue — это рабочий hub; compose и discover — это
панели внутри него (collapsible), не отдельные страницы. Automation status
тоже живёт внутри Queue (была отдельная страница `/automation`). Traces и
Settings — принципиально другие режимы.

**Результат.** Queue: collapsible Compose + collapsible Discover + collapsible
Automation + post list с фильтрами. Settings: hub → `/settings/connections` +
`/settings/voice`. Удалены страницы: `/compose`, `/discover`, `/voice`,
`/automation`, `/schedule`, `/history`. Nav: 3 items.

**Дальше.** Keyboard shortcuts для переключения collapsible секций — сейчас
нет hotkeys.

---

## 2026-05-25 — Editable influencer channels per user (slice 22)

**Проблема.** `INFLUENCERS` в `src/config/influencers.ts` был hardcoded списком
10 tech-голосов. Разные пользователи хотят следить за разными аккаунтами.
Изменение конфига требовало редактирования кода.

**Ход мыслей.** `profiles.trackedAccounts` — nullable JSON-массив. Если null —
fallback на default INFLUENCERS. Если заполнен — использовать его. UI в
`/settings/connections` (или inline в Queue Discover-панели) позволяет добавить
/ удалить аккаунты.

**Причина выбора.** Nullable override — минимальный schema change без потери
default behavior для новых пользователей.

**Результат.** `profiles.trackedAccounts text[]`. Discover-панель в Queue
показывает текущий список с кнопками удаления и инпутом добавления.
`/api/settings/tracked-accounts` GET/POST. `runDiscoverFetch()` принимает
`trackedAccounts` параметр.

---

## 2026-05-25 — Security hardening после code review (slice 24)

**Проблема.** Code review выявил несколько уязвимостей: (1) `/api/queue/reset`
сбрасывал посты всех пользователей, а не только текущего; (2) redirect после
логина не валидировал URL — открытый редирект; (3) несколько API-роутов не
проверяли сессию; (4) X OAuth callback не обрабатывал error-параметр от X.

**Ход мыслей.** Для каждой проблемы — минимальный targeted фикс, не
перекройка:
1. Добавить `userId` фильтр в queue reset query.
2. Валидировать redirect URL через `new URL()` + whitelist схем (`/` prefix
   only) — отклонять абсолютные URLs в redirect param.
3. Добавить `getSession()` check в каждый незащищённый роут.
4. Читать `?error` и `?error_description` в callback, логировать + возвращать
   понятный UI error.

**Результат.** Все 4 фикса применены. Expired token в `social_connections`
теперь ловится в poster.ts — юзер получает actionable error «reconnect your X
account» вместо 500. `checkSpendCap()` возвращает 429 с JSON телом для
корректной обработки на клиенте.

---

## 2026-05-31 — Searcher: capнуть built-in web search вместо смены провайдера

**Проблема.** OpenAI-кредиты выгорали быстро. Один searcher-вызов (`web_search`
через Responses API) уходил в агентный цикл на 8+ поисков за прогон и стоил
~$0.50. Хуже — per-call fee вообще не учитывался в `costUsd`, и spend cap
недосчитывал расход на поиск ~30×.

**Ход мыслей.** Возник соблазн сменить провайдера на Groq (дешевле токены). Но
Groq не умеет ни embeddings, ни built-in web search — отвалятся и memory-слой, и
searcher. Главный расход тут не токены (на gpt-5-mini это ~1.5¢), а сам цикл из
8 платных поисков. Значит лечить надо цикл, а не провайдера.

**Рассмотренные варианты.**
1. Перейти на Groq (OpenAI-совместимый chat) — ломает embeddings + searcher.
2. Заменить `web_search` на внешний search API (Brave/Tavily) — требует ключ +
   привязку карты, лишний провайдер.
3. Оставить OpenAI `web_search`, но ограничить: `search_context_size=low`,
   `reasoning=low`, `max_tool_calls` ceiling, и записать fee в `costUsd`.

**Причина выбора.** №3. `low reasoning` останавливает цепочку из 8 поисков (это
он её разгонял), `low` context режет дозагрузку страниц в input. Fee в costUsd
делает spend cap честным.

**Результат.** Probe подтвердил: ~$0.50 → ~$0.015 за поиск, 1 поиск вместо 8+,
10k токенов вместо 34k. `costFor()` теперь варнит на неизвестную модель —
переименованная модель больше не зануляет cap молча.

**Дальше.** Variant deferral в compose (edit+fact-check только на победителе при
`variants>1`) — добито в этом же заходе.

---

## 2026-05-31 — Discovery как два движка: RAG-feed + virality summary

**Проблема.** Discover показывал только X-твиты, фиксированные 10 инфлюенсеров,
без фильтров — статично и «слишком просто». При этом HN/arXiv/Substack уже
ингестились в `sources`, но в UI никогда не показывались (фронт читал только
`viral_posts`). Плюс баг: feed фильтровал `userId = current`, а cron-items идут с
`userId IS NULL` — глобальный контент был скрыт.

**Ход мыслей.** Discovery — это два движка: (1) RAG-контекст для генерации, (2)
дайджест «что происходит в bubble». Большая часть инфраструктуры была — задача
соединить полузастроенное, а не строить заново.

**Рассмотренные варианты.** Дедик-страница vs upgrade панели на месте; один
unified loader vs отдельные запросы per source.

**Причина выбора.** Unified `loadDiscoveryFeed()` (merge `viral_posts` + `sources`
всех типов, включая `userId IS NULL`), upgrade панели на месте. Команда из
агентов (foundation → B/C/E параллельно → frontend → QA) по непересекающимся
файлам, т.к. всё сходилось на `discover-panel.tsx`.

**Результат.** Multi-source feed (7 kinds + badges), kind-фильтры, recency/
engagement sort, keyword search. `take`/`qrt` переведены на **SSE** с живым
индикатором пайплайна. Upload PDF/image → парс через OpenAI vision/`input_file`
→ source. Feed↔Summary toggle: «what's happening in the bubble» — один дешёвый
LLM-дайджест ленты. QA-гейт нашёл реальный data-corruption баг (cross-user
collision в upload `externalId`) — пофикшен до коммита.

**Дальше.** Embedding-on-ingest + retriever для настоящего RAG: колонки
`embedding` + HNSW уже есть на `sources`/`viral_posts`, но никогда не пишутся.

---

## 2026-05-31 — UI: вытащить core-принципы в compose (а не прятать данные)

**Проблема.** Пайплайн считал eval-скоры, invented-claims и sources — но UI почти
ничего из этого не показывал. Юзер видел финальный текст, не видя на чём он
основан и где риск выдумки.

**Причина выбора.** Минимальные additive-изменения в compose-form: (1) живой
per-step индикатор `search→writer→editor→eval→fact-check`; (2) `FabricationWarning`
— красный баннер при `inventedCount>0`; (3) eval с акцентом на insight+voice
(дифференциаторы), hygiene-оси приглушены; (4) «grounded on N sources» disclosure
(в result-payload добавлен `sources`).

**Результат.** Display-only, без смены поведения пайплайна. `tsc`/eslint/110
тестов зелёные.

**Дальше.** Gate на `inventedCount` (статус needs_review), weighted winner-rubric
— это уже меняет поведение, ушло в Phase 2.

---

## 2026-05-31 — Аудит agentic-flow: 5 ревью-агентов + verifier перед реформой

**Проблема.** Подозрение, что в архитектуре agentic-flow есть неэффективности.
Реформировать хотелось, но не вслепую — и не доверять выводам ревью-агентов
на веру.

**Ход мыслей.** Сначала аудит, потом реформа. Параллельные ревьюеры по разным
измерениям, затем независимый verifier сверяет каждую находку с реальным кодом —
fan-out всегда даёт правдоподобные-но-ложные пункты.

**Рассмотренные варианты.** Один большой ревью vs N специализированных; доверять
находкам vs adversarial-проверка.

**Причина выбора.** 5 ревью-агентов (orchestration/duplication · prompt-tier ·
memory-RAG · cost-reliability · agent-design) → синтез → verifier подтверждает
каждый пункт по `file:line` → Phase 1 (безопасные фиксы, не меняют output) против
Phase 2 (меняет поведение/крупное).

**Результат.** Verifier подтвердил все находки, но сузил «безопасное»: реальный
баг — нет `dbSucceeded` guard в take/qrt/cron (succeeded→failed inversion при
ошибке после успешного апдейта); model-string дропает fact-checker в 3 роутах;
нет `maxDuration` на cron (orphaned `running`); evaluator зануляется на parse-fail
(но fails-safe в ранкинге). Из Phase 1 применены сразу: `costFor`-warn + `maxDuration`
на cron-роутах. Остальное (shared `runPipeline`, ~900 строк дублирования; merge
editor+evaluator в critic; weighted rubric; gate на inventedCount) — Phase 2.

**Дальше.** Phase 2 реформа отдельным PR после явного подтверждения — меняет
продуктовое поведение.

---

## 2026-05-31 — Viral Wave Shot: вторая автоматизация + full-autonomous toggle

**Проблема.** Нужен отдельный флоу «recommended viral topic» с preview — «выстрел
по виральной волне». Существующая autonomy (`cron/generate`) берёт ОДИН
топ-engagement пост; хотелось рекомендовать ТОПИКИ из всей волны и показать
превью-черновики.

**Ход мыслей.** Строится поверх virality summary: тот же «читаем bubble», но на
выходе — конкретные топики + writer-only превью, а не проза.

**Рассмотренные варианты (preview depth).** writer-only превью (дёшево/быстро) vs
полный пайплайн на каждый топик (×N дороже). И триггер: on-demand / cron / оба.

**Причина выбора.** writer-only превью; полный пайплайн только при «queue this».
Триггер — оба. Полная автономия (auto-generate **и** auto-post) за toggle, default
OFF: это публикация в X без ревью, опт-ин обязателен.

**Результат.** `agents/viral-topics.ts` (рекомендует N топиков {topic,hook,
rationale}), `lib/wave.runWaveShot()` (recommend → writer-only превью);
`/api/wave/{shot,queue}`, `/api/cron/wave` (gated на `profiles.waveAutonomous` →
посты `approved` → post-cron шипит). Toggle в Automation-панели с красным
варнингом. ~$0.006 за shot (2 топика), проверено probe'ом. `maxTokens=3000` —
снова reasoning-бюджет (см. запись 2026-05-22 про JSON-агентов).

**Дальше.** Telegram-пуш для autonomous-wave (сейчас черновики просто падают в
queue). Embedding-RAG в рекомендатор топиков.

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
13 topic-guard agent (fail-closed safety gate)
14 billing tracker + cadence pills + X cost opts (cached IDs, max_results=5) + PD UX polish
15 since_id (pay only for new) + spend cap + URL warning + cached pricing
16 Supabase Auth (email/password + magic link) + middleware
17 multi-tenant schema — userId на всех таблицах + profiles + social_connections
18 X OAuth 2.0 PKCE — per-user X connection + token refresh
19 Telegram connection per user (Login Widget + verify)
20 Settings hub (/settings/connections + /settings/voice)
21 UX consolidation — 9 nav items → 3 (Queue / Traces / Settings)
22 editable influencer channels per user (profiles.trackedAccounts)
23 forgot-password / update-password flow
24 security hardening (user-scoped resets, open redirect, auth checks, X callback errors)
25 cost opt — capped web search (~$0.50→$0.015) + variant deferral (edit/fact on winner)
26 discovery rebuild — multi-source feed, SSE take/qrt, PDF/image upload parse, Feed↔Summary digest
27 content-gen UI — live pipeline steps, fabrication warning, insight-first eval, source grounding
28 agentic-flow audit — 5 review agents + verifier; Phase-1 safe fixes (costFor warn, cron maxDuration)
29 viral wave shot — recommended topics + writer-only previews + full-autonomous toggle (default off)
```

Полный лог — `git log --oneline`. Cost-per-pipeline и live evidence — в
`traces/agent-traces.md` (auto-export через `scripts/export-traces.mjs`).
