# Social Post Shots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `social` slot type that puts one real X post on screen as a card in the channel's own type, sized so it never clips in 16:9 or 9:16, with every word, name, handle and date read from X's public reader or typed by the owner.

**Architecture:** The shot-list model cites a claim NUMBER whose source is an X post, exactly as a headline cites a news claim. `resolvePlannedBrief` maps it to the claim and copies the post address onto the brief. Resolution reads the post once through X's oEmbed endpoint into a global `social_posts` table. One pure layout module (`lib/social.ts`) picks the card width and text size; one pure React component (`SocialPostCard`) draws the card; the Remotion wrapper animates it and the board draws the same component at rest. Assembly embeds every string and the two image references in the timeline payload.

**Tech Stack:** pnpm monorepo; Next.js App Router server actions ('use server' exports only async functions); Zod 4; Drizzle + Postgres (test DB in Docker on 5433, Docker Desktop must be running); Inngest 4; Remotion 4.0.512; vitest; Playwright in mock-provider mode; `node-html-parser` (already a providers dependency).

**Spec:** `docs/superpowers/specs/2026-09-29-social-post-shots-design.md`

## Global Constraints

- No em or en dashes in code, comments, docs or copy; write "2019 to 2024" for ranges. South African English spelling.
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck` before each commit; CI green on every commit.
- Typecheck runs after the last test file of a task is written: vitest does not typecheck.
- 'use server' modules export only async functions (an exported const 500s every action in the segment).
- No real provider calls in tests; `MOCK_PROVIDERS=1` everywhere; the X reader takes an injected `fetchImpl`.
- One database test suite at a time; Bash `timeout` 600000 for any suite run.
- A task that changes a shared schema or prompt runs every consuming package's suite (schemas, providers, db, timeline, compositions, web, infra), not only its own.
- `packages/compositions` and `packages/schemas/src/timeline.ts` changes reach a render only after `deploy:remotion` and `deploy:stacks boom-busters-broker`; production deploys are the owner's to run.
- Work on branch `social-posts` (it holds the spec commit).
- Decision number 284 in every commit subject.

## Rulings on the spec (recorded before execution)

1. **Storage key.** The spec's key `https://x.com/<handle>/status/<id>` changes when an account is renamed and depends on handle case, so one post could get two rows. The key is `https://x.com/i/status/<id>` (a real address X redirects); the handle lives in its own column, and the card's printed source and `sourceUrl` use `https://x.com/<handle>/status/<id>` built from the record. Cost if wrong: a one-line change to the key function plus a data migration.
2. **Which frame decides "needs an excerpt".** `ShortVertical` draws no slot cards today, so the check runs against the frame the film's timeline renders at (the master, 1920 by 1080). The tall layout is still built and golden-tested for portrait timelines. Cost if wrong: pass a second frame to `socialSlotIssues`.
3. **The 280-character size.** Worked through the numbers in Task 4, a 280-character post of ordinary words lands at 40 px in 16:9, not the spec's estimated 42 to 48. The test pins 37 to 48 px. Cost if wrong: raise `MAX_HEIGHT_FRACTION`.
4. **Font size and the brand scale.** The card sets explicit drawn pixel sizes from its own ladder and takes only family, weight, tracking and case from the brand roles, never `sizeScale`. That is the decision 283 lesson applied by construction.
5. **"Cannot be approved"** is implemented the way headlines do it: an unready social slot resolves to `placeholder`, the board says why, and assembly skips it with the reason.

## Review Focus

1. **A post that is only media** (text empty once the trailing link is removed): the record counts the text as missing and the board says "This post has no words, only its image. Type what it says, or choose another shot." Test in Task 7.
2. **Emoji, CJK and other wide characters**: a post in Japanese or full of emoji must not be under-measured (a CJK glyph is about 1 em, not 0.56). Test in Task 4.
3. **One unbroken long token** (a 70-character URL): CSS breaks it anywhere, so the estimate must count the extra lines too. Test in Task 4, and the card sets `overflow-wrap: anywhere`.
4. **Handle case and renames**: `twitter.com/emostaque/status/1` and `x.com/EMostaque/status/1/photo/1` are one row, and a cast member whose handle is stored lower case still matches `@EMostaque`. Tests in Tasks 1 and 6.
5. **The owner edits the post text after choosing an excerpt**, so the excerpt is no longer word for word: the slot goes back to placeholder with "The excerpt must be copied word for word from the post.", and assembly skips it rather than rendering a misquote. Test in Task 9.

---

### Task 1: Social post schemas

**Files:**
- Create: `packages/schemas/src/social.ts`
- Modify: `packages/schemas/src/index.ts` (export `./social`)
- Test: `packages/schemas/src/social.test.ts`

**Interfaces (produces):**

```ts
export const SOCIAL_PLATFORMS = ['x'] as const
export const POST_FIELDS = ['authorName', 'handle', 'text', 'postedAt'] as const
export type PostField = (typeof POST_FIELDS)[number]
export const POST_PROVENANCES = ['oembed', 'manual'] as const
export const POST_STATUSES = ['fetched', 'manual', 'failed'] as const

export const SocialPostRecordSchema = z.object({
  /** `https://x.com/i/status/<id>`: the primary key (ruling 1). */
  url: z.string().min(1),
  platform: z.enum(SOCIAL_PLATFORMS),
  postId: z.string().regex(/^\d{1,20}$/),
  /** As X shows it, case kept, no `@`. From the address until the reader says otherwise. */
  handle: z.string().regex(/^[A-Za-z0-9_]{1,15}$/).nullable(),
  authorName: z.string().trim().min(1).max(120).nullable(),
  /** Verbatim. Never truncated: an excerpt is a separate, visible choice. */
  text: z.string().min(1).max(25000).nullable(),
  postedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  endedWithMediaLink: z.boolean(),
  provenance: z.partialRecord(z.enum(POST_FIELDS), z.enum(POST_PROVENANCES)).default({}),
  status: z.enum(POST_STATUSES),
  failureReason: z.string().trim().min(1).max(400).nullable(),
})
export type SocialPostRecord = z.infer<typeof SocialPostRecordSchema>

/** The post id and, when the address carries one, the handle. Null for anything that is not an X status address. */
export function parsePostUrl(raw: string): { postId: string; handle: string | null } | null
/** `https://x.com/i/status/<id>` or null. */
export function normalisePostUrl(raw: string): string | null
/** `https://x.com/<handle>/status/<id>`, or the `/i/status/` form when the handle is unknown. */
export function postPublicUrl(record: Pick<SocialPostRecord, 'handle' | 'postId'>): string
/** In the card's words: 'the name', 'the handle', 'the text', 'the date'. */
export function missingPostFields(record: Pick<SocialPostRecord, 'authorName' | 'handle' | 'text' | 'postedAt'>): string[]
export function postIsRenderable(record: SocialPostRecord): boolean
/** True when the claim's sourceUrl is an X post address, whatever its sourceType. */
export function claimCarriesPost(claim: { sourceUrl?: string | null } | undefined): boolean
/** First letters of the first two words, upper case, at most 3 characters; '?' for an empty name. */
export function postInitials(name: string): string
/**
 * Where a word-for-word excerpt sits in the text, whitespace collapsed.
 * Null when the excerpt is not in the text.
 */
export function excerptPlacement(text: string, excerpt: string): { cutBefore: boolean; cutAfter: boolean } | null
/** Whitespace-collapsed substring test, the rule `emphasisFits` uses. */
export function phraseIn(text: string, phrase: string): boolean

export const NOT_A_POST_ERROR =
  'That is not a link to a post. Paste the address of the post itself (x.com/…/status/…).'
export const POST_MEDIA_ONLY_REASON =
  'This post has no words, only its image. Type what it says, or choose another shot.'
```

`parsePostUrl` accepts hosts `x.com`, `twitter.com`, `mobile.twitter.com`, `mobile.x.com` with or without `www.`; paths `/<handle>/status/<id>`, the same followed by `/photo/<n>` or `/video/<n>`, `/i/web/status/<id>` and `/i/status/<id>`; any query and fragment. The handle matches `^[A-Za-z0-9_]{1,15}$` and is not `i`. Everything else is null.

- [ ] **Step 1: Failing tests.**
  - `normalisePostUrl` folds `https://twitter.com/emostaque/status/1771400218170519741`, `https://x.com/EMostaque/status/1771400218170519741/photo/1?s=20`, `https://mobile.twitter.com/EMostaque/status/1771400218170519741#m` and `https://x.com/i/web/status/1771400218170519741` to `https://x.com/i/status/1771400218170519741`.
  - It returns null for `https://x.com/EMostaque`, `https://x.com/search?q=stability`, `https://x.com/i/lists/123`, `https://semafor.com/status/1`, `mailto:a@b.c`, and `not a url`.
  - `parsePostUrl` keeps the handle's case (`EMostaque`) and gives null for `/i/web/status/`.
  - `postPublicUrl({ handle: 'EMostaque', postId: '1' })` is `https://x.com/EMostaque/status/1`; with a null handle it is `https://x.com/i/status/1`.
  - `missingPostFields` names each missing field in order; `postIsRenderable` needs all four.
  - `claimCarriesPost` is true for `{ sourceUrl: 'https://twitter.com/a/status/9' }` and false for an article URL, a profile URL, null and undefined.
  - `postInitials('Emad Mostaque')` is `EM`, `postInitials('jack')` is `J`, `postInitials('')` is `?`.
  - `excerptPlacement(text, middle)` gives both cuts true; the opening words give `cutBefore: false`; a paraphrase gives null; a double space and a newline in the text still match a single-spaced excerpt.
- [ ] **Step 2: Run, fail.** `pnpm --filter @boom-busters/schemas exec vitest run src/social.test.ts`
- [ ] **Step 3: Implement.** Keep a private `collapse` (`text.replace(/\s+/g, ' ').trim()`), as `article.ts` does.
- [ ] **Step 4: Run, pass.**
- [ ] **Step 5: Commit** `feat(schemas): social post records and X post addresses (decision 284)`

---

### Task 2: The social brief

**Files:**
- Modify: `packages/schemas/src/visuals.ts`
- Test: `packages/schemas/src/visuals.test.ts`

**Interfaces (produces):**

```ts
export const SHOT_SLOT_TYPES = [..., 'graphic', 'social', 'hero'] as const   // 'social' before 'hero'
export const SocialBriefSchema = z.object({
  type: z.literal('social'),
  ...briefCommon,
  /** The claim the post supports: the audit trail. */
  sourceClaimId: UlidSchema,
  /** `normalisePostUrl` form. Filled from the claim; the owner may point it elsewhere. */
  postUrl: z.string().min(1),
  emphasis: z.string().trim().min(1).max(120).optional(),
  excerpt: z.string().trim().min(1).max(2000).optional(),
  avatarAssetId: UlidSchema.optional(),
  mediaAssetId: UlidSchema.optional(),
})
export type SocialBrief = z.infer<typeof SocialBriefSchema>
export const PlannedSocialBriefSchema = SocialBriefSchema
  .omit({ sourceClaimId: true, postUrl: true, emphasis: true, excerpt: true, avatarAssetId: true, mediaAssetId: true })
  .extend({ sourceRef: z.number().int().min(1) })
```

Add `SocialBriefSchema` to `ShotBriefSchema`'s union and `PlannedSocialBriefSchema` to the planned union. `resolvePlannedBrief` for `social`: the claim at `sourceRef` must pass `claimCarriesPost`; `postUrl` is `normalisePostUrl(claim.sourceUrl)`. `plannedBriefRejection` returns `"claim N has no X post behind it"` or the out-of-range message the headline branch uses. `convertBrief(anything, 'social')` returns null unless `options.socialClaim` (`{ id: string; sourceUrl: string }`) is given, in which case it builds the brief from it; `convertBrief(social, other)` goes through `description` like every text type.

- [ ] **Step 1: Failing tests.** A social brief parses; one without `postUrl` does not. `resolvePlannedBrief` maps `sourceRef: 2` to the second claim and copies its post address in the normalised form; returns null for an article claim and for an out-of-range number, and `plannedBriefRejection` names which. `convertBrief(stock, 'social')` is null; `convertBrief(stock, 'social', { socialClaim })` carries `sourceClaimId` and `postUrl`; `convertBrief(social, 'stock')` seeds the query from the description.
- [ ] **Step 2: Run, fail. Step 3: Implement.** Every exhaustive `switch` on `ShotBrief['type']` in the repo gains a `social` case; typecheck finds them. **Step 4: Run, pass** (schemas, providers and web suites).
- [ ] **Step 5: Commit** `feat(schemas): the social shot brief cites an X post claim (decision 284)`

---

### Task 3: The timeline payload

**Files:**
- Modify: `packages/schemas/src/timeline.ts`
- Test: `packages/schemas/src/timeline.test.ts`

**Interfaces (produces):**

```ts
export const SocialPayloadSchema = z.object({
  kind: z.literal('social'),
  platform: z.literal('x'),
  authorName: z.string().min(1),
  handle: z.string().min(1),
  /** The text as shown: the excerpt when there is one, no ellipses (the card adds them). */
  text: z.string().min(1),
  cutBefore: z.boolean(),
  cutAfter: z.boolean(),
  postedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a YYYY-MM-DD date'),
  emphasis: z.string().min(1).optional(),
  avatar: MediaRefSchema.optional(),
  initials: z.string().min(1).max(3),
  media: MediaRefSchema.optional(),
  sourceLabel: z.string().min(1),
  sourceUrl: z.string().min(1),
  claimId: UlidSchema,
})
export type SocialPayload = z.infer<typeof SocialPayloadSchema>
// SlotPayloadSchema gains SocialPayloadSchema
// TIMELINE_SLOT_TYPES gains 'social'; SLOT_PAYLOAD_KINDS.social = ['social']
```

`canonicalTimelineIssues` reports `slots.N.payload.avatar.url` and `slots.N.payload.media.url` when present, as it does for `src.url`.

- [ ] **Step 1: Failing tests.** A social slot parses; a `still` slot carrying a social payload fails the `superRefine`; a non-date `postedAt` fails; a canonical timeline with `avatar.url` set reports that path.
- [ ] **Step 2: Run, fail. Step 3: Implement. Step 4: Run, pass** (schemas, timeline, compositions, infra, web).
- [ ] **Step 5: Commit** `feat(schemas): the social timeline payload (decision 284)`

---

### Task 4: The layout module

**Files:**
- Create: `packages/compositions/src/lib/social.ts`
- Modify: `packages/compositions/package.json` (`"./social": "./src/lib/social.ts"` in `exports`)
- Test: `packages/compositions/src/lib/social.test.ts`

**Interfaces (consumes):** `glyphAdvanceEm`, `safeArea`, `GraphicFrame` from `./graphic` (decision 283); `frameScale` from `../components/brand`; `phraseIn`, `excerptPlacement`, `missingPostFields`, `postInitials`, `postPublicUrl`, `POST_MEDIA_ONLY_REASON`, `articleSourceLabel` from `@boom-busters/schemas`.

**Interfaces (produces):** everything exported below. Tasks 5, 9 and 11 call `socialLayout`, `socialDisplayText`, `postSegments`, `socialSlotIssues`, `suggestExcerpt` and `buildSocialPayload`.

- [ ] **Step 1: Failing tests** (`social.test.ts`, brand `resolveBrandKit(DEFAULT_SETTINGS)`, `WIDE = { width: 1920, height: 1080 }`, `TALL = { width: 1080, height: 1920 }`):
  - `socialLayout({ text: 'just setting up my twttr', hasMedia: false, frame: WIDE, brand }).textPx` is 60 and `fits` is true.
  - A 280-character post of ordinary English words (use Emad's resignation text from the spec plus one sentence) gives a `textPx` between 37 and 48 in WIDE, and `fits`.
  - A 1,000-character post gives `fits: false` in WIDE; `needsExcerpt(text, false, brand, WIDE)` is true.
  - The same 280-character post with `hasMedia: true` gets a `textPx` no larger than without.
  - For every ladder step and both frames, `estimatedHeight <= card.maxHeight` whenever `fits` is true.
  - TALL: `card.width` is `1080 * 0.88`, `band.top` is at least `1920 * 0.1`, and the band's bottom is `safeArea(TALL)`'s bottom.
  - Review Focus 2: `wordWidthPx('日本語のテキスト', 40, brand.typography.body)` is at least `8 * 40`; an emoji-only word counts 1 em a glyph.
  - Review Focus 3: `estimateLines('x'.repeat(70), 40, 300, body)` is at least `Math.ceil(70 * 0.56 * 40 / 300)`.
  - `estimateLines('a\n\nb', 40, 900, body)` is 3 (a blank line is a line).
  - `socialDisplayText('words', true, true)` is `'… words …'`.
  - `postSegments('Hi @StabilityAI see https://t.co/x #ai', undefined)` marks `@StabilityAI`, `https://t.co/x` and `#ai` as `entity`; `postSegments('We have $101m in cash', '$101m')` marks exactly `$101m` as `emphasised`; an emphasis split across a newline in the text still marks the words.
  - `suggestExcerpt` on a five-paragraph post with the emphasis in paragraph three returns a slice of the original text that contains paragraph three and passes the `fits` callback; with no emphasis it starts at paragraph one; when one sentence alone never fits it returns null.
  - `socialSlotIssues` returns `[]` for a complete short post; the missing-fields sentence for a record lacking its date; `POST_MEDIA_ONLY_REASON` for a null text with `endedWithMediaLink`; the too-long sentence for a long post with no excerpt; the word-for-word sentence for a paraphrased excerpt; the highlight sentence for an emphasis outside the excerpt; `'Still too long for the card.'` for a verbatim excerpt that does not fit.
  - `buildSocialPayload` returns null for an unready post, and otherwise a payload that parses with `SocialPayloadSchema`, whose `sourceLabel` is `articleSourceLabel(postPublicUrl(post))` and whose `initials` come from the name.
- [ ] **Step 2: Run, fail.** `pnpm --filter @boom-busters/compositions exec vitest run src/lib/social.test.ts`
- [ ] **Step 3: Implement** exactly this module:

```ts
import type { BrandKitTokens, MediaRef, SocialPayload, SocialPostRecord, TypeRole } from '@boom-busters/schemas'
import {
  POST_MEDIA_ONLY_REASON,
  articleSourceLabel,
  excerptPlacement,
  missingPostFields,
  phraseIn,
  postInitials,
  postPublicUrl,
} from '@boom-busters/schemas'
import { frameScale } from '../components/brand'
import { glyphAdvanceEm, safeArea, type GraphicFrame } from './graphic'

/**
 * The social post card's geometry (decision 284), pure and unit-tested. The
 * Remotion card and the board's resting card both draw from this, and both
 * let CSS do the wrapping with the same fonts, so the only estimate here is
 * the one that picks the text size. The card's height follows its content:
 * a line more than estimated grows the card, and the 10 per cent held back
 * by MAX_HEIGHT_FRACTION keeps even that inside the safe area.
 *
 * Sizes are DRAWN pixels. The brand's roles give the family, weight,
 * tracking and case; their `sizeScale` is not applied on top (decision 283).
 */

export const SOCIAL_LINE_HEIGHT = 1.3
/** At 1080p, largest first, about 10 per cent a step. */
const LADDER_WIDE = [60, 54, 48, 44, 40, 37, 34] as const
const LADDER_TALL = [64, 58, 52, 47, 43, 39, 36] as const
const CARD_WIDTH_FRACTION = { wide: 0.52, tall: 0.88 } as const
const PADDING_PX = { wide: 48, tall: 44 } as const
const MEDIA_MAX_PX = { wide: 260, tall: 380 } as const
/** The Shorts player's own top bar, which nothing should sit under. */
const SHORTS_TOP_FRACTION = 0.1
const MAX_HEIGHT_FRACTION = 0.9
const AVATAR_PX = 88
const NAME_PX = 34
const META_PX = 26
const SOURCE_PX = 22
const HEADER_GAP_PX = 28
const MEDIA_GAP_PX = 24
const SOURCE_GAP_PX = 24
/** Glyphs a proportional estimate under-reads: CJK, Hangul, full-width forms and emoji, about 1 em each. */
const WIDE_CHARACTER =
  /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|\p{Extended_Pictographic}/u
const ENTITY = /(@\w{1,15}|#\w+|https?:\/\/\S+)/g

export interface SocialLayout {
  portrait: boolean
  /** The vertical band the card is centred in: below the Shorts bar, above the captions. */
  band: { top: number; height: number }
  card: { width: number; maxHeight: number; padding: number }
  avatarPx: number
  namePx: number
  metaPx: number
  sourcePx: number
  textPx: number
  mediaMaxPx: number
  headerGapPx: number
  mediaGapPx: number
  sourceGapPx: number
  estimatedHeight: number
  /** False when even the smallest size overflows `card.maxHeight`: the post needs an excerpt. */
  fits: boolean
}

function advanceEm(char: string, type: TypeRole): number {
  return WIDE_CHARACTER.test(char) ? 1 : glyphAdvanceEm(type)
}

export function wordWidthPx(word: string, px: number, type: TypeRole): number {
  let em = 0
  for (const char of word) em += advanceEm(char, type)
  return em * px
}

/** Lines the text wraps to, word by word, keeping its own line breaks; a word wider than the line breaks anywhere. */
export function estimateLines(text: string, px: number, widthPx: number, type: TypeRole): number {
  const space = glyphAdvanceEm(type) * px
  let lines = 0
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter((word) => word !== '')
    if (words.length === 0) {
      lines += 1
      continue
    }
    let line = 0
    for (const word of words) {
      const width = wordWidthPx(word, px, type)
      if (width > widthPx) {
        if (line > 0) lines += 1
        const whole = Math.floor(width / widthPx)
        lines += whole
        line = width - whole * widthPx
        continue
      }
      if (line === 0) line = width
      else if (line + space + width <= widthPx) line += space + width
      else {
        lines += 1
        line = width
      }
    }
    lines += 1
  }
  return lines
}

/** The words as the card prints them, with an ellipsis at each cut. */
export function socialDisplayText(text: string, cutBefore: boolean, cutAfter: boolean): string {
  return `${cutBefore ? '… ' : ''}${text}${cutAfter ? ' …' : ''}`
}

export function socialLayout(input: {
  text: string
  hasMedia: boolean
  frame: GraphicFrame
  brand: BrandKitTokens
}): SocialLayout {
  const { frame, brand } = input
  const portrait = frame.height > frame.width
  const scale = frameScale(frame.width, frame.height)
  const safe = safeArea(frame)
  const top = portrait ? Math.max(safe.y, frame.height * SHORTS_TOP_FRACTION) : safe.y
  const bandHeight = safe.y + safe.h - top
  const width = frame.width * (portrait ? CARD_WIDTH_FRACTION.tall : CARD_WIDTH_FRACTION.wide)
  const padding = (portrait ? PADDING_PX.tall : PADDING_PX.wide) * scale
  const inner = width - padding * 2
  const maxHeight = bandHeight * MAX_HEIGHT_FRACTION
  const mediaMaxPx = input.hasMedia ? (portrait ? MEDIA_MAX_PX.tall : MEDIA_MAX_PX.wide) * scale : 0
  const avatarPx = AVATAR_PX * scale
  const sourcePx = SOURCE_PX * scale
  const headerGapPx = HEADER_GAP_PX * scale
  const mediaGapPx = MEDIA_GAP_PX * scale
  const sourceGapPx = SOURCE_GAP_PX * scale
  const fixed =
    padding * 2 +
    avatarPx +
    headerGapPx +
    (input.hasMedia ? mediaGapPx + mediaMaxPx : 0) +
    sourceGapPx +
    sourcePx * SOCIAL_LINE_HEIGHT
  const type = brand.typography.body
  const heightAt = (px: number) =>
    fixed + estimateLines(input.text, px, inner, type) * px * SOCIAL_LINE_HEIGHT

  const ladder = (portrait ? LADDER_TALL : LADDER_WIDE).map((px) => px * scale)
  const chosen = ladder.find((px) => heightAt(px) <= maxHeight)
  const textPx = chosen ?? ladder[ladder.length - 1]!
  return {
    portrait,
    band: { top, height: bandHeight },
    card: { width, maxHeight, padding },
    avatarPx,
    namePx: NAME_PX * scale,
    metaPx: META_PX * scale,
    sourcePx,
    textPx,
    mediaMaxPx,
    headerGapPx,
    mediaGapPx,
    sourceGapPx,
    estimatedHeight: heightAt(textPx),
    fits: chosen !== undefined,
  }
}

export function needsExcerpt(
  text: string,
  hasMedia: boolean,
  brand: BrandKitTokens,
  frame: GraphicFrame,
): boolean {
  return !socialLayout({ text, hasMedia, frame, brand }).fits
}

export interface PostSegment {
  text: string
  /** A mention, hashtag or link: drawn in the accent colour. */
  entity: boolean
  /** Inside the highlight phrase: drawn under the marker. */
  emphasised: boolean
}

function tokenise(text: string, emphasised: boolean): PostSegment[] {
  return text
    .split(ENTITY)
    .filter((part) => part !== '')
    .map((part) => ({ text: part, entity: new RegExp(`^${ENTITY.source}$`).test(part), emphasised }))
}

/** The display text cut into runs the card colours and marks. Whitespace inside the phrase may differ from the text's. */
export function postSegments(display: string, emphasis: string | undefined): PostSegment[] {
  const words = emphasis?.trim().split(/\s+/).filter((word) => word !== '') ?? []
  if (words.length === 0) return tokenise(display, false)
  const pattern = new RegExp(words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'))
  const hit = pattern.exec(display)
  if (!hit) return tokenise(display, false)
  return [
    ...tokenise(display.slice(0, hit.index), false),
    ...tokenise(hit[0], true),
    ...tokenise(display.slice(hit.index + hit[0].length), false),
  ]
}

function spans(text: string, pattern: RegExp, from = 0, to = text.length): { start: number; end: number }[] {
  const found: { start: number; end: number }[] = []
  const region = text.slice(from, to)
  for (const match of region.matchAll(pattern)) {
    if (match[0].trim() === '') continue
    found.push({ start: from + (match.index ?? 0), end: from + (match.index ?? 0) + match[0].length })
  }
  return found
}

function grow(
  text: string,
  units: { start: number; end: number }[],
  anchor: number,
  fits: (candidate: string) => boolean,
): string | null {
  if (units.length === 0) return null
  let first = anchor
  let last = anchor
  const slice = (a: number, b: number) => text.slice(units[a]!.start, units[b]!.end).trim()
  if (!fits(slice(first, last))) return null
  while (last + 1 < units.length && fits(slice(first, last + 1))) last += 1
  while (first > 0 && fits(slice(first - 1, last))) first -= 1
  return slice(first, last)
}

/**
 * A word-for-word excerpt to offer the owner: the paragraph holding the
 * highlight (or the first), grown a paragraph at a time while it fits; a
 * paragraph too long on its own falls back to its sentences. Null when not
 * even one sentence fits, and the owner types the cut.
 */
export function suggestExcerpt(
  text: string,
  emphasis: string | undefined,
  fits: (candidate: string) => boolean,
): string | null {
  const paragraphs = spans(text, /[^\n]+/g)
  const at = (units: { start: number; end: number }[]) => {
    if (emphasis === undefined) return 0
    const index = units.findIndex((unit) => phraseIn(text.slice(unit.start, unit.end), emphasis))
    return Math.max(0, index)
  }
  const byParagraph = grow(text, paragraphs, at(paragraphs), fits)
  if (byParagraph !== null) return byParagraph
  const host = paragraphs[at(paragraphs)]
  if (!host) return null
  const sentences = spans(text, /[^.!?]+[.!?]*\s*/g, host.start, host.end)
  return grow(text, sentences, at(sentences), fits)
}

export const SOCIAL_MISSING_PREFIX = 'A post card needs the name, the handle, the text and the date. Missing: '
export const SOCIAL_TOO_LONG = 'This post is too long to show in full. Choose the part to show.'
export const SOCIAL_EXCERPT_NOT_VERBATIM = 'The excerpt must be copied word for word from the post.'
export const SOCIAL_EXCERPT_TOO_LONG = 'Still too long for the card.'
export const SOCIAL_HIGHLIGHT_OUTSIDE = 'The highlight must be words from the part of the post on screen.'

/** Why this slot cannot show yet, in the board's words; empty when it can. The one rule resolution, the board and assembly share. */
export function socialSlotIssues(input: {
  post: SocialPostRecord | null
  excerpt?: string
  emphasis?: string
  hasMedia: boolean
  frame: GraphicFrame
  brand: BrandKitTokens
}): string[] {
  const { post } = input
  if (!post) return [`${SOCIAL_MISSING_PREFIX}the post itself.`]
  if (post.text === null && post.endedWithMediaLink) return [POST_MEDIA_ONLY_REASON]
  const missing = missingPostFields(post)
  if (missing.length > 0) return [`${SOCIAL_MISSING_PREFIX}${missing.join(', ')}.`]
  const text = post.text as string
  const issues: string[] = []
  let shown = text
  let cuts = { cutBefore: false, cutAfter: false }
  if (input.excerpt !== undefined) {
    const placement = excerptPlacement(text, input.excerpt)
    if (!placement) return [SOCIAL_EXCERPT_NOT_VERBATIM]
    shown = input.excerpt
    cuts = placement
  }
  const display = socialDisplayText(shown, cuts.cutBefore, cuts.cutAfter)
  if (needsExcerpt(display, input.hasMedia, input.brand, input.frame)) {
    issues.push(input.excerpt === undefined ? SOCIAL_TOO_LONG : SOCIAL_EXCERPT_TOO_LONG)
  }
  if (input.emphasis !== undefined && !phraseIn(shown, input.emphasis)) issues.push(SOCIAL_HIGHLIGHT_OUTSIDE)
  return issues
}

/** The timeline payload for a ready slot; null when `socialSlotIssues` would name anything. */
export function buildSocialPayload(input: {
  post: SocialPostRecord
  excerpt?: string
  emphasis?: string
  avatar?: MediaRef
  media?: MediaRef
  claimId: string
  frame: GraphicFrame
  brand: BrandKitTokens
}): SocialPayload | null {
  const issues = socialSlotIssues({ ...input, hasMedia: input.media !== undefined })
  if (issues.length > 0) return null
  const { post } = input
  const placement =
    input.excerpt !== undefined ? excerptPlacement(post.text as string, input.excerpt) : null
  const publicUrl = postPublicUrl(post)
  return {
    kind: 'social',
    platform: 'x',
    authorName: post.authorName as string,
    handle: post.handle as string,
    text: input.excerpt ?? (post.text as string),
    cutBefore: placement?.cutBefore ?? false,
    cutAfter: placement?.cutAfter ?? false,
    postedAt: post.postedAt as string,
    ...(input.emphasis !== undefined ? { emphasis: input.emphasis } : {}),
    ...(input.avatar ? { avatar: input.avatar } : {}),
    initials: postInitials(post.authorName as string),
    ...(input.media ? { media: input.media } : {}),
    sourceLabel: articleSourceLabel(publicUrl),
    sourceUrl: publicUrl,
    claimId: input.claimId,
  }
}
```

  If a test on an exact size fails by one ladder step, fix the test's arithmetic, not the constants: the constants are the spec's.
- [ ] **Step 4: Run, pass.** Then run the whole compositions suite.
- [ ] **Step 5: Commit** `feat(compositions): social card layout, size ladder and excerpt rule (decision 284)`

---

### Task 5: The card, its Remotion wrapper and the snapshots

**Files:**
- Create: `packages/compositions/src/components/SocialPostCard.tsx` (pure, no Remotion import)
- Create: `packages/compositions/src/components/SocialPost.tsx` (Remotion wrapper)
- Modify: `packages/compositions/src/lib/social.ts` (add `socialProgress` and `RESTING_SOCIAL_PROGRESS`)
- Modify: `packages/compositions/src/components/DocumentaryMaster.tsx` (slot switch)
- Modify: `packages/compositions/src/Root.tsx` (fixture payload, `SocialPostWide`, `SocialPostTall`)
- Modify: `packages/compositions/src/snapshot/render.test.ts` (two entries, `frame: 45`, `maxDiffRatio: 0.06`)
- Modify: `packages/compositions/package.json` (`./social-card` export pointing at `SocialPostCard.tsx`)
- Create: `packages/compositions/src/snapshot/golden/SocialPostWide.png`, `SocialPostTall.png`
- Test: `packages/compositions/src/lib/social.test.ts` (progress), `packages/compositions/src/components/SocialPostCard.test.tsx`

**Interfaces (produces):**

```ts
export interface SocialProgress { settle: number; sweep: number; drift: number }
export const RESTING_SOCIAL_PROGRESS: SocialProgress = { settle: 1, sweep: 1, drift: 1 }
/** settle over 420 ms from 0; sweep over 520 ms from 700 ms; drift is graphicDrift(frame, durationInFrames). */
export function socialProgress(frame: number, fps: number, durationInFrames: number): SocialProgress

export function SocialPostCard(props: {
  payload: SocialPayload
  brand: BrandKitTokens
  frame: { width: number; height: number }
  progress: SocialProgress
  /** Remotion's <Img> in the render, so a frame waits for the picture; a plain <img> on the board. */
  ImageComponent?: React.ComponentType<React.ImgHTMLAttributes<HTMLImageElement>> | 'img'
}): JSX.Element

export function SocialPost(props: { payload: SocialPayload; brand: BrandKitTokens; durationInFrames?: number }): JSX.Element
```

The card, per spec 5.2: an absolute full-frame ground (`colors.background` with the radial `colors.surface` gradient the other cards use); a flex column over `layout.band` centring a card `layout.card.width` wide with `maxHeight` unset (content decides), `colors.surface` fill, 20 px radius scaled, padding from the layout. Header row: avatar circle `avatarPx` (the image `object-fit: cover`, or `initials` on an accent-tinted disc in `colors.accent`), name (`typography.heading` family and weight, `namePx`, `colors.textPrimary`), meta line `@handle · 23 March 2024` (`formatPublished`, `typography.body`, `metaPx`, `colors.textSecondary`), and the X mark top right as an inline SVG, `viewBox="0 0 24 24"`, path `M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z`, fill `colors.textSecondary`, `namePx` square. Text: `postSegments(socialDisplayText(...), emphasis)` rendered with `white-space: pre-wrap`, `overflow-wrap: anywhere`, `dir="auto"`, `lineHeight: SOCIAL_LINE_HEIGHT`, `fontSize: textPx`, `typography.body` family, weight, tracking and case; entity runs in `colors.accent`; emphasised runs wrapped in `markerSweep(colors.accent, progress.sweep)`. Media: full inner width, `maxHeight: mediaMaxPx`, `object-fit: cover`, radius 12 px scaled. Source line: `sourceLabel` in `typography.captions`, `sourcePx`, `colors.textSecondary`. Motion: the card's transform is `translateY((1 - settle) * 26 * scale px) scale(drift * (0.985 + 0.015 * settle))`, opacity `settle`. Every size comes from `socialLayout`; the component computes nothing of its own.

`SocialPost` reads `useCurrentFrame`/`useVideoConfig`, calls `socialProgress`, and renders `SocialPostCard` with `ImageComponent={Img}`. `DocumentaryMaster` renders `<SocialPost payload={slot.payload} brand={brand} durationInFrames={durationInFrames} />` for `kind === 'social'`.

Root fixture: an invented account, not a real person (`authorName: 'Dana Okafor'`, `handle: 'danaokafor'`, `postedAt: '2023-03-14'`, a 230-character text with one mention and one figure, `emphasis` on the figure, no avatar so the initials draw, no media).

- [ ] **Step 1: Failing tests.** `socialProgress(0, 30, 180)` settle 0; at frame 30 settle 1, sweep partial; at the last frame settle, sweep 1 and drift `graphicDrift(179, 180)`. `SocialPostCard.test.tsx` (react-dom/server `renderToStaticMarkup`): renders the name, `@danaokafor · 14 March 2023`, the initials when there is no avatar, an `<img>` when there is one, the ellipsis at a cut, the entity colour on the mention, and the same markup for the same props twice (no randomness).
- [ ] **Step 2: Run, fail. Step 3: Implement,** then `REGEN_GOLDEN=1 pnpm --filter @boom-busters/compositions exec vitest run src/snapshot/render.test.ts` and confirm with `git status` that only the two new goldens were written. **Step 4: Run, pass:** the compositions suite alone, twice (snapshots flake under a full run; never regenerate from one).
- [ ] **Step 5: Commit** `feat(compositions): the social post card and its render (decision 284)`

---

### Task 6: Database

**Files:**
- Modify: `packages/db/src/schema.ts` (`shotTypeEnum` + `'social'`; `socialPostStatusEnum`; `socialPosts` table; `castMembers.xHandle`)
- Create: `packages/db/src/social-posts.ts`
- Modify: `packages/db/src/cast.ts` (map `xHandle`; `setCastXHandle`, `castMemberByXHandle`)
- Modify: `packages/schemas/src/cast.ts` (`xHandle: z.string().regex(/^[a-z0-9_]{1,15}$/).nullable().optional()`)
- Modify: `packages/db/src/index.ts`
- Generate: `packages/db/drizzle/0029_*.sql`
- Test: `packages/db/src/social-posts.integration.test.ts`, `packages/db/src/cast.integration.test.ts`

**Interfaces (produces):**

```ts
export async function getSocialPost(db: Database, url: string): Promise<SocialPostRecord | null>
export async function getSocialPosts(db: Database, urls: readonly string[]): Promise<SocialPostRecord[]>
/** A reader result (fetched or failed). Fields whose provenance is 'manual' are kept as they are. */
export async function recordSocialPost(db: Database, record: SocialPostRecord): Promise<SocialPostRecord>
/** The owner's corrections: provenance 'manual' on each field written; status 'manual'. */
export async function setSocialPostManual(
  db: Database,
  url: string,
  fields: Partial<Pick<SocialPostRecord, 'authorName' | 'handle' | 'text' | 'postedAt'>>,
): Promise<SocialPostRecord>
/** Stored lower case without '@'; null clears it. */
export async function setCastXHandle(db: Database, castMemberId: string, handle: string | null): Promise<void>
/** Case-insensitive, within one project, dismissed members excluded. */
export async function castMemberByXHandle(db: Database, projectId: string, handle: string): Promise<CastMember | null>
```

Columns per spec 7.2 (`url` primary key, `platform`, `post_id`, `handle`, `author_name`, `text`, `posted_at` as text `YYYY-MM-DD`, `ended_with_media_link`, `provenance` jsonb, `status`, `failure_reason`, `fetched_at`, `updated_at`), and `cast_members.x_handle` text nullable.

- [ ] **Step 1: Failing tests.** Record then read back; record twice updates `fetched_at`; after `setSocialPostManual(url, { text })` a later `recordSocialPost` with different text keeps the owner's text and its `manual` provenance but takes the reader's date; `getSocialPosts` returns only the rows asked for. Cast: `setCastXHandle(id, '@EMostaque')` stores `emostaque`; `castMemberByXHandle(project, 'EMostaque')` finds the member (Review Focus 4); another project's member is not found.
- [ ] **Step 2: Run, fail** (Docker Desktop running; `pnpm db:migrate:test`). **Step 3: Implement,** then `pnpm --filter @boom-busters/db exec drizzle-kit generate` and read the SQL: one `ALTER TYPE shot_type ADD VALUE 'social'`, one `CREATE TYPE`, one `CREATE TABLE`, one `ALTER TABLE cast_members ADD COLUMN`. **Step 4: Run, pass** (db suite alone, then schemas and web).
- [ ] **Step 5: Commit** `feat(db): social_posts, the social shot type and a cast member's X handle (decision 284)`

---

### Task 7: The X reader

**Files:**
- Create: `packages/providers/src/social/parse.ts`, `fetch.ts`, `mock.ts`, `fixtures.ts`, `index.ts`
- Modify: `packages/providers/src/index.ts`
- Test: `packages/providers/src/social/parse.test.ts`, `fetch.test.ts`

**Interfaces (produces):**

```ts
export interface ParsedXPost {
  authorName: string | null
  handle: string | null
  text: string | null
  postedAt: string | null
  endedWithMediaLink: boolean
}
/** Pure: the oEmbed JSON in, fields out. Unknown shapes give all nulls, never a throw. */
export function parseXOembed(body: unknown): ParsedXPost
export interface SocialFetchOptions { fetchImpl?: typeof fetch; signal?: AbortSignal }
export interface SocialProvider {
  /** Throws ValidationError whose message is the owner-facing reason. */
  fetchPost(publicUrl: string, options?: SocialFetchOptions): Promise<ParsedXPost>
}
export function socialProvider(env?: Record<string, string | undefined>): SocialProvider
export const X_OEMBED_ENDPOINT = 'https://publish.x.com/oembed'
export const X_POST_MISSING = 'X says this post does not exist or is not public.'
export const X_UNREACHABLE = 'X did not answer. Try Read again, or type the details.'
```

Parsing, per spec 7.3: parse `html` with `node-html-parser`; the first `<p>`'s child nodes become the text (`<br>` to `\n`, each `<a>` to its text, entities decoded, runs of spaces kept as written, trailing whitespace trimmed); the text after the `<p>` matching `(.+) \(@([A-Za-z0-9_]{1,15})\)` gives the name and handle, and the final `<a>`'s text `Month D, YYYY` gives the date through a 12-entry month table. `author_url`'s last path segment wins for the handle. A final token `https://t.co/\S+` or `pic.twitter.com/\S+` is removed and sets `endedWithMediaLink`; a `t.co` link mid-text is kept. Empty text after removal is null.

Fetching: GET `${X_OEMBED_ENDPOINT}?url=<encoded publicUrl>&omit_script=1&dnt=true` with the user agent `article-source.ts` uses and a 10 s timeout; 404 and 403 throw `X_POST_MISSING`; 5xx and network errors retry once after 1 s and then throw `X_UNREACHABLE`; a non-JSON body throws `X_UNREACHABLE`. The mock returns a deterministic post built from the id and never calls fetch.

`fixtures.ts` holds the two responses saved on 2026-09-29 (the spec's section 4 JSON for `EMostaque/status/1771400218170519741`, and `jack/status/20`), plus three written by hand for invented accounts: a long post of five paragraphs, a post whose only content is `https://t.co/abc123`, and one ending with `pic.twitter.com/xyz`.

- [ ] **Step 1: Failing tests.** Emad's fixture parses to name `Emad`, handle `EMostaque`, date `2024-03-23`, text starting `As my notifications are RIP some notes:\n\n1. My shares`, containing `@StabilityAI` and `Stability & elsewhere`, not ending with the `t.co` link, and `endedWithMediaLink: true`. `jack/status/20` parses to `just setting up my twttr` and `2006-03-21`. The media-only fixture gives `text: null` and `endedWithMediaLink: true` (Review Focus 1). A garbage body gives all nulls. Fetch: a 200 returns parsed fields and the request URL carries `omit_script=1`; a 404 throws `X_POST_MISSING` without retrying; a 500 then 200 succeeds on the retry; two 500s throw `X_UNREACHABLE`; the mock never calls `fetchImpl`.
- [ ] **Step 2: Run, fail. Step 3: Implement. Step 4: Run, pass** (providers suite).
- [ ] **Step 5: Commit** `feat(providers): read an X post through its public oEmbed (decision 284)`

---

### Task 8: Resolution

**Files:**
- Create: `apps/web/lib/social-source.ts`
- Modify: `apps/web/lib/visual-assets.ts` (`resolveSlotBrief` case `social`)
- Test: `apps/web/lib/social-source.test.ts`, `apps/web/lib/visual-assets.test.ts`

**Interfaces (produces):**

```ts
/** Cached read-through: a stored row wins; otherwise read, store (a failure too), return. Null only for an address that is not a post. */
export async function postForUrl(rawUrl: string): Promise<SocialPostRecord | null>
/** "Read again": always reads; manual fields survive (recordSocialPost keeps them). */
export async function refetchPost(rawUrl: string): Promise<SocialPostRecord>
```

The reader is `socialProvider(process.env)`; its thrown reason becomes `status: 'failed'`, `failureReason`, with the handle and id from the address. `resolveSlotBrief` case `social`: `postForUrl(brief.postUrl)`, then `socialSlotIssues` with the project's brand tokens, the master frame `{ width: 1920, height: 1080 }` (ruling 2) and `hasMedia: brief.mediaAssetId !== undefined`; `resolved` when empty, else `placeholder`. Nothing is downloaded and no key is required.

- [ ] **Step 1: Failing tests** (mocked db and provider, the pattern `article-source.test.ts` uses). A stored row is not read again; a missing row is read and stored; a 404 stores a failed row with `X_POST_MISSING`; `refetchPost` reads even when a row exists; `resolveSlotBrief` returns `placeholder` for a failed post, a too-long post with no excerpt and a paraphrased excerpt, and `resolved` for a complete short post.
- [ ] **Step 2: Run, fail. Step 3: Implement. Step 4: Run, pass.**
- [ ] **Step 5: Commit** `feat(web): social slots resolve by reading the post (decision 284)`

---

### Task 9: Compile, assemble and materialise

**Files:**
- Modify: `packages/timeline/src/compile.ts` (`CompileSlot.type` + `'social'`, `social?: Omit<SocialPayload, 'kind'>`, payload case, `resolveMotion` static)
- Modify: `apps/web/inngest/lib/assembly.ts` (`AssemblySlotRow.type` + `'social'`; `slotPlan` input `social?: { posts: ReadonlyMap<string, SocialPostRecord>; images: ReadonlyMap<string, { r2Key: string }>; castAvatars: ReadonlyMap<string, { r2Key: string }>; brand: BrandKitTokens; frame: { width: number; height: number } }`; the social case)
- Modify: `apps/web/inngest/functions/assembly-runner.ts` (load posts by `brief.postUrl`, uploaded images by asset id, and cast avatars by lower-case handle, beside the article and logo loads)
- Modify: `apps/web/lib/materialise.ts` and `infra/lambdas/broker/core.ts` (`materialiseTimeline`: presign `avatar` and `media`)
- Test: `packages/timeline/src/compile.test.ts`, `apps/web/inngest/lib/assembly.test.ts`, `apps/web/lib/materialise.test.ts`, `infra/lambdas/broker/core.test.ts`

The social case in `slotPlan`: the post from `social.posts.get(brief.postUrl)`; the avatar is the uploaded `avatarAssetId`'s key, else `castAvatars.get(post.handle.toLowerCase())`, else none (initials); the media is `mediaAssetId`'s key or none; `buildSocialPayload({ ..., frame: social.frame, brand: social.brand })`. A null payload skips the slot with the first `socialSlotIssues` sentence as the reason. The cast avatar is the member's `referencePhotos(member, 1)[0]` key.

- [ ] **Step 1: Failing tests.** A social slot compiles to a `social` payload that parses; the golden timeline stays byte-stable for a fixture without social slots; `slotPlan` uses the uploaded avatar over the cast photo, the cast photo over initials, and skips a slot whose post is missing its date with the missing-fields sentence; Review Focus 5: a post whose text was edited after the excerpt was chosen is skipped with `SOCIAL_EXCERPT_NOT_VERBATIM`; both materialisers presign `avatar.r2Key` and `media.r2Key` and leave an `externalUrl` as it is; `canonicalTimelineIssues` is clean on the compiled canonical timeline.
- [ ] **Step 2: Run, fail. Step 3: Implement. Step 4: Run, pass** (timeline, web, infra suites).
- [ ] **Step 5: Commit** `feat: social slots reach the timeline and the render (decision 284)`

---

### Task 10: The planner learns the type

**Files:**
- Modify: `packages/providers/src/prompts/script.ts` (`claimList` marks ` (X POST)` when (brackets, not the dash the headline marker uses) `claimCarriesPost`)
- Modify: `packages/providers/src/prompts/shotlist.ts` (the social shape beside the headline shape; the rules; `socialClaimRefs?: readonly number[]` on the input; the mock planner emits one social slot on the third paragraph when `socialClaimRefs` is non-empty)
- Modify: `packages/providers/src/prompts/retype.ts` (social is not a model-drafted target, like headline)
- Modify: `apps/web/inngest/lib/direction.ts` (`socialClaimRefs` beside `newsClaimRefs`)
- Modify: `apps/web/inngest/lib/shot-list.ts` (`plannedToRows` passes claims; a social slot stores `sourceClaimId` and `postUrl`)
- Test: `packages/providers/src/prompts/script.test.ts`, `shotlist.test.ts`, `apps/web/inngest/lib/shot-list.test.ts`

The prompt rules, verbatim: "Use a social shot where the narration quotes or refers to a post on X that a claim cites. Cite the claim NUMBER marked X POST in the list above; any other claim has no post behind it. Never write the post's words, the account's name, its handle or the date: the app reads them from the post." Keep each rule's key phrase on one line of the prompt source (tests assert on whole lines).

- [ ] **Step 1: Failing tests.** `claimList` marks a claim sourced to `https://x.com/a/status/1` with `X POST` and does not mark an article claim; the system prompt contains the social shape and the three rules; `parseShotList` accepts a social slot and drops one with no `sourceRef`; `plannedToRows` stores the normalised post address and rejects a social slot citing an article claim with the rejection reason; the mock planner emits a social slot only when given `socialClaimRefs`.
- [ ] **Step 2: Run, fail. Step 3: Implement. Step 4: Run, pass** (providers, web).
- [ ] **Step 5: Commit** `feat: the shot-list model can plan a social shot (decision 284)`

---

### Task 11: Board actions

**Files:**
- Modify: `apps/web/app/(console)/projects/[id]/visuals-actions.ts`
- Test: `apps/web/app/(console)/projects/[id]/visuals-actions.test.ts`

**Interfaces (produces), all `Promise<ActionResult>` and owner-gated:**

```ts
export async function setSocialPostAction(projectId: string, slotId: string, rawUrl: string)
export async function saveSocialPostAction(projectId: string, slotId: string, fields: { authorName?: string; handle?: string; text?: string; postedAt?: string })
export async function refetchSocialPostAction(projectId: string, slotId: string)
export async function saveSocialCardAction(projectId: string, slotId: string, card: { emphasis?: string | null; excerpt?: string | null })
export async function linkCastHandleAction(projectId: string, castMemberId: string, handle: string)
export async function removeSocialImageAction(projectId: string, slotId: string, which: 'avatar' | 'media')
export async function retypeToSocialAction(projectId: string, slotId: string, claimId: string)
// createOwnUploadAction and finaliseOwnUploadAction gain `purpose?: 'shot' | 'social-avatar' | 'social-image'`
```

- `setSocialPostAction`: `normalisePostUrl` or `NOT_A_POST_ERROR`; writes `postUrl`, clears `excerpt` and `emphasis`, `updateSlotBrief`, then `sendRefetch` on the board phase (as `retypeToHeadlineAction` does).
- `saveSocialPostAction`: `postedAt` must match `YYYY-MM-DD` ("Use a date like 2024-03-23."); `handle` loses a leading `@` and must match the handle rule ("That is not an X handle."); `text` is kept verbatim; writes through `setSocialPostManual`, then `sendRefetch`.
- `saveSocialCardAction`: null clears a field; an excerpt not word for word returns `SOCIAL_EXCERPT_NOT_VERBATIM`; a highlight outside the shown text returns `SOCIAL_HIGHLIGHT_OUTSIDE`; then `sendRefetch`.
- `finaliseOwnUploadAction` with a `social-*` purpose: after the existing head and size checks, `upsertAssetByHash` (licence `Uploaded by owner`) and write `avatarAssetId` or `mediaAssetId` on the brief instead of calling `attachOwnFile`; refused unless the slot's brief is `social`.
- `retypeToSocialAction`: mirrors `retypeToHeadlineAction` with `claimCarriesPost` ("That claim has no X post behind it, so a card cannot show it.") and `convertBrief(current, 'social', { socialClaim })`.

- [ ] **Step 1: Failing tests** (refusals happen before any database read, as the headline tests do): a profile URL and plain words return `NOT_A_POST_ERROR`; `saveSocialPostAction` refuses `23 March 2024` and `@not a handle`; `saveSocialCardAction` refuses a paraphrased excerpt; `removeSocialImageAction` and `linkCastHandleAction` refuse bad ids; `retypeToSocialAction` refuses an article claim. Then add `setSocialPostAction`, `saveSocialPostAction` and `saveSocialCardAction` to the actions mock in `visual-board.test.tsx` so the board file still loads.
- [ ] **Step 2: Run, fail. Step 3: Implement. Step 4: Run, pass** (web).
- [ ] **Step 5: Commit** `feat(web): board actions for social post slots (decision 284)`

---

### Task 12: The board

**Files:**
- Modify: `apps/web/lib/visuals-review.ts` (`SlotView.social`; `postClaims` for Change shot type)
- Modify: `apps/web/app/(console)/projects/[id]/page.tsx` (load posts, presign avatar and media previews, pass cast names)
- Create: `apps/web/app/(console)/projects/[id]/social-preview.tsx` (`'use client'`: the scaled `SocialPostCard` at rest)
- Modify: `apps/web/app/(console)/projects/[id]/visual-board.tsx` (`SocialSlot` controls; Social in Change shot type)
- Test: `apps/web/app/(console)/projects/[id]/visual-board.test.tsx`, `apps/web/app/(console)/projects/[id]/social-preview.test.tsx`, `apps/web/lib/visuals-review.test.ts`

**Interfaces (produces):**

```ts
// visuals-review.ts
export interface SocialSlotView {
  post: SocialPostRecord | null
  avatar: { source: 'upload' | 'cast' | 'initials'; url: string | null; castName: string | null }
  mediaUrl: string | null
  issues: string[]
  /** Pre-filled when the post is too long and no excerpt is chosen. */
  suggestedExcerpt: string | null
  /** For the preview: null while `issues` is non-empty. */
  payload: SocialPayload | null
}
// SlotView gains `social: SocialSlotView | null`; the board model gains `postClaims: { id: string; label: string }[]`

// social-preview.tsx
export function SocialPreview(props: { payload: SocialPayload; brand: BrandKitStored; frame?: { width: number; height: number } }): JSX.Element
```

`SocialPreview` renders `SocialPostCard` with `RESTING_SOCIAL_PROGRESS` and a plain `img` inside a box of the frame's aspect ratio, scaled with a `ResizeObserver` (`transform: scale(containerWidth / frame.width)`, `transform-origin: top left`), and calls `loadBrandFonts` as the Brand Kit specimen does. A slot with issues shows the card with the fields it has and the issues listed above the form, not an error card.

`SocialSlot` controls, labelled exactly as spec section 9: the preview; the four fields each with "from X" or "typed by you"; **Edit details** (form); **Read again**; **Set the post's address** (form, opened on its own when there is no readable post); **Highlight**; **Excerpt** (only when `suggestedExcerpt` is set or an excerpt exists, pre-filled); the avatar line with **Upload profile picture** and, when `avatar.source !== 'cast'` and the handle is known, "Is @handle one of the cast?" with a select of cast names and **Link**; **Upload the post's image** and **Remove**; the media note when `post.endedWithMediaLink` and no image. Every action is a visible labelled button (spec 11.1).

- [ ] **Step 1: Failing tests.** `visuals-review`: a social slot carries its post, the avatar source in the order upload, cast, initials, and the suggested excerpt only when the post is too long. `social-preview.test.tsx`: it renders `SocialPostCard` (mocked, asserting the props include `RESTING_SOCIAL_PROGRESS` and the payload). `visual-board.test.tsx`: a failed post shows `X_POST_MISSING` and the open address form; typing a profile URL and pressing **Use this post** calls `setSocialPostAction`; the excerpt form pre-fills the suggestion; **Link** calls `linkCastHandleAction` with the chosen member and the handle.
- [ ] **Step 2: Run, fail. Step 3: Implement. Step 4: Run, pass** (web).
- [ ] **Step 5: Commit** `feat(web): the board shows and corrects a social post card (decision 284)`

---

### Task 13: Docs, e2e and ship

**Files:**
- Modify: `docs/03-build-spec.md` (dated amendment: the `social` shot type), `PROGRESS.md` (decision 284)
- Modify: the e2e visuals spec (the file that already covers the headline card)
- Create (scratchpad, not the repo): `deploy-social-284.ps1`

- [ ] **Step 1:** e2e in mock mode: a mock claim sourced to an X post, a planned social slot, a hand-typed date, an excerpt chosen, approval. Run it scoped from the e2e package, then free port 3100 if interrupted.
- [ ] **Step 2:** Full suite green across every package (`pnpm test`, one database suite at a time), `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm e2e`.
- [ ] **Step 3: Commit** `docs: social post shots (decision 284)`. Merge and push only on the owner's "merge and push".
- [ ] **Step 4: Deploy.** After the push: wait for the Vercel deploy, then `curl -X PUT https://boom-busters-web-rho.vercel.app/api/inngest`. The migration runs in the Vercel build. Write `deploy-social-284.ps1` from `deploy-render-fix.ps1` (profile `reelscript`, region `eu-west-1`, `deploy:remotion`, the y/n check on the serve URL and function name, the live `SENTRY_DSN` carried forward, `deploy:stacks boom-busters-broker`) and hand it to the owner to run straight away. Afterwards confirm the broker's `LastModified` and `SENTRY_RELEASE` read-only.
- [ ] **Step 5 (optional, ask first):** one draft render of a single social slot for Emad's post, a few cents of AWS time.
