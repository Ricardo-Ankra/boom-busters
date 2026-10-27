# Multiple channels: one console, several YouTube channels (design)

Date: 2026-10-27. Status: DRAFT v2, the owner's answers folded in (section
9), awaiting approval. Decisions continue PROGRESS.md from the next free
number at merge (322 was the last on master when this was written).

## 1. What the owner asked for

"We are ready to move to the stage where we can create multiple channels.
Everything stays the same as it is now. There's just the ability to create a
new channel where all the settings etc. is different."

On the first draft's questions the owner answered (2026-10-27): the next
channel is on **Psychology**; how each channel is configured "needs to be
done in a Settings section, even if it's with the assistance of AI to help
build the channel's bible"; provider API keys are shared; the music library
is shared and logos are per channel; the address scheme is whichever is
best practice; the monthly budget is per workspace.

Psychology is a different genre from corporate collapse, so "different
settings" is not enough: the current channel's subject is written into the
prompts (section 2), and a channel needs its own **bible**, edited in
Settings and drafted with AI help, before its first film. That makes stage
B (section 4.8) part of the deliverable, not a later option.

## 2. What the code assumes today (the review)

Every fact below was checked against the working tree on 2026-10-27.

**One settings row.** `settings` has one row with id `'singleton'`
(packages/db/src/schema.ts:223). There is no CHECK constraint; single-row
behaviour is the constant `SETTINGS_ID` in packages/db/src/queries.ts:19.
`getSettings(db)` and `updateSettings(db, patch)` take no scope. There are
44 shipped call sites (40 reads, 4 writes) plus 7 in scripts and e2e. The
readers split cleanly by what they want:

| Settings section | Read by |
|---|---|
| `modelRouting`, `fallbackChain`, `modelPrices` | `lib/llm.ts`, `lib/visual-assets.ts`, `lib/set-sheet.ts`, `lib/model-catalogue.ts`, the Models tab |
| `tts` | `lib/tts.ts`, voice-runner, voice-retaker, voice review, auditions, the first-run checklist |
| `budgets` | `packages/cost` guard, the console layout, Costs, the budget gate |
| `render` | draft-runner, render-runner, short-render-runner |
| `publish` | publish-runner (daily budget), Calendar, publish review, Publish now |
| `brandKit` | assembly-runner (timeline snapshot), social card layout, project page, Logos tab, previews |
| `features` | nothing outside the schema |

**One YouTube connection.** The refresh token is the `provider_credentials`
row where `provider = 'youtube'`, and that table is unique on `provider`
(schema.ts:244). The YouTube channel id is never stored or even requested:
`pingChannel` asks for `part=snippet` and parses only the title
(apps/web/lib/youtube.ts:248 to 268), and the callback keeps nothing of it
(apps/web/app/api/youtube/callback/route.ts:68). Decision 228 records that
the Google account owns two channels and the consent screen once picked
the wrong one; today the app cannot tell.

**The settings row is created lazily.** `getSettings` inserts
`DEFAULT_SETTINGS` on first read (queries.ts:30 to 39); `seed.ts:33` only
calls it. A database that has never served a request has no row, which
the migration in 4.9 must allow for.

**No channel column anywhere.** `cases` and `projects` have none. Everything
below a project cascades from `projectId`, so the project tree is already
scoped once the project is. The rows that are NOT under a project:
`publish_records` (polymorphic `targetId`), `cost_ledger` (nullable
`projectId`), `runs` (nullable `projectId`, used by the analytics cron),
`analytics_snapshots` (keyed by video), `assets` (music and logos are
"channel-wide by design", logos.ts:10), `voice_auditions`, `notices` for
cases, and the global web caches `article_sources`, `social_posts`,
`research_documents`, `model_catalogue`.

**Unscoped list queries** that a channel would have to filter (file:line
from the inventory): `listCases` cases.ts:73, `countCases` queries.ts:177,
`existingCaseTitles` cases.ts:215, `createSuggestedCases` cases.ts:143,
`listProjects` projects.ts:154, `listProjectsAwaitingReview` projects.ts:164,
`listLogos` logos.ts:17, `findLogoByName` logos.ts:115, `logoByR2Key`
logos.ts:123, `scheduledPublishItems` publish.ts:143, `videoBackedRecords`
publish.ts:194, `countUploadsSince` publish.ts:219, `listActiveRuns`
runs.ts:251, `listFailedRuns` runs.ts:308, `listOpenBudgetGates`
runs.ts:366, `listActivity` runs.ts:199, `globalPulse` pulse.ts:36,
`monthSpendUsd`/`monthSpendByProvider`/`monthTotalUsd`/
`monthSpendByProject`/`listLedger` in packages/cost/src/ledger.ts,
`snapshotsSince` analytics.ts:80, `listCredentials` queries.ts:81. The music
queries (`listMusicBeds` music.ts:13, `countMusicBeds` queries.ts:172,
`musicBedByR2Key` music.ts:87) stay unscoped: the library is shared.

**The budget guard is global.** `reserve()` takes one advisory lock and
compares `monthTotalUsd` over every ledger row against the one ceiling
(packages/cost/src/guard.ts:105 to 151). `grantOverage` writes the one
settings row (apps/web/inngest/lib/gates.ts:201).

**Inngest.** 23 functions; every stage and side-job function is keyed on
`projectId` or a row under it. Three global concurrency caps: analytics 1,
publish 1, short-render 2. Every event payload is project-shaped except
`analytics/refresh.requested`. The analytics cron mints the one token,
reconciles every `publish_records` row and snapshots every live video; the
weekly digest reads everything. Settings are read inside steps, so the
value is memoised per step.

**Storage.** `apps/web/lib/storage.ts` builds every R2 key under
`boom-busters/`. Voice, stills, cast, sets, uploads, timelines and thumbs
are under a project id. Music, logos and stock are keyed by content hash
alone. `assets.content_hash` is globally unique (schema.ts:724) and
`upsertAssetByHash` conflicts on it (visuals.ts:734). The broker,
media-utils and compositions read no settings; they consume the timeline's
`brand` snapshot only.

**The channel's subject is code, not data.** "corporate collapses, frauds,
meltdowns and turnarounds" or a close variant opens the system prompt in
packages/providers/src/prompts: cases.ts:43, subject.ts:22, dossier.ts:59,
script.ts:101, shotlist.ts:310, direction.ts:99, digest.ts:47,
graphics.ts:324, and metadata.ts:76 and :177 name "Boom & Busters" outright.
The case suggester also carries this channel's definition of a good case
("a documented paper trail: court filings, regulator actions, major-outlet
reporting", cases.ts:46) and tells the model that `subject` is "the
company's common name as Wikipedia titles it" (cases.ts:55, subject.ts:28).
The case category enum `collapse|con|meltdown|turnaround|empire` is this
channel's taxonomy. In compositions, EndCta.tsx:61 and Watermark.tsx:67 set
"Boom & Busters" as the fallback wordmark; `DEFAULT_CTA_TEXT` in
packages/timeline/src/short.ts:40 is "The full story is on the channel".
The rail header reads "Boom-Busters" (app-rail.tsx:70) and app/layout.tsx:21
describes the console as being for that channel.

**The two house bibles are mostly craft, not genre.** script-craft.md (98
lines) and direction-craft.md (260 lines) ship as embedded constants
(`SCRIPT_CRAFT`, `DIRECTION_CRAFT`; a unit test holds file and constant
identical, decision 216). Read line by line, their rules (stakes before
context, one home per fact, the question engine, shot grammar, what a still
prompt contains, the People rules, pre-flight) hold for any documentary
about real people and dated events. What is this channel's: the one
"Register: the Netflix money documentary" bullet (direction-craft.md:11), and
the worked examples ("Thirty thousand pensions", "The auditors signed. The
money was not there.", "Financial pressure on the business and
disagreements inside the boardroom"). The prompts' HOUSE_STYLE voice rules
in script.ts:105 to 130 (no rhetorical questions, banned words, asymmetric
contrasts) are likewise craft.

**Research sources tolerate a subject with no filings.** The dossier
discovery (apps/web/inngest/lib/dossier-discover.ts:318 to 325, 445 to 453)
only asks EDGAR, XBRL and Stooq when the entity has a CIK or a ticker.
A psychology case, a study or a person, gathers from Wikipedia, Wikidata,
CourtListener, the Wayback Machine and the open web as a private company
does today. No source change is needed for the second channel.

**Single owner.** Auth allows one email; notifications go to `OWNER_EMAIL`
by email only. Neither changes: a channel is a production, not a tenant.

**Tests.** e2e/global-setup.ts rewrites the single settings row (lines 1323
to 1344) and `e2e/tests/fixtures.ts:109` patches it again; every spec
assumes the console routes have no channel segment. Seed creates the row
from defaults.

## 3. Goals, non-goals, anti-goals

Goals:

- Create a channel from the console, with its own name, handle, bible,
  settings (brand kit, voice, model routing, render, publish defaults),
  YouTube connection, logo library, case library and projects.
- Configure every channel, the first one included, in a Settings section:
  a **Channel** tab holds the bible, with a **Draft with AI** button that
  writes a first version from a few lines the owner types, for the owner
  to edit and save.
- Switch between channels from the top bar; every screen reads as that
  channel's screen; nothing from another channel leaks into a list, a
  calendar, a cost meter, a prompt or a render.
- The existing channel, its rows, its storage keys, its parked runs and
  every prompt it sends carry on unchanged, as the first channel.
- The Psychology channel produces a film end to end, in its own subject,
  taxonomy, register and wordmark, once both stages are merged.

Non-goals:

- Multi-user, roles, per-channel owners. One owner, one email, as before.
- Moving a case or project between channels.
- Cross-channel reuse of shots, cast or sets. The web caches
  (`article_sources`, `social_posts`, `research_documents`) stay shared
  because they are facts about the web, not channel property.
- A different Google account or OAuth client per channel. One client;
  each channel's consent picks its own YouTube channel.
- Renaming the repo, the Inngest app id, the R2 prefix or the CDK stacks.
  `boom-busters` is the console's name (spec section 3); the first channel
  happens to share it.
- Per-channel craft bibles. The narrative and visual craft stays code,
  shared by every channel; a channel adds its own rules on top (4.8).
- New research sources for psychology (PubMed, PsycINFO). The current
  sources find a study or a person through Wikipedia, Wikidata and the open
  web; a journal source is a later decision if the first dossiers are thin.

Anti-goals (a failure even if it works):

- A channel-scoped screen that shows another channel's rows under any
  filter or sort.
- A run that reads another channel's settings or bible because a cookie or
  a "current channel" variable said so. The channel of a run is derived
  from its project row, never from UI state.
- A parked run (a gate wait of up to 30 days) that crashes on resume
  because a memoised step output predates the channel column.
- An upload that lands on the wrong YouTube channel without the console
  noticing.
- Deleting or changing any existing row, key or ledger entry during the
  migration beyond adding the channel reference.
- Any prompt the first channel sends changing by one character because the
  bible moved from code to data. The snapshot tests in section 10 hold this.
- An AI-drafted bible saving itself. The draft fills the form; only Save
  writes.

## 4. The design

### 4.1 Two layers: workspace and channel

Everything in the console becomes one of two kinds:

- **Workspace**: facts about providers and the owner, and what the owner
  said can be shared. Provider API keys (Anthropic, OpenAI, Gemini,
  ElevenLabs, Pexels, Pixabay, fal), the model catalogue cache, the owner's
  model price overrides, the monthly budget ceiling and its approved
  overage, the voice audition cache, the music library, the web caches,
  auth, the notification address. One of each.
- **Channel**: choices about one channel's films. Name, handle, the bible,
  brand kit, narration voice and phoneme hints, model routing and fallback
  chain, render settings, publish defaults and daily upload pacing, feature
  flags, the YouTube connection, the logo library, cases, projects and
  everything under them, the ledger rows (attributed, not capped, per
  channel), runs, publish records and analytics.

The rule for anything new: if two channels could reasonably want different
answers, it is channel; if the answer is the same whoever asks, it is
workspace.

### 4.2 Schema

New table `channels`:

| Column | Notes |
|---|---|
| `id` ulid | |
| `slug` text unique | URL segment; kebab-case; set at creation, never changed |
| `name` text | "Boom & Busters" |
| `handle` text nullable | "@BoomAndBusters", display and prompts |
| `bible` jsonb | `ChannelBibleSchema` (4.8); stage A stores it, stage B reads it |
| `settings` jsonb | the current `Settings` shape minus `modelPrices` and `budgets` |
| `archivedAt` timestamp nullable | archived channels disappear from the switcher; their rows stay |
| `createdAt`, `updatedAt` | |

New table `workspace`, one row (`id = 'singleton'`), holding `modelPrices`,
`budgets` (the monthly ceiling and its approved overage, the current
`BudgetsSchema`) and `defaultChannelId`. The `settings` table is dropped
once its row has been split between the first channel and this row.

New table `youtube_connections`, one row per channel: `channelId` unique,
`encryptedRefreshToken`, `keyHint`, `youtubeChannelId`,
`youtubeChannelTitle`, `verifyStatus`, `lastVerifiedAt`. The `youtube`
value leaves `providerEnum`'s working set (it stays in the enum so old
ledger rows parse; `listCredentials` already hides retired providers).
Storing the YouTube channel id closes decision 228's hole: the callback
records what `channels.list mine=true` returns, the card shows the title,
and a later verify that returns a different id marks the connection
invalid with the message "the connected YouTube channel changed".

`channel_id` columns, all `references channels(id) on delete restrict`:

| Table | Null? | Backfill from |
|---|---|---|
| `cases` | not null | the first channel |
| `projects` | not null, must equal the case's | the first channel; `createProject` asserts the match |
| `cost_ledger` | nullable | project's channel, else the first channel; null for a workspace-level spend |
| `runs` | nullable | project's channel, else the first channel for cron runs |
| `publish_records` | not null | project or short's project |
| `analytics_snapshots` | not null | the publish record with that video id |
| `assets` | nullable: not null for `logo`, null for `music`, `image` and `video` | the first channel for logos |

`assets_content_hash_key` becomes two partial unique indexes: on
`content_hash` where `channel_id is null` (music, stock and stills keep
deduping across projects and channels), and on `(content_hash, channel_id)`
where `channel_id is not null` (the same logo uploaded to two channels is
two rows, one R2 object). `upsertAssetByHash` (visuals.ts:720) serves only
stills, stock and set plates and keeps targeting the null-channel index.
`insertMusicBed` (music.ts:23) is unchanged. The logo insert (logos.ts:68)
takes the channel and targets the `(content_hash, channel_id)` index.

**The first channel's id is a constant.** `FIRST_CHANNEL_ID`, a fixed
26-character ULID exported from `packages/schemas`, and slug
`boom-busters`. The migration backfills with that literal;
`ensureFirstChannel(db)` in `packages/db` creates the same row from
`DEFAULT_SETTINGS` and `FIRST_CHANNEL_BIBLE` when no channel exists (called
by `seed`, by the console's `/` redirect and by e2e global-setup).
`getChannel(db, channelId)` for any other missing id is an error: only the
first channel is ever created implicitly.

Unchanged: everything keyed under `projects`, `voice_auditions`,
`model_catalogue*`, `provider_credentials` (minus the youtube row),
`article_sources`, `social_posts`, `research_documents`, `notices` (case
notices are reached through the channel's case ids), the music rows.

The `cases.category` enum stays in stage A. Stage B converts it to text
validated against the channel bible's `caseCategories` (section 4.8).

### 4.3 Resolving the channel: data first, URL second, never a cookie

`channelForProject(db, projectId)` returns `{ channelId, settings, bible }`
in one query. It is the only way server code outside a page finds settings:

- Server actions on a project take the project id they already have and
  resolve the channel from it.
- Inngest runners resolve the channel **inside the step that needs it**,
  from the project row, never from an earlier step's memoised output. A
  run parked at a gate since before the deploy resumes into steps written
  after it; those steps must not read `project.channelId` from a
  `load-*` step that ran when the column did not exist (memory: parked
  runs replay old step results). `getChannel(db, channelId)` and
  `channelForProject` are both cheap, so re-reading is the rule.
- Pages and list-level actions take the channel from the URL segment and
  pass `channelId` explicitly into every query and action. No action reads
  a "current channel" cookie; the one cookie is `last-channel`, read only
  by the `/` redirect.
- The YouTube OAuth round trip is the one place a channel id travels
  outside a row or a URL segment: the Connect button on a channel's
  Connections tab starts `/api/youtube/connect?channel=<id>`, which signs
  `{ channelId, nonce }` into the OAuth `state` parameter (HMAC with
  `SECRETS_ENCRYPTION_KEY`) and keeps the nonce in the existing httpOnly
  cookie. The callback verifies the signature and the nonce, writes that
  channel's `youtube_connections` row, and redirects to that channel's
  Connections tab. That is an explicit argument carried through a redirect,
  not ambient state, so it does not break the rule above. One registered
  redirect URI and one client, as before. `pingChannel` requests
  `part=id,snippet` and returns the id with the title.
- Every link the app sends carries the channel. `notify()` takes the
  channel slug and prefixes its `href`; the runners that send non-project
  links already hold the project or the channel (analytics-runner.ts:108,
  141, 162, 316; publish-runner.ts:322; gates.ts:181). `buildChecklist`
  (lib/first-run.ts) takes the slug for its links. A reconnect card or a
  budget gate raised for channel B must land on channel B's screen.

`getSettings(db)` and `updateSettings(db, patch)` are deleted, not kept as
aliases, so the typechecker finds all 51 call sites. `callLlm` (lib/llm.ts)
takes `channelId` in its options, required: routing and the fallback chain
are the channel's, prices are the workspace's.

### 4.4 Routes and shell

Channel-level screens move under a channel segment. The owner left the
address scheme to best practice; the practice for one console with several
productions is the address names the production (as GitHub names the
repository and Vercel the project), so a link, a bookmark or a notification
is unambiguous and a reload cannot land on the wrong channel.

| Today | After |
|---|---|
| `/` | `/c/[slug]` (dashboard); `/` redirects to the last-used or default channel |
| `/projects` | `/c/[slug]/projects` |
| `/cases` | `/c/[slug]/cases` |
| `/calendar` | `/c/[slug]/calendar` |
| `/costs` | `/c/[slug]/costs` |
| `/settings` | `/c/[slug]/settings` plus a workspace-level `/settings` for Connections (provider keys), Models' price table and Music |
| `/projects/[id]` | unchanged; the project knows its channel |

The project page stays unprefixed because most deep links the app sends
(gate cards, failure cards, stage emails) are project links, and those
must not change. The non-project links (reconnect, budget gate, first-run,
the OAuth return) are prefixed per 4.3. Old bookmarks to the five list
routes redirect to the default channel's equivalent.

The console layout gets the channel from the segment or from the project
and renders: the channel's name in the rail header (the app name moves to
the sign-in and privacy pages), the rail links prefixed, the cost meter
for that channel, and a **Channel** button in the top bar that opens a
list of channels with each one's open Needs-you count and a **New
channel** button at the foot. Choosing a channel goes to the same screen
in that channel, or to its dashboard from a project page. Buttons,
labelled, 40 px, no shortcut (spec section 11.1).

### 4.5 Creating and archiving a channel

**New channel** is a short form: name, handle, slug (prefilled from the
name, editable until saved), and "Start from" with two choices: house
defaults, or copy settings from an existing channel (brand kit, voice and
hints, routing, render, publish slots; never the bible, the YouTube
connection or the logos). Create lands on the new
channel's Settings, Channel tab, because the bible is the next thing it
needs. The first-run strip on its dashboard (lib/first-run.ts, channel
inputs) lists, in order: **Write the channel bible**, choose a narration
voice, add cases, add at least 3 music beds (workspace, satisfied at once
when the shared library has them), connect YouTube.

**Until the bible is complete** (4.8 says which fields), the channel's
**Suggest cases** and **New project** buttons are disabled with the notice
"Complete the channel bible in Settings first" and a link to the tab. A
stage runner that finds an incomplete bible on resolve fails the run with
the same message rather than sending a prompt with blanks. The first
channel's bible is complete from the migration, so nothing there changes.

**Archive** sits in the Channel tab behind a typed confirm of the slug.
Archiving refuses while the channel has a live run, a parked gate or a
scheduled publish. It hides the channel from the switcher; rows, keys,
ledger and analytics stay, and `/c/[slug]` still opens read-only with an
"Archived" banner. There is no delete.

### 4.6 Settings per channel

`SettingsSchema` loses `modelPrices` and `budgets` (both to
`WorkspaceSettingsSchema`) and otherwise keeps its shape, so `mergeSettings`, `normaliseSettings`,
`patchSection` and the whole Settings form survive with a `channelId`
threaded through `saveSettings` and `commit`. The tabs stay as they are
within `/c/[slug]/settings`, with three moves: Connections' provider-key
cards, the Models tab's price table and the Music tab go to the workspace
`/settings`; the YouTube card stays on the channel's Connections tab. A
**Channel** tab is added, first in the row: name, handle, the bible with
its Draft with AI button and a read-only "What the models are told"
preview, and archive. Settings deep links in the app (`?tab=voice`,
`?tab=music`, `?tab=connections`) are checked one by one: music goes to
the workspace page.

`loadModelOptions` and `stillCatalogue` take `{ routing, prices }` instead
of the whole settings object; prices come from the workspace row.

### 4.7 Budgets, costs, publishing, analytics, libraries

- **Budget**: one ceiling and one approved overage for the workspace
  (owner's answer). `reserve()` is unchanged: one advisory lock, the month's
  total over every ledger row against the workspace ceiling, read from the
  workspace row instead of the settings row. `grantOverage` and
  `approveOverage` write the workspace row. The budget gate stays as it
  is: a run on any channel parks when the workspace total reaches the
  ceiling, and its card and email link to that run's project. `withCost`
  and `reserve` take `channelId` in the `CostSpec` for attribution only;
  every ledger row gets one, null only for a workspace spend (today there
  is none; the bible draft is charged to its channel). The top-bar meter
  is the workspace total against the workspace ceiling on every screen,
  as today. The channel's Costs screen shows that meter and the ceiling
  editor at the top (the editor writes the workspace row), then the
  channel's own month by provider and by project, with a one-line "other
  channels this month" total under it so the two numbers reconcile.
- **Publishing**: `countUploadsSince` counts the channel's records against
  the channel's `dailyUploadBudget`. The real quota is per OAuth client
  and shared; at the current cost of `videos.insert` (about 100 units,
  decision 302) the sum of two pacings does not approach it, and the
  global publish concurrency of 1 stays. Calendar slots are the channel's.
- **Analytics**: the cron loops over channels that hold a connection:
  per channel, mint the token, ping, reconcile, snapshot each live video
  under step ids `snapshot-${channelId}-${videoId}`, and on Mondays write
  that channel's digest. `analytics/refresh.requested` gains `channelId`.
  A dead token marks that channel's connection and raises that channel's
  reconnect card. The cron's own `runs` row has a null `channel_id` and
  shows in every channel's Activity list and failure cards, because one
  run serves them all; per-channel trouble reaches the channel through
  its reconnect card and its notices, not through the run row.
- **Libraries**: music is shared. `listMusicBeds`, `countMusicBeds` and
  `musicBedByR2Key` are unchanged and the Music tab lives on the workspace
  settings page; a project's bed choice at assembly reads the shared list
  as it does today. Logos are per channel: `listLogos`, `findLogoByName`
  and `logoByR2Key` take `channelId`, the Logos tab stays on the channel's
  settings, and uploads write the channel. R2 keys stay hash-addressed.

### 4.8 Stage B: the channel bible reaches the prompts

Stage A ships the data boundary and a second channel that still writes in
the first channel's register. Stage B makes the register data. Both land
before the Psychology channel's first film; stage A is shippable on its
own because the first channel does not change in either.

**The bible is structured, not a free document.** `ChannelBibleSchema`
holds the sentences the prompts need, one field each, so a prompt can
place each line where today's hard-coded sentence sits, and the owner can
see which field feeds which stage:

| Field | What it replaces | First channel's value (from code) |
|---|---|---|
| `subject` | the opening sentence of cases, subject, dossier, script, shotlist, direction, digest, graphics, metadata | "corporate collapses, frauds, meltdowns and turnarounds" |
| `whatACaseIs` | cases.ts:46 to 49, the good case and the bad case | the paper-trail paragraph as written |
| `subjectKind` | "the company's common name as Wikipedia titles it" (cases.ts:55, subject.ts:28) | that sentence |
| `caseCategories` | the enum | the five keys with labels |
| `audience` | nothing today (the prompts assume it) | "adults who watch long-form money documentaries" |
| `narrationRegister` | the first lines of HOUSE_STYLE's voice paragraph (script.ts:106) | "plain, specific, unhurried" |
| `visualRegister` | direction-craft.md:11, the Register bullet | "the Netflix money documentary. Dark, patient, photographic realism..." |
| `titleStyle` | metadata.ts:77 | "Sober, specific, curiosity-driven" |
| `ctaLine` | `DEFAULT_CTA_TEXT` | "The full story is on the channel" |
| `scriptRulesMd` optional | nothing | empty |
| `directionRulesMd` optional | nothing | empty |

Complete means every non-optional field non-empty and at least two
categories. The two optional markdown fields are the channel's own rules,
appended after the shared craft bible in the script and shotlist prompts
under a heading "This channel's rules"; the shared craft stays code and
keeps its decision 216 embed test. The first channel's bible is the
constant `FIRST_CHANNEL_BIBLE` in `packages/schemas`, and the prompt
snapshot tests (section 10) prove that composing today's prompts from it
yields today's text.

**Prompts take the bible.** Every builder in packages/providers/src/prompts
that names the subject gains a `bible: ChannelBible` input and composes
its opening from it. The worked examples inside the craft bibles stay as
they are: an example is an example, and "Thirty thousand pensions" teaches
concreteness to a psychology script as well as a finance one.

**Draft with AI.** The Channel tab's **Draft with AI** button opens a card
with one text area, "Describe the channel in a few lines", prefilled with
the name and handle, and a **Draft** button. The action calls `callLlm`
with a new task `bible` (added to `LLM_TASKS` and `ModelRoutingSchema`,
defaulting to the scripting tier), charged to the channel with no project,
inside the workspace ceiling and visible on its Costs screen. The prompt
gives the model the schema, the field descriptions above, the owner's lines
and `FIRST_CHANNEL_BIBLE` as a worked example of the shape and the level of
detail, and asks for JSON. The answer fills the form fields, each marked
"drafted" until edited, and nothing is saved until the owner presses
**Save**. Draft again replaces the unsaved fields. In mock-provider mode
the adapter returns a fixed psychology bible, so e2e can build the second
channel through the form.

**What the models are told.** Under the fields, a read-only card renders
the composed channel header exactly as the script prompt will receive it
(subject, audience, register, categories), so the owner reads what the
models read before saving.

**Categories become data.** `cases.category` becomes text, validated at
the action against the channel bible's `caseCategories`; `caseCategoryLabel`
takes the bible; the suggester's JSON shape lists the channel's keys; the
Cases screen's filter reads the bible. The first channel's list is the five
current values, so no row changes.

**Identity reaches the render.** `BrandKitTokensSchema` gains optional
`identity: { name, handle }`, snapshotted into the timeline by
`resolveBrandKit(settings, channel)`. `EndCta` and `Watermark` draw
`brand.identity?.name` and keep "Boom & Busters" as the fallback for
timelines compiled before the field. The Short CTA takes the channel's
`ctaLine`. This is a timeline schema change: Zod strips unknown keys, so
the broker would drop `identity` when it writes the materialised copy until
`deploy:stacks boom-busters-broker` runs, and the render bundle needs
`deploy:remotion` (memories: timeline schema changes need a broker
redeploy; compositions ship only with deploy:remotion).

**Semantic colours keep their keys.** `brandKit.colors.semantic` stays
`{ collapse, recovery }` in the schema; the Brand Kit tab labels them
"loss" and "recovery", which is what the graphics prompt already says they
mean (graphics.ts:454). Renaming the keys would touch every stored brand
kit and timeline for no behaviour.

### 4.9 Migration and rollout

Migration 0037, forward only, in one transaction:

1. Create `channels`, `workspace`, `youtube_connections`.
2. If a `settings` row exists: insert the first channel with
   `FIRST_CHANNEL_ID`, slug `boom-busters`, name "Boom & Busters", handle
   "@BoomAndBusters", `settings` = the row's value minus `modelPrices` and
   `budgets` (`jsonb - 'modelPrices' - 'budgets'`), `bible` =
   `FIRST_CHANNEL_BIBLE` as a JSON literal in the migration file; insert
   the workspace row with the row's `modelPrices`, its `budgets` and
   `defaultChannelId`. If no row exists (a fresh
   database), the migration inserts nothing here and `ensureFirstChannel`
   creates the row at first use. Steps 4 and 5 backfill with the literal
   id either way; on a fresh database there is nothing to backfill.
3. Copy the youtube credential row, if any, into `youtube_connections`
   with `youtubeChannelId` null (the next verify fills it) and the same
   `verifyStatus`.
4. Add every `channel_id` column nullable, backfill per the table in 4.2,
   then set NOT NULL where the table says so. Replace the assets unique
   index with the two partial indexes.
5. Delete the youtube row from `provider_credentials`. Drop `settings`.

Stage B's migration (0038) converts `cases.category` from the enum to text
with a CHECK that it is non-empty; validation against the bible lives in
the action, because a CHECK cannot read jsonb from another table cheaply.

Before applying to production: a Neon branch or snapshot of the database,
then `pnpm db:migrate` against the branch and the row counts checked
(every case, project, ledger row, run, publish record, snapshot and logo
now carries the first channel; every music row carries none). Only then
production.

After deploy: `PUT /api/inngest` (new analytics step ids and event shape).
No CDK deploy in stage A: the timeline, the broker and media-utils are
unchanged. Stage B carries the broker and Remotion deploys.

Parked runs at deploy time (a dossier, script, voice, visuals or preview
gate waiting on an owner) resume safely because of 4.3: no step written
after the deploy reads the channel from an old step's output.

## 5. Left to the builder

- The exact split of `apps/web/app/(console)` into `c/[slug]/...` and the
  workspace `settings`, and whether the layout reads the slug through a
  parallel route or a small `channel-context` helper called from each page.
- Whether `channelForProject` joins `channels` or reads `projects.channel_id`
  then the channel; either is one round trip in practice.
- The partial index SQL in Drizzle (`uniqueIndex(...).where(...)`) or a
  hand-written statement in the migration file.
- The switcher's count query (open gates, failed runs, budget gates and
  reconnect per channel) and its caching; it renders in the layout.
- The redirect map for the five old list routes.
- The e2e helper that prefixes paths, and how global-setup names the two
  fixture channels.
- The exact wording of the bible-draft prompt and the mock psychology
  bible; the test only requires that the draft parses and that the first
  channel's example is in the prompt.
- Whether the "drafted" marking on a field is a badge or a tint.
- The order of prompt lines where a builder today interleaves the subject
  with other rules (script.ts HOUSE_STYLE, dossier.ts HOUSE_RULES): the
  constraint is the snapshot test, not a layout.

## 6. Mock providers

Unchanged for the pipeline. `MOCK_PROVIDERS=1` already bypasses YouTube.
The mock LLM adapter answers the new `bible` task with a fixed psychology
bible. In e2e the first channel keeps the whole existing fixture tree and
gains a mock `youtube_connections` row with `verifyStatus = 'ok'`, so every
existing spec, publish included, runs as it does today under the prefix.
The second fixture channel is empty with no connection and no bible: that
is where the first-run strip, the disabled Suggest cases button, the draft
flow, the reconnect card and the isolation assertions are made.

## 7. Out of scope (deliberately)

- A cross-channel "Needs you" home. The switcher's per-channel counts cover
  "did I miss something"; a merged queue is a later decision.
- Moving cases or projects between channels.
- Per-channel provider API keys. The workspace holds one key per provider;
  a per-channel override can be added later as a nullable `channel_id` on
  `provider_credentials` without touching this design.
- Per-channel music. The library is shared (owner's answer); a per-channel
  "preferred beds" filter can be added later as a bible field.
- Per-channel craft bibles (a different script-craft.md per channel). The
  optional rules fields cover a channel's additions; replacing the craft is
  a later decision if a genre ever needs it.
- Journal sources for psychology research. See non-goals.
- Per-channel notification addresses.

## 8. Calls made without the owner (reversible, say so if wrong)

1. Channel is resolved from data (project row) or the URL, never a cookie.
2. The project page keeps its unprefixed route so every existing deep link
   survives; channel list screens live under `/c/<slug>/`.
3. `settings` becomes `channels.settings`; the `settings` table is dropped
   rather than re-keyed, so a table named "settings" cannot be read
   without a channel by accident.
4. `modelPrices` moves to a workspace row rather than being copied per
   channel, because a price entered once must apply to every channel.
5. The YouTube connection gets its own table and stores the YouTube
   channel id.
6. The budget is the workspace's (owner's answer). The guard, the gate and
   the top-bar meter keep today's behaviour; the ledger rows gain a
   channel for attribution, and the ceiling editor on a channel's Costs
   screen writes the one workspace number.
7. Stock and generated stills keep one global dedupe; with music now
   shared, only logos are per channel.
8. Archive, not delete.
9. Stage A and stage B are separate branches and separate decisions, both
   merged before the Psychology channel's first film.
10. The first channel has a constant id and is the only channel ever
    created implicitly; the migration converts an existing settings row
    and leaves a fresh database to `ensureFirstChannel`.
11. The OAuth state carries the channel id, signed; every notification and
    first-run link carries the channel slug.
12. The analytics cron's run row belongs to no channel and shows in all.
13. E2E keeps the fixture tree on the first channel; the second is empty.
14. The bible is a set of named fields that map one to one onto the
    sentences the prompts hard-code today, not a free document, so a
    change to one field has one known effect and the first channel's
    prompts can be proven unchanged.
15. The craft bibles stay shared code; a channel adds rules, it does not
    replace them.
16. The AI draft runs as an LLM task `bible` on the channel's routing,
    charged to the channel, and never saves; the owner edits and presses
    Save.
17. A channel with an incomplete bible cannot suggest cases or start a
    project; the buttons say why.
18. The Music tab moves to the workspace settings page because the library
    is shared.
19. The semantic colour keys `collapse` and `recovery` keep their names and
    get the labels "loss" and "recovery" in the Brand Kit tab.
20. Research sources are unchanged: the discovery already skips the
    finance-only sources for a subject with no filings or ticker.

## 9. The owner's answers (2026-10-27)

1. The next channel is Psychology. Stage B is required before its first
   film, and the bible is configured in a Settings section with AI help.
2. Provider API keys are shared across channels.
3. Monthly budget: per workspace, one ceiling for every channel.
4. Music is shared; logos are per channel.
5. Address scheme: best practice, which this design takes as the channel
   slug in the URL (4.4).

## 10. Tests

Unit (Vitest):

- `channels.ts` query helpers: create, list, archive refusal rules,
  `channelForProject`, `getChannel` creating nothing (a missing channel is
  an error, never a default), `ensureFirstChannel` idempotent.
- Migration 0037 is verified on a Neon branch of production (4.9), not by
  an integration test: the Drizzle migrator applies every pending
  migration in one call and one transaction, so a test cannot stop at
  0036, insert old-shape rows and continue, and a second test database
  for that alone is not worth it. What is tested: after a full migrate on
  an empty database the new tables exist, `ensureFirstChannel` creates the
  first channel once and is idempotent, and `db.integration.test.ts` no
  longer selects from `settings`.
- Assets: the same hash as a logo on two channels is two rows; the same
  hash as music twice, or as stock twice, is one row.
- Cost guard: two channels, one ceiling; spend on both counts towards it
  and a run on either channel parks at the same total, as today; the
  overage lands on the workspace row; a bible draft is charged to its
  channel with a null project; `monthSpendByProject` on channel B never
  lists channel A's projects.
- Publish: `countUploadsSince` per channel; the daily budget of one channel
  does not sleep the other.
- `SettingsSchema` without `modelPrices`; `WorkspaceSettingsSchema`;
  `ChannelBibleSchema` and its completeness rule; an old settings value
  parses into `channels.settings`.
- Every list query in section 2 with two channels seeded, asserting the
  other channel's rows never appear; the music queries return the shared
  rows for both.
- **Prompt snapshots (stage B's regression guard)**: for each of the nine
  builders, the system prompt composed from `FIRST_CHANNEL_BIBLE` equals
  the text shipped before stage B, held as a fixture string. A second case
  composes from a psychology bible and asserts its subject, categories and
  registers appear where the first channel's did and that no finance
  sentence survives.
- `cases.category` validation against the bible: a key the channel does
  not list is refused at the action; the first channel's five keys pass.
- `resolveBrandKit(settings, channel)` snapshots `identity`; a timeline
  without it still renders the fallback wordmark in EndCta and Watermark.
- The bible-draft action: with the mock adapter the draft parses, every
  field is filled, nothing is written to `channels` until save.

Inngest harness:

- analytics-runner with two channels, one connected: one token minted, one
  digest, the other channel untouched and no failure row.
- A stage runner parked before the column existed (simulated by a
  memoised `load-*` output without `channelId`) resumes and resolves the
  channel inside the later step.
- A stage runner on a channel with an incomplete bible fails with the
  "complete the channel bible" message and sends no prompt.
- `inngest/functions/index.test.ts` pins the new analytics step ids and
  the event shape.

Component: the switcher, the New channel form and the Channel tab render
every action as a labelled button at 40 px; the Settings tabs' action
mocks are extended for the Channel tab (memory: a new Settings tab must
add its actions mock to voice-tab.test.tsx); the "What the models are
told" card updates as fields change.

E2E (mock providers): global-setup seeds two channels. A new
`channels.spec.ts`: create a channel through the form, land on its Channel
tab, press Draft with AI and see the fields fill, edit one, Save, see
Suggest cases enabled on its dashboard, switch back, change the brand
accent on channel B and read channel A's unchanged, add a case on B and
read A's library unchanged, open B's calendar and see no A items, the
top-bar meter changes with the channel, the Music tab is reached from the
workspace settings and lists the same beds from both channels. Every
existing spec runs under the channel prefix through the fixture helper.
The 390 px mobile pass covers the switcher and the Channel tab.
