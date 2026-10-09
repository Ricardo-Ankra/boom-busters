// @vitest-environment node

import {
  addNotice,
  claims,
  createScriptVersion,
  deleteCastMember,
  deleteProjectSet,
  FIXTURE_PROJECT_ID,
  insertCastMember,
  insertProjectSet,
  setCastPhotos,
  getShotSlot,
  listProjectNotices,
  listShotSlots,
  notices,
  replaceShotList,
  requireTestDatabase,
  saveChapter,
  seed,
  setSlotRetype,
  setVisualsPhase,
  shotSlots,
  truncateRunMirror,
} from '@boom-busters/db'
import { ContentPolicyError, noticesFor } from '@boom-busters/schemas'
import type { GraphicBrief, ShotBrief } from '@boom-busters/schemas'
import { InngestTestEngine } from '@inngest/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { rebriefReferences, slotRebriefer } from './slot-rebriefer'

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

const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))

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

// Decision 276: a still's redraft is told who is photographed and which rooms
// the film holds, so a steer naming them becomes "depicts" and "set".
describeDb('rebriefReferences', () => {
  it('reads the photographed cast and every set, with its look and inventory', async () => {
    const emad = await insertCastMember(db, {
      projectId: FIXTURE_PROJECT_ID,
      name: 'Rebrief Photographed',
      role: 'Founder',
    })
    await setCastPhotos(db, emad.id, [
      {
        r2Key: 'boom-busters/cast/p/h.jpg',
        contentHash: 'h',
        mimeType: 'image/jpeg',
        width: 800,
        height: 1000,
        view: 'front',
      },
    ])
    const bare = await insertCastMember(db, {
      projectId: FIXTURE_PROJECT_ID,
      name: 'Rebrief Unphotographed',
      role: 'Investor',
    })
    const room = await insertProjectSet(db, {
      projectId: FIXTURE_PROJECT_ID,
      name: 'Rebrief Boardroom',
      look: 'a long glass table',
    })
    try {
      const references = await rebriefReferences(FIXTURE_PROJECT_ID)
      expect(references.photographed).toContain('Rebrief Photographed')
      expect(references.photographed).not.toContain('Rebrief Unphotographed')
      expect(references.sets).toContainEqual({
        name: 'Rebrief Boardroom',
        look: 'a long glass table',
        layout: '',
      })
    } finally {
      await deleteCastMember(db, emad.id)
      await deleteCastMember(db, bare.id)
      await deleteProjectSet(db, room.id)
    }
  })
})

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

  const designedGraphic: GraphicBrief = {
    type: 'graphic',
    coversText: stockBrief.coversText,
    description: 'The missing sum, large.',
    motion: { kind: 'static' },
    transition: 'cut',
    intent: 'The money is simply gone.',
    scene: {
      elements: [
        {
          kind: 'text',
          id: 'old',
          cell: { col: 1, row: 3, colSpan: 10, rowSpan: 2 },
          content: 'Old design',
          role: 'heading',
          align: 'start',
          color: 'textPrimary',
          enter: { kind: 'fade', atMs: 0 },
        },
      ],
    },
  }

  it('redesigns a graphic from its intent with the steer (decision 289)', async () => {
    const graphicId = await seedSlot(designedGraphic)
    await setSlotRetype(db, graphicId, { state: 'rebriefing' })
    const { result } = await engine.execute({ events: rebriefEvent(graphicId, 'bigger') })
    expect(result).toMatchObject({ outcome: 'rebriefed' })

    const slot = await getShotSlot(db, graphicId)
    const brief = slot?.brief as { intent: string; scene: { elements: { content?: string }[] } }
    // A redesign keeps the intent; the mock designer titles a steered design with the steer.
    expect(brief.intent).toBe('The money is simply gone.')
    expect(brief.scene.elements[0]?.content).toBe('[mock] Redesigned: bigger')
    expect(slot?.retype).toBeNull()
  })

  it('keeps the old design when the redesign is refused (decision 289)', async () => {
    const design = await import('@/lib/graphic-design')
    const refuse = vi
      .spyOn(design, 'designGraphic')
      .mockResolvedValueOnce({ ok: false, issue: 'element "f" enters at 900 ms' })
    try {
      const graphicId = await seedSlot(designedGraphic)
      const { result } = await engine.execute({ events: rebriefEvent(graphicId) })
      expect(result).toMatchObject({ outcome: 'refused' })

      const slot = await getShotSlot(db, graphicId)
      expect((slot?.brief as { scene: unknown }).scene).toEqual(designedGraphic.scene)
      expect(slot?.retype).toEqual({
        state: 'rebrief-refused',
        reason: 'element "f" enters at 900 ms',
      })
    } finally {
      refuse.mockRestore()
    }
  })
})

describeDb('slot-rebriefer on the answer helper (decision 293)', () => {
  let engine: InngestTestEngine

  async function seedOne(brief: ShotBrief): Promise<string> {
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
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'plan')
    const [slot] = await listShotSlots(db, FIXTURE_PROJECT_ID)
    return slot!.id
  }

  const slotNotices = async (slotId: string) =>
    noticesFor(await listProjectNotices(db, FIXTURE_PROJECT_ID), 'slot', slotId).map(
      ({ kind, message }) => ({ kind, message }),
    )

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: slotRebriefer })
    vi.clearAllMocks()
    callLlm.mockReset()
    vi.stubEnv('MOCK_PROVIDERS', '')
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
    await db.delete(notices)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('asks once more with the reason after a refused draft, then puts the reason on the card', async () => {
    const slotId = await seedOne(stockBrief)
    callLlm.mockResolvedValue({ text: 'not json at all' })

    const { result } = await engine.execute({ events: rebriefEvent(slotId) })

    expect(result).toMatchObject({ outcome: 'refused' })
    expect(callLlm).toHaveBeenCalledTimes(2)
    expect(callLlm.mock.calls[1]![1]).toMatchObject({ purpose: 'retry: refused' })
    expect(callLlm.mock.calls[1]![0].messages.at(-1).content).toContain(
      'Your previous answer was refused: The model returned no JSON for new brief.',
    )
    const slot = await getShotSlot(db, slotId)
    expect(slot?.retype).toEqual({
      state: 'rebrief-refused',
      reason: 'The model returned no JSON for new brief. It answered: not json at all',
    })
    expect((slot?.brief as { description: string }).description).toBe(stockBrief.description)
  })

  it("takes a decline in the model's own words as final, after one call", async () => {
    const slotId = await seedOne(stockBrief)
    callLlm.mockResolvedValue({
      text: JSON.stringify({ error: 'This beat has only one honest image.' }),
    })

    const { result } = await engine.execute({ events: rebriefEvent(slotId) })

    expect(result).toMatchObject({
      outcome: 'refused',
      reason: 'This beat has only one honest image.',
    })
    expect(callLlm).toHaveBeenCalledTimes(1)
    expect((await getShotSlot(db, slotId))?.retype).toEqual({
      state: 'rebrief-refused',
      reason: 'This beat has only one honest image.',
    })
  })

  it("takes the provider's content refusal as final, after one call", async () => {
    const slotId = await seedOne(stockBrief)
    callLlm.mockRejectedValue(new ContentPolicyError('google', 'SAFETY'))

    const { result } = await engine.execute({ events: rebriefEvent(slotId) })

    expect(result).toMatchObject({ outcome: 'refused', reason: 'google: SAFETY' })
    expect(callLlm).toHaveBeenCalledTimes(1)
    expect((await getShotSlot(db, slotId))?.retype).toEqual({
      state: 'rebrief-refused',
      reason: 'google: SAFETY',
    })
  })

  it("records what the repair capped on the slot's card", async () => {
    const map: ShotBrief = {
      type: 'map',
      coversText: stockBrief.coversText,
      description: 'Where the money went.',
      motion: { kind: 'static' },
      transition: 'cut',
      locations: [{ label: 'Munich', lat: 48.14, lon: 11.58 }],
      route: false,
    }
    const slotId = await seedOne(map)
    const places = Array.from({ length: 9 }, (_, at) => ({
      label: `City ${at + 1}`,
      lat: 10 + at,
      lon: 20 + at,
    }))
    callLlm.mockResolvedValue({
      text: JSON.stringify({
        brief: { ...map, description: 'Nine cities, one trail.', locations: places, route: true },
      }),
    })

    const { result } = await engine.execute({ events: rebriefEvent(slotId) })

    expect(result).toMatchObject({ outcome: 'rebriefed' })
    expect(callLlm).toHaveBeenCalledTimes(1)
    const brief = (await getShotSlot(db, slotId))?.brief as { locations: unknown[] }
    expect(brief.locations).toEqual(places.slice(0, 8))
    expect(await slotNotices(slotId)).toEqual([
      { kind: 'trimmed', message: "Kept the first 8 of the map's places." },
    ])
  })

  it("retires the slot's old notice when a clean brief lands", async () => {
    const slotId = await seedOne(stockBrief)
    await addNotice(
      db,
      { projectId: FIXTURE_PROJECT_ID, subject: 'slot', subjectId: slotId },
      { kind: 'stopped', message: 'The re-brief stopped: over budget.' },
    )
    callLlm.mockResolvedValue({
      text: JSON.stringify({
        brief: {
          ...stockBrief,
          description: 'A crowded trading floor at the open.',
          query: 'trading floor crowd',
        },
      }),
    })

    const { result } = await engine.execute({ events: rebriefEvent(slotId) })

    expect(result).toMatchObject({ outcome: 'rebriefed' })
    expect(await slotNotices(slotId)).toEqual([])
  })
})
