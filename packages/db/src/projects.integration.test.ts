import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Database } from './client'
import { FIXTURE_PROJECT_ID } from './fixtures'
import { getProject } from './projects'
import { ensureRun, recordRunEvent } from './runs'
import { runEvents, runs } from './schema'
import { seed } from './seed'
import { requireTestDatabase } from './test-database'

const DATABASE_URL = requireTestDatabase()
const describeDb = DATABASE_URL ? describe : describe.skip

describeDb('project summary gate line', () => {
  let connection: ReturnType<typeof createDb>
  let db: Database

  beforeAll(async () => {
    connection = createDb(DATABASE_URL as string, { max: 2 })
    db = connection.db
    await seed(db)
  })

  afterAll(async () => {
    await connection.sql.end({ timeout: 5 })
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE ${runEvents}, ${runs} RESTART IDENTITY CASCADE`)
  })

  it('reads the newest gate.opened message as the gate summary', async () => {
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.gateSummary).toBeNull()

    const runId = await ensureRun(db, {
      inngestRunId: '01JGATE0001',
      functionName: 'script-runner',
      projectId: FIXTURE_PROJECT_ID,
      stage: 'script',
    })
    await recordRunEvent(db, {
      runId,
      kind: 'gate.opened',
      message: 'Script ready · 1 chapters · older',
      occurredAt: new Date('2026-03-01T10:00:00Z'),
    })
    await recordRunEvent(db, {
      runId,
      kind: 'gate.opened',
      message: 'Script ready · 2 chapters · newer',
      occurredAt: new Date('2026-03-01T11:00:00Z'),
    })
    await recordRunEvent(db, {
      runId,
      kind: 'step.completed',
      message: 'A later event of another kind',
      occurredAt: new Date('2026-03-01T12:00:00Z'),
    })

    expect((await getProject(db, FIXTURE_PROJECT_ID))?.gateSummary).toBe(
      'Script ready · 2 chapters · newer',
    )
  })
})
