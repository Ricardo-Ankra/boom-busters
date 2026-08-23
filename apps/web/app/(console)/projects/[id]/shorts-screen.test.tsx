import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShortCardModel } from '@/lib/shorts-review'
import { ShortsScreen } from './shorts-screen'

/**
 * The Shorts screen's cards (build spec section 11.3): segment source line,
 * editable title + description behind an explicit Save, the ending toggle
 * with its stale-render consequence, the two-step render button, the
 * related-link chip — all visible labelled buttons, nothing hidden.
 */

// project-controls (for useAction) drags '../actions' in, and with it
// next-auth — which cannot load under jsdom. Same mock the preview test uses.
vi.mock('../actions', () => ({
  approveGate: vi.fn(),
  stopProject: vi.fn(),
}))

const updateShortDetails = vi.fn()
const setShortEnding = vi.fn()
const setShortRelatedLink = vi.fn()
const requestShortRender = vi.fn()
vi.mock('./shorts-actions', () => ({
  updateShortDetails: (...args: unknown[]) => updateShortDetails(...args),
  setShortEnding: (...args: unknown[]) => setShortEnding(...args),
  setShortRelatedLink: (...args: unknown[]) => setShortRelatedLink(...args),
  requestShortRender: (...args: unknown[]) => requestShortRender(...args),
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
    chapterTitle: 'The audit',
    fromParagraph: 1,
    toParagraph: 2,
    durationMs: 42_000,
    estimatedCostUsd: 0.0117,
    render: null,
    ...overrides,
  }
}

function renderScreen(shorts: ShortCardModel[], live = false) {
  return render(<ShortsScreen projectId={PROJECT} shorts={shorts} live={live} />)
}

describe('ShortsScreen', () => {
  it('shows the segment source line with chapter, paragraphs and runtime', () => {
    renderScreen([card()])
    expect(screen.getByText('The audit · ¶2–3 · 0:42')).toBeInTheDocument()
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

  it('every action is a visible labelled button — no menus, no shortcuts', () => {
    renderScreen([card()])
    const scoped = within(screen.getByLabelText('Shorts'))
    // The full vocabulary of the card, on the card.
    expect(scoped.getByRole('button', { name: /render \(mock\)/i })).toBeInTheDocument()
    expect(scoped.getByRole('button', { name: 'Loop' })).toBeInTheDocument()
    expect(scoped.getByRole('button', { name: /related video link/i })).toBeInTheDocument()
  })
})
