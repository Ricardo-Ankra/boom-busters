import { z } from 'zod'
import { UlidSchema } from './ids'

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
export const MAX_GRAPHIC_ELEMENTS = 6

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
export const GraphicEnterSchema = z.object({
  kind: z.enum(GRAPHIC_ENTERS),
  /** Offset from the slot's start. The layout clamps it inside the slot. */
  atMs: z.number().int().min(0).max(8000).default(0),
})
export type GraphicEnter = z.infer<typeof GraphicEnterSchema>

const elementCommon = {
  id: z.string().min(1).max(40),
  cell: GraphicCellSchema,
  /** Absent means "re-flow me in reading order into one column on 9:16". */
  portraitCell: GraphicCellSchema.optional(),
  enter: GraphicEnterSchema.default({ kind: 'fade', atMs: 0 }),
  emphasis: z.enum(['pulse', 'underline']).optional(),
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

/** The rules no field type can carry: one count per figure, unique ids, one logo per entity. */
function sceneRules(
  scene: {
    elements: readonly { kind: string; id: string; enter: { kind: string }; entity?: string }[]
  },
  ctx: z.RefinementCtx,
): void {
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
  })
}

export const GraphicSceneSchema = z
  .object({ elements: z.array(GraphicElementSchema).min(1).max(MAX_GRAPHIC_ELEMENTS) })
  .superRefine(sceneRules)
export type GraphicScene = z.infer<typeof GraphicSceneSchema>

export const PlannedGraphicSceneSchema = z
  .object({ elements: z.array(PlannedGraphicElementSchema).min(1).max(MAX_GRAPHIC_ELEMENTS) })
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
