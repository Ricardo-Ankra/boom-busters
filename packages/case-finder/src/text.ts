const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Case-insensitive whole-word matcher for a name. Lookarounds on letters and
 * digits (not `\b`) so accented and non-Latin names bound correctly, and
 * "Apple" matches "Apple's" but never "pineapple" or "Applebee's".
 */
export function wholeWordPattern(name: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name.trim())}(?![\\p{L}\\p{N}])`, 'iu')
}
