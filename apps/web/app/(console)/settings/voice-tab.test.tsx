import { DEFAULT_SETTINGS } from '@boom-busters/schemas'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsForm } from './settings-form'

/**
 * Choosing a narrator, through the whole screen rather than the panel alone.
 *
 * It renders `SettingsForm` and not `VoiceTab` deliberately. The bug this file
 * exists for was not in the panel: `Use as narrator` (né `Add voice`) called a server action that
 * wrote the new voice and then `router.refresh()`, which re-renders the server
 * component — while the screen renders from `SettingsForm`'s `useState`, seeded
 * once at mount and deaf to the new prop. Every assertion below passes against
 * a panel tested in isolation with a stub `commit`, and the card still would
 * not have changed in a browser until the page was reloaded.
 *
 * So the thing under test is the state ownership, and the only way to test that
 * is to own the state.
 */

const saveSettings = vi.fn()
const listAuditionVoices = vi.fn()
const cachedAuditions = vi.fn()
const generateAuditions = vi.fn()

vi.mock('./actions', () => ({
  saveSettings: (...args: unknown[]) => saveSettings(...args),
  saveProviderKey: vi.fn(),
  verifyProviderKey: vi.fn(),
}))

vi.mock('./voice-actions', () => ({
  listAuditionVoices: () => listAuditionVoices(),
  cachedAuditions: (...args: unknown[]) => cachedAuditions(...args),
  generateAuditions: (...args: unknown[]) => generateAuditions(...args),
  checkPronunciation: vi.fn(),
}))

const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

const ACHIRD = 'v-achird'
const VINDEMIATRIX = 'v-vindemiatrix'

beforeEach(() => {
  vi.clearAllMocks()
  saveSettings.mockResolvedValue({ ok: true })
  cachedAuditions.mockResolvedValue({})
  listAuditionVoices.mockResolvedValue([
    {
      provider: 'elevenlabs',
      voices: [
        { id: ACHIRD, label: 'Achird', description: 'en-GB · warm' },
        { id: VINDEMIATRIX, label: 'Vindemiatrix', description: 'en-GB · dry' },
      ],
    },
  ])
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
})

/** The card for one voice, found by the name printed on it. */
function card(label: string): HTMLElement {
  const heading = screen.getByText(label)
  const listItem = heading.closest('li')
  if (!listItem) throw new Error(`No card for ${label}`)
  return listItem
}

async function openVoiceTab(): Promise<void> {
  render(
    <SettingsForm
      initialSettings={structuredClone(DEFAULT_SETTINGS)}
      credentials={[]}
      mockProviders
    />,
  )
  await userEvent.click(screen.getByRole('tab', { name: 'Voice' }))
  await screen.findByText('Achird')
}

describe('choosing a narrator', () => {
  it('marks the voice on the card straight away, with no refresh', async () => {
    await openVoiceTab()

    await userEvent.click(within(card('Achird')).getByRole('button', { name: /use as narrator/i }))

    expect(within(card('Achird')).getByText('Narrator')).toBeTruthy()
    expect(within(card('Achird')).queryByRole('button', { name: /use as narrator/i })).toBeNull()
    expect(saveSettings).toHaveBeenCalledWith({
      tts: { provider: 'elevenlabs', voiceId: ACHIRD },
    })
  })

  it('drops the previous narrator when a second voice is added', async () => {
    await openVoiceTab()

    await userEvent.click(within(card('Achird')).getByRole('button', { name: /use as narrator/i }))
    await userEvent.click(
      within(card('Vindemiatrix')).getByRole('button', { name: /use as narrator/i }),
    )

    // One narrator. Adding the second is the whole of un-choosing the first —
    // there is no second press to undo anything.
    expect(within(card('Vindemiatrix')).getByText('Narrator')).toBeTruthy()
    expect(within(card('Achird')).getByRole('button', { name: /use as narrator/i })).toBeTruthy()
    expect(screen.getAllByText('Narrator')).toHaveLength(1)
  })

  it('puts the narrator back on the card if the write is refused', async () => {
    await openVoiceTab()
    saveSettings.mockResolvedValue({ ok: false, error: 'Database is away' })

    await userEvent.click(within(card('Achird')).getByRole('button', { name: /use as narrator/i }))

    expect(within(card('Achird')).getByRole('button', { name: /use as narrator/i })).toBeTruthy()
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'error', description: 'Database is away' }),
    )
  })

  it('never asks the vendor for audio just because a voice was added', async () => {
    await openVoiceTab()

    await userEvent.click(within(card('Achird')).getByRole('button', { name: /use as narrator/i }))

    // Add is free; Play is the only button on the card that spends.
    expect(generateAuditions).not.toHaveBeenCalled()
  })
})

describe('delivery stability', () => {
  it('saves the chosen tier and shows it pressed, with no refresh', async () => {
    await openVoiceTab()

    await userEvent.click(screen.getByRole('button', { name: 'Robust' }))

    expect(saveSettings).toHaveBeenCalledWith({ tts: { stability: 'robust' } })
    expect(screen.getByRole('button', { name: 'Robust' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('starts at Natural, the vendor default', async () => {
    await openVoiceTab()
    expect(screen.getByRole('button', { name: 'Natural' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('hearing a voice', () => {
  it('synthesises on the first press and replays without paying again', async () => {
    generateAuditions.mockResolvedValue({
      ok: true,
      auditions: [{ provider: 'elevenlabs', voiceId: ACHIRD, label: 'Achird', audio: 'AAAA' }],
    })
    await openVoiceTab()

    await userEvent.click(within(card('Achird')).getByRole('button', { name: /hear it/i }))
    expect(generateAuditions).toHaveBeenCalledTimes(1)

    await userEvent.click(within(card('Achird')).getByRole('button', { name: /play again/i }))
    expect(generateAuditions).toHaveBeenCalledTimes(1)
  })

  it('does not change the narrator', async () => {
    generateAuditions.mockResolvedValue({
      ok: true,
      auditions: [{ provider: 'elevenlabs', voiceId: ACHIRD, label: 'Achird', audio: 'AAAA' }],
    })
    await openVoiceTab()

    await userEvent.click(within(card('Achird')).getByRole('button', { name: /hear it/i }))

    // The press that used to adopt a voice as a side effect of listening to it.
    expect(saveSettings).not.toHaveBeenCalled()
    expect(within(card('Achird')).getByRole('button', { name: /use as narrator/i })).toBeTruthy()
  })
})
