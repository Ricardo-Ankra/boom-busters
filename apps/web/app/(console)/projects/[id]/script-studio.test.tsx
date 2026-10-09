import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Notice, ShortsCandidate } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ShortsStrip } from './script-studio'

vi.mock('./actions', () => ({
  applyRegeneratedText: vi.fn(),
  regenerateSection: vi.fn(),
  reorderScriptChapters: vi.fn(),
  saveChapterText: vi.fn(),
}))
vi.mock('@/app/(console)/settings/voice-actions', () => ({ addPronunciation: vi.fn() }))
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
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
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
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(dismissNoticeAction).toHaveBeenCalledWith('01J000000000000000000000S1')
  })
})
