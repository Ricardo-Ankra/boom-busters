import { voiceApprovalBlockedReason, voiceCoverage } from '@boom-busters/schemas'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TakeView, VoiceReviewModel } from '@/lib/voice-review'
import { VoiceReview } from './voice-review'

/**
 * The voice review screen's own behaviour.
 *
 * Everything here is unreachable from the E2E suite for the reason the gate
 * bar's tests give: flagging enqueues a retake through Inngest, and the E2E
 * runs without an Inngest Dev Server. So the branch after a *successful* flag —
 * the one a human takes a dozen times per listen-through — can only be covered
 * here.
 *
 * jsdom implements no audio pipeline, so `HTMLMediaElement.play` is stubbed.
 * That is the honest boundary of what a component test can say: it asserts
 * which take the screen asked to play, never that a sound came out.
 */

const flagVoiceTake = vi.fn()
const clearVoiceFlag = vi.fn()
const refresh = vi.fn()

vi.mock('./voice-actions', () => ({
  flagVoiceTake: (...args: unknown[]) => flagVoiceTake(...args),
  clearVoiceFlag: (...args: unknown[]) => clearVoiceFlag(...args),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

beforeEach(() => {
  vi.clearAllMocks()
  flagVoiceTake.mockResolvedValue({ ok: true })
  clearVoiceFlag.mockResolvedValue({ ok: true })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  Element.prototype.scrollIntoView = vi.fn()
})

function take(patch: Partial<TakeView> = {}): TakeView {
  return {
    id: 'take-1',
    takeNumber: 1,
    status: 'generated',
    durationMs: 8_400,
    waveform: [10, 40, 90, 30],
    note: null,
    hasAudio: true,
    ...patch,
  }
}

function model(patch: Partial<VoiceReviewModel> = {}): VoiceReviewModel {
  const chapters = patch.chapters ?? [
    {
      chapterId: 'c1',
      title: 'The audit',
      paragraphs: [
        {
          chapterId: 'c1',
          paragraphIndex: 0,
          text: 'The auditors signed it off for eighteen years.',
          current: take(),
          previous: undefined,
          takeCount: 1,
        },
        {
          chapterId: 'c1',
          paragraphIndex: 1,
          text: 'Nobody asked where the cash was.',
          current: take({ id: 'take-2' }),
          previous: undefined,
          takeCount: 1,
        },
      ],
    },
  ]

  const takes = chapters.flatMap((chapter) =>
    chapter.paragraphs
      .filter((paragraph) => paragraph.current !== undefined)
      .map((paragraph) => ({
        chapterId: chapter.chapterId,
        // The real index, not a constant: `voiceCoverage` keys on
        // `(chapterId, paragraphIndex)`, so a fixture that gave every paragraph
        // index 0 would collapse a whole chapter into one row and quietly
        // assert against a state the app can never be in.
        paragraphIndex: paragraph.paragraphIndex,
        takeNumber: paragraph.current!.takeNumber,
        status: paragraph.current!.status,
      })),
  )

  const expectedParagraphs =
    patch.expectedParagraphs ??
    chapters.reduce((total, chapter) => total + chapter.paragraphs.length, 0)

  return {
    chapters,
    coverage: voiceCoverage(takes),
    expectedParagraphs,
    totalDurationMs: 16_800,
    blockedReason: voiceApprovalBlockedReason(takes, expectedParagraphs),
    orphanedTakes: 0,
    ...patch,
  }
}

describe('VoiceReview', () => {
  it('shows every paragraph with its duration and take number', () => {
    render(<VoiceReview model={model()} />)

    expect(screen.getByText('The auditors signed it off for eighteen years.')).toBeInTheDocument()
    expect(screen.getAllByText('0:08')).toHaveLength(2)
    expect(screen.getAllByText(/take 1/)).toHaveLength(2)
  })

  it('states the coverage in words, not only as a bar', () => {
    // Section 11.1: state is never conveyed by colour or shape alone.
    render(<VoiceReview model={model()} />)
    expect(screen.getByText(/2 paragraphs · 2 generated/)).toBeInTheDocument()
  })

  it('says it is ready when nothing is flagged and nothing is missing', () => {
    render(<VoiceReview model={model()} />)
    expect(screen.getByText(/ready to approve/)).toBeInTheDocument()
  })

  it('says why it is not ready when a paragraph has no audio', () => {
    render(<VoiceReview model={model({ expectedParagraphs: 5 })} />)
    expect(screen.getByText('3 of 5 paragraphs have no audio yet.')).toBeInTheDocument()
  })

  describe('flagging', () => {
    it('requires a note before the retake can be queued', async () => {
      render(<VoiceReview model={model()} />)

      await userEvent.click(screen.getAllByRole('button', { name: /^Flag$/ })[0]!)
      // A retake with no direction is the same synthesis rolled again.
      expect(screen.getByRole('button', { name: 'Flag and retake' })).toBeDisabled()
    })

    it('sends the note with the take id and refreshes', async () => {
      render(<VoiceReview model={model()} />)

      await userEvent.click(screen.getAllByRole('button', { name: /^Flag$/ })[0]!)
      await userEvent.type(screen.getByLabelText('What was wrong with it?'), 'Swallowed a word.')
      await userEvent.click(screen.getByRole('button', { name: 'Flag and retake' }))

      expect(flagVoiceTake).toHaveBeenCalledWith('take-1', 'Swallowed a word.')
      expect(refresh).toHaveBeenCalled()
    })

    /**
     * Keeping the form open on failure is deliberate: the usual cause is the
     * orchestrator being unreachable, not the note, and discarding what the
     * user typed would make them write it again to find that out.
     */
    it('keeps the note on screen when the retake could not be queued', async () => {
      flagVoiceTake.mockResolvedValue({ ok: false, error: 'Inngest unreachable' })
      render(<VoiceReview model={model()} />)

      await userEvent.click(screen.getAllByRole('button', { name: /^Flag$/ })[0]!)
      await userEvent.type(screen.getByLabelText('What was wrong with it?'), 'Too fast.')
      await userEvent.click(screen.getByRole('button', { name: 'Flag and retake' }))

      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }))
      expect(screen.getByLabelText('What was wrong with it?')).toHaveValue('Too fast.')
    })

    it('offers to clear a flag rather than only to buy a replacement', async () => {
      const flagged = model({
        chapters: [
          {
            chapterId: 'c1',
            title: 'The audit',
            paragraphs: [
              {
                chapterId: 'c1',
                paragraphIndex: 0,
                text: 'One.',
                current: take({ status: 'flagged', note: 'Mispronounced Wirecard.' }),
                previous: undefined,
                takeCount: 1,
              },
            ],
          },
        ],
      })

      render(<VoiceReview model={flagged} />)

      expect(screen.getByText('Note: Mispronounced Wirecard.')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Clear the flag' }))
      expect(clearVoiceFlag).toHaveBeenCalledWith('take-1')
    })
  })

  describe('the A/B toggle', () => {
    const retaken = model({
      chapters: [
        {
          chapterId: 'c1',
          title: 'The audit',
          paragraphs: [
            {
              chapterId: 'c1',
              paragraphIndex: 0,
              text: 'One.',
              current: take({ id: 'take-2', takeNumber: 2, durationMs: 9_000 }),
              previous: take({ id: 'take-1', takeNumber: 1, status: 'flagged' }),
              takeCount: 2,
            },
          ],
        },
      ],
    })

    it('only appears once there is something to compare against', () => {
      render(<VoiceReview model={model()} />)
      expect(screen.queryByRole('button', { name: /Compare with take/ })).not.toBeInTheDocument()
    })

    it('switches the row to the earlier take and back', async () => {
      render(<VoiceReview model={retaken} />)

      expect(screen.getByText(/take 2 of 2/)).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Compare with take 1' }))
      expect(screen.getByText(/take 1 of 2/)).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Back to take 2' }))
      expect(screen.getByText(/take 2 of 2/)).toBeInTheDocument()
    })
  })

  describe('playback', () => {
    it('plays the take the row is showing', async () => {
      const { container } = render(<VoiceReview model={model()} />)

      await userEvent.click(screen.getAllByRole('button', { name: 'Play' })[0]!)

      expect(container.querySelector('audio')?.getAttribute('src')).toBe(
        '/api/voice-takes/take-1/audio',
      )
    })

    it('offers the three speeds the spec names, and records which is chosen', async () => {
      render(<VoiceReview model={model()} />)
      const speeds = screen.getByRole('group', { name: 'Playback speed' })

      expect(within(speeds).getByRole('button', { name: '1×' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )

      await userEvent.click(within(speeds).getByRole('button', { name: '1.5×' }))
      expect(within(speeds).getByRole('button', { name: '1.5×' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    })

    it('will not offer to play a take that has no audio', () => {
      const pending = model({
        chapters: [
          {
            chapterId: 'c1',
            title: 'The audit',
            paragraphs: [
              {
                chapterId: 'c1',
                paragraphIndex: 0,
                text: 'One.',
                current: take({ status: 'pending', hasAudio: false, durationMs: null }),
                previous: undefined,
                takeCount: 1,
              },
            ],
          },
        ],
      })

      render(<VoiceReview model={pending} />)
      expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled()
    })
  })

  it('warns when takes no longer match any paragraph', () => {
    // The script was edited after narration. Silently ignoring them would let
    // the coverage bar read complete while a flagged orphan blocked the gate
    // with no row on screen to unflag.
    render(<VoiceReview model={model({ orphanedTakes: 3 })} />)
    expect(screen.getByText(/3 takes no longer match any paragraph/)).toBeInTheDocument()
  })

  it('says so rather than rendering an empty accordion with no script', () => {
    render(<VoiceReview model={model({ chapters: [], expectedParagraphs: 0 })} />)
    expect(screen.getByText('There is no script to narrate yet.')).toBeInTheDocument()
  })
})
