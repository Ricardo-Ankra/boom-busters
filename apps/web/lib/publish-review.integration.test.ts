// @vitest-environment node

import {
  createCase,
  createChannel,
  createProjectFromCase,
  FIXTURE_PROJECT_ID,
  requireTestDatabase,
  seed,
  updateChannelSettings,
} from '@boom-busters/db'
import { DEFAULT_SETTINGS, EMPTY_BIBLE, FIRST_CHANNEL_ID } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { publishModel } from './publish-review'

/**
 * The Publish screen's "x of N upload starts" must use the budget of the
 * project's own channel, the one the publish runner enforces.
 */

const describeDb = requireTestDatabase() ? describe : describe.skip

describeDb('publishModel budget', () => {
  it("reports the project's channel's daily upload budget, not the first channel's", async () => {
    await seed(db)
    await updateChannelSettings(db, FIRST_CHANNEL_ID, { publish: { dailyUploadBudget: 6 } })

    const other = await createChannel(db, {
      name: 'Budget channel',
      handle: null,
      slug: `budget-${Math.random().toString(36).slice(2, 8)}`,
      settings: DEFAULT_SETTINGS,
      bible: EMPTY_BIBLE,
    })
    await updateChannelSettings(db, other.id, { publish: { dailyUploadBudget: 2 } })
    const otherCase = await createCase(db, { channelId: other.id, title: 'B', category: 'con' })
    const otherProject = await createProjectFromCase(db, { caseId: otherCase.id, title: 'On B' })

    expect((await publishModel(db, otherProject.id, { presign: null })).dailyUploadBudget).toBe(2)
    expect((await publishModel(db, FIXTURE_PROJECT_ID, { presign: null })).dailyUploadBudget).toBe(
      6,
    )
  })
})
