// @vitest-environment node

import { getWorkspace, requireTestDatabase, seed, updateWorkspace } from '@boom-busters/db'
import { DEFAULT_WORKSPACE_SETTINGS } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { saveWorkspaceSettings } from './workspace-actions'

/**
 * The workspace settings action against the test database, with the session
 * and cache revalidation (seams a server action cannot bring to a unit test)
 * replaced.
 */

const authMock = vi.hoisted(() => ({
  auth: vi.fn(async (): Promise<{ user: { email: string } } | null> => ({
    user: { email: 'owner@example.com' },
  })),
}))
vi.mock('@/auth', () => authMock)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const describeDb = requireTestDatabase() ? describe : describe.skip

describeDb('saveWorkspaceSettings', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    authMock.auth.mockResolvedValue({ user: { email: 'owner@example.com' } })
    await seed(db)
    await updateWorkspace(db, DEFAULT_WORKSPACE_SETTINGS)
  })

  it('writes the monthly ceiling to the workspace row', async () => {
    const result = await saveWorkspaceSettings({ budgets: { monthlyCeilingUsd: 250 } })

    expect(result).toEqual({ ok: true })
    expect((await getWorkspace(db)).settings.budgets.monthlyCeilingUsd).toBe(250)
  })

  it('writes the price table whole', async () => {
    const modelPrices = {
      llm: { 'anthropic:claude-fable-5-1': { inputPerMTok: 10, outputPerMTok: 50 } },
      image: {},
    }
    expect(await saveWorkspaceSettings({ modelPrices })).toEqual({ ok: true })
    expect((await getWorkspace(db)).settings.modelPrices).toEqual(modelPrices)
  })

  it('refuses a channel key, and writes nothing', async () => {
    const result = await saveWorkspaceSettings({ tts: {} })

    expect(result.ok).toBe(false)
    expect((await getWorkspace(db)).settings).toEqual(DEFAULT_WORKSPACE_SETTINGS)
  })

  it('refuses a negative ceiling', async () => {
    const result = await saveWorkspaceSettings({ budgets: { monthlyCeilingUsd: -1 } })
    expect(result.ok).toBe(false)
  })

  it('refuses a signed-out caller', async () => {
    authMock.auth.mockResolvedValueOnce(null)
    await expect(saveWorkspaceSettings({ budgets: { monthlyCeilingUsd: 5 } })).rejects.toThrow(
      'Not signed in',
    )
  })
})
