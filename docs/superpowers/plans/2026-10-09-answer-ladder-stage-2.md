# Answer ladder stage 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every remaining model call states its limits, repairs what it safely can, costs at most two calls, and tells the owner on the card it concerns what was trimmed, dropped or why it stopped.

**Architecture:** Parsers report each repair through an optional `note` callback; `callForAnswer` returns the notes of the attempt that succeeded, treats a deliberate decline and a provider's content refusal as final, and gains a plain-text sibling `callForText`. One `notices` table holds a line per answer or stop, keyed by subject; one `Notices` component with a Dismiss button renders them on each card, and `markSideJobFailed` writes one when a side job stops while a gate is parked.

**Tech Stack:** pnpm/turbo monorepo; TypeScript; Zod 4 (`packages/schemas`); prompts and parsers (`packages/providers`); Drizzle on postgres.js with drizzle-kit migrations (`packages/db`); Next.js App Router with server actions and Inngest functions (`apps/web`); Vitest and Testing Library; Playwright e2e in mock-provider mode.

**Spec:** `docs/superpowers/specs/2026-10-09-answer-ladder-stage-2-design.md` (decision 293, stage 2 of 292). Stage 1's spec, for the helper's existing rules: `docs/superpowers/specs/2026-10-08-answer-ladder-design.md`.

## Global Constraints

- At most two calls per answer. Call 2 is the same request at double `maxTokens` after a cut-off (capped at `MAX_OUTPUT_TOKENS`, 32,000; no call 2 when already at the cap), or the request with the reason last after a refusal: `Your previous answer was refused: <reason>. Answer again in full with that fixed.` Never a third call.
- The rules, for every structured answer (spec section 2): (1) free text over its limit is trimmed at a sentence with `trimText`, with a notice; (2) a list over its cap keeps its first items, with a notice; (3) one item in a list that breaks a rule on a fact is dropped and the rest kept, with a notice; (4) an answer with nothing usable (no JSON, malformed JSON, a missing field, fewer items than the minimum once drops are made) is refused: one retry with the reason, then a stop; (5) a deliberate decline (`{"error": ...}`) is final, no retry; (6) facts are never edited: names, numbers, links, claim references, enums and the sentences a Short is anchored on; (7) every prompt states the limits its answer is checked against.
- The limits, in characters (spec section 2.1): research brief summary 5,000, turning point 2,000, principals 30, open questions 20; timeline what 1,000, date label 100 (over it the event is dropped), events 60; claims text 1,000 (over it the claim is dropped), claims 120; answers answer 3,000 (trimmed), echoed question 1,000 (over it the answer is dropped), answers 40, the answers pass's claims 40 (one list for the pass); case suggestions angle 2,000, demand notes 2,000, link note 500, title 200 (over it the suggestion is dropped), suggestions capped at the number asked, links 10; teaser title 90 (at a word), paragraph 400, paragraphs 5; cast identity 600, guardrail 600; retype graphic intent 300, intent references 6, map places 8; Shorts marking hook rationale 1,000, start or end sentence 2,000 (over it the segment is dropped), candidates 10.
- A case's priority score is rounded and clamped to 0 to 100, with a notice; a teaser paragraph whose chapter number is out of range is refused; a claim's text and an answer's echoed question are facts.
- A deliberate decline is `AnswerDeclined` (a `ValidationError` subclass): final after the call it came on, `{ ok: false, issue, calls, declined: true }`. A `ContentPolicyError` thrown by the call is final after that call: `{ ok: false, issue, calls }`.
- `callForText`: a reply flagged `truncated`, or the adapter's `ValidationError` on `maxTokens`, is a cut-off; it is asked once more at double the budget, and a second cut-off stops with `the answer was cut off at its length limit`. An empty reply is refused once with `the answer was empty`. Nothing half-written is kept.
- Notices: one row per answer or stop; `message` at most 1,000 characters (`NOTICE_MESSAGE_MAX`); subjects `project`, `direction`, `dossier`, `script`, `teaser`, `cast`, `slot`, `case`; kinds `trimmed`, `dropped`, `stopped`, `skipped`. An answer that lands calls `recordRepairs` (it retires the subject's open notices, then adds its line if any); a stop calls `recordStop`. Notice wording is plain words, never a field path.
- Inngest memoises step results: a new field a step returns is read with a default (`?? []`), because a run parked before the deploy replays results without it.
- Stops inside an Inngest step that the task does not report its own way are `NonRetriableError` with the reason (stage 1's `answerOrStop`).
- Mock-provider mode makes no paid call; nothing in this plan makes a live model call or runs any `pnpm live:*` script.
- NEVER run `pnpm db:migrate` (it targets the production database through `DATABASE_URL`). Migrations are generated with `pnpm db:generate` and applied to the test database with `pnpm db:migrate:test` only. The production migration is the controller's, after the merge, with the owner's go-ahead.
- `'use server'` files export only async functions (an exported const or type-only re-export of a value breaks every action in the segment).
- UI is button-first: every action is a visible labelled button. The `Notices` component's Dismiss is a `Button`.
- Before every commit: `pnpm exec prettier --write` then `--check` on the files touched, and `pnpm exec eslint --max-warnings 0` on them. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (a subagent may use its own model's name). Commit messages with quotes or backticks go through a file: `git commit -F <file>`.
- Long runs in the foreground with the Bash tool's `timeout: 600000`; never two database suites at once; Docker Desktop must be running for database tests. A task that changes a shared schema, prompt or parser runs every consuming package's suite.
- Code comments follow the surrounding style; South African spelling in prose (colour, organise); code identifiers as the codebase spells them.
- Work on branch `answer-ladder-2`; the spec is committed there (`9ca5b3a`).

## Review Focus

1. A notice whose subject no longer exists (a slot re-planned away, a cast member removed, a case deleted): the card that would show it is gone, and nothing else may break. `listProjectNotices` returns it harmlessly and no card renders it. Test: Task 2's "lists a notice for a slot that does not exist".
2. A run parked before the deploy replays a step's stored result without `repairs` (or without any other new field): the code reading it must take a default, not crash. Test: the two tasks that change what a step returns carry replay tests: Task 7 (the dossier's research steps, read with `?? []`) and Task 12 (`mark-shorts`, read through `readMarkedShorts`). Every other task writes its notices inside the step and leaves the step's result as it was.
3. One answer with many repairs (a research pass trimming 40 fields): the notice stays one readable line within 1,000 characters. Test: Task 1's "keeps a long repair line within the notice limit".
4. A clean second answer after a trimmed first one: the old "Trimmed to fit" must not linger on the card. Test: Task 2's "retires the subject's open notices when the next answer has none".
5. Dismissing a notice that another tab or a newer answer already retired: no error, nothing reappears. Test: Task 2's "dismisses twice without complaint" and Task 3's component test of a failed dismiss.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `packages/schemas/src/errors.ts` | `AnswerDeclined` | 1 |
| `packages/schemas/src/notices.ts` (new) | notice vocabulary: subjects, kinds, `NOTICE_MESSAGE_MAX`, `NoticeSchema`, `noticesFor` | 1 |
| `packages/providers/src/prompts/repair.ts` | `Repair`, `Note`, `ignoreRepairs`, `trimField`, `capList`, `dropItems`, `overLimit`, `describeRepairs` | 1 |
| `apps/web/lib/answer.ts` | notes, final decline and content refusal, `callForText` | 1 |
| `packages/db/src/schema.ts`, `packages/db/drizzle/0033_*.sql`, `packages/db/src/notices.ts` (new) | the `notices` table and its functions | 2 |
| `apps/web/lib/notices.ts` (new) | `recordRepairs`, `recordStop` | 3 |
| `apps/web/app/(console)/notice-actions.ts` (new) | `dismissNoticeAction` | 3 |
| `apps/web/components/notices.tsx` (new) | the amber line with Dismiss | 3 |
| `apps/web/app/(console)/projects/[id]/page.tsx` | loads the project's notices once; the project strip | 3 |
| `apps/web/inngest/lib/gates.ts` and its callers | `markSideJobFailed` subject | 4 |
| the call sites and cards of each area | Tasks 5 to 13 | 5 to 13 |

## Task order

1. The vocabulary and the helper (no dependencies)
2. The notices store (needs 1's schemas)
3. Notices in the app (needs 1, 2)
4. Side jobs that stop write a notice (needs 3)
5. The Director's Book reports its repairs (needs 1, 3)
6. Research: limits and repairs in the dossier parsers (needs 1)
7. Research on the helper, with dossier notices (needs 3, 6)
8. Case suggestions (needs 1, 3)
9. The teaser (needs 1, 3)
10. Cast identity (needs 1, 3)
11. Re-brief, redirect and retype (needs 1, 3, 4)
12. The Script stage's Shorts marking (needs 1, 3)
13. Plain text and title options (needs 1)
14. The e2e notice test, the full suite and PROGRESS (needs all)

---

### Task 1: The vocabulary and the helper

**Files:**
- Modify: `packages/schemas/src/errors.ts` (after `ValidationError`, around line 83)
- Create: `packages/schemas/src/notices.ts`
- Modify: `packages/schemas/src/index.ts` (export the new module)
- Test: `packages/schemas/src/notices.test.ts`
- Modify: `packages/providers/src/prompts/repair.ts`
- Test: `packages/providers/src/prompts/repair.test.ts`
- Modify: `apps/web/lib/answer.ts`
- Test: `apps/web/lib/answer.test.ts`

**Interfaces:**
- Consumes: stage 1's `trimText(text, max)` (`repair.ts`), `callForAnswer`, `withRefusal`, `answerOrStop`, `ANSWER_CUT_OFF` (`answer.ts`).
- Produces:
  - `@boom-busters/schemas`: `class AnswerDeclined extends ValidationError`; `NOTICE_SUBJECTS`, `NOTICE_KINDS`, `NOTICE_MESSAGE_MAX = 1000`; types `NoticeSubject`, `NoticeKind`, `NoticeTarget = { projectId: string | null; subject: NoticeSubject; subjectId: string | null }`, `NewNotice = { kind: NoticeKind; message: string }`, `Notice`; `NoticeSchema`; `noticesFor(notices, subject, subjectId = null): Notice[]`.
  - `@boom-busters/providers`: `type Repair = { action: 'trimmed'; field: string } | { action: 'capped'; field: string; kept: number } | { action: 'dropped'; field: string; reason: string } | { action: 'rounded'; field: string; from: number; to: number }`; `type Note = (repair: Repair) => void`; `ignoreRepairs: Note`; `trimField(value: unknown, max: number, field: string, note: Note): unknown`; `capList(value: unknown, max: number, field: string, note: Note): unknown`; `dropItems(value: unknown, bad: (item: unknown) => string | null, label: (item: unknown, index: number) => string, note: Note): unknown`; `overLimit(what: string, max: number): string`; `describeRepairs(repairs: readonly Repair[]): string | null`.
  - `@/lib/answer`: `Answer<T> = { ok: true; value: T; calls: 1 | 2; repairs?: Repair[] } | { ok: false; issue: string; calls: 1 | 2; declined?: true }`; `callForAnswer` takes `parse: (text: string, note: Note) => T` and an optional `truncatedIsCutOff?: boolean`; `callForText(input: { request: LLMTaskRequest; complete: AnswerComplete; cutOffIssue?: string }): Promise<Answer<string>>`; `EMPTY_ANSWER = 'the answer was empty'`. `repairs` is present only when at least one repair was noted.

- [ ] **Step 1: Write the failing schemas tests**

`AnswerDeclined` goes in the existing errors test if there is one; check `packages/schemas/src/errors.test.ts` and add there, else in `notices.test.ts` as below. Create `packages/schemas/src/notices.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { AnswerDeclined, ValidationError } from './errors'
import { NOTICE_MESSAGE_MAX, noticesFor } from './notices'
import type { Notice } from './notices'

const notice = (over: Partial<Notice>): Notice => ({
  id: '01J0000000000000000000000A',
  projectId: '01J0000000000000000000000P',
  subject: 'direction',
  subjectId: null,
  kind: 'trimmed',
  message: 'Trimmed to fit: era rule 1.',
  createdAt: new Date('2026-10-09T10:00:00Z'),
  ...over,
})

describe('notices (decision 293)', () => {
  it('picks the notices for one subject, and for one item of it', () => {
    const book = notice({ id: '01J0000000000000000000000B' })
    const slotA = notice({ id: '01J0000000000000000000000C', subject: 'slot', subjectId: 'A' })
    const slotB = notice({ id: '01J0000000000000000000000D', subject: 'slot', subjectId: 'B' })
    const all = [book, slotA, slotB]
    expect(noticesFor(all, 'direction')).toEqual([book])
    expect(noticesFor(all, 'slot', 'B')).toEqual([slotB])
    expect(noticesFor(all, 'slot')).toEqual([])
  })

  it('caps a message at 1,000 characters', () => {
    expect(NOTICE_MESSAGE_MAX).toBe(1000)
  })

  it('makes a deliberate decline a ValidationError, so existing catches still see a refusal', () => {
    const declined = new AnswerDeclined('there are no numbers to chart', { field: 'brief' })
    expect(declined).toBeInstanceOf(ValidationError)
    expect(declined.message).toBe('there are no numbers to chart')
    expect(declined.field).toBe('brief')
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/schemas && pnpm exec vitest run src/notices.test.ts`
Expected: FAIL, cannot resolve `./notices` and `AnswerDeclined` is not exported.

- [ ] **Step 3: Add `AnswerDeclined` and the notice vocabulary**

In `packages/schemas/src/errors.ts`, after the `ValidationError` class:

```ts
/**
 * The model declined the task in its own words (an `{"error": ...}` answer,
 * decision 293). A refusal to every catch that knows only `ValidationError`,
 * but final to the answer helper: asking again buys the same honest no.
 */
export class AnswerDeclined extends ValidationError {}
```

Create `packages/schemas/src/notices.ts`:

```ts
import { z } from 'zod'

/**
 * Notices (decision 293): one line on the card an answer concerns, saying
 * what a repair trimmed or dropped, or why a task stopped. The owner reads
 * it there and dismisses it; the next answer for the same subject retires it.
 */

export const NOTICE_SUBJECTS = [
  'project',
  'direction',
  'dossier',
  'script',
  'teaser',
  'cast',
  'slot',
  'case',
] as const

export const NOTICE_KINDS = ['trimmed', 'dropped', 'stopped', 'skipped'] as const

/** One readable line; a longer one is cut at a sentence before it is stored. */
export const NOTICE_MESSAGE_MAX = 1000

export type NoticeSubject = (typeof NOTICE_SUBJECTS)[number]
export type NoticeKind = (typeof NOTICE_KINDS)[number]

/** What a notice is about: a project-wide subject, or one cast member, slot or case. */
export type NoticeTarget = {
  projectId: string | null
  subject: NoticeSubject
  subjectId: string | null
}

export type NewNotice = { kind: NoticeKind; message: string }

export const NoticeSchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  subject: z.enum(NOTICE_SUBJECTS),
  subjectId: z.string().nullable(),
  kind: z.enum(NOTICE_KINDS),
  message: z.string(),
  createdAt: z.date(),
})

export type Notice = z.infer<typeof NoticeSchema>

/** The open notices for one subject, or one item of it, in the order given. */
export function noticesFor(
  notices: readonly Notice[],
  subject: NoticeSubject,
  subjectId: string | null = null,
): Notice[] {
  return notices.filter((notice) => notice.subject === subject && notice.subjectId === subjectId)
}
```

In `packages/schemas/src/index.ts`, add `export * from './notices'` beside the other module exports.

- [ ] **Step 4: Run the schemas tests to see them pass**

Run: `cd packages/schemas && pnpm exec vitest run src/notices.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing repair tests**

Append to `packages/providers/src/prompts/repair.test.ts` (add the new names to its import from `./repair`, and import `NOTICE_MESSAGE_MAX` from `@boom-busters/schemas`):

```ts
describe('repair notes (decision 293)', () => {
  const collect = () => {
    const notes: Repair[] = []
    const note: Note = (repair) => {
      notes.push(repair)
    }
    return { notes, note }
  }

  it('trims a long field and reports it, and leaves a short or non-string value alone', () => {
    const { notes, note } = collect()
    expect(trimField('short', 20, 'the summary', note)).toBe('short')
    expect(trimField(42, 20, 'the summary', note)).toBe(42)
    expect(notes).toEqual([])
    expect(trimField('One sentence here. Two sentence here.', 25, 'the summary', note)).toBe(
      'One sentence here.',
    )
    expect(notes).toEqual([{ action: 'trimmed', field: 'the summary' }])
  })

  it('keeps the first items of a long list and reports how many', () => {
    const { notes, note } = collect()
    expect(capList([1, 2], 2, 'never-shows', note)).toEqual([1, 2])
    expect(capList('not a list', 2, 'never-shows', note)).toBe('not a list')
    expect(notes).toEqual([])
    expect(capList([1, 2, 3], 2, 'never-shows', note)).toEqual([1, 2])
    expect(notes).toEqual([{ action: 'capped', field: 'never-shows', kept: 2 }])
  })

  it('drops the items that break a rule, keeps the rest, and names each drop', () => {
    const { notes, note } = collect()
    const tooLong = (item: unknown) =>
      typeof item === 'string' && item.length > 3 ? 'its text ran long' : null
    expect(dropItems(['ok', 'far too long', 'no'], tooLong, (_, at) => `claim ${at + 1}`, note)).toEqual(
      ['ok', 'no'],
    )
    expect(notes).toEqual([{ action: 'dropped', field: 'claim 2', reason: 'its text ran long' }])
    expect(dropItems('not a list', tooLong, () => 'x', note)).toBe('not a list')
  })

  it('says what ran over and by how much, in words', () => {
    expect(overLimit('its text', 1000)).toBe('its text ran over 1,000 characters')
  })

  it('describes the repairs of one answer as one line, grouped by action', () => {
    expect(describeRepairs([])).toBeNull()
    expect(
      describeRepairs([
        { action: 'trimmed', field: 'era rule 1' },
        { action: 'capped', field: 'never-shows', kept: 12 },
        { action: 'trimmed', field: "Emad Mostaque's identity" },
        { action: 'dropped', field: 'claim 37', reason: 'its text ran over 1,000 characters' },
        { action: 'rounded', field: 'the priority score of Stability AI', from: 105, to: 100 },
      ]),
    ).toBe(
      "Trimmed to fit: era rule 1; Emad Mostaque's identity. Kept the first 12 never-shows. " +
        'Dropped claim 37: its text ran over 1,000 characters. ' +
        'Rounded the priority score of Stability AI from 105 to 100.',
    )
  })

  it('keeps a long repair line within the notice limit', () => {
    const many: Repair[] = Array.from({ length: 200 }, (_, at) => ({
      action: 'trimmed' as const,
      field: `the answer to open question ${at + 1}`,
    }))
    const line = describeRepairs(many)
    expect(line).not.toBeNull()
    expect(line!.length).toBeLessThanOrEqual(NOTICE_MESSAGE_MAX)
  })

  it('lets a parser outside the helper repair without reporting', () => {
    expect(trimField('a b c d e f', 5, 'x', ignoreRepairs)).toBe('a b c')
  })
})
```

- [ ] **Step 6: Run them to see them fail**

Run: `cd packages/providers && pnpm exec vitest run src/prompts/repair.test.ts`
Expected: FAIL, `trimField` (and the rest) are not exported.

- [ ] **Step 7: Add the repair notes**

Append to `packages/providers/src/prompts/repair.ts` (add `import { NOTICE_MESSAGE_MAX } from '@boom-busters/schemas'` at the top):

```ts
/**
 * One change a parser made to a model's answer instead of refusing it
 * (decision 293). `field` is already words for the owner ("era rule 1",
 * "claim 37"), never a path: it is shown on the card the answer lands on.
 */
export type Repair =
  | { action: 'trimmed'; field: string }
  | { action: 'capped'; field: string; kept: number }
  | { action: 'dropped'; field: string; reason: string }
  | { action: 'rounded'; field: string; from: number; to: number }

/** Where a parser reports a repair; the answer helper collects them per attempt. */
export type Note = (repair: Repair) => void

/** For a parser called outside the helper: the repairs still happen, unreported. */
export const ignoreRepairs: Note = () => {}

/** `trimText`, reporting the trim. Anything but a string is left for the schema to refuse. */
export function trimField(value: unknown, max: number, field: string, note: Note): unknown {
  if (typeof value !== 'string') return value
  const trimmed = trimText(value, max)
  if (trimmed !== value) note({ action: 'trimmed', field })
  return trimmed
}

/** The first `max` items of a list, reporting the cut. Anything but a list is left alone. */
export function capList(value: unknown, max: number, field: string, note: Note): unknown {
  if (!Array.isArray(value) || value.length <= max) return value
  note({ action: 'capped', field, kept: max })
  return value.slice(0, max)
}

/**
 * The items of a list `bad` has no reason against; each one dropped is
 * reported under `label`, counted from the list as the model wrote it.
 */
export function dropItems(
  value: unknown,
  bad: (item: unknown) => string | null,
  label: (item: unknown, index: number) => string,
  note: Note,
): unknown {
  if (!Array.isArray(value)) return value
  return value.filter((item, index) => {
    const reason = bad(item)
    if (reason === null) return true
    note({ action: 'dropped', field: label(item, index), reason })
    return false
  })
}

/** "its text ran over 1,000 characters": a drop's reason in words. */
export function overLimit(what: string, max: number): string {
  return `${what} ran over ${max.toLocaleString('en-GB')} characters`
}

/** One line for the owner saying what an answer's repairs changed, or null when nothing was. */
export function describeRepairs(repairs: readonly Repair[]): string | null {
  if (repairs.length === 0) return null
  const parts: string[] = []
  const trimmed = repairs.filter((repair) => repair.action === 'trimmed').map((r) => r.field)
  if (trimmed.length > 0) parts.push(`Trimmed to fit: ${trimmed.join('; ')}.`)
  for (const repair of repairs) {
    if (repair.action === 'capped') parts.push(`Kept the first ${repair.kept} ${repair.field}.`)
    if (repair.action === 'dropped') parts.push(`Dropped ${repair.field}: ${repair.reason}.`)
    if (repair.action === 'rounded') {
      parts.push(`Rounded ${repair.field} from ${repair.from} to ${repair.to}.`)
    }
  }
  return trimText(parts.join(' '), NOTICE_MESSAGE_MAX)
}
```

Check that `packages/providers/src/prompts/index.ts` re-exports everything from `./repair` (stage 1 exported `trimText` there; if it lists names, add the new ones).

- [ ] **Step 8: Run the repair tests to see them pass**

Run: `cd packages/providers && pnpm exec vitest run src/prompts/repair.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing helper tests**

In `apps/web/lib/answer.test.ts`, extend the imports:

```ts
import type { LLMTaskRequest, Note } from '@boom-busters/providers'
import {
  AnswerDeclined,
  BudgetExceededError,
  ContentPolicyError,
  ValidationError,
} from '@boom-busters/schemas'
import { ANSWER_CUT_OFF, EMPTY_ANSWER, answerOrStop, callForAnswer, callForText } from './answer'
```

and append:

```ts
describe('repairs and final answers (decision 293)', () => {
  it('returns the repairs noted on the attempt that succeeded, not the refused one', async () => {
    const complete = answers('bad', 'good')
    const parse = (text: string, note: Note) => {
      note({ action: 'trimmed', field: `the ${text} summary` })
      if (text !== 'good') throw new ValidationError('bad answer', { field: 'answer' })
      return 'parsed'
    }
    expect(await callForAnswer({ request, parse, complete })).toEqual({
      ok: true,
      value: 'parsed',
      calls: 2,
      repairs: [{ action: 'trimmed', field: 'the good summary' }],
    })
  })

  it('leaves repairs off an answer nothing was repaired in', async () => {
    const answer = await callForAnswer({ request, parse, complete: answers('good') })
    expect('repairs' in answer).toBe(false)
  })

  it('takes a deliberate decline as final, after one call', async () => {
    const complete = answers('declined')
    const declining = () => {
      throw new AnswerDeclined('there are no numbers to chart', { field: 'brief' })
    }
    expect(await callForAnswer({ request, parse: declining, complete })).toEqual({
      ok: false,
      issue: 'there are no numbers to chart',
      calls: 1,
      declined: true,
    })
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('takes a decline on the retry as final too', async () => {
    const complete = answers('bad', 'declined')
    const declining = (text: string) => {
      if (text === 'declined') throw new AnswerDeclined('no person can be shown', { field: 'brief' })
      throw new ValidationError('bad answer', { field: 'answer' })
    }
    expect(await callForAnswer({ request, parse: declining, complete })).toEqual({
      ok: false,
      issue: 'no person can be shown',
      calls: 2,
      declined: true,
    })
  })

  it("takes a provider's content refusal as final, after one call", async () => {
    const complete = vi
      .fn()
      .mockRejectedValueOnce(new ContentPolicyError('anthropic', 'the request was declined'))
    expect(await callForAnswer({ request, parse, complete })).toEqual({
      ok: false,
      issue: 'anthropic: the request was declined',
      calls: 1,
    })
    expect(complete).toHaveBeenCalledTimes(1)
  })
})

describe('callForText (decision 293)', () => {
  const replies = (...replies: { text: string; truncated?: boolean }[]) => {
    const complete = vi.fn()
    for (const reply of replies) complete.mockResolvedValueOnce(reply)
    return complete
  }

  it('takes a whole reply in one call', async () => {
    const complete = replies({ text: 'A whole digest.' })
    expect(await callForText({ request, complete })).toEqual({
      ok: true,
      value: 'A whole digest.',
      calls: 1,
    })
  })

  it('asks once more at double the budget when the reply is truncated, keeping nothing half-written', async () => {
    const complete = replies({ text: 'Half a', truncated: true }, { text: 'A whole digest.' })
    expect(await callForText({ request, complete })).toEqual({
      ok: true,
      value: 'A whole digest.',
      calls: 2,
    })
    expect(complete).toHaveBeenLastCalledWith({ ...request, maxTokens: 2000 }, 'retry: cut off')
  })

  it('stops after a second truncated reply', async () => {
    const complete = replies({ text: 'Half', truncated: true }, { text: 'Half again', truncated: true })
    expect(await callForText({ request, complete })).toEqual({
      ok: false,
      issue: ANSWER_CUT_OFF,
      calls: 2,
    })
  })

  it('stops after one call when a truncated reply was already at the cap', async () => {
    const complete = replies({ text: 'Half', truncated: true })
    const atCap = { ...request, maxTokens: MAX_OUTPUT_TOKENS }
    expect(await callForText({ request: atCap, complete })).toEqual({
      ok: false,
      issue: ANSWER_CUT_OFF,
      calls: 1,
    })
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it("counts the adapter's empty-reply error as a cut-off", async () => {
    const complete = vi
      .fn()
      .mockRejectedValueOnce(new ValidationError('no text at max_tokens', { field: 'maxTokens' }))
      .mockResolvedValueOnce({ text: 'A whole chapter.' })
    expect(await callForText({ request, complete })).toEqual({
      ok: true,
      value: 'A whole chapter.',
      calls: 2,
    })
    expect(complete).toHaveBeenLastCalledWith({ ...request, maxTokens: 2000 }, 'retry: cut off')
  })

  it('refuses an empty reply once, with the reason', async () => {
    const complete = replies({ text: '   ' }, { text: 'A whole passage.' })
    expect(await callForText({ request, complete })).toEqual({
      ok: true,
      value: 'A whole passage.',
      calls: 2,
    })
    const [retry, call] = complete.mock.calls[1]!
    expect(call).toBe('retry: refused')
    expect(retry.messages.at(-1)?.content).toContain(EMPTY_ANSWER)
  })
})
```

- [ ] **Step 10: Run them to see them fail**

Run: `cd apps/web && pnpm exec vitest run lib/answer.test.ts`
Expected: FAIL, `callForText` and `EMPTY_ANSWER` are not exported, and the decline and content-refusal cases retry.

- [ ] **Step 11: Implement the helper changes**

In `apps/web/lib/answer.ts`:

Imports become:

```ts
import { MAX_OUTPUT_TOKENS } from '@boom-busters/providers'
import type { LLMTaskRequest, Note, Repair } from '@boom-busters/providers'
import { AnswerDeclined, ContentPolicyError, ValidationError } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
```

Add one paragraph to the module comment, after the existing ones:

```ts
 * Decision 293: a parser reports each repair it makes through `note`, and an
 * answer carries the repairs of the attempt that succeeded, for the card it
 * lands on. A deliberate decline and a provider's content refusal are final:
 * the same request would be declined again. `callForText` is the plain-text
 * sibling, where a truncated reply is always a cut-off.
```

Replace `Answer<T>`, `Attempt<T>`, `attempt` and `callForAnswer` with:

```ts
export type Answer<T> =
  | { ok: true; value: T; calls: 1 | 2; repairs?: Repair[] }
  | { ok: false; issue: string; calls: 1 | 2; declined?: true }

export const EMPTY_ANSWER = 'the answer was empty'

type Attempt<T> =
  | { ok: true; value: T; repairs: Repair[] }
  | { ok: false; cutOff: boolean; final: boolean; declined: boolean; issue: string }

type AnswerInput<T> = {
  request: LLMTaskRequest
  /** Repairs (reporting each through `note`), then validates; throws `ValidationError` for an answer it cannot use. */
  parse: (text: string, note: Note) => T
  complete: AnswerComplete
  /** Rebuilds the request for the retry after a refusal; by default the reason is added last. */
  retryWithReason?: (reason: string) => LLMTaskRequest
  /** What a final cut-off reports; `ANSWER_CUT_OFF` by default. */
  cutOffIssue?: string
  /** Plain text: a reply flagged as truncated is a cut-off even when it parses. */
  truncatedIsCutOff?: boolean
}

const refused = (issue: string, cutOff = false): Attempt<never> => ({
  ok: false,
  cutOff,
  final: false,
  declined: false,
  issue,
})

async function attempt<T>(
  input: AnswerInput<T>,
  request: LLMTaskRequest,
  call: AnswerCall,
): Promise<Attempt<T>> {
  let reply: { text: string; truncated?: boolean }
  try {
    reply = await input.complete(request, call)
  } catch (error) {
    // Only a cut-off from the call is the answer's fault; anything else the
    // call throws (a rejected key, a budget stop, a provider error) is not.
    if (isCutOff(error)) return refused(error.message, true)
    // The provider refused the content: the identical request is refused again.
    if (error instanceof ContentPolicyError) {
      return { ok: false, cutOff: false, final: true, declined: false, issue: error.message }
    }
    // A call-side ValidationError (a rejected key, an exhausted balance, a
    // preflight miss) is wrapped as spec 2.1 says: Inngest would retry it blind.
    if (error instanceof ValidationError) {
      throw new NonRetriableError(error.message, { cause: error })
    }
    throw error
  }
  if (input.truncatedIsCutOff && reply.truncated === true) return refused(ANSWER_CUT_OFF, true)
  const repairs: Repair[] = []
  try {
    const value = input.parse(reply.text, (repair) => {
      repairs.push(repair)
    })
    return { ok: true, value, repairs }
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error
    if (error instanceof AnswerDeclined) {
      return { ok: false, cutOff: false, final: true, declined: true, issue: error.message }
    }
    return refused(error.message, isCutOff(error) || reply.truncated === true)
  }
}

function landed<T>(attempted: { value: T; repairs: Repair[] }, calls: 1 | 2): Answer<T> {
  return attempted.repairs.length > 0
    ? { ok: true, value: attempted.value, calls, repairs: attempted.repairs }
    : { ok: true, value: attempted.value, calls }
}

function stopped(issue: string, calls: 1 | 2, declined: boolean): Answer<never> {
  return declined ? { ok: false, issue, calls, declined: true } : { ok: false, issue, calls }
}

export async function callForAnswer<T>(input: AnswerInput<T>): Promise<Answer<T>> {
  const cutOffIssue = input.cutOffIssue ?? ANSWER_CUT_OFF
  const first = await attempt(input, input.request, 'answer')
  if (first.ok) return landed(first, 1)
  if (first.final) return stopped(first.issue, 1, first.declined)

  let retry: LLMTaskRequest
  let call: AnswerCall
  if (first.cutOff) {
    // The same budget is cut off at the same place; only a bigger one can help.
    if (input.request.maxTokens >= MAX_OUTPUT_TOKENS) return stopped(cutOffIssue, 1, false)
    retry = {
      ...input.request,
      maxTokens: Math.min(MAX_OUTPUT_TOKENS, input.request.maxTokens * 2),
    }
    call = 'retry: cut off'
  } else {
    retry = input.retryWithReason
      ? input.retryWithReason(first.issue)
      : withRefusal(input.request, first.issue)
    call = 'retry: refused'
  }

  const second = await attempt(input, retry, call)
  if (second.ok) return landed(second, 2)
  return stopped(second.cutOff ? cutOffIssue : second.issue, 2, second.declined)
}

/**
 * A plain-text answer (a chapter, the weekly digest, a rewritten passage):
 * the same two calls, but a truncated reply is always a cut-off, so nothing
 * half-written is kept, and an empty reply is refused once with its reason.
 */
export function callForText(input: {
  request: LLMTaskRequest
  complete: AnswerComplete
  cutOffIssue?: string
}): Promise<Answer<string>> {
  return callForAnswer({
    ...input,
    parse: (text) => {
      if (text.trim() === '') throw new ValidationError(EMPTY_ANSWER, { field: 'text' })
      return text
    },
    truncatedIsCutOff: true,
  })
}
```

`answerOrStop`, `withRefusal`, `isCutOff`, `AnswerCall`, `AnswerComplete` and `ANSWER_CUT_OFF` stay as they are.

- [ ] **Step 12: Run the helper tests, then every consumer's suite**

Run: `cd apps/web && pnpm exec vitest run lib/answer.test.ts`
Expected: PASS (stage 1's tests unchanged, plus the new ones).

Then, because `callForAnswer`'s parse type changed: `cd apps/web && pnpm exec vitest run lib/plan-chapter.test.ts lib/graphic-design.test.ts lib/candidate-scoring.test.ts lib/script-answers.test.ts`, then `cd packages/providers && pnpm test`, `cd packages/schemas && pnpm test`, and `pnpm typecheck` from the root (each with `timeout: 600000`).
Expected: all PASS; typecheck clean.

- [ ] **Step 13: Commit**

```bash
git add packages/schemas/src/errors.ts packages/schemas/src/notices.ts packages/schemas/src/notices.test.ts packages/schemas/src/index.ts packages/providers/src/prompts/repair.ts packages/providers/src/prompts/repair.test.ts packages/providers/src/prompts/index.ts apps/web/lib/answer.ts apps/web/lib/answer.test.ts
git commit -F <message file>
```

Message: `feat(answer): repairs travel with the answer, declines are final, and plain text has its own helper (decision 293)` plus the trailer.

---

### Task 2: The notices store

**Files:**
- Modify: `packages/db/src/schema.ts` (new enums and table, after `castMembers` or at the end of the tables)
- Create: `packages/db/drizzle/0033_<generated>.sql` and its `meta` snapshot (generated)
- Create: `packages/db/src/notices.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/notices.integration.test.ts`

**Interfaces:**
- Consumes: `NOTICE_SUBJECTS`, `NOTICE_KINDS`, `NOTICE_MESSAGE_MAX`, `NoticeSchema`, `NoticeTarget`, `NewNotice`, `Notice` (Task 1, `@boom-busters/schemas`).
- Produces (`@boom-busters/db`): `notices` table; `NoticeRow`; `replaceNotices(db: Database, target: NoticeTarget, list: readonly NewNotice[]): Promise<void>`; `addNotice(db, target, notice: NewNotice): Promise<void>`; `listProjectNotices(db, projectId: string): Promise<Notice[]>` (open notices, newest first); `listCaseNotices(db, caseIds: readonly string[]): Promise<Notice[]>`; `dismissNotice(db, noticeId: string): Promise<void>`.

- [ ] **Step 1: Write the failing integration tests**

Create `packages/db/src/notices.integration.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createCase, truncateCases } from './cases'
import { createDb } from './client'
import {
  addNotice,
  dismissNotice,
  listCaseNotices,
  listProjectNotices,
  replaceNotices,
} from './notices'
import { createProjectFromCase, deleteProjectsExcept } from './projects'
import { requireTestDatabase } from './test-database'

/** Notices (decision 293) against the test container. */
const url = requireTestDatabase()
const suite = url ? describe : describe.skip

suite('notices', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })
  let projectId = ''

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  beforeEach(async () => {
    await deleteProjectsExcept(db, [])
    await truncateCases(db)
    await sql`DELETE FROM notices`
    const kase = await createCase(db, { title: 'Stability AI', category: 'collapse' })
    projectId = (await createProjectFromCase(db, { caseId: kase.id, title: 'Stability AI' })).id
  })

  const direction = () => ({ projectId, subject: 'direction' as const, subjectId: null })

  it('adds a notice and lists it with the project, newest first', async () => {
    await addNotice(db, direction(), { kind: 'stopped', message: 'The redraft stopped: first.' })
    await addNotice(db, direction(), { kind: 'stopped', message: 'The redraft stopped: second.' })
    const listed = await listProjectNotices(db, projectId)
    expect(listed.map((notice) => notice.message)).toEqual([
      'The redraft stopped: second.',
      'The redraft stopped: first.',
    ])
    expect(listed[0]).toMatchObject({ subject: 'direction', subjectId: null, kind: 'stopped' })
  })

  it("retires the subject's open notices when the next answer has none", async () => {
    await replaceNotices(db, direction(), [{ kind: 'trimmed', message: 'Trimmed to fit: era rule 1.' }])
    await replaceNotices(db, direction(), [])
    expect(await listProjectNotices(db, projectId)).toEqual([])
  })

  it('replaces only its own subject, and only the item named', async () => {
    const slotA = { projectId, subject: 'slot' as const, subjectId: 'slot-a' }
    const slotB = { projectId, subject: 'slot' as const, subjectId: 'slot-b' }
    await addNotice(db, slotA, { kind: 'stopped', message: 'The re-brief stopped: A.' })
    await addNotice(db, slotB, { kind: 'stopped', message: 'The re-brief stopped: B.' })
    await addNotice(db, direction(), { kind: 'trimmed', message: 'Trimmed to fit: era rule 1.' })
    await replaceNotices(db, slotA, [{ kind: 'trimmed', message: 'Trimmed to fit: the intent.' }])
    const messages = (await listProjectNotices(db, projectId)).map((notice) => notice.message)
    expect(messages.sort()).toEqual([
      'The re-brief stopped: B.',
      'Trimmed to fit: era rule 1.',
      'Trimmed to fit: the intent.',
    ])
  })

  it('cuts a message to 1,000 characters before storing it', async () => {
    await addNotice(db, direction(), { kind: 'trimmed', message: 'x'.repeat(1500) })
    const [notice] = await listProjectNotices(db, projectId)
    expect(notice?.message.length).toBe(1000)
  })

  it('dismisses a notice, and dismisses twice without complaint', async () => {
    await addNotice(db, direction(), { kind: 'stopped', message: 'The redraft stopped.' })
    const [notice] = await listProjectNotices(db, projectId)
    await dismissNotice(db, notice!.id)
    await dismissNotice(db, notice!.id)
    expect(await listProjectNotices(db, projectId)).toEqual([])
  })

  it('lists a notice for a slot that does not exist, for the board to ignore', async () => {
    await addNotice(db, { projectId, subject: 'slot', subjectId: 'gone' }, {
      kind: 'stopped',
      message: 'The retype stopped.',
    })
    expect(await listProjectNotices(db, projectId)).toHaveLength(1)
  })

  it('keeps Case Library notices apart from projects, by case', async () => {
    const one = await createCase(db, { title: 'Theranos', category: 'fraud' })
    const two = await createCase(db, { title: 'FTX', category: 'fraud' })
    await addNotice(db, { projectId: null, subject: 'case', subjectId: one.id }, {
      kind: 'trimmed',
      message: 'Trimmed to fit: the angle.',
    })
    await addNotice(db, { projectId: null, subject: 'case', subjectId: two.id }, {
      kind: 'trimmed',
      message: 'Trimmed to fit: the demand notes.',
    })
    expect((await listCaseNotices(db, [one.id])).map((notice) => notice.message)).toEqual([
      'Trimmed to fit: the angle.',
    ])
    expect(await listCaseNotices(db, [])).toEqual([])
    expect(await listProjectNotices(db, projectId)).toEqual([])
  })

  it('goes with its project', async () => {
    await addNotice(db, direction(), { kind: 'stopped', message: 'The redraft stopped.' })
    await deleteProjectsExcept(db, [])
    const [{ count }] = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM notices`
    expect(count).toBe('0')
  })
})
```

Check `createCase`'s category values against `caseCategoryEnum` in `schema.ts` before running (the cast test uses `'collapse'`; use any two valid categories for the Case Library test).

- [ ] **Step 2: Add the table**

In `packages/db/src/schema.ts` (import `NOTICE_KINDS` and `NOTICE_SUBJECTS` from `@boom-busters/schemas`, and `index` from `drizzle-orm/pg-core` if it is not imported yet):

```ts
export const noticeSubjectEnum = pgEnum('notice_subject', NOTICE_SUBJECTS)
export const noticeKindEnum = pgEnum('notice_kind', NOTICE_KINDS)

/**
 * Notices (decision 293): a line on the card an answer concerns, saying what a
 * repair trimmed or dropped, or why a task stopped. `subject_id` names the cast
 * member, slot or case for those subjects and is null for a project-wide one;
 * `project_id` is null for the Case Library. Retired notices keep their row
 * with `dismissed_at` set, by the owner's Dismiss or by the next answer.
 */
export const notices = pgTable(
  'notices',
  {
    id: id(),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    subject: noticeSubjectEnum('subject').notNull(),
    subjectId: text('subject_id'),
    kind: noticeKindEnum('kind').notNull(),
    message: text('message').notNull(),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('notices_subject_idx').on(t.projectId, t.subject, t.subjectId)],
)

export type NoticeRow = typeof notices.$inferSelect
```

Drizzle 0.45's `pgEnum` takes a readonly tuple (`T extends Readonly<[U, ...U[]]>`), so the `as const` lists from `@boom-busters/schemas` pass straight in and the column types stay literal.

- [ ] **Step 3: Generate and apply the migration to the test database**

Run: `pnpm db:generate` from the root.
Expected: a new `packages/db/drizzle/0033_<name>.sql` creating the two enums, the `notices` table, its foreign key with `ON DELETE cascade` and the index; plus an updated `meta/_journal.json` and a new snapshot. Read the SQL; it must contain nothing else.

Run: `pnpm db:migrate:test` from the root (Docker Desktop running).
Expected: the migration applies. NEVER run `pnpm db:migrate`.

- [ ] **Step 4: Add the functions**

Create `packages/db/src/notices.ts`:

```ts
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { NOTICE_MESSAGE_MAX, NoticeSchema } from '@boom-busters/schemas'
import type { NewNotice, Notice, NoticeTarget } from '@boom-busters/schemas'
import type { Database } from './client'
import { notices } from './schema'
import type { NoticeRow } from './schema'

/**
 * Notices (decision 293). An answer that lands replaces its subject's open
 * notices (`replaceNotices`, an empty list included, so a clean answer retires
 * the old note); a stop adds one (`addNotice`). The cards read a project's
 * open notices once and pick theirs with `noticesFor`.
 */

function toNotice(row: NoticeRow): Notice {
  return NoticeSchema.parse({
    id: row.id,
    projectId: row.projectId,
    subject: row.subject,
    subjectId: row.subjectId,
    kind: row.kind,
    message: row.message,
    createdAt: row.createdAt,
  })
}

const openFor = (target: NoticeTarget) =>
  and(
    target.projectId === null
      ? isNull(notices.projectId)
      : eq(notices.projectId, target.projectId),
    eq(notices.subject, target.subject),
    target.subjectId === null
      ? isNull(notices.subjectId)
      : eq(notices.subjectId, target.subjectId),
    isNull(notices.dismissedAt),
  )

const toRow = (target: NoticeTarget, notice: NewNotice) => ({
  projectId: target.projectId,
  subject: target.subject,
  subjectId: target.subjectId,
  kind: notice.kind,
  message: notice.message.slice(0, NOTICE_MESSAGE_MAX),
})

export async function replaceNotices(
  db: Database,
  target: NoticeTarget,
  list: readonly NewNotice[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(notices).set({ dismissedAt: new Date() }).where(openFor(target))
    if (list.length > 0) await tx.insert(notices).values(list.map((notice) => toRow(target, notice)))
  })
}

export async function addNotice(
  db: Database,
  target: NoticeTarget,
  notice: NewNotice,
): Promise<void> {
  await db.insert(notices).values(toRow(target, notice))
}

export async function listProjectNotices(db: Database, projectId: string): Promise<Notice[]> {
  const rows = await db
    .select()
    .from(notices)
    .where(and(eq(notices.projectId, projectId), isNull(notices.dismissedAt)))
    .orderBy(desc(notices.createdAt), desc(notices.id))
  return rows.map(toNotice)
}

export async function listCaseNotices(
  db: Database,
  caseIds: readonly string[],
): Promise<Notice[]> {
  if (caseIds.length === 0) return []
  const rows = await db
    .select()
    .from(notices)
    .where(
      and(
        isNull(notices.projectId),
        eq(notices.subject, 'case'),
        inArray(notices.subjectId, [...caseIds]),
        isNull(notices.dismissedAt),
      ),
    )
    .orderBy(desc(notices.createdAt), desc(notices.id))
  return rows.map(toNotice)
}

/** Dismissing an already retired notice is a no-op: a stale tab must not error. */
export async function dismissNotice(db: Database, noticeId: string): Promise<void> {
  await db
    .update(notices)
    .set({ dismissedAt: new Date() })
    .where(and(eq(notices.id, noticeId), isNull(notices.dismissedAt)))
}
```

Add `export * from './notices'` to `packages/db/src/index.ts`. `newId()` ids are ULIDs and sort by time, so `desc(notices.id)` breaks ties between two notices written in the same millisecond.

- [ ] **Step 5: Run the integration tests**

Run: `cd packages/db && pnpm exec vitest run src/notices.integration.test.ts` (`timeout: 600000`, alone).
Expected: PASS (8 tests).

- [ ] **Step 6: Run the db suite and the typecheck**

Run: `cd packages/db && pnpm test` (alone), then `pnpm typecheck` from the root.
Expected: PASS; clean.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle packages/db/src/notices.ts packages/db/src/notices.integration.test.ts packages/db/src/index.ts
git commit -F <message file>
```

Message: `feat(db): a notices table for what an answer repaired or why a task stopped (decision 293)` plus the trailer.

---

### Task 3: Notices in the app

**Files:**
- Create: `apps/web/lib/notices.ts`
- Test: `apps/web/lib/notices.test.ts`
- Create: `apps/web/app/(console)/notice-actions.ts`
- Create: `apps/web/components/notices.tsx`
- Test: `apps/web/components/notices.test.tsx`
- Modify: `apps/web/app/(console)/projects/[id]/page.tsx` (load the notices; the project strip beside `StageBanner`, around line 431)

**Interfaces:**
- Consumes: `describeRepairs`, `Repair` (Task 1); `replaceNotices`, `addNotice`, `listProjectNotices`, `dismissNotice` (Task 2); `noticesFor`, `Notice`, `NoticeTarget` (Task 1).
- Produces:
  - `@/lib/notices`: `recordRepairs(target: NoticeTarget, repairs?: readonly Repair[]): Promise<void>` (retires the subject's open notices, then adds one `trimmed` or `dropped` line when there are repairs; kind `dropped` when any repair dropped an item); `recordStop(target: NoticeTarget, kind: 'stopped' | 'skipped', message: string): Promise<void>`.
  - `@/app/(console)/notice-actions`: `dismissNoticeAction(noticeId: string): Promise<{ ok: true } | { ok: false; error: string }>`.
  - `@/components/notices`: `Notices({ notices }: { notices: readonly Notice[] })`, a client component rendering nothing (and calling no hook) for an empty list. A component test that renders a card WITH notices must mock `next/navigation` (`useRouter: () => ({ refresh })`) and `@/app/(console)/notice-actions` (`dismissNoticeAction`); every test of a card that imports `Notices` mocks `@/app/(console)/notice-actions`, since that module imports `@/auth`.
  - `page.tsx` holds `const notices = await listProjectNotices(db, project.id)`; later tasks pass `noticesFor(notices, '<subject>', <id>)` down to their card.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/notices.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const replaceNotices = vi.fn()
const addNotice = vi.fn()
vi.mock('@boom-busters/db', () => ({ replaceNotices, addNotice }))
vi.mock('@/lib/db', () => ({ db: { marker: 'db' } }))

const { recordRepairs, recordStop } = await import('./notices')

const target = { projectId: 'P', subject: 'direction' as const, subjectId: null }

describe('recording notices (decision 293)', () => {
  beforeEach(() => {
    replaceNotices.mockReset()
    addNotice.mockReset()
  })

  it('replaces the subject with one trimmed line when an answer was trimmed', async () => {
    await recordRepairs(target, [{ action: 'trimmed', field: 'era rule 1' }])
    expect(replaceNotices).toHaveBeenCalledWith({ marker: 'db' }, target, [
      { kind: 'trimmed', message: 'Trimmed to fit: era rule 1.' },
    ])
  })

  it('marks the line dropped when any item was dropped', async () => {
    await recordRepairs(target, [
      { action: 'trimmed', field: 'the summary' },
      { action: 'dropped', field: 'claim 3', reason: 'its text ran over 1,000 characters' },
    ])
    expect(replaceNotices.mock.calls[0]![2]).toEqual([
      {
        kind: 'dropped',
        message:
          'Trimmed to fit: the summary. Dropped claim 3: its text ran over 1,000 characters.',
      },
    ])
  })

  it('retires the old notes when a clean answer lands', async () => {
    await recordRepairs(target)
    expect(replaceNotices).toHaveBeenCalledWith({ marker: 'db' }, target, [])
  })

  it('adds a stop without retiring the notes already there', async () => {
    await recordStop(target, 'stopped', 'The redraft stopped: the answer was cut off.')
    expect(addNotice).toHaveBeenCalledWith({ marker: 'db' }, target, {
      kind: 'stopped',
      message: 'The redraft stopped: the answer was cut off.',
    })
    expect(replaceNotices).not.toHaveBeenCalled()
  })
})
```

Create `apps/web/components/notices.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Notice } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
const dismissNoticeAction = vi.fn()
vi.mock('@/app/(console)/notice-actions', () => ({ dismissNoticeAction }))

const { Notices } = await import('./notices')

const notice = (id: string, message: string): Notice => ({
  id,
  projectId: '01J0000000000000000000000P',
  subject: 'direction',
  subjectId: null,
  kind: 'trimmed',
  message,
  createdAt: new Date('2026-10-09T10:00:00Z'),
})

describe('Notices (decision 293)', () => {
  beforeEach(() => {
    refresh.mockReset()
    dismissNoticeAction.mockReset()
  })

  it('renders nothing without notices', () => {
    const { container } = render(<Notices notices={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows each notice with its own Dismiss button', () => {
    render(
      <Notices
        notices={[
          notice('01J0000000000000000000000A', 'Trimmed to fit: era rule 1.'),
          notice('01J0000000000000000000000B', 'The redraft stopped: cut off.'),
        ]}
      />,
    )
    expect(screen.getAllByRole('status').map((line) => line.textContent)).toEqual([
      expect.stringContaining('Trimmed to fit: era rule 1.'),
      expect.stringContaining('The redraft stopped: cut off.'),
    ])
    expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(2)
  })

  it('dismisses a notice and refreshes the page', async () => {
    dismissNoticeAction.mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    render(<Notices notices={[notice('01J0000000000000000000000A', 'Trimmed to fit: era rule 1.')]} />)
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(dismissNoticeAction).toHaveBeenCalledWith('01J0000000000000000000000A')
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('says so when a dismiss fails, and keeps the notice', async () => {
    dismissNoticeAction.mockResolvedValue({ ok: false, error: 'Unknown id' })
    const user = userEvent.setup()
    render(<Notices notices={[notice('01J0000000000000000000000A', 'Trimmed to fit: era rule 1.')]} />)
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not dismiss: Unknown id')
    expect(refresh).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeEnabled()
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/web && pnpm exec vitest run lib/notices.test.ts components/notices.test.tsx`
Expected: FAIL, the modules do not exist.

- [ ] **Step 3: Write `recordRepairs` and `recordStop`**

Create `apps/web/lib/notices.ts`:

```ts
import { addNotice, replaceNotices } from '@boom-busters/db'
import { describeRepairs } from '@boom-busters/providers'
import type { Repair } from '@boom-busters/providers'
import type { NoticeTarget } from '@boom-busters/schemas'
import { db } from '@/lib/db'

/**
 * Notices (decision 293). An answer that lands for a subject replaces that
 * subject's open notices with one line of its repairs, or with none, so a
 * clean answer retires the old note. A stop is added beside what is there:
 * the notes of the answer the owner still has stay true.
 */
export async function recordRepairs(
  target: NoticeTarget,
  repairs: readonly Repair[] = [],
): Promise<void> {
  const message = describeRepairs(repairs)
  const kind = repairs.some((repair) => repair.action === 'dropped') ? 'dropped' : 'trimmed'
  await replaceNotices(db, target, message === null ? [] : [{ kind, message }])
}

export async function recordStop(
  target: NoticeTarget,
  kind: 'stopped' | 'skipped',
  message: string,
): Promise<void> {
  await addNotice(db, target, { kind, message })
}
```

- [ ] **Step 4: Write the dismiss action**

Create `apps/web/app/(console)/notice-actions.ts` (a `'use server'` file: export only async functions):

```ts
'use server'

import { dismissNotice } from '@boom-busters/db'
import { UlidSchema } from '@boom-busters/schemas'
import { auth } from '@/auth'
import { db } from '@/lib/db'

/** The Dismiss button on a notice (decision 293). The caller refreshes its page. */
export async function dismissNoticeAction(
  noticeId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth()
  if (!session?.user?.email) throw new Error('Not signed in')
  if (!UlidSchema.safeParse(noticeId).success) return { ok: false, error: 'Unknown id' }
  await dismissNotice(db, noticeId)
  return { ok: true }
}
```

`UlidSchema` comes from `@boom-busters/schemas` (`packages/schemas/src/ids.ts`), as `visuals-actions.ts` imports it.

- [ ] **Step 5: Write the component**

Create `apps/web/components/notices.tsx`:

```tsx
'use client'

import type { Notice } from '@boom-busters/schemas'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { dismissNoticeAction } from '@/app/(console)/notice-actions'
import { Button } from '@/components/ui/button'

/**
 * The notices on one card (decision 293): what an answer's repair trimmed or
 * dropped, or why a task stopped, each with its own Dismiss button. Styled as
 * the slot card's re-type box, so every card says these things the same way.
 * With nothing to say it renders nothing and calls no hook, so a card test
 * with no notices needs no router.
 */
export function Notices({ notices }: { notices: readonly Notice[] }) {
  return notices.length === 0 ? null : <NoticeList notices={notices} />
}

function NoticeList({ notices }: { notices: readonly Notice[] }) {
  const router = useRouter()
  const [pending, setPending] = useState<string | null>(null)
  const [failed, setFailed] = useState<{ id: string; error: string } | null>(null)

  async function dismiss(id: string) {
    setPending(id)
    setFailed(null)
    const result = await dismissNoticeAction(id)
    setPending(null)
    if (result.ok) router.refresh()
    else setFailed({ id, error: result.error })
  }

  return (
    <div className="flex flex-col gap-2">
      {notices.map((notice) => (
        <div
          key={notice.id}
          className="flex flex-wrap items-center gap-2 rounded-[8px] border border-[var(--color-warning)] p-2"
        >
          <p role="status" className="min-w-0 flex-1 text-[13px] text-[var(--color-warning)]">
            {notice.message}
          </p>
          <Button
            variant="outline"
            busy={pending === notice.id}
            disabled={pending !== null}
            onClick={() => void dismiss(notice.id)}
          >
            Dismiss
          </Button>
          {failed?.id === notice.id ? (
            <p role="alert" className="w-full text-[13px] text-[var(--color-danger)]">
              Could not dismiss: {failed.error}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  )
}
```

`--color-danger` is the theme's error colour (defined beside `--color-warning` in the theme tokens).

- [ ] **Step 6: Run the tests**

Run: `cd apps/web && pnpm exec vitest run lib/notices.test.ts components/notices.test.tsx`
Expected: PASS (8 tests).

- [ ] **Step 7: Load the notices on the project page and show the project strip**

In `apps/web/app/(console)/projects/[id]/page.tsx`:

- Import `listProjectNotices` from `@boom-busters/db` (in the existing import block from it) and `noticesFor` from `@boom-busters/schemas`, and `Notices` from `@/components/notices`.
- After the project is loaded (the `Promise.all` at line ~176 is the natural place: add `listProjectNotices(db, project.id)` to it, or one `await` after it), hold `const notices = ...`.
- Directly before `<StageBanner` (line ~431), render `<Notices notices={noticesFor(notices, 'project')} />`.

Later tasks pass `noticesFor(notices, ...)` to their cards from this same `notices` value; do not load notices anywhere else on this page.

- [ ] **Step 8: Run the page's tests and the typecheck**

Run: `cd apps/web && pnpm exec vitest run "app/(console)/projects/[id]"` (`timeout: 600000`; it includes database tests, so alone), then `pnpm typecheck` from the root.
Expected: PASS; clean. If a page test mocks `@boom-busters/db` with a fixed list of functions, add `listProjectNotices: vi.fn().mockResolvedValue([])` to that mock.

- [ ] **Step 9: Commit**

```bash
git add apps/web/lib/notices.ts apps/web/lib/notices.test.ts "apps/web/app/(console)/notice-actions.ts" apps/web/components/notices.tsx apps/web/components/notices.test.tsx "apps/web/app/(console)/projects/[id]/page.tsx"
git commit -F <message file>
```

Message: `feat(notices): a Dismiss-able line on the card an answer concerns, and the project strip (decision 293)` plus the trailer.

---

### Task 4: Side jobs that stop write a notice

**Files:**
- Modify: `apps/web/lib/answer.ts` (`answerOrStop`, at the end of the file, stage 1's lines 121 to 129)
- Test: `apps/web/lib/answer.test.ts` (the `answerOrStop (decision 292)` describe, line ~191)
- Modify: `apps/web/inngest/lib/gates.ts` (imports lines 9 to 13; `markSideJobFailed`, lines 229 to 255)
- Test: `apps/web/inngest/lib/gates.test.ts` (imports lines 3 to 37; the `markSideJobFailed` describe, lines 319 to 347) (database)
- Modify: `apps/web/inngest/functions/visuals-replanner.ts` (imports line 25 to 27; `redraft-book` catch lines 111 to 115; `redraft-over-budget` line 121; `redraft-stopped` line 127)
- Test: `apps/web/inngest/functions/visuals-replanner.test.ts` (imports lines 3 to 35; mocks lines 44 to 46; a new test after line 212) (database)
- Modify: `apps/web/inngest/functions/slot-rebriefer.ts` (import line 38; lines 115, 278, 323)
- Modify: `apps/web/inngest/functions/slot-refetcher.ts` (import line 15; lines 56, 120)
- Modify: `apps/web/inngest/functions/slot-redirector.ts` (import line 32; lines 65, 132, 180)
- Modify: `apps/web/inngest/functions/slot-retyper.ts` (import line 35; lines 102, 228, 289, 328)
- Test: `apps/web/inngest/functions/slot-retyper.test.ts` (imports lines 3 to 24; mocks lines 33 to 36; a new test after line 253) (database)
- Modify: `apps/web/inngest/functions/teaser-rebuild-runner.ts` (imports lines 6 to 7; `onFailure` lines 48 to 59; `fail` lines 65 to 74)
- Test: `apps/web/inngest/functions/teaser-rebuild-runner.test.ts` (imports lines 24 to 27; mocks lines 45 to 46; the refusal test lines 204 to 218) (database)

**Interfaces:**
- Consumes: `recordStop(target, kind, message)` (Task 3, `@/lib/notices`); `NoticeSubject` (Task 1, `@boom-busters/schemas`); `listProjectNotices` and the `notices` table (Task 2, `@boom-busters/db`, tests only); stage 1's `answerOrStop`, `ANSWER_CUT_OFF` (`@/lib/answer`).
- Produces:
  - `apps/web/inngest/lib/gates.ts`: `type SideJobSubject = { subject: NoticeSubject; subjectId?: string | null }`; `markSideJobFailed(ctx: GateContext, title: string, error: Record<string, unknown>, subject?: SideJobSubject): Promise<void>` (while the project is `awaiting_review` it calls `recordStop({ projectId: ctx.projectId, subject: subject?.subject ?? 'project', subjectId: subject?.subjectId ?? null }, 'stopped', '<title>: <message>')` then `notify`; otherwise it fails the stage as today and writes no notice); `slotSubject(slotId: unknown): SideJobSubject | undefined`.
  - `@/lib/answer`: `class AnswerStopped extends NonRetriableError { readonly issue: string }`, which `answerOrStop` now throws. Its message is unchanged (`<what>: <issue>`) and its `name` stays `NonRetriableError`, so Inngest and every existing `instanceof NonRetriableError` catch still see a stop. Task 11 and later callers of `markSideJobFailed` pass `slotSubject(slotId)` or `{ subject: '<subject>' }`.

Every caller of `markSideJobFailed` under `apps/web` (19 calls; the spec's twentieth is the teaser rebuild, which reports through its own `fail()` and is handled below):

| File:line | Step or handler | Title | Argument it gains |
|---|---|---|---|
| `visuals-replanner.ts:78` | `onFailure` | `The fix failed` / `The re-plan failed` | none (`project`) |
| `visuals-replanner.ts:121` | `redraft-over-budget` | `The redraft stopped` | `{ subject: 'direction' }` |
| `visuals-replanner.ts:127` | `redraft-stopped` | `The redraft stopped` | `{ subject: 'direction' }`; the message becomes `<reason>. The book you had is kept.` |
| `visuals-replanner.ts:252` | `repair-N-over-budget` | `The fix stopped` | none (`project`) |
| `visuals-replanner.ts:346` | `replan-N-over-budget` | `The re-plan stopped` | none (`project`) |
| `visuals-replanner.ts:365` | `replan-graphic-N-over-budget` | `The re-plan stopped` | none (`project`) |
| `visuals-replanner.ts:375` | `replan-empty` | `The re-plan produced no slots` | none (`project`) |
| `slot-rebriefer.ts:115` | `onFailure` | `The re-brief failed` | `slotSubject(slotId)` (`slotId` is read at line 109) |
| `slot-rebriefer.ts:278` | `rebrief-over-budget` | `The re-brief stopped` | `slotSubject(slotId)` |
| `slot-rebriefer.ts:323` | `resolve-over-budget` | `The re-briefed slot could not be resolved` | `slotSubject(slotId)` |
| `slot-refetcher.ts:56` | `onFailure` | `The slot re-fetch failed` | `slotSubject(event.data.event.data['slotId'])` |
| `slot-refetcher.ts:120` | `refetch-over-budget` | `The slot re-fetch stopped` | `slotSubject(slotId)` |
| `slot-redirector.ts:65` | `onFailure` | `The redirect failed` | `slotSubject(event.data.event.data['slotId'])` |
| `slot-redirector.ts:132` | `redirect-over-budget` | `The redirect stopped` | `slotSubject(slotId)` |
| `slot-redirector.ts:180` | `resolve-over-budget` | `The redirected slot could not be resolved` | `slotSubject(slotId)` |
| `slot-retyper.ts:102` | `onFailure` | `The re-type failed` | `slotSubject(slotId)` (`slotId` is read at line 80) |
| `slot-retyper.ts:228` | `retype-over-budget` | `The re-type stopped` | `slotSubject(slotId)` |
| `slot-retyper.ts:289` | `design-over-budget` | `The graphic could not be designed` | `slotSubject(slotId)` |
| `slot-retyper.ts:328` | `resolve-over-budget` | `The re-typed slot could not be resolved` | `slotSubject(slotId)` |
| `teaser-rebuild-runner.ts:53, :65` | `onFailure` and `fail()` | `The teaser voicing stopped` | not a `markSideJobFailed` caller: `recordStop` for `teaser` beside its `notify` |

No new field crosses a step boundary: the notices are written inside the steps that already call `markSideJobFailed` or `notify`, and `redraft-book` still returns its existing `stopped` string (now the bare reason; a replayed old result still carries a string and reads as a longer line).

- [ ] **Step 1: Write the failing helper and gate tests**

In `apps/web/lib/answer.test.ts`, add `AnswerStopped` to the import from `./answer`, and add this test inside the existing `describe('answerOrStop (decision 292)', ...)` block, after its last `it`:

```ts
  it('keeps the bare reason for a caller that words the stop its own way (decision 293)', () => {
    let stopped: unknown
    try {
      answerOrStop(
        { ok: false, issue: ANSWER_CUT_OFF, calls: 2 },
        "The director's book could not be drafted",
      )
    } catch (error) {
      stopped = error
    }
    expect(stopped).toBeInstanceOf(AnswerStopped)
    expect(stopped).toBeInstanceOf(NonRetriableError)
    expect((stopped as AnswerStopped).issue).toBe(ANSWER_CUT_OFF)
    expect((stopped as AnswerStopped).message).toBe(
      "The director's book could not be drafted: the answer was cut off at its length limit",
    )
    // Inngest also recognises a stop by this name.
    expect((stopped as AnswerStopped).name).toBe('NonRetriableError')
  })
```

In `apps/web/inngest/lib/gates.test.ts`:

- Add `listProjectNotices` and `notices` to the import from `@boom-busters/db` (lines 3 to 19).
- Change the vitest import (line 22) to `import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'`.
- Add `slotSubject` to the import from `./gates` (lines 25 to 37).
- After the imports, before the `describeDb` line (line 53), add:

```ts
// The notification is the only part of a side job's stop that leaves the
// database; asserted here, not sent (decision 293).
const notify = vi.hoisted(() => vi.fn())
vi.mock('@/lib/notify', () => ({ notify }))

const SLOT = '01J0000000000000000000000S'
```

- Replace the whole `markSideJobFailed` describe (lines 319 to 347, the comment above it included) with:

```ts
  /**
   * Decision 234, the same rule for every side job: the slot re-fetcher and
   * re-typer also run inside a parked visuals review, and their failures must
   * not tear it down either. Decision 293: while parked, the reason lands as a
   * `stopped` notice on the card it concerns, because the notification alone
   * reached only a server log (production sends no email).
   */
  describe('markSideJobFailed', () => {
    // Written for real here; none may outlive the test, since the e2e suite
    // shares this database and would find them on its cards.
    beforeEach(async () => {
      await db.delete(notices)
      notify.mockClear()
    })
    afterEach(async () => {
      await db.delete(notices)
    })

    it('leaves the open review room alone, and says why on the project strip and in a notification', async () => {
      await setProjectStage(db, FIXTURE_PROJECT_ID, {
        stage: 'visuals',
        stageStatus: 'awaiting_review',
      })

      await markSideJobFailed(context(), 'The slot re-fetch stopped', {
        message: 'pexels rejected the API key (401).',
      })

      expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('awaiting_review')
      expect(await listProjectNotices(db, FIXTURE_PROJECT_ID)).toEqual([
        expect.objectContaining({
          subject: 'project',
          subjectId: null,
          kind: 'stopped',
          message: 'The slot re-fetch stopped: pexels rejected the API key (401).',
        }),
      ])
      expect(notify).toHaveBeenCalledWith({
        kind: 'run-failed',
        title: 'The slot re-fetch stopped',
        body: 'pexels rejected the API key (401).',
        href: `/projects/${FIXTURE_PROJECT_ID}`,
      })
    })

    it('writes the notice on the card it names: a slot, or the Direction card', async () => {
      await setProjectStage(db, FIXTURE_PROJECT_ID, {
        stage: 'visuals',
        stageStatus: 'awaiting_review',
      })

      await markSideJobFailed(
        context(),
        'The re-type stopped',
        { message: 'over budget' },
        slotSubject(SLOT),
      )
      await markSideJobFailed(
        context(),
        'The redraft stopped',
        { message: 'cut off' },
        { subject: 'direction' },
      )

      const listed = (await listProjectNotices(db, FIXTURE_PROJECT_ID)).map(
        ({ subject, subjectId, message }) => ({ subject, subjectId, message }),
      )
      expect(listed).toHaveLength(2)
      expect(listed).toEqual(
        expect.arrayContaining([
          { subject: 'slot', subjectId: SLOT, message: 'The re-type stopped: over budget' },
          { subject: 'direction', subjectId: null, message: 'The redraft stopped: cut off' },
        ]),
      )
    })

    it('reads a slot side job with no slot id as the project', () => {
      expect(slotSubject(undefined)).toBeUndefined()
      expect(slotSubject(42)).toBeUndefined()
      expect(slotSubject(SLOT)).toEqual({ subject: 'slot', subjectId: SLOT })
    })

    it('escalates to the stage, and writes no notice, when no review room is open', async () => {
      await setProjectStage(db, FIXTURE_PROJECT_ID, { stage: 'visuals', stageStatus: 'running' })

      await markSideJobFailed(
        context(),
        'The slot re-fetch stopped',
        { message: 'storage is gone' },
        slotSubject(SLOT),
      )

      expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('failed')
      expect(await listProjectNotices(db, FIXTURE_PROJECT_ID)).toEqual([])
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'run-failed', title: 'A run failed', body: 'storage is gone' }),
      )
    })
  })
```

- [ ] **Step 2: Run them to see them fail**

Run (database; alone, Docker Desktop running, Bash `timeout: 600000`): `cd apps/web && pnpm exec vitest run lib/answer.test.ts inngest/lib/gates.test.ts`
Expected: FAIL. `answer.test.ts`: `AnswerStopped` is not exported. `gates.test.ts`: the parked tests find no notice and `slotSubject` is not a function; the rest of the gate tests still pass.

- [ ] **Step 3: Implement `AnswerStopped`, the subject and the notice**

In `apps/web/lib/answer.ts`, replace stage 1's `answerOrStop` (its doc comment included):

```ts
/**
 * The value, or a stop Inngest will not retry: the reason reaches the stage's
 * failure card through the function's `onFailure`, and no blind re-run buys
 * the same answer again.
 */
export function answerOrStop<T>(answer: Answer<T>, what: string): T {
  if (answer.ok) return answer.value
  throw new NonRetriableError(`${what}: ${answer.issue}`)
}
```

with:

```ts
/**
 * The stop `answerOrStop` throws: a `NonRetriableError` naming what stopped
 * and why, that also keeps the bare reason, so a caller that words the stop
 * for a card of its own (the redraft, decision 293) need not unpick the
 * message. Its `name` stays `NonRetriableError`, which Inngest also reads.
 */
export class AnswerStopped extends NonRetriableError {
  readonly issue: string

  constructor(what: string, issue: string) {
    super(`${what}: ${issue}`)
    this.issue = issue
  }
}

/**
 * The value, or a stop Inngest will not retry: the reason reaches the stage's
 * failure card through the function's `onFailure`, and no blind re-run buys
 * the same answer again.
 */
export function answerOrStop<T>(answer: Answer<T>, what: string): T {
  if (answer.ok) return answer.value
  throw new AnswerStopped(what, answer.issue)
}
```

In `apps/web/inngest/lib/gates.ts`:

- Replace line 11, `import type { BudgetExceededError, GateStage } from '@boom-busters/schemas'`, with `import type { BudgetExceededError, GateStage, NoticeSubject } from '@boom-busters/schemas'`.
- After line 12, `import { db } from '@/lib/db'`, add `import { recordStop } from '@/lib/notices'`.
- Replace `markSideJobFailed` and its doc comment (lines 229 to 255) with:

```ts
/** The card a side job's stop is shown on (decision 293); the project strip by default. */
export type SideJobSubject = { subject: NoticeSubject; subjectId?: string | null }

/**
 * A slot side job's subject, from the slot id its event carried; a malformed
 * event has none, and its stop then shows on the project strip.
 */
export function slotSubject(slotId: unknown): SideJobSubject | undefined {
  return typeof slotId === 'string' ? { subject: 'slot', subjectId: slotId } : undefined
}

/**
 * A side job fails while the main run may be parked at an open review gate
 * (decision 234, generalising decision 219). The retaker, the slot
 * re-fetcher and the slot re-typer all run INSIDE a parked review: failing
 * the STAGE there tears the review room down: the gate bar vanishes,
 * approval becomes unreachable, and later successes never restore it. So
 * while the review is parked, the failure is words: a `stopped` notice on
 * the card it concerns (decision 293; the project strip unless `subject`
 * names another), a notification, and whatever row-level state the caller
 * wrote. Only when the stage is NOT parked does it escalate to the stage, as
 * a plain run failure would, and the Needs-you card says why.
 */
export async function markSideJobFailed(
  ctx: GateContext,
  title: string,
  error: Record<string, unknown>,
  subject?: SideJobSubject,
): Promise<void> {
  const project = await getProject(db, ctx.projectId)
  if (project?.stageStatus !== 'awaiting_review') {
    await markStageFailed(ctx, error)
    return
  }
  const message = String(error['message'] ?? 'Unknown error')
  // The notification alone reached only a server log: production sends no email.
  await recordStop(
    {
      projectId: ctx.projectId,
      subject: subject?.subject ?? 'project',
      subjectId: subject?.subjectId ?? null,
    },
    'stopped',
    `${title}: ${message}`,
  )
  await notify({
    kind: 'run-failed',
    title,
    body: message,
    href: `/projects/${ctx.projectId}`,
  })
}
```

- [ ] **Step 4: Run them to see them pass**

Run (database; alone, `timeout: 600000`): `cd apps/web && pnpm exec vitest run lib/answer.test.ts inngest/lib/gates.test.ts`
Expected: PASS. `gates.test.ts` has 19 tests (17 before, minus 2 replaced, plus 4).

- [ ] **Step 5: Write the failing call-site tests**

In `apps/web/inngest/functions/visuals-replanner.test.ts`:

- Add `setProjectStage` to the import from `@boom-busters/db` (lines 3 to 26).
- After line 29, `import type { ShotBrief } from '@boom-busters/schemas'`, add `import type * as Notices from '@/lib/notices'`.
- After the `@/lib/llm` mock (line 46), add:

```ts
// The stop is asserted, not stored; recording an answer's repairs stays real.
const recordStop = vi.hoisted(() => vi.fn())
vi.mock('@/lib/notices', async (importOriginal) => ({
  ...(await importOriginal<typeof Notices>()),
  recordStop,
}))
```

- After the test `op direction: two refused books stop the redraft and keep the stored book (decision 292)` (ends line 212), add:

```ts
  it('op direction: a redraft cut off twice says why on the Direction card, in the spec words (decision 293)', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    await setProjectStage(db, FIXTURE_PROJECT_ID, {
      stage: 'visuals',
      stageStatus: 'awaiting_review',
    })
    recordStop.mockClear()
    callLlm.mockReset()
    callLlm.mockResolvedValue({ text: '{"visualThesis": "Half a b', truncated: true })

    const { result } = await engine.execute({ events: replanEvent('direction') })

    expect(result).toMatchObject({ outcome: 'redraft-stopped' })
    expect(callLlm).toHaveBeenCalledTimes(2)
    expect(callLlm.mock.calls[1]![1]).toMatchObject({ purpose: 'retry: cut off' })
    expect(recordStop).toHaveBeenCalledWith(
      { projectId: FIXTURE_PROJECT_ID, subject: 'direction', subjectId: null },
      'stopped',
      'The redraft stopped: the answer was cut off at its length limit. The book you had is kept.',
    )
    expect(vi.mocked(notify)).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'The redraft stopped',
        body: 'the answer was cut off at its length limit. The book you had is kept.',
      }),
    )
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.direction).toMatchObject({
      visualThesis: 'owner edit',
    })
  })
```

In `apps/web/inngest/functions/slot-retyper.test.ts`:

- Add `setProjectStage` to the import from `@boom-busters/db` (lines 3 to 18).
- After line 22, `import { db } from '@/lib/db'`, add `import type * as Notices from '@/lib/notices'`.
- After the `@/lib/notify` mock (lines 33 to 36), add:

```ts
// The stop is asserted, not stored; recording an answer's repairs stays real.
const recordStop = vi.hoisted(() => vi.fn())
vi.mock('@/lib/notices', async (importOriginal) => ({
  ...(await importOriginal<typeof Notices>()),
  recordStop,
}))
```

- After the test `says why on the brief when a retyped graphic runs out of budget` (ends line 253), add:

```ts
  it('says why on the slot card when a parked plan runs out of budget designing a retyped graphic (decision 293)', async () => {
    await setProjectStage(db, FIXTURE_PROJECT_ID, {
      stage: 'visuals',
      stageStatus: 'awaiting_review',
    })
    const design = await import('@/lib/graphic-design')
    const broke = vi.spyOn(design, 'designGraphic').mockRejectedValueOnce(
      new BudgetExceededError({
        provider: 'anthropic',
        operation: 'llm.graphics',
        budgetUsd: 5,
        monthSpendUsd: 5,
        estimateUsd: 0.05,
      }),
    )
    try {
      const { result } = await engine.execute({ events: retypeEvent(slotId, 'graphic') })
      expect(result).toMatchObject({ outcome: 'over-budget' })
      expect(recordStop).toHaveBeenCalledWith(
        { projectId: FIXTURE_PROJECT_ID, subject: 'slot', subjectId: slotId },
        'stopped',
        expect.stringMatching(
          /^The graphic could not be designed: The monthly spend ceiling would be crossed by anthropic llm\.graphics/,
        ),
      )
    } finally {
      broke.mockRestore()
    }
  })
```

In `apps/web/inngest/functions/teaser-rebuild-runner.test.ts`:

- After line 25, `import { db } from '@/lib/db'`, add `import type * as Notices from '@/lib/notices'`.
- After the `@/lib/notify` mock (lines 45 to 46), add:

```ts
// The stop is asserted, not stored; recording an answer's repairs stays real.
const recordStop = vi.hoisted(() => vi.fn())
vi.mock('@/lib/notices', async (importOriginal) => ({
  ...(await importOriginal<typeof Notices>()),
  recordStop,
}))
```

- In the refusal test (the `it` at line 204 whose name begins `a refusal notifies and stops`), after the `expect(notify).toHaveBeenCalledWith(...)` assertion (lines 212 to 214), add:

```ts
    // And says so on the Teaser card (decision 293): production sends no email.
    expect(recordStop).toHaveBeenCalledWith(
      { projectId: FIXTURE_PROJECT_ID, subject: 'teaser', subjectId: null },
      'stopped',
      expect.stringMatching(/^Voicing stopped mid-way: /),
    )
```

(`beforeEach` already calls `vi.clearAllMocks()` in the retyper and teaser suites, which clears `recordStop` between tests.)

- [ ] **Step 6: Run them to see them fail**

Run (database; alone, `timeout: 600000`): `cd apps/web && pnpm exec vitest run inngest/functions/visuals-replanner.test.ts inngest/functions/slot-retyper.test.ts inngest/functions/teaser-rebuild-runner.test.ts`
Expected: FAIL, three tests. The redraft test sees `recordStop` called with subject `project` and the message `The redraft stopped: The director's book could not be drafted: the answer was cut off at its length limit`; the retyper test sees subject `project`; the teaser test sees no `recordStop` call. Every other test in the three files passes.

- [ ] **Step 7: The redraft names the Direction card, in the spec's words**

In `apps/web/inngest/functions/visuals-replanner.ts`:

- After line 26, `import { db } from '@/lib/db'`, add `import { AnswerStopped } from '@/lib/answer'`.
- After line 55, `const FUNCTION_ID = 'visuals-replanner'`, add:

```ts

/** A stopped redraft as the Direction card says it (spec 3.3): the book on screen stays. */
function bookKept(reason: string): string {
  return `${reason.replace(/[.\s]+$/, '')}. The book you had is kept.`
}
```

- In the `redraft-book` step, replace (lines 111 to 115):

```ts
            // Two answers refused or cut off (decision 292): the stored book
            // stays, and the plan screen says why, with no blind retry.
            if (error instanceof NonRetriableError) {
              return { ok: false as const, stopped: error.message }
            }
```

with:

```ts
            // Two answers refused or cut off (decision 292): the stored book
            // stays, and the Direction card says why (decision 293), in the
            // answer's own words rather than the first draft's stage label.
            if (error instanceof NonRetriableError) {
              return {
                ok: false as const,
                stopped: error instanceof AnswerStopped ? error.issue : error.message,
              }
            }
```

- Replace (lines 120 to 122):

```ts
          await step.run('redraft-over-budget', () =>
            markSideJobFailed(ctx, 'The redraft stopped', drafted.gate),
          )
```

with:

```ts
          await step.run('redraft-over-budget', () =>
            markSideJobFailed(ctx, 'The redraft stopped', drafted.gate, { subject: 'direction' }),
          )
```

- Replace (lines 126 to 128):

```ts
          await step.run('redraft-stopped', () =>
            markSideJobFailed(ctx, 'The redraft stopped', { message: drafted.stopped }),
          )
```

with:

```ts
          await step.run('redraft-stopped', () =>
            markSideJobFailed(
              ctx,
              'The redraft stopped',
              { message: bookKept(drafted.stopped) },
              { subject: 'direction' },
            ),
          )
```

The other five calls in this file (lines 78, 252, 346, 365, 375) keep the default, the project strip.

- [ ] **Step 8: The four slot side jobs name their slot**

In each of `slot-rebriefer.ts` (line 38), `slot-refetcher.ts` (line 15), `slot-redirector.ts` (line 32) and `slot-retyper.ts` (line 35), replace

```ts
import { budgetGateData, markSideJobFailed, type GateContext } from '../lib/gates'
```

with

```ts
import { budgetGateData, markSideJobFailed, slotSubject, type GateContext } from '../lib/gates'
```

`apps/web/inngest/functions/slot-rebriefer.ts`:

- `onFailure` (lines 115 to 119): replace

```ts
      await markSideJobFailed(
        { inngestRunId: '', functionId: FUNCTION_ID, projectId },
        'The re-brief failed',
        serialiseError(event.data.error),
      )
```

with

```ts
      await markSideJobFailed(
        { inngestRunId: '', functionId: FUNCTION_ID, projectId },
        'The re-brief failed',
        serialiseError(event.data.error),
        slotSubject(slotId),
      )
```

- Line 278: replace `await markSideJobFailed(ctx, 'The re-brief stopped', drafted.gate)` with `await markSideJobFailed(ctx, 'The re-brief stopped', drafted.gate, slotSubject(slotId))`.
- Lines 322 to 324: replace

```ts
        await step.run('resolve-over-budget', () =>
          markSideJobFailed(ctx, 'The re-briefed slot could not be resolved', outcome.overBudget),
        )
```

with

```ts
        await step.run('resolve-over-budget', () =>
          markSideJobFailed(
            ctx,
            'The re-briefed slot could not be resolved',
            outcome.overBudget,
            slotSubject(slotId),
          ),
        )
```

`apps/web/inngest/functions/slot-refetcher.ts`:

- `onFailure` (lines 56 to 60): replace

```ts
      await markSideJobFailed(
        { inngestRunId: '', functionId: FUNCTION_ID, projectId },
        'The slot re-fetch failed',
        serialiseError(event.data.error),
      )
```

with

```ts
      await markSideJobFailed(
        { inngestRunId: '', functionId: FUNCTION_ID, projectId },
        'The slot re-fetch failed',
        serialiseError(event.data.error),
        slotSubject(event.data.event.data['slotId']),
      )
```

- Lines 119 to 121: replace

```ts
        await step.run('refetch-over-budget', () =>
          markSideJobFailed(ctx, 'The slot re-fetch stopped', outcome.overBudget),
        )
```

with

```ts
        await step.run('refetch-over-budget', () =>
          markSideJobFailed(
            ctx,
            'The slot re-fetch stopped',
            outcome.overBudget,
            slotSubject(slotId),
          ),
        )
```

`apps/web/inngest/functions/slot-redirector.ts`:

- `onFailure` (lines 65 to 69): replace

```ts
      await markSideJobFailed(
        { inngestRunId: '', functionId: FUNCTION_ID, projectId },
        'The redirect failed',
        serialiseError(event.data.error),
      )
```

with

```ts
      await markSideJobFailed(
        { inngestRunId: '', functionId: FUNCTION_ID, projectId },
        'The redirect failed',
        serialiseError(event.data.error),
        slotSubject(event.data.event.data['slotId']),
      )
```

- Lines 131 to 133: replace

```ts
          await step.run('redirect-over-budget', () =>
            markSideJobFailed(ctx, 'The redirect stopped', redirected.gate),
          )
```

with

```ts
          await step.run('redirect-over-budget', () =>
            markSideJobFailed(ctx, 'The redirect stopped', redirected.gate, slotSubject(slotId)),
          )
```

- Lines 179 to 181: replace

```ts
          await step.run('resolve-over-budget', () =>
            markSideJobFailed(ctx, 'The redirected slot could not be resolved', outcome.overBudget),
          )
```

with

```ts
          await step.run('resolve-over-budget', () =>
            markSideJobFailed(
              ctx,
              'The redirected slot could not be resolved',
              outcome.overBudget,
              slotSubject(slotId),
            ),
          )
```

`apps/web/inngest/functions/slot-retyper.ts`:

- `onFailure` (lines 102 to 106): replace

```ts
      await markSideJobFailed(
        { inngestRunId: '', functionId: FUNCTION_ID, projectId },
        'The re-type failed',
        serialiseError(event.data.error),
      )
```

with

```ts
      await markSideJobFailed(
        { inngestRunId: '', functionId: FUNCTION_ID, projectId },
        'The re-type failed',
        serialiseError(event.data.error),
        slotSubject(slotId),
      )
```

- Line 228: replace `await markSideJobFailed(ctx, 'The re-type stopped', converted.gate)` with `await markSideJobFailed(ctx, 'The re-type stopped', converted.gate, slotSubject(slotId))`.
- Lines 288 to 290: replace

```ts
        await step.run('design-over-budget', () =>
          markSideJobFailed(ctx, 'The graphic could not be designed', designed.gate),
        )
```

with

```ts
        await step.run('design-over-budget', () =>
          markSideJobFailed(
            ctx,
            'The graphic could not be designed',
            designed.gate,
            slotSubject(slotId),
          ),
        )
```

- Lines 327 to 329: replace

```ts
        await step.run('resolve-over-budget', () =>
          markSideJobFailed(ctx, 'The re-typed slot could not be resolved', outcome.overBudget),
        )
```

with

```ts
        await step.run('resolve-over-budget', () =>
          markSideJobFailed(
            ctx,
            'The re-typed slot could not be resolved',
            outcome.overBudget,
            slotSubject(slotId),
          ),
        )
```

- [ ] **Step 9: The teaser rebuild names the Teaser card**

In `apps/web/inngest/functions/teaser-rebuild-runner.ts`:

- After line 6, `import { db } from '@/lib/db'`, add `import { recordStop } from '@/lib/notices'`.
- Replace the `onFailure` handler (lines 48 to 59):

```ts
    onFailure: async ({ event }) => {
      // The in-body refusals notify through `fail`; a crash past the retries
      // must say so too, or the studio just never hears back (decision 236).
      const projectId = event.data.event.data['projectId']
      if (typeof projectId !== 'string') return
      await notify({
        kind: 'run-failed',
        title: 'The teaser voicing stopped',
        body: String(event.data.error?.message ?? 'Unknown error'),
        href: `/projects/${projectId}?stage=shorts`,
      })
    },
```

with:

```ts
    onFailure: async ({ event }) => {
      // The in-body refusals report through `fail`; a crash past the retries
      // must say so too, or the studio just never hears back (decision 236).
      const projectId = event.data.event.data['projectId']
      if (typeof projectId !== 'string') return
      const message = String(event.data.error?.message ?? 'Unknown error')
      // On the Teaser card as well (decision 293): production sends no email.
      // The project can be gone by now; the notification must still go.
      await recordStop(
        { projectId, subject: 'teaser', subjectId: null },
        'stopped',
        `The teaser voicing stopped: ${message}`,
      ).catch(() => undefined)
      await notify({
        kind: 'run-failed',
        title: 'The teaser voicing stopped',
        body: message,
        href: `/projects/${projectId}?stage=shorts`,
      })
    },
```

- Replace `fail` (lines 65 to 74):

```ts
    const fail = async (stepName: string, body: string) => {
      await step.run(stepName, () =>
        notify({
          kind: 'run-failed',
          title: 'The teaser voicing stopped',
          body,
          href: `/projects/${projectId}?stage=shorts`,
        }),
      )
    }
```

with:

```ts
    // Each body already names what stopped ("Voicing stopped mid-way: ..."),
    // so the Teaser card shows it as it is (decision 293).
    const fail = async (stepName: string, body: string) => {
      await step.run(stepName, async () => {
        await recordStop({ projectId, subject: 'teaser', subjectId: null }, 'stopped', body)
        await notify({
          kind: 'run-failed',
          title: 'The teaser voicing stopped',
          body,
          href: `/projects/${projectId}?stage=shorts`,
        })
      })
    }
```

Also change the module comment's last paragraph sentence "They notify and land in the run mirror, where the activity drawer shows them." (lines 23 to 24) to "They notify, land in the run mirror, and leave a notice on the Teaser card (decision 293)."

- [ ] **Step 10: Run the call-site tests to see them pass**

Run (database; alone, `timeout: 600000`): `cd apps/web && pnpm exec vitest run inngest/functions/visuals-replanner.test.ts inngest/functions/slot-retyper.test.ts inngest/functions/teaser-rebuild-runner.test.ts`
Expected: PASS, every test in the three files (one new test each in the replanner and retyper suites; the teaser refusal test gains an assertion).

- [ ] **Step 11: Run every suite that reaches `markSideJobFailed` or `answerOrStop`, and the typecheck**

Run (database; alone, one process so the files run one after another, `timeout: 600000`): `cd apps/web && pnpm exec vitest run lib/answer.test.ts lib/script-answers.test.ts lib/plan-chapter.test.ts inngest/lib/gates.test.ts inngest/functions/slot-rebriefer.test.ts inngest/functions/slot-redirector.test.ts inngest/functions/slot-refetcher.test.ts inngest/functions/slot-retyper.test.ts inngest/functions/visuals-replanner.test.ts inngest/functions/teaser-rebuild-runner.test.ts inngest/functions/visuals-runner.test.ts`
Expected: PASS.

Then from the root: `pnpm typecheck` (`timeout: 600000`).
Expected: clean.

- [ ] **Step 12: Format and lint the touched files**

Run from the root: `pnpm exec prettier --write <files>` then `pnpm exec prettier --check <files>`, then `pnpm exec eslint --max-warnings 0 <files>`, where `<files>` is the `git add` list below.
Expected: clean.

- [ ] **Step 13: Commit**

```bash
git add apps/web/lib/answer.ts apps/web/lib/answer.test.ts apps/web/inngest/lib/gates.ts apps/web/inngest/lib/gates.test.ts apps/web/inngest/functions/visuals-replanner.ts apps/web/inngest/functions/visuals-replanner.test.ts apps/web/inngest/functions/slot-rebriefer.ts apps/web/inngest/functions/slot-refetcher.ts apps/web/inngest/functions/slot-redirector.ts apps/web/inngest/functions/slot-retyper.ts apps/web/inngest/functions/slot-retyper.test.ts apps/web/inngest/functions/teaser-rebuild-runner.ts apps/web/inngest/functions/teaser-rebuild-runner.test.ts
git commit -F <message file>
```

Message: `feat(notices): a side job that stops while a gate is parked leaves its reason on the card it concerns (decision 293)` plus the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 5: The Director's Book reports its repairs

**Files:**
- Modify: `packages/providers/src/prompts/direction.ts` (imports L12 to 13; `repairDirectorsBook` L178 to 225; `parseDirectorsBook` signature and repair call L227 to 231)
- Test: `packages/providers/src/prompts/direction.test.ts` (imports L1 to 4; new `describe` appended after L236)
- Modify: `apps/web/inngest/lib/direction.ts` (provider type import L24 to 29; `@/lib` imports L49 to 53; `draftDirectorsBook` L213 to 238)
- Test: `apps/web/inngest/lib/direction.test.ts` (mocks after L34; outer `beforeEach` L46 to 48; the "stops after two refusals" test L256 to 267; new `describe` before the closing `})` of `describeDb` at L269). Database test.
- Test: `apps/web/inngest/functions/visuals-replanner.test.ts` (imports L3 to 28; two tests inserted before the first `it('refuses outside the plan checkpoint'`, L214). Database test.
- Modify: `apps/web/app/(console)/projects/[id]/direction-card.tsx` (imports L4 to 8; props L137 to 151; `CardContent` L171)
- Test: `apps/web/app/(console)/projects/[id]/direction-card.test.tsx` (imports L1 to 6; mocks after L16; new `describe` appended after L139)
- Modify: `apps/web/app/(console)/projects/[id]/visual-board.tsx` (schemas imports L18 to 39; `VisualBoardContent` props L1500 to 1516; `<DirectionCard` L1705 to 1717)
- Test: `apps/web/app/(console)/projects/[id]/visual-board.test.tsx` (imports L6; mocks after L102; one test at the end of `describe('the plan phase (staged-visuals design)'`, before L1556)
- Modify: `apps/web/app/(console)/projects/[id]/page.tsx` (the `<VisualBoard` element, around L495)

**Interfaces:**
- Consumes: `Note`, `Repair`, `ignoreRepairs`, `trimField`, `capList`, `describeRepairs` (Task 1, `@boom-busters/providers`); `callForAnswer` with `parse(text, note)` and `Answer<T>` with optional `repairs` (Task 1, `@/lib/answer`); stage 1's `answerOrStop` and `completeForProject`; `recordRepairs(target, repairs?)` (Task 3, `@/lib/notices`); `Notices` (Task 3, `@/components/notices`); `noticesFor`, `Notice`, `NoticeTarget` (Task 1, `@boom-busters/schemas`); `replaceNotices`, `listProjectNotices` (Task 2, `@boom-busters/db`, in the replanner test); `page.tsx`'s `notices` (Task 3).
- Produces:
  - `repairDirectorsBook(raw: unknown, note: Note = ignoreRepairs): unknown` and `parseDirectorsBook(text: string, chapterCount: number, note: Note = ignoreRepairs): DirectorsBook` (`@boom-busters/providers`). Labels: `the visual thesis`, `era rule N`, `the palette note`, `motif N`, `the anchor object`, `never-show N`, `<name>'s role`, `<name>'s identity`, `<name>'s guardrail`, `<location name>'s look`, `chapter N's mood shift`, `chapter N's key image`, `the final image`; caps `era locks`, `motifs`, `never-shows`, `principals`, `locations`. N counts from 1 as the model wrote the list.
  - `draftDirectorsBook` calls `recordRepairs({ projectId, subject: 'direction', subjectId: null }, repairs)` after the book is stored, inside whichever step called it (`directors-book` in the visuals-runner, `redraft-book` in the visuals-replanner). Nothing new crosses a step boundary.
  - `DirectionCard` prop `notices?: readonly Notice[]` (default `[]`), rendered first in the card.
  - `VisualBoard` prop `notices?: readonly Notice[]` (default `[]`): the project's open notices, every subject. The board picks each card's own with `noticesFor`; Task 11's slot cards read the same prop as `noticesFor(notices, 'slot', slot.id)`.

- [ ] **Step 1: Write the failing provider tests**

In `packages/providers/src/prompts/direction.test.ts`, replace the import on L3:

```ts
import { buildDirectorsBookRequest, mockDirectorsBook, parseDirectorsBook } from './direction'
```

with:

```ts
import {
  buildDirectorsBookRequest,
  mockDirectorsBook,
  parseDirectorsBook,
  repairDirectorsBook,
} from './direction'
import { describeRepairs } from './repair'
import type { Note, Repair } from './repair'
```

and append at the end of the file:

```ts
describe("the book's repairs, in the owner's words (decision 293)", () => {
  const book = () =>
    JSON.parse(JSON.stringify(mockDirectorsBook({ caseTitle: 'x', chapterCount: 1 })))
  const long = 'A sentence about the period that runs on. '.repeat(20)
  const collect = () => {
    const notes: Repair[] = []
    const note: Note = (repair) => {
      notes.push(repair)
    }
    return { notes, note }
  }

  it('names each trimmed text the way the Direction card does', () => {
    const answer = book()
    answer.visualThesis = long
    answer.eraLocks = [
      { span: '1995 to 2008', rules: 'CRT monitors on every desk.' },
      { span: '2008 to 2020', rules: long },
    ]
    answer.palette.note = long
    answer.anchorObject = long
    answer.finalImage = long
    const { notes, note } = collect()
    repairDirectorsBook(answer, note)
    expect(notes).toEqual([
      { action: 'trimmed', field: 'the visual thesis' },
      { action: 'trimmed', field: 'era rule 2' },
      { action: 'trimmed', field: 'the palette note' },
      { action: 'trimmed', field: 'the anchor object' },
      { action: 'trimmed', field: 'the final image' },
    ])
  })

  it('reports each cap, and numbers what it trims as the model wrote the list', () => {
    const answer = book()
    answer.eraLocks = Array.from({ length: 7 }, (_, at) => ({
      span: `${1990 + at}`,
      rules: 'Pagers on every belt.',
    }))
    answer.motifs = ['the badge', long, 'the term sheet', 'the logo']
    answer.neverShow = [long, ...Array.from({ length: 12 }, (_, at) => `exclusion ${at}`)]
    const { notes, note } = collect()
    repairDirectorsBook(answer, note)
    expect(notes).toEqual([
      { action: 'capped', field: 'era locks', kept: 6 },
      { action: 'capped', field: 'motifs', kept: 3 },
      { action: 'trimmed', field: 'motif 2' },
      { action: 'capped', field: 'never-shows', kept: 12 },
      { action: 'trimmed', field: 'never-show 1' },
    ])
  })

  it("names a person's and a place's fields by name, and a chapter's by its number", () => {
    const answer = book()
    answer.principals = [
      {
        name: 'Emad Mostaque',
        role: long,
        depiction: 'likeness',
        identityString: long,
        guardrail: long,
      },
      ...Array.from({ length: 12 }, (_, at) => ({
        name: `Person ${at}`,
        role: 'Director',
        depiction: 'anonymous',
        identityString: 'A face.',
        guardrail: 'Never mocked.',
      })),
    ]
    answer.locations = [
      { name: 'The Server Hall', look: long },
      ...Array.from({ length: 12 }, (_, at) => ({ name: `Room ${at}`, look: 'A room.' })),
    ]
    answer.chapters[0].moodShift = long
    answer.chapters[0].keyImage = long
    const { notes, note } = collect()
    repairDirectorsBook(answer, note)
    expect(notes).toEqual([
      { action: 'capped', field: 'principals', kept: 12 },
      { action: 'trimmed', field: "Emad Mostaque's role" },
      { action: 'trimmed', field: "Emad Mostaque's identity" },
      { action: 'trimmed', field: "Emad Mostaque's guardrail" },
      { action: 'capped', field: 'locations', kept: 12 },
      { action: 'trimmed', field: "The Server Hall's look" },
      { action: 'trimmed', field: "chapter 1's mood shift" },
      { action: 'trimmed', field: "chapter 1's key image" },
    ])
  })

  it('notes nothing for a book within its limits', () => {
    const { notes, note } = collect()
    parseDirectorsBook(JSON.stringify(book()), 1, note)
    expect(notes).toEqual([])
  })

  it('reads as one line for the card, and leaves every fact as the model wrote it', () => {
    const answer = book()
    answer.eraLocks[0].rules = long
    answer.principals = [
      {
        name: 'Emad Mostaque',
        role: 'Founder',
        depiction: 'likeness',
        identityString: long,
        guardrail: 'Never mocked.',
      },
    ]
    answer.neverShow = Array.from({ length: 14 }, (_, at) => `exclusion ${at}`)
    const { notes, note } = collect()
    const parsed = parseDirectorsBook(JSON.stringify(answer), 1, note)
    expect(describeRepairs(notes)).toBe(
      "Trimmed to fit: era rule 1; Emad Mostaque's identity. Kept the first 12 never-shows.",
    )
    expect(parsed.principals[0]).toMatchObject({
      name: 'Emad Mostaque',
      role: 'Founder',
      depiction: 'likeness',
    })
    expect(parsed.eraLocks[0]!.span).toBe(answer.eraLocks[0].span)
    expect(parsed.palette).toMatchObject({
      accent: answer.palette.accent,
      temperature: answer.palette.temperature,
    })
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/providers && pnpm exec vitest run src/prompts/direction.test.ts`
Expected: FAIL, 4 of the 5 new tests: the repair ignores `note`, so `notes` stays empty and `describeRepairs([])` is `null`. "notes nothing for a book within its limits" passes already. Stage 1's tests still pass.

- [ ] **Step 3: Report each repair from `repairDirectorsBook`**

In `packages/providers/src/prompts/direction.ts`, replace L13:

```ts
import { trimText } from './repair'
```

with:

```ts
import { capList, ignoreRepairs, trimField } from './repair'
import type { Note } from './repair'
```

Replace the whole of `repairDirectorsBook` with its doc comment (L178 to 225) with:

```ts
/**
 * The book as the model answered it, repaired before it is validated
 * (decision 292): free text over the limit trimmed, lists over their caps
 * cut to their first items, a fourth motif dropped. Names, the accent, the
 * era spans, enums and chapter numbers are left as they are: they carry
 * facts, and a bad one is refused.
 *
 * Each repair is reported through `note` (decision 293) in the words the
 * Direction card shows: "era rule 2", "Emad Mostaque's identity", "Kept the
 * first 12 never-shows". Items are numbered as the model wrote the list; a
 * cap keeps the first items, so the numbers of those kept do not move.
 */
export function repairDirectorsBook(raw: unknown, note: Note = ignoreRepairs): unknown {
  if (!isRecord(raw)) return raw
  const text = (value: unknown, field: string) => trimField(value, BOOK_TEXT_MAX, field, note)
  /** The first `max` items (a cut reported under `name`), each repaired by `fix`. */
  const list = (
    value: unknown,
    max: number,
    name: string,
    fix: (item: unknown, at: number) => unknown,
  ) => {
    const kept = capList(value, max, name, note)
    return Array.isArray(kept) ? kept.map(fix) : kept
  }
  /** A principal or a location by its name, or by its place when it has none. */
  const called = (item: Record<string, unknown>, fallback: string) =>
    typeof item['name'] === 'string' && item['name'].trim() !== ''
      ? item['name'].trim()
      : fallback
  return {
    ...raw,
    visualThesis: text(raw['visualThesis'], 'the visual thesis'),
    eraLocks: list(raw['eraLocks'], BOOK_ERA_LOCKS_MAX, 'era locks', (lock, at) =>
      isRecord(lock) ? { ...lock, rules: text(lock['rules'], `era rule ${at + 1}`) } : lock,
    ),
    palette: isRecord(raw['palette'])
      ? { ...raw['palette'], note: text(raw['palette']['note'], 'the palette note') }
      : raw['palette'],
    motifs: list(raw['motifs'], BOOK_MOTIFS, 'motifs', (motif, at) =>
      text(motif, `motif ${at + 1}`),
    ),
    anchorObject: text(raw['anchorObject'], 'the anchor object'),
    neverShow: list(raw['neverShow'], BOOK_LIST_MAX, 'never-shows', (item, at) =>
      text(item, `never-show ${at + 1}`),
    ),
    principals: list(raw['principals'], BOOK_LIST_MAX, 'principals', (person, at) => {
      if (!isRecord(person)) return person
      const who = called(person, `principal ${at + 1}`)
      return {
        ...person,
        role: text(person['role'], `${who}'s role`),
        identityString: text(person['identityString'], `${who}'s identity`),
        guardrail: text(person['guardrail'], `${who}'s guardrail`),
      }
    }),
    locations: list(raw['locations'], BOOK_LIST_MAX, 'locations', (place, at) =>
      isRecord(place)
        ? {
            ...place,
            look: text(place['look'], `${called(place, `location ${at + 1}`)}'s look`),
          }
        : place,
    ),
    chapters: list(raw['chapters'], Number.POSITIVE_INFINITY, 'chapters', (chapter, at) =>
      isRecord(chapter)
        ? {
            ...chapter,
            moodShift: text(chapter['moodShift'], `chapter ${at + 1}'s mood shift`),
            keyImage: text(chapter['keyImage'], `chapter ${at + 1}'s key image`),
          }
        : chapter,
    ),
    finalImage: text(raw['finalImage'], 'the final image'),
  }
}
```

In `parseDirectorsBook`, replace the signature line (L227):

```ts
export function parseDirectorsBook(text: string, chapterCount: number): DirectorsBook {
```

with:

```ts
export function parseDirectorsBook(
  text: string,
  chapterCount: number,
  note: Note = ignoreRepairs,
): DirectorsBook {
```

and replace L231:

```ts
  const parsed = DirectorsBookSchema.safeParse(repairDirectorsBook(raw))
```

with:

```ts
  const parsed = DirectorsBookSchema.safeParse(repairDirectorsBook(raw, note))
```

`trimText` is no longer used in this file; nothing else in it imported it.

- [ ] **Step 4: Run the provider tests**

Run: `cd packages/providers && pnpm exec vitest run src/prompts/direction.test.ts`, then `cd packages/providers && pnpm test` (`timeout: 600000`).
Expected: PASS, the 5 new tests and every stage 1 test (behaviour is unchanged when nothing listens).

- [ ] **Step 5: Write the failing web tests**

**`apps/web/inngest/lib/direction.test.ts`** (database test). After L33 to 34:

```ts
const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))
```

add:

```ts
// The notice store has its own tests (decision 293); here only what the
// draft hands it matters.
const recordRepairs = vi.hoisted(() => vi.fn())
vi.mock('@/lib/notices', () => ({ recordRepairs, recordStop: vi.fn() }))
```

In the outer `beforeEach` of `describeDb('direction helpers (mock mode)'`, after `vi.stubEnv('MOCK_PROVIDERS', '1')` (L47), add:

```ts
    recordRepairs.mockReset()
```

In the existing test `'stops after two refusals with a stop Inngest will not retry'`, after `expect(callLlm).toHaveBeenCalledTimes(4)` (L266), add:

```ts
      // A stop is the side job's to report; the draft itself writes no notice.
      expect(recordRepairs).not.toHaveBeenCalled()
```

Directly after the closing `})` of `describe('a refused book (decision 292)'` (L268) and before the `})` that closes `describeDb` (L269), add:

```ts
  describe("the book's notice (decision 293)", () => {
    const direction = { projectId: FIXTURE_PROJECT_ID, subject: 'direction', subjectId: null }

    it('hands what the repair trimmed to the Direction card', async () => {
      vi.stubEnv('MOCK_PROVIDERS', '')
      callLlm.mockReset()
      callLlm.mockResolvedValueOnce({
        text: JSON.stringify({
          ...mockDirectorsBook({ caseTitle: 'Case', chapterCount: 1 }),
          eraLocks: [{ span: '1995 to 2008', rules: 'CRT monitors on every desk. '.repeat(30) }],
        }),
      })

      await draftDirectorsBook(FIXTURE_PROJECT_ID)

      expect(recordRepairs).toHaveBeenCalledTimes(1)
      expect(recordRepairs).toHaveBeenCalledWith(direction, [
        { action: 'trimmed', field: 'era rule 1' },
      ])
    })

    it('retires the last notice when a redraft needed no repair', async () => {
      vi.stubEnv('MOCK_PROVIDERS', '')
      callLlm.mockReset()
      callLlm.mockResolvedValueOnce({
        text: JSON.stringify(mockDirectorsBook({ caseTitle: 'Case', chapterCount: 1 })),
      })

      await draftDirectorsBook(FIXTURE_PROJECT_ID)

      expect(recordRepairs).toHaveBeenCalledTimes(1)
      const [target, repairs] = recordRepairs.mock.calls[0]!
      expect(target).toEqual(direction)
      expect(repairs ?? []).toEqual([])
    })
  })
```

**`apps/web/inngest/functions/visuals-replanner.test.ts`** (database test, real notices store). In the `@boom-busters/db` import list add `listProjectNotices,` after `listCastMembers,` and `replaceNotices,` before `replaceShotList,`. Replace L28:

```ts
import { newId } from '@boom-busters/schemas'
```

with:

```ts
import { newId, noticesFor } from '@boom-busters/schemas'
```

Insert directly after the test `'op direction: two refused books stop the redraft and keep the stored book (decision 292)'` and before the first `it('refuses outside the plan checkpoint'` (L214):

```ts
  it('op direction: a trimmed book leaves its notice for the Direction card (decision 293)', async () => {
    const direction = { projectId: FIXTURE_PROJECT_ID, subject: 'direction' as const, subjectId: null }
    await replaceNotices(db, direction, [])
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockReset()
    callLlm.mockResolvedValueOnce({
      text: JSON.stringify({
        ...mockDirectorsBook({ caseTitle: 'x', chapterCount: 1 }),
        eraLocks: [{ span: '1995 to 2008', rules: 'CRT monitors on every desk. '.repeat(30) }],
      }),
    })

    const { result } = await engine.execute({ events: replanEvent('direction') })
    expect(result).toMatchObject({ outcome: 'redrafted' })

    const listed = noticesFor(await listProjectNotices(db, FIXTURE_PROJECT_ID), 'direction')
    expect(listed.map((notice) => [notice.kind, notice.message])).toEqual([
      ['trimmed', 'Trimmed to fit: era rule 1.'],
    ])
  })

  it('op direction: a clean redraft retires the last notice (decision 293)', async () => {
    const direction = { projectId: FIXTURE_PROJECT_ID, subject: 'direction' as const, subjectId: null }
    await replaceNotices(db, direction, [{ kind: 'trimmed', message: 'Trimmed to fit: era rule 1.' }])

    // Mock mode: the mock book needs no repair.
    const { result } = await engine.execute({ events: replanEvent('direction') })
    expect(result).toMatchObject({ outcome: 'redrafted' })

    expect(noticesFor(await listProjectNotices(db, FIXTURE_PROJECT_ID), 'direction')).toEqual([])
  })
```

**`apps/web/app/(console)/projects/[id]/direction-card.test.tsx`**. After L4 (`import { mockDirectorsBook } from '@boom-busters/providers'`) add:

```ts
import type { Notice } from '@boom-busters/schemas'
```

After the `vi.mock('./visuals-actions', ...)` block (ends L16) add:

```ts
// The notice line's Dismiss (decision 293) refreshes the page through its own
// action; neither is this card's to test.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/app/(console)/notice-actions', () => ({ dismissNoticeAction: vi.fn() }))
```

Without these two mocks every existing test in this file breaks once the card renders `Notices` (its `useRouter` has no app router in jsdom, and its action module pulls in `@/auth`); with them the existing assertions stand unchanged. Append at the end of the file:

```tsx
describe('DirectionCard notices (decision 293)', () => {
  const notice = (over: Partial<Notice>): Notice => ({
    id: '01J0000000000000000000000N',
    projectId: PROJECT,
    subject: 'direction',
    subjectId: null,
    kind: 'trimmed',
    message: 'Trimmed to fit: era rule 1.',
    createdAt: new Date('2026-10-09T10:00:00Z'),
    ...over,
  })

  it("says what the book's repair trimmed, with its own Dismiss button", () => {
    render(
      <DirectionCard
        projectId={PROJECT}
        direction={book}
        act={act}
        notices={[
          notice({
            message:
              "Trimmed to fit: era rule 1; Emad Mostaque's identity. Kept the first 12 never-shows.",
          }),
        ]}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      "Trimmed to fit: era rule 1; Emad Mostaque's identity. Kept the first 12 never-shows.",
    )
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeVisible()
    // The book's own buttons stay beside it.
    expect(screen.getByRole('button', { name: 'Save direction' })).toBeVisible()
  })

  it('says why a draft stopped when there is no book yet', () => {
    render(
      <DirectionCard
        projectId={PROJECT}
        direction={null}
        act={act}
        notices={[
          notice({
            kind: 'stopped',
            message:
              'The redraft stopped: the answer was cut off at its length limit. The book you had is kept.',
          }),
        ]}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent(
      'The redraft stopped: the answer was cut off at its length limit.',
    )
    expect(screen.getByText(/No direction has been written for this film yet/)).toBeVisible()
  })

  it('shows no notice line without notices', () => {
    render(<DirectionCard projectId={PROJECT} direction={book} act={act} />)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
  })
})
```

**`apps/web/app/(console)/projects/[id]/visual-board.test.tsx`**. After L6 (`import { DEFAULT_SETTINGS } from '@boom-busters/schemas'`) add:

```ts
import type { Notice } from '@boom-busters/schemas'
```

After the `vi.mock('@/app/(console)/settings/logo-actions', ...)` block (ends L102) add:

```ts
/** The notice line's own action (decision 293); `components/notices.test.tsx` tests it. */
vi.mock('@/app/(console)/notice-actions', () => ({ dismissNoticeAction: vi.fn() }))
```

At the end of `describe('the plan phase (staged-visuals design)'`, after the test that ends `expect(dismissRetypeAction).toHaveBeenCalledWith(PROJECT, SLOT_A)\n  })` (L1555) and before its closing `})` (L1556), add:

```tsx
  it("puts the book's notices on the Direction card and no other subject's (decision 293)", () => {
    const notice = (over: Partial<Notice>): Notice => ({
      id: '01J0000000000000000000000N',
      projectId: PROJECT,
      subject: 'direction',
      subjectId: null,
      kind: 'trimmed',
      message: 'Trimmed to fit: the visual thesis.',
      createdAt: new Date('2026-10-09T10:00:00Z'),
      ...over,
    })
    render(
      <VisualBoard
        projectId={PROJECT}
        model={planModel()}
        colors={COLORS}
        brand={BRAND}
        notices={[
          notice({}),
          notice({
            id: '01J0000000000000000000000P',
            subject: 'dossier',
            kind: 'dropped',
            message: 'Dropped claim 37: its text ran over 1,000 characters.',
          }),
          notice({
            id: '01J0000000000000000000000Q',
            subject: 'slot',
            subjectId: 'gone',
            kind: 'stopped',
            message: 'The retype stopped.',
          }),
        ]}
      />,
    )
    expect(screen.getByText('Trimmed to fit: the visual thesis.')).toBeInTheDocument()
    expect(screen.queryByText(/Dropped claim 37/)).not.toBeInTheDocument()
    expect(screen.queryByText('The retype stopped.')).not.toBeInTheDocument()
  })
```

- [ ] **Step 6: Run them to see them fail**

Run: `cd apps/web && pnpm exec vitest run "app/(console)/projects/[id]/direction-card.test.tsx" "app/(console)/projects/[id]/visual-board.test.tsx"`
Expected: FAIL, the new card tests: no `role="status"` line and no Dismiss button (the props are ignored). The existing tests pass with the new mocks.

Run (database test, alone, Docker Desktop running, `timeout: 600000`): `cd apps/web && pnpm exec vitest run inngest/lib/direction.test.ts`
Expected: FAIL, the two `the book's notice` tests: `recordRepairs` is never called.

Run (database test, alone, `timeout: 600000`): `cd apps/web && pnpm exec vitest run inngest/functions/visuals-replanner.test.ts`
Expected: FAIL, "a trimmed book leaves its notice" (no notice) and "a clean redraft retires the last notice" (the seeded notice is still open).

- [ ] **Step 7: Record the repairs where the book is stored**

In `apps/web/inngest/lib/direction.ts`, replace the provider type import (L24 to 29):

```ts
import type {
  DirectionCastInput,
  DirectionChapterInput,
  LLMTaskRequest,
  ScriptClaim,
} from '@boom-busters/providers'
```

with:

```ts
import type {
  DirectionCastInput,
  DirectionChapterInput,
  LLMTaskRequest,
  Repair,
  ScriptClaim,
} from '@boom-busters/providers'
```

After L52 (`import { callLlm } from '@/lib/llm'`) add:

```ts
import { recordRepairs } from '@/lib/notices'
```

Replace `draftDirectorsBook` (L213 to 238) with:

```ts
export async function draftDirectorsBook(projectId: string): Promise<DirectorsBook> {
  const inputs = await loadDirectionInputs(projectId)
  let book: DirectorsBook
  let repairs: Repair[] | undefined
  if (mockProvidersEnabled()) {
    book = mockDirectorsBook({
      caseTitle: inputs.caseTitle,
      chapterCount: inputs.chapters.length,
      cast: inputs.cast,
    })
  } else {
    // At most two calls (decision 292): the parser trims a fixable overrun,
    // a cut-off is asked once more at double the budget, a refusal once more
    // with its reason; then the stage stops with the reason, never a blind retry.
    const answer = await callForAnswer({
      request: buildDirectorsBookRequest(inputs),
      parse: (text, note) => parseDirectorsBook(text, inputs.chapters.length, note),
      complete: completeForProject(projectId),
    })
    book = answerOrStop(answer, "The director's book could not be drafted")
    repairs = answer.ok ? answer.repairs : undefined
  }
  await setProjectDirection(db, projectId, book)
  // What the repair trimmed, on the Direction card; a book that needed none
  // retires the last book's notice (decision 293). Written here, inside the
  // step that drafted it, so nothing new crosses a step boundary.
  await recordRepairs({ projectId, subject: 'direction', subjectId: null }, repairs)
  await seedCastFromPrincipals(db, projectId, book.principals)
  // The book's locations are the film's sets, exactly as its principals are
  // the film's cast (decision 264). Seeded once; the producer's removals stick.
  await seedSetsFromLocations(db, projectId, book.locations)
  return book
}
```

`loadOrDraftDirectorsBook` is unchanged: a stored book it reuses leaves its notices as they are.

- [ ] **Step 8: Show the notices on the Direction card**

In `apps/web/app/(console)/projects/[id]/direction-card.tsx`, replace L5:

```ts
import type { DirectorsBook, Principal } from '@boom-busters/schemas'
```

with:

```ts
import type { DirectorsBook, Notice, Principal } from '@boom-busters/schemas'
import { Notices } from '@/components/notices'
```

Replace the props (L137 to 151):

```tsx
export function DirectionCard({
  projectId,
  direction,
  busy = false,
  pressed = null,
  act,
}: {
  projectId: string
  direction: DirectorsBook | null
  /** Any plan-card action in flight: both buttons stand down until it lands. */
  busy?: boolean
  /** Which of the two is in flight (`direction-save` or `direction-redraft`), so only it spins. */
  pressed?: string | null
  act: Act
}) {
```

with:

```tsx
export function DirectionCard({
  projectId,
  direction,
  busy = false,
  pressed = null,
  act,
  notices = [],
}: {
  projectId: string
  direction: DirectorsBook | null
  /** Any plan-card action in flight: both buttons stand down until it lands. */
  busy?: boolean
  /** Which of the two is in flight (`direction-save` or `direction-redraft`), so only it spins. */
  pressed?: string | null
  act: Act
  /** What the book's repair trimmed, or why a redraft stopped (decision 293). */
  notices?: readonly Notice[]
}) {
```

Replace L171 to 172:

```tsx
      <CardContent className="flex flex-col gap-3">
        {form ? (
```

with:

```tsx
      <CardContent className="flex flex-col gap-3">
        <Notices notices={notices} />
        {form ? (
```

In `apps/web/app/(console)/projects/[id]/visual-board.tsx`, add `noticesFor,` to the value import from `@boom-busters/schemas` after `missingArticleFields,` (L24), and `Notice,` to the type import from `@boom-busters/schemas` after `GraphicElement,` (L33). Replace the `VisualBoardContent` signature (L1500 to 1516):

```tsx
function VisualBoardContent({
  projectId,
  model,
  colors,
  brand,
  setPhotos = [],
  castMembers = [],
}: {
  projectId: string
  model: VisualsReviewModel
  colors: BrandChartColors
  brand: BrandKitStored
  setPhotos?: readonly SetPhotoGroup[]
  /** The project's cast, for a post card's "one of the cast?" question (decision 284). */
  castMembers?: readonly CastOption[]
}) {
```

with:

```tsx
function VisualBoardContent({
  projectId,
  model,
  colors,
  brand,
  setPhotos = [],
  castMembers = [],
  notices = [],
}: {
  projectId: string
  model: VisualsReviewModel
  colors: BrandChartColors
  brand: BrandKitStored
  setPhotos?: readonly SetPhotoGroup[]
  /** The project's cast, for a post card's "one of the cast?" question (decision 284). */
  castMembers?: readonly CastOption[]
  /**
   * The project's open notices, every subject (decision 293). Each card picks
   * its own with `noticesFor`, so a notice whose slot is gone shows nowhere.
   */
  notices?: readonly Notice[]
}) {
```

In the `<DirectionCard` element (L1705 to 1717), after `act={act}` add:

```tsx
            notices={noticesFor(notices, 'direction')}
```

`VisualBoard` passes its props through (`React.ComponentProps<typeof VisualBoardContent>`), so it gains the prop with no further change.

In `apps/web/app/(console)/projects/[id]/page.tsx`, in the `<VisualBoard` element (around L495), after the line `castMembers={cast.map((member) => ({ id: member.id, name: member.name }))}` add:

```tsx
          // Every card on the board picks its own notices (decision 293).
          notices={notices}
```

`notices` is the value Task 3 loads once for the page.

- [ ] **Step 9: Run the tests, the consuming suites and the typecheck**

Run: `cd apps/web && pnpm exec vitest run "app/(console)/projects/[id]/direction-card.test.tsx" "app/(console)/projects/[id]/visual-board.test.tsx"`
Expected: PASS (direction-card: 11 tests).

Then, one at a time (database tests, alone, `timeout: 600000` each):
- `cd apps/web && pnpm exec vitest run inngest/lib/direction.test.ts`
- `cd apps/web && pnpm exec vitest run inngest/functions/visuals-replanner.test.ts`
- `cd apps/web && pnpm exec vitest run inngest/functions/visuals-runner.test.ts` (its `directors-book` step now writes through the real notices store)

Expected: PASS.

Then `pnpm typecheck` from the root.
Expected: clean.

- [ ] **Step 10: Format, lint, commit**

From the root, on the files below: `pnpm exec prettier --write <files>`, then `pnpm exec prettier --check <files>` and `pnpm exec eslint --max-warnings 0 <files>`.

```bash
git add packages/providers/src/prompts/direction.ts packages/providers/src/prompts/direction.test.ts apps/web/inngest/lib/direction.ts apps/web/inngest/lib/direction.test.ts apps/web/inngest/functions/visuals-replanner.test.ts "apps/web/app/(console)/projects/[id]/direction-card.tsx" "apps/web/app/(console)/projects/[id]/direction-card.test.tsx" "apps/web/app/(console)/projects/[id]/visual-board.tsx" "apps/web/app/(console)/projects/[id]/visual-board.test.tsx" "apps/web/app/(console)/projects/[id]/page.tsx"
git commit -F <message file>
```

Message: `feat(direction): the Director's Book says on its card what its repair trimmed (decision 293)` plus the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---


---

### Task 6: Research, limits and repairs in the dossier parsers

**Files:**
- Modify: `packages/schemas/src/dossier.ts` (constants after L26; the schemas at L110, L146 to 147, L153 to 159, L169, L173, L194, L197, L204, L209)
- Modify: `packages/providers/src/prompts/dossier.ts` (imports L1 to 16; repair helpers after `caseHeader`, L62; the four system prompts ending L76, L99, L146, L202; the four parsers L82 to 84, L112 to 114, L157 to 159, L221 to 223)
- Test: `packages/providers/src/prompts/dossier.test.ts` (imports L1 to 17; two `describe` blocks appended after L546)

**Interfaces:**
- Consumes: `Note`, `Repair`, `ignoreRepairs`, `trimField`, `capList`, `dropItems`, `overLimit` (Task 1, `@boom-busters/providers`); stage 1's `parseJsonCompletion`, `formatIssues` (`./json`).
- Produces:
  - `@boom-busters/schemas`: `DOSSIER_SUMMARY_MAX = 5000`, `DOSSIER_TURNING_POINT_MAX = 2000`, `DOSSIER_PRINCIPALS_MAX = 30`, `DOSSIER_OPEN_QUESTIONS_MAX = 20`, `DOSSIER_EVENT_WHEN_MAX = 100`, `DOSSIER_EVENT_WHAT_MAX = 1000`, `DOSSIER_EVENTS_MAX = 60`, `DOSSIER_CLAIM_TEXT_MAX = 1000`, `DOSSIER_CLAIMS_MAX = 120`, `DOSSIER_QUESTION_MAX = 1000`, `DOSSIER_ANSWER_MAX = 3000`, `DOSSIER_ANSWERS_MAX = 40`, `DOSSIER_ANSWER_CLAIMS_MAX = 40`, each used by its schema.
  - `@boom-busters/providers`: `parseBrief(text: string, note: Note = ignoreRepairs): CaseBrief`; `parseTimeline(text: string, note: Note = ignoreRepairs): TimelineEvent[]`; `parseClaims(text: string, note: Note = ignoreRepairs): DraftClaim[]`; `parseAnswers(text: string, note: Note = ignoreRepairs): ResearchAnswers`. Each fits `callForAnswer`'s `parse` as it is. Labels: `the brief's summary`, `the brief's turning point`, caps `principals` and `open questions`; `timeline event N` (trimmed, or dropped with `its date ran over 100 characters`), cap `timeline events`; `claim N` (dropped with `its text ran over 1,000 characters`), cap `claims`; `the answer to question N` (trimmed, or dropped with `its question ran over 1,000 characters`), cap `answers`; `claim N found while answering` (dropped), cap `claims found while answering`. N counts from 1 as the model wrote the list; for an answer, N is the question number it echoed when that is a whole number of 1 or more, else its place.
  - A refusal still reads `The model's <what> did not match the expected shape: <issues>` (a `ValidationError` with `field: <what>`), as before.

- [ ] **Step 1: Write the failing tests**

In `packages/providers/src/prompts/dossier.test.ts`, after the import block (L17) add:

```ts
import type { Note, Repair } from './repair'
```

Append at the end of the file:

```ts
describe('the research limits (decision 293)', () => {
  const flat = (request: { system: string }) => request.system.replace(/\s+/g, ' ')

  it('states every limit the brief is checked against', () => {
    expect(flat(buildBriefRequest(caseContext))).toContain(
      'Limits (the app checks them): "summary" 50 to 5000 characters; "turningPoint" 20 to 2000 characters; at most 30 principals, each with a name and a role; at most 20 open questions, each at least 10 characters.',
    )
  })

  it('states every limit the timeline is checked against', () => {
    expect(flat(buildTimelineRequest(caseContext, brief))).toContain(
      'Limits (the app checks them): 1 to 60 events; "when" 3 to 100 characters; "what" 10 to 1000 characters.',
    )
  })

  it('states every limit the claims are checked against', () => {
    expect(flat(buildClaimsRequest(caseContext, brief, []))).toContain(
      'Limits (the app checks them): 1 to 120 claims; each "text" 10 to 1000 characters.',
    )
  })

  it('states every limit the answers are checked against', () => {
    expect(flat(buildAnswersRequest(caseContext, brief, []))).toContain(
      'Limits (the app checks them): at most 40 answers; each "question" 10 to 1000 characters; each "answer" at most 3000 characters; at most 40 claims, each "text" 10 to 1000 characters.',
    )
  })
})

describe('the research repairs (decision 293)', () => {
  const collect = () => {
    const notes: Repair[] = []
    const note: Note = (repair) => {
      notes.push(repair)
    }
    return { notes, note }
  }

  const CLAIM = {
    text: 'Enron filed for bankruptcy in December 2001.',
    sourceUrl: 'https://example.com/filing',
    sourceType: 'court',
    confidence: 'sourced',
    adjudicated: true,
  }

  describe('parseBrief', () => {
    it('trims a long summary and turning point at a sentence, and says which', () => {
      const { notes, note } = collect()
      const parsed = parseBrief(
        JSON.stringify({
          ...brief,
          summary: 'The company grew fast. '.repeat(250),
          turningPoint: 'The auditors refused to sign. '.repeat(80),
        }),
        note,
      )
      expect(parsed.summary.length).toBeLessThanOrEqual(5000)
      expect(parsed.summary.endsWith('The company grew fast.')).toBe(true)
      expect(parsed.turningPoint.length).toBeLessThanOrEqual(2000)
      expect(notes).toEqual([
        { action: 'trimmed', field: "the brief's summary" },
        { action: 'trimmed', field: "the brief's turning point" },
      ])
    })

    it('keeps the first principals and open questions over their caps, names untouched', () => {
      const { notes, note } = collect()
      const parsed = parseBrief(
        JSON.stringify({
          ...brief,
          principals: Array.from({ length: 31 }, (_, at) => ({
            name: `Person ${at}`,
            role: 'Director',
          })),
          openQuestions: Array.from({ length: 21 }, (_, at) => `Open question number ${at}?`),
        }),
        note,
      )
      expect(parsed.principals).toHaveLength(30)
      expect(parsed.principals[29]).toEqual({ name: 'Person 29', role: 'Director' })
      expect(parsed.openQuestions).toHaveLength(20)
      expect(notes).toEqual([
        { action: 'capped', field: 'principals', kept: 30 },
        { action: 'capped', field: 'open questions', kept: 20 },
      ])
    })

    it('notes nothing for a brief within its limits, and still refuses one with no summary', () => {
      const { notes, note } = collect()
      parseBrief(JSON.stringify(brief), note)
      expect(notes).toEqual([])
      const { summary, ...rest } = brief
      void summary
      expect(() => parseBrief(JSON.stringify(rest), note)).toThrow(ValidationError)
    })
  })

  describe('parseTimeline', () => {
    it('drops an event whose date runs over, trims a long one, and numbers both as written', () => {
      const { notes, note } = collect()
      const events = parseTimeline(
        JSON.stringify({
          events: [
            { when: '2001', what: 'Bankruptcy filed.' },
            { when: 'x'.repeat(101), what: 'An event with a runaway date.' },
            {
              when: '2006',
              what: 'The convictions were returned. '.repeat(40),
              sourceUrl: 'https://example.com/ruling',
            },
          ],
        }),
        note,
      )
      expect(events.map((event) => event.when)).toEqual(['2001', '2006'])
      expect(events[1]!.what.length).toBeLessThanOrEqual(1000)
      expect(events[1]!.what.endsWith('The convictions were returned.')).toBe(true)
      expect(events[1]!.sourceUrl).toBe('https://example.com/ruling')
      expect(notes).toEqual([
        {
          action: 'dropped',
          field: 'timeline event 2',
          reason: 'its date ran over 100 characters',
        },
        { action: 'trimmed', field: 'timeline event 3' },
      ])
    })

    it('keeps the first 60 events', () => {
      const { notes, note } = collect()
      const events = parseTimeline(
        JSON.stringify({
          events: Array.from({ length: 61 }, (_, at) => ({
            when: `Day ${at + 1}`,
            what: `Event number ${at + 1} happened.`,
          })),
        }),
        note,
      )
      expect(events).toHaveLength(60)
      expect(notes).toEqual([{ action: 'capped', field: 'timeline events', kept: 60 }])
    })

    it('refuses a timeline its drops left empty', () => {
      expect(() =>
        parseTimeline(
          JSON.stringify({
            events: [{ when: 'x'.repeat(101), what: 'An event with a runaway date.' }],
          }),
        ),
      ).toThrow(ValidationError)
    })
  })

  describe('parseClaims', () => {
    it('drops a claim whose text runs over, keeps the rest whole, and names it', () => {
      const { notes, note } = collect()
      const parsed = parseClaims(
        JSON.stringify({
          claims: [
            { ...CLAIM, sourceType: 'SEC filing' },
            { ...CLAIM, text: 'A'.repeat(1001) },
            { ...CLAIM, text: 'Enron executives were convicted in 2006.' },
          ],
        }),
        note,
      )
      expect(parsed.map((claim) => claim.text)).toEqual([
        CLAIM.text,
        'Enron executives were convicted in 2006.',
      ])
      // Facts as the model gave them, with the source rules applied as before.
      expect(parsed[0]).toEqual({ ...CLAIM, sourceType: 'regulator' })
      expect(notes).toEqual([
        { action: 'dropped', field: 'claim 2', reason: 'its text ran over 1,000 characters' },
      ])
    })

    it('keeps the first 120 claims', () => {
      const { notes, note } = collect()
      const parsed = parseClaims(
        JSON.stringify({
          claims: Array.from({ length: 121 }, (_, at) => ({
            ...CLAIM,
            text: `Claim number ${at + 1} about Enron.`,
          })),
        }),
        note,
      )
      expect(parsed).toHaveLength(120)
      expect(notes).toEqual([{ action: 'capped', field: 'claims', kept: 120 }])
    })

    it('refuses a claims list its drops left empty', () => {
      expect(() =>
        parseClaims(JSON.stringify({ claims: [{ ...CLAIM, text: 'A'.repeat(1001) }] })),
      ).toThrow(ValidationError)
    })
  })

  describe('parseAnswers', () => {
    it('trims a long answer, drops one whose question ran over, and names each by its question', () => {
      const { notes, note } = collect()
      const parsed = parseAnswers(
        JSON.stringify({
          answers: [
            {
              index: 1,
              question: 'What did the board know in 1999?',
              answer: 'The Powers report found the board approved it. '.repeat(70),
              sourceUrl: 'https://example.com/powers-report',
            },
            { index: 2, question: 'Q'.repeat(1001), answer: 'An answer that will not be kept.' },
            { index: 3, question: 'Who leaked it to the press?', answer: null },
          ],
        }),
        note,
      )
      expect(parsed.answers.map((answer) => answer.index)).toEqual([1, 3])
      expect(parsed.answers[0]).toMatchObject({
        question: 'What did the board know in 1999?',
        sourceUrl: 'https://example.com/powers-report',
      })
      expect(parsed.answers[0]!.answer!.length).toBeLessThanOrEqual(3000)
      expect(parsed.answers[0]!.answer!.endsWith('approved it.')).toBe(true)
      expect(notes).toEqual([
        {
          action: 'dropped',
          field: 'the answer to question 2',
          reason: 'its question ran over 1,000 characters',
        },
        { action: 'trimmed', field: 'the answer to question 1' },
      ])
    })

    it('numbers an answer by its place when it echoed no number', () => {
      const { notes, note } = collect()
      parseAnswers(
        JSON.stringify({
          answers: [{ question: 'What did the board know in 1999?', answer: 'It knew. '.repeat(400) }],
        }),
        note,
      )
      expect(notes).toEqual([{ action: 'trimmed', field: 'the answer to question 1' }])
    })

    it('caps the answers and the claims found while answering, dropping an overlong claim first', () => {
      const { notes, note } = collect()
      const parsed = parseAnswers(
        JSON.stringify({
          answers: Array.from({ length: 41 }, (_, at) => ({
            question: `Open question number ${at + 1}?`,
            answer: null,
          })),
          claims: [
            { ...CLAIM, text: 'A'.repeat(1001) },
            ...Array.from({ length: 41 }, (_, at) => ({
              ...CLAIM,
              text: `Claim number ${at + 1} about Enron.`,
            })),
          ],
        }),
        note,
      )
      expect(parsed.answers).toHaveLength(40)
      expect(parsed.claims).toHaveLength(40)
      expect(parsed.claims[0]!.text).toBe('Claim number 1 about Enron.')
      expect(notes).toEqual([
        { action: 'capped', field: 'answers', kept: 40 },
        {
          action: 'dropped',
          field: 'claim 1 found while answering',
          reason: 'its text ran over 1,000 characters',
        },
        { action: 'capped', field: 'claims found while answering', kept: 40 },
      ])
    })
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/providers && pnpm exec vitest run src/prompts/dossier.test.ts`
Expected: FAIL: no prompt has a `Limits` line; each over-limit answer is refused whole (`ValidationError`) instead of repaired; no `note` is called. The existing tests pass.

- [ ] **Step 3: Add the limits to the dossier schemas**

In `packages/schemas/src/dossier.ts`, after L26 (`export type ClaimConfidenceName = z.infer<typeof ClaimConfidenceSchema>`), add:

```ts

/**
 * The research passes' limits (decision 293): one source for the schemas
 * below, the prompts that state them and the parsers that repair to them.
 * Free text over its limit is trimmed. A date label, a claim's text and an
 * answer's echoed question are facts: an item whose fact runs over is
 * dropped, never cut.
 */
export const DOSSIER_SUMMARY_MAX = 5000
export const DOSSIER_TURNING_POINT_MAX = 2000
export const DOSSIER_PRINCIPALS_MAX = 30
export const DOSSIER_OPEN_QUESTIONS_MAX = 20
export const DOSSIER_EVENT_WHEN_MAX = 100
export const DOSSIER_EVENT_WHAT_MAX = 1000
export const DOSSIER_EVENTS_MAX = 60
export const DOSSIER_CLAIM_TEXT_MAX = 1000
export const DOSSIER_CLAIMS_MAX = 120
export const DOSSIER_QUESTION_MAX = 1000
export const DOSSIER_ANSWER_MAX = 3000
export const DOSSIER_ANSWERS_MAX = 40
export const DOSSIER_ANSWER_CLAIMS_MAX = 40
```

The constants sit above `DraftClaimSchema` because the schemas read them when the module loads. Then replace, line by line:

- L110 `    text: z.string().trim().min(10).max(1000),` with `    text: z.string().trim().min(10).max(DOSSIER_CLAIM_TEXT_MAX),`
- L146 `  when: z.string().trim().min(3).max(100),` with `  when: z.string().trim().min(3).max(DOSSIER_EVENT_WHEN_MAX),`
- L147 `  what: z.string().trim().min(10).max(1000),` with `  what: z.string().trim().min(10).max(DOSSIER_EVENT_WHAT_MAX),`
- L153 `  summary: z.string().trim().min(50).max(5000),` with `  summary: z.string().trim().min(50).max(DOSSIER_SUMMARY_MAX),`
- L155 `  turningPoint: z.string().trim().min(20).max(2000),` with `  turningPoint: z.string().trim().min(20).max(DOSSIER_TURNING_POINT_MAX),`
- L157 `  principals: z.array(z.object({ name: z.string().min(2), role: z.string().min(2) })).max(30),` with:

```ts
  principals: z
    .array(z.object({ name: z.string().min(2), role: z.string().min(2) }))
    .max(DOSSIER_PRINCIPALS_MAX),
```

- L159 `  openQuestions: z.array(z.string().min(10)).max(20),` with `  openQuestions: z.array(z.string().min(10)).max(DOSSIER_OPEN_QUESTIONS_MAX),`
- L169 `  events: z.array(TimelineEventSchema).min(1).max(60),` with `  events: z.array(TimelineEventSchema).min(1).max(DOSSIER_EVENTS_MAX),`
- L173 `  claims: z.array(DraftClaimSchema).min(1).max(120),` with `  claims: z.array(DraftClaimSchema).min(1).max(DOSSIER_CLAIMS_MAX),`
- L194 `  question: z.string().trim().min(10).max(1000),` with `  question: z.string().trim().min(10).max(DOSSIER_QUESTION_MAX),`
- L197 `    z.string().max(3000).nullable(),` with `    z.string().max(DOSSIER_ANSWER_MAX).nullable(),`
- L204 `  answers: z.array(ResearchAnswerSchema).max(40),` with `  answers: z.array(ResearchAnswerSchema).max(DOSSIER_ANSWERS_MAX),`
- L209 `  claims: z.array(DraftClaimSchema).max(40).default([]),` with `  claims: z.array(DraftClaimSchema).max(DOSSIER_ANSWER_CLAIMS_MAX).default([]),`

`index: z.number().int().min(1).max(40).optional()` (L193) is a join key, not a limit the repair touches; it stays as it is. `SourceUrlSchema`, `foldSourceType` and the unverified transform are untouched.

- [ ] **Step 4: State the limits in the four prompts**

In `packages/providers/src/prompts/dossier.ts`, replace the imports (L1 to 16) with:

```ts
import {
  CaseBriefSchema,
  ClaimsSchema,
  DOSSIER_ANSWER_CLAIMS_MAX,
  DOSSIER_ANSWER_MAX,
  DOSSIER_ANSWERS_MAX,
  DOSSIER_CLAIM_TEXT_MAX,
  DOSSIER_CLAIMS_MAX,
  DOSSIER_EVENT_WHAT_MAX,
  DOSSIER_EVENT_WHEN_MAX,
  DOSSIER_EVENTS_MAX,
  DOSSIER_OPEN_QUESTIONS_MAX,
  DOSSIER_PRINCIPALS_MAX,
  DOSSIER_QUESTION_MAX,
  DOSSIER_SUMMARY_MAX,
  DOSSIER_TURNING_POINT_MAX,
  ResearchAnswersSchema,
  ResearchTimelineSchema,
  ValidationError,
} from '@boom-busters/schemas'
import type {
  CaseBrief,
  DraftClaim,
  ResearchAnswer,
  ResearchAnswers,
  TimelineEvent,
} from '@boom-busters/schemas'
import { z } from 'zod'
import { formatIssues, parseJsonCompletion } from './json'
import { capList, dropItems, ignoreRepairs, overLimit, trimField } from './repair'
import type { Note } from './repair'
import { outputBudget } from '../llm/types'
import type { LLMTaskRequest } from '../llm/types'
```

In `buildBriefRequest`, replace the end of the system prompt (L76):

```ts
 "openQuestions": [string]}`,
```

with:

```ts
 "openQuestions": [string]}

Limits (the app checks them): "summary" 50 to ${DOSSIER_SUMMARY_MAX} characters;
"turningPoint" 20 to ${DOSSIER_TURNING_POINT_MAX} characters; at most ${DOSSIER_PRINCIPALS_MAX}
principals, each with a name and a role; at most ${DOSSIER_OPEN_QUESTIONS_MAX} open questions,
each at least 10 characters.`,
```

In `buildTimelineRequest`, replace L99:

```ts
Include the events that make the turning point make sense, not every event.`,
```

with:

```ts
Include the events that make the turning point make sense, not every event.

Limits (the app checks them): 1 to ${DOSSIER_EVENTS_MAX} events; "when" 3 to
${DOSSIER_EVENT_WHEN_MAX} characters; "what" 10 to ${DOSSIER_EVENT_WHAT_MAX} characters.`,
```

In `buildClaimsRequest`, replace L146:

```ts
  check against your source is worse than no claim.`,
```

with:

```ts
  check against your source is worse than no claim.

Limits (the app checks them): 1 to ${DOSSIER_CLAIMS_MAX} claims; each "text" 10 to
${DOSSIER_CLAIM_TEXT_MAX} characters.`,
```

In `buildAnswersRequest`, replace L202:

```ts
  Repeat the question verbatim as well.`,
```

with:

```ts
  Repeat the question verbatim as well.

Limits (the app checks them): at most ${DOSSIER_ANSWERS_MAX} answers; each "question" 10 to
${DOSSIER_QUESTION_MAX} characters; each "answer" at most ${DOSSIER_ANSWER_MAX} characters; at
most ${DOSSIER_ANSWER_CLAIMS_MAX} claims, each "text" 10 to ${DOSSIER_CLAIM_TEXT_MAX} characters.`,
```

- [ ] **Step 5: Repair in the four parsers**

In `packages/providers/src/prompts/dossier.ts`, after `caseHeader` (its closing `}` at L62), add:

```ts

// ---------------------------------------------------------------------------
// Repairs (decision 293)
// ---------------------------------------------------------------------------

/**
 * A research answer is repaired before it is validated, as the Director's
 * Book is (decision 292): free text over its limit is trimmed at a sentence,
 * a list over its cap keeps its first items, and an item whose fact breaks a
 * rule (a date label, a claim's text, an echoed question) is dropped with the
 * rest kept, never cut. Each repair is reported through `note` in the words
 * the dossier review shows. What is left must still match the schema, or the
 * answer is refused and asked for once more.
 */

const Envelope = z.looseObject({})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function parseRepaired<T>(
  text: string,
  schema: z.ZodType<T>,
  what: string,
  repair: (raw: Record<string, unknown>) => unknown,
): T {
  const raw = parseJsonCompletion(text, Envelope, what)
  const result = schema.safeParse(repair(raw))
  if (!result.success) {
    throw new ValidationError(
      `The model's ${what} did not match the expected shape: ${formatIssues(result.error)}`,
      { field: what },
    )
  }
  return result.data
}

/** Why a fact over its limit drops its item ("its date ran over 100 characters"), or null. */
const longer = (value: unknown, max: number, what: string): string | null =>
  typeof value === 'string' && value.trim().length > max ? overLimit(what, max) : null

type Numbered = { item: unknown; at: number }

interface ListRules {
  /** The cap. */
  max: number
  /** The list in words, for a cap's notice ("Kept the first 120 claims."). */
  name: string
  /** One item in words, numbered from 1 as the model wrote the list ("claim 37"). */
  label: (item: unknown, at: number) => string
  /** Why an item breaks a rule on a fact, or null; such an item is dropped. */
  bad?: (item: unknown) => string | null
  /** Trims the free text of an item that is kept. */
  fix?: (item: Record<string, unknown>, label: string) => unknown
}

/**
 * One list of an answer: the items `bad` has a reason against are dropped,
 * the rest capped, and each one kept is fixed. Every item keeps the number it
 * had as the model wrote it, so a notice names "claim 37" even after an
 * earlier claim was dropped.
 */
function repairList(value: unknown, rules: ListRules, note: Note): unknown {
  if (!Array.isArray(value)) return value
  const numbered: Numbered[] = value.map((item: unknown, at: number) => ({ item, at }))
  const { bad, fix } = rules
  const usable = bad
    ? (dropItems(
        numbered,
        (entry) => bad((entry as Numbered).item),
        (entry) => rules.label((entry as Numbered).item, (entry as Numbered).at),
        note,
      ) as Numbered[])
    : numbered
  const kept = capList(usable, rules.max, rules.name, note) as Numbered[]
  return kept.map(({ item, at }) =>
    fix && isRecord(item) ? fix(item, rules.label(item, at)) : item,
  )
}

/** A claim's text is what a script narrates: over its limit the claim is dropped, never cut. */
const claimTooLong = (claim: unknown): string | null =>
  isRecord(claim) ? longer(claim['text'], DOSSIER_CLAIM_TEXT_MAX, 'its text') : null

/** The question an answer says it answers: the number it echoed, else its place in the list. */
function questionNumber(answer: unknown, at: number): number {
  const index = isRecord(answer) ? answer['index'] : undefined
  return typeof index === 'number' && Number.isInteger(index) && index >= 1 ? index : at + 1
}
```

Replace `parseBrief` (L82 to 84):

```ts
export function parseBrief(text: string): CaseBrief {
  return parseJsonCompletion(text, CaseBriefSchema, 'case brief')
}
```

with:

```ts
export function parseBrief(text: string, note: Note = ignoreRepairs): CaseBrief {
  return parseRepaired(text, CaseBriefSchema, 'case brief', (raw) => ({
    ...raw,
    summary: trimField(raw['summary'], DOSSIER_SUMMARY_MAX, "the brief's summary", note),
    turningPoint: trimField(
      raw['turningPoint'],
      DOSSIER_TURNING_POINT_MAX,
      "the brief's turning point",
      note,
    ),
    principals: capList(raw['principals'], DOSSIER_PRINCIPALS_MAX, 'principals', note),
    openQuestions: capList(raw['openQuestions'], DOSSIER_OPEN_QUESTIONS_MAX, 'open questions', note),
  }))
}
```

Replace `parseTimeline` (L112 to 114):

```ts
export function parseTimeline(text: string): TimelineEvent[] {
  return parseJsonCompletion(text, ResearchTimelineSchema, 'timeline').events
}
```

with:

```ts
export function parseTimeline(text: string, note: Note = ignoreRepairs): TimelineEvent[] {
  return parseRepaired(text, ResearchTimelineSchema, 'timeline', (raw) => ({
    ...raw,
    events: repairList(
      raw['events'],
      {
        max: DOSSIER_EVENTS_MAX,
        name: 'timeline events',
        label: (_, at) => `timeline event ${at + 1}`,
        // A date label is a fact: over its limit the event is dropped, never cut.
        bad: (event) =>
          isRecord(event) ? longer(event['when'], DOSSIER_EVENT_WHEN_MAX, 'its date') : null,
        fix: (event, label) => ({
          ...event,
          what: trimField(event['what'], DOSSIER_EVENT_WHAT_MAX, label, note),
        }),
      },
      note,
    ),
  })).events
}
```

Replace `parseClaims` (L157 to 159):

```ts
export function parseClaims(text: string): DraftClaim[] {
  return parseJsonCompletion(text, ClaimsSchema, 'claims').claims
}
```

with:

```ts
export function parseClaims(text: string, note: Note = ignoreRepairs): DraftClaim[] {
  return parseRepaired(text, ClaimsSchema, 'claims', (raw) => ({
    ...raw,
    claims: repairList(
      raw['claims'],
      {
        max: DOSSIER_CLAIMS_MAX,
        name: 'claims',
        label: (_, at) => `claim ${at + 1}`,
        bad: claimTooLong,
      },
      note,
    ),
  })).claims
}
```

Replace `parseAnswers` (L221 to 223):

```ts
export function parseAnswers(text: string): ResearchAnswers {
  return parseJsonCompletion(text, ResearchAnswersSchema, 'answers')
}
```

with:

```ts
export function parseAnswers(text: string, note: Note = ignoreRepairs): ResearchAnswers {
  return parseRepaired(text, ResearchAnswersSchema, 'answers', (raw) => ({
    ...raw,
    answers: repairList(
      raw['answers'],
      {
        max: DOSSIER_ANSWERS_MAX,
        name: 'answers',
        label: (answer, at) => `the answer to question ${questionNumber(answer, at)}`,
        // The echoed question is how an answer finds its question again: a fact.
        bad: (answer) =>
          isRecord(answer)
            ? longer(answer['question'], DOSSIER_QUESTION_MAX, 'its question')
            : null,
        fix: (answer, label) => ({
          ...answer,
          answer: trimField(answer['answer'], DOSSIER_ANSWER_MAX, label, note),
        }),
      },
      note,
    ),
    claims: repairList(
      raw['claims'],
      {
        max: DOSSIER_ANSWER_CLAIMS_MAX,
        name: 'claims found while answering',
        label: (_, at) => `claim ${at + 1} found while answering`,
        bad: claimTooLong,
      },
      note,
    ),
  }))
}
```

A missing list stays missing (`repairList` returns a non-list as it came), so the schema refuses it, or, for the answers pass's `claims`, applies its `.default([])`, as before.

- [ ] **Step 6: Run the dossier tests**

Run: `cd packages/providers && pnpm exec vitest run src/prompts/dossier.test.ts`
Expected: PASS: the 4 limit tests, the 12 repair tests, and every existing test (`SourceUrlSchema`'s softening and `foldSourceType` are unchanged; "refuses an empty claims list", "rejects a brief too thin", "rejects an empty timeline" and "refuses a confidence value" still throw `ValidationError`).

- [ ] **Step 7: Run the consuming suites and the typecheck**

The constants and the four parsers are shared: run `cd packages/schemas && pnpm test`, then `cd packages/providers && pnpm test`, then `pnpm typecheck` from the root (each with `timeout: 600000`).
Expected: PASS; typecheck clean. `apps/web/inngest/lib/dossier-research.ts` still compiles unchanged, because `note` is optional; no web test calls these parsers until Task 7 adds them.

- [ ] **Step 8: Format, lint, commit**

From the root, on the files below: `pnpm exec prettier --write <files>`, then `pnpm exec prettier --check <files>` and `pnpm exec eslint --max-warnings 0 <files>`.

```bash
git add packages/schemas/src/dossier.ts packages/providers/src/prompts/dossier.ts packages/providers/src/prompts/dossier.test.ts
git commit -F <message file>
```

Message: `feat(research): the dossier passes state their limits and repair what they can instead of refusing (decision 293)` plus the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---


---

### Task 7: Research on the helper, with dossier notices

**Files:**
- Modify: `apps/web/inngest/lib/dossier-research.ts` (imports L16 and L31; module comment L44; `ResearchResult` L59; `Guarded` and `guarded` L64 to 91; `researchDossier` L111, L113 to 134, L137 to 147, L150 to 165, L171, L174 to 188, L199; `empty` L219 to 221)
- Test: `apps/web/inngest/lib/dossier-research.test.ts` (new; touches no database)
- Modify: `apps/web/inngest/functions/dossier-runner.ts` (import after L13; `save-dossier` step L115 to 133)
- Test: `apps/web/inngest/functions/dossier-runner.test.ts` (new; database test)
- Modify: `apps/web/inngest/functions/dossier-reviser.ts` (import after L11; `save-revision` step L119 to 137)
- Test: `apps/web/inngest/functions/dossier-reviser.test.ts` (new; database test)
- Modify: `apps/web/app/(console)/projects/[id]/dossier-review.tsx` (imports L3 and L24; props L51 to 59; the return's first line L94)
- Test: `apps/web/app/(console)/projects/[id]/dossier-review.test.tsx` (imports L1 to 5; mocks after L31; one test before the closing `})` at L128)
- Modify: `apps/web/app/(console)/projects/[id]/page.tsx` (the `<DossierReview` element, around L525)

**Interfaces:**
- Consumes: `callForAnswer`, `Answer<T>` (Task 1, `@/lib/answer`); stage 1's `answerOrStop` and `completeForProject`; `parseBrief`, `parseTimeline`, `parseClaims`, `parseAnswers` with `note` (Task 6); `Repair` (Task 1); `recordRepairs` (Task 3, `@/lib/notices`); `Notices` (Task 3); `noticesFor`, `Notice` (Task 1); `page.tsx`'s `notices` (Task 3).
- Produces:
  - Each `research-*-N` step returns `{ ok: true; value: T; repairs?: Repair[] } | { ok: false; gate: Record<string, unknown> }`; mock mode returns no `repairs`. A stop is a `NonRetriableError` reading `The research brief could not be written: <issue>` (likewise `The research timeline could not be written`, `The claims could not be extracted`, `The open questions could not be answered`), and the function's `onFailure` fails the stage with it as today.
  - `ResearchResult.repairs: Repair[]`: the passes' repairs in pass order, each read with `?? []` where the step result is read, so a run parked before the deploy replays without a crash.
  - The `save-dossier` (runner) and `save-revision` (reviser) steps call `recordRepairs({ projectId, subject: 'dossier', subjectId: null }, research.repairs)` after `saveDossier`.
  - `DossierReview` prop `notices?: readonly Notice[]` (default `[]`), rendered at the top of the review, above the claims bar and the document.

- [ ] **Step 1: Write the failing research tests**

Create `apps/web/inngest/lib/dossier-research.test.ts`:

```ts
// @vitest-environment node

import { BudgetExceededError } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { researchDossier } from './dossier-research'

const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))

/**
 * The four research passes on the answer helper (decision 293), with a step
 * that runs each body as Inngest does the first time a run reaches it, or
 * hands back a stored result as it does when a parked run replays. No
 * database: the passes write nothing; the save steps do, and the runner's
 * and reviser's tests cover them.
 */

type Step = Parameters<typeof researchDossier>[0]

const live = {
  run: async (_id: string, body: () => Promise<unknown>) => body(),
} as unknown as Step

const replaying = (stored: Record<string, unknown>) =>
  ({ run: async (id: string) => stored[id] }) as unknown as Step

const CASE = { title: 'Wirecard', category: 'con', angle: null, demandNotes: null }
const input = { projectId: '01J0000000000000000000000P', caseContext: CASE, round: 0 }

const BRIEF = {
  summary:
    'Wirecard was a German payments company. It collapsed in June 2020 after EY refused to sign.',
  turningPoint: 'EY refused to sign the 2019 accounts.',
  principals: [{ name: 'Markus Braun', role: 'Chief executive' }],
  openQuestions: ['Where did the 1.9 billion euros go?'],
}
const EVENT = { when: 'June 2020', what: 'Wirecard filed for insolvency in Munich.' }
const CLAIM = {
  text: 'Wirecard filed for insolvency in June 2020.',
  sourceUrl: 'https://www.ft.com/wirecard',
  sourceType: 'major_outlet',
  confidence: 'sourced',
  adjudicated: false,
}
const ANSWERS = {
  answers: [{ index: 1, question: 'Where did the 1.9 billion euros go?', answer: null }],
  claims: [],
}

const reply = (value: unknown) => ({ text: JSON.stringify(value) })
const thin = { ...BRIEF, summary: 'It collapsed.' }

describe('researchDossier on the answer helper (decision 293)', () => {
  beforeEach(() => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('asks a refused pass once more with its reason, then carries on', async () => {
    callLlm
      .mockResolvedValueOnce(reply(thin))
      .mockResolvedValueOnce(reply(BRIEF))
      .mockResolvedValueOnce(reply({ events: [EVENT] }))
      .mockResolvedValueOnce(reply({ claims: [CLAIM] }))
      .mockResolvedValueOnce(reply(ANSWERS))

    const research = await researchDossier(live, input)

    expect(research.brief.summary).toBe(BRIEF.summary)
    expect(callLlm).toHaveBeenCalledTimes(5)
    expect(callLlm.mock.calls[0]![1]).not.toHaveProperty('purpose')
    expect(callLlm.mock.calls[1]![1]).toMatchObject({ purpose: 'retry: refused' })
    expect(callLlm.mock.calls[1]![0].messages.at(-1).content).toMatch(
      /^Your previous answer was refused: The model's case brief did not match the expected shape/,
    )
  })

  it('stops the stage with the reason after a second refusal, with no blind retry', async () => {
    callLlm.mockResolvedValue(reply(thin))

    const stopped = researchDossier(live, input)

    await expect(stopped).rejects.toBeInstanceOf(NonRetriableError)
    await expect(stopped).rejects.toThrow(
      /^The research brief could not be written: The model's case brief did not match the expected shape/,
    )
    expect(callLlm).toHaveBeenCalledTimes(2)
  })

  it("carries each pass's repairs, named so the owner can tell the passes apart", async () => {
    callLlm
      .mockResolvedValueOnce(reply({ ...BRIEF, summary: 'Wirecard grew fast. '.repeat(300) }))
      .mockResolvedValueOnce(
        reply({ events: [EVENT, { when: 'x'.repeat(101), what: 'A date that ran away.' }] }),
      )
      .mockResolvedValueOnce(reply({ claims: [CLAIM, { ...CLAIM, text: 'A'.repeat(1001) }] }))
      .mockResolvedValueOnce(
        reply({
          answers: [
            {
              index: 1,
              question: 'Where did the 1.9 billion euros go?',
              answer: 'Nobody has found it. '.repeat(200),
            },
          ],
          claims: [],
        }),
      )

    const research = await researchDossier(live, input)

    expect(research.repairs).toEqual([
      { action: 'trimmed', field: "the brief's summary" },
      { action: 'dropped', field: 'timeline event 2', reason: 'its date ran over 100 characters' },
      { action: 'dropped', field: 'claim 2', reason: 'its text ran over 1,000 characters' },
      { action: 'trimmed', field: 'the answer to question 1' },
    ])
    expect(research.timeline).toHaveLength(1)
    expect(research.claims.map((claim) => claim.text)).toEqual([CLAIM.text])
    expect(callLlm).toHaveBeenCalledTimes(4)
  })

  it('reads a replayed step result without repairs as none, and calls nothing', async () => {
    // A run parked before decision 293 replays results stored without `repairs`.
    const research = await researchDossier(
      replaying({
        'research-brief-0': { ok: true, value: BRIEF },
        'research-timeline-0': { ok: true, value: [EVENT] },
        'research-claims-0': { ok: true, value: [CLAIM] },
        'research-answers-0': { ok: true, value: ANSWERS },
      }),
      input,
    )

    expect(research.repairs).toEqual([])
    expect(research.brief).toEqual(BRIEF)
    expect(research.claims).toEqual([CLAIM])
    expect(callLlm).not.toHaveBeenCalled()
  })

  it('still parks on the budget gate rather than failing the stage', async () => {
    callLlm.mockRejectedValueOnce(
      new BudgetExceededError({
        provider: 'anthropic',
        operation: 'research',
        budgetUsd: 50,
        monthSpendUsd: 49.9,
        estimateUsd: 0.5,
      }),
    )

    const research = await researchDossier(live, input)

    expect(research.budgetGate).toMatchObject({ gate: 'budget', provider: 'anthropic' })
    expect(research.repairs).toEqual([])
    expect(callLlm).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Write the failing save-step tests**

Create `apps/web/inngest/functions/dossier-runner.test.ts` (database test):

```ts
// @vitest-environment node

import {
  FIXTURE_CASE_ID,
  FIXTURE_PROJECT_ID,
  requireTestDatabase,
  seed,
  truncateRunMirror,
} from '@boom-busters/db'
import type * as Db from '@boom-busters/db'
import { InngestTestEngine } from '@inngest/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { dossierRunner } from './dossier-runner'

/**
 * The dossier-runner's save step (decision 293), against the test database's
 * run mirror. The research steps are handed stored results, as Inngest hands
 * a replaying run the results it kept, so no model is called; `saveDossier`
 * is stubbed so the fixture dossier other suites read is never rewritten.
 */

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))
const recordRepairs = vi.hoisted(() => vi.fn())
vi.mock('@/lib/notices', () => ({ recordRepairs, recordStop: vi.fn() }))
const saveDossier = vi.hoisted(() => vi.fn())
vi.mock('@boom-busters/db', async (importOriginal) => ({
  ...(await importOriginal<typeof Db>()),
  saveDossier: (...args: unknown[]) => saveDossier(...args),
}))

const describeDb = requireTestDatabase() ? describe : describe.skip

const CASE = { title: 'Wirecard', category: 'con', angle: null, demandNotes: null }
const BRIEF = {
  summary:
    'Wirecard was a German payments company. It collapsed in June 2020 after EY refused to sign.',
  turningPoint: 'EY refused to sign the 2019 accounts.',
  principals: [{ name: 'Markus Braun', role: 'Chief executive' }],
  openQuestions: ['Where did the 1.9 billion euros go?'],
}
const EVENTS = [{ when: 'June 2020', what: 'Wirecard filed for insolvency in Munich.' }]
const CLAIMS = [
  {
    text: 'Wirecard filed for insolvency in June 2020.',
    sourceUrl: 'https://www.ft.com/wirecard',
    sourceType: 'major_outlet',
    confidence: 'sourced',
    adjudicated: false,
  },
]
const ANSWERS = {
  answers: [{ index: 1, question: 'Where did the 1.9 billion euros go?', answer: null }],
  claims: [],
}
const DOSSIER = { projectId: FIXTURE_PROJECT_ID, subject: 'dossier', subjectId: null }

function created(): [{ name: string; data: Record<string, unknown> }] {
  return [
    {
      name: 'project/created',
      data: { projectId: FIXTURE_PROJECT_ID, caseId: FIXTURE_CASE_ID },
    },
  ]
}

/** The case and the four passes' stored results; a pass carries `repairs` only when given some. */
function stored(repairs: Record<string, unknown[]> = {}) {
  const pass = (id: string, value: unknown) => ({
    id,
    handler: () => (repairs[id] ? { ok: true, value, repairs: repairs[id] } : { ok: true, value }),
  })
  return [
    { id: 'load-case', handler: () => CASE },
    pass('research-brief-0', BRIEF),
    pass('research-timeline-0', EVENTS),
    pass('research-claims-0', CLAIMS),
    pass('research-answers-0', ANSWERS),
  ]
}

describeDb('dossier-runner: the dossier notice (decision 293)', () => {
  let engine: InngestTestEngine

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: dossierRunner })
    recordRepairs.mockReset()
    saveDossier.mockReset()
    saveDossier.mockResolvedValue({ claims: [] })
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
  })

  it("records the four passes' repairs as the dossier's notice when it is saved", async () => {
    await engine.executeStep('save-dossier', {
      events: created(),
      steps: stored({
        'research-brief-0': [{ action: 'trimmed', field: "the brief's summary" }],
        'research-timeline-0': [
          {
            action: 'dropped',
            field: 'timeline event 4',
            reason: 'its date ran over 100 characters',
          },
        ],
        'research-claims-0': [
          { action: 'dropped', field: 'claim 37', reason: 'its text ran over 1,000 characters' },
        ],
        'research-answers-0': [{ action: 'trimmed', field: 'the answer to question 3' }],
      }),
    })

    expect(saveDossier).toHaveBeenCalledTimes(1)
    expect(recordRepairs).toHaveBeenCalledTimes(1)
    expect(recordRepairs).toHaveBeenCalledWith(DOSSIER, [
      { action: 'trimmed', field: "the brief's summary" },
      { action: 'dropped', field: 'timeline event 4', reason: 'its date ran over 100 characters' },
      { action: 'dropped', field: 'claim 37', reason: 'its text ran over 1,000 characters' },
      { action: 'trimmed', field: 'the answer to question 3' },
    ])
  })

  it('saves research replayed from before the notices, with no notice and no crash', async () => {
    // A run parked before decision 293 replays step results stored without `repairs`.
    await engine.executeStep('save-dossier', { events: created(), steps: stored() })

    expect(saveDossier).toHaveBeenCalledTimes(1)
    expect(saveDossier.mock.calls[0]![1]).toMatchObject({
      projectId: FIXTURE_PROJECT_ID,
      claims: [expect.objectContaining({ text: CLAIMS[0]!.text })],
    })
    expect(recordRepairs).toHaveBeenCalledWith(DOSSIER, [])
  })
})
```

Create `apps/web/inngest/functions/dossier-reviser.test.ts` (database test):

```ts
// @vitest-environment node

import {
  FIXTURE_PROJECT_ID,
  requireTestDatabase,
  seed,
  truncateRunMirror,
} from '@boom-busters/db'
import type * as Db from '@boom-busters/db'
import { InngestTestEngine } from '@inngest/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { dossierReviser } from './dossier-reviser'

/**
 * The dossier-reviser's save step (decision 293): a revision's repairs
 * replace the dossier's notice, and a pass replayed without `repairs` adds
 * none. Research results are handed in; `saveDossier` is stubbed so the
 * fixture dossier is never rewritten.
 */

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))
const recordRepairs = vi.hoisted(() => vi.fn())
vi.mock('@/lib/notices', () => ({ recordRepairs, recordStop: vi.fn() }))
const saveDossier = vi.hoisted(() => vi.fn())
vi.mock('@boom-busters/db', async (importOriginal) => ({
  ...(await importOriginal<typeof Db>()),
  saveDossier: (...args: unknown[]) => saveDossier(...args),
}))

const describeDb = requireTestDatabase() ? describe : describe.skip

const CASE = { title: 'Wirecard', category: 'con', angle: null, demandNotes: null }
const BRIEF = {
  summary:
    'Wirecard was a German payments company. It collapsed in June 2020 after EY refused to sign.',
  turningPoint: 'EY refused to sign the 2019 accounts.',
  principals: [{ name: 'Markus Braun', role: 'Chief executive' }],
  openQuestions: ['Where did the 1.9 billion euros go?'],
}
const EVENTS = [{ when: 'June 2020', what: 'Wirecard filed for insolvency in Munich.' }]
const CLAIMS = [
  {
    text: 'Wirecard filed for insolvency in June 2020.',
    sourceUrl: 'https://www.ft.com/wirecard',
    sourceType: 'major_outlet',
    confidence: 'sourced',
    adjudicated: false,
  },
]
const ANSWERS = {
  answers: [{ index: 1, question: 'Where did the 1.9 billion euros go?', answer: null }],
  claims: [],
}

describeDb('dossier-reviser: the dossier notice (decision 293)', () => {
  let engine: InngestTestEngine

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: dossierReviser })
    recordRepairs.mockReset()
    saveDossier.mockReset()
    saveDossier.mockResolvedValue({ claims: [] })
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
  })

  it("records the revision's repairs, reading a pass replayed without them as none", async () => {
    await engine.executeStep('save-revision', {
      events: [
        {
          name: 'gate/dossier.changes_requested',
          data: { projectId: FIXTURE_PROJECT_ID, note: 'More on the auditors, please.' },
        },
      ],
      steps: [
        { id: 'load-case', handler: () => ({ round: 1, caseContext: CASE }) },
        {
          id: 'research-brief-1',
          handler: () => ({
            ok: true,
            value: BRIEF,
            repairs: [{ action: 'trimmed', field: "the brief's turning point" }],
          }),
        },
        { id: 'research-timeline-1', handler: () => ({ ok: true, value: EVENTS }) },
        {
          id: 'research-claims-1',
          handler: () => ({
            ok: true,
            value: CLAIMS,
            repairs: [{ action: 'capped', field: 'claims', kept: 120 }],
          }),
        },
        { id: 'research-answers-1', handler: () => ({ ok: true, value: ANSWERS }) },
      ],
    })

    expect(saveDossier).toHaveBeenCalledTimes(1)
    expect(recordRepairs).toHaveBeenCalledTimes(1)
    expect(recordRepairs).toHaveBeenCalledWith(
      { projectId: FIXTURE_PROJECT_ID, subject: 'dossier', subjectId: null },
      [
        { action: 'trimmed', field: "the brief's turning point" },
        { action: 'capped', field: 'claims', kept: 120 },
      ],
    )
  })
})
```

- [ ] **Step 3: Write the failing review test**

In `apps/web/app/(console)/projects/[id]/dossier-review.test.tsx`, after L1 (`import type { ClaimRow } from '@boom-busters/db'`) add:

```ts
import type { Notice } from '@boom-busters/schemas'
```

After the `vi.mock('@/components/ui/toast', ...)` line (L31) add:

```ts
// The notice line's own action (decision 293); `components/notices.test.tsx` tests it.
vi.mock('@/app/(console)/notice-actions', () => ({ dismissNoticeAction: vi.fn() }))
```

Without it the existing tests break once the review renders `Notices` (the real action module pulls in `@/auth`); with it their assertions stand unchanged. Before the closing `})` of `describe('DossierReview'` (L128), add:

```tsx
  it('shows what the research trimmed or dropped above the document (decision 293)', () => {
    const notice: Notice = {
      id: '01J0000000000000000000000N',
      projectId: 'p1',
      subject: 'dossier',
      subjectId: null,
      kind: 'dropped',
      message:
        "Trimmed to fit: the brief's summary. Dropped claim 37: its text ran over 1,000 characters.",
      createdAt: new Date('2026-10-09T10:00:00Z'),
    }
    render(<DossierReview projectId="p1" contentMd={MD} claims={[]} notices={[notice]} />)

    const line = screen.getByRole('status')
    expect(line).toHaveTextContent(
      "Trimmed to fit: the brief's summary. Dropped claim 37: its text ran over 1,000 characters.",
    )
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
    // Above the document, where the owner starts reading.
    expect(
      line.compareDocumentPosition(screen.getByText('Dossier')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
```

- [ ] **Step 4: Run them to see them fail**

Run: `cd apps/web && pnpm exec vitest run inngest/lib/dossier-research.test.ts`
Expected: FAIL: a refused brief stops at once (one call, `guarded` wraps the `ValidationError` as it does today); `research.repairs` is `undefined`. The budget test passes already.

Run: `cd apps/web && pnpm exec vitest run "app/(console)/projects/[id]/dossier-review.test.tsx"`
Expected: FAIL, the new test: no `role="status"` line. The existing six pass.

Run (database tests, one at a time, alone, `timeout: 600000`): `cd apps/web && pnpm exec vitest run inngest/functions/dossier-runner.test.ts`, then `cd apps/web && pnpm exec vitest run inngest/functions/dossier-reviser.test.ts`
Expected: FAIL: `recordRepairs` is never called.

- [ ] **Step 5: Put the four passes on the helper**

In `apps/web/inngest/lib/dossier-research.ts`:

After L16 (`} from '@boom-busters/providers'`) add:

```ts
import type { Repair } from '@boom-busters/providers'
```

Replace L31:

```ts
import { callLlm } from '@/lib/llm'
```

with:

```ts
import { answerOrStop, callForAnswer } from '@/lib/answer'
import type { Answer } from '@/lib/answer'
import { completeForProject } from '@/lib/answer-call'
```

In the module comment, after L44 (` * the Needs-you card renders from.`) and before ` */`, add:

```ts
 *
 * Each pass is one answer on `callForAnswer` (decision 293): a refused or
 * cut-off pass is asked once more, and what the parser trimmed or dropped
 * travels beside the value as `repairs`, for the notice the save step writes.
```

In `ResearchResult`, after `answers: ResearchAnswer[]` (L59) add:

```ts
  /**
   * What the passes repaired (decision 293), in pass order, for the notice on
   * the dossier review. Never missing here: each pass's list is read with a
   * default, since a run parked before the deploy replays results without one.
   */
  repairs: Repair[]
```

Replace L64 to 91 (the `Guarded` type, the comment above `guarded` and `guarded` itself) with:

```ts
type Guarded<T> =
  | { ok: true; value: T; repairs?: Repair[] }
  | { ok: false; gate: Record<string, unknown> }

/**
 * `BudgetExceededError` is caught here rather than thrown, because throwing it
 * into Inngest's retry machinery would retry a call the guard has already
 * refused, four more times, to be refused four more times.
 *
 * Everything else the taxonomy calls non-retriable is re-thrown as
 * `NonRetriableError`, which is spec section 7 and was missing. Without it
 * Inngest applied the same four attempts to a `ValidationError`, and a research
 * pass that came back in the wrong shape was paid for five times over before
 * anyone saw it fail. Retrying is for a provider having a bad minute; it is
 * not a way to argue with a schema.
 *
 * The answer itself comes from the helper (decision 293): at most two calls,
 * then `answerOrStop` stops the stage with the reason as a `NonRetriableError`.
 * That is not a `PipelineError`, so `isRetriable` passes it on unchanged.
 */
async function guarded<T>(what: string, ask: () => Promise<Answer<T>>): Promise<Guarded<T>> {
  try {
    const answer = await ask()
    const value = answerOrStop(answer, what)
    return { ok: true, value, repairs: answer.ok ? (answer.repairs ?? []) : [] }
  } catch (error) {
    if (error instanceof BudgetExceededError) return { ok: false, gate: budgetGateData(error) }
    if (!isRetriable(error)) {
      throw new NonRetriableError(
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? { cause: error } : {},
      )
    }
    throw error
  }
}
```

After L111 (`const mocked = mockProvidersEnabled()`) add:

```ts
  const complete = completeForProject(projectId)
```

Replace the brief step (L113 to 134) with:

```ts
  const brief = await step.run(`research-brief-${round}`, async (): Promise<Guarded<CaseBrief>> => {
    if (mocked) return { ok: true, value: mockBrief(caseContext) }
    const request = buildBriefRequest(caseContext)
    return guarded('The research brief could not be written', () =>
      callForAnswer({
        request: note
          ? {
              ...request,
              messages: [
                ...request.messages,
                { role: 'user' as const, content: `The human asks for changes: ${note}` },
              ],
            }
          : request,
        parse: parseBrief,
        complete,
      }),
    )
  })
```

Replace the timeline step (L137 to 147) with:

```ts
  const timeline = await step.run(
    `research-timeline-${round}`,
    async (): Promise<Guarded<TimelineEvent[]>> => {
      if (mocked) return { ok: true, value: mockTimeline() }
      return guarded('The research timeline could not be written', () =>
        callForAnswer({
          request: buildTimelineRequest(caseContext, brief.value),
          parse: parseTimeline,
          complete,
        }),
      )
    },
  )
```

Replace the claims step (L150 to 164) with:

```ts
  const claims = await step.run(
    `research-claims-${round}`,
    async (): Promise<Guarded<DraftClaim[]>> => {
      if (mocked) return { ok: true, value: mockClaims() }
      return guarded('The claims could not be extracted', () =>
        callForAnswer({
          request: buildClaimsRequest(caseContext, brief.value, timeline.value),
          parse: parseClaims,
          complete,
        }),
      )
    },
  )
```

After L165 (`if (!claims.ok) return { ...empty(), budgetGate: claims.gate }`) add:

```ts

  // What each pass repaired (decision 293), read with a default: a run parked
  // before the deploy replays step results stored without `repairs` (spec 5.1).
  const repairs: Repair[] = [
    ...(brief.repairs ?? []),
    ...(timeline.repairs ?? []),
    ...(claims.repairs ?? []),
  ]
```

Replace L171:

```ts
    return { brief: brief.value, timeline: timeline.value, claims: claims.value, answers: [] }
```

with:

```ts
    return {
      brief: brief.value,
      timeline: timeline.value,
      claims: claims.value,
      answers: [],
      repairs,
    }
```

Replace the answers step (L174 to 188) with:

```ts
  const answers = await step.run(
    `research-answers-${round}`,
    async (): Promise<Guarded<ResearchAnswers>> => {
      if (mocked) return { ok: true, value: mockAnswers(brief.value) }
      return guarded('The open questions could not be answered', () =>
        callForAnswer({
          request: buildAnswersRequest(caseContext, brief.value, timeline.value),
          parse: parseAnswers,
          complete,
        }),
      )
    },
  )
```

After L199 (`    answers: answers.value.answers,`) add:

```ts
    repairs: [...repairs, ...(answers.repairs ?? [])],
```

Replace `empty` (L219 to 221) with:

```ts
function empty(): ResearchResult {
  return { brief: EMPTY_BRIEF, timeline: [], claims: [], answers: [], repairs: [] }
}
```

- [ ] **Step 6: Record the notice in both save steps**

In `apps/web/inngest/functions/dossier-runner.ts`, after L13 (`import { db } from '@/lib/db'`) add:

```ts
import { recordRepairs } from '@/lib/notices'
```

In the `save-dossier` step, replace L132 to 133:

```ts
      return countClaims(saved.claims)
    })
```

with:

```ts
      // What the research passes trimmed or dropped, on the dossier review; a
      // clean dossier retires the last one's notice (decision 293).
      await recordRepairs({ projectId, subject: 'dossier', subjectId: null }, research.repairs)
      return countClaims(saved.claims)
    })
```

In `apps/web/inngest/functions/dossier-reviser.ts`, after L11 (`import { db } from '@/lib/db'`) add:

```ts
import { recordRepairs } from '@/lib/notices'
```

In the `save-revision` step, replace L136 to 137:

```ts
      return countClaims(saved.claims)
    })
```

with:

```ts
      // What the revision's passes trimmed or dropped, on the dossier review; a
      // clean revision retires the last notice (decision 293).
      await recordRepairs({ projectId, subject: 'dossier', subjectId: null }, research.repairs)
      return countClaims(saved.claims)
    })
```

- [ ] **Step 7: Show the notice on the dossier review**

In `apps/web/app/(console)/projects/[id]/dossier-review.tsx`, after L3 (`import type { ClaimRow } from '@boom-busters/db'`) add:

```ts
import type { Notice } from '@boom-busters/schemas'
```

After L7 (`import { ConfirmButton } from '@/components/confirm-button'`) add:

```ts
import { Notices } from '@/components/notices'
```

Replace the props (L51 to 59):

```tsx
export function DossierReview({
  projectId,
  contentMd,
  claims,
}: {
  projectId: string
  contentMd: string
  claims: ClaimRow[]
}) {
```

with:

```tsx
export function DossierReview({
  projectId,
  contentMd,
  claims,
  notices = [],
}: {
  projectId: string
  contentMd: string
  claims: ClaimRow[]
  /** What the research passes trimmed or dropped (decision 293). */
  notices?: readonly Notice[]
}) {
```

Replace L94 to 95:

```tsx
    <div className="flex flex-col gap-4">
      <Card>
```

with:

```tsx
    <div className="flex flex-col gap-4">
      <Notices notices={notices} />
      <Card>
```

In `apps/web/app/(console)/projects/[id]/page.tsx`, replace the `<DossierReview` element (around L525):

```tsx
        <DossierReview
          projectId={project.id}
          contentMd={dossier.contentMd}
          claims={dossier.claims}
        />
```

with:

```tsx
        <DossierReview
          projectId={project.id}
          contentMd={dossier.contentMd}
          claims={dossier.claims}
          notices={noticesFor(notices, 'dossier')}
        />
```

`noticesFor` and `notices` are already on the page (Task 3).

- [ ] **Step 8: Run the tests and the typecheck**

Run: `cd apps/web && pnpm exec vitest run inngest/lib/dossier-research.test.ts "app/(console)/projects/[id]/dossier-review.test.tsx"`
Expected: PASS (5 and 7 tests).

Then, one at a time (database tests, alone, Docker Desktop running, `timeout: 600000` each):
- `cd apps/web && pnpm exec vitest run inngest/functions/dossier-runner.test.ts`
- `cd apps/web && pnpm exec vitest run inngest/functions/dossier-reviser.test.ts`
- `cd apps/web && pnpm exec vitest run inngest/functions/index.test.ts inngest/functions/demo-pipeline.test.ts` (the function registry and the dossier gate)

Expected: PASS.

Then `pnpm typecheck` from the root.
Expected: clean.

- [ ] **Step 9: Format, lint, commit**

From the root, on the files below: `pnpm exec prettier --write <files>`, then `pnpm exec prettier --check <files>` and `pnpm exec eslint --max-warnings 0 <files>`.

```bash
git add apps/web/inngest/lib/dossier-research.ts apps/web/inngest/lib/dossier-research.test.ts apps/web/inngest/functions/dossier-runner.ts apps/web/inngest/functions/dossier-runner.test.ts apps/web/inngest/functions/dossier-reviser.ts apps/web/inngest/functions/dossier-reviser.test.ts "apps/web/app/(console)/projects/[id]/dossier-review.tsx" "apps/web/app/(console)/projects/[id]/dossier-review.test.tsx" "apps/web/app/(console)/projects/[id]/page.tsx"
git commit -F <message file>
```

Message: `feat(research): the dossier passes run on the answer helper and say on the review what they repaired (decision 293)` plus the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 8: Case suggestions

**Files:**
- Modify: `packages/schemas/src/cases.ts` (the whole file, 41 lines: header comment, new constants, the schema)
- Modify: `packages/providers/src/prompts/cases.ts` (imports lines 1 to 5; the `SYSTEM` rules end at line 38; `parseSuggestedCases` lines 65 to 67)
- Test: `packages/providers/src/prompts/cases.test.ts` (imports lines 1 to 3; delete lines 80 to 86; append a block at the end)
- Modify: `apps/web/app/(console)/cases/actions.ts` (imports lines 16 to 29; `SuggestResult` lines 139 to 144; after `SuggestInputSchema` line 149; the body of `suggestCases` lines 158 to 203)
- Create: `apps/web/app/(console)/cases/actions.test.ts` (no database: every seam is mocked)
- Modify: `apps/web/app/(console)/cases/page.tsx` (import line 1; body lines 28 to 31)
- Modify: `apps/web/app/(console)/cases/case-library.tsx` (imports lines 3 to 19; `CaseLibrary` line 47; rows lines 89 and 116; `SuggestionRow` line 167 and its end at line 204; `BacklogRow` line 209 and its end at line 265; the success toast lines 325 to 329)
- Create: `apps/web/app/(console)/cases/case-library.test.tsx`

**Interfaces:**
- Consumes: `Note`, `Repair`, `ignoreRepairs`, `trimField`, `capList`, `dropItems`, `overLimit`, `describeRepairs` (Task 1) and `trimText` (stage 1) from `@boom-busters/providers`; `callForAnswer`, `Answer`, `AnswerComplete` (Task 1, `@/lib/answer`); `recordRepairs` (Task 3, `@/lib/notices`); `listCaseNotices` (Task 2, `@boom-busters/db`); `Notices` (Task 3, `@/components/notices`); `noticesFor`, `Notice` (Task 1, `@boom-busters/schemas`).
- Produces:
  - `@boom-busters/schemas`: `CASE_TITLE_MIN = 3`, `CASE_TITLE_MAX = 200`, `CASE_ANGLE_MIN = 10`, `CASE_ANGLE_MAX = 2000`, `CASE_DEMAND_NOTES_MAX = 2000`, `CASE_LINKS_MAX = 10`, `CASE_LINK_NOTE_MAX = 500`, `CASE_PRIORITY_MIN = 0`, `CASE_PRIORITY_MAX = 100`, `CASE_SUGGESTIONS_MAX = 20`.
  - `@boom-busters/providers`: `parseSuggestedCases(text: string, count?: number, note?: Note): CaseSuggestion[]` (count defaults to `CASE_SUGGESTIONS_MAX`); `fileCaseRepairs(repairs: readonly Repair[], titles: readonly string[]): { byTitle: Map<string, Repair[]>; rest: Repair[] }`. Repair labels: `the angle of <title>`, `the demand notes of <title>`, `the note on link <n> of <title>`, `competitor links of <title>` (capped), `the priority score of <title>` (rounded), `suggestion <n> ("<first words>...")` (dropped), `suggestions` (capped).
  - `suggestCases` returns `SuggestResult` with a new optional `notice?: string`: the line for what no row can carry (a dropped suggestion, the cut to the number asked for).
  - `CaseLibrary` takes `notices?: readonly Notice[]` (the cases' open notices).

- [ ] **Step 1: Write the failing provider tests**

In `packages/providers/src/prompts/cases.test.ts`, replace the imports (lines 1 to 3) with:

```ts
import {
  CASE_ANGLE_MAX,
  CASE_DEMAND_NOTES_MAX,
  CASE_LINK_NOTE_MAX,
  ValidationError,
} from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import {
  buildSuggestCasesRequest,
  fileCaseRepairs,
  mockSuggestedCases,
  parseSuggestedCases,
} from './cases'
import type { Note, Repair } from './repair'
```

Delete the two tests `'rejects a priority score outside 0-100'` and `'rejects a non-integer priority score'` (lines 80 to 86): decision 293 rounds and clamps the score instead of refusing it, and the block below asserts that.

Append at the end of the file:

```ts
describe("a suggestion's limits (decision 293)", () => {
  const wirecard = (): Record<string, unknown> => JSON.parse(valid).suggestions[0]
  const answer = (...suggestions: Record<string, unknown>[]) => JSON.stringify({ suggestions })
  const collect = () => {
    const notes: Repair[] = []
    const note: Note = (repair) => {
      notes.push(repair)
    }
    return { notes, note }
  }

  it('states every limit in the prompt', () => {
    const { system } = buildSuggestCasesRequest({ existingTitles: [], count: 4 })
    expect(system.replace(/\s+/g, ' ')).toContain(
      'Limits (the app checks them): title 3 to 200 characters; angle 10 to 2000 characters; ' +
        'demandNotes at most 2000 characters; at most 10 competitorLinks, each note at most 500 ' +
        'characters; priorityScore a whole number from 0 to 100; no more cases than asked for.',
    )
  })

  it('trims free text over its limit at a sentence, names the case, and leaves the facts alone', () => {
    const { notes, note } = collect()
    const long = {
      ...wirecard(),
      angle: 'The auditors signed off for a decade. '.repeat(60),
      demandNotes: 'Search interest held for years. '.repeat(70),
      competitorLinks: [
        { url: 'https://example.com/a', note: 'surface level' },
        { url: 'https://example.com/b', note: 'Covers the raid only. '.repeat(30) },
      ],
    }
    const [parsed] = parseSuggestedCases(answer(long), 8, note)
    expect(parsed!.angle.length).toBeLessThanOrEqual(CASE_ANGLE_MAX)
    expect(parsed!.angle.endsWith('The auditors signed off for a decade.')).toBe(true)
    expect(parsed!.demandNotes!.length).toBeLessThanOrEqual(CASE_DEMAND_NOTES_MAX)
    expect(parsed!.competitorLinks![1]!.note!.length).toBeLessThanOrEqual(CASE_LINK_NOTE_MAX)
    expect(parsed).toMatchObject({ title: 'Wirecard', category: 'con', priorityScore: 88 })
    expect(parsed!.competitorLinks!.map((link) => link.url)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ])
    expect(notes).toEqual([
      { action: 'trimmed', field: 'the angle of Wirecard' },
      { action: 'trimmed', field: 'the demand notes of Wirecard' },
      { action: 'trimmed', field: 'the note on link 2 of Wirecard' },
    ])
  })

  it('keeps the first 10 competitor links', () => {
    const { notes, note } = collect()
    const links = Array.from({ length: 12 }, (_, at) => ({ url: `https://example.com/${at + 1}` }))
    const [parsed] = parseSuggestedCases(answer({ ...wirecard(), competitorLinks: links }), 8, note)
    expect(parsed!.competitorLinks).toHaveLength(10)
    expect(parsed!.competitorLinks![9]!.url).toBe('https://example.com/10')
    expect(notes).toEqual([{ action: 'capped', field: 'competitor links of Wirecard', kept: 10 }])
  })

  it("rounds a fractional priority score and holds the scale's ends, with a note", () => {
    const { notes, note } = collect()
    const parsed = parseSuggestedCases(
      answer(
        { ...wirecard(), priorityScore: 9.5 },
        { ...wirecard(), title: 'Theranos', priorityScore: 1000 },
        { ...wirecard(), title: 'Enron', priorityScore: -3 },
      ),
      8,
      note,
    )
    expect(parsed.map((suggestion) => suggestion.priorityScore)).toEqual([10, 100, 0])
    expect(notes).toEqual([
      { action: 'rounded', field: 'the priority score of Wirecard', from: 9.5, to: 10 },
      { action: 'rounded', field: 'the priority score of Theranos', from: 1000, to: 100 },
      { action: 'rounded', field: 'the priority score of Enron', from: -3, to: 0 },
    ])
  })

  it('still refuses a priority score that is not a number', () => {
    expect(() => parseSuggestedCases(answer({ ...wirecard(), priorityScore: 'high' }))).toThrow(
      /priorityScore/,
    )
  })

  it('drops a suggestion whose title runs over 200 characters and keeps the rest', () => {
    const { notes, note } = collect()
    const title = `The ${'very '.repeat(50)}long case`
    const parsed = parseSuggestedCases(answer(wirecard(), { ...wirecard(), title }), 8, note)
    expect(parsed.map((suggestion) => suggestion.title)).toEqual(['Wirecard'])
    expect(notes).toEqual([
      {
        action: 'dropped',
        field: `suggestion 2 ("The${' very'.repeat(11)}...")`,
        reason: 'its title ran over 200 characters',
      },
    ])
  })

  it('keeps no more suggestions than were asked for', () => {
    const { notes, note } = collect()
    const parsed = parseSuggestedCases(
      answer(wirecard(), { ...wirecard(), title: 'Theranos' }, { ...wirecard(), title: 'Enron' }),
      2,
      note,
    )
    expect(parsed.map((suggestion) => suggestion.title)).toEqual(['Wirecard', 'Theranos'])
    expect(notes).toEqual([{ action: 'capped', field: 'suggestions', kept: 2 }])
  })

  it('refuses an answer left with no suggestion once the drops are made', () => {
    expect(() => parseSuggestedCases(answer({ ...wirecard(), title: 'x'.repeat(201) }))).toThrow(
      ValidationError,
    )
  })

  it('files each repair under its own case, the longer of two titles that end alike first', () => {
    const repairs: Repair[] = [
      { action: 'trimmed', field: 'the angle of Bank of Credit and Commerce International' },
      { action: 'trimmed', field: 'the angle of Credit and Commerce International' },
      { action: 'rounded', field: 'the priority score of Wirecard', from: 9.5, to: 10 },
      {
        action: 'dropped',
        field: 'suggestion 4 ("A title...")',
        reason: 'its title ran over 200 characters',
      },
      { action: 'capped', field: 'suggestions', kept: 3 },
    ]
    const filed = fileCaseRepairs(repairs, [
      'Credit and Commerce International',
      'Bank of Credit and Commerce International',
      'Wirecard',
    ])
    expect(filed.byTitle.get('Bank of Credit and Commerce International')).toEqual([repairs[0]])
    expect(filed.byTitle.get('Credit and Commerce International')).toEqual([repairs[1]])
    expect(filed.byTitle.get('Wirecard')).toEqual([repairs[2]])
    expect(filed.rest).toEqual([repairs[3], repairs[4]])
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/providers && pnpm exec vitest run src/prompts/cases.test.ts`
Expected: FAIL. The `CASE_*` constants and `fileCaseRepairs` are not exported, the prompt states no limits, and 9.5 and 1000 are refused instead of fitted.

- [ ] **Step 3: Add the constants to the schema**

Replace the contents of `packages/schemas/src/cases.ts` with:

```ts
import { z } from 'zod'

/**
 * Provider IO for the Case Library's `Suggest cases` button (spec section
 * 11.3), and the shape the triage table renders.
 *
 * Two rules are enforced here rather than trusted to the prompt, because a
 * model that has been told twice still gets it wrong occasionally and a draft
 * row is about to be shown to a human as a real proposal:
 *
 *  - `category` must be one of the five the data model knows. An invented
 *    sixth category cannot be inserted, so it fails here, loudly, instead of
 *    at the database.
 *  - `priorityScore` is a whole number from 0 to 100. A model asked for a
 *    score will occasionally answer 9.5 or 1000; the parser rounds and clamps
 *    those before this schema sees them, with a notice (decision 293), and a
 *    score of "high" still fails here.
 */

export const CASE_CATEGORIES = ['collapse', 'con', 'meltdown', 'turnaround', 'empire'] as const
export const CaseCategorySchema = z.enum(CASE_CATEGORIES)
export type CaseCategoryName = z.infer<typeof CaseCategorySchema>

/**
 * A suggestion's limits (decision 293): one source for the schema, the
 * prompt that states them and the repair that fits an answer to them.
 */
export const CASE_TITLE_MIN = 3
export const CASE_TITLE_MAX = 200
export const CASE_ANGLE_MIN = 10
export const CASE_ANGLE_MAX = 2000
export const CASE_DEMAND_NOTES_MAX = 2000
export const CASE_LINKS_MAX = 10
export const CASE_LINK_NOTE_MAX = 500
export const CASE_PRIORITY_MIN = 0
export const CASE_PRIORITY_MAX = 100
export const CASE_SUGGESTIONS_MAX = 20

export const CaseSuggestionSchema = z.object({
  title: z.string().min(CASE_TITLE_MIN).max(CASE_TITLE_MAX),
  category: CaseCategorySchema,
  /** The angle that makes this worth 15 minutes rather than a headline. */
  angle: z.string().min(CASE_ANGLE_MIN).max(CASE_ANGLE_MAX),
  /** Why an audience is already looking for this: the demand evidence. */
  demandNotes: z.string().max(CASE_DEMAND_NOTES_MAX).optional(),
  /** Existing videos on the subject, so the angle can be differentiated. */
  competitorLinks: z
    .array(
      z.object({ url: z.string().url(), note: z.string().max(CASE_LINK_NOTE_MAX).optional() }),
    )
    .max(CASE_LINKS_MAX)
    .optional(),
  priorityScore: z.number().int().min(CASE_PRIORITY_MIN).max(CASE_PRIORITY_MAX),
})
export type CaseSuggestion = z.infer<typeof CaseSuggestionSchema>

export const CaseSuggestionsSchema = z.object({
  suggestions: z.array(CaseSuggestionSchema).min(1).max(CASE_SUGGESTIONS_MAX),
})
export type CaseSuggestions = z.infer<typeof CaseSuggestionsSchema>
```

The values are the ones the schema held; only their names are new.

- [ ] **Step 4: State the limits in the prompt and repair before validating**

In `packages/providers/src/prompts/cases.ts`, replace the imports (lines 1 to 5) with:

```ts
import {
  CASE_ANGLE_MAX,
  CASE_ANGLE_MIN,
  CASE_DEMAND_NOTES_MAX,
  CASE_LINK_NOTE_MAX,
  CASE_LINKS_MAX,
  CASE_PRIORITY_MAX,
  CASE_PRIORITY_MIN,
  CASE_SUGGESTIONS_MAX,
  CASE_TITLE_MAX,
  CASE_TITLE_MIN,
  CaseSuggestionsSchema,
  ValidationError,
} from '@boom-busters/schemas'
import type { CaseSuggestion } from '@boom-busters/schemas'
import { z } from 'zod'
import { formatIssues, parseJsonCompletion } from './json'
import { capList, dropItems, ignoreRepairs, overLimit, trimField, trimText } from './repair'
import type { Note, Repair } from './repair'
import { outputBudget } from '../llm/types'
import type { LLMTaskRequest } from '../llm/types'
```

In `SYSTEM`, after the rule line `  weighing documentation quality, story shape and evident audience demand.` (line 38) and before the blank line that precedes `Answer with JSON only, no prose around it:`, insert:

```

Limits (the app checks them): title ${CASE_TITLE_MIN} to ${CASE_TITLE_MAX} characters; angle
${CASE_ANGLE_MIN} to ${CASE_ANGLE_MAX} characters; demandNotes at most ${CASE_DEMAND_NOTES_MAX} characters;
at most ${CASE_LINKS_MAX} competitorLinks, each note at most ${CASE_LINK_NOTE_MAX} characters;
priorityScore a whole number from ${CASE_PRIORITY_MIN} to ${CASE_PRIORITY_MAX}; no more cases than asked for.
```

`SYSTEM` is already a template literal, so the constants interpolate as they stand.

Replace `parseSuggestedCases` (lines 65 to 67) with:

```ts
const Envelope = z.looseObject({})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * How a repair names the suggestion it changed (decision 293): "the angle of
 * Wirecard". The Case Library files each repair on its case's row by this
 * ending (`fileCaseRepairs`).
 */
const ofCase = (what: string, title: unknown): string => `${what} of ${String(title)}`

/** A title over its limit is not trimmed: it is the case's name and the dedupe key. */
function titleOverLimit(item: unknown): string | null {
  return isRecord(item) && typeof item['title'] === 'string' && item['title'].length > CASE_TITLE_MAX
    ? overLimit('its title', CASE_TITLE_MAX)
    : null
}

/** A dropped suggestion has no row, so the toast names it by its place and opening words. */
function droppedLabel(item: unknown, index: number): string {
  const title = isRecord(item) && typeof item['title'] === 'string' ? item['title'] : ''
  return `suggestion ${index + 1} ("${trimText(title, 60)}...")`
}

/**
 * The model's own rating, not a fact from the world (spec 2.2): a fraction
 * is rounded and the scale's ends hold. Anything but a number is left for
 * the schema to refuse.
 */
function fitPriority(value: unknown, title: unknown, note: Note): unknown {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value
  const fitted = Math.min(CASE_PRIORITY_MAX, Math.max(CASE_PRIORITY_MIN, Math.round(value)))
  if (fitted !== value) {
    note({ action: 'rounded', field: ofCase('the priority score', title), from: value, to: fitted })
  }
  return fitted
}

/** One suggestion's free text trimmed, its links capped and its score fitted; facts untouched. */
function repairSuggestion(item: unknown, note: Note): unknown {
  if (!isRecord(item)) return item
  const title = item['title']
  const links = capList(
    item['competitorLinks'],
    CASE_LINKS_MAX,
    ofCase('competitor links', title),
    note,
  )
  return {
    ...item,
    angle: trimField(item['angle'], CASE_ANGLE_MAX, ofCase('the angle', title), note),
    demandNotes: trimField(
      item['demandNotes'],
      CASE_DEMAND_NOTES_MAX,
      ofCase('the demand notes', title),
      note,
    ),
    competitorLinks: Array.isArray(links)
      ? links.map((link, index) =>
          isRecord(link)
            ? {
                ...link,
                note: trimField(
                  link['note'],
                  CASE_LINK_NOTE_MAX,
                  ofCase(`the note on link ${index + 1}`, title),
                  note,
                ),
              }
            : link,
        )
      : links,
    priorityScore: fitPriority(item['priorityScore'], title, note),
  }
}

/**
 * The suggestions as the model answered them, repaired before they are
 * validated (decision 293): a suggestion whose title runs over its limit is
 * dropped and the rest kept; no more than `count` are kept; the free text is
 * trimmed at a sentence, the links capped and the priority score fitted to
 * the scale. Titles, categories and link addresses are facts, left alone.
 */
export function parseSuggestedCases(
  text: string,
  count: number = CASE_SUGGESTIONS_MAX,
  note: Note = ignoreRepairs,
): CaseSuggestion[] {
  const raw = parseJsonCompletion(text, Envelope, 'case suggestions')
  const kept = dropItems(raw['suggestions'], titleOverLimit, droppedLabel, note)
  const capped = capList(kept, count, 'suggestions', note)
  const parsed = CaseSuggestionsSchema.safeParse({
    ...raw,
    suggestions: Array.isArray(capped) ? capped.map((item) => repairSuggestion(item, note)) : capped,
  })
  if (!parsed.success) {
    throw new ValidationError(`The case suggestions are malformed: ${formatIssues(parsed.error)}`, {
      field: 'case suggestions',
    })
  }
  return parsed.data.suggestions
}

/**
 * One answer's repairs split by the case each concerns (decision 293), so
 * the Case Library can file each on its case's row. A repair to a suggestion
 * ends "of <its title>", and the longest title that fits wins: "the angle of
 * Bank of Credit and Commerce International" is never filed under a case
 * called "Credit and Commerce International". What fits no title (a dropped
 * suggestion, the cut to the number asked for) is left in `rest`, for the toast.
 */
export function fileCaseRepairs(
  repairs: readonly Repair[],
  titles: readonly string[],
): { byTitle: Map<string, Repair[]>; rest: Repair[] } {
  const longestFirst = [...new Set(titles)].sort((a, b) => b.length - a.length)
  const byTitle = new Map<string, Repair[]>()
  const rest: Repair[] = []
  for (const repair of repairs) {
    const title = longestFirst.find((candidate) => repair.field.endsWith(` of ${candidate}`))
    if (title === undefined) rest.push(repair)
    else byTitle.set(title, [...(byTitle.get(title) ?? []), repair])
  }
  return { byTitle, rest }
}
```

The order matters and is what the tests pin: drops first (so a dropped item does not count against `count`, and labels count the list as the model wrote it), then the cap, then each kept suggestion's own repairs.

- [ ] **Step 5: Run the provider and schema tests**

Run: `cd packages/providers && pnpm exec vitest run src/prompts/cases.test.ts`
Expected: PASS (25 tests: the 18 there were, less the 2 deleted, plus the 9 new).

Run: `cd packages/schemas && pnpm test`
Expected: PASS.

- [ ] **Step 6: Write the failing action and component tests**

Create `apps/web/app/(console)/cases/actions.test.ts` (no database; every seam is mocked):

```ts
// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { suggestCases } from './actions'

/**
 * `Suggest cases` on the answer helper (decision 293), with the database,
 * the session and the model call replaced: at most two calls, each created
 * case's repairs filed on its own row, and what no row can show (a dropped
 * suggestion, the cut to the number asked for) in the toast line.
 */

const store = vi.hoisted(() => ({
  existingCaseTitles: vi.fn(),
  createSuggestedCases: vi.fn(),
}))
vi.mock('@boom-busters/db', () => store)
vi.mock('@/lib/db', () => ({ db: { marker: 'db' } }))
vi.mock('@/auth', () => ({ auth: async () => ({ user: { email: 'owner@example.com' } }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/inngest/client', () => ({ inngest: { send: vi.fn() } }))
const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))
const recordRepairs = vi.hoisted(() => vi.fn())
vi.mock('@/lib/notices', () => ({ recordRepairs }))

const wirecard = {
  title: 'Wirecard',
  category: 'con',
  angle: 'The auditor sign-offs are the story, not the missing billion.',
  demandNotes: 'Sustained search interest since the 2020 collapse.',
  competitorLinks: [{ url: 'https://example.com/video', note: 'surface level' }],
  priorityScore: 88,
}

const reply = (...suggestions: Record<string, unknown>[]) => ({
  text: JSON.stringify({ suggestions }),
})

/** What `createSuggestedCases` hands back: one row per title, ids in order. */
const rows = (...titles: string[]) => ({
  created: titles.map((title, at) => ({ id: `01J00000000000000000000C0${at + 1}`, title })),
  skippedTitles: [],
})

describe('suggestCases on the answer helper (decision 293)', () => {
  beforeEach(() => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockReset()
    recordRepairs.mockReset()
    store.existingCaseTitles.mockReset().mockResolvedValue([])
    store.createSuggestedCases.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('asks once more with the reason after a refusal, labelled in the ledger', async () => {
    callLlm.mockResolvedValueOnce({ text: 'no json here' }).mockResolvedValueOnce(reply(wirecard))
    store.createSuggestedCases.mockResolvedValue(rows('Wirecard'))

    expect(await suggestCases({ count: 3 })).toEqual({
      ok: true,
      created: 1,
      skipped: 0,
      mocked: false,
    })
    expect(callLlm).toHaveBeenCalledTimes(2)
    expect(callLlm.mock.calls[0]![1]).toEqual({})
    expect(callLlm.mock.calls[1]![1]).toEqual({ purpose: 'retry: refused' })
    expect(callLlm.mock.calls[1]![0].messages.at(-1).content).toMatch(
      /^Your previous answer was refused: The model returned no JSON for case suggestions/,
    )
    expect(recordRepairs).not.toHaveBeenCalled()
  })

  it('creates nothing after two refusals, and says why', async () => {
    callLlm.mockResolvedValue({ text: 'no json here' })

    const result = await suggestCases({ count: 3 })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/^The model returned no JSON for case suggestions/)
    expect(callLlm).toHaveBeenCalledTimes(2)
    expect(store.createSuggestedCases).not.toHaveBeenCalled()
  })

  it("files each created case's repairs on its own row", async () => {
    callLlm.mockResolvedValueOnce(
      reply(
        { ...wirecard, angle: 'The auditors signed off for a decade. '.repeat(60) },
        { ...wirecard, title: 'Theranos', priorityScore: 104.6 },
        { ...wirecard, title: 'Enron' },
      ),
    )
    store.createSuggestedCases.mockResolvedValue(rows('Wirecard', 'Theranos', 'Enron'))

    expect(await suggestCases({ count: 3 })).toEqual({
      ok: true,
      created: 3,
      skipped: 0,
      mocked: false,
    })
    const inputs = store.createSuggestedCases.mock.calls[0]![1] as { priorityScore: number }[]
    expect(inputs.map((input) => input.priorityScore)).toEqual([88, 100, 88])
    expect(recordRepairs.mock.calls).toEqual([
      [
        { projectId: null, subject: 'case', subjectId: '01J00000000000000000000C01' },
        [{ action: 'trimmed', field: 'the angle of Wirecard' }],
      ],
      [
        { projectId: null, subject: 'case', subjectId: '01J00000000000000000000C02' },
        [{ action: 'rounded', field: 'the priority score of Theranos', from: 104.6, to: 100 }],
      ],
    ])
  })

  it('names a dropped suggestion and the cut to the number asked for in the toast line', async () => {
    const title = `The ${'very '.repeat(50)}long case`
    callLlm.mockResolvedValueOnce(
      reply(
        wirecard,
        { ...wirecard, title },
        { ...wirecard, title: 'Theranos' },
        { ...wirecard, title: 'Enron' },
      ),
    )
    store.createSuggestedCases.mockResolvedValue(rows('Wirecard', 'Theranos'))

    const result = await suggestCases({ count: 2 })
    expect(result).toMatchObject({ ok: true, created: 2 })
    expect(result.notice).toBe(
      `Dropped suggestion 2 ("The${' very'.repeat(11)}..."): its title ran over 200 characters. ` +
        'Kept the first 2 suggestions.',
    )
    const inputs = store.createSuggestedCases.mock.calls[0]![1] as { title: string }[]
    expect(inputs.map((input) => input.title)).toEqual(['Wirecard', 'Theranos'])
    expect(recordRepairs).not.toHaveBeenCalled()
  })
})
```

Create `apps/web/app/(console)/cases/case-library.test.tsx`:

```tsx
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CaseSummary } from '@boom-busters/db'
import type { Notice } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CaseLibrary } from './case-library'

/**
 * The Case Library's notices (decision 293): a suggestion's repairs on its
 * own row, and a dropped suggestion, which has no row, in the toast.
 */

const actions = vi.hoisted(() => ({
  acceptCase: vi.fn(),
  addCase: vi.fn(),
  dismissCase: vi.fn(),
  setStatus: vi.fn(),
  startProjectFromCase: vi.fn(),
  suggestCases: vi.fn(),
}))
vi.mock('./actions', () => actions)
// The notice's Dismiss is a server action whose module loads next-auth,
// which cannot load under jsdom.
vi.mock('@/app/(console)/notice-actions', () => ({ dismissNoticeAction: vi.fn() }))
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))
const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

const WIRECARD = '01J0000000000000000000000A'
const THERANOS = '01J0000000000000000000000B'

function kase(overrides: Partial<CaseSummary>): CaseSummary {
  return {
    id: WIRECARD,
    title: 'Wirecard',
    category: 'con',
    angle: 'The auditor sign-offs are the story, not the missing billion.',
    demandNotes: null,
    competitorLinks: [],
    priorityScore: 88,
    status: 'idea',
    projectCount: 0,
    createdAt: new Date('2026-10-09T10:00:00Z'),
    updatedAt: new Date('2026-10-09T10:00:00Z'),
    ...overrides,
  }
}

const trimmed: Notice = {
  id: '01J0000000000000000000000N',
  projectId: null,
  subject: 'case',
  subjectId: WIRECARD,
  kind: 'trimmed',
  message: 'Trimmed to fit: the angle of Wirecard.',
  createdAt: new Date('2026-10-09T10:00:00Z'),
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CaseLibrary notices (decision 293)', () => {
  it("shows a case's notice on its own row and no other", () => {
    render(
      <CaseLibrary
        cases={[kase({}), kase({ id: THERANOS, title: 'Theranos', status: 'shortlisted' })]}
        sort="priority"
        notices={[trimmed]}
      />,
    )
    const wirecard = screen.getByText('Wirecard').closest('li')!
    expect(within(wirecard).getByRole('status')).toHaveTextContent(
      'Trimmed to fit: the angle of Wirecard.',
    )
    expect(within(wirecard).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
    const theranos = screen.getByText('Theranos').closest('li')!
    expect(within(theranos).queryByRole('status')).not.toBeInTheDocument()
  })

  it('names a dropped suggestion in the success toast', async () => {
    const dropped =
      'Dropped suggestion 3 ("The very long case..."): its title ran over 200 characters.'
    actions.suggestCases.mockResolvedValue({
      ok: true,
      created: 2,
      skipped: 0,
      mocked: false,
      notice: dropped,
    })
    render(<CaseLibrary cases={[]} sort="priority" />)

    await userEvent.click(screen.getByRole('button', { name: 'Suggest cases' }))
    await userEvent.click(screen.getByRole('button', { name: 'Get suggestions' }))

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title: '2 new, 0 already in your library',
        description: dropped,
      }),
    )
  })
})
```

- [ ] **Step 7: Run them to see them fail**

Run: `cd apps/web && pnpm exec vitest run "app/(console)/cases"`
Expected: FAIL. The action still calls `callLlm` once with no retry and writes no notices, the row renders no notice, and the toast has no description.

- [ ] **Step 8: Put `suggestCases` on the helper**

In `apps/web/app/(console)/cases/actions.ts`, replace the imports from `@boom-busters/providers` and `@boom-busters/schemas` (lines 16 to 22) with:

```ts
import {
  buildSuggestCasesRequest,
  describeRepairs,
  fileCaseRepairs,
  mockSuggestedCases,
  parseSuggestedCases,
  mockProvidersEnabled,
} from '@boom-busters/providers'
import { CaseCategorySchema, UlidSchema, serialiseError } from '@boom-busters/schemas'
import type { CaseSuggestion } from '@boom-busters/schemas'
```

and after `import { events } from '@/inngest/events'` (line 28) replace `import { callLlm } from '@/lib/llm'` (line 29) with:

```ts
import { callForAnswer } from '@/lib/answer'
import type { Answer, AnswerComplete } from '@/lib/answer'
import { callLlm } from '@/lib/llm'
import { recordRepairs } from '@/lib/notices'
```

Replace `SuggestResult` (lines 139 to 144) with:

```ts
export interface SuggestResult extends ActionResult {
  created?: number
  skipped?: number
  /** True when the rows came from the mock adapter and researched nothing. */
  mocked?: boolean
  /**
   * What the answer lost that no row can show (decision 293): a suggestion
   * dropped for breaking a rule, or the cut to the number asked for. The
   * toast carries it.
   */
  notice?: string
}
```

After `SuggestInputSchema` (it ends at line 149), add:

```ts
/**
 * `callForAnswer`'s call for the Case Library (decision 293): the ledgered
 * `callLlm` with no project to attribute the spend to, as before, and the
 * retry labelled in the ledger as `completeForProject` labels it.
 */
const completeForLibrary: AnswerComplete = (request, call) =>
  callLlm(request, call === 'answer' ? {} : { purpose: call })
```

It is not exported: a `'use server'` module exports only async functions.

Replace the body of `suggestCases`, from `export async function suggestCases(input: unknown): Promise<SuggestResult> {` (line 158) to its closing `}` (line 203), leaving the doc comment above it as it is, with:

```ts
export async function suggestCases(input: unknown): Promise<SuggestResult> {
  await requireOwner()

  const parsed = SuggestInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Ask for between 1 and 20 cases' }
  const { count } = parsed.data

  const mocked = mockProvidersEnabled()

  try {
    // At most two calls, the second told what was wrong (decision 293).
    const answer: Answer<CaseSuggestion[]> = mocked
      ? { ok: true, value: mockSuggestedCases(count), calls: 1 }
      : await callForAnswer({
          request: buildSuggestCasesRequest({
            existingTitles: await existingCaseTitles(db),
            count,
            ...(parsed.data.steer ? { steer: parsed.data.steer } : {}),
          }),
          parse: (text, note) => parseSuggestedCases(text, count, note),
          complete: completeForLibrary,
        })
    if (!answer.ok) return { ok: false, error: answer.issue }
    const suggestions = answer.value

    const { created, skippedTitles } = await createSuggestedCases(
      db,
      suggestions.map((suggestion) => ({
        title: suggestion.title,
        category: suggestion.category as CaseCategory,
        angle: suggestion.angle,
        demandNotes: suggestion.demandNotes ?? null,
        competitorLinks: suggestion.competitorLinks ?? [],
        priorityScore: suggestion.priorityScore,
        status: 'idea' as const,
      })),
    )

    // Each created case carries its own repairs on its row. A new row has no
    // older notes to retire, so a clean one writes nothing, and a skipped
    // duplicate's repairs concern a row this answer did not touch.
    const filed = fileCaseRepairs(
      answer.repairs ?? [],
      suggestions.map((suggestion) => suggestion.title),
    )
    for (const row of created) {
      const repairs = filed.byTitle.get(row.title) ?? []
      if (repairs.length > 0) {
        await recordRepairs({ projectId: null, subject: 'case', subjectId: row.id }, repairs)
      }
    }
    // What no row can carry goes in the toast.
    const notice = describeRepairs(filed.rest)

    revalidatePath('/cases')
    return {
      ok: true,
      created: created.length,
      skipped: skippedTitles.length,
      mocked,
      ...(notice === null ? {} : { notice }),
    }
  } catch (error) {
    console.error('[cases] suggestion failed', serialiseError(error))
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The suggestion run failed',
    }
  }
}
```

A budget stop and a provider error still land in the `catch` and the error toast, as today; a call-side refusal reaches it wrapped by the helper, with the same message.

- [ ] **Step 9: Load the cases' notices and render them on the rows**

In `apps/web/app/(console)/cases/page.tsx`, replace `import { listCases } from '@boom-busters/db'` (line 1) with `import { listCaseNotices, listCases } from '@boom-busters/db'`, and replace `  return <CaseLibrary cases={await listCases(db, { sort: active })} sort={active} />` (line 31) with:

```tsx
  const cases = await listCases(db, { sort: active })
  // Each case's notices (decision 293): what a suggestion's repair trimmed, on its row.
  const notices = await listCaseNotices(
    db,
    cases.map((item) => item.id),
  )

  return <CaseLibrary cases={cases} sort={active} notices={notices} />
```

In `apps/web/app/(console)/cases/case-library.tsx`:

After `import type { CaseSort, CaseSummary } from '@boom-busters/db'` (line 3) add:

```tsx
import { noticesFor } from '@boom-busters/schemas'
import type { Notice } from '@boom-busters/schemas'
```

and after `import { ConfirmButton } from '@/components/confirm-button'` (line 7) add `import { Notices } from '@/components/notices'`.

Replace `export function CaseLibrary({ cases, sort }: { cases: CaseSummary[]; sort: CaseSort }) {` (line 47) with:

```tsx
export function CaseLibrary({
  cases,
  sort,
  notices = [],
}: {
  cases: CaseSummary[]
  sort: CaseSort
  /** The cases' open notices (decision 293); each row shows its own. */
  notices?: readonly Notice[]
}) {
```

Replace `<SuggestionRow item={item} run={run} />` (line 89) with `<SuggestionRow item={item} run={run} notices={noticesFor(notices, 'case', item.id)} />`, and `<BacklogRow item={item} run={run} />` (line 116) with `<BacklogRow item={item} run={run} notices={noticesFor(notices, 'case', item.id)} />`.

Replace `function SuggestionRow({ item, run }: { item: CaseSummary; run: Run }) {` (line 167) with:

```tsx
function SuggestionRow({
  item,
  run,
  notices,
}: {
  item: CaseSummary
  run: Run
  notices: readonly Notice[]
}) {
```

and in its JSX, after the `<div className="flex items-center gap-2">` that holds Accept and Dismiss closes (line 204), add `<RowNotices notices={notices} />` as the row's last child.

Replace `function BacklogRow({ item, run }: { item: CaseSummary; run: Run }) {` (line 209) with:

```tsx
function BacklogRow({
  item,
  run,
  notices,
}: {
  item: CaseSummary
  run: Run
  notices: readonly Notice[]
}) {
```

and in its JSX, after the `<div className="flex flex-wrap items-center gap-2">` that holds the status select, New project and Remove closes (line 265), add `<RowNotices notices={notices} />` as the row's last child.

After `BacklogRow` ends (line 268), add:

```tsx
/** A case's notices (decision 293), full width under the row's facts and buttons. */
function RowNotices({ notices }: { notices: readonly Notice[] }) {
  if (notices.length === 0) return null
  return (
    <div className="w-full">
      <Notices notices={notices} />
    </div>
  )
}
```

In `SuggestButton`'s success branch, the `toast({ title: result.mocked ? ... })` call (lines 325 to 329): after the line ``                : `${result.created} new, ${result.skipped} already in your library`,`` (line 328) add:

```tsx
              // A dropped suggestion has no row to carry its notice (decision 293).
              ...(result.notice ? { description: result.notice } : {}),
```

- [ ] **Step 10: Run the web tests**

Run: `cd apps/web && pnpm exec vitest run "app/(console)/cases"`
Expected: PASS (6 tests: 4 in `actions.test.ts`, 2 in `case-library.test.tsx`).

- [ ] **Step 11: Run every consumer's suite and the typecheck**

Run (each with the Bash tool's `timeout: 600000`): `cd packages/providers && pnpm test`, then `cd packages/schemas && pnpm test`, then `pnpm typecheck` from the root.
Expected: PASS; typecheck clean. Nothing else in the repo calls `parseSuggestedCases`, and its `count` parameter has a default, so the existing provider tests call it unchanged.

- [ ] **Step 12: Format, lint and commit**

Run from the root: `pnpm exec prettier --write` then `pnpm exec prettier --check` on the eight files below, then `pnpm exec eslint --max-warnings 0` on them.

```bash
git add packages/schemas/src/cases.ts packages/providers/src/prompts/cases.ts packages/providers/src/prompts/cases.test.ts "apps/web/app/(console)/cases/actions.ts" "apps/web/app/(console)/cases/actions.test.ts" "apps/web/app/(console)/cases/page.tsx" "apps/web/app/(console)/cases/case-library.tsx" "apps/web/app/(console)/cases/case-library.test.tsx"
git commit -F <message file>
```

Message: `feat(cases): suggestions state their limits, keep what fits, and file each trim on its case's row (decision 293)` plus the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---


---

### Task 9: The teaser

**Files:**
- Modify: `packages/schemas/src/script.ts` (new constants after the section header at line 137; `TeaserParagraphSchema` line 141; `TeaserScriptSchema` lines 157 and 158)
- Modify: `packages/providers/src/prompts/script.ts` (imports lines 1 to 15; the teaser system prompt before `Return exactly:` at line 445; `parseTeaser` lines 465 to 467)
- Test: `packages/providers/src/prompts/script.test.ts` (imports lines 1 to 21; append a block at the end)
- Modify: `apps/web/inngest/lib/teaser-build.ts` (imports lines 1 to 21; `writeTeaserScript` lines 36 to 74)
- Create: `apps/web/inngest/lib/teaser-build.test.ts` (database)
- Modify: `apps/web/inngest/functions/shorts-runner.ts` (the `write-teaser` comment, lines 223 to 226)
- Test: `apps/web/inngest/functions/shorts-runner.test.ts` (database; imports lines 3 to 23; a mock after line 50; `beforeEach` lines 104 to 153; two tests before the `describeDb` block closes at line 378)
- Modify: `apps/web/inngest/functions/teaser-rebuild-runner.ts` (`load-script`, line 95)
- Test: `apps/web/inngest/functions/teaser-rebuild-runner.test.ts` (database; imports lines 3 to 27; a mock after line 46; `beforeEach` lines 131 to 156; two tests before the `describeDb` block closes)
- Modify: `apps/web/app/(console)/projects/[id]/shorts-screen.tsx` (imports lines 3 to 18; `ShortsScreen` lines 34 to 63; `ShortCard` lines 170 to 180 and before line 245)
- Test: `apps/web/app/(console)/projects/[id]/shorts-screen.test.tsx` (imports lines 1 to 5; a mock after line 59; two tests before the final `})`)
- Modify: `apps/web/app/(console)/projects/[id]/page.tsx` (the `<ShortsScreen` props, around line 488 before Task 3's edits)

**Interfaces:**
- Consumes: `Note`, `ignoreRepairs`, `trimField`, `capList` (Task 1); `callForAnswer` (Task 1); `completeForProject` (stage 1, `@/lib/answer-call`); `recordRepairs`, `recordStop` (Task 3); `Notices` (Task 3); `noticesFor`, `Notice`, `NoticeTarget` (Task 1); `listProjectNotices`, `addNotice`, `notices` (Task 2, tests); `notices` held by `page.tsx` (Task 3).
- Produces:
  - `@boom-busters/schemas`: `TEASER_TITLE_MIN = 3`, `TEASER_TITLE_MAX = 90`, `TEASER_PARAGRAPH_MIN = 10`, `TEASER_PARAGRAPH_MAX = 400`, `TEASER_PARAGRAPHS_MIN = 2`, `TEASER_PARAGRAPHS_MAX = 5`.
  - `@boom-busters/providers`: `parseTeaser(text: string, chapterCount: number, note?: Note): TeaserScript`; labels `the title`, `beat <n>`, `beats` (capped). A beat whose `chapterIndex` is not below `chapterCount` throws `ValidationError('beat <n> draws from chapter <i>, but the chapters run 0 to <count - 1>')`.
  - `writeTeaserScript(projectId: string, stopped?: string | null): Promise<TeaserWriteResult>` (return type unchanged). It records the `teaser` notices itself, inside the caller's step; a stop returns `{ ok: false, skipped: 'the teaser script failed: <issue>' }` after `recordStop(..., 'skipped', '<stopped>: <issue>')`, with `stopped` defaulting to `'The teaser was skipped'`. `null` means the caller reports the stop itself: the teaser rebuild, whose `fail('script-skipped', ...)` already records it on the Teaser card since Task 4, so recording here too would put two lines on the card for one stop. Only `BudgetExceededError` becomes a gate; anything else the call throws is rethrown.
  - `ShortsScreen` takes `teaserNotices?: readonly Notice[]`.

- [ ] **Step 1: Write the failing provider tests**

In `packages/providers/src/prompts/script.test.ts`, replace the first line with:

```ts
import {
  OutlineSchema,
  TEASER_PARAGRAPH_MAX,
  TEASER_TITLE_MAX,
  ValidationError,
} from '@boom-busters/schemas'
```

add `buildTeaserRequest,` and `parseTeaser,` to the import list from `'./script'` (lines 3 to 20), and after `import type { ScriptClaim } from './script'` (line 21) add `import type { Note, Repair } from './repair'`.

Append at the end of the file:

```ts
describe('the teaser (decision 293)', () => {
  const chapters = [
    { index: 0, title: 'The audit', contentMd: 'By June, the auditors could not find the money.' },
    { index: 1, title: 'The collapse', contentMd: 'The shares collapsed in nine days.' },
  ]
  const first = { text: 'One number was missing, and it was billions.', chapterIndex: 0 }
  const second = { text: 'The auditors finally refused to sign anything at all.', chapterIndex: 1 }
  const teaser = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({ title: 'The audit that said no', paragraphs: [first, second], ...overrides })
  const collect = () => {
    const notes: Repair[] = []
    const note: Note = (repair) => {
      notes.push(repair)
    }
    return { notes, note }
  }

  it('states every limit in the prompt', () => {
    const { system } = buildTeaserRequest({ caseTitle: 'Wirecard', chapters })
    expect(system.replace(/\s+/g, ' ')).toContain(
      'Limits (the app checks them): title 3 to 90 characters; 2 to 5 paragraphs, each 10 to ' +
        '400 characters; chapterIndex is the number of a chapter below, 0 to 1.',
    )
  })

  it('reads a clean teaser as written, noting nothing', () => {
    const { notes, note } = collect()
    expect(parseTeaser(teaser(), 2, note)).toEqual({
      title: 'The audit that said no',
      paragraphs: [first, second],
    })
    expect(notes).toEqual([])
  })

  it('trims the title at a word and a long beat at a sentence, keeping its chapter', () => {
    const { notes, note } = collect()
    const title = 'The auditors could not find the money '.repeat(3)
    const long = { text: 'One number was missing, and it was billions. '.repeat(10), chapterIndex: 1 }
    const parsed = parseTeaser(teaser({ title, paragraphs: [long, second] }), 2, note)
    expect(parsed.title.length).toBeLessThanOrEqual(TEASER_TITLE_MAX)
    expect(title.startsWith(parsed.title)).toBe(true)
    expect(title[parsed.title.length]).toBe(' ')
    expect(parsed.paragraphs[0]!.text.length).toBeLessThanOrEqual(TEASER_PARAGRAPH_MAX)
    expect(parsed.paragraphs[0]!.text.endsWith('it was billions.')).toBe(true)
    expect(parsed.paragraphs.map((paragraph) => paragraph.chapterIndex)).toEqual([1, 1])
    expect(notes).toEqual([
      { action: 'trimmed', field: 'the title' },
      { action: 'trimmed', field: 'beat 1' },
    ])
  })

  it('keeps the first five beats', () => {
    const { notes, note } = collect()
    const six = Array.from({ length: 6 }, (_, at) => ({
      text: `Beat number ${at + 1} of the story.`,
      chapterIndex: 0,
    }))
    const parsed = parseTeaser(teaser({ paragraphs: six }), 2, note)
    expect(parsed.paragraphs).toHaveLength(5)
    expect(parsed.paragraphs[4]!.text).toBe('Beat number 5 of the story.')
    expect(notes).toEqual([{ action: 'capped', field: 'beats', kept: 5 }])
  })

  it('refuses a beat drawn from a chapter the film does not have, naming the range', () => {
    expect(() =>
      parseTeaser(teaser({ paragraphs: [first, { ...second, chapterIndex: 2 }] }), 2),
    ).toThrow('beat 2 draws from chapter 2, but the chapters run 0 to 1')
  })

  it('still refuses a teaser of one beat', () => {
    expect(() => parseTeaser(teaser({ paragraphs: [first] }), 2)).toThrow(ValidationError)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/providers && pnpm exec vitest run src/prompts/script.test.ts`
Expected: FAIL. The `TEASER_*` constants are not exported, the prompt states no limits, `parseTeaser` ignores the chapter count and refuses the long title and beat instead of trimming them.

- [ ] **Step 3: Add the constants to the schema**

In `packages/schemas/src/script.ts`, after the section header that ends `// The teaser script (decision 225)` and its closing rule line (line 137), add:

```ts

/**
 * The teaser's limits (decision 293): one source for the schema, the prompt
 * that states them and the repair that fits an answer to them.
 */
export const TEASER_TITLE_MIN = 3
export const TEASER_TITLE_MAX = 90
export const TEASER_PARAGRAPH_MIN = 10
export const TEASER_PARAGRAPH_MAX = 400
export const TEASER_PARAGRAPHS_MIN = 2
export const TEASER_PARAGRAPHS_MAX = 5
```

In `TeaserParagraphSchema` replace `  text: z.string().trim().min(10).max(400),` (line 141) with `  text: z.string().trim().min(TEASER_PARAGRAPH_MIN).max(TEASER_PARAGRAPH_MAX),`. In `TeaserScriptSchema` replace `  title: z.string().trim().min(3).max(90),` (line 157) with `  title: z.string().trim().min(TEASER_TITLE_MIN).max(TEASER_TITLE_MAX),` and `  paragraphs: z.array(TeaserParagraphSchema).min(2).max(5),` (line 158) with:

```ts
  paragraphs: z
    .array(TeaserParagraphSchema)
    .min(TEASER_PARAGRAPHS_MIN)
    .max(TEASER_PARAGRAPHS_MAX),
```

The values are unchanged, so the teaser studio's edits and `TeaserScriptRecordSchema` validate as before.

- [ ] **Step 4: State the limits in the prompt and repair before validating**

In `packages/providers/src/prompts/script.ts`, replace the imports (lines 1 to 15) with:

```ts
import {
  OutlineSchema,
  SelfCheckSchema,
  ShortsCandidatesSchema,
  TEASER_PARAGRAPH_MAX,
  TEASER_PARAGRAPH_MIN,
  TEASER_PARAGRAPHS_MAX,
  TEASER_PARAGRAPHS_MIN,
  TEASER_TITLE_MAX,
  TEASER_TITLE_MIN,
  TeaserScriptSchema,
  ValidationError,
  claimCarriesArticle,
  claimCarriesPost,
  countWords,
  splitSentences,
} from '@boom-busters/schemas'
import type { Outline, SelfCheck, ShortsCandidate, TeaserScript } from '@boom-busters/schemas'
import { z } from 'zod'
import { formatIssues, parseJsonCompletion } from './json'
import { capList, ignoreRepairs, trimField } from './repair'
import type { Note } from './repair'
import { SCRIPT_CRAFT } from './script-craft'
import { outputBudget } from '../llm/types'
import type { LLMTaskRequest } from '../llm/types'
```

In `buildTeaserRequest`'s `system` text, replace:

```
- Each paragraph carries the chapterIndex whose part of the story it draws
  from, so the edit can show that chapter's visuals behind it.

Return exactly:
```

with:

```
- Each paragraph carries the chapterIndex whose part of the story it draws
  from, so the edit can show that chapter's visuals behind it.

Limits (the app checks them): title ${TEASER_TITLE_MIN} to ${TEASER_TITLE_MAX} characters;
${TEASER_PARAGRAPHS_MIN} to ${TEASER_PARAGRAPHS_MAX} paragraphs, each ${TEASER_PARAGRAPH_MIN} to ${TEASER_PARAGRAPH_MAX} characters;
chapterIndex is the number of a chapter below, 0 to ${input.chapters.length - 1}.

Return exactly:
```

Replace `parseTeaser` (lines 465 to 467) with:

```ts
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The teaser as the model answered it, repaired before it is validated
 * (decision 293): the title trimmed at a word, each beat at a sentence, and
 * no more than five beats kept. A beat's chapter is a fact: one the film
 * does not have is refused, not dropped, because it would pull the wrong
 * chapter's visuals behind the words (spec 2.2).
 */
export function parseTeaser(
  text: string,
  chapterCount: number,
  note: Note = ignoreRepairs,
): TeaserScript {
  const raw = parseJsonCompletion(text, z.looseObject({}), 'teaser script')
  const beats = capList(raw['paragraphs'], TEASER_PARAGRAPHS_MAX, 'beats', note)
  const parsed = TeaserScriptSchema.safeParse({
    ...raw,
    title: trimField(raw['title'], TEASER_TITLE_MAX, 'the title', note),
    paragraphs: Array.isArray(beats)
      ? beats.map((beat, index) =>
          isRecord(beat)
            ? {
                ...beat,
                text: trimField(beat['text'], TEASER_PARAGRAPH_MAX, `beat ${index + 1}`, note),
              }
            : beat,
        )
      : beats,
  })
  if (!parsed.success) {
    throw new ValidationError(`The teaser script is malformed: ${formatIssues(parsed.error)}`, {
      field: 'teaser script',
    })
  }
  const stray = parsed.data.paragraphs.findIndex(
    (paragraph) => paragraph.chapterIndex >= chapterCount,
  )
  if (stray !== -1) {
    throw new ValidationError(
      `beat ${stray + 1} draws from chapter ${parsed.data.paragraphs[stray]!.chapterIndex}, ` +
        `but the chapters run 0 to ${chapterCount - 1}`,
      { field: 'teaser script' },
    )
  }
  return parsed.data
}
```

A negative `chapterIndex` is still refused by the schema (`int().min(0)`). The studio calls the paragraphs beats ("Beat 1 · cut over ..."), so the labels do too.

- [ ] **Step 5: Run the provider and schema tests**

Run: `cd packages/providers && pnpm exec vitest run src/prompts/script.test.ts`
Expected: PASS (the 6 new tests with the file's existing ones).

Run: `cd packages/schemas && pnpm test`
Expected: PASS.

- [ ] **Step 6: Write the failing helper test (database)**

Create `apps/web/inngest/lib/teaser-build.test.ts` (database: run alone, Docker Desktop running):

```ts
// @vitest-environment node

import {
  addNotice,
  chapters,
  FIXTURE_PROJECT_ID,
  listProjectNotices,
  notices,
  requireTestDatabase,
  scripts,
  seed,
} from '@boom-busters/db'
import { BudgetExceededError, noticesFor } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { writeTeaserScript } from './teaser-build'

const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))

/**
 * The teaser script on the answer helper (decision 293), against the test
 * database with the model call replaced: at most two calls, its notices on
 * the Teaser card's place, a stop skipped with the reason, a provider error
 * thrown for Inngest to retry, and the budget keeping its gate.
 */

const describeDb = requireTestDatabase() ? describe : describe.skip

const FIRST = { text: 'One number was missing, and it was billions.', chapterIndex: 0 }
const SECOND = { text: 'Then the shares collapsed in nine days.', chapterIndex: 1 }

const reply = (paragraphs: { text: string; chapterIndex: number }[]) => ({
  text: JSON.stringify({ title: 'The audit that said no', paragraphs }),
})

const teaserNotices = async () =>
  noticesFor(await listProjectNotices(db, FIXTURE_PROJECT_ID), 'teaser')

describeDb('writeTeaserScript (decision 293)', () => {
  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockReset()
    await seed(db)
    await db.delete(notices)
    await db.delete(scripts)
    const [script] = await db
      .insert(scripts)
      .values({ projectId: FIXTURE_PROJECT_ID, version: 1, shortsCandidates: [] })
      .returning({ id: scripts.id })
    await db.insert(chapters).values([
      {
        scriptId: script!.id,
        index: 0,
        title: 'The audit',
        contentMd: 'By June, the auditors could not find the money.',
      },
      {
        scriptId: script!.id,
        index: 1,
        title: 'The collapse',
        contentMd: 'The shares collapsed in nine days.',
      },
    ])
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('lands a clean teaser in one call and retires the old note on the Teaser card', async () => {
    await addNotice(
      db,
      { projectId: FIXTURE_PROJECT_ID, subject: 'teaser', subjectId: null },
      { kind: 'skipped', message: 'The teaser was skipped: an older reason' },
    )
    callLlm.mockResolvedValueOnce(reply([FIRST, SECOND]))

    expect(await writeTeaserScript(FIXTURE_PROJECT_ID)).toEqual({
      ok: true,
      title: 'The audit that said no',
      paragraphs: [FIRST, SECOND],
      scriptVersion: 1,
    })
    expect(callLlm).toHaveBeenCalledTimes(1)
    expect(callLlm.mock.calls[0]![1]).toEqual({ projectId: FIXTURE_PROJECT_ID })
    expect(await teaserNotices()).toEqual([])
  })

  it('asks once more after a refusal, and says on the Teaser card what it trimmed', async () => {
    const long = { text: 'One number was missing, and it was billions. '.repeat(10), chapterIndex: 0 }
    callLlm
      .mockResolvedValueOnce({ text: 'no json here' })
      .mockResolvedValueOnce(reply([long, SECOND]))

    const written = await writeTeaserScript(FIXTURE_PROJECT_ID)
    expect(written).toMatchObject({ ok: true, title: 'The audit that said no' })
    expect(callLlm).toHaveBeenCalledTimes(2)
    expect(callLlm.mock.calls[1]![1]).toEqual({
      projectId: FIXTURE_PROJECT_ID,
      purpose: 'retry: refused',
    })
    expect((await teaserNotices()).map((notice) => notice.message)).toEqual([
      'Trimmed to fit: beat 1.',
    ])
  })

  it("refuses a beat from a chapter the film does not have, and tells the retry the range", async () => {
    callLlm
      .mockResolvedValueOnce(reply([FIRST, { ...SECOND, chapterIndex: 7 }]))
      .mockResolvedValueOnce(reply([FIRST, SECOND]))

    expect(await writeTeaserScript(FIXTURE_PROJECT_ID)).toMatchObject({ ok: true })
    expect(callLlm.mock.calls[1]![0].messages.at(-1).content).toContain(
      'beat 2 draws from chapter 7, but the chapters run 0 to 1',
    )
  })

  it('skips the teaser with the reason on its card after two refusals', async () => {
    callLlm.mockResolvedValue({ text: 'no json here' })

    expect(await writeTeaserScript(FIXTURE_PROJECT_ID)).toEqual({
      ok: false,
      skipped: expect.stringMatching(/^the teaser script failed: The model returned no JSON/),
    })
    expect(callLlm).toHaveBeenCalledTimes(2)
    const [notice] = await teaserNotices()
    expect(notice).toMatchObject({
      kind: 'skipped',
      message: expect.stringMatching(/^The teaser was skipped: The model returned no JSON/),
    })
  })

  it('throws a provider error for Inngest to retry, writing no notice', async () => {
    callLlm.mockRejectedValue(new Error('socket hang up'))

    const thrown = await writeTeaserScript(FIXTURE_PROJECT_ID).catch((error: unknown) => error)
    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).not.toBeInstanceOf(NonRetriableError)
    expect((thrown as Error).message).toBe('socket hang up')
    expect(callLlm).toHaveBeenCalledTimes(1)
    expect(await teaserNotices()).toEqual([])
  })

  it('keeps the budget gate', async () => {
    callLlm.mockRejectedValue(
      new BudgetExceededError({
        provider: 'anthropic',
        operation: 'llm.scripting',
        budgetUsd: 10,
        monthSpendUsd: 9.99,
        estimateUsd: 0.05,
      }),
    )

    expect(await writeTeaserScript(FIXTURE_PROJECT_ID)).toMatchObject({
      ok: false,
      gate: { gate: 'budget', provider: 'anthropic' },
    })
    expect(await teaserNotices()).toEqual([])
  })
})
```

- [ ] **Step 7: Run it to see it fail**

Run: `cd apps/web && pnpm exec vitest run inngest/lib/teaser-build.test.ts` (Bash `timeout: 600000`, alone)
Expected: FAIL. One call with no retry, no notices written, and the provider error comes back as `skipped`.

- [ ] **Step 8: Put `writeTeaserScript` on the helper**

In `apps/web/inngest/lib/teaser-build.ts`, replace the imports (lines 1 to 21) with:

```ts
import { getLatestScript, getProject, MOCK_KEY_PREFIX } from '@boom-busters/db'
import {
  buildTeaserRequest,
  mockProvidersEnabled,
  mockTeaser,
  parseTeaser,
  tensionFromOutline,
} from '@boom-busters/providers'
import {
  BudgetExceededError,
  OutlineSchema,
  serialiseError,
  teaserTextHash,
} from '@boom-busters/schemas'
import type { NoticeTarget, TeaserParagraph } from '@boom-busters/schemas'
import type { TeaserParagraphAudio } from '@boom-busters/timeline'
import { callForAnswer } from '@/lib/answer'
import { completeForProject } from '@/lib/answer-call'
import { db } from '@/lib/db'
import { recordRepairs, recordStop } from '@/lib/notices'
import { putObject, takeStorage } from '@/lib/storage'
import { synthesise } from '@/lib/tts'
import { budgetGateData } from './gates'
```

Replace `writeTeaserScript` with its doc comment (lines 36 to 74) with:

```ts
/** How the Teaser card's place says a stopped script (decision 293), unless the caller words it. */
const TEASER_SKIPPED = 'The teaser was skipped'

/**
 * Write the teaser script from the latest script's chapters and tension, on
 * the answer helper (decision 293): at most two calls, the second told what
 * was wrong. Its notices are written here, inside the caller's step, so no
 * new field crosses a step boundary: what a repair trimmed, or why the script
 * stopped, on the Teaser card's place. Two refused answers skip the teaser;
 * the budget keeps its gate; anything else the call throws (a provider
 * outage) is thrown, so Inngest retries the step instead of skipping a teaser
 * a passing outage cost. `stopped` words a stop's notice for the caller's act;
 * `null` when the caller records the stop itself (the teaser rebuild).
 */
export async function writeTeaserScript(
  projectId: string,
  stopped: string | null = TEASER_SKIPPED,
): Promise<TeaserWriteResult> {
  const latest = await getLatestScript(db, projectId)
  if (!latest) return { ok: false, skipped: 'there is no script to write a teaser from' }
  const chapterSources = latest.chapters.map((chapter) => ({
    index: chapter.index,
    title: chapter.title,
    contentMd: chapter.contentMd,
  }))
  const parsedOutline = OutlineSchema.safeParse(latest.script.outline)
  const tension = parsedOutline.success ? tensionFromOutline(parsedOutline.data) : undefined
  const target: NoticeTarget = { projectId, subject: 'teaser', subjectId: null }

  if (mockProvidersEnabled()) {
    await recordRepairs(target)
    return { ok: true, ...mockTeaser(chapterSources), scriptVersion: latest.script.version }
  }

  try {
    const project = await getProject(db, projectId)
    const answer = await callForAnswer({
      request: buildTeaserRequest({
        caseTitle: project?.title ?? '',
        chapters: chapterSources,
        ...(tension ? { tension } : {}),
      }),
      parse: (text, note) => parseTeaser(text, chapterSources.length, note),
      complete: completeForProject(projectId),
    })
    if (!answer.ok) {
      if (stopped !== null) await recordStop(target, 'skipped', `${stopped}: ${answer.issue}`)
      return { ok: false, skipped: `the teaser script failed: ${answer.issue}` }
    }
    await recordRepairs(target, answer.repairs)
    return { ok: true, ...answer.value, scriptVersion: latest.script.version }
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      return { ok: false, gate: budgetGateData(error) }
    }
    throw error
  }
}
```

`TeaserWriteResult` (lines 31 to 34) is unchanged, so both callers' step results keep their shape and a parked run replays them as before.

- [ ] **Step 9: Word the rebuild's stop for its own act, and update the runner's comment**

In `apps/web/inngest/functions/teaser-rebuild-runner.ts`, `load-script` regenerates a pre-studio teaser's script while the teaser itself exists, so "The teaser was skipped" would be wrong on its card, and since Task 4 the runner's own `fail('script-skipped', ...)` (line ~116) records the stop on the Teaser card as "Voicing stopped before it began: the teaser script failed: <issue>". Replace `        const written = await writeTeaserScript(projectId)` (line 95) with:

```ts
        // The teaser exists already, and this runner's `fail('script-skipped')`
        // records the stop on the Teaser card (decision 293); recording it
        // here as well would put two lines on the card for one stop.
        const written = await writeTeaserScript(projectId, null)
```

In `apps/web/inngest/functions/shorts-runner.ts`, in the comment above `write-teaser`, replace:

```ts
     * master. A teaser failure SKIPS with its reason rather than failing the
     * stage: the excerpts above are complete deliverables, and a re-run
     * rebuilds the teaser (synthesis is idempotency-keyed, so paragraphs
     * already bought are re-served by the vendor, not re-billed).
```

with:

```ts
     * master. A teaser whose script is refused twice, or whose voicing or cut
     * fails, SKIPS with its reason rather than failing the stage: the
     * excerpts above are complete deliverables, and a re-run rebuilds the
     * teaser (synthesis is idempotency-keyed, so paragraphs already bought
     * are re-served by the vendor, not re-billed). A refused script says why
     * on the Teaser card's place (decision 293). A provider error on the
     * script call is thrown, so Inngest retries the step; past the retries
     * the stage fails, as for any other step.
```

- [ ] **Step 10: Run the helper test**

Run: `cd apps/web && pnpm exec vitest run inngest/lib/teaser-build.test.ts` (Bash `timeout: 600000`, alone)
Expected: PASS (6 tests).

- [ ] **Step 11: Test both callers (database)**

In `apps/web/inngest/functions/shorts-runner.test.ts`:
- Add `listProjectNotices,` and `notices,` to the `@boom-busters/db` import list (lines 3 to 19), `noticesFor` to the `@boom-busters/schemas` import (line 20), and `afterEach` to the `vitest` import (line 23).
- After the `@/lib/storage` mock (ends line 50), add:

```ts
// The teaser's script call (decision 293). The mock-mode tests never reach it.
const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))
```

- In `beforeEach`, after `vi.clearAllMocks()` (line 106) add `callLlm.mockReset()` (`clearAllMocks` keeps an earlier test's implementation), and after `forgetRunRows()` (line 113) add `await db.delete(notices)`.
- After the `beforeEach` block (ends line 153), add:

```ts
  afterEach(() => {
    vi.unstubAllEnvs()
  })
```

- Before the `describeDb` block closes (line 378), add:

```ts
  it(
    'skips the teaser with the reason on its card when its script is refused twice (decision 293)',
    { timeout: 120_000 },
    async () => {
      vi.stubEnv('MOCK_PROVIDERS', '')
      callLlm.mockResolvedValue({ text: 'no json here' })

      const { result } = await engine.execute({
        events: masterReadyEvent(),
        steps: [{ id: 'request-short-renders', handler: () => undefined }],
      })

      expect(result).toMatchObject({ outcome: 'shorts-created', created: 1 })
      expect((result as { teaser: string | null }).teaser).toMatch(
        /^skipped: the teaser script failed: /,
      )
      expect(callLlm).toHaveBeenCalledTimes(2)
      const [notice] = noticesFor(await listProjectNotices(db, FIXTURE_PROJECT_ID), 'teaser')
      expect(notice).toMatchObject({
        kind: 'skipped',
        message: expect.stringMatching(/^The teaser was skipped: The model returned no JSON/),
      })
      expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('awaiting_review')
    },
  )

  it(
    'throws a provider error on the teaser script for Inngest to retry, never a silent skip (decision 293)',
    { timeout: 120_000 },
    async () => {
      vi.stubEnv('MOCK_PROVIDERS', '')
      callLlm.mockRejectedValue(new Error('socket hang up'))

      const { error } = await engine.execute({
        events: masterReadyEvent(),
        steps: [{ id: 'request-short-renders', handler: () => undefined }],
      })

      expect(error).toMatchObject({ message: expect.stringContaining('socket hang up') })
      expect(callLlm).toHaveBeenCalledTimes(1)
      expect(noticesFor(await listProjectNotices(db, FIXTURE_PROJECT_ID), 'teaser')).toEqual([])
      expect((await listShorts(db, FIXTURE_PROJECT_ID)).some((row) => row.kind === 'teaser')).toBe(
        false,
      )
    },
  )
```

The test engine halts a run at a failed step rather than modelling retries, so the step's error comes back as `error`; `teaser-build.test.ts` already pins that the error is not a `NonRetriableError`.

In `apps/web/inngest/functions/teaser-rebuild-runner.test.ts`:
- Add `listProjectNotices,` and `notices,` to the `@boom-busters/db` import list (lines 3 to 19), `noticesFor` to the `@boom-busters/schemas` import (line 20), and `afterEach` to the `vitest` import (line 24).
- After the `notify` mock (line 46), add:

```ts
// The pre-studio teaser's script call (decision 293). The mock-mode tests never reach it.
const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))
```

- In `beforeEach`, after `vi.clearAllMocks()` add `callLlm.mockReset()`, and after `forgetRunRows()` add `await db.delete(notices)`; after the `beforeEach` block add the same `afterEach(() => { vi.unstubAllEnvs() })`.
- Before the `describeDb` block closes, add:

```ts
  it(
    'a pre-studio teaser whose script is refused twice says why on the Teaser card (decision 293)',
    { timeout: 120_000 },
    async () => {
      vi.stubEnv('MOCK_PROVIDERS', '')
      callLlm.mockResolvedValue({ text: 'no json here' })
      const teaser = await insertTeaser()

      const { result } = await engine.execute({ events: rebuildEvent(teaser.id) })

      expect(result).toMatchObject({ outcome: 'skipped' })
      expect(callLlm).toHaveBeenCalledTimes(2)
      // One line on the Teaser card, from the runner's `fail` (Task 4 mocks
      // `recordStop` in this file); the script call records none of its own.
      expect(recordStop).toHaveBeenCalledTimes(1)
      expect(recordStop).toHaveBeenCalledWith(
        { projectId: FIXTURE_PROJECT_ID, subject: 'teaser', subjectId: null },
        'stopped',
        expect.stringMatching(
          /^Voicing stopped before it began: the teaser script failed: The model returned no JSON/,
        ),
      )
      expect((await getShort(db, teaser.id))?.teaserScript).toBeNull()
    },
  )

  it(
    'throws a provider error on the script call for Inngest to retry (decision 293)',
    { timeout: 120_000 },
    async () => {
      vi.stubEnv('MOCK_PROVIDERS', '')
      callLlm.mockRejectedValue(new Error('socket hang up'))
      const teaser = await insertTeaser()

      const { error } = await engine.execute({ events: rebuildEvent(teaser.id) })

      expect(error).toMatchObject({ message: expect.stringContaining('socket hang up') })
      expect(notify).not.toHaveBeenCalled()
      expect(noticesFor(await listProjectNotices(db, FIXTURE_PROJECT_ID), 'teaser')).toEqual([])
    },
  )
```

Run: `cd apps/web && pnpm exec vitest run inngest/functions/shorts-runner.test.ts inngest/functions/teaser-rebuild-runner.test.ts` (Bash `timeout: 600000`, alone)
Expected: PASS, the existing mock-mode tests unchanged (they now also retire the `teaser` notices on a landed teaser, which needs Task 2's migration on the test database) plus the four new ones.

- [ ] **Step 12: Write the failing Shorts screen tests**

In `apps/web/app/(console)/projects/[id]/shorts-screen.test.tsx`, after `import { beforeEach, describe, expect, it, vi } from 'vitest'` (line 3) add `import type { Notice } from '@boom-busters/schemas'`. After the toast mock (line 59), add:

```ts
// The notice's Dismiss is a server action whose module loads next-auth,
// which cannot load under jsdom.
vi.mock('@/app/(console)/notice-actions', () => ({ dismissNoticeAction: vi.fn() }))

function teaserNotice(message: string): Notice {
  return {
    id: '01HQ00000000000000000000N1',
    projectId: PROJECT,
    subject: 'teaser',
    subjectId: null,
    kind: 'skipped',
    message,
    createdAt: new Date('2026-10-09T10:00:00Z'),
  }
}
```

(`PROJECT` is declared further down, at line 83; the helper reads it only when a test calls it, after the module has loaded.)

Before the final `})` of `describe('ShortsScreen', ...)`, add:

```tsx
  it("shows the teaser's notices on the Teaser card and nowhere else (decision 293)", () => {
    render(
      <ShortsScreen
        projectId={PROJECT}
        shorts={[card(), teaserCard({ id: '01HQ00000000000000000000T1' })]}
        live={false}
        teaserNotices={[teaserNotice('Trimmed to fit: beat 2.')]}
      />,
    )
    const line = screen.getByRole('status')
    expect(line).toHaveTextContent('Trimmed to fit: beat 2.')
    // On the card that carries the studio button.
    expect(
      screen.getByRole('button', { name: 'Open the teaser studio' }).parentElement,
    ).toContainElement(line)
    expect(screen.queryByRole('region', { name: 'Teaser' })).not.toBeInTheDocument()
  })

  it('shows them where the Teaser card would be when there is none (decision 293)', () => {
    render(
      <ShortsScreen
        projectId={PROJECT}
        shorts={[card()]}
        live={false}
        teaserNotices={[
          teaserNotice('The teaser was skipped: the answer was cut off at its length limit'),
        ]}
      />,
    )
    const place = screen.getByRole('region', { name: 'Teaser' })
    expect(within(place).getByRole('status')).toHaveTextContent(
      'The teaser was skipped: the answer was cut off at its length limit',
    )
    expect(within(place).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
  })
```

Run: `cd apps/web && pnpm exec vitest run "app/(console)/projects/[id]/shorts-screen.test.tsx"`
Expected: FAIL, `teaserNotices` is not a prop yet and nothing renders a notice.

- [ ] **Step 13: Render the teaser notices on the Shorts screen**

In `apps/web/app/(console)/projects/[id]/shorts-screen.tsx`, after `import * as React from 'react'` (line 3) add `import type { Notice } from '@boom-busters/schemas'`, and after `import { ConfirmButton } from '@/components/confirm-button'` (line 5) add `import { Notices } from '@/components/notices'`.

Replace the `ShortsScreen` signature (lines 34 to 46) with:

```tsx
export function ShortsScreen({
  projectId,
  shorts,
  live,
  canAdvance = false,
  teaserNotices = [],
}: {
  projectId: string
  shorts: ShortCardModel[]
  live: boolean
  /** True while the project is ON the shorts stage with nothing running. */
  canAdvance?: boolean
  /**
   * The `teaser` notices (decision 293): what a repair trimmed in the teaser
   * script, or why the teaser was skipped. On the Teaser card, or where it
   * would be when there is none.
   */
  teaserNotices?: readonly Notice[]
}) {
```

After `const studioShort = shorts.find((short) => short.id === studioId) ?? null` (line 49) add `const hasTeaser = shorts.some((short) => short.kind === 'teaser')`.

Replace:

```tsx
    <div className="flex flex-col gap-4">
      <section aria-label="Shorts" className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
```

with:

```tsx
    <div className="flex flex-col gap-4">
      {/* No Teaser card to carry them: the notices say why where it would be. */}
      {!hasTeaser && teaserNotices.length > 0 ? (
        <section
          aria-label="Teaser"
          className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-3"
        >
          <h2 className="text-[14px] font-semibold">Teaser</h2>
          <Notices notices={teaserNotices} />
        </section>
      ) : null}
      <section aria-label="Shorts" className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
```

In the grid, replace:

```tsx
          <ShortCard
            key={short.id}
            short={short}
            live={live}
```

with:

```tsx
          <ShortCard
            key={short.id}
            short={short}
            live={live}
            notices={short.kind === 'teaser' ? teaserNotices : []}
```

Replace the `ShortCard` signature (lines 170 to 180) with:

```tsx
function ShortCard({
  short,
  live,
  notices = [],
  studioOpen = false,
  onToggleStudio,
}: {
  short: ShortCardModel
  live: boolean
  /** This card's notices: the teaser's, on the Teaser card (decision 293). */
  notices?: readonly Notice[]
  studioOpen?: boolean
  onToggleStudio?: () => void
}) {
```

and directly before `{/* The teaser's own workbench (decision 227): script, voice and cut` (line 245) add:

```tsx
        <Notices notices={notices} />

```

`Notices` renders nothing for an empty list, so excerpt cards are unchanged.

- [ ] **Step 14: Pass the teaser notices from the project page**

In `apps/web/app/(console)/projects/[id]/page.tsx`, in the `<ShortsScreen` element, after `canAdvance={project.stage === 'shorts' && !liveRun}` add `teaserNotices={noticesFor(notices, 'teaser')}`. `notices` and the `noticesFor` import are Task 3's.

- [ ] **Step 15: Run the screen test, the consumers and the typecheck**

Run: `cd apps/web && pnpm exec vitest run "app/(console)/projects/[id]/shorts-screen.test.tsx"`
Expected: PASS (the existing tests and the 2 new ones).

Then, because the teaser schema, prompt and parser changed (each with the Bash `timeout: 600000`, one database run at a time): `cd packages/providers && pnpm test`; `cd packages/schemas && pnpm test`; `cd apps/web && pnpm exec vitest run "app/(console)/projects/[id]/shorts-actions.test.ts" inngest/functions/teaser-shot-fetcher.test.ts` (database, alone); `pnpm typecheck` from the root.
Expected: all PASS; typecheck clean (`writeTeaserScript`'s new parameter is optional, so no other caller changes).

- [ ] **Step 16: Format, lint and commit**

Run from the root: `pnpm exec prettier --write` then `--check` on the files below, then `pnpm exec eslint --max-warnings 0` on them.

```bash
git add packages/schemas/src/script.ts packages/providers/src/prompts/script.ts packages/providers/src/prompts/script.test.ts apps/web/inngest/lib/teaser-build.ts apps/web/inngest/lib/teaser-build.test.ts apps/web/inngest/functions/shorts-runner.ts apps/web/inngest/functions/shorts-runner.test.ts apps/web/inngest/functions/teaser-rebuild-runner.ts apps/web/inngest/functions/teaser-rebuild-runner.test.ts "apps/web/app/(console)/projects/[id]/shorts-screen.tsx" "apps/web/app/(console)/projects/[id]/shorts-screen.test.tsx" "apps/web/app/(console)/projects/[id]/page.tsx"
git commit -F <message file>
```

Message: `feat(teaser): the script states its limits, retries once, and says on the Teaser card why it was skipped (decision 293)` plus the trailer.

---


---

### Task 10: Cast identity

**Files:**
- Modify: `packages/schemas/src/cast.ts` (new constants before `CastMemberSchema` at line 40; lines 47 and 48)
- Modify: `packages/providers/src/prompts/cast-identity.ts` (imports lines 1 to 6; line 26; the rules lines 46 to 58; `IdentitySchema` and `parseCastIdentity` lines 72 to 92)
- Test: `packages/providers/src/prompts/cast-identity.test.ts` (imports lines 1 to 8; one test in `buildCastIdentityRequest`; a new block)
- Modify: `apps/web/app/(console)/projects/[id]/cast-actions.ts` (imports lines 12 to 45; `failure` lines 82 to 91; the tails of `finaliseCastPhotoAction` lines 270 to 279 and `addCastPhotoFromUrlAction` lines 346 to 353; `describeFromPhotos` lines 396 to 418)
- Test: `apps/web/app/(console)/projects/[id]/cast-actions.test.ts` (database; imports lines 3 to 25; a mock after line 62; a nested block before the file's last `})`)
- Modify: `apps/web/app/(console)/projects/[id]/cast-card.tsx` (imports lines 5 to 11; `CastCardProps` lines 57 to 64; `CastCard` lines 66 and 70 to 72; `MemberRow` usage lines 165 to 171; `MemberRow` lines 216 to 226 and before line 436)
- Test: `apps/web/app/(console)/projects/[id]/cast-card.test.tsx`
- Modify: `apps/web/app/(console)/projects/[id]/page.tsx` (the `<CastCard` props, around line 443 before Task 3's edits)

**Interfaces:**
- Consumes: `Note`, `ignoreRepairs`, `trimField`, `Repair` (Task 1); `callForAnswer` (Task 1); `completeForProject` (stage 1); `recordRepairs` (Task 3); `Notices` (Task 3); `noticesFor`, `Notice`, `NoticeTarget` (Task 1); `listProjectNotices`, `notices` (Task 2, tests); `notices` held by `page.tsx` (Task 3).
- Produces:
  - `@boom-busters/schemas`: `CAST_IDENTITY_MAX = 600`, `CAST_GUARDRAIL_MAX = 600`.
  - `@boom-busters/providers`: `parseCastIdentity(text: string, note?: Note): { identityString: string; guardrail: string }`; `IDENTITY_LABEL = 'the identity'`, `GUARDRAIL_LABEL = 'the guardrail'`. `IDENTITY_MAX_CHARS` is removed (its one user was this module).
  - `finaliseCastPhotoAction` and `addCastPhotoFromUrlAction`: when the describe step fails after the photo was stored, `{ ok: false, error: 'The photo is saved, but the description could not be written: <reason>' }`.
  - `CastCardProps.notices?: readonly Notice[]` (the project's open notices; each member's row picks its own).

- [ ] **Step 1: Write the failing provider tests**

In `packages/providers/src/prompts/cast-identity.test.ts`, replace the first line with `import { CAST_GUARDRAIL_MAX, CAST_IDENTITY_MAX, ValidationError } from '@boom-busters/schemas'` and after the `'./cast-identity'` import (ends line 8) add `import type { Note, Repair } from './repair'`.

Inside `describe('buildCastIdentityRequest', ...)`, after the test `'bans the full word list the bible bans, not a shorter copy of it'`, add:

```ts
  it('states both limits in characters, not words (decision 293)', () => {
    expect(request.system.replace(/\s+/g, ' ')).toContain(
      'Limits (the app checks them): "identityString" at most 600 characters; ' +
        '"guardrail" at most 600 characters.',
    )
    expect(request.system).not.toContain('60 words')
  })
```

After `describe('parseCastIdentity', ...)` (ends line 67), add:

```ts
describe('parseCastIdentity repairs (decision 293)', () => {
  const collect = () => {
    const notes: Repair[] = []
    const note: Note = (repair) => {
      notes.push(repair)
    }
    return { notes, note }
  }

  it('trims an identity over its limit at the end, keeping the name and role it begins with', () => {
    const { notes, note } = collect()
    const long =
      'Emad Mostaque, founder: ' + 'oval face, short dark hair, close-cropped beard, '.repeat(15)
    const parsed = parseCastIdentity(
      JSON.stringify({ identityString: long, guardrail: 'never mocked' }),
      note,
    )
    expect(parsed.identityString.length).toBeLessThanOrEqual(CAST_IDENTITY_MAX)
    expect(long.startsWith(parsed.identityString)).toBe(true)
    expect(parsed.guardrail).toBe('never mocked')
    expect(notes).toEqual([{ action: 'trimmed', field: 'the identity' }])
  })

  it('trims a guardrail over its limit', () => {
    const { notes, note } = collect()
    const guardrail = 'never mocked; never in handcuffs; '.repeat(25)
    const parsed = parseCastIdentity(
      JSON.stringify({ identityString: 'Emad Mostaque, founder: oval face', guardrail }),
      note,
    )
    expect(parsed.guardrail.length).toBeLessThanOrEqual(CAST_GUARDRAIL_MAX)
    expect(guardrail.startsWith(parsed.guardrail)).toBe(true)
    expect(notes).toEqual([{ action: 'trimmed', field: 'the guardrail' }])
  })

  it('notes nothing for an answer within its limits', () => {
    const { notes, note } = collect()
    parseCastIdentity('{"identityString": "x face", "guardrail": "never mocked"}', note)
    expect(notes).toEqual([])
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/providers && pnpm exec vitest run src/prompts/cast-identity.test.ts`
Expected: FAIL. The constants are not exported, the prompt says "60 words", and an identity over 600 characters is refused.

- [ ] **Step 3: Add the constants to the schema**

In `packages/schemas/src/cast.ts`, before `export const CastMemberSchema = z.object({` (line 40), add:

```ts
/**
 * The identity and guardrail limits (decision 293): one source for this
 * schema, the describe prompt that states them and the repair that trims to them.
 */
export const CAST_IDENTITY_MAX = 600
export const CAST_GUARDRAIL_MAX = 600

```

and replace `  identityString: z.string().max(600),` (line 47) with `  identityString: z.string().max(CAST_IDENTITY_MAX),` and `  guardrail: z.string().max(600),` (line 48) with `  guardrail: z.string().max(CAST_GUARDRAIL_MAX),`.

- [ ] **Step 4: State the limits in characters and trim before validating**

In `packages/providers/src/prompts/cast-identity.ts`, replace the imports (lines 1 to 6) with:

```ts
import { CAST_GUARDRAIL_MAX, CAST_IDENTITY_MAX, ValidationError } from '@boom-busters/schemas'
import { z } from 'zod'
import { BANNED_PROMPT_WORDS } from './direction-craft'
import { formatIssues, parseJsonCompletion } from './json'
import { ignoreRepairs, trimField } from './repair'
import type { Note } from './repair'
import { outputBudget } from '../llm/types'
import type { LLMTaskRequest, MsgImage } from '../llm/types'
```

Replace `export const IDENTITY_MAX_CHARS = 600` (line 26) with:

```ts
/** How a notice names each field on the member's card (decision 293). */
export const IDENTITY_LABEL = 'the identity'
export const GUARDRAIL_LABEL = 'the guardrail'
```

In the `system` text, replace `- "identityString" is at most 60 words, one sentence, in this order: face` (line 46) with `- "identityString" is one sentence, in this order: face` (the next line still begins `  shape; hair`, which the existing prompt test reads), and replace the guardrail rule's last line `  meetings.\`,` (line 58) with:

```
  meetings.

Limits (the app checks them): "identityString" at most ${CAST_IDENTITY_MAX} characters;
"guardrail" at most ${CAST_GUARDRAIL_MAX} characters.`,
```

Replace `IdentitySchema` and `parseCastIdentity` (lines 72 to 92) with:

```ts
const IdentitySchema = z.object({
  identityString: z.string().trim().min(1).max(CAST_IDENTITY_MAX),
  guardrail: z.string().trim().max(CAST_GUARDRAIL_MAX).optional(),
})

/**
 * The description as the model answered it, repaired before it is validated
 * (decision 293): a field over its limit is trimmed at its end, so the name
 * and role the identity begins with are kept.
 */
export function parseCastIdentity(
  text: string,
  note: Note = ignoreRepairs,
): { identityString: string; guardrail: string } {
  const raw = parseJsonCompletion(text, z.looseObject({}), 'cast identity')
  const parsed = IdentitySchema.safeParse({
    ...raw,
    identityString: trimField(raw['identityString'], CAST_IDENTITY_MAX, IDENTITY_LABEL, note),
    guardrail: trimField(raw['guardrail'], CAST_GUARDRAIL_MAX, GUARDRAIL_LABEL, note),
  })
  if (!parsed.success) {
    throw new ValidationError(`The identity answer was malformed: ${formatIssues(parsed.error)}`, {
      field: 'identityString',
    })
  }
  return {
    identityString: parsed.data.identityString,
    guardrail:
      parsed.data.guardrail && parsed.data.guardrail.length > 0
        ? parsed.data.guardrail
        : DEFAULT_GUARDRAIL,
  }
}
```

- [ ] **Step 5: Run the provider and schema tests**

Run: `cd packages/providers && pnpm exec vitest run src/prompts/cast-identity.test.ts`
Expected: PASS (13 tests: the 9 there were and the 4 new).

Run: `cd packages/schemas && pnpm test`
Expected: PASS.

- [ ] **Step 6: Write the failing action tests (database)**

In `apps/web/app/(console)/projects/[id]/cast-actions.test.ts`:
- Add `listProjectNotices,` and `notices,` to the `@boom-busters/db` import list (lines 3 to 11); after it add `import { CAST_IDENTITY_MAX, noticesFor, ValidationError } from '@boom-busters/schemas'`; add `afterEach` to the `vitest` import (line 13).
- After the `@/lib/remote-image` mock (line 62), add:

```ts
// The describe call (decision 293). The mock-mode tests never reach it.
const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))
```

- Before the file's last `})` (it closes `describeDb('cast actions (mock mode)', ...)`), add:

```ts
  describe('the describe call on the answer helper (decision 293)', () => {
    const identity = (identityString: string, guardrail = 'never mocked') => ({
      text: JSON.stringify({ identityString, guardrail }),
    })
    const castNotices = async (memberId: string) =>
      noticesFor(await listProjectNotices(db, FIXTURE_PROJECT_ID), 'cast', memberId)

    /** A photo without the describe call: an identity is already there. */
    async function withPhoto(id: string): Promise<void> {
      await updateCastMemberAction(id, { identityString: 'stale' })
      await finaliseCastPhotoAction({
        memberId: id,
        mimeType: 'image/jpeg',
        contentHash: HASH_A,
        width: 1200,
        height: 1600,
        view: 'front',
      })
    }

    beforeEach(async () => {
      vi.stubEnv('MOCK_PROVIDERS', '')
      callLlm.mockReset()
      await db.delete(notices)
    })

    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('asks once more with the reason after a refused description, labelled in the ledger', async () => {
      const id = await addEmad()
      await withPhoto(id)
      callLlm
        .mockResolvedValueOnce({ text: 'no json here' })
        .mockResolvedValueOnce(identity('Emad Mostaque, founder: oval face, short dark hair'))

      expect(await describeCastMemberAction(id)).toEqual({ ok: true })
      expect(callLlm).toHaveBeenCalledTimes(2)
      expect(callLlm.mock.calls[0]![1]).toEqual({ projectId: FIXTURE_PROJECT_ID })
      expect(callLlm.mock.calls[1]![1]).toEqual({
        projectId: FIXTURE_PROJECT_ID,
        purpose: 'retry: refused',
      })
      expect((await listCastMembers(db, FIXTURE_PROJECT_ID))[0]?.identityString).toBe(
        'Emad Mostaque, founder: oval face, short dark hair',
      )
    })

    it("puts a trimmed identity's notice on that member, and a clean one retires it", async () => {
      const id = await addEmad()
      await withPhoto(id)
      const long =
        'Emad Mostaque, founder: ' + 'oval face, short dark hair, close-cropped beard, '.repeat(15)
      callLlm.mockResolvedValueOnce(identity(long))

      expect(await describeCastMemberAction(id)).toEqual({ ok: true })
      const [member] = await listCastMembers(db, FIXTURE_PROJECT_ID)
      expect(member!.identityString.length).toBeLessThanOrEqual(CAST_IDENTITY_MAX)
      expect(long.startsWith(member!.identityString)).toBe(true)
      expect((await castNotices(id)).map((notice) => notice.message)).toEqual([
        'Trimmed to fit: the identity.',
      ])

      callLlm.mockResolvedValueOnce(identity('Emad Mostaque, founder: oval face'))
      expect(await describeCastMemberAction(id)).toEqual({ ok: true })
      expect(await castNotices(id)).toEqual([])
    })

    it("reports no trimmed guardrail when the producer's own guardrail is kept", async () => {
      const id = await addEmad()
      await withPhoto(id)
      await updateCastMemberAction(id, { guardrail: 'never in handcuffs' })
      callLlm.mockResolvedValueOnce(
        identity('Emad Mostaque, founder: oval face', 'never mocked; never in handcuffs; '.repeat(25)),
      )

      expect(await describeCastMemberAction(id)).toEqual({ ok: true })
      expect((await listCastMembers(db, FIXTURE_PROJECT_ID))[0]?.guardrail).toBe(
        'never in handcuffs',
      )
      expect(await castNotices(id)).toEqual([])
    })

    it('says why in the toast when the description stops, as before', async () => {
      const id = await addEmad()
      await withPhoto(id)
      callLlm.mockResolvedValue({ text: 'no json here' })

      const result = await describeCastMemberAction(id)
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/^The model returned no JSON for cast identity/)
      expect(callLlm).toHaveBeenCalledTimes(2)
      expect((await listCastMembers(db, FIXTURE_PROJECT_ID))[0]?.identityString).toBe('stale')
    })

    it('keeps a refusal at the call in its own words, though the helper wraps it for Inngest', async () => {
      const id = await addEmad()
      await withPhoto(id)
      callLlm.mockRejectedValue(
        new ValidationError('The Anthropic key was rejected', { field: 'apiKey' }),
      )

      expect(await describeCastMemberAction(id)).toEqual({
        ok: false,
        error: 'The Anthropic key was rejected',
      })
      expect(callLlm).toHaveBeenCalledTimes(1)
    })

    it('after an upload, says the photo is saved when the description could not be written', async () => {
      const id = await addEmad()
      // A revived row keeps its text; the first photo writes it only when empty.
      await updateCastMemberAction(id, { identityString: '', guardrail: '' })
      callLlm.mockResolvedValue({ text: 'no json here' })

      const uploaded = await finaliseCastPhotoAction({
        memberId: id,
        mimeType: 'image/jpeg',
        contentHash: HASH_A,
        width: 1200,
        height: 1600,
        view: 'front',
      })
      expect(uploaded.ok).toBe(false)
      expect(uploaded.error).toMatch(
        /^The photo is saved, but the description could not be written: The model returned no JSON/,
      )

      const fromUrl = await addCastPhotoFromUrlAction({
        memberId: id,
        url: 'https://example.com/emad.jpg',
        view: 'profile',
      })
      expect(fromUrl.ok).toBe(false)
      expect(fromUrl.error).toMatch(/^The photo is saved, but the description could not be written: /)

      const [member] = await listCastMembers(db, FIXTURE_PROJECT_ID)
      expect(member?.photos).toHaveLength(2)
      expect(member?.identityString).toBe('')
    })
  })
```

`addEmad`, `HASH_A` and the storage and remote-image mocks are the file's own. The outer `beforeEach` stubs mock mode and removes the cast; this block's `beforeEach` runs after it and switches to the live path with the model call replaced.

- [ ] **Step 7: Run them to see them fail**

Run: `cd apps/web && pnpm exec vitest run "app/(console)/projects/[id]/cast-actions.test.ts"` (Bash `timeout: 600000`, alone)
Expected: FAIL. One call with no retry, an identity over 600 characters refused, no notice, the rejected key shown as the fallback, and the upload saying `The photo could not be recorded.`

- [ ] **Step 8: Put the describe call on the helper and fix the upload message**

In `apps/web/app/(console)/projects/[id]/cast-actions.ts`, replace the `@boom-busters/providers` imports (lines 12 to 18) with:

```ts
import {
  buildCastIdentityRequest,
  GUARDRAIL_LABEL,
  mockCastIdentity,
  mockProvidersEnabled,
  parseCastIdentity,
} from '@boom-busters/providers'
import type { MsgImage, Repair } from '@boom-busters/providers'
```

replace `import type { CastMember, CastPhoto } from '@boom-busters/schemas'` (line 29) with `import type { CastMember, CastPhoto, NoticeTarget } from '@boom-busters/schemas'`, and replace:

```ts
import { db } from '@/lib/db'
import { callLlm } from '@/lib/llm'
```

(lines 33 and 34) with:

```ts
import { callForAnswer } from '@/lib/answer'
import { completeForProject } from '@/lib/answer-call'
import { db } from '@/lib/db'
import { recordRepairs } from '@/lib/notices'
```

In `failure` (lines 82 to 91), after `  if (error instanceof ValidationError) return { ok: false, error: error.message }` add:

```ts
  // A refusal at the call (a rejected key, say) arrives wrapped for Inngest by
  // the answer helper (decision 292); its words are still the owner's to read.
  if (error instanceof Error && error.cause instanceof ValidationError) {
    return { ok: false, error: error.cause.message }
  }
```

In `finaliseCastPhotoAction`, replace (lines 270 to 279):

```ts
  try {
    const updated = await setCastPhotos(db, member.id, [...member.photos, photo])
    // The first photo writes the identity string; later ones do not overwrite
    // what the producer may have edited.
    if (updated.identityString.trim() === '') await describeFromPhotos(updated)
    refresh(member.projectId)
    return { ok: true }
  } catch (error) {
    return failure(error, 'The photo could not be recorded.')
  }
```

with:

```ts
  let updated: CastMember
  try {
    updated = await setCastPhotos(db, member.id, [...member.photos, photo])
  } catch (error) {
    return failure(error, 'The photo could not be recorded.')
  }
  // The first photo writes the identity string; later ones do not overwrite
  // what the producer may have edited.
  const described: ActionResult =
    updated.identityString.trim() === '' ? await describeAfterUpload(updated) : { ok: true }
  refresh(member.projectId)
  return described
```

In `addCastPhotoFromUrlAction`, replace (lines 346 to 353):

```ts
  try {
    const updated = await setCastPhotos(db, member.id, [...member.photos, photo])
    if (updated.identityString.trim() === '') await describeFromPhotos(updated)
    refresh(member.projectId)
    return { ok: true }
  } catch (error) {
    return failure(error, 'The photo could not be recorded.')
  }
```

with:

```ts
  let updated: CastMember
  try {
    updated = await setCastPhotos(db, member.id, [...member.photos, photo])
  } catch (error) {
    return failure(error, 'The photo could not be recorded.')
  }
  const described: ActionResult =
    updated.identityString.trim() === '' ? await describeAfterUpload(updated) : { ok: true }
  refresh(member.projectId)
  return described
```

Replace `describeFromPhotos` with its comment (lines 396 to 418) with:

```ts
// Not exported: a 'use server' module may only export async functions that
// are actions; this is shared machinery.
async function describeFromPhotos(member: CastMember): Promise<void> {
  const target: NoticeTarget = {
    projectId: member.projectId,
    subject: 'cast',
    subjectId: member.id,
  }
  let written: { identityString: string; guardrail: string }
  let repairs: Repair[] = []
  if (mockProvidersEnabled()) {
    written = mockCastIdentity({ name: member.name, role: member.role })
  } else {
    // At most two calls, the second told what was wrong (decision 293). A
    // stop is thrown as the parser's refusal always was, so the toast says why.
    const answer = await callForAnswer({
      request: buildCastIdentityRequest({
        name: member.name,
        role: member.role,
        photos: await loadPhotos(member),
      }),
      parse: parseCastIdentity,
      complete: completeForProject(member.projectId),
    })
    if (!answer.ok) throw new ValidationError(answer.issue, { field: 'identityString' })
    written = answer.value
    repairs = answer.repairs ?? []
  }
  // A guardrail the producer already wrote is theirs; only fill an empty one.
  const keepsGuardrail = member.guardrail.trim() !== ''
  await updateCastMember(db, member.id, {
    identityString: written.identityString,
    ...(keepsGuardrail ? {} : { guardrail: written.guardrail }),
  })
  // The notice says only what reached the card: a trimmed guardrail the
  // producer's own replaced is not news.
  await recordRepairs(
    target,
    keepsGuardrail ? repairs.filter((repair) => repair.field !== GUARDRAIL_LABEL) : repairs,
  )
}

/**
 * The describe step after an upload (decision 293). The photo is stored
 * whatever happens here, so a failure says so instead of reading as a failed
 * upload; Describe from photos is the way to try again.
 */
async function describeAfterUpload(member: CastMember): Promise<ActionResult> {
  try {
    await describeFromPhotos(member)
    return { ok: true }
  } catch (error) {
    const reason = failure(error, 'the request to the model failed').error
    return {
      ok: false,
      error: `The photo is saved, but the description could not be written: ${reason}`,
    }
  }
}
```

Both helpers stay unexported. `refresh` now runs before an upload's describe failure is returned too, so the page shows the stored photo although the card's `act` does not refresh on a failure.

- [ ] **Step 9: Run the action tests**

Run: `cd apps/web && pnpm exec vitest run "app/(console)/projects/[id]/cast-actions.test.ts"` (Bash `timeout: 600000`, alone)
Expected: PASS, the existing mock-mode tests unchanged and the 6 new ones.

- [ ] **Step 10: Write the failing card test**

In `apps/web/app/(console)/projects/[id]/cast-card.test.tsx`, replace `import type { CastMember } from '@boom-busters/schemas'` (line 4) with `import type { CastMember, Notice } from '@boom-busters/schemas'`. After the toast mock (line 39), add:

```ts
// The notice's Dismiss is a server action whose module loads next-auth,
// which cannot load under jsdom.
vi.mock('@/app/(console)/notice-actions', () => ({ dismissNoticeAction: vi.fn() }))
```

Before the final `})` of `describe('CastCard', ...)`, add:

```tsx
  it("shows a member's notice in that member's row, opening the card for it (decision 293)", () => {
    const prem: CastMember = {
      ...emad,
      id: '01J0000000000000000000000C',
      name: 'Prem Akkaraju',
      role: 'CEO from 2024',
    }
    const trimmed: Notice = {
      id: '01J0000000000000000000000N',
      projectId: PROJECT,
      subject: 'cast',
      subjectId: MEMBER,
      kind: 'trimmed',
      message: 'Trimmed to fit: the identity.',
      createdAt: new Date('2026-10-09T10:00:00Z'),
    }
    render(
      <CastCard projectId={PROJECT} members={[emad, prem]} photoUrls={{}} notices={[trimmed]} />,
    )

    // Everyone has a photo, yet the card opens: the note sits on the row.
    expect(screen.queryByRole('list', { name: 'Cast members' })).not.toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'Emad Mostaque' })).getByRole('status'),
    ).toHaveTextContent('Trimmed to fit: the identity.')
    expect(
      within(screen.getByRole('region', { name: 'Prem Akkaraju' })).queryByRole('status'),
    ).not.toBeInTheDocument()
  })
```

Run: `cd apps/web && pnpm exec vitest run "app/(console)/projects/[id]/cast-card.test.tsx"`
Expected: FAIL, `notices` is not a prop yet; the card stays collapsed and shows no notice.

- [ ] **Step 11: Render each member's notices on the cast card**

In `apps/web/app/(console)/projects/[id]/cast-card.tsx`, replace:

```tsx
import { CAST_PHOTO_VIEWS, MAX_CAST_PHOTOS } from '@boom-busters/schemas'
import type { CastMember, CastPhotoView } from '@boom-busters/schemas'
```

(lines 5 and 6) with:

```tsx
import { CAST_PHOTO_VIEWS, MAX_CAST_PHOTOS, noticesFor } from '@boom-busters/schemas'
import type { CastMember, CastPhotoView, Notice } from '@boom-busters/schemas'
```

and after `import { ConfirmButton } from '@/components/confirm-button'` (line 11) add `import { Notices } from '@/components/notices'`.

In `CastCardProps`, after `  restorable?: readonly string[]` (line 63) add:

```ts
  /**
   * The project's open notices (decision 293); each member's row shows its
   * own, such as an identity the describe call trimmed to fit.
   */
  notices?: readonly Notice[]
```

Replace `export function CastCard({ projectId, members, photoUrls, restorable = [] }: CastCardProps) {` (line 66) with:

```tsx
export function CastCard({
  projectId,
  members,
  photoUrls,
  restorable = [],
  notices = [],
}: CastCardProps) {
```

Replace the `open` state (lines 70 to 72):

```tsx
  const [open, setOpen] = React.useState(
    members.length === 0 || members.some((member) => member.photos.length === 0),
  )
```

with:

```tsx
  // Open while anyone still needs a photo or has a notice to read: both sit
  // on the member's row, which only the open card shows.
  const [open, setOpen] = React.useState(
    members.length === 0 ||
      members.some((member) => member.photos.length === 0) ||
      members.some((member) => noticesFor(notices, 'cast', member.id).length > 0),
  )
```

In the open view, replace:

```tsx
              <MemberRow
                key={member.id}
                member={member}
                photoUrls={photoUrls}
```

with:

```tsx
              <MemberRow
                key={member.id}
                member={member}
                notices={noticesFor(notices, 'cast', member.id)}
                photoUrls={photoUrls}
```

Replace the `MemberRow` signature (lines 216 to 226) with:

```tsx
function MemberRow({
  member,
  notices,
  photoUrls,
  busy,
  act,
}: {
  member: CastMember
  notices: readonly Notice[]
  photoUrls: Readonly<Record<string, string>>
  busy: string | null
  act: Act
}) {
```

and directly before the Identity string block (`      <div className="space-y-1">` followed by `<Label htmlFor={`cast-${member.id}-identity`}>Identity string</Label>`, line 436) add:

```tsx
      <Notices notices={notices} />

```

- [ ] **Step 12: Pass the notices from the project page**

In `apps/web/app/(console)/projects/[id]/page.tsx`, in the `<CastCard` element, after `restorable={restorableCast}` add `notices={notices}` (Task 3's value; the card picks each member's own).

- [ ] **Step 13: Run the card test, the consumers and the typecheck**

Run: `cd apps/web && pnpm exec vitest run "app/(console)/projects/[id]/cast-card.test.tsx"`
Expected: PASS (the existing 11 tests and the new one).

Then, because the cast schema, prompt and parser changed (each with the Bash `timeout: 600000`, one database run at a time): `cd packages/providers && pnpm test`; `cd packages/schemas && pnpm test`; `cd packages/db && pnpm exec vitest run src/cast.integration.test.ts` (database, alone); `pnpm typecheck` from the root.
Expected: all PASS; typecheck clean. A grep for `IDENTITY_MAX_CHARS` across `apps` and `packages` finds nothing.

- [ ] **Step 14: Format, lint and commit**

Run from the root: `pnpm exec prettier --write` then `--check` on the files below, then `pnpm exec eslint --max-warnings 0` on them.

```bash
git add packages/schemas/src/cast.ts packages/providers/src/prompts/cast-identity.ts packages/providers/src/prompts/cast-identity.test.ts "apps/web/app/(console)/projects/[id]/cast-actions.ts" "apps/web/app/(console)/projects/[id]/cast-actions.test.ts" "apps/web/app/(console)/projects/[id]/cast-card.tsx" "apps/web/app/(console)/projects/[id]/cast-card.test.tsx" "apps/web/app/(console)/projects/[id]/page.tsx"
git commit -F <message file>
```

Message: `feat(cast): the identity states its limits in characters, retries once, and a trim shows on the member's card (decision 293)` plus the trailer.

---

### Task 11: Re-brief, redirect and retype

> **Order note.** Task 4 has already edited the `markSideJobFailed` lines in `slot-rebriefer.ts`, `slot-redirector.ts` and `slot-retyper.ts` (each gained a `slotSubject(slotId)` argument), and Task 5 has already added the `notices` prop to `VisualBoard` and the `notice-actions` mock to `visual-board.test.tsx`. Match the anchors below against the files as they are after those tasks.

**Files:**
- Modify: `packages/schemas/src/visuals.ts` (three constants before `MapLocationSchema`, line 234; `MapBriefSchema` line 244; `GraphicBriefSchema` lines 295 and 297; `PlannedGraphicBriefSchema` lines 743 to 744)
- Modify: `packages/providers/src/prompts/shotlist.ts` (import, lines 1 to 9; `GRAPHIC_INTENT_RULES`, lines 51 to 57)
- Modify: `packages/providers/src/prompts/retype.ts` (imports, lines 1 to 8; the map shape, line 79; `parseRetypedBrief`, lines 137 to 179)
- Modify: `packages/providers/src/prompts/rebrief.ts` (imports, lines 1 to 8; `parseRebriefedBrief`, lines 145 to 171)
- Modify: `packages/providers/src/prompts/redirect.ts` (imports, lines 1 to 7; `parseRedirectedBrief`, lines 54 to 75)
- Test: `packages/providers/src/prompts/retype.test.ts`, `packages/providers/src/prompts/rebrief.test.ts`, `packages/providers/src/prompts/redirect.test.ts`, `packages/providers/src/prompts/shotlist.test.ts` (one existing assertion, line 277)
- Modify: `apps/web/inngest/functions/slot-rebriefer.ts` (import, line 34; `draft-brief` body, lines 188 to 266)
- Modify: `apps/web/inngest/functions/slot-redirector.ts` (imports, lines 23 and 28; `redirect-brief` body, lines 92 to 126)
- Modify: `apps/web/inngest/functions/slot-retyper.ts` (imports, lines 16 and 31; `convert-brief` body, lines 127, 153 to 204 and 207)
- Test: `apps/web/inngest/functions/slot-rebriefer.test.ts`, `apps/web/inngest/functions/slot-redirector.test.ts`, `apps/web/inngest/functions/slot-retyper.test.ts` (all database tests: run each alone)
- Modify: `apps/web/app/(console)/projects/[id]/visual-board.tsx` (imports, lines 18 to 44; `VisualBoardContent` props, lines 1500 to 1514; the `SlotCard` call, lines 2029 to 2045; `SlotCard` props, lines 2191 to 2224; before the format picker, line 2435)
- Modify: `apps/web/app/(console)/projects/[id]/page.tsx` (the `VisualBoard` element, lines 495 to 512)
- Test: `apps/web/app/(console)/projects/[id]/visual-board.test.tsx`

**Interfaces:**
- Consumes: `AnswerDeclined`, `Notice`, `noticesFor` (Task 1, `@boom-busters/schemas`); `Note`, `Repair`, `ignoreRepairs`, `trimField`, `capList` (Task 1, `packages/providers/src/prompts/repair.ts`); `callForAnswer`, `Answer<T>` (Task 1, `@/lib/answer`); `completeForProject(projectId)` (stage 1, `@/lib/answer-call`); `recordRepairs(target, repairs?)` (Task 3, `@/lib/notices`); `Notices` (Task 3, `@/components/notices`); `page.tsx`'s `notices` (Task 3); in tests, `addNotice`, `listProjectNotices` and the `notices` table (Task 2, `@boom-busters/db`).
- Produces:
  - `@boom-busters/schemas`: `GRAPHIC_INTENT_MAX = 300`, `GRAPHIC_INTENT_REFS_MAX = 6`, `MAP_LOCATIONS_MAX = 8`.
  - `@boom-busters/providers`: `parseRebriefedBrief(text: string, original: RebriefableBrief, _note: Note = ignoreRepairs): ShotBrief`; `parseRetypedBrief(text: string, input: { targetType; claims; logos? }, note: Note = ignoreRepairs): ShotBrief`; `parseRedirectedBrief(text: string, original: StillBrief, _note: Note = ignoreRepairs): StillBrief`. The re-brief and retype parsers throw `AnswerDeclined(<the model's reason>)` for an `{"error": ...}` answer.
  - `VisualBoard` gains `notices?: readonly Notice[]` (the project's open notices, default `[]`); each `SlotCard` renders `noticesFor(notices, 'slot', slot.id)`.
  - No step result gains a field: every notice is written inside the step that received the answer, so no replay test is needed here.

- [ ] **Step 1: Write the failing parser tests**

In `packages/providers/src/prompts/retype.test.ts`, change the imports at the top to:

```ts
import { AnswerDeclined, GRAPHIC_INTENT_MAX, ShotBriefSchema, ValidationError } from '@boom-busters/schemas'
import type { ShotBrief } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import type { Repair } from './repair'
import { buildRetypeRequest, mockRetypedBrief, parseRetypedBrief } from './retype'
import { GRAPHIC_INTENT_RULES } from './shotlist'
```

Change the existing assertion at line 100 from

```ts
    expect(GRAPHIC_INTENT_RULES).toMatch(/"intentRefs" lists at most six claim numbers/)
```

to

```ts
    expect(GRAPHIC_INTENT_RULES).toMatch(/"intentRefs" lists at most 6 claim numbers/)
```

and append to the file:

```ts
describe('the retype limits (decision 293)', () => {
  const collect = () => {
    const notes: Repair[] = []
    return {
      notes,
      note: (repair: Repair) => {
        notes.push(repair)
      },
    }
  }

  const graphic = (over: Record<string, unknown>) =>
    JSON.stringify({
      brief: {
        type: 'graphic',
        coversText: still.coversText,
        description: still.description,
        motion: { kind: 'static' },
        transition: 'cut',
        intent: 'The price, collapsing.',
        intentRefs: [1],
        ...over,
      },
    })

  /** Seven claim ids, numbered 1 to 7 as the prompt's claim list numbers them. */
  const sevenClaims = Array.from({ length: 7 }, (_, at) => ({ id: `01HQ0000000000000000000${at}AA` }))

  it("states the graphic's and the map's limits in the prompt", () => {
    const forGraphic = buildRetypeRequest({
      caseTitle: 'Wirecard',
      brief: still,
      targetType: 'graphic',
      claims,
    }).system.replace(/\s+/g, ' ')
    expect(forGraphic).toContain('"intentRefs" lists at most 6 claim numbers')
    expect(forGraphic).toContain('"intent" is at most 300 characters')

    const forMap = buildRetypeRequest({
      caseTitle: 'Wirecard',
      brief: still,
      targetType: 'map',
      claims,
    }).system
    expect(forMap).toContain('"locations": [{"label", "lat": number, "lon": number}] (1-8 entries)')
  })

  it("trims a graphic's intent over its limit at a sentence, and says so", () => {
    const { notes, note } = collect()
    const brief = parseRetypedBrief(
      graphic({ intent: 'The price collapsed in nine days. '.repeat(12) }),
      { targetType: 'graphic', claims: [{ id: CLAIM_A }] },
      note,
    )
    const intent = (brief as { intent: string }).intent
    expect(intent.length).toBeLessThanOrEqual(GRAPHIC_INTENT_MAX)
    expect(intent.endsWith('in nine days.')).toBe(true)
    // The claim it rests on is a fact: untouched.
    expect(brief).toMatchObject({ intentClaimIds: [CLAIM_A] })
    expect(notes).toEqual([{ action: 'trimmed', field: "the graphic's intent" }])
  })

  it("keeps a graphic's first six references, in the order the model gave them", () => {
    const { notes, note } = collect()
    const brief = parseRetypedBrief(
      graphic({ intentRefs: [7, 6, 5, 4, 3, 2, 1] }),
      { targetType: 'graphic', claims: sevenClaims },
      note,
    )
    expect((brief as { intentClaimIds: string[] }).intentClaimIds).toEqual(
      [7, 6, 5, 4, 3, 2].map((number) => sevenClaims[number - 1]!.id),
    )
    expect(notes).toEqual([{ action: 'capped', field: "of the graphic's references", kept: 6 }])
  })

  it("keeps a map's first eight places with their coordinates as given", () => {
    const { notes, note } = collect()
    const places = Array.from({ length: 9 }, (_, at) => ({
      label: `City ${at + 1}`,
      lat: 10 + at,
      lon: 20 + at,
    }))
    const text = JSON.stringify({
      brief: {
        type: 'map',
        coversText: still.coversText,
        description: still.description,
        motion: { kind: 'static' },
        transition: 'cut',
        locations: places,
        route: true,
      },
    })
    const brief = parseRetypedBrief(text, { targetType: 'map', claims: [] }, note)
    expect((brief as { locations: unknown[] }).locations).toEqual(places.slice(0, 8))
    expect(notes).toEqual([{ action: 'capped', field: "of the map's places", kept: 8 }])
  })

  it('notes nothing for a brief within its limits', () => {
    const { notes, note } = collect()
    parseRetypedBrief(graphic({}), { targetType: 'graphic', claims: [{ id: CLAIM_A }] }, note)
    expect(notes).toEqual([])
  })

  it("throws the model's own reason as a decline, which the answer helper takes as final", () => {
    const declining = () =>
      parseRetypedBrief(JSON.stringify({ error: 'No sourced numbers cover this beat.' }), {
        targetType: 'chart',
        claims: [{ id: CLAIM_A }],
      })
    expect(declining).toThrow(AnswerDeclined)
    expect(declining).toThrow(/^No sourced numbers cover this beat\.$/)
  })
})
```

In `packages/providers/src/prompts/shotlist.test.ts`, change the existing assertion at line 277 from

```ts
    expect(GRAPHIC_INTENT_RULES).toMatch(/"intentRefs" lists at most six claim numbers/)
```

to

```ts
    expect(GRAPHIC_INTENT_RULES).toMatch(/"intentRefs" lists at most 6 claim numbers/)
```

In `packages/providers/src/prompts/rebrief.test.ts`, change the first import to `import { AnswerDeclined, ShotBriefSchema } from '@boom-busters/schemas'`, add `import type { Repair } from './repair'`, and append:

```ts
describe('a deliberate decline (decision 293)', () => {
  it("throws the model's own reason as a decline, which the answer helper takes as final", () => {
    const declining = () =>
      parseRebriefedBrief(JSON.stringify({ error: 'This beat has only one honest image.' }), stock)
    expect(declining).toThrow(AnswerDeclined)
    expect(declining).toThrow(/^This beat has only one honest image\.$/)
  })

  it('takes a note, and an idea has no limit to repair', () => {
    const notes: Repair[] = []
    const parsed = parseRebriefedBrief(JSON.stringify({ brief: mockRebriefedBrief(stock) }), stock, (repair) => {
      notes.push(repair)
    })
    expect(parsed.type).toBe('stock')
    expect(notes).toEqual([])
  })
})
```

In `packages/providers/src/prompts/redirect.test.ts`, add `import type { Repair } from './repair'` and append inside `describe('parseRedirectedBrief', ...)`:

```ts
  it('takes a note, and a redirected still has no limit to repair (decision 293)', () => {
    const notes: Repair[] = []
    const parsed = parseRedirectedBrief(JSON.stringify({ brief: mockRedirectedBrief(brief) }), brief, (repair) => {
      notes.push(repair)
    })
    expect(parsed.coversText).toBe(brief.coversText)
    expect(notes).toEqual([])
  })
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/providers && pnpm exec vitest run src/prompts/retype.test.ts src/prompts/rebrief.test.ts src/prompts/redirect.test.ts src/prompts/shotlist.test.ts`
Expected: FAIL. `GRAPHIC_INTENT_MAX` is not exported; the prompts still say "six"; the long intent, the seven references and the nine places are refused as malformed; both declines throw a plain `ValidationError`, and the retype one reads "The model declined the conversion: ...". The two note tests on the re-brief and redirect parsers fail only on the type of the third argument (TypeScript), so they may pass at run time.

- [ ] **Step 3: Add the limits to the visuals schema**

In `packages/schemas/src/visuals.ts`, directly before `export const MapLocationSchema = z.object({` (line 234):

```ts
/**
 * The limits a drafted graphic or map is checked against (decision 293): one
 * source for the schema, the retype prompt that states them and the repair
 * that trims and caps to them.
 */
export const GRAPHIC_INTENT_MAX = 300
export const GRAPHIC_INTENT_REFS_MAX = 6
export const MAP_LOCATIONS_MAX = 8
```

Then use them:
- line 244, in `MapBriefSchema`: `locations: z.array(MapLocationSchema).min(1).max(8),` becomes `locations: z.array(MapLocationSchema).min(1).max(MAP_LOCATIONS_MAX),`
- line 295, in `GraphicBriefSchema`: `intent: z.string().trim().min(1).max(300).optional(),` becomes `intent: z.string().trim().min(1).max(GRAPHIC_INTENT_MAX).optional(),`
- line 297, in `GraphicBriefSchema`: `intentClaimIds: z.array(UlidSchema).max(6).optional(),` becomes `intentClaimIds: z.array(UlidSchema).max(GRAPHIC_INTENT_REFS_MAX).optional(),`
- lines 743 to 744, in `PlannedGraphicBriefSchema`:

```ts
  intent: z.string().trim().min(1).max(300),
  intentRefs: z.array(z.number().int().min(1)).max(6).default([]),
```

become

```ts
  intent: z.string().trim().min(1).max(GRAPHIC_INTENT_MAX),
  intentRefs: z.array(z.number().int().min(1)).max(GRAPHIC_INTENT_REFS_MAX).default([]),
```

- [ ] **Step 4: State the limits in the prompts**

In `packages/providers/src/prompts/shotlist.ts`, add `GRAPHIC_INTENT_MAX,` and `GRAPHIC_INTENT_REFS_MAX,` to the value import from `@boom-busters/schemas` (lines 1 to 9). In `GRAPHIC_INTENT_RULES` (lines 56 to 57), replace

```ts
  "intentRefs". "intentRefs" lists at most six claim numbers: the claims its figures or names
  come from, most important first. "intent" is at most 300 characters.`
```

with

```ts
  "intentRefs". "intentRefs" lists at most ${GRAPHIC_INTENT_REFS_MAX} claim numbers: the claims its figures or names
  come from, most important first. "intent" is at most ${GRAPHIC_INTENT_MAX} characters.`
```

The shot list prompt shares this text (`shotlist.ts:362`), so it now says "6" too; the two existing assertions changed in Step 1 are the only ones on it.

In `packages/providers/src/prompts/retype.ts`, replace line 79

```ts
   "locations": [{"label", "lat": number, "lon": number}] (1-8 entries),
```

with

```ts
   "locations": [{"label", "lat": number, "lon": number}] (1-${MAP_LOCATIONS_MAX} entries),
```

- [ ] **Step 5: Repair the retyped brief, and make a decline final**

In `packages/providers/src/prompts/retype.ts`, the imports (lines 1 to 8) become:

```ts
import {
  AnswerDeclined,
  GRAPHIC_INTENT_MAX,
  GRAPHIC_INTENT_REFS_MAX,
  MAP_LOCATIONS_MAX,
  PlannedBriefSchema,
  resolvePlannedBrief,
  ValidationError,
} from '@boom-busters/schemas'
import type { LogoIndex, PlanningClaim, ShotBrief, ShotSlotType } from '@boom-busters/schemas'
import { z } from 'zod'
import { claimList, type ScriptClaim } from './script'
import { formatIssues, parseJsonCompletion } from './json'
import { capList, ignoreRepairs, trimField } from './repair'
import type { Note } from './repair'
import { GRAPHIC_INTENT_RULES, GRAPHIC_INTENT_SHAPE } from './shotlist'
import { outputBudget } from '../llm/types'
import type { LLMTaskRequest } from '../llm/types'
```

Replace `parseRetypedBrief` and the lines before it from `const RetypeEnvelopeSchema = z.union([` (line 137) through the function's closing brace (line 179) with:

```ts
const RetypeEnvelopeSchema = z.union([
  z.object({ brief: z.unknown() }),
  z.object({ error: z.string().min(1) }),
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The drafted brief, repaired before it is validated (decision 293): a
 * graphic's intent over its limit is trimmed at a sentence, and a graphic's
 * references or a map's places past their caps keep their first items, which
 * the prompt asks to come most important first. Claim numbers, coordinates
 * and labels are never edited: they carry facts, and a bad one is refused.
 * The labels are the owner's words on the slot card.
 */
function repairRetypedBrief(brief: unknown, note: Note): unknown {
  if (!isRecord(brief)) return brief
  if (brief['type'] === 'graphic') {
    return {
      ...brief,
      intent: trimField(brief['intent'], GRAPHIC_INTENT_MAX, "the graphic's intent", note),
      intentRefs: capList(
        brief['intentRefs'],
        GRAPHIC_INTENT_REFS_MAX,
        "of the graphic's references",
        note,
      ),
    }
  }
  if (brief['type'] === 'map') {
    return {
      ...brief,
      locations: capList(brief['locations'], MAP_LOCATIONS_MAX, "of the map's places", note),
    }
  }
  return brief
}

export function parseRetypedBrief(
  text: string,
  input: {
    targetType: RetypeInput['targetType']
    claims: readonly PlanningClaim[]
    /** The logo library's index (decision 268, Plan B), for a graphic's "logo" elements. */
    logos?: readonly LogoIndex[]
  },
  note: Note = ignoreRepairs,
): ShotBrief {
  const envelope = parseJsonCompletion(text, RetypeEnvelopeSchema, 'retyped brief')

  // The model's own "this beat cannot honestly be one" (decision 293): final,
  // and shown in its words, since asking again buys the same honest no.
  if ('error' in envelope) {
    throw new AnswerDeclined(envelope.error, { field: 'retyped brief' })
  }

  const parsed = PlannedBriefSchema.safeParse(repairRetypedBrief(envelope.brief, note))
  if (!parsed.success) {
    throw new ValidationError(`The retyped brief is malformed: ${formatIssues(parsed.error)}`, {
      field: 'retyped brief',
    })
  }
  if (parsed.data.type !== input.targetType) {
    throw new ValidationError(`Asked for a ${input.targetType} brief, got "${parsed.data.type}".`, {
      field: 'retyped brief',
    })
  }

  const resolved = resolvePlannedBrief(parsed.data, input.claims, input.logos ?? [])
  if (!resolved) {
    throw new ValidationError(
      `The retyped ${input.targetType} cites claim numbers that do not exist in this project.`,
      { field: 'retyped brief' },
    )
  }
  return resolved
}
```

The labels read with Task 1's `describeRepairs` as "Trimmed to fit: the graphic's intent.", "Kept the first 6 of the graphic's references." and "Kept the first 8 of the map's places."

- [ ] **Step 6: The re-brief and redirect parsers take a note, and the re-brief's decline is final**

In `packages/providers/src/prompts/rebrief.ts`, line 1 becomes

```ts
import { AnswerDeclined, renderDirectorsBook, ShotBriefSchema, ValidationError } from '@boom-busters/schemas'
```

add after the `./json` import (line 5):

```ts
import { ignoreRepairs } from './repair'
import type { Note } from './repair'
```

and replace lines 147 to 151:

```ts
export function parseRebriefedBrief(text: string, original: RebriefableBrief): ShotBrief {
  const envelope = parseJsonCompletion(text, Envelope, 'new brief')
  if ('error' in envelope) {
    throw new ValidationError(envelope.error, { field: 'new brief' })
  }
```

with

```ts
/**
 * `_note` keeps the parser's shape for the answer helper (decision 293):
 * nothing in an idea's brief has a length limit to break, so nothing is
 * repaired here.
 */
export function parseRebriefedBrief(
  text: string,
  original: RebriefableBrief,
  _note: Note = ignoreRepairs,
): ShotBrief {
  const envelope = parseJsonCompletion(text, Envelope, 'new brief')
  // The model's own "no other image is worth cutting to" (decision 293):
  // final, and shown in its words.
  if ('error' in envelope) {
    throw new AnswerDeclined(envelope.error, { field: 'new brief' })
  }
```

In `packages/providers/src/prompts/redirect.ts`, add after the `./json` import (line 5):

```ts
import { ignoreRepairs } from './repair'
import type { Note } from './repair'
```

and replace line 56

```ts
export function parseRedirectedBrief(text: string, original: StillBrief): StillBrief {
```

with

```ts
/**
 * `_note` keeps the parser's shape for the answer helper (decision 293): a
 * still's brief has no length limit a redirect can break, so nothing is
 * repaired here.
 */
export function parseRedirectedBrief(
  text: string,
  original: StillBrief,
  _note: Note = ignoreRepairs,
): StillBrief {
```

- [ ] **Step 7: Run the parser tests, then the consuming suites**

Run: `cd packages/providers && pnpm exec vitest run src/prompts/retype.test.ts src/prompts/rebrief.test.ts src/prompts/redirect.test.ts src/prompts/shotlist.test.ts`
Expected: PASS, including the 9 new tests.

Then, because a shared schema and a shared prompt changed: `cd packages/schemas && pnpm test`, `cd packages/providers && pnpm test`, and `pnpm typecheck` from the root (each with `timeout: 600000`).
Expected: PASS; typecheck clean. (The web consumers of these parsers are changed and run in Steps 9 to 15.)

- [ ] **Step 8: Commit the parsers**

```bash
pnpm exec prettier --write packages/schemas/src/visuals.ts packages/providers/src/prompts/shotlist.ts packages/providers/src/prompts/retype.ts packages/providers/src/prompts/rebrief.ts packages/providers/src/prompts/redirect.ts packages/providers/src/prompts/retype.test.ts packages/providers/src/prompts/rebrief.test.ts packages/providers/src/prompts/redirect.test.ts packages/providers/src/prompts/shotlist.test.ts
pnpm exec prettier --check packages/schemas/src/visuals.ts packages/providers/src/prompts/shotlist.ts packages/providers/src/prompts/retype.ts packages/providers/src/prompts/rebrief.ts packages/providers/src/prompts/redirect.ts packages/providers/src/prompts/retype.test.ts packages/providers/src/prompts/rebrief.test.ts packages/providers/src/prompts/redirect.test.ts packages/providers/src/prompts/shotlist.test.ts
pnpm exec eslint --max-warnings 0 packages/schemas/src/visuals.ts packages/providers/src/prompts/shotlist.ts packages/providers/src/prompts/retype.ts packages/providers/src/prompts/rebrief.ts packages/providers/src/prompts/redirect.ts packages/providers/src/prompts/retype.test.ts packages/providers/src/prompts/rebrief.test.ts packages/providers/src/prompts/redirect.test.ts packages/providers/src/prompts/shotlist.test.ts
git add packages/schemas/src/visuals.ts packages/providers/src/prompts/shotlist.ts packages/providers/src/prompts/retype.ts packages/providers/src/prompts/rebrief.ts packages/providers/src/prompts/redirect.ts packages/providers/src/prompts/retype.test.ts packages/providers/src/prompts/rebrief.test.ts packages/providers/src/prompts/redirect.test.ts packages/providers/src/prompts/shotlist.test.ts
git commit -F <message file>
```

Message: `feat(visuals): the retype parser trims and caps to stated limits, and a model's decline is final (decision 293)` plus the trailer.

- [ ] **Step 9: Write the failing step tests (database)**

In `apps/web/inngest/functions/slot-rebriefer.test.ts`:
- add `addNotice,`, `listProjectNotices,` and `notices,` to the import from `@boom-busters/db`;
- add `import { ContentPolicyError, noticesFor } from '@boom-busters/schemas'` beside the type import from it;
- after the `vi.mock('@/lib/notify', ...)` block (line 41), add:

```ts
const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))
```

and append:

```ts
describeDb('slot-rebriefer on the answer helper (decision 293)', () => {
  let engine: InngestTestEngine

  async function seedOne(brief: ShotBrief): Promise<string> {
    await db.delete(shotSlots)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    const chapter = await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The audit',
      contentMd: 'By June, the auditors could not find the money.',
      estRuntimeSec: 30,
    })
    await replaceShotList(db, FIXTURE_PROJECT_ID, [
      { chapterId: chapter.id, index: 0, type: brief.type, brief, startMs: 0, durationMs: 8000 },
    ])
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'plan')
    const [slot] = await listShotSlots(db, FIXTURE_PROJECT_ID)
    return slot!.id
  }

  const slotNotices = async (slotId: string) =>
    noticesFor(await listProjectNotices(db, FIXTURE_PROJECT_ID), 'slot', slotId).map(
      ({ kind, message }) => ({ kind, message }),
    )

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: slotRebriefer })
    vi.clearAllMocks()
    callLlm.mockReset()
    vi.stubEnv('MOCK_PROVIDERS', '')
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
    await db.delete(notices)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('asks once more with the reason after a refused draft, then puts the reason on the card', async () => {
    const slotId = await seedOne(stockBrief)
    callLlm.mockResolvedValue({ text: 'not json at all' })

    const { result } = await engine.execute({ events: rebriefEvent(slotId) })

    expect(result).toMatchObject({ outcome: 'refused' })
    expect(callLlm).toHaveBeenCalledTimes(2)
    expect(callLlm.mock.calls[1]![1]).toMatchObject({ purpose: 'retry: refused' })
    expect(callLlm.mock.calls[1]![0].messages.at(-1).content).toContain(
      'Your previous answer was refused: The model returned no JSON for new brief.',
    )
    const slot = await getShotSlot(db, slotId)
    expect(slot?.retype).toEqual({
      state: 'rebrief-refused',
      reason: 'The model returned no JSON for new brief. It answered: not json at all',
    })
    expect((slot?.brief as { description: string }).description).toBe(stockBrief.description)
  })

  it("takes a decline in the model's own words as final, after one call", async () => {
    const slotId = await seedOne(stockBrief)
    callLlm.mockResolvedValue({
      text: JSON.stringify({ error: 'This beat has only one honest image.' }),
    })

    const { result } = await engine.execute({ events: rebriefEvent(slotId) })

    expect(result).toMatchObject({
      outcome: 'refused',
      reason: 'This beat has only one honest image.',
    })
    expect(callLlm).toHaveBeenCalledTimes(1)
    expect((await getShotSlot(db, slotId))?.retype).toEqual({
      state: 'rebrief-refused',
      reason: 'This beat has only one honest image.',
    })
  })

  it("takes the provider's content refusal as final, after one call", async () => {
    const slotId = await seedOne(stockBrief)
    callLlm.mockRejectedValue(new ContentPolicyError('google', 'SAFETY'))

    const { result } = await engine.execute({ events: rebriefEvent(slotId) })

    expect(result).toMatchObject({ outcome: 'refused', reason: 'google: SAFETY' })
    expect(callLlm).toHaveBeenCalledTimes(1)
    expect((await getShotSlot(db, slotId))?.retype).toEqual({
      state: 'rebrief-refused',
      reason: 'google: SAFETY',
    })
  })

  it("records what the repair capped on the slot's card", async () => {
    const map: ShotBrief = {
      type: 'map',
      coversText: stockBrief.coversText,
      description: 'Where the money went.',
      motion: { kind: 'static' },
      transition: 'cut',
      locations: [{ label: 'Munich', lat: 48.14, lon: 11.58 }],
      route: false,
    }
    const slotId = await seedOne(map)
    const places = Array.from({ length: 9 }, (_, at) => ({
      label: `City ${at + 1}`,
      lat: 10 + at,
      lon: 20 + at,
    }))
    callLlm.mockResolvedValue({
      text: JSON.stringify({
        brief: { ...map, description: 'Nine cities, one trail.', locations: places, route: true },
      }),
    })

    const { result } = await engine.execute({ events: rebriefEvent(slotId) })

    expect(result).toMatchObject({ outcome: 'rebriefed' })
    expect(callLlm).toHaveBeenCalledTimes(1)
    const brief = (await getShotSlot(db, slotId))?.brief as { locations: unknown[] }
    expect(brief.locations).toEqual(places.slice(0, 8))
    expect(await slotNotices(slotId)).toEqual([
      { kind: 'trimmed', message: "Kept the first 8 of the map's places." },
    ])
  })

  it("retires the slot's old notice when a clean brief lands", async () => {
    const slotId = await seedOne(stockBrief)
    await addNotice(
      db,
      { projectId: FIXTURE_PROJECT_ID, subject: 'slot', subjectId: slotId },
      { kind: 'stopped', message: 'The re-brief stopped: over budget.' },
    )
    callLlm.mockResolvedValue({
      text: JSON.stringify({
        brief: {
          ...stockBrief,
          description: 'A crowded trading floor at the open.',
          query: 'trading floor crowd',
        },
      }),
    })

    const { result } = await engine.execute({ events: rebriefEvent(slotId) })

    expect(result).toMatchObject({ outcome: 'rebriefed' })
    expect(await slotNotices(slotId)).toEqual([])
  })
})
```

In `apps/web/inngest/functions/slot-redirector.test.ts`:
- add `addNotice,`, `listProjectNotices,` and `notices,` to the import from `@boom-busters/db`;
- line 18 becomes `import { ContentPolicyError, newId, noticesFor } from '@boom-busters/schemas'`;
- after line 32 (`vi.mock('@/lib/notify', ...)`) add:

```ts
const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))
```

and append:

```ts
/** A still refused for a likeness, in plan phase; its id. */
async function seedRefusedLikeness(): Promise<string> {
  await db.delete(shotSlots)
  const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
  const chapter = await saveChapter(db, {
    scriptId: script.id,
    index: 0,
    title: 'The stage',
    contentMd: 'Braun took the stage.',
    estRuntimeSec: 30,
  })
  await replaceShotList(db, FIXTURE_PROJECT_ID, [
    { chapterId: chapter.id, index: 0, type: 'still', brief: likeness, startMs: 0, durationMs: 6000 },
  ])
  const [slot] = await listShotSlots(db, FIXTURE_PROJECT_ID)
  await setSlotRefusal(db, slot!.id, { reason: 'google: SAFETY', at: new Date().toISOString() })
  await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'plan')
  return slot!.id
}

describeDb('slot-redirector on the answer helper (decision 293)', () => {
  let engine: InngestTestEngine
  let slotId = ''

  const redirectEvent = () => [
    { name: 'visuals/redirect.requested', data: { projectId: FIXTURE_PROJECT_ID, slotId } },
  ]

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: slotRedirector })
    callLlm.mockReset()
    vi.stubEnv('MOCK_PROVIDERS', '')
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
    await db.delete(notices)
    slotId = await seedRefusedLikeness()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('asks once more with the reason, then keeps the refusal box with it', async () => {
    callLlm.mockResolvedValue({ text: 'not json at all' })

    const { result } = await engine.execute({ events: redirectEvent() })

    expect(result).toMatchObject({ outcome: 'refused' })
    expect(callLlm).toHaveBeenCalledTimes(2)
    expect(callLlm.mock.calls[1]![1]).toMatchObject({ purpose: 'retry: refused' })
    const slot = await getShotSlot(db, slotId)
    expect((slot?.refusal as { reason: string }).reason).toBe(
      'Redirect refused: The model returned no JSON for redirected brief. It answered: not json at all',
    )
    expect(slot?.brief).toMatchObject({ depicts: ['Markus Braun'] })
  })

  it("takes the provider's content refusal as final, after one call", async () => {
    callLlm.mockRejectedValue(new ContentPolicyError('google', 'SAFETY'))

    const { result } = await engine.execute({ events: redirectEvent() })

    expect(result).toMatchObject({ outcome: 'refused', reason: 'google: SAFETY' })
    expect(callLlm).toHaveBeenCalledTimes(1)
    expect(((await getShotSlot(db, slotId))?.refusal as { reason: string }).reason).toBe(
      'Redirect refused: google: SAFETY',
    )
  })

  it("retires the slot's old notice when a clean redirect lands", async () => {
    await addNotice(
      db,
      { projectId: FIXTURE_PROJECT_ID, subject: 'slot', subjectId: slotId },
      { kind: 'stopped', message: 'The redirect stopped: over budget.' },
    )
    callLlm.mockResolvedValue({
      text: JSON.stringify({
        brief: {
          type: 'still',
          coversText: likeness.coversText,
          description: 'The podium after the speech.',
          shotSize: 'medium',
          motion: { kind: 'static' },
          transition: 'cut',
          prompt: 'An empty podium under one spotlight, a glass of water half drunk.',
        },
      }),
    })

    const { result } = await engine.execute({ events: redirectEvent() })

    expect(result).toMatchObject({ outcome: 'redirected' })
    expect((await getShotSlot(db, slotId))?.refusal).toBeNull()
    expect(
      noticesFor(await listProjectNotices(db, FIXTURE_PROJECT_ID), 'slot', slotId),
    ).toEqual([])
  })
})
```

In `apps/web/inngest/functions/slot-retyper.test.ts`:
- add `listProjectNotices,` and `notices,` to the import from `@boom-busters/db`;
- line 19 becomes `import { BudgetExceededError, ContentPolicyError, noticesFor, type ShotBrief } from '@boom-busters/schemas'`;
- after the `vi.mock('@/lib/notify', ...)` block (line 36) add:

```ts
const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))
```

and append:

```ts
describeDb('slot-retyper on the answer helper (decision 293)', () => {
  let engine: InngestTestEngine
  let slotId = ''

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: slotRetyper })
    callLlm.mockReset()
    vi.stubEnv('MOCK_PROVIDERS', '')
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
    await db.delete(notices)
    await db.delete(shotSlots)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    const chapter = await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The audit',
      contentMd: 'By June, the auditors could not find the money.',
      estRuntimeSec: 30,
    })
    await replaceShotList(db, FIXTURE_PROJECT_ID, [
      { chapterId: chapter.id, index: 0, type: 'still', brief: stillBrief, startMs: 0, durationMs: 8000 },
    ])
    const [slot] = await listShotSlots(db, FIXTURE_PROJECT_ID)
    slotId = slot!.id
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'plan')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("takes a decline as final after one call, and shows the model's reason on the card", async () => {
    callLlm.mockResolvedValue({
      text: JSON.stringify({ error: 'No sourced numbers cover this beat.' }),
    })

    const { result } = await engine.execute({ events: retypeEvent(slotId, 'chart') })

    expect(result).toMatchObject({ outcome: 'refused' })
    expect(callLlm).toHaveBeenCalledTimes(1)
    const slot = await getShotSlot(db, slotId)
    expect(slot?.type).toBe('still')
    expect(slot?.retype).toEqual({
      state: 'refused',
      target: 'chart',
      reason: 'No sourced numbers cover this beat.',
    })
  })

  it("takes the provider's content refusal as final, after one call", async () => {
    callLlm.mockRejectedValue(new ContentPolicyError('anthropic', 'the request was declined'))

    const { result } = await engine.execute({ events: retypeEvent(slotId, 'chart') })

    expect(result).toMatchObject({ outcome: 'refused' })
    expect(callLlm).toHaveBeenCalledTimes(1)
    expect((await getShotSlot(db, slotId))?.retype).toEqual({
      state: 'refused',
      target: 'chart',
      reason: 'anthropic: the request was declined',
    })
  })

  it("records the places a drafted map was capped to on the slot's card", async () => {
    const places = Array.from({ length: 9 }, (_, at) => ({
      label: `City ${at + 1}`,
      lat: 10 + at,
      lon: 20 + at,
    }))
    callLlm.mockResolvedValue({
      text: JSON.stringify({
        brief: {
          type: 'map',
          coversText: stillBrief.coversText,
          description: stillBrief.description,
          motion: { kind: 'static' },
          transition: 'cut',
          locations: places,
          route: true,
        },
      }),
    })

    const { result } = await engine.execute({ events: retypeEvent(slotId, 'map') })

    expect(result).toMatchObject({ outcome: 'retyped', targetType: 'map' })
    const slot = await getShotSlot(db, slotId)
    expect(slot?.type).toBe('map')
    expect((slot?.brief as { locations: unknown[] }).locations).toEqual(places.slice(0, 8))
    expect(
      noticesFor(await listProjectNotices(db, FIXTURE_PROJECT_ID), 'slot', slotId).map(
        ({ kind, message }) => ({ kind, message }),
      ),
    ).toEqual([{ kind: 'trimmed', message: "Kept the first 8 of the map's places." }])
  })
})
```

- [ ] **Step 10: Run them to see them fail (each file alone)**

Run, one at a time, with `timeout: 600000` and Docker Desktop running:
`cd apps/web && pnpm exec vitest run inngest/functions/slot-rebriefer.test.ts`
`cd apps/web && pnpm exec vitest run inngest/functions/slot-redirector.test.ts`
`cd apps/web && pnpm exec vitest run inngest/functions/slot-retyper.test.ts`
Expected: FAIL. A refused draft costs one call, not two; a content refusal is thrown out of the step instead of landing on the card; the nine-place map is refused; an old notice stays; the retype decline reads "The model declined the conversion: ...". The re-brief decline test already passes (today's catch also ends after one call). The mock-mode tests in each file still pass.

- [ ] **Step 11: Put the re-brief on the helper**

In `apps/web/inngest/functions/slot-rebriefer.ts`, replace line 34

```ts
import { callLlm } from '@/lib/llm'
```

with

```ts
import { callForAnswer, type Answer } from '@/lib/answer'
import { completeForProject } from '@/lib/answer-call'
import { recordRepairs } from '@/lib/notices'
```

In the `draft-brief` step, replace from `      let next: ShotBrief` (line 188) through the step body's last line, `      return { ok: true as const, resolveNow: project.visualsPhase === 'board' }` (line 266, directly before the `    })` that closes the step; the graphic path's identical return at line 179 stays), with:

```ts
      let answer: Answer<ShotBrief>
      try {
        if (brief.type === 'chart' || brief.type === 'map') {
          const claims = await scriptableClaims(db, projectId)
          // The logo library's index (decision 268, Plan B): a redrafted
          // graphic may name a mark the producer already holds.
          const logos = (await listLogos(db)).map((row) => ({ id: row.id, title: row.title ?? '' }))
          answer = mockProvidersEnabled()
            ? {
                ok: true,
                value: mockRetypedBrief({
                  brief,
                  targetType: brief.type,
                  claimIds: claims.map((claim) => claim.id),
                  claimTexts: claims.map((claim) => claim.text),
                  logoTitles: logos.map((logo) => logo.title),
                  ...(guidance === undefined ? {} : { guidance }),
                }),
                calls: 1,
              }
            : await callForAnswer({
                request: buildRetypeRequest({
                  caseTitle: project.title,
                  brief,
                  targetType: brief.type,
                  claims: claims.map((claim) => ({
                    id: claim.id,
                    text: claim.text,
                    sourceUrl: claim.sourceUrl,
                    confidence: claim.confidence,
                  })),
                  logos: logos.map((logo) => logo.title),
                  ...(guidance === undefined ? {} : { guidance }),
                }),
                parse: (text, note) =>
                  parseRetypedBrief(text, { targetType: brief.type, claims, logos }, note),
                complete: completeForProject(projectId),
              })
        } else {
          const book = DirectorsBookSchema.safeParse(project.direction)
          const references =
            brief.type === 'still' && !mockProvidersEnabled()
              ? await rebriefReferences(projectId)
              : { photographed: [], sets: [] }
          answer = mockProvidersEnabled()
            ? { ok: true, value: mockRebriefedBrief(brief, guidance), calls: 1 }
            : await callForAnswer({
                request: buildRebriefRequest({
                  caseTitle: project.title,
                  brief,
                  ...(guidance === undefined ? {} : { guidance }),
                  direction: book.success ? book.data : null,
                  ...references,
                }),
                parse: (text, note) => parseRebriefedBrief(text, brief, note),
                complete: completeForProject(projectId),
              })
        }
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          return { ok: false as const, gate: budgetGateData(error) }
        }
        // The mock refuses as the live parser does (a chart with no claims to
        // cite), and its refusal lands on the card the same way below.
        if (!(error instanceof ValidationError)) throw error
        answer = { ok: false, issue: error.message, calls: 1 }
      }

      // A refusal after its retry, a decline in the model's own words or the
      // provider's content refusal (decision 293): the slot keeps the brief it
      // has and the card shows why, until it is dismissed.
      if (!answer.ok) {
        await setSlotRetype(db, slotId, { state: 'rebrief-refused', reason: answer.issue })
        return { ok: false as const, refused: answer.issue }
      }

      await updateSlotBrief(db, slotId, answer.value)
      // `updateSlotBrief` clears a refusal but not this, and the pending state
      // has to end on the write that answers it.
      await setSlotRetype(db, slotId, null)
      // What the repair capped, on this slot's card; a clean answer retires the
      // notes of the last one (decision 293).
      await recordRepairs({ projectId, subject: 'slot', subjectId: slotId }, answer.repairs)
      return { ok: true as const, resolveNow: project.visualsPhase === 'board' }
```

`ValidationError`, `BudgetExceededError` and every providers import stay in use. Task 4 has already changed this file's `markSideJobFailed` calls; nothing here touches them.

- [ ] **Step 12: Put the redirect on the helper**

In `apps/web/inngest/functions/slot-redirector.ts`, remove `  ValidationError,` from the import from `@boom-busters/schemas` (line 23; nothing else in the file uses it), and replace line 28

```ts
import { callLlm } from '@/lib/llm'
```

with

```ts
import { callForAnswer, type Answer } from '@/lib/answer'
import { completeForProject } from '@/lib/answer-call'
import { recordRepairs } from '@/lib/notices'
```

In the `redirect-brief` step, replace from `        let next: StillBrief` (line 92) through `        return { ok: true as const, resolveNow: project.visualsPhase === 'board' }` (line 126) with:

```ts
        const original = brief.data
        let answer: Answer<StillBrief>
        try {
          answer = mockProvidersEnabled()
            ? { ok: true, value: mockRedirectedBrief(original), calls: 1 }
            : await callForAnswer({
                request: buildRedirectRequest({
                  caseTitle: project.title,
                  brief: original,
                  reason,
                  direction: book.success ? book.data : null,
                }),
                parse: (text, note) => parseRedirectedBrief(text, original, note),
                complete: completeForProject(projectId),
              })
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            return { ok: false as const, gate: budgetGateData(error) }
          }
          throw error
        }

        // A refusal after its retry, or the provider's content refusal
        // (decision 293): the card keeps its refusal box, now with the reason.
        if (!answer.ok) {
          await setSlotRefusal(db, slotId, {
            reason: `Redirect refused: ${answer.issue}`,
            at: new Date().toISOString(),
          })
          return { ok: false as const, refused: answer.issue }
        }

        // The brief write clears the refusal: the refused prompt no longer exists.
        await updateSlotBrief(db, slotId, answer.value)
        // A clean answer retires this slot's old notes (decision 293).
        await recordRepairs({ projectId, subject: 'slot', subjectId: slotId }, answer.repairs)
        return { ok: true as const, resolveNow: project.visualsPhase === 'board' }
```

- [ ] **Step 13: Put the retype on the helper**

In `apps/web/inngest/functions/slot-retyper.ts`, add after the value import from `@boom-busters/providers` (line 16):

```ts
import type { Repair } from '@boom-busters/providers'
```

and replace line 31

```ts
import { callLlm } from '@/lib/llm'
```

with

```ts
import { callForAnswer, type Answer } from '@/lib/answer'
import { completeForProject } from '@/lib/answer-call'
import { recordRepairs } from '@/lib/notices'
```

In the `convert-brief` step, replace line 127

```ts
      let next: ShotBrief | null = convertBrief(brief, targetType)
```

with

```ts
      let next: ShotBrief | null = convertBrief(brief, targetType)
      // What the model's draft repaired; a mechanical conversion has none.
      let repairs: Repair[] | undefined
```

Replace the whole `try { ... } catch (error) { ... }` from `        try {` (line 153) through its closing `        }` (line 204) with:

```ts
        let answer: Answer<ShotBrief>
        try {
          if (mockProvidersEnabled()) {
            // The mock refuses as the live parser does (a chart citing no
            // claims), so its refusal lands on the card the same way below.
            answer = {
              ok: true,
              value: mockRetypedBrief({
                brief,
                targetType,
                claimIds,
                claimTexts: claims.map((claim) => claim.text),
                logoTitles: logos.map((logo) => logo.title),
              }),
              calls: 1,
            }
          } else {
            const project = await getProject(db, projectId)
            answer = await callForAnswer({
              request: buildRetypeRequest({
                caseTitle: project?.title ?? 'this case',
                brief,
                targetType,
                claims: claims.map((claim) => ({
                  id: claim.id,
                  text: claim.text,
                  sourceUrl: claim.sourceUrl,
                  confidence: claim.confidence,
                })),
                logos: logos.map((logo) => logo.title),
              }),
              parse: (text, note) => parseRetypedBrief(text, { targetType, claims, logos }, note),
              complete: completeForProject(projectId),
            })
          }
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            await setSlotRetype(db, slotId, null)
            return { changed: false as const, gate: budgetGateData(error) }
          }
          if (!(error instanceof ValidationError)) throw error
          answer = { ok: false, issue: error.message, calls: 1 }
        }

        // A refusal after its retry, a decline in the model's own words or the
        // provider's content refusal (decision 293): the slot keeps its old
        // brief and the card shows the reason until it is dismissed.
        if (!answer.ok) {
          await setSlotRetype(db, slotId, {
            state: 'refused',
            target: targetType,
            reason: answer.issue,
          })
          return { changed: false as const, refused: answer.issue }
        }
        next = answer.value
        repairs = answer.repairs
```

Replace line 207

```ts
      await retypeShotSlot(db, slotId, targetType, next)
```

with

```ts
      await retypeShotSlot(db, slotId, targetType, next)
      // The new brief's repairs on this slot's card. Any retype retires the
      // notes the old brief carried (decision 293).
      await recordRepairs({ projectId, subject: 'slot', subjectId: slotId }, repairs)
```

- [ ] **Step 14: Run the step tests (each file alone)**

Run, one at a time, with `timeout: 600000`:
`cd apps/web && pnpm exec vitest run inngest/functions/slot-rebriefer.test.ts`
`cd apps/web && pnpm exec vitest run inngest/functions/slot-redirector.test.ts`
`cd apps/web && pnpm exec vitest run inngest/functions/slot-retyper.test.ts`
Expected: PASS: 5, 3 and 3 new tests, and every existing mock-mode test unchanged.

- [ ] **Step 15: Write the failing slot card test**

In `apps/web/app/(console)/projects/[id]/visual-board.test.tsx`, add `import type { Notice } from '@boom-busters/schemas'` beside the existing schemas import, and after the `vi.mock('@/app/(console)/settings/logo-actions', ...)` block (line 103) add (if Task 5 already mocks `@/app/(console)/notice-actions` in this file, keep its mock and its `dismissNoticeAction`, and skip this block):

```ts
const dismissNoticeAction = vi.fn()
vi.mock('@/app/(console)/notice-actions', () => ({
  dismissNoticeAction: (...args: unknown[]) => dismissNoticeAction(...args),
}))
```

Append:

```tsx
describe('notices on the slot card (decision 293)', () => {
  beforeEach(() => {
    // A chapter folded by an earlier test must not hide these cards.
    window.localStorage.clear()
  })

  const notice = (
    id: string,
    subjectId: string | null,
    message: string,
    subject: Notice['subject'] = 'slot',
  ): Notice => ({
    id,
    projectId: PROJECT,
    subject,
    subjectId,
    kind: 'trimmed',
    message,
    createdAt: new Date('2026-10-09T10:00:00Z'),
  })

  it("shows each slot its own notices, never another slot's, and none for a slot gone from the board", () => {
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([stockSlot, chartSlot])}
        colors={COLORS}
        brand={BRAND}
        notices={[
          notice('01J000000000000000000000N1', SLOT_A, "Kept the first 8 of the map's places."),
          notice('01J000000000000000000000N2', SLOT_B, 'The re-type stopped: the answer was cut off.'),
          // SLOT_C is not on this board: re-planned away (Review Focus 1).
          notice('01J000000000000000000000N3', SLOT_C, 'The redirect stopped: the slot was re-planned.'),
          notice('01J000000000000000000000N4', null, 'Trimmed to fit: era rule 1.', 'direction'),
        ]}
      />,
    )

    const cardA = document.getElementById(`slot-${SLOT_A}`)!
    const cardB = document.getElementById(`slot-${SLOT_B}`)!
    expect(within(cardA).getByText("Kept the first 8 of the map's places.")).toHaveAttribute(
      'role',
      'status',
    )
    expect(within(cardA).queryByText('The re-type stopped: the answer was cut off.')).toBeNull()
    expect(within(cardA).queryByText('Trimmed to fit: era rule 1.')).toBeNull()
    expect(within(cardB).getByText('The re-type stopped: the answer was cut off.')).toHaveAttribute(
      'role',
      'status',
    )
    expect(screen.queryByText('The redirect stopped: the slot was re-planned.')).toBeNull()
  })

  it('dismisses a slot notice with its own button', async () => {
    dismissNoticeAction.mockResolvedValue({ ok: true })
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([stockSlot])}
        colors={COLORS}
        brand={BRAND}
        notices={[notice('01J000000000000000000000N1', SLOT_A, "Kept the first 8 of the map's places.")]}
      />,
    )

    const cardA = document.getElementById(`slot-${SLOT_A}`)!
    await userEvent.click(within(cardA).getByRole('button', { name: 'Dismiss' }))
    expect(dismissNoticeAction).toHaveBeenCalledWith('01J000000000000000000000N1')
  })
})
```

- [ ] **Step 16: Run it to see it fail**

Run: `cd apps/web && pnpm exec vitest run "app/(console)/projects/[id]/visual-board.test.tsx"`
Expected: FAIL: `VisualBoard` has no `notices` prop (a TypeScript error the run ignores), and no card renders a notice, so `getByText` finds nothing.

- [ ] **Step 17: Render the slot's notices on its card**

In `apps/web/app/(console)/projects/[id]/visual-board.tsx`:
- add `noticesFor,` to the value import from `@boom-busters/schemas` (lines 18 to 30) and `Notice,` to the type import from it (lines 31 to 39);
- after `import { ConfirmButton } from '@/components/confirm-button'` (line 44) add `import { Notices } from '@/components/notices'`.

`VisualBoardContent` (lines 1500 to 1514): its props become (if Task 5 already added a `notices` prop of this name and type here, keep that one and go on to the `SlotCard` changes):

```tsx
function VisualBoardContent({
  projectId,
  model,
  colors,
  brand,
  setPhotos = [],
  castMembers = [],
  notices = [],
}: {
  projectId: string
  model: VisualsReviewModel
  colors: BrandChartColors
  brand: BrandKitStored
  setPhotos?: readonly SetPhotoGroup[]
  /** The project's cast, for a post card's "one of the cast?" question (decision 284). */
  castMembers?: readonly CastOption[]
  /** The project's open notices; each card picks its own (decision 293). */
  notices?: readonly Notice[]
}) {
```

In the `SlotCard` call (lines 2029 to 2045), replace

```tsx
                setPhotos={setPhotos}
                castMembers={castMembers}
              />
            </SlotLockContext.Provider>
```

with

```tsx
                setPhotos={setPhotos}
                castMembers={castMembers}
                notices={noticesFor(notices, 'slot', slot.id)}
              />
            </SlotLockContext.Provider>
```

In `SlotCard`'s props (lines 2191 to 2224), replace

```tsx
  setPhotos,
  castMembers,
}: {
```

with

```tsx
  setPhotos,
  castMembers,
  notices,
}: {
```

and replace

```tsx
  castMembers: readonly CastOption[]
}) {
  const [editing, setEditing] = React.useState(false)
```

with

```tsx
  castMembers: readonly CastOption[]
  /** What an answer for this slot repaired, or why a job on it stopped (decision 293). */
  notices: readonly Notice[]
}) {
  const [editing, setEditing] = React.useState(false)
```

Directly before the format picker's comment (line 2435):

```tsx
        {/* The format picker (staged-visuals design): the suggested type is a
```

insert

```tsx
        {/* What an answer for this slot trimmed or capped, or why a job on it
            stopped (decision 293), each line with its own Dismiss. */}
        <Notices notices={notices} />

```

In `apps/web/app/(console)/projects/[id]/page.tsx`, in the `<VisualBoard` element (lines 495 to 512), replace

```tsx
          brand={settings.brandKit}
        />
      ) : showVoice ? (
```

with

```tsx
          brand={settings.brandKit}
          notices={notices}
        />
      ) : showVoice ? (
```

(`notices` is the project's open notices that Task 3 loads on this page; if Task 5 already passes it here, leave it.)

- [ ] **Step 18: Run the card test, the typecheck and lint**

Run: `cd apps/web && pnpm exec vitest run "app/(console)/projects/[id]/visual-board.test.tsx"`
Expected: PASS, including the 2 new tests.

Run: `pnpm typecheck` from the root (`timeout: 600000`).
Expected: clean.

- [ ] **Step 19: Run every consuming suite**

The retype, re-brief and redirect parsers and the visuals schema changed, so: `cd apps/web && pnpm test` (alone: it holds the database suites; `timeout: 600000`).
Expected: PASS.

- [ ] **Step 20: Commit the steps and the card**

```bash
pnpm exec prettier --write apps/web/inngest/functions/slot-rebriefer.ts apps/web/inngest/functions/slot-redirector.ts apps/web/inngest/functions/slot-retyper.ts apps/web/inngest/functions/slot-rebriefer.test.ts apps/web/inngest/functions/slot-redirector.test.ts apps/web/inngest/functions/slot-retyper.test.ts "apps/web/app/(console)/projects/[id]/visual-board.tsx" "apps/web/app/(console)/projects/[id]/visual-board.test.tsx" "apps/web/app/(console)/projects/[id]/page.tsx"
pnpm exec prettier --check apps/web/inngest/functions/slot-rebriefer.ts apps/web/inngest/functions/slot-redirector.ts apps/web/inngest/functions/slot-retyper.ts apps/web/inngest/functions/slot-rebriefer.test.ts apps/web/inngest/functions/slot-redirector.test.ts apps/web/inngest/functions/slot-retyper.test.ts "apps/web/app/(console)/projects/[id]/visual-board.tsx" "apps/web/app/(console)/projects/[id]/visual-board.test.tsx" "apps/web/app/(console)/projects/[id]/page.tsx"
pnpm exec eslint --max-warnings 0 apps/web/inngest/functions/slot-rebriefer.ts apps/web/inngest/functions/slot-redirector.ts apps/web/inngest/functions/slot-retyper.ts apps/web/inngest/functions/slot-rebriefer.test.ts apps/web/inngest/functions/slot-redirector.test.ts apps/web/inngest/functions/slot-retyper.test.ts "apps/web/app/(console)/projects/[id]/visual-board.tsx" "apps/web/app/(console)/projects/[id]/visual-board.test.tsx" "apps/web/app/(console)/projects/[id]/page.tsx"
git add apps/web/inngest/functions/slot-rebriefer.ts apps/web/inngest/functions/slot-redirector.ts apps/web/inngest/functions/slot-retyper.ts apps/web/inngest/functions/slot-rebriefer.test.ts apps/web/inngest/functions/slot-redirector.test.ts apps/web/inngest/functions/slot-retyper.test.ts "apps/web/app/(console)/projects/[id]/visual-board.tsx" "apps/web/app/(console)/projects/[id]/visual-board.test.tsx" "apps/web/app/(console)/projects/[id]/page.tsx"
git commit -F <message file>
```

Message: `feat(visuals): re-brief, redirect and retype on the answer helper, with notices on the slot card (decision 293)` plus the trailer.

---


---

### Task 12: The Script stage's Shorts marking

**Files:**
- Modify: `packages/schemas/src/script.ts` (three constants before `ShortsCandidateSchema`, line 119; the schema, lines 119 to 132)
- Modify: `packages/providers/src/prompts/script.ts` (imports, lines 1 to 15; `buildShortsRequest`'s system text, lines 377 to 378; `parseShortsCandidates`, lines 402 to 404)
- Test: `packages/providers/src/prompts/script.test.ts`
- Modify: `apps/web/lib/script-answers.ts` (`markShortsWith`, lines 39 to 51; imports)
- Test: `apps/web/lib/script-answers.test.ts` (one existing assertion, line 50, plus a new test)
- Modify: `apps/web/inngest/functions/script-runner.ts` (imports, lines 16 to 40; new helpers after `const FUNCTION_ID`, line 69; the `mark-shorts` step, lines 275 to 292)
- Create: `apps/web/inngest/functions/script-runner.test.ts` (its last block is a database test: run the file alone)
- Modify: `apps/web/inngest/functions/shorts-runner.ts` (imports; the comment at lines 100 to 109; `mark-missing-candidates`, lines 138 to 156)
- Test: `apps/web/inngest/functions/shorts-runner.test.ts` (database test: run alone)
- Modify: `apps/web/app/(console)/projects/[id]/script-studio.tsx` (imports, lines 5 and 25; `ScriptStudio` props, lines 83 to 97; the `ShortsStrip` element, lines 155 to 158; `ShortsStrip`, lines 945 to 990)
- Create: `apps/web/app/(console)/projects/[id]/script-studio.test.tsx`
- Modify: `apps/web/app/(console)/projects/[id]/page.tsx` (the `ScriptStudio` element, lines 516 to 523)

**Interfaces:**
- Consumes: `Note`, `Repair`, `ignoreRepairs`, `trimField`, `capList`, `dropItems`, `overLimit` (Task 1, providers); `callForAnswer`, `answerOrStop` (`@/lib/answer`); `completeForProject` (stage 1); `recordRepairs`, `recordStop` (Task 3, `@/lib/notices`); `Notices` (Task 3); `Notice`, `NoticeTarget`, `noticesFor` (Task 1); `page.tsx`'s `notices` (Task 3); in tests, `listProjectNotices` and the `notices` table (Task 2).
- Produces:
  - `@boom-busters/schemas`: `SHORTS_HOOK_MAX = 1000`, `SHORTS_SENTENCE_MAX = 2000`, `SHORTS_CANDIDATES_MAX = 10`.
  - `@boom-busters/providers`: `parseShortsCandidates(text: string, note: Note = ignoreRepairs): ShortsCandidate[]`.
  - `@/lib/script-answers`: `markShortsWith(complete, input): Promise<{ candidates: ShortsCandidate[]; repairs: Repair[] }>` (was `Promise<ShortsCandidate[]>`); `SHORTS_UNMARKED = 'The Shorts segments could not be marked'`.
  - `script-runner.ts`: `type MarkedShorts = { ok: true; candidates: ShortsCandidate[] } | { ok: false; gate: Record<string, unknown> }`; `readMarkedShorts(stored: MarkedShorts | ShortsCandidate[]): MarkedShorts`; `markShortsStep(projectId: string, input: Parameters<typeof markShortsWith>[1]): Promise<MarkedShorts>`. The `mark-shorts` step result changes shape (a bare list before), so the runner reads it through `readMarkedShorts`, with a replay test.
  - `ScriptStudio` gains `notices?: readonly Notice[]` (the `script` notices, default `[]`); `ShortsStrip({ shorts, notices })` is exported for its test.

- [ ] **Step 1: Write the failing parser and prompt tests**

In `packages/providers/src/prompts/script.test.ts`, line 1 becomes `import { OutlineSchema, SHORTS_HOOK_MAX, ValidationError } from '@boom-busters/schemas'`; add `import type { Repair } from './repair'` after the type import from `./script`; append:

```ts
describe('the Shorts marking limits (decision 293)', () => {
  const candidate = (over: Record<string, unknown> = {}) => ({
    chapterIndex: 0,
    startSentence: 'EY refused to sign the accounts.',
    endSentence: 'The shares collapsed in nine days.',
    hookRationale: 'The auditor said no.',
    ...over,
  })

  const collect = () => {
    const notes: Repair[] = []
    return {
      notes,
      note: (repair: Repair) => {
        notes.push(repair)
      },
    }
  }

  it('states every limit in the prompt', () => {
    const rules = buildShortsRequest({
      chapters: [{ index: 0, title: 'One', contentMd: 'Text.' }],
    }).system.replace(/\s+/g, ' ')
    expect(rules).toContain(
      'Limits (the app checks them): at most 10 candidates; "startSentence" and "endSentence" at most 2000 characters each; "hookRationale" at most 1000 characters.',
    )
  })

  it('trims a hook over its limit at a sentence and names the candidate, leaving its anchors alone', () => {
    const { notes, note } = collect()
    const long = 'The auditor said no. ' + 'That is the whole scandal in one line. '.repeat(40)
    const parsed = parseShortsCandidates(
      JSON.stringify({ candidates: [candidate(), candidate({ hookRationale: long })] }),
      note,
    )
    expect(parsed[1]!.hookRationale.length).toBeLessThanOrEqual(SHORTS_HOOK_MAX)
    expect(parsed[1]!.hookRationale.endsWith('in one line.')).toBe(true)
    expect(parsed[1]).toMatchObject({
      chapterIndex: 0,
      startSentence: 'EY refused to sign the accounts.',
      endSentence: 'The shares collapsed in nine days.',
    })
    expect(notes).toEqual([{ action: 'trimmed', field: "candidate 2's hook" }])
  })

  it('drops a candidate whose start or end sentence runs over its limit, keeps the rest, and numbers them as written', () => {
    const { notes, note } = collect()
    const parsed = parseShortsCandidates(
      JSON.stringify({
        candidates: [
          candidate(),
          candidate({ startSentence: 'A'.repeat(2001) }),
          // Dropped whole: its long hook is not trimmed first.
          candidate({ endSentence: 'B'.repeat(2001), hookRationale: 'x'.repeat(1200) }),
          candidate({ chapterIndex: 1 }),
        ],
      }),
      note,
    )
    expect(parsed.map((kept) => kept.chapterIndex)).toEqual([0, 1])
    expect(notes).toEqual([
      {
        action: 'dropped',
        field: 'candidate 2',
        reason: 'its start sentence ran over 2,000 characters',
      },
      {
        action: 'dropped',
        field: 'candidate 3',
        reason: 'its end sentence ran over 2,000 characters',
      },
    ])
  })

  it('keeps the first ten of more', () => {
    const { notes, note } = collect()
    const parsed = parseShortsCandidates(
      JSON.stringify({
        candidates: Array.from({ length: 12 }, (_, at) => candidate({ chapterIndex: at })),
      }),
      note,
    )
    expect(parsed.map((kept) => kept.chapterIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(notes).toEqual([{ action: 'capped', field: 'Shorts candidates', kept: 10 }])
  })

  it('still refuses a candidate it cannot repair', () => {
    expect(() =>
      parseShortsCandidates(JSON.stringify({ candidates: [candidate({ hookRationale: 'short' })] })),
    ).toThrow(ValidationError)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/providers && pnpm exec vitest run src/prompts/script.test.ts`
Expected: FAIL: `SHORTS_HOOK_MAX` is not exported, the prompt states no limits, and the long hook, the long anchors and the twelve candidates are refused instead of repaired.

- [ ] **Step 3: Add the limits to the script schema**

In `packages/schemas/src/script.ts`, directly before `export const ShortsCandidateSchema = z.object({` (line 119):

```ts
/**
 * The Shorts marking's limits (decision 293): one source for the schema, the
 * prompt that states them and the repair that keeps an answer within them.
 */
export const SHORTS_HOOK_MAX = 1000
export const SHORTS_SENTENCE_MAX = 2000
export const SHORTS_CANDIDATES_MAX = 10
```

and the two schemas (lines 119 to 132) become:

```ts
export const ShortsCandidateSchema = z.object({
  chapterIndex: z.number().int().min(0),
  /** The opening sentence of the segment, matched back to the chapter text. */
  startSentence: z.string().trim().min(1).max(SHORTS_SENTENCE_MAX),
  endSentence: z.string().trim().min(1).max(SHORTS_SENTENCE_MAX),
  /** Why this would stop a thumb. Shown beside the segment in the UI. */
  hookRationale: z.string().trim().min(10).max(SHORTS_HOOK_MAX),
})
export type ShortsCandidate = z.infer<typeof ShortsCandidateSchema>

export const ShortsCandidatesSchema = z.object({
  candidates: z.array(ShortsCandidateSchema).max(SHORTS_CANDIDATES_MAX),
})
```

- [ ] **Step 4: State the limits and repair the marking**

In `packages/providers/src/prompts/script.ts`, the imports (lines 1 to 15) become:

```ts
import {
  OutlineSchema,
  SelfCheckSchema,
  SHORTS_CANDIDATES_MAX,
  SHORTS_HOOK_MAX,
  SHORTS_SENTENCE_MAX,
  ShortsCandidatesSchema,
  TeaserScriptSchema,
  ValidationError,
  claimCarriesArticle,
  claimCarriesPost,
  countWords,
  splitSentences,
} from '@boom-busters/schemas'
import type { Outline, SelfCheck, ShortsCandidate, TeaserScript } from '@boom-busters/schemas'
import { z } from 'zod'
import { formatIssues, parseJsonCompletion } from './json'
import { capList, dropItems, ignoreRepairs, overLimit, trimField } from './repair'
import type { Note } from './repair'
import { SCRIPT_CRAFT } from './script-craft'
import { outputBudget } from '../llm/types'
import type { LLMTaskRequest } from '../llm/types'
```

(Task 9 adds the teaser's constants to this same import; keep both sets.)

In `buildShortsRequest`'s system text, replace lines 377 to 378

```ts
{"candidates": [{"chapterIndex": number, "startSentence": string,
  "endSentence": string, "hookRationale": string}]}`,
```

with

```ts
{"candidates": [{"chapterIndex": number, "startSentence": string,
  "endSentence": string, "hookRationale": string}]}

Limits (the app checks them): at most ${SHORTS_CANDIDATES_MAX} candidates; "startSentence" and
"endSentence" at most ${SHORTS_SENTENCE_MAX} characters each; "hookRationale" at most
${SHORTS_HOOK_MAX} characters.`,
```

Replace `parseShortsCandidates` (lines 402 to 404)

```ts
export function parseShortsCandidates(text: string): ShortsCandidate[] {
  return parseJsonCompletion(text, ShortsCandidatesSchema, 'Shorts candidates').candidates
}
```

with

```ts
const LooseAnswer = z.looseObject({})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Why a candidate's anchor sentences cannot be kept, or null when both fit. */
function anchorOverLimit(candidate: unknown): string | null {
  if (!isRecord(candidate)) return null
  for (const [key, what] of [
    ['startSentence', 'its start sentence'],
    ['endSentence', 'its end sentence'],
  ] as const) {
    const sentence = candidate[key]
    if (typeof sentence === 'string' && sentence.trim().length > SHORTS_SENTENCE_MAX) {
      return overLimit(what, SHORTS_SENTENCE_MAX)
    }
  }
  return null
}

/**
 * The marking as the model answered it, repaired before it is validated
 * (decision 293). A hook rationale over its limit is trimmed at a sentence. A
 * candidate whose start or end sentence runs over its limit is dropped and the
 * rest kept: those sentences are matched back to the chapter character for
 * character, so a cut one would anchor nowhere. More than ten keep the first
 * ten. Candidates are numbered as the model wrote them.
 */
function repairShortsCandidates(answer: Record<string, unknown>, note: Note): unknown {
  const candidates = answer['candidates']
  if (!Array.isArray(candidates)) return answer
  const trimmed = candidates.map((candidate, at) =>
    isRecord(candidate) && anchorOverLimit(candidate) === null
      ? {
          ...candidate,
          hookRationale: trimField(
            candidate['hookRationale'],
            SHORTS_HOOK_MAX,
            `candidate ${at + 1}'s hook`,
            note,
          ),
        }
      : candidate,
  )
  const kept = dropItems(trimmed, anchorOverLimit, (_, at) => `candidate ${at + 1}`, note)
  return {
    ...answer,
    candidates: capList(kept, SHORTS_CANDIDATES_MAX, 'Shorts candidates', note),
  }
}

export function parseShortsCandidates(text: string, note: Note = ignoreRepairs): ShortsCandidate[] {
  const answer = parseJsonCompletion(text, LooseAnswer, 'Shorts candidates')
  const parsed = ShortsCandidatesSchema.safeParse(repairShortsCandidates(answer, note))
  if (!parsed.success) {
    throw new ValidationError(
      `The model's Shorts candidates did not match the expected shape: ${formatIssues(parsed.error)}`,
      { field: 'Shorts candidates' },
    )
  }
  return parsed.data.candidates
}
```

The notices read "Trimmed to fit: candidate 2's hook.", "Dropped candidate 3: its end sentence ran over 2,000 characters." and "Kept the first 10 Shorts candidates."

- [ ] **Step 5: Run the parser tests, then the consuming suites**

Run: `cd packages/providers && pnpm exec vitest run src/prompts/script.test.ts`
Expected: PASS, including the 5 new tests; the existing `parseShortsCandidates` tests (lines 352 and 368) pass unchanged.

Then `cd packages/schemas && pnpm test`, `cd packages/providers && pnpm test`, and `pnpm typecheck` from the root (`timeout: 600000`).
Expected: PASS; clean.

- [ ] **Step 6: Commit the parser**

```bash
pnpm exec prettier --write packages/schemas/src/script.ts packages/providers/src/prompts/script.ts packages/providers/src/prompts/script.test.ts
pnpm exec prettier --check packages/schemas/src/script.ts packages/providers/src/prompts/script.ts packages/providers/src/prompts/script.test.ts
pnpm exec eslint --max-warnings 0 packages/schemas/src/script.ts packages/providers/src/prompts/script.ts packages/providers/src/prompts/script.test.ts
git add packages/schemas/src/script.ts packages/providers/src/prompts/script.ts packages/providers/src/prompts/script.test.ts
git commit -F <message file>
```

Message: `feat(script): the Shorts marking states its limits and repairs within them (decision 293)` plus the trailer.

- [ ] **Step 7: Write the failing marking tests**

In `apps/web/lib/script-answers.test.ts`, change the existing assertion at line 50 from

```ts
    expect(await markShortsWith(good, { chapters })).toEqual(mockShortsCandidates(chapters))
```

to

```ts
    expect(await markShortsWith(good, { chapters })).toEqual({
      candidates: mockShortsCandidates(chapters),
      repairs: [],
    })
```

and append inside its `describe`:

```ts
  it('returns what the repair changed beside the candidates (decision 293)', async () => {
    const [first] = mockShortsCandidates(chapters)
    const long = 'The auditor said no. ' + 'That is the whole scandal in one line. '.repeat(40)
    const complete = vi.fn().mockResolvedValue({
      text: JSON.stringify({ candidates: [{ ...first, hookRationale: long }] }),
    })

    const marked = await markShortsWith(complete, { chapters })

    expect(marked.candidates).toHaveLength(1)
    expect(marked.candidates[0]!.startSentence).toBe(first!.startSentence)
    expect(marked.repairs).toEqual([{ action: 'trimmed', field: "candidate 1's hook" }])
    expect(complete).toHaveBeenCalledTimes(1)
  })
```

Create `apps/web/inngest/functions/script-runner.test.ts`:

```ts
// @vitest-environment node

import {
  createScriptVersion,
  FIXTURE_PROJECT_ID,
  getProject,
  latestShortsCandidates,
  requireTestDatabase,
  scripts,
  seed,
  setProjectStage,
  truncateRunMirror,
} from '@boom-busters/db'
import { BudgetExceededError, TransientProviderError } from '@boom-busters/schemas'
import { InngestTestEngine } from '@inngest/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { markShortsStep, readMarkedShorts, scriptRunner } from './script-runner'

/**
 * The script stage's Shorts marking on the answer helper (decision 293).
 * Candidates that land carry their repairs to Script Studio's Shorts strip; a
 * stop stores none and says why there; a budget stop parks the run as the
 * outline and chapter steps do. The step's body is tested on its own with the
 * model mocked; the run around it, every earlier step stubbed, against the
 * test database, since the run mirror writes there.
 */

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))
const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))
const { recordRepairs, recordStop } = vi.hoisted(() => ({
  recordRepairs: vi.fn(),
  recordStop: vi.fn(),
}))
vi.mock('@/lib/notices', () => ({ recordRepairs, recordStop }))

const describeDb = requireTestDatabase() ? describe : describe.skip

const PROJECT = '01J0000000000000000000000P'
const SCRIPT_NOTICES = { projectId: PROJECT, subject: 'script', subjectId: null }

const chapters = [
  {
    index: 0,
    title: 'The audit',
    contentMd: 'EY refused to sign the accounts. The shares collapsed in nine days.',
  },
]

const candidate = {
  chapterIndex: 0,
  startSentence: 'EY refused to sign the accounts.',
  endSentence: 'The shares collapsed in nine days.',
  hookRationale: 'The auditor said no.',
}

describe('markShortsStep (decision 293)', () => {
  beforeEach(() => {
    callLlm.mockReset()
    recordRepairs.mockReset()
    recordStop.mockReset()
  })

  it('returns the candidates that land and puts what the repair changed on the strip', async () => {
    const long = 'The auditor said no. ' + 'That is the whole scandal in one line. '.repeat(40)
    callLlm.mockResolvedValueOnce({
      text: JSON.stringify({ candidates: [{ ...candidate, hookRationale: long }] }),
    })

    const marked = await markShortsStep(PROJECT, { chapters })

    expect(marked).toMatchObject({
      ok: true,
      candidates: [{ startSentence: candidate.startSentence, endSentence: candidate.endSentence }],
    })
    expect(recordRepairs).toHaveBeenCalledWith(SCRIPT_NOTICES, [
      { action: 'trimmed', field: "candidate 1's hook" },
    ])
    expect(recordStop).not.toHaveBeenCalled()
  })

  it('stores none after a refusal and its retry, and says on the strip that the Shorts stage will mark them', async () => {
    callLlm.mockResolvedValue({ text: 'not json at all' })

    expect(await markShortsStep(PROJECT, { chapters })).toEqual({ ok: true, candidates: [] })

    expect(callLlm).toHaveBeenCalledTimes(2)
    expect(recordStop).toHaveBeenCalledWith(
      SCRIPT_NOTICES,
      'stopped',
      'Shorts marking stopped: The model returned no JSON for Shorts candidates. It answered: not json at all. The Shorts stage will mark them again.',
    )
    expect(recordRepairs).not.toHaveBeenCalled()
  })

  it('hands a budget stop back for the run to park, with no notice', async () => {
    callLlm.mockRejectedValueOnce(
      new BudgetExceededError({
        provider: 'anthropic',
        operation: 'llm.metadata',
        budgetUsd: 5,
        monthSpendUsd: 5,
        estimateUsd: 0.01,
      }),
    )

    expect(await markShortsStep(PROJECT, { chapters })).toMatchObject({
      ok: false,
      gate: { gate: 'budget', provider: 'anthropic' },
    })
    expect(callLlm).toHaveBeenCalledTimes(1)
    expect(recordStop).not.toHaveBeenCalled()
    expect(recordRepairs).not.toHaveBeenCalled()
  })

  it('stores none after a provider error and says so on the strip, never failing the script', async () => {
    callLlm.mockRejectedValueOnce(
      new TransientProviderError('anthropic', 'overloaded', { status: 529 }),
    )
    expect(await markShortsStep(PROJECT, { chapters })).toEqual({ ok: true, candidates: [] })
    expect(callLlm).toHaveBeenCalledTimes(1)
    expect(recordStop).toHaveBeenCalledWith(
      SCRIPT_NOTICES,
      'stopped',
      expect.stringMatching(
        /^Shorts marking stopped: .*overloaded.*\. The Shorts stage will mark them again\.$/,
      ),
    )
  })
})

describe('readMarkedShorts (decision 293)', () => {
  it('reads the bare list a run parked before decision 293 stored', () => {
    expect(readMarkedShorts([candidate])).toEqual({ ok: true, candidates: [candidate] })
  })

  it('reads the new result as it is', () => {
    const parked = { ok: false as const, gate: { gate: 'budget' } }
    expect(readMarkedShorts(parked)).toEqual(parked)
    expect(readMarkedShorts({ ok: true, candidates: [] })).toEqual({ ok: true, candidates: [] })
  })
})

describeDb('script-runner around the Shorts marking (decision 293)', () => {
  let engine: InngestTestEngine
  let scriptId = ''

  const approved = () => [
    { name: 'gate/dossier.approved', data: { projectId: FIXTURE_PROJECT_ID } },
  ]

  /** Every step before the marking, as a run that reached it would replay them. */
  const throughSelfCheck = () => [
    {
      id: 'load-dossier',
      handler: () => ({
        scriptId,
        caseTitle: 'Wirecard',
        targetRuntimeMin: 10,
        dossierMd: 'The dossier.',
        claims: [],
      }),
    },
    {
      id: 'outline',
      handler: () => ({
        ok: true,
        outline: { chapters: [{ title: 'The audit', beat: 'x'.repeat(30), targetWords: 300 }] },
      }),
    },
    { id: 'save-outline', handler: () => undefined },
    {
      id: 'draft-chapter-0',
      handler: () => ({ ok: true, chapterId: 'chapter-0', contentMd: chapters[0]!.contentMd }),
    },
    { id: 'self-check-0', handler: () => ({ warnings: 0, refs: 0 }) },
  ]

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: scriptRunner })
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
    await db.delete(scripts)
    scriptId = (await createScriptVersion(db, FIXTURE_PROJECT_ID)).id
  })

  afterEach(async () => {
    // The fixture's own stage, for the suites after this one.
    await setProjectStage(db, FIXTURE_PROJECT_ID, { stage: 'dossier', stageStatus: 'queued' })
  })

  it('parks the run when the marking is over budget, as the other steps do', async () => {
    const { result, ctx } = await engine.execute({
      events: approved(),
      steps: [
        ...throughSelfCheck(),
        {
          id: 'mark-shorts',
          handler: () => ({
            ok: false,
            gate: { gate: 'budget', message: 'The monthly spend ceiling would be crossed.' },
          }),
        },
      ],
    })

    expect(result).toMatchObject({ outcome: 'over-budget' })
    expect(ctx.step.run).toHaveBeenCalledWith('shorts-over-budget', expect.any(Function))
    expect(ctx.step.run).not.toHaveBeenCalledWith('finish-draft', expect.any(Function))
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('failed')
  })

  it('stores the bare list a run parked before decision 293 replays', async () => {
    const { result, ctx } = await engine.execute({
      events: approved(),
      steps: [
        ...throughSelfCheck(),
        { id: 'mark-shorts', handler: () => [candidate] },
        { id: 'auto-approve', handler: () => undefined },
        { id: 'advance-to-voice', handler: () => undefined },
      ],
    })

    expect(result).toMatchObject({ outcome: 'auto-approved', shorts: 1 })
    expect(ctx.step.run).not.toHaveBeenCalledWith('shorts-over-budget', expect.any(Function))
    expect(await latestShortsCandidates(db, FIXTURE_PROJECT_ID)).toEqual([candidate])
  })
})
```

In `apps/web/inngest/functions/shorts-runner.test.ts`:
- add `latestShortsCandidates,`, `listProjectNotices,` and `notices,` to the import from `@boom-busters/db`;
- line 20 becomes `import { DEFAULT_SETTINGS, noticesFor, resolveBrandKit } from '@boom-busters/schemas'`;
- after the `vi.mock('@/lib/storage', ...)` block (line 51) add:

```ts
const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))
```

and add inside `describeDb('shorts-runner', ...)`, after the test `'a script with no candidates gets them marked here, never a review over nothing'`:

```ts
  it(
    'puts what the marking repaired on the Shorts strip when it marks here (decision 293)',
    { timeout: 120_000 },
    async () => {
      vi.stubEnv('MOCK_PROVIDERS', '')
      try {
        await db.update(scripts).set({ shortsCandidates: [] })
        await db.delete(notices)
        callLlm.mockResolvedValueOnce({
          text: JSON.stringify({
            candidates: [
              {
                chapterIndex: 0,
                startSentence: 'EY refused to sign the accounts.',
                endSentence: 'The shares collapsed in nine days.',
                hookRationale:
                  'The auditor said no. ' + 'That is the whole scandal in one line. '.repeat(40),
              },
            ],
          }),
        })

        await engine.executeStep('mark-missing-candidates', { events: masterReadyEvent() })

        const [marked] = await latestShortsCandidates(db, FIXTURE_PROJECT_ID)
        expect(marked?.startSentence).toBe('EY refused to sign the accounts.')
        expect(marked?.hookRationale.length).toBeLessThanOrEqual(1000)
        const script = noticesFor(await listProjectNotices(db, FIXTURE_PROJECT_ID), 'script')
        expect(script.map((notice) => notice.message)).toEqual([
          "Trimmed to fit: candidate 1's hook.",
        ])
      } finally {
        vi.unstubAllEnvs()
      }
    },
  )
```

- [ ] **Step 8: Run them to see them fail**

Run: `cd apps/web && pnpm exec vitest run lib/script-answers.test.ts`
Expected: FAIL: `markShortsWith` returns the bare list.

Run, alone, with `timeout: 600000`: `cd apps/web && pnpm exec vitest run inngest/functions/script-runner.test.ts`
Expected: FAIL: `markShortsStep` and `readMarkedShorts` are not exported.

Run, alone, with `timeout: 600000`: `cd apps/web && pnpm exec vitest run inngest/functions/shorts-runner.test.ts`
Expected: FAIL on the new test only: the candidate is stored with its hook trimmed (the parser landed in Step 4), but no `script` notice is written.

- [ ] **Step 9: `markShortsWith` returns the repairs too**

In `apps/web/lib/script-answers.ts`, the imports (lines 1 to 9) become:

```ts
import {
  buildOutlineRequest,
  buildSelfCheckRequest,
  buildShortsRequest,
  parseOutline,
  parseSelfCheck,
  parseShortsCandidates,
} from '@boom-busters/providers'
import type { Repair } from '@boom-busters/providers'
import type { ShortsCandidate } from '@boom-busters/schemas'
import { answerOrStop, callForAnswer, type AnswerComplete } from '@/lib/answer'
```

and replace `markShortsWith` (lines 39 to 51) with:

```ts
/** What a stopped Shorts marking says before its reason. */
export const SHORTS_UNMARKED = 'The Shorts segments could not be marked'

/**
 * The Shorts marking, with what the parser repaired in it (decision 293): the
 * caller stores the candidates and puts the repairs on Script Studio's Shorts
 * strip. A stop is thrown, as before, as a `NonRetriableError` with the reason.
 */
export async function markShortsWith(
  complete: AnswerComplete,
  input: Parameters<typeof buildShortsRequest>[0],
): Promise<{ candidates: ShortsCandidate[]; repairs: Repair[] }> {
  const answer = await callForAnswer({
    request: buildShortsRequest(input),
    parse: parseShortsCandidates,
    complete,
  })
  const candidates = answerOrStop(answer, SHORTS_UNMARKED)
  return { candidates, repairs: answer.ok ? (answer.repairs ?? []) : [] }
}
```

- [ ] **Step 10: The script stage marks on the helper**

In `apps/web/inngest/functions/script-runner.ts`:
- remove `  buildShortsRequest,` and `  parseShortsCandidates,` from the import from `@boom-busters/providers` (lines 16 to 27);
- line 29 becomes `import type { NoticeTarget, Outline, ShortsCandidate } from '@boom-busters/schemas'`;
- line 40 becomes `import { draftOutlineWith, markShortsWith, selfCheckWith, SHORTS_UNMARKED } from '@/lib/script-answers'`;
- after `import { callLlm } from '@/lib/llm'` (line 39) add `import { recordRepairs, recordStop } from '@/lib/notices'`.

After `const FUNCTION_ID = 'script-runner'` (line 69) add:

```ts
/** What the mark-shorts step returns since decision 293. */
export type MarkedShorts =
  | { ok: true; candidates: ShortsCandidate[] }
  | { ok: false; gate: Record<string, unknown> }

/**
 * The mark-shorts step's stored result. A run parked at the script gate
 * before decision 293 replays the bare candidate list this step used to
 * return (Inngest memoises step results), so that shape still reads.
 */
export function readMarkedShorts(stored: MarkedShorts | ShortsCandidate[]): MarkedShorts {
  return Array.isArray(stored) ? { ok: true, candidates: stored } : stored
}

/** A stop's bare reason: without `markShortsWith`'s lead-in or a closing full stop. */
function stopReason(message: string): string {
  const lead = `${SHORTS_UNMARKED}: `
  return (message.startsWith(lead) ? message.slice(lead.length) : message).replace(/\.$/, '')
}

/**
 * The mark-shorts step on the answer helper (decision 293). Candidates that
 * land replace the script's notices with what the repair changed. A stop
 * stores none and says why on Script Studio's Shorts strip: the narration is
 * this stage's deliverable, and the Shorts stage marks them again when it
 * finds none. A budget stop is handed back for the run to park, as the outline
 * and chapter steps do. Any other failure, a provider outage included, ends
 * the same way as a stop: the marking is optional here, and a script whose
 * chapters are all paid for must not fail for it (decision 293 ruling).
 */
export async function markShortsStep(
  projectId: string,
  input: Parameters<typeof markShortsWith>[1],
): Promise<MarkedShorts> {
  const target: NoticeTarget = { projectId, subject: 'script', subjectId: null }
  try {
    const { candidates, repairs } = await markShortsWith(completeForProject(projectId), input)
    await recordRepairs(target, repairs)
    return { ok: true, candidates }
  } catch (error) {
    if (error instanceof BudgetExceededError) return { ok: false, gate: budgetGateData(error) }
    const reason =
      error instanceof NonRetriableError
        ? stopReason(error.message)
        : error instanceof Error
          ? error.message.replace(/\.$/, '')
          : String(error)
    await recordStop(
      target,
      'stopped',
      `Shorts marking stopped: ${reason}. The Shorts stage will mark them again.`,
    )
    return { ok: true, candidates: [] }
  }
}
```

Replace the `mark-shorts` step (lines 275 to 292)

```ts
    const shorts = await step.run('mark-shorts', async (): Promise<ShortsCandidate[]> => {
      if (mocked) return mockShortsCandidates(written)
      // A failure here must not fail the script. The candidates are a
      // convenience for M7; the narration is the deliverable.
      try {
        return parseShortsCandidates(
          (
            await callLlm(
              buildShortsRequest({ chapters: written, tension: tensionFromOutline(outline) }),
              { projectId },
            )
          ).text,
        )
      } catch (error) {
        console.error('[script-runner] Shorts marking failed', serialiseError(error))
        return []
      }
    })
```

with

```ts
    const marking = await step.run('mark-shorts', async (): Promise<MarkedShorts> => {
      if (mocked) return { ok: true, candidates: mockShortsCandidates(written) }
      return markShortsStep(projectId, { chapters: written, tension: tensionFromOutline(outline) })
    })

    // Read with the old shape too: a run parked at the script gate before
    // decision 293 replays the bare list this step used to return.
    const marked = readMarkedShorts(marking)
    if (!marked.ok) {
      await step.run('shorts-over-budget', () => markStageFailed(ctx, marked.gate))
      return { projectId, outcome: 'over-budget' as const, chaptersWritten: written.length }
    }
    const shorts = marked.candidates
```

`serialiseError` stays imported for `onFailure`; `callLlm` stays for the chapter draft (Task 13 replaces it); `finish-draft` reads `shorts` as before.

- [ ] **Step 11: The Shorts stage records the repairs of its own marking**

In `apps/web/inngest/functions/shorts-runner.ts`, add `import type { Repair } from '@boom-busters/providers'` after the value import from `@boom-busters/providers` (lines 12 to 16), and `import { recordRepairs } from '@/lib/notices'` after `import { markShortsWith } from '@/lib/script-answers'` (line 37).

Replace the comment's first sentences (lines 101 to 105)

```ts
     * A script can arrive here with no candidates: the script-runner's
     * marking step deliberately swallows its own failures (the narration is
     * the script stage's deliverable, not the Shorts), and production did
     * exactly that on 2026-09-03 — the marking response failed to parse, an
     * empty list was stored, and this stage later sat "awaiting review" over
```

with

```ts
     * A script can arrive here with no candidates: the script-runner's
     * marking step stores none when its answer stops (the narration is the
     * script stage's deliverable, not the Shorts; since decision 293 the
     * Shorts strip says why), and production did exactly that on 2026-09-03:
     * the marking response failed to parse, an
     * empty list was stored, and this stage later sat "awaiting review" over
```

(prettier rewraps it.) Replace lines 138 to 156, from `      let picked` through `      return { ok: true as const, marked: picked.length }`, with:

```ts
      let picked
      let repairs: Repair[] = []
      if (mockProvidersEnabled()) {
        picked = mockShortsCandidates(chapterSources)
      } else {
        try {
          const marked = await markShortsWith(completeForProject(projectId), {
            chapters: chapterSources,
            ...(tension ? { tension } : {}),
          })
          picked = marked.candidates
          repairs = marked.repairs
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            return { ok: false as const, gate: budgetGateData(error) }
          }
          // A bad answer has had its two calls and stops the stage with its reason (decision 292); a provider error retries, then onFailure -> markStageFailed. Never a silent [].
          throw error
        }
      }
      await setShortsCandidates(db, latest.script.id, picked)
      // What the repair trimmed or dropped, on Script Studio's Shorts strip; a
      // clean marking retires the notes of the last one (decision 293).
      await recordRepairs({ projectId, subject: 'script', subjectId: null }, repairs)
      return { ok: true as const, marked: picked.length }
```

The step's result keeps its shape (`{ ok, marked }` or `{ ok, gate }`), so nothing replayed changes.

- [ ] **Step 12: Run the marking tests**

Run: `cd apps/web && pnpm exec vitest run lib/script-answers.test.ts`
Expected: PASS (5 tests).

Run, alone, with `timeout: 600000`: `cd apps/web && pnpm exec vitest run inngest/functions/script-runner.test.ts`
Expected: PASS (8 tests; the last 2 skip without a test database, so start Docker Desktop first).

Run, alone, with `timeout: 600000`: `cd apps/web && pnpm exec vitest run inngest/functions/shorts-runner.test.ts`
Expected: PASS, the new test included.

- [ ] **Step 13: Write the failing strip test**

Create `apps/web/app/(console)/projects/[id]/script-studio.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Notice, ShortsCandidate } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ShortsStrip } from './script-studio'

vi.mock('./actions', () => ({
  applyRegeneratedText: vi.fn(),
  regenerateSection: vi.fn(),
  reorderScriptChapters: vi.fn(),
  saveChapterText: vi.fn(),
}))
vi.mock('@/app/(console)/settings/voice-actions', () => ({ addPronunciation: vi.fn() }))
const dismissNoticeAction = vi.fn()
vi.mock('@/app/(console)/notice-actions', () => ({
  dismissNoticeAction: (...args: unknown[]) => dismissNoticeAction(...args),
}))
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))

/**
 * Script Studio's Shorts strip (decision 293): what the marking's repair
 * changed, or why it stopped, with a Dismiss on each line. A stop leaves no
 * candidates, so the strip must still show for its notice alone.
 */

const notice = (id: string, kind: Notice['kind'], message: string): Notice => ({
  id,
  projectId: '01J0000000000000000000000P',
  subject: 'script',
  subjectId: null,
  kind,
  message,
  createdAt: new Date('2026-10-09T10:00:00Z'),
})

const candidate: ShortsCandidate = {
  chapterIndex: 0,
  startSentence: 'EY refused to sign the accounts.',
  endSentence: 'The shares collapsed in nine days.',
  hookRationale: 'The auditor said no.',
}

const STOPPED =
  'Shorts marking stopped: the answer was cut off at its length limit. The Shorts stage will mark them again.'

describe('the Shorts strip (decision 293)', () => {
  beforeEach(() => {
    dismissNoticeAction.mockReset()
    refresh.mockReset()
  })

  it('says why the marking stopped, though the chapter has no candidates', () => {
    render(<ShortsStrip shorts={[]} notices={[notice('01J000000000000000000000S1', 'stopped', STOPPED)]} />)
    expect(screen.getByText(STOPPED)).toHaveAttribute('role', 'status')
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
    expect(screen.queryByText(/Shorts candidate/)).toBeNull()
  })

  it("shows what the marking's repair changed above the chapter's candidates", async () => {
    render(
      <ShortsStrip
        shorts={[candidate]}
        notices={[notice('01J000000000000000000000S2', 'trimmed', "Trimmed to fit: candidate 2's hook.")]}
      />,
    )
    expect(screen.getByText("Trimmed to fit: candidate 2's hook.")).toHaveAttribute('role', 'status')
    await userEvent.click(screen.getByRole('button', { name: /1 Shorts candidate in this chapter/ }))
    expect(screen.getByText('The auditor said no.')).toBeInTheDocument()
  })

  it('shows nothing with no candidates and no notices', () => {
    const { container } = render(<ShortsStrip shorts={[]} notices={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('dismisses a notice from the strip', async () => {
    dismissNoticeAction.mockResolvedValue({ ok: true })
    render(<ShortsStrip shorts={[]} notices={[notice('01J000000000000000000000S1', 'stopped', STOPPED)]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(dismissNoticeAction).toHaveBeenCalledWith('01J000000000000000000000S1')
  })
})
```

- [ ] **Step 14: Run it to see it fail**

Run: `cd apps/web && pnpm exec vitest run "app/(console)/projects/[id]/script-studio.test.tsx"`
Expected: FAIL: `ShortsStrip` is not exported (its import resolves to `undefined`).

- [ ] **Step 15: Show the script's notices on the strip**

In `apps/web/app/(console)/projects/[id]/script-studio.tsx`:
- line 5 becomes `import type { Notice, ShortsCandidate } from '@boom-busters/schemas'`;
- after `import { Button } from '@/components/ui/button'` (line 25) add `import { Notices } from '@/components/notices'`.

`ScriptStudio`'s props (lines 83 to 97) become:

```tsx
export function ScriptStudio({
  projectId,
  scriptId,
  chapters,
  targetRuntimeMin,
  shorts,
  usedFallbackModel,
  notices = [],
}: {
  projectId: string
  scriptId: string
  chapters: ChapterWithWarnings[]
  targetRuntimeMin: number
  shorts: ShortsCandidate[]
  usedFallbackModel: boolean
  /** What the Shorts marking repaired, or why it stopped (decision 293). */
  notices?: readonly Notice[]
}) {
```

The strip's element (lines 155 to 158) becomes:

```tsx
            <ShortsStrip
              key={`shorts-${active.id}`}
              shorts={shorts.filter((candidate) => candidate.chapterIndex === active.index)}
              notices={notices}
            />
```

Replace `ShortsStrip` with its doc comment (lines 945 to 990, from `/**` above `function ShortsStrip` to the function's closing brace) with:

```tsx
/**
 * The Shorts candidates the marking picked in the selected chapter, folded
 * away under the editor, beneath the marking's notices (decision 293): what
 * its repair trimmed or dropped, or why it stopped. The notices are the whole
 * script's, so they show under every chapter until dismissed, and a stop that
 * left no candidates still shows. With neither, the strip shows nothing: it is
 * an indicator, and indicating an absence is noise. Exported for its test.
 */
export function ShortsStrip({
  shorts,
  notices,
}: {
  shorts: ShortsCandidate[]
  notices: readonly Notice[]
}) {
  const [open, setOpen] = React.useState(false)

  if (shorts.length === 0 && notices.length === 0) return null

  return (
    <section className="rounded-[8px] border border-[var(--color-border)]">
      {notices.length > 0 ? (
        <div className={shorts.length > 0 ? 'px-3 pt-3' : 'p-3'}>
          <Notices notices={notices} />
        </div>
      ) : null}

      {shorts.length > 0 ? (
        <button
          type="button"
          onClick={() => setOpen((on) => !on)}
          aria-expanded={open}
          className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          {open ? (
            <ChevronDown className="size-4 shrink-0" aria-hidden />
          ) : (
            <ChevronRight className="size-4 shrink-0" aria-hidden />
          )}
          <Clapperboard
            className="size-4 shrink-0 text-[var(--color-text-secondary)]"
            aria-hidden
          />
          <span className="font-medium">
            {shorts.length} Shorts candidate{shorts.length === 1 ? '' : 's'} in this chapter
          </span>
        </button>
      ) : null}

      {open && shorts.length > 0 ? (
        <div className="flex flex-col gap-2 p-3 pt-0 text-[13px]">
          {shorts.map((candidate, index) => (
            <div key={index} className="rounded-[6px] border border-[var(--color-border)] p-2">
              <p className="text-[var(--color-text-secondary)]">{candidate.hookRationale}</p>
              <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">
                “{candidate.startSentence}” … “{candidate.endSentence}”
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}
```

In `apps/web/app/(console)/projects/[id]/page.tsx`, in the `<ScriptStudio` element (lines 516 to 523), replace

```tsx
          usedFallbackModel={usedFallbackModel}
        />
```

with

```tsx
          usedFallbackModel={usedFallbackModel}
          notices={noticesFor(notices, 'script')}
        />
```

(`noticesFor` and `notices` are on this page since Task 3.)

- [ ] **Step 16: Run the strip test, the typecheck and every consuming suite**

Run: `cd apps/web && pnpm exec vitest run "app/(console)/projects/[id]/script-studio.test.tsx"`
Expected: PASS (4 tests).

Run: `pnpm typecheck` from the root, then `cd apps/web && pnpm test` (alone; `timeout: 600000` each).
Expected: clean; PASS. The Shorts parser and the script schema changed, and Steps 5 ran the providers and schemas suites.

- [ ] **Step 17: Commit the marking and the strip**

```bash
pnpm exec prettier --write apps/web/lib/script-answers.ts apps/web/lib/script-answers.test.ts apps/web/inngest/functions/script-runner.ts apps/web/inngest/functions/script-runner.test.ts apps/web/inngest/functions/shorts-runner.ts apps/web/inngest/functions/shorts-runner.test.ts "apps/web/app/(console)/projects/[id]/script-studio.tsx" "apps/web/app/(console)/projects/[id]/script-studio.test.tsx" "apps/web/app/(console)/projects/[id]/page.tsx"
pnpm exec prettier --check apps/web/lib/script-answers.ts apps/web/lib/script-answers.test.ts apps/web/inngest/functions/script-runner.ts apps/web/inngest/functions/script-runner.test.ts apps/web/inngest/functions/shorts-runner.ts apps/web/inngest/functions/shorts-runner.test.ts "apps/web/app/(console)/projects/[id]/script-studio.tsx" "apps/web/app/(console)/projects/[id]/script-studio.test.tsx" "apps/web/app/(console)/projects/[id]/page.tsx"
pnpm exec eslint --max-warnings 0 apps/web/lib/script-answers.ts apps/web/lib/script-answers.test.ts apps/web/inngest/functions/script-runner.ts apps/web/inngest/functions/script-runner.test.ts apps/web/inngest/functions/shorts-runner.ts apps/web/inngest/functions/shorts-runner.test.ts "apps/web/app/(console)/projects/[id]/script-studio.tsx" "apps/web/app/(console)/projects/[id]/script-studio.test.tsx" "apps/web/app/(console)/projects/[id]/page.tsx"
git add apps/web/lib/script-answers.ts apps/web/lib/script-answers.test.ts apps/web/inngest/functions/script-runner.ts apps/web/inngest/functions/script-runner.test.ts apps/web/inngest/functions/shorts-runner.ts apps/web/inngest/functions/shorts-runner.test.ts "apps/web/app/(console)/projects/[id]/script-studio.tsx" "apps/web/app/(console)/projects/[id]/script-studio.test.tsx" "apps/web/app/(console)/projects/[id]/page.tsx"
git commit -F <message file>
```

Message: `feat(script): the script stage marks Shorts on the answer helper and says on the strip why it stopped (decision 293)` plus the trailer.

---

### Task 13: Plain text and title options

**Files:**
- Modify: `apps/web/lib/answer-call.ts` (the whole of `completeForProject`, lines 4 to 12)
- Create: `apps/web/lib/answer-call.test.ts`
- Modify: `apps/web/lib/script-answers.ts` (imports lines 1 to 9; append `draftChapterWith` after `markShortsWith`)
- Test: `apps/web/lib/script-answers.test.ts` (imports lines 1 to 4; append a describe)
- Modify: `apps/web/inngest/functions/script-runner.ts` (imports lines 16 to 40; `draft-chapter-N` lines 193 to 216)
- Modify: `apps/web/inngest/functions/analytics-runner.ts` (imports lines 11 to 17; `writeDigestWith` after `worstRetentionDrop`, line 74; `weekly-digest` lines 272 to 287)
- Test: `apps/web/inngest/functions/analytics-runner.test.ts` (imports lines 3 to 18; a new describe after `worstRetentionDrop`'s, line 61) (the file holds database tests)
- Modify: `apps/web/app/(console)/projects/[id]/actions.ts` (imports lines 15 to 31; `regenerateSection` lines 246 to 269)
- Create: `apps/web/app/(console)/projects/[id]/actions.test.ts` (database)
- Modify: `apps/web/app/(console)/projects/[id]/publish-actions.ts` (imports lines 25 to 36; `generateTitles` lines 170 to 194)
- Create: `apps/web/app/(console)/projects/[id]/publish-actions.test.ts` (database)

**Interfaces:**
- Consumes: `callForText`, `callForAnswer` with `parse(text, note)`, `Answer<T>` (Task 1, `@/lib/answer`); stage 1's `answerOrStop`, `ANSWER_CUT_OFF`, `AnswerComplete` (`@/lib/answer`) and `completeForProject` (`@/lib/answer-call`); stage 1's `buildChapterRequest`, `buildDigestRequest`, `buildRegenerateRequest`, `buildTitlesRequest`, `parseTitleOptions`, `MAX_OUTPUT_TOKENS` (`@boom-busters/providers`).
- Produces:
  - `completeForProject(projectId: string, firstCall?: { estimateOutputTokens?: number }): AnswerComplete` (`apps/web/lib/answer-call.ts`): the first call carries the task's own estimate; a retry is estimated at its full budget and carries its `purpose` label. Existing callers are unchanged.
  - `draftChapterWith(complete: AnswerComplete, input: Parameters<typeof buildChapterRequest>[0]): Promise<string>` (`@/lib/script-answers`): the whole chapter, or an `answerOrStop` stop `Chapter N could not be drafted: <issue>` (N counted from 1).
  - `writeDigestWith(complete: AnswerComplete, input: Parameters<typeof buildDigestRequest>[0]): Promise<string>` (`apps/web/inngest/functions/analytics-runner.ts`): the whole digest, or a stop `The weekly digest could not be written: <issue>`.
  - `regenerateSection` returns `{ ok: false, error: <issue> }` on a stop; `generateTitles` returns `{ ok: false, error: 'The titles could not be generated: <issue>' }`.

No existing test relied on a half answer being kept, so none is rewritten: `script-runner.ts` has no test file; `analytics-runner.test.ts` reaches the digest only in mock mode (`mockDigest`), which this task leaves alone; `regenerateSection` and `generateTitles` had no tests (`publish-screen.test.tsx` mocks `./publish-actions` whole, and `script-studio` has no test of the action). The mock paths (`mockChapter`, `mockDigest`, `mockRegeneratedSection`, `mockTitleOptions`) are unchanged, so the e2e suite is unaffected.

- [ ] **Step 1: Write the failing unit tests**

Create `apps/web/lib/answer-call.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { LLMTaskRequest } from '@boom-busters/providers'

const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))

import { completeForProject } from './answer-call'

const PROJECT = '01J0000000000000000000000P'

const request: LLMTaskRequest = {
  task: 'scripting',
  system: 'system',
  messages: [{ role: 'user', content: 'Write chapter two.' }],
  maxTokens: 1000,
}

describe('completeForProject (decisions 292, 293)', () => {
  it('estimates the first call as the task says, and a labelled retry at its full budget', async () => {
    callLlm.mockReset()
    callLlm.mockResolvedValue({ text: 'A chapter.' })
    const complete = completeForProject(PROJECT, { estimateOutputTokens: 800 })
    await complete(request, 'answer')
    await complete({ ...request, maxTokens: 2000 }, 'retry: cut off')
    expect(callLlm.mock.calls[0]![1]).toEqual({ projectId: PROJECT, estimateOutputTokens: 800 })
    expect(callLlm.mock.calls[1]![1]).toEqual({ projectId: PROJECT, purpose: 'retry: cut off' })
  })

  it('leaves the estimate to the budget when the task gives none', async () => {
    callLlm.mockReset()
    callLlm.mockResolvedValue({ text: 'A passage.' })
    await completeForProject(PROJECT)(request, 'answer')
    expect(callLlm).toHaveBeenCalledWith(request, { projectId: PROJECT })
  })
})
```

In `apps/web/lib/script-answers.test.ts`, replace the imports (lines 1 to 4):

```ts
import { describe, expect, it, vi } from 'vitest'
import { mockOutline, mockSelfCheck, mockShortsCandidates } from '@boom-busters/providers'
import { NonRetriableError } from 'inngest'
import { draftOutlineWith, markShortsWith, selfCheckWith } from './script-answers'
```

with (keep any name Task 12 added to these lines):

```ts
import { describe, expect, it, vi } from 'vitest'
import {
  buildChapterRequest,
  MAX_OUTPUT_TOKENS,
  mockOutline,
  mockSelfCheck,
  mockShortsCandidates,
} from '@boom-busters/providers'
import { BudgetExceededError } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { draftChapterWith, draftOutlineWith, markShortsWith, selfCheckWith } from './script-answers'
```

and append at the end of the file:

```ts
describe('the chapter draft (decision 293)', () => {
  const chapterInput = {
    caseTitle: 'Case',
    outline: mockOutline(10),
    chapterIndex: 1,
    previousTail: 'The money was gone.',
    claims: [],
  }
  const request = buildChapterRequest(chapterInput)

  it('drafts a chapter in one call when the reply is whole', async () => {
    const complete = vi.fn().mockResolvedValue({ text: 'A whole chapter.' })
    expect(await draftChapterWith(complete, chapterInput)).toBe('A whole chapter.')
    expect(complete).toHaveBeenCalledTimes(1)
    expect(complete).toHaveBeenCalledWith(request, 'answer')
  })

  it('asks once more at double the budget when the chapter is cut off, and keeps none of the half', async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ text: 'By June the auditors could', truncated: true })
      .mockResolvedValueOnce({ text: 'By June the auditors could not find the money.' })
    expect(await draftChapterWith(complete, chapterInput)).toBe(
      'By June the auditors could not find the money.',
    )
    expect(complete.mock.calls[1]![0]).toEqual({
      ...request,
      maxTokens: Math.min(MAX_OUTPUT_TOKENS, request.maxTokens * 2),
    })
    expect(complete.mock.calls[1]![1]).toBe('retry: cut off')
  })

  it('stops the stage after a second cut-off, naming the chapter by its number', async () => {
    const complete = vi.fn().mockResolvedValue({ text: 'By June the auditors', truncated: true })
    const drafting = draftChapterWith(complete, chapterInput)
    await expect(drafting).rejects.toBeInstanceOf(NonRetriableError)
    await expect(drafting).rejects.toThrow(
      'Chapter 2 could not be drafted: the answer was cut off at its length limit',
    )
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it('lets a budget stop through, for the runner to park on its gate', async () => {
    const over = new BudgetExceededError({
      provider: 'anthropic',
      operation: 'llm.scripting',
      budgetUsd: 30,
      monthSpendUsd: 29.9,
      estimateUsd: 0.4,
    })
    await expect(draftChapterWith(vi.fn().mockRejectedValue(over), chapterInput)).rejects.toBe(
      over,
    )
  })
})
```

In `apps/web/inngest/functions/analytics-runner.test.ts`:

- After line 13 (the closing `} from '@boom-busters/db'`), add:

```ts
import { buildDigestRequest } from '@boom-busters/providers'
import type { DigestLine } from '@boom-busters/providers'
import { BudgetExceededError } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
```

- Replace line 18, `import { analyticsRunner, worstRetentionDrop } from './analytics-runner'`, with `import { analyticsRunner, worstRetentionDrop, writeDigestWith } from './analytics-runner'`.
- After the `worstRetentionDrop` describe (ends line 61), add (no database):

```ts
describe('writeDigestWith (decision 293)', () => {
  const lines: DigestLine[] = [
    {
      label: 'The audit',
      targetType: 'master',
      views: 1200,
      viewsDelta: 300,
      avgViewDurationSec: 210,
      topSource: 'BROWSE',
      worstDropPct: 40,
    },
  ]
  const input = { weekOf: '2026-08-31', lines }
  const budget = buildDigestRequest(input).maxTokens

  it('asks once more at double the budget when the digest is cut off, and sends none of the half', async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ text: 'Views rose by 300 this week, led by', truncated: true })
      .mockResolvedValueOnce({ text: 'Views rose by 300 this week, led by browse.' })
    expect(await writeDigestWith(complete, input)).toBe(
      'Views rose by 300 this week, led by browse.',
    )
    expect(complete).toHaveBeenCalledTimes(2)
    expect(complete.mock.calls[1]![0].maxTokens).toBe(budget * 2)
    expect(complete.mock.calls[1]![1]).toBe('retry: cut off')
  })

  it('stops with the reason after a second cut-off, for onFailure to report', async () => {
    const complete = vi.fn().mockResolvedValue({ text: 'Views rose by', truncated: true })
    const writing = writeDigestWith(complete, input)
    await expect(writing).rejects.toBeInstanceOf(NonRetriableError)
    await expect(writing).rejects.toThrow(
      'The weekly digest could not be written: the answer was cut off at its length limit',
    )
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it('lets a budget stop through, for the step to skip the digest quietly', async () => {
    const over = new BudgetExceededError({
      provider: 'anthropic',
      operation: 'llm.digest',
      budgetUsd: 30,
      monthSpendUsd: 30,
      estimateUsd: 0.01,
    })
    await expect(writeDigestWith(vi.fn().mockRejectedValue(over), input)).rejects.toBe(over)
  })
})
```

(`budget` is `outputBudget(700)`, 4,700 tokens; doubled it is 9,400, under the 32,000 cap.)

- [ ] **Step 2: Run them to see them fail**

Run (the analytics file holds database tests, so alone; `timeout: 600000`): `cd apps/web && pnpm exec vitest run lib/answer-call.test.ts lib/script-answers.test.ts inngest/functions/analytics-runner.test.ts`
Expected: FAIL. `answer-call.test.ts`: the first test sees `{ projectId }` with no estimate. `script-answers.test.ts`: `draftChapterWith` is not a function. `analytics-runner.test.ts`: `writeDigestWith` is not a function; the other analytics tests still pass.

- [ ] **Step 3: Let `completeForProject` carry a first-call estimate**

Replace the whole of `apps/web/lib/answer-call.ts` below its imports (lines 4 to 12):

```ts
/**
 * `callForAnswer`'s call for the app (decision 292): the ledgered `callLlm`,
 * with a retry labelled in the cost ledger. Kept out of `answer.ts`, which
 * the live harnesses import and which must not pull in the database.
 */
export function completeForProject(projectId: string): AnswerComplete {
  return (request, call) =>
    callLlm(request, { projectId, ...(call === 'answer' ? {} : { purpose: call }) })
}
```

with:

```ts
/**
 * `callForAnswer`'s call for the app (decision 292): the ledgered `callLlm`,
 * with a retry labelled in the cost ledger. Kept out of `answer.ts`, which
 * the live harnesses import and which must not pull in the database.
 *
 * `firstCall.estimateOutputTokens` narrows the first call's budget estimate
 * for a task that knows how long its answer runs (a chapter, the title
 * options; decision 293). A retry keeps the full-budget estimate: it exists
 * because an answer ran long or went wrong, and an estimate that is too low
 * is the one that walks through a cap.
 */
export function completeForProject(
  projectId: string,
  firstCall: { estimateOutputTokens?: number } = {},
): AnswerComplete {
  return (request, call) =>
    callLlm(request, { projectId, ...(call === 'answer' ? firstCall : { purpose: call }) })
}
```

- [ ] **Step 4: Draft each chapter on `callForText`**

In `apps/web/lib/script-answers.ts`:

- Add `buildChapterRequest` to the import from `@boom-busters/providers` (lines 1 to 8).
- Add `callForText` to the import from `@/lib/answer` (line 9), so it reads `import { answerOrStop, callForAnswer, callForText, type AnswerComplete } from '@/lib/answer'`.
- Append at the end of the file:

```ts
/**
 * One chapter's narration (decision 293): plain text on `callForText`, so a
 * reply cut off at its budget is asked once more at double it, and a second
 * cut-off stops the stage with the reason. Half a chapter is never returned:
 * saved, it would be read aloud mid-sentence and become the next chapter's seam.
 */
export async function draftChapterWith(
  complete: AnswerComplete,
  input: Parameters<typeof buildChapterRequest>[0],
): Promise<string> {
  return answerOrStop(
    await callForText({ request: buildChapterRequest(input), complete }),
    `Chapter ${input.chapterIndex + 1} could not be drafted`,
  )
}
```

In `apps/web/inngest/functions/script-runner.ts`:

- Remove `buildChapterRequest,` from the `@boom-busters/providers` import (line 17).
- Add `draftChapterWith` to the `@/lib/script-answers` import (line 40).
- In the `draft-chapter-${index}` step, replace (lines 197 to 215):

```ts
            try {
              contentMd = (
                await callLlm(
                  buildChapterRequest({
                    caseTitle: setup.caseTitle,
                    outline,
                    chapterIndex: index,
                    previousTail,
                    claims: setup.claims,
                  }),
                  { projectId, estimateOutputTokens: Math.round(chapter.targetWords * 1.6) },
                )
              ).text
            } catch (error) {
              if (error instanceof BudgetExceededError) {
                return { ok: false, gate: budgetGateData(error) }
              }
              throw error
            }
```

with:

```ts
            try {
              // At most two calls (decision 293): a chapter cut off at its
              // budget is asked once more at double it, and a second cut-off
              // stops the stage with the reason. The chapters already saved
              // are kept; half of this one never is.
              contentMd = await draftChapterWith(
                completeForProject(projectId, {
                  estimateOutputTokens: Math.round(chapter.targetWords * 1.6),
                }),
                {
                  caseTitle: setup.caseTitle,
                  outline,
                  chapterIndex: index,
                  previousTail,
                  claims: setup.claims,
                },
              )
            } catch (error) {
              if (error instanceof BudgetExceededError) {
                return { ok: false, gate: budgetGateData(error) }
              }
              throw error
            }
```

- Task 12 has already moved `mark-shorts` onto `markShortsWith`, so no `callLlm(` should remain. Run `grep -n "callLlm" apps/web/inngest/functions/script-runner.ts`: when only the import (line 39) is listed, delete `import { callLlm } from '@/lib/llm'`; when a call is still listed, keep the import.

The stop is the `NonRetriableError` from `answerOrStop`, thrown out of the step: `onFailure` (lines 92 to 99) marks the stage failed with `Chapter N could not be drafted: <issue>`, which the Needs-you card shows; the chapters saved by earlier steps stay.

- [ ] **Step 5: Write the weekly digest on `callForText`**

In `apps/web/inngest/functions/analytics-runner.ts`:

- After line 13, `import { BudgetExceededError } from '@boom-busters/schemas'`, add `import { answerOrStop, callForText, type AnswerComplete } from '@/lib/answer'`.
- After `worstRetentionDrop` (ends line 74), add:

```ts

/**
 * The Monday digest's prose (decision 293): plain text on `callForText`, so a
 * reply cut off at its budget is asked once more at double it, and a second
 * cut-off stops the run with the reason instead of mailing half a digest.
 * The stop is a `NonRetriableError`: `onFailure` says so, and no blind retry
 * buys the same cut-off again.
 */
export async function writeDigestWith(
  complete: AnswerComplete,
  input: Parameters<typeof buildDigestRequest>[0],
): Promise<string> {
  return answerOrStop(
    await callForText({ request: buildDigestRequest(input), complete }),
    'The weekly digest could not be written',
  )
}
```

- In the `weekly-digest` step, replace (line 277):

```ts
          body = (await callLlm(buildDigestRequest({ weekOf, lines }))).text
```

with:

```ts
          // Not a project's spend, so no project on the ledger row; a retry
          // still carries its label to the Costs screen (decision 292).
          body = await writeDigestWith(
            (request, call) => callLlm(request, call === 'answer' ? {} : { purpose: call }),
            { weekOf, lines },
          )
```

The surrounding `try` and its `BudgetExceededError` branch (lines 276 to 286) stay as they are; the stop passes through the `catch`'s `throw error`, so `notify` (lines 289 to 294) is never reached and the digest is not sent.

- [ ] **Step 6: Run the unit tests to see them pass**

Run (alone, `timeout: 600000`): `cd apps/web && pnpm exec vitest run lib/answer-call.test.ts lib/script-answers.test.ts inngest/functions/analytics-runner.test.ts`
Expected: PASS. `answer-call.test.ts` 2 tests; `script-answers.test.ts` its existing tests plus 4; `analytics-runner.test.ts` 7 tests (1 + 3 new + 3 database).

- [ ] **Step 7: Write the failing action tests**

Create `apps/web/app/(console)/projects/[id]/actions.test.ts` (database):

```ts
// @vitest-environment node

import {
  createScriptVersion,
  FIXTURE_PROJECT_ID,
  requireTestDatabase,
  saveChapter,
  seed,
} from '@boom-busters/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ANSWER_CUT_OFF } from '@/lib/answer'
import { db } from '@/lib/db'
import { regenerateSection } from './actions'

/**
 * The Regenerate button's rewrite (decision 293) against the test database:
 * plain text on `callForText`, so a passage cut off at its budget is asked
 * once more at double it, and half a passage never reaches the diff view.
 */

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { email: 'owner@example.com' } })),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))

const describeDb = requireTestDatabase() ? describe : describe.skip

const SELECTION = 'By June, the auditors could not find the money anywhere at all.'

describeDb('regenerateSection (decision 293)', () => {
  let chapterId = ''

  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockReset()
    await seed(db)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    const chapter = await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The audit',
      contentMd: `${SELECTION} EY refused to sign the accounts.`,
      estRuntimeSec: 20,
    })
    chapterId = chapter.id
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('asks once more at double the budget when the passage is cut off, and proposes none of the half', async () => {
    callLlm
      .mockResolvedValueOnce({ text: 'By June, the auditors', truncated: true })
      .mockResolvedValueOnce({ text: '  By June, nobody could say where the money had gone.  ' })

    expect(
      await regenerateSection(FIXTURE_PROJECT_ID, chapterId, SELECTION, 'Make it plainer'),
    ).toEqual({ ok: true, proposal: 'By June, nobody could say where the money had gone.' })

    const [first, second] = callLlm.mock.calls
    expect(first![1]).toEqual({ projectId: FIXTURE_PROJECT_ID })
    expect(second![0].maxTokens).toBe(first![0].maxTokens * 2)
    expect(second![1]).toEqual({ projectId: FIXTURE_PROJECT_ID, purpose: 'retry: cut off' })
  })

  it('returns the reason for the toast after a second cut-off', async () => {
    callLlm.mockResolvedValue({ text: 'By June, the auditors', truncated: true })

    expect(
      await regenerateSection(FIXTURE_PROJECT_ID, chapterId, SELECTION, 'Make it plainer'),
    ).toEqual({ ok: false, error: ANSWER_CUT_OFF })
    expect(callLlm).toHaveBeenCalledTimes(2)
  })
})
```

Create `apps/web/app/(console)/projects/[id]/publish-actions.test.ts` (database):

```ts
// @vitest-environment node

import {
  FIXTURE_PROJECT_ID,
  getPublishRecord,
  publishRecords,
  requireTestDatabase,
  seed,
} from '@boom-busters/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { generateTitles } from './publish-actions'

/**
 * The Generate titles button (decision 293) against the test database: at
 * most two calls, so a cut-off answer is asked once more at double the
 * budget, and half a list of titles is never offered.
 */

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { email: 'owner@example.com' } })),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))

const describeDb = requireTestDatabase() ? describe : describe.skip

const HALF = '{"titles": ["The audit that said no to the mon'
const WHOLE = JSON.stringify({
  titles: ['The audit that said no to the money', 'Nine days from a record high to nothing'],
})

describeDb('generateTitles (decision 293)', () => {
  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockReset()
    await seed(db)
    // A record another suite scheduled would refuse the edit.
    await db.delete(publishRecords)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('asks once more at double the budget when the titles are cut off, and offers none of the half', async () => {
    callLlm
      .mockResolvedValueOnce({ text: HALF, truncated: true })
      .mockResolvedValueOnce({ text: WHOLE })

    expect(await generateTitles('master', FIXTURE_PROJECT_ID)).toEqual({ ok: true })

    const [first, second] = callLlm.mock.calls
    expect(first![1]).toEqual({ projectId: FIXTURE_PROJECT_ID, estimateOutputTokens: 500 })
    expect(second![0].maxTokens).toBe(first![0].maxTokens * 2)
    expect(second![1]).toEqual({ projectId: FIXTURE_PROJECT_ID, purpose: 'retry: cut off' })
    expect((await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))?.metadata).toMatchObject({
      titleOptions: ['The audit that said no to the money', 'Nine days from a record high to nothing'],
    })
  })

  it('stops after a second cut-off with the reason, and offers nothing', async () => {
    callLlm.mockResolvedValue({ text: HALF, truncated: true })

    expect(await generateTitles('master', FIXTURE_PROJECT_ID)).toEqual({
      ok: false,
      error: 'The titles could not be generated: the answer was cut off at its length limit',
    })
    expect(callLlm).toHaveBeenCalledTimes(2)
    expect((await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID))?.metadata).not.toHaveProperty(
      'titleOptions',
    )
  })
})
```

- [ ] **Step 8: Run them to see them fail**

Run (database; alone, `timeout: 600000`): `cd apps/web && pnpm exec vitest run "app/(console)/projects/[id]/actions.test.ts" "app/(console)/projects/[id]/publish-actions.test.ts"`
Expected: FAIL, all four tests. `regenerateSection` proposes the half passage `By June, the auditors` after one call. `generateTitles` returns `The titles could not be generated: ...` after one call for the first test, and its one-call error is the parser's message, not the cut-off reason, for the second.

- [ ] **Step 9: Rewrite a passage on `callForText`**

In `apps/web/app/(console)/projects/[id]/actions.ts` (a `'use server'` file: it imports the helpers and exports only async functions):

- Replace line 31, `import { callLlm } from '@/lib/llm'`, with:

```ts
import { callForText } from '@/lib/answer'
import { completeForProject } from '@/lib/answer-call'
```

- Replace the `try` block of `regenerateSection` (lines 246 to 262):

```ts
  try {
    const proposal = mockProvidersEnabled()
      ? mockRegeneratedSection(selection, note)
      : (
          await callLlm(
            buildRegenerateRequest({
              chapterTitle: chapter.title,
              contentMd: chapter.contentMd,
              selection,
              note,
              claims,
            }),
            { projectId },
          )
        ).text.trim()

    return { ok: true, proposal }
  } catch (error) {
```

with:

```ts
  try {
    if (mockProvidersEnabled()) {
      return { ok: true, proposal: mockRegeneratedSection(selection, note) }
    }
    // At most two calls (decision 293): a passage cut off at its budget is
    // asked once more at double it, so half a passage never reaches the diff.
    const answer = await callForText({
      request: buildRegenerateRequest({
        chapterTitle: chapter.title,
        contentMd: chapter.contentMd,
        selection,
        note,
        claims,
      }),
      complete: completeForProject(projectId),
    })
    if (!answer.ok) return { ok: false, error: answer.issue }
    return { ok: true, proposal: answer.value.trim() }
  } catch (error) {
```

The `catch` body (lines 263 to 269) stays: a budget stop, a provider error or a wrapped call-side error still returns its message for the toast.

- [ ] **Step 10: Ask for title options on `callForAnswer`**

In `apps/web/app/(console)/projects/[id]/publish-actions.ts` (a `'use server'` file):

- Replace line 36, `import { callLlm } from '@/lib/llm'`, with:

```ts
import { callForAnswer } from '@/lib/answer'
import { completeForProject } from '@/lib/answer-call'
```

- In `generateTitles`, replace (lines 174 to 193):

```ts
    const { hook } = await descriptionIngredients(db, projectId)
    try {
      const result = await callLlm(
        buildTitlesRequest({
          caseTitle: project.caseTitle,
          hook: hook || project.title,
          target: type,
          workingTitle,
        }),
        { projectId, estimateOutputTokens: 500 },
      )
      titles = parseTitleOptions(result.text)
    } catch (error) {
      return {
        ok: false,
        error: `The titles could not be generated: ${
          error instanceof Error ? error.message : String(error)
        }`,
      }
    }
```

with:

```ts
    const { hook } = await descriptionIngredients(db, projectId)
    try {
      // At most two calls (decision 293): a cut-off is asked once more at
      // double the budget, a refusal once more with its reason. An unusable
      // title is still dropped by the parser, as ordinary filtering.
      const answer = await callForAnswer({
        request: buildTitlesRequest({
          caseTitle: project.caseTitle,
          hook: hook || project.title,
          target: type,
          workingTitle,
        }),
        parse: (text) => parseTitleOptions(text),
        complete: completeForProject(projectId, { estimateOutputTokens: 500 }),
      })
      if (!answer.ok) {
        return { ok: false, error: `The titles could not be generated: ${answer.issue}` }
      }
      titles = answer.value
    } catch (error) {
      return {
        ok: false,
        error: `The titles could not be generated: ${
          error instanceof Error ? error.message : String(error)
        }`,
      }
    }
```

- [ ] **Step 11: Run the action tests to see them pass**

Run (database; alone, `timeout: 600000`): `cd apps/web && pnpm exec vitest run "app/(console)/projects/[id]/actions.test.ts" "app/(console)/projects/[id]/publish-actions.test.ts"`
Expected: PASS (4 tests).

- [ ] **Step 12: Run the consuming suites and the typecheck**

`completeForProject` is shared by the outline, self-check, Shorts marking, book, Fix and scoring calls, so run them with this task's files (database; alone, one process, `timeout: 600000`): `cd apps/web && pnpm exec vitest run lib/answer.test.ts lib/answer-call.test.ts lib/script-answers.test.ts inngest/functions/analytics-runner.test.ts inngest/functions/shorts-runner.test.ts inngest/functions/visuals-replanner.test.ts "app/(console)/projects/[id]/actions.test.ts" "app/(console)/projects/[id]/publish-actions.test.ts" "app/(console)/projects/[id]/publish-screen.test.tsx"`
Expected: PASS.

Then from the root: `pnpm typecheck` (`timeout: 600000`).
Expected: clean.

Then from the root: `pnpm exec prettier --write <files>`, `pnpm exec prettier --check <files>` and `pnpm exec eslint --max-warnings 0 <files>`, where `<files>` is the `git add` list below.
Expected: clean (ESLint flags a `callLlm` or `buildChapterRequest` import left unused).

- [ ] **Step 13: Commit**

```bash
git add apps/web/lib/answer-call.ts apps/web/lib/answer-call.test.ts apps/web/lib/script-answers.ts apps/web/lib/script-answers.test.ts apps/web/inngest/functions/script-runner.ts apps/web/inngest/functions/analytics-runner.ts apps/web/inngest/functions/analytics-runner.test.ts "apps/web/app/(console)/projects/[id]/actions.ts" "apps/web/app/(console)/projects/[id]/actions.test.ts" "apps/web/app/(console)/projects/[id]/publish-actions.ts" "apps/web/app/(console)/projects/[id]/publish-actions.test.ts"
git commit -F <message file>
```

Message: `feat(answer): chapters, the digest and section rewrites keep nothing half-written, and title options cost at most two calls (decision 293)` plus the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

---

### Task 14: The e2e notice test, the full suite and PROGRESS

**Files:**
- Create: `e2e/tests/notices.spec.ts`
- Modify: `PROGRESS.md` (append decision 293)

**Interfaces:**
- Consumes: `addNotice` (Task 2), the `Notices` component on the Direction card (Tasks 3 and 5), `VISUAL_PLAN_TITLE` (`e2e/global-setup.ts`), `signIn` (`e2e/tests/fixtures.ts`), `e2eDatabaseUrl` (`e2e/database.ts`).
- Produces: nothing later tasks use.

- [ ] **Step 1: Write the e2e test**

Create `e2e/tests/notices.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test'
import { VISUAL_PLAN_TITLE } from '../global-setup'
import { signIn } from './fixtures'

/**
 * Notices (decision 293): a line on the card an answer concerns, with a
 * Dismiss button. Seeded straight into the database (no model runs in e2e)
 * on the plan project's Direction card, then dismissed with the button.
 */

const MESSAGE = 'Trimmed to fit: era rule 1 (e2e).'

async function clearNotice(): Promise<void> {
  const { createDb } = await import('@boom-busters/db')
  const { e2eDatabaseUrl } = await import('../database')
  const connection = createDb(e2eDatabaseUrl(), { max: 1 })
  try {
    await connection.sql`delete from notices where message = ${MESSAGE}`
  } finally {
    await connection.sql.end({ timeout: 5 })
  }
}

async function seedNotice(): Promise<void> {
  const { addNotice, createDb } = await import('@boom-busters/db')
  const { e2eDatabaseUrl } = await import('../database')
  const connection = createDb(e2eDatabaseUrl(), { max: 1 })
  try {
    const [project] = await connection.sql<{ id: string }[]>`
      select id from projects where title = ${VISUAL_PLAN_TITLE}`
    if (!project) throw new Error('The plan project is not seeded')
    await addNotice(connection.db, { projectId: project.id, subject: 'direction', subjectId: null }, {
      kind: 'trimmed',
      message: MESSAGE,
    })
  } finally {
    await connection.sql.end({ timeout: 5 })
  }
}

async function openPlan(page: Page): Promise<void> {
  await page.goto('/projects')
  await expect(async () => {
    await page
      .getByRole('listitem')
      .filter({ hasText: VISUAL_PLAN_TITLE })
      .getByRole('link')
      .first()
      .click()
    await expect(page).toHaveURL(/\/projects\/[0-9A-Z]{26}/, { timeout: 8_000 })
  }).toPass({ timeout: 30_000 })
}

// Before as well as after: an interrupted earlier run can leave its notice,
// and two copies would put two Dismiss buttons on the card.
test.beforeEach(async () => {
  await clearNotice()
})

test.afterEach(async () => {
  await clearNotice()
})

test('a notice on the Direction card is dismissed with its button', async ({ page }) => {
  await seedNotice()
  await signIn(page)
  await openPlan(page)

  const line = page.getByRole('status').filter({ hasText: MESSAGE })
  await expect(line).toBeVisible()
  await line.locator('xpath=..').getByRole('button', { name: 'Dismiss' }).click()
  await expect(page.getByRole('status').filter({ hasText: MESSAGE })).toHaveCount(0)

  await page.reload()
  await expect(page.getByRole('status').filter({ hasText: MESSAGE })).toHaveCount(0)
})
```

The config runs one worker, and only the `desktop` project picks this file up (`mobile-390` matches `mobile.spec.ts` alone), so one notice is seeded per run; `clearNotice` removes it even when the test fails midway.

- [ ] **Step 2: Run the e2e test alone**

Run: `cd e2e && pnpm exec playwright test tests/notices.spec.ts` (`timeout: 600000`; free port 3100 first if an earlier run left a server: `netstat -ano | grep ":3100 .*LISTENING"`).
Expected: 1 passed (desktop).

- [ ] **Step 3: Run the whole suite**

One at a time, each with `timeout: 600000`, Docker Desktop running:
`cd packages/schemas && pnpm test`, `cd packages/providers && pnpm test`, `cd packages/db && pnpm test`, `cd apps/web && pnpm test`, `pnpm typecheck` from the root, lint of the tracked files (`git ls-files '*.ts' '*.tsx' | grep -v '^.agents/' | xargs -n 80 pnpm exec eslint --max-warnings 0`), then `cd e2e && pnpm exec playwright test`.
Expected: all PASS. A web test that fails in the full run is re-run alone before it is believed (a composition snapshot that fails only in the full run is a known flake; never regenerate a golden from it).

- [ ] **Step 4: Record decision 293**

Check that 293 is free: `git fetch origin master -q && git show origin/master:PROGRESS.md | grep -nE "^29[0-9]\. " | tail -3`. If it is taken, use the next number here and in the commit subject, and say so in the report.

Append to `PROGRESS.md`, after decision 292, in its numbered-list style:

```markdown
293. **Every answer within its limits, and told where it lands (stage 2 of
     292)** (2026-10-09, owner). Stage 1 put eight tasks on one helper; a
     survey found eighteen calls still off it: no limits stated in most
     prompts (none in the dossier's four), every structured answer refused
     whole for one long field or one bad claim, the chapter draft and the
     digest re-buying identical calls and keeping half-written text, the
     teaser and the Script stage's Shorts marking failing silently, and a
     side job that stopped while a gate was parked reaching only a server
     log line (production has no Resend key), so a stopped redraft showed
     nothing in the app. Stage 1's trims were silent too.
     Owner's rulings: notices go on the card they concern, with a Dismiss
     button, from one store; one item in a list that breaks a rule on a
     fact is dropped and the rest kept; the teaser and the Shorts marking
     are fixed as well.
     What shipped: a parser reports each repair through `note`, and the
     helper returns the repairs of the attempt that succeeded; a deliberate
     decline (`AnswerDeclined`) and a provider's content refusal are final
     after one call; `callForText` gives plain text the same two calls,
     with a truncated reply always a cut-off and nothing half-written kept.
     The dossier's four passes, case suggestions, the teaser, cast
     identity, re-brief, redirect, retype, the Script stage's Shorts
     marking and title options are on the helper; the chapter draft, the
     digest and the section rewrite are on `callForText`. Every prompt
     states its limits, and each parser trims free text, caps lists and
     drops a bad item. A `notices` table (migration 0033) holds one line
     per answer or stop; the Direction card, the dossier review, Script
     Studio's Shorts strip, the Teaser card's place, each cast card, each
     slot card, each case row and a project strip show theirs, each with
     Dismiss; the next answer for a subject retires its old notes.
     `markSideJobFailed` writes a stopped notice while a gate is parked.
     Decisions made where the spec left room: a case's priority score is
     the model's own rating, so it is rounded and clamped with a notice
     (cost if wrong: a rating moves a few points); a teaser paragraph
     naming a chapter that does not exist is refused, not dropped (cost if
     wrong: one Sonnet call); a claim's text and an answer's echoed
     question are facts, dropped rather than trimmed (cost if wrong: one
     claim lost until research is re-run).
     Left as they were: the plan's automatic chapter repair (best effort;
     the Fix button covers it) and the set inventory (already refuses a
     truncated reply).
     Shipping: migration 0033 on the production database, then a Vercel
     deploy and `PUT /api/inngest`. No Remotion or broker deploy.
```

Run `pnpm exec prettier --write PROGRESS.md` then `--check`.

- [ ] **Step 5: Commit**

```bash
git add e2e/tests/notices.spec.ts PROGRESS.md
git commit -F <message file>
```

Message: `test(e2e): a notice is dismissed from the Direction card; PROGRESS decision 293` plus the trailer.
