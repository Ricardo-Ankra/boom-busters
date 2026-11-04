import { FIRST_CHANNEL_BIBLE } from '@boom-busters/schemas'
import type { BibleDraft } from '@boom-busters/schemas'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BibleTab } from './bible-tab'
import { FIXTURE_CHANNEL_VIEW } from './channel-view-fixture'

const draftBibleAction = vi.fn()
const estimateBibleResearchAction = vi.fn()
const startBibleResearchAction = vi.fn()
vi.mock('./bible-actions', () => ({
  approveBibleSectionAction: vi.fn(),
  copyBibleFromChannelAction: vi.fn(),
  discardBibleDraftAction: vi.fn(),
  editBibleSectionAction: vi.fn(),
  saveBibleAction: vi.fn(),
  previewStagePromptAction: vi.fn(async () => ({ ok: true, text: '' })),
  draftBibleAction: (...args: unknown[]) => draftBibleAction(...args),
  estimateBibleResearchAction: (...args: unknown[]) => estimateBibleResearchAction(...args),
  startBibleResearchAction: (...args: unknown[]) => startBibleResearchAction(...args),
}))
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }))
const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

const CHANNEL = { ...FIXTURE_CHANNEL_VIEW, name: 'First', handle: '@first' }

function draftOf(over: Partial<BibleDraft> = {}): BibleDraft {
  return {
    channelId: CHANNEL.id,
    baseBibleId: '01J00000000000000000000009',
    bible: FIRST_CHANNEL_BIBLE,
    statuses: {
      identity: 'approved',
      formats: 'approved',
      voice: 'approved',
      look: 'approved',
      examples: 'approved',
      hooks: 'approved',
      search: 'approved',
      publishing: 'approved',
    },
    tooClose: {},
    errors: {},
    inputs: null,
    research: null,
    job: null,
    updatedAt: '2026-10-30T08:00:00.000Z',
    ...over,
  }
}

function renderTab(vidiqReady: boolean, draft: BibleDraft | null = null) {
  return render(
    <BibleTab
      channel={CHANNEL}
      draft={draft}
      versions={[]}
      currentVersion={{ id: '01J00000000000000000000009', version: 3, bible: FIRST_CHANNEL_BIBLE }}
      vidiqReady={vidiqReady}
      archived={false}
    />,
  )
}

async function openCard() {
  await userEvent.click(screen.getByRole('button', { name: 'Draft with AI' }))
}

const SAVED = {
  description: 'Saved description',
  audience: 'Saved audience',
  admiredChannels: ['Alpha'],
  videos: [],
  avoid: '',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Draft with AI', () => {
  it('prefills the description with the name and handle', async () => {
    renderTab(true)
    await openCard()
    expect(screen.getByLabelText('Describe the channel in a few lines')).toHaveValue(
      'First (@first)',
    )
  })

  it('shows the credits first, then Start sends the inputs', async () => {
    estimateBibleResearchAction.mockResolvedValue({
      ok: true,
      estimate: 45,
      balance: 1474,
      capLeft: 900,
    })
    startBibleResearchAction.mockResolvedValue({ ok: true })
    renderTab(true)
    await openCard()
    await userEvent.type(screen.getByLabelText('Channels you admire'), 'Alpha{enter}Beta')
    await userEvent.click(screen.getByRole('button', { name: 'Research with VidIQ, then draft' }))

    expect(await screen.findByText('About 45 VidIQ credits. Balance: 1,474.')).toBeInTheDocument()
    expect(startBibleResearchAction).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(startBibleResearchAction).toHaveBeenCalledWith(CHANNEL.id, {
      description: 'First (@first)',
      audience: '',
      admiredChannels: ['Alpha', 'Beta'],
      videos: [],
      avoid: '',
    })
    expect(refresh).toHaveBeenCalled()
  })

  it('disables the research without a VidIQ key and says why', async () => {
    renderTab(false)
    await openCard()
    expect(screen.getByRole('button', { name: 'Research with VidIQ, then draft' })).toBeDisabled()
    expect(screen.getByText('Add a VidIQ key in Settings, Connections')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Draft without VidIQ' })).toBeEnabled()
  })

  it('shows an estimate error in place of the confirm', async () => {
    estimateBibleResearchAction.mockResolvedValue({
      ok: false,
      error: 'VidIQ did not answer: down',
    })
    renderTab(true)
    await openCard()
    await userEvent.click(screen.getByRole('button', { name: 'Research with VidIQ, then draft' }))
    expect(await screen.findByText('VidIQ did not answer: down')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
  })

  it('refuses a sixth channel and an eleventh video, and disables both buttons', async () => {
    renderTab(true)
    await openCard()
    const channels = screen.getByLabelText('Channels you admire')
    await userEvent.type(channels, 'a{enter}b{enter}{enter}c{enter}d{enter}e')
    expect(screen.queryByText('Up to 5 channels')).toBeNull()
    await userEvent.type(channels, '{enter}f')
    expect(screen.getByText('Up to 5 channels')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Research with VidIQ, then draft' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Draft without VidIQ' })).toBeDisabled()

    await userEvent.clear(channels)
    const videos = screen.getByLabelText('Videos that feel right')
    await userEvent.type(
      videos,
      '1{enter}2{enter}3{enter}4{enter}5{enter}6{enter}7{enter}8{enter}9{enter}10',
    )
    expect(screen.queryByText('Up to 10 videos')).toBeNull()
    await userEvent.type(videos, '{enter}11')
    expect(screen.getByText('Up to 10 videos')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Draft without VidIQ' })).toBeDisabled()
  })

  it('drafts without VidIQ, sending the inputs', async () => {
    draftBibleAction.mockResolvedValue({ ok: true })
    renderTab(false)
    await openCard()
    await userEvent.click(screen.getByRole('button', { name: 'Draft without VidIQ' }))
    expect(draftBibleAction).toHaveBeenCalledWith(CHANNEL.id, {
      inputs: {
        description: 'First (@first)',
        audience: '',
        admiredChannels: [],
        videos: [],
        avoid: '',
      },
    })
  })

  it('locks the fields while the confirm shows and Start sends what was estimated', async () => {
    estimateBibleResearchAction.mockResolvedValue({
      ok: true,
      estimate: 45,
      balance: 1474,
      capLeft: 900,
    })
    startBibleResearchAction.mockResolvedValue({ ok: true })
    renderTab(true)
    await openCard()
    await userEvent.click(screen.getByRole('button', { name: 'Research with VidIQ, then draft' }))
    await screen.findByText(/About 45 VidIQ credits/)
    for (const label of [
      'Describe the channel in a few lines',
      'Who is it for?',
      'Channels you admire',
      'Videos that feel right',
      "Anything you don't want",
    ]) {
      expect(screen.getByLabelText(label)).toBeDisabled()
    }
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(startBibleResearchAction).toHaveBeenCalledWith(
      CHANNEL.id,
      estimateBibleResearchAction.mock.calls[0]![1],
    )
  })

  it('calls neither action on Cancel', async () => {
    estimateBibleResearchAction.mockResolvedValue({
      ok: true,
      estimate: 45,
      balance: 1474,
      capLeft: 900,
    })
    renderTab(true)
    await openCard()
    await userEvent.click(screen.getByRole('button', { name: 'Research with VidIQ, then draft' }))
    await screen.findByText(/About 45 VidIQ credits/)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
    expect(startBibleResearchAction).not.toHaveBeenCalled()
    expect(draftBibleAction).not.toHaveBeenCalled()
  })

  it('does not reopen the confirm when an estimate lands after Cancel', async () => {
    let resolve!: (value: unknown) => void
    estimateBibleResearchAction.mockReturnValue(new Promise((r) => (resolve = r)))
    renderTab(true)
    await openCard()
    await userEvent.click(screen.getByRole('button', { name: 'Research with VidIQ, then draft' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await act(async () => resolve({ ok: true, estimate: 45, balance: 1474, capLeft: 900 }))
    expect(screen.queryByText(/About 45 VidIQ credits/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
  })

  it('prefills from the saved inputs rather than the name and handle', async () => {
    renderTab(true, draftOf({ inputs: SAVED }))
    await openCard()
    expect(screen.getByLabelText('Describe the channel in a few lines')).toHaveValue(
      'Saved description',
    )
    expect(screen.getByLabelText('Who is it for?')).toHaveValue('Saved audience')
    expect(screen.getByLabelText('Channels you admire')).toHaveValue('Alpha')
  })

  it('disables both buttons when the description is empty', async () => {
    renderTab(true)
    await openCard()
    await userEvent.clear(screen.getByLabelText('Describe the channel in a few lines'))
    expect(screen.getByRole('button', { name: 'Research with VidIQ, then draft' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Draft without VidIQ' })).toBeDisabled()
  })

  it('opens the card on Try again from a failed research with no saved inputs', async () => {
    renderTab(
      true,
      draftOf({
        job: {
          kind: 'research',
          state: 'failed',
          current: null,
          error: 'VidIQ did not answer',
          startedAt: '2026-10-30T08:00:00.000Z',
        },
      }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByLabelText('Who is it for?')).toBeInTheDocument()
    expect(estimateBibleResearchAction).not.toHaveBeenCalled()
  })

  it('holds the card while a run works', async () => {
    renderTab(
      true,
      draftOf({
        job: {
          kind: 'draft',
          state: 'running',
          current: 'Voice',
          error: null,
          startedAt: new Date().toISOString(),
        },
      }),
    )
    expect(screen.getByRole('button', { name: 'Draft with AI' })).toBeDisabled()
  })

  it('redrafts with a steer, and sends none when the line is empty', async () => {
    draftBibleAction.mockResolvedValue({ ok: true })
    renderTab(true)
    await userEvent.click(screen.getByRole('button', { name: 'Redraft Voice' }))
    await userEvent.type(screen.getByLabelText('What should change?'), 'more clinical')
    await userEvent.click(screen.getByRole('button', { name: 'Start redraft of Voice' }))
    expect(draftBibleAction).toHaveBeenCalledWith(CHANNEL.id, {
      sections: ['voice'],
      steer: 'more clinical',
    })
  })
})
