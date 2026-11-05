import { DEFAULT_SETTINGS, EMPTY_BIBLE } from '@boom-busters/schemas'
import type { CaseResearchJob, SearchBrief, SearchKeyword } from '@boom-busters/schemas'
import { sql as dsql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createChannel, ensureFirstChannel, getChannelBySlug } from './channels'
import { createDb } from './client'
import { countCases } from './queries'
import {
  caseSubjectTaken,
  chooseCaseAngle,
  createCase,
  deleteCase,
  getCase,
  listCases,
  markCaseInProduction,
  saveCaseSearchBrief,
  setCaseFormat,
  setCaseStatus,
  setCaseTargetKeyword,
  truncateCases,
  updateCase,
  writeCaseResearchJob,
} from './cases'
import { createProjectFromCase, deleteProjectsExcept, getProject, listProjects } from './projects'
import { requireTestDatabase } from './test-database'

/**
 * Gated on TEST_DATABASE_URL, not DATABASE_URL: these truncate the cases table,
 * which cascades to projects. They will not run against a deployment's data.
 */
const url = requireTestDatabase()
const suite = url ? describe : describe.skip

suite('cases', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  let channelId = ''
  let otherChannelId = ''

  beforeEach(async () => {
    await truncateCases(db)
    channelId = (await ensureFirstChannel(db)).id
    otherChannelId = (await ensureSecondChannel()).id
  })

  async function ensureSecondChannel() {
    const existing = await getChannelBySlug(db, 'second-test')
    if (existing) return existing
    return createChannel(db, {
      name: 'Second test channel',
      handle: null,
      slug: 'second-test',
      settings: DEFAULT_SETTINGS,
      bible: EMPTY_BIBLE,
    })
  }

  describe('category is text', () => {
    it("stores a key from another channel's bible and reads it back", async () => {
      await createCase(db, { channelId: otherChannelId, title: 'Milgram', category: 'obedience' })

      expect((await listCases(db, otherChannelId)).map((row) => row.category)).toEqual([
        'obedience',
      ])
    })

    it('refuses an empty category at the database', async () => {
      await expect(createCase(db, { channelId, title: 'Nothing', category: '' })).rejects.toThrow()
    })
  })

  describe('two channels', () => {
    it('listCases never returns the other channel case', async () => {
      await createCase(db, { channelId, title: 'Alpha case', category: 'con' })
      await createCase(db, { channelId: otherChannelId, title: 'Beta case', category: 'con' })

      expect((await listCases(db, channelId)).map((row) => row.title)).toEqual(['Alpha case'])
      expect((await listCases(db, otherChannelId)).map((row) => row.title)).toEqual(['Beta case'])
    })

    it('countCases is per channel', async () => {
      await createCase(db, { channelId, title: 'Alpha case', category: 'con' })
      await createCase(db, { channelId, title: 'Alpha two', category: 'con' })
      await createCase(db, { channelId: otherChannelId, title: 'Beta case', category: 'con' })

      expect(await countCases(db, channelId)).toBe(2)
      expect(await countCases(db, otherChannelId)).toBe(1)
    })

    it('a project carries its case channel and listProjects excludes the other', async () => {
      const mine = await createCase(db, { channelId, title: 'Alpha case', category: 'con' })
      const theirs = await createCase(db, {
        channelId: otherChannelId,
        title: 'Beta case',
        category: 'con',
      })
      const project = await createProjectFromCase(db, { caseId: theirs.id, title: 'Beta' })
      await createProjectFromCase(db, { caseId: mine.id, title: 'Alpha' })

      expect(project.channelId).toBe(otherChannelId)
      expect((await listProjects(db, channelId)).map((row) => row.title)).toEqual(['Alpha'])
      expect((await listProjects(db, otherChannelId)).map((row) => row.title)).toEqual(['Beta'])
    })
  })

  it('creates a case as an idea by default', async () => {
    const row = await createCase(db, { channelId, title: 'Enron', category: 'collapse' })

    expect(row.status).toBe('idea')
    expect(row.priorityScore).toBe(0)
    expect(row.id).toHaveLength(26)
  })

  it('reports how many projects came from a case', async () => {
    const row = await createCase(db, { channelId, title: 'Enron', category: 'collapse' })
    await createProjectFromCase(db, { caseId: row.id, title: 'Enron' })
    await createProjectFromCase(db, { caseId: row.id, title: 'Enron, again' })

    expect((await getCase(db, row.id))?.projectCount).toBe(2)
  })

  it('clears projects that share a kept case', async () => {
    // `deleteCasesExcept` only reaches projects whose *case* is going. The E2E
    // suite seeds its extra projects against the fixture case precisely because
    // that case is kept — so without this they survived every reset and piled
    // up one run at a time.
    const row = await createCase(db, { channelId, title: 'Enron', category: 'collapse' })
    const keep = await createProjectFromCase(db, { caseId: row.id, title: 'The one to keep' })
    await createProjectFromCase(db, { caseId: row.id, title: 'Left over from last run' })
    await createProjectFromCase(db, { caseId: row.id, title: 'And the run before that' })

    expect(await deleteProjectsExcept(db, [keep.id])).toBe(2)

    const remaining = await listProjects(db, channelId)
    expect(remaining.map((project) => project.title)).toEqual(['The one to keep'])
    // The case itself is untouched: this clears projects, not the library.
    expect(await getCase(db, row.id)).toBeDefined()
  })

  it('counts zero projects without dropping the case from the list', async () => {
    // A left join done wrong makes case rows vanish the moment they have no
    // projects, which is every case in a fresh library.
    await createCase(db, { channelId, title: 'Enron', category: 'collapse' })

    const [only] = await listCases(db, channelId)
    expect(only?.projectCount).toBe(0)
  })

  describe('sorting', () => {
    beforeEach(async () => {
      await createCase(db, { channelId, title: 'Beta', category: 'con', priorityScore: 50 })
      await createCase(db, { channelId, title: 'Alpha', category: 'collapse', priorityScore: 50 })
      await createCase(db, { channelId, title: 'Gamma', category: 'meltdown', priorityScore: 90 })
    })

    it('sorts by priority, breaking ties by title for a stable table', async () => {
      const titles = (await listCases(db, channelId, { sort: 'priority' })).map((c) => c.title)
      expect(titles).toEqual(['Gamma', 'Alpha', 'Beta'])
    })

    it('sorts by category', async () => {
      const categories = (await listCases(db, channelId, { sort: 'category' })).map(
        (c) => c.category,
      )
      expect(categories).toEqual(['collapse', 'con', 'meltdown'])
    })

    it('filters by status', async () => {
      const [first] = await listCases(db, channelId)
      await setCaseStatus(db, first!.id, 'published')

      const published = await listCases(db, channelId, { status: ['published'] })
      expect(published).toHaveLength(1)
      expect(published[0]?.title).toBe('Gamma')
    })
  })

  describe('deleteCase', () => {
    it('deletes a case nothing was produced from', async () => {
      const row = await createCase(db, { channelId, title: 'Enron', category: 'collapse' })

      expect(await deleteCase(db, row.id)).toBe(true)
      expect(await getCase(db, row.id)).toBeUndefined()
    })

    it('refuses to delete a case with projects behind it', async () => {
      const row = await createCase(db, { channelId, title: 'Enron', category: 'collapse' })
      await createProjectFromCase(db, { caseId: row.id, title: 'Enron' })

      // Deleting would orphan the record of why that project exists.
      expect(await deleteCase(db, row.id)).toBe(false)
      expect(await getCase(db, row.id)).toBeDefined()
    })
  })

  describe('markCaseInProduction', () => {
    it('moves a shortlisted case into production', async () => {
      const row = await createCase(db, {
        channelId,
        title: 'Enron',
        category: 'collapse',
        status: 'shortlisted',
      })

      await markCaseInProduction(db, row.id)

      expect((await getCase(db, row.id))?.status).toBe('in_production')
    })

    it('does not drag a published case backwards', async () => {
      // Starting a second project from a published case must not un-publish it.
      const row = await createCase(db, {
        channelId,
        title: 'Enron',
        category: 'collapse',
        status: 'published',
      })

      await markCaseInProduction(db, row.id)

      expect((await getCase(db, row.id))?.status).toBe('published')
    })
  })

  it('updates a case without touching what was not patched', async () => {
    const row = await createCase(db, {
      channelId,
      title: 'Enron',
      category: 'collapse',
      angle: 'original',
      priorityScore: 10,
    })

    await updateCase(db, row.id, { priorityScore: 80 })

    const updated = await getCase(db, row.id)
    expect(updated?.priorityScore).toBe(80)
    expect(updated?.angle).toBe('original')
    expect(updated?.title).toBe('Enron')
  })

  it('round-trips subject, people and source links, and defaults them', async () => {
    const plain = await createCase(db, { channelId, title: 'Plain', category: 'collapse' })
    expect(plain.subject).toBeNull()
    expect(plain.people).toEqual([])
    expect(plain.sourceLinks).toEqual([])

    const row = await createCase(db, {
      channelId,
      title: 'The Auditors',
      category: 'con',
      subject: 'Wirecard',
      people: ['Markus Braun'],
      sourceLinks: [{ url: 'https://example.com/a', note: 'FT' }],
    })
    const got = await getCase(db, row.id)
    expect(got?.subject).toBe('Wirecard')
    expect(got?.people).toEqual(['Markus Braun'])
    expect(got?.sourceLinks).toEqual([{ url: 'https://example.com/a', note: 'FT' }])
  })

  it('updateCase patches subject, people and source links', async () => {
    const row = await createCase(db, { channelId, title: 'Patchable', category: 'con' })
    const updated = await updateCase(db, row.id, {
      subject: 'Enron',
      people: ['Jeff Skilling'],
      sourceLinks: [{ url: 'https://example.com/b' }],
    })
    expect(updated?.subject).toBe('Enron')
    expect(updated?.people).toEqual(['Jeff Skilling'])
    expect(updated?.sourceLinks).toEqual([{ url: 'https://example.com/b' }])
    const cleared = await updateCase(db, row.id, { subject: null })
    expect(cleared?.subject).toBeNull()
  })

  describe('the search brief', () => {
    const kw = (keyword: string, overall: number | null = 50): SearchKeyword => ({
      keyword,
      volume: 100,
      competition: 20,
      overall,
      estimatedMonthlySearch: 1000,
      growthPct: null,
    })
    const briefFor = (subject: string, over: Partial<SearchBrief> = {}): SearchBrief => ({
      subject,
      measuredAt: '2026-11-01T10:00:00.000Z',
      targetKeyword: kw('wework collapse', 80),
      secondaryKeywords: [kw('wework bankruptcy'), kw('wework $47 billion')],
      searchedQuestions: [],
      outliers: [],
      titlePatterns: [],
      toldAlready: [],
      angleOptions: [
        {
          angle: 'How a lease broker became a unicorn on borrowed hype',
          keyword: 'wework',
          answers: [],
          gap: 'x',
        },
        {
          angle: 'The board that signed off on every excess',
          keyword: 'wework',
          answers: [],
          gap: 'y',
        },
      ],
      chosenAngle: null,
      formatKey: null,
      fit: null,
      searchedTitles: [],
      otherLanguages: [],
      recommendedAngle: null,
      recommendationReason: null,
      ownAngle: false,
      ...over,
    })
    const job = (startedAt: string, over: Partial<CaseResearchJob> = {}): CaseResearchJob => ({
      state: 'running',
      current: null,
      error: null,
      startedAt,
      subject: 'WeWork',
      ...over,
    })

    async function researched(subject = 'WeWork') {
      const row = await createCase(db, {
        channelId,
        title: `Case ${subject}`,
        category: 'con',
        subject,
      })
      await writeCaseResearchJob(db, row.id, () => job('t1'))
      await saveCaseSearchBrief(db, row.id, briefFor('WeWork'), 't1')
      return row.id
    }

    it('reads searchBrief and searchJob null for a row written before the columns', async () => {
      const row = await createCase(db, { channelId, title: 'Old row', category: 'con' })
      const got = await getCase(db, row.id)
      expect(got?.searchBrief).toBeNull()
      expect(got?.searchJob).toBeNull()
      expect((await listCases(db, channelId))[0]?.searchBrief).toBeNull()
    })

    it('reads a malformed stored brief as null rather than throwing', async () => {
      const row = await createCase(db, { channelId, title: 'Bad row', category: 'con' })
      await db.execute(
        dsql`update cases set search_brief = '{"nonsense":true}'::jsonb, search_job = '[]'::jsonb where id = ${row.id}`,
      )
      const got = await getCase(db, row.id)
      expect(got?.searchBrief).toBeNull()
      expect(got?.searchJob).toBeNull()
    })

    describe('caseSubjectTaken', () => {
      it('is true for a trimmed, case-insensitive match in the same channel only', async () => {
        const row = await createCase(db, {
          channelId,
          title: 'WeWork',
          category: 'con',
          subject: 'WeWork',
        })
        expect(await caseSubjectTaken(db, channelId, ' wework ')).toBe(true)
        expect(await caseSubjectTaken(db, channelId, ' WeWork ')).toBe(true)
        expect(await caseSubjectTaken(db, otherChannelId, 'WeWork')).toBe(false)
        expect(await caseSubjectTaken(db, channelId, 'WeWork', row.id)).toBe(false)
        expect(await caseSubjectTaken(db, channelId, 'Enron')).toBe(false)
      })
    })

    describe('writeCaseResearchJob', () => {
      it('hands the update the current job and stores what it returns', async () => {
        const row = await createCase(db, { channelId, title: 'Job', category: 'con' })
        const seen: (CaseResearchJob | null)[] = []
        const first = await writeCaseResearchJob(db, row.id, (current) => {
          seen.push(current)
          return job('2026-11-01T10:00:00.000Z')
        })
        expect(first?.state).toBe('running')
        await writeCaseResearchJob(db, row.id, (current) => {
          seen.push(current)
          return current ? { ...current, state: 'failed', error: 'boom' } : null
        })
        expect(seen[0]).toBeNull()
        expect(seen[1]?.startedAt).toBe('2026-11-01T10:00:00.000Z')
        expect((await getCase(db, row.id))?.searchJob?.error).toBe('boom')
      })

      it('serialises concurrent writers', async () => {
        const row = await createCase(db, { channelId, title: 'Race', category: 'con' })
        await writeCaseResearchJob(db, row.id, () => job('t0', { current: '0' }))
        await Promise.all(
          [1, 2, 3].map(() =>
            writeCaseResearchJob(db, row.id, (current) =>
              current ? { ...current, current: String(Number(current.current) + 1) } : null,
            ),
          ),
        )
        expect((await getCase(db, row.id))?.searchJob?.current).toBe('3')
      })
    })

    describe('saveCaseSearchBrief', () => {
      it('writes the brief and marks the job done while the job is the one that started', async () => {
        const row = await createCase(db, {
          channelId,
          title: 'Save',
          category: 'con',
          subject: 'WeWork',
        })
        await writeCaseResearchJob(db, row.id, () => job('2026-11-01T10:00:00.000Z'))
        const saved = await saveCaseSearchBrief(
          db,
          row.id,
          briefFor('WeWork'),
          '2026-11-01T10:00:00.000Z',
        )
        expect(saved).toBe(true)
        const got = await getCase(db, row.id)
        expect(got?.searchBrief?.targetKeyword?.keyword).toBe('wework collapse')
        expect(got?.searchJob?.state).toBe('done')
      })

      it('refuses a stale jobStartedAt and leaves the brief null', async () => {
        const row = await createCase(db, { channelId, title: 'Stale', category: 'con' })
        await writeCaseResearchJob(db, row.id, () => job('2026-11-01T11:00:00.000Z'))
        const saved = await saveCaseSearchBrief(
          db,
          row.id,
          briefFor('WeWork'),
          '2026-11-01T10:00:00.000Z',
        )
        expect(saved).toBe(false)
        const got = await getCase(db, row.id)
        expect(got?.searchBrief).toBeNull()
        expect(got?.searchJob?.state).toBe('running')
      })

      it('refuses a failed job whose startedAt still matches, and leaves the brief null', async () => {
        const row = await createCase(db, { channelId, title: 'Failed', category: 'con' })
        await writeCaseResearchJob(db, row.id, () =>
          job('2026-11-01T10:00:00.000Z', { state: 'failed', error: 'VidIQ did not answer' }),
        )
        const saved = await saveCaseSearchBrief(
          db,
          row.id,
          briefFor('WeWork'),
          '2026-11-01T10:00:00.000Z',
        )
        expect(saved).toBe(false)
        const got = await getCase(db, row.id)
        expect(got?.searchBrief).toBeNull()
        expect(got?.searchJob?.state).toBe('failed')
      })

      it('refuses when there is no job at all', async () => {
        const row = await createCase(db, { channelId, title: 'NoJob', category: 'con' })
        expect(await saveCaseSearchBrief(db, row.id, briefFor('WeWork'), 'x')).toBe(false)
        expect((await getCase(db, row.id))?.searchBrief).toBeNull()
      })
    })

    describe('chooseCaseAngle', () => {
      it('writes the option angle, its index and the demand notes line', async () => {
        const id = await researched()
        const got = await chooseCaseAngle(db, id, { option: 1 })
        expect(got.angle).toBe('The board that signed off on every excess')
        expect(got.searchBrief?.chosenAngle).toBe(1)
        expect(got.demandNotes).toBe(
          'wework collapse: 100 volume, competition 20; 0 winning videos',
        )
        expect((await getCase(db, id))?.angle).toBe('The board that signed off on every excess')
      })

      it("writes the owner's own angle with a null chosenAngle", async () => {
        const id = await researched()
        await chooseCaseAngle(db, id, { option: 0 })
        const got = await chooseCaseAngle(db, id, { own: '  My own telling  ' })
        expect(got.angle).toBe('My own telling')
        expect(got.searchBrief?.chosenAngle).toBeNull()
      })

      it('refuses an option that does not exist, and a case with no brief', async () => {
        const id = await researched()
        await expect(chooseCaseAngle(db, id, { option: 5 })).rejects.toThrow()
        const bare = await createCase(db, { channelId, title: 'Bare', category: 'con' })
        await expect(chooseCaseAngle(db, bare.id, { option: 0 })).rejects.toThrow()
      })
    })

    describe('setCaseTargetKeyword', () => {
      it('swaps the chosen secondary with the target', async () => {
        const id = await researched()
        const got = await setCaseTargetKeyword(db, id, 'wework bankruptcy')
        expect(got.searchBrief?.targetKeyword?.keyword).toBe('wework bankruptcy')
        expect(got.searchBrief?.secondaryKeywords.map((k) => k.keyword)).toEqual([
          'wework $47 billion',
          'wework collapse',
        ])
      })

      it('rewrites the demand notes when an angle was chosen, so they name the new target', async () => {
        const id = await researched()
        await chooseCaseAngle(db, id, { option: 0 })
        expect((await getCase(db, id))?.demandNotes).toContain('wework collapse')
        const got = await setCaseTargetKeyword(db, id, 'wework bankruptcy')
        expect(got.demandNotes).toContain('wework bankruptcy')
        expect(got.demandNotes).not.toContain('wework collapse')
      })

      it('leaves hand-written demand notes alone when no angle was chosen', async () => {
        const id = await researched()
        await updateCase(db, id, { demandNotes: 'Owner note about the audience' })
        const got = await setCaseTargetKeyword(db, id, 'wework bankruptcy')
        expect(got.demandNotes).toBe('Owner note about the audience')
      })

      it('leaves notes the owner edited after choosing an angle alone', async () => {
        const id = await researched()
        await chooseCaseAngle(db, id, { option: 0 })
        await updateCase(db, id, { demandNotes: 'Owner note about the audience' })
        const got = await setCaseTargetKeyword(db, id, 'wework bankruptcy')
        expect(got.demandNotes).toBe('Owner note about the audience')
      })

      it('refuses a keyword with a figure, and one that is not a secondary', async () => {
        const id = await researched()
        await expect(setCaseTargetKeyword(db, id, 'wework $47 billion')).rejects.toThrow(/figure/)
        await expect(setCaseTargetKeyword(db, id, 'nothing here')).rejects.toThrow()
        expect((await getCase(db, id))?.searchBrief?.targetKeyword?.keyword).toBe('wework collapse')
      })
    })

    describe('freezing onto a project', () => {
      it('copies the brief, and a later case edit does not change the project copy', async () => {
        const id = await researched()
        const project = await createProjectFromCase(db, { caseId: id, title: 'Frozen' })
        expect((await getProject(db, project.id))?.searchBrief?.subject).toBe('WeWork')

        await setCaseTargetKeyword(db, id, 'wework bankruptcy')
        const after = await getProject(db, project.id)
        expect(after?.searchBrief?.targetKeyword?.keyword).toBe('wework collapse')
      })

      it('compares the subject trimmed and case-insensitively', async () => {
        const id = await researched(' wework ')
        const made = await createProjectFromCase(db, { caseId: id, title: 'Loose' })
        expect((await getProject(db, made.id))?.searchBrief).not.toBeNull()
      })

      it('freezes nothing when the brief is for a different subject', async () => {
        const id = await researched()
        await updateCase(db, id, { subject: 'Theranos' })
        const project = await createProjectFromCase(db, { caseId: id, title: 'Other' })
        expect((await getProject(db, project.id))?.searchBrief).toBeNull()
      })

      it('freezes null when the case has no brief', async () => {
        const row = await createCase(db, { channelId, title: 'Plain', category: 'con' })
        const project = await createProjectFromCase(db, { caseId: row.id, title: 'Plain' })
        expect((await getProject(db, project.id))?.searchBrief).toBeNull()
      })
    })
  })

  it('setCaseFormat stores and clears the format key', async () => {
    const kase = await createCase(db, { channelId, title: 'Fmt', category: 'collapse' })
    expect((await getCase(db, kase.id))?.formatKey).toBeNull()
    await setCaseFormat(db, kase.id, 'sleep')
    expect((await getCase(db, kase.id))?.formatKey).toBe('sleep')
    await setCaseFormat(db, kase.id, null)
    expect((await getCase(db, kase.id))?.formatKey).toBeNull()
  })
})
