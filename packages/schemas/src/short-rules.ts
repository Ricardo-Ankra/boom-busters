import { z } from 'zod'

/**
 * The playbook Shorts rule book (spec section 4): one definition of every
 * number the point-Short prompts, compiler checks and studio findings read.
 * Imports nothing from timeline.ts, which imports CropFocusSchema from here.
 */

export const SHORT_TYPES = [
  'forensic-breakdown',
  'contrarian-thesis',
  'incomplete-mechanism',
  'result-first',
] as const
export const ShortTypeSchema = z.enum(SHORT_TYPES)
export type ShortType = z.infer<typeof ShortTypeSchema>

export const SHORT_PHASES = ['hook', 'stakes', 'delivery', 'resolution', 'bridge'] as const
export const ShortPhaseSchema = z.enum(SHORT_PHASES)
export type ShortPhase = z.infer<typeof ShortPhaseSchema>

/** Slot types whose shot may run to `cardShotMaxMs`: a card is read, not watched. */
export const CARD_SLOT_TYPES = ['headline', 'social', 'chart'] as const

export const CropFocusSchema = z.enum(['left', 'centre', 'right'])
export type CropFocus = z.infer<typeof CropFocusSchema>

export const PointShotMotionSchema = z.enum(['static', 'kenburns-in', 'kenburns-out', 'punch'])
export type PointShotMotion = z.infer<typeof PointShotMotionSchema>

export const SHORT_RULES = {
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
  } satisfies Record<ShortPhase, number>,
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
  /** On the 1080 x 1920 frame. */
  safeArea: { x0: 60, x1: 960, y0: 380, y1: 1540 },
  newImagesMax: 4,
  pointsMin: 3,
  pointsMax: 5,
  paragraphGapMs: 150,
  kenburnsIntensity: 0.3,
} as const
