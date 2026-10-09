# One answer, at most two calls (decision 292, stage 1 of 2)

Status: design approved in conversation 2026-10-08, section by section; this
document is for the owner's review before an implementation plan is written.

## 1. The problem

The owner, 2026-10-08, after a redraft of the Stability AI film's Director's
Book failed: "We need to make sure that the way these are handled and formed
that we mitigate errors and retries because on expensive models like Opus 5.5,
a retry is costly."

That redraft made three paid calls and stored nothing. Call 1 was refused
("eraLocks.0.rules: Too big: expected string to have <=600 characters"),
call 2 was cut off at its output budget, call 3 was refused for the same
over-long era rule. Each call was the identical request: the step threw, and
Inngest re-ran it with the same prompt, the same budget and no word of what
was wrong.

### 1.1 What a survey of every model call found (2026-10-08)

- **Blind retries.** A refused or cut-off answer is thrown out of its Inngest
  step, and the function's `retries` re-runs the identical request: the
  Director's Book (5 calls in the visuals-runner, `retries: 4`; 3 in the
  replanner, `retries: 2`), the script outline (5), the script self-check (5
  per chapter), shorts marking (5), the Fix button's repair (3), candidate
  scoring in the slot refetcher (5).
- **A ladder that restarts.** The shot list doubles its budget once inside
  the step (`planWithBudgetEscalation`, `apps/web/lib/plan-chapter.ts`), but a
  failed step restarts at the base budget: up to 10 calls per chapter.
- **Unstated limits.** Most prompts never state the limits the answer is
  checked against. The book's every text field is capped at 600 characters
  (`packages/schemas/src/direction.ts`, `line`), with 1 to 6 era locks and at
  most 12 never-shows, principals and locations; its prompt states none of
  them.
- **Refuse, never repair.** Almost nothing repairs a fixable answer: one field
  over by 100 characters throws away the whole paid answer.
- **The pattern to copy.** The graphics designer (`designGraphicWith`,
  `apps/web/lib/graphic-design-core.ts`) retries with the reason inside its
  step and doubles a cut-off budget once, and never lets a refusal reach
  Inngest; the research steps (`guarded()`,
  `apps/web/inngest/lib/dossier-research.ts`) wrap a `ValidationError` as
  `NonRetriableError`.

### 1.2 The decision

Owner's rulings in the conversation:

- Two stages, each deployed. Stage 1 (this document): one shared rule for
  structured answers, applied to the Director's Book and every call that
  retries blind today, plus the book's own limits, since the book is what is
  blocking the owner. Stage 2 (its own spec): limits and repairs in every
  remaining prompt, the helper for the single-shot calls, and plain-text
  answers that are cut off.
- A free-text field over its length limit is trimmed, with no extra call:
  cut at the last full sentence inside the limit, or the last word when no
  sentence ends there. Fields that carry facts (numbers, links, names, claim
  references, enums) are never repaired.
- At most two calls for any answer, every task, the graphics designer
  included (it drops from up to four).
- One helper each call uses, not a rule inside `callLlm` and not a copy per
  task.

## 2. The helper

`callForAnswer` in `apps/web/lib/answer.ts`:

```ts
callForAnswer<T>(input: {
  request: LLMTaskRequest
  parse: (text: string) => T           // repairs, then validates; throws ValidationError
  complete: (request: LLMTaskRequest) => Promise<{ text: string }>
}): Promise<{ ok: true; value: T; calls: 1 | 2 } | { ok: false; issue: string; calls: 1 | 2 }>
```

1. Call 1, then `parse`.
2. **Cut off** (the adapter's `ValidationError` on `maxTokens`, or the parser's
   "cut off mid-answer" on the same field): call 2 with `maxTokens` doubled,
   capped at `MAX_OUTPUT_TOKENS` (32,000). When the budget is already at the
   cap, it stops after call 1 with "the answer was cut off at its length
   limit".
3. **Refused** (any other `ValidationError` from the parse): call 2 with the
   reason added as the last user message: "Your previous answer was refused:
   <reason>. Answer again in full with that fixed."
4. Call 2's outcome is final: the value, or `{ ok: false, issue }` with the
   reason it stopped. Never a third call.
5. `BudgetExceededError` and provider errors pass through untouched. The
   model router already retries a provider error three times per model.
6. The second call is labelled in the cost ledger (`purpose`:
   "retry: cut off" or "retry: refused"), so what retries cost is visible.

`complete` is injected, as `designGraphicWith` does today, so the app binds
it to `callLlm` with the project's id and the live harnesses bind their own.
A caller that needs an abort deadline (the graphics designer) passes a
`complete` that carries it.

### 2.1 The Inngest boundary

A step that asks for an answer never lets a refused or cut-off answer out as
an error Inngest would retry: it takes `{ ok: false, issue }` and stops the
task with that reason, where the task already reports failure (section 3). A
`ValidationError` that escapes any other way from these steps is wrapped as
`NonRetriableError`, as `guarded()` already does for research. Provider
errors still throw and are retried by the function's `retries`, as today.

## 3. Stage 1's call sites

| Call | Where | Today's worst case | After | When it stops |
|---|---|---|---|---|
| Director's Book, first draft | `directors-book` step, visuals-runner | 5 calls | at most 2 | The Visuals stage fails with the reason |
| Director's Book, redraft | `redraft-book` step, visuals-replanner | 3 | at most 2 | "The redraft stopped: <reason>" on the plan screen |
| Script outline | `outline` step, script-runner | 5 | at most 2 | The Script stage fails with the reason |
| Script self-check | `self-check-<n>` steps, script-runner | 5 per chapter | at most 2 | The Script stage fails with the reason (the chapter's claim references come from it) |
| Shorts marking | `mark-missing-candidates`, shorts-runner | 5 | at most 2 | The step fails with the reason |
| Shot list | `shot-list-<n>` (runner), `replan-<n>` (replanner) | 10 per chapter | at most 2 | The stage (or the re-plan) fails, naming the chapter and the reason |
| Fix button repair | `repair-<n>`, visuals-replanner (`rewriteStoredBriefs`) | 3 | at most 2 | The repair report says why |
| Candidate scoring | `scoreSlotCandidates` (`apps/web/lib/visual-assets.ts`), in the fetch fan-out and the slot refetcher | 5 (refetcher) | at most 2 | The candidates are kept unranked, in the provider's order (see 3.2) |
| Graphics designer | `designGraphicWith` | 4 | at most 2 | "Not designed: <reason>", as today; the 240 s deadline stays |

The shot list's own doubling (`planWithBudgetEscalation`) is replaced by the
helper. A refused or cut-off answer no longer fails the step, so the step is
re-run only after a provider error, which the router has already tried three
times; such a re-run starts the step's two calls again (Inngest replays a
step whole), the one case where an answer can cost more than two calls.

### 3.1 The Director's Book's limits

`packages/providers/src/prompts/direction.ts`:

- The prompt states every limit: each text field at most 600 characters; 1 to
  6 era locks; exactly three motifs; at most 12 never-shows, 12 principals and
  12 locations; one chapter entry per chapter, numbered as given.
- The parser repairs before it validates: a text field over 600 characters is
  trimmed as section 1.2 says; a list over its cap keeps its first items;
  four or more motifs keep the first three.
- Still refused, and so retried once with the reason: fewer than three
  motifs, no era lock, chapters numbered wrongly, a missing field, malformed
  JSON.

The answer that failed for the owner (era rules over 600 characters) parses
on its first call under this.

### 3.2 Decisions made where the design left room

- Candidate scoring, when it stops, keeps the candidates unranked in the
  provider's order instead of failing the slot: `applyScores` already
  tolerates missing scores, the producer can still choose, and the fetch
  fan-out made a placeholder of the slot before (cost if wrong: a slot whose
  top candidate is the provider's first rather than the best match).
- Trimming keeps whole sentences: the last `.`, `!` or `?` followed by a
  space or the end, inside the limit; with none, the last space; with no
  space, a hard cut (cost if wrong: a trimmed era rule loses its last
  clauses).
- The reason sent with call 2 is the parser's own message, as the graphics
  designer already sends it (cost if wrong: a long Zod message reads less
  clearly to the model than a hand-written one).

## 4. Tests

Landing with the code they test:

- **The helper, every branch:** answered first time (one call); cut off then
  answered at double the budget (two calls, the second labelled); cut off at
  the cap (one call, stops); refused then answered with the reason sent (two
  calls, the reason is the last message); refused twice (two calls, returns
  the reason); a budget stop and a provider error pass straight through;
  never a third call.
- **Trimming:** a sentence boundary, a word boundary, a hard cut, a string
  already inside the limit untouched.
- **The Director's Book:** the prompt states every limit; an over-long line
  and an over-long list are repaired; four motifs become three; two motifs and
  wrong chapter numbering are refused; the owner's case (era rules over 600)
  parses on one call.
- **Each call site:** a refusal retries once with its reason and then stops,
  reporting where that task reports; no `ValidationError` leaves the step as
  a retriable error; the existing tests pass, the graphics designer's
  adjusted from four calls to two.
- The full suite runs before the merge.

## 5. Rollout

A Vercel deploy and `PUT /api/inngest` (the runner functions change). No
migration, no `deploy:remotion`, no broker deploy. Mock-provider mode makes no
paid call in development. PROGRESS records decision 292, the number checked
against `origin/master` at the merge.

For the owner afterwards: press redraft on the Stability AI book again; it
should land on the first call, any over-long era rule trimmed.

## 6. Stage 2 in outline

Its own spec, after stage 1 ships: every remaining prompt states its limits
and its parser repairs what it safely can (research brief, timeline, claims
and answers; case suggestions; teaser; cast identity; re-brief, redirect and
retype); re-brief, redirect and retype move onto the helper (today one call
and no retry); the chapter draft, the weekly digest and the section rewrite,
which are plain text and today kept half-written when cut off, are retried
once at double the budget and otherwise refused.

## 7. Out of scope

- Changing which model a task is routed to.
- Thinking or effort settings on the Anthropic adapter (it sets none; the
  4,000-token headroom in `outputBudget` stays).
- Retrying provider errors differently: the router's three attempts per model
  and each function's `retries` stay as they are.
