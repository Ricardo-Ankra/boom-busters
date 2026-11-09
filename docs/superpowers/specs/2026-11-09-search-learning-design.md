# Learning from real search: design

Date: 2026-11-09. Status: draft for the owner's approval.

## Why

Case research (decisions 410 to 431) predicts five things before a video is
made: the keyword's intent, the angle's evidence, the channel fit, search
demand and competition. Nothing checks those predictions afterwards. Today the
owner judges a published video by subscribers gained, retention, likes and
comments, which all describe what happened after someone clicked. None of them
says whether the video was found for the keyword the research picked.

The owner's framing, which this design follows:

1. **Target confirmation.** The keywords we researched should match the search
   terms the video actually gets views from. That is the signal the video is
   hitting the target.
2. **Delivery on intent.** Retention (and to a lesser degree likes) is the
   signal that the video delivers what those searchers wanted.

Over time the app should learn, per channel, which of its research checks
predict well and where its thresholds sit wrong, because the tool must work for
channels whose content is entirely different from Boom & Busters.

## Goals

- For every published master with a research brief, a **search report** at
  day 7, day 28 and day 90 that says whether the video is found for its target,
  whether those searchers stayed, and which unresearched terms brought viewers.
- A plain **outcome** per report, with what to do about it.
- A per-channel **track record** for each of the five research checks, and
  threshold **suggestions** the owner can apply or dismiss.
- Terms that worked but were never researched can be **added to the channel's
  keywords** with one button, so future research picks them up.

## Non-goals

- Shorts. They have no research brief and live in a different feed.
- Impressions and click-through rate. The Analytics API does not expose them
  (see `apps/web/lib/youtube-analytics.ts`).
- Retention split by traffic source. The API's retention report cannot be
  filtered by source, so per-term watch time stands in for it (below).
- Changing titles, descriptions or tags on YouTube based on the report.
- Revenue (needs the monetary scope; unchanged owner decision).

## Anti-goals

- **Thresholds that change by themselves.** Every tuning change is a
  suggestion the owner applies. Nothing moves silently.
- **Judging one video as proof.** No suggestion appears until at least five
  masters have a day-28 report, and each needs at least three videos behind it.
- **Blaming the research for a weak video.** Few subscribers counts against
  the research only when the search viewers left early. Whole-video numbers
  (subscribers, likes, comments) are always labelled as whole-video.
- **Fixed absolute numbers.** Every "good" or "weak" is against the channel's
  own baseline, never a universal figure.
- **Boom & Busters assumptions.** Nothing here may name the channel, its
  niche or its language. Language comes from the bible, as in case research.

## How a video traces back to its research

`publish_records` (target type `master`, `targetId` = project id, with
`youtubeVideoId`) leads to `projects.searchBrief`, the case's brief frozen when
the project started. That frozen brief is the research being judged: its
`targetKeyword`, `secondaryKeywords`, `searchedQuestions`, the chosen angle's
`keyword`, `language`, and each keyword's `intent`, `fit` and `topic`.

A master whose project has no brief, or a brief with no target, still gets a
report: search share, the terms, and the delivery numbers, with no target
match and no outcome beyond "No research to judge".

## Part 1: the search report

### Data pulled

The daily analytics run (`apps/web/inngest/functions/analytics-runner.ts`)
already snapshots every live video. Extend `fetchVideoAnalytics` with:

- **Search terms:** `dimensions=insightTrafficSourceDetail`,
  `filters=video==<id>;insightTrafficSourceType==YT_SEARCH`,
  `metrics=views,estimatedMinutesWatched`, `sort=-views`, `maxResults=25`.
  Stored as `[{ term, views, minutes }]`.
- **Whole-video engagement:** `subscribersGained`, `likes`, `comments` added
  to the existing totals report.

New nullable columns on `analytics_snapshots`: `search_terms` (jsonb),
`subscribers_gained`, `likes`, `comments` (integers). These daily,
lifetime-to-date numbers feed only the live "Too early" view and the
project page between checkpoints. Frozen reports make their own
date-bounded fetch (see Checkpoints). The mock in
`mockVideoAnalytics` grows deterministic terms built from a fixed word list so
that each outcome can be produced in tests.

**First task, before any code depends on it: a live probe** of these two
reports against one real published video. The Analytics API is free (its own
quota, no credits), but it reads the owner's data, so the probe runs with the
owner's go-ahead. It must confirm: the report and metric names are accepted,
the 25-term cap, how YouTube hides rare terms, and the traffic source key's
real spelling (`YT_SEARCH`; the existing mock uses `SEARCH`, which is a bug
the builder fixes in the mock). Findings go in the probe folder next to this
spec, as the case-research probe did.

The report states YouTube's limits in one line: it lists the top 25 search
terms and hides rare ones, so the listed terms may not add up to all search
views.

### Checkpoints

Day 7, day 28 and day 90 after the video went public (`publishAt`, or the day
the record flipped to `live` when there is none).

**Every frozen report covers exactly the publish day through the checkpoint
day**, whatever day it is computed on. The runner makes a date-bounded fetch
(`startDate` = publish day, `endDate` = publish day + 7, 28 or 90) for the
search terms, the totals and engagement, the views by source and the
retention curve. Because YouTube's numbers lag by two to three days, the
fetch runs on the first daily run at or after **checkpoint + 3 days**. That
makes reports comparable across videos and makes the backfill exact, since
the dates are in the past. `fetchVideoAnalytics` gains an optional date range;
the daily snapshot keeps using lifetime. (My call, answering the review.)

The report is then **frozen** in a new table:

`search_reports`: `id`, `channel_id`, `project_id`, `video_id`, `checkpoint`
(`7 | 28 | 90`), `computed_at`, `report` (jsonb), unique on
(`video_id`, `checkpoint`).

Frozen, so the track record compares like with like. Before day 7 the project
page shows a live, unfrozen view of the latest snapshot marked "Too early to
judge". Day 28 is the checkpoint the learning uses; day 7 is an early warning
and day 90 shows the long tail.

A video already past a checkpoint when this ships gets its reports backfilled
with the same date-bounded fetch, so they are as good as reports made on time.

**What a frozen report stores**: the date range, every term with its views,
minutes, bucket and reason, per-bucket views and hold, search share, early
drop, engagement per 1,000 views, the baselines used, the day-28 rank (below),
the outcome, and the threshold values that produced the outcome. The outcome
is never recomputed on read.

**When the model call fails** (an error, the budget gate, a cut-off), the
freeze is deferred and the next daily run tries again. After three failed
days the report freezes with the deterministic buckets only, the leftover
terms marked "not matched", and the report says so. A transient failure must
not permanently degrade a report.

### Matching terms to the research

Each listed term lands in one bucket:

- **Target:** the target keyword's family, meaning the same search said
  differently (word order, plurals, spelling, an added year, a translation into
  the brief's language).
- **Researched:** a secondary keyword, a searched question, or the chosen
  angle's keyword, or their families.
- **Unresearched:** everything else.

Two steps:

1. **Deterministic first.** Normalise both sides (lowercase, punctuation out,
   the brief's language accent rule from decision 412, stop words out, simple
   plural folding), then compare word sets. Equal sets, or a term that contains
   every word of the keyword, match that keyword.
2. **A model call for the rest.** The leftover terms, the target, the
   researched keywords with their `topic` and `intent` labels, and the
   language go to one call through `callLlm` that returns a bucket and a short
   reason per term. One call per frozen report (so at most three per video),
   with a structured schema, logged to the cost ledger like other runs.
   Mock providers by default in development and tests.

The report keeps each term's bucket and, for model-matched terms, the reason,
so the owner can see why "what happened to wework india" counted as the
target.

### Measures

- **Search share:** search views over all views, from the existing
  views-by-source column.
- **Target share:** target-family views over the listed terms' views.
- **Hold per bucket:** minutes watched per view for each bucket, computed from
  the per-term `views` and `minutes`. This is the search-specific intent
  signal.
- **Early drop:** the share of all viewers gone by 30 seconds, read off the
  overall retention curve. The 30-second mark is converted to a ratio with the
  master's rendered duration (the same `durationMs` the retention overlay
  already uses via `publishModel` in `apps/web/lib/publish-review.ts`), and
  the curve is interpolated linearly between its points. When the curve has no
  point at or before 30 seconds (a very long video, or a sparse curve), the
  report shows "not measurable" for it. Labelled "all viewers".
- **Whole-video engagement:** subscribers, likes and comments per 1,000 views.
  Labelled "whole video".
- **Rank for the target:** when the day-28 report is computed, the runner
  makes one VidIQ `vidiq_youtube_search` for the target (5 credits, under the
  existing VidIQ credit cap) and stores the video's position or "not in the
  top 20" in the frozen report. When the cap is hit, the report waits up to
  seven daily runs for the rank, then freezes without it and says so. A
  **Check where it ranks (5 credits)** button repeats the check at any time;
  those results go in a separate list of rank checks shown beside the report,
  never into the frozen report. Competition scoring uses only the frozen
  day-28 rank.

**Hold is compared like with like.** Hold is minutes per view from the
search-terms report, converted to seconds. A bucket's hold is compared with
the **search hold baseline**: the median, across the channel's other masters'
frozen reports at the same checkpoint and in the same length band (under 10
minutes, 10 to 20, over 20), of their hold over all listed search terms. With
fewer than three comparable reports the baseline widens to all the channel's
frozen reports at that checkpoint, and the report says so. With none (a
channel's first videos), the baseline is the video's own average view
duration over all sources in the same date range, and the report says so.
Other measures (early drop, engagement per 1,000 views) use the same median
rule over their own values.

**Found for the target** is one definition used everywhere (outcomes and the
track record). All three must hold:

- target-family views are at least 25% of the listed terms' views, or the
  target family holds the top listed term;
- the target family has at least 20 views;
- the listed terms have at least 50 views between them.

A video below the last two floors is not judged on the target at all. Its
outcome is "Search barely played" when search share is low, otherwise "Too
little search to judge", and it is left out of the track record. Rank does not
override this definition; it is a separate input to the Competition row.

### Outcomes

Defaults below are named constants in `packages/schemas`, the same way
`brief-verdict.ts` holds its numbers, so Part 2 can tune them per channel.

| Outcome | Rule (in order) | What the report tells the owner |
|---|---|---|
| Too early | before day 7, or fewer than 100 views | Wait; the live terms are shown |
| No research to judge | no brief or no target | Terms and delivery only |
| Search barely played | search share under 10% | The research had little to say about this video's views |
| Too little search to judge | the listed-term floors above are not met | Not enough search terms yet to say |
| Hit and held | found for the target, and target hold at least 0.8 times the search hold baseline | Research and video both worked |
| Hit, then left | found for the target, hold below that | The keyword was right; check the title and the first 30 seconds against what these searchers wanted |
| Found another way | not found for the target, but the researched and unresearched buckets together carry 25% or more of listed views with hold at least 0.8 times the baseline | The video found a different audience; look at the unresearched terms |
| Missed the target | anything else | Search played but not for what we aimed at, and what came did not stay |

**If the probe shows YouTube returns no search terms for this channel's
videos** (too small, or the filter refused), the report still ships with
search share, early drop and engagement, and the outcome reads "YouTube shows
no search terms yet". Term matching and the target outcomes switch on as soon
as terms appear.

### Unresearched terms

Listed with views, hold and the model's reason. Each term that held gets two
buttons:

- **Add to channel keywords**: appends the term to the keywords of the
  format with the project's `formatKey` in the channel's **current** bible
  (not the project's frozen version), through the existing bible save path,
  one term per click. If that format no longer exists it goes to the primary
  format and the confirmation says so. A term whose normalised form (the
  matching step's normalisation) is already in that format's keywords is not
  added twice; the button reads "Already a keyword". Case research's fit-first
  pick already reads bible words, so future runs favour it. The builder
  confirms the bible save triggers no regeneration; if it does, say so on the
  button's confirmation.
- **Not for us**: hides it from this report's list and from the learning.

### Where it shows

- **Project page, publish stage:** a "Search report" card under the retention
  overlay (`apps/web/app/(console)/projects/[id]/retention-overlay.tsx`), with
  Day 7, Day 28 and Day 90 buttons to switch checkpoint, the outcome on top,
  then target, researched and unresearched buckets, then the delivery numbers
  against the baseline.
- **Case Library panel** for a published case: one line with the latest
  outcome and a link to the project's report.
- **Monday digest:** one line per video that crossed a checkpoint that week.

## Part 2: learning per channel

### Track record

Each check in the research verdict predicts one thing:

| Check | Predicts | Counted right when |
|---|---|---|
| Demand | found for the target | it passed and the video was found, or it warned and the video was not |
| Competition | found for the target, and ranking | as above, using the day-28 rank (top 10) where there is one |
| Intent | target searchers stay | it passed and the target hold was good, or it warned and it was not |
| Angle evidence | target searchers stay | as Intent |
| Channel fit | viewers subscribe | it passed and subscribers per 1,000 views were at or above baseline, or it warned and they were below |

Only day-28 reports count, and only those with a target outcome (Hit and
held, Hit then left, Found another way, Missed the target).

The verdict being judged must be the one shown when the project started, not
one recomputed later with new thresholds. So: freeze the verdict onto the
project when it is created (a new nullable `research_verdict` jsonb on
`projects`, written in the same insert that copies the case's brief into
`projects.search_brief`; the case's own `search_brief` is not the frozen
copy). The frozen verdict stores each line's state **and the threshold values
that produced it**. Projects started before this ships fall back to
recomputing with the default constants, marked as such.

**No circular learning.** The track record counts every counted video. A
suggestion for one threshold counts only videos whose frozen verdict used that
threshold's current value, so a tuned value is judged on the videos made under
it, never on the ones that caused it.

The track record reads "Demand called it right on 4 of 6 videos", per check,
with the videos listed.

### Threshold suggestions

From five or more counted videos, the app may suggest changes to these
per-channel values, and only these: `DEMAND_WARN`, `DEMAND_OK`,
`OPEN_DOOR_MAX_SUBSCRIBERS`, `OPEN_DOOR_MIN_VIEWS`, the target pick floor
(`PICK_FLOOR`), and the Part 1 outcome thresholds.

Rules every suggestion follows:

- Deterministic, no model call.
- At least three videos support it, and it is wrong in one direction (for
  example Demand warned on three videos that were each found for the target).
- It moves a value by at most a factor of two, within hard bounds the builder
  sets per constant.
- One sentence names the change, the evidence and the videos: "Demand warned
  on 3 videos under 1,000 searches that were each found for their target.
  Lower the warning line to 500?"

The owner presses **Apply** or **Dismiss**. A dismissed suggestion does not
come back until two more counted videos support it.

### Where tuning lives

A per-channel record of applied values, each with the previous value, when it
was applied and the evidence sentence. `briefVerdict`, its helpers and the
target pick gain an optional `thresholds` argument that defaults to today's
constants (`PICK_FLOOR` gets exported), so existing calls and tests stay
valid; callers with a channel pass its values. The Part 1 outcome thresholds
are tunable through the same record. A **Reset to
default** button per value. Applied values affect new research and, because
the verdict is computed on read, the verdict shown on existing cases; the
frozen project verdicts above keep the track record honest regardless.

The track record and suggestions live behind a **Search track record** button
on the Case Library, opening a panel in the same list-and-side-panel pattern.

### Intent learning, information only

The track record also lists which keyword intent labels and topics brought
viewers who held, as plain information. It feeds nothing automatically.

## Constraints

- Mock providers by default; no live VidIQ or model calls in development or
  tests. The Analytics probe needs the owner's go-ahead.
- Every value computed inside an Inngest step (parked runs replay old step
  results). One step per video per checkpoint, as snapshots already do.
- Migrations: check the journal against origin/master before merging; parallel
  sessions collide on numbers.
- Button-first UI, dark theme, numbers formatted as case research formats
  them.
- New schema fields optional, so older rows parse.

## Decided by the owner

- The two-signal model: search terms confirm the target; retention and likes
  show delivery on intent.
- The expert refinements played back on 2026-11-09 and accepted with
  "Proceed": per-term watch time as the intent signal, the first 30 seconds as
  the mismatch window, whole-video numbers labelled as such, channel
  baselines, three checkpoints, five videos before any learning.

## My calls (the owner can change these)

- Unresearched terms that held get "Add to channel keywords" (into the
  project's format) and "Not for us". The owner did not answer this question.
- A model call matches terms the deterministic step cannot, at most three per
  video.
- The day-28 rank check runs automatically for 5 credits, plus a button.
- The five-outcome table and its default numbers (10%, 25%, 0.8 times, 100
  views, length bands).
- Freezing the verdict onto the project at start.
- The track record sits behind a button on the Case Library.
- Settled after the builder review: reports date-bounded to publish day
  through checkpoint and fetched at checkpoint + 3 days; one "found for the
  target" definition with floors of 20 target views and 50 listed views; hold
  compared with other videos' search hold; early drop interpolated from the
  rendered duration; a failed model call defers the freeze up to three days;
  the frozen day-28 rank waits up to seven days for credits; manual rank
  checks kept apart from the frozen report; frozen verdicts record their
  thresholds and suggestions count only videos made under the current value;
  keywords added to the current bible's format, deduplicated.

## Order of work

0. **Probe** (needs the owner's go-ahead, free): run the two new reports
   against one real published video and record what comes back. It blocks
   only the live fetch code; the mock-mode build of everything else proceeds
   alongside it.
1. Part 1: data, frozen reports, matching, outcomes, the report card, the
   Case Library line, the digest line, Add to channel keywords.
2. Part 2: frozen verdicts, the track record, threshold plumbing,
   suggestions, the tuning record and its panel.

## Left to the builder

- Exact normalisation and stop-word lists per language, within decision 412's
  accent rule.
- The model prompt and its output schema.
- Hard bounds per tunable constant, and the exact suggestion maths within the
  rules above.
- Where the tuning record is stored (table or channel column).
- Card layout details within the console's existing patterns.
- Splitting each part into tasks, keeping the order of work above.
