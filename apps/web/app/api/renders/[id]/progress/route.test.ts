// @vitest-environment node

import {
  FIXTURE_CASE_ID,
  FIXTURE_PROJECT_ID,
  createProjectFromCase,
  deleteProject,
  insertRender,
  requireTestDatabase,
  seed,
  setProjectStage,
  updateRender,
  updateRenderParts,
} from '@boom-busters/db'
import { newId, type RenderPart } from '@boom-busters/schemas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { GET } from './route'

vi.mock('@/auth', () => ({ auth: async () => ({ user: { email: 'owner@example.com' } }) }))
const broker = vi.hoisted(() => ({ fetchRenderProgress: vi.fn(), presignRenderOutput: vi.fn() }))
vi.mock('@/lib/broker', () => ({
  brokerConfigured: () => true,
  fetchRenderProgress: (...args: unknown[]) => broker.fetchRenderProgress(...args),
  presignRenderOutput: (...args: unknown[]) => broker.presignRenderOutput(...args),
}))

const describeDb = requireTestDatabase() ? describe : describe.skip

function twelveParts(completed: number): RenderPart[] {
  return Array.from({ length: 12 }, (_, index) => ({
    index,
    renderId: newId(),
    frameRange: [index * 100, index * 100 + 99] as [number, number],
    startMs: index * 1000,
    durationMs: 1000,
    status: index < completed ? 'completed' : index === completed ? 'rendering' : 'queued',
    attempt: 1,
    priorRenderIds: [],
  }))
}

async function poll(id: string): Promise<Record<string, unknown>> {
  const response = await GET(new Request(`http://localhost/api/renders/${id}/progress`), {
    params: Promise.resolve({ id }),
  })
  return (await response.json()) as Record<string, unknown>
}

describeDb('GET /api/renders/[id]/progress for a master in parts', () => {
  let projectId = ''

  beforeEach(async () => {
    vi.clearAllMocks()
    await seed(db)
    projectId = (
      await createProjectFromCase(db, { caseId: FIXTURE_CASE_ID, title: 'Progress parts (unit)' })
    ).id
  })

  afterEach(async () => {
    await deleteProject(db, projectId)
    await setProjectStage(db, FIXTURE_PROJECT_ID, { stage: 'dossier', stageStatus: 'queued' })
  })

  it('weights a parts render by frames and names the part', async () => {
    const row = await insertRender(db, { projectId, timelineVersion: 1, kind: 'master' })
    const parts = twelveParts(4)
    await updateRender(db, row.id, { status: 'rendering', startedAt: new Date() })
    await updateRenderParts(db, row.id, parts)
    broker.fetchRenderProgress.mockImplementation(async (renderId: string) => {
      if (renderId !== parts[4]!.renderId) throw new Error('unexpected poll')
      return { status: 'rendering', overallProgress: 0.4 }
    })

    const body = await poll(row.id)

    expect(body['progressPct']).toBe(37)
    expect(body['partNote']).toBe('Part 5 of 12')
    expect(body['parts']).toHaveLength(12)
    expect(body['parts']).toContainEqual({ index: 4, startMs: 4000 })
  })

  it('copes with a rendering part the broker has no record of yet', async () => {
    const row = await insertRender(db, { projectId, timelineVersion: 1, kind: 'master' })
    await updateRender(db, row.id, { status: 'rendering', startedAt: new Date() })
    await updateRenderParts(db, row.id, twelveParts(4))
    broker.fetchRenderProgress.mockRejectedValue(new Error('404'))

    const body = await poll(row.id)

    expect(body['progressPct']).toBe(33)
    expect(body['partNote']).toBe('Part 5 of 12')
  })

  it('presigns the joined master for a done parts render', async () => {
    const row = await insertRender(db, { projectId, timelineVersion: 1, kind: 'master' })
    await updateRender(db, row.id, {
      status: 'done',
      progressPct: 100,
      outputS3Key: `renders/${row.id}/master.mp4`,
      completedAt: new Date(),
    })
    await updateRenderParts(
      db,
      row.id,
      twelveParts(12).map((part) => ({ ...part, status: 'completed' as const })),
    )
    broker.presignRenderOutput.mockResolvedValue('https://signed.example.com/master.mp4')

    const body = await poll(row.id)

    expect(broker.presignRenderOutput).toHaveBeenCalledWith(`renders/${row.id}/master.mp4`)
    expect(body['outputUrl']).toBe('https://signed.example.com/master.mp4')
    expect(body['partNote']).toBeUndefined()
    expect(body['parts']).toHaveLength(12)
  })
})
