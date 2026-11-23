import { SHORT_RULES } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { RELATED_ARROW_LAYOUT } from './RelatedArrow'
import { SUBSCRIBE_BADGE_LAYOUT } from './SubscribeBadge'
import { channelInitials, containScale, END_CARD_LAYOUT, endCardSlotBox } from './EndCard'
import { FOLLOW_CARD_LAYOUT } from './FollowCard'

const { x0, x1, y0, y1 } = SHORT_RULES.safeArea

describe('the bridge overlays sit inside the Short safe area', () => {
  it('keeps the related-arrow label inside it, and only the tip outside', () => {
    const { label, tip, tail } = RELATED_ARROW_LAYOUT
    expect(label.x).toBeGreaterThanOrEqual(x0)
    expect(label.x + label.width).toBeLessThanOrEqual(x1)
    expect(label.y).toBeGreaterThanOrEqual(y0)
    expect(label.y + label.height).toBeLessThanOrEqual(y1)
    expect(tail.y).toBeGreaterThanOrEqual(label.y + label.height)
    expect(tip).toEqual({ x: 120, y: 1700 })
    // The tip is the one allowed exception, and it points down and left.
    expect(tip.y).toBeGreaterThan(y1)
    expect(tip.x).toBeLessThan(tail.x)
    expect(tip.y).toBeGreaterThan(tail.y)
  })

  it('keeps the subscribe badge centred with its bottom edge inside it', () => {
    const { width, height, bottom, frameWidth } = SUBSCRIBE_BADGE_LAYOUT
    const left = (frameWidth - width) / 2
    expect(left).toBeGreaterThanOrEqual(x0)
    expect(left + width).toBeLessThanOrEqual(x1)
    expect(bottom).toBeLessThanOrEqual(y1)
    // Both overlays run together in a bridge: the badge must clear the arrow label.
    expect(bottom).toBeLessThanOrEqual(RELATED_ARROW_LAYOUT.label.y)
    expect(bottom - height).toBeGreaterThanOrEqual(y0)
  })
})

describe('the end card and follow card (decisions 479, 481)', () => {
  const { channel, kicker, frame, title, chapters } = END_CARD_LAYOUT

  it('keeps every end card box inside the safe area, above the call to action', () => {
    for (const box of [channel, kicker, title, chapters]) {
      expect(box.x).toBeGreaterThanOrEqual(x0)
      expect(box.y).toBeGreaterThanOrEqual(y0)
    }
    expect(frame.x).toBeGreaterThanOrEqual(x0)
    expect(frame.x + frame.width).toBeLessThanOrEqual(x1)
    expect(title.x + title.width).toBeLessThanOrEqual(x1)
    expect(frame.width / frame.height).toBeCloseTo(16 / 9, 1)
    // Three chapter rows end before the arrow's label begins.
    expect(chapters.y + 22 + 3 * 48).toBeLessThanOrEqual(RELATED_ARROW_LAYOUT.label.y)
  })

  it('keeps the follow card inside the safe area on a Short frame', () => {
    const { logo, name, prompt, tall } = FOLLOW_CARD_LAYOUT
    const top = tall.stackTop * 1920
    expect(top).toBeGreaterThanOrEqual(y0)
    // The mark, the gap and the name's line end well before the prompt.
    expect(top + logo.size + logo.gap + name.px * 1.1).toBeLessThan(tall.promptTop * 1920 - 100)
    // The prompt and its chevron.
    expect(tall.promptTop * 1920 + prompt.px * 1.3 + 14 + 56).toBeLessThanOrEqual(y1)
  })

  it('spaces the follow card on a film frame, everything on screen (decision 482)', () => {
    const { logo, name, prompt, wide } = FOLLOW_CARD_LAYOUT
    const top = wide.stackTop * 1080
    expect(top).toBeGreaterThanOrEqual(108)
    expect(top + logo.size + logo.gap + name.px * 1.1).toBeLessThan(wide.promptTop * 1080 - 100)
    expect(wide.promptTop * 1080 + prompt.px * 1.3 + 14 + 56).toBeLessThanOrEqual(1080 - 54)
  })

  it('resizes the picture onto the frame, starting from the full frame (decision 481)', () => {
    expect(endCardSlotBox(0, 1080, 1920)).toEqual({
      left: 0,
      top: 0,
      width: 1080,
      height: 1920,
      radius: 0,
    })
    expect(endCardSlotBox(END_CARD_LAYOUT.shrinkMs, 1080, 1920)).toEqual({
      left: frame.x,
      top: frame.y,
      width: frame.width,
      height: frame.height,
      radius: frame.radius,
    })
    // Half way the box is between the two, on both axes.
    const mid = endCardSlotBox(END_CARD_LAYOUT.shrinkMs / 2, 1080, 1920)
    expect(mid.width).toBeLessThan(1080)
    expect(mid.width).toBeGreaterThan(frame.width)
    expect(mid.height).toBeLessThan(1920)
    expect(mid.height).toBeGreaterThan(frame.height)
  })

  it('fits a drawn slot whole inside the box', () => {
    const box = { width: frame.width, height: frame.height }
    const s = containScale(box, 1080, 1920)
    expect(1080 * s).toBeLessThanOrEqual(box.width)
    expect(1920 * s).toBeCloseTo(box.height, 6)
    expect(containScale({ width: 1080, height: 1920 }, 1080, 1920)).toBe(1)
  })
})

describe('channelInitials', () => {
  it('keeps the ampersand', () => {
    expect(channelInitials('Boom & Busters')).toBe('B&B')
    expect(channelInitials('the paper trail')).toBe('TPT')
  })
})
