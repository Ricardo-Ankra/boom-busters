import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MusicTab } from './music-tab'
import type { MusicBedView } from './music-tab'

const uploadMusicBedAction = vi.fn()
const deleteMusicBedAction = vi.fn()

vi.mock('./actions', () => ({
  uploadMusicBedAction: (...args: unknown[]) => uploadMusicBedAction(...args),
  deleteMusicBedAction: (...args: unknown[]) => deleteMusicBedAction(...args),
}))

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

beforeEach(() => {
  vi.clearAllMocks()
  uploadMusicBedAction.mockResolvedValue({ ok: true })
  deleteMusicBedAction.mockResolvedValue({ ok: true })
})

const BEDS: MusicBedView[] = [
  {
    id: '01J000000000000000000000M1',
    title: 'Documentary tension 01',
    licence: 'yt-audio-library',
    moodTags: ['tension', 'slow build'],
    createdAt: '2026-08-18T10:00:00.000Z',
  },
]

describe('MusicTab', () => {
  it('keeps Add disabled until a file AND a licence exist — the licence is the record', async () => {
    render(<MusicTab beds={[]} />)

    const add = screen.getByRole('button', { name: 'Add to library' })
    expect(add).toBeDisabled()
    expect(screen.getByText('Choose a file first.')).toBeInTheDocument()

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, new File(['ppp'], 'bed.mp3', { type: 'audio/mpeg' }))

    // File chosen, licence still empty: still disabled, and it says why.
    expect(add).toBeDisabled()
    expect(screen.getByText(/licence is required/)).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText(/Licence/), 'yt-audio-library')
    expect(add).toBeEnabled()

    await userEvent.click(add)
    expect(uploadMusicBedAction).toHaveBeenCalledTimes(1)
    const sent = uploadMusicBedAction.mock.calls[0]![0] as FormData
    expect(sent.get('licence')).toBe('yt-audio-library')
    expect((sent.get('file') as File).name).toBe('bed.mp3')
  })

  it('defaults the title from the file name, minus the extension', async () => {
    render(<MusicTab beds={[]} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, new File(['ppp'], 'night-drive.mp3', { type: 'audio/mpeg' }))
    expect(screen.getByLabelText('Title')).toHaveValue('night-drive')
  })

  it('lists each bed with its licence, tags, and an inline preview', () => {
    render(<MusicTab beds={BEDS} />)

    expect(screen.getByText('Documentary tension 01')).toBeInTheDocument()
    expect(screen.getByText(/YouTube Audio Library · tension, slow build/)).toBeInTheDocument()
    const player = screen.getByLabelText('Preview: Documentary tension 01')
    expect(player.tagName).toBe('AUDIO')
    expect(player).toHaveAttribute('src', `/api/assets/${BEDS[0]!.id}/file`)
  })

  it('says so when the action call itself rejects, instead of doing nothing', async () => {
    // A request refused before the action runs (over the framework body cap,
    // a dropped connection) rejects the awaited call. That used to be
    // swallowed: no toast, no error, a button that "does nothing".
    uploadMusicBedAction.mockRejectedValue(new Error('Body exceeded 30mb limit'))
    render(<MusicTab beds={[]} />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, new File(['ppp'], 'bed.mp3', { type: 'audio/mpeg' }))
    await userEvent.selectOptions(screen.getByLabelText(/Licence/), 'yt-audio-library')
    await userEvent.click(screen.getByRole('button', { name: 'Add to library' }))

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'That did not work', variant: 'error' }),
    )
    // The button must come back — a permanently busy button is the same bug.
    expect(screen.getByRole('button', { name: 'Add to library' })).toBeEnabled()
  })

  it('refuses a file over 25 MB before uploading a byte', async () => {
    render(<MusicTab beds={[]} />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const big = new File(['x'], 'huge.mp3', { type: 'audio/mpeg' })
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 })
    await userEvent.upload(input, big)
    await userEvent.selectOptions(screen.getByLabelText(/Licence/), 'yt-audio-library')
    await userEvent.click(screen.getByRole('button', { name: 'Add to library' }))

    expect(uploadMusicBedAction).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining('25 MB') }),
    )
  })

  it('deletes only through the two-step, and can back out', async () => {
    render(<MusicTab beds={BEDS} />)

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    // Nothing deleted yet — the confirm appeared instead.
    expect(deleteMusicBedAction).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(screen.queryByRole('button', { name: 'Delete for good' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete for good' }))
    expect(deleteMusicBedAction).toHaveBeenCalledWith(BEDS[0]!.id)
  })
})
