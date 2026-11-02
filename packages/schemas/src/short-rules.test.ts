import { describe, expect, it } from 'vitest'
import { CARD_SLOT_TYPES, SHORT_PHASES, SHORT_RULES, SHORT_TYPES } from './short-rules'

describe('short rules', () => {
  it('pins the playbook numbers', () => {
    expect(SHORT_RULES).toEqual({
      wordsMin: 110,
      wordsMax: 160,
      runtimeMinMs: 45_000,
      runtimeMaxMs: 60_000,
      wpmMin: 150,
      wpmMax: 170,
      phaseEndMs: {
        hook: 3_000,
        stakes: 15_000,
        delivery: 42_000,
        resolution: 52_000,
        bridge: 60_000,
      },
      bridgeMinMs: 5_000,
      bridgeMaxMs: 8_000,
      shotMinMs: 1_500,
      shotTargetMaxMs: 2_500,
      shotMaxMs: 3_500,
      cardShotMaxMs: 4_500,
      hookPunchByMs: 1_200,
      punchScale: 1.15,
      punchMs: 250,
      tailMaxMs: 100,
      safeArea: { x0: 60, x1: 960, y0: 380, y1: 1540 },
      newImagesMax: 4,
      pointsMin: 3,
      pointsMax: 5,
      paragraphGapMs: 150,
      kenburnsIntensity: 0.3,
    })
    expect(SHORT_PHASES).toEqual(['hook', 'stakes', 'delivery', 'resolution', 'bridge'])
    expect(SHORT_TYPES).toEqual([
      'forensic-breakdown',
      'contrarian-thesis',
      'incomplete-mechanism',
      'result-first',
    ])
    expect(CARD_SLOT_TYPES).toEqual(['headline', 'social', 'chart'])
  })
})
