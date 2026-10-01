# Live model lists: every model dropdown asks the provider (decision 287)

Status: design approved in conversation 2026-10-01, section by section; this
document is for the owner's review before an implementation plan is written.

## 1. The problem

The owner, 2026-10-01: "in terms of anthropic models, the drop downs I want
to be able to fetch the models in real time. So for example Opus 5.5 ... [is]
out but I can't select [it]. This should apply to all the model selections,
there should be a call or query that fetches the live options."

Every model dropdown in Settings → Models reads a hand-written catalogue that
`settings-form.tsx` imports straight from `@boom-busters/providers`:
`ANTHROPIC_MODELS`, `OPENAI_MODELS` and `GOOGLE_MODELS` for the LLM routes,
the Gemini and fal `MODELS` arrays for stills, the likeness split and the set
sheet. A model a provider released after the last edit cannot be chosen. The
catalogue also carries the price of every model, and that price is load
bearing: router pre-flight refuses an uncatalogued id (`router.ts:109`),
`llmPrice` throws on one (`cost/src/prices.ts:64`), `imageGenModel` throws on
one (`visuals/types.ts:197`), and the fallback path walks catalogue tiers.

No code calls any provider's list-models endpoint today.

This is the first of two sub-projects the owner asked for on 2026-10-01. The
second, a dedicated model route for motion graphics, gets its own spec after
this one ships, so that its route can be pointed at a model this one makes
selectable.

## 2. Goals and non-goals

Goals:

- Every existing model dropdown (the seven LLM routes, stills, the likeness
  split, the set sheet) offers what the provider serves
  now, without a code change when a model is released.
- Every model a run can use still has a price before the call is made, so
  the cost caps keep their teeth.
- A provider whose list call fails never empties its dropdown.

Non-goals:

- Using a model's live output cap (`max_tokens` from the Models API) in
  place of the global `MAX_OUTPUT_TOKENS`. Recorded in section 12.
- A voice model dropdown. ElevenLabs stays fixed to `eleven_v3`, which is
  deliberate (`tts/elevenlabs.ts:48`); there is no dropdown to make live.
- A "try this model" button that spends a token to prove a listed model
  answers. Recorded in section 12.

## 3. Decisions taken with the owner

1. **Approach A: a cached live list.** Each adapter lists its provider's
   models; the result is cached in the database and refreshed when the
   Models tab opens on a cache older than 24 hours, or when the owner presses
   **Refresh model lists**. Rejected: fetching on every Settings load with no
   cache (slow, and one failure blanks a dropdown); a daily Inngest cron (a
   moving part for a screen visited rarely).
2. **Unpriced models get their family's price, marked "estimated", and the
   owner can override it.** List endpoints return no prices (Anthropic,
   OpenAI and Google all confirmed). A model the code has no price for is
   charged at the price of the newest catalogued model in its family, shown
   as estimated, with a **Set price** button to enter the real rate.

## 4. Listing

A new optional method on the LLM and image adapters:

```ts
listModels(apiKey: string, fetchImpl?: typeof fetch): Promise<ListedModel[]>

interface ListedModel {
  id: string
  label: string
  kind: 'llm' | 'image'
  /** Google previews; listed, but grouped and warned about (section 8). */
  preview: boolean
  contextTokens: number | null
  maxOutputTokens: number | null
  /** fal only: the request shape this endpoint speaks (section 7.2). */
  dialect: FalDialect | null
  /** fal only: the provider's own unit price, when it publishes one. */
  pricePerImage: number | null
}
```

Per provider:

- **Anthropic.** `GET /v1/models`, following `has_more` and `last_id` until
  the list ends. Uses `id`, `display_name`, `max_input_tokens`, `max_tokens`.
  Every entry is `kind: 'llm'`.
- **OpenAI.** `GET /v1/models`. Keeps ids that start `gpt-` or `o` followed
  by a digit; drops any id containing `embedding`, `tts`, `transcribe`,
  `audio`, `realtime`, `image`, `search`, `moderation`, `dall-e` or
  `whisper`. Drops a dated snapshot (`-YYYY-MM-DD` suffix) when its undated
  alias is also listed. The label is the id; OpenAI returns no display name.
- **Google.** `GET /v1beta/models`, following `nextPageToken`. Keeps models
  whose `supportedGenerationMethods` include `generateContent`. An id
  containing `-image` is `kind: 'image'`; anything else is `kind: 'llm'`.
  Drops ids containing `embedding`, `tts`, `audio`, `live` or `aqa`. An id
  containing `-preview` or `-exp` is kept with `preview: true`. Uses
  `displayName`, `inputTokenLimit`, `outputTokenLimit`. One key lists both
  the Gemini LLMs and the Gemini image models, so Google is listed once and
  split by kind.
- **fal.** `GET https://api.fal.ai/v1/models?category=text-to-image&status=active&expand=openapi-3.0`,
  following `cursor`, then `GET https://api.fal.ai/v1/models/pricing` for the
  ids returned. Auth header `Authorization: Key <key>`. Each endpoint's
  dialect is read from its OpenAPI input schema (section 7.2); an endpoint
  whose schema fits no dialect is kept with `dialect: null` and shown as not
  compatible.

Ids that `LEGACY_MODEL_IDS` or `LEGACY_STILL_MODEL_IDS` fold forward are
dropped from every live list. They are ids already known to be dead or
renamed (the `gemini-2.5-pro` case: listed by `GET /models`, refused by
`generateContent`), and offering them would undo the fold.

`MOCK_PROVIDERS` mode: every `listModels` returns a fixed fixture that holds
each catalogued model plus one live-only model per provider
(`claude-opus-mock-9`, `gpt-5-mock`, `gemini-9-flash`, `gemini-9-flash-image`,
`fal-ai/mock-flux`), so the e2e suite can exercise the estimated path without
a network.

## 5. Data

Migration 0032 adds two tables.

```ts
export const modelCatalogue = pgTable('model_catalogue', {
  provider: text('provider').notNull(),          // 'anthropic' | 'openai' | 'google' | 'fal'
  modelId: text('model_id').notNull(),
  kind: text('kind').notNull(),                  // 'llm' | 'image'
  label: text('label').notNull(),
  preview: boolean('preview').notNull().default(false),
  contextTokens: integer('context_tokens'),
  maxOutputTokens: integer('max_output_tokens'),
  dialect: text('dialect'),
  pricePerImage: numeric('price_per_image'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
}, (t) => [primaryKey({ columns: [t.provider, t.modelId] })])

export const modelCatalogueRefresh = pgTable('model_catalogue_refresh', {
  provider: text('provider').primaryKey(),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }).notNull(),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastError: text('last_error'),
})
```

A successful refresh replaces that provider's rows in one transaction and
sets `lastSuccessAt`, clearing `lastError`. A failed refresh touches no
catalogue rows and sets `lastAttemptAt` and `lastError` only.

Price overrides live in settings, not the cache, because they are the
owner's choice and must survive a refresh:

```ts
modelPrices: z.object({
  llm: z.record(z.string(), z.object({          // key: `${provider}:${modelId}`
    inputPerMTok: z.number().positive(),
    outputPerMTok: z.number().positive(),
    cachedInputPerMTok: z.number().positive().optional(),
  })).default({}),
  image: z.record(z.string(), z.object({
    pricePerImage: z.number().positive(),
    pricesBySize: z.object({
      '1K': z.number().positive(),
      '2K': z.number().positive(),
      '4K': z.number().positive(),
    }).partial().optional(),
  })).default({}),
}).default({ llm: {}, image: {} })
```

`SettingsPatchSchema` gains the same field, optional. `normaliseSettings`
fills the default for rows stored before it existed.

## 6. Pricing and resolution

### 6.1 Families

A new module, `packages/providers/src/catalogue/families.ts`, maps an id to
a family by pattern, per provider and kind:

| Provider | Kind | Pattern | Family |
|---|---|---|---|
| anthropic | llm | `^claude-opus-` | opus |
| anthropic | llm | `^claude-sonnet-` | sonnet |
| anthropic | llm | `^claude-haiku-` | haiku |
| openai | llm | `^gpt-5` containing `-mini` | gpt-5-mini |
| openai | llm | `^gpt-5` with no `-mini` or `-nano` | gpt-5 |
| google | llm | contains `-flash-lite` | flash-lite |
| google | llm | contains `-flash` | flash |
| google | llm | contains `-pro` | pro |
| google | image | contains `-pro-image` | pro-image |
| google | image | contains `-flash-image` | flash-image |
| fal | image | dialect is not null | none; fal publishes real prices |

Patterns are tried top to bottom; the first match wins. Anything that
matches no row has no family. That is deliberate for ids like
`claude-fable-5-1`, whose price ($10/$50) is double any Opus: a family guess
would underprice it by half, so it must be priced by hand.

A family's price, tier and (for Gemini images) request flags are those of
the first catalogued model in that family, the catalogue being ordered best
first. Tier matters to the fallback path: a live `claude-opus-5-5` inherits
the Opus tier, so `nextTierDown` steps from it to `claude-sonnet-5` exactly
as it does from `claude-opus-5`. Fallback targets therefore stay catalogued
models.

### 6.2 `resolveModel`

```ts
resolveModel(provider, kind, modelId, prices: Settings['modelPrices']):
  | { ok: true; price: ...; tier: number; source: 'override' | 'catalogue' | 'family' | 'provider'; label: string }
  | { ok: false; reason: 'unpriced' }
```

Order: the owner's override; the hand-written catalogue; for fal, the
cached provider price; the family. `canonicalModelId` is applied first, as
it is today.

It needs only the settings row and, for fal, the cache. Runs never call a
provider's list endpoint, so a list outage cannot stop a render.

Consumers switched from the static lookups to `resolveModel`:

- router pre-flight (`llm/router.ts:109`) and its cost settlement
  (`router.ts:195`);
- `llmPrice` and `estimateLlmUsd` (`cost/src/prices.ts`), which gain a
  `prices` argument; `callLlm` (`apps/web/lib/llm.ts`) passes the settings it
  already reads;
- `fallbackPath` and `nextTierDown`, which read tier from the resolution
  (the stored `fallbackChain` has no control in the form and gets none
  here; its entries pass the same pre-flight);
- `imageGenPrice` and `imageGenModel` (`visuals/types.ts`), and their
  callers in `visual-assets.ts` and `set-sheet.ts`.

An id that resolves `unpriced` is refused before the call, with the message
"<id> has no price. Set one in Settings → Models." This is the same refusal
an uncatalogued id meets today, with a way out named.

## 7. Image models

### 7.1 Gemini

A live Gemini image model with no catalogue row inherits its family's
request flags as well as its price: `flash-image` behaves like
`gemini-3.1-flash-image` (sized, takes `thinkingConfig`, reference limits
4 and 10); `pro-image` like `gemini-3-pro-image` (sized, no
`thinkingConfig`, limits 5 and 6). `SIZED_MODELS`, `THINKING_MODELS` and
`REFERENCE_LIMITS` become lookups through the family before falling back to
`UNDOCUMENTED_LIMITS`. The set sheet dropdown keeps its rule of showing only
models with a 4K price; a family-priced model qualifies when its family has
one.

### 7.2 fal

The fal adapter today picks a dialect with `isImagen(model)`. Dialects
become explicit:

- `flux`: input schema has `prompt`, `num_images` and `image_size`.
- `aspect`: input schema has `prompt`, `num_images` and `aspect_ratio`;
  `negative_prompt` is sent as itself when the schema has it, folded into
  the prompt otherwise.

An endpoint without `num_images` (FLUX.2 pro and FLUX1.1 ultra today) fits
neither, because the N-variants call needs it; it is listed as "not
compatible: one image per request" and cannot be chosen.

At run time the adapter reads a fal model's dialect from the hand-written
list when the model is in it, from its cached `model_catalogue` row
otherwise, and refuses a model with neither. Reference routing (Kontext versus FLUX.2 edit) is unchanged: an
unknown text-to-image endpoint routes its references to Kontext, as
everything outside FLUX.2 does now.

## 8. The Models tab

`settings/page.tsx` loads the cache and refresh rows beside the settings and
passes merged options to `SettingsForm`. The form stops importing the
catalogues from `@boom-busters/providers`.

Each option carries one label:

- no label: catalogued, real price;
- **estimated**: priced by family, with **Set price** beside the dropdown
  while it is selected;
- **your price**: an override is set, with **Edit price** and **Clear
  price**;
- **no longer offered**: catalogued or saved, but absent from the provider's
  last successful list; still selectable, with a warning line;
- **needs a price**: matches no family; disabled until **Set price** is
  used;
- **not compatible** (fal only): disabled, with the reason.

Google previews sit in their own group at the bottom of the Google options,
headed "Preview: Google can withdraw these without notice". This keeps the
warning the catalogue comment gives (`llm/google.ts:22`) while letting the
owner choose one.

Under each provider's options, one status line: "Live list, refreshed
14:02", or "Refresh failed at 14:02: key rejected. Showing the list from
09:15.", or "Add a <provider> key in Connections to load live models.
Showing the built-in list."

One **Refresh model lists** button at the top of the tab calls a server
action that refreshes every provider with a stored key in parallel, with a
10 second timeout each, then refreshes the route. The button is busy while
it runs. When the tab mounts and the newest `lastAttemptAt` is older than
24 hours, the tab presses it for the owner: the same action, the same busy
state, no hidden path.

**Set price** opens an inline form under the dropdown: input, output and
cached input per million tokens for an LLM; per image, and per size where
the model is sized, for an image model. It is prefilled with the family
price when there is one. Saving writes `modelPrices` through the existing
`saveSettings` action.

## 9. Failure behaviour

- A list call that errors, times out or returns a non-2xx keeps the
  provider's cached rows and records the error. Other providers refresh
  independently.
- A list that is empty after filtering counts as a failure, so a filter
  that goes wrong cannot wipe a dropdown.
- No key for a provider: no call is made; the built-in list shows with the
  "add a key" line.
- A saved model the provider stops listing is labelled, not removed. A run
  still tries it; if the provider refuses it, the existing error and the
  fallback chain handle it, as for a retired id today.
- An unpriced model cannot be saved from the form, and if one reaches a run
  through a stored row, pre-flight refuses it with the message in 6.2.
- The refresh action never throws to the page: it returns per-provider
  results, which the status lines show.

## 10. Testing

Unit, with recorded responses and no network:

- each `listModels`: Anthropic paging, OpenAI filtering and snapshot
  dropping, Google paging, kind split and preview flag, fal paging, pricing
  join and dialect detection from schemas;
- legacy ids are dropped from every list;
- the family table, as a table test: `claude-opus-5-5` is opus,
  `claude-fable-5-1` has no family, `gemini-9-flash-lite` is flash-lite not
  flash, `gemini-9-pro-image` is pro-image, nonsense has no family;
- `resolveModel` precedence: override over catalogue over provider over
  family, and `unpriced`;
- the merge labels for each case in section 8;
- the cache queries: success replaces rows, failure keeps them and records
  the error.

Integration:

- the router: a live-only model with an override passes pre-flight and
  settles its ledger row at the override price; with no override, a family
  model settles at the family price; an unpriced one is refused before any
  fetch;
- `generateStillCandidates` with a live-only Gemini image model sends the
  family's flags; with a live-only fal model, the cached dialect.

Component (Models tab): estimated label and Set price flow; your price with
Clear; refresh failure line; the busy Refresh button; the auto refresh on a
stale cache. Per the standing note, a Settings tab change adds its actions
mock to `voice-tab.test.tsx`.

e2e (`MOCK_PROVIDERS`): the mock live models appear after Refresh; set a
price on `claude-opus-mock-9`, route research to it, save, reload, still
selected with "your price".

## 11. Build order and shipping

1. Migration, tables and queries.
2. `ListedModel`, the four `listModels` methods, the mock fixtures.
3. Families and `resolveModel`, then the consumer switch, suite by suite
   (providers, cost, web), each consuming package's suite run in full.
4. Settings field, refresh action, Models tab.
5. e2e.

Shipping is a Vercel deploy plus migration 0032, which the build runs. The
broker and the Remotion site are untouched: nothing here changes a timeline
schema or a composition.

## 12. Recorded, not built

- Per-model output caps from the live list in place of `MAX_OUTPUT_TOKENS`.
- A "try this model" button: a one-token call proving a listed model
  answers, since a listing is not an offer.
- A voice model dropdown fed by ElevenLabs `GET /v1/models`.
- Refreshing catalogued prices from fal's pricing endpoint (today fal
  catalogue prices stay hand-written; only uncatalogued fal models use the
  live price).
