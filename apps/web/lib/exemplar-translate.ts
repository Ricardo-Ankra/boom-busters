import { createHash } from 'node:crypto'
import { MANIFEST, vendoredPath } from '@boom-busters/providers'
import type {
  ExemplarDesign,
  ExemplarEntry,
  GraphicDesignInput,
  ScriptClaim,
  Technique,
} from '@boom-busters/providers'
import { DEFAULT_SETTINGS } from '@boom-busters/schemas'
import type { ChartBrief, DesignableBrief, GraphicBrief } from '@boom-busters/schemas'
import type { GraphicDesignContext } from '@/lib/graphic-design-core'
import { optionalText, readRawFlags } from '@/lib/live-set-args'

/**
 * The exemplar translation's pure parts (decision 304): the hash that pins a
 * design to its vendored template, the design and registry files, the
 * synthetic context and brief the translation and the corpus test share,
 * the designer input with the steer, and the script's arguments. No file,
 * network or env access here; `scripts/translate-exemplars.ts` does the
 * reading, the calls and the writing.
 */

export const TRANSLATE_STEER =
  'Translate this Remotion template into the sandbox, keeping its technique and its timing idea; ' +
  'the words and figures come from the slot; every curve, length and spring from the tokens. ' +
  'Write it as function Graphic(props) with helpers beside it, colours from props.brand.colors, ' +
  'type from props.brand.fonts, and nothing imported:'

export const EXEMPLAR_PROJECT_ID = '01J00000000000000000000EXP'
export const EXEMPLAR_LOGO = {
  id: '01J00000000000000000000EX1',
  title: 'Acme',
  width: 1200,
  height: 400,
}
const CAP_ABOVE_FIVE = "A cap above $5 needs the owner's approval first."

/** SHA-256 of the text with CRLF folded to LF, so Windows and Linux checkouts agree. */
export function vendoredHash(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex')
}

export function designHeader(entry: ExemplarEntry, hash: string): string {
  return (
    `// Exemplar "${entry.id}" (decision 304), translated from ${vendoredPath(entry)}\n` +
    `// vendored sha256: ${hash}\n` +
    '// Written by apps/web/scripts/translate-exemplars.ts; a passing design under graphicCodeIssue.'
  )
}

/** The design file: the header, then the design with its source as a JSON string (backticks and ${ stay literal). */
export function renderDesignFile(
  entry: ExemplarEntry,
  hash: string,
  design: ExemplarDesign,
): string {
  return (
    `${designHeader(entry, hash)}\n` +
    `import type { ExemplarDesign } from './index'\n\n` +
    `export const DESIGN: ExemplarDesign = {\n` +
    `  title: ${JSON.stringify(design.title)},\n` +
    `  source: ${JSON.stringify(design.source)},\n` +
    `  facts: ${JSON.stringify(design.facts)},\n` +
    `}\n`
  )
}

/** The hash a design file's header records, or null when the file has none. */
export function storedHash(designFile: string): string | null {
  return /^\/\/ vendored sha256: ([0-9a-f]{64})$/m.exec(designFile)?.[1] ?? null
}

/** A sentence when the stored design was written from a different vendored text; null otherwise. */
export function staleDesign(
  entry: ExemplarEntry,
  vendoredText: string,
  designFile: string | undefined,
): string | null {
  if (designFile === undefined) return null
  if (storedHash(designFile) === vendoredHash(vendoredText)) return null
  return `${entry.id}: ${vendoredPath(entry)} changed since its design was written`
}

/** A ULID-shaped id for the n-th derived claim. */
const claimId = (n: number) => `01J${String(n).padStart(23, '0')}`

/**
 * The context the translation and the corpus test share: one claim per
 * figure the slot speaks ("The figure is 1.2bn.") and per charted point
 * ("In 2022 the value was 4 bn."), one placeholder logo, no paragraphs.
 */
export function exemplarContext(entry: ExemplarEntry): GraphicDesignContext {
  const texts: string[] = []
  for (const word of entry.slot.words) {
    const figure = word.text.replace(/^[^\d$€£]+|[^\w%]+$/g, '')
    if (/\d/.test(figure)) texts.push(`The figure is ${figure}.`)
  }
  for (const series of entry.slot.data?.series ?? []) {
    for (const point of series.points) {
      texts.push(`In ${point.x} the value was ${point.y} ${series.unit}.`)
    }
  }
  const claims: ScriptClaim[] = [...new Set(texts)].map((text, index) => ({
    id: claimId(index + 1),
    text,
    sourceUrl: null,
    confidence: 'high',
  }))
  return {
    projectId: EXEMPLAR_PROJECT_ID,
    caseTitle: 'Exemplar',
    claims,
    logos: [EXEMPLAR_LOGO],
    paragraphs: [],
    chapterTitle: entry.technique,
  }
}

/** The brief the checks are run against: a chart brief for a chart technique, a graphic brief otherwise. */
export function exemplarBrief(
  entry: ExemplarEntry,
  context: GraphicDesignContext,
): DesignableBrief {
  const coversText = entry.slot.words.map((word) => word.text).join(' ')
  const claimIds = context.claims.map((claim) => claim.id)
  if (entry.chart && entry.slot.data) {
    const chart: ChartBrief = {
      type: 'chart',
      coversText,
      description: entry.description,
      motion: { kind: 'static' },
      transition: 'cut',
      chartKind: entry.chart.kind,
      series: entry.slot.data.series,
      dataRefs: claimIds,
      takeaway: entry.slot.data.takeaway,
      reveal: 'draw-on',
      ...(entry.slot.data.annotations ? { annotations: entry.slot.data.annotations } : {}),
    }
    return chart
  }
  const graphic: GraphicBrief = {
    type: 'graphic',
    coversText,
    description: entry.description,
    motion: { kind: 'static' },
    transition: 'cut',
    intent: entry.slot.intent,
    intentClaimIds: claimIds,
  }
  return graphic
}

/** The designer's input for a translation: the synthetic slot, the steer with the template, and no exemplar. */
export function exemplarInput(entry: ExemplarEntry, vendoredText: string): GraphicDesignInput {
  const context = exemplarContext(entry)
  const coversText = entry.slot.words.map((word) => word.text).join(' ')
  return {
    caseTitle: context.caseTitle,
    claims: context.claims,
    logos: context.logos.map((logo) => logo.title),
    chapterTitle: context.chapterTitle,
    coversText,
    paragraphText: coversText,
    durationMs: entry.slot.durationMs,
    words: entry.slot.words.map((word) => ({ text: word.text, offsetMs: word.atMs })),
    wordsEstimated: false,
    intent: entry.slot.intent,
    intentRefs: context.claims.map((_, index) => index + 1),
    ...(entry.slot.data ? { data: entry.slot.data } : {}),
    guidance: `${TRANSLATE_STEER}\n\`\`\`\`tsx\n${vendoredText}\n\`\`\`\``,
  }
}

/** `designs/index.ts` for the given design ids, sorted, one import each. */
export function renderRegistry(ids: readonly string[]): string {
  const sorted = [...ids].sort()
  const camel = (id: string) => id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
  const header =
    "import type { Technique } from '../manifest'\n\n" +
    '/**\n' +
    ' * Every stored design, by technique. Generated by\n' +
    ' * `apps/web/scripts/translate-exemplars.ts`, which rewrites this file from\n' +
    ' * the `designs/*.ts` files present; the corpus test checks the two agree.\n' +
    ' */\n' +
    'export interface ExemplarDesign {\n  title: string\n  source: string\n  facts: { text: string; claim: number }[]\n}\n\n'
  if (sorted.length === 0) {
    return `${header}export const DESIGNS: Partial<Record<Technique, ExemplarDesign>> = {}\n`
  }
  const imports = sorted.map((id) => `import { DESIGN as ${camel(id)} } from './${id}'`).join('\n')
  const entries = sorted.map((id) => `  '${id}': ${camel(id)},`).join('\n')
  return (
    `${imports}\n${header}` +
    `export const DESIGNS: Partial<Record<Technique, ExemplarDesign>> = {\n${entries}\n}\n`
  )
}

export interface ExemplarArgs {
  cap: number
  only?: Technique
  model: string
}

export function parseExemplarArgs(argv: readonly string[]): ExemplarArgs {
  const raw = readRawFlags(argv)
  const capRaw = raw.cap
  let cap = 1
  if (capRaw !== undefined && capRaw.trim() !== '') {
    cap = Number(capRaw)
    if (!Number.isFinite(cap) || cap <= 0) {
      throw new Error(
        `--cap "${capRaw}" is not a valid dollar amount; give a number greater than 0.`,
      )
    }
    if (cap > 5) throw new Error(CAP_ABOVE_FIVE)
  }
  const only = optionalText(raw, 'only')
  if (only !== undefined && !MANIFEST.some((entry) => entry.id === only)) {
    throw new Error(`--only "${only}" is not a manifest id`)
  }
  const model = optionalText(raw, 'model') ?? DEFAULT_SETTINGS.modelRouting.graphics.model
  return { cap, model, ...(only !== undefined ? { only: only as Technique } : {}) }
}
