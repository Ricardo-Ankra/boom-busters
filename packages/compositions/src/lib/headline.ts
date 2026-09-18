/**
 * The headline card's text arithmetic (decision 257), kept out of the
 * component so it can be tested without rendering a frame.
 */

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

/**
 * "2023-03-14" to "14 March 2023".
 *
 * A twelve-entry table rather than `Intl.DateTimeFormat`, because a golden
 * frame has to render identically on this machine and on CI, and ICU data
 * differs between builds of Chrome. An unparseable date is returned as it
 * came: the compiler already refuses one that is not a date, so this is the
 * belt to that braces.
 */
export function formatPublished(iso: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!parts) return iso
  const month = MONTHS[Number(parts[2]) - 1]
  if (month === undefined) return iso
  return `${Number(parts[3])} ${month} ${parts[1]}`
}

export interface HeadlineParts {
  before: string
  /** The emphasised phrase, empty when there is none to draw under. */
  hit: string
  after: string
}

/**
 * The headline split around the phrase the marker draws under.
 *
 * An emphasis that is not in the headline renders the headline whole rather
 * than throwing: the compiler drops one that does not fit, so reaching here
 * with a mismatch means something upstream changed, and a card with no
 * highlight is still a correct card.
 */
export function splitHeadline(headline: string, emphasis?: string): HeadlineParts {
  if (emphasis === undefined || emphasis === '') return { before: headline, hit: '', after: '' }
  const at = headline.indexOf(emphasis)
  if (at === -1) return { before: headline, hit: '', after: '' }
  return {
    before: headline.slice(0, at),
    hit: emphasis,
    after: headline.slice(at + emphasis.length),
  }
}
