import { EXAMPLE_SLOT_IDS } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { LIFT_CASES } from './lift-cases'
import { FINANCE_WORDS, PSYCHOLOGY_TEST_BIBLE } from './psychology-bible'

/**
 * The second channel's proof: every builder that reads the bible, handed an
 * imagined psychology channel's bible, sends no Boom & Busters wording and
 * does name the channel's own subject. Families join as their tasks set
 * `bibleAware`; the rest stay out until then.
 */
describe.each(LIFT_CASES.filter((c) => c.bibleAware))('$name for a psychology channel', (c) => {
  const { system } = c.build({ bible: PSYCHOLOGY_TEST_BIBLE, slotIds: EXAMPLE_SLOT_IDS })

  it('carries no finance wording', () => {
    const lower = system.toLowerCase()
    expect(FINANCE_WORDS.filter((word) => lower.includes(word))).toEqual([])
  })

  it("names the channel's own subject", () => {
    expect(system).toContain(PSYCHOLOGY_TEST_BIBLE.subject)
  })
})
