import { voiceApprovalBlockedReason, voiceCoverage } from '@boom-busters/schemas'
import { fireEvent, render, screen, within } from '@testing-library/react'
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
const rereadParagraph = vi.fn()
const retakeVoiceTake = vi.fn()
const clearVoiceFlag = vi.fn()
const refresh = vi.fn()

vi.mock('./voice-actions', () => ({
  flagVoiceTake: (...args: unknown[]) => flagVoiceTake(...args),
  rereadParagraph: (...args: unknown[]) => rereadParagraph(...args),
  retakeVoiceTake: (...args: unknown[]) => retakeVoiceTake(...args),
  clearVoiceFlag: (...args: unknown[]) => clearVoiceFlag(...args),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

beforeEach(() => {
  vi.clearAllMocks()
  flagVoiceTake.mockResolvedValue({ ok: true })
  rereadParagraph.mockResolvedValue({ ok: true })
  retakeVoiceTake.mockResolvedValue({ ok: true })
  clearVoiceFlag.mockResolvedValue({ ok: true })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
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
          stale: false,
        },
        {
          chapterId: 'c1',
          paragraphIndex: 1,
          text: 'Nobody asked where the cash was.',
          current: take({ id: 'take-2' }),
          previous: undefined,
          takeCount: 1,
          stale: false,
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
    unit: 'paragraph',
    staleParagraphs: chapters.reduce(
      (total, chapter) => total + chapter.paragraphs.filter((paragraph) => paragraph.stale).length,
      0,
    ),
    // The narrator in production is Cloud TTS, which cannot vary a re-read, so
    // that is the default a fixture should describe. The tests that care about
    // "read it again" turn it on explicitly.
    rereadCanDiffer: false,
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

  it('calls the rows scenes when the narrator reads scene by scene', () => {
    // On Gemini a unit is a scene, and the screen must not miscount it as
    // paragraphs — the whole point of the unit is that one row is one request.
    render(<VoiceReview model={model({ unit: 'scene' })} />)
    expect(screen.getByText(/2 scenes · 2 generated/)).toBeInTheDocument()
    expect(screen.getByText('§1')).toBeInTheDocument()
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
    it('requires a note, so the row still means something a week later', async () => {
      render(<VoiceReview model={model()} />)

      await userEvent.click(screen.getAllByRole('button', { name: /^Flag$/ })[0]!)
      expect(screen.getByRole('button', { name: 'Flag this take' })).toBeDisabled()
    })

    /**
     * Flagging used to enqueue a retake in the same press. On a narrator that
     * cannot vary a re-read that was a charge for the take just rejected, and
     * the note explaining what was wrong never left the database.
     */
    it('costs nothing: no synthesis is asked for', async () => {
      render(<VoiceReview model={model()} />)

      await userEvent.click(screen.getAllByRole('button', { name: /^Flag$/ })[0]!)
      await userEvent.type(screen.getByLabelText('What was wrong with it?'), 'Too fast.')
      await userEvent.click(screen.getByRole('button', { name: 'Flag this take' }))

      expect(flagVoiceTake).toHaveBeenCalled()
      expect(retakeVoiceTake).not.toHaveBeenCalled()
      expect(rereadParagraph).not.toHaveBeenCalled()
    })

    it('sends the note with the take id and refreshes', async () => {
      render(<VoiceReview model={model()} />)

      await userEvent.click(screen.getAllByRole('button', { name: /^Flag$/ })[0]!)
      await userEvent.type(screen.getByLabelText('What was wrong with it?'), 'Swallowed a word.')
      await userEvent.click(screen.getByRole('button', { name: 'Flag this take' }))

      expect(flagVoiceTake).toHaveBeenCalledWith('take-1', 'Swallowed a word.')
      expect(refresh).toHaveBeenCalled()
    })

    /**
     * Keeping the form open on failure is deliberate: the usual cause is the
     * orchestrator being unreachable, not the note, and discarding what the
     * user typed would make them write it again to find that out.
     */
    it('keeps the note on screen when the flag could not be saved', async () => {
      flagVoiceTake.mockResolvedValue({ ok: false, error: 'Database unreachable' })
      render(<VoiceReview model={model()} />)

      await userEvent.click(screen.getAllByRole('button', { name: /^Flag$/ })[0]!)
      await userEvent.type(screen.getByLabelText('What was wrong with it?'), 'Too fast.')
      await userEvent.click(screen.getByRole('button', { name: 'Flag this take' }))

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
                stale: false,
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

  /**
   * The two repairs, and which narrator gets which.
   *
   * The distinction is not cosmetic. On a provider that reads identical text
   * identically, "read it again" is a charge for the take the human just
   * rejected — so the button is not there, and the one that changes the words
   * is, because the words are the only lever that exists.
   */
  describe('repairing a flagged take', () => {
    function flaggedModel(patch: Partial<VoiceReviewModel> = {}): VoiceReviewModel {
      return model({
        chapters: [
          {
            chapterId: 'c1',
            title: 'The audit',
            paragraphs: [
              {
                chapterId: 'c1',
                paragraphIndex: 0,
                text: 'The auditors signed it off for eighteen years, nobody asked where the cash was.',
                current: take({ status: 'flagged', note: 'Ran the two halves together.' }),
                previous: undefined,
                takeCount: 1,
                stale: false,
              },
            ],
          },
        ],
        ...patch,
      })
    }

    it('offers to fix the words on every narrator', async () => {
      render(<VoiceReview model={flaggedModel()} />)
      expect(screen.getByRole('button', { name: 'Fix the words' })).toBeInTheDocument()
    })

    /**
     * The repair is not behind the flag, which it briefly was.
     *
     * Requiring a verdict and a typed note before you may change a word is
     * ceremony rather than safety: the protection a flag gives at the gate is
     * already given by the re-read itself, since the new take is `pending` and
     * `voiceApprovalBlockedReason` refuses approval while anything is pending.
     */
    it('offers to fix the words without flagging first', async () => {
      render(<VoiceReview model={model()} />)

      const [first] = screen.getAllByRole('button', { name: 'Fix the words' })
      expect(first).toBeInTheDocument()

      await userEvent.click(first!)
      expect(screen.getByLabelText('The words, as they should be read')).toBeInTheDocument()
      expect(flagVoiceTake).not.toHaveBeenCalled()
    })

    it('will not offer to repair a paragraph that has no audio yet', async () => {
      const silent = model({
        chapters: [
          {
            chapterId: 'c1',
            title: 'The audit',
            paragraphs: [
              {
                chapterId: 'c1',
                paragraphIndex: 0,
                text: 'One.',
                current: take({ status: 'pending', hasAudio: false }),
                previous: undefined,
                takeCount: 1,
                stale: false,
              },
            ],
          },
        ],
        rereadCanDiffer: true,
      })

      render(<VoiceReview model={silent} />)

      expect(screen.getByRole('button', { name: 'Fix the words' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Another take' })).toBeDisabled()
    })

    it('does not offer another take when the reading cannot differ', async () => {
      render(<VoiceReview model={flaggedModel({ rereadCanDiffer: false })} />)
      expect(screen.queryByRole('button', { name: /another take/i })).toBeNull()
    })

    /**
     * The flag note is the direction: what was wrong with the take is exactly
     * what the narrator should be told to do differently. On Gemini it lands
     * in the prompt as director's notes.
     */
    it('prefills the direction with the flag note and sends it with the retake', async () => {
      render(<VoiceReview model={flaggedModel({ rereadCanDiffer: true })} />)

      await userEvent.click(screen.getByRole('button', { name: 'Another take' }))

      const box = screen.getByLabelText('Direction for this take (optional)')
      expect(box).toHaveValue('Ran the two halves together.')

      await userEvent.click(screen.getByRole('button', { name: 'Record another take' }))
      expect(retakeVoiceTake).toHaveBeenCalledWith('take-1', 'Ran the two halves together.')
    })

    it('re-rolls without direction when the box is left empty', async () => {
      render(<VoiceReview model={model({ rereadCanDiffer: true })} />)

      await userEvent.click(screen.getAllByRole('button', { name: 'Another take' })[0]!)

      const box = screen.getByLabelText('Direction for this take (optional)')
      expect(box).toHaveValue('')

      await userEvent.click(screen.getByRole('button', { name: 'Record another take' }))
      expect(retakeVoiceTake).toHaveBeenCalledWith('take-1', undefined)
    })

    it('opens the words for editing, prefilled with what was read', async () => {
      render(<VoiceReview model={flaggedModel()} />)

      await userEvent.click(screen.getByRole('button', { name: 'Fix the words' }))
      expect(screen.getByLabelText('The words, as they should be read')).toHaveValue(
        'The auditors signed it off for eighteen years, nobody asked where the cash was.',
      )
    })

    it('will not spend on words that did not change', async () => {
      render(<VoiceReview model={flaggedModel()} />)

      await userEvent.click(screen.getByRole('button', { name: 'Fix the words' }))
      // Untouched: same words, and on this narrator the same reading.
      expect(screen.getByRole('button', { name: 'Save and re-read' })).toBeDisabled()
    })

    it('sends the edited paragraph and refreshes', async () => {
      render(<VoiceReview model={flaggedModel()} />)

      await userEvent.click(screen.getByRole('button', { name: 'Fix the words' }))
      const box = screen.getByLabelText('The words, as they should be read')
      await userEvent.clear(box)
      await userEvent.type(box, 'The auditors signed it off for eighteen years. Nobody asked.')
      await userEvent.click(screen.getByRole('button', { name: 'Save and re-read' }))

      expect(rereadParagraph).toHaveBeenCalledWith(
        'take-1',
        'The auditors signed it off for eighteen years. Nobody asked.',
      )
      expect(refresh).toHaveBeenCalled()
    })

    it('keeps the draft when the re-read is refused', async () => {
      rereadParagraph.mockResolvedValue({ ok: false, error: 'A paragraph cannot be split in two.' })
      render(<VoiceReview model={flaggedModel()} />)

      await userEvent.click(screen.getByRole('button', { name: 'Fix the words' }))
      const box = screen.getByLabelText('The words, as they should be read')
      await userEvent.clear(box)
      await userEvent.type(box, 'Rewritten.')
      await userEvent.click(screen.getByRole('button', { name: 'Save and re-read' }))

      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error' }))
      expect(screen.getByLabelText('The words, as they should be read')).toHaveValue('Rewritten.')
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
              stale: false,
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

    it("a row's play ends with its paragraph instead of rolling on", async () => {
      const { container } = render(<VoiceReview model={model()} />)

      await userEvent.click(screen.getAllByRole('button', { name: 'Play' })[0]!)
      fireEvent.ended(container.querySelector('audio')!)

      // Nothing follows: the spot check is over when the paragraph is.
      expect(container.querySelector('audio')?.getAttribute('src')).toBeNull()
    })

    it('listen through rolls on to the next paragraph', async () => {
      const { container } = render(<VoiceReview model={model()} />)

      await userEvent.click(screen.getByRole('button', { name: 'Listen through' }))
      fireEvent.ended(container.querySelector('audio')!)

      expect(container.querySelector('audio')?.getAttribute('src')).toBe(
        '/api/voice-takes/take-2/audio',
      )
    })

    it('pause stops the audio now, not at the end of the paragraph', async () => {
      render(<VoiceReview model={model()} />)

      await userEvent.click(screen.getByRole('button', { name: 'Listen through' }))

      const pause = vi.mocked(HTMLMediaElement.prototype.pause)
      pause.mockClear()

      await userEvent.click(screen.getAllByRole('button', { name: 'Pause' })[0]!)
      // The element itself was told to stop — clearing the src attribute alone
      // lets the take play out to its end, which is the bug this pins.
      expect(pause).toHaveBeenCalled()
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
                stale: false,
              },
            ],
          },
        ],
      })

      render(<VoiceReview model={pending} />)
      expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled()
    })
  })

  /**
   * The flag's sibling. A flag says a human rejected the take; `stale` says an
   * edit or a settings change quietly outdated it — the words, the voice, the
   * pacing or a pronunciation moved on after it was read. Without the marker,
   * a moved pacing slider looked like nothing at all: every row still said
   * "Generated" and the only way to learn the audio was old was to notice it
   * by ear.
   */
  describe('a paragraph that changed after it was read', () => {
    function staleModel(): VoiceReviewModel {
      return model({
        chapters: [
          {
            chapterId: 'c1',
            title: 'The audit',
            paragraphs: [
              {
                chapterId: 'c1',
                paragraphIndex: 0,
                text: 'The auditors signed it off for eighteen years — allegedly.',
                current: take(),
                previous: undefined,
                takeCount: 1,
                stale: true,
              },
              {
                chapterId: 'c1',
                paragraphIndex: 1,
                text: 'Nobody asked where the cash was.',
                current: take({ id: 'take-2' }),
                previous: undefined,
                takeCount: 1,
                stale: false,
              },
            ],
          },
        ],
      })
    }

    it('marks the row, like a flag, so the outdated audio is visible in place', () => {
      render(<VoiceReview model={staleModel()} />)
      expect(screen.getByText('Changed since read')).toBeInTheDocument()
    })

    it('counts the changed rows beside the coverage, in words', () => {
      render(<VoiceReview model={staleModel()} />)
      expect(screen.getByText(/1 changed since read/)).toBeInTheDocument()
    })

    it('counts them on the chapter header, so a collapsed chapter still says so', () => {
      render(<VoiceReview model={staleModel()} />)
      expect(screen.getByText('1 changed')).toBeInTheDocument()
    })

    it('marks nothing when nothing has changed', () => {
      render(<VoiceReview model={model()} />)
      expect(screen.queryByText('Changed since read')).not.toBeInTheDocument()
      expect(screen.queryByText(/changed since read/)).not.toBeInTheDocument()
    })

    it('offers Regenerate on the changed row, so the fix is where the problem is', async () => {
      render(<VoiceReview model={staleModel()} />)

      await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
      expect(retakeVoiceTake).toHaveBeenCalledWith('take-1')
    })

    it('offers Regenerate even where a re-read cannot differ — the input changed', () => {
      // staleModel keeps the fixture default rereadCanDiffer: false. That gate
      // is about identical input; a stale row's input is different by
      // definition, so every narrator qualifies.
      render(<VoiceReview model={staleModel()} />)
      expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument()
    })

    it('offers no Regenerate on rows whose audio still matches', () => {
      render(<VoiceReview model={model()} />)
      expect(screen.queryByRole('button', { name: 'Regenerate' })).toBeNull()
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
