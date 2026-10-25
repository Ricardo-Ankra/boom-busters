/**
 * Making the narrator say "six hundred and sixty".
 *
 * ElevenLabs expands digits the American way, so a script that says 660 is
 * read "six hundred sixty". The channel's English is British, and the script
 * should still say 660: it is what the captions show and what the claim list
 * cites. So the digits are rewritten into words only in the text sent to the
 * vendor, beside the pronunciation respellings, and the script is untouched.
 *
 * **Only the numbers the vendor would read differently.** A number is
 * rewritten when its British reading carries an "and" (660, 1,050, 2008) and
 * left alone otherwise (500, 3,000, 1.9). The vendor's own normaliser is good
 * at everything else, years and decimals especially, and every number left
 * alone is one this function cannot get wrong.
 *
 * **Years stay years.** A bare four-digit 1100 to 1999 or 2010 to 2099 is read
 * by the narrator as a year ("nineteen eighty-seven"), which is right, so it is
 * not touched. 2001 to 2009 are rewritten, because the British year is "two
 * thousand and eight". A quantity that happens to look like a year is written
 * with its comma (1,987 staff), which is also how the script writes figures.
 *
 * Lives here rather than beside the adapter for the reason `matchedHints`
 * does: `takeIdempotencyKey` has to know whether a paragraph's spoken text
 * changes, and the answer it gets and the request the adapter sends must come
 * from the same function.
 */

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
const SCALES = ['', 'thousand', 'million', 'billion', 'trillion']

function belowHundred(value: number): string {
  if (value < 20) return ONES[value]!
  const tens = TENS[Math.floor(value / 10)]!
  return value % 10 === 0 ? tens : `${tens}-${ONES[value % 10]!}`
}

function belowThousand(value: number): string {
  const hundreds = Math.floor(value / 100)
  const rest = value % 100
  if (hundreds === 0) return belowHundred(rest)
  return rest === 0
    ? `${ONES[hundreds]!} hundred`
    : `${ONES[hundreds]!} hundred and ${belowHundred(rest)}`
}

/**
 * A whole number in British words: "and" after the hundreds, and before a
 * final group under a hundred ("one thousand and fifty", "one million and
 * five"). Below a quadrillion, which is more than any figure this channel says.
 */
export function britishCardinal(value: number): string {
  if (value === 0) return ONES[0]!

  const groups: number[] = []
  for (let rest = value; rest > 0; rest = Math.floor(rest / 1000)) groups.push(rest % 1000)

  const words: string[] = []
  for (let scale = groups.length - 1; scale >= 0; scale -= 1) {
    const group = groups[scale]!
    if (group === 0) continue
    const lastAfterHigher = scale === 0 && groups.length > 1 && group < 100
    words.push(
      `${lastAfterHigher ? 'and ' : ''}${belowThousand(group)}${SCALES[scale] ? ` ${SCALES[scale]}` : ''}`,
    )
  }
  return words.join(' ')
}

const CURRENCY: Record<string, string> = { $: 'dollars', '£': 'pounds', '€': 'euros' }

/**
 * A number standing on its own: not inside a word, a date, a ratio, a phone
 * number or a time, and not an ordinal or a plural ("660th", "737s"). The
 * boundaries refuse a neighbouring letter, digit, or a separator followed by a
 * digit, which is what "9/11", "1-800" and "10:45" have in common.
 */
const NUMBER =
  /(?<![\p{L}\p{N}.,:/-])([$£€])?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(%)?(?:(\s+)(thousand|million|billion|trillion)\b)?(?![\p{L}\p{N}]|[.,:/-]\p{N})/gu

const MAX = 999_999_999_999_999

function isYear(digits: string, value: number): boolean {
  return (
    /^\d{4}$/.test(digits) && ((value >= 1100 && value <= 1999) || (value >= 2010 && value <= 2099))
  )
}

/** The words for one matched number, or null when it is left to the narrator. */
function speak(
  currency: string | undefined,
  digits: string,
  decimal: string | undefined,
  percent: string | undefined,
  scaleWord: string | undefined,
): string | null {
  if (/^0\d/.test(digits)) return null

  const value = Number(digits.replace(/,/g, ''))
  if (!Number.isSafeInteger(value) || value > MAX) return null

  const words = britishCardinal(value)
  if (!words.includes(' and ')) return null
  if (!currency && !decimal && !percent && !scaleWord && isYear(digits, value)) return null
  // "$660.50" is dollars and cents, which reads differently from a decimal;
  // too rare in this subject matter to be worth getting wrong.
  if (currency && decimal && !scaleWord) return null

  const fraction = decimal
    ? ` point ${[...decimal.slice(1)].map((digit) => ONES[Number(digit)]!).join(' ')}`
    : ''

  return [
    `${words}${fraction}`,
    percent ? 'percent' : '',
    scaleWord ?? '',
    currency ? CURRENCY[currency]! : '',
  ]
    .filter((part) => part.length > 0)
    .join(' ')
}

export interface SpokenNumberReplacement {
  /** What the script says, e.g. "$660 million". */
  original: string
  /** Where its words sit in the rewritten text: `text.slice(start, end)`. */
  start: number
  end: number
}

/**
 * The text with every British-"and" number written out, and where each one
 * landed, so an adapter can fold the spoken words' timings back onto the
 * script's token. Bracketed stage directions are passed through untouched:
 * they are never read aloud. Pure.
 */
export function spokenNumbers(text: string): {
  text: string
  replacements: SpokenNumberReplacement[]
} {
  const replacements: SpokenNumberReplacement[] = []
  let out = ''

  // Odd indices are the bracketed spans, kept by the capturing split.
  text.split(/(\[[^\]]*\])/).forEach((segment, index) => {
    if (index % 2 === 1) {
      out += segment
      return
    }
    let last = 0
    for (const match of segment.matchAll(NUMBER)) {
      const [whole, currency, digits, decimal, percent, , scaleWord] = match
      const words = speak(currency, digits!, decimal, percent, scaleWord)
      if (words === null) continue

      out += segment.slice(last, match.index)
      replacements.push({ original: whole, start: out.length, end: out.length + words.length })
      out += words
      last = match.index + whole.length
    }
    out += segment.slice(last)
  })

  return { text: out, replacements }
}
