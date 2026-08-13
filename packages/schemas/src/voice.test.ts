import { describe, expect, it } from 'vitest'
import { splitParagraphs } from './script'
import {
  latestTakes,
  takeIdempotencyKey,
  voiceApprovalBlockedReason,
  voiceCoverage,
  type TakeRef,
} from './voice'

const base = {
  projectId: '01HQ0000000000000000000001',
  chapterId: '01HQ0000000000000000000002',
  paragraphIndex: 0,
  text: 'The auditors signed it off for eighteen years.',
  voiceId: 'Charon',
}

describe('takeIdempotencyKey', () => {
  it('is stable for identical input', () => {
    expect(takeIdempotencyKey(base)).toBe(takeIdempotencyKey({ ...base }))
  })

  it.each([
    ['projectId', { projectId: '01HQ000000000000000000000Z' }],
    ['chapterId', { chapterId: '01HQ000000000000000000000Y' }],
    ['paragraphIndex', { paragraphIndex: 1 }],
    ['text', { text: 'The auditors signed it off for eighteen years?' }],
    ['voiceId', { voiceId: 'Kore' }],
  ])('changes when %s changes', (_field, patch) => {
    expect(takeIdempotencyKey({ ...base, ...patch })).not.toBe(takeIdempotencyKey(base))
  })

  /**
   * The opposite rule to `sentenceHash`, and the reason both exist. A claim
   * reference must survive a typo fix; narration must not — fixing the typo is
   * exactly when the line needs reading aloud again.
   */
  it('is sensitive to punctuation and case, unlike sentenceHash', () => {
    expect(takeIdempotencyKey({ ...base, text: 'the auditors signed it off.' })).not.toBe(
      takeIdempotencyKey({ ...base, text: 'The auditors signed it off.' }),
    )
  })
})

describe('splitParagraphs', () => {
  it('splits on blank lines only', () => {
    expect(splitParagraphs('One.\n\nTwo.\n\n\nThree.')).toEqual(['One.', 'Two.', 'Three.'])
  })

  it('joins soft-wrapped lines back into one paragraph', () => {
    // A pause where the markdown happened to wrap would be audible.
    expect(splitParagraphs('The auditors\nsigned it off.\n\nNobody asked.')).toEqual([
      'The auditors signed it off.',
      'Nobody asked.',
    ])
  })

  it('drops whitespace-only paragraphs rather than narrating them', () => {
    expect(splitParagraphs('One.\n\n   \n\nTwo.')).toEqual(['One.', 'Two.'])
  })

  it('handles CRLF, because a pasted edit can carry it', () => {
    expect(splitParagraphs('One.\r\n\r\nTwo.')).toEqual(['One.', 'Two.'])
  })

  it('returns nothing for an empty chapter', () => {
    expect(splitParagraphs('   \n\n  ')).toEqual([])
  })

  it('keeps indexes stable when a later paragraph is edited', () => {
    const before = splitParagraphs('A.\n\nB.\n\nC.')
    const after = splitParagraphs('A.\n\nB.\n\nC, revised.')
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2))
  })
})

describe('pacing in the take key', () => {
  /**
   * Same contract as the pronunciations: every take bought before pacing
   * joined the key was bought at the default 1×, so the default must produce
   * the key it always did — or this change alone would re-buy every video.
   */
  it('is unchanged at the default 1×, so existing takes keep their keys', () => {
    expect(takeIdempotencyKey({ ...base, pacing: 1 })).toBe(takeIdempotencyKey(base))
  })

  /**
   * The bug this field fixes. Pacing changes how every paragraph is spoken
   * without changing a character of the script, so with it outside the key a
   * moved slider was a silent no-op: every fingerprint still matched, a re-run
   * handed back the old audio at the old speed, and nothing on screen said so.
   */
  it('changes when the slider moves, so a re-run re-reads at the new speed', () => {
    expect(takeIdempotencyKey({ ...base, pacing: 0.95 })).not.toBe(takeIdempotencyKey(base))
  })

  it('distinguishes two non-default speeds', () => {
    expect(takeIdempotencyKey({ ...base, pacing: 0.9 })).not.toBe(
      takeIdempotencyKey({ ...base, pacing: 1.1 }),
    )
  })
})

function take(patch: Partial<TakeRef> = {}): TakeRef {
  return { chapterId: 'c1', paragraphIndex: 0, takeNumber: 1, status: 'generated', ...patch }
}

describe('latestTakes', () => {
  it('keeps only the highest take number per paragraph', () => {
    const takes = [
      take({ takeNumber: 1, status: 'flagged' }),
      take({ takeNumber: 2, status: 'generated' }),
      take({ paragraphIndex: 1, takeNumber: 1 }),
    ]

    expect(latestTakes(takes).map((t) => [t.paragraphIndex, t.takeNumber])).toEqual([
      [0, 2],
      [1, 1],
    ])
  })

  it('does not merge the same paragraph index across chapters', () => {
    const takes = [take({ chapterId: 'c1' }), take({ chapterId: 'c2' })]
    expect(latestTakes(takes)).toHaveLength(2)
  })

  it('is order-independent', () => {
    const takes = [take({ takeNumber: 3 }), take({ takeNumber: 1 }), take({ takeNumber: 2 })]
    expect(latestTakes([...takes].reverse())[0]?.takeNumber).toBe(3)
  })
})

describe('voiceCoverage', () => {
  it('counts the current take of each paragraph, not every take ever made', () => {
    // Paragraph 0 was flagged and retaken: the flag is spent, not outstanding.
    const takes = [
      take({ paragraphIndex: 0, takeNumber: 1, status: 'flagged' }),
      take({ paragraphIndex: 0, takeNumber: 2, status: 'generated' }),
      take({ paragraphIndex: 1, takeNumber: 1, status: 'approved' }),
    ]

    expect(voiceCoverage(takes)).toEqual({
      paragraphs: 2,
      generated: 1,
      flagged: 0,
      approved: 1,
      pending: 0,
    })
  })
})

describe('voiceApprovalBlockedReason', () => {
  it('blocks while a paragraph has no audio', () => {
    expect(voiceApprovalBlockedReason([take()], 3)).toBe('2 of 3 paragraphs have no audio yet.')
  })

  it('blocks while synthesis is still in flight', () => {
    expect(voiceApprovalBlockedReason([take({ status: 'pending' })], 1)).toContain(
      'still being synthesised',
    )
  })

  it('blocks on a flagged take, naming the count', () => {
    const takes = [take({ status: 'flagged' }), take({ paragraphIndex: 1, status: 'generated' })]
    expect(voiceApprovalBlockedReason(takes, 2)).toContain('1 flagged take is unresolved')
  })

  it('allows approval at zero flagged, which is the spec rule', () => {
    const takes = [take(), take({ paragraphIndex: 1, status: 'approved' })]
    expect(voiceApprovalBlockedReason(takes, 2)).toBeUndefined()
  })

  it('treats a flagged take that has been retaken as resolved', () => {
    const takes = [
      take({ takeNumber: 1, status: 'flagged' }),
      take({ takeNumber: 2, status: 'generated' }),
    ]
    expect(voiceApprovalBlockedReason(takes, 1)).toBeUndefined()
  })

  it('refuses a script with nothing to narrate rather than passing it as complete', () => {
    expect(voiceApprovalBlockedReason([], 0)).toBe('This script has no paragraphs to narrate.')
  })
})

describe('pronunciations in the take key', () => {
  const base = {
    projectId: 'p1',
    chapterId: 'c1',
    paragraphIndex: 0,
    text: 'Jan Marsalek was already gone.',
    voiceId: 'en-GB-Chirp3-HD-Algieba',
  }

  /**
   * A project that has never used a hint must keep every key it already has,
   * or this change alone would re-narrate every video ever made.
   */
  it('is unchanged when there are no hints', () => {
    expect(takeIdempotencyKey({ ...base, pronunciations: [] })).toBe(takeIdempotencyKey(base))
  })

  it('is unchanged by a hint whose term is not in this paragraph', () => {
    expect(
      takeIdempotencyKey({ ...base, pronunciations: [{ term: 'Theranos', hint: '/ˈθɛrənoʊs/' }] }),
    ).toBe(takeIdempotencyKey(base))
  })

  /**
   * The point of the whole exercise. Correcting how "Jan" is said changes the
   * audio without changing a character of the script, so without this the fix
   * was unreachable: a stage re-run matched the old key and handed back the
   * take that says it wrong.
   */
  it('changes when a hint that applies to this paragraph is added', () => {
    expect(
      takeIdempotencyKey({ ...base, pronunciations: [{ term: 'Jan', hint: '/dʒæn/' }] }),
    ).not.toBe(takeIdempotencyKey(base))
  })

  it('changes when an existing hint is corrected', () => {
    expect(
      takeIdempotencyKey({ ...base, pronunciations: [{ term: 'Jan', hint: '/dʒæn/' }] }),
    ).not.toBe(takeIdempotencyKey({ ...base, pronunciations: [{ term: 'Jan', hint: '/jɑn/' }] }))
  })

  it('is unchanged by reordering the list, which says the same thing', () => {
    const hints = [
      { term: 'Jan', hint: '/dʒæn/' },
      { term: 'Marsalek', hint: '/ˈmɑːsələk/' },
    ]
    expect(takeIdempotencyKey({ ...base, pronunciations: hints })).toBe(
      takeIdempotencyKey({ ...base, pronunciations: [...hints].reverse() }),
    )
  })

  it('composes with pacing rather than colliding with it', () => {
    // A hints-only key and a pacing-only key must never hash the same — the
    // pacing segment is prefixed so it cannot read as a hint hash.
    expect(
      takeIdempotencyKey({ ...base, pronunciations: [{ term: 'Jan', hint: '/dʒæn/' }] }),
    ).not.toBe(takeIdempotencyKey({ ...base, pacing: 0.95 }))
  })

  it('matches whole words, so a term does not fire inside a longer one', () => {
    // "Jan" must not match "January", or a hint for the name would re-read
    // every paragraph carrying a date.
    expect(
      takeIdempotencyKey({
        ...base,
        text: 'It collapsed in January.',
        pronunciations: [{ term: 'Jan', hint: '/dʒæn/' }],
      }),
    ).toBe(takeIdempotencyKey({ ...base, text: 'It collapsed in January.' }))
  })
})
