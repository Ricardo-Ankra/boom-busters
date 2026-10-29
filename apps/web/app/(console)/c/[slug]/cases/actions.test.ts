// @vitest-environment node

import type * as ChannelLookup from '@/lib/channel-lookup'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EMPTY_BIBLE,
  FIRST_CHANNEL_BIBLE,
  FIRST_CHANNEL_ID as CHANNEL_ID,
} from '@boom-busters/schemas'
import { addCase, editCase, startProjectFromCase, suggestCases } from './actions'

/**
 * `Suggest cases` on the answer helper (decision 293), with the database,
 * the session and the model call replaced: at most two calls, each created
 * case's repairs filed on its own row, and what no row can show (a dropped
 * suggestion, the cut to the number asked for) in the toast line.
 */

const store = vi.hoisted(() => ({
  createCase: vi.fn(),
  updateCase: vi.fn(),
  existingCaseTitles: vi.fn(),
  createSuggestedCases: vi.fn(),
  getCase: vi.fn(),
  channelForCase: vi.fn(),
  createProjectFromCase: vi.fn(),
  markCaseInProduction: vi.fn(),
  setProjectStage: vi.fn(),
}))
const findChannel = vi.hoisted(() => vi.fn())
vi.mock('@/lib/channel-lookup', async (importOriginal) => ({
  ...(await importOriginal<typeof ChannelLookup>()),
  findChannel,
}))
vi.mock('@boom-busters/db', () => store)
vi.mock('@/lib/db', () => ({ db: { marker: 'db' } }))
vi.mock('@/auth', () => ({ auth: async () => ({ user: { email: 'owner@example.com' } }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/inngest/client', () => ({ inngest: { send: vi.fn() } }))
const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))
const recordRepairs = vi.hoisted(() => vi.fn())
vi.mock('@/lib/notices', () => ({ recordRepairs }))

const wirecard = {
  title: 'Wirecard',
  category: 'con',
  angle: 'The auditor sign-offs are the story, not the missing billion.',
  demandNotes: 'Sustained search interest since the 2020 collapse.',
  competitorLinks: [{ url: 'https://example.com/video', note: 'surface level' }],
  priorityScore: 88,
  subject: 'Wirecard',
  people: [],
}

const reply = (...suggestions: Record<string, unknown>[]) => ({
  text: JSON.stringify({ suggestions }),
})

/** What `createSuggestedCases` hands back: one row per title, ids in order. */
const rows = (...titles: string[]) => ({
  created: titles.map((title, at) => ({ id: `01J00000000000000000000C0${at + 1}`, title })),
  skippedTitles: [],
})

describe('suggestCases on the answer helper (decision 293)', () => {
  beforeEach(() => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockReset()
    recordRepairs.mockReset()
    store.existingCaseTitles.mockReset().mockResolvedValue([])
    store.createSuggestedCases.mockReset()
    findChannel
      .mockReset()
      .mockResolvedValue({ id: CHANNEL_ID, bible: FIRST_CHANNEL_BIBLE, archivedAt: null })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('asks once more with the reason after a refusal, labelled in the ledger', async () => {
    callLlm.mockResolvedValueOnce({ text: 'no json here' }).mockResolvedValueOnce(reply(wirecard))
    store.createSuggestedCases.mockResolvedValue(rows('Wirecard'))

    expect(await suggestCases(CHANNEL_ID, { count: 3 })).toEqual({
      ok: true,
      created: 1,
      skipped: 0,
      mocked: false,
    })
    expect(callLlm).toHaveBeenCalledTimes(2)
    expect(callLlm.mock.calls[0]![1]).toEqual({ channelId: CHANNEL_ID })
    expect(callLlm.mock.calls[1]![1]).toEqual({
      channelId: CHANNEL_ID,
      purpose: 'retry: refused',
    })
    expect(callLlm.mock.calls[1]![0].messages.at(-1).content).toMatch(
      /^Your previous answer was refused: The model returned no JSON for case suggestions/,
    )
    expect(recordRepairs).not.toHaveBeenCalled()
  })

  it('creates nothing after two refusals, and says why', async () => {
    callLlm.mockResolvedValue({ text: 'no json here' })

    const result = await suggestCases(CHANNEL_ID, { count: 3 })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/^The model returned no JSON for case suggestions/)
    expect(callLlm).toHaveBeenCalledTimes(2)
    expect(store.createSuggestedCases).not.toHaveBeenCalled()
  })

  it("files each created case's repairs on its own row", async () => {
    callLlm.mockResolvedValueOnce(
      reply(
        { ...wirecard, angle: 'The auditors signed off for a decade. '.repeat(60) },
        { ...wirecard, title: 'Theranos', priorityScore: 104.6 },
        { ...wirecard, title: 'Enron' },
      ),
    )
    store.createSuggestedCases.mockResolvedValue(rows('Wirecard', 'Theranos', 'Enron'))

    expect(await suggestCases(CHANNEL_ID, { count: 3 })).toEqual({
      ok: true,
      created: 3,
      skipped: 0,
      mocked: false,
    })
    const inputs = store.createSuggestedCases.mock.calls[0]![2] as { priorityScore: number }[]
    expect(inputs.map((input) => input.priorityScore)).toEqual([88, 100, 88])
    expect(recordRepairs.mock.calls).toEqual([
      [
        { projectId: null, subject: 'case', subjectId: '01J00000000000000000000C01' },
        [{ action: 'trimmed', field: 'the angle of Wirecard' }],
      ],
      [
        { projectId: null, subject: 'case', subjectId: '01J00000000000000000000C02' },
        [{ action: 'rounded', field: 'the priority score of Theranos', from: 104.6, to: 100 }],
      ],
    ])
  })

  it('names a dropped suggestion and the cut to the number asked for in the toast line', async () => {
    const title = `The ${'very '.repeat(50)}long case`
    callLlm.mockResolvedValueOnce(
      reply(
        wirecard,
        { ...wirecard, title },
        { ...wirecard, title: 'Theranos' },
        { ...wirecard, title: 'Enron' },
      ),
    )
    store.createSuggestedCases.mockResolvedValue(rows('Wirecard', 'Theranos'))

    const result = await suggestCases(CHANNEL_ID, { count: 2 })
    expect(result).toMatchObject({ ok: true, created: 2 })
    expect(result.notice).toBe(
      `Dropped suggestion 2 ("The${' very'.repeat(11)}..."): its title ran over 200 characters. ` +
        'Kept the first 2 suggestions.',
    )
    const inputs = store.createSuggestedCases.mock.calls[0]![2] as { title: string }[]
    expect(inputs.map((input) => input.title)).toEqual(['Wirecard', 'Theranos'])
    expect(recordRepairs).not.toHaveBeenCalled()
  })
})

describe('the case form actions: subject, people and source links', () => {
  const form = {
    title: 'Wirecard',
    category: 'con',
    priorityScore: 50,
    subject: 'Wirecard',
    people: ['Markus Braun'],
    sourceLinks: [{ url: 'https://example.com/a' }],
  }

  beforeEach(() => {
    store.createCase.mockReset().mockResolvedValue({ id: 'x' })
    store.updateCase.mockReset().mockResolvedValue({ id: 'x' })
  })

  it('stores the three fields on a new case', async () => {
    expect(await addCase(CHANNEL_ID, form)).toEqual({ ok: true })
    expect(store.createCase.mock.calls[0]![1]).toMatchObject({
      subject: 'Wirecard',
      people: ['Markus Braun'],
      sourceLinks: [{ url: 'https://example.com/a' }],
      status: 'shortlisted',
    })
  })

  it('refuses a new case with no subject', async () => {
    const { subject: _subject, ...bare } = form
    expect((await addCase(CHANNEL_ID, bare)).ok).toBe(false)
    expect((await addCase(CHANNEL_ID, { ...form, subject: ' ' })).ok).toBe(false)
    expect(store.createCase).not.toHaveBeenCalled()
  })

  it('refuses a source link that is not http or https, and more than 20', async () => {
    const bad = await addCase(CHANNEL_ID, {
      ...form,
      sourceLinks: [{ url: 'ftp://example.com/a' }],
    })
    expect(bad).toEqual({
      ok: false,
      error: 'Each source link must start with http:// or https://',
    })
    const many = Array.from({ length: 21 }, (_, at) => ({ url: `https://example.com/${at}` }))
    expect((await addCase(CHANNEL_ID, { ...form, sourceLinks: many })).ok).toBe(false)
    expect(store.createCase).not.toHaveBeenCalled()
  })

  it('defaults people and source links to empty', async () => {
    await addCase(CHANNEL_ID, {
      title: 'Wirecard',
      category: 'con',
      priorityScore: 50,
      subject: 'Wirecard',
    })
    expect(store.createCase.mock.calls[0]![1]).toMatchObject({ people: [], sourceLinks: [] })
  })

  it('edits the three fields without needing the rest', async () => {
    const id = '01J00000000000000000000C01'
    expect(
      await editCase(id, { subject: 'Enron', people: [], sourceLinks: [{ url: 'http://a.com' }] }),
    ).toEqual({ ok: true })
    expect(store.updateCase.mock.calls[0]![2]).toEqual({
      subject: 'Enron',
      people: [],
      sourceLinks: [{ url: 'http://a.com' }],
    })
  })

  it('files a suggestion subject and people on the created case', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockReset().mockResolvedValueOnce(reply({ ...wirecard, people: ['Markus Braun'] }))
    store.existingCaseTitles.mockReset().mockResolvedValue([])
    store.createSuggestedCases.mockReset().mockResolvedValue(rows('Wirecard'))
    await suggestCases(CHANNEL_ID, { count: 1 })
    expect(store.createSuggestedCases.mock.calls[0]![2][0]).toMatchObject({
      subject: 'Wirecard',
      people: ['Markus Braun'],
    })
    vi.unstubAllEnvs()
  })
})

describe('the channel bible gate and an unknown channel', () => {
  const UNKNOWN_ID = '01BB0000000000000000000099'

  beforeEach(() => {
    callLlm.mockReset()
    store.createCase.mockReset()
    store.getCase.mockReset()
    store.channelForCase.mockReset()
    store.createProjectFromCase.mockReset()
    findChannel
      .mockReset()
      .mockResolvedValue({ id: CHANNEL_ID, bible: EMPTY_BIBLE, archivedAt: null })
  })

  it('suggestCases refuses a channel whose bible is incomplete, before any model call', async () => {
    expect(await suggestCases(CHANNEL_ID, { count: 3 })).toEqual({
      ok: false,
      error: 'Complete the channel bible in Settings first',
    })
    expect(callLlm).not.toHaveBeenCalled()
  })

  it('startProjectFromCase refuses a case on a channel whose bible is incomplete', async () => {
    store.getCase.mockResolvedValue({ id: CHANNEL_ID, title: 'Wirecard', status: 'shortlisted' })
    store.channelForCase.mockResolvedValue({ id: CHANNEL_ID, bible: EMPTY_BIBLE, archivedAt: null })

    expect(await startProjectFromCase(CHANNEL_ID)).toEqual({
      ok: false,
      error: 'Complete the channel bible in Settings first',
    })
    expect(store.createProjectFromCase).not.toHaveBeenCalled()
  })

  it('addCase and suggestCases say Unknown channel for a well-formed id that names none', async () => {
    findChannel.mockResolvedValue(null)

    expect(await addCase(UNKNOWN_ID, { title: 'Enron' })).toEqual({
      ok: false,
      error: 'Unknown channel',
    })
    expect(await suggestCases(UNKNOWN_ID, { count: 3 })).toEqual({
      ok: false,
      error: 'Unknown channel',
    })
    expect(store.createCase).not.toHaveBeenCalled()
  })
})

describe('case categories come from the channel bible', () => {
  const SECOND_ID = '01BB0000000000000000000002'
  const psychology = {
    ...FIRST_CHANNEL_BIBLE,
    caseCategories: [{ key: 'experiment', label: 'Experiment' }],
  }
  const form = { title: 'Milgram', priorityScore: 50, subject: 'Milgram' }

  beforeEach(() => {
    store.createCase.mockReset().mockResolvedValue({ id: 'x' })
    store.updateCase.mockReset().mockResolvedValue({ id: 'x' })
    store.channelForCase.mockReset()
    callLlm.mockReset()
    store.createSuggestedCases.mockReset()
    findChannel
      .mockReset()
      .mockResolvedValue({ id: CHANNEL_ID, bible: FIRST_CHANNEL_BIBLE, archivedAt: null })
  })

  it('addCase refuses a key the bible does not list, and inserts nothing', async () => {
    expect(await addCase(CHANNEL_ID, { ...form, category: 'heist' })).toEqual({
      ok: false,
      error: "That category is not in this channel's bible",
    })
    expect(store.createCase).not.toHaveBeenCalled()
  })

  it('addCase passes each of the first channel five keys', async () => {
    for (const key of ['collapse', 'con', 'meltdown', 'turnaround', 'empire']) {
      expect(await addCase(CHANNEL_ID, { ...form, category: key })).toEqual({ ok: true })
    }
    expect(store.createCase).toHaveBeenCalledTimes(5)
  })

  it("addCase checks the channel's own bible, not Boom & Busters'", async () => {
    findChannel.mockResolvedValue({ id: SECOND_ID, bible: psychology, archivedAt: null })
    expect(await addCase(SECOND_ID, { ...form, category: 'collapse' })).toMatchObject({
      ok: false,
      error: "That category is not in this channel's bible",
    })
    expect(await addCase(SECOND_ID, { ...form, category: 'experiment' })).toEqual({ ok: true })
  })

  it('editCase refuses a key the bible does not list, and updates nothing', async () => {
    store.channelForCase.mockResolvedValue({ id: SECOND_ID, bible: psychology, archivedAt: null })
    expect(await editCase('01J00000000000000000000C01', { category: 'collapse' })).toEqual({
      ok: false,
      error: "That category is not in this channel's bible",
    })
    expect(store.updateCase).not.toHaveBeenCalled()
    expect(await editCase('01J00000000000000000000C01', { category: 'experiment' })).toEqual({
      ok: true,
    })
  })

  it('suggestCases refuses on any channel but the first, before any model call', async () => {
    findChannel.mockResolvedValue({ id: SECOND_ID, bible: FIRST_CHANNEL_BIBLE, archivedAt: null })
    expect(await suggestCases(SECOND_ID, { count: 3 })).toEqual({
      ok: false,
      error: 'Suggest cases is only available on the first channel',
    })
    expect(callLlm).not.toHaveBeenCalled()
    expect(store.createSuggestedCases).not.toHaveBeenCalled()
  })
})
