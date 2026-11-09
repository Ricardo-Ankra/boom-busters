import {
  DEFAULT_RESEARCH_THRESHOLDS,
  FrozenVerdictSchema,
  THRESHOLD_BOUNDS,
  type CaseResearchJob,
  type SearchBrief,
} from '@boom-busters/schemas'
import { sql as dsql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createCase, saveCaseSearchBrief, writeCaseResearchJob } from './cases'
import { createDb } from './client'
import { ensureFirstChannel } from './channels'
import { FIRST_CHANNEL_ID } from '@boom-busters/schemas'
import { createProjectFromCase } from './projects'
import {
  applyResearchTuning,
  channelResearchThresholds,
  dismissSuggestion,
  listResearchTuning,
  resetResearchTuning,
  suggestionDismissals,
} from './research-tuning'
import { cases, researchSuggestionDismissals, researchTuning } from './schema'
import { requireTestDatabase } from './test-database'

/** Frozen verdicts and per-channel thresholds against a real database. */

const url = requireTestDatabase()
const suite = url ? describe : describe.skip

const kw = (keyword: string, searches: number) => ({
  keyword,
  volume: 50,
  competition: 20,
  overall: 80,
  estimatedMonthlySearch: searches,
  growthPct: null,
})

function briefFor(subject: string, searches: number): SearchBrief {
  return {
    subject,
    measuredAt: '2026-11-01T10:00:00.000Z',
    targetKeyword: { ...kw('wework collapse', searches), fit: 'fits', topic: 'wework' },
    secondaryKeywords: [],
    searchedQuestions: [],
    outliers: [],
    titlePatterns: [],
    toldAlready: [],
    angleOptions: [
      {
        angle: 'The lease story nobody read before the collapse',
        keyword: 'wework',
        answers: [],
        gap: 'x',
      },
    ],
    chosenAngle: null,
    formatKey: null,
    fit: null,
    searchedTitles: [],
    otherLanguages: [],
    recommendedAngle: 0,
    recommendationReason: null,
    ownAngle: false,
  }
}

suite('research tuning and frozen verdicts', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })
  const channelId = FIRST_CHANNEL_ID

  beforeEach(async () => {
    await db.execute(dsql`truncate table ${cases} restart identity cascade`)
    await db.delete(researchTuning)
    await db.delete(researchSuggestionDismissals)
    await ensureFirstChannel(db)
  })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  async function researchedCase(subject: string, searches: number) {
    const row = await createCase(db, {
      channelId,
      title: `Case ${subject}`,
      category: 'con',
      subject,
    })
    const job: CaseResearchJob = {
      state: 'running',
      current: null,
      error: null,
      startedAt: 't1',
      subject,
    }
    await writeCaseResearchJob(db, row.id, () => job)
    await saveCaseSearchBrief(db, row.id, briefFor(subject, searches), 't1')
    return row.id
  }

  it('createProjectFromCase freezes the verdict with the thresholds it used, and none without a brief', async () => {
    const caseId = await researchedCase('WeWork', 600)
    const thresholds = { ...DEFAULT_RESEARCH_THRESHOLDS, demandWarn: 500, demandOk: 600 }
    const project = await createProjectFromCase(db, {
      caseId,
      title: 'WeWork',
      verdictContext: { thresholds },
    })
    const frozen = FrozenVerdictSchema.parse(project.researchVerdict)
    expect(frozen.thresholds).toEqual(thresholds)
    expect(frozen.recomputed).toBeUndefined()
    expect(frozen.lines.find((l) => l.check === 'demand')?.state).toBe('ok')

    const defaults = await createProjectFromCase(db, { caseId, title: 'WeWork again' })
    const withDefaults = FrozenVerdictSchema.parse(defaults.researchVerdict)
    expect(withDefaults.thresholds).toEqual(DEFAULT_RESEARCH_THRESHOLDS)
    expect(withDefaults.lines.find((l) => l.check === 'demand')?.state).toBe('bad')

    const bare = await createCase(db, { channelId, title: 'No brief', category: 'con' })
    const none = await createProjectFromCase(db, { caseId: bare.id, title: 'No brief' })
    expect(none.researchVerdict).toBeNull()
  })

  it('apply clamps to bounds, refuses demandOk at or below demandWarn, and reset returns the default', async () => {
    expect((await channelResearchThresholds(db, channelId)).pickFloor).toBe(50)

    await applyResearchTuning(db, { channelId, key: 'pickFloor', value: 5, evidence: 'e' })
    expect((await channelResearchThresholds(db, channelId)).pickFloor).toBe(
      THRESHOLD_BOUNDS.pickFloor[0],
    )
    const [row] = await listResearchTuning(db, channelId)
    expect(row?.previous).toBe(50)

    await expect(
      applyResearchTuning(db, { channelId, key: 'demandWarn', value: 5_000, evidence: 'e' }),
    ).rejects.toThrow(/demandOk/)
    await expect(
      applyResearchTuning(db, { channelId, key: 'demandOk', value: 1_000, evidence: 'e' }),
    ).rejects.toThrow(/demandOk/)

    await resetResearchTuning(db, channelId, 'pickFloor')
    expect((await channelResearchThresholds(db, channelId)).pickFloor).toBe(50)
    expect(await listResearchTuning(db, channelId)).toEqual([])
  })

  it('reads never throw on an unknown key or an out of bounds value', async () => {
    await db.insert(researchTuning).values([
      { channelId, key: 'nonsense', value: 1, evidence: '' },
      { channelId, key: 'holdRatio', value: 9, evidence: '' },
    ])
    const t = await channelResearchThresholds(db, channelId)
    expect(t.holdRatio).toBe(1)
    expect('nonsense' in t).toBe(false)
  })

  it('a dismissal is one row per key and direction and keeps the latest support', async () => {
    await dismissSuggestion(db, { channelId, key: 'pickFloor', direction: 'lower', support: 3 })
    await dismissSuggestion(db, { channelId, key: 'pickFloor', direction: 'lower', support: 5 })
    await dismissSuggestion(db, { channelId, key: 'pickFloor', direction: 'raise', support: 4 })
    const all = await suggestionDismissals(db, channelId)
    expect(all).toHaveLength(2)
    expect(all.find((d) => d.direction === 'lower')?.supportAtDismissal).toBe(5)
  })
})
