# The case finder ranks a hitlist on measured evidence

Status: designed with the owner in conversation on 2026-10-20, then read
by a builder; the calls marked "builder check, my call" are Claude's and
the owner can overturn them. Approved by the owner on 2026-10-20, including
those calls. This document is committed **before any fetcher touches test
data**: that commit fixes the weights, thresholds and pass rule in advance. No decision number yet;
one is taken at the merge (parallel sessions collide on numbers).

## 1. The problem

The Case Library's `Suggest cases` button (spec 11.3,
`packages/providers/src/prompts/cases.ts`) asks one model to recall cases
from memory, write its own demand notes, list competitor videos from memory
and give itself a `priorityScore` from 0 to 100. Nothing in the app fetches
demand data, checks a court record or looks at YouTube. Every number on a
suggested row is the model's opinion, and the model already knows which
cases became hits, so the score cannot be tested.

The owner wants the ranking to rest on measured evidence, and wants proof
that it works judged by data, not by the owner or Claude.

### 1.1 What the owner decided (2026-10-20)

- **Start from a hitlist, not from recall.** Scan a large list of companies
  and corporate events, build a short dossier on each, rank them against
  each other. The model stops being the source of cases.
- **Both downfalls and success stories.** The library's five categories
  stay: `collapse`, `con`, `meltdown` (downfalls) and `turnaround`,
  `empire` (success stories). Court records only fit downfalls; success
  stories need their own paper-trail sources.
- **Global.** Any company anywhere in the world can be on the hitlist.
- **Demand starts with Wikipedia pageviews.** Google Trends was wanted too;
  see 1.2 for why it is deferred.
- **Timeliness is its own signal, and fast.** When something puts a case in
  the news (the owner's example: a new documentary on the founder of
  Theranos), the owner wants to know within 24 hours.
- **Email alerts, at most five a day.**
- **About one third success stories**, moved by demand.
- **Back-test the real methodology.** The test runs the exact scorer that
  ships, not a simplified stand-in.

### 1.2 What the research found (2026-10-20, live calls and opened pages)

- **No free database labels companies as cases.** Wikidata (CC0, SPARQL)
  has 65,172 businesses with a dissolution date (P576) but only about 20
  with an end cause (P1534), and 367 people "convicted of: fraud". It is the
  entity spine, not the tagging. The tagging comes from Wikipedia
  categories: Corporate scandals (198 pages), Pyramid and Ponzi schemes
  (170), Accounting scandals (76), plus "List of corporate collapses and
  scandals" (about 136 entries) and year categories of Chapter 11 filers.
- **Florida-UCLA-LoPucki Bankruptcy Research Database**: over 1,000 large
  US public company bankruptcies, about 200 fields, free cases table, not
  updated after January 2023.
- **Nothing labels a turnaround or an empire.** It must be derived. Usable
  inputs: Wikidata founder links (17,348 businesses with P112) and the
  Fortune 500 history CSVs for 1955 to 2019 (`cmusam/fortune500` on GitHub,
  scraped, no licence stated).
- **Dropped sources:** Stanford Securities Class Action Clearinghouse is
  offline until "Winter 2026". Violation Tracker charges for downloads.
  OpenCorporates forbids this use without a journalist/NGO/academic key.
  Companies House bulk data lists live companies only. JSE SENS has no free
  search API. NewsAPI's free tier is development only; the Guardian's free
  key is non-commercial.
- **Google Trends:** the official API is an application-only alpha (5 years
  of history, consistent scale across terms, YouTube Search support not
  stated). pytrends was archived in April 2025 and is rate-limited hard.
  The public site scales each query 0 to 100 against itself, so hundreds of
  cases cannot be put on one scale without chaining comparisons.
- **Wikimedia pageviews:** daily per-article counts from 1 July 2015,
  available the next day; hourly dumps about 3 hours behind. Free.
- **GDELT DOC 2.0:** news volume, rolling 3 months, updates every 15
  minutes, 250 records per query, one request every 5 seconds strictly
  enforced. Free with citation.
- **YouTube Data API v3:** `search.list` costs 100 units, `videos.list`
  and `channels.list` and `playlistItems.list` 1 unit each, 10,000 units a
  day per Google Cloud project. View counts are today's only; there is no
  history.
- A live example of the signal: Enron's English Wikipedia views went from
  about 1,500 a day to 6,930 between 10 and 19 October 2026. Cause not
  checked.

## 2. Goals, non-goals, anti-goals

**Goals**

1. A hitlist of companies and events, global, covering both lanes, built
   from free sources and refreshed on a schedule.
2. Four measurements per entry, computed in code at a given "as of" date:
   demand, world interest, timeliness, competition gap. Plus a paper-trail
   level and a legal-risk flag, which gate rather than score.
3. A fixed-weight rubric, written in this document before any test data is
   seen.
4. Two shortlists (downfalls, success stories) and a kill list with a
   one-line reason each, shown in the existing Case Library.
5. The model writes only the angle, and only from primary documents the
   app fetched; it must name the one the angle comes from.
6. A daily scan that finds spikes within 24 hours and emails at most five.
7. A back-test of the shipping scorer, with a pass rule fixed in advance.
8. A dated prediction log that later checks each of the owner's own videos
   against its 28-day views.

**Non-goals**

- Google Trends, until the owner is accepted into the official API alpha.
  The demand module leaves a slot for it.
- Any paid source: Semrush (already connected, but it uses paid API
  units), Violation Tracker downloads, NewsAPI, Keyword Planner.
- JSE SENS, Stanford SCAC, OpenCorporates (see 1.2).
- New screens. The evidence appears on the existing Case Library rows and
  the existing dashboard.

**Anti-goals** (failure even if it technically works)

- **Tuning the weights after seeing the back-test.** If the weights change
  after the test has run, the result no longer counts and a fresh test on
  cases not used before is needed.
- **An alert stream the owner learns to ignore.** More than five emails a
  day, or repeats of the same case.
- **A model inventing sources.** An angle citing a document the app did not
  fetch is refused.
- **A US-only finder in practice.** US cases have EDGAR and SEC releases;
  most countries have nothing searchable for free. Scored on document
  volume, US cases would always win.
- **Success stories crowded out.** One shared ranking would always put
  fraud on top.

## 3. Constraints

- Mock-provider mode by default (spec 13): every fetcher has a mock with
  fixtures, and `MOCK_PROVIDERS=1` never touches the network. Real calls
  only when the owner asks for them.
- Free sources only. Anything paid is asked for first. The back-test's
  baseline needs one LLM call (section 9.4); that is paid, costs cents, and
  is approved by the owner at run time.
- Keys the owner creates (all free): a YouTube Data API key in a **new
  Google Cloud project**, so the search quota is separate from the upload
  project's; a CourtListener API token; optionally a Companies House API
  key. Stored in Settings → Connections like the other provider keys (spec
  4), with optional env seeds for local dev and `.env.example` updated.
- SEC EDGAR and Wikimedia require a User-Agent naming a contact. That
  contact comes from a new env var the owner sets (for example
  `DATA_CONTACT_EMAIL`), never from `OWNER_EMAIL` silently.
- Inngest: this adds the second and third crons to a system that has had
  one (`analytics-runner`, 06:00 UTC). The known traps apply: cancelled
  runs keep singleton locks, parked runs replay old step results, new
  fields must be read inside steps.
- Button-first UI, dark theme (spec 11.1).

## 4. The hitlist

A new table, separate from `cases`. Thousands of rows would bury the Case
Library; a case row is created only when the owner accepts a shortlisted
entry.

Each entry: Wikidata QID (the identity), English Wikipedia title (may be
missing), sitelinks to other language editions, lane (`downfall` or
`success`), the tags that put it there, country, the search query used for
YouTube and GDELT (the English title without its disambiguation suffix
unless the builder finds a better rule), and timestamps.

**Seeding the downfall lane:** members of the Wikipedia scandal and
collapse categories and lists in 1.2 (recursing one level into
subcategories), the LoPucki cases, and Wikidata businesses with a
dissolution date plus a link to a fraud conviction or a bankruptcy. Each
member is resolved to its Wikidata QID.

**Seeding the success lane:** companies that climbed far in the Fortune 500
history (the builder sets the climb rule and documents it), plus Wikidata
businesses with a founder link and high pageviews that are not in a
downfall category. The Fortune data is used only as an internal signal and
is never shown as a source.

**A company in both lanes** (Enron was an empire before it collapsed) sits
in the downfall lane if any downfall tag applies. The model may still
propose a success-story angle on it.

**Floor:** entries whose English Wikipedia median monthly views over the
last 24 months are below 300 are dropped from ranking (kept in the table).
The builder may move this floor once, before the back-test, after looking
at the hitlist's size; it is then fixed.

**Refresh:** the hitlist is rebuilt weekly by its own cron. Entries are
never deleted while a case row points at them.

## 5. The four measurements

Every measurement is a pure function of fetched data and an as-of date `T`.
It only reads data dated before `T`. Live, `T` is today; in the back-test,
`T` is the day before the competitor video went up. This is what makes the
back-test test the shipping code.

Each raw value is turned into a **percentile within its lane** among the
ranked hitlist entries at `T` (0 to 100). Percentiles are what the rubric
combines, which is what makes downfalls and success stories comparable
within their own lane and lets the raw values be in any units.

1. **Demand (D).** Median monthly English Wikipedia pageviews (agent `user`,
   all access) over the 24 months before `T`, log-scaled. The median keeps
   one spike from looking like steady interest. Wikipedia is used because
   the channel speaks English; demand means its audience.
2. **World interest (W).** The same median, summed across every
   non-English language edition linked from Wikidata, log-scaled. It can
   lift a case but, at its weight, cannot carry one alone.
3. **Timeliness (S).** Spike ratio: English Wikipedia views in the 14 days
   before `T`, divided by the median 14-day total over the 365 days before
   that. Also recorded, not scored: GDELT article count over the same 14
   days (live only, since GDELT's search window is 3 months).
4. **Competition gap (G).** From YouTube: the top 25 `search.list` results
   for the entry's query, kept only if published before `T`, at least 8
   minutes long (Shorts out) and with the query in the title. For each kept
   video, its outlier ratio: views divided by the median views of that
   channel's long-form uploads (section 9.3 for the window). Recent strong
   coverage `C` is the sum of `min(outlier ratio, 5)` over kept videos
   published in the 24 months before `T`. G is `100 minus the percentile of
   C`. A case nobody has covered recently scores high; demand decides
   whether that gap is worth filling.

View counts are today's, not as of `T`. In the back-test this part is
partly hindsight, and the report says so.

**Fitting G into the YouTube quota (builder check, my call).** A search
costs 100 units and the day has 10,000, so G cannot be measured for the
whole hitlist. G is measured only for the **top 250 entries per lane by D**;
only those entries are ranked, and percentiles of all four measures are
taken over that population. Each entry's search result is cached with the
date it was fetched and refreshed in rotation, oldest first, using what the
daily scan leaves (about 70 searches a day, so a full pass takes about a
week). The back-test reuses one cached search per entry for every `T` and
filters by publish date, which is why its data collection takes about a
week of quota rather than one search per entry per test case.

## 6. Paper trail and legal risk (gates, not scores)

**Paper trail level**, by lane, recorded with every document found (title,
URL, source):

- Downfalls: CourtListener dockets matching the company, SEC litigation
  releases and AAERs naming it, EDGAR filings (restatements, NT 10-K, 8-K)
  when it is a US filer.
- Success stories: EDGAR annual reports and IPO prospectuses, Companies
  House filings when the key is set.
- Both lanes, and the main route for non-US cases: the English Wikipedia
  article's external references whose domains are courts, regulators,
  parliaments, government inquiries or stock exchanges. The builder writes
  that domain list and commits it before the back-test.

Levels: `none` (killed, reason "not enough public record"), `thin`,
`enough`, `strong`. The cut-offs are counts of distinct primary documents;
the builder sets them before the back-test. The level does not add to the
score. That is what keeps a strong non-US case with one parliamentary
inquiry level with a US case with 400 filings.

**Legal risk flag:**

- Downfalls: `adjudicated` only on a positive signal (a Wikidata conviction,
  P1399, on a linked person; a terminated criminal docket; an AAER or SEC
  final judgment). Otherwise `alleged`. Conservative by design.
- Success stories: `self-reported` when the claims about living founders
  come from no filing, only press and company material.
- Living people: Wikidata founders (P112) and CEOs (P169) with no date of
  death (P570).
- **Kill:** `alleged` and living people named and paper trail `thin` or
  `none`. Reason line, for example "legal: alleged, living founder, thin
  record". Every other combination is shown as a flag on the row.

**Dated like the measurements (builder check, my call).** Gates, lane and
tags also read only what existed before `T`: documents dated before `T`
(docket filing dates, EDGAR filing dates, release dates), and the Wikipedia
article's categories and references as of its last revision before `T`
(the MediaWiki revisions API returns that revision). Live, that is simply
the current revision.

## 7. The rubric (fixed before the back-test)

```
score = 0.40 * D + 0.30 * G + 0.15 * S + 0.15 * W
```

All four inputs are within-lane percentiles (0 to 100), so the score is 0
to 100 and reads as a rank within the lane. Ties broken by D. These weights
are committed with this document; the commit is the pre-registration. They
are stored in one config module the scorer and the back-test both read.

The builder may not change them before the back-test except to fix an
outright bug, and any such fix is recorded in PROGRESS.md with its reason.

## 8. In the app

**Case Library (no new screen).**

- **What a suggestion is (builder check, my call).** The shortlists and the
  kill list are views of hitlist entries, not case rows. They sit as
  groups above the existing case table. An entry's angle, evidence and
  score live on the entry. `Accept` creates the case row, linked to its
  entry by a new nullable column on `cases` (existing rows stay unlinked),
  and copies the evidence snapshot and score onto it, frozen at that date;
  the row also shows the entry's current score next to it. `Dismiss` hides
  the entry from the shortlist for 90 days. The spike card and the alert
  email link to the entry in its shortlist group, whether or not it has a
  case row yet. This replaces today's flow, where `suggestCases` inserts
  `idea` rows directly.
- `Suggest cases` keeps its button. It now takes the top-ranked hitlist
  entries not already in the library, per lane, and asks the model for an
  angle on each.
- **The angle call.** The model receives the entry's fetched primary
  documents (title, URL, short excerpt) and the titles of the kept YouTube
  videos, and returns an angle, a category within the lane, and the URL of
  the document the angle comes from. An answer whose URL is not in the list
  it was given is refused, with the existing repair and notice machinery.
  This replaces the recall prompt; `priorityScore` becomes the rubric score.
- **Link check before save.** Every source URL on a row is fetched; HTTP
  status and page title are recorded, and a row whose cited document fails
  is not saved. (Docket and EDGAR URLs are built by code, so this mainly
  catches Wikipedia references that have rotted.)
- **Two shortlists:** the table shows downfalls and success stories as two
  groups. A strip above them shows the current mix and why, for example
  "success share 40% this month: Nvidia, Novo Nordisk demand up", with a
  button to override.
- **The mix rule:** of the entries put forward, the default is one in three
  success stories. If the median D-raw (raw demand, comparable across
  lanes) of the top ten success entries is more than 1.5 times that of the
  top ten downfalls, the share moves up a step; if it is under two thirds,
  it moves down a step. Steps: 20%, 33%, 40%, 50%. Bounds hold. The
  thresholds are the builder's to tune after shipping; they do not affect
  the back-test.
- **Evidence on the row:** the four percentiles and their raw values, the
  paper-trail level with its documents, the legal flag, the kept YouTube
  videos with outlier ratios, and the date the evidence was measured.
  Layout is the builder's call within the existing row's expandable area.
- **Kill list:** a collapsed group under the shortlists, each entry with
  its one-line reason.

**Daily scan (new cron, after the Wikimedia daily data lands; the builder
picks the hour, not 06:00 UTC, to stay clear of analytics-runner).**

1. Fetch yesterday's English views for every ranked hitlist entry and
   compute S.
2. Candidate spikes: S at least 3 and at least 2,000 extra views over the
   14 days compared with baseline (the floor keeps tiny articles from
   spiking on noise). Thresholds fixed before the back-test.
3. For the top candidates: GDELT article count (spaced 5 seconds apart),
   then YouTube for the top 20 by S (2,000 units at most, leaving the rest
   of the day's quota for the weekly refresh).
4. Alerts: the strongest by S across both lanes, at most five a day.
   One email each through the existing `notify()`, with a new
   `NotificationKind` (for example `case-spike`), plus a Needs-you card on
   the dashboard with a button to open the case row. Example: "Theranos:
   Wikipedia views 9× normal since Tuesday, 412 news articles, 3 new
   YouTube videos this week, last big-channel video 14 months ago".
5. Cooldown: no second alert for the same entry within 14 days unless its
   S has at least doubled since the last alert.
6. Email delivery needs `RESEND_API_KEY` and `NOTIFY_FROM_EMAIL` in
   production with a verified domain. The builder checks; until they are
   set, the card still appears and `notify()` logs.

**Prediction log.** When a project is started from a case, the case's
score, the four percentiles, the raw values, `T` and the weights' version
are written to a dated, append-only record. Twenty-eight days after the
video goes public, the existing analytics snapshots fill in the actual
28-day views and the video's rank among the owner's own long-form videos.
Shown on the case row as predicted versus actual. Nothing is scored or
tuned from it until there are at least 10 published videos.

## 9. The back-test

Runs before anything in section 8 is built (section 10). It is a script
over the shipping scorer, run with real calls on the owner's go-ahead.

### 9.1 The test set

Selection by rule, so it cannot be hand-picked: from each of Bright Sun
Films, MagnatesMedia, Coffeezilla, How Money Works and Modern MBA, take the
most recent long-form uploads (at least 8 minutes) published from 1 January
2018 to 30 June 2026 whose subject is one company or one corporate event,
newest first, until the set has 40 videos. If a channel's subject cannot be
decided from title and description, skip the video and log it. At most 12
from any one channel.

A test video's lane is its mapped QID's lane on the hitlist (as of `T`),
not the video's framing, so a "rise and fall of X" video is a downfall
whenever X carries a downfall tag. **At least 12 must be success stories**
(builder check, my call): once the walk has 28 downfalls, it skips further
downfalls and continues newest first until it has 12 success stories or
runs out of videos, and the report says which.

Each video's subject is mapped to a Wikidata QID. The mapping is proposed
by code, checked by hand, and committed as a fixture before scoring. A
subject that is not on the hitlist is recorded as a **hitlist miss**; the
miss rate is reported, because it says whether the hitlist would have
found the cases real channels chose.

### 9.2 Scoring

For each video, `T` is the day before its publish date. The scorer runs on
the whole hitlist at `T` (percentiles need the lane), excluding the video
itself from its own competition measurement. The floor in section 4 is
applied at `T` too, so a company that only became notable after `T` (FTX,
seen from 2019) falls below it and is not ranked: the hitlist is built today,
but what it ranks at `T` is what was visible at `T`.

### 9.3 The outcome

The video's outlier ratio: its views divided by the median views of the
same channel's long-form uploads published in the 6 months either side.
This corrects for channel growth. Views are today's (the video has had at
least 3 months to settle, because of the 30 June 2026 cut-off). Only
uploads at least 90 days old on the measurement date count towards the
channel median (builder check, my call), so a window that reaches into the
last few weeks is not pulled down by videos still gathering views.

### 9.4 The baseline

Today's method on the same cases: the existing `Suggest cases` system
prompt, asked to give a `priorityScore` for each named test case. One call
on the research tier, cents, approved at run time. It has an unfair
advantage: the model knows which cases became hits. A rubric that beats it
anyway is the stronger result.

### 9.5 The pass rule (fixed now)

- Spearman rank correlation between rubric score and outlier ratio, over
  the whole set, with a bootstrap 90% interval (2,000 resamples).
- The same for the baseline.
- **Pass:** the rubric's correlation is higher than the baseline's, and at
  least 0.30. Both conditions are on the **point estimates** (builder
  check, my call). The intervals, and a paired bootstrap interval of the
  difference, are reported next to them so a narrow win reads as narrow.
- **Cases the rubric cannot rank** (builder check, my call). All 40 cases
  stay in the correlation, and the baseline scores all 40. A hitlist miss,
  an entry below the floor at `T`, outside the top 250 by D, or with
  paper trail `none` gets the lowest score in the set: the rubric would
  never have put it forward, so it is counted as a miss, not quietly left
  out. The **legal kill is not applied** in the back-test: it is the
  channel's editorial rule, not a prediction of views, and Coffeezilla's
  hits are often exactly the alleged cases this channel avoids. The report
  states how many test cases the legal kill would have removed, and gives
  the correlation over the remaining cases as a second figure.
- Reported but not gated: the correlation within each lane (13 success
  stories is too few to gate on; a negative figure there is raised with
  the owner), the hitlist miss rate, and whether the spike signal (S at `T`
  at least 3) went with above-median outlier ratios.
- **Fail:** the owner gets the numbers and the work stops there. Nothing in
  section 8 is built unless the owner decides otherwise.

The report is a markdown file in `docs/` with every case, its four
percentiles, the outcome, the baseline score, and the code version.

## 10. Order of work

1. **Hitlist and fetchers.** The table, the seeders, every fetcher with its
   mock and fixtures, Settings → Connections entries, env seeds and
   `.env.example`.
2. **Scorer.** Measurements, gates and the rubric, as pure functions of
   fetched data and `T`, unit-tested on fixtures.
3. **Back-test.** The selection script, the hand-checked mapping fixture,
   the run, the report. **Gate: the owner reads the report.**
4. **Case Library.** Angle call, link check, two shortlists, mix strip,
   evidence and kill list, weekly hitlist refresh cron.
5. **Daily scan and alerts**, then the **prediction log**.

One branch per step or per pair of steps, merged when green, per the
working rules.

## 11. Left to the builder

- Table and column names, migrations, the fixtures' shape.
- The Fortune climb rule, the paper-trail domain list and level cut-offs,
  the hitlist floor's single adjustment: all before the back-test, all
  recorded in PROGRESS.md.
- Hour of the daily scan; retry and backoff on each fetcher within the
  stated rate limits.
- Exact row layout of the evidence, within the existing expandable row.
- The mix thresholds after shipping.
- Whether the angle call reuses the dossier runner's document handling.
