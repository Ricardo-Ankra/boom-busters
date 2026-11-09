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
