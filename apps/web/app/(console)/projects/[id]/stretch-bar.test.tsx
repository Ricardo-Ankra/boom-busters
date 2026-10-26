import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SlotView, VisualsReviewModel } from '@/lib/visuals-review'
import { StretchBar, useStretchSelection } from './stretch-bar'

const replanStretchAction = vi.hoisted(() => vi.fn())
vi.mock('./visuals-actions', () => ({
  replanStretchAction: (...args: unknown[]) => replanStretchAction(...args),
}))

const PROJECT = '01J0000000000000000000000A'

function slot(id: string, chapterIndex: number, startMs: number, reuseOf?: string): SlotView {
  return {
    id,
    chapterIndex,
    startMs,
    reuse: reuseOf
      ? { sourceSlotId: reuseOf, chapterIndex, startMs: 0, sourceStatus: 'resolved' }
      : null,
  } as unknown as SlotView
}

const chapters = (slots: SlotView[]): VisualsReviewModel['chapters'] => {
  const out: VisualsReviewModel['chapters'] = []
  for (const s of slots) {
    const group = out.find((c) => c.chapterIndex === s.chapterIndex)
    if (group) group.slots.push(s)
    else out.push({ chapterIndex: s.chapterIndex, chapterTitle: 't', slots: [s] })
  }
  return out
}

type TestAct = (
  key: string,
  run: () => Promise<{ ok: boolean }>,
  success: string,
  press?: string,
) => Promise<{ ok: boolean }>

/** A harness that shows the hook the way the board does: a toggle per shot, then the bar. */
function Harness({ slots, act }: { slots: SlotView[]; act: TestAct }) {
  const grouped = chapters(slots)
  const selection = useStretchSelection(grouped)
  return (
    <div>
      {slots.map((s) => (
        <button key={s.id} type="button" onClick={() => selection.toggle(s.id)}>
          {`pick ${s.id}`}
        </button>
      ))}
      <StretchBar projectId={PROJECT} selection={selection} chapters={grouped} act={act as never} />
    </div>
  )
}

const run: TestAct = async (_key, fn) => fn()

beforeEach(() => {
  vi.clearAllMocks()
  replanStretchAction.mockResolvedValue({ ok: true })
})

describe('StretchBar', () => {
  it('selects neighbouring shots and sends them with the note', async () => {
    const act = vi.fn(run)
    render(<Harness slots={[slot('a', 0, 0), slot('b', 0, 5000), slot('c', 0, 9000)]} act={act} />)
    expect(screen.queryByRole('button', { name: /Re-plan these/ })).not.toBeInTheDocument()
    // Picked out of order: the action still gets them in screen order.
    await userEvent.click(screen.getByRole('button', { name: 'pick b' }))
    await userEvent.click(screen.getByRole('button', { name: 'pick a' }))
    const note = screen.getByLabelText('What should change? (optional)')
    expect(note).toHaveAttribute('placeholder', 'keep the headline card up through the CNBC line')
    await userEvent.type(note, 'keep the headline card up')
    await userEvent.click(screen.getByRole('button', { name: 'Re-plan these 2 shots · ≈$0.03' }))

    expect(replanStretchAction).toHaveBeenCalledWith(
      PROJECT,
      ['a', 'b'],
      'keep the headline card up',
    )
    expect(act).toHaveBeenCalledWith(
      'stretch',
      expect.any(Function),
      'Re-planning these shots',
      'stretch',
    )
    // Success clears the selection.
    expect(screen.queryByRole('button', { name: /Re-plan these/ })).not.toBeInTheDocument()
  })

  it('keeps the selection when the action refuses', async () => {
    replanStretchAction.mockResolvedValue({ ok: false, error: 'busy' })
    render(<Harness slots={[slot('a', 0, 0)]} act={vi.fn(run)} />)
    await userEvent.click(screen.getByRole('button', { name: 'pick a' }))
    await userEvent.click(screen.getByRole('button', { name: /Re-plan these 1 shots/ }))
    expect(screen.getByRole('button', { name: /Re-plan these 1 shots/ })).toBeInTheDocument()
  })

  it('clears the selection from Clear selection', async () => {
    render(<Harness slots={[slot('a', 0, 0)]} act={vi.fn(run)} />)
    await userEvent.click(screen.getByRole('button', { name: 'pick a' }))
    await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.queryByRole('button', { name: /Re-plan these/ })).not.toBeInTheDocument()
  })

  it('refuses a selection with a gap', async () => {
    render(
      <Harness
        slots={[slot('a', 0, 0), slot('b', 0, 5000), slot('c', 0, 9000)]}
        act={vi.fn(run)}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'pick a' }))
    await userEvent.click(screen.getByRole('button', { name: 'pick c' }))
    expect(screen.getByRole('button', { name: /Re-plan these 2 shots/ })).toBeDisabled()
    expect(
      screen.getByText('Re-plan works on neighbouring shots in one chapter.'),
    ).toBeInTheDocument()
  })

  it('refuses a selection across chapters', async () => {
    render(<Harness slots={[slot('a', 0, 0), slot('b', 1, 5000)]} act={vi.fn(run)} />)
    await userEvent.click(screen.getByRole('button', { name: 'pick a' }))
    await userEvent.click(screen.getByRole('button', { name: 'pick b' }))
    expect(screen.getByRole('button', { name: /Re-plan these 2 shots/ })).toBeDisabled()
    expect(
      screen.getByText('Re-plan works on neighbouring shots in one chapter.'),
    ).toBeInTheDocument()
  })

  it('names the shot that will lose its borrowed image', async () => {
    render(
      <Harness
        slots={[slot('a', 0, 0), slot('b', 0, 5000), slot('c', 1, 150_000, 'a')]}
        act={vi.fn(run)}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'pick a' }))
    expect(
      screen.getByText("The shot at 2:30 uses this shot's image and will lose it."),
    ).toBeInTheDocument()
  })

  it('does not warn about a borrower that is selected too', async () => {
    render(<Harness slots={[slot('a', 0, 0), slot('b', 0, 5000, 'a')]} act={vi.fn(run)} />)
    await userEvent.click(screen.getByRole('button', { name: 'pick a' }))
    await userEvent.click(screen.getByRole('button', { name: 'pick b' }))
    expect(screen.queryByText(/will lose it/)).not.toBeInTheDocument()
  })

  it('selectStretch replaces the selection', async () => {
    function Pick() {
      const grouped = chapters([slot('a', 0, 0), slot('b', 0, 5000), slot('c', 0, 9000)])
      const selection = useStretchSelection(grouped)
      return (
        <>
          <button type="button" onClick={() => selection.selectStretch(['b', 'c'])}>
            go
          </button>
          <output>{selection.selected.join(',')}</output>
        </>
      )
    }
    render(<Pick />)
    await userEvent.click(screen.getByRole('button', { name: 'go' }))
    expect(screen.getByRole('status')).toHaveTextContent('b,c')
  })
})
