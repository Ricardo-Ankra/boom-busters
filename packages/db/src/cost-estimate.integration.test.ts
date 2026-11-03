import { DEFAULT_SETTINGS, EMPTY_BIBLE } from '@boom-busters/schemas'
import { sql as dsql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createCase } from './cases'
import { createChannel } from './channels'
import { createDb } from './client'
import { costPerMinute } from './cost-estimate'
import { createProjectFromCase } from './projects'
import { cases, channelBibles, channels, costLedger, projects } from './schema'
import { requireTestDatabase } from './test-database'

/** The cost per minute of finished projects, against a real database. */
const url = requireTestDatabase()
const suite = url ? describe : describe.skip

suite('costPerMinute', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })
  let channelId = ''
  let otherId = ''

  const newChannel = async (slug: string) =>
    (
      await createChannel(db, {
        name: slug,
        handle: null,
        slug,
        settings: DEFAULT_SETTINGS,
        bible: EMPTY_BIBLE,
      })
    ).id

  /** A project with one cost row, finished or not. */
  async function project(
    forChannel: string,
    runtime: number,
    cost: { estimated: string; actual?: string },
    stage: 'done' | 'script' = 'done',
  ) {
    const kase = await createCase(db, { channelId: forChannel, title: 'Case', category: 'con' })
    const row = await createProjectFromCase(db, {
      caseId: kase.id,
      title: 'Project',
      targetRuntimeMin: runtime,
    })
    await db
      .update(projects)
      .set({ stage })
      .where(dsql`${projects.id} = ${row.id}`)
    await db.insert(costLedger).values({
      provider: 'anthropic',
      operation: 'x',
      channelId: forChannel,
      projectId: row.id,
      estimatedUsd: cost.estimated,
      actualUsd: cost.actual ?? null,
    })
  }

  beforeEach(async () => {
    await db.execute(
      dsql`truncate table ${costLedger}, ${projects}, ${cases}, ${channels}, ${channelBibles} restart identity cascade`,
    )
    channelId = await newChannel('a')
    otherId = await newChannel('b')
  })

  afterAll(async () => {
    await sql.end()
  })

  it('divides the finished projects cost by their minutes, actual before estimate', async () => {
    await project(channelId, 10, { estimated: '1.0000', actual: '4.0000' })
    await project(channelId, 20, { estimated: '8.0000' })
    // An unfinished project does not count.
    await project(channelId, 30, { estimated: '90.0000' }, 'script')

    expect(await costPerMinute(db, channelId)).toEqual({ usdPerMinute: 12 / 30, projects: 2 })
  })

  it("falls back to every channel's finished projects when this one has none", async () => {
    await project(otherId, 10, { estimated: '5.0000' })
    expect(await costPerMinute(db, channelId)).toEqual({ usdPerMinute: 0.5, projects: 1 })
  })

  it('is null when nobody has a finished project', async () => {
    await project(channelId, 10, { estimated: '5.0000' }, 'script')
    expect(await costPerMinute(db, channelId)).toBeNull()
  })
})
