# Motion identity and the channel-agnostic designer: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every channel-taste value out of the graphics designer's prompt and tokens into a per-channel motion identity in settings, with the house values as defaults, so Boom & Busters' output is unchanged until the owner edits the new Motion tab.

**Architecture:** A `MotionIdentitySchema` in `packages/schemas` (stored in `channels.settings.motion`, every field defaulted) resolves to the numbers the tokens preamble is built from (`motionNumbers`) and to the words the prompt's craft slots are filled with. The checks take the identity as an option and the dry run takes the still limit as an input. `techniqueFor` skips techniques a channel has switched off, with two last resorts that cannot be. A Motion tab edits the identity through the existing settings patch.

**Tech Stack:** TypeScript, Zod 4, Remotion `Easing`, Next.js app router server actions, vitest with `toMatchFileSnapshot` lift fixtures, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-04-channel-motion-references-design.md`, sections 2, 4, 5.4, 6, 8.1 to 8.3, 12.3, 13. This is plan 1 of 4; references and readings, the critic, and derivation are the other three.

## Global Constraints

- No channel name, niche word or taste number in code beyond the house defaults named in the spec (section 3, anti-goals).
- Every identity field has the house default, so an old settings row reads unchanged (spec 8.1).
- `MOTION_EASE_NAMES`, `MOTION_SPRING_NAMES` and the scan do not change; every stored design still passes (spec 8.1).
- `MOTION_VERSION` becomes 2 and the preamble records the channel values (spec 8.1).
- The identity lives in `channels.settings.motion`, beside `brandKit`, never inside `BrandKitStoredSchema` or `BrandKitTokensSchema` (spec 13).
- `kinetic-word-stack` and `bar-chart` cannot be switched off (spec 8.3).
- CLAUDE.md: a branch (`motion-identity`), tests with the code, `pnpm lint` and `pnpm format:check` at zero warnings before every commit, PROGRESS.md decision at the end, no secrets, button-first UI.
- Written output in prompts and UI copy carries no em or en dash (the prompt test "writes no dash a reader would see" enforces it).

## Review Focus

1. A saved identity whose `never` and `allow` lists share a phrase: refused at the edge with the phrase named, never stored (Task 1 test "refuses a phrase in both lists").
2. A `stillMaxMs` below `changeEveryMs`: refused at the edge, since the dry run would refuse every design the cadence asks for (Task 1 test "refuses a still limit under the cadence").
3. A `techniques` list missing a last resort, or empty: refused at the edge (Task 1 test "keeps the two last resorts in the list").
4. A design stored with `motion: 1` on a channel whose identity now differs: its stored `compiled` carries its own preamble, so the board and the render still play it unchanged, and a redesign is not told it is pre-token (Task 5 test "says nothing about the tokens to a design stored with motion 1").
5. A settings row saved before this change (no `motion` key): reads as the house identity, and the Motion tab shows the house values (Task 1 test "reads a row without motion as the house identity"; Task 7 test "shows the house values for a channel that never set them").

---

### Task 1: The identity schema in settings

**Files:**
- Create: `packages/schemas/src/techniques.ts`
- Create: `packages/schemas/src/motion-identity.ts`
- Modify: `packages/schemas/src/settings.ts:618-680` (SettingsSchema, SettingsPatchSchema, DEFAULT_SETTINGS)
- Modify: `packages/schemas/src/index.ts` (export both new modules)
- Test: `packages/schemas/src/motion-identity.test.ts`

**Interfaces:**
- Produces: `TECHNIQUES` (the eighteen keys, moved here verbatim from `packages/providers/src/exemplars/manifest.ts:12`), `Technique`, `LAST_RESORT_TECHNIQUES = ['kinetic-word-stack', 'bar-chart'] as const`.
- Produces: `MotionIdentitySchema`, `MotionIdentity` (its inferred type), `DEFAULT_MOTION_IDENTITY: MotionIdentity`, `HOUSE_NEVER: readonly string[]` (the current ban list, verbatim: "glows", "particle bursts", "lens flares", "camera shake", "RGB split", "a crossfade from one whole layout to another", "decorative gradients", "drop shadows for depth"), `HOUSE_CAMERA_RULE` ("a slow push over the whole slot, 2 to 4% on motion.ease.move, anchored so nothing leaves the safe area"), `resolveMotionIdentity(settings: Settings): MotionIdentity` (returns the stored identity with `never` filtered by `allow`), `motionNeverList(identity): string[]`.
- `Settings.motion`, `SettingsPatch.motion` (via `patchSection(MotionIdentitySchema)`), `DEFAULT_SETTINGS.motion = DEFAULT_MOTION_IDENTITY`.

Schema fields and bounds (spec 8.1): `signatureEase` enum `soft | crisp | gentle` default `soft`; `ms` object of optional ints 40 to 3000 for `enter, exit, reveal, draw, count, move, gap`, default `{}`; `overshoot` enum `none | hair | welcome` default `hair`; `entrance` enum `rise | fade | scale | wipe | slide` default `rise`; `changeEveryMs` int 500 to 10000 default 1500; `stillMaxMs` int 1000 to 20000 default 6000; `cameraRule` string max 200 default `HOUSE_CAMERA_RULE`; `blurFollowsSpeed` boolean default true; `threeD` enum `never | whenMeaningful | welcome` default `whenMeaningful`; `never` array of trimmed strings 1 to 60 chars, max 16, default `HOUSE_NEVER`; `allow` same shape, default `[]`; `styleGuideMd` string max 4000 default `''`; `techniques` array of `Technique`, default all eighteen; `chartsConventional` boolean default true. Refinements: `stillMaxMs >= changeEveryMs`; no phrase (case-insensitive, trimmed) in both `never` and `allow`; `techniques` contains both last resorts.

- [ ] **Step 1: Write the failing tests** in `motion-identity.test.ts`:

```ts
it('reads a row without motion as the house identity', () => {
  expect(SettingsSchema.parse({ ...DEFAULT_SETTINGS, motion: undefined }).motion).toEqual(DEFAULT_MOTION_IDENTITY)
})
it('refuses a phrase in both lists', () => {
  const r = MotionIdentitySchema.safeParse({ never: ['Glows'], allow: ['glows '] })
  expect(r.success).toBe(false); expect(r.error!.issues[0]!.message).toContain('glows')
})
it('refuses a still limit under the cadence', () => {
  expect(MotionIdentitySchema.safeParse({ changeEveryMs: 2000, stillMaxMs: 1500 }).success).toBe(false)
})
it('keeps the two last resorts in the list', () => {
  expect(MotionIdentitySchema.safeParse({ techniques: ['stat-counter'] }).success).toBe(false)
  expect(MotionIdentitySchema.safeParse({ techniques: [] }).success).toBe(false)
})
it('resolves allow against never', () => {
  const settings = { ...DEFAULT_SETTINGS, motion: { ...DEFAULT_MOTION_IDENTITY, allow: ['glows'] } }
  expect(resolveMotionIdentity(settings).never).not.toContain('glows')
})
it('accepts a motion patch and leaves an absent key absent', () => {
  expect(SettingsPatchSchema.parse({ motion: { overshoot: 'none' } }).motion).toEqual({ overshoot: 'none' })
})
```

- [ ] **Step 2: Run them**: `cd packages/schemas && pnpm exec vitest run motion-identity`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `techniques.ts`, `motion-identity.ts`, wire `settings.ts` and the barrel. In `providers/src/exemplars/manifest.ts` replace the local `TECHNIQUES` with `export { TECHNIQUES } from '@boom-busters/schemas'` and `export type { Technique }` so nothing else moves.
- [ ] **Step 4: Run** `pnpm exec vitest run motion-identity settings` in `packages/schemas` and `pnpm -r typecheck`. Expected: PASS, no type errors.
- [ ] **Step 5: Commit**: `git add packages/schemas packages/providers/src/exemplars/manifest.ts && git commit -m "feat(schemas): a per-channel motion identity in settings, house values as defaults"`.

### Task 2: Tokens built from the identity

**Files:**
- Modify: `packages/compositions/src/lib/motion-tokens.ts` (whole module)
- Modify: `packages/compositions/src/lib/graphic-code.ts:45` (`MOTION` unchanged in value)
- Test: `packages/compositions/src/lib/motion-tokens.test.ts`

**Interfaces:**
- Consumes: `MotionIdentity`, `DEFAULT_MOTION_IDENTITY` from `@boom-busters/schemas`.
- Produces: `MotionNumbers { ms: typeof MOTION_MS; spring: typeof MOTION_SPRING; px: typeof MOTION_PX; scale: typeof MOTION_SCALE; easeSet: 'soft' | 'crisp' | 'gentle' }`; `motionNumbers(identity: MotionIdentity): MotionNumbers`; `HOUSE_NUMBERS = motionNumbers(DEFAULT_MOTION_IDENTITY)`; `motionTokens(easing, numbers = HOUSE_NUMBERS): MotionTokens`; `motionPreamble(numbers = HOUSE_NUMBERS): string`; `MOTION_PREAMBLE = motionPreamble()` kept for existing imports; `MOTION_VERSION = 2`.

Mapping (spec 8.1): `ms` is `MOTION_MS` overlaid with `identity.ms`. `overshoot`: `none` makes `hero` and `snap` equal `settle` (`{damping: 200}`); `hair` keeps the house; `welcome` sets `hero {damping: 10, stiffness: 120}` and `snap {damping: 14, stiffness: 200}`. `entrance`: `rise` keeps `px.rise 20, scale.enter 0.96`; `fade`, `wipe`, `slide` set `px.rise 0`; `scale` sets `px.rise 0, scale.enter 0.9`. Curve sets, for `enter` and `move` only: `soft` = `out(poly(4))`, `inOut(cubic)`; `crisp` = `out(exp)`, `inOut(poly(4))`; `gentle` = `out(sin)`, `inOut(sin)`. The preamble writes the chosen set's two `Remotion.Easing` expressions as text; `exit`, `emphasis`, `linear` unchanged.

- [ ] **Step 1: Write the failing tests** (keep the existing six, add):

```ts
it('builds the house preamble from the house identity, at version 2', () => {
  expect(motionPreamble()).toBe(MOTION_PREAMBLE)
  expect(MOTION_PREAMBLE).toContain('version 2')
})
it('writes a channel overshoot of none as critically damped hero and snap', () => {
  const n = motionNumbers({ ...DEFAULT_MOTION_IDENTITY, overshoot: 'none' })
  expect(n.spring.hero).toEqual({ damping: 200 }); expect(n.spring.snap).toEqual({ damping: 200 })
})
it('declares the same curves in both forms for every curve set', () => { /* for each of soft, crisp, gentle: sample typed vs evaluated preamble at ten points, as the existing curves test does */ })
it('overlays a channel length and an entrance of scale', () => {
  const n = motionNumbers({ ...DEFAULT_MOTION_IDENTITY, ms: { enter: 900 }, entrance: 'scale' })
  expect(n.ms.enter).toBe(900); expect(n.ms.exit).toBe(300); expect(n.px.rise).toBe(0); expect(n.scale.enter).toBe(0.9)
})
```

- [ ] **Step 2: Run** `cd packages/compositions && pnpm exec vitest run motion-tokens`. Expected: FAIL on `motionPreamble`.
- [ ] **Step 3: Implement** the three functions; `MOTION_PREAMBLE` becomes `motionPreamble()`; the fixture at `src/fixtures/graphic-code.ts:138` keeps importing `MOTION_PREAMBLE`.
- [ ] **Step 4: Run** `pnpm exec vitest run` in `packages/compositions` (snapshots that embed the preamble text, if any, change only by the version line; regenerate with `-u` and name the files in the commit). Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "feat(compositions): motion tokens built from a channel identity, preamble version 2"`.

### Task 3: The checks take the identity

**Files:**
- Modify: `apps/web/lib/graphic-code/dry-run.ts:127-135, 314-318, 432` (DryRunInput.stillMaxMs, markupIssue)
- Modify: `apps/web/lib/graphic-code/check.ts:40-47, 132-200` (options, preamble, still limit)
- Test: `apps/web/lib/graphic-code/dry-run.test.ts`, `apps/web/lib/graphic-code/check.test.ts`

**Interfaces:**
- Produces: `DryRunInput.stillMaxMs?: number` (default `GRAPHIC_STILL_MAX_MS`); `graphicCodeIssue(answer, context, slot, options: { motion?: MotionIdentity } = {})`: the preamble is `motionPreamble(motionNumbers(options.motion ?? DEFAULT_MOTION_IDENTITY))`, the dry run gets `stillMaxMs: motion.stillMaxMs`, the stored `code.motion` is `MOTION_VERSION`.
- Every existing caller (`graphic-design-core.ts`, `graphic-design.ts`, `scripts/check-exemplar.ts`, `scripts/translate-exemplars.ts`, `exemplars.test.ts`) compiles unchanged.

- [ ] **Step 1: Write the failing tests**:

```ts
// dry-run.test.ts
it('refuses a still longer than the limit it is given', () => { /* a graphic that changes at 0 and 2.5 s then holds 4 s: issue null at 6000, "nothing changes between" at 3000 */ })
// check.test.ts
it('stores the compiled code with the channel preamble and version 2', () => {
  const r = graphicCodeIssue(PASSING, context, slot, { motion: { ...DEFAULT_MOTION_IDENTITY, ms: { enter: 900 } } })
  expect('code' in r && r.code.compiled).toContain('"enter":900'); expect('code' in r && r.code.motion).toBe(2)
})
it('refuses on the channel still limit', () => { /* same graphic as the dry-run test, { motion: { ...DEFAULT_MOTION_IDENTITY, changeEveryMs: 500, stillMaxMs: 3000 } } */ })
```

- [ ] **Step 2: Run** `cd apps/web && pnpm exec vitest run dry-run check`. Expected: FAIL.
- [ ] **Step 3: Implement.** `markupIssue(samples, size, stillMaxMs)`; thread the option; the `compiled` string's preamble comes from `motionPreamble`.
- [ ] **Step 4: Run** `pnpm exec vitest run dry-run check exemplars graphic-design` in `apps/web`. Expected: PASS (the corpus test runs every exemplar through version 2 and passes, since the house numbers are unchanged).
- [ ] **Step 5: Commit**: `git commit -m "feat(web): the graphic checks take the channel motion identity"`.

### Task 4: techniqueFor skips switched-off techniques

**Files:**
- Modify: `packages/providers/src/exemplars/technique.ts:13-30, 175-230`
- Test: `packages/providers/src/exemplars/technique.test.ts`

**Interfaces:**
- Produces: `TechniqueInput.techniques?: readonly Technique[]` (absent means all). The steer wins regardless (spec 12.3). Each rule yields its technique only when in use or a last resort; otherwise the next rule is tried, ending at the last resort for the type. `chartTechnique` returns candidates in order (`racing-chart, comparison-chart, bar-chart`; `line-chart, bar-chart`; `comparison-chart, bar-chart`) and the first in use wins.

- [ ] **Step 1: Write the failing tests**:

```ts
it('skips a switched-off technique and takes the next rule (spec 8.3)', () => {
  const base = { type: 'graphic' as const, intent: 'The bank lost 70% of its deposits', description: '', coversText: '', logos: [] }
  expect(techniqueFor({ ...base, techniques: ['kinetic-word-stack', 'bar-chart', 'text-highlight'] })).toBe('text-highlight')
  expect(techniqueFor({ ...base, techniques: ['kinetic-word-stack', 'bar-chart'] })).toBe('kinetic-word-stack')
})
it('falls from a racing chart to a bar chart when the race is off', () => { /* 3 series, 5 year labels, techniques without racing-chart and comparison-chart: 'bar-chart' */ })
it('lets a steer name a switched-off technique', () => {
  expect(techniqueFor({ ...base, guidance: 'as a donut', techniques: ['kinetic-word-stack', 'bar-chart'] })).toBe('donut-chart')
})
```

- [ ] **Step 2: Run** `cd packages/providers && pnpm exec vitest run technique`. Expected: FAIL.
- [ ] **Step 3: Implement** with a local `inUse(technique)` helper; keep every existing test green.
- [ ] **Step 4: Run** `pnpm exec vitest run technique`. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "feat(providers): techniqueFor honours a channel's techniques in use"`.

### Task 5: The prompt's taste comes from the identity

**Files:**
- Modify: `packages/providers/src/prompts/graphics.ts:57-90, 89-260, 313-320, 420-440` (input, template, craft slots, PRE_TOKEN_DESIGN rule)
- Modify: `packages/providers/src/prompts/lift/lift-cases.ts:1076-1130` (one new case)
- Test: `packages/providers/src/prompts/graphics.test.ts`, lift fixtures

**Interfaces:**
- Produces: `GraphicDesignInput.motion?: MotionIdentity` (absent means `DEFAULT_MOTION_IDENTITY`); `systemTemplate(bible, motion)`; the `buildGraphicReviewRequest` path inherits it through `buildGraphicRequest`.
- Craft slots, each a function of `motion` rendering text: the cadence line uses `changeEveryMs / 1000` ("Something changes about every 1.5 seconds") and the camera line is `cameraRule`; the blur line is present only when `blurFollowsSpeed`; the 3D line reads "3D when it carries meaning" for `whenMeaningful`, "No 3D: no perspective, rotateX or rotateY" for `never`, "3D is welcome where it reads" for `welcome`; the charts line is present only when `chartsConventional`; the Never line lists `never` minus `allow`, and is omitted when empty; rule 4's still limit reads `stillMaxMs / 1000`; a block "This channel's motion:" follows the craft section with the three constants in words (`signatureEase`, `entrance`, `overshoot`, the `ms` overrides as "entrances take 900 ms") and `styleGuideMd` when non-empty.
- `PRE_TOKEN_DESIGN` applies when `current.motion` is absent only (unchanged); a design with `motion: 1` gets no note.

- [ ] **Step 1: Write the failing tests** in `graphics.test.ts`:

```ts
it('fills the craft from the channel identity and keeps the house words at the defaults', () => {
  const house = buildGraphicRequest(input()).system
  expect(house).toContain('about every 1.5 seconds'); expect(house).toContain('more than 6 seconds is refused')
  expect(house).toContain('Never: glows, particle bursts')
  const sleepy = buildGraphicRequest(input({ motion: { ...DEFAULT_MOTION_IDENTITY, changeEveryMs: 6000, stillMaxMs: 9000, allow: ['glows'], threeD: 'never', styleGuideMd: 'Slow and dark.' } })).system
  expect(sleepy).toContain('about every 6 seconds'); expect(sleepy).toContain('more than 9 seconds is refused')
  expect(sleepy).not.toMatch(/Never:.*glows/); expect(sleepy).toContain('No 3D'); expect(sleepy).toContain("This channel's motion:"); expect(sleepy).toContain('Slow and dark.')
})
it('says nothing about the tokens to a design stored with motion 1', () => { /* current: { source, title, motion: 1 }: the slot message lacks PRE_TOKEN_DESIGN's text */ })
it('writes no dash a reader would see', /* existing: must still pass with every slot filled */)
```

- [ ] **Step 2: Run** `cd packages/providers && pnpm exec vitest run graphics.test`. Expected: FAIL.
- [ ] **Step 3: Implement** the slots. Add the lift case `graphics-motion-identity` (the minimal graphic input with the sleepy identity above) to `graphicsCases`.
- [ ] **Step 4: Regenerate fixtures**: `pnpm exec vitest run lift.test -u`, then `git diff --stat packages/providers/src/prompts/lift/__fixtures__`: every `graphics-*` fixture changes in wording only; the new fixture appears; nothing else changes. Run `pnpm exec vitest run` in `packages/providers`. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "feat(providers): the designer's craft is filled from the channel motion identity"`.

### Task 6: Wiring the identity through the design and the review

**Files:**
- Modify: `apps/web/lib/graphic-design-core.ts:206-260, 324-340, 404-420` (designInput, designGraphicWith, reviewGraphicWith options)
- Modify: `apps/web/lib/graphic-design.ts:71-120, 121-170` (designGraphic, reviewGraphic)
- Modify: `apps/web/scripts/check-exemplar.ts` (no behaviour change; passes nothing)
- Test: `apps/web/lib/graphic-design.test.ts`

**Interfaces:**
- Consumes: `resolveMotionIdentity`, `graphicCodeIssue(..., { motion })`, `techniqueFor({ techniques })`, `GraphicDesignInput.motion`.
- Produces: `designInput(context, slot, options & { motion: MotionIdentity })` sets `base.motion` and passes `techniques: motion.techniques` to `techniqueFor`; `designGraphicWith` and `reviewGraphicWith` options gain `motion: MotionIdentity` and hand it to the parse's `graphicCodeIssue`; `designGraphic` and `reviewGraphic` read `resolveMotionIdentity(channel.settings)` beside the brand; the mock branch of `designGraphic` passes the identity to `graphicCodeIssue` too.

- [ ] **Step 1: Write the failing tests** in `graphic-design.test.ts` (mock `channelForProject` as the file does, with `settings.motion` set):

```ts
it('designs with the channel identity: the prompt, the checks and the technique list', async () => {
  // settings.motion = { ...DEFAULT_MOTION_IDENTITY, changeEveryMs: 6000, stillMaxMs: 9000, techniques: ['kinetic-word-stack', 'bar-chart'] }
  // a slot whose intent names one figure: the request's system contains 'about every 6 seconds'; the exemplar block names kinetic-word-stack, not stat-counter;
  // the stored code.compiled contains the identity's numbers and code.motion is 2
})
it('checks the mock design against the channel identity', async () => { /* mock mode, stillMaxMs 9000: the fixture passes; code.motion is 2 */ })
```

- [ ] **Step 2: Run** `cd apps/web && pnpm exec vitest run graphic-design.test`. Expected: FAIL.
- [ ] **Step 3: Implement** the wiring.
- [ ] **Step 4: Run** `pnpm exec vitest run graphic-design graphic-steps slot-rebriefer slot-retyper exemplars` in `apps/web` and `pnpm -r typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "feat(web): the designer and the review run on the channel motion identity"`.

### Task 7: The Motion tab

**Files:**
- Create: `apps/web/app/(console)/c/[slug]/settings/motion-tab.tsx`
- Modify: `apps/web/app/(console)/c/[slug]/settings/page.tsx:32-42` (TABS gains `'motion'` after `'brand-kit'`; the page passes `techniqueOptions: { technique, description }[]` from `MANIFEST`)
- Modify: `apps/web/app/(console)/c/[slug]/settings/settings-form.tsx:217-290` (TabsTrigger "Motion" after Brand Kit; TabsContent with `<Lock>` like Brand Kit)
- Test: `apps/web/app/(console)/c/[slug]/settings/motion-tab.test.tsx` (rendered through `SettingsForm` with every actions module mocked, as `brand-look.test.tsx` does)

**Interfaces:**
- `MotionTab({ settings, saving, commit, techniqueOptions }: TabProps & { techniqueOptions })`; every change calls `commit({ motion: { [field]: value } }, next)` with `next` a structured clone, the Brand Kit tab's pattern.
- Controls (all labelled, button-first): a Card "Motion identity" with `Select`s for signature easing, entrance, overshoot, 3D; number `Input`s for change cadence and still limit (ms, with the bounds as min and max); an `Input` for the camera rule; `Switch`es for blur follows speed and charts conventional; the `kind: 'lines'` control the Bible's Voice section uses for `voiceDos`, for never and allow (one phrase per line); a textarea for the style guide with a live character count out of 4000. A Card "Techniques in use" with one labelled checkbox per `techniqueOptions` entry, description beside it; the two last resorts rendered checked and disabled with the note "always in use". A validation message from the action's error (the refinement messages of Task 1) shown under the card, as the other tabs show `ActionResult.error`.

- [ ] **Step 1: Write the failing tests**:

```ts
it('shows the house values for a channel that never set them', () => { /* DEFAULT_SETTINGS without motion: cadence input value 1500, overshoot select 'hair', every technique checked */ })
it('saves one field as a motion patch', async () => { /* change overshoot to none: saveSettings called with { motion: { overshoot: 'none' } } */ })
it('cannot untick a last resort', () => { /* the kinetic-word-stack checkbox is disabled and checked */ })
it('shows the refusal when the action refuses', async () => { /* saveSettings resolves { ok: false, error: 'motion: "glows" is in both lists' }: the text appears */ })
```

- [ ] **Step 2: Run** `cd apps/web && pnpm exec vitest run motion-tab`. Expected: FAIL.
- [ ] **Step 3: Implement** the tab, the TABS entry and the form wiring. Add the actions mocks for the new tab to `voice-tab.test.tsx` only if the tab imports an actions module of its own (it should not: it uses `saveSettings`).
- [ ] **Step 4: Run** `pnpm exec vitest run motion-tab brand-look models-tab voice-tab archived-settings` in `apps/web`, then `pnpm lint`. Expected: PASS, zero warnings.
- [ ] **Step 5: Commit**: `git commit -m "feat(web): a Motion tab edits the channel's motion identity"`.

### Task 8: The guideline, the e2e smoke, PROGRESS and the gate

**Files:**
- Create: `docs/motion-references.md` (section 6 of the spec, verbatim with the headings "What to supply", "What makes a good reference", "Format", "What to write for each", "How much is enough", "What the tool does with them"; no dashes)
- Modify: `e2e/tests/settings.spec.ts` or the nearest settings spec (one test: open the Motion tab, change overshoot, reload, the value holds)
- Modify: `PROGRESS.md` (the next decision number after a fetch of origin/master; one entry "The channel motion identity (plan 1 of the motion references design)" with what shipped and the calls from spec 13)

- [ ] **Step 1: Write the e2e test** and run it scoped from the e2e package on a fresh port: `E2E_PORT=3203 pnpm exec playwright test settings --retries=1`. Expected: PASS.
- [ ] **Step 2: Write the guideline and the PROGRESS entry.**
- [ ] **Step 3: Run the gate**: `pnpm -r typecheck && pnpm lint && pnpm format:check && pnpm test`. Expected: all green, zero warnings. Run `pnpm --filter @boom-busters/web exemplar:check` on one exemplar (`--id stat-counter --source file`) to see the house exemplar still passes at version 2.
- [ ] **Step 4: Commit**: `git commit -m "docs: the reference guideline and decision NNN, the channel motion identity"`.
- [ ] **Step 5: Hand over** for merge: the branch `motion-identity` is green; the owner says merge and push.
