import {
  DEFAULT_RESEARCH_THRESHOLDS,
  THRESHOLD_BOUNDS,
  type ResearchThresholds,
} from '@boom-busters/schemas'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { Database } from './client'
import { researchSuggestionDismissals, researchTuning } from './schema'
import type { ResearchTuningRow } from './schema'

/**
 * Per-channel research thresholds: the defaults overlaid with the values the
 * owner applied from a suggestion. A reset deletes the row, so "default" is
 * simply the absence of one.
 */

export type ThresholdKey = keyof ResearchThresholds

const isKey = (key: string): key is ThresholdKey =>
  Object.prototype.hasOwnProperty.call(DEFAULT_RESEARCH_THRESHOLDS, key)

function clamp(key: ThresholdKey, value: number): number {
  const [min, max] = THRESHOLD_BOUNDS[key]
  return Math.min(max, Math.max(min, value))
}

/** The channel's thresholds. Unknown keys are ignored and values are clamped, so a stale row never throws. */
export async function channelResearchThresholds(
  db: Database,
  channelId: string,
): Promise<ResearchThresholds> {
  const rows = await db.select().from(researchTuning).where(eq(researchTuning.channelId, channelId))
  const out: ResearchThresholds = { ...DEFAULT_RESEARCH_THRESHOLDS }
  for (const row of rows) {
    if (isKey(row.key) && Number.isFinite(row.value)) out[row.key] = clamp(row.key, row.value)
  }
  return out
}

/**
 * Apply one threshold. The value is clamped to its bounds. Refuses a result
 * where `demandOk` would sit at or below `demandWarn`, since the demand line
 * would then have no "warn" band.
 */
export async function applyResearchTuning(
  db: Database,
  input: { channelId: string; key: ThresholdKey; value: number; evidence: string },
): Promise<ResearchTuningRow> {
  if (!isKey(input.key)) throw new Error(`unknown research threshold: ${input.key}`)
  if (!Number.isFinite(input.value)) throw new Error('threshold value must be a number')
  const value = clamp(input.key, input.value)
  return db.transaction(async (tx) => {
    const current = await channelResearchThresholds(tx as unknown as Database, input.channelId)
    const next = { ...current, [input.key]: value }
    if (next.demandOk <= next.demandWarn) {
      throw new Error('demandOk must be above demandWarn')
    }
    const [row] = await tx
      .insert(researchTuning)
      .values({
        channelId: input.channelId,
        key: input.key,
        value,
        previous: current[input.key],
        evidence: input.evidence,
      })
      .onConflictDoUpdate({
        target: [researchTuning.channelId, researchTuning.key],
        set: {
          value,
          previous: current[input.key],
          evidence: input.evidence,
          appliedAt: sql`now()`,
        },
      })
      .returning()
    return row!
  })
}

/** Back to the default for one key. */
export async function resetResearchTuning(
  db: Database,
  channelId: string,
  key: ThresholdKey,
): Promise<void> {
  await db
    .delete(researchTuning)
    .where(and(eq(researchTuning.channelId, channelId), eq(researchTuning.key, key)))
}

export async function listResearchTuning(
  db: Database,
  channelId: string,
): Promise<ResearchTuningRow[]> {
  return db
    .select()
    .from(researchTuning)
    .where(eq(researchTuning.channelId, channelId))
    .orderBy(asc(researchTuning.key))
}

/** Remember a dismissed suggestion and the support it had; a repeat dismissal updates the figure. */
export async function dismissSuggestion(
  db: Database,
  input: { channelId: string; key: ThresholdKey; direction: 'raise' | 'lower'; support: number },
): Promise<void> {
  await db
    .insert(researchSuggestionDismissals)
    .values({
      channelId: input.channelId,
      key: input.key,
      direction: input.direction,
      supportAtDismissal: input.support,
    })
    .onConflictDoUpdate({
      target: [
        researchSuggestionDismissals.channelId,
        researchSuggestionDismissals.key,
        researchSuggestionDismissals.direction,
      ],
      set: { supportAtDismissal: input.support, createdAt: sql`now()` },
    })
}

export async function suggestionDismissals(
  db: Database,
  channelId: string,
): Promise<{ key: ThresholdKey; direction: 'raise' | 'lower'; supportAtDismissal: number }[]> {
  const rows = await db
    .select()
    .from(researchSuggestionDismissals)
    .where(eq(researchSuggestionDismissals.channelId, channelId))
  return rows
    .filter((r) => isKey(r.key))
    .map((r) => ({
      key: r.key as ThresholdKey,
      direction: r.direction,
      supportAtDismissal: r.supportAtDismissal,
    }))
}
