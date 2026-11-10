import {
  CRITIC_AXES,
  CRITIC_BAR,
  CRITIC_DEFECTS_MAX,
  CRITIC_FIX_MAX,
  CRITIC_FIXES_MAX,
  CRITIC_LINE_MAX,
  CriticReportSchema,
  CriticVerifySchema,
  MECHANISM_KEYS,
  PairwiseAnswerSchema,
  MECHANISMS,
  MECHANISMS_PER_DESIGN_MAX,
  ValidationError,
  mechanismName,
} from '@boom-busters/schemas'
import type {
  CriticAxis,
  CriticReport,
  CriticVerify,
  Mechanism,
  PairwiseAnswer,
  MotionIdentity,
  MotionMetrics,
  ReferencePurpose,
} from '@boom-busters/schemas'
import { z } from 'zod'
import { outputBudget, type LLMTaskRequest, type MsgImage } from '../llm/types'
import { motionIdentityBlock, type ReviewFrame } from './graphics'
import { formatIssues, parseJsonCompletion } from './json'
import { capList, dropItems, ignoreRepairs, trimField, type Note } from './repair'

/**
 * The critic (spec 2026-11-04, section 10.4): a fresh prompt on its own
 * route, never the designer's, shown a rendered design through its moves
 * and asked to judge it. It is handed the plan (the slot's brief, as the
 * designer answered it), the measured motion as numbers, the browser's
 * findings, the channel's identity in words, at most two of the channel's
 * look references, the contact sheet of each orientation and the rest
 * frames. It answers a score on five axes, the defects, the three fixes
 * worth making, whether each named mechanism is on the frames, and keep.
 *
 * Three messages: the fixed head (the identity and the mechanisms list),
 * cached across a film's slots and a derivation's rounds; the per-design
 * material as text; and the images with the ask, last. The pairwise
 * question and the verify round (plan 4) extend the same input.
 */

export const CRITIC_OUTPUT_TOKENS = 1500
/**
 * The critic's room to think (decision 450). It judges five axes over the
 * contact sheets and rest frames, and Sonnet 5 thinks by default: on the
 * standard 4,000 tokens of headroom it spent all 5,500 thinking and wrote no
 * report. With the answer this makes 16,000, the designer's own ceiling,
 * which finishes inside the 300 s step. A ceiling, not a spend: the ledger
 * settles on the tokens produced, and the estimate still counts the answer.
 */
export const CRITIC_THINKING_TOKENS = 14_500
/** For the estimate shown before a call: the head, the material and five images. */
export const CRITIC_INPUT_TOKENS = 7000

export interface CriticReference {
  title: string
  purpose: ReferencePurpose
  carryOver: string
  image: MsgImage
}

/** The design as the designer answered it, claims by number. */
export interface CriticPlan {
  title: string
  concept?: string
  storyboard?: string[]
  facts: { text: string; claim: number }[]
  mechanisms?: Mechanism[]
}

export interface CriticInput {
  motion: MotionIdentity
  plan: CriticPlan
  slot: {
    durationMs: number
    intent: string
    words: readonly { text: string; offsetMs: number }[]
  }
  metrics: MotionMetrics | null
  findings: readonly string[]
  sheets: { landscape?: MsgImage; portrait?: MsgImage }
  frames: readonly ReviewFrame[]
  references: readonly CriticReference[]
  /**
   * A previous version's sheets (spec 9.2, step 4, from round two): shown
   * after the design's, with the pairwise question. The design under review
   * is A and the previous version B; the caller asks again with the order
   * swapped through `buildPairwiseRequest`.
   */
  previous?: { sheets: { landscape?: MsgImage; portrait?: MsgImage }; label: string }
  /** The verify ask (step 7): the prior report's defects marked one by one, and a verdict. */
  verify?: { prior: CriticReport; brief: string }
  /** The strong route (spec 12.2): the one verify call that ends a technique runs on `graphics`. */
  strong?: boolean
}

const PAIRWISE_SHAPE = `{"prefers": {"engagement": "A", "intent": "A", "composition": "B", "temporal": "same", "craft": "A"}}`
const PAIRWISE_ASK =
  'Then, on each of the five axes, which of the two you prefer: "A", "B" or "same". Add it to the same JSON as\n' +
  `"prefers": ${PAIRWISE_SHAPE.slice('{"prefers": '.length, -1)}`
const VERIFY_ASK =
  'Add to the same JSON "priorDefects": [{"index": 1, "state": "fixed"}], one entry per prior defect by its number, ' +
  '"state" one of "fixed", "partly" or "present"; and "verdict": "ready" when nothing worth a call remains, else "one-more-pass".'

const AXIS_LINES: Record<CriticAxis, string> = {
  engagement: 'does it hold the eye from the first half second and earn each next second',
  intent: "does a viewer take away the slot's one point, with nothing competing for it",
  composition:
    'hierarchy, reading order, the safe area, type that reads on a phone, one thing biggest',
  temporal:
    'the beats land on their words, nothing freezes, nothing happens all at once, the ending holds',
  craft:
    'easing, overshoot, blur and 3D as the identity allows; no banned move; the moves it names are there',
}

const SYSTEM = `You are the critic for a channel's motion graphics: a fresh judge, never the designer.
A design for one slot of a documentary was written as code, checked, and rendered; you are
shown it as pictures with the plan the designer wrote, the motion measured from its frames,
and what the browser found. Your report decides whether it is kept or sent back with fixes.

The channel's references, when shown, are grammar to learn from (how things enter, move and
leave; the density; the pacing), never content to copy: nothing from them is to appear in
the design.

Score the design on five axes, each 1 to 10, a bar of ${CRITIC_BAR}:
${CRITIC_AXES.map((axis) => `- ${axis}: ${AXIS_LINES[axis]}.`).join('\n')}
A score at or above ${CRITIC_BAR} means a viewer would notice nothing to fix on that axis.

Answer with JSON only, its keys in this order:
{"scores": {"engagement": {"score": 8, "line": "..."}, "intent": {"score": 8, "line": "..."}, "composition": {"score": 8, "line": "..."}, "temporal": {"score": 8, "line": "..."}, "craft": {"score": 8, "line": "..."}}, "defects": [{"atMs": 1350, "orientation": "landscape", "text": "..."}], "fixes": ["...", "...", "..."], "mechanisms": [{"key": "...", "present": true}], "keep": true}
- "scores": one line of at most ${CRITIC_LINE_MAX} characters per axis saying what earned the score.
- "defects": what is wrong, ranked worst first, each with the time in milliseconds on the slot's
  clock and the frame (landscape or portrait) it shows in; at most ${CRITIC_DEFECTS_MAX}. Use the
  browser's findings where they stand, and drop any the pictures do not bear out.
- "fixes": the changes worth a designer's call, in the order they are worth making, at most
  ${CRITIC_FIXES_MAX}, each one concrete change the designer can make from the words alone
  ("hold the final figure for the last second instead of fading it"). Empty when nothing is.
- "mechanisms": for each mechanism the plan names, whether the frames show it.
- "keep": true only when no fix is worth a designer's call, whatever the scores say.`

const MECHANISMS_LIST = `The mechanisms a design may name, with what each means:
${MECHANISMS.map((m) => `- ${mechanismName(m.key)}: ${m.definition}.`).join('\n')}`

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

function metricsLines(metrics: MotionMetrics | null, stillMaxMs: number): string {
  if (metrics === null) return 'No motion was measured.'
  const profile = metrics.speedProfile
    .map((point) => `${seconds(point.atMs)} ${Math.round(point.change)}`)
    .join(', ')
  return [
    `Measured motion, from the 16:9 frames compared neighbour to neighbour (change is the mean grey difference per pixel, 0 to 255):`,
    `- Longest frozen run ${metrics.longestFrozenMs} ms (limit ${stillMaxMs} ms)${metrics.frozenCritical ? ', past the limit' : ''}; frozen in total ${metrics.frozenMs} ms.`,
    `- ${Math.round(metrics.simultaneity * 100)}% of the change inside one 250 ms window.`,
    `- The ending holds ${metrics.holdAfterLastMs} ms after the last change.`,
    `- Change per shot: ${profile || 'none'}.`,
  ].join('\n')
}

function findingsLines(findings: readonly string[]): string {
  if (findings.length === 0) return 'The browser found nothing wrong at rest or in flight.'
  return `What the browser found, at rest, in flight and in contrast:\n${findings
    .map((finding, index) => `${index + 1}. ${finding}`)
    .join('\n')}`
}

export function buildCriticRequest(input: CriticInput): LLMTaskRequest {
  const head = `${motionIdentityBlock(input.motion).trim()}\n\n${MECHANISMS_LIST}`
  const words = input.slot.words
    .map((word) => `${seconds(word.offsetMs)} "${word.text}"`)
    .join(', ')
  const material = [
    `The slot: ${seconds(input.slot.durationMs)} long. Intent: ${input.slot.intent}`,
    `The words, on the slot's clock: ${words || 'none'}.`,
    `The plan, as the designer answered it (claims by number):\n\`\`\`\`json\n${JSON.stringify(input.plan, null, 2)}\n\`\`\`\``,
    metricsLines(input.metrics, input.motion.stillMaxMs),
    findingsLines(input.findings),
  ].join('\n\n')

  const images: MsgImage[] = []
  const labels: string[] = []
  input.references.forEach((reference, index) => {
    images.push(reference.image)
    labels.push(
      `Reference ${index + 1}: ${reference.title} (${reference.purpose}): ${reference.carryOver}`,
    )
  })
  for (const [orientation, label] of [
    ['landscape', '16:9'],
    ['portrait', '9:16'],
  ] as const) {
    const sheet = input.sheets[orientation]
    if (!sheet) continue
    images.push(sheet)
    labels.push(
      `Contact sheet ${label}: the design through its moves, in time order, a timecode under each tile`,
    )
  }
  input.frames.forEach((frame, index) => {
    images.push(frame.image)
    labels.push(`Frame ${index + 1}: ${frame.label}, at rest`)
  })
  if (input.previous) {
    for (const [orientation, label] of [
      ['landscape', '16:9'],
      ['portrait', '9:16'],
    ] as const) {
      const sheet = input.previous.sheets[orientation]
      if (!sheet) continue
      images.push(sheet)
      labels.push(`Previous version (B), ${label}: ${input.previous.label}, its contact sheet`)
    }
  }
  const extra = [
    input.previous
      ? `A previous version is shown last: the design under review is A, the previous version B. ${PAIRWISE_ASK}`
      : '',
    input.verify ? verifyLines(input.verify) : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  const ask =
    `The pictures, in this order:\n${labels.join('\n')}\n` +
    'Logos are drawn as empty boxes; the film shows the marks.\n\n' +
    'Judge the design as a viewer would, against its plan and the channel’s motion, and answer the report.' +
    (extra ? `\n\n${extra}` : '')
  return {
    task: input.strong ? 'graphics' : 'critic',
    system: SYSTEM,
    messages: [
      { role: 'user', content: head },
      { role: 'user', content: material },
      { role: 'user', content: ask, images },
    ],
    cacheablePrefixMessages: 1,
    maxTokens: outputBudget(CRITIC_OUTPUT_TOKENS, CRITIC_THINKING_TOKENS),
  }
}

function verifyLines(verify: NonNullable<CriticInput['verify']>): string {
  const defects = verify.prior.defects.map(
    (defect, index) =>
      `${index + 1}. at ${seconds(defect.atMs)} in ${defect.orientation}: ${defect.text}`,
  )
  return [
    `This is a verify round. ${verify.brief}`,
    defects.length > 0
      ? `The prior report's defects, by number:\n${defects.join('\n')}`
      : 'The prior report named no defect.',
    VERIFY_ASK,
  ].join('\n')
}

/**
 * The pairwise question alone (spec 9.2, step 4, the second ask with the
 * order swapped): the two versions' sheets and nothing else, so the swap
 * costs the sheets and not the whole review.
 */
export function buildPairwiseRequest(input: {
  motion: MotionIdentity
  plan: CriticPlan
  a: CriticInput['sheets']
  b: CriticInput['sheets']
}): LLMTaskRequest {
  const head = `${motionIdentityBlock(input.motion).trim()}\n\n${MECHANISMS_LIST}`
  const images: MsgImage[] = []
  const labels: string[] = []
  for (const [name, sheets] of [
    ['A', input.a],
    ['B', input.b],
  ] as const) {
    for (const [orientation, label] of [
      ['landscape', '16:9'],
      ['portrait', '9:16'],
    ] as const) {
      const sheet = sheets[orientation]
      if (!sheet) continue
      images.push(sheet)
      labels.push(`Version ${name}, ${label}: its contact sheet, the design through its moves`)
    }
  }
  const ask = [
    `Two versions of one design for the same plan, "${input.plan.title}"${input.plan.concept ? ` (${input.plan.concept})` : ''}.`,
    `The pictures, in this order:\n${labels.join('\n')}`,
    'On each of the five axes, which of the two you prefer: "A", "B" or "same".',
    `Answer with JSON only: ${PAIRWISE_SHAPE}`,
  ].join('\n\n')
  return {
    task: 'critic',
    system: SYSTEM,
    messages: [
      { role: 'user', content: head },
      { role: 'user', content: ask, images },
    ],
    cacheablePrefixMessages: 1,
    // Two designs' sheets to compare: the critic's room to think (decision 450).
    maxTokens: outputBudget(CRITIC_OUTPUT_TOKENS, CRITIC_THINKING_TOKENS),
  }
}

/** The verify report: the report's parser plus the two fields; absent, no defect is marked and the verdict asks one more pass. */
export function parseCriticVerify(text: string, note: Note = ignoreRepairs): CriticVerify {
  const report = parseCriticReport(text, note)
  const raw = parseJsonCompletion(text, z.looseObject({}), 'critic report')
  const parsed = CriticVerifySchema.safeParse({
    ...report,
    priorDefects: capList(raw['priorDefects'] ?? [], CRITIC_DEFECTS_MAX, 'the prior defects', note),
    verdict: raw['verdict'] ?? 'one-more-pass',
  })
  if (!parsed.success) {
    throw new ValidationError(`The verify report is malformed: ${formatIssues(parsed.error)}`, {
      field: 'critic report',
    })
  }
  return parsed.data
}

export function parsePairwise(text: string): PairwiseAnswer {
  return parseJsonCompletion(text, z.object({ prefers: PairwiseAnswerSchema }), 'pairwise answer')
    .prefers
}

/** Mock mode's verify: the mock report, every prior defect fixed, ready. */
export function mockCriticVerify(plan: CriticPlan, prior?: CriticReport): CriticVerify {
  return {
    ...mockCriticReport(plan),
    priorDefects: (prior?.defects ?? []).map((_, index) => ({ index: index + 1, state: 'fixed' })),
    verdict: 'ready',
  }
}

/** Mock mode's pairwise answer: no preference on any axis. */
export function mockPairwise(): PairwiseAnswer {
  return Object.fromEntries(CRITIC_AXES.map((axis) => [axis, 'same'])) as PairwiseAnswer
}

const isMechanism = (value: unknown): value is Mechanism =>
  typeof value === 'string' && (MECHANISM_KEYS as readonly string[]).includes(value)

const CriticDefectSchema = CriticReportSchema.shape.defects.element
const ORIENTATION_NAMES: Record<string, 'landscape' | 'portrait'> = {
  landscape: 'landscape',
  portrait: 'portrait',
  '16:9': 'landscape',
  '9:16': 'portrait',
}
const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null
const rounded = (value: unknown): unknown =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : value

/**
 * A defect as the model wrote it, read the way the pictures were labelled
 * (16:9 and 9:16 are the frame names), its time rounded and its text
 * trimmed; null when it cannot be placed at all (final review, issue 5).
 */
function defectOf(value: unknown, note: Note): unknown {
  const defect = asRecord(value)
  if (!defect) return null
  const orientation = typeof defect['orientation'] === 'string' ? defect['orientation'].trim() : ''
  const placed = {
    ...defect,
    atMs: rounded(defect['atMs']),
    orientation: ORIENTATION_NAMES[orientation] ?? orientation,
    text: trimField(defect['text'], CRITIC_LINE_MAX, 'a defect', note),
  }
  return CriticDefectSchema.safeParse(placed).success ? placed : null
}

/**
 * The critic's report, validated: lines trimmed to their limits, fixes and
 * defects capped, a mechanism not in the list dropped, each with a note.
 * Anything else the schema refuses is a malformed report, and the design
 * is kept unmarked.
 */
export function parseCriticReport(text: string, note: Note = ignoreRepairs): CriticReport {
  const raw = parseJsonCompletion(text, z.looseObject({}), 'critic report')
  const scores = raw['scores']
  const trimmedScores =
    scores && typeof scores === 'object'
      ? Object.fromEntries(
          Object.entries(scores as Record<string, unknown>).map(([axis, value]) => [
            axis,
            value && typeof value === 'object'
              ? {
                  ...(value as Record<string, unknown>),
                  line: trimField(
                    (value as Record<string, unknown>)['line'],
                    CRITIC_LINE_MAX,
                    `the ${axis} line`,
                    note,
                  ),
                }
              : value,
          ]),
        )
      : scores
  const scoresRounded =
    trimmedScores && typeof trimmedScores === 'object'
      ? Object.fromEntries(
          Object.entries(trimmedScores as Record<string, unknown>).map(([axis, value]) => {
            const score = asRecord(value)
            return [axis, score ? { ...score, score: rounded(score['score']) } : value]
          }),
        )
      : trimmedScores
  const placed = dropItems(
    Array.isArray(raw['defects'])
      ? raw['defects'].map((defect) => defectOf(defect, note))
      : raw['defects'],
    (item) => (item === null ? 'a defect with no time, frame or words' : null),
    (_item, index) => `defect ${index + 1}`,
    note,
  )
  const defects = capList(placed, CRITIC_DEFECTS_MAX, 'the defects', note)
  const fixes = capList(raw['fixes'], CRITIC_FIXES_MAX, 'the fixes', note)
  const mechanisms = capList(
    dropItems(
      raw['mechanisms'],
      (item) => (isMechanism(asRecord(item)?.['key']) ? null : 'not a mechanism in the list'),
      (item, index) => `mechanism ${index + 1} (${String(asRecord(item)?.['key'])})`,
      note,
    ),
    MECHANISMS_PER_DESIGN_MAX,
    'the mechanisms',
    note,
  )
  const parsed = CriticReportSchema.safeParse({
    ...raw,
    scores: scoresRounded,
    defects,
    fixes: Array.isArray(fixes)
      ? fixes.map((fix) => trimField(fix, CRITIC_FIX_MAX, 'a fix', note))
      : fixes,
    mechanisms,
  })
  if (!parsed.success) {
    throw new ValidationError(`The critic report is malformed: ${formatIssues(parsed.error)}`, {
      field: 'critic report',
    })
  }
  return parsed.data
}

/** Mock mode's report: at the bar on every axis, nothing to fix, the plan's mechanisms all present. */
export function mockCriticReport(plan: CriticPlan): CriticReport {
  return {
    scores: Object.fromEntries(
      CRITIC_AXES.map((axis) => [
        axis,
        { score: CRITIC_BAR, line: `[mock] ${axis} at the bar for "${plan.title}"` },
      ]),
    ) as CriticReport['scores'],
    defects: [],
    fixes: [],
    mechanisms: (plan.mechanisms ?? []).map((key) => ({ key, present: true })),
    keep: true,
  }
}
