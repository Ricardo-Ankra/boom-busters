import type * as TiptapReact from '@tiptap/react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Notice, ShortsCandidate } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { regenerateSection, saveChapterText } from './actions'
import { hedgeInstruction } from '@/lib/script-editing'
import { ScriptStudio, ShortsStrip } from './script-studio'

// The editor's options, captured so a test can fire its update hook.
const editorHooks: { onUpdate: (arg: unknown) => void }[] = []
vi.mock('@tiptap/react', async (importOriginal) => {
  const actual = await importOriginal<typeof TiptapReact>()
  return {
    ...actual,
    useEditor: (options: Parameters<typeof actual.useEditor>[0]) => {
      editorHooks.push(options as unknown as (typeof editorHooks)[number])
      return actual.useEditor(options)
    },
  }
})

vi.mock('./actions', () => ({
  applyRegeneratedText: vi.fn(),
  regenerateSection: vi.fn(),
  reorderScriptChapters: vi.fn(),
  saveChapterText: vi.fn(),
}))
vi.mock('@/app/(console)/c/[slug]/settings/voice-actions', () => ({ addPronunciation: vi.fn() }))
const dismissNoticeAction = vi.fn()
vi.mock('@/app/(console)/notice-actions', () => ({
  dismissNoticeAction: (...args: unknown[]) => dismissNoticeAction(...args),
}))
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))

/**
 * Script Studio's Shorts strip (decision 293): what the marking's repair
 * changed, or why it stopped, with a Dismiss on each line. A stop leaves no
 * candidates, so the strip must still show for its notice alone.
 */

const notice = (id: string, kind: Notice['kind'], message: string): Notice => ({
  id,
  projectId: '01J0000000000000000000000P',
  subject: 'script',
  subjectId: null,
  kind,
  message,
  createdAt: new Date('2026-10-09T10:00:00Z'),
})

const candidate: ShortsCandidate = {
  chapterIndex: 0,
  startSentence: 'EY refused to sign the accounts.',
  endSentence: 'The shares collapsed in nine days.',
  hookRationale: 'The auditor said no.',
}

const STOPPED =
  'Shorts marking stopped: the answer was cut off at its length limit. The Shorts stage will mark them again.'

describe('the Shorts strip (decision 293)', () => {
  beforeEach(() => {
    dismissNoticeAction.mockReset()
    refresh.mockReset()
  })

  it('says why the marking stopped, though the chapter has no candidates', () => {
    render(
      <ShortsStrip
        shorts={[]}
        notices={[notice('01J000000000000000000000S1', 'stopped', STOPPED)]}
      />,
    )
    expect(screen.getByText(STOPPED)).toHaveAttribute('role', 'status')
    expect(screen.getByRole('button', { name: 'Dismiss note' })).toBeInTheDocument()
    expect(screen.queryByText(/Shorts candidate/)).toBeNull()
  })

  it("shows what the marking's repair changed above the chapter's candidates", async () => {
    render(
      <ShortsStrip
        shorts={[candidate]}
        notices={[
          notice('01J000000000000000000000S2', 'trimmed', "Trimmed to fit: candidate 2's hook."),
        ]}
      />,
    )
    expect(screen.getByText("Trimmed to fit: candidate 2's hook.")).toHaveAttribute(
      'role',
      'status',
    )
    await userEvent.click(
      screen.getByRole('button', { name: /1 Shorts candidate in this chapter/ }),
    )
    expect(screen.getByText('The auditor said no.')).toBeInTheDocument()
  })

  it('shows nothing with no candidates and no notices', () => {
    const { container } = render(<ShortsStrip shorts={[]} notices={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('dismisses a notice from the strip', async () => {
    dismissNoticeAction.mockResolvedValue({ ok: true })
    render(
      <ShortsStrip
        shorts={[]}
        notices={[notice('01J000000000000000000000S1', 'stopped', STOPPED)]}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss note' }))
    expect(dismissNoticeAction).toHaveBeenCalledWith('01J000000000000000000000S1')
  })
})

describe('the format fixed lines in the chapter editor', () => {
  const chapter = {
    id: '01J000000000000000000000C1',
    index: 0,
    title: 'The audit',
    contentMd: 'Settle in.\n\nEY refused to sign the accounts.\n\nSleep well.',
    warnings: [],
    estRuntimeSec: 12,
  } as never

  const studio = (fixedLines?: { introLine: string; outroLine: string }) => (
    <ScriptStudio
      hedgingRules=""
      channelId="01J000000000000000000000H1"
      projectId="01J0000000000000000000000P"
      scriptId="01J000000000000000000000S1"
      chapters={[chapter]}
      targetRuntimeMin={10}
      shorts={[]}
      usedFallbackModel={false}
      {...(fixedLines ? { fixedLines } : {})}
    />
  )

  it('shows each fixed line read-only, labelled', () => {
    render(studio({ introLine: 'Settle in.', outroLine: 'Sleep well.' }))
    expect(screen.getAllByText('Fixed line from the bible')).toHaveLength(2)
    expect(screen.getByText('Settle in.')).toBeInTheDocument()
    expect(screen.getByText('Sleep well.')).toBeInTheDocument()
  })

  it('keeps a new paragraph typed before the fixed closing line, and saves the line intact', async () => {
    vi.mocked(saveChapterText).mockResolvedValue({ ok: true } as never)
    render(studio({ introLine: 'Settle in.', outroLine: 'Sleep well.' }))
    await screen.findByLabelText('The audit narration')
    // jsdom cannot type into ProseMirror: feed the editor's own update hook the
    // text it would report after each key (an empty paragraph reads as a blank line).
    const type = (text: string) =>
      act(() => editorHooks.at(-1)!.onUpdate({ editor: { getText: () => text } }))
    const base = 'EY refused to sign the accounts.'
    type(`${base} A`)
    type(`${base} A\n\n`)
    type(`${base} A\n\n\n\n`)
    type(`${base} A\n\n\n\nB`)
    await waitFor(
      () => {
        const text = vi.mocked(saveChapterText).mock.calls.at(-1)![2]
        expect(text).toMatch(/accounts\. A\n\n+B\n\nSleep well\.$/)
        expect(text.startsWith('Settle in.\n\nEY refused')).toBe(true)
      },
      { timeout: 3000 },
    )
  })

  it('shows none for a format without fixed lines', () => {
    render(studio())
    expect(screen.queryByText('Fixed line from the bible')).toBeNull()
  })
})

describe('the Shorts strip when the format has Shorts off', () => {
  const chapter = {
    id: '01J000000000000000000000C1',
    index: 0,
    title: 'The audit',
    contentMd: 'EY refused to sign the accounts.',
    warnings: [],
    estRuntimeSec: 12,
  } as never

  const studio = (shorts: (typeof candidate)[], shortsOff: boolean) => (
    <ScriptStudio
      hedgingRules=""
      channelId="01J000000000000000000000H1"
      projectId="01J0000000000000000000000P"
      scriptId="01J000000000000000000000S1"
      chapters={[chapter]}
      targetRuntimeMin={10}
      shorts={shorts}
      usedFallbackModel={false}
      notices={[notice('01J000000000000000000000S1', 'stopped', STOPPED)]}
      shortsOff={shortsOff}
    />
  )

  it('hides the strip, notices and all, when off and no candidates exist', () => {
    render(studio([], true))
    expect(screen.queryByText(STOPPED)).toBeNull()
  })

  it('still shows the strip when off but candidates exist, and when on', () => {
    const { unmount } = render(studio([candidate], true))
    expect(screen.getByText(STOPPED)).toBeInTheDocument()
    unmount()
    render(studio([], false))
    expect(screen.getByText(STOPPED)).toBeInTheDocument()
  })
})

describe('the gutter shows blocking and advisory warnings apart (decision 458)', () => {
  const contentMd = 'EY refused to sign. The shares fell. Nobody saw it coming.'
  const warn = (kind: string, sentence: string, extra: object = {}) => ({
    kind,
    sentence,
    message: `A note about ${kind}.`,
    ...extra,
  })
  const studio = (warnings: object[]) => (
    <ScriptStudio
      channelId="01J000000000000000000000H1"
      projectId="01J0000000000000000000000P"
      scriptId="01J000000000000000000000S1"
      chapters={
        [
          {
            id: '01J000000000000000000000C1',
            index: 0,
            title: 'The audit',
            contentMd,
            warnings,
            estRuntimeSec: 12,
          },
        ] as never
      }
      targetRuntimeMin={10}
      shorts={[]}
      usedFallbackModel={false}
      hedgingRules="Kilroy."
    />
  )
  const base = [
    warn('unsourced-claim', 'EY refused to sign.'),
    warn('style', 'The shares fell.'),
    warn('overstated-standing', 'Nobody saw it coming.', { severity: 'advisory' }),
  ]

  it('counts the two apart in the gutter header', () => {
    render(studio(base))
    expect(screen.getByText(/1 blocking · 2 advisory/)).toBeInTheDocument()
  })

  it('offers the channel hedge only for a missing-alleged warning', () => {
    const { unmount } = render(studio(base))
    expect(screen.queryByRole('button', { name: /Rewrite with the channel's hedge/ })).toBeNull()
    unmount()
    render(studio([...base, warn('missing-alleged', 'The shares fell.')]))
    expect(
      screen.getByRole('button', { name: /Rewrite with the channel's hedge/ }),
    ).toBeInTheDocument()
  })

  it('sends the channel hedge instruction to the regenerate action when the button is clicked', async () => {
    vi.mocked(regenerateSection).mockResolvedValue({ ok: true, proposal: 'Reportedly, it fell.' })
    render(studio([warn('missing-alleged', 'The shares fell.')]))
    await userEvent.click(screen.getByRole('button', { name: /Rewrite with the channel's hedge/ }))
    await waitFor(() =>
      expect(regenerateSection).toHaveBeenCalledWith(
        '01J0000000000000000000000P',
        '01J000000000000000000000C1',
        'The shares fell.',
        hedgeInstruction('Kilroy.'),
      ),
    )
  })

  it('offers a passage rewrite for a craft warning', () => {
    render(studio([warn('craft', 'The shares fell.')]))
    expect(screen.getByRole('button', { name: /Rewrite this passage/ })).toBeInTheDocument()
  })

  it('states the channel rules in the hedge instruction', () => {
    expect(hedgeInstruction('Kilroy.').endsWith('Kilroy.')).toBe(true)
  })
})
