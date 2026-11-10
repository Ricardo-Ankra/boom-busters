# Channel formats and keywords

Date: 2026-11-03. Status: draft for the owner's review. The owner's answers to
the builder check (2026-11-03) are in sections 4.5, 6.3, 6.7, 8 and 9.

## 1. Why

The owner wants each channel's bible to steer the whole production, from case
intake to publish, so a channel's videos are cohesive around the purpose it
serves. The worked example is a history channel found through "history for
sleep" and "ancient history explained": its topics, scripts, lengths, titles,
descriptions and tags should all serve those searches.

The owner's principle (2026-11-03): **the code is the playbook; the bible is the
channel.** Every rule in this design is a channel-agnostic slot in code, and each
channel fills it with its own values. An empty slot turns its rule off. No
channel name, keyword or number appears in code. Every existing channel moves
into the new structure, and every new channel gets it through Draft with AI and
Copy from another channel.

What the code does today:

- The bible's Search section has `keywordContext` (one phrase, 60 characters)
  and `channelTags` (up to 15). Nothing reads either: no prompt, runner or
  publish step (`packages/schemas/src/channels.ts:94-95`).
- Each case's VidIQ search brief (spec 2026-10-28) is seeded with the subject
  alone and feeds the dossier, outline, titles, description and tags. Only its
  angle step reads the channel (the bible's subject and audience); its keywords
  and the later stages have no channel layer.
- Length is per project: `startProjectFromCase` defaults to 15 minutes and
  accepts 3 to 60 (`apps/web/app/(console)/c/[slug]/cases/actions.ts:252`), and
  the only caller passes none (`search-brief-panel.tsx:163`), so every project
  is 15 minutes (the column default is 18, used only by rows inserted without
  the action). Words are minutes × 150 × 0.95, hard-coded
  (`packages/providers/src/prompts/script.ts:226`).
- Minimum on-screen time per shot type is one global constant,
  `MIN_SHOT_SECONDS` (`packages/schemas/src/visuals.ts:698`).
- The outline prompt hard-codes a tension contract: every chapter plants a
  question it must not answer, withholds a fact and raises the stakes; the
  opening glimpses the consequence; the close ends on an open thread
  (`script.ts:263-287`). That suits a documentary and works against a video made
  to fall asleep to.

## 2. Production state (read 2026-11-03, read only, with permission)

- **Boom & Busters**, bible v1, complete. `keywordContext` "documentary",
  `channelTags` empty, five case categories (collapse, con, meltdown,
  turnaround, empire), no drafted titles or hooks, 46 example slots filled.
- **Real Power Pyschology** (name and slug as stored), bible v1 blank and
  incomplete. Its open draft, written 08:28 today, is a copy of Boom & Busters'
  bible with every section `drafted`; nothing in it is psychology yet.
- **No history channel exists yet.** History values in this spec are
  illustrations, not data.
- 7 cases, all Boom & Busters, every one with a category; none has a search
  brief yet. 6 projects, all 15 minutes.

## 3. Goals, non-goals, anti-goals

**Goals**

1. A bible holds one or more **formats**: named sets of production settings
   (keywords, length, pace, intent, shot pacing, title template, intro rule).
   A project runs in one format.
2. A bible's case categories become **pillars** with keywords.
3. Channel publishing fields that code applies to every upload: channel tags,
   a channel hashtag, a channel footer.
4. Case research checks a subject's fit with the channel and measures it with
   the format's keyword.
5. Titles, description, tags and hashtags follow the channel's format and
   pillars, and a **cohesion panel** on the publish screen shows what each field
   hits.
6. Length, narration pace and shot pacing come from the format; the start
   control offers the format's range with an estimated cost.
7. Every existing channel reads into the new structure with its prompts
   unchanged, proved by a snapshot test.

**Non-goals**

- Topic suggestions or any automatic case discovery (spec 2026-10-28 stands).
- YouTube Studio channel description or channel keywords.
- Pillar playlists (the next task).
- Post-publish search traffic per keyword.
- Changing how Shorts are made. They keep today's rules (my call). The one
  exception, added at the owner's request on 2026-11-03, is that a format can
  turn Shorts off altogether (section 6.10).

**Anti-goals** (failure even if it works)

- A channel's name, keyword or number written into code or a prompt template.
- Narration bent toward a keyword, or a keyword repeated for search. The
  existing rule (`script.ts:199`) holds for format and pillar keywords too.
- Figures in titles or descriptions that do not come from claims (decision
  303). A `{runtime}` slot is the video's own measured length, not a claim and
  not a keyword.
- A rule that blocks the owner. Every new check warns; none refuses a save,
  a start or a publish.
- Credits spent without the cost shown first, or past the monthly cap.
- Boom & Busters' composed prompts changing because the structure moved.

## 4. The bible structure

### 4.1 Formats

`formats`: an array, at least one, exactly one marked `primary`.

| Field | Type and range | Empty or default means |
|---|---|---|
| `key` | slug, unique in the bible | (required) |
| `name` | 1 to 40 characters, shown in the UI | (required) |
| `primary` | boolean | exactly one true |
| `keywords` | up to 6 phrases, 60 characters each, ordered | no format keyword rules |
| `intent` | `tension` or `calm` | `tension` (today's outline) |
| `runtime` | `{ default, min, max }` minutes, `3 ≤ min ≤ default ≤ max ≤ 180` | 15, 3, 30 (the start limit) |
| `wordsPerMinute` | 80 to 200, the rate the channel's voice actually speaks | 150 |
| `shotHold` | multiplier on `MIN_SHOT_SECONDS`, 1 to 4 in steps of 0.5 | 1 |
| `titleTemplate` | up to 200 characters, slots `{topic}` `{formatKeyword}` `{pillar}` `{runtime}` | today's title rules |
| `titleRequiredSlots` | subset of the four slot names, each present in the template | nothing checked |
| `introRule` | up to 1,000 characters of prose | today's opening rules |
| `introLine`, `outroLine` | up to 400 characters each, fixed narration | none |
| `shorts` | boolean, whether this format's videos get Shorts | `true` (today's pipeline) |

The first keyword is the format's **lead keyword**: titles use it for
`{formatKeyword}`. The rest go to the description, tags and the cohesion
panel. This is how "ancient history explained" can sit on a "Sleep" format as a
secondary keyword without being promised in every title (my call).

`intent` picks one of two script playbooks in code (section 6.3). It is the
only switch between them; a channel cannot write its own.

### 4.2 Pillars

`caseCategories` keeps its key, so `cases.category`, its validation and every
reader stay as they are, and each entry gains `keywords` (up to 6 phrases, 60
characters each, default empty). The UI and the prompts call them **pillars**
(my call: renaming the key would touch every case reader for no change in
behaviour). The rule of at least two stays.

A case needs a pillar before **Research with VidIQ** runs. The database
already guarantees it (`cases.category` is not null and never empty), and all
seven production cases have one.

### 4.3 Channel publishing fields

- `channelTags`: kept as it is (15 tags, 30 characters each), now applied to
  every upload. Together they may use at most 150 of YouTube's 500 tag
  characters; tags past that are dropped at publish with a note on the publish
  screen.
- `channelHashtag`: one hashtag, stored without `#`, letters and digits only,
  up to 30 characters.
- `channelFooter`: up to 1,000 characters, appended to every long-form
  description by code, never written by the model.

### 4.4 Sections and completeness

| Section | Fields |
|---|---|
| identity | as today; `caseCategories` now carry keywords |
| **formats** (new) | `formats` |
| search | `language`, `country`, `channelTags`, `channelHashtag` |
| publishing | as today, plus `channelFooter` |

`keywordContext` leaves the schema; its value becomes the primary format's lead
keyword (section 4.5).

Completeness adds one requirement: a valid `formats` array with one primary.
Every format value has a default, so this is never missing in practice. Keywords,
template, intro, tags, hashtag and footer stay optional; the cohesion panel
shows their absence as a gap rather than the bible refusing to save.

### 4.5 Reading old versions

Bible versions are append-only and projects freeze theirs, so stored JSON is
not rewritten (my call, in the pattern of "strict on write, strip on read").
`ChannelBibleReadSchema` upgrades a version that has no `formats`:

- one format: key `main`, `primary` true, name `keywordContext` with its first
  letter capitalised or "Main" when empty, keywords `[]`, and every other field
  at its default from the table in 4.1. **The owner's ruling:** the word goes
  into the name only, so no keyword rule switches on for an existing channel.
  The owner adds keywords in the Bible tab when they choose;
- each case category gains `keywords: []`;
- `channelHashtag` and `channelFooter` read as empty; `keywordContext` is
  dropped.

The write schema requires the new shape, so the next save stores it. Drafts
read through the same upgrade. No SQL data migration is needed for bibles.

**Snapshot test:** every prompt composed from `FIRST_CHANNEL_BIBLE` before this
work and from its upgraded form after is byte-identical. Defaults are chosen so
this holds (150 words a minute, multiplier 1, empty template, empty intro).

### 4.6 Examples

Boom & Busters after the upgrade: one format "Documentary", no keywords,
`tension`, 15 / 3 / 30 minutes (the start limit, section 8), 150 words a minute, shot hold
1, no template, no intro; five pillars with no keywords; no channel tags,
hashtag or footer. It behaves as today until the owner fills something.

History channel, illustration only: format "Sleep", keywords
`["history for sleep", "ancient history explained", "history to fall asleep to"]`,
`calm`, 120 / 60 / 180 (startable since decision 452, when long renders came in parts), 120 words a minute, shot hold 2.5, template
`"{topic} | {formatKeyword} ({runtime})"` requiring `{topic}` and
`{formatKeyword}`, which gives "Cleopatra | History for Sleep (2 Hours)"; pillars such as Egypt, Mesopotamia, Greece, Rome, each with
keywords like "ancient egypt history".

## 5. Data outside the bible

- **`cases.format_key`** (text, nullable; null means the primary format): the
  format a case is meant for, chosen on the case row before research. The
  picker shows only when the channel has more than one format (my call).
- **`projects.format_key`** (text, not null, backfilled `main`): the format the
  project runs in, read from its frozen bible. A key the frozen bible lacks
  falls back to its primary format.
- **`keyword_measurements`**: channel, keyword, VidIQ volume, competition,
  overall, estimated monthly searches, `measured_at`, credits used. One row per
  measurement; the latest per channel and keyword is shown. Not part of bible
  versions: measuring is data, not identity (my call).
- **`channel_search_space`**: channel, format keyword, `measured_at`, the top
  outliers (id, title, channel, views, breakout score, duration), title patterns,
  and the duration spread of the winners (min, median, max). Latest per channel
  and keyword is shown.

Staleness follows the search brief's 30 days (`SEARCH_BRIEF_STALE_DAYS`,
`packages/schemas/src/search-brief.ts`): older measurements and search-space
rows show as stale and offer a re-run with its cost. Nothing is cleared, as
with the brief today (my call).

## 6. How each stage uses it

### 6.1 Case research

Two additions to `case-researcher`:

1. **Format seed.** When the case's format has a lead keyword, one more
   `keyword_research` (`matching_terms`) call on `"<subject> <lead keyword>"`.
   Its rows join the subject's rows before the existing filter step, which
   already drops duplicates. 5 credits; the button's estimate rises by 5.
   A seeded row may become the target keyword (it is often the best search
   for this channel); section 6.5 keeps titles from repeating it.
2. **Fit.** A model step (no credits) given the channel's `subject`,
   `whatACaseIs`, pillars with their keywords, and the case subject. It answers
   `{ inScope, pillarKey, reason }`, stored on the brief as `fit`. The case row
   warns when `inScope` is false or `pillarKey` differs from the case's pillar,
   with the reason. The owner can ignore it.

The angle step already receives the channel's subject and audience; it also
receives the pillars and their keywords when any pillar has keywords, so a
channel without them composes the same prompt as today.

Every case already has a pillar: `cases.category` is not null and a check
refuses an empty one, so the gate in 4.2 needs no new code.

### 6.2 Project start

The start control in `search-brief-panel.tsx` gains a format choice (shown only
when the channel has more than one format, defaulting to the case's format, with
a note when it differs from the format the brief was researched for) and a
runtime field limited to that format's range, defaulting to its default. Before starting it shows an estimated
cost for the chosen length (always shown, my call). `startProjectFromCase` stores
`format_key` and validates the runtime against the format and against the
code's start limit: 3 to 60 until phase 5, then 3 to 30 (section 8). A bible
may hold a format up to 180; the start control offers at
most the start limit and says plainly that longer videos are not yet supported.

### 6.3 Script

- **Length and pace (the owner's ruling).** The narrator has no speed setting
  (`packages/providers/src/tts/elevenlabs.ts:29`), so `wordsPerMinute` is the
  rate the channel's voice actually speaks, not a dial. Words = runtime × the
  format's `wordsPerMinute` × 0.95. `NARRATION_WPM`
  (`packages/schemas/src/script.ts:618`) stops being the rate: every reader
  (`estimateRuntimeSec`, chapter estimates, `runtimeDelta`, the mock voice's
  durations, the shot-list fallback) takes the project's format pace, and 150
  remains only as the default.
- **Measured pace.** The formats card shows the pace measured from the
  channel's recent voice takes (words over voiced seconds), with how many takes
  it is drawn from, so the owner sets `wordsPerMinute` from evidence. No take
  yet reads "Not measured yet".
- **Slowing the voice.** The calm playbook asks for pause marks and longer
  breaks between sentences, in the forms the voice provider honours, so a calm
  narration really is slower. No silence is padded in at assembly.
- **Intent.** `tension` is today's outline and craft, unchanged. `calm` is a
  second playbook in code: the outline keeps the same JSON shape, but chapters
  settle rather than plant open questions, nothing is withheld for a later
  reveal, stakes do not escalate, the opening sets the scene instead of
  glimpsing the consequence, and the close resolves with no open thread. It
  comes with a calm counterpart to `script-craft.md`. Every long-form prompt
  that assumes tension follows the same switch (my call): chapter drafting,
  the self-check, the direction prompt's use of `withhold`
  (`direction.ts:95`), the titles rule that the stakes come in the first half
  (`metadata.ts:214`) and the description's closing comment question
  (`metadata.ts:143`). Shorts and the teaser stay out of scope, but whatever
  reads `tensionFromOutline` must work when the tension fields are empty.
- **Intro rule:** when set, it replaces the outline's opening-chapter rule for
  that format.
- **Fixed lines:** `introLine` and `outroLine`, when set, are inserted by code as
  the first paragraph of the first chapter and the last paragraph of the last,
  marked fixed (my call). They show in the script studio read-only, are voiced,
  counted in the word budget and planned for visuals. They are left out of the
  titles prompt's hook (`publish-actions.ts:523`), the description seed, the
  self-check and Shorts excerpts; the cohesion panel's spoken intro is the first
  30 seconds after them.
- The existing anti-stuffing rule covers format and pillar keywords.

### 6.4 Visuals

Every reader of `MIN_SHOT_SECONDS` (the shot list's prompt rule and its two
direct uses at `shotlist.ts:711` and `:728`, stretch re-plan, timing findings,
and `MIN_SHOT_RULE`, which becomes a function of the multiplier) uses
`MIN_SHOT_SECONDS[type] × shotHold`. At 1 the planning prompt is unchanged.

### 6.5 Titles

- With a template, the titles prompt is told to follow it, with the slots filled
  by code: `{topic}` the target keyword or subject, `{formatKeyword}` the lead
  keyword, `{pillar}` the pillar's label, `{runtime}` the rendered video's
  length in words ("2 Hours", "95 Minutes"; rounded down, never up). When the
  target keyword already contains a format keyword, `{topic}` is the subject,
  so a title never repeats the format (my call).
- Code checks each candidate for every required slot's filled value,
  case-insensitive. A candidate that misses one is marked on the publish screen
  and skipped for the free top-3 VidIQ scoring; **Score all** still scores it.
- Without a template, today's rule (`metadata.ts:102-104`) is unchanged.
- Decision 303 stands.

### 6.6 Description

- The target keyword stays in the first 150 characters (today's rule). New rule:
  one format or pillar keyword also appears in the first 150 characters where it
  reads naturally.
- Code appends `channelFooter`. Order of blocks: body, chapters, footer, music,
  sources, hashtags, disclaimer (my call).

### 6.7 Tags

Assembled by code in this order, deduplicated, inside 500 characters: the
owner's kept tags, channel tags (at most 150 characters), format keywords,
pillar keywords, the brief's tags (today's `searchTags`), the cast, the model's
tags.

**The owner's ruling:** the hard-coded "business documentary" tag
(`apps/web/lib/search-tags.ts:10`, taken whenever an outlier carries it) is
removed. In its place, an outlier tag shared by at least two outlier videos is
also taken when it matches one of the case's format or pillar keywords. This is
the one accepted change to Boom & Busters' output: its uploads stop getting
"business documentary" until the owner adds it as a keyword. Prompts are
unaffected, so the snapshot test still holds. The publish screen keeps marking which tags came from VidIQ data and also
marks channel and format tags.

Channel tags and the channel hashtag are written into the editable draft when
the description is written (`publish-actions.ts:338-350`), so the owner can
remove them per video; only the footer is added at compose time, like the
disclaimer. Long-form only; Shorts are unchanged. A draft written before this
change gets them only when its description is redrafted (my call).

### 6.8 Hashtags

The channel hashtag first, then two from the model, inside today's
`HASHTAGS_MAX` of 3. Without a channel hashtag, three from the model as today.

### 6.9 Cohesion panel

On the publish screen, computed by code with case-insensitive matching. Rows:
chosen title, description's first 150 characters, tags, hashtags, spoken intro
(the first 30 seconds of narration). Columns: topic (target keyword or subject),
format keywords, pillar (label or keywords). Each cell shows hit or miss. Above
it: the case's fit from 6.1 and any empty channel fields ("No format keywords
set"). Warn only.

### 6.10 Shorts on or off

Added 2026-11-03 at the owner's request: "For certain channels we should have
the option to turn shorts on and off. For example, a sleep channel won't have
shorts." The switch sits on the format, not the channel (owner's choice), so a
channel with one format gets a channel switch, and a channel that runs a calm
format beside a tension one can keep Shorts for the second only.

With `shorts: false`:

- **Script.** The script run makes no Shorts marking call and stores no
  candidates. Script Studio shows no Shorts strip.
- **After the master.** When the master render finishes, the project moves
  straight to `publish` (`awaiting_review`) and `project/master.ready` is not
  sent. No talking points, point Shorts, excerpts or teaser are made, so none is
  paid for.
- **Pipeline rail.** The Shorts segment reads "off for this format" instead of
  "not started", with its own icon and text, never colour alone.
- **Publish.** The screen lists the long video only. Short slots are only ever
  proposed for Shorts that exist, so the calendar books none without any change.
- **Bible tab.** Each format card has a labelled on/off button for Shorts. The
  read view says "Shorts off" for a format that has them off.

What it does not do:

- It never deletes. A project that already has Shorts rows keeps them on the
  Shorts and Publish screens, whatever its format now says.
- A project already in the Shorts stage carries on, including its Restart
  button. The switch is read when the master finishes, inside the step that
  sets the next stage, so a run parked before the deploy reads `true` from the
  default and behaves as today.
- Unlike every other format field, the switch is read from the channel's
  **current** bible (the format with the project's key, resolved as
  `resolveFormat` does), not the version the project froze at start (my call).
  It is a switch to stop spending, so turning it off should reach videos
  already in progress. Nothing in the narration or the master depends on it.
- Turning Shorts back on later does not reach back to projects that skipped
  them. There is no "make Shorts for this video" button (out of scope).

## 7. Bible tab, Draft with AI, Copy

- A Formats section card: a list of format cards with add, remove and "Make
  primary" buttons, every field labelled (button-first, spec 11.1). Pillar
  keywords edit inside identity; channel hashtag in search; footer in publishing.
- **Measure in VidIQ** on the formats and identity cards measures every format
  and pillar keyword not measured in the last 30 days, 5 credits each, cost
  shown first, inside the cap. Each keyword shows its latest volume,
  competition and date, or "Not measured".
- **Analyse search space** on a format card runs `outliers` on each format
  keyword plus video details for the top 10, and shows the winners' title
  patterns and duration spread beside the runtime fields. Display only in this
  task; nothing feeds prompts from it (my call).
- Draft with AI writes every new field (`bible-draft.ts` field guide), and its
  VidIQ research digest informs format keywords and runtime.
- Copy from another channel copies the formats section like any other.
- This lands after the Bible tab rework, on its section cards, save bar and
  counts. That rework's spec and plan live on branch `bible-tab-rework`
  (commit 8da5b83), not yet on master; it also drops two example slots, 46 to 44.

## 8. Long runtimes (phase 5)

**The owner's ruling:** the raise from 60 to 180 minutes is part of this work,
as its last phase. Before the outer limit rises, the builder checks and fixes
what a long run would break, and records each in PROGRESS.md:

- the outline's output budget (`outputBudget(4000)`) and chapter count;
- voice synthesis cost and any per-request length limits;
- image and shot counts, and their cost, at the format's shot hold;
- Remotion Lambda render time, chunking and timeouts;
- the YouTube account's permission for uploads over 15 minutes and the upload
  size;
- the cost estimate in 6.2 against a real long run.

Proving it needs at least one real long Lambda render, which costs money even
with mock providers. That run is asked for separately when phase 5 reaches it,
with its estimated cost shown; nothing paid runs without that approval. Until
every check passes, the outer limit stays 60.

On 2026-11-03 the owner lowered the ceiling from 240 to 180 minutes: "We don't
need videos that are that long, the longest should be 3 hours." The phase 5
audit ran at 240 minutes before that change; every fix it made holds at 180,
and the limits it left open (render chunk time, file size against loudnorm's
disk, QC decode time, upload time) are smaller at 180, not gone. The start limit
rises only as far as the approved render shows is safe, at most 180.

**What the evidence showed (2026-11-03), and the owner's decision.** The approved
test render was not run: the live configuration and Remotion's own records of
two real 16.6-minute masters answered the question without spending anything,
and a render of placeholder images would have passed misleadingly.

- Each master: 29,963 frames in 150 chunks of 200 frames; 1.59 seconds a frame
  typical, 2.06 at the slowest chunk (409 s); about 7 minutes from start to
  finish; 742 MB (about 6 Mbps); $1.00 by Remotion's own figure.
- A chunk must finish inside the function's 900 seconds, so about 350 frames a
  chunk at the slowest rate with a margin. At the broker's fan-out of 150 that
  is about 29 minutes of video in one render, 39 at Remotion's cap of 200
  functions a render. A 60-minute video would put 720 frames in each chunk and
  time out.
- Combining the chunks, and loudnorm afterwards, need twice the file on a 10 GB
  disk, which caps a single render near 112 minutes whatever the fan-out.
- The app's render cost formula ($0.25 per 900 s) is about 3.6 times low; a
  180-minute master would cost about $11 to render.

The owner agreed: **the start limit is 30 minutes**, the outer limit a bible may
hold stays 180, and reaching 180 is a separate project, **long renders in
parts**: the master rendered as parts of about 15 minutes, joined without the
whole file on one disk, loudnorm and QC part by part, and a YouTube upload that
resumes across invocations. A format whose default or maximum is above 30 keeps
the start control's "not supported yet" note until that project lands.

## 9. Delivery

One spec, five phases, each its own plan section, merged when green:

1. **Structure.** Schema, read upgrade, sections and completeness,
   `projects.format_key`, Bible tab fields, Draft with AI, Copy, snapshot test.
   No behaviour change.
2. **Publishing.** Title template and check, description rule and footer, tag
   order, channel hashtag, cohesion panel.
3. **Research.** Case format, format seed, fit step, the pillar gate,
   measurements, search space.
4. **Production.** Start control with format, runtime (up to 60) and estimate;
   format pace and measured pace; shot hold; intro rule and fixed lines; the
   calm playbook.
5. **Long runtimes.** The checks in section 8, one approved paid long render,
   the outer limit set to 180, and the start limit set to 30 from the evidence.

## 10. Constraints

- Mock providers by default; real VidIQ or model calls only on the owner's
  request.
- Anything an Inngest run reads that this work adds is computed inside a step;
  a run parked before a deploy must not crash on a missing field.
- `'use server'` files export only async functions.
- Migrations: compare journals with origin/master before merging.
- Every consuming package's tests run, not only the one changed; a new Settings
  tab action is mocked in `voice-tab.test.tsx`.
- PROGRESS.md decisions are numbered after fetching origin/master.

## 11. Left to the builder

- The calm craft text, drafted from how sleep history narration works and shown
  to the owner before it ships.
- The cost estimate's method (past projects in `cost_ledger` per minute, or
  unit prices when there is no history).
- Where video durations come from for the search space (VidIQ if it returns
  them, else YouTube `videos.list`).
- The runtime wording in `{runtime}` beyond "rounded down, never up".
- Exact UI layout inside the reworked Bible tab.
