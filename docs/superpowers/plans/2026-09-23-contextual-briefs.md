# Contextual Briefs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make shot briefs show the people and places their sentences name instead of symbols, and make the plan lint repair what it finds.

**Architecture:** Three prompts change (the House Visual Bible, the Director's Book prompt, the shot-list prompt) so the planner stages abstractions through people and place and treats the era lock as a constraint. A pure `craftFindings` in `@boom-busters/schemas` grades each problem `auto` or `manual`. After each chapter is planned, one repair call fixes the `auto` findings; a **Fix these** button on the plan screen fixes `auto` and `manual` findings on demand through the visuals-replanner. Banned words are stripped from prompts rather than reported.

**Tech Stack:** TypeScript, pnpm monorepo, Zod, Vitest, Inngest (`@inngest/test`), Next.js App Router, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-23-contextual-briefs-design.md` (decision 271). Read it before starting any task.

## Global Constraints

- Branch: `contextual-briefs` (already exists, holds the spec). Commit there; never push, never merge.
- Commit trailer, on every commit: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
- Run `pnpm format` then `pnpm format:check` before every commit. CI gates on Prettier.
- Run every command in the foreground. Never background a command.
- Mock providers only. No real API call is made by any test; `callLlm` is mocked wherever a live path is exercised.
- Database test suites run one at a time. Never run two vitest processes that touch the test database at once: they block on row locks for an hour and look like a hang. The test DB needs Docker Desktop running.
- The bible's human-editable source is `packages/providers/src/prompts/direction-craft.md`. Never hand-edit the `DIRECTION_CRAFT` constant: edit the markdown, run `pnpm exec prettier --write` on it, then `pnpm --filter @boom-busters/providers embed:craft`. A test holds the two byte-identical.
- A phrase any test asserts with `toContain` must sit whole on one line of its source (markdown or template literal), because the line break is part of the string.
- The bible may contain no en or em dash; a test enforces it.
- Messages that name a real person never refer back to them with a pronoun ("he", "his", "she", "her"). Repeat the name.
- `packages/schemas` must not import `@boom-busters/providers`.

## Rulings (where this plan refines the spec)

1. **`repair` is `'auto' | 'manual'` only.** The spec's `'none'` level is not emitted as a finding, because nothing consumes it: notes such as banned words and unknown sets already reach the plan screen as `planWarnings` strings.
2. **`planWarnings` is not rewritten over `craftFindings`.** Both share the same predicates (`motifPattern`, the era-lock-aware `motifText`, `slotSet`, `setKeyNoun`, `containsPhrase`), which gives the spec's guarantee that the screen and the repair agree, without touching the existing strings and their tests.
3. **A repair answers with briefs, not slots**: `{"briefs": [...]}`. Only the brief of a slot is ever replaced, so `paragraphIndex`, `seconds` and timing cannot move by construction. `coversText` is forced back to the original's, so a repair can never re-anchor a slot to a different sentence.
4. **Banned words are stripped by `withoutBannedWords`** in `planChapterSlots` (which both the plan and the re-plan use), on every repair output, and in `generateStillCandidates`. Not in `plannedToRows`, which the Fix button's path does not pass through.
5. **A set run is not a finding when the slot's own sentence puts it in that set**, in both `craftFindings` and `planWarnings`. Otherwise `ignored-set` asks for the room and `set-run` asks to move out of it, and the repair would ping-pong.
6. **The Fix button computes findings over the whole film**, exactly as the board does, then repairs chapter by chapter. The automatic pass only has one chapter in hand, so it computes per chapter.
7. **Mock mode makes no repair call in either path.** `callLlm` has no mock shot-list path, and the mock plan produces no finding.

## Review Focus

The five inputs most likely to bite that the spec implies but does not spell out. Each has a pinning test in the task named.

1. **A repair that rewrites `coversText`.** The board anchors a slot to its sentence by `coversText`, so a changed one would move the slot to a different sentence. Expected: the original `coversText` is forced back. (Task 6)
2. **A repair reply with fewer or more briefs than asked.** Expected: a missing reply keeps its original, extras are ignored, and nothing shifts onto the wrong slot. (Task 6)
3. **One slot with several findings.** Expected: it is sent to the repair once, carrying every problem, never once per finding (which would misalign the replies). (Task 5)
4. **A name or room word inside a longer word, or a generic room word.** "Parker" in "Parkerton", "center" in "at the center of it all". Expected: no finding. (Tasks 4 and 5)
5. **Two sentences in a row that both happen in the same room.** Expected: both are set there, with no set-run finding fighting the ignored-set rule. (Tasks 4 and 5)

---

### Task 1: The bible stages people in place

**Files:**
- Modify: `packages/providers/src/prompts/direction-craft.md`
- Regenerate: `packages/providers/src/prompts/direction-craft.ts` (via `embed:craft`, never by hand)
- Test: `packages/providers/src/prompts/direction-craft.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the new `DIRECTION_CRAFT` text, read by the shot-list and book prompts.

- [ ] **Step 1: Write the failing test**

Append inside the existing top-level `describe` in `direction-craft.test.ts` (after the `'puts the sentence before the checklist, and caps the motifs (decision 260)'` test):

```ts
  it('stages people in place rather than symbols, and drops the motif floor (decision 271)', () => {
    expect(DIRECTION_CRAFT).toContain('The people, in the rooms where it happened')
    expect(DIRECTION_CRAFT).not.toContain('Rooms after the people have left')
    expect(DIRECTION_CRAFT).not.toContain('never the face')
    expect(DIRECTION_CRAFT).toContain('An abstract sentence is staged, not symbolised.')
    expect(DIRECTION_CRAFT).toContain('the principals at the boardroom table')
    expect(DIRECTION_CRAFT).not.toContain('each chapter shows at least one of them')
    expect(DIRECTION_CRAFT).not.toContain('Every chapter shows at least one motif')
    expect(DIRECTION_CRAFT).not.toContain('may stand in for the third fact')
    expect(DIRECTION_CRAFT).toContain("Never copy the era lock's list into a prompt")
    expect(DIRECTION_CRAFT).not.toContain("Append the director's book invariants verbatim")
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/providers && npx vitest run src/prompts/direction-craft.test.ts`
Expected: FAIL on `The people, in the rooms where it happened`.

- [ ] **Step 3: Edit the markdown**

Make these six replacements in `packages/providers/src/prompts/direction-craft.md`. Each "old" block is the file's current text, verbatim.

(a) House look. Old:

```
- Register: the Netflix money documentary. Dark, patient, photographic
  realism. Rooms after the people have left. Documents, hands, screens,
  glass, reflections, corridors, car parks at night, empty trading floors.
```

New:

```
- Register: the Netflix money documentary. Dark, patient, photographic
  realism. The people, in the rooms where it happened: principals at the
  table, in the corridor, at the podium, re-created with a reconstruction's
  restraint. Empty rooms, documents and objects are punctuation between
  them, not the film.
```

(b) Faces. Old:

```
- Light carries the mood, never the face. Practical sources the viewer can
  see: a desk lamp, a monitor, a window at dusk, sodium street light,
  fluorescent tubes. Name the source, its direction and its quality in
  every prompt.
```

New:

```
- Light carries the mood. Faces are allowed, and where the cast is
  photographed they are wanted, lit by the scene's own sources. Practical
  sources the viewer can see: a desk lamp, a monitor, a window at dusk,
  sodium street light, fluorescent tubes. Name the source, its direction and
  its quality in every prompt.
```

(c) The sentence decides the frame. Old:

```
- The sentence decides the frame. Read the narration the slot covers
  before anything else and show what it names: the place, the object, the
  event, the document, the person doing what the sentence says they did.
  A viewer with the sound off should be able to guess the sentence from
  the frame. Only when a sentence names nothing photographable (an
  abstraction, a judgment, a number with no scene around it) reach for
  the director's book: the chapter's key image, a location, a motif.
```

New:

```
- The sentence decides the frame. Read the narration the slot covers
  before anything else and show what it names: the place, the object, the
  event, the document, the person doing what the sentence says they did.
  A viewer with the sound off should be able to guess the sentence from
  the frame. A sentence that names a person or a place shows that person
  or that place.
- An abstract sentence is staged, not symbolised. Pressure, doubt, a
  disagreement, a judgment: show the people it concerns, in the place it
  happened. "Financial pressure on the business and disagreements inside
  the boardroom" is the principals at the boardroom table, mid-argument,
  never an object standing in for them. Only a sentence with no person and
  no place in it reaches for the director's book, and then for the
  chapter's location first and a motif last.
```

(d) Motifs. Old:

```
- Motifs recur, and recur sparingly. The director's book names three;
  each chapter shows at least one of them, in a new place, and
  each motif at most once per chapter. Never in two adjacent slots,
  and never as the subject of the frame unless the sentence is about
  it. A motif that does not fit the sentence stays out; the floor is
  one motif per chapter, not one per still.
```

New (the third line is kept whole because a test pins it):

```
- Motifs are optional punctuation. The director's book names three; use
  one only where its sentence has room for it, and
  each motif at most once per chapter. Never in two adjacent slots,
  and never as the subject of the frame unless the sentence is about
  it. A chapter with no motif in it is a chapter whose sentences were all
  about something; that is the goal, not a gap.
```

(e) Three physical facts. Old:

```
  document, place or time of day). A motif from the director's book
  may stand in for the third fact, at most once per chapter.
```

New:

```
  document, place or time of day).
```

(f) Era lock. Old:

```
- Append the director's book invariants verbatim: the era lock for the
  moment and the palette line. Add the full name and role of any person
  shown, and their identity string ONLY when no photograph of them exists;
  where one does, the photograph is the likeness and the identity string
  stays out of the prompt.
```

New:

```
- Append the director's book palette line verbatim. The era lock is a
  constraint, not a list to paste: every period object in the frame comes
  from it, and the prompt names only the objects actually in the frame.
  Never copy the era lock's list into a prompt; the image model reads a
  list of objects as a list of things to show. Add the full name and role
  of any person shown, and their identity string ONLY when no photograph
  of them exists; where one does, the photograph is the likeness and the
  identity string stays out of the prompt.
```

(g) Pre-flight. Old:

```
- Every chapter shows at least one motif, no motif more than once, and
  builds to its key image. Every frame shows what its sentence says.
- Every era lock is obeyed in every prompt it touches.
```

New:

```
- No motif more than once in a chapter, and none where its sentence has
  no room for it. Every chapter builds to its key image. Every frame shows
  what its sentence says; a sentence that names a person or a place shows
  that person or that place.
- Every era lock is obeyed in every prompt it touches, and its list is
  never pasted into one.
```

- [ ] **Step 4: Format and re-embed**

Run, in order:

```bash
pnpm exec prettier --write packages/providers/src/prompts/direction-craft.md
pnpm --filter @boom-busters/providers embed:craft
```

Expected: `direction-craft.ts re-embedded from direction-craft.md`.

- [ ] **Step 5: Run the tests**

Run: `cd packages/providers && npx vitest run`
Expected: PASS, including the byte-identity test and the no-dash test.

- [ ] **Step 6: Commit**

```bash
git add packages/providers/src/prompts/direction-craft.md packages/providers/src/prompts/direction-craft.ts packages/providers/src/prompts/direction-craft.test.ts
git commit -m "feat(prompts): the bible stages people in place, and the era lock stops populating frames (decision 271)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The book and the shot list follow the bible

**Files:**
- Modify: `packages/providers/src/prompts/direction.ts` (`BOOK_SHAPE` and the "Rules for the book")
- Modify: `packages/providers/src/prompts/shotlist.ts` (the planning rules in `buildShotListRequest`)
- Test: `packages/providers/src/prompts/direction.test.ts`, `packages/providers/src/prompts/shotlist.test.ts`

**Interfaces:**
- Consumes: Task 1's bible (both system prompts embed it).
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

Append to `packages/providers/src/prompts/direction.test.ts` (top level):

```ts
describe('the book cannot converge on one symbol (decision 271)', () => {
  const request = buildDirectorsBookRequest({
    caseTitle: 'Stability AI',
    chapters: [{ title: 'The exit', paragraphs: ['He is gone.'] }],
    claims: [],
    styleAnchors: 'a',
  })

  it('keeps the anchor object out of the motifs, and the motifs apart', () => {
    expect(request.system).toContain('The anchor object is one object the film returns to')
    expect(request.system).toContain('sharing no head noun with each other or with the')
  })

  it('puts people in the thesis and in the key images', () => {
    expect(request.system).toContain('including its people')
    expect(request.system).toContain('describes how the film looks with its people in it')
    expect(request.system).toContain('led by the people and place the claims name for it')
  })

  it('keeps an era lock off the subject of a frame', () => {
    expect(request.system).toContain('Era locks constrain what a frame may contain')
  })
})
```

Append to `packages/providers/src/prompts/shotlist.test.ts` (top level):

```ts
describe('the planning rules stage the sentence (decision 271)', () => {
  const request = buildShotListRequest({
    caseTitle: 'Stability AI',
    chapterTitle: 'The exit',
    paragraphs: [{ index: 0, text: 'He is gone.', seconds: 9 }],
    claims: [],
    styleAnchors: 'a',
  })

  it('stages an abstract sentence through its people and place, never a symbol', () => {
    expect(request.system).toContain('Stage an abstract sentence, never symbolise it.')
    expect(request.system).toContain('it is not a server, a chair or a document standing in for them')
    expect(request.system).not.toContain(
      'the sentence names nothing photographable do you reach for the book',
    )
  })

  it('shows the person a sentence names', () => {
    expect(request.system).toContain('A sentence that names a person shows that person')
  })

  it('treats the era lock as a constraint, and sets no motif minimum', () => {
    expect(request.system).toContain(
      'The era lock is a constraint on what may appear, not a list to paste.',
    )
    expect(request.system).toContain('There is no minimum')
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/providers && npx vitest run src/prompts/direction.test.ts src/prompts/shotlist.test.ts`
Expected: FAIL on the new assertions.

- [ ] **Step 3: Edit the book prompt**

In `packages/providers/src/prompts/direction.ts`, `BOOK_SHAPE`, replace

```
  "visualThesis": string (one or two sentences: what this film looks like and why),
```

with

```
  "visualThesis": string (one or two sentences: what this film looks like, including its people, and why),
```

In the "Rules for the book" list, replace the single line

```
- Era locks name objects, not adjectives.
```

with

```
- Era locks name objects, not adjectives.
- Era locks constrain what a frame may contain; they are never the subject
  of a frame.
```

and insert, immediately after the bullet that ends `A motif that could belong to any corporate collapse is chosen again.`, these three bullets:

```
- The anchor object is one object the film returns to; it is never one of
  the motifs, and it is never the story's subject. The three motifs are
  three different objects, sharing no head noun with each other or with the
  anchor object. A film whose anchor, motifs and key images all show one
  thing has one image, not a book.
- The visual thesis describes how the film looks with its people in it. It
  never prescribes empty rooms, or one object, as what the film is made of.
- A chapter's key image is one photographable moment at the chapter's turn,
  led by the people and place the claims name for it. It is not a list of
  motifs, and it carries at most one.
```

- [ ] **Step 4: Edit the shot-list planning rules**

In `packages/providers/src/prompts/shotlist.ts`, inside the `system` template of `buildShotListRequest`, replace

```
- The sentence decides the frame. Read "coversText" before anything else and
  show what it says: the place it names, the object it mentions, the thing
  that happened, the person doing what the sentence says they did. Only when
  the sentence names nothing photographable do you reach for the book: the
  chapter's key image, a location, a motif.
- Motifs are seasoning, not the meal. Use each motif at most once across the chapter,
  never in consecutive slots, and never as the subject of a frame unless the
  sentence is about it. A still whose sentence gives you a concrete subject
  needs no motif at all.
```

with

```
- The sentence decides the frame. Read "coversText" before anything else and
  show what it says: the place it names, the object it mentions, the thing
  that happened, the person doing what the sentence says they did.
  A sentence that names a person shows that person, listed in "depicts".
- Stage an abstract sentence, never symbolise it. "Financial pressure and
  disagreements inside the boardroom" is the principals at the boardroom
  table; it is not a server, a chair or a document standing in for them.
  Only a sentence with no person and no place in it reaches for the book,
  and then for the chapter's location first and a motif last.
- The era lock is a constraint on what may appear, not a list to paste.
  Name only the period objects actually in your frame.
- Motifs are seasoning, not the meal. Use each motif at most once across the chapter,
  never in consecutive slots, and never as the subject of a frame unless the
  sentence is about it. A still whose sentence gives you a concrete subject
  needs no motif at all.
  There is no minimum: a chapter with no motif in it is fine.
```

- [ ] **Step 5: Run the tests**

Run: `cd packages/providers && npx vitest run`
Expected: PASS (the existing pins `each motif at most once across the chapter`, `never in consecutive slots`, `needs no motif at all` still hold).

- [ ] **Step 6: Commit**

```bash
git add packages/providers/src/prompts/direction.ts packages/providers/src/prompts/shotlist.ts packages/providers/src/prompts/direction.test.ts packages/providers/src/prompts/shotlist.test.ts
git commit -m "feat(prompts): the book cannot converge on one symbol, and the shot list stages its sentences (decision 271)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Banned words are removed, not reported

**Files:**
- Modify: `packages/providers/src/prompts/direction-craft.ts` (append after `BANNED_PROMPT_WORDS`, outside the `DIRECTION_CRAFT` literal)
- Modify: `apps/web/lib/visual-assets.ts` (`generateStillCandidates`)
- Test: `packages/providers/src/prompts/direction-craft.test.ts`, `apps/web/lib/visual-assets.test.ts`

**Interfaces:**
- Consumes: `BANNED_PROMPT_WORDS`.
- Produces (exported from `@boom-busters/providers`):
  - `stripBannedWords(text: string, banned?: readonly string[]): string`
  - `withoutBannedWords<T extends { type: string }>(brief: T): T`

- [ ] **Step 1: Write the failing provider tests**

Add `stripBannedWords, withoutBannedWords` to the import from `./direction-craft` in `direction-craft.test.ts`, and append at top level:

```ts
describe('stripBannedWords (decision 271)', () => {
  it('removes a banned word and the comma it leaves behind', () => {
    expect(stripBannedWords('a stunning, cold room')).toBe('a cold room')
    expect(stripBannedWords('a cold, stunning room')).toBe('a cold room')
    expect(stripBannedWords('cold, stunning, quiet room')).toBe('cold, quiet room')
  })

  it('removes phrases, ignoring case', () => {
    expect(stripBannedWords('Dramatic Lighting over a desk, 50mm lens')).toBe(
      'over a desk, 50mm lens',
    )
  })

  it('leaves words that only contain a banned one', () => {
    expect(stripBannedWords('an unprofessional, moodily lit hall')).toBe(
      'an unprofessional, moodily lit hall',
    )
  })

  it('tidies the space a removal leaves before punctuation', () => {
    expect(stripBannedWords('the room, cinematic.')).toBe('the room.')
  })

  it('returns clean text unchanged', () => {
    expect(stripBannedWords('A boardroom at dusk, 35mm lens.')).toBe(
      'A boardroom at dusk, 35mm lens.',
    )
  })
})

describe('withoutBannedWords', () => {
  it('cleans a still prompt and leaves its description alone', () => {
    expect(
      withoutBannedWords({
        type: 'still',
        prompt: 'A cinematic boardroom',
        description: 'A cinematic moment',
      }),
    ).toEqual({ type: 'still', prompt: 'A boardroom', description: 'A cinematic moment' })
  })

  it('returns the same object when there is nothing to clean or no prompt', () => {
    const stock = { type: 'stock', query: 'cinematic office' }
    expect(withoutBannedWords(stock)).toBe(stock)
    const clean = { type: 'still', prompt: 'A boardroom' }
    expect(withoutBannedWords(clean)).toBe(clean)
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/providers && npx vitest run src/prompts/direction-craft.test.ts`
Expected: FAIL, `stripBannedWords is not a function`.

- [ ] **Step 3: Implement**

Append to `packages/providers/src/prompts/direction-craft.ts`, after the `BANNED_PROMPT_WORDS` array:

```ts
/**
 * A prompt with every banned word removed (decision 271).
 *
 * The bible bans these because they render nothing, and a plan note used to
 * be the only consequence of one appearing: it named the word and left it in
 * the prompt the image model read. Removing it is free and certain, so a
 * banned word is now something that cannot reach the model rather than
 * something the producer is told about.
 *
 * Whole words only, ignoring case, so "unprofessional" and "moodily" survive.
 * The comma a removal orphans goes with it: "a stunning, cold room" becomes
 * "a cold room", and "cold, stunning, quiet" keeps one comma.
 */
export function stripBannedWords(
  text: string,
  banned: readonly string[] = BANNED_PROMPT_WORDS,
): string {
  let out = text
  for (const word of banned) {
    const phrase = word
      .trim()
      .split(/\s+/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s+')
    if (phrase.length === 0) continue
    out = out.replace(
      new RegExp(`(\\s*,\\s*)?\\b${phrase}\\b(\\s*,)?`, 'gi'),
      (_match: string, before: string | undefined, after: string | undefined) =>
        before !== undefined && after !== undefined ? ', ' : ' ',
    )
  }
  return out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim()
}

/**
 * A still or hero brief with its prompt cleaned (decision 271); any other
 * brief, and a clean one, comes back as the same object. The description is
 * for people and is left as written.
 */
export function withoutBannedWords<T extends { type: string }>(brief: T): T {
  if (brief.type !== 'still' && brief.type !== 'hero') return brief
  const prompt = (brief as { prompt?: unknown }).prompt
  if (typeof prompt !== 'string') return brief
  const cleaned = stripBannedWords(prompt)
  return cleaned === prompt ? brief : { ...brief, prompt: cleaned }
}
```

- [ ] **Step 4: Run the provider tests**

Run: `cd packages/providers && npx vitest run src/prompts/direction-craft.test.ts`
Expected: PASS. (The embed script only rewrites the `DIRECTION_CRAFT` literal, so code after it is safe.)

- [ ] **Step 5: Write the failing generation-guard test**

In `apps/web/lib/visual-assets.test.ts`, inside `describeDb('generateStillCandidates with the cast', ...)`, add (next to `'generates from text alone for a stranger or a member without photos'`):

```ts
  // A brief stored before decision 271, or edited in by hand, still carries a
  // banned word; it is removed at the last point before the image model.
  it('strips a banned word from a stored prompt before generating', async () => {
    await generateStillCandidates(
      { ...still, prompt: 'A cinematic boardroom at dusk.' },
      FIXTURE_PROJECT_ID,
    )
    expect(generate.mock.calls[0]?.[0]?.prompt).toBe('A boardroom at dusk.')
  })
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd apps/web && npx vitest run lib/visual-assets.test.ts -t "strips a banned word"`
Expected: FAIL, received `'A cinematic boardroom at dusk.'`.

- [ ] **Step 7: Implement the guard**

In `apps/web/lib/visual-assets.ts`, add `stripBannedWords` to the import from `@boom-busters/providers`, and in `generateStillCandidates` change

```ts
  const prompt = withReferenceClause(
    brief.prompt,
```

to

```ts
  const prompt = withReferenceClause(
    stripBannedWords(brief.prompt),
```

- [ ] **Step 8: Run the web file**

Run: `cd apps/web && npx vitest run lib/visual-assets.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/providers/src/prompts/direction-craft.ts packages/providers/src/prompts/direction-craft.test.ts apps/web/lib/visual-assets.ts apps/web/lib/visual-assets.test.ts
git commit -m "feat(prompts): a banned word is removed from the prompt, not reported beside it (decision 271)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The lint stops counting the era lock, and lets a sentence justify its room

**Files:**
- Modify: `packages/schemas/src/direction.ts`
- Modify: `apps/web/lib/visuals-review.ts`, `apps/web/inngest/functions/visuals-runner.ts`, `apps/web/inngest/functions/visuals-replanner.ts` (pass era locks to `planWarnings`)
- Test: `packages/schemas/src/direction.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (exported from `@boom-busters/schemas`):
  - `interface FindingBrief { type: string; shotSize?: string | undefined; coversText: string; description?: string | undefined; prompt?: string | undefined; query?: string | undefined; depicts?: readonly string[] | undefined; set?: string | undefined }`
  - `interface FindingSlot { brief: FindingBrief; chapter?: string | undefined }`
  - `containsPhrase(text: string, phrase: string): boolean`
  - `setKeyNoun(name: string): string | null`
  - `planWarnings(slots, bannedWords, motifs = [], setNames = [], eraLocks: readonly string[] = [])` (new fifth parameter)
- Internal, used again by Task 5: `motifText(brief: FindingBrief, eraLocks?: readonly string[]): string | null`, `slotSet(brief: FindingBrief): string | null`, `sentencePlacesIn(brief: FindingBrief, set: string): boolean`, `escapeRegExp(text: string): string`.

- [ ] **Step 1: Write the failing tests**

Add `containsPhrase, setKeyNoun` to the import from `./direction` in `packages/schemas/src/direction.test.ts`, then append at top level:

```ts
describe('containsPhrase and setKeyNoun (decision 271)', () => {
  it('matches whole words, ignoring case and spacing', () => {
    expect(containsPhrase("Parker's money arrived.", 'Parker')).toBe(true)
    expect(containsPhrase('They met on Parkerton Road.', 'Parker')).toBe(false)
    expect(containsPhrase('The Data  Center ran hot.', 'data center')).toBe(true)
    expect(containsPhrase('anything', '   ')).toBe(false)
  })

  it('reads a set by its last word, or its last two when the last is generic', () => {
    expect(setKeyNoun('Venture Capital Boardroom')).toBe('boardroom')
    expect(setKeyNoun('Cloud Computing Data Center')).toBe('data center')
    expect(setKeyNoun('Lobby')).toBe('lobby')
    expect(setKeyNoun('Office')).toBe('office')
    expect(setKeyNoun('')).toBeNull()
  })
})

describe('planWarnings reads past the era lock, and lets a sentence justify its room (decision 271)', () => {
  const pasted = (shotSize: 'wide' | 'close'): ShotBrief => ({
    ...still(shotSize, 'A desk at dusk. 2019 to 2024: flat-panel LCD monitors, rack-mounted blade servers'),
  })
  const motifs = ['a glowing blue server blade in a darkened rack']
  const eraLocks = ['flat-panel LCD monitors, rack-mounted blade servers']

  // The Stability AI plan: every still pasted the era lock, and the era lock
  // says "rack-mounted", so the motif noun "rack" was found in all of them.
  it('does not count a motif noun that is only inside the pasted era lock', () => {
    const slots = [{ brief: pasted('wide') }, { brief: pasted('close') }]
    expect(planWarnings(slots, [], motifs, [], eraLocks)).toEqual([])
    expect(planWarnings(slots, [], motifs)).toEqual([
      expect.stringContaining('motif "a glowing blue server blade in a darkened rack" appears in 2 of 2'),
      expect.stringContaining('appears in two adjacent slots'),
    ])
  })

  const inRoom = (coversText: string, shotSize: 'wide' | 'close'): ShotBrief => ({
    ...still(shotSize, 'x'),
    coversText,
    set: 'Venture Capital Boardroom',
  })

  it('does not call two adjacent shots in one room a run when the sentence is set there', () => {
    const justified = [
      { brief: inRoom('Inside the boardroom.', 'wide') },
      { brief: inRoom('Back in the boardroom, they argued.', 'close') },
    ]
    expect(planWarnings(justified, [], [], ['Venture Capital Boardroom'])).not.toContainEqual(
      expect.stringContaining('fills two adjacent slots'),
    )
    const unjustified = [
      { brief: inRoom('Inside the boardroom.', 'wide') },
      { brief: inRoom('The money was gone.', 'close') },
    ]
    expect(planWarnings(unjustified, [], [], ['Venture Capital Boardroom'])).toContainEqual(
      expect.stringContaining('fills two adjacent slots'),
    )
  })
})
```

(`still(shotSize, prompt)` is the existing helper in this file; its `coversText` is `'x'`.)

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/schemas && npx vitest run src/direction.test.ts`
Expected: FAIL, `containsPhrase is not a function`.

- [ ] **Step 3: Implement**

In `packages/schemas/src/direction.ts`:

(a) Directly after the `WarnableSlot` interface, add:

```ts
/**
 * The fields of a brief the craft rules read (decision 271). Narrow on
 * purpose, so the same rules run over a planned brief straight from the
 * model and a stored brief from the database.
 */
export interface FindingBrief {
  type: string
  shotSize?: string | undefined
  coversText: string
  description?: string | undefined
  prompt?: string | undefined
  query?: string | undefined
  depicts?: readonly string[] | undefined
  set?: string | undefined
}

export interface FindingSlot {
  brief: FindingBrief
  /** The chapter this slot belongs to, as a note says it ("chapter 3"). */
  chapter?: string | undefined
}
```

(b) Directly after `motifPattern`, add:

```ts
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Whether `text` contains `phrase` as whole words, ignoring case and the
 * width of the whitespace between them (decision 271). "Parker" is not in
 * "Parkerton"; "data center" is in "the data  center".
 */
export function containsPhrase(text: string, phrase: string): boolean {
  const parts = phrase
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
  if (parts.length === 0) return false
  return new RegExp(`\\b${parts.map(escapeRegExp).join('\\s+')}\\b`, 'i').test(text)
}

/** Set-name words too general to identify one room on their own. */
const GENERIC_SET_WORDS = new Set([
  'center',
  'centre',
  'room',
  'office',
  'building',
  'floor',
  'space',
  'area',
])

/**
 * The words a sentence would use for a set (decision 271): the name's last
 * word, or its last two when the last is too general to mean one room.
 * "Venture Capital Boardroom" is "boardroom"; "Cloud Computing Data Center" is
 * "data center", so "at the center of it" does not put a shot in the data
 * centre.
 */
export function setKeyNoun(name: string): string | null {
  const words = name.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) ?? []
  const last = words[words.length - 1]
  if (last === undefined) return null
  const before = words[words.length - 2]
  return GENERIC_SET_WORDS.has(last) && before !== undefined ? `${before} ${last}` : last
}

/**
 * A brief's words with the book's era-lock lists taken out (decision 271).
 * The bible used to have every prompt paste the era lock verbatim, and an era
 * lock is a list of objects, so a motif noun inside it ("rack" in
 * "rack-mounted blade servers") counted as the motif in every still of the
 * film.
 */
function withoutEraLocks(text: string, eraLocks: readonly string[]): string {
  let out = text
  for (const rules of eraLocks) {
    const trimmed = rules.trim()
    if (trimmed.length > 0) out = out.replace(new RegExp(escapeRegExp(trimmed), 'gi'), ' ')
  }
  return out
}
```

(c) Replace `motifText` and `slotSet` with:

```ts
/** The words of a brief a motif could hide in. Charts, maps and headlines have none. */
function motifText(brief: FindingBrief, eraLocks: readonly string[] = []): string | null {
  const words =
    brief.type === 'still' || brief.type === 'hero'
      ? `${brief.description ?? ''} ${brief.prompt ?? ''}`
      : brief.type === 'stock' || brief.type === 'archival'
        ? `${brief.description ?? ''} ${brief.query ?? ''}`
        : null
  return words === null ? null : withoutEraLocks(words, eraLocks)
}

/** The set a slot names, or null. Only picture briefs can name one. */
function slotSet(brief: FindingBrief): string | null {
  if (brief.type !== 'still' && brief.type !== 'hero') return null
  return brief.set?.trim() || null
}

/**
 * Whether a slot's own sentence puts it in this set (decision 271). A room
 * the sentence names is the right room however often it recurs, so this is
 * what separates a justified run of shots in one set from the "room on every
 * slot" mistake.
 */
function sentencePlacesIn(brief: FindingBrief, set: string): boolean {
  const key = setKeyNoun(set)
  return key !== null && containsPhrase(brief.coversText, key)
}
```

(d) In `planWarnings`, add the fifth parameter after `setNames`:

```ts
  /** The book's era-lock `rules` strings, taken out before a motif is looked for (decision 271). */
  eraLocks: readonly string[] = [],
```

change `const texts = slots.map((slot) => motifText(slot.brief))` to

```ts
  const texts = slots.map((slot) => motifText(slot.brief, eraLocks))
```

and in the adjacent-set loop change the condition

```ts
    if (here && next && here === next && !adjacent.has(here)) {
```

to

```ts
    if (
      here &&
      next &&
      here === next &&
      !sentencePlacesIn(slots[index + 1]!.brief, next) &&
      !adjacent.has(here)
    ) {
```

(e) Pass the era locks at the three call sites:
- `apps/web/lib/visuals-review.ts`: the `planWarnings(...)` call gains a fifth argument `direction?.eraLocks.map((lock) => lock.rules) ?? []`.
- `apps/web/inngest/functions/visuals-runner.ts`: gains `direction.book.eraLocks.map((lock) => lock.rules)`.
- `apps/web/inngest/functions/visuals-replanner.ts`: gains `setup.direction?.eraLocks.map((lock) => lock.rules) ?? []`.

- [ ] **Step 4: Run the schemas tests and typecheck**

Run: `cd packages/schemas && npx vitest run` then `pnpm typecheck`
Expected: PASS, 10 of 10 typecheck.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/direction.ts packages/schemas/src/direction.test.ts apps/web/lib/visuals-review.ts apps/web/inngest/functions/visuals-runner.ts apps/web/inngest/functions/visuals-replanner.ts
git commit -m "fix(schemas): the lint reads past the pasted era lock, and a sentence justifies its room (decision 271)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Graded findings

**Files:**
- Modify: `packages/schemas/src/direction.ts` (append)
- Test: `packages/schemas/src/direction.test.ts`

**Interfaces:**
- Consumes (Task 4): `FindingBrief`, `FindingSlot`, `containsPhrase`, `motifPattern`, `motifText`, `slotSet`, `sentencePlacesIn`; existing `nameMatches` (already imported) and `DirectorsBook`.
- Produces (exported from `@boom-busters/schemas`):
  - `type CraftFindingKind = 'size-run' | 'motif-repeat' | 'set-run' | 'ignored-person' | 'ignored-set'`
  - `type RepairLevel = 'auto' | 'manual'`
  - `interface CraftFinding { kind: CraftFindingKind; slotIndex: number; message: string; repair: RepairLevel }`
  - `interface FindingContext { motifs: readonly string[]; eraLocks: readonly string[]; cast: readonly { name: string; photographed: boolean }[]; sets: readonly string[] }`
  - `craftFindings(slots: readonly FindingSlot[], context: FindingContext): CraftFinding[]` (sorted by `slotIndex`)
  - `interface RepairTarget { slotIndex: number; findings: CraftFinding[] }`
  - `repairTargets(findings: readonly CraftFinding[], levels: readonly RepairLevel[]): RepairTarget[]`
  - `interface RepairSummary { slots: number; becomeStills: number; chapters: number }`
  - `repairSummary(slots: readonly FindingSlot[], findings: readonly CraftFinding[]): RepairSummary`
  - `findingContext(input: { direction: Pick<DirectorsBook, 'motifs' | 'eraLocks'> | null; cast: readonly { name: string; photographed: boolean }[]; sets: readonly { name: string }[] }): FindingContext`

- [ ] **Step 1: Write the failing tests**

Add `craftFindings, findingContext, repairSummary, repairTargets` to the value import from `./direction`, and `import type { FindingBrief, FindingContext, FindingSlot } from './direction'`. Append at top level:

```ts
const at = (
  brief: Partial<FindingBrief> & { type: string },
  chapter = 'chapter 1',
): FindingSlot => ({ chapter, brief: { coversText: 'x', description: 'x', ...brief } })

const ctx = (over: Partial<FindingContext> = {}): FindingContext => ({
  motifs: [],
  eraLocks: [],
  cast: [],
  sets: [],
  ...over,
})

describe('craftFindings (decision 271)', () => {
  it('flags the third shot of one size in a row, then counts again from there', () => {
    const slots = Array.from({ length: 6 }, () => at({ type: 'still', shotSize: 'wide' }))
    expect(craftFindings(slots, ctx()).map((f) => [f.kind, f.slotIndex, f.repair])).toEqual([
      ['size-run', 2, 'auto'],
      ['size-run', 5, 'auto'],
    ])
  })

  it('never flags a chart, whose brief carries claim references', () => {
    const charts = Array.from({ length: 3 }, () =>
      at({ type: 'chart', shotSize: 'graphic', coversText: 'Mostaque inside the boardroom.' }),
    )
    expect(
      craftFindings(
        charts,
        ctx({
          cast: [{ name: 'Emad Mostaque', photographed: true }],
          sets: ['Venture Capital Boardroom'],
        }),
      ),
    ).toEqual([])
  })

  it('flags a motif after its first use in a chapter, and an adjacent repeat across chapters', () => {
    const motifs = ['server racks']
    const hit = (chapter: string) =>
      at({ type: 'still', shotSize: 'wide', prompt: 'rows of racks' }, chapter)
    const miss = (chapter: string) =>
      at({ type: 'still', shotSize: 'close', prompt: 'a desk' }, chapter)
    const indexes = (slots: FindingSlot[]) =>
      craftFindings(slots, ctx({ motifs })).map((f) => f.slotIndex)
    expect(indexes([hit('chapter 1'), miss('chapter 1'), hit('chapter 1')])).toEqual([2])
    expect(indexes([hit('chapter 1'), hit('chapter 2')])).toEqual([1])
    expect(indexes([hit('chapter 1'), miss('chapter 2'), hit('chapter 2')])).toEqual([])
  })

  it('does not count a motif noun that is only inside the pasted era lock', () => {
    const eraLocks = ['flat-panel LCD monitors, rack-mounted blade servers']
    const motifs = ['a glowing blue server blade in a darkened rack']
    const pasted = (shotSize: string) =>
      at({
        type: 'still',
        shotSize,
        prompt: 'A desk at dusk. 2019 to 2024: flat-panel LCD monitors, rack-mounted blade servers',
      })
    const slots = [pasted('wide'), pasted('close')]
    expect(craftFindings(slots, ctx({ motifs, eraLocks }))).toEqual([])
    // Without the era lock to take out, the old overcount comes back.
    expect(craftFindings(slots, ctx({ motifs })).map((f) => f.kind)).toEqual(['motif-repeat'])
  })

  it('flags a set run only when the sentence does not put the shot there', () => {
    const sets = ['Venture Capital Boardroom']
    const inRoom = (coversText: string, shotSize: string) =>
      at({ type: 'still', shotSize, coversText, set: 'Venture Capital Boardroom' })
    expect(
      craftFindings(
        [inRoom('Inside the boardroom.', 'wide'), inRoom('The money was gone.', 'close')],
        ctx({ sets }),
      ).map((f) => [f.kind, f.slotIndex]),
    ).toEqual([['set-run', 1]])
    expect(
      craftFindings(
        [
          inRoom('Inside the boardroom.', 'wide'),
          inRoom('Back in the boardroom, they argued.', 'close'),
        ],
        ctx({ sets }),
      ),
    ).toEqual([])
  })

  describe('ignored-person, graded by what the fix would cost', () => {
    const cast = [
      { name: 'Emad Mostaque', photographed: true },
      { name: 'Sean Parker', photographed: false },
    ]
    const one = (brief: Partial<FindingBrief> & { type: string }) =>
      craftFindings([at({ shotSize: 'wide', ...brief })], ctx({ cast }))

    it('is auto for a photographed member left off a still', () => {
      expect(one({ type: 'still', coversText: 'Mostaque told the investors.' })).toEqual([
        {
          kind: 'ignored-person',
          slotIndex: 0,
          repair: 'auto',
          message:
            'Emad Mostaque is named here and photographed, but the shot does not show ' +
            'Emad Mostaque; show Emad Mostaque and list the name in "depicts"',
        },
      ])
    })

    it('is manual for an unphotographed member, saying the likeness would come from a description', () => {
      const [finding] = one({ type: 'still', coversText: "Parker's money arrived." })
      expect(finding).toMatchObject({ repair: 'manual' })
      expect(finding?.message).toContain('from a description, with no photograph')
    })

    it('is manual for anyone on a stock slot, saying it would become a generated still', () => {
      expect(one({ type: 'stock', coversText: 'Mostaque told the investors.' })).toEqual([
        {
          kind: 'ignored-person',
          slotIndex: 0,
          repair: 'manual',
          message:
            'Emad Mostaque is named here but the shot is stock; fixing makes it a ' +
            'generated still of Emad Mostaque',
        },
      ])
    })

    it('never flags archival, which the producer sources by hand', () => {
      expect(one({ type: 'archival', coversText: 'Mostaque told the investors.' })).toEqual([])
    })

    it('is silent when depicts names the member, role suffix and all', () => {
      expect(
        one({
          type: 'still',
          coversText: 'Mostaque told the investors.',
          depicts: ['Emad Mostaque, founder'],
        }),
      ).toEqual([])
    })

    it('matches the surname as a whole word only', () => {
      expect(one({ type: 'still', coversText: 'They met on Parkerton Road.' })).toEqual([])
    })

    it('names people and never refers back with a pronoun', () => {
      const messages = [
        ...one({ type: 'still', coversText: 'Mostaque and Parker met.' }),
        ...one({ type: 'stock', coversText: 'Mostaque and Parker met.' }),
      ].map((f) => f.message)
      expect(messages).toHaveLength(4)
      for (const message of messages) expect(message).not.toMatch(/\b(he|him|his|she|her|hers)\b/i)
    })
  })

  describe('ignored-set', () => {
    const sets = ['Venture Capital Boardroom', 'Cloud Computing Data Center']
    const one = (brief: Partial<FindingBrief> & { type: string }) =>
      craftFindings([at({ shotSize: 'wide', ...brief })], ctx({ sets }))

    // The owner's own example (decision 271).
    it('is auto for a still set in the wrong room', () => {
      expect(
        one({
          type: 'still',
          coversText:
            'Reporting at the time pointed to financial pressure on the business and ' +
            'disagreements inside the boardroom over where it was headed.',
          prompt: 'A high-end, aluminum-chassis rack-mounted AI server unit',
          set: 'Cloud Computing Data Center',
        }),
      ).toEqual([
        {
          kind: 'ignored-set',
          slotIndex: 0,
          repair: 'auto',
          message:
            'the sentence is in Venture Capital Boardroom, but the shot is set in ' +
            '"Cloud Computing Data Center"; set it in "Venture Capital Boardroom"',
        },
      ])
    })

    it('is silent for a still already in that room', () => {
      expect(
        one({ type: 'still', coversText: 'Inside the boardroom.', set: 'Venture Capital Boardroom' }),
      ).toEqual([])
    })

    it('is manual on stock', () => {
      expect(one({ type: 'stock', coversText: 'Inside the boardroom.' })).toMatchObject([
        { kind: 'ignored-set', repair: 'manual' },
      ])
    })

    it('reads a generic last word together with the word before it', () => {
      expect(one({ type: 'still', coversText: 'The data center ran hot.' })).toMatchObject([
        { kind: 'ignored-set', message: expect.stringContaining('names no set') },
      ])
      expect(one({ type: 'still', coversText: 'At the center of it all was one man.' })).toEqual([])
    })
  })
})

describe('repairTargets, repairSummary and findingContext', () => {
  const cast = [{ name: 'Emad Mostaque', photographed: true }]
  const slots = [
    at({ type: 'still', shotSize: 'wide' }),
    at({ type: 'still', shotSize: 'wide' }),
    // A third wide still AND a photographed name left out: two auto findings on one slot.
    at({ type: 'still', shotSize: 'wide', coversText: 'Mostaque spoke.' }),
    at({ type: 'stock', shotSize: 'close', coversText: 'Mostaque spoke.' }, 'chapter 2'),
  ]
  const findings = craftFindings(slots, ctx({ cast }))

  it('sends a slot once, carrying every finding it has', () => {
    const targets = repairTargets(findings, ['auto'])
    expect(targets.map((t) => t.slotIndex)).toEqual([2])
    expect(targets[0]?.findings.map((f) => f.kind).sort()).toEqual(['ignored-person', 'size-run'])
  })

  it('includes manual findings only when asked', () => {
    expect(repairTargets(findings, ['auto', 'manual']).map((t) => t.slotIndex)).toEqual([2, 3])
  })

  it('counts slots, stills-to-be and chapters for the button', () => {
    expect(repairSummary(slots, findings)).toEqual({ slots: 2, becomeStills: 1, chapters: 2 })
  })

  it('reads motifs and era-lock rules from the book', () => {
    expect(
      findingContext({
        direction: { motifs: ['m'], eraLocks: [{ span: 's', rules: 'r' }] },
        cast: [],
        sets: [{ name: 'Lobby' }],
      }),
    ).toEqual({ motifs: ['m'], eraLocks: ['r'], cast: [], sets: ['Lobby'] })
    expect(findingContext({ direction: null, cast: [], sets: [] })).toEqual({
      motifs: [],
      eraLocks: [],
      cast: [],
      sets: [],
    })
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/schemas && npx vitest run src/direction.test.ts`
Expected: FAIL, `craftFindings is not a function`.

- [ ] **Step 3: Implement**

Append to `packages/schemas/src/direction.ts`:

```ts
// ---------------------------------------------------------------------------
// Graded findings (decision 271)
// ---------------------------------------------------------------------------

export type CraftFindingKind =
  | 'size-run'
  | 'motif-repeat'
  | 'set-run'
  | 'ignored-person'
  | 'ignored-set'

/**
 * Who may spend on fixing a finding. `auto`: the automatic repair after each
 * chapter is planned, and the Fix button. `manual`: only the Fix button,
 * because the fix is real but not clearly better unasked (it turns a free
 * slot into a paid still, or puts a real person on screen from a description
 * alone).
 */
export type RepairLevel = 'auto' | 'manual'

export interface CraftFinding {
  kind: CraftFindingKind
  /** Index into the slots passed in. */
  slotIndex: number
  /** What the producer reads, and what the repair call is told. */
  message: string
  repair: RepairLevel
}

export interface FindingContext {
  motifs: readonly string[]
  /** The book's era-lock `rules` strings, taken out before a motif is looked for. */
  eraLocks: readonly string[]
  /** Every cast member; `photographed` means at least one photograph is held. */
  cast: readonly { name: string; photographed: boolean }[]
  /** Every set the film holds, by name. */
  sets: readonly string[]
}

const PICTURE_TYPES = new Set(['still', 'hero', 'stock', 'archival'])
const LIKENESS_TYPES = new Set(['still', 'hero'])

/**
 * What a craft check needs to know about the film, read from the book, the
 * cast and the sets. One function so the automatic pass, the board and the
 * Fix button cannot read different motifs or era locks.
 */
export function findingContext(input: {
  direction: Pick<DirectorsBook, 'motifs' | 'eraLocks'> | null
  cast: readonly { name: string; photographed: boolean }[]
  sets: readonly { name: string }[]
}): FindingContext {
  return {
    motifs: input.direction?.motifs ?? [],
    eraLocks: input.direction?.eraLocks.map((lock) => lock.rules) ?? [],
    cast: input.cast,
    sets: input.sets.map((set) => set.name),
  }
}

/**
 * The problems in a plan a repair can act on, one finding per problem per
 * slot, graded by who may spend on fixing it. It shares its predicates with
 * `planWarnings` (`motifPattern`, `motifText`, `slotSet`, `sentencePlacesIn`),
 * so the plan screen and the repair agree about what is wrong.
 *
 * Only picture briefs are ever flagged. A chart, map, headline or graphic
 * carries claim references that are validated elsewhere, and a repair has no
 * business rewriting them.
 */
export function craftFindings(
  slots: readonly FindingSlot[],
  context: FindingContext,
): CraftFinding[] {
  const findings: CraftFinding[] = []

  // Size runs: the slot that makes a third in a row. The count restarts after
  // it, because repairing that slot is what breaks the run.
  let run = 1
  for (let index = 1; index < slots.length; index += 1) {
    const brief = slots[index]!.brief
    const size = brief.shotSize
    run = size !== undefined && size === slots[index - 1]!.brief.shotSize ? run + 1 : 1
    if (run === 3) {
      run = 0
      if (PICTURE_TYPES.has(brief.type)) {
        findings.push({
          kind: 'size-run',
          slotIndex: index,
          repair: 'auto',
          message: `this is the third "${size}" shot in a row; use a different shot size`,
        })
      }
    }
  }

  // Motifs: every use after the first in a chapter, and the second of two
  // adjacent uses wherever they fall. Era-lock text is taken out first.
  const texts = slots.map((slot) => motifText(slot.brief, context.eraLocks))
  for (const motif of context.motifs) {
    const pattern = motifPattern(motif)
    if (!pattern) continue
    const usedIn = new Set<string>()
    let previous = -2
    for (const [index, slot] of slots.entries()) {
      const text = texts[index]
      if (text === null || text === undefined || !pattern.test(text)) continue
      const chapter = slot.chapter ?? ''
      const adjacent = previous === index - 1
      if (usedIn.has(chapter) || adjacent) {
        findings.push({
          kind: 'motif-repeat',
          slotIndex: index,
          repair: 'auto',
          message:
            `the motif "${motif}" is already used ` +
            `${adjacent ? 'in the slot before' : 'earlier in this chapter'}; ` +
            'show what the sentence says instead',
        })
      }
      usedIn.add(chapter)
      previous = index
    }
  }

  // Set runs: two adjacent shots in one room, unless the sentence puts this
  // one there (the ignored-set rule below would ask for exactly that room).
  for (let index = 1; index < slots.length; index += 1) {
    const brief = slots[index]!.brief
    const here = slotSet(brief)
    if (here && here === slotSet(slots[index - 1]!.brief) && !sentencePlacesIn(brief, here)) {
      findings.push({
        kind: 'set-run',
        slotIndex: index,
        repair: 'auto',
        message:
          `the shot before is also in "${here}" and this sentence does not put us there; ` +
          'set it where its sentence is, or in no set',
      })
    }
  }

  // People and rooms the sentence names but the shot leaves out.
  for (const [index, { brief }] of slots.entries()) {
    const likeness = LIKENESS_TYPES.has(brief.type)
    if (!likeness && brief.type !== 'stock') continue

    for (const member of context.cast) {
      const surname = member.name.trim().split(/\s+/).pop()
      if (surname === undefined || !containsPhrase(brief.coversText, surname)) continue
      const shown =
        likeness && (brief.depicts ?? []).some((entry) => nameMatches(entry, member.name))
      if (shown) continue
      findings.push(
        !likeness
          ? {
              kind: 'ignored-person',
              slotIndex: index,
              repair: 'manual',
              message:
                `${member.name} is named here but the shot is stock; ` +
                `fixing makes it a generated still of ${member.name}`,
            }
          : member.photographed
            ? {
                kind: 'ignored-person',
                slotIndex: index,
                repair: 'auto',
                message:
                  `${member.name} is named here and photographed, but the shot does not ` +
                  `show ${member.name}; show ${member.name} and list the name in "depicts"`,
              }
            : {
                kind: 'ignored-person',
                slotIndex: index,
                repair: 'manual',
                message:
                  `${member.name} is named here but not shown; fixing puts ${member.name} ` +
                  'on screen from a description, with no photograph',
              },
      )
    }

    for (const name of context.sets) {
      if (!sentencePlacesIn(brief, name)) continue
      const named = slotSet(brief)
      if (likeness && named !== null && nameMatches(named, name)) continue
      findings.push(
        likeness
          ? {
              kind: 'ignored-set',
              slotIndex: index,
              repair: 'auto',
              message:
                `the sentence is in ${name}, but the shot ` +
                `${named === null ? 'names no set' : `is set in "${named}"`}; set it in "${name}"`,
            }
          : {
              kind: 'ignored-set',
              slotIndex: index,
              repair: 'manual',
              message:
                `the sentence is in ${name} but the shot is stock; ` +
                `fixing makes it a generated still set in "${name}"`,
            },
      )
    }
  }

  return findings.sort((a, b) => a.slotIndex - b.slotIndex)
}

export interface RepairTarget {
  slotIndex: number
  findings: CraftFinding[]
}

/**
 * The slots a repair rewrites: each once, carrying every finding of the given
 * levels, in slot order. Once per slot matters: the repair answers one brief
 * per target, in order, so a slot sent twice would put one answer on the
 * wrong slot.
 */
export function repairTargets(
  findings: readonly CraftFinding[],
  levels: readonly RepairLevel[],
): RepairTarget[] {
  const bySlot = new Map<number, CraftFinding[]>()
  for (const finding of findings) {
    if (!levels.includes(finding.repair)) continue
    bySlot.set(finding.slotIndex, [...(bySlot.get(finding.slotIndex) ?? []), finding])
  }
  return [...bySlot.entries()]
    .sort(([a], [b]) => a - b)
    .map(([slotIndex, group]) => ({ slotIndex, findings: group }))
}

export interface RepairSummary {
  /** Distinct slots the Fix button would rewrite. */
  slots: number
  /** How many of them are stock slots whose fix makes them a generated, paid still. */
  becomeStills: number
  /** Distinct chapters among them: the button spends one call per chapter. */
  chapters: number
}

/** What the Fix button would do, for its label and its confirm step. */
export function repairSummary(
  slots: readonly FindingSlot[],
  findings: readonly CraftFinding[],
): RepairSummary {
  const targets = repairTargets(findings, ['auto', 'manual'])
  return {
    slots: targets.length,
    becomeStills: targets.filter(
      (target) =>
        slots[target.slotIndex]?.brief.type === 'stock' &&
        target.findings.some(
          (finding) => finding.kind === 'ignored-person' || finding.kind === 'ignored-set',
        ),
    ).length,
    chapters: new Set(targets.map((target) => slots[target.slotIndex]?.chapter ?? '')).size,
  }
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `cd packages/schemas && npx vitest run` then `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/direction.ts packages/schemas/src/direction.test.ts
git commit -m "feat(schemas): findings graded by who may spend on fixing them (decision 271)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The repair request and its answer

**Files:**
- Modify: `packages/providers/src/prompts/shotlist.ts` (append a "Repair" section before "Mock mode")
- Test: `packages/providers/src/prompts/shotlist.test.ts`

**Interfaces:**
- Consumes: `LLMTaskRequest` (already imported in `shotlist.ts`), `outputBudget`, `SHOT_LIST_FLOOR_TOKENS`, `TOKENS_PER_SLOT`, `parseJsonCompletion`; `PlannedBriefSchema` and `PlannedBrief` from `@boom-busters/schemas`.
- Produces (exported from `@boom-busters/providers`):
  - `interface ShotRepairTarget { brief: unknown; problems: readonly string[] }`
  - `buildShotRepairRequest(base: LLMTaskRequest, targets: readonly ShotRepairTarget[], options: { allowStockToStill: boolean }): LLMTaskRequest`
  - `parseShotRepair(text: string, originals: readonly { type: string; coversText: string }[], options: { allowStockToStill: boolean }): (PlannedBrief | null)[]`

- [ ] **Step 1: Write the failing tests**

Add `buildShotRepairRequest, parseShotRepair` to the import from `./shotlist`, then append at top level:

```ts
describe('buildShotRepairRequest and parseShotRepair (decision 271)', () => {
  const base = buildShotListRequest({
    caseTitle: 'Stability AI',
    chapterTitle: 'The exit',
    paragraphs: [{ index: 0, text: 'Mostaque told the investors.', seconds: 9 }],
    claims: [],
    styleAnchors: 'a',
  })
  const still = {
    type: 'still',
    coversText: 'Mostaque told the investors.',
    description: 'A server rack.',
    shotSize: 'close',
    motion: { kind: 'static' },
    transition: 'cut',
    prompt: 'A server rack in the dark.',
  }
  const stock = {
    type: 'stock',
    coversText: 'Mostaque told the investors.',
    description: 'An office.',
    shotSize: 'wide',
    motion: { kind: 'static' },
    transition: 'cut',
    query: 'office',
    rejectionCriteria: [],
  }

  it("asks under the chapter's own rules and prefix, adding one message", () => {
    const repair = buildShotRepairRequest(
      base,
      [{ brief: still, problems: ['Emad Mostaque is named here and photographed'] }],
      { allowStockToStill: false },
    )
    expect(repair.system).toBe(base.system)
    expect(repair.cacheablePrefixMessages).toBe(base.cacheablePrefixMessages)
    expect(repair.messages.slice(0, base.messages.length)).toEqual(base.messages)
    expect(repair.messages).toHaveLength(base.messages.length + 1)
    const ask = repair.messages.at(-1)?.content ?? ''
    expect(ask).toContain('Emad Mostaque is named here and photographed')
    expect(ask).toContain('"briefs"')
    expect(ask).toContain('Keep each brief\'s "type" exactly as it is.')
  })

  it('lets the Fix button turn stock into a still, and says so', () => {
    const repair = buildShotRepairRequest(base, [{ brief: stock, problems: ['p'] }], {
      allowStockToStill: true,
    })
    expect(repair.messages.at(-1)?.content).toContain('may become a "still"')
  })

  it('returns the replacements in order, with the original sentence forced back', () => {
    const reply = JSON.stringify({
      briefs: [{ ...still, coversText: 'rewritten', prompt: 'Emad Mostaque at the table.' }],
    })
    expect(parseShotRepair(reply, [still], { allowStockToStill: false })[0]).toMatchObject({
      type: 'still',
      prompt: 'Emad Mostaque at the table.',
      coversText: 'Mostaque told the investors.',
    })
  })

  it('refuses a type change unless stock-to-still was allowed', () => {
    const reply = JSON.stringify({ briefs: [still] })
    expect(parseShotRepair(reply, [stock], { allowStockToStill: false })).toEqual([null])
    expect(parseShotRepair(reply, [stock], { allowStockToStill: true })[0]).toMatchObject({
      type: 'still',
    })
    // Only stock may change, and only into a still.
    const toStock = JSON.stringify({ briefs: [stock] })
    expect(parseShotRepair(toStock, [still], { allowStockToStill: true })).toEqual([null])
  })

  it('keeps the original where a reply is missing or malformed, and ignores extras', () => {
    const short = JSON.stringify({ briefs: [{ type: 'still' }] })
    expect(parseShotRepair(short, [still, still], { allowStockToStill: false })).toEqual([
      null,
      null,
    ])
    const extra = JSON.stringify({ briefs: [still, still, still] })
    expect(parseShotRepair(extra, [still], { allowStockToStill: false })).toHaveLength(1)
  })

  it('throws on an answer that is not JSON, for the caller to handle', () => {
    expect(() => parseShotRepair('no json here', [still], { allowStockToStill: false })).toThrow()
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/providers && npx vitest run src/prompts/shotlist.test.ts`
Expected: FAIL, `buildShotRepairRequest is not a function`.

- [ ] **Step 3: Implement**

In `packages/providers/src/prompts/shotlist.ts`, add `PlannedBriefSchema` to the value import from `@boom-busters/schemas` and `PlannedBrief` to the type import. Then insert, directly above the `// Mock mode` banner comment:

```ts
// ---------------------------------------------------------------------------
// Repair (decision 271)
// ---------------------------------------------------------------------------

export interface ShotRepairTarget {
  /** The brief as it stands, in planned or stored form. */
  brief: unknown
  /** What is wrong with it, in the words the plan screen uses. */
  problems: readonly string[]
}

/**
 * One corrective call for the briefs a chapter's craft check flagged.
 *
 * Built on the chapter's own shot-list request: the system prompt and the
 * cacheable prefix (the claim list and the book) are carried unchanged, so the
 * repair is asked under exactly the rules the plan was, and the automatic pass
 * that follows a plan is served that prefix from cache. The answer is briefs,
 * never slots, so a repair can change what a slot shows and never when.
 */
export function buildShotRepairRequest(
  base: LLMTaskRequest,
  targets: readonly ShotRepairTarget[],
  options: { allowStockToStill: boolean },
): LLMTaskRequest {
  const listing = targets
    .map(
      (target, at) =>
        `Brief ${at + 1}:\n${JSON.stringify(target.brief)}\nProblems:\n` +
        target.problems.map((problem) => `- ${problem}`).join('\n'),
    )
    .join('\n\n')
  const typeRule = options.allowStockToStill
    ? 'Keep each brief\'s "type", except that a "stock" brief whose problem names a person or a set may become a "still".'
    : 'Keep each brief\'s "type" exactly as it is.'
  return {
    ...base,
    messages: [
      ...base.messages,
      {
        role: 'user',
        content:
          'Some briefs in your plan for this chapter break the rules above. Rewrite ONLY ' +
          `these ${targets.length}, fixing every problem listed for each, and keep each ` +
          `brief's "coversText" exactly as it is.\n\n${listing}\n\n${typeRule}\n\n` +
          `Return JSON: {"briefs": [...]} holding exactly ${targets.length} brief ` +
          `object${targets.length === 1 ? '' : 's'}, one per brief above, in the same order.`,
      },
    ],
    maxTokens: outputBudget(Math.max(SHOT_LIST_FLOOR_TOKENS, targets.length * TOKENS_PER_SLOT)),
  }
}

const ShotRepairEnvelopeSchema = z.object({ briefs: z.array(z.unknown()) })

/**
 * The replacements, one per original, in order. `null` keeps the original:
 * a reply that is missing, malformed, or changes a type the caller did not
 * allow. A repair can make a brief better and can never make one vanish or
 * land on the wrong slot. `coversText` is always the original's, because the
 * board anchors a slot to its sentence by it.
 *
 * Throws on an answer that is not JSON at all; the caller decides whether
 * that keeps the plan (the automatic pass) or reports a failure (the button).
 */
export function parseShotRepair(
  text: string,
  originals: readonly { type: string; coversText: string }[],
  options: { allowStockToStill: boolean },
): (PlannedBrief | null)[] {
  const envelope = parseJsonCompletion(text, ShotRepairEnvelopeSchema, 'shot repair')
  return originals.map((original, at) => {
    const parsed = PlannedBriefSchema.safeParse(envelope.briefs[at])
    if (!parsed.success) return null
    const next = parsed.data.type
    const allowed =
      next === original.type ||
      (options.allowStockToStill && original.type === 'stock' && next === 'still')
    return allowed ? { ...parsed.data, coversText: original.coversText } : null
  })
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `cd packages/providers && npx vitest run` then `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/providers/src/prompts/shotlist.ts packages/providers/src/prompts/shotlist.test.ts
git commit -m "feat(prompts): a repair request built on the chapter's own, answered in briefs (decision 271)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: One automatic repair per chapter

**Files:**
- Modify: `apps/web/inngest/lib/direction.ts`
- Test: `apps/web/inngest/lib/direction.test.ts`

**Interfaces:**
- Consumes: `craftFindings`, `repairTargets`, `findingContext`, `FindingContext` (Task 5); `buildShotRepairRequest`, `parseShotRepair` (Task 6); `withoutBannedWords` (Task 3).
- Produces (exported from `apps/web/inngest/lib/direction.ts`), used by Task 8:
  - `chapterShotListRequest(input: { caseTitle: string; chapter: { id: string; title: string; number: number }; paragraphs: readonly TimedParagraph[]; claims: readonly ScriptClaim[]; styleAnchors: string; direction: DirectorsBook | null; photographed?: readonly string[]; sets?: readonly { name: string; look: string }[]; logos?: readonly LogoIndex[] }): ReturnType<typeof buildShotListRequest> | null`

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/inngest/lib/direction.test.ts` (top level, a plain `describe`: nothing here touches the database):

```ts
describe('planChapterSlots repairs a chapter once, on auto findings only (decision 271)', () => {
  const SENTENCE = 'Mostaque told the investors the money was there.'
  const PARAGRAPHS: TimedParagraph[] = [
    { chapterId: 'ch-1', index: 0, text: SENTENCE, startMs: 0, durationMs: 9000, words: [] },
  ]
  const still = (extra: Record<string, unknown> = {}) => ({
    type: 'still',
    coversText: SENTENCE,
    description: 'A server rack in the dark.',
    shotSize: 'close',
    prompt: 'A server rack in the dark, 50mm lens.',
    motion: { kind: 'static' },
    transition: 'cut',
    ...extra,
  })
  const stock = {
    type: 'stock',
    coversText: SENTENCE,
    description: 'An office.',
    shotSize: 'wide',
    query: 'office',
    rejectionCriteria: [],
    motion: { kind: 'static' },
    transition: 'cut',
  }
  const plan = (brief: Record<string, unknown>) =>
    JSON.stringify({ slots: [{ paragraphIndex: 0, seconds: 9, brief }] })
  const planInput = {
    projectId: FIXTURE_PROJECT_ID,
    caseTitle: 'Stability AI',
    chapter: { id: 'ch-1', title: 'The exit', number: 1 },
    paragraphs: PARAGRAPHS,
    claims: [],
    styleAnchors: 'a',
    direction: null,
    photographed: ['Emad Mostaque'],
  }

  beforeEach(() => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('makes no repair call for a clean chapter', async () => {
    callLlm.mockResolvedValueOnce({ text: plan(still({ depicts: ['Emad Mostaque'] })) })
    await planChapterSlots(planInput)
    expect(callLlm).toHaveBeenCalledTimes(1)
  })

  it('repairs a still that leaves out the photographed person its sentence names', async () => {
    callLlm.mockResolvedValueOnce({ text: plan(still()) }).mockResolvedValueOnce({
      text: JSON.stringify({
        briefs: [
          still({
            prompt: 'Emad Mostaque at the boardroom table, 35mm lens.',
            depicts: ['Emad Mostaque'],
          }),
        ],
      }),
    })

    const result = await planChapterSlots(planInput)

    expect(callLlm).toHaveBeenCalledTimes(2)
    const ask = callLlm.mock.calls[1]?.[0]?.messages?.at(-1)?.content ?? ''
    expect(ask).toContain('Emad Mostaque is named here and photographed')
    expect(result.rows[0]?.brief).toMatchObject({ depicts: ['Emad Mostaque'] })
  })

  it('leaves a stock slot naming the person to the producer: no automatic call', async () => {
    callLlm.mockResolvedValueOnce({ text: plan(stock) })
    await planChapterSlots(planInput)
    expect(callLlm).toHaveBeenCalledTimes(1)
  })

  it('keeps the original when the repair changes the slot type', async () => {
    callLlm
      .mockResolvedValueOnce({ text: plan(still()) })
      .mockResolvedValueOnce({ text: JSON.stringify({ briefs: [stock] }) })
    const result = await planChapterSlots(planInput)
    expect(result.rows[0]?.type).toBe('still')
    expect(result.rows[0]?.brief).not.toHaveProperty('depicts')
  })

  // The catch is unconditional by design: a budget refusal, a malformed answer
  // and a network error all keep the plan as planned.
  it('keeps the plan as planned when the repair call fails', async () => {
    callLlm
      .mockResolvedValueOnce({ text: plan(still()) })
      .mockRejectedValueOnce(new Error('over budget'))
    const result = await planChapterSlots(planInput)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.brief).toMatchObject({ prompt: 'A server rack in the dark, 50mm lens.' })
  })

  it('stores no banned word', async () => {
    callLlm.mockResolvedValueOnce({
      text: plan(still({ prompt: 'A cinematic boardroom, 35mm lens.', depicts: ['Emad Mostaque'] })),
    })
    const result = await planChapterSlots(planInput)
    expect(result.rows[0]?.brief).toMatchObject({ prompt: 'A boardroom, 35mm lens.' })
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/web && npx vitest run inngest/lib/direction.test.ts -t "repairs a chapter once"`
Expected: FAIL (`callLlm` called once where two calls are expected; the banned word survives).

- [ ] **Step 3: Implement**

In `apps/web/inngest/lib/direction.ts`:

(a) Imports. Add to the `@boom-busters/providers` value import: `buildShotRepairRequest, parseShotRepair, withoutBannedWords`. Add to the `@boom-busters/schemas` value import: `craftFindings, findingContext, repairTargets`. Add to the `@boom-busters/schemas` type import: `FindingContext, PlannedSlot`.

(b) Add, directly above `planChapterSlots`:

```ts
/**
 * The shot-list request for one chapter, or null when the chapter has no
 * narration to plan. Shared by planning and by the Fix button (decision 271),
 * so a repair is asked under exactly the rules and context the plan was.
 */
export function chapterShotListRequest(input: {
  caseTitle: string
  chapter: { id: string; title: string; number: number }
  paragraphs: readonly TimedParagraph[]
  claims: readonly ScriptClaim[]
  styleAnchors: string
  direction: DirectorsBook | null
  photographed?: readonly string[]
  sets?: readonly { name: string; look: string }[]
  logos?: readonly LogoIndex[]
}): ReturnType<typeof buildShotListRequest> | null {
  const paragraphs = promptParagraphs(input.paragraphs, input.chapter.id)
  if (paragraphs.length === 0) return null
  return buildShotListRequest({
    caseTitle: input.caseTitle,
    chapterTitle: input.chapter.title,
    chapterNumber: input.chapter.number,
    paragraphs,
    claims: input.claims,
    styleAnchors: input.styleAnchors,
    ...(input.direction ? { direction: input.direction } : {}),
    ...(input.photographed && input.photographed.length > 0
      ? { photographed: input.photographed }
      : {}),
    ...(input.sets && input.sets.length > 0 ? { sets: input.sets } : {}),
    logos: input.logos?.map((logo) => logo.title),
  })
}

/**
 * One automatic repair of a freshly planned chapter (decision 271).
 *
 * Only `auto` findings are sent, so a clean chapter, or one whose only
 * findings are the producer's to weigh, costs nothing. `parseShotRepair`
 * refuses any change of type here, so this can never turn a free slot into a
 * paid one unasked. Any failure, budget included, keeps the plan exactly as
 * planned: an unrepaired plan is still a valid plan, and the Fix button can
 * repair it later.
 */
async function repairPlannedChapter(input: {
  projectId: string
  request: ReturnType<typeof buildShotListRequest>
  slots: PlannedSlot[]
  chapterNumber: number
  context: FindingContext
}): Promise<PlannedSlot[]> {
  const findings = craftFindings(
    input.slots.map((slot) => ({ brief: slot.brief, chapter: `chapter ${input.chapterNumber}` })),
    input.context,
  )
  const targets = repairTargets(findings, ['auto'])
  if (targets.length === 0) return input.slots
  const originals = targets.map((target) => input.slots[target.slotIndex]!.brief)
  try {
    const answer = await callLlm(
      buildShotRepairRequest(
        input.request,
        targets.map((target, at) => ({
          brief: originals[at],
          problems: target.findings.map((finding) => finding.message),
        })),
        { allowStockToStill: false },
      ),
      { projectId: input.projectId },
    )
    const replacements = parseShotRepair(answer.text, originals, { allowStockToStill: false })
    const repaired = [...input.slots]
    targets.forEach((target, at) => {
      const brief = replacements[at]
      if (brief) {
        repaired[target.slotIndex] = {
          ...repaired[target.slotIndex]!,
          brief: withoutBannedWords(brief),
        }
      }
    })
    return repaired
  } catch (error) {
    console.warn('[visuals] chapter repair skipped; the plan is kept as planned', error)
    return input.slots
  }
}
```

(c) In `planChapterSlots`, replace the block from `let slots` through the end of the `if (mockProvidersEnabled()) { ... } else { ... }` statement with:

```ts
  let slots: PlannedSlot[]
  // Slots the model planned but that could not be used (malformed shapes,
  // charts citing claims that do not exist) are dropped and counted rather
  // than fatal: a gap on the board is repairable from a card.
  let dropped = 0
  if (mockProvidersEnabled()) {
    slots = mockShotList({
      paragraphs,
      claimCount: input.claims.length,
      claimTexts: input.claims.map((claim) => claim.text),
      logoTitles: input.logos?.map((logo) => logo.title),
      newsClaimRefs: input.claims
        .map((claim, at) => (claimCarriesArticle(claim) ? at + 1 : 0))
        .filter((ref) => ref > 0),
    }).slots
  } else {
    const request = chapterShotListRequest(input)
    if (!request) return { rows: [], rejected: 0 }
    const parsed = await planWithBudgetEscalation(request, { projectId: input.projectId })
    dropped = parsed.malformed.length
    slots = await repairPlannedChapter({
      projectId: input.projectId,
      request,
      slots: parsed.slots.map((slot) => ({ ...slot, brief: withoutBannedWords(slot.brief) })),
      chapterNumber: input.chapter.number,
      context: findingContext({
        direction: input.direction,
        // Only a photographed member can carry an auto finding, and this pass
        // acts on nothing else, so the photographed names are all it needs.
        cast: (input.photographed ?? []).map((name) => ({ name, photographed: true })),
        sets: input.sets ?? [],
      }),
    })
  }
```

Leave the `plannedToRows` conversion and the `return` after it unchanged.

- [ ] **Step 4: Run the file**

Run: `cd apps/web && npx vitest run inngest/lib/direction.test.ts`
Expected: PASS, including the existing escalation, sets and graphic tests (their plans carry no finding, so their call counts are unchanged). This file has database blocks: nothing else may be running against the test database.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm typecheck`

```bash
git add apps/web/inngest/lib/direction.ts apps/web/inngest/lib/direction.test.ts
git commit -m "feat(web): each planned chapter gets one automatic repair, on auto findings only (decision 271)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: The Fix button's job

**Files:**
- Modify: `packages/schemas/src/events.ts` (`VisualsReplanRequestedSchema.op`)
- Modify: `apps/web/inngest/lib/direction.ts` (add `rewriteStoredBriefs`)
- Modify: `apps/web/inngest/functions/visuals-replanner.ts` (the `repair` op)
- Modify: `apps/web/app/(console)/projects/[id]/visuals-actions.ts` (`repairPlanAction`)
- Test: `apps/web/inngest/functions/visuals-replanner.test.ts`

**Interfaces:**
- Consumes: `chapterShotListRequest` (Task 7); `craftFindings`, `repairTargets`, `findingContext` (Task 5); `buildShotRepairRequest`, `parseShotRepair`, `withoutBannedWords`; `updateSlotBrief`, `retypeShotSlot`, `listShotSlots` from `@boom-busters/db`; `resolvePlannedBrief`, `ShotBriefSchema` from `@boom-busters/schemas`.
- Produces:
  - `op: 'direction' | 'shots' | 'repair'` on `visuals/replan.requested`.
  - `rewriteStoredBriefs(input: { projectId: string; request: ReturnType<typeof buildShotListRequest>; targets: readonly { id: string; brief: ShotBrief; problems: readonly string[] }[]; claims: readonly ScriptClaim[]; logos: readonly LogoIndex[] }): Promise<number>`
  - `repairPlanAction(projectId: string): Promise<ActionResult>` (a server action).
  - The replanner returns `{ projectId, op, outcome: 'repaired', rewritten: number }` for `repair`.

- [ ] **Step 1: Write the failing tests**

In `apps/web/inngest/functions/visuals-replanner.test.ts`:

(a) Add to the `@boom-busters/db` import: `deleteCastMember, insertCastMember, setCastPhotos, updateSlotBrief`.

(b) Directly below the existing `vi.mock('@/lib/notify', ...)` line, add:

```ts
const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))
```

(c) Widen the helper's parameter: `function replanEvent(op: 'direction' | 'shots' | 'repair')`.

(d) Append a new block at the end of the file:

```ts
describeDb('visuals-replanner op repair (decision 271)', () => {
  const SENTENCE = 'Mostaque told the investors the money was there.'
  const still = {
    type: 'still' as const,
    coversText: SENTENCE,
    description: 'A server rack.',
    shotSize: 'close' as const,
    prompt: 'A server rack in the dark.',
    motion: { kind: 'static' as const },
    transition: 'cut' as const,
  }
  const stock = {
    type: 'stock' as const,
    coversText: 'The money was gone.',
    description: 'An empty office.',
    shotSize: 'wide' as const,
    query: 'empty office',
    rejectionCriteria: [],
    motion: { kind: 'static' as const },
    transition: 'cut' as const,
  }
  let engine: InngestTestEngine
  let memberId: string
  let stillId: string
  let stockId: string

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: visualsReplanner })
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockReset()
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
    await db.delete(shotSlots)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    const chapter = await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The exit',
      contentMd: SENTENCE,
      estRuntimeSec: 30,
    })
    const member = await insertCastMember(db, {
      projectId: FIXTURE_PROJECT_ID,
      name: 'Emad Mostaque',
      role: 'Founder',
    })
    memberId = member.id
    await setCastPhotos(db, member.id, [
      {
        r2Key: `boom-busters/cast/${FIXTURE_PROJECT_ID}/a.jpg`,
        contentHash: 'a',
        mimeType: 'image/jpeg',
        width: 1000,
        height: 1200,
        view: 'front',
      },
    ])
    await replaceShotList(db, FIXTURE_PROJECT_ID, [
      { chapterId: chapter.id, index: 0, type: 'still', brief: still, startMs: 0, durationMs: 5000 },
      { chapterId: chapter.id, index: 1, type: 'stock', brief: stock, startMs: 5000, durationMs: 5000 },
    ])
    const slots = await listShotSlots(db, FIXTURE_PROJECT_ID)
    stillId = slots[0]!.id
    stockId = slots[1]!.id
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'plan')
    await setProjectDirection(db, FIXTURE_PROJECT_ID, mockDirectorsBook({ caseTitle: 'x', chapterCount: 1 }))
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await deleteCastMember(db, memberId)
  })

  it('rewrites only the flagged slot, with the photographed person put in', async () => {
    callLlm.mockResolvedValueOnce({
      text: JSON.stringify({
        briefs: [{ ...still, prompt: 'Emad Mostaque at the boardroom table.', depicts: ['Emad Mostaque'] }],
      }),
    })

    const { result } = await engine.execute({ events: replanEvent('repair') })

    expect(result).toMatchObject({ outcome: 'repaired', rewritten: 1 })
    expect(callLlm).toHaveBeenCalledTimes(1)
    expect(callLlm.mock.calls[0]?.[0]?.messages?.at(-1)?.content).toContain(
      'Emad Mostaque is named here and photographed',
    )
    const slots = await listShotSlots(db, FIXTURE_PROJECT_ID)
    expect(slots.find((slot) => slot.id === stillId)?.brief).toMatchObject({
      depicts: ['Emad Mostaque'],
    })
    expect(slots.find((slot) => slot.id === stockId)?.brief).toMatchObject({
      description: 'An empty office.',
    })
  })

  it('may turn a stock slot naming the person into a still, since the producer pressed the button', async () => {
    await updateSlotBrief(db, stillId, { ...still, depicts: ['Emad Mostaque'] })
    await updateSlotBrief(db, stockId, { ...stock, coversText: SENTENCE })
    callLlm.mockResolvedValueOnce({
      text: JSON.stringify({
        briefs: [{ ...still, prompt: 'Emad Mostaque at the table.', depicts: ['Emad Mostaque'] }],
      }),
    })

    const { result } = await engine.execute({ events: replanEvent('repair') })

    expect(result).toMatchObject({ outcome: 'repaired', rewritten: 1 })
    const stockNow = (await listShotSlots(db, FIXTURE_PROJECT_ID)).find((slot) => slot.id === stockId)
    expect(stockNow?.type).toBe('still')
  })

  it('refuses outside the plan checkpoint', async () => {
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'board')
    const { result } = await engine.execute({ events: replanEvent('repair') })
    expect(result).toMatchObject({ outcome: 'not-in-plan' })
    expect(callLlm).not.toHaveBeenCalled()
  })

  it('makes no model call in mock mode', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    const { result } = await engine.execute({ events: replanEvent('repair') })
    expect(result).toMatchObject({ outcome: 'repaired', rewritten: 0 })
    expect(callLlm).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/web && npx vitest run inngest/functions/visuals-replanner.test.ts`
Expected: FAIL. The event schema rejects `op: 'repair'`. Nothing else may be running against the test database.

- [ ] **Step 3: Widen the event**

In `packages/schemas/src/events.ts`, change `op: z.enum(['direction', 'shots'])` in `VisualsReplanRequestedSchema` to `op: z.enum(['direction', 'shots', 'repair'])`, and extend its doc comment with: `` `repair` rewrites only the briefs the craft check flags, auto and manual findings both, for the Fix button (decision 271). ``

- [ ] **Step 4: Add `rewriteStoredBriefs`**

In `apps/web/inngest/lib/direction.ts`, add `retypeShotSlot, updateSlotBrief` to the `@boom-busters/db` import, `resolvePlannedBrief` to the `@boom-busters/schemas` value import and `ShotBrief` to its type import. Append:

```ts
/**
 * The Fix button's rewrite of stored briefs (decision 271): one call for one
 * chapter's flagged slots, `auto` and `manual` findings both, because pressing
 * the button is the producer's consent to what the automatic pass would not
 * spend on alone. A stock brief may come back as a still; nothing else may
 * change type. Each accepted replacement is stored with `updateSlotBrief`, or
 * with `retypeShotSlot` when stock became a still (the type column and the
 * brief move together, and the old candidates clear), so a slot pre-fetched
 * for its old brief owes a fetch for its new one. Returns how many briefs
 * were rewritten.
 *
 * Unlike the automatic pass this throws: the producer asked for the fix and
 * must hear when it did not happen. Mock mode makes no call and rewrites
 * nothing.
 */
export async function rewriteStoredBriefs(input: {
  projectId: string
  request: ReturnType<typeof buildShotListRequest>
  targets: readonly { id: string; brief: ShotBrief; problems: readonly string[] }[]
  claims: readonly ScriptClaim[]
  logos: readonly LogoIndex[]
}): Promise<number> {
  if (input.targets.length === 0 || mockProvidersEnabled()) return 0
  const originals = input.targets.map((target) => target.brief)
  const answer = await callLlm(
    buildShotRepairRequest(
      input.request,
      input.targets.map((target) => ({ brief: target.brief, problems: target.problems })),
      { allowStockToStill: true },
    ),
    { projectId: input.projectId },
  )
  const replacements = parseShotRepair(answer.text, originals, { allowStockToStill: true })
  let written = 0
  for (const [at, target] of input.targets.entries()) {
    const planned = replacements[at]
    if (!planned) continue
    const stored = resolvePlannedBrief(withoutBannedWords(planned), input.claims, input.logos)
    if (!stored) continue
    if (stored.type === target.brief.type) await updateSlotBrief(db, target.id, stored)
    else await retypeShotSlot(db, target.id, stored.type, stored)
    written += 1
  }
  return written
}
```

(The brief types and the slot types are the same list, so `stored.type` is a valid `ShotSlotType`.)

- [ ] **Step 5: Add the `repair` op to the replanner**

In `apps/web/inngest/functions/visuals-replanner.ts`:

(a) Imports: add `listShotSlots` to the `@boom-busters/db` import; add `craftFindings, findingContext, repairTargets, ShotBriefSchema` to the `@boom-busters/schemas` import; change the `../lib/direction` import to `import { chapterShotListRequest, draftDirectorsBook, planChapterSlots, rewriteStoredBriefs } from '../lib/direction'`.

(b) In the `load-plan-inputs` step's returned object, add beside `photographed`:

```ts
        // Every member, photographed or not (decision 271): the Fix button
        // weighs an unphotographed person as a manual finding.
        cast: cast.map((member) => ({ name: member.name, photographed: member.photos.length > 0 })),
```

(c) Directly after the `load-plan-inputs` step and before `const rows: NewShotSlot[] = []`, insert:

```ts
    // -----------------------------------------------------------------------
    // Fix the flagged slots, and nothing else (decision 271)
    // -----------------------------------------------------------------------

    if (op === 'repair') {
      const stored = await step.run('load-slots', async () =>
        (await listShotSlots(db, projectId)).map((row) => ({
          id: row.id,
          chapterId: row.chapterId,
          brief: row.brief,
        })),
      )

      // Findings over the whole film, exactly as the board computes them, so
      // the button fixes the slots the screen counted.
      const labels = new Map(
        setup.chapters.map((chapter, index) => [chapter.id, `chapter ${index + 1}`]),
      )
      const briefs = stored.flatMap((row) => {
        const parsed = ShotBriefSchema.safeParse(row.brief)
        return parsed.success ? [{ id: row.id, chapterId: row.chapterId, brief: parsed.data }] : []
      })
      const findings = craftFindings(
        briefs.map((row) => ({ brief: row.brief, chapter: labels.get(row.chapterId) })),
        findingContext({ direction: setup.direction, cast: setup.cast, sets: setup.sets }),
      )
      const targets = repairTargets(findings, ['auto', 'manual'])

      let rewritten = 0
      for (const [index, chapter] of setup.chapters.entries()) {
        const mine = targets.filter((target) => briefs[target.slotIndex]!.chapterId === chapter.id)
        if (mine.length === 0) continue
        const fixed = await step.run(`repair-${index}`, async () => {
          const request = chapterShotListRequest({
            caseTitle: setup.caseTitle,
            chapter: { id: chapter.id, title: chapter.title, number: index + 1 },
            paragraphs: setup.paragraphs,
            claims: setup.claims,
            styleAnchors: setup.styleAnchors,
            direction: setup.direction,
            photographed: setup.photographed,
            sets: setup.sets,
            logos: setup.logos,
          })
          if (!request) return { ok: true as const, written: 0 }
          try {
            const written = await rewriteStoredBriefs({
              projectId,
              request,
              targets: mine.map((target) => ({
                id: briefs[target.slotIndex]!.id,
                brief: briefs[target.slotIndex]!.brief,
                problems: target.findings.map((finding) => finding.message),
              })),
              claims: setup.claims,
              logos: setup.logos,
            })
            return { ok: true as const, written }
          } catch (error) {
            if (error instanceof BudgetExceededError) {
              return { ok: false as const, gate: budgetGateData(error) }
            }
            throw error
          }
        })
        if (!fixed.ok) {
          await step.run(`repair-${index}-over-budget`, () =>
            markSideJobFailed(ctx, 'The fix stopped', fixed.gate),
          )
          return { projectId, op, outcome: 'over-budget' as const }
        }
        rewritten += fixed.written
      }

      await step.run('repair-notify', () =>
        notify({
          kind: 'heads-up',
          title: 'Flagged slots fixed',
          body: `${rewritten} brief${rewritten === 1 ? '' : 's'} rewritten.`,
          href: `/projects/${projectId}`,
        }),
      )
      return { projectId, op, outcome: 'repaired' as const, rewritten }
    }
```

- [ ] **Step 6: Add the server action**

In `apps/web/app/(console)/projects/[id]/visuals-actions.ts`, widen `sendReplan`'s parameter to `op: 'direction' | 'shots' | 'repair'`, and add after `replanShotsAction`:

```ts
/**
 * Rewrite only the briefs the craft check flags (decision 271). Pre-fetched
 * slots among them are fetched again; every other slot is left alone.
 */
export async function repairPlanAction(projectId: string): Promise<ActionResult> {
  return sendReplan(projectId, 'repair')
}
```

- [ ] **Step 7: Run the tests and typecheck**

Run: `cd apps/web && npx vitest run inngest/functions/visuals-replanner.test.ts` then `pnpm typecheck`
Expected: PASS, including the three existing replanner tests.

- [ ] **Step 8: Commit**

```bash
git add packages/schemas/src/events.ts apps/web/inngest/lib/direction.ts apps/web/inngest/functions/visuals-replanner.ts apps/web/inngest/functions/visuals-replanner.test.ts "apps/web/app/(console)/projects/[id]/visuals-actions.ts"
git commit -m "feat(web): the Fix button's job rewrites only the flagged briefs (decision 271)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: The plan screen shows the findings and the Fix button

**Files:**
- Modify: `apps/web/lib/visuals-review.ts`
- Modify: `apps/web/app/(console)/projects/[id]/visual-board.tsx`
- Modify: `PROGRESS.md` (decision 271)
- Test: `apps/web/app/(console)/projects/[id]/visual-board.test.tsx`

**Interfaces:**
- Consumes: `craftFindings`, `findingContext`, `repairSummary`, `RepairSummary` (Task 5); `repairPlanAction` (Task 8).
- Produces: `VisualsReviewModel.repair: RepairSummary`.

- [ ] **Step 1: Write the failing board tests**

In `apps/web/app/(console)/projects/[id]/visual-board.test.tsx`:

(a) Beside `const replanShotsAction = vi.fn()`, add `const repairPlanAction = vi.fn()`. In the `vi.mock('./visuals-actions', ...)` factory, add `repairPlanAction: (...args: unknown[]) => repairPlanAction(...args),`. In the `beforeEach` that sets `approvePlanAction.mockResolvedValue({ ok: true })`, add `repairPlanAction.mockResolvedValue({ ok: true })`.

(b) In the `model(...)` helper's returned object, add `repair: { slots: 0, becomeStills: 0, chapters: 0 },` directly before `...overrides`.

(c) In the describe block that defines `planModel()`, add:

```ts
  it('offers Fix these N slots behind a confirm, naming how many become stills', async () => {
    render(
      <VisualBoard
        projectId={PROJECT}
        model={{ ...planModel(), repair: { slots: 3, becomeStills: 1, chapters: 2 } }}
        colors={COLORS}
        brand={BRAND}
      />,
    )

    await userEvent.click(
      screen.getByRole('button', { name: /Fix these 3 slots · ≈\$0\.06 · 1 becomes a still/ }),
    )
    expect(repairPlanAction).not.toHaveBeenCalled()
    expect(screen.getByText(/one call per chapter \(2\)/)).toBeInTheDocument()
    expect(screen.getByText(/1 becomes a generated still/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^Fix now$/ }))
    expect(repairPlanAction).toHaveBeenCalledWith(PROJECT)
  })

  it('shows no Fix button when nothing is flagged', () => {
    render(<VisualBoard projectId={PROJECT} model={planModel()} colors={COLORS} brand={BRAND} />)
    expect(screen.queryByRole('button', { name: /Fix these/ })).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/web && npx vitest run "app/(console)/projects/[id]/visual-board.test.tsx"`
Expected: FAIL (typecheck error on `repair`, or no Fix button found).

- [ ] **Step 3: Add the model field**

In `apps/web/lib/visuals-review.ts`:

(a) Add `craftFindings, findingContext, repairSummary` to the `@boom-busters/schemas` value import and `RepairSummary` to its type import.

(b) In `VisualsReviewModel`, after `warnings`, add:

```ts
  /**
   * What the Fix button would do (decision 271): the slots with an auto or
   * manual finding, how many of them are stock slots the fix makes into
   * generated stills, and how many chapters that spends a call on.
   */
  repair: RepairSummary
```

(c) In `emptyVisualsModel()`, add `repair: { slots: 0, becomeStills: 0, chapters: 0 },`.

(d) In `visualsReviewModel`, directly before the `return {` that builds the model, add:

```ts
  // One craft check over the whole film (decision 271), the same one the Fix
  // button runs, so the count on the button is the set of slots it rewrites.
  const findingSlots = slots.flatMap((slot) =>
    slot.brief ? [{ brief: slot.brief, chapter: `chapter ${slot.chapterIndex + 1}` }] : [],
  )
  const findings = craftFindings(
    findingSlots,
    findingContext({
      direction,
      cast: cast.map((member) => ({ name: member.name, photographed: member.photos.length > 0 })),
      sets,
    }),
  )
```

(e) In the returned object, add `repair: repairSummary(findingSlots, findings),`, and in `warnings`, directly after the `...planWarnings(...)` spread, add:

```ts
      // The people and rooms a sentence names but its shot leaves out, which
      // planWarnings has no words for (decision 271).
      ...findings
        .filter((finding) => finding.kind === 'ignored-person' || finding.kind === 'ignored-set')
        .map((finding) => `${finding.message} (slot ${finding.slotIndex})`),
```

- [ ] **Step 4: Add the button**

In `apps/web/app/(console)/projects/[id]/visual-board.tsx`:

(a) Add `repairPlanAction` to the import from `./visuals-actions`.

(b) Directly after the `REPLAN_ESTIMATE` constant, add:

```ts
/**
 * What one chapter's repair call costs (decision 271). It answers only the
 * flagged briefs under rules the chapter was already planned with, so it costs
 * less than planning the chapter did: the re-plan's ≈$0.15 across a typical
 * seven chapters is ≈$0.02 each, rounded up here because every estimate in
 * this app errs against the budget.
 */
const REPAIR_ESTIMATE_PER_CHAPTER_USD = 0.03
```

(c) In the Shot plan card's button row, between the Fetch visuals `ConfirmButton` and the Re-plan `ConfirmButton`, add:

```tsx
                {/* Beside the notes it acts on (decision 271): fix only what
                    the craft check flagged, rather than plan everything again. */}
                {model.repair.slots > 0 ? (
                  <ConfirmButton
                    variant="outline"
                    confirmVariant="primary"
                    label={
                      `Fix these ${model.repair.slots} slot${model.repair.slots === 1 ? '' : 's'} · ≈$` +
                      (REPAIR_ESTIMATE_PER_CHAPTER_USD * model.repair.chapters).toFixed(2) +
                      (model.repair.becomeStills > 0
                        ? ` · ${model.repair.becomeStills} ${
                            model.repair.becomeStills === 1 ? 'becomes a still' : 'become stills'
                          }`
                        : '')
                    }
                    confirmLabel="Fix now"
                    consequence={
                      `Rewrites only the flagged briefs, one call per chapter ` +
                      `(${model.repair.chapters}). Slots already fetched for them are fetched again.` +
                      (model.repair.becomeStills > 0
                        ? ` ${model.repair.becomeStills} ${
                            model.repair.becomeStills === 1
                              ? 'becomes a generated still'
                              : 'become generated stills'
                          }, which adds to the Fetch estimate.`
                        : '')
                    }
                    onConfirm={() =>
                      act('repair', () => repairPlanAction(projectId), 'Fixing the flagged slots')
                    }
                  />
                ) : null}
```

- [ ] **Step 5: Run the board tests and typecheck**

Run: `cd apps/web && npx vitest run "app/(console)/projects/[id]/visual-board.test.tsx"` then `pnpm typecheck`
Expected: PASS. If typecheck names another place that builds a `VisualsReviewModel`, give it `repair: { slots: 0, becomeStills: 0, chapters: 0 }`.

- [ ] **Step 6: Record decision 271**

Append to `PROGRESS.md`, after decision 270, an entry headed `271. **Contextual briefs: people and place first, and a lint that acts** (2026-09-23, owner report: "the prompt is trying to be too symbolic, or is actually showing some irrelevant to the narration ... It recognises that there are all these issues, but does nothing about it").` Its body covers, in this order, with the spec as the source:
- the measurement (55 of 62 picture briefs mention a server; 7 of 53 stills name a person) and the six causes from spec section 2;
- the prompt changes (bible, book, shot list);
- the graded findings, and why a photographed person on a still is `auto` while an unphotographed person or anyone on stock is `manual`;
- banned words stripped at three points;
- one automatic repair per chapter that never changes a slot's type, and the Fix button that may turn stock into a still and says how many first;
- the seven Rulings from this plan's header;
- _Not done._ No lint on the Director's Book itself; existing films change only after Redraft direction then Re-plan;
- _Tests._ One line per task's tests.

- [ ] **Step 7: Full verification**

Run each in turn, one at a time, nothing else running:

```bash
pnpm format && pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
```

Expected: format clean, typecheck 10 of 10, lint clean, `Tasks: 9 successful, 9 total`. If a composition pixel golden fails inside the full run, re-run `cd packages/compositions && npx vitest run` alone before believing it; never regenerate a golden from one run.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/visuals-review.ts "apps/web/app/(console)/projects/[id]/visual-board.tsx" "apps/web/app/(console)/projects/[id]/visual-board.test.tsx" PROGRESS.md
git commit -m "feat(web): the plan screen names ignored people and rooms, and offers Fix these (decision 271)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
