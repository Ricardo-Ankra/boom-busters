import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmButton } from './confirm-button'

function renderButton(onConfirm = vi.fn()) {
  render(
    <ConfirmButton
      label="Stop"
      confirmLabel="Stop this run"
      consequence="The run stops where it is. Nothing is refunded."
      onConfirm={onConfirm}
    />,
  )
  return onConfirm
}

describe('ConfirmButton', () => {
  it('moves focus to the confirm control and describes it with the consequence', async () => {
    const user = userEvent.setup()
    renderButton()

    await user.click(screen.getByRole('button', { name: 'Stop' }))

    const confirm = screen.getByRole('button', { name: 'Stop this run' })
    await waitFor(() => expect(confirm).toHaveFocus())
    expect(confirm).toHaveAccessibleDescription('The run stops where it is. Nothing is refunded.')
  })

  it('puts focus back on the trigger when cancelled', async () => {
    const user = userEvent.setup()
    renderButton()

    await user.click(screen.getByRole('button', { name: 'Stop' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    const trigger = screen.getByRole('button', { name: 'Stop' })
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.queryByRole('button', { name: 'Stop this run' })).not.toBeInTheDocument()
  })

  it('runs the action once and disarms afterwards', async () => {
    const user = userEvent.setup()
    const onConfirm = renderButton()

    await user.click(screen.getByRole('button', { name: 'Stop' }))
    await user.click(screen.getByRole('button', { name: 'Stop this run' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument())
  })
})
