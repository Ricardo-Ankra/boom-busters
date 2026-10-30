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
vi.mock('./bible-actions', () => ({
  approveBibleSectionAction: (...args: unknown[]) => approveBibleSectionAction(...args),
  discardBibleDraftAction: (...args: unknown[]) => discardBibleDraftAction(...args),
  draftBibleAction: (...args: unknown[]) => draftBibleAction(...args),
  estimateBibleResearchAction: (...args: unknown[]) => estimateBibleResearchAction(...args),
  startBibleResearchAction: (...args: unknown[]) => startBibleResearchAction(...args),
  editBibleSectionAction: (...args: unknown[]) => editBibleSectionAction(...args),
  saveBibleAction: (...args: unknown[]) => saveBibleAction(...args),
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

function tabElement(draft: BibleDraft | null, over: { archived?: boolean } = {}) {
  return (
    <BibleTab
      channel={CHANNEL}
      draft={draft}
      versions={[]}
      currentVersion={{ id: '01J00000000000000000000009', version: 3, bible: FIRST_CHANNEL_BIBLE }}
      vidiqReady={false}
      archived={over.archived ?? false}
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
          keywordContext: '',
          channelTags: [],
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
    expect(screen.getByText('Voice is drafted, not approved')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Approve Voice' }))
    expect(approveBibleSectionAction).toHaveBeenCalledWith(CHANNEL.id, 'voice')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(screen.queryByText('Voice is drafted, not approved')).toBeNull()
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

  it('disables Approve on a flagged field and shows the shared run and its source', () => {
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
    expect(screen.getByText('examples.' + SLOT.id + ' is too close to its source')).toBeVisible()
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
    expect(within(examples).getAllByText('New slot, needs an example')).toHaveLength(
      EXAMPLE_SLOTS.length,
    )
    expect(within(examples).getAllByText(`In: ${SLOT.source}`).length).toBeGreaterThan(0)
    expect(within(examples).getAllByText(SLOT.teaches).length).toBeGreaterThan(0)

    await userEvent.click(within(examples).getByRole('button', { name: `Draft ${SLOT.id}` }))
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
})

afterEach(() => {
  vi.useRealTimers()
})
