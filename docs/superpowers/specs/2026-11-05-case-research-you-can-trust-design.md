# Case research you can trust: intent, topics, the field and the gap

Date: 2026-11-05. Status: design, awaiting the owner's approval.
Builds on: `2026-11-05-case-library-redesign-design.md` (merged as `30b05dcc`).
A second project, learning from real YouTube search terms after publishing
(idea F), is designed separately after this one.

## Why

After the redesign the owner opened WeWork and found the target was
"wework world trade center pune". It scored highest because nobody makes
videos for it: it is someone looking for an office to rent. Next to it sat
"wework scene" and "wework video clip" (clips, most likely from the TV
series), and two searches for one specific creator's or news channel's
video. The research ranks strings by VidIQ numbers; YouTube and Google rank
by meaning, matching a video to what the searcher wants.

The owner's test for a research run they can trust, in their words:
confidence in the keyword's intent, that the angle is good and backed by
evidence, that it is aligned with the channel, that there is good search
demand, and that it is not too competitive. They also asked that all of it
adapt to other channels whose content is entirely different.

## Goals

- Every measured keyword carries what the searcher wants and whether that
  fits this channel's format, judged against the channel's own bible.
- Keywords that mean the same thing are grouped into topics; demand is
  judged on the topic.
- The target is picked from keywords whose intent fits, then by score,
  bible words and searches, with a check of who ranks for it today.
- Angles cite evidence: what viewers asked for in the comments of the
  winning videos and did not get.
- A five-line verdict card at the top of the brief: intent, angle
  evidence, channel fit, demand, competition. Each a tick, a warning or a
  cross, with a one-line reason.
- Nothing in the logic is specific to Boom & Busters: vocabulary, language
  and fit all come from the channel's bible.

## Non-goals

- Idea F (YouTube Analytics search terms and per-channel tuning). Its own
  design follows this one.
- Blocking anything. A cross is a warning; New project stays available.
- New VidIQ providers or a second search provider.
- Rewriting existing briefs. They keep what they have (see Existing briefs).

## Anti-goals

- A tick the owner cannot trace to evidence on the same screen.
- Business-collapse vocabulary in code. Any word list the ranking uses
  comes from the channel's bible.
- The model inventing facts: intent phrases, topic names, comment themes
  and evidence lines are directions and summaries of quoted data, never new
  figures (the existing digit guard idiom applies).
- Treating third-party text (keywords, titles, comments) as instructions.

## Constraints

- Mock-provider mode by default; every new VidIQ call and model step has a
  fixture or mock. A live run needs the owner's go-ahead (about 60 credits).
- The owner accepted the credit cost: a run rises from about 20 to 25
  credits to about 45 to 65. The estimate shown before Research must
  include every new call.
- Stored data stays digest-sized and inside the 30-day freshness rule
  already applied to briefs (YouTube API Services data-storage terms):
  no full comment threads, no transcripts.
- New brief fields are jsonb with Zod defaults; no migration.
- Inngest replay safety: anything new is computed inside a step or
  deterministically from memoised step output (owner memory).
- Button-first UI, console tokens, the Case Library's list and panel.

## Decided with the owner

1. All of ideas A to E in one project, with the four changes agreed
   earlier. F is a separate, later project.
2. The higher credit cost per run is fine.
3. A cross on any check warns; it never blocks New project.
4. The four earlier changes:
   - Choosing an angle also makes its keyword the target when that keyword
     is eligible (a keyword, not a title or other language, and no
     figure). A toast says "Target keyword is now <keyword>". Make target
     still overrides. When the angle's keyword is not eligible, the target
     stays and the panel says why ("This angle's keyword has a figure, so
     the target stays <target>").
   - A keyword row with a figure shows "Has a figure, can't be the target"
     where Make target would be.
   - The default pick uses a floor, not a window: eligible keywords with
     `overall` 50 or more; prefer a keyword containing a word from the
     case's format keywords or its pillar's keywords; then most searches a
     month. With no bible keywords, most searches wins. The hard-coded
     `DOCUMENTARY_PHRASES` list goes. (This step now also requires intent
     fit; see the Pick below.)
   - The accent ("other language") rule runs only when the bible's
     `language` is English (`en`, `en-*`) or empty. Any other language
     keeps its accented keywords. The title rule (punctuation, 9+ words,
     opening words of a title) runs in every language.

## The research run, step by step

### 1. Measure (adds E)

As today: matching terms for the subject, and for subject plus the
format's lead keyword. New: matching terms for up to two names from the
case's People field, in the order the owner listed them (5 credits each).
Their rows join the measured list; they are judged like any other row.

### 2. Understand (A and B, one model pass)

The keyword-filter step becomes a keyword-understanding step. Its input
gains the channel's bible subject, audience, `whatACaseIs`, the case's
format name and keywords, and the pillar labels. For every measured term it
answers:

- `about`: true when the term is about this subject (today's filter).
- `intent`: what the searcher wants, in plain words, at most 80
  characters ("wants a coworking office in Pune", "wants the story of why
  it collapsed").
- `fit`: `fits`, `partly` or `off`: whether a video in this format on this
  channel would satisfy that searcher.
- `topic`: a short label (at most 40 characters) shared by terms that mean
  the same thing ("why WeWork collapsed").

Rows with `about: false` are dropped, as today. The kept rows store
`intent`, `fit` and `topic` beside their VidIQ numbers. The title, figure
and accent rules still run in code after this pass; the model does not
replace them.

### 3. Pick

Candidates are keywords (not titles, not other languages, no figure) with
`fit: fits` and `overall` 50 or more. Among them: prefer a keyword
containing a word from the case's format keywords or its pillar's keywords,
then the most searches a month. If no keyword fits, the pick falls back to
`fit: partly` under the same rule, and the Intent check warns. If none
qualify at all, the target is null, as today.

The top three candidates in that order go to step 4. After step 4, the
target is the first candidate whose competition check is not a cross; if
all three are crosses, the first candidate stays the target and the
Competition check says so.

### 4. Check the field (C)

For each of the up to three candidates, one YouTube search through VidIQ
(`vidiq_youtube_search`). From the top ten results store, per result: the
channel's subscriber count, views, published date, length in seconds and
whether it is a Short. Nothing else.

The check judges the search itself, never the owner's channel size (the
owner's ruling, below): a small channel must not be marked down for being
small.

### 5. Find the gap (D)

For the top three winning videos by breakout score, read their comments
through VidIQ (`vidiq_video_comments`, the most relevant 100 or the tool's
maximum if lower). A model step turns them into at most five themes: what
viewers asked for or said was missing, each with a count of supporting
comments and one short quote of at most 140 characters. Only the themes,
counts and quotes are stored; the comments themselves are not.

### 6. Angles and the rating

The angle step receives the comment themes and the field check. Each
option gains `evidence`: up to three short lines, each naming a comment
theme or a field observation it rests on ("12 comments ask what SoftBank
knew", "none of the top ten covers the IPO filing"). The rate step weighs
evidence with demand and the gap, as now.

### 7. The verdict

Computed on read from the stored brief, never stored, so thresholds can
change without new research. Five lines, each `ok`, `warn` or `bad`, with
a reason sentence:

| Check | ok | warn | bad |
| --- | --- | --- | --- |
| Intent | target `fit: fits` | target `fit: partly` | no target, or `fit: off` |
| Angle evidence (the chosen angle, else the recommended one) | at least one comment-theme evidence line | evidence from the field only, or a gap with no evidence | no angles |
| Channel fit | `brief.fit.inScope` and the pillar matches the case | in scope, other pillar | out of scope |
| Demand (target's topic: sum of monthly searches of its keywords) | 5,000 or more, growth under 200% | 1,000 to 4,999, or growth 200% or more ("may be a news spike") | under 1,000 or unmeasured |
| Competition (target's field check) | 3 or more open doors | 1 or 2 open doors, or none in a stale field | no open doors in a recent field, or 6 or more Shorts in the top ten |

The thresholds are first guesses; project F exists to tune them per
channel from real results.

## Existing briefs

Briefs researched before this change have no intent, topic, field or
comment data. Their verdict card shows a single line, "Researched before
the full checks. Research again for intent, demand and competition
evidence", with the research control. The four earlier changes apply to
them where they can: Make target reasons, angle-follows-target, the
language-aware accent rule on read. The target already stored, including
any the owner set by hand, is never re-picked.

## On screen

The verdict card sits at the top of the panel, under the next-step strip:
five rows, each an icon and colour (success, warning, danger tokens), the
check name and its reason. Each row links (scrolls) to its evidence:

- Intent: the target card gains the intent phrase and fit.
- Demand: the target card gains the topic name and the topic's monthly
  searches; Other keywords is grouped under topic headings, each row
  showing its intent phrase; `off` rows sit in a collapsed "Doesn't fit
  this channel" group with their intent phrases.
- Competition: a new "Who ranks now" block under the target: the top ten
  as compact rows (channel subscribers, views, age, length, open door or not,
  Short), for the target and the other two candidates behind a toggle.
- Angle evidence: each angle card lists its evidence lines; a new
  collapsed "What viewers asked for" evidence block lists the comment
  themes with counts and quotes.
- Channel fit: the existing fit line.

The Research button's estimate counts every call (base, format seed,
People seeds, field checks, comments).

## Calls made after the builder check (not discussed with the owner)

- **Field check calls** (confirmed by the live probe, below).
  `vidiq_youtube_search` with `type: ['video']`, `limit: 10`, 5 credits,
  returns per result `subscriberCount`, `duration` (ISO 8601, e.g.
  `PT13M29S`), `viewCount`, `publishedAt`, `channelTitle` and `id`. No
  other lookup is needed. Shorts are results under 61 seconds. Field check
  total: 15 credits for three candidates.
- **Comments come from the subject's winning videos**, which do not depend
  on the target, so a later target change never re-reads them. Read with
  `order: relevance`, `maxResult: 100`, one page per video. Replies are
  read as well as top-level comments; the creator's own comments
  (`byChannelOwner: true`) are skipped.
- **Research again writes a fresh brief** and re-picks the target. "Never
  re-picked" applies only to the read upgrade of old briefs.
- **A target with no field check** (set with Make target, or followed from
  an angle, after the run) shows Competition as warn, "Not checked for this
  keyword", with a **Check who ranks now** button (a ConfirmButton with its
  credit cost, about 15) that runs the field check for that one keyword
  and saves it to the brief.
- **Demand** sums `estimatedMonthlySearch` of the rows in the target's
  topic that are keywords (figure rows included, titles and other
  languages excluded) and whose `fit` is not `off`.
- **Thin bibles** are judged as they are; a channel whose bible says little
  will see more `partly` fits and Intent warnings, which is the honest
  answer.
- **Budget.** Every call goes through the existing VidIQ spend path and its
  monthly cap. If the cap or balance cannot cover the optional steps (field
  check, comments, angle validation), the run skips them, records why, and
  the verdict shows those checks as "Not checked: credit cap".

## Answered by the owner after the builder check

- **A live probe was run** (2026-11-05, 10 credits: one search, one
  comments page). Findings that shape the build:
  1. Search returns everything the field check needs (above). The trimmed
     responses (field names and types verbatim, abusive replies removed)
     sit beside this document in `2026-11-05-case-research-probe/`; the
     builder turns them into fixtures in
     `packages/providers/src/vidiq/fixtures/`.
  2. Comment text is HTML-escaped (`&#39;`, `&quot;`, `<br>`, links as
     `<a>` tags) and must be decoded before the model reads it.
  3. The most relevant top-level comments are mostly reactions and jokes;
     real requests and questions are rare and often sit in replies ("He's
     still worth 2.3 billion. How?"). The theme step must say so honestly:
     zero themes is a valid answer, and the Angle evidence check then
     leans on the niche test below.
  4. Replies include abuse and slurs. The theme step ignores abusive
     comments, and no stored quote may contain abuse or a slur; a quote
     that would is dropped.
  5. Small channels can sit in the top ten with almost no views (11 and 30
     subscriber channels at 822 and 176 views for "wework documentary").
     Ranking alone is not evidence of winnability, so an open door (below)
     needs real views as well as a small channel.
- **Competition judges the search, not the owner's channel.** The owner
  asked whether a size-relative rule would mark a small channel down; it
  would (at 2,000 subscribers almost nothing qualifies), so the rule is:
  - An **open door** is a top-ten video from a channel under 100,000
    subscribers with 10,000 views or more: the search rewards the video,
    not the channel.
  - A **stale field** is one where 6 or more of the top ten were published
    3 or more years before the research date.
  - The owner's channel size is never read for the verdict. The panel may
    show it for context when the channel is connected; nothing assumes a
    size when it is not.
  - Worked against the probe ("wework documentary"): no open doors (the
    smallest channel with real views has 440,000 subscribers; the two tiny
    channels have under 1,000 views), and the field runs 2019 to 2026, so
    it is not stale: **bad**, "Big channels hold every result for wework
    documentary". This is why three candidates are checked.
  - 100,000 subscribers, 10,000 views and 3 years are first guesses for
    project F to tune per channel.
- **Test the recommended angle against the niche (added).** After the
  rating, one `vidiq_comment_insights` call in `validate` mode: `niche` is
  the bible's subject in English (translated by the model step when the
  bible is in another language), `idea` is the recommended angle, and
  `language` is the bible's language. The call is asynchronous: it returns
  a job id polled with `vidiq_job_poll` inside the step until completed
  (failed, expired and no-match jobs are refunded by VidIQ). Stored: the
  verdict, up to three direct-evidence lines with counts, and VidIQ's
  notes, digest-sized. 5 credits. The Angle evidence check reads it:
  `ok` when the comment themes or the niche verdict show direct evidence
  for the checked angle; `warn` when only adjacent or field evidence
  exists; `bad` with no angles. When the owner chooses a different angle
  than the recommended one, the niche verdict does not apply to it; the
  check falls back to comment themes and field evidence and a **Test this
  angle** button (5 credits) runs the validation for the chosen angle.
- **Credits per run**, for the estimate: base keyword, questions and
  outlier calls as today, format seed 5, People seeds up to 10, field check
  15, comments 15, angle test 5: about 70 credits for a case with two
  People and a format lead keyword.

## Left to the builder

- Prompt wording for the understanding, comment-theme and angle steps,
  within the rules above.
- How `vidiq_youtube_search` and `vidiq_video_comments` responses are
  parsed (the VidIQ client's fixture idiom), and their real credit costs
  from `_credits.used`; the estimate uses the documented 5 until measured.
- Component split for the verdict card and the new evidence blocks.
- PROGRESS section and decision numbers (check origin/master at merge).
