# Every answer within its limits, and told where it lands (decision 293, stage 2 of 292)

Status: design approved in conversation 2026-10-09, section by section; this
document is for the owner's review before an implementation plan is written.

## 1. The problem

Stage 1 (decision 292, merged at 8ebf3f4) put the Director's Book, the
outline, the self-check, the Shorts stage's marking, the shot list, the Fix
repair, candidate scoring and the graphics designer on one helper,
`callForAnswer` (`apps/web/lib/answer.ts`): at most two calls per answer, the
second one told what was wrong. Its spec (section 6) left the rest to this
stage. The owner, 2026-10-09, after hearing that a trimmed field is never
reported: fold a notice of what was trimmed into stage 2.

### 1.1 What a survey of the remaining calls found (2026-10-09)

Eighteen model calls are not on the helper: fourteen structured (JSON) and four
plain text.

- **Unstated limits.** Only title options states every limit its answer is
  checked against. The four dossier passes state none; case suggestions, the
  teaser, cast identity, the Script stage's Shorts marking and retype state
  some. Cast identity asks for "at most 60 words" and enforces 600
  characters, which 60 words can exceed.
- **No repair.** Every structured call refuses a whole answer for one field
  over its limit or one bad item in a list of 120 claims.
- **Identical retries.** The chapter draft re-buys the identical request up to
  4 more times when the adapter reports an empty reply at its budget; the
  weekly digest up to 2 more. Re-brief, redirect and retype re-send the
  identical request twice on a provider's content refusal.
- **Half-written answers kept.** The chapter draft, the digest and the section
  rewrite ignore the response's `truncated` flag and keep what came back.
- **Silent losses.** The teaser turns every failure, a passing network error
  included, into "skipped", and nothing tells the owner. The Script stage's
  Shorts marking swallows every error, a budget stop included, and stores no
  candidates.
- **Stage 1 gap.** A side job that stops while a gate is parked (a redraft, a
  re-brief, a redirect) reports through `markSideJobFailed`, which then only
  calls `notify`. `notify` sends email when Resend is configured; production
  has no Resend key, so the reason reaches one server log line and nothing in
  the app. Stage 1's table promised the redraft's reason on the plan screen.
- **No notice of a repair.** Stage 1's book repair trims silently; nothing in
  the app says which field was cut.

### 1.2 The decision

Owner's rulings in the conversation (2026-10-09):

- Notices appear on the card they concern, with a Dismiss button, from one
  shared store; the same store carries a side job's stop.
- When one item in a list breaks a rule on a fact, that item is dropped and
  the rest kept, with a notice. No extra call.
- The silent losses are fixed too: the teaser and the Script stage's Shorts
  marking.
- Stage 1's rulings stand: free text over its limit is trimmed with no extra
  call; facts are never edited; at most two calls per answer; one helper.

## 2. The rules, for every structured answer

1. Free text over its limit is trimmed at a sentence (stage 1's `trimText`:
   the last sentence end in the second half of the limit, else the last
   space, else a hard cut), with a notice.
2. A list over its cap keeps its first items, with a notice.
3. One item in a list that breaks a rule on a fact is dropped and the rest
   kept, with a notice.
4. An answer with nothing usable (no JSON, malformed JSON, a missing field,
   fewer items than the minimum once drops are made) is refused: one retry with
   the reason, then a stop.
5. A deliberate decline (re-brief and retype answering `{"error": ...}`) is
   final: the model's reason is shown, and no retry is bought.
6. Facts are never edited: names, numbers, links, claim references, enums and
   the sentences a Short is anchored on.
7. Every prompt states the limits its answer is checked against.

### 2.1 Applied to each call

| Call | Trimmed | Dropped (an item breaks a fact rule) | Capped |
|---|---|---|---|
| Research brief | summary 5,000; turning point 2,000 | | principals 30; open questions 20 |
| Timeline | what happened 1,000 | an event whose date label is over 100 | 60 events |
| Claims | | a claim whose text is over 1,000 | 120 claims |
| Answers | answer 3,000 | an answer whose echoed question is over 1,000 | 40 answers; 40 claims each |
| Case suggestions | angle 2,000; demand notes 2,000; link note 500 | a suggestion whose title is over 200 | the number asked for; 10 links |
| Teaser | title 90 (at a word); each paragraph 400 | | 5 paragraphs |
| Cast identity | identity 600; guardrail 600 | | |
| Retype to graphic, chart or map | graphic intent 300 | | 6 intent references; 8 map places |
| Script stage's Shorts marking | hook rationale 1,000 | a segment whose start or end sentence is over 2,000 | 10 candidates |
| Re-brief, redirect | (their schemas have no string limits to break) | | |

Limits are characters. The schemas in `packages/schemas/src` hold them; each
becomes a named constant the schema, the prompt and the repair share, as
stage 1 did with `BOOK_*`.

### 2.2 Decisions made where the design left room

- A case's priority score is the model's own rating, not a fact from the
  world: a fraction is rounded and a value outside 0 to 100 is clamped, with a
  notice (cost if wrong: a rating moves by a few points).
- A teaser paragraph whose chapter number is out of range is refused and
  retried, not dropped: it would pull the wrong chapter's visuals (cost if
  wrong: one Sonnet call).
- A claim's text is a fact: the script narrates it, so a trimmed claim would be
  half an assertion. Over its limit it is dropped, not trimmed.
- An answer's echoed question is a join key back to the brief's open
  question, so it is a fact; the answer itself is prose and is trimmed.

## 3. Notices

### 3.1 Storage

One table, `notices` (migration 0033):

| Column | Type | Note |
|---|---|---|
| `id` | id | as every table |
| `project_id` | text, nullable, cascade on project delete | empty for the Case Library |
| `subject` | text enum | `project`, `direction`, `dossier`, `script`, `teaser`, `cast`, `slot`, `case` |
| `subject_id` | text, nullable | the cast member's, slot's or case's id; empty for a project-wide subject |
| `kind` | text enum | `trimmed`, `dropped`, `stopped`, `skipped` |
| `message` | text, at most 1,000 | one line, written for the owner |
| `created_at` | timestamp | |
| `dismissed_at` | timestamp, nullable | |

`packages/db/src/notices.ts`:

- `replaceNotices(db, subject, notices)`: retires the subject's open notices
  (sets `dismissed_at`), then adds the new ones; a subject is
  `{ projectId, subject, subjectId }`.
- `addNotice(db, subject, notice)`: adds without retiring (a stop).
- `listNotices(db, filter)`: open notices for a project's subjects, or for a
  list of cases.
- `dismissNotice(db, id)`.

### 3.2 Lifecycle

- An answer that lands for a subject calls `replaceNotices` with its repairs,
  an empty list included, so a new answer retires the old notes.
- A stop calls `addNotice` with kind `stopped` (or `skipped` for the teaser);
  the next answer that lands for that subject retires it.
- A dismissed notice stays dismissed.

### 3.3 Wording

One line per answer, grouped by action, in plain words, never a field path:

- "Trimmed to fit: era rule 1; Emad Mostaque's identity. Kept the first 12
  never-shows."
- "Dropped claim 37: its text ran over 1,000 characters."
- "The redraft stopped: the answer was cut off at its length limit. The book
  you had is kept."

### 3.4 Where each subject shows

Every card renders one shared component, `Notices`, for its subject: an amber
line per notice, styled as the slot card's re-type box is today
(`role="status"`), with a labelled **Dismiss** button calling
`dismissNoticeAction`.

| Subject | Card | What lands there |
|---|---|---|
| `direction` | the Direction card on the plan screen (`direction-card.tsx`) | the book's trims (stage 1's repair now reports); a redraft that stopped |
| `dossier` | the dossier review, above the document (`dossier-review.tsx`) | research trims and drops, from all four passes |
| `script` | Script Studio's Shorts candidates strip (`script-studio.tsx`) | marking trims; why marking stopped |
| `teaser` | the Teaser card's place on the Shorts screen (`shorts-screen.tsx`) | teaser trims; why the teaser was skipped |
| `cast` | that member's cast card (`cast-card.tsx`) | identity trims |
| `slot` | the slot card (`visual-board.tsx`) | retype trims; a re-brief, redirect, retype or refetch that stopped |
| `case` | the case's row in the Case Library (`case-library.tsx`) | suggestion trims |
| `project` | a strip above the stage on the project page (`page.tsx`) | any other side job that stopped while a gate was parked |

A dropped case suggestion has no row: the "Suggest cases" toast names it.

### 3.5 Side jobs that stop

`markSideJobFailed(ctx, title, error, subject?)` gains an optional subject.
While the gate is parked it writes a `stopped` notice for that subject (default
`project`) as well as calling `notify`. When the gate is not parked it fails
the stage as today, and the Needs-you card shows it. Of its 20 call sites, the
redraft names `direction`; re-brief, redirect, retype and refetch name the
slot; the teaser rebuild names `teaser`; the rest take the default.

## 4. The helpers

### 4.1 `callForAnswer` gains three things

- **Repairs travel with the answer.** A parser takes an optional second
  argument, `note(repair)`, and calls it for each repair:
  `{ field: string; action: 'trimmed' | 'dropped' | 'capped' | 'rounded'; reason?: string }`,
  where `field` is already words ("era rule 1", "claim 37"). The helper
  collects the notes of each attempt and returns those of the attempt that
  succeeded as `repairs` on the answer. Stage 1's parsers ignore the argument
  and keep working; `repairDirectorsBook` starts calling it.
- **A deliberate decline is final.** A new `AnswerDeclined` error
  (`packages/schemas/src/errors.ts`, a `ValidationError` subclass so existing
  catches still see a refusal) is thrown by the re-brief and retype parsers
  for an `{"error": ...}` answer. The helper returns
  `{ ok: false, issue, declined: true }` after that call and buys no retry.
- **A provider's content refusal is final.** A `ContentPolicyError` thrown by
  the call ends the answer with its reason, `{ ok: false, issue }`, with no
  second call: the identical request would be refused again.

### 4.2 `callForText`, for plain-text answers

`callForText({ request, complete })` in the same module:

1. Call 1. A reply flagged `truncated`, or the adapter's `ValidationError` on
   `maxTokens`, is a cut-off.
2. A cut-off is asked once more at double the budget, capped at
   `MAX_OUTPUT_TOKENS`, labelled `retry: cut off`; at the cap it stops after
   call 1.
3. A second cut-off stops with "the answer was cut off at its length limit".
   Nothing half-written is kept.
4. An empty reply that is not a cut-off is refused once with the reason, as a
   structured refusal is.
5. Budget, provider and call-side errors behave as in `callForAnswer`.

## 5. The call sites

| Call | Where | Today | After | When it stops | Notices |
|---|---|---|---|---|---|
| Research brief, timeline, claims, answers | `research-*-N` steps, `apps/web/inngest/lib/dossier-research.ts` | 1 call, then the run stops | at most 2 | the stage fails with the reason, as today | `dossier`, written by the save step from all four passes |
| Case suggestions | action `suggestCases`, `app/(console)/cases/actions.ts` | 1 Opus call, refused whole | at most 2 | error toast, as today | each created case's row; drops named in the toast |
| Teaser | `writeTeaserScript`, `apps/web/inngest/lib/teaser-build.ts` | 1 call; any failure becomes "skipped", unseen | at most 2; a provider error is rethrown so Inngest retries it | skipped, with a `teaser` notice saying why | `teaser` |
| Cast identity | `describeFromPhotos`, `cast-actions.ts` | 1 call | at most 2 | error toast; after an upload the toast now says the photo is saved and the description could not be written | `cast` |
| Re-brief (idea, chart and map paths) | `draft-brief`, `slot-rebriefer.ts` | 1 call; a content refusal re-sent twice | at most 2; a decline or content refusal is final | the `rebrief-refused` card state, as today | `slot` |
| Redirect | `redirect-brief`, `slot-redirector.ts` | the same | the same | the slot's refusal box, as today | `slot` |
| Retype | `convert-brief`, `slot-retyper.ts` | the same | the same | the `refused` card state, as today | `slot` |
| Script stage's Shorts marking | `mark-shorts`, `script-runner.ts` | 1 call, every error swallowed | at most 2, on the existing `markShortsWith` | no candidates and a `script` notice that the Shorts stage will mark them again; a budget stop parks the run as the other steps do | `script` |
| Title options | action `generateTitles`, `publish-actions.ts` | 1 call | at most 2 | error toast, as today | none (dropping an unusable title is normal filtering) |
| Chapter draft | `draft-chapter-N`, `script-runner.ts` | up to 5 identical calls; a half chapter kept | at most 2, `callForText` | the stage fails with the reason; chapters already written are kept | the stage failure card |
| Weekly digest | `weekly-digest`, `analytics-runner.ts` | up to 3 identical calls; a half digest sent | at most 2, `callForText` | not sent; the failure goes to `notify` | none |
| Section rewrite | action `regenerateSection`, `actions.ts` | 1 call; a half passage reaches the diff | at most 2, `callForText` | error toast | none |

Stage 1's Director's Book already runs on the helper; its first draft
(`directors-book`, visuals-runner) and its redraft (`redraft-book`,
visuals-replanner) now pass the repairs to `replaceNotices` for `direction`,
and a stopped redraft writes its `stopped` notice there (section 3.5).

A stop inside an Inngest step that is not reported in the task's own way is a
`NonRetriableError` with the reason, as in stage 1.

### 5.1 Parked runs

The dossier's research steps start returning `repairs`. Inngest replays the
stored result of a step a parked run already finished, and that result has no
`repairs`: the save step reads it as an empty list. Every other new field
follows the same rule: computed inside a step, or read with a default.

## 6. Tests

Landing with the code they test:

- **The helpers:**
  - notes come only from the attempt that succeeded;
  - a decline is final after one call, as is a content refusal;
  - `callForText`: truncated, then answered at double the budget; truncated
    twice, then a stop; at the cap, a stop after one call; the adapter's
    empty-reply error counts as a cut-off; never a third call.
- **Each parser:**
  - the prompt states every limit in section 2.1;
  - each trim, cap, drop and rounding calls `note` with a readable label;
  - facts come back untouched;
  - an answer with nothing usable is refused.
- **Notices (database):**
  - replacing retires only that subject's open notices;
  - dismiss hides a notice;
  - deleting a project deletes its notices;
  - `markSideJobFailed` while parked writes a `stopped` notice with its
    subject, and when not parked fails the stage as today.
- **Call sites:**
  - each stop lands where the section 5 table says;
  - the teaser rethrows a provider error;
  - Shorts marking parks on a budget stop;
  - a replayed dossier step without `repairs` reads as an empty list.
- **Cards:** each renders its notices, and Dismiss removes one. One e2e test
  in mock-provider mode seeds a notice on the Direction card and dismisses it
  with the button.
- **Before the merge:** the full suite (schemas, providers, db, web, e2e) and
  the typecheck.

## 7. Rollout

- Migration 0033 runs on the production database before the Vercel deploy,
  then `PUT /api/inngest` (runner functions change). No Remotion or broker
  deploy.
- Mock-provider mode makes no paid call in development; nothing in this stage
  needs a live run.
- PROGRESS records decision 293, the number checked against `origin/master`
  at the merge.

## 8. Out of scope

- The plan's automatic chapter repair (`repairPlannedChapter`): one
  best-effort call whose failure keeps the plan, and the Fix button covers it.
- The set inventory draft: it already refuses a truncated reply and is
  best-effort.
- Email delivery: production has no Resend key; the notices make it
  unnecessary for the cases here.
- Which model each task is routed to.
