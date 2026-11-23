import { SHORT_RULES } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { RELATED_ARROW_LAYOUT } from './RelatedArrow'
import { SUBSCRIBE_BADGE_LAYOUT } from './SubscribeBadge'
import { channelInitials, END_CARD_LAYOUT, endCardSlotStyle } from './EndCard'
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

describe('the end card and follow card (decision 479)', () => {
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

  it('keeps the follow card inside the safe area', () => {
    const { stack, logo, prompt } = FOLLOW_CARD_LAYOUT
    expect(stack.y).toBeGreaterThanOrEqual(y0)
    expect((1080 - stack.width) / 2).toBeGreaterThanOrEqual(x0)
    // Mark, name, a two-line headline and a two-line line clear the prompt.
    expect(stack.y + logo.size + 44 + 36 + 18 + 200 + 30 + 104).toBeLessThanOrEqual(prompt.y)
    expect(prompt.y + 110).toBeLessThanOrEqual(y1)
  })

  it('shrinks the picture onto the frame, starting from the full frame', () => {
    const start = endCardSlotStyle(0, 1080, 1920)
    expect(start.transform).toBe('translate(0px, 0px) scale(1)')
    expect(start.clipPath).toBe('inset(0px 0px 0px 0px round 0px)')

    const end = endCardSlotStyle(END_CARD_LAYOUT.shrinkMs, 1080, 1920)
    const s = frame.width / 1080
    const dx = frame.x + frame.width / 2 - 540
    const dy = frame.y + frame.height / 2 - 960
    expect(end.transform).toBe(`translate(${dx}px, ${dy}px) scale(${s})`)
    // The clip, mapped back to the screen, is exactly the frame.
    const [top, right, bottom, left] = String(end.clipPath)
      .match(/inset\(([^)]*) round/)![1]!
      .split(' ')
      .map((value) => Number.parseFloat(value))
    const toScreen = (local: number, centre: number, d: number) => centre + (local - centre) * s + d
    expect(toScreen(left!, 540, dx)).toBeCloseTo(frame.x, 6)
    expect(toScreen(top!, 960, dy)).toBeCloseTo(frame.y, 6)
    expect(toScreen(1080 - right!, 540, dx)).toBeCloseTo(frame.x + frame.width, 6)
    expect(toScreen(1920 - bottom!, 960, dy)).toBeCloseTo(frame.y + frame.height, 6)
  })
})

describe('channelInitials', () => {
  it('keeps the ampersand', () => {
    expect(channelInitials('Boom & Busters')).toBe('B&B')
    expect(channelInitials('the paper trail')).toBe('TPT')
  })
})
