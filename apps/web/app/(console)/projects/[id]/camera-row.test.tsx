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
})
