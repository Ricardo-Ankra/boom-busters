/**
 * The title options VidIQ still has to score: one entry per distinct title,
 * compared without regard to case, and none whose case-variant already has a
 * score. The Publish screen's estimate and `scoreAllTitlesAction` both count
 * with this, so the credits quoted are the credits spent.
 */
export function unscoredDistinctTitles(
  titleOptions: readonly string[],
  titleScores: Readonly<Record<string, number | null>>,
): string[] {
  const scored = new Set(Object.keys(titleScores).map((title) => title.toLowerCase()))
  const seen = new Set<string>()
  const unscored: string[] = []
  for (const title of titleOptions) {
    const key = title.toLowerCase()
    if (scored.has(key) || seen.has(key)) continue
    seen.add(key)
    unscored.push(title)
  }
  return unscored
}
