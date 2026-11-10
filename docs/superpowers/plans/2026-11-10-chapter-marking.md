# Chapter Marking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No film opens on a chapter card; a channel (and a format) chooses whether chapter starts are marked with a card, one title card after the opening, or nothing, and an unmarked break still reads as a beat.

**Architecture:** Two new enum fields in jsonb settings (Brand Kit look, channel format) resolve to one `ChapterMarking` the assembly runner hands the compiler. The compiler skips the opening card always, inserts a card, a title card or a held break per chapter by mode, writes a `chapters` list on the timeline so the preview no longer reads titles off cards, and writes music cues a shared helper can reproduce from any timeline. Compositions drop the card's number and gain a `TitleCard`.

**Tech Stack:** TypeScript, Zod 4, vitest, Remotion compositions with PNG goldens, Next.js app router with React Testing Library, Inngest runner tests via the engine harness, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-10-chapter-marking-design.md`

## Global Constraints

- Branch `chapter-marking` off `master`, one logical change per commit, every commit ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Run `pnpm exec vitest run <basename>` from the package directory, never `pnpm --filter <pkg> test -- <path>` (that runs the whole package).
- Run `pnpm format:check` on the tracked files you touched before each commit; CI gates on Prettier.
- No migration: both new fields are jsonb with zod defaults.
- UI: every action a visible labelled control; selects carry a `Label` with `htmlFor`. No em dashes or en dashes in any copy the owner reads.
- Constants, verbatim from the spec: `CHAPTER_LEAD_MS = 800`, `CHAPTER_CARD_MS = 3200`, `CHAPTER_OVERLAP_MS = 900` (unchanged); new `CHAPTER_HOLD_MS = 1400`.
- Brand look default `chapterMarking: 'cards'`; format default `chapterMarking: 'inherit'`; `""`, `null` and absent on the format field parse to `inherit`.
- Goldens: regenerate the compile golden with `REGEN_GOLDEN=1` and review its diff; regenerate composition goldens only from a run of the compositions package alone, never from a full-suite run.
- Do not touch `packages/timeline/src/short.ts`, `teaser.ts` or the outline and script prompts.

## Review Focus

1. A timeline compiled before this branch (card at every chapter including index 1, no `chapters` list) must keep its preview chapter titles and its music cues unchanged. Pinned in Task 4 (helper legacy rule) and Task 6 (cards-only fallback).
2. A timeline whose cards were edited away and that has no `chapters` list must still get cues at every chapter's first word, as today. Pinned in Task 4.
3. A chapter whose paragraphs all sit under one card index must not produce two cards: the compiler keys on `chapterId`, not index. Pinned in Task 3 (the golden input has two paragraphs in chapter one and asserts one card).
4. A stored format written by Draft with AI with `chapterMarking: ""` must parse. Pinned in Task 1.
5. `title` mode on a film whose project title is long must not overflow the card: `TitleCard` uses the same `maxWidth: width * 0.8` and centred wrap as the full chapter card. Pinned in Task 5 by the `TitleCardFull` golden using a 48-character title.

---

### Task 1: The two settings and their resolver

**Files:**
- Modify: `packages/schemas/src/settings.ts:440-448` (BrandLookSchema), `:790-797` (DEFAULT_SETTINGS look)
- Modify: `packages/schemas/src/formats.ts:38-62` (ChannelFormatSchema), `:84-101` (defaultFormat), `:119-136` (formatIsDefault); add `resolveChapterMarking`
- Modify: `packages/providers/src/prompts/bible-draft.ts:55` (the formats field description)
- Test: `packages/schemas/src/formats.test.ts`, `packages/schemas/src/settings.test.ts`

**Interfaces:**
- Produces: `export const CHAPTER_MARKINGS = ['cards', 'title', 'none'] as const; export type ChapterMarking = (typeof CHAPTER_MARKINGS)[number]` in `formats.ts`, re-exported from the package index. `BrandLook.chapterMarking: ChapterMarking`. `ChannelFormat.chapterMarking: 'inherit' | ChapterMarking`. `export function resolveChapterMarking(look: Pick<BrandLook, 'chapterMarking'>, format: Pick<ChannelFormat, 'chapterMarking'>): ChapterMarking`.

- [ ] **Step 1: Write the failing tests**

In `formats.test.ts`, extend the `defaultFormat parses and carries every default` expectation with `chapterMarking: 'inherit'`, and add:

```ts
test('chapterMarking: absent, "" and null read as inherit; the three values are kept', () => {
  const { chapterMarking: _m, ...stored } = defaultFormat()
  expect(ChannelFormatSchema.parse(stored).chapterMarking).toBe('inherit')
  expect(ChannelFormatSchema.parse({ ...stored, chapterMarking: '' }).chapterMarking).toBe('inherit')
  expect(ChannelFormatSchema.parse({ ...stored, chapterMarking: null }).chapterMarking).toBe('inherit')
  for (const value of ['cards', 'title', 'none'] as const) {
    expect(ChannelFormatSchema.parse({ ...stored, chapterMarking: value }).chapterMarking).toBe(value)
  }
  expect(ChannelFormatSchema.safeParse({ ...stored, chapterMarking: 'sometimes' }).success).toBe(false)
})

test('formatIsDefault is false once chapterMarking is set', () => {
  expect(formatIsDefault(base({ chapterMarking: 'none' }))).toBe(false)
})

test('resolveChapterMarking: the format wins unless it inherits', () => {
  expect(resolveChapterMarking({ chapterMarking: 'cards' }, { chapterMarking: 'inherit' })).toBe('cards')
  expect(resolveChapterMarking({ chapterMarking: 'cards' }, { chapterMarking: 'none' })).toBe('none')
  expect(resolveChapterMarking({ chapterMarking: 'none' }, { chapterMarking: 'title' })).toBe('title')
})
```

In `settings.test.ts` add:

```ts
it('the Brand Kit look defaults chapterMarking to cards and refuses other words', () => {
  const look = BrandLookSchema.parse({})
  expect(look.chapterMarking).toBe('cards')
  expect(BrandLookSchema.safeParse({ chapterMarking: 'off' }).success).toBe(false)
  expect(DEFAULT_SETTINGS.brandKit.look.chapterMarking).toBe('cards')
})
```

- [ ] **Step 2: Run them to verify they fail**

Run from `packages/schemas`: `pnpm exec vitest run formats.test settings.test`
Expected: FAIL on `chapterMarking` undefined and `resolveChapterMarking` not exported.

- [ ] **Step 3: Implement**

`formats.ts`: `CHAPTER_MARKINGS`, `ChapterMarking`, and on the strict object `chapterMarking: z.preprocess((v) => (v === '' || v === null || v === undefined ? 'inherit' : v), z.enum(['inherit', ...CHAPTER_MARKINGS]))` with a doc comment naming the spec; `defaultFormat()` sets `'inherit'`; `formatIsDefault` compares it; `resolveChapterMarking` per the interface. `settings.ts`: `chapterMarking: z.enum(CHAPTER_MARKINGS).default('cards')` on `BrandLookSchema` (import from `./formats`), and `chapterMarking: 'cards'` in `DEFAULT_SETTINGS.brandKit.look`. `bible-draft.ts:55`: after `outroLine: "" when none`, add `, chapterMarking: "inherit" (the channel's choice), "cards" (a card at every chapter after the opening), "title" (the film's title once, after the opening) or "none"`. Export the new names from `packages/schemas/src/index.ts` if formats are re-exported by name there.

- [ ] **Step 4: Run the schemas package and typecheck**

Run from `packages/schemas`: `pnpm exec vitest run` then from the root `pnpm typecheck`.
Expected: all green. If `typecheck` names a fixture that spreads `ChannelFormat` or `BrandLook` literally, add the field there.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/formats.ts packages/schemas/src/formats.test.ts packages/schemas/src/settings.ts packages/schemas/src/settings.test.ts packages/providers/src/prompts/bible-draft.ts packages/schemas/src/index.ts
git commit -m "feat(schemas): chapter marking on the Brand Kit look and per format, with its resolver (decision 457)"
```

---

### Task 2: The timeline contract: a title card overlay and the chapters list

**Files:**
- Modify: `packages/schemas/src/timeline.ts:377-425` (OverlaySchema), `:430-442` (TimelineSchema)
- Test: `packages/schemas/src/timeline.test.ts`

**Interfaces:**
- Produces: overlay member `{ kind: 'titleCard', startMs, durationMs, props: { title: string (min 1) } }`; `TimelineSchema.chapters?: { id: Ulid, title: string (min 1) }[]` (optional, script order); `export type TimelineChapter`.

- [ ] **Step 1: Write the failing tests**

Beside the existing chapterCard fixture in `timeline.test.ts`:

```ts
it('accepts a titleCard overlay and an optional chapters list, and strips neither', () => {
  const parsed = TimelineSchema.parse({
    ...valid(),
    chapters: [{ id: '01J00000000000000000000001', title: 'The audit' }],
    overlays: [{ kind: 'titleCard', startMs: 15_500, durationMs: 3200, props: { title: 'The Wirecard Hole' } }],
  })
  expect(parsed.chapters).toEqual([{ id: '01J00000000000000000000001', title: 'The audit' }])
  expect(parsed.overlays[0]?.kind).toBe('titleCard')
})

it('a timeline without a chapters list still parses (compiled before decision 457)', () => {
  expect(TimelineSchema.parse(valid()).chapters).toBeUndefined()
})
```

Use whatever the file's existing valid-timeline builder is called in place of `valid()`.

- [ ] **Step 2: Run to verify failure**

Run from `packages/schemas`: `pnpm exec vitest run timeline.test`
Expected: FAIL, invalid discriminator `titleCard`.

- [ ] **Step 3: Implement**

Add the `titleCard` member after `chapterCard` with a doc comment ("the film's title once after the opening, `chapterMarking: 'title'`"), and `chapters: z.array(TimelineChapterSchema).optional()` with `TimelineChapterSchema = z.object({ id: UlidSchema, title: z.string().min(1) })` and a doc comment saying the preview reads titles here and a timeline compiled earlier has none.

- [ ] **Step 4: Run, typecheck, commit**

Run from `packages/schemas`: `pnpm exec vitest run timeline.test`; root `pnpm typecheck`. Expected: green (an exhaustive `switch` on overlay kind in `DocumentaryMaster` falls to the watermark branch today, so compositions still compile).

```bash
git add packages/schemas/src/timeline.ts packages/schemas/src/timeline.test.ts
git commit -m "feat(schemas): the titleCard overlay and the timeline's chapters list"
```

---

### Task 3: The compiler: no opening card, three marking modes, the chapters list

**Files:**
- Modify: `packages/timeline/src/compile.ts:110-120` (CompileInput), `:170-190` (constants), `:199-230` (narration loop), `:364-383` (overlays and cues)
- Modify: `packages/timeline/src/golden/master-timeline.json` (regenerated)
- Test: `packages/timeline/src/compile.test.ts`

**Interfaces:**
- Consumes: `ChapterMarking` from Task 1; `titleCard` overlay and `chapters` from Task 2.
- Produces: `CompileInput.chapterMarking: ChapterMarking` (required), `CompileInput.filmTitle: string` (required; used by `title` mode); `export const CHAPTER_HOLD_MS = 1400`; the compiled timeline carries `chapters` in script order. Cue rule: t=0, then each card's or title card's start, then each unmarked break's lead point.

Numbers for `goldenInput()` (paragraphs 8000, 6000, 7000 ms; chapters one, one, two): opening starts at 0; paragraph two at 8700; chapter two's break begins at 14 700.

- [ ] **Step 1: Rewrite the existing breathing-room tests and add the mode tests**

`goldenInput()` gains `chapterMarking: 'cards'` and `filmTitle: 'The Wirecard Hole'`. Replace the four assertions that encoded the opening card:

```ts
it('opens on the first word: narration starts at 0 and no card precedes it (decision 457)', () => {
  const timeline = compileTimeline(goldenInput())
  expect(timeline.narration.map((s) => s.startMs)).toEqual([0, 8700, 17_800])
  expect(timelineDurationMs(timeline)).toBe(24_800)
  expect(timeline.overlays.map((o) => o.startMs)).toEqual([15_500])
  expect(timeline.chapters).toEqual([
    { id: CHAPTER_ONE, title: 'The audit' },
    { id: CHAPTER_TWO, title: 'The collapse' },
  ])
})

it('cards mode: one card per later chapter, title only in the props index, and the cue at the card', () => {
  const timeline = compileTimeline(goldenInput())
  expect(timeline.overlays).toEqual([
    { kind: 'chapterCard', startMs: 15_500, durationMs: CHAPTER_CARD_MS, props: { index: 2, title: 'The collapse' } },
  ])
  expect(timeline.narration[2]!.startMs).toBe(15_500 + CHAPTER_CARD_MS - CHAPTER_OVERLAP_MS)
  expect(timeline.music?.cuePoints.map((c) => c.tMs)).toEqual([0, 15_500])
})

it('none mode: no overlay, a held break of lead plus hold, the cue at the lead point', () => {
  const timeline = compileTimeline({ ...goldenInput(), chapterMarking: 'none' })
  expect(timeline.overlays).toEqual([])
  expect(timeline.narration[2]!.startMs).toBe(14_700 + CHAPTER_LEAD_MS + CHAPTER_HOLD_MS)
  expect(timeline.music?.cuePoints.map((c) => c.tMs)).toEqual([0, 15_500])
  // The outgoing shot holds through the break to the resumed words.
  const still = timeline.slots[1]!
  expect(still.startMs + still.durationMs).toBe(timeline.narration[2]!.startMs)
})

it('title mode: the film title once at chapter two, later chapters unmarked', () => {
  const input = threeChapterInput({ chapterMarking: 'title' })
  const timeline = compileTimeline(input)
  expect(timeline.overlays).toEqual([
    { kind: 'titleCard', startMs: 15_500, durationMs: CHAPTER_CARD_MS, props: { title: 'The Wirecard Hole' } },
  ])
  const third = timeline.narration[3]!
  const second = timeline.narration[2]!
  expect(third.startMs).toBe(second.startMs + second.durationMs + CHAPTER_LEAD_MS + CHAPTER_HOLD_MS)
  expect(timeline.music?.cuePoints.map((c) => c.tMs)).toEqual([0, 15_500, second.startMs + second.durationMs + CHAPTER_LEAD_MS])
})

it('a single-chapter film gets no card in any mode', () => {
  for (const chapterMarking of ['cards', 'title', 'none'] as const) {
    const input = { ...goldenInput(), chapterMarking }
    input.paragraphs = input.paragraphs.filter((p) => p.chapterId === CHAPTER_ONE)
    expect(compileTimeline(input).overlays).toEqual([])
  }
})
```

`threeChapterInput(over)` is a new exported helper in `compile.test.ts`: `goldenInput()` plus a fourth paragraph `{ chapterId: CHAPTER_THREE, chapterIndex: 2, chapterTitle: 'The trial', paragraphIndex: 0, r2Key: 'boom-busters/takes/p4.mp3', durationMs: 5000 }`, with `CHAPTER_THREE` a third valid ULID constant. Update `ducks the music with the Brand Kit gains`: the curve's first point is now the ducked level (`brand.music.bedGainDb + brand.music.duckDepthDb`) because words start at 0. Update `breathes between paragraphs...`, `shifts and stretches...` and `closes rounding seams...` to the new numbers (narration resumes at 17 800; the card is `overlays[0]`).

- [ ] **Step 2: Run to verify failure**

Run from `packages/timeline`: `pnpm exec vitest run compile.test`
Expected: FAIL on `chapterMarking` typing and the old numbers.

- [ ] **Step 3: Implement**

In the narration loop: the first chapter adds no lead, card or hold. For each later chapter, by `input.chapterMarking`: `cards` → card as today (props `{ index: chapterIndex + 1, title }`), shift `lead + CARD - OVERLAP`; `title` and it is the second chapter → push a `{ kind: 'titleCard', props: { title: input.filmTitle } }` overlay at the lead with the same shift; otherwise (`none`, or `title` from the third chapter on) → no overlay, shift `lead + CHAPTER_HOLD_MS`, and record a cue at the lead point. Collect `cues: number[]` in the loop starting with `0`; write `music.cuePoints` from it; write `chapters` from the first paragraph of each chapter in order. Keep `overlays` typed as `Overlay[]`.

- [ ] **Step 4: Regenerate the golden and run the package**

Run from `packages/timeline`: `REGEN_GOLDEN=1 pnpm exec vitest run compile.test` then `git diff packages/timeline/src/golden/master-timeline.json` and read it: expect the opening card gone, narration shifted earlier by 2300 ms, one card at 15 500, the `chapters` list. Then `pnpm exec vitest run` for the whole package.
Expected: green, including `music.test` (its first test compares cues to the compile's).

- [ ] **Step 5: Commit**

```bash
git add packages/timeline/src/compile.ts packages/timeline/src/compile.test.ts packages/timeline/src/golden/master-timeline.json
git commit -m "feat(timeline): no opening card; cards, title or none per chapter marking; the chapters list (decision 457)"
```

---

### Task 4: One cue rule for compile and bed swaps

**Files:**
- Modify: `packages/timeline/src/music.ts:27-41`
- Test: `packages/timeline/src/music.test.ts`

**Interfaces:**
- Consumes: `CHAPTER_HOLD_MS` from Task 3.
- Produces: `export function chapterCuePoints(timeline: Pick<Timeline, 'narration' | 'overlays' | 'chapters'>): { tMs: number; style: 'chapter' }[]`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('chapterCuePoints', () => {
  it('equals what the compiler wrote, in every mode', () => {
    for (const chapterMarking of ['cards', 'title', 'none'] as const) {
      const timeline = compileTimeline(threeChapterInput({ chapterMarking }))
      expect(chapterCuePoints(timeline)).toEqual(timeline.music?.cuePoints)
    }
  })

  it('a timeline without a chapters list keeps the old rule: every card, else every first word', () => {
    const compiled = compileTimeline(goldenInput())
    const { chapters: _c, ...legacy } = compiled
    const withCards = { ...legacy, overlays: [{ kind: 'chapterCard' as const, startMs: 0, durationMs: 3200, props: { index: 1, title: 'The audit' } }, ...legacy.overlays] }
    expect(chapterCuePoints(withCards).map((c) => c.tMs)).toEqual([0, 15_500])
    const cardless = { ...legacy, overlays: [] }
    expect(chapterCuePoints(cardless).map((c) => c.tMs)).toEqual([0, 17_800])
  })

  it('swapMusicBed on a none-mode timeline compiled without a bed lands the cue at the lead point', () => {
    const silent = compileTimeline({ ...goldenInput(), chapterMarking: 'none', music: null })
    const swapped = swapMusicBed(silent, { r2Key: 'boom-busters/music/other.mp3' })
    expect(swapped.music?.cuePoints.map((c) => c.tMs)).toEqual([0, 15_500])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run from `packages/timeline`: `pnpm exec vitest run music.test`
Expected: FAIL, `chapterCuePoints` not exported.

- [ ] **Step 3: Implement**

`chapterCuePoints`: if `timeline.chapters` is undefined, return today's rule verbatim (card starts; if none, each chapter's first segment start). Otherwise walk chapters in narration order: the first → `0`; a chapter whose first segment is preceded by a `chapterCard` with `props.index === position` or by a `titleCard` whose `startMs + CHAPTER_CARD_MS - CHAPTER_OVERLAP_MS === firstSegment.startMs` → that overlay's start; any other → `Math.max(0, firstSegment.startMs - CHAPTER_HOLD_MS)`. `swapMusicBed` calls it in place of its inline derivation. Then make `compileTimeline` call `chapterCuePoints` on its own result instead of keeping a parallel `cues` array, so there is one rule.

- [ ] **Step 4: Run the package, commit**

Run from `packages/timeline`: `pnpm exec vitest run`. Expected: green.

```bash
git add packages/timeline/src/music.ts packages/timeline/src/music.test.ts packages/timeline/src/compile.ts
git commit -m "feat(timeline): chapterCuePoints, one cue rule for the compiler and bed swaps"
```

---

### Task 5: Compositions: the number-free chapter card and the title card

**Files:**
- Modify: `packages/compositions/src/components/ChapterCard.tsx`
- Create: `packages/compositions/src/components/TitleCard.tsx`
- Modify: `packages/compositions/src/components/DocumentaryMaster.tsx:88-95`, `packages/compositions/src/Root.tsx:571-606`, `packages/compositions/src/index.ts:29`, `packages/compositions/src/snapshot/render.test.ts:94`
- Modify: `packages/compositions/src/snapshot/golden/ChapterCardFull.png` (regenerated); Create: `.../golden/TitleCardFull.png`

**Interfaces:**
- Consumes: `titleCard` overlay from Task 2.
- Produces: `export function TitleCard({ title, brand, durationInFrames }: { title: string; brand: BrandKitTokens; durationInFrames: number })`, same fades as `ChapterCard` (`FADE_MS = 700`), rendered in the look's `chapterCardVariant`: `full` as the chapter card without the number (accent rule kept above the title), `corner` as the chip with the title alone, `minimal` as centred type over the wash.

- [ ] **Step 1: Add the snapshot entry and the composition, so the suite fails**

In `render.test.ts` after `ChapterCardFull`: `{ id: 'TitleCardFull', frame: 40, maxDiffRatio: 0.06 }`. In `Root.tsx` register `TitleCardFull` with `component={TitleCard}`, `durationInFrames={78}`, `{...WIDE}`, `defaultProps={{ title: 'The Four Billion Euros That Were Never There', brand: FIXTURE_BRAND, durationInFrames: 78 }}` (48 characters, to prove the wrap).

- [ ] **Step 2: Run the compositions package alone to see it fail**

Run from `packages/compositions`: `pnpm exec vitest run render.test` (timeout 600000 if dispatched).
Expected: FAIL, `TitleCard` missing and no `TitleCardFull` golden.

- [ ] **Step 3: Implement**

`ChapterCard.tsx`: remove the `number` element from all three variants; keep `index` in the props (the overlay still carries it) and note in the doc comment that it is the preview's match key, not drawn (decision 457). `TitleCard.tsx` per the interface, sharing `typeStyle`, `withAlpha`, `frameScale` and `easeInOut`. `DocumentaryMaster.tsx`: a `titleCard` branch rendering `TitleCard`. Export from `index.ts`.

- [ ] **Step 4: Regenerate goldens from a package-alone run and verify**

Run from `packages/compositions`: `REGEN_GOLDEN=1 pnpm exec vitest run render.test`, then open `golden/ChapterCardFull.png` and `golden/TitleCardFull.png` (Read the PNGs) and confirm: no number on the chapter card; the title card wraps to two centred lines inside the frame. Then `pnpm exec vitest run` for the package without the flag.
Expected: green. The `DocumentaryMaster` golden is unchanged unless the fixture carries a card at frame 200; if it changed, read the diff before accepting.

- [ ] **Step 5: Commit**

```bash
git add packages/compositions/src/components/ChapterCard.tsx packages/compositions/src/components/TitleCard.tsx packages/compositions/src/components/DocumentaryMaster.tsx packages/compositions/src/Root.tsx packages/compositions/src/index.ts packages/compositions/src/snapshot/render.test.ts packages/compositions/src/snapshot/golden/ChapterCardFull.png packages/compositions/src/snapshot/golden/TitleCardFull.png
git commit -m "feat(compositions): the chapter card drops its number; TitleCard for the film's title (decision 457)"
```

---

### Task 6: The preview's chapter list reads the timeline's chapters

**Files:**
- Modify: `apps/web/lib/preview-review.ts:45-66`
- Create: `apps/web/lib/preview-review.test.ts`

**Interfaces:**
- Consumes: `Timeline.chapters` from Task 2.
- `timelineChapters(timeline)` keeps its signature.

- [ ] **Step 1: Write the failing tests**

```ts
import { compileTimeline, goldenInput, CHAPTER_ONE, CHAPTER_TWO } from '@boom-busters/timeline/test-helpers' // or the path the package exposes; else build a minimal Timeline literal

describe('timelineChapters', () => {
  it('titles chapters from the chapters list, so a cardless film keeps its names', () => {
    const timeline = compileTimeline({ ...goldenInput(), chapterMarking: 'none' })
    expect(timelineChapters(timeline).map((c) => c.title)).toEqual(['The audit', 'The collapse'])
    expect(timelineChapters(timeline)[1]?.startMs).toBe(timeline.narration[2]!.startMs)
  })

  it('falls back to the matching card, then to a positional name, for a timeline without the list', () => {
    const compiled = compileTimeline(goldenInput())
    const { chapters: _c, ...legacy } = compiled
    expect(timelineChapters(legacy as Timeline).map((c) => c.title)).toEqual(['Chapter 1', 'The collapse'])
  })
})
```

If `goldenInput` is not importable across packages (it lives in a test file), build the timelines with a small literal in the test; the assertions stay the same.

- [ ] **Step 2: Run to verify failure**

Run from `apps/web`: `pnpm exec vitest run preview-review.test`
Expected: FAIL, first test yields `['Chapter 1', 'Chapter 2']`.

- [ ] **Step 3: Implement**

Before the card lookup: `const listed = timeline.chapters?.find((c) => c.id === segment.chapterId)`; title is `listed?.title ?? card title ?? \`Chapter ${position}\``. Update the doc comment.

- [ ] **Step 4: Run, commit**

Run from `apps/web`: `pnpm exec vitest run preview-review.test`. Expected: green.

```bash
git add apps/web/lib/preview-review.ts apps/web/lib/preview-review.test.ts
git commit -m "feat(web): the preview's chapter list reads the timeline's chapters, cards as the fallback"
```

---

### Task 7: The assembly runner resolves the marking and the film title

**Files:**
- Modify: `apps/web/inngest/functions/assembly-runner.ts:112-140` (load-assembly), `:456-462` (compile call)
- Test: `apps/web/inngest/functions/assembly-runner.test.ts`

**Interfaces:**
- Consumes: `resolveChapterMarking` (Task 1), `CompileInput.chapterMarking` and `filmTitle` (Task 3), `channelForProject(...).format` and `.settings`.
- Produces: `setup.chapterMarking: ChapterMarking` and `setup.filmTitle: string` on the `load-assembly` step result.

- [ ] **Step 1: Write the failing test**

Following the `transcribe-batch-0` test's harness pattern (seed `load-assembly` with a `setup`, seed every step the compile step depends on with the values the existing test file already uses or with empty results), add:

```ts
it('compiles with the resolved chapter marking: none yields no card overlays', { timeout: 120_000 }, async () => {
  const setup = { ...baseSetup(), chapterMarking: 'none' as const, filmTitle: 'The audit' }
  const result = await engine.executeStep('compile', { events: [...], steps: [{ id: 'load-assembly', handler: () => setup }, ...] })
  expect(result.ok).toBe(true)
  expect(result.timeline.overlays.filter((o) => o.kind === 'chapterCard' || o.kind === 'titleCard')).toEqual([])
  expect(result.timeline.chapters?.map((c) => c.title)).toEqual([...])
})
```

`baseSetup()` is the existing test's `setup` object with one slot per paragraph if the compiler requires slots (it requires at least one). If the harness cannot reach the compile step without the broker's transcription results, seed the `captions` step with `{ words: [], gaps: [] }` and the stock step with no changes; read the runner to find their ids.

- [ ] **Step 2: Run to verify failure**

Run from `apps/web`: `pnpm exec vitest run assembly-runner.test`
Expected: FAIL on the `chapterMarking` type (the compile call does not pass it).

- [ ] **Step 3: Implement**

In `load-assembly`: `const { settings, name, handle, format } = await channelForProject(db, projectId)`; `brand = resolveBrandKit(settings, { name, handle })`; return `chapterMarking: resolveChapterMarking(brand.look, format)` and `filmTitle: project.title`. In the compile step pass `chapterMarking: setup.chapterMarking, filmTitle: setup.filmTitle`.

- [ ] **Step 4: Run, typecheck, commit**

Run from `apps/web`: `pnpm exec vitest run assembly-runner.test`; root `pnpm typecheck`. Expected: green.

```bash
git add apps/web/inngest/functions/assembly-runner.ts apps/web/inngest/functions/assembly-runner.test.ts
git commit -m "feat(web): the assembly runner compiles with the format's chapter marking and the film title"
```

---

### Task 8: The two controls in Settings

**Files:**
- Modify: `apps/web/app/(console)/c/[slug]/settings/settings-form.tsx:463-470` (setLook generic), `:520-547` (the Photographic look card)
- Modify: `apps/web/app/(console)/c/[slug]/settings/brand-specimen.tsx:129-131`
- Modify: `apps/web/app/(console)/c/[slug]/settings/bible-fields.tsx:1047-1058` (after the intro rule), `:1148-1158` (summary rows)
- Test: `apps/web/app/(console)/c/[slug]/settings/brand-look.test.tsx`, `apps/web/app/(console)/c/[slug]/settings/bible-tab.test.tsx`

Copy, fixed: Brand tab select labelled `Chapter marking` with options `cards` "A card at every chapter after the opening", `title` "The film's title once, after the opening", `none` "No cards". Card description sentence under the existing look description: "The opening chapter never gets a card; this chooses what marks the chapters after it. A format can override it." Format editor select labelled `Chapter marking` with the same three plus first option `inherit` "Channel default". Summary row `['Chapter marking', format.chapterMarking === 'inherit' ? '' : format.chapterMarking]`. Specimen caption: `Chapter card ({look.chapterCardVariant}, marking {look.chapterMarking})`.

- [ ] **Step 1: Write the failing tests**

In `brand-look.test.tsx`, beside the grain and grade test:

```ts
it('offers chapter marking on the Brand Kit tab, defaulting to cards, and saves a choice', async () => {
  const user = userEvent.setup()
  await openBrandKitTab()
  const marking = screen.getByLabelText('Chapter marking')
  expect((marking as HTMLSelectElement).value).toBe('cards')
  await user.selectOptions(marking, 'none')
  expect(saveSettings).toHaveBeenCalledWith(
    '01J00000000000000000000001',
    expect.objectContaining({ brandKit: expect.objectContaining({ look: expect.objectContaining({ chapterMarking: 'none' }) }) }),
  )
})
```

In `bible-tab.test.tsx`, in the formats describe, following the Shorts toggle test's setup and save assertion:

```ts
it('edits a format\'s chapter marking from Channel default, and saves it', async () => {
  // open Edit Formats as the Shorts test does
  const marking = screen.getByLabelText('Chapter marking')
  expect((marking as HTMLSelectElement).value).toBe('inherit')
  await user.selectOptions(marking, 'title')
  // save as the Shorts test does, then:
  expect(saved.formats[0].chapterMarking).toBe('title')
})

it('lists Chapter marking in the read view only when a format overrides the channel', () => {
  // render the read view with one inherit format and one 'none' format, as the Shorts-off test does
  expect(screen.queryAllByText('Chapter marking')).toHaveLength(1)
})
```

- [ ] **Step 2: Run to verify failure**

Run from `apps/web`: `pnpm exec vitest run brand-look.test bible-tab.test`
Expected: FAIL, no element labelled `Chapter marking`.

- [ ] **Step 3: Implement**

Widen `setLook`'s generic to `'gradePreset' | 'grainPreset' | 'chapterMarking'`; add the `Select` after Grain with `id="look-chapter-marking"`, `aria-label="Chapter marking"`. In `bible-fields.tsx` add the select after the intro rule block using the file's `Select` component and `setFormat(index, { chapterMarking: value })`, with `FieldIssues` on `${path}.chapterMarking`; the summary row as fixed above (the summary already omits empty values).

- [ ] **Step 4: Run the settings tests, lint, commit**

Run from `apps/web`: `pnpm exec vitest run brand-look.test bible-tab.test voice-tab.test`; root `pnpm lint`. Expected: green, zero warnings.

```bash
git add "apps/web/app/(console)/c/[slug]/settings/settings-form.tsx" "apps/web/app/(console)/c/[slug]/settings/brand-specimen.tsx" "apps/web/app/(console)/c/[slug]/settings/bible-fields.tsx" "apps/web/app/(console)/c/[slug]/settings/brand-look.test.tsx" "apps/web/app/(console)/c/[slug]/settings/bible-tab.test.tsx"
git commit -m "feat(web): Chapter marking on the Brand Kit tab and per format in the editor"
```

---

### Task 9: The e2e check, the docs and PROGRESS

**Files:**
- Create: `e2e/tests/settings-brand.spec.ts`
- Modify: `docs/03-build-spec.md:268` (the look field list), `PROGRESS.md` (new section before "Long renders in parts" per the file's newest-first order, and decision 457 in the decisions list)

- [ ] **Step 1: Write the e2e spec**

Following `settings-exemplars.spec.ts` for login and navigation to Settings:

```ts
test('the Brand Kit tab offers Chapter marking as a labelled select and keeps the choice', async ({ page }) => {
  // open Settings, click the Brand Kit tab
  const select = page.getByLabel('Chapter marking')
  await expect(select).toBeVisible()
  await expect(select).toHaveValue('cards')
  await select.selectOption('none')
  await page.reload()
  // reopen the Brand Kit tab
  await expect(page.getByLabel('Chapter marking')).toHaveValue('none')
  await page.getByLabel('Chapter marking').selectOption('cards')
})
```

- [ ] **Step 2: Run it alone**

Run from `e2e`: `pnpm exec playwright test tests/settings-brand.spec.ts` (Docker Desktop running; port 3100 free; timeout 600000 if dispatched).
Expected: 1 passed.

- [ ] **Step 3: Docs and PROGRESS**

`docs/03-build-spec.md:268`: add `chapterMarking` to the look's field list. `PROGRESS.md`: a section "Chapter marking (2026-11-10)" in the house style (a blockquote summary naming the branch, decision 457, the spec and plan paths; Deliverables with each task's commit hash; Owner actions at deploy: `deploy:stacks boom-busters-broker`, `deploy:remotion`, `PUT /api/inngest`, and "set Chapter marking to None on channels that want no cards"; Not verified: no live render in `title` or `none` mode, the runner's compile step if the harness could not drive it). Decision 457 in the decisions list: "The opening chapter never gets a card; chapter marking is a Brand Kit choice (cards, title, none) a format can override; cards carry the title only; an unmarked break is 2200 ms so the bed rises; the compiler writes a `chapters` list the preview reads".

- [ ] **Step 4: Full verification before the hand-back**

From the root, one package at a time: `pnpm --filter @boom-busters/schemas test`, `...timeline test`, `...compositions test`, `...web test` (queue them; never two DB suites at once), then `pnpm typecheck`, `pnpm lint`, `pnpm format:check` on the branch's tracked files.
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add e2e/tests/settings-brand.spec.ts docs/03-build-spec.md PROGRESS.md
git commit -m "docs(progress): chapter marking, decision 457, and the Brand Kit e2e check"
```
