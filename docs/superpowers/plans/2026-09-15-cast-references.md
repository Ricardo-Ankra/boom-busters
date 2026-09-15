# Cast References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generated stills of a real person look like that person, because the image model is shown the producer's reference photos of them on every call.

**Architecture:** A per-project `cast_members` table and Cast card hold names, roles, up to four photos in R2, and an identity string written from the photos by a vision call. The Director's Book takes the cast as input; the shot list names cast members in `depicts`; `generateStillCandidates` attaches the photos as `references` on the image request, which the Gemini adapter sends as inline image parts and the fal adapter sends to an identity-conditioned FLUX Kontext endpoint. The guardrail leaves the image prompt.

**Tech Stack:** pnpm monorepo; Next.js App Router server actions ('use server' exports only async functions); Zod 4; Drizzle + Postgres (test DB in Docker on 5433, Docker Desktop must be running); Inngest 4; vitest; Playwright in mock-provider mode.

**Spec:** `docs/superpowers/specs/2026-09-15-cast-references-design.md`

## Global Constraints

- No em or en dashes anywhere in code, docs or copy; write "2019 to 2024" for ranges. South African English spelling.
- Every commit ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; run `pnpm format:check`, `pnpm lint`, `pnpm typecheck` before each commit; CI green on every commit.
- 'use server' modules export only async functions.
- No real provider calls in tests; mock-provider mode (`MOCK_PROVIDERS=1`) everywhere; every adapter test uses recorded shapes and an injected `fetchImpl`.
- Bible edits happen in `direction-craft.md`, then re-embed into `direction-craft.ts` (byte-identity test).
- Button-first UI, every action a visible labelled button; dark theme.
- fal model ids are listed only after a live check against fal's catalogue with the producer's key (the adapter's own rule).
- Work on branch `cast-references` from `master`.

---

### Task 1: Guardrail out of the image prompt, face features in the identity string

**Files:**
- Modify: `packages/providers/src/prompts/direction-craft.md` (People, Pre-flight)
- Modify: `packages/providers/src/prompts/direction-craft.ts` (re-embed)
- Modify: `packages/providers/src/prompts/shotlist.ts` (still rule)
- Modify: `packages/providers/src/prompts/direction.ts` (identityString rule)
- Test: `packages/providers/src/prompts/shotlist.test.ts`, `direction.test.ts`, `direction-craft.test.ts`

**Interfaces:** none new; prompt text only.

- [ ] **Step 1: Failing tests**

```ts
// shotlist.test.ts, inside 'buildShotListRequest with direction (decision 252)'
it('keeps the guardrail out of the image prompt and points at the reference photo', () => {
  expect(request.system).not.toContain('quote their guardrail line in the prompt')
  expect(request.system).toContain('never pasted into the image prompt')
  expect(request.system).toContain('the person in the reference photo')
})
// direction.test.ts
it('asks for a face in the identity string, not a job title', () => {
  expect(request.system).toContain('face shape, hair, beard or none, glasses or none')
})
// direction-craft.test.ts
it('says guardrail text never appears in a prompt', () => {
  expect(DIRECTION_CRAFT).toContain('No guardrail text appears in any prompt')
})
```

- [ ] **Step 2: Run, see them fail**

`pnpm --filter @boom-busters/providers exec vitest run src/prompts` : three failures.

- [ ] **Step 3: Edit the bible** (People section): replace the "Quote it in every prompt that shows them" sentence with "The guardrail governs what the planner writes; it is never pasted into the image prompt. Its nouns may become the negative prompt (no gavel, no handcuffs, no cash); its sentences are never quoted." Add to the still-prompt rules: "A prompt showing a cast member names them and says 'the person in the reference photo'; clothing, place and posture vary, facial descriptors are not added." Pre-flight: replace the identity line with "Every prompt showing a real person names them in full and lists them in 'depicts'. No guardrail text appears in any prompt."

- [ ] **Step 4: Edit the shot-list still rule** in `shotlist.ts`: "A prompt that shows a real person names them first, by full name and role, then says 'the person in the reference photo', then their identity string as one sentence. Never quote the guardrail; it decides what you plan, not what the image model reads. Put its concrete nouns in negativePrompt."

- [ ] **Step 5: Edit the book rule** in `direction.ts`: identityString "begins with the full name and role, then the face: face shape, hair, beard or none, glasses or none, apparent age range, build, typical dress, as press photographs of the period show them".

- [ ] **Step 6: Re-embed** with the scratch script pattern (read md, replace the template literal body, escape backticks, `${` and backslashes), then `pnpm exec prettier --write` both files.

- [ ] **Step 7: Run providers tests, format, lint, typecheck; commit**

```bash
git commit -m "fix: guardrail leaves the image prompt; identity strings carry the face (decision 253)"
```

---

### Task 2: Cast schemas

**Files:**
- Create: `packages/schemas/src/cast.ts`
- Modify: `packages/schemas/src/index.ts` (export)
- Test: `packages/schemas/src/cast.test.ts`

**Interfaces (produces):**

```ts
export const CAST_PHOTO_VIEWS = ['front', 'three-quarter', 'profile', 'full', 'other'] as const
export const CAST_PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const
export const MAX_CAST_PHOTOS = 4
export const CastPhotoSchema = z.object({
  r2Key: z.string().min(1), contentHash: z.string().min(1),
  mimeType: z.enum(CAST_PHOTO_MIME), width: z.number().int().positive(), height: z.number().int().positive(),
  view: z.enum(CAST_PHOTO_VIEWS), sourceUrl: z.string().url().optional(),
})
export const CastMemberSchema = z.object({
  id: z.string(), projectId: z.string(),
  name: z.string().trim().min(1).max(120), role: z.string().trim().min(1).max(200),
  identityString: z.string().max(600), guardrail: z.string().max(600),
  photos: z.array(CastPhotoSchema).max(MAX_CAST_PHOTOS),
})
export type CastPhoto = z.infer<typeof CastPhotoSchema>
export type CastMember = z.infer<typeof CastMemberSchema>
/** Front view first, then the rest in upload order: the order references are sent. */
export function referencePhotos(member: CastMember, limit = 1): CastPhoto[]
```

- [ ] **Step 1: Failing tests**: parses a member with two photos; refuses five photos; refuses `image/gif`; `referencePhotos` puts `front` first and honours the limit.
- [ ] **Step 2: Run, fail. Step 3: Implement. Step 4: Run, pass.**
- [ ] **Step 5: Commit** `feat: cast member and photo schemas (decision 253)`

---

### Task 3: Database table and functions

**Files:**
- Modify: `packages/db/src/schema.ts` (add `castMembers`)
- Create: `packages/db/drizzle/0022_<name>.sql` via `pnpm db:generate`
- Create: `packages/db/src/cast.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/cast.test.ts` (integration, `requireTestDatabase`)

**Interfaces (produces):**

```ts
export async function listCastMembers(db, projectId): Promise<CastMember[]>
export async function getCastMember(db, id): Promise<CastMember | null>
export async function insertCastMember(db, { projectId, name, role }): Promise<CastMember>   // identityString '', guardrail '', photos []
export async function updateCastMember(db, id, patch: Partial<Pick<CastMember,'name'|'role'|'identityString'|'guardrail'>>): Promise<CastMember>
export async function setCastPhotos(db, id, photos: CastPhoto[]): Promise<CastMember>      // validates max 4
export async function deleteCastMember(db, id): Promise<void>
/** Members whose exact name appears in `names`; the lookup generation uses. */
export async function castMembersNamed(db, projectId, names: readonly string[]): Promise<CastMember[]>
```

Table as in the spec: `unique(project_id, name)`, cascade on project delete, `photos` jsonb default `'[]'`.

- [ ] **Step 1: Failing tests**: insert then list; unique name per project throws; `setCastPhotos` with five photos throws `ValidationError`; `castMembersNamed` matches exact names only; deleting the project cascades.
- [ ] **Step 2: Add the table, `pnpm db:generate`, `pnpm --filter @boom-busters/db migrate:test`** (Docker Desktop running).
- [ ] **Step 3: Implement, run, pass. Step 4: Commit** `feat: cast_members table and functions (decision 253)`

---

### Task 4: Storage helpers for cast photos

**Files:**
- Modify: `apps/web/lib/storage.ts`
- Test: `apps/web/lib/storage.test.ts`

**Interfaces (produces):**

```ts
export function castPhotoKey(input: { projectId: string; contentHash: string; ext: 'jpg' | 'png' | 'webp' }): string
// boom-busters/cast/<projectId>/<contentHash>.<ext>
export async function getObjectBytes(key: string): Promise<{ bytes: Uint8Array; contentType: string }>
```

`getObjectBytes` uses the existing `r2()` client with `GetObjectCommand`; in mock storage it throws `ValidationError('Storage is not configured')` so callers fall back to text-only generation.

- [ ] **Step 1: Failing tests** for the key shape and the mock-storage refusal. **Step 2: Implement. Step 3: Commit** `feat: cast photo keys and an R2 byte reader (decision 253)`

---

### Task 5: Images on LLM messages

**Files:**
- Modify: `packages/providers/src/llm/types.ts` (`Msg.images?`)
- Modify: `packages/providers/src/llm/anthropic.ts`, `google.ts`, `openai.ts`
- Test: `packages/providers/src/llm/adapters.test.ts`

**Interfaces (produces):**

```ts
export interface MsgImage { mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; data: string /* base64 */ }
export interface Msg { role: 'user' | 'assistant'; content: string; images?: MsgImage[] }
```

Anthropic: `content: [...images.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.mimeType, data: i.data } })), { type: 'text', text, cache_control? }]`. Google: `parts: [...images.map(i => ({ inlineData: { mimeType, data } })), { text }]`. OpenAI: `content: [...images.map(i => ({ type: 'image_url', image_url: { url: 'data:<mime>;base64,<data>' } })), { type: 'text', text }]`.

- [ ] **Step 1: Failing tests** (one per adapter, capture body): a message with one image emits the image part before the text part with the right shape; a message without images is byte-identical to today's body.
- [ ] **Step 2: Implement all three. Step 3: Run adapters tests. Step 4: Commit** `feat: LLM messages carry images for vision prompts (decision 253)`

---

### Task 6: The cast-identity prompt

**Files:**
- Create: `packages/providers/src/prompts/cast-identity.ts`
- Modify: `packages/providers/src/prompts/index.ts` (export)
- Test: `packages/providers/src/prompts/cast-identity.test.ts`

**Interfaces (produces):**

```ts
export function buildCastIdentityRequest(input: { name: string; role: string; photos: MsgImage[] }): LLMTaskRequest
// task 'direction'; system: DIRECTION_CRAFT People section rules + "describe only what is visible; no character, health or ethnicity inference beyond what is visible; at most 60 words"; one user message with the photos and "Describe <name>, <role>, as a photograph would."
// maxTokens: outputBudget(400)
export function parseCastIdentity(text: string): { identityString: string; guardrail: string }
// JSON {"identityString": string, "guardrail": string}; identityString trimmed, <= 600 chars; guardrail defaults to DEFAULT_GUARDRAIL when empty
export const DEFAULT_GUARDRAIL = 'never handling cash or signing an invented contract; never in handcuffs; never mocked, caricatured or shown in humiliation'
export function mockCastIdentity(input: { name: string; role: string }): { identityString: string; guardrail: string }
// '[mock] <name>, <role>: oval face, short dark hair, no beard, no glasses, 40s, medium build, dark suit'
```

- [ ] **Step 1: Failing tests**: routes to `direction`; puts the photos on the user message; parses a fenced answer; empty guardrail becomes the default; mock is deterministic.
- [ ] **Step 2: Implement. Step 3: Commit** `feat: identity strings written from cast photos (decision 253)`

---

### Task 7: Cast server actions

**Files:**
- Create: `apps/web/app/(console)/projects/[id]/cast-actions.ts` ('use server')
- Test: `apps/web/app/(console)/projects/[id]/cast-actions.test.ts` (integration, mock storage)

**Interfaces (produces):**

```ts
export async function addCastMemberAction(projectId: string, input: { name: string; role: string }): Promise<ActionResult<{ id: string }>>
export async function updateCastMemberAction(id: string, patch: { name?: string; role?: string; identityString?: string; guardrail?: string }): Promise<ActionResult>
export async function removeCastMemberAction(id: string): Promise<ActionResult>
export async function createCastPhotoUploadAction(input: { memberId: string; mimeType: string; contentHash: string; view: CastPhotoView }): Promise<ActionResult<{ key: string; url: string }>>
// mirrors createOwnUploadAction: presigned PUT, key from castPhotoKey; refuses when photos.length >= 4 or mime not allowed
export async function finaliseCastPhotoAction(input: { memberId: string; key: string; contentHash: string; mimeType: string; width: number; height: number; view: CastPhotoView }): Promise<ActionResult>
// headObject to confirm the bytes exist, append the photo, then if identityString is '' run describeCastMember once
export async function removeCastPhotoAction(input: { memberId: string; contentHash: string }): Promise<ActionResult>
// deleteObject + setCastPhotos
export async function describeCastMemberAction(memberId: string): Promise<ActionResult>
// loads photo bytes via getObjectBytes (mock: skips bytes and uses mockCastIdentity), callLlm(buildCastIdentityRequest), updateCastMember
```

All actions `revalidatePath('/projects/' + projectId)`.

- [ ] **Step 1: Failing tests** in mock mode against the test DB: add, update, remove; upload create refuses a fifth photo and a gif; finalise appends and fills the identity string from the mock; describe overwrites.
- [ ] **Step 2: Implement. Step 3: Commit** `feat: cast server actions and photo uploads (decision 253)`

---

### Task 8: The Cast card

**Files:**
- Create: `apps/web/app/(console)/projects/[id]/cast-card.tsx`
- Modify: `apps/web/app/(console)/projects/[id]/page.tsx` (mount above stage screens from the script stage onward; load `listCastMembers`)
- Test: `apps/web/app/(console)/projects/[id]/cast-card.test.tsx`

**Interfaces (consumes):** the actions from Task 7; `CastMember` from Task 2.

Layout: a `Card` titled "Cast", subtitle "The real people this film shows. Their photos go to the image model as references; they are not placed in the video." Collapsed state shows one avatar per member (first photo or initials) and an "Edit cast" button. Expanded: per member a row with name and role inputs, four photo tiles (image or "Add photo" button opening a hidden file input; a `select` for the view label beside the empty tile), identity string and guardrail text areas with a "Save" button, "Describe from photos · ≈$0.02", "Remove person" with confirm. "Add person" form at the bottom. Guidance text under the tiles as the spec words it. The upload flow reuses the client-side pattern from `UploadOwnButton` (hash the file, create, PUT, read dimensions with an `Image`, finalise).

- [ ] **Step 1: Failing component tests**: renders members and tiles; "Add person" calls the action; picking a file calls create then finalise with width and height; "Describe from photos" calls describe; "Remove person" asks for confirmation; every button has a hit target of 40 px or more (`expectHitTargets`).
- [ ] **Step 2: Implement. Step 3: Mount in `page.tsx`. Step 4: Run web tests. Step 5: Commit** `feat: the Cast card on the project page (decision 253)`

---

### Task 9: References on the Gemini image adapter

**Files:**
- Modify: `packages/providers/src/visuals/types.ts` (`ImageGenRequest.references?`)
- Modify: `packages/providers/src/visuals/gemini.ts`
- Test: `packages/providers/src/visuals/gemini.test.ts`

**Interfaces (produces):**

```ts
export interface ImageReference { name: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; data: string /* base64 */ }
export interface ImageGenRequest { prompt: string; negativePrompt?: string; count: number; model?: string; references?: ImageReference[] }
export const GEMINI_MAX_REFERENCES = 3
```

Gemini body: `contents: [{ parts: [...references.map(r => ({ inlineData: { mimeType: r.mimeType, data: r.data } })), { text: prompt }] }]`. More than three references throws `ValidationError` before the fetch.

- [ ] **Step 1: Failing tests**: reference parts precede the text part; four references refuse without fetching; no references leaves the body as today.
- [ ] **Step 2: Implement. Step 3: Commit** `feat: Gemini stills take reference photos (decision 253)`

---

### Task 10: References on the fal adapter

**Files:**
- Modify: `packages/providers/src/visuals/fal.ts`
- Test: `packages/providers/src/visuals/fal.test.ts`

**Interfaces (produces):**

```ts
export const FAL_REFERENCE_MODELS = { single: 'fal-ai/flux-pro/kontext', multi: 'fal-ai/flux-pro/kontext/max/multi' } as const
// ImageGenRequest.references on fal need URLs, not bytes: the caller passes `referenceUrls?: string[]` (presigned R2 GETs) alongside `references`.
```

Behaviour: with `referenceUrls`, the endpoint is the single or multi Kontext model regardless of the routed FLUX model; body `{ prompt, image_url }` or `{ prompt, image_urls }`, `num_images`, `aspect_ratio: '16:9'`; the registry lists both with `pricePerImage` (0.04 single, 0.08 multi, to confirm live). Without references the adapter is unchanged.

- [ ] **Step 0: Live catalogue check.** Before listing the ids, run the existing fal model-check pattern (the adapter file documents it) with the producer's key against `fal-ai/flux-pro/kontext` and `fal-ai/flux-pro/kontext/max/multi`; if either 404s, stop and report; do not guess a replacement.
- [ ] **Step 1: Failing tests**: one URL switches to the single endpoint with `image_url`; two URLs switch to the multi endpoint with `image_urls`; no references keeps today's body.
- [ ] **Step 2: Implement. Step 3: Commit** `feat: fal stills route to FLUX Kontext when references are present (decision 253)`

---

### Task 11: Generation attaches the cast

**Files:**
- Modify: `apps/web/lib/visual-assets.ts` (`generateStillCandidates`)
- Test: `apps/web/lib/visual-assets.test.ts`

**Interfaces (consumes):** `castMembersNamed`, `referencePhotos`, `getObjectBytes`, `presignGet`, `ImageGenRequest.references`.

Behaviour, in order: if `brief.depicts` is empty, unchanged. Else load `castMembersNamed(db, projectId, depicts)`; for each member with photos take `referencePhotos(member, 1)`; cap at three people (drop the rest, log a run event "reference cap"). Google route: read bytes with `getObjectBytes`, pass `references`. fal route: `presignGet` each key, pass `referenceUrls` and `references` (names only used for the prompt). If the prompt does not already contain "the person in the reference photo", prepend `"<name>, the person in the reference photo. "` per member. Mock storage or a member without photos: generate text-only, as today. Record `references: [names]` in the candidate summary so the board can show "reference: Emad Mostaque".

- [ ] **Step 1: Failing tests** with the mock image adapter recording requests: a depicted cast member with a photo yields one reference; two members yield two; a depicted name not in the cast yields none; the prompt gains the clause once.
- [ ] **Step 2: Implement. Step 3: Commit** `feat: stills of cast members carry their reference photos (decision 253)`

---

### Task 12: The Director's Book knows the cast

**Files:**
- Modify: `packages/providers/src/prompts/direction.ts` (`cast` input, parser `castNames`)
- Modify: `apps/web/inngest/lib/direction.ts` (`loadDirectionInputs` loads the cast; `draftDirectorsBook` passes it)
- Modify: `packages/schemas/src/direction.ts` (`planWarnings` gains a cast check, or a new `castWarnings(book, castNames)`)
- Modify: `apps/web/lib/visuals-review.ts` (surface the warning)
- Test: `direction.test.ts` (providers), `apps/web/inngest/lib/direction.test.ts`, `packages/schemas/src/direction.test.ts`

**Interfaces (produces):**

```ts
buildDirectorsBookRequest({ ..., cast?: { name: string; role: string; identityString: string }[] })
parseDirectorsBook(text, chapterCount, options?: { castNames?: readonly string[] }): DirectorsBook   // never throws for a missing cast member
export function castWarnings(book: DirectorsBook, castNames: readonly string[]): string[]
// 'The book has no principal for <name>; redraft or add them by hand.'
```

Prompt text: "Cast, already photographed:" list; rule "one principal per cast member, exact name, depiction 'likeness', identity string copied verbatim".

- [ ] **Step 1: Failing tests**: the prompt lists the cast; a book missing a cast member parses and `castWarnings` names them; `loadDirectionInputs` returns the cast from the test DB.
- [ ] **Step 2: Implement. Step 3: Commit** `feat: the Director's Book is drafted from the cast (decision 253)`

---

### Task 13: Board shows the reference, e2e, docs

**Files:**
- Modify: `apps/web/app/(console)/projects/[id]/visual-board.tsx` (still card line "reference: <names>" when the chosen candidate recorded references)
- Modify: `e2e/tests/visual-plan.spec.ts` or create `e2e/tests/cast.spec.ts`
- Modify: `docs/03-build-spec.md` §7.4 (dated note), `PROGRESS.md` (decision 253)

- [ ] **Step 1: e2e**: add a cast member, upload `e2e/fixtures/face.png` in mock storage, see the tile and a `[mock]` identity string; run the plan and see the card.
- [ ] **Step 2: Board line and its component test.**
- [ ] **Step 3: Docs**: §7.4 note "Cast references (decision 253, 2026-09-15)"; PROGRESS decision 253 with the why (text-only prompts cannot reproduce a face) and the fal live-check result.
- [ ] **Step 4: Full verification**: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`.
- [ ] **Step 5: Commit** `docs: decision 253, cast references`

---

## Deploy notes

- Migration 0022 applies on the production build from master.
- Redeploy nothing in AWS; the Lambdas are untouched.
- After the deploy, `curl -X PUT https://boom-busters-web-rho.vercel.app/api/inngest`.
- First real use: add the Stability AI cast, upload one front photo each, press "Redraft direction", then re-plan; compare the first still of Emad Mostaque with and without the reference.
