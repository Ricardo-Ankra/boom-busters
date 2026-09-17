# Headline shots: a real news headline as a slot type

**Date:** 2026-09-17. **Status:** draft for review. **Decision:** 257.
**Approved treatment:** the clipping (option A of the 2026-09-17 mock-up).

## Problem

The film quotes reporting constantly and has no way to show it. A sentence
like "the Financial Times reported that the auditors could not find the
money" currently plays over a stock shot of an office, which is the weakest
frame in the vocabulary: it carries none of the authority the narration is
borrowing.

A headline card carries it. It is also the single most dangerous card in the
set, because it looks like evidence. A wrong byline, a wrong date, or an
invented headline is not a visual defect, it is a false statement attributed
to a real publication and a real journalist. So the design question is not
"how do we draw it" (the mock-up settled that) but "where does every string
on it come from, and who is allowed to supply it".

That question has one answer running through the whole design: **the
shot-list model never writes the article's facts.** It picks a claim. The
app reads the article's own declared metadata from the URL that claim was
sourced with.

## What the card shows, and who supplies it

| Field | On the card | Supplied by |
| --- | --- | --- |
| Outlet | Masthead, top left | The article's own metadata, or the owner |
| Publication date | Top right | The article's own metadata, or the owner |
| Headline | The body of the card | The article's own metadata, or the owner |
| Standfirst (deck) | Under the headline, optional | The article's own metadata, kept or cleared by the owner |
| Author | "By ..." bottom left | The article's own metadata, or the owner. May be absent |
| Source | Domain and path, bottom right | Derived from the claim's URL |
| Highlighted phrase | Marker under part of the headline | Heuristic suggestion, owner overrides. Optional |
| Logo | Never shown | Nobody. There is no field for it |

Three of those say "or the owner", which is the fallback path, and it is not
an edge case: a paywalled article can still refuse us its metadata. The
manual path has to be as good as the fetched one.

## Design

### 1. The brief cites a claim, never a URL

The shot-list model already cites claims by number. Chart briefs carry
`dataRefs: [3, 7]` on the wire, and `resolvePlannedBrief` maps those numbers
to claim ULIDs, dropping the slot when a number points outside the list.
Headline briefs do the same with one number.

The wire shape the model emits:

```json
{ "type": "headline", "coversText": "...", "description": "...",
  "shotSize": "graphic", "motion": {"kind": "static"}, "transition": "cut",
  "sourceRef": 3 }
```

The stored brief, after mapping:

```ts
{ type: 'headline', ...briefCommon, sourceClaimId: Ulid,
  emphasis?: string, showDeck?: boolean }
```

The model sees claim text, never claim URLs, so it cannot type a URL, an
outlet, a byline or a date. It picks the claim whose reporting the narration
is leaning on, and that is the only judgement it makes.

Two validations at mapping time, both dropping the slot the way a chart
citing an unknown claim is dropped today:

- the number must resolve to a claim in the list;
- that claim must have `sourceType = 'major_outlet'` and a surviving
  `sourceUrl`.

To let the model aim rather than guess, `claimList` gains one marker on
qualifying claims, alongside the existing ADJUDICATED and UNVERIFIED flags:

```
[3] (id: 01HQ...) Auditors told investigators the escrow accounts did not
exist — ADJUDICATED — NEWS ARTICLE
```

`ScriptClaim` gains `sourceType`, which every prompt already has in hand at
the call site: `scriptableClaims` already returns it and the runner simply
drops it today.

One planning rule goes with the type: **at most one headline shot per
chapter, and never two in a row.** It is a bright card in a dark film and it
works by being rare. The rule lives in the prompt, and the runner enforces it
by dropping the surplus, because a prompt rule with no enforcement is a
suggestion.

### 2. Article metadata is cached against the URL, not the slot

The fetched facts do not belong on the slot row, for two reasons. The
no-waste guard hashes the brief and re-fetches when the hash changes, so
resolution writing into the brief would loop. And one article can back
several claims, several shots and several films: an article's byline and
publication date are fixed forever once published, so fetching them twice is
waste.

So a new global table, `article_sources`, keyed by normalised URL:

```
url            text primary key   normalised (see below)
outlet         text null
headline       text null
author         text null
publishedAt    date null
description    text null          the standfirst, as the page declares it
provenance     jsonb              per field: jsonld | og | meta | title | domain | manual
status         enum               fetched | manual | failed
failureReason  text null
fetchedAt      timestamptz
updatedAt      timestamptz
```

Normalisation, so the same article is one row: lowercase scheme and host,
drop `www.`, drop the fragment, drop tracking parameters (`utm_*`, `fbclid`,
`gclid`, `ref`, `s`), drop a trailing slash, keep everything else. Path case
is preserved, because some sites are case sensitive.

`status = 'manual'` is sticky. A record the owner has corrected is never
overwritten by a later fetch, the same rule `setMusicBedDuration` follows for
music lengths: automation fills blanks, it does not argue with a human.

### 3. The fetch: exactly what we ask for

A new provider module, `packages/providers/src/article/`, behind the same
rules as every other adapter: a pure async function over a URL, no database,
no cost recording, no retry policy of its own, and a mock twin selected by
`MOCK_PROVIDERS=1`.

The request:

- `GET` the normalised URL.
- `User-Agent: boom-busters/1.0 (single-user production console)`, the same
  honest string the Wikimedia adapter uses. No browser spoofing.
- `Accept: text/html, application/xhtml+xml`.
- No cookies, no credentials, no referrer.
- `redirect: 'manual'`, following hops ourselves, at most 5, so the guard in
  the next paragraph runs again on every hop.
- `AbortSignal.timeout(8000)` for the whole attempt.
- One retry, after 1 second, on a network error or a 5xx. A 403, 404 or 429
  is not retried: those are answers, not failures.
- Response must declare an HTML content type, or the attempt fails.
- The body is read as a stream and abandoned at the first of `</head>` or
  512 KB. We need the head; some article pages are several megabytes.

**The guard.** The URL originates from the research model, which means it is
attacker-adjacent input: a poisoned source could point at infrastructure
rather than at a newspaper. Before each hop, `safeArticleUrl` rejects any URL
whose scheme is not http or https, whose port is not 80 or 443, whose
hostname is a raw IP or ends in `.local`, or whose DNS resolution (all
records, via `dns.promises.lookup({ all: true })`) includes a loopback,
private, link-local, unique-local or carrier-grade NAT address. This is a
small pure module with its own tests, and it is the only genuinely
security-relevant code in the feature.

We do not read `robots.txt`. We fetch one page a human has already cited,
once, and cache it forever, which is closer to a person opening the link than
to crawling.

### 4. The extract: field by field, in order

A small dependency, `node-html-parser`, parses the captured head. Regular
expressions over HTML are how this goes wrong, and the whole-DOM libraries
(jsdom, already a dev dependency here) are far too heavy for a serverless
function.

Every field records where it came from, and the board shows that provenance,
so "the outlet was guessed from the domain" is visible at a glance rather
than hidden behind a confident-looking card.

**Headline**

1. JSON-LD `headline`, from a block whose `@type` is `NewsArticle`,
   `ReportageNewsArticle`, `Article` or `BlogPosting`.
2. `<meta property="og:title">`.
3. `<meta name="twitter:title">`.
4. `<title>`, with a trailing site suffix removed: ` | Outlet`, ` - Outlet`,
   ` — Outlet` where the tail matches the outlet we resolved.

Then: decode entities, collapse whitespace, strip surrounding quotes. Never
truncated. A headline over 200 characters is flagged on the board rather
than trimmed, because trimming a quotation misquotes it.

**Outlet**

1. JSON-LD `publisher.name`.
2. `<meta property="og:site_name">`.
3. `<meta name="application-name">`.
4. The registrable domain, title-cased, recorded as provenance `domain` so
   the board can mark it as a guess.

**Author**

1. JSON-LD `author`, which arrives as an object, an array of objects, or a
   bare string. Take `name` from each. One name renders as is, two join with
   "and", three or more render as the first followed by "and others".
2. `<meta name="author">`.
3. `<meta property="article:author">`, used only when the value is a name
   rather than a URL, which is the common failure of this tag.
4. Absent. A wire story genuinely has no byline, and the card must render
   without one. No guessing.

Then: strip a leading "By " (the card prints its own), collapse whitespace.

**Publication date**

1. JSON-LD `datePublished`.
2. `<meta property="article:published_time">`.
3. `<meta name="date">`, `<meta name="DC.date.issued">`,
   `<meta itemprop="datePublished">`.
4. Absent.

`dateModified` is never promoted to the publication date, under any
circumstances. It is the single most tempting fallback here and it is exactly
the misattribution the format exists to avoid: an article republished in 2024
would appear on screen as having been written in 2024. If only a modified
date exists, the field stays empty and the board asks for it.

Parsed with `Date.parse` against ISO 8601, then stored at day precision. A
date that will not parse, or that lands in the future or before 1900, is
treated as absent.

**Standfirst**

JSON-LD `description`, then `<meta property="og:description">`. Stored
always, rendered only when the brief sets `showDeck`. Default off: these
strings are often a truncated teaser rather than the real standfirst, and the
card reads well without one. The board offers a checkbox.

### 5. A worked example

```html
<head>
  <title>Auditors cannot find the $1.9bn the company says it holds | The Financial Record</title>
  <meta property="og:site_name" content="The Financial Record">
  <meta property="og:title" content="Auditors cannot find the $1.9bn the company says it holds">
  <meta property="article:published_time" content="2023-03-14T06:02:11Z">
  <meta name="author" content="Elena Marsh">
  <script type="application/ld+json">
   {"@type":"NewsArticle","headline":"Auditors cannot find the $1.9 billion the company says it holds",
    "datePublished":"2023-03-14T06:02:11Z","dateModified":"2023-03-16T09:40:00Z",
    "author":[{"@type":"Person","name":"Elena Marsh"}],
    "publisher":{"@type":"Organization","name":"The Financial Record"}}
  </script>
</head>
```

Yields:

```
headline    "Auditors cannot find the $1.9 billion the company says it holds"  jsonld
outlet      "The Financial Record"                                              jsonld
author      "Elena Marsh"                                                       jsonld
publishedAt 2023-03-14                                                          jsonld
```

Note the two headlines differ: JSON-LD says "$1.9 billion", Open Graph says
"$1.9bn". JSON-LD wins because it is the publisher's structured record of the
article rather than its social-sharing copy, and `dateModified` is ignored
even though it is right there.

### 6. When it fails, which will be often enough to design for

Paywalls, consent interstitials, bot walls, dead links and pages with no
metadata at all land in one place: the record is stored with
`status = 'failed'` and the reason, the slot resolves to `placeholder`, and
the stage carries on. This is the existing tolerance policy, unchanged: a
placeholder is a card that needs a human, not a failed run.

Two things soften it.

**One archive attempt.** On failure, query
`https://archive.org/wayback/available?url=...`, and if a snapshot exists,
extract from the snapshot instead, recording provenance as `archive`. It is
keyless, it costs nothing, and it is the difference between working and not
working for the decade-old reporting this channel cites. The archived
metadata is the article's own, captured at the time.

**The manual form.** The board card for a headline slot always shows four
editable fields and the source URL as a link. Filling them writes
`status = 'manual'` on the article record and resolves the slot. For a
paywalled article this is the normal path, not a repair, and it must read
that way: "Open the article and fill these in", not an error.

### 7. The highlighted phrase

`emphasis` cannot be planned, because at plan time nobody knows the headline.
It is chosen after the metadata arrives, by a heuristic with no model call:
the first span in the headline matching a money amount, a percentage or a
multi-digit number, extended to include an adjacent scale word (billion,
million, bn, m). In this channel's material that is nearly always the phrase
the narration is on. The board shows it as a suggestion in a text field; the
owner types anything else, or clears it.

Validation: `emphasis` must occur verbatim in the headline after whitespace
collapsing, or it is dropped rather than approximated. A card with no
highlight is a good card.

### 8. Through the timeline to the frame

A headline slot resolves like a chart: the payload is the facts, there are no
candidates and nothing is downloaded. `resolveSlotBrief` gains a `headline`
case that reads or fetches the article record and returns
`{ candidates: [], status: record.headline ? 'resolved' : 'placeholder' }`.

At assembly, `slotPlan` reads the article record and embeds the strings in
the timeline payload, exactly as chart payloads embed their series. A
timeline is a self-contained snapshot: a render six months later must not
depend on the article still being online, or on the record not having been
edited since.

```ts
HeadlinePayloadSchema = {
  kind: 'headline',
  outlet: string, headline: string, publishedAt: string /* YYYY-MM-DD */,
  author?: string, deck?: string, emphasis?: string,
  sourceLabel: string,  // "financialrecord.com/2023/03/14", for the card
  sourceUrl: string,    // the full URL, for the audit trail
  claimId: Ulid,        // the claim this shot cites
}
```

The composition is the approved clipping, with the portrait and
over-footage behaviours from the mock-up. The date is formatted by a
12-entry month table rather than `Intl`, so a golden frame renders the same
on every machine.

One new font: Source Serif 4, SIL OFL 1.1 like the rest, added to the
catalogue and the loader. Compositions changing means the feature does not
reach a render until `pnpm --filter @boom-busters/infra deploy:remotion`
runs.

### 9. Mock mode

`MOCK_PROVIDERS=1` selects a mock extractor that returns deterministic
metadata derived from the URL and never opens a socket, so e2e and CI stay
offline. This is the same registry switch the stock and image adapters use.

## Data and contract changes

- `shot_type` enum and `SHOT_SLOT_TYPES`: add `headline`.
- `TIMELINE_SLOT_TYPES` and `SLOT_PAYLOAD_KINDS`: add `headline`.
- New `article_sources` table and one migration.
- New schemas: `HeadlineBriefSchema`, `PlannedHeadlineBriefSchema`,
  `HeadlinePayloadSchema`, `ArticleMetadataSchema`.
- `resolvePlannedBrief` maps `sourceRef` to `sourceClaimId` and enforces the
  news-source rule.
- `ScriptClaim` gains `sourceType`; `claimList` gains the NEWS ARTICLE marker.
- `convertBrief`: converting *to* headline returns null (it needs a claim,
  which no string supplies), so the board offers a picker of the project's
  news-sourced claims instead. Converting *from* headline works mechanically
  through `description`, like every other text type.
- New provider module `article/` with `fetchArticleMetadata`, `extract`,
  `safeArticleUrl`, a mock, and a registry entry.
- New dependency: `node-html-parser` in `packages/providers`.

## Rules with teeth

Enforced in code, not in prompt etiquette:

1. A headline brief with no `sourceClaimId` fails validation. There is no
   shape in which the model supplies the article's facts directly.
2. A claim that is not a news source, or has no URL, cannot back a headline
   slot. The slot is dropped at plan time with a reason.
3. No headline string means `placeholder`, which means the slot never
   renders and the board shows what is missing.
4. `emphasis` must occur in the headline or it is dropped.
5. `dateModified` is never shown as the publication date.
6. There is no logo field, no outlet-supplied image field, and no
   per-outlet styling. One house format, whatever ran the story.
7. A human-corrected article record is never overwritten by a fetch.

## Testing

- `extract`: table-driven against saved HTML heads covering JSON-LD present
  and absent, `og` only, `<title>` only, author as string, object and array,
  `dateModified` without `datePublished`, entity-encoded headlines, and a
  consent-wall page with no metadata.
- `safeArticleUrl`: loopback, private ranges, link-local, CGNAT, raw IPs,
  odd ports, redirect chains that end somewhere private.
- URL normalisation: tracking parameters, fragments, trailing slashes, case.
- `resolvePlannedBrief`: a headline citing a non-news claim, an out-of-range
  number, a claim with no URL.
- `emphasis` heuristic and its substring validation.
- Compiler: a headline slot through `slotPlan` to a byte-stable timeline.
- Composition: one golden frame, wide, at a frame past the marker sweep.
- E2E in mock mode: plan, fetch, correct a field by hand, approve.

## Out of scope, deliberately

- Screenshotting the live page. It reproduces the layout, the photography,
  the credit and the logo, where the card reproduces one line and hands back
  an attribution.
- Per-outlet visual styling, for the reason above and the legal one.
- Fetching the article body. The card takes a headline, a standfirst, a
  name and a date, and nothing else.
- The stack of three clippings (option C of the mock-up). Worth building
  once the single card is in use, and it needs three sourced articles rather
  than one.
