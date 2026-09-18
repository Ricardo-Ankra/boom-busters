// @vitest-environment node

import {
  claims,
  createScriptVersion,
  FIXTURE_PROJECT_ID,
  getShotSlot,
  listShotSlots,
  replaceShotList,
  requireTestDatabase,
  saveChapter,
  seed,
  setSlotRetype,
  setVisualsPhase,
  shotSlots,
  truncateRunMirror,
} from '@boom-busters/db'
import type { ShotBrief } from '@boom-busters/schemas'
import { InngestTestEngine } from '@inngest/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { slotRebriefer } from './slot-rebriefer'

/**
 * The slot-rebriefer against the real database, in mock-provider mode
 * (decision 258): a new brief lands whole and keeps the sentence it covers,
 * the steer reaches the draft, a chart goes back through the claim-validated
 * path, and a slot the button is not offered on refuses in words rather than
 * leaving the card drafting something that never arrives.
 */

const notify = vi.fn()
vi.mock('@/lib/notify', () => ({
  notify: (...args: unknown[]) => notify(...args),
}))

const describeDb = requireTestDatabase() ? describe : describe.skip

/** Any well-formed id: the schema checks the shape, the model checks the rest. */
const SOME_CLAIM = '01HQ00000000000000000000AA'

const stockBrief: ShotBrief = {
  type: 'stock',
  coversText: 'By June, the auditors could not find the money.',
  description: 'Deserted open-plan office at dusk.',
  motion: { kind: 'static' },
  transition: 'cut',
  query: 'empty office dusk',
  rejectionCriteria: ['no watermarks'],
}

function rebriefEvent(
  slotId: string,
  guidance?: string,
): [{ name: string; data: Record<string, unknown> }] {
  return [
    {
      name: 'visuals/rebrief.requested',
      data: {
        projectId: FIXTURE_PROJECT_ID,
        slotId,
        ...(guidance === undefined ? {} : { guidance }),
      },
    },
  ]
}

describeDb('slot-rebriefer (mock mode)', () => {
  let engine: InngestTestEngine
  let slotId = ''

  async function seedSlot(brief: ShotBrief): Promise<string> {
    await db.delete(shotSlots)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    const chapter = await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The audit',
      contentMd: 'By June, the auditors could not find the money.',
      estRuntimeSec: 30,
    })
    await replaceShotList(db, FIXTURE_PROJECT_ID, [
      { chapterId: chapter.id, index: 0, type: brief.type, brief, startMs: 0, durationMs: 8000 },
    ])
    const [slot] = await listShotSlots(db, FIXTURE_PROJECT_ID)
    return slot!.id
  }

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: slotRebriefer })
    vi.clearAllMocks()
    vi.stubEnv('MOCK_PROVIDERS', '1')
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
    slotId = await seedSlot(stockBrief)
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'plan')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('replaces the idea, keeps the sentence and the format, and clears the marker', async () => {
    await setSlotRetype(db, slotId, { state: 'rebriefing' })
    const { result } = await engine.execute({ events: rebriefEvent(slotId) })
    expect(result).toMatchObject({ outcome: 'rebriefed' })

    const slot = await getShotSlot(db, slotId)
    const brief = slot?.brief as { type: string; description: string; coversText: string }
    expect(brief.type).toBe('stock')
    // A different idea, not the same one again: that is the whole button.
    expect(brief.description).not.toBe(stockBrief.description)
    // The slot keeps its place in the film.
    expect(brief.coversText).toBe(stockBrief.coversText)
    // The brief is new, so whatever was fetched was fetched for the old one.
    expect(slot?.status).toBe('unresolved')
    // Plan phase pays for nothing; "Fetch visuals" does that later.
    expect(slot?.candidates).toEqual([])
    expect(slot?.retype).toBeNull()
  })

  it('carries the owner’s steer into the draft', async () => {
    await engine.execute({ events: rebriefEvent(slotId, 'People, not another empty room.') })
    const slot = await getShotSlot(db, slotId)
    expect((slot?.brief as { description: string }).description).toContain('another empty room')
  })

  it('sends a chart back through the claim-validated path', async () => {
    const chart: ShotBrief = {
      type: 'chart',
      coversText: stockBrief.coversText,
      description: 'The collapse, drawn on.',
      motion: { kind: 'static' },
      transition: 'cut',
      chartKind: 'line',
      series: [
        {
          label: 'Share price',
          unit: 'EUR',
          points: [
            { x: '2020-06-17', y: 104.5 },
            { x: '2020-06-26', y: 1.28 },
          ],
        },
      ],
      // A chart may never cite nothing, by schema, so even the fixture has to
      // name a claim: the rule is what this test is here to keep.
      dataRefs: [SOME_CLAIM],
      takeaway: 'From 104 to 1.28.',
      reveal: 'draw-on',
    }
    const chartSlot = await seedSlot(chart)

    const { result } = await engine.execute({
      events: rebriefEvent(chartSlot, 'The whole decade, not just the crash.'),
    })
    expect(result).toMatchObject({ outcome: 'rebriefed' })

    const brief = (await getShotSlot(db, chartSlot))?.brief as {
      type: string
      dataRefs: string[]
    }
    // Still a chart, and still citing a claim that exists on this project:
    // asking for a different one does not suspend the sourcing rule.
    expect(brief.type).toBe('chart')
    expect(brief.dataRefs).toHaveLength(1)
  })

  it('refuses on the row when the claims cannot support a new chart', async () => {
    const chart: ShotBrief = {
      type: 'chart',
      coversText: stockBrief.coversText,
      description: 'The collapse, drawn on.',
      motion: { kind: 'static' },
      transition: 'cut',
      chartKind: 'line',
      series: [
        {
          label: 'Share price',
          unit: 'EUR',
          points: [
            { x: '2020-06-17', y: 104.5 },
            { x: '2020-06-26', y: 1.28 },
          ],
        },
      ],
      dataRefs: [SOME_CLAIM],
      takeaway: 'The one the owner is keeping.',
      reveal: 'none',
    }
    const chartSlot = await seedSlot(chart)
    await db.delete(claims)

    const { result } = await engine.execute({ events: rebriefEvent(chartSlot) })
    expect(result).toMatchObject({ outcome: 'refused' })

    const slot = await getShotSlot(db, chartSlot)
    // The brief it has survives, and the reason is where the board reads it.
    expect((slot?.brief as { takeaway: string }).takeaway).toBe('The one the owner is keeping.')
    expect(slot?.retype).toMatchObject({ state: 'rebrief-refused' })
    expect((slot?.retype as { reason: string }).reason).toMatch(/claims/i)
  })

  it('refuses a headline in words rather than leaving the card drafting', async () => {
    const headline: ShotBrief = {
      type: 'headline',
      coversText: stockBrief.coversText,
      description: 'The morning the story broke.',
      motion: { kind: 'static' },
      transition: 'cut',
      sourceClaimId: '01HQ00000000000000000000AA',
    }
    const headlineSlot = await seedSlot(headline)
    await setSlotRetype(db, headlineSlot, { state: 'rebriefing' })

    const { result } = await engine.execute({ events: rebriefEvent(headlineSlot) })
    expect(result).toMatchObject({ outcome: 'refused' })

    const slot = await getShotSlot(db, headlineSlot)
    expect(slot?.retype).toMatchObject({ state: 'rebrief-refused' })
    expect((slot?.retype as { reason: string }).reason).toMatch(/read from the article/i)
  })
})
