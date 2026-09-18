# Sentence-First Briefs and Shot Reuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every shot brief show what its sentence says, with the Director's Book's motifs as a recurring detail rather than the subject of every still, and let the owner point a slot at another slot's shot so one picture can serve twice without being fetched or generated twice.

**Architecture:** Design 1 is prompt craft in the fixed House Visual Bible, the shot-list prompt and the book prompt, plus a motif count in `planWarnings` so the plan screen shows whether the ceiling holds. Design 2 adds one nullable column, `shot_slots.reuse_of_slot_id`; the board's picker records the link, the dependant receives a copy of the source's chosen candidate (at once on the board, or in a new runner step after the fetch fan-out), and every downstream reader keeps reading `candidates` exactly as it does today.

**Tech Stack:** TypeScript, Zod 4, Drizzle (Postgres) with `drizzle-kit generate`, Inngest with `@inngest/test`, Next.js App Router server actions, React 19 with Testing Library, Vitest, Playwright, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-18-sentence-first-briefs-and-shot-reuse-design.md`

## Global Constraints

- Branch `sentence-first-and-shot-reuse` (already holds the spec commit `a8360b9`). Small commits, one logical change each. Before every commit run `pnpm format:check`, `pnpm lint`, `pnpm typecheck` and the package tests the task names; CI gates on Prettier, and lint-clean is not format-clean.
- No em dashes or en dashes in any file this plan creates or edits, including the markdown bible (its own test refuses them), UI copy and PROGRESS.md. Write ranges as "1995 to 2008".
- South African English spelling in prose and UI copy (colour, organisation, licence).
- `'use server'` modules export only async functions. Constants shared with the client live in `@boom-busters/schemas`.
- Every visible action is a labelled button (spec 11.1). Hidden buttons are for the screen; every rule is also enforced in the server action.
- Mock-provider mode (`MOCK_PROVIDERS=1`) exercises every new path with no network call. No real provider call is made during development.
- Integration tests need the test database: start Docker Desktop, then `pnpm db:migrate:test` once after Task 6 lands. Without it the `describeDb` suites skip and prove nothing.
- E2E tests assert on the card under test (`page.locator('[id^="slot-"]').filter(...)`), never on board-wide counts of buttons or chips, because every spec file shares one seeded board.
- Decision numbers: 260 (design 1), 261 (design 2). PROGRESS.md entries 44 and 45, after entry 43 (decision 259).
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Deviations from the spec, decided while planning

Small, and listed here so the reviewer sees them before any code:

1. **E2E split.** The link, its effect on the Fetch button, and the unlink run on the seeded PLAN project, whose state the test can put back exactly. The BOARD project's test opens the picker on the placeholder card, checks what is offered and the distance, and cancels; a board-phase copy cannot be put back into the exact seeded placeholder from the UI, and the board is shared by every test in its file. The board-phase copy itself is proved by the db integration tests, the action tests and the component tests.
2. **A missing source row.** `reuseView` returns null when the source row no longer exists, so the copied candidate renders as an ordinary one with no chip. The chip needs the source's chapter and time, which a missing row cannot give. Only reachable by deleting one slot row, which nothing does; re-plan replaces the dependant too.
3. **The format picker** is also hidden on a linked card. A re-type is refused server-side, so a visible picker would be a set of buttons that can only fail.
4. **The copy drops `score` and `scoreReason`.** They were judged against the source's brief, not the dependant's.
5. **`REUSABLE_SLOT_TYPES`** lives in `@boom-busters/schemas`, not the db package, because the board (a client component) needs it too.

---

## Design 1: the sentence decides the frame (decision 260)

### Task 1: The bible, re-embedded by a script

**Files:**

- Modify: `packages/providers/src/prompts/direction-craft.md` (lines 26-50, 56-60, 171-174, 180)
- Modify: `packages/providers/src/prompts/direction-craft.ts` (the literal at lines 10-203, regenerated)
- Create: `packages/providers/scripts/embed-direction-craft.mjs`
- Modify: `packages/providers/package.json` (add the `embed:craft` script)
- Test: `packages/providers/src/prompts/direction-craft.test.ts`

**Interfaces:**

- Produces: `DIRECTION_CRAFT` (unchanged export) now containing the sentence rule, the motif ceiling, the reworded third physical fact and the reworded fallback. `pnpm --filter @boom-busters/providers embed:craft` regenerates the constant from the markdown.

- [ ] **Step 1: Write the failing test**

Append inside `describe('DIRECTION_CRAFT', ...)` in `packages/providers/src/prompts/direction-craft.test.ts`:

```ts
  it('puts the sentence before the checklist, and caps the motifs (decision 260)', () => {
    expect(DIRECTION_CRAFT).toContain('The sentence decides the frame')
    expect(DIRECTION_CRAFT).toContain('sound off')
    expect(DIRECTION_CRAFT).toContain('each motif at most once per chapter')
    expect(DIRECTION_CRAFT).toContain('one detail drawn from the sentence itself')
    // The clause that put a motif into every still is gone.
    expect(DIRECTION_CRAFT).not.toContain('and one motif from the director')
    // The fallback no longer canonises one picture.
    expect(DIRECTION_CRAFT).not.toContain('(the empty chair,')
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @boom-busters/providers exec vitest run src/prompts/direction-craft.test.ts`
Expected: FAIL, "expected ... to contain 'The sentence decides the frame'".

- [ ] **Step 3: Edit the markdown**

In `packages/providers/src/prompts/direction-craft.md`, five edits.

(a) Under `## Shot grammar for a film made of stills`, insert this as the FIRST bullet, before `- Shot sizes, and what each is for:`:

```markdown
- The sentence decides the frame. Read the narration the slot covers
  before anything else and show what it names: the place, the object, the
  event, the document, the person doing what the sentence says they did.
  A viewer with the sound off should be able to guess the sentence from
  the frame. Only when a sentence names nothing photographable (an
  abstraction, a judgment, a number with no scene around it) reach for
  the director's book: the chapter's key image, a location, a motif.
```

(b) Replace the motif bullet (currently lines 49-50):

```markdown
- Motifs recur. The director's book names three; each chapter shows at
  least one of them, in a new place.
```

with:

```markdown
- Motifs recur, and recur sparingly. The director's book names three;
  each chapter shows at least one of them, in a new place, and each motif
  at most once per chapter. Never in two adjacent slots, and never as the
  subject of the frame unless the sentence is about it. A motif that does
  not fit the sentence stays out; the floor is one motif per chapter, not
  one per still.
```

(c) Under `## What a still prompt must contain`, replace the three-facts bullet (currently lines 56-60):

```markdown
- Three physical facts in every prompt: an environmental pressure
  (rain on the window, a flickering tube, dust in a beam of light), a
  human trace (a coat on a chair, a half-drunk coffee, a hand on a
  document, a figure at a doorway), and one motif from the director's
  book.
```

with:

```markdown
- Three physical facts in every prompt: an environmental pressure
  (rain on the window, a flickering tube, dust in a beam of light), a
  human trace (a coat on a chair, a half-drunk coffee, a hand on a
  document, a figure at a doorway), and one detail drawn from the
  sentence itself (the named object, document, place or time of day). A
  motif from the director's book may stand in for the third fact, at most
  once per chapter.
```

(d) Under `## People`, replace the fallback bullet (currently lines 171-174):

```markdown
- When a model refuses a likeness, the fallback is a redirect: the same
  beat without the person (the empty chair, the podium after the speech,
  the door they walked through) or an anonymous figure. Keep the sentence
  the slot covers; change only what is in the frame.
```

with:

```markdown
- When a model refuses a likeness, the fallback is a redirect: the same
  beat without the person (the podium after the speech, the door they
  walked through, the desk as they left it) or an anonymous figure. Keep
  the sentence the slot covers; change only what is in the frame.
```

(e) Under `## Pre-flight, before answering`, replace:

```markdown
- Every chapter shows at least one motif and builds to its key image.
```

with:

```markdown
- Every chapter shows at least one motif, no motif more than once, and
  builds to its key image. Every frame shows what its sentence says.
```

- [ ] **Step 4: Write the embed script and wire it up**

Create `packages/providers/scripts/embed-direction-craft.mjs`:

```js
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Re-embeds direction-craft.md into direction-craft.ts (the decision 216
 * pattern): the markdown is the human-editable source, the constant is what
 * ships, and the unit test holds the two byte-identical. Run after every edit
 * to the markdown: pnpm --filter @boom-busters/providers embed:craft
 */
const prompts = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'prompts')
const markdown = readFileSync(join(prompts, 'direction-craft.md'), 'utf8').replace(/\r\n/g, '\n')
const source = readFileSync(join(prompts, 'direction-craft.ts'), 'utf8').replace(/\r\n/g, '\n')

const open = 'export const DIRECTION_CRAFT = `'
const start = source.indexOf(open) + open.length
const end = source.indexOf('\n`\n', start)
if (start < open.length || end === -1) {
  throw new Error('direction-craft.ts: could not find the DIRECTION_CRAFT literal')
}
if (markdown.includes('`') || markdown.includes('${')) {
  throw new Error('direction-craft.md: a backtick or ${ cannot be embedded verbatim')
}

writeFileSync(
  join(prompts, 'direction-craft.ts'),
  source.slice(0, start) + markdown.replace(/\n$/, '') + source.slice(end),
)
console.log('direction-craft.ts re-embedded from direction-craft.md')
```

In `packages/providers/package.json`, add to `"scripts"`:

```json
    "embed:craft": "node scripts/embed-direction-craft.mjs",
```

Run: `pnpm --filter @boom-busters/providers embed:craft`
Expected: `direction-craft.ts re-embedded from direction-craft.md`, and `git diff --stat packages/providers/src/prompts/direction-craft.ts` shows only the five edited regions.

- [ ] **Step 5: Run the providers tests to verify they pass**

Run: `pnpm --filter @boom-busters/providers test`
Expected: PASS, including "is byte-identical to direction-craft.md" and "carries no dashes the house style forbids".

- [ ] **Step 6: Format, lint, commit**

```bash
pnpm format:check && pnpm lint
git add packages/providers/src/prompts/direction-craft.md packages/providers/src/prompts/direction-craft.ts packages/providers/src/prompts/direction-craft.test.ts packages/providers/scripts/embed-direction-craft.mjs packages/providers/package.json
git commit -m "feat(bible): the sentence decides the frame, motifs get a ceiling (decision 260)

The third physical fact of every still was a motif from the book, so a
chapter with twelve stills carried twelve empty chairs. It is now a detail
drawn from the sentence itself; a motif may stand in at most once per
chapter. The markdown is re-embedded by a script instead of by hand.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The shot-list prompt puts the sentence first

**Files:**

- Modify: `packages/providers/src/prompts/shotlist.ts:192-195` (the `Planning rules:` block)
- Test: `packages/providers/src/prompts/shotlist.test.ts`

**Interfaces:**

- Consumes: `buildShotListRequest`, `stillStyleAnchors`, `mockDirectorsBook`, and the `PARAGRAPHS`, `CLAIMS`, `brandKit` fixtures already in the test file.
- Produces: no signature change; the system prompt's planning rules gain two rules at the top.

- [ ] **Step 1: Write the failing tests**

Append to `packages/providers/src/prompts/shotlist.test.ts`:

```ts
describe('the sentence decides the frame (decision 260)', () => {
  const request = buildShotListRequest({
    caseTitle: 'Wirecard',
    chapterTitle: 'The Missing Billions',
    chapterNumber: 2,
    paragraphs: PARAGRAPHS,
    claims: CLAIMS,
    styleAnchors: stillStyleAnchors(brandKit),
    direction: mockDirectorsBook({ caseTitle: 'Wirecard', chapterCount: 2 }),
  })

  it('puts the sentence rule first among the planning rules', () => {
    const rules = request.system.slice(request.system.indexOf('Planning rules:'))
    const sentence = rules.indexOf('The sentence decides the frame')
    const cover = rules.indexOf('Cover every paragraph')
    expect(sentence).toBeGreaterThan(-1)
    expect(sentence).toBeLessThan(cover)
  })

  it('caps each motif at once per chapter, never adjacent, never the subject', () => {
    expect(request.system).toContain('each motif at most once across the chapter')
    expect(request.system).toContain('never in consecutive slots')
    expect(request.system).toContain('needs no motif at all')
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @boom-busters/providers exec vitest run src/prompts/shotlist.test.ts`
Expected: FAIL, "expected -1 to be greater than -1".

- [ ] **Step 3: Add the two rules**

In `packages/providers/src/prompts/shotlist.ts`, directly after the line `Planning rules:` and before `- Cover every paragraph.`, insert:

```text
- The sentence decides the frame. Read "coversText" before anything else and
  show what it says: the place it names, the object it mentions, the thing
  that happened, the person doing what the sentence says they did. Only when
  the sentence names nothing photographable do you reach for the book: the
  chapter's key image, a location, a motif.
- Motifs are seasoning, not the meal. Use each motif at most once across the
  chapter, never in consecutive slots, and never as the subject of a frame
  unless the sentence is about it. A still whose sentence gives you a
  concrete subject needs no motif at all.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @boom-busters/providers test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format:check && pnpm lint
git add packages/providers/src/prompts/shotlist.ts packages/providers/src/prompts/shotlist.test.ts
git commit -m "feat(shotlist): the sentence rule leads the planning rules (decision 260)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The book prompt says how to choose motifs

**Files:**

- Modify: `packages/providers/src/prompts/direction.ts:97-124` (the `Rules for the book:` block)
- Test: `packages/providers/src/prompts/direction.test.ts`

- [ ] **Step 1: Write the failing test**

Inside `describe('buildDirectorsBookRequest', ...)` in `packages/providers/src/prompts/direction.test.ts`, after the test `'carries the bible in the system prompt'`, add:

```ts
  it('says how to choose motifs: this story, never the house furniture (decision 260)', () => {
    expect(request.system).toContain('Motifs are this story')
    expect(request.system).toContain('never the house look')
    expect(request.system).toContain('could belong to any corporate collapse')
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @boom-busters/providers exec vitest run src/prompts/direction.test.ts`
Expected: FAIL, "expected ... to contain 'Motifs are this story'".

- [ ] **Step 3: Add the rule**

In `packages/providers/src/prompts/direction.ts`, inside the `Rules for the book:` list, directly after the line `- Era locks name objects, not adjectives.`, insert:

```text
- Motifs are this story's own: an object, a place detail or a recurring
  situation the claims establish (the product itself, the lobby of the named
  building, a specific document type, a specific vehicle), each able to sit
  in the background of a frame whose subject is something else. They are
  never the house look's own furniture (empty chairs, screens, glass,
  corridors), which every film already has. A motif that could belong to any
  corporate collapse is chosen again.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @boom-busters/providers test`
Expected: PASS (the existing assertion on "exactly three recurring visual motifs" still holds; the shape line is untouched).

- [ ] **Step 5: Commit**

```bash
pnpm format:check && pnpm lint
git add packages/providers/src/prompts/direction.ts packages/providers/src/prompts/direction.test.ts
git commit -m "feat(direction): motifs come from the story, not the house look (decision 260)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The chapter lean, and a motif count in `planWarnings`

**Files:**

- Modify: `packages/schemas/src/direction.ts:89-95` (`renderDirectorsBook` chapter line) and `:100-136` (`planWarnings`)
- Modify: `apps/web/inngest/functions/visuals-runner.ts:226-231`
- Modify: `apps/web/inngest/functions/visuals-replanner.ts:185-188`
- Modify: `apps/web/lib/visuals-review.ts:416-430`
- Test: `packages/schemas/src/direction.test.ts`

**Interfaces:**

- Produces:
  - `export interface WarnableSlot { brief: ShotBrief; chapter?: string | undefined }`
  - `export function planWarnings(slots: readonly WarnableSlot[], bannedWords: readonly string[], motifs?: readonly string[]): string[]` (a third, optional parameter; existing callers compile unchanged)
  - `export function motifPattern(motif: string): RegExp | null`
  - `renderDirectorsBook` writes `Chapter N: leans towards <family> shots; ...`

- [ ] **Step 1: Write the failing tests**

In `packages/schemas/src/direction.test.ts`, change the import line to:

```ts
import {
  castWarnings,
  DirectorsBookSchema,
  motifPattern,
  planWarnings,
  renderDirectorsBook,
} from './direction'
```

Inside `describe('renderDirectorsBook', ...)` add:

```ts
  it('reads a chapter family as a lean, not a rule (decision 260)', () => {
    expect(renderDirectorsBook(DirectorsBookSchema.parse(book))).toContain(
      'Chapter 1: leans towards environment shots;',
    )
  })
```

After `describe('planWarnings', ...)` add:

```ts
describe('planWarnings: motifs (decision 260)', () => {
  const motifs = ['reflections in dark glass', 'empty chairs', 'server racks']
  const stock = (description: string): ShotBrief => ({
    type: 'stock',
    coversText: 'x',
    description,
    motion: { kind: 'static' },
    transition: 'cut',
    query: 'q',
    rejectionCriteria: [],
  })
  const chart: ShotBrief = {
    type: 'chart',
    coversText: 'x',
    description: 'a server rack chart',
    motion: { kind: 'static' },
    transition: 'cut',
    chartKind: 'bar',
    series: [
      {
        label: 'a',
        unit: 'USD',
        points: [
          { x: '2019', y: 1 },
          { x: '2020', y: 2 },
        ],
      },
    ],
    dataRefs: ['01HQ00000000000000000000AA'],
    takeaway: 't',
    reveal: 'none',
  }

  it('counts a motif in more than one picture brief of a chapter, by its head noun, and flags neighbours', () => {
    const warnings = planWarnings(
      [
        { brief: still('wide', 'A server rack humming in the dark'), chapter: 'chapter 3' },
        { brief: stock('Rows of server racks'), chapter: 'chapter 3' },
        { brief: still('close', 'A ledger on a desk'), chapter: 'chapter 3' },
      ],
      [],
      motifs,
    )
    expect(warnings).toEqual([
      'motif "server racks" appears in 2 of 3 picture briefs in chapter 3',
      'motif "server racks" appears in two adjacent slots (from slot 0)',
    ])
  })

  it('is silent when each motif appears once per chapter, however many chapters', () => {
    expect(
      planWarnings(
        [
          { brief: still('wide', 'an empty chair'), chapter: 'chapter 1' },
          { brief: still('close', 'a ledger'), chapter: 'chapter 1' },
          { brief: still('wide', 'an empty chair at the head of the table'), chapter: 'chapter 2' },
        ],
        [],
        motifs,
      ),
    ).toEqual([])
  })

  it('matches the head noun and its plural, never the modifier, and skips data briefs', () => {
    expect(
      planWarnings(
        [
          { brief: stock('Deserted office, empty desks'), chapter: 'c' },
          { brief: stock('More empty desks'), chapter: 'c' },
          { brief: chart, chapter: 'c' },
          { brief: chart, chapter: 'c' },
        ],
        [],
        motifs,
      ),
    ).toEqual([])
    expect(motifPattern('reflections in dark glass')?.test('her glasses on the desk')).toBe(true)
    expect(motifPattern('server racks')?.test('a rack of servers')).toBe(true)
    expect(motifPattern('[mock] empty chairs')?.test('empty desks')).toBe(false)
    expect(motifPattern('')).toBeNull()
  })

  it('changes nothing for a caller that passes no motifs', () => {
    expect(planWarnings([{ brief: still('wide', 'a') }, { brief: still('close', 'b') }], [])).toEqual(
      [],
    )
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @boom-busters/schemas exec vitest run src/direction.test.ts`
Expected: FAIL, "motifPattern is not a function" (or an import error).

- [ ] **Step 3: Implement**

In `packages/schemas/src/direction.ts`, change the chapter line inside `renderDirectorsBook` from:

```ts
      `- Chapter ${chapter.chapter}: ${chapter.dominantShotFamily} shots; ${chapter.moodShift}; ` +
```

to:

```ts
      `- Chapter ${chapter.chapter}: leans towards ${chapter.dominantShotFamily} shots; ` +
        `${chapter.moodShift}; ` +
```

Replace the whole `planWarnings` function (and its doc comment) with:

```ts
export interface WarnableSlot {
  brief: ShotBrief
  /**
   * The chapter this slot belongs to, in the words a note should use
   * ("chapter 3"). Groups the motif count; absent, the whole list is one
   * chapter.
   */
  chapter?: string | undefined
}

/**
 * The head noun of a motif as a whole-word pattern that also takes the
 * plural (decision 260): "server racks" matches "rack" and "racks",
 * "reflections in dark glass" matches "glass" and "glasses". English noun
 * phrases are head-final, so the last word is the thing itself and the words
 * before it are modifiers a prompt may drop or vary. A heuristic, which is
 * why what it finds is a note and never a rejection.
 */
export function motifPattern(motif: string): RegExp | null {
  const words = motif.toLowerCase().match(/[a-z][a-z'-]*/g)
  const head = words ? words[words.length - 1] : undefined
  if (!head) return null
  const stem =
    head.endsWith('s') && !head.endsWith('ss') && head.length > 3 ? head.slice(0, -1) : head
  return new RegExp(`\\b${stem.replace(/[-']/g, '\\$&')}(?:s|es)?\\b`, 'i')
}

/** The words of a brief a motif could hide in. Charts, maps and headlines have none. */
function motifText(brief: ShotBrief): string | null {
  switch (brief.type) {
    case 'still':
    case 'hero':
      return `${brief.description} ${brief.prompt}`
    case 'stock':
    case 'archival':
      return `${brief.description} ${brief.query}`
    default:
      return null
  }
}

/**
 * Craft misses the model let through, in words for the plan summary. Never a
 * rejection: a same-size run is a note for the owner, not a broken slot.
 * Slots arrive in screen order. The banned list is passed in because this
 * package must not import the providers package that owns the bible; the
 * motifs are passed in because they are the film's, from its book.
 */
export function planWarnings(
  slots: readonly WarnableSlot[],
  bannedWords: readonly string[],
  motifs: readonly string[] = [],
): string[] {
  const warnings: string[] = []

  let run = 1
  for (let index = 1; index < slots.length; index += 1) {
    const size = slots[index]!.brief.shotSize
    const previous = slots[index - 1]!.brief.shotSize
    run = size !== undefined && size === previous ? run + 1 : 1
    if (run === 3) {
      warnings.push(`three adjacent slots share the size "${size}" (from slot ${index - 1})`)
    }
  }

  const seen = new Set<string>()
  for (const [index, slot] of slots.entries()) {
    const brief = slot.brief
    if (brief.type !== 'still' && brief.type !== 'hero') continue
    const prompt = brief.prompt.toLowerCase()
    for (const word of bannedWords) {
      if (!seen.has(word) && prompt.includes(word.toLowerCase())) {
        seen.add(word)
        warnings.push(`a prompt uses the banned word "${word}" (slot ${index})`)
      }
    }
  }

  // Motifs (decision 260): the floor is one per chapter and so is the
  // ceiling, so a motif in two picture briefs of one chapter is a note, and
  // so is the same motif in two slots that play back to back.
  const texts = slots.map((slot) => motifText(slot.brief))
  const groups = new Map<string, string[]>()
  for (const [index, slot] of slots.entries()) {
    const text = texts[index]
    if (text === null || text === undefined) continue
    const key = slot.chapter ?? ''
    groups.set(key, [...(groups.get(key) ?? []), text])
  }
  for (const motif of motifs) {
    const pattern = motifPattern(motif)
    if (!pattern) continue
    for (const [chapter, group] of groups) {
      const hits = group.filter((text) => pattern.test(text)).length
      if (hits > 1) {
        warnings.push(
          `motif "${motif}" appears in ${hits} of ${group.length} picture briefs` +
            (chapter === '' ? '' : ` in ${chapter}`),
        )
      }
    }
    for (let index = 1; index < texts.length; index += 1) {
      const previous = texts[index - 1]
      const current = texts[index]
      if (
        previous !== null &&
        previous !== undefined &&
        current !== null &&
        current !== undefined &&
        pattern.test(previous) &&
        pattern.test(current)
      ) {
        warnings.push(`motif "${motif}" appears in two adjacent slots (from slot ${index - 1})`)
        break
      }
    }
  }

  return warnings
}
```

- [ ] **Step 4: Run the schemas tests to verify they pass**

Run: `pnpm --filter @boom-busters/schemas test`
Expected: PASS.

- [ ] **Step 5: Pass the chapter and the motifs from the three callers**

In `apps/web/inngest/functions/visuals-runner.ts`, replace lines 226-231:

```ts
    // Craft misses the model let through (decision 252): notes for the plan
    // screen, never rejections.
    const warnings = planWarnings(
      allRows.map((row) => ({ brief: row.brief })),
      BANNED_PROMPT_WORDS,
    )
```

with:

```ts
    // Craft misses the model let through (decision 252): notes for the plan
    // screen, never rejections. The motif count is per chapter (decision 260).
    const chapterLabel = new Map(
      setup.chapters.map((chapter, index) => [chapter.id, `chapter ${index + 1}`]),
    )
    const warnings = planWarnings(
      allRows.map((row) => ({ brief: row.brief, chapter: chapterLabel.get(row.chapterId) })),
      BANNED_PROMPT_WORDS,
      direction.book.motifs,
    )
```

In `apps/web/inngest/functions/visuals-replanner.ts`, replace lines 185-188:

```ts
      const warnings = planWarnings(
        rows.map((row) => ({ brief: row.brief })),
        BANNED_PROMPT_WORDS,
      )
```

with:

```ts
      const chapterLabel = new Map(
        setup.chapters.map((chapter, index) => [chapter.id, `chapter ${index + 1}`]),
      )
      const warnings = planWarnings(
        rows.map((row) => ({ brief: row.brief, chapter: chapterLabel.get(row.chapterId) })),
        BANNED_PROMPT_WORDS,
        setup.direction?.motifs ?? [],
      )
```

In `apps/web/lib/visuals-review.ts`, inside `visualsReviewModel`, insert before the `return {` statement:

```ts
  const direction = ((): DirectorsBook | null => {
    const parsed = DirectorsBookSchema.safeParse(project?.direction)
    return parsed.success ? parsed.data : null
  })()
```

and in the returned object replace the `direction:` entry and the `warnings:` entry (lines 416-430) with:

```ts
    direction,
    // Craft notes (decision 252), in screen order; never a blocker. Motif
    // counts per chapter (decision 260), plus any cast member the book forgot
    // (decision 253).
    warnings: [
      ...planWarnings(
        slots.flatMap((slot) =>
          slot.brief ? [{ brief: slot.brief, chapter: `chapter ${slot.chapterIndex + 1}` }] : [],
        ),
        BANNED_PROMPT_WORDS,
        direction?.motifs ?? [],
      ),
      ...castWarnings(
        direction,
        (project ? await listCastMembers(db, project.id) : []).map((member) => member.name),
      ),
    ],
```

- [ ] **Step 6: Typecheck and run the web tests**

Run: `pnpm typecheck && pnpm --filter @boom-busters/web test`
Expected: PASS. (The runner and replanner tests do not assert warning text; the review model has no unit test of its own.)

- [ ] **Step 7: Commit**

```bash
pnpm format:check && pnpm lint
git add packages/schemas/src/direction.ts packages/schemas/src/direction.test.ts apps/web/inngest/functions/visuals-runner.ts apps/web/inngest/functions/visuals-replanner.ts apps/web/lib/visuals-review.ts
git commit -m "feat(plan): count each motif per chapter as a craft note, and read a family as a lean (decision 260)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Record decision 260

**Files:**

- Modify: `PROGRESS.md` (after entry 43, which ends at line 4903 with `edge was silently swallowing "Operating margin" down to "Operating".`)
- Modify: `docs/03-build-spec.md:185` (append to the decision 259 amendment of section 7.4)

- [ ] **Step 1: Add PROGRESS.md entry 44**

Insert after entry 43's last line, separated by a blank line:

```markdown
44. **A frame shows what its sentence says; motifs are a detail, not the
    subject** (decision 260; 2026-09-18, owner: "the Director's Book is
    sticking too strongly with the motifs and elements ... what would have
    been better is to have looked at the narration text and created a shot
    that actually captures what the narrator just said").

    The cause was in the fixed bible, not the per-film book. "What a still
    prompt must contain" required three physical facts in every prompt, the
    third being "one motif from the director's book", so every AI still was
    required to carry a motif: a chapter with twelve stills got twelve empty
    chairs. The chapter rule ("each chapter shows at least one") was a floor
    with no ceiling, and the per-still rule made the floor irrelevant. Three
    things compounded it: nothing tied the picture to the sentence
    (`coversText` had to quote it, nothing had to show it); the book prompt
    asked for three motifs with no guidance on choosing them, so the model
    restated the house look; and the redirect fallback named "the empty
    chair" as its first example.

    Five changes, all prompt craft, no model call added. The bible's shot
    grammar opens with "the sentence decides the frame" (a viewer with the
    sound off should be able to guess the sentence); motifs keep the floor
    and gain a ceiling (each at most once per chapter, never adjacent, never
    the subject unless the sentence is about it); the third physical fact is
    a detail drawn from the sentence, with a motif allowed to stand in once
    per chapter. The shot-list prompt carries the same rule first in its
    planning rules, in numbers. The book prompt says motifs are this story's
    own objects from the claims, never the house furniture. A chapter's
    dominant family renders as "leans towards", so it is not read as the only
    family. And `planWarnings` counts motifs per chapter by head noun (the
    last word, plural stripped: "server racks" matches "rack"), warning when
    one appears in more than one picture brief of a chapter or in adjacent
    slots. A note, never a rejection: the match is a heuristic. The markdown
    bible is now re-embedded by `pnpm --filter @boom-busters/providers
    embed:craft` rather than by hand.
```

- [ ] **Step 2: Amend build spec section 7.4**

In `docs/03-build-spec.md` line 185, directly after the decision 259 amendment, which ends `since with two scales the extremes otherwise land beside the wrong line.)*`, append (same line, one space before):

```markdown
*(Amended 2026-09-18, decision 260: the House Visual Bible opens its shot grammar with "the sentence decides the frame", caps each motif at once per chapter and makes the third physical fact of a still a detail from the sentence rather than a motif; the shot-list and book prompts carry the same rules; `planWarnings` takes the book's motifs and per-slot chapter labels and notes a motif that appears twice in a chapter or in adjacent slots.)*
```

- [ ] **Step 3: Format check and commit**

```bash
pnpm format:check
git add PROGRESS.md docs/03-build-spec.md
git commit -m "docs: record decision 260

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Design 2: reuse a shot (decision 261)

### Task 6: The link column, `reusedFrom`, and a fetch guard that skips a linked slot

**Files:**

- Modify: `packages/db/src/schema.ts:4-16` (import `AnyPgColumn`) and `:566-615` (`shotSlots`)
- Create: `packages/db/drizzle/0025_*.sql` via `pnpm db:generate`
- Modify: `packages/schemas/src/visuals.ts` (`SlotCandidateSchema` after `assetId`, and a new `REUSABLE_SLOT_TYPES` beside `ShotSlotTypeSchema`)
- Modify: `packages/db/src/visuals.ts:44-51` (`slotNeedsResolution`)
- Test: `packages/schemas/src/visuals.test.ts`, `packages/db/src/visuals.test.ts`

**Interfaces:**

- Produces:
  - `shotSlots.reuseOfSlotId: string | null` on `ShotSlotRow`
  - `SlotCandidateSchema.reusedFrom?: { slotId: Ulid; depicts?: string[] }`
  - `export const REUSABLE_SLOT_TYPES: readonly ShotSlotType[]` (`['stock', 'still', 'archival']`) in `@boom-busters/schemas`
  - `slotNeedsResolution` accepts `reuseOfSlotId?: string | null | undefined` and returns false when it is set

- [ ] **Step 1: Write the failing tests**

In `packages/schemas/src/visuals.test.ts`, inside `describe('SlotCandidateSchema', ...)` add:

```ts
  it('carries where a copy came from, and is fine without it (decision 261)', () => {
    const candidate = {
      id: '123456',
      provider: 'pexels',
      kind: 'image',
      sourceUrl: 'https://images.pexels.com/photos/123456/office.jpeg',
      licence: 'Pexels License',
    }
    expect(SlotCandidateSchema.parse(candidate).reusedFrom).toBeUndefined()
    expect(
      SlotCandidateSchema.parse({
        ...candidate,
        reusedFrom: { slotId: '01J000000000000000000000AA', depicts: ['Markus Braun'] },
      }).reusedFrom,
    ).toEqual({ slotId: '01J000000000000000000000AA', depicts: ['Markus Braun'] })
    expect(() =>
      SlotCandidateSchema.parse({ ...candidate, reusedFrom: { slotId: 'nope' } }),
    ).toThrow()
  })
```

and at the end of the file:

```ts
describe('REUSABLE_SLOT_TYPES', () => {
  it('is pictures, never data (decision 261)', () => {
    expect(REUSABLE_SLOT_TYPES).toEqual(['stock', 'still', 'archival'])
  })
})
```

adding `REUSABLE_SLOT_TYPES` to the file's import from `'./visuals'`.

In `packages/db/src/visuals.test.ts`, inside `describe('slotNeedsResolution', ...)` add:

```ts
  it('owes nothing to a linked slot, whatever its status or hash (decision 261)', () => {
    expect(
      slotNeedsResolution({
        status: 'unresolved',
        brief,
        resolvedBriefHash: null,
        reuseOfSlotId: '01J000000000000000000000AA',
      }),
    ).toBe(false)
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @boom-busters/schemas exec vitest run src/visuals.test.ts && pnpm --filter @boom-busters/db exec vitest run src/visuals.test.ts`
Expected: FAIL (import error for `REUSABLE_SLOT_TYPES`; a type error or `true` for the linked slot).

- [ ] **Step 3: The schema, the column and the guard**

In `packages/schemas/src/visuals.ts`, directly after the `export type ShotSlotType = ...` line (search for `ShotSlotTypeSchema`), add:

```ts
/** The slot types that may reuse a shot or be reused (decision 261): pictures, never data. */
export const REUSABLE_SLOT_TYPES: readonly ShotSlotType[] = ['stock', 'still', 'archival']
```

In `SlotCandidateSchema`, after the `assetId: UlidSchema.optional(),` line, add:

```ts
  /**
   * Where a copied candidate came from (decision 261): the slot whose shot
   * this one reuses, and the people that shot depicts, so the altered-content
   * label still counts a likeness that was reused into a stock slot.
   */
  reusedFrom: z
    .object({ slotId: UlidSchema, depicts: z.array(z.string().min(1)).optional() })
    .optional(),
```

In `packages/db/src/schema.ts`, add `type AnyPgColumn,` to the `drizzle-orm/pg-core` import list (line 4-16), and in `shotSlots` after the `refusal` column add:

```ts
    /**
     * The slot whose shot this one shows instead of fetching its own
     * (decision 261). Set by the board's "Use an existing shot"; the copy
     * lands in `candidates` when the source has one, so every reader of
     * candidates stays as it is. Nulled if the source row goes.
     */
    reuseOfSlotId: text('reuse_of_slot_id').references((): AnyPgColumn => shotSlots.id, {
      onDelete: 'set null',
    }),
```

In `packages/db/src/visuals.ts` replace `slotNeedsResolution`:

```ts
/**
 * Whether a fetch pass owes this slot work: not resolved, or resolved for an
 * older brief. A linked slot (decision 261) shows another slot's shot and is
 * never owed one, whatever its status or hash say.
 */
export function slotNeedsResolution(slot: {
  status: ShotSlotStatus
  brief: unknown
  resolvedBriefHash: string | null
  reuseOfSlotId?: string | null | undefined
}): boolean {
  if (slot.reuseOfSlotId) return false
  return slot.status !== 'resolved' || slot.resolvedBriefHash !== shotBriefHash(slot.brief)
}
```

- [ ] **Step 4: Generate and apply the migration**

Run: `pnpm db:generate`
Expected: a new file `packages/db/drizzle/0025_<name>.sql` containing exactly:

```sql
ALTER TABLE "shot_slots" ADD COLUMN "reuse_of_slot_id" text;--> statement-breakpoint
ALTER TABLE "shot_slots" ADD CONSTRAINT "shot_slots_reuse_of_slot_id_shot_slots_id_fk" FOREIGN KEY ("reuse_of_slot_id") REFERENCES "public"."shot_slots"("id") ON DELETE set null ON UPDATE no action;
```

(and the matching `packages/db/drizzle/meta/` snapshot and journal entries). If the SQL differs in anything but the constraint's name, the schema edit is wrong; fix it before going on.

Then, with Docker Desktop running: `pnpm db:migrate:test`
Expected: "Migrations applied." Production applies the same file at the next Vercel build (`apps/web` builds with `node ../../scripts/deploy-migrate.mjs && next build`).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm typecheck && pnpm --filter @boom-busters/schemas test && pnpm --filter @boom-busters/db test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
pnpm format:check && pnpm lint
git add packages/db/src/schema.ts packages/db/drizzle packages/schemas/src/visuals.ts packages/schemas/src/visuals.test.ts packages/db/src/visuals.ts packages/db/src/visuals.test.ts
git commit -m "feat(db): a slot may point at another slot's shot (decision 261)

reuse_of_slot_id on shot_slots, reusedFrom on a copied candidate, and the
no-waste guard never owes a linked slot a fetch.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The writes: link, copy on resolve, unlink, and a brief edit that keeps a linked slot's status

**Files:**

- Modify: `packages/db/src/visuals.ts` (`updateSlotBrief` at lines 124-139; new functions after `chooseSlotCandidate`, before the `// Assets` banner)
- Test: `packages/db/src/visuals.integration.test.ts`

**Interfaces:**

- Produces:
  - `export interface LinkOutcome { copied: boolean }`
  - `export async function linkSlotReuse(db, slotId: string, sourceId: string, candidateId?: string): Promise<LinkOutcome | null>` (null: slot, source or named candidate missing)
  - `export async function copyReusedShots(db, projectId: string): Promise<{ copied: number; placeholders: number }>`
  - `export async function unlinkSlotReuse(db, slotId: string): Promise<void>`
  - `updateSlotBrief` keeps `status` when `reuse_of_slot_id` is set

- [ ] **Step 1: Write the failing tests**

In `packages/db/src/visuals.integration.test.ts`, extend the import from `'./visuals'` with `copyReusedShots, linkSlotReuse, shotBriefHash, slotNeedsResolution, unlinkSlotReuse`, and add inside `suite('shot slots', ...)`, after the existing tests:

```ts
  describe('reusing a shot (decision 261)', () => {
    const stillBrief: ShotBrief = {
      type: 'still',
      coversText: 'Braun stood at the podium.',
      description: 'A podium, one light.',
      motion: { kind: 'static' },
      transition: 'cut',
      prompt: 'Markus Braun at a podium, 35mm.',
      depicts: ['Markus Braun'],
    }

    async function twoSlots() {
      await replaceShotList(db, projectId, slots())
      const [source, dependant] = await listShotSlots(db, projectId)
      return { source: source!, dependant: dependant! }
    }

    it('links before Fetch, and the fetch guard owes the linked slot nothing', async () => {
      const { source, dependant } = await twoSlots()
      expect(await linkSlotReuse(db, dependant.id, source.id)).toEqual({ copied: false })
      const linked = (await getShotSlot(db, dependant.id))!
      expect(linked.reuseOfSlotId).toBe(source.id)
      expect(linked.status).toBe('unresolved')
      expect(linked.candidates).toEqual([])
      expect(slotNeedsResolution(linked)).toBe(false)
    })

    it('copies the source’s chosen shot after the pass, once, pointing at its asset', async () => {
      const { source, dependant } = await twoSlots()
      await linkSlotReuse(db, dependant.id, source.id)
      const asset = await upsertAssetByHash(db, {
        kind: 'image',
        r2Key: 'boom-busters/stills/p1.png',
        licence: 'Generated',
        contentHash: 'c'.repeat(64),
      })
      await setSlotResolution(db, source.id, {
        candidates: [
          candidate('p1', { chosen: true, assetId: asset.id, score: 91, scoreReason: 'fits' }),
          candidate('p2'),
        ],
        status: 'resolved',
        chosenAssetId: asset.id,
      })

      expect(await copyReusedShots(db, projectId)).toEqual({ copied: 1, placeholders: 0 })
      const after = (await getShotSlot(db, dependant.id))!
      expect(after.status).toBe('resolved')
      expect(after.chosenAssetId).toBe(asset.id)
      expect(after.resolvedBriefHash).toBe(shotBriefHash(after.brief))
      const [copy, ...rest] = after.candidates as unknown as SlotCandidate[]
      expect(rest).toEqual([])
      expect(copy).toMatchObject({
        id: 'p1',
        chosen: true,
        assetId: asset.id,
        reusedFrom: { slotId: source.id },
      })
      // The score was against the source's brief, so it does not travel.
      expect(copy?.score).toBeUndefined()
      // Idempotent: a second pass leaves the copy alone.
      expect(await copyReusedShots(db, projectId)).toEqual({ copied: 0, placeholders: 0 })
    })

    it('carries who a reused still depicts, for the altered-content label', async () => {
      const { source, dependant } = await twoSlots()
      await retypeShotSlot(db, source.id, 'still', stillBrief)
      await setSlotResolution(db, source.id, {
        candidates: [candidate('g1', { provider: 'google', chosen: true })],
        status: 'resolved',
      })
      expect(await linkSlotReuse(db, dependant.id, source.id, 'g1')).toEqual({ copied: true })
      const [copy] = (await getShotSlot(db, dependant.id))!.candidates as unknown as SlotCandidate[]
      expect(copy?.reusedFrom).toEqual({ slotId: source.id, depicts: ['Markus Braun'] })
    })

    it('leaves a dependant a placeholder when its source has nothing chosen', async () => {
      const { source, dependant } = await twoSlots()
      await linkSlotReuse(db, dependant.id, source.id)
      await setSlotResolution(db, source.id, { candidates: [], status: 'placeholder' })
      expect(await copyReusedShots(db, projectId)).toEqual({ copied: 0, placeholders: 1 })
      expect((await getShotSlot(db, dependant.id))?.status).toBe('placeholder')
    })

    it('copies at once when a candidate is named, and refuses one the source does not hold', async () => {
      const { source, dependant } = await twoSlots()
      await setSlotResolution(db, source.id, {
        candidates: [candidate('p1', { chosen: true }), candidate('p2')],
        status: 'resolved',
      })
      expect(await linkSlotReuse(db, dependant.id, source.id, 'nope')).toBeNull()
      expect(await linkSlotReuse(db, dependant.id, source.id, 'p2')).toEqual({ copied: true })
      const after = (await getShotSlot(db, dependant.id))!
      expect(after.status).toBe('resolved')
      expect((after.candidates as unknown as SlotCandidate[])[0]).toMatchObject({
        id: 'p2',
        chosen: true,
        reusedFrom: { slotId: source.id },
      })
    })

    it('a brief edit keeps a linked slot resolved, and still re-opens an ordinary one', async () => {
      const { source, dependant } = await twoSlots()
      await setSlotResolution(db, source.id, {
        candidates: [candidate('p1', { chosen: true })],
        status: 'resolved',
      })
      await linkSlotReuse(db, dependant.id, source.id, 'p1')
      await updateSlotBrief(db, dependant.id, { ...stockBrief, description: 'new words' })
      await updateSlotBrief(db, source.id, { ...stockBrief, description: 'new words' })
      expect((await getShotSlot(db, dependant.id))?.status).toBe('resolved')
      expect((await getShotSlot(db, source.id))?.status).toBe('unresolved')
    })

    it('unlinking gives the slot its own fetch back', async () => {
      const { source, dependant } = await twoSlots()
      await setSlotResolution(db, source.id, {
        candidates: [candidate('p1', { chosen: true })],
        status: 'resolved',
      })
      await linkSlotReuse(db, dependant.id, source.id, 'p1')
      await unlinkSlotReuse(db, dependant.id)
      const after = (await getShotSlot(db, dependant.id))!
      expect(after).toMatchObject({
        reuseOfSlotId: null,
        status: 'unresolved',
        chosenAssetId: null,
        resolvedBriefHash: null,
        candidates: [],
      })
      expect(slotNeedsResolution(after)).toBe(true)
    })
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @boom-busters/db exec vitest run src/visuals.integration.test.ts`
Expected: FAIL with import errors for the new functions (Docker Desktop running; otherwise the suite skips, which is not a pass).

- [ ] **Step 3: Implement the writes**

In `packages/db/src/visuals.ts`, add `REUSABLE_SLOT_TYPES` is NOT needed here; keep the import list as is. Replace `updateSlotBrief`'s doc comment and `status` line:

```ts
/**
 * A brief edit re-opens the slot: whatever was fetched was fetched for the
 * OLD brief, so the status drops back to `unresolved` until a re-fetch
 * resolves it again. The stale candidates stay visible in the meantime (a
 * board that blanks while re-fetching reads as data loss). A linked slot
 * keeps its status (decision 261): the words changed, the picture is another
 * slot's and did not.
 */
export async function updateSlotBrief(
  db: Database,
  slotId: string,
  brief: ShotBrief,
): Promise<void> {
  await db
    .update(shotSlots)
    .set({
      brief: brief as unknown as Record<string, unknown>,
      status: sql`CASE WHEN ${shotSlots.reuseOfSlotId} IS NULL THEN 'unresolved' ELSE ${shotSlots.status} END`,
      // A new brief is a new question; an old refusal no longer applies.
      refusal: null,
      updatedAt: sql`now()`,
    })
    .where(eq(shotSlots.id, slotId))
}
```

After `chooseSlotCandidate` and before the `// Assets` banner, add:

```ts
// ---------------------------------------------------------------------------
// Reusing a shot (decision 261)
// ---------------------------------------------------------------------------

/**
 * The copy a dependant holds: the source's candidate, chosen, stamped with
 * where it came from and who it depicts. Its id is kept, so the strip and the
 * lightbox treat it like any other candidate; its score is dropped, because
 * it was judged against the source's brief, not this one's.
 */
function reusedCandidate(source: ShotSlotRow, candidate: SlotCandidate): SlotCandidate {
  const brief = source.brief as { type?: string; depicts?: string[] }
  const depicts =
    (brief.type === 'still' || brief.type === 'hero') && brief.depicts && brief.depicts.length > 0
      ? brief.depicts
      : undefined
  const { chosen: _chosen, score: _score, scoreReason: _reason, ...rest } = candidate
  return {
    ...rest,
    chosen: true,
    reusedFrom: { slotId: source.id, ...(depicts ? { depicts } : {}) },
  }
}

export interface LinkOutcome {
  copied: boolean
}

/**
 * Point a slot at another slot's shot. When `candidateId` names a candidate
 * the source holds, it is copied now and the slot is resolved for its own
 * brief; otherwise the link alone is recorded and `copyReusedShots` fills it
 * after the fetch pass. Callers check the rules (types, chains, same project)
 * first; this only writes. Null when the slot, the source or the named
 * candidate no longer exists.
 */
export async function linkSlotReuse(
  db: Database,
  slotId: string,
  sourceId: string,
  candidateId?: string,
): Promise<LinkOutcome | null> {
  const [slot, source] = await Promise.all([getShotSlot(db, slotId), getShotSlot(db, sourceId)])
  if (!slot || !source) return null
  const held = source.candidates as unknown as SlotCandidate[]
  const picked =
    candidateId === undefined ? undefined : held.find((candidate) => candidate.id === candidateId)
  if (candidateId !== undefined && !picked) return null

  await db
    .update(shotSlots)
    .set({
      reuseOfSlotId: sourceId,
      ...(picked
        ? {
            candidates: [reusedCandidate(source, picked)] as unknown as Record<string, unknown>[],
            status: 'resolved' as const,
            chosenAssetId: picked.assetId ?? null,
            resolvedBriefHash: shotBriefHash(slot.brief),
          }
        : {
            candidates: [] as unknown as Record<string, unknown>[],
            status: 'unresolved' as const,
            chosenAssetId: null,
            resolvedBriefHash: null,
          }),
      refusal: null,
      updatedAt: sql`now()`,
    })
    .where(eq(shotSlots.id, slotId))

  return { copied: picked !== undefined }
}

/**
 * After the fetch pass: every linked slot that holds no copy yet takes its
 * source's chosen candidate, or becomes a placeholder when the source has
 * none. Idempotent: a dependant already copied from its source is left
 * alone, so a re-run of the pass never overwrites a choice made since.
 */
export async function copyReusedShots(
  db: Database,
  projectId: string,
): Promise<{ copied: number; placeholders: number }> {
  const rows = await db.select().from(shotSlots).where(eq(shotSlots.projectId, projectId))
  const byId = new Map(rows.map((row) => [row.id, row]))
  let copied = 0
  let placeholders = 0

  for (const row of rows) {
    if (!row.reuseOfSlotId) continue
    const held = row.candidates as unknown as SlotCandidate[]
    if (held.some((candidate) => candidate.reusedFrom?.slotId === row.reuseOfSlotId)) continue

    const source = byId.get(row.reuseOfSlotId)
    const chosen = source
      ? (source.candidates as unknown as SlotCandidate[]).find((candidate) => candidate.chosen)
      : undefined

    if (source && chosen) {
      await db
        .update(shotSlots)
        .set({
          candidates: [reusedCandidate(source, chosen)] as unknown as Record<string, unknown>[],
          status: 'resolved',
          chosenAssetId: chosen.assetId ?? null,
          resolvedBriefHash: shotBriefHash(row.brief),
          updatedAt: sql`now()`,
        })
        .where(eq(shotSlots.id, row.id))
      copied += 1
    } else {
      await db
        .update(shotSlots)
        .set({
          candidates: [] as unknown as Record<string, unknown>[],
          status: 'placeholder',
          chosenAssetId: null,
          resolvedBriefHash: null,
          updatedAt: sql`now()`,
        })
        .where(eq(shotSlots.id, row.id))
      placeholders += 1
    }
  }

  return { copied, placeholders }
}

/**
 * Give a linked slot its own shot again: the link, the copy, the chosen
 * asset and the fingerprint all go, and the next fetch pass owes it work.
 */
export async function unlinkSlotReuse(db: Database, slotId: string): Promise<void> {
  await db
    .update(shotSlots)
    .set({
      reuseOfSlotId: null,
      candidates: [] as unknown as Record<string, unknown>[],
      status: 'unresolved',
      chosenAssetId: null,
      resolvedBriefHash: null,
      updatedAt: sql`now()`,
    })
    .where(eq(shotSlots.id, slotId))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @boom-busters/db test`
Expected: PASS, the new describe included (not skipped).

- [ ] **Step 5: Commit**

```bash
pnpm format:check && pnpm lint && pnpm typecheck
git add packages/db/src/visuals.ts packages/db/src/visuals.integration.test.ts
git commit -m "feat(db): link, copy on resolve and unlink a reused shot (decision 261)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The runner copies after the fan-out; the refetcher refuses a linked slot

**Files:**

- Modify: `apps/web/inngest/functions/visuals-runner.ts:1-17` (import) and the block between the failure-tolerance return and `enter-board-phase` (currently lines 366-370)
- Modify: `apps/web/inngest/functions/slot-refetcher.ts:65-72`
- Test: `apps/web/inngest/functions/visuals-runner.test.ts`

**Interfaces:**

- Consumes: `copyReusedShots`, `linkSlotReuse`, `getShotSlot` from `@boom-busters/db`.
- Produces: a runner step `copy-reused-shots`; the refetcher's `refetch-slot` step returns `{ status: 'skipped', candidates: 0, reused: <sourceId> }` for a linked slot.

- [ ] **Step 1: Write the failing test**

In `apps/web/inngest/functions/visuals-runner.test.ts`, extend the `@boom-busters/db` import with `getShotSlot, linkSlotReuse`, add `import type { SlotCandidate } from '@boom-busters/schemas'`, and add inside the describe:

```ts
  /**
   * Linked slots (decision 261) are excluded from the fan-out by
   * `slotNeedsResolution`, which has its own unit test; what the engine can
   * prove is that the pass then fills them. The plan-writing steps are
   * stubbed on the second execution so the link written between the two
   * survives (`replaceShotList` would otherwise wipe the board), and the
   * 30-day wait is answered.
   */
  it('copies a reused shot after the fan-out (decision 261)', async () => {
    await engine.executeStep('open-plan-park', {
      events: [{ name: 'gate/voice.approved', data: { projectId: FIXTURE_PROJECT_ID } }],
    })
    const pictures = (await listShotSlots(db, FIXTURE_PROJECT_ID)).filter(
      (slot) => slot.type === 'stock' || slot.type === 'still',
    )
    const [source, dependant] = pictures
    if (!source || !dependant) throw new Error('the mock plan should hold two picture slots')
    expect(await linkSlotReuse(db, dependant.id, source.id)).toEqual({ copied: false })

    const again = new InngestTestEngine({ function: visualsRunner })
    await again.executeStep('copy-reused-shots', {
      events: [{ name: 'gate/voice.approved', data: { projectId: FIXTURE_PROJECT_ID } }],
      steps: [
        { id: 'save-shot-list', handler: () => undefined },
        { id: 'open-plan-park', handler: () => undefined },
        {
          id: 'await-plan-approval',
          handler: () => ({
            name: 'visuals/plan.approved',
            data: { projectId: FIXTURE_PROJECT_ID },
          }),
        },
      ],
    })

    const after = await getShotSlot(db, dependant.id)
    expect(after?.status).toBe('resolved')
    expect(after?.reuseOfSlotId).toBe(source.id)
    const [copy] = (after?.candidates ?? []) as unknown as SlotCandidate[]
    expect(copy?.chosen).toBe(true)
    expect(copy?.reusedFrom?.slotId).toBe(source.id)
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @boom-busters/web exec vitest run inngest/functions/visuals-runner.test.ts`
Expected: FAIL, the engine reports no step named `copy-reused-shots` (or the dependant stays `unresolved`).

- [ ] **Step 3: Add the step and the refetcher guard**

In `apps/web/inngest/functions/visuals-runner.ts`, add `copyReusedShots,` to the `@boom-busters/db` import list. Then, after the failure-tolerance block (which ends `return { projectId, outcome: 'failed' as const, failed, total: outcomes.length }` and its closing brace) and before the `// Gate 4` banner, insert:

```ts
    // Linked slots (decision 261) skipped the fan-out; they take their
    // source's chosen shot now, or a placeholder when the source has none.
    await step.run('copy-reused-shots', () => copyReusedShots(db, projectId))

```

In `apps/web/inngest/functions/slot-refetcher.ts`, inside the `refetch-slot` step, directly after `if (!slot) throw new NonRetriableError(...)`, insert:

```ts
      // A linked slot shows another slot's shot (decision 261); a fetch for
      // it would overwrite the copy. The action refuses first; this catches
      // an event already in flight when the link was made.
      if (slot.reuseOfSlotId) {
        return { status: 'skipped' as const, candidates: 0, reused: slot.reuseOfSlotId }
      }

```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm typecheck && pnpm --filter @boom-busters/web exec vitest run inngest/functions/visuals-runner.test.ts inngest/functions/index.test.ts`
Expected: PASS. `index.test.ts` still passes because no Inngest function was added.

- [ ] **Step 5: Commit**

```bash
pnpm format:check && pnpm lint
git add apps/web/inngest/functions/visuals-runner.ts apps/web/inngest/functions/visuals-runner.test.ts apps/web/inngest/functions/slot-refetcher.ts
git commit -m "feat(runner): copy reused shots after the fan-out; a refetch skips a linked slot (decision 261)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: The actions, and the guards on everything that would fetch for a linked slot

**Files:**

- Modify: `apps/web/app/(console)/projects/[id]/visuals-actions.ts` (imports at 3-33; `editBriefAction` 112-159; `retypeSlotAction` 202-232; `rebriefSlotAction` 358-388; `refetchSlotAction` 574-600; `createOwnUploadAction` 680-702; `addSlotImageFromUrlAction` 863-892; `redirectSceneAction` 979-1005; two new actions)
- Create: `apps/web/app/(console)/projects/[id]/visuals-actions.test.ts`

**Interfaces:**

- Consumes: `linkSlotReuse`, `unlinkSlotReuse`, `getProject`, `getShotSlot` from `@boom-busters/db`; `REUSABLE_SLOT_TYPES` from `@boom-busters/schemas`; `ShotSlotRow` type from `@boom-busters/db`.
- Produces:
  - `export async function reuseSlotShotAction(projectId: string, slotId: string, sourceSlotId: string, candidateId?: string): Promise<ActionResult>`
  - `export async function unlinkSlotReuseAction(projectId: string, slotId: string): Promise<ActionResult>`
  - The refusal text on a linked slot: `This slot reuses the shot at m:ss. Choose its own shot first.`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/app/(console)/projects/[id]/visuals-actions.test.ts`:

```ts
// @vitest-environment node

import {
  createScriptVersion,
  FIXTURE_PROJECT_ID,
  getShotSlot,
  listShotSlots,
  replaceShotList,
  requireTestDatabase,
  saveChapter,
  seed,
  setSlotResolution,
  setVisualsPhase,
  shotSlots,
  slotNeedsResolution,
} from '@boom-busters/db'
import type { NewShotSlot } from '@boom-busters/db'
import type { ShotBrief, SlotCandidate } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { refetchSlotAction, reuseSlotShotAction, unlinkSlotReuseAction } from './visuals-actions'

/**
 * Reusing a shot (decision 261) against the test database, with the seams a
 * server action cannot bring to a unit test replaced: session, cache
 * revalidation, Inngest and storage.
 */

vi.mock('@/auth', () => ({ auth: async () => ({ user: { email: 'owner@example.com' } }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const inngest = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@/inngest/client', () => ({
  inngest: { send: (...args: unknown[]) => inngest.send(...args) },
}))
vi.mock('@/lib/storage', () => ({
  storageConfigured: () => false,
  deleteObject: vi.fn(),
  headObject: vi.fn(),
  presignPut: vi.fn(),
  putObject: vi.fn(),
  R2_PREFIX: 'boom-busters',
}))
vi.mock('@/lib/remote-image', () => ({ fetchRemoteImage: vi.fn() }))

const describeDb = requireTestDatabase() ? describe : describe.skip

const stock = (coversText: string, description: string): ShotBrief => ({
  type: 'stock',
  coversText,
  description,
  motion: { kind: 'static' },
  transition: 'cut',
  query: 'q',
  rejectionCriteria: [],
})
const chart: ShotBrief = {
  type: 'chart',
  coversText: 'Four.',
  description: 'a chart',
  motion: { kind: 'static' },
  transition: 'cut',
  chartKind: 'line',
  series: [
    {
      label: 'a',
      unit: 'USD',
      points: [
        { x: '2019', y: 1 },
        { x: '2020', y: 2 },
      ],
    },
  ],
  dataRefs: ['01HQ00000000000000000000AA'],
  takeaway: 't',
  reveal: 'none',
}
const candidate = (id: string, chosen = false): SlotCandidate => ({
  id,
  provider: 'pexels',
  kind: 'image',
  sourceUrl: `https://images.pexels.com/${id}.jpg`,
  licence: 'Pexels License',
  ...(chosen ? { chosen } : {}),
})

describeDb('reusing a shot (decision 261)', () => {
  let ids: { a: string; b: string; c: string; chart: string }

  beforeEach(async () => {
    vi.clearAllMocks()
    await seed(db)
    await db.delete(shotSlots)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    const chapter = await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The audit',
      contentMd: 'One.\n\nTwo.\n\nThree.\n\nFour.',
      estRuntimeSec: 30,
    })
    const rows: NewShotSlot[] = [
      { chapterId: chapter.id, index: 0, type: 'stock', brief: stock('One.', 'the lobby'), startMs: 0, durationMs: 6000 },
      { chapterId: chapter.id, index: 1, type: 'stock', brief: stock('Two.', 'the lobby again'), startMs: 6000, durationMs: 6000 },
      { chapterId: chapter.id, index: 2, type: 'stock', brief: stock('Three.', 'the car park'), startMs: 12000, durationMs: 6000 },
      { chapterId: chapter.id, index: 3, type: 'chart', brief: chart, startMs: 18000, durationMs: 6000 },
    ]
    await replaceShotList(db, FIXTURE_PROJECT_ID, rows)
    const slots = await listShotSlots(db, FIXTURE_PROJECT_ID)
    ids = { a: slots[0]!.id, b: slots[1]!.id, c: slots[2]!.id, chart: slots[3]!.id }
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'plan')
  })

  it('links in plan phase with nothing to copy, and Fetch owes the slot nothing', async () => {
    expect(await reuseSlotShotAction(FIXTURE_PROJECT_ID, ids.b, ids.a)).toEqual({ ok: true })
    const b = (await getShotSlot(db, ids.b))!
    expect(b.reuseOfSlotId).toBe(ids.a)
    expect(slotNeedsResolution(b)).toBe(false)
  })

  it('refuses a slot reusing itself, a data slot either way, and another film', async () => {
    expect(await reuseSlotShotAction(FIXTURE_PROJECT_ID, ids.a, ids.a)).toMatchObject({
      ok: false,
      error: expect.stringContaining('its own shot'),
    })
    expect(await reuseSlotShotAction(FIXTURE_PROJECT_ID, ids.chart, ids.a)).toMatchObject({
      ok: false,
      error: expect.stringContaining('Only stock, AI image and real-footage'),
    })
    expect(await reuseSlotShotAction(FIXTURE_PROJECT_ID, ids.a, ids.chart)).toMatchObject({
      ok: false,
      error: expect.stringContaining('Only stock, AI image and real-footage'),
    })
    expect(await reuseSlotShotAction('01J0000000000000000000000Z', ids.b, ids.a)).toMatchObject({
      ok: false,
      error: expect.stringContaining('same film'),
    })
  })

  it('never chains: a pick that is itself a dependant re-points to the original', async () => {
    await reuseSlotShotAction(FIXTURE_PROJECT_ID, ids.b, ids.a)
    expect(await reuseSlotShotAction(FIXTURE_PROJECT_ID, ids.c, ids.b)).toEqual({ ok: true })
    expect((await getShotSlot(db, ids.c))?.reuseOfSlotId).toBe(ids.a)
  })

  it('on the board copies the named shot at once, and refuses a source with none', async () => {
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'board')
    expect(await reuseSlotShotAction(FIXTURE_PROJECT_ID, ids.b, ids.a)).toMatchObject({
      ok: false,
      error: expect.stringContaining('no shot to reuse yet'),
    })
    await setSlotResolution(db, ids.a, {
      candidates: [candidate('p1', true), candidate('p2')],
      status: 'resolved',
    })
    expect(await reuseSlotShotAction(FIXTURE_PROJECT_ID, ids.b, ids.a, 'p2')).toEqual({ ok: true })
    const b = (await getShotSlot(db, ids.b))!
    expect(b.status).toBe('resolved')
    expect((b.candidates as unknown as SlotCandidate[])[0]).toMatchObject({
      id: 'p2',
      chosen: true,
      reusedFrom: { slotId: ids.a },
    })
  })

  it('refuses to fetch for a linked slot, naming where its shot plays', async () => {
    await reuseSlotShotAction(FIXTURE_PROJECT_ID, ids.b, ids.a)
    expect(await refetchSlotAction(FIXTURE_PROJECT_ID, ids.b, 'Regenerate')).toEqual({
      ok: false,
      error: 'This slot reuses the shot at 0:00. Choose its own shot first.',
    })
    expect(inngest.send).not.toHaveBeenCalled()
  })

  it('gives a slot its own shot back', async () => {
    await reuseSlotShotAction(FIXTURE_PROJECT_ID, ids.b, ids.a)
    expect(await unlinkSlotReuseAction(FIXTURE_PROJECT_ID, ids.b)).toEqual({ ok: true })
    const b = (await getShotSlot(db, ids.b))!
    expect(b.reuseOfSlotId).toBeNull()
    expect(slotNeedsResolution(b)).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @boom-busters/web exec vitest run "app/(console)/projects/\[id\]/visuals-actions.test.ts"`
Expected: FAIL, `reuseSlotShotAction` is not exported.

- [ ] **Step 3: Implement the actions and the guards**

In `apps/web/app/(console)/projects/[id]/visuals-actions.ts`:

Add `linkSlotReuse,` and `unlinkSlotReuse,` to the `@boom-busters/db` import list, `import type { ShotSlotRow } from '@boom-busters/db'`, and `REUSABLE_SLOT_TYPES,` to the `@boom-busters/schemas` import list.

After `function refresh(projectId: string): void { ... }` add:

```ts
/** m:ss for a refusal that names where a shot plays. The board's own `timecode`, repeated here because a server module cannot import a client component. */
function mmss(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`
}

/**
 * The refusal every fetch-shaped action gives a linked slot (decision 261).
 * The board hides those buttons; this is for a screen that went stale.
 */
async function linkedSlotRefusal(slot: ShotSlotRow): Promise<ActionResult | null> {
  if (!slot.reuseOfSlotId) return null
  const source = await getShotSlot(db, slot.reuseOfSlotId)
  const at = source ? ` at ${mmss(source.startMs)}` : ''
  return { ok: false, error: `This slot reuses the shot${at}. Choose its own shot first.` }
}

/**
 * The rules of a reuse link (decision 261), in one place: the slot and the
 * shot it picked, or the refusal. A pick that is itself a dependant
 * re-points to the original, so the chip always names the shot that was
 * paid for and no chain can form.
 */
async function reuseSource(
  projectId: string,
  slotId: string,
  sourceSlotId: string,
): Promise<{ slot: ShotSlotRow; source: ShotSlotRow } | { error: string }> {
  if (slotId === sourceSlotId) return { error: 'A slot cannot reuse its own shot.' }
  const [slot, picked] = await Promise.all([getShotSlot(db, slotId), getShotSlot(db, sourceSlotId)])
  if (!slot) return { error: 'This slot no longer exists.' }
  if (!picked) return { error: 'The shot you picked no longer exists.' }
  if (slot.projectId !== projectId || picked.projectId !== projectId) {
    return { error: 'Shots can only be reused within the same film.' }
  }
  if (!REUSABLE_SLOT_TYPES.includes(slot.type) || !REUSABLE_SLOT_TYPES.includes(picked.type)) {
    return {
      error: 'Only stock, AI image and real-footage slots can reuse a shot or be reused.',
    }
  }
  const source = picked.reuseOfSlotId ? await getShotSlot(db, picked.reuseOfSlotId) : picked
  if (!source) return { error: 'The shot you picked no longer exists.' }
  if (source.id === slotId) return { error: 'A slot cannot reuse its own shot.' }
  return { slot, source }
}

/**
 * "Use an existing shot" (decision 261). Before Fetch the link is recorded
 * and the fan-out's copy step fills it; on the board the named candidate,
 * or the source's chosen one, is copied at once. A board-phase source with
 * nothing to copy is not offered by the picker; a stale screen that asks
 * anyway gets words, not a link nothing will fill.
 */
export async function reuseSlotShotAction(
  projectId: string,
  slotId: string,
  sourceSlotId: string,
  candidateId?: string,
): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(projectId, slotId, sourceSlotId)
  if (invalid) return invalid

  const checked = await reuseSource(projectId, slotId, sourceSlotId)
  if ('error' in checked) return { ok: false, error: checked.error }

  const held = checked.source.candidates as unknown as SlotCandidate[]
  const chosen = candidateId ?? held.find((candidate) => candidate.chosen)?.id
  const project = await getProject(db, projectId)
  if (project?.visualsPhase === 'board' && chosen === undefined) {
    return {
      ok: false,
      error: 'That slot has no shot to reuse yet. Fetch or regenerate it first.',
    }
  }

  const linked = await linkSlotReuse(db, slotId, checked.source.id, chosen)
  if (!linked) return { ok: false, error: 'The shot you picked no longer exists.' }
  refresh(projectId)
  return { ok: true }
}

/** "Choose its own shot": the link goes and the next fetch pass owes the slot work again. */
export async function unlinkSlotReuseAction(
  projectId: string,
  slotId: string,
): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(projectId, slotId)
  if (invalid) return invalid

  const slot = await getShotSlot(db, slotId)
  if (!slot) return { ok: false, error: 'This slot no longer exists.' }
  if (!slot.reuseOfSlotId) return { ok: true }

  await unlinkSlotReuse(db, slotId)
  refresh(projectId)
  return { ok: true }
}
```

Then the guards, each inserted directly after the action's `if (!slot) return { ok: false, error: 'This slot no longer exists.' }` line:

- `retypeSlotAction`, `rebriefSlotAction`, `refetchSlotAction`, `redirectSceneAction`, `createOwnUploadAction` and `addSlotImageFromUrlAction`:

```ts
  const linked = await linkedSlotRefusal(slot)
  if (linked) return linked
```

- `editBriefAction` keeps working on a linked slot, but must not send a refetch for it. Change its phase condition from:

```ts
  if (project?.visualsPhase !== 'board' || merged.data.type === 'archival') {
```

to:

```ts
  // A linked slot's picture is another slot's (decision 261): its words save
  // and nothing is fetched, in either phase.
  if (project?.visualsPhase !== 'board' || merged.data.type === 'archival' || slot.reuseOfSlotId) {
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm typecheck && pnpm --filter @boom-busters/web exec vitest run "app/(console)/projects/\[id\]/visuals-actions.test.ts"`
Expected: PASS, not skipped.

- [ ] **Step 5: Commit**

```bash
pnpm format:check && pnpm lint
git add "apps/web/app/(console)/projects/[id]/visuals-actions.ts" "apps/web/app/(console)/projects/[id]/visuals-actions.test.ts"
git commit -m "feat(board): actions to reuse a shot and to take it back, with guards on every fetch (decision 261)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: The review model: `reuse`, `reusedBy` and the spacing warning

**Files:**

- Create: `apps/web/lib/visuals-reuse.ts`
- Create: `apps/web/lib/visuals-reuse.test.ts`
- Modify: `apps/web/lib/visuals-review.ts` (`SlotView` at 56-91; the builder at 313-354 and the `warnings` array)
- Modify: `apps/web/app/(console)/projects/[id]/visual-board.test.tsx:84-98` (the `stockSlot` fixture gains two fields; the literals at 160, 189 and 230 that do not spread it gain them too)

**Interfaces:**

- Produces, in `apps/web/lib/visuals-reuse.ts`:
  - `export const CLOSE_REUSE_MS = 60_000`
  - `export interface ReuseSource { sourceSlotId: string; chapterIndex: number; startMs: number; sourceStatus: ShotSlotStatus }`
  - `export interface ReusableRow { id: string; chapterIndex: number; startMs: number; status: ShotSlotStatus; reuseOfSlotId: string | null; candidates: readonly SlotCandidate[] }`
  - `export function reuseView(row: ReusableRow, rows: readonly ReusableRow[]): ReuseSource | null`
  - `export function reusedByCount(row: ReusableRow, rows: readonly ReusableRow[]): number`
  - `export function sharedShotWarnings(rows: readonly ReusableRow[]): string[]`
  - `export function timecode(ms: number): string` and `export function describeGap(fromMs: number, toMs: number): string`
- Produces, on `SlotView`: `reuse: ReuseSource | null` and `reusedBy: number`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/visuals-reuse.test.ts`:

```ts
import type { SlotCandidate } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import {
  describeGap,
  reusedByCount,
  reuseView,
  sharedShotWarnings,
  timecode,
  type ReusableRow,
} from './visuals-reuse'

/**
 * The pure half of shot reuse (decision 261): what a card says about its
 * link, and the note when one picture plays twice too close.
 */

const candidate = (id: string, extra: Partial<SlotCandidate> = {}): SlotCandidate => ({
  id,
  provider: 'pexels',
  kind: 'image',
  sourceUrl: `https://images.pexels.com/${id}.jpg`,
  licence: 'Pexels License',
  ...extra,
})

const row = (id: string, startMs: number, extra: Partial<ReusableRow> = {}): ReusableRow => ({
  id,
  chapterIndex: 0,
  startMs,
  status: 'resolved',
  reuseOfSlotId: null,
  candidates: [],
  ...extra,
})

describe('reuseView', () => {
  it('names the source from the column, with its place and status', () => {
    const source = row('A', 0, { chapterIndex: 1, status: 'placeholder' })
    const dependant = row('B', 12_000, { reuseOfSlotId: 'A' })
    expect(reuseView(dependant, [source, dependant])).toEqual({
      sourceSlotId: 'A',
      chapterIndex: 1,
      startMs: 0,
      sourceStatus: 'placeholder',
    })
  })

  it('is null for a slot with its own shot, and for a source that no longer exists', () => {
    expect(reuseView(row('A', 0), [row('A', 0)])).toBeNull()
    expect(reuseView(row('B', 0, { reuseOfSlotId: 'gone' }), [row('B', 0)])).toBeNull()
  })
})

describe('reusedByCount', () => {
  it('counts the slots that show this slot’s shot', () => {
    const rows = [row('A', 0), row('B', 0, { reuseOfSlotId: 'A' }), row('C', 0, { reuseOfSlotId: 'A' })]
    expect(reusedByCount(rows[0]!, rows)).toBe(2)
    expect(reusedByCount(rows[1]!, rows)).toBe(0)
  })
})

describe('sharedShotWarnings', () => {
  it('notes the same picture chosen twice within a minute, by asset or by provider id', () => {
    const rows = [
      row('A', 0, { candidates: [candidate('p1', { chosen: true })] }),
      row('B', 40_000, { candidates: [candidate('p1', { chosen: true })] }),
      row('C', 100_000, { candidates: [candidate('g1', { chosen: true, assetId: '01J000000000000000000000AA' })] }),
      row('D', 150_000, { candidates: [candidate('g9', { chosen: true, assetId: '01J000000000000000000000AA' })] }),
    ]
    expect(sharedShotWarnings(rows)).toEqual([
      'the same shot plays at 0:00 and 0:40, under a minute apart',
      'the same shot plays at 1:40 and 2:30, under a minute apart',
    ])
  })

  it('is silent past a minute, for different pictures, and for slots with nothing chosen', () => {
    expect(
      sharedShotWarnings([
        row('A', 0, { candidates: [candidate('p1', { chosen: true })] }),
        row('B', 61_000, { candidates: [candidate('p1', { chosen: true })] }),
        row('C', 5_000, { candidates: [candidate('p2', { chosen: true })] }),
        row('D', 6_000, { candidates: [candidate('p1')] }),
      ]),
    ).toEqual([])
  })
})

describe('timecode and describeGap', () => {
  it('reads as an editor would say it', () => {
    expect(timecode(6_000)).toBe('0:06')
    expect(timecode(200_000)).toBe('3:20')
    expect(describeGap(12_000, 0)).toBe('12 s earlier')
    expect(describeGap(0, 200_000)).toBe('3 min 20 s later')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @boom-busters/web exec vitest run lib/visuals-reuse.test.ts`
Expected: FAIL, cannot find module `./visuals-reuse`.

- [ ] **Step 3: Write the module**

Create `apps/web/lib/visuals-reuse.ts`:

```ts
import type { ShotSlotStatus, SlotCandidate } from '@boom-busters/schemas'

/**
 * The pure half of shot reuse on the board (decision 261): what a card says
 * about its link, how many slots lean on it, and the note when one picture
 * plays twice within a minute. The writes live in the db package; this is
 * what the review model and the board read.
 */

/** Two plays of one picture closer than this get a note, in the picker and on the plan. */
export const CLOSE_REUSE_MS = 60_000

export interface ReuseSource {
  sourceSlotId: string
  chapterIndex: number
  startMs: number
  sourceStatus: ShotSlotStatus
}

export interface ReusableRow {
  id: string
  chapterIndex: number
  startMs: number
  status: ShotSlotStatus
  reuseOfSlotId: string | null
  candidates: readonly SlotCandidate[]
}

export function timecode(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`
}

/** "3 min 20 s earlier": where another slot plays, relative to this one. */
export function describeGap(fromMs: number, toMs: number): string {
  const seconds = Math.round(Math.abs(toMs - fromMs) / 1000)
  const words = seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`
  return `${words} ${toMs < fromMs ? 'earlier' : 'later'}`
}

/** The source a linked slot shows, or null for a slot with its own shot or a source row that is gone. */
export function reuseView(row: ReusableRow, rows: readonly ReusableRow[]): ReuseSource | null {
  if (!row.reuseOfSlotId) return null
  const source = rows.find((other) => other.id === row.reuseOfSlotId)
  if (!source) return null
  return {
    sourceSlotId: source.id,
    chapterIndex: source.chapterIndex,
    startMs: source.startMs,
    sourceStatus: source.status,
  }
}

export function reusedByCount(row: ReusableRow, rows: readonly ReusableRow[]): number {
  return rows.filter((other) => other.reuseOfSlotId === row.id).length
}

/** What identifies a chosen picture: the bytes we hold, else the provider's own id. */
function chosenKey(row: ReusableRow): string | null {
  const chosen = row.candidates.find((candidate) => candidate.chosen)
  if (!chosen) return null
  return chosen.assetId ?? `${chosen.provider}:${chosen.id}`
}

/** "the same shot plays at 3:10 and 3:40": two slots holding one picture within a minute. */
export function sharedShotWarnings(rows: readonly ReusableRow[]): string[] {
  const warnings: string[] = []
  const sorted = [...rows].sort((a, b) => a.startMs - b.startMs)
  for (let first = 0; first < sorted.length; first += 1) {
    const a = sorted[first]!
    const keyA = chosenKey(a)
    if (keyA === null) continue
    for (let second = first + 1; second < sorted.length; second += 1) {
      const b = sorted[second]!
      if (b.startMs - a.startMs >= CLOSE_REUSE_MS) break
      if (chosenKey(b) === keyA) {
        warnings.push(
          `the same shot plays at ${timecode(a.startMs)} and ${timecode(b.startMs)}, under a minute apart`,
        )
      }
    }
  }
  return warnings
}
```

- [ ] **Step 4: Run the module's test to verify it passes**

Run: `pnpm --filter @boom-busters/web exec vitest run lib/visuals-reuse.test.ts`
Expected: PASS.

- [ ] **Step 5: Put it on the model**

In `apps/web/lib/visuals-review.ts`:

Add the import:

```ts
import {
  reusedByCount,
  reuseView,
  sharedShotWarnings,
  type ReusableRow,
  type ReuseSource,
} from './visuals-reuse'
```

In `SlotView`, after `article: ArticleMetadata | null`, add:

```ts
  /** The slot whose shot this one shows (decision 261), or null when it has its own. */
  reuse: ReuseSource | null
  /** How many slots show this slot's shot. */
  reusedBy: number
```

In `visualsReviewModel`, directly before `const slots: SlotView[] = rows.map((row, at) => {`, add:

```ts
  // The rows as the reuse helpers read them (decision 261): anchored times,
  // parsed candidates, the link column.
  const reusable: ReusableRow[] = rows.map((row, at) => ({
    id: row.id,
    chapterIndex: row.chapterIndex,
    startMs: times[at]!.startMs,
    status: row.status,
    reuseOfSlotId: row.reuseOfSlotId,
    candidates: parseCandidates(row.candidates),
  }))
```

In the object each slot maps to, after the `refusal:` entry, add:

```ts
      reuse: reuseView(reusable[at]!, reusable),
      reusedBy: reusedByCount(reusable[at]!, reusable),
```

In the `warnings:` array (from Task 4), after the `...castWarnings(...)` spread, add:

```ts
      ...sharedShotWarnings(reusable),
```

In `apps/web/app/(console)/projects/[id]/visual-board.test.tsx`, add `reuse: null,` and `reusedBy: 0,` to the `stockSlot` literal (after `article: null,` near line 236) and to each other `SlotView` literal that does not spread `stockSlot` (the ones whose `briefError:` lines are at 160, 189 and 230; `pnpm typecheck` names any missed).

- [ ] **Step 6: Typecheck and run the web tests**

Run: `pnpm typecheck && pnpm --filter @boom-busters/web test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
pnpm format:check && pnpm lint
git add apps/web/lib/visuals-reuse.ts apps/web/lib/visuals-reuse.test.ts apps/web/lib/visuals-review.ts "apps/web/app/(console)/projects/[id]/visual-board.test.tsx"
git commit -m "feat(board): the model says where a slot's shot came from, and when one plays twice too close (decision 261)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: The board: the picker, the linked card, the source line

**Files:**

- Modify: `apps/web/app/(console)/projects/[id]/visual-board.tsx` (imports 24-42; `timecode` 63-66; `SlotCard` 696-760; the refusal block 785-815; `TypePicker` at 836-845; the button row 862-932; the `RebriefForm` render at 952; the `<SlotCard` render at 675-684; a new `ReusePicker` component beside `RebriefForm`)
- Test: `apps/web/app/(console)/projects/[id]/visual-board.test.tsx`

**Interfaces:**

- Consumes: `reuseSlotShotAction`, `unlinkSlotReuseAction` (Task 9); `CLOSE_REUSE_MS`, `describeGap`, `timecode` from `@/lib/visuals-reuse`; `REUSABLE_SLOT_TYPES` from `@boom-busters/schemas`; `slot.reuse` and `slot.reusedBy` (Task 10).
- Produces: `SlotCard` gains a `sources: SlotView[]` prop (the whole film's slots); buttons **Use an existing shot**, **Use this** / **Use this variant** / **Use whatever this slot chooses**, **Choose its own shot**, **Cancel**; a `role="group"` named **Shots to reuse**; a chip **Reused from ch N · m:ss**.

- [ ] **Step 1: Write the failing tests**

In `apps/web/app/(console)/projects/[id]/visual-board.test.tsx`:

Add two mocks beside the others:

```ts
const reuseSlotShotAction = vi.fn()
const unlinkSlotReuseAction = vi.fn()
```

add to the `vi.mock('./visuals-actions', ...)` object:

```ts
  reuseSlotShotAction: (...args: unknown[]) => reuseSlotShotAction(...args),
  unlinkSlotReuseAction: (...args: unknown[]) => unlinkSlotReuseAction(...args),
```

and to `beforeEach`:

```ts
  reuseSlotShotAction.mockResolvedValue({ ok: true })
  unlinkSlotReuseAction.mockResolvedValue({ ok: true })
```

Then append a describe:

```ts
describe('reusing a shot (decision 261)', () => {
  const placeholder: SlotView = {
    ...stockSlot,
    id: SLOT_B,
    status: 'placeholder',
    startMs: 12000,
    brief: {
      ...stockSlot.brief!,
      coversText: 'The trail led to Manila.',
      description: 'A courtroom sketch nothing free will ever have.',
    } as SlotView['brief'],
    candidates: [],
    extraCandidates: 0,
    needsFetch: true,
  }

  it('offers the film’s other shots to a picture card, with their distance, and links on Use this', async () => {
    const user = userEvent.setup()
    render(<VisualBoard projectId={PROJECT} model={model([stockSlot, placeholder])} colors={COLORS} />)

    const card = document.getElementById(`slot-${SLOT_B}`)!
    await user.click(within(card).getByRole('button', { name: 'Use an existing shot' }))

    const picker = within(card).getByRole('group', { name: 'Shots to reuse' })
    expect(within(picker).getByText(/By June, the auditors could not find the money/)).toBeInTheDocument()
    expect(within(picker).getByText('12 s earlier')).toBeInTheDocument()
    expect(within(picker).getByText('plays within a minute of this slot')).toBeInTheDocument()

    await user.click(within(picker).getByRole('button', { name: 'Use this' }))
    await waitFor(() =>
      expect(reuseSlotShotAction).toHaveBeenCalledWith(PROJECT, SLOT_B, SLOT_A, 'a1'),
    )
    expect(toast).toHaveBeenCalledWith({ title: 'Now showing the shot from 0:00' })
  })

  it('before Fetch offers the link without a picture, and says Fetch will copy', async () => {
    const user = userEvent.setup()
    const plannedStock: SlotView = { ...stockSlot, status: 'unresolved', candidates: [], extraCandidates: 0, needsFetch: true }
    const plannedTarget: SlotView = { ...placeholder, status: 'unresolved' }
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([plannedStock, plannedTarget], { phase: 'plan', toFetch: 2 })}
        colors={COLORS}
      />,
    )

    const card = document.getElementById(`slot-${SLOT_B}`)!
    await user.click(within(card).getByRole('button', { name: 'Use an existing shot' }))
    await user.click(within(card).getByRole('button', { name: 'Use whatever this slot chooses' }))
    await waitFor(() =>
      expect(reuseSlotShotAction).toHaveBeenCalledWith(PROJECT, SLOT_B, SLOT_A, undefined),
    )
    expect(toast).toHaveBeenCalledWith({
      title: 'Linked. Fetch visuals will copy the shot when it lands',
    })
  })

  it('a linked card says where its shot came from, hides the fetch buttons, and offers its own shot back', async () => {
    const user = userEvent.setup()
    const linked: SlotView = {
      ...placeholder,
      status: 'resolved',
      candidates: [{ ...stockSlot.candidates[0]!, reusedFrom: { slotId: SLOT_A } }],
      needsFetch: false,
      reuse: { sourceSlotId: SLOT_A, chapterIndex: 0, startMs: 0, sourceStatus: 'resolved' },
    }
    const source: SlotView = { ...stockSlot, reusedBy: 1 }
    render(<VisualBoard projectId={PROJECT} model={model([source, linked])} colors={COLORS} />)

    const card = document.getElementById(`slot-${SLOT_B}`)!
    expect(within(card).getByText('Reused from ch 1 · 0:00')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /^Regenerate/ })).toBeNull()
    expect(within(card).queryByRole('button', { name: 'Upload own' })).toBeNull()
    expect(within(card).queryByRole('button', { name: 'Draft a different brief' })).toBeNull()
    expect(within(card).queryByRole('button', { name: 'Use an existing shot' })).toBeNull()
    expect(within(card).getByRole('button', { name: 'Edit brief', exact: true })).toBeInTheDocument()

    const sourceCard = document.getElementById(`slot-${SLOT_A}`)!
    expect(within(sourceCard).getByText('Also used at 0:12.')).toBeInTheDocument()

    await user.click(within(card).getByRole('button', { name: 'Choose its own shot' }))
    await waitFor(() => expect(unlinkSlotReuseAction).toHaveBeenCalledWith(PROJECT, SLOT_B))
  })

  it('never offers a chart, a map or a headline the picker, and offers a source with nothing chosen nothing', () => {
    render(<VisualBoard projectId={PROJECT} model={model([stockSlot, chartSlot, placeholder])} colors={COLORS} />)
    const chartCard = document.getElementById(`slot-${chartSlot.id}`)!
    expect(within(chartCard).queryByRole('button', { name: 'Use an existing shot' })).toBeNull()
  })
})
```

(`chartSlot` is the existing chart fixture in the file; use its name as declared there.)

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @boom-busters/web exec vitest run "app/(console)/projects/\[id\]/visual-board.test.tsx"`
Expected: FAIL, "Unable to find an accessible element with the role button and name Use an existing shot".

- [ ] **Step 3: Build the picker and the linked card**

In `apps/web/app/(console)/projects/[id]/visual-board.tsx`:

(a) Imports. Add `reuseSlotShotAction,` and `unlinkSlotReuseAction,` to the `./visuals-actions` import; add `REUSABLE_SLOT_TYPES` to the `@boom-busters/schemas` import beside `SHOT_SLOT_TYPES`; add:

```ts
import { CLOSE_REUSE_MS, describeGap, timecode } from '@/lib/visuals-reuse'
```

and delete the local `function timecode(ms: number): string { ... }` (lines 63-66), since the import replaces it.

(b) `VisualBoard` passes the film to every card: in the `<SlotCard` render (line 675-684) add the prop `sources={allSlots}`.

(c) `SlotCard` props gain `sources: SlotView[]`; its state gains `const [reusing, setReusing] = React.useState(false)`; after `const planning = phase === 'plan'` add:

```tsx
  const linked = slot.reuse
  const lends = sources.filter((other) => other.reuse?.sourceSlotId === slot.id)
  const picture = REUSABLE_SLOT_TYPES.includes(slot.type as (typeof REUSABLE_SLOT_TYPES)[number])
```

(d) In the header, after the `<StatusChip ... />`, add:

```tsx
          {linked ? (
            <Badge tone="muted">
              Reused from ch {linked.chapterIndex + 1} · {timecode(linked.startMs)}
            </Badge>
          ) : null}
```

(e) In `CardContent`, after the description paragraph, add:

```tsx
        {linked && slot.candidates.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            Reuses the shot at {timecode(linked.startMs)}, which has none yet.
            {planning
              ? ' Fetch visuals copies it when that slot lands.'
              : ' Fetch or regenerate that slot, then pick it again.'}
          </p>
        ) : null}
        {lends.length > 0 ? (
          <p className="text-[12px] text-[var(--color-text-muted)]">
            Also used at {lends.map((other) => timecode(other.startMs)).join(', ')}.
          </p>
        ) : null}
```

(f) Hide what would fetch for a linked slot. Wrap these existing renders in `!linked && ...`:

- the refusal block: `{!linked && slot.refusal && brief?.type === 'still' ? (` ... `) : null}`
- the format picker: `{!linked && brief && !slot.briefError ? (<TypePicker .../>) : null}`
- the "Draft a different brief" button: `{!linked && brief.type !== 'headline' ? (` ... `) : null}`
- the Regenerate / Fetch this slot button: `{!linked && brief.type !== 'archival' ? (` ... `) : null}`
- the `UploadOwnButton` at the end of the row: `{!linked && (brief.type === 'stock' || brief.type === 'archival' || brief.type === 'still') ? (<UploadOwnButton .../>) : null}`

Change the Edit brief label condition from `planning || brief.type === 'archival'` to `planning || brief.type === 'archival' || linked !== null`, and pass `planning={planning || linked !== null}` to `<BriefEditor>` so its Save reads as a save.

(g) Add the two new buttons to the row, after the Edit brief button:

```tsx
                {picture && !linked ? (
                  <Button
                    variant="outline"
                    aria-expanded={reusing}
                    onClick={() => setReusing((value) => !value)}
                  >
                    {reusing ? 'Close shot picker' : 'Use an existing shot'}
                  </Button>
                ) : null}
                {linked ? (
                  <Button
                    variant="outline"
                    busy={busy}
                    onClick={() =>
                      act(
                        slot.id,
                        () => unlinkSlotReuseAction(projectId, slot.id),
                        'This slot will fetch its own shot again',
                      )
                    }
                  >
                    Choose its own shot
                  </Button>
                ) : null}
```

(h) Render the picker beside the rebrief form (after the `{rebriefing ? <RebriefForm .../> : null}` block):

```tsx
        {reusing ? (
          <ReusePicker
            slot={slot}
            sources={sources}
            phase={phase}
            projectId={projectId}
            act={act}
            onDone={() => setReusing(false)}
          />
        ) : null}
```

(i) Add the component, placed directly after `RebriefForm`:

```tsx
/** The pictures a source can lend: its chosen one, then anything whose bytes the app holds. */
function lendable(source: SlotView): SlotCandidate[] {
  return source.candidates.filter(
    (candidate) =>
      candidate.chosen === true || candidate.assetId !== undefined || candidate.r2Key !== undefined,
  )
}

/**
 * "Use an existing shot" (decision 261): the film's other picture slots and,
 * for each, the shots it holds that this slot could show instead of fetching
 * its own. Built from the model the board already loaded; nothing is queried.
 *
 * Before Fetch nothing has a picture yet, so a row carries one button and the
 * link is filled when the fan-out lands. On the board a slot with nothing to
 * lend is not offered: no copy step runs there, so a link to it would never
 * be filled. Dependants are not offered either; the original is.
 */
function ReusePicker({
  slot,
  sources,
  phase,
  projectId,
  act,
  onDone,
}: {
  slot: SlotView
  sources: SlotView[]
  phase: VisualsReviewModel['phase']
  projectId: string
  act: (slotId: string, run: () => Promise<ActionResult>, success: string) => Promise<ActionResult>
  onDone: () => void
}) {
  const planning = phase === 'plan'
  const offered = sources.filter(
    (source) =>
      source.id !== slot.id &&
      REUSABLE_SLOT_TYPES.includes(source.type as (typeof REUSABLE_SLOT_TYPES)[number]) &&
      source.reuse === null &&
      (planning || lendable(source).length > 0),
  )

  const use = (source: SlotView, candidateId: string | undefined) =>
    void act(
      slot.id,
      () => reuseSlotShotAction(projectId, slot.id, source.id, candidateId),
      planning
        ? 'Linked. Fetch visuals will copy the shot when it lands'
        : `Now showing the shot from ${timecode(source.startMs)}`,
    ).then((result) => {
      if (result.ok) onDone()
    })

  return (
    <div
      role="group"
      aria-label="Shots to reuse"
      className="flex flex-col gap-3 rounded-[8px] border border-[var(--color-border)] p-3"
    >
      <p className="text-[12px] text-[var(--color-text-muted)]">
        {planning
          ? 'Fetch visuals will skip this slot and copy the shot the one you pick ends up with.'
          : 'This slot shows the shot you pick instead of fetching its own.'}
        {slot.candidates.length > 0
          ? ` This replaces the ${slot.candidates.length} candidate${
              slot.candidates.length === 1 ? '' : 's'
            } fetched for this slot.`
          : ''}
      </p>
      {offered.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          No other stock, AI image or real-footage slot in this film has a shot to offer yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {offered.map((source) => {
            const pictures = lendable(source)
            return (
              <li
                key={source.id}
                className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-2"
              >
                <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--color-text-secondary)]">
                  <span className="font-mono text-[11px]">
                    ch {source.chapterIndex + 1} · {timecode(source.startMs)}
                  </span>
                  <span>{describeGap(slot.startMs, source.startMs)}</span>
                  {Math.abs(source.startMs - slot.startMs) < CLOSE_REUSE_MS ? (
                    <Badge tone="warning">plays within a minute of this slot</Badge>
                  ) : null}
                </div>
                {source.brief ? (
                  <p className="text-[13px] text-[var(--color-text-primary)]">
                    “{source.brief.coversText}”
                  </p>
                ) : null}
                {source.brief ? (
                  <p className="text-[12px] text-[var(--color-text-secondary)]">
                    {source.brief.description}
                  </p>
                ) : null}
                {pictures.length === 0 ? (
                  <div>
                    <Button variant="outline" onClick={() => use(source, undefined)}>
                      Use whatever this slot chooses
                    </Button>
                  </div>
                ) : (
                  <ul className="flex flex-wrap gap-2" aria-label="Shots this slot can lend">
                    {pictures.map((candidate) => {
                      const thumb = candidateThumb(candidate)
                      return (
                        <li key={candidate.id} className="flex flex-col items-start gap-1">
                          {thumb ? (
                            <img src={thumb} alt="" className="h-16 w-28 rounded-[6px] object-cover" />
                          ) : null}
                          <Button variant="outline" onClick={() => use(source, candidate.id)}>
                            {candidate.chosen ? 'Use this' : 'Use this variant'}
                          </Button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <div>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the component tests to verify they pass**

Run: `pnpm typecheck && pnpm --filter @boom-busters/web exec vitest run "app/(console)/projects/\[id\]/visual-board.test.tsx"`
Expected: PASS, the four new tests and every existing one.

- [ ] **Step 5: Commit**

```bash
pnpm format:check && pnpm lint
git add "apps/web/app/(console)/projects/[id]/visual-board.tsx" "apps/web/app/(console)/projects/[id]/visual-board.test.tsx"
git commit -m "feat(board): Use an existing shot, the linked card, and Choose its own shot (decision 261)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: The altered-content label counts a reused likeness

**Files:**

- Modify: `apps/web/lib/publish-review.ts:80-98`
- Test: `apps/web/lib/publish-review.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/web/lib/publish-review.test.ts`, inside `describe('syntheticLikenesses', ...)` add:

```ts
  it('counts a likeness reused into a stock slot, through the copy’s own record (decision 261)', () => {
    const slots = [
      {
        brief: {
          type: 'stock',
          coversText: 'x',
          description: 'x',
          motion: { kind: 'static' },
          transition: 'cut',
          query: 'q',
          rejectionCriteria: [],
        },
        candidates: [
          {
            ...candidate('google', true),
            reusedFrom: { slotId: '01J000000000000000000000AA', depicts: ['Jan Marsalek'] },
          },
        ],
      },
    ]
    expect(syntheticLikenesses(slots)).toEqual(['Jan Marsalek'])
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @boom-busters/web exec vitest run lib/publish-review.test.ts`
Expected: FAIL, `expected [] to deeply equal ['Jan Marsalek']`.

- [ ] **Step 3: Read the copy's record**

Replace the body of `syntheticLikenesses` in `apps/web/lib/publish-review.ts`:

```ts
/**
 * The distinct names in `depicts` across still and hero slots whose CHOSEN
 * candidate is a generated one (fal or google), plus the names a copied
 * candidate carries from the still it was reused from (decision 261). An
 * uploaded real photograph of the same person is not synthetic media, so it
 * does not count.
 */
export function syntheticLikenesses(
  slots: readonly { brief: unknown; candidates: unknown }[],
): string[] {
  const names = new Set<string>()
  for (const slot of slots) {
    const candidates = z.array(SlotCandidateSchema).safeParse(slot.candidates)
    const chosen = candidates.success ? candidates.data.find((c) => c.chosen) : undefined
    if (!chosen || (chosen.provider !== 'fal' && chosen.provider !== 'google')) continue
    const brief = ShotBriefSchema.safeParse(slot.brief)
    const own =
      brief.success && (brief.data.type === 'still' || brief.data.type === 'hero')
        ? (brief.data.depicts ?? [])
        : []
    for (const name of [...own, ...(chosen.reusedFrom?.depicts ?? [])]) names.add(name)
  }
  return [...names]
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @boom-busters/web exec vitest run lib/publish-review.test.ts`
Expected: PASS, the three existing tests included.

- [ ] **Step 5: Commit**

```bash
pnpm format:check && pnpm lint
git add apps/web/lib/publish-review.ts apps/web/lib/publish-review.test.ts
git commit -m "fix(publish): the altered-content label counts a likeness reused into another slot (decision 261)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: End to end, on the seeded plan and board

**Files:**

- Modify: `e2e/tests/visual-plan.spec.ts` (append a describe)
- Modify: `e2e/tests/visual-board.spec.ts` (append a describe)

The plan project holds a still ("A boardroom nobody sits in any more.", 0:00) and a stock slot ("Trading floor panic, archive mood.", 0:06), nothing fetched. The board project's placeholder is a stock slot at 0:12 ("A courtroom sketch nothing free will ever have."); its first slot at 0:00 holds a chosen Pexels candidate and an unchosen Pixabay one with no bytes.

- [ ] **Step 1: Add the plan round trip**

Append to `e2e/tests/visual-plan.spec.ts`:

```ts
/**
 * Reusing a shot before Fetch (decision 261): the link is recorded, the
 * priced button drops the slot, and taking it back restores the seeded
 * state exactly, so a re-run of this file starts where the seed left it.
 */
test.describe('reusing a shot (decision 261)', () => {
  test('links a slot before Fetch, drops it from the bill, and can take it back', async ({
    page,
  }) => {
    const still = page.locator('[id^="slot-"]').filter({ hasText: 'boardroom' })
    await still.getByRole('button', { name: 'Use an existing shot' }).click()

    const picker = still.getByRole('group', { name: 'Shots to reuse' })
    await expect(picker.getByText(/Trading floor panic/)).toBeVisible()
    await expect(picker.getByText('6 s later')).toBeVisible()
    await picker.getByRole('button', { name: 'Use whatever this slot chooses' }).click()

    await expect(still.getByText('Reused from ch 1 · 0:06')).toBeVisible()
    await expect(page.getByRole('button', { name: /Fetch visuals · 1 slot/ })).toBeVisible()
    // The fetch-shaped buttons left the card; the words are still editable.
    await expect(still.getByRole('button', { name: /Fetch this slot/ })).toHaveCount(0)
    await expect(still.getByRole('button', { name: 'Edit brief', exact: true })).toBeVisible()

    await still.getByRole('button', { name: 'Choose its own shot' }).click()
    await expect(still.getByText(/Reused from/)).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Fetch visuals · 2 slots/ })).toBeVisible()
  })
})
```

- [ ] **Step 2: Add the board picker check**

Append to `e2e/tests/visual-board.spec.ts`:

```ts
/**
 * Reusing a shot on the board (decision 261). Opens the picker on the
 * placeholder, checks what the film offers and how far away it plays, and
 * cancels: a copy cannot be put back into the exact seeded placeholder from
 * the UI, and every test in this file shares the board. The copy itself is
 * proved by the db, action and component suites.
 */
test.describe('reusing a shot on the board (decision 261)', () => {
  test('offers the film’s fetched shots to the placeholder, with their distance, and cancels', async ({
    page,
  }) => {
    const placeholder = page.locator('[id^="slot-"]').filter({ hasText: 'courtroom sketch' })
    await placeholder.getByRole('button', { name: 'Use an existing shot' }).click()

    const picker = placeholder.getByRole('group', { name: 'Shots to reuse' })
    await expect(picker.getByText(/Deserted open-plan office at dusk/)).toBeVisible()
    await expect(picker.getByText('12 s earlier')).toBeVisible()
    // The chosen candidate is lendable; the unchosen one with no bytes is not.
    await expect(picker.getByRole('button', { name: 'Use this', exact: true })).toHaveCount(1)

    await picker.getByRole('button', { name: 'Cancel' }).click()
    await expect(placeholder.getByRole('group', { name: 'Shots to reuse' })).toHaveCount(0)
  })

  test('never offers a chart the picker', async ({ page }) => {
    const chart = page
      .locator('[id^="slot-"]')
      .filter({ has: page.getByRole('img', { name: /line chart/ }) })
    await expect(chart).toHaveCount(1)
    await expect(chart.getByRole('button', { name: 'Use an existing shot' })).toHaveCount(0)
  })
})
```

- [ ] **Step 3: Run both spec files**

Run (Docker Desktop running, Playwright browsers installed): `pnpm e2e -- e2e/tests/visual-plan.spec.ts e2e/tests/visual-board.spec.ts`
Expected: every test in both files passes. Read the final `N passed` line, not the exit code.

- [ ] **Step 4: Commit**

```bash
pnpm format:check && pnpm lint
git add e2e/tests/visual-plan.spec.ts e2e/tests/visual-board.spec.ts
git commit -m "test(e2e): reuse a shot before Fetch and take it back; the board offers its fetched shots (decision 261)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Record decision 261, then the full run

**Files:**

- Modify: `PROGRESS.md` (after entry 44)
- Modify: `docs/03-build-spec.md:185` (section 7.4) and `:320` (section 11.3, the **Visual board.** paragraph)

- [ ] **Step 1: Add PROGRESS.md entry 45**

Insert after entry 44:

```markdown
45. **A slot may show another slot's shot** (decision 261; 2026-09-18, owner:
    "there may also be instances where some shots can be re-used ... from a
    cost and efficiency perspective it's not a bad idea, as long as the shot
    fits the narrative and the context and is done so sparingly"; spec
    `docs/superpowers/specs/2026-09-18-sentence-first-briefs-and-shot-reuse-design.md`).

    _Who decides._ The owner, on the board, in either phase. Chapters are
    planned by separate calls that cannot see each other, so a model cannot
    spot a cross-chapter repeat at plan time, and "sparingly, when it fits"
    is a taste judgment. A model-proposed pass is a possible later decision
    on the same link.

    _The mechanism_ (approach A of three). `shot_slots.reuse_of_slot_id`
    (migration 0025) records the link. Before Fetch the link stands alone:
    `slotNeedsResolution` never owes a linked slot a fetch, so no still is
    generated for it, and a new runner step `copy-reused-shots` after the
    fan-out copies each source's chosen candidate into its dependants
    (status resolved, the target's own brief hash, the source's asset id;
    a source with nothing chosen leaves a placeholder). On the board the
    action copies at once. Every downstream reader keeps reading
    `candidates` as it did: assembly, ingestion, the gate, shorts and the
    teaser. The copy carries `reusedFrom: { slotId, depicts }` and drops the
    source's score (judged against another brief); `syntheticLikenesses`
    reads `reusedFrom.depicts`, so a likeness reused into a stock slot still
    sets the altered-content label. A live link (every reader follows the
    column) was rejected as five readers and a gate rule for re-planned
    sources; a copy with no column was rejected because before Fetch there
    is nothing to copy, and the saving before Fetch was the point.

    _Rules._ Only stock, still and archival slots reuse or are reused; no
    self-reuse; no chains (a pick that is itself a dependant re-points to
    the original); same project only. Every rule lives in the server
    action, and every fetch-shaped action (Regenerate, Fetch this slot,
    Draft a different brief, Redirect, Upload, re-type) refuses a linked
    slot in words; a brief edit saves and never fetches for one, and
    `updateSlotBrief` keeps a linked slot's status. The refetcher skips a
    linked slot for an event already in flight.

    _The board._ "Use an existing shot" on picture cards opens a panel of
    the film's other originals grouped by chapter: the covered sentence,
    "ch 2 · 3:10", the gap ("3 min 20 s earlier"), one "Use this" per
    candidate the app holds bytes for (the chosen one, the paid-for still
    variant nobody chose, uploads), and before Fetch one "Use whatever this
    slot chooses". Under a minute apart is a note, not a block, and the
    review model repeats it as "the same shot plays at 3:10 and 3:40". A
    linked card shows the copy with the chip "Reused from ch 2 · 3:10",
    keeps Edit brief, hides everything that would fetch, and offers "Choose
    its own shot". A source card says "Also used at 7:42".

    _Tests._ Pure: the guard, the schema, `reuseView` and the spacing note.
    DB: link with and without a candidate, copy on resolve, unlink, the
    brief edit. Runner: the copy step via the engine with the plan-writing
    steps stubbed. Actions: chains, types, other films, the refusals. Board:
    the picker and the linked card. E2E: the round trip on the seeded plan
    project (link, the bill drops to one slot, unlink), and the picker on
    the seeded board's placeholder, cancelled, because a board copy cannot
    be put back into the exact seeded state from the UI.
```

- [ ] **Step 2: Amend build spec sections 7.4 and 11.3**

Line 185, directly after the decision 260 amendment from Task 5, append:

```markdown
*(Amended 2026-09-18, decision 261: `shot_slots.reuse_of_slot_id` links a slot to the slot whose shot it shows; a linked slot is never owed a fetch, and a `copy-reused-shots` step after the fan-out copies each source's chosen candidate (stamped `reusedFrom`) into its dependants, or leaves a placeholder when the source has none. Assembly, ingestion, the gate, shorts and the teaser read `candidates` unchanged.)*
```

Line 320, at the end of the **Visual board.** paragraph (after `approve allowed with placeholders only via explicit "approve with N placeholders" wording.`), append:

```markdown
*(Amended 2026-09-18, decision 261: stock, AI image and real-footage cards carry `Use an existing shot`, which lists the film's other picture slots with the covered sentence, chapter and time, the gap to this slot, and a `Use this` button per candidate the app holds bytes for, or `Use whatever this slot chooses` before Fetch. A linked card shows the copy with a "Reused from ch N · m:ss" chip, keeps `Edit brief`, hides every fetch-shaped button and offers `Choose its own shot`. Two plays of one picture under a minute apart are a note, never a block.)*
```

- [ ] **Step 3: The full run**

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
pnpm e2e
```

Expected: every package green; the Playwright summary line reads `N passed` with no `failed`. If a composition golden fails inside the full run, re-run `pnpm --filter @boom-busters/compositions test` alone before believing it (nothing in this plan touches compositions).

- [ ] **Step 4: Commit**

```bash
git add PROGRESS.md docs/03-build-spec.md
git commit -m "docs: record decision 261

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 5: Merge and deploy, when the owner says so**

```bash
git checkout master && git merge --no-ff sentence-first-and-shot-reuse -m "Merge sentence-first-and-shot-reuse: briefs follow the sentence, and a shot can be reused (decisions 260 and 261)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin master
```

Then poll `vercel ls boom-busters-web --prod --yes 2>&1 | sed -n 1,6p` until the newest row reads `● Ready` (the build applies migration 0025 through `scripts/deploy-migrate.mjs`), and re-register: `curl -s -o /dev/null -w "%{http_code}\n" -X PUT https://boom-busters-web-rho.vercel.app/api/inngest` should print `200`. No Remotion redeploy: `packages/compositions` is untouched.

---

## Self-review against the spec

- Design 1 §1 (bible: sentence rule, floor and ceiling, third fact, pre-flight, fallback): Task 1. §2 (shot-list prompt): Task 2. §3 (book prompt): Task 3. §4 (chapter lean) and §5 (plan warning by head noun, per chapter, adjacent): Task 4. Existing-projects note: Task 5 records it.
- Design 2 §1 data: Task 6. §2 rules and §5 actions: Task 9. §3 writes: Task 7. §4 runner: Task 8. §6 board: Task 11. §7 spacing warning: Task 10. §8 downstream (label): Task 12; assembly, ingestion, gate, shorts, teaser untouched by design. §9 edge cases: Task 7 (placeholder source), Task 10 (missing source, per deviation 2). Testing section: Tasks 6 to 13. Docs: Tasks 5 and 14.
- Type consistency: `linkSlotReuse(db, slotId, sourceId, candidateId?) → Promise<LinkOutcome | null>` is used with that shape in Tasks 7, 8 and 9. `reuse: ReuseSource | null` and `reusedBy: number` are named identically in Tasks 10 and 11. `REUSABLE_SLOT_TYPES` is defined in Task 6 (schemas) and consumed in Tasks 9 and 11. `timecode` moves to `@/lib/visuals-reuse` in Task 10 and the board imports it in Task 11.
