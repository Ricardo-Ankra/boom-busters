import {
  BriefCastMemberSchema,
  CaseBriefSchema,
  ClaimsSchema,
  DOSSIER_ANSWER_CLAIMS_MAX,
  DOSSIER_ANSWER_MAX,
  DOSSIER_ANSWERS_MAX,
  DOSSIER_CAST_MAX,
  DOSSIER_CLAIM_TEXT_MAX,
  DOSSIER_CLAIMS_PER_PASS,
  DOSSIER_EVENT_WHAT_MAX,
  DOSSIER_EVENT_WHEN_MAX,
  DOSSIER_OPEN_QUESTIONS_MAX,
  DOSSIER_QUESTION_MAX,
  DOSSIER_QUOTE_MAX,
  DOSSIER_QUOTE_MIN_FOLDED,
  DOSSIER_SCENES_MAX,
  DOSSIER_SERIES_POINTS_MAX,
  DOSSIER_SUMMARY_MAX,
  DOSSIER_SUPPORTS_MAX,
  DOSSIER_TOLD_ALREADY_MAX,
  DOSSIER_TURNING_POINT_MAX,
  LegalSchema,
  ResearchAnswersSchema,
  SceneSchema,
  ScenesSchema,
  SeriesPointSchema,
  SeriesSchema,
  ToldAlreadySchema,
  ValidationError,
} from '@boom-busters/schemas'
import type { CaseBrief, ResearchAnswers, ResearchClaim, Scene } from '@boom-busters/schemas'
import { z } from 'zod'
import { formatIssues, parseJsonCompletion } from './json'
import { capList, dropItems, ignoreRepairs, overLimit, trimField } from './repair'
import type { Note } from './repair'
import { outputBudget } from '../llm/types'
import type { LLMTaskRequest, Msg } from '../llm/types'

/**
 * The dossier-runner's four research passes (build spec section 7.1, amended
 * by decision 201 and the grounded-research design): case brief → scenes →
 * claims with their supports → the brief's open questions, answered. The
 * renderer is in `dossier-render.ts` and the mock passes in `dossier-mocks.ts`.
 *
 * Every pass reads the same gathered corpus, numbered [D1]..[Dn], and works
 * as an extractor: it cites a document by number and quotes it, and the
 * grounding step looks for each quote in the stored text. The model's memory
 * is not a source; what it remembers but cannot quote is an open question.
 *
 * Separate passes rather than one, for a reason that survives contact with
 * real output: asking for a brief, scenes and forty quoted claims in a single
 * completion reliably produces a good brief and a lazy claims list. Each pass
 * also becomes its own `step.run()`, so a failure in claims extraction does
 * not re-run and re-charge the brief.
 */

const HOUSE_RULES = `You research corporate collapses, frauds and comebacks for a documentary
channel with commentary. You work as the story researcher: you look for the
scenes, the people and what they wanted, the numbers that draw the arc, and
what earlier videos already told. Real companies and living people are the
subject, so:

- Write only what the documents in front of you say. A fact you remember but cannot quote from a document is an open question, not a claim.
- Cite a document by its number in the list: [D3] is "doc": 3. Never cite a
  number the list does not have.
- Copy every quote from the cited document word for word. Never paraphrase,
  correct or join two passages: the app looks for the quote in the document's
  text, and a quote it cannot find counts as no source at all.
- Distinguish what a court or regulator FOUND from what was ALLEGED or reported.
- Where the documents do not settle something, say so. An open question is
  useful; a confident invention is a liability.

Answer with JSON only, no prose around it.`

/**
 * One system prompt for all four passes. A provider's cached prefix starts
 * with the system prompt, so a pass-specific one would make every pass write
 * its own cache entry for the corpus; each pass's shape, rules and limits go
 * in its final message instead.
 */
const SYSTEM = `${HOUSE_RULES}

The shape of that JSON, its rules and its limits are in the final message.`

export interface CaseContext {
  title: string
  category: string
  angle?: string | null
  demandNotes?: string | null
}

function caseHeader(input: CaseContext): string {
  return [
    `Case: ${input.title}`,
    `Category: ${input.category}`,
    input.angle ? `Angle to pursue: ${input.angle}` : null,
    input.demandNotes ? `Audience notes: ${input.demandNotes}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * The message every pass opens with, after the shared system prompt. Both are
 * identical across the four passes and the message is marked as the cacheable
 * prefix, so the corpus, most of every request's input, is cached once per
 * run where the provider supports it. Everything pass-specific comes after.
 */
function corpusMessage(input: CaseContext, corpus: string): Msg {
  return {
    role: 'user',
    content: `${caseHeader(input)}\n\nDocuments, numbered. Cite them by number.\n\n${corpus}`,
  }
}

function passRequest(
  input: CaseContext,
  corpus: string,
  earlier: readonly Msg[],
  instructions: string,
  answerTokens: number,
): LLMTaskRequest {
  return {
    task: 'research',
    system: SYSTEM,
    messages: [corpusMessage(input, corpus), ...earlier, { role: 'user', content: instructions }],
    cacheablePrefixMessages: 1,
    maxTokens: outputBudget(answerTokens),
  }
}

/**
 * A revision note goes on the last user message, never the first: the first
 * holds the corpus, and changing it would throw away the cached prefix on
 * every pass of the revision. Every pass ends on its own instructions, so the
 * last user message is never the corpus.
 */
export function withNote(request: LLMTaskRequest, note: string): LLMTaskRequest {
  const last = request.messages.findLastIndex((message) => message.role === 'user')
  if (last < 0) return request
  return {
    ...request,
    messages: request.messages.map((message, at) =>
      at === last
        ? { ...message, content: `${message.content}\n\nThe human asks for changes: ${note}` }
        : message,
    ),
  }
}

/**
 * A limit the schema states inline rather than as a named constant, read
 * from the schema so the prompt, the repair and the check cannot drift.
 */
const maxOf = (field: { maxLength: number | null }): number =>
  field.maxLength ?? Number.POSITIVE_INFINITY

const CAST_NAME_MAX = maxOf(BriefCastMemberSchema.shape.name)
const CAST_ROLE_MAX = maxOf(BriefCastMemberSchema.shape.role)
const CAST_WANTED_MAX = maxOf(BriefCastMemberSchema.shape.wanted)
const BEAT_MAX = maxOf(ToldAlreadySchema.shape.beat)
const SCENE_WHO_MAX = maxOf(SceneSchema.shape.who)
const SCENE_WHY_MAX = maxOf(SceneSchema.shape.why)
const SERIES_LABEL_MAX = maxOf(SeriesSchema.shape.label)
const POINT_AT_MAX = maxOf(SeriesPointSchema.shape.at)
const POINT_WRITTEN_MAX = maxOf(SeriesPointSchema.shape.asWritten)

/**
 * The quote check refuses a quote under this many folded characters, since
 * a short one matches too easily to prove anything; the prompts say so, or
 * "the shortest span" invites quotes the check can never find.
 */
const QUOTE_FINDABLE = `long enough to find: a full clause of at least ${DOSSIER_QUOTE_MIN_FOLDED} letters and digits`

// ---------------------------------------------------------------------------
// Repairs (decision 293)
// ---------------------------------------------------------------------------

/**
 * A research answer is repaired before it is validated, as the Director's
 * Book is (decision 292): free text over its limit is trimmed at a sentence,
 * a list over its cap keeps its first items, and an item whose fact breaks a
 * rule (a date label, a name, a quote, a claim's text, an echoed question) is
 * dropped with the rest kept, never cut. A cut quote would no longer be the
 * document's words. Each repair is reported through `note` in the words the
 * dossier review shows. What is left must still match the schema, or the
 * answer is refused and asked for once more.
 */

const Envelope = z.looseObject({})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function parseRepaired<T>(
  text: string,
  schema: z.ZodType<T>,
  what: string,
  repair: (raw: Record<string, unknown>) => unknown,
): T {
  const raw = parseJsonCompletion(text, Envelope, what)
  const result = schema.safeParse(repair(raw))
  if (!result.success) {
    throw new ValidationError(
      `The model's ${what} did not match the expected shape: ${formatIssues(result.error)}`,
      { field: what },
    )
  }
  return result.data
}

/** Why a fact over its limit drops its item ("its date ran over 100 characters"), or null. */
const longer = (value: unknown, max: number, what: string): string | null =>
  typeof value === 'string' && value.trim().length > max ? overLimit(what, max) : null

/** Why an item's quote cannot be checked as written, or null. */
const quoteTooLong = (item: unknown): string | null =>
  isRecord(item) ? longer(item['quote'], DOSSIER_QUOTE_MAX, 'its quote') : null

type Numbered = { item: unknown; at: number }

interface ListRules {
  /** The cap. */
  max: number
  /** The list in words, for a cap's notice ("Kept the first 40 claims."). */
  name: string
  /** One item in words, numbered from 1 as the model wrote the list ("claim 37"). */
  label: (item: unknown, at: number) => string
  /** Why an item breaks a rule on a fact, or null; such an item is dropped. */
  bad?: (item: unknown) => string | null
  /** Trims the free text of an item that is kept. */
  fix?: (item: Record<string, unknown>, label: string) => unknown
}

/**
 * One list of an answer: the items `bad` has a reason against are dropped,
 * the rest capped, and each one kept is fixed. Every item keeps the number it
 * had as the model wrote it, so a notice names "claim 37" even after an
 * earlier claim was dropped.
 */
function repairList(value: unknown, rules: ListRules, note: Note): unknown {
  if (!Array.isArray(value)) return value
  const numbered: Numbered[] = value.map((item: unknown, at: number) => ({ item, at }))
  const { bad, fix } = rules
  const usable = bad
    ? (dropItems(
        numbered,
        (entry) => bad((entry as Numbered).item),
        (entry) => rules.label((entry as Numbered).item, (entry as Numbered).at),
        note,
      ) as Numbered[])
    : numbered
  const kept = capList(usable, rules.max, rules.name, note) as Numbered[]
  return kept.map(({ item, at }) =>
    fix && isRecord(item) ? fix(item, rules.label(item, at)) : item,
  )
}

/** The question an answer says it answers: the number it echoed, else its place in the list. */
function questionNumber(answer: unknown, at: number): number {
  const index = isRecord(answer) ? answer['index'] : undefined
  return typeof index === 'number' && Number.isInteger(index) && index >= 1 ? index : at + 1
}

interface ClaimLabels {
  /** The list in words, for a cap's notice. */
  name: string
  max: number
  /** "claim 3" or "claim 3 found while answering". */
  claim: (at: number) => string
  /** "claim 3 support 2". */
  support: (claimAt: number, supportAt: number) => string
}

/**
 * A figure series loses a point whose date or printed number runs over (both
 * are facts the check reads), keeps its first points over the cap, and is
 * dropped whole when no point is left, since a series with no points says
 * nothing a chart could draw.
 */
function repairSeries(series: unknown, claim: string, note: Note): unknown {
  if (!isRecord(series) || !Array.isArray(series['points'])) return series
  const where = `the series of ${claim}`
  const points = capList(
    dropItems(
      series['points'],
      (point) =>
        isRecord(point)
          ? (longer(point['asWritten'], POINT_WRITTEN_MAX, 'its number as written') ??
            longer(point['at'], POINT_AT_MAX, 'its date'))
          : null,
      (_, at) => `point ${at + 1} of ${where}`,
      note,
    ),
    DOSSIER_SERIES_POINTS_MAX,
    `points of ${where}`,
    note,
  )
  if (Array.isArray(points) && points.length === 0) {
    note({ action: 'dropped', field: where, reason: 'no point was left' })
    return null
  }
  return {
    ...series,
    label: trimField(series['label'], SERIES_LABEL_MAX, `the label of ${where}`, note),
    points,
  }
}

const usableLegalDate = (value: unknown): boolean => LegalSchema.shape.date.safeParse(value).success
const usableLegalDoc = (value: unknown): boolean => LegalSchema.shape.doc.safeParse(value).success

/**
 * A `none` status alleges nothing, so one whose date or document is unusable
 * loses nothing the script needs: it becomes `legal: null`, noted, rather
 * than refusing a whole pass.
 */
function repairLegal(legal: unknown, claim: string, note: Note): unknown {
  if (!isRecord(legal) || legal['status'] !== 'none') return legal
  if (usableLegalDate(legal['date']) && usableLegalDoc(legal['doc'])) return legal
  note({
    action: 'dropped',
    field: `the legal status of ${claim}`,
    reason: 'it named no usable date or document',
  })
  return null
}

/**
 * Why a ruled or alleged status cannot be kept as written, or null. The claim
 * goes with it: keeping the claim without its status would let the script
 * narrate an allegation as plain fact.
 */
function unusableAllegation(legal: unknown): string | null {
  if (!isRecord(legal) || (legal['status'] !== 'ruled' && legal['status'] !== 'alleged')) {
    return null
  }
  if (!usableLegalDate(legal['date'])) return 'its legal date was not YYYY, YYYY-MM or YYYY-MM-DD'
  if (!usableLegalDoc(legal['doc'])) return 'its legal status named no document'
  return null
}

/**
 * A claim's supports are repaired before the claim is judged: a support whose
 * quote runs over is dropped (a cut quote is no longer the document's words),
 * and a claim with no support left is dropped in turn, because a claim that
 * cites nothing is exactly what this pipeline exists to stop narrating.
 */
function repairClaims(value: unknown, labels: ClaimLabels, note: Note): unknown {
  if (!Array.isArray(value)) return value
  const supported = value.map((claim: unknown, at: number) => {
    if (!isRecord(claim)) return claim
    const label = labels.claim(at)
    const supports = Array.isArray(claim['supports'])
      ? capList(
          dropItems(
            claim['supports'],
            quoteTooLong,
            (_, supportAt) => labels.support(at, supportAt),
            note,
          ),
          DOSSIER_SUPPORTS_MAX,
          `supports of ${label}`,
          note,
        )
      : []
    return {
      ...claim,
      supports,
      ...('legal' in claim ? { legal: repairLegal(claim['legal'], label, note) } : {}),
      ...('series' in claim ? { series: repairSeries(claim['series'], label, note) } : {}),
    }
  })
  return repairList(
    supported,
    {
      max: labels.max,
      name: labels.name,
      label: (_, at) => labels.claim(at),
      // A claim's text is what a script narrates: over its limit the claim is dropped, never cut.
      bad: (claim) =>
        isRecord(claim)
          ? (longer(claim['text'], DOSSIER_CLAIM_TEXT_MAX, 'its text') ??
            (Array.isArray(claim['supports']) && claim['supports'].length === 0
              ? 'no support was left'
              : null) ??
            unusableAllegation(claim['legal']))
          : null,
    },
    note,
  )
}

// ---------------------------------------------------------------------------
// The claim shape, shared by the claims and answers passes
// ---------------------------------------------------------------------------

const CLAIM_SHAPE = `{"text": string,
  "supports": [{"doc": number, "quote": string}],
  "legal": {"status": "ruled"|"alleged"|"none", "date": string, "doc": number} | null,
  "series": {"label": string, "unit": string, "currency": string|null,
    "points": [{"at": string, "value": number, "asWritten": string}]} | null}`

const CLAIM_RULES = `- \`text\` is one fact in one plain sentence, as a script could narrate it.
  Figures, dates and quotes each get their own claim.
- \`supports\` are the documents that say it, the strongest first: a filing, a
  regulator or court record, or the reporting that broke it. A figure claim is
  the exception: see \`series\`. Two documents from different publishers make
  a claim sourced; one makes it single-source.
  Each support's \`quote\` is the shortest span of the document that proves the claim, copied exactly, usually under 120 characters and never over ${DOSSIER_QUOTE_MAX}.
  A quote must also be ${QUOTE_FINDABLE}. For a video transcript leave out the
  [mm:ss] markers.
- \`legal\` is the one legal question under the claim. \`legal.status\` is \`ruled\` only when a court or regulator document in the list says so; \`alleged\` when a filing, complaint or report makes the allegation; \`none\` otherwise.
  \`legal\` is null for a plain fact with no wrongdoing in it, such as a
  founding date or a reported revenue figure. \`none\` is for a claim about
  alleged or possible wrongdoing that no filing, complaint, report or ruling
  has made or decided, so it still carries a date and the document that
  discusses it. \`legal.date\` is when it was ruled or alleged (for \`none\`,
  the date of that document), as YYYY-MM-DD, YYYY-MM or YYYY; \`legal.doc\` is
  the document that sets the status. It decides whether the script must say
  "alleged", so do not guess it.
- Numbers draw the arc, so a figure claim carries \`series\` with \`asWritten\` copied as the document prints the number
  ("€1.9bn", "1,900"), one point per period in time order. \`at\` is the
  period ("2018", "Q3 2019"); \`value\` is the number in \`unit\` ("€1.9bn"
  in unit "EUR billion" is 1.9); \`currency\` is an ISO code or null. A figure
  claim's first support is the document that prints the numbers, even where
  another document is stronger, and every point's \`asWritten\` must appear in
  it. A claim without a figure has \`series\` null.`

/** The per-claim limits both claim-bearing passes state after their claim count. */
const CLAIM_LIMITS = `each \`text\` 10 to ${DOSSIER_CLAIM_TEXT_MAX} characters; 1 to ${DOSSIER_SUPPORTS_MAX} supports
per claim, each \`quote\` at most ${DOSSIER_QUOTE_MAX} characters; at most ${DOSSIER_SERIES_POINTS_MAX} points per series,
each \`at\` at most ${POINT_AT_MAX} and \`asWritten\` at most ${POINT_WRITTEN_MAX} characters`

// ---------------------------------------------------------------------------
// Pass 1, the brief
// ---------------------------------------------------------------------------

export function buildBriefRequest(input: CaseContext, corpus: string): LLMTaskRequest {
  return passRequest(
    input,
    corpus,
    [],
    `Read the documents and write the case brief: the story in short, the turn it
builds toward, the people in it and what they wanted, and what the videos in
the list already told.
{"summary": string, "turningPoint": string,
 "cast": [{"name": string, "role": string, "wanted": string,
   "scene": {"doc": number, "quote": string} | null}],
 "toldAlready": [{"beat": string, "doc": number, "quote": string}],
 "openQuestions": [string]}

- \`turningPoint\` is the moment the story turns: what the script builds toward.
- \`cast\` are the people and organisations the story follows. \`wanted\` is
  what that person wanted, in one sentence ("to make every quarter look like
  growth"), not their job title. \`scene\` is the document and the quote that
  show them wanting it; null when no document shows it.
- \`toldAlready\` lists the beats existing videos already cover, so the angle
  can be checked against them. Take them ONLY from documents of kind \`video\`;
  with no video documents in the list, it is []. \`beat\` is the beat in your
  words; \`quote\` is the transcript's own words that tell it, without the
  [mm:ss] markers.
- \`openQuestions\` are what the story needs and the documents do not settle.
- Every \`quote\` is the shortest span of the cited document that shows the
  point, copied exactly, at most ${DOSSIER_QUOTE_MAX} characters, and ${QUOTE_FINDABLE}.

Limits (the app checks them): "summary" 50 to ${DOSSIER_SUMMARY_MAX} characters; "turningPoint" 20 to
${DOSSIER_TURNING_POINT_MAX} characters; at most ${DOSSIER_CAST_MAX} cast members, each "name" 2 to ${CAST_NAME_MAX}, "role" 2 to
${CAST_ROLE_MAX} and "wanted" 10 to ${CAST_WANTED_MAX} characters; at most ${DOSSIER_TOLD_ALREADY_MAX} told-already beats, each
"beat" 10 to ${BEAT_MAX} characters; at most ${DOSSIER_OPEN_QUESTIONS_MAX} open questions, each at least 10 characters.`,
    6_000,
  )
}

export function parseBrief(text: string, note: Note = ignoreRepairs): CaseBrief {
  return parseRepaired(text, CaseBriefSchema, 'case brief', (raw) => ({
    ...raw,
    summary: trimField(raw['summary'], DOSSIER_SUMMARY_MAX, "the brief's summary", note),
    turningPoint: trimField(
      raw['turningPoint'],
      DOSSIER_TURNING_POINT_MAX,
      "the brief's turning point",
      note,
    ),
    cast: repairList(
      raw['cast'],
      {
        max: DOSSIER_CAST_MAX,
        name: 'cast',
        label: (_, at) => `cast member ${at + 1}`,
        bad: (member) =>
          isRecord(member) ? longer(member['name'], CAST_NAME_MAX, 'its name') : null,
        fix: (member, label) => {
          const scene = member['scene']
          const sceneTooLong = quoteTooLong(scene)
          if (sceneTooLong) {
            note({ action: 'dropped', field: `the scene of ${label}`, reason: sceneTooLong })
          }
          return {
            ...member,
            role: trimField(member['role'], CAST_ROLE_MAX, `the role of ${label}`, note),
            wanted: trimField(member['wanted'], CAST_WANTED_MAX, `what ${label} wanted`, note),
            ...(sceneTooLong ? { scene: null } : {}),
          }
        },
      },
      note,
    ),
    toldAlready: repairList(
      raw['toldAlready'],
      {
        max: DOSSIER_TOLD_ALREADY_MAX,
        name: 'told-already beats',
        label: (_, at) => `told-already beat ${at + 1}`,
        bad: quoteTooLong,
        fix: (told, label) => ({ ...told, beat: trimField(told['beat'], BEAT_MAX, label, note) }),
      },
      note,
    ),
    openQuestions: capList(
      raw['openQuestions'],
      DOSSIER_OPEN_QUESTIONS_MAX,
      'open questions',
      note,
    ),
  }))
}

// ---------------------------------------------------------------------------
// Pass 2, scenes
// ---------------------------------------------------------------------------

export function buildScenesRequest(
  input: CaseContext,
  corpus: string,
  brief: CaseBrief,
): LLMTaskRequest {
  return passRequest(
    input,
    corpus,
    [{ role: 'assistant', content: JSON.stringify(brief) }],
    `Now find the scenes the story is told through, in the order they happened:
{"scenes": [{"when": string, "who": string, "what": string, "why": string,
  "doc": number, "quote": string}]}

- A scene is a moment a documentary can show: something said or done, by
  someone, at a time. A results call, a stage keynote, a board meeting, a raid,
  a resignation, a short seller's report landing. This is the story's spine,
  not a legal chronology: leave out filings and procedural steps unless that
  moment changes the story.
- \`when\` may be imprecise where the document is ("late 2019", "March 2001").
- \`who\` is who acted or who was in the room.
- \`what\` is what was said or done, concretely, as a viewer would see it.
- \`why\` is why it matters to the arc: what it sets up, reveals or breaks.
- \`doc\` and \`quote\` are the document the scene is on record in and the
  shortest span of it that shows the moment, copied exactly and
  ${QUOTE_FINDABLE}. For a video transcript leave out the [mm:ss] markers;
  the app finds the time itself.
- Include the scenes that make the turning point land, not every event.

Limits (the app checks them): 1 to ${DOSSIER_SCENES_MAX} scenes; "when" 3 to ${DOSSIER_EVENT_WHEN_MAX} characters;
"who" 2 to ${SCENE_WHO_MAX} characters; "what" 10 to ${DOSSIER_EVENT_WHAT_MAX} characters; "why" 10 to
${SCENE_WHY_MAX} characters; "quote" at most ${DOSSIER_QUOTE_MAX} characters.`,
    10_000,
  )
}

export function parseScenes(text: string, note: Note = ignoreRepairs): Scene[] {
  return parseRepaired(text, ScenesSchema, 'scenes', (raw) => ({
    ...raw,
    scenes: repairList(
      raw['scenes'],
      {
        max: DOSSIER_SCENES_MAX,
        name: 'scenes',
        label: (_, at) => `scene ${at + 1}`,
        // A date label, the people in the room and a quote are facts: over
        // their limit the scene is dropped, never cut.
        bad: (scene) =>
          isRecord(scene)
            ? (longer(scene['when'], DOSSIER_EVENT_WHEN_MAX, 'its date') ??
              longer(scene['who'], SCENE_WHO_MAX, 'its people') ??
              quoteTooLong(scene))
            : null,
        fix: (scene, label) => ({
          ...scene,
          what: trimField(scene['what'], DOSSIER_EVENT_WHAT_MAX, label, note),
          why: trimField(scene['why'], SCENE_WHY_MAX, `the reason for ${label}`, note),
        }),
      },
      note,
    ),
  })).scenes
}

// ---------------------------------------------------------------------------
// Pass 3, claims and figures
// ---------------------------------------------------------------------------

export function buildClaimsRequest(
  input: CaseContext,
  corpus: string,
  brief: CaseBrief,
  scenes: readonly Scene[],
): LLMTaskRequest {
  return passRequest(
    input,
    corpus,
    [{ role: 'assistant', content: JSON.stringify({ brief, scenes }) }],
    `Now extract the facts the script will narrate, each with the words that prove
it: what the money did, who said what, what the numbers show over time. The
brief and the scenes tell you which facts the story rests on.
{"claims": [${CLAIM_SHAPE}]}

${CLAIM_RULES}

Limits (the app checks them): 1 to ${DOSSIER_CLAIMS_PER_PASS} claims; ${CLAIM_LIMITS}.`,
    12_000,
  )
}

export function parseClaims(text: string, note: Note = ignoreRepairs): ResearchClaim[] {
  return parseRepaired(text, ClaimsSchema, 'claims', (raw) => ({
    ...raw,
    claims: repairClaims(
      raw['claims'],
      {
        max: DOSSIER_CLAIMS_PER_PASS,
        name: 'claims',
        claim: (at) => `claim ${at + 1}`,
        support: (at, supportAt) => `claim ${at + 1} support ${supportAt + 1}`,
      },
      note,
    ),
  })).claims
}

// ---------------------------------------------------------------------------
// Pass 4, answering the open questions
// ---------------------------------------------------------------------------

/**
 * The brief is allowed to raise questions; the dossier is not allowed to
 * stop there (decision 201). A question left open in the document is the
 * part a script will either dodge or improvise, so a fourth pass makes the
 * researcher sit with its own list and answer from the documents. `null`
 * stays legal: "the documents do not say" is a finding, and the alternative
 * is an invention narrated over footage.
 */
export function buildAnswersRequest(
  input: CaseContext,
  corpus: string,
  brief: CaseBrief,
  scenes: readonly Scene[],
): LLMTaskRequest {
  // Numbered, not bulleted: the number is the join key the renderer places
  // each answer by (decision 203). Text matching alone lost every answer of
  // the first live run to paraphrased questions.
  const questions = brief.openQuestions.map((question, at) => `${at + 1}. ${question}`).join('\n')
  return passRequest(
    input,
    corpus,
    [{ role: 'assistant', content: JSON.stringify({ brief, scenes }) }],
    `Your brief raised open questions. A dossier with open questions is not a
finished brief, so answer each one from the documents now:
{"answers": [{"index": number, "question": string, "answer": string|null,
  "doc": number}],
 "claims": [${CLAIM_SHAPE}]}

- Answer only from what the documents say. \`doc\` is the document the answer
  rests on; leave it out when \`answer\` is null.
- Any fact inside an answer that a script might narrate must ALSO appear in
  \`claims\`, with its supports and quotes: an answer is not a side channel
  around the claim list.
- Where the documents do not answer the question, set \`answer\` to null. An
  honest null is shown to the human as still open; an invented answer is a
  liability read aloud.
- \`index\` is the question's number exactly as given in the numbered list.
  It is how each answer finds its question again, so it must be right. Repeat
  the question verbatim as well.

Claims follow the same rules as the claims pass:
${CLAIM_RULES}

Limits (the app checks them): at most ${DOSSIER_ANSWERS_MAX} answers; each "question" 10 to
${DOSSIER_QUESTION_MAX} characters; each "answer" at most ${DOSSIER_ANSWER_MAX} characters; at most
${DOSSIER_ANSWER_CLAIMS_MAX} claims; ${CLAIM_LIMITS}.

The open questions:
${questions}`,
    10_000,
  )
}

export function parseAnswers(text: string, note: Note = ignoreRepairs): ResearchAnswers {
  return parseRepaired(text, ResearchAnswersSchema, 'answers', (raw) => ({
    ...raw,
    answers: repairList(
      raw['answers'],
      {
        max: DOSSIER_ANSWERS_MAX,
        name: 'answers',
        label: (answer, at) => `the answer to question ${questionNumber(answer, at)}`,
        // The echoed question is how an answer finds its question again: a fact.
        bad: (answer) =>
          isRecord(answer)
            ? longer(answer['question'], DOSSIER_QUESTION_MAX, 'its question')
            : null,
        fix: (answer, label) => {
          // An honest null often comes back with "doc": null beside it; the
          // schema's optional number would refuse the whole pass over it.
          const { doc, ...rest } = answer
          return {
            ...rest,
            ...(doc === null ? {} : { doc }),
            answer: trimField(answer['answer'], DOSSIER_ANSWER_MAX, label, note),
          }
        },
      },
      note,
    ),
    claims: repairClaims(
      raw['claims'],
      {
        max: DOSSIER_ANSWER_CLAIMS_MAX,
        name: 'claims found while answering',
        claim: (at) => `claim ${at + 1} found while answering`,
        support: (at, supportAt) =>
          `claim ${at + 1} found while answering, support ${supportAt + 1}`,
      },
      note,
    ),
  }))
}
