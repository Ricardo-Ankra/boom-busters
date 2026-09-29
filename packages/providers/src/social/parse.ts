import { parse, NodeType } from 'node-html-parser'
import type { HTMLElement, Node as HtmlNode } from 'node-html-parser'

/**
 * Reading a post from X's public oEmbed response (decision 284).
 *
 * Pure: the oEmbed JSON in, five fields out. Nothing here invents a value.
 * A shape this does not recognise gives all nulls, never a throw, because a
 * card that guessed at a real person's words would be worse than a card that
 * asks the owner to type them.
 *
 * `publish.x.com` renders the post's own `<p>` once, then appends
 * `&mdash; Name (@handle) <a>Month D, YYYY</a>` as plain siblings inside the
 * same `<blockquote>`. Everything here is reading that one fixed shape.
 */

export interface ParsedXPost {
  authorName: string | null
  handle: string | null
  text: string | null
  postedAt: string | null
  /** True when a trailing t.co or pic.twitter.com token was removed from the text. */
  endedWithMediaLink: boolean
}

const NULL_POST: ParsedXPost = {
  authorName: null,
  handle: null,
  text: null,
  postedAt: null,
  endedWithMediaLink: false,
}

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
]

/** A final `https://t.co/...` or `pic.twitter.com/...` token, with its lead-in space. */
const MEDIA_LINK_RE = /(?:^|\s)(?:https:\/\/t\.co\/\S+|pic\.twitter\.com\/\S+)$/

/** `&mdash;` decodes to an em dash; matched by its escape, never typed literally. */
const NAME_PREFIX_RE = /^\u2014\s*/
const NAME_HANDLE_RE = /^(.+) \(@([A-Za-z0-9_]{1,15})\)$/
const DATE_RE = /^([A-Za-z]+) (\d{1,2}), (\d{4})$/

function isElement(node: HtmlNode): node is HTMLElement {
  return node.nodeType === NodeType.ELEMENT_NODE
}

function parseDate(text: string): string | null {
  const match = DATE_RE.exec(text.trim())
  if (!match) return null
  const monthName = match[1] ?? ''
  const day = match[2] ?? ''
  const year = match[3] ?? ''
  const monthIndex = MONTHS.indexOf(monthName)
  if (monthIndex === -1) return null
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${day.padStart(2, '0')}`
}

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/

/**
 * `author_url`'s last path segment, the address the spec says wins on a
 * disagreement, but only when it is shaped like a handle X could issue.
 * Anything else is null, and the byline's own handle stands.
 */
function handleFromAuthorUrl(authorUrl: unknown): string | null {
  if (typeof authorUrl !== 'string') return null
  try {
    const segment = new URL(authorUrl).pathname.split('/').filter(Boolean).pop()
    return segment !== undefined && HANDLE_RE.test(segment) ? segment : null
  } catch {
    return null
  }
}

/** Pure: the oEmbed JSON in, fields out. Unknown shapes give all nulls, never a throw. */
export function parseXOembed(body: unknown): ParsedXPost {
  if (typeof body !== 'object' || body === null) return NULL_POST
  const record = body as Record<string, unknown>
  const html = record['html']
  if (typeof html !== 'string') return NULL_POST

  try {
    const root = parse(html)
    const blockquote = root.querySelector('blockquote')
    const paragraph = blockquote?.querySelector('p')
    if (!blockquote || !paragraph) return NULL_POST

    // The <p>'s own text: <br> to '\n', each <a> to its visible text, entities
    // decoded, whitespace runs kept exactly as written (node-html-parser's
    // `.text` does all three: HTMLElement.rawText turns <br> into '\n' and
    // reduces children to their own rawText, and `.text` decodes the result).
    let text = paragraph.text
    let endedWithMediaLink = false
    if (MEDIA_LINK_RE.test(text)) {
      text = text.replace(MEDIA_LINK_RE, '')
      endedWithMediaLink = true
    }
    text = text.replace(/\s+$/, '')

    // Everything after the <p>, inside the same <blockquote>: the byline text
    // node and the date <a>.
    const afterParagraph = blockquote.childNodes.slice(blockquote.childNodes.indexOf(paragraph) + 1)
    const dateLink = [...afterParagraph].reverse().find(isElement)
    const bylineText = afterParagraph
      .filter((node) => node.nodeType === NodeType.TEXT_NODE)
      .map((node) => node.text)
      .join('')
      .replace(NAME_PREFIX_RE, '')
      .trim()

    const nameMatch = NAME_HANDLE_RE.exec(bylineText)
    const authorName = nameMatch?.[1] ?? null
    const htmlHandle = nameMatch?.[2] ?? null
    const handle = handleFromAuthorUrl(record['author_url']) ?? htmlHandle

    return {
      authorName,
      handle,
      text: text === '' ? null : text,
      postedAt: dateLink ? parseDate(dateLink.text) : null,
      endedWithMediaLink,
    }
  } catch {
    return NULL_POST
  }
}
