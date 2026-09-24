import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CameraRow } from './camera-row'

const actions = vi.hoisted(() => ({ editBriefAction: vi.fn(async () => ({ ok: true })) }))
vi.mock('./visuals-actions', () => actions)

describe('CameraRow', () => {
  it('shows the camera and saves a new facing, position and lens', async () => {
    const act = vi.fn(async (_slot: string, run: () => Promise<{ ok: boolean }>) => run())
    render(
      <CameraRow
        slotId="s1"
        projectId="p1"
        camera={{ facing: 'north', position: 'the south doorway', lens: '35mm' }}
        busy={false}
        act={act}
      />,
    )
    expect(screen.getByRole('button', { name: 'North' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'East' }))
    const position = screen.getByLabelText('Position')
    await userEvent.clear(position)
    await userEvent.type(position, 'the window seat')
    await userEvent.click(screen.getByRole('button', { name: 'Save camera' }))
    expect(actions.editBriefAction).toHaveBeenCalledWith('p1', 's1', {
      camera: { facing: 'east', position: 'the window seat', lens: '35mm' },
    })
  })

  it('says when a slot has no camera yet, and saves nothing until a position is given', () => {
    render(<CameraRow slotId="s1" projectId="p1" camera={undefined} busy={false} act={vi.fn()} />)
    expect(screen.getByText('No camera yet; set one, or re-plan.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save camera' })).toBeDisabled()
  })

  // Review Focus (fix round 1): SlotCard is keyed by slot.id, which does not
  // change when a re-plan writes a fresh camera onto the same slot — so the
  // row must resync its own fields from a new `camera` prop rather than only
  // reading it on mount.
  it('resyncs facing, position and lens when the stored camera changes under it', () => {
    const { rerender } = render(
      <CameraRow
        slotId="s1"
        projectId="p1"
        camera={{ facing: 'north', position: 'the south doorway', lens: '35mm' }}
        busy={false}
        act={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'North' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Position')).toHaveValue('the south doorway')
    expect(screen.getByLabelText('Lens')).toHaveValue('35mm')

    rerender(
      <CameraRow
        slotId="s1"
        projectId="p1"
        camera={{ facing: 'west', position: 'the corridor glass', lens: '50mm' }}
        busy={false}
        act={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'West' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'North' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByLabelText('Position')).toHaveValue('the corridor glass')
    expect(screen.getByLabelText('Lens')).toHaveValue('50mm')
  })

  it('drops the "no camera yet" note once a re-plan gives the slot a camera', () => {
    const { rerender } = render(
      <CameraRow slotId="s1" projectId="p1" camera={undefined} busy={false} act={vi.fn()} />,
    )
    expect(screen.getByText('No camera yet; set one, or re-plan.')).toBeInTheDocument()

    rerender(
      <CameraRow
        slotId="s1"
        projectId="p1"
        camera={{ facing: 'east', position: 'the window seat' }}
        busy={false}
        act={vi.fn()}
      />,
    )
    expect(screen.queryByText('No camera yet; set one, or re-plan.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'East' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Position')).toHaveValue('the window seat')
  })
})
