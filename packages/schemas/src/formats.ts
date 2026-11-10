import { z } from 'zod'

/** The pieces a title template can name, as `{topic}`. */
export const TITLE_SLOTS = ['topic', 'formatKeyword', 'pillar', 'runtime'] as const
export type TitleSlot = (typeof TITLE_SLOTS)[number]

/** Outer limits for a format's runtime, in minutes; the default maximum is only a bible's default choice. */
export const RUNTIME_OUTER_MIN = 3
export const RUNTIME_OUTER_MAX = 180
export const RUNTIME_DEFAULT_MAX = 30

export const DEFAULT_WORDS_PER_MINUTE = 150
export const DEFAULT_SHOT_HOLD = 1

/** Keywords a format holds, and the characters one keyword may run to. */
export const FORMAT_KEYWORDS_MAX = 6
export const FORMAT_KEYWORD_MAX_LENGTH = 60

/**
 * How a film marks its chapters: a full card at every chapter after the
 * opening, the film's title once after the opening, or nothing.
 */
export const CHAPTER_MARKINGS = ['cards', 'title', 'none'] as const
export type ChapterMarking = (typeof CHAPTER_MARKINGS)[number]

const KeywordSchema = z.string().trim().min(1).max(FORMAT_KEYWORD_MAX_LENGTH)

const RuntimeSchema = z
  .strictObject({
    default: z.number().int().default(15),
    min: z.number().int().default(RUNTIME_OUTER_MIN),
    max: z.number().int().default(RUNTIME_DEFAULT_MAX),
  })
  .refine(
    (r) =>
      r.min >= RUNTIME_OUTER_MIN &&
      r.max <= RUNTIME_OUTER_MAX &&
      r.min <= r.default &&
      r.default <= r.max,
    {
      message: `Runtime needs ${RUNTIME_OUTER_MIN} <= min <= default <= max <= ${RUNTIME_OUTER_MAX}`,
    },
  )

/** One named production setting: keywords, length, pace, intent, shot hold, title and intro. */
export const ChannelFormatSchema = z
  .strictObject({
    key: z.string().regex(/^[a-z][a-z0-9-]{0,23}$/),
    name: z.string().min(1).max(40),
    primary: z.boolean(),
    keywords: z.array(KeywordSchema).max(FORMAT_KEYWORDS_MAX).default([]),
    intent: z.enum(['tension', 'calm']).default('tension'),
    runtime: RuntimeSchema.default({
      default: 15,
      min: RUNTIME_OUTER_MIN,
      max: RUNTIME_DEFAULT_MAX,
    }),
    wordsPerMinute: z.number().min(80).max(200).default(DEFAULT_WORDS_PER_MINUTE),
    shotHold: z
      .number()
      .min(1)
      .max(4)
      .refine((n) => Number.isInteger(n * 2), { message: 'Shot hold moves in steps of 0.5' })
      .default(DEFAULT_SHOT_HOLD),
    titleTemplate: z.string().max(200).default(''),
    titleRequiredSlots: z.array(z.enum(TITLE_SLOTS)).default([]),
    introRule: z.string().max(1000).default(''),
    introLine: z.string().max(400).default(''),
    outroLine: z.string().max(400).default(''),
    /** False for a format that makes no Shorts, such as a sleep format. */
    shorts: z.boolean().default(true),
    /**
     * How this format marks its chapters (chapter marking design, decision
     * 454). "inherit" takes the Brand Kit look's choice; absent, "" and null
     * read as "inherit".
     */
    chapterMarking: z.preprocess(
      (v) => (v === '' || v === null || v === undefined ? 'inherit' : v),
      z.enum(['inherit', ...CHAPTER_MARKINGS]),
    ),
  })
  .refine((f) => f.titleRequiredSlots.every((slot) => f.titleTemplate.includes(`{${slot}}`)), {
    message: 'Every required title slot must appear in the template as {slot}',
    path: ['titleRequiredSlots'],
  })
export type ChannelFormat = z.infer<typeof ChannelFormatSchema>

/** One to six formats, unique keys, exactly one primary. */
export const FormatsSchema = z
  .array(ChannelFormatSchema)
  .min(1)
  .max(6)
  .refine((fs) => new Set(fs.map((f) => f.key)).size === fs.length, {
    message: 'Format keys must be unique',
  })
  .refine((fs) => fs.filter((f) => f.primary).length === 1, {
    message: 'Exactly one format must be primary',
  })

/** The format a channel starts with: every default, primary. */
export function defaultFormat(name = 'Main'): ChannelFormat {
  return {
    key: 'main',
    name,
    primary: true,
    keywords: [],
    intent: 'tension',
    runtime: { default: 15, min: RUNTIME_OUTER_MIN, max: RUNTIME_DEFAULT_MAX },
    wordsPerMinute: DEFAULT_WORDS_PER_MINUTE,
    shotHold: DEFAULT_SHOT_HOLD,
    titleTemplate: '',
    titleRequiredSlots: [],
    introRule: '',
    introLine: '',
    outroLine: '',
    shorts: true,
    chapterMarking: 'inherit',
  }
}

/** The keyed format, else the primary (else the first, for a list that skipped validation). */
export function resolveFormat(
  formats: readonly ChannelFormat[],
  key: string | null | undefined,
): ChannelFormat {
  const found = key ? formats.find((f) => f.key === key) : undefined
  return found ?? formats.find((f) => f.primary) ?? formats[0] ?? defaultFormat()
}

/** The first keyword, or null when the format has none. */
export function leadKeyword(format: ChannelFormat): string | null {
  return format.keywords[0] ?? null
}

/** True when every field but key, name and primary equals the defaults. */
export function formatIsDefault(format: ChannelFormat): boolean {
  const d = defaultFormat()
  return (
    format.keywords.length === 0 &&
    format.intent === d.intent &&
    format.runtime.default === d.runtime.default &&
    format.runtime.min === d.runtime.min &&
    format.runtime.max === d.runtime.max &&
    format.wordsPerMinute === d.wordsPerMinute &&
    format.shotHold === d.shotHold &&
    format.titleTemplate === d.titleTemplate &&
    format.titleRequiredSlots.length === 0 &&
    format.introRule === d.introRule &&
    format.introLine === d.introLine &&
    format.outroLine === d.outroLine &&
    format.shorts === d.shorts &&
    format.chapterMarking === d.chapterMarking
  )
}

/** The format's own chapter marking, else the Brand Kit look's when the format inherits. */
export function resolveChapterMarking(
  look: { chapterMarking: ChapterMarking },
  format: { chapterMarking: 'inherit' | ChapterMarking },
): ChapterMarking {
  return format.chapterMarking === 'inherit' ? look.chapterMarking : format.chapterMarking
}
