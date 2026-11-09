import { FIRST_CHANNEL_IN_USE, RESEARCH_PROFILE_KEYS } from '@boom-busters/schemas'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PROFILE_PROMPTS } from './dossier-profiles'
import { buildBriefRequest } from './dossier'

describe('dossier profile prompts', () => {
  it('composes the investigation house rules exactly as before', () => {
    const fixture = JSON.parse(
      readFileSync(join(__dirname, 'lift', '__fixtures__', 'dossier-brief-bare.json'), 'utf8'),
    ) as { system: string }
    const request = buildBriefRequest(
      { title: 'Wirecard', category: 'collapse', angle: null, demandNotes: null },
      '',
      FIRST_CHANNEL_IN_USE,
    )
    expect(request.system).toBe(fixture.system)
  })

  it('has text for every profile', () => {
    for (const key of RESEARCH_PROFILE_KEYS) {
      expect(PROFILE_PROMPTS[key].opening(FIRST_CHANNEL_IN_USE.bible)).not.toBe('')
      expect(PROFILE_PROMPTS[key].stakes(FIRST_CHANNEL_IN_USE.bible)).not.toBe('')
    }
    expect(PROFILE_PROMPTS.investigation.extraRules).toEqual([])
    const bible = FIRST_CHANNEL_IN_USE.bible
    expect(PROFILE_PROMPTS.science.opening(bible)).not.toBe(
      PROFILE_PROMPTS.investigation.opening(bible),
    )
    expect(PROFILE_PROMPTS.science.stakes(bible)).not.toBe(
      PROFILE_PROMPTS.investigation.stakes(bible),
    )
    expect(PROFILE_PROMPTS.science.extraRules).toHaveLength(2)
    expect(PROFILE_PROMPTS.science.evidenceRules).not.toBe('')
  })
})
