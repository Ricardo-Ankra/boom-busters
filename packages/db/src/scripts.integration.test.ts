import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createCase, truncateCases } from './cases'
import { createDb } from './client'
import { saveDossier } from './dossiers'
import { createProjectFromCase } from './projects'
import {
  countWarnings,
  createScriptVersion,
  editChapter,
  getLatestScript,
  listClaimRefs,
  listScriptEdits,
  projectIdForChapter,
  reorderChapters,
  saveChapter,
  saveClaimRefs,
  setChapterWarnings,
  setShortsCandidates,
} from './scripts'
import { requireTestDatabase } from './test-database'

const url = requireTestDatabase()
const suite = url ? describe : describe.skip

suite('scripts and the edit trail', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })
  let projectId = ''
  let scriptId = ''

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  beforeEach(async () => {
    await truncateCases(db)
    const source = await createCase(db, { title: 'Enron', category: 'collapse' })
    const project = await createProjectFromCase(db, { caseId: source.id, title: 'Enron' })
    projectId = project.id
    scriptId = (await createScriptVersion(db, projectId)).id
  })

  it('numbers versions from one', async () => {
    expect((await getLatestScript(db, projectId))?.script.version).toBe(1)
  })

  it('starts a new version rather than overwriting the last', async () => {
    // The previous version holds edits a human made; destroying it destroys
    // the evidence trail.
    const second = await createScriptVersion(db, projectId)

    expect(second.version).toBe(2)
    expect((await getLatestScript(db, projectId))?.script.id).toBe(second.id)
  })

  it('keeps chapters in outline order', async () => {
    await saveChapter(db, { scriptId, index: 1, title: 'Two', contentMd: 'b', estRuntimeSec: 1 })
    await saveChapter(db, { scriptId, index: 0, title: 'One', contentMd: 'a', estRuntimeSec: 1 })

    expect((await getLatestScript(db, projectId))?.chapters.map((c) => c.title)).toEqual([
      'One',
      'Two',
    ])
  })

  it('re-drafting a chapter replaces it rather than duplicating the index', async () => {
    await saveChapter(db, { scriptId, index: 0, title: 'One', contentMd: 'a', estRuntimeSec: 1 })
    await saveChapter(db, { scriptId, index: 0, title: 'One', contentMd: 'b', estRuntimeSec: 2 })

    const script = await getLatestScript(db, projectId)
    expect(script?.chapters).toHaveLength(1)
    expect(script?.chapters[0]?.contentMd).toBe('b')
  })

  describe('editChapter', () => {
    let chapterId = ''

    beforeEach(async () => {
      const row = await saveChapter(db, {
        scriptId,
        index: 0,
        title: 'One',
        contentMd: 'The original text.',
        estRuntimeSec: 1,
      })
      chapterId = row.id
    })

    it('records what the edit replaced', async () => {
      await editChapter(db, {
        chapterId,
        afterText: 'The edited text.',
        editType: 'human',
        estRuntimeSec: 1,
      })

      const [edit] = await listScriptEdits(db, [chapterId])
      expect(edit?.beforeText).toBe('The original text.')
      expect(edit?.afterText).toBe('The edited text.')
      expect(edit?.editType).toBe('human')
    })

    it('keeps the note from a regenerate', async () => {
      await editChapter(db, {
        chapterId,
        afterText: 'Regenerated.',
        editType: 'regenerate',
        note: 'Too breathless',
        estRuntimeSec: 1,
      })

      expect((await listScriptEdits(db, [chapterId]))[0]?.note).toBe('Too breathless')
    })

    it('does not record an edit that changed nothing', async () => {
      // Autosave fires on a debounce; recording no-ops would bury the real
      // edits under noise.
      await editChapter(db, {
        chapterId,
        afterText: 'The original text.',
        editType: 'human',
        estRuntimeSec: 1,
      })

      expect(await listScriptEdits(db, [chapterId])).toHaveLength(0)
    })

    it('builds a trail in newest-first order', async () => {
      await editChapter(db, { chapterId, afterText: 'v2', editType: 'human', estRuntimeSec: 1 })
      await editChapter(db, { chapterId, afterText: 'v3', editType: 'human', estRuntimeSec: 1 })

      const trail = await listScriptEdits(db, [chapterId])
      expect(trail).toHaveLength(2)
      expect(trail[0]?.afterText).toBe('v3')
    })

    it('returns undefined for a chapter that no longer exists', async () => {
      expect(
        await editChapter(db, {
          chapterId: '01ABCDEFGHJKMNPQRSTVWXYZ99',
          afterText: 'x',
          editType: 'human',
          estRuntimeSec: 1,
        }),
      ).toBeUndefined()
    })
  })

  describe('claim refs', () => {
    let chapterId = ''
    let claimId = ''

    beforeEach(async () => {
      const row = await saveChapter(db, {
        scriptId,
        index: 0,
        title: 'One',
        contentMd: 'Enron filed for bankruptcy.',
        estRuntimeSec: 1,
      })
      chapterId = row.id

      const dossier = await saveDossier(db, {
        projectId,
        contentMd: '#',
        claims: [
          {
            text: 'Enron filed in December 2001.',
            sourceUrl: 'https://example.com',
            sourceType: 'court',
            confidence: 'sourced',
          },
        ],
      })
      claimId = dossier.claims[0]!.id
    })

    it('pins a claim to a sentence', async () => {
      await saveClaimRefs(db, {
        chapterId,
        projectId,
        refs: [{ claimId, sentence: 'Enron filed for bankruptcy.' }],
      })

      const refs = await listClaimRefs(db, chapterId)
      expect(refs).toHaveLength(1)
      expect(refs[0]?.text).toBe('Enron filed in December 2001.')
    })

    it('drops a claim id the model invented rather than failing the step', async () => {
      // The self-check pass reports ids a model typed. A mistyped one would
      // otherwise blow up the whole chapter on a foreign key.
      const saved = await saveClaimRefs(db, {
        chapterId,
        projectId,
        refs: [
          { claimId, sentence: 'Enron filed for bankruptcy.' },
          { claimId: '01ZZZZZZZZZZZZZZZZZZZZZZZZ', sentence: 'Something else.' },
        ],
      })

      expect(saved).toBe(1)
    })

    it('deduplicates the same pairing reported twice', async () => {
      const saved = await saveClaimRefs(db, {
        chapterId,
        projectId,
        refs: [
          { claimId, sentence: 'Enron filed for bankruptcy.' },
          { claimId, sentence: 'Enron filed for bankruptcy.' },
        ],
      })

      expect(saved).toBe(1)
    })

    it('replaces refs on a re-check rather than accumulating them', async () => {
      await saveClaimRefs(db, {
        chapterId,
        projectId,
        refs: [{ claimId, sentence: 'Enron filed for bankruptcy.' }],
      })
      await saveClaimRefs(db, { chapterId, projectId, refs: [] })

      expect(await listClaimRefs(db, chapterId)).toHaveLength(0)
    })
  })

  it('stores and counts gutter warnings', async () => {
    const row = await saveChapter(db, {
      scriptId,
      index: 0,
      title: 'One',
      contentMd: 'Text.',
      estRuntimeSec: 1,
    })

    await setChapterWarnings(db, row.id, [
      { kind: 'unsourced-claim', sentence: 'Text.', message: 'No claim supports this.' },
    ])

    const script = await getLatestScript(db, projectId)
    expect(countWarnings(script!.chapters)).toBe(1)
    expect(script!.chapters[0]?.warnings[0]?.kind).toBe('unsourced-claim')
  })

  it('defaults warnings to an empty list, never null', async () => {
    await saveChapter(db, { scriptId, index: 0, title: 'One', contentMd: 'x', estRuntimeSec: 1 })

    const script = await getLatestScript(db, projectId)
    expect(script?.chapters[0]?.warnings).toEqual([])
  })

  it('resolves the project a chapter belongs to, for authorising edits', async () => {
    const row = await saveChapter(db, {
      scriptId,
      index: 0,
      title: 'One',
      contentMd: 'x',
      estRuntimeSec: 1,
    })

    expect(await projectIdForChapter(db, row.id)).toBe(projectId)
  })
  describe('reorderChapters', () => {
    let ids: string[] = []

    beforeEach(async () => {
      ids = []
      for (const [index, title] of ['One', 'Two', 'Three'].entries()) {
        const row = await saveChapter(db, {
          scriptId,
          index,
          title,
          contentMd: title,
          estRuntimeSec: 1,
        })
        ids.push(row.id)
      }
    })

    const titles = async () =>
      (await getLatestScript(db, projectId))!.chapters.map((chapter) => chapter.title)

    it('swaps two chapters without tripping the unique index', async () => {
      // Writing final indexes directly collides: the first update lands on an
      // index the second still holds. The two-phase parking is what avoids it.
      const result = await reorderChapters(db, scriptId, [ids[1]!, ids[0]!, ids[2]!])

      expect(result.ok).toBe(true)
      expect(await titles()).toEqual(['Two', 'One', 'Three'])
    })

    it('moves a chapter from the end to the front', async () => {
      await reorderChapters(db, scriptId, [ids[2]!, ids[0]!, ids[1]!])
      expect(await titles()).toEqual(['Three', 'One', 'Two'])
    })

    it('reverses the whole script', async () => {
      await reorderChapters(db, scriptId, [ids[2]!, ids[1]!, ids[0]!])
      expect(await titles()).toEqual(['Three', 'Two', 'One'])
    })

    it('leaves indexes contiguous from zero', async () => {
      await reorderChapters(db, scriptId, [ids[2]!, ids[0]!, ids[1]!])

      const indexes = (await getLatestScript(db, projectId))!.chapters.map((c) => c.index)
      expect(indexes).toEqual([0, 1, 2])
    })

    it('refuses an order that drops a chapter', async () => {
      const result = await reorderChapters(db, scriptId, [ids[0]!, ids[1]!])

      expect(result).toEqual({ ok: false, error: expect.stringContaining('Expected 3 chapters') })
      expect(await titles()).toEqual(['One', 'Two', 'Three'])
    })

    it('refuses an order listing the same chapter twice', async () => {
      const result = await reorderChapters(db, scriptId, [ids[0]!, ids[0]!, ids[1]!])

      expect(result.ok).toBe(false)
      expect(await titles()).toEqual(['One', 'Two', 'Three'])
    })

    it('refuses a chapter from another script', async () => {
      const other = await createScriptVersion(db, projectId)
      const stranger = await saveChapter(db, {
        scriptId: other.id,
        index: 0,
        title: 'Stranger',
        contentMd: 'x',
        estRuntimeSec: 1,
      })

      const result = await reorderChapters(db, scriptId, [ids[0]!, ids[1]!, stranger.id])
      expect(result.ok).toBe(false)
    })

    it('does not disturb claim refs — they key on chapterId, not position', async () => {
      const dossier = await saveDossier(db, {
        projectId,
        contentMd: '#',
        claims: [
          {
            text: 'A claim to pin.',
            sourceUrl: 'https://example.com',
            sourceType: 'court',
            confidence: 'sourced',
          },
        ],
      })
      await saveClaimRefs(db, {
        chapterId: ids[0]!,
        projectId,
        refs: [{ claimId: dossier.claims[0]!.id, sentence: 'One' }],
      })

      await reorderChapters(db, scriptId, [ids[2]!, ids[1]!, ids[0]!])

      expect(await listClaimRefs(db, ids[0]!)).toHaveLength(1)
    })
  })

  it('stores Shorts candidates on the script', async () => {
    // They used to be generated, counted at the gate, and thrown away.
    await setShortsCandidates(db, scriptId, [
      {
        chapterIndex: 0,
        startSentence: 'A.',
        endSentence: 'B.',
        hookRationale: 'It is surprising.',
      },
    ])

    const script = await getLatestScript(db, projectId)
    expect(script?.script.shortsCandidates).toHaveLength(1)
    expect(script?.script.shortsCandidates[0]?.hookRationale).toBe('It is surprising.')
  })

  it('defaults Shorts candidates to an empty list, never null', async () => {
    expect((await getLatestScript(db, projectId))?.script.shortsCandidates).toEqual([])
  })
})
