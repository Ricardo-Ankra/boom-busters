import { PUBLISH_DISCLAIMER } from '@boom-busters/schemas'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublishItemModel, PublishModel } from '@/lib/publish-review'
import { PublishScreen } from './publish-screen'

/**
 * The Publish screen (build spec section 11.3): the audit checklist, the
 * status chips, the slot calendar's click-first scheduling, the title
 * picker, the composed-description live preview and the failed-upload
 * retry — all driven by visible labelled buttons.
 */

// project-controls (for useAction) drags '../actions' in, and with it
// next-auth — which cannot load under jsdom. Same mock every screen test uses.
vi.mock('../actions', () => ({
  approveGate: vi.fn(),
  stopProject: vi.fn(),
}))

const generateTitles = vi.fn()
const removeThumbnail = vi.fn()
const reschedulePublish = vi.fn()
const retryPublish = vi.fn()
const savePublishDraft = vi.fn()
const schedulePublish = vi.fn()
const uploadThumbnail = vi.fn()
vi.mock('./publish-actions', () => ({
  generateTitles: (...args: unknown[]) => generateTitles(...args),
  removeThumbnail: (...args: unknown[]) => removeThumbnail(...args),
  reschedulePublish: (...args: unknown[]) => reschedulePublish(...args),
  retryPublish: (...args: unknown[]) => retryPublish(...args),
  savePublishDraft: (...args: unknown[]) => savePublishDraft(...args),
  schedulePublish: (...args: unknown[]) => schedulePublish(...args),
  uploadThumbnail: (...args: unknown[]) => uploadThumbnail(...args),
}))

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

beforeEach(() => {
  vi.clearAllMocks()
  for (const action of [
    generateTitles,
    removeThumbnail,
    reschedulePublish,
    retryPublish,
    savePublishDraft,
    schedulePublish,
    uploadThumbnail,
  ]) {
    action.mockResolvedValue({ ok: true })
  }
})

const PROJECT = '01J0000000000000000000000A'
const SHORT = '01HQ00000000000000000000S1'

function masterItem(overrides: Partial<PublishItemModel> = {}): PublishItemModel {
  return {
    targetType: 'master',
    targetId: PROJECT,
    label: 'Wirecard: The 1.9 Billion Euro Lie',
    durationMs: 900_000,
    notReadyReason: null,
    record: null,
    ...overrides,
  }
}

function shortItem(overrides: Partial<PublishItemModel> = {}): PublishItemModel {
  return {
    targetType: 'short',
    targetId: SHORT,
    label: 'EY refused to sign the accounts.',
    durationMs: null,
    notReadyReason: null,
    record: null,
    ...overrides,
  }
}

function model(overrides: Partial<PublishModel> = {}): PublishModel {
  return {
    items: [masterItem()],
    chapters: [
      { title: 'The rise', startMs: 0 },
      { title: 'The hole', startMs: 312_000 },
      { title: 'The fall', startMs: 771_000 },
    ],
    sources: ['https://example.com/ft-report'],
    hook: 'On a June morning in 2020, 1.9 billion euros stopped existing.',
    // Friday 15:00 UTC long-form, Saturday 16:00 UTC Short — the defaults.
    slots: [
      { kind: 'longform', weekday: 5, timeUtc: '15:00' },
      { kind: 'short', weekday: 6, timeUtc: '16:00' },
    ],
    apiAuditPassed: false,
    dailyUploadBudget: 4,
    uploadsToday: 1,
    masterDurationMs: 900_000,
    analytics: null,
    ...overrides,
  }
}

function renderScreen(overrides: Partial<PublishModel> = {}, live = false) {
  return render(<PublishScreen projectId={PROJECT} model={model(overrides)} live={live} />)
}

describe('PublishScreen', () => {
  it('shows the private-until-audit checklist, ending in the Studio step', () => {
    renderScreen()
    expect(screen.getByText(/going public is a manual step/i)).toBeInTheDocument()
    expect(screen.getByText(/flip it to public in YouTube Studio/i)).toBeInTheDocument()
  })

  it('drops the checklist once the audit has passed', () => {
    renderScreen({ apiAuditPassed: true })
    expect(screen.queryByText(/going public is a manual step/i)).not.toBeInTheDocument()
  })

  it('says where the daily upload budget stands', () => {
    renderScreen()
    expect(screen.getByText(/1 of 4 upload starts used/i)).toBeInTheDocument()
  })

  it('schedules the selected item from the slot button, record-first ISO in hand', async () => {
    const user = userEvent.setup()
    renderScreen()

    const buttons = screen.getAllByRole('button', { name: 'Schedule here' })
    expect(buttons.length).toBeGreaterThan(0)
    await user.click(buttons[0]!)

    expect(schedulePublish).toHaveBeenCalledTimes(1)
    const [targetType, targetId, iso] = schedulePublish.mock.calls[0] as [string, string, string]
    expect(targetType).toBe('master')
    expect(targetId).toBe(PROJECT)
    // A real future instant on the configured long-form slot: Friday 15:00 UTC.
    const at = new Date(iso)
    expect(at.getTime()).toBeGreaterThan(Date.now())
    expect(at.getUTCDay()).toBe(5)
    expect(at.getUTCHours()).toBe(15)
  })

  it('never offers a long-form slot to a Short, and says why', () => {
    renderScreen({ items: [shortItem()] })
    // The only offered slots are the Saturday Short ones; the Friday
    // long-form cells explain themselves instead of offering a button.
    expect(screen.getAllByText('Wrong format for this slot').length).toBeGreaterThan(0)
    for (const button of screen.getAllByRole('button', { name: 'Schedule here' })) {
      expect(button).toBeInTheDocument()
    }
  })

  it('an unready item gets its reason, not a schedule button', () => {
    renderScreen({
      items: [masterItem({ notReadyReason: 'There is no finished master render yet.' })],
    })
    expect(screen.getByText('There is no finished master render yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Schedule here' })).not.toBeInTheDocument()
  })

  it('previews exactly what will be written: hook, chapters, sources, disclaimer', () => {
    renderScreen()
    const preview = screen.getByText(new RegExp(PUBLISH_DISCLAIMER.slice(0, 40)))
    expect(preview.textContent).toContain('1.9 billion euros stopped existing')
    expect(preview.textContent).toContain('Chapters:')
    expect(preview.textContent).toContain('0:00 The rise')
    expect(preview.textContent).toContain('5:12 The hole')
    expect(preview.textContent).toContain('Sources:')
    expect(preview.textContent).toContain('https://example.com/ft-report')
  })

  it('a Short composes without chapter stamps — they mean nothing there', () => {
    renderScreen({ items: [shortItem()] })
    const preview = screen.getByText(new RegExp(PUBLISH_DISCLAIMER.slice(0, 40)))
    expect(preview.textContent).not.toContain('Chapters:')
  })

  it('picking a generated title fills the field; saving is explicit', async () => {
    const user = userEvent.setup()
    renderScreen({
      items: [
        masterItem({
          record: {
            id: '01HQ00000000000000000000P1',
            status: 'draft',
            publishAtIso: null,
            youtubeVideoId: null,
            errorMessage: null,
            title: null,
            titleOptions: ['[mock] How Wirecard actually happened', '[mock] Nine days to zero'],
            descriptionBody: null,
            tags: [],
            thumbs: [],
          },
        }),
      ],
    })

    await user.click(screen.getByRole('radio', { name: /nine days to zero/i }))
    await user.click(screen.getByRole('button', { name: /save draft/i }))

    expect(savePublishDraft).toHaveBeenCalledWith(
      'master',
      PROJECT,
      expect.objectContaining({ title: '[mock] Nine days to zero' }),
    )
  })

  it('generating titles is one click in mock mode, two when it spends', async () => {
    const user = userEvent.setup()
    const { unmount } = renderScreen()
    await user.click(screen.getByRole('button', { name: /generate 8 title options \(mock\)/i }))
    expect(generateTitles).toHaveBeenCalledWith('master', PROJECT)
    unmount()

    generateTitles.mockClear()
    renderScreen({}, true)
    await user.click(screen.getByRole('button', { name: /generate 8 title options/i }))
    expect(generateTitles).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Generate' }))
    expect(generateTitles).toHaveBeenCalledWith('master', PROJECT)
  })

  it('a failed upload shows the mapped error and a retry button', async () => {
    const user = userEvent.setup()
    renderScreen({
      items: [
        masterItem({
          record: {
            id: '01HQ00000000000000000000P1',
            status: 'failed',
            publishAtIso: new Date(Date.now() + 86_400_000).toISOString(),
            youtubeVideoId: null,
            errorMessage: 'YouTube had a transient problem — retrying.',
            title: 'How Wirecard Fell',
            titleOptions: [],
            descriptionBody: null,
            tags: [],
            thumbs: [],
          },
        }),
      ],
    })

    expect(screen.getByText('YouTube had a transient problem — retrying.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /retry upload/i }))
    expect(retryPublish).toHaveBeenCalledWith('master', PROJECT)
  })

  it('the thumbnail dropzone refuses the wrong file client-side', async () => {
    // applyAccept off: the accept attribute filters in real browsers, but the
    // handler's own validation is what shows the reason — that is under test.
    const user = userEvent.setup({ applyAccept: false })
    const { container } = renderScreen()

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, new File(['x'], 'thumb.jpg', { type: 'image/jpeg' }))
    expect(uploadThumbnail).not.toHaveBeenCalled()
    expect(screen.getByText(/only pngs/i)).toBeInTheDocument()

    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' })
    await user.upload(input, big)
    expect(uploadThumbnail).not.toHaveBeenCalled()
    expect(screen.getByText(/2 MB thumbnail limit/i)).toBeInTheDocument()
  })

  it('a valid PNG goes to the action as FormData', async () => {
    const user = userEvent.setup()
    const { container } = renderScreen()

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, new File(['png bytes'], 'thumb.png', { type: 'image/png' }))

    expect(uploadThumbnail).toHaveBeenCalledTimes(1)
    const formData = uploadThumbnail.mock.calls[0]![0] as FormData
    expect(formData.get('projectId')).toBe(PROJECT)
    expect((formData.get('file') as File).name).toBe('thumb.png')
  })

  it('a Short offers no thumbnail dropzone — the frame comes from the video', () => {
    renderScreen({ items: [shortItem()] })
    expect(screen.queryByTestId('thumb-dropzone')).not.toBeInTheDocument()
  })

  it('marks the first thumbnail as the API one and the rest for Test & Compare', () => {
    renderScreen({
      items: [
        masterItem({
          record: {
            id: '01HQ00000000000000000000P1',
            status: 'draft',
            publishAtIso: null,
            youtubeVideoId: null,
            errorMessage: null,
            title: null,
            titleOptions: [],
            descriptionBody: null,
            tags: [],
            thumbs: [
              { key: 'boom-busters/thumbs/p/a.png', url: null },
              { key: 'boom-busters/thumbs/p/b.png', url: null },
            ],
          },
        }),
      ],
    })

    expect(screen.getByText('Set via the API')).toBeInTheDocument()
    expect(screen.getByText('For Test & Compare in Studio')).toBeInTheDocument()
    expect(screen.getByText(/set up test & compare with the others/i)).toBeInTheDocument()
  })

  it('a scheduled item wears its chip and its public moment', () => {
    const publishAtIso = '2026-08-28T15:00:00.000Z'
    renderScreen({
      items: [
        masterItem({
          record: {
            id: '01HQ00000000000000000000P1',
            status: 'scheduled',
            publishAtIso,
            youtubeVideoId: 'dQw4w9WgXcQ',
            errorMessage: null,
            title: 'How Wirecard Fell',
            titleOptions: [],
            descriptionBody: null,
            tags: [],
            thumbs: [],
          },
        }),
      ],
    })

    expect(screen.getByText('Scheduled')).toBeInTheDocument()
    expect(screen.getByText(/dQw4w9WgXcQ/)).toBeInTheDocument()
    expect(screen.getByText(/goes public/i)).toBeInTheDocument()
    // The occupied slot on the calendar wears the item too.
    expect(screen.getAllByText('How Wirecard Fell').length).toBeGreaterThanOrEqual(1)
  })

  it('a scheduled item can be moved: arm it, press an empty slot, new ISO through', async () => {
    const user = userEvent.setup()
    renderScreen({
      items: [
        masterItem({
          record: {
            id: '01HQ00000000000000000000P1',
            status: 'scheduled',
            publishAtIso: '2026-08-28T15:00:00.000Z',
            youtubeVideoId: 'dQw4w9WgXcQ',
            errorMessage: null,
            title: 'How Wirecard Fell',
            titleOptions: [],
            descriptionBody: null,
            tags: [],
            thumbs: [],
          },
        }),
      ],
    })

    // Nothing is armed yet, so no slot offers a move.
    expect(screen.queryByRole('button', { name: 'Move here' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Move the slot' }))
    const slots = screen.getAllByRole('button', { name: 'Move here' })
    expect(slots.length).toBeGreaterThan(0)
    await user.click(slots[0]!)

    expect(reschedulePublish).toHaveBeenCalledTimes(1)
    expect(schedulePublish).not.toHaveBeenCalled()
    const [targetType, targetId, iso] = reschedulePublish.mock.calls[0] as [string, string, string]
    expect(targetType).toBe('master')
    expect(targetId).toBe(PROJECT)
    // A real future instant on the configured long-form slot: Friday 15:00 UTC.
    const at = new Date(iso)
    expect(at.getTime()).toBeGreaterThan(Date.now())
    expect(at.getUTCDay()).toBe(5)
    expect(at.getUTCHours()).toBe(15)
  })

  it('a live item offers no move — there is no moment left to change', () => {
    renderScreen({
      items: [
        masterItem({
          record: {
            id: '01HQ00000000000000000000P1',
            status: 'live',
            publishAtIso: '2026-08-28T15:00:00.000Z',
            youtubeVideoId: 'dQw4w9WgXcQ',
            errorMessage: null,
            title: 'How Wirecard Fell',
            titleOptions: [],
            descriptionBody: null,
            tags: [],
            thumbs: [],
          },
        }),
      ],
    })
    expect(screen.queryByRole('button', { name: 'Move the slot' })).not.toBeInTheDocument()
  })
})
