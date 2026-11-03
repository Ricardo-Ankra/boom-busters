import { EXAMPLE_SLOTS } from '@boom-busters/schemas'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ExamplesEditor, ExamplesView } from './bible-examples'

const allWritten = () => Object.fromEntries(EXAMPLE_SLOTS.map((s) => [s.id, 'x']))
const stageHeading = (name: RegExp) => screen.getByRole('heading', { level: 4, name })

describe('the examples section', () => {
  it('groups the slots by stage with a written count', () => {
    render(<ExamplesView examples={{}} flags={{}} disabled={false} onDraftSlot={vi.fn()} />)
    expect(screen.getByText('0 of 44 examples written')).toBeInTheDocument()
    expect(stageHeading(/Direction/)).toBeInTheDocument()
    expect(screen.getAllByText('No example yet')).toHaveLength(44)
    expect(screen.queryByText(/^In: /)).toBeNull()
    expect(screen.queryByText('script-foreshadow')).toBeNull()
  })

  it('drafts one slot by its title', async () => {
    const onDraftSlot = vi.fn()
    render(<ExamplesView examples={{}} flags={{}} disabled={false} onDraftSlot={onDraftSlot} />)
    await userEvent.click(screen.getByRole('button', { name: 'Draft A foreshadowing line' }))
    expect(onDraftSlot).toHaveBeenCalledWith('script-foreshadow')
  })

  it('Next missing reopens a closed group and focuses its first empty box', async () => {
    const all = allWritten()
    delete all['shotlist-two-units']
    render(<ExamplesEditor examples={all} flags={{}} disabled={false} onChange={vi.fn()} />)
    const group = stageHeading(/Shot list/).closest('details')!
    expect(group.open).toBe(true)
    await userEvent.click(stageHeading(/Shot list/))
    await waitFor(() => expect(group.open).toBe(false))
    await userEvent.click(screen.getByRole('button', { name: 'Next missing' }))
    await waitFor(() => expect(group.open).toBe(true))
    await waitFor(() =>
      expect(screen.getByLabelText('Two measures that need two axes')).toHaveFocus(),
    )
  })

  it('Next missing reopens a closed group and focuses its Draft button in the view', async () => {
    const all = allWritten()
    delete all['shotlist-two-units']
    render(<ExamplesView examples={all} flags={{}} disabled={false} onDraftSlot={vi.fn()} />)
    const group = stageHeading(/Shot list/).closest('details')!
    await userEvent.click(stageHeading(/Shot list/))
    await waitFor(() => expect(group.open).toBe(false))
    await userEvent.click(screen.getByRole('button', { name: 'Next missing' }))
    await waitFor(() => expect(group.open).toBe(true))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Draft Two measures that need two axes' }),
      ).toHaveFocus(),
    )
  })

  it('says all are written and offers no Next missing when every slot has text', () => {
    render(
      <ExamplesView examples={allWritten()} flags={{}} disabled={false} onDraftSlot={vi.fn()} />,
    )
    expect(screen.getByText('All 44 examples written')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next missing' })).toBeNull()
  })

  it('treats blank text as empty and starts only groups with a gap open', () => {
    const all = allWritten()
    all['direction-premise'] = '   '
    render(<ExamplesView examples={all} flags={{}} disabled={false} onDraftSlot={vi.fn()} />)
    expect(screen.getByText('43 of 44 examples written')).toBeInTheDocument()
    expect(stageHeading(/Direction/).closest('details')!.open).toBe(true)
    expect(stageHeading(/Script/).closest('details')!.open).toBe(false)
  })

  it('opens a group that holds a flagged slot', () => {
    render(
      <ExamplesView
        examples={allWritten()}
        flags={{ 'examples.script-foreshadow': { source: 'Alpha: A title', run: 'one two three' } }}
        disabled={false}
        onDraftSlot={vi.fn()}
      />,
    )
    expect(stageHeading(/Script/).closest('details')!.open).toBe(true)
    expect(screen.getByText(/Too close to its source/)).toBeInTheDocument()
  })

  it('labels each box by title, describes it by what it teaches, and sizes it by kind', () => {
    render(<ExamplesEditor examples={{}} flags={{}} disabled={false} onChange={vi.fn()} />)
    const legal = screen.getByLabelText('How legal care is carried')
    expect(legal).toHaveAccessibleDescription(/Never narrate the caveat/)
    expect(legal).toHaveAttribute('rows', '6')
    expect(screen.getByLabelText('What the channel is about')).toHaveAttribute('rows', '2')
  })

  it('warns at 90 percent of the limit', () => {
    render(
      <ExamplesEditor
        examples={{ 'direction-premise': 'x'.repeat(54) }}
        flags={{}}
        disabled={false}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText('54 of 60 characters').className).toContain('--color-warning')
  })

  it('drops keys the registry does not hold when it changes', async () => {
    const onChange = vi.fn()
    render(
      <ExamplesEditor
        examples={{ 'graphics-worked-beat': 'old' }}
        flags={{}}
        disabled={false}
        onChange={onChange}
      />,
    )
    await userEvent.type(screen.getByLabelText('A foreshadowing line'), 'a')
    expect(onChange.mock.lastCall![0]).not.toHaveProperty('graphics-worked-beat')
  })
})
