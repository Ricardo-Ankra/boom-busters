import type {
  BrandKitTokens,
  MediaRef,
  SocialPayload,
  SocialPostRecord,
  TypeRole,
} from '@boom-busters/schemas'
import {
  POST_MEDIA_ONLY_REASON,
  articleSourceLabel,
  excerptPlacement,
  missingPostFields,
  phraseIn,
  postInitials,
  postPublicUrl,
} from '@boom-busters/schemas'
import { frameScale } from '../components/brand'
import { glyphAdvanceEm, graphicDrift, safeArea, type GraphicFrame } from './graphic'
import { easeInOut } from './motion'

/**
 * The social post card's geometry (decision 284), pure and unit-tested. The
 * Remotion card and the board's resting card both draw from this, and both
 * let CSS do the wrapping with the same fonts, so the only estimate here is
 * the one that picks the text size. The card's height follows its content:
 * a line more than estimated grows the card, and the 10 per cent held back
 * by MAX_HEIGHT_FRACTION keeps even that inside the safe area.
 *
 * Sizes are DRAWN pixels. The brand's roles give the family, weight,
 * tracking and case; their `sizeScale` is not applied on top (decision 283).
 */

export const SOCIAL_LINE_HEIGHT = 1.3
/** At 1080p, largest first, about 10 per cent a step. */
const LADDER_WIDE = [60, 54, 48, 44, 40, 37, 34] as const
const LADDER_TALL = [64, 58, 52, 47, 43, 39, 36] as const
const CARD_WIDTH_FRACTION = { wide: 0.52, tall: 0.88 } as const
const PADDING_PX = { wide: 48, tall: 44 } as const
const MEDIA_MAX_PX = { wide: 260, tall: 380 } as const
/** The Shorts player's own top bar, which nothing should sit under. */
const SHORTS_TOP_FRACTION = 0.1
const MAX_HEIGHT_FRACTION = 0.9
const AVATAR_PX = 88
const NAME_PX = 34
const META_PX = 26
const SOURCE_PX = 22
const HEADER_GAP_PX = 28
const MEDIA_GAP_PX = 24
const SOURCE_GAP_PX = 24
/** Glyphs a proportional estimate under-reads: CJK, Hangul, full-width forms and emoji, about 1 em each. */
const WIDE_CHARACTER = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|\p{Extended_Pictographic}/u
const ENTITY = /(@\w{1,15}|#\w+|https?:\/\/\S+)/g

export interface SocialLayout {
  portrait: boolean
  /** The vertical band the card is centred in: below the Shorts bar, above the captions. */
  band: { top: number; height: number }
  card: { width: number; maxHeight: number; padding: number }
  avatarPx: number
  namePx: number
  metaPx: number
  sourcePx: number
  textPx: number
  mediaMaxPx: number
  headerGapPx: number
  mediaGapPx: number
  sourceGapPx: number
  estimatedHeight: number
  /** False when even the smallest size overflows `card.maxHeight`: the post needs an excerpt. */
  fits: boolean
}

function advanceEm(char: string, type: TypeRole): number {
  return WIDE_CHARACTER.test(char) ? 1 : glyphAdvanceEm(type)
}

export function wordWidthPx(word: string, px: number, type: TypeRole): number {
  let em = 0
  for (const char of word) em += advanceEm(char, type)
  return em * px
}

/** Lines the text wraps to, word by word, keeping its own line breaks; a word wider than the line breaks anywhere. */
export function estimateLines(text: string, px: number, widthPx: number, type: TypeRole): number {
  const space = glyphAdvanceEm(type) * px
  let lines = 0
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter((word) => word !== '')
    if (words.length === 0) {
      lines += 1
      continue
    }
    let line = 0
    for (const word of words) {
      const width = wordWidthPx(word, px, type)
      if (width > widthPx) {
        if (line > 0) lines += 1
        const whole = Math.floor(width / widthPx)
        lines += whole
        line = width - whole * widthPx
        continue
      }
      if (line === 0) line = width
      else if (line + space + width <= widthPx) line += space + width
      else {
        lines += 1
        line = width
      }
    }
    lines += 1
  }
  return lines
}

/** The words as the card prints them, with an ellipsis at each cut. */
export function socialDisplayText(text: string, cutBefore: boolean, cutAfter: boolean): string {
  return `${cutBefore ? '… ' : ''}${text}${cutAfter ? ' …' : ''}`
}

export interface SocialProgress {
  /** 0 to 1 across the card's own entrance. */
  settle: number
  /** 0 to 1 across the emphasis marker's sweep. */
  sweep: number
  /** The graphic card's slow lift, so a post is never a dead still either. */
  drift: number
}

/** The board's resting card: settled, swept and undrifted, exactly what `graphicDrift` gives past its slot. */
export const RESTING_SOCIAL_PROGRESS: SocialProgress = { settle: 1, sweep: 1, drift: 1 }

const SETTLE_MS = 420
const SWEEP_DELAY_MS = 700
const SWEEP_MS = 520

function motionProgress(frame: number, fps: number, delayMs: number, ms: number): number {
  const tMs = (frame / fps) * 1000 - delayMs
  return easeInOut(Math.min(1, Math.max(0, tMs / ms)))
}

/**
 * The card's motion at `frame` (decision 284): the headline card's own
 * settle-then-sweep entrance, plus the graphic card's slow drift spread
 * across the whole slot.
 */
export function socialProgress(
  frame: number,
  fps: number,
  durationInFrames: number,
): SocialProgress {
  return {
    settle: motionProgress(frame, fps, 0, SETTLE_MS),
    sweep: motionProgress(frame, fps, SWEEP_DELAY_MS, SWEEP_MS),
    drift: graphicDrift(frame, durationInFrames),
  }
}

export function socialLayout(input: {
  text: string
  hasMedia: boolean
  frame: GraphicFrame
  brand: BrandKitTokens
}): SocialLayout {
  const { frame, brand } = input
  const portrait = frame.height > frame.width
  const scale = frameScale(frame.width, frame.height)
  const safe = safeArea(frame)
  const top = portrait ? Math.max(safe.y, frame.height * SHORTS_TOP_FRACTION) : safe.y
  const bandHeight = safe.y + safe.h - top
  const width = frame.width * (portrait ? CARD_WIDTH_FRACTION.tall : CARD_WIDTH_FRACTION.wide)
  const padding = (portrait ? PADDING_PX.tall : PADDING_PX.wide) * scale
  const inner = width - padding * 2
  const maxHeight = bandHeight * MAX_HEIGHT_FRACTION
  const mediaMaxPx = input.hasMedia ? (portrait ? MEDIA_MAX_PX.tall : MEDIA_MAX_PX.wide) * scale : 0
  const avatarPx = AVATAR_PX * scale
  const sourcePx = SOURCE_PX * scale
  const headerGapPx = HEADER_GAP_PX * scale
  const mediaGapPx = MEDIA_GAP_PX * scale
  const sourceGapPx = SOURCE_GAP_PX * scale
  const fixed =
    padding * 2 +
    avatarPx +
    headerGapPx +
    (input.hasMedia ? mediaGapPx + mediaMaxPx : 0) +
    sourceGapPx +
    sourcePx * SOCIAL_LINE_HEIGHT
  const type = brand.typography.body
  const heightAt = (px: number) =>
    fixed + estimateLines(input.text, px, inner, type) * px * SOCIAL_LINE_HEIGHT

  const ladder = (portrait ? LADDER_TALL : LADDER_WIDE).map((px) => px * scale)
  const chosen = ladder.find((px) => heightAt(px) <= maxHeight)
  const textPx = chosen ?? ladder[ladder.length - 1]!
  return {
    portrait,
    band: { top, height: bandHeight },
    card: { width, maxHeight, padding },
    avatarPx,
    namePx: NAME_PX * scale,
    metaPx: META_PX * scale,
    sourcePx,
    textPx,
    mediaMaxPx,
    headerGapPx,
    mediaGapPx,
    sourceGapPx,
    estimatedHeight: heightAt(textPx),
    fits: chosen !== undefined,
  }
}

export function needsExcerpt(
  text: string,
  hasMedia: boolean,
  brand: BrandKitTokens,
  frame: GraphicFrame,
): boolean {
  return !socialLayout({ text, hasMedia, frame, brand }).fits
}

export interface PostSegment {
  text: string
  /** A mention, hashtag or link: drawn in the accent colour. */
  entity: boolean
  /** Inside the highlight phrase: drawn under the marker. */
  emphasised: boolean
}

function tokenise(text: string, emphasised: boolean): PostSegment[] {
  return text
    .split(ENTITY)
    .filter((part) => part !== '')
    .map((part) => ({
      text: part,
      entity: new RegExp(`^${ENTITY.source}$`).test(part),
      emphasised,
    }))
}

/** The display text cut into runs the card colours and marks. Whitespace inside the phrase may differ from the text's. */
export function postSegments(display: string, emphasis: string | undefined): PostSegment[] {
  const words =
    emphasis
      ?.trim()
      .split(/\s+/)
      .filter((word) => word !== '') ?? []
  if (words.length === 0) return tokenise(display, false)
  const pattern = new RegExp(
    words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'),
  )
  const hit = pattern.exec(display)
  if (!hit) return tokenise(display, false)
  return [
    ...tokenise(display.slice(0, hit.index), false),
    ...tokenise(hit[0], true),
    ...tokenise(display.slice(hit.index + hit[0].length), false),
  ]
}

function spans(
  text: string,
  pattern: RegExp,
  from = 0,
  to = text.length,
): { start: number; end: number }[] {
  const found: { start: number; end: number }[] = []
  const region = text.slice(from, to)
  for (const match of region.matchAll(pattern)) {
    if (match[0].trim() === '') continue
    found.push({
      start: from + (match.index ?? 0),
      end: from + (match.index ?? 0) + match[0].length,
    })
  }
  return found
}

function grow(
  text: string,
  units: { start: number; end: number }[],
  anchor: number,
  fits: (candidate: string) => boolean,
): string | null {
  if (units.length === 0) return null
  let first = anchor
  let last = anchor
  const slice = (a: number, b: number) => text.slice(units[a]!.start, units[b]!.end).trim()
  if (!fits(slice(first, last))) return null
  while (last + 1 < units.length && fits(slice(first, last + 1))) last += 1
  while (first > 0 && fits(slice(first - 1, last))) first -= 1
  return slice(first, last)
}

/**
 * A word-for-word excerpt to offer the owner: the paragraph holding the
 * highlight (or the first), grown a paragraph at a time while it fits; a
 * paragraph too long on its own falls back to its sentences. Null when not
 * even one sentence fits, and the owner types the cut.
 */
export function suggestExcerpt(
  text: string,
  emphasis: string | undefined,
  fits: (candidate: string) => boolean,
): string | null {
  const paragraphs = spans(text, /[^\n]+/g)
  const at = (units: { start: number; end: number }[]) => {
    if (emphasis === undefined) return 0
    const index = units.findIndex((unit) => phraseIn(text.slice(unit.start, unit.end), emphasis))
    return Math.max(0, index)
  }
  const byParagraph = grow(text, paragraphs, at(paragraphs), fits)
  if (byParagraph !== null) return byParagraph
  const host = paragraphs[at(paragraphs)]
  if (!host) return null
  const sentences = spans(text, /[^.!?]+[.!?]*\s*/g, host.start, host.end)
  return grow(text, sentences, at(sentences), fits)
}

export const SOCIAL_MISSING_PREFIX =
  'A post card needs the name, the handle, the text and the date. Missing: '
export const SOCIAL_TOO_LONG = 'This post is too long to show in full. Choose the part to show.'
export const SOCIAL_EXCERPT_NOT_VERBATIM = 'The excerpt must be copied word for word from the post.'
export const SOCIAL_EXCERPT_TOO_LONG = 'Still too long for the card.'
export const SOCIAL_HIGHLIGHT_OUTSIDE =
  'The highlight must be words from the part of the post on screen.'

/**
 * Every frame a social card is drawn in, and so every frame its fit is
 * judged in (decision 284, spec 5.5): the 1920x1080 master, and the
 * 1080x1920 Shorts frame, because ShortVertical renders DocumentaryMaster
 * over the master's own slot payloads. A post that fits one and not the
 * other would clip in the other, so readiness asks both.
 */
export const SOCIAL_FRAMES = [
  { width: 1920, height: 1080 },
  { width: 1080, height: 1920 },
] as const satisfies readonly GraphicFrame[]

export type { GraphicFrame }

/** True when the display text needs an excerpt in ANY of the frames. */
export function needsExcerptIn(
  text: string,
  hasMedia: boolean,
  brand: BrandKitTokens,
  frames: readonly GraphicFrame[],
): boolean {
  return frames.some((frame) => needsExcerpt(text, hasMedia, brand, frame))
}

/** Why this slot cannot show yet, in the board's words; empty when it can. The one rule resolution, the board and assembly share. */
export function socialSlotIssues(input: {
  post: SocialPostRecord | null
  excerpt?: string
  emphasis?: string
  hasMedia: boolean
  /** Every frame the card is drawn in: `SOCIAL_FRAMES` everywhere but a test. */
  frames: readonly GraphicFrame[]
  brand: BrandKitTokens
}): string[] {
  const { post } = input
  if (!post) return [`${SOCIAL_MISSING_PREFIX}the post itself.`]
  if (post.text === null && post.endedWithMediaLink) return [POST_MEDIA_ONLY_REASON]
  const missing = missingPostFields(post)
  if (missing.length > 0) return [`${SOCIAL_MISSING_PREFIX}${missing.join(', ')}.`]
  const text = post.text as string
  const issues: string[] = []
  let shown = text
  let cuts = { cutBefore: false, cutAfter: false }
  if (input.excerpt !== undefined) {
    const placement = excerptPlacement(text, input.excerpt)
    if (!placement) return [SOCIAL_EXCERPT_NOT_VERBATIM]
    shown = input.excerpt
    cuts = placement
  }
  const display = socialDisplayText(shown, cuts.cutBefore, cuts.cutAfter)
  if (needsExcerptIn(display, input.hasMedia, input.brand, input.frames)) {
    issues.push(input.excerpt === undefined ? SOCIAL_TOO_LONG : SOCIAL_EXCERPT_TOO_LONG)
  }
  if (input.emphasis !== undefined && !phraseIn(shown, input.emphasis))
    issues.push(SOCIAL_HIGHLIGHT_OUTSIDE)
  return issues
}

/** The timeline payload for a ready slot; null when `socialSlotIssues` would name anything. */
export function buildSocialPayload(input: {
  post: SocialPostRecord
  excerpt?: string
  emphasis?: string
  avatar?: MediaRef
  media?: MediaRef
  claimId: string
  frames: readonly GraphicFrame[]
  brand: BrandKitTokens
}): SocialPayload | null {
  const issues = socialSlotIssues({ ...input, hasMedia: input.media !== undefined })
  if (issues.length > 0) return null
  const { post } = input
  const placement =
    input.excerpt !== undefined ? excerptPlacement(post.text as string, input.excerpt) : null
  const publicUrl = postPublicUrl(post)
  return {
    kind: 'social',
    platform: 'x',
    authorName: post.authorName as string,
    handle: post.handle as string,
    text: input.excerpt ?? (post.text as string),
    cutBefore: placement?.cutBefore ?? false,
    cutAfter: placement?.cutAfter ?? false,
    postedAt: post.postedAt as string,
    ...(input.emphasis !== undefined ? { emphasis: input.emphasis } : {}),
    ...(input.avatar ? { avatar: input.avatar } : {}),
    initials: postInitials(post.authorName as string),
    ...(input.media ? { media: input.media } : {}),
    sourceLabel: articleSourceLabel(publicUrl),
    sourceUrl: publicUrl,
    claimId: input.claimId,
  }
}
