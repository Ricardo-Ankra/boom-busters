import { SHORT_RULES } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { RELATED_ARROW_LAYOUT } from './RelatedArrow'
import { SUBSCRIBE_BADGE_LAYOUT } from './SubscribeBadge'

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
