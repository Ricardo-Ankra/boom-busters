# Dossier Grounded Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The dossier task gathers a corpus of real documents for the case before writing, extracts scenes, cast, figures, told-already beats and claims from that corpus, checks every quote against the stored text, computes confidence and a legal status, and auto-approves only what the checks pass.

**Architecture:** A gather step ahead of the four research passes stores documents in `research_documents` (keyed by normalised URL) and links the ranked set to the project. The passes receive the corpus as the cacheable first user message with documents numbered `[D1]`..`[Dn]`; the model cites numbers and quotes; a pure grounding function maps numbers to ids, finds quotes, computes confidence and folds illegal legal statuses. The runner saves claims with their supports, the structured research as `dossiers.research`, and the same markdown document the script reads.

**Tech Stack:** TypeScript, zod 4, Drizzle on Postgres, Inngest, Next.js App Router, vitest 4, `@boom-busters/case-finder` sources behind `PoliteClient`, `node-html-parser`, `unpdf`.

**Spec:** `docs/superpowers/specs/2026-10-22-dossier-grounded-research-design.md`

## Global Constraints

- Mock providers by default: `MOCK_PROVIDERS=1` fetches nothing; no test or e2e run touches the network. Every live source takes an injected `fetchImpl`.
- Every pass is one `callForAnswer` answer (at most two calls); parsers repair and report through `Note`.
- Document text is written to the database inside the step; only ids cross a step boundary.
- Limits, as constants in `packages/schemas/src/dossier.ts`: `DOSSIER_CORPUS_TOKENS = 120_000`, `DOSSIER_DOCUMENT_TOKENS = 12_000`, `DOSSIER_QUOTE_MAX = 300`, `DOSSIER_QUOTE_MIN_FOLDED = 20`, `DOSSIER_SUPPORTS_MAX = 3`, `DOSSIER_SERIES_POINTS_MAX = 24`, `DOSSIER_CLAIMS_PER_PASS = 60`, `DOSSIER_SCENES_MAX = 60`, `DOSSIER_CAST_MAX = 30`, `DOSSIER_TOLD_ALREADY_MAX = 30`, `DOCUMENT_BODY_CAP_BYTES = 4 * 1024 * 1024`, `DOSSIER_TIER_SHARES = { 1: 0.25, 2: 0.3, 3: 0.15, 4: 0.1, 5: 0.2 }`.
- Tokens are estimated as `Math.ceil(text.length / 4)`.
- The dossier markdown uses only headings, lists, paragraphs, `**bold**`, `*italic*` and `[text](http...)` links (the app's own parser; `_italic_` is not supported).
- Zero-warning lint, strict typecheck, `pnpm format:check` clean before every commit (run on tracked files only, `git ls-files | xargs -n 80 pnpm exec prettier --check`).
- Commits are small, one logical change, on branch `dossier-grounded-research`, with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Decisions go in `PROGRESS.md` from number 306 (checked against `origin/master` at the merge).
- Published copy rules (no dashes) apply to website and social text only, not to code, tests or internal docs.

## Review Focus

1. A quote that spans a transcript segment boundary (`...end of one [01:02] start of next...`): must be found, with the locator of the earlier marker. Pinned in Task 3.
2. A claim whose only support cites `[D99]` when 40 documents were given: the support is dropped with a note, the claim stays, unverified, with no `sourceUrl`. Pinned in Task 9.
3. A fetched page whose body exceeds 4 MB: stored as a failure, not read into memory beyond the cap, and the gather continues. Pinned in Task 4.
4. A `ruled` status citing a `reporting` document: folded to `alleged` with a note, never stored as `ruled`. Pinned in Task 9.
5. A revision after the first run: the corpus is reused without a fetch, the note reaches all four passes, and claims are replaced with their supports. Pinned in Task 11.

---

### Task 1: Research shapes in `@boom-busters/schemas`

**Files:**
- Modify: `packages/schemas/src/dossier.ts`
- Modify: `packages/schemas/src/index.ts` (if `dossier.ts` is not already re-exported wholesale)
- Test: `packages/schemas/src/dossier.test.ts` (create if absent; the existing tests of `DraftClaimSchema` live in `packages/providers/src/prompts/dossier.test.ts` and are rewritten in Task 8)

**Interfaces:**
- Produces, all exported from `@boom-busters/schemas`:
  - constants named in Global Constraints.
  - `DOCUMENT_KINDS = ['filing', 'web-archive', 'press-release', 'reporting', 'video', 'figures', 'regulator', 'court'] as const`, `DocumentKindSchema`, `DocumentKind`, `DOCUMENT_TIERS: Record<DocumentKind, 1 | 2 | 3 | 4 | 5>` (filing, web-archive, press-release: 1; reporting: 2; video: 3; figures: 4; regulator, court: 5).
  - `LEGAL_STATUSES = ['ruled', 'alleged', 'none'] as const`, `LegalStatusSchema`, `LegalStatus`.
  - `SupportSchema = z.object({ doc: z.number().int().min(1), quote: z.string().trim().min(1).max(DOSSIER_QUOTE_MAX) })`, `Support`.
  - `LegalSchema = z.object({ status: LegalStatusSchema, date: z.string().regex(/^\d{4}(-\d{2}){0,2}$/), doc: z.number().int().min(1) })`.
  - `SeriesPointSchema = z.object({ at: z.string().trim().min(1).max(40), value: z.number(), asWritten: z.string().trim().min(1).max(40) })`, `SeriesSchema = z.object({ label: z.string().trim().min(1).max(120), unit: z.string().trim().min(1).max(40), currency: z.string().trim().max(10).nullable(), points: z.array(SeriesPointSchema).min(1).max(DOSSIER_SERIES_POINTS_MAX) })`, `Series`.
  - `ResearchClaimSchema = z.object({ text: z.string().trim().min(10).max(DOSSIER_CLAIM_TEXT_MAX), supports: z.array(SupportSchema).min(1).max(DOSSIER_SUPPORTS_MAX), legal: LegalSchema.nullable().default(null), series: SeriesSchema.nullable().default(null) })`, `ResearchClaim`. The old `DraftClaimSchema`, `DraftClaim`, `TimelineEventSchema`, `TimelineEvent`, `ResearchTimelineSchema` are deleted.
  - `ClaimsSchema = z.object({ claims: z.array(ResearchClaimSchema).min(1).max(DOSSIER_CLAIMS_PER_PASS) })`.
  - `CastMemberSchema = z.object({ name: z.string().trim().min(2).max(120), role: z.string().trim().min(2).max(200), wanted: z.string().trim().min(10).max(500), scene: SupportSchema.nullable().default(null) })`.
  - `ToldAlreadySchema = z.object({ beat: z.string().trim().min(10).max(500), doc: z.number().int().min(1), quote: z.string().trim().min(1).max(DOSSIER_QUOTE_MAX) })`.
  - `CaseBriefSchema = z.object({ summary, turningPoint, cast: z.array(CastMemberSchema).max(DOSSIER_CAST_MAX), toldAlready: z.array(ToldAlreadySchema).max(DOSSIER_TOLD_ALREADY_MAX).default([]), openQuestions })` (summary, turningPoint, openQuestions as today; `principals` is gone).
  - `SceneSchema = z.object({ when: z.string().trim().min(3).max(DOSSIER_EVENT_WHEN_MAX), who: z.string().trim().min(2).max(200), what: z.string().trim().min(10).max(DOSSIER_EVENT_WHAT_MAX), why: z.string().trim().min(10).max(500), doc: z.number().int().min(1), quote: z.string().trim().min(1).max(DOSSIER_QUOTE_MAX) })`, `ScenesSchema = z.object({ scenes: z.array(SceneSchema).min(1).max(DOSSIER_SCENES_MAX) })`, `Scene`.
  - `ResearchAnswerSchema` keeps `index`, `question`, `answer` and gains `doc: z.number().int().min(1).optional()`; `sourceUrl` is removed. `ResearchAnswersSchema.claims` becomes `z.array(ResearchClaimSchema).max(DOSSIER_ANSWER_CLAIMS_MAX).default([])`.
  - Grounded shapes (what the app stores): `GroundedSupportSchema = z.object({ documentId: z.string(), rank: z.number().int().min(1), quote: z.string(), found: z.boolean(), offset: z.number().int().nullable(), locatorSeconds: z.number().int().nullable(), url: z.string(), archivedUrl: z.string().nullable() })`; `GroundedClaimSchema = z.object({ text, sourceUrl: z.string().nullable(), sourceType: ClaimSourceTypeSchema, confidence: ClaimConfidenceSchema, legalStatus: LegalStatusSchema, legalStatusDate: z.string().nullable(), legalStatusDocumentId: z.string().nullable(), series: SeriesSchema.nullable(), supports: z.array(GroundedSupportSchema) })`; `GroundedRefSchema = z.object({ documentId: z.string().nullable(), url: z.string().nullable(), found: z.boolean(), locatorSeconds: z.number().int().nullable(), quote: z.string().nullable() })`; `GroundedSceneSchema = SceneSchema.omit({ doc: true }).extend({ ref: GroundedRefSchema })`; `GroundedCastMemberSchema = CastMemberSchema.omit({ scene: true }).extend({ ref: GroundedRefSchema.nullable() })`; `GroundedToldAlreadySchema = z.object({ beat, ref: GroundedRefSchema })`; `GroundedAnswerSchema = ResearchAnswerSchema.omit({ doc: true }).extend({ ref: GroundedRefSchema.nullable() })`; `ResearchEntitySchema = z.object({ qid: z.string().nullable(), titles: z.array(z.string()), cik: z.string().nullable(), ticker: z.string().nullable(), website: z.string().nullable() })`; `GroundedResearchSchema = z.object({ entity: ResearchEntitySchema, brief: z.object({ summary, turningPoint, cast: z.array(GroundedCastMemberSchema), toldAlready: z.array(GroundedToldAlreadySchema), openQuestions }), scenes: z.array(GroundedSceneSchema), answers: z.array(GroundedAnswerSchema), corpus: z.object({ read: z.number().int(), unread: z.number().int(), failed: z.number().int() }) })`, `GroundedResearch`, `GroundedClaim`, `GroundedSupport`, `GroundedRef`.
  - `UNVERIFIED_CLAIM_WARNING_RATIO`, `ClaimSourceTypeSchema`, `ClaimConfidenceSchema`, `DOSSIER_*` text limits stay as they are. `usableSourceUrl` stays exported for the `Verify` action's validation if it is used there; otherwise it goes.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/schemas/src/dossier.test.ts
describe('ResearchClaimSchema', () => {
  it('needs one to three supports and defaults legal and series to null', () => {
    const claim = ResearchClaimSchema.parse({ text: 'Wirecard filed for insolvency in June 2020.', supports: [{ doc: 2, quote: 'filed for insolvency' }] })
    expect(claim.legal).toBeNull(); expect(claim.series).toBeNull()
    expect(() => ResearchClaimSchema.parse({ text: 'x'.repeat(20), supports: [] })).toThrow()
    expect(() => ResearchClaimSchema.parse({ text: 'x'.repeat(20), supports: Array(4).fill({ doc: 1, quote: 'q' }) })).toThrow()
  })
  it('accepts a legal date at year, month or day precision', () => {
    for (const date of ['2020', '2020-06', '2020-06-25']) expect(LegalSchema.parse({ status: 'ruled', date, doc: 1 }).date).toBe(date)
    expect(() => LegalSchema.parse({ status: 'ruled', date: 'June 2020', doc: 1 })).toThrow()
  })
  it('caps a series at 24 points', () => { /* 25 points throws, 24 parses */ })
})
describe('CaseBriefSchema', () => {
  it('has cast and toldAlready, not principals', () => {
    const brief = CaseBriefSchema.parse({ summary: 's'.repeat(60), turningPoint: 't'.repeat(30), cast: [{ name: 'Markus Braun', role: 'CEO', wanted: 'To keep the share price rising.' }], openQuestions: [] })
    expect(brief.cast[0]?.scene).toBeNull(); expect(brief.toldAlready).toEqual([])
    expect('principals' in brief).toBe(false)
  })
})
describe('DOCUMENT_TIERS', () => {
  it('assigns every kind a tier from one to five', () => { for (const kind of DOCUMENT_KINDS) expect([1,2,3,4,5]).toContain(DOCUMENT_TIERS[kind]) })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @boom-busters/schemas test -- dossier`
Expected: FAIL, `ResearchClaimSchema` is not exported.

- [ ] **Step 3: Implement the schemas and constants in `packages/schemas/src/dossier.ts` as the Interfaces block names them, deleting the old claim and timeline shapes**

- [ ] **Step 4: Run the tests and the package typecheck**

Run: `pnpm --filter @boom-busters/schemas test -- dossier && pnpm --filter @boom-busters/schemas typecheck`
Expected: PASS. (`pnpm typecheck` at the root will fail in `providers`, `db` and `web` until Tasks 2, 8, 9 and 11 land; that is expected and is why those tasks follow.)

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/dossier.ts packages/schemas/src/dossier.test.ts packages/schemas/src/index.ts
git commit -m "feat(schemas): research claim, scene, cast and grounded shapes for the dossier"
```

---

### Task 2: Tables, migration and database helpers

**Files:**
- Modify: `packages/db/src/schema.ts` (after the `claims` table, before `scripts`)
- Create: `packages/db/src/research-documents.ts`
- Modify: `packages/db/src/dossiers.ts`
- Modify: `packages/db/src/index.ts` (export `./research-documents`)
- Modify: `packages/db/src/fixtures.ts`, `packages/db/src/seed.ts`
- Create: `packages/db/drizzle/0034_*.sql` via `pnpm --filter @boom-busters/db generate`
- Test: `packages/db/src/research-documents.integration.test.ts`, `packages/db/src/dossiers.integration.test.ts`

**Interfaces:**
- Consumes: `DocumentKind`, `LegalStatus`, `Series`, `GroundedResearch`, `DOCUMENT_KINDS`, `LEGAL_STATUSES` from Task 1.
- Produces:
  - Enums `documentKindEnum = pgEnum('document_kind', DOCUMENT_KINDS)`, `legalStatusEnum = pgEnum('legal_status', LEGAL_STATUSES)`.
  - Table `researchDocuments` (`research_documents`): `id`, `url text unique not null`, `finalUrl text`, `httpStatus integer`, `fetchedAt timestamptz not null`, `contentType text`, `kind document_kind not null`, `tier integer not null`, `title text`, `publishedAt text`, `text text not null default ''`, `textHash text`, `tokens integer not null default 0`, `archivedUrl text`, `truncated boolean not null default false`, `failure text`, `meta jsonb` (`Record<string, unknown> | null`), `createdAt`, `updatedAt`. Types `ResearchDocumentRow`, `NewResearchDocument`.
  - Table `dossierDocuments` (`dossier_documents`): `id`, `projectId` (fk projects, cascade), `documentId` (fk research_documents, cascade), `rank integer` (null = gathered, not read), `tier integer not null`, `createdAt`; unique `(project_id, document_id)`.
  - Table `claimSupports` (`claim_supports`): `id`, `claimId` (fk claims, cascade), `documentId` (fk research_documents, cascade), `rank integer not null`, `quote text not null`, `found boolean not null default false`, `offset integer`, `locatorSeconds integer`, `createdAt`; index on `claim_id`. Type `ClaimSupportRow`.
  - `claims` gains `legalStatus legal_status not null default 'none'`, `legalStatusDate text`, `legalStatusDocumentId text` (fk research_documents, set null), `series jsonb` (`$type<Series>()`).
  - `dossiers` gains `research jsonb` (`$type<GroundedResearch>()`), `entityLabel text` is NOT added (the label is inside `research.entity`).
  - `research-documents.ts`: `upsertResearchDocument(db, input: Omit<NewResearchDocument, 'id' | 'createdAt' | 'updatedAt'>): Promise<ResearchDocumentRow>` (on conflict `url`, update every column but `id` and `createdAt`); `getResearchDocuments(db, ids: readonly string[]): Promise<ResearchDocumentRow[]>`; `findResearchDocumentsByUrl(db, urls: readonly string[]): Promise<ResearchDocumentRow[]>`; `linkDossierDocuments(db, projectId: string, links: readonly { documentId: string; rank: number | null; tier: number }[]): Promise<void>` (delete the project's rows, insert the links); `listDossierDocuments(db, projectId: string): Promise<(ResearchDocumentRow & { rank: number | null; tier: number })[]>` ordered by rank nulls last; `normaliseDocumentUrl(url: string): string` (lower-case scheme and host, strip the fragment, strip `utm_*` query keys, strip a trailing slash on a bare path; pure, exported for the gather).
  - `dossiers.ts`: `DraftClaimInput` becomes `{ text; sourceUrl?: string | null; sourceType; confidence; legalStatus?: LegalStatus; legalStatusDate?: string | null; legalStatusDocumentId?: string | null; series?: Series | null; supports?: readonly { documentId: string; rank: number; quote: string; found: boolean; offset: number | null; locatorSeconds: number | null }[] }`; `saveDossier(db, { projectId, contentMd, claims, research?: GroundedResearch | null })` inserts supports after claims and writes `research` (null clears it); `DossierWithClaims` gains `research: GroundedResearch | null` and `supports: Record<string, ClaimSupportRow[]>` (by claim id); `getDossier` fills both. `blockingClaims`, `scriptableClaims`, `verifyClaim`, `countClaims` are unchanged.
  - Fixtures: `FIXTURE_DOCUMENT_IDS = [fixtureId('DOCUMENT', 1), fixtureId('DOCUMENT', 2)]` (check `fixtureId` accepts the prefix; add it to its allowed list if it is an enum); `fixtureDocuments: NewResearchDocument[]`, two rows: a `regulator` page (`https://www.bafin.de/mock/wirecard-short-selling`, text containing "banned short selling of Wirecard shares for two months") and a `reporting` page (`https://www.ft.com/mock/wirecard-insolvency`, text containing "filed for insolvency in June 2020"), both plainly labelled "MOCK DOCUMENT" in their first line; `fixtureSupports: { claimId, documentId, rank, quote, found }[]` for fixture claims 1 and 2 with `found: true`; `seed.ts` inserts documents, links them to the fixture project (ranks 1 and 2), and inserts the supports after the claims.

- [ ] **Step 1: Write the failing integration tests**

```ts
// research-documents.integration.test.ts (describe.skip without a test database, as dossiers.integration.test.ts does)
it('upserts by url and keeps the id', async () => {
  const first = await upsertResearchDocument(db, doc({ url: 'https://example.com/a', text: 'one' }))
  const second = await upsertResearchDocument(db, doc({ url: 'https://example.com/a', text: 'two' }))
  expect(second.id).toBe(first.id); expect(second.text).toBe('two')
})
it('links and lists a project corpus with unread rows last', async () => {
  await linkDossierDocuments(db, projectId, [{ documentId: b.id, rank: null, tier: 2 }, { documentId: a.id, rank: 1, tier: 1 }])
  const rows = await listDossierDocuments(db, projectId)
  expect(rows.map((r) => r.rank)).toEqual([1, null])
})
it('normalises urls', () => {
  expect(normaliseDocumentUrl('HTTPS://WWW.Example.com/Path/?utm_source=x&id=2#frag')).toBe('https://www.example.com/Path/?id=2')
})
// dossiers.integration.test.ts, added cases
it('saves supports, legal status and series with a claim and reads them back', async () => {
  const saved = await saveDossier(db, { projectId, contentMd: '# x', research: null, claims: [{ text: 'Wirecard filed for insolvency in June 2020.', sourceUrl: 'https://example.com/a', sourceType: 'major_outlet', confidence: 'single_source', legalStatus: 'alleged', legalStatusDate: '2020-06', legalStatusDocumentId: a.id, series: null, supports: [{ documentId: a.id, rank: 1, quote: 'filed for insolvency', found: true, offset: 12, locatorSeconds: null }] }] })
  const claim = saved.claims[0]!
  expect(claim.legalStatus).toBe('alleged')
  expect(saved.supports[claim.id]?.[0]?.quote).toBe('filed for insolvency')
})
it('replaces supports when the dossier is saved again', ...)
it('stores and returns research', ...)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @boom-busters/db test -- research-documents dossiers`
Expected: FAIL (module not found; column does not exist).

- [ ] **Step 3: Add the enums, tables and columns to `schema.ts`; generate the migration**

Run: `pnpm --filter @boom-busters/db generate` and read the SQL: three `CREATE TABLE`, two `CREATE TYPE`, `ALTER TABLE claims ADD COLUMN` x4, `ALTER TABLE dossiers ADD COLUMN research`. Then `pnpm --filter @boom-busters/db migrate:test` (Docker Desktop must be running).

- [ ] **Step 4: Implement `research-documents.ts`, extend `dossiers.ts`, the fixtures and `seed.ts`**

- [ ] **Step 5: Run the db suite and typecheck**

Run: `pnpm --filter @boom-busters/db test && pnpm --filter @boom-busters/db typecheck`
Expected: PASS, including `db.integration.test.ts` (seed count assertions updated for the two documents and the supports).

- [ ] **Step 6: Commit**

```bash
git add packages/db
git commit -m "feat(db): research documents, claim supports and legal status columns (migration 0034)"
```

---

### Task 3: Folding, the quote check and computed confidence

**Files:**
- Create: `packages/providers/src/research/fold.ts`, `packages/providers/src/research/confidence.ts`, `packages/providers/src/research/index.ts`
- Modify: `packages/providers/src/index.ts` (export `./research`)
- Test: `packages/providers/src/research/fold.test.ts`, `packages/providers/src/research/confidence.test.ts`

**Interfaces:**
- Produces (from `@boom-busters/providers`):
  - `foldText(text: string): { folded: string; map: number[] }`: lower-case, every run of characters that is not a Unicode letter or digit becomes one space, trimmed; `map[i]` is the offset in `text` of folded character `i` (a folded space maps to the first original character of the run).
  - `TRANSCRIPT_MARKER = /\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]/g`; `blankTranscriptMarkers(text: string): string` replaces each marker with spaces of the same length, so offsets are unchanged.
  - `quoteFound(text: string, quote: string): { found: boolean; offset: number | null }`: blank markers, fold both, require the folded quote to have at least `DOSSIER_QUOTE_MIN_FOLDED` characters, substring search, offset mapped back to `text`.
  - `locatorSeconds(text: string, offset: number): number | null`: the last marker whose match index is `<= offset`, as seconds; null when there is none.
  - `registrableDomain(url: string): string`: hostname without a leading `www.`, reduced to its last two labels, or three when the second-last label is in `['co', 'com', 'org', 'net', 'gov', 'ac', 'edu']` and the last is a two-letter country code (`ft.com`, `bbc.co.uk`, `sec.gov`, `asic.gov.au`).
  - `computeConfidence(supports: readonly { url: string; quote: string; found: boolean }[]): ClaimConfidence`: hosts are the registrable domains of found supports; two found supports whose folded quotes are equal count as one host; `>= 2` hosts is `sourced`, `1` is `single_source`, `0` is `unverified`.

- [ ] **Step 1: Write the failing tests**

```ts
it('finds a quote across curly quotes, dashes and line breaks', () => {
  const text = 'EY said it could not verify\n“around €1.9 billion” – in trustee balances.'
  expect(quoteFound(text, 'could not verify "around €1.9 billion" - in trustee')).toEqual({ found: true, offset: 11 })
})
it('refuses a paraphrase and a short quote', () => {
  expect(quoteFound('The company filed for insolvency.', 'The firm filed for insolvency').found).toBe(false)
  expect(quoteFound('The company filed for insolvency.', 'filed for').found).toBe(false)
})
it('finds a quote across a transcript marker and locates it at the earlier marker', () => {   // Review Focus 1
  const text = '[00:05] they said the money was there [00:09] and it never was'
  const hit = quoteFound(text, 'the money was there and it never was')
  expect(hit.found).toBe(true)
  expect(locatorSeconds(text, hit.offset!)).toBe(5)
})
it('maps offsets back to the original text', () => { const { map } = foldText('A—B'); expect(map).toEqual([0, 1, 2]) })
it('reduces hosts to registrable domains', () => {
  expect(registrableDomain('https://www.ft.com/content/x')).toBe('ft.com')
  expect(registrableDomain('https://news.bbc.co.uk/x')).toBe('bbc.co.uk')
  expect(registrableDomain('https://asic.gov.au/x')).toBe('asic.gov.au')
})
it('computes confidence from found supports on distinct hosts', () => {
  expect(computeConfidence([{ url: 'https://ft.com/a', quote: 'q one', found: true }, { url: 'https://reuters.com/b', quote: 'q two', found: true }])).toBe('sourced')
  expect(computeConfidence([{ url: 'https://ft.com/a', quote: 'q', found: true }, { url: 'https://www.ft.com/b', quote: 'r', found: true }])).toBe('single_source')
  expect(computeConfidence([{ url: 'https://ft.com/a', quote: 'same words', found: true }, { url: 'https://reuters.com/b', quote: 'Same words.', found: true }])).toBe('single_source')
  expect(computeConfidence([{ url: 'https://ft.com/a', quote: 'q', found: false }])).toBe('unverified')
})
```

- [ ] **Step 2: Run to verify they fail** — `pnpm --filter @boom-busters/providers test -- research/fold research/confidence`

- [ ] **Step 3: Implement `fold.ts` and `confidence.ts`; export from `research/index.ts` and the package index**

- [ ] **Step 4: Run to verify they pass**

- [ ] **Step 5: Commit** — `git commit -m "feat(providers): quote folding, locators and computed confidence"`

---

### Task 4: Fetching a document and extracting its text

**Files:**
- Create: `packages/providers/src/research/fetch.ts`, `packages/providers/src/research/extract-html.ts`, `packages/providers/src/research/extract-pdf.ts`, `packages/providers/src/research/extract-tenk.ts`, `packages/providers/src/research/render-figures.ts`, `packages/providers/src/research/fixtures/` (an article HTML, a 10-K-shaped HTML with a table of contents, a one-page uncompressed PDF, an XBRL companyfacts JSON extract, a Stooq CSV)
- Modify: `packages/providers/package.json` (add `node-html-parser` and `unpdf@1.9.1`)
- Test: `packages/providers/src/research/fetch.test.ts`, `extract-html.test.ts`, `extract-pdf.test.ts`, `extract-tenk.test.ts`, `render-figures.test.ts`

**Interfaces:**
- Consumes: `assertSafeArticleUrl`, `USER_AGENT`, `MAX_REDIRECT_HOPS` from `packages/providers/src/article`.
- Produces:
  - `interface FetchedDocument { url: string; finalUrl: string | null; httpStatus: number | null; contentType: string | null; body: Uint8Array | null; archivedUrl: string | null; failure: string | null }`.
  - `fetchDocument(url: string, options?: { fetchImpl?: typeof fetch; signal?: AbortSignal; archiveFallback?: boolean; maxBytes?: number }): Promise<FetchedDocument>`: guard the URL and each hop (`redirect: 'manual'`, up to `MAX_REDIRECT_HOPS`), 8 s timeout, read the body as a stream and stop at `maxBytes` (default `DOCUMENT_BODY_CAP_BYTES`) with `failure: 'too large'` and `body: null`; a non-2xx or a network error tries one Wayback `available` lookup when `archiveFallback !== false` and fetches the snapshot, setting `archivedUrl`; never throws for a bad page, only for a bad argument.
  - `htmlToText(html: string): { title: string | null; text: string; publishedAt: string | null }`: drop `script, style, noscript, nav, header, footer, aside, form, svg`; prefer `article`, else `main`, else `body`; block elements separated by blank lines; whitespace collapsed inside lines; `publishedAt` from `article:published_time` or JSON-LD `datePublished`, day precision.
  - `pdfToText(bytes: Uint8Array): Promise<string>`: `const { extractText, getDocumentProxy } = await import('unpdf')`; pages joined with blank lines.
  - `tenKSections(text: string): string`: Items 1 and 7 by heading match `/^\s*item\s+1\.?\s+business/im` and `/^\s*item\s+7\.?\s+management/im`; when a heading matches twice, the second occurrence starts the section (the first is the table of contents); each section ends at the next `/^\s*item\s+\d+[a-z]?\./im` heading; each capped at `6_000` tokens via `truncateAtParagraph` (Task 5 exports it; until then a local helper is acceptable and replaced in Task 5); the two joined with a blank line, or the first 12,000 tokens of the text when neither matches.
  - `xbrlFactsText(json: unknown): string`: lines `concept | FY | value | unit` for `Revenues`, `RevenueFromContractWithCustomerExcludingAssessedTax`, `NetIncomeLoss`, `Assets`, `Liabilities`, `CashAndCashEquivalentsAtCarryingValue`, `10-K` forms with `fp === 'FY'`, one line per fiscal year (latest filed wins), sorted by year.
  - `pricesText(csv: string): string`: Stooq `Date,Open,High,Low,Close,Volume` rows, last trading day of each month, lines `YYYY-MM | close`.
  - `extractText(doc: FetchedDocument, kind: DocumentKind): Promise<{ title: string | null; text: string; publishedAt: string | null }>`: by content type (`text/html` → `htmlToText`, `application/pdf` → `pdfToText`, else UTF-8), then `tenKSections` when `kind === 'filing'` and the text matches `/form 10-k/i` within its first 2,000 characters.

- [ ] **Step 1: Write the failing tests**

```ts
it('reads a page body in full and records the final url', async () => { /* fetchImpl returns 200 html; expect body length, httpStatus 200, finalUrl */ })
it('re-checks every redirect hop and refuses a private address', async () => { /* 302 to http://10.0.0.1/ → failure contains 'private' */ })
it('abandons a body over the cap as too large', async () => {   // Review Focus 3
  const stream = new ReadableStream({ start(c) { for (let i = 0; i < 5; i++) c.enqueue(new Uint8Array(1024 * 1024)); c.close() } })
  const doc = await fetchDocument('https://example.com/big', { fetchImpl: async () => new Response(stream, { status: 200, headers: { 'content-type': 'text/html' } }), archiveFallback: false })
  expect(doc.failure).toBe('too large'); expect(doc.body).toBeNull()
})
it('falls back to a Wayback snapshot on a 404', async () => { /* first 404, availability JSON, snapshot 200 → archivedUrl set */ })
it('extracts the article body and drops navigation', () => { const out = htmlToText(fixture('article.html')); expect(out.text).toContain('EY refused'); expect(out.text).not.toContain('Subscribe') ; expect(out.publishedAt).toBe('2020-06-25') })
it('reads a one-page pdf', async () => { expect(await pdfToText(fixtureBytes('one-page.pdf'))).toContain('Hello dossier') })
it('cuts a 10-K to items 1 and 7 after the table of contents', () => { const out = tenKSections(fixture('tenk.txt')); expect(out).toContain('We operate'); expect(out).toContain('Results of operations'); expect(out).not.toContain('Risk factors body') })
it('renders annual xbrl facts one line per year', () => { expect(xbrlFactsText(JSON.parse(fixture('companyfacts.json')))).toContain('Revenues | 2022 | 7432000000 | USD') })
it('renders month-end closes', () => { expect(pricesText(fixture('stooq.csv'))).toContain('2020-06 | 1.28') })
```

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Add the dependencies, implement the five modules and `extractText`**

Run: `pnpm --filter @boom-busters/providers add node-html-parser unpdf@1.9.1`

- [ ] **Step 4: Run to verify they pass; `pnpm --filter @boom-busters/providers typecheck`**

- [ ] **Step 5: Commit** — `git commit -m "feat(providers): document fetch with a body cap, html, pdf, 10-K and figure extraction"`

---

### Task 5: Ranking the corpus and rendering it for the model

**Files:**
- Create: `packages/providers/src/research/rank.ts`, `packages/providers/src/research/corpus.ts`
- Test: `packages/providers/src/research/rank.test.ts`, `corpus.test.ts`

**Interfaces:**
- Produces:
  - `estimateTokens(text: string): number`.
  - `truncateAtParagraph(text: string, maxTokens: number): { text: string; truncated: boolean }`: cut at the last blank line inside `maxTokens * 4` characters, else at the last line break, else hard.
  - `interface RankableDocument { id: string; kind: DocumentKind; tier: 1 | 2 | 3 | 4 | 5; tokens: number; publishedAt: string | null; text: string }`; `interface RankedDocument extends RankableDocument { rank: number; truncated: boolean }`.
  - `rankCorpus(docs: readonly RankableDocument[], options?: { corpusTokens?: number; documentTokens?: number; anchorDate?: string | null }): { read: RankedDocument[]; unread: RankableDocument[] }`: each document first cut to `documentTokens`; tier budgets from `DOSSIER_TIER_SHARES * corpusTokens`; inside a tier, order by `|publishedAt - anchorDate|` ascending (undated last) when `anchorDate` is given, else `publishedAt` descending with undated last; a tier's unused budget rolls to the next tier; `read` is numbered 1..n in tier order then in-tier order.
  - `interface CorpusDocument { id: string; url: string; kind: DocumentKind; title: string | null; publishedAt: string | null; text: string; archivedUrl: string | null; httpStatus: number | null }`.
  - `renderCorpus(docs: readonly CorpusDocument[]): string`: for each, `[D${n}] ${kind} · ${title ?? url} · ${publishedAt ?? 'undated'} · ${url}` then the text, documents separated by `\n\n----\n\n`.
  - `documentByNumber(docs: readonly CorpusDocument[], n: number): CorpusDocument | undefined`.

- [ ] **Step 1: Write the failing tests**

```ts
it('gives each tier its share and rolls the unused share down', () => {
  // tier 1 has one 5k document, tier 2 has four 10k documents, corpus cap 40k:
  // tier 1 budget 10k reads the 5k doc; its 5k remainder plus tier 2's 12k reads one 10k doc; the rest are unread
  const { read, unread } = rankCorpus(docs, { corpusTokens: 40_000 })
  expect(read.map((d) => d.id)).toEqual(['t1a', 't2a']); expect(unread).toHaveLength(3)
})
it('orders a tier by nearness to the anchor date, undated last', ...)
it('cuts a document at a paragraph break and marks it truncated', ...)
it('numbers documents in order and renders a header line each', () => { expect(renderCorpus(docs)).toMatch(/^\[D1\] reporting · EY refuses · 2020-06-25 · https:/) })
```

- [ ] **Step 2: Run to verify they fail** — **Step 3: Implement** — **Step 4: Run to verify they pass**

- [ ] **Step 5: Commit** — `git commit -m "feat(providers): corpus ranking by tier share and numbered rendering"`

---

### Task 6: Case-finder sources the gather needs (extensions)

**Files:**
- Modify: `packages/case-finder/src/sources/http.ts`, `wikipedia.ts`, `wikidata.ts`, `edgar.ts`, `youtube.ts`, `mock.ts`, `packages/case-finder/src/types.ts`
- Create fixtures under `packages/case-finder/src/sources/fixtures/`: `wikipedia-search.json`, `wikipedia-current-content.json`, `wikidata-entities-ticker.json`, `edgar-filing-index.json`, `youtube-videos-details.json`
- Test: the matching `*.test.ts` files

**Interfaces:**
- Produces:
  - `PoliteClientOptions.retry?: { attempts: number; maxBackoffMs: number }` (defaults: the current 6 and 120,000); `backOff` caps at `maxBackoffMs`; `willRetry` and the network-failure branch use `attempts`.
  - `WikipediaSource.search(query: string, limit: number): Promise<{ title: string; pageid: number }[]>` (`list=search&srnamespace=0`); `WikipediaSource.currentItems(title: string): Promise<RevisionItems>` (latest revision content through `wikitextItems`; a missing page returns empty items).
  - `EntityFacts` gains `ticker: { symbol: string; exchange: string | null } | null` (P249 with its P414 qualifier's item id), `website: string | null` (P856), `inception: IsoDate | null` (P571).
  - `EdgarSource.exhibits(cik: string, options: { items: readonly string[]; newest: number }): Promise<PrimaryDocument[]>`: the newest `newest` 8-Ks whose `items` include any of `items`, each filing folder's `index.json` read once, the entry whose `name` matches `/ex-?99[._-]?1/i` or whose type is `EX-99.1` returned with `title: '8-K exhibit 99.1 filed <date>'`; `EdgarSource.latestFiling(cik: string, form: string): Promise<PrimaryDocument | null>`.
  - `YoutubeSource.details(ids: readonly string[]): Promise<VideoDetails[]>` where `interface VideoDetails { id: string; title: string; description: string; publishedAt: IsoDate; durationSec: number; channelTitle: string }` (`videos.list part=snippet,contentDetails`, 1 unit).
  - `videoIdFromUrl(url: string): string | null` (watch `v=`, `youtu.be/<id>`, `/shorts/<id>`; pure, exported from `youtube.ts`).
  - `mock.ts` mock sources gain the same methods with fixed answers.

- [ ] **Step 1: Write the failing tests** (one per method, following `edgar.test.ts`'s `setup` pattern with recorded fixtures; the retry test asserts a 500-then-500 with `retry: { attempts: 1, maxBackoffMs: 10 }` returns the 500 after one backoff and that `onBackoff` saw a wait `<= 10`)

- [ ] **Step 2: Run to verify they fail** — `pnpm --filter @boom-busters/case-finder test`

- [ ] **Step 3: Implement each extension; keep every existing test green**

- [ ] **Step 4: Run to verify they pass; `pnpm --filter @boom-busters/case-finder typecheck`**

- [ ] **Step 5: Commit** — `git commit -m "feat(case-finder): search, current references, ticker and website facts, 8-K exhibits, video details, bounded retries"`

---

### Task 7: New sources: transcripts, prices, Wayback captures, XBRL

**Files:**
- Create: `packages/case-finder/src/sources/transcript.ts`, `stooq.ts`, `wayback.ts`, `xbrl.ts`, fixtures `youtube-player-captions.html`, `youtube-captions.json3`, `stooq-wdi.csv`, `wayback-cdx.json`, `xbrl-companyfacts-small.json`
- Modify: `packages/case-finder/src/index.ts`, `mock.ts`
- Test: `transcript.test.ts`, `stooq.test.ts`, `wayback.test.ts`, `xbrl.test.ts`

**Interfaces:**
- Produces:
  - `interface TranscriptSource { fetch(videoId: string): Promise<{ start: number; text: string }[] | null> }`; `liveTranscripts(fetchImpl?: typeof fetch): TranscriptSource`: GET `https://www.youtube.com/watch?v=<id>` with the case-finder user agent, find `"captionTracks":[...]` in the page, pick the track with `languageCode` starting `en` (prefer a non-`asr` kind), GET its `baseUrl` with `&fmt=json3`, map `events[].segs[].utf8` into segments; any miss returns `null`, never throws. `mockTranscripts: TranscriptSource` returns a fixed five-segment transcript for any id.
  - `interface StooqSource { daily(symbol: string): Promise<string | null> }`; `liveStooq(client: PoliteClient): StooqSource` (`https://stooq.com/q/d/l/?s=<symbol>&i=d`, null on a non-CSV body); `stooqSymbol(ticker: string, exchangeQid: string | null): string | null` mapping `Q13677` (NYSE), `Q82059` (NASDAQ) to `<ticker>.us`, `Q152139` (Frankfurt), `Q2385849` (XETRA) to `<ticker>.de`, `Q171240` (LSE) to `<ticker>.uk`, else null.
  - `interface WaybackSource { captures(url: string, options: { from: string; to: string; limit: number }): Promise<{ timestamp: string; url: string }[]> }`; `liveWayback(client: PoliteClient)`: CDX `https://web.archive.org/cdx/search/cdx?url=<host>&output=json&filter=statuscode:200&collapse=timestamp:4&from=<from>&to=<to>&limit=<limit>`, each row to `{ timestamp, url: 'https://web.archive.org/web/<timestamp>/<original>' }`.
  - `interface XbrlSource { companyFacts(cik: string): Promise<unknown | null> }`; `liveXbrl(client: PoliteClient)`: `https://data.sec.gov/api/xbrl/companyfacts/CIK<10 digits>.json`, null on 404.

- [ ] **Step 1: Write the failing tests** (fixtures; the transcript test covers the page with tracks, a page without, and a json3 body)

- [ ] **Step 2: Run to verify they fail** — **Step 3: Implement** — **Step 4: Run to verify they pass**

- [ ] **Step 5: Commit** — `git commit -m "feat(case-finder): transcript, stooq, wayback and xbrl sources"`

---

### Task 8: The four passes' prompts, parsers, renderer and mocks

**Files:**
- Modify: `packages/providers/src/prompts/dossier.ts` (rewrite), `packages/providers/src/prompts/index.ts`
- Create: `packages/providers/src/research/mock-corpus.ts`
- Test: `packages/providers/src/prompts/dossier.test.ts` (rewrite)

**Interfaces:**
- Consumes: Task 1 schemas; `renderCorpus`, `CorpusDocument` from Task 5; `trimField`, `capList`, `dropItems`, `parseJsonCompletion`, `formatIssues` as today.
- Produces:
  - `CaseContext` unchanged.
  - `buildBriefRequest(input: CaseContext, corpus: string): LLMTaskRequest`; `buildScenesRequest(input, corpus, brief: CaseBrief)`; `buildClaimsRequest(input, corpus, brief, scenes: readonly Scene[])`; `buildAnswersRequest(input, corpus, brief, scenes)`. Every request's first user message is `${caseHeader(input)}\n\nDocuments, numbered. Cite them by number.\n\n${corpus}` with `cacheablePrefixMessages: 1`; the system prompt is `HOUSE_RULES` with the new sentence from spec section 5 and the pass's shape and limits; the claims pass asks for at most `DOSSIER_CLAIMS_PER_PASS` claims, `outputBudget(16_000)`; the answers pass `outputBudget(12_000)`; scenes `outputBudget(10_000)`; brief `outputBudget(6_000)`. The claims prompt text pins: "`quote` is the shortest span of the document that proves the claim, copied exactly, usually under 120 characters and never over 300"; "`legal.status` is `ruled` only when a court or regulator document in the list says so; `alleged` when a filing, complaint or report makes the allegation; `none` otherwise"; "a figure claim carries `series` with `asWritten` copied as the document prints the number".
  - `withNote(request: LLMTaskRequest, note: string): LLMTaskRequest`: appends `\n\nThe human asks for changes: ${note}` to the last user message.
  - `parseBrief(text, note?): CaseBrief`, `parseScenes(text, note?): Scene[]`, `parseClaims(text, note?): ResearchClaim[]`, `parseAnswers(text, note?): ResearchAnswers`, each repairing as today (trim free text, cap lists, drop an item whose fact is over its limit; a support whose quote is over `DOSSIER_QUOTE_MAX` is dropped with a note, and a claim left without supports is dropped with a note).
  - `renderDossierMarkdown(input: { caseTitle: string; research: GroundedResearch; claims: readonly GroundedClaim[] }): string` with sections in order: `# title`, `## Summary`, `## The turn`, `## Principals` (`- **name** — role. *wanted*`), `## Timeline` (`- **when** — what (who). *why* ([source](url))` plus ` (unplaced)` when `ref.found` is false; the url carries `&t=<seconds>` when `locatorSeconds` is set), `## Questions the research answered` and `## Open questions` as today (placing by index, falling back to folded text, never discarding a non-null answer; the source link from `ref.url`), `## Told already` (`- beat ([video title or url](url))`, omitted when empty), `## Unverified` as today. A figure claim's text is already rendered with its series by Task 9, so the renderer does nothing special for it.
  - Mocks: `mockCorpusDocuments(): CorpusDocument[]` (four documents: a `press-release`, a `reporting` page, a `video` transcript with `[mm:ss]` markers, a `regulator` page, every text starting "MOCK DOCUMENT"), `mockBrief(input)`, `mockScenes()`, `mockClaims()`, `mockAnswers(brief)`, each citing the mock documents by number so that grounding yields: one claim found (sourced from docs 2 and 4), one claim with a quote not in its document (unverified; this keeps the e2e fixture parked at the gate), one figure claim with a two-point series found in doc 1, one claim with `legal: { status: 'ruled', date: '2019-02', doc: 4 }`, one scene citing the transcript so a locator exists, one told-already beat citing doc 3.

- [ ] **Step 1: Rewrite the tests**

```ts
it('puts the corpus in the first user message and marks it cacheable', () => {
  const request = buildClaimsRequest(caseContext, '[D1] reporting · x · 2020 · https://x\nText', brief, scenes)
  expect(request.messages[0]?.content).toContain('[D1] reporting'); expect(request.cacheablePrefixMessages).toBe(1)
})
it('withNote appends to the last user message only', ...)
it('parseClaims drops a support whose quote is over 300 characters and the claim when none is left, noting both', ...)
it('parseScenes keeps sixty scenes and notes the cap', ...)
it('renders scenes with a timestamped source and marks an unplaced one', () => {
  const md = renderDossierMarkdown({ caseTitle: 'Wirecard', research: grounded({ scenes: [scene({ ref: { url: 'https://youtube.com/watch?v=abc', locatorSeconds: 65, found: true } }), scene({ ref: { found: false } })] }), claims: [] })
  expect(md).toContain('([source](https://youtube.com/watch?v=abc&t=65))'); expect(md).toContain('(unplaced)')
})
it('omits Told already when empty and lists beats otherwise', ...)
it('mock research grounds to one found, one not found, one figure and one ruled claim', ...)   // runs groundResearch from Task 9; write it after Task 9 lands if the suite is split
```

- [ ] **Step 2: Run to verify they fail** — **Step 3: Implement** — **Step 4: Run to verify they pass; `pnpm --filter @boom-busters/providers typecheck`** (other packages still red until Task 11)

- [ ] **Step 5: Commit** — `git commit -m "feat(providers): dossier passes over a numbered corpus, scenes, cast, told-already and the renderer"`

---

### Task 9: Grounding

**Files:**
- Create: `packages/providers/src/research/ground.ts`
- Test: `packages/providers/src/research/ground.test.ts`

**Interfaces:**
- Consumes: Task 1 shapes, Task 3 `quoteFound`, `locatorSeconds`, `computeConfidence`, Task 5 `CorpusDocument`, `documentByNumber`.
- Produces:
  - `groundResearch(input: { entity: ResearchEntity; brief: CaseBrief; scenes: readonly Scene[]; claims: readonly ResearchClaim[]; answers: readonly ResearchAnswer[]; documents: readonly CorpusDocument[]; corpus: { read: number; unread: number; failed: number } }, note: Note): { research: GroundedResearch; claims: GroundedClaim[] }`.
  - Rules: a `doc` outside `1..documents.length` → the support (or scene/cast/beat/answer ref) is dropped with `note({ action: 'dropped', field: 'claim N support M', reason: 'cites a document that was not given' })`; a claim with no support left stays with `supports: []`, `sourceUrl: null`, `sourceType: 'other'`, `confidence: 'unverified'`. Each kept support gets `found`/`offset` from `quoteFound` and `locatorSeconds` when the document is a `video`. `sourceUrl` is the first support's url, `sourceType` from its kind (`court` → `court`, `regulator` → `regulator`, `reporting` and `video` → `major_outlet`, else `other`). `confidence` from `computeConfidence`. `legal`: `ruled` with a document whose kind is not `court` or `regulator` → `alleged` with `note({ action: 'dropped', field: 'claim N legal status', reason: 'ruled needs a court or regulator document' })`; `legalStatusDocumentId` from the number; a `legal.doc` out of range → `legalStatus: 'none'`. `series`: each point whose `asWritten` is not found in the series' first support document is dropped with a note; a series left with no points becomes null; a kept series is rendered into the claim text as `${text} ${label} (${unit}${currency ? ', ' + currency : ''}): ${points.map(p => p.at + ' ' + p.asWritten).join('; ')}`. Scenes, cast scenes, told-already beats and answers get a `GroundedRef` the same way (quote check on the cited document; `url` from it).

- [ ] **Step 1: Write the failing tests**

```ts
it('drops a support that cites a document not given and leaves the claim unverified', () => {   // Review Focus 2
  const out = groundResearch(withClaims([{ text: 'x'.repeat(20), supports: [{ doc: 99, quote: 'anything at all here' }] }]), note)
  expect(out.claims[0]).toMatchObject({ supports: [], sourceUrl: null, confidence: 'unverified' })
  expect(repairs).toContainEqual({ action: 'dropped', field: 'claim 1 support 1', reason: 'cites a document that was not given' })
})
it('folds ruled on a reporting document to alleged and notes it', ...)   // Review Focus 4
it('finds quotes, computes confidence from two hosts and takes sourceUrl from the first support', ...)
it('drops a series point whose written number is not in the document and renders the rest into the text', ...)
it('locates a scene in a transcript and marks a scene with a missing quote unplaced', ...)
```

- [ ] **Step 2: Run to verify they fail** — **Step 3: Implement** — **Step 4: Run to verify they pass**

- [ ] **Step 5: Commit** — `git commit -m "feat(providers): ground research against the corpus"`

---

### Task 10: The gather step

**Files:**
- Create: `apps/web/inngest/lib/steps.ts`, `apps/web/inngest/lib/dossier-discover.ts`, `apps/web/inngest/lib/dossier-gather.ts`, `apps/web/lib/research-sources.ts`
- Modify: `apps/web/package.json` (add `"@boom-busters/case-finder": "workspace:*"`), `packages/schemas/src/env.ts` (`YOUTUBE_TRANSCRIPTS` in `CaseFinderEnvSchema` as `z.enum(['0', '1']).optional()` and in `DEFERRED_GROUPS.caseFinder`), `.env.example` (`YOUTUBE_TRANSCRIPTS=0`)
- Test: `apps/web/inngest/lib/dossier-discover.test.ts`, `apps/web/inngest/lib/dossier-gather.test.ts`

**Interfaces:**
- Consumes: Task 6 and 7 sources; Task 4 `fetchDocument`, `extractText`; Task 5 `rankCorpus`, `estimateTokens`; Task 2 helpers; `readCaseFinderEnv`; `createPoliteClient`, `createQuotaLedger`, `isPrimaryReference`.
- Produces:
  - `steps.ts`: `export interface Steps { run<T>(id: string, fn: () => Promise<T>): Promise<T> }`; `export const inlineSteps: Steps = { run: (_, fn) => fn() }`.
  - `research-sources.ts`: `interface ResearchSources { wikipedia: WikipediaSource; wikidata: WikidataSource; edgar: EdgarSource; courtlistener: CourtListenerSource; youtube: YoutubeSource | null; transcripts: TranscriptSource | null; stooq: StooqSource; wayback: WaybackSource; xbrl: XbrlSource; fetchDocument: typeof fetchDocument }`; `liveResearchSources(env = process.env): ResearchSources` (one `PoliteClient` with `cacheDir: null`, `retry: { attempts: 2, maxBackoffMs: 10_000 }`, contact from `DATA_CONTACT_EMAIL`; `youtube` null without `YOUTUBE_DATA_API_KEY`, with a ledger of `createQuotaLedger(1_000, 0)`; `transcripts` null unless `YOUTUBE_TRANSCRIPTS === '1'`); `mockResearchSources(): ResearchSources`.
  - `dossier-discover.ts`: `interface Candidate { url: string; kind: DocumentKind; tier: 1 | 2 | 3 | 4 | 5; title: string | null; publishedAt: string | null; meta: Record<string, unknown> | null }`; `resolveEntity(sources, caseTitle: string): Promise<ResearchEntity & { businessTitle: string | null; relatedTitles: string[] }>` (spec 4.1: top five search hits, business class check against `BUSINESS_CLASSES = ['Q4830453', 'Q783794', 'Q891723', 'Q6881511', 'Q43229', 'Q22687']`, up to two related titles by the title words `scandal|collapse|bankruptcy|fraud|affair`); `discoverCandidates(sources, entity, input: { competitorLinks: readonly { url: string }[]; caseTitle: string }): Promise<Candidate[]>` producing, in tier order: EDGAR exhibits (`items: ['2.02', '8.01'], newest: 6`) and the latest 10-K as `filing`; Wayback homepage captures (`from` the inception year or ten years before dissolution, `to` dissolution or today, `limit: 6`) as `web-archive`; references on the website's registrable domain as `press-release`; references not primary and not on the website as `reporting`; competitor links with a video id plus one `youtube.search(caseTitle)` as `video` (`meta.videoId`); XBRL facts (`meta.cik`) and Stooq prices (`meta.symbol`) as `figures`; primary references as `regulator` (or `court` when the host is a court site: `courtlistener.com`, `uscourts.gov`, `bailii.org`, `pacer`); CourtListener dockets as `court`. Duplicates by `normaliseDocumentUrl` are kept once, first tier wins.
  - `dossier-gather.ts`: `gatherCorpus(steps: Steps, input: { projectId: string; caseTitle: string; competitorLinks: readonly { url: string }[]; round: number }, deps: { db: Database; sources: ResearchSources; mocked: boolean }): Promise<{ entity: ResearchEntity; read: string[]; unread: string[]; failed: number }>`. Steps: `gather-entity-<round>`; `gather-discover-<round>` (returns the candidate list); `gather-fetch-<round>-<batch>` for batches of five (skip candidates whose stored document is younger than 90 days; `video` candidates read details and the transcript through the sources rather than `fetchDocument`; `figures` candidates render through `xbrlFactsText`/`pricesText`; everything else `fetchDocument` then `extractText`; upsert each row with `tokens`, `textHash` as SHA-256 hex of `text`, `failure` when the fetch failed; return ids); `gather-rank-<round>` (load rows, `rankCorpus` with `anchorDate` = the entity's dissolution date when known, write `dossier_documents`, store ranked text truncation back on the link rather than the row: the row keeps the full text, and the rank step returns the ids in order). In mock mode the fetch step upserts `mockCorpusDocuments()` as rows and links all four, with no sources called.

- [ ] **Step 1: Write the failing tests**

```ts
// dossier-discover.test.ts with fake sources (plain objects)
it('prefers the business item among the search hits and takes references from the scandal article too', ...)
it('files candidates by tier and keeps a duplicate url once at its first tier', ...)
it('turns a competitor link into a video candidate and ignores a non-video link', ...)
// dossier-gather.test.ts: integration against the test database with fake sources and a fake fetchDocument; describe.skip without the database
it('stores every candidate, links the ranked ones and marks the rest unread', ...)
it('reuses a document fetched less than 90 days ago without calling fetch', ...)
it('records a failed fetch and continues', ...)
it('in mock mode stores the four mock documents and calls no source', ...)
```

- [ ] **Step 2: Run to verify they fail** — `pnpm --filter @boom-busters/web test -- dossier-discover dossier-gather`

- [ ] **Step 3: Add the dependency and env flag; implement the four modules**

- [ ] **Step 4: Run to verify they pass**

- [ ] **Step 5: Commit** — `git commit -m "feat(web): gather a research corpus for a case before the dossier passes"`

---

### Task 11: The passes over the corpus, the runner, the reviser and the script runner

**Files:**
- Modify: `apps/web/inngest/lib/dossier-research.ts` (rewrite), `apps/web/inngest/functions/dossier-runner.ts`, `apps/web/inngest/functions/dossier-reviser.ts`, `apps/web/inngest/functions/script-runner.ts:182-197`
- Test: `apps/web/inngest/lib/dossier-research.test.ts`, `apps/web/inngest/functions/dossier-runner.test.ts`, `dossier-reviser.test.ts`, `script-runner.test.ts`

**Interfaces:**
- Consumes: Tasks 8, 9, 10; `listDossierDocuments`, `saveDossier`, `linkDossierDocuments`.
- Produces:
  - `researchDossier(steps: Steps, input: { projectId: string; caseContext: CaseContext; round: number; note?: string; entity: ResearchEntity; documents: readonly CorpusDocument[]; corpus: { read: number; unread: number; failed: number } }, deps?: { complete?: AnswerComplete; mocked?: boolean }): Promise<ResearchResult>` where `ResearchResult = { research: GroundedResearch; claims: GroundedClaim[]; repairs: Repair[]; budgetGate?: Record<string, unknown> }`. Four steps `research-brief-<round>`, `research-scenes-<round>`, `research-claims-<round>`, `research-answers-<round>`, each through `guarded` as today, each request passed through `withNote` when `note` is set; then `groundResearch` runs inside `research-ground-<round>` with the answers' claims deduplicated against the claims pass by folded text before grounding.
  - `dossier-runner`: after `load-case` (which now also returns `competitorLinks`), `gatherCorpus` (round 0), then load the ranked documents (`listDossierDocuments` filtered to `rank !== null`, mapped to `CorpusDocument` with text cut by `truncateAtParagraph(text, DOSSIER_DOCUMENT_TOKENS)`) inside a step `corpus-load-<round>`, then `researchDossier`, then `save-dossier` writes `contentMd` from `renderDossierMarkdown`, the claims with supports, `research`. Auto-approve when `counts.blocking === 0 && claims.every(c => c.supports[0] && (c.supports[0].archivedUrl !== null || (httpStatus of its document) is 2xx))`; the document statuses come from the corpus loaded in the same run. `gateSummary(counts, corpus: { read; unread; failed })` appends ` · ${read} documents read, ${unread} gathered not read, ${failed} could not be fetched`.
  - `dossier-reviser`: no gather; loads the project's linked documents; if none are linked (a project researched before this change), runs `gatherCorpus` first; `note` reaches every pass.
  - `script-runner`: `claims: usable.map((claim) => ({ id, text, sourceUrl, confidence, sourceType: claim.sourceType, adjudicated: claim.legalStatus === 'ruled' }))`.

- [ ] **Step 1: Write the failing tests**

```ts
// dossier-research.test.ts: fake Steps (inlineSteps), fake complete returning fixture JSON per call
it('runs four passes, passes the note to every one, and grounds the result', async () => {   // Review Focus 5 (note)
  const seen: string[] = []
  const complete = async (request) => { seen.push(request.messages.at(-1)!.content); return { text: fixtureFor(request) } }
  const result = await researchDossier(inlineSteps, { ...input, note: 'Less about the auditors' }, { complete })
  expect(seen.every((m) => m.includes('The human asks for changes: Less about the auditors'))).toBe(true)
  expect(result.claims.some((c) => c.confidence === 'sourced')).toBe(true)
})
it('returns the budget gate when a pass crosses the cap', ...)
// dossier-runner.test.ts (existing pattern, stored step results)
it('saves supports and research and auto-approves only when every claim is grounded on a fetched document', ...)
it('opens the gate with the corpus line when a claim is unverified', ...)
// dossier-reviser.test.ts
it('reuses the linked corpus and does not gather again', ...)   // Review Focus 5 (reuse)
// script-runner.test.ts
it('marks a ruled claim adjudicated and every other claim not', ...)
```

- [ ] **Step 2: Run to verify they fail** — **Step 3: Implement** — **Step 4: Run** `pnpm --filter @boom-busters/web test -- dossier script-runner` **and `pnpm typecheck` at the root (green from here on)**

- [ ] **Step 5: Commit** — `git commit -m "feat(web): dossier passes over the gathered corpus; grounded auto-approval; script reads the legal status"`

---

### Task 12: The review screen: quotes beside claims, scenes beside sources, the corpus line

**Files:**
- Modify: `apps/web/app/(console)/projects/[id]/dossier-review.tsx`, `apps/web/app/(console)/projects/[id]/page.tsx:537-541`
- Test: `apps/web/app/(console)/projects/[id]/dossier-review.test.tsx`

**Interfaces:**
- Consumes: `DossierWithClaims.supports` and `.research` from Task 2; `listDossierDocuments` for the corpus line's lists.
- Produces: `DossierReview` props gain `supports: Record<string, ClaimSupportRow[]>`, `research: GroundedResearch | null`, `documents: { id: string; url: string; title: string | null; kind: DocumentKind; rank: number | null; failure: string | null }[]`. In `ClaimRowView`, above the actions, a `SupportList`: one row per support with the document's title (or url), kind badge, a link (`&t=` when `locatorSeconds`), the quote in a `<blockquote>`, and the text "Found in the document" or "Not found in the document". Under the page title, a `CorpusLine`: "Researched from: <titles joined>, <n> documents read", with two `<details>` for "<n> gathered, not read" and "<n> could not be fetched" listing urls. The Timeline section renders from `research.scenes` when `research` is present (each entry's source link and "(unplaced)"), else from the markdown as today.

- [ ] **Step 1: Write the failing component tests**

```ts
it('shows each support with its quote and whether it was found', () => { render(<DossierReview ... supports={{ [claim.id]: [support({ quote: 'filed for insolvency', found: true }), support({ found: false })] }} />); open the claim; expect(screen.getByText('filed for insolvency')).toBeInTheDocument(); expect(screen.getByText('Not found in the document')).toBeInTheDocument() })
it('links a video support at its timestamp', ...)
it('shows the corpus line with unread and failed lists', ...)
it('renders scenes from research with an unplaced marker', ...)
it('renders an old dossier with no research from its markdown', ...)
```

- [ ] **Step 2: Run to verify they fail** — **Step 3: Implement (buttons stay 40 px, layout works at 390 px)** — **Step 4: Run** `pnpm --filter @boom-busters/web test -- dossier-review`

- [ ] **Step 5: Commit** — `git commit -m "feat(web): dossier review shows quotes beside claims, scenes beside sources and the corpus line"`

---

### Task 13: The back-test harness and its report

**Files:**
- Create: `apps/web/lib/dossier-backtest.ts`, `apps/web/scripts/live-dossier-backtest.ts`, `docs/cases/README.md` (one paragraph: what the reports are)
- Modify: `apps/web/package.json` (`"live:dossier-backtest": "tsx --env-file=../../.env.local scripts/live-dossier-backtest.ts"`)
- Test: `apps/web/lib/dossier-backtest.test.ts`

**Interfaces:**
- Produces:
  - `BACKTEST_CASES = [{ title: 'Wirecard', category: 'con' }, { title: 'Enron', category: 'collapse' }, { title: 'Theranos', category: 'con' }, { title: 'FTX', category: 'collapse' }, { title: 'SVB Financial', category: 'meltdown' }] as const`.
  - `BACKTEST_TARGETS = { quoteFound: 0.9, urlResolved: 0.95, figureMatch: 0.8, toldAlready: 0.9, costUsd: 6 } as const`.
  - `interface CaseRun { title: string; claims: GroundedClaim[]; research: GroundedResearch; documents: { url: string; httpStatus: number | null; archivedUrl: string | null; kind: DocumentKind; failure: string | null }[]; xbrl: unknown | null; costUsd: number; model: string }`.
  - `figureMatches(claims, xbrl): { matched: number; mismatched: number; notCheckable: number }`: a series whose claim text matches `/revenue|net income|net loss|total assets/i` and whose label names the concept, each point `at` a four-digit year, compared with the XBRL value for that fiscal year within 1%.
  - `scoreRuns(runs: readonly CaseRun[]): Report` with per-case and overall rates, each `number | 'not measured'`, `transcriptAvailability`, and `verdict: { pass: boolean; failing: string[] }` (a rate under its target fails; `'not measured'` does not).
  - `renderReport(report: Report, date: string): string` (markdown table per rate and case, then the verdict).
  - The script: parses `--cap <usd>` (default 1, up to 30 on the owner's word) and `--cases <titles>`; for each case creates a throwaway case and project row (`createCase`, `createProjectFromCase`) in the database `.env.local` names, runs `gatherCorpus(inlineSteps, ...)` with `liveResearchSources()`, loads the corpus, runs `researchDossier(inlineSteps, ...)` with `completeForProject` under the cap, reads the ledger for cost and model, and deletes the rows at the end; writes `docs/cases/dossier-backtest-<YYYY-MM-DD>.md`. It refuses to run with `MOCK_PROVIDERS=1` and says why.

- [ ] **Step 1: Write the failing tests** for `figureMatches`, `scoreRuns` (a run under one target fails with its name; a run with no checkable figures is `'not measured'` and passes) and `renderReport`

- [ ] **Step 2: Run to verify they fail** — **Step 3: Implement the lib and the script** — **Step 4: Run** `pnpm --filter @boom-busters/web test -- dossier-backtest` and `pnpm --filter @boom-busters/web typecheck`

- [ ] **Step 5: Commit** — `git commit -m "feat(web): dossier back-test harness and report"`

---

### Task 14: Progress notes, e2e, and the whole-branch checks

**Files:**
- Modify: `PROGRESS.md` (a deliverables checklist for this work under the current section, decisions 306 onward: 306 cap and ranking rule, 307 grounded claims and computed confidence, 308 legal status replaces the dropped adjudicated flag, 309 no SEC index crawl and best-effort transcripts, 310 back-test targets copied from spec section 9), `docs/03-build-spec.md` section 7.1 (an amendment sentence pointing at the spec), `e2e/tests/writing-room.spec.ts` (the gate still shows Approve on the seeded fixture; add one assertion that the claim modal shows "Found in the document" for fixture claim 1)

- [ ] **Step 1: Run the full checks**

Run: `pnpm typecheck && pnpm lint && git ls-files | xargs -n 80 pnpm exec prettier --check && pnpm test`
Expected: all green. Database suites need Docker Desktop and `migrate:test`.

- [ ] **Step 2: Run the e2e suite** — `pnpm e2e` (free port 3100 first if a previous run was interrupted)

- [ ] **Step 3: Write the PROGRESS.md section and decisions; the build-spec amendment**

- [ ] **Step 4: Commit** — `git commit -m "docs(progress): dossier research from a gathered corpus (decisions 306 to 310)"`

- [ ] **Step 5: Report** what was built, what is mocked, the owner's two decisions (switching `YOUTUBE_TRANSCRIPTS` on; running `live:dossier-backtest` with a cap), and the deploy steps (migration 0034, Vercel deploy, `PUT /api/inngest`).
