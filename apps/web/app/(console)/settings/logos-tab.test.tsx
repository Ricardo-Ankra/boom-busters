import { webcrypto } from 'node:crypto'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LogosTab } from './logos-tab'
import type { LogoView } from './logos-tab'

const actions = vi.hoisted(() => ({
  createLogoUploadAction: vi.fn(),
  finaliseLogoAction: vi.fn(),
  addLogoFromUrlAction: vi.fn(),
  renameLogoAction: vi.fn(),
  removeLogoAction: vi.fn(),
  setChannelMarkAction: vi.fn(),
}))
vi.mock('./logo-actions', () => actions)

// The browser conversion needs a decoder jsdom lacks; here a PNG passes
// through, which is what the tab is on the hook for using.
vi.mock('@/lib/client-image', () => ({
  toUploadableLogo: async (file: File) => ({ ok: true, file }),
  readImageSize: async () => ({ width: 640, height: 200 }),
}))

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

const fetchMock = vi.fn()

const LOGOS: LogoView[] = [
  {
    id: '01J000000000000000000000L1',
    title: 'Stability AI',
    r2Key: 'boom-busters/logos/aaa.png',
    width: 1200,
    height: 400,
    url: 'https://r2.example/aaa.png',
  },
  {
    id: '01J000000000000000000000L2',
    title: 'Wirecard AG',
    r2Key: 'mock://logos/bbb',
    width: null,
    height: null,
    url: null,
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('crypto', webcrypto)
  actions.createLogoUploadAction.mockResolvedValue({
    ok: true,
    url: 'https://r2.example/put',
    key: 'boom-busters/logos/abc.png',
  })
  fetchMock.mockResolvedValue({ ok: true, status: 200 })
  for (const action of [
    actions.finaliseLogoAction,
    actions.addLogoFromUrlAction,
    actions.renameLogoAction,
    actions.removeLogoAction,
    actions.setChannelMarkAction,
  ]) {
    action.mockResolvedValue({ ok: true })
  }
})

afterEach(() => vi.unstubAllGlobals())

describe('LogosTab', () => {
  it('lists every mark by name, with a preview or a note that mock storage has none', () => {
    render(<LogosTab logos={LOGOS} channelMarkKey={null} />)
    const list = screen.getByRole('list', { name: 'Logo library' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).getByRole('img', { name: 'Stability AI' })).toHaveAttribute(
      'src',
      'https://r2.example/aaa.png',
    )
    expect(within(list).getByText('No preview in mock storage')).toBeInTheDocument()
  })

  it('shows the tile on the brand ground when one is given, the console ground otherwise', () => {
    render(<LogosTab logos={LOGOS} channelMarkKey={null} brandBackground="#101820" />)
    const tile = screen.getByRole('img', { name: 'Stability AI' }).parentElement
    expect(tile).toHaveStyle({ backgroundColor: '#101820' })
  })

  it('marks the channel mark and offers the others as candidates', async () => {
    render(<LogosTab logos={LOGOS} channelMarkKey="boom-busters/logos/aaa.png" />)
    expect(screen.getByText('Channel mark')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Use Wirecard AG as channel mark' }))
    expect(actions.setChannelMarkAction).toHaveBeenCalledWith('01J000000000000000000000L2')
    await userEvent.click(screen.getByRole('button', { name: 'Use no mark' }))
    expect(actions.setChannelMarkAction).toHaveBeenCalledWith(null)
  })

  it('uploads browser to R2: convert, presign, PUT, then finalise with the name and size', async () => {
    render(<LogosTab logos={[]} channelMarkKey={null} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).toHaveAttribute('accept', expect.stringContaining('image/svg+xml'))

    await userEvent.type(screen.getByLabelText('Name'), 'Stability AI')
    await userEvent.upload(
      input,
      new File([new Uint8Array([1, 2, 3])], 'stability.png', { type: 'image/png' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Add to library' }))

    await waitFor(() => expect(actions.finaliseLogoAction).toHaveBeenCalled())
    expect(actions.createLogoUploadAction).toHaveBeenCalledWith(
      expect.objectContaining({
        fileType: 'image/png',
        fileSize: 3,
        contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://r2.example/put',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
      }),
    )
    expect(actions.finaliseLogoAction).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'boom-busters/logos/abc.png',
        title: 'Stability AI',
        width: 640,
        height: 200,
      }),
    )
    expect(refresh).toHaveBeenCalled()
  })

  it('names the status in the error toast when storage refuses the PUT, and does not finalise', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403 })
    render(<LogosTab logos={[]} channelMarkKey={null} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement

    await userEvent.type(screen.getByLabelText('Name'), 'Stability AI')
    await userEvent.upload(
      input,
      new File([new Uint8Array([1, 2, 3])], 'stability.png', { type: 'image/png' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Add to library' }))

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringContaining('403'),
          variant: 'error',
        }),
      ),
    )
    expect(actions.finaliseLogoAction).not.toHaveBeenCalled()
  })

  it('does not finalise, and reports the error, when the upload could not be prepared', async () => {
    // `createLogoUploadAction` resolving `ok: true` with no `url`/`key` is
    // not a success the browser can act on: nothing was presigned to PUT to.
    actions.createLogoUploadAction.mockResolvedValue({ ok: true })
    render(<LogosTab logos={[]} channelMarkKey={null} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement

    await userEvent.type(screen.getByLabelText('Name'), 'Stability AI')
    await userEvent.upload(
      input,
      new File([new Uint8Array([1, 2, 3])], 'stability.png', { type: 'image/png' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Add to library' }))

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'That did not work',
          description: 'The upload could not be prepared. Try again.',
          variant: 'error',
        }),
      ),
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(actions.finaliseLogoAction).not.toHaveBeenCalled()
  })

  it('pre-fills the name from the file and warns that a JPEG has no transparency', async () => {
    render(<LogosTab logos={[]} channelMarkKey={null} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, new File(['x'], 'wirecard-ag.jpg', { type: 'image/jpeg' }))
    expect(screen.getByLabelText('Name')).toHaveValue('Wirecard Ag')
    expect(screen.getByText(/no transparency/i)).toBeInTheDocument()
  })

  it('adds a mark by address with its name', async () => {
    render(<LogosTab logos={[]} channelMarkKey={null} />)
    await userEvent.type(screen.getByLabelText('Name'), 'Wirecard AG')
    await userEvent.type(
      screen.getByLabelText('Or paste an image address'),
      'https://cdn.example/mark.svg',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Add from address' }))
    expect(actions.addLogoFromUrlAction).toHaveBeenCalledWith({
      url: 'https://cdn.example/mark.svg',
      title: 'Wirecard AG',
    })
  })

  it('renames in place and removes behind a confirm that names the consequence', async () => {
    render(<LogosTab logos={LOGOS} channelMarkKey={null} />)
    const row = screen.getByRole('listitem', { name: 'Stability AI' })
    const name = within(row).getByLabelText('Rename Stability AI')
    await userEvent.clear(name)
    await userEvent.type(name, 'Stability')
    await userEvent.click(within(row).getByRole('button', { name: 'Save name' }))
    expect(actions.renameLogoAction).toHaveBeenCalledWith({ id: LOGOS[0]!.id, title: 'Stability' })

    await userEvent.click(within(row).getByRole('button', { name: 'Remove' }))
    await userEvent.click(within(row).getByRole('button', { name: 'Remove mark' }))
    expect(actions.removeLogoAction).toHaveBeenCalledWith(LOGOS[0]!.id)
  })

  it('shows the action error when a removal is refused', async () => {
    actions.removeLogoAction.mockResolvedValue({ ok: false, error: 'This is the channel mark.' })
    render(<LogosTab logos={LOGOS} channelMarkKey="boom-busters/logos/aaa.png" />)
    const row = screen.getByRole('listitem', { name: 'Stability AI' })
    await userEvent.click(within(row).getByRole('button', { name: 'Remove' }))
    await userEvent.click(within(row).getByRole('button', { name: 'Remove mark' }))
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'This is the channel mark.', variant: 'error' }),
      ),
    )
  })
})
