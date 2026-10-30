import { FIRST_CHANNEL_BIBLE } from '@boom-busters/schemas'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BiblePreview } from './bible-preview'

const previewStagePromptAction = vi.fn()
vi.mock('./bible-actions', () => ({
  previewStagePromptAction: (...args: unknown[]) => previewStagePromptAction(...args),
}))

const CHANNEL_ID = '01J00000000000000000000001'

const flush = () => act(() => vi.advanceTimersByTimeAsync(500))

describe('BiblePreview', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    previewStagePromptAction.mockImplementation(async (_id: string, stage: string) => ({
      ok: true,
      text: `prompt for ${stage}`,
    }))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('shows the script prompt for the draft after the pause', async () => {
    render(<BiblePreview channelId={CHANNEL_ID} bible={FIRST_CHANNEL_BIBLE} />)
    expect(previewStagePromptAction).not.toHaveBeenCalled()
    await flush()
    expect(previewStagePromptAction).toHaveBeenCalledWith(CHANNEL_ID, 'script', FIRST_CHANNEL_BIBLE)
    expect(await screen.findByText('prompt for script')).toBeInTheDocument()
  })

  it('requests the new stage when the selector changes, and shows its text', async () => {
    render(<BiblePreview channelId={CHANNEL_ID} bible={FIRST_CHANNEL_BIBLE} />)
    await flush()
    const select = screen.getByRole('combobox', { name: 'Stage' })
    expect(Array.from((select as HTMLSelectElement).options).map((o) => o.value)).toEqual([
      'script',
      'shotlist',
      'direction',
      'graphics',
      'metadata',
      'dossier',
    ])
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .selectOptions(select, 'direction')
    await flush()
    expect(previewStagePromptAction).toHaveBeenLastCalledWith(
      CHANNEL_ID,
      'direction',
      FIRST_CHANNEL_BIBLE,
    )
    expect(await screen.findByText('prompt for direction')).toBeInTheDocument()
  })

  it('re-requests after the draft changes', async () => {
    const { rerender } = render(<BiblePreview channelId={CHANNEL_ID} bible={FIRST_CHANNEL_BIBLE} />)
    await flush()
    const changed = { ...FIRST_CHANNEL_BIBLE, audience: 'someone else' }
    rerender(<BiblePreview channelId={CHANNEL_ID} bible={changed} />)
    await flush()
    expect(previewStagePromptAction).toHaveBeenCalledTimes(2)
    expect(previewStagePromptAction).toHaveBeenLastCalledWith(CHANNEL_ID, 'script', changed)
  })

  it('ignores a response that arrives after a newer request', async () => {
    let releaseOld: (value: unknown) => void = () => {}
    previewStagePromptAction.mockImplementationOnce(
      () => new Promise((resolve) => (releaseOld = resolve)),
    )
    const { rerender } = render(<BiblePreview channelId={CHANNEL_ID} bible={FIRST_CHANNEL_BIBLE} />)
    await flush()
    rerender(
      <BiblePreview channelId={CHANNEL_ID} bible={{ ...FIRST_CHANNEL_BIBLE, audience: 'new' }} />,
    )
    await flush()
    expect(await screen.findByText('prompt for script')).toBeInTheDocument()
    await act(async () => releaseOld({ ok: true, text: 'stale prompt' }))
    expect(screen.queryByText('stale prompt')).toBeNull()
    expect(screen.getByText('prompt for script')).toBeInTheDocument()
  })

  it('shows the error when the draft cannot be composed', async () => {
    previewStagePromptAction.mockResolvedValue({ ok: false, error: 'audience: too long' })
    render(<BiblePreview channelId={CHANNEL_ID} bible={FIRST_CHANNEL_BIBLE} />)
    await flush()
    expect(await screen.findByRole('alert')).toHaveTextContent('audience: too long')
  })
})
