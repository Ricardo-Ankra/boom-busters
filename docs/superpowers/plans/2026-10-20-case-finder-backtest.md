# Case finder, part 1: hitlist, scorer and back-test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the hitlist, the evidence fetchers and the shipping scorer, then back-test that scorer against 40 real competitor videos and write the report the owner reads before anything else is built.

**Architecture:** A new workspace package `@boom-busters/case-finder` holds three layers. `sources/` are fetchers (injected `fetch`, a polite rate-limited client with a disk cache, a mock per source behind `mockProvidersEnabled`). `score/` is pure: measurements, gates and the rubric as functions of fetched evidence and an as-of date `T`, with no I/O. `backtest/` selects the test set, computes outcomes, the baseline and the statistics, and writes the report. A CLI script wires them together. The app is not touched in this plan except one exported prompt builder and the env schema.

**Tech Stack:** TypeScript (ESM, strict), zod 4, vitest 4, tsx for the CLI, pnpm workspace, turbo. No new runtime dependencies beyond `node-html-parser` (already used by `@boom-busters/providers`).

**Spec:** `docs/superpowers/specs/2026-10-20-case-finder-evidence-ranking-design.md` (committed as b5d5e4d, the pre-registration). This plan covers its section 10 steps 1 to 3. Steps 4 and 5 get their own plans after the owner reads the back-test report.

## Global Constraints

- Rubric weights, verbatim: `score = 0.40 * D + 0.30 * G + 0.15 * S + 0.15 * W`, all inputs within-lane percentiles 0 to 100, ties broken by D.
- Ranked population: top 250 entries per lane by D at `T`. Floor: English median monthly views over the 24 months before `T` below 300 is not ranked.
- Long-form means at least 8 minutes. Search keeps the top 25 results. Recent strong coverage window: 24 months before `T`. Outlier ratio capped at 5 inside `C`.
- Timeliness window: 14 days before `T` against the median 14-day total over the 365 days before that.
- Test set: 40 videos from Bright Sun Films, MagnatesMedia, Coffeezilla, How Money Works and Modern MBA, published 1 January 2018 to 30 June 2026, at most 12 per channel, at least 12 success stories.
- Outcome: views over median views of the same channel's long-form uploads within 6 months either side, counting only uploads at least 90 days old on the measurement date.
- Pass: Spearman(rubric) > Spearman(baseline) and Spearman(rubric) ≥ 0.30, on point estimates; bootstrap 90% intervals with 2,000 resamples reported, plus a paired interval of the difference.
- Mock by default: `MOCK_PROVIDERS=1` never touches the network; live calls require the CLI's `--live` flag, and the paid baseline call requires `--baseline` as well.
- Free sources only. The baseline LLM call is the one paid call; it runs only on the owner's go-ahead at run time.
- Every weight, threshold, cut-off and list in `packages/case-finder/src/config.ts` is committed before any live fetch of test data (Task 13 refuses to run otherwise, see there). A change after the run invalidates the result (spec, anti-goals).
- Contact for User-Agent headers comes from `DATA_CONTACT_EMAIL`, never `OWNER_EMAIL`.
- Naming: kebab-case `boom-busters` / `case-finder`. Owner-facing copy follows the house rules (no em or en dashes in report prose).
- Zero-warning lint, strict typecheck, Prettier clean (`pnpm format:check` on tracked files) before every commit.

## Decisions this plan makes (the spec left them to the builder, all before the back-test)

Recorded in PROGRESS.md in Task 14 and fixed in `config.ts`:

1. **Paper-trail levels**, by distinct primary documents dated before `T`: `none` 0, `thin` 1 to 2, `enough` 3 to 9, `strong` 10 or more.
2. **Primary reference domains** (Wikipedia external links that count as primary): hosts ending in `.gov`, `.gov.uk`, `.gov.za`, `.gov.au`, `.gc.ca`, `.gov.in`, `.go.jp`, `.gouv.fr`, `.bund.de`, `.europa.eu`; and the hosts `sec.gov`, `justice.gov`, `courtlistener.com`, `supremecourt.gov`, `judiciary.uk`, `bailii.org`, `saflii.org`, `austlii.edu.au`, `canlii.org`, `parliament.uk`, `aph.gov.au`, `parliament.gov.za`, `fca.org.uk`, `bafin.de`, `finra.org`, `jse.co.za`, `asic.gov.au`, `sfc.hk`, `mas.gov.sg`, `sebi.gov.in`, `cvm.gov.br`, `amf-france.org`, `consob.it`, `fsca.co.za`, `cftc.gov`, `ftc.gov`, `fdic.gov`, `federalreserve.gov`, `oig.*` (any host whose first label is `oig`). Subdomains of a listed host count.
3. **Fortune climb rule** (success-lane seed): a company whose best Fortune 500 rank improved by at least 200 places within any 10 consecutive list years, or whose first appearance was after 1970 and who later reached the top 100.
4. **EDGAR forms counted**: success lane `10-K`, `20-F`, `40-F`, `S-1`, `F-1`, `424B4`; downfall lane `NT 10-K`, `NT 20-F`, `10-K/A`, and `8-K` whose items include `4.02`. The company's CIK comes from Wikidata P5531.
5. **Revision dates are quantised** to the first day of `T`'s month (the last revision before that day). Still strictly before `T`, and it lets 40 test dates share about 30 cached revision sets.
6. **Pageviews include redirects**: an entry's views are the sum over its title and every redirect to it, so a renamed article keeps its history. *(Amended 2026-10-22, owner's choice of option 2, ruling R18: only redirects that are former titles count, found by a batched check of each redirect's latest revision for a page-move summary or the {{R from move}} template; alternative-spelling redirects are left out because fetching them all would take days under Wikimedia's throttle, and they carry little traffic.)*
7. **Query rule**: an entry's YouTube and title-match query is its English title with any trailing parenthetical removed (`Enron (company)` gives `Enron`); a video counts only if the query appears in its title as a whole word, case-insensitive.
8. **Companies House and GDELT are deferred** to the later plans: the back-test uses neither (GDELT only feeds the daily scan; Companies House is optional per the spec).
9. **Keys for this plan come from env**, read by the CLI from `.env.local`: `YOUTUBE_DATA_API_KEY`, `COURTLISTENER_TOKEN`, `DATA_CONTACT_EMAIL`. Settings → Connections entries move to the Case Library plan, where the app first needs them.
10. **Raw cache** lives in `.cache/case-finder/` at the repo root (gitignored). The run's hitlist snapshot and per-case table go in the report folder `docs/case-finder/`; the hand-checked subject mapping is a committed fixture.
11. **Channel medians (owner's ruling 2026-10-21, supersedes controller ruling R2):** uploads are fetched only for channels with a video that passes the coverage filters at `T`, paged back until the window six months before the oldest counted video is covered, the uploads end, or `CHANNEL_HISTORY_MAX_PAGES` (20) is reached; a counted video's median uses the outcome's peer rule (six months either side, settled 90 days on the fetch date, itself excluded); a capped channel falls back to its latest 50 long-form uploads, counted in the report. See spec section 5, "Channel medians within the quota". Built as Task 13b.

## Review Focus

1. **A renamed Wikipedia article.** Pageviews are per title, so the old title's history vanishes unless redirects are summed. Expect the history to survive. Test in Task 3.
2. **The YouTube quota runs out mid-run.** Expect the run to stop cleanly with everything fetched so far cached, and a rerun the next day to spend no units on cached calls. Tests in Task 5 and Task 13.
3. **A company with no English article.** Expect D raw 0 (so not ranked), W still computed, no crash. Test in Task 8.
4. **A generic company name** ("Apple", "Visa", "Shell"). Expect only titles containing the whole-word query to count, so "Applebee's" and "pineapple" do not. Test in Task 8.
5. **An article created after July 2015, or with zero-view months.** Expect missing months counted as 0 in the median, not skipped. Test in Task 8.

---

## File structure

```
packages/case-finder/
  package.json, tsconfig.json, vitest.config.ts
  src/
    index.ts                 public exports
    types.ts                 shared types (Task 1)
    config.ts                every pre-registered number and list (Task 1)
    stats.ts                 percentile, median, Spearman, seeded bootstrap (Task 1)
    sources/
      http.ts                politeFetch: UA, per-host spacing, retry, disk cache (Task 2)
      quota.ts               YouTube unit ledger (Task 2)
      pageviews.ts           Wikimedia pageviews (Task 3)
      wikidata.ts            SPARQL + entity facts (Task 3)
      wikipedia.ts           categories, list links, redirects, revision at date, parse (Task 4)
      youtube.ts             search, videos, channel uploads, handle lookup (Task 5)
      courtlistener.ts       docket search (Task 6)
      edgar.ts               submissions by CIK, form counting (Task 6)
      sec-releases.ts        AAER and litigation release indexes (Task 6)
      mock.ts                one mock per source, deterministic (each source task adds its own)
      fixtures/              recorded sample responses for parser tests
    hitlist/
      seeds.ts               category, list, Wikidata, LoPucki and Fortune seeders (Task 7)
      fortune.ts             the climb rule (Task 7)
      build.ts               resolve to QID, tags, lane (Task 7)
    score/
      measure.ts             D, W, S, G raw values (Task 8)
      gates.ts               paper-trail level, legal flag, kill (Task 9)
      rank.ts                population, percentiles, rubric, ordering (Task 10)
    evidence.ts              gather EntryEvidence for an entry at T from sources (Task 11)
    backtest/
      subjects.ts            channel walk, subject proposal, lane quota (Task 12)
      outcome.ts             outlier ratio of a test video (Task 12)
      baseline.ts            today's priorityScore on named cases (Task 13)
      report.ts              statistics and markdown report (Task 13)
  fixtures/backtest-subjects.json   hand-checked mapping (Task 12, committed)
  scripts/backtest.ts               the CLI (Task 13)
packages/providers/src/prompts/cases.ts   + buildScoreNamedCasesRequest, parseNamedCaseScores (Task 13)
packages/schemas/src/env.ts               + caseFinder env group (Task 2)
.env.example, .gitignore                  (Task 2)
docs/case-finder/                          report output (Task 14)
```

---

### Task 1: Package, shared types, pre-registered config, statistics

**Files:**
- Create: `packages/case-finder/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, `src/types.ts`, `src/config.ts`, `src/stats.ts`
- Test: `packages/case-finder/src/config.test.ts`, `packages/case-finder/src/stats.test.ts`

**Interfaces:**
- Produces, in `types.ts`:
  ```ts
  export type Lane = 'downfall' | 'success'
  export type IsoDate = string // 'YYYY-MM-DD'
  export interface HitlistEntry {
    qid: string; enTitle: string | null; query: string | null
    sitelinks: Record<string, string> // e.g. { dewiki: 'Wirecard' }
    tags: DatedTag[]; country: string | null; cik: string | null
  }
  export interface DatedTag { tag: string; lane: Lane; since: IsoDate | null } // since null = undated (hindsight noted)
  export interface MonthlyViews { month: string; views: number } // 'YYYY-MM'
  export interface DailyViews { date: IsoDate; views: number }
  export interface YoutubeVideo { id: string; channelId: string; title: string; publishedAt: IsoDate; durationSec: number; views: number }
  export interface ChannelUploads { channelId: string; uploads: YoutubeVideo[] }
  export type DocumentSource = 'courtlistener' | 'edgar' | 'sec-aaer' | 'sec-litigation' | 'wikipedia-reference'
  export interface PrimaryDocument { url: string; title: string; source: DocumentSource; datedAt: IsoDate | null }
  export interface Person { qid: string; name: string; living: boolean; convicted: boolean }
  export interface EntryEvidence {
    entry: HitlistEntry; asOf: IsoDate
    enMonthly: MonthlyViews[]; worldMonthly: MonthlyViews[]; enDaily: DailyViews[]
    search: { fetchedAt: IsoDate; videos: YoutubeVideo[] } | null // null = not measured (outside top 250)
    channels: Record<string, ChannelUploads>
    documents: PrimaryDocument[]; people: Person[]
    tagsAtT: DatedTag[] // tags whose since < asOf, plus category tags from the revision at asOf
  }
  ```
- Produces, in `config.ts`: `WEIGHTS = { D: 0.40, G: 0.30, S: 0.15, W: 0.15 } as const`, `RANKED_PER_LANE = 250`, `FLOOR_MEDIAN_MONTHLY = 300`, `DEMAND_WINDOW_MONTHS = 24`, `SPIKE_WINDOW_DAYS = 14`, `SPIKE_BASELINE_DAYS = 365`, `LONG_FORM_MIN_SEC = 480`, `SEARCH_RESULTS = 25`, `COVERAGE_WINDOW_MONTHS = 24`, `OUTLIER_CAP = 5`, `PAPER_TRAIL_LEVELS = { thin: 1, enough: 3, strong: 10 }`, `PRIMARY_DOMAIN_SUFFIXES`, `PRIMARY_HOSTS`, `EDGAR_FORMS = { success: [...], downfall: [...] }`, `FORTUNE_CLIMB = { places: 200, years: 10, lateEntryAfter: 1970, topRank: 100 }`, `BACKTEST = { from: '2018-01-01', to: '2026-06-30', size: 40, maxPerChannel: 12, minSuccess: 12, outcomeWindowMonths: 6, settledDays: 90, bootstrap: 2000, seed: 20261020, passRho: 0.30, intervalLevel: 0.90 }`, `CHANNEL_HANDLES = ['@BrightSunFilms', '@MagnatesMedia', '@Coffeezilla', '@HowMoneyWorks', '@ModernMBA']`, `CONFIG_VERSION = 1`. Values from the Global Constraints and the Decisions list, verbatim.
- Produces, in `stats.ts`: `median(xs: number[]): number`, `percentileRanks(values: number[]): number[]` (0 to 100, ties get the average rank), `spearman(x: number[], y: number[]): number`, `bootstrapInterval(pairs: [number, number][], stat: (p: [number, number][]) => number, resamples: number, level: number, seed: number): [number, number]`, `mulberry32(seed: number): () => number`.

- [ ] **Step 1: Scaffold the package** on the `@boom-busters/cost` pattern (`type: module`, `exports` `.` to `./src/index.ts`, scripts `typecheck`, `test`, plus `"backtest": "tsx --env-file-if-exists=../../.env.local scripts/backtest.ts"`). Dependencies: `@boom-busters/providers`, `@boom-busters/schemas`, `node-html-parser`, `zod`. vitest config: node environment, `src/**/*.test.ts`. Run `pnpm install`; expect the workspace to link it.

- [ ] **Step 2: Write the failing tests**

```ts
// config.test.ts
it('weights are the pre-registered ones and sum to 1', () => {
  expect(WEIGHTS).toEqual({ D: 0.4, G: 0.3, S: 0.15, W: 0.15 })
  expect(WEIGHTS.D + WEIGHTS.G + WEIGHTS.S + WEIGHTS.W).toBeCloseTo(1, 10)
})
it('pins the back-test rule', () => {
  expect(BACKTEST).toMatchObject({ size: 40, maxPerChannel: 12, minSuccess: 12, passRho: 0.3, bootstrap: 2000 })
})
// stats.test.ts
it('percentile ranks give ties the average', () => {
  expect(percentileRanks([10, 20, 20, 40])).toEqual([0, 50, 50, 100])
})
it('a single value ranks 100', () => expect(percentileRanks([7])).toEqual([100]))
it('spearman is 1 for a monotone pair and -1 reversed', () => {
  expect(spearman([1, 2, 3, 4], [10, 20, 30, 1000])).toBeCloseTo(1)
  expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1)
})
it('spearman handles ties with average ranks', () => {
  expect(spearman([1, 2, 2, 3], [1, 2, 3, 4])).toBeCloseTo(0.9487, 3)
})
it('bootstrap is reproducible from its seed and brackets the point estimate', () => {
  const pairs: [number, number][] = Array.from({ length: 30 }, (_, i) => [i, i + ((i * 7) % 5)])
  const a = bootstrapInterval(pairs, (p) => spearman(p.map((q) => q[0]), p.map((q) => q[1])), 2000, 0.9, 1)
  const b = bootstrapInterval(pairs, (p) => spearman(p.map((q) => q[0]), p.map((q) => q[1])), 2000, 0.9, 1)
  expect(a).toEqual(b)
  expect(a[0]).toBeLessThanOrEqual(spearman(pairs.map((q) => q[0]), pairs.map((q) => q[1])))
})
```

- [ ] **Step 3: Run** `pnpm --filter @boom-busters/case-finder test`. Expected: FAIL, modules not found.

- [ ] **Step 4: Implement** `types.ts`, `config.ts`, `stats.ts`. Percentile rank of value i is `100 * (averageRank_i - 1) / (n - 1)`, with n = 1 giving 100. Spearman is Pearson on average ranks. Bootstrap: percentile method, resample pairs with replacement using `mulberry32(seed)`.

- [ ] **Step 5: Run** the package tests, `pnpm typecheck`, `pnpm lint`. Expected: PASS, zero warnings.

- [ ] **Step 6: Commit** `feat(case-finder): package, pre-registered config and rank statistics`.

---

### Task 2: Polite HTTP client, disk cache, quota ledger, env

**Files:**
- Create: `packages/case-finder/src/sources/http.ts`, `src/sources/quota.ts`
- Modify: `packages/schemas/src/env.ts` (new optional group `caseFinder: ['DATA_CONTACT_EMAIL', 'YOUTUBE_DATA_API_KEY', 'COURTLISTENER_TOKEN']`, each optional), `.env.example` (the three, with a comment naming the spec and saying the YouTube key must come from a separate Google Cloud project), `.gitignore` (`.cache/`)
- Test: `src/sources/http.test.ts`, `src/sources/quota.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks besides config.
- Produces:
  ```ts
  export interface PoliteClientOptions {
    contact: string                    // DATA_CONTACT_EMAIL
    cacheDir: string | null            // null = no disk cache (tests)
    fetchImpl?: typeof fetch
    minIntervalMs?: Record<string, number> // per host
    now?: () => Date
  }
  export interface PoliteClient {
    getJson<T>(url: string, schema: z.ZodType<T>, init?: { headers?: Record<string, string>; cacheKey?: string; maxAgeDays?: number }): Promise<{ data: T; fetchedAt: IsoDate; fromCache: boolean }>
    getText(url: string, init?: {...same}): Promise<{ data: string; fetchedAt: IsoDate; fromCache: boolean; status: number }>
  }
  export function createPoliteClient(options: PoliteClientOptions): PoliteClient
  export class QuotaExhaustedError extends Error {}
  export interface QuotaLedger { spend(units: number): void; remaining(): number }
  export function createQuotaLedger(dailyUnits: number, spentToday: number): QuotaLedger
  ```
  User-Agent: `boom-busters-case-finder/1.0 (+${contact})`. Default spacing: `wikimedia.org` and `wikipedia.org` 50 ms, `wikidata.org` 1000 ms, `sec.gov` 120 ms, `courtlistener.com` 800 ms, `googleapis.com` 0. Retry once on network error or 5xx after 1 s; 429 waits for `Retry-After` (cap 60 s) then retries once. Cache key: `cacheKey ?? url` with any `key=` or `token` query value stripped, hashed to a file `<host>/<sha1>.json` holding `{ fetchedAt, status, body }`. A cached entry younger than `maxAgeDays` (default: never expires) is returned without a request. Secrets never appear in cache keys or file contents.

- [ ] **Step 1: Write the failing tests:** `'sends the contact in the User-Agent'`; `'a second identical call is served from cache with fromCache true and no fetch'`; `'the API key is stripped from the cache key'` (two URLs differing only in `key=` share one cache file, and the file does not contain the key); `'spaces calls to the same host by minIntervalMs'` (fake timers, two calls 1000 ms apart for wikidata.org); `'retries a 503 once, then throws'`; `'a 404 is returned for getText with status 404 and not retried'`; `'ledger throws QuotaExhaustedError when a spend would pass the daily units, before spending'`.

- [ ] **Step 2: Run** them. Expected: FAIL.

- [ ] **Step 3: Implement** `http.ts` and `quota.ts` with `node:crypto` sha1 and `node:fs/promises`. Validate JSON with the given zod schema; a schema failure throws an Error naming the URL without its secrets. Add the env group and the example lines.

- [ ] **Step 4: Run** tests, typecheck, lint. Expected: PASS. Also run `pnpm --filter @boom-busters/schemas test` (the env schema changed; see memory on cross-package regressions).

- [ ] **Step 5: Commit** `feat(case-finder): a polite cached client and the YouTube quota ledger`.

---

### Task 3: Wikimedia pageviews and Wikidata

**Files:**
- Create: `src/sources/pageviews.ts`, `src/sources/wikidata.ts`, fixtures `src/sources/fixtures/pageviews-*.json`, `wikidata-*.json`; add mocks to `src/sources/mock.ts`
- Test: `src/sources/pageviews.test.ts`, `src/sources/wikidata.test.ts`

**Interfaces:**
- Consumes: `PoliteClient` (Task 2).
- Produces:
  ```ts
  export interface PageviewsSource {
    monthly(project: string, titles: string[], from: string, to: string): Promise<MonthlyViews[]> // summed over titles, every month present
    daily(project: string, titles: string[], from: IsoDate, to: IsoDate): Promise<DailyViews[]>
  }
  export function livePageviews(client: PoliteClient): PageviewsSource
  export interface WikidataSource {
    sparql<T>(query: string, schema: z.ZodType<T>): Promise<T>
    facts(qids: string[]): Promise<Map<string, EntityFacts>>
  }
  export interface EntityFacts {
    qid: string; enTitle: string | null; sitelinks: Record<string, string>
    country: string | null; cik: string | null; dissolved: IsoDate | null
    people: Person[] // founders P112 and CEOs P169, living = no P570, convicted = has P1399
  }
  export function liveWikidata(client: PoliteClient): WikidataSource
  ```
  Endpoint: `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/{project}/all-access/user/{title}/{monthly|daily}/{start}/{end}`, titles with spaces as underscores and URI-encoded. A 404 means no views for that title and range (not an error). Missing months and days are filled with 0. Wikidata facts via `wbgetentities` (batches of 50, `props=sitelinks|claims`), people's P570/P1399 via a second batch.

- [ ] **Step 1: Write the failing tests:** `'sums views across a title and its redirects month by month'` (Review Focus 1: two fixture series for `Wirecard` and `Wirecard_AG`, result is their sum); `'fills months with no data as 0 from the requested start'` (Review Focus 5: an article whose fixture starts 2019-03, asked from 2018-01, has 14 leading zeros); `'treats a 404 as no views'`; `'reads sitelinks, CIK (P5531), country (P17), dissolution (P576) and people from fixtures'` with exact expected values from the fixture; `'a founder with a date of death is not living; one with P1399 is convicted'`.

- [ ] **Step 2: Run** them. Expected: FAIL.

- [ ] **Step 3: Implement** both sources and their mocks (deterministic series derived from a hash of the title, so mocks are stable and distinct).

- [ ] **Step 4: Run** tests, typecheck, lint. Expected: PASS.

- [ ] **Step 5: Commit** `feat(case-finder): pageviews with redirects, and Wikidata entity facts`.

---

### Task 4: Wikipedia pages: categories, lists, redirects, revision at a date

**Files:**
- Create: `src/sources/wikipedia.ts`, fixtures `src/sources/fixtures/wikipedia-*.json`; mock in `mock.ts`
- Test: `src/sources/wikipedia.test.ts`

**Interfaces:**
- Consumes: `PoliteClient`.
- Produces:
  ```ts
  export interface WikipediaSource {
    categoryMembers(category: string, depth: 0 | 1): Promise<string[]>   // article titles, namespace 0, deduped
    listLinks(page: string): Promise<string[]>                         // namespace-0 links from a list article's body
    redirectsTo(title: string): Promise<string[]>
    qidsFor(titles: string[]): Promise<Map<string, string>>            // via pageprops wikibase_item, batches of 50
    revisionBefore(title: string, day: IsoDate): Promise<{ revid: number; timestamp: string } | null>
    parsed(revid: number): Promise<{ categories: string[]; externalLinks: string[] }>
  }
  export function liveWikipedia(client: PoliteClient): WikipediaSource
  ```
  Base `https://en.wikipedia.org/w/api.php`, `format=json&formatversion=2`, follow `continue` to the end. `revisionBefore` uses `prop=revisions&rvdir=older&rvstart={day}T00:00:00Z&rvlimit=1`. `parsed` uses `action=parse&oldid=&prop=categories|externallinks`.

- [ ] **Step 1: Write the failing tests:** `'follows continuation across pages of category members'`; `'depth 1 includes members of direct subcategories once'`; `'revisionBefore returns null for an article created after the day'`; `'parsed returns category names without the Category: prefix'`.

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement** source and mock.

- [ ] **Step 4: Run** tests, typecheck, lint. Expected: PASS.

- [ ] **Step 5: Commit** `feat(case-finder): Wikipedia categories, lists and dated revisions`.

---

### Task 5: YouTube Data API

**Files:**
- Create: `src/sources/youtube.ts`, fixtures `src/sources/fixtures/youtube-*.json`; mock in `mock.ts`
- Test: `src/sources/youtube.test.ts`

**Interfaces:**
- Consumes: `PoliteClient`, `QuotaLedger`, `QuotaExhaustedError` (Task 2).
- Produces:
  ```ts
  export interface YoutubeSource {
    search(query: string): Promise<{ fetchedAt: IsoDate; videos: YoutubeVideo[] }> // 100 units + 1 for videos.list
    channelByHandle(handle: string): Promise<{ channelId: string; uploadsPlaylistId: string }> // 1 unit
    uploads(channelId: string, uploadsPlaylistId: string): Promise<ChannelUploads>             // 1 unit per 50 + 1 per 50 for videos.list
  }
  export function liveYoutube(client: PoliteClient, apiKey: string, ledger: QuotaLedger): YoutubeSource
  export function parseIsoDuration(iso: string): number // 'PT1H2M3S' -> 3723
  ```
  `search`: `search.list` with `part=snippet&type=video&maxResults=25&q=`, then `videos.list` `part=contentDetails,statistics,snippet` for those ids. Units are spent from the ledger **only for calls not served from cache**, and before the request is sent. A 403 with reason `quotaExceeded` throws `QuotaExhaustedError`. Cached searches never expire (the back-test needs one fetch per entry; the fetch date is recorded).

- [ ] **Step 1: Write the failing tests:** `'parses ISO 8601 durations'` (`PT8M` 480, `PT1H2M3S` 3723, `P0D` 0); `'a search spends 101 units, and a cached repeat spends none'` (Review Focus 2); `'a quotaExceeded 403 throws QuotaExhaustedError and caches nothing'`; `'refuses to start a call the ledger cannot afford'`; `'uploads pages through the playlist and reads views and durations'`.

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement** source and mock (mock videos are titled `[mock] <query> video n`, so a mock never looks like a real video).

- [ ] **Step 4: Run** tests, typecheck, lint. Expected: PASS.

- [ ] **Step 5: Commit** `feat(case-finder): YouTube search and channel uploads on a unit ledger`.

---

### Task 6: Paper-trail sources

**Files:**
- Create: `src/sources/courtlistener.ts`, `src/sources/edgar.ts`, `src/sources/sec-releases.ts`, `src/sources/references.ts`, fixtures (one saved HTML page of each SEC index, JSON for the others); mocks in `mock.ts`
- Test: one test file per source

**Interfaces:**
- Consumes: `PoliteClient`, `config.ts` (`EDGAR_FORMS`, `PRIMARY_DOMAIN_SUFFIXES`, `PRIMARY_HOSTS`).
- Produces:
  ```ts
  export interface CourtListenerSource { dockets(name: string, before: IsoDate): Promise<PrimaryDocument[]> } // v4 search type=r, filed_before, first page only (20)
  export interface EdgarSource { filings(cik: string, lane: Lane, before: IsoDate): Promise<PrimaryDocument[]> } // data.sec.gov/submissions/CIK##########.json, recent + files[]
  export interface SecReleasesSource { index(): Promise<SecRelease[]> }
  export function liveCourtListener(client: PoliteClient, token: string): CourtListenerSource
  export function liveEdgar(client: PoliteClient): EdgarSource
  export function liveSecReleases(client: PoliteClient): SecReleasesSource
  export interface SecRelease { kind: 'sec-aaer' | 'sec-litigation'; number: string; date: IsoDate; title: string; url: string }
  export function releasesNaming(index: SecRelease[], names: string[], before: IsoDate): PrimaryDocument[] // whole-word, case-insensitive
  export function isPrimaryReference(url: string): boolean
  ```
  The SEC index pages are HTML: parse with `node-html-parser` against the saved fixtures; the implementer opens the live pages once to record the fixtures. The index is cached for 7 days.

- [ ] **Step 1: Write the failing tests:** `'counts only the forms the lane takes, dated before T'` (a submissions fixture with 10-K, 8-K items 2.02 and 4.02, NT 10-K: success lane gets the 10-Ks, downfall lane gets the 4.02 8-K and the NT 10-K); `'pads the CIK to 10 digits'`; `'courtlistener sends the token header and filed_before'`; `'parses AAER rows from the saved page'` (exact count and first row from the fixture); `'releasesNaming matches whole words only'` (`Enron` does not match `Enronix`); `'isPrimaryReference'` with `sec.gov/litigation/x` true, `www.parliament.uk/...` true, `oig.dol.gov` true, `nytimes.com` false, `gov.example.com` false.

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement** the four modules and mocks.

- [ ] **Step 4: Run** tests, typecheck, lint. Expected: PASS.

- [ ] **Step 5: Commit** `feat(case-finder): court, EDGAR, SEC release and reference sources`.

---

### Task 7: The hitlist

**Files:**
- Create: `src/hitlist/seeds.ts`, `src/hitlist/fortune.ts`, `src/hitlist/build.ts`
- Test: `src/hitlist/fortune.test.ts`, `src/hitlist/build.test.ts`

**Interfaces:**
- Consumes: `WikipediaSource`, `WikidataSource`, `PageviewsSource` (Tasks 3 and 4), `FORTUNE_CLIMB`.
- Produces:
  ```ts
  export const DOWNFALL_CATEGORIES: readonly string[] // 'Corporate scandals', 'Pyramid and Ponzi schemes', 'Accounting scandals', 'Companies that filed for Chapter 11 bankruptcy in <year>' for 2000 to 2025
  export const DOWNFALL_LISTS: readonly string[]      // 'List of corporate collapses and scandals', 'List of Ponzi schemes'
  export interface FortuneRow { year: number; rank: number; company: string }
  export function fortuneClimbers(rows: FortuneRow[]): { company: string; since: IsoDate }[] // since = Jan 1 of the year the rule was first met
  export function loadLoPucki(csvPath: string | null): { name: string; filed: IsoDate }[]   // absent file returns [] and logs that it was skipped
  export interface HitlistDeps {
    wikipedia: WikipediaSource; wikidata: WikidataSource; pageviews: PageviewsSource
    fetchText: (url: string) => Promise<string> // PoliteClient.getText, for the Fortune CSVs
    loPuckiCsv: string | null
    log: (line: string) => void
  }
  export async function buildHitlist(deps: HitlistDeps): Promise<HitlistEntry[]>
  export function laneOf(tags: DatedTag[]): Lane | null // any downfall tag wins (spec section 4)
  ```
  Tags and their `since`: a category or list membership carries `since: null` at build time (dated later per `T` from the revision, Task 11); a LoPucki filing is `downfall` since its filing date; a Wikidata dissolution with a convicted person is `downfall` since the dissolution date; a Fortune climb is `success` since the year met; a Wikidata founder link with English median monthly views of 1,000 or more over the last 24 months and no downfall tag is `success` with `since: null`. Fortune CSVs come from `https://raw.githubusercontent.com/cmusam/fortune500/master/csv/fortune500-<year>.csv`. Fortune and founder names are resolved to QIDs through the English title search (`qidsFor`); unresolved names are dropped and counted. Entries are keyed by QID and merged.

- [ ] **Step 1: Write the failing tests:** `'a climb of 200 places within 10 years qualifies, 199 does not'`; `'a first appearance after 1970 that later reaches the top 100 qualifies'`; `'laneOf: any downfall tag wins over success tags'`; `'build merges a company seeded twice into one entry with both tags'` (mocks); `'an entry with no English article keeps its sitelinks and a null query'`.

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement.** The founder seed uses one SPARQL query for businesses with P112 and an English sitelink, limited to 20,000 rows.

- [ ] **Step 4: Run** tests, typecheck, lint. Expected: PASS.

- [ ] **Step 5: Commit** `feat(case-finder): the hitlist from categories, lists, LoPucki, Fortune and Wikidata`.

---

### Task 8: Measurements

**Files:**
- Create: `src/score/measure.ts`
- Test: `src/score/measure.test.ts`

**Interfaces:**
- Consumes: `EntryEvidence`, `config.ts`, `stats.median`.
- Produces:
  ```ts
  export interface RawMeasures { demand: number; world: number; spike: number; coverage: number | null; enMedianMonthly: number }
  export function measure(e: EntryEvidence): RawMeasures
  export function titleMatches(query: string, title: string): boolean
  export function outlierRatio(video: YoutubeVideo, channel: ChannelUploads | undefined, asOf: IsoDate): number | null
  ```
  `demand = log10(1 + enMedianMonthly)`, the median over the 24 full months before `asOf`'s month. `world` likewise over `worldMonthly`. `spike = sum(enDaily over the 14 days before asOf) / median(the 14-day sums over the 365 days before that window, stepped daily)`, and 0 when that median is 0. `coverage` is null when `search` is null; otherwise the sum of `min(outlierRatio, 5)` over videos with `publishedAt < asOf`, `durationSec >= 480`, `titleMatches`, and `publishedAt` within 24 months before `asOf`. `outlierRatio` divides by the median views of the channel's long-form uploads (any date, this is the measurement side, not the outcome); null when the channel's uploads are not in `channels`; inside `coverage` a null ratio counts as 1.

- [ ] **Step 1: Write the failing tests:** `'demand uses the median, so one spike month does not move it'`; `'missing months count as zero'` (Review Focus 5); `'no English article gives demand 0 and still computes world'` (Review Focus 3); `'titleMatches is whole-word and case-insensitive'` with `('Apple', 'The Fall of APPLE')` true, `('Apple', "Applebee's Collapse")` false, `('Apple', 'pineapple empire')` false (Review Focus 4); `'coverage ignores Shorts, later videos and videos older than 24 months'`; `'outlier ratio is capped at 5 in coverage'`; `'spike is 0 when the baseline is 0'`.

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run** tests, typecheck, lint. Expected: PASS.

- [ ] **Step 5: Commit** `feat(case-finder): demand, world interest, timeliness and coverage measures`.

---

### Task 9: Gates

**Files:**
- Create: `src/score/gates.ts`
- Test: `src/score/gates.test.ts`

**Interfaces:**
- Consumes: `EntryEvidence`, `PAPER_TRAIL_LEVELS`.
- Produces:
  ```ts
  export type PaperTrail = 'none' | 'thin' | 'enough' | 'strong'
  export type LegalFlag = 'adjudicated' | 'alleged' | 'self-reported' | 'clear'
  export interface Gates { paperTrail: PaperTrail; documentCount: number; legal: LegalFlag; livingPeople: number; kill: string | null }
  export function gates(e: EntryEvidence, lane: Lane): Gates
  ```
  Documents count once per distinct URL and only when `datedAt` is null or before `asOf` (Wikipedia references are dated by their revision, already before `T`). Legal, downfall lane: `adjudicated` when a person is convicted or an `sec-aaer` document exists, else `alleged`. Success lane: `self-reported` when there are living people and no `edgar` document, else `clear`. Kill reasons, exact copy: `'not enough public record'` for paper trail `none`; `'legal: alleged, living people named, thin record'` for alleged with living people and paper trail `thin` (paper trail `none` already killed).

- [ ] **Step 1: Write the failing tests:** each level boundary (0, 1, 2, 3, 9, 10 documents); `'a document dated on or after T does not count'`; `'the same URL from two sources counts once'`; `'downfall with an AAER is adjudicated'`; `'alleged, living, thin is killed with the exact reason'`; `'alleged, living, enough is flagged, not killed'`; `'success with living founders and no EDGAR filing is self-reported'`.

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run** tests, typecheck, lint. Expected: PASS.

- [ ] **Step 5: Commit** `feat(case-finder): paper-trail levels, legal flags and kills`.

---

### Task 10: Ranking

**Files:**
- Create: `src/score/rank.ts`
- Test: `src/score/rank.test.ts`

**Interfaces:**
- Consumes: `measure`, `gates`, `laneOf`, `percentileRanks`, `WEIGHTS`, `RANKED_PER_LANE`, `FLOOR_MEDIAN_MONTHLY`.
- Produces:
  ```ts
  export interface Scored { qid: string; lane: Lane; raw: RawMeasures; pct: { D: number; G: number; S: number; W: number }; score: number; gates: Gates }
  export interface LaneResult { shortlist: Scored[]; killed: Scored[]; unranked: { qid: string; reason: 'no lane' | 'below floor' | 'outside top 250' }[] }
  export function populationAt(evidence: EntryEvidence[]): Map<Lane, EntryEvidence[]> // lane from tagsAtT, floor applied, top 250 by demand
  export function rank(evidence: EntryEvidence[], options?: { applyLegalKill: boolean }): Record<Lane, LaneResult>
  ```
  Percentiles are taken within the lane's ranked population (after the floor and top-250 cut, before kills). An entry in the population with `coverage` null is a programming error (G is measured for everyone in the population) and throws. `score = WEIGHTS.D * D + WEIGHTS.G * (100 - pct(coverage)) + WEIGHTS.S * S + WEIGHTS.W * W`. Order by score descending, then demand descending, then QID. `applyLegalKill` defaults to true; the back-test passes false (spec 9.5). Paper-trail `none` always kills.

- [ ] **Step 1: Write the failing tests:** `'the score is the weighted sum of within-lane percentiles'` (three-entry lane, exact expected scores); `'a tie on score is broken by demand'`; `'downfalls and successes are ranked separately'`; `'below the floor is unranked with its reason'`; `'only the top 250 by demand are ranked'` (251 entries); `'applyLegalKill false keeps a legal kill in the shortlist; paper trail none is killed either way'`.

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run** tests, typecheck, lint. Expected: PASS.

- [ ] **Step 5: Commit** `feat(case-finder): the fixed-weight rubric, ranked within each lane`.

---

### Task 11: Evidence gathering

**Files:**
- Create: `src/evidence.ts`
- Test: `src/evidence.test.ts` (all sources mocked)

**Interfaces:**
- Consumes: every source (Tasks 3 to 6), `populationAt` (Task 10), `laneOf` (Task 7).
- Produces:
  ```ts
  export interface Sources { pageviews: PageviewsSource; wikidata: WikidataSource; wikipedia: WikipediaSource; youtube: YoutubeSource; courtlistener: CourtListenerSource; edgar: EdgarSource; secReleases: SecReleasesSource }
  export async function gatherAt(hitlist: HitlistEntry[], asOf: IsoDate, sources: Sources, log: (line: string) => void): Promise<EntryEvidence[]>
  ```
  Two passes, so YouTube is spent only on the population. Pass 1, every entry: pageviews (English with redirects, other sitelinks summed), the revision before the first day of `asOf`'s month and its categories, giving `tagsAtT` (category tags dated by that revision, other tags kept only when `since < asOf`). Pass 2, only entries in `populationAt`: YouTube search, uploads of each channel in the results (cached per channel), CourtListener, EDGAR when a CIK exists, SEC releases, references from the parsed revision, people from Wikidata. The monthly series are fetched once from 2015-07 to the present and sliced per `asOf`, so the cache serves every test date. `QuotaExhaustedError` is not caught here.

- [ ] **Step 1: Write the failing tests:** `'YouTube is searched only for the ranked population'` (mock counts calls); `'a category tag counts only if the revision before T's month has it'`; `'a LoPucki tag filed after T is ignored'`; `'one monthly fetch serves two different asOf dates'`.

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run** tests, typecheck, lint. Expected: PASS.

- [ ] **Step 5: Commit** `feat(case-finder): evidence gathered as of a date, YouTube only for the ranked`.

---

### Task 12: Test subjects and outcomes

**Files:**
- Create: `src/backtest/subjects.ts`, `src/backtest/outcome.ts`, `packages/case-finder/fixtures/backtest-subjects.json` (written in Step 6)
- Test: `src/backtest/subjects.test.ts`, `src/backtest/outcome.test.ts`

**Interfaces:**
- Consumes: `YoutubeSource`, `HitlistEntry[]`, `titleMatches`, `BACKTEST`, `CHANNEL_HANDLES`.
- Produces:
  ```ts
  export interface SubjectProposal { videoId: string; channelHandle: string; title: string; publishedAt: IsoDate; proposedQid: string | null; matchedQuery: string | null }
  export interface SubjectFixture { videoId: string; qid: string | null; verdict: 'subject' | 'skip-not-single' | 'miss-not-on-hitlist'; note?: string }
  export function proposeSubjects(uploads: Map<string, ChannelUploads>, hitlist: HitlistEntry[]): SubjectProposal[] // long-form, in date range, newest first, longest matching query wins
  export function selectTestSet(checked: SubjectFixture[], proposals: SubjectProposal[], laneOfQid: (qid: string) => Lane | null): { selected: SubjectFixture[]; note: string }
  export function outcomeRatio(video: YoutubeVideo, channel: ChannelUploads, measuredOn: IsoDate): number
  ```
  `selectTestSet` walks newest first across all channels, takes `subject` and `miss-not-on-hitlist` verdicts (misses stay in the set: spec 9.5 counts them against the rubric), skips `skip-not-single`, at most 12 per channel; once it has 28 downfalls it takes only success stories until 12 of those or the end; it stops at 40 and its `note` states the final split. A miss's lane comes from the fixture's `note` (`lane: downfall|success`) since it has no hitlist entry. `outcomeRatio`: views divided by the median views of the channel's other long-form uploads published within 6 months either side of the video and at least 90 days old on `measuredOn`.

- [ ] **Step 1: Write the failing tests:** `'proposes the longest matching hitlist query'` (`'The Collapse of Lehman Brothers'` picks `Lehman Brothers` over `Lehman`); `'selection caps a channel at 12'`; `'after 28 downfalls it takes only success stories'`; `'misses stay in the set'`; `'outcome excludes uploads younger than 90 days and outside 6 months'`; `'outcome excludes the video itself from its own median'`.

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run** tests, typecheck, lint. Expected: PASS. Commit `feat(case-finder): back-test subject selection and outcome ratios`.

- [ ] **Step 5: Live, with the owner's go-ahead:** the CLI's `subjects --live` (Task 13 adds it; build this step after Task 13 Step 3) fetches the five channels' uploads (about 5 units each per 50 uploads) and the hitlist, then writes proposals to `.cache/case-finder/subject-proposals.json`.

- [ ] **Step 6: Hand-check** every proposal through the newest uploads until the selection can fill 40: confirm or correct the QID, mark `skip-not-single` or `miss-not-on-hitlist` (with `lane:`). Write `fixtures/backtest-subjects.json`. Commit it **before** any scoring run: `test(case-finder): hand-checked back-test subjects`.

---

### Task 13: Baseline, report and the CLI

**Files:**
- Modify: `packages/providers/src/prompts/cases.ts` (add two exports; reuse the existing `SYSTEM` constant unchanged)
- Create: `src/backtest/baseline.ts`, `src/backtest/report.ts`, `packages/case-finder/scripts/backtest.ts`
- Test: `packages/providers/src/prompts/cases.test.ts` (extend), `src/backtest/report.test.ts`, `src/backtest/cli.test.ts` (argument parsing and the guards, sources mocked)

**Interfaces:**
- Consumes: everything above; `LLMTaskRequest` and an LLM adapter's `complete` from `@boom-busters/providers` (as `apps/web/scripts/live-plan-test.ts` does).
- Produces:
  ```ts
  // providers/src/prompts/cases.ts
  export function buildScoreNamedCasesRequest(names: readonly string[]): LLMTaskRequest // same SYSTEM; user turn: score each named case, JSON {"scores":[{"title","priorityScore"}]}
  export function parseNamedCaseScores(text: string, names: readonly string[]): Map<string, number> // missing names get no entry; scores fitted to 0..100
  // backtest/report.ts
  export interface CaseRow { videoId: string; channel: string; title: string; T: IsoDate; lane: Lane; qid: string | null; status: 'ranked' | 'miss' | 'below floor' | 'outside top 250' | 'paper trail none'; pct: Scored['pct'] | null; score: number; legalKillWouldApply: boolean; baseline: number | null; outcome: number }
  export interface Verdict { rhoRubric: number; rhoBaseline: number; ciRubric: [number, number]; ciBaseline: [number, number]; ciDifference: [number, number]; pass: boolean; perLane: Record<Lane, number>; withoutLegalKills: number; missRate: number; spikeVsOutcome: { spiking: number; aboveMedian: number } }
  export function scoreForCorrelation(rows: CaseRow[]): number[] // unrankable rows get (min ranked score - 1)
  export function verdict(rows: CaseRow[]): Verdict
  export function renderReport(rows: CaseRow[], v: Verdict, meta: { configVersion: number; commit: string; baselineModel: string | null; runDate: IsoDate; quotaNote: string }): string
  ```
  CLI commands: `hitlist`, `subjects`, `run`. Flags: `--live` (required for any network call; without it every source is the mock and the output says MOCK at the top), `--baseline --baseline-provider <anthropic|openai|google> --baseline-model <id>` (the paid call; refused unless `--live` is set too), `--daily-units <n>` (default 10000), `--spent-today <n>`. Guards: `run --live` refuses if `git status --porcelain packages/case-finder/src/config.ts` is not empty, or if `fixtures/backtest-subjects.json` is not committed (spec: pre-registration). On `QuotaExhaustedError` the CLI prints how many entries remain unmeasured and exits 2; a rerun resumes from cache. A missing baseline (no `--baseline`) leaves `rhoBaseline` blank and the verdict says "not decided: baseline not run". `run` writes `docs/case-finder/backtest-<runDate>.md` and `docs/case-finder/backtest-<runDate>-cases.json`.

- [ ] **Step 1: Write the failing tests:** `'buildScoreNamedCasesRequest keeps the system prompt and names every case'`; `'parseNamedCaseScores rounds and clamps, and ignores names not asked for'`; `'unrankable rows score below every ranked row'`; `'pass needs both conditions'` (rubric 0.35 vs baseline 0.40 fails; 0.31 vs 0.20 passes; 0.29 vs 0.10 fails); `'the report states the YouTube hindsight caveat and the baseline's head start'` (string contains both sentences from spec 5 and 9.4); `'run --live refuses when config.ts has uncommitted changes'`; `'--baseline without --live is refused'`.

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement.** The report lists every case row in a table, the verdict first, then the caveats, then the decisions list from this plan, then the hitlist size by lane and the number of unresolved seed names. Report prose follows the house copy rules.

- [ ] **Step 4: Run** `pnpm --filter @boom-busters/case-finder test`, `pnpm --filter @boom-busters/providers test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`. Expected: PASS.

- [ ] **Step 5: Mock run:** `MOCK_PROVIDERS=1 pnpm --filter @boom-busters/case-finder backtest run`. Expected: a report marked MOCK in `docs/case-finder/`, not committed.

- [ ] **Step 6: Commit** `feat(case-finder): the back-test CLI, baseline and report`.

---

### Task 14: The live back-test (owner's go-ahead at each paid or keyed step)

**Files:**
- Create: `docs/case-finder/backtest-<date>.md`, `docs/case-finder/backtest-<date>-cases.json`
- Modify: `PROGRESS.md` (new section "Case finder, part 1" with the checklist of Tasks 1 to 14 and the Decisions list of this plan as decisions made; the decision number is taken at the merge)

- [ ] **Step 1: Ask the owner** for `YOUTUBE_DATA_API_KEY` (a new Google Cloud project), `COURTLISTENER_TOKEN` and `DATA_CONTACT_EMAIL` in `.env.local`, and the optional LoPucki cases file path. Nothing live runs before this.
- [ ] **Step 2:** `pnpm --filter @boom-busters/case-finder backtest hitlist --live`. Record the hitlist size per lane. **The floor's one adjustment** (spec section 4) happens here if the ranked population is far below 250 per lane at typical test dates; record it in `config.ts` and PROGRESS.md and commit before Step 3.
- [ ] **Step 3:** Task 12 Steps 5 and 6 (subjects, hand-check, commit the fixture).
- [ ] **Step 4:** `backtest run --live` once a day until it completes (about a week of quota: expect exit 2 with a remaining count on each day but the last).
- [ ] **Step 5: Ask the owner** to approve the baseline call (provider, model, estimated cost in cents), then `backtest run --live --baseline --baseline-provider <p> --baseline-model <m>`, which is served from cache except for that one call.
- [ ] **Step 6:** Commit the report, the cases JSON and PROGRESS.md: `docs(case-finder): back-test report`.
- [ ] **Step 7: Hand the report to the owner** with the verdict first. If it fails, stop: nothing from spec section 8 is planned unless the owner decides otherwise.
