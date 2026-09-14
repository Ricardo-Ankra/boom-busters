# Visual Direction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the shot-list stage two layers of direction, a fixed House Visual Bible and a per-film Director's Book, so every still, stock and hero brief reads as one Netflix-register documentary, with likenesses of real people guarded, labelled and given a fallback when a model refuses.

**Architecture:** The bible is a markdown file embedded as a constant (the `script-craft.md` pattern). The book is a Zod-validated JSON document drafted once per film by a new `direction` LLM task, stored on `projects.direction`, editable on the plan screen, and rendered into the cacheable prefix of every chapter's shot-list call. A new `visuals-replanner` Inngest function applies edits (redraft the book, re-plan the slots) while the visuals-runner stays parked. Image adapters surface policy refusals as `ContentPolicyError`; a refused slot becomes a placeholder with a stored refusal and two ways out.

**Tech Stack:** TypeScript, Zod 4, Drizzle (Postgres), Inngest 4 with `@inngest/test`, Next.js App Router server actions, React 19 with Testing Library, Vitest, Playwright, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-14-visual-direction-design.md`

## Global Constraints

- Branch `visual-direction`, small commits, one logical change each; run `pnpm format:check`, `pnpm lint`, `pnpm typecheck` and `pnpm test` before every commit (CI gates on Prettier; lint-clean is not format-clean).
- No em dashes or en dashes in any file this plan creates, including the markdown bible and UI copy. Write ranges as "1995 to 2008".
- South African English spelling in prose and UI copy (colour, organisation, licence).
- `'use server'` modules export only async functions. Constants live in a sibling module.
- Every visible action is a labelled button (spec 11.1). Paid actions carry an approximate price in the label, in the board's existing style (`≈$0.08`).
- Mock-provider mode (`MOCK_PROVIDERS=1`) must exercise every new path without a network call. No real provider call is made during development.
- Every prompt module ships `build*Request`, `parse*` and `mock*` and a test file beside it.
- Attribution: rules adapted from smixs/visual-skills (CC BY 4.0, Serge Shima) are credited in the bible's footer and in PROGRESS.md.
- Decision number for PROGRESS.md: 252.

---

### Task 1: The House Visual Bible, embedded like script-craft

**Files:**
- Create: `packages/providers/src/prompts/direction-craft.md`
- Create: `packages/providers/src/prompts/direction-craft.ts`
- Create: `packages/providers/src/prompts/direction-craft.test.ts`
- Modify: `packages/providers/src/prompts/index.ts` (add `export * from './direction-craft'`)

**Interfaces:**
- Produces: `export const DIRECTION_CRAFT: string` (the markdown, byte-identical), `export const BANNED_PROMPT_WORDS: readonly string[]`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/providers/src/prompts/direction-craft.test.ts
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BANNED_PROMPT_WORDS, DIRECTION_CRAFT } from './direction-craft'

describe('DIRECTION_CRAFT', () => {
  it('is byte-identical to direction-craft.md, the human-editable source', () => {
    const markdown = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'direction-craft.md'),
      'utf8',
    )
    expect(DIRECTION_CRAFT.replace(/\r\n/g, '\n')).toBe(markdown.replace(/\r\n/g, '\n'))
  })

  it('sits below the hard rules, in its own words', () => {
    expect(DIRECTION_CRAFT).toContain('claim list does not support')
    expect(DIRECTION_CRAFT).toContain('legal hedges')
  })

  it('names the people guardrail and the banned words', () => {
    expect(DIRECTION_CRAFT).toContain('Never in an invented act')
    expect(DIRECTION_CRAFT).toContain('no caricature')
    for (const word of BANNED_PROMPT_WORDS) expect(DIRECTION_CRAFT).toContain(word)
  })

  it('never asks the renderer for a pan it cannot do', () => {
    expect(DIRECTION_CRAFT).toContain('Never plan a pan')
  })

  it('carries no dashes the house style forbids', () => {
    expect(DIRECTION_CRAFT).not.toMatch(/[\u2013\u2014]/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @boom-busters/providers test -- direction-craft`
Expected: FAIL, cannot find module './direction-craft'

- [ ] **Step 3: Write the markdown**

Write `packages/providers/src/prompts/direction-craft.md` with exactly this content (no backticks, no `${`, no dashes):

```markdown
# Direction craft: how the film looks

These rules shape the director's book and every shot brief. They sit BELOW
the hard rules: nothing here ever licenses an image the claim list does not
support, and the legal hedges are never sacrificed for a stronger picture.
A beautiful frame that implies a fact the claims do not hold is worse than a
plain one.

## The house look

- Register: the Netflix money documentary. Dark, patient, photographic
  realism. Rooms after the people have left. Documents, hands, screens,
  glass, reflections, corridors, car parks at night, empty trading floors.
- Restraint over spectacle. The story is the drama; the picture holds still
  and lets it land. One idea per frame.
- Light carries the mood, never the face. Practical sources the viewer can
  see: a desk lamp, a monitor, a window at dusk, sodium street light,
  fluorescent tubes. Name the source, its direction and its quality in
  every prompt.
- Grade and grain come from the Brand Kit anchors appended to every still
  prompt. Do not restate a grade in your own words; use the anchors.
- Era is a lock, not a flavour. Period-correct objects are named
  specifically: CRT monitors, a fax machine, a flip phone, paper ledgers.
  Never write "old fashioned"; write the object.

## Shot grammar for a film made of stills

- Shot sizes, and what each is for:
  wide (a place and the scale of what happened there),
  medium (a person in a situation, or a room's purpose),
  close (one object or gesture that carries the beat),
  macro (texture, ink, a signature, a screen pixel),
  aerial (geography, distance, the size of an estate or a city),
  graphic (charts and maps, which are their own family).
- Every slot does at least one job: changes the emotion, advances the
  story, or raises the pressure. A slot that does none is filler; cut it or
  merge its seconds into its neighbour.
- No three adjacent slots at the same size. Alternate distance the way an
  editor would: wide, close, medium, macro.
- A paragraph that cites a number wants a chart AT the number, not after
  it. Charts and maps carry facts better than another photograph.
- Stills and stock alternate; they do not cluster. Two AI stills in a row
  is the ceiling.
- Inside a paragraph the rhythm steps down towards the beat that matters:
  long, shorter, shorter, a pause, impact. The pause before the impact
  matters more than the speed before it.
- Every chapter builds to one image, named in the director's book. Plan
  the chapter so that image lands on the chapter's turn.
- Motifs recur. The director's book names three; each chapter shows at
  least one of them, in a new place.

## What a still prompt must contain

- One photographable moment. Not a montage, not a concept, not "the fall
  of a company". A room, a time of day, a light source, an object.
- Three physical facts in every prompt: an environmental pressure
  (rain on the window, a flickering tube, dust in a beam of light), a
  human trace (a coat on a chair, a half-drunk coffee, a hand on a
  document, a figure at a doorway), and one motif from the director's
  book.
- Written in this order, as prose, not a keyword list: subject, action or
  state, style anchors, context (place and era), lighting (source,
  direction, quality), technical (lens, distance, aspect). Lead with the
  subject; the first third of the prompt gets the most attention.
- Name the lens: 24mm for a wide that breathes, 35mm for a documentary
  medium, 50mm for a close human scale, 85mm for a portrait, 100mm macro
  for texture.
- Append the director's book invariants verbatim: the era lock for the
  moment, the palette line, and the identity string of any person shown.
- Banned words, because they render nothing: cinematic, stunning,
  dramatic lighting, high quality, masterpiece, epic, beautiful, moody,
  professional. Banned too: an emotion named without a body. Not "a
  worried executive"; "an executive, jaw set, both hands flat on the
  desk".
- The negative prompt names things, not categories: "no smartphone, no
  flat screen, no LED strip" for a 1990s office, never "no modern
  objects".
- No text, no logos, no watermarks in generated frames. Titles are
  rendered by the compositor, not the image model.

## Motion the renderer can do

- The compositor renders static, and Ken Burns in or out at slow, medium
  or fast. That is the whole vocabulary.
- Never plan a pan. The compiler turns "pan" into a push-in today, so a
  pan is a broken promise on the board.
- A push-in on a document or a face; a pull-out on a place, to show its
  scale after the detail. Static for charts, maps and the chapter's key
  image, so the frame is allowed to be looked at.
- Match speed to narration: slow under long sentences, medium under the
  montage staircase, never fast on a chart.

## Per-model prompt recipes

- FLUX family (dev, schnell, pro, FLUX.2, Krea): prose in the order above;
  no negative prompt exists, so write what must be there and fold the
  avoid list into a final sentence ("Avoid: ..."); hex colours beside
  colour names; lighting has the largest effect on quality.
- Imagen 3: subject, then context, then style; lens and proximity words
  ("close-up", "35mm", "wide angle"); keep under 480 tokens; person
  generation is enabled, still describe people by age range, build,
  clothing and posture, and add the identity string.
- Gemini image models: same prose as FLUX, same anchors; there is no
  negative field, so the avoid list is folded in.
- Hero video (Veo 3.1 or Kling, when the flag is on), in this shape:
  format and style; the subject with its identity string; place, era,
  time of day, weather; ONE primary action with an end state ("the
  printer runs until the last page drops, then stops"); shot size, lens
  and ONE camera move or a locked camera; light source, direction and
  quality; composition; constraints. Five to eight seconds. Name the
  final frame. No dialogue, no on-screen text.

## People

- Real people may be shown by likeness. The video carries YouTube's
  altered-content label whenever they are. Every likeness is listed in the
  brief's "depicts" field by full name.
- Depict people only in documentary-neutral situations the claims support:
  a press conference, a courtroom corridor, an office, a car, a doorway, a
  stage. Never in an invented act that implies guilt: no cash changing
  hands, no shredders, no handcuffs, no whispered deals, no scene that
  did not happen.
- No exaggeration of features, no ageing or deforming, no expression of
  malice or stupidity, no caricature, no costume that mocks. Neutral to
  sombre expression, natural posture, period-correct dress.
- The mood is carried by the environment and the light, never by the
  face. A person can stand in a dark room; the room is dark, the person is
  not made sinister.
- The director's book writes one guardrail line per principal, specific
  to what the claims establish ("shown at podiums and in corridors; never
  at a desk with documents"). Quote it in every prompt that shows them.
- Anonymous figures (depiction "anonymous") are described by role, age
  range, build and clothing, face turned away or in shadow, and never
  resemble a named person.
- When a model refuses a likeness, the fallback is a redirect: the same
  beat without the person (the empty chair, the podium after the speech,
  the door they walked through) or an anonymous figure. Keep the sentence
  the slot covers; change only what is in the frame.

## Pre-flight, before answering

- Every paragraph is covered and its slots add up to its narration.
- No three adjacent slots share a shot size.
- Every chapter shows at least one motif and builds to its key image.
- Every era lock is obeyed in every prompt it touches.
- No banned word appears in any prompt.
- Every prompt naming a real person carries their identity string and
  their guardrail line, and lists them in "depicts".
- No pan.

Shot rules adapted in part from visual-skills by Serge Shima
(github.com/smixs/visual-skills, CC BY 4.0) and DirectorSKILL (MIT).
```

- [ ] **Step 4: Write the constant module**

```ts
// packages/providers/src/prompts/direction-craft.ts
/**
 * The House Visual Bible (decision 252): the fixed layer of visual direction
 * every shot brief follows. Editable source of truth is `direction-craft.md`
 * beside this file; the constant is what ships, because a runtime file read
 * does not survive every bundler this package runs under. A unit test holds
 * the two identical (the decision 216 pattern).
 */
export const DIRECTION_CRAFT = `<paste the markdown here verbatim>`

/** Words the bible bans from prompts because they render nothing. Lower case. */
export const BANNED_PROMPT_WORDS = [
  'cinematic',
  'stunning',
  'dramatic lighting',
  'high quality',
  'masterpiece',
  'epic',
  'beautiful',
  'moody',
  'professional',
] as const
```

Paste the markdown into the template literal exactly. The markdown contains no backticks and no `${`, so no escaping is needed.

- [ ] **Step 5: Export and run the test**

Add `export * from './direction-craft'` to `packages/providers/src/prompts/index.ts`.

Run: `pnpm --filter @boom-busters/providers test -- direction-craft`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/providers/src/prompts/direction-craft.md packages/providers/src/prompts/direction-craft.ts packages/providers/src/prompts/direction-craft.test.ts packages/providers/src/prompts/index.ts
git commit -m "feat: the House Visual Bible, embedded like script-craft (decision 252)"
```

---

### Task 2: Director's Book schema, brief additions, and the plan lint

**Files:**
- Create: `packages/schemas/src/direction.ts`
- Create: `packages/schemas/src/direction.test.ts`
- Modify: `packages/schemas/src/visuals.ts:78-124` (briefCommon gains `shotSize?`; still and hero gain `depicts?`), plus a `SlotRefusalSchema`
- Modify: `packages/schemas/src/index.ts` (add `export * from './direction'`)

**Interfaces:**
- Produces: `DirectorsBookSchema`, `DirectorsBook`, `DEPICTIONS`, `SHOT_SIZES`, `ShotSizeSchema`, `SlotRefusalSchema`, `SlotRefusal`, `planWarnings(slots, bannedWords)`, `renderDirectorsBook(book)`.
- The schemas package must not import from providers, so `planWarnings` takes the banned list as an argument.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/schemas/src/direction.test.ts
import { describe, expect, it } from 'vitest'
import { DirectorsBookSchema, planWarnings, renderDirectorsBook } from './direction'
import type { ShotBrief } from './visuals'

const book = {
  visualThesis: 'A company that looked solid from the street and hollow from inside.',
  eraLocks: [{ span: '2011 to 2020', rules: 'flat screens, glass offices, smartphones' }],
  palette: { accent: '#c9a227', temperature: 'cold', note: 'gold only on money and signatures' },
  motifs: ['reflections in dark glass', 'empty chairs', 'printed pages under lamplight'],
  anchorObject: 'a bound annual report',
  neverShow: ['cash in bags', 'handcuffs'],
  principals: [
    {
      name: 'Markus Braun',
      role: 'chief executive',
      depiction: 'likeness',
      identityString: 'Markus Braun, man in his late forties, shaved head, rimless glasses, black turtleneck',
      guardrail: 'shown at podiums and in corridors; never at a desk with documents',
    },
  ],
  locations: [{ name: 'Aschheim headquarters', look: 'glass box on a business park, grey sky' }],
  chapters: [
    { chapter: 1, dominantShotFamily: 'environment', moodShift: 'confident to uneasy', keyImage: 'the empty stage after the results presentation' },
    { chapter: 2, dominantShotFamily: 'document', moodShift: 'uneasy to exposed', keyImage: 'a ledger page with a missing column' },
  ],
  finalImage: 'the headquarters at night, one floor lit',
}

describe('DirectorsBookSchema', () => {
  it('accepts a complete book', () => {
    expect(DirectorsBookSchema.safeParse(book).success).toBe(true)
  })

  it('requires exactly three motifs', () => {
    const result = DirectorsBookSchema.safeParse({ ...book, motifs: book.motifs.slice(0, 2) })
    expect(result.success).toBe(false)
  })

  it('requires a guardrail on every principal', () => {
    const principals = [{ ...book.principals[0], guardrail: '' }]
    expect(DirectorsBookSchema.safeParse({ ...book, principals }).success).toBe(false)
  })
})

describe('renderDirectorsBook', () => {
  it('writes the book as prose sections a prompt can carry', () => {
    const text = renderDirectorsBook(DirectorsBookSchema.parse(book))
    expect(text).toContain('Visual thesis:')
    expect(text).toContain('Motifs: reflections in dark glass; empty chairs; printed pages under lamplight')
    expect(text).toContain('Markus Braun (likeness)')
    expect(text).toContain('Chapter 1:')
  })
})

const still = (shotSize: 'wide' | 'close', prompt: string): ShotBrief => ({
  type: 'still',
  coversText: 'x',
  description: 'x',
  motion: { kind: 'static' },
  transition: 'cut',
  prompt,
  shotSize,
})

describe('planWarnings', () => {
  const banned = ['cinematic', 'stunning']

  it('flags three adjacent slots at one size', () => {
    const warnings = planWarnings(
      [still('wide', 'a'), still('wide', 'b'), still('wide', 'c')].map((brief) => ({ brief })),
      banned,
    )
    expect(warnings).toEqual([expect.stringContaining('three adjacent slots share the size "wide"')])
  })

  it('flags a banned word in a still prompt, once per word', () => {
    const warnings = planWarnings(
      [{ brief: still('close', 'A cinematic, stunning, cinematic corridor') }],
      banned,
    )
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain('"cinematic"')
  })

  it('is silent on a varied, clean plan', () => {
    expect(planWarnings([{ brief: still('wide', 'a') }, { brief: still('close', 'b') }], banned)).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @boom-busters/schemas test -- direction`
Expected: FAIL, cannot find module './direction'

- [ ] **Step 3: Extend the brief schemas**

In `packages/schemas/src/visuals.ts`, above `briefCommon`:

```ts
/** The shot sizes the bible names (decision 252). `graphic` is charts and maps. */
export const SHOT_SIZES = ['wide', 'medium', 'close', 'macro', 'aerial', 'graphic'] as const
export const ShotSizeSchema = z.enum(SHOT_SIZES)
export type ShotSize = z.infer<typeof ShotSizeSchema>
```

Add to `briefCommon`:

```ts
  /** Optional so rows planned before decision 252 keep parsing. */
  shotSize: ShotSizeSchema.optional(),
```

Add to `StillBriefSchema` and `HeroBriefSchema`, after `prompt`:

```ts
  /** Real people shown by likeness, full names. Drives the label and the refusal fallback. */
  depicts: z.array(z.string().min(1)).optional(),
```

After `SlotRetypeStateSchema`, add:

```ts
/**
 * An image model declined this slot's prompt (decision 252). Stored on the
 * row so the card can say so and offer the two ways out: redirect the scene
 * without the likeness, or upload a real image against the depiction brief.
 */
export const SlotRefusalSchema = z.object({
  reason: z.string().min(1),
  at: z.iso.datetime(),
})
export type SlotRefusal = z.infer<typeof SlotRefusalSchema>
```

- [ ] **Step 4: Write the direction module**

```ts
// packages/schemas/src/direction.ts
import { z } from 'zod'
import type { ShotBrief } from './visuals'

/**
 * The Director's Book (decision 252): the per-film layer of visual direction.
 * The House Visual Bible (providers/prompts/direction-craft.md) is fixed; this
 * document decides only what legitimately varies between films, and every
 * chapter's shot-list call receives it rendered as prose.
 */

export const DEPICTIONS = ['likeness', 'anonymous', 'archival-only'] as const
export const DepictionSchema = z.enum(DEPICTIONS)
export type Depiction = z.infer<typeof DepictionSchema>

export const SHOT_FAMILIES = ['environment', 'document', 'human', 'data', 'map', 'object'] as const
export const ShotFamilySchema = z.enum(SHOT_FAMILIES)

const line = z.string().trim().min(1).max(600)

export const PrincipalSchema = z.object({
  name: line,
  role: line,
  depiction: DepictionSchema,
  /** Pasted verbatim into every prompt that shows this person. */
  identityString: line,
  /** The per-person depiction rule, specific to what the claims establish. */
  guardrail: line,
})
export type Principal = z.infer<typeof PrincipalSchema>

export const ChapterDirectionSchema = z.object({
  /** 1-based position in the script, the numbering the prompt shows the model. */
  chapter: z.number().int().min(1),
  dominantShotFamily: ShotFamilySchema,
  moodShift: line,
  keyImage: line,
})

export const DirectorsBookSchema = z.object({
  visualThesis: line,
  eraLocks: z.array(z.object({ span: line, rules: line })).min(1).max(6),
  palette: z.object({
    accent: line,
    temperature: z.enum(['cold', 'neutral', 'warm']),
    note: line,
  }),
  motifs: z.array(line).length(3, 'a film has exactly three motifs'),
  anchorObject: line,
  neverShow: z.array(line).max(12),
  principals: z.array(PrincipalSchema).max(12),
  locations: z.array(z.object({ name: line, look: line })).max(12),
  chapters: z.array(ChapterDirectionSchema).min(1),
  finalImage: line,
})
export type DirectorsBook = z.infer<typeof DirectorsBookSchema>

/** The book as prose sections, for the shot-list prompt's cacheable prefix. */
export function renderDirectorsBook(book: DirectorsBook): string {
  const lines: string[] = [
    `Visual thesis: ${book.visualThesis}`,
    `Era locks: ${book.eraLocks.map((lock) => `${lock.span}: ${lock.rules}`).join(' | ')}`,
    `Palette: accent ${book.palette.accent}, ${book.palette.temperature}; ${book.palette.note}`,
    `Motifs: ${book.motifs.join('; ')}`,
    `Anchor object: ${book.anchorObject}`,
  ]
  if (book.neverShow.length > 0) lines.push(`Never show: ${book.neverShow.join('; ')}`)
  if (book.principals.length > 0) {
    lines.push('Principals:')
    for (const person of book.principals) {
      lines.push(
        `- ${person.name} (${person.depiction}), ${person.role}. Identity: ${person.identityString}. ` +
          `Guardrail: ${person.guardrail}`,
      )
    }
  }
  if (book.locations.length > 0) {
    lines.push('Locations:')
    for (const place of book.locations) lines.push(`- ${place.name}: ${place.look}`)
  }
  lines.push('Chapters:')
  for (const chapter of book.chapters) {
    lines.push(
      `- Chapter ${chapter.chapter}: ${chapter.dominantShotFamily} shots; ${chapter.moodShift}; ` +
        `key image: ${chapter.keyImage}`,
    )
  }
  lines.push(`Final image: ${book.finalImage}`)
  return lines.join('\n')
}

/**
 * Craft misses the model let through, in words for the plan summary. Never a
 * rejection: a same-size run is a note for the owner, not a broken slot.
 * Slots arrive in screen order.
 */
export function planWarnings(
  slots: readonly { brief: ShotBrief }[],
  bannedWords: readonly string[],
): string[] {
  const warnings: string[] = []

  let run = 1
  for (let index = 1; index < slots.length; index += 1) {
    const size = slots[index]!.brief.shotSize
    const previous = slots[index - 1]!.brief.shotSize
    run = size !== undefined && size === previous ? run + 1 : 1
    if (run === 3) warnings.push(`three adjacent slots share the size "${size}" (from slot ${index - 1})`)
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

  return warnings
}
```

Add `export * from './direction'` to `packages/schemas/src/index.ts`.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @boom-busters/schemas test`
Expected: PASS, including the existing visuals tests (the new fields are optional).

- [ ] **Step 6: Typecheck the workspace, then commit**

Run: `pnpm typecheck`
Expected: clean. If a fixture object literal now fails on `shotSize`, it is because a spread widened a type; fix the fixture, not the schema.

```bash
git add packages/schemas/src/direction.ts packages/schemas/src/direction.test.ts packages/schemas/src/visuals.ts packages/schemas/src/index.ts
git commit -m "feat: Director's Book schema, shot sizes, depicts and the plan lint (decision 252)"
```

---

### Task 3: The `direction` LLM task

**Files:**
- Modify: `packages/schemas/src/settings.ts:30-40` (LLM_TASKS), `:126-136` (ModelRoutingSchema), `:505-514` (DEFAULT_SETTINGS)
- Modify: `packages/db/src/settings-merge.test.ts` (add a case)
- Modify: `apps/web/app/(console)/settings/settings-form.tsx:45-52` (TASK_LABELS)

**Interfaces:**
- Produces: `LlmTask` now includes `'direction'`; `settings.modelRouting.direction` defaults to `{ provider: 'anthropic', model: 'claude-sonnet-5' }`.

- [ ] **Step 1: Write the failing test**

In `packages/db/src/settings-merge.test.ts`, add:

```ts
  it('fills the direction route for settings stored before decision 252', () => {
    const stored = structuredClone(DEFAULT_SETTINGS) as Record<string, unknown>
    delete (stored['modelRouting'] as Record<string, unknown>)['direction']
    const settings = normaliseSettings(stored)
    expect(settings.modelRouting.direction).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-5',
    })
  })
```

(Import `DEFAULT_SETTINGS` from `@boom-busters/schemas` and `normaliseSettings` from `./settings-merge` if the file does not already.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @boom-busters/db test -- settings-merge`
Expected: FAIL, `direction` is undefined / type error.

- [ ] **Step 3: Add the task**

In `packages/schemas/src/settings.ts`:

```ts
export const LLM_TASKS = [
  'research',
  'scripting',
  'editing',
  'shotlist',
  'metadata',
  'digest',
  /** The per-film Director's Book (decision 252): one call, drafting tier. */
  'direction',
] as const
```

In `ModelRoutingSchema` add `direction: ModelRefSchema,` after `shotlist`. In `DEFAULT_SETTINGS.modelRouting` add:

```ts
    // One call per film; the book is the highest-leverage prompt in the
    // picture department, so it gets the drafting tier (decision 252).
    direction: { provider: 'anthropic', model: 'claude-sonnet-5' },
```

In `settings-form.tsx` TASK_LABELS add `direction: 'Visual direction',`.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @boom-busters/db test -- settings-merge && pnpm typecheck`
Expected: PASS. The router test (`packages/providers/src/llm/router.test.ts:13`) builds a routing literal; add `direction: { provider: 'anthropic', model: 'mock-small' }` there if typecheck asks.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/settings.ts packages/db/src/settings-merge.test.ts "apps/web/app/(console)/settings/settings-form.tsx" packages/providers/src/llm/router.test.ts
git commit -m "feat: a direction LLM task, routed to Sonnet by default (decision 252)"
```

---

### Task 4: The Director's Book prompt module

**Files:**
- Create: `packages/providers/src/prompts/direction.ts`
- Create: `packages/providers/src/prompts/direction.test.ts`
- Modify: `packages/providers/src/prompts/index.ts` (add `export * from './direction'`)

**Interfaces:**
- Consumes: `DIRECTION_CRAFT` (Task 1), `DirectorsBookSchema`, `DirectorsBook` (Task 2), `claimList`, `ScriptClaim` from `./script`, `parseJsonCompletion`, `formatIssues` from `./json`, `outputBudget`, `LLMTaskRequest` from `../llm/types`.
- Produces:
  - `interface DirectionChapterInput { title: string; paragraphs: string[]; question?: string; withhold?: string }`
  - `buildDirectorsBookRequest(input: { caseTitle; centralQuestion?: string; chapters: DirectionChapterInput[]; claims: readonly ScriptClaim[]; styleAnchors: string }): LLMTaskRequest`
  - `parseDirectorsBook(text: string, chapterCount: number): DirectorsBook`
  - `mockDirectorsBook(input: { caseTitle: string; chapterCount: number }): DirectorsBook`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/providers/src/prompts/direction.test.ts
import { describe, expect, it } from 'vitest'
import { buildDirectorsBookRequest, mockDirectorsBook, parseDirectorsBook } from './direction'
import type { ScriptClaim } from './script'

const CLAIMS: ScriptClaim[] = [
  {
    id: '01HQ00000000000000000000AA',
    text: 'Markus Braun was chief executive of Wirecard from 2002 to June 2020.',
    sourceUrl: 'https://example.com/braun',
    confidence: 'sourced',
  },
]

const CHAPTERS = [
  { title: 'The glass box', paragraphs: ['A company that looked solid.'], question: 'Where was the cash?', withhold: 'The Manila trustee' },
  { title: 'The missing billions', paragraphs: ['By June, the auditors could not find the money.'] },
]

describe('buildDirectorsBookRequest', () => {
  const request = buildDirectorsBookRequest({
    caseTitle: 'Wirecard',
    centralQuestion: 'How did two billion euros never exist?',
    chapters: CHAPTERS,
    claims: CLAIMS,
    styleAnchors: 'subtle film grain; muted grade',
  })

  it('routes to the direction task', () => {
    expect(request.task).toBe('direction')
  })

  it('carries the bible in the system prompt', () => {
    expect(request.system).toContain('# Direction craft')
    expect(request.system).toContain('exactly three motifs')
  })

  it('shows the outline tension fields and numbers the chapters from 1', () => {
    const body = request.messages.map((message) => message.content).join('\n')
    expect(body).toContain('Central question: How did two billion euros never exist?')
    expect(body).toContain('Chapter 1: The glass box')
    expect(body).toContain('Withholds: The Manila trustee')
    expect(body).toContain('Chapter 2: The missing billions')
  })

  it('makes the claim list the cacheable prefix', () => {
    expect(request.cacheablePrefixMessages).toBe(1)
    expect(request.messages[0]?.content).toContain('Markus Braun was chief executive')
  })
})

describe('parseDirectorsBook', () => {
  it('parses a fenced completion and checks chapter numbers', () => {
    const book = mockDirectorsBook({ caseTitle: 'Wirecard', chapterCount: 2 })
    const parsed = parseDirectorsBook('```json\n' + JSON.stringify(book) + '\n```', 2)
    expect(parsed.motifs).toHaveLength(3)
  })

  it('refuses a book whose chapters do not match the script', () => {
    const book = mockDirectorsBook({ caseTitle: 'Wirecard', chapterCount: 2 })
    expect(() => parseDirectorsBook(JSON.stringify(book), 3)).toThrow(/chapter/)
  })
})

describe('mockDirectorsBook', () => {
  it('is deterministic, valid, and one chapter entry per chapter', () => {
    const a = mockDirectorsBook({ caseTitle: 'Wirecard', chapterCount: 3 })
    const b = mockDirectorsBook({ caseTitle: 'Wirecard', chapterCount: 3 })
    expect(a).toEqual(b)
    expect(a.chapters.map((chapter) => chapter.chapter)).toEqual([1, 2, 3])
    expect(a.principals[0]?.depiction).toBe('anonymous')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @boom-busters/providers test -- prompts/direction`
Expected: FAIL, cannot find module './direction'

- [ ] **Step 3: Write the module**

```ts
// packages/providers/src/prompts/direction.ts
import { DirectorsBookSchema, ValidationError } from '@boom-busters/schemas'
import type { DirectorsBook } from '@boom-busters/schemas'
import { z } from 'zod'
import { DIRECTION_CRAFT } from './direction-craft'
import { formatIssues, parseJsonCompletion } from './json'
import { claimList, type ScriptClaim } from './script'
import { outputBudget } from '../llm/types'
import type { LLMTaskRequest } from '../llm/types'

/**
 * The Director's Book prompt (decision 252): one call per film, after voice
 * approval and before the chapter shot lists. It reads the outline's tension
 * fields, every chapter's paragraphs and the claim list, and decides only
 * what legitimately varies between films; the House Visual Bible in the
 * system prompt holds everything that does not.
 */

export interface DirectionChapterInput {
  title: string
  paragraphs: readonly string[]
  question?: string | undefined
  withhold?: string | undefined
}

const BOOK_SHAPE = `Return JSON of this exact shape:
{
  "visualThesis": string (one or two sentences: what this film looks like and why),
  "eraLocks": [{"span": "1995 to 2008", "rules": "period-correct objects, named"}],
  "palette": {"accent": "#hex", "temperature": "cold"|"neutral"|"warm", "note": string},
  "motifs": [string, string, string] (exactly three recurring visual motifs),
  "anchorObject": string,
  "neverShow": [string] (this story's exclusions, beyond the bible's),
  "principals": [{"name", "role", "depiction": "likeness"|"anonymous"|"archival-only",
                  "identityString": string, "guardrail": string}],
  "locations": [{"name", "look"}],
  "chapters": [{"chapter": number (1-based, one entry per chapter, in order),
                "dominantShotFamily": "environment"|"document"|"human"|"data"|"map"|"object",
                "moodShift": string, "keyImage": string}],
  "finalImage": string
}`

export function buildDirectorsBookRequest(input: {
  caseTitle: string
  centralQuestion?: string | undefined
  chapters: readonly DirectionChapterInput[]
  claims: readonly ScriptClaim[]
  /** From `stillStyleAnchors`: the Brand Kit grade the palette must sit inside. */
  styleAnchors: string
}): LLMTaskRequest {
  const chapterText = input.chapters
    .map((chapter, index) => {
      const head = [`Chapter ${index + 1}: ${chapter.title}`]
      if (chapter.question) head.push(`Plants: ${chapter.question}`)
      if (chapter.withhold) head.push(`Withholds: ${chapter.withhold}`)
      return `${head.join('\n')}\n\n${chapter.paragraphs.join('\n\n')}`
    })
    .join('\n\n---\n\n')

  return {
    task: 'direction',
    system: `You are the director of a documentary about a corporate collapse, writing
the film's visual book before a single shot is planned. The narration is
recorded. Your book decides what varies for THIS film; the bible below decides
everything that does not.

${DIRECTION_CRAFT}

${BOOK_SHAPE}

Rules for the book:
- Principals are the real people the claims name. "identityString" describes
  the person as a photograph would (age range, build, hair, glasses, dress),
  never their character. "guardrail" names the only situations the claims
  support showing them in. Use "anonymous" when the person is not a public
  figure; "archival-only" when only real photographs should show them.
- Era locks name objects, not adjectives.
- The palette sits inside the Brand Kit grade: "${input.styleAnchors}".
- One chapter entry per chapter, numbered as given, in order.`,
    messages: [
      {
        role: 'user',
        content:
          `Case: ${input.caseTitle}\n` +
          (input.centralQuestion ? `Central question: ${input.centralQuestion}\n` : '') +
          `\nClaims:\n${claimList(input.claims)}`,
      },
      { role: 'user', content: chapterText },
    ],
    cacheablePrefixMessages: 1,
    maxTokens: outputBudget(3000),
  }
}

const Envelope = z.object({}).passthrough()

export function parseDirectorsBook(text: string, chapterCount: number): DirectorsBook {
  const raw = parseJsonCompletion(text, Envelope, "director's book")
  const parsed = DirectorsBookSchema.safeParse(raw)
  if (!parsed.success) {
    throw new ValidationError(`The director's book is malformed: ${formatIssues(parsed.error)}`, {
      field: "director's book",
    })
  }
  const numbers = parsed.data.chapters.map((chapter) => chapter.chapter)
  const expected = Array.from({ length: chapterCount }, (_, index) => index + 1)
  if (numbers.join(',') !== expected.join(',')) {
    throw new ValidationError(
      `The director's book covers chapters [${numbers.join(', ')}] but the script has ${chapterCount}.`,
      { field: "director's book" },
    )
  }
  return parsed.data
}

/** Deterministic book for `MOCK_PROVIDERS=1`; one anonymous principal so the guardrail UI is exercised. */
export function mockDirectorsBook(input: { caseTitle: string; chapterCount: number }): DirectorsBook {
  const families = ['environment', 'document', 'human', 'data', 'map', 'object'] as const
  return {
    visualThesis: `[mock] ${input.caseTitle}: a company that looked solid from the street and hollow from inside.`,
    eraLocks: [{ span: '2011 to 2020', rules: '[mock] flat screens, glass offices, smartphones' }],
    palette: { accent: '#c9a227', temperature: 'cold', note: '[mock] gold only on money and signatures' },
    motifs: ['[mock] reflections in dark glass', '[mock] empty chairs', '[mock] printed pages under lamplight'],
    anchorObject: '[mock] a bound annual report',
    neverShow: ['[mock] cash in bags'],
    principals: [
      {
        name: '[mock] The chief executive',
        role: 'chief executive',
        depiction: 'anonymous',
        identityString: '[mock] man in his forties, dark suit, face turned from camera',
        guardrail: '[mock] shown at podiums and in corridors; never at a desk with documents',
      },
    ],
    locations: [{ name: '[mock] Headquarters', look: '[mock] glass box on a business park, grey sky' }],
    chapters: Array.from({ length: input.chapterCount }, (_, index) => ({
      chapter: index + 1,
      dominantShotFamily: families[index % families.length]!,
      moodShift: `[mock] chapter ${index + 1} tightens`,
      keyImage: `[mock] the key image of chapter ${index + 1}`,
    })),
    finalImage: '[mock] the headquarters at night, one floor lit',
  }
}
```

Add `export * from './direction'` to the prompts barrel.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @boom-busters/providers test -- prompts/direction`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/providers/src/prompts/direction.ts packages/providers/src/prompts/direction.test.ts packages/providers/src/prompts/index.ts
git commit -m "feat: the Director's Book prompt, parse and mock (decision 252)"
```

---

### Task 5: Database columns and helpers

**Files:**
- Modify: `packages/db/src/schema.ts:242-271` (projects gains `direction`), `:553-590` (shot_slots gains `refusal`)
- Modify: `packages/db/src/projects.ts:28-100` (ProjectSummary and summaryColumns gain `direction`), add `setProjectDirection`
- Modify: `packages/db/src/visuals.ts` (add `setSlotRefusal`; `updateSlotBrief`, `retypeShotSlot` and `setSlotResolution` clear or keep it as described)
- Create: migration via drizzle-kit (`packages/db/drizzle/0021_*.sql`)
- Test: `packages/db/src/visuals.test.ts` or the nearest DB test file that uses `requireTestDatabase`

**Interfaces:**
- Produces: `ProjectSummary.direction: Record<string, unknown> | null`; `setProjectDirection(db, projectId, book: DirectorsBook | null): Promise<void>`; `setSlotRefusal(db, slotId, refusal: SlotRefusal | null): Promise<void>`; `ShotSlotRow.refusal`.

- [ ] **Step 1: Write the failing test**

In the DB visuals test file (find with `grep -l "requireTestDatabase" packages/db/src/*.test.ts | grep -i visual`), add:

```ts
  it('stores and clears a slot refusal, and a brief edit clears it', async () => {
    const [slot] = await listShotSlots(db, FIXTURE_PROJECT_ID)
    await setSlotRefusal(db, slot!.id, { reason: 'google: declined', at: new Date().toISOString() })
    expect((await getShotSlot(db, slot!.id))?.refusal).toMatchObject({ reason: 'google: declined' })
    await updateSlotBrief(db, slot!.id, ShotBriefSchema.parse(slot!.brief))
    expect((await getShotSlot(db, slot!.id))?.refusal).toBeNull()
  })

  it('stores a director’s book on the project', async () => {
    await setProjectDirection(db, FIXTURE_PROJECT_ID, mockBook)
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.direction).toMatchObject({ motifs: mockBook.motifs })
    await setProjectDirection(db, FIXTURE_PROJECT_ID, null)
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.direction).toBeNull()
  })
```

Where `mockBook` is a literal satisfying `DirectorsBook` (copy the mock from Task 4 with `chapterCount` 1; the db package must not import providers).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @boom-busters/db test -- visuals`
Expected: FAIL, `setSlotRefusal` / `setProjectDirection` not exported. (Skipped without `TEST_DATABASE_URL`; if skipped locally, rely on typecheck failing.)

- [ ] **Step 3: Schema changes**

In `projects` (after `visualsPhase`):

```ts
    /** The per-film Director's Book (decision 252), `DirectorsBookSchema`. Null until the visuals stage drafts it. */
    direction: jsonb('direction').$type<Record<string, unknown>>(),
```

In `shotSlots` (after `retype`):

```ts
    /** An image model's policy refusal for the current brief (decision 252), `SlotRefusalSchema`. */
    refusal: jsonb('refusal').$type<Record<string, unknown>>(),
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm --filter @boom-busters/db generate`
Expected: a new `packages/db/drizzle/0021_<name>.sql` adding the two nullable jsonb columns, and the journal updated. Inspect it; it must contain exactly two `ALTER TABLE ... ADD COLUMN` lines.

- [ ] **Step 5: Helpers**

In `packages/db/src/projects.ts`: add `direction: projects.direction,` to `summaryColumns`, `direction: Record<string, unknown> | null` to `ProjectSummary`, and:

```ts
export async function setProjectDirection(
  db: Database,
  id: string,
  book: DirectorsBook | null,
): Promise<void> {
  await db
    .update(projects)
    .set({ direction: book as unknown as Record<string, unknown> | null, updatedAt: new Date() })
    .where(eq(projects.id, id))
}
```

(Import `DirectorsBook` type from `@boom-busters/schemas`.)

In `packages/db/src/visuals.ts`:

```ts
/** Stamp or clear an image model's refusal (decision 252). Cleared by any brief write. */
export async function setSlotRefusal(
  db: Database,
  slotId: string,
  refusal: SlotRefusal | null,
): Promise<void> {
  await db
    .update(shotSlots)
    .set({ refusal: refusal as unknown as Record<string, unknown> | null, updatedAt: sql`now()` })
    .where(eq(shotSlots.id, slotId))
}
```

Add `refusal: null,` to the `.set({...})` of `updateSlotBrief` and `retypeShotSlot` (a new brief is a new question; the old refusal no longer applies). `setSlotResolution` leaves it alone: the resolver that hits a refusal writes both.

- [ ] **Step 6: Run tests, migrate the test DB, typecheck**

Run: `pnpm --filter @boom-busters/db migrate:test && pnpm --filter @boom-busters/db test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/projects.ts packages/db/src/visuals.ts packages/db/drizzle
git commit -m "feat: projects.direction and shot_slots.refusal, with helpers (decision 252)"
```

---

### Task 6: The shot-list prompt consumes both layers

**Files:**
- Modify: `packages/providers/src/prompts/shotlist.ts:60-165`
- Modify: `packages/providers/src/prompts/shotlist.test.ts`

**Interfaces:**
- Consumes: `DIRECTION_CRAFT` (Task 1), `renderDirectorsBook`, `DirectorsBook` (Task 2).
- Produces: `buildShotListRequest` gains `direction?: DirectorsBook` and `chapterNumber?: number` inputs. Existing callers compile unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `shotlist.test.ts`:

```ts
import { mockDirectorsBook } from './direction'

describe('buildShotListRequest with direction (decision 252)', () => {
  const direction = mockDirectorsBook({ caseTitle: 'Wirecard', chapterCount: 2 })
  const request = buildShotListRequest({
    caseTitle: 'Wirecard',
    chapterTitle: 'The Missing Billions',
    chapterNumber: 2,
    paragraphs: PARAGRAPHS,
    claims: CLAIMS,
    styleAnchors: stillStyleAnchors(brandKit),
    direction,
  })

  it('embeds the bible in the system prompt', () => {
    expect(request.system).toContain('# Direction craft')
  })

  it('puts the rendered book in the cacheable prefix beside the claims', () => {
    expect(request.cacheablePrefixMessages).toBe(1)
    expect(request.messages[0]?.content).toContain('Motifs: [mock] reflections in dark glass')
    expect(request.messages[0]?.content).toContain('Claims:')
  })

  it('tells the model which chapter entry is this one', () => {
    expect(request.messages[1]?.content).toContain('This is chapter 2 of the book')
  })

  it('asks for shotSize on every slot and depicts on likenesses', () => {
    expect(request.system).toContain('"shotSize"')
    expect(request.system).toContain('"depicts"')
  })

  it('still works with no book, for re-runs of projects planned before it', () => {
    const bare = buildShotListRequest({
      caseTitle: 'Wirecard',
      chapterTitle: 'x',
      paragraphs: PARAGRAPHS,
      claims: CLAIMS,
      styleAnchors: 'a',
    })
    expect(bare.messages[0]?.content).not.toContain('Motifs:')
  })
})
```

Also extend the existing `parseShotList` fenced-completion test's fixture with `"shotSize": "wide"` on one slot and assert it survives: `expect(slots[0]?.brief.shotSize).toBe('wide')`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @boom-busters/providers test -- shotlist`
Expected: FAIL on the new describe block.

- [ ] **Step 3: Change the prompt**

In `shotlist.ts`:

1. Import `DIRECTION_CRAFT` from `./direction-craft`, and `renderDirectorsBook` plus type `DirectorsBook` from `@boom-busters/schemas`.
2. In `SLOT_SHAPES`, change the first line to:
   `Every slot: {"paragraphIndex": number, "seconds": number, "brief": {...}}` and add after it:
   `Every brief also carries "shotSize": "wide"|"medium"|"close"|"macro"|"aerial"|"graphic" (charts and maps are "graphic").`
   Change the still shape to `{"type": "still", "coversText", "description", "shotSize", "motion", "transition", "prompt", "negativePrompt"?, "depicts"?: [full names of real people shown by likeness]}` and add a hero shape line: `- {"type": "hero", "coversText", "description", "shotSize", "motion", "transition", "prompt", "cameraMovement", "loop": boolean, "depicts"?} (only when hero is enabled)`.
   Change the motion line to: `"motion" is {"kind": "static"} or {"kind": "kenburns", "direction": "in"|"out", "speed": "slow"|"medium"|"fast"}. Never "pan".`
3. Extend the input type with `chapterNumber?: number` and `direction?: DirectorsBook`.
4. System prompt: after the opening paragraph and before `Return JSON`, insert `${DIRECTION_CRAFT}`. Replace the still bullet's wording with:
   `- "still" is an AI-GENERATED image. Write the prompt as the bible's "What a still prompt must contain" says: prose, subject first, three physical facts, lens and light named, then the book's era lock, palette and any identity string verbatim, then these Brand Kit anchors verbatim: "${input.styleAnchors}". List every real person shown by likeness in "depicts" and quote their guardrail line in the prompt. ${STILL_GENERATIONS} variants are generated per prompt.`
   Keep every other existing rule.
5. First user message becomes:

```ts
const prefix =
  `Case: ${input.caseTitle}\n\nClaims:\n${claimList(input.claims)}` +
  (input.direction ? `\n\nDirector's book:\n${renderDirectorsBook(input.direction)}` : '')
```

6. Second user message begins with `Chapter "${input.chapterTitle}":` and, when `input.chapterNumber !== undefined && input.direction`, prepends `This is chapter ${input.chapterNumber} of the book: follow its entry.\n\n`.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @boom-busters/providers test -- shotlist`
Expected: PASS. Update the existing `threads the Brand Kit style anchors` assertion if its exact wording changed.

- [ ] **Step 5: Commit**

```bash
git add packages/providers/src/prompts/shotlist.ts packages/providers/src/prompts/shotlist.test.ts
git commit -m "feat: the shot-list prompt reads the bible and the Director's Book (decision 252)"
```

---

### Task 7: Shared planning helpers and the runner's `directors-book` step

**Files:**
- Create: `apps/web/inngest/lib/direction.ts`
- Create: `apps/web/inngest/lib/direction.test.ts`
- Modify: `apps/web/inngest/functions/visuals-runner.ts:103-260`
- Create: `apps/web/inngest/functions/visuals-runner.test.ts`

**Interfaces:**
- Produces (in `apps/web/inngest/lib/direction.ts`):
  - `loadDirectionInputs(projectId): Promise<{ caseTitle; centralQuestion?; chapters: DirectionChapterInput[]; claims: ScriptClaim[]; styleAnchors }>` reads `getProject`, `getLatestScript` (for `script.outline` parsed with `OutlineSchema.safeParse` and each chapter's `contentMd` split on blank lines), `scriptableClaims`, `getSettings`.
  - `draftDirectorsBook(projectId): Promise<DirectorsBook>` mock-aware; calls `callLlm` with `buildDirectorsBookRequest`, parses with the chapter count, stores via `setProjectDirection`, returns the book.
  - `loadOrDraftDirectorsBook(projectId): Promise<DirectorsBook>` returns the stored book when `DirectorsBookSchema.safeParse(project.direction)` succeeds, otherwise drafts.
  - `planChapterSlots(input: { projectId; caseTitle; chapter: { id; title; number }; paragraphs: TimedParagraph[]; claims; claimIds; styleAnchors; direction: DirectorsBook | null }): Promise<{ rows: NewShotSlot[]; rejected: number }>` which is the body of today's `shot-list-${index}` step moved out of the runner (mock branch included). It throws `BudgetExceededError` through.
  - `planAllChapters(input: { projectId; setup: { caseTitle; chapters; paragraphs; claims; styleAnchors }; claimIds; direction })` is NOT created; the runner and the replanner both loop over chapters and call `planChapterSlots` per step so each chapter stays its own Inngest step.

- [ ] **Step 1: Write the failing unit tests for the helpers**

```ts
// apps/web/inngest/lib/direction.test.ts
// @vitest-environment node
import {
  createScriptVersion,
  FIXTURE_PROJECT_ID,
  getProject,
  requireTestDatabase,
  saveChapter,
  seed,
  setProjectDirection,
  setScriptOutline,
} from '@boom-busters/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { loadDirectionInputs, loadOrDraftDirectorsBook } from './direction'

const describeDb = requireTestDatabase() ? describe : describe.skip

describeDb('direction helpers (mock mode)', () => {
  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    await seed(db)
    await setProjectDirection(db, FIXTURE_PROJECT_ID, null)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The audit',
      contentMd: 'First paragraph.\n\nSecond paragraph.',
      estRuntimeSec: 30,
    })
    await setScriptOutline(db, script.id, {
      centralQuestion: 'Where was the money?',
      chapters: [{ title: 'The audit', beat: 'x'.repeat(30), withhold: 'The trustee', targetWords: 300 }],
    })
  })
  afterEach(() => vi.unstubAllEnvs())

  it('reads the outline tension fields and splits paragraphs', async () => {
    const inputs = await loadDirectionInputs(FIXTURE_PROJECT_ID)
    expect(inputs.centralQuestion).toBe('Where was the money?')
    expect(inputs.chapters[0]?.withhold).toBe('The trustee')
    expect(inputs.chapters[0]?.paragraphs).toEqual(['First paragraph.', 'Second paragraph.'])
  })

  it('drafts a mock book once and reuses the stored one after', async () => {
    const first = await loadOrDraftDirectorsBook(FIXTURE_PROJECT_ID)
    expect(first.chapters).toHaveLength(1)
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.direction).toMatchObject({ motifs: first.motifs })

    await setProjectDirection(db, FIXTURE_PROJECT_ID, { ...first, visualThesis: 'edited by the owner' })
    const second = await loadOrDraftDirectorsBook(FIXTURE_PROJECT_ID)
    expect(second.visualThesis).toBe('edited by the owner')
  })
})
```

Check the exact `saveChapter` and `setScriptOutline` signatures in `packages/db/src/scripts.ts:95` and `:300` and adjust the calls; the shape above follows `slot-retyper.test.ts`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test -- inngest/lib/direction`
Expected: FAIL, cannot find module './direction'

- [ ] **Step 3: Write the helper module**

```ts
// apps/web/inngest/lib/direction.ts
import {
  getLatestScript,
  getProject,
  getSettings,
  scriptableClaims,
  setProjectDirection,
} from '@boom-busters/db'
import type { NewShotSlot } from '@boom-busters/db'
import {
  buildDirectorsBookRequest,
  buildShotListRequest,
  mockDirectorsBook,
  mockProvidersEnabled,
  mockShotList,
  parseDirectorsBook,
  parseShotList,
  stillStyleAnchors,
} from '@boom-busters/providers'
import type { DirectionChapterInput, ScriptClaim } from '@boom-busters/providers'
import { DirectorsBookSchema, OutlineSchema } from '@boom-busters/schemas'
import type { DirectorsBook } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { callLlm } from '@/lib/llm'
import { plannedToRows, promptParagraphs, type TimedParagraph } from './shot-list'

/**
 * The Director's Book and per-chapter planning, shared by the visuals-runner
 * and the visuals-replanner (decision 252). Both loop over chapters and call
 * `planChapterSlots` inside their own steps, so a chapter stays the unit of
 * retry and of spend.
 */

function splitParagraphs(contentMd: string): string[] {
  return contentMd
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0 && !/^\[[^\]]+\]$/.test(block))
}

export async function loadDirectionInputs(projectId: string): Promise<{
  caseTitle: string
  centralQuestion: string | undefined
  chapters: DirectionChapterInput[]
  claims: ScriptClaim[]
  styleAnchors: string
}> {
  const project = await getProject(db, projectId)
  if (!project) throw new NonRetriableError(`Project ${projectId} no longer exists`)
  const script = await getLatestScript(db, projectId)
  if (!script || script.chapters.length === 0) {
    throw new NonRetriableError('There is no script to direct. Approve a script and voice first.')
  }
  const outline = OutlineSchema.safeParse(script.script.outline)
  const outlineChapters = outline.success ? outline.data.chapters : []

  const chapters: DirectionChapterInput[] = script.chapters.map((chapter, index) => ({
    title: chapter.title,
    paragraphs: splitParagraphs(chapter.contentMd),
    question: outlineChapters[index]?.question,
    withhold: outlineChapters[index]?.withhold,
  }))

  const claims = (await scriptableClaims(db, projectId)).map((claim) => ({
    id: claim.id,
    text: claim.text,
    sourceUrl: claim.sourceUrl,
    confidence: claim.confidence,
  }))
  const settings = await getSettings(db)

  return {
    caseTitle: project.title,
    centralQuestion: outline.success ? outline.data.centralQuestion : undefined,
    chapters,
    claims,
    styleAnchors: stillStyleAnchors(settings.brandKit),
  }
}

export async function draftDirectorsBook(projectId: string): Promise<DirectorsBook> {
  const inputs = await loadDirectionInputs(projectId)
  const book = mockProvidersEnabled()
    ? mockDirectorsBook({ caseTitle: inputs.caseTitle, chapterCount: inputs.chapters.length })
    : parseDirectorsBook(
        (await callLlm(buildDirectorsBookRequest(inputs), { projectId })).text,
        inputs.chapters.length,
      )
  await setProjectDirection(db, projectId, book)
  return book
}

/** The stored book when it parses (the owner may have edited it); a fresh draft otherwise. */
export async function loadOrDraftDirectorsBook(projectId: string): Promise<DirectorsBook> {
  const project = await getProject(db, projectId)
  const stored = DirectorsBookSchema.safeParse(project?.direction)
  if (stored.success) return stored.data
  return draftDirectorsBook(projectId)
}

export async function planChapterSlots(input: {
  projectId: string
  caseTitle: string
  chapter: { id: string; title: string; number: number }
  paragraphs: readonly TimedParagraph[]
  claims: readonly ScriptClaim[]
  claimIds: readonly string[]
  styleAnchors: string
  direction: DirectorsBook | null
}): Promise<{ rows: NewShotSlot[]; rejected: number }> {
  const paragraphs = promptParagraphs(input.paragraphs, input.chapter.id)
  if (paragraphs.length === 0) return { rows: [], rejected: 0 }

  let slots
  let dropped = 0
  if (mockProvidersEnabled()) {
    slots = mockShotList({ paragraphs, claimCount: input.claims.length }).slots
  } else {
    const parsed = parseShotList(
      (
        await callLlm(
          buildShotListRequest({
            caseTitle: input.caseTitle,
            chapterTitle: input.chapter.title,
            chapterNumber: input.chapter.number,
            paragraphs,
            claims: input.claims,
            styleAnchors: input.styleAnchors,
            ...(input.direction ? { direction: input.direction } : {}),
          }),
          { projectId: input.projectId },
        )
      ).text,
    )
    slots = parsed.slots
    dropped = parsed.malformed.length
  }

  const conversion = plannedToRows({
    chapterId: input.chapter.id,
    planned: slots,
    paragraphs: input.paragraphs,
    claimIds: input.claimIds,
  })
  return { rows: conversion.rows, rejected: dropped + conversion.rejected.length }
}
```

Note the mock shot list should also carry `shotSize` so the plan lint has something to see: in `packages/providers/src/prompts/shotlist.ts` `mockShotList`, give the stock slots `shotSize: index % 2 === 0 ? 'wide' : 'medium'` (use `.map((paragraph, index) => ...)`), the chart `shotSize: 'graphic'` and the map `shotSize: 'graphic'`.

- [ ] **Step 4: Rewire the runner**

In `visuals-runner.ts`:

1. Replace the imports of `buildShotListRequest, mockShotList, parseShotList` and `callLlm` with `import { loadOrDraftDirectorsBook, planChapterSlots } from '../lib/direction'` (keep `stillStyleAnchors`, `mockProvidersEnabled` only if still used; remove unused imports).
2. After `load-narration`, add:

```ts
    // -----------------------------------------------------------------------
    // The Director's Book (decision 252): once per film, reused when stored
    // -----------------------------------------------------------------------
    const direction = await step.run('directors-book', async () => {
      try {
        return { ok: true as const, book: await loadOrDraftDirectorsBook(projectId) }
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          return { ok: false as const, gate: budgetGateData(error) }
        }
        throw error
      }
    })
    if (!direction.ok) {
      await step.run('direction-over-budget', () => markStageFailed(ctx, direction.gate))
      return { projectId, outcome: 'over-budget' as const }
    }
```

3. Replace the body of the `shot-list-${index}` step with:

```ts
          try {
            const planned = await planChapterSlots({
              projectId,
              caseTitle: setup.caseTitle,
              chapter: { id: chapter.id, title: chapter.title, number: index + 1 },
              paragraphs: setup.paragraphs,
              claims: setup.claims,
              claimIds,
              styleAnchors: setup.styleAnchors,
              direction: direction.book,
            })
            return { ok: true, ...planned }
          } catch (error) {
            if (error instanceof BudgetExceededError) {
              return { ok: false, gate: budgetGateData(error) }
            }
            throw error
          }
```

4. In `save-shot-list`, after `replaceShotList`, compute the lint and fold it into the park summary:

```ts
    const warnings = planWarnings(
      allRows.map((row) => ({ brief: row.brief })),
      BANNED_PROMPT_WORDS,
    )
```

(import `planWarnings` from schemas and `BANNED_PROMPT_WORDS` from providers) and append to the `open-plan-park` summary: `(warnings.length > 0 ? \` · ${warnings.length} craft note${warnings.length === 1 ? '' : 's'}\` : '')`.

- [ ] **Step 5: Write the runner test**

```ts
// apps/web/inngest/functions/visuals-runner.test.ts
// @vitest-environment node
import {
  createScriptVersion,
  FIXTURE_PROJECT_ID,
  getProject,
  listShotSlots,
  requireTestDatabase,
  saveChapter,
  seed,
  setProjectDirection,
  shotSlots,
  truncateRunMirror,
} from '@boom-busters/db'
import { InngestTestEngine } from '@inngest/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { visualsRunner } from './visuals-runner'

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

const describeDb = requireTestDatabase() ? describe : describe.skip

describeDb('visuals-runner (mock mode, decision 252)', () => {
  let engine: InngestTestEngine

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: visualsRunner })
    vi.stubEnv('MOCK_PROVIDERS', '1')
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
    await db.delete(shotSlots)
    await setProjectDirection(db, FIXTURE_PROJECT_ID, null)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The audit',
      contentMd: 'By June, the auditors could not find the money.\n\nThe trail led to Manila.',
      estRuntimeSec: 30,
    })
  })
  afterEach(() => vi.unstubAllEnvs())

  it('drafts the book, plans against it, and parks on the plan', async () => {
    const { result } = await engine.execute({
      events: [{ name: 'gate/voice.approved', data: { projectId: FIXTURE_PROJECT_ID } }],
      // The park would wait 30 days; answer it with "no decision" so the run ends.
      steps: [{ id: 'await-plan-approval', handler: () => null }],
    })
    expect(result).toMatchObject({ outcome: 'plan-timeout' })

    const project = await getProject(db, FIXTURE_PROJECT_ID)
    expect(project?.direction).toMatchObject({ motifs: expect.any(Array) })
    const slots = await listShotSlots(db, FIXTURE_PROJECT_ID)
    expect(slots.length).toBeGreaterThan(0)
    expect(slots.some((slot) => (slot.brief as { shotSize?: string }).shotSize)).toBe(true)
  })
})
```

If the `gate/voice.approved` event schema needs more fields, copy them from `packages/schemas/src/events.ts` (`GateApprovedSchema` or similar). If `@inngest/test` names the step-mock option differently in the installed version, read `node_modules/@inngest/test/README.md` and adjust; the intent is fixed: mock `await-plan-approval` to resolve `null`.

- [ ] **Step 6: Run everything for the web app**

Run: `pnpm --filter web test -- inngest && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/inngest/lib/direction.ts apps/web/inngest/lib/direction.test.ts apps/web/inngest/functions/visuals-runner.ts apps/web/inngest/functions/visuals-runner.test.ts packages/providers/src/prompts/shotlist.ts
git commit -m "feat: the visuals runner drafts the Director's Book and plans every chapter against it (decision 252)"
```

---

### Task 8: The replanner and its actions

**Files:**
- Modify: `packages/schemas/src/events.ts` (add `VisualsReplanRequestedSchema`, register `'visuals/replan.requested'`)
- Modify: `apps/web/inngest/events.ts` (add `visualsReplanRequested`)
- Create: `apps/web/inngest/functions/visuals-replanner.ts`
- Create: `apps/web/inngest/functions/visuals-replanner.test.ts`
- Modify: `apps/web/inngest/functions/index.ts` (register and export), `apps/web/inngest/functions/index.test.ts` (singleton map)
- Modify: `apps/web/app/(console)/projects/[id]/visuals-actions.ts` (add `saveDirectionAction`, `redraftDirectionAction`, `replanShotsAction`)

**Interfaces:**
- Event: `visuals/replan.requested { projectId: Ulid; op: 'direction' | 'shots' }`.
- Actions: `saveDirectionAction(projectId: string, book: unknown): Promise<ActionResult>` validates with `DirectorsBookSchema`; `redraftDirectionAction(projectId)`, `replanShotsAction(projectId)` send the event; all three require `project.visualsPhase === 'plan'`.

- [ ] **Step 1: Write the failing replanner test**

```ts
// apps/web/inngest/functions/visuals-replanner.test.ts
// @vitest-environment node
import {
  createScriptVersion,
  FIXTURE_PROJECT_ID,
  getProject,
  listShotSlots,
  replaceShotList,
  requireTestDatabase,
  saveChapter,
  seed,
  setProjectDirection,
  setVisualsPhase,
  shotSlots,
  truncateRunMirror,
} from '@boom-busters/db'
import { mockDirectorsBook } from '@boom-busters/providers'
import { InngestTestEngine } from '@inngest/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { visualsReplanner } from './visuals-replanner'

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))
const describeDb = requireTestDatabase() ? describe : describe.skip

describeDb('visuals-replanner (mock mode)', () => {
  let engine: InngestTestEngine
  let chapterId = ''

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: visualsReplanner })
    vi.stubEnv('MOCK_PROVIDERS', '1')
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
    await db.delete(shotSlots)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    const chapter = await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The audit',
      contentMd: 'By June, the auditors could not find the money.',
      estRuntimeSec: 30,
    })
    chapterId = chapter.id
    await replaceShotList(db, FIXTURE_PROJECT_ID, [
      {
        chapterId,
        index: 0,
        type: 'stock',
        brief: {
          type: 'stock',
          coversText: 'old',
          description: 'old plan',
          motion: { kind: 'static' },
          transition: 'cut',
          query: 'old',
          rejectionCriteria: [],
        },
        startMs: 0,
        durationMs: 5000,
      },
    ])
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'plan')
    await setProjectDirection(db, FIXTURE_PROJECT_ID, {
      ...mockDirectorsBook({ caseTitle: 'x', chapterCount: 1 }),
      visualThesis: 'owner edit',
    })
  })
  afterEach(() => vi.unstubAllEnvs())

  it('op shots replaces the slots and keeps the owner’s book', async () => {
    const { result } = await engine.execute({
      events: [{ name: 'visuals/replan.requested', data: { projectId: FIXTURE_PROJECT_ID, op: 'shots' } }],
    })
    expect(result).toMatchObject({ outcome: 'replanned' })
    const slots = await listShotSlots(db, FIXTURE_PROJECT_ID)
    expect(slots.every((slot) => slot.brief.description !== 'old plan')).toBe(true)
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.direction).toMatchObject({ visualThesis: 'owner edit' })
  })

  it('op direction replaces the book and leaves the slots alone', async () => {
    const { result } = await engine.execute({
      events: [{ name: 'visuals/replan.requested', data: { projectId: FIXTURE_PROJECT_ID, op: 'direction' } }],
    })
    expect(result).toMatchObject({ outcome: 'redrafted' })
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.direction).not.toMatchObject({ visualThesis: 'owner edit' })
    expect((await listShotSlots(db, FIXTURE_PROJECT_ID))[0]?.brief.description).toBe('old plan')
  })

  it('refuses outside the plan checkpoint', async () => {
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'board')
    const { result } = await engine.execute({
      events: [{ name: 'visuals/replan.requested', data: { projectId: FIXTURE_PROJECT_ID, op: 'shots' } }],
    })
    expect(result).toMatchObject({ outcome: 'not-in-plan' })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test -- visuals-replanner`
Expected: FAIL, module not found.

- [ ] **Step 3: Event schema**

In `packages/schemas/src/events.ts`, after `VisualsRetypeRequestedSchema`:

```ts
/**
 * Re-apply direction during the plan checkpoint (decision 252): `direction`
 * redrafts the Director's Book, `shots` regenerates every chapter's slots
 * from the stored book. Handled by the visuals-replanner while the runner
 * stays parked on `visuals/plan.approved`.
 */
export const VisualsReplanRequestedSchema = z.object({
  ...projectRef,
  op: z.enum(['direction', 'shots']),
})
```

Register `'visuals/replan.requested': VisualsReplanRequestedSchema,` in the event map beside `'visuals/retype.requested'`. In `apps/web/inngest/events.ts` add `visualsReplanRequested: eventType('visuals/replan.requested', { schema: VisualsReplanRequestedSchema }),` and the import.

- [ ] **Step 4: The function**

```ts
// apps/web/inngest/functions/visuals-replanner.ts
import {
  getProject,
  getSettings,
  latestScriptParagraphSources,
  listVoiceTakes,
  replaceShotList,
  scriptableClaims,
  setProjectDirection,
} from '@boom-busters/db'
import type { NewShotSlot } from '@boom-busters/db'
import { BANNED_PROMPT_WORDS, stillStyleAnchors } from '@boom-busters/providers'
import type { ScriptClaim } from '@boom-busters/providers'
import {
  BudgetExceededError,
  DirectorsBookSchema,
  parseEventData,
  planWarnings,
  serialiseError,
} from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { notify } from '@/lib/notify'
import { inngest } from '../client'
import { events } from '../events'
import { budgetGateData, markSideJobFailed, type GateContext } from '../lib/gates'
import { draftDirectorsBook, planChapterSlots } from '../lib/direction'
import { timedParagraphs } from '../lib/shot-list'

/**
 * visuals-replanner (decision 252). The plan screen's two model-backed
 * buttons: Redraft direction (replaces the book; the owner's edits go) and
 * Re-plan shot list (replaces every slot from the stored book; anything
 * pre-fetched during plan review is discarded). Both run only while the
 * project sits at the plan checkpoint, and the parked visuals-runner is
 * untouched: it re-reads the slots when the plan is approved.
 */

const FUNCTION_ID = 'visuals-replanner'

export const visualsReplanner = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Visual re-plan',
    retries: 2,
    singleton: { key: 'event.data.projectId', mode: 'skip' },
    cancelOn: [{ event: 'project/cancelled', if: 'async.data.projectId == event.data.projectId' }],
    onFailure: async ({ event }) => {
      const projectId = event.data.event.data['projectId']
      if (typeof projectId !== 'string') return
      await markSideJobFailed(
        { inngestRunId: '', functionId: FUNCTION_ID, projectId },
        'The re-plan failed',
        serialiseError(event.data.error),
      )
    },
    triggers: [events.visualsReplanRequested],
  },
  async ({ event, step, runId }) => {
    const { projectId, op } = parseEventData('visuals/replan.requested', event.data)
    const ctx: GateContext = { inngestRunId: runId, functionId: FUNCTION_ID, projectId }

    const inPlan = await step.run('check-phase', async () => {
      const project = await getProject(db, projectId)
      if (!project) throw new NonRetriableError(`Project ${projectId} no longer exists`)
      return project.visualsPhase === 'plan'
    })
    if (!inPlan) return { projectId, op, outcome: 'not-in-plan' as const }

    if (op === 'direction') {
      const drafted = await step.run('redraft-book', async () => {
        try {
          await draftDirectorsBook(projectId)
          return { ok: true as const }
        } catch (error) {
          if (error instanceof BudgetExceededError) return { ok: false as const, gate: budgetGateData(error) }
          throw error
        }
      })
      if (!drafted.ok) {
        await step.run('redraft-over-budget', () => markSideJobFailed(ctx, 'The redraft stopped', drafted.gate))
        return { projectId, op, outcome: 'over-budget' as const }
      }
      return { projectId, op, outcome: 'redrafted' as const }
    }

    const setup = await step.run('load-plan-inputs', async () => {
      const project = await getProject(db, projectId)
      if (!project) throw new NonRetriableError(`Project ${projectId} no longer exists`)
      const book = DirectorsBookSchema.safeParse(project.direction)
      const sources = await latestScriptParagraphSources(db, projectId)
      const takes = await listVoiceTakes(db, projectId)
      const claims = await scriptableClaims(db, projectId)
      const settings = await getSettings(db)
      return {
        caseTitle: project.title,
        direction: book.success ? book.data : null,
        chapters: sources.chapters.map((chapter) => ({ id: chapter.id, title: chapter.title })),
        paragraphs: timedParagraphs({ chapters: sources.chapters, takes }),
        claims: claims.map((claim) => ({
          id: claim.id,
          text: claim.text,
          sourceUrl: claim.sourceUrl,
          confidence: claim.confidence,
        })) satisfies ScriptClaim[],
        styleAnchors: stillStyleAnchors(settings.brandKit),
      }
    })
    const claimIds = setup.claims.map((claim) => claim.id)

    const rows: NewShotSlot[] = []
    let rejected = 0
    for (const [index, chapter] of setup.chapters.entries()) {
      const planned = await step.run(`replan-${index}`, async () => {
        try {
          const result = await planChapterSlots({
            projectId,
            caseTitle: setup.caseTitle,
            chapter: { id: chapter.id, title: chapter.title, number: index + 1 },
            paragraphs: setup.paragraphs,
            claims: setup.claims,
            claimIds,
            styleAnchors: setup.styleAnchors,
            direction: setup.direction,
          })
          return { ok: true as const, ...result }
        } catch (error) {
          if (error instanceof BudgetExceededError) return { ok: false as const, gate: budgetGateData(error) }
          throw error
        }
      })
      if (!planned.ok) {
        await step.run(`replan-${index}-over-budget`, () => markSideJobFailed(ctx, 'The re-plan stopped', planned.gate))
        return { projectId, op, outcome: 'over-budget' as const }
      }
      rows.push(...planned.rows)
      rejected += planned.rejected
    }

    if (rows.length === 0) {
      await step.run('replan-empty', () =>
        markSideJobFailed(ctx, 'The re-plan produced no slots', { message: 'The shot-list model produced no usable slots; the old plan was kept.' }),
      )
      return { projectId, op, outcome: 'empty' as const }
    }

    await step.run('replace-plan', async () => {
      await replaceShotList(db, projectId, rows)
      const warnings = planWarnings(rows.map((row) => ({ brief: row.brief })), BANNED_PROMPT_WORDS)
      await notify({
        kind: 'heads-up',
        title: 'Shot plan re-planned',
        body:
          `${rows.length} slots planned from the saved direction` +
          (rejected > 0 ? `, ${rejected} dropped as malformed` : '') +
          (warnings.length > 0 ? `, ${warnings.length} craft notes` : '') +
          '.',
        href: `/projects/${projectId}`,
      })
    })

    return { projectId, op, outcome: 'replanned' as const, slots: rows.length }
  },
)
```

Register in `functions/index.ts` (import, the `functions` array after `slotRetyper`, and the named export block). In `functions/index.test.ts`, add `'visuals-replanner': 'event.data.projectId'` to the singleton map the test pins.

- [ ] **Step 5: Actions**

In `visuals-actions.ts` add (imports: `DirectorsBookSchema`, `setProjectDirection` from db):

```ts
/** Save the owner's edited Director's Book (decision 252). Free; used by the next re-plan. */
export async function saveDirectionAction(projectId: string, book: unknown): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(projectId)
  if (invalid) return invalid
  const project = await getProject(db, projectId)
  if (!project) return { ok: false, error: 'This project no longer exists.' }
  if (project.visualsPhase !== 'plan') {
    return { ok: false, error: 'Direction is edited at the plan checkpoint only.' }
  }
  const parsed = DirectorsBookSchema.safeParse(book)
  if (!parsed.success) {
    return { ok: false, error: `That direction does not validate: ${parsed.error.issues[0]?.message ?? 'unknown'}` }
  }
  await setProjectDirection(db, projectId, parsed.data)
  refresh(projectId)
  return { ok: true }
}

export async function redraftDirectionAction(projectId: string): Promise<ActionResult> {
  return sendReplan(projectId, 'direction')
}

export async function replanShotsAction(projectId: string): Promise<ActionResult> {
  return sendReplan(projectId, 'shots')
}

async function sendReplan(projectId: string, op: 'direction' | 'shots'): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(projectId)
  if (invalid) return invalid
  const project = await getProject(db, projectId)
  if (!project) return { ok: false, error: 'This project no longer exists.' }
  if (project.visualsPhase !== 'plan') {
    return { ok: false, error: 'The plan checkpoint is not open on this project.' }
  }
  try {
    await inngest.send(events.visualsReplanRequested.create({ projectId, op }))
  } catch (error) {
    console.error('[visuals] could not send replan', error)
    return {
      ok: false,
      error:
        'Could not reach Inngest. Start the dev server with `npx inngest-cli@latest dev`, or check INNGEST_EVENT_KEY.',
    }
  }
  refresh(projectId)
  return { ok: true }
}
```

- [ ] **Step 6: Run tests, typecheck, lint**

Run: `pnpm --filter web test -- inngest && pnpm typecheck && pnpm lint`
Expected: PASS, including `index.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add packages/schemas/src/events.ts apps/web/inngest/events.ts apps/web/inngest/functions/visuals-replanner.ts apps/web/inngest/functions/visuals-replanner.test.ts apps/web/inngest/functions/index.ts apps/web/inngest/functions/index.test.ts "apps/web/app/(console)/projects/[id]/visuals-actions.ts"
git commit -m "feat: visuals-replanner redrafts the book or re-plans the slots at the plan checkpoint (decision 252)"
```

---

### Task 9: The Direction section on the plan screen

**Files:**
- Modify: `apps/web/lib/visuals-review.ts:80-112, 136-230` (model gains `direction: DirectorsBook | null` and `warnings: string[]`)
- Create: `apps/web/app/(console)/projects/[id]/direction-card.tsx`
- Create: `apps/web/app/(console)/projects/[id]/direction-card.test.tsx`
- Modify: `apps/web/app/(console)/projects/[id]/visual-board.tsx:202-240` (render `<DirectionCard>` above the Shot plan card in plan phase; show warnings under the plan copy)
- Modify: `apps/web/app/(console)/projects/[id]/visual-board.test.tsx` (mock the three new actions; model fixtures gain `direction: null, warnings: []`)
- Modify: `e2e/tests/visual-plan.spec.ts` (one test)

**Interfaces:**
- Consumes: `saveDirectionAction`, `redraftDirectionAction`, `replanShotsAction` (Task 8).
- Produces: `DirectionCard({ projectId, direction, slotsFetched, act })`.

- [ ] **Step 1: Extend the model**

In `visuals-review.ts`: add to `VisualsReviewModel`:

```ts
  /** The Director's Book (decision 252), null before the visuals stage drafts one. */
  direction: DirectorsBook | null
  /** Craft notes from `planWarnings`, in screen order. */
  warnings: string[]
```

`emptyVisualsModel()` returns `direction: null, warnings: []`. In `visualsReviewModel`, also `getProject(db, projectId)` in the initial `Promise.all`, then:

```ts
  const directionParsed = DirectorsBookSchema.safeParse(project?.direction)
  ...
    direction: directionParsed.success ? directionParsed.data : null,
    warnings: planWarnings(
      slots.flatMap((slot) => (slot.brief ? [{ brief: slot.brief }] : [])),
      BANNED_PROMPT_WORDS,
    ),
```

(`BANNED_PROMPT_WORDS` from `@boom-busters/providers`; `visuals-review.ts` already imports from providers via `visual-assets`.)

- [ ] **Step 2: Write the failing component test**

```tsx
// apps/web/app/(console)/projects/[id]/direction-card.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDirectorsBook } from '@boom-busters/providers'
import { DirectionCard } from './direction-card'

const saveDirectionAction = vi.fn()
const redraftDirectionAction = vi.fn()
const replanShotsAction = vi.fn()
vi.mock('./visuals-actions', () => ({
  saveDirectionAction: (...args: unknown[]) => saveDirectionAction(...args),
  redraftDirectionAction: (...args: unknown[]) => redraftDirectionAction(...args),
  replanShotsAction: (...args: unknown[]) => replanShotsAction(...args),
}))

const PROJECT = '01J0000000000000000000000A'
const book = mockDirectorsBook({ caseTitle: 'Wirecard', chapterCount: 2 })
const act = vi.fn(async (_key: string, run: () => Promise<unknown>) => {
  await run()
})

beforeEach(() => {
  vi.clearAllMocks()
  saveDirectionAction.mockResolvedValue({ ok: true })
  redraftDirectionAction.mockResolvedValue({ ok: true })
  replanShotsAction.mockResolvedValue({ ok: true })
})

describe('DirectionCard', () => {
  it('shows the book’s fields as labelled text areas and saves edits', async () => {
    render(<DirectionCard projectId={PROJECT} direction={book} slotsFetched={0} act={act} />)
    const thesis = screen.getByLabelText('Visual thesis')
    await userEvent.clear(thesis)
    await userEvent.type(thesis, 'A hollow tower.')
    await userEvent.click(screen.getByRole('button', { name: 'Save direction' }))
    expect(saveDirectionAction).toHaveBeenCalledWith(
      PROJECT,
      expect.objectContaining({ visualThesis: 'A hollow tower.', motifs: book.motifs }),
    )
  })

  it('offers a priced redraft and a priced re-plan that name what is lost', async () => {
    render(<DirectionCard projectId={PROJECT} direction={book} slotsFetched={3} act={act} />)
    await userEvent.click(screen.getByRole('button', { name: /Redraft direction · ≈\$0\.05/ }))
    expect(screen.getByText(/Your edits to the book are replaced/)).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: /Re-plan shot list · ≈\$0\.15/ }))
    expect(screen.getByText(/3 slots already fetched are discarded/)).toBeVisible()
  })

  it('with no book yet, offers only the redraft', () => {
    render(<DirectionCard projectId={PROJECT} direction={null} slotsFetched={0} act={act} />)
    expect(screen.getByText(/No direction has been written for this film yet/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Save direction' })).toBeNull()
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter web test -- direction-card`
Expected: FAIL, module not found.

- [ ] **Step 4: Write the card**

```tsx
// apps/web/app/(console)/projects/[id]/direction-card.tsx
'use client'

import * as React from 'react'
import type { DirectorsBook } from '@boom-busters/schemas'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmButton } from '@/components/confirm-button'
import { redraftDirectionAction, replanShotsAction, saveDirectionAction, type ActionResult } from './visuals-actions'

/**
 * The Director's Book on the plan screen (decision 252). Text areas for the
 * prose fields, one item per line for the lists, one row per principal. Save
 * is free and feeds the next re-plan; Redraft and Re-plan are the two paid
 * buttons, each confirming what it throws away.
 */

const REDRAFT_ESTIMATE = '≈$0.05'
const REPLAN_ESTIMATE = '≈$0.15'

type Act = (key: string, run: () => Promise<ActionResult>, success: string) => Promise<void>

const lines = (items: readonly string[]) => items.join('\n')
const unlines = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean)

export function DirectionCard({
  projectId,
  direction,
  slotsFetched,
  act,
}: {
  projectId: string
  direction: DirectorsBook | null
  /** Slots already resolved during plan review; a re-plan discards them. */
  slotsFetched: number
  act: Act
}) {
  const [draft, setDraft] = React.useState<DirectorsBook | null>(direction)
  React.useEffect(() => setDraft(direction), [direction])

  const patch = (change: Partial<DirectorsBook>) =>
    setDraft((current) => (current ? { ...current, ...change } : current))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[14px]">Direction</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {draft ? (
          <>
            <Field label="Visual thesis" value={draft.visualThesis} onChange={(v) => patch({ visualThesis: v })} />
            <Field
              label="Era locks (one per line, span: rules)"
              value={lines(draft.eraLocks.map((lock) => `${lock.span}: ${lock.rules}`))}
              onChange={(v) =>
                patch({
                  eraLocks: unlines(v).map((line) => {
                    const [span, ...rest] = line.split(':')
                    return { span: (span ?? '').trim(), rules: rest.join(':').trim() }
                  }),
                })
              }
            />
            <Field
              label="Palette note"
              value={`${draft.palette.accent}; ${draft.palette.temperature}; ${draft.palette.note}`}
              onChange={(v) => {
                const [accent, temperature, ...note] = v.split(';').map((part) => part.trim())
                const temp = temperature === 'cold' || temperature === 'warm' ? temperature : 'neutral'
                patch({ palette: { accent: accent ?? '', temperature: temp, note: note.join('; ') } })
              }}
            />
            <Field label="Motifs (three, one per line)" value={lines(draft.motifs)} onChange={(v) => patch({ motifs: unlines(v) })} />
            <Field label="Anchor object" value={draft.anchorObject} onChange={(v) => patch({ anchorObject: v })} />
            <Field label="Never show (one per line)" value={lines(draft.neverShow)} onChange={(v) => patch({ neverShow: unlines(v) })} />
            <Field
              label="Principals (one per line: name | role | likeness or anonymous or archival-only | identity | guardrail)"
              value={lines(
                draft.principals.map((p) => `${p.name} | ${p.role} | ${p.depiction} | ${p.identityString} | ${p.guardrail}`),
              )}
              onChange={(v) =>
                patch({
                  principals: unlines(v).map((line) => {
                    const [name = '', role = '', depiction = 'anonymous', identityString = '', guardrail = ''] = line
                      .split('|')
                      .map((part) => part.trim())
                    const kind =
                      depiction === 'likeness' || depiction === 'archival-only' ? depiction : 'anonymous'
                    return { name, role, depiction: kind, identityString, guardrail }
                  }),
                })
              }
            />
            <Field
              label="Chapters (one per line: family | mood shift | key image)"
              value={lines(draft.chapters.map((c) => `${c.dominantShotFamily} | ${c.moodShift} | ${c.keyImage}`))}
              onChange={(v) =>
                patch({
                  chapters: unlines(v).map((line, index) => {
                    const [family = 'environment', moodShift = '', keyImage = ''] = line.split('|').map((p) => p.trim())
                    const families = ['environment', 'document', 'human', 'data', 'map', 'object'] as const
                    const dominantShotFamily = (families as readonly string[]).includes(family)
                      ? (family as (typeof families)[number])
                      : 'environment'
                    return { chapter: index + 1, dominantShotFamily, moodShift, keyImage }
                  }),
                })
              }
            />
            <Field label="Final image" value={draft.finalImage} onChange={(v) => patch({ finalImage: v })} />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                onClick={() => act('direction-save', () => saveDirectionAction(projectId, draft), 'Direction saved')}
              >
                Save direction
              </Button>
              <ConfirmButton
                variant="outline"
                label={`Redraft direction · ${REDRAFT_ESTIMATE}`}
                confirmLabel="Redraft now"
                consequence="One model call rewrites the whole book. Your edits to the book are replaced."
                onConfirm={() => act('direction-redraft', () => redraftDirectionAction(projectId), 'Redrafting the direction')}
              />
              <ConfirmButton
                variant="outline"
                label={`Re-plan shot list · ${REPLAN_ESTIMATE}`}
                confirmLabel="Re-plan now"
                consequence={
                  `Every chapter is planned again from the saved direction.` +
                  (slotsFetched > 0 ? ` ${slotsFetched} slots already fetched are discarded.` : '')
                }
                onConfirm={() => act('direction-replan', () => replanShotsAction(projectId), 'Re-planning the shot list')}
              />
            </div>
          </>
        ) : (
          <>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              No direction has been written for this film yet. Redraft it to give every chapter one look.
            </p>
            <ConfirmButton
              variant="primary"
              label={`Redraft direction · ${REDRAFT_ESTIMATE}`}
              confirmLabel="Draft now"
              consequence="One model call writes the Director's Book from the approved script."
              onConfirm={() => act('direction-redraft', () => redraftDirectionAction(projectId), 'Drafting the direction')}
            />
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = React.useId()
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[12px] text-[var(--color-text-muted)]">
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        rows={Math.min(6, Math.max(2, value.split('\n').length))}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-[8px] border border-[var(--color-border)] bg-transparent p-2 text-[13px] text-[var(--color-text-primary)]"
      />
    </div>
  )
}
```

Check `ConfirmButton`'s actual props in `apps/web/components/confirm-button.tsx` (`label`, `confirmLabel`, `consequence`, `onConfirm`, `variant`, `confirmVariant`) and match them.

- [ ] **Step 5: Mount it and show the warnings**

In `visual-board.tsx`, inside `model.phase === 'plan' ? (...)`, wrap the existing Shot plan `<Card>` in a fragment and render `<DirectionCard projectId={projectId} direction={model.direction} slotsFetched={model.coverage.resolved} act={act} />` above it. Under the plan copy paragraph add:

```tsx
            {model.warnings.length > 0 ? (
              <ul className="list-disc pl-5 text-[12px] text-[var(--color-warning)]" aria-label="Craft notes">
                {model.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
```

`act` in the board has the signature `(slotId: string, run, success)`; pass it through unchanged (the first argument is a busy key).

Update `visual-board.test.tsx`: add the three actions to the `vi.mock('./visuals-actions', ...)` factory, and add `direction: null, warnings: []` to every `VisualsReviewModel` fixture (search for `phase:` in the file).

- [ ] **Step 6: e2e**

Append to `e2e/tests/visual-plan.spec.ts`:

```ts
  test('the Direction card sits above the plan and offers a priced redraft', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Direction' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Redraft direction · ≈\$0\.05/ })).toBeVisible()
  })
```

- [ ] **Step 7: Run tests**

Run: `pnpm --filter web test -- "projects" && pnpm typecheck && pnpm lint`
Expected: PASS. Run `pnpm e2e -- visual-plan` if the local e2e environment is set up; otherwise note it for CI.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/visuals-review.ts "apps/web/app/(console)/projects/[id]/direction-card.tsx" "apps/web/app/(console)/projects/[id]/direction-card.test.tsx" "apps/web/app/(console)/projects/[id]/visual-board.tsx" "apps/web/app/(console)/projects/[id]/visual-board.test.tsx" e2e/tests/visual-plan.spec.ts
git commit -m "feat: the Director's Book is edited on the plan screen, with craft notes (decision 252)"
```

---

### Task 10: Refusals become placeholders with two ways out

**Files:**
- Modify: `packages/providers/src/visuals/gemini.ts:44-75, 110-119` (empty or image-less response throws `ContentPolicyError`)
- Modify: `packages/providers/src/visuals/gemini.test.ts` (one case)
- Modify: `apps/web/inngest/functions/visuals-runner.ts` resolve catch, and `apps/web/inngest/functions/slot-refetcher.ts` resolve catch (write the refusal)
- Create: `packages/providers/src/prompts/redirect.ts` and `redirect.test.ts`
- Modify: `packages/schemas/src/events.ts`, `apps/web/inngest/events.ts` (`visuals/redirect.requested { projectId, slotId }`)
- Create: `apps/web/inngest/functions/slot-redirector.ts` and `.test.ts`; register in `functions/index.ts` and `index.test.ts`
- Modify: `apps/web/lib/visuals-review.ts` (`SlotView.refusal: SlotRefusal | null`)
- Modify: `apps/web/app/(console)/projects/[id]/visuals-actions.ts` (`redirectSceneAction`)
- Modify: `apps/web/app/(console)/projects/[id]/visual-board.tsx:470-500` (the refused card), `visual-board.test.tsx`

**Interfaces:**
- `buildRedirectRequest(input: { caseTitle; brief: StillBrief; reason: string; direction: DirectorsBook | null }): LLMTaskRequest` (task `shotlist`), `parseRedirectedBrief(text): StillBrief` (same `coversText`, `depicts` absent), `mockRedirectedBrief(brief): StillBrief`.
- Event `visuals/redirect.requested { projectId, slotId }`; function `slot-redirector`, singleton on `event.data.slotId`.
- Action `redirectSceneAction(projectId, slotId)`.

- [ ] **Step 1: Failing adapter test**

In `gemini.test.ts` add a case where the response body is `{ "candidates": [{ "content": { "parts": [{ "text": "I can't help with that." }] } }] }` and assert `await expect(generate(...)).rejects.toBeInstanceOf(ContentPolicyError)`; and a second with `{ "promptFeedback": { "blockReason": "SAFETY" }, "candidates": [] }` asserting the same. Follow the existing test's `fetchImpl` stubbing.

- [ ] **Step 2: Adapter change**

In `gemini.ts`: make `candidates` `.optional()` (drop `.min(1)`), add `promptFeedback: z.object({ blockReason: z.string().optional() }).optional()` to `ResponseSchema`, and replace the `if (!image)` throw with:

```ts
      if (!image) {
        // A 200 with no image part is the model answering in prose, or a
        // blocked prompt: a policy refusal either way, and a human's problem
        // (decision 252), never a retry.
        const reason = parsed.promptFeedback?.blockReason ?? 'returned no image for this prompt'
        throw new ContentPolicyError('google', `${reason} (model ${model.id})`)
      }
```

Run `pnpm --filter @boom-busters/providers test -- gemini`: PASS.

- [ ] **Step 3: Store the refusal at both resolvers**

In `visuals-runner.ts`'s `resolve-${slot.id}` catch, before the generic placeholder write:

```ts
              if (error instanceof ContentPolicyError) {
                await setSlotResolution(db, slot.id, { candidates: [], status: 'placeholder' })
                await setSlotRefusal(db, slot.id, { reason: error.message, at: new Date().toISOString() })
                return { ok: false, error: error.message }
              }
```

Do the same in `slot-refetcher.ts` where it catches resolution errors (read the file; mirror the shape). Import `ContentPolicyError` from schemas and `setSlotRefusal` from db.

- [ ] **Step 4: The redirect prompt module (test first)**

```ts
// packages/providers/src/prompts/redirect.test.ts
import { describe, expect, it } from 'vitest'
import { buildRedirectRequest, mockRedirectedBrief, parseRedirectedBrief } from './redirect'
import type { StillBrief } from '@boom-busters/schemas'

const brief: StillBrief = {
  type: 'still',
  coversText: 'Braun took the stage.',
  description: 'The chief executive at the results presentation.',
  motion: { kind: 'static' },
  transition: 'cut',
  prompt: 'Markus Braun at a podium ...',
  depicts: ['Markus Braun'],
  shotSize: 'medium',
}

describe('buildRedirectRequest', () => {
  const request = buildRedirectRequest({ caseTitle: 'Wirecard', brief, reason: 'google: SAFETY', direction: null })
  it('asks for the same beat without the likeness', () => {
    expect(request.task).toBe('shotlist')
    expect(request.system).toContain('without the person')
    expect(request.messages.at(-1)?.content).toContain('google: SAFETY')
  })
})

describe('parseRedirectedBrief', () => {
  it('keeps coversText and strips depicts', () => {
    const redirected = mockRedirectedBrief(brief)
    const parsed = parseRedirectedBrief(JSON.stringify({ brief: redirected }), brief)
    expect(parsed.coversText).toBe(brief.coversText)
    expect(parsed.depicts).toBeUndefined()
  })
  it('refuses a redirect that still names the person', () => {
    const bad = { ...mockRedirectedBrief(brief), depicts: ['Markus Braun'] }
    expect(() => parseRedirectedBrief(JSON.stringify({ brief: bad }), brief)).toThrow(/still depicts/)
  })
})
```

Module:

```ts
// packages/providers/src/prompts/redirect.ts
import { renderDirectorsBook, StillBriefSchema, ValidationError } from '@boom-busters/schemas'
import type { DirectorsBook, StillBrief } from '@boom-busters/schemas'
import { z } from 'zod'
import { DIRECTION_CRAFT } from './direction-craft'
import { formatIssues, parseJsonCompletion } from './json'
import { outputBudget } from '../llm/types'
import type { LLMTaskRequest } from '../llm/types'

/**
 * Redirect a refused still (decision 252): the image model declined a
 * likeness, so the same beat is re-planned without the person, following
 * the bible's People section. `coversText` never changes; only the frame.
 */
export function buildRedirectRequest(input: {
  caseTitle: string
  brief: StillBrief
  reason: string
  direction: DirectorsBook | null
}): LLMTaskRequest {
  return {
    task: 'shotlist',
    system: `You are re-planning ONE still of a documentary. The image model refused the
current prompt. Rewrite the brief for the same story beat without the person:
the empty chair, the podium after the speech, the door they walked through, or
an anonymous figure described by role, build and clothing with the face turned
away. Keep "coversText" EXACTLY as given; keep "motion", "transition" and
"shotSize"; rewrite "description" and "prompt"; omit "depicts" entirely.

${DIRECTION_CRAFT}

Return JSON: {"brief": {"type": "still", "coversText", "description", "shotSize", "motion", "transition", "prompt", "negativePrompt"?}}`,
    messages: [
      {
        role: 'user',
        content:
          `Case: ${input.caseTitle}` +
          (input.direction ? `\n\nDirector's book:\n${renderDirectorsBook(input.direction)}` : ''),
      },
      {
        role: 'user',
        content: `Refusal: ${input.reason}\n\nThe current brief:\n${JSON.stringify(input.brief, null, 2)}`,
      },
    ],
    cacheablePrefixMessages: 1,
    maxTokens: outputBudget(1200),
  }
}

const Envelope = z.object({ brief: z.unknown() })

export function parseRedirectedBrief(text: string, original: StillBrief): StillBrief {
  const envelope = parseJsonCompletion(text, Envelope, 'redirected brief')
  const parsed = StillBriefSchema.safeParse(envelope.brief)
  if (!parsed.success) {
    throw new ValidationError(`The redirected brief is malformed: ${formatIssues(parsed.error)}`, {
      field: 'redirected brief',
    })
  }
  if (parsed.data.depicts && parsed.data.depicts.length > 0) {
    throw new ValidationError('The redirected brief still depicts a real person.', { field: 'redirected brief' })
  }
  if (parsed.data.coversText !== original.coversText) {
    throw new ValidationError('The redirected brief changed the sentence it covers.', { field: 'redirected brief' })
  }
  return parsed.data
}

export function mockRedirectedBrief(brief: StillBrief): StillBrief {
  const { depicts: _depicts, ...rest } = brief
  return {
    ...rest,
    description: `[mock] ${brief.description} Redirected: the place after the person has left.`,
    prompt: `[mock] An empty podium under a single spotlight, a glass of water half drunk, dust in the beam. ${brief.prompt}`,
  }
}
```

Export from the prompts barrel. Run the test: PASS.

- [ ] **Step 5: Event, function, action, model**

Event schema `VisualsRedirectRequestedSchema = z.object({ ...projectRef, slotId: UlidSchema })`, name `'visuals/redirect.requested'`, registered in both event files.

`slot-redirector.ts` mirrors `slot-retyper.ts`: singleton on `event.data.slotId`; step `redirect-brief` loads the slot, parses `StillBriefSchema` (throw `NonRetriableError` if not a still), loads the book via `DirectorsBookSchema.safeParse((await getProject(db, projectId))?.direction)`, produces `next` via `mockRedirectedBrief` in mock mode or `parseRedirectedBrief(await callLlm(buildRedirectRequest(...)))` otherwise, catches `BudgetExceededError` (mark side job failed, return `over-budget`) and `ValidationError` (write `setSlotRefusal` with `reason: 'Redirect refused: ' + error.message`, return `refused`), then `updateSlotBrief(db, slotId, next)` (which clears the refusal), and if `project.visualsPhase === 'board'` resolves it exactly as the retyper's `resolve-retyped` step does, writing a refusal again on `ContentPolicyError`. Returns `{ outcome: 'redirected' }`.

Test `slot-redirector.test.ts`: seed a still slot with `depicts: ['X']` and a refusal, phase `plan`, execute, assert `brief.depicts` is undefined, `refusal` is null, `status` is `unresolved`, and a mock-prefixed description.

Register in `functions/index.ts` and add `'slot-redirector': 'event.data.slotId'` to `index.test.ts`.

Action in `visuals-actions.ts`:

```ts
export async function redirectSceneAction(projectId: string, slotId: string): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(projectId, slotId)
  if (invalid) return invalid
  const slot = await getShotSlot(db, slotId)
  if (!slot) return { ok: false, error: 'This slot no longer exists.' }
  if ((slot.brief as { type?: string } | null)?.type !== 'still') {
    return { ok: false, error: 'Only an AI image slot can be redirected.' }
  }
  try {
    await inngest.send(events.visualsRedirectRequested.create({ projectId, slotId }))
  } catch (error) {
    console.error('[visuals] could not send redirect', error)
    return { ok: false, error: 'Could not reach Inngest to redirect this scene. Check INNGEST_EVENT_KEY.' }
  }
  refresh(projectId)
  return { ok: true }
}
```

`SlotView` gains `refusal: SlotRefusal | null` parsed with `SlotRefusalSchema.safeParse(row.refusal)`.

- [ ] **Step 6: The refused card**

In `visual-board.tsx` `SlotCard`, replace the generic placeholder paragraph condition so a refusal renders first:

```tsx
        {slot.refusal && brief?.type === 'still' ? (
          <div className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-warning)] p-3">
            <p className="text-[13px] text-[var(--color-warning)]">
              The image model declined this person: {slot.refusal.reason}
            </p>
            <p className="text-[12px] text-[var(--color-text-secondary)]">
              Redirect the scene to the same beat without the likeness, or upload a real image. It should show:{' '}
              {brief.description}
              {brief.depicts?.length ? ` Showing ${brief.depicts.join(', ')}.` : ''}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => act(slot.id, () => redirectSceneAction(projectId, slot.id), 'Redirecting the scene')}
              >
                Redirect the scene · ≈$0.02
              </Button>
              <UploadOwnButton projectId={projectId} slotId={slot.id} act={act} archival={false} />
            </div>
          </div>
        ) : null}
```

And guard the existing "Nothing usable was found" paragraph with `&& !slot.refusal`. Add `redirectSceneAction` to the board's imports and to the test's mock factory; add `refusal: null` to every `SlotView` fixture; add one component test rendering a slot with `refusal: { reason: 'google: SAFETY', at: '2026-09-14T00:00:00.000Z' }` and asserting both buttons are visible and clicking Redirect calls the action.

- [ ] **Step 7: Run everything**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/providers/src/visuals/gemini.ts packages/providers/src/visuals/gemini.test.ts packages/providers/src/prompts/redirect.ts packages/providers/src/prompts/redirect.test.ts packages/providers/src/prompts/index.ts packages/schemas/src/events.ts apps/web/inngest/events.ts apps/web/inngest/functions/slot-redirector.ts apps/web/inngest/functions/slot-redirector.test.ts apps/web/inngest/functions/index.ts apps/web/inngest/functions/index.test.ts apps/web/inngest/functions/visuals-runner.ts apps/web/inngest/functions/slot-refetcher.ts apps/web/lib/visuals-review.ts "apps/web/app/(console)/projects/[id]/visuals-actions.ts" "apps/web/app/(console)/projects/[id]/visual-board.tsx" "apps/web/app/(console)/projects/[id]/visual-board.test.tsx"
git commit -m "feat: a refused likeness becomes a placeholder with Redirect the scene and Upload a real image (decision 252)"
```

---

### Task 11: The altered-content label

**Files:**
- Modify: `packages/schemas/src/broker.ts:177-188` (`containsSyntheticMedia: z.boolean().optional()` on the upload job)
- Modify: `infra/lambdas/media-utils/handler.ts:222-228` (status gains `containsSyntheticMedia` when true); `infra/lambdas/media-utils/commands.test.ts` or handler test if one exists
- Modify: `apps/web/lib/publish-review.ts` (`PublishItemModel.syntheticLikenesses: string[]`)
- Modify: `apps/web/inngest/functions/publish-runner.ts:318-335` (preflight computes it; `submitMediaJob` passes it)
- Modify: `apps/web/app/(console)/projects/[id]/publish-screen.tsx:243` area (the line)
- Test: `apps/web/inngest/functions/publish-runner.test.ts`, `apps/web/lib/publish-review.test.ts` (or nearest)

**Interfaces:**
- New pure helper in `apps/web/lib/publish-review.ts`: `syntheticLikenesses(slots: readonly { brief: unknown; candidates: unknown }[]): string[]` returns the distinct `depicts` names of still or hero slots whose chosen candidate is a generated one (provider `fal` or `google`).

- [ ] **Step 1: Failing helper test**

```ts
it('lists the people shown by a generated, chosen still', () => {
  const slots = [
    {
      brief: { type: 'still', coversText: 'x', description: 'x', motion: { kind: 'static' }, transition: 'cut', prompt: 'p', depicts: ['Markus Braun'] },
      candidates: [{ id: 'g1', provider: 'google', kind: 'image', sourceUrl: 'generated://x', licence: 'Generated', chosen: true }],
    },
    {
      brief: { type: 'still', coversText: 'y', description: 'y', motion: { kind: 'static' }, transition: 'cut', prompt: 'p', depicts: ['Jan Marsalek'] },
      candidates: [{ id: 'u1', provider: 'upload', kind: 'image', sourceUrl: 'r2://x', licence: 'Own', chosen: true }],
    },
  ]
  expect(syntheticLikenesses(slots)).toEqual(['Markus Braun'])
})
```

- [ ] **Step 2: Implement**

```ts
export function syntheticLikenesses(slots: readonly { brief: unknown; candidates: unknown }[]): string[] {
  const names = new Set<string>()
  for (const slot of slots) {
    const brief = ShotBriefSchema.safeParse(slot.brief)
    if (!brief.success || (brief.data.type !== 'still' && brief.data.type !== 'hero')) continue
    const depicts = brief.data.depicts ?? []
    if (depicts.length === 0) continue
    const chosen = z.array(SlotCandidateSchema).safeParse(slot.candidates).data?.find((c) => c.chosen)
    if (chosen && (chosen.provider === 'fal' || chosen.provider === 'google')) {
      for (const name of depicts) names.add(name)
    }
  }
  return [...names]
}
```

In `publishModel`, read `listShotSlots(db, projectId)` in the first `Promise.all` and set `syntheticLikenesses: syntheticLikenesses(slots)` on the master item (Shorts inherit the master's list; set the same array on each Short item, since Shorts are cut from the master's visuals).

In `publish-runner.ts` preflight: `const likenesses = syntheticLikenesses(await listShotSlots(db, projectId))` (import from `@/lib/publish-review`), return `containsSyntheticMedia: likenesses.length > 0`, and pass `...(preflight.containsSyntheticMedia ? { containsSyntheticMedia: true } : {})` into `submitMediaJob`.

Lambda: `status: { privacyStatus, selfDeclaredMadeForKids: false, ...(job.containsSyntheticMedia ? { containsSyntheticMedia: true } : {}), ...publishAt }`.

Publish screen, under the not-ready line:

```tsx
                {item.syntheticLikenesses.length > 0 ? (
                  <p className="text-[12px] text-[var(--color-text-secondary)]">
                    AI likenesses of real people ({item.syntheticLikenesses.join(', ')}): the altered-content label is set on upload.
                  </p>
                ) : null}
```

Add `syntheticLikenesses: []` to publish-screen test fixtures.

- [ ] **Step 3: Tests, typecheck, and the Lambda build**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm --filter infra test` (or the infra package's test script). Expected: PASS.

The Lambda is not redeployed by this plan; add to the PR notes (Task 13) that `containsSyntheticMedia` reaches YouTube only after the next media-utils deploy, and that until then the on-screen line is the reminder to tick the box in Studio.

- [ ] **Step 4: Commit**

```bash
git add packages/schemas/src/broker.ts infra/lambdas/media-utils/handler.ts apps/web/lib/publish-review.ts apps/web/lib/publish-review.test.ts apps/web/inngest/functions/publish-runner.ts apps/web/inngest/functions/publish-runner.test.ts "apps/web/app/(console)/projects/[id]/publish-screen.tsx" "apps/web/app/(console)/projects/[id]/publish-screen.test.tsx"
git commit -m "feat: generated likenesses set YouTube's altered-content label and say so on the Publish screen (decision 252)"
```

---

### Task 12: Teaser stills carry the house anchors and a vertical clause

**Files:**
- Create: `packages/providers/src/prompts/teaser-still.ts` and `.test.ts` (export `teaserStillPrompt(prompt: string, styleAnchors: string): string`)
- Modify: `apps/web/inngest/functions/teaser-shot-fetcher.ts:160-170` (wrap `data.prompt` with the helper; read `stillStyleAnchors((await getSettings(db)).brandKit)`)
- Test: `apps/web/inngest/functions/teaser-shot-fetcher.test.ts` (assert the generated candidate's summary contains "9:16")

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from 'vitest'
import { teaserStillPrompt } from './teaser-still'

describe('teaserStillPrompt', () => {
  it('appends the vertical framing clause and the anchors once', () => {
    const prompt = teaserStillPrompt('An empty podium under one light.', 'subtle film grain; muted grade')
    expect(prompt).toContain('An empty podium under one light.')
    expect(prompt).toContain('Vertical 9:16 frame')
    expect(prompt).toContain('subtle film grain; muted grade')
    expect(teaserStillPrompt(prompt, 'subtle film grain; muted grade')).toBe(prompt)
  })
})
```

- [ ] **Step 2: Implement**

```ts
// packages/providers/src/prompts/teaser-still.ts
const VERTICAL_CLAUSE =
  'Vertical 9:16 frame: subject in the centre third, headroom above for the hook text, ' +
  'nothing important in the bottom quarter where captions sit.'

/** The teaser studio's still prompt, with the house anchors and vertical framing appended once (decision 252). */
export function teaserStillPrompt(prompt: string, styleAnchors: string): string {
  const trimmed = prompt.trim()
  if (trimmed.includes(VERTICAL_CLAUSE)) return trimmed
  return `${trimmed} ${VERTICAL_CLAUSE} ${styleAnchors}`.trim()
}
```

Export from the barrel; wire it in the fetcher (`prompt: teaserStillPrompt(data.prompt, anchors)`, keep `description: data.prompt`). Extend the fetcher test to assert the stored still candidate's `summary` contains `9:16`.

- [ ] **Step 3: Run, commit**

Run: `pnpm test -- teaser && pnpm typecheck && pnpm lint`

```bash
git add packages/providers/src/prompts/teaser-still.ts packages/providers/src/prompts/teaser-still.test.ts packages/providers/src/prompts/index.ts apps/web/inngest/functions/teaser-shot-fetcher.ts apps/web/inngest/functions/teaser-shot-fetcher.test.ts
git commit -m "feat: teaser stills carry the house anchors and a 9:16 framing clause (decision 252)"
```

---

### Task 13: Docs, spec amendment, full verification

**Files:**
- Modify: `docs/03-build-spec.md:185` (visuals-runner line gains a dated amendment)
- Modify: `PROGRESS.md` (decision 252 under the current section; attribution note)
- Modify: `.env.example` only if a variable was added (none expected)

- [ ] **Step 1: Amend the build spec**

Append to the visuals-runner bullet at `docs/03-build-spec.md:185`:

`*(Amended 2026-09-14, decision 252: a `directors-book` step drafts the per-film Director's Book (LLM task `direction`, Sonnet) once and stores it on `projects.direction`; every chapter's shot-list call carries the House Visual Bible (`direction-craft.md`) in its system prompt and the rendered book in its cacheable prefix. A `visuals-replanner` redrafts the book or re-plans the slots at the plan checkpoint. Image-model policy refusals become `placeholder` slots with a stored `refusal` and two repairs: Redirect the scene (`slot-redirector`) or Upload a real image. Stills that depict real people by likeness set `containsSyntheticMedia` on the YouTube upload.)*`

- [ ] **Step 2: PROGRESS.md decision entry**

Add decision 252 after 251, in the file's voice: what was wrong (eight independently imagined chapters), the two layers, the people rule as the owner decided it and the guardrail, the refusal fallback, the label, the replanner, the teaser clause, and the attribution line: "Shot rules adapted in part from visual-skills by Serge Shima (github.com/smixs/visual-skills, CC BY 4.0) and DirectorSKILL (MIT)." Note the Lambda redeploy as outstanding.

- [ ] **Step 3: Full verification**

Run, in order, and paste the tail of each into the commit message body if anything is skipped:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm e2e -- visual-plan
```

Expected: all green. If `pnpm e2e` cannot run locally, say so in the final report rather than claiming it passed.

- [ ] **Step 4: Commit**

```bash
git add docs/03-build-spec.md PROGRESS.md
git commit -m "docs: decision 252, visual direction (bible, Director's Book, guardrail, refusal fallback)"
```

- [ ] **Step 5: Report**

Report which tests ran, which were skipped (test DB present or not, e2e present or not), and the two follow-ups: deploy media-utils for the label to reach YouTube, and run one real film through the new stage with `MOCK_PROVIDERS` off to read the first real Director's Book.
