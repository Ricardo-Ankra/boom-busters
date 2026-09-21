# Logo Library Implementation Plan (decision 268, Plan A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A channel-wide library of uploaded logo marks (Settings, Logos tab) stored as `assets` rows of kind `logo`, with the chosen mark rendered as the film's corner watermark.

**Architecture:** Logos are `assets` rows (`kind: 'logo'`, `title` = entity name), content-hash keyed under `boom-busters/logos/`. Uploads go browser to R2 on the presigned path the music library uses; a pasted address is fetched server-side. SVG and AVIF are rasterised to PNG at the door (browser canvas for a picked file, sharp for a pasted one) so stored bytes are always PNG, WebP or JPEG. `brand.look.logoR2Key` picks the channel mark; the two materialisers resolve it to `brand.look.logoUrl` and `Watermark` draws it, falling back to the typographic wordmark. A pure `logoForEntity` matcher is exported for Plan B's resolver.

**Tech Stack:** Next.js App Router server actions (`'use server'` files export only async functions), Drizzle on Postgres, Zod 4, R2 via the S3 SDK, sharp 0.35 (already a dependency of apps/web), Remotion 4.0.512, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-21-motion-graphics-design.md`, sections 6.1 to 6.3, 6.5 and 3.3a. Section 6.2 was amended while this plan was written: SVG is rasterised, not sanitised.

## Global Constraints

- No em dash (U+2014) or en dash (U+2013) on any added line, in code, comments, tests or docs. Write "2022 to 2025" for ranges. South African English (colour, licence, organise).
- `'use server'` modules export only async functions. A constant exported from one 500s every action in the segment.
- Button-first UI: every action is a visible labelled button; no drag-and-drop-only paths; dark theme tokens via `var(--color-...)`.
- Nothing calls a paid API. Mock providers stay mocked; tests mock `@/lib/storage` and `@/lib/remote-image` where a server action would otherwise touch R2 or the network.
- Uploads never travel through a server action (Vercel 413s bodies over about 4.5 MB): browser hashes, asks for a presigned PUT, PUTs, then finalises.
- Every task: `pnpm typecheck`, `pnpm lint`, `pnpm format:check` clean before its commit; run tests in the FOREGROUND only (a backgrounded command never reports back to a subagent).
- Run database suites one at a time; two vitest runs against the shared test database block each other on row locks.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Test database needs Docker Desktop running (`pnpm db:migrate:test` if a schema test complains).

---

## File structure

| File | Responsibility |
| --- | --- |
| `packages/schemas/src/logos.ts` (create) | Stored logo MIME union, extension map, caps, the `accept` string, `LogoIndex` and the pure `logoForEntity` matcher. |
| `packages/schemas/src/settings.ts` (modify) | `BrandKitTokensSchema.look` gains optional `logoUrl` (resolved form only). |
| `packages/db/src/logos.ts` (create) | Library queries over `assets`: list, insert (upsert on hash), rename, remove, find by name, by key. |
| `apps/web/lib/storage.ts` (modify) | `logoKey`. |
| `apps/web/lib/client-image.ts` (modify) | `toUploadableLogo`: SVG and AVIF to PNG in the browser. |
| `apps/web/lib/remote-image.ts` (modify) | `fetchRemoteLogo`: pasted address to stored bytes, SVG and AVIF rasterised with sharp. |
| `apps/web/app/(console)/settings/logo-actions.ts` (create) | Presign, finalise, add by address, rename, remove, set channel mark. |
| `apps/web/app/(console)/settings/logos-tab.tsx` (create) | The Logos tab. |
| `apps/web/app/(console)/settings/settings-form.tsx`, `page.tsx` (modify) | Mount the tab, pass rows and preview URLs. |
| `apps/web/lib/materialise.ts`, `infra/lambdas/broker/core.ts` (modify) | Resolve `look.logoR2Key` to `look.logoUrl`. |
| `packages/compositions/src/components/Watermark.tsx` (create), `DocumentaryMaster.tsx`, `Root.tsx`, `snapshot/render.test.ts` (modify) | The watermark as its own component, drawing the mark; fixture and golden. |
| `e2e/global-setup.ts` (modify), `e2e/tests/settings-logos.spec.ts` (create) | Seeded marks and the tab round trip. |
| `PROGRESS.md`, `docs/03-build-spec.md` (modify) | Decision 268 (Plan A) recorded. |

---

### Task 1: Logo schema constants and the entity matcher

**Files:**
- Create: `packages/schemas/src/logos.ts`
- Create: `packages/schemas/src/logos.test.ts`
- Modify: `packages/schemas/src/index.ts` (add `export * from './logos'` beside `./sets`)
- Modify: `packages/schemas/src/settings.ts:366-369`
- Modify: `packages/schemas/src/settings.test.ts` (or the nearest settings test file; create `settings-brand.test.ts` if none exists)

**Interfaces:**
- Consumes: `nameMatches(entry, name)` from `./cast`.
- Produces: `LOGO_STORED_MIME`, `LogoStoredMimeSchema`, `LogoStoredMime`, `logoExtension(mime): 'png' | 'webp' | 'jpg'`, `LOGO_MAX_BYTES = 4 * 1024 * 1024`, `LOGO_RASTER_MAX_EDGE = 2048`, `LOGO_ACCEPT` (string), `interface LogoIndex { id: string; title: string }`, `logoForEntity<T extends LogoIndex>(entity: string, logos: readonly T[]): T | null`. `BrandKitTokens['look']['logoUrl']?: string`.

- [ ] **Step 1: Write the failing tests**

`packages/schemas/src/logos.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  LOGO_ACCEPT,
  LOGO_MAX_BYTES,
  LogoStoredMimeSchema,
  logoExtension,
  logoForEntity,
} from './logos'

describe('logo formats', () => {
  it('stores only raster formats every renderer draws', () => {
    for (const mime of ['image/png', 'image/webp', 'image/jpeg']) {
      expect(LogoStoredMimeSchema.safeParse(mime).success).toBe(true)
    }
    // Accepted at the door, never stored: both are converted to PNG first.
    expect(LogoStoredMimeSchema.safeParse('image/svg+xml').success).toBe(false)
    expect(LogoStoredMimeSchema.safeParse('image/avif').success).toBe(false)
  })

  it('names the extension a stored mark takes', () => {
    expect(logoExtension('image/png')).toBe('png')
    expect(logoExtension('image/webp')).toBe('webp')
    expect(logoExtension('image/jpeg')).toBe('jpg')
  })

  it('offers the picker every format the door converts, by type and by extension', () => {
    for (const token of ['image/png', 'image/svg+xml', 'image/webp', 'image/avif', '.avif', '.svg']) {
      expect(LOGO_ACCEPT.split(',')).toContain(token)
    }
    expect(LOGO_MAX_BYTES).toBe(4 * 1024 * 1024)
  })
})

describe('logoForEntity', () => {
  const logos = [
    { id: 'a', title: 'Stability AI' },
    { id: 'b', title: 'Wirecard AG' },
  ]

  it('matches the exact name, whatever the case and spacing', () => {
    expect(logoForEntity('stability  ai', logos)?.id).toBe('a')
  })

  it('matches a name the planner wrote with a role after it', () => {
    expect(logoForEntity('Wirecard AG, the payments processor', logos)?.id).toBe('b')
  })

  it('refuses a name merely contained in a longer title', () => {
    expect(logoForEntity('AI', logos)).toBeNull()
    expect(logoForEntity('Wirecard', logos)).toBeNull()
  })

  it('returns null for an empty library', () => {
    expect(logoForEntity('Stability AI', [])).toBeNull()
  })
})
```

Add to the settings tests (create `packages/schemas/src/settings-brand.test.ts` if there is no settings test file):

```ts
import { describe, expect, it } from 'vitest'
import { BrandKitStoredSchema, BrandKitTokensSchema, DEFAULT_SETTINGS, resolveBrandKit } from './settings'

describe('the brand snapshot and the channel mark (decision 268)', () => {
  it('carries a materialised logo URL in the resolved form only', () => {
    const resolved = resolveBrandKit(DEFAULT_SETTINGS)
    const withUrl = BrandKitTokensSchema.parse({
      ...resolved,
      look: { ...resolved.look, logoR2Key: 'boom-busters/logos/abc.png', logoUrl: 'https://r2/abc' },
    })
    expect(withUrl.look.logoUrl).toBe('https://r2/abc')

    // The stored settings row never holds a URL: presigned URLs expire.
    const stored = BrandKitStoredSchema.parse({
      ...DEFAULT_SETTINGS.brandKit,
      look: { ...DEFAULT_SETTINGS.brandKit.look, logoUrl: 'https://r2/abc' },
    })
    expect('logoUrl' in stored.look).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `packages/schemas`): `npx vitest run src/logos.test.ts src/settings-brand.test.ts`
Expected: FAIL, `Cannot find module './logos'` and `logoUrl` missing from the resolved look.

- [ ] **Step 3: Write the module and the schema extension**

`packages/schemas/src/logos.ts`:

```ts
import { z } from 'zod'
import { nameMatches } from './cast'

/**
 * The logo library (decision 268): real marks the owner uploaded, composited
 * on the brand grade, never generated. Marks are `assets` rows of kind
 * `logo`, channel-wide, titled with the entity's name as the dossier writes
 * it, and matched by that name the way a still's "depicts" is matched to the
 * cast.
 *
 * Stored bytes are always raster. SVG and AVIF are accepted at the door and
 * converted to PNG before storage: the render's Chromium draws what is
 * stored, so a stored SVG would be a script the render executes, and no
 * image model or renderer needs vector marks at the sizes a film shows them.
 */

export const LOGO_STORED_MIME = ['image/png', 'image/webp', 'image/jpeg'] as const
export const LogoStoredMimeSchema = z.enum(LOGO_STORED_MIME)
export type LogoStoredMime = z.infer<typeof LogoStoredMimeSchema>

/** The extension a stored mark takes from its MIME type. */
export function logoExtension(mimeType: LogoStoredMime): 'png' | 'webp' | 'jpg' {
  return mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg'
}

/** Marks are small; a 4 MB PNG is already a poster. */
export const LOGO_MAX_BYTES = 4 * 1024 * 1024

/** A vector mark is rasterised at this long edge: crisp at 1080p, small on disk. */
export const LOGO_RASTER_MAX_EDGE = 2048

/** What the file picker offers, by type and by extension for browsers that report neither. */
export const LOGO_ACCEPT =
  'image/png,image/webp,image/jpeg,image/svg+xml,image/avif,.png,.webp,.jpg,.jpeg,.svg,.avif'

/** What a resolver needs to know about a mark: its id and the name it answers to. */
export interface LogoIndex {
  id: string
  title: string
}

/**
 * The mark an entity name refers to, or null. The join between a graphic's
 * "logo" element and the library (Plan B), through the cast's tolerant
 * matcher: the exact title, or the title followed by a role, never a title
 * merely contained in a longer name.
 */
export function logoForEntity<T extends LogoIndex>(entity: string, logos: readonly T[]): T | null {
  return logos.find((logo) => nameMatches(entity, logo.title)) ?? null
}
```

In `packages/schemas/src/settings.ts`, replace lines 365 to 369 with:

```ts
/**
 * Resolved form: what a timeline snapshots at compile time (section 8.2).
 * `look.logoUrl` exists ONLY here, written by the materialisers from
 * `logoR2Key` (decision 268): the canonical timeline and the settings row
 * carry the key alone, because a presigned URL expires.
 */
export const BrandKitTokensSchema = BrandKitStoredSchema.extend({
  voice: VoiceConfigSchema,
  look: BrandLookSchema.extend({ logoUrl: z.string().min(1).optional() }),
})
export type BrandKitTokens = z.infer<typeof BrandKitTokensSchema>
```

Add `export * from './logos'` to `packages/schemas/src/index.ts` after the `./sets` line.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/logos.test.ts src/settings-brand.test.ts`
Expected: PASS (8 tests). Then from the repo root: `pnpm typecheck` (the `look` extension must not break `resolveBrandKit`, which returns the stored look without a URL; that is assignable because `logoUrl` is optional).

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/logos.ts packages/schemas/src/logos.test.ts packages/schemas/src/index.ts packages/schemas/src/settings.ts packages/schemas/src/settings-brand.test.ts
git commit -m "feat(schemas): logo formats, the entity matcher, and a materialised channel mark URL (decision 268)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The library's database queries

**Files:**
- Create: `packages/db/src/logos.ts`
- Create: `packages/db/src/logos.integration.test.ts`
- Modify: `packages/db/src/index.ts` (add `export * from './logos'` beside `./sets`)

**Interfaces:**
- Consumes: `assets` table and `AssetRow` from `./schema`; `logoForEntity` from `@boom-busters/schemas`.
- Produces:
  - `listLogos(db): Promise<AssetRow[]>` (title ascending, then createdAt)
  - `insertLogo(db, { r2Key, contentHash, title, width, height, sourceUrl? }): Promise<AssetRow>` (upsert on `contentHash`; title, width, height, sourceUrl win)
  - `renameLogo(db, id, title): Promise<AssetRow | undefined>`
  - `removeLogo(db, id): Promise<AssetRow | undefined>` (returns the row so the caller deletes the object)
  - `findLogoByName(db, name): Promise<AssetRow | null>`
  - `logoByR2Key(db, r2Key): Promise<AssetRow | undefined>`

- [ ] **Step 1: Write the failing test**

`packages/db/src/logos.integration.test.ts`:

```ts
import { sql as dsql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb } from './client'
import {
  findLogoByName,
  insertLogo,
  listLogos,
  logoByR2Key,
  removeLogo,
  renameLogo,
} from './logos'
import { assets } from './schema'
import { requireTestDatabase } from './test-database'

/**
 * The logo library against a real database (decision 268). Marks are
 * `assets` rows of kind `logo`; the dedupe on re-upload and the name join
 * are the parts worth proving.
 */

const url = requireTestDatabase()
const suite = url ? describe : describe.skip

const STABILITY = {
  r2Key: 'boom-busters/logos/aaa.png',
  contentHash: 'logo-aaa',
  title: 'Stability AI',
  width: 1200,
  height: 400,
}

suite('the logo library', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })

  beforeEach(async () => {
    await db.execute(dsql`truncate table ${assets} restart identity cascade`)
  })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  it('stores a mark as a logo asset and lists marks by name', async () => {
    await insertLogo(db, { ...STABILITY, title: 'Wirecard AG', contentHash: 'logo-bbb', r2Key: 'boom-busters/logos/bbb.png' })
    await insertLogo(db, STABILITY)

    const logos = await listLogos(db)
    expect(logos.map((logo) => logo.title)).toEqual(['Stability AI', 'Wirecard AG'])
    expect(logos[0]).toMatchObject({ kind: 'logo', licence: 'Uploaded by owner', width: 1200, height: 400 })
  })

  it('treats a re-upload of the same bytes as a rename, not a duplicate', async () => {
    const first = await insertLogo(db, STABILITY)
    const second = await insertLogo(db, { ...STABILITY, title: 'Stability AI Ltd', sourceUrl: 'https://x.example/logo.png' })

    expect(second.id).toBe(first.id)
    expect(second.title).toBe('Stability AI Ltd')
    expect(second.sourceUrl).toBe('https://x.example/logo.png')
    expect(await listLogos(db)).toHaveLength(1)
  })

  it('renames and removes, returning the row so the bytes can follow', async () => {
    const row = await insertLogo(db, STABILITY)
    expect((await renameLogo(db, row.id, '  Stability  '))?.title).toBe('Stability')

    const removed = await removeLogo(db, row.id)
    expect(removed?.r2Key).toBe(STABILITY.r2Key)
    expect(await listLogos(db)).toEqual([])
    expect(await removeLogo(db, row.id)).toBeUndefined()
  })

  it('finds a mark by the name the planner wrote, tolerantly, and by its key', async () => {
    const row = await insertLogo(db, STABILITY)
    expect((await findLogoByName(db, 'stability ai, the image company'))?.id).toBe(row.id)
    expect(await findLogoByName(db, 'AI')).toBeNull()
    expect((await logoByR2Key(db, STABILITY.r2Key))?.id).toBe(row.id)
  })

  it('never lists a music bed as a logo', async () => {
    await db.insert(assets).values({
      kind: 'music', r2Key: 'boom-busters/music/x.mp3', contentHash: 'music-x',
      licence: 'yt-audio-library', title: 'A bed',
    })
    expect(await listLogos(db)).toEqual([])
    expect(await findLogoByName(db, 'A bed')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `packages/db`, Docker Desktop running): `npx vitest run src/logos.integration.test.ts`
Expected: FAIL, `Cannot find module './logos'`.

- [ ] **Step 3: Write the queries**

`packages/db/src/logos.ts`:

```ts
import { and, asc, eq } from 'drizzle-orm'
import { logoForEntity } from '@boom-busters/schemas'
import type { Database } from './client'
import { assets } from './schema'
import type { AssetRow } from './schema'

/**
 * The logo library's queries (decision 268). Marks are `assets` rows of kind
 * `logo`, deduped by content hash like every other asset: uploading the same
 * file twice refreshes its name rather than storing it twice. The library is
 * channel-wide by design; a bank that appears in three films is uploaded once.
 */

const LOGO_LICENCE = 'Uploaded by owner'

/** Every mark, by name: the tab is a directory, not a feed. */
export async function listLogos(db: Database): Promise<AssetRow[]> {
  return db
    .select()
    .from(assets)
    .where(eq(assets.kind, 'logo'))
    .orderBy(asc(assets.title), asc(assets.createdAt))
}

export async function insertLogo(
  db: Database,
  input: {
    r2Key: string
    contentHash: string
    /** The entity's name as the dossier writes it: the join key. */
    title: string
    width: number
    height: number
    /** Where the owner found it, when pasted from an address. Provenance only. */
    sourceUrl?: string | null
  },
): Promise<AssetRow> {
  const title = input.title.trim()
  const [row] = await db
    .insert(assets)
    .values({
      kind: 'logo',
      r2Key: input.r2Key,
      contentHash: input.contentHash,
      title,
      licence: LOGO_LICENCE,
      width: input.width,
      height: input.height,
      sourceUrl: input.sourceUrl ?? null,
    })
    .onConflictDoUpdate({
      target: assets.contentHash,
      // The bytes already exist under their hash key; a re-upload is the
      // owner renaming the mark, so the name wins. The key stays.
      set: {
        title,
        width: input.width,
        height: input.height,
        sourceUrl: input.sourceUrl ?? null,
        updatedAt: new Date(),
      },
    })
    .returning()

  if (!row) throw new Error('The logo could not be stored')
  return row
}

export async function renameLogo(
  db: Database,
  id: string,
  title: string,
): Promise<AssetRow | undefined> {
  const [row] = await db
    .update(assets)
    .set({ title: title.trim(), updatedAt: new Date() })
    .where(and(eq(assets.id, id), eq(assets.kind, 'logo')))
    .returning()
  return row
}

/**
 * Remove a mark. Returns the row so the caller can delete the object: the
 * database is authoritative and goes first. Whether the mark is the channel
 * mark is the caller's check, since that lives in settings.
 */
export async function removeLogo(db: Database, id: string): Promise<AssetRow | undefined> {
  const [row] = await db
    .delete(assets)
    .where(and(eq(assets.id, id), eq(assets.kind, 'logo')))
    .returning()
  return row
}

/** The mark an entity name refers to, through the same matcher Plan B's resolver uses. */
export async function findLogoByName(db: Database, name: string): Promise<AssetRow | null> {
  const logos = await listLogos(db)
  return logoForEntity(
    name,
    logos.map((logo) => ({ ...logo, title: logo.title ?? '' })),
  )
}

export async function logoByR2Key(db: Database, r2Key: string): Promise<AssetRow | undefined> {
  const [row] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.kind, 'logo'), eq(assets.r2Key, r2Key)))
    .limit(1)
  return row
}
```

Add `export * from './logos'` to `packages/db/src/index.ts` after the `./sets` line.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/logos.integration.test.ts`
Expected: PASS (5 tests). Then `pnpm typecheck` from the root.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/logos.ts packages/db/src/logos.integration.test.ts packages/db/src/index.ts
git commit -m "feat(db): the logo library over assets, deduped by hash and joined by name (decision 268)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: A picked SVG or AVIF becomes a PNG in the browser

**Files:**
- Modify: `apps/web/lib/client-image.ts`
- Modify: `apps/web/lib/client-image.test.ts`
- Modify: `apps/web/lib/storage.ts:186-197` (add `logoKey` beside `musicKey`)

**Interfaces:**
- Consumes: `toUploadableImage`, `fittedSize`, `ImageCodec`, `DecodedImage`, `browserCodec` (existing, same file); `LOGO_RASTER_MAX_EDGE` from `@boom-busters/schemas`.
- Produces:
  - `type SvgRasteriser = (file: File, maxEdge: number) => Promise<{ blob: Blob; width: number; height: number } | null>`
  - `browserSvgRasteriser: SvgRasteriser`
  - `toUploadableLogo<T extends DecodedImage>(file: File, options?: { codec?: ImageCodec<T>; rasterise?: SvgRasteriser }): Promise<UploadableImage>`
  - `logoKey({ contentHash, ext }): string` in storage.ts, `boom-busters/logos/<hash>.<ext>`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/lib/client-image.test.ts`:

```ts
import { toUploadableLogo, type SvgRasteriser } from './client-image'

describe('toUploadableLogo', () => {
  const rasterise: SvgRasteriser = async (_file, maxEdge) => ({
    blob: new Blob([new Uint8Array(16)], { type: 'image/png' }),
    width: maxEdge,
    height: Math.round(maxEdge / 3),
  })

  it('hands back a PNG, WebP or JPEG mark unchanged', async () => {
    for (const type of ['image/png', 'image/webp', 'image/jpeg']) {
      const original = file('mark', type)
      const result = await toUploadableLogo(original, { rasterise })
      expect(result.ok && result.file).toBe(original)
    }
  })

  it('rasterises an SVG to a PNG at the logo edge, renamed to match', async () => {
    const result = await toUploadableLogo(file('stability.svg', 'image/svg+xml'), { rasterise })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.file.type).toBe('image/png')
    expect(result.file.name).toBe('stability.png')
  })

  it('treats a file the browser will not type, with an .svg name, as an SVG', async () => {
    const result = await toUploadableLogo(file('mark.svg', ''), { rasterise })
    expect(result.ok && result.file.type).toBe('image/png')
  })

  it('converts an AVIF mark to PNG, never JPEG, so transparency survives', async () => {
    const codec = codecFor(800, 300)
    const result = await toUploadableLogo(file('mark.avif', 'image/avif'), { codec, rasterise })
    expect(result.ok && result.file.type).toBe('image/png')
    expect(codec.encode).toHaveBeenCalledWith(expect.anything(), 800, 300, 'image/png', expect.any(Number))
  })

  it('says what to do when the SVG will not draw', async () => {
    const result = await toUploadableLogo(file('broken.svg', 'image/svg+xml'), {
      rasterise: async () => null,
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toMatch(/could not draw that SVG/i)
  })
})
```

Add to `apps/web/lib/storage.test.ts` if one exists (otherwise skip; `logoKey` is one line and the actions test covers it):

```ts
expect(logoKey({ contentHash: 'abc', ext: 'png' })).toBe('boom-busters/logos/abc.png')
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `apps/web`): `npx vitest run lib/client-image.test.ts`
Expected: FAIL, `toUploadableLogo` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `apps/web/lib/client-image.ts`:

```ts
import { LOGO_RASTER_MAX_EDGE } from '@boom-busters/schemas'

/**
 * Draw an SVG to a bitmap at `maxEdge` on its long side, or null when the
 * browser will not render it. Behind a type so a test can stand in for it:
 * jsdom has neither an image decoder nor a canvas encoder.
 */
export type SvgRasteriser = (
  file: File,
  maxEdge: number,
) => Promise<{ blob: Blob; width: number; height: number } | null>

export const browserSvgRasteriser: SvgRasteriser = async (file, maxEdge) => {
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('svg did not load'))
      element.src = url
    })
    // A vector mark upscales losslessly, so it is drawn AT the long edge, not
    // capped by it. An SVG with no intrinsic size reports the browser's
    // 300 by 150 default; its shape is still the file's own.
    const sourceWidth = image.naturalWidth || 300
    const sourceHeight = image.naturalHeight || 150
    const scale = maxEdge / Math.max(sourceWidth, sourceHeight)
    const width = Math.max(1, Math.round(sourceWidth * scale))
    const height = Math.max(1, Math.round(sourceHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(image, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    return blob ? { blob, width, height } : null
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

function isSvg(file: File): boolean {
  return file.type === 'image/svg+xml' || (file.type === '' && /\.svg$/i.test(file.name))
}

/**
 * The file to upload as a logo (decision 268). A raster mark passes through;
 * an SVG is drawn to a PNG at the logo edge; an AVIF is converted to PNG, not
 * JPEG, because a mark's transparency is the point of it.
 */
export async function toUploadableLogo<T extends DecodedImage>(
  file: File,
  options: { codec?: ImageCodec<T>; rasterise?: SvgRasteriser } = {},
): Promise<UploadableImage> {
  if (isSvg(file)) {
    const drawn = await (options.rasterise ?? browserSvgRasteriser)(file, LOGO_RASTER_MAX_EDGE)
    if (!drawn) {
      return {
        ok: false,
        error:
          'This browser could not draw that SVG. Export it as a PNG with a transparent ' +
          'background and add that instead.',
      }
    }
    return { ok: true, file: new File([drawn.blob], renamed(file.name, 'image/png'), { type: 'image/png' }) }
  }
  return toUploadableImage(file, { ...(options.codec ? { codec: options.codec } : {}), format: 'image/png' })
}
```

Move the `import { LOGO_RASTER_MAX_EDGE } ...` line to the top of the file with the other imports (the file starts with `'use client'`; imports follow it). `renamed` already exists in the file.

In `apps/web/lib/storage.ts`, after `musicKey`:

```ts
/**
 * Where a logo mark lives (decision 268). Content-hash keyed and channel-wide
 * like music: the same mark uploaded for two films is one object, owned by
 * neither.
 */
export function logoKey(input: { contentHash: string; ext: 'png' | 'webp' | 'jpg' }): string {
  return `${R2_PREFIX}/logos/${input.contentHash}.${input.ext}`
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/client-image.test.ts`
Expected: PASS (16 tests). `pnpm typecheck` from the root.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/client-image.ts apps/web/lib/client-image.test.ts apps/web/lib/storage.ts
git commit -m "feat(uploads): a picked SVG or AVIF mark becomes a PNG in the browser, and marks have a key (decision 268)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: A pasted address becomes a stored mark on the server

**Files:**
- Modify: `apps/web/lib/remote-image.ts`
- Modify: `apps/web/lib/remote-image.test.ts`

**Interfaces:**
- Consumes: the file's internal `checkAddress`, `readCapped`, `sniffImageMime`, `convertToJpeg` (rename its resize step into a shared helper as below); `LOGO_MAX_BYTES`, `LOGO_RASTER_MAX_EDGE` from `@boom-busters/schemas`.
- Produces:
  - `interface RemoteLogo { bytes: Buffer; mimeType: LogoStoredMime; width: number; height: number; resolvedUrl: string }`
  - `type RemoteLogoResult = { ok: true; logo: RemoteLogo } | { ok: false; error: string }`
  - `fetchRemoteLogo(rawUrl: string, options?: { fetchImpl?: typeof fetch }): Promise<RemoteLogoResult>`
  - `isSvgText(bytes: Buffer): boolean` (exported for the test)

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/lib/remote-image.test.ts` (the file already imports sharp lazily in `avif()`):

```ts
import { fetchRemoteLogo, isSvgText } from './remote-image'

const SVG = Buffer.from(
  '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="300" height="100">' +
    '<rect width="300" height="100" rx="20" fill="#1e40af"/></svg>',
)

describe('fetchRemoteLogo', () => {
  it('recognises SVG text with or without the XML prologue, and not HTML', () => {
    expect(isSvgText(SVG)).toBe(true)
    expect(isSvgText(Buffer.from('﻿  <svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(true)
    expect(isSvgText(Buffer.from('<!doctype html><html><svg></svg></html>'))).toBe(false)
  })

  it('rasterises a pasted SVG to a PNG with transparency at the logo edge', async () => {
    const fetchImpl = vi.fn(async () => respond(SVG, { headers: { 'content-type': 'image/svg+xml' } }))
    const result = await fetchRemoteLogo('https://example.com/mark.svg', { fetchImpl })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.logo.mimeType).toBe('image/png')
    expect(result.logo).toMatchObject({ width: 2048, height: 683 })
    const { default: sharp } = await import('sharp')
    const meta = await sharp(result.logo.bytes).metadata()
    expect(meta.format).toBe('png')
    expect(meta.hasAlpha).toBe(true)
  })

  it('converts a pasted AVIF mark to PNG, keeping its size, and passes a PNG through', async () => {
    const avifBytes = await avif(640, 200)
    const result = await fetchRemoteLogo('https://example.com/mark.avif', {
      fetchImpl: vi.fn(async () => respond(avifBytes)),
    })
    expect(result.ok && result.logo.mimeType).toBe('image/png')
    expect(result.ok && result.logo.width).toBe(640)

    const pngBytes = png(400, 120)
    const passed = await fetchRemoteLogo('https://example.com/mark.png', {
      fetchImpl: vi.fn(async () => respond(pngBytes)),
    })
    expect(passed.ok && passed.logo.mimeType).toBe('image/png')
    expect(passed.ok && passed.logo.bytes.equals(pngBytes)).toBe(true)
  })

  it('has no thumbnail floor, since a small mark is a mark, but keeps the 4 MB cap', async () => {
    const small = await fetchRemoteLogo('https://example.com/tiny.png', {
      fetchImpl: vi.fn(async () => respond(png(64, 64))),
    })
    expect(small.ok).toBe(true)

    const big = await fetchRemoteLogo('https://example.com/huge.png', {
      fetchImpl: vi.fn(async () => respond(png(900, 900), { headers: { 'content-length': String(5 * 1024 * 1024) } })),
    })
    expect(big.ok).toBe(false)
    expect(big.ok === false && big.error).toMatch(/4 MB/)
  })

  it('refuses a page address in words that mention SVG', async () => {
    const result = await fetchRemoteLogo('https://example.com/about', {
      fetchImpl: vi.fn(async () => respond(Buffer.from('<!doctype html><html></html>'))),
    })
    expect(result.ok === false && result.error).toMatch(/PNG, SVG, WebP, JPEG or AVIF/)
  })

  it('refuses an SVG that will not render', async () => {
    const result = await fetchRemoteLogo('https://example.com/bad.svg', {
      fetchImpl: vi.fn(async () => respond(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect'))),
    })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toMatch(/could not be drawn/i)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/remote-image.test.ts`
Expected: FAIL, `fetchRemoteLogo` and `isSvgText` are not exported.

- [ ] **Step 3: Refactor the fetch into a shared step, then add the logo path**

In `apps/web/lib/remote-image.ts`:

1. Extract the address, redirect, status and size handling from `fetchRemoteImage` into an internal function so both callers share it. The body from `let url: URL` down to and including the `if (fetched.length === 0)` line becomes:

```ts
type FetchedBytes = { ok: true; bytes: Buffer; resolvedUrl: string } | { ok: false; error: string }

/** The address checks, the redirect walk, the status handling and the capped read. */
async function fetchImageBytes(
  rawUrl: string,
  fetchImpl: typeof fetch,
  maxBytes: number,
): Promise<FetchedBytes> {
  let url: URL
  try {
    url = new URL(rawUrl.trim())
  } catch {
    return { ok: false, error: 'That is not a web address. Copy the image address and paste it.' }
  }
  // ... the existing redirect loop, `!response.ok` branch, `readCapped` and
  // empty-file check, verbatim, returning { ok: false, error } where they did
  // and finally:
  return { ok: true, bytes: fetched, resolvedUrl: url.toString() }
}
```

and `fetchRemoteImage` calls it: `const got = await fetchImageBytes(rawUrl, fetchImpl, maxBytes); if (!got.ok) return got; const fetched = got.bytes;` and uses `got.resolvedUrl` where it used `url.toString()`. Run the existing tests after this step alone; they must still pass (the refactor changes no behaviour).

2. Add the SVG sniff and the logo fetch:

```ts
import { LOGO_MAX_BYTES, LOGO_RASTER_MAX_EDGE } from '@boom-busters/schemas'
import type { LogoStoredMime } from '@boom-busters/schemas'

/**
 * SVG is text, so it has no magic bytes: the file starts, after an optional
 * BOM, whitespace and an XML prologue, with an `<svg` tag. An HTML page that
 * happens to contain an SVG starts with a doctype or `<html`, and is refused.
 */
export function isSvgText(bytes: Buffer): boolean {
  const head = bytes.subarray(0, 512).toString('utf8').replace(/^﻿/, '').trimStart()
  const afterPrologue = head.startsWith('<?xml') ? head.slice(head.indexOf('?>') + 2).trimStart() : head
  const afterComments = afterPrologue.replace(/^(<!--[\s\S]*?-->\s*)*/, '')
  return /^<svg[\s>]/i.test(afterComments)
}

export interface RemoteLogo {
  bytes: Buffer
  mimeType: LogoStoredMime
  width: number
  height: number
  resolvedUrl: string
}

export type RemoteLogoResult = { ok: true; logo: RemoteLogo } | { ok: false; error: string }

/**
 * Rasterise a vector or AVIF mark to PNG at the logo edge (decision 268).
 * PNG rather than JPEG because a mark's transparency is the point of it; a
 * vector is drawn AT the edge since upscaling it loses nothing. Null when the
 * file cannot be rendered.
 */
async function rasteriseLogo(
  bytes: Buffer,
  vector: boolean,
): Promise<{ bytes: Buffer; width: number; height: number } | null> {
  try {
    const { default: sharp } = await import('sharp')
    // A high density makes librsvg render the vector at a size the resize
    // then brings down, so edges are anti-aliased at the final size.
    const image = vector ? sharp(bytes, { density: 384 }) : sharp(bytes).rotate()
    const { data, info } = await image
      .resize({
        width: LOGO_RASTER_MAX_EDGE,
        height: LOGO_RASTER_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: !vector,
      })
      .png()
      .toBuffer({ resolveWithObject: true })
    return { bytes: data, width: info.width, height: info.height }
  } catch {
    return null
  }
}

/**
 * Fetch a logo the owner linked to. Marks differ from photographs in three
 * ways: SVG is accepted (and drawn to PNG), AVIF becomes PNG rather than
 * JPEG, and there is no thumbnail floor, because a 64 px favicon-sized mark
 * is still the mark.
 */
export async function fetchRemoteLogo(
  rawUrl: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<RemoteLogoResult> {
  const got = await fetchImageBytes(rawUrl, options.fetchImpl ?? fetch, LOGO_MAX_BYTES)
  if (!got.ok) return got
  const { bytes, resolvedUrl } = got

  if (isSvgText(bytes)) {
    const drawn = await rasteriseLogo(bytes, true)
    if (!drawn) return { ok: false, error: 'That SVG could not be drawn. Export it as a PNG and paste that address.' }
    return { ok: true, logo: { ...drawn, mimeType: 'image/png', resolvedUrl } }
  }

  const sniffed = sniffImageMime(bytes)
  if (!sniffed) {
    return {
      ok: false,
      error:
        'That link is not a PNG, SVG, WebP, JPEG or AVIF image. Right-click the mark itself and ' +
        'copy its image address, not the page address.',
    }
  }
  if (sniffed === 'image/avif') {
    const drawn = await rasteriseLogo(bytes, false)
    if (!drawn) return { ok: false, error: 'That image file is damaged and could not be read.' }
    return { ok: true, logo: { ...drawn, mimeType: 'image/png', resolvedUrl } }
  }

  const size = imageDimensions(bytes, sniffed)
  if (!size) return { ok: false, error: 'That image file is damaged and could not be read.' }
  return { ok: true, logo: { bytes, mimeType: sniffed, width: size.width, height: size.height, resolvedUrl } }
}
```

The size-cap error text in `fetchImageBytes` already reads `That image is over the N MB limit.`; with `LOGO_MAX_BYTES` that N is 4, which the test asserts.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/remote-image.test.ts`
Expected: PASS (all previous tests plus 6 new). `pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/remote-image.ts apps/web/lib/remote-image.test.ts
git commit -m "feat(uploads): a pasted mark is fetched once, SVG and AVIF drawn to PNG (decision 268)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The library's server actions

**Files:**
- Create: `apps/web/app/(console)/settings/logo-actions.ts`
- Create: `apps/web/app/(console)/settings/logo-actions.test.ts`

**Interfaces:**
- Consumes: `listLogos`, `insertLogo`, `renameLogo`, `removeLogo`, `getSettings`, `updateSettings` from `@boom-busters/db`; `LogoStoredMimeSchema`, `logoExtension`, `LOGO_MAX_BYTES`, `UlidSchema` from `@boom-busters/schemas`; `logoKey`, `presignPut`, `headObject`, `putObject`, `deleteObject`, `storageConfigured` from `@/lib/storage`; `fetchRemoteLogo` from `@/lib/remote-image`.
- Produces (all async, the file is `'use server'`):
  - `createLogoUploadAction({ fileType, fileSize, contentHash }): Promise<ActionResult & { url?: string; key?: string }>`
  - `finaliseLogoAction({ key, contentHash, title, width, height }): Promise<ActionResult>`
  - `addLogoFromUrlAction({ url, title }): Promise<ActionResult>`
  - `renameLogoAction({ id, title }): Promise<ActionResult>`
  - `removeLogoAction(id): Promise<ActionResult>` (refuses the channel mark)
  - `setChannelMarkAction(id: string | null): Promise<ActionResult>`
  - `ActionResult` is `import type { ActionResult } from './actions'`.

- [ ] **Step 1: Write the failing test**

`apps/web/app/(console)/settings/logo-actions.test.ts`:

```ts
// @vitest-environment node

import { createHash } from 'node:crypto'
import { getSettings, listLogos, removeLogo, requireTestDatabase, seed, updateSettings } from '@boom-busters/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import {
  addLogoFromUrlAction,
  createLogoUploadAction,
  finaliseLogoAction,
  removeLogoAction,
  renameLogoAction,
  setChannelMarkAction,
} from './logo-actions'

/**
 * The Logos tab's actions (decision 268) against the test database, with the
 * seams a server action cannot bring to a unit test replaced: session, cache
 * revalidation, R2 (which answers as if every upload landed) and the fetcher.
 */

const authMock = vi.hoisted(() => ({
  auth: vi.fn(async () => ({ user: { email: 'owner@example.com' } })),
}))
vi.mock('@/auth', () => authMock)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const storage = vi.hoisted(() => ({ configured: true, deleted: [] as string[], put: [] as string[] }))
vi.mock('@/lib/storage', () => ({
  storageConfigured: () => storage.configured,
  logoKey: (input: { contentHash: string; ext: string }) => `boom-busters/logos/${input.contentHash}.${input.ext}`,
  presignPut: async (key: string) => `https://r2.example/${key}?signed`,
  putObject: async (key: string) => {
    storage.put.push(key)
    return { key }
  },
  headObject: async () => ({ size: 120_000, contentType: 'image/png' }),
  deleteObject: async (key: string) => {
    storage.deleted.push(key)
  },
}))

const remote = vi.hoisted(() => ({ fetchRemoteLogo: vi.fn() }))
vi.mock('@/lib/remote-image', () => remote)

const describeDb = requireTestDatabase() ? describe : describe.skip
const HASH = 'a'.repeat(64)

describeDb('logo actions', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    storage.configured = true
    storage.deleted = []
    storage.put = []
    await seed(db)
    for (const logo of await listLogos(db)) await removeLogo(db, logo.id)
    await updateSettings(db, { brandKit: { look: { logoR2Key: null, watermarkPlacement: 'br', grainPreset: 'subtle', lowerThirdVariant: 'bar', chapterCardVariant: 'full' } } })
  })

  it('presigns a PUT for a raster mark under the logos key, and refuses SVG and AVIF here', async () => {
    const created = await createLogoUploadAction({ fileType: 'image/png', fileSize: 1000, contentHash: HASH })
    expect(created).toMatchObject({ ok: true, key: `boom-busters/logos/${HASH}.png` })
    expect(created.url).toContain('?signed')

    // The browser converts these before asking; a request naming them is a
    // browser that skipped the conversion, and the server will not store them.
    for (const fileType of ['image/svg+xml', 'image/avif', 'image/gif']) {
      const refused = await createLogoUploadAction({ fileType, fileSize: 1000, contentHash: HASH })
      expect(refused.ok).toBe(false)
    }
    expect((await createLogoUploadAction({ fileType: 'image/png', fileSize: 5 * 1024 * 1024, contentHash: HASH })).error).toMatch(/4 MB/)
  })

  it('records the mark once the object landed, named, sized, and lists it', async () => {
    const result = await finaliseLogoAction({
      key: `boom-busters/logos/${HASH}.png`, contentHash: HASH, title: ' Stability AI ', width: 1200, height: 400,
    })
    expect(result).toEqual({ ok: true })
    const [logo] = await listLogos(db)
    expect(logo).toMatchObject({ kind: 'logo', title: 'Stability AI', width: 1200, height: 400, r2Key: `boom-busters/logos/${HASH}.png` })
  })

  it('refuses a finalise for a key this flow could not have issued, and an empty name', async () => {
    const wrongKey = await finaliseLogoAction({ key: 'boom-busters/music/x.mp3', contentHash: HASH, title: 'X', width: 1, height: 1 })
    expect(wrongKey.ok).toBe(false)
    const unnamed = await finaliseLogoAction({ key: `boom-busters/logos/${HASH}.png`, contentHash: HASH, title: '  ', width: 1, height: 1 })
    expect(unnamed.error).toMatch(/name/i)
  })

  it('adds a mark by address: fetches once, stores the bytes, keeps the address as provenance', async () => {
    const bytes = Buffer.from('png-bytes')
    remote.fetchRemoteLogo.mockResolvedValue({
      ok: true,
      logo: { bytes, mimeType: 'image/png', width: 300, height: 100, resolvedUrl: 'https://cdn.example/mark.png' },
    })
    const result = await addLogoFromUrlAction({ url: 'https://cdn.example/mark.png', title: 'Wirecard AG' })
    expect(result).toEqual({ ok: true })
    const hash = createHash('sha256').update(bytes).digest('hex')
    expect(storage.put).toEqual([`boom-busters/logos/${hash}.png`])
    const [logo] = await listLogos(db)
    expect(logo).toMatchObject({ title: 'Wirecard AG', sourceUrl: 'https://cdn.example/mark.png', width: 300 })
  })

  it('passes the fetcher refusal through in its own words', async () => {
    remote.fetchRemoteLogo.mockResolvedValue({ ok: false, error: 'That SVG could not be drawn.' })
    const result = await addLogoFromUrlAction({ url: 'https://cdn.example/bad.svg', title: 'X' })
    expect(result).toEqual({ ok: false, error: 'That SVG could not be drawn.' })
    expect(await listLogos(db)).toEqual([])
  })

  it('renames, chooses the channel mark, refuses to remove it, then removes it once unchosen', async () => {
    await finaliseLogoAction({ key: `boom-busters/logos/${HASH}.png`, contentHash: HASH, title: 'Stability AI', width: 1200, height: 400 })
    const [logo] = await listLogos(db)

    expect(await renameLogoAction({ id: logo!.id, title: 'Stability' })).toEqual({ ok: true })
    expect((await listLogos(db))[0]?.title).toBe('Stability')

    expect(await setChannelMarkAction(logo!.id)).toEqual({ ok: true })
    expect((await getSettings(db)).brandKit.look.logoR2Key).toBe(logo!.r2Key)

    const refused = await removeLogoAction(logo!.id)
    expect(refused.ok).toBe(false)
    expect(refused.error).toMatch(/channel mark/i)

    expect(await setChannelMarkAction(null)).toEqual({ ok: true })
    expect(await removeLogoAction(logo!.id)).toEqual({ ok: true })
    expect(storage.deleted).toEqual([logo!.r2Key])
    expect(await listLogos(db)).toEqual([])
  })

  it('says where the bytes would go when storage is not configured', async () => {
    storage.configured = false
    const created = await createLogoUploadAction({ fileType: 'image/png', fileSize: 10, contentHash: HASH })
    expect(created.error).toMatch(/R2/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `apps/web`): `npx vitest run "app/(console)/settings/logo-actions.test.ts"`
Expected: FAIL, `Cannot find module './logo-actions'`.

- [ ] **Step 3: Write the actions**

`apps/web/app/(console)/settings/logo-actions.ts`:

```ts
'use server'

/**
 * The Logos tab's actions (decision 268). The upload is the music library's
 * two-step presigned shape, because bytes cannot travel through an action
 * (decision 205); a pasted address is fetched server-side through
 * `fetchRemoteLogo`, which draws SVG and AVIF to PNG so that what is stored
 * is always a raster mark.
 */

import {
  getSettings,
  insertLogo,
  listLogos,
  removeLogo,
  renameLogo,
  updateSettings,
} from '@boom-busters/db'
import { LOGO_MAX_BYTES, LogoStoredMimeSchema, logoExtension, UlidSchema } from '@boom-busters/schemas'
import { createHash } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { fetchRemoteLogo } from '@/lib/remote-image'
import { deleteObject, headObject, logoKey, presignPut, putObject, storageConfigured } from '@/lib/storage'
import type { ActionResult } from './actions'

async function requireOwner(): Promise<void> {
  const session = await auth()
  if (!session?.user?.email) throw new Error('Not signed in')
}

const HEX_64 = /^[0-9a-f]{64}$/
const MAX_TITLE = 80

function cleanTitle(title: string): string | null {
  const trimmed = title.trim().replace(/\s+/g, ' ')
  return trimmed.length === 0 || trimmed.length > MAX_TITLE ? null : trimmed
}

function refresh(): void {
  revalidatePath('/settings')
  revalidatePath('/')
}

/**
 * Step one: a presigned PUT for a raster mark. SVG and AVIF are refused HERE
 * on purpose: the browser converts both before it asks, so a request naming
 * them is a browser that skipped the conversion, and the server will not
 * store what the render's Chromium would execute or no model reads.
 */
export async function createLogoUploadAction(input: {
  fileType: string
  fileSize: number
  contentHash: string
}): Promise<ActionResult & { url?: string; key?: string }> {
  await requireOwner()

  const mime = LogoStoredMimeSchema.safeParse(input.fileType)
  if (!mime.success) {
    return { ok: false, error: 'A mark is stored as PNG, WebP or JPEG. SVG and AVIF are converted before upload.' }
  }
  if (!Number.isFinite(input.fileSize) || input.fileSize <= 0) {
    return { ok: false, error: 'That file looks empty.' }
  }
  if (input.fileSize > LOGO_MAX_BYTES) {
    return { ok: false, error: 'That mark is over the 4 MB limit.' }
  }
  if (!HEX_64.test(input.contentHash)) {
    return { ok: false, error: 'The file could not be fingerprinted. Try choosing it again.' }
  }
  if (!storageConfigured()) {
    return { ok: false, error: 'Logo uploads need R2 configured; there is nowhere to store them.' }
  }
  const key = logoKey({ contentHash: input.contentHash, ext: logoExtension(mime.data) })
  return { ok: true, url: await presignPut(key, mime.data), key }
}

/** Step two: the object landed; record the mark under the entity's name. */
export async function finaliseLogoAction(input: {
  key: string
  contentHash: string
  title: string
  width: number
  height: number
}): Promise<ActionResult> {
  await requireOwner()

  const title = cleanTitle(input.title)
  if (!title) return { ok: false, error: 'Give the mark the name of the company or person it belongs to.' }
  if (!HEX_64.test(input.contentHash)) {
    return { ok: false, error: 'The file could not be fingerprinted. Try choosing it again.' }
  }
  // Only keys this flow could have issued: a content-hash logo key.
  const expectedPrefix = logoKey({ contentHash: input.contentHash, ext: 'png' }).replace(/png$/, '')
  if (!input.key.startsWith(expectedPrefix) || !/\.(png|webp|jpg)$/.test(input.key)) {
    return { ok: false, error: 'That upload does not match its fingerprint. Start again.' }
  }
  if (!storageConfigured()) {
    return { ok: false, error: 'Logo uploads need R2 configured; there is nowhere to store them.' }
  }
  const head = await headObject(input.key)
  if (!head) return { ok: false, error: 'The upload never arrived in storage. Try again.' }
  if (head.size > LOGO_MAX_BYTES) {
    await deleteObject(input.key)
    return { ok: false, error: 'That mark is over the 4 MB limit.' }
  }

  await insertLogo(db, {
    r2Key: input.key,
    contentHash: input.contentHash,
    title,
    width: Math.max(1, Math.round(input.width)),
    height: Math.max(1, Math.round(input.height)),
  })
  refresh()
  return { ok: true }
}

/** A mark by its web address, fetched once and stored like an upload. */
export async function addLogoFromUrlAction(input: { url: string; title: string }): Promise<ActionResult> {
  await requireOwner()

  const title = cleanTitle(input.title)
  if (!title) return { ok: false, error: 'Give the mark the name of the company or person it belongs to.' }
  if (!storageConfigured()) {
    return { ok: false, error: 'Logo uploads need R2 configured; there is nowhere to store them.' }
  }

  const fetched = await fetchRemoteLogo(input.url)
  if (!fetched.ok) return { ok: false, error: fetched.error }
  const { bytes, mimeType, width, height, resolvedUrl } = fetched.logo

  const contentHash = createHash('sha256').update(bytes).digest('hex')
  const key = logoKey({ contentHash, ext: logoExtension(mimeType) })
  await putObject(key, bytes, mimeType)
  await insertLogo(db, { r2Key: key, contentHash, title, width, height, sourceUrl: resolvedUrl })
  refresh()
  return { ok: true }
}

export async function renameLogoAction(input: { id: string; title: string }): Promise<ActionResult> {
  await requireOwner()
  if (!UlidSchema.safeParse(input.id).success) return { ok: false, error: 'Unknown mark.' }
  const title = cleanTitle(input.title)
  if (!title) return { ok: false, error: 'Give the mark the name of the company or person it belongs to.' }
  const row = await renameLogo(db, input.id, title)
  if (!row) return { ok: false, error: 'That mark is already gone.' }
  refresh()
  return { ok: true }
}

/** Remove a mark. The channel mark is refused: the watermark would point at nothing. */
export async function removeLogoAction(id: string): Promise<ActionResult> {
  await requireOwner()
  if (!UlidSchema.safeParse(id).success) return { ok: false, error: 'Unknown mark.' }

  const settings = await getSettings(db)
  const logo = (await listLogos(db)).find((row) => row.id === id)
  if (!logo) return { ok: false, error: 'That mark is already gone.' }
  if (settings.brandKit.look.logoR2Key === logo.r2Key) {
    return { ok: false, error: 'This is the channel mark. Choose another mark, or none, before removing it.' }
  }

  const row = await removeLogo(db, id)
  if (!row) return { ok: false, error: 'That mark is already gone.' }
  // Best-effort: the row is authoritative and already gone.
  try {
    await deleteObject(row.r2Key)
  } catch {
    // Orphaned bytes are a lifecycle-rule concern, not a correctness one.
  }
  refresh()
  return { ok: true }
}

/** The mark the watermark draws, or none for the typographic wordmark. */
export async function setChannelMarkAction(id: string | null): Promise<ActionResult> {
  await requireOwner()

  let logoR2Key: string | null = null
  if (id !== null) {
    if (!UlidSchema.safeParse(id).success) return { ok: false, error: 'Unknown mark.' }
    const logo = (await listLogos(db)).find((row) => row.id === id)
    if (!logo) return { ok: false, error: 'That mark is already gone.' }
    logoR2Key = logo.r2Key
  }
  const settings = await getSettings(db)
  await updateSettings(db, { brandKit: { look: { ...settings.brandKit.look, logoR2Key } } })
  refresh()
  return { ok: true }
}
```

If `updateSettings`'s patch type requires the whole `look` object (it does: `BrandKitStoredSchema.partial()` is shallow), the spread above supplies it; the test's `beforeEach` does the same.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run "app/(console)/settings/logo-actions.test.ts"`
Expected: PASS (7 tests). `pnpm typecheck`, `pnpm lint`.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(console)/settings/logo-actions.ts" "apps/web/app/(console)/settings/logo-actions.test.ts"
git commit -m "feat(settings): logo library actions, upload, address, rename, remove, channel mark (decision 268)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The Logos tab

**Files:**
- Create: `apps/web/app/(console)/settings/logos-tab.tsx`
- Create: `apps/web/app/(console)/settings/logos-tab.test.tsx`
- Modify: `apps/web/app/(console)/settings/settings-form.tsx:25,91-102,133-157`
- Modify: `apps/web/app/(console)/settings/page.tsx:1-10,10,17-22,45-58`

**Interfaces:**
- Consumes: every action from Task 5; `toUploadableLogo`, `readImageSize` from `@/lib/client-image`; `LOGO_ACCEPT`, `LOGO_MAX_BYTES` from `@boom-busters/schemas`; `ConfirmButton` from `@/components/confirm-button`; `Button`, `Card*`, `Input`, `Label`, `useToast`.
- Produces: `LogosTab({ logos, channelMarkKey }: { logos: LogoView[]; channelMarkKey: string | null })`, `interface LogoView { id: string; title: string; r2Key: string; width: number | null; height: number | null; url: string | null }`. `SettingsForm` gains `logos?: LogoView[]` and `channelMarkKey?: string | null`; the page's `TABS` gains `'logos'`.

- [ ] **Step 1: Write the failing test**

`apps/web/app/(console)/settings/logos-tab.test.tsx`:

```tsx
import { webcrypto } from 'node:crypto'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LogosTab } from './logos-tab'
import type { LogoView } from './logos-tab'

const actions = vi.hoisted(() => ({
  createLogoUploadAction: vi.fn(),
  finaliseLogoAction: vi.fn(),
  addLogoFromUrlAction: vi.fn(),
  renameLogoAction: vi.fn(),
  removeLogoAction: vi.fn(),
  setChannelMarkAction: vi.fn(),
}))
vi.mock('./logo-actions', () => actions)

// The browser conversion needs a decoder jsdom lacks; here a PNG passes
// through, which is what the tab is on the hook for using.
vi.mock('@/lib/client-image', () => ({
  toUploadableLogo: async (file: File) => ({ ok: true, file }),
  readImageSize: async () => ({ width: 640, height: 200 }),
}))

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

const fetchMock = vi.fn()

const LOGOS: LogoView[] = [
  { id: '01J000000000000000000000L1', title: 'Stability AI', r2Key: 'boom-busters/logos/aaa.png', width: 1200, height: 400, url: 'https://r2.example/aaa.png' },
  { id: '01J000000000000000000000L2', title: 'Wirecard AG', r2Key: 'mock://logos/bbb', width: null, height: null, url: null },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('crypto', webcrypto)
  actions.createLogoUploadAction.mockResolvedValue({ ok: true, url: 'https://r2.example/put', key: 'boom-busters/logos/abc.png' })
  fetchMock.mockResolvedValue({ ok: true, status: 200 })
  for (const action of [actions.finaliseLogoAction, actions.addLogoFromUrlAction, actions.renameLogoAction, actions.removeLogoAction, actions.setChannelMarkAction]) {
    action.mockResolvedValue({ ok: true })
  }
})

afterEach(() => vi.unstubAllGlobals())

describe('LogosTab', () => {
  it('lists every mark by name, with a preview or a note that mock storage has none', () => {
    render(<LogosTab logos={LOGOS} channelMarkKey={null} />)
    const list = screen.getByRole('list', { name: 'Logo library' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).getByRole('img', { name: 'Stability AI' })).toHaveAttribute('src', 'https://r2.example/aaa.png')
    expect(within(list).getByText('No preview in mock storage')).toBeInTheDocument()
  })

  it('marks the channel mark and offers the others as candidates', async () => {
    render(<LogosTab logos={LOGOS} channelMarkKey="boom-busters/logos/aaa.png" />)
    expect(screen.getByText('Channel mark')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Use Wirecard AG as channel mark' }))
    expect(actions.setChannelMarkAction).toHaveBeenCalledWith('01J000000000000000000000L2')
    await userEvent.click(screen.getByRole('button', { name: 'Use no mark' }))
    expect(actions.setChannelMarkAction).toHaveBeenCalledWith(null)
  })

  it('uploads browser to R2: convert, presign, PUT, then finalise with the name and size', async () => {
    render(<LogosTab logos={[]} channelMarkKey={null} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).toHaveAttribute('accept', expect.stringContaining('image/svg+xml'))

    await userEvent.type(screen.getByLabelText('Name'), 'Stability AI')
    await userEvent.upload(input, new File([new Uint8Array([1, 2, 3])], 'stability.png', { type: 'image/png' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add to library' }))

    await waitFor(() => expect(actions.finaliseLogoAction).toHaveBeenCalled())
    expect(actions.createLogoUploadAction).toHaveBeenCalledWith(
      expect.objectContaining({ fileType: 'image/png', fileSize: 3, contentHash: expect.stringMatching(/^[0-9a-f]{64}$/) }),
    )
    expect(fetchMock).toHaveBeenCalledWith('https://r2.example/put', expect.objectContaining({ method: 'PUT' }))
    expect(actions.finaliseLogoAction).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'boom-busters/logos/abc.png', title: 'Stability AI', width: 640, height: 200 }),
    )
    expect(refresh).toHaveBeenCalled()
  })

  it('pre-fills the name from the file and warns that a JPEG has no transparency', async () => {
    render(<LogosTab logos={[]} channelMarkKey={null} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, new File(['x'], 'wirecard-ag.jpg', { type: 'image/jpeg' }))
    expect(screen.getByLabelText('Name')).toHaveValue('Wirecard Ag')
    expect(screen.getByText(/no transparency/i)).toBeInTheDocument()
  })

  it('adds a mark by address with its name', async () => {
    render(<LogosTab logos={[]} channelMarkKey={null} />)
    await userEvent.type(screen.getByLabelText('Name'), 'Wirecard AG')
    await userEvent.type(screen.getByLabelText('Or paste an image address'), 'https://cdn.example/mark.svg')
    await userEvent.click(screen.getByRole('button', { name: 'Add from address' }))
    expect(actions.addLogoFromUrlAction).toHaveBeenCalledWith({ url: 'https://cdn.example/mark.svg', title: 'Wirecard AG' })
  })

  it('renames in place and removes behind a confirm that names the consequence', async () => {
    render(<LogosTab logos={LOGOS} channelMarkKey={null} />)
    const row = screen.getByRole('listitem', { name: 'Stability AI' })
    const name = within(row).getByLabelText('Rename Stability AI')
    await userEvent.clear(name)
    await userEvent.type(name, 'Stability')
    await userEvent.click(within(row).getByRole('button', { name: 'Save name' }))
    expect(actions.renameLogoAction).toHaveBeenCalledWith({ id: LOGOS[0]!.id, title: 'Stability' })

    await userEvent.click(within(row).getByRole('button', { name: 'Remove' }))
    await userEvent.click(within(row).getByRole('button', { name: 'Remove mark' }))
    expect(actions.removeLogoAction).toHaveBeenCalledWith(LOGOS[0]!.id)
  })

  it('shows the action error when a removal is refused', async () => {
    actions.removeLogoAction.mockResolvedValue({ ok: false, error: 'This is the channel mark.' })
    render(<LogosTab logos={LOGOS} channelMarkKey="boom-busters/logos/aaa.png" />)
    const row = screen.getByRole('listitem', { name: 'Stability AI' })
    await userEvent.click(within(row).getByRole('button', { name: 'Remove' }))
    await userEvent.click(within(row).getByRole('button', { name: 'Remove mark' }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'This is the channel mark.', variant: 'error' })))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run "app/(console)/settings/logos-tab.test.tsx"`
Expected: FAIL, `Cannot find module './logos-tab'`.

- [ ] **Step 3: Write the tab and mount it**

`apps/web/app/(console)/settings/logos-tab.tsx`:

```tsx
'use client'

import { ImagePlus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { LOGO_ACCEPT, LOGO_MAX_BYTES } from '@boom-busters/schemas'
import { ConfirmButton } from '@/components/confirm-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { readImageSize, toUploadableLogo } from '@/lib/client-image'
import {
  addLogoFromUrlAction,
  createLogoUploadAction,
  finaliseLogoAction,
  removeLogoAction,
  renameLogoAction,
  setChannelMarkAction,
} from './logo-actions'

/**
 * The logo library (decision 268): real marks the owner uploaded, one per
 * company or person, named as the dossier names them. A graphic slot's
 * "logo" element is matched to this list by that name (Plan B), and the
 * channel mark is what the film's corner watermark draws.
 *
 * Marks go browser to R2 on the presigned path (decision 205). SVG and AVIF
 * are drawn to PNG in the browser before the hash, so what is stored is
 * always a raster mark with its transparency kept.
 */

export interface LogoView {
  id: string
  title: string
  r2Key: string
  width: number | null
  height: number | null
  /** Presigned GET, or null in mock storage. */
  url: string | null
}

/** "wirecard-ag.jpg" reads "Wirecard Ag": a starting point, not the answer. */
function nameFromFile(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

async function fingerprint(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function LogosTab({ logos, channelMarkKey }: { logos: LogoView[]; channelMarkKey: string | null }) {
  const router = useRouter()
  const { toast } = useToast()
  const fileRef = React.useRef<HTMLInputElement | null>(null)
  const [file, setFile] = React.useState<File | null>(null)
  const [title, setTitle] = React.useState('')
  const [address, setAddress] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const failed = (description?: string) =>
    toast({ title: 'That did not work', description, variant: 'error' })

  const run = async (work: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
    setBusy(true)
    try {
      const result = await work()
      if (result.ok) {
        toast({ title: success })
        router.refresh()
      } else {
        failed(result.error)
      }
      return result.ok
    } catch {
      failed('The request never reached the server. Try again.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const upload = async (): Promise<{ ok: boolean; error?: string }> => {
    if (!file) return { ok: false, error: 'Choose a file first.' }
    const ready = await toUploadableLogo(file)
    if (!ready.ok) return ready
    const mark = ready.file
    if (mark.size > LOGO_MAX_BYTES) return { ok: false, error: 'That mark is over the 4 MB limit.' }

    const contentHash = await fingerprint(mark)
    const created = await createLogoUploadAction({ fileType: mark.type, fileSize: mark.size, contentHash })
    if (!created.ok || !created.url || !created.key) return created
    const put = await fetch(created.url, { method: 'PUT', body: mark, headers: { 'Content-Type': mark.type } })
    if (!put.ok) return { ok: false, error: `Storage refused the upload (${put.status}). Try again.` }

    const size = await readImageSize(mark)
    const result = await finaliseLogoAction({ key: created.key, contentHash, title, width: size.width, height: size.height })
    if (result.ok) {
      setFile(null)
      setTitle('')
      if (fileRef.current) fileRef.current.value = ''
    }
    return result
  }

  const field =
    'min-h-10 rounded-[8px] border border-[var(--color-border-strong)] bg-[var(--color-background)] p-2 text-[13px] text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]'
  const named = title.trim() !== ''

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Add a mark</CardTitle>
          <CardDescription>
            Real logos are uploaded, never generated. Name each mark exactly as the dossier names
            the company or person: that name is how a graphic finds it. PNG with a transparent
            background is best; SVG and AVIF are converted to PNG on the way in. Up to 4 MB.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <input
            ref={fileRef}
            type="file"
            accept={LOGO_ACCEPT}
            className="hidden"
            aria-label="Choose a logo file"
            onChange={(event) => {
              const chosen = event.target.files?.[0] ?? null
              setFile(chosen)
              if (chosen && title === '') setTitle(nameFromFile(chosen.name))
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
              <ImagePlus aria-hidden />
              {file ? `File: ${file.name}` : 'Choose logo file'}
            </Button>
            {file && (file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name)) ? (
              <span className="text-[12px] text-[var(--color-warning)]" role="status">
                A JPEG has no transparency; the mark will sit in a rectangle.
              </span>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="logo-title">Name</Label>
            <Input
              id="logo-title"
              value={title}
              placeholder="Stability AI"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={busy || !file || !named}
              onClick={() => void run(upload, 'Mark added to the library')}
            >
              Add to library
            </Button>
            {!file ? (
              <span className="text-[12px] text-[var(--color-text-muted)]">Choose a file first.</span>
            ) : !named ? (
              <span className="text-[12px] text-[var(--color-text-muted)]">A name is required.</span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[240px] flex-1 space-y-1">
              <Label htmlFor="logo-address">Or paste an image address</Label>
              <Input
                id="logo-address"
                value={address}
                placeholder="https://example.com/mark.svg"
                onChange={(event) => setAddress(event.target.value)}
              />
            </div>
            <Button
              variant="outline"
              disabled={busy || address.trim() === '' || !named}
              onClick={() =>
                void run(async () => {
                  const result = await addLogoFromUrlAction({ url: address, title })
                  if (result.ok) {
                    setAddress('')
                    setTitle('')
                  }
                  return result
                }, 'Mark added to the library')
              }
            >
              Add from address
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Marks</CardTitle>
            <CardDescription>
              The channel mark is drawn in the corner of every film. Without one, the corner carries
              the Boom &amp; Busters wordmark.
            </CardDescription>
          </div>
          {channelMarkKey !== null ? (
            <Button variant="outline" disabled={busy} onClick={() => void run(() => setChannelMarkAction(null), 'The corner carries the wordmark')}>
              Use no mark
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {logos.length === 0 ? (
            <p className="text-[13px] text-[var(--color-text-muted)]">No marks yet.</p>
          ) : (
            <ul aria-label="Logo library" className="grid gap-3 sm:grid-cols-2">
              {logos.map((logo) => (
                <LogoRow
                  key={logo.id}
                  logo={logo}
                  isChannelMark={logo.r2Key === channelMarkKey}
                  busy={busy}
                  run={run}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function LogoRow({
  logo,
  isChannelMark,
  busy,
  run,
}: {
  logo: LogoView
  isChannelMark: boolean
  busy: boolean
  run: (work: () => Promise<{ ok: boolean; error?: string }>, success: string) => Promise<boolean>
}) {
  const [name, setName] = React.useState(logo.title)
  const [confirming, setConfirming] = React.useState(false)
  const inputId = `logo-name-${logo.id}`

  return (
    <li
      aria-label={logo.title}
      className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] p-3"
    >
      <div
        className="grid h-28 place-items-center rounded-[8px]"
        style={{ backgroundColor: 'var(--color-background)' }}
      >
        {logo.url ? (
          <img src={logo.url} alt={logo.title} className="max-h-24 max-w-[90%] object-contain" />
        ) : (
          <span className="text-[12px] text-[var(--color-text-muted)]">No preview in mock storage</span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium">{logo.title}</span>
        {isChannelMark ? (
          <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[11px]">Channel mark</span>
        ) : (
          <Button
            variant="ghost"
            disabled={busy}
            aria-label={`Use ${logo.title} as channel mark`}
            onClick={() => void run(() => setChannelMarkAction(logo.id), `${logo.title} is the channel mark`)}
          >
            Use as channel mark
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[160px] flex-1 space-y-1">
          <Label htmlFor={inputId} className="sr-only">
            Rename {logo.title}
          </Label>
          <Input id={inputId} value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <Button
          variant="outline"
          disabled={busy || name.trim() === '' || name.trim() === logo.title}
          onClick={() => void run(() => renameLogoAction({ id: logo.id, title: name }), 'Mark renamed')}
        >
          Save name
        </Button>
        <ConfirmButton
          variant="ghost"
          label="Remove"
          confirmLabel="Remove mark"
          consequence={`${logo.title} leaves the library; graphics that use it will ask for it again.`}
          disabled={busy}
          onConfirm={() => run(() => removeLogoAction(logo.id), 'Mark removed')}
          open={confirming}
          onOpenChange={setConfirming}
        />
      </div>
    </li>
  )
}
```

Check `ConfirmButton`'s actual prop names in `apps/web/components/confirm-button.tsx` (lines 21 to 40) and use them exactly; the `consequence` prop is the "what clicking through will do" sentence and `open`/`onOpenChange` may not exist, in which case drop them (the component manages its own state).

In `settings-form.tsx`:
- add `import { LogosTab, type LogoView } from './logos-tab'` after the MusicTab import;
- add props `logos = []` and `channelMarkKey = null` beside `musicBeds`, typed `logos?: LogoView[]`, `channelMarkKey?: string | null`;
- add `<TabsTrigger value="logos">Logos</TabsTrigger>` after the Music library trigger and
  `<TabsContent value="logos"><LogosTab logos={logos} channelMarkKey={channelMarkKey} /></TabsContent>` after the music content.

In `page.tsx`:
- `TABS` gains `'logos'` after `'music'`;
- import `listLogos` from `@boom-busters/db` and `presignGet, storageConfigured` from `@/lib/storage`;
- load `listLogos(db)` in the `Promise.all`;
- build the views:

```ts
const logoViews = await Promise.all(
  logos.map(async (logo) => ({
    id: logo.id,
    title: logo.title ?? 'Unnamed mark',
    r2Key: logo.r2Key,
    width: logo.width,
    height: logo.height,
    url: storageConfigured() && !logo.r2Key.startsWith('mock://') ? await presignGet(logo.r2Key) : null,
  })),
)
```

- pass `logos={logoViews}` and `channelMarkKey={settings.brandKit.look.logoR2Key}` to `SettingsForm`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run "app/(console)/settings/logos-tab.test.tsx"`
Expected: PASS (7 tests). Then `pnpm typecheck`, `pnpm lint`, `pnpm format:check` (run `npx prettier --write` on the new files first).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(console)/settings/logos-tab.tsx" "apps/web/app/(console)/settings/logos-tab.test.tsx" "apps/web/app/(console)/settings/settings-form.tsx" "apps/web/app/(console)/settings/page.tsx"
git commit -m "feat(settings): the Logos tab, upload or paste a mark, name it, choose the channel mark (decision 268)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Both materialisers resolve the channel mark

**Files:**
- Modify: `apps/web/lib/materialise.ts:46-115`
- Modify: `apps/web/lib/materialise.test.ts`
- Modify: `infra/lambdas/broker/core.ts:155-178`
- Modify: `infra/lambdas/broker/core.test.ts:501-520`

**Interfaces:**
- Consumes: `Timeline['brand']['look']['logoR2Key']` (stored), `look.logoUrl` (from Task 1).
- Produces: after materialisation, `timeline.brand.look.logoUrl` is set whenever `logoR2Key` resolves; absent otherwise. The preview never drops anything for an unresolvable mark: the wordmark is the fallback.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/lib/materialise.test.ts` inside the `materialiseForPreview` describe (reuse the file's existing `canonical()` or timeline builder and `ORIGIN`):

```ts
it('resolves the channel mark to a URL, and leaves it out when it cannot', async () => {
  const withMark = structuredClone(canonical())
  withMark.brand.look.logoR2Key = 'boom-busters/logos/abc.png'

  const resolved = await materialiseForPreview(withMark, {
    origin: ORIGIN,
    presign: (key) => Promise.resolve(`https://r2.example.com/${key}?sig=x`),
  })
  expect(resolved.timeline.brand.look.logoUrl).toBe('https://r2.example.com/boom-busters/logos/abc.png?sig=x')
  // Nothing was dropped: the mark is not a slot.
  expect(resolved.dropped).toEqual({ narration: 0, slots: 0, music: false })

  const unresolved = await materialiseForPreview(withMark, { origin: ORIGIN, presign: null })
  expect(unresolved.timeline.brand.look.logoUrl).toBeUndefined()
})
```

Append to the `materialiseTimeline` describe in `infra/lambdas/broker/core.test.ts`:

```ts
it('presigns the channel mark into brand.look.logoUrl', async () => {
  const original = canonicalTimeline()
  original.brand.look.logoR2Key = 'boom-busters/logos/abc.png'
  const copy = await materialiseTimeline(original, (key) => Promise.resolve(`https://signed/${key}`))
  expect(copy.brand.look.logoUrl).toBe('https://signed/boom-busters/logos/abc.png')
  expect(original.brand.look.logoUrl).toBeUndefined()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/materialise.test.ts` (from `apps/web`) and `npx vitest run lambdas/broker/core.test.ts` (from `infra`)
Expected: FAIL on `logoUrl` being undefined.

- [ ] **Step 3: Write the two resolutions**

In `apps/web/lib/materialise.ts`, after the music block and before the slots loop:

```ts
  // The channel mark (decision 268). Not a slot, so an unresolvable one is
  // not "dropped": the watermark falls back to the wordmark on its own.
  const markKey = timeline.brand.look.logoR2Key
  if (markKey) {
    const url = await resolveKey(markKey, deps)
    if (url !== null) timeline.brand.look.logoUrl = url
  }
```

In `infra/lambdas/broker/core.ts` `materialiseTimeline`, after the music block:

```ts
  if (copy.brand.look.logoR2Key) {
    copy.brand.look.logoUrl = await presign(copy.brand.look.logoR2Key)
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Both commands from Step 2. Expected: PASS. `pnpm typecheck` (the infra package typechecks against the schemas package's `Timeline`; if `infra` is not in the typecheck task list, run `npx tsc --noEmit` inside `infra`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/materialise.ts apps/web/lib/materialise.test.ts infra/lambdas/broker/core.ts infra/lambdas/broker/core.test.ts
git commit -m "feat(render): both materialisers resolve the channel mark to a URL (decision 268)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The watermark draws the mark

**Files:**
- Create: `packages/compositions/src/components/Watermark.tsx`
- Modify: `packages/compositions/src/components/DocumentaryMaster.tsx:1-40,205-250`
- Modify: `packages/compositions/src/Root.tsx` (a `WatermarkLogo` composition)
- Modify: `packages/compositions/src/snapshot/render.test.ts:36-58` (a `WatermarkLogo` case)
- Create: `packages/compositions/src/snapshot/golden/WatermarkLogo.png` (generated once)

**Interfaces:**
- Consumes: `BrandKitTokens`, `frameScale`, `typeStyle`, `withAlpha`, `FIXTURE_BRAND`, `FIXTURE_IMAGE_SKYLINE`.
- Produces: `Watermark({ brand })` and `WatermarkFixture({ brand })` exported from `./components/Watermark`; `DocumentaryMaster` imports `Watermark` from there and its private copy is deleted.

- [ ] **Step 1: Write the failing test**

Add to `CASES` in `packages/compositions/src/snapshot/render.test.ts`:

```ts
  // The channel mark in the corner (decision 268): an image, not the wordmark.
  { id: 'WatermarkLogo', frame: 10, maxDiffRatio: 0.03 },
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `packages/compositions`): `npx vitest run src/snapshot/render.test.ts -t WatermarkLogo`
Expected: FAIL, no composition `WatermarkLogo`.

- [ ] **Step 3: Write the component, move the watermark, register the fixture**

`packages/compositions/src/components/Watermark.tsx`:

```tsx
import { AbsoluteFill, Img, useVideoConfig } from 'remotion'
import type { CSSProperties } from 'react'
import type { BrandKitTokens } from '@boom-busters/schemas'
import { frameScale, typeStyle, withAlpha } from './brand'

/**
 * The corner watermark. The channel mark when the brand kit names one and
 * the materialiser resolved it (decision 268); otherwise the typographic
 * "Boom & Busters" wordmark, which is what every film carried before there
 * was a logo library. The fallback is deliberate: a broken image in every
 * frame would be worse than clean type.
 */

const WORDMARK_PX = 24
/** The mark sits at 1.6 times the caption size: legible, never a title. */
const MARK_HEIGHT_PX = Math.round(WORDMARK_PX * 1.6)
const MARK_ALPHA = 0.6

function cornerStyle(placement: BrandKitTokens['look']['watermarkPlacement'], inset: number): CSSProperties {
  return {
    position: 'absolute',
    ...(placement === 'tl' || placement === 'tr' ? { top: inset } : { bottom: inset }),
    ...(placement === 'tl' || placement === 'bl' ? { left: inset } : { right: inset }),
  }
}

export function Watermark({ brand }: { brand: BrandKitTokens }) {
  const { width, height } = useVideoConfig()
  const scale = frameScale(width, height)
  const placement = brand.look.watermarkPlacement
  if (placement === 'none') return null
  const position = cornerStyle(placement, Math.round(36 * scale))

  if (brand.look.logoUrl) {
    return (
      <Img
        src={brand.look.logoUrl}
        style={{
          ...position,
          height: Math.round(MARK_HEIGHT_PX * scale),
          // Width follows the mark's own shape; a wide lockup stays wide.
          maxWidth: Math.round(width * 0.22),
          objectFit: 'contain',
          opacity: MARK_ALPHA,
        }}
      />
    )
  }

  return (
    <div
      style={{
        ...position,
        ...typeStyle(brand.typography.captions, WORDMARK_PX, scale),
        color: withAlpha(brand.colors.textPrimary, 0.45),
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}
    >
      Boom &amp; Busters
    </div>
  )
}

/** Studio and snapshot fixture: the mark over the brand ground, nothing else. */
export function WatermarkFixture({ brand }: { brand: BrandKitTokens }) {
  return (
    <AbsoluteFill style={{ backgroundColor: brand.colors.background }}>
      <Watermark brand={brand} />
    </AbsoluteFill>
  )
}
```

In `DocumentaryMaster.tsx`: add `import { Watermark } from './Watermark'`, delete the private `Watermark` function (lines 209 to 249) and its doc comment; the `<Watermark brand={brand} />` usage at line 91 stays. Remove `typeStyle` and `withAlpha` from the `./brand` import if nothing else in the file uses them (`frameScale` may still be used; check with the typechecker).

In `Root.tsx`: import `WatermarkFixture` and add after the `HeadlineCardTall` composition:

```tsx
      <Composition
        id="WatermarkLogo"
        component={WatermarkFixture}
        durationInFrames={30}
        {...WIDE}
        defaultProps={{
          brand: {
            ...FIXTURE_BRAND,
            look: {
              ...FIXTURE_BRAND.look,
              logoR2Key: 'boom-busters/logos/fixture.png',
              logoUrl: FIXTURE_IMAGE_SKYLINE,
            },
          },
        }}
      />
```

- [ ] **Step 4: Generate the golden once, then run the test to verify it passes**

Run: `REGEN_GOLDEN=1 npx vitest run src/snapshot/render.test.ts -t WatermarkLogo` (PowerShell: `$env:REGEN_GOLDEN='1'; npx vitest run src/snapshot/render.test.ts -t WatermarkLogo; Remove-Item Env:REGEN_GOLDEN`), then `git status --short packages/compositions/src/snapshot/golden` and confirm ONLY `WatermarkLogo.png` is new; if any other golden changed, restore it with `git checkout -- <file>` (a full-suite regen is never trusted). Open the PNG and check the mark sits bottom right at 60% over the dark ground. Then `npx vitest run src/snapshot/render.test.ts` (whole file, foreground): every case PASS including `DocumentaryMaster`, whose watermark is still the wordmark because the fixture brand has no mark.

- [ ] **Step 5: Commit**

```bash
git add packages/compositions/src/components/Watermark.tsx packages/compositions/src/components/DocumentaryMaster.tsx packages/compositions/src/Root.tsx packages/compositions/src/snapshot/render.test.ts packages/compositions/src/snapshot/golden/WatermarkLogo.png
git commit -m "feat(compositions): the watermark draws the channel mark, wordmark as fallback (decision 268)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Seeded marks and the e2e round trip

**Files:**
- Modify: `e2e/global-setup.ts:130,845-860`
- Create: `e2e/tests/settings-logos.spec.ts`

**Interfaces:**
- Consumes: `insertLogo`, `listLogos` from `@boom-busters/db`; `signIn`, `expectHitTargets` from `./fixtures`.
- Produces: two seeded marks on `mock://logos/...` keys; a spec that walks the tab.

- [ ] **Step 1: Write the failing spec**

`e2e/tests/settings-logos.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { expectHitTargets, signIn } from './fixtures'

/**
 * The Logos tab (decision 268) in mock storage: the seeded marks list, the
 * channel mark can be chosen and cleared, a rename survives a reload. Upload
 * and fetch-by-address need R2, which mock storage does not have, so they are
 * covered by the action and component tests; here the buttons exist and the
 * refusal is in words.
 */

test.describe('Logos tab', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
    await page.goto('/settings?tab=logos')
  })

  test('lists the seeded marks and lets the owner choose the channel mark', async ({ page }) => {
    const library = page.getByRole('list', { name: 'Logo library' })
    await expect(library.getByRole('listitem')).toHaveCount(2)
    await expect(library.getByText('No preview in mock storage').first()).toBeVisible()

    await page.getByRole('button', { name: 'Use Stability AI (E2E) as channel mark' }).click()
    await expect(page.getByText('Channel mark')).toBeVisible()
    await page.reload()
    await expect(page.getByRole('listitem', { name: 'Stability AI (E2E)' }).getByText('Channel mark')).toBeVisible()

    await page.getByRole('button', { name: 'Use no mark' }).click()
    await expect(page.getByText('Channel mark')).toHaveCount(0)
    await expectHitTargets(page)
  })

  test('renames a mark and keeps the name across a reload', async ({ page }) => {
    const row = page.getByRole('listitem', { name: 'Wirecard AG (E2E)' })
    const name = row.getByLabel('Rename Wirecard AG (E2E)')
    await name.fill('Wirecard (E2E)')
    await row.getByRole('button', { name: 'Save name' }).click()
    await expect(page.getByRole('listitem', { name: 'Wirecard (E2E)' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('listitem', { name: 'Wirecard (E2E)' })).toBeVisible()
    // Put it back so the suite is order-independent.
    const renamed = page.getByRole('listitem', { name: 'Wirecard (E2E)' })
    await renamed.getByLabel('Rename Wirecard (E2E)').fill('Wirecard AG (E2E)')
    await renamed.getByRole('button', { name: 'Save name' }).click()
    await expect(page.getByRole('listitem', { name: 'Wirecard AG (E2E)' })).toBeVisible()
  })

  test('offers upload and address, and says why they need storage', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Choose logo file' })).toBeVisible()
    await page.getByLabel('Name').fill('Nobody Inc')
    await page.getByLabel('Or paste an image address').fill('https://example.com/mark.png')
    await page.getByRole('button', { name: 'Add from address' }).click()
    await expect(page.getByText(/R2 configured/)).toBeVisible()
  })
})
```

- [ ] **Step 2: Run the spec to verify it fails**

Run (from `e2e`): `npx playwright test tests/settings-logos.spec.ts --project=desktop` (use the project name the config defines; `npx playwright test --list` shows it)
Expected: FAIL, the library list is empty (nothing seeded).

- [ ] **Step 3: Seed two marks**

In `e2e/global-setup.ts`, add `insertLogo, listLogos` to the `@boom-busters/db` import at line 130, and after the music-bed block:

```ts
    // Two marks (decision 268), on mock:// keys like the beds: the tab
    // lists them, the watermark never draws them (mock storage has no bytes).
    if ((await listLogos(connection.db)).length < 2) {
      for (const [index, title] of [[1, 'Stability AI (E2E)'], [2, 'Wirecard AG (E2E)']] as const) {
        await insertLogo(connection.db, {
          r2Key: `mock://logos/e2e-mark-${index}`,
          contentHash: `e2e-logo-${index}`,
          title,
          width: 1200,
          height: 400,
        })
      }
    }
```

- [ ] **Step 4: Run the spec to verify it passes, then the whole suite**

Run: `npx playwright test tests/settings-logos.spec.ts`, then `pnpm e2e` from the root (foreground; about five minutes). Expected: the new spec passes on both projects it is configured for; the total is 114 plus the new cases; the hit-target audit passes on the tab.

- [ ] **Step 5: Commit**

```bash
git add e2e/global-setup.ts e2e/tests/settings-logos.spec.ts
git commit -m "test(e2e): the Logos tab lists seeded marks, chooses the channel mark, renames (decision 268)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Record the decision

**Files:**
- Modify: `PROGRESS.md` (append entry 52 after entry 51)
- Modify: `docs/03-build-spec.md:234` (the section 8.3 inventory line) and the section 10.1 music-library paragraph

**Interfaces:** none.

- [ ] **Step 1: Write the PROGRESS entry**

Append after entry 51, following its shape (bold title, decision number and date, paragraphs, `_Tests._`), in this content:

```
52. **The logo library, and the watermark draws the channel mark**
    (decision 268, Plan A; 2026-09-21, owner: "logos shouldn't be generated,
    they should be uploaded and then composited").

    Marks are `assets` rows of kind `logo`, the enum value that has existed
    since M1 with nothing writing it, channel-wide and deduped by content hash
    like music, titled with the entity's name as the dossier writes it. That
    name is the join: `logoForEntity` matches a graphic's "logo" element to
    the library with the cast's tolerant `nameMatches`, ready for Plan B.

    Stored marks are always raster. SVG and AVIF are drawn to PNG at the door
    (the browser's canvas for a picked file, sharp for a pasted address, 2048
    px on the long edge, transparency kept), so the render's Chromium never
    executes anything an upload contained. The spec had named an SVG
    sanitiser; rasterising is smaller and closes the hole completely, and the
    spec was amended to say so.

    `brand.look.logoR2Key`, empty since M6, is now set from the Logos tab;
    both materialisers resolve it to `look.logoUrl`, which exists only in the
    resolved brand form, and `Watermark`, now its own component, draws the
    mark at 1.6 caption heights and 0.6 alpha with the typographic wordmark as
    the fallback.

    _Tests._ Schema: stored formats, the picker's accept string, the entity
    matcher including the contained-name refusal, the resolved-only URL.
    Database: dedupe on re-upload as a rename, the name join, never a bed.
    Browser: SVG and AVIF to PNG through the codec and rasteriser seams.
    Server: a pasted SVG comes back as PNG bytes with alpha at 2048 px; the 4
    MB cap; no thumbnail floor for a mark. Actions: the presign refuses SVG
    and AVIF by design; finalise checks the key shape; add by address hashes
    the fetched bytes; the channel mark cannot be removed while chosen. Tab:
    the whole browser-to-R2 path, the JPEG warning, rename, confirm-remove.
    Materialisers: both resolve the mark; the preview drops nothing for one it
    cannot. Snapshot: `WatermarkLogo`, new golden only. e2e: seeded marks,
    channel mark chosen and cleared across a reload, rename round trip.
```

- [ ] **Step 2: Amend the build spec**

Append to the section 8.3 inventory line (line 234), after the decision 257 amendment: `*(Amended 2026-09-21, decision 268: `Watermark` is its own component and draws the channel mark named by `brand.look.logoR2Key`, resolved by both materialisers to `look.logoUrl` in the resolved brand form only; the wordmark remains the fallback.)*`

Append to the section 10.1 paragraph that describes the music library (search for "music library" in section 10): `*(Amended 2026-09-21, decision 268: a Logos tab beside Music holds channel-wide marks as `assets` rows of kind `logo`, titled with the entity's name; SVG and AVIF are rasterised to PNG at the door; the chosen mark is the corner watermark.)*`

- [ ] **Step 3: Check and commit**

Run: `npx prettier --check PROGRESS.md` and a dash scan over the two files' added lines (`git diff -U0 | grep "^+" | grep -P "[\x{2013}\x{2014}]"` must print nothing; on Windows use `node -e` with a regex for the two dash code points, hex 2013 and hex 2014, over `git diff -U0` output).

```bash
git add PROGRESS.md docs/03-build-spec.md
git commit -m "docs: decision 268 Plan A, the logo library and the channel mark, recorded

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.** 6.1 storage: Task 2 (queries), Task 3 (`logoKey`). 6.2 formats and safety: Tasks 3 and 4 (rasterise both doors), Task 5 (the presign refuses SVG and AVIF, the 4 MB cap, the JPEG warning is Task 6). 6.3 the tab: Task 6. 6.5 the watermark: Tasks 7 and 8. 3.3a the brand snapshot: Task 1. Tests listed in spec section 9 for the library, rasterising, settings tab, materialiser and e2e: Tasks 1 to 9. Section 10 rollout: no migration is needed for Plan A; the Remotion site redeploy for the watermark is the owner's script and is noted for the handoff, not a task.

**Placeholders.** None: every step carries its code or its exact command. Two places tell the implementer to check a neighbour and adapt (`ConfirmButton` prop names in Task 6; the Playwright project name in Task 9) because those are read from files, not invented.

**Type consistency.** `LogoIndex { id, title }` (Task 1) is what `findLogoByName` maps rows onto (Task 2). `logoKey({ contentHash, ext: 'png' | 'webp' | 'jpg' })` (Task 3) matches `logoExtension`'s return (Task 1) and the actions' calls (Task 5). `fetchRemoteLogo` returns `{ ok, logo: { bytes, mimeType, width, height, resolvedUrl } }` (Task 4), destructured exactly so in Task 5. `LogoView` (Task 6) is built in `page.tsx` with the same field names. `look.logoUrl` (Task 1) is what Tasks 7 and 8 read and write.
