import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SlotView, VisualsReviewModel } from '@/lib/visuals-review'
import { VisualBoard } from './visual-board'
import type { BrandChartColors } from './slot-previews'

const chooseCandidateAction = vi.fn()
const editBriefAction = vi.fn()
const refetchSlotAction = vi.fn()
const createOwnUploadAction = vi.fn()
const finaliseOwnUploadAction = vi.fn()
const addSlotImageFromUrlAction = vi.fn()
const approvePlanAction = vi.fn()
const retypeSlotAction = vi.fn()
const retypeToHeadlineAction = vi.fn()
const dismissRetypeAction = vi.fn()
const saveDirectionAction = vi.fn()
const redraftDirectionAction = vi.fn()
const replanShotsAction = vi.fn()
const redirectSceneAction = vi.fn()
const saveHeadlineAction = vi.fn()
const refetchArticleAction = vi.fn()

vi.mock('./visuals-actions', () => ({
  chooseCandidateAction: (...args: unknown[]) => chooseCandidateAction(...args),
  editBriefAction: (...args: unknown[]) => editBriefAction(...args),
  refetchSlotAction: (...args: unknown[]) => refetchSlotAction(...args),
  createOwnUploadAction: (...args: unknown[]) => createOwnUploadAction(...args),
  finaliseOwnUploadAction: (...args: unknown[]) => finaliseOwnUploadAction(...args),
  addSlotImageFromUrlAction: (...args: unknown[]) => addSlotImageFromUrlAction(...args),
  approvePlanAction: (...args: unknown[]) => approvePlanAction(...args),
  retypeSlotAction: (...args: unknown[]) => retypeSlotAction(...args),
  retypeToHeadlineAction: (...args: unknown[]) => retypeToHeadlineAction(...args),
  dismissRetypeAction: (...args: unknown[]) => dismissRetypeAction(...args),
  saveDirectionAction: (...args: unknown[]) => saveDirectionAction(...args),
  redraftDirectionAction: (...args: unknown[]) => redraftDirectionAction(...args),
  replanShotsAction: (...args: unknown[]) => replanShotsAction(...args),
  redirectSceneAction: (...args: unknown[]) => redirectSceneAction(...args),
  saveHeadlineAction: (...args: unknown[]) => saveHeadlineAction(...args),
  refetchArticleAction: (...args: unknown[]) => refetchArticleAction(...args),
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
  approvePlanAction.mockResolvedValue({ ok: true })
  retypeSlotAction.mockResolvedValue({ ok: true })
  retypeToHeadlineAction.mockResolvedValue({ ok: true })
  dismissRetypeAction.mockResolvedValue({ ok: true })
  saveHeadlineAction.mockResolvedValue({ ok: true })
  refetchArticleAction.mockResolvedValue({ ok: true })
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
      // A stock photo never has one; set here so the audit line test covers
      // the cast reference wording (decision 253) without a second fixture.
      references: ['Emad Mostaque'],
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
  needsFetch: false,
  retype: null,
  refusal: null,
  article: null,
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
  needsFetch: false,
  retype: null,
  refusal: null,
  article: null,
}

const SLOT_D = '01J000000000000000000000AD'

/** Invented outlet and byline: a fixture must never carry a real one. */
const headlineSlot: SlotView = {
  id: SLOT_D,
  type: 'headline',
  status: 'resolved',
  chapterIndex: 0,
  chapterTitle: 'The audit',
  startMs: 20000,
  durationMs: 7000,
  brief: {
    type: 'headline',
    coversText: 'The morning the story broke.',
    description: 'The clipping that started it.',
    motion: { kind: 'static' },
    transition: 'cut',
    sourceClaimId: CLAIM,
    emphasis: '$1.9 billion',
  },
  briefError: undefined,
  candidates: [],
  extraCandidates: 0,
  needsFetch: false,
  retype: null,
  refusal: null,
  article: {
    url: 'https://financialrecord.example/2023/03/14/auditors',
    outlet: 'The Financial Record',
    headline: 'Auditors cannot find the $1.9 billion the company says it holds',
    author: 'Elena Marsh',
    publishedAt: '2023-03-14',
    description: 'Three banks say they never held the escrow accounts.',
    provenance: { headline: 'jsonld', outlet: 'og', author: 'meta', publishedAt: 'domain' },
    status: 'fetched',
    failureReason: null,
  },
}

/**
 * The claims a headline card may quote (decision 257). Two, so the chooser has
 * to be a list rather than a confirmation.
 */
const ARTICLE_CLAIMS = [
  { id: CLAIM, text: 'The escrow accounts never existed.', label: 'The Financial Record' },
  {
    id: '01HQ00000000000000000000AB',
    text: 'Three banks denied holding the money.',
    label: 'ledgerwire.example/2023/03/…',
  },
]

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
  needsFetch: true,
  retype: null,
  refusal: null,
  article: null,
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
    phase: 'board',
    toFetch: slots.filter((slot) => slot.needsFetch).length,
    stillsToFetch: slots.filter((slot) => slot.needsFetch && slot.type === 'still').length,
    fetchEstimateUsd: 0,
    direction: null,
    warnings: [],
    articleClaims: ARTICLE_CLAIMS,
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
    // The cast member whose photo conditioned the frame (decision 253).
    expect(screen.getAllByText(/reference: Emad Mostaque/).length).toBeGreaterThan(0)
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

  it('treats a real-footage slot as upload-only (decision 214)', () => {
    const archivalSlot: SlotView = {
      ...stockSlot,
      id: SLOT_B,
      type: 'archival',
      status: 'placeholder',
      candidates: [],
      extraCandidates: 0,
      brief: {
        type: 'archival',
        coversText: 'Founded in 1919 as a Wolverhampton builder.',
        description: 'The original headquarters.',
        motion: { kind: 'static' },
        transition: 'cut',
        query: 'Carillion headquarters photograph',
        mustShow: 'the Wolverhampton building',
      },
    }
    render(<VisualBoard projectId={PROJECT} model={model([archivalSlot])} colors={COLORS} />)

    // The badge (and the filmstrip) say what the type IS, not the wire id.
    expect(screen.getAllByText('real footage').length).toBeGreaterThan(0)
    // The placeholder reads as "yours to source", not as a fetch failure.
    expect(screen.getByText(/Real footage is yours to source/)).toBeInTheDocument()
    expect(screen.queryByText(/Nothing usable was found/)).not.toBeInTheDocument()
    // Nothing to fetch: no Regenerate, and the upload takes video too.
    expect(screen.queryByRole('button', { name: /Regenerate/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload footage' })).toBeInTheDocument()
    expect(
      screen.getByLabelText(/Upload your real footage for this slot — image or video/),
    ).toHaveAttribute('accept', expect.stringContaining('video/mp4'))
    // Real footage is usually found online, so an address is as good as a file.
    expect(
      screen.getByLabelText('Add your real footage for this slot by image address'),
    ).toBeInTheDocument()
  })

  it('takes real footage by web address, and only once there is an address', async () => {
    const archivalSlot: SlotView = {
      ...stockSlot,
      id: SLOT_B,
      type: 'archival',
      status: 'placeholder',
      candidates: [],
      extraCandidates: 0,
      brief: {
        type: 'archival',
        coversText: 'Founded in 1919 as a Wolverhampton builder.',
        description: 'The original headquarters.',
        motion: { kind: 'static' },
        transition: 'cut',
        query: 'Carillion headquarters photograph',
        mustShow: 'the Wolverhampton building',
      },
    }
    addSlotImageFromUrlAction.mockResolvedValue({ ok: true })
    render(<VisualBoard projectId={PROJECT} model={model([archivalSlot])} colors={COLORS} />)

    const add = screen.getByRole('button', { name: 'Add from address' })
    expect(add).toBeDisabled()

    const field = screen.getByLabelText('Add your real footage for this slot by image address')
    await userEvent.type(field, 'https://example.com/hq.jpg')
    await userEvent.click(add)

    expect(addSlotImageFromUrlAction).toHaveBeenCalledWith({
      projectId: PROJECT,
      slotId: SLOT_B,
      url: 'https://example.com/hq.jpg',
    })
    await waitFor(() => expect(field).toHaveValue(''))
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

    await userEvent.click(screen.getByRole('button', { name: /Regenerate · ≈\$0.08/ }))
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

  it('enlarges the chosen candidate from the Preview button, at full size', async () => {
    render(<VisualBoard projectId={PROJECT} model={model([stockSlot])} colors={COLORS} />)

    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))

    const dialog = screen.getByRole('dialog')
    // The full-size source, not the thumbnail — enlarging the thumb would be
    // zooming a 168px jpeg.
    expect(within(dialog).getByRole('img')).toHaveAttribute(
      'src',
      'https://images.pexels.com/a1.jpg',
    )
    expect(within(dialog).getByText(/candidate 1 of 2/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Selected for this slot' })).toBeDisabled()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('steps to the next candidate, plays video there, and can select it', async () => {
    render(<VisualBoard projectId={PROJECT} model={model([stockSlot])} colors={COLORS} />)

    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Previous' })).toBeDisabled()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Next' }))

    // The video candidate gets a real <video>, which the 168px strip cannot.
    const video = within(dialog).getByLabelText('b2')
    expect(video.tagName).toBe('VIDEO')
    expect(video).toHaveAttribute('src', 'https://cdn.pixabay.com/b2.mp4')
    expect(within(dialog).getByRole('button', { name: 'Next' })).toBeDisabled()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Use this candidate' }))
    expect(chooseCandidateAction).toHaveBeenCalledWith(PROJECT, SLOT_A, 'b2')
  })
})

describe('the plan phase (staged-visuals design)', () => {
  const plannedStock: SlotView = {
    ...stockSlot,
    status: 'unresolved',
    candidates: [],
    extraCandidates: 0,
    needsFetch: true,
  }
  const plannedStill: SlotView = {
    ...stockSlot,
    id: SLOT_B,
    type: 'still',
    status: 'unresolved',
    candidates: [],
    extraCandidates: 0,
    needsFetch: true,
    brief: {
      type: 'still',
      coversText: 'By June, the auditors could not find the money.',
      description: 'Deserted open-plan office at dusk.',
      motion: { kind: 'static' },
      transition: 'cut',
      prompt: 'Deserted office at dusk, painterly.',
    },
  }

  function planModel() {
    return model([plannedStock, plannedStill], {
      phase: 'plan',
      toFetch: 2,
      stillsToFetch: 1,
      fetchEstimateUsd: 0.08,
    })
  }

  it('offers one Fetch visuals button carrying the count and the price, behind a confirm', async () => {
    render(<VisualBoard projectId={PROJECT} model={planModel()} colors={COLORS} />)

    // Nothing is "being fetched" during plan review — the chip says planned.
    expect(screen.getAllByText('planned')).toHaveLength(2)
    expect(screen.queryByText(/Being fetched/)).not.toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('button', { name: /Fetch visuals · 2 slots · est\. \$0\.08/ }),
    )
    expect(approvePlanAction).not.toHaveBeenCalled()
    expect(screen.getByText(/generates 1 AI image at est\. \$0\.08/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^Fetch now$/ }))
    expect(approvePlanAction).toHaveBeenCalledWith(PROJECT)
  })

  it('offers the re-plan beside the fetch, naming the slots it discards', async () => {
    render(<VisualBoard projectId={PROJECT} model={planModel()} colors={COLORS} />)

    // Both spends sit in one row: fetch this plan, or plan again.
    expect(screen.getByRole('button', { name: /Fetch visuals/ })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: /Re-plan shot list · ≈\$0\.15/ }))
    expect(replanShotsAction).not.toHaveBeenCalled()
    expect(screen.getByText(/planned again from the saved direction/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^Re-plan now$/ }))
    expect(replanShotsAction).toHaveBeenCalledWith(PROJECT)
  })

  it('re-types a slot through the format picker — the suggestion is not a lock', async () => {
    render(<VisualBoard projectId={PROJECT} model={planModel()} colors={COLORS} />)

    const pickers = screen.getAllByRole('group', { name: 'Slot format' })
    const first = pickers[0]!
    // The current type is pressed and disabled; the others are one click.
    expect(within(first).getByRole('button', { name: 'stock' })).toBeDisabled()
    // The picker speaks the decision-214 names, never the wire ids.
    expect(within(first).getByRole('button', { name: 'real footage' })).toBeInTheDocument()
    expect(within(first).getByRole('button', { name: 'AI image' })).toBeInTheDocument()
    expect(within(first).queryByRole('button', { name: 'archival' })).not.toBeInTheDocument()
    expect(within(first).queryByRole('button', { name: 'still' })).not.toBeInTheDocument()
    await userEvent.click(within(first).getByRole('button', { name: 'map' }))
    expect(retypeSlotAction).toHaveBeenCalledWith(PROJECT, SLOT_A, 'map')
  })

  it('asks which article a headline would quote, and never guesses one', async () => {
    render(<VisualBoard projectId={PROJECT} model={model([stockSlot])} colors={COLORS} />)

    const picker = screen.getByRole('group', { name: 'Slot format' })
    const button = within(picker).getByRole('button', { name: 'news headline' })

    // The format is not re-typed by pressing it: the card cannot know which
    // article, and no model may choose one (decision 257).
    await userEvent.click(button)
    expect(retypeSlotAction).not.toHaveBeenCalled()
    expect(button).toHaveAttribute('aria-expanded', 'true')

    const chooser = screen.getByRole('group', { name: 'Which article this card quotes' })
    expect(within(chooser).getByText(/The escrow accounts never existed/)).toBeInTheDocument()
    expect(within(chooser).getByText('The Financial Record')).toBeInTheDocument()

    await userEvent.click(within(chooser).getAllByRole('button', { name: 'Quote this' })[0]!)
    expect(retypeToHeadlineAction).toHaveBeenCalledWith(PROJECT, SLOT_A, CLAIM)
    // It took, so the chooser closes on its own.
    await waitFor(() =>
      expect(
        screen.queryByRole('group', { name: 'Which article this card quotes' }),
      ).not.toBeInTheDocument(),
    )
  })

  it('says so when the dossier carries no news claim, instead of offering nothing', async () => {
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([stockSlot], { articleClaims: [] })}
        colors={COLORS}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'news headline' }))
    const chooser = screen.getByRole('group', { name: 'Which article this card quotes' })
    expect(chooser).toHaveTextContent(/no claim in this project’s dossier has one behind it/)
    expect(within(chooser).queryByRole('button', { name: 'Quote this' })).not.toBeInTheDocument()
    expect(retypeToHeadlineAction).not.toHaveBeenCalled()
  })

  it('keeps the chooser open when the save is refused, so the pick is not lost', async () => {
    retypeToHeadlineAction.mockResolvedValue({ ok: false, error: 'That claim has no article.' })
    render(<VisualBoard projectId={PROJECT} model={model([stockSlot])} colors={COLORS} />)

    await userEvent.click(screen.getByRole('button', { name: 'news headline' }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Quote this' })[0]!)

    expect(
      screen.getByRole('group', { name: 'Which article this card quotes' }),
    ).toBeInTheDocument()
  })

  it('edits just save during plan review, and the per-slot fetch is offered', async () => {
    render(<VisualBoard projectId={PROJECT} model={planModel()} colors={COLORS} />)

    // The board-phase wording promises a re-fetch; the plan must not.
    expect(screen.queryByRole('button', { name: /Edit brief & re-fetch/ })).not.toBeInTheDocument()
    const editButtons = screen.getAllByRole('button', { name: 'Edit brief' })
    await userEvent.click(editButtons[0]!)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(editBriefAction).toHaveBeenCalled()
    expect(refetchSlotAction).not.toHaveBeenCalled()

    // A single risky slot can be tried before committing to the lot.
    await userEvent.click(screen.getByRole('button', { name: /Fetch this slot · ≈\$0\.08/ }))
    expect(refetchSlotAction).toHaveBeenCalledWith(PROJECT, SLOT_B, 'Fetched early from the plan')
  })

  it('keeps the picker on the board phase too, with the re-fetch wording back', () => {
    render(<VisualBoard projectId={PROJECT} model={model([stockSlot])} colors={COLORS} />)
    expect(screen.getByRole('group', { name: 'Slot format' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit brief & re-fetch' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Fetch visuals/ })).not.toBeInTheDocument()
  })

  it('says the model is drafting a chart, and holds the picker until it lands', () => {
    const drafting: SlotView = { ...plannedStock, retype: { state: 'drafting', target: 'chart' } }
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([drafting], { phase: 'plan', toFetch: 1, stillsToFetch: 0 })}
        colors={COLORS}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent(/drafting the chart series and claim refs/)
    // And it is the CHART sentence, not the else branch of a two-way ternary.
    expect(screen.getByRole('status')).not.toHaveTextContent(/map locations/)
    // Every format button waits — a second re-type racing the draft would
    // write over whichever finished last.
    const picker = screen.getByRole('group', { name: 'Slot format' })
    for (const button of within(picker).getAllByRole('button')) {
      expect(button).toBeDisabled()
    }
  })

  it('names the format it is drafting, whatever the format is', () => {
    // The bug this replaces (2026-09-18): a two-way ternary made every target
    // that was not a chart announce "map locations", so a headline re-type
    // said the wrong thing on the way to failing.
    const plan = { phase: 'plan', toFetch: 1, stillsToFetch: 0 } as const
    const drafting: SlotView = { ...plannedStock, retype: { state: 'drafting', target: 'map' } }
    const { rerender } = render(
      <VisualBoard projectId={PROJECT} model={model([drafting], plan)} colors={COLORS} />,
    )
    expect(screen.getByRole('status')).toHaveTextContent(/drafting the map locations/)

    const stale: SlotView = { ...plannedStock, retype: { state: 'drafting', target: 'headline' } }
    rerender(<VisualBoard projectId={PROJECT} model={model([stale], plan)} colors={COLORS} />)
    expect(screen.getByRole('status')).toHaveTextContent(/drafting the news headline brief/)
    expect(screen.getByRole('status')).not.toHaveTextContent(/map locations/)
  })

  it('shows a refusal with the model’s reason, dismissable, keeping the old brief', async () => {
    const refused: SlotView = {
      ...plannedStock,
      retype: {
        state: 'refused',
        target: 'chart',
        reason: 'The claims contain no usable numbers.',
      },
    }
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([refused], { phase: 'plan', toFetch: 1, stillsToFetch: 0 })}
        colors={COLORS}
      />,
    )

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Could not re-type to chart')
    expect(alert).toHaveTextContent('The claims contain no usable numbers.')
    // The slot still offers its old format's actions — nothing was lost.
    expect(screen.getByRole('group', { name: 'Slot format' })).toBeInTheDocument()

    await userEvent.click(within(alert).getByRole('button', { name: 'Dismiss' }))
    expect(dismissRetypeAction).toHaveBeenCalledWith(PROJECT, SLOT_A)
  })
})

describe('a refused still (decision 252)', () => {
  const refused: SlotView = {
    ...stockSlot,
    id: SLOT_C,
    type: 'still',
    status: 'placeholder',
    candidates: [],
    extraCandidates: 0,
    needsFetch: true,
    brief: {
      type: 'still',
      coversText: 'Braun took the stage.',
      description: 'The chief executive at the results presentation.',
      motion: { kind: 'static' },
      transition: 'cut',
      prompt: 'Markus Braun at a podium.',
      depicts: ['Markus Braun'],
    },
    refusal: { reason: 'google: blocked the prompt (SAFETY)', at: '2026-09-14T00:00:00.000Z' },
  }

  it('offers Redirect the scene and Upload a real image, with the depiction brief', async () => {
    redirectSceneAction.mockResolvedValue({ ok: true })
    render(<VisualBoard projectId={PROJECT} model={model([refused])} colors={COLORS} />)

    const card = screen.getByRole('group', { name: 'Refused by the image model' })
    expect(within(card).getByText(/declined this person: google: blocked/)).toBeInTheDocument()
    expect(within(card).getByText(/Showing Markus Braun\./)).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: /Upload/ })).toBeInTheDocument()
    // The generic "nothing usable" line yields to the refusal.
    expect(screen.queryByText(/Nothing usable was found/)).toBeNull()

    await userEvent.click(within(card).getByRole('button', { name: /Redirect the scene/ }))
    expect(redirectSceneAction).toHaveBeenCalledWith(PROJECT, SLOT_C)
  })
})

describe('the headline card (decision 257)', () => {
  it('shows what the article said, and where each field came from', () => {
    render(<VisualBoard projectId={PROJECT} model={model([headlineSlot])} colors={COLORS} />)

    const card = screen.getByLabelText('Headline card preview')
    expect(within(card).getByText('The Financial Record')).toBeTruthy()
    expect(within(card).getByText('2023-03-14')).toBeTruthy()
    expect(within(card).getByText('By Elena Marsh')).toBeTruthy()
    // The marker splits the headline, so it is rendered in pieces.
    expect(within(card).getByText('$1.9 billion')).toBeTruthy()

    const provenance = screen.getByLabelText('Where each field came from')
    expect(within(provenance).getByText(/headline . from the article/)).toBeTruthy()
    // A guess must read as a guess.
    expect(within(provenance).getByText(/date . guessed from the domain/)).toBeTruthy()
  })

  it('asks for the fields when the publisher would not say', () => {
    const unread: SlotView = {
      ...headlineSlot,
      status: 'placeholder',
      article: {
        url: headlineSlot.article?.url ?? '',
        outlet: null,
        headline: null,
        author: null,
        publishedAt: null,
        description: null,
        provenance: {},
        status: 'failed',
        failureReason: 'The publisher returned 403',
      },
    }
    render(<VisualBoard projectId={PROJECT} model={model([unread])} colors={COLORS} />)

    expect(screen.getByText(/The publisher returned 403/)).toBeTruthy()
    expect(screen.getByText(/Open it and fill these in/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Fill these in' })).toBeTruthy()
  })

  it('saves a correction, the marker phrase and the standfirst together', async () => {
    const user = userEvent.setup()
    render(<VisualBoard projectId={PROJECT} model={model([headlineSlot])} colors={COLORS} />)

    await user.click(screen.getByRole('button', { name: 'Correct the details' }))
    const byline = screen.getByLabelText('Byline')
    await user.clear(byline)
    await user.type(byline, 'Tom Vieira')
    await user.click(screen.getByLabelText('Show the standfirst on the card'))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(saveHeadlineAction).toHaveBeenCalled())
    const [, slotId, input] = saveHeadlineAction.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ]
    expect(slotId).toBe(SLOT_D)
    expect(input).toMatchObject({
      author: 'Tom Vieira',
      headline: 'Auditors cannot find the $1.9 billion the company says it holds',
      emphasis: '$1.9 billion',
      showDeck: true,
    })
  })

  it('re-reads the article on request', async () => {
    const user = userEvent.setup()
    render(<VisualBoard projectId={PROJECT} model={model([headlineSlot])} colors={COLORS} />)

    await user.click(screen.getByRole('button', { name: 'Re-fetch' }))
    await waitFor(() => expect(refetchArticleAction).toHaveBeenCalledWith(PROJECT, SLOT_D))
  })
})
