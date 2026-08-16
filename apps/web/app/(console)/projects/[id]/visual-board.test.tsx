import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SlotView, VisualsReviewModel } from '@/lib/visuals-review'
import { VisualBoard } from './visual-board'
import type { BrandChartColors } from './slot-previews'

const chooseCandidateAction = vi.fn()
const editBriefAction = vi.fn()
const refetchSlotAction = vi.fn()
const uploadOwnAction = vi.fn()

vi.mock('./visuals-actions', () => ({
  chooseCandidateAction: (...args: unknown[]) => chooseCandidateAction(...args),
  editBriefAction: (...args: unknown[]) => editBriefAction(...args),
  refetchSlotAction: (...args: unknown[]) => refetchSlotAction(...args),
  uploadOwnAction: (...args: unknown[]) => uploadOwnAction(...args),
}))

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

beforeEach(() => {
  vi.clearAllMocks()
  chooseCandidateAction.mockResolvedValue({ ok: true })
  refetchSlotAction.mockResolvedValue({ ok: true })
  editBriefAction.mockResolvedValue({ ok: true })
})

const COLORS: BrandChartColors = {
  accent: '#6366f1',
  surface: '#18181b',
  textPrimary: '#fafafa',
  textSecondary: '#a1a1aa',
  chartSeries: ['#6366f1', '#22c55e', '#f59e0b'],
  collapse: '#ef4444',
}

const PROJECT = '01J0000000000000000000000A'
const SLOT_A = '01J000000000000000000000AA'
const SLOT_B = '01J000000000000000000000AB'
const SLOT_C = '01J000000000000000000000AC'
const CLAIM = '01HQ00000000000000000000AA'

const stockSlot: SlotView = {
  id: SLOT_A,
  type: 'stock',
  status: 'resolved',
  chapterIndex: 0,
  chapterTitle: 'The audit',
  startMs: 0,
  durationMs: 8000,
  brief: {
    type: 'stock',
    coversText: 'By June, the auditors could not find the money.',
    description: 'Deserted open-plan office at dusk.',
    motion: { kind: 'static' },
    transition: 'cut',
    query: 'empty office dusk',
    rejectionCriteria: [],
  },
  briefError: undefined,
  candidates: [
    {
      id: 'a1',
      provider: 'pexels',
      kind: 'image',
      sourceUrl: 'https://images.pexels.com/a1.jpg',
      thumbUrl: 'data:image/svg+xml;base64,PHN2Zy8+',
      licence: 'Pexels License',
      attributionText: 'Photo by Christina Morillo on Pexels',
      score: 90,
      chosen: true,
    },
    {
      id: 'b2',
      provider: 'pixabay',
      kind: 'video',
      sourceUrl: 'https://cdn.pixabay.com/b2.mp4',
      thumbUrl: 'data:image/svg+xml;base64,PHN2Zy8+',
      licence: 'Pixabay Content License',
      score: 60,
    },
  ],
  extraCandidates: 3,
}

const chartSlot: SlotView = {
  id: SLOT_B,
  type: 'chart',
  status: 'resolved',
  chapterIndex: 0,
  chapterTitle: 'The audit',
  startMs: 8000,
  durationMs: 6000,
  brief: {
    type: 'chart',
    coversText: 'The shares collapsed in nine days.',
    description: 'The collapse, drawn on.',
    motion: { kind: 'static' },
    transition: 'cut',
    chartKind: 'line',
    series: [
      {
        label: 'Share price',
        unit: 'EUR',
        points: [
          { x: '2020-06-17', y: 104.5 },
          { x: '2020-06-26', y: 1.28 },
        ],
      },
    ],
    dataRefs: [CLAIM],
    takeaway: 'From €104 to €1.28 in nine days.',
    reveal: 'draw-on',
  },
  briefError: undefined,
  candidates: [],
  extraCandidates: 0,
}

const brokenSlot: SlotView = {
  id: SLOT_C,
  type: 'chart',
  status: 'placeholder',
  chapterIndex: 1,
  chapterTitle: 'The collapse',
  startMs: 14000,
  durationMs: 4000,
  brief: null,
  briefError: 'This brief no longer matches its schema and cannot be rendered or re-fetched as is.',
  candidates: [],
  extraCandidates: 0,
}

function model(slots: SlotView[], overrides: Partial<VisualsReviewModel> = {}): VisualsReviewModel {
  const chapters: VisualsReviewModel['chapters'] = []
  for (const slot of slots) {
    const group = chapters.find((chapter) => chapter.chapterIndex === slot.chapterIndex)
    if (group) group.slots.push(slot)
    else
      chapters.push({
        chapterIndex: slot.chapterIndex,
        chapterTitle: slot.chapterTitle,
        slots: [slot],
      })
  }
  return {
    chapters,
    coverage: {
      slots: slots.length,
      resolved: slots.filter((slot) => slot.status === 'resolved').length,
      placeholder: slots.filter((slot) => slot.status === 'placeholder').length,
      unresolved: slots.filter((slot) => slot.status === 'unresolved').length,
    },
    blockedReason: undefined,
    placeholders: slots.filter((slot) => slot.status === 'placeholder').length,
    segments: [{ takeId: null, startMs: 0, durationMs: 18000 }],
    totalMs: 18000,
    ...overrides,
  }
}

describe('VisualBoard', () => {
  it('groups slots by chapter with type badges and the covered sentence', () => {
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([stockSlot, chartSlot, brokenSlot])}
        colors={COLORS}
      />,
    )

    expect(screen.getByText('Chapter 1 — The audit')).toBeInTheDocument()
    expect(screen.getByText('Chapter 2 — The collapse')).toBeInTheDocument()
    expect(
      screen.getByText(/“By June, the auditors could not find the money.”/),
    ).toBeInTheDocument()
  })

  it('marks the chosen candidate and swaps on click', async () => {
    render(<VisualBoard projectId={PROJECT} model={model([stockSlot])} colors={COLORS} />)

    expect(screen.getByText('Selected')).toBeInTheDocument()
    expect(screen.getByText('+3 more fetched')).toBeInTheDocument()

    const strip = screen.getByRole('list', { name: 'Candidates' })
    const alternatives = within(strip).getAllByRole('listitem')
    await userEvent.click(alternatives[1]!)

    expect(chooseCandidateAction).toHaveBeenCalledWith(PROJECT, SLOT_A, 'b2')
  })

  it('shows the chosen candidate’s licence and attribution — the audit line', () => {
    render(<VisualBoard projectId={PROJECT} model={model([stockSlot])} colors={COLORS} />)
    expect(screen.getByText(/Pexels License · Photo by Christina Morillo/)).toBeInTheDocument()
  })

  it('renders a chart with its takeaway and source-claim chips', () => {
    render(<VisualBoard projectId={PROJECT} model={model([chartSlot])} colors={COLORS} />)

    expect(screen.getByRole('img', { name: /line chart/ })).toBeInTheDocument()
    expect(screen.getByText('From €104 to €1.28 in nine days.')).toBeInTheDocument()
    expect(screen.getByTitle(CLAIM)).toHaveTextContent('claim 1')
  })

  it('renders an error card, never a chart, when the brief is broken', () => {
    render(<VisualBoard projectId={PROJECT} model={model([brokenSlot])} colors={COLORS} />)

    expect(screen.getByRole('alert')).toHaveTextContent('This chart cannot be rendered')
    expect(screen.queryByRole('img', { name: /chart/ })).not.toBeInTheDocument()
  })

  it('re-fetches from the Regenerate button, naming the cost on stills', async () => {
    const still: SlotView = {
      ...stockSlot,
      id: SLOT_B,
      type: 'still',
      brief: {
        type: 'still',
        coversText: 'The trading floor.',
        description: 'CRT monitors.',
        motion: { kind: 'static' },
        transition: 'cut',
        prompt: '1995 trading floor',
      },
      candidates: [],
      extraCandidates: 0,
    }
    render(<VisualBoard projectId={PROJECT} model={model([still])} colors={COLORS} />)

    await userEvent.click(screen.getByRole('button', { name: /Regenerate · ≈\$0.06/ }))
    expect(refetchSlotAction).toHaveBeenCalledWith(PROJECT, SLOT_B, 'Regenerate')
  })

  it('edits the brief through the inline form and hands it to the re-fetch', async () => {
    render(<VisualBoard projectId={PROJECT} model={model([stockSlot])} colors={COLORS} />)

    await userEvent.click(screen.getByRole('button', { name: 'Edit brief & re-fetch' }))
    const query = screen.getByLabelText('Search query')
    await userEvent.clear(query)
    await userEvent.type(query, 'abandoned trading floor')
    await userEvent.click(screen.getByRole('button', { name: /Save & re-fetch/ }))

    expect(editBriefAction).toHaveBeenCalledWith(
      PROJECT,
      SLOT_A,
      expect.objectContaining({ query: 'abandoned trading floor' }),
    )
  })

  it('says a placeholder slot needs a human, in the explicit-approval wording', () => {
    const placeholder: SlotView = { ...stockSlot, status: 'placeholder', candidates: [] }
    render(<VisualBoard projectId={PROJECT} model={model([placeholder])} colors={COLORS} />)

    expect(screen.getByText(/Nothing usable was found/)).toBeInTheDocument()
    expect(screen.getByText(/must say so explicitly/)).toBeInTheDocument()
  })

  it('says when there is no narration audio to scrub, rather than a dead Play', () => {
    render(<VisualBoard projectId={PROJECT} model={model([stockSlot])} colors={COLORS} />)

    expect(screen.getByRole('button', { name: 'Play narration' })).toBeDisabled()
    expect(screen.getByText(/No narration audio to scrub/)).toBeInTheDocument()
  })

  it('offers a filmstrip jump per slot', () => {
    render(
      <VisualBoard projectId={PROJECT} model={model([stockSlot, chartSlot])} colors={COLORS} />,
    )

    const filmstrip = screen.getByRole('list', { name: 'Filmstrip' })
    expect(within(filmstrip).getAllByRole('listitem')).toHaveLength(2)
  })
})
