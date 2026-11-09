# Search learning probe

A one-off, read-only probe of two YouTube reports the search learning feature
will use: the search-terms report (`insightTrafficSourceDetail` filtered to
`YT_SEARCH`) and the whole-video engagement totals. It saves the raw responses
for one published video so the design's assumptions can be checked before code
depends on them.

Run from `apps/web` (it reads the owner's analytics, writes nothing to the database):

```
pnpm --filter @boom-busters/web probe:search-terms --channel <slug> [--video <youtubeVideoId>]
```

Files: `01-search-terms-lifetime.json`, `02-search-terms-first-7-days.json`,
`03-totals-first-7-days.json`, `04-video-facts.json`. Each holds the request
URL, the HTTP status and the unedited body.

## Findings

Run on 2026-11-09 against `XO14X8k4_sM` ("From a $9 Billion Valuation to 135
Months in Prison: The Fall of Elizabeth Holmes"), published
2026-10-29T20:00:15Z, `PT16M39S`, public, audio language `en-US`.

- **Every report was accepted.** The combined filter
  `video==<id>;insightTrafficSourceType==YT_SEARCH` works, and so do the
  date-bounded ranges (2026-10-29 to 2026-11-05). The traffic source key is
  `YT_SEARCH`, as the filter's acceptance shows.
- **Search terms: 3 rows, 1 view each** (`jeopardy full`, `john carreyrou`,
  `you can see everything review`), the same over the lifetime and the first
  seven days. The 25-row cap was not reached, so whether YouTube cuts at 25
  stays unconfirmed; the code keeps `maxResults=25`.
- **`estimatedMinutesWatched` is a whole number.** Each of the three terms shows
  `0` minutes. Hold computed from one or two views is meaningless at that
  precision; the floors (20 target views, 50 listed views) already keep such a
  video out of judgement, so no constant changes.
- **Totals, first seven days:** 359 views, 302 s average view duration,
  0 subscribers gained, 1 like, 2 comments. All five metrics are accepted in one
  report.
- **Search share is tiny today:** 3 listed search views of 359. A report for
  this video would read "Search barely played". Until the channel's videos draw
  search traffic, most reports will say so, and the track record will wait.
- **Duration** comes as ISO 8601 (`PT16M39S`) from `contentDetails.duration`,
  as Task 3 parses it.
- Not checked: the `YT_SEARCH` total from the source-type report (the snapshot
  already stores it), so whether listed views fall short of it is unknown here.

No Task 3 constant changes.
