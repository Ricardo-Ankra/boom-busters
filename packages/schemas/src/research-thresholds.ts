import { z } from 'zod'

/**
 * Per-channel research thresholds. The first five are the numbers the brief
 * verdict and the keyword picker already use; they are repeated here as
 * literals so this module imports nothing from them (no cycle). A test pins
 * them to the existing constants.
 */
export interface ResearchThresholds {
  demandWarn: number
  demandOk: number
  openDoorMaxSubscribers: number
  openDoorMinViews: number
  pickFloor: number
  searchShareMin: number
  targetShareMin: number
  targetViewsMin: number
  listedViewsMin: number
  holdRatio: number
  tooEarlyViews: number
}

export const DEFAULT_RESEARCH_THRESHOLDS: ResearchThresholds = {
  demandWarn: 1_000,
  demandOk: 5_000,
  openDoorMaxSubscribers: 100_000,
  openDoorMinViews: 10_000,
  pickFloor: 50,
  searchShareMin: 0.1,
  targetShareMin: 0.25,
  targetViewsMin: 20,
  listedViewsMin: 50,
  holdRatio: 0.8,
  tooEarlyViews: 100,
}

export const THRESHOLD_BOUNDS: Record<keyof ResearchThresholds, [number, number]> = {
  demandWarn: [100, 5_000],
  demandOk: [1_000, 50_000],
  openDoorMaxSubscribers: [10_000, 1_000_000],
  openDoorMinViews: [1_000, 100_000],
  pickFloor: [20, 80],
  searchShareMin: [0.05, 0.3],
  targetShareMin: [0.1, 0.5],
  targetViewsMin: [10, 100],
  listedViewsMin: [25, 250],
  holdRatio: [0.5, 1],
  tooEarlyViews: [50, 500],
}

export const ResearchThresholdsSchema = z.object({
  demandWarn: z.number(),
  demandOk: z.number(),
  openDoorMaxSubscribers: z.number(),
  openDoorMinViews: z.number(),
  pickFloor: z.number(),
  searchShareMin: z.number(),
  targetShareMin: z.number(),
  targetViewsMin: z.number(),
  listedViewsMin: z.number(),
  holdRatio: z.number(),
  tooEarlyViews: z.number(),
})
