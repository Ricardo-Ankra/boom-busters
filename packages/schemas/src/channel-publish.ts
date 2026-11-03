import type { TitleSlot } from './formats'

/** The most characters channel tags may take from YouTube's 500-character tag budget. */
export const CHANNEL_TAGS_CHARS_MAX = 150

/** Keeps tags in order while their comma-joined length stays within `maxChars`; the rest are dropped. */
export function channelTagsWithin(
  tags: readonly string[],
  maxChars = CHANNEL_TAGS_CHARS_MAX,
): { kept: string[]; dropped: string[] } {
  const kept: string[] = []
  const dropped: string[] = []
  let length = 0
  for (const tag of tags) {
    const next = kept.length === 0 ? tag.length : length + 2 + tag.length
    if (dropped.length === 0 && next <= maxChars) {
      kept.push(tag)
      length = next
    } else {
      dropped.push(tag)
    }
  }
  return { kept, dropped }
}

/** A video's length in words, rounded down: "Under a Minute", "95 Minutes", "2.5 Hours". */
export function runtimeWords(durationSec: number): string {
  const minutes = Math.floor(durationSec / 60)
  if (minutes < 1) return 'Under a Minute'
  if (minutes < 120) return minutes === 1 ? '1 Minute' : `${minutes} Minutes`
  const hours = Math.floor(minutes / 30) / 2
  return hours === 1 ? '1 Hour' : `${hours} Hours`
}

export interface TitleSlotValues {
  topic: string
  formatKeyword: string | null
  pillar: string | null
  runtime: string | null
}

/** The subject when the target keyword already holds a format keyword (or is absent), else the target keyword. */
export function topicForTitle(input: {
  targetKeyword: string | null
  subject: string
  formatKeywords: readonly string[]
}): string {
  const target = input.targetKeyword
  if (target === null) return input.subject
  const lower = target.toLowerCase()
  const repeatsFormat = input.formatKeywords.some((k) => lower.includes(k.toLowerCase()))
  return repeatsFormat ? input.subject : target
}

const SLOT_NAMES: readonly TitleSlot[] = ['topic', 'formatKeyword', 'pillar', 'runtime']
const SEPARATOR = '(?: \\| | - |: )'

/** Fills `{slot}` markers; a null slot goes with the separator before it (or its brackets). */
export function fillTitleTemplate(template: string, values: TitleSlotValues): string {
  let out = template
  for (const slot of SLOT_NAMES) {
    if (values[slot] !== null) continue
    const token = `\\{${slot}\\}`
    out = out
      .replace(new RegExp(` \\(${token}\\)`, 'g'), '')
      .replace(new RegExp(`${SEPARATOR}${token}`, 'g'), '')
      .replace(new RegExp(`^${token}${SEPARATOR}?`), '')
      .replace(new RegExp(token, 'g'), '')
  }
  for (const slot of SLOT_NAMES) {
    const value = values[slot]
    if (value !== null) out = out.split(`{${slot}}`).join(value)
  }
  return out.replace(/ {2,}/g, ' ').trim()
}

/** Required slots whose filled value the title does not contain (case-insensitive). */
export function missingTitleSlots(
  title: string,
  required: readonly TitleSlot[],
  values: TitleSlotValues,
): TitleSlot[] {
  const lower = title.toLowerCase()
  return required.filter((slot) => {
    const value = values[slot]
    return value !== null && !lower.includes(value.toLowerCase())
  })
}
