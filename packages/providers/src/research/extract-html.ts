import { NodeType, parse } from 'node-html-parser'
import type { HTMLElement, Node } from 'node-html-parser'

const DROPPED = 'script, style, noscript, nav, header, footer, aside, form, svg'

const BLOCKS = new Set([
  'p',
  'div',
  'section',
  'article',
  'main',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'ul',
  'ol',
  'blockquote',
  'pre',
  'table',
  'tr',
  'figure',
  'figcaption',
  'dl',
  'dt',
  'dd',
])

// Private-use markers so paragraph and line breaks survive the whitespace
// collapse that follows; a real newline in the source is only formatting.
const PARAGRAPH = '\u0000'
const LINE = '\u0001'

function walk(node: Node, out: string[]): void {
  if (node.nodeType === NodeType.TEXT_NODE) {
    out.push(node.text)
    return
  }
  if (node.nodeType !== NodeType.ELEMENT_NODE) return
  const element = node as HTMLElement
  const tag = element.tagName.toLowerCase()
  if (tag === 'br') {
    out.push(LINE)
    return
  }
  const block = BLOCKS.has(tag)
  if (block) out.push(PARAGRAPH)
  for (const child of element.childNodes) walk(child, out)
  if (block) out.push(PARAGRAPH)
}

/** The first `datePublished` anywhere in a JSON-LD value, however it is nested. */
function findDatePublished(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findDatePublished(item)
      if (found !== null) return found
    }
    return null
  }
  if (value === null || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.datePublished === 'string') return record.datePublished
  for (const child of Object.values(record)) {
    const found = findDatePublished(child)
    if (found !== null) return found
  }
  return null
}

function day(value: string | null | undefined): string | null {
  const match = /^\s*(\d{4}-\d{2}-\d{2})/.exec(value ?? '')
  return match?.[1] ?? null
}

function publishedAt(root: HTMLElement): string | null {
  const meta = root
    .querySelector('meta[property="article:published_time"]')
    ?.getAttribute('content')
  const fromMeta = day(meta)
  if (fromMeta !== null) return fromMeta

  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const found = day(findDatePublished(JSON.parse(script.text)))
      if (found !== null) return found
    } catch {
      // Publishers ship malformed JSON-LD; the next block may be fine.
    }
  }
  return null
}

export function htmlToText(html: string): {
  title: string | null
  text: string
  publishedAt: string | null
} {
  const root = parse(html)
  // Metadata lives in the head and in scripts, so it is read before they are dropped.
  const titleText = root.querySelector('title')?.text.trim() ?? ''
  const date = publishedAt(root)

  for (const element of root.querySelectorAll(DROPPED)) element.remove()
  const scope =
    root.querySelector('article') ??
    root.querySelector('main') ??
    root.querySelector('body') ??
    root

  const parts: string[] = []
  walk(scope, parts)
  const text = parts
    .join('')
    .split(PARAGRAPH)
    .map((paragraph) =>
      paragraph
        .split(LINE)
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter((line) => line !== '')
        .join('\n'),
    )
    .filter((paragraph) => paragraph !== '')
    .join('\n\n')

  return { title: titleText === '' ? null : titleText, text, publishedAt: date }
}
