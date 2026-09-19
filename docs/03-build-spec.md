# Boom-Busters — Build Specification for Claude Code

*This document is the complete engineering instruction set for building Boom-Busters, a single-user production console that turns a researched financial-disaster case into a published long-form YouTube video plus derived Shorts. It is written to be executed by Claude Code end to end. Follow it in milestone order (§14). Where this spec and convenience conflict, this spec wins. Where something is genuinely undefined, prefer the simplest implementation consistent with the design principles in §1.*

---

## 1. Design principles (apply to every decision)

1. **Automate the assembly, gate the judgement.** Five human gates: dossier, script, voice, visuals, publish. Everything between gates runs unattended and durable. The user's entire job is emptying the "Needs you" queue.
2. **Vercel runs the app, AWS runs the media.** The web layer never streams, transforms or holds a video/audio byte. All media flows R2/S3 ↔ Lambda via presigned URLs.
3. **Nothing expensive runs before its gate.** Audio only after script approval. Render only after visual approval, exactly once. Retakes are paragraph-level. Preview is always `@remotion/player` in the browser, never a render.
4. **Everything is configurable, nothing is hard-coded.** Models, TTS provider, voices, budgets, brand tokens, concurrency caps all live in Settings, in the database, not in env vars (env vars hold secrets and infrastructure endpoints only).
5. **Deterministic and idempotent.** Every pipeline step can be re-run without side effects or double spend. The timeline JSON fully determines a render.
6. **Honest failure.** Errors are typed, retried when transient, surfaced with a fix affordance when not. No silent degradation: anything auto-substituted (placeholder image, skipped slot) is visibly flagged.
7. **Traceability is the compliance story.** Dossier claims carry sources; script sentences reference claims; chart slots reference claims by ID; human edits are recorded. This chain must never be broken by convenience.
8. **UI: calm, dense, button-first.** A production console, not a marketing site. Speed of review is the product, achieved through clear, always-visible buttons, one obvious primary action per screen, and minimal clicks between gates — not through keyboard shortcuts.

Out of scope (do not build): thumbnail generation (thumbnails are made in Canva; the app only accepts uploads), multi-user/teams/roles, TikTok/Instagram export, comment management, any social features, mobile native apps (the web UI must be responsive instead).

---

## 2. Tech stack (pinned)

| Concern | Choice | Notes |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript `strict` | Deployed on Vercel |
| Styling/components | Tailwind CSS + shadcn/ui + Radix primitives | No other component library |
| Data fetching/state | TanStack Query + server actions | No Redux |
| Validation | Zod everywhere (API edges, env, timeline schema, provider responses) | Shared package |
| ORM/DB | Drizzle + Postgres (Neon or Supabase) | Migrations checked in |
| Object storage | Cloudflare R2 (S3 SDK) for inputs; AWS S3 for render outputs | Presigned URLs only |
| Orchestration | Inngest | All multi-step work; no bare cron, no BullMQ, no Redis |
| Rendering | Remotion + `@remotion/lambda`, `@remotion/player` for preview | Existing Reelscript AWS account; separate function + site |
| Broker/media utils | AWS Lambda (Node 20) behind API Gateway (or Lambda function URLs) + FFmpeg layer | Deployed with CDK, in `infra/` |
| LLM | Provider-abstracted: Anthropic (default), OpenAI, Google Gemini behind one `LLMProvider` interface, task-routed per §6 | Batch APIs where latency is irrelevant; keys managed in Settings → Connections |
| TTS | Gemini Flash TTS (batch) default; ElevenLabs behind the same interface | §6 |
| Alignment | **Remotion's Whisper tooling, in-house**: `@remotion/install-whisper-cpp` running Whisper.cpp (base.en, token-level timestamps) inside the media-utils Lambda, output converted via `toCaptions()` to the `@remotion/captions` `Caption` format, then **snapped to the script** (ground truth). If the TTS provider is ElevenLabs, use its `with-timestamps` endpoint instead and skip transcription entirely. Hosted API (AssemblyAI/Replicate) only as a config fallback | Model file loaded from S3 into `/tmp` at cold start, cached across warm invocations |
| Auth | Auth.js, Google provider, hard allowlist of exactly one email | Middleware-protected everything |
| Testing | Vitest (unit), Playwright (E2E), Inngest test harness | §13 |
| Repo | pnpm + Turborepo monorepo | Layout in §3 |

---

## 3. Repository layout

```
boom-busters/
├── apps/web/                  # Next.js app (UI + API routes + Inngest handlers)
│   ├── app/                   # routes per §11 IA
│   ├── components/            # shadcn/ui-derived + app components
│   ├── inngest/               # all Inngest function definitions
│   └── lib/                   # server-side services (thin; logic lives in packages)
├── packages/
│   ├── schemas/               # Zod: timeline schema, provider IO, API DTOs, events
│   ├── db/                    # Drizzle schema, migrations, seed script, query helpers
│   ├── providers/             # LLM, TTS, stock, image, alignment adapters + router
│   ├── timeline/              # timeline compiler, ducking curve, snap-to-script (pure, golden-tested)
│   ├── compositions/          # Remotion project (master, shorts, component library, bundled fonts)
│   ├── cost/                  # cost ledger, budget guard, price tables
│   └── ui-tokens/             # Brand-Kit-independent app design tokens (§10)
├── infra/                     # CDK: broker Lambda, media-utils Lambda, S3, IAM, alarms
└── e2e/                       # Playwright suites + fixtures + provider mocks
```

Rules: `compositions` imports only from `schemas` (a render must never touch the DB). `providers` never imports from `db` (adapters are pure; the caller records costs). Every package has its own tests.

**Naming conventions (use everywhere):** kebab-case `boom-busters` for the repo, npm package scope (`@boom-busters/*`), Vercel project, CDK stacks (`boom-busters-broker`, `boom-busters-media-utils`), Remotion Lambda function (`boom-busters-render`) and site (`boom-busters-compositions`), S3/R2 prefixes (`boom-busters/…`), AWS cost-allocation tag (`project=boom-busters`), Inngest app ID and event prefix (`boom-busters/…` where the runtime allows), and environment names. "Boom & Busters" (with ampersand) appears only in public-facing channel copy, never in identifiers.

---

## 4. Configuration & environment

**Env holds infrastructure and bootstrap secrets only** (validated by a Zod `env.ts` at boot; the app must refuse to start listing missing keys):
`DATABASE_URL, R2_*, AWS_BROKER_URL, AWS_BROKER_TOKEN, SECRETS_ENCRYPTION_KEY, YOUTUBE_CLIENT_ID/SECRET, INNGEST_*, AUTH_*, OWNER_EMAIL`.

**Provider API keys live in the database, managed in Settings → Connections** (Anthropic, OpenAI, Gemini, ElevenLabs, Pexels, Pixabay, fal.ai, hosted-alignment): stored in a `provider_credentials` table, AES-GCM-encrypted with `SECRETS_ENCRYPTION_KEY`, never returned to the client after save (masked display: `sk-…4f2a`), decrypted server-side only at call time. Matching env vars (`ANTHROPIC_API_KEY` etc.) are optional **seeds/fallbacks**: used when no DB row exists, and imported into the DB on first boot so local dev works without touching the UI. This means adding or rotating a key never requires a redeploy.

Behavioural configuration in the `settings` table (single row), editable in the UI:

```ts
{
  modelRouting: {                                  // provider-qualified per task; any task can point
    research:  { provider: 'anthropic', model: 'opus'   },   // at anthropic | openai | google
    scripting: { provider: 'anthropic', model: 'sonnet' },
    editing:   { provider: 'anthropic', model: 'haiku'  },
    shotlist:  { provider: 'anthropic', model: 'haiku'  },
    metadata:  { provider: 'anthropic', model: 'haiku'  },
    digest:    { provider: 'anthropic', model: 'haiku'  },
    // Added 2026-09-03, decision 208: the still-image generator is routed
    // here too — provider 'google' | 'fal', model from that adapter's list.
    stills:    { provider: 'google', model: 'gemini-2.5-flash-image' },
  },                                               // validated against each adapter's known-model list
  tts: { provider: 'gemini' | 'elevenlabs', voiceId, stylePrompt,
         pacing, locked: boolean },               // §6; changing when locked requires typed confirmation
  budgets: { perProviderMonthlyUSD: Record<Provider, number>,
             killSwitch: boolean },
  render: { concurrency: 2, timeoutMinutes: 30, chapterChunking: true },
  publish: { defaultScheduleSlots: [...], apiAuditPassed: boolean },
  brandKit: { ... §10 }
}
```

---

## 5. Data model (Drizzle/Postgres)

All tables: `id` (ulid), `createdAt`, `updatedAt`. Key tables and their essential columns:

- **cases**: title, category (`collapse|con|meltdown|turnaround|empire` — the last two support the phased scope broadening; no code treats categories specially), angle, demandNotes, competitorLinks jsonb, priorityScore, status (`idea|shortlisted|in_production|published|retired`).
- **projects**: caseId, title, stage (`dossier|script|voice|visuals|assembly|shorts|publish|done`), stageStatus (`queued|running|awaiting_review|approved|failed|cancelled`), targetRuntimeMin, inngestRunId, cancelledAt.
- **dossiers**: projectId, contentMd, approvedAt. **claims**: dossierId, text, sourceUrl, sourceType (`court|regulator|major_outlet|book|other`), confidence (`sourced|single_source|unverified`), quarantined boolean (excluded from scripting if true).
- **scripts**: projectId, version, status. **chapters**: scriptId, index, title, contentMd, estRuntimeSec. **script_edits**: chapterId, beforeText, afterText, editType (`human|regenerate`), note (the human-curation evidence trail). **claim_refs**: chapterId, claimId, sentenceHash.
- **voice_takes**: projectId, chapterId, paragraphIndex, provider, voiceId, r2Key, durationMs, status (`pending|generated|flagged|approved`), takeNumber, costUsd.
- **shot_slots**: projectId, chapterId, index, type (`stock|archival|still|chart|map|hero`), brief jsonb (the full creative brief, typed per §7 of the product spec), candidates jsonb[], chosenAssetId, status (`unresolved|resolved|placeholder`), startMs, durationMs. **`hero` (AI video) is feature-flagged off at launch** — the schema, brief type and UI badge exist, but no video-generation adapter is built until the flag is turned on post-monetisation; the shot-list prompt is instructed not to emit hero slots while the flag is off.
- **assets**: kind (`image|video|music|logo`), r2Key, sourceUrl, licence, contentHash (dedupe key), width/height/durationMs, attributionText, moodTags text[] (music only — powers the music picker).
- **timelines**: projectId, version, json jsonb (validated against `TimelineSchema`), s3Key, compiledAt.
- **renders**: projectId, timelineVersion, kind (`master|short`), shortId?, brokerRenderId, remotionRenderId, status (`queued|invoking|rendering|qc|done|failed|cancelled`), progressPct, outputS3Key, qcReport jsonb, costUsd, startedAt, completedAt, error jsonb.
- **shorts**: projectId, title, description, segmentRef (chapterId + paragraph range), ending (`loop|cta`), renderId, relatedLinkChecked boolean.
- **publish_records**: targetType (`master|short`), targetId (projectId or shortId), youtubeVideoId, privacyStatus, publishAt, uploadedThumbKeys text[] (Canva PNGs; the first is set via API, the rest stored for manual Test & Compare), metadata jsonb, status (`draft|scheduled|uploading|uploaded|live|failed`), **unique(targetType, targetId)** — the idempotency guard against double upload for masters *and* each Short.
- **provider_credentials**: provider, encryptedKey (AES-GCM, `SECRETS_ENCRYPTION_KEY`), keyHint (last 4 chars for masked display), lastVerifiedAt, verifyStatus (`ok|invalid|unchecked`).
- **cost_ledger**: provider, operation, projectId?, estimatedUsd, actualUsd, meta jsonb, occurredAt. Monthly per-provider aggregates feed the budget guard.
- **runs / run_events**: mirror of Inngest run state for the UI activity feed (populated by Inngest middleware).
- **analytics_snapshots**: videoId, date, retentionCurve jsonb, ctrBySource jsonb, avgViewDurationSec, views, rpm, shortsFeedStats jsonb.

---

## 6. Provider layer (`packages/providers`)

Every provider sits behind an interface; adapters are pure async functions; the caller wraps calls in `withCost()` (below) and Inngest steps.

```ts
interface LLMTask { task: 'research'|'scripting'|'editing'|'shotlist'|'metadata'|'digest';
                    system: string; messages: Msg[]; maxTokens: number; useBatch?: boolean }
interface TTSRequest { text: string; voiceId: string; stylePrompt?: string;
                       phonemeHints: {term: string; hint: string}[]; idempotencyKey: string }
interface TTSResult { audioBuffer: Buffer; durationMs: number; estimatedCostUsd: number }
interface StockQuery { query: string; brief: string; rejectionCriteria: string[]; count: number }
interface AlignmentRequest { audioUrl: string; scriptText: string }
// returns Caption[] (@remotion/captions format). Implementations:
// 1. 'whisper-lambda' (default): media-utils runs Whisper.cpp via
//    @remotion/install-whisper-cpp helpers → toCaptions() → snap step
// 2. 'elevenlabs-timestamps': character timings returned by the TTS call
//    itself — zero extra work when ElevenLabs is the voice provider
// 3. 'hosted' (fallback): AssemblyAI/Replicate
// The snap step (pure function, unit-tested): Whisper transcribes; the
// script is ground truth. Align transcribed words to script words
// (case/punctuation-insensitive Needleman-Wunsch); take TIMINGS from
// Whisper and TEXT from the script, so captions can never contain a
// mistranscription. Unmatched stretches >1.5s → flagged in QC report.
```

**LLM router:** resolves `task → {provider, model}` from settings at call time. Three `LLMProvider` adapters behind one interface — **Anthropic, OpenAI, Google Gemini** — each normalising its API's message format, batch mode and prompt-caching mechanics behind the shared `LLMTask` shape, exposing a known-model list (used to validate settings) and a per-model price table (used by `withCost`). Fallback on `overloaded/5xx` after retries: first one model tier down within the same provider, then the configured cross-provider fallback if set (e.g. anthropic → google); every downgrade is recorded in `run_events` so the UI shows "written with fallback model". A task whose configured provider has no working key fails at pre-flight with a `ValidationError` pointing at Settings → Connections, never mid-pipeline.

**TTS:** text is chunked per paragraph. `idempotencyKey = hash(projectId, chapterId, paragraphIndex, textHash, voiceId)`; before synthesis, check for an existing `voice_takes` row with the same key — re-runs are free. Gemini adapter uses the batch API; ElevenLabs adapter sets `stability≈0.38`, uses the pronunciation-dictionary endpoint for phoneme hints.

**Stock scoring:** after fetching candidates from Pexels/Pixabay, a single Haiku call scores all candidates for a slot against the brief and rejection criteria (batched: one call per slot, not per candidate); store scores with candidates.

**Cost guard (`packages/cost`):**

```ts
withCost(provider, operation, projectId, estimate, fn)
```
Pre-flight: if `killSwitch` or `monthSpend(provider) + estimate > budget(provider)` → throw `BudgetExceededError`. Post: record actual (or estimate if the provider returns none). `BudgetExceededError` is not a failure: the Inngest run parks on a **budget gate** (`waitForEvent('budget/approved')`), and the UI shows an "Over budget — approve overage / abort" card in the Needs-you queue. Nothing silently dies because a cap was hit.

---

## 7. Pipeline orchestration (Inngest)

One durable function per stage, chained by events. Naming: events `project/<stage>.<verb>`, functions `<stage>-runner`.

**Global behaviours (apply to every function):**
- `cancelOn: [{ event: 'project/cancelled', if: 'async.data.projectId == event.data.projectId' }]`. The UI Stop button emits `project/cancelled`; on cancellation, a `finally` handler sets `projects.stageStatus='cancelled'` and releases any reserved resources.
- Every external call is its own `step.run()` (memoisation boundary = spend boundary). Step IDs are deterministic: `tts-${chapterId}-${paragraphIndex}`.
- Retries: default 4 attempts, exponential backoff + jitter for `TransientProviderError`/`RateLimitError` (honour `retry-after`). `ValidationError`, `ContentPolicyError`, `BudgetExceededError` → `NonRetriableError` routed to gates/flags. Exhausted retries → function `onFailure` writes a `runs` failure row, sets `stageStatus='failed'`, notifies (§12).
- Fan-out partial-failure policy: collect per-item results; if failures ≤ 15% of items → succeed, mark failed items (`placeholder` slots, flagged takes) for human resolution at the next gate; if > 15% → fail the step.
- **Step-duration rule (Inngest runs inside Vercel functions):** no single `step.run()` may block on long provider work. Long-running provider operations (Anthropic Batch API, Gemini batch TTS, media-utils jobs) always use **submit → `step.sleep()` → poll** loops or completion webhooks, so every step finishes in seconds. Set `maxDuration: 300` on the Inngest route handler and require Vercel Pro if Hobby's limit is ever hit in practice.
- **Paragraph splitting is deterministic:** chapters split into paragraphs on blank lines of the approved `contentMd`, before any TTS call; paragraph indexes are stable thereafter and are the unit for takes, retakes, alignment merge and Shorts segment refs. *(Amended 2026-09-01, decision 202: a block with no spoken words — blank, or nothing but bracketed narration tags such as a lone `[long pause]` — is not a paragraph. A paragraph is one TTS request, and a request with no words fails synthesis; inter-paragraph silence is created at assembly. `splitParagraphs` and `replaceParagraph` skip such blocks identically, so indexes stay in step.)*
- *(Amended 2026-09-10, decisions 233 and 235.)* **One live run per key:** every function carries an Inngest `singleton` (`mode: 'skip'`), keyed on `projectId` for stage runners and on the worked row (take, slot, Short, publish target) for the side-job functions, so a duplicate trigger event is skipped rather than stacked; `inngest/functions/index.test.ts` pins the map. **Outside cancellations reconcile:** a `cancellation-mirror` function triggers on `inngest/function.cancelled` and closes the mirror row a dashboard or API cancellation would otherwise leave live forever; a cancelled STAGE runner with nothing else moving also marks the stage failed, in words.

**Stage functions:**

1. **dossier-runner** (`project/created`): Opus research passes (case brief → timeline of events → claims extraction with sources → *answers pass, amended 2026-09-01, decision 201: the brief's open questions answered from the record, with honest nulls for what the record does not say; facts surfaced while answering join the claim list. Amended again 2026-09-01, decision 203: questions are numbered in the request and each answer carries the question's number — the renderer places answers by that index, falls back to folded-text matching, and never discards a non-null answer it cannot place*) → write dossier + claims → `stageStatus='awaiting_review'` → `waitForEvent('gate/dossier.approved', timeout: '30d')`. Gate UI actions can also emit `gate/dossier.changes_requested` with a note → one revision step → back to waiting.
2. **script-runner** (`gate/dossier.approved`): outline (Sonnet) → chapters drafted sequentially, 2-3k words per step, each step receives the approved outline + previous chapter tail + cached style bible + **only non-quarantined claims** → self-check pass (Haiku) writes claim_refs and gutter warnings ("no source for sentence…", "'alleged' missing for non-adjudicated claim") → Shorts-candidate marking (Haiku, 5 segments with hook rationale) → gate.
3. **voice-runner** (`gate/script.approved`): fan-out TTS per paragraph → loudness-normalise each chunk in media-utils (-16 LUFS mono reference) → gate. Retake loop: UI flag emits `voice/retake.requested {takeId, note}` handled by a small dedicated function; the main run's gate wait is only satisfied when the UI approve action verifies zero flagged takes server-side.
4. **visuals-runner** (`gate/voice.approved`): shot list generation (Haiku; enforce `dataRef` claim IDs on every chart slot — a chart brief without claim refs is a `ValidationError`) → fan-out asset resolution per slot (stock fetch+score / image gen / chart+map preview data) → gate 4. *(Amended 2026-09-03, decision 214: archival slots are upload-only real footage — nothing is fetched for them; they resolve straight to placeholder and the board offers "Upload footage" (image or video ≤200 MB, browser → R2). The Wikimedia archival fetch is retired; the adapter remains only for candidates fetched before the change.)* *(Amended 2026-09-17, decision 214 (b): a slot also takes an IMAGE by web address (`addSlotImageFromUrlAction`), fetched server-side through `apps/web/lib/remote-image.ts` and stored under the same uploads key; video stays on the presigned browser path, and the fetched image is still checked against the slot's own upload rules.)* *(Amended 2026-09-14, decision 252: a `directors-book` step drafts the per-film Director's Book (LLM task `direction`, Sonnet by default) once and stores it on `projects.direction`; every chapter's shot-list call carries the House Visual Bible (`packages/providers/src/prompts/direction-craft.md`) in its system prompt and the rendered book in its cacheable prefix, and every brief carries an optional `shotSize`. A `visuals-replanner` redrafts the book or re-plans the slots at the plan checkpoint. Image-model policy refusals become `placeholder` slots with a stored `refusal` and two repairs on the card: Redirect the scene (`slot-redirector`) or Upload a real image. Stills that depict real people by likeness list them in `depicts`; when a chosen still does, the upload job sets `containsSyntheticMedia` on the YouTube video.)* *(Amended 2026-09-15, decision 253: a per-project cast (`cast_members`, Cast card on the project page from the script stage onward) holds up to four reference photographs per real person in R2 plus an identity string written from them by a vision call on the `direction` task. The Director's Book is drafted from the cast (one likeness principal per member; a forgotten member is a plan warning). A still whose `depicts` names cast members with photos is generated from them: Gemini receives the photos as inline parts before the prompt, fal routes to FLUX Kontext (`fal-ai/flux-pro/kontext`, multi-reference variant for two or more) with presigned URLs, and the prompt says "the person in the reference photo". The guardrail is no longer pasted into image prompts. Candidates record `references` and the board's audit line shows them.)* *(Amended 2026-09-16, decision 253 (j): every draft of the Director's Book seeds the cast from its named principals (role, identity string, guardrail), so the producer only uploads photos; "Remove person" dismisses the row (`cast_members.dismissed_at`, migration 0023) so a redraft cannot add the person back, and re-adding by hand revives it.)* *(Amended 2026-09-16, decision 253 (k): a cast photo may also be added by its web address; the server fetches it once (`apps/web/lib/remote-image.ts`: format from the magic bytes, size from the image header, redirects re-checked per hop, private and link-local addresses refused, 15 MB cap, shorter edge at least 320 px) and stores the bytes in R2 like an upload, keeping the address as `sourceUrl` provenance.)* *(Amended 2026-09-16, decision 253 (l): reference routing on fal stays inside the chosen family — FLUX.2 conditions on `fal-ai/flux-2/edit` (`image_urls`, `image_size`), every other model on FLUX.1 Kontext (`image_url`/`image_urls`, `aspect_ratio`); `ImageGenProvider.referenceRoute` declares the endpoint that will be billed before the call, so the budget reservation, `cost_ledger.meta.model` and the asset licence all name what actually ran. A fal id counts as verified only against its OpenAPI schema; a 405 from the run endpoint proves the key, not the path.)* *(Amended 2026-09-16, decision 253 (m): `MAX_STILL_REFERENCES` counts reference PHOTOGRAPHS, not people — every depicted cast member gets one, then the remaining slots go round-robin to further angles of them, front view first, so a still of one person carries up to three views instead of one.)* *(Amended 2026-09-16, decision 253 (n): `modelRouting.stillsLikeness` is an optional second stills route, taken only when a still depicts a cast member the cast holds a photograph of; null means one route generates everything. The plan screen's per-slot estimate quotes the dearer of the two.)* *(Amended 2026-09-16, decision 253 (o): the plan checkpoint's fetch estimate is priced brief by brief (`stillsEstimateUsd`) — each still on the route it will take, on fal at its reference endpoint's price and Kontext tier — not slot count times a flat rate; the quoted figure equals what the ledger reserves for the same brief. `stillSlotEstimateUsd` remains only for the teaser studio, which prices a beat before its brief exists.)* *(Amended 2026-09-17, decision 253 (p): `buildShotListRequest` takes `photographed` (cast names with a reference photograph) and the still rule splits people three ways: a photographed person gets name, role and "the person in the reference photo" with NO physical description; a named person without a photograph still gets their identity string; an unnamed extra gets role, age range, build and clothing and no name. The House Visual Bible no longer tells the planner to append an identity string for everyone shown.)* *(Amended 2026-09-17, decision 257: a seventh slot type, `headline`, shows a real news headline. The shot-list model may write no part of the card: its brief carries `sourceRef`, a claim NUMBER, which `resolvePlannedBrief` maps to a claim id and refuses unless that claim is `major_outlet` with a surviving `sourceUrl` (the claim list marks eligible claims NEWS ARTICLE; the cap of one card per chapter is enforced in `plannedToRows`, not only asked for in the prompt). Resolution reads the article itself — `packages/providers/src/article`: JSON-LD, then Open Graph, then meta tags, then the `<title>`, with `dateModified` NEVER promoted to the publication date, each field's provenance recorded, every redirect hop vetted by `assertSafeArticleUrl`, the body abandoned at `</head>` or 512 KB, and one Wayback attempt when the page will not answer. Records live in `article_sources` keyed by normalised URL (migration 0024), shared across claims, shots and films; a record the owner corrects is `manual` and no fetch overwrites it. A page that will not give its metadata up leaves the slot a placeholder whose card asks for the four fields, which for a paywalled piece is the normal path rather than a repair.)* *(Amended 2026-09-18: the format picker never re-types to `headline` by pressing the button. `convertBrief` takes the chosen claim as an argument and returns null without one, so the conversion cannot happen by accident; the board opens a chooser of the project's article-carrying claims and `retypeToHeadlineAction` writes the brief inside the click, with no model call and no `drafting` state, because no model may choose which article is quoted. `retypeSlotAction` refuses a bare `headline` target and the slot-retyper refuses one in words rather than throwing, so a stale tab cannot leave a slot drafting a draft that is never coming. The chooser also re-points a card that is already a headline, which nothing could do before: its own format button stays enabled, the quoted claim is marked rather than offered, and `convertBrief` skips the same-type short circuit when a claim is supplied, carrying `showDeck` across and dropping `emphasis`, which quoted the previous headline.)* *(Amended 2026-09-18, decision 258: "Draft a different brief" asks the shot-list model for another idea for ONE slot, with an optional steer from the owner, filling the gap between editing a brief by hand and re-planning every chapter. The format never changes: stock, archival and still briefs go through `buildRebriefRequest` under the Director's Book craft rules, while chart and map briefs go back through `buildRetypeRequest` with the target set to the type they already have, so the claim-number validation is unchanged and a redrawn chart still cannot cite numbers the dossier does not hold. A headline slot is refused, since every word on that card is read from the article. The work runs in `slot-rebriefer` behind the cost guard, refusals land on the row in the model's words, and the pending state shares the `retype` column, which now means "a model is rewriting this slot's brief" whichever button asked.)* *(Amended 2026-09-18, decision 259: both chart prompts now say which kind fits which data, because listing five kinds without a rule produced bars every time. `ChartSeriesSchema` gains an optional `axis`, and `chartLayout` builds a scale per side so two measures in different units can share a chart: the smaller one is no longer flattened onto the floor and labelled in the larger one's unit. The split is inferred from the units when the model omits the field; stacks and waterfalls never split. Each axis names its series and takes its colour, since with two scales the extremes otherwise land beside the wrong line.)* *(Amended 2026-09-18, decision 260: the House Visual Bible opens its shot grammar with "the sentence decides the frame", caps each motif at once per chapter and makes the third physical fact of a still a detail from the sentence rather than a motif; the shot-list and book prompts carry the same rules; `planWarnings` takes the book's motifs and per-slot chapter labels and notes a motif that appears twice in a chapter or in adjacent slots.)* *(Amended 2026-09-18, decision 261: `shot_slots.reuse_of_slot_id` links a slot to the slot whose shot it shows; a linked slot is never owed a fetch, and a `copy-reused-shots` step after the fan-out copies each source's chosen candidate (stamped `reusedFrom`) into its dependants, or leaves a placeholder when the source has none. Assembly, ingestion, the gate, shorts and the teaser read `candidates` unchanged.)* *(Amended 2026-09-19, decision 262: a brief's `depicts` entry names a cast member through `depictsName`/`depictedMembers` in `packages/schemas/src/cast.ts`, which accepts the bare name and the name followed by a role and refuses a name merely contained in a longer entry. Routing, pricing, the reference photographs sent and the altered-content label all take that join, so none of them can answer differently; the shot-list prompt and the bible now ask for the name alone.)* *(Amended 2026-09-19, decision 263: `stillStyleAnchors` carries positive direction only. "no text, no logos, no watermarks" is gone from it, on the same grounds as the "no identifiable real faces" ban before it: the string rides on every prompt, so a blanket exclusion fights every shot the bible asks for, and a documentary about a company shows that company's marks. The bible now rules per shot, allowing a real mark in frame and refusing a wordmark the frame must render as legible letters. "cinematic" left the anchors too: it sits on `BANNED_PROMPT_WORDS`, so every planned still warned about a word the app itself supplied.)*
5. **assembly-runner** (`gate/visuals.approved`): alignment (fan-out per chapter to `/media/transcribe`, or free timestamps from ElevenLabs; snap to script) → compile timeline JSON (pure function in `packages/timeline`, golden-tested) → validate against `TimelineSchema` → upload to S3 via broker → **preview-ready**; the same event marks the project ready for Gate 5's player preview. No render yet.
6. **render-runner** (`gate/preview.approved`, i.e. the user clicked "Render master"): broker invoke → `waitForEvent('render/completed'| 'render/failed', timeout: settings.render.timeoutMinutes + 10min)` → on success, QC step (media-utils: silence scan, black-frame scan, glitch scan, loudnorm to -14 LUFS integrated) → QC failure sets `stageStatus='failed'` with the QC report attached (never auto-publish around a QC failure) → emit `project/master.ready`.
7. **shorts-runner** (`project/master.ready`): for each approved Shorts candidate, compile a vertical timeline (reusing narration chunks + re-framed/re-chosen visuals + karaoke captions) → render via broker (parallel, capped) → QC → ready cards in the Shorts screen.
8. **publish-runner** (per item, on UI schedule action): preconditions — thumbnail uploaded (master only), metadata approved, publish slot chosen. Broker media-utils streams S3 → YouTube resumable upload (§9) → set `publishAt` → poll processing status → `status='scheduled'` → emit notification. Never uploads without an existing `publish_records` row transitioning `draft→uploading` atomically (`UPDATE … WHERE status='draft'` guards double-fire).
9. **analytics-runner** (daily cron trigger, the only cron): pull YouTube Analytics for all live videos → snapshots → weekly digest (Haiku) on Mondays.

---

## 8. Render broker & stopping renders (`infra/`)

**Endpoints** (bearer token; all requests and responses Zod-validated against `schemas`):
- `POST /renders` `{projectId, kind, timelineS3Key, composition, expectedDurationSec}` → validates timeline against the schema version the deployed site supports, **materialises it (resolves storage keys to fresh presigned URLs, §8.2)**, picks function/site/memory from broker config, calls `renderMediaOnLambda` with `webhook` set → `{brokerRenderId, remotionRenderId, estimatedCostUsd}`.
- `POST /renders/:id/cancel` → §8.1.
- `GET /renders/:id` → proxied `getRenderProgress` (the UI polls this at 2s while a render screen is open; Inngest relies on the webhook, not polling).
- `POST /webhooks/remotion` → verifies Remotion's signature; unknown `renderId` → log + 200 (never let a stale webhook 4xx-retry-storm); known → normalise `{success|error|timeout}` into one Inngest event `render/completed|failed`.
- `POST /media/qc`, `POST /media/loudnorm`, `POST /media/transcribe` (Whisper.cpp per §6 alignment; per-chapter audio in parallel, results merged by the caller), `POST /media/upload-youtube` → media-utils jobs (FFmpeg layer + Whisper.cpp binary, model pulled from S3 to `/tmp` on cold start), async with their own completion webhooks into Inngest. Media-utils Lambda config: 10,240 MB memory, 10 GB ephemeral storage, 15-min timeout — per-chapter transcription chunks keep every invocation comfortably inside these limits.

**8.1 Stopping renders — the honest contract.** Remotion Lambda has **no API to abort an in-flight render** (confirmed by the maintainers; the spawned render function cannot receive messages). Design accordingly:

- Cancel marks `renders.status='cancelled'` immediately; the broker records the ID in a tombstone set; when the render's webhook eventually arrives it is acknowledged, its artefacts are deleted via `deleteRender()`, and **no** Inngest completion event is emitted. The Inngest run has already been cancelled via `project/cancelled`.
- The wasted spend is bounded and accepted: ≤ one master render ≈ $0.25. Surface it honestly in the UI: "Render can't be aborted mid-flight; it will finish in the background, be discarded, and cost ≈ $0.25."
- Runaway protection is preventive, not reactive: `timeoutInMilliseconds` from settings, broker-level concurrency cap (default 2), and a CloudWatch alarm on Lambda concurrent executions and daily spend (§12).
- The **pre-render confirm** is therefore the real cancel point: the "Render master" button always shows duration + estimated cost and requires one explicit click. Everything before that moment is free to abandon.
- (If a local/SSR render path is ever added for multi-hour videos, use `makeCancelSignal()` there — that path *is* abortable. Note this in code comments; do not build it now.)

**8.2 Timeline JSON schema** (`packages/schemas`, the contract between app and compositions; version field mandatory):

```ts
TimelineSchema = {
  version: 1,
  fps: 30, width: 1920, height: 1080,           // shorts: 1080×1920
  brand: BrandKitTokens,                         // resolved snapshot, not a reference
  narration: [{ r2Key, startMs, durationMs, chapterId, paragraphIndex }],
  music: { r2Key, gainDb: -25, duckingCurve: [{tMs, gainDb}], cuePoints: [{tMs, style}] } | null,
  captions: { words: Caption[]  /* @remotion/captions format; text is script
              ground truth, timings from Whisper */, style: 'karaoke'|'none' },
  slots: [{ type, startMs, durationMs, transition,
            motion: {kind: 'kenburns'|'static'|'draw-on'|'camera-path', params},
            payload: ImagePayload|VideoPayload|ChartPayload|MapPayload }],
  overlays: [{ kind: 'lowerThird'|'chapterCard'|'watermark', startMs, durationMs, props }]
}
```
`ChartPayload` embeds the resolved data series and the source claim IDs. Compositions consume this JSON and the brand snapshot only — a timeline uploaded to S3 plus the site bundle is a complete, reproducible render definition.

**URL materialisation rule (critical):** timelines and asset payloads store **stable storage keys, never presigned URLs** — presigned URLs expire, which would silently break the "any timeline is re-renderable forever" guarantee. At invoke time the broker *materialises* the timeline: resolves every `r2Key`/S3 key to a fresh presigned URL (24 h expiry), writes the materialised copy to S3 under `renders/<renderId>/timeline.json`, and passes that to `renderMediaOnLambda`. The browser preview does the same materialisation server-side with short-lived URLs. The canonical stored timeline always contains keys only.

**Font rule:** compositions cannot load arbitrary fonts at render time. The Brand Kit's typography choices are limited to a **curated list of fonts bundled into the compositions package** (via `@remotion/google-fonts` or `staticFile`); the Brand Kit UI offers exactly that list, and adding a font is a compositions-package change, not a settings change.

**8.3 Composition inventory** (`packages/compositions`): `DocumentaryMaster`, `ShortVertical`; components `KenBurnsImage`, `StockClip`, `ChartReveal` (line/area/bar/waterfall, draw-on synced to narration beat, accent-colour emphasis), `AnimatedMap` (camera path, route/region overlays), `LowerThird`, `ChapterCard`, `KaraokeCaptions` (1-3 words, keyword highlight colour, 9:16 safe zones), `MusicBed` (volume-function ducking) *(Amended 2026-09-17, decision 256: a bed shorter than the film is laid down as overlapping copies rather than repeated, each stopping short of the file's written fade-out and crossfading into the next on the equal-power pair, with a 2.5s outro fade at the end of the film. The track's length comes from `MusicTrack.durationMs`, measured in the browser at upload and backfilled from the library page; a bed without one falls back to a plain loop.)*. All styling exclusively from `brand` tokens. Every component gets a Remotion Studio fixture for visual development. *(Amended 2026-09-17, decision 254: bar, stacked and waterfall charts write each bar's figure at the end of the bar (above when it grew, under when it fell, a stack reading its column total) and carry NO y-axis numbers and no unit caption. `formatFigure` folds the series unit's currency and scale into the figure, so a bar of 4000 with unit "USD Millions" reads "$4 Billion"; line and area keep their two extremes, written the same way. The board preview shares the same `chartLayout` and `barFigures`, so the approved chart is the rendered chart.)* *(Amended 2026-09-17, decision 257: `HeadlineCard` draws a cited news headline as a clipping — warm paper on the dark grade, the masthead over a double rule in Source Serif 4 (added to the bundled font catalogue), a highlighter sweeping under the emphasised phrase, and the byline, publication date and source address along the foot. There is no logo field: an outlet's name is set in our own type, and the card is identical whatever ran the story. Its payload embeds the article's five strings whole, like a chart embeds its series, so a render never depends on the page still being online.)*

---

## 9. YouTube integration

- OAuth once in Settings, requesting exactly these scopes: `youtube.upload`, `youtube` (metadata/thumbnails), `yt-analytics.readonly`. Store the refresh token encrypted (AES-GCM, key in env); surface connection health (a daily `channels.list` ping) as a status chip.
- **Token flow to media-utils:** the Lambda never sees the refresh token. The publish-runner (web side) exchanges it for a short-lived access token and passes that token in the job payload; if the upload outlives the token, media-utils calls back to a token-refresh endpoint on the web app.
- Upload runs **in media-utils Lambda**, streaming from S3 with resumable uploads (256 KB-aligned chunks, resume on 5xx/308, max 6h). Metadata: title, description (hook paragraph + chapter timestamps + sources from dossier + disclaimer), tags, `privacyStatus:'private'` + `publishAt`, `selfDeclaredMadeForKids:false`, AI-disclosure flag when settings say so.
- Thumbnails: `thumbnails.set` with the **Canva-exported PNG** the user uploaded (validate 1280×720 min, ≤2 MB, JPEG/PNG). Shorts get no thumbnail call.
- Quota: `videos.insert`=1600 units against a 10k/day default → the app enforces its own daily upload budget (default 4) and queues the rest. Every YouTube error is mapped: `quotaExceeded` → requeue tomorrow + notify; `uploadLimitExceeded` → pause queue 24h; auth errors → "Reconnect YouTube" card in Needs-you.
- **Until `apiAuditPassed` is set in settings**, the publish screen shows a completion checklist ending in "flip to public in YouTube Studio" instead of pretending the API can do it.

---

## 10. Brand Kit (settings module, feeds §8.2)

Stored as structured tokens; the settings UI edits them with a live specimen panel (a mini lower-third, chapter card, chart and caption rendered via `@remotion/player` with current values).

```ts
BrandKitTokens = {
  typography: { heading, title, body, numbers, captions:
      {family, weight, sizeScale, letterSpacing, transform} },   // numbers: tabular lining numerals
  colors: { primary, accent, background, surface, textPrimary, textSecondary,
            chartSeries: string[]  /* ordered, colour-blind safe */,
            captionHighlight, semantic: {collapse: red, recovery: green} },
  look: { logoR2Key, watermarkPlacement, grainPreset, lowerThirdVariant, chapterCardVariant },
  voice: { provider, voiceId, stylePrompt, pacing, locked: true },  // unlock = typed confirmation "CHANGE VOICE"
  music: { longFormStyle, shortsStyle, bedGainDb, duckDepthDb }
}
```
Timelines snapshot the tokens at compile time (old projects re-render identically after a rebrand).

**10.1 Library sources (where each library's content comes from)**

- **Music:** user-populated only. Tracks are downloaded by the human from the YouTube Audio Library (no API exists) — or later Epidemic/Artlist/ElevenLabs Music — and uploaded through the Music library screen into R2 (`assets` rows, kind `music`, moodTags). The app never fetches music from any external source; licensing stays a human decision. The licence field is required on upload (dropdown: `yt-audio-library|epidemic|artlist|generated|other`). *(Amended 2026-09-01, decision 205: the bytes upload browser → R2 directly via a presigned PUT URL — Vercel 413s request bodies over about 4.5 MB at its edge, so audio can never travel through a server action. Two actions bracket the transfer: one validates and issues the URL for the content-hash key, one verifies the object exists at a legal size and writes the row. Requires a CORS rule on the R2 bucket allowing PUT from the app's origins. Amended again 2026-09-01, decision 207: a bed may carry attribution/licence text (`assets.attributionText`, ≤3000 chars); the publish description gains a `Music:` block publishing it verbatim on every video whose timeline uses the track, placed after chapters and before sources, never dropped by the 5000-character squeeze.)*
- **Voices:** provider-hosted, referenced not stored. The Gemini adapter ships the static list of Gemini's prebuilt voices (curated subset with display names); the ElevenLabs adapter queries the account's voices endpoint. The audition panel generates samples on demand through the normal TTS adapters (audition spend goes through `withCost` like everything else). The app persists only `provider + voiceId + stylePrompt` in the Brand Kit, plus the audition sample files in R2 for later comparison.
- **Fonts:** bundled at build time in `packages/compositions` via `@remotion/google-fonts` (SIL OFL licences, safe for commercial video). The compositions package exports `AVAILABLE_FONTS` (family, weights, role-suitability metadata) as data; the Brand Kit UI reads that export, so Settings can never select an unbundled font. Adding a font = one import in the compositions package + redeploy of the Remotion site.

---

## 11. UI specification

### 11.1 Design system (the app's own look — distinct from the channel Brand Kit)

- **Aesthetic:** calm production console. Near-monochrome neutrals (zinc scale), exactly one accent (indigo), semantic green/amber/red used only for status. Light and dark themes; dark is default (video review happens on dark).
- **Type:** Geist or Inter for UI; JetBrains Mono for numbers, costs, timecodes, IDs, logs. 13-14px base in dense tables, 15-16px in editors.
- **Spacing/layout:** 8px grid; max content width only on settings/text screens — pipeline screens use full width. Borders (1px, subtle) over shadows. Corner radius 8. No decorative gradients, no illustration.
- **Motion:** 150-200ms ease-out on state changes only; respect `prefers-reduced-motion`; never animate layout during review tasks.
- **Density:** information-dense but scannable: tables and cards show primary fact + one secondary line; everything else behind hover/popover.
- **Feedback:** skeletons on load, optimistic updates on all approve/flag actions with rollback toast on failure; toasts bottom-right, auto-dismiss except errors; destructive/spending actions use an **inline two-step** (button → confirm with cost/consequence) — never a browser confirm, modals only for genuinely modal work.
- **Button-first interaction:** every action is a clearly labelled, always-visible button — no action may exist only as a keyboard shortcut, gesture or hidden menu. Rules: one visually dominant primary button per screen (the gate action), secondary actions as outlined buttons beside it, per-item actions (flag, swap, regenerate) as icon-buttons with text labels directly on the row or card they affect, never in overflow menus if used more than occasionally. Buttons show their consequence where it matters ("Render master · ≈$0.25 · ~4 min") and their busy state inline (spinner replaces label, button stays in place). Hit targets ≥ 40px. The only keyboard behaviours retained are the universal ones users expect from media and text: Space for play/pause in players and standard text-editing keys in the script editor. No command palette.
- **Accessibility:** WCAG AA contrast in both themes, full focus-visible rings, semantic landmarks, captions/waveforms never colour-only (icons + text labels accompany state colours).

### 11.2 Information architecture

```
Left rail (icons + labels, expandable):
  ◆ Dashboard   ◆ Projects   ◆ Case Library   ◆ Calendar   ◆ Costs   ◆ Settings
Top bar: breadcrumb · active-runs indicator (live step name, pulsing dot) · cost-month meter
Right drawer (opened by an "Activity" button in the top bar): run/activity feed for the current
project (Inngest steps, retries, fallbacks, spend)
```

### 11.3 Screens

**Dashboard — "Needs you" is the whole point.**
- Hero section: **Needs-you queue** — cards for every open gate, budget gate, failed run, flagged QC report and "reconnect YouTube", sorted by age. Each card: project, stage icon, one-line context ("Script ready · 18 min est · 3 unsourced-claim warnings"), age badge, and a primary button that deep-links straight into the review screen. Empty state: "All clear — pipeline is running itself." with next scheduled publish.
- Secondary: Active runs (live step + progress), This-week calendar strip, month cost meter with per-provider bars.

**Project view — the pipeline rail.**
- Persistent horizontal rail of the 8 stages; each segment shows state (queued/running with spinner/awaiting review with pulsing amber/approved check/failed red/cancelled grey) and is clickable. Below it, the current stage's screen renders. A sticky **gate action bar** (bottom) on every review screen with two buttons: outlined `Request changes` and filled primary `Approve`, plus context (est. runtime, warnings count, cost of next stage). Approve is disabled until blocking items are resolved, with the reason shown inline ("2 flagged takes unresolved").
- **Stop control:** every running stage shows `Stop` in the rail's overflow menu → inline two-step → emits `project/cancelled`. If a render is in flight the confirm explains the Lambda caveat verbatim (§8.1).

**Projects.** List of all projects as rows: title, case category badge, a **mini pipeline rail** (the 8 stages as small state dots), current stage label with age ("Voice review · waiting 2 d"), estimated runtime, and a primary button contextual to state (`Review`, `View`, `Resume`). Filter chips: Needs review / Running / Failed / Done. `New project` button opens a case picker from the shortlisted cases.

**First-run setup.** On first login with empty settings, the dashboard is replaced by a setup checklist (each item a button that deep-links, each shows done-state): 1. Connect YouTube · 2. Choose narration voice (opens the audition panel) · 3. Set up Brand Kit · 4. Add at least 3 music beds · 5. Add your first cases. The pipeline cannot start a project until 2-4 are complete, and the checklist says so plainly.

**Case Library.** Table (sortable: priority, category, status) + "Suggest cases" button that streams Claude's proposals into draft rows for triage, each row carrying visible `Accept` and `Dismiss` buttons.

**Dossier review.** *(Amended 2026-08-28, decision 196 — was two-pane with a permanent claims table.)* One column: a claims bar above the dossier document, which renders as formatted markdown (parsed by the app's own minimal parser — model output is never interpreted as HTML). Claims anchor to the text they were extracted from: a verbatim or closely restated claim is a highlighted, pressable phrase (amber while it blocks, struck through when quarantined) that opens a modal with the full claim row — text, source domain, type badge, confidence chip, and the actions: open source, edit, verify, **quarantine** (excluded from scripting, struck through). The bar always lists every claim that still blocks approval — anchored or not — plus counts (total, blocking, not found in the text) and a toggle that lists the full extraction; claims the matcher cannot place in the text are never hidden. Approve blocked while any `unverified` claim is neither verified (user flips it to sourced after checking) nor quarantined.

**Script Studio.** *(Amended 2026-08-28, decision 197 — the third "context" column is dropped: its warnings list duplicated the gutter and outline, and its width came out of the editor.)* Two columns: chapter outline (drag-reorder, per-chapter runtime) · editor (TipTap-based, markdown-backed). The selected chapter's Shorts-candidate segments (with hook rationale) sit in a collapsible strip under the editor, absent when the chapter has none. Editor gutter: amber markers on warned sentences (click → warning + one-click fix buttons: "insert 'alleged'", "link claim", "send note to regenerate"). Per-section regenerate: select text → a floating `Regenerate…` button appears above the selection → note → diff view (red/green, with `Accept` / `Reject` buttons per hunk). Autosave (500ms debounce) with visible saved-state; every human edit recorded to `script_edits`. Header: total runtime estimate vs target, live word count, model badge (with fallback indicator if a downgrade happened).

**Voice review.** Chapter accordion → paragraph rows: waveform strip, duration, take number, status chip, and two row buttons: `Play` and `Flag`. Playback (1.0/1.25/1.5× selector) continues across rows for a natural listen-through; the playing row auto-scrolls into view with a prominent `Flag this paragraph` button that stays under the cursor. Flagging opens a note field and enqueues the retake immediately (row shows spinner, then the new take with an A/B toggle between takes). Coverage bar at top: generated/flagged/approved counts. Approve enabled at zero flagged.

**Visual board.** Filmstrip timeline synced to an audio scrubber across the top (click a slot → audio seeks to it, with a play/pause button on the scrubber). Slot cards: brief summary line, type badge, candidate strip (4 thumbnails, click to select, chosen gets a ring and a "Selected" label), and labelled buttons: `Edit brief & re-fetch`, `Regenerate`, `Upload own`. Chart/map slots render live previews with real Brand Kit tokens (small `@remotion/player` instances) and show their source-claim chips; a chart with no claim ref renders an error card, not a chart. Unresolved/placeholder counter in the action bar; approve allowed with placeholders only via explicit "approve with N placeholders" wording. *(Amended 2026-09-18, decision 261: stock, AI image and real-footage cards carry `Use an existing shot`, which lists the film's other picture slots with the covered sentence, chapter and time, the gap to this slot, and a `Use this` button per candidate the app holds bytes for, or `Use whatever this slot chooses` before Fetch. A linked card shows the copy with a "Reused from ch N · m:ss" chip, keeps `Edit brief`, hides every fetch-shaped button and offers `Choose its own shot`. Two plays of one picture under a minute apart are a note, never a block.)*

**Preview & render (Gate 5a).** Full-width `@remotion/player` of the compiled timeline: chapter markers on the seek bar, caption toggle, music-duck visualisation (thin gain line under the seek bar). Side panel: timeline stats (duration, slot count, per-chapter runtimes), a **music picker** (choose the bed from the Music library, adjust cue points; changing it recompiles the timeline, which is cheap and free), and the **Render master** button showing est. cost and time; inline two-step. After invoke: progress view driven by 2s polling (percent, frames, elapsed, est. remaining), Stop with the honest caveat, then the QC report card (pass/fail per check with timestamped thumbnails of any detected black frames/silences) and the master playable from S3.

**Shorts.** Card grid: vertical 9:16 player, segment source line, ending toggle (loop/CTA), editable title+description, render state, and a **Related-link checklist chip** ("Set related video link in Studio → mark done"). *(Amended 2026-09-08, decision 226: the chip is bookkeeping, not a scheduling gate — the Studio act it records is only possible once the Short is on YouTube, so requiring it before scheduling was a deadlock. The Publish screen reminds on scheduled/live Short cards instead.)* *(Amended 2026-09-08, decision 227; 2026-09-10, decision 230.)* Teaser cards additionally carry an **Open the teaser studio** button: a full-width panel running the teaser's own mini pipeline — **Script** (editable beats tagged by chapter; Save is free and stales downstream), **Voice** (**Voice the script** synthesises only changed beats via the text-hashed TTS idempotency key, stores them on the row, plays per beat), **Shots** (per beat, a picker over that chapter's resolved board slots plus an Auto chip; choices stored as full slot snapshots) and **Assemble & render** (a free synchronous compile from stored voice + choices, then the render spend). *(Amended 2026-09-10, decision 231: phase 2 built.)* Each beat also carries a **Fetch new shots for this beat** toggle: an editable **stock search** (free and unscored, since the strip is picked by eye; a re-search replaces stock results, bought stills survive) and an editable **still prompt** with a two-step **Generate a still · est. $** (the routed generator via the board's own `generateStillCandidates`, cost-guarded). Fetched options render as a per-beat strip; picking one whose bytes are settled stores its slot snapshot instantly, while a live stock pick is first ingested into R2 by the `teaser-shot-fetcher` (provider URLs expire, section 8.2) and shows "Preparing the picked clip…" until stored. Request state and pools live on `shorts.teaser_fetches`; failures are words on the beat plus a notification, never a dead spinner.

**Publish.** Week calendar with drag-to-slot scheduling (defaults from settings: e.g. long-form Fri 15:00 UTC, Shorts Sat/Mon/Wed). Item editor: title picker (the 8-10 generated options as radio list + free edit), description with live preview (chapters, sources, disclaimer auto-blocks), tags, **thumbnail dropzone: "Export from Canva → drop up to 3 PNGs"** with client-side validation (1280×720+, ≤2 MB) and a deep link to the Canva template; variant thumbnails stored for Test & Compare (set up manually in Studio; the app shows a reminder checklist). Status chips through `draft→uploading (progress) →scheduled→live`; failures show the mapped YouTube error and a retry button. *(Amended 2026-09-01, decision 198.)* A `scheduled` item is movable: the same select-then-press-a-slot gesture (or drag) re-points the video's `publishAt` via `videos.update` — status read back whole first, so no other status field is reset — and only then the row. Live items refuse: a public video has no moment left to move. *(Amended 2026-09-10, decision 232.)* The thumbnail dropzone appears on Short items too, marked optional (search and channel pages show it; the feed plays the video) — the runner sets any stored thumbnail on the uploaded video, and only masters are REQUIRED to have one. The stored thumbnails render as a constant-height tile strip whose geometry is reserved, so an upload changes pixels, never the panel's layout. *(Amended 2026-09-08, decision 226.)* Beside the default slots: a **custom datetime picker** (any future moment, local timezone), a per-item **Publish now** button (post-audit uploads public; pre-audit uploads private and the checklist's Studio flip applies), and a **Mark project as Done** footer — publish → done is a human decision, exactly like the shorts → publish handover.

**Costs.** Month view: per-provider spend vs budget bars, per-project cost breakdown table, ledger table (filterable), kill-switch toggle, budget editors.

**Settings.** Tabs: Brand Kit (token editors + live specimen panel; font pickers offer only the curated bundled list, §8.2; voice section shows locked state, unlock via typed confirmation) · **Voice audition** (paste a sample paragraph → `Generate auditions` renders it in up to 6 candidate voices across providers side by side with per-voice `Play` and `Choose this voice` buttons; choosing writes and locks the Brand Kit voice) · **Music library** (drag-and-drop upload of licensed beds e.g. from the YouTube Audio Library, per-track mood tags, inline preview player, delete; the Preview screen's music picker draws from this library) · Models (routing matrix task × provider+model, with per-task dropdowns fed by each adapter's known-model list, plus the optional cross-provider fallback chain) · Budgets · **Connections** (one card per provider — Anthropic, OpenAI, Gemini, ElevenLabs, Pexels, Pixabay, fal.ai, YouTube: masked key display `sk-…4f2a`, `Replace key` paste field, `Verify` button that pings the cheapest endpoint and stamps lastVerified, status chip `ok/invalid/unchecked`, and for YouTube the OAuth connect/reconnect flow; a provider referenced by current settings with no working key shows an amber warning here and on the dashboard) · Publishing defaults (schedule slots shown in your local timezone, stored as UTC) · Danger zone (cancel-all-runs).

### 11.4 Notifications

On gate-open, run-failure, QC-failure, budget-gate and publish-success: web push (VAPID) + optional email (Resend). Notification deep-links to the exact review screen. All review screens are responsive to 390px — approving a script or dossier from a phone is a first-class flow (single-column layout, gate action bar becomes a bottom sheet).

---

## 12. Observability & operations

- **Logging:** structured JSON (pino) with `projectId`/`runId`/`stage` on every line; broker and media-utils log to CloudWatch with the same fields.
- **Error tracking:** Sentry (web + Inngest functions + Lambdas), release-tagged.
- **Run mirror:** Inngest middleware writes step transitions to `run_events` so the in-app activity drawer never depends on the Inngest dashboard.
- **Webhook security:** the Inngest serve route verifies Inngest signing keys; the Remotion webhook verifies Remotion's signature; the media-utils completion webhooks carry an HMAC over the payload with the broker token. All three reject-and-log on mismatch.
- **Alarms (CDK):** Lambda error rate, Lambda concurrent executions > cap, daily AWS spend anomaly, broker 5xx, webhook signature failures (possible probe), YouTube quota exhaustion. Alarm → SNS → email + web push.
- **Backups:** Postgres PITR (Neon default); R2/S3 lifecycle: inputs 180d, renders 90d, published masters copied to a `keep/` prefix exempt from expiry.

## 13. Testing & acceptance

- **Unit (Vitest):** timeline compiler golden tests (fixture project → byte-stable JSON); ducking-curve maths; cost guard (cap edge cases, kill switch, concurrent estimate reservation); every Zod schema (valid/invalid fixtures); YouTube error mapper; provider adapters against recorded fixtures.
- **Component:** Remotion compositions render single frames per fixture and snapshot-compare (`@remotion/renderer` `renderStill` in CI); karaoke caption safe-zone test at 9:16.
- **Integration:** Inngest test harness: full pipeline with mocked providers, asserting gate parking/resume, cancellation mid-stage, memoisation (a step re-run must not call the provider twice — assert via mock call counts), budget-gate flow, partial-failure thresholds.
- **E2E (Playwright):** with a mock-provider mode (env-switched), drive: create case → approve dossier → edit + approve script → flag one paragraph → retake → approve voice → resolve slots → approve → preview → render (local `renderMedia` of a 20-second fixture instead of Lambda in CI) → QC pass → schedule publish (YouTube mocked). All flows driven through visible buttons only (asserting no action requires a shortcut), plus a 390px mobile pass of dossier + script approval.
- **Definition of done:** all suites green in CI (GitHub Actions: lint, typecheck `strict`, unit, component, integration, E2E); zero `any` in `packages/schemas` and `packages/compositions`; Lighthouse a11y ≥ 95 on dashboard, script studio, publish; a real staging render of the fixture project completes on the actual Lambda deployment with QC pass; a full manual production of one real 15-minute video end-to-end.

## 14. Build milestones (execute in order; each ends with its tests green)

1. **M1 Skeleton:** monorepo, env validation, auth (allowlist), DB schema + migrations + **seed script** (a fixture case/project used by dev, tests and E2E throughout), settings CRUD, app shell (rail, top bar, theming), first-run setup checklist, CI.
2. **M2 Orchestration spine:** Inngest wiring, run mirror + activity drawer, cost guard + Costs screen, notification plumbing. A demo no-op pipeline with two fake gates proves park/resume/cancel on production infra.
3. **M3 Writing room:** Case Library (+ suggestions), dossier-runner + review UI, script-runner + Script Studio (editor, warnings, diff regenerate, edit trail), model router with fallback.
4. **M4 Voice:** TTS adapters (Gemini batch, ElevenLabs), voice-runner, review UI with retakes, phoneme hints, idempotent takes, the voice-audition panel in Settings.
5. **M5 Visuals:** shot-list generation with typed briefs, stock/archival adapters + scoring, Flux adapter, visual board UI, chart/map live previews.
6. **M6 Assembly & render:** alignment (Whisper.cpp in media-utils + snap-to-script function with golden tests), timeline compiler + golden tests (`packages/timeline`) *(Amended 2026-09-17, decision 255: the compiler anchors every slot to the first word of its brief's `coversText` before any shifting (`anchorSlots`), bounded to the slot's own paragraph and monotonic, because the planner's per-slot seconds are a guess made before the narration was timed and a slot that overruns pushes the rest of its paragraph late. A shot then ends where the next shot's words begin, floored at `MIN_SHOT_MS`. The planner (`plannedToRows`) and the board (`visualsReviewModel`) anchor with the same function over `TimedParagraph.words`, so the card, the scrubber and the cut agree; the board recomputes rather than trusting the stored row, so a project planned before the rule needs no re-plan.)*, music library + picker, compositions library with bundled fonts + Studio fixtures, CDK deploy of broker + media-utils into the Reelscript account (separate function/site, tags, concurrency cap), broker URL materialisation, preview screen, render flow + webhook + QC + stop semantics.
7. **M7 Shorts & publish:** shorts-runner + UI, YouTube OAuth + resumable upload + error mapping + quota queue, publish calendar + thumbnail dropzone, private-until-audit checklist mode.
8. **M8 Analytics & polish:** analytics-runner + retention-vs-chapter overlay on project pages, weekly digest, alarms, mobile passes, button-affordance audit (every action visible, labelled, ≥40px), empty states, Lighthouse, full E2E, staging render, one real video produced.

*(Do not reorder M6 before M3-M5: the compositions need real timeline fixtures, and the writing room delivers standalone value immediately.)*
