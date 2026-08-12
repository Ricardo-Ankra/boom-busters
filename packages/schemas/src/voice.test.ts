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
