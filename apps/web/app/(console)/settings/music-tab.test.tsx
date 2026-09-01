import { webcrypto } from 'node:crypto'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MusicTab } from './music-tab'
import type { MusicBedView } from './music-tab'

const createMusicUploadAction = vi.fn()
const finaliseMusicBedAction = vi.fn()
const deleteMusicBedAction = vi.fn()

vi.mock('./actions', () => ({
  createMusicUploadAction: (...args: unknown[]) => createMusicUploadAction(...args),
  finaliseMusicBedAction: (...args: unknown[]) => finaliseMusicBedAction(...args),
  deleteMusicBedAction: (...args: unknown[]) => deleteMusicBedAction(...args),
}))

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

// The PUT that carries the bytes goes browser → R2 via fetch, not through an
// action — the test asserts it is aimed at the presigned URL.
const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  // jsdom's crypto has no `subtle`; the component fingerprints the file with
  // crypto.subtle.digest, so hand it Node's real webcrypto.
  vi.stubGlobal('crypto', webcrypto)
  createMusicUploadAction.mockResolvedValue({
    ok: true,
    url: 'https://r2.example/presigned-put',
    key: 'boom-busters/music/abc.mp3',
  })
  fetchMock.mockResolvedValue({ ok: true, status: 200 })
  finaliseMusicBedAction.mockResolvedValue({ ok: true })
  deleteMusicBedAction.mockResolvedValue({ ok: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const BEDS: MusicBedView[] = [
  {
    id: '01J000000000000000000000M1',
    title: 'Documentary tension 01',
    licence: 'yt-audio-library',
    moodTags: ['tension', 'slow build'],
    createdAt: '2026-08-18T10:00:00.000Z',
    attributionText: 'Music by Lesfm from Pixabay.',
  },
]

/** Choose a file and licence so Add to library becomes pressable. */
async function armUpload() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  await userEvent.upload(input, new File(['ppp'], 'bed.mp3', { type: 'audio/mpeg' }))
  await userEvent.selectOptions(screen.getByLabelText(/Licence — required/), 'yt-audio-library')
}

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

    await userEvent.selectOptions(screen.getByLabelText(/Licence — required/), 'yt-audio-library')
    expect(add).toBeEnabled()
  })

  it('uploads browser → R2: presign, PUT the bytes at the presigned URL, then finalise', async () => {
    render(<MusicTab beds={[]} />)
    await armUpload()
    await userEvent.click(screen.getByRole('button', { name: 'Add to library' }))

    // Step 1: presign, with the fingerprint of the actual bytes.
    expect(createMusicUploadAction).toHaveBeenCalledTimes(1)
    const created = createMusicUploadAction.mock.calls[0]![0] as {
      fileType: string
      fileSize: number
      contentHash: string
    }
    expect(created.fileType).toBe('audio/mpeg')
    expect(created.contentHash).toMatch(/^[0-9a-f]{64}$/)

    // Step 2: the bytes go straight to storage, never through an action.
    expect(fetchMock).toHaveBeenCalledWith(
      'https://r2.example/presigned-put',
      expect.objectContaining({ method: 'PUT' }),
    )

    // Step 3: the row, carrying the key the presign step issued.
    expect(finaliseMusicBedAction).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'boom-busters/music/abc.mp3',
        contentHash: created.contentHash,
        licence: 'yt-audio-library',
        attributionText: '',
      }),
    )
    expect(toast).toHaveBeenCalledWith({ title: 'Track added to the library' })
    expect(refresh).toHaveBeenCalled()
  })

  it('says so when storage refuses the PUT, and never finalises', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403 })
    render(<MusicTab beds={[]} />)
    await armUpload()
    await userEvent.click(screen.getByRole('button', { name: 'Add to library' }))

    expect(finaliseMusicBedAction).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'error',
        description: expect.stringContaining('403'),
      }),
    )
  })

  it('says so when a call in the chain rejects, instead of doing nothing', async () => {
    // A dropped connection used to be swallowed: no toast, no error, a
    // button that "does nothing".
    createMusicUploadAction.mockRejectedValue(new Error('network down'))
    render(<MusicTab beds={[]} />)
    await armUpload()
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
    await userEvent.selectOptions(screen.getByLabelText(/Licence — required/), 'yt-audio-library')
    await userEvent.click(screen.getByRole('button', { name: 'Add to library' }))

    expect(createMusicUploadAction).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining('25 MB') }),
    )
  })

  it('defaults the title from the file name, minus the extension', async () => {
    render(<MusicTab beds={[]} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, new File(['ppp'], 'night-drive.mp3', { type: 'audio/mpeg' }))
    expect(screen.getByLabelText('Title')).toHaveValue('night-drive')
  })

  it('sends the pasted licence text through to the finalise step (decision 207)', async () => {
    render(<MusicTab beds={[]} />)
    await armUpload()
    await userEvent.type(
      screen.getByLabelText(/Licence \/ attribution text/),
      'Music by Lesfm from Pixabay.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Add to library' }))

    expect(finaliseMusicBedAction).toHaveBeenCalledWith(
      expect.objectContaining({ attributionText: 'Music by Lesfm from Pixabay.' }),
    )
  })

  it('shows the licence text on the bed card, where the record lives', () => {
    render(<MusicTab beds={BEDS} />)
    expect(screen.getByText(/Licence text on file/)).toBeInTheDocument()
    expect(screen.getByText('Music by Lesfm from Pixabay.')).toBeInTheDocument()
  })

  it('lists each bed with its licence, tags, and an inline preview', () => {
    render(<MusicTab beds={BEDS} />)

    expect(screen.getByText('Documentary tension 01')).toBeInTheDocument()
    expect(screen.getByText(/YouTube Audio Library · tension, slow build/)).toBeInTheDocument()
    const player = screen.getByLabelText('Preview: Documentary tension 01')
    expect(player.tagName).toBe('AUDIO')
    expect(player).toHaveAttribute('src', `/api/assets/${BEDS[0]!.id}/file`)
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
