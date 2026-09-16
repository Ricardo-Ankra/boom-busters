import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CastMember } from '@boom-busters/schemas'
import { CastCard } from './cast-card'

const actions = vi.hoisted(() => ({
  addCastMemberAction: vi.fn(),
  updateCastMemberAction: vi.fn(),
  removeCastMemberAction: vi.fn(),
  createCastPhotoUploadAction: vi.fn(),
  finaliseCastPhotoAction: vi.fn(),
  removeCastPhotoAction: vi.fn(),
  describeCastMemberAction: vi.fn(),
}))
vi.mock('./cast-actions', () => actions)

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

const PROJECT = '01J0000000000000000000000A'
const MEMBER = '01J0000000000000000000000B'

const emad: CastMember = {
  id: MEMBER,
  projectId: PROJECT,
  name: 'Emad Mostaque',
  role: 'Founder and former CEO, Stability AI',
  identityString: 'Emad Mostaque, founder: oval face, short dark hair, close-cropped beard',
  guardrail: 'never in handcuffs',
  photos: [
    {
      r2Key: 'boom-busters/cast/p/aaa.jpg',
      contentHash: 'aaa',
      mimeType: 'image/jpeg',
      width: 1200,
      height: 1600,
      view: 'front',
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const action of Object.values(actions)) action.mockResolvedValue({ ok: true })
  actions.createCastPhotoUploadAction.mockResolvedValue({
    ok: true,
    url: 'https://r2.example/put',
    key: 'k',
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 200 })),
  )
})

describe('CastCard', () => {
  it('collapses to faces and names, and opens for editing', async () => {
    render(<CastCard projectId={PROJECT} members={[emad]} photoUrls={{ aaa: 'https://img/aaa' }} />)
    const list = screen.getByRole('list', { name: 'Cast members' })
    expect(within(list).getByText('Emad Mostaque')).toBeInTheDocument()
    expect(within(list).getByRole('img', { name: 'Emad Mostaque' })).toHaveAttribute(
      'src',
      'https://img/aaa',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Edit cast' }))
    expect(screen.getByLabelText('Identity string')).toHaveValue(emad.identityString)
  })

  it('opens itself while someone seeded from the book still has no photo, and says so', () => {
    const prem: CastMember = {
      ...emad,
      id: '01J0000000000000000000000C',
      name: 'Prem Akkaraju',
      role: 'CEO from 2024',
      photos: [],
    }
    render(<CastCard projectId={PROJECT} members={[emad, prem]} photoUrls={{}} />)
    expect(screen.getByRole('status')).toHaveTextContent('1 person still needs a photo.')
    // Open from the start: the rows are on screen, not the collapsed list.
    expect(screen.queryByRole('list', { name: 'Cast members' })).not.toBeInTheDocument()
    const row = screen.getByRole('region', { name: 'Prem Akkaraju' })
    expect(within(row).getByText(/none yet; stills of Prem Akkaraju/)).toBeInTheDocument()
    expect(within(row).getByLabelText('Identity string')).toHaveValue(emad.identityString)
    expect(screen.getByRole('button', { name: 'Hide cast' })).toBeInTheDocument()
  })

  it('opens straight away when the cast is empty and adds a person', async () => {
    render(<CastCard projectId={PROJECT} members={[]} photoUrls={{}} />)
    await userEvent.type(screen.getByLabelText('Full name'), 'Prem Akkaraju')
    await userEvent.type(screen.getByLabelText('Role'), 'CEO, Stability AI')
    await userEvent.click(screen.getByRole('button', { name: 'Add person' }))
    expect(actions.addCastMemberAction).toHaveBeenCalledWith(PROJECT, {
      name: 'Prem Akkaraju',
      role: 'CEO, Stability AI',
    })
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('shows the photo tiles with their view labels and removes one', async () => {
    render(<CastCard projectId={PROJECT} members={[emad]} photoUrls={{ aaa: 'https://img/aaa' }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit cast' }))
    const photos = screen.getByRole('list', { name: 'Emad Mostaque photos' })
    expect(within(photos).getByRole('img', { name: /front view/ })).toBeInTheDocument()
    await userEvent.click(
      within(photos).getByRole('button', { name: 'Remove front photo of Emad Mostaque' }),
    )
    expect(actions.removeCastPhotoAction).toHaveBeenCalledWith({
      memberId: MEMBER,
      contentHash: 'aaa',
    })
  })

  it('uploads a photo: hash, presigned PUT, then finalise with the chosen view', async () => {
    render(<CastCard projectId={PROJECT} members={[emad]} photoUrls={{}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit cast' }))
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'View of the next photo of Emad Mostaque' }),
      'profile',
    )
    const file = new File([new Uint8Array([1, 2, 3])], 'emad.jpg', { type: 'image/jpeg' })
    await userEvent.upload(screen.getByLabelText('Upload a photo of Emad Mostaque'), file)

    await waitFor(() => expect(actions.finaliseCastPhotoAction).toHaveBeenCalled())
    expect(actions.createCastPhotoUploadAction).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: MEMBER,
        mimeType: 'image/jpeg',
        fileSize: 3,
        contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    )
    expect(fetch).toHaveBeenCalledWith(
      'https://r2.example/put',
      expect.objectContaining({ method: 'PUT' }),
    )
    expect(actions.finaliseCastPhotoAction).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: MEMBER, view: 'profile', mimeType: 'image/jpeg' }),
    )
  })

  it('saves edited text, describes from photos, and asks before removing a person', async () => {
    render(<CastCard projectId={PROJECT} members={[emad]} photoUrls={{}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit cast' }))
    const guardrail = screen.getByLabelText('Guardrail')
    await userEvent.clear(guardrail)
    await userEvent.type(guardrail, 'never mocked')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(actions.updateCastMemberAction).toHaveBeenCalledWith(
      MEMBER,
      expect.objectContaining({ guardrail: 'never mocked', name: 'Emad Mostaque' }),
    )

    await userEvent.click(screen.getByRole('button', { name: /Describe from photos/ }))
    expect(actions.describeCastMemberAction).toHaveBeenCalledWith(MEMBER)

    await userEvent.click(screen.getByRole('button', { name: 'Remove person' }))
    expect(actions.removeCastMemberAction).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Remove Emad Mostaque' }))
    expect(actions.removeCastMemberAction).toHaveBeenCalledWith(MEMBER)
  })

  it('reports a refused action in a toast instead of silence', async () => {
    actions.describeCastMemberAction.mockResolvedValue({
      ok: false,
      error: 'Upload a photo first.',
    })
    render(<CastCard projectId={PROJECT} members={[emad]} photoUrls={{}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit cast' }))
    await userEvent.click(screen.getByRole('button', { name: /Describe from photos/ }))
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'error', description: 'Upload a photo first.' }),
      ),
    )
    expect(refresh).not.toHaveBeenCalled()
  })
})
