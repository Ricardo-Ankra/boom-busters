import {
  DEFAULT_SETTINGS,
  EMPTY_BIBLE,
  SearchBriefSchema,
  briefDemandNotes,
} from '@boom-busters/schemas'
import type {
  CaseResearchJob,
  FieldCheck,
  NicheTest,
  SearchBrief,
  SearchKeyword,
} from '@boom-busters/schemas'
import { sql as dsql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createChannel, ensureFirstChannel, getChannelBySlug } from './channels'
import { createDb } from './client'
import { countCases } from './queries'
import {
  addCaseOwnerKeyword,
  caseSubjectTaken,
  chooseCaseAngle,
  createCase,
  deleteCase,
  dropCaseNicheJob,
  getCase,
  listCases,
  markCaseInProduction,
  saveCaseAngleRating,
  saveCaseFieldCheck,
  saveCaseNicheJob,
  saveCaseNicheTest,
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

  it('stores seed keywords, defaults them empty and patches them (decision 467)', async () => {
    const bare = await createCase(db, { channelId, title: 'No seeds', category: 'con' })
    expect((await getCase(db, bare.id))?.seedKeywords).toEqual([])
    const row = await createCase(db, {
      channelId,
      title: 'Seeded',
      category: 'collapse',
      seedKeywords: ['ueno bank paraguay'],
    })
    expect((await getCase(db, row.id))?.seedKeywords).toEqual(['ueno bank paraguay'])
    const updated = await updateCase(db, row.id, { seedKeywords: ['ueno bank collapse'] })
    expect(updated?.seedKeywords).toEqual(['ueno bank collapse'])
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

    /** Write a brief the way an old row holds it: no new fields, a title as the target. */
    async function writeRawBrief(id: string, brief: SearchBrief) {
      const {
        searchedTitles: _t,
        otherLanguages: _o,
        recommendedAngle: _r,
        recommendationReason: _rr,
        ownAngle: _a,
        ...old
      } = brief
      await db.execute(
        dsql`update cases set search_brief = ${JSON.stringify(old)}::jsonb where id = ${id}`,
      )
    }
    const oldTitleBrief = () =>
      briefFor('WeWork', {
        targetKeyword: kw('wework: the full story', 90),
        secondaryKeywords: [kw('wework collapse', 80), kw('wework bankruptcy', 50)],
      })

    it('reads an old brief upgraded', async () => {
      const row = await createCase(db, { channelId, title: 'Old brief', category: 'con' })
      await writeRawBrief(row.id, oldTitleBrief())
      const got = await getCase(db, row.id)
      expect(got?.searchBrief?.searchedTitles.map((k) => k.keyword)).toEqual([
        'wework: the full story',
      ])
      expect(got?.searchBrief?.targetKeyword?.keyword).toBe('wework collapse')
      expect((await listCases(db, channelId))[0]?.searchBrief?.searchedTitles).toHaveLength(1)
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
        const got = (await chooseCaseAngle(db, id, { option: 1 })).summary
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
        const got = (await chooseCaseAngle(db, id, { own: '  My own telling  ' })).summary
        expect(got.angle).toBe('My own telling')
        expect(got.searchBrief?.chosenAngle).toBeNull()
      })

      it('marks an own angle chosen and clears it for an option', async () => {
        const id = await researched()
        const own = (await chooseCaseAngle(db, id, { own: 'My own telling' })).summary
        expect(own.searchBrief?.ownAngle).toBe(true)
        const option = (await chooseCaseAngle(db, id, { option: 0 })).summary
        expect(option.searchBrief?.ownAngle).toBe(false)
        expect(option.searchBrief?.chosenAngle).toBe(0)
      })

      it('refuses an option that does not exist, and a case with no brief', async () => {
        const id = await researched()
        await expect(chooseCaseAngle(db, id, { option: 5 })).rejects.toThrow()
        const bare = await createCase(db, { channelId, title: 'Bare', category: 'con' })
        await expect(chooseCaseAngle(db, bare.id, { option: 0 })).rejects.toThrow()
      })
    })

    describe('an angle follows the target', () => {
      const angleText = (n: string) => `An angle about ${n} that is long enough to pass`
      const option = (keyword: string, n = keyword) => ({
        angle: angleText(n),
        keyword,
        answers: [],
        gap: 'x',
      })
      async function researchedWith(over: Partial<SearchBrief>) {
        const row = await createCase(db, { channelId, title: 'Case', category: 'con' })
        await writeCaseResearchJob(db, row.id, () => job('t1'))
        await saveCaseSearchBrief(db, row.id, briefFor('WeWork', over), 't1')
        return row.id
      }

      it("makes the chosen angle's keyword the target", async () => {
        const id = await researchedWith({ angleOptions: [option('Wework Bankruptcy ')] })
        const got = await chooseCaseAngle(db, id, { option: 0 })
        expect(got.summary.searchBrief?.targetKeyword?.keyword).toBe('wework bankruptcy')
        expect(got.summary.searchBrief?.secondaryKeywords.map((k) => k.keyword)).toContain(
          'wework collapse',
        )
        expect(got.targetChange).toEqual({ to: 'wework bankruptcy' })
        expect(got.summary.angle).toBe(angleText('Wework Bankruptcy '))
      })

      it("keeps the target when the angle's keyword is not eligible", async () => {
        const id = await researchedWith({
          secondaryKeywords: [
            kw('wework $47 billion'),
            kw('wework documentary'),
            { ...kw('wework gossip'), fit: 'off' },
            kw('wework: the full story'),
          ],
          searchedTitles: [kw('wework: the full story')],
          offIntent: [kw('wework memes')],
          angleOptions: [
            option('wework $47 billion'),
            option('wework: the full story'),
            option('wework gossip'),
          ],
        })
        const figure = await chooseCaseAngle(db, id, { option: 0 })
        expect(figure.targetChange).toEqual({
          keptBecause: "This angle's keyword has a figure, so the target stays wework collapse",
        })
        const title = await chooseCaseAngle(db, id, { option: 1 })
        expect(title.targetChange).toEqual({
          keptBecause: 'This angle serves a searched title, so the target stays wework collapse',
        })
        const off = await chooseCaseAngle(db, id, { option: 2 })
        expect(off.targetChange).toEqual({
          keptBecause:
            "This angle's keyword does not fit this channel, so the target stays wework collapse",
        })
        expect(off.summary.searchBrief?.targetKeyword?.keyword).toBe('wework collapse')
        const other = await researchedWith({
          offIntent: [kw('wework memes')],
          angleOptions: [option('wework memes')],
        })
        const offIntent = await chooseCaseAngle(db, other, { option: 0 })
        expect(offIntent.targetChange).toEqual({
          keptBecause:
            "This angle's keyword does not fit this channel, so the target stays wework collapse",
        })
      })

      it('says nothing for an own angle, the target itself or a keyword found nowhere', async () => {
        const id = await researchedWith({
          angleOptions: [option('wework collapse'), option('something else'), option('')],
        })
        expect((await chooseCaseAngle(db, id, { own: 'My own telling' })).targetChange).toBeNull()
        expect((await chooseCaseAngle(db, id, { option: 0 })).targetChange).toBeNull()
        expect((await chooseCaseAngle(db, id, { option: 1 })).targetChange).toBeNull()
        expect((await chooseCaseAngle(db, id, { option: 2 })).targetChange).toBeNull()
      })

      it('writes the demand notes from the brief with the new target', async () => {
        const id = await researchedWith({ angleOptions: [option('wework bankruptcy')] })
        const got = await chooseCaseAngle(db, id, { option: 0 })
        expect(got.summary.demandNotes).toBe(briefDemandNotes(got.summary.searchBrief!))
        expect(got.summary.demandNotes).toContain('wework bankruptcy')
      })
    })

    describe('saving evidence', () => {
      const check = (keyword: string, checkedAt: string): FieldCheck => ({
        keyword,
        checkedAt,
        results: [],
      })
      const test = (angle: string, verdict = 'ok'): NicheTest => ({
        angle,
        verdict,
        direct: false,
        evidence: [],
        notes: '',
      })

      it('saves a field check for the target and replaces an older one', async () => {
        const id = await researched()
        await saveCaseFieldCheck(db, id, check('wework collapse', '2026-11-01T00:00:00.000Z'))
        const got = await saveCaseFieldCheck(
          db,
          id,
          check('WeWork Collapse', '2026-11-02T00:00:00.000Z'),
        )
        expect(got?.searchBrief?.fieldChecks).toEqual([
          check('WeWork Collapse', '2026-11-02T00:00:00.000Z'),
        ])
      })

      it('drops the oldest field check at the cap', async () => {
        const id = await researched()
        for (const [i, k] of ['a', 'b', 'c', 'd'].entries()) {
          await saveCaseFieldCheck(db, id, check(k, `2026-11-0${i + 1}T00:00:00.000Z`))
        }
        const got = await saveCaseFieldCheck(db, id, check('e', '2026-11-09T00:00:00.000Z'))
        expect(got?.searchBrief?.fieldChecks?.map((c) => c.keyword)).toEqual(['b', 'c', 'd', 'e'])
      })

      it('saves a niche test for a chosen angle, replacing the same angle', async () => {
        const id = await researched()
        await saveCaseNicheTest(db, id, test('first angle', 'one'))
        const got = await saveCaseNicheTest(db, id, test('first angle', 'two'))
        expect(got?.searchBrief?.nicheTests).toEqual([test('first angle', 'two')])
      })

      it('drops the first niche test at the cap', async () => {
        const id = await researched()
        for (const a of ['a', 'b', 'c']) await saveCaseNicheTest(db, id, test(a))
        const got = await saveCaseNicheTest(db, id, test('d'))
        expect(got?.searchBrief?.nicheTests?.map((t) => t.angle)).toEqual(['b', 'c', 'd'])
      })

      it('keeps a pending niche job per angle, at most three, and clears it with the test', async () => {
        const id = await researched()
        const job = (angle: string, jobId = 'j') => ({
          angle,
          jobId,
          startedAt: '2026-11-01T00:00:00.000Z',
        })
        await saveCaseNicheJob(db, id, job('a', 'one'))
        const replaced = await saveCaseNicheJob(db, id, job('a', 'two'))
        expect(replaced?.searchBrief?.nicheJobs).toEqual([job('a', 'two')])
        for (const a of ['b', 'c']) await saveCaseNicheJob(db, id, job(a))
        const capped = await saveCaseNicheJob(db, id, job('d'))
        expect(capped?.searchBrief?.nicheJobs?.map((j) => j.angle)).toEqual(['b', 'c', 'd'])
        const collected = await saveCaseNicheTest(db, id, test('c'))
        expect(collected?.searchBrief?.nicheJobs?.map((j) => j.angle)).toEqual(['b', 'd'])
        const dropped = await dropCaseNicheJob(db, id, 'b')
        expect(dropped?.searchBrief?.nicheJobs?.map((j) => j.angle)).toEqual(['d'])
      })

      it('writes nothing when there is no brief or the result would not parse', async () => {
        const bare = await createCase(db, { channelId, title: 'Bare', category: 'con' })
        expect(
          await saveCaseFieldCheck(db, bare.id, check('a', '2026-11-01T00:00:00.000Z')),
        ).toBeNull()
        const id = await researched()
        expect(await saveCaseFieldCheck(db, id, check('a', 'not a date'))).toBeNull()
        expect((await getCase(db, id))?.searchBrief?.fieldChecks).toBeUndefined()
        expect(await saveCaseNicheTest(db, id, test('a', 'x'.repeat(301)))).toBeNull()
      })
    })

    describe('addCaseOwnerKeyword (decision 467)', () => {
      it("adds the phrase as the owner's keyword and keeps it as a seed", async () => {
        const id = await researched()
        expect(await addCaseOwnerKeyword(db, id, kw('wework documentary', 75))).toBe('added')
        const got = await getCase(db, id)
        expect(got?.searchBrief?.secondaryKeywords.at(-1)).toEqual({
          ...kw('wework documentary', 75),
          owner: true,
        })
        expect(got?.seedKeywords).toEqual(['wework documentary'])
        // The owner's keyword can then be made the target.
        const swapped = await setCaseTargetKeyword(db, id, 'wework documentary')
        expect(swapped.searchBrief?.targetKeyword?.keyword).toBe('wework documentary')
      })

      it('refuses a phrase the brief already shows, in any case or spacing', async () => {
        const id = await researched()
        expect(await addCaseOwnerKeyword(db, id, kw('WeWork  Collapse'))).toBe('present')
        expect(await addCaseOwnerKeyword(db, id, kw('wework bankruptcy'))).toBe('present')
        expect((await getCase(db, id))?.seedKeywords).toEqual([])
      })

      it("stops at five of the owner's own keywords", async () => {
        const id = await researched()
        for (const n of ['one', 'two', 'three', 'four', 'five']) {
          expect(await addCaseOwnerKeyword(db, id, kw(`wework ${n}`))).toBe('added')
        }
        expect(await addCaseOwnerKeyword(db, id, kw('wework six'))).toBe('full')
        const got = await getCase(db, id)
        expect(got?.searchBrief?.secondaryKeywords.filter((k) => k.owner)).toHaveLength(5)
        expect(got?.seedKeywords).toHaveLength(5)
      })

      it('says no-brief for a case never researched', async () => {
        const bare = await createCase(db, { channelId, title: 'Unresearched', category: 'con' })
        expect(await addCaseOwnerKeyword(db, bare.id, kw('anything'))).toBe('no-brief')
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

      it('refuses a searched title as the target', async () => {
        const id = await researched()
        await writeRawBrief(id, oldTitleBrief())
        await expect(setCaseTargetKeyword(db, id, 'wework: the full story')).rejects.toThrow(
          'a searched video title or another language cannot be the target keyword',
        )
      })

      it('refuses a keyword with a figure, and one that is not a secondary', async () => {
        const id = await researched()
        await expect(setCaseTargetKeyword(db, id, 'wework $47 billion')).rejects.toThrow(/figure/)
        await expect(setCaseTargetKeyword(db, id, 'nothing here')).rejects.toThrow()
        expect((await getCase(db, id))?.searchBrief?.targetKeyword?.keyword).toBe('wework collapse')
      })
    })

    describe('saveCaseAngleRating', () => {
      const optionTexts = [
        'How a lease broker became a unicorn on borrowed hype',
        'The board that signed off on every excess',
      ]

      it('saves a rating for the options it rated', async () => {
        const id = await researched()
        const got = await saveCaseAngleRating(db, id, {
          options: optionTexts,
          recommended: 1,
          reason: '  The board is the part nobody has told.  ',
        })
        expect(got?.searchBrief?.recommendedAngle).toBe(1)
        expect(got?.searchBrief?.recommendationReason).toBe(
          'The board is the part nobody has told.',
        )
      })

      it('refuses a rating for options that changed', async () => {
        const id = await researched()
        const before = (await getCase(db, id))?.updatedAt
        const got = await saveCaseAngleRating(db, id, {
          options: [optionTexts[1]!, optionTexts[0]!],
          recommended: 0,
          reason: 'x',
        })
        expect(got).toBeNull()
        const after = await getCase(db, id)
        expect(after?.searchBrief?.recommendedAngle).toBeNull()
        expect(after?.updatedAt).toEqual(before)
        const bare = await createCase(db, { channelId, title: 'Bare', category: 'con' })
        expect(
          await saveCaseAngleRating(db, bare.id, {
            options: optionTexts,
            recommended: 0,
            reason: 'x',
          }),
        ).toBeNull()
      })

      it('cuts an over-long reason to 200 characters', async () => {
        const id = await researched()
        const got = await saveCaseAngleRating(db, id, {
          options: optionTexts,
          recommended: 0,
          reason: 'a'.repeat(300),
        })
        expect(got?.searchBrief?.recommendationReason).toHaveLength(200)
        expect((await getCase(db, id))?.searchBrief).not.toBeNull()
      })

      it('refuses an index outside the options', async () => {
        const id = await researched()
        for (const recommended of [2, -1, 0.5]) {
          expect(
            await saveCaseAngleRating(db, id, { options: optionTexts, recommended, reason: 'x' }),
          ).toBeNull()
        }
        expect((await getCase(db, id))?.searchBrief?.recommendedAngle).toBeNull()
      })

      it('a rating save moves default notes and keeps edited ones', async () => {
        const id = await researched()
        await chooseCaseAngle(db, id, { option: 0 })
        const rating = { options: optionTexts, recommended: 1, reason: 'Untold part.' }
        const moved = await saveCaseAngleRating(db, id, rating)
        expect(moved?.demandNotes).toBe(briefDemandNotes(moved!.searchBrief!))
        await updateCase(db, id, { demandNotes: 'Owner note' })
        const kept = await saveCaseAngleRating(db, id, { ...rating, recommended: 0 })
        expect(kept?.demandNotes).toBe('Owner note')
      })

      it('notes from the pre-upgrade brief follow the upgraded target', async () => {
        const id = await researched()
        const old = oldTitleBrief()
        await writeRawBrief(id, old)
        await updateCase(db, id, {
          demandNotes: briefDemandNotes(SearchBriefSchema.parse(old)),
        })
        const got = await setCaseTargetKeyword(db, id, 'wework bankruptcy')
        expect(got.demandNotes).toBe(briefDemandNotes(got.searchBrief!))
        expect(got.demandNotes).toContain('wework bankruptcy')
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

      it('reads a frozen project brief upgraded', async () => {
        const id = await researched()
        const project = await createProjectFromCase(db, { caseId: id, title: 'Old frozen' })
        await db.execute(
          dsql`update projects set search_brief = ${JSON.stringify({
            ...oldTitleBrief(),
            searchedTitles: undefined,
          })}::jsonb where id = ${project.id}`,
        )
        const got = await getProject(db, project.id)
        expect(got?.searchBrief?.searchedTitles.map((k) => k.keyword)).toEqual([
          'wework: the full story',
        ])
        expect(got?.searchBrief?.targetKeyword?.keyword).toBe('wework collapse')
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
