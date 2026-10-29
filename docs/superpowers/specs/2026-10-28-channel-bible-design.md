# The channel bible: each channel's identity as data, drafted with AI (design)

Date: 2026-10-28. Status: draft for owner approval.

This design **replaces section 4.8 ("Stage B") of
`2026-10-27-multi-channel-design.md`** and builds on its stage A (the
`channels` table, `channel_id` on cases and projects, per-channel settings),
which another session is building in the `multi-channel` worktree. Stage A
is unchanged by this document. Where this document and section 4.8 disagree,
this document wins; where it is silent, 4.8 stands (identity on the render,
categories as data, semantic colour labels).

It is the first of three linked projects, in the order the owner agreed:

1. **The channel bible** (this document).
2. **Topic validation with VidIQ** (`2026-10-28-vidiq-search-research-design.md`,
   to be reworked so its channel-specific settings come from the bible).
3. **Per-channel research sources** for the dossier (not yet designed).

## 1. What the owner asked for

The flow for every channel is **ideation, then topic validation (VidIQ),
then research (the dossier)**. The plumbing has to take any topic on any
channel while the quality stays where Boom & Busters has it today. In the
owner's words, the current Boom & Busters bible must be parameterised "so
that it can be swapped and changed and updated", from "something in channel
settings that can be assisted with AI".

What a bible is, in the owner's words: like setting up the brand voice and
identity for a business. "The do's and don'ts, the writing style, examples
of hooks and things that give the channel identity."

Agreed in conversation on 2026-10-28:

- Research correctness is not the bible's job. The dossier's claim review
  (every claim graded and tied to a source document) is where the owner
  checks facts.
- **Each channel's bible carries its own examples.** The shared craft keeps
  the rules, with named example slots that each bible fills. This overrules
  section 4.8's "the worked examples inside the craft bibles stay as they
  are".
- Boom & Busters' bible holds exactly today's examples, so its prompts come
  out word for word as they do now, and the existing tests prove it.
- A bible is complete only when every slot is filled.
- Each bible gets a section of on-brand hooks, openings and titles, drafted
  by the AI from winning videos in the niche and approved by the owner.
- Worked examples (Wirecard in graphics, Stability AI in direction) get the
  same treatment as the short examples. The motion-graphics exemplar corpus
  is deferred.
- The owner said "Proceed" to the creation and versioning flow: a Bible tab
  with **Draft with AI**, the owner's inputs, VidIQ research with the
  credits shown first, a draft per section with its own **Redraft**, nothing
  used until approved, every save a version, a project frozen to the version
  it started with.

## 2. Where the channel lives in the code today

An inventory on 2026-10-28 found Boom & Busters' identity in four kinds of
place. P below is `packages/providers/src/prompts`.

**Opening sentences and rules that name the subject** (section 4.8's
fields already cover most): P/subject.ts:22 to 28, P/dossier.ts:59 to 63,
92 and 105 ("(company)"), P/script.ts:101 to 164 (HOUSE_STYLE: the voice at
105, finance examples at 117 to 119, legal hedges at 156 to 164),
P/direction.ts:99 and 137, P/shotlist.ts:145, 232 to 235, 310, 356 to 365,
P/graphics.ts:190 to 203, 324, 419 to 422, 454 to 457, P/metadata.ts:76 to
78, 98 to 101, 177 to 208 (descriptions say "the company"), P/rebrief.ts,
P/digest.ts.

**Examples inside the shared craft**: P/script-craft.md (98 lines, about
10% is channel examples), P/direction-craft.md (260 lines, about 12%; the
Register bullet at 11 to 15; the Stability AI worked example),
P/graphics.ts:491 to 508 (the Wirecard worked example). Both `.md` files are
embedded byte for byte into `.ts` constants (decision 216) by
`scripts/embed-direction-craft.mjs` and its script-craft twin, which refuse
`${` and backticks.

**Fixed strings outside the prompts**: `PUBLISH_DISCLAIMER`
(packages/schemas/src/publish.ts:24 to 27, "not financial advice"), the
voice audition sample (apps/web voice-tab.tsx:40 to 42, a Wirecard line),
`DEFAULT_CTA_TEXT` (packages/timeline/src/short.ts:40), the wordmark in
EndCta.tsx:61 and Watermark.tsx:67, the upload body
(infra/lambdas/media-utils/handler.ts:222 to 232) which sends no
`categoryId` or `defaultLanguage`.

**Missing entirely**: no hook, opening or title examples anywhere; no
thumbnail rules.

Not channel identity, and left alone: the claim shape in P/dossier.ts:411 to
441. Its `legal` grading and its `series` are general enough (currency is
nullable, `legal` is null for a plain fact). A psychology channel's
equivalent of "ruled or alleged" (replicated or contested) belongs to
project 3. `settings.music.longFormStyle` is stored but never read, so it
does not become a bible field (section 8, call 9). The HeadlineCard's paper
and ink colours (packages/compositions/src/components/HeadlineCard.tsx:23 to
29) are a deliberately neutral citation card, the same whatever channel runs
it, so they stay in code.

## 3. Goals, non-goals, anti-goals

Goals:

- Every sentence that is Boom & Busters' rather than any documentary's is
  read from the channel's bible: a field or an example slot.
- Boom & Busters' composed prompts, upload body and rendered frames are
  identical before and after, proven by tests captured before the first
  change.
- A new channel gets a complete, owner-approved bible in one sitting, with
  the AI doing the drafting from the owner's description, channels the owner
  admires and VidIQ data on what wins in that niche.
- The owner can change a bible at any time, see every earlier version and
  restore one, without disturbing a film already in production.
- The owner can read exactly what the models are told before saving.

Non-goals:

- Replacing the shared craft per channel. The rules stay shared code; a
  channel fills slots and adds its own rules (section 4.8's
  `scriptRulesMd` and `directionRulesMd`).
- Thumbnail rules. None exist; they get a bible section when thumbnails are
  designed.
- The motion-graphics exemplar corpus (packages/providers/src/exemplars).
  It keeps its finance slot words until a channel's graphics need
  otherwise.
- Research sources per channel (project 3) and topic validation (project 2).
- Rewriting `cases.ts` (Suggest cases). Project 2 deletes it.

Anti-goals (a failure even if it works):

- Any Boom & Busters prompt changing by one character in the lift.
- Finance residue in another channel's prompts: a psychology script prompt
  that still says "the company", "pensions" or "not financial advice".
- Another creator's lines in our films. Examples drawn from other channels'
  videos are rewritten as this channel's own, never copied, and the stored
  research keeps only short quotes and video ids.
- A drafted bible being used before the owner approves it.
- A bible edit changing a film midway: half the script in one voice, half
  in another.
- VidIQ credits spent without the owner seeing the estimate first.

## 4. The design

### 4.1 Three layers

A film is made from three things:

| Layer | What it holds | Where it lives | Who changes it |
|---|---|---|---|
| Craft | how documentaries are written, directed, cut: the rules | code (`*-craft.md`, prompt builders) | the developer |
| Bible | who this channel is: subject, audience, voice, look, examples, search, publishing | data, one per channel, versioned | the owner, with AI drafting |
| Project | this film's case, dossier, brief | data | the pipeline and the owner |

The rule for anything new: if two channels on different subjects would
want different words, it is bible; if the sentence is true of any good
documentary, it is craft.

### 4.2 What a bible holds

`ChannelBibleSchema` in `packages/schemas`, grouped into sections. The
groups are the units the owner drafts, approves and redrafts. Section 4.8's
fields keep their names and meanings.

| Section | Fields | Boom & Busters' value |
|---|---|---|
| Identity | `subject`, `whatACaseIs`, `subjectKind` (a noun, "company", plus 4.8's sentence), `caseCategories`, `audience` | lifted from code, as 4.8's table |
| Voice | `narrationRegister`, `voiceDos` (list), `voiceDonts` (list), `hedgingRules` (HOUSE_STYLE's legal hedges), `scriptRulesMd` optional | HOUSE_STYLE's voice paragraph and hedges, split along their existing sentences; lists empty where today's text has no list |
| Look | `visualRegister`, `directionRulesMd` optional | direction-craft.md:11 to 15 |
| Examples | `examples`: a map from slot id to text (4.3) | every example in today's craft, verbatim |
| Hooks, openings, titles | `hooks`, `openings`, `titles`: lists of entries (4.4) | empty at the lift; drafted afterwards |
| Search | `language` (BCP 47), `country` (ISO 3166), `keywordContext` (words that make a search phrase this channel's, "documentary"), `channelTags` (tags every upload carries) | "en", "US", "documentary", empty list |
| Publishing | `titleStyle`, `ctaLine`, `disclaimer`, `youtubeCategoryId` nullable, `auditionLine` | 4.8's values, `PUBLISH_DISCLAIMER`, null, the voice-tab sample |

Every list has a maximum the schema states (the builder picks numbers that
fit a prompt, section 5). Every text field has a maximum length. The schema
is strict: unknown keys are refused, not stripped, so a typo in a draft
fails loudly.

The Search fields are stored and edited here but read by project 2. Until
then nothing reads them, which is acceptable because they cost nothing and
let project 2 start without a migration.

`subjectKind` gains the bare noun so the scattered "the company" phrases
(dossier.ts:105, metadata.ts:190 to 199, shotlist.ts, graphics.ts) read
"the {subjectKind}". `subjectKind` holds two forms, `singular` and `plural`
("company", "companies"). Where today's sentence needs anything else (an
article other than "the", a possessive, a phrase), the sentence becomes an
example slot. If the lift finds more than 40 slots in all, the builder stops
and brings the list to the owner before going on, because every slot is
something each new channel's bible has to fill.

### 4.3 Example slots

The shared craft keeps its rules and gains **named slots** where today's
examples sit. A slot is a marker in the craft text, written
`[[example:<slot-id>]]`. The marker uses no `${` and no backtick, so the
embed scripts accept it and decision 216's byte-identity test still holds
between each `.md` file and its constant. Prompt builders that hold
examples inline in TypeScript (script.ts, graphics.ts, shotlist.ts) use the
same marker inside their template strings.

`EXAMPLE_SLOTS` in `packages/schemas` is the registry, one entry per slot:

- `id`, kebab-case and stable (`script-concrete-figure`,
  `direction-worked-example`, `graphics-worked-example`, ...);
- `source`: which craft file or builder holds the marker;
- `teaches`: one sentence on what the example must show, written from the
  rule it sits in ("a sentence that turns an abstract loss into a number a
  viewer can picture");
- `kind`: `line` (one sentence or phrase), `passage` (a short paragraph) or
  `worked` (a full worked example, such as Wirecard in graphics);
- `maxLength`.

`fillSlots(text, bible, slotIds)` replaces every marker with the bible's
text for that slot and **throws** on a marker with no entry, so an
incomplete bible can never reach a model as a blank. The prompt builders
call it once on their composed system prompt. `slotIds` is the slot list
the bible version was saved against (4.5).

**Slots added after the lift.** Every slot added later is wrapped with the
rule text that needs it, `[[if:<slot-id>]] ... [[/if]]`. `fillSlots` drops
the whole block when the slot id is not in the version's `slotIds`, and
fills it when it is. A film frozen to an older version therefore gets the
prompt it would have got before the new rule existed, which is what
freezing means; the "throws" rule applies only to slots the version claims
to have. The slots made by the lift carry no `[[if:]]` because every
version has them.

Boom & Busters' `examples` map is extracted verbatim from today's text by
the lift. The first commit of the branch captures every builder's composed
system prompt, for a fixed set of inputs, as fixture strings before any
code moves; every later commit must reproduce them exactly from
`FIRST_CHANNEL_BIBLE`. This is section 4.8's snapshot test, extended to
cover slots.

Which sentence becomes a slot and which stays rule is the builder's call,
guided by the inventory in section 2 and one test: would a psychology
channel want different words here? The `teaches` line is written for every
slot because both the owner and the drafting model read it.

### 4.4 Hooks, openings and titles

Three lists, each entry `{ text, note, drawnFrom }`:

- `hooks`: the first one or two sentences of a film, the line that makes a
  viewer stay.
- `openings`: the first 30 to 60 seconds as a short passage, showing how
  the channel sets up a case.
- `titles`: titles in the channel's style.

`note` says what pattern the entry shows ("opens on the moment of collapse,
then rewinds"). `drawnFrom` lists the videos the pattern came from (video id,
channel, title), never their words: the text is the channel's own, written
for an imaginary case or a case the channel has made.

Where they are read: the script prompt gets hooks and openings under a
heading in the opening section's rules; the metadata title prompt gets the
titles. Both are appended after the existing rules, so the lift (empty
lists) changes nothing.

They are not part of completeness: Boom & Busters is complete without them
and works as today. Filling them is a deliberate quality change. When the
owner approves Boom & Busters' first hooks, its prompts change on purpose,
the snapshot fixtures are re-captured in that commit, and the owner reads
the next script with that in mind.

### 4.5 Versions and the project freeze

New table `channel_bibles`: `id` ulid, `channelId`, `version` integer
(unique per channel, from 1), `bible` jsonb, `slotIds` text array (the
`EXAMPLE_SLOTS` ids that existed when it was saved), `complete` boolean
(computed at save against those slots), `note` text (what changed, the
owner's words or "Drafted with AI"), `createdAt`. Rows are never updated or
deleted. A version row is the only thing runners trust; drafting state
(4.6) never reaches it.

`channels.bible` from stage A is replaced by `channels.currentBibleId`
(references `channel_bibles`). Stage A is not merged at the time of
writing, so the lift branch starts from master after stage A merges and
builds against stage A's actual `ChannelBibleSchema` (4.8's field list).
The migration:

- for the first channel, inserts version 1 as the full new
  `FIRST_CHANNEL_BIBLE` (every section, every slot, the fixed strings), not
  a copy of the 4.8-shaped `channels.bible`;
- for any other channel created between stage A and the lift, maps the
  4.8 fields across into the new shape, leaves the new sections and slots
  empty, and saves it with `complete = false`, so that channel is gated
  until the owner drafts the rest;
- points `currentBibleId` at version 1 and drops `channels.bible`, so there
  is one source of truth.

`projects.bibleId` (not null, references `channel_bibles`) is set by
`createProject` to the channel's current version and backfilled with
version 1 for existing projects. `channelForProject` returns the project's
frozen bible, not the channel's current one. Runners read it inside the step
that needs it, as section 4.3 of the multi-channel design requires for the
channel.

Case-level work with no project (the add-case form, project 2's VidIQ
research) reads the channel's current bible.

**Render and publish read the frozen bible too.** The `ctaLine`,
`disclaimer`, `youtubeCategoryId` and `language` used at render and upload
come from the project's `bibleId`, re-read in the step that uses them. A
scheduled upload made after **Use the latest bible** uses the newer
version; a video already uploaded is never edited to match. The render's
`brand.identity` (name and handle) is not bible: it comes from the
`channels` row and is snapshotted into the timeline at compile, as 4.8
says.

A project page shows which bible version it uses. When the channel's
current version is newer, the page shows **Use the latest bible** with the
note "Stages already done keep their text; stages run after this use the
new bible." Pressing it moves `projects.bibleId` to the current version.

**Save** writes a new version and makes it current. The Bible tab's
**History** button lists versions (number, date, note) with **View** and
**Restore**. Restore writes a new version whose content is the old one's,
so history only grows.

### 4.6 The Bible tab

Section 4.8 put the bible on the Channel tab. It gets its own **Bible** tab,
second after Channel, because it has seven sections and a history.

The tab shows the seven sections as collapsible cards, each with its fields,
a status ("Approved", "Drafted, not approved", "Empty"), and buttons
**Redraft**, **Approve** and **Edit**. Example slots are shown with the slot's
`teaches` line and the rule they sit in beside the example, so the owner
judges the example against what it has to teach. Under the sections, the
read-only **What the models are told** card (4.8) gains a stage selector
(script, shotlist, direction, graphics, metadata, dossier) and renders that
stage's composed system prompt from the unsaved form.

**Approval rules.** Statuses, "drafted" marks and "Too close to its
source" flags live with the unsaved draft (section 5), never on a version
row. A section a model wrote is "Drafted, not approved" until the owner
presses **Approve** or edits a field in it; the owner's own typing counts as
approval, since those are the owner's words. A section loaded from the
saved version counts as approved. Redrafting an approved section makes it
"Drafted, not approved" again.

**Save** is enabled when no section is "Drafted, not approved" and no field
is "Too close to its source". Empty sections do not block a save: the owner
can stop halfway. The saved version becomes current with `complete` false,
and the channel stays gated (4.9) until a complete version is saved.

### 4.7 Draft with AI

**Draft with AI** opens a card with:

- "Describe the channel in a few lines" (prefilled with name and handle);
- "Who is it for?";
- "Channels you admire" (up to 5 handles or URLs);
- "Videos that feel right" (up to 10 URLs);
- "Anything you don't want".

Then two buttons: **Research with VidIQ, then draft** and **Draft without
VidIQ**.

**The VidIQ research step** runs in an Inngest function so it survives a
closed tab, and shows the estimated credits in a confirm first ("About 50
VidIQ credits. Balance: N."). It:

1. resolves the admired channels and pulls each one's best-performing videos
   (titles, views, publish date);
2. runs outliers on the niche from the owner's description, with
   `keywordContext`;
3. pulls the opening of the transcript (about the first 60 seconds) for the
   top videos across both lists, up to a cap;
4. reduces it to a research digest: title patterns, hook patterns, opening
   structures, what the niche's audience responds to. Each pattern keeps its
   source video ids and at most a short quote.

Only the digest is stored (on the draft, section 5), not full transcripts,
to respect YouTube's storage limits on API data. The VidIQ connection
(provider key in Settings, the MCP client, the credit ledger and monthly
cap) is section 5 of the VidIQ design. **It moves into this project as its
first piece**, because the bible draft is its first user; project 2 reuses
it. The typed client here is section 5's list (`keywordResearch`,
`outliers`, `getVideosByIds`, `scoreTitle`, `balance`) plus the two calls
the draft needs: a channel's best-performing videos and a video's
transcript. Bible research runs count against the same monthly credit cap
as everything else (default 1,000); a run whose estimate would cross the
cap is refused with the remaining balance shown.

**Drafting** is one LLM call per section, task `bible` (4.8: added to
`LLM_TASKS` and `ModelRoutingSchema`, scripting tier by default, charged to
the channel with no project). Sections draft in order, each seeing the ones
before: Identity, Voice, Look, Examples, Hooks/openings/titles, Search,
Publishing. Each call gets:

- the owner's inputs and the research digest;
- the section's fields with their descriptions;
- for Examples, every slot's `teaches` line and surrounding rule;
- `FIRST_CHANNEL_BIBLE`'s same section, labelled as an example of shape and
  level of detail, with the instruction not to reuse its subjects or words.

Each answer is validated against the section's schema; a failure retries
once with the error, then shows the error on the card with **Redraft**.

**Redraft** on one section re-runs that section's call alone, optionally
with a line from the owner ("more clinical, less playful"). Drafted fields
are marked until edited or approved. Nothing is saved until **Save**.

**Overlap check.** Before a drafted example is shown, it is compared with
the research quotes from other creators' videos and, on any channel other
than the first, with Boom & Busters' examples. A run of 8 or more words in
common marks the field "Too close to its source" and blocks its **Approve**
until edited or redrafted. A channel's own scripts and videos are its own
words and are never a source the check compares against, so Boom & Busters'
hooks drawn from its own films are not blocked.

**Boom & Busters' own hooks.** For the first channel the research step also
reads the first lines of its own approved scripts from the database (free)
and its own published videos, so its hooks section is drafted from what it
has already made as well as from the niche.

Without a VidIQ key, **Research with VidIQ** is disabled with "Add a VidIQ
key in Settings, Connections", and **Draft without VidIQ** drafts from the
owner's inputs alone.

### 4.8 The fixed strings, folded in

| Today | After |
|---|---|
| `PUBLISH_DISCLAIMER` | the project's bible `disclaimer`; the constant stays as Boom & Busters' value in `FIRST_CHANNEL_BIBLE` |
| voice-tab.tsx audition sample | the channel's current bible `auditionLine` |
| `DEFAULT_CTA_TEXT` | `ctaLine` (as 4.8) |
| EndCta and Watermark wordmark | `brand.identity` (as 4.8) |
| upload body without category or language | `youtubeCategoryId` and `language` sent when set; Boom & Busters' null category sends nothing, as today. `defaultLanguage` and `defaultAudioLanguage` are sent from `language` only on channels other than the first until the owner opts the first in (section 8, call 8). This changes the media-utils Lambda and needs its CDK deploy. |

### 4.9 Completeness and gating

Complete means: every Identity, Voice, Look and Publishing field that is not
optional is non-empty, at least two categories, and **every slot in
`EXAMPLE_SLOTS` has an entry**. Hooks, openings, titles and Search are not
required.

A channel whose current bible is incomplete cannot start a project (4.5 of
the multi-channel design: the button says why and links to the Bible tab).
A stage runner whose project's frozen bible is incomplete fails with the
same message and sends no prompt; `fillSlots` throwing is the last guard.

Adding a slot to `EXAMPLE_SLOTS` later makes every other channel's
current bible incomplete for new projects until filled. The release that
adds a slot writes a new Boom & Busters version with the entry filled (its
`note` names the release), and lists the slot on other channels' Bible tabs
as "New slot, needs an example" with **Draft** for that slot alone. Projects
already frozen to an older version keep running unchanged: that version's
`slotIds` lack the new id, so `fillSlots` drops the new rule's `[[if:]]`
block (4.3). A version's `complete` is judged against its own `slotIds`
for the films frozen to it, and against the current registry for starting a
new project.

### 4.10 Rollout

Three branches, each merged green before the next:

1. **Lift** (`bible-lift`). Capture the fixtures first. Add the schema with
   all sections, `EXAMPLE_SLOTS`, `fillSlots`, the markers, the fields read
   by every builder and fixed string, `FIRST_CHANNEL_BIBLE`, the
   `channel_bibles` table and `projects.bibleId`. No UI beyond 4.8's
   existing Channel tab fields. Boom & Busters byte-identical. Includes 4.8's
   identity-on-render and categories-as-data, with the broker and Remotion
   deploys 4.8 lists.
2. **Bible tab and drafting** (`bible-drafting`). The VidIQ connection
   (from the VidIQ design's section 5), the Bible tab, history, Draft with
   AI, the research step, overlap check, Use the latest bible, the upload
   category and language with the media-utils deploy.
3. **Boom & Busters' hooks** (no code). The owner runs Draft for the hooks,
   openings and titles section on the first channel, approves, saves. The
   fixtures are re-captured in a commit that says so.

Depends on stage A merged. Migration numbers follow stage A's.

## 5. Left to the builder

- The slot list itself: which sentences become slots, their ids, `teaches`
  lines and kinds, guided by section 2 and the psychology test in 4.3.
- List maximums and text lengths in the schema.
- Where the unsaved draft and the research digest live between steps (a
  `bible_drafts` row per channel, or jsonb on the channel), as long as a
  closed tab does not lose a finished research run.
- The exact VidIQ tools for "a channel's best-performing videos" and for
  transcripts, and the per-tool credit table behind the estimate. Measure
  costs with `vidiq_balance` before and after one live run the owner
  approves; tests use mocks.
- The transcript cap (how many videos) within the estimate shown.
- The fixed input set for the prompt fixtures.
- The drafting prompt wording and the mock psychology bible.
- The overlap check's tokenisation.

## 6. Mock providers

`MOCK_PROVIDERS=1`: the VidIQ client returns recorded fixtures (from the
2026-10-28 recon); the `bible` task returns a fixed psychology bible section
by section, complete, with every slot filled and no finance words. E2E
creates the second channel, runs Draft with AI through the mocks, approves,
saves and starts a project.

## 7. Out of scope

- Thumbnail rules (no thumbnails today).
- The graphics exemplar corpus.
- Sharing or copying a bible between channels beyond "Start from" on the
  New channel form, which 4.5 of the multi-channel design says never copies
  the bible.
- Per-channel claim grading (replicated or contested studies): project 3.
- Music mood: nothing reads `longFormStyle` today.

## 8. Calls made without the owner (reversible, say so if wrong)

1. The bible gets its own Bible tab rather than living on the Channel tab.
2. Versions are a separate append-only table; `channels.bible` becomes a
   pointer, so there is one source of truth.
3. A project freezes the bible version at creation and the owner can move
   it forward with **Use the latest bible**; stages already done keep their
   text.
4. Slot markers are `[[example:<id>]]`, which the embed scripts accept.
5. Hooks, openings and titles are written as the channel's own lines with
   their pattern and sources noted, never copied from the videos studied.
   An 8-word overlap blocks approval.
6. Hooks, openings, titles and Search do not count towards completeness, so
   Boom & Busters stays complete and unchanged at the lift.
7. The VidIQ connection is built in this project, not project 2, because
   the draft needs it first.
8. Boom & Busters' uploads keep sending no category and no language until
   the owner sets them, so publishing does not change at the lift.
9. Music mood was dropped from the bible because nothing reads the stored
   value; it comes back when bed selection reads a mood.
10. Suggest cases is not parameterised. It stays the first channel's until
    project 2 removes it, and is hidden on other channels.
11. Drafting is one call per section, in order, so a redraft is cheap and
    each section sees the ones before.
12. A slot added after the lift is wrapped in `[[if:]]`, so films frozen to
    an older version keep the prompt they started with.
13. The lift writes Boom & Busters' version 1 as the full new bible; any
    other channel made under stage A is mapped across and left gated.
14. Approval lives in the draft only. The owner's own edits count as
    approval; a version row holds no statuses.
15. Render and upload read the project's frozen bible; the wordmark reads
    the channel row.
16. `subjectKind` has singular and plural forms only; any other grammar
    becomes a slot, and more than 40 slots goes back to the owner.
17. The overlap check never compares a channel with its own words.
18. Bible research spends from the same monthly VidIQ credit cap.

## 9. Tests

Unit (Vitest):

- **Prompt fixtures**: every builder's composed system prompt from
  `FIRST_CHANNEL_BIBLE` equals the fixture captured before the lift.
- A psychology bible composes into every builder with its subject, voice,
  register and examples where Boom & Busters' sat, and none of a finance
  word list (company, pension, fraud, share price, financial advice,
  Wirecard, Stability AI) survives in the **system** prompt. The graphics
  user prompt is excluded because it appends the deferred exemplar corpus
  (graphics.ts:532).
- `fillSlots` throws on a missing slot the version claims; it drops an
  `[[if:]]` block whose slot the version lacks and fills it when present;
  every marker in every craft file and builder has an `EXAMPLE_SLOTS` entry
  and every entry has a marker.
- The lift migration: the first channel's version 1 equals
  `FIRST_CHANNEL_BIBLE`; a 4.8-shaped second channel maps across with
  `complete` false.
- Approval: a drafted section blocks Save until approved or edited; an
  empty section does not.
- A scheduled upload after Use the latest bible reads the newer disclaimer.
- The embed tests (decision 216) still pass with markers in the `.md` files.
- `ChannelBibleSchema`: strict keys, maximums, completeness, a version
  complete for an older slot list.
- `channel_bibles`: save appends, restore appends, nothing updates;
  `createProject` freezes the current version; `channelForProject` returns
  the frozen one; Use the latest bible moves it.
- Fixed strings: the disclaimer, audition line and CTA come from the bible;
  Boom & Busters' values equal today's constants; the upload body for a null
  category is byte-identical to today's.
- The overlap check flags an 8-word run and passes a 7-word one.
- The VidIQ research step against mocks: digest shape, no full transcript
  stored, credits recorded in the VidIQ ledger.

Inngest harness: the research run survives a restart between steps; a stage
runner with an incomplete frozen bible fails with the bible message and
sends no prompt.

Component: the Bible tab's buttons are labelled and 40 px; section statuses;
the "What the models are told" card follows the stage selector and unsaved
edits; Approve blocked on "Too close to its source"; the Settings action
mocks include the Bible tab (memory: voice-tab.test.tsx).

E2E (mock providers): new channel, Draft with AI through VidIQ mocks,
redraft one section, approve all, save, see version 1 in History, start a
project, edit and save version 2, see the project still on version 1, press
Use the latest bible, see version 2. The 390 px pass covers the Bible tab.
