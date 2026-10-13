# The Script Remembers What It Told (decision 296) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the script stage repeating itself: the outline assigns every claim one chapter, each chapter is drafted with the full script so far and an ownership brief, the craft rules name callbacks and forbid recaps, and a deterministic pass flags any sentence that repeats an earlier chapter as a gutter warning.

**Architecture:** `OutlineSchema` gains hint fields (`storylines`, per chapter `storyline`, `claims`, `reveals`, `constraints`), folded and clamped like decision 216's tension fields; `parseOutline` repairs beats and claim ownership and reports it (decision 293). `buildChapterRequest` takes `previousChapters` (full text) and sends an ownership brief and a stronger seam rule; the house style and `script-craft.md` gain the recap and caveat rules. `findRepeats` in `packages/schemas` scans drafted chapters for six-word runs already heard and the runner stores its findings beside each chapter's self-check warnings under the new kind `repeats-earlier`.

**Tech Stack:** Zod 4 (`packages/schemas`), the prompt builders in `packages/providers`, the answer helper `apps/web/lib/answer.ts` (decision 292), Inngest v4 (`apps/web/inngest/functions/script-runner.ts`), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-13-script-ownership-design.md`

## Global Constraints

- Every new outline field is a hint in the `tensionField` mould: trimmed, clamped to 500 characters, an empty or invalid value folds to absent through `.catch`. An outline is never refused for one of them (spec 2.1).
- `OUTLINE_BEAT_MAX = 600` characters; a beat over it is trimmed at a sentence and reported as `{ action: 'trimmed', field: "chapter N's beat" }`. A claim number is dropped, never refused: `{ action: 'dropped', field: "chapter N's claim M", reason }` (spec 2.1).
- Claim numbers are 1-based into the claim list `claimList()` prints; the first chapter to list a number owns it.
- `findRepeats` matches runs of exactly `REPEAT_RUN_WORDS = 6` words after `stripNarrationMarkup`, lower-casing and removing everything but letters, digits and spaces; it compares a chapter only with earlier chapters; at most one warning per sentence; the warning's `sentence` is the exact sentence `splitSentences` returned, so the gutter can place it (spec 2.4).
- The new warning kind is `'repeats-earlier'`; `GutterWarningSchema` limits hold: message at most 500 characters, so the quoted earlier sentence is cut to 160.
- An outline stored before this decision (no `claims`) still drafts: no ownership brief, no `reveals` or `constraints` lines, nothing else changes (spec 2.5).
- A run parked before the deploy replays the `outline` step without `repairs`: read it with `?? []` (memory: parked runs replay old step results).
- `script-craft.ts` stays byte-identical to `script-craft.md`; every phrase a test asserts sits whole on one line of the markdown (memory: bible assertions need unwrapped lines).
- Every paid call stays on `callForAnswer` / `callForText`; mock-provider mode makes no paid call.
- Copy in prompts and notices: no em or en dashes in new strings; South African spelling. Code and tests are exempt. The existing HOUSE_STYLE lines keep their em dashes (they are the narrator's hesitation channel).
- Run `pnpm exec prettier --write` on changed files before each commit; `pnpm typecheck` and `pnpm lint` stay clean. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Regexes and template literals are written with the Edit or Write tool, never through a heredoc or sed (memory: bash heredocs with template literals fail).
- No migration: the outline and the warnings are JSON columns.
- Branch: `script-ownership` off `master`; one commit per task.

## Review Focus

1. A model lists the same claim in two chapters: the second listing must be dropped with a reason naming the owner, and the outline must still parse. Pinned in Task 4.
2. A chapter that repeats a six-word run from an earlier chapter only inside a narration tag or only differing in punctuation and case: still a repeat. Pinned in Task 2.
3. Two chapters that share a common five-word phrase ("in the first quarter of"): not a repeat. Pinned in Task 2.
4. The opening chapter, with nothing drafted yet: the request must say so and send no "script so far" block. Pinned in Task 5.
5. An outline that carries `claims` on no chapter (any script before this decision): no ownership brief in any chapter's request. Pinned in Task 5.

## Execution order

Tasks 1 to 6 in order. Tasks 1 and 2 are in `packages/schemas`; Tasks 3 to 5 in `packages/providers`; Task 6 in `apps/web` plus the docs. Between Task 5 and Task 6 the web package's typecheck is red (`buildChapterRequest` loses `previousTail`, `parseOutline` gains a parameter); nothing is pushed in that window.

---

### Task 1: The outline's plan fields and the new warning kind

**Files:**
- Modify: `packages/schemas/src/script.ts:23-95`
- Test: `packages/schemas/src/script.test.ts` (append to `describe('OutlineSchema')`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `OUTLINE_BEAT_MAX: number`; `OutlineChapterSchema` with optional `storyline`, `claims: number[]`, `reveals`, `constraints`; `OutlineSchema` with optional `storylines: string[]`; `WARNING_KINDS` including `'repeats-earlier'`. Types `Outline`, `OutlineChapter`, `WarningKind` widen accordingly.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('OutlineSchema', ...)` in `packages/schemas/src/script.test.ts`, after the last existing `it`:

```ts
  /**
   * Decision 296: the outline is a plan. Storylines, claim ownership, the
   * reveal and the wording limits are hints like the tension fields: folded
   * and clamped, never a refused outline.
   */
  describe('the plan fields (decision 296)', () => {
    const planned = {
      storylines: ['the money', 'the courts'],
      chapters: [
        {
          ...chapter,
          storyline: 'the money',
          claims: [3, 1, 3],
          reveals: '  who Rombach is  ',
          constraints: 'Attribute every figure to The Information.',
        },
        { ...chapter, claims: [2] },
      ],
    }

    it('reads storylines, ownership, the reveal and the constraints', () => {
      const parsed = OutlineSchema.parse(planned)
      expect(parsed.storylines).toEqual(['the money', 'the courts'])
      expect(parsed.chapters[0]).toMatchObject({
        storyline: 'the money',
        reveals: 'who Rombach is',
        constraints: 'Attribute every figure to The Information.',
      })
      expect(parsed.chapters[1]!.claims).toEqual([2])
    })

    it('keeps one of a claim number listed twice in the same chapter', () => {
      expect(OutlineSchema.parse(planned).chapters[0]!.claims).toEqual([3, 1])
    })

    it('folds a claims list it cannot read to absent rather than refusing', () => {
      const parsed = OutlineSchema.parse({
        chapters: [{ ...chapter, claims: 'three and one' }, chapter],
      })
      expect(parsed.chapters[0]!.claims).toBeUndefined()
    })

    it('folds an empty reveal or constraint to absent', () => {
      const parsed = OutlineSchema.parse({
        chapters: [{ ...chapter, reveals: '   ', constraints: '' }, chapter],
      })
      expect(parsed.chapters[0]!.reveals).toBeUndefined()
      expect(parsed.chapters[0]!.constraints).toBeUndefined()
    })

    it('keeps at most six storylines and folds a bad list to absent', () => {
      const seven = OutlineSchema.parse({
        storylines: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
        chapters: [chapter, chapter],
      })
      expect(seven.storylines).toBeUndefined()
      const bad = OutlineSchema.parse({ storylines: 'the money', chapters: [chapter, chapter] })
      expect(bad.storylines).toBeUndefined()
    })

    it('still reads an outline stored before the plan fields existed', () => {
      const parsed = OutlineSchema.parse({ chapters: [chapter, chapter] })
      expect(parsed.storylines).toBeUndefined()
      expect(parsed.chapters[0]!.claims).toBeUndefined()
    })

    it('names the beat limit the outline parser trims at', () => {
      expect(OUTLINE_BEAT_MAX).toBe(600)
    })
  })
```

Add `OUTLINE_BEAT_MAX` and `WARNING_KINDS` to the file's import from `./script`, and append a test to `describe('SelfCheckSchema', ...)`:

```ts
  it('accepts the repeat warning the whole-script check writes (decision 296)', () => {
    expect(WARNING_KINDS).toContain('repeats-earlier')
    const parsed = SelfCheckSchema.safeParse({
      warnings: [
        { kind: 'repeats-earlier', sentence: 'Coatue had co-led the round.', message: 'Repeats chapter 3: "Coatue had co-led the round."' },
      ],
      refs: [],
    })
    expect(parsed.success).toBe(true)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @boom-busters/schemas test -- script.test.ts`
Expected: FAIL. `OUTLINE_BEAT_MAX` is not exported; `storylines`, `claims`, `reveals`, `constraints` come back undefined where values are expected; `'repeats-earlier'` is refused by the enum.

- [ ] **Step 3: Add the fields and the kind**

In `packages/schemas/src/script.ts`, after `MAX_CHAPTER_WORDS`:

```ts
/**
 * The longest beat the outline parser keeps (decision 296). A beat is one to
 * three sentences of purpose; the facts are the claims the chapter owns. The
 * 1,300 to 1,800 character beats of the Stability script were fact lists,
 * and the drafter narrated every one of them, in two chapters each.
 */
export const OUTLINE_BEAT_MAX = 600
```

After the `tensionField` definition:

```ts
/**
 * The claim numbers a chapter narrates in full (decision 296): 1-based into
 * the claim list the outline prompt printed. A hint, like the tension
 * fields: a value that is not a list of numbers folds to absent, and a
 * number listed twice in one chapter is kept once. Ownership across chapters
 * is settled by the outline parser, which knows the claim count.
 */
const claimNumbers = z
  .array(z.number().int().positive())
  .transform((numbers) => [...new Set(numbers)])
  .optional()
  .catch(undefined)

/** Two to four named threads the film braids; at most six, or the list is folded. */
const storylines = z
  .array(z.string().trim().min(1).max(200))
  .min(1)
  .max(6)
  .optional()
  .catch(undefined)
```

In `OutlineChapterSchema`, after `stakes: tensionField,`:

```ts
  /** Which of the outline's `storylines` this chapter advances. */
  storyline: tensionField,
  /** The claims this chapter narrates in full; every claim has one home. */
  claims: claimNumbers,
  /** The fact an earlier chapter withheld that this chapter reveals, if any. */
  reveals: tensionField,
  /** Wording limits that shape the words and are never narrated as sentences. */
  constraints: tensionField,
```

In `OutlineSchema`, after `centralQuestion: tensionField,`:

```ts
  storylines,
```

In `WARNING_KINDS`, after `'unsupported-attribution',`:

```ts
  /** Repeats a six-word run an earlier chapter already narrated (decision 296). */
  'repeats-earlier',
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @boom-busters/schemas test -- script.test.ts`
Expected: PASS.

Then: `pnpm --filter @boom-busters/providers test -- script.test.ts`
Expected: PASS. The test `rejects a warning kind the gutter cannot render` uses a kind that is still not in the enum; if it used `repeats-earlier` by coincidence, change its kind to `'made-up'`.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write packages/schemas/src/script.ts packages/schemas/src/script.test.ts
git add packages/schemas/src/script.ts packages/schemas/src/script.test.ts
git commit -m "feat(schemas): the outline's plan fields and the repeats-earlier warning kind (decision 296)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `findRepeats`, the whole-script repetition check

**Files:**
- Create: `packages/schemas/src/repetition.ts`
- Create: `packages/schemas/src/repetition.test.ts`
- Modify: `packages/schemas/src/index.ts` (add `export * from './repetition'` after `./script`)

**Interfaces:**
- Consumes: `splitSentences`, `stripNarrationMarkup`, `GutterWarning` from `./script`.
- Produces:
  ```ts
  export const REPEAT_RUN_WORDS = 6
  export interface RepeatWarning { chapterIndex: number; warning: GutterWarning }
  export function findRepeats(
    chapters: readonly { index: number; contentMd: string }[],
  ): RepeatWarning[]
  ```

- [ ] **Step 1: Write the failing tests**

`packages/schemas/src/repetition.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { findRepeats, REPEAT_RUN_WORDS } from './repetition'

/**
 * The whole-script repetition check (decision 296). Deterministic and free:
 * a sentence that carries a six-word run an earlier chapter already narrated
 * is a gutter warning on the later chapter, naming the earlier one. A model
 * drafting chapter four cannot see chapter one's words; this pass can.
 */

const march = 'In the first quarter of 2024, according to The Information, Stability AI brought in under 5 million dollars in revenue.'

describe('findRepeats', () => {
  it('matches runs of six words', () => {
    expect(REPEAT_RUN_WORDS).toBe(6)
  })

  it('flags a sentence that repeats a run from an earlier chapter, naming it', () => {
    const repeats = findRepeats([
      { index: 0, contentMd: `${march} Hold on to that name.` },
      { index: 1, contentMd: 'A paper was posted. Nobody read it.' },
      {
        index: 3,
        contentMd: `So back to March. Revenue, according to The Information, was under 5 million dollars in revenue. Then the founder went too.`,
      },
    ])
    expect(repeats).toHaveLength(1)
    expect(repeats[0]).toEqual({
      chapterIndex: 3,
      warning: {
        kind: 'repeats-earlier',
        sentence: 'Revenue, according to The Information, was under 5 million dollars in revenue.',
        message: `Repeats chapter 1: "${march}"`,
      },
    })
  })

  it('does not flag a five-word overlap', () => {
    expect(
      findRepeats([
        { index: 0, contentMd: 'In the first quarter of 2024 the money ran out.' },
        { index: 1, contentMd: 'In the first quarter of 2023 the lawsuits began.' },
      ]),
    ).toEqual([])
  })

  it('sees through narration tags, punctuation and case', () => {
    const repeats = findRepeats([
      { index: 0, contentMd: 'Coatue had co-led the 101 million dollar round.' },
      { index: 1, contentMd: '[long pause] coatue had co-led the 101 million [pause] dollar round, and now it was asking questions.' },
    ])
    expect(repeats).toHaveLength(1)
    expect(repeats[0]!.warning.sentence).toBe(
      '[long pause] coatue had co-led the 101 million [pause] dollar round, and now it was asking questions.',
    )
  })

  it('does not flag a repeat inside one chapter', () => {
    expect(findRepeats([{ index: 0, contentMd: `${march} ${march}` }])).toEqual([])
    expect(
      findRepeats([
        { index: 0, contentMd: 'Nothing here is long enough.' },
        { index: 1, contentMd: `${march} ${march}` },
      ]),
    ).toEqual([])
  })

  it('writes one warning per sentence however many runs match', () => {
    const repeats = findRepeats([
      { index: 0, contentMd: march },
      { index: 1, contentMd: march },
    ])
    expect(repeats).toHaveLength(1)
  })

  it('quotes a long earlier sentence cut to 160 characters, tags stripped', () => {
    const long = `[measured] ${'word '.repeat(60).trim()}.`
    const repeats = findRepeats([
      { index: 0, contentMd: long },
      { index: 1, contentMd: 'word word word word word word, it said again.' },
    ])
    const message = repeats[0]!.warning.message
    expect(message.startsWith('Repeats chapter 1: "word word')).toBe(true)
    expect(message).not.toContain('[measured]')
    expect(message.length).toBeLessThanOrEqual('Repeats chapter 1: ""'.length + 163)
  })

  it('places the warning on a sentence that exists in the chapter text', () => {
    const contentMd = `Something new first.\n\n${march}\n\nAnd then more.`
    const repeats = findRepeats([{ index: 0, contentMd: march }, { index: 1, contentMd }])
    expect(contentMd.includes(repeats[0]!.warning.sentence)).toBe(true)
  })

  it('takes chapters in index order whatever the array order', () => {
    const repeats = findRepeats([
      { index: 1, contentMd: march },
      { index: 0, contentMd: march },
    ])
    expect(repeats.map((repeat) => repeat.chapterIndex)).toEqual([1])
  })

  it('is empty for one chapter or none', () => {
    expect(findRepeats([])).toEqual([])
    expect(findRepeats([{ index: 0, contentMd: march }])).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @boom-busters/schemas test -- repetition.test.ts`
Expected: FAIL, "Cannot find module './repetition'".

- [ ] **Step 3: Write `findRepeats`**

`packages/schemas/src/repetition.ts`:

```ts
import { splitSentences, stripNarrationMarkup } from './script'
import type { GutterWarning } from './script'

/**
 * The whole-script repetition check (decision 296).
 *
 * Chapters are drafted one at a time, and until this decision each draft saw
 * only the previous chapter's last two sentences; the Stability script told
 * March 2024 in full twice. The drafter now sees the script so far, and this
 * pass is the backstop: a sentence carrying a run of six words that an
 * earlier chapter already narrated becomes a gutter warning on the later
 * chapter, which parks the gate like any other warning. Deterministic and
 * free: no model call, so it runs in mock mode too.
 *
 * Six words, because the duplications worth a human's eye are figures with
 * their attribution ("under 5 million dollars in revenue"), and five-word
 * runs are common connective tissue ("in the first quarter of"). A repeat
 * inside one chapter is the prompt's business, not this pass's.
 */

export const REPEAT_RUN_WORDS = 6

/** How much of the earlier sentence the message quotes. */
const QUOTE_MAX = 160

export interface RepeatWarning {
  chapterIndex: number
  warning: GutterWarning
}

/** The words of a sentence as the ear hears them: no tags, no case, no punctuation. */
function words(sentence: string): string[] {
  return stripNarrationMarkup(sentence)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0)
}

function runs(sentence: string): string[] {
  const tokens = words(sentence)
  const found: string[] = []
  for (let at = 0; at + REPEAT_RUN_WORDS <= tokens.length; at++) {
    found.push(tokens.slice(at, at + REPEAT_RUN_WORDS).join(' '))
  }
  return found
}

function quote(sentence: string): string {
  const spoken = stripNarrationMarkup(sentence)
  return spoken.length > QUOTE_MAX ? `${spoken.slice(0, QUOTE_MAX).trimEnd()}...` : spoken
}

export function findRepeats(
  chapters: readonly { index: number; contentMd: string }[],
): RepeatWarning[] {
  const heard = new Map<string, { chapterIndex: number; sentence: string }>()
  const repeats: RepeatWarning[] = []

  for (const chapter of [...chapters].sort((a, b) => a.index - b.index)) {
    const own: { run: string; sentence: string }[] = []
    for (const sentence of splitSentences(chapter.contentMd)) {
      const sentenceRuns = runs(sentence)
      const earlier = sentenceRuns.map((run) => heard.get(run)).find((hit) => hit !== undefined)
      if (earlier) {
        repeats.push({
          chapterIndex: chapter.index,
          warning: {
            kind: 'repeats-earlier',
            sentence,
            message: `Repeats chapter ${earlier.chapterIndex + 1}: "${quote(earlier.sentence)}"`,
          },
        })
      }
      for (const run of sentenceRuns) own.push({ run, sentence })
    }
    // Remembered only once the whole chapter is scanned, so a chapter never
    // matches itself; the first sentence to say a run is the one quoted.
    for (const { run, sentence } of own) {
      if (!heard.has(run)) heard.set(run, { chapterIndex: chapter.index, sentence })
    }
  }

  return repeats
}
```

Add to `packages/schemas/src/index.ts`, after `export * from './script'`:

```ts
export * from './repetition'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @boom-busters/schemas test -- repetition.test.ts`
Expected: PASS.

Run: `pnpm --filter @boom-busters/schemas typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write packages/schemas/src/repetition.ts packages/schemas/src/repetition.test.ts packages/schemas/src/index.ts
git add packages/schemas/src/repetition.ts packages/schemas/src/repetition.test.ts packages/schemas/src/index.ts
git commit -m "feat(schemas): findRepeats flags a sentence that repeats an earlier chapter (decision 296)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The craft file learns callbacks, ownership and the return to the cold open

**Files:**
- Modify: `packages/providers/src/prompts/script-craft.md`
- Modify: `packages/providers/src/prompts/script-craft.ts` (re-embed; the constant must equal the markdown byte for byte)
- Test: `packages/providers/src/prompts/script-craft.test.ts`

**Interfaces:**
- Produces: `SCRIPT_CRAFT` carrying the new sections; no signature change.

- [ ] **Step 1: Write the failing tests**

Append to `describe('SCRIPT_CRAFT', ...)` in `script-craft.test.ts`:

```ts
  /**
   * Decision 296: the Stability script told its cold open twice, re-explained
   * the paper in three chapters and opened chapter four on chapter three's
   * ending. The craft file now says, in so many words, what a callback is and
   * that a recap is never written, where a fact lives, and what the return to
   * the opening may say.
   */
  it('teaches callbacks, one home per fact, and the return to the cold open', () => {
    expect(SCRIPT_CRAFT).toContain('## One home per fact')
    expect(SCRIPT_CRAFT).toContain('## Callbacks, not recaps')
    expect(SCRIPT_CRAFT).toContain('The opening is never told twice.')
    expect(SCRIPT_CRAFT).toContain('Never open a chapter by restating the previous chapter')
    expect(SCRIPT_CRAFT).toContain('revealed in exactly one chapter')
    expect(SCRIPT_CRAFT).toContain('40 to 60 per cent of the runtime')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @boom-busters/providers test -- script-craft.test.ts`
Expected: FAIL on the first `toContain`.

- [ ] **Step 3: Edit the markdown**

In `packages/providers/src/prompts/script-craft.md`, make these edits with the Edit tool. Every phrase the test asserts stays whole on one line.

Under `## Stakes before context`, after the "Stakes are concrete" bullet, add:

```markdown
- The cold open is a glimpse, not the chapter: a few sentences of
  consequence, most of the detail withheld. When the chronology reaches
  that moment again, one line of callback and then only new material.
  The opening is never told twice.
```

After the `## Stakes before context` section and before `## The question engine`, add:

```markdown
## One home per fact

- Every claim belongs to exactly one chapter, named in the outline. That
  chapter narrates it in full, once, with its attribution. Any other chapter
  refers to it in a few words at most: no figure, no date and no attribution
  repeated.
- The listener remembers. A person, a company, a paper or a figure is
  introduced once; afterwards it gets its name and nothing else.
```

Under `## Withholding`, after the "Every chapter has something it deliberately does not say" bullet, add:

```markdown
- A withheld fact is revealed in exactly one chapter, named in the outline
  as that chapter's reveal, and never revealed again.
```

Under `## Escalation`, after the "Each chapter's stakes are bigger" bullet, add:

```markdown
- The film sags in its middle. The chapter sitting at 40 to 60 per cent of the runtime
  turns hardest: a reversal, or the stakes reaching people who are not
  investors.
```

At the end of the file, add:

```markdown
## Callbacks, not recaps

- A callback is a few words that point back and add meaning: the name the
  listener was told to hold on to, now attached to a paper. A recap
  re-narrates. Write callbacks. Never write a recap, not at the end of a
  chapter and not in its middle.
- Never open a chapter by restating the previous chapter's ending. The
  listener has just heard it. The first sentence moves the story forward.
- Legal care is carried by the inline hedges: reportedly, according to,
  alleged. Never narrate the caveat as a sentence of its own: no "no court
  has found", no "that is an interpretation", no "the record shows the order
  of events and nothing more". Once in the whole film, where a listener would
  otherwise infer guilt, the outline's constraints may ask for one plain
  sentence that nothing has been proven.
```

- [ ] **Step 4: Re-embed the constant**

Replace the whole template literal in `packages/providers/src/prompts/script-craft.ts` with the new markdown, using the Write tool on the `.ts` file (keep the doc comment above the constant unchanged). The markdown contains no backticks or `${`, so the literal needs no escaping.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @boom-busters/providers test -- script-craft.test.ts`
Expected: PASS, including `is byte-identical to script-craft.md`.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write packages/providers/src/prompts/script-craft.ts packages/providers/src/prompts/script-craft.test.ts
git add packages/providers/src/prompts/script-craft.md packages/providers/src/prompts/script-craft.ts packages/providers/src/prompts/script-craft.test.ts
git commit -m "feat(providers): the craft file teaches callbacks, one home per fact and the return to the cold open (decision 296)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The outline prompt asks for a plan, and its parser repairs ownership

**Files:**
- Modify: `packages/providers/src/prompts/script.ts:156-201`
- Test: `packages/providers/src/prompts/script.test.ts` (`describe('buildOutlineRequest')`, `describe('parseOutline and parseShortsCandidates')`)

**Interfaces:**
- Consumes: `OUTLINE_BEAT_MAX`, `OutlineSchema` (Task 1); `trimField`, `dropItems`, `ignoreRepairs`, `Note` from `./repair`; `formatIssues`, `parseJsonCompletion` from `./json`.
- Produces: `parseOutline(text: string, note?: Note, claimCount?: number): Outline`. `buildOutlineRequest`'s signature is unchanged.

- [ ] **Step 1: Write the failing tests**

In `describe('buildOutlineRequest', ...)` add:

```ts
  /**
   * Decision 296: the outline is a plan. Beats are purpose, the facts are
   * the owned claims, the wording limits have a field of their own, and the
   * return to the cold open is one line.
   */
  it('asks for storylines, claim ownership, reveals and constraints', () => {
    expect(request.system).toContain('"storylines"')
    expect(request.system).toContain('"storyline"')
    expect(request.system).toContain('"claims": [number]')
    expect(request.system).toContain('"reveals"')
    expect(request.system).toContain('"constraints"')
    expect(request.system).toMatch(/exactly one chapter/)
    expect(request.system).toMatch(/never narrated/)
    expect(request.system).toMatch(/one to three sentences/)
    expect(request.system).toMatch(/one line of callback/)
    // The old instruction that produced fact-list beats is gone.
    expect(request.system).not.toMatch(/anything the chapter needs must be in these fields/)
  })
```

Replace `describe('parseOutline and parseShortsCandidates', ...)`'s two outline tests with this block (keep the Shorts tests in that describe as they are):

```ts
  it('reads a well-formed outline', () => {
    expect(parseOutline(JSON.stringify(mockOutline(10))).chapters.length).toBeGreaterThan(1)
  })

  it('rejects a single-chapter outline', () => {
    expect(() =>
      parseOutline(JSON.stringify({ chapters: [{ title: 'Only', beat: 'x'.repeat(30), targetWords: 300 }] })),
    ).toThrow(ValidationError)
  })

  /**
   * Decision 296: a beat over its limit is trimmed at a sentence, a claim
   * listed by two chapters stays with the first, and a number the claim list
   * does not have is dropped; each is reported, none refuses the outline.
   */
  describe('the outline repairs (decision 296)', () => {
    const chapter = (over: Partial<Record<string, unknown>>) => ({
      title: 'A chapter',
      beat: 'What it does.',
      targetWords: 300,
      ...over,
    })
    const collect = () => {
      const repairs: Repair[] = []
      const note: Note = (repair) => repairs.push(repair)
      return { repairs, note }
    }

    it('trims a beat over the limit at a sentence and names the chapter', () => {
      const { repairs, note } = collect()
      const long = `${'A sentence of purpose. '.repeat(40)}The tail.`
      const outline = parseOutline(
        JSON.stringify({ chapters: [chapter({ beat: long }), chapter({})] }),
        note,
      )
      expect(outline.chapters[0]!.beat.length).toBeLessThanOrEqual(600)
      expect(outline.chapters[0]!.beat.endsWith('.')).toBe(true)
      expect(repairs).toEqual([{ action: 'trimmed', field: "chapter 1's beat" }])
    })

    it('keeps a claim with its first owner and drops the later listing, saying whose it is', () => {
      const { repairs, note } = collect()
      const outline = parseOutline(
        JSON.stringify({
          chapters: [chapter({ claims: [1, 2] }), chapter({ claims: [2, 3] }), chapter({ claims: [3] })],
        }),
        note,
        3,
      )
      expect(outline.chapters.map((c) => c.claims)).toEqual([[1, 2], [3], []])
      expect(repairs).toEqual([
        { action: 'dropped', field: "chapter 2's claim 2", reason: 'already owned by chapter 1' },
        { action: 'dropped', field: "chapter 3's claim 3", reason: 'already owned by chapter 2' },
      ])
    })

    it('drops a number the claim list does not have, and anything that is not a number', () => {
      const { repairs, note } = collect()
      const outline = parseOutline(
        JSON.stringify({ chapters: [chapter({ claims: [1, 9, 'two', 0] }), chapter({})] }),
        note,
        3,
      )
      expect(outline.chapters[0]!.claims).toEqual([1])
      expect(repairs).toEqual([
        { action: 'dropped', field: "chapter 1's claim 9", reason: 'the claim list ends at 3' },
        { action: 'dropped', field: "chapter 1's claim two", reason: 'not a claim number' },
        { action: 'dropped', field: "chapter 1's claim 0", reason: 'not a claim number' },
      ])
    })

    it('keeps any number when the claim count is not given', () => {
      const outline = parseOutline(JSON.stringify({ chapters: [chapter({ claims: [40] }), chapter({})] }))
      expect(outline.chapters[0]!.claims).toEqual([40])
    })

    it('still refuses an outline it cannot repair, naming the field', () => {
      expect(() => parseOutline(JSON.stringify({ chapters: [{ title: 'No beat' }, chapter({})] }))).toThrow(
        /did not match the expected shape/,
      )
    })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @boom-busters/providers test -- script.test.ts`
Expected: FAIL. The system prompt lacks `"storylines"`; `parseOutline` takes one argument and reports nothing.

- [ ] **Step 3: Rewrite the outline system prompt**

In `buildOutlineRequest`, replace everything in the `system` template after `${SCRIPT_CRAFT}\n\n` with:

```ts
Produce a chapter plan totalling about ${targetWords} words:
{"centralQuestion": string,
 "storylines": [string],
 "chapters": [{"title": string, "storyline": string, "beat": string,
   "claims": [number], "question": string, "withhold": string,
   "reveals": string, "stakes": string, "constraints": string,
   "targetWords": number}]}

The plan, per chapter:
- "beat": one to three sentences on what the chapter accomplishes. Never a
  list of facts: the facts are the claims it owns.
- "claims": the numbers of the claims this chapter narrates in full, from the
  claim list below. Every claim belongs to exactly one chapter, the chapter
  where it lands hardest. A claim listed by two chapters stays with the first;
  the app drops the second listing. A chapter may still refer in a few words
  to a claim another chapter owns.
- "storyline": which of the film's "storylines" this chapter advances. Name
  two to four storylines for the film (the money, the credit, the courts).
  No storyline is absent for more than one chapter in a row.
- "reveals": the fact an earlier chapter withheld that this chapter reveals,
  if any. A withheld fact is revealed once.
- "constraints": the wording limits for this chapter: what must stay
  attributed and to whom, what is never stated as fact, which figures are
  unsourced and must not appear. They shape the words and are never narrated.
  Put the dossier's corrections here, not in the beat.

The tension contract, per chapter:
- "question": the open question this chapter plants and must NOT answer; the
  next chapter answers it.
- "withhold": the fact this chapter deliberately does not say, and which later
  chapter reveals it.
- "stakes": what is concretely at risk while this chapter runs: people,
  money, dates.
"centralQuestion" is the one question the whole film exists to answer; only
the final chapter answers it. Design the arc so each chapter's stakes are
larger or more personal than the last.

The opening chapter is a glimpse of the consequence in a few sentences, most
of its detail withheld. The chapter where the chronology returns to that
moment gets one line of callback and only the claims it owns.`,
```

- [ ] **Step 4: Rewrite `parseOutline` as a repairing parser**

Replace `parseOutline` with:

```ts
/**
 * The outline as the model answered it, repaired before it is validated
 * (decision 296, in decision 293's mould): a beat over its limit is trimmed
 * at a sentence; a claim number listed by two chapters stays with the first
 * and the later listing is dropped, as is a number the claim list does not
 * have. Each repair is reported; none refuses the outline. `claimCount` is
 * the length of the list the prompt printed; without it any number is kept.
 */
export function parseOutline(
  text: string,
  note: Note = ignoreRepairs,
  claimCount?: number,
): Outline {
  const answer = parseJsonCompletion(text, LooseAnswer, 'outline')
  const parsed = OutlineSchema.safeParse(repairOutline(answer, note, claimCount))
  if (!parsed.success) {
    throw new ValidationError(
      `The model's outline did not match the expected shape: ${formatIssues(parsed.error)}`,
      { field: 'outline' },
    )
  }
  return parsed.data
}

function repairOutline(
  answer: Record<string, unknown>,
  note: Note,
  claimCount: number | undefined,
): unknown {
  const chapters = answer['chapters']
  if (!Array.isArray(chapters)) return answer
  // Claim number -> the 1-based chapter that listed it first.
  const owners = new Map<number, number>()
  return {
    ...answer,
    chapters: chapters.map((chapter, at) => {
      if (!isRecord(chapter)) return chapter
      const label = `chapter ${at + 1}`
      const repaired: Record<string, unknown> = {
        ...chapter,
        beat: trimField(chapter['beat'], OUTLINE_BEAT_MAX, `${label}'s beat`, note),
      }
      if (Array.isArray(chapter['claims'])) {
        repaired['claims'] = dropItems(
          chapter['claims'],
          (item) => {
            if (typeof item !== 'number' || !Number.isInteger(item) || item < 1) {
              return 'not a claim number'
            }
            if (claimCount !== undefined && item > claimCount) {
              return `the claim list ends at ${claimCount}`
            }
            const owner = owners.get(item)
            if (owner !== undefined && owner !== at + 1) return `already owned by chapter ${owner}`
            owners.set(item, at + 1)
            return null
          },
          (item) => `${label}'s claim ${String(item)}`,
          note,
        )
      }
      return repaired
    }),
  }
}
```

Add `OUTLINE_BEAT_MAX` to the `@boom-busters/schemas` import at the top of `script.ts`. `LooseAnswer` and `isRecord` are already declared further down the file (one declaration per module); they are initialised before any parser runs, so `parseOutline` may use them from above.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @boom-busters/providers test -- script.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write packages/providers/src/prompts/script.ts packages/providers/src/prompts/script.test.ts
git add packages/providers/src/prompts/script.ts packages/providers/src/prompts/script.test.ts
git commit -m "feat(providers): the outline is a plan with one home per claim, and its parser repairs ownership (decision 296)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The chapter draft sees the script so far and its ownership brief

**Files:**
- Modify: `packages/providers/src/prompts/script.ts` (`HOUSE_STYLE`, `tensionContract`, `buildChapterRequest`, `chapterTail`, `mockOutline`)
- Test: `packages/providers/src/prompts/script.test.ts` (the `outline` fixture, `describe('tensionContract')`, `describe('buildChapterRequest')`, `describe('chapterTail')`, `describe('mock script output')`)

**Interfaces:**
- Consumes: `Outline` with the Task 1 fields.
- Produces:
  ```ts
  export function ownershipBrief(outline: Outline, chapterIndex: number): string
  export function buildChapterRequest(input: {
    caseTitle: string
    outline: Outline
    chapterIndex: number
    /** Every chapter drafted so far, in order, in full. */
    previousChapters: readonly { title: string; contentMd: string }[]
    claims: readonly ScriptClaim[]
  }): LLMTaskRequest
  ```
  `chapterTail` is removed. `tensionContract` gains the `reveals` and `constraints` lines. `mockOutline` carries every plan field.

- [ ] **Step 1: Update the fixture and write the failing tests**

Replace the `outline` fixture at the top of `script.test.ts` with:

```ts
// Parsed, so the fixture carries the exact Outline shape the runner holds.
// Chapter two has no tension fields — the pre-216 outlines still draft.
const outline = OutlineSchema.parse({
  centralQuestion: 'How did 1.9 billion euros never exist?',
  storylines: ['the money', 'the auditors'],
  chapters: [
    {
      title: 'The setup',
      beat: 'x'.repeat(30),
      storyline: 'the money',
      claims: [1],
      question: 'Why did the auditors keep signing?',
      withhold: 'The accounts in Manila were empty all along.',
      stakes: 'Thirty thousand pensions',
      constraints: 'Never state that the CEO knew; the claim is single-source.',
      targetWords: 800,
    },
    {
      title: 'The turn',
      beat: 'y'.repeat(30),
      claims: [2],
      reveals: 'The accounts in Manila were empty all along.',
      targetWords: 900,
    },
  ],
})
```

In `describe('tensionContract')`, add:

```ts
  it('carries the reveal and the wording limits (decision 296)', () => {
    expect(tensionContract(outline, 0)).toContain(
      'never narrated as sentences: Never state that the CEO knew; the claim is single-source.',
    )
    expect(tensionContract(outline, 1)).toContain(
      'Reveal here, for the first time, what an earlier chapter withheld: The accounts in Manila were empty all along.',
    )
    expect(tensionContract(outline, 0)).not.toContain('Reveal here')
  })
```

In `describe('buildChapterRequest')`, change the `request` at the top to:

```ts
  const request = buildChapterRequest({
    caseTitle: 'Enron',
    outline,
    chapterIndex: 1,
    previousChapters: [
      { title: 'The setup', contentMd: 'The auditors signed it anyway. The money was not there.' },
    ],
    claims,
  })
```

Replace the tests `seams onto the previous chapter` and `says it is the opening chapter when there is no tail` with:

```ts
  /**
   * Decision 296: the drafter reads every chapter so far, in full. With only
   * the previous tail it re-explained the paper in three chapters and told
   * March 2024 twice; it cannot avoid repeating what it has never seen.
   */
  it('hands the drafter every chapter so far, in full, and tells it to move forward', () => {
    const content = JSON.stringify(request.messages)
    expect(content).toContain('## 1. The setup')
    expect(content).toContain('The auditors signed it anyway. The money was not there.')
    expect(content).toContain('Never restate or paraphrase the ending')
    expect(content).not.toContain('Continue from there')
  })

  it('says it is the opening chapter when nothing is drafted yet', () => {
    const first = buildChapterRequest({
      caseTitle: 'Enron',
      outline,
      chapterIndex: 0,
      previousChapters: [],
      claims,
    })
    const content = JSON.stringify(first.messages)
    expect(content).toContain('opening chapter')
    expect(content).not.toContain('script so far')
  })

  it('briefs claim ownership: narrate in full, already told, belonging to later chapters', () => {
    const three = OutlineSchema.parse({
      chapters: [
        { title: 'One', beat: 'x'.repeat(30), claims: [1], targetWords: 300 },
        { title: 'Two', beat: 'y'.repeat(30), claims: [2, 3], targetWords: 300 },
        { title: 'Three', beat: 'z'.repeat(30), claims: [4], targetWords: 300 },
      ],
    })
    const brief = ownershipBrief(three, 1)
    expect(brief).toContain('Narrate in full, once, with attribution: [2], [3]')
    expect(brief).toContain('repeating no figure, date or attribution: [1]')
    expect(brief).toContain('Do not narrate: [4]')
    expect(JSON.stringify(request.messages)).toContain('Narrate in full, once, with attribution: [2]')
  })

  it('says "none" for an empty ownership line rather than leaving it blank', () => {
    expect(ownershipBrief(outline, 0)).toContain('repeating no figure, date or attribution: none')
  })

  it('sends no ownership brief for an outline drafted before the plan fields (decision 296)', () => {
    const bare = OutlineSchema.parse({
      chapters: [
        { title: 'Act one', beat: 'x'.repeat(30), targetWords: 300 },
        { title: 'Act two', beat: 'y'.repeat(30), targetWords: 300 },
      ],
    })
    expect(ownershipBrief(bare, 1)).toBe('')
    const without = buildChapterRequest({
      caseTitle: 'Enron',
      outline: bare,
      chapterIndex: 1,
      previousChapters: [{ title: 'Act one', contentMd: 'Words.' }],
      claims,
    })
    expect(without.messages.some((message) => message.content.includes('Claim ownership'))).toBe(false)
  })

  it('shows each chapter its storyline in the outline summary', () => {
    expect(JSON.stringify(request.messages)).toContain('1. The setup (the money)')
  })

  /**
   * Decision 296: the recap ban reaches mid-chapter, and legal care is the
   * inline hedge, never a sentence saying nothing was proven.
   */
  it('bans summing-up anywhere and narrated caveats', () => {
    expect(request.system).toMatch(/No summing-up anywhere/)
    expect(request.system).toMatch(/no paragraph in its middle restates/)
    expect(request.system).toMatch(/Never a\s+sentence of its own saying that nothing was proven/)
    expect(request.system).not.toMatch(/No summing-up closers/)
  })
```

Delete `describe('chapterTail', ...)` and remove `chapterTail` from the import list. In the existing test `carries the script-craft skill and the tension contract`, the `withoutContract` request is built with `previousTail: ''`; change that property to `previousChapters: []`.

In `describe('mock script output')`, add:

```ts
  it('carries every plan field so CI exercises the shape (decision 296)', () => {
    const mocked = mockOutline(10)
    expect(mocked.storylines?.length).toBeGreaterThan(0)
    expect(mocked.chapters[0]).toMatchObject({ storyline: expect.any(String), claims: [], constraints: expect.any(String) })
    expect(mocked.chapters[0]!.reveals).toBeUndefined()
    expect(mocked.chapters[1]!.reveals).toBe('Mock withheld fact 1')
  })
```

Add `ownershipBrief` to the import from `./script`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @boom-busters/providers test -- script.test.ts`
Expected: FAIL to compile on `previousChapters` and `ownershipBrief`.

- [ ] **Step 3: Edit `HOUSE_STYLE`**

With the Edit tool, replace:

```
- No summing-up closers. A chapter ends on its last fact, not on a
  restatement or a moral.
```

with:

```
- No summing-up anywhere. A chapter ends on its last fact, not on a
  restatement or a moral, and no paragraph in its middle restates what the
  listener has already heard.
```

And after the hard rule `- Never invent figures, dates, quotes or names.` add:

```
- Legal care is inline: "alleged", "reportedly", "according to". Never a
  sentence of its own saying that nothing was proven, that no court has
  found, or that this is an interpretation. The one exception is the film's
  single such sentence, where a chapter's constraints ask for it.
```

- [ ] **Step 4: Extend `tensionContract`, add `ownershipBrief` and the script-so-far message, rewrite `buildChapterRequest`, remove `chapterTail`**

In `tensionContract`, after the `withhold` block and before `return`:

```ts
  if (chapter.reveals) {
    lines.push(
      `- Reveal here, for the first time, what an earlier chapter withheld: ${chapter.reveals}`,
    )
  }
  if (chapter.constraints) {
    lines.push(
      `- Wording limits for this chapter. They shape the words and are never narrated as sentences: ` +
        chapter.constraints,
    )
  }
```

Before `buildChapterRequest`, add:

```ts
/**
 * Which claims this chapter narrates, which the listener has already heard,
 * and which are a later chapter's (decision 296). The numbers are the claim
 * list's, so the drafter needs no second list. Empty for an outline planned
 * before claims had homes: that script drafts as it did.
 */
export function ownershipBrief(outline: Outline, chapterIndex: number): string {
  if (!outline.chapters.some((chapter) => (chapter.claims?.length ?? 0) > 0)) return ''
  const numbers = (chapters: readonly OutlineChapter[]) =>
    chapters.flatMap((chapter) => chapter.claims ?? [])
  const list = (claims: number[]) =>
    claims.length > 0 ? claims.map((claim) => `[${claim}]`).join(', ') : 'none'
  const own = outline.chapters[chapterIndex]?.claims ?? []
  const told = numbers(outline.chapters.slice(0, chapterIndex))
  const later = numbers(outline.chapters.slice(chapterIndex + 1))
  return [
    "Claim ownership for this chapter (the numbers are the claim list's):",
    `- Narrate in full, once, with attribution: ${list(own)}`,
    `- Already told in an earlier chapter. The listener remembers: refer back in a few words at most, ` +
      `repeating no figure, date or attribution: ${list(told)}`,
    `- Belonging to a later chapter. Do not narrate: ${list(later)}`,
  ].join('\n')
}

/**
 * Every chapter drafted so far, in full. The previous chapter's last two
 * sentences, which this replaced, told the drafter where to resume and
 * nothing about what had been said; it restated the ending and re-explained
 * the rest. A chapter is one voice take, so the words are exactly as stored.
 */
function scriptSoFar(previous: readonly { title: string; contentMd: string }[]): string {
  if (previous.length === 0) return 'This is the opening chapter.'
  const text = previous
    .map((chapter, index) => `## ${index + 1}. ${chapter.title}\n\n${chapter.contentMd}`)
    .join('\n\n')
  return (
    `The script so far. The listener has just heard every word of it:\n\n${text}\n\n` +
    'Your first sentence moves the story forward. Never restate or paraphrase the ending ' +
    'above, and never re-introduce a person, a company or a figure it already introduced.'
  )
}
```

Import `OutlineChapter` as a type from `@boom-busters/schemas` beside `Outline`.

Replace `buildChapterRequest` with:

```ts
export function buildChapterRequest(input: {
  caseTitle: string
  outline: Outline
  chapterIndex: number
  /** Every chapter drafted so far, in order, in full (decision 296). */
  previousChapters: readonly { title: string; contentMd: string }[]
  claims: readonly ScriptClaim[]
}): LLMTaskRequest {
  const chapter = input.outline.chapters[input.chapterIndex]!
  const outlineSummary = input.outline.chapters
    .map(
      (c, i) =>
        `${i + 1}. ${c.title}${c.storyline ? ` (${c.storyline})` : ''}` +
        `${i === input.chapterIndex ? '  <- writing this one' : ''}`,
    )
    .join('\n')
  const storylines = input.outline.storylines
    ? `Storylines: ${input.outline.storylines.join('; ')}\n\n`
    : ''
  const ownership = ownershipBrief(input.outline, input.chapterIndex)
  const contract = tensionContract(input.outline, input.chapterIndex)

  return {
    task: 'scripting',
    system: `${HOUSE_STYLE}

${SCRIPT_CRAFT}

Write ONE chapter of narration as plain prose paragraphs. No headings, no
bullet points, no lists — the words are read aloud exactly as written, and
the bracketed narration tags the house style describes are the one thing in
the text that is direction rather than words. Place them inline as you draft.

Target about ${chapter.targetWords} words.`,
    messages: [
      // Stable across every chapter of the script, so it is the cacheable
      // prefix: the claim list is the largest part of this prompt and it does
      // not change between chapters.
      { role: 'user', content: `Case: ${input.caseTitle}\n\nClaims:\n${claimList(input.claims)}` },
      { role: 'user', content: `${storylines}Full outline:\n${outlineSummary}` },
      { role: 'user', content: scriptSoFar(input.previousChapters) },
      ...(ownership ? [{ role: 'user' as const, content: ownership }] : []),
      ...(contract ? [{ role: 'user' as const, content: contract }] : []),
      { role: 'user', content: `Write "${chapter.title}". It must: ${chapter.beat}` },
    ],
    cacheablePrefixMessages: 1,
    // A truncated chapter reads as a chapter that stops mid-sentence.
    maxTokens: outputBudget(Math.round(chapter.targetWords * 2.2)),
  }
}
```

Delete `chapterTail` and its doc comment.

- [ ] **Step 5: Update `mockOutline`**

```ts
export function mockOutline(targetRuntimeMin: number): Outline {
  const chapters = Math.max(2, Math.min(8, Math.round(targetRuntimeMin / 3)))
  const storylines = ['Mock storyline: the money', 'Mock storyline: the courts']

  return {
    centralQuestion: 'Mock central question — no provider designed an arc.',
    storylines,
    chapters: Array.from({ length: chapters }, (_, index) => ({
      title: `[mock] Chapter ${index + 1}`,
      beat: 'Placeholder beat produced in mock mode. Nothing was written by a provider.',
      storyline: storylines[index % 2]!,
      // Mock runs own no claims: the ownership brief is exercised by unit tests.
      claims: [],
      question: `Mock open question ${index + 1}`,
      withhold: `Mock withheld fact ${index + 1}`,
      ...(index > 0 ? { reveals: `Mock withheld fact ${index}` } : {}),
      stakes: `Mock stakes ${index + 1}`,
      constraints: 'Mock constraints: attribute every figure.',
      targetWords: 300,
    })),
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @boom-busters/providers test`
Expected: PASS across the package (the craft and script suites both touch these prompts).

Run: `pnpm --filter @boom-busters/providers typecheck`
Expected: clean. (`apps/web` is red until Task 6.)

- [ ] **Step 7: Commit**

```bash
pnpm exec prettier --write packages/providers/src/prompts/script.ts packages/providers/src/prompts/script.test.ts
git add packages/providers/src/prompts/script.ts packages/providers/src/prompts/script.test.ts
git commit -m "feat(providers): a chapter is drafted with the script so far and its ownership brief; no recaps, no narrated caveats (decision 296)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The runner drafts with the script so far, records the outline's repairs and stores the repeats

**Files:**
- Modify: `apps/web/lib/script-answers.ts:22-30`
- Modify: `apps/web/lib/script-answers.test.ts:22-38, 85-100`
- Modify: `apps/web/inngest/functions/script-runner.ts:16-25, 96-134, 199-335`
- Modify: `apps/web/inngest/functions/script-runner.test.ts:59-131` (the `markShortsStep` tests)
- Modify: `PROGRESS.md` (decision 296), `docs/03-build-spec.md:183`

**Interfaces:**
- Consumes: `parseOutline(text, note, claimCount)`, `buildChapterRequest({ previousChapters })` (Tasks 4, 5); `findRepeats` (Task 2).
- Produces: `draftOutlineWith(...): Promise<{ outline: Outline; repairs: Repair[] }>`; `markShortsStep(projectId, input, priorRepairs?: readonly Repair[])`.

- [ ] **Step 1: Write the failing tests**

In `apps/web/lib/script-answers.test.ts`, replace the first outline test with:

```ts
  it('drafts the outline in one call when the answer is good, with what it repaired', async () => {
    const complete = vi.fn().mockResolvedValue({ text: JSON.stringify(mockOutline(10)) })
    const drafted = await draftOutlineWith(complete, outlineInput)
    expect(drafted.outline.chapters.length).toBeGreaterThan(1)
    expect(drafted.repairs).toEqual([])
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('reports a claim listed by two chapters as a repair, against the claim list it sent (decision 296)', async () => {
    const outline = mockOutline(10)
    const doubled = {
      ...outline,
      chapters: outline.chapters.map((chapter, index) => ({
        ...chapter,
        claims: index < 2 ? [1] : [9],
      })),
    }
    const complete = vi.fn().mockResolvedValue({ text: JSON.stringify(doubled) })
    const drafted = await draftOutlineWith(complete, {
      ...outlineInput,
      claims: [{ id: 'c1', text: 'A claim.', sourceUrl: null, confidence: 'sourced' }],
    })
    expect(drafted.outline.chapters[0]!.claims).toEqual([1])
    expect(drafted.outline.chapters[1]!.claims).toEqual([])
    expect(drafted.repairs).toContainEqual({
      action: 'dropped',
      field: "chapter 2's claim 1",
      reason: 'already owned by chapter 1',
    })
    expect(drafted.repairs).toContainEqual({
      action: 'dropped',
      field: "chapter 3's claim 9",
      reason: 'the claim list ends at 1',
    })
  })
```

In the same file, `describe('the chapter draft (decision 293)')` builds its input as:

```ts
  const chapterInput = {
    caseTitle: 'Case',
    outline: mockOutline(10),
    chapterIndex: 1,
    previousTail: 'The money was gone.',
    claims: [],
  }
  const request = buildChapterRequest(chapterInput)
```

Replace the `previousTail` line with:

```ts
    previousChapters: [{ title: 'The audit', contentMd: 'The money was gone.' }],
```

`request` is built from the same object, so the tests that compare `complete`'s calls against it keep passing.

In `apps/web/inngest/functions/script-runner.test.ts`, inside `describe('markShortsStep (decision 293)')`, add:

```ts
  it('records the outline\'s repairs beside the marking\'s, so the strip keeps both (decision 296)', async () => {
    callLlm.mockResolvedValueOnce({ text: JSON.stringify({ candidates: [candidate] }) })
    const outlineRepair = { action: 'dropped' as const, field: "chapter 2's claim 1", reason: 'already owned by chapter 1' }
    await markShortsStep(PROJECT, { chapters }, [outlineRepair])
    expect(recordRepairs).toHaveBeenCalledWith(SCRIPT_NOTICES, [outlineRepair])
  })
```

This is the same stub shape the describe's first test uses (`callLlm.mockResolvedValueOnce({ text: JSON.stringify({ candidates: [...] }) })`), and `beforeEach` already resets `callLlm` and `recordRepairs`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter web test -- script-answers.test.ts`
Expected: FAIL: `drafted.outline` is undefined (the helper returns the outline itself) and the typecheck complains about `previousChapters`.

- [ ] **Step 3: Change the answer helper**

In `apps/web/lib/script-answers.ts`, replace `draftOutlineWith`:

```ts
/**
 * The outline, with what the parser repaired in it (decision 296): the
 * runner carries the repairs to the Shorts marking's notice so Script
 * Studio's strip shows both. The claim count is the list the prompt printed,
 * so a number past it is dropped rather than left to the drafter.
 */
export async function draftOutlineWith(
  complete: AnswerComplete,
  input: Parameters<typeof buildOutlineRequest>[0],
): Promise<{ outline: Outline; repairs: Repair[] }> {
  const answer = await callForAnswer({
    request: buildOutlineRequest(input),
    parse: (text, note) => parseOutline(text, note, input.claims.length),
    complete,
  })
  const outline = answerOrStop(answer, 'The outline could not be drafted')
  return { outline, repairs: answer.ok ? (answer.repairs ?? []) : [] }
}
```

Add `Outline` to the type import from `@boom-busters/schemas`.

- [ ] **Step 4: Change the runner**

In `apps/web/inngest/functions/script-runner.ts`:

Imports: remove `chapterTail` from the `@boom-busters/providers` import; add `findRepeats` to the value import from `@boom-busters/schemas`; add `import type { Repair } from '@boom-busters/providers'`.

`markShortsStep` gains a third parameter and records both lists:

```ts
export async function markShortsStep(
  projectId: string,
  input: Parameters<typeof markShortsWith>[1],
  /** The outline's repairs (decision 296), kept on the strip beside the marking's. */
  priorRepairs: readonly Repair[] = [],
): Promise<MarkedShorts> {
```

and, at the end, `await recordRepairs(target, [...priorRepairs, ...marked.repairs])`. In the catch branch nothing changes: a stop is added beside what is there.

The outline step returns the repairs too:

```ts
    const outlineStep = await step.run(
      'outline',
      async (): Promise<
        | { ok: true; outline: Outline; repairs?: Repair[] }
        | { ok: false; gate: Record<string, unknown> }
      > => {
        if (mocked) return { ok: true, outline: mockOutline(setup.targetRuntimeMin), repairs: [] }
        try {
          const drafted = await draftOutlineWith(completeForProject(projectId), {
            caseTitle: setup.caseTitle,
            dossierMd: setup.dossierMd,
            claims: setup.claims,
            targetRuntimeMin: setup.targetRuntimeMin,
          })
          return { ok: true, ...drafted }
        } catch (error) {
          if (error instanceof BudgetExceededError)
            return { ok: false, gate: budgetGateData(error) }
          throw error
        }
      },
    )
```

After `const outline = outlineStep.outline`:

```ts
    // A run parked before decision 296 replays this step without repairs.
    const outlineRepairs = outlineStep.repairs ?? []
```

In the chapter loop, replace `previousTail` with the chapters so far: delete `let previousTail = ''`, pass

```ts
                  previousChapters: written.map(({ title, contentMd }) => ({ title, contentMd })),
```

in place of `previousTail,`, and delete the line `previousTail = chapterTail(drafted.contentMd)`.

Before the self-check loop:

```ts
    // The whole-script repetition check (decision 296): deterministic, so it
    // is computed from the replayed chapters rather than inside a step, and
    // stored with each chapter's self-check warnings so a repeat parks the
    // gate like any other warning.
    const repeats = findRepeats(written)
```

In `self-check-${chapter.index}`, change the stored warnings:

```ts
        const own = repeats
          .filter((repeat) => repeat.chapterIndex === chapter.index)
          .map((repeat) => repeat.warning)
        await setChapterWarnings(db, chapter.chapterId, [...check.warnings, ...own])
```

and return `{ warnings: check.warnings.length + own.length, refs }`.

In the `mark-shorts` step, pass the outline's repairs:

```ts
      return markShortsStep(
        projectId,
        { chapters: written, tension: tensionFromOutline(outline) },
        outlineRepairs,
      )
```

- [ ] **Step 5: Run the tests to verify they pass**

Docker Desktop must be running for the runner's database suite (memory: test DB needs Docker Desktop). Queue the database run; never run two database suites at once.

Run: `pnpm --filter web test -- script-answers.test.ts script-runner.test.ts`
Expected: PASS.

Run: `pnpm typecheck && pnpm lint`
Expected: clean across the workspace.

Run: `pnpm test`
Expected: green. (The `e2e` suite is not part of `pnpm test`; the mock script run still parks at the gate on the mock self-check's warning, with repeat warnings now also on chapters two onward.)

- [ ] **Step 6: Record the decision**

Append to `PROGRESS.md` after decision 295, in the file's numbered style:

```
296. **The script remembers what it told** (2026-10-13, owner: "it repeats
     certain points quite often, and jumps around a bit"). The Stability AI
     script of 8 October (v3, Opus 5.5, the first under decision 216) told
     March 2024 in full twice, explained the CompVis paper in three chapters,
     opened chapter four on chapter three's ending and narrated nine
     sentences saying nothing was proven; 1.19 per cent of its six-word runs
     repeated an earlier chapter against 0.00 to 0.12 for every earlier
     script (Haiku 4.5, Sonnet 5, before 216). No script was ever drafted
     with Gemini. The causes were the pipeline's: a chapter drafted with the
     previous tail only, "continue from there", a cold-open rule with no
     return clause, beats as fact lists ("anything the chapter needs must be
     in these fields"), the dossier's corrections copied into every beat, a
     recap ban that reached only chapter endings. Opus followed all of it
     more faithfully than Sonnet had. Owner's ruling: fix the guardrails;
     no model comparison.
     What shipped: the outline is a plan: `storylines`, per chapter
     `storyline`, `claims` (1-based into the claim list; the parser keeps
     the first owner, drops a later listing or a number past the list as a
     `dropped` repair), `reveals` and `constraints` (wording limits, never
     narrated), all hints in the tension-field mould; beats are one to
     three sentences and trimmed at `OUTLINE_BEAT_MAX` (600). A chapter is
     drafted with every chapter so far in full, an ownership brief (narrate
     in full / already told, refer back in a few words / a later chapter's,
     do not narrate) and a seam rule that forbids restating the ending.
     The house style bans summing-up anywhere and narrated caveats; the
     craft file gains the cold open as a glimpse and its return as one line
     of callback, "One home per fact", "Callbacks, not recaps", the single
     reveal and the sag-point turn. `findRepeats` (schemas) flags a sentence
     carrying a six-word run an earlier chapter narrated as a gutter warning
     of the new kind `repeats-earlier`, stored with the self-check's, so it
     parks the gate; it runs in mock mode too, where every stand-in chapter
     repeats the first. The outline's repairs reach the Shorts strip beside
     the marking's. `chapterTail` is gone. No migration; a pre-296 outline
     drafts without a brief.
     Decisions made where the spec left room: six words for the repeat
     run (five is connective tissue, seven misses a figure with its
     attribution); the repeat check compares across chapters only, since a
     mid-chapter recap is the prompt's business and now banned there; the
     outline's repairs ride on the Shorts marking's notice rather than a
     notice of their own, because `recordRepairs` replaces a subject's notes
     and the marking lands last.
```

In `docs/03-build-spec.md` line 183, change `previous chapter tail` to `the script so far (every chapter drafted, in full) + its claim-ownership brief`, and after `gutter warnings (` add `"repeats chapter N", ` before the existing examples.

- [ ] **Step 7: Commit**

```bash
pnpm exec prettier --write apps/web/lib/script-answers.ts apps/web/lib/script-answers.test.ts apps/web/inngest/functions/script-runner.ts apps/web/inngest/functions/script-runner.test.ts
git add apps/web/lib/script-answers.ts apps/web/lib/script-answers.test.ts apps/web/inngest/functions/script-runner.ts apps/web/inngest/functions/script-runner.test.ts PROGRESS.md docs/03-build-spec.md
git commit -m "feat(web): the script runner drafts with the script so far, keeps the outline's repairs and stores the repeats (decision 296)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Verification after the last task

1. `pnpm format:check` on tracked files (memory: run format:check before every commit; while other sessions' worktrees exist, check tracked files only with `git ls-files ... | xargs -n 80`).
2. `pnpm typecheck && pnpm lint && pnpm test` green.
3. `pnpm e2e` in mock-provider mode: the project lifecycle still parks at the script gate; Script Studio shows `repeats-earlier` beside the mock warning on chapters two onward.
4. Merge `script-ownership` into `master` when green; renumber decision 296 only if `origin/master` took the number first (memory: decision numbers collide across sessions).
5. The first real run after deploy is the owner's: re-run the Stability AI script and score it with the six-word measure from the review (expected well under 1 per cent, no mid-chapter recaps, at most one "nothing was proven" sentence).
