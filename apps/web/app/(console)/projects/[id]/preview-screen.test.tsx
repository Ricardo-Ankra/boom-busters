import { DEFAULT_SETTINGS, resolveBrandKit } from '@boom-busters/schemas'
import type { Timeline } from '@boom-busters/schemas'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PreviewScreen } from './preview-screen'
import type { PreviewDraftProp, PreviewRenderProp } from './preview-screen'

/**
 * The preview screen's controls (build spec section 11.3): stats, chapter
 * seeking, the caption toggle, the gain line, the music picker and the
 * two-step Render master. The Player itself is mocked — jsdom has no frames
 * to draw; the compositions' own rendering is covered by the snapshot suite.
 */

vi.mock('@remotion/player', () => ({
  Player: Object.assign(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ durationInFrames, inputProps }: any) => (
      <div data-testid="player">
        frames:{durationInFrames} narration0:{inputProps.timeline.narration[0]?.url}
      </div>
    ),
    { displayName: 'Player' },
  ),
}))
vi.mock('@boom-busters/compositions', () => ({ DocumentaryMaster: () => null }))

/** The render-progress poll stays unavailable — cards answer from props. */
function pollFetch() {
  return Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as unknown as Response)
}

const approveGate = vi.fn()
const stopProject = vi.fn()
vi.mock('../actions', () => ({
  approveGate: (...args: unknown[]) => approveGate(...args),
  stopProject: (...args: unknown[]) => stopProject(...args),
}))

const chooseMusicBed = vi.fn()
const requestDraftRender = vi.fn()
vi.mock('./preview-actions', () => ({
  chooseMusicBed: (...args: unknown[]) => chooseMusicBed(...args),
  requestDraftRender: (...args: unknown[]) => requestDraftRender(...args),
}))

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

beforeEach(() => {
  vi.clearAllMocks()
  approveGate.mockResolvedValue({ ok: true })
  stopProject.mockResolvedValue({ ok: true })
  chooseMusicBed.mockResolvedValue({ ok: true })
  requestDraftRender.mockResolvedValue({ ok: true })
  vi.stubGlobal('fetch', vi.fn(pollFetch))
})

const PROJECT = '01J0000000000000000000000A'
const CHAPTER_ONE = '01HQ0000000000000000000CH1'
const CHAPTER_TWO = '01HQ0000000000000000000CH2'

function materialisedTimeline(): Timeline {
  return {
    version: 1,
    fps: 30,
    width: 1920,
    height: 1080,
    brand: resolveBrandKit(DEFAULT_SETTINGS),
    narration: [
      {
        r2Key: 'mock://voice/t1.wav',
        url: 'http://localhost:3000/api/voice-takes/t1/audio',
        startMs: 0,
        durationMs: 8000,
        chapterId: CHAPTER_ONE,
        paragraphIndex: 0,
      },
      {
        r2Key: 'mock://voice/t2.wav',
        url: 'http://localhost:3000/api/voice-takes/t2/audio',
        startMs: 8000,
        durationMs: 6000,
        chapterId: CHAPTER_TWO,
        paragraphIndex: 0,
      },
    ],
    music: {
      r2Key: 'boom-busters/music/bed.mp3',
      url: 'https://r2.example.com/bed.mp3',
      gainDb: -25,
      duckingCurve: [
        { tMs: 0, gainDb: -25 },
        { tMs: 500, gainDb: -37 },
        { tMs: 13_000, gainDb: -25 },
      ],
      cuePoints: [{ tMs: 0, style: 'chapter' }],
    },
    captions: { words: [], style: 'karaoke' },
    slots: [
      {
        type: 'chart',
        startMs: 0,
        durationMs: 14_000,
        transition: 'cut',
        motion: { kind: 'draw-on' },
        payload: {
          kind: 'chart',
          chartKind: 'line',
          series: [
            {
              label: 'Price',
              unit: '€',
              points: [
                { x: 'A', y: 104 },
                { x: 'B', y: 1.28 },
              ],
            },
          ],
          dataRefs: ['01HQ00000000000000000000AA'],
          takeaway: 'Gone.',
          reveal: 'draw-on',
        },
      },
    ],
    overlays: [],
  }
}

function props(overrides: Partial<Parameters<typeof PreviewScreen>[0]> = {}) {
  return {
    projectId: PROJECT,
    timeline: materialisedTimeline(),
    dropped: { narration: 0, slots: 0, music: false },
    chapters: [
      { title: 'The audit', startMs: 0, durationMs: 8000 },
      { title: 'The collapse', startMs: 8000, durationMs: 6000 },
    ],
    version: 2,
    slotCount: 1,
    beds: [
      { r2Key: 'boom-busters/music/bed.mp3', title: 'Tension bed' },
      { r2Key: 'boom-busters/music/alt.mp3', title: 'Calm bed' },
    ],
    currentBedKey: 'boom-busters/music/bed.mp3',
    estimatedCostUsd: 0.24,
    estimatedDraftCostUsd: 0.06,
    live: true,
    atGate: true,
    render: null,
    draft: null,
    ...overrides,
  }
}

describe('PreviewScreen', () => {
  it('shows the player, the stats and the chapter runtimes', () => {
    render(<PreviewScreen {...props()} />)
    // 14 s at 30 fps.
    expect(screen.getByTestId('player')).toHaveTextContent('frames:420')
    expect(screen.getByText(/Timeline v2/)).toBeInTheDocument()
    expect(screen.getByText(/0:14 · 1 slots · 2 chapters/)).toBeInTheDocument()
    // Once in the stats card, once as a chapter seek button.
    expect(screen.getAllByText(/1\. The audit/)).toHaveLength(2)
    expect(screen.getAllByText(/2\. The collapse/)).toHaveLength(2)
  })

  it('toggles captions with a labelled button', async () => {
    const user = userEvent.setup()
    render(<PreviewScreen {...props()} />)
    await user.click(screen.getByRole('button', { name: /Hide captions/ }))
    expect(screen.getByRole('button', { name: /Show captions/ })).toBeInTheDocument()
  })

  it('hands the player the materialised URLs directly — no buffer step', () => {
    render(<PreviewScreen {...props()} />)
    expect(screen.getByTestId('player')).toHaveTextContent(
      'narration0:http://localhost:3000/api/voice-takes/t1/audio',
    )
    expect(screen.queryByRole('button', { name: /Buffer/ })).not.toBeInTheDocument()
  })

  it('draws the gain line for a timeline with music, and says so without one', () => {
    const { unmount } = render(<PreviewScreen {...props()} />)
    expect(screen.getByText(/Music bed level — it ducks under the narration/)).toBeInTheDocument()
    unmount()

    const silent = materialisedTimeline()
    silent.music = null
    render(<PreviewScreen {...props({ timeline: silent, currentBedKey: null })} />)
    expect(screen.getByText(/No music bed on this timeline/)).toBeInTheDocument()
  })

  it('swaps a bed through the picker and marks the current one', async () => {
    const user = userEvent.setup()
    render(<PreviewScreen {...props()} />)

    expect(screen.getByText('Current')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Use this bed/ }))
    expect(chooseMusicBed).toHaveBeenCalledWith(PROJECT, 'boom-busters/music/alt.mp3')
  })

  it('renders the master only through the two-step confirm, with the cost on both steps', async () => {
    const user = userEvent.setup()
    render(<PreviewScreen {...props()} />)

    const button = screen.getByRole('button', { name: /Render master · est\. \$0\.24/ })
    await user.click(button)
    expect(approveGate).not.toHaveBeenCalled()

    // The section 8.1 truth is on the confirm itself.
    expect(screen.getByText(/Once started it cannot be aborted/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Render now$/ }))
    expect(approveGate).toHaveBeenCalledWith(PROJECT, 'preview')
  })

  it('says why there is no render button when the gate is closed', () => {
    render(<PreviewScreen {...props({ atGate: false })} />)
    expect(screen.queryByRole('button', { name: /Render master/ })).not.toBeInTheDocument()
    expect(screen.getByText(/no run waiting to render/)).toBeInTheDocument()
  })

  it('shows progress and the honest Stop while a render is in flight', async () => {
    const user = userEvent.setup()
    const render_: PreviewRenderProp = {
      id: '01J0000000000000000000000B',
      status: 'rendering',
      progressPct: 40,
      costUsd: '0.24',
      qcReport: null,
      error: null,
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      completedAt: null,
    }
    render(<PreviewScreen {...props({ render: render_ })} />)

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40')
    await user.click(screen.getByRole('button', { name: /Stop/ }))
    // Spec section 8.1, verbatim.
    expect(
      screen.getByText(/Render can't be aborted mid-flight; it will finish in the background/),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Stop the run/ }))
    expect(stopProject).toHaveBeenCalledWith(PROJECT)
  })

  it('offers draft and master side by side, each behind its own confirm', async () => {
    const user = userEvent.setup()
    render(<PreviewScreen {...props()} />)

    // Both spend choices live in the one render card.
    expect(screen.getByRole('button', { name: /Render master · est\. \$0\.24/ })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: /Render draft · est\. \$0\.06/ }))
    expect(requestDraftRender).not.toHaveBeenCalled()
    expect(screen.getByText(/half resolution, est\. \$0\.06/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Render draft$/ }))
    expect(requestDraftRender).toHaveBeenCalledWith(PROJECT)
    // The master path was never touched.
    expect(approveGate).not.toHaveBeenCalled()
  })

  it('offers no draft button in mock mode — no broker, no drafts', () => {
    render(<PreviewScreen {...props({ live: false })} />)
    expect(screen.queryByRole('button', { name: /Render draft/ })).not.toBeInTheDocument()
    // The master button still renders locally for free.
    expect(screen.getByRole('button', { name: /Render master/ })).toBeEnabled()
  })

  it('shows draft progress while one is rendering, and hides its button', () => {
    const draft: PreviewDraftProp = {
      id: '01J0000000000000000000000C',
      status: 'rendering',
      progressPct: 55,
      costUsd: '0.06',
      qcReport: null,
      error: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
      timelineVersion: 2,
    }
    render(<PreviewScreen {...props({ draft })} />)

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '55')
    expect(screen.getByText(/Rendering draft… 55%/)).toBeInTheDocument()
    // No second draft while one is in flight.
    expect(screen.queryByRole('button', { name: /Render draft/ })).not.toBeInTheDocument()
  })

  it('says when the draft is a version behind the timeline', () => {
    const draft: PreviewDraftProp = {
      id: '01J0000000000000000000000C',
      status: 'done',
      progressPct: 100,
      costUsd: '0.06',
      qcReport: null,
      error: null,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      timelineVersion: 1,
    }
    render(<PreviewScreen {...props({ draft })} />)

    // The timeline is v2; the draft rendered v1 (a music swap in between).
    expect(screen.getByText(/moved on to v2/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Render draft · est\. \$0\.06/ })).toBeEnabled()
  })

  it('a failed draft is a note beside the retry button, not a lingering card', () => {
    const draft: PreviewDraftProp = {
      id: '01J0000000000000000000000C',
      status: 'failed',
      progressPct: 0,
      costUsd: '0.06',
      qcReport: null,
      error: { message: 'render timeout' },
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      timelineVersion: 2,
    }
    render(<PreviewScreen {...props({ draft })} />)

    // No Draft card — nothing to show or play.
    expect(screen.queryByText(/^Draft$/)).not.toBeInTheDocument()
    // The reason sits in the render card, next to the button that retries.
    expect(screen.getByText(/The last draft failed: render timeout/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Render draft · est\. \$0\.06/ })).toBeEnabled()
    // The master's invoke path is untouched by an advisory failure.
    expect(screen.getByRole('button', { name: /Render master · est\. \$0\.24/ })).toBeEnabled()
  })

  it('shows the QC report card for a finished render', () => {
    const render_: PreviewRenderProp = {
      id: '01J0000000000000000000000B',
      status: 'done',
      progressPct: 100,
      costUsd: '0.24',
      qcReport: {
        passed: false,
        integratedLufs: -11.2,
        issues: [
          { kind: 'silence', atMs: 62_000, durationMs: 3100, detail: '3.1 s of silence' },
          { kind: 'loudness', atMs: 0, detail: 'Integrated -11.2 LUFS vs target -14' },
        ],
      },
      error: null,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    }
    render(<PreviewScreen {...props({ render: render_, atGate: false })} />)

    const card = screen.getByTestId('qc-report')
    expect(within(card).getByText('Failed')).toBeInTheDocument()
    expect(within(card).getByText('1:02')).toBeInTheDocument()
    expect(within(card).getByText(/3.1 s of silence/)).toBeInTheDocument()
    expect(within(card).getByText('-11.2 LUFS')).toBeInTheDocument()
  })
})
