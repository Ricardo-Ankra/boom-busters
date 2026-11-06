// @vitest-environment node

import type * as ChannelLookup from '@/lib/channel-lookup'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaseResearchJob } from '@boom-busters/schemas'
import {
  BudgetExceededError,
  DEFAULT_SETTINGS,
  DEFAULT_WORKSPACE_SETTINGS,
  canonicalModelId,
} from '@boom-busters/schemas'
import {
  EMPTY_BIBLE,
  defaultFormat,
  FIRST_CHANNEL_BIBLE,
  FIRST_CHANNEL_ID as CHANNEL_ID,
} from '@boom-busters/schemas'
import {
  addCase,
  caseResearchEstimate,
  checkWhoRanksAction,
  chooseAngleAction,
  estimateStartCostAction,
  evidenceEstimate,
  editCase,
  rateAnglesAction,
  rateAnglesEstimate,
  researchCaseAction,
  setCaseFormatAction,
  setTargetKeywordAction,
  startProjectFromCase,
  testAngleAction,
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
  costPerMinute: vi.fn(),
  saveCaseAngleRating: vi.fn(),
  saveCaseFieldCheck: vi.fn(),
  saveCaseNicheTest: vi.fn(),
  saveCaseNicheJob: vi.fn(),
  dropCaseNicheJob: vi.fn(),
  currentBible: vi.fn(),
  getChannelSettings: vi.fn(),
  getWorkspace: vi.fn(),
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
const rateAnglesMock = vi.hoisted(() => vi.fn())
const estimateLlmUsd = vi.hoisted(() => vi.fn(() => 0.42))
vi.mock('@boom-busters/cost', () => ({ estimateLlmUsd }))
vi.mock('@/lib/rate-angles', () => ({ rateAngles: rateAnglesMock }))
vi.mock('@/lib/answer-call', () => ({ completeForChannel: vi.fn(() => 'complete') }))
const checkVidiqBudget = vi.hoisted(() => vi.fn())
vi.mock('@/lib/vidiq-spend', () => ({ checkVidiqBudget }))
const evidence = vi.hoisted(() => {
  class CapReached extends Error {}
  return {
    CapReached,
    searchField: vi.fn(),
    startNicheTest: vi.fn(),
    awaitNicheTest: vi.fn(),
  }
})
vi.mock('@/lib/case-evidence', () => evidence)

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
    people: [],
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
    expect(checkVidiqBudget).toHaveBeenCalledWith(55)
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

  it('the estimate is 55 credits with what is left of the cap and the balance, and spends nothing', async () => {
    expect(await caseResearchEstimate(CASE_ID)).toEqual({
      ok: true,
      credits: 55,
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
    store.getCase.mockReset().mockResolvedValue({
      id: CASE_ID,
      subject: 'WeWork',
      status: 'shortlisted',
      formatKey: null,
      people: [],
    })
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

  it('the estimate and the run cost 70 with a lead keyword and two People seeds (a third is not searched)', async () => {
    store.getCase.mockResolvedValue({
      id: CASE_ID,
      subject: 'WeWork',
      status: 'shortlisted',
      searchJob: null,
      formatKey: 'sleep',
      people: ['Adam Neumann', 'Miguel McKelvey', 'Third Person'],
    })
    expect(await caseResearchEstimate(CASE_ID)).toMatchObject({ ok: true, credits: 70 })
    expect(checkVidiqBudget).toHaveBeenLastCalledWith(70)
    store.writeCaseResearchJob.mockImplementation(async (_db, _id, update) => update(null))
    await researchCaseAction(CASE_ID)
    expect(checkVidiqBudget).toHaveBeenLastCalledWith(70)
  })

  it('a stored key no longer in the bible costs the primary format price', async () => {
    store.getCase.mockResolvedValue({
      id: CASE_ID,
      subject: 'WeWork',
      status: 'shortlisted',
      formatKey: 'gone',
      people: [],
    })
    expect(await caseResearchEstimate(CASE_ID)).toMatchObject({ ok: true, credits: 55 })
  })
})

describe('the angle and target keyword actions', () => {
  const CASE_ID = '01J00000000000000000000C01'

  beforeEach(() => {
    store.chooseCaseAngle
      .mockReset()
      .mockResolvedValue({ summary: { id: CASE_ID }, targetChange: null })
    store.setCaseTargetKeyword.mockReset().mockResolvedValue({ id: CASE_ID })
    store.channelForCase
      .mockReset()
      .mockResolvedValue({ id: CHANNEL_ID, bible: FIRST_CHANNEL_BIBLE, archivedAt: null })
  })

  it('chooseAngleAction passes an option or the owner own words to the db', async () => {
    expect(await chooseAngleAction(CASE_ID, { option: 1 })).toEqual({
      ok: true,
      targetChange: null,
    })
    expect(store.chooseCaseAngle).toHaveBeenLastCalledWith({ marker: 'db' }, CASE_ID, {
      option: 1,
    })
    expect(await chooseAngleAction(CASE_ID, { own: '  The auditors are the story.  ' })).toEqual({
      ok: true,
      targetChange: null,
    })
    expect(store.chooseCaseAngle).toHaveBeenLastCalledWith({ marker: 'db' }, CASE_ID, {
      own: 'The auditors are the story.',
    })
  })

  it('chooseAngleAction reports what happened to the target', async () => {
    store.chooseCaseAngle.mockResolvedValue({
      summary: { id: CASE_ID },
      targetChange: { to: 'wework bankruptcy' },
    })
    expect(await chooseAngleAction(CASE_ID, { option: 0 })).toEqual({
      ok: true,
      targetChange: { to: 'wework bankruptcy' },
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
      { caseId: CASE_ID, title: 'WeWork', targetRuntimeMin: 12, formatKey: 'main' },
    )
    expect(checkVidiqBudget).not.toHaveBeenCalled()
    expect(store.writeCaseResearchJob).not.toHaveBeenCalled()
  })

  describe('with a format and a runtime', () => {
    const wide = {
      ...defaultFormat('Long'),
      key: 'long',
      primary: false,
      runtime: { default: 90, min: 3, max: 180 },
    }
    const narrow = {
      ...defaultFormat('Short'),
      key: 'short',
      primary: false,
      runtime: { default: 8, min: 5, max: 10 },
    }
    const bible = { ...FIRST_CHANNEL_BIBLE, formats: [defaultFormat('Main'), wide, narrow] }

    beforeEach(() => {
      store.getCase.mockReset().mockResolvedValue({
        id: CASE_ID,
        title: 'WeWork',
        status: 'shortlisted',
        formatKey: 'long',
      })
      store.channelForCase
        .mockReset()
        .mockResolvedValue({ id: CHANNEL_ID, bible, archivedAt: null })
      store.createProjectFromCase.mockReset().mockResolvedValue({ id: 'P1' })
      store.markCaseInProduction.mockReset().mockResolvedValue(undefined)
      send.mockReset().mockResolvedValue(undefined)
    })

    it("starts a 90 / 3 / 180 format at the start limit when no runtime is given, storing the case's key", async () => {
      expect(await startProjectFromCase(CASE_ID)).toEqual({ ok: true, projectId: 'P1' })
      expect(store.createProjectFromCase).toHaveBeenCalledWith(
        { marker: 'db' },
        { caseId: CASE_ID, title: 'WeWork', targetRuntimeMin: 30, formatKey: 'long' },
      )
    })

    it('refuses a runtime outside the format range, naming the range', async () => {
      expect(await startProjectFromCase(CASE_ID, 2)).toEqual({
        ok: false,
        error: 'This format runs 3 to 180 minutes',
      })
      expect(store.createProjectFromCase).not.toHaveBeenCalled()
    })

    it('accepts 30 minutes on a 3 to 180 format and refuses 31', async () => {
      expect(await startProjectFromCase(CASE_ID, 30)).toEqual({ ok: true, projectId: 'P1' })
      expect(store.createProjectFromCase).toHaveBeenCalledWith(
        { marker: 'db' },
        { caseId: CASE_ID, title: 'WeWork', targetRuntimeMin: 30, formatKey: 'long' },
      )
      store.createProjectFromCase.mockClear()
      expect(await startProjectFromCase(CASE_ID, 31)).toEqual({
        ok: false,
        error: 'Videos longer than 30 minutes are not supported yet',
      })
      expect(store.createProjectFromCase).not.toHaveBeenCalled()
    })

    it('refuses a runtime above the start limit with the not-supported message', async () => {
      expect(await startProjectFromCase(CASE_ID, 90)).toEqual({
        ok: false,
        error: 'Videos longer than 30 minutes are not supported yet',
      })
      expect(store.createProjectFromCase).not.toHaveBeenCalled()
    })

    it('a given format wins over the case, and uses its own default and range', async () => {
      expect(await startProjectFromCase(CASE_ID, undefined, 'short')).toEqual({
        ok: true,
        projectId: 'P1',
      })
      expect(store.createProjectFromCase).toHaveBeenCalledWith(
        { marker: 'db' },
        { caseId: CASE_ID, title: 'WeWork', targetRuntimeMin: 8, formatKey: 'short' },
      )
      expect((await startProjectFromCase(CASE_ID, 12, 'short')).error).toBe(
        'This format runs 5 to 10 minutes',
      )
    })

    it('refuses a given format the bible lacks', async () => {
      expect(await startProjectFromCase(CASE_ID, 15, 'gone')).toEqual({
        ok: false,
        error: "That format is not in the channel's bible",
      })
      expect(store.createProjectFromCase).not.toHaveBeenCalled()
    })

    it('a format whose minimum is past the start limit cannot start, with or without a runtime', async () => {
      const huge = {
        ...defaultFormat('Huge'),
        key: 'huge',
        primary: false,
        runtime: { default: 90, min: 90, max: 180 },
      }
      store.channelForCase.mockResolvedValue({
        id: CHANNEL_ID,
        bible: { ...bible, formats: [...bible.formats, huge] },
        archivedAt: null,
      })
      const refusal = { ok: false, error: 'Videos longer than 30 minutes are not supported yet' }
      expect(await startProjectFromCase(CASE_ID, undefined, 'huge')).toEqual(refusal)
      expect(await startProjectFromCase(CASE_ID, 90, 'huge')).toEqual(refusal)
      expect(await startProjectFromCase(CASE_ID, 60, 'huge')).toEqual(refusal)
      expect(store.createProjectFromCase).not.toHaveBeenCalled()
    })

    it('a case with no format starts as the primary, default 15', async () => {
      store.getCase.mockResolvedValue({
        id: CASE_ID,
        title: 'WeWork',
        status: 'shortlisted',
        formatKey: null,
      })
      await startProjectFromCase(CASE_ID)
      expect(store.createProjectFromCase).toHaveBeenCalledWith(
        { marker: 'db' },
        { caseId: CASE_ID, title: 'WeWork', targetRuntimeMin: 15, formatKey: 'main' },
      )
    })

    it("a case with no format stores the primary's key even when another format is called main", async () => {
      const sleep = { ...defaultFormat('Sleep'), key: 'sleep', primary: true }
      store.getCase.mockResolvedValue({
        id: CASE_ID,
        title: 'WeWork',
        status: 'shortlisted',
        formatKey: null,
      })
      store.channelForCase.mockResolvedValue({
        id: CHANNEL_ID,
        bible: {
          ...bible,
          formats: [{ ...defaultFormat('Main'), primary: false }, sleep],
        },
        archivedAt: null,
      })
      await startProjectFromCase(CASE_ID)
      expect(store.createProjectFromCase).toHaveBeenCalledWith(
        { marker: 'db' },
        expect.objectContaining({ formatKey: 'sleep' }),
      )
    })
  })
})

describe('estimateStartCostAction', () => {
  beforeEach(() => store.costPerMinute.mockReset())

  it('multiplies the finished-project rate by the runtime', async () => {
    store.costPerMinute.mockResolvedValue({ usdPerMinute: 0.62, projects: 6 })
    expect(await estimateStartCostAction(CHANNEL_ID, 20)).toEqual({
      usd: 12.4,
      basis: 'About $12.40, from 6 finished projects',
    })
  })

  it('says so when no project has finished', async () => {
    store.costPerMinute.mockResolvedValue(null)
    expect(await estimateStartCostAction(CHANNEL_ID, 20)).toEqual({
      usd: null,
      basis: 'No estimate yet: no finished projects',
    })
  })
})

describe('rateAnglesAction and rateAnglesEstimate', () => {
  const CASE_ID = '01J00000000000000000000C01'
  const option = (angle: string) => ({ angle, keyword: 'wework', answers: [], gap: '' })
  const brief = (over: Record<string, unknown> = {}) => ({
    subject: 'WeWork',
    angleOptions: [option('one'), option('two')],
    ...over,
  })
  const rated = { ok: true, rating: { recommended: 1, reason: 'Why.' } }

  beforeEach(() => {
    store.getCase.mockReset().mockResolvedValue({
      id: CASE_ID,
      status: 'shortlisted',
      subject: 'WeWork',
      searchBrief: brief(),
      searchJob: null,
    })
    store.channelForCase
      .mockReset()
      .mockResolvedValue({ id: CHANNEL_ID, bible: FIRST_CHANNEL_BIBLE, archivedAt: null })
    store.currentBible.mockReset().mockResolvedValue({ id: 'bible' })
    store.saveCaseAngleRating.mockReset().mockResolvedValue({ id: CASE_ID })
    store.getChannelSettings.mockReset().mockResolvedValue(DEFAULT_SETTINGS)
    store.getWorkspace
      .mockReset()
      .mockResolvedValue({ settings: DEFAULT_WORKSPACE_SETTINGS, defaultChannelId: null })
    rateAnglesMock.mockReset().mockResolvedValue(rated)
  })

  it('rates and saves the angles', async () => {
    expect(await rateAnglesAction(CASE_ID)).toEqual({ ok: true })
    expect(rateAnglesMock.mock.calls[0]![0]).toMatchObject({ subject: 'WeWork' })
    expect(store.saveCaseAngleRating).toHaveBeenCalledWith({ marker: 'db' }, CASE_ID, {
      options: ['one', 'two'],
      recommended: 1,
      reason: 'Why.',
    })
  })

  it('refuses while research runs', async () => {
    store.getCase.mockResolvedValue({
      id: CASE_ID,
      status: 'shortlisted',
      subject: 'WeWork',
      searchBrief: brief(),
      searchJob: {
        state: 'running',
        current: null,
        error: null,
        startedAt: new Date().toISOString(),
        subject: 'WeWork',
      },
    })
    expect(await rateAnglesAction(CASE_ID)).toEqual({
      ok: false,
      error: 'Research is already running for this case',
    })
    expect(rateAnglesMock).not.toHaveBeenCalled()
  })

  it('refuses a brief for another subject', async () => {
    store.getCase.mockResolvedValue({
      id: CASE_ID,
      status: 'shortlisted',
      subject: 'Theranos',
      searchBrief: brief(),
      searchJob: null,
    })
    expect(await rateAnglesAction(CASE_ID)).toEqual({
      ok: false,
      error: 'This research is for another subject. Research again first.',
    })
    expect(rateAnglesMock).not.toHaveBeenCalled()
  })

  it('refuses a case with no angles to rate', async () => {
    store.getCase.mockResolvedValue({
      id: CASE_ID,
      status: 'shortlisted',
      subject: 'WeWork',
      searchBrief: brief({ angleOptions: [option('one')] }),
      searchJob: null,
    })
    expect(await rateAnglesAction(CASE_ID)).toEqual({
      ok: false,
      error: 'There are no angles to rate',
    })
  })

  it('says so when the angles changed', async () => {
    store.saveCaseAngleRating.mockResolvedValue(null)
    expect(await rateAnglesAction(CASE_ID)).toEqual({
      ok: false,
      error: 'The angles changed while they were being rated. Rate them again.',
    })
  })

  it('returns a rating failure and a budget refusal as errors', async () => {
    rateAnglesMock.mockResolvedValueOnce({ ok: false, error: 'The model did not answer' })
    expect(await rateAnglesAction(CASE_ID)).toEqual({
      ok: false,
      error: 'The model did not answer',
    })
    rateAnglesMock.mockRejectedValueOnce(
      new BudgetExceededError({
        provider: 'anthropic',
        operation: 'llm.research',
        budgetUsd: 1,
        monthSpendUsd: 1,
        estimateUsd: 0.1,
      }),
    )
    expect((await rateAnglesAction(CASE_ID)).ok).toBe(false)
    expect(store.saveCaseAngleRating).not.toHaveBeenCalled()
  })

  it('estimates on the research route', async () => {
    const route = DEFAULT_SETTINGS.modelRouting.research
    const model = canonicalModelId(route.provider, route.model)
    expect(await rateAnglesEstimate(CASE_ID)).toEqual({ ok: true, usd: 0.42, model })
    expect(estimateLlmUsd).toHaveBeenCalledWith(
      expect.objectContaining({ provider: route.provider, model }),
    )
    expect(await rateAnglesEstimate('nope')).toEqual({ ok: false, error: 'Unknown case' })
  })
})

describe('checkWhoRanksAction, testAngleAction and evidenceEstimate', () => {
  const CASE_ID = '01J00000000000000000000C01'
  const kw = (keyword: string) => ({
    keyword,
    volume: 1,
    competition: 1,
    overall: 50,
    estimatedMonthlySearch: 1000,
    growthPct: null,
  })
  const brief = (over: Record<string, unknown> = {}) => ({
    subject: 'WeWork',
    targetKeyword: kw('wework collapse'),
    niche: 'startup collapses',
    language: 'en',
    angleOptions: [{ angle: 'The board that signed off', keyword: 'wework', answers: [], gap: '' }],
    ...over,
  })
  const found = (over: Record<string, unknown> = {}) => ({
    id: CASE_ID,
    status: 'shortlisted',
    subject: 'WeWork',
    searchBrief: brief(),
    searchJob: null,
    ...over,
  })
  const check = { keyword: 'wework collapse', checkedAt: '2026-11-06T00:00:00.000Z', results: [] }
  const test = {
    angle: 'The board that signed off',
    verdict: 'ok',
    direct: true,
    evidence: [],
    notes: '',
  }

  beforeEach(() => {
    store.getCase.mockReset().mockResolvedValue(found())
    store.channelForCase
      .mockReset()
      .mockResolvedValue({ id: CHANNEL_ID, bible: FIRST_CHANNEL_BIBLE, archivedAt: null })
    store.saveCaseFieldCheck.mockReset().mockResolvedValue({ id: CASE_ID })
    store.saveCaseNicheTest.mockReset().mockResolvedValue({ id: CASE_ID })
    store.saveCaseNicheJob.mockReset().mockResolvedValue({ id: CASE_ID })
    store.dropCaseNicheJob.mockReset().mockResolvedValue({ id: CASE_ID })
    evidence.searchField.mockReset().mockResolvedValue(check)
    evidence.startNicheTest.mockReset().mockResolvedValue('job-1')
    evidence.awaitNicheTest.mockReset().mockResolvedValue({ state: 'done', test })
  })

  it('checks who ranks for an unchecked target', async () => {
    expect(await checkWhoRanksAction(CASE_ID)).toEqual({ ok: true })
    expect(evidence.searchField).toHaveBeenCalledWith('wework collapse', CHANNEL_ID)
    expect(store.saveCaseFieldCheck).toHaveBeenCalledWith({ marker: 'db' }, CASE_ID, check)
  })

  it('refuses a check with no target, an already checked target, and a bad id', async () => {
    store.getCase.mockResolvedValue(found({ searchBrief: brief({ targetKeyword: null }) }))
    expect(await checkWhoRanksAction(CASE_ID)).toEqual({
      ok: false,
      error: 'There is no target keyword to check',
    })
    store.getCase.mockResolvedValue(
      found({ searchBrief: brief({ fieldChecks: [{ ...check, keyword: ' WeWork Collapse' }] }) }),
    )
    expect(await checkWhoRanksAction(CASE_ID)).toEqual({
      ok: false,
      error: 'Who ranks is already checked for this keyword',
    })
    expect((await checkWhoRanksAction('nope')).ok).toBe(false)
    expect(evidence.searchField).not.toHaveBeenCalled()
  })

  it('refuses a check while research runs', async () => {
    store.getCase.mockResolvedValue(
      found({
        searchJob: {
          state: 'running',
          current: null,
          error: null,
          startedAt: new Date().toISOString(),
          subject: 'WeWork',
        },
      }),
    )
    expect(await checkWhoRanksAction(CASE_ID)).toEqual({
      ok: false,
      error: 'Research is already running for this case',
    })
    expect(evidence.searchField).not.toHaveBeenCalled()
  })

  it('says the cap message rather than throwing', async () => {
    evidence.searchField.mockRejectedValue(
      new evidence.CapReached('The monthly VidIQ cap is reached'),
    )
    expect(await checkWhoRanksAction(CASE_ID)).toEqual({
      ok: false,
      error: 'The monthly VidIQ cap is reached',
    })
    expect(store.saveCaseFieldCheck).not.toHaveBeenCalled()
  })

  it('tests the chosen angle', async () => {
    expect(await testAngleAction(CASE_ID, 0)).toEqual({ ok: true })
    expect(evidence.startNicheTest).toHaveBeenCalledWith(
      { niche: 'startup collapses', idea: 'The board that signed off', language: 'en' },
      CHANNEL_ID,
    )
    expect(evidence.awaitNicheTest).toHaveBeenCalledWith('job-1', 'The board that signed off')
    expect(store.saveCaseNicheTest).toHaveBeenCalledWith({ marker: 'db' }, CASE_ID, test)
  })

  it('refuses an angle test for a bad index, a brief with no niche, or while research runs', async () => {
    expect(await testAngleAction(CASE_ID, 4)).toEqual({
      ok: false,
      error: 'There is no angle there',
    })
    store.getCase.mockResolvedValue(found({ searchBrief: brief({ niche: undefined }) }))
    expect(await testAngleAction(CASE_ID, 0)).toEqual({
      ok: false,
      error: 'This brief has no niche to test against. Research again first.',
    })
    store.getCase.mockResolvedValue(
      found({
        searchJob: {
          state: 'running',
          current: null,
          error: null,
          startedAt: new Date().toISOString(),
          subject: 'WeWork',
        },
      }),
    )
    expect(await testAngleAction(CASE_ID, 0)).toEqual({
      ok: false,
      error: 'Research is already running for this case',
    })
    expect(evidence.startNicheTest).not.toHaveBeenCalled()
  })

  it('says so when the angle test fails, and saves nothing', async () => {
    evidence.awaitNicheTest.mockResolvedValue({ state: 'failed' })
    expect(await testAngleAction(CASE_ID, 0)).toEqual({
      ok: false,
      error:
        'The angle test did not finish. Try again later; any unused credits are refunded by VidIQ.',
    })
    expect(store.saveCaseNicheTest).not.toHaveBeenCalled()
    expect(store.saveCaseNicheJob).not.toHaveBeenCalled()
  })

  it('keeps the paid job when the wait times out, and says the next press is free', async () => {
    evidence.awaitNicheTest.mockResolvedValue({ state: 'running' })
    expect(await testAngleAction(CASE_ID, 0)).toEqual({
      ok: false,
      error:
        'The test is still running at VidIQ and has been paid for. Press Test this angle again in a minute to collect it; that costs nothing.',
    })
    expect(store.saveCaseNicheJob).toHaveBeenCalledWith(
      { marker: 'db' },
      CASE_ID,
      expect.objectContaining({ angle: 'The board that signed off', jobId: 'job-1' }),
    )
    expect(store.saveCaseNicheTest).not.toHaveBeenCalled()
  })

  it('collects a pending job for free: no new purchase, the job is polled', async () => {
    const pending = {
      angle: 'The board that signed off',
      jobId: 'job-paid',
      startedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    }
    store.getCase.mockResolvedValue(found({ searchBrief: brief({ nicheJobs: [pending] }) }))
    expect(await testAngleAction(CASE_ID, 0)).toEqual({ ok: true })
    expect(evidence.startNicheTest).not.toHaveBeenCalled()
    expect(evidence.awaitNicheTest).toHaveBeenCalledWith('job-paid', 'The board that signed off')
    expect(store.saveCaseNicheTest).toHaveBeenCalledWith({ marker: 'db' }, CASE_ID, test)
  })

  it('keeps the original start time when a collected job is still running', async () => {
    const pending = {
      angle: 'The board that signed off',
      jobId: 'job-paid',
      startedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    }
    store.getCase.mockResolvedValue(found({ searchBrief: brief({ nicheJobs: [pending] }) }))
    evidence.awaitNicheTest.mockResolvedValue({ state: 'running' })
    expect((await testAngleAction(CASE_ID, 0)).ok).toBe(false)
    expect(evidence.startNicheTest).not.toHaveBeenCalled()
    expect(store.saveCaseNicheJob).toHaveBeenCalledWith({ marker: 'db' }, CASE_ID, pending)
  })

  it('forgets a pending job that failed at VidIQ, and buys nothing yet', async () => {
    const pending = {
      angle: 'The board that signed off',
      jobId: 'job-paid',
      startedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    }
    store.getCase.mockResolvedValue(found({ searchBrief: brief({ nicheJobs: [pending] }) }))
    evidence.awaitNicheTest.mockResolvedValue({ state: 'failed' })
    const result = await testAngleAction(CASE_ID, 0)
    expect(result.ok).toBe(false)
    expect(store.dropCaseNicheJob).toHaveBeenCalledWith(
      { marker: 'db' },
      CASE_ID,
      'The board that signed off',
    )
    expect(evidence.startNicheTest).not.toHaveBeenCalled()
  })

  it('ignores a pending job older than thirty minutes and buys a new test', async () => {
    const stale = {
      angle: 'The board that signed off',
      jobId: 'job-old',
      startedAt: new Date(Date.now() - 31 * 60_000).toISOString(),
    }
    store.getCase.mockResolvedValue(found({ searchBrief: brief({ nicheJobs: [stale] }) }))
    expect(await testAngleAction(CASE_ID, 0)).toEqual({ ok: true })
    expect(evidence.startNicheTest).toHaveBeenCalledTimes(1)
    expect(evidence.awaitNicheTest).toHaveBeenCalledWith('job-1', 'The board that signed off')
  })

  it('says the cap message when the angle test is refused by the cap', async () => {
    evidence.startNicheTest.mockRejectedValue(new evidence.CapReached('cap'))
    expect(await testAngleAction(CASE_ID, 0)).toEqual({ ok: false, error: 'cap' })
  })

  it('estimates five credits each, and refuses a bad id or a missing case', async () => {
    expect(await evidenceEstimate(CASE_ID)).toEqual({
      ok: true,
      credits: { whoRanks: 5, angleTest: 5 },
    })
    expect((await evidenceEstimate('nope')).ok).toBe(false)
    store.getCase.mockResolvedValue(undefined)
    expect((await evidenceEstimate(CASE_ID)).ok).toBe(false)
  })
})
