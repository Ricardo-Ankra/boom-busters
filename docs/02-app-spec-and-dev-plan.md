# Boom-Busters Production App
## Production App Spec Sheet & Development Plan

*A single-user web app that turns a researched financial-story case into a published long-form YouTube video plus derived Shorts, with human approval gates at every quality-critical point. It serves the channel **Boom & Busters** (`@BoomAndBusters`). Naming convention everywhere: `boom-busters` for the repo, packages, infra stacks, buckets/prefixes, tags and identifiers; "Boom & Busters" only in public-facing channel copy.*

---

# 1. Product overview

**Purpose:** collapse the production time of a 15-25 minute narrated documentary from ~8-10 hours to ~2 hours of human review, at a quality level that beats the AI-slop tier and satisfies YouTube's inauthentic-content policy (original scripts, cited sources, material variation, human curation).

**Design principle: automate the assembly, gate the judgement.** Five mandatory human gates: dossier sign-off, script approval, voice approval, visual approval, publish approval. Everything between gates runs unattended as background jobs.

**Cost principle: conservative defaults, configurable everything.** Every external provider and model is a setting, not a hard-coded choice. Defaults:

| Job | Default | Configurable alternatives |
|---|---|---|
| Research dossiers | **Claude Opus** (reasoning depth, factual care) | Sonnet, Fable |
| Script drafting | **Claude Sonnet** (batch + prompt caching) | Opus for flagship episodes |
| Editing passes, self-checks, shot lists, metadata, digests | **Claude Haiku** | Sonnet |
| Narration | **Gemini 3.1 Flash TTS** (batch, ~$0.90-1.80/hr) | ElevenLabs Multilingual v2 (premium/cloned voice) |
| Stills | Free archival + stock | Flux via fal.ai |
| Music | YouTube Audio Library (free) | Epidemic/Artlist, ElevenLabs Music |

Model routing lives in Settings with per-stage overrides and a per-provider monthly budget cap with kill switch. Nothing expensive runs before its gate: audio is generated only after script approval, retakes are paragraph-level, previews render at 360p and the 1080p master renders exactly once.

**Brand Kit (Settings module).** Channel identity is data, defined once and consumed everywhere, so a rebrand is a settings change and every future render inherits it:

- **Typography:** font family, weight, size scale and letter-spacing defined per role: headings, video titles, body/lower-third text, **numbers/figures** (tabular-lining numerals for charts and money amounts), and Shorts karaoke captions (including highlight style).
- **Colours:** primary, accent, background/surface, text, chart series palette (ordered, colour-blind safe), caption keyword-highlight colour, and the "collapse red / recovery green" semantic pair used in charts.
- **Look:** logo/watermark and placement, film-grain/grade preset for stills, lower-third and chapter-card layout variant.
- **Voice:** the locked narration voice (provider, voice ID, style/delivery prompt, pacing) plus the Shorts voice treatment if different. Changing it is deliberately a two-step confirmation, since the voice is a brand asset.
- **Music defaults:** long-form bed style and level, Shorts bed style, ducking depth.

These tokens feed every Remotion template (lower thirds, chapter cards, captions, charts, maps), the Flux/Ideogram prompt builder (style anchors), and the Canva thumbnail templates, keeping the whole catalogue visually coherent, which is itself a defence against the "templated slop" classification because coherence comes from brand tokens, not repeated content.

**Non-goals (v1):** multi-user/teams, mobile app, other platforms (TikTok/Instagram export is a v2 flag), live A/B thumbnail automation (YouTube's Test & Compare has no API; the app prepares variants, you set them in Studio).

---

# 2. Pipeline (the core of the app)

Each video is a **Project** moving through eight stages. Stages 2-8 each have a status: `queued → running → awaiting_review → approved`.

### Stage 1: Case Library (idea backlog)
- Backlog of cases (Enron, Wirecard, Steinhoff...) with fields: title, category (Collapse / The Con / Meltdown / The Turnaround / Empire — the latter two are the phased-broadening series and sit dormant until activated), search-demand notes, competitor coverage links, priority score, status.
- "Suggest cases" action: Claude proposes new cases with rationale based on gaps in the backlog and seasonal hooks.

### Stage 2: Research Dossier
- Input: case name + angle. Claude (with web search enabled via the API's search tool) builds a structured dossier: timeline of events, key people, key numbers (amounts, dates, share prices), direct quotes, and a **source register** (every claim mapped to a URL; court filings and regulator findings preferred).
- Output rendered as an editable document with claims flagged by confidence: `sourced / single-source / unverified`.
- **Gate 1:** you verify flagged claims, delete anything shaky, approve. The dossier becomes the ground truth for everything downstream; the script stage is instructed to use only dossier facts.

### Stage 3: Script Studio
- Claude generates: (a) a retention-engineered outline (cold open ≤15s, act structure, open loops, planned re-hook at the 55-65% mark, closing bridge to a related video), then (b) the full script chapter by chapter (2-3k words per pass for quality), against the cached style bible and the approved dossier only.
- Automatic self-check pass: Claude cross-references the draft against the dossier and lists any claim without a source (rendered as inline warnings).
- Editor UI: chapter-based rich text with per-section "regenerate with note" (e.g. "punchier, cut the numbers in half"), diff view, estimated runtime (at ~150 wpm), and a Shorts-candidate marker Claude pre-applies to the 5 most hook-worthy segments.
- **Gate 2:** you edit and approve. Tracked human edits are stored (evidence of curation, useful if monetisation is ever reviewed).

### Stage 4: Voice
- Script chunked by chapter to the configured TTS provider. Default: **Gemini 3.1 Flash TTS via the batch API** (~$0.90/hr of audio); fallback: ElevenLabs Multilingual v2 (stability ~35-40%) when a cloned/bespoke brand voice justifies the premium. Chosen by blind audition at channel setup, then locked: the voice is a brand asset and never changes.
- Pronunciation handling is provider-agnostic: a project-level phoneme-hint list (names like "Wirecard", "Steinhoff", ticker symbols) injected into the TTS prompt (Gemini) or registered as a dictionary (ElevenLabs).
- Player UI with per-paragraph waveform; flag a paragraph → regenerate just that chunk → auto-splice. Retakes are always paragraph-level, never whole-script.
- Note: Gemini audio carries an inaudible SynthID watermark; a non-issue given the channel's transparency about AI narration.
- **Gate 3:** listen-through (1.25x) and approve.

### Stage 5: Visual Plan
- Claude converts the approved script into a timed **shot list**. Every slot is a full creative brief, not a keyword. Common fields for all slots: the script sentence(s) it covers, on-screen duration, a **detailed visual description** (subject, composition, era, mood, lighting/colour grade), motion spec (zoom direction and speed, pan path, or static), and transition. Then per type:
  - `stock`: the search query **plus** a description of the ideal clip ("slow push-in on a deserted open-plan office at dusk, empty desks, papers left behind, cool blue grade, no identifiable faces or logos") and rejection criteria (no watermarks, no modern tech in a 1990s segment). The app scores fetched candidates against the description before showing you the top 4.
  - `archival`: source pool (Wikimedia/Flickr Commons/national archives), what the photo must show, acceptable era range, and the licence field to verify.
  - `still` (AI-generated): the complete Flux prompt including style anchors from the Brand Kit ("1995 Barings trading floor, CRT monitors, film grain, muted teal-and-amber grade") plus a negative prompt.
  - `chart`: chart type (line, area, bar, stacked, waterfall), the exact data series with values and units pulled from the dossier (so charts are sourced, never invented), axis ranges, the single takeaway to visually emphasise ("highlight the 4-day collapse from $80 to $0.26 in accent colour, dim everything before it"), annotation callouts, and reveal animation (draw-on synced to the narration beat).
  - `map`: locations, camera path (start/end coordinates and zoom levels), route or region overlays, labels, and timing relative to narration.
  - `hero` (optional Veo clip): full text-to-video prompt with duration, camera movement and loop requirement.
- The app pre-fetches: top 4 scored stock candidates per slot, 2 Flux generations per still prompt, live chart and map previews rendered with actual Brand Kit tokens.
- Review UI: filmstrip aligned to the script; per slot you can swap candidates, edit the description and re-fetch, regenerate, or upload your own. Charts and maps are the anti-slop differentiator; the app makes them first-class.
- **Gate 4:** approve the board (typically 15-20 min).

### Stage 6: Assembly & Render
- Word timings are produced in-house: Whisper.cpp in the media-utils Lambda (Remotion's `@remotion/install-whisper-cpp` + `toCaptions()`), snapped to the approved script so caption text is always ground truth and only timings come from the transcription. ElevenLabs timestamps are used directly when it is the voice provider.
- A **timeline JSON** is compiled: narration chunks, visual slots with Ken Burns moves (Remotion interpolation; DepthFlow parallax as a later upgrade), music bed with its ducking curve, lower-thirds for names/dates, chapter cards, all resolved against Brand Kit tokens. This JSON is the single input to the renderer, which is what makes every render reproducible and every re-render cheap.
- **Music is a per-project toggle, default "on, subtle":** a bed chosen from the app's music library (tracks you download once from the YouTube Audio Library — free, cleared for monetisation — and upload with mood tags) sitting ~-25 dB under narration with side-chain ducking, with cue points at tone shifts (e.g. the moment the fraud unravels) selectable in the timeline UI. Shorts get a separate, more energetic default. Rationale: the genre's incumbents all use beds, and a bed masks the flat seams between TTS chunks. Paid libraries (Epidemic/Artlist) and ElevenLabs Music are config options for later.
- **Preview costs nothing.** Gates 4 and 5 review the composition live in the browser through `@remotion/player`, driven by the same timeline JSON the renderer consumes. No proxy renders, no 360p previews, no Lambda invocations until you approve. Only the approved master is ever rendered, exactly once.
- **Render:** `renderMediaOnLambda()` against the Boom-Busters site, chunked and parallelised across Lambda, output to S3. Remotion's published cost examples put a 10-minute HD render at about $0.10, so a 20-25 minute master lands near **$0.20-0.30 and completes in a few minutes** rather than the ~20+ minutes a local CPU would need. Shorts render from the same site at a few cents each.
- Auto-QC in the media-utils Lambda: silence detection, black-frame detection, audio glitch scan, then a single-pass loudnorm to -14 LUFS. The glitch-tier failures that plague the slop channels never reach an upload.
- **Length ceiling worth knowing:** Lambda chunking handles 20-40 minute videos comfortably. The future sleep-history channel's 2-4 hour renders would be better served by a long-running Fargate or EC2 renderer reusing the same compositions, which is a deployment-target change rather than a rewrite.

### Stage 7: Shorts Factory
- For each approved Shorts-candidate segment (from Stage 3): cuts the narration audio, re-frames or re-renders visuals to 9:16, burns karaoke captions (1-3 words, keyword colour pops, safe-zone aware), adds the hook text overlay, and renders two endings per Short: seamless-loop version and cliffhanger-CTA version ("the full story is on the channel").
- Output: 3-5 Shorts per long-form video, each with generated title/description and a checklist item: "set Related Video link to [video] in Studio".

### Stage 8: Publish
- Metadata studio: 8-10 title options, description (hook paragraph, chapter timestamps, source list auto-inserted from the dossier, standard disclaimer), tags.
- Thumbnail lane: **made entirely in Canva, outside the app.** The app shows a deep link to the Canva template, a drag-and-drop upload slot for the exported PNGs (up to 3 variants for Test & Compare), validation (1280×720, ≤2 MB), and stores them per video. No AI thumbnail generation anywhere in the pipeline.
- Upload via YouTube Data API: scheduled (`privacyStatus: private` + `publishAt`), thumbnail set via API for long-form (not possible for Shorts), AI-disclosure flag where applicable.
- **Gate 5:** final approve → schedule. Long-form and its Shorts are auto-spaced (e.g. long-form Friday, Shorts Sat/Mon/Wed pointing at it, inside the 10-day engagement window).
- **Constraint to plan around:** API projects must pass YouTube's compliance audit before API uploads can be public. Apply immediately (2-4 weeks). Until then the app schedules as private and you flip to public/scheduled in Studio (one click, still saves hours).

### Analytics module (cross-cutting)
- Nightly pull from the YouTube Analytics API: retention curves overlaid with the script's chapter markers (see exactly which chapter bleeds viewers), CTR by traffic source, Shorts viewed-vs-swiped and engaged views, subs per Short, Related-link traffic to each long-form, RPM by video.
- Weekly digest: what to double down on, auto-drafted by Claude from the numbers.

---

# 3. Architecture

**Rule: Vercel runs the app, AWS runs the media. The web layer never touches a video byte.**

This is a hard constraint, not a preference. Vercel functions cap at 300s on Hobby and 800s on Pro, with 500 MB of `/tmp` and a 4.5 MB request payload, and Vercel's own guidance is that this class of workload does not belong in a serverless function. A 20-minute render is impossible there. Rendering goes to the **Remotion Lambda deployment already running for Reelscript**.

```
Browser ── Next.js UI + @remotion/player live preview (zero render cost)
  │
Vercel ── app layer ONLY: orchestration, gates, API routes, provider
  │        calls (Claude, Gemini TTS, Pexels, Flux), signed-URL issuance.
  │        Media never streams through it.
  │
  ├── Postgres (Supabase/Neon free tier): projects, dossiers, scripts,
  │     shot lists, Brand Kit, timelines, publish records, analytics
  ├── Cloudflare R2: input assets (narration chunks, stills, stock,
  │     music) — presigned; free egress means Lambda pulls them for $0
  ├── Inngest ── durable orchestration (the Reelscript pattern, reused)
  │     owns every multi-step run: research, draft_chapter, tts_chunk,
  │     fetch_assets, gen_image, align, compile_timeline, render,
  │     cut_short, upload, analytics. Holds the five human gates open
  │     on waitForEvent, memoises completed steps, retries flaky ones.
  │
  └── AWS ── existing Reelscript account/region
        ├── render-broker Lambda ── the only door Vercel knocks on:
        │     validates the request, writes timeline JSON to S3, picks
        │     function version/site/memory, invokes, verifies the
        │     Remotion webhook signature, emits an Inngest event
        ├── Remotion Lambda ── renders the 1080p master + each Short
        │     from the timeline JSON, chunked and parallelised → S3
        ├── S3 ── render outputs, 90-day lifecycle expiry
        └── media-utils Lambda (FFmpeg + Whisper.cpp) ── word timings
              via @remotion/install-whisper-cpp snapped to the script,
              QC scan, loudnorm pass, resumable YouTube upload from S3
```

**Alignment stays in-house on Remotion's own tooling.** Word timings come from Whisper.cpp running inside the media-utils Lambda via `@remotion/install-whisper-cpp`, converted with `toCaptions()` into the `@remotion/captions` format the caption components consume natively. Because the script is ground truth, a snap step takes timings from Whisper but text from the script, so captions can never contain a mistranscription, and unmatched stretches are flagged in QC as probable TTS glitches. If the voice provider is ElevenLabs, its `with-timestamps` endpoint supplies timings with the TTS call and transcription is skipped; a hosted API (AssemblyAI/Replicate) remains only as a config fallback. And **audio mixing happens inside the Remotion composition rather than in FFmpeg**: narration chunks are sequenced as individual `<Audio>` elements with the music bed as a parallel track whose volume function implements the ducking curve. Two payoffs worth having — a paragraph retake becomes a swapped asset URL instead of a re-splice, and there is no separate audio pipeline to maintain.

## 3.1 Sharing the Reelscript Remotion Lambda deployment

A Remotion Lambda setup is two deployed things: a **function** (the generic renderer runtime, pinned to a Remotion version) and a **site** (your bundled React compositions). One function can serve many sites, but only if every site's Remotion npm version matches the function's.

**Recommendation: reuse the AWS account, region, IAM role, bucket conventions and deploy pipeline, but deploy a separate function and site for Boom-Busters.** Deployed functions cost nothing at rest since you pay only per invocation, so decoupling is free insurance against being forced to upgrade Reelscript every time Boom-Busters upgrades Remotion, or the reverse. If you would rather share one function, pin both repos to an identical Remotion version and upgrade them in lockstep.

Housekeeping either way: a separate S3 output prefix per project with a 90-day lifecycle rule, AWS cost-allocation tags so spend is attributable per channel, and a per-project concurrency cap so a Boom-Busters render burst cannot starve a Reelscript job. Remotion's licence is free for individuals and companies of three or fewer people, so a solo build carries no licence cost.

## 3.2 The orchestration layer (Inngest) and the render broker

These are two separate pieces of the Reelscript stack, solving two different problems. Both are worth reusing, but only one is load-bearing.

**Inngest is load-bearing.** `renderMediaOnLambda()` returns immediately with a `renderId`, and completion arrives either by polling `getRenderProgress()` or by a signed webhook. Either way something has to stay alive across minutes of rendering, and across the *hours or days* a script can sit at a human gate. Vercel's 800s ceiling means that something cannot be a Vercel request. Inngest supplies four things that would otherwise be hand-rolled:

- **Step memoisation.** A pipeline run is a sequence of expensive steps. When step 9 fails, completed steps replay from cache rather than re-executing, so a late failure never re-pays for the Opus research pass or the TTS generation. This is a direct cost control, not just a convenience.
- **Durable human gates.** Each gate is `step.waitForEvent()`. The run parks indefinitely at `awaiting_review` and resumes the moment you approve from the UI or your phone. Without it, the five gates become a state machine in Postgres polled by cron.
- **Retries, concurrency and fan-out.** Per-step backoff on flaky provider APIs; a declarative concurrency cap (for example two concurrent renders) that stops Boom-Busters starving Reelscript; fan-out for 40 parallel image generations or 5 parallel Shorts renders, with fan-in afterwards.
- **Observability and replay.** Every run, step and failure is inspectable and re-runnable, which matters a great deal when debugging a ten-stage media pipeline.

Alternatives exist (Trigger.dev, Vercel Workflows, QStash, AWS Step Functions), but switching away from a pattern already proven in Reelscript would be gratuitous. Inngest's free tier covers this volume.

**The render broker is strong insurance rather than a strict requirement.** Vercel could hold AWS credentials and invoke Remotion Lambda directly from an Inngest step. A thin broker Lambda in front buys four things cheaply:

- **A credential boundary.** Vercel holds one scoped token instead of AWS keys carrying `lambda:InvokeFunction` and S3 write permissions.
- **Version decoupling**, which matters most given the shared account. The broker owns which function version, site, memory setting and concurrency cap a render uses, so upgrading Remotion never requires redeploying the web app, and never drags Reelscript along.
- **Payload discipline.** A 25-minute timeline with 60-plus slots is a large JSON object. The broker writes it to S3 and passes a pointer, keeping invoke payloads small and the timeline independently inspectable and re-renderable.
- **A webhook landing pad.** It verifies Remotion's webhook signature and normalises success, error and timeout into a single Inngest event, so the workflow layer stays provider-agnostic.

**Verdict: reuse both.** One caveat on the broker: reuse the infrastructure and pattern, but fork the handler if Reelscript's version encodes a Reelscript-specific composition contract. The broker should speak Boom-Busters's timeline schema, not Reelscript's.

**External APIs:** Anthropic (scripts, shot lists, self-checks, analytics digests), Google Gemini TTS (narration, batch API; ElevenLabs optional behind the provider abstraction), fal.ai (Flux; Veo optional), Pexels, Pixabay, YouTube Data + Analytics (OAuth, offline refresh token). Thumbnails are made in Canva outside the app; no thumbnail-generation API.

**Key data model:** `BrandKit(typography, colours, look, voice, music)` + `Case → Project → Dossier(Claims[source,confidence]) → Script(Chapters, Edits[]) → VoiceTake(chunks) → ShotList(Slots[type, description, motion, duration, dataRef, candidates[], chosenAsset]) → Timeline → Render → Short[] → PublishRecord → AnalyticsSnapshot[]`. Claims link forward into script sentences and chart slots reference dossier claims by ID (traceability is the compliance story; charts can never show unsourced numbers).

**Security/ops:** single-user auth (passkey or Google), API keys server-side only, per-provider monthly budget caps with kill switch, job retries with dead-letter queue, render artefacts retained 90 days.

---

# 4. Development plan

Assumes you build with Claude Code doing the heavy lifting; estimates are your review-and-steer hours, alongside running the channel manually per the interim workflow.

**Phase 0 (Week 1): unblockers.** Google Cloud project + OAuth consent + YouTube API audit application (the long pole). Channel, voice audition and Brand Kit. Repo scaffold: Next.js on Vercel, Postgres, R2, and Inngest wired up on the Reelscript pattern. Deploy the Boom-Busters Remotion function and site into the existing Reelscript AWS account (separate prefix, tags, concurrency cap), and fork the render broker to speak the Boom-Busters timeline schema. *~8-10 hrs.*

**Phase 1 (Weeks 2-4): the writing room (MVP).** Case Library, Research Dossier (with source register + confidence flags), Script Studio (outline → chapters → self-check → editor with regenerate-per-section), style-bible management, and the **Settings module: model routing + Brand Kit** (typography, colours, narration voice). Voice pipeline with chunked Gemini TTS generation (batch API) and per-paragraph retakes, ElevenLabs selectable behind the same interface. *Deliverable: dossier-to-approved-audio inside the app; visuals still manual. ~25-30 hrs. This alone cuts ~40% of production time.*

**Phase 2 (Weeks 5-8): the picture department.** Shot list generation with full creative briefs, Pexels/Pixabay/archival/Flux fetching with candidate scoring and the filmstrip review UI, Remotion composition library (Ken Burns, lower thirds, chapter cards, charts, maps) built on Brand Kit tokens, Whisper.cpp alignment with the snap-to-script step, timeline compiler, `@remotion/player` preview at the gates, `renderMediaOnLambda` integration and the media-utils Lambda for transcription, QC, loudnorm and upload. *Deliverable: approved script renders to a finished 1080p master in the cloud. ~35-40 hrs.*

**Phase 3 (Weeks 9-11): Shorts + publish.** Shorts Factory (9:16 re-render, karaoke captions, loop/CTA endings), metadata studio, thumbnail lane, YouTube upload/scheduling, publish calendar. *~20-25 hrs.*

**Phase 4 (Week 12+): the feedback loop.** Analytics pulls, retention-vs-chapter overlay, weekly Claude digest, cost dashboard. Then quality upgrades in priority order: DepthFlow parallax, Veo hero shots, podcast-feed export, second-channel (sleep history) preset reusing the whole pipeline. *~15 hrs + ongoing.*

**Total to full pipeline: roughly 100-120 steered hours over ~3 months**, while the channel publishes from week 2 using the interim workflow. If you want output faster at the cost of polish, Phase 1 + CapCut assembly is a workable plateau.

---

# 5. Costs, risks, mitigations

**Run-rate (8-9 long-form + ~18 Shorts/month), lean cloud configuration:** Claude API with Opus/Sonnet/Haiku routing, batch + caching $5-15 · Gemini TTS $3-6 · visuals free (archival + Pexels/Pixabay + native Remotion charts) · music free (YouTube Audio Library) · **Remotion Lambda renders ~$3-5** (~$0.25 per master plus Shorts) · **S3 storage + egress to YouTube ~$2-3** · alignment in-house via Whisper.cpp ~$0 · Vercel Hobby/Pro $0-20 · Postgres and R2 free tiers $0 → **~$15-50/month**, marginal cost per video roughly $1.50-4.

Moving rendering off a local PC and into the existing Lambda deployment therefore costs about **$5-10/month more** than the local-render plan, and buys back the ability to run the whole pipeline from a phone, no machine left switched on overnight, and renders that finish in minutes instead of tens of minutes.

**Milestone upgrades (spend follows revenue, capped at 20% of trailing-month revenue):** at YPP acceptance, premium voice if the audition justified it (+$22-99) · at first $500 month, Flux/Ideogram stills and a music subscription (+$25-40) · at first $1,500 month, Veo hero B-roll and a render VPS (+$70-100). Full configuration lands around $150-280/month, by which point it is a single-digit percentage of revenue.

| Risk | Mitigation |
|---|---|
| YouTube API audit delayed/denied | Pipeline works fully with manual publish (one click in Studio); audit only automates the last step |
| TTS cost creep or provider quality drift | Provider abstraction with per-job cost logging; Gemini default at ~$0.90-1.80/hr, ElevenLabs/Inworld one config switch away |
| Inauthentic-content enforcement | Human-edit records, source registers, per-video structural variation are first-class app features, not afterthoughts |
| Defamation | Dossier confidence flags + adjudicated-sources rule + "alleged" linting in the script self-check |
| Render infrastructure | Renders are stateless Lambda invocations with no box to keep alive; the deterministic timeline JSON makes any render reproducible and re-runnable; QC pass catches glitch-tier failures before upload |
| Multi-hour renders (future sleep channel) | Lambda suits 20-40 min; swap the deployment target to Fargate/EC2 for multi-hour output, reusing the same compositions |
| Remotion version coupling with Reelscript | Separate function + site per project (zero cost at rest); the render broker owns version selection so the web app never redeploys for a Remotion upgrade |
| Late-stage pipeline failure re-running expensive steps | Inngest step memoisation replays completed steps from cache, so a failure at render never re-pays for research or TTS |
| Key-person bottleneck (you) | Gates are async and mobile-friendly (approve a script from your phone); target ≤2 hrs of gate time per video |

---

# 6. Build order summary (what to do Monday)

1. Apply for the YouTube API compliance audit (longest lead time, zero dependencies).
2. Lock the channel name, run the voice audition (Gemini TTS voices first, ElevenLabs only if it clearly wins) and lock the narration voice, define the Brand Kit and style bible.
3. Produce video #1 with the interim manual workflow (validates niche and format before a line of code).
4. Scaffold the repo and start Phase 1 with Claude Code.
5. Keep publishing 2 long-form + 4-5 Shorts weekly throughout; the app earns its keep by week 6.
