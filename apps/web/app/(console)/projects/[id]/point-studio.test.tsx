import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PointStudioModel } from '@/lib/point-studio-model'
import type { ShortCardModel } from '@/lib/shorts-review'
import { PointStudio } from './point-studio'

/**
 * The point Short studio (design 6): every action a visible, labelled button;
 * Script as five phase blocks against the 45 to 60 s window; Shots as a list
 * of rows with Swap, crop and motion; Re-plan with a note; Findings; Assemble
 * and render; and the earlier-script notice with its Rebuild button.
 */

// project-controls (for useAction) drags '../actions' in, and with it
// next-auth, which cannot load under jsdom.
vi.mock('../actions', () => ({
  approveGate: vi.fn(),
  stopProject: vi.fn(),
  restartStage: vi.fn(),
}))

const actions = vi.hoisted(() => ({
  savePointScript: vi.fn(),
  revoicePoint: vi.fn(),
  replanPoint: vi.fn(),
  savePointShot: vi.fn(),
  fetchPointShotOptions: vi.fn(),
  generatePointStill: vi.fn(),
  assemblePoint: vi.fn(),
  rebuildPointFromScript: vi.fn(),
}))
vi.mock('./point-studio-actions', () => ({
  savePointScript: (...args: unknown[]) => actions.savePointScript(...args),
  revoicePoint: (...args: unknown[]) => actions.revoicePoint(...args),
  replanPoint: (...args: unknown[]) => actions.replanPoint(...args),
  savePointShot: (...args: unknown[]) => actions.savePointShot(...args),
  fetchPointShotOptions: (...args: unknown[]) => actions.fetchPointShotOptions(...args),
  generatePointStill: (...args: unknown[]) => actions.generatePointStill(...args),
  assemblePoint: (...args: unknown[]) => actions.assemblePoint(...args),
  rebuildPointFromScript: (...args: unknown[]) => actions.rebuildPointFromScript(...args),
}))

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

const SHORT_ID = '01HQ00000000000000000000S1'

function slot(r2Key: string) {
  return {
    type: 'still' as const,
    startMs: 0,
    durationMs: 5000,
    transition: 'cut' as const,
    motion: { kind: 'static' as const },
    payload: { kind: 'image' as const, src: { r2Key } },
  }
}

function studioModel(overrides: Partial<PointStudioModel> = {}): PointStudioModel {
  const paragraph = (text: string, voiced = true) => ({
    text,
    chapterIndex: 0,
    chapterTitle: 'The audit',
    voiced,
  })
  return {
    phases: [
      { phase: 'hook', paragraphs: [paragraph('Nobody checked the one number that mattered.')] },
      { phase: 'stakes', paragraphs: [paragraph('Billions rested on a single signature.')] },
      { phase: 'delivery', paragraphs: [paragraph('The auditors asked, but nobody answered.')] },
      { phase: 'resolution', paragraphs: [paragraph('The cash was never there at all.')] },
      {
        phase: 'bridge',
        paragraphs: [paragraph('The full video walks through how it unravelled.')],
      },
    ],
    words: 148,
    estimatedRuntimeSec: 52,
    shots: [
      {
        index: 0,
        startMs: 0,
        durationMs: 2100,
        thumbUrl: 'https://r2.example.com/shot-0.png',
        type: 'still',
        crop: 'centre',
        motion: 'kenburns-in',
        source: 'long form',
      },
      {
        index: 1,
        startMs: 2100,
        durationMs: 2400,
        thumbUrl: null,
        type: 'headline',
        crop: 'left',
        motion: 'static',
        source: 'new',
      },
    ],
    library: [
      {
        kind: 'image',
        url: 'https://r2.example.com/lib-a.png',
        slot: slot('boom-busters/stills/a.png'),
        selected: false,
      },
      {
        kind: 'image',
        url: 'https://r2.example.com/lib-b.png',
        slot: slot('boom-busters/stills/b.png'),
        selected: false,
      },
    ],
    fetched: [
      {
        id: 'cand-1',
        kind: 'image',
        origin: 'still',
        url: 'https://r2.example.com/fetched-1.png',
        previewKind: 'image',
        slot: slot('boom-busters/fetched/1.png'),
        selected: false,
      },
    ],
    findings: [
      {
        rule: 'pace',
        message: 'Shot 2 runs 3.9 s; the rule book wants 3.5 s at most',
        shotIndex: 1,
      },
      { rule: 'words', message: 'The script is 98 words; the rule book wants 110 to 160' },
    ],
    stillEstimateUsd: 0.08,
    scriptBehind: false,
    planBehind: false,
    pending: null,
    failure: null,
    ...overrides,
  }
}

function card(studio: PointStudioModel | null = studioModel()): ShortCardModel {
  return {
    id: SHORT_ID,
    title: 'Why the auditors missed it',
    description: '',
    ending: 'cta',
    captions: true,
    relatedLinkChecked: false,
    kind: 'point',
    chapterTitle: null,
    fromParagraph: 0,
    toParagraph: 4,
    durationMs: 52_000,
    stale: false,
    estimatedCostUsd: 0.0117,
    render: null,
    teaser: null,
    point: {
      type: 'forensic-breakdown',
      bridgeChapterTitles: ['The audit'],
      findings: studio?.findings.length ?? 0,
      scriptBehind: studio?.scriptBehind ?? false,
    },
    studio,
  }
}

function renderStudio(studio: PointStudioModel | null = studioModel(), live = true) {
  const onClose = vi.fn()
  render(<PointStudio short={card(studio)} live={live} onClose={onClose} />)
  return { onClose }
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const action of Object.values(actions)) action.mockResolvedValue({ ok: true })
})

describe('PointStudio', () => {
  it('renders every labelled button the design names', () => {
    renderStudio()

    expect(screen.getByRole('button', { name: 'Close the studio' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Re-voice' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Re-plan shots' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Assemble and render' })).toBeInTheDocument()
    for (const n of [1, 2]) {
      expect(screen.getByRole('button', { name: `Swap shot ${n}` })).toBeInTheDocument()
      for (const crop of ['Left', 'Centre', 'Right']) {
        expect(screen.getByRole('button', { name: `Shot ${n} crop ${crop}` })).toBeInTheDocument()
      }
      for (const motion of ['Still', 'Push in', 'Pull out', 'Punch']) {
        expect(
          screen.getByRole('button', { name: `Shot ${n} motion ${motion}` }),
        ).toBeInTheDocument()
      }
    }
  })

  it('shows the script as five labelled phase blocks with the words against the window', () => {
    renderStudio()

    for (const label of ['Hook', 'Stakes', 'Delivery', 'Resolution', 'Bridge']) {
      expect(screen.getByRole('group', { name: `${label} phase` })).toBeInTheDocument()
    }
    expect(screen.getByText(/148 words, about 52 s against 45 to 60 s/)).toBeInTheDocument()
    const hook = screen.getByRole('group', { name: 'Hook phase' })
    expect(
      within(hook).getByDisplayValue('Nobody checked the one number that mattered.'),
    ).toBeInTheDocument()
  })

  it('lists each shot with its time, type and source', () => {
    renderStudio()

    const first = screen.getByRole('group', { name: 'Shot 1' })
    expect(within(first).getByText(/0\.0 s for 2\.1 s · still · long form/)).toBeInTheDocument()
    const second = screen.getByRole('group', { name: 'Shot 2' })
    expect(within(second).getByText(/2\.1 s for 2\.4 s · headline · new/)).toBeInTheDocument()
    expect(within(first).getByRole('button', { name: 'Shot 1 crop Centre' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(first).getByRole('button', { name: 'Shot 1 motion Push in' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('lists the rule book findings with the shot they concern', () => {
    renderStudio()

    const findings = screen.getByRole('region', { name: 'Findings' })
    expect(within(findings).getByText(/Shot 2 runs 3\.9 s.*\(shot 2\)/)).toBeInTheDocument()
    expect(within(findings).getByText(/The script is 98 words/)).toBeInTheDocument()
  })

  it('crop and motion buttons keep the picture and send the new crop or motion', async () => {
    const user = userEvent.setup()
    renderStudio()

    await user.click(screen.getByRole('button', { name: 'Shot 1 crop Right' }))
    expect(actions.savePointShot).toHaveBeenLastCalledWith(
      SHORT_ID,
      0,
      null,
      'right',
      'kenburns-in',
    )

    await user.click(screen.getByRole('button', { name: 'Shot 2 motion Punch' }))
    expect(actions.savePointShot).toHaveBeenLastCalledWith(SHORT_ID, 1, null, 'left', 'punch')
  })

  it('Swap opens the library and the fetched pool and swaps by ref or candidate', async () => {
    const user = userEvent.setup()
    renderStudio()

    await user.click(screen.getByRole('button', { name: 'Swap shot 1' }))
    await user.click(screen.getByRole('button', { name: 'Shot 1 library option 2 (image)' }))
    expect(actions.savePointShot).toHaveBeenLastCalledWith(
      SHORT_ID,
      0,
      { ref: 1 },
      'centre',
      'kenburns-in',
    )

    await user.click(
      screen.getByRole('button', { name: 'Shot 1 fetched option cand-1 (still image)' }),
    )
    expect(actions.savePointShot).toHaveBeenLastCalledWith(
      SHORT_ID,
      0,
      { candidateId: 'cand-1' },
      'centre',
      'kenburns-in',
    )
  })

  it('searches stock and generates a still for the open shot, the still behind a confirm', async () => {
    const user = userEvent.setup()
    renderStudio()
    await user.click(screen.getByRole('button', { name: 'Swap shot 2' }))

    await user.type(screen.getByLabelText('Shot 2 stock search'), 'ledger pages')
    await user.click(screen.getByRole('button', { name: 'Fetch stock options (free)' }))
    expect(actions.fetchPointShotOptions).toHaveBeenCalledWith(SHORT_ID, 1, 'ledger pages')

    await user.type(screen.getByLabelText('Shot 2 still prompt'), 'A cracked ledger')
    await user.click(screen.getByRole('button', { name: 'Generate a still · est. $0.08' }))
    expect(actions.generatePointStill).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Generate it' }))
    expect(actions.generatePointStill).toHaveBeenCalledWith(SHORT_ID, 1, 'A cracked ledger')
  })

  it('Re-voice and Re-plan shots each ask first, and Re-plan carries the note', async () => {
    const user = userEvent.setup()
    renderStudio()

    await user.click(screen.getByRole('button', { name: 'Re-voice' }))
    expect(actions.revoicePoint).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Synthesise the paragraphs' }))
    expect(actions.revoicePoint).toHaveBeenCalledWith(SHORT_ID)

    await user.type(screen.getByLabelText('Note for the plan (optional)'), 'more footage')
    await user.click(screen.getByRole('button', { name: 'Re-plan shots' }))
    await user.click(screen.getByRole('button', { name: 'Plan the shots again' }))
    expect(actions.replanPoint).toHaveBeenCalledWith(SHORT_ID, 'more footage')
  })

  it('Assemble and render asks first, then assembles', async () => {
    const user = userEvent.setup()
    renderStudio()

    await user.click(screen.getByRole('button', { name: 'Assemble and render' }))
    expect(actions.assemblePoint).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Cut it and start the render' }))
    expect(actions.assemblePoint).toHaveBeenCalledWith(SHORT_ID)
  })

  it('an edit offers Save the script, sends every paragraph in phase order, and holds the spends', async () => {
    const user = userEvent.setup()
    renderStudio()
    expect(screen.queryByRole('button', { name: 'Save the script' })).not.toBeInTheDocument()

    const stakes = within(screen.getByRole('group', { name: 'Stakes phase' })).getByRole('textbox')
    await user.clear(stakes)
    await user.type(stakes, 'Billions rested on one signature nobody read.')

    expect(screen.getByRole('button', { name: 'Re-voice' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Re-plan shots' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Assemble and render' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Save the script' }))

    expect(actions.savePointScript).toHaveBeenCalledWith(SHORT_ID, [
      { phase: 'hook', text: 'Nobody checked the one number that mattered.', chapterIndex: 0 },
      { phase: 'stakes', text: 'Billions rested on one signature nobody read.', chapterIndex: 0 },
      { phase: 'delivery', text: 'The auditors asked, but nobody answered.', chapterIndex: 0 },
      { phase: 'resolution', text: 'The cash was never there at all.', chapterIndex: 0 },
      {
        phase: 'bridge',
        text: 'The full video walks through how it unravelled.',
        chapterIndex: 0,
      },
    ])
  })

  it('says so in words when the Short was written from an earlier script, and rebuilds on confirm', async () => {
    const user = userEvent.setup()
    renderStudio(studioModel({ scriptBehind: true }))

    expect(screen.getByText('This Short was written from an earlier script.')).toBeInTheDocument()
    // What will happen is said before the owner confirms.
    expect(screen.getByText(/leaves the Shorts screen while it rebuilds/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Rebuild from the new script' }))
    expect(actions.rebuildPointFromScript).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Rebuild it' }))
    expect(actions.rebuildPointFromScript).toHaveBeenCalledWith(SHORT_ID)
  })

  it('offers no rebuild when the Short is current', () => {
    renderStudio()

    expect(
      screen.queryByText('This Short was written from an earlier script.'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Rebuild from the new script' }),
    ).not.toBeInTheDocument()
  })

  it('shows work in flight, holds the buttons, and refreshes until it lands', () => {
    vi.useFakeTimers()
    try {
      renderStudio(studioModel({ pending: 'plan' }))

      expect(screen.getByRole('status')).toHaveTextContent('Re-planning the shots')
      expect(screen.getByRole('button', { name: 'Re-voice' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Assemble and render' })).toBeDisabled()
      vi.advanceTimersByTime(2600)
      expect(refresh).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('says why the last request stopped, and warns when the plan is behind the voice', () => {
    renderStudio(studioModel({ failure: 'the model refused that picture', planBehind: true }))

    expect(
      screen.getByText(/The last request stopped: the model refused that picture/),
    ).toBeInTheDocument()
    expect(screen.getByText(/planned for an earlier voice/)).toBeInTheDocument()
  })

  it('marks mock mode on every spending button', () => {
    renderStudio(studioModel(), false)

    expect(screen.getByRole('button', { name: 'Re-voice (mock)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Re-plan shots (mock)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Assemble and render (mock)' })).toBeInTheDocument()
  })

  it('closes', async () => {
    const user = userEvent.setup()
    const { onClose } = renderStudio()

    await user.click(screen.getByRole('button', { name: 'Close the studio' }))

    expect(onClose).toHaveBeenCalled()
  })
})
