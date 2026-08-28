/**
 * The dossier's own markdown renderer and claim anchoring (build spec
 * section 11.3, amended 2026-08-28 — decision 196).
 *
 * Hand-rolled rather than a markdown library, on purpose. The dossier text
 * comes from a language model, and the original screen refused to render it
 * at all for exactly that reason. Parsing a known, small subset ourselves —
 * headings, lists, paragraphs, bold, italic, links — keeps that property:
 * nothing here ever interprets HTML, and anything the parser does not
 * recognise falls through as literal text rather than markup. It also gives
 * us the one thing a library cannot: the claim anchors live inside the
 * inline model, so a highlighted phrase is a first-class segment, not a
 * regex bolted onto someone else's DOM.
 *
 * Anchoring is honest about being fuzzy. Claims are extracted assertions,
 * usually paraphrases of the document rather than quotes, so a claim either
 * matches verbatim (after folding quotes and case), matches the dossier
 * sentence it most plausibly restates (token overlap above a threshold), or
 * is reported as unanchored — and the screen shows unanchored claims in a
 * list, because a claim you cannot find is a gate you cannot pass.
 */

// ---------------------------------------------------------------------------
// The block model
// ---------------------------------------------------------------------------

export type InlineSegment =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'link'; text: string; href: string }

export type DossierBlock =
  | { kind: 'heading'; depth: 1 | 2 | 3 | 4 | 5 | 6; inline: InlineSegment[] }
  | { kind: 'paragraph'; inline: InlineSegment[] }
  | { kind: 'list'; ordered: boolean; items: InlineSegment[][] }

// ---------------------------------------------------------------------------
// Block parsing
// ---------------------------------------------------------------------------

const HEADING = /^(#{1,6})\s+(.*)$/
const UNORDERED_ITEM = /^\s*[-*]\s+(.*)$/
const ORDERED_ITEM = /^\s*\d+[.)]\s+(.*)$/
/** A wrapped line inside a list item — indented continuation, not a new item. */
const CONTINUATION = /^\s{2,}(\S.*)$/

export function parseDossier(md: string): DossierBlock[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const blocks: DossierBlock[] = []

  let index = 0
  while (index < lines.length) {
    const line = lines[index] as string

    if (line.trim() === '') {
      index += 1
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({
        kind: 'heading',
        depth: (heading[1] as string).length as 1 | 2 | 3 | 4 | 5 | 6,
        inline: parseInline(heading[2] as string),
      })
      index += 1
      continue
    }

    const ordered = ORDERED_ITEM.test(line)
    if (ordered || UNORDERED_ITEM.test(line)) {
      const items: InlineSegment[][] = []
      const itemPattern = ordered ? ORDERED_ITEM : UNORDERED_ITEM

      while (index < lines.length) {
        const itemMatch = itemPattern.exec(lines[index] as string)
        if (!itemMatch) break

        let text = itemMatch[1] as string
        index += 1
        // Models hard-wrap long items; the indented remainder is the same item.
        while (index < lines.length) {
          const continuation = CONTINUATION.exec(lines[index] as string)
          if (!continuation || itemPattern.test(lines[index] as string)) break
          text += ` ${continuation[1] as string}`
          index += 1
        }
        items.push(parseInline(text))
      }

      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    // A paragraph: consecutive plain lines joined with spaces.
    const paragraph: string[] = []
    while (index < lines.length) {
      const current = lines[index] as string
      if (
        current.trim() === '' ||
        HEADING.test(current) ||
        UNORDERED_ITEM.test(current) ||
        ORDERED_ITEM.test(current)
      ) {
        break
      }
      paragraph.push(current.trim())
      index += 1
    }
    blocks.push({ kind: 'paragraph', inline: parseInline(paragraph.join(' ')) })
  }

  return blocks
}

// ---------------------------------------------------------------------------
// Inline parsing
// ---------------------------------------------------------------------------

/**
 * `**strong**`, `*em*`, `[text](https://…)`. Anything else — including
 * unmatched markers, backticks and raw HTML — is literal text. A link whose
 * URL is not http(s) is rendered as its text: a dossier is no place for
 * `javascript:` URLs.
 */
// Emphasis content must not start or end with whitespace, so a stray "*"
// between spaced words stays a literal asterisk rather than becoming italics.
const INLINE_TOKEN =
  /(\*\*(\S|\S[^*]*\S)\*\*)|(\*(\S|\S[^*]*\S)\*)|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g

export function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = []
  let cursor = 0

  for (const match of text.matchAll(INLINE_TOKEN)) {
    const at = match.index
    if (at > cursor) segments.push({ kind: 'text', text: text.slice(cursor, at) })

    if (match[2] !== undefined) segments.push({ kind: 'strong', text: match[2] })
    else if (match[4] !== undefined) segments.push({ kind: 'em', text: match[4] })
    else if (match[6] !== undefined && match[7] !== undefined) {
      segments.push({ kind: 'link', text: match[6], href: match[7] })
    }

    cursor = at + (match[0] as string).length
  }

  if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor) })
  return segments
}

/** The text a reader sees, markup stripped — the string anchoring works on. */
export function inlineText(inline: InlineSegment[]): string {
  return inline.map((segment) => segment.text).join('')
}

// ---------------------------------------------------------------------------
// Claim anchoring
// ---------------------------------------------------------------------------

export interface AnchorableClaim {
  id: string
  text: string
}

/** A claim's place in the document: a character range within one unit. */
export interface ClaimAnchor {
  blockIndex: number
  /** Which list item, when the block is a list; null for a paragraph. */
  itemIndex: number | null
  start: number
  end: number
  claimId: string
}

export interface AnchorResult {
  anchors: ClaimAnchor[]
  /** Claims the matcher could not place. The screen must list these. */
  unanchoredIds: string[]
}

/**
 * Case- and quote-folding that PRESERVES string length, so an index found in
 * the folded text is valid in the original. Never collapse whitespace here.
 */
function fold(text: string): string {
  return text.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
}

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'been',
  'by',
  'for',
  'from',
  'had',
  'has',
  'have',
  'in',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'that',
  'the',
  'to',
  'was',
  'were',
  'which',
  'with',
])

/** Content words, numbers kept intact — "€1.9bn" and "2020" carry the match. */
function tokens(text: string): Set<string> {
  const folded = fold(text)
    // The two spellings a model alternates between for the same figure.
    .replace(/\s?billion\b/g, 'bn')
    .replace(/\bper cent\b/g, '%')
  const words = folded.match(/[€$£%]?[\p{L}\p{N}][\p{L}\p{N}.,']*/gu) ?? []
  return new Set(
    words.map((word) => word.replace(/[.,']+$/, '')).filter((word) => !STOPWORDS.has(word)),
  )
}

/** How much of the claim's content the sentence covers, 0..1. */
export function claimOverlap(claimText: string, sentence: string): number {
  const claim = tokens(claimText)
  if (claim.size === 0) return 0
  const candidate = tokens(sentence)
  let shared = 0
  for (const token of claim) if (candidate.has(token)) shared += 1
  return shared / claim.size
}

/**
 * Below this, a "match" is a coincidence of common words and highlighting it
 * would tell the reviewer a lie about where the claim came from.
 */
const ANCHOR_THRESHOLD = 0.55

interface Unit {
  blockIndex: number
  itemIndex: number | null
  text: string
}

function anchorableUnits(blocks: DossierBlock[]): Unit[] {
  const units: Unit[] = []
  blocks.forEach((block, blockIndex) => {
    if (block.kind === 'paragraph') {
      units.push({ blockIndex, itemIndex: null, text: inlineText(block.inline) })
    } else if (block.kind === 'list') {
      block.items.forEach((item, itemIndex) => {
        units.push({ blockIndex, itemIndex, text: inlineText(item) })
      })
    }
    // Headings are titles, not assertions; a claim never anchors to one.
  })
  return units
}

interface SentenceSpan {
  start: number
  end: number
}

function sentenceSpans(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = []
  let start = 0
  const boundary = /[.!?](?:\s+|$)/g
  for (const match of text.matchAll(boundary)) {
    const end = match.index + 1
    if (end > start) spans.push({ start, end })
    start = match.index + (match[0] as string).length
  }
  if (start < text.length) spans.push({ start, end: text.length })
  return spans
}

/**
 * Verbatim first, best sentence second, honesty third.
 *
 * Each claim independently finds its own best home, and two claims sharing a
 * sentence is allowed — a dense summary sentence really can carry two
 * extracted claims, and the highlight simply opens both.
 */
export function anchorClaims(blocks: DossierBlock[], claims: AnchorableClaim[]): AnchorResult {
  const units = anchorableUnits(blocks)
  const anchors: ClaimAnchor[] = []
  const unanchoredIds: string[] = []

  for (const claim of claims) {
    const needle = fold(claim.text).replace(/\s+/g, ' ').trim()

    let placed = false

    // 1. Verbatim (folded) substring — anchor exactly the quoted range.
    for (const unit of units) {
      const at = fold(unit.text).indexOf(needle)
      if (at >= 0) {
        anchors.push({
          blockIndex: unit.blockIndex,
          itemIndex: unit.itemIndex,
          start: at,
          end: at + needle.length,
          claimId: claim.id,
        })
        placed = true
        break
      }
    }
    if (placed) continue

    // 2. The sentence that best restates the claim, if any is close enough.
    let best: { unit: Unit; span: SentenceSpan; score: number } | null = null
    for (const unit of units) {
      for (const span of sentenceSpans(unit.text)) {
        const score = claimOverlap(claim.text, unit.text.slice(span.start, span.end))
        if (score >= ANCHOR_THRESHOLD && (best === null || score > best.score)) {
          best = { unit, span, score }
        }
      }
    }

    if (best) {
      anchors.push({
        blockIndex: best.unit.blockIndex,
        itemIndex: best.unit.itemIndex,
        start: best.span.start,
        end: best.span.end,
        claimId: claim.id,
      })
    } else {
      unanchoredIds.push(claim.id)
    }
  }

  return { anchors, unanchoredIds }
}

// ---------------------------------------------------------------------------
// Overlaying anchors onto inline segments
// ---------------------------------------------------------------------------

/** An inline piece plus the claims highlighted on it (empty = plain prose). */
export interface AnchoredSegment {
  segment: InlineSegment
  claimIds: string[]
}

/**
 * Splits inline segments at anchor boundaries so a highlight can start or end
 * mid-segment (inside a bold run, say) without disturbing the formatting.
 */
export function overlayAnchors(
  inline: InlineSegment[],
  anchors: readonly { start: number; end: number; claimId: string }[],
): AnchoredSegment[] {
  if (anchors.length === 0) return inline.map((segment) => ({ segment, claimIds: [] }))

  // Every offset where the set of covering claims can change.
  const cuts = new Set<number>()
  for (const anchor of anchors) {
    cuts.add(anchor.start)
    cuts.add(anchor.end)
  }

  const result: AnchoredSegment[] = []
  let offset = 0

  for (const segment of inline) {
    const end = offset + segment.text.length
    const local = [...cuts].filter((cut) => cut > offset && cut < end).sort((a, b) => a - b)

    let pieceStart = offset
    for (const pieceEnd of [...local, end]) {
      if (pieceEnd <= pieceStart) continue
      const text = segment.text.slice(pieceStart - offset, pieceEnd - offset)
      const claimIds = anchors
        .filter((anchor) => anchor.start < pieceEnd && anchor.end > pieceStart)
        .map((anchor) => anchor.claimId)
      result.push({ segment: { ...segment, text }, claimIds })
      pieceStart = pieceEnd
    }

    offset = end
  }

  return result
}
