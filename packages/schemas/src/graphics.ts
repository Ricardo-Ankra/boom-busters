import { z } from 'zod'
import { UlidSchema } from './ids'
import { GRAPHIC_MAX_ON_SCREEN, maxOnScreen } from './graphic-timing'

export * from './graphic-timing'

/**
 * The scene graph a graphic slot is made of (decision 268, Plan B).
 *
 * A graphic is composed, not chosen from a catalogue: a fixed vocabulary of
 * elements placed in the cells of a coarse grid, styled only by the NAMES of
 * brand tokens, with every number cited to a dossier claim and every logo
 * drawn from the library. The constraints that keep the channel's graphics
 * safe and consistent live here, in the schema, rather than in templates.
 *
 * The planner writes claim NUMBERS and entity NAMES (`Planned*`); resolution
 * maps them to claim ids and library asset ids (the stored `Graphic*` shapes).
 */

export const GRAPHIC_GRID = 12
/** Across the whole slot (decision 290); no more than `GRAPHIC_MAX_ON_SCREEN` at once. */
export const MAX_GRAPHIC_ELEMENTS = 10

/** Colour names a scene may use. The three series colours are enough; a longer palette is confetti. */
export const GRAPHIC_COLORS = [
  'primary',
  'accent',
  'background',
  'surface',
  'textPrimary',
  'textSecondary',
  'captionHighlight',
  'collapse',
  'recovery',
  'series0',
  'series1',
  'series2',
] as const
export const GraphicColorSchema = z.enum(GRAPHIC_COLORS)
export type GraphicColor = z.infer<typeof GraphicColorSchema>

export const GRAPHIC_TYPE_ROLES = ['heading', 'title', 'body', 'numbers', 'captions'] as const
export const GraphicTypeRoleSchema = z.enum(GRAPHIC_TYPE_ROLES)
export type GraphicTypeRole = z.infer<typeof GraphicTypeRoleSchema>

/** A rectangle of grid cells. The refinement keeps it on the grid. */
export const GraphicCellSchema = z
  .object({
    col: z
      .number()
      .int()
      .min(0)
      .max(GRAPHIC_GRID - 1),
    row: z
      .number()
      .int()
      .min(0)
      .max(GRAPHIC_GRID - 1),
    colSpan: z.number().int().min(1).max(GRAPHIC_GRID),
    rowSpan: z.number().int().min(1).max(GRAPHIC_GRID),
  })
  .refine((c) => c.col + c.colSpan <= GRAPHIC_GRID && c.row + c.rowSpan <= GRAPHIC_GRID, {
    message: 'a cell must stay on the 12 by 12 grid',
  })
export type GraphicCell = z.infer<typeof GraphicCellSchema>

export const GRAPHIC_ENTERS = ['fade', 'rise', 'wipe', 'count'] as const
/**
 * The widest an entrance offset may be. Graphic slots run up to 22 s and the
 * designer times entrances to the spoken words, so this is only a sanity
 * bound: `lateEntranceIssue` (slot length less one entrance) is the real one.
 */
export const GRAPHIC_MAX_ENTER_MS = 60_000
export const GraphicEnterSchema = z.object({
  kind: z.enum(GRAPHIC_ENTERS),
  /** Offset from the slot's start. The designer is held to `lateEntranceIssue`. */
  atMs: z.number().int().min(0).max(GRAPHIC_MAX_ENTER_MS).default(0),
})
export type GraphicEnter = z.infer<typeof GraphicEnterSchema>

/** Any later time inside a graphic: an offset from the slot's start, bounded like an entrance. */
const GraphicTimeSchema = z.number().int().min(0).max(GRAPHIC_MAX_ENTER_MS)

export const GRAPHIC_EXITS = ['fade', 'drop', 'wipe'] as const
/** Leaving the frame (decision 290); an exit takes `GRAPHIC_EXIT_MS`. */
export const GraphicExitSchema = z.object({
  kind: z.enum(GRAPHIC_EXITS),
  atMs: GraphicTimeSchema,
})
export type GraphicExit = z.infer<typeof GraphicExitSchema>

export const GRAPHIC_EMPHASES = ['pulse', 'underline', 'color'] as const
/**
 * An emphasis at a time the designer chooses (decision 290). `color` shifts
 * the element to the token `to` names and keeps it there.
 */
export const GraphicTimedEmphasisSchema = z.object({
  kind: z.enum(GRAPHIC_EMPHASES),
  atMs: GraphicTimeSchema,
  to: GraphicColorSchema.optional(),
})
/** The word forms fire just after the entrance, as in stage 1; the object form at its own time. */
export const GraphicEmphasisSchema = z.union([
  z.enum(['pulse', 'underline']),
  GraphicTimedEmphasisSchema,
])
export type GraphicEmphasis = z.infer<typeof GraphicEmphasisSchema>

export const GRAPHIC_MAX_ZOOM = 1.6
export const MAX_CAMERA_KEYS = 4
/**
 * A camera key (decision 290): from `atMs` the camera moves, over
 * `GRAPHIC_CAMERA_MOVE_MS`, to frame `focus` (an element id, or 'all') at
 * `zoom`, and holds there until the next key.
 */
export const GraphicCameraKeySchema = z.object({
  atMs: GraphicTimeSchema,
  focus: z.string().min(1).max(40),
  zoom: z.number().min(1).max(GRAPHIC_MAX_ZOOM).default(1),
})
export type GraphicCameraKey = z.infer<typeof GraphicCameraKeySchema>

const elementCommon = {
  id: z.string().min(1).max(40),
  cell: GraphicCellSchema,
  /** Absent means "re-flow me in reading order into one column on 9:16". */
  portraitCell: GraphicCellSchema.optional(),
  enter: GraphicEnterSchema.default({ kind: 'fade', atMs: 0 }),
  /** Absent: the element stays to the end of the slot (decision 290). */
  exit: GraphicExitSchema.optional(),
  emphasis: GraphicEmphasisSchema.optional(),
}

const TextElementSchema = z.object({
  kind: z.literal('text'),
  ...elementCommon,
  content: z.string().min(1).max(120),
  role: GraphicTypeRoleSchema,
  color: GraphicColorSchema,
  align: z.enum(['start', 'center', 'end']).default('start'),
})

const figureFields = {
  kind: z.literal('figure'),
  ...elementCommon,
  /** Exactly what is shown: "$4bn", "94%", "1,200 staff". */
  value: z.string().min(1).max(24),
  label: z.string().min(1).max(60).optional(),
  color: GraphicColorSchema,
  /** Where the value and its caption sit in the box; the caption follows the value. */
  align: z.enum(['start', 'center', 'end']).default('start'),
}

const logoFields = {
  kind: z.literal('logo'),
  ...elementCommon,
  /** The company or person, as the dossier names them: the join to the library. */
  entity: z.string().min(1).max(80),
}

const ShapeElementSchema = z.object({
  kind: z.literal('shape'),
  ...elementCommon,
  form: z.enum(['rect', 'rule', 'disc']),
  color: GraphicColorSchema,
  opacity: z.number().min(0.05).max(1).default(1),
})

const barItemFields = {
  label: z.string().min(1).max(40),
  value: z.number().finite(),
  /** What is written at the end of the bar. */
  display: z.string().min(1).max(24),
  /** When this bar grows in, with its label and value; absent: with its element (decision 290). */
  atMs: GraphicTimeSchema.optional(),
}

const barsFields = {
  kind: z.literal('bars'),
  ...elementCommon,
  color: GraphicColorSchema,
  highlightIndex: z.number().int().min(0).max(4).optional(),
}

/** Stored form: claim ids, and a logo that may already carry its library asset. */
export const GraphicElementSchema = z.discriminatedUnion('kind', [
  TextElementSchema,
  z.object({ ...figureFields, claimRef: UlidSchema }),
  z.object({ ...logoFields, assetId: UlidSchema.optional() }),
  ShapeElementSchema,
  z.object({
    ...barsFields,
    items: z
      .array(z.object({ ...barItemFields, claimRef: UlidSchema }))
      .min(2)
      .max(5),
  }),
])
export type GraphicElement = z.infer<typeof GraphicElementSchema>

/** Planned form: claim NUMBERS into the prompt's list, and no asset ids. */
export const PlannedGraphicElementSchema = z.discriminatedUnion('kind', [
  TextElementSchema,
  z.object({ ...figureFields, claimRef: z.number().int().min(1) }),
  z.object(logoFields),
  ShapeElementSchema,
  z.object({
    ...barsFields,
    items: z
      .array(z.object({ ...barItemFields, claimRef: z.number().int().min(1) }))
      .min(2)
      .max(5),
  }),
])

function normaliseEntity(entity: string): string {
  return entity.trim().replace(/\s+/g, ' ').toLowerCase()
}

interface RuleScene {
  elements: readonly {
    kind: string
    id: string
    enter: { kind: string; atMs: number }
    entity?: string
    exit?: { atMs: number }
    emphasis?: GraphicEmphasis
  }[]
  camera?: readonly { atMs: number; focus: string }[]
}

/**
 * The rules no field type can carry: one count per figure, unique ids, one
 * logo per entity, the timed emphasis's own rules, a camera that looks at an
 * element of this scene, and no more than six on screen at once (decision
 * 290). The timing rules that need the slot's length are `sceneTimingIssue`.
 */
function sceneRules(scene: RuleScene, ctx: z.RefinementCtx): void {
  const ids = new Set<string>()
  const entities = new Set<string>()
  scene.elements.forEach((element, index) => {
    if (element.enter.kind === 'count' && element.kind !== 'figure') {
      ctx.addIssue({
        code: 'custom',
        path: ['elements', index, 'enter'],
        message: 'only a figure can count',
      })
    }
    if (ids.has(element.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['elements', index, 'id'],
        message: `duplicate element id "${element.id}"`,
      })
    }
    ids.add(element.id)
    if (element.kind === 'logo' && element.entity !== undefined) {
      const key = normaliseEntity(element.entity)
      if (entities.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['elements', index, 'entity'],
          message: 'one logo per entity',
        })
      }
      entities.add(key)
    }
    const emphasis = element.emphasis
    if (emphasis !== undefined && typeof emphasis !== 'string') {
      const path = ['elements', index, 'emphasis']
      if (emphasis.kind === 'color' && emphasis.to === undefined) {
        ctx.addIssue({
          code: 'custom',
          path,
          message: 'a colour emphasis names the colour it shifts "to"',
        })
      }
      if (emphasis.kind !== 'color' && emphasis.to !== undefined) {
        ctx.addIssue({ code: 'custom', path, message: '"to" belongs only to a colour emphasis' })
      }
      if (emphasis.kind === 'color' && element.kind === 'logo') {
        ctx.addIssue({ code: 'custom', path, message: 'a logo is never recoloured' })
      }
      if (emphasis.kind === 'underline' && element.kind !== 'text' && element.kind !== 'figure') {
        ctx.addIssue({ code: 'custom', path, message: 'only a text or a figure can be underlined' })
      }
    }
  })
  ;(scene.camera ?? []).forEach((key, index) => {
    if (key.focus !== 'all' && !ids.has(key.focus)) {
      ctx.addIssue({
        code: 'custom',
        path: ['camera', index, 'focus'],
        message: `camera key ${index + 1} focuses "${key.focus}", which is not an element of this graphic`,
      })
    }
  })
  const crowd = maxOnScreen(scene)
  if (crowd.count > GRAPHIC_MAX_ON_SCREEN) {
    ctx.addIssue({
      code: 'custom',
      path: ['elements'],
      message: `${crowd.count} elements are on screen together at ${crowd.atMs} ms; at most ${GRAPHIC_MAX_ON_SCREEN} may be`,
    })
  }
}

export const GraphicSceneSchema = z
  .object({
    elements: z.array(GraphicElementSchema).min(1).max(MAX_GRAPHIC_ELEMENTS),
    /** Absent: the stage 1 drift alone (decision 290). */
    camera: z.array(GraphicCameraKeySchema).max(MAX_CAMERA_KEYS).optional(),
  })
  .superRefine(sceneRules)
export type GraphicScene = z.infer<typeof GraphicSceneSchema>

export const PlannedGraphicSceneSchema = z
  .object({
    elements: z.array(PlannedGraphicElementSchema).min(1).max(MAX_GRAPHIC_ELEMENTS),
    camera: z.array(GraphicCameraKeySchema).max(MAX_CAMERA_KEYS).optional(),
  })
  .superRefine(sceneRules)
export type PlannedGraphicScene = z.infer<typeof PlannedGraphicSceneSchema>

/**
 * The digit groups a shown value carries, with thousands separators removed:
 * "$4.5bn" is ["4.5"], "1,200 staff, 3 sites" is ["1200", "3"].
 */
export function figureDigitGroups(value: string): string[] {
  const stripped = value.replace(/(\d),(?=\d{3}(\D|$))/g, '$1')
  return stripped.match(/\d+(?:\.\d+)?/g) ?? []
}

/**
 * Whether every digit group the figure shows occurs, as a whole group, in
 * the cited claim's text. The multiplier ("bn", "billion", "%") is a
 * rendering choice and is not compared; the digits are the fact. A figure
 * with no digits cites nothing.
 */
export function figureCitesClaim(value: string, claimText: string): boolean {
  const shown = figureDigitGroups(value)
  if (shown.length === 0) return false
  const inClaim = new Set(figureDigitGroups(claimText))
  return shown.every((group) => inClaim.has(group))
}
