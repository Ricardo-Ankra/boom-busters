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
    let own = system.replace(
      'what a court or regulator FOUND from what was ALLEGED or reported',
      '',
    )
    // What the case's own input puts in the prompt is the caller's data, not the builder's.
    for (const text of c.inputText ?? []) own = own.replace(text, '')
    const lower = own.toLowerCase()
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
    // The direction and shot-list prompts open on what the documentary is about.
    if (first.includes(FIRST_CHANNEL_BIBLE.examples['direction-premise']!)) {
      expect(system).toContain(PSYCHOLOGY_TEST_BIBLE.examples['direction-premise']!)
    }
    if (first.includes(FIRST_CHANNEL_BIBLE.subject)) {
      expect(system).toContain(PSYCHOLOGY_TEST_BIBLE.subject)
    }
  })
})

describe('the science profile on a psychology channel', () => {
  const inUse = {
    bible: { ...PSYCHOLOGY_TEST_BIBLE, researchProfile: 'science' as const },
    slotIds: EXAMPLE_SLOT_IDS,
  }
  const cases = LIFT_CASES.filter(
    (c) => c.name.startsWith('dossier-') && c.name.includes('science'),
  )

  it('has a science case for the brief, scenes, claims and answers', () => {
    expect(cases.map((c) => c.name).sort()).toEqual([
      'dossier-answers-science',
      'dossier-brief-science',
      'dossier-claims-science',
      'dossier-scenes-science',
    ])
  })

  it.each(cases)('$name speaks of what a study MEASURED and refuses advice', (c) => {
    const { system } = c.build(inUse)
    expect(system).toContain('MEASURED')
    expect(system).toContain('never turn a finding into advice')
  })

  it('asks for the evidence axis in the claims and answers requests', () => {
    for (const name of ['dossier-claims-science', 'dossier-answers-science']) {
      const request = cases.find((c) => c.name === name)!.build(inUse)
      const last = request.messages[request.messages.length - 1]!
      expect(String(last.content)).toContain('"evidence"')
      expect(String(last.content)).toContain("among the claim's `supports`")
      expect(String(last.content)).toContain('whose `quote` includes the words "meta-analysis"')
    }
  })
})

describe('the lift is complete', () => {
  it('every case in LIFT_CASES reads the bible', () => {
    expect(LIFT_CASES.filter((c) => !c.bibleAware).map((c) => c.name)).toEqual([])
  })
})

describe('the slot passes carry the channel direction rules', () => {
  const RULE = "Never show a patient's face."
  const bible = { ...PSYCHOLOGY_TEST_BIBLE, directionRulesMd: RULE }
  const inUse = { bible, slotIds: EXAMPLE_SLOT_IDS }

  it.each(LIFT_CASES.filter((c) => c.name.includes('rebrief') || c.name.includes('redirect')))(
    '$name prints the rules after the craft',
    (c) => {
      const { system } = c.build(inUse)
      expect(system).toContain("This channel's rules")
      expect(system).toContain(RULE)
      expect(
        c.build({ bible: PSYCHOLOGY_TEST_BIBLE, slotIds: EXAMPLE_SLOT_IDS }).system,
      ).not.toContain("This channel's rules")
    },
  )
})
