import { webcrypto } from 'node:crypto'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ClientVideo from '@/lib/client-video'
import { ReferenceMarker } from './reference-marker'

/**
 * The marker dialog (spec 2026-11-04, section 7.2): a still goes presign,
 * PUT, finalise; a clip is marked with a window of one to four seconds and
 * its frames are taken in the browser before anything is uploaded. jsdom
 * decodes no media, so the clip's metadata and the grabber are seams.
 */

const CH = '01J00000000000000000000001'

const actions = vi.hoisted(() => ({
  createReferenceUploadAction: vi.fn(),
  createReferenceFrameUploadsAction: vi.fn(),
  finaliseReferenceAction: vi.fn(),
  remarkReferenceAction: vi.fn(),
}))
vi.mock('./motion-actions', () => actions)

vi.mock('@/lib/client-image', () => ({
  toUploadableImage: async (file: File) => ({ ok: true, file }),
  readImageSize: async () => ({ width: 1200, height: 800 }),
}))

const grabber = vi.hoisted(() => ({
  seeks: [] as number[],
  failAt: null as number | null,
}))
vi.mock('@/lib/client-video', async (importOriginal) => {
  const original = await importOriginal<typeof ClientVideo>()
  return {
    ...original,
    readVideoMeta: async () => ({ durationMs: 10_000, width: 1920, height: 1080 }),
    browserGrabber: () => ({
      async seek(atMs: number) {
        if (grabber.failAt !== null && grabber.seeks.length >= grabber.failAt) {
          throw new Error('the clip did not seek')
        }
        grabber.seeks.push(atMs)
      },
      async draw() {
        return new Blob([new Uint8Array([1])], { type: 'image/jpeg' })
      },
    }),
  }
})

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

const fetchMock = vi.fn()
const onClose = vi.fn()

function renderMarker(over: Partial<React.ComponentProps<typeof ReferenceMarker>> = {}) {
  return render(
    <ReferenceMarker
      channelId={CH}
      mode={{ kind: 'add' }}
      storageReady
      readingEstimateUsd={0.042}
      onClose={onClose}
      {...over}
    />,
  )
}

async function fillWords() {
  await userEvent.type(screen.getByLabelText('Title'), 'A board of type')
  await userEvent.selectOptions(screen.getByLabelText('Purpose'), 'look')
  await userEvent.type(screen.getByLabelText('Carry over'), 'borrow the weight, not the words')
}

beforeEach(() => {
  vi.clearAllMocks()
  grabber.seeks = []
  grabber.failAt = null
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:clip', revokeObjectURL: () => {} })
  fetchMock.mockResolvedValue({ ok: true, status: 200 })
  actions.createReferenceUploadAction.mockResolvedValue({
    ok: true,
    url: 'https://r2.example/put',
    key: 'k',
  })
  actions.createReferenceFrameUploadsAction.mockImplementation(
    async (_: string, input: { dense: number[]; overview: number[] }) => ({
      ok: true,
      uploads: [
        ...input.dense.map((atMs) => ({
          set: 'dense',
          atMs,
          key: `d/${atMs}`,
          url: 'https://r2.example/f',
        })),
        ...input.overview.map((atMs) => ({
          set: 'overview',
          atMs,
          key: `o/${atMs}`,
          url: 'https://r2.example/f',
        })),
      ],
    }),
  )
  actions.finaliseReferenceAction.mockResolvedValue({ ok: true, id: 'r1' })
  actions.remarkReferenceAction.mockResolvedValue({ ok: true })
})

describe('ReferenceMarker', () => {
  it('uploads a still through presign, PUT and finalise, and reads it on Save and read', async () => {
    renderMarker()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(
      input,
      new File([new Uint8Array([1, 2, 3])], 'board.png', { type: 'image/png' }),
    )
    await fillWords()
    expect(screen.getByText(/about \$0\.042/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save and read' }))
    await waitFor(() => expect(actions.finaliseReferenceAction).toHaveBeenCalled())
    expect(actions.createReferenceUploadAction).toHaveBeenCalledWith(
      CH,
      expect.objectContaining({ fileType: 'image/png', fileSize: 3 }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://r2.example/put',
      expect.objectContaining({ method: 'PUT' }),
    )
    expect(actions.finaliseReferenceAction.mock.calls[0]![1]).toMatchObject({
      fileType: 'image/png',
      width: 1200,
      height: 800,
      frames: [],
      read: true,
      input: expect.objectContaining({
        kind: 'image',
        title: 'A board of type',
        purpose: 'look',
        carryOver: 'borrow the weight, not the words',
        windowStartMs: null,
        windowEndMs: null,
      }),
    })
    expect(actions.createReferenceFrameUploadsAction).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
    expect(refresh).toHaveBeenCalled()
  })

  it('refuses a window outside one to four seconds before any upload', async () => {
    renderMarker()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(
      input,
      new File([new Uint8Array([1])], 'reel.mp4', { type: 'video/mp4' }),
    )
    await fillWords()
    const end = await screen.findByLabelText('Window end (s)')
    await userEvent.clear(end)
    await userEvent.type(end, '0.5')
    expect(screen.getByText('The window is one to four seconds.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save and read' })).toBeDisabled()
    expect(actions.createReferenceUploadAction).not.toHaveBeenCalled()
  })

  it('counts the frames the window asks for, takes them, and uploads them before the finalise', async () => {
    renderMarker()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(
      input,
      new File([new Uint8Array([1])], 'reel.mp4', { type: 'video/mp4' }),
    )
    await fillWords()
    const start = await screen.findByLabelText('Window start (s)')
    const end = screen.getByLabelText('Window end (s)')
    await userEvent.clear(start)
    await userEvent.type(start, '1')
    await userEvent.clear(end)
    await userEvent.type(end, '3.5')
    expect(screen.getByText('Window 2.5 s: 30 frames')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save without reading' }))
    await waitFor(() => expect(actions.finaliseReferenceAction).toHaveBeenCalled())
    // 30 dense frames and 20 overview frames of a 10 s clip, taken in the browser.
    expect(grabber.seeks).toHaveLength(50)
    expect(actions.createReferenceFrameUploadsAction).toHaveBeenCalledWith(
      CH,
      expect.objectContaining({ dense: expect.any(Array), overview: expect.any(Array) }),
    )
    // One PUT for the clip and one per frame.
    expect(fetchMock).toHaveBeenCalledTimes(51)
    expect(actions.finaliseReferenceAction.mock.calls[0]![1]).toMatchObject({
      fileType: 'video/mp4',
      durationMs: 10_000,
      read: false,
      input: expect.objectContaining({ kind: 'video', windowStartMs: 1000, windowEndMs: 3500 }),
    })
    expect(actions.finaliseReferenceAction.mock.calls[0]![1].frames).toHaveLength(50)
  })

  it('takes the frames before anything is uploaded, so a stalled clip costs no upload (final review, issue 7)', async () => {
    grabber.failAt = 7
    renderMarker()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(
      input,
      new File([new Uint8Array([1])], 'reel.mp4', { type: 'video/mp4' }),
    )
    await fillWords()
    await screen.findByLabelText('Window start (s)')
    await userEvent.click(screen.getByRole('button', { name: 'Save without reading' }))
    expect(await screen.findByText(/Only 7 of 24 frames could be taken/)).toBeInTheDocument()
    expect(actions.createReferenceUploadAction).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('plays a stored clip with crossOrigin anonymous so its frames can be drawn (final review, issue 1)', async () => {
    renderMarker({
      mode: {
        kind: 'remark',
        reference: {
          id: '01J000000000000000000000R1',
          kind: 'video',
          title: 'A reel',
          sourceUrl: null,
          rights: 'Reference only',
          purpose: 'mechanism',
          negative: false,
          windowStartMs: 1000,
          windowEndMs: 3000,
          carryOver: 'borrow the hold',
          avoid: '',
          readState: 'read',
          readStale: false,
          readError: null,
          reading: null,
          thumbUrl: null,
          denseSheetUrl: null,
          contactSheetUrl: null,
          clipUrl: 'https://r2.example/clip.mp4?signed',
          contentHash: 'a'.repeat(64),
          durationMs: 10_000,
          width: 1920,
          height: 1080,
        },
      },
    })
    const video = screen.getByLabelText('The clip') as HTMLVideoElement
    expect(video).toHaveAttribute('crossorigin', 'anonymous')
    expect(video).toHaveAttribute('src', 'https://r2.example/clip.mp4?signed')
    expect(screen.getByRole('dialog', { name: 'Re-mark reference' })).toBeInTheDocument()
  })

  it('disables saving without storage and says why', () => {
    renderMarker({ storageReady: false })
    expect(screen.getByText(/R2 configured/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save and read' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save without reading' })).toBeDisabled()
  })
})
