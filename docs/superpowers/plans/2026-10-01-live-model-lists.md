# Live Model Lists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every model dropdown in the app lists what each provider serves now (Anthropic, OpenAI, Google, fal), priced so the budget guard still holds, without a code change when a model is released.

**Architecture:** A new `packages/providers/src/catalogue/` module lists each provider's models, maps unknown ids to a priced family, and resolves any id to a price and tier from settings alone. The result of a list call is cached in two new tables and refreshed from Settings → Models. The router and cost guard take an injected resolver; the Gemini and fal image adapters become factories over a model list, so every web call site swaps one lookup.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Zod 4, Drizzle ORM on Postgres, Next.js App Router (server components and server actions), Vitest with Testing Library, Playwright in mock-provider mode, pnpm workspaces with turbo.

**Spec:** `docs/superpowers/specs/2026-10-01-live-model-lists-design.md` (decision 287). Read it before starting any task.

## Global Constraints

- Branch: `live-model-lists`. Small commits, one logical change each. End every commit message with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- `packages/providers` never imports `packages/db`; `packages/db` never imports `packages/providers` (spec section 3 of the build spec). Rows cross that boundary as plain objects mapped in `apps/web`.
- Nothing calls a real provider in tests or in `MOCK_PROVIDERS=1` mode (CLAUDE.md rule 6). Every network function takes `fetchImpl`.
- An unpriced model is refused before any call, never treated as free.
- New user-facing strings never use an em dash or an en dash; recast the sentence. South African English spelling (colour, organisation).
- UI is button-first (build spec section 11.1): every action is a visible labelled button.
- `'use server'` files export only async functions (an exported const 500s every action in the segment).
- Before every commit run `pnpm format:check` (CI gates on Prettier; lint-clean is not format-clean) and fix with `pnpm exec prettier --write <files>`.
- Any Bash command that may run past two minutes (test suites, typecheck, e2e) must pass the Bash `timeout` of `600000`. A command over 120 s without it is moved to the background and orphaned.
- Database suites need Docker Desktop running and `pnpm db:migrate:test` applied. Never run two database suites at once; they block on row locks for an hour with no assertion error.
- A task that changes a shared schema, type or prompt runs the full suite of every package that consumes it, not only its own focused file.
- Bash heredocs that contain backticks, quotes or regex backslashes break in this environment. Write scripts to a file with the Write tool and run the file.

## Review Focus

1. **Clearing the price of a model a route still uses.** An owner who clears the override on a family-less model that Research is routed to would leave a route every run refuses. Expected: Clear price is refused in the form with "Research (dossiers) uses this model. Pick another model first." A model with a family or a catalogue row can always be cleared, since it falls back to that price. Pinned in Tasks 8 and 11.
2. **Two refreshes landing at once** (the tab's automatic refresh and a press of Refresh model lists). Expected: both succeed and the cache holds one copy of the last list, with no unique-constraint failure recorded as a refresh error. Pinned in Task 7.
3. **A price typed as `0`, `-1`, `abc` or `4,5`.** Expected: nothing is saved, the form says "Enter a price above zero, using a full stop for decimals." Pinned in Task 11.
4. **fal's search succeeds but its pricing call fails.** Expected: the whole fal refresh counts as failed and the previous fal list is kept, rather than every fal model turning "needs a price". Pinned in Task 6.
5. **No provider has a key and the cache is stale.** Expected: the tab does not refresh on every open (it would refresh nothing and redraw the page each time); the status lines say to add a key. Pinned in Tasks 8 and 11.

---

## File map

Created:

- `packages/providers/src/catalogue/types.ts`: `CatalogueProvider`, `ListedModel`, `PriceSource`.
- `packages/providers/src/catalogue/families.ts`: family rules and representatives.
- `packages/providers/src/catalogue/resolve.ts`: `resolveLlmModel`, `resolveImageModel`, `effectiveImageModels`.
- `packages/providers/src/catalogue/http.ts`: one GET helper for the list calls.
- `packages/providers/src/catalogue/list-anthropic.ts`, `list-openai.ts`, `list-google.ts`, `list-fal.ts`, `fal-dialect.ts`: one provider each.
- `packages/providers/src/catalogue/listing.ts`: `listProviderModels`, the legacy filter, the empty-list rule.
- `packages/providers/src/catalogue/mock-listing.ts`: fixtures for `MOCK_PROVIDERS`.
- `packages/providers/src/catalogue/options.ts`: `buildModelOptions`, the dropdown merge.
- `packages/providers/src/catalogue/index.ts`: re-exports.
- `packages/db/src/model-catalogue.ts`: cache queries.
- `apps/web/lib/model-catalogue.ts`: refresh, options, and image adapters over the effective lists.
- `apps/web/app/(console)/settings/model-actions.ts`: `refreshModelListsAction`.
- `apps/web/app/(console)/settings/models-tab.tsx`: the Models tab, moved out of `settings-form.tsx`.
- `e2e/tests/settings-models.spec.ts`.
- Tests beside each file.

Modified:

- `packages/schemas/src/settings.ts`, `packages/db/src/settings-merge.ts`: `modelPrices`.
- `packages/providers/src/llm/types.ts`, `llm/router.ts`: injected resolver, `nextTierBelow`.
- `packages/cost/src/prices.ts`, `apps/web/lib/llm.ts`: prices from the resolver.
- `packages/providers/src/visuals/types.ts`, `visuals/gemini.ts`, `visuals/fal.ts`, `visuals/mock.ts`, `visuals/registry.ts`: factories and dialects.
- `packages/db/src/schema.ts`, `packages/db/src/index.ts`, plus a generated migration in `packages/db/drizzle/`.
- `apps/web/lib/visual-assets.ts`, `apps/web/lib/set-sheet.ts`, `apps/web/lib/visuals-review.ts`, `apps/web/app/(console)/projects/[id]/visuals-actions.ts`, `apps/web/app/(console)/projects/[id]/visual-board.tsx`.
- `apps/web/app/(console)/settings/page.tsx`, `settings-form.tsx`, `models-tab.test.tsx`, `voice-tab.test.tsx`.
- `PROGRESS.md`.

---

### Task 1: Catalogue types and family rules

**Files:**
- Create: `packages/providers/src/catalogue/types.ts`
- Create: `packages/providers/src/catalogue/families.ts`
- Create: `packages/providers/src/catalogue/index.ts`
- Modify: `packages/providers/src/index.ts`
- Modify: `packages/providers/src/visuals/types.ts` (add `FalDialect` and the optional `dialect` field)
- Test: `packages/providers/src/catalogue/families.test.ts`

**Interfaces:**
- Produces: `CATALOGUE_PROVIDERS`, `CatalogueProvider`, `ModelKind`, `ListedModel`, `PriceSource` (types.ts); `FalDialect`, `FAL_DIALECTS`, `ImageGenModel.dialect?` (visuals/types.ts); `Family`, `llmFamily(provider, id)`, `geminiImageFamily(id)`, `FAMILY_REPRESENTATIVES` (families.ts).

- [ ] **Step 1: Add the dialect type to the image types**

In `packages/providers/src/visuals/types.ts`, above `export interface ImageGenModel`, add:

```ts
/**
 * The request shape a fal text-to-image endpoint speaks (decision 287).
 * `flux` takes `image_size`; `aspect` takes `aspect_ratio`; `aspect-negative`
 * also has a real `negative_prompt` field. Read from the endpoint's own
 * OpenAPI input schema when it is listed live.
 */
export const FAL_DIALECTS = ['flux', 'aspect', 'aspect-negative'] as const
export type FalDialect = (typeof FAL_DIALECTS)[number]
```

and add one field to `ImageGenModel`, after `pricesBySize`:

```ts
  /** fal only: the request shape this endpoint speaks. Absent means `flux`. */
  readonly dialect?: FalDialect
```

- [ ] **Step 2: Write the shared catalogue types**

Create `packages/providers/src/catalogue/types.ts`:

```ts
import type { FalDialect } from '../visuals/types'

/**
 * What a provider's own list endpoint says it serves (decision 287).
 *
 * Google is one provider here although it has two kinds of model, because
 * one key and one `GET /v1beta/models` serve both its LLMs and its image
 * models.
 */
export const CATALOGUE_PROVIDERS = ['anthropic', 'openai', 'google', 'fal'] as const
export type CatalogueProvider = (typeof CATALOGUE_PROVIDERS)[number]

export type ModelKind = 'llm' | 'image'

export interface ListedModel {
  provider: CatalogueProvider
  id: string
  label: string
  kind: ModelKind
  /** Google `-preview` and `-exp` ids: listed, grouped and warned about. */
  preview: boolean
  contextTokens: number | null
  maxOutputTokens: number | null
  /** fal only; null on fal means the endpoint fits no dialect this app can send. */
  dialect: FalDialect | null
  /** fal only: the provider's own USD price per image, when it publishes one. */
  pricePerImage: number | null
}

/** Where a resolved price came from, in the order they are tried. */
export type PriceSource = 'override' | 'catalogue' | 'provider' | 'family'
```

- [ ] **Step 3: Write the failing family tests**

Create `packages/providers/src/catalogue/families.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { LLM_MODELS } from '../llm/registry'
import { GEMINI_IMAGE_MODELS } from '../visuals/gemini'
import { FAMILY_REPRESENTATIVES, geminiImageFamily, llmFamily } from './families'

describe('llmFamily (decision 287)', () => {
  it.each([
    ['anthropic', 'claude-opus-5-5', 'opus'],
    ['anthropic', 'claude-sonnet-5-5', 'sonnet'],
    ['anthropic', 'claude-haiku-5', 'haiku'],
    ['openai', 'gpt-5.5', 'gpt-5'],
    ['openai', 'gpt-5.5-mini', 'gpt-5-mini'],
    ['google', 'gemini-9-flash-lite', 'flash-lite'],
    ['google', 'gemini-9-flash', 'flash'],
    ['google', 'gemini-9-pro', 'pro'],
  ] as const)('%s %s is %s', (provider, id, family) => {
    expect(llmFamily(provider, id)?.family).toBe(family)
  })

  it.each([
    ['anthropic', 'claude-fable-5-1'],
    ['anthropic', 'claude-3-5-sonnet-20241022'],
    ['openai', 'gpt-5-nano'],
    ['openai', 'o4-mini'],
    ['google', 'nonsense'],
  ] as const)('%s %s has no family, so it must be priced by hand', (provider, id) => {
    expect(llmFamily(provider, id)).toBeUndefined()
  })
})

describe('geminiImageFamily', () => {
  it('matches pro before flash, and leaves flash-lite images unpriced', () => {
    expect(geminiImageFamily('gemini-9-pro-image')?.family).toBe('pro-image')
    expect(geminiImageFamily('gemini-9-flash-image')?.family).toBe('flash-image')
    // Served but deliberately unpriced since decision 211; no family guess.
    expect(geminiImageFamily('gemini-3.1-flash-lite-image')).toBeUndefined()
  })

  it('takes the 3.1 Flash flags, not the first flash model in the list', () => {
    expect(geminiImageFamily('gemini-9-flash-image')?.representative).toBe(
      'gemini-3.1-flash-image',
    )
  })
})

describe('every representative is a catalogued model', () => {
  it('names only ids the hand-written catalogues hold', () => {
    for (const [provider, ids] of Object.entries(FAMILY_REPRESENTATIVES.llm)) {
      const catalogue = LLM_MODELS[provider as keyof typeof LLM_MODELS].map((m) => m.id)
      for (const id of ids) expect(catalogue).toContain(id)
    }
    const images = GEMINI_IMAGE_MODELS.map((m) => m.id)
    for (const id of FAMILY_REPRESENTATIVES.geminiImage) expect(images).toContain(id)
  })
})
```

`GEMINI_IMAGE_MODELS` does not exist yet. In `packages/providers/src/visuals/gemini.ts`, rename the module-level `const MODELS = [...] as const` to `export const GEMINI_IMAGE_MODELS: readonly ImageGenModel[] = [...]` (drop `as const`, keep the three entries unchanged), and change every use of `MODELS` in that file to `GEMINI_IMAGE_MODELS` (`models: MODELS` becomes `models: GEMINI_IMAGE_MODELS`; `MODELS[0].id` in `verifyKey` becomes `GEMINI_IMAGE_MODELS[0]!.id`). Import `ImageGenModel` from `./types` if it is not imported already.

- [ ] **Step 4: Run the tests to see them fail**

Run: `pnpm --filter @boom-busters/providers exec vitest run src/catalogue/families.test.ts`
Expected: FAIL, `Cannot find module './families'`.

- [ ] **Step 5: Write the families module**

Create `packages/providers/src/catalogue/families.ts`:

```ts
import type { LlmProvider } from '@boom-busters/schemas'

/**
 * Which priced model a live-only id stands in for (decision 287).
 *
 * List endpoints return no prices, and an unpriced model would walk through
 * every budget cap. A new id that plainly belongs to a known line is charged
 * at that line's representative: a catalogued model named here, never the
 * first match in a list, because the image catalogue is ordered default
 * first (2.5 Flash, unsized, $0.04) rather than best first.
 *
 * Patterns are tried top to bottom and the first match wins. An id matching
 * none has no family on purpose: `claude-fable-5-1` costs twice any Opus, so
 * any guess would underprice it and it must be priced by hand.
 *
 * This file imports no adapter, so the adapters can import it.
 */

export interface Family {
  family: string
  /** A catalogued id whose price, tier and request flags the family inherits. */
  representative: string
}

interface FamilyRule extends Family {
  matches: (id: string) => boolean
}

const LLM_FAMILIES: Record<LlmProvider, readonly FamilyRule[]> = {
  anthropic: [
    {
      family: 'opus',
      matches: (id) => id.startsWith('claude-opus-'),
      representative: 'claude-opus-5',
    },
    {
      family: 'sonnet',
      matches: (id) => id.startsWith('claude-sonnet-'),
      representative: 'claude-sonnet-5',
    },
    {
      family: 'haiku',
      matches: (id) => id.startsWith('claude-haiku-'),
      representative: 'claude-haiku-4-5-20251001',
    },
  ],
  openai: [
    {
      family: 'gpt-5-mini',
      matches: (id) => id.startsWith('gpt-5') && id.includes('-mini'),
      representative: 'gpt-5-mini',
    },
    {
      family: 'gpt-5',
      matches: (id) => id.startsWith('gpt-5') && !id.includes('-mini') && !id.includes('-nano'),
      representative: 'gpt-5',
    },
  ],
  google: [
    {
      family: 'flash-lite',
      matches: (id) => id.includes('-flash-lite'),
      representative: 'gemini-3.5-flash-lite',
    },
    {
      family: 'flash',
      matches: (id) => id.includes('-flash'),
      representative: 'gemini-3.6-flash',
    },
    {
      family: 'pro',
      matches: (id) => id.includes('-pro'),
      representative: 'gemini-pro-latest',
    },
  ],
}

const GEMINI_IMAGE_FAMILIES: readonly FamilyRule[] = [
  {
    family: 'pro-image',
    matches: (id) => id.includes('-pro-image'),
    representative: 'gemini-3-pro-image',
  },
  {
    family: 'flash-image',
    matches: (id) => id.includes('-flash-image'),
    representative: 'gemini-3.1-flash-image',
  },
]

function first(rules: readonly FamilyRule[], id: string): Family | undefined {
  const rule = rules.find((candidate) => candidate.matches(id))
  return rule ? { family: rule.family, representative: rule.representative } : undefined
}

export function llmFamily(provider: LlmProvider, id: string): Family | undefined {
  return first(LLM_FAMILIES[provider], id)
}

export function geminiImageFamily(id: string): Family | undefined {
  return first(GEMINI_IMAGE_FAMILIES, id)
}

/** For the test that pins every representative to a catalogued id. */
export const FAMILY_REPRESENTATIVES = {
  llm: Object.fromEntries(
    Object.entries(LLM_FAMILIES).map(([provider, rules]) => [
      provider,
      rules.map((rule) => rule.representative),
    ]),
  ) as Record<LlmProvider, string[]>,
  geminiImage: GEMINI_IMAGE_FAMILIES.map((rule) => rule.representative),
}
```

Create `packages/providers/src/catalogue/index.ts`:

```ts
export * from './types'
export * from './families'
```

Add to `packages/providers/src/index.ts`: `export * from './catalogue/index'`.

- [ ] **Step 6: Run the tests to see them pass**

Run: `pnpm --filter @boom-busters/providers exec vitest run src/catalogue/families.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the whole providers suite and typecheck**

Run (Bash `timeout` 600000): `pnpm --filter @boom-busters/providers test && pnpm typecheck`
Expected: PASS. The `GEMINI_IMAGE_MODELS` rename touches `gemini.test.ts` only if it referenced `MODELS`; fix any such reference.

- [ ] **Step 8: Commit**

```bash
pnpm format:check
git add packages/providers/src/catalogue packages/providers/src/index.ts packages/providers/src/visuals/types.ts packages/providers/src/visuals/gemini.ts
git commit -m "feat(catalogue): model families and their priced representatives (decision 287)"
```

---

### Task 2: `modelPrices` in settings

**Files:**
- Modify: `packages/schemas/src/settings.ts`
- Modify: `packages/db/src/settings-merge.ts`
- Test: `packages/schemas/src/settings.test.ts`, `packages/db/src/settings-merge.test.ts`

**Interfaces:**
- Produces: `LlmPriceOverrideSchema`, `ImagePriceOverrideSchema`, `ModelPricesSchema`, `ModelPrices`, `EMPTY_MODEL_PRICES`, `modelPriceKey(provider, modelId)`; `Settings.modelPrices`; `SettingsPatch.modelPrices?`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/schemas/src/settings.test.ts` (match the file's existing imports; add the new names to them):

```ts
describe('modelPrices (decision 287)', () => {
  it('defaults to no overrides on a row stored before it existed', () => {
    const older: Record<string, unknown> = { ...DEFAULT_SETTINGS }
    delete older['modelPrices']
    expect(SettingsSchema.parse(older).modelPrices).toEqual({ llm: {}, image: {} })
  })

  it('refuses a price that is not above zero', () => {
    const bad = { llm: { 'anthropic:claude-fable-5-1': { inputPerMTok: 0, outputPerMTok: 50 } } }
    expect(ModelPricesSchema.safeParse(bad).success).toBe(false)
  })

  it('accepts an image price by size', () => {
    const good = {
      image: { 'google:gemini-9-pro-image': { pricePerImage: 0.2, pricesBySize: { '4K': 0.3 } } },
    }
    expect(ModelPricesSchema.parse(good).image['google:gemini-9-pro-image']?.pricesBySize).toEqual({
      '4K': 0.3,
    })
  })

  it('keys a price by provider and id', () => {
    expect(modelPriceKey('anthropic', 'claude-fable-5-1')).toBe('anthropic:claude-fable-5-1')
  })
})
```

Append to `packages/db/src/settings-merge.test.ts`:

```ts
describe('merging modelPrices (decision 287)', () => {
  it('replaces the whole price map when a patch carries one, and keeps it otherwise', () => {
    const priced = mergeSettings(DEFAULT_SETTINGS, {
      modelPrices: {
        llm: { 'anthropic:claude-fable-5-1': { inputPerMTok: 10, outputPerMTok: 50 } },
        image: {},
      },
    })
    expect(priced.modelPrices.llm['anthropic:claude-fable-5-1']?.outputPerMTok).toBe(50)

    const untouched = mergeSettings(priced, { budgets: { monthlyCeilingUsd: 120 } })
    expect(untouched.modelPrices).toEqual(priced.modelPrices)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @boom-busters/schemas exec vitest run src/settings.test.ts`
Expected: FAIL, `ModelPricesSchema` is not exported.

- [ ] **Step 3: Add the schema**

In `packages/schemas/src/settings.ts`, after the `DEFAULT_SET_SHEET_ROUTE` block, add:

```ts
// ---------------------------------------------------------------------------
// Model prices (decision 287)
// ---------------------------------------------------------------------------

/**
 * The owner's own price for a model, by `provider:modelId`.
 *
 * List endpoints return no prices, so a model the code has never priced is
 * charged at its family's rate, or cannot run at all. This is where the
 * owner writes the real rate. It lives in settings, not the model cache,
 * because it is a choice and must survive every refresh.
 */
export const LlmPriceOverrideSchema = z.object({
  inputPerMTok: z.number().positive(),
  outputPerMTok: z.number().positive(),
  cachedInputPerMTok: z.number().positive().optional(),
})
export type LlmPriceOverride = z.infer<typeof LlmPriceOverrideSchema>

export const ImagePriceOverrideSchema = z.object({
  pricePerImage: z.number().positive(),
  pricesBySize: z
    .object({
      '1K': z.number().positive(),
      '2K': z.number().positive(),
      '4K': z.number().positive(),
    })
    .partial()
    .optional(),
})
export type ImagePriceOverride = z.infer<typeof ImagePriceOverrideSchema>

export const ModelPricesSchema = z.object({
  llm: z.record(z.string(), LlmPriceOverrideSchema).default({}),
  image: z.record(z.string(), ImagePriceOverrideSchema).default({}),
})
export type ModelPrices = z.infer<typeof ModelPricesSchema>

export const EMPTY_MODEL_PRICES: ModelPrices = { llm: {}, image: {} }

export function modelPriceKey(provider: string, modelId: string): string {
  return `${provider}:${modelId}`
}
```

In `SettingsSchema`, add after `fallbackChain`:

```ts
  modelPrices: ModelPricesSchema.default({ llm: {}, image: {} }),
```

In `SettingsPatchSchema`, add after `fallbackChain`:

```ts
  // Replaced whole, like fallbackChain: the form always sends the full map.
  modelPrices: ModelPricesSchema.optional(),
```

In `DEFAULT_SETTINGS`, add after `fallbackChain: [],`:

```ts
  modelPrices: { llm: {}, image: {} },
```

- [ ] **Step 4: Merge it**

In `packages/db/src/settings-merge.ts`, inside `mergeSettings`'s `merged` object, after the `fallbackChain` line, add:

```ts
    modelPrices: patch.modelPrices ?? current.modelPrices,
```

`normaliseSettings` needs no change: `SettingsSchema` fills the default for a row without the field.

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm --filter @boom-busters/schemas exec vitest run src/settings.test.ts && pnpm --filter @boom-busters/db exec vitest run src/settings-merge.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck everything**

`Settings` gained a required field, so any test or fixture that writes a `Settings` literal by hand now fails to compile.

Run (Bash `timeout` 600000): `pnpm typecheck`
Expected: PASS after adding `modelPrices: { llm: {}, image: {} }` to every literal it reports. Prefer spreading `DEFAULT_SETTINGS` where the literal already copies most of it.

- [ ] **Step 7: Run every consuming package's suite**

Run (Bash `timeout` 600000): `pnpm --filter @boom-busters/schemas test && pnpm --filter @boom-busters/db test`
Expected: PASS. The db suite needs Docker Desktop and the test database; if it is not running, start it and run `pnpm db:migrate:test` first.

- [ ] **Step 8: Commit**

```bash
pnpm format:check
git add packages/schemas packages/db/src/settings-merge.ts packages/db/src/settings-merge.test.ts
git add -u
git commit -m "feat(settings): the owner's model prices, by provider and id (decision 287)"
```

---

### Task 3: Image adapters as factories over a model list

**Files:**
- Modify: `packages/providers/src/visuals/gemini.ts`
- Modify: `packages/providers/src/visuals/fal.ts`
- Modify: `packages/providers/src/visuals/mock.ts`
- Modify: `packages/providers/src/visuals/registry.ts`
- Test: `packages/providers/src/visuals/gemini.test.ts`, `packages/providers/src/visuals/adapters.test.ts`

**Interfaces:**
- Consumes: `FalDialect`, `ImageGenModel.dialect` (Task 1); `geminiImageFamily` (Task 1).
- Produces: `GEMINI_IMAGE_MODELS` (Task 1 already exported it), `createGeminiImageGen(models?)`, `FAL_MODELS`, `createFalImageGen(models?)`, `mockImageGenWith(models)`, `liveImageGenWith(provider, models)`, `imageGenAdapterWith(provider, models, env?)`. `geminiImageGen` and `falImageGen` keep their names and behaviour.

- [ ] **Step 1: Write the failing Gemini tests**

Append to `packages/providers/src/visuals/gemini.test.ts`, reusing its existing helpers for a captured `fetchImpl` and a one-image response (read the top of the file first; the names below assume a helper that records request bodies, adapt to the file's own):

```ts
describe('a live Gemini image model the catalogue does not hold (decision 287)', () => {
  const live = (id: string) =>
    createGeminiImageGen([
      ...GEMINI_IMAGE_MODELS,
      { id, label: id, pricePerImage: 0.07, pricesBySize: { '1K': 0.07, '2K': 0.11, '4K': 0.16 } },
    ])

  it('sends a flash image model the 3.1 Flash flags: a size and thinking', async () => {
    const { fetchImpl, bodies } = captureImageCalls()
    await live('gemini-9-flash-image').generate(
      { prompt: 'a vault', count: 1, model: 'gemini-9-flash-image', size: '2K' },
      { apiKey: 'k', fetchImpl },
    )
    const config = bodies[0]!.generationConfig
    expect(config.imageConfig.imageSize).toBe('2K')
    expect(config.thinkingConfig).toEqual({ thinkingLevel: 'HIGH' })
  })

  it('sends a pro image model a size and no thinking, and the 3 Pro reference limits', async () => {
    const { fetchImpl, bodies } = captureImageCalls()
    const adapter = live('gemini-9-pro-image')
    await adapter.generate(
      { prompt: 'a vault', count: 1, model: 'gemini-9-pro-image', size: '4K' },
      { apiKey: 'k', fetchImpl },
    )
    expect(bodies[0]!.generationConfig.imageConfig.imageSize).toBe('4K')
    expect(bodies[0]!.generationConfig.thinkingConfig).toBeUndefined()
    expect(adapter.referenceLimits('gemini-9-pro-image')).toEqual({ characters: 5, objects: 6 })
  })

  it('still refuses an id the list it was built over does not hold', async () => {
    await expect(
      geminiImageGen.generate({ prompt: 'x', count: 1, model: 'gemini-9-flash-image' }, { apiKey: 'k' }),
    ).rejects.toThrow(/does not offer the image model "gemini-9-flash-image"/)
  })
})
```

If the file has no request-capturing helper, add one at the top of the new `describe`:

```ts
interface GeminiBody {
  generationConfig: { imageConfig: { imageSize?: string }; thinkingConfig?: unknown }
}

function captureImageCalls() {
  const bodies: GeminiBody[] = []
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as GeminiBody)
    return new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AA==' } }] } }] }),
      { status: 200 },
    )
  }) as typeof fetch
  return { fetchImpl, bodies }
}
```

- [ ] **Step 2: Write the failing fal tests**

Append to `packages/providers/src/visuals/adapters.test.ts` (same note on helpers):

```ts
describe('fal dialects (decision 287)', () => {
  function captureFal() {
    const calls: { url: string; body: Record<string, unknown> }[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> })
      return new Response(JSON.stringify({ images: [{ url: 'https://fal.media/x.png' }] }), {
        status: 200,
      })
    }) as typeof fetch
    return { calls, fetchImpl }
  }

  it('speaks aspect to a live aspect endpoint, folding the negative prompt in', async () => {
    const { calls, fetchImpl } = captureFal()
    const adapter = createFalImageGen([
      ...FAL_MODELS,
      { id: 'fal-ai/new-model', label: 'New', pricePerImage: 0.05, dialect: 'aspect' },
    ])
    await adapter.generate(
      { prompt: 'a vault', negativePrompt: 'text', count: 2, model: 'fal-ai/new-model' },
      { apiKey: 'k', fetchImpl },
    )
    expect(calls[0]!.url).toBe('https://fal.run/fal-ai/new-model')
    expect(calls[0]!.body).toEqual({
      prompt: 'a vault. Avoid: text.',
      aspect_ratio: '16:9',
      num_images: 2,
    })
  })

  it('keeps Imagen 3 on its real negative prompt field', async () => {
    const { calls, fetchImpl } = captureFal()
    await falImageGen.generate(
      { prompt: 'a vault', negativePrompt: 'text', count: 1, model: 'fal-ai/imagen3' },
      { apiKey: 'k', fetchImpl },
    )
    expect(calls[0]!.body).toEqual({
      prompt: 'a vault',
      negative_prompt: 'text',
      aspect_ratio: '16:9',
      num_images: 1,
    })
  })

  it('keeps FLUX on image_size', async () => {
    const { calls, fetchImpl } = captureFal()
    await falImageGen.generate(
      { prompt: 'a vault', count: 1, model: 'fal-ai/flux/dev' },
      { apiKey: 'k', fetchImpl },
    )
    expect(calls[0]!.body.image_size).toBe('landscape_16_9')
  })
})
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm --filter @boom-busters/providers exec vitest run src/visuals/gemini.test.ts src/visuals/adapters.test.ts`
Expected: FAIL, `createGeminiImageGen` and `createFalImageGen` are not exported.

- [ ] **Step 4: Turn the Gemini adapter into a factory**

In `packages/providers/src/visuals/gemini.ts`:

1. Import `geminiImageFamily` from `'../catalogue/families'`.
2. Below `REFERENCE_LIMITS`, add:

```ts
/**
 * The catalogued id whose flags a model takes (decision 287): itself when
 * the catalogue holds it, else its family's representative, else itself (no
 * size, no thinking, the app's own reference caps). A live
 * `gemini-9-flash-image` is sent what 3.1 Flash is sent.
 */
function flagsOf(modelId: string): string {
  if (GEMINI_IMAGE_MODELS.some((model) => model.id === modelId)) return modelId
  return geminiImageFamily(modelId)?.representative ?? modelId
}
```

3. Replace `export const geminiImageGen: ImageGenProvider = { ... }` with a factory. The body stays the same except as listed:

```ts
export function createGeminiImageGen(
  models: readonly ImageGenModel[] = GEMINI_IMAGE_MODELS,
): ImageGenProvider {
  const adapter: ImageGenProvider = {
    id: 'google',
    label: 'Gemini via Google',
    models,
    async generate(request, options) {
      // ...unchanged body, with these replacements:
      //   imageGenModel(geminiImageGen, request.model) -> imageGenModel(adapter, request.model)
      //   geminiImageGen.referenceLimits(...)          -> adapter.referenceLimits(...)
      //   SIZED_MODELS.has(model.id)                   -> SIZED_MODELS.has(flagsOf(model.id))   (both places)
      //   THINKING_MODELS.has(model.id)                -> THINKING_MODELS.has(flagsOf(model.id))
      //   imageGenPrice(geminiImageGen, ...)           -> imageGenPrice(adapter, ...)
    },
    referenceLimits(modelId?: string): ReferenceLimits {
      const model = imageGenModel(adapter, modelId)
      return REFERENCE_LIMITS[flagsOf(model.id)] ?? UNDOCUMENTED_LIMITS
    },
    async verifyKey(apiKey, options = {}) {
      // ...unchanged
    },
  }
  return adapter
}

export const geminiImageGen = createGeminiImageGen()
```

Every reference to `geminiImageGen` inside the old object literal must become `adapter`, or the factory would validate against the hand-written list.

- [ ] **Step 5: Turn the fal adapter into a factory with explicit dialects**

In `packages/providers/src/visuals/fal.ts`:

1. Rename `const MODELS = [...] as const` to `export const FAL_MODELS: readonly ImageGenModel[] = [...]`, giving every FLUX entry `dialect: 'flux'` and the Imagen 3 entry `dialect: 'aspect-negative'`. Change `MODELS[0].id` in `verifyKey` to `FAL_MODELS[0]!.id`.
2. Delete `isImagen`.
3. Replace the `falImageGen` object with:

```ts
export function createFalImageGen(models: readonly ImageGenModel[] = FAL_MODELS): ImageGenProvider {
  const adapter: ImageGenProvider = {
    id: 'fal',
    label: 'FLUX via fal.ai',
    models,

    async generate(request, options) {
      const apiKey = options.apiKey
      if (!apiKey) throw new Error('fal requires an API key')

      // Resolved (and refused, on an unknown id) before any call is made.
      const model = imageGenModel(adapter, request.model)
      const dialect: FalDialect = model.dialect ?? 'flux'
      const realNegative = dialect === 'aspect-negative'

      // Only aspect-negative has a real negative-prompt field; every other
      // dialect gets it folded in as an "Avoid:" clause.
      const prompt =
        request.negativePrompt && !realNegative
          ? `${request.prompt}. Avoid: ${request.negativePrompt}.`
          : request.prompt

      const referenceUrls = request.referenceUrls ?? []
      const conditioned = resolveReferenceRoute(model.id, referenceUrls.length)

      const body = conditioned
        ? conditioned.dialect === 'flux2-edit'
          ? {
              prompt,
              image_urls: referenceUrls,
              image_size: IMAGE_SIZE,
              num_images: request.count,
              enable_safety_checker: true,
            }
          : {
              prompt,
              ...(referenceUrls.length === 1
                ? { image_url: referenceUrls[0] }
                : { image_urls: referenceUrls }),
              aspect_ratio: '16:9',
              num_images: request.count,
              safety_tolerance: '2',
            }
        : dialect === 'flux'
          ? {
              prompt,
              image_size: IMAGE_SIZE,
              num_images: request.count,
              enable_safety_checker: true,
            }
          : {
              prompt,
              ...(realNegative && request.negativePrompt
                ? { negative_prompt: request.negativePrompt }
                : {}),
              aspect_ratio: '16:9',
              num_images: request.count,
            }

      // ...fetch, error mapping and parse unchanged...

      const aspectSized = dialect !== 'flux'
      return {
        images: parsed.images.map((image) => ({
          url: image.url,
          width: image.width ?? (aspectSized ? IMAGEN_WIDTH : 1344),
          height: image.height ?? (aspectSized ? IMAGEN_HEIGHT : 768),
        })),
        estimatedCostUsd:
          (conditioned ? conditioned.pricePerImage : model.pricePerImage) * parsed.images.length,
      }
    },

    referenceLimits(): ReferenceLimits {
      return { characters: 3, objects: 2 }
    },

    referenceRoute(modelId, referenceCount) {
      const route = resolveReferenceRoute(imageGenModel(adapter, modelId).id, referenceCount)
      return route ? { id: route.id, label: route.label, pricePerImage: route.pricePerImage } : null
    },

    async verifyKey(apiKey, options = {}) {
      // ...unchanged, with FAL_MODELS[0]!.id
    },
  }
  return adapter
}

export const falImageGen = createFalImageGen()
```

Keep the existing doc comments on the moved methods. Import `FalDialect` and `ImageGenModel` types from `./types`.

- [ ] **Step 6: Give the mock and the registry the same shape**

In `packages/providers/src/visuals/mock.ts`, after `mockImageGen`, add:

```ts
/** The mock over a given model list: it ignores the model id, as `mockImageGen` does. */
export function mockImageGenWith(models: readonly ImageGenModel[]): ImageGenProvider {
  return { ...mockImageGen, models }
}
```

In `packages/providers/src/visuals/registry.ts`, add (importing the factories and `mockImageGenWith`, and the `ImageGenModel` type):

```ts
/** A live adapter over the given model list (decision 287). */
export function liveImageGenWith(
  provider: ImageGenProviderId,
  models: readonly ImageGenModel[],
): ImageGenProvider {
  return provider === 'google' ? createGeminiImageGen(models) : createFalImageGen(models)
}

/** `imageGenAdapter` over a given model list: the mock in mock mode, else live. */
export function imageGenAdapterWith(
  provider: ImageGenProviderId,
  models: readonly ImageGenModel[],
  env: Record<string, string | undefined> = process.env,
): ImageGenProvider {
  return mockProvidersEnabled(env) ? mockImageGenWith(models) : liveImageGenWith(provider, models)
}
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `pnpm --filter @boom-busters/providers exec vitest run src/visuals`
Expected: PASS, including every pre-existing Gemini and fal test.

- [ ] **Step 8: Run the providers suite and the web suite**

The web app imports `falImageGen`, `geminiImageGen` and `LIVE_IMAGE_GEN_ADAPTERS` in several places.

Run (Bash `timeout` 600000): `pnpm --filter @boom-busters/providers test && pnpm --filter @boom-busters/web test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
pnpm format:check
git add packages/providers/src/visuals
git commit -m "refactor(visuals): image adapters over a model list, fal dialects explicit (decision 287)"
```

---

### Task 4: Resolving any model id to a price

**Files:**
- Create: `packages/providers/src/catalogue/resolve.ts`
- Modify: `packages/providers/src/catalogue/index.ts`
- Test: `packages/providers/src/catalogue/resolve.test.ts`

**Interfaces:**
- Consumes: `llmFamily`, `geminiImageFamily`, `ListedModel`, `PriceSource` (Task 1); `ModelPrices`, `modelPriceKey`, `EMPTY_MODEL_PRICES` (Task 2); `GEMINI_IMAGE_MODELS`, `FAL_MODELS` (Tasks 1 and 3); `LLM_MODELS` (existing).
- Produces:
  - `resolveLlmModel(provider: LlmProvider, modelId: string, prices: ModelPrices | undefined): ResolvedLlmModel | undefined`
  - `resolveImageModel(provider: StillProvider, modelId: string, prices: ModelPrices | undefined, cached?: ListedModel): ResolvedImageModel | undefined`
  - `effectiveImageModels(provider: StillProvider, prices: ModelPrices | undefined, listed: readonly ListedModel[]): ImageGenModel[]`
  - `interface ResolvedLlmModel { model: KnownModel; source: PriceSource }`, `interface ResolvedImageModel { model: ImageGenModel; source: PriceSource }`

- [ ] **Step 1: Write the failing tests**

Create `packages/providers/src/catalogue/resolve.test.ts`:

```ts
import { EMPTY_MODEL_PRICES } from '@boom-busters/schemas'
import type { ModelPrices } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import type { ListedModel } from './types'
import { effectiveImageModels, resolveImageModel, resolveLlmModel } from './resolve'

const priced = (prices: Partial<ModelPrices>): ModelPrices => ({ ...EMPTY_MODEL_PRICES, ...prices })

const falListed = (over: Partial<ListedModel>): ListedModel => ({
  provider: 'fal',
  id: 'fal-ai/new-model',
  label: 'New model',
  kind: 'image',
  preview: false,
  contextTokens: null,
  maxOutputTokens: null,
  dialect: 'flux',
  pricePerImage: 0.02,
  ...over,
})

describe('resolveLlmModel (decision 287)', () => {
  it('prices a catalogued model from the catalogue', () => {
    const resolved = resolveLlmModel('anthropic', 'claude-opus-5', EMPTY_MODEL_PRICES)
    expect(resolved?.source).toBe('catalogue')
    expect(resolved?.model.outputPerMTok).toBe(25)
  })

  it('prices a live family member at its representative, at the same tier', () => {
    const resolved = resolveLlmModel('anthropic', 'claude-opus-5-5', EMPTY_MODEL_PRICES)
    expect(resolved?.source).toBe('family')
    expect(resolved?.model).toMatchObject({ id: 'claude-opus-5-5', tier: 0, inputPerMTok: 5 })
  })

  it('lets the owner override a catalogued price and keeps its tier', () => {
    const prices = priced({
      llm: { 'anthropic:claude-opus-5': { inputPerMTok: 4, outputPerMTok: 20 } },
    })
    const resolved = resolveLlmModel('anthropic', 'claude-opus-5', prices)
    expect(resolved).toMatchObject({ source: 'override', model: { tier: 0, outputPerMTok: 20 } })
  })

  it('refuses a family-less model with no override, and takes tier -1 once priced', () => {
    expect(resolveLlmModel('anthropic', 'claude-fable-5-1', EMPTY_MODEL_PRICES)).toBeUndefined()
    const prices = priced({
      llm: { 'anthropic:claude-fable-5-1': { inputPerMTok: 10, outputPerMTok: 50 } },
    })
    expect(resolveLlmModel('anthropic', 'claude-fable-5-1', prices)?.model.tier).toBe(-1)
  })

  it('folds a legacy id forward before resolving', () => {
    expect(resolveLlmModel('anthropic', 'opus', EMPTY_MODEL_PRICES)?.model.id).toBe('claude-opus-5')
  })

  it('treats missing prices as no overrides', () => {
    expect(resolveLlmModel('openai', 'gpt-5.5', undefined)?.source).toBe('family')
  })
})

describe('resolveImageModel', () => {
  it('prices a live Gemini image model by family, sizes included', () => {
    const resolved = resolveImageModel('google', 'gemini-9-pro-image', EMPTY_MODEL_PRICES)
    expect(resolved).toMatchObject({ source: 'family', model: { pricesBySize: { '4K': 0.24 } } })
  })

  it('uses fal's own published price and the cached dialect', () => {
    const resolved = resolveImageModel('fal', 'fal-ai/new-model', EMPTY_MODEL_PRICES, falListed({}))
    expect(resolved).toMatchObject({
      source: 'provider',
      model: { pricePerImage: 0.02, dialect: 'flux', label: 'New model' },
    })
  })

  it('refuses a fal model with no dialect even when it is priced', () => {
    const cached = falListed({ dialect: null })
    const prices = priced({ image: { 'fal:fal-ai/new-model': { pricePerImage: 0.1 } } })
    expect(resolveImageModel('fal', 'fal-ai/new-model', prices, cached)).toBeUndefined()
  })

  it('refuses a fal model with a dialect but no price until the owner sets one', () => {
    const cached = falListed({ pricePerImage: null })
    expect(resolveImageModel('fal', 'fal-ai/new-model', EMPTY_MODEL_PRICES, cached)).toBeUndefined()
    const prices = priced({ image: { 'fal:fal-ai/new-model': { pricePerImage: 0.1 } } })
    expect(resolveImageModel('fal', 'fal-ai/new-model', prices, cached)?.source).toBe('override')
  })
})

describe('effectiveImageModels', () => {
  it('lists the catalogue, repriced, then every choosable live model', () => {
    const prices = priced({ image: { 'fal:fal-ai/flux/dev': { pricePerImage: 0.025 } } })
    const models = effectiveImageModels('fal', prices, [
      falListed({}),
      falListed({ id: 'fal-ai/one-at-a-time', dialect: null }),
      falListed({ id: 'fal-ai/flux/dev', label: 'FLUX.1 dev (live)' }),
    ])
    expect(models.find((m) => m.id === 'fal-ai/flux/dev')?.pricePerImage).toBe(0.025)
    expect(models.map((m) => m.id)).toContain('fal-ai/new-model')
    expect(models.map((m) => m.id)).not.toContain('fal-ai/one-at-a-time')
    expect(models.filter((m) => m.id === 'fal-ai/flux/dev')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @boom-busters/providers exec vitest run src/catalogue/resolve.test.ts`
Expected: FAIL, `Cannot find module './resolve'`.

- [ ] **Step 3: Write the resolver**

Create `packages/providers/src/catalogue/resolve.ts`:

```ts
import {
  EMPTY_MODEL_PRICES,
  canonicalModelId,
  canonicalStillModelId,
  modelPriceKey,
} from '@boom-busters/schemas'
import type {
  ImagePriceOverride,
  LlmPriceOverride,
  LlmProvider,
  ModelPrices,
  StillProvider,
} from '@boom-busters/schemas'
import { LLM_MODELS } from '../llm/registry'
import type { KnownModel } from '../llm/types'
import { FAL_MODELS } from '../visuals/fal'
import { GEMINI_IMAGE_MODELS } from '../visuals/gemini'
import type { ImageGenModel } from '../visuals/types'
import { geminiImageFamily, llmFamily } from './families'
import type { ListedModel, PriceSource } from './types'

/**
 * Any model id to a price and a tier, from settings alone (decision 287).
 *
 * The order is the owner's override, the hand-written catalogue, fal's own
 * published price, then the family. `undefined` means unpriced, which every
 * caller refuses: an unpriced model would estimate $0 and walk through every
 * budget cap. Nothing here reads the network, so a list endpoint being down
 * can never stop a run.
 */

export interface ResolvedLlmModel {
  model: KnownModel
  source: PriceSource
}

export interface ResolvedImageModel {
  model: ImageGenModel
  source: PriceSource
}

function llmPriceFields(override: LlmPriceOverride) {
  return {
    inputPerMTok: override.inputPerMTok,
    outputPerMTok: override.outputPerMTok,
    ...(override.cachedInputPerMTok !== undefined
      ? { cachedInputPerMTok: override.cachedInputPerMTok }
      : {}),
  }
}

function imagePriceFields(override: ImagePriceOverride) {
  return {
    pricePerImage: override.pricePerImage,
    ...(override.pricesBySize ? { pricesBySize: override.pricesBySize } : {}),
  }
}

export function resolveLlmModel(
  provider: LlmProvider,
  modelId: string,
  prices: ModelPrices | undefined,
): ResolvedLlmModel | undefined {
  const id = canonicalModelId(provider, modelId)
  const override = (prices ?? EMPTY_MODEL_PRICES).llm[modelPriceKey(provider, id)]
  const catalogue = LLM_MODELS[provider]
  const listed = catalogue.find((model) => model.id === id)

  if (listed) {
    return override
      ? { model: { ...listed, ...llmPriceFields(override) }, source: 'override' }
      : { model: listed, source: 'catalogue' }
  }

  const family = llmFamily(provider, id)
  const representative = family
    ? catalogue.find((model) => model.id === family.representative)
    : undefined

  if (override) {
    return {
      model: {
        id,
        label: id,
        // A priced model with no family steps down to the provider's top
        // catalogued model when it fails, rather than skipping it.
        tier: representative?.tier ?? -1,
        supportsBatch: false,
        ...llmPriceFields(override),
      },
      source: 'override',
    }
  }

  if (!representative) return undefined
  return {
    model: {
      id,
      label: id,
      tier: representative.tier,
      inputPerMTok: representative.inputPerMTok,
      outputPerMTok: representative.outputPerMTok,
      ...(representative.cachedInputPerMTok !== undefined
        ? { cachedInputPerMTok: representative.cachedInputPerMTok }
        : {}),
      supportsBatch: false,
    },
    source: 'family',
  }
}

const IMAGE_CATALOGUES: Record<StillProvider, readonly ImageGenModel[]> = {
  google: GEMINI_IMAGE_MODELS,
  fal: FAL_MODELS,
}

export function resolveImageModel(
  provider: StillProvider,
  modelId: string,
  prices: ModelPrices | undefined,
  cached?: ListedModel,
): ResolvedImageModel | undefined {
  const id = canonicalStillModelId(modelId)
  const override = (prices ?? EMPTY_MODEL_PRICES).image[modelPriceKey(provider, id)]
  const listed = IMAGE_CATALOGUES[provider].find((model) => model.id === id)

  if (listed) {
    return override
      ? { model: { ...listed, ...imagePriceFields(override) }, source: 'override' }
      : { model: listed, source: 'catalogue' }
  }

  const label = cached?.label ?? id

  if (provider === 'fal') {
    // No dialect means a request shape this app cannot send: never choosable,
    // whatever its price.
    const dialect = cached?.dialect ?? null
    if (!dialect) return undefined
    if (override) return { model: { id, label, dialect, ...imagePriceFields(override) }, source: 'override' }
    if (cached?.pricePerImage != null) {
      return { model: { id, label, dialect, pricePerImage: cached.pricePerImage }, source: 'provider' }
    }
    return undefined
  }

  if (override) return { model: { id, label, ...imagePriceFields(override) }, source: 'override' }
  const family = geminiImageFamily(id)
  const representative = family
    ? GEMINI_IMAGE_MODELS.find((model) => model.id === family.representative)
    : undefined
  if (!representative) return undefined
  return {
    model: {
      id,
      label,
      pricePerImage: representative.pricePerImage,
      ...(representative.pricesBySize ? { pricesBySize: representative.pricesBySize } : {}),
    },
    source: 'family',
  }
}

/**
 * Every image model a run may use on this provider: the catalogue (repriced
 * by any override), then each cached live model that resolves. The adapters
 * from `liveImageGenWith` are built over this list.
 */
export function effectiveImageModels(
  provider: StillProvider,
  prices: ModelPrices | undefined,
  listed: readonly ListedModel[],
): ImageGenModel[] {
  const catalogue = IMAGE_CATALOGUES[provider]
  const known = new Set(catalogue.map((model) => model.id))
  const models = catalogue.map(
    (model) => resolveImageModel(provider, model.id, prices)?.model ?? model,
  )
  for (const row of listed) {
    if (row.kind !== 'image' || row.provider !== provider || known.has(row.id)) continue
    const resolved = resolveImageModel(provider, row.id, prices, row)
    if (resolved) {
      models.push(resolved.model)
      known.add(row.id)
    }
  }
  return models
}
```

Add `export * from './resolve'` to `packages/providers/src/catalogue/index.ts`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm --filter @boom-busters/providers exec vitest run src/catalogue`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format:check
git add packages/providers/src/catalogue
git commit -m "feat(catalogue): resolve any model id to a price from settings alone (decision 287)"
```

---

### Task 5: The router and the cost guard take the resolver

**Files:**
- Modify: `packages/providers/src/llm/types.ts`
- Modify: `packages/providers/src/llm/router.ts`
- Modify: `packages/cost/src/prices.ts`
- Modify: `apps/web/lib/llm.ts`
- Test: `packages/providers/src/llm/router.test.ts`, `packages/cost/src/prices.test.ts` (create it if the cost package has no test for prices; check `ls packages/cost/src`)

**Interfaces:**
- Consumes: `resolveLlmModel` (Task 4), `ModelPrices` (Task 2).
- Produces: `RouterConfig.resolveModel?: (provider: LlmProvider, modelId: string) => KnownModel | undefined`; `nextTierBelow(provider: LLMProvider, tier: number): KnownModel | undefined`; `llmPrice(provider, model, prices?)`; `estimateLlmUsd({ ..., prices? })`.

- [ ] **Step 1: Write the failing router tests**

Append to `packages/providers/src/llm/router.test.ts`:

```ts
describe('an injected resolver (decision 287)', () => {
  const live = {
    id: 'mock-live-9',
    label: 'mock-live-9',
    tier: 0,
    inputPerMTok: 7,
    outputPerMTok: 30,
    supportsBatch: false,
  }
  const resolveModel = (_provider: string, modelId: string) =>
    modelId === 'mock-live-9' ? live : undefined

  const liveRouting = { ...routing, research: { provider: 'anthropic' as const, model: 'mock-live-9' } }

  it('passes pre-flight for a model only the resolver knows, and settles at its price', async () => {
    const adapter = createMockLLM()
    const result = await route(
      config({ routing: liveRouting, adapters: { anthropic: adapter }, resolveModel }),
      request,
    )
    expect(adapter.calls[0]!.model).toBe('mock-live-9')
    const expected =
      (result.usage.inputTokens / 1_000_000) * 7 + (result.usage.outputTokens / 1_000_000) * 30
    expect(result.costUsd).toBeCloseTo(Math.round(expected * 10_000) / 10_000, 4)
  })

  it('steps down from a resolved model by its tier', () => {
    const path = fallbackPath(config({ routing: liveRouting, resolveModel }), 'research')
    expect(path.map((choice) => choice.model)).toEqual(['mock-live-9', 'mock-medium'])
  })

  it('refuses an id the resolver cannot price, before any call, naming Settings', () => {
    const adapter = createMockLLM()
    const unpriced = { ...routing, research: { provider: 'anthropic' as const, model: 'mystery' } }
    expect(() =>
      preflight(config({ routing: unpriced, adapters: { anthropic: adapter }, resolveModel }), 'research'),
    ).toThrow(/has no price, so the budget guard cannot estimate this call\. Set one in Settings → Models/)
    expect(adapter.calls).toHaveLength(0)
  })
})
```

The existing assertion at line 65 (`/budget guard cannot estimate/`) must keep passing with the new message.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @boom-busters/providers exec vitest run src/llm/router.test.ts`
Expected: FAIL; the first case is refused at pre-flight.

- [ ] **Step 3: Add `nextTierBelow`**

In `packages/providers/src/llm/types.ts`, replace `nextTierDown` with:

```ts
/**
 * The next catalogued model below a tier, or `undefined` at the bottom. Takes
 * a tier rather than an id so a live model (decision 287), which no adapter
 * lists, can step down from the tier its family gave it.
 */
export function nextTierBelow(provider: LLMProvider, tier: number): KnownModel | undefined {
  return provider.models.filter((m) => m.tier > tier).sort((a, b) => a.tier - b.tier)[0]
}

/**
 * The next model down within a provider, or `undefined` at the bottom.
 *
 * Ordering is by `tier` rather than by array position so that adding a model
 * in the middle of a provider's line-up cannot silently reorder the fallback
 * path.
 */
export function nextTierDown(provider: LLMProvider, modelId: string): KnownModel | undefined {
  const current = findModel(provider, modelId)
  return current ? nextTierBelow(provider, current.tier) : undefined
}
```

- [ ] **Step 4: Route through the resolver**

In `packages/providers/src/llm/router.ts`:

1. Import `nextTierBelow` and `KnownModel` instead of `nextTierDown`.
2. Add to `RouterConfig`:

```ts
  /**
   * Price and tier for a model id (decision 287). The web app passes one
   * that knows the owner's prices and live families; left out, only the
   * adapter's own list is known, which is what every test and mock run
   * relies on.
   */
  resolveModel?: (provider: LlmProvider, modelId: string) => KnownModel | undefined
```

3. Add below the constants:

```ts
function modelFor(
  config: RouterConfig,
  adapter: LLMProvider,
  provider: LlmProvider,
  modelId: string,
): KnownModel | undefined {
  return config.resolveModel ? config.resolveModel(provider, modelId) : findModel(adapter, modelId)
}
```

4. In `preflight`, replace the `findModel` check with:

```ts
  if (!modelFor(config, adapter, choice.provider, choice.model)) {
    throw new ValidationError(
      `${choice.provider} model "${choice.model}" has no price, so the budget guard cannot ` +
        'estimate this call. Set one in Settings → Models.',
      { field: `modelRouting.${task}.model` },
    )
  }
```

5. In `fallbackPath`, replace the tier-down lines with:

```ts
  const current = modelFor(config, adapter, choice.provider, choice.model)!
  const down = nextTierBelow(adapter, current.tier)
  if (down) path.push({ provider: choice.provider, model: down.id })
```

6. In `route`, replace `const model = findModel(adapter, choice.model)!` with:

```ts
        const model =
          modelFor(config, adapter, choice.provider, choice.model) ??
          findModel(adapter, choice.model)!
```

- [ ] **Step 5: Run the router tests to see them pass**

Run: `pnpm --filter @boom-busters/providers exec vitest run src/llm`
Expected: PASS.

- [ ] **Step 6: Write the failing cost tests**

In `packages/cost/src/prices.test.ts` (create it with these imports if it does not exist):

```ts
import { EMPTY_MODEL_PRICES, ValidationError } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { estimateLlmUsd, llmPrice } from './prices'

describe('llmPrice with live models (decision 287)', () => {
  it('prices a live family member at its family', () => {
    expect(llmPrice('anthropic', 'claude-opus-5-5')).toEqual({ inputPerMTok: 5, outputPerMTok: 25 })
  })

  it('prefers the owner's price', () => {
    const prices = {
      ...EMPTY_MODEL_PRICES,
      llm: { 'anthropic:claude-opus-5-5': { inputPerMTok: 4, outputPerMTok: 20 } },
    }
    expect(
      estimateLlmUsd({
        provider: 'anthropic',
        model: 'claude-opus-5-5',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        prices,
      }),
    ).toBe(24)
  })

  it('still refuses an unpriced model rather than estimating $0', () => {
    expect(() => llmPrice('anthropic', 'claude-fable-5-1')).toThrow(ValidationError)
  })
})
```

Run: `pnpm --filter @boom-busters/cost exec vitest run src/prices.test.ts`
Expected: FAIL; `claude-opus-5-5` throws.

- [ ] **Step 7: Price through the resolver**

In `packages/cost/src/prices.ts`, import `resolveLlmModel` from `@boom-busters/providers` and the `ModelPrices` type from `@boom-busters/schemas`, then replace `llmPrice` and `estimateLlmUsd`:

```ts
export function llmPrice(provider: LlmProvider, model: string, prices?: ModelPrices): LlmPrice {
  const resolved = resolveLlmModel(provider, model, prices)
  if (!resolved) {
    throw new ValidationError(
      `No price for ${provider}/${model}. Set one in Settings → Models before routing a task ` +
        'at it: an unpriced model would estimate $0 and walk straight through every budget cap.',
      { field: 'modelRouting' },
    )
  }
  return { inputPerMTok: resolved.model.inputPerMTok, outputPerMTok: resolved.model.outputPerMTok }
}

export function estimateLlmUsd(args: {
  provider: LlmProvider
  model: string
  inputTokens: number
  outputTokens: number
  prices?: ModelPrices
}): number {
  const price = llmPrice(args.provider, args.model, args.prices)
  return (
    (args.inputTokens / 1_000_000) * price.inputPerMTok +
    (args.outputTokens / 1_000_000) * price.outputPerMTok
  )
}
```

Keep `LLM_PRICES` and its comment; grep shows nothing else reads it, but removing it is not this task.

- [ ] **Step 8: Wire `callLlm`**

In `apps/web/lib/llm.ts`, import `findModel`, `resolveLlmModel` from `@boom-busters/providers`. Before `withCost`, add:

```ts
  const adapters = llmAdapters()
  // The owner's prices and live families first; the adapter's own list
  // second, which is what mock mode's `mock-*` ids resolve through.
  const resolveModel = (provider: LlmProvider, modelId: string) =>
    resolveLlmModel(provider, modelId, settings.modelPrices)?.model ??
    findModel(adapters[provider], modelId)
```

(import the `LlmProvider` type from `@boom-busters/schemas`). Pass `prices: settings.modelPrices` into `estimateLlmUsd({...})`, and in the `route` config replace `adapters: llmAdapters()` with `adapters, resolveModel`.

- [ ] **Step 9: Run every consuming suite**

Run (Bash `timeout` 600000): `pnpm --filter @boom-busters/providers test && pnpm --filter @boom-busters/cost test && pnpm --filter @boom-busters/web test && pnpm typecheck`
Expected: PASS. A web test that mocks `getSettings` with a literal lacking `modelPrices` still works because `resolveLlmModel` treats missing prices as none.

- [ ] **Step 10: Commit**

```bash
pnpm format:check
git add packages/providers/src/llm packages/cost apps/web/lib/llm.ts
git commit -m "feat(router): pre-flight and the cost guard price live models (decision 287)"
```

---

### Task 6: Listing each provider's models

**Files:**
- Create: `packages/providers/src/catalogue/http.ts`, `list-anthropic.ts`, `list-openai.ts`, `list-google.ts`, `fal-dialect.ts`, `list-fal.ts`, `listing.ts`, `mock-listing.ts`
- Modify: `packages/providers/src/catalogue/index.ts`
- Test: `packages/providers/src/catalogue/listing.test.ts`, `packages/providers/src/catalogue/fal-dialect.test.ts`

**Interfaces:**
- Consumes: `ListedModel`, `CatalogueProvider` (Task 1); `mapNetworkError`, `throwForResponse` (`llm/http.ts`); `LLM_MODELS`, `GEMINI_IMAGE_MODELS`, `FAL_MODELS`.
- Produces: `ListOptions { fetchImpl?: typeof fetch; signal?: AbortSignal }`; `listProviderModels(provider: CatalogueProvider, apiKey: string, options?: ListOptions): Promise<ListedModel[]>`; `falDialect(openapi: unknown): FalDialect | null`; `mockListedModels(provider: CatalogueProvider): ListedModel[]`; `MOCK_LIVE_MODEL_IDS`.

- [ ] **Step 1: Write the failing dialect tests**

Create `packages/providers/src/catalogue/fal-dialect.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { falDialect } from './fal-dialect'

function openapi(properties: string[], via: 'ref' | 'name' = 'ref') {
  const schema = { type: 'object', properties: Object.fromEntries(properties.map((p) => [p, {}])) }
  return {
    paths:
      via === 'ref'
        ? {
            '/fal-ai/x': {
              post: {
                requestBody: {
                  content: { 'application/json': { schema: { $ref: '#/components/schemas/XIn' } } },
                },
              },
            },
          }
        : {},
    components: { schemas: via === 'ref' ? { XIn: schema } : { XInput: schema } },
  }
}

describe('falDialect (decision 287)', () => {
  it('reads flux, aspect and aspect-negative from the input schema', () => {
    expect(falDialect(openapi(['prompt', 'num_images', 'image_size']))).toBe('flux')
    expect(falDialect(openapi(['prompt', 'num_images', 'aspect_ratio']))).toBe('aspect')
    expect(falDialect(openapi(['prompt', 'num_images', 'aspect_ratio', 'negative_prompt']))).toBe(
      'aspect-negative',
    )
  })

  it('falls back to a schema named ...Input', () => {
    expect(falDialect(openapi(['prompt', 'num_images', 'image_size'], 'name'))).toBe('flux')
  })

  it('refuses an endpoint that makes one image per request, or has no schema', () => {
    expect(falDialect(openapi(['prompt', 'image_size']))).toBeNull()
    expect(falDialect(undefined)).toBeNull()
    expect(falDialect({ error: 'expansion failed' })).toBeNull()
  })
})
```

- [ ] **Step 2: Write the failing listing tests**

Create `packages/providers/src/catalogue/listing.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { listProviderModels } from './listing'
import { mockListedModels } from './mock-listing'

/** Answers each URL from a table, and records what was asked. */
function serve(table: Record<string, unknown | ((url: string) => unknown)>, status = 200) {
  const urls: string[] = []
  const fetchImpl = (async (input: string | URL) => {
    const url = String(input)
    urls.push(url)
    const key = Object.keys(table).find((prefix) => url.startsWith(prefix))
    if (!key) return new Response('{}', { status: 404 })
    const entry = table[key]
    const body = typeof entry === 'function' ? (entry as (url: string) => unknown)(url) : entry
    return new Response(JSON.stringify(body), { status })
  }) as typeof fetch
  return { fetchImpl, urls }
}

describe('listProviderModels (decision 287)', () => {
  it('pages Anthropic by last_id and keeps the token limits', async () => {
    const { fetchImpl, urls } = serve({
      'https://api.anthropic.com/v1/models': (url: string) =>
        url.includes('after_id=claude-opus-5-5')
          ? { data: [{ id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5' }], has_more: false, last_id: 'claude-haiku-4-5-20251001' }
          : {
              data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', max_input_tokens: 1_000_000, max_tokens: 128_000 }],
              has_more: true,
              last_id: 'claude-opus-5-5',
            },
    })
    const models = await listProviderModels('anthropic', 'k', { fetchImpl })
    expect(urls).toHaveLength(2)
    expect(models.map((m) => m.id)).toEqual(['claude-opus-5-5', 'claude-haiku-4-5-20251001'])
    expect(models[0]).toMatchObject({ label: 'Claude Opus 5.5', contextTokens: 1_000_000, maxOutputTokens: 128_000, kind: 'llm' })
  })

  it('keeps OpenAI chat models only, and drops a dated snapshot of a listed alias', async () => {
    const { fetchImpl } = serve({
      'https://api.openai.com/v1/models': {
        data: [
          { id: 'gpt-5.5' },
          { id: 'gpt-5.5-2026-08-01' },
          { id: 'gpt-5.4-2026-01-01' },
          { id: 'o5' },
          { id: 'text-embedding-4' },
          { id: 'gpt-5-realtime' },
          { id: 'gpt-image-2' },
          { id: 'whisper-2' },
        ],
      },
    })
    const ids = (await listProviderModels('openai', 'k', { fetchImpl })).map((m) => m.id)
    expect(ids).toEqual(['gpt-5.5', 'gpt-5.4-2026-01-01', 'o5'])
  })

  it('splits Google by kind, flags previews, pages, and drops legacy ids', async () => {
    const { fetchImpl } = serve({
      'https://generativelanguage.googleapis.com/v1beta/models': (url: string) =>
        url.includes('pageToken=p2')
          ? { models: [{ name: 'models/gemini-9-pro-image', displayName: 'Gemini 9 Pro Image', supportedGenerationMethods: ['generateContent'] }] }
          : {
              models: [
                { name: 'models/gemini-9-flash', displayName: 'Gemini 9 Flash', inputTokenLimit: 1_048_576, outputTokenLimit: 65_536, supportedGenerationMethods: ['generateContent'] },
                { name: 'models/gemini-9-pro-preview', displayName: 'Gemini 9 Pro Preview', supportedGenerationMethods: ['generateContent'] },
                { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent'] },
                { name: 'models/text-embedding-005', supportedGenerationMethods: ['embedContent'] },
                { name: 'models/gemini-9-flash-tts', supportedGenerationMethods: ['generateContent'] },
              ],
              nextPageToken: 'p2',
            },
    })
    const models = await listProviderModels('google', 'k', { fetchImpl })
    expect(models.map((m) => [m.id, m.kind, m.preview])).toEqual([
      ['gemini-9-flash', 'llm', false],
      ['gemini-9-pro-preview', 'llm', true],
      ['gemini-9-pro-image', 'image', false],
    ])
  })

  it('reads fal dialects and joins image prices, ignoring per-megapixel ones', async () => {
    const schema = (props: string[]) => ({
      components: { schemas: { XInput: { properties: Object.fromEntries(props.map((p) => [p, {}])) } } },
    })
    const { fetchImpl, urls } = serve({
      'https://api.fal.ai/v1/models/pricing': {
        prices: [
          { endpoint_id: 'fal-ai/new-flux', unit_price: 0.02, unit: 'image', currency: 'USD' },
          { endpoint_id: 'fal-ai/megapixel', unit_price: 0.012, unit: 'megapixel', currency: 'USD' },
        ],
        has_more: false,
      },
      'https://api.fal.ai/v1/models': {
        models: [
          { endpoint_id: 'fal-ai/new-flux', metadata: { display_name: 'New FLUX' }, openapi: schema(['prompt', 'num_images', 'image_size']) },
          { endpoint_id: 'fal-ai/megapixel', metadata: { display_name: 'Megapixel' }, openapi: schema(['prompt', 'num_images', 'image_size']) },
          { endpoint_id: 'fal-ai/single', metadata: { display_name: 'Single' }, openapi: schema(['prompt', 'image_size']) },
        ],
        has_more: false,
      },
    })
    const models = await listProviderModels('fal', 'k', { fetchImpl })
    expect(urls[0]).toContain('category=text-to-image')
    expect(urls[0]).toContain('expand=openapi-3.0')
    expect(models.map((m) => [m.id, m.dialect, m.pricePerImage])).toEqual([
      ['fal-ai/new-flux', 'flux', 0.02],
      ['fal-ai/megapixel', 'flux', null],
      ['fal-ai/single', null, null],
    ])
  })

  it('fails the whole fal refresh when its pricing call fails', async () => {
    const search = {
      models: [
        {
          endpoint_id: 'fal-ai/new-flux',
          openapi: {
            components: {
              schemas: { XInput: { properties: { prompt: {}, num_images: {}, image_size: {} } } },
            },
          },
        },
      ],
      has_more: false,
    }
    const fetchImpl = (async (input: string | URL) =>
      String(input).includes('/pricing')
        ? new Response('{"detail":"down"}', { status: 503 })
        : new Response(JSON.stringify(search), { status: 200 })) as typeof fetch
    await expect(listProviderModels('fal', 'k', { fetchImpl })).rejects.toThrow()
  })

  it('counts an empty list as a failure, so a bad filter cannot wipe a dropdown', async () => {
    const { fetchImpl } = serve({ 'https://api.openai.com/v1/models': { data: [{ id: 'whisper-2' }] } })
    await expect(listProviderModels('openai', 'k', { fetchImpl })).rejects.toThrow(
      /openai listed no models this app can use/,
    )
  })

  it('maps a rejected key to the shared error taxonomy', async () => {
    const { fetchImpl } = serve({ 'https://api.anthropic.com/v1/models': { error: { message: 'bad key' } } }, 401)
    await expect(listProviderModels('anthropic', 'bad', { fetchImpl })).rejects.toThrow()
  })
})

describe('mockListedModels', () => {
  it('holds the catalogue and the live-only fixtures, with no network', () => {
    expect(mockListedModels('anthropic').map((m) => m.id)).toEqual(
      expect.arrayContaining(['claude-opus-5', 'claude-opus-mock-9', 'claude-mock-unpriced']),
    )
    expect(mockListedModels('google').some((m) => m.id === 'gemini-9-flash-image' && m.kind === 'image')).toBe(true)
    expect(mockListedModels('fal').find((m) => m.id === 'fal-ai/mock-flux')).toMatchObject({ dialect: 'flux', pricePerImage: 0.02 })
  })
})
```

The fal-pricing-failure case is written in a roundabout way; simplify it if you like, as long as it serves a good search response and a 503 for `/pricing` and expects a rejection.

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm --filter @boom-busters/providers exec vitest run src/catalogue/listing.test.ts src/catalogue/fal-dialect.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Write the GET helper**

Create `packages/providers/src/catalogue/http.ts`:

```ts
import { mapNetworkError, throwForResponse } from '../llm/http'

export interface ListOptions {
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

/** Every list endpoint pages; this caps a runaway cursor. */
export const MAX_PAGES = 20

/** One authenticated GET, failures mapped to the shared taxonomy. */
export async function getJson(
  provider: string,
  url: string,
  headers: Record<string, string>,
  options: ListOptions,
): Promise<unknown> {
  const doFetch = options.fetchImpl ?? fetch
  let response: Response
  try {
    response = await doFetch(url, {
      method: 'GET',
      headers,
      ...(options.signal ? { signal: options.signal } : {}),
    })
  } catch (cause) {
    throw mapNetworkError(provider, cause)
  }
  if (!response.ok) await throwForResponse(provider, response)
  return response.json()
}
```

- [ ] **Step 5: Write the four listers**

Create `packages/providers/src/catalogue/list-anthropic.ts`:

```ts
import { z } from 'zod'
import { getJson, MAX_PAGES, type ListOptions } from './http'
import type { ListedModel } from './types'

const PageSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      display_name: z.string().optional(),
      max_input_tokens: z.number().nullish(),
      max_tokens: z.number().nullish(),
    }),
  ),
  has_more: z.boolean(),
  last_id: z.string().nullish(),
})

export async function listAnthropicModels(apiKey: string, options: ListOptions): Promise<ListedModel[]> {
  const models: ListedModel[] = []
  let after: string | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url =
      'https://api.anthropic.com/v1/models?limit=1000' +
      (after ? `&after_id=${encodeURIComponent(after)}` : '')
    const parsed = PageSchema.parse(
      await getJson('anthropic', url, { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, options),
    )
    for (const model of parsed.data) {
      models.push({
        provider: 'anthropic',
        id: model.id,
        label: model.display_name ?? model.id,
        kind: 'llm',
        preview: false,
        contextTokens: model.max_input_tokens ?? null,
        maxOutputTokens: model.max_tokens ?? null,
        dialect: null,
        pricePerImage: null,
      })
    }
    if (!parsed.has_more || !parsed.last_id) break
    after = parsed.last_id
  }
  return models
}
```

Create `packages/providers/src/catalogue/list-openai.ts`:

```ts
import { z } from 'zod'
import { getJson, type ListOptions } from './http'
import type { ListedModel } from './types'

const ResponseSchema = z.object({ data: z.array(z.object({ id: z.string() })) })

/** Words that mark a model this app's chat calls cannot use. */
const EXCLUDED = [
  'embedding',
  'tts',
  'transcribe',
  'audio',
  'realtime',
  'image',
  'search',
  'moderation',
  'dall-e',
  'whisper',
]
const DATED = /-\d{4}-\d{2}-\d{2}$/

export async function listOpenAiModels(apiKey: string, options: ListOptions): Promise<ListedModel[]> {
  const parsed = ResponseSchema.parse(
    await getJson('openai', 'https://api.openai.com/v1/models', { Authorization: `Bearer ${apiKey}` }, options),
  )
  const chat = parsed.data
    .map((model) => model.id)
    .filter((id) => (id.startsWith('gpt-') || /^o\d/.test(id)) && !EXCLUDED.some((word) => id.includes(word)))
  const ids = new Set(chat)
  return chat
    .filter((id) => !(DATED.test(id) && ids.has(id.replace(DATED, ''))))
    .map((id) => ({
      provider: 'openai' as const,
      id,
      label: id,
      kind: 'llm' as const,
      preview: false,
      contextTokens: null,
      maxOutputTokens: null,
      dialect: null,
      pricePerImage: null,
    }))
}
```

Create `packages/providers/src/catalogue/list-google.ts`:

```ts
import { z } from 'zod'
import { getJson, MAX_PAGES, type ListOptions } from './http'
import type { ListedModel } from './types'

const PageSchema = z.object({
  models: z
    .array(
      z.object({
        name: z.string(),
        displayName: z.string().optional(),
        inputTokenLimit: z.number().optional(),
        outputTokenLimit: z.number().optional(),
        supportedGenerationMethods: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  nextPageToken: z.string().optional(),
})

const EXCLUDED = ['embedding', 'tts', 'audio', 'live', 'aqa']

export async function listGoogleModels(apiKey: string, options: ListOptions): Promise<ListedModel[]> {
  const models: ListedModel[] = []
  let token: string | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000' +
      (token ? `&pageToken=${encodeURIComponent(token)}` : '')
    const parsed = PageSchema.parse(await getJson('google', url, { 'x-goog-api-key': apiKey }, options))
    for (const model of parsed.models) {
      const id = model.name.replace(/^models\//, '')
      if (!model.supportedGenerationMethods.includes('generateContent')) continue
      if (EXCLUDED.some((word) => id.includes(word))) continue
      models.push({
        provider: 'google',
        id,
        label: model.displayName ?? id,
        kind: id.includes('-image') ? 'image' : 'llm',
        preview: /-preview|-exp/.test(id),
        contextTokens: model.inputTokenLimit ?? null,
        maxOutputTokens: model.outputTokenLimit ?? null,
        dialect: null,
        pricePerImage: null,
      })
    }
    if (!parsed.nextPageToken) break
    token = parsed.nextPageToken
  }
  return models
}
```

Create `packages/providers/src/catalogue/fal-dialect.ts`:

```ts
import type { FalDialect } from '../visuals/types'

type Json = Record<string, unknown>
const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The input schema fal publishes for an endpoint: the one its POST
 * `requestBody` references, or failing that the first schema named
 * `...Input`. Null when the document has neither.
 */
function inputSchema(openapi: unknown): Json | null {
  if (!isRecord(openapi)) return null
  const components = isRecord(openapi['components']) ? openapi['components'] : {}
  const schemas = isRecord(components['schemas']) ? components['schemas'] : {}
  const paths = isRecord(openapi['paths']) ? openapi['paths'] : {}

  for (const path of Object.values(paths)) {
    if (!isRecord(path) || !isRecord(path['post'])) continue
    const body = path['post']['requestBody']
    const content = isRecord(body) && isRecord(body['content']) ? body['content'] : {}
    const json = isRecord(content['application/json']) ? content['application/json'] : {}
    const schema = isRecord(json['schema']) ? json['schema'] : null
    if (!schema) continue
    const ref = typeof schema['$ref'] === 'string' ? schema['$ref'] : null
    if (ref) {
      const target = schemas[ref.replace('#/components/schemas/', '')]
      if (isRecord(target)) return target
    } else if (isRecord(schema['properties'])) {
      return schema
    }
  }

  const named = Object.entries(schemas).find(([name, value]) => name.endsWith('Input') && isRecord(value))
  return named ? (named[1] as Json) : null
}

/** Which request shape an endpoint speaks, or null if this app cannot send it one (decision 287). */
export function falDialect(openapi: unknown): FalDialect | null {
  const schema = inputSchema(openapi)
  const properties = schema && isRecord(schema['properties']) ? schema['properties'] : null
  if (!properties) return null
  const has = (field: string) => field in properties
  // The board buys several variants in one call; an endpoint without
  // num_images makes one image per request and cannot serve it.
  if (!has('prompt') || !has('num_images')) return null
  if (has('image_size')) return 'flux'
  if (has('aspect_ratio')) return has('negative_prompt') ? 'aspect-negative' : 'aspect'
  return null
}
```

Create `packages/providers/src/catalogue/list-fal.ts`:

```ts
import { z } from 'zod'
import { falDialect } from './fal-dialect'
import { getJson, MAX_PAGES, type ListOptions } from './http'
import type { ListedModel } from './types'

const SearchSchema = z.object({
  models: z.array(
    z.object({
      endpoint_id: z.string(),
      metadata: z.object({ display_name: z.string().optional() }).partial().optional(),
      openapi: z.unknown().optional(),
    }),
  ),
  next_cursor: z.string().nullish(),
  has_more: z.boolean().optional(),
})

const PricingSchema = z.object({
  prices: z.array(
    z.object({ endpoint_id: z.string(), unit_price: z.number(), unit: z.string(), currency: z.string() }),
  ),
})

const PRICING_BATCH = 50

export async function listFalModels(apiKey: string, options: ListOptions): Promise<ListedModel[]> {
  const headers = { Authorization: `Key ${apiKey}` }
  const found: z.infer<typeof SearchSchema>['models'] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url =
      'https://api.fal.ai/v1/models?category=text-to-image&status=active&expand=openapi-3.0' +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '')
    const parsed = SearchSchema.parse(await getJson('fal', url, headers, options))
    found.push(...parsed.models)
    if (!parsed.has_more || !parsed.next_cursor) break
    cursor = parsed.next_cursor
  }

  // A pricing failure fails the whole refresh: half a list, every model
  // "needs a price", is worse than yesterday's list.
  const prices = new Map<string, number>()
  for (let start = 0; start < found.length; start += PRICING_BATCH) {
    const ids = found.slice(start, start + PRICING_BATCH).map((model) => model.endpoint_id)
    const url = `https://api.fal.ai/v1/models/pricing?endpoint_id=${ids.map(encodeURIComponent).join(',')}`
    const parsed = PricingSchema.parse(await getJson('fal', url, headers, options))
    for (const price of parsed.prices) {
      // Only a USD price per image is a price per image; FLUX.2 bills per
      // megapixel, and guessing the conversion would misprice every still.
      if (price.unit === 'image' && price.currency === 'USD') prices.set(price.endpoint_id, price.unit_price)
    }
  }

  return found.map((model) => ({
    provider: 'fal',
    id: model.endpoint_id,
    label: model.metadata?.display_name ?? model.endpoint_id,
    kind: 'image',
    preview: false,
    contextTokens: null,
    maxOutputTokens: null,
    dialect: falDialect(model.openapi),
    pricePerImage: prices.get(model.endpoint_id) ?? null,
  }))
}
```

- [ ] **Step 6: Write the dispatcher and the mock fixtures**

Create `packages/providers/src/catalogue/listing.ts`:

```ts
import { canonicalModelId, canonicalStillModelId } from '@boom-busters/schemas'
import type { ListOptions } from './http'
import { listAnthropicModels } from './list-anthropic'
import { listFalModels } from './list-fal'
import { listGoogleModels } from './list-google'
import { listOpenAiModels } from './list-openai'
import type { CatalogueProvider, ListedModel } from './types'

export type { ListOptions } from './http'

const LISTERS: Record<
  CatalogueProvider,
  (apiKey: string, options: ListOptions) => Promise<ListedModel[]>
> = {
  anthropic: listAnthropicModels,
  openai: listOpenAiModels,
  google: listGoogleModels,
  fal: listFalModels,
}

/**
 * What a provider serves now (decision 287), minus ids the legacy maps fold
 * forward: those are known to be dead or renamed (`gemini-2.5-pro` is listed
 * and then refused), and offering them would undo the fold.
 *
 * An empty result throws. A filter gone wrong must not wipe a dropdown; the
 * caller keeps the last good list.
 */
export async function listProviderModels(
  provider: CatalogueProvider,
  apiKey: string,
  options: ListOptions = {},
): Promise<ListedModel[]> {
  const listed = await LISTERS[provider](apiKey, options)
  const current = listed.filter((model) =>
    model.kind === 'image'
      ? canonicalStillModelId(model.id) === model.id
      : provider === 'fal' || canonicalModelId(provider, model.id) === model.id,
  )
  if (current.length === 0) throw new Error(`${provider} listed no models this app can use`)
  return current
}
```

Create `packages/providers/src/catalogue/mock-listing.ts`:

```ts
import { LLM_MODELS } from '../llm/registry'
import { FAL_MODELS } from '../visuals/fal'
import { GEMINI_IMAGE_MODELS } from '../visuals/gemini'
import type { CatalogueProvider, ListedModel } from './types'

/**
 * The lists `MOCK_PROVIDERS=1` refreshes from (decision 287): every
 * catalogued model, plus live-only ones that exercise each label without a
 * network: a family match, a family-less model, a live Gemini image model,
 * and a priced fal endpoint.
 */

const base = { preview: false, contextTokens: null, maxOutputTokens: null, dialect: null, pricePerImage: null }

const llm = (provider: 'anthropic' | 'openai' | 'google', id: string, label: string): ListedModel => ({
  ...base,
  provider,
  id,
  label,
  kind: 'llm',
})

export const MOCK_LIVE_MODEL_IDS = {
  anthropicFamily: 'claude-opus-mock-9',
  anthropicUnpriced: 'claude-mock-unpriced',
  openaiFamily: 'gpt-5-mock',
  googleFamily: 'gemini-9-flash',
  googleImage: 'gemini-9-flash-image',
  falPriced: 'fal-ai/mock-flux',
} as const

export function mockListedModels(provider: CatalogueProvider): ListedModel[] {
  switch (provider) {
    case 'anthropic':
      return [
        ...LLM_MODELS.anthropic.map((m) => llm('anthropic', m.id, m.label)),
        llm('anthropic', MOCK_LIVE_MODEL_IDS.anthropicFamily, 'Claude Opus Mock 9'),
        llm('anthropic', MOCK_LIVE_MODEL_IDS.anthropicUnpriced, 'Claude Mock Unpriced'),
      ]
    case 'openai':
      return [
        ...LLM_MODELS.openai.map((m) => llm('openai', m.id, m.label)),
        llm('openai', MOCK_LIVE_MODEL_IDS.openaiFamily, 'gpt-5-mock'),
      ]
    case 'google':
      return [
        ...LLM_MODELS.google.map((m) => llm('google', m.id, m.label)),
        llm('google', MOCK_LIVE_MODEL_IDS.googleFamily, 'Gemini 9 Flash (mock)'),
        ...GEMINI_IMAGE_MODELS.map((m) => ({ ...base, provider: 'google' as const, id: m.id, label: m.label, kind: 'image' as const })),
        { ...base, provider: 'google', id: MOCK_LIVE_MODEL_IDS.googleImage, label: 'Gemini 9 Flash Image (mock)', kind: 'image' },
      ]
    case 'fal':
      return [
        ...FAL_MODELS.map((m) => ({
          ...base,
          provider: 'fal' as const,
          id: m.id,
          label: m.label,
          kind: 'image' as const,
          dialect: m.dialect ?? 'flux',
          pricePerImage: m.pricePerImage,
        })),
        { ...base, provider: 'fal', id: MOCK_LIVE_MODEL_IDS.falPriced, label: 'Mock FLUX', kind: 'image', dialect: 'flux', pricePerImage: 0.02 },
      ]
  }
}
```

Add to `packages/providers/src/catalogue/index.ts`:

```ts
export * from './listing'
export * from './mock-listing'
export { falDialect } from './fal-dialect'
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `pnpm --filter @boom-busters/providers exec vitest run src/catalogue`
Expected: PASS.

- [ ] **Step 8: Run the providers suite and typecheck**

Run (Bash `timeout` 600000): `pnpm --filter @boom-busters/providers test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
pnpm format:check
git add packages/providers/src/catalogue
git commit -m "feat(catalogue): list what Anthropic, OpenAI, Google and fal serve now (decision 287)"
```

---

### Task 7: The model cache tables and queries

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/src/model-catalogue.ts`
- Modify: `packages/db/src/index.ts`
- Create: the migration `drizzle-kit` generates in `packages/db/drizzle/` (keep its generated name; it will be `0032_<words>.sql`)
- Test: `packages/db/src/model-catalogue.integration.test.ts`

**Interfaces:**
- Produces: tables `modelCatalogue`, `modelCatalogueRefresh`; types `CatalogueModelRow`, `CatalogueModelInput`, `CatalogueRefreshRow`; `listCatalogueModels(db)`, `listCatalogueRefresh(db)`, `replaceCatalogue(db, provider, models, at)`, `recordCatalogueFailure(db, provider, error, at)`.

`packages/db` does not import `packages/providers`, so these types are its own; `apps/web` maps them to `ListedModel` (Task 9).

- [ ] **Step 1: Write the failing integration test**

Create `packages/db/src/model-catalogue.integration.test.ts`, following `logos.integration.test.ts`:

```ts
import { sql as dsql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb } from './client'
import {
  listCatalogueModels,
  listCatalogueRefresh,
  recordCatalogueFailure,
  replaceCatalogue,
  type CatalogueModelInput,
} from './model-catalogue'
import { modelCatalogue, modelCatalogueRefresh } from './schema'
import { requireTestDatabase } from './test-database'

/** The live model cache (decision 287) against a real database. */

const url = requireTestDatabase()
const suite = url ? describe : describe.skip

const model = (id: string, over: Partial<CatalogueModelInput> = {}): CatalogueModelInput => ({
  modelId: id,
  kind: 'llm',
  label: id,
  preview: false,
  contextTokens: null,
  maxOutputTokens: null,
  dialect: null,
  pricePerImage: null,
  ...over,
})

suite('the model cache', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 4 })

  beforeEach(async () => {
    await db.execute(dsql`truncate table ${modelCatalogue}, ${modelCatalogueRefresh}`)
  })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  it('replaces a provider's rows on success and stamps the refresh', async () => {
    const first = new Date('2026-10-01T09:00:00Z')
    await replaceCatalogue(db, 'anthropic', [model('claude-opus-5'), model('claude-opus-5-5')], first)
    const second = new Date('2026-10-01T10:00:00Z')
    await replaceCatalogue(db, 'anthropic', [model('claude-opus-5-5')], second)

    expect((await listCatalogueModels(db)).map((row) => row.modelId)).toEqual(['claude-opus-5-5'])
    expect(await listCatalogueRefresh(db)).toEqual([
      expect.objectContaining({ provider: 'anthropic', lastSuccessAt: second, lastError: null }),
    ])
  })

  it('keeps the rows on failure and records the error', async () => {
    await replaceCatalogue(db, 'fal', [model('fal-ai/x', { kind: 'image', pricePerImage: 0.02, dialect: 'flux' })], new Date('2026-10-01T09:00:00Z'))
    const failedAt = new Date('2026-10-01T11:00:00Z')
    await recordCatalogueFailure(db, 'fal', 'key rejected', failedAt)

    const rows = await listCatalogueModels(db)
    expect(rows).toEqual([expect.objectContaining({ modelId: 'fal-ai/x', pricePerImage: 0.02, dialect: 'flux' })])
    expect(await listCatalogueRefresh(db)).toEqual([
      expect.objectContaining({ provider: 'fal', lastAttemptAt: failedAt, lastError: 'key rejected' }),
    ])
  })

  it('survives two refreshes of one provider landing at once', async () => {
    const at = new Date('2026-10-01T12:00:00Z')
    await Promise.all([
      replaceCatalogue(db, 'openai', [model('gpt-5'), model('gpt-5.5')], at),
      replaceCatalogue(db, 'openai', [model('gpt-5'), model('gpt-5.5')], at),
    ])
    expect((await listCatalogueModels(db)).map((row) => row.modelId).sort()).toEqual(['gpt-5', 'gpt-5.5'])
    expect((await listCatalogueRefresh(db))[0]?.lastError).toBeNull()
  })
})
```

- [ ] **Step 2: Add the tables**

In `packages/db/src/schema.ts`, after `providerCredentials`, add:

```ts
/**
 * What each provider's list endpoint last said it serves (decision 287).
 * A cache, rebuilt per provider on each successful refresh; the Models tab
 * and the image adapters read it, and nothing else depends on it being
 * fresh. Prices the owner sets live in `settings.modelPrices`, not here.
 */
export const modelCatalogue = pgTable(
  'model_catalogue',
  {
    id: id(),
    /** 'anthropic' | 'openai' | 'google' | 'fal' */
    provider: text('provider').notNull(),
    modelId: text('model_id').notNull(),
    /** 'llm' | 'image' */
    kind: text('kind').notNull(),
    label: text('label').notNull(),
    preview: boolean('preview').notNull().default(false),
    contextTokens: integer('context_tokens'),
    maxOutputTokens: integer('max_output_tokens'),
    /** fal only: 'flux' | 'aspect' | 'aspect-negative', null when unsendable. */
    dialect: text('dialect'),
    /** fal only: its own USD price per image. */
    pricePerImage: usd('price_per_image'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('model_catalogue_provider_model_key').on(t.provider, t.modelId)],
)

/** When each provider's list was last asked for, and how it went. */
export const modelCatalogueRefresh = pgTable(
  'model_catalogue_refresh',
  {
    id: id(),
    provider: text('provider').notNull(),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }).notNull(),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('model_catalogue_refresh_provider_key').on(t.provider)],
)
```

`usd` is the existing `numeric(12,4)` helper, so a four-decimal price per image fits.

- [ ] **Step 3: Generate the migration**

Run: `pnpm db:generate`
Expected: one new file `packages/db/drizzle/0032_<words>.sql` creating both tables and their unique constraints, and an updated `packages/db/drizzle/meta/` journal and snapshot. Read the SQL; it must contain no `DROP` and touch no other table.

- [ ] **Step 4: Write the queries**

Create `packages/db/src/model-catalogue.ts`:

```ts
import { asc, eq, notInArray, and } from 'drizzle-orm'
import type { Database } from './client'
import { modelCatalogue, modelCatalogueRefresh } from './schema'

/** One model as the cache stores it (decision 287). */
export interface CatalogueModelInput {
  modelId: string
  kind: 'llm' | 'image'
  label: string
  preview: boolean
  contextTokens: number | null
  maxOutputTokens: number | null
  dialect: string | null
  pricePerImage: number | null
}

export interface CatalogueModelRow extends CatalogueModelInput {
  provider: string
  fetchedAt: Date
}

export interface CatalogueRefreshRow {
  provider: string
  lastAttemptAt: Date
  lastSuccessAt: Date | null
  lastError: string | null
}

export async function listCatalogueModels(db: Database): Promise<CatalogueModelRow[]> {
  const rows = await db
    .select()
    .from(modelCatalogue)
    .orderBy(asc(modelCatalogue.provider), asc(modelCatalogue.label))
  return rows.map((row) => ({
    provider: row.provider,
    modelId: row.modelId,
    kind: row.kind === 'image' ? 'image' : 'llm',
    label: row.label,
    preview: row.preview,
    contextTokens: row.contextTokens,
    maxOutputTokens: row.maxOutputTokens,
    dialect: row.dialect,
    pricePerImage: row.pricePerImage === null ? null : Number(row.pricePerImage),
    fetchedAt: row.fetchedAt,
  }))
}

export async function listCatalogueRefresh(db: Database): Promise<CatalogueRefreshRow[]> {
  return db
    .select({
      provider: modelCatalogueRefresh.provider,
      lastAttemptAt: modelCatalogueRefresh.lastAttemptAt,
      lastSuccessAt: modelCatalogueRefresh.lastSuccessAt,
      lastError: modelCatalogueRefresh.lastError,
    })
    .from(modelCatalogueRefresh)
    .orderBy(asc(modelCatalogueRefresh.provider))
}

/**
 * A successful refresh: upsert every listed model, drop the provider's rows
 * the list no longer holds, and stamp the refresh, in one transaction.
 * Upserting rather than delete-then-insert lets two refreshes of the same
 * provider land at once without a unique-constraint failure.
 */
export async function replaceCatalogue(
  db: Database,
  provider: string,
  models: readonly CatalogueModelInput[],
  at: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const model of models) {
      const values = {
        kind: model.kind,
        label: model.label,
        preview: model.preview,
        contextTokens: model.contextTokens,
        maxOutputTokens: model.maxOutputTokens,
        dialect: model.dialect,
        pricePerImage: model.pricePerImage === null ? null : String(model.pricePerImage),
        fetchedAt: at,
      }
      await tx
        .insert(modelCatalogue)
        .values({ provider, modelId: model.modelId, ...values })
        .onConflictDoUpdate({
          target: [modelCatalogue.provider, modelCatalogue.modelId],
          set: { ...values, updatedAt: new Date() },
        })
    }
    const kept = models.map((model) => model.modelId)
    await tx
      .delete(modelCatalogue)
      .where(
        kept.length > 0
          ? and(eq(modelCatalogue.provider, provider), notInArray(modelCatalogue.modelId, kept))
          : eq(modelCatalogue.provider, provider),
      )
    await tx
      .insert(modelCatalogueRefresh)
      .values({ provider, lastAttemptAt: at, lastSuccessAt: at, lastError: null })
      .onConflictDoUpdate({
        target: modelCatalogueRefresh.provider,
        set: { lastAttemptAt: at, lastSuccessAt: at, lastError: null, updatedAt: new Date() },
      })
  })
}

/** A failed refresh: the cached rows stay; only the attempt and its error are recorded. */
export async function recordCatalogueFailure(
  db: Database,
  provider: string,
  error: string,
  at: Date,
): Promise<void> {
  await db
    .insert(modelCatalogueRefresh)
    .values({ provider, lastAttemptAt: at, lastSuccessAt: null, lastError: error })
    .onConflictDoUpdate({
      target: modelCatalogueRefresh.provider,
      set: { lastAttemptAt: at, lastError: error, updatedAt: new Date() },
    })
}
```

Add `export * from './model-catalogue'` to `packages/db/src/index.ts`.

- [ ] **Step 5: Migrate the test database and run the test**

Docker Desktop must be running. No other database suite may be running.

Run (Bash `timeout` 600000): `pnpm db:migrate:test && pnpm --filter @boom-busters/db exec vitest run src/model-catalogue.integration.test.ts`
Expected: PASS, three tests.

- [ ] **Step 6: Run the db suite and typecheck**

Run (Bash `timeout` 600000): `pnpm --filter @boom-busters/db test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
pnpm format:check
git add packages/db
git commit -m "feat(db): the live model cache, kept on a failed refresh (decision 287)"
```

---

### Task 8: Merging lists into dropdown options

**Files:**
- Create: `packages/providers/src/catalogue/options.ts`
- Modify: `packages/providers/src/catalogue/index.ts`
- Test: `packages/providers/src/catalogue/options.test.ts`

**Interfaces:**
- Consumes: `ListedModel`, `CatalogueProvider` (Task 1); `resolveLlmModel`, `resolveImageModel` (Task 4); `LLM_MODELS`, `GEMINI_IMAGE_MODELS`, `FAL_MODELS`.
- Produces:

```ts
export type OptionStatus = 'catalogue' | 'estimated' | 'override' | 'retired' | 'needs-price' | 'incompatible'
export type OptionPrice =
  | { kind: 'llm'; inputPerMTok: number; outputPerMTok: number; cachedInputPerMTok?: number }
  | { kind: 'image'; pricePerImage: number; pricesBySize?: Partial<Record<'1K' | '2K' | '4K', number>> }
export interface ModelOption {
  id: string
  label: string
  status: OptionStatus
  /** Google previews, grouped at the end. */
  preview: boolean
  /** False only for 'incompatible'. A 'needs-price' option is chosen through the price form. */
  selectable: boolean
  /** The price a run would be charged; for 'estimated', the family's; null when unpriced. */
  price: OptionPrice | null
  /** For 'estimated': the representative's label, "Claude Opus 5". */
  pricedAs: string | null
  /** For 'incompatible': why. */
  reason: string | null
  /** True for a hand-written catalogue entry, false for a live-only model. */
  catalogued: boolean
  /**
   * What would price this model if the owner's override were cleared:
   * its catalogue row, fal's own published price, its family, or nothing.
   * Clearing a price is refused when this is null and a route uses the model.
   */
  fallsBackTo: 'catalogue' | 'provider' | 'family' | null
}
export interface RefreshState { provider: CatalogueProvider; lastAttemptAt: string | null; lastSuccessAt: string | null; lastError: string | null }
export interface ProviderStatus { kind: 'live' | 'failed' | 'no-key' | 'never'; lastAttemptAt: string | null; lastSuccessAt: string | null; error: string | null }
export interface ModelOptions {
  llm: Record<LlmProvider, ModelOption[]>
  image: Record<StillProvider, ModelOption[]>
  status: Record<CatalogueProvider, ProviderStatus>
  /** Newest attempt across providers, ISO, or null. */
  lastAttemptAt: string | null
  /** False when no provider has a key (and not mock mode): a refresh would do nothing. */
  canRefresh: boolean
}
export function buildModelOptions(input: {
  listed: readonly ListedModel[]
  refresh: readonly RefreshState[]
  keys: Record<CatalogueProvider, boolean>
  prices: ModelPrices | undefined
  mock: boolean
}): ModelOptions
export function isStale(lastAttemptAt: string | null, nowMs: number): boolean   // true when null or older than 24 h
```

- [ ] **Step 1: Write the failing tests**

Create `packages/providers/src/catalogue/options.test.ts`:

```ts
import { EMPTY_MODEL_PRICES } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { mockListedModels } from './mock-listing'
import { buildModelOptions, isStale } from './options'
import type { CatalogueProvider } from './types'

const allKeys = (value: boolean): Record<CatalogueProvider, boolean> => ({
  anthropic: value,
  openai: value,
  google: value,
  fal: value,
})

const live = (provider: CatalogueProvider) => ({
  provider,
  lastAttemptAt: '2026-10-01T09:00:00.000Z',
  lastSuccessAt: '2026-10-01T09:00:00.000Z',
  lastError: null,
})

function options(overrides: Partial<Parameters<typeof buildModelOptions>[0]> = {}) {
  return buildModelOptions({
    listed: (['anthropic', 'openai', 'google', 'fal'] as const).flatMap(mockListedModels),
    refresh: (['anthropic', 'openai', 'google', 'fal'] as const).map(live),
    keys: allKeys(true),
    prices: EMPTY_MODEL_PRICES,
    mock: false,
    ...overrides,
  })
}

describe('buildModelOptions (decision 287)', () => {
  it('lists the catalogue first, then live-only models with their labels', () => {
    const anthropic = options().llm.anthropic
    expect(anthropic[0]).toMatchObject({ id: 'claude-opus-5', status: 'catalogue' })
    expect(anthropic.find((o) => o.id === 'claude-opus-mock-9')).toMatchObject({
      status: 'estimated',
      pricedAs: 'Claude Opus 5',
      price: { kind: 'llm', inputPerMTok: 5, outputPerMTok: 25 },
      selectable: true,
    })
    expect(anthropic.find((o) => o.id === 'claude-mock-unpriced')).toMatchObject({
      status: 'needs-price',
      price: null,
    })
  })

  it('marks the owner's price, and says what would price the model without it', () => {
    const prices = {
      ...EMPTY_MODEL_PRICES,
      llm: {
        'anthropic:claude-mock-unpriced': { inputPerMTok: 7, outputPerMTok: 30 },
        'anthropic:claude-opus-mock-9': { inputPerMTok: 4, outputPerMTok: 20 },
      },
    }
    const anthropic = options({ prices }).llm.anthropic
    expect(anthropic.find((o) => o.id === 'claude-mock-unpriced')).toMatchObject({
      status: 'override',
      price: { inputPerMTok: 7, outputPerMTok: 30 },
      catalogued: false,
      fallsBackTo: null,
    })
    expect(anthropic.find((o) => o.id === 'claude-opus-mock-9')?.fallsBackTo).toBe('family')
    expect(anthropic.find((o) => o.id === 'claude-opus-5')).toMatchObject({
      catalogued: true,
      fallsBackTo: 'catalogue',
    })
    expect(options().image.fal.find((o) => o.id === 'fal-ai/mock-flux')?.fallsBackTo).toBe('provider')
  })

  it('marks a catalogued model the live list no longer holds, only once a list has loaded', () => {
    const listed = mockListedModels('anthropic').filter((m) => m.id !== 'claude-sonnet-5')
    expect(options({ listed }).llm.anthropic.find((o) => o.id === 'claude-sonnet-5')?.status).toBe('retired')
    expect(
      options({ listed, refresh: [] }).llm.anthropic.find((o) => o.id === 'claude-sonnet-5')?.status,
    ).toBe('catalogue')
  })

  it('splits Google into LLM and image options and groups previews last', () => {
    const listed = [
      ...mockListedModels('google'),
      { ...mockListedModels('google')[0]!, id: 'gemini-9-pro-preview', label: 'Gemini 9 Pro Preview', preview: true },
    ]
    const google = options({ listed }).llm.google
    expect(google.at(-1)).toMatchObject({ id: 'gemini-9-pro-preview', preview: true })
    expect(options().image.google.find((o) => o.id === 'gemini-9-flash-image')?.status).toBe('estimated')
  })

  it('shows a fal endpoint it cannot send as incompatible', () => {
    const listed = [
      ...mockListedModels('fal'),
      { ...mockListedModels('fal')[0]!, id: 'fal-ai/one-at-a-time', label: 'One at a time', dialect: null },
    ]
    expect(options({ listed }).image.fal.find((o) => o.id === 'fal-ai/one-at-a-time')).toMatchObject({
      status: 'incompatible',
      selectable: false,
      reason: 'Makes one image per request, or takes an input this app cannot send.',
    })
    expect(options().image.fal.find((o) => o.id === 'fal-ai/mock-flux')).toMatchObject({
      status: 'catalogue',
      price: { kind: 'image', pricePerImage: 0.02 },
    })
  })

  it('says why each provider shows what it shows', () => {
    const status = options({
      keys: { ...allKeys(true), openai: false },
      refresh: [
        live('anthropic'),
        { provider: 'google', lastAttemptAt: '2026-10-01T10:00:00.000Z', lastSuccessAt: '2026-10-01T09:00:00.000Z', lastError: 'key rejected' },
      ],
    }).status
    expect(status.anthropic.kind).toBe('live')
    expect(status.openai.kind).toBe('no-key')
    expect(status.google).toMatchObject({ kind: 'failed', error: 'key rejected' })
    expect(status.fal.kind).toBe('never')
  })

  it('cannot refresh with no keys outside mock mode', () => {
    expect(options({ keys: allKeys(false) }).canRefresh).toBe(false)
    expect(options({ keys: allKeys(false), mock: true }).canRefresh).toBe(true)
  })
})

describe('isStale', () => {
  it('is stale with no refresh, or one older than a day', () => {
    const now = Date.parse('2026-10-02T10:00:00.000Z')
    expect(isStale(null, now)).toBe(true)
    expect(isStale('2026-10-01T09:00:00.000Z', now)).toBe(true)
    expect(isStale('2026-10-02T09:00:00.000Z', now)).toBe(false)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @boom-busters/providers exec vitest run src/catalogue/options.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the merge**

Create `packages/providers/src/catalogue/options.ts` with the types in the Interfaces block and:

```ts
import { LLM_PROVIDERS, STILL_PROVIDERS } from '@boom-busters/schemas'
import type { LlmProvider, ModelPrices, StillProvider } from '@boom-busters/schemas'
import { LLM_MODELS } from '../llm/registry'
import { FAL_MODELS } from '../visuals/fal'
import { GEMINI_IMAGE_MODELS } from '../visuals/gemini'
import type { ImageGenModel } from '../visuals/types'
import type { KnownModel } from '../llm/types'
import { geminiImageFamily, llmFamily } from './families'
import { resolveImageModel, resolveLlmModel } from './resolve'
import { CATALOGUE_PROVIDERS } from './types'
import type { CatalogueProvider, ListedModel, PriceSource } from './types'

// ...the exported types from the Interfaces block...

const DAY_MS = 24 * 60 * 60 * 1000

export function isStale(lastAttemptAt: string | null, nowMs: number): boolean {
  return lastAttemptAt === null || nowMs - Date.parse(lastAttemptAt) > DAY_MS
}

const statusFor = (source: PriceSource): OptionStatus =>
  source === 'override' ? 'override' : source === 'family' ? 'estimated' : 'catalogue'

const llmPrice = (model: KnownModel): OptionPrice => ({
  kind: 'llm',
  inputPerMTok: model.inputPerMTok,
  outputPerMTok: model.outputPerMTok,
  ...(model.cachedInputPerMTok !== undefined ? { cachedInputPerMTok: model.cachedInputPerMTok } : {}),
})

const imagePrice = (model: ImageGenModel): OptionPrice => ({
  kind: 'image',
  pricePerImage: model.pricePerImage,
  ...(model.pricesBySize ? { pricesBySize: model.pricesBySize } : {}),
})

/** Live-only options after the catalogue: non-previews first, then by label. */
const byPreviewThenLabel = (a: ModelOption, b: ModelOption) =>
  Number(a.preview) - Number(b.preview) || a.label.localeCompare(b.label)

function llmOptions(
  provider: LlmProvider,
  listed: readonly ListedModel[],
  hasLive: boolean,
  prices: ModelPrices | undefined,
): ModelOption[] {
  const rows = listed.filter((m) => m.provider === provider && m.kind === 'llm')
  const liveIds = new Set(rows.map((m) => m.id))
  const catalogue = LLM_MODELS[provider]
  const known = new Set(catalogue.map((m) => m.id))

  const fromCatalogue = catalogue.map((model): ModelOption => {
    const resolved = resolveLlmModel(provider, model.id, prices)!
    const retired = hasLive && !liveIds.has(model.id)
    return {
      id: model.id,
      label: model.label,
      status: retired ? 'retired' : statusFor(resolved.source),
      preview: false,
      selectable: true,
      price: llmPrice(resolved.model),
      pricedAs: null,
      reason: null,
      catalogued: true,
      fallsBackTo: 'catalogue',
    }
  })

  const liveOnly = rows
    .filter((row) => !known.has(row.id))
    .map((row): ModelOption => {
      const resolved = resolveLlmModel(provider, row.id, prices)
      const family = llmFamily(provider, row.id)
      const representative = family ? catalogue.find((m) => m.id === family.representative) : undefined
      return {
        id: row.id,
        label: row.label,
        status: resolved ? statusFor(resolved.source) : 'needs-price',
        preview: row.preview,
        selectable: true,
        price: resolved ? llmPrice(resolved.model) : null,
        pricedAs: resolved?.source === 'family' ? (representative?.label ?? null) : null,
        reason: null,
        catalogued: false,
        fallsBackTo: representative ? 'family' : null,
      }
    })
    .sort(byPreviewThenLabel)

  return [...fromCatalogue, ...liveOnly]
}

const IMAGE_CATALOGUES: Record<StillProvider, readonly ImageGenModel[]> = {
  google: GEMINI_IMAGE_MODELS,
  fal: FAL_MODELS,
}

function imageOptions(
  provider: StillProvider,
  listed: readonly ListedModel[],
  hasLive: boolean,
  prices: ModelPrices | undefined,
): ModelOption[] {
  const rows = listed.filter((m) => m.provider === provider && m.kind === 'image')
  const liveIds = new Set(rows.map((m) => m.id))
  const catalogue = IMAGE_CATALOGUES[provider]
  const known = new Set(catalogue.map((m) => m.id))

  const fromCatalogue = catalogue.map((model): ModelOption => {
    const resolved = resolveImageModel(provider, model.id, prices)!
    return {
      id: model.id,
      label: model.label,
      status: hasLive && !liveIds.has(model.id) ? 'retired' : statusFor(resolved.source),
      preview: false,
      selectable: true,
      price: imagePrice(resolved.model),
      pricedAs: null,
      reason: null,
      catalogued: true,
      fallsBackTo: 'catalogue',
    }
  })

  const liveOnly = rows
    .filter((row) => !known.has(row.id))
    .map((row): ModelOption => {
      if (provider === 'fal' && row.dialect === null) {
        return {
          id: row.id,
          label: row.label,
          status: 'incompatible',
          preview: false,
          selectable: false,
          price: null,
          pricedAs: null,
          reason: 'Makes one image per request, or takes an input this app cannot send.',
          catalogued: false,
          fallsBackTo: null,
        }
      }
      const resolved = resolveImageModel(provider, row.id, prices, row)
      const family = provider === 'google' ? geminiImageFamily(row.id) : undefined
      const representative = family ? catalogue.find((m) => m.id === family.representative) : undefined
      return {
        id: row.id,
        label: row.label,
        status: resolved ? statusFor(resolved.source) : 'needs-price',
        preview: row.preview,
        selectable: true,
        price: resolved ? imagePrice(resolved.model) : null,
        pricedAs: resolved?.source === 'family' ? (representative?.label ?? null) : null,
        reason: null,
        catalogued: false,
        fallsBackTo:
          provider === 'fal'
            ? row.pricePerImage !== null
              ? 'provider'
              : null
            : representative
              ? 'family'
              : null,
      }
    })
    .sort(byPreviewThenLabel)

  return [...fromCatalogue, ...liveOnly]
}

function providerStatus(
  provider: CatalogueProvider,
  refresh: readonly RefreshState[],
  hasKey: boolean,
): ProviderStatus {
  const row = refresh.find((r) => r.provider === provider)
  const base = {
    lastAttemptAt: row?.lastAttemptAt ?? null,
    lastSuccessAt: row?.lastSuccessAt ?? null,
    error: row?.lastError ?? null,
  }
  if (!hasKey) return { kind: 'no-key', ...base }
  if (row?.lastError) return { kind: 'failed', ...base }
  if (row?.lastSuccessAt) return { kind: 'live', ...base }
  return { kind: 'never', ...base }
}

export function buildModelOptions(input: {
  listed: readonly ListedModel[]
  refresh: readonly RefreshState[]
  keys: Record<CatalogueProvider, boolean>
  prices: ModelPrices | undefined
  mock: boolean
}): ModelOptions {
  const hasLive = (provider: CatalogueProvider) =>
    input.refresh.some((r) => r.provider === provider && r.lastSuccessAt !== null)
  const keyed = (provider: CatalogueProvider) => input.mock || input.keys[provider]

  const llm = Object.fromEntries(
    LLM_PROVIDERS.map((p) => [p, llmOptions(p, input.listed, hasLive(p), input.prices)]),
  ) as Record<LlmProvider, ModelOption[]>
  const image = Object.fromEntries(
    STILL_PROVIDERS.map((p) => [p, imageOptions(p, input.listed, hasLive(p), input.prices)]),
  ) as Record<StillProvider, ModelOption[]>
  const status = Object.fromEntries(
    CATALOGUE_PROVIDERS.map((p) => [p, providerStatus(p, input.refresh, keyed(p))]),
  ) as Record<CatalogueProvider, ProviderStatus>

  const attempts = input.refresh.map((r) => r.lastAttemptAt).filter((at): at is string => at !== null)
  return {
    llm,
    image,
    status,
    lastAttemptAt: attempts.length > 0 ? attempts.sort().at(-1)! : null,
    canRefresh: CATALOGUE_PROVIDERS.some(keyed),
  }
}
```

A failed provider whose last success is older still shows its cached list; `failed` only changes the status line.

Add `export * from './options'` to the catalogue index.

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm --filter @boom-busters/providers exec vitest run src/catalogue`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format:check
git add packages/providers/src/catalogue
git commit -m "feat(catalogue): merge live lists into labelled dropdown options (decision 287)"
```

---

### Task 9: The server side: refresh, options and image adapters

**Files:**
- Create: `apps/web/lib/model-catalogue.ts`
- Create: `apps/web/app/(console)/settings/model-actions.ts`
- Test: `apps/web/lib/model-catalogue.test.ts`

**Interfaces:**
- Consumes: `listProviderModels`, `mockListedModels`, `buildModelOptions`, `effectiveImageModels`, `liveImageGenWith`, `imageGenAdapterWith`, `mockProvidersEnabled`, `CATALOGUE_PROVIDERS` (providers); `listCatalogueModels`, `listCatalogueRefresh`, `replaceCatalogue`, `recordCatalogueFailure`, `llmCredentials`, `visualCredentials` (db).
- Produces:

```ts
export interface RefreshOutcome { provider: CatalogueProvider; ok: boolean; skipped: boolean; error: string | null }
export async function refreshModelCatalogue(): Promise<RefreshOutcome[]>
export async function loadModelOptions(settings: Settings): Promise<ModelOptions>
export async function stillCatalogue(settings: Settings): Promise<Record<StillProvider, ImageGenProvider>>
export async function stillGenerator(provider: StillProvider, settings: Settings): Promise<ImageGenProvider>
export interface StillModelOption { provider: StillProvider; id: string; label: string }
export function stillModelOptions(catalogue: Record<StillProvider, ImageGenProvider>): StillModelOption[]
// model-actions.ts ('use server')
export async function refreshModelListsAction(): Promise<{ ok: boolean; results: RefreshOutcome[] }>
```

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/model-catalogue.test.ts`. It mocks `@boom-busters/db` and `@/lib/db`, as other `apps/web/lib` tests do (read one, such as the `visual-assets` tests, for the house pattern), and drives mock mode through `process.env`:

```ts
import { DEFAULT_SETTINGS } from '@boom-busters/schemas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  listCatalogueModels: vi.fn(async () => [] as unknown[]),
  listCatalogueRefresh: vi.fn(async () => [] as unknown[]),
  replaceCatalogue: vi.fn(async () => {}),
  recordCatalogueFailure: vi.fn(async () => {}),
  llmCredentials: vi.fn(async () => ({}) as Record<string, string>),
  visualCredentials: vi.fn(async () => ({}) as Record<string, string>),
}))
vi.mock('@boom-busters/db', () => db)
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/env', () => ({ env: { SECRETS_ENCRYPTION_KEY: 'k' } }))
vi.mock('server-only', () => ({}))

import { loadModelOptions, refreshModelCatalogue, stillCatalogue } from './model-catalogue'

const fetchSpy = vi.spyOn(globalThis, 'fetch')

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NODE_ENV', 'test')
})
afterEach(() => vi.unstubAllEnvs())

describe('refreshModelCatalogue (decision 287)', () => {
  it('refreshes every provider from fixtures in mock mode, with no key and no network', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    const results = await refreshModelCatalogue()
    expect(results.map((r) => [r.provider, r.ok])).toEqual([
      ['anthropic', true],
      ['openai', true],
      ['google', true],
      ['fal', true],
    ])
    expect(db.replaceCatalogue).toHaveBeenCalledTimes(4)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('skips a provider with no key and touches none of its rows', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '0')
    const results = await refreshModelCatalogue()
    expect(results.every((r) => r.skipped)).toBe(true)
    expect(db.replaceCatalogue).not.toHaveBeenCalled()
    expect(db.recordCatalogueFailure).not.toHaveBeenCalled()
  })

  it('records a failed provider and keeps refreshing the others', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '0')
    // Once: `clearAllMocks` keeps implementations, and a key left behind
    // here would turn the later no-key case into a keyed one.
    db.llmCredentials.mockResolvedValueOnce({ anthropic: 'a', openai: 'o' })
    fetchSpy.mockImplementation(async (input) =>
      String(input).includes('anthropic')
        ? new Response('{"error":{"message":"bad key"}}', { status: 401 })
        : new Response(JSON.stringify({ data: [{ id: 'gpt-5' }] }), { status: 200 }),
    )
    const results = await refreshModelCatalogue()
    expect(results.find((r) => r.provider === 'anthropic')).toMatchObject({ ok: false })
    expect(results.find((r) => r.provider === 'openai')).toMatchObject({ ok: true })
    expect(db.recordCatalogueFailure).toHaveBeenCalledWith(expect.anything(), 'anthropic', expect.any(String), expect.any(Date))
  })
})

describe('stillCatalogue', () => {
  it('builds each image adapter over the catalogue plus choosable cached models', async () => {
    db.listCatalogueModels.mockResolvedValueOnce([
      { provider: 'fal', modelId: 'fal-ai/mock-flux', kind: 'image', label: 'Mock FLUX', preview: false, contextTokens: null, maxOutputTokens: null, dialect: 'flux', pricePerImage: 0.02, fetchedAt: new Date() },
    ])
    const catalogue = await stillCatalogue(DEFAULT_SETTINGS)
    expect(catalogue.fal.models.map((m) => m.id)).toContain('fal-ai/mock-flux')
    expect(catalogue.google.models.map((m) => m.id)).toContain('gemini-3-pro-image')
  })
})

describe('loadModelOptions', () => {
  it('reports no-key status lines and cannot refresh with no keys', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '0')
    const options = await loadModelOptions(DEFAULT_SETTINGS)
    expect(options.status.anthropic.kind).toBe('no-key')
    expect(options.canRefresh).toBe(false)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @boom-busters/web exec vitest run lib/model-catalogue.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the server module**

Create `apps/web/lib/model-catalogue.ts`:

```ts
import 'server-only'

import {
  listCatalogueModels,
  listCatalogueRefresh,
  llmCredentials,
  recordCatalogueFailure,
  replaceCatalogue,
  visualCredentials,
} from '@boom-busters/db'
import type { CatalogueModelRow } from '@boom-busters/db'
import {
  CATALOGUE_PROVIDERS,
  buildModelOptions,
  effectiveImageModels,
  imageGenAdapterWith,
  listProviderModels,
  liveImageGenWith,
  mockListedModels,
  mockProvidersEnabled,
} from '@boom-busters/providers'
import type {
  CatalogueProvider,
  FalDialect,
  ImageGenProvider,
  ListedModel,
  ModelOptions,
} from '@boom-busters/providers'
import { STILL_PROVIDERS } from '@boom-busters/schemas'
import type { Settings, StillProvider } from '@boom-busters/schemas'
import { db } from '@/lib/db'
import { env } from '@/lib/env'

/**
 * The live model lists, server side (decision 287): refreshing the cache,
 * the Models tab's options, and image adapters that know the live models.
 */

const REFRESH_TIMEOUT_MS = 10_000

export interface RefreshOutcome {
  provider: CatalogueProvider
  ok: boolean
  /** No key, so nothing was asked and nothing changed. */
  skipped: boolean
  error: string | null
}

function toListed(row: CatalogueModelRow): ListedModel {
  return {
    provider: row.provider as CatalogueProvider,
    id: row.modelId,
    label: row.label,
    kind: row.kind,
    preview: row.preview,
    contextTokens: row.contextTokens,
    maxOutputTokens: row.maxOutputTokens,
    dialect: (row.dialect as FalDialect | null) ?? null,
    pricePerImage: row.pricePerImage,
  }
}

async function providerKeys(): Promise<Partial<Record<CatalogueProvider, string>>> {
  const [llm, visual] = await Promise.all([
    llmCredentials(db, env.SECRETS_ENCRYPTION_KEY),
    visualCredentials(db, env.SECRETS_ENCRYPTION_KEY),
  ])
  return {
    ...(llm.anthropic ? { anthropic: llm.anthropic } : {}),
    ...(llm.openai ? { openai: llm.openai } : {}),
    ...((llm.google ?? visual.google) ? { google: llm.google ?? visual.google } : {}),
    ...(visual.fal ? { fal: visual.fal } : {}),
  }
}

/** Ask every provider with a key, in parallel; a failure is recorded, never thrown. */
export async function refreshModelCatalogue(): Promise<RefreshOutcome[]> {
  const mocked = mockProvidersEnabled()
  const keys = mocked ? {} : await providerKeys()

  return Promise.all(
    CATALOGUE_PROVIDERS.map(async (provider): Promise<RefreshOutcome> => {
      const key = keys[provider]
      if (!mocked && !key) return { provider, ok: false, skipped: true, error: null }
      const at = new Date()
      try {
        const listed = mocked
          ? mockListedModels(provider)
          : await listProviderModels(provider, key!, { signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS) })
        await replaceCatalogue(
          db,
          provider,
          listed.map((model) => ({
            modelId: model.id,
            kind: model.kind,
            label: model.label,
            preview: model.preview,
            contextTokens: model.contextTokens,
            maxOutputTokens: model.maxOutputTokens,
            dialect: model.dialect,
            pricePerImage: model.pricePerImage,
          })),
          at,
        )
        return { provider, ok: true, skipped: false, error: null }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await recordCatalogueFailure(db, provider, message, at)
        return { provider, ok: false, skipped: false, error: message }
      }
    }),
  )
}

export async function loadModelOptions(settings: Settings): Promise<ModelOptions> {
  const mocked = mockProvidersEnabled()
  const [rows, refresh, keys] = await Promise.all([
    listCatalogueModels(db),
    listCatalogueRefresh(db),
    mocked ? Promise.resolve({}) : providerKeys(),
  ])
  return buildModelOptions({
    listed: rows.map(toListed),
    refresh: refresh.map((row) => ({
      provider: row.provider as CatalogueProvider,
      lastAttemptAt: row.lastAttemptAt.toISOString(),
      lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
      lastError: row.lastError,
    })),
    keys: Object.fromEntries(
      CATALOGUE_PROVIDERS.map((p) => [p, Boolean((keys as Record<string, string>)[p])]),
    ) as Record<CatalogueProvider, boolean>,
    prices: settings.modelPrices,
    mock: mocked,
  })
}

/**
 * Live image adapters over each provider's effective list (catalogue
 * repriced by the owner, plus choosable cached models). Prices, limits,
 * labels and reference routes read from these, so a still routed at a live
 * model is priced and checked like any other.
 */
export async function stillCatalogue(
  settings: Settings,
): Promise<Record<StillProvider, ImageGenProvider>> {
  const listed = (await listCatalogueModels(db)).map(toListed)
  return Object.fromEntries(
    STILL_PROVIDERS.map((provider) => [
      provider,
      liveImageGenWith(provider, effectiveImageModels(provider, settings.modelPrices, listed)),
    ]),
  ) as Record<StillProvider, ImageGenProvider>
}

/** The adapter that will actually generate: the mock in mock mode, else live, over the same list. */
export async function stillGenerator(
  provider: StillProvider,
  settings: Settings,
): Promise<ImageGenProvider> {
  const catalogue = await stillCatalogue(settings)
  return imageGenAdapterWith(provider, catalogue[provider].models)
}

export interface StillModelOption {
  provider: StillProvider
  id: string
  label: string
}

/** The board's per-slot Image model choices (decision 264), from the same lists. */
export function stillModelOptions(
  catalogue: Record<StillProvider, ImageGenProvider>,
): StillModelOption[] {
  return STILL_PROVIDERS.flatMap((provider) =>
    catalogue[provider].models.map((model) => ({ provider, id: model.id, label: model.label })),
  )
}
```

`StillModelOption` is a type exported from a non-`'use server'` module, so the client board may import it as a type.

- [ ] **Step 4: Write the server action**

Create `apps/web/app/(console)/settings/model-actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { refreshModelCatalogue, type RefreshOutcome } from '@/lib/model-catalogue'

/**
 * Settings → Models → Refresh model lists (decision 287). Re-checks the
 * session: a server action is a POST endpoint of its own. A failing
 * provider is reported, never thrown, so one bad key cannot hide the rest.
 */
export async function refreshModelListsAction(): Promise<{
  ok: boolean
  results: RefreshOutcome[]
}> {
  const session = await auth()
  if (!session?.user?.email) throw new Error('Not signed in')
  const results = await refreshModelCatalogue()
  revalidatePath('/settings')
  return { ok: results.every((r) => r.ok || r.skipped), results }
}
```

This file exports one async function and nothing else.

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm --filter @boom-busters/web exec vitest run lib/model-catalogue.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and lint**

Run (Bash `timeout` 600000): `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
pnpm format:check
git add apps/web/lib/model-catalogue.ts apps/web/lib/model-catalogue.test.ts "apps/web/app/(console)/settings/model-actions.ts"
git commit -m "feat(web): refresh the model cache and build image adapters over it (decision 287)"
```

---

### Task 10: Still call sites and the board's Image model select

**Files:**
- Modify: `apps/web/lib/visual-assets.ts`
- Modify: `apps/web/lib/set-sheet.ts`
- Modify: `apps/web/lib/visuals-review.ts`
- Modify: `apps/web/app/(console)/projects/[id]/visuals-actions.ts`
- Modify: `apps/web/app/(console)/projects/[id]/visual-board.tsx`
- Test: the existing tests for each of these files, plus one new case each in the visual-assets and visual-board tests

**Interfaces:**
- Consumes: `stillCatalogue`, `stillGenerator`, `stillModelOptions`, `StillModelOption` (Task 9).
- Produces: `VisualsReviewModel.stillModelOptions: StillModelOption[]`.

- [ ] **Step 1: Write the failing tests**

`apps/web/lib/visual-assets.test.ts` runs against the real test database in mock-provider mode (no db mock). Import `replaceCatalogue` from `@boom-busters/db` and `stillSlotEstimateUsd` from `./visual-assets`, then append inside the existing `describeDb('the route stored on a slot wins', ...)` block:

```ts
  it('prices a still routed at a live fal model from the cache (decision 287)', async () => {
    await replaceCatalogue(
      db,
      'fal',
      [
        {
          modelId: 'fal-ai/mock-flux',
          kind: 'image',
          label: 'Mock FLUX',
          preview: false,
          contextTokens: null,
          maxOutputTokens: null,
          dialect: 'flux',
          pricePerImage: 0.02,
        },
      ],
      new Date(),
    )
    await updateSettings(db, {
      modelRouting: { stills: { provider: 'fal', model: 'fal-ai/mock-flux' }, stillsLikeness: null },
    })
    expect(await stillSlotEstimateUsd()).toBeCloseTo(0.02 * STILL_GENERATIONS)
    await generateStillCandidates({ ...still, depicts: [] }, FIXTURE_PROJECT_ID)
    expect(await lastLedgerModel()).toBe('fal-ai/mock-flux')
  })
```

The file's `beforeEach` re-seeds; if it does not truncate `model_catalogue`, the row left behind is harmless to the other cases, which route at catalogued models.

In `apps/web/app/(console)/projects/[id]/visual-board.test.tsx`, the `model(...)` helper builds the `VisualsReviewModel`. Give it a default `stillModelOptions` holding every hand-written model, so the existing select tests keep their options:

```ts
import { FAL_MODELS, GEMINI_IMAGE_MODELS } from '@boom-busters/providers'

const STILL_OPTIONS = [
  ...GEMINI_IMAGE_MODELS.map((m) => ({ provider: 'google' as const, id: m.id, label: m.label })),
  ...FAL_MODELS.map((m) => ({ provider: 'fal' as const, id: m.id, label: m.label })),
]
```

and `stillModelOptions: STILL_OPTIONS` in what `model()` returns (accept an override). Then append inside `describe('the model select on a shot (decision 264)', ...)`:

```ts
  it('offers a live model the server listed (decision 287)', async () => {
    const live = { ...model([stillSlot]), stillModelOptions: [...STILL_OPTIONS, { provider: 'fal' as const, id: 'fal-ai/mock-flux', label: 'Mock FLUX' }] }
    render(<VisualBoard projectId={PROJECT} model={live} colors={COLORS} brand={BRAND} />)
    await userEvent.click(screen.getByRole('button', { name: /Edit brief/ }))

    const select = screen.getByLabelText('Image model') as HTMLSelectElement
    expect(within(select).getByText('Mock FLUX')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @boom-busters/web exec vitest run lib/visual-assets "app/(console)/projects/[id]/visual-board"`
Expected: FAIL; the estimate throws, and the board shows no "Mock FLUX" option.

- [ ] **Step 3: Switch the visual-assets call sites**

In `apps/web/lib/visual-assets.ts`, import `stillCatalogue` and `stillGenerator` from `@/lib/model-catalogue`, and:

1. Change `adapterOffers(route)` to take the catalogue:

```ts
function adapterOffers(
  route: StillRoute,
  catalogue: Record<StillProvider, ImageGenProvider>,
): boolean {
  return catalogue[route.provider].models.some((model) => model.id === route.model)
}
```

2. Give `stillBriefPriceUsd` a final parameter `catalogue: Record<StillProvider, ImageGenProvider>`, use `adapterOffers(stored, catalogue)`, and replace `const live = LIVE_IMAGE_GEN_ADAPTERS[route.provider]` with `const live = catalogue[route.provider]`. Every caller of `stillBriefPriceUsd` already reads settings; have each build `const catalogue = await stillCatalogue(settings)` once (outside any per-brief loop) and pass it.
3. In `plateEstimateUsd`, `setSheetEstimateUsd` and `stillSlotEstimateUsd`, read `const settings = await getSettings(db)` once, build the catalogue, and replace each `LIVE_IMAGE_GEN_ADAPTERS[x]` with `catalogue[x]`.
4. In `generateStillCandidates`, replace `const routing = (await getSettings(db)).modelRouting` with:

```ts
  const settings = await getSettings(db)
  const routing = settings.modelRouting
  const catalogue = await stillCatalogue(settings)
```

then use `adapterOffers(stored, catalogue)`, replace `const adapter = imageGenAdapter(provider)` with `const adapter = await stillGenerator(provider, settings)`, and replace `const live = LIVE_IMAGE_GEN_ADAPTERS[provider]` with `const live = catalogue[provider]`. The later `imageGenModel(live, route.model).label` now finds live models.
5. Remove the now-unused `LIVE_IMAGE_GEN_ADAPTERS` and `imageGenAdapter` imports.

- [ ] **Step 4: Switch the set sheet**

In `apps/web/lib/set-sheet.ts`, where it reads the set-sheet route, also build `const catalogue = await stillCatalogue(settings)` (read settings once if it reads them already), then replace `const live = LIVE_IMAGE_GEN_ADAPTERS.google` with `const live = catalogue.google`, `imageGenAdapter('google')` with `await stillGenerator('google', settings)`, and `imageGenModel(LIVE_IMAGE_GEN_ADAPTERS.google, route.model)` with `imageGenModel(live, route.model)` (hoist `live` if it is scoped too narrowly).

- [ ] **Step 5: Switch the review model and the route action**

In `apps/web/lib/visuals-review.ts`:

1. Add `stillModelOptions: StillModelOption[]` to `VisualsReviewModel` with the comment `/** The per-slot Image model choices (decisions 264, 287). */`, and `stillModelOptions: []` to `emptyVisualsModel()`.
2. In `visualsReviewModel`, after settings are read, build `const catalogue = await stillCatalogue(settings)`; replace the `offered` check's `LIVE_IMAGE_GEN_ADAPTERS[stored.data.provider].models` with `catalogue[stored.data.provider].models`; and set `stillModelOptions: stillModelOptions(catalogue)` on the returned model.

In `apps/web/app/(console)/projects/[id]/visuals-actions.ts`, at the route check, replace `imageGenModel(LIVE_IMAGE_GEN_ADAPTERS[parsedRoute.provider], parsedRoute.model)` with:

```ts
      const catalogue = await stillCatalogue(await getSettings(db))
      imageGenModel(catalogue[parsedRoute.provider], parsedRoute.model)
```

(`getSettings` and `db` are already imported there; check.)

- [ ] **Step 6: Switch the board's select**

In `apps/web/app/(console)/projects/[id]/visual-board.tsx`:

1. Import `type StillModelOption` from `@/lib/model-catalogue`.
2. Replace `stillModelLabel` with:

```ts
/** A model's label from the board's options, or the stored id itself if no list holds it. */
function stillModelLabel(
  options: readonly StillModelOption[],
  provider: StillProvider,
  model: string,
): string {
  return options.find((o) => o.provider === provider && o.id === model)?.label ?? model
}
```

3. Give `ModelRouteSelect` an `options: readonly StillModelOption[]` prop; use `stillModelLabel(options, ...)` for the default label, and render each provider's group from `options.filter((o) => o.provider === provider)` instead of `LIVE_IMAGE_GEN_ADAPTERS[provider].models`.
4. Where `ModelRouteSelect` is rendered (around line 3652), pass `options={model.stillModelOptions}`. If `model` is not in scope there, thread `stillModelOptions` down the same way `projectId` reaches it.
5. Remove the board's imports of `imageGenModel` and `LIVE_IMAGE_GEN_ADAPTERS` if nothing else uses them.

- [ ] **Step 7: Fix every test whose db mock lacks the new query**

`stillCatalogue` calls `listCatalogueModels`. A test that replaces `@boom-busters/db` with a factory now fails with "no export named listCatalogueModels". Find them:

Run: `grep -rln "vi.mock('@boom-busters/db'" apps/web`

For each one that reaches `visual-assets`, `set-sheet`, `visuals-review` or `visuals-actions`, add `listCatalogueModels: vi.fn(async () => [])` to its factory. A test that builds a `VisualsReviewModel` literal needs `stillModelOptions: []`.

- [ ] **Step 8: Run the web suite**

Run (Bash `timeout` 600000): `pnpm --filter @boom-busters/web test && pnpm typecheck && pnpm lint`
Expected: PASS, including the two new cases.

- [ ] **Step 9: Commit**

```bash
pnpm format:check
git add -u apps/web
git commit -m "feat(visuals): stills price, check and generate on live models; the board's select lists them (decision 287)"
```

---

### Task 11: The Models tab, LLM rows, refresh and prices

**Files:**
- Create: `apps/web/app/(console)/settings/models-tab.tsx`
- Modify: `apps/web/app/(console)/settings/settings-form.tsx` (remove `ModelsTab`, pass options)
- Modify: `apps/web/app/(console)/settings/page.tsx`
- Modify: `apps/web/app/(console)/settings/models-tab.test.tsx`, `apps/web/app/(console)/settings/voice-tab.test.tsx`
- Test: `apps/web/app/(console)/settings/models-tab.test.tsx`

**Interfaces:**
- Consumes: `ModelOptions`, `ModelOption`, `OptionPrice`, `isStale`, `buildModelOptions` (Task 8); `refreshModelListsAction` (Task 9); `modelPriceKey`, `LlmPriceOverrideSchema` (Task 2).
- Produces: `ModelsTab({ settings, saving, commit, options })`; `SettingsForm` prop `modelOptions: ModelOptions` (required).

The tab moves to its own file: `settings-form.tsx` is 718 lines and the tab roughly doubles.

- [ ] **Step 1: Update the existing tests' setup**

In both `models-tab.test.tsx` and `voice-tab.test.tsx`:

1. Add the new actions module and the router to the mocks:

```ts
const refreshModelListsAction = vi.fn()
vi.mock('./model-actions', () => ({
  refreshModelListsAction: (...args: unknown[]) => refreshModelListsAction(...args),
}))
const routerRefresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: routerRefresh }) }))
```

2. Pass `modelOptions` wherever `SettingsForm` is rendered, built with no network:

```ts
import { buildModelOptions, mockListedModels } from '@boom-busters/providers'
import { EMPTY_MODEL_PRICES } from '@boom-busters/schemas'

const FRESH = new Date().toISOString()

function modelOptions(prices = EMPTY_MODEL_PRICES) {
  return buildModelOptions({
    listed: (['anthropic', 'openai', 'google', 'fal'] as const).flatMap(mockListedModels),
    refresh: (['anthropic', 'openai', 'google', 'fal'] as const).map((provider) => ({
      provider,
      lastAttemptAt: FRESH,
      lastSuccessAt: FRESH,
      lastError: null,
    })),
    keys: { anthropic: true, openai: true, google: true, fal: true },
    prices,
    mock: false,
  })
}
```

In `beforeEach`, add `refreshModelListsAction.mockResolvedValue({ ok: true, results: [] })`.

- [ ] **Step 2: Write the failing tests**

Append to `models-tab.test.tsx` (its `renderModelsTab` gains `options = modelOptions()` and `settings = structuredClone(DEFAULT_SETTINGS)` parameters, passed through):

```ts
describe('live model lists (decision 287)', () => {
  it('offers a live family model, labelled estimated, and says what it is priced as', async () => {
    renderModelsTab()
    const select = screen.getByRole('combobox', { name: 'Research (dossiers) model' })
    expect(screen.getAllByRole('option', { name: 'Claude Opus Mock 9 (estimated)' }).length).toBeGreaterThan(0)

    await userEvent.selectOptions(select, 'claude-opus-mock-9')
    expect(saveSettings).toHaveBeenCalledWith({
      modelRouting: { research: { provider: 'anthropic', model: 'claude-opus-mock-9' } },
    })
    expect(
      await screen.findByText(/Estimated at Claude Opus 5's price: \$5 in, \$25 out per million tokens\./),
    ).toBeInTheDocument()
  })

  it('asks for a price before routing to a model with none, then saves both together', async () => {
    renderModelsTab()
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Research (dossiers) model' }),
      'claude-mock-unpriced',
    )
    expect(saveSettings).not.toHaveBeenCalled()
    expect(screen.getByText('Claude Mock Unpriced needs a price before it can run.')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Input, $ per million tokens'), '7')
    await userEvent.type(screen.getByLabelText('Output, $ per million tokens'), '30')
    await userEvent.click(screen.getByRole('button', { name: 'Save price and use' }))

    expect(saveSettings).toHaveBeenCalledWith({
      modelRouting: { research: { provider: 'anthropic', model: 'claude-mock-unpriced' } },
      modelPrices: {
        llm: { 'anthropic:claude-mock-unpriced': { inputPerMTok: 7, outputPerMTok: 30 } },
        image: {},
      },
    })
  })

  it.each(['0', '-1', 'abc', '4,5'])('refuses the price %s and saves nothing', async (typed) => {
    renderModelsTab()
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Research (dossiers) model' }),
      'claude-mock-unpriced',
    )
    await userEvent.type(screen.getByLabelText('Input, $ per million tokens'), typed)
    await userEvent.type(screen.getByLabelText('Output, $ per million tokens'), '30')
    await userEvent.click(screen.getByRole('button', { name: 'Save price and use' }))
    expect(saveSettings).not.toHaveBeenCalled()
    expect(
      screen.getByText('Enter a price above zero, using a full stop for decimals.'),
    ).toBeInTheDocument()
  })

  it('refuses to clear the price of a model a route still needs it for', async () => {
    const prices = {
      llm: { 'anthropic:claude-mock-unpriced': { inputPerMTok: 7, outputPerMTok: 30 } },
      image: {},
    }
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.modelRouting.research = { provider: 'anthropic', model: 'claude-mock-unpriced' }
    settings.modelPrices = prices
    renderModelsTab(modelOptions(prices), settings)

    await userEvent.click(screen.getAllByRole('button', { name: 'Clear price' })[0]!)
    expect(saveSettings).not.toHaveBeenCalled()
    expect(screen.getByText('Research (dossiers) uses this model. Pick another model first.')).toBeInTheDocument()
  })

  it('refreshes when asked, and stays busy until the action returns', async () => {
    let finish: (value: unknown) => void = () => {}
    refreshModelListsAction.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    renderModelsTab()
    const button = screen.getByRole('button', { name: 'Refresh model lists' })
    await userEvent.click(button)
    expect(button).toBeDisabled()
    finish({ ok: true, results: [] })
    await waitFor(() => expect(routerRefresh).toHaveBeenCalled())
    await waitFor(() => expect(button).not.toBeDisabled())
  })

  it('refreshes by itself on a stale list, once, and never when nothing can be refreshed', async () => {
    const stale = buildModelOptions({
      listed: [],
      refresh: [],
      keys: { anthropic: true, openai: false, google: false, fal: false },
      prices: EMPTY_MODEL_PRICES,
      mock: false,
    })
    const { unmount } = renderModelsTab(stale)
    await waitFor(() => expect(refreshModelListsAction).toHaveBeenCalledTimes(1))
    unmount()

    refreshModelListsAction.mockClear()
    renderModelsTab(
      buildModelOptions({
        listed: [],
        refresh: [],
        keys: { anthropic: false, openai: false, google: false, fal: false },
        prices: EMPTY_MODEL_PRICES,
        mock: false,
      }),
    )
    expect(refreshModelListsAction).not.toHaveBeenCalled()
    expect(screen.getAllByText(/Add a key in Connections to load live models\./).length).toBeGreaterThan(0)
  })

  it('names a failed refresh and keeps the old list', () => {
    const failed = buildModelOptions({
      listed: mockListedModels('anthropic'),
      refresh: [
        { provider: 'anthropic', lastAttemptAt: FRESH, lastSuccessAt: '2026-10-01T09:15:00.000Z', lastError: 'key rejected' },
      ],
      keys: { anthropic: true, openai: true, google: true, fal: true },
      prices: EMPTY_MODEL_PRICES,
      mock: false,
    })
    renderModelsTab(failed)
    expect(screen.getByText(/Anthropic: refresh failed .*key rejected\. Showing the list from/)).toBeInTheDocument()
    expect(screen.getAllByRole('option', { name: 'Claude Opus Mock 9 (estimated)' }).length).toBeGreaterThan(0)
  })
})
```

`renderModelsTab` must return the `render(...)` result so the auto-refresh case can `unmount()`. Import `waitFor` from Testing Library and `buildModelOptions`, `mockListedModels` from providers. Keep the existing set-sheet test passing (it renders Google image options through the new props).

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm --filter @boom-busters/web exec vitest run "app/(console)/settings/models-tab.test.tsx"`
Expected: FAIL; `SettingsForm` ignores `modelOptions` and nothing is labelled.

- [ ] **Step 4: Move the tab and build the LLM rows**

Create `apps/web/app/(console)/settings/models-tab.tsx` as a `'use client'` module. Move `ModelsTab`, `TASK_LABELS` and the `TabProps` it needs out of `settings-form.tsx` (export `TabProps` from `settings-form.tsx` or redeclare it). It must not import `LLM_MODELS`, `knownModel`, `topModel` or `LIVE_IMAGE_GEN_ADAPTERS`. Build it from these parts:

```tsx
'use client'

import { isStale, type ModelOption, type ModelOptions, type OptionPrice } from '@boom-busters/providers'
import {
  LLM_PROVIDERS,
  LLM_TASKS,
  modelPriceKey,
  type LlmProvider,
  type LlmTask,
  type ModelPrices,
  type Settings,
  type SettingsPatch,
} from '@boom-busters/schemas'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label, Select } from '@/components/ui/input'
import { refreshModelListsAction } from './model-actions'

const PROVIDER_NAMES = { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google', fal: 'fal.ai' } as const

/** The suffix each label puts on an option, so the select alone says what it is. */
const SUFFIX: Record<ModelOption['status'], string> = {
  catalogue: '',
  estimated: ' (estimated)',
  override: ' (your price)',
  retired: ' (no longer offered)',
  'needs-price': ' (needs a price)',
  incompatible: ' (not compatible)',
}

const money = (value: number) => `$${Number(value.toFixed(4))}`

function describePrice(price: OptionPrice): string {
  return price.kind === 'llm'
    ? `${money(price.inputPerMTok)} in, ${money(price.outputPerMTok)} out per million tokens`
    : `${money(price.pricePerImage)} per image`
}

const PRICE_ERROR = 'Enter a price above zero, using a full stop for decimals.'

/** A typed price, or null when it is not a positive number written with a full stop. */
function parsePrice(raw: string): number | null {
  if (!/^\d+(\.\d+)?$/.test(raw.trim())) return null
  const value = Number(raw)
  return value > 0 ? value : null
}
```

The LLM price form:

```tsx
function LlmPriceForm({
  title,
  initial,
  saveLabel,
  onSave,
  onCancel,
}: {
  title: string
  initial: OptionPrice | null
  saveLabel: string
  onSave: (price: { inputPerMTok: number; outputPerMTok: number; cachedInputPerMTok?: number }) => void
  onCancel: () => void
}) {
  const seed = initial?.kind === 'llm' ? initial : null
  const [input, setInput] = React.useState(seed ? String(seed.inputPerMTok) : '')
  const [output, setOutput] = React.useState(seed ? String(seed.outputPerMTok) : '')
  const [cached, setCached] = React.useState(seed?.cachedInputPerMTok ? String(seed.cachedInputPerMTok) : '')
  const [error, setError] = React.useState<string | null>(null)
  const id = React.useId()

  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] p-3"
      onSubmit={(event) => {
        event.preventDefault()
        const inputPerMTok = parsePrice(input)
        const outputPerMTok = parsePrice(output)
        const cachedInputPerMTok = cached.trim() === '' ? undefined : parsePrice(cached)
        if (inputPerMTok === null || outputPerMTok === null || cachedInputPerMTok === null) {
          setError(PRICE_ERROR)
          return
        }
        onSave({
          inputPerMTok,
          outputPerMTok,
          ...(cachedInputPerMTok !== undefined ? { cachedInputPerMTok } : {}),
        })
      }}
    >
      <p className="text-[13px]">{title}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <Label htmlFor={`${id}-in`}>Input, $ per million tokens</Label>
        <Label htmlFor={`${id}-out`}>Output, $ per million tokens</Label>
        <Label htmlFor={`${id}-cached`}>Cached input, $ per million tokens (optional)</Label>
        <Input id={`${id}-in`} inputMode="decimal" value={input} onChange={(e) => setInput(e.target.value)} />
        <Input id={`${id}-out`} inputMode="decimal" value={output} onChange={(e) => setOutput(e.target.value)} />
        <Input id={`${id}-cached`} inputMode="decimal" value={cached} onChange={(e) => setCached(e.target.value)} />
      </div>
      {error ? <p className="text-[12px] text-[var(--color-danger)]">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" variant="primary">{saveLabel}</Button>
        <Button type="button" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}
```

The labels sit in a grid row above their inputs; if the grid makes `getByLabelText` ambiguous, wrap each label and input in its own column `div` instead. `--color-danger` is the error token the rest of `apps/web` uses.

The tab itself:

```tsx
export function ModelsTab({
  settings,
  saving,
  commit,
  options,
}: {
  settings: Settings
  saving: boolean
  commit: (patch: SettingsPatch, optimistic: Settings) => Promise<void>
  options: ModelOptions
}) {
  const router = useRouter()
  const [refreshing, setRefreshing] = React.useState(false)
  /** A route waiting on a price before it can be saved. */
  const [pending, setPending] = React.useState<{ task: LlmTask; provider: LlmProvider; model: string } | null>(null)
  /** Which route's price form is open, for Set price and Edit price. */
  const [editing, setEditing] = React.useState<LlmTask | null>(null)
  const [refusal, setRefusal] = React.useState<{ task: LlmTask; message: string } | null>(null)

  const refresh = React.useCallback(async () => {
    setRefreshing(true)
    try {
      await refreshModelListsAction()
      router.refresh()
    } finally {
      setRefreshing(false)
    }
  }, [router])

  // Once per mount, and only when a refresh could change anything: with no
  // key anywhere it would ask nobody and redraw the page on every visit.
  const autoRefreshed = React.useRef(false)
  React.useEffect(() => {
    if (autoRefreshed.current) return
    autoRefreshed.current = true
    if (options.canRefresh && isStale(options.lastAttemptAt, Date.now())) void refresh()
  }, [options.canRefresh, options.lastAttemptAt, refresh])

  const withPrice = (key: string, price: ModelPrices['llm'][string] | null): ModelPrices => {
    const llm = { ...settings.modelPrices.llm }
    if (price) llm[key] = price
    else delete llm[key]
    return { ...settings.modelPrices, llm }
  }

  const setRoute = (task: LlmTask, provider: LlmProvider, model: string) => {
    const next = structuredClone(settings)
    next.modelRouting[task] = { provider, model }
    void commit({ modelRouting: { [task]: { provider, model } } }, next)
  }

  const choose = (task: LlmTask, provider: LlmProvider, model: string) => {
    setRefusal(null)
    const option = options.llm[provider].find((o) => o.id === model)
    if (option?.status === 'needs-price') {
      setPending({ task, provider, model })
      return
    }
    setPending(null)
    setRoute(task, provider, model)
  }

  const savePrice = (task: LlmTask, provider: LlmProvider, model: string, price: ModelPrices['llm'][string], alsoRoute: boolean) => {
    const modelPrices = withPrice(modelPriceKey(provider, model), price)
    const next = structuredClone(settings)
    next.modelPrices = modelPrices
    if (alsoRoute) next.modelRouting[task] = { provider, model }
    void commit(
      alsoRoute ? { modelRouting: { [task]: { provider, model } }, modelPrices } : { modelPrices },
      next,
    )
    setPending(null)
    setEditing(null)
  }

  const clearPrice = (task: LlmTask, provider: LlmProvider, model: string) => {
    const option = options.llm[provider].find((o) => o.id === model)
    // A model with nothing to fall back to (no catalogue row, no family) is
    // unpriced without the override, so clearing it under a route would
    // leave a route every run refuses.
    const users = LLM_TASKS.filter(
      (t) => settings.modelRouting[t].provider === provider && settings.modelRouting[t].model === model,
    )
    if (option?.fallsBackTo === null && users.length > 0) {
      setRefusal({ task, message: `${TASK_LABELS[users[0]!]} uses this model. Pick another model first.` })
      return
    }
    const next = structuredClone(settings)
    next.modelPrices = withPrice(modelPriceKey(provider, model), null)
    void commit({ modelPrices: next.modelPrices }, next)
  }

  // ...render, described below...
}
```

Render, inside the existing `Card`:

1. A header row before the task rows:

```tsx
<div className="flex flex-wrap items-center justify-between gap-2">
  <p className="text-[12px] text-[var(--color-text-muted)]">
    {options.lastAttemptAt
      ? `Model lists last checked ${new Date(options.lastAttemptAt).toLocaleString('en-ZA')}.`
      : 'Model lists not checked yet.'}
  </p>
  <Button type="button" onClick={() => void refresh()} busy={refreshing} disabled={refreshing || !options.canRefresh}>
    Refresh model lists
  </Button>
</div>
```

2. One status line per provider (`anthropic`, `openai`, `google`, `fal`), in a `ul` labelled "Model list status":
   - `live`: `${name}: live list, refreshed ${time}.`
   - `failed`: `${name}: refresh failed at ${attempt}: ${error}. Showing the list from ${success}.` (when `lastSuccessAt` is null: `... Showing the built-in list.`)
   - `no-key`: `${name}: Add a key in Connections to load live models. Showing the built-in list.`
   - `never`: `${name}: not refreshed yet. Showing the built-in list.`
   Times use `toLocaleString('en-ZA')`.

3. Each task row keeps its provider select. Switching provider routes to the provider's first `selectable` option whose status is not `needs-price` (replacing `topModel`). The model select renders `options.llm[route.provider]`, non-preview options first, then an `optgroup` labelled "Preview: Google can withdraw these without notice" for previews. Each option's text is `${option.label}${SUFFIX[option.status]}`, `disabled={!option.selectable}`. Keep the existing "(unlisted)" option for a stored id no option holds. `onChange` calls `choose(task, route.provider, value)`.

4. Under each row, the selected option's line:
   - `estimated`: `Estimated at ${option.pricedAs}'s price: ${describePrice(option.price)}.` plus a **Set price** button opening `LlmPriceForm` (`editing = task`), prefilled with the estimate, `saveLabel="Save price"`.
   - `override`: `Your price: ${describePrice(option.price)}.` plus **Edit price** (opens the form, `saveLabel="Save price"`) and **Clear price** (`clearPrice`).
   - `retired`: `${PROVIDER_NAMES[provider]} no longer lists this model. Runs still try it, and fall back if it is refused.`
   - When `pending?.task === task`: `LlmPriceForm` with `title={`${label} needs a price before it can run.`}`, `saveLabel="Save price and use"`, prefilled from `option.price` (null), `onSave={(price) => savePrice(task, provider, model, price, true)}`, `onCancel={() => setPending(null)}`. While pending, the select shows the pending model.
   - When `refusal?.task === task`: the refusal message.

5. Below the LLM rows, render the existing stills, likeness and set-sheet rows unchanged for now; Task 12 converts them. Their `LIVE_IMAGE_GEN_ADAPTERS` reads stay until then, so this task's file may still import `LIVE_IMAGE_GEN_ADAPTERS` for those three rows only.

In `settings-form.tsx`, delete `ModelsTab` and `TASK_LABELS`, import `ModelsTab` from `./models-tab`, add the required prop `modelOptions: ModelOptions` to `SettingsForm`, and render `<ModelsTab settings={settings} saving={saving} commit={commit} options={modelOptions} />`. Remove the providers imports that are now unused.

In `page.tsx`, import `loadModelOptions` from `@/lib/model-catalogue`, compute `const modelOptions = await loadModelOptions(settings)` after the `Promise.all`, and pass `modelOptions={modelOptions}`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `pnpm --filter @boom-busters/web exec vitest run "app/(console)/settings"`
Expected: PASS, every settings test including voice and logos.

- [ ] **Step 6: Run the web suite, typecheck and lint**

Run (Bash `timeout` 600000): `pnpm --filter @boom-busters/web test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
pnpm format:check
git add "apps/web/app/(console)/settings"
git commit -m "feat(settings): live model options, prices and refresh on the Models tab (decision 287)"
```

---

### Task 12: The Models tab, image rows

**Files:**
- Modify: `apps/web/app/(console)/settings/models-tab.tsx`
- Test: `apps/web/app/(console)/settings/models-tab.test.tsx`

**Interfaces:**
- Consumes: `options.image` (Task 8); the price-form pattern from Task 11.

- [ ] **Step 1: Write the failing tests**

Append to `models-tab.test.tsx`:

```ts
describe('live image models (decision 287)', () => {
  it('offers a live Gemini image model for stills, estimated at its family', async () => {
    renderModelsTab()
    const select = screen.getByRole('combobox', { name: 'Still images model' })
    await userEvent.selectOptions(select, 'gemini-9-flash-image')
    expect(saveSettings).toHaveBeenCalledWith({
      modelRouting: { stills: { provider: 'google', model: 'gemini-9-flash-image' } },
    })
    expect(await screen.findByText(/Estimated at Gemini 3.1 Flash Image's price: \$0.07 per image\./)).toBeInTheDocument()
  })

  it('offers a live 4K-capable Gemini model for set sheets', () => {
    renderModelsTab()
    const sheet = screen.getByRole('combobox', { name: 'Set sheets model' })
    expect(Array.from(sheet.querySelectorAll('option')).map((o) => o.value)).toContain('gemini-9-flash-image')
  })

  it('shows a fal endpoint it cannot send as disabled, with the reason', async () => {
    const options = modelOptions()
    options.image.fal.push({
      id: 'fal-ai/one-at-a-time',
      label: 'One at a time',
      status: 'incompatible',
      preview: false,
      selectable: false,
      price: null,
      pricedAs: null,
      reason: 'Makes one image per request, or takes an input this app cannot send.',
      catalogued: false,
      fallsBackTo: null,
    })
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.modelRouting.stills = { provider: 'fal', model: 'fal-ai/flux/dev' }
    renderModelsTab(options, settings)
    expect(screen.getByRole('option', { name: 'One at a time (not compatible)' })).toBeDisabled()
  })
})
```

Update the existing set-sheet test's expected option list to `['gemini-3.1-flash-image', 'gemini-3-pro-image', 'gemini-9-flash-image']`, since the mock list now holds a live 4K-capable model.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @boom-busters/web exec vitest run "app/(console)/settings/models-tab.test.tsx"`
Expected: FAIL; the image rows still read the hand-written lists.

- [ ] **Step 3: Convert the three image rows**

In `models-tab.tsx`:

1. Stills: the model select renders `options.image[stills.provider]` with the same option text, `disabled` and preview grouping as the LLM rows, and the same line under it (estimated, your price, no longer offered, needs a price via the price form). Provider switch picks the first selectable, priced option of `options.image[provider]`.
2. Likeness split: the same, over `options.image[likeness.provider]`, keeping the "same as above" option.
3. Set sheets: render `options.image.google` filtered to options whose `price?.kind === 'image'` and `price.pricesBySize?.['4K'] !== undefined`, plus the stored model if it is not among them, so the select never shows a model it is not using.
4. The image price form takes "Price per image ($)" and, for a Google model, optional "1K", "2K" and "4K" prices per image, validated with `parsePrice` and the same error text. It writes `settings.modelPrices.image[modelPriceKey(provider, model)]`. Generalise `withPrice`, `savePrice` and `clearPrice` from Task 11 over `kind: 'llm' | 'image'` rather than copying them; the clear-refusal rule checks `stills`, `stillsLikeness` and `setSheet` for image models.
5. Remove the last `LIVE_IMAGE_GEN_ADAPTERS` import. Confirm with `grep -n "@boom-busters/providers" "apps/web/app/(console)/settings/models-tab.tsx" "apps/web/app/(console)/settings/settings-form.tsx"` that the client imports only types, `isStale`, and nothing that carries the hand-written catalogues as values.

- [ ] **Step 4: Run the tests to see them pass**

Run: `pnpm --filter @boom-busters/web exec vitest run "app/(console)/settings"`
Expected: PASS.

- [ ] **Step 5: Run the web suite, typecheck and lint**

Run (Bash `timeout` 600000): `pnpm --filter @boom-busters/web test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
pnpm format:check
git add "apps/web/app/(console)/settings"
git commit -m "feat(settings): live image models for stills, the likeness split and set sheets (decision 287)"
```

---

### Task 13: End to end, and the progress log

**Files:**
- Create: `e2e/tests/settings-models.spec.ts`
- Modify: `PROGRESS.md`

- [ ] **Step 1: Write the e2e test**

Create `e2e/tests/settings-models.spec.ts`, following `settings-logos.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { expectHitTargets, signIn } from './fixtures'

/**
 * Settings → Models with live lists (decision 287), in mock-provider mode:
 * Refresh fills the dropdowns from fixtures, a family model is labelled
 * estimated, and a model with no family is priced and routed in one save
 * that survives a reload. Puts the route and the price back at the end, so
 * the suite stays order-independent.
 */

test.describe('Models tab, live lists', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await page.goto('/settings?tab=models')
  })

  test('refreshes, prices an unpriced model and routes to it', async ({ page }) => {
    await page.getByRole('button', { name: 'Refresh model lists' }).click()
    await expect(page.getByText(/Anthropic: live list, refreshed/)).toBeVisible()

    const research = page.getByRole('combobox', { name: 'Research (dossiers) model' })
    await expect(research.getByRole('option', { name: 'Claude Opus Mock 9 (estimated)' })).toHaveCount(1)

    await research.selectOption('claude-mock-unpriced')
    await expect(page.getByText('Claude Mock Unpriced needs a price before it can run.')).toBeVisible()
    await page.getByLabel('Input, $ per million tokens').fill('7')
    await page.getByLabel('Output, $ per million tokens').fill('30')
    await page.getByRole('button', { name: 'Save price and use' }).click()
    await expect(page.getByText('Saved')).toBeVisible()

    await page.reload()
    await expect(page.getByRole('combobox', { name: 'Research (dossiers) model' })).toHaveValue(
      'claude-mock-unpriced',
    )
    await expect(page.getByText(/Your price: \$7 in, \$30 out per million tokens\./)).toBeVisible()
    await expectHitTargets(page)

    // Put it back: route first, then the price can be cleared.
    await page.getByRole('combobox', { name: 'Research (dossiers) model' }).selectOption('claude-opus-5')
    await expect(page.getByText('Saved').first()).toBeVisible()
  })
})
```

Clearing the leftover override is optional for order-independence (an override on an unused fixture model changes nothing else), but if you add it, select the model in a route whose current value you then restore.

- [ ] **Step 2: Run the e2e test alone**

Scope the run from the e2e package, not with `pnpm e2e -- <paths>`, which runs everything. If an earlier interrupted run left a dev server on port 3100, free it first.

Run (Bash `timeout` 600000): `pnpm --filter @boom-busters/e2e exec playwright test tests/settings-models.spec.ts`
Expected: PASS.

- [ ] **Step 3: Run the whole e2e suite once**

Run (Bash `timeout` 600000): `pnpm e2e`
Expected: PASS. The visual board specs exercise the board's Image model select through the new view-model options.

- [ ] **Step 4: Record decision 287 in PROGRESS.md**

Read the last decision entry in `PROGRESS.md` (decision 286 or 285) and add decision 287 after it in the same format. Cover, in the house voice:

- the owner's ask (2026-10-01): live model lists in every dropdown, Opus 5.5 not selectable;
- what shipped: the catalogue module, the cache tables (migration 0032), family pricing with the named representatives, owner price overrides in `settings.modelPrices`, the router's injected resolver, the image adapter factories and fal dialects, the Models tab's labels, status lines and Refresh button, and the board's select;
- decisions made where the spec left room: needs-price models are chosen through the price form ("Save price and use") rather than being disabled in the select, which is how Set price reaches a model that cannot yet be routed; `fallsBackTo` decides when clearing a price is refused; listing lives in the catalogue module rather than on the adapters;
- not done: per-model output caps, a "try this model" button, a voice model dropdown, refreshing catalogued fal prices from fal's pricing endpoint (spec section 12);
- shipping: a Vercel deploy and migration 0032, which the build runs; no broker or Remotion redeploy, because no timeline schema or composition changed; then `PUT /api/inngest` after the deploy, as after every Vercel deploy.

- [ ] **Step 5: Full verification**

Run (Bash `timeout` 600000): `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: PASS. `pnpm test` runs every package at concurrency 1, including the database suites; nothing else may be using the test database while it runs.

- [ ] **Step 6: Commit**

```bash
git add e2e/tests/settings-models.spec.ts PROGRESS.md
git commit -m "test(e2e): live model lists on the Models tab; decision 287 in PROGRESS"
```
