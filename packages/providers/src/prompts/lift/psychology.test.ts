import { EXAMPLE_SLOT_IDS, FIRST_CHANNEL_BIBLE, FIRST_CHANNEL_IN_USE } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { LIFT_CASES } from './lift-cases'
import { FINANCE_WORDS, PSYCHOLOGY_TEST_BIBLE } from './psychology-bible'

/**
 * The second channel's proof: every builder that reads the bible, handed an
 * imagined psychology channel's bible, sends no Boom & Busters wording. Where
 * the first channel's prompt names the channel's subject, the second's names
 * its own. Families join as their tasks set `bibleAware`; the rest stay out
 * until then.
 */
describe.each(LIFT_CASES.filter((c) => c.bibleAware))('$name for a psychology channel', (c) => {
  const { system } = c.build({ bible: PSYCHOLOGY_TEST_BIBLE, slotIds: EXAMPLE_SLOT_IDS })

  it('carries no finance wording', () => {
    // The dossier's grading of what a court or regulator found stays for every
    // channel (spec section 2; project 3 gives a psychology channel its
    // "replicated or contested"). That one sentence is the only exemption.
    const lower = system
      .replace('what a court or regulator FOUND from what was ALLEGED or reported', '')
      .toLowerCase()
    expect(FINANCE_WORDS.filter((word) => lower.includes(word))).toEqual([])
  })

  it("names the channel's own subject where the first channel's prompt names its", () => {
    // The first channel's `subject` field is worded differently from the subject
    // slot each prompt prints (corporate collapses ... and turnarounds), so the
    // slot's text is the thing to look for in the first channel's prompt. The
    // script and dossier prompts each print their own slot; the subject-naming
    // prompt prints the `subject` field itself.
    const first = c.build(FIRST_CHANNEL_IN_USE).system
    if (first.includes(FIRST_CHANNEL_BIBLE.examples['script-channel-subject']!)) {
      expect(system).toContain(PSYCHOLOGY_TEST_BIBLE.subject)
    }
    if (first.includes(FIRST_CHANNEL_BIBLE.examples['dossier-channel-subject']!)) {
      expect(system).toContain(PSYCHOLOGY_TEST_BIBLE.examples['dossier-channel-subject']!)
    }
    if (first.includes(FIRST_CHANNEL_BIBLE.subject)) {
      expect(system).toContain(PSYCHOLOGY_TEST_BIBLE.subject)
    }
  })
})
