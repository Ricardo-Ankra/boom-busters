import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SOCIAL_TOO_LONG } from '@boom-busters/compositions/social'
import { FAL_MODELS, GEMINI_IMAGE_MODELS, X_POST_MISSING } from '@boom-busters/providers'
import { DEFAULT_SETTINGS } from '@boom-busters/schemas'
import type { SlotView, VisualsReviewModel } from '@/lib/visuals-review'
import { timecode } from '@/lib/visuals-reuse'
import { VisualBoard } from './visual-board'
import type { BrandChartColors } from './slot-previews'

const STILL_OPTIONS = [
  ...GEMINI_IMAGE_MODELS.map((m) => ({ provider: 'google' as const, id: m.id, label: m.label })),
  ...FAL_MODELS.map((m) => ({ provider: 'fal' as const, id: m.id, label: m.label })),
]

const chooseCandidateAction = vi.fn()
const editBriefAction = vi.fn()
const refetchSlotAction = vi.fn()
const createOwnUploadAction = vi.fn()
const finaliseOwnUploadAction = vi.fn()
const addSlotImageFromUrlAction = vi.fn()
const approvePlanAction = vi.fn()
const retypeSlotAction = vi.fn()
const retypeToHeadlineAction = vi.fn()
const rebriefSlotAction = vi.fn()
const dismissRetypeAction = vi.fn()
const saveDirectionAction = vi.fn()
const redraftDirectionAction = vi.fn()
const replanShotsAction = vi.fn()
const repairPlanAction = vi.fn()
const redirectSceneAction = vi.fn()
const saveHeadlineAction = vi.fn()
const setHeadlineArticleAction = vi.fn()
const refetchArticleAction = vi.fn()
const reuseSlotShotAction = vi.fn()
const unlinkSlotReuseAction = vi.fn()
const showSetPhotoAction = vi.fn()
const setSlotRouteAction = vi.fn()
const attachGraphicLogosAction = vi.fn()
const setSocialPostAction = vi.fn()
const saveSocialPostAction = vi.fn()
const saveSocialCardAction = vi.fn()
const refetchSocialPostAction = vi.fn()
const linkCastHandleAction = vi.fn()
const unlinkCastHandleAction = vi.fn()
const removeSocialImageAction = vi.fn()
const retypeToSocialAction = vi.fn()

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
  rebriefSlotAction: (...args: unknown[]) => rebriefSlotAction(...args),
  dismissRetypeAction: (...args: unknown[]) => dismissRetypeAction(...args),
  saveDirectionAction: (...args: unknown[]) => saveDirectionAction(...args),
  redraftDirectionAction: (...args: unknown[]) => redraftDirectionAction(...args),
  replanShotsAction: (...args: unknown[]) => replanShotsAction(...args),
  repairPlanAction: (...args: unknown[]) => repairPlanAction(...args),
  redirectSceneAction: (...args: unknown[]) => redirectSceneAction(...args),
  saveHeadlineAction: (...args: unknown[]) => saveHeadlineAction(...args),
  setHeadlineArticleAction: (...args: unknown[]) => setHeadlineArticleAction(...args),
  refetchArticleAction: (...args: unknown[]) => refetchArticleAction(...args),
  reuseSlotShotAction: (...args: unknown[]) => reuseSlotShotAction(...args),
  unlinkSlotReuseAction: (...args: unknown[]) => unlinkSlotReuseAction(...args),
  showSetPhotoAction: (...args: unknown[]) => showSetPhotoAction(...args),
  setSlotRouteAction: (...args: unknown[]) => setSlotRouteAction(...args),
  attachGraphicLogosAction: (...args: unknown[]) => attachGraphicLogosAction(...args),
  setSocialPostAction: (...args: unknown[]) => setSocialPostAction(...args),
  saveSocialPostAction: (...args: unknown[]) => saveSocialPostAction(...args),
  saveSocialCardAction: (...args: unknown[]) => saveSocialCardAction(...args),
  refetchSocialPostAction: (...args: unknown[]) => refetchSocialPostAction(...args),
  linkCastHandleAction: (...args: unknown[]) => linkCastHandleAction(...args),
  unlinkCastHandleAction: (...args: unknown[]) => unlinkCastHandleAction(...args),
  removeSocialImageAction: (...args: unknown[]) => removeSocialImageAction(...args),
  retypeToSocialAction: (...args: unknown[]) => retypeToSocialAction(...args),
}))

/** The shared card is the compositions suite's to test; here it only has to be handed its payload. */
vi.mock('./social-preview', () => ({
  SocialPreview: ({ payload }: { payload: { text: string } }) => (
    <div data-testid="social-preview">{payload.text}</div>
  ),
}))

const createLogoUploadAction = vi.fn()
const finaliseLogoAction = vi.fn()
vi.mock('@/app/(console)/settings/logo-actions', () => ({
  createLogoUploadAction: (...args: unknown[]) => createLogoUploadAction(...args),
  finaliseLogoAction: (...args: unknown[]) => finaliseLogoAction(...args),
}))

/**
 * The real converter needs a browser decoder jsdom does not have, so it is
 * replaced by one that leaves a non-AVIF file alone, the same stand-in
 * `cast-card.test.tsx` uses, minus the AVIF branch nothing here exercises.
 */
vi.mock('@/lib/client-image', () => ({
  readImageSize: async () => ({ width: 0, height: 0 }),
  toUploadableImage: async (file: File) => ({ ok: true, file }),
  toUploadableLogo: async (file: File) => ({ ok: true, file }),
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
  repairPlanAction.mockResolvedValue({ ok: true })
  retypeSlotAction.mockResolvedValue({ ok: true })
  retypeToHeadlineAction.mockResolvedValue({ ok: true })
  rebriefSlotAction.mockResolvedValue({ ok: true })
  dismissRetypeAction.mockResolvedValue({ ok: true })
  saveHeadlineAction.mockResolvedValue({ ok: true })
  refetchArticleAction.mockResolvedValue({ ok: true })
  reuseSlotShotAction.mockResolvedValue({ ok: true })
  unlinkSlotReuseAction.mockResolvedValue({ ok: true })
  setSlotRouteAction.mockResolvedValue({ ok: true })
  attachGraphicLogosAction.mockResolvedValue({ ok: true })
  setSocialPostAction.mockResolvedValue({ ok: true })
  saveSocialPostAction.mockResolvedValue({ ok: true })
  saveSocialCardAction.mockResolvedValue({ ok: true })
  refetchSocialPostAction.mockResolvedValue({ ok: true })
  linkCastHandleAction.mockResolvedValue({ ok: true })
  unlinkCastHandleAction.mockResolvedValue({ ok: true })
  removeSocialImageAction.mockResolvedValue({ ok: true })
  retypeToSocialAction.mockResolvedValue({ ok: true })
  createLogoUploadAction.mockResolvedValue({ ok: true, url: 'https://r2.example/put', key: 'k' })
  finaliseLogoAction.mockResolvedValue({ ok: true })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 200 })),
  )
})

const COLORS: BrandChartColors = {
  accent: '#6366f1',
  surface: '#18181b',
  textPrimary: '#fafafa',
  textSecondary: '#a1a1aa',
  chartSeries: ['#6366f1', '#22c55e', '#f59e0b'],
  collapse: '#ef4444',
}

const BRAND = DEFAULT_SETTINGS.brandKit

const PROJECT = '01J0000000000000000000000A'
/** The server's clock in every model these tests build (decision 286). */
const RENDERED_AT = '2026-09-30T10:00:00.000Z'
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
  scene: null,
  promptSent: null,
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
  job: null,
  article: null,
  reuse: null,
  route: null,
  derivedRoute: { provider: 'google', model: 'gemini-3-pro-image' },
  logoUrls: {},
  references: [],
  social: null,
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
  scene: null,
  promptSent: null,
  candidates: [],
  extraCandidates: 0,
  needsFetch: false,
  retype: null,
  refusal: null,
  job: null,
  article: null,
  reuse: null,
  route: null,
  derivedRoute: { provider: 'google', model: 'gemini-3-pro-image' },
  logoUrls: {},
  references: [],
  social: null,
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
  scene: null,
  promptSent: null,
  candidates: [],
  extraCandidates: 0,
  needsFetch: false,
  retype: null,
  refusal: null,
  job: null,
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
  reuse: null,
  route: null,
  derivedRoute: { provider: 'google', model: 'gemini-3-pro-image' },
  logoUrls: {},
  references: [],
  social: null,
}

const SLOT_E = '01J000000000000000000000AE'

const graphicSlot: SlotView = {
  id: SLOT_E,
  type: 'graphic',
  status: 'placeholder',
  chapterIndex: 0,
  chapterTitle: 'The audit',
  startMs: 27000,
  durationMs: 6000,
  brief: {
    type: 'graphic',
    coversText: 'It raised four billion dollars in a single round.',
    description: 'A counting figure beside the mark that backs it.',
    motion: { kind: 'static' },
    transition: 'cut',
    scene: {
      elements: [
        {
          kind: 'figure',
          id: 'f1',
          cell: { col: 0, row: 0, colSpan: 7, rowSpan: 4 },
          value: '$4bn',
          label: 'valuation',
          claimRef: CLAIM,
          color: 'accent',
          enter: { kind: 'count', atMs: 300 },
        },
        {
          kind: 'logo',
          id: 'l1',
          cell: { col: 8, row: 0, colSpan: 4, rowSpan: 4 },
          entity: 'Stability AI',
          enter: { kind: 'rise', atMs: 200 },
        },
      ],
    },
  },
  briefError: undefined,
  scene: null,
  promptSent: null,
  candidates: [],
  extraCandidates: 0,
  needsFetch: false,
  retype: null,
  refusal: null,
  job: null,
  article: null,
  reuse: null,
  route: null,
  derivedRoute: { provider: 'google', model: 'gemini-3-pro-image' },
  logoUrls: {},
  references: [],
  social: null,
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

/** The claims a post card may show (decision 284). Invented account. */
const POST_CLAIM = '01HQ00000000000000000000S1'
const POST_CLAIMS = [{ id: POST_CLAIM, label: '@DanaOkafor: The audit found nothing.' }]
const ARTICLE_ONLY_CLAIM = '01HQ00000000000000000000S2'
const SUPPORT_CLAIMS = [
  { id: POST_CLAIM, label: 'The audit found nothing.' },
  { id: ARTICLE_ONLY_CLAIM, label: 'The chief executive resigned on 23 March 2024.' },
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
  scene: null,
  promptSent: null,
  candidates: [],
  extraCandidates: 0,
  needsFetch: true,
  retype: null,
  refusal: null,
  job: null,
  article: null,
  reuse: null,
  route: null,
  derivedRoute: { provider: 'google', model: 'gemini-3-pro-image' },
  logoUrls: {},
  references: [],
  social: null,
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
    job: null,
    fetching: false,
    renderedAt: RENDERED_AT,
    toFetch: slots.filter((slot) => slot.needsFetch).length,
    stillsToFetch: slots.filter((slot) => slot.needsFetch && slot.type === 'still').length,
    fetchEstimateUsd: 0,
    direction: null,
    warnings: [],
    slotNotes: {},
    decisions: [],
    repair: { slots: 0, becomeStills: 0, chapters: 0 },
    articleClaims: ARTICLE_CLAIMS,
    postClaims: POST_CLAIMS,
    supportClaims: SUPPORT_CLAIMS,
    stillModelOptions: STILL_OPTIONS,
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
        brand={BRAND}
      />,
    )

    expect(screen.getByText('Chapter 1 — The audit')).toBeInTheDocument()
    expect(screen.getByText('Chapter 2 — The collapse')).toBeInTheDocument()
    expect(
      screen.getByText(/“By June, the auditors could not find the money.”/),
    ).toBeInTheDocument()
  })

  it('marks the chosen candidate and swaps on click', async () => {
    render(
      <VisualBoard projectId={PROJECT} model={model([stockSlot])} colors={COLORS} brand={BRAND} />,
    )

    expect(screen.getByText('Selected')).toBeInTheDocument()
    expect(screen.getByText('+3 more fetched')).toBeInTheDocument()

    const strip = screen.getByRole('list', { name: 'Candidates' })
    // Each list item holds a real button, so the thumbs read as pressable.
    expect(within(strip).getAllByRole('listitem')).toHaveLength(2)
    const alternatives = within(strip).getAllByRole('button')
    await userEvent.click(alternatives[1]!)

    expect(chooseCandidateAction).toHaveBeenCalledWith(PROJECT, SLOT_A, 'b2')
  })

  it('shows the chosen candidate’s licence and attribution — the audit line', () => {
    render(
      <VisualBoard projectId={PROJECT} model={model([stockSlot])} colors={COLORS} brand={BRAND} />,
    )
    expect(screen.getByText(/Pexels License · Photo by Christina Morillo/)).toBeInTheDocument()
    // The cast member whose photo conditioned the frame (decision 253).
    expect(screen.getAllByText(/reference: Emad Mostaque/).length).toBeGreaterThan(0)
  })

  it('renders a chart with its takeaway and source-claim chips', () => {
    render(
      <VisualBoard projectId={PROJECT} model={model([chartSlot])} colors={COLORS} brand={BRAND} />,
    )

    expect(screen.getByRole('img', { name: /line chart/ })).toBeInTheDocument()
    expect(screen.getByText('From €104 to €1.28 in nine days.')).toBeInTheDocument()
    expect(screen.getByTitle(CLAIM)).toHaveTextContent('claim 1')
  })

  it('renders an error card, never a chart, when the brief is broken', () => {
    render(
      <VisualBoard projectId={PROJECT} model={model([brokenSlot])} colors={COLORS} brand={BRAND} />,
    )

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
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([archivalSlot])}
        colors={COLORS}
        brand={BRAND}
      />,
    )

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
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([archivalSlot])}
        colors={COLORS}
        brand={BRAND}
      />,
    )

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
    render(<VisualBoard projectId={PROJECT} model={model([still])} colors={COLORS} brand={BRAND} />)

    await userEvent.click(screen.getByRole('button', { name: /Regenerate · ≈\$0.08/ }))
    expect(refetchSlotAction).toHaveBeenCalledWith(PROJECT, SLOT_B, 'Regenerate')
  })

  it('edits the brief through the inline form and hands it to the re-fetch', async () => {
    render(
      <VisualBoard projectId={PROJECT} model={model([stockSlot])} colors={COLORS} brand={BRAND} />,
    )

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
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([placeholder])}
        colors={COLORS}
        brand={BRAND}
      />,
    )

    expect(screen.getByText(/Nothing usable was found/)).toBeInTheDocument()
    expect(screen.getByText(/must say so explicitly/)).toBeInTheDocument()
  })

  it('says when there is no narration audio to scrub, rather than a dead Play', () => {
    render(
      <VisualBoard projectId={PROJECT} model={model([stockSlot])} colors={COLORS} brand={BRAND} />,
    )

    expect(screen.getByRole('button', { name: 'Play narration' })).toBeDisabled()
    expect(screen.getByText(/No narration audio to scrub/)).toBeInTheDocument()
  })

  it('offers a filmstrip jump per slot', () => {
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([stockSlot, chartSlot])}
        colors={COLORS}
        brand={BRAND}
      />,
    )

    const filmstrip = screen.getByRole('list', { name: 'Filmstrip' })
    expect(within(filmstrip).getAllByRole('listitem')).toHaveLength(2)
  })

  it('enlarges the chosen candidate from the Preview button, at full size', async () => {
    render(
      <VisualBoard projectId={PROJECT} model={model([stockSlot])} colors={COLORS} brand={BRAND} />,
    )

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
    render(
      <VisualBoard projectId={PROJECT} model={model([stockSlot])} colors={COLORS} brand={BRAND} />,
    )

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

describe('a graphic slot (decision 268, Plan B)', () => {
  it('shows the graphic badge, its claim chips, and an Add logo button for a missing mark', () => {
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([graphicSlot])}
        colors={COLORS}
        brand={BRAND}
      />,
    )
    // The type badge speaks decision 214's names, same as every other type.
    expect(screen.getAllByText('graphic').length).toBeGreaterThan(0)
    expect(screen.getByTitle(CLAIM)).toHaveTextContent('claim 1')
    expect(screen.getByRole('button', { name: 'Add logo for Stability AI' })).toBeInTheDocument()
  })

  it('offers Add logo again for a mark that was matched then deleted from the library', () => {
    // The stored assetId is real, but the library no longer has it (so it is
    // not a key in logoUrls either): the slot must be repairable exactly
    // like one that never matched, not silently treated as fine because a
    // now-dangling id is on record.
    const danglingSlot: SlotView = {
      ...graphicSlot,
      brief: {
        type: 'graphic',
        coversText: graphicSlot.brief!.coversText,
        description: 'A counting figure beside the mark that backs it.',
        motion: { kind: 'static' },
        transition: 'cut',
        scene: {
          elements: [
            {
              kind: 'figure',
              id: 'f1',
              cell: { col: 0, row: 0, colSpan: 7, rowSpan: 4 },
              value: '$4bn',
              label: 'valuation',
              claimRef: CLAIM,
              color: 'accent',
              enter: { kind: 'count', atMs: 300 },
            },
            {
              kind: 'logo',
              id: 'l1',
              cell: { col: 8, row: 0, colSpan: 4, rowSpan: 4 },
              entity: 'Stability AI',
              enter: { kind: 'rise', atMs: 200 },
              assetId: '01HQ00000000000000000000M9',
            },
          ],
        },
      },
    }
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([danglingSlot])}
        colors={COLORS}
        brand={BRAND}
      />,
    )
    expect(screen.getByRole('button', { name: 'Add logo for Stability AI' })).toBeInTheDocument()
  })

  it('uploads a mark for a missing logo, then re-resolves the graphic against the library', async () => {
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([graphicSlot])}
        colors={COLORS}
        brand={BRAND}
      />,
    )

    const file = new File([new Uint8Array([1, 2, 3, 4])], 'stability.png', { type: 'image/png' })
    const picker = screen.getByLabelText('Choose a logo file for Stability AI')
    await userEvent.upload(picker, file)

    await waitFor(() =>
      expect(finaliseLogoAction).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'k', title: 'Stability AI' }),
      ),
    )
    expect(createLogoUploadAction).toHaveBeenCalledWith(
      expect.objectContaining({ fileType: 'image/png' }),
    )
    await waitFor(() => expect(attachGraphicLogosAction).toHaveBeenCalledWith(PROJECT, SLOT_E))
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({ title: 'Mark added; the graphic has it now' }),
    )
  })

  it('offers graphic in the format picker, and drafts it like chart and map', async () => {
    render(
      <VisualBoard projectId={PROJECT} model={model([stockSlot])} colors={COLORS} brand={BRAND} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'graphic' }))

    expect(retypeSlotAction).toHaveBeenCalledWith(PROJECT, SLOT_A, 'graphic')
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('Drafting the graphic') }),
    )
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
    render(<VisualBoard projectId={PROJECT} model={planModel()} colors={COLORS} brand={BRAND} />)

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
    render(<VisualBoard projectId={PROJECT} model={planModel()} colors={COLORS} brand={BRAND} />)

    // Both spends sit in one row: fetch this plan, or plan again.
    expect(screen.getByRole('button', { name: /Fetch visuals/ })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: /Re-plan shot list · ≈\$0\.15/ }))
    expect(replanShotsAction).not.toHaveBeenCalled()
    expect(screen.getByText(/planned again from the saved direction/)).toBeInTheDocument()
    // The per-shot model choices go with the briefs, and the copy says so.
    expect(screen.getByText(/image model you picked per shot is discarded/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^Re-plan now$/ }))
    expect(replanShotsAction).toHaveBeenCalledWith(PROJECT)
  })

  it('offers Fix these N slots behind a confirm, naming how many become stills', async () => {
    render(
      <VisualBoard
        projectId={PROJECT}
        model={{ ...planModel(), repair: { slots: 3, becomeStills: 1, chapters: 2 } }}
        colors={COLORS}
        brand={BRAND}
      />,
    )

    await userEvent.click(
      screen.getByRole('button', { name: /Fix these 3 slots · ≈\$0\.06 · 1 becomes a still/ }),
    )
    expect(repairPlanAction).not.toHaveBeenCalled()
    expect(screen.getByText(/one call per chapter \(2\)/)).toBeInTheDocument()
    expect(screen.getByText(/1 becomes a generated still/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /^Fix now$/ }))
    expect(repairPlanAction).toHaveBeenCalledWith(PROJECT)
  })

  it('shows no Fix button when nothing is flagged', () => {
    render(<VisualBoard projectId={PROJECT} model={planModel()} colors={COLORS} brand={BRAND} />)
    expect(screen.queryByRole('button', { name: /Fix these/ })).not.toBeInTheDocument()
  })

  it('re-types a slot through the format picker — the suggestion is not a lock', async () => {
    render(<VisualBoard projectId={PROJECT} model={planModel()} colors={COLORS} brand={BRAND} />)

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
    render(
      <VisualBoard projectId={PROJECT} model={model([stockSlot])} colors={COLORS} brand={BRAND} />,
    )

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
        brand={BRAND}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'news headline' }))
    const chooser = screen.getByRole('group', { name: 'Which article this card quotes' })
    expect(chooser).toHaveTextContent(/no claim in this project’s dossier has one behind it/)
    expect(within(chooser).queryByRole('button', { name: 'Quote this' })).not.toBeInTheDocument()
    expect(retypeToHeadlineAction).not.toHaveBeenCalled()
  })

  it('re-points a headline card at a different article', async () => {
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([headlineSlot])}
        colors={COLORS}
        brand={BRAND}
      />,
    )

    const picker = screen.getByRole('group', { name: 'Slot format' })
    const button = within(picker).getByRole('button', { name: 'news headline' })

    // The deliberate exception to "the current format's button is disabled":
    // on a headline slot this button does not change the format, it changes
    // which article is quoted, which is the only way to change it at all.
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button).toBeEnabled()
    await userEvent.click(button)

    const chooser = screen.getByRole('group', { name: 'Which article this card quotes' })
    // The article it already quotes is marked, not offered again.
    expect(within(chooser).getByText('quoted now')).toBeInTheDocument()
    const offers = within(chooser).getAllByRole('button', { name: 'Quote this' })
    expect(offers).toHaveLength(1)

    await userEvent.click(offers[0]!)
    expect(retypeToHeadlineAction).toHaveBeenCalledWith(PROJECT, SLOT_D, ARTICLE_CLAIMS[1]!.id)
  })

  it('keeps the chooser open when the save is refused, so the pick is not lost', async () => {
    retypeToHeadlineAction.mockResolvedValue({ ok: false, error: 'That claim has no article.' })
    render(
      <VisualBoard projectId={PROJECT} model={model([stockSlot])} colors={COLORS} brand={BRAND} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'news headline' }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Quote this' })[0]!)

    expect(
      screen.getByRole('group', { name: 'Which article this card quotes' }),
    ).toBeInTheDocument()
  })

  it('edits just save during plan review, and the per-slot fetch is offered', async () => {
    render(<VisualBoard projectId={PROJECT} model={planModel()} colors={COLORS} brand={BRAND} />)

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
    render(
      <VisualBoard projectId={PROJECT} model={model([stockSlot])} colors={COLORS} brand={BRAND} />,
    )
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
        brand={BRAND}
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

  it('asks for a different brief, with an optional steer', async () => {
    render(
      <VisualBoard projectId={PROJECT} model={model([stockSlot])} colors={COLORS} brand={BRAND} />,
    )

    await userEvent.click(screen.getAllByRole('button', { name: 'Draft a different brief' })[0]!)
    // The steer is optional, so the form must submit empty (decision 258).
    await userEvent.click(screen.getByRole('button', { name: 'Draft it' }))
    expect(rebriefSlotAction).toHaveBeenCalledWith(PROJECT, SLOT_A, '')
  })

  it('sends what the owner typed, and says the steer is not kept', async () => {
    render(
      <VisualBoard projectId={PROJECT} model={model([stockSlot])} colors={COLORS} brand={BRAND} />,
    )

    await userEvent.click(screen.getAllByRole('button', { name: 'Draft a different brief' })[0]!)
    const form = screen.getByLabelText(/What are you picturing/)
    await userEvent.type(form, 'People, not another empty room.')
    // The one-off nature is on the form, not discovered later when a re-plan
    // wipes the result.
    expect(screen.getByText(/used once and not kept/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Draft it' }))
    expect(rebriefSlotAction).toHaveBeenCalledWith(
      PROJECT,
      SLOT_A,
      'People, not another empty room.',
    )
  })

  it('never offers a headline card a new brief — its words are the article’s', () => {
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([headlineSlot])}
        colors={COLORS}
        brand={BRAND}
      />,
    )
    expect(
      screen.queryByRole('button', { name: 'Draft a different brief' }),
    ).not.toBeInTheDocument()
  })

  it('says a new brief is being drafted, and holds the card while it is', () => {
    const drafting: SlotView = { ...stockSlot, retype: { state: 'rebriefing' } }
    render(
      <VisualBoard projectId={PROJECT} model={model([drafting])} colors={COLORS} brand={BRAND} />,
    )

    expect(screen.getByRole('status')).toHaveTextContent(/drafting a new brief/)
    // Not the re-type sentence, which would name a format nobody asked about.
    expect(screen.getByRole('status')).not.toHaveTextContent(/map locations/)
    const picker = screen.getByRole('group', { name: 'Slot format' })
    for (const button of within(picker).getAllByRole('button')) {
      expect(button).toBeDisabled()
    }
  })

  it('shows a refused re-brief in the model’s words, keeping the brief it has', async () => {
    const refused: SlotView = {
      ...stockSlot,
      retype: { state: 'rebrief-refused', reason: 'This beat has only one honest image.' },
    }
    render(
      <VisualBoard projectId={PROJECT} model={model([refused])} colors={COLORS} brand={BRAND} />,
    )

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/only one honest image/)
    expect(alert).toHaveTextContent(/keeps the one it has/)
    await userEvent.click(within(alert).getByRole('button', { name: 'Dismiss' }))
    expect(dismissRetypeAction).toHaveBeenCalledWith(PROJECT, SLOT_A)
  })

  // Decision 277: a Fix that did not clear a slot says why on its card.
  it('shows what the Fix did to a slot it did not clear, until it is dismissed', async () => {
    const noted: SlotView = {
      ...stockSlot,
      retype: { state: 'fix-note', note: 'Fix kept this brief: the answer changed its format.' },
    }
    render(<VisualBoard projectId={PROJECT} model={model([noted])} colors={COLORS} brand={BRAND} />)

    const note = screen.getByText('Fix kept this brief: the answer changed its format.')
    const box = note.closest('div')!
    await userEvent.click(within(box).getByRole('button', { name: 'Dismiss' }))
    expect(dismissRetypeAction).toHaveBeenCalledWith(PROJECT, SLOT_A)
    // The note holds no button: it is a report, not a model at work. The
    // Dismiss press itself holds the card until its refresh lands, then lets go.
    const picker = screen.getByRole('group', { name: 'Slot format' })
    await waitFor(() =>
      expect(
        within(picker)
          .getAllByRole('button')
          .some((button) => !button.hasAttribute('disabled')),
      ).toBe(true),
    )
  })

  it('lists what Fix cannot clear apart from the craft notes', () => {
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([plannedStock], {
          phase: 'plan',
          toFetch: 1,
          stillsToFetch: 0,
          warnings: ['this is the third "wide" shot in a row; use a different shot size (slot 2)'],
          decisions: ['no brief depicts Sean Parker, so their photographs are never sent'],
        })}
        colors={COLORS}
        brand={BRAND}
      />,
    )

    expect(screen.getByRole('list', { name: 'Craft notes' })).toHaveTextContent(/third "wide"/)
    const decide = screen.getByRole('list', { name: 'For you to decide' })
    expect(decide).toHaveTextContent(/Sean Parker/)
    expect(decide).not.toHaveTextContent(/third "wide"/)
  })

  it('names the format it is drafting, whatever the format is', () => {
    // The bug this replaces (2026-09-18): a two-way ternary made every target
    // that was not a chart announce "map locations", so a headline re-type
    // said the wrong thing on the way to failing.
    const plan = { phase: 'plan', toFetch: 1, stillsToFetch: 0 } as const
    const drafting: SlotView = { ...plannedStock, retype: { state: 'drafting', target: 'map' } }
    const { rerender } = render(
      <VisualBoard
        projectId={PROJECT}
        model={model([drafting], plan)}
        colors={COLORS}
        brand={BRAND}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent(/drafting the map locations/)

    const stale: SlotView = { ...plannedStock, retype: { state: 'drafting', target: 'headline' } }
    rerender(
      <VisualBoard
        projectId={PROJECT}
        model={model([stale], plan)}
        colors={COLORS}
        brand={BRAND}
      />,
    )
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
        brand={BRAND}
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
    render(
      <VisualBoard projectId={PROJECT} model={model([refused])} colors={COLORS} brand={BRAND} />,
    )

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

describe('the model select on a shot (decision 264)', () => {
  const stillSlot: SlotView = {
    ...stockSlot,
    id: SLOT_B,
    type: 'still',
    brief: {
      type: 'still',
      coversText: 'The trading floor, 1995.',
      description: 'CRT monitors, cigarette smoke.',
      motion: { kind: 'static' },
      transition: 'cut',
      prompt: '1995 trading floor',
    },
    candidates: [],
    extraCandidates: 0,
    route: null,
    derivedRoute: { provider: 'google', model: 'gemini-3-pro-image' },
  }

  it('offers a model select on a still card, and changing it calls the action', async () => {
    render(
      <VisualBoard projectId={PROJECT} model={model([stillSlot])} colors={COLORS} brand={BRAND} />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Edit brief/ }))

    const select = screen.getByLabelText('Image model') as HTMLSelectElement
    expect(select.tagName).toBe('SELECT')
    expect(within(select).getByText('Planned default (Gemini 3 Pro Image)')).toBeInTheDocument()
    expect(within(select).getByText('Gemini 3.1 Flash Image')).toBeInTheDocument()
    expect(within(select).getByText('FLUX.1 dev')).toBeInTheDocument()
    // The groups read as the providers are written, not as they are keyed.
    expect([...select.querySelectorAll('optgroup')].map((group) => group.label)).toEqual([
      'Google',
      'fal.ai',
    ])

    await userEvent.selectOptions(select, 'fal:fal-ai/flux/dev')
    expect(setSlotRouteAction).toHaveBeenCalledWith(PROJECT, SLOT_B, {
      provider: 'fal',
      model: 'fal-ai/flux/dev',
    })
    expect(toast).toHaveBeenCalledWith({ title: 'Model changed; re-fetch this shot to buy it' })
  })

  it('shows the stored route when there is one', async () => {
    const routed: SlotView = { ...stillSlot, route: { provider: 'fal', model: 'fal-ai/flux/dev' } }
    render(
      <VisualBoard projectId={PROJECT} model={model([routed])} colors={COLORS} brand={BRAND} />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Edit brief/ }))

    const select = screen.getByLabelText('Image model') as HTMLSelectElement
    expect(select.value).toBe('fal:fal-ai/flux/dev')
  })

  it('marks the plan’s own choice as the default', async () => {
    render(
      <VisualBoard projectId={PROJECT} model={model([stillSlot])} colors={COLORS} brand={BRAND} />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Edit brief/ }))

    const select = screen.getByLabelText('Image model') as HTMLSelectElement
    expect(select.value).toBe('')
    expect(screen.getByText('Planned default (Gemini 3 Pro Image)')).toBeInTheDocument()
  })

  it('a chart card has no model select', async () => {
    render(
      <VisualBoard projectId={PROJECT} model={model([chartSlot])} colors={COLORS} brand={BRAND} />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Edit brief/ }))

    expect(screen.queryByLabelText('Image model')).toBeNull()
  })

  it('offers a live model the server listed (decision 288)', async () => {
    const live = {
      ...model([stillSlot]),
      stillModelOptions: [
        ...STILL_OPTIONS,
        { provider: 'fal' as const, id: 'fal-ai/mock-flux', label: 'Mock FLUX' },
      ],
    }
    render(<VisualBoard projectId={PROJECT} model={live} colors={COLORS} brand={BRAND} />)
    await userEvent.click(screen.getByRole('button', { name: /Edit brief/ }))

    const select = screen.getByLabelText('Image model') as HTMLSelectElement
    expect(within(select).getByText('Mock FLUX')).toBeInTheDocument()
  })
})

describe('the board edits the scene and shows the prompt sent (decision 287)', () => {
  const promptSentSlot: SlotView = {
    ...stockSlot,
    id: SLOT_B,
    type: 'still',
    brief: {
      type: 'still',
      coversText: 'The trading floor, 1995.',
      description: 'CRT monitors, cigarette smoke.',
      motion: { kind: 'static' },
      transition: 'cut',
      // A stored prompt still carrying the legacy house line: `scene` is what
      // it reads with that stripped back out.
      prompt:
        'A desk. An available-light documentary photograph, warm film grain; muted ' +
        'documentary colour grade anchored on #111111 and #eeeeee against #222222; ' +
        'sombre, photographic realism.',
    },
    candidates: [],
    extraCandidates: 0,
    route: null,
    derivedRoute: { provider: 'google', model: 'gemini-3-pro-image' },
    scene: 'A desk.',
    promptSent:
      'A desk.\n\nAn available-light documentary photograph: light from the scene’s own ' +
      'sources, surfaces showing ordinary daily use, people caught candid and mid-moment, ' +
      'never posing or acting for the camera.',
  }

  it('edits the scene and shows the prompt sent, read-only', async () => {
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([promptSentSlot])}
        colors={COLORS}
        brand={BRAND}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Edit brief/ }))

    expect(screen.getByLabelText('Scene')).toHaveValue('A desk.')
    expect(screen.queryByLabelText('Generation prompt')).toBeNull()

    await userEvent.click(screen.getByText('Prompt sent to the model'))
    expect(screen.getByText(/An available-light documentary photograph:/)).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: /Save/ }))
    expect(editBriefAction).toHaveBeenCalledWith(
      PROJECT,
      SLOT_B,
      expect.objectContaining({ prompt: 'A desk.' }),
    )
  })

  it('has nothing to disclose when the slot carries no prompt preview yet', async () => {
    const noPreview: SlotView = { ...promptSentSlot, promptSent: null }
    render(
      <VisualBoard projectId={PROJECT} model={model([noPreview])} colors={COLORS} brand={BRAND} />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Edit brief/ }))

    expect(screen.queryByText('Prompt sent to the model')).toBeNull()
  })
})

describe('the headline card (decision 257)', () => {
  it('shows what the article said, and where each field came from', () => {
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([headlineSlot])}
        colors={COLORS}
        brand={BRAND}
      />,
    )

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
    render(
      <VisualBoard projectId={PROJECT} model={model([unread])} colors={COLORS} brand={BRAND} />,
    )

    expect(screen.getByText(/The publisher returned 403/)).toBeTruthy()
    expect(screen.getByText(/Open it and fill these in/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Fill these in' })).toBeTruthy()
  })

  // Decision 280: a card whose claim names only a front page asks for the article.
  it("asks for the article's address when the source is a front page", async () => {
    const user = userEvent.setup()
    setHeadlineArticleAction.mockResolvedValue({ ok: true })
    const front: SlotView = {
      ...headlineSlot,
      status: 'placeholder',
      article: {
        ...headlineSlot.article!,
        url: 'https://semafor.com',
        headline: null,
        publishedAt: null,
        status: 'failed',
        failureReason:
          "This source is the site's front page, not an article, so it has no headline or date to read.",
      },
    }
    render(<VisualBoard projectId={PROJECT} model={model([front])} colors={COLORS} brand={BRAND} />)

    expect(screen.getByRole('link', { name: "Open the site's front page" })).toBeTruthy()
    const form = screen.getByRole('form', { name: "The article's address" })
    await user.type(
      within(form).getByRole('textbox'),
      'https://www.semafor.com/article/10/2023/stability-ai-cash',
    )
    await user.click(within(form).getByRole('button', { name: 'Use this article' }))
    await waitFor(() =>
      expect(setHeadlineArticleAction).toHaveBeenCalledWith(
        PROJECT,
        headlineSlot.id,
        'https://www.semafor.com/article/10/2023/stability-ai-cash',
      ),
    )
  })

  // Decision 280: a card with a headline but no date said nothing at all.
  it('says what a placeholder card still needs, even when it has a headline', () => {
    const undated: SlotView = {
      ...headlineSlot,
      status: 'placeholder',
      article: { ...headlineSlot.article!, publishedAt: null },
    }
    render(
      <VisualBoard projectId={PROJECT} model={model([undated])} colors={COLORS} brand={BRAND} />,
    )
    expect(screen.getByText(/stays a placeholder until it has the date/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Fill these in' })).toBeTruthy()
  })

  it('saves a correction, the marker phrase and the standfirst together', async () => {
    const user = userEvent.setup()
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([headlineSlot])}
        colors={COLORS}
        brand={BRAND}
      />,
    )

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
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([headlineSlot])}
        colors={COLORS}
        brand={BRAND}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Re-fetch' }))
    await waitFor(() => expect(refetchArticleAction).toHaveBeenCalledWith(PROJECT, SLOT_D))
  })
})

describe('reusing a shot (decision 261)', () => {
  const placeholder: SlotView = {
    ...stockSlot,
    id: SLOT_C,
    status: 'placeholder',
    startMs: 12000,
    brief: {
      ...stockSlot.brief!,
      coversText: 'The trail led to Manila.',
      description: 'A courtroom sketch nothing free will ever have.',
    } as SlotView['brief'],
    candidates: [],
    extraCandidates: 0,
    needsFetch: true,
  }

  it('offers the film’s other shots to a picture card, with their distance, and links on Use this', async () => {
    const user = userEvent.setup()
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([stockSlot, placeholder])}
        colors={COLORS}
        brand={BRAND}
      />,
    )

    const card = document.getElementById(`slot-${SLOT_C}`)!
    await user.click(within(card).getByRole('button', { name: 'Use an existing shot' }))

    const picker = within(card).getByRole('group', { name: 'Shots to reuse' })
    expect(within(picker).getByRole('group', { name: 'Shot at 0:00' })).toBeInTheDocument()
    expect(
      within(picker).getByText(/By June, the auditors could not find the money/),
    ).toBeInTheDocument()
    expect(within(picker).getByText('12 s earlier')).toBeInTheDocument()
    expect(within(picker).getByText('plays within a minute of this slot')).toBeInTheDocument()

    await user.click(within(picker).getByRole('button', { name: 'Use this' }))
    await waitFor(() =>
      expect(reuseSlotShotAction).toHaveBeenCalledWith(PROJECT, SLOT_C, SLOT_A, 'a1'),
    )
    expect(toast).toHaveBeenCalledWith({ title: 'Now showing the shot from 0:00' })
  })

  it('before Fetch offers the link without a picture, and says Fetch will copy', async () => {
    const user = userEvent.setup()
    const plannedStock: SlotView = {
      ...stockSlot,
      status: 'unresolved',
      candidates: [],
      extraCandidates: 0,
      needsFetch: true,
    }
    const plannedTarget: SlotView = { ...placeholder, status: 'unresolved' }
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([plannedStock, plannedTarget], { phase: 'plan', toFetch: 2 })}
        colors={COLORS}
        brand={BRAND}
      />,
    )

    const card = document.getElementById(`slot-${SLOT_C}`)!
    await user.click(within(card).getByRole('button', { name: 'Use an existing shot' }))
    await user.click(within(card).getByRole('button', { name: 'Use whatever this slot chooses' }))
    await waitFor(() =>
      expect(reuseSlotShotAction).toHaveBeenCalledWith(PROJECT, SLOT_C, SLOT_A, undefined),
    )
    expect(toast).toHaveBeenCalledWith({
      title: 'Linked. Fetch visuals will copy the shot when it lands',
    })
  })

  it('a linked card says where its shot came from, hides the fetch buttons, and offers its own shot back', async () => {
    const user = userEvent.setup()
    const linked: SlotView = {
      ...placeholder,
      status: 'resolved',
      candidates: [{ ...stockSlot.candidates[0]!, reusedFrom: { slotId: SLOT_A } }],
      needsFetch: false,
      reuse: { sourceSlotId: SLOT_A, chapterIndex: 0, startMs: 0, sourceStatus: 'resolved' },
    }
    const source: SlotView = { ...stockSlot }
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([source, linked])}
        colors={COLORS}
        brand={BRAND}
      />,
    )

    const card = document.getElementById(`slot-${SLOT_C}`)!
    expect(within(card).getByText('Reused from ch 1 · 0:00')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /^Regenerate/ })).toBeNull()
    expect(within(card).queryByRole('button', { name: 'Upload own' })).toBeNull()
    expect(within(card).queryByRole('button', { name: 'Draft a different brief' })).toBeNull()
    expect(within(card).queryByRole('button', { name: 'Use an existing shot' })).toBeNull()
    // A name string is matched whole, so this is the plain label and never
    // "Edit brief & re-fetch".
    expect(within(card).getByRole('button', { name: 'Edit brief' })).toBeInTheDocument()

    const sourceCard = document.getElementById(`slot-${SLOT_A}`)!
    expect(within(sourceCard).getByText('Also used at 0:12.')).toBeInTheDocument()
    expect(within(sourceCard).queryByRole('button', { name: 'Use an existing shot' })).toBeNull()

    await user.click(within(card).getByRole('button', { name: 'Choose its own shot' }))
    await waitFor(() => expect(unlinkSlotReuseAction).toHaveBeenCalledWith(PROJECT, SLOT_C))
  })

  it('never offers a chart, a map or a headline the picker, and offers a source with nothing chosen nothing', async () => {
    const user = userEvent.setup()
    const emptySource: SlotView = {
      ...stockSlot,
      id: SLOT_A,
      status: 'placeholder',
      candidates: [],
      extraCandidates: 0,
      needsFetch: true,
    }
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([emptySource, chartSlot, headlineSlot, placeholder])}
        colors={COLORS}
        brand={BRAND}
      />,
    )
    for (const id of [chartSlot.id, headlineSlot.id]) {
      const card = document.getElementById(`slot-${id}`)!
      expect(within(card).queryByRole('button', { name: 'Use an existing shot' })).toBeNull()
    }
    // On the board a source with nothing chosen has nothing to lend, so it is
    // not offered: no copy step runs there, and a link to it would never fill.
    const card = document.getElementById(`slot-${SLOT_C}`)!
    await user.click(within(card).getByRole('button', { name: 'Use an existing shot' }))
    const picker = within(card).getByRole('group', { name: 'Shots to reuse' })
    expect(within(picker).queryByRole('group', { name: /^Shot at/ })).toBeNull()
    expect(
      within(picker).getByText(
        'No other stock, AI image or real-footage slot in this film has a shot to offer yet.',
      ),
    ).toBeInTheDocument()
  })
})

// Decision 278: the photos of the film's sets sit beside its other shots.
describe('VisualBoard: set photos in "Use an existing shot"', () => {
  const SET = '01J000000000000000000000S1'
  const boardroom = {
    id: SET,
    name: 'Stability AI Boardroom',
    plates: [
      {
        contentHash: 'n1',
        view: 'north' as const,
        origin: 'uploaded' as const,
        url: 'https://r2/n1.jpg',
      },
      {
        contentHash: 'e1',
        view: 'east' as const,
        origin: 'generated' as const,
        url: 'https://r2/e1.png',
      },
    ],
  }

  it('offers each set photo, and uses the one picked', async () => {
    const user = userEvent.setup()
    showSetPhotoAction.mockResolvedValue({ ok: true })
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([stockSlot])}
        colors={COLORS}
        brand={BRAND}
        setPhotos={[boardroom]}
      />,
    )
    const card = document.getElementById(`slot-${SLOT_A}`)!
    await user.click(within(card).getByRole('button', { name: 'Use an existing shot' }))
    const photos = within(card).getByRole('group', { name: 'Photos of Stability AI Boardroom' })
    expect(within(photos).getByAltText('Stability AI Boardroom, North wall')).toBeInTheDocument()
    expect(within(photos).getByText('East wall · generated')).toBeInTheDocument()
    // With a set photo on offer, the picker does not say there is nothing.
    expect(within(card).queryByText(/has a shot to offer yet/)).toBeNull()

    await user.click(
      within(photos).getByRole('button', {
        name: 'Use the east wall photo of Stability AI Boardroom',
      }),
    )
    await waitFor(() =>
      expect(showSetPhotoAction).toHaveBeenCalledWith({
        projectId: PROJECT,
        slotId: SLOT_A,
        setId: SET,
        contentHash: 'e1',
      }),
    )
  })

  it('offers a real-footage slot only the photos the producer uploaded', async () => {
    const user = userEvent.setup()
    const archivalSlot: SlotView = {
      ...stockSlot,
      type: 'archival',
      brief: {
        type: 'archival',
        coversText: 'The boardroom in 2023.',
        description: 'The real room.',
        motion: { kind: 'static' },
        transition: 'cut',
        query: 'Stability AI office',
        mustShow: 'the boardroom',
      },
    }
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([archivalSlot])}
        colors={COLORS}
        brand={BRAND}
        setPhotos={[boardroom]}
      />,
    )
    const card = document.getElementById(`slot-${SLOT_A}`)!
    await user.click(within(card).getByRole('button', { name: 'Use an existing shot' }))
    const photos = within(card).getByRole('group', { name: 'Photos of Stability AI Boardroom' })
    expect(within(photos).getAllByRole('button', { name: /Use the/ })).toHaveLength(1)
    expect(within(photos).queryByText(/generated/)).toBeNull()
  })
})

describe('VisualBoard: reference chips', () => {
  const withReferences = (references: SlotView['references']): SlotView => ({
    ...stockSlot,
    references,
  })

  it('names each reference a brief calls on, and marks an unresolved one', () => {
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([
          withReferences([
            { kind: 'person', name: 'Markus Braun', resolved: true },
            { kind: 'set', name: 'Aschheim headquarters', resolved: false },
          ]),
        ])}
        colors={COLORS}
        brand={BRAND}
      />,
    )

    expect(screen.getByText(/photograph · Markus Braun/)).toBeInTheDocument()
    // The actionable half: named, but nothing backs it, so the shot is plain.
    const missing = screen.getByText(/no plate · Aschheim headquarters/)
    expect(missing).toBeInTheDocument()
    expect(missing).toHaveAttribute(
      'title',
      'Aschheim headquarters: no plate is stored, so this shot is generated without one',
    )
  })

  it('renders no reference row for a brief that names nothing', () => {
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([withReferences([])])}
        colors={COLORS}
        brand={BRAND}
      />,
    )

    expect(screen.queryByLabelText('References this brief uses')).not.toBeInTheDocument()
  })
})

const SLOT_F = '01J000000000000000000000AF'
const CAST_MEMBER = '01HQ00000000000000000000C1'

/** Invented account and words: a fixture must never carry a real one. */
const fetchedPost = {
  url: 'https://x.com/i/status/1734567890123456789',
  platform: 'x' as const,
  postId: '1734567890123456789',
  handle: 'DanaOkafor',
  authorName: 'Dana Okafor',
  text: 'The audit is finished and the $1.9 billion is not there.',
  postedAt: '2023-03-14',
  endedWithMediaLink: false,
  provenance: {
    authorName: 'oembed' as const,
    handle: 'oembed' as const,
    text: 'oembed' as const,
    postedAt: 'manual' as const,
  },
  status: 'fetched' as const,
  failureReason: null,
}

const socialSlot: SlotView = {
  id: SLOT_F,
  type: 'social',
  status: 'resolved',
  chapterIndex: 0,
  chapterTitle: 'The audit',
  startMs: 33000,
  durationMs: 6000,
  brief: {
    type: 'social',
    coversText: 'She said it herself, in public.',
    description: 'The post, on screen.',
    motion: { kind: 'static' },
    transition: 'cut',
    sourceClaimId: POST_CLAIM,
    postUrl: 'https://x.com/i/status/1734567890123456789',
  },
  briefError: undefined,
  scene: null,
  promptSent: null,
  candidates: [],
  extraCandidates: 0,
  needsFetch: false,
  retype: null,
  refusal: null,
  job: null,
  article: null,
  reuse: null,
  route: null,
  derivedRoute: { provider: 'google', model: 'gemini-3-pro-image' },
  logoUrls: {},
  references: [],
  social: {
    post: fetchedPost,
    avatar: { source: 'initials', url: null, castName: null, castId: null },
    mediaUrl: null,
    issues: [],
    suggestedExcerpt: null,
    payload: {
      kind: 'social',
      platform: 'x',
      authorName: 'Dana Okafor',
      handle: 'DanaOkafor',
      text: 'The audit is finished and the $1.9 billion is not there.',
      cutBefore: false,
      cutAfter: false,
      postedAt: '2023-03-14',
      initials: 'DO',
      sourceLabel: 'x.com/DanaOkafor/status/1734567890123456789',
      sourceUrl: 'https://x.com/DanaOkafor/status/1734567890123456789',
      claimId: POST_CLAIM,
    },
  },
}

function socialWith(social: Partial<NonNullable<SlotView['social']>>): SlotView {
  return { ...socialSlot, status: 'placeholder', social: { ...socialSlot.social!, ...social } }
}

describe('the post card (decision 284)', () => {
  it('draws the shared card and says where each field came from', () => {
    render(
      <VisualBoard projectId={PROJECT} model={model([socialSlot])} colors={COLORS} brand={BRAND} />,
    )

    expect(screen.getAllByText('Post on X').length).toBeGreaterThan(0)
    expect(screen.getByTestId('social-preview')).toHaveTextContent('$1.9 billion is not there')

    const fields = screen.getByLabelText('Where each field came from')
    expect(within(fields).getByText(/name . from X/)).toBeInTheDocument()
    expect(within(fields).getByText(/handle . from X/)).toBeInTheDocument()
    expect(within(fields).getByText(/text . from X/)).toBeInTheDocument()
    expect(within(fields).getByText(/date . typed by you/)).toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Edit details' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: "Set the post's address" })).toBeInTheDocument()
    // Nothing is missing, so the address form stays shut until asked for.
    expect(screen.queryByRole('form', { name: "The post's address" })).not.toBeInTheDocument()
  })

  it('shows why a post could not be read, with the address form already open', async () => {
    const user = userEvent.setup()
    const failed = socialWith({
      post: {
        ...fetchedPost,
        authorName: null,
        text: null,
        postedAt: null,
        provenance: {},
        status: 'failed',
        failureReason: X_POST_MISSING,
      },
      issues: [
        'A post card needs the name, the handle, the text and the date. Missing: the name, the text, the date.',
      ],
      payload: null,
    })
    render(
      <VisualBoard projectId={PROJECT} model={model([failed])} colors={COLORS} brand={BRAND} />,
    )

    expect(screen.getByText(X_POST_MISSING, { exact: false })).toBeInTheDocument()
    expect(screen.getByText(/Missing: the name, the text, the date/)).toBeInTheDocument()
    expect(screen.queryByTestId('social-preview')).not.toBeInTheDocument()

    const form = screen.getByRole('form', { name: "The post's address" })
    await user.type(within(form).getByRole('textbox'), 'https://x.com/DanaOkafor')
    await user.click(within(form).getByRole('button', { name: 'Use this post' }))
    await waitFor(() =>
      expect(setSocialPostAction).toHaveBeenCalledWith(PROJECT, SLOT_F, 'https://x.com/DanaOkafor'),
    )
  })

  it('reads the post again on request', async () => {
    render(
      <VisualBoard projectId={PROJECT} model={model([socialSlot])} colors={COLORS} brand={BRAND} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Read again' }))
    await waitFor(() => expect(refetchSocialPostAction).toHaveBeenCalledWith(PROJECT, SLOT_F))
  })

  it('saves corrected details to the post', async () => {
    const user = userEvent.setup()
    render(
      <VisualBoard projectId={PROJECT} model={model([socialSlot])} colors={COLORS} brand={BRAND} />,
    )

    await user.click(screen.getByRole('button', { name: 'Edit details' }))
    const form = screen.getByRole('form', { name: "The post's details" })
    const name = within(form).getByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Dana K. Okafor')
    await user.click(within(form).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(saveSocialPostAction).toHaveBeenCalledWith(PROJECT, SLOT_F, {
        authorName: 'Dana K. Okafor',
        handle: 'DanaOkafor',
        text: fetchedPost.text,
        postedAt: '2023-03-14',
      }),
    )
  })

  it('pre-fills the highlight with the first figure, and saves it', async () => {
    const user = userEvent.setup()
    render(
      <VisualBoard projectId={PROJECT} model={model([socialSlot])} colors={COLORS} brand={BRAND} />,
    )

    const highlight = screen.getByLabelText('Highlight')
    expect(highlight).toHaveValue('$1.9 billion')
    await user.click(screen.getByRole('button', { name: 'Save highlight' }))
    await waitFor(() =>
      expect(saveSocialCardAction).toHaveBeenCalledWith(PROJECT, SLOT_F, {
        emphasis: '$1.9 billion',
      }),
    )
  })

  it('offers no excerpt for a post that fits', () => {
    render(
      <VisualBoard projectId={PROJECT} model={model([socialSlot])} colors={COLORS} brand={BRAND} />,
    )

    expect(screen.queryByLabelText('Excerpt')).not.toBeInTheDocument()
  })

  it('pre-fills the excerpt with the suggestion when the post is too long', async () => {
    const user = userEvent.setup()
    const suggestion = 'The audit is finished.'
    const long = socialWith({
      issues: [SOCIAL_TOO_LONG],
      suggestedExcerpt: suggestion,
      payload: null,
    })
    render(<VisualBoard projectId={PROJECT} model={model([long])} colors={COLORS} brand={BRAND} />)

    expect(screen.getByText(SOCIAL_TOO_LONG)).toBeInTheDocument()
    expect(screen.getByLabelText('Excerpt')).toHaveValue(suggestion)
    await user.click(screen.getByRole('button', { name: 'Save excerpt' }))
    await waitFor(() =>
      expect(saveSocialCardAction).toHaveBeenCalledWith(PROJECT, SLOT_F, { excerpt: suggestion }),
    )
  })

  it('asks whether the handle is one of the cast, and links the member chosen', async () => {
    const user = userEvent.setup()
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([socialSlot])}
        colors={COLORS}
        brand={BRAND}
        castMembers={[
          { id: '01HQ00000000000000000000C0', name: 'Someone Else' },
          { id: CAST_MEMBER, name: 'Dana Okafor' },
        ]}
      />,
    )

    expect(screen.getByText('Is @DanaOkafor one of the cast?')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Cast member'), CAST_MEMBER)
    await user.click(screen.getByRole('button', { name: 'Link' }))
    await waitFor(() =>
      expect(linkCastHandleAction).toHaveBeenCalledWith(PROJECT, CAST_MEMBER, 'DanaOkafor'),
    )
  })

  it('does not ask about the cast when the picture already comes from it', () => {
    const fromCast = socialWith({
      avatar: { source: 'cast', url: null, castName: 'Dana Okafor', castId: CAST_MEMBER },
    })
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([fromCast])}
        colors={COLORS}
        brand={BRAND}
        castMembers={[{ id: CAST_MEMBER, name: 'Dana Okafor' }]}
      />,
    )

    expect(screen.getByText(/cast photo of Dana Okafor/)).toBeInTheDocument()
    expect(screen.queryByText(/one of the cast\?/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload profile picture' })).toBeInTheDocument()
  })

  it('undoes a wrong cast link with a visible Unlink button', async () => {
    const fromCast = socialWith({
      avatar: { source: 'cast', url: null, castName: 'Dana Okafor', castId: CAST_MEMBER },
    })
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([fromCast])}
        colors={COLORS}
        brand={BRAND}
        castMembers={[{ id: CAST_MEMBER, name: 'Dana Okafor' }]}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Unlink' }))
    await waitFor(() =>
      expect(unlinkCastHandleAction).toHaveBeenCalledWith(PROJECT, CAST_MEMBER, SLOT_F),
    )
  })

  it('offers Unlink for a linked member with no photo yet, and not when nothing is linked', () => {
    const linkedNoPhoto = socialWith({
      avatar: { source: 'initials', url: null, castName: 'Dana Okafor', castId: CAST_MEMBER },
    })
    const { unmount } = render(
      <VisualBoard
        projectId={PROJECT}
        model={model([linkedNoPhoto])}
        colors={COLORS}
        brand={BRAND}
      />,
    )
    expect(screen.getByRole('button', { name: 'Unlink' })).toBeInTheDocument()
    unmount()

    render(
      <VisualBoard projectId={PROJECT} model={model([socialSlot])} colors={COLORS} brand={BRAND} />,
    )
    expect(screen.queryByRole('button', { name: 'Unlink' })).not.toBeInTheDocument()
  })

  it('names what each Close button closes', async () => {
    const user = userEvent.setup()
    render(
      <VisualBoard projectId={PROJECT} model={model([socialSlot])} colors={COLORS} brand={BRAND} />,
    )

    await user.click(screen.getByRole('button', { name: 'Edit details' }))
    await user.click(screen.getByRole('button', { name: "Set the post's address" }))
    expect(screen.getByRole('button', { name: 'Close details' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close address' })).toBeInTheDocument()
  })

  it('caps the name, highlight and excerpt at what the post card can store', async () => {
    const user = userEvent.setup()
    const long = socialWith({
      issues: [SOCIAL_TOO_LONG],
      suggestedExcerpt: 'The audit is finished.',
      payload: null,
    })
    render(<VisualBoard projectId={PROJECT} model={model([long])} colors={COLORS} brand={BRAND} />)

    expect(screen.getByLabelText('Highlight')).toHaveAttribute('maxLength', '120')
    expect(screen.getByLabelText('Excerpt')).toHaveAttribute('maxLength', '2000')
    await user.click(screen.getByRole('button', { name: 'Edit details' }))
    const form = screen.getByRole('form', { name: "The post's details" })
    expect(within(form).getByLabelText('Name')).toHaveAttribute('maxLength', '50')
  })

  it('says a post ended with a link, and offers the image upload', () => {
    const linked = socialWith({ post: { ...fetchedPost, endedWithMediaLink: true } })
    render(
      <VisualBoard projectId={PROJECT} model={model([linked])} colors={COLORS} brand={BRAND} />,
    )

    expect(
      screen.getByText(
        'This post ended with a link, usually its image. Upload it to show it under the text.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: "Upload the post's image" })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
  })

  it('removes an attached image', async () => {
    const withImage = socialWith({ mediaUrl: 'https://r2.example/media.png' })
    render(
      <VisualBoard projectId={PROJECT} model={model([withImage])} colors={COLORS} brand={BRAND} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() =>
      expect(removeSocialImageAction).toHaveBeenCalledWith(PROJECT, SLOT_F, 'media'),
    )
  })

  it('uploads a profile picture through the presigned pair, marked as an avatar', async () => {
    createOwnUploadAction.mockResolvedValue({ ok: true, url: 'https://r2.example/put', key: 'k' })
    finaliseOwnUploadAction.mockResolvedValue({ ok: true })
    render(
      <VisualBoard projectId={PROJECT} model={model([socialSlot])} colors={COLORS} brand={BRAND} />,
    )

    const file = new File([new Uint8Array([1, 2, 3])], 'dana.png', { type: 'image/png' })
    await userEvent.upload(screen.getByLabelText('Choose a profile picture for this post'), file)

    await waitFor(() => expect(finaliseOwnUploadAction).toHaveBeenCalled())
    expect(createOwnUploadAction).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT, slotId: SLOT_F, purpose: 'social-avatar' }),
    )
    expect(finaliseOwnUploadAction).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT, slotId: SLOT_F, purpose: 'social-avatar' }),
    )
  })

  it('asks which post a card would show, and re-types on the pick', async () => {
    render(
      <VisualBoard projectId={PROJECT} model={model([stockSlot])} colors={COLORS} brand={BRAND} />,
    )

    const picker = screen.getByRole('group', { name: 'Slot format' })
    const button = within(picker).getByRole('button', { name: 'Post on X' })
    await userEvent.click(button)
    expect(retypeSlotAction).not.toHaveBeenCalled()
    expect(button).toHaveAttribute('aria-expanded', 'true')

    const chooser = screen.getByRole('group', { name: 'Which post this card shows' })
    expect(within(chooser).getByText(/@DanaOkafor: The audit found nothing/)).toBeInTheDocument()
    await userEvent.click(within(chooser).getByRole('button', { name: 'Show this post' }))
    await waitFor(() =>
      expect(retypeToSocialAction).toHaveBeenCalledWith(PROJECT, SLOT_A, POST_CLAIM),
    )
  })

  // Amended 2026-09-30: a post no claim is sourced to used to be a dead end.
  it('takes a pasted post filed under any claim when no claim cites one', async () => {
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([stockSlot], { postClaims: [] })}
        colors={COLORS}
        brand={BRAND}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Post on X' }))
    const chooser = screen.getByRole('group', { name: 'Which post this card shows' })
    expect(within(chooser).getByText(/is sourced to a post on X yet/)).toBeInTheDocument()

    const form = within(chooser).getByRole('form', { name: 'Paste a post' })
    const use = within(form).getByRole('button', { name: 'Use this post' })
    expect(use).toBeDisabled()

    await userEvent.type(
      within(form).getByRole('textbox'),
      'https://x.com/EMostaque/status/1771400218170519741',
    )
    expect(use).toBeDisabled()
    await userEvent.selectOptions(within(form).getByRole('combobox'), ARTICLE_ONLY_CLAIM)
    await userEvent.click(use)

    await waitFor(() =>
      expect(retypeToSocialAction).toHaveBeenCalledWith(
        PROJECT,
        SLOT_A,
        ARTICLE_ONLY_CLAIM,
        'https://x.com/EMostaque/status/1771400218170519741',
      ),
    )
  })

  it('still offers the paste form beside the claims that cite a post', async () => {
    render(
      <VisualBoard projectId={PROJECT} model={model([stockSlot])} colors={COLORS} brand={BRAND} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Post on X' }))
    const chooser = screen.getByRole('group', { name: 'Which post this card shows' })
    expect(within(chooser).getByRole('button', { name: 'Show this post' })).toBeInTheDocument()
    const form = within(chooser).getByRole('form', { name: 'Paste a post' })
    expect(within(form).getByText(/Or paste the address of another post/)).toBeInTheDocument()
  })

  it('says so when the dossier has no claims to file a post under', async () => {
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([stockSlot], { postClaims: [], supportClaims: [] })}
        colors={COLORS}
        brand={BRAND}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Post on X' }))
    const chooser = screen.getByRole('group', { name: 'Which post this card shows' })
    expect(within(chooser).getByText(/no claims to file a post under/)).toBeInTheDocument()
    expect(within(chooser).queryByRole('button')).not.toBeInTheDocument()
  })
})

/** A server action the test answers when it chooses to, so the in-flight state can be read. */
function deferred<T = { ok: boolean; error?: string }>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

/** One slot's card, found by the id the filmstrip scrolls to. */
const card = (slotId: string) => within(document.getElementById(`slot-${slotId}`)!)

describe('button state on the board (decision 240)', () => {
  it('spins the pressed button and holds the rest of the card until it lands', async () => {
    const pending = deferred()
    refetchSlotAction.mockReturnValueOnce(pending.promise)
    render(
      <VisualBoard projectId={PROJECT} model={model([stockSlot])} colors={COLORS} brand={BRAND} />,
    )

    const regenerate = screen.getByRole('button', { name: 'Regenerate' })
    await userEvent.click(regenerate)

    expect(regenerate).toHaveAttribute('aria-busy', 'true')
    expect(regenerate).toBeDisabled()
    // The siblings stand down without spinning, so the eye finds the one pressed.
    const upload = screen.getByRole('button', { name: 'Upload own' })
    expect(upload).toBeDisabled()
    expect(upload).not.toHaveAttribute('aria-busy')
    const strip = screen.getByRole('list', { name: 'Candidates' })
    for (const candidate of within(strip).getAllByRole('button')) {
      expect(candidate).toBeDisabled()
    }
    // Opening the editor is not an action, so it stays offered.
    expect(screen.getByRole('button', { name: 'Edit brief & re-fetch' })).toBeEnabled()

    pending.resolve({ ok: true })
    await waitFor(() => expect(regenerate).toBeEnabled())
    expect(regenerate).not.toHaveAttribute('aria-busy')
    expect(upload).toBeEnabled()
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('fires a double click once', async () => {
    const pending = deferred()
    refetchSlotAction.mockReturnValueOnce(pending.promise)
    render(
      <VisualBoard projectId={PROJECT} model={model([stockSlot])} colors={COLORS} brand={BRAND} />,
    )

    await userEvent.dblClick(screen.getByRole('button', { name: 'Regenerate' })).catch(() => {
      // The second click lands on a disabled control, which is the point.
    })
    expect(refetchSlotAction).toHaveBeenCalledOnce()
    pending.resolve({ ok: true })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Regenerate' })).toBeEnabled())
  })

  it('keeps each card’s lock its own when two are in flight', async () => {
    const second: SlotView = { ...stockSlot, id: SLOT_B, startMs: 8000 }
    const first = deferred()
    const other = deferred()
    refetchSlotAction.mockImplementation((_project: string, slotId: string) =>
      slotId === SLOT_A ? first.promise : other.promise,
    )
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([stockSlot, second])}
        colors={COLORS}
        brand={BRAND}
      />,
    )

    await userEvent.click(card(SLOT_A).getByRole('button', { name: 'Regenerate' }))
    await userEvent.click(card(SLOT_B).getByRole('button', { name: 'Regenerate' }))
    first.resolve({ ok: true })

    await waitFor(() =>
      expect(card(SLOT_A).getByRole('button', { name: 'Regenerate' })).toBeEnabled(),
    )
    // With one `busySlot`, A finishing unlocked B while B was still sending.
    expect(card(SLOT_B).getByRole('button', { name: 'Regenerate' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
    other.resolve({ ok: true })
    await waitFor(() =>
      expect(card(SLOT_B).getByRole('button', { name: 'Regenerate' })).toBeEnabled(),
    )
  })

  it('lets go at once and says why when the server refuses', async () => {
    refetchSlotAction.mockResolvedValueOnce({ ok: false, error: 'This slot no longer exists.' })
    render(
      <VisualBoard projectId={PROJECT} model={model([stockSlot])} colors={COLORS} brand={BRAND} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Regenerate' })).toBeEnabled())
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'This slot no longer exists.', variant: 'error' }),
    )
    expect(refresh).not.toHaveBeenCalled()
  })

  it('says the request never arrived when the call itself fails, and lets go', async () => {
    refetchSlotAction.mockRejectedValueOnce(new Error('network down'))
    render(
      <VisualBoard projectId={PROJECT} model={model([stockSlot])} colors={COLORS} brand={BRAND} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Regenerate' })).toBeEnabled())
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringMatching(/never reached the server/) }),
    )
  })

  it('spins the brief editor’s Save and holds the card’s other actions while it saves', async () => {
    const pending = deferred()
    editBriefAction.mockReturnValueOnce(pending.promise)
    render(
      <VisualBoard projectId={PROJECT} model={model([stockSlot])} colors={COLORS} brand={BRAND} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Edit brief & re-fetch' }))
    const save = screen.getByRole('button', { name: 'Save & re-fetch' })
    await userEvent.click(save)

    expect(save).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeDisabled()
    // Before, the spinner landed on the "Close brief editor" toggle instead.
    expect(screen.getByRole('button', { name: 'Close brief editor' })).not.toHaveAttribute(
      'aria-busy',
    )

    pending.resolve({ ok: true })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Save & re-fetch' })).not.toBeInTheDocument(),
    )
  })

  it('keeps Upload own busy through the whole presign, upload and finalise', async () => {
    const created = deferred<{ ok: boolean; url?: string }>()
    createOwnUploadAction.mockReturnValueOnce(created.promise)
    finaliseOwnUploadAction.mockResolvedValue({ ok: true })
    render(
      <VisualBoard projectId={PROJECT} model={model([stockSlot])} colors={COLORS} brand={BRAND} />,
    )

    await userEvent.upload(
      screen.getByLabelText('Upload your own image for this slot'),
      new File(['pixels'], 'shot.png', { type: 'image/png' }),
    )

    const upload = screen.getByRole('button', { name: 'Upload own' })
    await waitFor(() => expect(upload).toHaveAttribute('aria-busy', 'true'))
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeDisabled()

    created.resolve({ ok: true, url: 'https://r2.example/put' })
    await waitFor(() => expect(finaliseOwnUploadAction).toHaveBeenCalled())
    await waitFor(() => expect(upload).not.toHaveAttribute('aria-busy'))
    expect(toast).toHaveBeenCalledWith({ title: 'Uploaded and selected' })
  })

  it('spins only the post card control pressed, where every one used to spin together', async () => {
    const pending = deferred()
    refetchSocialPostAction.mockReturnValueOnce(pending.promise)
    render(
      <VisualBoard projectId={PROJECT} model={model([socialSlot])} colors={COLORS} brand={BRAND} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Read again' }))

    expect(screen.getByRole('button', { name: 'Read again' })).toHaveAttribute('aria-busy', 'true')
    const highlight = screen.getByRole('button', { name: 'Save highlight' })
    expect(highlight).toBeDisabled()
    expect(highlight).not.toHaveAttribute('aria-busy')
    expect(screen.getByRole('button', { name: "Upload the post's image" })).toBeDisabled()

    pending.resolve({ ok: true })
    await waitFor(() => expect(highlight).toBeEnabled())
  })

  it('holds a headline card’s Re-fetch and its format picker while the article is read', async () => {
    const pending = deferred()
    refetchArticleAction.mockReturnValueOnce(pending.promise)
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([headlineSlot])}
        colors={COLORS}
        brand={BRAND}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Re-fetch' }))

    expect(screen.getByRole('button', { name: 'Re-fetch' })).toHaveAttribute('aria-busy', 'true')
    const picker = screen.getByRole('group', { name: 'Slot format' })
    for (const format of within(picker).getAllByRole('button')) expect(format).toBeDisabled()

    pending.resolve({ ok: true })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Re-fetch' })).toBeEnabled())
  })

  it('holds every plan-card spend while one of them is being sent', async () => {
    const pending = deferred()
    approvePlanAction.mockReturnValueOnce(pending.promise)
    const planned: SlotView = {
      ...stockSlot,
      status: 'unresolved',
      candidates: [],
      needsFetch: true,
    }
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([planned], {
          phase: 'plan',
          repair: { slots: 1, becomeStills: 0, chapters: 1 },
        })}
        colors={COLORS}
        brand={BRAND}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /Fetch visuals/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Fetch now$/ }))

    expect(screen.getByRole('button', { name: /^Fetch now$/ })).toHaveAttribute('aria-busy', 'true')
    // A re-plan sent beside a fetch would discard the slots the fetch is buying.
    expect(screen.getByRole('button', { name: /Re-plan shot list/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Fix these 1 slot/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Redraft direction/ })).toBeDisabled()

    pending.resolve({ ok: true })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Re-plan shot list/ })).toBeEnabled(),
    )
  })

  it('makes every filmstrip thumb a button inside its list item', () => {
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([stockSlot, chartSlot])}
        colors={COLORS}
        brand={BRAND}
      />,
    )

    const filmstrip = screen.getByRole('list', { name: 'Filmstrip' })
    expect(within(filmstrip).getAllByRole('listitem')).toHaveLength(2)
    expect(within(filmstrip).getAllByRole('button', { name: /^Jump to/ })).toHaveLength(2)
  })
})

describe('folding chapters', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  const threeSlots = () => model([stockSlot, chartSlot, brokenSlot])
  const chapterTwo = () => screen.getByRole('button', { name: /^Chapter 2 — The collapse/ })

  it('folds a chapter from its header, and the header still says what it holds', async () => {
    render(<VisualBoard projectId={PROJECT} model={threeSlots()} colors={COLORS} brand={BRAND} />)

    expect(chapterTwo()).toHaveAttribute('aria-expanded', 'true')
    expect(chapterTwo()).toHaveTextContent('1 shot')
    expect(chapterTwo()).toHaveTextContent('1 placeholder')

    await userEvent.click(chapterTwo())

    expect(chapterTwo()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText(/no longer matches its schema/)).not.toBeVisible()
    // Folded, it still names the problem inside it.
    expect(chapterTwo()).toHaveTextContent('1 placeholder')
    // The other chapter is untouched.
    expect(screen.getByText(/“By June, the auditors could not find the money.”/)).toBeVisible()

    await userEvent.click(chapterTwo())
    expect(screen.getByText(/no longer matches its schema/)).toBeVisible()
  })

  it('folds and opens every chapter at once, offering only the one that changes something', async () => {
    render(<VisualBoard projectId={PROJECT} model={threeSlots()} colors={COLORS} brand={BRAND} />)

    const expand = screen.getByRole('button', { name: 'Expand all chapters' })
    const collapse = screen.getByRole('button', { name: 'Collapse all chapters' })
    expect(expand).toBeDisabled()

    await userEvent.click(collapse)
    expect(collapse).toBeDisabled()
    expect(screen.getByRole('button', { name: /^Chapter 1 — The audit/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(chapterTwo()).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(expand)
    expect(chapterTwo()).toHaveAttribute('aria-expanded', 'true')
    expect(expand).toBeDisabled()
  })

  it('offers no fold-all row for a one-chapter film', () => {
    render(
      <VisualBoard projectId={PROJECT} model={model([stockSlot])} colors={COLORS} brand={BRAND} />,
    )
    expect(screen.queryByRole('button', { name: 'Collapse all chapters' })).not.toBeInTheDocument()
  })

  it('remembers the fold for this project in this browser', async () => {
    const { unmount } = render(
      <VisualBoard projectId={PROJECT} model={threeSlots()} colors={COLORS} brand={BRAND} />,
    )
    await userEvent.click(chapterTwo())
    unmount()

    render(<VisualBoard projectId={PROJECT} model={threeSlots()} colors={COLORS} brand={BRAND} />)
    await waitFor(() => expect(chapterTwo()).toHaveAttribute('aria-expanded', 'false'))
  })

  it('opens a folded chapter when the filmstrip jumps into it', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => {
      run(0)
      return 0
    })
    render(<VisualBoard projectId={PROJECT} model={threeSlots()} colors={COLORS} brand={BRAND} />)
    await userEvent.click(chapterTwo())

    const filmstrip = screen.getByRole('list', { name: 'Filmstrip' })
    await userEvent.click(
      within(filmstrip).getByRole('button', {
        name: `Jump to chart slot at ${timecode(brokenSlot.startMs)}`,
      }),
    )

    expect(chapterTwo()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/no longer matches its schema/)).toBeVisible()
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
  })

  it('keeps a half-typed brief when its chapter folds', async () => {
    render(<VisualBoard projectId={PROJECT} model={threeSlots()} colors={COLORS} brand={BRAND} />)
    const chapterOne = screen.getByRole('button', { name: /^Chapter 1 — The audit/ })

    await userEvent.click(card(SLOT_A).getByRole('button', { name: 'Edit brief & re-fetch' }))
    const description = card(SLOT_A).getByLabelText('Visual description')
    await userEvent.clear(description)
    await userEvent.type(description, 'A half-typed idea')

    await userEvent.click(chapterOne)
    await userEvent.click(chapterOne)

    expect(card(SLOT_A).getByLabelText('Visual description')).toHaveValue('A half-typed idea')
  })

  it('counts a chapter’s drafting and refused cards on its header', () => {
    const drafting: SlotView = {
      ...stockSlot,
      retype: { state: 'drafting', target: 'chart' },
    }
    const refused: SlotView = {
      ...chartSlot,
      retype: { state: 'refused', target: 'map', reason: 'No places in the text.' },
    }
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([drafting, refused])}
        colors={COLORS}
        brand={BRAND}
      />,
    )

    const header = screen.getByRole('button', { name: /^Chapter 1 — The audit/ })
    expect(header).toHaveTextContent('1 in progress')
    expect(header).toHaveTextContent('1 to look at')
  })
})

describe('craft notes on the card (decision 277)', () => {
  const note = 'this is the third "wide" shot in a row; use a different shot size'

  it('puts a note on the card it is about and counts it on the chapter', () => {
    const planned: SlotView = {
      ...stockSlot,
      status: 'unresolved',
      candidates: [],
      needsFetch: true,
    }
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([planned, { ...chartSlot, status: 'unresolved' }], {
          phase: 'plan',
          warnings: [`${note} (ch 1 · ${timecode(0)})`],
          slotNotes: { [SLOT_A]: [note] },
        })}
        colors={COLORS}
        brand={BRAND}
      />,
    )

    expect(card(SLOT_A).getByRole('list', { name: 'Craft notes on this shot' })).toHaveTextContent(
      note,
    )
    expect(card(SLOT_B).queryByRole('list', { name: 'Craft notes on this shot' })).toBeNull()
    expect(screen.getByRole('button', { name: /^Chapter 1 — The audit/ })).toHaveTextContent(
      '1 craft note',
    )
  })

  it('keeps notes off the cards once the board is fetched', () => {
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([stockSlot], { slotNotes: { [SLOT_A]: [note] } })}
        colors={COLORS}
        brand={BRAND}
      />,
    )
    expect(screen.queryByRole('list', { name: 'Craft notes on this shot' })).toBeNull()
  })
})

describe('background jobs on the board (decision 286)', () => {
  /** An ISO time `ms` before the model was rendered. */
  const ago = (ms: number) => new Date(Date.parse(RENDERED_AT) - ms).toISOString()

  afterEach(() => {
    vi.useRealTimers()
  })

  it('locks a card while its regenerate runs, keeps the button spinning, and says for how long', () => {
    const running: SlotView = { ...stockSlot, job: { kind: 'refetch', startedAt: ago(42_000) } }
    render(
      <VisualBoard projectId={PROJECT} model={model([running])} colors={COLORS} brand={BRAND} />,
    )

    const regenerate = screen.getByRole('button', { name: 'Regenerate' })
    expect(regenerate).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Upload own' })).toBeDisabled()
    for (const candidate of within(screen.getByRole('list', { name: 'Candidates' })).getAllByRole(
      'button',
    )) {
      expect(candidate).toBeDisabled()
    }
    expect(
      screen.getByText(
        `Regenerating, started ${timecode(42_000)} ago. The new candidates replace these when they land.`,
      ),
    ).toBeInTheDocument()
  })

  it('lets go of a stamp older than 10 minutes and says it may have stopped', () => {
    const stuck: SlotView = { ...stockSlot, job: { kind: 'refetch', startedAt: ago(11 * 60_000) } }
    render(<VisualBoard projectId={PROJECT} model={model([stuck])} colors={COLORS} brand={BRAND} />)

    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeEnabled()
    expect(
      screen.getByText(
        'This has been running for 11 minutes, longer than it should. It may have stopped. You can try again.',
      ),
    ).toBeInTheDocument()
  })

  it('unlocks on its own once the clock passes the limit', () => {
    vi.useFakeTimers()
    const nearly: SlotView = {
      ...stockSlot,
      job: { kind: 'refetch', startedAt: ago(10 * 60_000 - 5_000) },
    }
    render(
      <VisualBoard projectId={PROJECT} model={model([nearly])} colors={COLORS} brand={BRAND} />,
    )
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeDisabled()

    act(() => {
      vi.advanceTimersByTime(15_000)
    })
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeEnabled()
  })

  it('judges age by the server’s clock, so a wrong browser clock changes nothing', () => {
    vi.useFakeTimers()
    // The laptop thinks it is three months later than the server does.
    vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'))
    const fresh: SlotView = { ...stockSlot, job: { kind: 'refetch', startedAt: ago(60_000) } }
    render(<VisualBoard projectId={PROJECT} model={model([fresh])} colors={COLORS} brand={BRAND} />)
    act(() => {
      vi.advanceTimersByTime(15_000)
    })
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeDisabled()
  })

  it('says a redirect is running in its own words', () => {
    const redirecting: SlotView = {
      ...stockSlot,
      job: { kind: 'redirect', startedAt: ago(5_000) },
    }
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([redirecting])}
        colors={COLORS}
        brand={BRAND}
      />,
    )
    expect(
      screen.getByText(
        `Redirecting the scene without the likeness, started ${timecode(5_000)} ago.`,
      ),
    ).toBeInTheDocument()
  })

  it('locks the whole board while the shot list is re-planned', () => {
    const planned: SlotView = {
      ...stockSlot,
      status: 'unresolved',
      candidates: [],
      needsFetch: true,
    }
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([planned, { ...planned, id: SLOT_B }], {
          phase: 'plan',
          job: { op: 'shots', startedAt: ago(65_000) },
        })}
        colors={COLORS}
        brand={BRAND}
      />,
    )

    expect(
      screen.getByText(
        `Re-planning the shot list, started ${timecode(65_000)} ago. The plan below is replaced when it lands.`,
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Re-plan shot list/ })).toHaveAttribute(
      'aria-busy',
      'true',
    )
    expect(screen.getByRole('button', { name: /Fetch visuals/ })).toBeDisabled()
    for (const fetch of screen.getAllByRole('button', { name: 'Fetch this slot' })) {
      expect(fetch).toBeDisabled()
    }
  })

  it('says how many slots are still to land while Fetch visuals runs, and offers no second fetch', () => {
    const planned: SlotView = {
      ...stockSlot,
      status: 'unresolved',
      candidates: [],
      needsFetch: true,
    }
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([planned, { ...planned, id: SLOT_B }], { phase: 'plan', fetching: true })}
        colors={COLORS}
        brand={BRAND}
      />,
    )

    expect(screen.getByText('Fetching visuals: 2 slots still to land.')).toBeInTheDocument()
    expect(screen.queryByText(/Nothing has been fetched or generated yet/)).not.toBeInTheDocument()
    const fetch = screen.getByRole('button', { name: /Fetch visuals/ })
    expect(fetch).toBeDisabled()
    expect(fetch).toHaveAttribute('aria-busy', 'true')
  })

  it('counts running jobs as in progress and stuck ones as to look at on the chapter', () => {
    const running: SlotView = { ...stockSlot, job: { kind: 'refetch', startedAt: ago(1_000) } }
    const stuck: SlotView = {
      ...chartSlot,
      job: { kind: 'refetch', startedAt: ago(20 * 60_000) },
    }
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([running, stuck])}
        colors={COLORS}
        brand={BRAND}
      />,
    )
    const header = screen.getByRole('button', { name: /^Chapter 1/ })
    expect(header).toHaveTextContent('1 in progress')
    expect(header).toHaveTextContent('1 to look at')
  })
})
