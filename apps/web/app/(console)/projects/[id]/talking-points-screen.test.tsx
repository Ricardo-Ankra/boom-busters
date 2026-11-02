import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Notice } from '@boom-busters/schemas'
import type { TalkingPointCard, TalkingPointsModel } from '@/lib/talking-points-review'
import { TalkingPointsScreen } from './talking-points-screen'

/**
 * The Talking points screen (playbook Shorts design 3.3): every action a
 * visible labelled button, the cards in order with chapters by title, the
 * estimate labelled as one, and the whole screen locked while a redo runs.
 */

// project-controls (for useAction) drags '../actions' in, and with it
// next-auth, which cannot load under jsdom.
vi.mock('../actions', () => ({
  approveGate: vi.fn(),
  stopProject: vi.fn(),
  restartStage: vi.fn(),
}))

const approveTalkingPoints = vi.fn()
const redoTalkingPoints = vi.fn()
const redoTalkingPoint = vi.fn()
const addTalkingPoint = vi.fn()
const removeTalkingPoint = vi.fn()
vi.mock('./talking-points-actions', () => ({
  approveTalkingPoints: (...args: unknown[]) => approveTalkingPoints(...args),
  redoTalkingPoints: (...args: unknown[]) => redoTalkingPoints(...args),
  redoTalkingPoint: (...args: unknown[]) => redoTalkingPoint(...args),
  addTalkingPoint: (...args: unknown[]) => addTalkingPoint(...args),
  removeTalkingPoint: (...args: unknown[]) => removeTalkingPoint(...args),
}))

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

vi.mock('@/app/(console)/notice-actions', () => ({ dismissNoticeAction: vi.fn() }))

const PROJECT = '01J0000000000000000000000A'

function pointCard(n: number, over: Partial<TalkingPointCard> = {}): TalkingPointCard {
  return {
    id: `01HQ0000000000000000000P0${n}`,
    type: 'forensic-breakdown',
    typeLabel: 'Forensic breakdown',
    title: `Point ${n} title`,
    question: `What did the auditors miss in year ${n}?`,
    payoff: `They never tested the cash balances in year ${n}.`,
    bridge: 'The long film walks through how that unravelled.',
    hook: 'Nobody checked the one number that mattered.',
    order: n,
    sourceChapters: [{ index: 0, title: 'The missing number' }],
    bridgeChapters: [{ index: 1, title: 'The refusal' }],
    ...over,
  }
}

function model(over: Partial<TalkingPointsModel> = {}): TalkingPointsModel {
  return {
    version: 3,
    points: [pointCard(1), pointCard(2, { typeLabel: 'Contrarian thesis' }), pointCard(3)],
    history: [
      { version: 3, note: 'Removed: Point 4 title', createdAt: '2026-11-02T08:00:00.000Z' },
      { version: 2, note: 'fewer contrarian ones', createdAt: '2026-11-02T07:00:00.000Z' },
      { version: 1, note: null, createdAt: '2026-11-02T06:00:00.000Z' },
    ],
    estimateUsd: 2.4567,
    busy: false,
    ...over,
  }
}

function notice(message: string): Notice {
  return {
    id: '01HQ00000000000000000000N1',
    projectId: PROJECT,
    subject: 'points',
    subjectId: null,
    kind: 'skipped',
    message,
    createdAt: new Date('2026-11-02T08:00:00Z'),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const action of [
    approveTalkingPoints,
    redoTalkingPoints,
    redoTalkingPoint,
    addTalkingPoint,
    removeTalkingPoint,
  ]) {
    action.mockResolvedValue({ ok: true })
  }
})

describe('TalkingPointsScreen', () => {
  it('shows each card in order with its type in words, chapters by title and no ids', () => {
    render(<TalkingPointsScreen projectId={PROJECT} model={model()} />)

    const cards = screen.getAllByRole('article')
    expect(cards).toHaveLength(3)
    const first = within(cards[0]!)
    expect(first.getByText('Forensic breakdown')).toBeTruthy()
    expect(first.getByText('Point 1 title')).toBeTruthy()
    expect(first.getByText('What did the auditors miss in year 1?')).toBeTruthy()
    expect(first.getByText('They never tested the cash balances in year 1.')).toBeTruthy()
    expect(first.getByText('The long film walks through how that unravelled.')).toBeTruthy()
    expect(first.getByText(/The missing number/)).toBeTruthy()
    expect(first.getByText(/The refusal/)).toBeTruthy()
    expect(within(cards[1]!).getByText('Contrarian thesis')).toBeTruthy()
  })

  it('has every action as a labelled button', () => {
    render(<TalkingPointsScreen projectId={PROJECT} model={model()} />)

    expect(screen.getAllByRole('button', { name: 'Redo this one' })).toHaveLength(3)
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Redo talking points' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add a point' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Approve talking points' })).toBeTruthy()
    expect(screen.getByLabelText('Suggest changes')).toBeTruthy()
  })

  it('shows the version, the note history and the estimate labelled as one', () => {
    render(<TalkingPointsScreen projectId={PROJECT} model={model()} />)

    expect(screen.getAllByText('Version 3').length).toBeGreaterThanOrEqual(1)
    const history = within(screen.getByRole('region', { name: 'History' }))
    expect(history.getByText(/fewer contrarian ones/)).toBeTruthy()
    expect(history.getByText(/Removed: Point 4 title/)).toBeTruthy()
    expect(screen.getByText('Estimated cost to build: $2.46 (estimate)')).toBeTruthy()
  })

  it('shows notices on the points subject above the cards', () => {
    render(
      <TalkingPointsScreen
        projectId={PROJECT}
        model={model()}
        notices={[notice('The model gave six points; the extra one was dropped.')]}
      />,
    )
    expect(screen.getByText('The model gave six points; the extra one was dropped.')).toBeTruthy()
  })

  it('Approve talking points sends the version on screen', async () => {
    const user = userEvent.setup()
    render(<TalkingPointsScreen projectId={PROJECT} model={model()} />)

    await user.click(screen.getByRole('button', { name: 'Approve talking points' }))

    expect(approveTalkingPoints).toHaveBeenCalledWith(PROJECT, 3)
  })

  it('Redo talking points sends the note and clears the box', async () => {
    const user = userEvent.setup()
    render(<TalkingPointsScreen projectId={PROJECT} model={model()} />)
    const box = screen.getByLabelText('Suggest changes') as HTMLTextAreaElement

    await user.type(box, 'make one about the auditors')
    await user.click(screen.getByRole('button', { name: 'Redo talking points' }))

    expect(redoTalkingPoints).toHaveBeenCalledWith(PROJECT, 'make one about the auditors')
    expect(box.value).toBe('')
  })

  it('Add a point sends the same note box', async () => {
    const user = userEvent.setup()
    render(<TalkingPointsScreen projectId={PROJECT} model={model()} />)

    await user.type(screen.getByLabelText('Suggest changes'), 'one on the fine')
    await user.click(screen.getByRole('button', { name: 'Add a point' }))

    expect(addTalkingPoint).toHaveBeenCalledWith(PROJECT, 'one on the fine')
  })

  it('Redo this one opens a note box with its own Redo button', async () => {
    const user = userEvent.setup()
    render(<TalkingPointsScreen projectId={PROJECT} model={model()} />)
    const second = within(screen.getAllByRole('article')[1]!)
    expect(second.queryByRole('button', { name: 'Redo' })).toBeNull()

    await user.click(second.getByRole('button', { name: 'Redo this one' }))
    await user.type(second.getByLabelText('Note for this point'), 'sharper')
    await user.click(second.getByRole('button', { name: 'Redo' }))

    expect(redoTalkingPoint).toHaveBeenCalledWith(PROJECT, '01HQ0000000000000000000P02', 'sharper')
  })

  it('Remove sends the point id', async () => {
    const user = userEvent.setup()
    render(<TalkingPointsScreen projectId={PROJECT} model={model()} />)

    await user.click(
      within(screen.getAllByRole('article')[2]!).getByRole('button', { name: 'Remove' }),
    )

    expect(removeTalkingPoint).toHaveBeenCalledWith(PROJECT, '01HQ0000000000000000000P03')
  })

  it('says why in words when an action is refused', async () => {
    const user = userEvent.setup()
    approveTalkingPoints.mockResolvedValue({
      ok: false,
      error: 'A newer set of talking points exists. Review it before approving.',
    })
    render(<TalkingPointsScreen projectId={PROJECT} model={model()} />)

    await user.click(screen.getByRole('button', { name: 'Approve talking points' }))

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'A newer set of talking points exists. Review it before approving.',
      }),
    )
  })

  it('locks every button and says so while the points are being redone', () => {
    render(<TalkingPointsScreen projectId={PROJECT} model={model({ busy: true })} />)

    expect(screen.getByText('Redoing the talking points…')).toBeTruthy()
    for (const button of screen.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }
    expect((screen.getByLabelText('Suggest changes') as HTMLTextAreaElement).disabled).toBe(true)
  })

  it('with no proposal yet, says it is being worked out and offers nothing to approve', () => {
    render(
      <TalkingPointsScreen
        projectId={PROJECT}
        model={model({ version: 0, points: [], history: [], estimateUsd: 0, busy: true })}
      />,
    )

    expect(screen.getByText('Redoing the talking points…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Approve talking points' })).toBeNull()
  })
})
