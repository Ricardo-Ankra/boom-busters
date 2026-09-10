/**
 * The case category as a word, not an enum value (decision 245).
 *
 * `con`, `collapse` and friends are stored lower-case and were shown that way
 * in a monospace chip on the dashboard, the Projects list and every project
 * header, which read as an identifier rather than as what the video is about.
 */
const LABELS: Record<string, string> = {
  collapse: 'Collapse',
  con: 'Con',
  meltdown: 'Meltdown',
  turnaround: 'Turnaround',
  empire: 'Empire',
}

export function caseCategoryLabel(category: string): string {
  return LABELS[category] ?? category.charAt(0).toUpperCase() + category.slice(1)
}
