import type { CaseSummary } from '@boom-busters/db'
import type { CaseResearchJob, SearchBrief } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { caseProgress, listSignal, resolveSelected, scoreWord } from './case-progress'
import { researchStepLabel } from './research-steps'

function kase(overrides: Partial<CaseSummary>): CaseSummary {
  return {
    id: '01J0000000000000000000000W',
    title: 'Wirecard',
    category: 'con',
    angle: null,
    demandNotes: null,
    competitorLinks: [],
    subject: 'Wirecard',
    people: [],
    sourceLinks: [],
    searchBrief: null,
    searchJob: null,
    formatKey: null,
    priorityScore: 88,
    status: 'idea',
    projectCount: 0,
    createdAt: new Date('2026-10-09T10:00:00Z'),
    updatedAt: new Date('2026-10-09T10:00:00Z'),
    ...overrides,
  }
}

const OPTION = { angle: 'An angle.', keyword: 'wirecard', answers: [], gap: 'A gap.' }

function brief(over: Partial<SearchBrief> = {}): SearchBrief {
  return {
    subject: 'Wirecard',
    measuredAt: '2026-10-20T10:00:00.000Z',
    targetKeyword: {
      keyword: 'wirecard documentary',
      volume: 64,
      competition: 38,
      overall: 63,
      estimatedMonthlySearch: null,
      growthPct: null,
    },
    secondaryKeywords: [],
    searchedQuestions: [],
    outliers: [],
    titlePatterns: [],
    toldAlready: [],
    angleOptions: [OPTION, OPTION],
    chosenAngle: null,
    formatKey: null,
    fit: null,
    searchedTitles: [],
    otherLanguages: [],
    recommendedAngle: null,
    recommendationReason: null,
    ownAngle: false,
    ...over,
  }
}

const states = (item: CaseSummary) => caseProgress(item).steps.map((s) => s.state)

describe('caseProgress', () => {
  it('names the three steps in order, as actions until each is done', () => {
    expect(caseProgress(kase({})).steps.map((s) => s.label)).toEqual([
      'Research the subject',
      'Choose an angle',
      'Start a project',
    ])
  })

  it('words a done step in the past tense', () => {
    const item = kase({ searchBrief: brief(), projectCount: 1 })
    expect(caseProgress(item).steps.map((s) => s.label)).toEqual([
      'Researched',
      'Choose an angle',
      'Project started',
    ])
  })

  it('asks for a subject first, with research as the current step', () => {
    for (const subject of [null, '', '   ']) {
      const item = kase({ subject })
      expect(caseProgress(item).next).toBe('Next: give the case a subject, then research it')
      expect(states(item)).toEqual(['current', 'todo', 'todo'])
    }
  })

  it('asks for research when there is a subject but no brief', () => {
    expect(caseProgress(kase({})).next).toBe('Next: research the subject with VidIQ')
  })

  it('asks for an angle when the brief has none chosen', () => {
    const item = kase({ searchBrief: brief() })
    expect(caseProgress(item).next).toBe('Next: choose an angle')
    expect(states(item)).toEqual(['done', 'current', 'todo'])
  })

  it('counts an own angle as chosen', () => {
    const item = kase({ searchBrief: brief({ ownAngle: true }), status: 'idea' })
    expect(states(item)).toEqual(['done', 'done', 'current'])
  })

  it('asks to start a project when shortlisted with an angle', () => {
    const item = kase({ searchBrief: brief({ chosenAngle: 0 }), status: 'shortlisted' })
    expect(caseProgress(item).next).toBe('Next: start a project from the chosen angle')
    expect(states(item)).toEqual(['done', 'done', 'current'])
  })

  it('reads Retired for a retired case with an angle', () => {
    const item = kase({ searchBrief: brief({ chosenAngle: 0 }), status: 'retired' })
    expect(caseProgress(item).next).toBe('Retired')
  })

  it('asks to shortlist an idea that has an angle', () => {
    const item = kase({ searchBrief: brief({ chosenAngle: 0 }), status: 'idea' })
    expect(caseProgress(item).next).toBe('Next: shortlist the case to start a project')
  })

  it('is finished once a project exists', () => {
    const item = kase({ searchBrief: brief({ chosenAngle: 0 }), projectCount: 1 })
    expect(caseProgress(item).next).toBe('Nothing waiting on you here')
    expect(states(item)).toEqual(['done', 'done', 'done'])
  })

  it('treats in_production and published as a started project', () => {
    for (const status of ['in_production', 'published'] as const) {
      const item = kase({ searchBrief: brief({ chosenAngle: 0 }), status })
      expect(states(item)).toEqual(['done', 'done', 'done'])
      expect(caseProgress(item).next).toBe('Nothing waiting on you here')
    }
  })

  it('says nothing is waiting even when the angle was never chosen through the brief', () => {
    const item = kase({ status: 'in_production', projectCount: 1 })
    expect(caseProgress(item).next).toBe('Nothing waiting on you here')
    expect(states(item)).toEqual(['todo', 'todo', 'done'])
  })

  it('reads Retired whatever else is missing', () => {
    const item = kase({ status: 'retired', subject: null })
    expect(caseProgress(item).next).toBe('Retired')
    expect(states(item)).toEqual(['todo', 'todo', 'todo'])
  })

  it('marks no step current once a project started', () => {
    expect(states(kase({ projectCount: 1 }))).toEqual(['todo', 'todo', 'done'])
  })

  it('reads Retired for a retired case with a project', () => {
    const item = kase({
      status: 'retired',
      projectCount: 1,
      searchBrief: brief({ ownAngle: true }),
    })
    expect(caseProgress(item).next).toBe('Retired')
  })
})

describe('listSignal', () => {
  const running = (current: string | null): CaseResearchJob => ({
    state: 'running',
    current,
    error: null,
    startedAt: new Date().toISOString(),
    subject: 'Wirecard',
  })

  it('shows the research step of a running job, muted', () => {
    const item = kase({ searchJob: running('keywords'), searchBrief: brief() })
    expect(listSignal(item).angle).toEqual({ text: researchStepLabel('keywords'), tone: 'muted' })
  })

  it('ignores a stale running job', () => {
    const job = { ...running('keywords'), startedAt: '2020-01-01T00:00:00.000Z' }
    expect(listSignal(kase({ searchJob: job })).angle).toEqual({
      text: 'Not researched',
      tone: 'muted',
    })
  })

  it('ignores a finished job', () => {
    const job: CaseResearchJob = { ...running(null), state: 'done' }
    expect(listSignal(kase({ searchJob: job })).angle?.text).toBe('Not researched')
  })

  it('says the angle is chosen, in success', () => {
    const item = kase({ searchBrief: brief({ chosenAngle: 1 }) })
    expect(listSignal(item).angle).toEqual({ text: 'Angle chosen', tone: 'success' })
  })

  it('asks to pick among n angles, in warning', () => {
    expect(listSignal(kase({ searchBrief: brief() })).angle).toEqual({
      text: '2 angles, pick one',
      tone: 'warning',
    })
    expect(listSignal(kase({ searchBrief: brief({ angleOptions: [OPTION] }) })).angle?.text).toBe(
      '1 angle, pick one',
    )
  })

  it('shows no angle signal for a brief with no options', () => {
    expect(listSignal(kase({ searchBrief: brief({ angleOptions: [] }) })).angle).toBeNull()
  })

  it('says Not researched without a brief', () => {
    expect(listSignal(kase({})).angle).toEqual({ text: 'Not researched', tone: 'muted' })
  })

  it('carries the target keyword text, or null', () => {
    expect(listSignal(kase({ searchBrief: brief() })).keyword).toBe('wirecard documentary')
    expect(listSignal(kase({ searchBrief: brief({ targetKeyword: null }) })).keyword).toBeNull()
    expect(listSignal(kase({})).keyword).toBeNull()
  })
})

describe('scoreWord', () => {
  it('uses low, medium and high for competition', () => {
    expect(scoreWord(0, 'competition')).toBe('low')
    expect(scoreWord(33, 'competition')).toBe('low')
    expect(scoreWord(34, 'competition')).toBe('medium')
    expect(scoreWord(66, 'competition')).toBe('medium')
    expect(scoreWord(67, 'competition')).toBe('high')
    expect(scoreWord(100, 'competition')).toBe('high')
  })

  it('says moderate for the middle of volume', () => {
    expect(scoreWord(33, 'volume')).toBe('low')
    expect(scoreWord(34, 'volume')).toBe('moderate')
    expect(scoreWord(66, 'volume')).toBe('moderate')
    expect(scoreWord(67, 'volume')).toBe('high')
  })
})

describe('resolveSelected', () => {
  const idea = kase({ id: 'A', status: 'idea' })
  const first = kase({ id: 'B', status: 'shortlisted' })
  const second = kase({ id: 'C', status: 'published' })

  it('opens the case the URL names, as explicit', () => {
    expect(resolveSelected([idea, first, second], 'C')).toEqual({ selectedId: 'C', explicit: true })
    expect(resolveSelected([idea, first, second], 'A')).toEqual({ selectedId: 'A', explicit: true })
  })

  it('opens the first backlog case without a case id', () => {
    expect(resolveSelected([idea, first, second], undefined)).toEqual({
      selectedId: 'B',
      explicit: false,
    })
  })

  it('falls back to the first case for an unknown case id', () => {
    expect(resolveSelected([idea, first, second], 'nope')).toEqual({
      selectedId: 'B',
      explicit: false,
    })
  })

  it('opens the first suggestion when the backlog is empty, and nothing when the library is', () => {
    expect(resolveSelected([idea], undefined)).toEqual({ selectedId: 'A', explicit: false })
    expect(resolveSelected([], undefined)).toEqual({ selectedId: null, explicit: false })
    expect(resolveSelected([], 'A')).toEqual({ selectedId: null, explicit: false })
  })
})
