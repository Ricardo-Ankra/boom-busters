# Motion graphics and the logo library: design

_2026-09-21. Decision 268. Owner's framing: "logos shouldn't be generated, they should be uploaded and then composited"; "I want a lot more options and flexibility" than a fixed menu of graphic kinds; editing in the first version is steer and swap, not an element editor._

## 1. What this adds

A seventh drawn slot type, `graphic`, whose brief is a small **scene graph**: a fixed vocabulary of elements placed on a coarse grid, styled only through brand tokens, with every number cited to a dossier claim and every logo drawn from a library of marks the owner uploaded. The shot-list planner composes graphics from that vocabulary the way it composes charts from claim numbers today. One layout module serves both the board's SVG preview and the Remotion component, so the approved graphic is the rendered graphic.

A channel-wide **logo library** holds those marks. It fills two slots that have been empty since M6: `assets.kind = 'logo'`, which nothing writes, and `brand.look.logoR2Key`, which nothing reads. The corner watermark renders the chosen mark instead of the typographic stand-in.

## 2. Why this shape

**A scene graph rather than a template catalogue.** The owner wants flexibility, and a catalogue caps it at however many templates were drawn. A vocabulary of primitives on a grid can express a big-number callout, a comparison, a company card, a dated strip and things nobody has named yet, while the constraints that make the channel's graphics safe and consistent live in the schema, not in the templates: colours by token name only, type by role name only, numbers cited or refused, logos real or absent.

**The brief is the payload.** Charts, maps and headlines already work this way: nothing is fetched, the timeline embeds the data whole, and a render six months from now depends on nothing external. A graphic follows suit. The only bytes it references are logos, and those ride the same `MediaRef` materialisation path stills use.

**Logos are uploaded, never generated.** Decision 263 removed the blanket "no logos" from image prompts because a film about a company shows its marks, and decision 257 set outlet names in the house type with no logo field. This design gives the owner the third option that was always the plan: a real mark, uploaded once, composited on the brand grade.

**Rules with teeth.** Chart briefs enforce claim refs by schema but trust the prompt for the numbers themselves. A graphic's `figure` carries a claim ref by schema *and* its digits are checked against the cited claim's text in code. Applying that check to existing chart briefs is out of scope here because it changes behaviour on stored rows; it is recorded in section 11 as a candidate.

## 3. Data model

### 3.1 Slot type

- `SHOT_SLOT_TYPES` gains `'graphic'` (schemas `visuals.ts`). The pg enum `shot_slot_type` gains the value in migration 0027 (`ALTER TYPE ... ADD VALUE 'graphic'`). No other table changes.
- `TIMELINE_SLOT_TYPES` gains `'graphic'`; `SLOT_PAYLOAD_KINDS.graphic = ['graphic']`.
- `REUSABLE_SLOT_TYPES` is unchanged: a graphic is data, not a picture, and is never reused (decision 261's rule).
- `ShotSize` for a graphic is always `'graphic'`, as for charts and maps.

### 3.2 The scene

```ts
export const GRAPHIC_GRID = 12          // columns and rows over the safe area
export const MAX_GRAPHIC_ELEMENTS = 6

const CellSchema = z.object({
  col: z.number().int().min(0).max(11),
  row: z.number().int().min(0).max(11),
  colSpan: z.number().int().min(1).max(12),
  rowSpan: z.number().int().min(1).max(12),
}).refine(c => c.col + c.colSpan <= 12 && c.row + c.rowSpan <= 12)

export const GRAPHIC_COLORS = [
  'primary', 'accent', 'background', 'surface', 'textPrimary', 'textSecondary',
  'captionHighlight', 'collapse', 'recovery',
  'series0', 'series1', 'series2',
] as const                              // names, never hex

export const GraphicColorSchema = z.enum(GRAPHIC_COLORS)
export const GraphicTypeRoleSchema = z.enum(['heading', 'title', 'body', 'numbers', 'captions'])

const EnterSchema = z.object({
  kind: z.enum(['fade', 'rise', 'wipe', 'count']),
  /** Offset from the slot's start. The layout clamps it inside the slot. */
  atMs: z.number().int().min(0).max(8000).default(0),
})

const elementCommon = {
  id: z.string().min(1).max(40),
  cell: CellSchema,
  /** Absent means "re-flow me in reading order into one column on 9:16". */
  portraitCell: CellSchema.optional(),
  enter: EnterSchema.default({ kind: 'fade', atMs: 0 }),
  emphasis: z.enum(['pulse', 'underline']).optional(),
}

export const GraphicElementSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), ...elementCommon,
    content: z.string().min(1).max(120),
    role: GraphicTypeRoleSchema, color: GraphicColorSchema,
    align: z.enum(['start', 'center', 'end']).default('start') }),
  z.object({ kind: z.literal('figure'), ...elementCommon,
    /** Exactly what is shown: "$4bn", "94%", "1,200 staff". */
    value: z.string().min(1).max(24),
    label: z.string().min(1).max(60).optional(),
    claimRef: UlidSchema,                // a claim id once stored; see 4.2
    color: GraphicColorSchema }),
  z.object({ kind: z.literal('logo'), ...elementCommon,
    /** The entity the planner named; kept for the card's "Add logo for …". */
    entity: z.string().min(1).max(80),
    /** Set by resolution; absent means the library holds no mark yet. */
    assetId: UlidSchema.optional() }),
  z.object({ kind: z.literal('shape'), ...elementCommon,
    form: z.enum(['rect', 'rule', 'disc']),
    color: GraphicColorSchema, opacity: z.number().min(0.05).max(1).default(1) }),
  z.object({ kind: z.literal('bars'), ...elementCommon,
    items: z.array(z.object({
      label: z.string().min(1).max(40),
      value: z.number().finite(),
      /** What is written at the end of the bar. */
      display: z.string().min(1).max(24),
      claimRef: UlidSchema,
    })).min(2).max(5),
    color: GraphicColorSchema,
    highlightIndex: z.number().int().min(0).max(4).optional() }),
])

export const GraphicSceneSchema = z.object({
  elements: z.array(GraphicElementSchema).min(1).max(MAX_GRAPHIC_ELEMENTS),
}).superRefine((scene, ctx) => {
  // `count` only counts a figure; ids unique; at most one logo element per entity.
})

export const GraphicBriefSchema = z.object({
  type: z.literal('graphic'),
  ...briefCommon,
  scene: GraphicSceneSchema,
})
```

Rules the refinement enforces, in words: `enter.kind === 'count'` is legal only on a `figure`; element ids are unique within a scene; two `logo` elements may not name the same entity; every `figure` and every `bars` item cites a claim (by schema). Chart series colours are exposed as `series0` to `series2` because a graphic never needs more than three and a longer palette invites confetti.

### 3.3 The payload

```ts
export const GraphicPayloadSchema = z.object({
  kind: z.literal('graphic'),
  scene: GraphicSceneSchema,
  /** Logo bytes, keyed by element id, materialised like any still. */
  logos: z.record(z.string(), MediaRefSchema.extend({
    width: z.number().int().positive(), height: z.number().int().positive(),
  })),
  /** Every claim the scene cites, for the audit trail. */
  claimIds: z.array(UlidSchema).min(1),
})
```

The scene is embedded whole. `logos` is filled at compile time from the library; a logo element without an asset never reaches compile (section 5.3).

### 3.3a The brand snapshot

`BrandLookSchema` gains `logoUrl: z.string().optional()`, present only in a **materialised** timeline (the canonical stored timeline carries `logoR2Key` alone, per the URL materialisation rule). The watermark reads `logoUrl`; the materialisers write it. The stored settings row never holds it.

### 3.4 Planned form

`PlannedGraphicBriefSchema` is the same shape with `claimRef: z.number().int().min(1)` (a claim number, as the planner writes them) and no `assetId`. `resolvePlannedBrief` maps numbers to ids and looks entities up (section 4.2).

## 4. Planner and validation

### 4.1 Prompt

The shot-list prompt (`packages/providers/src/prompts/shotlist.ts`) adds one shape beside `chart`:

```
- {"type": "graphic", "coversText", "description", "motion", "transition",
   "scene": {"elements": [ ... ]}}
```

followed by the vocabulary in the same compressed style the chart rules use, and this rule:

> A graphic is for a beat that is one or two cited figures, a company's or a person's mark, or a relationship between named things (a before and after, a comparison of two or three amounts, three dated moments). It is never a chart with fewer points: a value moving through time is a "chart". Every "figure" and every "bars" item cites the claim NUMBER its value comes from, and the digits shown must appear in that claim. Colours are the token names listed; type is the role names listed; there is no other styling. Place elements on the 12 by 12 grid; six elements at most; leave the bottom two rows clear for captions. A "logo" names the company or person exactly as the dossier does; the producer supplies the file.

The retype prompt (`retype.ts`) gains `graphic` as a third model-drafted target beside chart and map, and `convertBrief` returns null for a `graphic` target without a draft, exactly as it does for those two. `buildRebriefRequest` is unchanged: "Draft a different brief" on a graphic goes through the retype path with the target set to `graphic`, as charts do (decision 258).

The mock shot list emits one graphic (a `figure` with a `text` label and a `logo` for the fixture's principal company) so the card path runs in every e2e pass.

### 4.2 Resolution

`resolvePlannedBrief(brief, claims, logos)` gains a `logos: readonly LogoIndex[]` argument (`{ id, title }`). For a graphic:

1. Every `claimRef` is mapped through `mapClaimRefs`; a number outside the list returns null and `plannedBriefRejection` says "graphic cited a claim number outside the claim list".
2. `figureCitesClaim(value, claimText)` runs for every `figure` and `bars` item (section 4.3). A miss returns null with "graphic showed a number the cited claim does not contain: `$4.5bn` against claim 7".
3. Every `logo` element's `entity` is looked up with the cast's tolerant `nameMatches` against logo titles. A hit stores `assetId`; a miss leaves the element with `entity` only. A miss is **not** a rejection: the slot is stored and resolves to `placeholder` (section 5.3), because the fix is an upload, not a redraft.

### 4.3 `figureCitesClaim`

Pure, in `packages/schemas/src/graphics.ts`:

- Normalise both strings: lower-case, strip thousands separators (`,` and thin spaces), map `bn`/`billion`/`b` and `m`/`mn`/`million` and `k`/`thousand` to nothing (the multiplier is a rendering choice), drop currency symbols and `%`.
- Extract digit groups (`\d+(\.\d+)?`) from the value. Every group must occur as a whole digit group in the normalised claim text.
- Empty value groups (a figure with no digits, "none") fail: a figure shows a number.

Examples that pass: `$4bn` vs "raised $4 billion"; `4,000` vs "about 4000 staff"; `94%` vs "94 percent of deposits". Fail: `$4.5bn` vs "$4 billion"; `2019` vs "in late twenty-nineteen" (the planner must cite a claim that carries the digits).

## 5. Rendering, preview and materialisation

### 5.1 Layout

`packages/compositions/src/lib/graphic.ts`, exported as `@boom-busters/compositions/graphic`:

```ts
export interface GraphicFrame { width: number; height: number; portrait: boolean }
export interface ElementBox { id: string; x: number; y: number; w: number; h: number; fontPx?: number }
export interface Box { x: number; y: number; w: number; h: number }
export function safeArea(frame: GraphicFrame): Box                 // clear of the caption band
export function graphicLayout(scene: GraphicScene, frame: GraphicFrame, brand: BrandKitTokens): ElementBox[]
export function reflowPortrait(scene: GraphicScene): GraphicScene  // elements without portraitCell → one column, reading order
```

- The safe area is the frame minus the caption band (`height * 0.08` landscape, `0.16` portrait, as `HeadlineCard`) and a margin of `36 * frameScale`.
- A cell is `safe.w / 12` by `safe.h / 12`. Boxes are cells; gutters are `8 * frameScale`.
- Text and figure sizes start from the type role (`typeStyle`) and shrink with `fitText` from `@remotion/layout-utils` (new dependency in the compositions package, per the vendored Remotion skill's `measuring-text`) until the string fits its box width. The fitted size is returned in `fontPx` so the SVG preview and the component draw the same glyph size.
- Reading order for portrait re-flow: by `row`, then `col`.

### 5.2 `GraphicCard`

`packages/compositions/src/components/GraphicCard.tsx`, dispatched from `DocumentaryMaster` on `payload.kind === 'graphic'`; `ShortVertical` inherits it.

- Background: `colors.background` with the lit radial surface the headline card uses.
- Each element enters at `enter.atMs` (clamped to the slot) with `interpolate` and `Easing.bezier(0.16, 1, 0.3, 1)`: `fade` is opacity; `rise` adds a `24 * scale` px translate; `wipe` clips from the start edge; `count` tweens the digits of a figure from 0 to the value while keeping every non-digit character in place (`"$4bn"` counts `0` to `4`), landing on the exact string.
- `pulse` is one scale beat to 1.04 and back at `atMs + 600`; `underline` is the highlighter sweep from `HeadlineCard`, generalised into `lib/motion.ts` as `markerSweep`.
- `logo` draws `<Img>` with `objectFit: 'contain'` inside its box, never recoloured, never stretched, capped at the box's height.
- `bars` lays proportional blocks horizontally, longest to the box width, each with its `display` written at the end in the `numbers` role, the `highlightIndex` bar in the element's colour and the rest in `textSecondary` at 0.5 alpha; the bars grow on `enter` over 700 ms.
- Studio fixture with a three-element scene and a logo from `staticFile`; a snapshot golden in `src/snapshot/`.

### 5.3 Compile and materialise

- `CompileSlot` gains `graphic?: { scene: GraphicScene; logos: Record<string, { r2Key; width; height }>; claimIds: string[] }`. `resolveMotion` returns `static` for a graphic; elements animate internally.
- `assembly.ts` builds it: it loads every cited logo asset by id; a `logo` element without `assetId` skips the slot with "a logo for `<entity>` has not been uploaded", the same surface as a headline whose article is unreadable.
- `resolveSlotBrief` case `graphic`: `resolved` when every logo element has an asset, else `placeholder`. Nothing is fetched, nothing is spent.
- `materialiseForPreview` walks `payload.logos` and resolves each `r2Key` to a URL; the broker's materialiser (infra) does the same. A logo that fails to resolve drops the slot from the preview like a still would.

### 5.4 Board preview

`GraphicPreview` in `slot-previews.tsx` draws the resting frame (every element at its final state) in SVG from `graphicLayout` at 480 by 270, portrait 270 by 480 when the board is showing the short. A `logo` element without an asset draws a dashed box labelled "logo: Stability AI (upload)". A scene that fails `GraphicSceneSchema` renders `ChartErrorCard`'s sibling, `GraphicErrorCard`, never a graphic.

## 6. Logo library

### 6.1 Storage

`packages/db/src/logos.ts`:

```ts
listLogos(db): AssetRow[]                                   // kind 'logo', title asc
insertLogo(db, { r2Key, contentHash, title, width, height, sourceUrl? }): AssetRow   // upsert on contentHash, title wins
renameLogo(db, id, title)
removeLogo(db, id)                                          // refuses while brand.look.logoR2Key points at it
findLogoByName(db, name): AssetRow | null                   // nameMatches on title
```

Rows: `kind: 'logo'`, `licence: 'Uploaded by owner'`, `title` the entity name as the dossier writes it, `sourceUrl` when pasted from an address. Storage key `logoKey({ contentHash, ext })` under `boom-busters/logos/`.

### 6.2 Formats and safety

Stored logos are always **PNG** (or the WebP or JPEG the owner uploaded). Accepted at the door: PNG, WebP, JPEG, SVG and AVIF. SVG and AVIF are converted to PNG before storage: a picked file in the browser (`toUploadableLogo`, drawing the SVG through an `Image` onto a canvas at 2048 px on the long edge, transparency kept) and a pasted address on the server (`fetchRemoteLogo`, sharp rendering the SVG at the same size). A vector mark loses nothing visible at 2048 px against a 1080p frame, and the render's Chromium never executes anything an upload contained, which is the whole of the safety argument; there is no sanitiser to get wrong. JPEG is accepted but the tab warns that the mark has no transparency. 4 MB cap. *(Amended while writing Plan A: the original text specified an SVG sanitiser; rasterising is smaller and closes the hole completely.)*

### 6.3 Settings: Logos tab

Beside Music in Settings. A grid of marks on the brand `background`, each with its name, `Rename`, `Remove`, and `Use as channel mark`, which writes `look.logoR2Key` and shows a check on the chosen one. Upload by file (`accept="image/png,image/svg+xml,image/webp,image/avif,.avif"`) or by pasting an image address, with a required name field (pre-filled from the file name, title-cased). Button-first, no drag and drop as the only path.

### 6.4 On the board

A graphic card whose scene has a `logo` element without an asset shows `Add logo for Stability AI`, which opens the same uploader inline with the name fixed to the entity; on success the slot is re-resolved (`resolveSlotBrief`) and turns `resolved` without a model call.

### 6.5 Watermark

`Watermark` renders `<Img>` of the materialised channel mark when `look.logoR2Key` is set, at `captions` height times 1.6, 0.6 alpha, in the chosen corner; the typographic wordmark remains the fallback when the key is null or fails to materialise. The brand snapshot in the timeline carries the key; `materialiseForPreview` and the broker resolve it as `brand.look.logoUrl`.

## 7. Board card

Type badge `Graphic`. Body: the SVG preview, then the source-claim chips (the chart card's component, over `claimIds`), then the `Brief` line. Buttons: `Edit brief` (visual description only, as for charts), `Draft a different brief` with steer, the format picker with `Graphic` as a model-drafted target (toast "Drafting the graphic"), and `Add logo for …` when owed. No candidate strip. Status `resolved` or `placeholder` with the reason on the row; the plan checkpoint's price line counts a graphic at $0.00.

## 8. Cost

Nothing is fetched or generated for a graphic; the only spend is the planner's longer output, which the existing shot-list cost estimate already covers by token count. No new ledger kind.

## 9. Tests

- Schema: hex colour refused; seventh element refused; `count` on text refused; duplicate ids refused; two logos for one entity refused.
- `figureCitesClaim`: the examples in 4.3, plus "no digits" failing.
- `resolvePlannedBrief`: claim numbers mapped; a bad number rejected in words; entity found and stored; entity missing leaves the element without `assetId` and does not reject.
- Layout: golden boxes for a three-element scene at 1920 by 1080 and 1080 by 1920; re-flow when `portraitCell` is absent; fitted `fontPx` never exceeds the role's size and the measured text never exceeds its box.
- Compositions: Studio fixture; snapshot golden; `count` lands on the exact string at the end.
- Compile and assembly: a graphic payload embeds the scene and its logos; a missing logo skips the slot with the reason.
- Materialiser: logo keys resolved; an unresolvable one drops the slot.
- `resolveSlotBrief`: resolved with every logo, placeholder without.
- Prompt: the mock shot list emits one graphic; a golden request includes the graphic shape.
- Logos: `insertLogo` upserts on hash and the title wins; `removeLogo` refuses the channel mark; `findLogoByName` matches "Stability AI" to "Stability AI Ltd" through `nameMatches` and not "AI".
- Rasterising: a pasted SVG comes back as PNG bytes with alpha at 2048 px on the long edge; a picked SVG goes through the browser rasteriser seam to a PNG `File`; an SVG that will not render is refused in words.
- Settings tab: upload, rename, use as mark, remove-refused message.
- e2e: Logos tab round trip in mock storage; a graphic card on the plan checkpoint with the `Add logo` button and, after an upload, the `resolved` state.
- Every added line free of em and en dashes.

## 10. Migration and rollout

Migration 0027 adds `graphic` to `shot_slot_type`. Existing rows are untouched; the planner starts emitting graphics on the next plan. The Logos tab works with zero marks. Deploy needs the Remotion site re-uploaded (`deploy:remotion`, the owner's script) for rendered video to carry `GraphicCard`; the board preview ships with the Vercel deploy.

### 10.1 Implementation order

Two plans, in sequence. **Plan A, the logo library**: sections 6.1 to 6.3, 6.5 and 3.3a, with their tests. It stands on its own (a channel mark in the watermark is a visible result) and everything Plan B resolves a logo through (`findLogoByName`, `listLogos`, `logoKey`) exists when B starts. **Plan B, the graphic slot**: sections 3.1 to 3.4, 4, 5, 6.4 and 7. Each plan gets its own branch, review and deploy.

## 11. Out of scope, recorded

- An element-level editor on the board (v2, after real films show what needs moving).
- An "art director" second model pass over layout.
- `image` elements pulling a still or stock frame into a graphic.
- Applying `figureCitesClaim` to existing chart briefs.
- Per-project logo scoping; the library is channel-wide by design.
