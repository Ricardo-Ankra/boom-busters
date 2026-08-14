import { getChapter, getSettings } from '@boom-busters/db'
import type { Database } from '@boom-busters/db'
import { narrationUnits } from '@boom-busters/providers'
import type { NarrationUnit } from '@boom-busters/providers'

/**
 * The narration unit a take belongs to, re-derived from the script as it
 * stands — the unit-aware successor of the old per-paragraph lookup.
 *
 * `undefined` is a real state, not an error: a chapter edited down to fewer
 * units leaves takes pointing past its end, and callers need to say so rather
 * than crash. Derived rather than stored, and from the same `narrationUnits`
 * the runner buys with, so "unit 2" means the same thing to the screen, the
 * retaker and the audio route.
 */
export async function takeUnit(
  db: Database,
  take: { chapterId: string; paragraphIndex: number },
): Promise<NarrationUnit | undefined> {
  const [settings, chapter] = await Promise.all([getSettings(db), getChapter(db, take.chapterId)])
  if (!chapter) return undefined

  return narrationUnits({
    provider: settings.tts.provider,
    chapters: [{ id: chapter.id, title: chapter.title, contentMd: chapter.contentMd }],
  }).find((unit) => unit.unitIndex === take.paragraphIndex)
}
