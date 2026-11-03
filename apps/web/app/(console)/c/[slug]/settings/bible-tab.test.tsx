import { EXAMPLE_SLOTS, FIRST_CHANNEL_BIBLE } from '@boom-busters/schemas'
import type { BibleDraft } from '@boom-busters/schemas'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BibleTab } from './bible-tab'
import { FIXTURE_CHANNEL_VIEW } from './channel-view-fixture'

const approveBibleSectionAction = vi.fn()
const discardBibleDraftAction = vi.fn()
const draftBibleAction = vi.fn()
const estimateBibleResearchAction = vi.fn()
const startBibleResearchAction = vi.fn()
const editBibleSectionAction = vi.fn()
const saveBibleAction = vi.fn()
const copyBibleFromChannelAction = vi.fn()
const measureKeywordsAction = vi.fn()
const analyseSearchSpaceAction = vi.fn()
vi.mock('./bible-actions', () => ({
  approveBibleSectionAction: (...args: unknown[]) => approveBibleSectionAction(...args),
  discardBibleDraftAction: (...args: unknown[]) => discardBibleDraftAction(...args),
  draftBibleAction: (...args: unknown[]) => draftBibleAction(...args),
  estimateBibleResearchAction: (...args: unknown[]) => estimateBibleResearchAction(...args),
  startBibleResearchAction: (...args: unknown[]) => startBibleResearchAction(...args),
  editBibleSectionAction: (...args: unknown[]) => editBibleSectionAction(...args),
  saveBibleAction: (...args: unknown[]) => saveBibleAction(...args),
  copyBibleFromChannelAction: (...args: unknown[]) => copyBibleFromChannelAction(...args),
  measureKeywordsAction: (...args: unknown[]) => measureKeywordsAction(...args),
  analyseSearchSpaceAction: (...args: unknown[]) => analyseSearchSpaceAction(...args),
  restoreBibleVersionAction: vi.fn(),
  viewBibleVersionAction: vi.fn(),
  previewStagePromptAction: vi.fn(async () => ({ ok: true, text: '' })),
}))
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }))
const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

const CHANNEL = FIXTURE_CHANNEL_VIEW
const SLOT = EXAMPLE_SLOTS[1]!

function draftOf(over: Partial<BibleDraft> = {}): BibleDraft {
  return {
    channelId: CHANNEL.id,
    baseBibleId: '01J00000000000000000000009',
    bible: FIRST_CHANNEL_BIBLE,
    statuses: {
      identity: 'approved',
      formats: 'approved',
      voice: 'approved',
      look: 'approved',
      examples: 'approved',
      hooks: 'approved',
      search: 'approved',
      publishing: 'approved',
    },
    tooClose: {},
    errors: {},
    inputs: null,
    research: null,
    job: null,
    updatedAt: '2026-10-30T08:00:00.000Z',
    ...over,
  }
}

const SOURCES = [
  { id: '01J00000000000000000000002', name: 'Boom & Busters', archived: false, version: 4 },
  { id: '01J00000000000000000000003', name: 'Mind Matters', archived: true, version: 2 },
]

function tabElement(draft: BibleDraft | null, over: { archived?: boolean } = {}) {
  return (
    <BibleTab
      channel={CHANNEL}
      draft={draft}
      versions={[]}
      currentVersion={{ id: '01J00000000000000000000009', version: 3, bible: FIRST_CHANNEL_BIBLE }}
      vidiqReady={false}
      archived={over.archived ?? false}
      copySources={SOURCES}
    />
  )
}

function renderTab(draft: BibleDraft | null, over: { archived?: boolean } = {}) {
  return render(tabElement(draft, over))
}

/** A section's card, found by its label in the summary. */
function card(label: string): HTMLElement {
  const summary = screen.getAllByText(label).find((el) => el.closest('summary'))
  return summary!.closest('details')!
}

const running = (current: string | null, kind: 'draft' | 'research' = 'draft') =>
  ({
    kind,
    state: 'running',
    current,
    error: null,
    startedAt: new Date().toISOString(),
  }) as const

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BibleTab', () => {
  it('shows the status of an approved, a drafted and an empty section', () => {
    renderTab(
      draftOf({
        bible: {
          ...FIRST_CHANNEL_BIBLE,
          language: '',
          country: '',
          channelTags: [],
          channelHashtag: '',
        },
        statuses: { ...draftOf().statuses, voice: 'drafted' },
      }),
    )
    expect(within(card('Identity')).getByText('Approved')).toBeInTheDocument()
    expect(within(card('Voice')).getByText('Drafted, not approved')).toBeInTheDocument()
    expect(within(card('Search')).getByText('Empty')).toBeInTheDocument()
  })

  it('shows the current version with every section approved when there is no draft', () => {
    renderTab(null)
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(within(card('Voice')).getByText('Approved')).toBeInTheDocument()
    expect(screen.getByText(/Version 3 is what the channel runs on/)).toBeInTheDocument()
  })

  it('keeps Save off and says why until the drafted section is approved', async () => {
    const drafted = draftOf({ statuses: { ...draftOf().statuses, voice: 'drafted' } })
    approveBibleSectionAction.mockResolvedValue({ ok: true, draft: draftOf() })
    renderTab(drafted)

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Show what to fix' }))
    expect(screen.getByText('Voice is drafted, not approved')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Approve Voice' }))
    expect(approveBibleSectionAction).toHaveBeenCalledWith(CHANNEL.id, 'voice')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(screen.queryByText('Voice is drafted, not approved')).toBeNull()
  })

  it('keeps the draft bar along the bottom with the next version number', () => {
    renderTab(draftOf())
    const bar = screen.getByRole('region', { name: 'Unsaved draft' })
    expect(bar.className).toContain('sticky')
    expect(within(bar).getByText(/Saving makes version 4/)).toBeInTheDocument()
  })

  it('counts what stops Save and lists it on request', async () => {
    renderTab(draftOf({ statuses: { ...draftOf().statuses, voice: 'drafted', look: 'drafted' } }))
    expect(screen.getByText(/2 things to fix before saving/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show what to fix' }))
    expect(screen.getByText('Voice is drafted, not approved')).toBeVisible()
  })

  it('holds Save, Discard and the note on an archived channel', () => {
    renderTab(draftOf(), { archived: true })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByLabelText('Version note')).toBeDisabled()
  })

  it('says one thing in the singular', () => {
    renderTab(draftOf({ statuses: { ...draftOf().statuses, voice: 'drafted' } }))
    expect(screen.getByText(/1 thing to fix before saving\./)).toBeInTheDocument()
  })

  it('saves with the note and clears the draft', async () => {
    saveBibleAction.mockResolvedValue({ ok: true })
    renderTab(draftOf())
    await userEvent.type(screen.getByLabelText('Version note'), 'First pass')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(saveBibleAction).toHaveBeenCalledWith(CHANNEL.id, 'First pass')
    expect(refresh).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('disables Approve on a flagged field and shows the shared run and its source', async () => {
    renderTab(
      draftOf({
        statuses: { ...draftOf().statuses, examples: 'drafted' },
        tooClose: { [`examples.${SLOT.id}`]: { source: 'Alpha: A title', run: 'one two three' } },
      }),
    )
    expect(screen.getByRole('button', { name: 'Approve Examples' })).toBeDisabled()
    const note = within(card('Examples')).getByText(/Too close to its source/)
    expect(note).toHaveTextContent('one two three')
    expect(note).toHaveTextContent('Alpha: A title')
    await userEvent.click(screen.getByRole('button', { name: 'Show what to fix' }))
    expect(screen.getByText('examples.' + SLOT.id + ' is too close to its source')).toBeVisible()
  })

  it('ignores a stored flag on a retired example slot: Approve stays enabled and no blocker names it', async () => {
    renderTab(
      draftOf({
        statuses: { ...draftOf().statuses, examples: 'drafted' },
        tooClose: { 'examples.graphics-worked-beat': { source: 'Alpha: A title', run: 'one two' } },
      }),
    )
    expect(screen.getByRole('button', { name: 'Approve Examples' })).toBeEnabled()
    expect(within(card('Examples')).queryByText(/Too close to its source/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Show what to fix' }))
    expect(screen.queryByText(/graphics-worked-beat/)).toBeNull()
  })

  it('gives every button the 40 px target', () => {
    const { examples, ...rest } = FIRST_CHANNEL_BIBLE
    void examples
    renderTab(
      draftOf({
        bible: { ...rest, examples: {} },
        statuses: { ...draftOf().statuses, voice: 'drafted' },
      }),
    )
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThan(20)
    for (const button of buttons) expect(button.className).toContain('h-10')
  })

  it('offers to draft a slot with no example, alone', async () => {
    draftBibleAction.mockResolvedValue({ ok: true })
    renderTab(draftOf({ bible: { ...FIRST_CHANNEL_BIBLE, examples: {} } }))
    const examples = card('Examples')
    expect(within(examples).getAllByText('No example yet')).toHaveLength(EXAMPLE_SLOTS.length)
    expect(within(examples).getAllByText(SLOT.teaches).length).toBeGreaterThan(0)

    await userEvent.click(within(examples).getByRole('button', { name: `Draft ${SLOT.title}` }))
    expect(draftBibleAction).toHaveBeenCalledWith(CHANNEL.id, { slotId: SLOT.id })
  })

  it('shows what a run is writing and holds the editing buttons', () => {
    renderTab(draftOf({ job: running('Voice') }))
    expect(screen.getByText('Drafting Voice')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Voice' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('says Researching while the research runs', () => {
    renderTab(draftOf({ job: running(null, 'research') }))
    expect(screen.getByText('Researching')).toBeInTheDocument()
  })

  it('refreshes every three seconds while a run works, and not otherwise', () => {
    vi.useFakeTimers()
    try {
      const { unmount, rerender } = renderTab(draftOf({ job: running('Voice') }))
      act(() => vi.advanceTimersByTime(6000))
      expect(refresh).toHaveBeenCalledTimes(2)

      // The refresh reports the job done: the polling stops.
      rerender(tabElement(draftOf()))
      refresh.mockClear()
      act(() => vi.advanceTimersByTime(9000))
      expect(refresh).not.toHaveBeenCalled()
      unmount()

      refresh.mockClear()
      renderTab(draftOf())
      act(() => vi.advanceTimersByTime(6000))
      expect(refresh).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows a failed run and tries again for the sections that failed', async () => {
    draftBibleAction.mockResolvedValue({ ok: true })
    renderTab(
      draftOf({
        job: {
          kind: 'draft',
          state: 'failed',
          current: null,
          error: 'The model refused twice',
          startedAt: '2026-10-30T08:00:00.000Z',
        },
        errors: { voice: 'Too long', [`slot:${SLOT.id}`]: 'Refused' },
      }),
    )
    expect(screen.getByText('The model refused twice')).toBeInTheDocument()
    expect(within(card('Voice')).getByText('Too long')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(draftBibleAction).toHaveBeenCalledWith(CHANNEL.id, { sections: ['voice', 'examples'] })
  })

  it('tries again with exactly the stored units and steer, never all seven sections', async () => {
    draftBibleAction.mockResolvedValue({ ok: true })
    renderTab(
      draftOf({
        job: {
          kind: 'draft',
          state: 'failed',
          current: null,
          error: 'The drafting run could not be started',
          startedAt: '2026-10-30T08:00:00.000Z',
          units: [{ section: 'voice' }],
          steer: 'more clinical',
        },
      }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(draftBibleAction).toHaveBeenCalledWith(CHANNEL.id, {
      sections: ['voice'],
      steer: 'more clinical',
    })
  })

  it('tries again for a single retired slot as the Examples section, keeping the steer', async () => {
    draftBibleAction.mockResolvedValue({ ok: true })
    renderTab(
      draftOf({
        job: {
          kind: 'draft',
          state: 'failed',
          current: null,
          error: 'The model is down',
          startedAt: '2026-10-30T08:00:00.000Z',
          units: [{ section: 'examples', slotId: 'graphics-worked-beat' }],
          steer: 'plainer',
        },
      }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(draftBibleAction).toHaveBeenCalledWith(CHANNEL.id, {
      sections: ['examples'],
      steer: 'plainer',
    })
  })

  it('tries again for a single slot as that slot', async () => {
    draftBibleAction.mockResolvedValue({ ok: true })
    renderTab(
      draftOf({
        job: {
          kind: 'draft',
          state: 'failed',
          current: null,
          error: 'The model is down',
          startedAt: '2026-10-30T08:00:00.000Z',
          units: [{ section: 'examples', slotId: SLOT.id }],
        },
      }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(draftBibleAction).toHaveBeenCalledWith(CHANNEL.id, { slotId: SLOT.id })
  })

  it('offers no Try again for a failed draft job with no stored units and no errors', () => {
    renderTab(
      draftOf({
        job: {
          kind: 'draft',
          state: 'failed',
          current: null,
          error: 'The model is down',
          startedAt: '2026-10-30T08:00:00.000Z',
        },
      }),
    )
    expect(screen.getByText('The model is down')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Redraft Look' })).toBeEnabled()
  })

  it('shows a running job with no heartbeat for thirty-one minutes as failed, with Try again', async () => {
    draftBibleAction.mockResolvedValue({ ok: true })
    const stale = new Date(Date.now() - 31 * 60_000).toISOString()
    renderTab(
      draftOf({
        job: {
          ...running('Voice'),
          startedAt: stale,
          heartbeatAt: stale,
          units: [{ section: 'voice' }],
        },
      }),
    )
    expect(screen.getByText('The run stopped answering')).toBeInTheDocument()
    expect(screen.queryByText('Drafting Voice')).toBeNull()
    // Editing is open: only a live job locks the draft.
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(draftBibleAction).toHaveBeenCalledWith(CHANNEL.id, { sections: ['voice'] })
  })

  it('keeps a job started forty minutes ago running while its heartbeat is fresh', () => {
    renderTab(
      draftOf({
        job: {
          ...running('Voice'),
          startedAt: new Date(Date.now() - 40 * 60_000).toISOString(),
          heartbeatAt: new Date().toISOString(),
        },
      }),
    )
    expect(screen.getByText('Drafting Voice')).toBeInTheDocument()
    expect(screen.queryByText('The run stopped answering')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('offers no Try again for a failed research run', () => {
    renderTab(
      draftOf({
        job: {
          kind: 'research',
          state: 'failed',
          current: null,
          error: 'VidIQ did not answer',
          startedAt: '2026-10-30T08:00:00.000Z',
        },
      }),
    )
    expect(screen.getByText('VidIQ did not answer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('reopens the research confirm from a failed research, with the saved inputs', async () => {
    estimateBibleResearchAction.mockResolvedValue({
      ok: true,
      estimate: 45,
      balance: 1474,
      capLeft: 900,
    })
    const inputs = {
      description: 'Saved description',
      audience: '',
      admiredChannels: ['Alpha'],
      videos: [],
      avoid: '',
    }
    renderTab(
      draftOf({
        inputs,
        job: {
          kind: 'research',
          state: 'failed',
          current: null,
          error: 'VidIQ did not answer',
          startedAt: '2026-10-30T08:00:00.000Z',
        },
      }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(estimateBibleResearchAction).toHaveBeenCalledWith(CHANNEL.id, inputs)
    expect(await screen.findByText(/About 45 VidIQ credits/)).toBeInTheDocument()
  })

  it('redrafts one section', async () => {
    draftBibleAction.mockResolvedValue({ ok: true })
    renderTab(draftOf())
    await userEvent.click(screen.getByRole('button', { name: 'Redraft Look' }))
    await userEvent.click(screen.getByRole('button', { name: 'Start redraft of Look' }))
    expect(draftBibleAction).toHaveBeenCalledWith(CHANNEL.id, { sections: ['look'] })
    expect(draftBibleAction.mock.calls[0]![1]).not.toHaveProperty('steer')
  })

  it('saves an edited section on Done, as that section only', async () => {
    editBibleSectionAction.mockResolvedValue({ ok: true, draft: draftOf() })
    renderTab(null)
    await userEvent.click(screen.getByRole('button', { name: 'Edit Identity' }))

    const audience = screen.getByLabelText('Audience')
    await userEvent.clear(audience)
    await userEvent.type(audience, 'curious adults')
    await userEvent.click(screen.getByRole('button', { name: 'Done editing Identity' }))

    expect(editBibleSectionAction).toHaveBeenCalledTimes(1)
    const [channelId, section, patch] = editBibleSectionAction.mock.calls[0]!
    expect(channelId).toBe(CHANNEL.id)
    expect(section).toBe('identity')
    expect(Object.keys(patch as object).sort()).toEqual(
      ['audience', 'caseCategories', 'subject', 'subjectKind', 'subjectNoun', 'whatACaseIs'].sort(),
    )
    expect(patch).toMatchObject({ audience: 'curious adults' })
    // Back to reading.
    expect(screen.getByRole('button', { name: 'Edit Identity' })).toBeInTheDocument()
  })

  it('stays in the editor when the save is refused', async () => {
    editBibleSectionAction.mockResolvedValue({ ok: false, error: 'country: too long' })
    renderTab(null)
    await userEvent.click(screen.getByRole('button', { name: 'Edit Search' }))
    await userEvent.click(screen.getByRole('button', { name: 'Done editing Search' }))

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'country: too long' }),
    )
    expect(screen.getByRole('button', { name: 'Done editing Search' })).toBeInTheDocument()
  })

  it('splits list fields into one item per line and an empty category id into null', async () => {
    editBibleSectionAction.mockResolvedValue({ ok: true, draft: draftOf() })
    renderTab(null)
    await userEvent.click(screen.getByRole('button', { name: 'Edit Voice' }))
    const dos = screen.getByLabelText('Voice dos')
    await userEvent.clear(dos)
    await userEvent.type(dos, 'Be plain{Enter}{Enter}Be brief')
    await userEvent.click(screen.getByRole('button', { name: 'Done editing Voice' }))
    expect(editBibleSectionAction.mock.calls[0]![2]).toMatchObject({
      voiceDos: ['Be plain', 'Be brief'],
    })

    editBibleSectionAction.mockClear()
    await userEvent.click(screen.getByRole('button', { name: 'Edit Publishing' }))
    await userEvent.clear(screen.getByLabelText('YouTube category id'))
    await userEvent.click(screen.getByRole('button', { name: 'Done editing Publishing' }))
    expect(editBibleSectionAction.mock.calls[0]![2]).toMatchObject({ youtubeCategoryId: null })
  })

  it('edits the subject noun as two inputs and the categories as rows', async () => {
    editBibleSectionAction.mockResolvedValue({ ok: true, draft: draftOf() })
    renderTab(null)
    await userEvent.click(screen.getByRole('button', { name: 'Edit Identity' }))

    const singular = screen.getByLabelText('Subject noun, singular')
    await userEvent.clear(singular)
    await userEvent.type(singular, 'case')
    expect(screen.getByLabelText('Subject noun, plural')).toBeInTheDocument()

    const rows = FIRST_CHANNEL_BIBLE.caseCategories.length
    expect(screen.getAllByRole('button', { name: /^Remove category/ })).toHaveLength(rows)
    await userEvent.click(screen.getByRole('button', { name: 'Add category' }))
    expect(screen.getAllByRole('button', { name: /^Remove category/ })).toHaveLength(rows + 1)
    await userEvent.click(screen.getAllByRole('button', { name: /^Remove category/ })[0]!)
    expect(screen.getAllByRole('button', { name: /^Remove category/ })).toHaveLength(rows)

    await userEvent.click(screen.getByRole('button', { name: 'Done editing Identity' }))
    expect(editBibleSectionAction.mock.calls[0]![2]).toMatchObject({
      subjectNoun: { singular: 'case' },
    })
  })

  describe('formats, pillar keywords, hashtag and footer', () => {
    it('edits formats as cards: add, make primary, and save two with one primary', async () => {
      editBibleSectionAction.mockResolvedValue({ ok: true, draft: draftOf() })
      renderTab(null)
      await userEvent.click(screen.getByRole('button', { name: 'Edit Formats' }))

      expect(screen.getAllByRole('group', { name: 'Documentary' })).toHaveLength(1)
      await userEvent.click(screen.getByRole('button', { name: 'Add format' }))
      const second = screen.getByRole('group', { name: 'New format' })
      expect(within(second).queryByText('Primary')).toBeNull()

      await userEvent.click(within(second).getByRole('button', { name: /^Make .* primary$/ }))
      expect(within(second).getByText('Primary')).toBeInTheDocument()
      expect(
        within(screen.getByRole('group', { name: 'Documentary' })).queryByText('Primary'),
      ).toBeNull()

      await userEvent.click(screen.getByRole('button', { name: 'Done editing Formats' }))
      const patch = editBibleSectionAction.mock.calls[0]![2] as {
        formats: { primary: boolean }[]
      }
      expect(patch.formats).toHaveLength(2)
      expect(patch.formats.filter((f) => f.primary)).toHaveLength(1)
    })

    it('refuses to remove the primary format and removes another', async () => {
      renderTab(null)
      await userEvent.click(screen.getByRole('button', { name: 'Edit Formats' }))
      await userEvent.click(screen.getByRole('button', { name: 'Add format' }))
      const first = screen.getByRole('group', { name: 'Documentary' })
      await userEvent.click(within(first).getByRole('button', { name: /^Remove format/ }))
      expect(screen.getByText('Make another format primary first')).toBeInTheDocument()
      expect(screen.getAllByRole('group', { name: /Documentary|New format/ })).toHaveLength(2)

      const second = screen.getByRole('group', { name: 'New format' })
      await userEvent.click(within(second).getByRole('button', { name: /^Remove format/ }))
      expect(screen.queryByRole('group', { name: 'New format' })).toBeNull()
    })

    it('edits a format keyword by keyword, with the schema limits on the numbers', async () => {
      editBibleSectionAction.mockResolvedValue({ ok: true, draft: draftOf() })
      renderTab(null)
      await userEvent.click(screen.getByRole('button', { name: 'Edit Formats' }))
      const format = screen.getByRole('group', { name: 'Documentary' })
      await userEvent.click(within(format).getByRole('button', { name: 'Add keyword' }))
      await userEvent.type(within(format).getByLabelText('Keyword 1'), 'ancient history')
      await userEvent.click(within(format).getByRole('button', { name: 'Add keyword' }))
      await userEvent.type(within(format).getByLabelText('Keyword 2'), 'sleep')
      await userEvent.click(within(format).getByRole('button', { name: 'Remove keyword 2' }))
      expect(within(format).queryByLabelText('Keyword 2')).toBeNull()

      const pace = within(format).getByLabelText('Narration pace (words a minute)')
      expect(pace).toHaveAttribute('type', 'number')
      expect(pace).toHaveAttribute('min', '80')
      expect(pace).toHaveAttribute('max', '200')
      const hold = within(format).getByLabelText('Picture pace (hold multiplier)')
      expect(hold).toHaveAttribute('step', '0.5')
      expect(hold).toHaveAttribute('min', '1')
      expect(hold).toHaveAttribute('max', '4')
      expect(within(format).getByLabelText('Longest')).toHaveAttribute('max', '240')

      await userEvent.selectOptions(within(format).getByLabelText('Intent'), 'calm')
      await userEvent.click(screen.getByRole('button', { name: 'Done editing Formats' }))
      const patch = editBibleSectionAction.mock.calls[0]![2] as {
        formats: { keywords: string[]; intent: string }[]
      }
      expect(patch.formats[0]).toMatchObject({ keywords: ['ancient history'], intent: 'calm' })
    })

    it('shows schema errors under the field, holds Done and adds to the save bar', async () => {
      renderTab(draftOf())
      await userEvent.click(screen.getByRole('button', { name: 'Edit Formats' }))
      const format = screen.getByRole('group', { name: 'Documentary' })
      const longest = within(format).getByLabelText('Longest')
      await userEvent.clear(longest)
      await userEvent.type(longest, '5')
      expect(within(format).getByText(/Runtime needs/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Done editing Formats' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
      expect(screen.getByText(/1 thing to fix before saving/)).toBeInTheDocument()

      await userEvent.clear(longest)
      await userEvent.type(longest, '60')
      expect(within(format).queryByText(/Runtime needs/)).toBeNull()
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()

      await userEvent.click(within(format).getByRole('checkbox', { name: 'topic' }))
      expect(
        within(format).getByText('Every required title slot must appear in the template as {slot}'),
      ).toBeInTheDocument()
      await userEvent.type(within(format).getByLabelText('Title pattern'), 'The {{topic} case')
      expect(within(format).queryByText(/Every required title slot/)).toBeNull()
    })

    it('shows the hashtag error, blocks Save, and takes the footer', async () => {
      renderTab(draftOf())
      await userEvent.click(screen.getByRole('button', { name: 'Edit Search' }))
      const tag = screen.getByLabelText('Channel hashtag')
      await userEvent.type(tag, '#history')
      expect(screen.getByText('Letters and digits only, without #')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
      await userEvent.clear(tag)
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()

      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      await userEvent.click(screen.getByRole('button', { name: 'Edit Publishing' }))
      expect(screen.getByLabelText('Channel footer')).toBeInTheDocument()
    })

    it('edits each pillar keywords as one comma-separated line', async () => {
      editBibleSectionAction.mockResolvedValue({ ok: true, draft: draftOf() })
      renderTab(null)
      await userEvent.click(screen.getByRole('button', { name: 'Edit Identity' }))
      const first = screen.getByLabelText('Category 1 keywords')
      await userEvent.clear(first)
      await userEvent.type(first, 'ancient egypt, egypt history')
      await userEvent.click(screen.getByRole('button', { name: 'Done editing Identity' }))
      const patch = editBibleSectionAction.mock.calls[0]![2] as {
        caseCategories: { keywords: string[] }[]
      }
      expect(patch.caseCategories[0]!.keywords).toEqual(['ancient egypt', 'egypt history'])
      expect(screen.queryByText('Keyword context')).toBeNull()
    })
  })

  describe('adding and removing hooks, openings and titles', () => {
    const entry = (text: string) => ({ text, note: '', drawnFrom: [] })
    const withLists = (hooks: number, titles = 0) =>
      draftOf({
        bible: {
          ...FIRST_CHANNEL_BIBLE,
          hooks: Array.from({ length: hooks }, (_, i) => entry(`hook ${i + 1}`)),
          openings: [entry('opening one')],
          titles: Array.from({ length: titles }, (_, i) => entry(`title ${i + 1}`)),
        },
      })

    it('adds a blank entry to a list and sends the whole updated list on Done', async () => {
      editBibleSectionAction.mockResolvedValue({ ok: true, draft: draftOf() })
      renderTab(withLists(1))
      await userEvent.click(screen.getByRole('button', { name: 'Edit Hooks, openings and titles' }))

      await userEvent.click(screen.getByRole('button', { name: 'Add hook' }))
      const second = screen.getByLabelText('Hooks 2 text')
      await userEvent.type(second, 'a new hook')
      await userEvent.click(
        screen.getByRole('button', { name: 'Done editing Hooks, openings and titles' }),
      )

      const [, section, patch] = editBibleSectionAction.mock.calls[0]!
      expect(section).toBe('hooks')
      expect((patch as { hooks: { text: string }[] }).hooks.map((h) => h.text)).toEqual([
        'hook 1',
        'a new hook',
      ])
    })

    it('removes one entry, so a flagged one can be dropped, and sends the rest', async () => {
      editBibleSectionAction.mockResolvedValue({ ok: true, draft: draftOf() })
      renderTab(withLists(3))
      await userEvent.click(screen.getByRole('button', { name: 'Edit Hooks, openings and titles' }))

      await userEvent.click(screen.getByRole('button', { name: 'Remove hook 2' }))
      await userEvent.click(
        screen.getByRole('button', { name: 'Done editing Hooks, openings and titles' }),
      )

      const [, , patch] = editBibleSectionAction.mock.calls[0]!
      expect((patch as { hooks: { text: string }[] }).hooks.map((h) => h.text)).toEqual([
        'hook 1',
        'hook 3',
      ])
    })

    it('can remove the last entry of a list, and sends an empty list', async () => {
      editBibleSectionAction.mockResolvedValue({ ok: true, draft: draftOf() })
      renderTab(withLists(1))
      await userEvent.click(screen.getByRole('button', { name: 'Edit Hooks, openings and titles' }))
      await userEvent.click(screen.getByRole('button', { name: 'Remove opening 1' }))
      await userEvent.click(
        screen.getByRole('button', { name: 'Done editing Hooks, openings and titles' }),
      )
      const [, , patch] = editBibleSectionAction.mock.calls[0]!
      expect((patch as { openings: unknown[] }).openings).toEqual([])
    })

    it('disables Add at twelve entries and nowhere else', async () => {
      renderTab(withLists(12, 2))
      await userEvent.click(screen.getByRole('button', { name: 'Edit Hooks, openings and titles' }))
      expect(screen.getByRole('button', { name: 'Add hook' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Add opening' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Add title' })).toBeEnabled()
    })

    it('holds Add and Remove once a run starts under an open editor', async () => {
      const draft = withLists(2)
      const { rerender } = renderTab(draft)
      await userEvent.click(screen.getByRole('button', { name: 'Edit Hooks, openings and titles' }))
      expect(screen.getByRole('button', { name: 'Add hook' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Remove hook 1' })).toBeEnabled()

      rerender(tabElement({ ...draft, job: running('Voice') }))
      expect(screen.getByRole('button', { name: 'Add hook' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Remove hook 1' })).toBeDisabled()
    })
  })

  it('shows each entry with its note and where it was drawn from, read-only', () => {
    renderTab(
      draftOf({
        bible: {
          ...FIRST_CHANNEL_BIBLE,
          hooks: [
            {
              text: 'The memo that sank a bank',
              note: 'Opens on the object',
              drawnFrom: [{ videoId: 'v1', channel: 'Alpha', title: 'The Fall' }],
            },
          ],
        },
      }),
    )
    const hooks = card('Hooks, openings and titles')
    expect(within(hooks).getByText('The memo that sank a bank')).toBeInTheDocument()
    expect(within(hooks).getByText('Opens on the object')).toBeInTheDocument()
    expect(within(hooks).getByText('From: The Fall (Alpha)')).toBeInTheDocument()
  })

  it('asks before discarding the draft', async () => {
    discardBibleDraftAction.mockResolvedValue({ ok: true })
    renderTab(draftOf())
    await userEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
    expect(discardBibleDraftAction).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
    expect(discardBibleDraftAction).toHaveBeenCalledWith(CHANNEL.id)
  })

  it('disables every control on an archived channel', () => {
    renderTab(draftOf(), { archived: true })
    expect(screen.getByRole('button', { name: 'Edit Identity' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('heads each card with its name and says what it holds', () => {
    renderTab(null)
    expect(screen.getByRole('heading', { level: 2, name: 'Channel bible' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Examples' })).toBeInTheDocument()
    expect(within(card('Examples')).getByText('44 of 44 examples written')).toBeInTheDocument()
  })
})

describe('BibleTab, copy from another channel', () => {
  const COPY = 'Copy from another channel'
  const SECTION_LABELS = [
    'Identity',
    'Formats',
    'Voice',
    'Look',
    'Examples',
    'Hooks, openings and titles',
    'Search',
    'Publishing',
  ]

  async function openPanel() {
    await userEvent.click(screen.getByRole('button', { name: COPY }))
  }

  it('shows the button with and without a draft, and not on an archived channel', () => {
    const { unmount } = renderTab(null)
    expect(screen.getByRole('button', { name: COPY })).toBeEnabled()
    unmount()
    const withDraft = renderTab(draftOf())
    expect(screen.getByRole('button', { name: COPY })).toBeEnabled()
    withDraft.unmount()
    renderTab(draftOf(), { archived: true })
    expect(screen.queryByRole('button', { name: COPY })).toBeNull()
  })

  it('waits while a job runs', () => {
    renderTab(draftOf({ job: running('Voice') }))
    expect(screen.getByRole('button', { name: COPY })).toBeDisabled()
  })

  it('lists the other channels with their versions, archived ones labelled, all boxes ticked', async () => {
    renderTab(null)
    await openPanel()
    const picker = screen.getByLabelText('Channel to copy from')
    expect(within(picker).getByRole('option', { name: 'Boom & Busters, version 4' })).toBeTruthy()
    expect(
      within(picker).getByRole('option', { name: 'Mind Matters (archived), version 2' }),
    ).toBeTruthy()
    for (const label of SECTION_LABELS) {
      expect(screen.getByRole('checkbox', { name: label })).toBeChecked()
    }
  })

  it('keeps Copy off until a channel is chosen and a box is ticked', async () => {
    renderTab(null)
    await openPanel()
    const copy = screen.getByRole('button', { name: 'Copy' })
    expect(copy).toBeDisabled()

    await userEvent.selectOptions(screen.getByLabelText('Channel to copy from'), SOURCES[0]!.id)
    expect(copy).toBeEnabled()

    for (const label of SECTION_LABELS) {
      await userEvent.click(screen.getByRole('checkbox', { name: label }))
    }
    expect(copy).toBeDisabled()
  })

  it('copies without a confirm when the draft holds no change, and prefills the note', async () => {
    const copied = draftOf({ statuses: { ...draftOf().statuses, voice: 'drafted' } })
    copyBibleFromChannelAction.mockResolvedValue({
      ok: true,
      draft: copied,
      note: 'Copied from Boom & Busters version 4',
    })
    renderTab(draftOf())
    await openPanel()
    await userEvent.selectOptions(screen.getByLabelText('Channel to copy from'), SOURCES[0]!.id)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Identity' }))
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }))

    expect(copyBibleFromChannelAction).toHaveBeenCalledWith(
      CHANNEL.id,
      SOURCES[0]!.id,
      SECTION_LABELS.filter((label) => label !== 'Identity').map((label) =>
        label === 'Hooks, openings and titles' ? 'hooks' : label.toLowerCase(),
      ),
    )
    expect(screen.getByLabelText('Version note')).toHaveValue(
      'Copied from Boom & Busters version 4',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Show what to fix' }))
    expect(screen.getByText('Voice is drafted, not approved')).toBeInTheDocument()
    // The panel closes.
    expect(screen.queryByLabelText('Channel to copy from')).toBeNull()
  })

  it('asks first, naming the sections, when the draft would be overwritten', async () => {
    copyBibleFromChannelAction.mockResolvedValue({
      ok: true,
      draft: draftOf(),
      note: 'Copied from Mind Matters version 2',
    })
    const edited = draftOf({ bible: { ...FIRST_CHANNEL_BIBLE, language: 'fr' } })
    renderTab(edited)
    await openPanel()
    await userEvent.selectOptions(screen.getByLabelText('Channel to copy from'), SOURCES[1]!.id)
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(copyBibleFromChannelAction).not.toHaveBeenCalled()
    expect(screen.getByText('This overwrites Search in the draft.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(copyBibleFromChannelAction).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Version note')).toHaveValue('Copied from Mind Matters version 2')
  })

  it('does not ask when the edited section is not ticked', async () => {
    copyBibleFromChannelAction.mockResolvedValue({ ok: true, draft: draftOf(), note: 'n' })
    renderTab(draftOf({ bible: { ...FIRST_CHANNEL_BIBLE, language: 'fr' } }))
    await openPanel()
    await userEvent.selectOptions(screen.getByLabelText('Channel to copy from'), SOURCES[0]!.id)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Search' }))
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(copyBibleFromChannelAction).toHaveBeenCalledTimes(1)
  })

  it('shows a refusal and keeps the panel open', async () => {
    copyBibleFromChannelAction.mockResolvedValue({
      ok: false,
      error: 'Wait for the draft to finish',
    })
    renderTab(null)
    await openPanel()
    await userEvent.selectOptions(screen.getByLabelText('Channel to copy from'), SOURCES[0]!.id)
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Could not copy',
        description: 'Wait for the draft to finish',
      }),
    )
    expect(screen.getByLabelText('Channel to copy from')).toBeInTheDocument()
  })

  it('closes on Cancel without copying', async () => {
    renderTab(null)
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Channel to copy from')).toBeNull()
    expect(copyBibleFromChannelAction).not.toHaveBeenCalled()
  })
})

describe('BibleTab, the tool row', () => {
  const emptyExamples = {
    id: 'x',
    version: 1,
    bible: { ...FIRST_CHANNEL_BIBLE, examples: {} },
  }
  const startTab = (over: { archived?: boolean } = {}) => (
    <BibleTab
      channel={CHANNEL}
      draft={null}
      versions={[]}
      currentVersion={emptyExamples}
      vidiqReady={false}
      archived={over.archived ?? false}
      copySources={SOURCES}
    />
  )
  const DESCRIBE = 'Describe the channel in a few lines'

  it('opens one tool panel at a time', async () => {
    renderTab(null)
    await userEvent.click(screen.getByRole('button', { name: 'History' }))
    expect(screen.getByRole('button', { name: 'History' })).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Copy from another channel' }))
    expect(screen.getByRole('button', { name: 'History' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.getByLabelText('Channel to copy from')).toBeInTheDocument()
  })

  it('closes the open panel when its button is pressed again', async () => {
    renderTab(null)
    await userEvent.click(screen.getByRole('button', { name: 'Draft with AI' }))
    expect(screen.getByLabelText(DESCRIBE)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Draft with AI' }))
    expect(screen.queryByLabelText(DESCRIBE)).toBeNull()
  })

  it('offers a start block for an unfinished bible with no draft', () => {
    render(startTab())
    expect(screen.getByRole('heading', { level: 3, name: 'Start here' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Draft with AI' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Copy from another channel' })).toHaveLength(1)
  })

  it('opens the same panel from the start block and hides the block meanwhile', async () => {
    render(startTab())
    await userEvent.click(screen.getByRole('button', { name: 'Draft with AI' }))
    expect(screen.getByLabelText(DESCRIBE)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Start here' })).toBeNull()
  })

  it('shows no start block on a finished bible, with a draft, or when archived', () => {
    const first = renderTab(null)
    expect(screen.queryByRole('heading', { name: 'Start here' })).toBeNull()
    first.unmount()
    const second = renderTab(draftOf({ bible: { ...FIRST_CHANNEL_BIBLE, examples: {} } }))
    expect(screen.queryByRole('heading', { name: 'Start here' })).toBeNull()
    second.unmount()
    render(startTab({ archived: true }))
    expect(screen.queryByRole('heading', { name: 'Start here' })).toBeNull()
  })

  it('reopens Draft with AI when a failed research is tried again', async () => {
    estimateBibleResearchAction.mockResolvedValue({ ok: true, estimate: 10, balance: 100 })
    renderTab(
      draftOf({
        job: {
          kind: 'research',
          state: 'failed',
          current: null,
          error: 'VidIQ refused',
          startedAt: new Date().toISOString(),
        },
      }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByLabelText(DESCRIBE)).toBeInTheDocument()
  })

  it('keeps History off while a draft exists and Copy off an archived channel', () => {
    const first = renderTab(draftOf())
    expect(screen.getByRole('button', { name: 'History' })).toBeDisabled()
    first.unmount()
    renderTab(null, { archived: true })
    expect(screen.queryByRole('button', { name: 'Copy from another channel' })).toBeNull()
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('BibleTab, keyword measurements', () => {
  const DAY = 24 * 60 * 60 * 1000
  const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()

  const bible = {
    ...FIRST_CHANNEL_BIBLE,
    formats: FIRST_CHANNEL_BIBLE.formats.map((format, i) =>
      i === 0
        ? {
            ...format,
            keywords: ['wework documentary', 'wework podcast', 'new term', 'fresh idea'],
          }
        : format,
    ),
    caseCategories: [{ key: 'con', label: 'Con', keywords: ['Old Reading'] }],
  }

  function renderMeasured(over: { measureCount?: number; vidiqReady?: boolean } = {}) {
    return render(
      <BibleTab
        channel={CHANNEL}
        draft={draftOf({ bible })}
        versions={[]}
        currentVersion={{ id: '01J00000000000000000000009', version: 3, bible }}
        vidiqReady={over.vidiqReady ?? true}
        archived={false}
        copySources={[]}
        readings={{
          'wework documentary': {
            volume: 64,
            competition: 38,
            measuredAt: '2026-11-02T09:00:00.000Z',
          },
          'wework podcast': { volume: null, competition: 39, measuredAt: ago(1) },
          'new term': { volume: null, competition: null, measuredAt: '2026-11-02T09:00:00.000Z' },
          'old reading': { volume: 5, competition: 5, measuredAt: ago(34) },
        }}
        measureCount={over.measureCount ?? 2}
      />,
    )
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-03T12:00:00Z') })
  })

  it('shows the latest reading beside a format keyword, and Not measured without one', () => {
    renderMeasured()
    const formats = within(card('Formats'))
    expect(formats.getByText('Volume 64, competition 38, measured 2 Nov')).toBeInTheDocument()
    expect(formats.getByText('Volume unknown, competition 39, measured 2 Nov')).toBeInTheDocument()
    expect(formats.getByText('No VidIQ data for this phrase, measured 2 Nov')).toBeInTheDocument()
    expect(formats.getByText('Not measured')).toBeInTheDocument()
  })

  it('shows a pillar keyword read more than 30 days ago as measured so many days ago, muted', () => {
    renderMeasured()
    const stale = within(card('Identity')).getByText('Measured 34 days ago')
    expect(stale.className).toContain('text-[var(--color-text-muted)]')
  })

  it('offers Measure in VidIQ on the Formats and Identity cards with the credits at 5 a keyword', () => {
    renderMeasured({ measureCount: 3 })
    for (const label of ['Formats', 'Identity']) {
      expect(
        within(card(label)).getByRole('button', { name: 'Measure in VidIQ (about 15 credits)' }),
      ).toBeEnabled()
    }
    expect(within(card('Voice')).queryByRole('button', { name: /Measure in VidIQ/ })).toBeNull()
  })

  it('hides the button when nothing is left to measure', () => {
    renderMeasured({ measureCount: 0 })
    expect(screen.queryByRole('button', { name: /Measure in VidIQ/ })).toBeNull()
  })

  it('holds the button without a VidIQ key', () => {
    renderMeasured({ vidiqReady: false })
    expect(within(card('Formats')).getByRole('button', { name: /Measure in VidIQ/ })).toBeDisabled()
  })

  it('asks for the measurement and says what it will cost', async () => {
    vi.useRealTimers()
    measureKeywordsAction.mockResolvedValue({ ok: true, credits: 10 })
    renderMeasured()
    await userEvent.click(
      within(card('Formats')).getByRole('button', { name: 'Measure in VidIQ (about 10 credits)' }),
    )
    expect(measureKeywordsAction).toHaveBeenCalledWith(CHANNEL.id)
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Measuring in VidIQ',
        description: expect.stringContaining('10 credits'),
      }),
    )
  })

  it('shows the refusal when the measurement cannot start', async () => {
    vi.useRealTimers()
    measureKeywordsAction.mockResolvedValue({ ok: false, error: 'Over the cap' })
    renderMeasured()
    await userEvent.click(
      within(card('Identity')).getByRole('button', { name: /Measure in VidIQ/ }),
    )
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Could not measure',
        description: 'Over the cap',
        variant: 'error',
      }),
    )
  })
})

describe('BibleTab, search space', () => {
  const DAY = 24 * 60 * 60 * 1000
  const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()
  const format = FIRST_CHANNEL_BIBLE.formats[0]!
  const bible = {
    ...FIRST_CHANNEL_BIBLE,
    formats: [{ ...format, keywords: ['heist stories', 'never analysed'] }],
  }

  function renderSpace(
    over: { counts?: Record<string, number>; vidiqReady?: boolean; stale?: boolean } = {},
  ) {
    return render(
      <BibleTab
        channel={CHANNEL}
        draft={draftOf({ bible })}
        versions={[]}
        currentVersion={{ id: '01J00000000000000000000009', version: 3, bible }}
        vidiqReady={over.vidiqReady ?? true}
        archived={false}
        copySources={[]}
        searchSpace={{
          'heist stories': {
            measuredAt: over.stale ? ago(40) : '2026-11-02T09:00:00.000Z',
            titlePatterns: ['The Heist That {figure}', 'How {subject} Got Away'],
            durations: { minSec: 6000, medianSec: 7500, maxSec: 11400 },
          },
        }}
        searchSpaceCounts={over.counts ?? { [format.key]: 1 }}
      />,
    )
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-03T12:00:00Z') })
  })

  it('shows the duration spread, the title patterns and the date beside the keyword', () => {
    renderSpace()
    const formats = within(card('Formats'))
    expect(
      formats.getByText('Winning videos run 1 h 40 to 3 h 10, median 2 h 05'),
    ).toBeInTheDocument()
    expect(formats.getByText('The Heist That {figure}')).toBeInTheDocument()
    expect(formats.getByText('How {subject} Got Away')).toBeInTheDocument()
    expect(formats.getByText('Analysed 2 Nov')).toBeInTheDocument()
    expect(formats.queryByText(/days ago/)).toBeNull()
  })

  it('adds a muted stale note past 30 days', () => {
    renderSpace({ stale: true })
    const note = within(card('Formats')).getByText('Analysed 40 days ago, older than 30 days')
    expect(note.className).toContain('text-[var(--color-text-muted)]')
  })

  it('offers Analyse search space with the credits at 10 a keyword, and hides it with none to do', () => {
    const { unmount } = renderSpace({ counts: { [format.key]: 2 } })
    expect(
      within(card('Formats')).getByRole('button', {
        name: 'Analyse search space (about 20 credits)',
      }),
    ).toBeEnabled()
    unmount()
    renderSpace({ counts: { [format.key]: 0 } })
    expect(screen.queryByRole('button', { name: /Analyse search space/ })).toBeNull()
  })

  it('holds the button without a VidIQ key', () => {
    renderSpace({ vidiqReady: false })
    expect(
      within(card('Formats')).getByRole('button', { name: /Analyse search space/ }),
    ).toBeDisabled()
  })

  it('asks for the analysis of that format and says what it will cost', async () => {
    vi.useRealTimers()
    analyseSearchSpaceAction.mockResolvedValue({ ok: true, credits: 10 })
    renderSpace()
    await userEvent.click(
      within(card('Formats')).getByRole('button', { name: /Analyse search space/ }),
    )
    expect(analyseSearchSpaceAction).toHaveBeenCalledWith(CHANNEL.id, format.key)
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Analysing the search space',
        description: expect.stringContaining('10 credits'),
      }),
    )
  })

  it('shows the refusal when the analysis cannot start', async () => {
    vi.useRealTimers()
    analyseSearchSpaceAction.mockResolvedValue({ ok: false, error: 'Over the cap' })
    renderSpace()
    await userEvent.click(
      within(card('Formats')).getByRole('button', { name: /Analyse search space/ }),
    )
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Could not analyse',
        description: 'Over the cap',
        variant: 'error',
      }),
    )
  })
})
