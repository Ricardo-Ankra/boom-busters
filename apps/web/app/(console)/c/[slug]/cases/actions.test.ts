// @vitest-environment node

import type * as ChannelLookup from '@/lib/channel-lookup'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaseResearchJob } from '@boom-busters/schemas'
import {
  EMPTY_BIBLE,
  defaultFormat,
  FIRST_CHANNEL_BIBLE,
  FIRST_CHANNEL_ID as CHANNEL_ID,
} from '@boom-busters/schemas'
import {
  addCase,
  caseResearchEstimate,
  chooseAngleAction,
  editCase,
  researchCaseAction,
  setCaseFormatAction,
  setTargetKeywordAction,
  startProjectFromCase,
} from './actions'

const store = vi.hoisted(() => ({
  createCase: vi.fn(),
  updateCase: vi.fn(),
  getCase: vi.fn(),
  channelForCase: vi.fn(),
  createProjectFromCase: vi.fn(),
  markCaseInProduction: vi.fn(),
  setProjectStage: vi.fn(),
  writeCaseResearchJob: vi.fn(),
  caseSubjectTaken: vi.fn(),
  chooseCaseAngle: vi.fn(),
  setCaseTargetKeyword: vi.fn(),
  setCaseFormat: vi.fn(),
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
const send = vi.hoisted(() => vi.fn())
vi.mock('@/inngest/client', () => ({ inngest: { send } }))
const checkVidiqBudget = vi.hoisted(() => vi.fn())
vi.mock('@/lib/vidiq-spend', () => ({ checkVidiqBudget }))

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
    store.caseSubjectTaken.mockReset().mockResolvedValue(false)
    findChannel
      .mockReset()
      .mockResolvedValue({ id: CHANNEL_ID, bible: FIRST_CHANNEL_BIBLE, archivedAt: null })
    store.channelForCase
      .mockReset()
      .mockResolvedValue({ id: CHANNEL_ID, bible: FIRST_CHANNEL_BIBLE, archivedAt: null })
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

  it('writes a priority score of 0 on a new case, whatever the form sent', async () => {
    await addCase(CHANNEL_ID, form)
    await addCase(CHANNEL_ID, { ...form, priorityScore: undefined })
    const { priorityScore: _sent, ...noScore } = form
    await addCase(CHANNEL_ID, noScore)
    for (const call of store.createCase.mock.calls) {
      expect(call[1]).toMatchObject({ priorityScore: 0 })
    }
  })

  it('refuses a duplicate subject on add and on edit, writing nothing', async () => {
    store.caseSubjectTaken.mockResolvedValue(true)
    expect(await addCase(CHANNEL_ID, form)).toEqual({
      ok: false,
      error: 'A case for this subject already exists',
    })
    expect(store.caseSubjectTaken).toHaveBeenCalledWith({ marker: 'db' }, CHANNEL_ID, 'Wirecard')
    expect(store.createCase).not.toHaveBeenCalled()

    const id = '01J00000000000000000000C01'
    expect(await editCase(id, { subject: 'Wirecard' })).toEqual({
      ok: false,
      error: 'A case for this subject already exists',
    })
    expect(store.caseSubjectTaken).toHaveBeenLastCalledWith(
      { marker: 'db' },
      CHANNEL_ID,
      'Wirecard',
      id,
    )
    expect(store.updateCase).not.toHaveBeenCalled()
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
})

describe('the channel bible gate and an unknown channel', () => {
  const UNKNOWN_ID = '01BB0000000000000000000099'

  beforeEach(() => {
    store.createCase.mockReset()
    store.getCase.mockReset()
    store.channelForCase.mockReset()
    store.createProjectFromCase.mockReset()
    findChannel
      .mockReset()
      .mockResolvedValue({ id: CHANNEL_ID, bible: EMPTY_BIBLE, archivedAt: null })
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

  it('addCase says Unknown channel for a well-formed id that names none', async () => {
    findChannel.mockResolvedValue(null)

    expect(await addCase(UNKNOWN_ID, { title: 'Enron' })).toEqual({
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
    store.caseSubjectTaken.mockReset().mockResolvedValue(false)
    store.createCase.mockReset().mockResolvedValue({ id: 'x' })
    store.updateCase.mockReset().mockResolvedValue({ id: 'x' })
    store.channelForCase.mockReset()
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
})

/**
 * `Research with VidIQ` on a case: every refusal (the owner, the case, the
 * channel, the estimate against the cap and the balance, a run already going)
 * comes before the job is stamped or any event is sent.
 */
describe('researchCaseAction and caseResearchEstimate', () => {
  const CASE_ID = '01J00000000000000000000C01'
  const caseRow = (over: Record<string, unknown> = {}) => ({
    id: CASE_ID,
    subject: 'WeWork',
    status: 'shortlisted',
    searchJob: null,
    ...over,
  })
  const running = (over: Partial<CaseResearchJob> = {}): CaseResearchJob => ({
    state: 'running',
    current: null,
    error: null,
    startedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    subject: 'WeWork',
    ...over,
  })
  /** What `cases.search_job` holds, as the mocked lock-and-write sees it. */
  let stored: CaseResearchJob | null

  beforeEach(() => {
    stored = null
    send.mockReset().mockResolvedValue(undefined)
    checkVidiqBudget.mockReset().mockResolvedValue({ ok: true, balance: 1443, capLeft: 1000 })
    store.getCase.mockReset().mockResolvedValue(caseRow())
    store.channelForCase
      .mockReset()
      .mockResolvedValue({ id: CHANNEL_ID, bible: FIRST_CHANNEL_BIBLE, archivedAt: null })
    store.writeCaseResearchJob.mockReset().mockImplementation(async (_db, _id, update) => {
      stored = update(stored)
      return stored
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stamps the job with the case subject and sends the run', async () => {
    expect(await researchCaseAction(CASE_ID)).toEqual({ ok: true })
    expect(checkVidiqBudget).toHaveBeenCalledWith(20)
    expect(stored).toMatchObject({ state: 'running', error: null, subject: 'WeWork' })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]![0]).toMatchObject({
      name: 'case/research.requested',
      data: { caseId: CASE_ID, jobStartedAt: stored!.startedAt },
    })
  })

  it('refuses an unknown, missing or retired case, and a case with no subject', async () => {
    expect(await researchCaseAction('nope')).toEqual({ ok: false, error: 'Unknown case' })
    store.getCase.mockResolvedValue(null)
    expect(await researchCaseAction(CASE_ID)).toEqual({
      ok: false,
      error: 'That case no longer exists',
    })
    store.getCase.mockResolvedValue(caseRow({ status: 'retired' }))
    expect(await researchCaseAction(CASE_ID)).toEqual({
      ok: false,
      error: 'That case is retired. Move it back to shortlisted first.',
    })
    store.getCase.mockResolvedValue(caseRow({ subject: null }))
    expect(await researchCaseAction(CASE_ID)).toEqual({
      ok: false,
      error: 'Give the case a subject before researching it',
    })
    expect(checkVidiqBudget).not.toHaveBeenCalled()
    expect(store.writeCaseResearchJob).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('refuses a case on an archived channel, before the estimate', async () => {
    store.channelForCase.mockResolvedValue({
      id: CHANNEL_ID,
      bible: FIRST_CHANNEL_BIBLE,
      archivedAt: new Date(),
    })
    const result = await researchCaseAction(CASE_ID)
    expect(result.ok).toBe(false)
    expect(checkVidiqBudget).not.toHaveBeenCalled()
    expect(store.writeCaseResearchJob).not.toHaveBeenCalled()
  })

  it('refuses on the estimate against the cap or the balance, before the job is stamped', async () => {
    for (const error of [
      "This run needs about 20 credits; 5 are left of this month's cap of 1000.",
      'This run needs about 20 credits; the VidIQ balance is 10.',
      'Add a VidIQ key in Settings, Connections',
    ]) {
      checkVidiqBudget.mockResolvedValue({ ok: false, error })
      expect(await researchCaseAction(CASE_ID)).toEqual({ ok: false, error })
    }
    expect(store.writeCaseResearchJob).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('refuses a second press while a run is going, leaving that run alone', async () => {
    stored = running()
    store.getCase.mockResolvedValue(caseRow({ searchJob: stored }))
    const before = stored
    expect(await researchCaseAction(CASE_ID)).toEqual({
      ok: false,
      error: 'Research is already running for this case',
    })
    expect(stored).toBe(before)
    expect(send).not.toHaveBeenCalled()
  })

  it('refuses when another press stamped a job between the check and the stamp', async () => {
    // The case read shows no job, but the locked write finds a running one.
    stored = running({ startedAt: '2020-01-01T00:00:00.000Z' })
    expect(await researchCaseAction(CASE_ID)).toEqual({
      ok: false,
      error: 'Research is already running for this case',
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('takes over a job that has gone stale', async () => {
    const old = new Date(Date.now() - 40 * 60_000).toISOString()
    stored = running({ startedAt: old, heartbeatAt: old })
    store.getCase.mockResolvedValue(caseRow({ searchJob: stored }))
    expect(await researchCaseAction(CASE_ID)).toEqual({ ok: true })
    expect(stored!.startedAt).not.toBe(old)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('marks the job failed when Inngest cannot be reached, and says how to start it', async () => {
    send.mockRejectedValue(new Error('connect ECONNREFUSED'))
    const result = await researchCaseAction(CASE_ID)
    expect(result).toEqual({
      ok: false,
      error:
        'Could not reach Inngest to start the research. ' +
        'Start the dev server with `npx inngest-cli@latest dev`, or check INNGEST_EVENT_KEY.',
    })
    expect(stored).toMatchObject({
      state: 'failed',
      current: null,
      error: 'The research run could not be started',
    })
  })

  it('leaves a newer job alone when its own send fails', async () => {
    send.mockImplementation(async () => {
      // A newer press took the job while this send was in flight.
      stored = running({ startedAt: '2099-01-01T00:00:00.000Z', heartbeatAt: undefined })
      throw new Error('boom')
    })
    await researchCaseAction(CASE_ID)
    expect(stored).toMatchObject({ state: 'running', startedAt: '2099-01-01T00:00:00.000Z' })
  })

  it('the estimate is 20 credits with what is left of the cap and the balance, and spends nothing', async () => {
    expect(await caseResearchEstimate(CASE_ID)).toEqual({
      ok: true,
      credits: 20,
      capLeft: 1000,
      balance: 1443,
    })
    expect(store.writeCaseResearchJob).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('the estimate passes a refusal through, and refuses an unknown or missing case', async () => {
    checkVidiqBudget.mockResolvedValue({
      ok: false,
      error: 'This run needs about 20 credits; the VidIQ balance is 10.',
    })
    expect(await caseResearchEstimate(CASE_ID)).toEqual({
      ok: false,
      error: 'This run needs about 20 credits; the VidIQ balance is 10.',
    })
    expect(await caseResearchEstimate('nope')).toEqual({ ok: false, error: 'Unknown case' })
    store.getCase.mockResolvedValue(null)
    expect(await caseResearchEstimate(CASE_ID)).toEqual({
      ok: false,
      error: 'That case no longer exists',
    })
  })
})

describe('setCaseFormatAction and the estimate by format', () => {
  const CASE_ID = '01J00000000000000000000C01'
  const sleep = {
    ...defaultFormat('Sleep'),
    key: 'sleep',
    primary: false,
    keywords: ['sleep documentary'],
  }
  const bible = { ...FIRST_CHANNEL_BIBLE, formats: [defaultFormat('Main'), sleep] }
  const channel = (archivedAt: Date | null = null) => ({ id: CHANNEL_ID, bible, archivedAt })

  beforeEach(() => {
    store.setCaseFormat.mockReset().mockResolvedValue(undefined)
    store.channelForCase.mockReset().mockResolvedValue(channel())
    store.getCase
      .mockReset()
      .mockResolvedValue({ id: CASE_ID, subject: 'WeWork', status: 'shortlisted', formatKey: null })
    checkVidiqBudget.mockReset().mockResolvedValue({ ok: true, balance: 1443, capLeft: 1000 })
  })

  it('stores a key the bible has, and clears with null', async () => {
    expect(await setCaseFormatAction(CASE_ID, 'sleep')).toEqual({ ok: true })
    expect(store.setCaseFormat).toHaveBeenLastCalledWith({ marker: 'db' }, CASE_ID, 'sleep')
    expect(await setCaseFormatAction(CASE_ID, null)).toEqual({ ok: true })
    expect(store.setCaseFormat).toHaveBeenLastCalledWith({ marker: 'db' }, CASE_ID, null)
  })

  it("refuses a key the channel's bible lacks, writing nothing", async () => {
    expect(await setCaseFormatAction(CASE_ID, 'gone')).toEqual({
      ok: false,
      error: "That format is not in the channel's bible",
    })
    expect(store.setCaseFormat).not.toHaveBeenCalled()
  })

  it('refuses a bad id, a missing case and an archived channel', async () => {
    expect((await setCaseFormatAction('nope', 'sleep')).ok).toBe(false)
    store.channelForCase.mockResolvedValue(null)
    expect((await setCaseFormatAction(CASE_ID, 'sleep')).ok).toBe(false)
    store.channelForCase.mockResolvedValue(channel(new Date()))
    expect((await setCaseFormatAction(CASE_ID, 'sleep')).ok).toBe(false)
    expect(store.setCaseFormat).not.toHaveBeenCalled()
  })

  it('the estimate and the run cost 25 when the case format has a lead keyword', async () => {
    store.getCase.mockResolvedValue({
      id: CASE_ID,
      subject: 'WeWork',
      status: 'shortlisted',
      searchJob: null,
      formatKey: 'sleep',
    })
    expect(await caseResearchEstimate(CASE_ID)).toMatchObject({ ok: true, credits: 25 })
    expect(checkVidiqBudget).toHaveBeenLastCalledWith(25)
    store.writeCaseResearchJob.mockImplementation(async (_db, _id, update) => update(null))
    await researchCaseAction(CASE_ID)
    expect(checkVidiqBudget).toHaveBeenLastCalledWith(25)
  })

  it('a stored key no longer in the bible costs the primary format price', async () => {
    store.getCase.mockResolvedValue({
      id: CASE_ID,
      subject: 'WeWork',
      status: 'shortlisted',
      formatKey: 'gone',
    })
    expect(await caseResearchEstimate(CASE_ID)).toMatchObject({ ok: true, credits: 20 })
  })
})

describe('the angle and target keyword actions', () => {
  const CASE_ID = '01J00000000000000000000C01'

  beforeEach(() => {
    store.chooseCaseAngle.mockReset().mockResolvedValue({ id: CASE_ID })
    store.setCaseTargetKeyword.mockReset().mockResolvedValue({ id: CASE_ID })
    store.channelForCase
      .mockReset()
      .mockResolvedValue({ id: CHANNEL_ID, bible: FIRST_CHANNEL_BIBLE, archivedAt: null })
  })

  it('chooseAngleAction passes an option or the owner own words to the db', async () => {
    expect(await chooseAngleAction(CASE_ID, { option: 1 })).toEqual({ ok: true })
    expect(store.chooseCaseAngle).toHaveBeenLastCalledWith({ marker: 'db' }, CASE_ID, {
      option: 1,
    })
    expect(await chooseAngleAction(CASE_ID, { own: '  The auditors are the story.  ' })).toEqual({
      ok: true,
    })
    expect(store.chooseCaseAngle).toHaveBeenLastCalledWith({ marker: 'db' }, CASE_ID, {
      own: 'The auditors are the story.',
    })
  })

  it('chooseAngleAction refuses a bad id, a bad choice and an archived channel', async () => {
    expect((await chooseAngleAction('nope', { option: 0 })).ok).toBe(false)
    expect((await chooseAngleAction(CASE_ID, { option: -1 })).ok).toBe(false)
    expect((await chooseAngleAction(CASE_ID, { own: '   ' })).ok).toBe(false)
    store.channelForCase.mockResolvedValue({
      id: CHANNEL_ID,
      bible: FIRST_CHANNEL_BIBLE,
      archivedAt: new Date(),
    })
    expect((await chooseAngleAction(CASE_ID, { option: 0 })).ok).toBe(false)
    expect(store.chooseCaseAngle).not.toHaveBeenCalled()
  })

  it('chooseAngleAction says what the db refused, rather than throwing', async () => {
    store.chooseCaseAngle.mockRejectedValue(new Error('angle option 2 does not exist'))
    expect(await chooseAngleAction(CASE_ID, { option: 2 })).toEqual({
      ok: false,
      error: 'angle option 2 does not exist',
    })
  })

  it('setTargetKeywordAction sets the keyword, and refuses a figure before the db', async () => {
    expect(await setTargetKeywordAction(CASE_ID, 'wework documentary')).toEqual({ ok: true })
    expect(store.setCaseTargetKeyword).toHaveBeenCalledWith(
      { marker: 'db' },
      CASE_ID,
      'wework documentary',
    )
    const refused = await setTargetKeywordAction(CASE_ID, 'wework $47 billion')
    expect(refused.ok).toBe(false)
    expect(store.setCaseTargetKeyword).toHaveBeenCalledTimes(1)
  })

  it('setTargetKeywordAction says what the db refused, rather than throwing', async () => {
    store.setCaseTargetKeyword.mockRejectedValue(new Error('this case has no search brief'))
    expect(await setTargetKeywordAction(CASE_ID, 'wework')).toEqual({
      ok: false,
      error: 'this case has no search brief',
    })
  })
})

describe('startProjectFromCase and the search brief', () => {
  const CASE_ID = '01J00000000000000000000C01'

  it('hands the case to createProjectFromCase, which freezes its brief; the action never refreshes', async () => {
    store.getCase.mockReset().mockResolvedValue({
      id: CASE_ID,
      title: 'WeWork',
      status: 'shortlisted',
      searchBrief: { subject: 'WeWork' },
    })
    store.channelForCase
      .mockReset()
      .mockResolvedValue({ id: CHANNEL_ID, bible: FIRST_CHANNEL_BIBLE, archivedAt: null })
    store.createProjectFromCase.mockReset().mockResolvedValue({ id: 'P1' })
    store.markCaseInProduction.mockReset().mockResolvedValue(undefined)
    send.mockReset().mockResolvedValue(undefined)
    checkVidiqBudget.mockReset()
    store.writeCaseResearchJob.mockReset()

    expect(await startProjectFromCase(CASE_ID, 12)).toEqual({ ok: true, projectId: 'P1' })
    expect(store.createProjectFromCase).toHaveBeenCalledWith(
      { marker: 'db' },
      { caseId: CASE_ID, title: 'WeWork', targetRuntimeMin: 12 },
    )
    expect(checkVidiqBudget).not.toHaveBeenCalled()
    expect(store.writeCaseResearchJob).not.toHaveBeenCalled()
  })
})
