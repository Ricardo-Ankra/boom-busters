// @vitest-environment node

import {
  getWorkspace,
  providerCredentials,
  requireTestDatabase,
  seed,
  setCredential,
  updateWorkspace,
} from '@boom-busters/db'
import { DEFAULT_WORKSPACE_SETTINGS, ValidationError } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { saveWorkspaceSettings, verifyProviderKey } from './workspace-actions'

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

// The VidIQ client opens a network connection, so it is replaced; mock mode is
// forced off so the verify reaches it.
const vidiqMock = vi.hoisted(() => ({
  balance: vi.fn(async () => ({ totalCredits: 100, renewableResetsAt: null })),
  close: vi.fn(async () => {}),
  createVidiqClient: vi.fn(),
}))
vi.mock('@boom-busters/providers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  mockProvidersEnabled: () => false,
}))
vi.mock('@boom-busters/providers/vidiq', () => ({
  createVidiqClient: vidiqMock.createVidiqClient,
}))

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

describeDb('verifyProviderKey for vidiq', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    authMock.auth.mockResolvedValue({ user: { email: 'owner@example.com' } })
    vidiqMock.createVidiqClient.mockImplementation(() => ({
      balance: vidiqMock.balance,
      close: vidiqMock.close,
    }))
    await seed(db)
    await db.delete(providerCredentials)
  })

  it('refuses when no key is stored, without building a client', async () => {
    const result = await verifyProviderKey('vidiq')
    expect(result.ok).toBe(false)
    expect(vidiqMock.createVidiqClient).not.toHaveBeenCalled()
  })

  it('verifies a stored key through the free balance call and closes the client', async () => {
    await setCredential(db, 'vidiq', 'vidiq-test-key', env.SECRETS_ENCRYPTION_KEY)
    const result = await verifyProviderKey('vidiq')
    expect(result).toEqual({ ok: true, verified: true, mocked: false })
    expect(vidiqMock.createVidiqClient).toHaveBeenCalledWith('vidiq-test-key')
    expect(vidiqMock.balance).toHaveBeenCalledTimes(1)
    expect(vidiqMock.close).toHaveBeenCalledTimes(1)
  })

  it('reports a refused key and still closes the client', async () => {
    await setCredential(db, 'vidiq', 'vidiq-test-key', env.SECRETS_ENCRYPTION_KEY)
    vidiqMock.balance.mockRejectedValueOnce(new Error('Unauthorized'))
    const result = await verifyProviderKey('vidiq')
    expect(result.ok).toBe(false)
    expect(vidiqMock.close).toHaveBeenCalledTimes(1)
  })

  it('records a refused key as invalid, saying it was refused', async () => {
    await setCredential(db, 'vidiq', 'vidiq-test-key', env.SECRETS_ENCRYPTION_KEY)
    vidiqMock.balance.mockRejectedValueOnce(
      new ValidationError('vidiq refused the API key (401). Check it in Settings.'),
    )
    const result = await verifyProviderKey('vidiq')
    expect(result).toMatchObject({ ok: false, verified: false })
    expect(result.ok === false && result.error).toMatch(/refused/)
    const [row] = await db.select().from(providerCredentials)
    expect(row?.verifyStatus).toBe('invalid')
  })

  it('leaves the key unchecked when VidIQ could not be reached', async () => {
    await setCredential(db, 'vidiq', 'vidiq-test-key', env.SECRETS_ENCRYPTION_KEY)
    vidiqMock.balance.mockRejectedValueOnce(new Error('fetch failed'))
    const result = await verifyProviderKey('vidiq')
    expect(result.ok === false && result.error).toMatch(/could not be reached/)
    const [row] = await db.select().from(providerCredentials)
    expect(row?.verifyStatus).toBe('unchecked')
  })
})
