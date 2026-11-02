// @vitest-environment node

import {
  chapters,
  FIXTURE_PROJECT_ID,
  getShort,
  insertRender,
  notices,
  renders,
  requireTestDatabase,
  scripts,
  seed,
  shorts,
  talkingPointSets,
  timelines,
  updateShort,
  updateWorkspace,
} from '@boom-busters/db'
import { truncateLedger } from '@boom-busters/cost'
import {
  PointFetchesRecordSchema,
  PointPlanRecordSchema,
  PointScriptRecordSchema,
  PointVoiceRecordSchema,
  TimelineSchema,
} from '@boom-busters/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { seedPointShort } from '@/lib/point-studio.fixture'
import {
  assemblePoint,
  fetchPointShotOptions,
  generatePointStill,
  rebuildPointFromScript,
  replanPoint,
  revoicePoint,
  savePointScript,
  savePointShot,
} from './point-studio-actions'

/**
 * The point Short studio's actions against the test database, in
 * mock-provider mode, with only the seams a server action cannot bring to a
 * unit test (session, cache revalidation, the Inngest client) replaced. Each
 * action's refusals are the point: a bad script, a render mid-flight, a
 * rebuild when the Short is not behind, a second press while work is pending.
 */

vi.mock('@/auth', () => ({ auth: async () => ({ user: { email: 'owner@example.com' } }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/storage', () => ({
  storageConfigured: () => false,
  putObject: vi.fn(),
  stillKey: vi.fn(),
  stockKey: vi.fn(),
  takeStorage: () => 'regenerated' as const,
}))
const send = vi.hoisted(() => vi.fn())
vi.mock('@/inngest/client', () => ({ inngest: { send } }))

const describeDb = requireTestDatabase() ? describe : describe.skip

function sent(): { name: string; data: Record<string, unknown> }[] {
  return send.mock.calls
    .flatMap((call) => (Array.isArray(call[0]) ? call[0] : [call[0]]))
    .map(({ name, data }) => ({ name, data }))
}

describeDb('point studio actions', () => {
  let shortId: string
  let pointId: string

  async function stored() {
    return (await getShort(db, shortId))!
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.stubEnv('MOCK_PROVIDERS', '1')
    send.mockResolvedValue(undefined)
    await seed(db)
    await truncateLedger(db)
    await db.delete(notices)
    await db.delete(renders)
    await db.delete(shorts)
    await db.delete(timelines)
    await db.delete(talkingPointSets)
    await db.delete(chapters)
    await db.delete(scripts)
    await updateWorkspace(db, { budgets: { monthlyCeilingUsd: 100, approvedOverage: null } })
    const seeded = await seedPointShort()
    shortId = seeded.shortId
    pointId = seeded.point.id
  }, 120_000)

  describe('savePointScript', () => {
    const editable = async () => {
      const script = PointScriptRecordSchema.parse((await stored()).pointScript)
      return script.paragraphs.map(({ phase, text, chapterIndex }) => ({
        phase,
        text,
        chapterIndex,
      }))
    }

    it('stores an edit, keeps the script version, and drops a stale render', async () => {
      const paragraphs = await editable()
      paragraphs[1] = { ...paragraphs[1]!, text: 'The auditors never tested the cash at all.' }
      const render = await insertRender(db, {
        projectId: FIXTURE_PROJECT_ID,
        timelineVersion: 1,
        kind: 'short',
        shortId,
      })
      await updateShort(db, shortId, { renderId: render.id })

      expect(await savePointScript(shortId, paragraphs)).toEqual({ ok: true })

      const row = await stored()
      const script = PointScriptRecordSchema.parse(row.pointScript)
      expect(script.paragraphs[1]!.text).toBe('The auditors never tested the cash at all.')
      // The long form's version it was written from: an edit does not move it.
      expect(script.scriptVersion).toBe(1)
      expect(script.pointId).toBe(pointId)
      expect(row.renderId).toBeNull()
      // Saving never re-voices or re-plans.
      expect(send).not.toHaveBeenCalled()
    })

    it('refuses phases out of order, naming the order', async () => {
      const paragraphs = await editable()
      const swapped = [paragraphs[1]!, paragraphs[0]!, ...paragraphs.slice(2)]

      const result = await savePointScript(shortId, swapped)

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/hook, stakes, delivery, resolution, bridge/)
      expect(PointScriptRecordSchema.parse((await stored()).pointScript).paragraphs[0]!.phase).toBe(
        'hook',
      )
    })

    it('refuses a script that is missing a phase', async () => {
      const paragraphs = (await editable()).filter((paragraph) => paragraph.phase !== 'stakes')

      const result = await savePointScript(shortId, [
        ...paragraphs,
        { ...paragraphs[0]!, phase: 'bridge' },
      ])

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/stakes/)
    })

    it('refuses a paragraph that is too short, and a chapter past the last', async () => {
      const paragraphs = await editable()
      expect(
        (
          await savePointScript(shortId, [
            { ...paragraphs[0]!, text: 'Too short' },
            ...paragraphs.slice(1),
          ])
        ).ok,
      ).toBe(false)

      const past = await savePointScript(shortId, [
        { ...paragraphs[0]!, chapterIndex: 9 },
        ...paragraphs.slice(1),
      ])
      expect(past.ok).toBe(false)
      expect(past.error).toMatch(/chapter/)
    })

    it('refuses while a re-voice is running', async () => {
      await revoicePoint(shortId)

      const result = await savePointScript(shortId, await editable())

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/already running/)
    })
  })

  describe('revoicePoint and replanPoint', () => {
    it('re-voice sends one voice request and refuses a second while it is pending', async () => {
      expect(await revoicePoint(shortId)).toEqual({ ok: true })
      const second = await revoicePoint(shortId)

      expect(second.ok).toBe(false)
      expect(second.error).toMatch(/re-voice is already running/)
      expect(sent()).toHaveLength(1)
      expect(sent()[0]).toMatchObject({
        name: 'shorts/point.studio.requested',
        data: { projectId: FIXTURE_PROJECT_ID, shortId, op: 'voice', note: null },
      })
    })

    it('two presses together send once', async () => {
      const results = await Promise.all([revoicePoint(shortId), revoicePoint(shortId)])

      expect(results.filter((result) => result.ok)).toHaveLength(1)
      expect(sent()).toHaveLength(1)
    })

    it('re-plan sends the note, and a blank note as null', async () => {
      expect(await replanPoint(shortId, '  fewer headlines, more footage  ')).toEqual({ ok: true })
      expect(sent()[0]).toMatchObject({
        data: { op: 'plan', note: 'fewer headlines, more footage' },
      })

      await updateShort(db, shortId, {
        pointFetches: { candidates: [], state: null },
      })
      expect(await replanPoint(shortId, '   ')).toEqual({ ok: true })
      expect(sent()[1]).toMatchObject({ data: { op: 'plan', note: null } })
    })

    it('re-plan refuses a voice that is not the script, and a note that is too long', async () => {
      const script = PointScriptRecordSchema.parse((await stored()).pointScript)
      await updateShort(db, shortId, {
        pointScript: {
          ...script,
          paragraphs: script.paragraphs.map((paragraph, index) =>
            index === 0 ? { ...paragraph, text: `${paragraph.text} Edited since.` } : paragraph,
          ),
        },
      })

      const result = await replanPoint(shortId, '')
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/Re-voice first/)

      expect((await replanPoint(shortId, 'x'.repeat(501))).ok).toBe(false)
      expect(send).not.toHaveBeenCalled()
    })

    it('gives the slot back when Inngest cannot be reached', async () => {
      send.mockRejectedValueOnce(new Error('down'))

      const failed = await revoicePoint(shortId)
      expect(failed.ok).toBe(false)
      expect(failed.error).toMatch(/Inngest/)

      expect(await revoicePoint(shortId)).toEqual({ ok: true })
    })
  })

  describe('savePointShot', () => {
    it("swaps a shot for one of the long form's slots, with its crop and motion", async () => {
      const result = await savePointShot(shortId, 1, { ref: 3 }, 'right', 'kenburns-out')

      expect(result).toEqual({ ok: true })
      const plan = PointPlanRecordSchema.parse((await stored()).pointPlan)
      expect(plan.shots[1]).toMatchObject({ crop: 'right', motion: 'kenburns-out', pending: null })
      expect(plan.shots[1]!.slot?.payload).toMatchObject({
        kind: 'image',
        src: { r2Key: 'boom-busters/stills/3.png' },
      })
    })

    it('keeps the picture and changes only crop and motion when no choice is given', async () => {
      const before = PointPlanRecordSchema.parse((await stored()).pointPlan)

      expect(await savePointShot(shortId, 0, null, 'left', 'punch')).toEqual({ ok: true })

      const after = PointPlanRecordSchema.parse((await stored()).pointPlan)
      expect(after.shots[0]).toMatchObject({ crop: 'left', motion: 'punch' })
      expect(after.shots[0]!.slot).toEqual(before.shots[0]!.slot)
    })

    it('picks a fetched option as the slot it becomes', async () => {
      const pool = PointFetchesRecordSchema.parse((await stored()).pointFetches)
      const candidate = pool.candidates[0]!

      const result = await savePointShot(
        shortId,
        2,
        { candidateId: candidate.id },
        'centre',
        'static',
      )

      expect(result).toEqual({ ok: true })
      const plan = PointPlanRecordSchema.parse((await stored()).pointPlan)
      expect(plan.shots[2]!.slot?.payload.kind).toMatch(/image|video/)
    })

    it('refuses an unknown shot, library slot or fetched option', async () => {
      expect((await savePointShot(shortId, 99, { ref: 0 }, 'centre', 'static')).error).toBe(
        'Unknown shot.',
      )
      expect((await savePointShot(shortId, 0, { ref: 99 }, 'centre', 'static')).error).toMatch(
        /long form/,
      )
      expect(
        (await savePointShot(shortId, 0, { candidateId: 'nope' }, 'centre', 'static')).error,
      ).toMatch(/pool/)
    })
  })

  describe('the fetch actions', () => {
    it('a stock search fills the pool and gives the slot back', async () => {
      const result = await fetchPointShotOptions(shortId, 0, 'ledger pages')

      expect(result).toEqual({ ok: true })
      const pool = PointFetchesRecordSchema.parse((await stored()).pointFetches)
      expect(pool.state).toBeNull()
      expect(pool.candidates.length).toBeGreaterThan(0)
    })

    it('a generated still adds to the pool and keeps what was bought', async () => {
      const before = PointFetchesRecordSchema.parse((await stored()).pointFetches).candidates

      expect(await generatePointStill(shortId, 0, 'A cracked ledger on a desk')).toEqual({
        ok: true,
      })

      const after = PointFetchesRecordSchema.parse((await stored()).pointFetches).candidates
      expect(after.length).toBeGreaterThan(before.length)
      expect(after.slice(0, before.length).map((entry) => entry.id)).toEqual(
        before.map((entry) => entry.id),
      )
    })

    it('refuses a bad query, a bad prompt and an unknown shot', async () => {
      expect((await fetchPointShotOptions(shortId, 0, 'a')).ok).toBe(false)
      expect((await generatePointStill(shortId, 0, 'no')).ok).toBe(false)
      expect((await fetchPointShotOptions(shortId, 99, 'ledger pages')).error).toBe('Unknown shot.')
    })

    it('refuses a second request while one is fresh, and allows one after the cooldown', async () => {
      const candidates = PointFetchesRecordSchema.parse((await stored()).pointFetches).candidates
      await updateShort(db, shortId, {
        pointFetches: {
          candidates,
          state: { state: 'fetching', what: 'still', startedAt: new Date().toISOString() },
        },
      })

      const refused = await generatePointStill(shortId, 0, 'A cracked ledger on a desk')
      expect(refused.ok).toBe(false)
      expect(refused.error).toMatch(/still is already running/)

      await updateShort(db, shortId, {
        pointFetches: {
          candidates,
          state: {
            state: 'fetching',
            what: 'still',
            startedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
          },
        },
      })
      expect(await generatePointStill(shortId, 0, 'A cracked ledger on a desk')).toEqual({
        ok: true,
      })
    })
  })

  describe('assemblePoint', () => {
    it('compiles the stored cut, nulls the render pointer and asks for one render', async () => {
      const render = await insertRender(db, {
        projectId: FIXTURE_PROJECT_ID,
        timelineVersion: 1,
        kind: 'short',
        shortId,
      })
      await updateShort(db, shortId, { renderId: render.id, sourceTimeline: null })
      // Settled, so it may be rebuilt.
      await db.update(renders).set({ status: 'done' })

      expect(await assemblePoint(shortId)).toEqual({ ok: true })

      const row = await stored()
      expect(TimelineSchema.safeParse(row.sourceTimeline).success).toBe(true)
      expect(row.renderId).toBeNull()
      expect(PointFetchesRecordSchema.parse(row.pointFetches).state).toBeNull()
      expect(sent()).toEqual([
        {
          name: 'shorts/render.requested',
          data: { projectId: FIXTURE_PROJECT_ID, shortId },
        },
      ])
    })

    it('refuses while the last render is still moving', async () => {
      const render = await insertRender(db, {
        projectId: FIXTURE_PROJECT_ID,
        timelineVersion: 1,
        kind: 'short',
        shortId,
      })
      await updateShort(db, shortId, { renderId: render.id })

      const result = await assemblePoint(shortId)

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/already rendering/)
      expect(send).not.toHaveBeenCalled()
    })

    it('refuses a voice that has fallen behind the script', async () => {
      const script = PointScriptRecordSchema.parse((await stored()).pointScript)
      await updateShort(db, shortId, {
        pointScript: {
          ...script,
          paragraphs: script.paragraphs.map((paragraph, index) =>
            index === 2 ? { ...paragraph, text: `${paragraph.text} Edited since.` } : paragraph,
          ),
        },
      })

      const result = await assemblePoint(shortId)

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/could not be assembled.*voice it again/)
      expect(send).not.toHaveBeenCalled()
      // The refusal gave the slot back.
      expect(PointFetchesRecordSchema.parse((await stored()).pointFetches).state).toBeNull()
    })

    it('refuses a shot that still waits for its picture', async () => {
      const plan = PointPlanRecordSchema.parse((await stored()).pointPlan)
      await updateShort(db, shortId, {
        pointPlan: {
          ...plan,
          shots: plan.shots.map((shot, index) =>
            index === 1
              ? { ...shot, slot: null, pending: { kind: 'stock', query: 'ledger' } }
              : shot,
          ),
        },
      })

      const result = await assemblePoint(shortId)

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/waits for its new picture/)
    })

    it('two presses together request one render', async () => {
      const results = await Promise.all([assemblePoint(shortId), assemblePoint(shortId)])

      expect(results.filter((result) => result.ok).length).toBeGreaterThanOrEqual(1)
      expect(sent().filter((event) => event.name === 'shorts/render.requested')).toHaveLength(
        results.filter((result) => result.ok).length,
      )
      expect(results.filter((result) => result.ok).length).toBe(1)
    })
  })

  describe('rebuildPointFromScript', () => {
    it('refuses when the Short is not behind the long form', async () => {
      const result = await rebuildPointFromScript(shortId)

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/current script/)
      expect(send).not.toHaveBeenCalled()
      expect((await stored()).pointScript).not.toBeNull()
    })

    it('clears the records so it becomes a draft, then asks for the build', async () => {
      await db.insert(scripts).values({ projectId: FIXTURE_PROJECT_ID, version: 2 })

      expect(await rebuildPointFromScript(shortId)).toEqual({ ok: true })

      const row = await stored()
      expect(row.pointScript).toBeNull()
      expect(row.pointVoice).toBeNull()
      expect(row.pointPlan).toBeNull()
      expect(row.pointFetches).toBeNull()
      expect(row.sourceTimeline).toBeNull()
      expect(row.renderId).toBeNull()
      expect(sent()).toEqual([
        { name: 'shorts/point.build.requested', data: { projectId: FIXTURE_PROJECT_ID, pointId } },
      ])
    })

    it('a second press finds nothing left to rebuild', async () => {
      await db.insert(scripts).values({ projectId: FIXTURE_PROJECT_ID, version: 2 })

      const results = await Promise.all([
        rebuildPointFromScript(shortId),
        rebuildPointFromScript(shortId),
      ])
      const third = await rebuildPointFromScript(shortId)

      expect(results.filter((result) => result.ok)).toHaveLength(1)
      expect(third.ok).toBe(false)
      expect(sent()).toHaveLength(1)
    })

    it('puts the Short back as it was when Inngest cannot be reached', async () => {
      await db.insert(scripts).values({ projectId: FIXTURE_PROJECT_ID, version: 2 })
      const before = await stored()
      send.mockRejectedValueOnce(new Error('down'))

      const result = await rebuildPointFromScript(shortId)

      expect(result.ok).toBe(false)
      const after = await stored()
      expect(after.pointScript).toEqual(before.pointScript)
      expect(PointVoiceRecordSchema.safeParse(after.pointVoice).success).toBe(true)
      expect(after.sourceTimeline).toEqual(before.sourceTimeline)
    })

    it('refuses while the Short is rendering', async () => {
      await db.insert(scripts).values({ projectId: FIXTURE_PROJECT_ID, version: 2 })
      const render = await insertRender(db, {
        projectId: FIXTURE_PROJECT_ID,
        timelineVersion: 1,
        kind: 'short',
        shortId,
      })
      await updateShort(db, shortId, { renderId: render.id })

      const result = await rebuildPointFromScript(shortId)

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/rendering/)
    })
  })

  it('refuses a Short that is not a point Short, and an id that is not one', async () => {
    expect((await revoicePoint('not-an-id')).error).toBe('Unknown Short')
    await updateShort(db, shortId, {})
    await db.update(shorts).set({ kind: 'teaser' })
    expect((await revoicePoint(shortId)).error).toMatch(/point Short/)
  })
})
