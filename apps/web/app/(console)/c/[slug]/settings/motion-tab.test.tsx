import { buildModelOptions, MANIFEST } from '@boom-busters/providers'
import { DEFAULT_SETTINGS, EMPTY_MODEL_PRICES } from '@boom-busters/schemas'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FIXTURE_CHANNEL_VIEW } from './channel-view-fixture'
import type { TechniqueOption } from './motion-tab'
import { SettingsForm } from './settings-form'

/**
 * The Motion tab (spec 2026-11-04, section 11.1, plan 1): the channel's motion
 * identity, edited through the settings patch like the Brand Kit. Rendered
 * through `SettingsForm` the way `brand-look.test.tsx` does, with every other
 * tab's actions module stubbed.
 */

const saveSettings = vi.fn()

vi.mock('./actions', () => ({
  saveSettings: (...args: unknown[]) => saveSettings(...args),
}))

vi.mock('./bible-actions', () => ({
  approveBibleSectionAction: vi.fn(),
  copyBibleFromChannelAction: vi.fn(),
  discardBibleDraftAction: vi.fn(),
  draftBibleAction: vi.fn(),
  editBibleSectionAction: vi.fn(),
  saveBibleAction: vi.fn(),
  restoreBibleVersionAction: vi.fn(),
  viewBibleVersionAction: vi.fn(),
  previewStagePromptAction: vi.fn(async () => ({ ok: true, text: '' })),
}))
vi.mock('./channel-actions', () => ({
  createChannelAction: vi.fn(),
  updateChannelAction: vi.fn(),
  archiveChannelAction: vi.fn(),
}))
const motionActions = vi.hoisted(() => ({ draftMotionIdentityAction: vi.fn() }))
vi.mock('./exemplar-actions', () => ({
  deriveExemplarsAction: vi.fn(),
  refineExemplarAction: vi.fn(),
  approveExemplarVersionAction: vi.fn(),
  keepApprovedAction: vi.fn(),
  restoreExemplarVersionAction: vi.fn(),
  copyMotionFromChannelAction: vi.fn(),
  latestDerivationAction: vi.fn(async () => ({ ok: true })),
}))
vi.mock('./motion-actions', () => ({
  createReferenceUploadAction: vi.fn(),
  createReferenceFrameUploadsAction: vi.fn(),
  finaliseReferenceAction: vi.fn(),
  updateReferenceAction: vi.fn(),
  remarkReferenceAction: vi.fn(),
  readReferenceAction: vi.fn(),
  saveReadingAction: vi.fn(),
  archiveReferenceAction: vi.fn(),
  draftMotionIdentityAction: motionActions.draftMotionIdentityAction,
}))
vi.mock('./logo-actions', () => ({
  createLogoUploadAction: vi.fn(),
  finaliseLogoAction: vi.fn(),
  addLogoFromUrlAction: vi.fn(),
  renameLogoAction: vi.fn(),
  removeLogoAction: vi.fn(),
  setChannelMarkAction: vi.fn(),
}))
vi.mock('./voice-actions', () => ({
  listAuditionVoices: vi.fn(),
  cachedAuditions: vi.fn(),
  generateAuditions: vi.fn(),
  checkPronunciation: vi.fn(),
}))
vi.mock('./model-actions', () => ({ refreshModelListsAction: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

function modelOptions() {
  const now = new Date().toISOString()
  return buildModelOptions({
    listed: [],
    refresh: (['anthropic', 'openai', 'google', 'fal'] as const).map((provider) => ({
      provider,
      lastAttemptAt: now,
      lastSuccessAt: now,
      lastError: null,
    })),
    keys: { anthropic: true, openai: true, google: true, fal: true },
    prices: EMPTY_MODEL_PRICES,
    mock: false,
  })
}

const TECHNIQUE_OPTIONS = MANIFEST.map((entry) => ({
  technique: entry.technique,
  description: entry.description,
}))

beforeEach(() => {
  vi.clearAllMocks()
  saveSettings.mockResolvedValue({ ok: true })
})

async function openMotionTab(
  options: readonly TechniqueOption[] = TECHNIQUE_OPTIONS,
  settings = structuredClone(DEFAULT_SETTINGS),
): Promise<void> {
  // The house defaults: what a channel that never set its identity reads as.
  render(
    <SettingsForm
      channelId="01J00000000000000000000001"
      channelSlug="first"
      channel={FIXTURE_CHANNEL_VIEW}
      initialSettings={settings}
      modelOptions={modelOptions()}
      techniqueOptions={options}
    />,
  )
  await userEvent.click(screen.getByRole('tab', { name: 'Motion' }))
}

describe('the Motion tab (spec 2026-11-04)', () => {
  it('shows the house values for a channel that never set them', async () => {
    await openMotionTab()
    expect((screen.getByLabelText('Change cadence (ms)') as HTMLInputElement).value).toBe('1500')
    expect((screen.getByLabelText('Still limit (ms)') as HTMLInputElement).value).toBe('6000')
    expect((screen.getByLabelText('Overshoot') as HTMLSelectElement).value).toBe('hair')
    expect((screen.getByLabelText('Signature easing') as HTMLSelectElement).value).toBe('soft')
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes).toHaveLength(TECHNIQUE_OPTIONS.length)
    expect(boxes.every((box) => box.checked)).toBe(true)
    expect((screen.getByLabelText('Never') as HTMLTextAreaElement).value).toContain('glows')
  })

  it('saves one field as a motion patch', async () => {
    const user = userEvent.setup()
    await openMotionTab()
    await user.selectOptions(screen.getByLabelText('Overshoot'), 'none')
    expect(saveSettings).toHaveBeenCalledWith('01J00000000000000000000001', {
      motion: { overshoot: 'none' },
    })
  })

  it('lets the still limit be typed, and saves it once on blur (final review, issue 1)', async () => {
    const user = userEvent.setup()
    await openMotionTab()
    const still = screen.getByLabelText('Still limit (ms)')
    await user.clear(still)
    await user.type(still, '9000')
    expect(saveSettings).not.toHaveBeenCalled()
    await user.tab()
    expect(saveSettings).toHaveBeenCalledTimes(1)
    expect(saveSettings).toHaveBeenCalledWith('01J00000000000000000000001', {
      motion: { stillMaxMs: 9000 },
    })
  })

  it('saves an unticked technique as the list without it', async () => {
    const user = userEvent.setup()
    await openMotionTab()
    await user.click(screen.getByLabelText('racing-chart'))
    expect(saveSettings).toHaveBeenCalledWith('01J00000000000000000000001', {
      motion: {
        techniques: TECHNIQUE_OPTIONS.map((option) => option.technique).filter(
          (technique) => technique !== 'racing-chart',
        ),
      },
    })
  })

  it('lists a channel-only technique with its phrases and saves it unticked (spec 8.5)', async () => {
    const user = userEvent.setup()
    const own = {
      technique: 'ledger-wipe',
      description: 'a ruled line wipes the old figure away',
      channelOnly: true,
      steerPhrases: ['ledger wipe', 'wipe the ledger'],
    }
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.motion = {
      ...settings.motion,
      techniques: [...settings.motion.techniques, 'ledger-wipe'],
    }
    await openMotionTab([...TECHNIQUE_OPTIONS, own], settings)
    const box = screen.getByLabelText('ledger-wipe') as HTMLInputElement
    expect(box.checked).toBe(true)
    expect(
      screen.getByText(
        /This channel's own, reached by a steer that says: 'ledger wipe', 'wipe the ledger'\./,
      ),
    ).toBeInTheDocument()
    await user.click(box)
    expect(saveSettings).toHaveBeenCalledWith('01J00000000000000000000001', {
      motion: { techniques: TECHNIQUE_OPTIONS.map((option) => option.technique) },
    })
  })

  it('follows an approved channel technique the server added, so the next toggle keeps it (final review, issue 2)', async () => {
    const user = userEvent.setup()
    const own = {
      technique: 'ledger-wipe',
      description: 'a ruled line wipes the old figure away',
      channelOnly: true,
      steerPhrases: ['ledger wipe'],
    }
    const before = structuredClone(DEFAULT_SETTINGS)
    const view = render(
      <SettingsForm
        channelId="01J00000000000000000000001"
        channelSlug="first"
        channel={FIXTURE_CHANNEL_VIEW}
        initialSettings={before}
        modelOptions={modelOptions()}
        techniqueOptions={TECHNIQUE_OPTIONS}
      />,
    )
    await user.click(screen.getByRole('tab', { name: 'Motion' }))
    // Approve on the Exemplars tab refreshed the page: the server now lists the key.
    const after = structuredClone(DEFAULT_SETTINGS)
    after.motion = { ...after.motion, techniques: [...after.motion.techniques, 'ledger-wipe'] }
    view.rerender(
      <SettingsForm
        channelId="01J00000000000000000000001"
        channelSlug="first"
        channel={FIXTURE_CHANNEL_VIEW}
        initialSettings={after}
        modelOptions={modelOptions()}
        techniqueOptions={[...TECHNIQUE_OPTIONS, own]}
      />,
    )
    expect((screen.getByLabelText('ledger-wipe') as HTMLInputElement).checked).toBe(true)
    await user.click(screen.getByLabelText('racing-chart'))
    expect(saveSettings).toHaveBeenCalledWith('01J00000000000000000000001', {
      motion: {
        techniques: [
          ...TECHNIQUE_OPTIONS.map((option) => option.technique).filter(
            (technique) => technique !== 'racing-chart',
          ),
          'ledger-wipe',
        ],
      },
    })
  })

  it('cannot untick a last resort', async () => {
    await openMotionTab()
    const wordStack = screen.getByLabelText('kinetic-word-stack') as HTMLInputElement
    expect(wordStack.checked).toBe(true)
    expect(wordStack.disabled).toBe(true)
    expect((screen.getByLabelText('bar-chart') as HTMLInputElement).disabled).toBe(true)
  })

  it('applies a drafted identity through one motion patch (spec 8.4)', async () => {
    const identity = {
      ...DEFAULT_SETTINGS.motion,
      overshoot: 'none' as const,
      styleGuideMd: 'Slow.',
    }
    motionActions.draftMotionIdentityAction.mockResolvedValue({
      ok: true,
      draft: { identity, why: 'The readings never overshoot.' },
    })
    const user = userEvent.setup()
    await openMotionTab()
    await user.type(screen.getByLabelText(/What this channel should move like/), 'slow')
    await user.click(screen.getByRole('button', { name: 'Draft motion identity' }))
    await user.click(await screen.findByRole('button', { name: 'Apply' }))
    expect(saveSettings).toHaveBeenCalledTimes(1)
    expect(saveSettings).toHaveBeenCalledWith('01J00000000000000000000001', { motion: identity })
    expect((screen.getByLabelText('Overshoot') as HTMLSelectElement).value).toBe('none')
  })

  it('shows the refusal when the action refuses', async () => {
    saveSettings.mockResolvedValue({ ok: false, error: 'motion: "glows" is in both lists' })
    const user = userEvent.setup()
    await openMotionTab()
    await user.selectOptions(screen.getByLabelText('Overshoot'), 'none')
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'motion: "glows" is in both lists' }),
    )
    // The optimistic value is put back.
    expect((screen.getByLabelText('Overshoot') as HTMLSelectElement).value).toBe('hair')
  })
})
