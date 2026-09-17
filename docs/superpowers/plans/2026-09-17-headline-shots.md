# Headline Shots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `headline` slot type that puts a real news headline on screen, with the outlet, byline and publication date read from the article's own declared metadata rather than written by a model.

**Architecture:** The shot-list model cites a claim number, exactly as a chart cites `dataRefs`. `resolvePlannedBrief` maps it to a claim ULID and refuses any claim that is not a news source with a URL. Resolution fetches that URL once, extracts JSON-LD and Open Graph metadata, and caches it in a global `article_sources` table keyed by normalised URL. Assembly embeds the strings in the timeline payload, and the composition draws the approved clipping.

**Tech Stack:** pnpm monorepo; Next.js App Router server actions ('use server' exports only async functions); Zod 4; Drizzle + Postgres (test DB in Docker on 5433, Docker Desktop must be running); Inngest 4; Remotion 4.0.512; vitest; Playwright in mock-provider mode.

**Spec:** `docs/superpowers/specs/2026-09-17-headline-shots-design.md`

## Global Constraints

- No em or en dashes anywhere in code, docs or copy; write "2019 to 2024" for ranges. South African English spelling.
- Every commit ends with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`; run `pnpm format:check`, `pnpm lint`, `pnpm typecheck` before each commit; CI green on every commit.
- Typecheck runs **after** the last test file is written: vitest does not typecheck, so a fixture that does not satisfy the schema only fails on Vercel.
- 'use server' modules export only async functions.
- No real provider calls in tests; `MOCK_PROVIDERS=1` everywhere; the article adapter takes an injected `fetchImpl` and a `lookupImpl`.
- `packages/compositions` changes do not reach a render until `pnpm --filter @boom-busters/infra deploy:remotion`.
- Work on branch `headline-shots` from `master`.

---

### Task 1: Article metadata schemas

**Files:**
- Create: `packages/schemas/src/article.ts`
- Modify: `packages/schemas/src/index.ts` (export)
- Test: `packages/schemas/src/article.test.ts`

**Interfaces (produces):**

```ts
export const FIELD_PROVENANCES = ['jsonld', 'og', 'meta', 'title', 'domain', 'archive', 'manual'] as const
export const ARTICLE_STATUSES = ['fetched', 'manual', 'failed'] as const
export const ArticleMetadataSchema = z.object({
  url: z.string().min(1),
  outlet: z.string().trim().min(1).max(120).nullable(),
  headline: z.string().trim().min(1).max(400).nullable(),
  author: z.string().trim().min(1).max(200).nullable(),
  publishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  description: z.string().trim().min(1).max(400).nullable(),
  provenance: z.record(z.enum(['outlet','headline','author','publishedAt','description']), z.enum(FIELD_PROVENANCES)).default({}),
  status: z.enum(ARTICLE_STATUSES),
  failureReason: z.string().max(400).nullable(),
})
export type ArticleMetadata = z.infer<typeof ArticleMetadataSchema>
/** One row per article: lowercase host, no www., no fragment, no tracking params, no trailing slash. */
export function normaliseArticleUrl(raw: string): string | null
/** "ft.com/content/abc" — what the card prints, at most 48 characters. */
export function articleSourceLabel(url: string): string
/** The first money, percentage or multi-digit span, with its scale word. Null when there is none. */
export function suggestEmphasis(headline: string): string | null
/** Whitespace-collapsed substring test; the card never approximates. */
export function emphasisFits(headline: string, emphasis: string): boolean
/** A headline record with enough on it to render. */
export function articleIsRenderable(meta: ArticleMetadata): boolean
```

- [ ] **Step 1: Failing tests.** `normaliseArticleUrl` on `https://WWW.FT.com/content/abc?utm_source=x#top` to `https://ft.com/content/abc`; keeps a meaningful query; returns null for `mailto:` and for garbage. `articleSourceLabel` truncates a long path from the middle. `suggestEmphasis` finds `$1.9 billion`, `41%`, `€500m`, and returns null for a headline with no figure. `emphasisFits` is true across a double space, false for a paraphrase. `articleIsRenderable` needs outlet, headline and publishedAt.
- [ ] **Step 2: Run, fail. Step 3: Implement. Step 4: Run, pass.**
- [ ] **Step 5: Commit** `feat: article metadata schema and url normalisation (decision 257)`

---

### Task 2: The headline brief

**Files:**
- Modify: `packages/schemas/src/visuals.ts`
- Test: `packages/schemas/src/visuals.test.ts`

**Interfaces (produces):**

```ts
export const SHOT_SLOT_TYPES = [..., 'headline'] as const
export const HeadlineBriefSchema = z.object({
  type: z.literal('headline'), ...briefCommon,
  /** The claim whose source article this card shows. The audit trail, like chart dataRefs. */
  sourceClaimId: UlidSchema,
  /** The phrase the marker draws under. Must occur in the headline or it is dropped. */
  emphasis: z.string().trim().min(1).max(120).optional(),
  /** Whether the standfirst renders. Off by default: these strings are often a teaser. */
  showDeck: z.boolean().optional(),
})
export const PlannedHeadlineBriefSchema = HeadlineBriefSchema
  .omit({ sourceClaimId: true, emphasis: true, showDeck: true })
  .extend({ sourceRef: z.number().int().min(1) })
export interface PlanningClaim { id: string; sourceType?: string; sourceUrl?: string | null }
export function resolvePlannedBrief(brief: PlannedBrief, claims: readonly PlanningClaim[]): ShotBrief | null
/** Why a planned slot was refused, for the board's dropped-slot count. */
export function plannedBriefRejection(brief: PlannedBrief, claims: readonly PlanningClaim[]): string | null
```

`convertBrief` returns null for a `headline` target (it needs a claim, which no string supplies) and converts *from* headline through `description` like every other text type.

- [ ] **Step 1: Failing tests.** A headline brief parses; one without `sourceClaimId` does not. `resolvePlannedBrief` maps `sourceRef: 2` to the second claim's id; returns null when the number is out of range, when the claim is `sourceType: 'court'`, and when the claim has no `sourceUrl`. `plannedBriefRejection` names which of those it was. `convertBrief(headline, 'stock')` seeds the query from the description; `convertBrief(stock, 'headline')` is null.
- [ ] **Step 2: Run, fail. Step 3: Implement.** Update the two `resolvePlannedBrief` callers (`shot-list.ts`, `prompts/retype.ts`) to pass claims. **Step 4: Run, pass.**
- [ ] **Step 5: Commit** `feat: the headline shot brief cites a news claim (decision 257)`

---

### Task 3: The timeline payload

**Files:**
- Modify: `packages/schemas/src/timeline.ts`
- Test: `packages/schemas/src/timeline.test.ts`

**Interfaces (produces):**

```ts
export const HeadlinePayloadSchema = z.object({
  kind: z.literal('headline'),
  outlet: z.string().min(1), headline: z.string().min(1),
  publishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  author: z.string().min(1).optional(), deck: z.string().min(1).optional(),
  emphasis: z.string().min(1).optional(),
  sourceLabel: z.string().min(1), sourceUrl: z.string().min(1), claimId: UlidSchema,
})
export const TIMELINE_SLOT_TYPES = [..., 'headline'] as const
SLOT_PAYLOAD_KINDS.headline = ['headline']
```

- [ ] **Step 1: Failing tests.** A headline slot parses; a `still` slot carrying a headline payload fails the `superRefine`; a headline payload with a non-date `publishedAt` fails.
- [ ] **Step 2: Run, fail. Step 3: Implement. Step 4: Run, pass.**
- [ ] **Step 5: Commit** `feat: the headline timeline payload (decision 257)`

---

### Task 4: Database

**Files:**
- Modify: `packages/db/src/schema.ts` (`shotTypeEnum` + `headline`, `articleSources` table, `articleStatusEnum`)
- Create: `packages/db/src/articles.ts`
- Modify: `packages/db/src/index.ts`
- Generate: `packages/db/drizzle/0024_*.sql`
- Test: `packages/db/src/articles.integration.test.ts`

**Interfaces (produces):**

```ts
export async function getArticleSource(db: Database, url: string): Promise<ArticleSourceRow | undefined>
export async function getArticleSources(db: Database, urls: readonly string[]): Promise<ArticleSourceRow[]>
/** Writes a fetched record. Never overwrites a row whose status is 'manual'. */
export async function recordArticleSource(db: Database, meta: ArticleMetadata): Promise<ArticleSourceRow>
/** The owner's corrections. Sticky: status becomes 'manual' and stays. */
export async function setArticleSourceManual(db: Database, url: string, fields: Partial<...>): Promise<ArticleSourceRow>
```

- [ ] **Step 1: Failing tests.** Insert then read back; `recordArticleSource` twice updates; a `manual` row survives a later `recordArticleSource`; `setArticleSourceManual` flips status and sets provenance `manual` on the fields it wrote.
- [ ] **Step 2: Run, fail** (Docker Desktop must be running; `pnpm db:migrate:test`). **Step 3: Implement** and `pnpm --filter @boom-busters/db exec drizzle-kit generate`. **Step 4: Run, pass.**
- [ ] **Step 5: Commit** `feat: article_sources table and the headline shot type (decision 257)`

---

### Task 5: The URL guard

**Files:**
- Create: `packages/providers/src/article/safe-url.ts`
- Test: `packages/providers/src/article/safe-url.test.ts`

**Interfaces (produces):**

```ts
export interface UrlGuardOptions { lookupImpl?: (host: string) => Promise<{ address: string }[]> }
/** Throws ValidationError when the URL must not be fetched. Runs again on every redirect hop. */
export async function assertSafeArticleUrl(raw: string, options?: UrlGuardOptions): Promise<URL>
export function isPrivateAddress(address: string): boolean
```

Rejects: non-http(s) schemes, ports other than 80 and 443, raw IP hosts, `.local` hosts, and any host resolving to loopback, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `100.64/10`, `::1`, `fc00::/7` or `fe80::/10`.

- [ ] **Step 1: Failing tests.** Table of addresses through `isPrivateAddress`; `assertSafeArticleUrl` accepts a normal article URL with a stubbed public lookup, rejects `http://localhost/x`, `https://10.0.0.5/x`, `https://example.com:8080/x`, `file:///etc/passwd`, and a public host whose lookup returns `127.0.0.1`.
- [ ] **Step 2: Run, fail. Step 3: Implement. Step 4: Run, pass.**
- [ ] **Step 5: Commit** `feat: the article fetch refuses private addresses (decision 257)`

---

### Task 6: The extractor

**Files:**
- Create: `packages/providers/src/article/extract.ts`
- Create: `packages/providers/src/article/fixtures.ts` (saved heads, hand-written, no real outlets)
- Modify: `packages/providers/package.json` (add `node-html-parser`)
- Test: `packages/providers/src/article/extract.test.ts`

**Interfaces (produces):**

```ts
export interface ExtractedArticle {
  outlet: string | null; headline: string | null; author: string | null
  publishedAt: string | null; description: string | null
  provenance: Record<string, FieldProvenance>
}
/** Pure: HTML head in, fields out. `url` only supplies the domain fallback for the outlet. */
export function extractArticle(html: string, url: string): ExtractedArticle
```

Precedence per the spec section 4. `dateModified` is never promoted. Authors join as "A", "A and B", "A and others".

- [ ] **Step 1: Failing tests.** JSON-LD wins over `og`; `og` only; `<title>` only, with the ` | Outlet` suffix trimmed; author as string, as object, as array of three; `dateModified` present with no `datePublished` yields null; entity-encoded headline decodes; a consent-wall page yields all nulls; the outlet falls back to the domain and records provenance `domain`; a future date and a 1750 date are rejected.
- [ ] **Step 2: Run, fail. Step 3: Implement. Step 4: Run, pass.**
- [ ] **Step 5: Commit** `feat: read an article's declared metadata (decision 257)`

---

### Task 7: The fetcher, the mock and the registry

**Files:**
- Create: `packages/providers/src/article/fetch.ts`, `mock.ts`, `index.ts`
- Modify: `packages/providers/src/index.ts`
- Test: `packages/providers/src/article/fetch.test.ts`

**Interfaces (produces):**

```ts
export interface ArticleFetchOptions { fetchImpl?: typeof fetch; lookupImpl?: UrlGuardOptions['lookupImpl']; signal?: AbortSignal }
export interface ArticleProvider {
  fetchMetadata(url: string, options?: ArticleFetchOptions): Promise<ExtractedArticle & { archived?: boolean }>
}
export function articleProvider(env?: Record<string, string | undefined>): ArticleProvider
```

Behaviour: guard, GET with the honest user agent and an 8 s timeout, `redirect: 'manual'` with at most 5 hops each re-guarded, HTML content type required, body read to `</head>` or 512 KB. One retry after 1 s on a network error or 5xx; no retry on 403, 404, 429. On failure, one attempt at `https://archive.org/wayback/available?url=` and, if a snapshot exists, extract from it with provenance `archive`. Failures throw `ValidationError` carrying a one-line reason.

- [ ] **Step 1: Failing tests** with an injected `fetchImpl`: a 200 with a good head; a 301 to a second URL that returns the head; a 6-hop redirect loop refused; a 403 not retried; a 500 retried once then given up; a `text/plain` response refused; a body over the cap truncated at `</head>`; the archive fallback taken on a 404 and its provenance recorded; the mock provider returns deterministic fields and never calls fetch.
- [ ] **Step 2: Run, fail. Step 3: Implement. Step 4: Run, pass.**
- [ ] **Step 5: Commit** `feat: fetch an article's metadata, with an archive fallback (decision 257)`

---

### Task 8: The planner learns the type

**Files:**
- Modify: `packages/providers/src/prompts/script.ts` (`ScriptClaim.sourceType`, `claimList` marker)
- Modify: `packages/providers/src/prompts/shotlist.ts` (`SLOT_SHAPES`, planning rules, `HEADLINE_PER_CHAPTER`)
- Modify: `packages/providers/src/prompts/retype.ts` (headline is not a model-drafted target)
- Test: `packages/providers/src/prompts/script.test.ts`, `shotlist.test.ts`

The prompt gains the brief shape, and these rules: use a headline shot where the narration leans on what a publication reported; cite the claim NUMBER whose source is marked NEWS ARTICLE; never write the headline, the outlet, the byline or the date, because the app reads them from the article; at most one per chapter.

- [ ] **Step 1: Failing tests.** `claimList` marks a `major_outlet` claim with a URL and does not mark one without a URL; the system prompt contains the headline shape and the one-per-chapter rule; `parseShotList` accepts a headline slot and drops one with no `sourceRef`.
- [ ] **Step 2: Run, fail. Step 3: Implement. Step 4: Run, pass.**
- [ ] **Step 5: Commit** `feat: the shot-list model can plan a headline shot (decision 257)`

---

### Task 9: Planned slots become rows

**Files:**
- Modify: `apps/web/inngest/lib/shot-list.ts` (`plannedToRows` takes claims, enforces the cap)
- Modify: `apps/web/inngest/lib/direction.ts` (`planChapterSlots` passes claims through)
- Modify: `apps/web/inngest/functions/visuals-runner.ts` (`setup.claims` carries `sourceType`)
- Test: `apps/web/inngest/lib/shot-list.test.ts`

- [ ] **Step 1: Failing tests.** A headline slot citing claim 2 stores `sourceClaimId`; one citing a court claim is rejected with a reason; a chapter planning three headline slots keeps the first and rejects two, and the rejection reason says so.
- [ ] **Step 2: Run, fail. Step 3: Implement. Step 4: Run, pass.**
- [ ] **Step 5: Commit** `feat: one headline shot a chapter, cited to a news claim (decision 257)`

---

### Task 10: Resolution

**Files:**
- Create: `apps/web/lib/article-source.ts`
- Modify: `apps/web/lib/visual-assets.ts` (`resolveSlotBrief` headline case, `requireVisualKeys` untouched: no key needed)
- Test: `apps/web/lib/article-source.test.ts`

**Interfaces (produces):**

```ts
/** Cached read-through: an existing fetched or manual row wins; otherwise fetch, store, return. */
export async function articleForClaim(claimId: string): Promise<ArticleMetadata | null>
/** Forced re-fetch for the board's button. Refuses to overwrite a manual row. */
export async function refetchArticle(url: string): Promise<ArticleMetadata>
```

`resolveSlotBrief` case `headline`: read the claim, normalise its URL, `articleForClaim`, and return `{ candidates: [], status: articleIsRenderable(meta) ? 'resolved' : 'placeholder' }`. A fetch failure is a placeholder, never a thrown step.

- [ ] **Step 1: Failing tests.** A cached row is not re-fetched; a `manual` row is not re-fetched; a failure stores the reason and returns a non-renderable record; `resolveSlotBrief` returns `placeholder` for an unrenderable article and `resolved` for a good one.
- [ ] **Step 2: Run, fail. Step 3: Implement. Step 4: Run, pass.**
- [ ] **Step 5: Commit** `feat: headline slots resolve by reading the article (decision 257)`

---

### Task 11: The board

**Files:**
- Modify: `apps/web/app/(console)/projects/[id]/slot-previews.tsx` (`HeadlinePreview`)
- Modify: `apps/web/app/(console)/projects/[id]/visual-board.tsx` (the headline card)
- Modify: `apps/web/app/(console)/projects/[id]/visuals-actions.ts` (`saveArticleFieldsAction`, `refetchArticleAction`)
- Modify: `apps/web/lib/visuals-review.ts` (article records join the board payload)
- Test: `apps/web/app/(console)/projects/[id]/slot-previews.test.tsx`, `visuals-actions.test.ts`

The card shows the five fields with their provenance, an editable form, a "Re-fetch" button, the emphasis field with its substring validation, and a "Show standfirst" checkbox. A record that could not be fetched leads with the URL and "Open the article and fill these in", not an error.

- [ ] **Step 1: Failing tests.** The preview renders the headline and the marker; `saveArticleFieldsAction` rejects a non-owner, a bad ULID and an emphasis that is not in the headline; `refetchArticleAction` refuses a manual row and says why.
- [ ] **Step 2: Run, fail. Step 3: Implement. Step 4: Run, pass.**
- [ ] **Step 5: Commit** `feat: the board shows and corrects an article's metadata (decision 257)`

---

### Task 12: Compile and assemble

**Files:**
- Modify: `packages/timeline/src/compile.ts` (`CompileSlot` headline variant)
- Modify: `apps/web/inngest/lib/assembly.ts` (`slotPlan` reads the article record)
- Test: `packages/timeline/src/compile.test.ts`, `apps/web/inngest/lib/assembly.test.ts`

A headline slot with no renderable article is skipped with a reason, exactly as an unresolved slot is.

- [ ] **Step 1: Failing tests.** A headline slot compiles to a headline payload; the payload carries `sourceLabel` and `claimId`; a slot whose article is unrenderable is skipped and named; the golden timeline stays byte-stable for a fixture without headline slots.
- [ ] **Step 2: Run, fail. Step 3: Implement. Step 4: Run, pass.**
- [ ] **Step 5: Commit** `feat: headline shots reach the timeline (decision 257)`

---

### Task 13: The composition

**Files:**
- Create: `packages/compositions/src/components/HeadlineCard.tsx`
- Modify: `packages/compositions/src/fonts/catalog.ts`, `fonts/load.ts` (Source Serif 4)
- Modify: `packages/compositions/src/components/DocumentaryMaster.tsx` (slot switch)
- Modify: `packages/compositions/src/Root.tsx`, `src/snapshot/render.test.ts`
- Create: `packages/compositions/src/snapshot/golden/HeadlineCardWide.png`
- Delete: `packages/compositions/src/mockup/`, `packages/compositions/scripts/render-mockup.ts`
- Test: `packages/compositions/src/lib/headline.test.ts` (date formatting, emphasis split)

The approved clipping from the mock-up, portrait-aware, with the marker sweep. Dates format through a 12-entry month table, not `Intl`, so goldens are deterministic.

- [ ] **Step 1: Failing tests.** `formatPublished('2023-03-14')` is `14 March 2023`; a headline with no emphasis renders whole; an emphasis not present in the headline renders whole rather than throwing.
- [ ] **Step 2: Run, fail. Step 3: Implement,** then `REGEN_GOLDEN=1 pnpm --filter @boom-busters/compositions test` and check no unrelated golden moved. **Step 4: Run, pass.**
- [ ] **Step 5: Commit** `feat: the headline clipping composition (decision 257)`

---

### Task 14: Docs, e2e and ship

**Files:**
- Modify: `docs/03-build-spec.md` (dated amendment), `PROGRESS.md` (decision 257)
- Modify: `e2e/` visuals spec
- Test: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm e2e`

- [ ] **Step 1:** e2e in mock mode: a planned headline slot, a hand-corrected field, approval.
- [ ] **Step 2:** Full suite green across all nine packages.
- [ ] **Step 3: Commit** `docs: headline shots (decision 257)`, merge to master, push.
- [ ] **Step 4: Deploy notes.** Vercel builds on push; then `curl -X PUT https://boom-busters-web-rho.vercel.app/api/inngest`. Compositions changed, so the owner runs `$env:AWS_PROFILE="reelscript"; $env:AWS_REGION="eu-west-1"; pnpm --filter @boom-busters/infra deploy:remotion`. The DB migration runs with `pnpm db:migrate`.
