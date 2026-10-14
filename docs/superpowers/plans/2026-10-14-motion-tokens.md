# Motion Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every graphic the designer writes takes its durations, curves and spring presets from one house token object, carried inside the stored design, with Remotion's own timing and sequencing rules in the prompt and a scan that refuses any curve or spring that is not a token.

**Architecture:** A Remotion-free token module in `packages/compositions` holds the numbers once and renders them as `MOTION_PREAMBLE`, JavaScript text that declares a frozen `motion` constant. `graphicCodeIssue` prepends the preamble to the compiled code before the dry run and stores the result, so the board, the Player, Lambda and the dry run all run the same text and the sandbox contract (`React`, `Remotion`, `props`) does not change. The scan, on the model's compiled code before the preamble is added, refuses `Easing` in any form, an `interpolate` without `easing: motion.ease.<name>` written inside the call, a `Remotion.spring` without `config: motion.spring.<name>`, bracket access to the sandbox, and any `motion` binding or assignment of the design's own. The prompt lists the tokens, states the house motion rules, and carries pinned excerpts of Remotion's `timing.md` and `sequencing.md`.

**Tech Stack:** TypeScript, Zod 4, Vitest, esbuild (`compileGraphicSource`), Remotion 4.0.512 (`Easing`, `spring`), pnpm workspaces, Prettier.

**Spec:** `docs/superpowers/specs/2026-10-14-motion-tokens-design.md` (decision 301)

**Branch:** `motion-tokens`, from `master`.

## Global Constraints

- Decision number 301; checked against `origin/master` at the merge (296 to 300 are taken). The spec and this plan say 301; renumber all of your own lines if the number has moved.
- Token values, verbatim from the spec: `ms` micro 120, enter 450, exit 300, reveal 550, draw 700, count 1000, move 900, gap 120; `ease` enter `Easing.out(Easing.poly(4))`, exit `Easing.in(Easing.cubic)`, move `Easing.inOut(Easing.cubic)`, emphasis `Easing.out(Easing.exp)`, linear `Easing.linear`; `spring` settle `{ damping: 200 }`, hero `{ damping: 14, stiffness: 120 }`, snap `{ damping: 20, stiffness: 200 }`; `px.rise` 20; `scale.enter` 0.96; `stagger` 75 ms per item, capped at 600 ms; `order` `['frame', 'title', 'body', 'hero', 'note']`; `frames(ms, fps)` is `Math.max(1, Math.round((ms * fps) / 1000))`.
- `packages/compositions/src/lib/motion-tokens.ts` imports nothing from `remotion` at run time (a `type` import only): `apps/web/lib/graphic-code/check.ts` runs inside the Inngest route, which is bundled with the `react-server` condition and cannot import `remotion` statically. Never make `remotion` a `serverExternalPackages` entry.
- The sandbox contract does not change: no new name in `GraphicScope`, no new argument. No Remotion deploy, no broker deploy, no migration (`motion` lives in the brief's JSON column).
- The scan reads the model's compiled code BEFORE the preamble is prepended. The preamble itself uses `Remotion.Easing`, which the scan refuses in a design.
- Every refusal message is one sentence, lower-case start, as the existing ones are; the model reads it on the retry.
- Copy rules for prompt text, refusal messages, comments and PROGRESS: South African spelling (colour, organise), no em or en dashes (the prompt test asserts none), no "delve", "leverage", "robust" or similar.
- Run `pnpm exec prettier --check <files>` on every file you touch before each commit, and `pnpm --filter <package> typecheck` for each package touched; CI gates on both.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- `pnpm db:migrate` is never run locally. The test DB needs Docker Desktop running for `apps/web` suites that touch the database; the graphic-code suites do not.
- Composition goldens flake under the full monorepo `pnpm test`: re-run `pnpm --filter @boom-busters/compositions test` alone before believing a pixel-diff failure, and never regenerate goldens from a flaky run.

## Review Focus

1. **An `interpolate` whose options object is a variable** (`const opts = { easing: motion.ease.enter }; interpolate(f, a, b, opts)`) is refused, since the scan reads the call text; the prompt must say the easing is written inside the call, and the refusal must name which call. Test in Task 3 (`refuses an easing that is not a token, or passed through a variable`) and the prompt sentence in Task 5.
2. **A design stored before this change** has no preamble and uses `Remotion.Easing`; it must keep rendering on the board and on Lambda, and parse without a `motion` field. Tests in Task 2 (schema accepts a design without `motion`) and the unchanged `buildGraphic` tests, which run a compiled string with no preamble.
3. **A design that declares its own `motion`** would be a duplicate declaration against the preamble's `const motion` and crash the sandbox function at parse time with a message about redeclaration, not about tokens. The scan refuses it first with a sentence that says what to do. Test in Task 3 (`refuses %s: the token object is the house's`).
4. **A design that mutates a token without assigning to it** (`Object.assign(motion.ms, { enter: 1 })`) passes the scan and must be refused by the dry run's crash report under strict mode. Test in Task 2 (`refuses a design that changes a token, by the dry run's crash report`).
5. **The two forms of the tokens drifting apart**: a number changed in the typed object but not the preamble, or a curve changed in one. The numbers are written once and the preamble text is built from them; the curves are compared by sampling. Test in Task 1 (`declares the same five curves, sampled at ten points`).

---

### Task 1: The token module

**Files:**
- Create: `packages/compositions/src/lib/motion-tokens.ts`
- Create: `packages/compositions/src/lib/motion-tokens.test.ts`
- Modify: `packages/compositions/src/lib/graphic-code.ts` (export `MOTION`)
- Modify: `packages/compositions/src/lib/graphic-code.test.ts` (one assertion on `MOTION`)
- Modify: `packages/compositions/package.json` (`exports`)

**Interfaces:**
- Consumes: `Easing` from `remotion` (type only in the module; the real one in the test and in `graphic-code.ts`).
- Produces: `MOTION_VERSION: 1`, `MOTION_PREAMBLE: string`, `MOTION_EASE_NAMES`, `MOTION_SPRING_NAMES`, `motionTokens(easing: typeof Easing): MotionTokens`, `motionFrames(ms, fps)`, `motionStagger(index, fps)`, type `MotionTokens`, all from `@boom-busters/compositions/motion-tokens`; `MOTION: MotionTokens` from `@boom-busters/compositions/graphic-code`.

- [ ] **Step 1: Write the failing test**

Create `packages/compositions/src/lib/motion-tokens.test.ts`:

```ts
import { Easing } from 'remotion'
import { describe, expect, it } from 'vitest'
import {
  MOTION_EASE_NAMES,
  MOTION_PREAMBLE,
  MOTION_SPRING_NAMES,
  MOTION_VERSION,
  motionFrames,
  motionStagger,
  motionTokens,
} from './motion-tokens'
import type { MotionTokens } from './motion-tokens'

/**
 * The preamble as the sandbox evaluates it: inside a strict function body
 * with `Remotion` in scope, and the `motion` it declares handed back.
 */
const evaluated = new Function(
  'Remotion',
  `"use strict";\n${MOTION_PREAMBLE}\nreturn motion`,
)({ Easing }) as MotionTokens
const typed = motionTokens(Easing)
const SAMPLES = Array.from({ length: 11 }, (_, i) => i / 10)

/** Every object reachable from `value` through own enumerable properties. */
function objectsIn(value: unknown, found: object[] = []): object[] {
  if (typeof value !== 'object' || value === null) return found
  found.push(value)
  for (const child of Object.values(value)) objectsIn(child, found)
  return found
}

describe('motion tokens (decision 301)', () => {
  it('declares in the preamble the numbers the typed object holds', () => {
    expect(MOTION_VERSION).toBe(1)
    expect(evaluated.ms).toEqual(typed.ms)
    expect(evaluated.ms).toEqual({
      micro: 120,
      enter: 450,
      exit: 300,
      reveal: 550,
      draw: 700,
      count: 1000,
      move: 900,
      gap: 120,
    })
    expect(evaluated.spring).toEqual(typed.spring)
    expect(evaluated.spring).toEqual({
      settle: { damping: 200 },
      hero: { damping: 14, stiffness: 120 },
      snap: { damping: 20, stiffness: 200 },
    })
    expect(evaluated.px).toEqual({ rise: 20 })
    expect(evaluated.scale).toEqual({ enter: 0.96 })
    expect(evaluated.order).toEqual(['frame', 'title', 'body', 'hero', 'note'])
    expect(evaluated.px).toEqual(typed.px)
    expect(evaluated.scale).toEqual(typed.scale)
    expect(evaluated.order).toEqual(typed.order)
  })

  it('declares the same five curves, sampled at ten points', () => {
    expect(Object.keys(evaluated.ease).sort()).toEqual([...MOTION_EASE_NAMES].sort())
    expect(Object.keys(evaluated.spring).sort()).toEqual([...MOTION_SPRING_NAMES].sort())
    for (const name of MOTION_EASE_NAMES) {
      expect(SAMPLES.map(evaluated.ease[name])).toEqual(SAMPLES.map(typed.ease[name]))
    }
  })

  it('eases arrivals out, departures in, moves both ways, emphasis hard, and linear straight', () => {
    for (const name of MOTION_EASE_NAMES) {
      expect(typed.ease[name](0)).toBeCloseTo(0, 2)
      expect(typed.ease[name](1)).toBeCloseTo(1, 2)
    }
    expect(typed.ease.enter(0.5)).toBeGreaterThan(0.9)
    expect(typed.ease.exit(0.5)).toBeLessThan(0.15)
    expect(typed.ease.move(0.5)).toBeCloseTo(0.5, 5)
    expect(typed.ease.emphasis(0.5)).toBeGreaterThan(0.95)
    expect(typed.ease.linear(0.3)).toBe(0.3)
  })

  it('counts frames and staggers at the edges, the same in both forms', () => {
    expect(motionFrames(1, 30)).toBe(1)
    expect(motionFrames(0, 30)).toBe(1)
    expect(motionFrames(450, 30)).toBe(14)
    expect(motionFrames(1000, 30)).toBe(30)
    expect(motionStagger(0, 30)).toBe(0)
    expect(motionStagger(1, 30)).toBe(2)
    expect(motionStagger(8, 30)).toBe(18)
    expect(motionStagger(20, 30)).toBe(18)
    for (const [ms, fps] of [
      [0, 30],
      [1, 30],
      [450, 30],
      [333, 25],
    ]) {
      expect(evaluated.frames(ms!, fps!)).toBe(typed.frames(ms!, fps!))
    }
    for (const index of [0, 1, 7, 8, 20]) {
      expect(evaluated.stagger(index, 30)).toBe(typed.stagger(index, 30))
    }
  })

  it('is frozen through, in both forms, so a design cannot change a token', () => {
    for (const form of [evaluated, typed]) {
      for (const object of objectsIn(form)) expect(Object.isFrozen(object)).toBe(true)
    }
    const mutable = evaluated as unknown as { ms: { enter: number } }
    expect(() => {
      mutable.ms.enter = 1
    }).toThrow(TypeError)
    expect(evaluated.ms.enter).toBe(450)
  })

  it('reads only Remotion.Easing from its scope', () => {
    expect(MOTION_PREAMBLE).toMatch(/^\/\/ The house motion tokens/)
    expect(MOTION_PREAMBLE).toContain('const motion = Object.freeze({')
    const identifiers = MOTION_PREAMBLE.match(/\bRemotion\s*\.\s*(\w+)/g) ?? []
    expect(new Set(identifiers)).toEqual(new Set(['Remotion.Easing']))
    expect(MOTION_PREAMBLE).not.toMatch(/\b(props|React|window|require|import)\b/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @boom-busters/compositions exec vitest run src/lib/motion-tokens.test.ts`
Expected: FAIL, the module `./motion-tokens` cannot be resolved.

- [ ] **Step 3: Write the module**

Create `packages/compositions/src/lib/motion-tokens.ts`:

```ts
import type { Easing } from 'remotion'

/**
 * The house motion tokens (decision 301): the numbers every graphic's motion
 * comes from, in two forms a test holds equal. `motionTokens(Easing)` builds
 * the typed object house code reads (`MOTION` in `graphic-code.ts`).
 * `MOTION_PREAMBLE` is the same object as JavaScript text, declared as a
 * frozen `motion` constant at the top of every stored design's compiled code
 * (`graphicCodeIssue` prepends it), so a design carries the values it was
 * checked with whatever the tokens become later.
 *
 * Remotion-free on purpose: the web server's Inngest route is bundled with
 * the `react-server` condition and cannot import `remotion`, so this module
 * takes `Easing` as an argument and names it in the preamble text only. The
 * numbers are written once, below, and the preamble is built from them, so
 * the two forms cannot drift on a value; the curves and the two functions are
 * written twice and held equal by `motion-tokens.test.ts`.
 *
 * The values are the starting point, scaled from the Carbon and Material
 * ratios to video; the owner tunes them on the board, one number here.
 */

/** The preamble a stored design carries, recorded as `code.motion`. Bump it when a token's meaning changes. */
export const MOTION_VERSION = 1

/** Lengths in milliseconds. */
export const MOTION_MS = {
  /** A colour shift, a tick. */
  micro: 120,
  /** A fade with rise. */
  enter: 450,
  /** Exits are shorter than entrances. */
  exit: 300,
  /** A wipe. */
  reveal: 550,
  /** Bars and lines drawn on. */
  draw: 700,
  /** A counter. */
  count: 1000,
  /** A reframe, the camera. */
  move: 900,
  /** Between an exit and the entrance that replaces it. */
  gap: 120,
} as const

/** Spring configs for `Remotion.spring({ config })`. */
export const MOTION_SPRING = {
  /** Critically damped, no overshoot; the default spring. */
  settle: { damping: 200 },
  /** One small overshoot, about 7%, settling under a second; once per beat. */
  hero: { damping: 14, stiffness: 120 },
  /** Quick, a hair of overshoot; small things. */
  snap: { damping: 20, stiffness: 200 },
} as const

/** The rise under a fade, in pixels at 1080p; a design scales it by its unit. */
export const MOTION_PX = { rise: 20 } as const
/** A figure's scale-in, never from zero. */
export const MOTION_SCALE = { enter: 0.96 } as const
/** Entrance order: the hero finishes last. */
export const MOTION_ORDER = ['frame', 'title', 'body', 'hero', 'note'] as const
/** Per item of a group, and the whole group's cap. */
export const MOTION_STAGGER_MS = 75
export const MOTION_STAGGER_MAX_MS = 600

export const MOTION_EASE_NAMES = ['enter', 'exit', 'move', 'emphasis', 'linear'] as const
export const MOTION_SPRING_NAMES = ['settle', 'hero', 'snap'] as const
export type MotionEaseName = (typeof MOTION_EASE_NAMES)[number]
export type MotionSpringName = (typeof MOTION_SPRING_NAMES)[number]

export interface MotionTokens {
  readonly ms: typeof MOTION_MS
  readonly frames: (ms: number, fps: number) => number
  readonly ease: Readonly<Record<MotionEaseName, (t: number) => number>>
  readonly spring: typeof MOTION_SPRING
  readonly px: typeof MOTION_PX
  readonly scale: typeof MOTION_SCALE
  readonly stagger: (index: number, fps: number) => number
  readonly order: typeof MOTION_ORDER
}

/** Milliseconds to whole frames, at least one. */
export function motionFrames(ms: number, fps: number): number {
  return Math.max(1, Math.round((ms * fps) / 1000))
}

/** The frame offset of the index-th item of a group: 75 ms each, the whole group within 600 ms. */
export function motionStagger(index: number, fps: number): number {
  return Math.round((Math.min(index * MOTION_STAGGER_MS, MOTION_STAGGER_MAX_MS) * fps) / 1000)
}

/** `Object.freeze` on the object and on each nested object. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

/** The typed tokens, built with the caller's `Easing` (the real one in Remotion, a frozen copy in the dry run). */
export function motionTokens(easing: typeof Easing): MotionTokens {
  return deepFreeze({
    ms: { ...MOTION_MS },
    frames: motionFrames,
    ease: {
      enter: easing.out(easing.poly(4)),
      exit: easing.in(easing.cubic),
      move: easing.inOut(easing.cubic),
      emphasis: easing.out(easing.exp),
      linear: easing.linear,
    },
    spring: {
      settle: { ...MOTION_SPRING.settle },
      hero: { ...MOTION_SPRING.hero },
      snap: { ...MOTION_SPRING.snap },
    },
    px: { ...MOTION_PX },
    scale: { ...MOTION_SCALE },
    stagger: motionStagger,
    order: [...MOTION_ORDER],
  }) as MotionTokens
}

/**
 * The tokens as the sandbox sees them: a frozen `motion` constant declared
 * before the design's code, inside the strict function body, reading
 * `Remotion.Easing` and nothing else. The curves and the two functions here
 * must match `motionTokens`; the numbers are the constants above.
 */
export const MOTION_PREAMBLE = `// The house motion tokens (decision 301), version ${MOTION_VERSION}. Read-only.
const motion = Object.freeze({
  ms: Object.freeze(${JSON.stringify(MOTION_MS)}),
  frames: function (ms, fps) { return Math.max(1, Math.round((ms * fps) / 1000)) },
  ease: Object.freeze({
    enter: Remotion.Easing.out(Remotion.Easing.poly(4)),
    exit: Remotion.Easing.in(Remotion.Easing.cubic),
    move: Remotion.Easing.inOut(Remotion.Easing.cubic),
    emphasis: Remotion.Easing.out(Remotion.Easing.exp),
    linear: Remotion.Easing.linear,
  }),
  spring: Object.freeze({
    settle: Object.freeze(${JSON.stringify(MOTION_SPRING.settle)}),
    hero: Object.freeze(${JSON.stringify(MOTION_SPRING.hero)}),
    snap: Object.freeze(${JSON.stringify(MOTION_SPRING.snap)}),
  }),
  px: Object.freeze(${JSON.stringify(MOTION_PX)}),
  scale: Object.freeze(${JSON.stringify(MOTION_SCALE)}),
  stagger: function (index, fps) { return Math.round((Math.min(index * ${MOTION_STAGGER_MS}, ${MOTION_STAGGER_MAX_MS}) * fps) / 1000) },
  order: Object.freeze(${JSON.stringify(MOTION_ORDER)}),
})`
```

- [ ] **Step 4: Export the subpath and `MOTION`**

In `packages/compositions/package.json`, add to `exports` after the `"./graphic-code-pure"` line:

```json
    "./motion-tokens": "./src/lib/motion-tokens.ts",
```

In `packages/compositions/src/lib/graphic-code.ts`, add after the `graphic-code-pure` re-exports (after the `export type { GraphicComponent, GraphicProps, GraphicScope } from './graphic-code-pure'` line):

```ts
import { motionTokens } from './motion-tokens'
import type { MotionTokens } from './motion-tokens'

/**
 * The house motion tokens with the real `Easing` (decision 301), for house
 * code. A design never imports this: it reads the `motion` constant its own
 * compiled code declares (`MOTION_PREAMBLE`), which holds the same values.
 */
export const MOTION: MotionTokens = motionTokens(Easing)
export type { MotionTokens } from './motion-tokens'
```

Move the two `import` lines up with the file's other imports (imports first, then the comment block and `export const MOTION`). `Easing` is already imported from `remotion` in that file.

In `packages/compositions/src/lib/graphic-code.test.ts`, add `MOTION` to the import from `./graphic-code` and this test at the end of the file:

```ts
describe('MOTION (decision 301)', () => {
  it('is the typed tokens with the real Easing', () => {
    expect(MOTION.ms.enter).toBe(450)
    expect(MOTION.ease.enter(0.5)).toBeGreaterThan(0.9)
    expect(Object.isFrozen(MOTION.spring.hero)).toBe(true)
  })
})
```

- [ ] **Step 5: Run the tests, the typecheck and the format check**

Run: `pnpm --filter @boom-busters/compositions exec vitest run src/lib/motion-tokens.test.ts src/lib/graphic-code.test.ts`
Expected: PASS.

Run: `pnpm --filter @boom-busters/compositions typecheck`
Expected: no errors. If `easing.in` is reported as not callable, `Easing.in` is a static method of the `Easing` class in Remotion 4.0.512 (`in(easing: EasingFunction): EasingFunction`); check `node_modules/remotion/dist/cjs/easing.d.ts` and use the name it declares.

Run: `pnpm exec prettier --check packages/compositions/src/lib/motion-tokens.ts packages/compositions/src/lib/motion-tokens.test.ts packages/compositions/src/lib/graphic-code.ts packages/compositions/src/lib/graphic-code.test.ts packages/compositions/package.json`
Expected: all formatted. Run `pnpm exec prettier --write` on the same paths if not.

- [ ] **Step 6: Commit**

```bash
git add packages/compositions/src/lib/motion-tokens.ts packages/compositions/src/lib/motion-tokens.test.ts packages/compositions/src/lib/graphic-code.ts packages/compositions/src/lib/graphic-code.test.ts packages/compositions/package.json
git commit -m "feat(compositions): the house motion tokens, typed and as the sandbox preamble (decision 301)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The preamble in every stored design

**Files:**
- Modify: `packages/schemas/src/graphic-code.ts:41-53` (`GraphicCodeSchema`)
- Modify: `packages/schemas/src/graphic-code.test.ts`
- Modify: `apps/web/lib/graphic-code/check.ts`
- Modify: `apps/web/lib/graphic-code/check.test.ts`

**Interfaces:**
- Consumes: `MOTION_PREAMBLE`, `MOTION_VERSION` from `@boom-busters/compositions/motion-tokens` (Task 1).
- Produces: `GraphicCode.motion?: number`; `graphicCodeIssue` stores `compiled` as `${MOTION_PREAMBLE}\n${compiled}` and `motion: MOTION_VERSION`, and runs the dry run on that same text.

- [ ] **Step 1: Write the failing schema test**

In `packages/schemas/src/graphic-code.test.ts`, inside `describe('GraphicCodeSchema (decision 295)', ...)` after `it('accepts a whole design', ...)`, add:

```ts
  it('records the preamble version a design carries, and accepts a design stored before there was one (decision 301)', () => {
    expect(GraphicCodeSchema.parse({ ...DESIGN, motion: 1 })).toEqual({ ...DESIGN, motion: 1 })
    expect(GraphicCodeSchema.parse(DESIGN)).not.toHaveProperty('motion')
    expect(GraphicCodeSchema.safeParse({ ...DESIGN, motion: 0 }).success).toBe(false)
    expect(GraphicCodeSchema.safeParse({ ...DESIGN, motion: 1.5 }).success).toBe(false)
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @boom-busters/schemas exec vitest run src/graphic-code.test.ts`
Expected: FAIL on the `motion: 0` and `motion: 1.5` cases (Zod strips unknown keys, so the first two assertions pass before the change; the refusals fail).

- [ ] **Step 3: Add the field**

In `packages/schemas/src/graphic-code.ts`, in `GraphicCodeSchema` after the `durationMs` line, add:

```ts
  /**
   * The version of the house motion preamble the compiled code carries
   * (decision 301); absent on a design stored before the tokens. Nothing
   * reads it yet: it is here so a later token change can tell old designs
   * from new.
   */
  motion: z.number().int().positive().optional(),
```

- [ ] **Step 4: Run the schema test to verify it passes**

Run: `pnpm --filter @boom-busters/schemas exec vitest run src/graphic-code.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing check tests**

In `apps/web/lib/graphic-code/check.test.ts`:

Add to the imports:

```ts
import { MOTION_PREAMBLE } from '@boom-busters/compositions/motion-tokens'
```

In `it('keeps a count-up whose passing values flicker by, citing its claim by id', ...)`, replace

```ts
        compiled: expect.stringContaining('function Graphic()'),
```

with

```ts
        compiled: expect.stringContaining('function Graphic()'),
        motion: 1,
```

Then add these tests at the end of `describe('graphicCodeIssue (decision 295)', ...)`, before its closing `})`:

```ts
  it('stores the compiled code with the house motion preamble first, and says which version (decision 301)', () => {
    const result = graphicCodeIssue(answer(), CONTEXT, slot(GRAPHIC))
    expect(result).toHaveProperty('code')
    const { code } = result as { code: { compiled: string; motion?: number } }
    expect(code.compiled.startsWith(`${MOTION_PREAMBLE}\n`)).toBe(true)
    expect(code.compiled.slice(MOTION_PREAMBLE.length + 1)).toContain('function Graphic()')
    expect(code.motion).toBe(1)
  })

  it('runs the dry run with the tokens in scope: a design on motion.ms and motion.ease passes', () => {
    const source = `function Graphic() {
  const frame = Remotion.useCurrentFrame()
  const { fps } = Remotion.useVideoConfig()
  const count = Remotion.interpolate(frame, [6, 6 + motion.frames(motion.ms.count, fps)], [0, 1], {
    easing: motion.ease.emphasis,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const sweep = Remotion.interpolate(frame, [0, 179], [0, 100], { easing: motion.ease.linear, extrapolateRight: 'clamp' })
  return (
    <Remotion.AbsoluteFill>
      <div>{'$' + Math.round(count * 40) / 10 + 'bn'}</div>
      <div style={{ width: sweep + '%', height: motion.px.rise }} />
    </Remotion.AbsoluteFill>
  )
}
`
    expect(graphicCodeIssue(answer({ source }), CONTEXT, slot(GRAPHIC))).toHaveProperty('code')
  })

  it("refuses a design that changes a token, by the dry run's crash report (decision 301)", () => {
    // Not an assignment, so the scan cannot see it; the frozen object throws under strict mode.
    const source = countUp(4).replace(
      'const frame',
      'Object.assign(motion.ms, { enter: 1 })\n  const frame',
    )
    expect(graphicCodeIssue(answer({ source }), CONTEXT, slot(GRAPHIC))).toEqual({
      issue: expect.stringMatching(
        /^the code failed at 0\.0 s \(frame 0\) in landscape: Cannot (assign to|add property) /,
      ),
    })
  })
```

- [ ] **Step 6: Run the check tests to verify they fail**

Run: `pnpm --filter @boom-busters/web exec vitest run lib/graphic-code/check.test.ts`
Expected: FAIL. The count-up test's `toEqual` lacks `motion`; the preamble test fails on `startsWith`; the tokens-in-scope test reports `motion is not defined` from the dry run; the crash test reports `motion is not defined` rather than the frozen-object message.

- [ ] **Step 7: Prepend the preamble in the check**

In `apps/web/lib/graphic-code/check.ts`:

Add to the imports, after the `graphic-code-pure` import:

```ts
import { MOTION_PREAMBLE, MOTION_VERSION } from '@boom-busters/compositions/motion-tokens'
```

Add after the `SHOWN_MIN_SAMPLES` constant:

```ts
/**
 * The compiled code a design is stored and run with (decision 301): the house
 * motion preamble, then the model's code. The scan has already read the
 * model's code on its own; the dry run, the board, the Player and Lambda all
 * run this text, so the tokens a design was checked against travel with it.
 */
function withMotionPreamble(compiled: string): string {
  return `${MOTION_PREAMBLE}\n${compiled}`
}
```

In `graphicCodeIssue`, after the scan:

```ts
  const scanned = scanGraphicSource(answer.source, compiled.compiled)
  if (scanned !== null) return { issue: scanned }
  const stored = withMotionPreamble(compiled.compiled)
```

Change the dry run's `compiled: compiled.compiled,` to `compiled: stored,`.

In the returned `code`, change `compiled: compiled.compiled,` to `compiled: stored,` and add `motion: MOTION_VERSION,` after `durationMs: slot.durationMs,`.

Update the file's header comment: after "the compile, the scan, the dry run and the facts, in that order." add "The house motion preamble is prepended between the scan and the dry run (decision 301), so the code the dry run checks is the code that is stored."

- [ ] **Step 8: Run the check tests to verify they pass**

Run: `pnpm --filter @boom-busters/web exec vitest run lib/graphic-code/check.test.ts`
Expected: PASS, including `passes both of the prompt's worked examples` (the examples still use `Remotion.Easing`, which this task does not refuse).

If the crash test's message starts differently (the `vm` context's TypeError wording for a frozen object), copy the actual message into the regex: the test pins that the refusal comes from the dry run at frame 0 in landscape, not the exact wording.

- [ ] **Step 9: Run the whole web graphic-code suite, the typechecks and the format check**

Run: `pnpm --filter @boom-busters/web exec vitest run lib/graphic-code lib/graphic-design.test.ts`
Expected: PASS.

Run: `pnpm --filter @boom-busters/schemas typecheck && pnpm --filter @boom-busters/web typecheck`
Expected: no errors.

Run: `pnpm exec prettier --check packages/schemas/src/graphic-code.ts packages/schemas/src/graphic-code.test.ts apps/web/lib/graphic-code/check.ts apps/web/lib/graphic-code/check.test.ts`
Expected: all formatted.

- [ ] **Step 10: Commit**

```bash
git add packages/schemas/src/graphic-code.ts packages/schemas/src/graphic-code.test.ts apps/web/lib/graphic-code/check.ts apps/web/lib/graphic-code/check.test.ts
git commit -m "feat(web): every stored design carries the house motion preamble and its version (decision 301)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The scan holds the tokens

**Files:**
- Modify: `apps/web/lib/graphic-code/scan.ts`
- Modify: `apps/web/lib/graphic-code/scan.test.ts`
- Modify: `apps/web/lib/graphic-code/check.test.ts` (`countUp` source)
- Modify: `apps/web/lib/graphic-design.test.ts` (`figureSource`)

**Interfaces:**
- Consumes: `MOTION_EASE_NAMES`, `MOTION_SPRING_NAMES` from `@boom-busters/compositions/motion-tokens` (Task 1); `graphicCodeIssue` prepends the preamble after the scan (Task 2), so a passing design may read `motion`.
- Produces: `scanGraphicSource(source, compiled)` refuses, in this order after the existing checks: bracket access to `Remotion`, `React` or `motion`; a `motion` binding of the design's own; an assignment under `motion` (the existing `Remotion`/`React` rule, widened); `Easing` as an identifier in any form; a `motion.ease.<x>` or `motion.spring.<x>` that is not a token; an `interpolate(` call with no `easing: motion.ease.<name>` (or an array of them) in its text; `spring` other than `Remotion.spring(`; a `Remotion.spring(` call with no `config: motion.spring.<name>` in its text. `USES_SPRING` and `OVERSHOOTING_EASING` are removed.

- [ ] **Step 1: Write the failing scan tests**

In `apps/web/lib/graphic-code/scan.test.ts`:

Add after the `MOTION` constant at the top:

```ts
const TOKENS = 'curves come from motion.ease only'
const NO_EASING = (call: number, of: number) =>
  `interpolate call ${call} of ${of} carries no easing: motion.ease.<name>, so it moves on a straight line, which is the first thing that reads as generated`
const NO_CONFIG = (call: number, of: number) =>
  `Remotion.spring call ${call} of ${of} carries no config: motion.spring.<name>; Remotion's default spring bounces`
const OWN_MOTION =
  "the code declares a motion of its own, which the sandbox bans: motion is the house's token object, read it where it is needed"
/** An interpolate on a frame the test never declares; the scan does not run the code. */
const call = (options: string) =>
  `  const v = Remotion.interpolate(frame, [0, 10], [0, 1], ${options})`
```

In `it('refuses an assignment to a member of the sandbox arguments: the sandbox is read-only', ...)`, replace the clean-read case

```ts
          '  const same = Remotion.Easing === null || Remotion.Easing != null\n  const bezier = Remotion.Easing.bezier(0, 0, 1, 1)',
```

with

```ts
          '  const same = Remotion.Sequence === null || Remotion.Sequence != null\n  const ease = motion.ease.enter',
```

Replace the three tests `refuses spring as %s: the sandbox no longer offers it`, `does not take a word spring in a string or a longer name for the call` and `refuses Easing.%s: it overshoots` with:

```ts
  it.each([
    ['Remotion.Easing.cubic', '  const e = Remotion.Easing.cubic', 'Easing.cubic'],
    ['Easing.elastic', '  const e = Remotion.Easing.elastic(1)', 'Easing.elastic'],
    ['a destructured Easing', '  const { Easing } = Remotion\n  const e = Easing.linear', 'Easing'],
    ['an alias of Easing', '  const E = Remotion.Easing', 'Easing'],
  ])('refuses %s: curves come from motion.ease only (decision 301)', (_name, line, named) => {
    expect(scan(graphic(line))).toBe(
      `the code uses ${named}, which the sandbox no longer offers: ${TOKENS}`,
    )
  })

  it('refuses Easing spelt as a string, and bracket access to a sandbox argument', () => {
    expect(scan(graphic("  const e = Remotion['Easing']"))).toBe(
      `the code uses Easing, which the sandbox bans: ${TOKENS}`,
    )
    expect(scan(graphic("  const s = Remotion['spring']"))).toBe(
      `the code reads Remotion by bracket, which the sandbox bans: ${GIVEN}`,
    )
    expect(scan(graphic("  const e = motion['ease']"))).toBe(
      `the code reads motion by bracket, which the sandbox bans: ${GIVEN}`,
    )
    expect(scan(graphic("  const c = React['createElement']"))).toBe(
      `the code reads React by bracket, which the sandbox bans: ${GIVEN}`,
    )
  })

  it('passes an interpolate on a token curve, an array of them, or a spread with one', () => {
    expect(scan(graphic(call("{ easing: motion.ease.enter, extrapolateRight: 'clamp' }")))).toBeNull()
    expect(scan(graphic(call('{ easing: motion.ease.linear }')))).toBeNull()
    expect(
      scan(
        graphic(
          "  const clamp = { extrapolateLeft: 'clamp' }\n" +
            call('{ ...clamp, easing: motion.ease.exit }'),
        ),
      ),
    ).toBeNull()
    expect(
      scan(
        graphic(
          '  const v = Remotion.interpolate(frame, [0, 10, 20], [0, 1, 0], { easing: [motion.ease.enter, motion.ease.exit] })',
        ),
      ),
    ).toBeNull()
    // Nested brackets inside the call are part of the call.
    expect(
      scan(
        graphic(
          '  const v = Remotion.interpolate(frame, [motion.frames(0, 30), motion.frames(450, 30)], [0, 1], { easing: motion.ease.enter })',
        ),
      ),
    ).toBeNull()
  })

  it('refuses an interpolate with no easing, naming which call', () => {
    expect(scan(graphic(call("{ extrapolateRight: 'clamp' }")))).toBe(NO_EASING(1, 1))
    expect(scan(graphic('  const v = Remotion.interpolate(frame, [0, 10], [0, 1])'))).toBe(
      NO_EASING(1, 1),
    )
    expect(
      scan(
        graphic(
          call('{ easing: motion.ease.enter }') +
            '\n  const w = Remotion.interpolate(frame, [0, 10], [0, 1])',
        ),
      ),
    ).toBe(NO_EASING(2, 2))
  })

  it('refuses an easing that is not a token, or passed through a variable', () => {
    expect(scan(graphic(call('{ easing: motion.ease.quart }')))).toBe(
      'the code uses motion.ease.quart, which is not a token: the curves are motion.ease.enter, exit, move, emphasis and linear',
    )
    expect(scan(graphic('  const ease = motion.ease.enter\n' + call('{ easing: ease }')))).toBe(
      NO_EASING(1, 1),
    )
  })

  it('passes Remotion.spring on a token preset', () => {
    expect(
      scan(
        graphic(
          '  const s = Remotion.spring({ frame, fps: 30, delay: 3, config: motion.spring.settle })',
        ),
      ),
    ).toBeNull()
    expect(
      scan(
        graphic(
          '  const s = Remotion.spring({ frame, fps: 30, config: motion.spring.hero, durationInFrames: 20 })',
        ),
      ),
    ).toBeNull()
  })

  it.each([
    ['no config', '  const s = Remotion.spring({ frame: 0, fps: 30 })'],
    ['a literal config', '  const s = Remotion.spring({ frame: 0, fps: 30, config: { damping: 9 } })'],
    [
      'a preset spread and changed',
      '  const s = Remotion.spring({ frame: 0, fps: 30, config: { ...motion.spring.hero, damping: 5 } })',
    ],
  ])('refuses Remotion.spring with %s', (_name, line) => {
    expect(scan(graphic(line))).toBe(NO_CONFIG(1, 1))
  })

  it('names which spring call when there are several', () => {
    expect(
      scan(
        graphic(
          '  const a = Remotion.spring({ frame, fps: 30, config: motion.spring.settle })\n  const b = Remotion.spring({ frame, fps: 30 })',
        ),
      ),
    ).toBe(NO_CONFIG(2, 2))
  })

  it.each([
    ['a bare call', '  const s = spring({ frame: 0, fps: 30, config: motion.spring.settle })'],
    [
      'a destructure',
      '  const { spring } = Remotion\n  const s = spring({ frame: 0, fps: 30, config: motion.spring.settle })',
    ],
  ])('refuses spring as %s: only Remotion.spring with a preset', (_name, line) => {
    expect(scan(graphic(line))).toBe(
      'the code calls spring bare, which the sandbox bans: a spring is Remotion.spring({ frame, fps, config: motion.spring.settle }) and nothing else',
    )
  })

  it('refuses a spring preset that is not a token', () => {
    expect(
      scan(graphic('  const s = Remotion.spring({ frame, fps: 30, config: motion.spring.bouncy })')),
    ).toBe(
      'the code uses motion.spring.bouncy, which is not a token: the presets are motion.spring.settle, hero and snap',
    )
  })

  it('does not take a word spring in a string or a longer name for the call', () => {
    expect(scan(graphic("  const note = 'spring'\n  const springy = 1"))).toBeNull()
  })

  it.each([
    ['const motion', '  const motion = { ms: {} }'],
    ['let motion', '  let motion'],
    ['function motion', '  function motion() {}'],
    ['a motion parameter', '  const f = (frame, motion) => frame'],
    ['a destructured motion', '  const { motion } = props'],
  ])("refuses %s: the token object is the house's", (_name, line) => {
    expect(scan(graphic(line))).toBe(OWN_MOTION)
  })

  it('does not take motion read as an argument or in an object for a declaration', () => {
    expect(
      scan(
        graphic(
          '  const style = { opacity: 1, marginTop: motion.px.rise }\n  const f = motion.frames(motion.ms.enter, 30)\n  const inMotion = 1\n  const motionless = 2',
        ),
      ),
    ).toBeNull()
  })

  it('refuses an assignment to a token, plain or compound', () => {
    expect(scan(graphic('  motion.ms.enter = 1'))).toBe(
      'the code assigns to motion.ms, which the sandbox bans: the sandbox is read-only',
    )
    expect(scan(graphic('  motion.ease.enter ??= null'))).toBe(
      'the code assigns to motion.ease, which the sandbox bans: the sandbox is read-only',
    )
  })
```

- [ ] **Step 2: Run the scan tests to verify they fail**

Run: `pnpm --filter @boom-busters/web exec vitest run lib/graphic-code/scan.test.ts`
Expected: FAIL on every new test; the old spring message appears for the spring cases, and `null` for the Easing, interpolate and `motion` cases.

- [ ] **Step 3: Write the rules**

In `apps/web/lib/graphic-code/scan.ts`:

Add to the imports:

```ts
import { MOTION_EASE_NAMES, MOTION_SPRING_NAMES } from '@boom-busters/compositions/motion-tokens'
```

Add after the `MOTION` message constant:

```ts
const TOKENS = 'curves come from motion.ease only'
```

Replace the `ASSIGNS_TO_SANDBOX` comment and regex with:

```ts
/**
 * An assignment, plain or compound (`+=`, `??=`, ...), to any member chain
 * under `Remotion`, `React` or `motion` (not `==`, `===` or `=>`). The sandbox
 * freezes its scope and hands the code frozen copies of `Easing` (and, in the
 * dry run, of React), the tokens are frozen through, and the body runs in
 * strict mode, so any assignment to them throws in the dry run whatever its
 * syntax; this names the plain forms before anything runs. The first member
 * is named.
 */
const ASSIGNS_TO_SANDBOX =
  /\b(Remotion|React|motion)((?:\s*\.\s*[\w$]+)+)\s*(?:[-+*/%&|^]|\*\*|<<|>>>?|&&|\|\||\?\?)?=(?![=>])/
```

Replace the `USES_SPRING` and `OVERSHOOTING_EASING` constants (and their comments) with:

```ts
/**
 * Bracket access to a sandbox argument (`Remotion['spring']`, `motion['ease']`):
 * the one spelling that reaches past every dot-form rule below.
 */
const BRACKETS_SANDBOX = /\b(Remotion|React|motion)\s*\[/

/**
 * A `motion` of the design's own: a declaration, a parameter or a destructure.
 * The preamble declares `const motion` in the same function body, so a second
 * declaration would be a syntax error at parse time; this says what to do
 * instead. `motion` read as an argument (`f(motion.ms.enter)`) and names that
 * contain it (`inMotion`) are not matched.
 */
const DECLARES_MOTION =
  /\b(?:const|let|var|function|class)\s+motion\b|[(,]\s*motion\s*[,)=]|\{[^{}]*\bmotion\b[^{}]*\}\s*=(?![=>])/

/**
 * `Easing` as an identifier in any shape: `Remotion.Easing.cubic`, a
 * destructure, an alias. The curves are the tokens (decision 301); the only
 * `Easing` in a stored design is the preamble's, which is prepended after this
 * scan. The member is named when there is one.
 */
const USES_EASING = /\bEasing\b(?:\s*\.\s*([\w$]+))?/

/** Every `motion.ease.<x>` and `motion.spring.<x>` the code names. */
const EASE_TOKEN = /\bmotion\s*\.\s*ease\s*\.\s*([\w$]+)/g
const SPRING_TOKEN = /\bmotion\s*\.\s*spring\s*\.\s*([\w$]+)/g

/** `easing: motion.ease.<x>`, or an array of them, as the text of an `interpolate` call must carry. */
const EASING_OPTION =
  /\beasing\s*:\s*(?:motion\s*\.\s*ease\s*\.\s*[\w$]+|\[\s*motion\s*\.\s*ease\s*\.\s*[\w$]+(?:\s*,\s*motion\s*\.\s*ease\s*\.\s*[\w$]+)*\s*,?\s*\])/
/** `config: motion.spring.<x>`, as the text of a `Remotion.spring` call must carry. */
const SPRING_CONFIG = /\bconfig\s*:\s*motion\s*\.\s*spring\s*\.\s*[\w$]+/
/** `spring` in any shape but `Remotion.spring(`: a bare call, or a destructure from `Remotion`. */
const BARE_SPRING = /(?<![\w$.])spring\s*\(|\{[^}]*\bspring\b[^}]*\}\s*=\s*Remotion\b/
const INTERPOLATE_CALL = /\binterpolate\s*\(/g
const REMOTION_SPRING_CALL = /\bRemotion\s*\.\s*spring\s*\(/g

const EASE_NAMES = new Set<string>(MOTION_EASE_NAMES)
const SPRING_NAMES = new Set<string>(MOTION_SPRING_NAMES)
```

Add to `BANNED_STRINGS`, after the `dangerouslySetInnerHTML` entry:

```ts
  { pattern: /^Easing$/, name: () => 'Easing', reason: TOKENS },
```

In `scanGraphicSource`, replace everything from `const assigned = ASSIGNS_TO_SANDBOX.exec(code)` down to (and including) the `overshoot` block with:

```ts
  const bracketed = BRACKETS_SANDBOX.exec(code)
  if (bracketed) {
    return `the code reads ${bracketed[1] ?? ''} by bracket, which the sandbox bans: ${GIVEN}`
  }
  if (DECLARES_MOTION.test(code)) {
    return "the code declares a motion of its own, which the sandbox bans: motion is the house's token object, read it where it is needed"
  }
  const assigned = ASSIGNS_TO_SANDBOX.exec(code)
  if (assigned) {
    const member = /[\w$]+/.exec(assigned[2] ?? '')?.[0] ?? ''
    return `the code assigns to ${assigned[1]}.${member}, which the sandbox bans: the sandbox is read-only`
  }
  const easing = USES_EASING.exec(code)
  if (easing) {
    const named = easing[1] ? `Easing.${easing[1]}` : 'Easing'
    return `the code uses ${named}, which the sandbox no longer offers: ${TOKENS}`
  }
  for (const match of code.matchAll(EASE_TOKEN)) {
    const name = match[1] ?? ''
    if (!EASE_NAMES.has(name)) {
      return `the code uses motion.ease.${name}, which is not a token: the curves are motion.ease.enter, exit, move, emphasis and linear`
    }
  }
  for (const match of code.matchAll(SPRING_TOKEN)) {
    const name = match[1] ?? ''
    if (!SPRING_NAMES.has(name)) {
      return `the code uses motion.spring.${name}, which is not a token: the presets are motion.spring.settle, hero and snap`
    }
  }
  const interpolates = calls(code, INTERPOLATE_CALL)
  for (const [index, text] of interpolates.entries()) {
    if (!EASING_OPTION.test(text)) {
      return `interpolate call ${index + 1} of ${interpolates.length} carries no easing: motion.ease.<name>, so it moves on a straight line, which is the first thing that reads as generated`
    }
  }
  if (BARE_SPRING.test(code)) {
    return 'the code calls spring bare, which the sandbox bans: a spring is Remotion.spring({ frame, fps, config: motion.spring.settle }) and nothing else'
  }
  const springs = calls(code, REMOTION_SPRING_CALL)
  for (const [index, text] of springs.entries()) {
    if (!SPRING_CONFIG.test(text)) {
      return `Remotion.spring call ${index + 1} of ${springs.length} carries no config: motion.spring.<name>; Remotion's default spring bounces`
    }
  }
```

Add after `scanGraphicSource` (before `splitSource`):

```ts
/**
 * The text of each call that `name` opens, from its first character to the
 * bracket that closes the call, in blanked code (so a bracket inside a string
 * does not count). A call that never closes runs to the end of the code.
 */
function calls(code: string, name: RegExp): string[] {
  const found: string[] = []
  for (const match of code.matchAll(name)) {
    const start = match.index ?? 0
    let depth = 0
    let end = code.length
    for (let at = start + match[0].length - 1; at < code.length; at += 1) {
      const char = code[at]
      if (char === '(' || char === '[' || char === '{') depth += 1
      else if (char === ')' || char === ']' || char === '}') {
        depth -= 1
        if (depth === 0) {
          end = at + 1
          break
        }
      }
    }
    found.push(code.slice(start, end))
  }
  return found
}
```

Update the file's header comment: replace the sentence about `spring` (if any) and add, after "It also refuses the one-line routes out of the sandbox (...)": "Since decision 301 it also holds the motion tokens: `Easing` in any form, an `interpolate` without `easing: motion.ease.<name>` in its call text, a spring that is not `Remotion.spring` with `config: motion.spring.<name>`, bracket access to the sandbox, and a `motion` binding or assignment of the design's own."

- [ ] **Step 4: Run the scan tests to verify they pass**

Run: `pnpm --filter @boom-busters/web exec vitest run lib/graphic-code/scan.test.ts`
Expected: PASS. If `refuses an assignment to a member of the sandbox arguments` now reports the Easing message for `Remotion.Easing = null`, the assignment check is running after the Easing check: it must run before it, as the order above has it.

- [ ] **Step 5: Move the test sources that reach the scan onto the tokens**

In `apps/web/lib/graphic-code/check.test.ts`, in `countUp`, replace

```ts
  const count = Remotion.interpolate(frame, [6, 6 + fps], [0, 1], {
    easing: Remotion.Easing.out(Remotion.Easing.cubic),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const sweep = Remotion.interpolate(frame, [0, 179], [0, 100], { extrapolateRight: 'clamp' })
```

with

```ts
  const count = Remotion.interpolate(frame, [6, 6 + fps], [0, 1], {
    easing: motion.ease.emphasis,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const sweep = Remotion.interpolate(frame, [0, 179], [0, 100], { easing: motion.ease.linear, extrapolateRight: 'clamp' })
```

In `apps/web/lib/graphic-design.test.ts`, in `figureSource`, replace

```ts
  const land = Remotion.interpolate(frame, [27, 42], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const drift = Remotion.interpolate(frame, [0, durationInFrames], [1, 1.04])
```

with

```ts
  const land = Remotion.interpolate(frame, [27, 42], [0, 1], { easing: motion.ease.enter, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const drift = Remotion.interpolate(frame, [0, durationInFrames], [1, 1.04], { easing: motion.ease.linear })
```

Then search the web app's tests for any other source that reaches the scan and still uses `Easing` or a bare interpolate:

Run: `grep -rn "Remotion.Easing\|interpolate(" apps/web/lib --include=*.test.ts --include=*.test.tsx | grep -v "graphic-code/dry-run.test.ts\|graphic-code/scan.test.ts"`
Expected: only lines that now carry `motion.ease`. `dry-run.test.ts` calls `dryRunGraphic` directly and never reaches the scan, so its sources stay as they are.

- [ ] **Step 6: Run the web suites that run designs, the typecheck and the format check**

Run: `pnpm --filter @boom-busters/web exec vitest run lib/graphic-code lib/graphic-design.test.ts`
Expected: PASS, except `passes both of the prompt's worked examples` in `check.test.ts`, which now fails because the examples still use `Remotion.Easing`. That is Task 5's job; it is the one expected failure at the end of this task, and the ledger records it.

Run: `pnpm --filter @boom-busters/web typecheck`
Expected: no errors.

Run: `pnpm exec prettier --check apps/web/lib/graphic-code/scan.ts apps/web/lib/graphic-code/scan.test.ts apps/web/lib/graphic-code/check.test.ts apps/web/lib/graphic-design.test.ts`
Expected: all formatted.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/graphic-code/scan.ts apps/web/lib/graphic-code/scan.test.ts apps/web/lib/graphic-code/check.test.ts apps/web/lib/graphic-design.test.ts
git commit -m "feat(web): the scan holds the motion tokens: no Easing, every interpolate and spring on a token (decision 301)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Remotion's own rules, pinned

**Files:**
- Create: `packages/providers/src/prompts/remotion-rules.ts`
- Create: `packages/providers/src/prompts/remotion-rules.test.ts`

**Interfaces:**
- Consumes: the vendored files `.agents/skills/remotion-markup/timing.md` and `.agents/skills/remotion-markup/sequencing.md` (read by the test only; the prompt holds copies).
- Produces: `REMOTION_RULES: string` (the rendered block the prompt includes) and `REMOTION_RULE_EXCERPTS` (the data the test pins), from `./remotion-rules`.

- [ ] **Step 1: Write the failing test**

Create `packages/providers/src/prompts/remotion-rules.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { REMOTION_RULE_EXCERPTS, REMOTION_RULES } from './remotion-rules'

/**
 * The excerpts are copies of Remotion's vendored agent rules
 * (`.agents/skills/remotion-markup/`, pinned in `skills-lock.json`). Every
 * line marked vendored must still be in its file, trailing spaces aside, so
 * an `npx skills` upgrade that changes the advice fails here rather than
 * drifting the prompt; the house lines are the sandbox's own.
 */
const VENDORED = new URL('../../../../.agents/skills/remotion-markup/', import.meta.url)

function vendoredLines(file: string): Set<string> {
  const text = readFileSync(new URL(file, VENDORED), 'utf8')
  return new Set(text.split('\n').map((line) => line.trimEnd()))
}

describe("Remotion's rules in the prompt (decision 301)", () => {
  it('excerpts timing.md and sequencing.md, and nothing else', () => {
    expect(REMOTION_RULE_EXCERPTS.map((excerpt) => excerpt.file)).toEqual([
      'timing.md',
      'sequencing.md',
    ])
  })

  it.each(REMOTION_RULE_EXCERPTS)('pins every vendored line of $file to the vendored file', (excerpt) => {
    const lines = vendoredLines(excerpt.file)
    for (const line of excerpt.lines) {
      if (line.house) continue
      expect(lines.has(line.text.trimEnd()), `vendored line missing: ${line.text}`).toBe(true)
    }
  })

  it('has at least as many vendored lines as house lines in each excerpt', () => {
    for (const excerpt of REMOTION_RULE_EXCERPTS) {
      const house = excerpt.lines.filter((line) => line.house).length
      expect(excerpt.lines.length - house).toBeGreaterThanOrEqual(house)
    }
  })

  it("still has the advice the house replaced to replace: Remotion's Easing.spring and its keyframe easings", () => {
    const timing = readFileSync(new URL('timing.md', VENDORED), 'utf8')
    expect(timing).toContain('easing: Easing.spring({damping: 200}),')
    expect(timing).toContain(
      'easing: [Easing.bezier(0.16, 1, 0.3, 1), Easing.linear, Easing.spring({damping: 200})],',
    )
  })

  it('renders each excerpt under its file name, in order', () => {
    expect(REMOTION_RULES.indexOf('timing.md')).toBeGreaterThan(0)
    expect(REMOTION_RULES.indexOf('sequencing.md')).toBeGreaterThan(REMOTION_RULES.indexOf('timing.md'))
    for (const excerpt of REMOTION_RULE_EXCERPTS) {
      for (const line of excerpt.lines) expect(REMOTION_RULES).toContain(line.text)
    }
  })

  it('mentions no package but remotion, no Easing member, no import, and no dash a reader would see', () => {
    expect(REMOTION_RULES).not.toMatch(/@remotion\//)
    expect(REMOTION_RULES).not.toMatch(/\bimport\b|\bfrom ["']/)
    expect(REMOTION_RULES).not.toMatch(/\bEasing\s*\./)
    expect(REMOTION_RULES).not.toMatch(/\bSeries\b|premount|Interactive\./)
    expect(REMOTION_RULES).not.toMatch(/[–—]/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @boom-busters/providers exec vitest run src/prompts/remotion-rules.test.ts`
Expected: FAIL, the module `./remotion-rules` cannot be resolved.

- [ ] **Step 3: Write the excerpts**

Create `packages/providers/src/prompts/remotion-rules.ts`. Every `v(...)` line is copied character for character (trailing spaces trimmed) from the named vendored file; every `h(...)` line is the house's.

```ts
/**
 * Remotion's own rules for the designer's prompt (decision 301): house-edited
 * excerpts of two files under `.agents/skills/remotion-markup/`, vendored
 * from `remotion-dev/skills` and pinned by hash in `skills-lock.json`.
 * `timing.md` for interpolate over explicit ranges, clamping, keyframes and
 * perceptual scale; `sequencing.md` for Sequence windows, `layout="none"`,
 * the local frame inside a Sequence and nesting. Not `transitions.md` or
 * `text-highlights.md`, which rest on packages the sandbox does not expose,
 * and not `Series`, which the sandbox scope lacks.
 *
 * A vendored line is Remotion's text; a house line is ours, marked so
 * `remotion-rules.test.ts` can pin every vendored line to its file. The
 * house's edits: Remotion's `Easing.spring({damping: 200})` advice and its
 * keyframe easings are replaced by the tokens, since a design may not name
 * `Easing`; and the examples that pass no easing get `motion.ease.enter`,
 * since the scan refuses an interpolate without one.
 */

export interface RuleLine {
  text: string
  /** The house's own line, not Remotion's. */
  house?: true
}

export interface RemotionRuleExcerpt {
  file: 'timing.md' | 'sequencing.md'
  lines: readonly RuleLine[]
}

const v = (text: string): RuleLine => ({ text })
const h = (text: string): RuleLine => ({ text, house: true })

export const REMOTION_RULE_EXCERPTS: readonly RemotionRuleExcerpt[] = [
  {
    file: 'timing.md',
    lines: [
      v('Drive motion with `interpolate()` over an explicit frame range.'),
      h('In this sandbox the curve is a token: every interpolate carries easing: motion.ease.<name>, written inside the call, and the range comes from the tokens, [from, from + motion.frames(motion.ms.enter, fps)].'),
      v('By default, the values are not clamped, so the value can go outside the range [0, 1].'),
      v('Here is how they can be clamped:'),
      v('const opacity = interpolate(frame, [0, 0.3 * fps], [0, 1], {'),
      h('  easing: motion.ease.enter,'),
      v('  extrapolateRight: "clamp",'),
      v('  extrapolateLeft: "clamp",'),
      v('});'),
      h('A push with no bounce is motion.spring.settle through Remotion.spring, or motion.ease.enter; Remotion\'s Easing is not available here.'),
      v('## Multiple keyframes'),
      v('Add as many keyframes as you want. For multiple easings, pass an array with `n - 1` items:'),
      v('const scale = interpolate(frame, [0, 1 * fps, 9 * fps, 10 * fps], [0, 1, 1, 0], {'),
      h('  easing: [motion.ease.enter, motion.ease.linear, motion.ease.exit],'),
      v('  extrapolateLeft: "clamp",'),
      v('  extrapolateRight: "clamp",'),
      v("  output: 'perceptual-scale' // <- Add this to scale animations"),
      v('});'),
      v('## Animating scale'),
      v('When animating scale, if the output is linear, the perceived scale would be smaller the larger the scale gets.'),
      v('Use this option to compensate:'),
      h("Pass output: 'perceptual-scale' to any interpolate that drives a scale."),
    ],
  },
  {
    file: 'sequencing.md',
    lines: [
      v('Use `<Sequence>` to delay when an element appears in the timeline.'),
      v('This will by default wrap the component in an absolute fill element.'),
      v('If the items should not be wrapped, use the `layout` prop:'),
      v('<Sequence layout="none">'),
      v('  <Title />'),
      v('</Sequence>'),
      h('Here <Title /> stands for the elements a helper returns: write <Remotion.Sequence from={at} durationInFrames={length} layout="none">{title(frame - at, fps)}</Remotion.Sequence>, with at and length whole numbers and length at least 1.'),
      v('## Frame References Inside Sequences'),
      v('Inside a Sequence, `useCurrentFrame()` returns the local frame (starting from 0):'),
      h('You read useCurrentFrame() once, at the top of Graphic, so hand a helper inside a Sequence that frame less the Sequence\'s from, as above.'),
      v('## Nested Sequences'),
      v('Sequences can be nested for complex timing:'),
      v('<Sequence from={0} durationInFrames={120}>'),
      v('  <Background />'),
      v('  <Sequence from={15} durationInFrames={90} layout="none">'),
      v('    <Title />'),
      v('  </Sequence>'),
      v('  <Sequence from={45} durationInFrames={60} layout="none">'),
      v('    <Subtitle />'),
      v('  </Sequence>'),
      v('</Sequence>'),
    ],
  },
]

/** The block the system prompt carries. */
export const REMOTION_RULES =
  "Remotion's own rules, from its agent skills (vendored and pinned), with the house's edits where the sandbox differs:\n" +
  REMOTION_RULE_EXCERPTS.map(
    (excerpt) => `\n${excerpt.file}:\n${excerpt.lines.map((line) => line.text).join('\n')}`,
  ).join('\n')
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @boom-busters/providers exec vitest run src/prompts/remotion-rules.test.ts`
Expected: PASS. If a vendored line is reported missing, open the vendored file and copy the line exactly (the markdown keeps trailing spaces on some lines; the test trims those on both sides, nothing else).

Run: `pnpm --filter @boom-busters/providers typecheck && pnpm exec prettier --check packages/providers/src/prompts/remotion-rules.ts packages/providers/src/prompts/remotion-rules.test.ts`
Expected: no errors, all formatted (Prettier will wrap the long `h(...)` strings; let it, and re-run the test).

- [ ] **Step 5: Commit**

```bash
git add packages/providers/src/prompts/remotion-rules.ts packages/providers/src/prompts/remotion-rules.test.ts
git commit -m "feat(providers): Remotion's timing and sequencing rules, excerpted and pinned to the vendored files (decision 301)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The prompt on the tokens

**Files:**
- Modify: `packages/providers/src/prompts/graphics.ts` (`SYSTEM`, `GRAPHIC_EXAMPLE_TYPE`, `GRAPHIC_EXAMPLE_CHART`)
- Modify: `packages/providers/src/prompts/graphics.test.ts`
- Test (unchanged, must pass again): `apps/web/lib/graphic-code/check.test.ts` (`passes both of the prompt's worked examples`)

**Interfaces:**
- Consumes: `REMOTION_RULES` from `./remotion-rules` (Task 4); the scan's rules (Task 3), which both examples must pass; the preamble in the dry run (Task 2).
- Produces: a system prompt that lists `motion`, states the house motion rules and carries `REMOTION_RULES`; two examples written on the tokens.

- [ ] **Step 1: Write the failing prompt tests**

In `packages/providers/src/prompts/graphics.test.ts`:

Add to the imports:

```ts
import { REMOTION_RULES } from './remotion-rules'
```

In `it('states the sandbox: its arguments, every Remotion member and every prop', ...)`, replace the member `'Remotion.Easing',` with:

```ts
      'motion.ms',
      'motion.frames(',
      'motion.ease',
      'motion.spring',
      'motion.px.rise',
      'motion.scale.enter',
      'motion.stagger(',
      'motion.order',
```

Replace the whole test `offers no spring and prescribes the eased, no-overshoot entrance vocabulary (follow-up, 2026-10-12)` with:

```ts
  it('puts the motion on tokens: every curve, length and spring is named (decision 301)', () => {
    expect(rules).toContain(
      'motion: the house motion tokens, declared above your code and read-only.',
    )
    expect(rules).toContain(
      'Every interpolate carries easing: motion.ease.<name>, written inside the call: enter for arrivals, exit for departures, move for a reframe or the camera, emphasis for the one hero figure of the beat, linear for counters and progress only.',
    )
    expect(rules).toContain(
      'A spring is Remotion.spring({ frame, fps, delay, config: motion.spring.<name> }) and nothing else: settle by default (no overshoot), hero at most once per beat',
    )
    expect(rules).toContain('exits are shorter than entrances')
    expect(rules).toContain('A change within a beat is an exit, a motion.ms.gap pause, then an entrance.')
    expect(rules).toContain('A group of three or more elements staggers')
    expect(rules).toContain(
      'The hero finishes last: entrances follow motion.order, frame, title, body, hero, note.',
    )
    expect(rules).toContain('A beat gets one kind of entrance.')
    expect(rules).toContain(
      'It refuses Remotion.Easing in any form (the curves are motion.ease), an interpolate with no easing: motion.ease.<name> written inside the call, a spring other than Remotion.spring({ frame, fps, delay, config: motion.spring.<name> })',
    )
    expect(rules).not.toContain('Remotion.Easing.out(Remotion.Easing.poly(4))')
    expect(rules).not.toContain('16 to 24 px rise')
    for (const example of [GRAPHIC_EXAMPLE_TYPE, GRAPHIC_EXAMPLE_CHART]) {
      expect(example).not.toMatch(/\bEasing\b/)
      expect(example).toContain('easing: motion.ease.')
      expect(example).toContain('motion.frames(')
      expect(example).toContain('motion.ms.')
    }
    expect(GRAPHIC_EXAMPLE_TYPE).toContain('config: motion.spring.hero')
    expect(GRAPHIC_EXAMPLE_TYPE).toContain('motion.px.rise')
    expect(GRAPHIC_EXAMPLE_CHART).not.toContain('spring')
    expect(GRAPHIC_EXAMPLE_CHART).toContain('motion.stagger(')
  })

  it("carries Remotion's own rules, pinned to the vendored files (decision 301)", () => {
    expect(system).toContain(REMOTION_RULES)
    expect(system.indexOf(REMOTION_RULES)).toBeLessThan(system.indexOf('Example 1, a text-only beat.'))
  })
```

- [ ] **Step 2: Run the prompt tests to verify they fail**

Run: `pnpm --filter @boom-busters/providers exec vitest run src/prompts/graphics.test.ts`
Expected: FAIL on the three edited or new tests.

- [ ] **Step 3: Rewrite the two examples on the tokens**

In `packages/providers/src/prompts/graphics.ts`, replace the whole `GRAPHIC_EXAMPLE_TYPE` constant with:

```ts
export const GRAPHIC_EXAMPLE_TYPE = `// Kinetic type: the line builds word by word as it is spoken, the figure
// springs in on "1.9 billion" with the hero preset (one small overshoot, once
// in the beat), "never existed" strikes it through, and the finished frame
// holds to the end. Every length and every curve is a token.
const LINE_UNTIL_MS = 2400
const FIGURE_AT_MS = 2600
const CLOSING_AT_MS = 4400
const STRIKE_AT_MS = 5000

// A helper, called directly: an arrival, 0 to 1 over motion.ms.enter from atMs, held at 1.
function arrive(frame, fps, atMs) {
  return Remotion.interpolate(
    frame, [motion.frames(atMs, fps), motion.frames(atMs + motion.ms.enter, fps)], [0, 1],
    { easing: motion.ease.enter, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  )
}

// A helper, called directly: one word of the line, rising in as it is spoken.
function wordSpan(word, frame, fps, unit) {
  const enter = arrive(frame, fps, word.atMs)
  const rise = 'translateY(' + (1 - enter) * motion.px.rise * unit + 'px)'
  return (
    <span
      key={word.atMs}
      style={{ display: 'inline-block', marginRight: '0.25em', opacity: enter, transform: rise }}
    >
      {word.text}
    </span>
  )
}

function Graphic(props) {
  const frame = Remotion.useCurrentFrame()
  const { width, height, fps } = Remotion.useVideoConfig()
  const { colors, fonts } = props.brand
  const inset = props.safeArea
  const portrait = height > width
  const unit = Math.min(width, height) / 1080

  // The words said before the figure, each entering as it is spoken.
  const line = props.words.filter((word) => word.atMs < LINE_UNTIL_MS)
  // The hero figure: the one spring of the beat, from motion.scale.enter, settling at 1.
  const pop = Remotion.spring({
    frame, fps, delay: motion.frames(FIGURE_AT_MS, fps), config: motion.spring.hero,
  })
  const closing = arrive(frame, fps, CLOSING_AT_MS)
  // The strike draws across over motion.ms.draw on the emphasis curve.
  const strike = Remotion.interpolate(
    frame, [motion.frames(STRIKE_AT_MS, fps), motion.frames(STRIKE_AT_MS + motion.ms.draw, fps)], [0, 1],
    { easing: motion.ease.emphasis, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  )

  return (
    <Remotion.AbsoluteFill
      style={{
        paddingTop: inset.top, paddingRight: inset.right,
        paddingBottom: inset.bottom, paddingLeft: inset.left,
        justifyContent: 'center', gap: 28 * unit,
        alignItems: portrait ? 'center' : 'flex-start', textAlign: portrait ? 'center' : 'left',
      }}
    >
      <div
        style={{
          fontFamily: fonts.heading, fontSize: 72 * unit, lineHeight: 1.15,
          color: colors.textPrimary, maxWidth: portrait ? '100%' : '70%',
        }}
      >
        {line.map((word) => wordSpan(word, frame, fps, unit))}
      </div>
      <div
        style={{
          position: 'relative', fontFamily: fonts.numbers, fontSize: 220 * unit, lineHeight: 1,
          color: colors.accent, opacity: Math.min(1, pop),
          transform: 'scale(' + (motion.scale.enter + (1 - motion.scale.enter) * pop) + ')',
          transformOrigin: portrait ? 'center' : 'left center',
        }}
      >
        €1.9bn
        <div
          style={{
            position: 'absolute', left: 0, top: '52%', height: 14 * unit,
            width: strike * 100 + '%', backgroundColor: colors.semantic.collapse,
          }}
        />
      </div>
      <div
        style={{
          fontFamily: fonts.title, fontSize: 56 * unit, color: colors.semantic.collapse,
          opacity: closing, transform: 'translateY(' + (1 - closing) * motion.px.rise * unit + 'px)',
        }}
      >
        It had never existed.
      </div>
    </Remotion.AbsoluteFill>
  )
}`
```

Replace the whole `GRAPHIC_EXAMPLE_CHART` constant with:

```ts
export const GRAPHIC_EXAMPLE_CHART = `// A chart from props.data: the title and its subtitle stagger in, one bar
// per point draws on as its year is spoken, the annotation lands on its bar
// after the last one has grown, and the finished chart holds to the end.
// Every length and every curve is a token; the words keep their spoken times.

// When the narration names a point: the first word that starts with its label.
function spokenAt(point, index, words) {
  const said = words.find((word) => word.text.indexOf(point.x) === 0)
  return said ? said.atMs : 600 + index * 700
}

// A helper, called directly: 0 to 1 over lengthMs from atMs on the arrival curve, held at 1.
function arrive(frame, fps, atMs, lengthMs) {
  return Remotion.interpolate(
    frame, [motion.frames(atMs, fps), motion.frames(atMs + lengthMs, fps)], [0, 1],
    { easing: motion.ease.enter, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  )
}

// A helper, called directly: one bar with its value and, on the last, its note.
function bar(frame, fps, spec) {
  const { colors, fonts } = spec.brand
  const unit = spec.unit
  const grow = arrive(frame, fps, spec.atMs, motion.ms.draw)
  const noted = arrive(frame, fps, spec.noteAtMs, motion.ms.enter)
  const column = { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }
  return (
    <div key={spec.point.x} style={{ ...column, justifyContent: 'flex-end' }}>
      {spec.note ? (
        <div
          style={{
            fontFamily: fonts.title, fontSize: 34 * unit, marginBottom: 10 * unit,
            color: colors.semantic.collapse, opacity: noted,
            transform: 'translateY(' + (1 - noted) * motion.px.rise * unit + 'px)',
          }}
        >
          {spec.note}
        </div>
      ) : null}
      <div
        style={{
          fontFamily: fonts.numbers, fontSize: 40 * unit, marginBottom: 10 * unit,
          color: spec.color, opacity: grow,
        }}
      >
        {String(spec.point.y)}
      </div>
      <div
        style={{
          width: '60%', height: spec.share * grow * spec.plot,
          borderRadius: 6 * unit, backgroundColor: spec.color,
        }}
      />
      <div style={{ fontFamily: fonts.body, fontSize: 30 * unit, color: colors.textSecondary }}>
        {spec.point.x}
      </div>
    </div>
  )
}

function Graphic(props) {
  const frame = Remotion.useCurrentFrame()
  const { width, height, fps } = Remotion.useVideoConfig()
  const { colors, fonts } = props.brand
  const inset = props.safeArea
  const portrait = height > width
  const unit = Math.min(width, height) / 1080
  const series = props.data.series[0]
  const top = Math.max(...series.points.map((point) => point.y))
  const lands = series.points.map((point, index) => spokenAt(point, index, props.words))
  const last = series.points.length - 1
  const note = (props.data.annotations || [])[0]
  // The title arrives first; the subtitle one stagger step after it (motion.order: title, then body).
  const titleIn = arrive(frame, fps, 0, motion.ms.enter)
  const subtitleIn = arrive(frame - motion.stagger(1, fps), fps, 0, motion.ms.enter)
  const align = portrait ? 'center' : 'left'

  return (
    <Remotion.AbsoluteFill
      style={{
        paddingTop: inset.top, paddingRight: inset.right,
        paddingBottom: inset.bottom, paddingLeft: inset.left,
        justifyContent: 'center', gap: 24 * unit,
      }}
    >
      <div
        style={{
          fontFamily: fonts.heading, fontSize: 60 * unit, lineHeight: 1.1,
          color: colors.textPrimary, opacity: titleIn, textAlign: align,
        }}
      >
        {props.data.takeaway}
      </div>
      <div
        style={{
          fontFamily: fonts.body, fontSize: 28 * unit, color: colors.textSecondary,
          opacity: subtitleIn, textAlign: align,
        }}
      >
        {series.label + ', ' + series.unit}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 * unit }}>
        {series.points.map((point, index) =>
          bar(frame, fps, {
            brand: props.brand, unit: unit, point: point,
            share: point.y / top, plot: (portrait ? 0.32 : 0.34) * height, atMs: lands[index],
            color: index === last ? colors.accent : Remotion.withAlpha(colors.textSecondary, 0.55),
            note: note && note.atX === point.x ? note.text : null, noteAtMs: lands[last] + 1200,
          }),
        )}
      </div>
    </Remotion.AbsoluteFill>
  )
}`
```

- [ ] **Step 4: Rewrite the prompt's sandbox, refusals and motion rules**

In `SYSTEM` in `packages/providers/src/prompts/graphics.ts`:

Add `REMOTION_RULES` to the file's imports:

```ts
import { REMOTION_RULES } from './remotion-rules'
```

Replace the bullet

```
- Remotion.Easing: Remotion's easing functions, such as
  Remotion.Easing.out(Remotion.Easing.poly(4)), Remotion.Easing.inOut(Remotion.Easing.cubic)
  and Remotion.Easing.bezier(0.2, 0, 0, 1).
```

with

```
- Remotion.spring({frame, fps, delay, config}): Remotion's spring, 0 to 1 from the delay;
  its config is always a token (below).
- motion: the house motion tokens, declared above your code and read-only. motion.ms
  {micro 120, enter 450, exit 300, reveal 550, draw 700, count 1000, move 900, gap 120},
  lengths in milliseconds. motion.frames(ms, fps), a length in whole frames, at least 1.
  motion.ease {enter, exit, move, emphasis, linear}, the only curves. motion.spring {settle,
  hero, snap}, the only spring configs. motion.px.rise (20 at 1080p; multiply by your unit).
  motion.scale.enter (0.96). motion.stagger(index, fps), the frame offset of the index-th
  item of a group. motion.order ['frame', 'title', 'body', 'hero', 'note'], the entrance
  order.
```

Replace the two lines

```
It refuses spring and Easing.elastic, Easing.bounce and Easing.back as well: they overshoot,
and the house settles without a bounce.
```

with

```
It refuses Remotion.Easing in any form (the curves are motion.ease), an interpolate with no
easing: motion.ease.<name> written inside the call, a spring other than
Remotion.spring({ frame, fps, delay, config: motion.spring.<name> }), Remotion['...'] or
motion['...'], an assignment to motion, and a motion binding of your own.
```

In the Craft list, replace the bullet that begins `- Entrances are eased interpolations that settle at their mark` (through `and a beat gets one kind of entrance.`) with:

```
- Entrances, exits and moves come from the tokens, in the house motion below. Nothing
  passes its mark, nothing spins.
```

Then insert, between the Craft list's last bullet (`- A chart draws every point of props.data, ...`) and `Example 1, a text-only beat.`, this block (a blank line before and after it):

```
The house motion. The first three are checked; the rest are judged on the board:
- Every interpolate carries easing: motion.ease.<name>, written inside the call: enter for
  arrivals, exit for departures, move for a reframe or the camera, emphasis for the one
  hero figure of the beat, linear for counters and progress only. For several keyframes
  pass an array of them, one fewer than the keyframes. Never pass the options through a
  variable: the check reads the call.
- A spring is Remotion.spring({ frame, fps, delay, config: motion.spring.<name> }) and
  nothing else: settle by default (no overshoot), hero at most once per beat (one small
  overshoot, for the figure the beat is about), snap for small things. A spring is for an
  arrival that should feel physical; ease everything else.
- Lengths come from motion.ms: an entrance is motion.ms.enter, an exit motion.ms.exit
  (exits are shorter than entrances), a wipe motion.ms.reveal, a bar or a line drawn on
  motion.ms.draw, a count motion.ms.count, a move motion.ms.move. A change within a beat
  is an exit, a motion.ms.gap pause, then an entrance. Convert with motion.frames(ms, fps).
- A fade rises motion.px.rise times your unit; a figure scales in from motion.scale.enter,
  never from 0; a wipe is a clip-path.
- A group of three or more elements staggers: the index-th item enters motion.stagger(index,
  fps) frames after the first. Words on the narration keep their spoken times.
- The hero finishes last: entrances follow motion.order, frame, title, body, hero, note.
- A beat gets one kind of entrance. Emphasis on a word is a colour or weight change over
  motion.ms.micro, with interpolate.

${REMOTION_RULES}
```

Update the comment on `GRAPHIC_EXAMPLE_TYPE` ("Its helper is a plain function called directly, as the prompt tells the model to write it.") to add: "It is written on the tokens (decision 301) and shows the one spring of a beat, the hero preset on the figure."

- [ ] **Step 5: Run the prompt tests, then the web check of the examples**

Run: `pnpm --filter @boom-busters/providers exec vitest run src/prompts/graphics.test.ts src/prompts/remotion-rules.test.ts`
Expected: PASS. The `writes no dash a reader would see` test covers the new text; if it fails, find the dash and recast the sentence.

Run: `pnpm --filter @boom-busters/web exec vitest run lib/graphic-code/check.test.ts`
Expected: PASS, including `passes both of the prompt's worked examples`. If the type example is refused for a frame outside the safe area, the hero spring's overshoot has pushed the figure's box out: lower nothing in the tokens; instead clamp the scale in the example with `Math.min(1.02, pop)` in the `transform` and say so in the example's comment. If it is refused for a bare interpolate, the scan found a call whose text lacks `easing: motion.ease.`; read the refusal, which names the call.

- [ ] **Step 6: Run both packages' full suites, the typechecks and the format check**

Run: `pnpm --filter @boom-busters/providers test && pnpm --filter @boom-busters/web exec vitest run lib/graphic-code lib/graphic-design.test.ts`
Expected: PASS.

Run: `pnpm --filter @boom-busters/providers typecheck && pnpm exec prettier --check packages/providers/src/prompts/graphics.ts packages/providers/src/prompts/graphics.test.ts`
Expected: no errors, all formatted.

- [ ] **Step 7: Commit**

```bash
git add packages/providers/src/prompts/graphics.ts packages/providers/src/prompts/graphics.test.ts
git commit -m "feat(providers): the designer's prompt names the motion tokens, the house motion and Remotion's rules; both examples on the tokens (decision 301)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The fixture on the tokens

**Files:**
- Modify: `packages/compositions/src/fixtures/graphic-code.ts` (`GRAPHIC_CODE_SOURCE`, `GRAPHIC_CODE_PAYLOAD.compiled`)
- Modify: `packages/providers/src/prompts/graphic-code-fixture.ts` (`GRAPHIC_CODE_FIXTURE_SOURCE`, the same text)
- Modify: `packages/compositions/src/components/GraphicCode.test.tsx` (the `compiled` assertion)
- Modify: `apps/web/lib/graphic-code/dry-run.test.ts` (the `dryRun` helper prepends the preamble)
- Goldens: `packages/compositions/src/snapshot/golden/GraphicCodeWide.png`, `GraphicCodeTall.png` (regenerated only if the snapshot test fails)

**Interfaces:**
- Consumes: `MOTION_PREAMBLE` (Task 1); the scan's rules (Task 3), which the fixture must pass as the mock designer's answer.
- Produces: a fixture whose every `interpolate` carries a token curve and whose lengths are `motion.ms`; `GRAPHIC_CODE_PAYLOAD.compiled` is `${MOTION_PREAMBLE}\n${GRAPHIC_CODE_SOURCE}`. `mockGraphicCode` and `FIXTURE_FIGURE` are unchanged.

- [ ] **Step 1: Write the failing tests**

In `packages/compositions/src/components/GraphicCode.test.tsx`, add to the imports:

```ts
import { MOTION_PREAMBLE } from '../lib/motion-tokens'
```

and in `it('is plain JavaScript that declares Graphic in under 120 lines, with no colour of its own', ...)` replace

```ts
    expect(GRAPHIC_CODE_PAYLOAD.compiled).toBe(GRAPHIC_CODE_SOURCE)
```

with

```ts
    expect(GRAPHIC_CODE_PAYLOAD.compiled).toBe(`${MOTION_PREAMBLE}\n${GRAPHIC_CODE_SOURCE}`)
    // On the tokens (decision 301): every curve and length a token, no Easing of its own.
    expect(GRAPHIC_CODE_SOURCE).not.toMatch(/\bEasing\b/)
    expect(GRAPHIC_CODE_SOURCE.match(/Remotion\.interpolate\(/g)).toHaveLength(4)
    expect(GRAPHIC_CODE_SOURCE.match(/easing: motion\.ease\.(enter|emphasis|linear)\b/g)).toHaveLength(4)
```

In `apps/web/lib/graphic-code/dry-run.test.ts`, add to the imports:

```ts
import { MOTION_PREAMBLE } from '@boom-busters/compositions/motion-tokens'
```

and change the `dryRun` helper's `compiled: compiled(source),` to

```ts
    // As `graphicCodeIssue` runs it: the house motion preamble first (decision 301).
    compiled: `${MOTION_PREAMBLE}\n${compiled(source)}`,
```

In `apps/web/lib/graphic-code/check.test.ts`, add `GRAPHIC_CODE_FIXTURE_SOURCE` to the import from `@boom-busters/providers` (it is re-exported from `graphics.ts`; if the package index does not export it, import `GRAPHIC_CODE_SOURCE` from `@boom-busters/compositions/graphic-code-fixture` instead, which is the same text) and add this test at the end of `describe('graphicCodeIssue (decision 295)', ...)`:

```ts
  it("passes the fixture, the mock designer's answer, under the preamble (decision 301)", () => {
    const result = graphicCodeIssue(
      {
        title: 'Raised in one round',
        facts: [{ text: '$4bn', claim: 1 }],
        source: GRAPHIC_CODE_FIXTURE_SOURCE,
      },
      CONTEXT,
      slot(GRAPHIC),
    )
    expect(result).not.toHaveProperty('issue')
    expect(result).toHaveProperty('code')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @boom-busters/compositions exec vitest run src/components/GraphicCode.test.tsx`
Expected: FAIL on the `compiled` assertion and the `easing: motion.ease` count.

Run: `pnpm --filter @boom-busters/web exec vitest run lib/graphic-code/check.test.ts`
Expected: FAIL on the new fixture test: the fixture still uses `Remotion.Easing`, which the scan refuses since Task 3.

Run: `pnpm --filter @boom-busters/web exec vitest run lib/graphic-code/dry-run.test.ts`
Expected: PASS (the preamble is inert for sources that do not read it); this edit is for the fixture, next.

- [ ] **Step 3: Rewrite the fixture, in both copies**

In `packages/compositions/src/fixtures/graphic-code.ts`, replace the body of `GRAPHIC_CODE_SOURCE` from `const last = Math.max(1, video.durationInFrames - 1)` to the line before `return h(` with:

```js
  const last = Math.max(1, video.durationInFrames - 1)
  const clamp = 'clamp'

  // The title arrives over motion.ms.enter; the figure counts up to $4bn over motion.ms.count.
  const titleIn = Remotion.interpolate(frame, [0, motion.frames(motion.ms.enter, video.fps)], [0, 1], {
    easing: motion.ease.enter,
    extrapolateLeft: clamp,
    extrapolateRight: clamp,
  })
  const countFrames = motion.frames(motion.ms.count, video.fps)
  const landAt = Math.min(9, Math.max(0, last - countFrames))
  const count = Remotion.interpolate(frame, [landAt, landAt + countFrames], [0, 1], {
    easing: motion.ease.emphasis,
    extrapolateLeft: clamp,
    extrapolateRight: clamp,
  })
  const figure = '$' + Math.round(count * 40) / 10 + 'bn'

  // The underline sweeps from the count to the slot's end, so the graphic
  // never sits still; a second line rises in halfway through.
  const sweepFrom = landAt + countFrames
  const sweep = Remotion.interpolate(frame, [sweepFrom, Math.max(sweepFrom + 1, last)], [0, 1], {
    easing: motion.ease.linear,
    extrapolateLeft: clamp,
    extrapolateRight: clamp,
  })
  const half = Math.round(last / 2)
  const nextIn = Remotion.interpolate(frame, [half, half + motion.frames(motion.ms.enter, video.fps)], [0, 1], {
    easing: motion.ease.enter,
    extrapolateLeft: clamp,
    extrapolateRight: clamp,
  })
```

and, in the last `h('div', ...)` of the fixture, replace `transform: 'translateY(' + (1 - nextIn) * 24 * unit + 'px)',` with `transform: 'translateY(' + (1 - nextIn) * motion.px.rise * unit + 'px)',`.

The line `const figure = '$' + Math.round(count * 40) / 10 + 'bn'` must stay exactly as it is: `mockGraphicCode` swaps that expression by its text.

Change `GRAPHIC_CODE_PAYLOAD`'s

```ts
  // Plain JavaScript runs as written.
  compiled: GRAPHIC_CODE_SOURCE,
```

to

```ts
  // Plain JavaScript runs as written, under the house motion preamble (decision 301).
  compiled: `${MOTION_PREAMBLE}\n${GRAPHIC_CODE_SOURCE}`,
```

and add `import { MOTION_PREAMBLE } from '../lib/motion-tokens'` to the file's imports. Update the file's header comment: after "A title fades in, the figure counts up to $4bn over the first second" add "(every length and curve a token, decision 301)".

Then copy the whole new source text, character for character, into `packages/providers/src/prompts/graphic-code-fixture.ts` as `GRAPHIC_CODE_FIXTURE_SOURCE` (the test `graphic-code-fixture.test.ts` reads the compositions file off disk and holds the two equal).

- [ ] **Step 4: Run the fixture tests across the three packages**

Run: `pnpm --filter @boom-busters/providers exec vitest run src/prompts/graphic-code-fixture.test.ts src/prompts/graphics.test.ts`
Expected: PASS (the fixture is still a template literal with no backslash, backtick or `${`, and `mockGraphicCode` still finds its figure).

Run: `pnpm --filter @boom-busters/compositions exec vitest run src/components/GraphicCode.test.tsx src/lib/graphic-code.test.ts`
Expected: PASS.

Run: `pnpm --filter @boom-busters/web exec vitest run lib/graphic-code lib/graphic-design.test.ts`
Expected: PASS: the dry run passes the fixture under the preamble, and `graphic-design.test.ts` runs the mock designer's answer through the real scan.

- [ ] **Step 5: The goldens**

Run: `pnpm --filter @boom-busters/compositions test`
Expected: PASS. The goldens are taken at frame 150 (5 s), when the title, the figure, the sweep and the second line have all arrived, so the picture should be the same as before: only the second line's rise changed (24 px to 20 px) and it has finished by then.

If `GraphicCodeWide` or `GraphicCodeTall` fails the pixel compare, re-run the package alone once more (the goldens flake under load). If it fails again, regenerate:

Run: `cd packages/compositions && REGEN_GOLDEN=1 pnpm exec vitest run src/snapshot/render.test.ts && cd ../..`

Then open both PNGs with the Read tool (`packages/compositions/src/snapshot/golden/GraphicCodeWide.png`, `GraphicCodeTall.png`) and confirm by eye: the title "Raised in one round" in the secondary colour, "$4bn" large in the accent colour, an accent underline part-way across, and "Then the next step" below. Record what you saw in your report; a golden nobody looked at is not a golden.

- [ ] **Step 6: Typecheck and format**

Run: `pnpm --filter @boom-busters/compositions typecheck && pnpm --filter @boom-busters/providers typecheck && pnpm --filter @boom-busters/web typecheck`
Expected: no errors.

Run: `pnpm exec prettier --check packages/compositions/src/fixtures/graphic-code.ts packages/providers/src/prompts/graphic-code-fixture.ts packages/compositions/src/components/GraphicCode.test.tsx apps/web/lib/graphic-code/dry-run.test.ts`
Expected: all formatted. Prettier does not reformat the inside of a template literal, so the fixture text stays as written in both copies.

- [ ] **Step 7: Commit**

```bash
git add packages/compositions/src/fixtures/graphic-code.ts packages/providers/src/prompts/graphic-code-fixture.ts packages/compositions/src/components/GraphicCode.test.tsx apps/web/lib/graphic-code/dry-run.test.ts packages/compositions/src/snapshot/golden/GraphicCodeWide.png packages/compositions/src/snapshot/golden/GraphicCodeTall.png
git commit -m "feat: the fixture graphic on the motion tokens, under the preamble everywhere it runs (decision 301)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(Leave the two PNGs out of `git add` if they were not regenerated.)

---

### Task 7: PROGRESS, the whole suite and the e2e

**Files:**
- Modify: `PROGRESS.md` (a new decision entry after 300)

**Interfaces:**
- Consumes: everything above.
- Produces: the record of decision 301, and a green tree.

- [ ] **Step 1: Write the PROGRESS entry**

In `PROGRESS.md`, after the decision 300 entry (the last numbered entry; check that 301 is still free with `git fetch origin && git show origin/master:PROGRESS.md | grep -c "^301\. "`, expecting `0`; if it is taken, use the next free number here and in the spec and plan titles), add:

```markdown
301. **The motion comes from tokens** (2026-10-14, owner: "Please review it
     and action the layers and resources to build into the motion graphics
     engine"; rulings: tokens and rules first, exemplars next; tokens only;
     the tokens baked into each design; spring back as presets to compare
     on the board). The research the owner commissioned on reference
     libraries for a Remotion motion engine reaches the same conclusion the
     spring follow-up of 2026-10-12 did: the "AI look" is timing, and
     timing is numbers. A prompt rule is followed some of the time; a token
     the code must use is followed every time.
     What shipped. `packages/compositions/src/lib/motion-tokens.ts` holds
     the house motion once: `motion.ms` (micro 120, enter 450, exit 300,
     reveal 550, draw 700, count 1000, move 900, gap 120), `motion.frames`,
     five curves (`enter` out poly 4, `exit` in cubic, `move` in-out cubic,
     `emphasis` out exp, `linear`), three spring presets (`settle` damping
     200, `hero` damping 14 stiffness 120, `snap` damping 20 stiffness 200),
     `px.rise` 20, `scale.enter` 0.96, `stagger` 75 ms per item within
     600 ms, and `order`. The module is Remotion-free (the Inngest route
     cannot import `remotion`); `MOTION` with the real `Easing` is exported
     from `graphic-code.ts`. `MOTION_PREAMBLE` declares the same object as a
     frozen `motion` constant; `graphicCodeIssue` prepends it to the
     compiled code between the scan and the dry run and stores the result
     with `motion: 1`, so a design carries the values it was checked with
     and the sandbox contract is unchanged: no Remotion or broker deploy.
     The scan refuses `Easing` in any form, an `interpolate` whose call
     text has no `easing: motion.ease.<name>`, a spring that is not
     `Remotion.spring` with `config: motion.spring.<name>`, bracket access
     to the sandbox, and a `motion` binding or assignment of the design's
     own. The prompt lists the tokens, states the house motion (the first
     three rules checked, the rest judged on the board) and carries
     excerpts of Remotion's own `timing.md` and `sequencing.md`, each
     vendored line pinned by a test to `.agents/skills/remotion-markup/`
     so an `npx skills` upgrade fails the test rather than drifting the
     prompt. `transitions.md` and `text-highlights.md` are not excerpted:
     they rest on `@remotion/transitions` and `@remotion/rough-notation`,
     which the sandbox does not expose. Both worked examples and the
     fixture are on the tokens; the type example shows the one spring of a
     beat, the hero preset on the figure.
     Decisions made where the spec left room: `motionTokens(Easing)` builds
     the typed object rather than the module importing `Easing`, for the
     Inngest route; the house's edits to the excerpts are marked lines in
     data rather than a single recorded edit, since the clamped examples
     also needed a token curve to pass the scan; `Series` is left out of
     the sequencing excerpt because the scope has no `Series`; an
     `interpolate` whose options arrive through a variable is refused,
     since the scan reads the call text, and the prompt says so. Not
     checked, and said so in the spec: simultaneous entrances and the
     entrance order, which the 250 ms dry-run samples cannot see; the
     owner judges those on the board.
     Open for the owner: redesign one graphic, then compare a `settle`
     spring against the eased entrance on the same beat and `hero` on its
     figure; tune one number in `motion-tokens.ts` at a time. Sub-project 2
     is the exemplar corpus from the two MIT-licensed template repos with
     retrieval per request; Lottie waits for a film that needs it.
     Shipping: a Vercel deploy, then `PUT /api/inngest`. No migration. The
     number 301 is checked against `origin/master` at the merge.
```

- [ ] **Step 2: Run the whole suite, lint, typecheck and format**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors, no warnings.

Run: `pnpm test` (with Docker Desktop running for the web app's database suites)
Expected: PASS. If a compositions golden fails under the full run, re-run `pnpm --filter @boom-busters/compositions test` alone before believing it.

Run: `git ls-files -z | xargs -0 -n 80 pnpm exec prettier --check`
Expected: all formatted.

- [ ] **Step 3: Run the two e2e specs that render a graphic (mock mode)**

Make sure port 3100 is free (`netstat -ano | findstr :3100` on Windows; kill a leftover dev server). Then, from the e2e package:

Run: `cd e2e && pnpm exec playwright test tests/server-render.spec.ts tests/visual-plan.spec.ts; cd ..`
Expected: PASS. The mock designer's answer (the fixture) goes through the real compile, scan and dry run under the preamble and is drawn by the board's Player. Give this command a 600 000 ms timeout.

- [ ] **Step 4: Commit**

```bash
git add PROGRESS.md
git commit -m "docs(progress): decision 301, the motion comes from tokens

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## After the plan

Not part of any task; the owner's calls:

- Merge `motion-tokens` into `master` after the final review, with the number re-checked against `origin/master`; the owner pushes (`git push origin master`).
- Deploy: the Vercel Git build fires on the push; then `curl -X PUT https://boom-busters-web-rho.vercel.app/api/inngest`. No Lambda redeploy.
- On the board: Redesign one graphic and compare `settle`, `hero` and the eased entrance on the same beat.
