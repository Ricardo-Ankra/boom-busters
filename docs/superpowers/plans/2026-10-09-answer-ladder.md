# One answer, at most two calls (decision 292, stage 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A model answer that is refused or cut off costs at most two calls, never a blind Inngest retry, and the Director's Book states and repairs its own limits so the owner's failed redraft lands on its first call.

**Architecture:** One pure helper, `callForAnswer` (`apps/web/lib/answer.ts`), runs a call, parses (each task's parser repairs before it validates), retries once (double budget after a cut-off, the reason appended after a refusal) and returns the value or the reason it stopped. `completeForProject` (`apps/web/lib/answer-call.ts`) binds it to the ledgered `callLlm`, labelling a retry in the cost ledger. Nine call sites move onto it; a stop becomes a `NonRetriableError` carrying the reason (or the task's own failure report), so Inngest never re-runs the same request.

**Tech Stack:** pnpm/turbo monorepo; Zod 4 (`packages/schemas`); prompts and parsers (`packages/providers`); Next.js + Inngest (`apps/web`), Vitest with `@inngest/test`.

**Spec:** `docs/superpowers/specs/2026-10-08-answer-ladder-design.md`

## Global Constraints

- At most two calls per answer. Call 2 is either the same request at double `maxTokens` (after a cut-off; capped at `MAX_OUTPUT_TOKENS`, 32,000; no call 2 when already at the cap) or the request with the reason appended as the last user message, exactly: `Your previous answer was refused: <reason>. Answer again in full with that fixed.` Never a third call.
- A cut-off is a `ValidationError` whose `field` is `'maxTokens'`, from the adapter (empty reply) or the parser (unclosed JSON). A refusal is any other `ValidationError` thrown by the PARSE. A `ValidationError` thrown by the CALL that is not a cut-off, a `BudgetExceededError` and any provider error pass straight through.
- The default stop issue for a final cut-off: `the answer was cut off at its length limit`.
- Ledger labels: a retry's `callLlm` options carry `purpose: 'retry: cut off'` or `purpose: 'retry: refused'`; the first call carries none.
- A stop inside an Inngest step is a `NonRetriableError` with the message `<what>: <issue>`, unless the task reports failure its own way (the redraft, the Fix repair, scoring, the graphics designer).
- Repair (trim) only free text; never names, the palette accent, era spans, enums, numbers, links or claim references. Trim: the last sentence end (`.`, `!` or `?` followed by whitespace or the end of the text) inside the limit, provided it lies in the second half of the limit; otherwise the last space; otherwise a hard cut.
- The Director's Book limits: every text value at most 600 characters; 1 to 6 era locks; exactly 3 motifs; at most 12 never-shows, 12 principals and 12 locations; one chapter entry per chapter, numbered as given.
- Mock-provider mode makes no paid call; nothing in this plan makes a live model call.
- Before every commit: `pnpm exec prettier --write` then `--check` on the files touched, and `pnpm exec eslint --max-warnings 0` on them. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (a subagent may use its own model's name).
- Long runs in the foreground with the Bash tool's `timeout: 600000`; never two database suites at once; Docker Desktop must be running for the web database tests. When a task changes a shared prompt or parser, run the consuming packages' suites.
- `apps/web/lib/answer.ts` imports no database, `server-only` or `callLlm` module (the live harnesses import it through `graphic-design-core.ts` and `plan-chapter.ts`).
- Work on branch `answer-ladder`; the spec is committed there (`7b11223`).

## Review Focus

1. A refusal whose retry is cut off must stop at two calls with the cut-off issue, not double again (the graphics designer used to allow this third call). Pinned in Task 1 and Task 7.
2. A `ValidationError` thrown by the call itself that is not a cut-off (an adapter refusing its input) must pass through, not be spent on a reason-retry. Pinned in Task 1.
3. Trimming must never cut a name, the accent or a span, and must not take an early abbreviation ("Dr.") or a decimal point ("$1.5") for a sentence end. Pinned in Task 2.
4. A redraft that stops must leave the stored book exactly as it was (the owner's edits included). Pinned in Task 3.
5. When scoring stops, the slot keeps every candidate in the provider's order, unranked, rather than none. Pinned in Task 6.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `apps/web/lib/answer.ts` (new) | `callForAnswer`, `withRefusal`, `answerOrStop`, `ANSWER_CUT_OFF`, types | 1 |
| `apps/web/lib/answer-call.ts` (new) | `completeForProject`: the helper bound to `callLlm`, retries labelled | 1 |
| `apps/web/lib/llm.ts` | `CallOptions.purpose`, written to the ledger row's `meta` | 1 |
| `packages/providers/src/prompts/repair.ts` (new) | `trimText` | 2 |
| `packages/schemas/src/direction.ts` | the book's limit constants | 2 |
| `packages/providers/src/prompts/direction.ts` | the prompt states the limits; `repairDirectorsBook` before validation | 2 |
| `apps/web/inngest/lib/direction.ts` | `draftDirectorsBook` and `rewriteStoredBriefs` on the helper | 3, 5 |
| `apps/web/inngest/functions/visuals-replanner.ts` | the redraft's stop | 3 |
| `apps/web/lib/script-answers.ts` (new) | outline, self-check and Shorts marking on the helper | 4 |
| `apps/web/inngest/functions/script-runner.ts`, `shorts-runner.ts` | call `script-answers` | 4 |
| `apps/web/lib/plan-chapter.ts` | the shot list on the helper | 5 |
| `apps/web/lib/visual-assets.ts` | scoring on the helper, unranked on a stop | 6 |
| `apps/web/lib/graphic-design-core.ts` | the designer on the helper, two calls at most | 7 |
| `PROGRESS.md` | decision 292 | 8 |

---

### Task 1: The helper and the ledger label

**Files:**
- Create: `apps/web/lib/answer.ts`, `apps/web/lib/answer.test.ts`, `apps/web/lib/answer-call.ts`
- Modify: `apps/web/lib/llm.ts` (`CallOptions` L29 to 41; the `meta` in `callLlm`, L92)

**Interfaces:**
- Produces:
  - `type AnswerCall = 'answer' | 'retry: cut off' | 'retry: refused'`
  - `type AnswerComplete = (request: LLMTaskRequest, call: AnswerCall) => Promise<{ text: string }>`
  - `type Answer<T> = { ok: true; value: T; calls: 1 | 2 } | { ok: false; issue: string; calls: 1 | 2 }`
  - `const ANSWER_CUT_OFF = 'the answer was cut off at its length limit'`
  - `callForAnswer<T>(input: { request: LLMTaskRequest; parse: (text: string) => T; complete: AnswerComplete; retryWithReason?: (reason: string) => LLMTaskRequest; cutOffIssue?: string }): Promise<Answer<T>>`
  - `withRefusal(request: LLMTaskRequest, reason: string): LLMTaskRequest`
  - `answerOrStop<T>(answer: Answer<T>, what: string): T` (throws `NonRetriableError(\`${what}: ${issue}\`)`)
  - `completeForProject(projectId: string): AnswerComplete` (from `@/lib/answer-call`)
  - `CallOptions.purpose?: string`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/answer.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { MAX_OUTPUT_TOKENS } from '@boom-busters/providers'
import type { LLMTaskRequest } from '@boom-busters/providers'
import { BudgetExceededError, ValidationError } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { ANSWER_CUT_OFF, answerOrStop, callForAnswer } from './answer'

const request: LLMTaskRequest = {
  task: 'direction',
  system: 'system',
  messages: [{ role: 'user', content: 'the question' }],
  maxTokens: 1000,
}

/** "good" parses; "cut" is a reply cut off mid-JSON; anything else is refused with its text. */
function parse(text: string): string {
  if (text === 'cut') throw new ValidationError('cut off mid-answer', { field: 'maxTokens' })
  if (text !== 'good') throw new ValidationError(`bad answer: ${text}`, { field: 'answer' })
  return 'parsed'
}

const answers = (...texts: string[]) => {
  const complete = vi.fn()
  for (const text of texts) complete.mockResolvedValueOnce({ text })
  return complete
}

describe('callForAnswer (decision 292)', () => {
  it('takes a good first answer in one call', async () => {
    const complete = answers('good')
    expect(await callForAnswer({ request, parse, complete })).toEqual({
      ok: true,
      value: 'parsed',
      calls: 1,
    })
    expect(complete).toHaveBeenCalledWith(request, 'answer')
  })

  it('asks once more at double the budget when the answer is cut off mid-JSON', async () => {
    const complete = answers('cut', 'good')
    expect(await callForAnswer({ request, parse, complete })).toEqual({
      ok: true,
      value: 'parsed',
      calls: 2,
    })
    const [retry, label] = complete.mock.calls[1]!
    expect(label).toBe('retry: cut off')
    expect(retry).toEqual({ ...request, maxTokens: 2000 })
  })

  it('treats a reply the adapter throws as cut off the same way', async () => {
    const complete = vi
      .fn()
      .mockRejectedValueOnce(new ValidationError('empty reply', { field: 'maxTokens' }))
      .mockResolvedValueOnce({ text: 'good' })
    expect(await callForAnswer({ request, parse, complete })).toMatchObject({ ok: true, calls: 2 })
  })

  it('caps the doubled budget, and makes no second call when already at the cap', async () => {
    const near = answers('cut', 'good')
    await callForAnswer({ request: { ...request, maxTokens: 20_000 }, parse, complete: near })
    expect(near.mock.calls[1]![0].maxTokens).toBe(MAX_OUTPUT_TOKENS)

    const atCap = answers('cut')
    expect(
      await callForAnswer({
        request: { ...request, maxTokens: MAX_OUTPUT_TOKENS },
        parse,
        complete: atCap,
      }),
    ).toEqual({ ok: false, issue: ANSWER_CUT_OFF, calls: 1 })
    expect(atCap).toHaveBeenCalledTimes(1)
  })

  it('asks once more with the reason after a refusal, at the same budget', async () => {
    const complete = answers('nope', 'good')
    expect(await callForAnswer({ request, parse, complete })).toMatchObject({ ok: true, calls: 2 })
    const [retry, label] = complete.mock.calls[1]!
    expect(label).toBe('retry: refused')
    expect(retry.maxTokens).toBe(1000)
    expect(retry.messages.at(-1)).toEqual({
      role: 'user',
      content:
        'Your previous answer was refused: bad answer: nope. Answer again in full with that fixed.',
    })
  })

  it("uses the task's own retry request when it has one", async () => {
    const complete = answers('nope', 'good')
    const own = { ...request, messages: [{ role: 'user' as const, content: 'rebuilt' }] }
    const retryWithReason = vi.fn(() => own)
    await callForAnswer({ request, parse, complete, retryWithReason })
    expect(retryWithReason).toHaveBeenCalledWith('bad answer: nope')
    expect(complete.mock.calls[1]![0]).toBe(own)
  })

  it('stops after two refusals with the second reason, and never makes a third call', async () => {
    const complete = vi.fn().mockResolvedValue({ text: 'nope' })
    expect(await callForAnswer({ request, parse, complete })).toEqual({
      ok: false,
      issue: 'bad answer: nope',
      calls: 2,
    })
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it('stops with the cut-off issue when the retry after a refusal is cut off', async () => {
    const complete = answers('nope', 'cut')
    expect(await callForAnswer({ request, parse, complete })).toEqual({
      ok: false,
      issue: ANSWER_CUT_OFF,
      calls: 2,
    })
    const own = answers('nope', 'cut')
    expect(
      await callForAnswer({ request, parse, complete: own, cutOffIssue: 'too long for us' }),
    ).toMatchObject({ ok: false, issue: 'too long for us' })
  })

  it('stops with the reason when the doubled answer is refused', async () => {
    expect(await callForAnswer({ request, parse, complete: answers('cut', 'nope') })).toEqual({
      ok: false,
      issue: 'bad answer: nope',
      calls: 2,
    })
  })

  it('lets a budget stop, a provider error and a call-side validation error through', async () => {
    const budget = new BudgetExceededError({
      provider: 'anthropic',
      operation: 'llm.direction',
      budgetUsd: 5,
      monthSpendUsd: 5,
      estimateUsd: 0.5,
    })
    await expect(
      callForAnswer({ request, parse, complete: vi.fn().mockRejectedValue(budget) }),
    ).rejects.toBe(budget)
    const down = new Error('503 from the provider')
    await expect(
      callForAnswer({ request, parse, complete: vi.fn().mockRejectedValue(down) }),
    ).rejects.toBe(down)
    // Thrown by the CALL, not the parse, and not a cut-off: never a reason-retry.
    const key = new ValidationError('the key was rejected', { field: 'apiKey' })
    const complete = vi.fn().mockRejectedValue(key)
    await expect(callForAnswer({ request, parse, complete })).rejects.toBe(key)
    expect(complete).toHaveBeenCalledTimes(1)
  })
})

describe('answerOrStop (decision 292)', () => {
  it('returns the value of an answer', () => {
    expect(answerOrStop({ ok: true, value: 7, calls: 1 }, 'The outline')).toBe(7)
  })

  it('throws a stop Inngest will not retry, naming what stopped and why', () => {
    expect(() =>
      answerOrStop({ ok: false, issue: 'bad answer', calls: 2 }, 'The outline could not be drafted'),
    ).toThrow(new NonRetriableError('The outline could not be drafted: bad answer'))
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/web && pnpm exec vitest run lib/answer.test.ts`
Expected: FAIL (module `./answer` not found).

- [ ] **Step 3: Write the helper**

Create `apps/web/lib/answer.ts`:

```ts
import { MAX_OUTPUT_TOKENS } from '@boom-busters/providers'
import type { LLMTaskRequest } from '@boom-busters/providers'
import { ValidationError } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'

/**
 * One answer, at most two calls (decision 292). A refused or cut-off answer
 * used to be thrown out of its Inngest step, and the function's `retries`
 * re-ran the identical request: same prompt, same budget, no word of what
 * was wrong, so the same mistake was bought again (a Director's Book redraft
 * paid for three Opus calls and stored nothing).
 *
 * Here the task's parser repairs what it safely can and validates; a cut-off
 * is asked once more at double the budget, a refusal once more with its
 * reason; the second call's outcome is final. Pure: the call is injected, so
 * the app binds it to the ledgered `callLlm` (`completeForProject`) and a
 * live harness binds its own.
 */

export type AnswerCall = 'answer' | 'retry: cut off' | 'retry: refused'

export type AnswerComplete = (
  request: LLMTaskRequest,
  call: AnswerCall,
) => Promise<{ text: string }>

export type Answer<T> =
  | { ok: true; value: T; calls: 1 | 2 }
  | { ok: false; issue: string; calls: 1 | 2 }

export const ANSWER_CUT_OFF = 'the answer was cut off at its length limit'

const isCutOff = (error: unknown): error is ValidationError =>
  error instanceof ValidationError && error.field === 'maxTokens'

/** The request a retry after a refusal sends by default: the same, with the reason last. */
export function withRefusal(request: LLMTaskRequest, reason: string): LLMTaskRequest {
  return {
    ...request,
    messages: [
      ...request.messages,
      {
        role: 'user',
        content: `Your previous answer was refused: ${reason}. Answer again in full with that fixed.`,
      },
    ],
  }
}

type Attempt<T> = { ok: true; value: T } | { ok: false; cutOff: boolean; issue: string }

async function attempt<T>(
  complete: AnswerComplete,
  parse: (text: string) => T,
  request: LLMTaskRequest,
  call: AnswerCall,
): Promise<Attempt<T>> {
  let text: string
  try {
    text = (await complete(request, call)).text
  } catch (error) {
    // Only a cut-off from the call is the answer's fault; anything else the
    // call throws (a rejected key, a budget stop, a provider error) is not.
    if (isCutOff(error)) return { ok: false, cutOff: true, issue: error.message }
    throw error
  }
  try {
    return { ok: true, value: parse(text) }
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error
    return { ok: false, cutOff: isCutOff(error), issue: error.message }
  }
}

export async function callForAnswer<T>(input: {
  request: LLMTaskRequest
  /** Repairs, then validates; throws `ValidationError` for an answer it cannot use. */
  parse: (text: string) => T
  complete: AnswerComplete
  /** Rebuilds the request for the retry after a refusal; by default the reason is added last. */
  retryWithReason?: (reason: string) => LLMTaskRequest
  /** What a final cut-off reports; `ANSWER_CUT_OFF` by default. */
  cutOffIssue?: string
}): Promise<Answer<T>> {
  const cutOffIssue = input.cutOffIssue ?? ANSWER_CUT_OFF
  const first = await attempt(input.complete, input.parse, input.request, 'answer')
  if (first.ok) return { ok: true, value: first.value, calls: 1 }

  let retry: LLMTaskRequest
  let call: AnswerCall
  if (first.cutOff) {
    // The same budget is cut off at the same place; only a bigger one can help.
    if (input.request.maxTokens >= MAX_OUTPUT_TOKENS) {
      return { ok: false, issue: cutOffIssue, calls: 1 }
    }
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

  const second = await attempt(input.complete, input.parse, retry, call)
  if (second.ok) return { ok: true, value: second.value, calls: 2 }
  return { ok: false, issue: second.cutOff ? cutOffIssue : second.issue, calls: 2 }
}

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

- [ ] **Step 4: Label retries in the ledger and bind the helper to callLlm**

In `apps/web/lib/llm.ts`, add to `CallOptions` (after `estimateOutputTokens`):

```ts
  /**
   * Why this call was made, when it is not the first ask: "retry: cut off" or
   * "retry: refused" (decision 292). Written to the ledger row, so what
   * retries cost shows on the Costs screen.
   */
  purpose?: string
```

and change the `meta` passed to `withCost` from `meta: { task: request.task, model: choice.model },` to:

```ts
      meta: {
        task: request.task,
        model: choice.model,
        ...(options.purpose ? { purpose: options.purpose } : {}),
      },
```

Create `apps/web/lib/answer-call.ts`:

```ts
import type { AnswerComplete } from '@/lib/answer'
import { callLlm } from '@/lib/llm'

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

- [ ] **Step 5: Run the tests and typecheck**

Run: `cd apps/web && pnpm exec vitest run lib/answer.test.ts` then `pnpm --filter @boom-busters/web exec tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/answer.ts apps/web/lib/answer.test.ts apps/web/lib/answer-call.ts apps/web/lib/llm.ts
git commit -m "feat(llm): one answer, at most two calls, with retries labelled in the ledger (decision 292)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The trim, and the Director's Book's limits

**Files:**
- Create: `packages/providers/src/prompts/repair.ts`, `packages/providers/src/prompts/repair.test.ts`
- Modify: `packages/providers/src/prompts/index.ts` (export `./repair`)
- Modify: `packages/schemas/src/direction.ts` (L24 `line`; `DirectorsBookSchema` L46 to 63)
- Modify: `packages/providers/src/prompts/direction.ts` (imports L1; `BOOK_SHAPE` L37 to 52; `parseDirectorsBook` L161 to 182)
- Test: `packages/providers/src/prompts/direction.test.ts`

**Interfaces:**
- Produces: `trimText(text: string, max: number): string` (from `@boom-busters/providers`); `BOOK_TEXT_MAX = 600`, `BOOK_ERA_LOCKS_MAX = 6`, `BOOK_MOTIFS = 3`, `BOOK_LIST_MAX = 12` (from `@boom-busters/schemas`); `repairDirectorsBook(raw: unknown): unknown` (from `@boom-busters/providers`); `parseDirectorsBook` repairs before it validates.

- [ ] **Step 1: Write the failing tests**

Create `packages/providers/src/prompts/repair.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { trimText } from './repair'

describe('trimText (decision 292)', () => {
  it('leaves a text inside the limit as it is', () => {
    expect(trimText('Short. Text.', 20)).toBe('Short. Text.')
  })

  it('cuts at the last full sentence inside the limit', () => {
    const text = 'First sentence here. Second one is here. Third runs past the limit by far.'
    expect(trimText(text, 45)).toBe('First sentence here. Second one is here.')
  })

  it('cuts at the last word when the only sentence end is early, like an abbreviation', () => {
    expect(trimText('Dr. Mostaque walked through the glass doors of the office', 30)).toBe(
      'Dr. Mostaque walked through',
    )
  })

  it('does not take a decimal point for the end of a sentence', () => {
    expect(trimText('The round valued it at $1.5 billion and more besides', 26)).toBe(
      'The round valued it at',
    )
  })

  it('cuts hard when the text has no space at all', () => {
    expect(trimText('x'.repeat(10), 4)).toBe('xxxx')
  })
})
```

Append to `packages/providers/src/prompts/direction.test.ts` (add `BOOK_TEXT_MAX` from `@boom-busters/schemas` to the imports):

```ts
describe("the book's limits (decision 292)", () => {
  const book = () =>
    JSON.parse(JSON.stringify(mockDirectorsBook({ caseTitle: 'x', chapterCount: 1 })))

  it('states every limit in the prompt', () => {
    const rules = buildDirectorsBookRequest({
      caseTitle: 'x',
      chapters: [{ title: 'The audit', paragraphs: ['A paragraph.'] }],
      claims: [],
    }).system.replace(/\s+/g, ' ')
    expect(rules).toContain(
      'every text value at most 600 characters; 1 to 6 era locks; exactly 3 motifs; at most 12 never-shows, 12 principals and 12 locations; one chapter entry per chapter, numbered as given',
    )
  })

  it('trims an era rule over the limit at a sentence instead of refusing the book', () => {
    // The owner's failed redraft (2026-10-08): era rules past 600 characters.
    const answer = book()
    answer.eraLocks[0].rules = 'CRT monitors on every desk. '.repeat(30)
    const parsed = parseDirectorsBook(JSON.stringify(answer), 1)
    expect(parsed.eraLocks[0]!.rules.length).toBeLessThanOrEqual(BOOK_TEXT_MAX)
    expect(parsed.eraLocks[0]!.rules.endsWith('CRT monitors on every desk.')).toBe(true)
  })

  it('keeps the first items of a list over its cap, and the first three of four motifs', () => {
    const answer = book()
    answer.neverShow = Array.from({ length: 14 }, (_, at) => `exclusion ${at}`)
    answer.motifs = ['the badge', 'the server rack', 'the term sheet', 'the logo']
    const parsed = parseDirectorsBook(JSON.stringify(answer), 1)
    expect(parsed.neverShow).toHaveLength(12)
    expect(parsed.neverShow[11]).toBe('exclusion 11')
    expect(parsed.motifs).toEqual(['the badge', 'the server rack', 'the term sheet'])
  })

  it('never trims a name, and still refuses two motifs and wrong chapter numbering', () => {
    const named = book()
    named.principals[0].name = 'N'.repeat(BOOK_TEXT_MAX + 1)
    expect(() => parseDirectorsBook(JSON.stringify(named), 1)).toThrow(/malformed/)

    const twoMotifs = book()
    twoMotifs.motifs = ['the badge', 'the server rack']
    expect(() => parseDirectorsBook(JSON.stringify(twoMotifs), 1)).toThrow(/malformed/)

    const renumbered = book()
    renumbered.chapters[0].chapter = 2
    expect(() => parseDirectorsBook(JSON.stringify(renumbered), 1)).toThrow(/covers chapters/)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/providers && pnpm exec vitest run src/prompts/repair.test.ts src/prompts/direction.test.ts`
Expected: FAIL (`./repair` not found; the prompt states no limits; the over-long rule is refused).

- [ ] **Step 3: The trim**

Create `packages/providers/src/prompts/repair.ts`:

```ts
/**
 * Repairs for a model's answer (decision 292): a fixable overrun is cut down
 * here, with no extra call, rather than refused and asked again. Only for
 * free text. A field that carries a fact (a number, a link, a name, a claim
 * reference, an enum) is never repaired: cutting it would change what it says.
 */

/**
 * `text` cut to at most `max` characters: at the last sentence end inside the
 * limit when it lies in the limit's second half (an early "Dr." or "Ltd."
 * would throw most of the text away), else at the last space, else hard.
 * A sentence end is ".", "!" or "?" followed by whitespace or the end of the
 * text, so the point in "$1.5" is not one.
 */
export function trimText(text: string, max: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return text
  const head = trimmed.slice(0, max)
  let sentenceEnd = -1
  for (const match of head.matchAll(/[.!?]/g)) {
    const next = trimmed[match.index + 1]
    if (next === undefined || /\s/.test(next)) sentenceEnd = match.index
  }
  if (sentenceEnd >= max / 2) return head.slice(0, sentenceEnd + 1)
  const space = head.lastIndexOf(' ')
  if (space > 0) return head.slice(0, space).trimEnd()
  return head
}
```

In `packages/providers/src/prompts/index.ts`, add `export * from './repair'`.

- [ ] **Step 4: The book's limits, stated and repaired**

In `packages/schemas/src/direction.ts`, replace `const line = z.string().trim().min(1).max(600)` with:

```ts
/**
 * The book's limits (decision 292): one source for the schema, the prompt
 * that states them and the repair that trims to them.
 */
export const BOOK_TEXT_MAX = 600
export const BOOK_ERA_LOCKS_MAX = 6
export const BOOK_MOTIFS = 3
export const BOOK_LIST_MAX = 12

const line = z.string().trim().min(1).max(BOOK_TEXT_MAX)
```

and in `DirectorsBookSchema` use them: `.max(6)` on `eraLocks` becomes `.max(BOOK_ERA_LOCKS_MAX)`; `motifs: z.array(line).length(3, 'a film has exactly three motifs')` becomes `motifs: z.array(line).length(BOOK_MOTIFS, 'a film has exactly three motifs')`; the three `.max(12)` become `.max(BOOK_LIST_MAX)`.

In `packages/providers/src/prompts/direction.ts`:

1. Change the first import to:

```ts
import {
  BOOK_ERA_LOCKS_MAX,
  BOOK_LIST_MAX,
  BOOK_MOTIFS,
  BOOK_TEXT_MAX,
  DirectorsBookSchema,
  ValidationError,
} from '@boom-busters/schemas'
```

and add `import { trimText } from './repair'`.

2. Make `BOOK_SHAPE` a template that ends with the limits: after the closing `}` of the JSON shape, before the backtick, add:

```

Limits (the app checks them): every text value at most ${BOOK_TEXT_MAX} characters;
1 to ${BOOK_ERA_LOCKS_MAX} era locks; exactly ${BOOK_MOTIFS} motifs; at most ${BOOK_LIST_MAX} never-shows,
${BOOK_LIST_MAX} principals and ${BOOK_LIST_MAX} locations; one chapter entry per chapter, numbered as given.
```

3. Above `parseDirectorsBook`, add:

```ts
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The book as the model answered it, repaired before it is validated
 * (decision 292): free text over the limit trimmed, lists over their caps
 * cut to their first items, a fourth motif dropped. Names, the accent, the
 * era spans, enums and chapter numbers are left as they are: they carry
 * facts, and a bad one is refused.
 */
export function repairDirectorsBook(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  const text = (value: unknown) =>
    typeof value === 'string' ? trimText(value, BOOK_TEXT_MAX) : value
  const texts = (list: unknown, max: number) =>
    Array.isArray(list) ? list.slice(0, max).map(text) : list
  const items = (list: unknown, max: number, fix: (item: Record<string, unknown>) => unknown) =>
    Array.isArray(list) ? list.slice(0, max).map((item) => (isRecord(item) ? fix(item) : item)) : list
  return {
    ...raw,
    visualThesis: text(raw['visualThesis']),
    eraLocks: items(raw['eraLocks'], BOOK_ERA_LOCKS_MAX, (lock) => ({
      ...lock,
      rules: text(lock['rules']),
    })),
    palette: isRecord(raw['palette'])
      ? { ...raw['palette'], note: text(raw['palette']['note']) }
      : raw['palette'],
    motifs: texts(raw['motifs'], BOOK_MOTIFS),
    anchorObject: text(raw['anchorObject']),
    neverShow: texts(raw['neverShow'], BOOK_LIST_MAX),
    principals: items(raw['principals'], BOOK_LIST_MAX, (principal) => ({
      ...principal,
      role: text(principal['role']),
      identityString: text(principal['identityString']),
      guardrail: text(principal['guardrail']),
    })),
    locations: items(raw['locations'], BOOK_LIST_MAX, (location) => ({
      ...location,
      look: text(location['look']),
    })),
    chapters: items(raw['chapters'], Number.POSITIVE_INFINITY, (chapter) => ({
      ...chapter,
      moodShift: text(chapter['moodShift']),
      keyImage: text(chapter['keyImage']),
    })),
    finalImage: text(raw['finalImage']),
  }
}
```

4. In `parseDirectorsBook`, change `const parsed = DirectorsBookSchema.safeParse(raw)` to `const parsed = DirectorsBookSchema.safeParse(repairDirectorsBook(raw))`.

- [ ] **Step 5: Run the tests and every consumer**

Run (Bash `timeout: 600000`): `cd packages/providers && pnpm exec vitest run`, `cd packages/schemas && pnpm exec vitest run`, then `pnpm typecheck` from the root.
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/providers/src/prompts/repair.ts packages/providers/src/prompts/repair.test.ts packages/providers/src/prompts/index.ts packages/schemas/src/direction.ts packages/providers/src/prompts/direction.ts packages/providers/src/prompts/direction.test.ts
git commit -m "feat(direction): the book states its limits, and trims a fixable overrun instead of refusing (decision 292)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The Director's Book on the helper

**Files:**
- Modify: `apps/web/inngest/lib/direction.ts` (imports; `draftDirectorsBook` L211 to 229)
- Modify: `apps/web/inngest/functions/visuals-replanner.ts` (the `redraft-book` step, L102 to 121)
- Test: `apps/web/inngest/lib/direction.test.ts`, `apps/web/inngest/functions/visuals-replanner.test.ts`

**Interfaces:**
- Consumes: `callForAnswer`, `answerOrStop` (`@/lib/answer`); `completeForProject` (`@/lib/answer-call`); `parseDirectorsBook` (repairs since Task 2).
- Produces: `draftDirectorsBook` makes at most two calls and, when it stops, throws `NonRetriableError("The director's book could not be drafted: <issue>")`; the replanner's `op: 'direction'` returns `{ outcome: 'redraft-stopped' }` after a stop, the stored book untouched.

- [ ] **Step 1: Write the failing tests**

Append inside `describeDb('direction helpers (mock mode)', ...)` in `apps/web/inngest/lib/direction.test.ts` (add `import { NonRetriableError } from 'inngest'`):

```ts
  describe('a refused book (decision 292)', () => {
    const twoMotifs = () => ({
      ...mockDirectorsBook({ caseTitle: 'Case', chapterCount: 1 }),
      motifs: ['the badge', 'the server rack'],
    })

    it('asks once more with the reason, labelled in the ledger, and stores the second answer', async () => {
      vi.stubEnv('MOCK_PROVIDERS', '')
      callLlm.mockReset()
      callLlm
        .mockResolvedValueOnce({ text: JSON.stringify(twoMotifs()) })
        .mockResolvedValueOnce({
          text: JSON.stringify(mockDirectorsBook({ caseTitle: 'Case', chapterCount: 1 })),
        })

      const book = await draftDirectorsBook(FIXTURE_PROJECT_ID)
      expect(book.motifs).toHaveLength(3)
      expect(callLlm).toHaveBeenCalledTimes(2)
      expect(callLlm.mock.calls[1]![1]).toMatchObject({ purpose: 'retry: refused' })
      expect(callLlm.mock.calls[1]![0].messages.at(-1).content).toMatch(
        /^Your previous answer was refused: The director's book is malformed/,
      )
    })

    it('stops after two refusals with a stop Inngest will not retry', async () => {
      vi.stubEnv('MOCK_PROVIDERS', '')
      callLlm.mockReset()
      callLlm.mockResolvedValue({ text: JSON.stringify(twoMotifs()) })

      const stopped = draftDirectorsBook(FIXTURE_PROJECT_ID)
      await expect(stopped).rejects.toBeInstanceOf(NonRetriableError)
      await expect(draftDirectorsBook(FIXTURE_PROJECT_ID)).rejects.toThrow(
        /^The director's book could not be drafted: The director's book is malformed/,
      )
      expect(callLlm).toHaveBeenCalledTimes(4)
    })
  })
```

In `apps/web/inngest/functions/visuals-replanner.test.ts`, inside `describeDb('visuals-replanner (mock mode)', ...)`, after the test `'op direction replaces the book and leaves the slots alone'`, add (`callLlm` is already mocked at the top of the file):

```ts
  it('op direction: two refused books stop the redraft and keep the stored book (decision 292)', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockReset()
    callLlm.mockResolvedValue({
      text: JSON.stringify({
        ...mockDirectorsBook({ caseTitle: 'x', chapterCount: 1 }),
        motifs: ['the badge', 'the server rack'],
      }),
    })

    const { result } = await engine.execute({ events: replanEvent('direction') })
    expect(result).toMatchObject({ outcome: 'redraft-stopped' })
    expect(callLlm).toHaveBeenCalledTimes(2)
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.direction).toMatchObject({
      visualThesis: 'owner edit',
    })
  })
```

- [ ] **Step 2: Run them to see them fail**

Run (Bash `timeout: 600000`; Docker Desktop running): `cd apps/web && pnpm exec vitest run inngest/lib/direction.test.ts -t "refused book"` then `pnpm exec vitest run inngest/functions/visuals-replanner.test.ts -t "two refused books"`
Expected: FAIL (one call, the error thrown raw; the replanner throws instead of returning).

- [ ] **Step 3: Draft the book through the helper**

In `apps/web/inngest/lib/direction.ts`, add the imports:

```ts
import { answerOrStop, callForAnswer } from '@/lib/answer'
import { completeForProject } from '@/lib/answer-call'
```

and in `draftDirectorsBook` replace

```ts
    : parseDirectorsBook(
        (await callLlm(buildDirectorsBookRequest(inputs), { projectId })).text,
        inputs.chapters.length,
      )
```

with

```ts
    : // At most two calls (decision 292): the parser trims a fixable overrun,
      // a cut-off is asked once more at double the budget, a refusal once more
      // with its reason; then the stage stops with the reason, never a blind retry.
      answerOrStop(
        await callForAnswer({
          request: buildDirectorsBookRequest(inputs),
          parse: (text) => parseDirectorsBook(text, inputs.chapters.length),
          complete: completeForProject(projectId),
        }),
        "The director's book could not be drafted",
      )
```

(If `callLlm` is no longer used in this file after Task 5 too, remove its import then; leave it now if anything else uses it.)

- [ ] **Step 4: The redraft reports its stop itself**

In `apps/web/inngest/functions/visuals-replanner.ts`, add `NonRetriableError` to the import from `inngest` (or add `import { NonRetriableError } from 'inngest'`), and replace the `op === 'direction'` block's step and handling with:

```ts
      if (op === 'direction') {
        const drafted = await step.run('redraft-book', async () => {
          try {
            await draftDirectorsBook(projectId)
            return { ok: true as const }
          } catch (error) {
            if (error instanceof BudgetExceededError) {
              return { ok: false as const, gate: budgetGateData(error) }
            }
            // Two answers refused or cut off (decision 292): the stored book
            // stays, and the plan screen says why, with no blind retry.
            if (error instanceof NonRetriableError) {
              return { ok: false as const, stopped: error.message }
            }
            throw error
          }
        })
        if (!drafted.ok && 'gate' in drafted) {
          await step.run('redraft-over-budget', () =>
            markSideJobFailed(ctx, 'The redraft stopped', drafted.gate),
          )
          return { projectId, op, outcome: 'over-budget' as const }
        }
        if (!drafted.ok) {
          await step.run('redraft-stopped', () =>
            markSideJobFailed(ctx, 'The redraft stopped', { message: drafted.stopped }),
          )
          return { projectId, op, outcome: 'redraft-stopped' as const }
        }
        return { projectId, op, outcome: 'redrafted' as const }
      }
```

- [ ] **Step 5: Run the tests**

Run (Bash `timeout: 600000`): `cd apps/web && pnpm exec vitest run inngest/lib/direction.test.ts`, then `pnpm exec vitest run inngest/functions/visuals-replanner.test.ts`, then `pnpm exec vitest run inngest/functions/visuals-runner.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/inngest/lib/direction.ts apps/web/inngest/lib/direction.test.ts apps/web/inngest/functions/visuals-replanner.ts apps/web/inngest/functions/visuals-replanner.test.ts
git commit -m "fix(direction): the Director's Book costs at most two calls, and a stop keeps the stored book (decision 292)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The outline, the self-check and the Shorts marking

**Files:**
- Create: `apps/web/lib/script-answers.ts`, `apps/web/lib/script-answers.test.ts`
- Modify: `apps/web/inngest/functions/script-runner.ts` (the `outline` step, L143 to 172; the `self-check-<n>` step, L259 to 284)
- Modify: `apps/web/inngest/functions/shorts-runner.ts` (the `mark-missing-candidates` step's call, L141 to 160)

**Interfaces:**
- Consumes: `callForAnswer`, `answerOrStop`, `AnswerComplete` (`@/lib/answer`); `completeForProject` (`@/lib/answer-call`).
- Produces: `draftOutlineWith(complete, input)`, `selfCheckWith(complete, input)`, `markShortsWith(complete, input)` returning the parsed value or throwing `NonRetriableError` with `The outline could not be drafted: …`, `The self-check of "<chapter title>" could not be read: …`, `The Shorts segments could not be marked: …`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/script-answers.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { mockOutline, mockSelfCheck, mockShortsCandidates } from '@boom-busters/providers'
import { NonRetriableError } from 'inngest'
import { draftOutlineWith, markShortsWith, selfCheckWith } from './script-answers'

const outlineInput = { caseTitle: 'Case', dossierMd: 'The dossier.', claims: [], targetRuntimeMin: 10 }
const chapter = { chapterTitle: 'The audit', contentMd: 'The money was gone.', claims: [] }
const chapters = [{ index: 0, title: 'The audit', contentMd: 'The money was gone. Nobody asked.' }]

describe('the script answers (decision 292)', () => {
  it('drafts the outline in one call when the answer is good', async () => {
    const complete = vi.fn().mockResolvedValue({ text: JSON.stringify(mockOutline(10)) })
    expect((await draftOutlineWith(complete, outlineInput)).chapters.length).toBeGreaterThan(1)
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('asks for the outline once more with the reason, then stops the stage with it', async () => {
    const complete = vi.fn().mockResolvedValue({ text: 'not json at all' })
    const drafting = draftOutlineWith(complete, outlineInput)
    await expect(drafting).rejects.toBeInstanceOf(NonRetriableError)
    await expect(draftOutlineWith(complete, outlineInput)).rejects.toThrow(
      /^The outline could not be drafted: /,
    )
    expect(complete).toHaveBeenCalledTimes(4)
    expect(complete.mock.calls[1]![1]).toBe('retry: refused')
  })

  it('reads a self-check, and names the chapter when it stops', async () => {
    const good = vi
      .fn()
      .mockResolvedValue({ text: JSON.stringify(mockSelfCheck(chapter.contentMd)) })
    expect((await selfCheckWith(good, chapter)).warnings.length).toBeGreaterThan(0)

    const bad = vi.fn().mockResolvedValue({ text: 'not json at all' })
    await expect(selfCheckWith(bad, chapter)).rejects.toThrow(
      /^The self-check of "The audit" could not be read: /,
    )
    expect(bad).toHaveBeenCalledTimes(2)
  })

  it('marks the Shorts segments, and stops with the reason after two refusals', async () => {
    const good = vi
      .fn()
      .mockResolvedValue({ text: JSON.stringify({ candidates: mockShortsCandidates(chapters) }) })
    expect(await markShortsWith(good, { chapters })).toEqual(mockShortsCandidates(chapters))

    const bad = vi.fn().mockResolvedValue({ text: 'not json at all' })
    await expect(markShortsWith(bad, { chapters })).rejects.toThrow(
      /^The Shorts segments could not be marked: /,
    )
    expect(bad).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/web && pnpm exec vitest run lib/script-answers.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the module**

Create `apps/web/lib/script-answers.ts`:

```ts
import {
  buildOutlineRequest,
  buildSelfCheckRequest,
  buildShortsRequest,
  parseOutline,
  parseSelfCheck,
  parseShortsCandidates,
} from '@boom-busters/providers'
import { answerOrStop, callForAnswer, type AnswerComplete } from '@/lib/answer'

/**
 * The script stage's structured answers (decision 292): the outline, each
 * chapter's self-check and the Shorts marking. Each used to be thrown out of
 * its step on a bad answer and re-run blind by the function's retries, five
 * identical calls; now each costs at most two and then stops the stage with
 * its reason. Kept out of the runners so they can be tested without Inngest.
 */

export async function draftOutlineWith(
  complete: AnswerComplete,
  input: Parameters<typeof buildOutlineRequest>[0],
) {
  return answerOrStop(
    await callForAnswer({ request: buildOutlineRequest(input), parse: parseOutline, complete }),
    'The outline could not be drafted',
  )
}

export async function selfCheckWith(
  complete: AnswerComplete,
  input: Parameters<typeof buildSelfCheckRequest>[0],
) {
  return answerOrStop(
    await callForAnswer({ request: buildSelfCheckRequest(input), parse: parseSelfCheck, complete }),
    `The self-check of "${input.chapterTitle}" could not be read`,
  )
}

export async function markShortsWith(
  complete: AnswerComplete,
  input: Parameters<typeof buildShortsRequest>[0],
) {
  return answerOrStop(
    await callForAnswer({
      request: buildShortsRequest(input),
      parse: parseShortsCandidates,
      complete,
    }),
    'The Shorts segments could not be marked',
  )
}
```

- [ ] **Step 4: The runners call it**

In `apps/web/inngest/functions/script-runner.ts`, import `draftOutlineWith, selfCheckWith` from `@/lib/script-answers` and `completeForProject` from `@/lib/answer-call`. In the `outline` step replace the `outline: parseOutline( ... ),` expression with:

```ts
            outline: await draftOutlineWith(completeForProject(projectId), {
              caseTitle: setup.caseTitle,
              dossierMd: setup.dossierMd,
              claims: setup.claims,
              targetRuntimeMin: setup.targetRuntimeMin,
            }),
```

(the surrounding `try` / `catch` that turns a `BudgetExceededError` into a gate stays; the `NonRetriableError` passes its `throw error` to `onFailure`, which marks the stage failed with the message). In the `self-check-${chapter.index}` step replace the non-mock branch with:

```ts
          : await selfCheckWith(completeForProject(projectId), {
              chapterTitle: chapter.title,
              contentMd: chapter.contentMd,
              claims: setup.claims,
            })
```

Remove imports the file no longer uses (`buildOutlineRequest`, `parseOutline`, `buildSelfCheckRequest`, `parseSelfCheck` if nothing else in it uses them; the `mark-shorts` step still uses `buildShortsRequest` and `parseShortsCandidates`).

In `apps/web/inngest/functions/shorts-runner.ts`, import `markShortsWith` and `completeForProject`, and replace the `picked = parseShortsCandidates( ... )` statement with:

```ts
          picked = await markShortsWith(completeForProject(projectId), {
            chapters: chapterSources,
            ...(tension ? { tension } : {}),
          })
```

keeping its `catch`, whose comment changes to: `// A bad answer has had its two calls and stops the stage with its reason (decision 292); a provider error retries, then onFailure -> markStageFailed. Never a silent [].` Remove `buildShortsRequest` and `parseShortsCandidates` from its imports if unused.

- [ ] **Step 5: Run the tests**

Run (Bash `timeout: 600000`): `cd apps/web && pnpm exec vitest run lib/script-answers.test.ts inngest/functions/shorts-runner.test.ts`, then `pnpm --filter @boom-busters/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/script-answers.ts apps/web/lib/script-answers.test.ts apps/web/inngest/functions/script-runner.ts apps/web/inngest/functions/shorts-runner.ts
git commit -m "fix(script): the outline, the self-check and the Shorts marking cost at most two calls (decision 292)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The shot list and the Fix button's repair

**Files:**
- Modify: `apps/web/lib/plan-chapter.ts` (`planWithBudgetEscalation` L73 to 95; `planChapterWith` L155 to 177)
- Modify: `apps/web/inngest/lib/direction.ts` (`planChapterSlots`' call L298 to 301; `rewriteStoredBriefs` L353 to 361)
- Test: `apps/web/lib/plan-chapter.test.ts`, `apps/web/inngest/functions/visuals-replanner.test.ts`

**Interfaces:**
- Consumes: `callForAnswer`, `answerOrStop` (`@/lib/answer`); `completeForProject` (`@/lib/answer-call`).
- Produces: `planChapterWith` makes at most two plan calls (labels `'plan'`, `'plan-retry'`) and throws `NonRetriableError("Chapter <n> could not be planned: <issue>")` on a stop; `rewriteStoredBriefs` makes at most two calls and on a stop keeps every target with the reason `the repair answer could not be used: <issue>`.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('planChapterWith', ...)` in `apps/web/lib/plan-chapter.test.ts` (add `import { NonRetriableError } from 'inngest'`):

```ts
  it('asks once more with the reason when the plan is refused (decision 292)', async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ text: 'no json here' })
      .mockResolvedValueOnce({ text: oneStill })
    const result = await planChapterWith(complete, input)
    expect(result?.slots).toHaveLength(1)
    expect(complete.mock.calls[1]?.[1]).toBe('plan-retry')
    expect(complete.mock.calls[1]?.[0].messages.at(-1).content).toMatch(
      /^Your previous answer was refused: /,
    )
  })

  it('stops the chapter after two refusals, with a stop Inngest will not retry', async () => {
    const complete = vi.fn().mockResolvedValue({ text: 'no json here' })
    const planning = planChapterWith(complete, input)
    await expect(planning).rejects.toBeInstanceOf(NonRetriableError)
    await expect(planChapterWith(complete, input)).rejects.toThrow(
      /^Chapter 1 could not be planned: /,
    )
    expect(complete).toHaveBeenCalledTimes(4)
  })
```

In `apps/web/inngest/functions/visuals-replanner.test.ts`, inside the Fix button suite (the `describeDb` whose `beforeEach` stubs `MOCK_PROVIDERS` to `''` and seeds the still and stock slots), add:

```ts
  it('keeps every flagged slot with the reason when the repair answer is refused twice (decision 292)', async () => {
    callLlm.mockResolvedValue({ text: 'no json here' })

    const { result } = await engine.execute({ events: replanEvent('repair') })

    expect(result).toMatchObject({ outcome: 'repaired', rewritten: 0 })
    expect(callLlm).toHaveBeenCalledTimes(2)
    expect(callLlm.mock.calls[1]![1]).toMatchObject({ purpose: 'retry: refused' })
    const [stored] = await listShotSlots(db, FIXTURE_PROJECT_ID)
    expect(stored!.brief).toMatchObject({ prompt: still.prompt })
  })
```

(`still` here is the suite's own fixture, whose prompt is "A server rack in the dark."; the slot query result is named `stored` below to avoid shadowing it.)

- [ ] **Step 2: Run them to see them fail**

Run (Bash `timeout: 600000`): `cd apps/web && pnpm exec vitest run lib/plan-chapter.test.ts` then `pnpm exec vitest run inngest/functions/visuals-replanner.test.ts -t "refused twice"`
Expected: FAIL.

- [ ] **Step 3: The shot list through the helper**

In `apps/web/lib/plan-chapter.ts`, add `import { answerOrStop, callForAnswer } from '@/lib/answer'`; delete `planWithBudgetEscalation` and its doc comment; remove `MAX_OUTPUT_TOKENS` and `ValidationError` from the imports if nothing else uses them; and in `planChapterWith` replace `const parsed = await planWithBudgetEscalation(complete, request)` with:

```ts
  // At most two calls (decision 292): a cut-off asked once more at double the
  // budget, a refusal once more with its reason, then the chapter stops with
  // the reason. The step never restarts the ladder: the stop is non-retriable.
  const parsed = answerOrStop(
    await callForAnswer({
      request,
      parse: parseShotList,
      complete: (asked, call) => complete(asked, call === 'answer' ? 'plan' : 'plan-retry'),
    }),
    `Chapter ${input.chapter.number} could not be planned`,
  )
```

In `apps/web/inngest/lib/direction.ts`, `planChapterSlots`' call becomes:

```ts
    const planned = await planChapterWith(
      (request, purpose) =>
        callLlm(request, {
          projectId: input.projectId,
          ...(purpose === 'plan' ? {} : { purpose }),
        }),
      input,
    )
```

- [ ] **Step 4: The Fix repair through the helper**

In `rewriteStoredBriefs`, replace

```ts
  const answer = await callLlm(
    buildShotRepairRequest(
      input.request,
      input.targets.map((target) => ({ brief: target.brief, problems: target.problems })),
      { allowStockToStill: true },
    ),
    { projectId: input.projectId },
  )
  const answers = parseShotRepairAnswers(answer.text, originals, { allowStockToStill: true })
```

with

```ts
  const answer = await callForAnswer({
    request: buildShotRepairRequest(
      input.request,
      input.targets.map((target) => ({ brief: target.brief, problems: target.problems })),
      { allowStockToStill: true },
    ),
    parse: (text) => parseShotRepairAnswers(text, originals, { allowStockToStill: true }),
    complete: completeForProject(input.projectId),
  })
  // Two answers it could not use (decision 292): every slot is kept, and the
  // Fix report says why, rather than a blind retry of the same request.
  if (!answer.ok) {
    return {
      rewritten: [],
      kept: input.targets.map((target) => ({
        id: target.id,
        reason: `the repair answer could not be used: ${answer.issue}`,
      })),
    }
  }
  const answers = answer.value
```

and change the function's doc comment line "Unlike the automatic pass this throws: the producer asked for the fix and must hear when it did not happen." to "The producer asked for the fix and must hear when it did not happen: a refused or cut-off answer gets one retry, then every slot is kept with the reason (decision 292)."

- [ ] **Step 5: Run the tests**

Run (Bash `timeout: 600000`): `cd apps/web && pnpm exec vitest run lib/plan-chapter.test.ts inngest/lib/direction.test.ts`, then `pnpm exec vitest run inngest/functions/visuals-replanner.test.ts`, then `pnpm exec vitest run inngest/functions/visuals-runner.test.ts`
Expected: all PASS (the existing "doubles the budget once when the answer is cut off" test still passes: its labels are unchanged).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/plan-chapter.ts apps/web/lib/plan-chapter.test.ts apps/web/inngest/lib/direction.ts apps/web/inngest/functions/visuals-replanner.test.ts
git commit -m "fix(visuals): the shot list and the Fix repair cost at most two calls (decision 292)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Candidate scoring

**Files:**
- Modify: `apps/web/lib/visual-assets.ts` (`scoreSlotCandidates`, L713 to 725)
- Create: `apps/web/lib/candidate-scoring.test.ts`

**Interfaces:**
- Consumes: `callForAnswer` (`@/lib/answer`); `completeForProject` (`@/lib/answer-call`).
- Produces: `scoreSlotCandidates` makes at most two calls; on a stop it returns every candidate unscored, in the provider's order.

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/candidate-scoring.test.ts`:

```ts
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SlotCandidate, StockBrief } from '@boom-busters/schemas'

const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))

import { scoreSlotCandidates } from './visual-assets'

const brief: StockBrief = {
  type: 'stock',
  coversText: 'The money was gone.',
  description: 'An empty office.',
  motion: { kind: 'static' },
  transition: 'cut',
  query: 'empty office',
  rejectionCriteria: [],
}
const candidate = (id: string): SlotCandidate => ({
  id,
  provider: 'pexels',
  kind: 'image',
  sourceUrl: `https://images.example/${id}.jpg`,
  licence: 'Pexels licence',
})

afterEach(() => {
  vi.unstubAllEnvs()
  callLlm.mockReset()
})

describe('scoreSlotCandidates (decision 292)', () => {
  it('asks once more with the reason, then keeps the candidates unranked in the provider order', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockResolvedValue({ text: 'no json here' })

    const ranked = await scoreSlotCandidates(
      brief,
      [candidate('a'), candidate('b'), candidate('c')],
      '01J0000000000000000000000P',
    )

    expect(callLlm).toHaveBeenCalledTimes(2)
    expect(callLlm.mock.calls[1]![1]).toMatchObject({ purpose: 'retry: refused' })
    expect(ranked.map((one) => one.id)).toEqual(['a', 'b', 'c'])
    expect(ranked.every((one) => one.score === undefined)).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run (Bash `timeout: 600000`): `cd apps/web && pnpm exec vitest run lib/candidate-scoring.test.ts`
Expected: FAIL (one call; the error is thrown).

- [ ] **Step 3: Scoring through the helper**

In `apps/web/lib/visual-assets.ts`, import `callForAnswer` from `@/lib/answer` and `completeForProject` from `@/lib/answer-call`, and replace the body of `scoreSlotCandidates` after the empty check with:

```ts
  if (mockProvidersEnabled()) return applyScores(candidates, mockScores(candidates))
  const answer = await callForAnswer({
    request: buildScoringRequest({ brief, candidates }),
    parse: parseScores,
    complete: completeForProject(projectId),
  })
  if (answer.ok) return applyScores(candidates, answer.value)
  // Two answers it could not use (decision 292): the candidates are kept,
  // unranked in the provider's order, rather than the slot failing; the
  // producer can still choose among them.
  console.warn(`[visuals] candidates left unranked: ${answer.issue}`)
  return applyScores(candidates, { scores: [] })
```

Remove `callLlm` from this file's imports if nothing else in it uses it.

- [ ] **Step 4: Run the tests**

Run (Bash `timeout: 600000`): `cd apps/web && pnpm exec vitest run lib/candidate-scoring.test.ts lib/visual-assets.test.ts inngest/functions/slot-refetcher.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/visual-assets.ts apps/web/lib/candidate-scoring.test.ts
git commit -m "fix(visuals): scoring costs at most two calls, and keeps the candidates unranked when it stops (decision 292)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The graphics designer, two calls at most

**Files:**
- Modify: `apps/web/lib/graphic-design-core.ts` (L62 to 66 `GraphicCompleteFn`; L105 to 168 the deadline comment, `DesignEnded`, `isCutOff`, `CallFn`, `Parsed`, `callAndParse`, `attemptDesign`; L211 to 237 the ladder in `designGraphicWith`)
- Test: `apps/web/lib/graphic-design.test.ts`

**Interfaces:**
- Consumes: `callForAnswer`, `AnswerComplete` (`@/lib/answer`).
- Produces: `GraphicCompleteFn` = `(request: LLMTaskRequest, options: { signal?: AbortSignal; purpose?: string }) => Promise<{ text: string }>`; `designGraphicWith` makes at most two calls.

- [ ] **Step 1: Update and add the tests**

In `apps/web/lib/graphic-design.test.ts`:

1. In `'asks once more with the reason, and takes the second answer'`, add after the existing expectation:

```ts
    expect(callLlm.mock.calls[1]![1]).toMatchObject({ purpose: 'retry: refused' })
```

2. Replace the test `'still gives a cut-off after a refusal its own doubled retry'` with:

```ts
  it('stops at two calls when the retry after a refusal is cut off (decision 292)', async () => {
    callLlm
      .mockResolvedValueOnce(answer('$5bn'))
      .mockResolvedValueOnce({ text: '{"scene": {"elements": [', truncated: true })
    expect(await designGraphic(CONTEXT, SLOT)).toEqual({ ok: false, issue: CUT_OFF })
    expect(callLlm).toHaveBeenCalledTimes(2)
  })

  it('stops at two calls when the doubled answer is refused (decision 292)', async () => {
    callLlm
      .mockRejectedValueOnce(new ValidationError('cut off', { field: 'maxTokens' }))
      .mockResolvedValueOnce(answer('$5bn'))
    expect(await designGraphic(CONTEXT, SLOT)).toEqual({
      ok: false,
      issue: 'graphic showed a number the cited claim does not contain: $5bn against claim 1',
    })
    expect(callLlm).toHaveBeenCalledTimes(2)
  })
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/web && pnpm exec vitest run lib/graphic-design.test.ts`
Expected: FAIL (no `purpose` label; three calls in the two new cases).

- [ ] **Step 3: The designer on the helper**

In `apps/web/lib/graphic-design-core.ts`:

1. Import `callForAnswer, type AnswerComplete` from `@/lib/answer`.

2. `GraphicCompleteFn`'s `options` type becomes `{ signal?: AbortSignal; purpose?: string }`, with the doc line: "`purpose` labels a retry in the ledger (decision 292)."

3. The `GRAPHIC_DESIGN_DEADLINE_MS` comment's "the worst ladder is four Opus calls" becomes "the worst ladder is two Opus calls (decision 292)".

4. Delete `isCutOff`, `CallFn`, `Parsed`, `callAndParse` and `attemptDesign` with their comments. Keep `CUT_OFF_ISSUE`, `TOO_LONG_ISSUE`, `MIN_CALL_MS` and `DesignEnded`.

5. In `designGraphicWith`, replace everything from `const deadline = Date.now() + GRAPHIC_DESIGN_DEADLINE_MS` to the end of the `try` block (before `} catch (error) {`) with:

```ts
  const deadline = Date.now() + GRAPHIC_DESIGN_DEADLINE_MS
  const call: AnswerComplete = async (request, label) => {
    const remaining = deadline - Date.now()
    if (remaining < MIN_CALL_MS) throw new DesignEnded(TOO_LONG_ISSUE)
    return complete(request, {
      signal: AbortSignal.timeout(remaining),
      ...(label === 'answer' ? {} : { purpose: label }),
    })
  }

  try {
    // At most two calls (decision 292): the designer's own checks refuse a
    // scene inside the parse, so a refusal is retried once with its reason
    // and a cut-off once at double the budget, then the design stops.
    const answer = await callForAnswer({
      request: buildGraphicRequest(base),
      parse: (text) => {
        const checked = sceneIssue(parseGraphicScene(text), context, slot.durationMs)
        if ('issue' in checked) {
          throw new ValidationError(checked.issue, { field: 'graphic scene' })
        }
        return checked.scene
      },
      complete: call,
      // The designer's request carries the reason before the producer's
      // steer, which stays the last thing the model reads.
      retryWithReason: (reason) => buildGraphicRequest({ ...base, rejection: reason }),
      cutOffIssue: CUT_OFF_ISSUE,
    })
    return answer.ok ? { ok: true, scene: answer.value } : { ok: false, issue: answer.issue }
```

(the existing `catch` stays as it is). Remove imports no longer used (`MAX_OUTPUT_TOKENS`, `PlannedGraphicScene` if unused, `type LLMTaskRequest` stays for `GraphicCompleteFn`).

- [ ] **Step 4: Run the tests and the harness's typecheck**

Run (Bash `timeout: 600000`): `cd apps/web && pnpm exec vitest run lib/graphic-design.test.ts inngest/functions/visuals-runner.test.ts inngest/functions/slot-retyper.test.ts inngest/functions/slot-rebriefer.test.ts`, then `pnpm --filter @boom-busters/web exec tsc --noEmit` (the live harness `scripts/live-graphic-test.ts` passes a `complete` with `{ signal }`; it must still typecheck)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/graphic-design-core.ts apps/web/lib/graphic-design.test.ts
git commit -m "fix(graphics): the designer costs at most two calls, on the shared helper (decision 292)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: PROGRESS and the full suite

**Files:**
- Modify: `PROGRESS.md` (append decision 292)

- [ ] **Step 1: Run the whole suite**

With Docker Desktop running, one at a time (Bash `timeout: 600000` each): `cd packages/schemas && pnpm test`, `cd packages/providers && pnpm test`, `cd packages/db && pnpm test`, `cd apps/web && pnpm test`, then `pnpm typecheck` from the root, then lint the tracked files (`git ls-files '*.ts' '*.tsx' | xargs -n 80 pnpm exec eslint --max-warnings 0`, since other sessions' `.claude/worktrees` break a root `pnpm lint`), then `cd e2e && pnpm exec playwright test`.
Expected: all PASS.

- [ ] **Step 2: Record decision 292**

Append to `PROGRESS.md` (check first with `grep -nE "^29[0-9]\. " PROGRESS.md` that 292 is free; if not, take the next number and say so):

```markdown
292. **One answer, at most two calls (stage 1 of 2)** (2026-10-08, owner,
     after a redraft of the Stability AI book paid for three Opus calls and
     stored nothing: "we need to make sure that the way these are handled
     and formed that we mitigate errors and retries because on expensive
     models like Opus 5.5, a retry is costly"). A survey of every model
     call found blind retries throughout: a refused or cut-off answer was
     thrown out of its Inngest step and the function's `retries` re-ran the
     identical request (the Director's Book 5 calls, 3 on a redraft; the
     outline, the self-check and the Shorts marking 5 each; the Fix repair
     3; scoring in the refetcher 5; the shot list up to 10 a chapter); most
     prompts never stated the limits their answers are checked against; and
     nothing repaired a fixable answer.
     Owner's rulings: two stages; a free-text field over its limit is
     trimmed with no extra call (never a fact: names, numbers, links, claim
     references, enums); at most two calls for any answer, every task, the
     graphics designer included (it drops from four); one helper each call
     uses.
     What shipped: `callForAnswer` (`apps/web/lib/answer.ts`): a cut-off is
     asked once more at double the budget (no second call at the 32,000
     cap), a refusal once more with "Your previous answer was refused:
     <reason>. Answer again in full with that fixed.", and the second call's
     outcome is final; the retry is labelled in the cost ledger
     (`purpose`). A stop is a `NonRetriableError` with the reason (the
     stage's failure card) or the task's own report: the redraft says "The
     redraft stopped" and keeps the stored book; the Fix repair keeps every
     slot with the reason; scoring keeps the candidates unranked in the
     provider's order; a graphic shows "Not designed". On the helper: the
     Director's Book (first draft and redraft), the outline, the self-check,
     the Shorts marking, the shot list, the Fix repair, candidate scoring
     and the graphics designer. The book's prompt now states every limit
     (text 600 characters; 1 to 6 era locks; exactly 3 motifs; at most 12
     never-shows, principals and locations) and its parser trims a long
     line at a sentence, cuts a long list to its first items and keeps the
     first three of four motifs, so the owner's failed redraft would have
     landed on its first call.
     Decisions made where the spec left room: a sentence end counts only in
     the second half of the limit (an early "Dr." would throw most of the
     text away), and a point followed by a digit is not one (cost if wrong:
     a trim ends at a word where a sentence end was nearer); the shot list
     keeps its live harness's labels, a retry of either kind is "plan-retry"
     (cost if wrong: the harness cannot tell a cut-off retry from a refused
     one); the graphics designer's retry after a refusal is rebuilt by its
     own request builder, so the producer's steer stays last (cost if wrong:
     none seen).
     Stage 2 (its own spec): limits and repairs in every remaining prompt
     (research, case suggestions, teaser, cast identity, re-brief, redirect,
     retype), the helper for the single-shot calls, and the plain-text
     answers that are kept half-written when cut off (the chapter draft,
     the digest, the section rewrite).
     Shipping: a Vercel deploy and `PUT /api/inngest`. No migration, no
     Remotion or broker deploy. The number 292 is checked against
     `origin/master` at the merge.
```

- [ ] **Step 3: Commit**

```bash
git add PROGRESS.md
git commit -m "docs(progress): decision 292, one answer at most two calls

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
