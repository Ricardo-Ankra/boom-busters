import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShortCardModel, TeaserShotOption } from '@/lib/shorts-review'
import { ShortsScreen } from './shorts-screen'

/**
 * The Shorts screen's cards (build spec section 11.3): segment source line,
 * editable title + description behind an explicit Save, the ending toggle
 * with its stale-render consequence, the two-step render button, the
 * related-link chip — all visible labelled buttons, nothing hidden.
 */

// project-controls (for useAction) drags '../actions' in, and with it
// next-auth — which cannot load under jsdom. Same mock the preview test uses.
const restartStage = vi.fn()
vi.mock('../actions', () => ({
  approveGate: vi.fn(),
  stopProject: vi.fn(),
  restartStage: (...args: unknown[]) => restartStage(...args),
}))

const updateShortDetails = vi.fn()
const setShortEnding = vi.fn()
const setShortRelatedLink = vi.fn()
const requestShortRender = vi.fn()
const saveTeaserScript = vi.fn()
const saveTeaserShot = vi.fn()
const rebuildTeaser = vi.fn()
const assembleTeaser = vi.fn()
vi.mock('./shorts-actions', () => ({
  updateShortDetails: (...args: unknown[]) => updateShortDetails(...args),
  setShortEnding: (...args: unknown[]) => setShortEnding(...args),
  setShortRelatedLink: (...args: unknown[]) => setShortRelatedLink(...args),
  requestShortRender: (...args: unknown[]) => requestShortRender(...args),
  saveTeaserScript: (...args: unknown[]) => saveTeaserScript(...args),
  saveTeaserShot: (...args: unknown[]) => saveTeaserShot(...args),
  rebuildTeaser: (...args: unknown[]) => rebuildTeaser(...args),
  assembleTeaser: (...args: unknown[]) => assembleTeaser(...args),
}))

// The Continue-to-Publish handover lives in publish-actions, whose real
// module is server-only (storage, Inngest). Mocked like the others.
const advanceToPublish = vi.fn()
vi.mock('./publish-actions', () => ({
  advanceToPublish: (...args: unknown[]) => advanceToPublish(...args),
}))

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

/** The render-progress poll stays unavailable — cards answer from props. */
function pollFetch() {
  return Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as unknown as Response)
}

beforeEach(() => {
  vi.clearAllMocks()
  updateShortDetails.mockResolvedValue({ ok: true })
  setShortEnding.mockResolvedValue({ ok: true })
  setShortRelatedLink.mockResolvedValue({ ok: true })
  requestShortRender.mockResolvedValue({ ok: true })
  saveTeaserScript.mockResolvedValue({ ok: true })
  saveTeaserShot.mockResolvedValue({ ok: true })
  rebuildTeaser.mockResolvedValue({ ok: true })
  assembleTeaser.mockResolvedValue({ ok: true })
  vi.stubGlobal('fetch', vi.fn(pollFetch))
})

const PROJECT = '01J0000000000000000000000A'

function card(overrides: Partial<ShortCardModel> = {}): ShortCardModel {
  return {
    id: '01HQ00000000000000000000S1',
    title: 'EY refused to sign the accounts.',
    description: '',
    ending: 'cta',
    relatedLinkChecked: false,
    kind: 'excerpt',
    chapterTitle: 'The audit',
    fromParagraph: 1,
    toParagraph: 2,
    durationMs: 42_000,
    estimatedCostUsd: 0.0117,
    render: null,
    teaser: null,
    ...overrides,
  }
}

/** A minimal, schema-valid master slot for the picker fixtures. */
function poolSlot(r2Key: string): TeaserShotOption['slot'] {
  return {
    type: 'stock',
    startMs: 0,
    durationMs: 5000,
    transition: 'cut',
    motion: { kind: 'static' },
    payload: { kind: 'image', src: { r2Key } },
  }
}

/** A teaser card with a stored script, voice state and shot pool (230). */
function teaserCard(overrides: Partial<ShortCardModel> = {}): ShortCardModel {
  return card({
    kind: 'teaser',
    durationMs: 32_000,
    teaser: {
      hasScript: true,
      beats: [
        {
          text: 'One number was missing, and it was billions.',
          chapterIndex: 0,
          chapterTitle: 'The audit',
          audioUrl: 'https://r2.example.com/beat-0.wav',
          durationMs: 4200,
          voiced: true,
          auto: { kind: 'image', url: 'https://r2.example.com/auto-0.png' },
          autoSelected: true,
          pool: [
            {
              kind: 'image',
              url: 'https://r2.example.com/shot-a.png',
              slot: poolSlot('boom-busters/stills/a.png'),
              selected: false,
            },
            {
              kind: 'chart',
              url: null,
              slot: poolSlot('boom-busters/stills/b.png'),
              selected: false,
            },
          ],
        },
        {
          text: 'The auditors finally refused to sign anything at all.',
          chapterIndex: 0,
          chapterTitle: 'The audit',
          audioUrl: null,
          durationMs: 5100,
          voiced: true,
          auto: null,
          autoSelected: true,
          pool: [],
        },
      ],
    },
    ...overrides,
  })
}

function renderScreen(shorts: ShortCardModel[], live = false) {
  return render(<ShortsScreen projectId={PROJECT} shorts={shorts} live={live} />)
}

describe('ShortsScreen', () => {
  it('shows the segment source line with chapter, paragraphs and runtime', () => {
    renderScreen([card()])
    expect(screen.getByText('The audit · ¶2–3 · 0:42')).toBeInTheDocument()
  })

  it('labels a teaser and says where its narration comes from', () => {
    renderScreen([card({ kind: 'teaser', durationMs: 32_000 })])
    expect(screen.getByText('Teaser')).toBeInTheDocument()
    expect(
      screen.getByText('Teaser · its own narration, cut over the board · 0:32'),
    ).toBeInTheDocument()
  })

  it('saving the title and description is an explicit act, not an autosave', async () => {
    const user = userEvent.setup()
    renderScreen([card()])

    // No save offered until something changed.
    expect(screen.queryByRole('button', { name: /save title/i })).not.toBeInTheDocument()

    await user.clear(screen.getByLabelText('Title'))
    await user.type(screen.getByLabelText('Title'), 'The auditor said no')
    await user.type(screen.getByLabelText('Description'), 'Wirecard in 60 seconds.')
    await user.click(screen.getByRole('button', { name: /save title & description/i }))

    expect(updateShortDetails).toHaveBeenCalledWith('01HQ00000000000000000000S1', {
      title: 'The auditor said no',
      description: 'Wirecard in 60 seconds.',
    })
  })

  it('rendering is a two-step with the cost as the consequence', async () => {
    const user = userEvent.setup()
    renderScreen([card()], true)

    await user.click(screen.getByRole('button', { name: 'Render · est. $0.01' }))
    expect(requestShortRender).not.toHaveBeenCalled()
    expect(screen.getByText(/Renders this Short on Remotion Lambda/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Start the render' }))
    expect(requestShortRender).toHaveBeenCalledWith('01HQ00000000000000000000S1')
  })

  it('an unrendered card switches its ending without ceremony', async () => {
    const user = userEvent.setup()
    renderScreen([card({ render: null })])

    await user.click(screen.getByRole('button', { name: 'Loop' }))
    expect(setShortEnding).toHaveBeenCalledWith('01HQ00000000000000000000S1', 'loop')
  })

  it('a rendered card warns that switching the ending stales the render', async () => {
    const user = userEvent.setup()
    renderScreen([
      card({
        render: {
          id: '01HQ00000000000000000000R1',
          status: 'done',
          progressPct: 100,
          costUsd: '0.0117',
          error: null,
        },
      }),
    ])

    await user.click(screen.getByRole('button', { name: 'Loop' }))
    expect(setShortEnding).not.toHaveBeenCalled()
    expect(screen.getByText(/will need re-rendering/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Switch to loop' }))
    expect(setShortEnding).toHaveBeenCalledWith('01HQ00000000000000000000S1', 'loop')
  })

  it('an in-flight render shows progress and hides the render button', () => {
    renderScreen([
      card({
        render: {
          id: '01HQ00000000000000000000R1',
          status: 'rendering',
          progressPct: 40,
          costUsd: '0.0117',
          error: null,
        },
      }),
    ])

    expect(screen.getByText('Rendering 40%')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /render/i })).not.toBeInTheDocument()
  })

  it('a failed render says why, beside the button that retries it', () => {
    renderScreen([
      card({
        render: {
          id: '01HQ00000000000000000000R1',
          status: 'failed',
          progressPct: 0,
          costUsd: '0.0117',
          error: { message: 'timeout: render timeout' },
        },
      }),
    ])

    expect(screen.getByText(/The render failed: timeout: render timeout/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /render again/i })).toBeInTheDocument()
  })

  it('the related-link chip records the Studio act and reads back', async () => {
    const user = userEvent.setup()
    renderScreen([card()])

    const chip = screen.getByRole('button', { name: /set related video link in studio/i })
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    await user.click(chip)
    expect(setShortRelatedLink).toHaveBeenCalledWith('01HQ00000000000000000000S1', true)
  })

  it('offers Continue to Publish only while the project owns this stage', async () => {
    const user = userEvent.setup()
    const { rerender } = renderScreen([card()])
    expect(screen.queryByRole('button', { name: /continue to publish/i })).not.toBeInTheDocument()

    rerender(<ShortsScreen projectId={PROJECT} shorts={[card()]} live={false} canAdvance />)
    advanceToPublish.mockResolvedValue({ ok: true })
    await user.click(screen.getByRole('button', { name: /continue to publish/i }))
    expect(advanceToPublish).toHaveBeenCalledWith(PROJECT)
  })

  it('the curation footer can re-run the stage, and says the cards are kept', async () => {
    // Without this button the curation state had no way to run the stage:
    // the header shows no restart while there is something to curate, and
    // the only path was a detour through Publish and back (owner report,
    // 2026-09-08).
    const user = userEvent.setup()
    render(<ShortsScreen projectId={PROJECT} shorts={[card()]} live={false} canAdvance />)

    await user.click(screen.getByRole('button', { name: /run the shorts stage again/i }))
    expect(restartStage).not.toHaveBeenCalled()
    expect(screen.getByText(/Your cards are kept exactly as curated/)).toBeInTheDocument()

    restartStage.mockResolvedValue({ ok: true })
    await user.click(screen.getByRole('button', { name: 'Run it again' }))
    expect(restartStage).toHaveBeenCalledWith(PROJECT, 'shorts')
  })

  it('only a teaser offers the studio, and opening it shows the beats', async () => {
    const user = userEvent.setup()
    renderScreen([card(), teaserCard({ id: '01HQ00000000000000000000T1' })])

    const open = screen.getAllByRole('button', { name: 'Open the teaser studio' })
    expect(open).toHaveLength(1)
    await user.click(open[0]!)

    expect(screen.getByLabelText('Teaser studio')).toBeInTheDocument()
    expect(
      screen.getByDisplayValue('One number was missing, and it was billions.'),
    ).toBeInTheDocument()
    expect(screen.getByText(/Beat 1 · cut over The audit/)).toBeInTheDocument()
    // Voiced audio plays inline; a beat without a playable file says so.
    expect(screen.getByLabelText('Beat 1 audio')).toBeInTheDocument()
    expect(screen.getByText(/No playable audio for this beat/)).toBeInTheDocument()
  })

  it('editing a beat offers an explicit Save that stores the whole script', async () => {
    const user = userEvent.setup()
    renderScreen([teaserCard({ id: '01HQ00000000000000000000T1' })])
    await user.click(screen.getByRole('button', { name: 'Open the teaser studio' }))

    // Nothing changed yet: no save; voicing and assembling are on offer.
    expect(screen.queryByRole('button', { name: 'Save the script' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /voice the script/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /assemble & render/i })).toBeInTheDocument()

    const beat = screen.getByLabelText('Beat 1 words')
    await user.clear(beat)
    await user.type(beat, 'Nine days was all it took to erase the company.')

    // Dirty: both acts step aside until the edit is stored.
    expect(screen.queryByRole('button', { name: /voice the script/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /assemble & render/i })).not.toBeInTheDocument()
    expect(screen.getByText(/Save first/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save the script' }))
    expect(saveTeaserScript).toHaveBeenCalledWith('01HQ00000000000000000000T1', [
      { text: 'Nine days was all it took to erase the company.', chapterIndex: 0 },
      { text: 'The auditors finally refused to sign anything at all.', chapterIndex: 0 },
    ])
  })

  it('Voice the script is a two-step, and says what is re-billed', async () => {
    const user = userEvent.setup()
    renderScreen([teaserCard({ id: '01HQ00000000000000000000T1' })], true)
    await user.click(screen.getByRole('button', { name: 'Open the teaser studio' }))

    await user.click(screen.getByRole('button', { name: 'Voice the script' }))
    expect(rebuildTeaser).not.toHaveBeenCalled()
    expect(screen.getByText(/unchanged text is re-served free/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Synthesise the beats' }))
    expect(rebuildTeaser).toHaveBeenCalledWith('01HQ00000000000000000000T1')
  })

  it('picking a shot stores the snapshot; Auto clears back to the board pick', async () => {
    const user = userEvent.setup()
    renderScreen([teaserCard({ id: '01HQ00000000000000000000T1' })])
    await user.click(screen.getByRole('button', { name: 'Open the teaser studio' }))

    await user.click(screen.getByRole('button', { name: 'Beat 1 shot option 1 (image)' }))
    expect(saveTeaserShot).toHaveBeenCalledWith(
      '01HQ00000000000000000000T1',
      0,
      expect.objectContaining({ payload: expect.objectContaining({ kind: 'image' }) }),
    )

    await user.click(screen.getByRole('button', { name: 'Auto' }))
    expect(saveTeaserShot).toHaveBeenCalledWith('01HQ00000000000000000000T1', 0, null)
  })

  it('Assemble & render is the free compile plus the render spend, confirmed', async () => {
    const user = userEvent.setup()
    renderScreen([teaserCard({ id: '01HQ00000000000000000000T1' })], true)
    await user.click(screen.getByRole('button', { name: 'Open the teaser studio' }))

    await user.click(screen.getByRole('button', { name: 'Assemble & render' }))
    expect(assembleTeaser).not.toHaveBeenCalled()
    expect(screen.getByText(/renders on Remotion Lambda/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cut it and start the render' }))
    expect(assembleTeaser).toHaveBeenCalledWith('01HQ00000000000000000000T1')
  })

  it('a pre-studio teaser explains itself and offers only the voicing', async () => {
    const user = userEvent.setup()
    renderScreen([
      teaserCard({ id: '01HQ00000000000000000000T1', teaser: { hasScript: false, beats: [] } }),
    ])
    await user.click(screen.getByRole('button', { name: 'Open the teaser studio' }))

    expect(screen.getByText(/predates the studio/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save the script' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /assemble & render/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /voice the script/i })).toBeInTheDocument()
  })

  it('every action is a visible labelled button — no menus, no shortcuts', () => {
    renderScreen([card()])
    const scoped = within(screen.getByLabelText('Shorts'))
    // The full vocabulary of the card, on the card.
    expect(scoped.getByRole('button', { name: /render \(mock\)/i })).toBeInTheDocument()
    expect(scoped.getByRole('button', { name: 'Loop' })).toBeInTheDocument()
    expect(scoped.getByRole('button', { name: /related video link/i })).toBeInTheDocument()
  })
})
