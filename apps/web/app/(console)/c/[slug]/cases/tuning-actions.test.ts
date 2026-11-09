// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_RESEARCH_THRESHOLDS, FIRST_CHANNEL_ID as CHANNEL_ID } from '@boom-busters/schemas'
import { applySuggestionAction, dismissSuggestionAction, resetTuningAction } from './tuning-actions'

const store = vi.hoisted(() => ({
  applyResearchTuning: vi.fn(),
  channelResearchThresholds: vi.fn(),
  countedVideosForChannel: vi.fn(),
  dismissSuggestion: vi.fn(),
  resetResearchTuning: vi.fn(),
  suggestionDismissals: vi.fn(),
}))
vi.mock('@boom-busters/db', () => store)
vi.mock('@/lib/db', () => ({ db: { marker: 'db' } }))
const session = vi.hoisted(() => vi.fn())
vi.mock('@/auth', () => ({ auth: session }))
const writeRefusal = vi.hoisted(() => vi.fn())
vi.mock('@/lib/channel-lookup', () => ({ channelWriteRefusal: writeRefusal }))
const revalidatePath = vi.hoisted(() => vi.fn())
vi.mock('next/cache', () => ({ revalidatePath }))
const suggestions = vi.hoisted(() => vi.fn())
vi.mock('./track-record-data', () => ({ liveSuggestions: suggestions }))

const STANDING = {
  key: 'demandWarn',
  direction: 'lower',
  from: 1000,
  to: 500,
  support: ['a', 'b', 'c'],
  sentence: 'Lower the warning line to 500?',
}

beforeEach(() => {
  for (const fn of Object.values(store)) fn.mockReset()
  store.applyResearchTuning.mockResolvedValue({})
  store.channelResearchThresholds.mockResolvedValue({ ...DEFAULT_RESEARCH_THRESHOLDS })
  store.countedVideosForChannel.mockResolvedValue([])
  store.suggestionDismissals.mockResolvedValue([])
  session.mockReset().mockResolvedValue({ user: { email: 'owner@example.com' } })
  writeRefusal.mockReset().mockResolvedValue(null)
  revalidatePath.mockReset()
  suggestions.mockReset().mockReturnValue([STANDING])
})

describe('tuning actions', () => {
  it('apply refuses a suggestion that no longer stands', async () => {
    suggestions.mockReturnValue([])
    expect(await applySuggestionAction(CHANNEL_ID, 'demandWarn', 'lower')).toEqual({
      ok: false,
      error: 'That suggestion no longer stands.',
    })
    expect(store.applyResearchTuning).not.toHaveBeenCalled()
  })

  it('apply refuses the wrong direction or an unknown key', async () => {
    expect((await applySuggestionAction(CHANNEL_ID, 'demandWarn', 'raise')).ok).toBe(false)
    expect((await applySuggestionAction(CHANNEL_ID, 'nonsense', 'lower')).ok).toBe(false)
    expect(store.applyResearchTuning).not.toHaveBeenCalled()
  })

  it('apply writes the live value with its sentence as evidence', async () => {
    expect(await applySuggestionAction(CHANNEL_ID, 'demandWarn', 'lower')).toEqual({ ok: true })
    expect(store.applyResearchTuning).toHaveBeenCalledWith(
      { marker: 'db' },
      {
        channelId: CHANNEL_ID,
        key: 'demandWarn',
        value: 500,
        evidence: 'Lower the warning line to 500?',
      },
    )
    expect(revalidatePath).toHaveBeenCalled()
  })

  it('apply passes the store refusal back as the plain error', async () => {
    store.applyResearchTuning.mockRejectedValue(new Error('demandOk must be above demandWarn'))
    expect(await applySuggestionAction(CHANNEL_ID, 'demandWarn', 'lower')).toEqual({
      ok: false,
      error: 'demandOk must be above demandWarn',
    })
  })

  it('dismiss records the live support count', async () => {
    expect(await dismissSuggestionAction(CHANNEL_ID, 'demandWarn', 'lower')).toEqual({ ok: true })
    expect(store.dismissSuggestion).toHaveBeenCalledWith(
      { marker: 'db' },
      { channelId: CHANNEL_ID, key: 'demandWarn', direction: 'lower', support: 3 },
    )
  })

  it('dismiss refuses a suggestion that is gone', async () => {
    suggestions.mockReturnValue([])
    expect((await dismissSuggestionAction(CHANNEL_ID, 'demandWarn', 'lower')).error).toBe(
      'That suggestion no longer stands.',
    )
    expect(store.dismissSuggestion).not.toHaveBeenCalled()
  })

  it('reset deletes the override for a known key', async () => {
    expect(await resetTuningAction(CHANNEL_ID, 'demandWarn')).toEqual({ ok: true })
    expect(store.resetResearchTuning).toHaveBeenCalledWith(
      { marker: 'db' },
      CHANNEL_ID,
      'demandWarn',
    )
    expect((await resetTuningAction(CHANNEL_ID, 'nonsense')).ok).toBe(false)
  })

  it('every action checks the session first and refuses an unknown channel', async () => {
    session.mockResolvedValue(null)
    await expect(applySuggestionAction(CHANNEL_ID, 'demandWarn', 'lower')).rejects.toThrow(
      'Not signed in',
    )
    await expect(dismissSuggestionAction(CHANNEL_ID, 'demandWarn', 'lower')).rejects.toThrow()
    await expect(resetTuningAction(CHANNEL_ID, 'demandWarn')).rejects.toThrow()
    session.mockResolvedValue({ user: { email: 'owner@example.com' } })
    writeRefusal.mockResolvedValue({ ok: false, error: 'Unknown channel' })
    expect(await applySuggestionAction(CHANNEL_ID, 'demandWarn', 'lower')).toEqual({
      ok: false,
      error: 'Unknown channel',
    })
    expect((await resetTuningAction('bad', 'demandWarn')).ok).toBe(false)
    expect(store.resetResearchTuning).not.toHaveBeenCalled()
  })
})
