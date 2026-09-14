// @vitest-environment node

import {
  createScriptVersion,
  FIXTURE_PROJECT_ID,
  getProject,
  requireTestDatabase,
  saveChapter,
  seed,
  setProjectDirection,
  setScriptOutline,
} from '@boom-busters/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { loadDirectionInputs, loadOrDraftDirectorsBook } from './direction'

/**
 * The direction helpers against the real database, in mock-provider mode
 * (decision 252): the outline's tension fields reach the prompt inputs, a
 * book is drafted once, and an owner-edited book is reused rather than
 * overwritten.
 */

const describeDb = requireTestDatabase() ? describe : describe.skip

describeDb('direction helpers (mock mode)', () => {
  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    await seed(db)
    await setProjectDirection(db, FIXTURE_PROJECT_ID, null)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The audit',
      contentMd: 'First paragraph.\n\n[long pause]\n\nSecond paragraph.',
      estRuntimeSec: 30,
    })
    await setScriptOutline(db, script.id, {
      centralQuestion: 'Where was the money?',
      chapters: [
        { title: 'The audit', beat: 'x'.repeat(30), withhold: 'The trustee', targetWords: 300 },
      ],
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('reads the outline tension fields and splits paragraphs, skipping bare tags', async () => {
    const inputs = await loadDirectionInputs(FIXTURE_PROJECT_ID)
    expect(inputs.centralQuestion).toBe('Where was the money?')
    expect(inputs.chapters[0]?.withhold).toBe('The trustee')
    expect(inputs.chapters[0]?.paragraphs).toEqual(['First paragraph.', 'Second paragraph.'])
    expect(inputs.styleAnchors).toContain('grain')
  })

  it('drafts a mock book once and reuses the stored one after', async () => {
    const first = await loadOrDraftDirectorsBook(FIXTURE_PROJECT_ID)
    expect(first.chapters).toHaveLength(1)
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.direction).toMatchObject({
      motifs: first.motifs,
    })

    await setProjectDirection(db, FIXTURE_PROJECT_ID, {
      ...first,
      visualThesis: 'edited by the owner',
    })
    const second = await loadOrDraftDirectorsBook(FIXTURE_PROJECT_ID)
    expect(second.visualThesis).toBe('edited by the owner')
  })
})
