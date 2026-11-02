import {
  CropFocusSchema,
  PointShotMotionSchema,
  SHORT_RULES,
  ValidationError,
} from '@boom-busters/schemas'
import type {
  BibleInUse,
  CropFocus,
  PointScript,
  PointShotMotion,
  TimelineSlot,
} from '@boom-busters/schemas'
import { z } from 'zod'
import { fillSlots } from './bible'
import { formatIssues, parseJsonCompletion } from './json'
import { ignoreRepairs } from './repair'
import type { Note } from './repair'
import { outputBudget } from '../llm/types'
import type { LLMTaskRequest } from '../llm/types'

/**
 * One point Short's shot plan (spec 4.2 to 4.5, 5.1 to 5.3): when each shot
 * starts, by word, how it is cropped and moved, and whether it reuses a shot
 * from the long form's numbered library or asks for new stock or a new still.
 */

/** One slot of the long form's master timeline, numbered for this one call (spec 5.1). */
export interface PlanLibraryEntry {
  ref: number
  type: TimelineSlot['type']
  payloadKind: string
  covered: string
  brief: string
  chapterIndex: number
}

export interface PlannedPointShot {
  startWord: number
  crop: CropFocus
  motion: PointShotMotion
  source:
    | { kind: 'library'; ref: number }
    | { kind: 'stock'; query: string }
    | { kind: 'still'; prompt: string }
}

/** Milliseconds as the seconds the prompt speaks in: 1500 as "1.5". */
const seconds = (ms: number): string => String(ms / 1000)

export function buildPointPlanRequest(input: {
  bible: BibleInUse
  script: PointScript
  words: readonly { index: number; text: string; startMs: number }[]
  library: readonly PlanLibraryEntry[]
  sourceChapters: readonly number[]
  note: string | null
}): LLMTaskRequest {
  const R = SHORT_RULES
  const libraryList = input.library
    .map(
      (e) =>
        `${e.ref}. ${e.type} (${e.payloadKind}), chapter ${e.chapterIndex}. Covered: ${e.covered} Brief: ${e.brief}`,
    )
    .join('\n')
  const wordList = input.words
    .map((w) => `${w.index} ${(w.startMs / 1000).toFixed(1)}s ${w.text}`)
    .join('\n')
  const last = input.words.length - 1

  return {
    task: 'shotlist',
    system: fillSlots(
      `Plan the shots of one vertical 9:16 Short. You are given its script, its voiced words with the time each is spoken, and a numbered library of the pictures the full video already has.

Pacing:
- A visual change every ${seconds(R.shotMinMs)} to ${seconds(R.shotTargetMaxMs)} seconds. No shot shorter than ${seconds(R.shotMinMs)} seconds and none longer than ${seconds(R.shotMaxMs)}, except a headline, social or chart card, which may hold up to ${seconds(R.cardShotMaxMs)} so it can be read.
- A shot runs from its first word to the next shot's first word, so choose the words by their times below.
- A "change" is a new shot, or the same library picture again with a new crop or motion. To keep up the pace without many pictures, show one picture as a sequence: wide, then a punch-in on a detail.
- Cuts only. No fades or dissolves.

The hook:
- The first shot starts at word 0, and is the hook picture from the first frame. Give it the "punch" motion, which scales in within the first ${seconds(R.hookPunchByMs)} seconds. Use "punch" again only on an emphasis word.

Motion, one per shot: "kenburns-in" or "kenburns-out" for every photo, still and archival picture so none sits still; "punch" for the hook and for emphasis; "static" only for a code-drawn card (headline, social, chart, map, graphic) that is being read.

Reusing the library:
- Prefer pictures from chapters ${input.sourceChapters.join(', ')}, then the rest of the library.
- Use a library picture by its number, exactly as listed. Never invent a number.
- Code-drawn cards are re-laid out for 9:16 and can be used as they are.
- Photos, stills, archival pictures and footage are cover-cropped to 9:16. Give each a crop of "left", "centre" or "right" that keeps its subject in frame, and avoid a picture whose subject would be cut out. For a card, any crop will do.
- The same library picture may appear more than once with a different crop or motion.

New pictures:
- Ask for a new one only when the library has nothing that fits the moment, and at most ${R.newImagesMax} in all, stock and still together. Prefer the library.
- {"kind": "stock"} is a search query for stock footage or a photo.
- {"kind": "still"} is a prompt for a generated image, which is made for a 9:16 vertical frame. Open the prompt with the framing and the main subject ("Vertical 9:16 close-up of ..."): the image model follows the opening words most. Name only what must be in the frame.

Limits (the app checks them): startWord is a word number from the list below, 0 to ${last}, and each shot's startWord is greater than the one before.

Return exactly:
{"shots": [{"startWord": number, "crop": "left" | "centre" | "right", "motion": "static" | "kenburns-in" | "kenburns-out" | "punch", "source": {"kind": "library", "ref": number} | {"kind": "stock", "query": string} | {"kind": "still", "prompt": string}}]}`,
      input.bible,
    ),
    messages: [
      {
        role: 'user',
        content: [
          `Title: ${input.script.title}`,
          input.script.paragraphs
            .map((p) => `${p.phase.toUpperCase()} (chapter ${p.chapterIndex}): ${p.text}`)
            .join('\n'),
          `Prefer source chapters ${input.sourceChapters.join(', ')}.`,
          `Library:\n${libraryList || '(empty: every shot is new)'}`,
          `Words (number, time, word):\n${wordList}`,
          ...(input.note ? [`Note from the owner: ${input.note}`] : []),
        ].join('\n\n'),
      },
    ],
    maxTokens: outputBudget(1500),
  }
}

const PlanSchema = z.object({
  shots: z
    .array(
      z.object({
        startWord: z.number().int().min(0),
        crop: CropFocusSchema,
        motion: PointShotMotionSchema,
        source: z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('library'), ref: z.number().int() }),
          z.object({ kind: z.literal('stock'), query: z.string().min(2).max(200) }),
          z.object({ kind: z.literal('still'), prompt: z.string().min(4).max(2000) }),
        ]),
      }),
    )
    .min(1)
    .max(40),
})

/**
 * The plan as the model answered. A library number the list does not have, a
 * start word the Short does not have, or a start that does not move forward is
 * refused: clamping would put someone else's picture or words on screen. Only
 * new shots over the cap are repaired, dropped latest first (the shot before
 * simply runs on), so the picture count stays bounded without a re-ask.
 */
export function parsePointPlan(
  text: string,
  limits: { wordCount: number; libraryCount: number },
  note: Note = ignoreRepairs,
): PlannedPointShot[] {
  const raw = parseJsonCompletion(text, z.looseObject({}), 'point plan')
  const parsed = PlanSchema.safeParse(raw)
  if (!parsed.success) {
    throw new ValidationError(`The point plan is malformed: ${formatIssues(parsed.error)}`, {
      field: 'point plan',
    })
  }
  let shots: PlannedPointShot[] = parsed.data.shots

  const issues: string[] = []
  if (shots[0]!.startWord !== 0) issues.push('the first shot must start at word 0')
  shots.forEach((shot, at) => {
    const label = `shot ${at + 1}`
    if (shot.startWord >= limits.wordCount) {
      issues.push(
        `${label} starts at word ${shot.startWord}, but the Short has ${limits.wordCount}`,
      )
    }
    if (at > 0 && shot.startWord <= shots[at - 1]!.startWord) {
      issues.push(`${label} does not start after the shot before it`)
    }
    if (
      shot.source.kind === 'library' &&
      (shot.source.ref < 0 || shot.source.ref >= limits.libraryCount)
    ) {
      issues.push(
        `${label} uses library picture ${shot.source.ref}, but the library runs 0 to ${limits.libraryCount - 1}`,
      )
    }
  })
  if (issues.length > 0) {
    throw new ValidationError(`The point plan is not usable: ${issues.join('; ')}`, {
      field: 'point plan',
    })
  }

  let fresh = shots.filter((s) => s.source.kind !== 'library').length
  if (fresh > SHORT_RULES.newImagesMax) {
    const keep = [...shots]
    for (let at = keep.length - 1; at > 0 && fresh > SHORT_RULES.newImagesMax; at--) {
      if (keep[at]!.source.kind === 'library') continue
      note({
        action: 'dropped',
        field: `shot ${at + 1}`,
        reason: `a new ${keep[at]!.source.kind} over the limit of ${SHORT_RULES.newImagesMax} new pictures`,
      })
      keep.splice(at, 1)
      fresh--
    }
    shots = keep
  }
  return shots
}

/** Deterministic, so mock runs and the E2E suite get a stable plan: a shot every 5 words. */
export function mockPointPlan(
  words: readonly { index: number; text: string; startMs: number }[],
  library: readonly PlanLibraryEntry[],
): PlannedPointShot[] {
  const crops: CropFocus[] = ['centre', 'left', 'right']
  const shots: PlannedPointShot[] = []
  for (let at = 0, n = 0; at < words.length; at += 5, n++) {
    const entry = library.length > 0 ? library[n % library.length]! : undefined
    // One generated still, on the second shot; a library of none makes the first shot one.
    const wantsStill = entry === undefined || (n === 1 && library.length > 0)
    shots.push({
      startWord: at,
      crop: crops[n % crops.length]!,
      motion: n === 0 ? 'punch' : 'kenburns-in',
      source: wantsStill
        ? { kind: 'still', prompt: 'MOCK vertical 9:16 frame, a stand-in picture' }
        : { kind: 'library', ref: n % library.length },
    })
  }
  return shots
}
