import type { ChannelBible } from '@boom-busters/schemas'

/**
 * The case category as the channel's bible words it (decision 245, and the
 * channel bible lift). `con` and `collapse` are stored lower-case; the bible's
 * `caseCategories` gives each key its label.
 *
 * A key the bible no longer lists (the owner edited the list after cases were
 * made) shows as the key itself, never as nothing and never as an error.
 */
type CategorySource = Pick<ChannelBible, 'caseCategories'>

export function caseCategoryLabel(bible: CategorySource, key: string): string {
  return bible.caseCategories.find((category) => category.key === key)?.label ?? key
}

/** The keys the channel's bible lists, in its order. */
export function caseCategoryKeys(bible: CategorySource): string[] {
  return bible.caseCategories.map((category) => category.key)
}
